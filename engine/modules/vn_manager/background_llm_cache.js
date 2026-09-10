const crypto = require('crypto');
const { readSettings } = require('../utils.js');
const cancellation = require('../pipeline_cancellation.js');
const { resolveModelAlias } = require('../llm.js');

const SHARED_MODEL_INHERITANCE = 'vn_background';
const DEFAULT_MODEL = 'highendmodel';
const DEFAULT_FOLLOWER_DELAY_MS = 5000;

const BACKGROUND_SYSTEM_PROMPT = `You are a specialist performing post-turn analysis for a narrative engine.
The next message is an immutable shared context capsule. Treat it as authoritative common context.
Follow the final task-specific message for your responsibility, constraints, and output format.`;

function joinSlot(slot) {
  if (Array.isArray(slot)) return slot.filter(Boolean).join('\n\n');
  return typeof slot === 'string' ? slot : '';
}

function buildFinalDialogue(turnContext) {
  const lines = Array.isArray(turnContext?.processed?.vnManager?.processedLines)
    ? turnContext.processed.vnManager.processedLines
    : [];
  return lines
    .map((line, index) => `[Line ${index}] ${line?.character || 'Narrator'}: ${line?.text || line?.line || ''}`)
    .filter(line => !/^\[Line \d+\]\s+[^:]+:\s*$/.test(line))
    .join('\n');
}

function buildSceneMessage(turnContext, scene = 'none') {
  switch (scene) {
    case 'raw':
      return `=== CURRENT WRITER CHAPTER ===\n${turnContext?.processed?.narrativeEngine?.writerResponse || '(empty)'}`;
    case 'numbered':
      return `=== CURRENT NUMBERED SCENE ===\n${buildFinalDialogue(turnContext) || '(empty)'}`;
    case 'dialogue': {
      const dialogue = (turnContext?.processed?.vnManager?.processedLines || [])
        .filter(line => line?.type === 'dialogue')
        .map((line, index) => `[Dialogue ${index}] ${line?.character || 'Unknown'}: ${line?.text || line?.line || ''}`)
        .join('\n');
      return `=== CURRENT DIALOGUE-ONLY SCENE ===\n${dialogue || '(empty)'}`;
    }
    case 'none':
    case undefined:
    case null:
      return '';
    default:
      throw new Error(`Unknown VN background scene mode '${scene}'.`);
  }
}

function buildBackgroundCapsule(turnContext) {
  const root = turnContext?.promptComponents?.root || {};
  const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
  return `=== SHARED VN BACKGROUND CONTEXT ===
PROJECT: ${turnContext?.projectName || 'Unknown'}
TURN: ${turnContext?.turnNumber || 0}
PLAYER: ${turnContext?.input?.playerCharacterName || 'Player'}
PARTY: ${party.join(', ') || '(none)'}

CURRENT USER INPUT:
${turnContext?.input?.userPrompt || '(none)'}

DIRECTOR BRIEF:
${turnContext?.processed?.director?.writerBrief || '(none)'}

SELECTED CANON:
${joinSlot(root.canon) || '(none)'}

SELECTED DYNAMIC KNOWLEDGE:
${joinSlot(root.dynamic_knowledge) || '(none)'}

CURRENT SIMULATION CONTEXT:
${joinSlot(root.simulation) || '(none)'}

SELECTED NARRATIVE HISTORY:
${joinSlot(root.history) || '(none)'}

=== END SHARED VN BACKGROUND CONTEXT ===`;
}

function getVnBackgroundAssignment(settings = readSettings() || {}) {
  const configured = settings.narrative_agents?.vn_background_tasks || {};
  const model = String(configured.model || DEFAULT_MODEL).trim();
  const route = resolveModelAlias(model);
  return {
    scope: 'core',
    ownerId: 'vn_background_tasks',
    role: 'main',
    label: 'VN Background Tasks',
    model,
    provider: route.provider,
    resolvedModel: route.model,
    subprovider: route.subprovider || null,
    definition: { model }
  };
}

function getCachePolicy(settings = readSettings() || {}) {
  const policy = settings.infrastructure?.prompt_caching?.vn_background || {};
  const parsedDelay = Number(policy.follower_delay_ms);
  return {
    enabled: policy.enabled !== false,
    followerDelayMs: Number.isFinite(parsedDelay)
      ? Math.max(0, Math.round(parsedDelay))
      : DEFAULT_FOLLOWER_DELAY_MS
  };
}

function initializeVnBackgroundLlmContext(turnContext) {
  if (!turnContext?.runtime) return null;
  turnContext.runtime.vnManager = turnContext.runtime.vnManager || {};
  const existing = turnContext.runtime.vnManager.backgroundLlmContext;
  if (existing?.prefixHash && Array.isArray(existing.messages)) return existing;

  const capsule = buildBackgroundCapsule(turnContext);
  const messages = [
    Object.freeze({ role: 'system', content: BACKGROUND_SYSTEM_PROMPT }),
    Object.freeze({ role: 'user', content: capsule })
  ];
  const prefixHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(messages))
    .digest('hex')
    .slice(0, 16);

  const context = Object.freeze({
    capsule,
    messages: Object.freeze(messages),
    prefixHash
  });
  turnContext.runtime.vnManager.backgroundLlmContext = context;
  return context;
}

function normalizeSuffix(suffix) {
  if (typeof suffix === 'string' && suffix.trim()) {
    return [{ role: 'user', content: suffix }];
  }
  if (Array.isArray(suffix) && suffix.length > 0) {
    return suffix.map(message => ({
      role: message?.role || 'user',
      content: String(message?.content || '')
    }));
  }
  throw new Error('VN background LLM calls require a non-empty suffix.');
}

function buildVnBackgroundMessages(turnContext, suffix, options = {}) {
  const shared = initializeVnBackgroundLlmContext(turnContext);
  if (!shared) throw new Error('VN background context is unavailable.');
  const sceneMessage = buildSceneMessage(turnContext, options.scene || 'none');
  return [
    ...shared.messages.map(message => ({ ...message })),
    ...(sceneMessage ? [{ role: 'user', content: sceneMessage }] : []),
    ...normalizeSuffix(suffix)
  ];
}

function getGate(turnContext) {
  if (!turnContext?.runtime) return null;
  turnContext.runtime.vnManager = turnContext.runtime.vnManager || {};
  if (!turnContext.runtime.vnManager.backgroundLlmCacheGate) {
    turnContext.runtime.vnManager.backgroundLlmCacheGate = {
      leaderKey: null,
      leaderStartedAt: null,
      warmupFollowerKey: null,
      warmupFollowerReleaseAt: null
    };
  }
  return turnContext.runtime.vnManager.backgroundLlmCacheGate;
}

async function waitForVnBackgroundCacheSlot(turnContext, callerKey, options = {}) {
  cancellation.throwIfCancelled('VN background cache gate');
  const policy = getCachePolicy(options.settings);
  if (!policy.enabled) return { role: 'disabled', waitMs: 0, leaderKey: null };

  const gate = getGate(turnContext);
  if (!gate) return { role: 'unavailable', waitMs: 0, leaderKey: null };

  if (gate.leaderStartedAt === null) {
    gate.leaderKey = String(callerKey || 'unknown');
    gate.leaderStartedAt = Date.now();
    return { role: 'leader', waitMs: 0, leaderKey: gate.leaderKey };
  }

  let role = 'follower';
  let releaseAt;
  if (gate.warmupFollowerKey === null) {
    role = 'warmup_follower';
    gate.warmupFollowerKey = String(callerKey || 'unknown');
    gate.warmupFollowerReleaseAt = Math.max(
      Date.now(),
      gate.leaderStartedAt + policy.followerDelayMs
    );
    releaseAt = gate.warmupFollowerReleaseAt;
  } else {
    releaseAt = gate.warmupFollowerReleaseAt + policy.followerDelayMs;
  }

  const waitMs = Math.max(0, releaseAt - Date.now());
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  cancellation.throwIfCancelled('VN background cache follower delay');
  return {
    role,
    waitMs,
    leaderKey: gate.leaderKey,
    warmupFollowerKey: gate.warmupFollowerKey
  };
}

function isVnBackgroundInheritance(definition) {
  return definition?.inherit === SHARED_MODEL_INHERITANCE;
}

module.exports = {
  SHARED_MODEL_INHERITANCE,
  buildVnBackgroundMessages,
  getCachePolicy,
  getVnBackgroundAssignment,
  initializeVnBackgroundLlmContext,
  isVnBackgroundInheritance,
  waitForVnBackgroundCacheSlot,
  _private: {
    buildBackgroundCapsule,
    buildFinalDialogue,
    buildSceneMessage,
    normalizeSuffix
  }
};
