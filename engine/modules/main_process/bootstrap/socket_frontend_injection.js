function createFrontendInjectionOnConnect({
    Logger,
    pluginManager,
    frontendInjectionCache,
    getActiveChatPathGlobal,
    chaptermanagement
}) {
    return async function runFrontendInjectionOnConnect(socket) {
        try {
            const view = socket.handshake.query.view || 'hud';
            const hookName = (view === 'timeline') ? 'HOOK_FRONTEND_TIMELINE_INJECTION' : 'HOOK_FRONTEND_INJECTION';
            const cacheKey = (view === 'timeline') ? 'timeline' : 'hud';

            // Serve cached injection payload if available, rather than re-executing
            // the hook for every socket connection. The cache is invalidated when
            // plugins are toggled or a new project is loaded.
            // Prevents "cache poisoning" where an early connection caches
            // empty results before PluginManager is initialized.
            let injectionResults = frontendInjectionCache[cacheKey];
            if (injectionResults === null) {
                if (pluginManager.isInitialized) {
                    Logger.log('Main', 'Plugins', `Socket ${socket.id} (view: ${view}) - cache miss, executing ${hookName}`);
                    injectionResults = await pluginManager.executeHook(hookName);
                    frontendInjectionCache[cacheKey] = injectionResults;
                } else {
                    Logger.warn('Main', 'Plugins', `Socket ${socket.id} (view: ${view}) connected before PluginManager initialization. Skipping injection caching.`);
                    // Fallback: try to execute without caching if possible, or just skip
                    injectionResults = await pluginManager.executeHook(hookName);
                }
            } else {
                Logger.log('Main', 'Plugins', `Socket ${socket.id} (view: ${view}) - cache hit, skipping hook execution for ${hookName}`);
            }

            if (injectionResults && injectionResults.length > 0) {
                Logger.log('Main', 'Plugins', `Sending ${injectionResults.length} permanent injection payloads to ${view} view.`);
                socket.emit('inject-permanent-assets', injectionResults);
            }

            // Catch-up for new connections: if a chat is already active,
            // send the current state immediately so the viewer can restore its position.
            const activeChatPathGlobal = getActiveChatPathGlobal();
            if (activeChatPathGlobal) {
                Logger.log('Main', 'SocketIO', `[State Restoration] Re-emitting current chat state to new connection: ${activeChatPathGlobal}`);
                const viewerState = await chaptermanagement.getViewerState();
                Logger.log('Main', 'SocketIO', `[State Restoration] Retrieved ViewerState: ${JSON.stringify(viewerState)}`);
                socket.emit('chat-db-switched', { path: activeChatPathGlobal, viewerState });
            } else {
                Logger.log('Main', 'SocketIO', '[State Restoration] No activeChatPathGlobal set.');
            }
        } catch (error) {
            Logger.error('Main', 'Plugins', 'Error during HOOK_FRONTEND_INJECTION or state re-emission:', error);
        }
    };
}

module.exports = {
    createFrontendInjectionOnConnect
};
