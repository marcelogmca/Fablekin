process.env.LANCE_LOG = 'warn';
process.env.RUST_LOG = 'warn';
process.env.LANCEDB_LOG = 'warn';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { Server } = require('socket.io');
const http = require('http');
const windowStateKeeper = require('electron-window-state');

// Improve Windows shell identity/grouping for taskbar, notifications, and jump lists.
const APP_DISPLAY_NAME = 'Fablekin';
app.setName(APP_DISPLAY_NAME);
if (process.platform === 'win32') {
    app.setAppUserModelId('com.fablekin.app');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

function main() {
if (!gotSingleInstanceLock) {
    app.whenReady().then(() => {
        dialog.showMessageBoxSync({
            type: 'info',
            title: APP_DISPLAY_NAME,
            message: 'Fablekin is already running.',
            detail: 'Click OK to close.',
            buttons: ['OK'],
            defaultId: 0,
            noLink: true
        });
        app.exit(0);
    });
    return;
}

// #region MODULE IMPORTS
const contentManager = require('./modules/content_manager/content_manager.js');
const memorymanagement = require('./modules/memory_manager/memory_manager.js');
const vnmanager = require('./modules/vn_manager/vn_manager.js');
const chaptermanagement = require('./modules/chaptermanagement.js');
const narrativeEngine = require('./modules/narrativeengine.js');
const TurnContext = require('./modules/turncontext.js');
const { Logger, TurnLogger, listFilesRecursive, settings, setIoInstance, sendUiNotification, updateSettings, readSettings, saveSettings, patchSettingsWithSecrets, keyMapping, slugifyProjectName } = require('./modules/utils.js');
const { init: initFactManager, close: closeFactManager } = require('./modules/memory_manager/storage/fact_manager.js');
const StaticDataManager = require('./modules/memory_manager/storage/static_data_manager.js');
const pluginManager = require('./modules/plugin_manager/plugin_manager.js');
const secureStorage = require('./modules/main_process/secure_storage.js');
const scriptSecurity = require('./modules/plugin_manager/script_security.js');
const timeline = require('./modules/vn_manager/timeline.js');
const VectorStoreManager = require('./modules/memory_manager/storage/vector_store_manager.js');
const MemoryBrowserCLI = require('./modules/memory_manager/diagnostics/memory_browser_cli.js');
const { workQueue } = require('./modules/plugin_manager/runtime/hook_executor.js');
const { PipelineAbortError } = require('./modules/plugin_manager/runtime/errors.js');
const coreFolders = require('./modules/config/core_folders.js');
const {
    isPathInsideRoot,
    resolvePathInsideRoot,
    resolveChildInsideRoot,
    isSafePathSegment,
    isSafeExtension
} = require('./modules/main_process/shared/path_guard.js');
const { createRuntimeSocketState, getRendererSocketQuery } = require('./modules/main_process/state/runtime_socket_state.js');
const { attachSocketAuthMiddleware, startSocketServer } = require('./modules/main_process/bootstrap/socket_runtime.js');
const { createEmitReceiveAttacher, createEmitResponseEmitter } = require('./modules/main_process/bootstrap/socket_emit_helpers.js');
const { initializeMainWindow, registerWindowControlsIpc } = require('./modules/main_process/bootstrap/window_manager.js');
const { createSocketConnectionSetup } = require('./modules/main_process/bootstrap/socket_connection.js');
const { createStartupSequence } = require('./modules/main_process/bootstrap/app_startup.js');
const { cleanupOldLogs } = require('./modules/main_process/shared/log_retention.js');
const { createMemoryHandlers } = require('./modules/main_process/handlers/memory_handlers.js');
const { createUiHandlers } = require('./modules/main_process/handlers/ui_handlers.js');
const { createPlayerHandlers } = require('./modules/main_process/handlers/player_handlers.js');
const { createSettingsHandlers } = require('./modules/main_process/handlers/settings_handlers.js');
const { createHomeHandlers } = require('./modules/main_process/handlers/home_handlers.js');
const { createFileHandlers } = require('./modules/main_process/handlers/file_handlers.js');
const { createVnHandlers } = require('./modules/main_process/handlers/vn_handlers.js');
const { createChapterHandlers } = require('./modules/main_process/handlers/chapter_handlers.js');
const { createLogHandlers } = require('./modules/main_process/handlers/log_handlers.js');
const { createProjectHandlersBase } = require('./modules/main_process/handlers/project_handlers_base.js');
const { createProjectSelectHandler } = require('./modules/main_process/handlers/project_select_handler.js');
const { createSceneHistoryHandlers } = require('./modules/main_process/handlers/scene_history_handlers.js');
const { filterForegroundOcclusionAssets } = require('./modules/vn_manager/rendering/background_asset_helpers.js');
// #endregion

// Work queue helper for adding core system ETAs
function addWorkItem(id, name, minMs, maxMs) {
    workQueue.add(id, name, minMs, maxMs);
}

// Clear work queue when turn completes
function clearWorkQueue() {
    workQueue.clear();
}

console.log('System starting up...');

// #region CONFIGURATION & CONSTANTS
const CONFIG = {
    SOCKET_HOST: '127.0.0.1',
    SOCKET_TIMEOUT: 5000,
    SOCKET_MAX_BUFFER_SIZE: 100 * 1024 * 1024,
    VALID_IMAGE_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
    VALID_BACKGROUND_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.webm'],
    VALID_AUDIO_EXTENSIONS: ['.mp3', '.ogg', '.wav'],
    CORS_ORIGIN: "*"
};

const PROJECTS_ROOT = path.resolve(__dirname, '..', 'workspace', 'projects');
const logsDir = path.resolve(__dirname, '..', 'workspace', 'logs');
// #endregion

// #region GLOBAL STATE
let mainWindow;
let launcherReadySignaled = false;
let rootDirectory = null;
let activeChatPathGlobal = null;
let mainCharacterName = '';
let mainCharacterBio = '';
let lastSearchstring = '';
let startTime = Date.now();
let currentStep = 0;
let totalSteps = 4;
let staticDataManager = null;
const runtimeSocketState = createRuntimeSocketState({ host: CONFIG.SOCKET_HOST });

// Frontend injection cache — prevents HOOK_FRONTEND_INJECTION running once per
// socket connection (startup storm of ~12 executions in <200ms).
// Keyed by view name ('hud', 'timeline'). Null values mean "not yet computed".
//
// Must be invalidated whenever plugin registration changes
// (toggle-plugin-status) or a new project is loaded (HOOK_PROJECT_LOADED).
// If a plugin's HOOK_FRONTEND_INJECTION handler returns content that
// depends on per-connection state (e.g. the socket ID or connection time), caching
// will break it. The contract is: injection payloads must be stateless/idempotent.
const _frontendInjectionCache = { hud: null, timeline: null };

function _invalidateFrontendInjectionCache() {
    _frontendInjectionCache.hud = null;
    _frontendInjectionCache.timeline = null;
    Logger.log('Main', 'Plugins', 'Frontend injection cache invalidated.');
}

app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
});
// #endregion

try {
    fsSync.mkdirSync(PROJECTS_ROOT, { recursive: true });
    Logger.log('Main', 'Startup', `Projects root ensured at: ${PROJECTS_ROOT}`);
} catch (e) {
    console.error('Failed to create projects directory', e);
    Logger.error('Main', 'Startup', 'Failed to create projects directory', e);
}

// #region UTILITY FUNCTIONS
/**
 * Retrieves the name of the current project based on the root directory.
 * @returns {string} The name of the current project, or 'default_project' if no root directory is set.
 */
function getProjectName() {
    return rootDirectory ? slugifyProjectName(path.basename(rootDirectory)) : 'default_project';
}

/**
 * Retrieves project-specific file paths from a given subdirectory with specified extensions.
 * @param {string} subdir - The subdirectory within the project (e.g., 'sprites', 'backgrounds').
 * @param {Array<string>} extensions - An array of valid file extensions (e.g., ['.png', '.jpg']).
 * @returns {Promise<Array<string>>} A promise that resolves to an array of absolute file paths.
 */
async function getProjectFiles(subdir, extensions, maxDepth = 2) {
    if (!rootDirectory) return [];
    const targetDir = path.join(rootDirectory, 'assets', subdir);
    return await listFilesRecursive(targetDir, extensions, 0, maxDepth);
}

// #endregion

// #region PROJECT RESOURCE GETTERS
/**
 * Retrieves all project sprite files.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of absolute paths to project sprite files.
 */
async function getProjectSprites() {
    Logger.log('Main', 'FileOperations', 'Getting project sprites');
    // Allow one extra nesting level so variant packs can live in:
    // assets/sprites/<character>/<variant>/*
    return await getProjectFiles('sprites', CONFIG.VALID_IMAGE_EXTENSIONS, 3);
}

/**
 * Retrieves all project background image/video files.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of absolute paths to project background files.
 */
async function getProjectBackgrounds() {
    Logger.log('Main', 'FileOperations', 'Getting project backgrounds');
    const files = await getProjectFiles('backgrounds', CONFIG.VALID_BACKGROUND_EXTENSIONS);
    return filterForegroundOcclusionAssets(files);
}

/**
 * Retrieves all project Original Soundtrack (OST) audio files.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of absolute paths to project OST files.
 */
async function getProjectOSTs() {
    Logger.log('Main', 'FileOperations', 'Getting project OSTs');
    return await getProjectFiles('ost', CONFIG.VALID_AUDIO_EXTENSIONS);
}
// #endregion

// #region SOCKET.IO SETUP & UTILITIES
const express = require('express');
const appExpress = express();
appExpress.use(express.json());

// Global logger for all incoming HTTP requests to help debug callbacks
function shouldLogExpressRequest(req) {
    const isStaticProjectAsset = /^(GET|HEAD)$/.test(req.method)
        && /^\/projects\/[^/]+\/assets\//.test(req.url);
    return !isStaticProjectAsset;
}

appExpress.use((req, res, next) => {
    if (shouldLogExpressRequest(req)) {
        Logger.log('Express', `${req.method} ${req.url}`);
    }
    next();
});

appExpress.use('/plugins', express.static(path.join(__dirname, 'plugins')));
appExpress.use('/projects', express.static(PROJECTS_ROOT));

// Serve system views, vendor libs, and themes via the same server to ensure 
// assets like the 'ready' notification jingle load correctly via SERVER_URL.
appExpress.use('/engine/views', express.static(path.join(__dirname, 'views')));
appExpress.use('/engine/vendor', express.static(path.join(__dirname, 'vendor')));
appExpress.use('/engine/themes', express.static(path.join(__dirname, 'themes')));

const server = http.createServer(appExpress);
const io = new Server(server, {
    cors: { origin: CONFIG.CORS_ORIGIN },
    // Plugin editors can upload large in-project assets such as world maps.
    maxHttpBufferSize: CONFIG.SOCKET_MAX_BUFFER_SIZE
});
attachSocketAuthMiddleware({ io, runtimeSocketState, Logger });

const addEmitReceiveToSocket = createEmitReceiveAttacher({
    io,
    Logger,
    defaultTimeout: CONFIG.SOCKET_TIMEOUT
});

const emitResponse = createEmitResponseEmitter({
    io,
    Logger
});
// #endregion

// #region SOCKET EVENT HANDLERS
// #region Project Management Handlers
const projectHandlers = {
    ...createProjectHandlersBase({
        fs,
        path,
        projectsRoot: PROJECTS_ROOT,
        coreFolders,
        contentManager,
        chaptermanagement,
        emitResponse,
        getProjectName,
        getStaticDataManager: () => staticDataManager,
        slugifyProjectName: require('./modules/utils.js').slugifyProjectName,
        resolveChildInsideRoot,
        isSafePathSegment,
        Logger
    }),

    selectProject: createProjectSelectHandler({
        fs,
        path,
        projectsRoot: PROJECTS_ROOT,
        engineDir: __dirname,
        VectorStoreManager,
        Logger,
        getProjectName,
        getMainWindow: () => mainWindow,
        getRendererSocketQuery,
        runtimeSocketState,
        contentManager,
        pluginManager,
        io,
        getStaticDataManager: () => staticDataManager,
        setStaticDataManager: (value) => { staticDataManager = value; },
        StaticDataManager,
        chaptermanagement,
        initFactManager,
        emitResponse,
        setRootDirectory: (value) => { rootDirectory = value; },
        invalidateFrontendInjectionCache: _invalidateFrontendInjectionCache,
        setMainCharacterName: (value) => { mainCharacterName = value; },
        setMainCharacterBio: (value) => { mainCharacterBio = value; },
        setActiveChatPathGlobal: (value) => { activeChatPathGlobal = value; }
    })
};
// #endregion

// #region Memory Handlers
const memoryHandlers = createMemoryHandlers({
    memorymanagement,
    getProjectName,
    Logger,
    emitResponse
});
// #endregion

// #region Player Handlers
const playerHandlers = createPlayerHandlers({
    getRootDirectory: () => rootDirectory,
    contentManager,
    getProjectName,
    io,
    emitResponse,
    Logger,
    setMainCharacterName: (name) => { mainCharacterName = name; },
    setMainCharacterBio: (bio) => { mainCharacterBio = bio; }
});
// #endregion

// #region Settings Handlers
const settingsHandlers = createSettingsHandlers({
    fs,
    engineDir: __dirname,
    io,
    emitResponse,
    Logger,
    updateSettings,
    readSettings,
    getProjectName,
    secureStorage,
    keyMapping,
    patchSettingsWithSecrets
});
// #endregion

// #region File Handlers
const fileHandlers = createFileHandlers({
    fs,
    path,
    shell,
    Logger,
    emitResponse,
    isPathInsideRoot,
    resolvePathInsideRoot,
    scriptSecurity,
    contentManager,
    getProjectName,
    pluginManager,
    getRootDirectory: () => rootDirectory,
    chaptermanagement,
    closeFactManager,
    getStaticDataManager: () => staticDataManager,
    setActiveChatPathGlobal: (value) => { activeChatPathGlobal = value; },
    getActiveChatPathGlobal: () => activeChatPathGlobal,
    initFactManager,
    getSettings: () => readSettings(),
    narrativeEngine,
    setStartTime: (value) => { startTime = value; },
    setCurrentStep: (value) => { currentStep = value; },
    io,
    TurnLogger,
    timeline
});
// #endregion
// #region VN Handlers
const vnHandlers = createVnHandlers({
    path,
    fs,
    Logger,
    io,
    sendUiNotification,
    getProjectName,
    TurnLogger,
    pluginManager,
    emitResponse,
    chaptermanagement,
    timeline,
    getSettings: () => readSettings(),
    initFactManager,
    TurnContext,
    getRootDirectory: () => rootDirectory,
    getMainCharacterName: () => mainCharacterName,
    getMainCharacterBio: () => mainCharacterBio,
    StaticDataManager,
    getStaticDataManager: () => staticDataManager,
    setStaticDataManager: (value) => { staticDataManager = value; },
    narrativeEngine,
    addWorkItem,
    clearWorkQueue,
    getProjectSprites,
    getProjectBackgrounds,
    getProjectOSTs,
    getLastSearchstring: () => lastSearchstring,
    getTotalSteps: () => totalSteps,
    getStartTime: () => startTime,
    getCurrentStep: () => currentStep,
    vnmanager,
    PipelineAbortError,
    getMainWindow: () => mainWindow,
    requestTabSwitch: async (socket, { tab }) => {
        Logger.log('Main', 'UI', `Tab switch requested: ${tab}`);
        io.emit('switch-tab', { tab });
    },
    contentManager
});
// #endregion
// #region Chapter Handlers
const chapterHandlers = createChapterHandlers({
    chaptermanagement,
    Logger,
    emitResponse
});
// #endregion

// #region Log Handlers
const logHandlers = createLogHandlers({
    fs,
    logsDir,
    getProjectName,
    settings,
    Logger,
    emitResponse,
    resolveChildInsideRoot,
    isSafePathSegment
});
// #endregion


// #region Scene History Handlers
const sceneHistoryHandlers = createSceneHistoryHandlers({
    fs,
    chaptermanagement,
    contentManager,
    getProjectName,
    pluginManager,
    io,
    emitResponse,
    Logger,
    getMainWindow: () => mainWindow,
    sceneHistoryViewPath: path.join(__dirname, 'views/scene_history/scene_history.html'),
    getRendererSocketQuery,
    runtimeSocketState,
    getRootDirectory: () => rootDirectory,
    getActiveChatPathGlobal: () => activeChatPathGlobal,
    setActiveChatPathGlobal: (value) => { activeChatPathGlobal = value; },
    initFactManager,
    getSettings: () => readSettings(),
    timeline
});

const uiHandlers = createUiHandlers({ io, Logger });
const homeHandlers = createHomeHandlers({
    Logger,
    io,
    path,
    shell,
    readSettings,
    pluginManager,
    secureStorage,
    keyMapping
});
// #endregion

// #region Knowledge Graph Handlers (MOVED TO PLUGIN)
// #endregion

// #endregion

// #region SOCKET CONNECTION SETUP
/**
 * Sets up event listeners for a new Socket.IO connection.
 * @param {Socket} socket - The Socket.IO socket instance.
 */
const setupSocketConnection = createSocketConnectionSetup({
    Logger,
    addEmitReceiveToSocket,
    MemoryBrowserCLI,
    io,
    pluginManager,
    frontendInjectionCache: _frontendInjectionCache,
    getActiveChatPathGlobal: () => activeChatPathGlobal,
    chaptermanagement,
    projectHandlers,
    app,
    fileHandlers,
    playerHandlers,
    settingsHandlers,
    emitResponse,
    contentManager,
    getRootDirectory: () => rootDirectory,
    getProjectName,
    fs,
    vnHandlers,
    getMainWindow: () => mainWindow,
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
    invalidateFrontendInjectionCache: _invalidateFrontendInjectionCache
});
// #endregion

// #endregion

function initializeElectronWindow() {
    const runtimeIconPath = path.join(__dirname, '.runtime', 'fablekin.ico');
    const iconPath = process.platform === 'win32' && fsSync.existsSync(runtimeIconPath)
        ? runtimeIconPath
        : path.join(__dirname, 'icon.png');

    mainWindow = initializeMainWindow({
        BrowserWindow,
        windowStateKeeper,
        iconPath,
        initialViewPath: path.join(__dirname, 'views/project_selector/project_selector.html'),
        getRendererSocketQuery,
        runtimeSocketState,
        io,
        Logger
    });
}

function signalLauncherReady() {
    const readyFile = process.env.FABLEKIN_LAUNCH_READY_FILE;
    if (launcherReadySignaled || !readyFile) return;
    launcherReadySignaled = true;

    try {
        fsSync.mkdirSync(path.dirname(readyFile), { recursive: true });
        fsSync.writeFileSync(readyFile, JSON.stringify({
            pid: process.pid,
            readyAt: Date.now()
        }), 'utf8');
        Logger.log('Main', 'Startup', `Launcher readiness signaled: ${readyFile}`);
    } catch (error) {
        Logger.error('Main', 'Startup', `Failed to signal launcher readiness: ${readyFile}`, error);
    }
}

// #endregion

// #region WINDOW CONTROLS IPC
registerWindowControlsIpc({
    ipcMain,
    BrowserWindow,
    getMainWindow: () => mainWindow
});
// #endregion

// #region APPLICATION STARTUP
// Initialize PluginManager early so listeners are ready for the first connection
const { waitForStartupOrQuit } = createStartupSequence({
    Logger,
    app,
    engineDir: __dirname,
    secureStorage,
    patchSettingsWithSecrets,
    pluginManager,
    chaptermanagement,
    getStaticDataManager: () => staticDataManager,
    io,
    appExpress,
    startSocketServer,
    server,
    setupSocketConnection,
    setIoInstance,
    vnmanager,
    runtimeSocketState,
    settings,
    keyMapping,
    saveSettings,
    fs,
    logsDir,
    cleanupOldLogs,
    socketHost: CONFIG.SOCKET_HOST,
    timeline
});
app.whenReady().then(async () => {
    await waitForStartupOrQuit();
    initializeElectronWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        const signalWhenLoaded = () => {
            signalLauncherReady();
        };
        if (mainWindow.webContents.isLoading()) {
            mainWindow.webContents.once('did-finish-load', signalWhenLoaded);
        } else {
            signalWhenLoaded();
        }
    } else {
        signalLauncherReady();
    }
});

app.on('window-all-closed', async () => {
    server.close(); // Explicitly close the HTTP server
    io.close();     // Explicitly close the Socket.IO server
    if (staticDataManager) {
        await staticDataManager.close();
    }
    await closeFactManager();
    await chaptermanagement.close(); // Ensure chapter management DB is closed
    app.quit();
});

// #endregion
// #endregion




}

main();


