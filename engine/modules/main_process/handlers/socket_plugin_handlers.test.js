const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPluginSocketHandlers } = require('./socket_plugin_handlers.js');

test('plugin file conversion persists the target mode inside the structured files map', async () => {
    const rootDirectory = path.resolve('test-project');
    const oldPath = path.join(rootDirectory, 'Lore.md');
    const newPath = path.join(rootDirectory, 'Lore.db');
    const savedConfigs = [];
    const hookCalls = [];
    const responses = [];
    const fileModes = new Map([
        ['custom_database', {
            pluginId: 'test_plugin',
            conversion: { targetExtension: '.db' }
        }]
    ]);

    const handlers = createPluginSocketHandlers({
        Logger: { log() {}, error() {} },
        pluginManager: {
            registeredFileModes: fileModes,
            getRegisteredFileModes: () => Object.fromEntries(fileModes),
            executeHook: async (...args) => hookCalls.push(args)
        },
        emitResponse: (event, payload) => responses.push({ event, payload }),
        getProjectName: () => 'test-project',
        getRootDirectory: () => rootDirectory,
        isSafeExtension: (extension) => extension === '.db',
        resolvePathInsideRoot: (candidate) => path.resolve(candidate),
        fs: {
            writeFile: async () => {},
            unlink: async () => {}
        },
        contentManager: {
            loadFileConfig: async () => ({
                files: {
                    [oldPath]: { mode: 'full', order: 400 }
                },
                ui: { advanced_mode: false }
            }),
            saveFileConfig: async (_root, config) => savedConfigs.push(config),
            processDirectory: async () => ({ structure: [], config: { files: {} } })
        }
    });

    await handlers.requestFileConversion(null, {
        filePath: oldPath,
        targetExtension: '.db',
        targetMode: 'custom_database'
    });

    assert.equal(savedConfigs.length, 1);
    assert.deepEqual(savedConfigs[0].files[newPath], {
        mode: 'custom_database',
        order: 400,
        lockedMode: 'custom_database'
    });
    assert.equal(savedConfigs[0].files[oldPath], undefined);
    assert.deepEqual(savedConfigs[0].ui, { advanced_mode: false });
    assert.equal(hookCalls[0][0], 'HOOK_FILE_CONVERTED');
    assert.equal(hookCalls[0][2].pluginId, 'test_plugin');
    assert.equal(responses[0].event, 'request-file-conversion-response');
    assert.equal(responses[0].payload.success, true);
});
