const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('./summarization_service.js');

test('current-turn summaries receive only the supplied chapter text', () => {
    const messages = _private.buildCurrentTurnSummaryMessages('Mira crosses the bridge.');

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.equal(messages[1].content, 'Mira crosses the bridge.');
    assert.doesNotMatch(messages[1].content, /shared VN|history|canon/i);
});
