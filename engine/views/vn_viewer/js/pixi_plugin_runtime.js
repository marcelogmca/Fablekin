/**
 * pixi_plugin_runtime.js
 *
 * Thin lifecycle runtime for PixiJS frontend plugins.
 * Loaded BEFORE any plugin injection JS executes.
 *
 * API:
 *   VN.pixiPlugins.register('my_plugin', (runtime) => {
 *       runtime.onWindow('event', handler);
 *       runtime.onSocket('event', handler);
 *       runtime.onPreRender(tickFn, priority);
 *       runtime.onPostRender(tickFn);
 *       runtime.onDispose(() => { custom cleanup });
 *       return optionalDisposeFn;
 *   });
 */
(function () {
    'use strict';

    const _registry = {};
    let _pixiAppRef = null;

    function setPixiApp(app) {
        _pixiAppRef = app;
    }

    function getPixiApp() {
        if (_pixiAppRef) return _pixiAppRef;
        // Lazy discovery via global VN API
        if (window.VN?.pixiApp) {
            _pixiAppRef = window.VN.pixiApp;
        }
        return _pixiAppRef;
    }

    function register(pluginId, setupFn) {
        // Idempotency: auto-dispose previous instance
        if (_registry[pluginId]) {
            console.log(`[PixiPluginRuntime] Re-registering "${pluginId}", disposing previous instance`);
            dispose(pluginId);
        }

        const abortController = new AbortController();
        const socketBindings = [];
        const tickerBindings = [];
        const disposeCallbacks = [];
        let disposed = false;

        const runtime = {
            get disposed() { return disposed; },

            /**
             * Tracked window.addEventListener.
             * All listeners are auto-removed on dispose via AbortController.
             */
            onWindow(event, handler, options) {
                if (disposed) return;
                const merged = Object.assign({}, options || {}, { signal: abortController.signal });
                window.addEventListener(event, handler, merged);
            },

            /**
             * Tracked socket.on.
             * All listeners are auto-removed on dispose via socket.off.
             */
            onSocket(event, handler) {
                if (disposed) return;
                const socket = window.socket;
                if (!socket) {
                    console.warn(`[PixiPluginRuntime] "${pluginId}": socket unavailable for "${event}"`);
                    return;
                }
                socket.on(event, handler);
                socketBindings.push({ event, handler });
            },

            /**
             * Tracked pixiApp.hooks.addPreRender.
             * All hooks are auto-removed on dispose.
             * @param {Function} fn - Ticker callback
             * @param {number} [priority=0] - PixiJS ticker priority
             */
            onPreRender(fn, priority) {
                if (disposed) return;
                const app = getPixiApp();
                if (app?.hooks) {
                    app.hooks.addPreRender(fn, priority ?? 0);
                    tickerBindings.push({ type: 'pre', fn, priority: priority ?? 0 });
                } else {
                    console.warn(`[PixiPluginRuntime] "${pluginId}": pixiApp unavailable for onPreRender`);
                }
            },

            /**
             * Tracked pixiApp.hooks.addPostRender.
             * Auto-removed on dispose.
             */
            onPostRender(fn) {
                if (disposed) return;
                const app = getPixiApp();
                if (app?.hooks) {
                    app.hooks.addPostRender(fn);
                    tickerBindings.push({ type: 'post', fn });
                } else {
                    console.warn(`[PixiPluginRuntime] "${pluginId}": pixiApp unavailable for onPostRender`);
                }
            },

            /**
             * Register an arbitrary cleanup callback to run on dispose.
             */
            onDispose(fn) {
                if (typeof fn === 'function') {
                    disposeCallbacks.push(fn);
                }
            },
        };

        // Execute plugin setup
        let setupResult;
        try {
            setupResult = setupFn(runtime);
        } catch (err) {
            console.error(`[PixiPluginRuntime] Setup failed for "${pluginId}":`, err);
            abortController.abort();
            return;
        }

        // Setup can return a dispose function as shorthand
        if (typeof setupResult === 'function') {
            disposeCallbacks.push(setupResult);
        }

        _registry[pluginId] = {
            abortController,
            socketBindings,
            tickerBindings,
            disposeCallbacks,
            paused: false,
            _setDisposed() { disposed = true; },
        };

        console.log(`[PixiPluginRuntime] Registered "${pluginId}"`);
    }

    function dispose(pluginId) {
        const entry = _registry[pluginId];
        if (!entry) return;

        console.log(`[PixiPluginRuntime] Disposing "${pluginId}"`);
        entry._setDisposed();

        // 1. Abort all window listeners
        entry.abortController.abort();

        // 2. Remove all socket listeners
        const socket = window.socket;
        if (socket) {
            for (const { event, handler } of entry.socketBindings) {
                socket.off(event, handler);
            }
        }

        // 3. Remove all ticker hooks
        const app = getPixiApp();
        if (app?.hooks) {
            for (const binding of entry.tickerBindings) {
                app.hooks.remove(binding.fn);
            }
        }

        // 4. Run custom dispose callbacks (reverse order for LIFO cleanup)
        for (let i = entry.disposeCallbacks.length - 1; i >= 0; i--) {
            try {
                entry.disposeCallbacks[i]();
            } catch (err) {
                console.error(`[PixiPluginRuntime] Dispose callback error for "${pluginId}":`, err);
            }
        }

        delete _registry[pluginId];
    }

    function disposeAll() {
        for (const pluginId of Object.keys(_registry)) {
            dispose(pluginId);
        }
    }

    function isRegistered(pluginId) {
        return !!_registry[pluginId];
    }

    function isPaused(pluginId) {
        return !!_registry[pluginId]?.paused;
    }

    function pause(pluginId) {
        const entry = _registry[pluginId];
        if (!entry || entry.paused) return;
        
        const app = getPixiApp();
        if (app?.hooks) {
            for (const binding of entry.tickerBindings) {
                app.hooks.remove(binding.fn);
            }
            entry.paused = true;
            console.log(`[PixiPluginRuntime] Paused "${pluginId}"`);
        }
    }

    function resume(pluginId) {
        const entry = _registry[pluginId];
        if (!entry || !entry.paused) return;

        const app = getPixiApp();
        if (app?.hooks) {
            for (const binding of entry.tickerBindings) {
                if (binding.type === 'pre') {
                    app.hooks.addPreRender(binding.fn, binding.priority);
                } else if (binding.type === 'post') {
                    app.hooks.addPostRender(binding.fn);
                }
            }
            entry.paused = false;
            console.log(`[PixiPluginRuntime] Resumed "${pluginId}"`);
        }
    }

    function pauseAll() {
        for (const pluginId of Object.keys(_registry)) pause(pluginId);
    }

    function resumeAll() {
        for (const pluginId of Object.keys(_registry)) resume(pluginId);
    }

    function isInTakeover() {
        return document.body.classList.contains('pixi-takeover-active');
    }

    const publicApi = {
        register,
        dispose,
        disposeAll,
        isRegistered,
        isPaused,
        pause,
        resume,
        pauseAll,
        resumeAll,
        setPixiApp,
        getPixiApp,
        isInTakeover,
    };

    window.VN = window.VN || {};
    window.VN.pixiPlugins = publicApi;
})();
