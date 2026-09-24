const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { computeSpritePositions } = require('../rendering/sprite_positioner.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');
const {
  TIMING_OFFSETS_MS,
  applyConversationStaging,
  buildConversationStagingPrompt,
  buildPresentCharacters,
  getNpcDialogueEntries,
  parseClassificationResponse
} = require('./conversation_staging_classifier.js');

function createTurnContext() {
  return {
    input: {
      playerCharacterName: 'Ari',
      userPrompt: 'Ask what happened.'
    },
    output: {
      party: ['Mira', 'Silent Witness']
    },
    processed: {
      vnManager: {
        processedLines: [
          { type: 'narrative', line: 'The room falls quiet.' },
          { type: 'dialogue', character: 'Mira', text: 'Juno, explain.', line: 'Mira: Juno, explain.' },
          { type: 'dialogue', character: 'Ari', text: 'Please.', line: 'Ari: Please.' },
          { type: 'narrative', line: 'For several seconds, nobody answers.' },
          { type: 'dialogue', character: 'Juno', text: 'I was afraid.', line: 'Juno: I was afraid.' },
          { type: 'dialogue', character: 'Sol', text: 'We all were.', line: 'Sol: We all were.' },
          { type: 'dialogue', character: 'Nyx', text: 'That is no excuse.', line: 'Nyx: That is no excuse.' },
          { type: 'dialogue', character: 'Vera', text: 'Wait—', line: 'Vera: Wait—' },
          { type: 'dialogue', character: 'Orin', text: 'No, listen.', line: 'Orin: No, listen.' }
        ]
      }
    },
    runtime: { vnManager: {} }
  };
}

test('builds NPC alignment and normalized present-character context', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext);

  assert.deepEqual(entries.map(entry => entry.sceneLineIndex), [1, 4, 5, 6, 7, 8]);
  assert.deepEqual(
    buildPresentCharacters(turnContext, entries),
    ['mira', 'juno', 'sol', 'nyx', 'vera', 'orin', 'ari', 'silent witness']
  );
});

test('builds a full indexed-scene prompt with explicit output cardinality', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext);
  const presentCharacters = buildPresentCharacters(turnContext, entries);
  const template = fs.readFileSync('engine/prompts/conversation_staging_classifier.txt', 'utf8');
  const prompt = buildConversationStagingPrompt(template, {
    presentCharacters,
    playerName: 'Ari',
    expectedRowCount: entries.length,
    projectDirectives: 'Keep interruptions rare.'
  });
  const messages = buildCoreVnLlmMessages(turnContext, prompt, { scene: 'indexedScene' });

  assert.match(messages[2].content, /0\. The room falls quiet\./);
  assert.match(messages[2].content, /2\. Ari: Please\./);
  assert.match(messages[2].content, /3\. For several seconds, nobody answers\./);
  assert.match(messages[3].content, /Expected output rows: 6/);
  assert.match(messages[3].content, /silent witness/);
  assert.match(messages[3].content, /Player character whose dialogue must not receive an output row:\s+ari/);
  assert.doesNotMatch(messages[3].content, /\{PRESENT_CHARACTERS\}|\{EXPECTED_OUTPUT_ROWS\}|\{SCENE\}/);
});

test('maps all timing classes and valid targets to canonical line metadata', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext);
  const presentCharacters = buildPresentCharacters(turnContext, entries);
  const response = [
    'normal,juno',
    'hesitate,mira',
    'snap,ari',
    'pause,group',
    'overlap,orin',
    'interrupt,vera'
  ].join('\n');
  const parsed = parseClassificationResponse(response, entries, presentCharacters);

  assert.equal(parsed.expectedRowCount, 6);
  assert.equal(parsed.receivedRowCount, 6);
  assert.deepEqual(parsed.classifications.map(item => item.fto.offsetMs), [
    TIMING_OFFSETS_MS.normal,
    TIMING_OFFSETS_MS.hesitate,
    TIMING_OFFSETS_MS.snap,
    TIMING_OFFSETS_MS.pause,
    TIMING_OFFSETS_MS.overlap,
    TIMING_OFFSETS_MS.interrupt
  ]);

  applyConversationStaging(turnContext.processed.vnManager.processedLines, parsed.classifications);
  const lines = turnContext.processed.vnManager.processedLines;
  assert.deepEqual(lines[4].fto, { class: 'hesitate', offsetMs: 650 });
  assert.equal(lines[4].speakerTarget, 'mira');
  assert.equal(lines[6].speakerTarget, 'group');
  assert.equal(lines[0].fto, undefined);
  assert.equal(lines[2].fto, undefined);

  const finalOutput = computeSpritePositions(lines, []);
  assert.deepEqual(finalOutput[4].fto, { class: 'hesitate', offsetMs: 650 });
  assert.equal(finalOutput[4].speakerTarget, 'mira');
});

test('salvages fields positionally while invalid and blank rows consume their slots', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext).slice(0, 3);
  const presentCharacters = buildPresentCharacters(turnContext, entries);
  const parsed = parseClassificationResponse(
    'snap,unknown\n\nbogus,mira\npause,juno',
    entries,
    presentCharacters
  );

  assert.equal(parsed.expectedRowCount, 3);
  assert.equal(parsed.receivedRowCount, 4);
  assert.deepEqual(parsed.classifications, [
    { sceneLineIndex: 1, fto: { class: 'snap', offsetMs: 0 } },
    { sceneLineIndex: 5, speakerTarget: 'mira' }
  ]);
});

test('rejects self-targets and malformed target fields while preserving valid timing', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext).slice(0, 2);
  const presentCharacters = buildPresentCharacters(turnContext, entries);
  const parsed = parseClassificationResponse(
    'normal,mira\nsnap,mira,extra',
    entries,
    presentCharacters
  );

  assert.deepEqual(parsed.classifications, [
    { sceneLineIndex: 1, fto: { class: 'normal', offsetMs: 200 } },
    { sceneLineIndex: 4, fto: { class: 'snap', offsetMs: 0 } }
  ]);
});

test('leaves missing rows unannotated and identifies scenes with no NPC dialogue', () => {
  const turnContext = createTurnContext();
  const entries = getNpcDialogueEntries(turnContext);
  const parsed = parseClassificationResponse(
    'normal,juno',
    entries,
    buildPresentCharacters(turnContext, entries)
  );
  assert.equal(parsed.classifications.length, 1);
  assert.equal(parsed.receivedRowCount, 1);

  const noNpcTurn = {
    input: { playerCharacterName: 'Ari' },
    processed: {
      vnManager: {
        processedLines: [
          { type: 'narrative', line: 'Rain falls.' },
          { type: 'dialogue', character: 'Ari', text: 'Hello.' }
        ]
      }
    }
  };
  assert.deepEqual(getNpcDialogueEntries(noNpcTurn), []);
});
