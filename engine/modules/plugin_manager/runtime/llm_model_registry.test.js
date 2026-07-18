const assert = require('assert');
const { createLlmModelRegistry } = require('./llm_model_registry.js');
const { resolveModelAlias: resolveFromSettings } = require('../../model_routing.js');

function makeFixture() {
    const settings = {
        infrastructure: {
            providers: { openrouter: {}, nano_gpt: {} },
            llm_routing: {
                aliases: {
                    lowendmodel: { provider: 'openrouter', model: 'vendor/low' },
                    mediumendmodel: { provider: 'openrouter', model: 'vendor/medium' },
                    highendmodel: { provider: 'openrouter', model: 'vendor/high', subprovider: 'upstream-a' },
                    veryhighendmodel: { provider: 'nano_gpt', model: 'vendor/very-high', subprovider: 'upstream-b' }
                }
            }
        },
        narrative_agents: {
            writer: { model: 'veryhighendmodel' },
            vn_background_tasks: { model: 'highendmodel' },
            asset_selector: { background_model: 'mediumendmodel', ost_model: 'highendmodel' }
        },
        plugins: {
            checker: { model_def: { inherit: 'vn_background' } },
            multi_model: { quality_model: { model: 'highendmodel' } }
        }
    };
    const plugins = new Map([
        ['checker', { id: 'checker', settingsSchema: {
            model_def: { options: 'llm-aliases', allowVnBackgroundModel: true, default: { model: 'mediumendmodel' } }
        }}],
        ['multi_model', { id: 'multi_model', settingsSchema: {
            quality_model: { options: 'llm-aliases', default: { model: 'highendmodel' } }
        }}]
    ]);
    const pluginManager = { plugins, disabledPlugins: new Map() };
    const registry = createLlmModelRegistry({
        pluginManager,
        readSettings: () => settings,
        resolveModelAlias: alias => resolveFromSettings(settings, alias)
    });
    return { settings, registry };
}

function runTest(name, fn) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}`); throw error; }
}

runTest('returns a resolved core model assignment', () => {
    const { registry } = makeFixture();
    const writer = registry.getCoreModel('writer');
    assert.strictEqual(writer.model, 'veryhighendmodel');
    assert.strictEqual(writer.provider, 'nano_gpt');
    assert.strictEqual(writer.resolvedModel, 'vendor/very-high');
});

runTest('resolves multi-role core assignments', () => {
    const { registry } = makeFixture();
    assert.strictEqual(registry.getCoreModel('asset_selector', 'background').model, 'mediumendmodel');
    assert.strictEqual(registry.getCoreModel('asset_selector', 'ost').resolvedModel, 'vendor/high');
});

runTest('resolves VN background inheritance without persisting a provider', () => {
    const { registry } = makeFixture();
    const checker = registry.getPluginModel('checker');
    assert.strictEqual(checker.inheritedFrom, 'vn_background');
    assert.strictEqual(checker.model, 'highendmodel');
    assert.strictEqual(checker.provider, 'openrouter');
    assert.deepStrictEqual(checker.definition, { inherit: 'vn_background' });
});

runTest('resolves provider-free plugin model definitions', () => {
    const { registry } = makeFixture();
    const assignment = registry.resolveDefinition({ model: 'mediumendmodel' });
    assert.strictEqual(assignment.provider, 'openrouter');
    assert.strictEqual(assignment.resolvedModel, 'vendor/medium');
    assert.deepStrictEqual(assignment.definition, { model: 'mediumendmodel' });
    assert.strictEqual(registry.getPluginModel('multi_model', 'quality_model').resolvedModel, 'vendor/high');
});

runTest('returns null for missing assignments', () => {
    const { registry } = makeFixture();
    assert.strictEqual(registry.getCoreModel('missing'), null);
    assert.strictEqual(registry.getPluginModel('checker', 'missing'), null);
});
