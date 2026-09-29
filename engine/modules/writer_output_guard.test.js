const assert = require('node:assert/strict');
const test = require('node:test');
const { hasRunawayWordList, stripThinkingBlocks } = require('./writer_output_guard.js');

test('rejects a runaway vocabulary list before dialogue transformation', () => {
  const list = Array.from({ length: 80 }, (_, i) => `word${i}`).join(', ');
  assert.equal(hasRunawayWordList(`The door closed. ${list}, forever.`), true);
});

test('preserves a long scene with normal dialogue and occasional lists', () => {
  const scene = ('Dehya: We need time, water, and a little patience.\n' +
    'Candace looked over at her. The room was quiet.\n').repeat(120);
  assert.equal(hasRunawayWordList(scene), false);
});

test('removes a thinking block, its tags, and its content', () => {
  const content = '<thinking>\nThe player is at the altar. I should describe the carvings.\n</thinking>\nAri stepped toward the altar.';
  assert.equal(stripThinkingBlocks(content), 'Ari stepped toward the altar.');
});

test('removes every thinking block in a response', () => {
  const content = '<thinking>first pass</thinking>Ari: Hello.\n<thinking>second pass</thinking>Ari: Are you there?';
  assert.equal(stripThinkingBlocks(content), 'Ari: Hello.\nAri: Are you there?');
});

test('removes thinking blocks case-insensitively and across many lines', () => {
  const content = 'Before.\n<THINKING>\nline one\nline two\n</Thinking >\nAfter.';
  assert.equal(stripThinkingBlocks(content), 'Before.\nAfter.');
});

test('leaves the word thinking in prose alone when it carries no tags', () => {
  const content = 'Ari was thinking about the altar, and the thinking would not stop.';
  assert.equal(stripThinkingBlocks(content), content);
});

test('returns non-string and tag-free input untouched', () => {
  const scene = 'A quiet room.';
  assert.equal(stripThinkingBlocks(scene), scene);
  assert.equal(stripThinkingBlocks(null), null);
  assert.equal(stripThinkingBlocks(undefined), undefined);
});

test('does not strip an unclosed thinking tag so later prose is never deleted', () => {
  const content = 'Ari: Look. <thinking> an aside that never closes.';
  assert.equal(stripThinkingBlocks(content), content);
});
