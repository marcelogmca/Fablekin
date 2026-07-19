const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFileHandlers } = require('./file_handlers.js');

function createDeleteHarness({ unlinkError = null } = {}) {
    const rootDirectory = path.resolve('test-project');
    const filePath = path.join(rootDirectory, 'Lore.db');
    const events = [];
    const responses = [];

    const handlers = createFileHandlers({
        fs: {
            lstat: async () => ({ isDirectory: () => false }),
            access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
            unlink: async () => {
                events.push('unlink');
                if (unlinkError) throw unlinkError;
            }
        },
        path,
        Logger: { log() {}, warn() {}, error() {} },
        emitResponse: (event, payload) => responses.push({ event, payload }),
        isPathInsideRoot: () => true,
        contentManager: {
            loadFileConfig: async () => ({ files: { [filePath]: { mode: 'custom_database' } } }),
            processDirectory: async () => ({ structure: [], config: { files: {} } })
        },
        getProjectName: () => 'test-project',
        getRootDirectory: () => rootDirectory,
        getActiveChatPathGlobal: () => null,
        pluginManager: {
            executeHook: async (hookName) => events.push(hookName),
            getRegisteredFileModes: () => ({})
        },
        chaptermanagement: { close: async () => events.push('close-chat') },
        closeFactManager: async () => events.push('close-facts'),
        getStaticDataManager: () => null,
        io: { emit() {} }
    });

    return { handlers, filePath, events, responses };
}

test('file deletion gives plugins a generic chance to release resources before unlinking', async () => {
    const { handlers, filePath, events, responses } = createDeleteHarness();

    await handlers.deleteFile(null, { filePath });

    assert.ok(events.indexOf('HOOK_FILE_WILL_DELETE') < events.indexOf('unlink'));
    assert.equal(events.includes('close-chat'), false);
    assert.equal(events.includes('close-facts'), false);
    assert.equal(responses.at(-1).payload.success, true);
});

test('file deletion identifies unresolved busy locks for the frontend warning', async () => {
    const busyError = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    const { handlers, filePath, responses } = createDeleteHarness({ unlinkError: busyError });

    await handlers.deleteFile(null, { filePath });

    assert.equal(responses.at(-1).event, 'delete-file-response');
    assert.equal(responses.at(-1).payload.success, false);
    assert.equal(responses.at(-1).payload.locked, true);
});
