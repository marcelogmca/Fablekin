const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const pricing = require('./model_pricing.js');

test('defaults load the workspace table without metadata keys', () => {
  const defaults = pricing.getDefaultPricing();
  assert.ok(!('_comment' in defaults) && !('_schema' in defaults));
  assert.ok(Object.keys(defaults).length >= 7);
  assert.equal(defaults.generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
  assert.equal(defaults.generic['deepseek/deepseek-v4.1-flash-fast'].output, 0.58);
});

test('defaults are clones; callers cannot mutate the loader state', () => {
  const first = pricing.getDefaultPricing();
  first.generic['deepseek/deepseek-v4.1-flash'].input = 999;
  assert.equal(pricing.getDefaultPricing().generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
});

test('overlay merges per model without touching siblings', () => {
  const settings = {
    infrastructure: {
      model_costs: {
        generic: { 'deepseek/deepseek-v4.1-flash': { output: 1.23 } },
        brand_new: { 'some/model': { input: 1, output: 2 } }
      }
    }
  };
  const merged = pricing.getAllPricing(settings);
  assert.equal(merged.generic['deepseek/deepseek-v4.1-flash'].output, 1.23);
  assert.equal(merged.generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
  assert.equal(merged.generic['deepseek/deepseek-v4.1-flash-fast'].output, 0.58);
  assert.deepEqual(merged.brand_new['some/model'], { input: 1, output: 2 });
});

test('single-model lookup prefers overlay, falls back to defaults, null when unpriced', () => {
  const settings = { infrastructure: { model_costs: { generic: { 'deepseek/deepseek-v4.1-flash': { output: 9 } } } } };
  assert.equal(pricing.getModelPricing(settings, 'generic', 'deepseek/deepseek-v4.1-flash').output, 9);
  assert.equal(pricing.getModelPricing(settings, 'generic', 'deepseek/deepseek-v4.1-flash').input, 0.15);
  assert.equal(pricing.getModelPricing({}, 'generic', 'deepseek/deepseek-v4.1-flash-fast').input, 0.16);
  assert.equal(pricing.getModelPricing({}, 'nope', 'nope/model'), null);
  assert.equal(pricing.getModelPricing({}, null, 'x'), null);
});

test('missing or malformed overlay yields defaults unchanged', () => {
  assert.deepEqual(pricing.getAllPricing({}), pricing.getDefaultPricing());
  assert.deepEqual(pricing.getAllPricing({ infrastructure: { model_costs: 'junk' } }), pricing.getDefaultPricing());
});

test('missing workspace file falls back to the shipped seed', () => {
  const workspacePath = pricing.workspacePricingPath();
  try {
    fs.renameSync(workspacePath, workspacePath + '.bak');
    pricing.clearPricingCache();
    const defaults = pricing.getDefaultPricing();
    assert.ok(Object.keys(defaults).length >= 7);
    assert.equal(defaults.generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
  } finally {
    fs.renameSync(workspacePath + '.bak', workspacePath);
    pricing.clearPricingCache();
  }
});

test('workspace file reloads on change and broken JSON falls back without crashing', () => {
  const workspacePath = pricing.workspacePricingPath();
  assert.ok(workspacePath.endsWith('model_pricing.json'));
  const backup = fs.readFileSync(workspacePath, 'utf8');
  try {
    pricing.clearPricingCache();
    const edited = JSON.parse(backup);
    edited.generic['deepseek/deepseek-v4.1-flash'].input = 7.77;
    fs.writeFileSync(workspacePath, JSON.stringify(edited));
    pricing.clearPricingCache();
    assert.equal(pricing.getDefaultPricing().generic['deepseek/deepseek-v4.1-flash'].input, 7.77);

    fs.writeFileSync(workspacePath, '{broken json');
    pricing.clearPricingCache();
    assert.equal(pricing.getDefaultPricing().generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
  } finally {
    fs.writeFileSync(workspacePath, backup);
    pricing.clearPricingCache();
  }
  assert.equal(pricing.getDefaultPricing().generic['deepseek/deepseek-v4.1-flash'].input, 0.15);
});
