// The LLM road is browser ESM with DOM dependencies, so it is loaded here the
// same way the viewer loads it: strip the module plumbing, stub state/elements,
// and assert the formatting + chunk handling the streaming display depends on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, 'llm_road_manager.js'), 'utf8');

function loadRoad() {
  let src = SOURCE
    .replace(/^import .*$/gm, '')
    .replace(/\bexport function /g, 'function ')
    .replace(/\bexport const /g, 'const ')
    .replace(/window\.addEventListener[^;]*;/g, '')
    .replace(/^\s*const \{ state, runtime \} = .*$/gm, '');

  const state = {
    llmCalls: new Map(),
    isGenerationPhase: true,
    llmRunStartTime: null,
    llmRunId: null,
    llmSequence: 0,
    llmFollowMode: true,
    llmRoadFrozen: false,
    llmRoadFrozenAt: null,
  };
  const runtime = {};

  const prelude = `
    const formatElapsedTime = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60) + 's' : s + 's';
    };
  `;

  const factory = new Function('state', 'elements', 'runtime',
    `${prelude}\n${src}\nreturn { handleLlmUpdate, buildTooltip, statusChip, stopLlmRoadTicker };`);
  return { api: factory(state, {}, runtime), state };
}

function startCall(api, overrides = {}) {
  api.handleLlmUpdate({
    type: 'start',
    callId: 'c1',
    title: 'Director (Analysis)',
    callingModule: 'Director_Analysis',
    model: 'deepseek/deepseek-v4.1-flash-fast',
    provider: 'generic',
    attempt: 1,
    maxAttempts: 5,
    startTime: Date.now() - 4000,
    blocking: true,
    ...overrides,
  });
}

test('lane tooltip shows reasoning and output tails without throwing', () => {
  const { api, state } = loadRoad();
  startCall(api);
  api.handleLlmUpdate({
    type: 'chunk',
    callId: 'c1',
    outputTail: 'Ari opens the door.',
    reasoningTail: 'First I consider the door.',
    streamChars: 400,
    streamTokens: 42,
    streamFirstAt: Date.now() - 3000,
    streamLastAt: Date.now(),
    streamRate: 14,
  });

  const call = state.llmCalls.get('c1');
  const tooltip = api.buildTooltip(call, 4000);

  assert.match(tooltip, /Director \(Analysis\)/, 'header preserved');
  assert.match(tooltip, /attempt 1\/5/);
  assert.match(tooltip, /THINKING \(tail\):/);
  assert.match(tooltip, /First I consider the door\./);
  assert.match(tooltip, /OUTPUT \(tail\):/);
  assert.match(tooltip, /Ari opens the door\./);
  assert.match(tooltip, /deltas/);

  // The tooltip renderer splits the stream sections out by these exact marker
  // lines, so they must each be a line of their own.
  const lines = tooltip.split('\n');
  assert.ok(lines.includes('THINKING (tail):'), 'thinking marker is its own line');
  assert.ok(lines.includes('OUTPUT (tail):'), 'output marker is its own line');

  api.stopLlmRoadTicker();
});

test('a running lane with no deltas yet still renders a header-only tooltip', () => {
  const { api, state } = loadRoad();
  startCall(api);
  const call = state.llmCalls.get('c1');
  const tooltip = api.buildTooltip(call, 1000);
  assert.match(tooltip, /elapsed 1s/);
  assert.doesNotMatch(tooltip, /tail/, 'no tail sections before any delta');
  api.stopLlmRoadTicker();
});

test('status chip surfaces the delta count so streaming is visible without hovering', () => {
  const { api, state } = loadRoad();
  startCall(api);
  assert.equal(api.statusChip(state.llmCalls.get('c1')), 'running');
  api.handleLlmUpdate({ type: 'chunk', callId: 'c1', outputTail: 'x', streamTokens: 12 });
  assert.match(api.statusChip(state.llmCalls.get('c1')), /running.*12 tok/);
  api.stopLlmRoadTicker();
});

test('retry clears the previous attempt tail', () => {
  const { api, state } = loadRoad();
  startCall(api);
  api.handleLlmUpdate({ type: 'chunk', callId: 'c1', outputTail: 'partial', reasoningTail: 'thought', streamTokens: 5 });
  api.handleLlmUpdate({ type: 'retry', callId: 'c1', attempt: 2 });
  const call = state.llmCalls.get('c1');
  assert.equal(call.outputTail, '');
  assert.equal(call.reasoningTail, '');
  assert.equal(call.streamTokens, 0);
  api.stopLlmRoadTicker();
});

test('unknown callIds are ignored', () => {
  const { api, state } = loadRoad();
  api.handleLlmUpdate({ type: 'chunk', callId: 'nope', outputTail: 'x' });
  assert.equal(state.llmCalls.size, 0);
  api.stopLlmRoadTicker();
});
