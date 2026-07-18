const { Logger, TurnLogger, settings, readFileSync } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');

const CONFIG = {
  ENABLED: settings.narrative_agents?.scene_phase_classifier?.enabled !== false,
  MODEL: settings.narrative_agents?.scene_phase_classifier?.model || 'mediumendmodel',
  RETRIES: settings.narrative_agents?.scene_phase_classifier?.retries || 2,
  TIMEOUT: settings.narrative_agents?.scene_phase_classifier?.timeout || 90000,
  MIN_CONFIDENCE: Number.isFinite(settings.narrative_agents?.scene_phase_classifier?.min_confidence)
    ? settings.narrative_agents.scene_phase_classifier.min_confidence
    : 0.62,
  REQUIRE_DIRECTOR_HANDOFF_WINDOW: settings.narrative_agents?.scene_phase_classifier?.require_director_handoff_window !== false,
  PROMPT_PATH: 'engine/prompts/scene_phase_classifier_prompt.txt',
  LLM_PARAMS: settings.narrative_agents?.scene_phase_classifier?.llm_params || {
    temperature: 0.1,
    max_tokens: 500
  }
};

const HISTORY_WINDOW_SIZE = 8;
const CAMP_OVERUSE_CONSECUTIVE_THRESHOLD = 2;
const CAMP_OVERUSE_RECENT_THRESHOLD = 3;
const GENERIC_OVERUSE_CONSECUTIVE_THRESHOLD = 2;
const GENERIC_OVERUSE_RECENT_THRESHOLD = 3;
const BLOCKED_CAMP_BOUNDARY_TYPES = new Set([
  'direct_present_character_request',
  'direct_immediate_task_request',
  'private_scene_continuation',
  'unresolved_active_beat'
]);
const BOUNDARY_TYPES = new Set([
  'none',
  'explicit_free_time_choice',
  'open_free_time_question',
  'soft_downtime_closure',
  'town_arrival_regroup',
  'direct_present_character_request',
  'direct_immediate_task_request',
  'private_scene_continuation',
  'unresolved_active_beat',
  'capability_boundary'
]);
const BOUNDARY_STRENGTHS = new Set(['none', 'weak', 'medium', 'strong']);
const INTERRUPTIBILITY_VALUES = new Set(['clear', 'awkward', 'blocked']);
const ADVISORY_SEVERITIES = new Set(['none', 'low', 'medium', 'high']);

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function mapPhaseToCapabilityKey(phase) {
  const token = normalizeToken(phase);
  if (!token) return '';
  if (token === 'combat') return 'combat';
  if (token === 'camp' || token === 'resting' || token === 'rest') return 'camp';
  if (token === 'travel' || token === 'travel_book' || token === 'travelbook') return 'travel_book';
  return token;
}

function clampConfidence(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function clampInteger(value, min, max, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function truncateText(value, maxChars = 420) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}...` : text;
}

function extractJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function getRegisteredCapabilities(turnContext) {
  const caps = turnContext?.runtime?.director?.registeredCapabilities;
  return Array.isArray(caps) ? caps : [];
}

function buildCapabilitiesByKey(registeredCapabilities) {
  const map = new Map();
  for (const cap of registeredCapabilities) {
    const key = mapPhaseToCapabilityKey(cap?.phase);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cap);
  }
  return map;
}

function normalizePluginId(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function resolveCapabilityChoice(capabilityKey, registeredCapabilities, requestedPluginId = '') {
  const byKey = buildCapabilitiesByKey(registeredCapabilities);
  const candidates = byKey.get(capabilityKey) || [];
  if (candidates.length === 0) return null;

  const normalizedRequested = normalizePluginId(requestedPluginId);
  if (normalizedRequested) {
    const exactMatch = candidates.find(candidate => normalizePluginId(candidate?.pluginId) === normalizedRequested);
    if (exactMatch) return { capability: exactMatch, source: 'requested' };
  }

  if (candidates.length === 1) {
    return { capability: candidates[0], source: 'single_candidate' };
  }

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return { capability: candidates[randomIndex], source: normalizedRequested ? 'fallback_random_invalid_request' : 'fallback_random' };
}

function hasDenyEventDirective(turnContext) {
  const director = turnContext?.processed?.director || {};
  const writerBrief = typeof director.writerBrief === 'string' ? director.writerBrief : '';
  if (/\bdeny_event\b/i.test(writerBrief)) return true;

  const fullResponse = typeof director.fullResponse === 'string' ? director.fullResponse : '';
  const writerBriefMatch = fullResponse.match(/---\s*WRITER_BRIEF\s*---([\s\S]*)$/i);
  if (writerBriefMatch && /\bdeny_event\b/i.test(writerBriefMatch[1] || '')) return true;

  return /\bdeny_event\b/i.test(String(director.gameplayHandoffWindow?.reason || ''));
}

function extractTurnCapabilityKey(chapter) {
  const classifierResolved = mapPhaseToCapabilityKey(chapter?.processed?.scenePhaseClassifier?.resolvedPhase);
  if (classifierResolved) return classifierResolved;

  const directorPhase = mapPhaseToCapabilityKey(chapter?.processed?.director?.scenePhase);
  if (directorPhase) return directorPhase;

  const classifierCapability = mapPhaseToCapabilityKey(chapter?.processed?.scenePhaseClassifier?.capability);
  if (classifierCapability) return classifierCapability;

  return '';
}

function getTurnTitle(chapter) {
  return truncateText(chapter?.output?.title || chapter?.title || chapter?.output?.abstractTitle || chapter?.abstractTitle || '', 120);
}

function getTurnSummary(chapter) {
  return truncateText(
    chapter?.output?.synopsis ||
    chapter?.synopsis ||
    chapter?.output?.summary ||
    chapter?.summary ||
    chapter?.postContent?.userInputInjection ||
    '',
    360
  );
}

function sanitizeDirectorAdvisory(raw = {}) {
  const severityToken = normalizeToken(raw?.severity || 'none');
  const severity = ADVISORY_SEVERITIES.has(severityToken) ? severityToken : 'none';
  const message = truncateText(raw?.message || '', 520);

  if (severity === 'none' || !message) {
    return {
      severity: 'none',
      capability: '',
      topic: '',
      message: '',
      expiresAfterTurns: 0
    };
  }

  return {
    severity,
    capability: mapPhaseToCapabilityKey(raw?.capability || '') || normalizeToken(raw?.capability || ''),
    topic: normalizeToken(raw?.topic || 'capability_pacing') || 'capability_pacing',
    message,
    expiresAfterTurns: clampInteger(raw?.expires_after_turns ?? raw?.expiresAfterTurns, 1, 4, 2)
  };
}

function buildCapabilityCadence(capabilityKey, recentTurns = [], currentTurnNumber = null) {
  const normalizedKey = mapPhaseToCapabilityKey(capabilityKey);
  const turns = Array.isArray(recentTurns) ? recentTurns.slice(0, HISTORY_WINDOW_SIZE) : [];
  let recentCount = 0;
  let consecutiveCount = 0;
  let turnsSinceLast = null;

  for (let index = 0; index < turns.length; index += 1) {
    const chapter = turns[index];
    const turnKey = extractTurnCapabilityKey(chapter);
    if (turnKey === normalizedKey) {
      recentCount += 1;
      if (turnsSinceLast === null) {
        const turnNumber = Number(chapter?.turnNumber);
        turnsSinceLast = Number.isFinite(currentTurnNumber) && Number.isFinite(turnNumber)
          ? Math.max(0, currentTurnNumber - turnNumber)
          : index + 1;
      }
    }

    if (index === consecutiveCount && turnKey === normalizedKey) {
      consecutiveCount += 1;
    }
  }

  const overused = consecutiveCount >= GENERIC_OVERUSE_CONSECUTIVE_THRESHOLD ||
    recentCount >= GENERIC_OVERUSE_RECENT_THRESHOLD;

  return {
    capabilityKey: normalizedKey || '',
    recentCount,
    consecutiveCount,
    turnsSinceLast,
    overused: normalizedKey === 'camp' ? (
      consecutiveCount >= CAMP_OVERUSE_CONSECUTIVE_THRESHOLD ||
      recentCount >= CAMP_OVERUSE_RECENT_THRESHOLD
    ) : overused
  };
}

function getCadenceStatus(entry = {}) {
  if (entry.overused) return 'overused';
  if (entry.turnsSinceLast === null || Number(entry.turnsSinceLast) > 5) return 'underused';
  if (Number(entry.turnsSinceLast) <= 2) return 'fresh';
  return 'healthy';
}

function getCapabilityTemperature(cadence) {
  const turnsSinceLast = Number.isFinite(cadence?.turnsSinceLast) ? cadence.turnsSinceLast : null;
  if (turnsSinceLast !== null && turnsSinceLast <= 2) {
    return {
      temperature: 'hot',
      pacingBias: 'slightly_suppress',
      note: 'Activated very recently; repeat only when the boundary is clearly right, but do not block a strong organic fit.'
    };
  }
  if (turnsSinceLast !== null && turnsSinceLast <= 5) {
    return {
      temperature: 'warm',
      pacingBias: 'neutral',
      note: 'Activated recently enough that cadence is healthy; allow if the scene organically fits.'
    };
  }
  return {
    temperature: 'cold',
    pacingBias: 'slightly_encourage',
    note: 'Underused or not seen in the available window; lower hesitation if the scene organically fits, but do not force it.'
  };
}

function buildCapabilityTemperatureEntries(registeredCapabilities = [], recentTurns = [], currentTurnNumber = null) {
  const keys = new Set((registeredCapabilities || [])
    .map(cap => mapPhaseToCapabilityKey(cap?.phase))
    .filter(Boolean));

  return Array.from(keys).sort().map(key => {
    const cadence = buildCapabilityCadence(key, recentTurns, currentTurnNumber);
    const temperature = getCapabilityTemperature(cadence);
    return {
      capability: key,
      turnsSinceLast: cadence.turnsSinceLast,
      temperature: temperature.temperature,
      pacingBias: temperature.pacingBias,
      note: temperature.note,
      recentCount: cadence.recentCount,
      consecutiveCount: cadence.consecutiveCount,
      overused: cadence.overused,
      cadenceStatus: getCadenceStatus(cadence)
    };
  });
}

function buildCadenceReport(registeredCapabilities, recentTurns = [], currentTurnNumber = null) {
  const entries = buildCapabilityTemperatureEntries(registeredCapabilities, recentTurns, currentTurnNumber);

  if (entries.length === 0) return 'No registered capabilities to analyze.';

  return entries.map(entry => {
    const turnsSince = entry.turnsSinceLast === null ? 'never in window' : `${entry.turnsSinceLast} turn(s) ago`;
    return `- ${entry.capability}: turns_since_last=${turnsSince}, cadence_status=${entry.cadenceStatus}, temperature=${entry.temperature}, pacing_bias=${entry.pacingBias}, recent_count=${entry.recentCount}, consecutive_count=${entry.consecutiveCount}, overused=${entry.overused ? 'YES' : 'NO'}, note=${entry.note}`;
  }).join('\n');
}

function buildPriorAdvisoriesText(recentTurns = [], currentTurnNumber = null) {
  const lines = [];
  for (const chapter of recentTurns) {
    const advisory = sanitizeDirectorAdvisory(chapter?.processed?.scenePhaseClassifier?.directorAdvisory);
    if (advisory.severity === 'none') continue;

    const turnNumber = Number(chapter?.turnNumber);
    const age = Number.isFinite(currentTurnNumber) && Number.isFinite(turnNumber)
      ? currentTurnNumber - turnNumber
      : 1;
    if (age < 0 || age > advisory.expiresAfterTurns) continue;

    lines.push(`- Turn ${chapter.turnNumber}: [${advisory.severity}] ${advisory.capability || 'capability'} / ${advisory.topic}: ${advisory.message}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'None.';
}

async function buildHistoryContext(turnContext) {
  try {
    if (typeof turnContext?.retrieveDatedChapters !== 'function') {
      return {
        recentTurns: [],
        historySummary: 'Unavailable.',
        narrativeContext: 'Unavailable.',
        priorAdvisories: 'Unavailable.'
      };
    }
    const history = await turnContext.retrieveDatedChapters();
    const all = [...(history?.synopsischapters || []), ...(history?.summarychapters || []), ...(history?.fullchapters || [])]
      .sort((a, b) => b.turnNumber - a.turnNumber)
      .slice(0, HISTORY_WINDOW_SIZE);
    if (all.length === 0) {
      return {
        recentTurns: [],
        historySummary: 'No prior turns.',
        narrativeContext: 'No prior turns.',
        priorAdvisories: 'None.'
      };
    }

    const historySummary = all.map(t => {
      const phase = t?.processed?.director?.scenePhase || 'NORMAL';
      const plugin = t?.processed?.director?.scenePluginId ? ` via ${t.processed.director.scenePluginId}` : '';
      return `Turn ${t.turnNumber}: ${phase}${plugin}`;
    }).join('\n');

    const narrativeContext = all.map(t => {
      const phase = t?.processed?.director?.scenePhase || 'NORMAL';
      const plugin = t?.processed?.director?.scenePluginId ? ` via ${t.processed.director.scenePluginId}` : '';
      const title = getTurnTitle(t);
      const summary = getTurnSummary(t);
      return [
        `Turn ${t.turnNumber}: ${phase}${plugin}`,
        title ? `Title: ${title}` : '',
        summary ? `Summary: ${summary}` : ''
      ].filter(Boolean).join(' | ');
    }).join('\n');

    return {
      recentTurns: all,
      historySummary,
      narrativeContext,
      priorAdvisories: buildPriorAdvisoriesText(all, Number(turnContext?.turnNumber))
    };
  } catch (error) {
    Logger.warn('ScenePhaseClassifier', 'History', `Failed to collect phase history: ${error.message}`);
    return {
      recentTurns: [],
      historySummary: 'Unavailable.',
      narrativeContext: 'Unavailable.',
      priorAdvisories: 'Unavailable.'
    };
  }
}

function buildPrompt(turnContext, registeredCapabilities, historyContext) {
  let template = readFileSync(CONFIG.PROMPT_PATH) || '';
  const chapterText = turnContext?.processed?.narrativeEngine?.writerResponse || '';
  const handoffWindow = turnContext?.processed?.director?.gameplayHandoffWindow || {};
  const excludedPhases = Array.isArray(handoffWindow.excludedPhases) && handoffWindow.excludedPhases.length > 0
    ? handoffWindow.excludedPhases.join(', ')
    : 'NONE';

  const capabilitiesText = registeredCapabilities.map((cap, idx) => (
    `${idx + 1}) phase=${cap.phase || 'UNKNOWN'} | plugin=${cap.pluginId || 'UNKNOWN'} | description=${cap.description || 'n/a'}${cap.handoffHint ? ` | handoff_hint=${cap.handoffHint}` : ''}`
  )).join('\n');
  const dynamicDefinitionsText = buildDynamicDefinitionsText(turnContext);
  const currentTurnNumber = Number(turnContext?.turnNumber);
  const cadenceReport = buildCadenceReport(registeredCapabilities, historyContext?.recentTurns || [], currentTurnNumber);
  const writerBrief = truncateText(turnContext?.processed?.director?.writerBrief || '', 2400) || 'None.';

  template = template
    .replace('${registered_capabilities}', capabilitiesText || 'None.')
    .replace('${dynamic_phase_classifier_definitions}', dynamicDefinitionsText)
    .replace('${director_handoff_window}', `allow=${handoffWindow.allowed === true ? 'YES' : 'NO'} | excluded_phases=${excludedPhases} | reason=${handoffWindow.reason || 'n/a'}`)
    .replace('${scene_phase_history}', historyContext?.historySummary || 'Unavailable.')
    .replace('${narrative_context}', historyContext?.narrativeContext || 'Unavailable.')
    .replace('${capability_cadence_report}', cadenceReport)
    .replace('${previous_director_advisories}', historyContext?.priorAdvisories || 'None.')
    .replace('${writer_brief}', writerBrief)
    .replace(
      '${chapter_text}',
      chapterText ? 'Use CURRENT WRITER CHAPTER from the shared VN scene capsule above.' : 'No chapter text.'
    );

  return template;
}

function buildDefaultResult() {
  return {
    capability: 'none',
    requestedPluginId: null,
    confidence: 0,
    isHandoff: false,
    boundaryExcerpt: '',
    reason: '',
    repetitionRisk: 'low',
    repetitionNote: '',
    boundaryType: 'none',
    boundaryStrength: 'none',
    interruptibility: 'clear',
    currentEngagement: '',
    cadence: {
      capabilityKey: '',
      recentCount: 0,
      consecutiveCount: 0,
      turnsSinceLast: null,
      overused: false
    },
    capabilityTemperature: [],
    directorAdvisory: {
      severity: 'none',
      capability: '',
      topic: '',
      message: '',
      expiresAfterTurns: 0
    },
    gatingNotes: [],
    resolvedPhase: 'NORMAL',
    resolvedPluginId: null
  };
}

function getRuntimeDefinitionAddenda(turnContext) {
  const addenda = turnContext?.runtime?.scenePhaseClassifier?.definitionAddenda;
  if (!Array.isArray(addenda)) return [];
  return addenda
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { phase: '', pluginId: '', text } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text) return null;
      const phase = typeof entry.phase === 'string' ? entry.phase.trim().toUpperCase() : '';
      const pluginId = typeof entry.pluginId === 'string' ? entry.pluginId.trim() : '';
      return { phase, pluginId, text };
    })
    .filter(Boolean);
}

function buildDynamicDefinitionsText(turnContext) {
  const addenda = getRuntimeDefinitionAddenda(turnContext);
  if (addenda.length === 0) return 'None.';

  return addenda.map((entry, idx) => {
    const parts = [];
    if (entry.phase) parts.push(`phase=${entry.phase}`);
    if (entry.pluginId) parts.push(`plugin=${entry.pluginId}`);
    const head = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
    return `${idx + 1})${head} ${entry.text}`;
  }).join('\n');
}

function normalizeBoundaryType(value) {
  const token = normalizeToken(value || 'none');
  return BOUNDARY_TYPES.has(token) ? token : 'none';
}

function normalizeBoundaryStrength(value) {
  const token = normalizeToken(value || 'none');
  return BOUNDARY_STRENGTHS.has(token) ? token : 'none';
}

function normalizeInterruptibility(value) {
  const token = normalizeToken(value || 'clear');
  return INTERRUPTIBILITY_VALUES.has(token) ? token : 'clear';
}

function sanitizeCapabilityTemperatureEntries(rawEntries = [], registeredCapabilities = [], recentTurns = [], currentTurnNumber = null) {
  const fallbackEntries = buildCapabilityTemperatureEntries(registeredCapabilities, recentTurns, currentTurnNumber);
  const fallbackByKey = new Map(fallbackEntries.map(entry => [entry.capability, entry]));
  const rawList = Array.isArray(rawEntries) ? rawEntries : [];
  const out = [];
  const seen = new Set();

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const capability = mapPhaseToCapabilityKey(raw.capability || '') || normalizeToken(raw.capability || '');
    if (!capability || seen.has(capability)) continue;
    const fallback = fallbackByKey.get(capability) || {};
    const rawTemperature = normalizeToken(raw.temperature || '');
    const rawBias = normalizeToken(raw.pacing_bias || raw.pacingBias || '');
    const temperature = ['hot', 'warm', 'cold'].includes(rawTemperature)
      ? rawTemperature
      : (fallback.temperature || 'cold');
    const pacingBias = ['slightly_suppress', 'neutral', 'slightly_encourage'].includes(rawBias)
      ? rawBias
      : (fallback.pacingBias || 'neutral');

    out.push({
      capability,
      turnsSinceLast: Number.isFinite(Number(raw.turns_since_last ?? raw.turnsSinceLast))
        ? Number(raw.turns_since_last ?? raw.turnsSinceLast)
        : (fallback.turnsSinceLast ?? null),
      temperature,
      pacingBias,
      note: truncateText(raw.note || fallback.note || '', 240),
      recentCount: Number.isFinite(Number(raw.recent_count ?? raw.recentCount))
        ? Number(raw.recent_count ?? raw.recentCount)
        : (fallback.recentCount ?? 0),
      consecutiveCount: Number.isFinite(Number(raw.consecutive_count ?? raw.consecutiveCount))
        ? Number(raw.consecutive_count ?? raw.consecutiveCount)
        : (fallback.consecutiveCount ?? 0),
      overused: raw.overused === true || raw.overused === 'true' || raw.overused === 'YES' || fallback.overused === true
    });
    seen.add(capability);
  }

  for (const fallback of fallbackEntries) {
    if (!seen.has(fallback.capability)) out.push(fallback);
  }

  return out;
}

function ensureDirectorAdvisory(result, { severity = 'medium', capability = '', topic = 'capability_pacing', message = '', expiresAfterTurns = 2 } = {}) {
  if (result.directorAdvisory?.severity !== 'none' && result.directorAdvisory?.message) return;
  result.directorAdvisory = sanitizeDirectorAdvisory({
    severity,
    capability: capability || result.capability,
    topic,
    message,
    expiresAfterTurns
  });
}

function populateResultFromParsedEvaluation(result, parsed, historyContext = {}, currentTurnNumber = null, registeredCapabilities = []) {
  const capabilityKey = mapPhaseToCapabilityKey(parsed.capability || 'none') || 'none';
  const requestedPluginId = normalizePluginId(parsed.plugin_id || parsed.pluginId || '');
  const isHandoff = parsed.is_handoff === true || parsed.isHandoff === true;
  const confidence = clampConfidence(parsed.confidence);
  const boundaryExcerpt = typeof parsed.boundary_excerpt === 'string'
    ? parsed.boundary_excerpt.trim().slice(0, 220)
    : (typeof parsed.boundaryExcerpt === 'string' ? parsed.boundaryExcerpt.trim().slice(0, 220) : '');

  result.capability = capabilityKey;
  result.requestedPluginId = requestedPluginId || null;
  result.confidence = confidence;
  result.isHandoff = isHandoff && capabilityKey !== 'none';
  result.boundaryExcerpt = boundaryExcerpt;
  result.reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  result.repetitionRisk = ['low', 'medium', 'high'].includes(parsed.repetition_risk)
    ? parsed.repetition_risk
    : (['low', 'medium', 'high'].includes(parsed.repetitionRisk) ? parsed.repetitionRisk : 'low');
  result.repetitionNote = typeof parsed.repetition_note === 'string'
    ? parsed.repetition_note.trim()
    : (typeof parsed.repetitionNote === 'string' ? parsed.repetitionNote.trim() : '');
  result.boundaryType = normalizeBoundaryType(parsed.boundary_type || parsed.boundaryType);
  result.boundaryStrength = normalizeBoundaryStrength(parsed.boundary_strength || parsed.boundaryStrength);
  result.interruptibility = normalizeInterruptibility(parsed.interruptibility);
  result.currentEngagement = truncateText(parsed.current_engagement || parsed.currentEngagement || '', 360);
  result.cadence = buildCapabilityCadence(capabilityKey, historyContext?.recentTurns || [], Number(currentTurnNumber));
  result.capabilityTemperature = sanitizeCapabilityTemperatureEntries(
    parsed.capability_temperature || parsed.capabilityTemperature,
    registeredCapabilities,
    historyContext?.recentTurns || [],
    Number(currentTurnNumber)
  );
  result.directorAdvisory = sanitizeDirectorAdvisory(parsed.director_advisory || parsed.directorAdvisory);

  return result;
}

function getCampBlockReason(result) {
  if (result.capability !== 'camp') return '';

  if (BLOCKED_CAMP_BOUNDARY_TYPES.has(result.boundaryType)) {
    return `Camp handoff blocked: boundary type "${result.boundaryType}" is a mainline continuation, not broad optional downtime.`;
  }

  if (result.interruptibility === 'blocked') {
    return 'Camp handoff blocked: current scene engagement is not safely interruptible.';
  }

  if (
    result.cadence?.overused &&
    result.boundaryStrength !== 'strong'
  ) {
    return 'Camp handoff blocked: camp/rest is overused in recent turns and this is not a strong free-time boundary.';
  }

  return '';
}

function applyDeterministicHandoffResolution(result, {
  registeredCapabilities = [],
  excludedCapabilityKeys = new Set(),
  minConfidence = CONFIG.MIN_CONFIDENCE
} = {}) {
  if (!result.isHandoff) {
    result.gatingNotes.push('Classifier did not request a handoff.');
    return result;
  }

  if (result.confidence < minConfidence) {
    result.gatingNotes.push(`Confidence ${result.confidence.toFixed(2)} below threshold ${minConfidence.toFixed(2)}.`);
    return result;
  }

  const chosenCapabilityResult = resolveCapabilityChoice(result.capability, registeredCapabilities, result.requestedPluginId);
  if (!chosenCapabilityResult || !chosenCapabilityResult.capability) {
    result.gatingNotes.push(`No registered capability matches classifier result "${result.capability}".`);
    return result;
  }

  if (excludedCapabilityKeys.has(result.capability)) {
    result.gatingNotes.push(`Director handoff window excluded "${result.capability}".`);
    return result;
  }

  const campBlockReason = getCampBlockReason(result);
  if (campBlockReason) {
    result.isHandoff = false;
    result.resolvedPhase = 'NORMAL';
    result.resolvedPluginId = null;
    result.gatingNotes.push(campBlockReason);
    ensureDirectorAdvisory(result, {
      severity: result.cadence?.overused ? 'medium' : 'low',
      capability: 'camp',
      topic: result.cadence?.overused ? 'camp_overuse' : 'camp_interruptibility',
      message: result.cadence?.overused
        ? 'Camp/rest has been used repeatedly in recent turns. Consider steering toward concrete local action, consequence, or renewed urgency unless the player explicitly seeks broad downtime.'
        : 'A potential camp/rest moment was blocked because the chapter ended inside an active or private mainline beat. Let that beat resolve before opening optional downtime.',
      expiresAfterTurns: 2
    });
    return result;
  }

  const chosenCapability = chosenCapabilityResult.capability;
  result.resolvedPhase = (chosenCapability.phase || 'NORMAL').toUpperCase();
  result.resolvedPluginId = chosenCapability.pluginId || null;
  if (result.requestedPluginId && chosenCapabilityResult.source === 'fallback_random_invalid_request') {
    result.gatingNotes.push(`Classifier requested unknown plugin "${result.requestedPluginId}". Falling back to a random active "${result.capability}" plugin.`);
  } else if (chosenCapabilityResult.source === 'fallback_random') {
    result.gatingNotes.push(`Multiple "${result.capability}" plugins are active; selected one at random as safe default.`);
  }
  result.gatingNotes.push(`Handoff approved: ${result.resolvedPhase} via ${result.resolvedPluginId || 'unknown-plugin'}.`);
  return result;
}

function normalizeEvaluatorLlmParams(params = {}) {
  const merged = { ...params };
  const maxTokens = Number(merged.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens < 900) merged.max_tokens = 900;
  return merged;
}

async function classifyScenePhaseHandoff(turnContext) {
  const result = buildDefaultResult();

  if (!CONFIG.ENABLED) {
    result.gatingNotes.push('Classifier disabled in settings.');
    return result;
  }

  const registeredCapabilities = getRegisteredCapabilities(turnContext);
  if (registeredCapabilities.length === 0) {
    result.gatingNotes.push('No registered capabilities for this turn.');
    return result;
  }

  const chapterText = turnContext?.processed?.narrativeEngine?.writerResponse || '';
  if (!chapterText.trim()) {
    result.gatingNotes.push('Writer output is empty.');
    return result;
  }

  const handoffWindow = turnContext?.processed?.director?.gameplayHandoffWindow || {};
  const directorAllowsHandoff = handoffWindow.allowed === true;
  const excludedCapabilityKeys = new Set(
    (Array.isArray(handoffWindow.excludedPhases) ? handoffWindow.excludedPhases : [])
      .map(mapPhaseToCapabilityKey)
      .filter(Boolean)
  );

  if (hasDenyEventDirective(turnContext)) {
    result.gatingNotes.push('Director included deny_event; dynamic event gameplay disabled for this chapter.');
    return result;
  }

  if (CONFIG.REQUIRE_DIRECTOR_HANDOFF_WINDOW && !directorAllowsHandoff) {
    result.gatingNotes.push('Director did not open a handoff window.');
    return result;
  }

  try {
    const historyContext = await buildHistoryContext(turnContext);
    const prompt = buildPrompt(turnContext, registeredCapabilities, historyContext);
    const messages = buildCoreVnLlmMessages(turnContext, prompt);

    Logger.log('ScenePhaseClassifier', 'Request', `Classifying handoff with ${registeredCapabilities.length} registered capabilities...`, 'start');
    TurnLogger.logRequest('Scene Phase Classifier', messages, CONFIG.MODEL, resolveModelAlias(CONFIG.MODEL).provider);

    const { content: responseContent, model: resolvedModel } = await callLLM({
      model: CONFIG.MODEL,
      provider: resolveModelAlias(CONFIG.MODEL).provider,
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      validationRegex: /"capability"\s*:/i,
      messages,
      ...normalizeEvaluatorLlmParams(CONFIG.LLM_PARAMS),
      callingModule: 'ScenePhaseClassifier',
      turnLogTitle: 'Scene Phase Classifier'
    });

    TurnLogger.logResponse('Scene Phase Classifier', responseContent, resolvedModel, resolveModelAlias(CONFIG.MODEL).provider);

    const rawJson = extractJsonObject(responseContent);
    if (!rawJson) {
      result.gatingNotes.push('Classifier output did not contain a JSON object.');
      Logger.warn('ScenePhaseClassifier', 'Parsing', 'No JSON object found in classifier response.');
      return result;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      result.gatingNotes.push(`Classifier JSON parse failed: ${error.message}`);
      Logger.warn('ScenePhaseClassifier', 'Parsing', `JSON parse failed: ${error.message}`);
      return result;
    }

    populateResultFromParsedEvaluation(result, parsed, historyContext, turnContext?.turnNumber, registeredCapabilities);
    applyDeterministicHandoffResolution(result, {
      registeredCapabilities,
      excludedCapabilityKeys,
      minConfidence: CONFIG.MIN_CONFIDENCE
    });

    Logger.log('ScenePhaseClassifier', 'Decision', `Resolved handoff: ${result.resolvedPhase} via ${result.resolvedPluginId}`, 'end');
    return result;
  } catch (error) {
    Logger.error('ScenePhaseClassifier', 'Execution', 'Scene phase classification failed:', error);
    result.gatingNotes.push(`Classifier error: ${error.message}`);
    return result;
  }
}

module.exports = {
  classifyScenePhaseHandoff,
  CONFIG,
  _private: {
    applyDeterministicHandoffResolution,
    buildCapabilityCadence,
    buildCadenceReport,
    buildCapabilityTemperatureEntries,
    buildDefaultResult,
    buildHistoryContext,
    buildPriorAdvisoriesText,
    buildPrompt,
    extractTurnCapabilityKey,
    populateResultFromParsedEvaluation,
    sanitizeDirectorAdvisory
  }
};
