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

test('shared VN context remains immutable after initialization', () => {
  const turnContext = createTurnContext();
  const first = initializeCoreVnSharedLlmContext(turnContext);

  turnContext.processed.vnManager.processedLines[1].text = 'Changed later.';
  const second = initializeCoreVnSharedLlmContext(turnContext);

  assert.equal(second, first);
  assert.match(second.sceneCapsule, /Mira: Careful\./);
  assert.doesNotMatch(second.sceneCapsule, /Changed later/);
  assert.equal(second.prefixHash.length, 16);
});

test('core VN messages share an exact two-message prefix', () => {
  const turnContext = createTurnContext();
  const gazeMessages = buildCoreVnLlmMessages(turnContext, 'Generate gaze directions.');
  const emotionMessages = buildCoreVnLlmMessages(turnContext, 'Classify emotions.');

  assert.deepEqual(gazeMessages.slice(0, 2), emotionMessages.slice(0, 2));
  assert.notEqual(gazeMessages[2].content, emotionMessages[2].content);
});
