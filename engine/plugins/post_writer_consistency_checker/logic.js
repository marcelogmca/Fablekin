const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');
const { isValidCharacterName } = require('../../modules/vn_manager/analysis/dialogue_processor.js');

const PLUGIN_ID = 'post_writer_consistency_checker';
const DEFAULT_PROMPT_PATH = path.join(__dirname, 'prompt.txt');
const HQ_PROMPT_DIR = path.join(__dirname, 'hq');
const PATCH_REGEX = /<<<<<<< SEARCH\s*[\r\n]+([\s\S]*?)[\r\n]+=======\s*[\r\n]+([\s\S]*?)[\r\n]+>>>>>>> REPLACE/g;
const REVIEW_TARGET_OPEN_TAG = '<draft_to_validate>';
const REVIEW_TARGET_CLOSE_TAG = '</draft_to_validate>';
const HQ_FINDINGS_OPEN_TAG = '<flagged_findings>';
const HQ_FINDINGS_CLOSE_TAG = '</flagged_findings>';

const HQ_QUALITY_CATEGORIES = [
  { key: 'cat1_banned_phrases', label: 'Banned Phrases & Cliches', promptFile: 'cat1_banned_phrases.txt' },
  { key: 'cat2_repetition', label: 'Repetition & Rotation', promptFile: 'cat2_repetition.txt' },
  { key: 'cat3_dialogue', label: 'Dialogue Dynamics', promptFile: 'cat3_dialogue.txt' },
  { key: 'cat4_familiarity', label: 'Familiarity & Relationships', promptFile: 'cat4_familiarity.txt' },
  { key: 'cat5_prose', label: 'Prose Discipline', promptFile: 'cat5_prose.txt' }
];

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
  dialogue_count_delta_max: 3,
  hq_multipass_enabled: false,
  hq_quality_model_def: { model: 'lowendmodel' },
  hq_flag_max_tokens: 3000,
  hq_corrector_max_tokens: 8000,
  hq_context_lines: 5,
  hq_history_count: 10,
  hq_concurrency: 6
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
    dialogue_count_delta_max: normalizePositiveInteger(source.dialogue_count_delta_max, DEFAULT_SETTINGS.dialogue_count_delta_max),
    hq_multipass_enabled: source.hq_multipass_enabled === true,
    hq_quality_model_def: normalizeModelDef(source.hq_quality_model_def, DEFAULT_SETTINGS.hq_quality_model_def),
    hq_flag_max_tokens: normalizePositiveInteger(source.hq_flag_max_tokens, DEFAULT_SETTINGS.hq_flag_max_tokens),
    hq_corrector_max_tokens: normalizePositiveInteger(source.hq_corrector_max_tokens, DEFAULT_SETTINGS.hq_corrector_max_tokens),
    hq_context_lines: normalizePositiveInteger(source.hq_context_lines, DEFAULT_SETTINGS.hq_context_lines),
    hq_history_count: normalizePositiveInteger(source.hq_history_count, DEFAULT_SETTINGS.hq_history_count),
    hq_concurrency: normalizePositiveInteger(source.hq_concurrency, DEFAULT_SETTINGS.hq_concurrency)
  };
}

function normalizeModelDef(value, fallback) {
  const fallbackModel = fallback && typeof fallback === 'object' ? fallback.model : undefined;
  const fallbackProvider = fallback && typeof fallback === 'object' ? fallback.provider : undefined;
  if (value && typeof value === 'object') {
    return {
      model: value.model || fallbackModel,
      provider: value.provider || fallbackProvider
    };
  }
  if (typeof value === 'string' && value.trim()) {
    return { model: value.trim(), provider: fallbackProvider };
  }
  return { model: fallbackModel, provider: fallbackProvider };
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
  for (const line of lines) {
    if (line && typeof line === 'object') line.line = lineToScript(line);
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

function formatTaggedReviewTarget(dialogueText, numbered = false) {
  const draft = normalizeText(dialogueText);
  return [
    REVIEW_TARGET_OPEN_TAG,
    numbered ? splitLines(draft).map((line, index) => `${index + 1} | ${line}`).join('\n') : draft.trim(),
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

// The checker validates the drafted scene against the checker instructions;
// it does not need the Writer's full conversation (shared contract, replayed
// chapters, CoT suffix) — that clone made this the heaviest call of the turn.
// The HQ consistency flagger receives compact history + a numbered draft;
// single-pass mode keeps its existing unnumbered review target.
function buildCheckerMessages(turnContext, promptText = readPromptText(), settingsInput = {}, compactContext = null) {
  const canonicalLines = getCanonicalLines(turnContext);
  const dialogueText = turnContext?.processed?.dialogueProcessor?.dialogue || buildScriptFromLines(canonicalLines);
  const settings = resolveSettings(settingsInput);
  const speakerLabelAudit = settings.speaker_label_audit ? formatSpeakerLabelAudit(canonicalLines) : '';
  const taggedDraft = formatTaggedReviewTarget(dialogueText, Boolean(compactContext));
  const context = compactContext ? formatCompactContext(compactContext) : '';
  const reviewTarget = [context, speakerLabelAudit, taggedDraft].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: String(promptText || '').trim() },
    { role: 'user', content: reviewTarget }
  ];
}

// Name each prompt message by what it carries rather than by position, so the
// Token Map shows `check.instructions` / `check.review_target` instead of a
// wall of anonymous `message_N` rows.
function namePromptMessages(messages, prefix) {
  return messages.map((message, index) => {
    const role = String(message.role || 'user');
    let piece;
    if (messages.length === 1) {
      piece = prefix;
    } else if (role === 'system') {
      piece = `${prefix}.instructions`;
    } else if (index === messages.length - 1) {
      piece = `${prefix}.review_target`;
    } else {
      piece = `${prefix}.${role}_${index + 1}`;
    }
    return { role, piece, text: String(message.content ?? '') };
  });
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

function readHqPromptText(fileName) {
  return fs.readFileSync(path.join(HQ_PROMPT_DIR, fileName), 'utf8');
}

function formatTaggedFindings(findingsPayload) {
  return [
    HQ_FINDINGS_OPEN_TAG,
    normalizeText(findingsPayload).trim(),
    HQ_FINDINGS_CLOSE_TAG
  ].join('\n');
}

function collectActiveCharacterNames(turnContext) {
  const names = new Set();
  const lines = getCanonicalLines(turnContext);
  for (const line of lines) {
    if (line && line.type === 'dialogue' && typeof line.character === 'string' && line.character.trim()) {
      names.add(line.character.trim());
    }
  }
  const active = turnContext?.processed?.plugins?.character_sheets?.activeCharacters;
  if (Array.isArray(active)) {
    for (const name of active) {
      if (typeof name === 'string' && name.trim()) names.add(name.trim());
    }
  }
  return [...names];
}

function collectCharacterGenders(turnContext) {
  const genders = turnContext?.processed?.characterGenders;
  if (genders && typeof genders === 'object' && !Array.isArray(genders)) return genders;
  const legacy = turnContext?.characterGenders;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) return legacy;
  return {};
}

function collectWorldStateSummary(turnContext) {
  const synthesized = turnContext?.output?.worldStateSynthesized;
  if (typeof synthesized === 'string' && synthesized.trim()) return synthesized.trim();
  const worldState = turnContext?.processed?.worldState;
  if (worldState && typeof worldState === 'object') {
    try {
      return JSON.stringify(worldState).slice(0, 2000);
    } catch {
      return '';
    }
  }
  return '';
}

function collectPromptHistoryFallback(turnContext) {
  const slots = turnContext?.promptComponents?.writer?.history
    || turnContext?.promptComponents?.root?.history;
  if (Array.isArray(slots)) {
    const joined = slots.filter(item => typeof item === 'string' && item.trim()).join('\n\n').trim();
    if (joined) return joined;
  }
  const snapshotHistory = turnContext?.processed?.promptBuilder?.writerPromptSnapshot?.parts?.part3History;
  if (typeof snapshotHistory === 'string' && snapshotHistory.trim()) return snapshotHistory.trim();
  return '';
}

function formatCompactContext(context) {
  const sections = [
    '<compact_history>',
    String(context.historyText || 'No older chapters available.').trim(),
    '</compact_history>',
    '',
    '<compact_world_state>',
    String(context.worldStateSummary || 'No world state summary available.').trim(),
    '</compact_world_state>'
  ];
  const activeCharacters = Array.isArray(context.activeCharacters) ? context.activeCharacters : [];
  if (activeCharacters.length > 0) {
    sections.push('', `<active_characters>${activeCharacters.join(', ')}</active_characters>`);
  }
  return sections.join('\n');
}

async function collectCompressedContext(turnContext, settings) {
  const canonicalLines = getCanonicalLines(turnContext);
  const dialogueText = turnContext?.processed?.dialogueProcessor?.dialogue || buildScriptFromLines(canonicalLines);

  let historyText = '';
  if (turnContext && typeof turnContext.getFormattedHistory === 'function') {
    try {
      historyText = await turnContext.getFormattedHistory({ count: settings.hq_history_count, skip: 1 });
    } catch {
      historyText = '';
    }
  }
  if (!historyText || !String(historyText).trim()) {
    historyText = collectPromptHistoryFallback(turnContext) || 'No older chapters available.';
  }

  return {
    dialogueText,
    historyText: String(historyText),
    activeCharacters: collectActiveCharacterNames(turnContext),
    characterGenders: collectCharacterGenders(turnContext),
    worldStateSummary: collectWorldStateSummary(turnContext)
  };
}

function buildCompressedFlagMessages(categoryPromptText, compressedContext) {
  const context = compressedContext || {};
  const sections = [
    String(categoryPromptText || '').trim(),
    '',
    formatCompactContext(context)
  ];
  const taggedDraft = formatTaggedReviewTarget(context.dialogueText || '', true);
  return [
    { role: 'user', content: `${sections.join('\n')}\n\n${taggedDraft}` }
  ];
}

function normalizeFlagFinding(raw, category) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const reason = String(raw.reason || '').trim();
  const rule = String(raw.rule || '').trim();
  const scope = raw.scope === 'line' || raw.scope === 'passage' ? raw.scope : null;
  if (!rule || !reason || !scope || !Array.isArray(raw.occurrences) || raw.occurrences.length === 0) return null;
  const occurrences = raw.occurrences.map(entry => ({ line: entry?.line, quote: entry?.quote }));
  // repair_targets: the cited lines the corrector must change (defaults to all
  // occurrences). Lets a flagger cite establishing evidence the corrector must
  // leave intact, e.g. an in-scene ownership conflict where lines 1-2 set up
  // the situation and only line 9 is wrong.
  const rawTargets = Array.isArray(raw.repair_targets) ? raw.repair_targets : occurrences.map(entry => entry.line);
  const repairTargets = [...new Set(rawTargets.filter(line => Number.isInteger(line)))];
  if (!repairTargets.length || !repairTargets.every(line => occurrences.some(entry => entry.line === line))) return null;
  return {
    category: String(category || 'unknown'),
    rule: rule.slice(0, 100),
    scope,
    occurrences,
    repair_targets: repairTargets,
    reason: reason.slice(0, 1000)
  };
}

function parseFlagFindings(content, category) {
  const text = String(content || '').trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const startBracket = text.indexOf('[');
    const endBracket = text.lastIndexOf(']');
    if (startBracket === -1 || endBracket === -1 || endBracket <= startBracket) return [];
    try {
      parsed = JSON.parse(text.slice(startBracket, endBracket + 1));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const findings = [];
  for (const raw of parsed) {
    const finding = normalizeFlagFinding(raw, category);
    if (!finding) continue;
    findings.push(finding);
  }
  return findings;
}

function parseFlagResponse(content, category) {
  const findings = parseFlagFindings(content, category);
  const text = String(content || '').trim();
  return {
    findings,
    invalidOutput: findings.length === 0 && !/^(?:```(?:json)?\s*)?\[\s*\](?:\s*```)?$/i.test(text)
  };
}

// Lines are numbered for the model, but the quote remains the source of truth.
// Never "fix" a bad line number by searching for a similar quote elsewhere.
function validateFlagFindings(findingsByAgent, lines) {
  const scriptLines = (Array.isArray(lines) ? lines : []).map(lineToScript);
  let invalidAnchorCount = 0;
  let invalidFindingCount = 0;
  let nextId = 1;
  const agents = findingsByAgent.map(agent => ({
    ...agent,
    findings: (Array.isArray(agent.findings) ? agent.findings : []).flatMap(raw => {
      const finding = normalizeFlagFinding(raw, agent.key);
      if (!finding) {
        invalidFindingCount++;
        return [];
      }
      const seen = new Set();
      const occurrences = [];
      for (const entry of finding.occurrences) {
        const line = entry.line;
        if (!Number.isInteger(line) || line < 1 || line > scriptLines.length ||
            typeof entry.quote !== 'string' || !entry.quote.trim() || entry.quote !== scriptLines[line - 1]) {
          invalidAnchorCount++;
          continue;
        }
        if (seen.has(line)) continue;
        seen.add(line);
        occurrences.push({ line, quote: entry.quote });
      }
      if (!occurrences.length) {
        invalidFindingCount++;
        return [];
      }
      const repairTargets = finding.repair_targets.filter(line => occurrences.some(entry => entry.line === line));
      if (!repairTargets.length) {
        invalidFindingCount++;
        return [];
      }
      return [{ ...finding, id: `F${nextId++}`, occurrences, repair_targets: repairTargets }];
    })
  }));
  const findings = agents.flatMap(agent => agent.findings);
  for (const finding of findings) {
    if (!Array.isArray(finding.repair_targets)) {
      finding.repair_targets = finding.occurrences.map(entry => entry.line);
    }
  }
  return {
    agents,
    actionable: findings,
    flagCount: findings.length,
    passageCount: findings.filter(finding => finding.scope === 'passage').length,
    invalidAnchorCount,
    invalidFindingCount
  };
}

function formatFindingsForCorrector(findings) {
  return JSON.stringify(findings.map(({ id, category, rule, reason, scope, occurrences, repair_targets }) => ({
    id, category, rule, reason, scope, occurrences, repair_targets
  })), null, 2);
}

function buildCorrectorMessages(turnContext, correctorPromptText, findings, settingsInput = {}) {
  // Same principle as the checker: instructions + self-contained review
  // target. No Writer conversation replay.
  const settings = resolveSettings(settingsInput);
  const canonicalLines = getCanonicalLines(turnContext);
  const dialogueText = turnContext?.processed?.dialogueProcessor?.dialogue || buildScriptFromLines(canonicalLines);
  const speakerLabelAudit = settings.speaker_label_audit ? formatSpeakerLabelAudit(canonicalLines) : '';
  const taggedDraft = formatTaggedReviewTarget(dialogueText, true);
  const reviewTarget = speakerLabelAudit ? `${speakerLabelAudit}\n\n${taggedDraft}` : taggedDraft;
  const findingsPayload = formatFindingsForCorrector(findings);
  return [
    { role: 'system', content: String(correctorPromptText || '').trim() },
    { role: 'user', content: `${formatTaggedFindings(findingsPayload)}\n\n${reviewTarget}` }
  ];
}

function parseHqCorrections(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (!fenced) return null;
    try { parsed = JSON.parse(fenced[1]); } catch { return null; }
  }
  return parsed && !Array.isArray(parsed) && typeof parsed === 'object' && Array.isArray(parsed.hunks)
    ? parsed.hunks : null;
}

function createHqScriptLine(text, tools) {
  const match = text.match(/^([^:\n]{1,50}):\s*(.*)$/);
  const line = match && isValidCharacterName(match[1].trim())
    ? { type: 'dialogue', character: match[1].trim(), text: match[2].trim() }
    : { type: 'narrative', line: text };
  line.line = lineToScript(line);
  line.crc = calculateLineCrc(line, tools);
  return line;
}

// Validate every hunk against original (pre-edit) line numbers before touching
// TurnContext. HQ edits may add/remove lines, unlike single-pass SEARCH/REPLACE.
function applyHqCorrectionsToLines(lines, hunks, findings, options = {}, tools = {}) {
  const settings = resolveSettings(options);
  const source = Array.isArray(lines) ? lines : [];
  const originalLines = source.map(lineToScript);
  const normalizedFindings = findings.map(finding => ({
    ...finding,
    repair_targets: Array.isArray(finding.repair_targets)
      ? finding.repair_targets
      : finding.occurrences.map(entry => entry.line)
  }));
  const findingsById = new Map(normalizedFindings.map(finding => [finding.id, finding]));
  const errors = [];
  const covered = new Set();
  let previousEnd = 0;

  if (!Array.isArray(hunks) || hunks.length === 0) errors.push('Return at least one passage hunk for the verified findings.');
  for (const [index, hunk] of (Array.isArray(hunks) ? hunks : []).entries()) {
    const label = `Hunk ${index + 1}`;
    const start = hunk?.start_line;
    const end = hunk?.end_line;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > source.length || start <= previousEnd) {
      errors.push(`${label}: invalid, unsorted, or overlapping original line range.`);
      continue;
    }
    previousEnd = end;
    if (!Array.isArray(hunk.finding_ids) || !hunk.finding_ids.length ||
        hunk.finding_ids.some(id => !findingsById.has(id))) {
      errors.push(`${label}: every finding_id must refer to a verified finding.`);
      continue;
    }
    if (!Array.isArray(hunk.replacement_lines) || hunk.replacement_lines.some(line =>
      typeof line !== 'string' || !line.trim() || /[\r\n]/.test(line) || /^\d+\s*\|\s*/.test(line))) {
      errors.push(`${label}: replacement_lines must be complete, unnumbered, nonempty script lines (or [] to delete the passage).`);
      continue;
    }
    const anchors = hunk.finding_ids.flatMap(id => findingsById.get(id).occurrences
      .filter(entry => entry.line >= start && entry.line <= end)
      .map(entry => ({ id, ...entry })));
    if (!anchors.length || hunk.finding_ids.some(id => !anchors.some(anchor => anchor.id === id))) {
      errors.push(`${label}: each finding_id must have a cited line inside its passage.`);
      continue;
    }
    if (Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
      .some(line => Math.min(...anchors.map(anchor => Math.abs(anchor.line - line))) > settings.hq_context_lines)) {
      errors.push(`${label}: passage strays beyond the ${settings.hq_context_lines}-line local context around its cited lines.`);
      continue;
    }
    for (const anchor of anchors) {
      const mustChange = findingsById.get(anchor.id).repair_targets.includes(anchor.line);
      if (hunk.replacement_lines.includes(anchor.quote)) {
        if (mustChange) {
          errors.push(`${label}: cited line ${anchor.line} from ${anchor.id} remains unchanged.`);
        }
      } else {
        covered.add(`${anchor.id}:${anchor.line}`);
      }
    }
    if (hunk.replacement_lines.join('\n') === originalLines.slice(start - 1, end).join('\n')) {
      errors.push(`${label}: passage is unchanged.`);
    }
  }
  for (const finding of normalizedFindings) {
    for (const line of finding.repair_targets) {
      if (!covered.has(`${finding.id}:${line}`)) {
        errors.push(`${finding.id} line ${line} was not rewritten or removed.`);
      }
    }
  }
  if (errors.length) return { valid: false, errors, lines: source };

  const revisedLines = [];
  let cursor = 0;
  for (const hunk of hunks) {
    revisedLines.push(...source.slice(cursor, hunk.start_line - 1));
    revisedLines.push(...hunk.replacement_lines.map(text => createHqScriptLine(text, tools)));
    cursor = hunk.end_line;
  }
  revisedLines.push(...source.slice(cursor));
  if (!revisedLines.length) return { valid: false, errors: ['The corrected scene cannot be empty.'], lines: source };

  const oldDialogue = source.filter(line => line.type === 'dialogue').length;
  const newDialogue = revisedLines.filter(line => line.type === 'dialogue').length;
  const editedLines = new Set([...covered].map(reference => reference.slice(reference.lastIndexOf(':') + 1)));
  return {
    valid: true,
    lines: revisedLines,
    text: buildScriptFromLines(revisedLines),
    stats: {
      rawPatchCount: hunks.length,
      acceptedCount: hunks.length,
      rejectedCount: 0,
      fuzzyCount: 0,
      dialogueCountDelta: newDialogue - oldDialogue,
      editedLineCount: editedLines.size,
      addressedOccurrenceCount: covered.size,
      lineCountDelta: revisedLines.length - source.length,
      unaddressedCount: 0,
      rejections: []
    }
  };
}

function resolveQualityModelAssignment(settings, tools) {
  const pluginAssignment = tools?.llm?.getPluginModel?.(PLUGIN_ID, 'hq_quality_model_def');
  if (pluginAssignment?.model) {
    return {
      model: pluginAssignment.model,
      provider: pluginAssignment.provider || null,
      resolvedModel: pluginAssignment.resolvedModel || null,
      subprovider: pluginAssignment.subprovider || null,
      source: 'hq_quality'
    };
  }
  return {
    model: settings.hq_quality_model_def.model,
    provider: settings.hq_quality_model_def.provider || null,
    resolvedModel: null,
    subprovider: null,
    source: 'hq_quality'
  };
}

function logModelAssignment(tools, label, assignment) {
  tools?.logger?.runtime?.(
    `${label} model source: ${assignment.source}; `
    + `model=${assignment.resolvedModel || assignment.model}; provider=${assignment.provider}`
    + `${assignment.subprovider ? `; subprovider=${assignment.subprovider}` : ''}`
  );
}

async function runSingleFlagAgent({ key, label, messages, modelAssignment, settings, tools }) {
  const response = await tools.llm.runTask({
    msg: `Post Writer HQ Flag: ${label}`,
    requestId: `hq_flag_${String(key || 'check').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'check'}`,
    prompt: { messages: namePromptMessages(messages, `flag.${key || 'check'}`) },
    model: modelAssignment.model,
    provider: modelAssignment.provider,
    params: {
      retries: settings.retries,
      timeout: settings.timeout,
      max_tokens: settings.hq_flag_max_tokens,
      callingModule: `Plugin:${PLUGIN_ID}:HQ:${key}`
    }
  });
  return { key, label, ...parseFlagResponse(response?.content, key) };
}

async function runHqCheck(turnContext, tools, settingsInput = null) {
  const settings = resolveSettings(settingsInput || tools?.settings?.getSelf?.() || {});
  const lines = getCanonicalLines(turnContext);
  const emptyStats = {
    mode: 'hq',
    rawPatchCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    fuzzyCount: 0,
    dialogueCountDelta: 0,
    allowedDialogueDelta: getAllowedDialogueDelta(0, settings),
    rejections: [],
    perAgent: [],
    flagCount: 0,
    actionableCount: 0,
    passageCount: 0,
    invalidAnchorCount: 0,
    invalidFindingCount: 0,
    invalidFlagOutputCount: 0,
    unaddressedCount: 0
  };

  if (!Array.isArray(lines) || lines.length === 0) {
    storeStats(turnContext, tools, emptyStats);
    storeHqFindings(turnContext, tools, []);
    logCorrectionSummary(tools, emptyStats);
    return emptyStats;
  }

  syncDialogueProcessor(turnContext, lines);

  const consistencyAssignment = resolveCheckerModelAssignment(settings, tools);
  const qualityAssignment = resolveQualityModelAssignment(settings, tools);
  logModelAssignment(tools, 'Post Writer HQ consistency', consistencyAssignment);
  logModelAssignment(tools, 'Post Writer HQ quality', qualityAssignment);

  const compressedContext = await collectCompressedContext(turnContext, settings);
  const consistencyMessages = buildCheckerMessages(turnContext, readHqPromptText('consistency.txt'), settings, compressedContext);
  const categoryPrompts = HQ_QUALITY_CATEGORIES.map(category => ({
    ...category,
    promptText: readHqPromptText(category.promptFile)
  }));

  const flagTasks = [
    {
      key: 'consistency',
      label: 'Consistency',
      messages: consistencyMessages,
      modelAssignment: consistencyAssignment
    },
    ...categoryPrompts.map(category => ({
      key: category.key,
      label: category.label,
      messages: buildCompressedFlagMessages(category.promptText, compressedContext, settings),
      modelAssignment: qualityAssignment
    }))
  ];

  const concurrency = Math.max(1, Math.min(flagTasks.length, settings.hq_concurrency));
  const buildFlagTaskPayload = (flagTask) => ({
    msg: `Post Writer HQ Flag: ${flagTask.label}`,
    requestId: `hq_flag_${String(flagTask.key || 'check').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'check'}`,
    prompt: { messages: namePromptMessages(flagTask.messages, `flag.${flagTask.key || 'check'}`) },
    model: flagTask.modelAssignment.model,
    provider: flagTask.modelAssignment.provider,
    params: {
      retries: settings.retries,
      timeout: settings.timeout,
      max_tokens: settings.hq_flag_max_tokens,
      callingModule: `Plugin:${PLUGIN_ID}:HQ:${flagTask.key}`
    }
  });
  const settleFlagTask = async (flagTask) => {
    try {
      const payload = buildFlagTaskPayload(flagTask);
      const runTask = tools?.llm?.runTask;
      if (typeof runTask !== 'function') {
        throw new Error('tools.llm.runTask is not available.');
      }
      const response = await runTask.call(tools.llm, payload);
      return { status: 'fulfilled', value: {
        key: flagTask.key, label: flagTask.label, ...parseFlagResponse(response?.content, flagTask.key)
      } };
    } catch (error) {
      return { status: 'rejected', reason: error };
    }
  };
  let flagResults = [];
  if (tools?.llm?.batch) {
    const batchResults = await tools.llm.batch(
      flagTasks,
      async (flagTask) => buildFlagTaskPayload(flagTask),
      { concurrency, settle: true, json: false }
    );
    const settledResults = [];
    for (let index = 0; index < flagTasks.length; index++) {
      const entry = batchResults[index];
      if (entry && entry.status === 'fulfilled' && entry.value && typeof entry.value === 'object' && typeof entry.value.content === 'string') {
        settledResults.push({
          status: 'fulfilled',
          value: {
            key: flagTasks[index].key,
            label: flagTasks[index].label,
            ...parseFlagResponse(entry.value.content, flagTasks[index].key)
          }
        });
      } else if (entry && entry.status === 'fulfilled') {
        settledResults.push({ status: 'fulfilled', value: entry.value });
      } else if (entry && entry.status === 'rejected') {
        settledResults.push({ status: 'rejected', reason: entry.reason });
      } else {
        settledResults.push(await settleFlagTask(flagTasks[index]));
      }
    }
    flagResults = settledResults.map((result, index) => ({ result, task: flagTasks[index] }));
  } else {
    const settled = await Promise.allSettled(flagTasks.map(flagTask => runSingleFlagAgent({
      key: flagTask.key,
      label: flagTask.label,
      messages: flagTask.messages,
      modelAssignment: flagTask.modelAssignment,
      settings,
      tools
    })));
    flagResults = settled.map((entry, index) => {
      const task = flagTasks[index];
      if (entry.status === 'fulfilled') {
        return { result: { status: 'fulfilled', value: entry.value, index }, task };
      }
      return { result: { status: 'rejected', reason: entry.reason, index }, task };
    });
  }

  const findingsByAgent = [];
  for (const { result, task } of flagResults) {
    if (result && result.status === 'fulfilled') {
      const value = result.value;
      if (value && typeof value === 'object' && Array.isArray(value.findings)) {
        findingsByAgent.push({
          key: value.key || task.key,
          label: value.label || task.label,
          findings: value.findings,
          invalidOutput: Boolean(value.invalidOutput)
        });
      } else if (value && typeof value === 'object' && typeof value.content === 'string') {
        findingsByAgent.push({
          key: task.key,
          label: task.label,
          ...parseFlagResponse(value.content, task.key)
        });
      } else {
        findingsByAgent.push({ key: task.key, label: task.label, findings: [] });
      }
    } else {
      const reason = result?.reason;
      tools?.logger?.log?.('ConsistencyChecker', `HQ flag agent ${task.key} failed: ${reason?.message || reason || 'unknown error'}`);
      findingsByAgent.push({ key: task.key, label: task.label, findings: [], error: String(reason?.message || reason || 'unknown error') });
    }
  }

  const verified = validateFlagFindings(findingsByAgent, lines);
  storeHqFindings(turnContext, tools, verified.agents);
  const perAgent = verified.agents.map(agent => ({
    key: agent.key,
    label: agent.label,
    flagCount: agent.findings.length,
    invalidOutput: Boolean(agent.invalidOutput),
    failed: Boolean(agent.error)
  }));
  const findingStats = {
    perAgent,
    flagCount: verified.flagCount,
    actionableCount: verified.actionable.length,
    passageCount: verified.passageCount,
    invalidAnchorCount: verified.invalidAnchorCount,
    invalidFindingCount: verified.invalidFindingCount,
    invalidFlagOutputCount: perAgent.filter(agent => agent.invalidOutput).length
  };
  tools?.logger?.runtime?.(
    `Post Writer HQ findings: ${verified.flagCount} verified (${verified.flagCount - verified.passageCount} direct, ${verified.passageCount} passage-scope).`
  );
  if (verified.invalidAnchorCount || verified.invalidFindingCount) {
    tools?.logger?.log?.('ConsistencyChecker',
      `Discarded ${verified.invalidAnchorCount} unverified line references and ${verified.invalidFindingCount} findings without valid references.`);
  }
  if (findingStats.invalidFlagOutputCount) {
    tools?.logger?.log?.('ConsistencyChecker',
      `${findingStats.invalidFlagOutputCount} HQ flag agent(s) returned malformed or incomplete JSON; their findings were ignored.`);
  }
  if (verified.invalidAnchorCount || verified.invalidFindingCount) {
    const stats = {
      ...emptyStats,
      ...findingStats,
      unaddressedCount: verified.flagCount + verified.invalidFindingCount,
      validationErrors: ['One or more flagger citations could not be verified; the original scene was kept.']
    };
    storeStats(turnContext, tools, stats);
    logCorrectionSummary(tools, stats);
    return stats;
  }
  if (!verified.flagCount) {
    const stats = { ...emptyStats, ...findingStats };
    storeStats(turnContext, tools, stats);
    logCorrectionSummary(tools, stats);
    return stats;
  }

  const correctorMessages = buildCorrectorMessages(turnContext, readHqPromptText('corrector.txt'), verified.actionable, settings);
  const correctorAssignment = resolveCheckerModelAssignment(settings, tools);
  logModelAssignment(tools, 'Post Writer HQ corrector', correctorAssignment);
  let result = null;
  let errors = [];
  let attempts = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts++;
    const retryFeedback = attempt === 0 ? [] : [{
      role: 'user',
      content: `Your previous correction was rejected (${errors.length} validation issue(s)). Rebuild the COMPLETE hunks JSON from the original numbered draft. Address EVERY verified finding and cited line, not just the failures listed below. No changes have been applied:\n${errors.slice(0, 30).join('\n')}`
    }];
    try {
      const response = await tools.llm.runTask({
        msg: attempt ? 'Post Writer HQ Corrector Repair' : 'Post Writer HQ Corrector',
        requestId: attempt ? 'hq_corrector_repair' : 'hq_corrector',
        prompt: { messages: namePromptMessages([...correctorMessages, ...retryFeedback], 'corrector') },
        model: correctorAssignment.model,
        provider: correctorAssignment.provider,
        params: {
          retries: settings.retries,
          timeout: settings.timeout,
          max_tokens: settings.hq_corrector_max_tokens,
          callingModule: `Plugin:${PLUGIN_ID}:HQ:corrector`
        }
      });
      const hunks = parseHqCorrections(response?.content);
      result = applyHqCorrectionsToLines(lines, hunks, verified.actionable, settings, tools);
      errors = result.valid ? [] : result.errors;
    } catch (error) {
      errors = [`Corrector request failed: ${error.message}`];
    }
    if (!errors.length) break;
    tools?.logger?.log?.('ConsistencyChecker', `HQ corrector attempt ${attempts} rejected: ${errors.join(' ')}`);
  }

  if (!result?.valid || errors.length) {
    const stats = {
      ...emptyStats,
      ...findingStats,
      correctionAttempts: attempts,
      validationErrors: errors,
      unaddressedCount: verified.flagCount
    };
    storeStats(turnContext, tools, stats);
    logCorrectionSummary(tools, stats);
    return stats;
  }

  const originalWriterResponse = turnContext.processed.narrativeEngine.writerResponse;
  turnContext.processed.vnManager.processedLines = result.lines;
  syncDialogueProcessor(turnContext, result.lines);
  // Fulltext is a getter over writerResponse. Commit the same final script to
  // narrative memory so subsequent turns, assets, and history see the VN scene.
  turnContext.processed.narrativeEngine.writerResponse = result.text;
  if (turnContext.runtime?.lastSearchstring === originalWriterResponse?.substring(0, 500)) {
    turnContext.runtime.lastSearchstring = result.text.substring(0, 500);
  }
  const stats = { ...result.stats, mode: 'hq', ...findingStats, correctionAttempts: attempts };
  storeStats(turnContext, tools, stats);
  logCorrectionSummary(tools, stats);
  return stats;
}

function storeHqFindings(turnContext, tools, findingsByAgent) {
  const compact = (Array.isArray(findingsByAgent) ? findingsByAgent : []).map(agent => ({
    key: agent.key,
    label: agent.label,
    findings: (Array.isArray(agent.findings) ? agent.findings : []).map(finding => ({
      id: finding.id,
      rule: finding.rule,
      scope: finding.scope,
      occurrences: finding.occurrences.map(entry => ({ line: entry.line, quote: entry.quote })),
      reason: String(finding.reason || '').slice(0, 500)
    }))
  }));
  if (tools?.pluginState?.turn) {
    const state = tools.pluginState.turn();
    state.hqFindings = compact;
    return;
  }
  if (!turnContext?.processed) return;
  if (!turnContext.processed.plugins || typeof turnContext.processed.plugins !== 'object') {
    turnContext.processed.plugins = {};
  }
  if (!turnContext.processed.plugins[PLUGIN_ID] || typeof turnContext.processed.plugins[PLUGIN_ID] !== 'object') {
    turnContext.processed.plugins[PLUGIN_ID] = {};
  }
  turnContext.processed.plugins[PLUGIN_ID].hqFindings = compact;
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
  turnContext.processed.plugins[PLUGIN_ID] = {
    ...turnContext.processed.plugins[PLUGIN_ID],
    stats
  };
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
    const passageSuffix = stats?.mode === 'hq'
      ? `, ${stats.editedLineCount} cited line(s) addressed${stats.lineCountDelta ? `, line count delta ${stats.lineCountDelta}` : ''}`
      : '';
    const unaddressedSuffix = stats?.mode === 'hq' && stats.unaddressedCount
      ? `, ${stats.unaddressedCount} finding(s) unaddressed` : '';
    return `Applied ${accepted} ${correctionWord}${fuzzySuffix}${rejectedSuffix}${dialogueSuffix}${passageSuffix}${unaddressedSuffix}.`;
  }

  if (rejected > 0) {
    const patchWord = rejected === 1 ? 'patch' : 'patches';
    return `No safe fixes applied (${rejected} ${patchWord} rejected).`;
  }

  if (stats?.mode === 'hq' && stats.unaddressedCount) {
    return `HQ correction incomplete: ${stats.unaddressedCount} finding(s) unresolved after ${stats.correctionAttempts || 0} attempt(s); original scene kept.`;
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
  if (settings.hq_multipass_enabled) {
    return runHqCheck(turnContext, tools, settings);
  }
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
    requestId: 'consistency_check',
    prompt: { messages: namePromptMessages(messages, 'check') },
    model: modelAssignment.model,
    provider: modelAssignment.provider,
    params: {
      retries: settings.retries,
      timeout: settings.timeout,
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
  HQ_QUALITY_CATEGORIES,
  parseSearchReplacePatches,
  countScriptLines,
  buildScriptFromLines,
  mutateLinesFromScript,
  applySearchReplaceScriptToLines,
  buildCheckerMessages,
  buildCompressedFlagMessages,
  buildCorrectorMessages,
  collectCompressedContext,
  parseFlagFindings,
  validateFlagFindings,
  parseHqCorrections,
  applyHqCorrectionsToLines,
  formatFindingsForCorrector,
  resolveSettings,
  resolveQualityModelAssignment,
  runConsistencyCheck,
  runHqCheck,
  _private: {
    applySinglePatch,
    findFuzzyWindow,
    formatTaggedReviewTarget,
    formatTaggedFindings,
    collectSpeakerLabelCandidates,
    formatSpeakerLabelAudit,
    getAllowedDialogueDelta,
    formatCorrectionSummary,
    logCorrectionSummary,
    resolveCheckerModelAssignment,
    namePromptMessages,
    syncDialogueProcessor,
    readPromptText,
    readHqPromptText,
    normalizeFlagFinding,
    storeHqFindings
  }
};
