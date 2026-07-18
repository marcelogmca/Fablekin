const { createPluginSocketHandlers } = require('../handlers/socket_plugin_handlers.js');
const { createSocketEventRoutes } = require('./socket_event_routes.js');
const { createFrontendInjectionOnConnect } = require('./socket_frontend_injection.js');
const { toggleVnFullscreen } = require('./window_manager.js');

const QUIET_FORWARDED_SOCKET_EVENTS = new Set([
    'vn-hud-fetch-data',
    'vn-location-fetch-data',
    'quest-tracker-fetch-data'
]);

function createSocketConnectionSetup({
    Logger,
    addEmitReceiveToSocket,
    MemoryBrowserCLI,
    io,
    pluginManager,
    frontendInjectionCache,
    getActiveChatPathGlobal,
    chaptermanagement,
    projectHandlers,
    app,
    fileHandlers,
    playerHandlers,
    settingsHandlers,
    emitResponse,
    contentManager,
    getRootDirectory,
    getProjectName,
    fs,
    vnHandlers,
    getMainWindow,
    chapterHandlers,
    memoryHandlers,
    logHandlers,
    sceneHistoryHandlers,
    timeline,
    uiHandlers,
    homeHandlers,
    scriptSecurity,
    resolvePathInsideRoot,
    isSafeExtension,
    invalidateFrontendInjectionCache
}) {
    const runFrontendInjectionOnConnect = createFrontendInjectionOnConnect({
        Logger,
        pluginManager,
        frontendInjectionCache,
        getActiveChatPathGlobal,
        chaptermanagement
    });

    return function setupSocketConnection(socket) {
        Logger.log('Main', 'SocketIO', 'Socket connected', socket.id);

        addEmitReceiveToSocket(socket);

        // Initialize Memory CLI
        const memoryCLI = new MemoryBrowserCLI(io);
        memoryCLI.registerSocketHandlers(socket);

        // Register plugin socket listeners
        pluginManager.registerSocketOnConnection(socket);

        // Trigger targeted frontend injection hook and state catch-up.
        void runFrontendInjectionOnConnect(socket);

        const pluginSocketHandlers = createPluginSocketHandlers({
            Logger,
            pluginManager,
            emitResponse,
            io,
            timeline,
            scriptSecurity,
            getProjectName,
            invalidateFrontendInjectionCache,
            contentManager,
            getRootDirectory,
            fs,
            resolvePathInsideRoot,
            isSafeExtension
        });

        const eventHandlers = createSocketEventRoutes({
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
        });
        Object.entries(eventHandlers).forEach(([event, handler]) => {
            socket.on(event, (data, callback) => {
                if (event !== 'save-viewer-state') {
                    const logData = (data && typeof data === 'object') ? '{ ... }' : data;
                    Logger.log('Main', 'SocketIO', `Event received: ${event}`, logData);
                }
                handler(socket, data, callback);
            });
        });

        socket.onAny((eventName, ...args) => {
            if (!eventHandlers[eventName]) {
                if (!QUIET_FORWARDED_SOCKET_EVENTS.has(eventName)) {
                    const logArgs = args.map(arg => (arg && typeof arg === 'object') ? '{ ... }' : arg);
                    Logger.log('Main', 'SocketIO', `Forwarding unhandled event: ${eventName}`, ...logArgs);
                }
                socket.broadcast.emit(eventName, ...args);
            }
        });

        socket.on('toggle-vn-fullscreen', () => {
            const mainWindow = getMainWindow();
            toggleVnFullscreen(mainWindow, io, Logger, 'socket');
        });
    };
}

module.exports = {
    createSocketConnectionSetup
};



