const assert = require('assert');
const { buildInvocations } = require('./log_arena_pairing.js');

const entry = (timestamp, content, pluginId = 'plugin') => ({ timestamp, payload: { content, model: 'm', provider: 'p', diagnostics: { pluginId } } });
const data = {
    'Quest [A] - Request': [
        entry('2026-01-01T00:00:01.000Z', [{ role: 'user', content: 'one' }]),
        entry('2026-01-01T00:00:03.000Z', [{ role: 'user', content: 'two' }])
    ],
    'Quest [A] - Response': [
        entry('2026-01-01T00:00:02.000Z', 'answer one'),
        entry('2026-01-01T00:00:04.000Z', 'answer two')
    ],
    'Quest [B] - Request': [entry('2026-01-01T00:00:05.000Z', [{ role: 'user', content: 'three' }])],
    'Quest [B] - Error': [entry('2026-01-01T00:00:06.000Z', { message: 'failed' })]
};

const aggregate = buildInvocations(data, 'Quest', { projectName: 'project', filename: 'turn.json', getMetrics: () => ({ duration: 1 }) });
assert.strictEqual(aggregate.length, 3);
assert.strictEqual(aggregate[0].response.payload.content, 'answer one');
assert.strictEqual(aggregate[1].response.payload.content, 'answer two');
assert.strictEqual(aggregate[2].error.payload.content.message, 'failed');
assert.strictEqual(aggregate[2].requestTitle, 'Quest [B] - Request');
assert.strictEqual(aggregate[0].projectName, 'project');

const exact = buildInvocations(data, 'Quest [A] - Request', { exactRequestTitle: true });
assert.strictEqual(exact.length, 2);
assert.strictEqual(exact.every(item => item.requestTitle === 'Quest [A] - Request'), true);

console.log('ok - log arena pairing');
