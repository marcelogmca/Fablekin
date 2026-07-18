const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { initializePlugins } = require('./loader.js');

async function writePlugin(root, folder, source) {
    const pluginDir = path.join(root, folder);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'index.js'), source, 'utf8');
}

test('does not satisfy hard dependencies when a plugin fails to register', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-loader-'));
    const calls = [];
    const pluginManager = {
        plugins: new Map(),
        disabledPlugins: new Map(),
        async loadPlugin(pluginPath) {
            calls.push(path.basename(pluginPath));
            return false;
        }
    };

    try {
        await writePlugin(pluginsDir, 'broken_dependency', `module.exports = {
            id: 'broken_dependency', name: 'Broken Dependency', version: '1.0.0'
        };`);
        await writePlugin(pluginsDir, 'dependent_plugin', `module.exports = {
            id: 'dependent_plugin', name: 'Dependent Plugin', version: '1.0.0',
            dependencies: ['broken_dependency']
        };`);

        await initializePlugins(pluginManager, pluginsDir);

        assert.deepEqual(calls, ['broken_dependency']);
        assert.equal(pluginManager.disabledPlugins.get('broken_dependency').bootError, 'Plugin failed to load or register.');
        assert.equal(pluginManager.disabledPlugins.get('dependent_plugin').bootError, 'Missing dependencies: broken_dependency');
    } finally {
        await fs.rm(pluginsDir, { recursive: true, force: true });
    }
});
