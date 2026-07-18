const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('./emotion_classifier.js');

test('emotion classifier messages contain only the chunk task prompt', () => {
  const prompt = 'Classify this dialogue chunk only.';
  const messages = _private.buildEmotionClassificationMessages(prompt);

  assert.deepEqual(messages, [
    { role: 'user', content: prompt }
  ]);
  assert.doesNotMatch(messages[0].content, /SHARED VN SCENE CAPSULE/);
});
