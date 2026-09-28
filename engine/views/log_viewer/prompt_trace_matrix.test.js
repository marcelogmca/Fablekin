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

test('semantic rollup: leaf parent chain preserved, each byte counted once', () => {
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
    const matrix = Matrix.buildMatrix([call]);
    // Both leaves roll under one family row; chars sum without double count
    const totalChars = matrix.columns[0].totalChars;
    assert.equal(totalChars, 100);
    let cellChars = 0;
    for (const [, cell] of matrix.columns[0].cells) {
        if (cell.pieces.length) cellChars += cell.chars;
    }
    assert.equal(cellChars, 100);
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
