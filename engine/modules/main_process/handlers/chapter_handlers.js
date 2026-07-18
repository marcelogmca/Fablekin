function createChapterHandlers({ chaptermanagement, Logger, emitResponse }) {
    return {
        async saveMessageChapter(socket, turnContent, auxobj) {
            Logger.log('Main', 'ChapterOperations', 'Save turn to chapter requested', turnContent);
            try {
                const messageCount = await chaptermanagement.appendMessage(turnContent, auxobj);
                emitResponse('save-message-chapter-response', { success: true, messageCount });
            } catch (error) {
                Logger.error('Main', 'ChapterOperations', 'Error saving message to chapter', error);
                emitResponse('save-message-chapter-response', { success: false, error: error.message });
            }
        },

        async saveViewerState(socket, viewerState = {}) {
            // High-frequency best-effort save; keep this quiet unless diagnosing restore issues.
            await chaptermanagement.saveViewerState(viewerState);
        }
    };
}

module.exports = {
    createChapterHandlers
};
