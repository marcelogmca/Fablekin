const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCoreVnLlmMessages,
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
  const gazeMessages = buildCoreVnLlmMessages(turnContext, 'Generate gaze directions.', { scene: 'indexedScene' });
  const stagingMessages = buildCoreVnLlmMessages(turnContext, 'Classify conversation staging.', { scene: 'indexedScene' });
  const emotionMessages = buildCoreVnLlmMessages(turnContext, 'Classify emotions.', { scene: 'indexedDialogueWithNarrative' });
  const phaseMessages = buildCoreVnLlmMessages(turnContext, 'Classify phase.', { scene: 'raw' });

  assert.deepEqual(gazeMessages.slice(0, 2), phaseMessages.slice(0, 2));
  assert.deepEqual(stagingMessages.slice(0, 3), gazeMessages.slice(0, 3));
  assert.match(gazeMessages[2].content, /0\. The latch clicks\.\n1\. Mira: Careful\./);
  assert.match(emotionMessages[2].content, /The latch clicks\.\n1\. Mira: Careful\./);
  assert.doesNotMatch(emotionMessages[2].content, /0\. The latch clicks\./);
  assert.match(phaseMessages[2].content, /Ari opens the door\./);
  assert.notEqual(gazeMessages[3].content, phaseMessages[3].content);
  assert.notEqual(stagingMessages[3].content, gazeMessages[3].content);
});
