const test = require('node:test');
const assert = require('node:assert');

const Matrix = require('./prompt_trace_matrix.js');
const { buildTokenMapReport } = require('./prompt_trace_export.js');

function makeTrace({ components, occurrences, spans }) {
    return { promptId: 'p', hash: 'h', characterCount: 0, callId: 'c1', manifest: { version: 1, components, occurrences, spans } };
}

test('report contains every section and the honesty guide', () => {
    const components = {
        'root.canon': { id: 'root.canon', parent: 'root', label: 'Canon', owner: 'core' },
        'wst.ctx': { id: 'wst.ctx', parent: 'root.simulation', label: 'World state context', owner: 'world_state_tracker' }
    };
    const trace = makeTrace({
        components,
        occurrences: [
            { occurrenceId: 'o1', componentId: 'root.canon', instanceKey: null, containerOccurrenceId: null },
            { occurrenceId: 'o2', componentId: 'wst.ctx', instanceKey: null, containerOccurrenceId: null }
        ],
        spans: [
            { occurrenceId: 'o1', messageIndex: 0, start: 0, end: 300 },
            { occurrenceId: 'o2', messageIndex: 0, start: 300, end: 400 }
        ]
    });
    const calls = [{
        title: 'Writer',
        request: { payload: { promptTrace: trace } },
        response: { payload: { usage: { prompt_tokens: 1000, completion_tokens: 200, reasoning_tokens: 50 }, model: 'm', provider: 'nano_gpt' } },
        error: null,
        trace
    }];
    const matrix = Matrix.buildMatrix(calls);
    const report = buildTokenMapReport({
        project: 'proj', turnId: 'turn_1', sourceLabel: 'logs/proj/turn_1.json', log: null, calls, matrix, pricing: {}
    });

    ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.'].forEach((section) => assert.ok(report.includes(section), section));
    assert.match(report, /span-proportional attributions/);
    assert.match(report, /`·` = no bytes/);
    assert.match(report, /Writer/);
    assert.match(report, /~tokens/);
    // Leaf spans appear in the per-call detail.
    assert.match(report, /spans=\[msg0:0-300\]/);
    assert.match(report, /spans=\[msg0:300-400\]/);
});

test('report labels untraced calls instead of inventing payload numbers', () => {
    const calls = [{
        title: 'Legacy', request: { payload: {} },
        response: { payload: { usage: { prompt_tokens: 500, completion_tokens: 100 } } }, error: null, trace: null
    }];
    const matrix = Matrix.buildMatrix(calls);
    const report = buildTokenMapReport({ project: 'p', turnId: 't', calls, matrix, pricing: {} });
    assert.match(report, /untraced: 1/);
    assert.match(report, /No trace \(unattributed or no usage\)\./);
});

test('report shows price when pricing is known and n/a otherwise', () => {
    const trace = makeTrace({
        components: { 'root.canon': { id: 'root.canon', parent: 'root', label: 'Canon', owner: 'core' } },
        occurrences: [{ occurrenceId: 'o1', componentId: 'root.canon', instanceKey: null, containerOccurrenceId: null }],
        spans: [{ occurrenceId: 'o1', messageIndex: 0, start: 0, end: 100 }]
    });
    const calls = [{
        title: 'Writer', request: { payload: { promptTrace: trace } },
        response: { payload: { usage: { prompt_tokens: 1000, completion_tokens: 100 }, model: 'm', provider: 'nano_gpt' } },
        error: null, trace
    }];
    const matrix = Matrix.buildMatrix(calls);
    const withPrice = buildTokenMapReport({
        project: 'p', turnId: 't', calls, matrix,
        pricing: { nano_gpt: { m: { input: 1, output: 2, cache_read: 0.1 } } }
    });
    assert.ok(!withPrice.includes('n/a (no local pricing for this route)'));
    assert.match(withPrice, /- price: total \$/);

    const noPrice = buildTokenMapReport({ project: 'p', turnId: 't', calls, matrix, pricing: {} });
    assert.match(noPrice, /n\/a \(no local pricing for this route\)/);
});
