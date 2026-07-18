// Socket bootstrap helper for renderer/webview contexts.
// Reads runtime socket configuration from URL query parameters and wraps
// `window.io(...)` so legacy hardcoded localhost URLs keep working.
(function socketBootstrap(global) {
    'use strict';

    function readConfig() {
        const params = new URLSearchParams(global.location && global.location.search ? global.location.search : '');
        const protocol = (params.get('socketProtocol') || 'http').trim();
        const host = (params.get('socketHost') || '127.0.0.1').trim();
        const portRaw = (params.get('socketPort') || '14541').trim();
        const token = (params.get('socketToken') || '').trim();
        const port = Number.parseInt(portRaw, 10);
        const safePort = Number.isFinite(port) && port > 0 ? port : 14541;
        const url = `${protocol}://${host}:${safePort}`;

        return {
            protocol,
            host,
            port: safePort,
            token,
            url
        };
    }

    function withAuth(config, inputOptions) {
        const options = inputOptions && typeof inputOptions === 'object' ? { ...inputOptions } : {};
        options.auth = { ...(options.auth || {}) };
        options.query = { ...(options.query || {}) };

        if (config.token && !options.auth.token) {
            options.auth.token = config.token;
        }
        if (config.token && !options.query.token) {
            options.query.token = config.token;
        }

        return options;
    }

    function shouldSwapUri(uri) {
        if (!uri) return true;
        return uri === 'http://localhost:14541' || uri === 'http://127.0.0.1:14541';
    }

    const config = readConfig();

    global.__APP_SOCKET_CONFIG__ = config;
    global.getAppSocketConfig = function getAppSocketConfig() {
        return { ...config };
    };
    global.getAppServerUrl = function getAppServerUrl() {
        return config.url;
    };
    global.withAppSocketAuth = function withAppSocketAuth(options) {
        return withAuth(config, options);
    };
    global.createAppSocket = function createAppSocket(options) {
        if (typeof global.io !== 'function') {
            throw new Error('Socket.IO client is not loaded in this view.');
        }
        return global.io(config.url, withAuth(config, options));
    };

    if (typeof global.io === 'function' && !global.io.__fablekinWrapped) {
        const originalIo = global.io;
        const wrappedIo = function wrappedIo(uri, options) {
            let targetUri = uri;
            let targetOptions = options;

            // Support io(options) overload.
            if (targetUri && typeof targetUri === 'object' && !Array.isArray(targetUri)) {
                targetOptions = targetUri;
                targetUri = undefined;
            }

            if (shouldSwapUri(targetUri)) {
                targetUri = config.url;
            }

            return originalIo(targetUri, withAuth(config, targetOptions));
        };

        Object.assign(wrappedIo, originalIo);
        wrappedIo.__fablekinWrapped = true;
        wrappedIo.__fablekinOriginal = originalIo;
        global.io = wrappedIo;
    }
})(typeof window !== 'undefined' ? window : globalThis);
