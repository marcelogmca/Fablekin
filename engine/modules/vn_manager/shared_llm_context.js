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
  if (existing?.systemPrompt && existing?.sceneCapsule) return existing;

  const sceneCapsule = buildSceneCapsule(turnContext);
  const prefixHash = crypto
    .createHash('sha256')
    .update(JSON.stringify([
      { role: 'system', content: CORE_VN_SHARED_SYSTEM_PROMPT },
      { role: 'user', content: sceneCapsule }
    ]))
    .digest('hex')
    .slice(0, 16);

  const sharedContext = Object.freeze({
    systemPrompt: CORE_VN_SHARED_SYSTEM_PROMPT,
    sceneCapsule,
    prefixHash
  });
  turnContext.runtime.vnManager.sharedLlmContext = sharedContext;
  return sharedContext;
}

function getCoreVnSharedLlmMessages(turnContext) {
  const sharedContext = initializeCoreVnSharedLlmContext(turnContext);
  if (!sharedContext) return [];
  return [
    { role: 'system', content: sharedContext.systemPrompt },
    { role: 'user', content: sharedContext.sceneCapsule }
  ];
}

function buildCoreVnLlmMessages(turnContext, taskPrompt, options = {}) {
  const sceneMessage = buildSceneMessage(turnContext, options.scene || 'none');
  return [
    ...getCoreVnSharedLlmMessages(turnContext),
    ...(sceneMessage ? [{ role: 'user', content: sceneMessage }] : []),
    { role: 'user', content: String(taskPrompt || '') }
  ];
}

module.exports = {
  buildCoreVnLlmMessages,
  getCoreVnSharedLlmMessages,
  initializeCoreVnSharedLlmContext,
  _private: {
    buildSceneCapsule,
    buildSceneMessage,
    formatIndexedDialogueWithNarrative,
    formatIndexedScene
  }
};
