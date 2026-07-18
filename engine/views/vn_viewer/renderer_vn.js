import { initElements } from './js/elements.js';
import { initSocketExtensions } from './js/utils.js';
import { initSocketHandlers } from './js/socket_handler.js';
import { initUIEvents } from './js/ui_events.js';
import { applyVNSettings, loadVNSettings } from './js/settings_manager.js';
import { pixiApp } from './js/pixi_engine.js';
import { initGlobalAPI } from './js/vn_api.js';
import { pixiRenderer } from './js/pixi_renderer.js';
import { initTransitionRuntimeListeners } from './js/transition_manager.js';
import { SERVER_URL, getPluginRouteUrl } from './js/utils.js';
// Import advanced blend modes to enable 'multiply' etc.
// Note: In a browser environment with CDN, we might need a specific URL or rely on PixiJS core if they are bundled.
// For now, I'll follow the user's advice to add the import.

// Global Socket Initialization
const socket = typeof window.createAppSocket === 'function'
    ? window.createAppSocket()
    : io(SERVER_URL);
window.socket = socket; // Make available globally
window.PIXI = PIXI; // Ensure PIXI is global for plugins

window.addEventListener('beforeunload', () => {
    fetch(getPluginRouteUrl('tts_core', 'cancel-all'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'viewer_unload' }),
        keepalive: true
    }).catch(() => {
        // Best-effort signal only.
    });
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize DOM elements cache
    initElements();

    // 2. Initialize utility extensions (like socket.emitReceive)
    initSocketExtensions(socket);

    // 3. Initialize Socket.io event handlers
    initSocketHandlers(socket);

    // 4. Initialize UI event listeners
    initUIEvents(socket);

    // 5. Initial settings application
    applyVNSettings();
    loadVNSettings(socket);

    // 6. Initialize PixiJS Core
    pixiApp.init().then(() => {
        // Initialize background snapshotting after Pixi is ready
        pixiRenderer.initBgSnapshot();
        // Initialize runtime override listeners
        pixiRenderer.initRuntimeListeners();
    });

    // 7. Initialize Global VN API
    initGlobalAPI();
    initTransitionRuntimeListeners();

    console.log('[VN] Renderer Initialized in Modular Mode');
});
