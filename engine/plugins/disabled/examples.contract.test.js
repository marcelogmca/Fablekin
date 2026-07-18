const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPluginMetadataSafely } = require('../../modules/plugin_manager/runtime/loader');

const DISABLED_ROOT = __dirname;
const ACTIVE_ROOT = path.resolve(__dirname, '..');
const EXPECTED = [
    'example_background_job',
    'example_custom_file_type',
    'example_custom_view',
    'example_director_integration',
    'example_pixi_intercept',
    'example_plugin_api',
    'example_plugin_api_consumer',
    'example_plugin_documentation',
    'example_plugin_settings',
    'example_plugin_state',
    'example_prompt_llm',
    'example_secret_storage',
    'example_terminal_commands',
    'example_vn_client_events',
    'example_vn_frontend_injection',
    'example_vn_gui_intercept'
];
const SUPPORTED_CATEGORIES = new Set([
    'Narrative', 'Characters', 'World', 'Visual', 'Audio', 'Utility', 'Gameplay', 'Uncategorized'
]);

function exampleDirectories() {
    return fs.readdirSync(DISABLED_ROOT, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('example_'))
        .map(entry => entry.name)
        .sort();
}

function dependencyExists(id) {
    return fs.existsSync(path.join(ACTIVE_ROOT, id, 'index.js'))
        || fs.existsSync(path.join(DISABLED_ROOT, id, 'index.js'));
}

test('the disabled example suite contains the expected canonical IDs', () => {
    assert.deepEqual(exampleDirectories(), [...EXPECTED].sort());
});

test('metadata discovery preserves example and developer grouping flags', async () => {
    const metadata = await readPluginMetadataSafely(
        path.join(DISABLED_ROOT, 'example_plugin_settings'),
        ACTIVE_ROOT
    );
    assert.equal(metadata.isExamplePlugin, true);
    assert.equal(metadata.isTestPlugin, false);
    assert.equal(metadata.experimental, false);
    assert.equal(metadata.isDeveloperPlugin, true);
});

for (const id of EXPECTED) {
    test(id + ' satisfies the public example contract', async () => {
        const root = path.join(DISABLED_ROOT, id);
        const plugin = require(path.join(root, 'index.js'));
        const discovered = await readPluginMetadataSafely(root, ACTIVE_ROOT);

        assert.equal(plugin.id, id);
        assert.equal(discovered.id, id);
        assert.equal(discovered.isExamplePlugin, true);
        assert.match(plugin.id, /^example_[a-z0-9_]+$/);
        assert.match(plugin.name, /^Example: /);
        assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
        assert.equal(typeof plugin.author, 'string');
        assert.ok(plugin.author.trim());
        assert.ok(SUPPORTED_CATEGORIES.has(plugin.category));
        assert.equal(typeof plugin.description, 'string');
        assert.ok(plugin.description.trim());
        assert.equal(plugin.isExamplePlugin, true);
        assert.equal(plugin.experimental, undefined);
        assert.ok(fs.existsSync(path.join(root, 'README.md')));

        for (const hook of Object.values(plugin.hooks || {})) {
            assert.equal(typeof hook.run, 'function');
        }
        for (const command of Object.values(plugin.terminalCommands || {})) {
            assert.equal(typeof command.run, 'function');
        }
        for (const document of plugin.documentation || []) {
            assert.ok(fs.existsSync(path.join(root, document.path)), document.path);
        }
        for (const view of plugin.views || []) {
            assert.ok(fs.existsSync(path.join(root, view.entry)), view.entry);
        }
        for (const dependency of [
            ...(plugin.dependencies || []),
            ...(plugin.optionalDependencies || [])
        ]) {
            const dependencyId = typeof dependency === 'string' ? dependency : dependency.id;
            assert.ok(dependencyExists(dependencyId), dependencyId);
        }
    });
}

test('LLM examples use aliases without persisted provider routing', () => {
    for (const id of ['example_prompt_llm', 'example_vn_gui_intercept']) {
        const root = path.join(DISABLED_ROOT, id);
        const source = fs.readdirSync(root)
            .filter(name => name.endsWith('.js'))
            .map(name => fs.readFileSync(path.join(root, name), 'utf8'))
            .join('\n');
        assert.match(source, /llm-aliases/);
        assert.doesNotMatch(source, /provider\s*:/);
        assert.doesNotMatch(source, /openrouter|nano_gpt/i);
    }
});
