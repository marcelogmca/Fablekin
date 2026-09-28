function createSocketEventRoutes({
    Logger,
    app,
    projectHandlers,
    fileHandlers,
    playerHandlers,
    settingsHandlers,
    vnHandlers,
    chapterHandlers,
    memoryHandlers,
    logHandlers,
    sceneHistoryHandlers,
    timeline,
    uiHandlers,
    homeHandlers,
    pluginSocketHandlers,
    getMainWindow,
    socket
}) {
    return {
        // Project operations
        'get-all-projects': projectHandlers.getAllProjects,
        'create-new-project': projectHandlers.createNewProject,
        'delete-project': projectHandlers.deleteProject,
        'rename-project': projectHandlers.renameProject,
        'select-project': projectHandlers.selectProject,
        'get-core-folders': projectHandlers.getCoreFolders,
        'restart-app': () => {
            Logger.log('Main', 'System', 'Relaunching app for project switch...');
            app.relaunch();
            app.exit(0);
        },

        // File operations
        'get-file-config': fileHandlers.getFileConfig,
        'get-file-content': fileHandlers.getFileContent,
        'peek-file-content': fileHandlers.peekFileContent,
        'request-plugin-file-view': pluginSocketHandlers.requestPluginFileView,
        'save-file-content': fileHandlers.saveFileContent,
        'create-new-file': fileHandlers.createNewFile,
        'create-new-chat-db': fileHandlers.createNewChatDb,
        'update-file-order': fileHandlers.updateFileOrder,
        'move-file-to-folder': fileHandlers.moveFileToFolder,
        'delete-file': fileHandlers.deleteFile,
        'append-to-file': fileHandlers.appendContentToFile,
        'save-file-config': fileHandlers.saveFileConfig,
        'load-file-config': fileHandlers.loadFileConfig,
        'convert-md-to-chat-db': fileHandlers.convertMdToChatDb,
        'request-file-conversion': pluginSocketHandlers.requestFileConversion,
        'rename-file': fileHandlers.renameFile,
        'open-project-folder': fileHandlers.openProjectFolder,
        'open-project-assets-folder': fileHandlers.openProjectAssetsFolder,

        // Player operations
        'save-player-metadata': playerHandlers.savePlayerMetadata,
        'get-player-metadata': playerHandlers.getPlayerMetadata,

        // Settings operations
        'save-vn-settings': settingsHandlers.saveVNSettings,
        'get-vn-settings': settingsHandlers.getVNSettings,
        'get-available-themes': settingsHandlers.getAvailableThemes,
        'update-theme': settingsHandlers.updateTheme,
        'get-global-settings': settingsHandlers.getGlobalSettings,
        'update-global-setting': settingsHandlers.updateGlobalSetting,
        'get-provider-secrets': settingsHandlers.getProviderSecrets,
        'save-provider-secret': settingsHandlers.saveProviderSecret,
        'apply-provider-starter-profile': settingsHandlers.applyProviderStarterProfile,

        // LLM call from content manager
        'send-to-llm': fileHandlers.sendToLLM,

        // VN operations
        'generate-vn-turn': vnHandlers.generateVNTurn,
        'generate-interlude-turn': vnHandlers.generateInterludeTurn,
        'cancel-vn-generation': vnHandlers.cancelVnGeneration,
        'play-historical-turn': vnHandlers.playHistoricalTurn,
        'play-interlude-turn': vnHandlers.playInterludeTurn,
        'get-pending-interlude-integrations': vnHandlers.getPendingInterludeIntegrations,
        'integrate-interlude': vnHandlers.integrateInterlude,
        'delete-interlude': vnHandlers.deleteInterlude,
        'get-project-sprites': vnHandlers.getProjectSprites,
        'get-project-backgrounds': vnHandlers.getProjectBackgrounds,
        'sprite-opaque-bounds:get': vnHandlers.getSpriteOpaqueBounds,
        'spatial-stage:get-sidecar': vnHandlers.spatialStageGetSidecar,
        'spatial-stage:save-sidecar': vnHandlers.spatialStageSaveSidecar,
        'spatial-stage:get-preview-sprite': vnHandlers.spatialStageGetPreviewSprite,
        'spatial-stage:browse-sprite': vnHandlers.spatialStageBrowseSprite,
        'spatial-stage:browse-background': vnHandlers.spatialStageBrowseBackground,
        'get-prologue-content': vnHandlers.getPrologueContent,

        'vn:blink-taskbar': () => {
            const mainWindow = getMainWindow();
            if (mainWindow) {
                mainWindow.flashFrame(true);
                Logger.log('Main', 'UI', 'Taskbar flash triggered');
            }
        },

        'get-window-focus-state': () => {
            const mainWindow = getMainWindow();
            const isFocused = mainWindow ? mainWindow.isFocused() : false;
            socket.emit('get-window-focus-state-response', { isFocused });
        },

        // Chapter operations
        'save-message-chapter': chapterHandlers.saveMessageChapter,
        'save-viewer-state': chapterHandlers.saveViewerState,

        // Memory operations
        'get-memory-data': memoryHandlers.getMemoryData,

        // Log operations
        'get-all-logs': logHandlers.getAllLogs,
        'get-log-content': logHandlers.getLogContent,
        'get-waterfall-data': logHandlers.getWaterfallData,
        'get-log-projects': logHandlers.getLogProjects,
        'get-current-project-name': logHandlers.getCurrentProjectName,
        'get-model-pricing': logHandlers.getModelPricing,
        'export-token-map': logHandlers.exportTokenMap,
        'get-log-arena-providers': logHandlers.getLogArenaProviders,
        'get-log-arena-preset': logHandlers.getLogArenaPreset,
        'save-log-arena-preset': logHandlers.saveLogArenaPreset,
        'list-log-arena-experiments': logHandlers.listLogArenaExperiments,
        'get-log-arena-experiment': logHandlers.getLogArenaExperiment,
        'start-log-arena-experiment': logHandlers.startLogArenaExperiment,
        'cancel-log-arena-experiment': logHandlers.cancelLogArenaExperiment,
        'stop-log-arena-and-judge': logHandlers.stopLogArenaAndJudge,
        'judge-log-arena-experiment': logHandlers.judgeLogArenaExperiment,
        'retry-failed-log-arena-judges': logHandlers.retryFailedLogArenaJudges,
        'pin-log-arena-experiment': logHandlers.pinLogArenaExperiment,
        'delete-log-arena-experiment': logHandlers.deleteLogArenaExperiment,

        // Scene history operations
        'get-scene-history-data': sceneHistoryHandlers.getSceneHistoryData,
        'load-scene-history-view': sceneHistoryHandlers.loadSceneHistoryView,
        'play-vn-scene-from-history': sceneHistoryHandlers.playVnSceneFromHistory,
        'delete-latest-turn': sceneHistoryHandlers.deleteLatestTurn,
        'get-turn-script': sceneHistoryHandlers.getTurnScript,
        'branch-narrative': sceneHistoryHandlers.branchNarrative,
        'activate-chat-db': sceneHistoryHandlers.activateChatDb,
        'reprocess-vn-turn': vnHandlers.reprocessVNTurn,

        // Timeline operations
        'get-timeline-data': async () => {
            Logger.log('Main', 'Timeline', 'Timeline data requested.');
            await timeline.refresh({ reason: 'get-timeline-data' });
        },
        'get-timeline-range-data': async (socket, data) => {
            Logger.log('Main', 'Timeline', 'Timeline range data requested.', data && typeof data === 'object' ? '{ ... }' : data);
            await timeline.hydrateRange(socket, data);
        },

        // UI operations
        'request-tab-switch': uiHandlers.requestTabSwitch,
        'get-home-setup-data': homeHandlers.getHomeSetupData,
        'check-ollama-status': homeHandlers.checkOllamaStatus,
        'open-settings-section': homeHandlers.openSettingsSection,
        'open-plugin-settings': homeHandlers.openPluginSettings,
        'open-writer-cot-file': homeHandlers.openWriterCotFile,
        'open-director-prompt-folder': homeHandlers.openDirectorPromptFolder,

        // Plugin hooks (frontend-triggered)
        'execute-frontend-hook': pluginSocketHandlers.executeFrontendHook,
        'gui-security-decision': pluginSocketHandlers.guiSecurityDecision,
        'approve-script-hash': pluginSocketHandlers.approveScriptHash,
        'peek-script-content': pluginSocketHandlers.peekScriptContent,
        'request-gui-intercept-ui': pluginSocketHandlers.requestGuiInterceptUi,
        'get-plugin-views': pluginSocketHandlers.getPluginViews,
        'get-plugins': pluginSocketHandlers.getPlugins,
        'toggle-plugin-status': pluginSocketHandlers.togglePluginStatus,
        'get-plugin-settings': pluginSocketHandlers.getPluginSettings,
        'save-plugin-settings': pluginSocketHandlers.savePluginSettings,
        'register-view': pluginSocketHandlers.registerView,
        'get-project-directives': pluginSocketHandlers.getProjectDirectives,
        'update-project-directive': pluginSocketHandlers.updateProjectDirective,
        'get-project-advanced-mode': pluginSocketHandlers.getProjectAdvancedMode,
        'update-project-advanced-mode': pluginSocketHandlers.updateProjectAdvancedMode,
        'get-project-advanced-filetypes-shown': pluginSocketHandlers.getProjectAdvancedFiletypesShown,
        'update-project-advanced-filetypes-shown': pluginSocketHandlers.updateProjectAdvancedFiletypesShown,
        'get-project-notes': pluginSocketHandlers.getProjectNotes,
        'update-project-notes': pluginSocketHandlers.updateProjectNotes
    };
}

module.exports = {
    createSocketEventRoutes
};
