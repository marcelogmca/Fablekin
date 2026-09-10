const path = require('path');

function getUndoRestoredInputs(turnContext) {
    const input = turnContext?.input;
    if (!input || typeof input !== 'object') return null;
    const submitted = input.submitted && typeof input.submitted === 'object' ? input.submitted : input;
    return {
        userPrompt: typeof submitted.userPrompt === 'string' ? submitted.userPrompt : '',
        directorPrompt: typeof submitted.directorPrompt === 'string' ? submitted.directorPrompt : '',
        softFeedback: typeof submitted.softFeedback === 'string' ? submitted.softFeedback : ''
    };
}

function createSceneHistoryHandlers({
    fs,
    chaptermanagement,
    contentManager,
    getProjectName,
    pluginManager,
    io,
    emitResponse,
    Logger,
    getMainWindow,
    sceneHistoryViewPath,
    getRendererSocketQuery,
    runtimeSocketState,
    getRootDirectory,
    getActiveChatPathGlobal,
    setActiveChatPathGlobal,
    initFactManager,
    getSettings,
    timeline
}) {
    function isPathInsideRoot(filePath, rootDirectory) {
        if (!filePath || !rootDirectory) return false;
        const relative = path.relative(path.resolve(rootDirectory), path.resolve(filePath));
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    function isChroniclesChatDb(filePath, rootDirectory) {
        const chroniclesDir = path.join(rootDirectory, '3_Chronicles');
        return isPathInsideRoot(filePath, chroniclesDir) && String(filePath).toLowerCase().endsWith('.db');
    }

    return {
        async getSceneHistoryData(_socket) {
            Logger.log('Main', 'SceneHistory', 'Request received for scene history data.');
            try {
                const turnContexts = await chaptermanagement.getChapterMetadata();

                // Map instances to the expected scene format for the renderer
                const scenes = turnContexts.map(tc => ({
                    turnNumber: tc.turnNumber,
                    dbId: tc.dbId,
                    thumbnail: tc.thumbnail,
                    title: tc.output.title,
                    abstractTitle: tc.output.abstractTitle,
                    synopsis: tc.output.synopsis,
                    // These require the full blob, so we provide null/0 for performance
                    background: tc.output.finalBackground || null,
                    sequence: { length: tc.dialogueCount || 0 }
                }));

                emitResponse('get-scene-history-data-response', { success: true, scenes });
            } catch (error) {
                Logger.error('Main', 'SceneHistory', 'Error getting scene history data:', error);
                emitResponse('get-scene-history-data-response', { success: false, error: error.message });
            }
        },

        async getTurnScript(_socket, { turnNumber }) {
            Logger.log('Main', 'SceneHistory', `Request received for script of turn ${turnNumber}`);
            try {
                const turnContext = await chaptermanagement.getTurnContext(turnNumber);
                if (!turnContext) throw new Error(`Turn ${turnNumber} not found.`);

                const script = turnContext.processed.narrativeEngine.writerResponse || '';
                emitResponse('get-turn-script-response', { success: true, script });
            } catch (error) {
                Logger.error('Main', 'SceneHistory', `Error getting script for turn ${turnNumber}:`, error);
                emitResponse('get-turn-script-response', { success: false, error: error.message });
            }
        },

        async loadSceneHistoryView(_socket) {
            Logger.log('Main', 'SceneHistory', 'Loading scene history view.');
            const mainWindow = getMainWindow();
            if (mainWindow) {
                mainWindow.loadFile(sceneHistoryViewPath, { query: getRendererSocketQuery(runtimeSocketState) });
                emitResponse('load-scene-history-view-response', { success: true });
            } else {
                emitResponse('load-scene-history-view-response', { success: false, error: 'Main window not found.' });
            }
        },

        async playVnSceneFromHistory(socket, data) {
            Logger.log('Main', 'SceneHistory', 'Playing VN scene from history.', data);
            io.emit('play-specific-vn-scene', { ...data, isReplay: true });
            emitResponse('play-vn-scene-from-history-response', { success: true });
        },

        async deleteLatestTurn(_socket) {
            Logger.log('Main', 'SceneHistory', 'Request to delete latest turn received.');
            try {
                let restoredInputs = null;
                try {
                    restoredInputs = getUndoRestoredInputs(await chaptermanagement.getLatestTurnContext());
                } catch (inputError) {
                    Logger.warn('Main', 'SceneHistory', `Could not capture the latest chapter inputs before undo: ${inputError.message}`);
                }
                const success = await chaptermanagement.deleteLatestTurn();
                if (success) {
                    Logger.log('Main', 'SceneHistory', 'Latest turn deleted successfully.');

                    // Calculate the new viewer state based on the remaining turns.
                    // We want to jump to the very last dialogue of the *new* latest turn.
                    const newChapterCount = await chaptermanagement.getChapterCount();
                    let viewerState = null;
                    const resolvedActiveChatPath =
                        getActiveChatPathGlobal()
                        || chaptermanagement.currentChatDbFullPath
                        || null;

                    if (newChapterCount > 0) {
                        const lastTurn = await chaptermanagement.getLatestTurnContext();
                        if (lastTurn && lastTurn.output && lastTurn.output.sequence) {
                            const lastIndex = Math.max(0, lastTurn.output.sequence.length - 1);
                            const latestTurnNumber = Number.parseInt(lastTurn.turnNumber, 10);
                            const safeTurnNumber = Number.isInteger(latestTurnNumber) && latestTurnNumber > 0
                                ? latestTurnNumber
                                : newChapterCount;
                            await chaptermanagement.saveViewerState(safeTurnNumber, lastIndex);
                            viewerState = { turnNumber: safeTurnNumber, dialogueIndex: lastIndex };
                            Logger.log('Main', 'SceneHistory', `Updated viewer state to Turn ${safeTurnNumber}, Index ${lastIndex}`);
                        }
                    } else {
                        // Reset viewer state if no turns remain
                        await chaptermanagement.saveViewerState(0, 0);
                        viewerState = null;
                        Logger.log('Main', 'SceneHistory', 'No turns remain. Resetting viewer state.');
                    }

                    // Broadcast that the DB has changed to all clients
                    // This triggers a refresh in the Scene History and tells the VN Viewer where to jump
                    io.emit('chat-db-switched', { path: resolvedActiveChatPath, viewerState });

                    emitResponse('delete-latest-turn-response', { success: true, restoredInputs });
                    
                    // Notify plugins of turn deletion
                    await pluginManager.executeHook('HOOK_TURN_DELETED', { 
                        chatDbPath: resolvedActiveChatPath, 
                        turnNumber: newChapterCount + 1 // The turn that WAS just deleted
                    });
                } else {
                    Logger.warn('Main', 'SceneHistory', 'Failed to delete latest turn (no turns found?).');
                    emitResponse('delete-latest-turn-response', { success: false, error: 'No turns available to delete.' });
                }
            } catch (error) {
                Logger.error('Main', 'SceneHistory', 'Error deleting latest turn:', error);
                emitResponse('delete-latest-turn-response', { success: false, error: error.message });
            }
        },

        async branchNarrative(_socket, { branchTurnNumber, branchDbId, newChatName }) {
            Logger.log('Main', 'SceneHistory', `Branch Narrative requested: ${newChatName} from turn ${branchTurnNumber}`);
            try {
                const activeChatPathGlobal = getActiveChatPathGlobal();
                const rootDirectory = getRootDirectory();
                if (!activeChatPathGlobal) throw new Error('No active chat database.');
                if (!rootDirectory) throw new Error('No project directory loaded.');

                const chroniclesDir = path.join(rootDirectory, '3_Chronicles');
                const sourceDbPath = activeChatPathGlobal;
                const targetDbPath = path.join(chroniclesDir, `${newChatName}.db`);

                // 1. Check if target DB already exists
                try {
                    await fs.access(targetDbPath);
                    throw new Error(`A chat named "${newChatName}" already exists.`);
                } catch (e) {
                    if (e.code !== 'ENOENT') throw e;
                }

                // 2. Copy the DB file
                await fs.copyFile(sourceDbPath, targetDbPath);
                Logger.log('Main', 'SceneHistory', `Copied DB to ${targetDbPath}`);

                // 3. Trim the new DB
                await chaptermanagement.branchChat(targetDbPath, branchDbId, branchTurnNumber);

                // 4. Duplicate Plugin Storage
                const sourceChatName = path.basename(sourceDbPath, '.db');
                const sourcePluginDir = path.join(rootDirectory, 'plugins', sourceChatName);
                const targetPluginDir = path.join(rootDirectory, 'plugins', newChatName);

                try {
                    await fs.mkdir(path.dirname(targetPluginDir), { recursive: true });
                    // Note: fs.cp was added in Node v16.7.0.
                    // As fallback for older versions, you'd use a custom recursive copy.
                    await fs.cp(sourcePluginDir, targetPluginDir, { recursive: true });
                    Logger.log('Main', 'SceneHistory', `Copied plugin storage to ${targetPluginDir}`);

                    // 5. Clean up Plugin Storage (delete folders where turnNumber > branchTurnNumber)
                    const folders = await fs.readdir(targetPluginDir);
                    for (const folder of folders) {
                        const match = String(folder).match(/^(\d+)(?:\.(\d+))?$/);
                        if (!match) continue;
                        const turnNum = Number.parseInt(match[1], 10);
                        if (Number.isInteger(turnNum) && turnNum > branchTurnNumber) {
                            await fs.rm(path.join(targetPluginDir, folder), { recursive: true, force: true });
                        }
                    }
                    Logger.log('Main', 'SceneHistory', `Cleaned up plugin storage folders > ${branchTurnNumber}`);
                } catch (pluginErr) {
                    Logger.warn('Main', 'SceneHistory', `Plugin storage duplication/cleanup skipped or failed: ${pluginErr.message}`);
                    // Not a fatal error, the narrative can still function.
                }

                // Notify plugins of chat branching
                await pluginManager.executeHook('HOOK_CHAT_BRANCHED', { 
                    sourceDbPath: activeChatPathGlobal, 
                    targetDbPath: targetDbPath, 
                    branchTurnNumber 
                });

                // Let the frontend Content Manager receive the new directory and trigger activation
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());

                io.emit('branch-narrative-broadcast', {
                    newChatPath: targetDbPath,
                    directory: {
                        ...directory,
                        projectName: getProjectName(),
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                emitResponse('branch-narrative-response', { success: true, newChatPath: targetDbPath });

            } catch (error) {
                Logger.error('Main', 'SceneHistory', 'Error branching narrative:', error);
                emitResponse('branch-narrative-response', { success: false, error: error.message });
            }
        },

        async activateChatDb(_socket, data = {}) {
            const { chatDbPath } = data || {};
            Logger.log('Main', 'SceneHistory', `Activate chat DB requested: ${chatDbPath}`);
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) throw new Error('No project directory loaded.');
                if (!isChroniclesChatDb(chatDbPath, rootDirectory)) {
                    throw new Error('Invalid chat database path.');
                }

                await fs.access(chatDbPath);

                const config = await contentManager.loadFileConfig(rootDirectory);
                for (const key in config.files) {
                    const mode = typeof config.files[key] === 'string' ? config.files[key] : config.files[key]?.mode;
                    if (mode === 'chat') {
                        if (typeof config.files[key] === 'string') config.files[key] = 'none';
                        else config.files[key] = { ...config.files[key], mode: 'none' };
                    }
                }

                const existing = config.files[chatDbPath];
                config.files[chatDbPath] = typeof existing === 'object' && existing !== null
                    ? { ...existing, mode: 'chat' }
                    : 'chat';

                await contentManager.saveFileConfig(rootDirectory, config);
                setActiveChatPathGlobal(chatDbPath);
                await chaptermanagement.init(chatDbPath);

                const viewerState = await chaptermanagement.getViewerState();
                io.emit('chat-db-switched', { path: chatDbPath, viewerState });

                if (timeline && typeof timeline.refresh === 'function') {
                    await timeline.refresh({ reason: 'activate-chat-db' });
                }

                const settings = typeof getSettings === 'function' ? getSettings() : {};
                if (settings.narrative_agents?.facts?.enabled !== false && typeof initFactManager === 'function') {
                    await initFactManager(chatDbPath);
                }

                await pluginManager.executeHook('HOOK_CHAT_DB_INITIALIZED', { chatDbPath });

                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                const directoryPayload = {
                    ...directory,
                    projectName: getProjectName(),
                    pluginModes: pluginManager.getRegisteredFileModes()
                };
                io.emit('content-directory-updated', directoryPayload);
                emitResponse('activate-chat-db-response', { success: true, path: chatDbPath, viewerState, directory: directoryPayload });
            } catch (error) {
                Logger.error('Main', 'SceneHistory', 'Error activating chat DB:', error);
                emitResponse('activate-chat-db-response', { success: false, error: error.message });
            }
        }
    };
}

module.exports = {
    createSceneHistoryHandlers,
    getUndoRestoredInputs
};
