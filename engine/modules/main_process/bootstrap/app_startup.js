const path = require('path');

function createStartupSequence({
    Logger,
    app,
    engineDir,
    secureStorage,
    patchSettingsWithSecrets,
    pluginManager,
    chaptermanagement,
    getStaticDataManager,
    io,
    appExpress,
    startSocketServer,
    server,
    setupSocketConnection,
    setIoInstance,
    vnmanager,
    runtimeSocketState,
    settings,
    fs,
    logsDir,
    cleanupOldLogs,
    socketHost,
    timeline
}) {
    const startupPromise = (async () => {
        Logger.log('Main', 'Lifecycle', 'Initializing PluginManager at startup...', 'start');
        const pluginsDir = path.join(engineDir, 'plugins');
        const repoRoot = path.join(engineDir, '..');

        pluginManager.setRepoRoot(repoRoot);
        await secureStorage.initialize();
        // Sync system secrets to utils.settings
        const systemSecrets = secureStorage.getPluginSecrets('system');
        if (Object.keys(systemSecrets).length > 0) {
            patchSettingsWithSecrets(systemSecrets);
        }

        if (typeof cleanupOldLogs === 'function') {
            await cleanupOldLogs({
                fs,
                logsDir,
                settings,
                Logger
            });
        }

        await pluginManager.initialize(chaptermanagement, getStaticDataManager(), pluginsDir, io, appExpress);
        Logger.log('Main', 'Lifecycle', 'PluginManager initialized at startup.', 'end');

        // Start socket server only after plugins are ready
        await startSocketServer({
            io,
            server,
            setupSocketConnection,
            setIoInstance,
            vnmanager,
            Logger,
            runtimeSocketState,
            settings,
            socketHost
        });

        // Initialize Timeline module - must happen after PluginManager so providers are registered
        timeline.init(chaptermanagement, pluginManager, io);
        Logger.log('Main', 'Lifecycle', 'Timeline module initialized.');

        await pluginManager.executeHook('HOOK_SYSTEM_BOOT');
    })();

    async function waitForStartupOrQuit() {
        try {
            await startupPromise;
        } catch (error) {
            Logger.error('Main', 'Lifecycle', 'Startup failed. Closing application.', error);
            app.quit();
            throw error;
        }
    }

    return {
        startupPromise,
        waitForStartupOrQuit
    };
}

module.exports = {
    createStartupSequence
};
