const crypto = require('crypto');
const {
  formatIndexedDialogueWithNarrative,
  formatIndexedScene,
  getProcessedSceneLines
} = require('./scene_prompt_formatter.js');

const CORE_VN_SHARED_SYSTEM_PROMPT = `You are a specialist in a visual-novel post-processing pipeline.
The next message is an immutable shared scene capsule. Treat it as authoritative scene context.
Use the final task message to determine your specific responsibility and output format.`;

function buildSceneMessage(turnContext, scene = 'none') {
  const lines = getProcessedSceneLines(turnContext);
  if (scene === 'raw') {
    return `=== CURRENT WRITER CHAPTER ===\n${turnContext?.processed?.narrativeEngine?.writerResponse || '(empty)'}`;
  }
  if (scene === 'indexedScene' || scene === 'numbered') {
    return `=== CURRENT INDEXED SCENE ===\n${formatIndexedScene(lines) || '(empty)'}`;
  }
  if (scene === 'indexedDialogueWithNarrative' || scene === 'dialogue') {
    return `=== CURRENT NARRATIVE-ASSISTED INDEXED DIALOGUE ===\n${formatIndexedDialogueWithNarrative(lines) || '(empty)'}`;
  }
  if (scene === 'none' || scene === undefined || scene === null) return '';
  throw new Error(`Unknown core VN scene mode '${scene}'.`);
}

function buildSceneCapsule(turnContext) {
  const userPrompt = turnContext?.input?.userPrompt || '';
  const playerName = turnContext?.input?.playerCharacterName || 'Player';

  return `=== SHARED VN SCENE CAPSULE ===
PLAYER CHARACTER:
${playerName}

CURRENT USER INPUT:
${userPrompt || '(none)'}

=== END SHARED VN SCENE CAPSULE ===`;
}

function initializeCoreVnSharedLlmContext(turnContext) {
  if (!turnContext?.runtime) return null;
  if (!turnContext.runtime.vnManager || typeof turnContext.runtime.vnManager !== 'object') {
    turnContext.runtime.vnManager = {};
  }

  const existing = turnContext.runtime.vnManager.sharedLlmContext;
  if (existing?.systemPrompt && existing?.sceneCapsule) {
    // Prepared-prefix upgrade: memoized plain context gains the frozen
    // PreparedPrompt + hash without recomputing the capsule bytes.
    if (existing?.prepared && typeof existing.prefixHash === 'string') return existing;
    const upgraded = freezeCoreVnSharedContext(turnContext, existing.systemPrompt, existing.sceneCapsule);
    turnContext.runtime.vnManager.sharedLlmContext = upgraded;
    return upgraded;
  }

  const sceneCapsule = buildSceneCapsule(turnContext);
  const sharedContext = freezeCoreVnSharedContext(turnContext, CORE_VN_SHARED_SYSTEM_PROMPT, sceneCapsule);
  turnContext.runtime.vnManager.sharedLlmContext = sharedContext;
  return sharedContext;
}

// Prepared core VN prefix: the SAME two leading messages as the legacy
// array builder, frozen as a PreparedPrompt with named core VN spans.
// Derived hash equals the legacy 16-char prefixHash (same JSON of the same
// two {role,content} messages).
function freezeCoreVnSharedContext(turnContext, systemPrompt, sceneCapsule) {
  const { Prompt } = require('../prompt/prompt.js');
  const prompt = new Prompt({ id: 'core.vn.shared', turnContext });
  prompt.system(message => {
    message.add('core.vn.system', systemPrompt);
  });
  prompt.user(message => {
    message.add('core.vn.scene_capsule', sceneCapsule);
  });
  const prepared = prompt.prepare();
  const prefixHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(prepared.messages.map(({ role, content }) => ({ role, content }))))
    .digest('hex')
    .slice(0, 16);
  return Object.freeze({
    systemPrompt,
    sceneCapsule,
    prepared,
    prefixHash
  });
}

// Core-module helper: shared prefix + optional formatted scene + named task.
// Core modules import Prompt/shared_llm_context directly — no PluginManager
// tooling. `id` must be a stable per-call id (e.g.
// 'core.asset_selector.background.basic').
function buildCoreVnPreparedPrompt(turnContext, { id, task, scene = 'none', taskComponentId = 'core.vn.task', sceneComponentId = 'core.vn.scene' } = {}) {
  if (typeof id !== 'string' || !id) {
    throw new TypeError('buildCoreVnPreparedPrompt requires a stable string id.');
  }
  const shared = initializeCoreVnSharedLlmContext(turnContext);
  if (!shared?.prepared) throw new Error('Core VN shared context is unavailable.');
  const { Prompt } = require('../prompt/prompt.js');
  const prompt = new Prompt({ id, turnContext });
  prompt.usePrefix(shared.prepared);
  const sceneMessage = buildSceneMessage(turnContext, scene);
  if (sceneMessage) {
    prompt.user(message => {
      message.add(sceneComponentId, sceneMessage);
    });
  }
  prompt.user(message => {
    message.add(taskComponentId, String(task ?? ''));
  });
  return prompt.prepare();
}

// REMOVED (core VN cutover): buildCoreVnLlmMessages /
// getCoreVnSharedLlmMessages — the array twin is gone. Consumers use the
// prepared prefix via buildCoreVnPreparedPrompt(); raw access stays behind
// `initializeCoreVnSharedLlmContext` for diagnostics only.
module.exports = {
  buildCoreVnPreparedPrompt,
  initializeCoreVnSharedLlmContext,
  _private: {
    buildSceneCapsule,
    buildSceneMessage,
    formatIndexedDialogueWithNarrative,
    formatIndexedScene
  }
};
