const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const PLUGIN_ID = 'post_writer_consistency_checker';
const DEFAULT_PROMPT_PATH = path.join(__dirname, 'prompt.txt');
const PATCH_REGEX = /<<<<<<< SEARCH\s*[\r\n]+([\s\S]*?)[\r\n]+=======\s*[\r\n]+([\s\S]*?)[\r\n]+>>>>>>> REPLACE/g;
const REVIEW_TARGET_OPEN_TAG = '<draft_to_validate>';
const REVIEW_TARGET_CLOSE_TAG = '</draft_to_validate>';

const DEFAULT_SETTINGS = {
  reuse_writer_model: true,
  model_def: { model: 'highendmodel' },
  retries: 1,
  timeout: 90000,
  fuzzy_threshold: 0.92,
  fuzzy_margin: 0.04,
  max_patches: 8,
  speaker_label_audit: true,
  dialogue_count_delta_percent: 0.05,
  dialogue_count_delta_max: 3
};

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function trimPatchBoundary(value) {
  return normalizeText(value)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .trim();
}

function splitLines(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split('\n');
}

function parseSearchReplacePatches(patchScript, options = {}) {
  const maxPatches = normalizePositiveInteger(options.maxPatches, DEFAULT_SETTINGS.max_patches);
  const patches = [];
  const script = normalizeText(patchScript);
  let match;

  while ((match = PATCH_REGEX.exec(script)) !== null) {
    const search = trimPatchBoundary(match[1]);
    const replace = trimPatchBoundary(match[2]);
    if (!search && !replace) continue;

    patches.push({
      index: patches.length + 1,
      search,
      replace
    });

    if (patches.length >= maxPatches) break;
  }

  return patches;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.floor(number));
}

function normalizeNumber(value, fallback, min = null, max = null) {
  let number = Number(value);
  if (!Number.isFinite(number)) number = fallback;
  if (Number.isFinite(min)) number = Math.max(min, number);
  if (Number.isFinite(max)) number = Math.min(max, number);
  return number;
}

function resolveSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const modelDef = source.model_def && typeof source.model_def === 'object'
    ? source.model_def
    : DEFAULT_SETTINGS.model_def;

  return {
    reuse_writer_model: source.reuse_writer_model !== false,
    model_def: {
      model: modelDef.model || DEFAULT_SETTINGS.model_def.model,
      provider: modelDef.provider || DEFAULT_SETTINGS.model_def.provider
    },
    retries: normalizePositiveInteger(source.retries, DEFAULT_SETTINGS.retries),
    timeout: normalizePositiveInteger(source.timeout, DEFAULT_SETTINGS.timeout),
    fuzzy_threshold: normalizeNumber(source.fuzzy_threshold, DEFAULT_SETTINGS.fuzzy_threshold, 0.8, 1),
    fuzzy_margin: normalizeNumber(source.fuzzy_margin, DEFAULT_SETTINGS.fuzzy_margin, 0, 0.25),
    max_patches: normalizePositiveInteger(source.max_patches, DEFAULT_SETTINGS.max_patches),
    speaker_label_audit: source.speaker_label_audit !== false,
    dialogue_count_delta_percent: normalizeNumber(source.dialogue_count_delta_percent, DEFAULT_SETTINGS.dialogue_count_delta_percent, 0, 1),
    dialogue_count_delta_max: normalizePositiveInteger(source.dialogue_count_delta_max, DEFAULT_SETTINGS.dialogue_count_delta_max)
  };
}

function isDialogueScriptLine(line) {
  return /^([^:\n]{1,50}):\s*(.*)$/.test(String(line || '').trim());
}

function countScriptLines(text) {
  const lines = splitLines(text);
  return {
    total: lines.length,
    dialogue: lines.filter(isDialogueScriptLine).length
  };
}

function lineToScript(line) {
  if (!line || typeof line !== 'object') return '';
  if (line.type === 'dialogue' && line.character && typeof line.text === 'string') {
    return `${line.character}: ${line.text}`;
  }
  return String(line.line || line.text || '');
}

function getCanonicalLines(turnContext) {
  const lines = turnContext?.processed?.vnManager?.processedLines;
  return Array.isArray(lines) ? lines : [];
}

function buildScriptFromLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(lineToScript).join('\n');
}

function findExactOccurrences(text, search) {
  const indexes = [];
  if (!search) return indexes;

  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(search, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + Math.max(1, search.length);
  }

  return indexes;
}

function replaceAt(text, start, length, replacement) {
  return text.slice(0, start) + replacement + text.slice(start + length);
}

function findFuzzyWindow(text, search, settings) {
  const lines = splitLines(text);
  const searchLines = splitLines(search);
  const windowSize = searchLines.length;
  if (windowSize === 0 || windowSize > lines.length) {
    return { accepted: false, reason: 'no_fuzzy_window', bestScore: 0 };
  }

  let best = { score: 0, index: -1, text: '' };
  let secondBestScore = 0;

  for (let i = 0; i <= lines.length - windowSize; i++) {
    const candidate = lines.slice(i, i + windowSize).join('\n');
    const score = stringSimilarity.compareTwoStrings(candidate, search);
    if (score > best.score) {
      secondBestScore = best.score;
      best = { score, index: i, text: candidate };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (best.score < settings.fuzzy_threshold) {
    return {
      accepted: false,
      reason: 'fuzzy_below_threshold',
      bestScore: best.score,
      secondBestScore
    };
  }

  if ((best.score - secondBestScore) < settings.fuzzy_margin) {
    return {
      accepted: false,
      reason: 'ambiguous_fuzzy_match',
      bestScore: best.score,
      secondBestScore
    };
  }

  return {
    accepted: true,
    method: 'fuzzy',
    index: best.index,
    windowSize,
    text: best.text,
    bestScore: best.score,
    secondBestScore
  };
}

function applySinglePatch(currentText, patch, settings) {
  const occurrences = findExactOccurrences(currentText, patch.search);
  if (occurrences.length > 1) {
    return { accepted: false, reason: 'ambiguous_exact_match' };
  }

  let candidateText;
  let method = 'exact';
  let fuzzyMeta = null;

  if (occurrences.length === 1) {
    candidateText = replaceAt(currentText, occurrences[0], patch.search.length, patch.replace);
  } else {
    const fuzzy = findFuzzyWindow(currentText, patch.search, settings);
    if (!fuzzy.accepted) {
      return {
        accepted: false,
        reason: fuzzy.reason,
        bestScore: fuzzy.bestScore,
        secondBestScore: fuzzy.secondBestScore
      };
    }

    const lines = splitLines(currentText);
    const replacementLines = splitLines(patch.replace);
    lines.splice(fuzzy.index, fuzzy.windowSize, ...replacementLines);
    candidateText = lines.join('\n');
    method = 'fuzzy';
    fuzzyMeta = {
      bestScore: fuzzy.bestScore,
      secondBestScore: fuzzy.secondBestScore
    };
  }

  const beforeCounts = countScriptLines(currentText);
  const afterCounts = countScriptLines(candidateText);
  if (afterCounts.total !== beforeCounts.total) {
    return {
      accepted: false,
      reason: 'line_count_changed',
      beforeCounts,
      afterCounts
    };
  }

  return {
    accepted: true,
    text: candidateText,
    method,
    fuzzyMeta,
    beforeCounts,
    afterCounts
  };
}

function calculateLineCrc(line, tools = {}) {
  const sanitizeForCrc = tools?.utils?.sanitizeForCrc || (value => String(value || '').trim());
  const calculateCrc = tools?.utils?.calculateCrc || fallbackCrc;
  if (line.type === 'dialogue') {
    return calculateCrc(sanitizeForCrc(`${line.character}:${line.text || ''}`));
  }
  return calculateCrc(sanitizeForCrc(`Narrator:${line.line || ''}`));
}

function fallbackCrc(text) {
  const crc32 = require('crc-32');
  return (crc32.str(String(text || '')) >>> 0).toString();
}

function mutateLinesFromScript(lines, scriptText, tools = {}) {
  const scriptLines = splitLines(scriptText);
  if (!Array.isArray(lines) || lines.length !== scriptLines.length) {
    throw new Error('Cannot mutate VN lines because script line count does not match canonical line count.');
  }

  for (let i = 0; i < lines.length; i++) {
    const target = lines[i] || {};
    const rawLine = scriptLines[i];
    const dialogueMatch = rawLine.match(/^([^:\n]{1,50}):\s*(.*)$/);

    if (dialogueMatch) {
      target.type = 'dialogue';
      target.character = dialogueMatch[1].trim();
      target.text = dialogueMatch[2].trim();
      target.line = `${target.character}: ${target.text}`;
    } else {
      target.type = 'narrative';
      target.line = rawLine.trim();
      delete target.character;
      delete target.text;
    }

    target.crc = calculateLineCrc(target, tools);
    lines[i] = target;
  }

  return lines;
}

function syncDialogueProcessor(turnContext, lines = getCanonicalLines(turnContext)) {
  if (!turnContext?.processed) return;
  if (!turnContext.processed.dialogueProcessor || typeof turnContext.processed.dialogueProcessor !== 'object') {
    turnContext.processed.dialogueProcessor = {};
  }
  turnContext.processed.dialogueProcessor.processedLines = lines;
  turnContext.processed.dialogueProcessor.dialogue = buildScriptFromLines(lines);
}

function getAllowedDialogueDelta(dialogueCount, settings) {
  const percentDelta = Math.ceil(Math.max(0, dialogueCount) * settings.dialogue_count_delta_percent);
  return Math.min(settings.dialogue_count_delta_max, Math.max(1, percentDelta));
}

function applySearchReplaceScriptToLines(lines, patchScript, options = {}, tools = {}) {
  const settings = resolveSettings(options);
  const patches = parseSearchReplacePatches(patchScript, settings);
  const originalCounts = countScriptLines(buildScriptFromLines(lines));
  const allowedDialogueDelta = getAllowedDialogueDelta(originalCounts.dialogue, settings);
  const stats = {
    rawPatchCount: patches.length,
    acceptedCount: 0,
    rejectedCount: 0,
    fuzzyCount: 0,
    dialogueCountDelta: 0,
    allowedDialogueDelta,
    rejections: []
  };

  let currentText = buildScriptFromLines(lines);

  for (const patch of patches) {
    const result = applySinglePatch(currentText, patch, settings);
    if (!result.accepted) {
      stats.rejectedCount++;
      stats.rejections.push({
        index: patch.index,
        reason: result.reason,
        bestScore: result.bestScore,
        secondBestScore: result.secondBestScore,
        beforeCounts: result.beforeCounts,
        afterCounts: result.afterCounts
      });
      continue;
    }

    const candidateCounts = countScriptLines(result.text);
    const dialogueDelta = candidateCounts.dialogue - originalCounts.dialogue;
    if (Math.abs(dialogueDelta) > allowedDialogueDelta) {
      stats.rejectedCount++;
      stats.rejections.push({
        index: patch.index,
        reason: 'dialogue_count_delta_exceeded',
        dialogueDelta,
        allowedDialogueDelta,
        beforeCounts: originalCounts,
        afterCounts: candidateCounts
      });
      continue;
    }

    currentText = result.text;
    mutateLinesFromScript(lines, currentText, tools);
    stats.acceptedCount++;
    stats.dialogueCountDelta = dialogueDelta;
    if (result.method === 'fuzzy') {
      stats.fuzzyCount++;
    }
  }

  return {
    text: currentText,
    stats,
    lines
  };
}

function formatTaggedReviewTarget(dialogueText) {
  return [
    REVIEW_TARGET_OPEN_TAG,
    normalizeText(dialogueText).trim(),
    REVIEW_TARGET_CLOSE_TAG
  ].join('\n');
}

function collectSpeakerLabelCandidates(lines, options = {}) {
  const maxExamples = normalizePositiveInteger(options.maxExamples, 3);
  const candidatesByLabel = new Map();

  for (let i = 0; i < (Array.isArray(lines) ? lines.length : 0); i++) {
    const scriptLine = lineToScript(lines[i]);
    const match = scriptLine.match(/^([^:\n]{1,50}):\s*(.*)$/);
    if (!match) continue;

    const label = match[1].trim();
    if (!label) continue;

    if (!candidatesByLabel.has(label)) {
      candidatesByLabel.set(label, {
        label,
        count: 0,
        lineNumbers: [],
        examples: []
      });
    }

    const candidate = candidatesByLabel.get(label);
    candidate.count++;
    candidate.lineNumbers.push(i + 1);
    if (candidate.examples.length < maxExamples) {
      candidate.examples.push(scriptLine);
    }
  }

  return [...candidatesByLabel.values()];
}

function escapeXmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatSpeakerLabelAudit(lines) {
  const candidates = collectSpeakerLabelCandidates(lines);
  if (candidates.length === 0) return '';

  const output = ['<speaker_label_candidates>'];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    output.push(`${i + 1}. label="${escapeXmlAttribute(candidate.label)}" count=${candidate.count} lines="${candidate.lineNumbers.join(',')}"`);
    for (const example of candidate.examples) {
      output.push(`   example: ${example}`);
    }
  }
  output.push('</speaker_label_candidates>');
  return output.join('\n');
}

function buildCheckerMessages(turnContext, promptText = readPromptText(), settingsInput = {}) {
  const runtimeWriterMessages = turnContext?.runtime?.narrativeEngine?.writerRequestMessages;
  const writerMessages = Array.isArray(runtimeWriterMessages) && runtimeWriterMessages.length > 0
    ? runtimeWriterMessages
    : (Array.isArray(turnContext?.processed?.promptBuilder?.messages)
      ? turnContext.processed.promptBuilder.messages
      : []);
  const clonedMessages = writerMessages
    .filter(message => message && message.role && message.content !== undefined)
    .map(message => ({
      role: String(message.role),
      content: message.content
    }));

  const canonicalLines = getCanonicalLines(turnContext);
  const dialogueText = turnContext?.processed?.dialogueProcessor?.dialogue || buildScriptFromLines(canonicalLines);
  const settings = resolveSettings(settingsInput);
  const speakerLabelAudit = settings.speaker_label_audit ? formatSpeakerLabelAudit(canonicalLines) : '';
  const taggedDraft = formatTaggedReviewTarget(dialogueText);
  const reviewPayload = speakerLabelAudit
    ? `${promptText.trim()}\n\n${speakerLabelAudit}\n\n${taggedDraft}`
    : `${promptText.trim()}\n\n${taggedDraft}`;
  const writerOutput = String(turnContext?.processed?.narrativeEngine?.writerResponse || '');

  return [
    ...clonedMessages,
    ...(writerOutput ? [{ role: 'assistant', content: writerOutput }] : []),
    { role: 'user', content: reviewPayload }
  ];
}

function resolveCheckerModelAssignment(settings, tools) {
  const pluginAssignment = tools?.llm?.getPluginModel?.(PLUGIN_ID, 'model_def');
  const fallback = {
    model: pluginAssignment?.model || settings.model_def.model,
    provider: pluginAssignment?.provider || settings.model_def.provider,
    resolvedModel: pluginAssignment?.resolvedModel || null,
    subprovider: pluginAssignment?.subprovider || null,
    source: 'plugin'
  };

  if (!settings.reuse_writer_model) return fallback;

  const writerAssignment = tools?.llm?.getCoreModel?.('writer');
  if (!writerAssignment?.model || !writerAssignment?.provider) return fallback;

  return {
    model: writerAssignment.model,
    provider: writerAssignment.provider,
    resolvedModel: writerAssignment.resolvedModel || null,
    subprovider: writerAssignment.subprovider || null,
    source: 'writer'
  };
}

function readPromptText(promptPath = DEFAULT_PROMPT_PATH) {
  return fs.readFileSync(promptPath, 'utf8');
}

function storeStats(turnContext, tools, stats) {
  if (tools?.pluginState?.turn) {
    const state = tools.pluginState.turn();
    state.stats = stats;
    return;
  }

  if (!turnContext?.processed) return;
  if (!turnContext.processed.plugins || typeof turnContext.processed.plugins !== 'object') {
    turnContext.processed.plugins = {};
  }
  turnContext.processed.plugins[PLUGIN_ID] = { stats };
}

function formatCorrectionSummary(stats) {
  const accepted = Number(stats?.acceptedCount || 0);
  const rejected = Number(stats?.rejectedCount || 0);
  const fuzzy = Number(stats?.fuzzyCount || 0);
  const dialogueDelta = Number(stats?.dialogueCountDelta || 0);

  if (accepted > 0) {
    const correctionWord = accepted === 1 ? 'correction' : 'corrections';
    const fuzzySuffix = fuzzy > 0 ? `, ${fuzzy} fuzzy` : '';
    const rejectedSuffix = rejected > 0 ? `, ${rejected} rejected` : '';
    const dialogueSuffix = dialogueDelta !== 0 ? `, dialogue count delta ${dialogueDelta}` : '';
    return `Applied ${accepted} ${correctionWord}${fuzzySuffix}${rejectedSuffix}${dialogueSuffix}.`;
  }

  if (rejected > 0) {
    const patchWord = rejected === 1 ? 'patch' : 'patches';
    return `No safe fixes applied (${rejected} ${patchWord} rejected).`;
  }

  return 'No fixes needed.';
}

function logCorrectionSummary(tools, stats) {
  const summary = formatCorrectionSummary(stats);
  tools?.logger?.log?.('ConsistencyChecker', summary);
  tools?.logger?.runtime?.(`Post Writer Consistency Checker: ${summary}`);
}

async function runConsistencyCheck(turnContext, tools, settingsInput = null) {
  const settings = resolveSettings(settingsInput || tools?.settings?.getSelf?.() || {});
  const lines = getCanonicalLines(turnContext);
  const emptyStats = {
    rawPatchCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    fuzzyCount: 0,
    dialogueCountDelta: 0,
    allowedDialogueDelta: getAllowedDialogueDelta(0, settings),
    rejections: []
  };

  if (!Array.isArray(lines) || lines.length === 0) {
    storeStats(turnContext, tools, emptyStats);
    logCorrectionSummary(tools, emptyStats);
    return emptyStats;
  }

  syncDialogueProcessor(turnContext, lines);

  const messages = buildCheckerMessages(turnContext, readPromptText(), settings);
  const modelAssignment = resolveCheckerModelAssignment(settings, tools);
  tools?.logger?.runtime?.(
    `Post Writer Consistency Checker model source: ${modelAssignment.source}; `
    + `model=${modelAssignment.resolvedModel || modelAssignment.model}; provider=${modelAssignment.provider}`
    + `${modelAssignment.subprovider ? `; subprovider=${modelAssignment.subprovider}` : ''}`
  );
  const response = await tools.llm.runTask({
    msg: 'Post Writer Consistency Checker',
    messages,
    model: modelAssignment.model,
    provider: modelAssignment.provider,
    params: {
      retries: settings.retries,
      timeout: settings.timeout,
      temperature: 0.1,
      max_tokens: 900,
      callingModule: `Plugin:${PLUGIN_ID}`
    }
  });

  const content = String(response?.content || '');
  if (!content.includes('<<<<<<< SEARCH')) {
    storeStats(turnContext, tools, emptyStats);
    logCorrectionSummary(tools, emptyStats);
    return emptyStats;
  }

  const result = applySearchReplaceScriptToLines(lines, content, settings, tools);
  turnContext.processed.vnManager.processedLines = lines;
  syncDialogueProcessor(turnContext, lines);
  storeStats(turnContext, tools, result.stats);

  logCorrectionSummary(tools, result.stats);

  return result.stats;
}

module.exports = {
  PLUGIN_ID,
  DEFAULT_SETTINGS,
  parseSearchReplacePatches,
  countScriptLines,
  buildScriptFromLines,
  mutateLinesFromScript,
  applySearchReplaceScriptToLines,
  buildCheckerMessages,
  resolveSettings,
  runConsistencyCheck,
  _private: {
    applySinglePatch,
    findFuzzyWindow,
    formatTaggedReviewTarget,
    collectSpeakerLabelCandidates,
    formatSpeakerLabelAudit,
    getAllowedDialogueDelta,
    formatCorrectionSummary,
    logCorrectionSummary,
    resolveCheckerModelAssignment,
    syncDialogueProcessor,
    readPromptText
  }
};
