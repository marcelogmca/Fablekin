const crypto = require('crypto');
const { readSettings } = require('../utils.js');
const cancellation = require('../pipeline_cancellation.js');
const { resolveModelAlias } = require('../llm.js');
const {
  formatIndexedDialogueWithNarrative,
  formatIndexedScene,
  getProcessedSceneLines
} = require('./scene_prompt_formatter.js');

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

function buildIndexedScene(turnContext) {
  return formatIndexedScene(getProcessedSceneLines(turnContext));
}

function buildSceneMessage(turnContext, scene = 'none') {
  switch (scene) {
    case 'raw':
      return `=== CURRENT WRITER CHAPTER ===\n${turnContext?.processed?.narrativeEngine?.writerResponse || '(empty)'}`;
    case 'indexedScene':
    case 'numbered':
      return `=== CURRENT INDEXED SCENE ===\n${buildIndexedScene(turnContext) || '(empty)'}`;
    case 'indexedDialogueWithNarrative':
    case 'dialogue':
      return `=== CURRENT NARRATIVE-ASSISTED INDEXED DIALOGUE ===\n${formatIndexedDialogueWithNarrative(getProcessedSceneLines(turnContext)) || '(empty)'}`;
    case 'none':
    case undefined:
    case null:
      return '';
    default:
      throw new Error(`Unknown VN background scene mode '${scene}'.`);
  }
}

function renderVnSlot(turnContext, slot) {
  // An empty VALID slot renders '(none)'; a missing accessor or invalid
  // slot throws — silent omission of context is forbidden.
  if (typeof turnContext?.renderPromptSlot !== 'function') {
    throw new Error(`VN background capsule cannot render root.${slot}: TurnContext has no renderPromptSlot().`);
  }
  const text = turnContext.renderPromptSlot('root', slot);
  return text || '(none)';
}

// Section bodies for the capsule: the prepared prefix and this array twin
// MUST agree byte-for-byte. Both go through renderVnSlot() (structured
// occurrences + toolkit-owned directable framing), so per-plugin bytes are
// identical in both paths. The envelope join below mirrors the composer's
// capsule node: `${OPEN}\n` + sections joined with `\n\n` + `\n${CLOSE}`.
function buildCapsuleSections(turnContext) {
  const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
  return [
    `PROJECT: ${turnContext?.projectName || 'Unknown'}\nTURN: ${turnContext?.turnNumber || 0}\nPLAYER: ${turnContext?.input?.playerCharacterName || 'Player'}\nPARTY: ${party.join(', ') || '(none)'}`,
    `CURRENT USER INPUT:\n${turnContext?.input?.userPrompt || '(none)'}`,
    `DIRECTOR BRIEF:\n${turnContext?.processed?.director?.writerBrief || '(none)'}`,
    `SELECTED CANON:\n${renderVnSlot(turnContext, 'canon')}`,
    `SELECTED DYNAMIC KNOWLEDGE:\n${renderVnSlot(turnContext, 'dynamic_knowledge')}`,
    `CURRENT SIMULATION CONTEXT:\n${renderVnSlot(turnContext, 'simulation')}`,
    `SELECTED NARRATIVE HISTORY:\n${renderVnSlot(turnContext, 'history')}`
  ];
}

function buildBackgroundCapsule(turnContext) {
  // Canonical array twin of the prepared capsule message. Kept for explicit
  // readers only; prepared callers use buildVnBackgroundPrompt(). Envelope
  // matches pre-cutover HEAD: sections joined with '\n\n', '\n\n' before
  // CLOSE (HEAD's template had two newlines there).
  const sections = buildCapsuleSections(turnContext);
  return `${VN_CAPSULE_OPEN}\n${sections.join('\n\n')}\n\n${VN_CAPSULE_CLOSE}`;
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
  // Memoized shared prefix: EXACTLY the two leading messages (system +
  // capsule). The hash covers only those bytes — no warmup suffix.
  if (existing?.prefixHash && existing?.prepared) return existing;

  const prepared = buildVnBackgroundPrefix(turnContext);
  const context = Object.freeze({
    prepared,
    prefixHash: prepared.hash,
    messages: Object.freeze(prepared.messages.map(message => Object.freeze({ role: message.role, content: message.content })))
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
  // Legacy array twin of buildVnBackgroundPrompt() below. Cutover code must
  // use buildVnBackgroundPrompt(); this stays only until the last array
  // reader migrates, then it is deleted.
  const prepared = buildVnBackgroundPrompt(turnContext, suffix, options);
  return prepared.messages.map(message => ({ role: message.role, content: message.content }));
}

// (VN_BACKGROUND_CAPSULE_SECTIONS deleted: sections are composed inline in
// buildVnBackgroundPrefix() with per-section components under the capsule;
// their slot bodies render via the shared renderSlotInto() so Writer/Director
// and VN-background cannot disagree about bytes.)

// Canonical capsule envelope bytes. buildBackgroundCapsule() (array twin)
// and the prepared capsule message use these exact markers so both agree.
const VN_CAPSULE_OPEN = '=== SHARED VN BACKGROUND CONTEXT ===';
const VN_CAPSULE_CLOSE = '=== END SHARED VN BACKGROUND CONTEXT ===';

// Shared-prefix composer: EXACTLY two messages (system + capsule).
// Callers needing scene/suffix compose them after usePrefix(), so the
// memoized hash covers only the shared leading block.
const VN_BACKGROUND_SECTION_DEFS = Object.freeze([
  { key: 'project', componentId: 'core.vn_background.capsule.project', label: 'VN background project', description: 'Project, turn, player and party identity header.' },
  { key: 'input', componentId: 'core.vn_background.capsule.input', label: 'VN background input', description: 'Current user input for the background call.' },
  { key: 'brief', componentId: 'core.vn_background.capsule.brief', label: 'VN background brief', description: 'Director brief carried into background analysis.' },
  { key: 'canon', componentId: 'core.vn_background.capsule.canon', label: 'VN background canon', description: 'Shared canon slot content for the background call.' },
  { key: 'knowledge', componentId: 'core.vn_background.capsule.knowledge', label: 'VN background knowledge', description: 'Shared dynamic knowledge slot content.' },
  { key: 'simulation', componentId: 'core.vn_background.capsule.simulation', label: 'VN background simulation', description: 'Shared simulation slot content with plugin provenance.' },
  { key: 'history', componentId: 'core.vn_background.capsule.history', label: 'VN background history', description: 'Shared narrative history slot content.' }
]);

function registerVnBackgroundIdentities(prompt) {
  prompt.registerDynamicComponent('core.vn_background.capsule', {
    parent: 'root',
    label: 'VN background capsule',
    description: 'Shared VN background context capsule (identity, input, brief, slot content with plugin provenance).',
    owner: 'core'
  });
  for (const section of VN_BACKGROUND_SECTION_DEFS) {
    prompt.registerDynamicComponent(section.componentId, {
      parent: 'core.vn_background.capsule',
      label: section.label,
      description: section.description,
      owner: 'core'
    });
  }
}

function buildVnBackgroundPrefix(turnContext) {
  const { Prompt } = require('../prompt/prompt.js');
  const prompt = new Prompt({ id: 'core.vn_background.shared', turnContext });
  registerVnBackgroundIdentities(prompt);
  prompt.system(message => {
    message.add('core.vn_background.system', BACKGROUND_SYSTEM_PROMPT);
  });
  // Typed composition: project/input/brief are capsule-owned layout text;
  // the four root slots are INCLUDED (same stored occurrences Writer/Director
  // use), keeping their semantic catalogue identity. The capsule message is
  // the physical layout, never a replacement parent.
  const projectText = `PROJECT: ${turnContext?.projectName || 'Unknown'}\nTURN: ${turnContext?.turnNumber || 0}\nPLAYER: ${turnContext?.input?.playerCharacterName || 'Player'}\nPARTY: ${(Array.isArray(turnContext?.output?.party) ? turnContext.output.party : []).join(', ') || '(none)'}`;
  const inputText = `CURRENT USER INPUT:\n${turnContext?.input?.userPrompt || '(none)'}`;
  const briefText = `DIRECTOR BRIEF:\n${turnContext?.processed?.director?.writerBrief || '(none)'}`;
  const slotOf = (slot) => {
    const items = turnContext?.promptComponents?.root?.[slot];
    if (!Array.isArray(items)) throw new Error(`VN background capsule cannot include root.${slot}: not a structured slot.`);
    return items;
  };
  // Trusted inclusion: identity resolved LIVE at prepare() via
  // turnContext.getPromptSource() — no build-time source copies. The
  // componentId is derived from the resolved source, never caller-supplied.
  // sourceId is stamped at insertion; a missing id is a producer bug.
  const registerSlotSources = (slot) => {
    slotOf(slot).forEach((occurrence) => {
      if (!occurrence || typeof occurrence !== 'object') return;
      if (typeof occurrence.sourceId !== 'string' || !occurrence.sourceId) {
        throw new Error(`VN background capsule occurrence ${occurrence.componentId} in root.${slot} has no sourceId; use addPromptOccurrence().`);
      }
      occurrence.slotAnchor = `root.${slot}`;
      prompt.registerOccurrenceIdentity(occurrence, [`root.${slot}`]);
    });
  };
  for (const slot of ['canon', 'dynamic_knowledge', 'simulation', 'history']) registerSlotSources(slot);
  const includeSlotSection = (section, slot, heading) => {
    section.text(`${heading}:\n`);
    const items = slotOf(slot);
    if (items.length === 0) {
      section.text('(none)');
      return;
    }
    items.forEach((occurrence, index) => {
      if (index > 0) section.text('\n\n');
      section.include(turnContext, 'root', slot, occurrence.sourceId);
    });
  };
  prompt.user(message => {
    message.add('core.vn_background.capsule', capsule => {
      // Envelope rule (matches pre-cutover HEAD exactly): `${OPEN}\n` +
      // sections joined with '\n\n' + `\n\n${CLOSE}`. HEAD's array twin used
      // `${sections.join('\n\n')}\n\n${CLOSE}`; the composer emits the same
      // bytes as container-owned text.
      capsule.text(`${VN_CAPSULE_OPEN}\n`);
      capsule.add('core.vn_background.capsule.project', projectText);
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.input', inputText);
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.brief', briefText);
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.canon', section => {
        includeSlotSection(section, 'canon', 'SELECTED CANON');
      });
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.knowledge', section => {
        includeSlotSection(section, 'dynamic_knowledge', 'SELECTED DYNAMIC KNOWLEDGE');
      });
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.simulation', section => {
        includeSlotSection(section, 'simulation', 'CURRENT SIMULATION CONTEXT');
      });
      capsule.text('\n\n');
      capsule.add('core.vn_background.capsule.history', section => {
        includeSlotSection(section, 'history', 'SELECTED NARRATIVE HISTORY');
      });
      capsule.text(`\n\n${VN_CAPSULE_CLOSE}`);
    });
  });
  return prompt.prepare();
}

function buildVnBackgroundPrompt(turnContext, suffix, options = {}) {
  const shared = initializeVnBackgroundLlmContext(turnContext);
  if (!shared) throw new Error('VN background context is unavailable.');
  const { Prompt } = require('../prompt/prompt.js');
  const sceneMessage = buildSceneMessage(turnContext, options.scene || 'none');
  const prompt = new Prompt({ id: 'core.vn_background' });
  prompt.usePrefix(shared.prepared);
  if (sceneMessage) {
    prompt.registerDynamicComponent('core.vn_background.scene', {
      parent: 'root.history',
      label: 'VN background scene',
      description: 'Current-chapter scene excerpt for the background call.',
      owner: 'core'
    });
    prompt.user(message => {
      message.add('core.vn_background.scene', sceneMessage);
    });
  }
  if (options.preparedSuffix !== undefined) {
    const { PreparedPrompt } = require('../prompt/prompt.js');
    if (!(options.preparedSuffix instanceof PreparedPrompt)) {
      throw new TypeError('VN background preparedSuffix must be a PreparedPrompt.');
    }
    if (suffix !== null && suffix !== undefined && suffix !== '') {
      throw new Error('Supply a preparedSuffix or a plain suffix, not both.');
    }
    prompt.append(options.preparedSuffix);
    return prompt.prepare();
  }
  const suffixRegistered = { done: false };
  for (const suffixMessage of normalizeSuffix(suffix)) {
    if (!suffixRegistered.done) {
      prompt.registerDynamicComponent('core.vn_background.suffix', {
        parent: 'core.plugin_tasks',
        label: 'VN background suffix',
        description: 'Task-specific suffix for the background call.',
        owner: 'core'
      });
      suffixRegistered.done = true;
    }
    prompt.message(suffixMessage.role, message => {
      message.add('core.vn_background.suffix', suffixMessage.content);
    });
  }
  return prompt.prepare();
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
  buildVnBackgroundPrompt,
  buildVnBackgroundPrefix,
  getCachePolicy,
  getVnBackgroundAssignment,
  initializeVnBackgroundLlmContext,
  isVnBackgroundInheritance,
  waitForVnBackgroundCacheSlot,
  _private: {
    buildBackgroundCapsule,
    buildIndexedScene,
    buildSceneMessage,
    normalizeSuffix
  }
};
