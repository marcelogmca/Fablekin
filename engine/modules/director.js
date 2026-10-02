// modules/director.js

const { TurnLogger, Logger, readSettings, readFileSync } = require('./utils.js');
const { callLLM } = require('./llm.js');
const path = require('path');
const promptBuilder = require('./prompt_builder.js');
const pluginManager = require('./plugin_manager/plugin_manager.js');
const factManager = require('./memory_manager/storage/fact_manager.js');
const narrativeAnalyzer = require('./vn_manager/analysis/narrative_analyzer.js');
const { runWithDiagnosticContext } = require('./diagnostic_context.js');
const { logSharedPrefixUsage } = require('./shared_narrative_prompt.js');
const { Prompt, PreparedPrompt } = require('./prompt/prompt.js');

// Load modular prompt files
const systemPrompt = readFileSync(path.join(__dirname, '../prompts/director/system.txt'));
const nativeCoTSteps = parseCoTSteps(readFileSync(path.join(__dirname, '../prompts/director/cot_steps.txt')));
const originalLedgerSections = readFileSync(path.join(__dirname, '../prompts/director/ledger_sections.txt'))
const nativeLedgerSections = parseLedgerSections(originalLedgerSections);
const outputAnalysis = readFileSync(path.join(__dirname, '../prompts/director/output_analysis.txt'));
const outputLedger = readFileSync(path.join(__dirname, '../prompts/director/output_ledger.txt'));
const outputPluginFeedback = readFileSync(path.join(__dirname, '../prompts/director/output_plugin_feedback.txt'));
const pendingLedgerUpdatesByProject = new Map();
// CONFIGURATION
const DEFAULT_DIRECTOR_ANALYSIS_TIMEOUT = 120000;
const DEFAULT_DIRECTOR_LEDGER_TIMEOUT = 60000;
const DEFAULT_DIRECTOR_RETRIES = 0;
// The async ledger runs in the background, so a slow reasoning model can be
// given a long deadline and several attempts without holding up the turn.
const DEFAULT_DIRECTOR_LEDGER_RETRIES = 5;
// No application-wide sampling defaults (temperature/top_p/penalties): the
// selected model runs its native settings unless director.llm_params overrides.
const DEFAULT_DIRECTOR_LLM_PARAMS = {
  max_tokens: 32000
};

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDirectorPrivateSection(heading, tag, content) {
  const text = String(content ?? '').trim();
  if (!text) return '';

  return `${heading}\n<${tag}>\n${text}\n</${tag}>`;
}

function buildInventoryIntentSection(turnContext) {
  const intent = turnContext?.input?.inventoryIntent;
  if (!intent || typeof intent !== 'object') return '';
  const lines = [];
  const useText = String(intent.useText || '').trim();
  const deleteText = String(intent.deleteText || '').trim();
  if (useText) lines.push(`[Inventory Intent] ${useText}`);
  if (deleteText) lines.push(`[Inventory Disposal Intent] ${deleteText}`);
  if (lines.length === 0) return '';
  return `# CURRENT INVENTORY INTENT
<current_inventory_intent>
${lines.join('\n')}
</current_inventory_intent>`;
}

function getConfig() {
  const settings = readSettings() || {};
  const director = settings.narrative_agents?.director || {};
  const analysisTimeout = parsePositiveInteger(
    director.analysis_timeout ?? director.timeout,
    DEFAULT_DIRECTOR_ANALYSIS_TIMEOUT
  );
  return {
    THINKING_MODEL: director.model,
    PROVIDER: director.provider,
    RETRIES: parseNonNegativeInteger(director.retries, DEFAULT_DIRECTOR_RETRIES),
    ANALYSIS_TIMEOUT: analysisTimeout,
    LEDGER_TIMEOUT: parsePositiveInteger(director.ledger_timeout, Math.min(analysisTimeout, DEFAULT_DIRECTOR_LEDGER_TIMEOUT)),
    LEDGER_RETRIES: parseNonNegativeInteger(director.ledger_retries, DEFAULT_DIRECTOR_LEDGER_RETRIES),
    PLUGIN_FEEDBACK_TIMEOUT: parsePositiveInteger(director.plugin_feedback_timeout, Math.min(analysisTimeout, DEFAULT_DIRECTOR_LEDGER_TIMEOUT)),
    CHAPTERS_TO_REVIEW: director.chapters_to_review ?? 4,
    DIRECT_PLUGINS_ENABLED: director.direct_plugins_enabled !== false,
    ENABLE_SCENE_BOUNDARY_STRATEGY: director.enable_scene_boundary_strategy !== false,
    LLM_PARAMS: director.llm_params || DEFAULT_DIRECTOR_LLM_PARAMS,
    VALIDATION_REGEX: /(?:---\s*\w+\s*---|###\s*\w+)/,
    ENABLED: director.enabled !== false
  };
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

/**
 * Parse CoT steps from file.
 * Splits on "Step X:" pattern and preserves original numbering (1, 2.1, 4A, 5.1B, etc.)
 */
function parseCoTSteps(content) {
  // Split on "Step X:" pattern, keeping the step header
  const rawSteps = content.split(/\n(?=Step \d+(?:\.\d+)?[A-Z]*:)/g);

  return rawSteps
    .map(step => step.trim())
    .filter(Boolean)
    .map(step => {
      // Extract the full header including original numbering (e.g., "Step 4.1: ")
      const match = step.match(/^(Step \d+(?:\.\d+)?[A-Z]*: )([\s\S]*)/);
      if (match) {
        return {
          stepId: extractStepId(match[1]),
          header: match[1], // e.g., "Step 4.1: "
          content: match[2].trim()
        };
      }
      return { stepId: '', header: '', content: step };
    });
}

function extractStepId(headerOrStep) {
  if (typeof headerOrStep !== 'string') return '';
  const match = headerOrStep.trim().match(/^Step\s+(\d+(?:\.\d+)?[A-Z]*)(?::|\s|$)/i);
  return match ? match[1].toUpperCase() : '';
}

function normalizeCotPatchText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCotContributionId(pluginId, id) {
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  if (normalizedId) return normalizedId;
  return `${pluginId || 'unknown_plugin'}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
}

function normalizeCotStepId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const extracted = extractStepId(text);
  return (extracted || text).replace(/^Step\s+/i, '').replace(/:$/, '').trim().toUpperCase();
}

function buildCotHeader(stepId) {
  return `Step ${stepId}: `;
}

function collapseCotPatches(cotPatches = []) {
  const byId = new Map();

  for (const patch of cotPatches || []) {
    if (!patch || typeof patch !== 'object') continue;
    const pluginId = typeof patch.pluginId === 'string' && patch.pluginId.trim() ? patch.pluginId.trim() : 'unknown_plugin';
    const id = normalizeCotContributionId(pluginId, patch.id);
    const type = typeof patch.type === 'string' ? patch.type.trim().toLowerCase() : '';

    if (type === 'remove') {
      byId.delete(id);
      continue;
    }

    byId.set(id, { ...patch, id, pluginId, type });
  }

  return Array.from(byId.values());
}

function applyCotPatches(nativeSteps = [], cotPatches = [], logger = null) {
  const steps = nativeSteps.map(step => ({
    origin: 'native',
    pluginId: null,
    contributionId: `native.${step.stepId || step.header}`,
    stepId: step.stepId || extractStepId(step.header),
    header: step.header,
    content: step.content,
    disabled: false
  }));

  const logPatch = (patch, message) => {
    if (logger && typeof logger.log === 'function') {
      logger.log('Director', 'CoTPatch', message, null, {
        pluginId: patch.pluginId,
        id: patch.id,
        type: patch.type,
        target: patch.target || null,
        step: patch.step || null
      });
    }
  };

  for (const patch of collapseCotPatches(cotPatches)) {
    if (patch.type === 'add') {
      const stepId = normalizeCotStepId(patch.step);
      const content = normalizeCotPatchText(patch.content);
      if (!stepId || !content) continue;

      const existingIndex = steps.findIndex(step => step.contributionId === patch.id && step.origin === 'plugin');
      const entry = {
        origin: 'plugin',
        pluginId: patch.pluginId,
        contributionId: patch.id,
        stepId,
        header: buildCotHeader(stepId),
        content,
        title: normalizeCotPatchText(patch.title),
        disabled: false
      };

      if (existingIndex >= 0) steps[existingIndex] = entry;
      else steps.push(entry);
      logPatch(patch, `Applied plugin CoT add [${patch.id}] at Step ${stepId}.`);
      continue;
    }

    if (patch.type === 'override') {
      const target = normalizeCotStepId(patch.target);
      const content = normalizeCotPatchText(patch.content);
      if (!target || !content) continue;

      let applied = false;
      for (const step of steps) {
        if (step.stepId !== target) continue;
        step.content = content;
        step.title = normalizeCotPatchText(patch.title);
        step.overriddenBy = patch.id;
        step.disabled = false;
        applied = true;
      }
      logPatch(
        patch,
        applied
          ? `Applied plugin CoT override [${patch.id}] to Step ${target}.`
          : `Plugin CoT override [${patch.id}] targeted missing Step ${target}.`
      );
      continue;
    }

    if (patch.type === 'disable') {
      const target = normalizeCotStepId(patch.target);
      if (!target) continue;

      let applied = false;
      for (const step of steps) {
        if (step.stepId !== target) continue;
        step.disabled = true;
        step.disabledBy = patch.id;
        step.disabledReason = normalizeCotPatchText(patch.reason);
        applied = true;
      }
      logPatch(
        patch,
        applied
          ? `Applied plugin CoT disable [${patch.id}] to Step ${target}.`
          : `Plugin CoT disable [${patch.id}] targeted missing Step ${target}.`
      );
    }
  }

  return steps.filter(step => !step.disabled);
}

function assembleCotSteps(nativeSteps = [], cotPatches = [], logger = null) {
  let unnumberedCounter = 1000;
  const patchedSteps = applyCotPatches(nativeSteps, cotPatches, logger);
  const allSteps = patchedSteps.map(step => {
    if (step.header) return step;
    return {
      ...step,
      stepId: String(unnumberedCounter),
      header: buildCotHeader(unnumberedCounter++),
      content: normalizeCotPatchText(step.content)
    };
  });

  const getSortKey = (step) => {
    const stepId = step.stepId || extractStepId(step.header);
    const match = stepId.match(/^(\d+)(?:\.(\d+))?([A-Z]*)/);
    if (!match) return 999999;
    const major = parseInt(match[1], 10);
    const minor = match[2] ? parseInt(match[2], 10) : 0;
    const letter = match[3] ? match[3].charCodeAt(0) : 0;
    return major * 10000 + minor * 100 + letter;
  };

  allSteps.sort((a, b) => getSortKey(a) - getSortKey(b));
  return allSteps.map(obj => `${obj.header}${obj.content}`);
}

/**
 * Parse ledger sections from file.
 * Each section is "### SECTION_ID\ncontent"
 */
function parseLedgerSections(content) {
  const sections = {};
  const regex = /### ([A-Z_]+)\s*([\s\S]*?)(?=### [A-Z_]+|$)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    sections[match[1]] = {
      id: match[1],
      label: match[1],
      content: match[2].trim()
    };
  }

  return sections;
}

function rollSceneBoundaryStrategy() {
  const roll = Math.random() * 100;
  if (roll < 40) {
    return {
      roll,
      key: 'character_direct_query',
      label: 'Character Direct Query',
      observation: 'End preference: a specific character directly asks the player character for a decision or input.',
      writerHint: 'If compatible, end with a character-to-player question rather than a narrator question.'
    };
  }
  if (roll < 70) {
    return {
      roll,
      key: 'neutral',
      label: 'Neutral (No Special Closure Bias)',
      observation: 'No special ending archetype is preferred this turn.',
      writerHint: 'No additional closure-style constraint is required.'
    };
  }
  if (roll < 85) {
    return {
      roll,
      key: 'introspective_pivot',
      label: 'Introspective Pivot',
      observation: 'End preference: a quiet emotional beat, subtle gesture, or reflective pause before player action.',
      writerHint: 'If compatible, slow the ending cadence and land on an emotional interior beat.'
    };
  }
  return {
    roll,
    key: 'narrative_crossroads',
    label: 'Narrative Crossroads',
    observation: 'End preference: frame the immediate dilemma and conflicting options without resolving them.',
    writerHint: 'If compatible, end on a crossroads frame with unresolved tactical or relational pressure.'
  };
}

function normalizeCapabilityForWriter(phase) {
  if (typeof phase !== 'string') return '';
  const token = phase.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!token || token === 'none' || token === 'normal') return '';
  if (token === 'combat') return 'combat';
  if (token === 'camp' || token === 'rest' || token === 'resting') return 'camp';
  if (token === 'travel' || token === 'travel_book' || token === 'travelbook') return 'travel';
  return token;
}

function getCapabilityDisplayLabel(key) {
  switch (key) {
    case 'combat':
      return 'Combat';
    case 'camp':
      return 'Camp/Town';
    case 'travel':
      return 'Travel';
    default:
      return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

function getCapabilityDefaultDescription(key) {
  switch (key) {
    case 'combat':
      return 'There is room for a high-pressure confrontation beat if the scene naturally escalates.';
    case 'camp':
      return 'There is room for a Dragon Age-style camp/town downtime beat with character bonding.';
    case 'travel':
      return 'There is room for a travel transition beat between locations.';
    default:
      return 'There is room for this optional pacing beat when it naturally fits the chapter.';
  }
}

function getCapabilityDefaultDirection(key) {
  switch (key) {
    case 'combat':
      return 'If a fight begins naturally, end the chapter mid-conflict before the outcome is settled.';
    case 'camp':
      return 'If a camp/town rest beat naturally forms, end mid-scene while characters remain in the current camp/town. Do not start a new action beat; close on a settled pause rather than an action cliffhanger.';
    case 'travel':
      return 'If travel naturally starts, end the chapter mid-journey before arrival or route outcome is resolved.';
    default:
      return 'If this pacing beat naturally starts, end mid-scene before its major outcome is resolved.';
  }
}

function formatCapabilityLastSeen(lastTurnNumber, currentTurnNumber) {
  if (!Number.isFinite(lastTurnNumber)) return 'Never';
  if (!Number.isFinite(currentTurnNumber) || currentTurnNumber <= lastTurnNumber) {
    return `Turn ${lastTurnNumber}`;
  }
  const turnsAgo = currentTurnNumber - lastTurnNumber;
  const suffix = turnsAgo === 1 ? 'turn ago' : 'turns ago';
  return `Turn ${lastTurnNumber} (${turnsAgo} ${suffix})`;
}

function extractCapabilityKeyFromChapter(chapter) {
  const directCapability = normalizeCapabilityForWriter(chapter?.processed?.scenePhaseClassifier?.capability);
  if (directCapability) return directCapability;

  const resolvedPhase = normalizeCapabilityForWriter(chapter?.processed?.scenePhaseClassifier?.resolvedPhase);
  if (resolvedPhase) return resolvedPhase;

  return '';
}

function buildCapabilityHistoryMap(chapters = []) {
  const historyMap = new Map();
  const ordered = [...chapters].sort((a, b) => b.turnNumber - a.turnNumber);
  for (const chapter of ordered) {
    const key = extractCapabilityKeyFromChapter(chapter);
    if (!key || historyMap.has(key)) continue;
    historyMap.set(key, chapter.turnNumber);
  }
  return historyMap;
}

function buildCapabilityWriterGuidance({ registeredCapabilities = [], chapterHistory = [], currentTurnNumber }) {
  const byKey = new Map();
  for (const capability of registeredCapabilities) {
    const key = normalizeCapabilityForWriter(capability?.phase);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        phase: capability?.phase || key,
        pluginIds: new Set(),
        descriptions: [],
        hints: []
      });
    }
    const entry = byKey.get(key);
    if (capability?.pluginId) entry.pluginIds.add(capability.pluginId);
    if (capability?.description) entry.descriptions.push(capability.description.trim());
    if (capability?.handoffHint) entry.hints.push(capability.handoffHint.trim());
  }

  const historyMap = buildCapabilityHistoryMap(chapterHistory);
  const entries = Array.from(byKey.values())
    .map(capability => {
      const lastTurnNumber = historyMap.has(capability.key) ? historyMap.get(capability.key) : null;
      const description = capability.descriptions[0] || getCapabilityDefaultDescription(capability.key);
      const suggestedDirection = capability.hints[0] || getCapabilityDefaultDirection(capability.key);

      return {
        key: capability.key,
        label: getCapabilityDisplayLabel(capability.key),
        phase: capability.phase,
        pluginIds: Array.from(capability.pluginIds),
        description,
        suggestedDirection,
        statusText: suggestedDirection,
        actionable: true,
        excludedByWindow: false,
        lastTurnNumber,
        lastSeen: formatCapabilityLastSeen(lastTurnNumber, currentTurnNumber)
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  if (entries.length === 0) {
    return {
      enabled: false,
      handoffAllowed: true,
      excludedPhases: [],
      entries: [],
      generatedText: ''
    };
  }

  const lines = [];
  lines.push('Optional dynamic event opportunities for this chapter:');
  lines.push('Use one of them only if it fits naturally with player intent, scene tone, and current narrative urgency.');
  lines.push('If you want the player to engage in this gameplay opportunity, you MUST not resolve the outcome of the gameplay opportunity within the same chapter.');
  lines.push('');

  for (const entry of entries) {
    lines.push(`- ${entry.label} Opportunity: ${entry.description}`);
    lines.push(`  Last time this appeared: ${entry.lastSeen}.`);
    lines.push(`  Direction: ${entry.statusText}`);
  }
  lines.push('');
  lines.push("The <writer_brief> takes priority. If there's a clear instruction against writing a dynamic event, follow <writer_brief>.");

  return {
    enabled: true,
    handoffAllowed: true,
    excludedPhases: [],
    entries,
    generatedText: lines.join('\n')
  };
}

function hasDenyEventDirective(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const writerBriefMatch = text.match(/---\s*WRITER_BRIEF\s*---([\s\S]*)$/i);
  if (!writerBriefMatch || typeof writerBriefMatch[1] !== 'string') return false;
  return /\bdeny_event\b/i.test(writerBriefMatch[1]);
}

function truncateAdvisoryText(value, maxChars = 520) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}...` : text;
}

function truncateDirectorMonologue(value, maxChars = 1200) {
  const text = typeof value === 'string'
    ? value.trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    : '';
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}...` : text;
}

function sanitizePostWriterAdvisory(raw = {}) {
  const severity = String(raw?.severity || 'none').trim().toLowerCase();
  const validSeverity = ['low', 'medium', 'high'].includes(severity) ? severity : 'none';
  const message = truncateAdvisoryText(raw?.message || '');
  if (validSeverity === 'none' || !message) return null;

  const expiresAfterTurns = Number.parseInt(raw?.expiresAfterTurns ?? raw?.expires_after_turns, 10);
  return {
    severity: validSeverity,
    capability: normalizeCapabilityForWriter(raw?.capability || ''),
    topic: String(raw?.topic || 'capability_pacing').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'capability_pacing',
    message,
    expiresAfterTurns: Number.isInteger(expiresAfterTurns) && expiresAfterTurns > 0 ? Math.min(4, expiresAfterTurns) : 2
  };
}

async function getDirectorHistoryTurns(turnContext) {
  try {
    if (typeof turnContext?.retrieveDatedChapters !== 'function') return [];
    const history = await turnContext.retrieveDatedChapters();
    return [...(history?.synopsischapters || []), ...(history?.summarychapters || []), ...(history?.fullchapters || [])]
      .sort((a, b) => a.turnNumber - b.turnNumber);
  } catch (error) {
    Logger.warn('Director', 'PostWriterAdvisory', `Failed to collect previous classifier advisories: ${error.message}`);
    return [];
  }
}

function extractDirectorMonologue(chapter) {
  const direct = truncateDirectorMonologue(chapter?.processed?.director?.yourMonologue);
  if (direct) return direct;

  const fullResponse = chapter?.processed?.director?.fullResponse;
  if (typeof fullResponse !== 'string' || !fullResponse.trim()) return '';

  const parsed = parseDirectorSections(fullResponse);
  return truncateDirectorMonologue(parsed.yourMonologue);
}

function buildDirectorMonologueFeedbackBlock(historyTurns = [], currentTurnNumber = null) {
  const currentTurn = Number(currentTurnNumber);
  const recent = [...historyTurns]
    .filter(chapter => {
      const turnNumber = Number(chapter?.turnNumber);
      return Number.isFinite(turnNumber) && (!Number.isFinite(currentTurn) || turnNumber < currentTurn);
    })
    .sort((a, b) => a.turnNumber - b.turnNumber)
    .slice(-2);
  const lines = [];

  for (const chapter of recent) {
    const monologue = extractDirectorMonologue(chapter);
    if (!monologue) continue;

    const turnNumber = Number(chapter?.turnNumber);
    const age = Number.isFinite(currentTurnNumber) && Number.isFinite(turnNumber)
      ? ` (${currentTurnNumber - turnNumber} turns ago)`
      : '';
    lines.push(`## Turn ${chapter.turnNumber}${age}\n${monologue}`);
  }

  if (lines.length === 0) return '';
  return [
    'These are notes you previously wrote to your future self in YOUR_MONOLOGUE. Treat them as strategic continuity memory, not as hard orders. Keep, revise, or retire them through your new analysis.',
    ...lines
  ].join('\n\n');
}

function buildPostWriterPacingAdvisoryBlock(historyTurns = [], currentTurnNumber = null) {
  const recent = [...historyTurns].sort((a, b) => b.turnNumber - a.turnNumber).slice(0, 8);
  const lines = [];

  for (const chapter of recent) {
    const advisory = sanitizePostWriterAdvisory(chapter?.processed?.scenePhaseClassifier?.directorAdvisory);
    if (!advisory) continue;

    const turnNumber = Number(chapter?.turnNumber);
    const age = Number.isFinite(currentTurnNumber) && Number.isFinite(turnNumber)
      ? currentTurnNumber - turnNumber
      : 1;
    if (age < 0 || age > advisory.expiresAfterTurns) continue;

    const capability = advisory.capability ? ` / ${advisory.capability}` : '';
    lines.push(`- Turn ${chapter.turnNumber}: [${advisory.severity}${capability}] ${advisory.topic}: ${advisory.message}`);
  }

  if (lines.length === 0) return '';
  return [
    'Observational notes from the post-writer pacing evaluator. Treat these as telemetry, not orders; use them only if they help preserve narrative rhythm.',
    ...lines
  ].join('\n');
}

// ============================================================================
// DIRECTOR PROMPT ASSEMBLY
// ============================================================================

/**
 * Runs the hook phase that prepares Director-adjacent plugin state.
 *
 * This phase must also be available when the Director LLM is bypassed (for
 * example by a manual Director directive). Capability registration happens
 * here and is later consumed by the post-writer scene phase classifier.
 * Keep it idempotent because the normal Director path also reaches it while
 * assembling its prompt.
 */
async function runDirectorPrePromptHooks(turnContext) {
  const runtime = turnContext.runtime = turnContext.runtime || {};
  const directorRuntime = runtime.director = runtime.director || {};

  if (directorRuntime.prePromptHooksExecuted === true) return;

  await pluginManager.executeHook('HOOK_DIRECTOR_PRE_PROMPT', turnContext);
  directorRuntime.prePromptHooksExecuted = true;
}

/**
 * Creates the prompt for the director LLM.
 */
async function createDirectorPrompt(turnContext, config) {
  Logger.log('Director', 'Assembler', 'Assembling Director prompt...', 'start');

  await promptBuilder.prepareSharedNarrativePrefix(turnContext);

  // Shared root is frozen; this hook may still add Director-private suffix content.
  await runDirectorPrePromptHooks(turnContext);

  const director = turnContext.runtime.director;

  // 2. Build CoT steps from native content and structured plugin patches.
  let sceneBoundaryStrategyLabel = 'DISABLED';
  let sceneBoundaryStrategyObservation = 'Core scene-boundary RNG strategy is disabled for this turn.';
  let sceneBoundaryStrategyWriterHint = 'No RNG boundary hint should be applied this turn.';
  let capabilityPhaseHistory = 'No previous turns recorded.';
  let capabilityRegisteredCapabilities = 'None.';
  const allHistory = await getDirectorHistoryTurns(turnContext);
  const directorMonologueFeedback = buildDirectorMonologueFeedbackBlock(allHistory, Number(turnContext?.turnNumber));
  const postWriterPacingAdvisory = buildPostWriterPacingAdvisoryBlock(allHistory, Number(turnContext?.turnNumber));

  // 2.0 Core programmatic scene-boundary strategy roll (RNG).
  if (config.ENABLE_SCENE_BOUNDARY_STRATEGY) {
    const strategy = rollSceneBoundaryStrategy();
    sceneBoundaryStrategyLabel = `${strategy.label} (roll=${strategy.roll.toFixed(2)})`;
    sceneBoundaryStrategyObservation = strategy.observation;
    sceneBoundaryStrategyWriterHint = strategy.writerHint;
    turnContext.runtime.director.sceneBoundaryStrategy = strategy;
    if (turnContext?.processed?.director) {
      turnContext.processed.director.sceneBoundaryStrategy = strategy;
    }
  } else {
    turnContext.runtime.director.sceneBoundaryStrategy = null;
    if (turnContext?.processed?.director) {
      turnContext.processed.director.sceneBoundaryStrategy = null;
    }
  }

  // 2.1 Build capability prompt values for template placeholders.
  if (director.registeredCapabilities && director.registeredCapabilities.length > 0) {
    const lastTurns = allHistory.slice(-6);
    capabilityPhaseHistory = lastTurns.length > 0
      ? lastTurns.map(t => `Turn ${t.turnNumber}: Phase [${t.processed?.director?.scenePhase || 'NORMAL'}]${t.processed?.director?.scenePluginId ? ` via [${t.processed.director.scenePluginId}]` : ''}`).join('\n')
      : 'No previous turns recorded.';

    capabilityRegisteredCapabilities = director.registeredCapabilities.map(cap => {
      return `- Dynamic Event: [${cap.phase}] | PluginID: [${cap.pluginId}] | Trigger: ${cap.description}${cap.handoffHint ? ` | Writer Direction Hint: ${cap.handoffHint}` : ''}`;
    }).join('\n');
  }

  const stepStrings = assembleCotSteps(nativeCoTSteps, director.cotPatches || [], Logger);

  // Join with intelligent spacing: double newline for major step changes, single for same major number
  const stepLines = [];
  let lastMajorNum = null;

  for (const stepStr of stepStrings) {
    // Extract major number (e.g., "1" from "Step 1:", "4" from "Step 4A:", "5" from "Step 5.1:")
    const majorMatch = stepStr.match(/^Step (\d+)/);
    const majorNum = majorMatch ? parseInt(majorMatch[1], 10) : null;

    if (lastMajorNum !== null && lastMajorNum !== majorNum) {
      // Different major number - add double newline for separation
      stepLines.push('');
    } else if (lastMajorNum !== null) {
      // Same major number - just a single newline for condensing
      stepLines.push(stepStr);
      continue;
    }

    stepLines.push(stepStr);
    lastMajorNum = majorNum;
  }

  let assembledCoT = stepLines.join('\n');

  // Narrative Metrics Analysis
  const metrics = await narrativeAnalyzer.getNarrativeMetrics(turnContext, 5);
  if (metrics) {
    Logger.log('Director', 'NarrativeMetrics', 'Analysis Summary:', null, {
      turnsAnalyzed: 5,
      pps: metrics.scores.PingPongScore.toFixed(2),
      mls: metrics.scores.MonologueScore.toFixed(2),
      dri: metrics.scores.DialogueRhythmIndex.toFixed(2),
      tar: metrics.metrics.TAR.toFixed(2),
      meanRL: metrics.metrics.MeanRL.toFixed(2),
      entropy: metrics.metrics.Entropy.toFixed(2)
    });
  }

  assembledCoT = assembledCoT.replace(/\$\{ping_pong_report\}|\{ping_pong_report\}/g, '');
  assembledCoT = assembledCoT
    .replace(/\$\{scene_boundary_strategy_label\}|\{scene_boundary_strategy_label\}/g, sceneBoundaryStrategyLabel)
    .replace(/\$\{scene_boundary_strategy_observation\}|\{scene_boundary_strategy_observation\}/g, sceneBoundaryStrategyObservation)
    .replace(/\$\{scene_boundary_strategy_writer_hint\}|\{scene_boundary_strategy_writer_hint\}/g, sceneBoundaryStrategyWriterHint)
    .replace(/\$\{capability_phase_history\}|\{capability_phase_history\}/g, capabilityPhaseHistory)
    .replace(/\$\{capability_registered_capabilities\}|\{capability_registered_capabilities\}/g, capabilityRegisteredCapabilities);

  // 3. Build ledger sections from native and structured plugin content.
  const ledgerText = assembleLedgerTemplate(nativeLedgerSections, director);

  // 4. Build output sections (native with override check + plugin additions)
  // (Output sections building removed for two-call caching)

  // 5. Get prompt data from promptBuilder
  const promptData = await promptBuilder.buildDirectorPromptData(turnContext);

  const notes = await factManager.getFormattedLedger('director', turnContext.projectName);

  const playerName = turnContext.input.playerCharacterName || 'Player';
  const canonData = [promptData.canon, ...(director.additionalInputs || [])].filter(item => typeof item === 'string' ? Boolean(item) : Boolean(item?.text)).map(item => typeof item === 'string' ? item : item.text).join('\n\n');
  const dynamicKnowledge = promptData.dynamicKnowledge;
  const simulationState = promptData.simulation;
  const privateHistory = promptData.history;

  const directorMonologueSection = directorMonologueFeedback ? `
# PART 6: PREVIOUS DIRECTOR MONOLOGUE
<previous_director_monologue>
${directorMonologueFeedback}
</previous_director_monologue>
` : '';

  const postWriterPacingAdvisorySection = postWriterPacingAdvisory ? `
# PART 7: POST-WRITER PACING ADVISORY
<post_writer_pacing_advisory>
${postWriterPacingAdvisory}
</post_writer_pacing_advisory>
` : '';

  const privateData = [
    formatDirectorPrivateSection('# DIRECTOR-PRIVATE CANON AND INPUTS', 'canon_data', canonData),
    formatDirectorPrivateSection('# DIRECTOR-PRIVATE DYNAMIC KNOWLEDGE', 'dynamic_knowledge', dynamicKnowledge),
    formatDirectorPrivateSection('# DIRECTOR-PRIVATE HISTORY', 'director_history', privateHistory),
    formatDirectorPrivateSection('# DIRECTOR-PRIVATE SIMULATION', 'director_state', simulationState),
    `# THE DIRECTOR'S LEDGER (YOUR MEMORY)
<director_ledger>
${notes || 'Empty.'}
</director_ledger>`,
    directorMonologueSection.trim(),
    postWriterPacingAdvisorySection.trim()
  ].filter(Boolean).join('\n\n');

  // The context message is decomposed into catalogue-attributed pieces for the
  // prepared composer. The joined contextMessage stays the behavioral string;
  // the pieces below must reproduce it exactly (same order, same separators).
  const taskText = `${systemPrompt.trim()}

The shared messages before this task contain the authoritative narrative foundation. Review that context and the Director-private data below, then produce strategic guidance for the Writer.
${privateData}`;
  const constraintsText = `<global_constraints>
PLAYER CHARACTER: ${playerName}
${promptData.directives}
</global_constraints>`;
  const inventoryIntentText = buildInventoryIntentSection(turnContext);
  const currentActionText = `# CURRENT ACTION
This is the latest player's input, and it will be hugely responsible for the events of this turn. So give it utmost importance.
However, if you find that the player's input contradicts and established truth, has irrealistic relational boundaries, or is otherwise illogical, hint the writer how it can be fixed without ignoring it out right. (E.g. a rejected action that causes a funny moment or even a misunderstanding that can make the characters be mad, like an improper flirt, attempting to use a flaming sword he never had, trying to cast magic that does not exist, etc)
<current_player_action>
${turnContext.input.userPrompt || 'No direct action provided.'}
</current_player_action>`;
  const contextParts = [
    `# AGENT TASK: DIRECTOR\n${taskText}`,
    constraintsText,
    inventoryIntentText,
    currentActionText
  ].filter(Boolean);
  const contextMessage = contextParts.join('\n\n');

  // Persist the exact Director user message so later CLI agents can reuse the
  // provider-cached prefix even after runtime-only prompt state is discarded.
  turnContext.processed.director = turnContext.processed.director || {};
  turnContext.processed.director.researchCacheContextMessage = contextMessage;
  turnContext.processed.director.researchCacheSharedPrefixHash = promptData.sharedPrefixHash;

  const analysisInstructions = `Now, execute your analysis and generate the output. Follow these instructions precisely.
<core_instructions>
IMPORTANT: THESE ARE THE INSTRUCTIONS ON WHAT YOU MUST DO:
[MANDATORY COGNITIVE FRAMEWORK (REACTIVE TURN ANALYSIS)]

${promptData.protocol}

${assembledCoT}
</core_instructions>

${outputAnalysis}`;

  // Call 1 sends this immediately after contextMessage. Persisting both lets
  // follower agents reproduce Director's complete cacheable request prefix.
  turnContext.processed.director.researchCacheAnalysisInstructions = analysisInstructions;

  // For turn 1 we just want the full ledger string so it gets built.
  // For turn 2+ we want them to use the UPDATE/INSERT protocol.
  const isFirstTurn = turnContext.turnNumber === 1;
  const ledgerInstructions = isFirstTurn
    ? `Great. Now, based on your analysis and the events of the last turn, output the director notes.\n\n[FINAL OUTPUT FORMAT]\nUse the format "--- DIRECTOR_NOTES ---". Inside the notes, use "### TITLE ---" for sections.\n--- DIRECTOR_NOTES ---\n${ledgerText}`
    : outputLedger.replace('${ledgerTemplate}', ledgerText);

  Logger.log('Director', 'Assembler', 'Director prompt assembled.', 'end');
  const promptObj = {
    sharedMessages: promptData.sharedMessages,
    sharedPrefixHash: promptData.sharedPrefixHash,
    sharedPrepared: null,
    taskText,
    contextBody: privateData,
    constraintsText,
    inventoryIntentText,
    currentActionText,
    contextMessage,
    analysisInstructions,
    ledgerInstructions
  };
  // Authoritative composer: the shared prefix IS the prepared result;
  // analysis composes from it directly. Diagnostics record the manifest.
  // The Prompt needs the live TurnContext for trusted include() resolution.
  promptObj.turnContext = turnContext;
  promptObj.sharedPrepared = await promptBuilder.getSharedPrefixPrepared(turnContext);
  const preparedDiagnostics = buildDirectorPreparedPrompts(promptObj);
  turnContext.processed.director = turnContext.processed.director || {};
  turnContext.processed.director.analysisPromptManifest = preparedDiagnostics?.analysis?.manifest || null;
  turnContext.processed.director.analysisPromptPrepared = preparedDiagnostics || null;
  turnContext.processed.director.analysisPromptPreparedHash = preparedDiagnostics?.analysis?.hash || null;
  return promptObj;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function toCamelCase(str) {
  return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
}

function parseDirectorSections(text) {
  const sections = {};
  if (typeof text !== 'string' || !text.trim()) return sections;

  const sectionRegex = /---\s*(.+?)\s*---\s*([\s\S]*?)(?=---\s*.+?\s*---|$)/g;
  let match;

  while ((match = sectionRegex.exec(text)) !== null) {
    const header = (match[1] || '').trim();
    const content = (match[2] || '').trim();
    const key = toCamelCase(header).replace(/_/g, '');
    sections[key] = content;
  }

  return sections;
}

function normalizeLedgerSectionId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatStructuredLedgerSection(section = {}) {
  const id = normalizeLedgerSectionId(section.id || section.title);
  const content = typeof section.content === 'string' ? section.content.trim() : '';
  if (!id || !content) return '';
  return `### ${id}\n${content}`;
}

function assembleLedgerTemplate(nativeSections = {}, directorRuntime = {}) {
  const assembledLedger = [];

  for (const [sectionId, section] of Object.entries(nativeSections)) {
    const override = directorRuntime.ledgerOverrides?.[sectionId];
    if (override === undefined || override !== '') {
      assembledLedger.push(`### ${section.label}\n${override || section.content}`);
    }
  }

  const structuredById = new Map();
  for (const section of (directorRuntime.ledgerSectionPatches || [])) {
    if (!section || typeof section !== 'object') continue;
    const id = normalizeLedgerSectionId(section.id || section.title);
    if (!id) continue;
    const formatted = formatStructuredLedgerSection(section);
    if (formatted) structuredById.set(id, formatted);
  }
  assembledLedger.push(...structuredById.values());

  for (const content of (directorRuntime.ledgerSections || [])) {
    if (typeof content !== 'string' || !content.trim()) continue;
    const match = content.match(/^### ([^\n]+)/);
    if (match) {
      assembledLedger.push(content.trim());
    } else {
      assembledLedger.push(`### CUSTOM_LEDGER\n${content.trim()}`);
    }
  }

  return assembledLedger.join('\n\n');
}

function queueLedgerUpdate(projectName, taskFactory) {
  const queueKey = projectName || '__default_project__';
  const previousTask = pendingLedgerUpdatesByProject.get(queueKey) || Promise.resolve();

  const queuedTask = previousTask
    .catch((error) => {
      Logger.warn(
        'Director',
        'LedgerQueue',
        `Previous async ledger task failed for project ${queueKey}. Continuing queue.`,
        { error: error?.message || String(error) }
      );
    })
    .then(taskFactory);

  let trackedTask = null;
  trackedTask = queuedTask.finally(() => {
    if (pendingLedgerUpdatesByProject.get(queueKey) === trackedTask) {
      pendingLedgerUpdatesByProject.delete(queueKey);
    }
  });

  pendingLedgerUpdatesByProject.set(queueKey, trackedTask);
  return trackedTask;
}

async function waitForPendingLedgerUpdate(projectName) {
  const queueKey = projectName || '__default_project__';
  const pendingTask = pendingLedgerUpdatesByProject.get(queueKey);
  if (!pendingTask) return;

  Logger.log(
    'Director',
    'LedgerQueue',
    `Waiting for previous async ledger update to finish for project ${queueKey} before new Director analysis...`
  );
  try {
    await pendingTask;
  } catch (error) {
    Logger.warn(
      'Director',
      'LedgerQueue',
      `Previous async ledger update failed while awaiting queue for project ${queueKey}. Continuing.`,
      { error: error?.message || String(error) }
    );
  }
}

// DELETED (cutover): buildDirectorAnalysisMessages / buildDirectorLedgerMessages
// — the composer IS the Director request now. Tests assert on prepared
// messages directly. Kept as throwing stubs so missed callers fail loudly.
function buildDirectorAnalysisMessages() {
  throw new Error('buildDirectorAnalysisMessages was removed in the prompt-model cutover; use buildDirectorPreparedPrompts().');
}

function buildDirectorLedgerMessages() {
  throw new Error('buildDirectorLedgerMessages was removed in the prompt-model cutover; use buildDirectorPreparedPrompts().');
}

/**
 * Prepared Director prompts: composes the exact analysis / ledger /
 * plugin-feedback requests through the annotated Prompt composer, reusing the
 * factored shared prefix byte-for-byte via usePrefix(). The analysis
 * response is model-generated content re-injected as context, attributed to
 * core.director.analysis_response with an origin link to the Analysis call.
 * Returns { analysis, ledger, feedback } prepared results, or null members
 * when the shared prefix parity gate failed (callers fall back to legacy
 * arrays and never claim unobserved provenance).
 */
function buildDirectorPreparedPrompts(promptObj, { analysisResponse = null, pluginInstructions = null } = {}) {
  // The shared prefix crosses the module boundary as plain JSON (stored on
  // processed state / passed in promptObj). Rehydrate it into a real
  // PreparedPrompt so usePrefix()/append() provenance stays trustworthy; a
  // stale or tampered copy throws here instead of logging false lineage.
  let sharedPrepared = null;
  try {
    const raw = promptObj.sharedPrepared || null;
    if (!raw || !raw.messages || !raw.manifest) return null;
    sharedPrepared = raw instanceof PreparedPrompt ? raw : PreparedPrompt.rehydrate(raw);
  } catch {
    return null;
  }

  const composeAnalysis = () => {
    const prompt = new Prompt({ id: 'core.director.analysis', turnContext: promptObj.turnContext || null });
    prompt.usePrefix(sharedPrepared);
    // Cache shape: the legacy contextMessage is ONE user message, so the
    // composer emits one user message whose container owns the '\n\n' joins
    // and each piece keeps its own catalogue identity inside it. Providers
    // that key prefix cache on message boundaries see the legacy shape.
    prompt.user(message => {
      message.add('core.director.context_message', container => {
        container.add('core.director.task', `# AGENT TASK: DIRECTOR\n${promptObj.taskText}`);
        container.add('core.director.context', promptObj.contextBody);
        container.add('core.director.constraints', promptObj.constraintsText);
        if (promptObj.inventoryIntentText) {
          container.add('core.director.inventory_intent', promptObj.inventoryIntentText);
        }
        container.add('core.director.current_action', promptObj.currentActionText);
      }, { separator: '\n\n' });
    });
    prompt.user(message => {
      message.add('core.director.analysis_instructions', promptObj.analysisInstructions);
    });
    return prompt.prepare();
  };

  const composeFollowup = (responseText, instructionsId, instructionsText) => {
    const analysis = composeAnalysis();
    const prompt = new Prompt({ id: 'core.director.followup', turnContext: promptObj.turnContext || null });
    prompt.append(analysis);
    prompt.assistant(message => {
      message.add('core.director.analysis_response', responseText);
    });
    prompt.user(message => {
      message.add(instructionsId, instructionsText);
    });
    return prompt.prepare();
  };

  const prepared = { analysis: null, ledger: null, feedback: null };
  prepared.analysis = composeAnalysis();
  if (analysisResponse != null) {
    prepared.ledger = composeFollowup(analysisResponse, 'core.director.ledger_instructions', promptObj.ledgerInstructions);
  }
  if (analysisResponse != null && pluginInstructions != null) {
    prepared.feedback = composeFollowup(analysisResponse, 'core.director.plugin_feedback_instructions', pluginInstructions);
  }
  return prepared;
}

/**
 * Shadow validation: the composer emits the legacy message layout
 * byte-for-byte — [shared..., ONE contextMessage, analysisInstructions] —
 * with per-piece provenance inside the single context message. Compares
 * one-for-one like the Writer gate. Returns the prepared result for
 * diagnostics, or null when it cannot be built.
 */
// DELETED (cutover): buildDirectorPreparedPromptShadow — the composer IS the
// Director request now; fixtures pin the prepared bytes directly.
function buildDirectorPreparedPromptShadow() {
  throw new Error('buildDirectorPreparedPromptShadow was removed in the prompt-model cutover.');
}

function extractDirectablePluginIds(promptObj = {}) {
  // Note: reads the joined contextMessage (behavioral string), not the
  // decomposed pieces — identical bytes, so extraction is unaffected.
  const text = [
    ...(promptObj.sharedMessages || []).map(message => message?.content),
    promptObj.contextMessage,
    promptObj.analysisInstructions
  ].filter(Boolean).join('\n');
  const ids = new Set();
  const pattern = /\bdirectable_plugin\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const pluginId = String(match[1] || '').trim();
    if (pluginId) ids.add(pluginId);
  }
  return [...ids];
}

// DELETED (cutover): buildDirectorPluginFeedbackMessages — feedback requests
// compose through buildDirectorPreparedPrompts({analysisResponse,
// pluginInstructions}).feedback. Callers needing the instruction text use
// buildDirectorPluginFeedbackInstructions() below.
function buildDirectorPluginFeedbackMessages() {
  throw new Error('buildDirectorPluginFeedbackMessages was removed in the prompt-model cutover; use buildDirectorPreparedPrompts().');
}

function buildDirectorPluginFeedbackInstructions(pluginIds) {
  return outputPluginFeedback.replace('${directablePluginIds}', pluginIds.join(', '));
}

function normalizeDirectorPluginFeedback(payload, pluginIds, turnNumber) {
  const allowedIds = new Set(pluginIds || []);
  const rawEntries = Array.isArray(payload?.plugin_feedback)
    ? payload.plugin_feedback
    : (Array.isArray(payload?.feedback) ? payload.feedback : []);
  const byPlugin = {};

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue;
    const pluginId = String(raw.plugin || raw.plugin_id || '').trim();
    if (!pluginId || !allowedIds.has(pluginId)) continue;
    const assessmentRaw = String(raw.assessment || raw.status || 'advisory').trim().toLowerCase();
    const assessment = ['aligned', 'advisory', 'concern'].includes(assessmentRaw) ? assessmentRaw : 'advisory';
    const feedback = String(raw.feedback || raw.opinion || raw.message || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!feedback) continue;
    byPlugin[pluginId] = { assessment, feedback };
  }

  return {
    schemaVersion: 1,
    sourceTurn: Number(turnNumber || 0),
    byPlugin
  };
}

async function runDeferredPluginFeedback(promptObj, config, analysisResponse, turnContext, pluginIds) {
  try {
    Logger.log('Director', 'PluginFeedback', `Starting async plugin feedback for turn ${turnContext.turnNumber}...`, 'start');
    const pluginInstructions = buildDirectorPluginFeedbackInstructions(pluginIds);
    // Prepared when the shared prefix gate passed: the feedback request
    // extends the observed analysis shape with the real response text.
    // expectJson stays orthogonal — it validates the response, not the input.
    const preparedFeedback = typeof analysisResponse === 'string'
      ? buildDirectorPreparedPrompts(promptObj, { analysisResponse, pluginInstructions })?.feedback || null
      : null;
    if (!preparedFeedback) {
      throw new Error('Director prepared plugin-feedback prompt unavailable; refusing to send an unattributed request.');
    }
    const { content, model, provider } = await runWithDiagnosticContext({
      executionLane: 'core_async',
      phase: 'Narrative',
      component: 'Director',
      taskKey: 'directorPluginFeedbackAsync',
      promptCachePrefixHash: promptObj.sharedPrefixHash,
      blocking: false
    }, async () => {
      return callLLM({
        prompt: preparedFeedback,
        model: config.THINKING_MODEL,
        provider: config.PROVIDER,
        retries: 0,
        timeout: config.PLUGIN_FEEDBACK_TIMEOUT,
        expectJson: true,
        extra: { ...config.LLM_PARAMS },
        callingModule: 'Background_Director_Plugin_Feedback_Async',
        turnLogTitle: 'Director (Plugin Feedback Async)'
      });
    });

    const normalized = normalizeDirectorPluginFeedback(content, pluginIds, turnContext.turnNumber);
    turnContext.processed.director.pluginFeedback = normalized;
    Logger.log(
      'Director',
      'PluginFeedback',
      `Async plugin feedback completed on model [${model}] via [${provider}] for ${Object.keys(normalized.byPlugin).length}/${pluginIds.length} plugin(s).`,
      'end'
    );
  } catch (error) {
    Logger.error('Director', 'PluginFeedback', `Async plugin feedback failed for turn ${turnContext.turnNumber}`, error);
  }
}

async function runDeferredLedgerUpdate(promptObj, config, analysisResponse, turnContext) {
  const { sharedPrefixHash } = promptObj;

  try {
    Logger.log(
      'Director',
      'Generation',
      `Starting async Director ledger update for turn ${turnContext.turnNumber}...`,
      'start'
    );

    // Prepared: extends the observed analysis shape with the real response
    // text as analysis_response.
    const preparedLedgerAsync = typeof analysisResponse === 'string'
      ? buildDirectorPreparedPrompts(promptObj, { analysisResponse })?.ledger || null
      : null;

    Logger.log('Director', 'Generation', `Sending async Ledger Update Request to ${config.THINKING_MODEL}...`);
    const { content: ledgerContent, model: resolvedModel2, provider: resolvedProvider2 } = await runWithDiagnosticContext({
      executionLane: 'core_async',
      phase: 'Narrative',
      component: 'Director',
      taskKey: 'directorLedgerAsync',
      promptCachePrefixHash: sharedPrefixHash,
      blocking: false
    }, async () => {
      if (!preparedLedgerAsync) {
        throw new Error('Director prepared async-ledger prompt unavailable; refusing to send an unattributed request.');
      }
      return callLLM({
        prompt: preparedLedgerAsync,
        model: config.THINKING_MODEL,
        provider: config.PROVIDER,
        // Background call: retries are retried silently (the road shows the
        // attempt count, not a blocking status), so a slow model can recover.
        retries: config.LEDGER_RETRIES,
        timeout: config.LEDGER_TIMEOUT,
        validationRegex: null,
        extra: { ...config.LLM_PARAMS },
        callingModule: 'Background_Ledger_Async',
        turnLogTitle: 'Director (Ledger Async)'
      });
    });

    const responseCall2 = typeof ledgerContent === 'string' ? ledgerContent.trim() : '';
    Logger.log(
      'Director',
      'Generation',
      `Async ledger call completed on model [${resolvedModel2}] via [${resolvedProvider2}].`,
      null,
      { responseLength: responseCall2.length }
    );
    const ledgerSections = parseDirectorSections(responseCall2);
    const ledgerOpsText = ledgerSections.directorNotes;

    if (ledgerOpsText) {
      Logger.log('Director', 'Lifecycle', `Applying async ledger operations for turn ${turnContext.turnNumber}...`);
      const ledgerResult = await factManager.processLedgerOperations(ledgerOpsText, turnContext.turnNumber, turnContext.projectName, 'director');
      if (ledgerResult?.applied === 0) {
        Logger.warn(
          'Director',
          'Lifecycle',
          `Async ledger response for turn ${turnContext.turnNumber} contained DIRECTOR_NOTES but no parseable ledger operations.`
        );
      }

      const resolvedLedger = await factManager.getFormattedLedger('director', turnContext.projectName);
      turnContext.processed.director.directorNotes = resolvedLedger;

      if (turnContext.processed.director.fullResponse && responseCall2) {
        turnContext.processed.director.fullResponse = `${turnContext.processed.director.fullResponse}\n\n${responseCall2}`;
      }

      await pluginManager.executeHook('HOOK_DIRECTOR_NOTES_PATCHED', turnContext);
    } else {
      Logger.warn('Director', 'Parsing', `Async ledger response for turn ${turnContext.turnNumber} contained no DIRECTOR_NOTES section.`);
    }

    Logger.log(
      'Director',
      'Generation',
      `Async Director ledger update finished for turn ${turnContext.turnNumber}.`,
      'end'
    );
  } catch (error) {
    Logger.error('Director', 'Generation', `Async Director ledger update failed for turn ${turnContext.turnNumber}`, error);
  }
}

/**
 * Internal function to handle the LLM call and parsing logic for director prompts.
 * @private
 * @param {string} prompt - The prompt to send to the LLM.
 * @returns {Promise<object>} An object containing the parsed sections.
 */
/**
 * Internal function to handle the LLM call and parsing logic for director prompts.
 * Now performs two consecutive calls to leverage caching.
 * @private
 * @param {object} promptObj - Object containing finalSystemPrompt, analysisInstructions, ledgerInstructions
 * @returns {Promise<object>} An object containing the parsed sections.
 */
async function _runDirectorLLM(promptObj, config, options = {}) {
  const { sharedMessages, sharedPrefixHash, contextMessage, analysisInstructions, ledgerInstructions } = promptObj;
  const skipLedgerCall = options.skipLedgerCall === true;

  // --- CALL 1: Core Analysis ---
  // Authoritative composer: prepared IS the request. No legacy array twin,
  // no manual logging (callLLM logs centrally with the manifest + callId).
  const preparedPrompts = buildDirectorPreparedPrompts(promptObj);
  const preparedAnalysis = preparedPrompts?.analysis || null;
  if (!preparedAnalysis) {
    throw new Error('Director prepared analysis prompt unavailable; refusing to send an unattributed request.');
  }

  Logger.log('Director', 'Generation', `Sending Analysis Request to ${config.THINKING_MODEL}...`, 'start');
  const { content: responseCall1 } = await runWithDiagnosticContext({
    executionLane: 'core',
    phase: 'Narrative',
    component: 'Director',
    taskKey: 'directorAnalysis',
    promptCachePrefixHash: sharedPrefixHash,
    blocking: true
  }, async () => {
    return callLLM({
      prompt: preparedAnalysis,
      model: config.THINKING_MODEL,
      provider: config.PROVIDER,
      retries: config.RETRIES,
      timeout: config.ANALYSIS_TIMEOUT,
      validationRegex: config.VALIDATION_REGEX,
      extra: { ...config.LLM_PARAMS },
      callingModule: 'Director_Analysis',
      turnLogTitle: 'Director (Analysis)'
    });
  });

  let responseCall2 = '';
  if (!skipLedgerCall) {
    Logger.log('Director', 'Generation', 'Received analysis feedback. Preparing Ledger request...');

    // --- CALL 2: Ledger Updates ---
    // Authoritative composer: extends the observed analysis shape with the
    // real response as core.director.analysis_response. No legacy twin.
    const preparedLedger = typeof responseCall1 === 'string'
      ? buildDirectorPreparedPrompts({ ...promptObj, sharedPrepared: promptObj.sharedPrepared }, { analysisResponse: responseCall1 })?.ledger || null
      : null;
    if (!preparedLedger) {
      throw new Error('Director prepared ledger prompt unavailable; refusing to send an unattributed request.');
    }

    Logger.log('Director', 'Generation', `Sending Ledger Update Request to ${config.THINKING_MODEL}...`);
    const { content: ledgerContent } = await runWithDiagnosticContext({
      executionLane: 'core',
      phase: 'Narrative',
      component: 'Director',
      taskKey: 'directorLedger',
      promptCachePrefixHash: sharedPrefixHash,
      blocking: true
    }, async () => {
      return callLLM({
        prompt: preparedLedger,
        model: config.THINKING_MODEL,
        provider: config.PROVIDER,
        retries: config.RETRIES,
        timeout: config.LEDGER_TIMEOUT,
        validationRegex: null, // Depending on validation needs
        extra: { ...config.LLM_PARAMS },
        callingModule: 'Director_Ledger',
        turnLogTitle: 'Director (Ledger)'
      });
    });

    responseCall2 = ledgerContent;
    Logger.log('Director', 'Generation', 'Received ledger feedback. Parsing unified response...');
  } else {
    Logger.log('Director', 'Generation', 'Deferring Director ledger generation to the async background queue; parsing analysis-only response for the writer path.');
  }

  // Combine both responses for parsing
  const combinedResponse = responseCall2 ? `${responseCall1}\n\n${responseCall2}` : responseCall1;
  const sections = parseDirectorSections(combinedResponse);

  if (Object.keys(sections).length === 0) {
    Logger.warn('Director', 'Parsing', 'LLM response was valid but no sections could be parsed. Using Call 1 response as writer\'s brief.');
    sections.writerBrief = responseCall1.trim();
  }

  const denyEvent = hasDenyEventDirective(combinedResponse);
  sections.gameplayHandoffWindow = {
    allowed: !denyEvent,
    excludedPhases: [],
    reason: denyEvent
      ? 'Director output included deny_event; dynamic event gameplay is disabled for this chapter.'
      : 'Core default: dynamic event opportunities are always available unless the WRITER_BRIEF says otherwise.',
    raw: ''
  };

  // Final scene phase is resolved later by VN blocking tasks (classifier + gating).
  delete sections.scenePhase;
  sections.scenePhase = 'NORMAL';
  sections.scenePluginId = null;

  sections.fullResponse = combinedResponse.trim();

  Logger.log('Director', 'Generation', 'Director run successful.', 'end');
  return sections;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Runs director for ongoing review. This is now the ONLY entry point.
 * @param {TurnContext} turnContext - The TurnContext for current turn.
 * @returns {Promise<object|null>} An object with feedback, or null if it shouldn't run or fails.
 */
async function runPeriodic(turnContext) {
  const config = getConfig();
  if (!config.ENABLED || turnContext.directorEnabled === false) {
    Logger.log('Director', 'Lifecycle', 'Director is disabled in settings or by context. Skipping review.');
    return;
  }

  Logger.log('Director', 'Lifecycle', 'Starting unified periodic review process...', 'start');
  try {
    await waitForPendingLedgerUpdate(turnContext.projectName);

    const promptObj = await createDirectorPrompt(turnContext, config);
    logSharedPrefixUsage(turnContext, 'Director', config.THINKING_MODEL, config.PROVIDER);

    if (typeof promptObj === 'string' && promptObj.startsWith("Not enough history")) {
      Logger.warn('Director', 'Lifecycle', promptObj);
      return;
    }

    const isInterludeScene = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
    const directablePluginIds = config.DIRECT_PLUGINS_ENABLED ? extractDirectablePluginIds(promptObj) : [];
    if (!config.DIRECT_PLUGINS_ENABLED) {
      Logger.log('Director', 'PluginFeedback', 'Director-to-plugin feedback is disabled in settings.');
    } else if (directablePluginIds.length === 0) {
      Logger.log('Director', 'PluginFeedback', 'No directable_plugin markers found; skipping plugin feedback call.');
    }
    if (isInterludeScene) {
      Logger.log('Director', 'Lifecycle', 'Interlude scene detected. Director ledger and plugin-feedback persistence are disabled for this run.');
    }

    // Keep call 1 (analysis + writer brief) on the critical path.
    // Ledger persistence and optional plugin feedback run asynchronously to reduce turn latency.
    const feedback = await _runDirectorLLM(promptObj, config, { skipLedgerCall: true });
    feedback.directorNotes = await factManager.getFormattedLedger('director', turnContext.projectName);

    if (!isInterludeScene) {
      const analysisResponse = feedback.fullResponse || feedback.writerBrief || '';
      queueLedgerUpdate(turnContext.projectName, async () => {
        const backgroundTasks = [runDeferredLedgerUpdate(promptObj, config, analysisResponse, turnContext)];
        if (directablePluginIds.length > 0) {
          backgroundTasks.push(runDeferredPluginFeedback(promptObj, config, analysisResponse, turnContext, directablePluginIds));
        }
        await Promise.all(backgroundTasks);
      });
      Logger.log(
        'Director',
        'Lifecycle',
        `Queued async ledger update${directablePluginIds.length > 0 ? ' and plugin feedback' : ''} for turn ${turnContext.turnNumber}; writer pipeline continues without waiting.`
      );
    }

    const registeredCapabilities = turnContext?.runtime?.director?.registeredCapabilities || [];
    const history = await turnContext.retrieveDatedChapters();
    const historyTurns = [...(history?.synopsischapters || []), ...(history?.summarychapters || []), ...(history?.fullchapters || [])];
    feedback.capabilityWriterGuidance = buildCapabilityWriterGuidance({
      registeredCapabilities,
      chapterHistory: historyTurns,
      currentTurnNumber: turnContext.turnNumber
    });
    Logger.log(
      'Director',
      'Orchestration',
      `Prepared dynamic event writer guidance (${feedback.capabilityWriterGuidance.entries.length} registered opportunities).`
    );

    // Dynamically assign all parsed sections to the turn context
    Object.assign(turnContext.processed.director, feedback);

    Logger.log('Director', 'Lifecycle', `Director feedback generated for turn ${turnContext.turnNumber}.`, 'end');

  } catch (error) {
    Logger.error('Director', 'Lifecycle', 'Director process failed', error);
  }
}

const exportedApi = {
  runPeriodic,
  runDirectorPrePromptHooks,
  getConfig,
  buildDirectorPreparedPrompts,
  buildDirectorPreparedPromptShadow,
  _test: {
    parseCoTSteps,
    assembleCotSteps,
    applyCotPatches,
    assembleLedgerTemplate,
    buildDirectorAnalysisMessages,
    buildDirectorLedgerMessages,
    buildDirectorPluginFeedbackMessages,
    buildDirectorPreparedPrompts,
    formatDirectorPrivateSection,
    extractDirectablePluginIds,
    normalizeDirectorPluginFeedback
  }
};

Object.defineProperty(exportedApi, 'CONFIG', {
  enumerable: true,
  get: () => getConfig()
});

module.exports = exportedApi;
