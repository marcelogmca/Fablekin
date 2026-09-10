const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectSelectHandler } = require('./project_select_handler.js');

test('publishes the project root to plugins before reloading plugin webviews', async () => {
    const calls = [];
    const projectPath = 'C:\\workspace\\projects\\Demo';
    const handler = createProjectSelectHandler({
        fs: { access: async () => { calls.push('access'); } },
        path: {
            join: (...parts) => parts.includes('index.html') ? 'C:\\engine\\index.html' : projectPath
        },
        projectsRoot: 'C:\\workspace\\projects',
        engineDir: 'C:\\engine',
        VectorStoreManager: { setProjectRoot: () => calls.push('vector-root') },
        Logger: { log() {}, error() {} },
        getProjectName: () => 'Demo',
        getMainWindow: () => ({
            loadFile: () => calls.push('load-window'),
            webContents: { once: () => calls.push('register-load-handler') }
        }),
        getRendererSocketQuery: () => ({}),
        runtimeSocketState: {},
        contentManager: {},
        pluginManager: {
            setProjectRoot: () => calls.push('plugin-root')
        },
        io: {},
        getStaticDataManager: () => null,
        setStaticDataManager() {},
        StaticDataManager: function StaticDataManager() {},
        chaptermanagement: {},
        initFactManager() {},
        emitResponse() {},
        setRootDirectory: () => calls.push('main-root'),
        invalidateFrontendInjectionCache() {},
        setMainCharacterName() {},
        setMainCharacterBio() {},
        setActiveChatPathGlobal() {}
    });

    await handler(null, { projectName: 'Demo' });

    assert.ok(calls.indexOf('plugin-root') > calls.indexOf('main-root'));
    assert.ok(calls.indexOf('plugin-root') < calls.indexOf('load-window'));
});
