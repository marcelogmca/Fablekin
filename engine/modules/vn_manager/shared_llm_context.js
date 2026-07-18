const crypto = require('crypto');

const CORE_VN_SHARED_SYSTEM_PROMPT = `You are a specialist in a visual-novel post-processing pipeline.
The next message is an immutable shared scene capsule. Treat it as authoritative scene context.
Use the final task message to determine your specific responsibility and output format.`;

function formatDialogueScript(lines) {
  return lines
    .filter(line => line?.type === 'dialogue')
    .map((line, index) => `${index + 1}. ${line.character || 'Unknown'}: ${line.text || line.line || ''}`)
    .join('\n');
}

function buildSceneCapsule(turnContext) {
  const lines = Array.isArray(turnContext?.processed?.vnManager?.processedLines)
    ? turnContext.processed.vnManager.processedLines
    : [];
  const userPrompt = turnContext?.input?.userPrompt || '';
  const writerChapter = turnContext?.processed?.narrativeEngine?.writerResponse || '';
  const playerName = turnContext?.input?.playerCharacterName || 'Player';

  return `=== SHARED VN SCENE CAPSULE ===
PLAYER CHARACTER:
${playerName}

CURRENT USER INPUT:
${userPrompt || '(none)'}

CURRENT WRITER CHAPTER:
${writerChapter || '(empty)'}

DIALOGUE-ONLY INDEX OF THE SAME CHAPTER:
${formatDialogueScript(lines) || '(empty)'}
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

function buildCoreVnLlmMessages(turnContext, taskPrompt) {
  return [
    ...getCoreVnSharedLlmMessages(turnContext),
    { role: 'user', content: String(taskPrompt || '') }
  ];
}

module.exports = {
  buildCoreVnLlmMessages,
  getCoreVnSharedLlmMessages,
  initializeCoreVnSharedLlmContext,
  _private: {
    buildSceneCapsule,
    formatDialogueScript
  }
};
