const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveProjectPluginStorage } = require('./tools_builder.js');

test('project plugin storage is isolated beneath the active project', () => {
    const root = path.resolve('workspace', 'projects', 'demo');
    const storage = resolveProjectPluginStorage(root, 'character_cortex', 'Demo');
    assert.equal(storage.absolutePath, path.join(root, 'plugins', 'character_cortex'));
    assert.equal(storage.relativePath, 'plugins/character_cortex');
    assert.equal(storage.projectName, 'Demo');
    assert.equal(storage.pluginId, 'character_cortex');
});

test('project plugin storage rejects traversal-shaped plugin ids', () => {
    const root = path.resolve('workspace', 'projects', 'demo');
    assert.throws(
        () => resolveProjectPluginStorage(root, '../escape', 'Demo'),
        /Invalid plugin id/
    );
});

test('project plugin storage requires an active project', () => {
    assert.throws(
        () => resolveProjectPluginStorage(null, 'character_cortex', 'Demo'),
        /No project root directory/
    );
});
