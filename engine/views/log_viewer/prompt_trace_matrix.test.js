'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Matrix = require('./prompt_trace_matrix.js');

function makeTrace({ occurrences, spans, components }) {
    return {
        callId: 'call-1',
        promptId: 'core.writer',
        hash: 'abc123',
        characterCount: 1000,
        manifest: { version: 2, promptId: 'core.writer', components, occurrences, spans, inclusions: [], messageFormats: [] }
    };
}

test('exclusive spans sum to owned chars; separators land in overhead, never in a piece', () => {
    const trace = makeTrace({
        components: {
            'root.simulation': { id: 'root.simulation', parent: 'root', label: 'Simulation', owner: 'core' },
            'wst.state': { id: 'wst.state', parent: 'root.simulation', label: 'State', owner: 'world_state_tracker' }
        },
        occurrences: [
            { occurrenceId: 'occ-1', componentId: 'wst.state', instanceKey: null, containerOccurrenceId: null }
        ],
        spans: [
            { occurrenceId: 'occ-1', messageIndex: 0, start: 0, end: 100 },
            { occurrenceId: null, messageIndex: 0, start: 100, end: 107 }
        ]
    });
    const call = {
        title: 'Writer', request: { payload: { promptTrace: trace } },
        response: { payload: { usage: { prompt_tokens: 1000, completion_tokens: 50 } } }, error: null, trace
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.status, 'measured');
    assert.equal(attr.pieces.length, 1);
    assert.equal(attr.pieces[0].chars, 100);
    assert.equal(attr.overheadChars, 7);
    // 100/107 of 1000 provider tokens attributed to the piece
    assert.ok(Math.abs(attr.pieces[0].tokens - (100 / 107) * 1000) < 1e-9);
    assert.ok(Math.abs(attr.overheadTokens - (7 / 107) * 1000) < 1e-9);
});

function threeLevelFixture() {
    const trace = makeTrace({
        components: {
            'root.simulation': { id: 'root.simulation', parent: 'root', label: 'Simulation', owner: 'core' },
            'wst.ctx': { id: 'wst.ctx', parent: 'root.simulation', label: 'Ctx', owner: 'wst' },
            'wst.ctx.time': { id: 'wst.ctx.time', parent: 'wst.ctx', label: 'Time', owner: 'wst' }
        },
        occurrences: [
            { occurrenceId: 'occ-1', componentId: 'wst.ctx', instanceKey: null, containerOccurrenceId: null },
            { occurrenceId: 'occ-2', componentId: 'wst.ctx.time', instanceKey: null, containerOccurrenceId: 'occ-1' }
        ],
        spans: [
            { occurrenceId: 'occ-1', messageIndex: 0, start: 0, end: 60 },
            { occurrenceId: 'occ-2', messageIndex: 0, start: 60, end: 100 }
        ]
    });
    const call = {
        title: 'W', request: { payload: { promptTrace: trace } },
        response: { payload: { usage: { prompt_tokens: 500 } } }, error: null, trace
    };
    return Matrix.buildMatrix([call]);
}

test('row tree nests to any depth and root cells sum to the provider total', () => {
    const matrix = threeLevelFixture();
    const byId = new Map(matrix.rows.map((row) => [row.id, row]));
    assert.deepEqual(matrix.rows.map((row) => row.id), ['root.simulation', 'wst.ctx', 'wst.ctx.time']);
    assert.equal(byId.get('root.simulation').depth, 0);
    assert.equal(byId.get('wst.ctx').depth, 1);
    assert.equal(byId.get('wst.ctx.time').depth, 2);
    assert.equal(byId.get('root.simulation').hasChildren, true);
    assert.equal(byId.get('wst.ctx').hasChildren, true);
    assert.equal(byId.get('wst.ctx.time').hasChildren, false);
    // Root-level cells sum to the whole column total; descendants are splits.
    let rootChars = 0;
    for (const row of matrix.rows) {
        if (row.depth !== 0) continue;
        rootChars += matrix.columns[0].cells.get(row.id).chars;
    }
    assert.equal(rootChars, 100);
    assert.equal(matrix.columns[0].cells.get('wst.ctx.time').chars, 40);
    assert.equal(matrix.columns[0].cells.get('root.simulation').chars, 100);
});

test('rollup attributes tokens so each subtree equals the sum of its leaves', () => {
    const matrix = threeLevelFixture();
    const root = matrix.columns[0].cells.get('root.simulation');
    const mid = matrix.columns[0].cells.get('wst.ctx');
    const leaf = matrix.columns[0].cells.get('wst.ctx.time');
    // 500 provider tokens over 100 chars: leaf 40 chars -> 200, mid's own 60
    // chars -> 300, so mid = 300 + 200 = 500 and root = 500.
    assert.ok(Math.abs(leaf.tokens - 200) < 1e-6, `leaf=${leaf.tokens}`);
    assert.ok(Math.abs(mid.tokens - 500) < 1e-6, `mid=${mid.tokens}`);
    assert.ok(Math.abs(root.tokens - 500) < 1e-6, `root=${root.tokens}`);
    assert.equal(root.chars, 100);
    assert.equal(mid.chars, 100);
    assert.equal(leaf.chars, 40);
});

test('same componentId across two calls links as shared', () => {
    const comps = {
        'root.simulation': { id: 'root.simulation', parent: 'root', label: 'Sim', owner: 'core' },
        'wst.state': { id: 'wst.state', parent: 'root.simulation', label: 'State', owner: 'wst' }
    };
    const occ = [{ occurrenceId: 'occ-1', componentId: 'wst.state', instanceKey: null, containerOccurrenceId: null }];
    const spans = [{ occurrenceId: 'occ-1', messageIndex: 0, start: 0, end: 50 }];
    const mk = (callId) => {
        const trace = makeTrace({ occurrences: occ, spans, components: comps });
        trace.callId = callId;
        return {
            title: callId, request: { payload: { promptTrace: trace }, timestamp: callId },
            response: { payload: { usage: { prompt_tokens: 200 } } }, error: null, trace
        };
    };
    const matrix = Matrix.buildMatrix([mk('a'), mk('b')]);
    assert.equal(matrix.shared.length, 1);
    assert.equal(matrix.shared[0].componentId, 'wst.state');
    assert.deepEqual(matrix.shared[0].columns, [0, 1]);
});

test('missing trace renders untraced, never zeros inside real pieces', () => {
    const call = {
        title: 'Legacy', request: { payload: { content: [] } },
        response: { payload: { usage: { prompt_tokens: 10 } } }, error: null, trace: null
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.status, 'untraced');
    assert.deepEqual(attr.pieces, []);
    const matrix = Matrix.buildMatrix([call]);
    assert.equal(matrix.columns[0].status, 'untraced');
});

test('dev-cache hit shows spans with zero provider tokens', () => {
    const trace = makeTrace({
        components: { 'a.b': { id: 'a.b', parent: 'root', label: 'B', owner: 'core' } },
        occurrences: [{ occurrenceId: 'occ-1', componentId: 'a.b', instanceKey: null, containerOccurrenceId: null }],
        spans: [{ occurrenceId: 'occ-1', messageIndex: 0, start: 0, end: 80 }]
    });
    const call = {
        title: 'Cached', request: { payload: { promptTrace: trace } },
        response: { payload: { usage: { is_local_cache: true, prompt_tokens: 0 } } }, error: null, trace
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.status, 'local-cache');
    assert.equal(attr.pieces[0].chars, 80);
    assert.equal(attr.pieces[0].tokens, null);
    assert.equal(attr.providerInputTokens, 0);
});

test('columns are ordered by provider input tokens, most consuming first', () => {
    const comps = { 'root.canon': { id: 'root.canon', parent: 'root', label: 'Canon', owner: 'core' } };
    const occ = [{ occurrenceId: 'occ-1', componentId: 'root.canon', instanceKey: null, containerOccurrenceId: null }];
    const mk = (title, chars, inputTokens) => {
        const trace = makeTrace({ occurrences: occ, spans: [{ occurrenceId: 'occ-1', messageIndex: 0, start: 0, end: chars }], components: comps });
        return {
            title, request: { payload: { promptTrace: trace }, timestamp: title },
            response: { payload: { usage: { prompt_tokens: inputTokens } } }, error: null, trace
        };
    };
    const matrix = Matrix.buildMatrix([mk('small', 10, 100), mk('huge', 10, 900), mk('mid', 10, 400)]);
    assert.deepEqual(matrix.columns.map((c) => c.title), ['huge', 'mid', 'small']);
});

test('call-level output/reasoning/cached tokens are extracted from usage', () => {
    const trace = makeTrace({ occurrences: [], spans: [], components: {} });
    const call = {
        title: 'W', request: { payload: { promptTrace: trace } },
        response: { payload: { usage: {
            prompt_tokens: 1000,
            completion_tokens: 800,
            cachedTokens: 250,
            completion_tokens_details: { reasoning_tokens: 600 }
        } } }, error: null, trace
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.outputTokens, 800);
    assert.equal(attr.reasoningTokens, 600);
    assert.equal(attr.cachedInputTokens, 250);
    assert.equal(attr.inputTokens, 1000);
});

test('untraced calls still expose call-level usage for the metric rows', () => {
    const call = {
        title: 'Legacy', request: { payload: {} },
        response: { payload: { usage: { prompt_tokens: 500, completion_tokens: 120, reasoning_tokens: 90 } } }, error: null, trace: null
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.status, 'untraced');
    assert.equal(attr.outputTokens, 120);
    assert.equal(attr.reasoningTokens, 90);
});

test('provider-reported cost is present-or-absent, never fabricated as zero', () => {
    assert.equal(Matrix.reportedCostFromUsage({ cost: 0.025426158080000004 }), 0.025426158080000004);
    assert.equal(Matrix.reportedCostFromUsage({}), null);
    assert.equal(Matrix.reportedCostFromUsage(null), null);
});

test('reasoning provenance distinguishes reported zero from absent', () => {
    assert.equal(Matrix.reasoningProvenanceFromUsage({ reasoning_tokens: 0 }), 'none');
    assert.equal(Matrix.reasoningProvenanceFromUsage({ reasoning_tokens: 600 }), 'reported');
    assert.equal(Matrix.reasoningProvenanceFromUsage({ prompt_tokens: 100 }), 'absent');
    assert.equal(Matrix.reasoningProvenanceFromUsage(null), 'absent');
});

test('failed attempts with no usage are cost-unknown, not zero-cost', () => {
    const call = {
        title: 'Arc', request: { payload: {} },
        response: null,
        error: { payload: { content: { attemptNumber: 2, message: 'nope' } } },
        trace: null
    };
    const attr = Matrix.attributeCall(call);
    assert.equal(attr.failedAttempts, 2);
    assert.equal(attr.costUnknown, true);
    assert.equal(attr.reportedCost, null);
    const matrix = Matrix.buildMatrix([call]);
    assert.equal(matrix.columns[0].costUnknown, true);
});

test('extractCalls joins request/response by callId', () => {
    const trace = makeTrace({ occurrences: [], spans: [], components: {} });
    trace.callId = 'xyz';
    const data = {
        'Writer - Request': [{ timestamp: 't1', payload: { promptTrace: trace } }],
        'Writer - Response': [{ timestamp: 't2', payload: { callId: 'xyz', usage: { prompt_tokens: 5 } } }]
    };
    const calls = Matrix.extractCalls(data);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].response.payload.usage.prompt_tokens, 5);
});
