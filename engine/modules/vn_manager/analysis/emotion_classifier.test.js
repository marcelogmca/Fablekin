const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('./emotion_classifier.js');

test('emotion classifier messages contain only the chunk task prompt', () => {
  const turnContext = { processed: { vnManager: { processedLines: [] } }, getFormattedDirective: () => '' };
  const prepared = _private.buildEmotionClassificationPrompt(turnContext, [], { lineAllowedEmotions: [] }, null, 0);
  const messages = prepared.messages;

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.doesNotMatch(messages[0].content, /SHARED VN SCENE CAPSULE/);
  assert.ok(prepared.manifest.occurrences.some(item => item.componentId === 'core.vn.emotion_classification'));
});

test('emotion prompt includes unnumbered narrative and global dialogue indexes', () => {
  const turnContext = {
    processed: {
      vnManager: {
        processedLines: [
          { type: 'narrative', line: 'Jimmy clenches his fists.' },
          { type: 'dialogue', character: 'Jimmy', text: 'Fine.' },
          { type: 'narrative', line: 'Sarah steps away.' },
          { type: 'dialogue', character: 'Sarah', text: 'You are frightening me.' }
        ]
      }
    },
    getFormattedDirective: () => ''
  };
  const dialogues = [
    { type: 'dialogue', character: 'Jimmy', text: 'Fine.', sceneLineIndex: 1 },
    { type: 'dialogue', character: 'Sarah', text: 'You are frightening me.', sceneLineIndex: 3 }
  ];
  const context = {
    globalEmotionList: ['neutral', 'angry', 'afraid'],
    globalMoodList: ['neutral', 'tense'],
    sharedMoods: ['tense'],
    lineAllowedEmotions: [['neutral', 'angry'], ['neutral', 'afraid']],
    characterProfiles: {}
  };

  const prompt = _private.createEmotionClassificationPrompt(turnContext, dialogues, context);
  assert.match(prompt, /Jimmy clenches his fists\.\n1\. Jimmy: Fine\./);
  assert.match(prompt, /Sarah steps away\.\n3\. Sarah: You are frightening me\./);
  assert.doesNotMatch(prompt, /0\. Jimmy clenches his fists/);
  assert.match(prompt, /mood = how this exact utterance should sound when voiced/);
  assert.match(prompt, /Do NOT mechanically copy the sprite emotion into mood/);
  assert.match(prompt, /Shared TTS moods available to every character[\s\S]*\[tense\]/);
  assert.match(prompt, /neutral: genuinely plain, controlled, informational, or emotionally unmarked delivery/);
  assert.match(prompt, /dominated almost entirely by happy and neutral is usually under-classified/);
});

test('emotion response maps classifications by explicit global line index', () => {
  const dialogues = [
    { sceneLineIndex: 3 },
    { sceneLineIndex: 5 }
  ];
  const context = {
    globalEmotionList: ['neutral', 'angry', 'afraid'],
    globalMoodList: ['neutral', 'tense'],
    lineAllowedEmotions: [['neutral', 'angry'], ['neutral', 'afraid']]
  };

  const parsed = _private.parseEmotionResponse('5) afraid,tense\n3. angry,tense', context, dialogues);
  assert.deepEqual(parsed, [
    { emotion: 'angry', mood: 'tense' },
    { emotion: 'afraid', mood: 'tense' }
  ]);
});
