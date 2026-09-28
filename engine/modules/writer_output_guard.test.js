const assert = require('node:assert/strict');
const test = require('node:test');
const { hasRunawayWordList } = require('./writer_output_guard.js');

test('rejects a runaway vocabulary list before dialogue transformation', () => {
  const list = Array.from({ length: 80 }, (_, i) => `word${i}`).join(', ');
  assert.equal(hasRunawayWordList(`The door closed. ${list}, forever.`), true);
});

test('preserves a long scene with normal dialogue and occasional lists', () => {
  const scene = ('Dehya: We need time, water, and a little patience.\n' +
    'Candace looked over at her. The room was quiet.\n').repeat(120);
  assert.equal(hasRunawayWordList(scene), false);
});
