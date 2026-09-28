const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRouteReasoningEffort,
  DEFAULT_LLM_TIMEOUT_MS,
  isFallbackEligibleError,
  invokeModelWithDeadline,
  normalizeOpenRouterReasoningModel,
  normalizeReasoningParamsForProvider,
  resolveCallProviderKey
} = require('./llm.js');

test('keeps the alias-derived provider when no legacy override is supplied', () => {
  assert.equal(resolveCallProviderKey('nano_gpt'), 'nano_gpt');
  assert.equal(resolveCallProviderKey('OpenRouter', null), 'openrouter');
});

test('accepts only a matching legacy provider argument', () => {
  assert.equal(resolveCallProviderKey('nano_gpt', 'nano-gpt'), 'nano_gpt');
  assert.throws(
    () => resolveCallProviderKey('nano_gpt', 'openrouter'),
    /Provider overrides are no longer supported/
  );
});

test('translates OpenRouter thinking suffix into reasoning effort high', () => {
  const result = normalizeOpenRouterReasoningModel('deepseek/deepseek-v4-pro:thinking', {
    temperature: 0.3
  });

  assert.equal(result.model, 'deepseek/deepseek-v4-pro');
  assert.deepEqual(result.extra, {
    temperature: 0.3,
    reasoning: { effort: 'high' }
  });
});

test('explicit reasoning effort takes precedence over OpenRouter suffix compatibility', () => {
  for (const suffix of [':nothinking', ':no_thinking', ':no-thinking']) {
    const result = normalizeOpenRouterReasoningModel(`deepseek/deepseek-v4-flash${suffix}`, {
      reasoning: { max_tokens: 64, effort: 'high' }
    });

    assert.equal(result.model, 'deepseek/deepseek-v4-flash');
    assert.deepEqual(result.extra, {
      reasoning: { max_tokens: 64, effort: 'high' }
    });
  }
});

test('leaves ordinary model names unchanged', () => {
  const extra = { reasoning: { max_tokens: 64 } };
  const result = normalizeOpenRouterReasoningModel('deepseek/deepseek-v4-flash', extra);

  assert.equal(result.model, 'deepseek/deepseek-v4-flash');
  assert.deepEqual(result.extra, extra);
});

test('applies alias reasoning effort without overriding per-call configuration', () => {
  assert.deepEqual(
    applyRouteReasoningEffort({ reasoning_effort: 'medium' }, { temperature: 0.2 }),
    { temperature: 0.2, reasoning: { effort: 'medium' } }
  );
  assert.deepEqual(
    applyRouteReasoningEffort({ reasoning_effort: 'high' }, { reasoning: { effort: 'none', max_tokens: 64 } }),
    { reasoning: { effort: 'none', max_tokens: 64 } }
  );
});

test('normalizes reasoning payloads for router and direct providers', () => {
  assert.deepEqual(
    normalizeReasoningParamsForProvider('nano_gpt', { reasoning: { effort: 'medium' } }),
    { reasoning: { effort: 'medium' } }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('openai', { reasoning: { effort: 'minimal' } }),
    { reasoning_effort: 'minimal' }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('deepseek', { reasoning: { effort: 'minimal' } }),
    { reasoning_effort: 'low' }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('anthropic', { reasoning: { effort: 'high' } }),
    {}
  );
});

test('identifies only transient provider failures as fallback eligible', () => {
  assert.equal(isFallbackEligibleError(new Error('503 The requested service is temporarily unavailable.')), true);
  assert.equal(isFallbackEligibleError({ status: 429, message: 'rate limited' }), true);
  assert.equal(isFallbackEligibleError(new Error('fetch failed: ECONNRESET')), true);
  assert.equal(isFallbackEligibleError(new Error('Failed to parse JSON')), false);
  assert.equal(isFallbackEligibleError(new Error('Custom validation function returned false')), false);
});

test('uses a five-minute default LLM deadline', () => {
  assert.equal(DEFAULT_LLM_TIMEOUT_MS, 300000);
});

test('enforces the application deadline even when the model never settles', async () => {
  let receivedSignal = null;
  const stuckModel = {
    invoke: (messages, options) => {
      receivedSignal = options.signal;
      return new Promise(() => {});
    }
  };

  await assert.rejects(
    invokeModelWithDeadline(stuckModel, [], { timeout: 20 }),
    error => error?.code === 'ETIMEDOUT' && error?.kind === 'timeout'
  );
  assert.equal(receivedSignal?.aborted, true);
});

test('clears the deadline after a successful model response', async () => {
  const model = {
    invoke: async () => ({ content: 'ok' })
  };

  const result = await invokeModelWithDeadline(model, [], { timeout: 1000 });
  assert.equal(result.content, 'ok');
});

test('prepared-only callLLM derives the provider payload and rejects raw messages', async () => {
  const { Prompt } = require('./prompt/prompt.js');
  const prepared = new Prompt({ id: 'core.writer' })
    .user(message => message.add('core.writer.current_action', 'Ari opens the door.'))
    .prepare();

  // The manifest never reaches the provider: only role/content cross the boundary.
  const providerPayload = prepared.messages.map(message => ({ role: message.role, content: message.content }));
  assert.deepEqual(providerPayload, [{ role: 'user', content: 'Ari opens the door.' }]);
  assert.ok(prepared.manifest.occurrences.length >= 1, 'provenance stays on the manifest, not the payload');

  // Prepared-only rule: raw message arrays and non-prepared prompts rejected.
  const { callLLM } = require('./llm.js');
  await assert.rejects(
    callLLM({ messages: providerPayload, model: 'veryhighendmodel' }),
    /requires a PreparedPrompt/
  );
  await assert.rejects(
    callLLM({ prompt: { messages: providerPayload }, model: 'veryhighendmodel' }),
    /requires a PreparedPrompt/
  );
});
