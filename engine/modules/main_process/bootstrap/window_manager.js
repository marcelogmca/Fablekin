function buildWindowStatePayload(windowRef) {
    return {
        isMaximized: windowRef.isMaximized(),
        isFullScreen: windowRef.isFullScreen()
    };
}

function toggleVnFullscreen(windowRef, io, Logger, source = 'ui') {
    if (!windowRef || windowRef.isDestroyed()) return null;
    const isFullScreen = !windowRef.isFullScreen();
    windowRef.setFullScreen(isFullScreen);
    if (io && typeof io.emit === 'function') {
        io.emit('vn-fullscreen-state-changed', { isFullScreen });
    }
    if (Logger && typeof Logger.log === 'function') {
        Logger.log('Main', 'UI', `Fullscreen toggled (${source}): ${isFullScreen}`);
    }
    return isFullScreen;
}

function initializeMainWindow({
    BrowserWindow,
    windowStateKeeper,
    iconPath,
    initialViewPath,
    getRendererSocketQuery,
    runtimeSocketState,
    io,
    Logger
}) {
    const mainWindowState = windowStateKeeper({
        defaultWidth: 1280,
        defaultHeight: 720
    });

    const mainWindow = new BrowserWindow({
        show: false,
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        icon: iconPath,
        frame: false, // Make window frameless
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true
        }
    });

    mainWindowState.manage(mainWindow);

    if (process.platform === 'win32' && iconPath) {
        mainWindow.setIcon(iconPath);
        mainWindow.setAppDetails({
            appId: 'com.fablekin.app',
            appIconPath: iconPath,
            appIconIndex: 0,
            relaunchCommand: process.execPath,
            relaunchDisplayName: 'Fablekin'
        });
    }

    if (mainWindowState.isMaximized) {
        mainWindow.maximize();
    }

    mainWindow.show();
    mainWindow.loadFile(initialViewPath, { query: getRendererSocketQuery(runtimeSocketState) });

    mainWindow.webContents.once('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-state-changed', buildWindowStatePayload(mainWindow));
        }
    });

    const notifyWindowState = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-state-changed', buildWindowStatePayload(mainWindow));
        }
    };

    mainWindow.webContents.on('before-input-event', (event, input) => {
        const isF11KeyDown = input
            && input.type === 'keyDown'
            && (input.key === 'F11' || input.code === 'F11');
        if (!isF11KeyDown) return;

        // Disable Electron/browser default fullscreen handling for F11.
        event.preventDefault();

        const currentUrl = mainWindow.webContents.getURL() || '';
        const isVnViewer = currentUrl.includes('vn_viewer/viewer.html') || currentUrl.includes('viewer.html');
        if (!isVnViewer) return;

        toggleVnFullscreen(mainWindow, io, Logger, 'f11');
    });

    mainWindow.on('maximize', notifyWindowState);
    mainWindow.on('unmaximize', notifyWindowState);
    mainWindow.on('enter-full-screen', notifyWindowState);
    mainWindow.on('leave-full-screen', notifyWindowState);

    mainWindow.on('focus', () => {
        io.emit('window-focus-changed', { isFocused: true });
    });

    mainWindow.on('blur', () => {
        io.emit('window-focus-changed', { isFocused: false });
    });

    mainWindow.on('minimize', () => {
        io.emit('window-focus-changed', { isFocused: false });
    });

    mainWindow.on('restore', () => {
        // Let the focus event handle the 'true' state to avoid double-firing,
        // but just in case, we also emit true here.
        io.emit('window-focus-changed', { isFocused: true });
    });

    mainWindow.on('hide', () => {
        io.emit('window-focus-changed', { isFocused: false });
    });

    mainWindow.on('show', () => {
        io.emit('window-focus-changed', { isFocused: true });
    });

    Logger.log('Main', 'Startup', 'Electron window initialized');
    return mainWindow;
}

function registerWindowControlsIpc({ ipcMain, BrowserWindow, getMainWindow }) {
    let lastMaximizeCall = 0;

    ipcMain.on('window-minimize', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window-maximize', (event) => {
        const now = Date.now();
        if (now - lastMaximizeCall < 300) return; // Backend debounce
        lastMaximizeCall = now;

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    });

    ipcMain.on('window-close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.close();
    });

    ipcMain.on('request-window-state', (event) => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            event.reply('window-state-changed', buildWindowStatePayload(mainWindow));
        }
    });
}

module.exports = {
    initializeMainWindow,
    registerWindowControlsIpc,
    toggleVnFullscreen
};
