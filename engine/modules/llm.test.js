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
    { thinking: { type: 'disabled' } }
  );
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning_effort: 'none' }),
    { thinking: { type: 'disabled' } }
  );
  // A caller-supplied thinking flag is never overwritten.
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'none' }, thinking: { type: 'enabled' } }),
    { thinking: { type: 'enabled' } }
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
  // 'off' is a real level on reasoning-off-capable models (DeepSeek); it must
  // pass through, never be swallowed.
  assert.deepEqual(
    normalizeReasoningParamsForProvider('generic', { reasoning: { effort: 'off' } }),
    { reasoning_effort: 'off' }
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

test('forwards token and reasoning deltas without changing the resolved content', async () => {
  const seen = [];
  const model = {
    invoke: async (_messages, options) => {
      const callbacks = options?.callbacks || [];
      assert.equal(callbacks.length, 1);
      // The handler must opt into streaming or BaseChatModel takes the
      // non-streaming path and handleLLMNewToken never fires.
      assert.equal(callbacks[0]?.lc_prefer_streaming, true);
      const handler = callbacks[0]?.handleLLMNewToken;
      assert.equal(typeof handler, 'function');
      handler('Hello ', 0, 'run-1', null, null, { chunk: { text: 'Hello ' } });
      handler('', 1, 'run-1', null, null, {
        chunk: { additional_kwargs: { reasoning_content: 'thinking…' } }
      });
      handler('world', 2, 'run-1', null, null, { chunk: { text: 'world' } });
      return { content: 'Hello world' };
    }
  };

  const result = await invokeModelWithDeadline(model, [], {
    timeout: 1000,
    onToken: (delta) => seen.push(delta)
  });
  assert.equal(result.content, 'Hello world');
  assert.deepEqual(seen, [
    { content: 'Hello ', reasoning: '' },
    { content: '', reasoning: 'thinking…' },
    { content: 'world', reasoning: '' }
  ]);
});

test('omits callbacks entirely when no token sink is registered', async () => {
  let receivedOptions = null;
  const model = {
    invoke: async (_messages, options) => {
      receivedOptions = options;
      return { content: 'ok' };
    }
  };

  await invokeModelWithDeadline(model, [], { timeout: 1000 });
  assert.equal(receivedOptions?.callbacks, undefined);
});

test('liveTracker accumulates full streamed reasoning and peeks it back', () => {
  const liveTracker = require('./llm_live_tracker.js');
  const callId = liveTracker.start({ title: 'reasoning-probe', callingModule: 'test', model: 'm', provider: 'generic' });
  liveTracker.chunk(callId, { content: 'Hi', reasoning: '' });
  liveTracker.chunk(callId, { content: '', reasoning: 'think one ' });
  liveTracker.chunk(callId, { content: '', reasoning: 'think two' });
  assert.equal(liveTracker.peekStreamedReasoning(callId), 'think one think two');
  const summary = liveTracker.end(callId, { status: 'done', model: 'm', provider: 'generic' });
  assert.equal(summary.streamedReasoning, 'think one think two');
  assert.equal(summary.streamedReasoningTruncated, false);
  // Buffer is consumed at end; nothing leaks into the next call.
  assert.equal(liveTracker.peekStreamedReasoning(callId), null);
});

test('liveTracker retry reset clears streamed reasoning', () => {
  const liveTracker = require('./llm_live_tracker.js');
  const callId = liveTracker.start({ title: 'retry-probe', callingModule: 'test', model: 'm', provider: 'generic' });
  liveTracker.chunk(callId, { reasoning: 'stale thought' });
  liveTracker.update(callId, { status: 'retrying', attempt: 2 });
  assert.equal(liveTracker.peekStreamedReasoning(callId), null);
  liveTracker.end(callId, { status: 'done', model: 'm', provider: 'generic' });
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
