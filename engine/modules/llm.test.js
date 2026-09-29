const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRouteReasoningEffort,
  DEFAULT_LLM_TIMEOUT_MS,
  getProviderInstance,
  isFallbackEligibleError,
  invokeModelWithDeadline,
  normalizeOpenAICompatibleBaseUrl,
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
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'minimal' } }),
    { reasoning_effort: 'low' }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'none' } }),
    {}
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning_effort: 'none' }),
    {}
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning_effort: 'minimal' }),
    { reasoning_effort: 'low' }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'medium' } }),
    { reasoning_effort: 'medium' }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'xhigh' } }),
    { reasoning_effort: 'xhigh' }
  );
});

test('unwinds an OpenAI-compatible URL that already points at the chat route', () => {
  // The OpenAI SDK appends /chat/completions to baseURL, so a URL pasted from a
  // curl example must not be requested twice over.
  assert.equal(
    normalizeOpenAICompatibleBaseUrl('https://api.commandcode.ai/provider/v1/chat/completions'),
    'https://api.commandcode.ai/provider/v1'
  );
  assert.equal(
    normalizeOpenAICompatibleBaseUrl('https://api.commandcode.ai/provider/v1/chat/completions/'),
    'https://api.commandcode.ai/provider/v1'
  );
  assert.equal(normalizeOpenAICompatibleBaseUrl('https://api.deepseek.com/v1/chat/completions'), 'https://api.deepseek.com/v1');
  assert.equal(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
  assert.equal(normalizeOpenAICompatibleBaseUrl('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234/v1');
  assert.equal(normalizeOpenAICompatibleBaseUrl(''), '');
  assert.equal(normalizeOpenAICompatibleBaseUrl(undefined), '');
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

test('generic provider instantiates from a URL with an optional key', () => {
  const withUrlNoKey = getProviderInstance('generic', null, {
    infrastructure: { providers: { generic: { url: 'http://127.0.0.1:1234/v1/' } } }
  });
  assert.ok(withUrlNoKey, 'URL alone should instantiate');
  assert.equal(
    withUrlNoKey.lc_kwargs?.configuration?.baseURL,
    'http://127.0.0.1:1234/v1',
    'trailing slashes are trimmed'
  );

  const withUrlAndKey = getProviderInstance('generic', null, {
    infrastructure: { providers: { generic: { url: 'https://example.com/v1', apiKey: 'sk-test' } } }
  });
  assert.ok(withUrlAndKey, 'URL plus key should instantiate');

  assert.equal(
    getProviderInstance('generic', null, { infrastructure: { providers: { generic: {} } } }),
    null,
    'missing URL means the provider is unavailable'
  );
  assert.equal(
    getProviderInstance('generic', null, { infrastructure: { providers: {} } }),
    null,
    'missing entry means the provider is unavailable'
  );
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
