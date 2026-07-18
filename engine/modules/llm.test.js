const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOpenRouterReasoningModel, resolveCallProviderKey } = require('./llm.js');

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

test('translates OpenRouter no-thinking suffix variants into reasoning effort none', () => {
  for (const suffix of [':nothinking', ':no_thinking', ':no-thinking']) {
    const result = normalizeOpenRouterReasoningModel(`deepseek/deepseek-v4-flash${suffix}`, {
      reasoning: { max_tokens: 64, effort: 'high' }
    });

    assert.equal(result.model, 'deepseek/deepseek-v4-flash');
    assert.deepEqual(result.extra, {
      reasoning: { max_tokens: 64, effort: 'none' }
    });
  }
});

test('leaves ordinary model names unchanged', () => {
  const extra = { reasoning: { max_tokens: 64 } };
  const result = normalizeOpenRouterReasoningModel('deepseek/deepseek-v4-flash', extra);

  assert.equal(result.model, 'deepseek/deepseek-v4-flash');
  assert.deepEqual(result.extra, extra);
});
