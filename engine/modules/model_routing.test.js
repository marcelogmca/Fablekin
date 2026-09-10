const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('./llm_provider_presets.json');
const {
  BUILT_IN_MODEL_ALIASES,
  applyStarterProfile,
  listModelAliases,
  resolveModelAlias
} = require('./model_routing.js');

function makeSettings() {
  return {
    infrastructure: {
      providers: { nano_gpt: {}, openrouter: {}, openai: {}, anthropic: {}, gemini: {}, deepseek: {} },
      llm_routing: { aliases: {
        highendmodel: { provider: 'nano-gpt', model: 'vendor/high', subprovider: 'upstream-a', reasoning_effort: 'medium' },
        customhigh1: { provider: 'openrouter', model: 'vendor/custom' }
      }}
    }
  };
}

test('resolves built-in and custom aliases through one global registry', () => {
  const settings = makeSettings();
  assert.deepEqual(resolveModelAlias(settings, 'highendmodel'), {
    alias: 'highendmodel', provider: 'nano_gpt', model: 'vendor/high', subprovider: 'upstream-a', reasoning_effort: 'medium'
  });
  assert.equal(resolveModelAlias(settings, 'customhigh1').model, 'vendor/custom');
});

test('rejects unknown, malformed, incomplete, and unknown-provider aliases', () => {
  const settings = makeSettings();
  settings.infrastructure.llm_routing.aliases.lowendmodel = { provider: 'nano_gpt', model: '' };
  settings.infrastructure.llm_routing.aliases.mediumendmodel = { provider: 'missing', model: 'x' };
  assert.throws(() => resolveModelAlias(settings, 'missing'), /Unknown model alias/);
  assert.throws(() => resolveModelAlias(settings, 'Bad Alias'), /Invalid model alias/);
  assert.throws(() => resolveModelAlias(settings, 'lowendmodel'), /incomplete/);
  assert.throws(() => resolveModelAlias(settings, 'mediumendmodel'), /unknown provider/);
});

test('orders built-ins before custom aliases', () => {
  assert.deepEqual(listModelAliases(makeSettings()).map(item => item.alias), ['highendmodel', 'customhigh1']);
});

test('every provider preset supplies all four built-in aliases', () => {
  for (const [provider, profile] of Object.entries(presets)) {
    for (const alias of BUILT_IN_MODEL_ALIASES) assert.ok(profile[alias]?.model, `${provider}.${alias}`);
  }
});

test('starter profiles preserve custom aliases', () => {
  const settings = makeSettings();
  applyStarterProfile(settings, 'openai', presets.openai);
  assert.equal(settings.infrastructure.llm_routing.aliases.customhigh1.model, 'vendor/custom');
  assert.equal(settings.infrastructure.llm_routing.aliases.lowendmodel.provider, 'openai');
});

test('normalizes explicit reasoning effort and infers legacy suffixes', () => {
  const settings = makeSettings();
  settings.infrastructure.llm_routing.aliases.lowendmodel = { provider: 'openrouter', model: 'vendor/low:no_thinking' };
  settings.infrastructure.llm_routing.aliases.mediumendmodel = { provider: 'nano_gpt', model: 'vendor/medium', reasoningEffort: 'LOW' };
  assert.equal(resolveModelAlias(settings, 'lowendmodel').reasoning_effort, 'none');
  assert.equal(resolveModelAlias(settings, 'mediumendmodel').reasoning_effort, 'low');
});
