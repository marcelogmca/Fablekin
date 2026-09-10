const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSocketHandlers } = require('./socket_plugin_handlers.js');

function makeHandlers(views) {
    return createPluginSocketHandlers({
        Logger: { log() {}, error() {} },
        pluginManager: { getRegisteredViews: () => views },
        scriptSecurity: {}, sendUiNotification() {}, invalidateFrontendInjectionCache() {},
        getRootDirectory: () => null, getProjectName: () => 'Test', contentManager: {}, fs: {},
        resolvePathInsideRoot() {}, isSafeExtension() { return true; }
    });
}

test('get-plugin-views replies through the acknowledgement callback used by the shell', () => {
    const views = [{ pluginId: 'character_cortex', id: 'character_cortex_lab', label: 'Character Cortex', entry: '/plugins/character_cortex/ui.html' }];
    const handlers = makeHandlers(views);
    let acknowledged;
    handlers.getPluginViews({ emit() { throw new Error('event fallback should not be used'); } }, null, value => { acknowledged = value; });
    assert.deepEqual(acknowledged, views);
});

test('get-plugin-views retains event fallback for clients without acknowledgements', () => {
    const views = [{ pluginId: 'character_cortex' }];
    const handlers = makeHandlers(views);
    let emitted;
    handlers.getPluginViews({ emit: (...args) => { emitted = args; } }, null, null);
    assert.deepEqual(emitted, ['plugin-views', views]);
});

test('get-plugin-views accepts acknowledgement as the first argument for legacy callers', () => {
    const views = [{ pluginId: 'character_cortex' }];
    const handlers = makeHandlers(views);
    let acknowledged;
    handlers.getPluginViews({ emit() { throw new Error('event fallback should not be used'); } }, value => { acknowledged = value; });
    assert.deepEqual(acknowledged, views);
});
