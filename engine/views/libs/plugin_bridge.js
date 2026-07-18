/**
 * Plugin Bridge for Dynamic Narrative Engine
 * 
 * Provides a standardized way for any view (core or plugin) to:
 * 1. Listen for socket events.
 * 2. Send socket events.
 * 3. Handle GUI interceptions and injections.
 * 4. Register itself as a specific view.
 */

(function() {
    const params = new URLSearchParams(window.location.search || '');
    const socketHost = params.get('socketHost') || '127.0.0.1';
    const socketPortRaw = params.get('socketPort') || '14541';
    const socketToken = params.get('socketToken') || '';
    const parsedPort = Number.parseInt(socketPortRaw, 10);
    const socketPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 14541;
    const serverUrl = typeof window.getAppServerUrl === 'function'
        ? window.getAppServerUrl()
        : `http://${socketHost}:${socketPort}`;
    const socketOptions = typeof window.withAppSocketAuth === 'function'
        ? window.withAppSocketAuth({})
        : (socketToken ? { auth: { token: socketToken }, query: { token: socketToken } } : {});
    const socket = io(serverUrl, socketOptions); // Assumes socket.io-client is loaded globally
    if (typeof socket.emitReceive !== 'function') {
        socket.emitReceive = function(eventName, data, timeout = 10000) {
            return new Promise((resolve) => {
                let responded = false;
                const timer = setTimeout(() => {
                    if (!responded) {
                        responded = true;
                        resolve({ success: false, error: 'timeout' });
                    }
                }, timeout);

                this.emit(eventName, data);
                this.once(`${eventName}-response`, (result) => {
                    if (!responded) {
                        responded = true;
                        clearTimeout(timer);
                        resolve(result);
                    }
                });
            });
        };
    }

    const viewId = params.get('viewId') || window.location.pathname.split('/').pop().replace('.html', '');
    const pluginId = params.get('pluginId');

    console.log(`[PluginBridge] Initializing for view: ${viewId} (Plugin: ${pluginId || 'core'})`);

    // Automatic registration
    socket.on('connect', () => {
        console.log(`[PluginBridge] Connected to socket server.`);
        socket.emit('register-view', { viewId, pluginId });
    });

    // Handle generic JS injection
    socket.on('gui-plugin-inject', (data) => {
        // Only act if targetView matches our viewId or is broadcast (*)
        if (data.targetView && data.targetView !== '*' && data.targetView !== viewId) return;
        
        console.log(`[PluginBridge] Received injection for ${viewId}`);
        if (data.css) {
            const style = document.createElement('style');
            style.textContent = data.css;
            document.head.appendChild(style);
        }
        if (data.html && data.selector) {
            const container = document.querySelector(data.selector);
            if (container) {
                container.insertAdjacentHTML('beforeend', data.html);
            }
        }
        if (data.js) {
            try {
                // Execute JS in a scoped context with bridge access
                const fn = new Function('bridge', 'socket', data.js);
                fn(window.bridge, socket);
            } catch (err) {
                console.error(`[PluginBridge] Error in injected JS for ${viewId}:`, err);
            }
        }
    });

    // Standardized Bridge Object
    window.bridge = {
        /**
         * Emits a socket event.
         */
        emit: (event, data) => socket.emit(event, data),

        /**
         * Emits a socket event and waits for an "[event]-response" reply.
         */
        request: (event, data, timeout) => socket.emitReceive(event, data, timeout),

        /**
         * Registers a listener for a socket event.
         */
        on: (event, callback) => socket.on(event, callback),

        /**
         * Gets view information.
         */
        getViewInfo: () => ({ viewId, pluginId }),

        /**
         * Closes the current view (if it's a plugin tab or window).
         */
        close: () => {
             socket.emit('close-view', { viewId });
        }
    };

    // Export socket globally just in case
    window.socket = socket;

})();
