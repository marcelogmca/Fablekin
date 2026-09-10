const assert = require('node:assert/strict');
const test = require('node:test');
const { createSceneHistoryHandlers, getUndoRestoredInputs } = require('./scene_history_handlers.js');

test('undo restores the immutable submitted inputs instead of a transformed prompt', () => {
    const restored = getUndoRestoredInputs({
        input: {
            userPrompt: 'SYSTEM-ADDED PREFIX\nOriginal action',
            directorPrompt: 'current director value',
            softFeedback: 'current feedback value',
            submitted: {
                userPrompt: 'Original action',
                directorPrompt: 'Original direction',
                softFeedback: 'Original soft feedback'
            }
        }
    });

    assert.deepEqual(restored, {
        userPrompt: 'Original action',
        directorPrompt: 'Original direction',
        softFeedback: 'Original soft feedback'
    });
});

test('undo falls back to legacy TurnContext input fields', () => {
    assert.deepEqual(getUndoRestoredInputs({
        input: { userPrompt: 'Legacy action', directorPrompt: null, softFeedback: undefined }
    }), {
        userPrompt: 'Legacy action',
        directorPrompt: '',
        softFeedback: ''
    });
});

test('delete handler captures inputs before deletion and returns them to the viewer', async () => {
    const order = [];
    const responses = [];
    const emitted = [];
    const handlers = createSceneHistoryHandlers({
        fs: {},
        chaptermanagement: {
            currentChatDbFullPath: 'C:\\story.db',
            getLatestTurnContext: async () => {
                order.push('capture');
                return { input: { submitted: { userPrompt: 'Retry this', directorPrompt: 'Hard', softFeedback: 'Soft' } } };
            },
            deleteLatestTurn: async () => { order.push('delete'); return true; },
            getChapterCount: async () => 0,
            saveViewerState: async () => {}
        },
        pluginManager: { executeHook: async () => {} },
        io: { emit: (...args) => emitted.push(args) },
        emitResponse: (event, payload) => responses.push({ event, payload }),
        Logger: { log() {}, warn() {}, error() {} },
        getActiveChatPathGlobal: () => 'C:\\story.db'
    });

    await handlers.deleteLatestTurn();

    assert.deepEqual(order, ['capture', 'delete']);
    assert.deepEqual(responses[0], {
        event: 'delete-latest-turn-response',
        payload: {
            success: true,
            restoredInputs: { userPrompt: 'Retry this', directorPrompt: 'Hard', softFeedback: 'Soft' }
        }
    });
    assert.equal(emitted.some(([event]) => event === 'chat-db-switched'), true);
});
