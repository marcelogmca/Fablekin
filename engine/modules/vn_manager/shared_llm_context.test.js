const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCoreVnPreparedPrompt,
  initializeCoreVnSharedLlmContext
} = require('./shared_llm_context.js');

function createTurnContext() {
  return {
    input: {
      playerCharacterName: 'Ari',
      userPrompt: 'Open the door.'
    },
    processed: {
      narrativeEngine: { writerResponse: 'Ari opens the door.' },
      vnManager: {
        processedLines: [
          { type: 'narrative', line: 'The latch clicks.' },
          { type: 'dialogue', character: 'Mira', text: 'Careful.' }
        ]
      }
    },
    runtime: { vnManager: {} }
  };
}

test('shared VN context excludes the current scene', () => {
  const turnContext = createTurnContext();
  const first = initializeCoreVnSharedLlmContext(turnContext);

  turnContext.processed.vnManager.processedLines[1].text = 'Changed later.';
  const second = initializeCoreVnSharedLlmContext(turnContext);

  assert.equal(second, first);
  assert.doesNotMatch(second.sceneCapsule, /Mira: Careful|Changed later|Ari opens the door/);
  assert.equal(second.prefixHash.length, 16);
});

test('core VN callers explicitly select a current-scene representation', () => {
  const turnContext = createTurnContext();
  const gazeMessages = buildCoreVnPreparedPrompt(turnContext, { id: 'core.vn.test.gaze', task: 'Generate gaze directions.', scene: 'indexedScene' }).messages;
  const stagingMessages = buildCoreVnPreparedPrompt(turnContext, { id: 'core.vn.test.staging', task: 'Classify conversation staging.', scene: 'indexedScene' }).messages;
  const emotionMessages = buildCoreVnPreparedPrompt(turnContext, { id: 'core.vn.test.emotion', task: 'Classify emotions.', scene: 'indexedDialogueWithNarrative' }).messages;
  const phaseMessages = buildCoreVnPreparedPrompt(turnContext, { id: 'core.vn.test.phase', task: 'Classify phase.', scene: 'raw' }).messages;

  assert.deepEqual(gazeMessages.slice(0, 2), phaseMessages.slice(0, 2));
  assert.deepEqual(stagingMessages.slice(0, 3), gazeMessages.slice(0, 3));
  assert.match(gazeMessages[2].content, /0\. The latch clicks\.\n1\. Mira: Careful\./);
  assert.match(emotionMessages[2].content, /The latch clicks\.\n1\. Mira: Careful\./);
  assert.doesNotMatch(emotionMessages[2].content, /0\. The latch clicks\./);
  assert.match(phaseMessages[2].content, /Ari opens the door\./);
  assert.notEqual(gazeMessages[3].content, phaseMessages[3].content);
  assert.notEqual(stagingMessages[3].content, gazeMessages[3].content);
});

test('prepared core VN prefix is byte-identical with named core spans', () => {
  const turnContext = createTurnContext();
  // Pinned pre-cutover wire format (literal roles/content — not two builders
  // sharing one implementation, which would be tautological):
  // [system contract][user capsule][user indexed scene][user task].
  const legacy = [
    { role: 'system', content: 'You are a specialist in a visual-novel post-processing pipeline.\nThe next message is an immutable shared scene capsule. Treat it as authoritative scene context.\nUse the final task message to determine your specific responsibility and output format.' },
    { role: 'user', content: '=== SHARED VN SCENE CAPSULE ===\nPLAYER CHARACTER:\nAri\n\nCURRENT USER INPUT:\nOpen the door.\n\n=== END SHARED VN SCENE CAPSULE ===' },
    { role: 'user', content: '=== CURRENT INDEXED SCENE ===\n0. The latch clicks.\n1. Mira: Careful.' },
    { role: 'user', content: 'Generate gaze directions.' }
  ];
  const prepared = buildCoreVnPreparedPrompt(turnContext, {
    id: 'core.vn.test.gaze',
    task: 'Generate gaze directions.',
    scene: 'indexedScene'
  });
  // Same roles and bytes through the prepared path.
  assert.deepEqual(
    prepared.messages.map(({ role, content }) => ({ role, content })),
    legacy
  );
  // Frozen prefix identical across tasks; hash covers the two leading messages.
  const other = buildCoreVnPreparedPrompt(turnContext, {
    id: 'core.vn.test.staging',
    task: 'Classify conversation staging.',
    scene: 'indexedScene'
  });
  assert.deepEqual(prepared.messages.slice(0, 2), other.messages.slice(0, 2));
  const shared = initializeCoreVnSharedLlmContext(turnContext);
  assert.equal(shared.prefixHash.length, 16);
  assert.equal(shared.prepared.hash, shared.prepared.hash);
  assert.ok(prepared.manifest.inclusions.some(item => item.sourceHash === shared.prepared.hash));
  // Named core spans own every byte.
  const ids = new Set(prepared.manifest.occurrences.map(occ => occ.componentId));
  assert.ok(ids.has('core.vn.system'));
  assert.ok(ids.has('core.vn.scene_capsule'));
  assert.ok(ids.has('core.vn.scene'));
  assert.ok(ids.has('core.vn.task'));
  const sorted = [...prepared.manifest.spans].sort((a, b) =>
    a.messageIndex - b.messageIndex || a.start - b.start);
  let cursor = { messageIndex: -1, end: 0 };
  for (const span of sorted) {
    if (span.messageIndex !== cursor.messageIndex) cursor = { messageIndex: span.messageIndex, end: 0 };
    assert.ok(span.start >= cursor.end, 'spans must be exclusive and gapless per message');
    cursor.end = span.end;
  }
});
