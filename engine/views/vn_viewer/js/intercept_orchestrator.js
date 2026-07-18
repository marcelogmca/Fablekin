import { state } from './state.js';
import { elements } from './elements.js';
import { debugError, getAssetUrl } from './utils.js';
import { pixiApp } from './pixi_engine.js';
import { pixiSpriteManager } from './pixi_sprite_manager.js';
import {
    beginPixiTakeover,
    endPixiTakeover,
    createPixiTakeoverBridge,
    getPixiTakeoverLayer
} from './pixi_takeover_manager.js';
import {
    spawnSessionActor,
    updateSessionActor,
    removeSessionActor,
    clearSessionActors,
    endSessionActors,
    endAllActorSessions,
    listSessionActorKeys
} from './intercept_actor_manager.js';
import {
    setSessionBackground,
    restoreSessionBackground,
    getSessionBackgroundState,
    endSessionBackground,
    endAllBackgroundSessions
} from './intercept_background_manager.js';
import { playTransition } from './transition_manager.js';

const SUPPORTED_CHECKPOINTS = new Set([
    'before_first_dialogue',
    'on_dialogue_enter',
    'before_user_input_show',
    'during_user_input',
    'before_submit'
]);

const orchestrator = {
    socket: null,
    bridgeHandlers: {
        navigateForward: null,
        navigateBack: null,
        navigateTo: null,
        submitAndGenerate: null
    },
    activeOverlay: null,
    nonBlockingOverlays: new Map()
};

function logInterceptFlow(event, data = null) {
    try {
        if (data === null || data === undefined || data === '') {
            console.info(`[InterceptFlow] ${event}`);
        } else {
            console.info(`[InterceptFlow] ${event}`, data);
        }
    } catch (_) { }
}

function getDescriptorDebugLabel(descriptor = null) {
    const rawLabel = descriptor?.debugLabel || descriptor?.diagnosticLabel || descriptor?.debugTag || null;
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (!label) return null;
    return label.replace(/[^\w:.-]+/g, '_').slice(0, 80) || null;
}

function logDescriptorDebug(descriptor, event, data = null) {
    const label = getDescriptorDebugLabel(descriptor);
    if (!label) return;
    try {
        if (data === null || data === undefined || data === '') {
            console.info(`[${label}] ${event}`);
        } else {
            console.info(`[${label}] ${event}`, data);
        }
    } catch (_) { }
}

function getNonBlockingDescriptorKey(descriptor, checkpoint) {
    const pluginId = descriptor?.pluginId || 'unknown_plugin';
    const interceptId = descriptor?.interceptId || descriptor?.id || `order_${descriptor?._order ?? 'na'}`;
    return `${pluginId}::${interceptId}::${checkpoint || descriptor?.checkpoint || 'unknown_checkpoint'}`;
}

function cleanupNonBlockingOverlays({ descriptorKey = null, preservePredicate = null } = {}) {
    if (!(orchestrator.nonBlockingOverlays instanceof Map) || orchestrator.nonBlockingOverlays.size === 0) {
        return;
    }

    const entries = Array.from(orchestrator.nonBlockingOverlays.entries());
    logInterceptFlow('cleanup-nonblocking:start', {
        requestedDescriptorKey: descriptorKey || null,
        totalEntries: entries.length,
        hasPreservePredicate: typeof preservePredicate === 'function'
    });
    for (const [runId, entry] of entries) {
        if (descriptorKey && entry?.descriptorKey !== descriptorKey) continue;
        if (typeof preservePredicate === 'function' && preservePredicate(entry) === true) {
            logInterceptFlow('cleanup-nonblocking:preserve', {
                runId,
                descriptorKey: entry?.descriptorKey || null,
                checkpoint: entry?.descriptor?.checkpoint || null,
                interceptId: entry?.descriptor?.interceptId || null,
                pluginId: entry?.descriptor?.pluginId || null
            });
            continue;
        }
        logInterceptFlow('cleanup-nonblocking:remove', {
            runId,
            descriptorKey: entry?.descriptorKey || null,
            checkpoint: entry?.descriptor?.checkpoint || null,
            interceptId: entry?.descriptor?.interceptId || null,
            pluginId: entry?.descriptor?.pluginId || null
        });
        try {
            if (typeof entry?.cleanup === 'function') {
                entry.cleanup();
            }
        } catch (error) {
            debugError('[Intercept] Failed to cleanup non-blocking overlay', error);
        } finally {
            setMainSpriteHideLock(runId, false);
            endSessionBackground(runId, 'nonblocking-overlay-cleanup', { restore: true, instant: false });
            endSessionActors(runId, 'nonblocking-overlay-cleanup');
            orchestrator.nonBlockingOverlays.delete(runId);
        }
    }
    logInterceptFlow('cleanup-nonblocking:end', {
        remainingEntries: orchestrator.nonBlockingOverlays.size
    });
}

function ensureInterceptRuntimeState() {
    if (!state.interceptRuntime || typeof state.interceptRuntime !== 'object') {
        state.interceptRuntime = {
            descriptors: [],
            statusByKey: {},
            sessionResolved: {},
            pluginState: {},
            currentTurnNumber: null,
            visualLocks: {
                mainSpritesHideRunIds: {}
            },
            takeover: {
                active: false,
                runId: null,
                pluginId: null,
                interceptId: null,
                checkpoint: null,
                startedAt: null,
                reason: null
            }
        };
    }
    if (!Array.isArray(state.interceptRuntime.descriptors)) state.interceptRuntime.descriptors = [];
    if (!state.interceptRuntime.statusByKey || typeof state.interceptRuntime.statusByKey !== 'object') {
        state.interceptRuntime.statusByKey = {};
    }
    if (!state.interceptRuntime.sessionResolved || typeof state.interceptRuntime.sessionResolved !== 'object') {
        state.interceptRuntime.sessionResolved = {};
    }
    if (!state.interceptRuntime.pluginState || typeof state.interceptRuntime.pluginState !== 'object') {
        state.interceptRuntime.pluginState = {};
    }
    if (!state.interceptRuntime.visualLocks || typeof state.interceptRuntime.visualLocks !== 'object') {
        state.interceptRuntime.visualLocks = {
            mainSpritesHideRunIds: {}
        };
    }
    if (!state.interceptRuntime.visualLocks.mainSpritesHideRunIds || typeof state.interceptRuntime.visualLocks.mainSpritesHideRunIds !== 'object') {
        state.interceptRuntime.visualLocks.mainSpritesHideRunIds = {};
    }
    if (!state.interceptRuntime.takeover || typeof state.interceptRuntime.takeover !== 'object') {
        state.interceptRuntime.takeover = {
            active: false,
            runId: null,
            pluginId: null,
            interceptId: null,
            checkpoint: null,
            startedAt: null,
            reason: null
        };
    }
}

function descriptorWantsMainSpriteHide(descriptor = null, uiPayload = null) {
    const descriptorVisual = descriptor?.visualState;
    const payloadVisual = uiPayload?.visualState;
    return (
        descriptorVisual?.hideMainSpritesWhileVisible === true
        || payloadVisual?.hideMainSpritesWhileVisible === true
        || descriptor?.hideMainSpritesWhileVisible === true
    );
}

const INTERCEPT_OVERLAY_BACKDROP_MODES = new Set(['none', 'dim', 'glass']);

function resolveOverlayBackdropMode(descriptor = null, uiPayload = null) {
    const requested =
        descriptor?.visualState?.overlayBackdrop
        ?? uiPayload?.visualState?.overlayBackdrop
        ?? descriptor?.overlayBackdrop
        ?? uiPayload?.overlayBackdrop;
    const normalized = typeof requested === 'string' ? requested.trim().toLowerCase() : '';
    return INTERCEPT_OVERLAY_BACKDROP_MODES.has(normalized) ? normalized : 'none';
}

function refreshMainSpriteVisibility() {
    const userSettingHidden = state.vnSettings?.visuals?.hide_main_sprites === true;
    const lockMap = state.interceptRuntime?.visualLocks?.mainSpritesHideRunIds;
    const hiddenByIntercept = !!(lockMap && Object.keys(lockMap).length > 0);
    const hidden = userSettingHidden || hiddenByIntercept;

    // Legacy DOM sprite container safety (for fallback/old payload states).
    if (elements.characterContainer) {
        elements.characterContainer.style.opacity = hidden ? '0' : '';
        elements.characterContainer.style.pointerEvents = hidden ? 'none' : '';
    }

    import('./pixi_sprite_manager.js')
        .then((m) => m?.pixiSpriteManager?.updateSpriteVisibility?.())
        .catch(() => { });
}

function setMainSpriteHideLock(runId, enabled) {
    if (!runId) return;
    ensureInterceptRuntimeState();
    const map = state.interceptRuntime.visualLocks.mainSpritesHideRunIds;
    if (enabled) {
        map[runId] = true;
    } else {
        delete map[runId];
    }
    refreshMainSpriteVisibility();
}

function clearMainSpriteHideLocks() {
    ensureInterceptRuntimeState();
    state.interceptRuntime.visualLocks.mainSpritesHideRunIds = {};
    refreshMainSpriteVisibility();
}

function getDescriptorRenderer(descriptor, uiPayload = null) {
    const fromDescriptor = typeof descriptor?.renderer === 'string'
        ? descriptor.renderer.trim().toLowerCase()
        : '';
    if (fromDescriptor) return fromDescriptor;

    const fromPayload = typeof uiPayload?.renderer === 'string'
        ? uiPayload.renderer.trim().toLowerCase()
        : '';
    if (fromPayload) return fromPayload;

    return 'html';
}

function toIntegerOrNull(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function normalizeCheckpoint(rawCheckpoint, descriptor) {
    const value = (rawCheckpoint || '').toString().trim().toLowerCase();
    if (SUPPORTED_CHECKPOINTS.has(value)) return value;

    const dialogueIdx = toIntegerOrNull(descriptor?.dialogueIndex);
    if (dialogueIdx !== null) {
        if (dialogueIdx < 0) return 'before_first_dialogue';
        return 'on_dialogue_enter';
    }

    return 'on_dialogue_enter';
}

function normalizeDescriptor(descriptor, lane, order) {
    if (!descriptor || typeof descriptor !== 'object') return null;

    const pluginId = descriptor.pluginId || descriptor.plugin || null;
    const interceptId = descriptor.interceptId || descriptor.id || descriptor.handlerId || null;
    const dialogueIndex = toIntegerOrNull(descriptor.dialogueIndex);
    const priority = Number.isFinite(descriptor.priority) ? descriptor.priority : 100;
    const blocking = descriptor.blocking !== false;
    const replayPolicy = (descriptor.replayPolicy || 'every_enter').toString();
    const checkpoint = normalizeCheckpoint(descriptor.checkpoint, descriptor);
    const normalizeTransitionDescriptor = (value = null) => {
        if (!value || typeof value !== 'object') return null;
        const effect = String(value.effect || '').trim().toLowerCase();
        if (!effect) return null;
        const normalized = {
            effect,
            scope: String(value.scope || '').trim().toLowerCase() || 'intercept',
            blocking: value.blocking !== false
        };
        if (typeof value.target === 'string' && value.target.trim()) normalized.target = value.target.trim();
        if (Number.isFinite(Number(value.durationMs))) normalized.durationMs = Math.max(0, Math.min(15000, Number(value.durationMs)));
        if (typeof value.direction === 'string' && value.direction.trim()) normalized.direction = value.direction.trim().toLowerCase();
        if (typeof value.easing === 'string' && value.easing.trim()) normalized.easing = value.easing.trim();
        if (value.options && typeof value.options === 'object') normalized.options = { ...value.options };
        return normalized;
    };

    return {
        ...descriptor,
        pluginId,
        interceptId,
        dialogueIndex,
        priority,
        blocking,
        replayPolicy,
        checkpoint,
        autoDismiss: descriptor.autoDismiss,
        transitionIn: normalizeTransitionDescriptor(descriptor.transitionIn),
        transitionOut: normalizeTransitionDescriptor(descriptor.transitionOut),
        lane,
        _order: order
    };
}

function createDescriptorKey(descriptor, checkpoint, checkpointContext = {}) {
    const turnNumber = state.interceptRuntime.currentTurnNumber || state.currentVN?.turnNumber || 'unknown_turn';
    const idx = checkpoint === 'on_dialogue_enter'
        ? (Number.isInteger(checkpointContext.dialogueIndex) ? checkpointContext.dialogueIndex : 'any')
        : (Number.isInteger(descriptor.dialogueIndex) ? descriptor.dialogueIndex : 'na');
    return [
        turnNumber,
        checkpoint,
        idx,
        descriptor.pluginId || 'unknown_plugin',
        descriptor.interceptId || `order_${descriptor._order}`
    ].join('|');
}

function shouldExecuteDescriptor(descriptor, checkpoint, checkpointContext = {}) {
    if (descriptor.checkpoint !== checkpoint) return false;

    if (checkpoint === 'on_dialogue_enter') {
        if (Number.isInteger(descriptor.dialogueIndex) && descriptor.dialogueIndex !== checkpointContext.dialogueIndex) {
            return false;
        }
    }

    const key = createDescriptorKey(descriptor, checkpoint, checkpointContext);
    const status = state.interceptRuntime.statusByKey[key];
    const policy = (descriptor.replayPolicy || 'every_enter').toLowerCase();
    const sessionKey = `${descriptor.pluginId || 'unknown_plugin'}::${descriptor.interceptId || key}`;

    if (policy === 'once_per_turn') {
        return !status?.ran;
    }
    if (policy === 'until_resolved') {
        return !status?.resolved;
    }
    if (policy === 'once_per_session') {
        return !state.interceptRuntime.sessionResolved[sessionKey];
    }

    // every_enter
    return true;
}

function markDescriptorStatus(descriptor, checkpoint, checkpointContext = {}, patch = {}) {
    const key = createDescriptorKey(descriptor, checkpoint, checkpointContext);
    const current = state.interceptRuntime.statusByKey[key] || {
        visits: 0,
        ran: false,
        resolved: false,
        lastResult: null
    };
    const next = {
        ...current,
        ...patch
    };
    state.interceptRuntime.statusByKey[key] = next;

    const policy = (descriptor.replayPolicy || '').toLowerCase();
    if (policy === 'once_per_session' && next.resolved) {
        const sessionKey = `${descriptor.pluginId || 'unknown_plugin'}::${descriptor.interceptId || key}`;
        state.interceptRuntime.sessionResolved[sessionKey] = true;
    }
}

function applyResultOverrides(working, data = {}) {
    if (!data || typeof data !== 'object') return;

    if (typeof data.messageOverride === 'string') {
        working.message = data.messageOverride;
    }
    if (typeof data.userInputOverride === 'string') {
        working.message = data.userInputOverride;
    }
    if (typeof data.directorPromptOverride === 'string') {
        working.directorPrompt = data.directorPromptOverride;
    }
    if (typeof data.directorOverride === 'string') {
        working.directorPrompt = data.directorOverride;
    }
}

function resolveProjectPath(relPath, projectNameOverride) {
    const projectName = projectNameOverride || state.currentVN?.projectName || state.projectName || window.currentProjectName || 'default_project';
    const cleanPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const projectRelPath = /^(assets|plugins)\//i.test(cleanPath)
        ? cleanPath
        : `assets/${cleanPath}`;
    return getAssetUrl(`projects/${projectName.toLowerCase()}/${projectRelPath}`);
}

function resolvePluginPath(pluginId, relPath) {
    return `../../plugins/${pluginId}/${relPath}`;
}

function getPluginStateStore(pluginId) {
    ensureInterceptRuntimeState();
    const key = pluginId || 'unknown_plugin';
    if (!state.interceptRuntime.pluginState[key]) {
        state.interceptRuntime.pluginState[key] = {};
    }
    return state.interceptRuntime.pluginState[key];
}

function safeClone(value, fallback = null) {
    if (value === undefined) return fallback;
    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
    } catch (_) { }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(base, patch) {
    if (!isPlainObject(base)) return safeClone(patch, patch);
    if (!isPlainObject(patch)) return safeClone(patch, patch);
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        out[key] = isPlainObject(value) && isPlainObject(out[key])
            ? mergePlainObjects(out[key], value)
            : safeClone(value, value);
    }
    return out;
}

function toStoragePart(value) {
    return String(value || 'default')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'default';
}

function clamp01(value, fallback = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(1, numeric));
}

function createLifecycleScope({ runId, descriptor } = {}) {
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const disposeCallbacks = [];
    const abortCallbacks = [];
    const pauseCallbacks = [];
    const resumeCallbacks = [];
    const timers = new Set();
    const intervals = new Set();
    const rafs = new Set();
    let disposed = false;
    let paused = false;

    const addCallback = (list, fn) => {
        if (typeof fn !== 'function') return () => {};
        if (disposed) return () => {};
        list.push(fn);
        return () => {
            const index = list.indexOf(fn);
            if (index >= 0) list.splice(index, 1);
        };
    };

    const callCallbacks = (list, payload, reverse = false) => {
        const callbacks = reverse ? [...list].reverse() : [...list];
        for (const fn of callbacks) {
            try {
                fn(payload);
            } catch (error) {
                debugError('[Intercept] Bridge lifecycle callback failed', error);
            }
        }
    };

    const removeWindowListener = (target, event, handler, options) => {
        try {
            target?.removeEventListener?.(event, handler, options);
        } catch (_) { }
    };

    const lifecycle = {
        get disposed() { return disposed; },
        get paused() { return paused; },
        get signal() { return abortController?.signal || null; },
        get runId() { return runId; },

        onDispose: (fn) => addCallback(disposeCallbacks, fn),
        onAbort: (fn) => addCallback(abortCallbacks, fn),
        onPause: (fn) => addCallback(pauseCallbacks, fn),
        onResume: (fn) => addCallback(resumeCallbacks, fn),

        setTimeout(fn, ms = 0, ...args) {
            if (disposed || typeof fn !== 'function') return null;
            const id = window.setTimeout(() => {
                timers.delete(id);
                if (!disposed) fn(...args);
            }, Math.max(0, Number(ms) || 0));
            timers.add(id);
            return id;
        },

        clearTimeout(id) {
            if (id === null || id === undefined) return;
            window.clearTimeout(id);
            timers.delete(id);
        },

        setInterval(fn, ms = 0, ...args) {
            if (disposed || typeof fn !== 'function') return null;
            const id = window.setInterval(() => {
                if (!disposed) fn(...args);
            }, Math.max(0, Number(ms) || 0));
            intervals.add(id);
            return id;
        },

        clearInterval(id) {
            if (id === null || id === undefined) return;
            window.clearInterval(id);
            intervals.delete(id);
        },

        requestAnimationFrame(fn) {
            if (disposed || typeof fn !== 'function') return null;
            const id = window.requestAnimationFrame((timestamp) => {
                rafs.delete(id);
                if (!disposed) fn(timestamp);
            });
            rafs.add(id);
            return id;
        },

        cancelAnimationFrame(id) {
            if (id === null || id === undefined) return;
            window.cancelAnimationFrame(id);
            rafs.delete(id);
        },

        onWindow(event, handler, options = {}) {
            if (disposed || typeof event !== 'string' || typeof handler !== 'function') return () => {};
            const baseOptions = (options && typeof options === 'object')
                ? { ...options }
                : { capture: !!options };
            const merged = abortController
                ? { ...baseOptions, signal: abortController.signal }
                : baseOptions;
            window.addEventListener(event, handler, merged);
            const off = () => removeWindowListener(window, event, handler, merged);
            disposeCallbacks.push(off);
            return off;
        },

        on(target, event, handler, options = {}) {
            if (disposed || !target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') {
                return () => {};
            }
            const baseOptions = (options && typeof options === 'object')
                ? { ...options }
                : { capture: !!options };
            const merged = abortController
                ? { ...baseOptions, signal: abortController.signal }
                : baseOptions;
            target.addEventListener(event, handler, merged);
            const off = () => removeWindowListener(target, event, handler, merged);
            disposeCallbacks.push(off);
            return off;
        }
    };

    const pause = (reason = 'pause') => {
        if (disposed || paused) return;
        paused = true;
        callCallbacks(pauseCallbacks, { runId, descriptor, reason });
    };

    const resume = (reason = 'resume') => {
        if (disposed || !paused) return;
        paused = false;
        callCallbacks(resumeCallbacks, { runId, descriptor, reason });
    };

    const dispose = (reason = 'dispose', result = null) => {
        if (disposed) return;
        const payload = { runId, descriptor, reason, result };
        const action = String(result?.action || '').toLowerCase();
        if (action === 'cancel' || action === 'error') {
            callCallbacks(abortCallbacks, payload);
        }
        disposed = true;
        for (const id of timers) window.clearTimeout(id);
        for (const id of intervals) window.clearInterval(id);
        for (const id of rafs) window.cancelAnimationFrame(id);
        timers.clear();
        intervals.clear();
        rafs.clear();
        try {
            abortController?.abort(reason);
        } catch (_) { }
        callCallbacks(disposeCallbacks, payload, true);
        disposeCallbacks.length = 0;
        abortCallbacks.length = 0;
        pauseCallbacks.length = 0;
        resumeCallbacks.length = 0;
    };

    lifecycle.pause = pause;
    lifecycle.resume = resume;

    return { lifecycle, dispose, pause, resume };
}

function attachBridgeInternals(bridge, internals) {
    try {
        Object.defineProperty(bridge, '__bridgeInternals', {
            value: internals,
            enumerable: false,
            configurable: false
        });
    } catch (_) {
        bridge.__bridgeInternals = internals;
    }
    return bridge;
}

function disposeBridge(bridge, reason = 'dispose', result = null) {
    try {
        bridge?.__bridgeInternals?.dispose?.(reason, result);
    } catch (error) {
        debugError('[Intercept] Failed to dispose bridge internals', error);
    }
}

function createBridgeLogger({ descriptor, runId }) {
    const pluginId = descriptor?.pluginId || 'unknown_plugin';
    const interceptId = descriptor?.interceptId || descriptor?.id || 'unknown_intercept';
    const prefix = `[Bridge:${pluginId}:${interceptId}:${runId}]`;
    return {
        debug: (...args) => console.debug(prefix, ...args),
        info: (...args) => console.info(prefix, ...args),
        warn: (...args) => console.warn(prefix, ...args),
        error: (...args) => console.error(prefix, ...args),
        mark: (name, data = null) => console.debug(`${prefix} mark:${name}`, data || ''),
        getContext: () => ({ pluginId, interceptId, runId, descriptor: safeClone(descriptor, descriptor) })
    };
}

function createAssetBridge({ descriptor }) {
    const pluginId = descriptor?.pluginId || 'unknown_plugin';

    const url = (path, options = {}) => {
        if (typeof path !== 'string') return '';
        const trimmed = path.trim();
        if (!trimmed) return '';
        if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
        const normalized = trimmed.replace(/\\/g, '/');
        if (
            normalized.startsWith('projects/')
            || normalized.startsWith('/projects/')
            || normalized.includes('workspace/projects/')
        ) {
            return getAssetUrl(normalized);
        }
        if (trimmed.startsWith('plugin://')) {
            const withoutScheme = trimmed.slice('plugin://'.length);
            const slashIndex = withoutScheme.indexOf('/');
            if (slashIndex > 0) {
                return resolvePluginPath(withoutScheme.slice(0, slashIndex), withoutScheme.slice(slashIndex + 1));
            }
            return resolvePluginPath(pluginId, withoutScheme);
        }
        if (trimmed.startsWith('project://')) {
            return resolveProjectPath(trimmed.slice('project://'.length), options.projectName);
        }
        if (options.scope === 'plugin') return resolvePluginPath(options.pluginId || pluginId, trimmed);
        if (options.scope === 'project') return resolveProjectPath(trimmed, options.projectName);
        return trimmed;
    };

    const fetchText = async (path, options = {}) => {
        const response = await fetch(url(path, options), options.fetchOptions || {});
        if (!response.ok) throw new Error(`Asset request failed: ${response.status} ${response.statusText}`);
        return await response.text();
    };

    const loadImage = (path, options = {}) => new Promise((resolve, reject) => {
        const image = new Image();
        if (options.crossOrigin !== undefined) image.crossOrigin = options.crossOrigin;
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Image failed to load: ${path}`));
        image.src = url(path, options);
    });

    const loadAudio = (path, options = {}) => {
        const audio = new Audio(url(path, options));
        audio.preload = options.preload || 'auto';
        if (Number.isFinite(Number(options.volume))) audio.volume = clamp01(options.volume);
        if (options.loop !== undefined) audio.loop = !!options.loop;
        return audio;
    };

    const loadTexture = async (path, options = {}) => {
        const assetUrl = url(path, options);
        if (!window.PIXI?.Assets?.load) {
            throw new Error('PIXI.Assets.load is unavailable.');
        }
        return await window.PIXI.Assets.load(assetUrl);
    };

    const preloadOne = async (entry) => {
        const item = typeof entry === 'string' ? { path: entry } : (entry || {});
        const path = item.path || item.url || '';
        const type = String(item.type || '').toLowerCase();
        const ext = path.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
        if (type === 'texture' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) {
            return await loadTexture(path, item);
        }
        if (type === 'json' || ext === 'json') {
            return JSON.parse(await fetchText(path, item));
        }
        if (type === 'audio' || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
            return loadAudio(path, item);
        }
        return await fetchText(path, item);
    };

    return {
        plugin: (path, pluginIdOverride = pluginId) => resolvePluginPath(pluginIdOverride, path),
        project: (path, projectNameOverride = null) => resolveProjectPath(path, projectNameOverride),
        url,
        loadText: fetchText,
        loadJson: async (path, options = {}) => JSON.parse(await fetchText(path, options)),
        loadImage,
        loadAudio,
        loadTexture,
        preload: async (paths = []) => Promise.all((Array.isArray(paths) ? paths : [paths]).map(preloadOne)),
        getProjectAssetUrl: (path, projectName = null) => getAssetUrl(path, projectName || state.currentVN?.projectName)
    };
}

function createStorageBridge({ descriptor }) {
    const pluginId = descriptor?.pluginId || 'unknown_plugin';
    const projectName = state.currentVN?.projectName || state.projectName || window.currentProjectName || 'default_project';
    const chatKey = state.lastSwitchedPath || state.currentVN?.storageTurnKey || 'default_chat';
    const prefix = [
        'fablekin',
        'bridgeStorage',
        toStoragePart(projectName),
        toStoragePart(chatKey),
        toStoragePart(pluginId)
    ].join(':');

    const storageKey = (key) => `${prefix}:${encodeURIComponent(String(key || 'default'))}`;

    const read = (key, defaultValue = null) => {
        try {
            const raw = window.localStorage?.getItem(storageKey(key));
            if (raw === null || raw === undefined) return defaultValue;
            return JSON.parse(raw);
        } catch (_) {
            return defaultValue;
        }
    };

    const write = (key, value) => {
        try {
            window.localStorage?.setItem(storageKey(key), JSON.stringify(value));
            return value;
        } catch (error) {
            debugError('[Intercept] bridge.storage.set failed', error);
            return value;
        }
    };

    const keys = () => {
        const out = [];
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith(`${prefix}:`)) {
                    out.push(decodeURIComponent(key.slice(prefix.length + 1)));
                }
            }
        } catch (_) { }
        return out;
    };

    return {
        get: read,
        set: write,
        patch: (key, patch) => {
            const next = mergePlainObjects(read(key, {}), patch);
            return write(key, next);
        },
        delete: (key) => {
            try { window.localStorage?.removeItem(storageKey(key)); } catch (_) { }
        },
        clear: () => {
            for (const key of keys()) {
                try { window.localStorage?.removeItem(storageKey(key)); } catch (_) { }
            }
        },
        keys,
        getNamespace: () => prefix
    };
}

function getBridgeAudioVolume(category = 'sfx') {
    const audio = state.vnSettings?.audio || {};
    const key = String(category || 'sfx').toLowerCase();
    if (key === 'ost' || key === 'music') return clamp01(audio.ost_volume, 0.5);
    if (key === 'tts' || key === 'voice') return clamp01(audio.tts_volume, 0.5);
    if (key === 'bgm_sfx' || key === 'ambient' || key === 'ambience') return clamp01(audio.bgm_sfx_volume, 0.3);
    return clamp01(audio.sfx_volume, 0.5);
}

function createAudioBridge({ lifecycle, assets }) {
    const managed = new Map();
    let vnSnapshot = null;
    let vnPlaybackSnapshot = null;

    const stop = (idOrAudio = null) => {
        if (!idOrAudio) {
            for (const key of Array.from(managed.keys())) stop(key);
            return true;
        }
        let id = idOrAudio;
        if (typeof idOrAudio === 'object') {
            id = idOrAudio.__bridgeAudioId || null;
        }
        const audio = managed.get(id);
        if (!audio) return false;
        try {
            audio.pause();
            audio.currentTime = 0;
            audio.src = '';
            audio.load?.();
        } catch (_) { }
        managed.delete(id);
        return true;
    };

    const createManagedAudio = (path, options = {}) => {
        const id = options.id || `audio_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const audio = assets.loadAudio(path, options);
        const categoryVolume = options.respectSettings === false
            ? 1
            : getBridgeAudioVolume(options.category || 'sfx');
        audio.volume = clamp01((options.volume ?? 1) * categoryVolume, categoryVolume);
        audio.loop = !!options.loop;
        audio.__bridgeAudioId = id;
        managed.set(id, audio);
        if (!audio.loop) {
            audio.addEventListener('ended', () => stop(id), { once: true });
        }
        return audio;
    };

    const play = (path, options = {}) => {
        const audio = createManagedAudio(path, options);
        let playPromise = null;
        if (options.autoplay !== false) {
            playPromise = audio.play().then(() => true).catch((error) => {
                audio.__bridgeLastPlayError = error;
                debugError('[Intercept] bridge.audio.play failed', error);
                return false;
            });
        }
        return {
            id: audio.__bridgeAudioId,
            audio,
            src: audio.currentSrc || audio.src || '',
            play: () => audio.play(),
            playPromise,
            stop: () => stop(audio.__bridgeAudioId)
        };
    };

    const duckVN = (options = {}) => {
        if (!vnSnapshot) {
            vnSnapshot = {
                ost: Number.isFinite(elements.audioPlayer?.volume) ? elements.audioPlayer.volume : null,
                voice: Number.isFinite(elements.voicePlayer?.volume) ? elements.voicePlayer.volume : null
            };
        }
        const factor = clamp01(options.factor ?? 0.35, 0.35);
        if (elements.audioPlayer && vnSnapshot.ost !== null) {
            elements.audioPlayer.volume = clamp01(vnSnapshot.ost * factor, vnSnapshot.ost);
        }
        if (elements.voicePlayer && vnSnapshot.voice !== null) {
            elements.voicePlayer.volume = clamp01(vnSnapshot.voice * factor, vnSnapshot.voice);
        }
        return { ...vnSnapshot, factor };
    };

    const restoreVN = () => {
        if (!vnSnapshot) return false;
        if (elements.audioPlayer && vnSnapshot.ost !== null) elements.audioPlayer.volume = vnSnapshot.ost;
        if (elements.voicePlayer && vnSnapshot.voice !== null) elements.voicePlayer.volume = vnSnapshot.voice;
        vnSnapshot = null;
        return true;
    };

    const snapshotPlayer = (player) => {
        if (!player) return null;
        return {
            src: player.src || '',
            currentTime: Number.isFinite(player.currentTime) ? player.currentTime : 0,
            volume: Number.isFinite(player.volume) ? player.volume : null,
            muted: !!player.muted,
            loop: !!player.loop,
            wasPlaying: !player.paused && !!player.src
        };
    };

    const restorePlayer = (player, snapshot) => {
        if (!player || !snapshot) return;
        try {
            if (snapshot.src && player.src !== snapshot.src) {
                player.src = snapshot.src;
            }
            player.loop = !!snapshot.loop;
            player.muted = !!snapshot.muted;
            if (snapshot.volume !== null) player.volume = clamp01(snapshot.volume, snapshot.volume);
            if (Number.isFinite(snapshot.currentTime) && snapshot.currentTime > 0) {
                player.currentTime = snapshot.currentTime;
            }
            if (snapshot.wasPlaying && snapshot.src) {
                player.play().catch((error) => {
                    debugError('[Intercept] bridge.audio.resumeVN failed to resume player', error);
                });
            }
        } catch (error) {
            debugError('[Intercept] bridge.audio.resumeVN restore failed', error);
        }
    };

    const suspendVN = (options = {}) => {
        if (!vnPlaybackSnapshot) {
            vnPlaybackSnapshot = {
                ost: snapshotPlayer(elements.audioPlayer),
                voice: snapshotPlayer(elements.voicePlayer),
                currentTalkingCharacter: state.currentTalkingCharacter || null
            };
        }

        const shouldPause = options.pause !== false;
        const shouldMute = options.mute === true;
        for (const player of [elements.audioPlayer, elements.voicePlayer]) {
            if (!player) continue;
            if (shouldMute) player.volume = 0;
            if (shouldPause && !player.paused) {
                try { player.pause(); } catch (_) { }
            }
        }
        state.isAudioPlaying = false;
        if (shouldPause) state.currentTalkingCharacter = null;
        return { ...vnPlaybackSnapshot };
    };

    const resumeVN = () => {
        if (!vnPlaybackSnapshot) return false;
        const snapshot = vnPlaybackSnapshot;
        vnPlaybackSnapshot = null;
        restorePlayer(elements.audioPlayer, snapshot.ost);
        restorePlayer(elements.voicePlayer, snapshot.voice);
        if (snapshot.voice?.wasPlaying) {
            state.currentTalkingCharacter = snapshot.currentTalkingCharacter || null;
            state.isAudioPlaying = true;
        }
        return true;
    };

    lifecycle.onDispose(() => {
        stop();
        resumeVN();
        restoreVN();
    });

    return {
        getVolume: getBridgeAudioVolume,
        createManagedAudio,
        play,
        loop: (path, options = {}) => play(path, { ...options, loop: true }),
        stop,
        duckVN,
        restoreVN,
        suspendVN,
        resumeVN
    };
}

function createSurfaceBridge({ lifecycle, renderer, hostEl = null, pixiLayer = null }) {
    let pointerSnapshot = null;
    let layerPointerSnapshot = null;

    const getRoot = () => hostEl || elements.pluginOverlay || elements.gameContainer || document.body;
    const getLayer = () => pixiLayer || null;

    const getSize = () => {
        const root = getRoot();
        const rect = root?.getBoundingClientRect?.() || elements.gameContainer?.getBoundingClientRect?.() || null;
        return {
            renderer,
            cssWidth: rect ? rect.width : window.innerWidth,
            cssHeight: rect ? rect.height : window.innerHeight,
            logicalWidth: pixiApp.LOGICAL_WIDTH,
            logicalHeight: pixiApp.LOGICAL_HEIGHT,
            devicePixelRatio: window.devicePixelRatio || 1,
            rect: rect
                ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
                : null
        };
    };

    const onResize = (handler, options = {}) => {
        if (typeof handler !== 'function') return () => {};
        const root = getRoot();
        const callback = () => handler(getSize());
        let observer = null;
        if (typeof ResizeObserver === 'function' && root) {
            observer = new ResizeObserver(callback);
            observer.observe(root);
        }
        const offWindow = lifecycle.onWindow('resize', callback);
        if (options.immediate !== false) callback();
        const off = () => {
            try { observer?.disconnect?.(); } catch (_) { }
            offWindow();
        };
        lifecycle.onDispose(off);
        return off;
    };

    const setPointerMode = (mode = 'capture') => {
        const normalized = String(mode || 'capture').toLowerCase();
        const root = getRoot();
        const layer = getLayer();
        if (root && !pointerSnapshot) {
            pointerSnapshot = { pointerEvents: root.style.pointerEvents };
            lifecycle.onDispose(() => {
                if (root) root.style.pointerEvents = pointerSnapshot.pointerEvents || '';
            });
        }
        if (root) {
            root.style.pointerEvents = normalized === 'pass-through' ? 'none' : 'auto';
        }
        if (layer && !layerPointerSnapshot) {
            layerPointerSnapshot = {
                eventMode: layer.eventMode,
                interactiveChildren: layer.interactiveChildren
            };
            lifecycle.onDispose(() => {
                layer.eventMode = layerPointerSnapshot.eventMode;
                layer.interactiveChildren = layerPointerSnapshot.interactiveChildren;
            });
        }
        if (layer) {
            layer.eventMode = normalized === 'pass-through' ? 'none' : 'static';
            layer.interactiveChildren = normalized !== 'pass-through';
        }
        return normalized;
    };

    return {
        type: renderer === 'pixi' ? 'pixi' : 'dom',
        getRoot,
        getLayer,
        getSize,
        onResize,
        setPointerMode,
        clear: () => {
            const layer = getLayer();
            if (layer?.removeChildren) layer.removeChildren();
            const root = getRoot();
            if (root && root !== document.body && root !== elements.gameContainer) root.innerHTML = '';
        }
    };
}

function createPlayerBridge({ lifecycle, runId }) {
    const uiLocks = new Map();
    const elementSnapshots = new Map();
    const spriteLocks = new Set();
    const busyLocks = new Map();
    const directLocks = {};
    let busyEl = null;

    const targetElements = {
        dialogue: () => elements.dialogueContainer,
        controls: () => elements.controls,
        input: () => elements.userInputContainer,
        dialogueIndex: () => elements.dialogueIndexIndicator,
        progress: () => document.getElementById('progress-container'),
        notifications: () => document.getElementById('status-notification-container'),
        musicPlayer: () => elements.miniMusicPlayer,
        settingsButton: () => elements.vnSettingsBtn,
        toggleButton: () => elements.toggleControlsBtn
    };

    const normalizeMode = (value) => {
        const raw = String(value).toLowerCase();
        if (value === true || raw === 'hidden' || raw === 'hide' || raw === 'off') return 'hidden';
        if (value === false || raw === 'visible' || raw === 'show' || raw === 'on') return 'visible';
        return raw === 'disabled' ? 'disabled' : 'hidden';
    };

    const snapshotElement = (name, el) => {
        if (!el || elementSnapshots.has(name)) return;
        elementSnapshots.set(name, {
            hidden: el.classList.contains('hidden'),
            pointerEvents: el.style.pointerEvents || '',
            opacity: el.style.opacity || '',
            disabled: typeof el.disabled === 'boolean' ? el.disabled : null
        });
    };

    const applyTarget = (name) => {
        const el = targetElements[name]?.();
        if (!el) return;
        snapshotElement(name, el);
        const activeEntries = Array.from(uiLocks.values())
            .filter((entry) => Object.prototype.hasOwnProperty.call(entry.targets, name));
        if (activeEntries.length === 0) {
            const snapshot = elementSnapshots.get(name);
            if (snapshot) {
                el.classList.toggle('hidden', !!snapshot.hidden);
                el.style.pointerEvents = snapshot.pointerEvents;
                el.style.opacity = snapshot.opacity;
                if (snapshot.disabled !== null && typeof el.disabled === 'boolean') el.disabled = snapshot.disabled;
            }
            return;
        }
        const mode = activeEntries[activeEntries.length - 1].targets[name];
        if (mode === 'visible') {
            el.classList.remove('hidden');
            el.style.pointerEvents = '';
            el.style.opacity = '';
            if (typeof el.disabled === 'boolean') el.disabled = false;
            return;
        }
        if (mode === 'disabled') {
            el.classList.remove('hidden');
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.55';
            if (typeof el.disabled === 'boolean') el.disabled = true;
            return;
        }
        el.classList.add('hidden');
    };

    const ensureBusyElement = () => {
        if (busyEl && busyEl.isConnected) return busyEl;
        busyEl = document.createElement('div');
        busyEl.className = 'plugin-intercept-bridge-busy';
        busyEl.style.position = 'absolute';
        busyEl.style.top = '18px';
        busyEl.style.left = '50%';
        busyEl.style.transform = 'translateX(-50%)';
        busyEl.style.zIndex = '999999';
        busyEl.style.padding = '10px 14px';
        busyEl.style.borderRadius = '999px';
        busyEl.style.background = 'rgba(0, 0, 0, 0.72)';
        busyEl.style.color = '#fff';
        busyEl.style.font = '600 13px sans-serif';
        busyEl.style.pointerEvents = 'none';
        busyEl.style.backdropFilter = 'blur(8px)';
        (elements.gameContainer || document.body).appendChild(busyEl);
        return busyEl;
    };

    const applyBusy = () => {
        const labels = Array.from(busyLocks.values()).filter(Boolean);
        if (labels.length === 0) {
            if (busyEl?.parentNode) busyEl.parentNode.removeChild(busyEl);
            busyEl = null;
            document.body.removeAttribute('data-plugin-intercept-busy');
            return;
        }
        const label = labels[labels.length - 1];
        const el = ensureBusyElement();
        el.textContent = label === true ? 'Working...' : String(label);
        document.body.setAttribute('data-plugin-intercept-busy', el.textContent);
    };

    const releaseLock = (lockId) => {
        const entry = uiLocks.get(lockId);
        if (entry) {
            uiLocks.delete(lockId);
            for (const name of Object.keys(entry.targets)) applyTarget(name);
        }
        if (spriteLocks.has(lockId)) {
            setMainSpriteHideLock(lockId, false);
            spriteLocks.delete(lockId);
        }
        if (busyLocks.has(lockId)) {
            busyLocks.delete(lockId);
            applyBusy();
        }
    };

    const lock = (spec = {}) => {
        const lockId = `${runId}_ui_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const targets = {};
        for (const name of Object.keys(targetElements)) {
            if (Object.prototype.hasOwnProperty.call(spec, name)) {
                targets[name] = normalizeMode(spec[name]);
            }
        }
        uiLocks.set(lockId, { targets });
        for (const name of Object.keys(targets)) applyTarget(name);

        if (Object.prototype.hasOwnProperty.call(spec, 'sprites')) {
            const mode = normalizeMode(spec.sprites);
            if (mode === 'hidden' || mode === 'disabled') {
                spriteLocks.add(lockId);
                setMainSpriteHideLock(lockId, true);
            }
        }

        if (Object.prototype.hasOwnProperty.call(spec, 'busy') && spec.busy !== false && spec.busy !== null) {
            busyLocks.set(lockId, spec.busy === true ? 'Working...' : String(spec.busy));
            applyBusy();
        }

        let released = false;
        const handle = {
            id: lockId,
            release: () => {
                if (released) return;
                released = true;
                releaseLock(lockId);
            }
        };
        lifecycle.onDispose(handle.release);
        return handle;
    };

    const setDirectLock = (key, spec) => {
        if (directLocks[key]) directLocks[key].release();
        directLocks[key] = lock(spec);
        return directLocks[key];
    };

    const getControlsVisible = () => {
        return !!state?.vnSettings?.interface?.show_controls;
    };

    const triggerImmersiveToggle = () => {
        const toggleBtn = elements.toggleControlsBtn;
        if (!toggleBtn || typeof toggleBtn.click !== 'function') return false;
        try {
            toggleBtn.click();
            return true;
        } catch (_) {
            return false;
        }
    };

    const setImmersiveMode = (enabled = true) => {
        const immersiveEnabled = !!enabled;
        const controlsVisible = getControlsVisible();
        const shouldShowControls = !immersiveEnabled;
        if (controlsVisible === shouldShowControls) return true;
        return triggerImmersiveToggle();
    };

    const restore = () => {
        for (const lockId of Array.from(uiLocks.keys())) releaseLock(lockId);
        for (const lockId of Array.from(spriteLocks)) releaseLock(lockId);
        for (const lockId of Array.from(busyLocks.keys())) releaseLock(lockId);
        Object.keys(directLocks).forEach((key) => { directLocks[key] = null; });
    };

    lifecycle.onDispose(restore);

    const getScene = (index = state.currentIndex) => {
        const scene = state.currentVN?.sequence?.[index] || null;
        return safeClone(scene, scene);
    };

    const getActiveCharacters = () => {
        const pixiEntries = typeof pixiSpriteManager.getManagedSpriteEntries === 'function'
            ? pixiSpriteManager.getManagedSpriteEntries()
            : [];
        return pixiEntries.map(({ charName, charObj, isPluginActor }) => ({
            name: charName,
            isPluginActor: !!isPluginActor,
            visible: !!charObj?.container?.visible,
            alpha: Number.isFinite(charObj?.container?.alpha) ? charObj.container.alpha : null,
            x: Number.isFinite(charObj?.container?.x) ? charObj.container.x : null,
            y: Number.isFinite(charObj?.container?.y) ? charObj.container.y : null,
            spritePath: charObj?.spritePath || null
        }));
    };

    return {
        getState: () => ({
            currentIndex: state.currentIndex,
            sequenceLength: Array.isArray(state.currentVN?.sequence) ? state.currentVN.sequence.length : 0,
            turnNumber: state.currentVN?.turnNumber ?? state.interceptRuntime?.currentTurnNumber ?? null,
            projectName: state.currentVN?.projectName || state.projectName || null,
            sceneMode: state.currentVN?.sceneMode || null,
            playerCharacterName: state.playerCharacterName || '',
            currentBackground: state.currentBackground || '',
            currentCg: state.currentCg || '',
            currentAudio: state.currentAudio || null,
            currentOst: state.currentOst || null,
            autoPlay: !!state.autoPlay,
            isGenerationPhase: !!state.isGenerationPhase,
            isGameOver: !!state.isGameOver,
            navigation: safeClone(state.navigation, {}),
            settings: safeClone(state.vnSettings, {})
        }),
        getScene,
        getTurn: () => safeClone(state.currentVN, state.currentVN),
        getSettings: () => safeClone(state.vnSettings, {}),
        getActiveCharacters,
        getBackground: () => ({
            background: state.currentBackground || '',
            cg: state.currentCg || '',
            initialBackground: state.currentVN?.initialBackground || null
        }),
        isAutoplayEnabled: () => !!state.autoPlay,
        canNavigateBack: () => state.currentIndex > 0 || !!state.navigation?.prev,
        canNavigateForward: () => {
            const length = Array.isArray(state.currentVN?.sequence) ? state.currentVN.sequence.length : 0;
            return state.currentIndex < length - 1 || !!state.navigation?.next;
        },
        ui: {
            lock,
            restore,
            triggerImmersive: () => triggerImmersiveToggle(),
            setImmersive: (enabled = true) => setImmersiveMode(enabled),
            hideDialogue: () => setDirectLock('dialogue', { dialogue: 'hidden' }),
            showDialogue: () => setDirectLock('dialogue', { dialogue: 'visible' }),
            hideControls: () => setDirectLock('controls', { controls: 'hidden' }),
            showControls: () => setDirectLock('controls', { controls: 'visible' }),
            hideInput: () => setDirectLock('input', { input: 'hidden' }),
            showInput: () => setDirectLock('input', { input: 'visible' }),
            hideSprites: () => setDirectLock('sprites', { sprites: 'hidden' }),
            showSprites: () => {
                if (directLocks.sprites) directLocks.sprites.release();
                directLocks.sprites = null;
            },
            setBusy: (label = 'Working...') => setDirectLock('busy', { busy: label }),
            clearBusy: () => {
                if (directLocks.busy) directLocks.busy.release();
                directLocks.busy = null;
            }
        }
    };
}

function createPixiBridge({ lifecycle, assets, surface }) {
    let runtimePausedByBridge = false;

    const pluginRuntime = () => window.VN?.pixiPlugins || null;
    const getLayer = (name = null) => {
        if (!name) return surface.getLayer() || null;
        const key = String(name).trim();
        if (key === 'takeover') return surface.getLayer() || null;
        if (key === 'stage') return pixiApp.app?.stage || null;
        if (key === 'viewport') return pixiApp.viewport || null;
        if (key === 'world') return pixiApp.world || null;
        return pixiApp.layers?.[key] || null;
    };

    const destroy = (displayObject, options = {}) => {
        if (!displayObject) return false;
        try {
            if (displayObject.parent) displayObject.parent.removeChild(displayObject);
            if (options.destroy !== false && typeof displayObject.destroy === 'function') {
                displayObject.destroy({
                    children: options.children !== false,
                    texture: !!options.texture,
                    textureSource: !!options.textureSource,
                    baseTexture: !!options.baseTexture
                });
            }
            return true;
        } catch (error) {
            debugError('[Intercept] bridge.pixi.destroy failed', error);
            return false;
        }
    };

    const add = (displayObject, options = {}) => {
        if (!displayObject) return null;
        const layer = options.layer
            ? getLayer(options.layer)
            : (surface.getLayer() || pixiApp.layers?.fx || pixiApp.app?.stage || null);
        if (!layer?.addChild) return null;
        if (Number.isFinite(Number(options.zIndex))) {
            displayObject.zIndex = Number(options.zIndex);
            layer.sortableChildren = true;
        }
        if (options.label && 'label' in displayObject) displayObject.label = String(options.label);
        layer.addChild(displayObject);
        if (options.destroyOnDispose !== false) {
            lifecycle.onDispose(() => destroy(displayObject, {
                destroy: options.destroy !== false,
                children: options.children !== false,
                texture: !!options.texture,
                textureSource: !!options.textureSource,
                baseTexture: !!options.baseTexture
            }));
        } else {
            lifecycle.onDispose(() => {
                try { if (displayObject.parent) displayObject.parent.removeChild(displayObject); } catch (_) { }
            });
        }
        return displayObject;
    };

    const onTick = (fn, priority = 0) => {
        if (typeof fn !== 'function' || !pixiApp.hooks) return () => {};
        pixiApp.hooks.addPreRender(fn, Number(priority) || 0);
        const off = () => pixiApp.hooks.remove(fn);
        lifecycle.onDispose(off);
        return off;
    };

    const pauseVnRuntime = () => {
        if (runtimePausedByBridge) return;
        runtimePausedByBridge = true;
        try { pluginRuntime()?.pauseAll?.(); } catch (_) { }
        try { window.gsap?.globalTimeline?.pause?.(); } catch (_) { }
        lifecycle.onDispose(() => {
            if (!runtimePausedByBridge) return;
            runtimePausedByBridge = false;
            if (surface.type === 'pixi' && document.body.classList.contains('pixi-takeover-active')) {
                return;
            }
            try { pluginRuntime()?.resumeAll?.(); } catch (_) { }
            try { window.gsap?.globalTimeline?.resume?.(); } catch (_) { }
        });
    };

    const resumeVnRuntime = () => {
        if (!runtimePausedByBridge) return;
        runtimePausedByBridge = false;
        try { pluginRuntime()?.resumeAll?.(); } catch (_) { }
        try { window.gsap?.globalTimeline?.resume?.(); } catch (_) { }
    };

    return {
        getApp: () => pixiApp,
        getLayer,
        getLogicalSize: () => ({ width: pixiApp.LOGICAL_WIDTH, height: pixiApp.LOGICAL_HEIGHT }),
        toLogicalPoint: (eventOrPoint) => {
            const canvas = pixiApp.app?.canvas || document.getElementById('vn-canvas');
            const rect = canvas?.getBoundingClientRect?.();
            const clientX = Number(eventOrPoint?.clientX ?? eventOrPoint?.x ?? 0);
            const clientY = Number(eventOrPoint?.clientY ?? eventOrPoint?.y ?? 0);
            if (!rect || !window.PIXI?.Point) return { x: clientX, y: clientY };
            const screenPoint = new window.PIXI.Point(clientX - rect.left, clientY - rect.top);
            if (pixiApp.viewport?.toLocal) {
                const logical = pixiApp.viewport.toLocal(screenPoint);
                return { x: logical.x, y: logical.y };
            }
            return {
                x: (screenPoint.x / Math.max(1, rect.width)) * pixiApp.LOGICAL_WIDTH,
                y: (screenPoint.y / Math.max(1, rect.height)) * pixiApp.LOGICAL_HEIGHT
            };
        },
        onTick,
        loadTexture: (path, options = {}) => assets.loadTexture(path, options),
        add,
        destroy,
        pauseVnRuntime,
        resumeVnRuntime,
        getRuntime: pluginRuntime
    };
}

function cleanupActiveOverlay({ reason = 'general' } = {}) {
    logInterceptFlow('cleanup-active:start', {
        reason,
        hasActiveOverlay: !!orchestrator.activeOverlay,
        nonBlockingCount: orchestrator.nonBlockingOverlays instanceof Map
            ? orchestrator.nonBlockingOverlays.size
            : 0
    });
    const preservePredicate = reason === 'scene_entry'
        ? (entry) => entry?.descriptor?.preserveOnDialogueEnter === true
        : reason === 'before_submit'
            ? (entry) => {
                const descriptor = entry?.descriptor || {};
                const checkpoint = String(descriptor.checkpoint || '').trim().toLowerCase();
                // Sticky input overlays are owned by the current input checkpoint.
                // Generation start should not tear them down before a result exists.
                const stickyInputOverlay = checkpoint === 'during_user_input'
                    && descriptor.autoDismiss === false;
                return descriptor.preserveOnBeforeSubmit === true || stickyInputOverlay;
            }
        : null;
    cleanupNonBlockingOverlays({ preservePredicate });

    if (!orchestrator.activeOverlay) {
        endPixiTakeover({ reason: 'overlay_cleanup' });
        logInterceptFlow('cleanup-active:end-no-overlay', {
            reason,
            nonBlockingCount: orchestrator.nonBlockingOverlays instanceof Map
                ? orchestrator.nonBlockingOverlays.size
                : 0
        });
        return;
    }
    const runId = orchestrator.activeOverlay.runId || null;
    logInterceptFlow('cleanup-active:run', { reason, runId });
    try {
        if (typeof orchestrator.activeOverlay.cleanup === 'function') {
            orchestrator.activeOverlay.cleanup();
        }
    } catch (error) {
        debugError('[Intercept] Failed to cleanup active overlay', error);
    } finally {
        if (runId) setMainSpriteHideLock(runId, false);
        orchestrator.activeOverlay = null;
        endPixiTakeover({ reason: 'overlay_cleanup' });
        logInterceptFlow('cleanup-active:end', {
            reason,
            runId,
            nonBlockingCount: orchestrator.nonBlockingOverlays instanceof Map
                ? orchestrator.nonBlockingOverlays.size
                : 0
        });
    }
}

function buildBridge({
    descriptor,
    runId,
    checkpoint,
    checkpointContext,
    socket,
    finalize,
    nonBlocking = false,
    takeover = null,
    renderer = null,
    hostEl = null,
    pixiLayer = null
}) {
    const pluginStore = getPluginStateStore(descriptor.pluginId);
    const lifecycleScope = createLifecycleScope({ runId, descriptor });
    const resolvedRenderer = (renderer || getDescriptorRenderer(descriptor)).toString().toLowerCase();
    const assetsBridge = createAssetBridge({ descriptor });
    const surfaceBridge = createSurfaceBridge({
        lifecycle: lifecycleScope.lifecycle,
        renderer: resolvedRenderer,
        hostEl,
        pixiLayer
    });
    const logBridge = createBridgeLogger({ descriptor, runId });
    const playerBridge = createPlayerBridge({ lifecycle: lifecycleScope.lifecycle, runId });
    const pixiBridge = createPixiBridge({
        lifecycle: lifecycleScope.lifecycle,
        assets: assetsBridge,
        surface: surfaceBridge
    });
    const audioBridge = createAudioBridge({
        lifecycle: lifecycleScope.lifecycle,
        assets: assetsBridge
    });
    const storageBridge = createStorageBridge({ descriptor });
    const contextSnapshot = {
        runId,
        checkpoint,
        dialogueIndex: checkpointContext.dialogueIndex ?? null,
        sceneIndex: checkpointContext.sceneIndex ?? null,
        isVirtual: !!checkpointContext.scene?.isVirtual,
        turnNumber: state.currentVN?.turnNumber ?? state.interceptRuntime.currentTurnNumber ?? null,
        descriptor
    };

    const safeFinalize = (result) => {
        if (!nonBlocking) {
            return finalize(result);
        }
        return null;
    };

    const takeoverBridge = (takeover && typeof takeover === 'object')
        ? takeover
        : {
            resolve: (data = {}) => safeFinalize({ action: data?.cancel ? 'cancel' : 'continue', data }),
            finish: (data = {}) => safeFinalize({ action: data?.cancel ? 'cancel' : 'continue', data }),
            abort: (reason = 'aborted', data = {}) => safeFinalize({
                action: 'cancel',
                reason,
                data: { ...(data || {}), reason }
            }),
            skip: (reason = 'skipped', data = {}) => safeFinalize({
                action: 'cancel',
                reason,
                data: { ...(data || {}), reason }
            }),
            isActive: () => false,
            getContext: () => ({ ...contextSnapshot, active: false }),
            getLayer: () => null,
            clearLayer: () => {}
        };

    const actorsBridge = {
        spawn: async (options = {}) => {
            return spawnSessionActor(runId, options);
        },
        update: async (actorId, patch = {}) => {
            return updateSessionActor(runId, actorId, patch);
        },
        setShadow: async (actorId, shadow = null) => {
            return updateSessionActor(runId, actorId, { shadow });
        },
        enableShadow: async (actorId, options = {}) => {
            return updateSessionActor(runId, actorId, {
                shadow: { ...(options || {}), enabled: true }
            });
        },
        disableShadow: async (actorId) => {
            return updateSessionActor(runId, actorId, { shadow: { enabled: false } });
        },
        remove: (actorId, reason = 'actor-remove') => {
            return removeSessionActor(runId, actorId, reason);
        },
        clear: (reason = 'actor-clear') => {
            clearSessionActors(runId, reason);
        },
        end: (reason = 'actor-end') => {
            endSessionActors(runId, reason);
        },
        hideNativeSprites: (enabled = true) => {
            setMainSpriteHideLock(runId, !!enabled);
        },
        list: () => listSessionActorKeys(runId)
    };

    const backgroundBridge = {
        set: (options = {}) => setSessionBackground(runId, options),
        restore: (options = {}) => restoreSessionBackground(runId, options),
        end: (reason = 'background-end', options = {}) => {
            return endSessionBackground(runId, reason, options);
        },
        get: () => getSessionBackgroundState(runId)
    };

    const bridge = {
        meta: {
            apiVersion: 2,
            renderer: resolvedRenderer,
            runId,
            pluginId: descriptor.pluginId || null,
            interceptId: descriptor.interceptId || descriptor.id || null,
            checkpoint
        },

        // Legacy shorthand compatibility with existing intercept UI snippets
        resolve: (data = {}) => safeFinalize({ action: data?.cancel ? 'cancel' : 'continue', data }),
        resolveProjectPath,
        resolvePluginPath,
        lifecycle: lifecycleScope.lifecycle,
        assets: assetsBridge,
        surface: surfaceBridge,
        player: playerBridge,
        pixi: pixiBridge,
        audio: audioBridge,
        storage: storageBridge,
        log: logBridge,
        intercept: {
            resolve: (data = {}) => safeFinalize({ action: data?.cancel ? 'cancel' : 'continue', data }),
            reject: (reason = 'rejected') => safeFinalize({ action: 'cancel', reason, data: { reason } }),
            defer: (data = {}) => safeFinalize({ action: 'continue', data: { ...(data || {}), deferred: true } }),
            skip: (reason = 'skipped') => safeFinalize({ action: 'cancel', reason, data: { reason } }),
            getContext: () => ({ ...contextSnapshot })
        },
        nav: {
            forward: async (steps = 1) => {
                try {
                    await safeFinalize({ action: 'navigate', direction: 'forward', steps });
                    if (typeof orchestrator.bridgeHandlers.navigateForward === 'function') {
                        await orchestrator.bridgeHandlers.navigateForward(steps);
                    }
                } catch (error) {
                    debugError('[Intercept] nav.forward failed', error);
                }
            },
            back: async (steps = 1) => {
                try {
                    await safeFinalize({ action: 'navigate', direction: 'back', steps });
                    if (typeof orchestrator.bridgeHandlers.navigateBack === 'function') {
                        await orchestrator.bridgeHandlers.navigateBack(steps);
                    }
                } catch (error) {
                    debugError('[Intercept] nav.back failed', error);
                }
            },
            goTo: async (index) => {
                try {
                    await safeFinalize({ action: 'navigate', direction: 'goto', index });
                    if (typeof orchestrator.bridgeHandlers.navigateTo === 'function') {
                        await orchestrator.bridgeHandlers.navigateTo(index);
                    }
                } catch (error) {
                    debugError('[Intercept] nav.goTo failed', error);
                }
            }
        },
        input: {
            getText: () => elements.userMessage?.value || '',
            setText: (text) => {
                if (elements.userMessage) elements.userMessage.value = text ?? '';
            },
            submitAndGenerate: async (options = {}) => {
                try {
                    await safeFinalize({ action: 'submit', data: options });
                    if (typeof orchestrator.bridgeHandlers.submitAndGenerate === 'function') {
                        await orchestrator.bridgeHandlers.submitAndGenerate({
                            ...options,
                            skipBeforeSubmit: true
                        });
                    }
                } catch (error) {
                    debugError('[Intercept] input.submitAndGenerate failed', error);
                }
            },
            cancelSubmit: (reason = 'cancelled') => {
                safeFinalize({ action: 'cancel', reason, data: { reason } });
            }
        },
        takeover: takeoverBridge,
        actors: actorsBridge,
        background: backgroundBridge,
        context: {
            get: () => ({ ...contextSnapshot })
        },
        state: {
            get: (key) => pluginStore[key],
            set: (key, value) => {
                pluginStore[key] = value;
                return value;
            },
            clear: (key = null) => {
                if (!key) {
                    Object.keys(pluginStore).forEach((k) => delete pluginStore[k]);
                    return;
                }
                delete pluginStore[key];
            }
        },
        socket: {
            emit: (event, payload) => socket?.emit(event, payload),
            request: (event, payload, timeout = 10000) => {
                if (typeof socket?.emitReceive === 'function') {
                    return socket.emitReceive(event, payload, timeout);
                }
                return new Promise((resolve) => {
                    let responded = false;
                    const timer = lifecycleScope.lifecycle.setTimeout(() => {
                        if (responded) return;
                        responded = true;
                        resolve({ success: false, error: 'timeout' });
                    }, timeout);
                    socket?.emit(event, payload);
                    socket?.once?.(`${event}-response`, (result) => {
                        if (responded) return;
                        responded = true;
                        lifecycleScope.lifecycle.clearTimeout(timer);
                        resolve(result);
                    });
                });
            },
            on: (event, handler) => {
                if (!socket || typeof socket.on !== 'function' || typeof handler !== 'function') return () => {};
                socket.on(event, handler);
                const off = () => {
                    try { socket.off?.(event, handler); } catch (_) { }
                };
                lifecycleScope.lifecycle.onDispose(off);
                return off;
            },
            once: (event, handler) => {
                if (!socket || typeof socket.once !== 'function' || typeof handler !== 'function') return () => {};
                socket.once(event, handler);
                const off = () => {
                    try { socket.off?.(event, handler); } catch (_) { }
                };
                lifecycleScope.lifecycle.onDispose(off);
                return off;
            },
            off: (event, handler) => {
                try { socket?.off?.(event, handler); } catch (_) { }
            }
        }
    };

    return attachBridgeInternals(bridge, lifecycleScope);
}

async function requestUiPayload(descriptor, checkpoint, checkpointContext = {}) {
    if (descriptor.inlineUi && typeof descriptor.inlineUi === 'object') {
        return descriptor.inlineUi;
    }

    if (!orchestrator.socket || typeof orchestrator.socket.emitReceive !== 'function') {
        return null;
    }

    if (!descriptor.pluginId) {
        return null;
    }

    const runId = `gui_intercept_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const interceptId =
        descriptor.interceptId ||
        descriptor.id ||
        (typeof descriptor.handlerRef === 'string' ? descriptor.handlerRef.split('.').pop() : null);

    try {
        const response = await orchestrator.socket.emitReceive('request-gui-intercept-ui', {
            interceptRunId: runId,
            pluginId: descriptor.pluginId,
            interceptId,
            descriptor,
            checkpoint,
            checkpointContext
        }, 90000);

        logDescriptorDebug(descriptor, 'ui-payload-response', {
            interceptId,
            success: !!response?.success,
            hasUi: !!response?.ui,
            renderer: response?.ui?.renderer || null,
            hasJs: typeof response?.ui?.js === 'string' && response.ui.js.length > 0,
            hasPayload: !!response?.ui?.payload,
            error: response?.error || null
        });

        if (response && response.success) {
            return response.ui || null;
        }
    } catch (error) {
        debugError('[Intercept] Failed requesting GUI intercept payload', error);
    }

    return null;
}

function executeNonBlockingPayload(descriptor, uiPayload, checkpoint, checkpointContext = {}) {
    if (!uiPayload || typeof uiPayload !== 'object') return;

    const runId = `gui_intercept_nb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const descriptorKey = getNonBlockingDescriptorKey(descriptor, checkpoint);
    const socket = orchestrator.socket;
    const runtimeDescriptor = Object.prototype.hasOwnProperty.call(uiPayload, 'payload')
        ? { ...descriptor, payload: uiPayload.payload }
        : descriptor;

    const disableAutoDismiss =
        runtimeDescriptor?.autoDismiss === false
        || uiPayload?.autoDismiss === false;
    const durationMs = disableAutoDismiss
        ? null
        : (
            Number.isFinite(runtimeDescriptor.durationMs)
                ? Math.max(0, runtimeDescriptor.durationMs)
                : 3500
        );

    let styleEl = null;
    let hostEl = null;
    let timeoutHandle = null;
    let finalized = false;
    let bridge = null;
    const hideMainSpritesWhileVisible = descriptorWantsMainSpriteHide(descriptor, uiPayload);
    const mountRoot = elements?.gameContainer || document.body;
    logInterceptFlow('nonblocking:mount-start', {
        runId,
        descriptorKey,
        pluginId: runtimeDescriptor?.pluginId || descriptor?.pluginId || null,
        interceptId: runtimeDescriptor?.interceptId || runtimeDescriptor?.id || descriptor?.interceptId || descriptor?.id || null,
        checkpoint,
        autoDismissDisabled: disableAutoDismiss,
        durationMs
    });

    const finalize = () => {
        if (finalized) return;
        finalized = true;
        logInterceptFlow('nonblocking:finalize', {
            runId,
            descriptorKey,
            hadHost: !!hostEl,
            hadStyle: !!styleEl,
            hadJs: !!uiPayload?.js
        });
        disposeBridge(bridge, 'nonblocking-finalize', { action: 'continue' });
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
        if (hostEl?.parentNode) hostEl.parentNode.removeChild(hostEl);
        if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
        if (hideMainSpritesWhileVisible) {
            setMainSpriteHideLock(runId, false);
        }
        endSessionBackground(runId, 'nonblocking-finalize', { restore: true, instant: false });
        endSessionActors(runId, 'nonblocking-finalize');
        orchestrator.nonBlockingOverlays.delete(runId);
        logInterceptFlow('nonblocking:finalize-done', {
            runId,
            descriptorKey,
            remainingEntries: orchestrator.nonBlockingOverlays.size
        });
    };

    // Ensure we only keep one live non-blocking instance per descriptor key.
    cleanupNonBlockingOverlays({ descriptorKey });

    if (uiPayload.css) {
        styleEl = document.createElement('style');
        styleEl.id = `plugin-intercept-nb-css-${runId}`;
        styleEl.textContent = uiPayload.css;
        document.head.appendChild(styleEl);
    }

    if (uiPayload.html) {
        hostEl = document.createElement('div');
        hostEl.id = `plugin-intercept-nb-host-${runId}`;
        hostEl.className = 'plugin-intercept-nonblocking-host';
        hostEl.innerHTML = uiPayload.html;
        mountRoot.appendChild(hostEl);

        // When mounted inside the VN canvas, keep the host constrained to it.
        if (mountRoot !== document.body) {
            hostEl.style.position = 'absolute';
            hostEl.style.inset = '0';
        }
    }

    bridge = buildBridge({
        descriptor: runtimeDescriptor,
        runId,
        checkpoint,
        checkpointContext,
        socket,
        finalize: () => {},
        nonBlocking: true,
        renderer: getDescriptorRenderer(descriptor, uiPayload),
        hostEl
    });

    if (uiPayload.js) {
        try {
            const fn = new Function('bridge', 'socket', 'context', uiPayload.js);
            fn(bridge, socket, {
                descriptor: runtimeDescriptor,
                uiPayload,
                payload: uiPayload.payload,
                checkpoint,
                checkpointContext,
                runId,
                PIXI: window.PIXI,
                pixiApp
            });
        } catch (error) {
            debugError('[Intercept] Non-blocking intercept JS failed', error);
            finalize();
            return;
        }
    }

    if (hostEl || styleEl || uiPayload.js) {
        if (hideMainSpritesWhileVisible) {
            setMainSpriteHideLock(runId, true);
        }
        orchestrator.nonBlockingOverlays.set(runId, {
            descriptorKey,
            descriptor: runtimeDescriptor,
            cleanup: finalize
        });
        if (Number.isFinite(durationMs)) {
            timeoutHandle = setTimeout(finalize, durationMs);
        }
        logInterceptFlow('nonblocking:mounted', {
            runId,
            descriptorKey,
            hasHost: !!hostEl,
            hasStyle: !!styleEl,
            hasJs: !!uiPayload?.js,
            nonBlockingCount: orchestrator.nonBlockingOverlays.size
        });
    }
}

async function runBlockingPixiDescriptor(descriptor, uiPayload, checkpoint, checkpointContext = {}) {
    logDescriptorDebug(descriptor, 'pixi-run-start', {
        interceptId: descriptor.interceptId || descriptor.id || null,
        checkpoint,
        dialogueIndex: checkpointContext?.dialogueIndex ?? null,
        hasUiPayload: !!uiPayload,
        hasJs: typeof uiPayload?.js === 'string' && uiPayload.js.length > 0,
        hasPayload: !!uiPayload?.payload
    });

    const timeoutMs = Number.isFinite(descriptor.timeoutMs)
        ? Math.max(1000, descriptor.timeoutMs)
        : 300000;
    const runId = `gui_intercept_pixi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const runtimeDescriptor = Object.prototype.hasOwnProperty.call(uiPayload || {}, 'payload')
        ? { ...descriptor, payload: uiPayload.payload }
        : descriptor;

    const takeoverStart = beginPixiTakeover({
        runId,
        descriptor: runtimeDescriptor,
        checkpoint,
        checkpointContext
    });

    if (!takeoverStart?.success) {
        return {
            action: 'error',
            error: takeoverStart?.error || 'pixi_takeover_failed'
        };
    }

    const socket = orchestrator.socket;
    const hideMainSpritesWhileVisible = descriptorWantsMainSpriteHide(descriptor, uiPayload);
    const transitionIn = descriptor?.transitionIn || uiPayload?.transitionIn || null;
    const transitionOut = descriptor?.transitionOut || uiPayload?.transitionOut || null;
    let releaseTransitionIn = () => {};
    let transitionInReleased = !transitionIn;
    const transitionInGate = transitionIn
        ? new Promise((resolve) => {
            releaseTransitionIn = () => {
                if (transitionInReleased) return;
                transitionInReleased = true;
                resolve();
            };
        })
        : Promise.resolve();

    return await new Promise((resolve) => {
        let finalized = false;
        let timeoutHandle = null;
        let bridge = null;

        const finalize = async (result = { action: 'continue' }) => {
            if (finalized) return;
            finalized = true;

            if (timeoutHandle) clearTimeout(timeoutHandle);
            timeoutHandle = null;
            disposeBridge(bridge, result?.reason || result?.action || 'blocking-pixi-finalize', result);

            if (transitionOut) {
                await playTransition(transitionOut, {
                    pixiLayer,
                    scope: 'intercept'
                }).catch(() => { });
            }

            if (hideMainSpritesWhileVisible) {
                setMainSpriteHideLock(runId, false);
            }
            endSessionBackground(runId, result?.reason || result?.action || 'blocking-pixi-finalize', { restore: true, instant: false });
            endSessionActors(runId, result?.reason || result?.action || 'blocking-pixi-finalize');

            endPixiTakeover({
                runId,
                reason: result?.reason || result?.action || 'completed'
            });
            orchestrator.activeOverlay = null;
            resolve(result);
        };
        const guardedFinalize = async (result = { action: 'continue' }) => {
            await transitionInGate;
            return finalize(result);
        };

        timeoutHandle = setTimeout(() => {
            finalize({ action: 'cancel', reason: 'timeout' });
        }, timeoutMs);

        orchestrator.activeOverlay = {
            runId,
            cleanup: () => finalize({ action: 'cancel', reason: 'overlay_cleanup' })
        };
        if (hideMainSpritesWhileVisible) {
            setMainSpriteHideLock(runId, true);
        }

        const takeoverBridge = createPixiTakeoverBridge({
            runId,
            descriptor: runtimeDescriptor,
            checkpoint,
            checkpointContext,
            finalize: guardedFinalize
        });

        const pixiLayer = getPixiTakeoverLayer(runId);
        bridge = buildBridge({
            descriptor: runtimeDescriptor,
            runId,
            checkpoint,
            checkpointContext,
            socket,
            finalize: guardedFinalize,
            takeover: takeoverBridge,
            renderer: 'pixi',
            pixiLayer
        });

        if (!uiPayload?.js) {
            debugError('[Intercept] PIXI takeover payload is missing JS', {
                pluginId: descriptor?.pluginId,
                interceptId: descriptor?.interceptId
            });
            finalize({
                action: 'error',
                error: 'missing_pixi_js_payload'
            });
            releaseTransitionIn();
            return;
        }

        try {
            const fn = new Function('bridge', 'socket', 'context', uiPayload.js);
            fn(bridge, socket, {
                descriptor: runtimeDescriptor,
                uiPayload,
                payload: uiPayload.payload,
                checkpoint,
                checkpointContext,
                runId,
                PIXI: window.PIXI,
                pixiApp,
                pixiLayer,
                takeover: takeoverStart.context || null,
                pluginRuntime: window.VN?.pixiPlugins || null
            });
            logDescriptorDebug(descriptor, 'pixi-js-executed', {
                interceptId: descriptor.interceptId || descriptor.id || null,
                runId,
                hasPayload: !!uiPayload?.payload
            });
            const logPostFrame = () => {
                logDescriptorDebug(descriptor, 'pixi-post-frame', {
                    interceptId: descriptor.interceptId || descriptor.id || null,
                    runId,
                    takeoverActive: !!takeoverBridge?.isActive?.(),
                    layerChildren: Number.isInteger(pixiLayer?.children?.length) ? pixiLayer.children.length : null,
                    layerVisible: pixiLayer?.visible ?? null,
                    layerRenderable: pixiLayer?.renderable ?? null,
                    layerAlpha: Number.isFinite(Number(pixiLayer?.alpha)) ? Number(pixiLayer.alpha) : null
                });
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(logPostFrame));
            } else {
                setTimeout(logPostFrame, 0);
            }
            if (transitionIn && pixiLayer) {
                const previousEventMode = pixiLayer.eventMode;
                const previousInteractiveChildren = pixiLayer.interactiveChildren;
                pixiLayer.eventMode = 'none';
                pixiLayer.interactiveChildren = false;
                playTransition(transitionIn, {
                    pixiLayer,
                    scope: 'intercept'
                }).finally(() => {
                    pixiLayer.eventMode = previousEventMode;
                    pixiLayer.interactiveChildren = previousInteractiveChildren;
                    releaseTransitionIn();
                }).catch(() => { });
            } else {
                releaseTransitionIn();
            }
        } catch (error) {
            debugError('[Intercept] PIXI intercept JS execution failed', error);
            releaseTransitionIn();
            finalize({ action: 'error', error: error.message });
        }
    });
}

async function runBlockingDescriptor(descriptor, checkpoint, checkpointContext = {}) {
    const uiPayload = await requestUiPayload(descriptor, checkpoint, checkpointContext);
    const renderer = getDescriptorRenderer(descriptor, uiPayload);
    if (renderer === 'pixi') {
        return runBlockingPixiDescriptor(descriptor, uiPayload, checkpoint, checkpointContext);
    }
    if (!uiPayload) return { action: 'continue' };

    const overlay = document.getElementById('plugin-overlay');
    if (!overlay) return { action: 'continue' };

    cleanupActiveOverlay();

    const overlayBackdropMode = resolveOverlayBackdropMode(descriptor, uiPayload);

    const runId = `gui_intercept_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const cssId = `plugin-intercept-css-${runId}`;
    const hostId = `plugin-intercept-host-${runId}`;
    const timeoutMs = Number.isFinite(descriptor.timeoutMs)
        ? Math.max(1000, descriptor.timeoutMs)
        : 120000;
    const runtimeDescriptor = Object.prototype.hasOwnProperty.call(uiPayload, 'payload')
        ? { ...descriptor, payload: uiPayload.payload }
        : descriptor;
    const hideMainSpritesWhileVisible = descriptorWantsMainSpriteHide(descriptor, uiPayload);
    const transitionIn = descriptor?.transitionIn || uiPayload?.transitionIn || null;
    const transitionOut = descriptor?.transitionOut || uiPayload?.transitionOut || null;
    let releaseTransitionIn = () => {};
    let transitionInReleased = !transitionIn;
    const transitionInGate = transitionIn
        ? new Promise((resolve) => {
            releaseTransitionIn = () => {
                if (transitionInReleased) return;
                transitionInReleased = true;
                resolve();
            };
        })
        : Promise.resolve();

    let finalized = false;
    let timeoutHandle = null;
    let styleEl = null;

    if (uiPayload.css) {
        styleEl = document.createElement('style');
        styleEl.id = cssId;
        styleEl.textContent = uiPayload.css;
        document.head.appendChild(styleEl);
    }

    overlay.dataset.interceptBackdrop = overlayBackdropMode;
    overlay.innerHTML = `<div id="${hostId}" class="plugin-intercept-blocking-host">${uiPayload.html || ''}</div>`;
    overlay.classList.remove('hidden');
    const hostEl = document.getElementById(hostId);

    const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = null;
        if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
        overlay.innerHTML = '';
        overlay.classList.add('hidden');
        delete overlay.dataset.interceptBackdrop;
    };

    const socket = orchestrator.socket;

    return await new Promise((resolve) => {
        let bridge = null;
        const finalize = async (result = { action: 'continue' }) => {
            if (finalized) return;
            finalized = true;
            disposeBridge(bridge, result?.reason || result?.action || 'blocking-finalize', result);
            if (transitionOut) {
                await playTransition(transitionOut, {
                    domElement: hostEl,
                    scope: 'intercept'
                }).catch(() => { });
            }
            if (hideMainSpritesWhileVisible) {
                setMainSpriteHideLock(runId, false);
            }
            endSessionBackground(runId, result?.reason || result?.action || 'blocking-finalize', { restore: true, instant: false });
            endSessionActors(runId, result?.reason || result?.action || 'blocking-finalize');
            cleanup();
            orchestrator.activeOverlay = null;
            resolve(result);
        };
        const guardedFinalize = async (result = { action: 'continue' }) => {
            await transitionInGate;
            return finalize(result);
        };

        timeoutHandle = setTimeout(() => {
            finalize({ action: 'cancel', reason: 'timeout' });
        }, timeoutMs);

        orchestrator.activeOverlay = {
            runId,
            cleanup: () => finalize({ action: 'cancel', reason: 'overlay_cleanup' })
        };
        if (hideMainSpritesWhileVisible) {
            setMainSpriteHideLock(runId, true);
        }

        bridge = buildBridge({
            descriptor: runtimeDescriptor,
            runId,
            checkpoint,
            checkpointContext,
            socket,
            finalize: guardedFinalize,
            renderer,
            hostEl
        });

        if (uiPayload.js) {
            try {
                const fn = new Function('bridge', 'socket', 'context', uiPayload.js);
                fn(bridge, socket, {
                    descriptor: runtimeDescriptor,
                    uiPayload,
                    payload: uiPayload.payload,
                    checkpoint,
                    checkpointContext,
                    runId,
                    PIXI: window.PIXI,
                    pixiApp
                });
            } catch (error) {
                debugError('[Intercept] Blocking intercept JS execution failed', error);
                releaseTransitionIn();
                finalize({ action: 'error', error: error.message });
            }
        }

        if (transitionIn && hostEl) {
            const previousPointerEvents = hostEl.style.pointerEvents;
            hostEl.style.pointerEvents = 'none';
            playTransition(transitionIn, {
                domElement: hostEl,
                scope: 'intercept'
            }).finally(() => {
                hostEl.style.pointerEvents = previousPointerEvents;
                releaseTransitionIn();
            }).catch(() => { });
        } else {
            releaseTransitionIn();
        }
    });
}

async function runCheckpointChain(checkpoint, checkpointContext = {}, initial = {}) {
    ensureInterceptRuntimeState();

    const chain = state.interceptRuntime.descriptors
        .filter((descriptor) => shouldExecuteDescriptor(descriptor, checkpoint, checkpointContext))
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a._order - b._order;
        });

    const working = {
        message: initial.message,
        directorPrompt: initial.directorPrompt
    };

    for (const descriptor of chain) {
        const key = createDescriptorKey(descriptor, checkpoint, checkpointContext);
        const current = state.interceptRuntime.statusByKey[key] || {};
        markDescriptorStatus(descriptor, checkpoint, checkpointContext, {
            visits: (current.visits || 0) + 1,
            ran: true
        });

        let result = { action: 'continue' };
        if (descriptor.blocking) {
            result = await runBlockingDescriptor(descriptor, checkpoint, checkpointContext);
        } else {
            const uiPayload = await requestUiPayload(descriptor, checkpoint, checkpointContext);
            if (uiPayload) {
                executeNonBlockingPayload(descriptor, uiPayload, checkpoint, checkpointContext);
            } else {
                window.dispatchEvent(new CustomEvent('vn:gui-intercept-nonblocking', {
                    detail: {
                        descriptor,
                        checkpoint,
                        checkpointContext
                    }
                }));
            }
            result = { action: 'continue' };
        }

        const isResolved = ['continue', 'navigate', 'submit'].includes(result?.action);
        markDescriptorStatus(descriptor, checkpoint, checkpointContext, {
            resolved: isResolved,
            lastResult: result || null
        });

        applyResultOverrides(working, result?.data);

        if (result?.action && result.action !== 'continue') {
            return {
                ...working,
                action: result.action,
                result
            };
        }
    }

    return {
        ...working,
        action: 'continue',
        result: null
    };
}

export function setInterceptSocket(socket) {
    orchestrator.socket = socket;
}

export function setInterceptBridgeHandlers(handlers = {}) {
    orchestrator.bridgeHandlers = {
        ...orchestrator.bridgeHandlers,
        ...handlers
    };
}

export function initializeTurnIntercepts(turnPayload = {}) {
    ensureInterceptRuntimeState();
    cleanupActiveOverlay({ reason: 'initialize_turn' });
    clearMainSpriteHideLocks();
    endAllBackgroundSessions('initialize-turn-intercepts', { restore: false });
    endAllActorSessions('initialize-turn-intercepts');

    const persisted = Array.isArray(turnPayload?.intercepts?.persisted)
        ? turnPayload.intercepts.persisted
        : [];
    const runtime = Array.isArray(turnPayload?.intercepts?.runtime)
        ? turnPayload.intercepts.runtime
        : [];
    logInterceptFlow('initialize-turn:intercepts', {
        turnNumber: turnPayload.turnNumber ?? null,
        persistedCount: persisted.length,
        runtimeCount: runtime.length,
        descriptors: [...persisted, ...runtime].map((descriptor) => ({
            pluginId: descriptor?.pluginId || descriptor?.plugin || null,
            interceptId: descriptor?.interceptId || descriptor?.id || null,
            checkpoint: descriptor?.checkpoint || null,
            dialogueIndex: Number.isInteger(Number(descriptor?.dialogueIndex)) ? Number(descriptor.dialogueIndex) : null,
            line: Number.isInteger(Number(descriptor?.line)) ? Number(descriptor.line) : null
        }))
    });
    for (const descriptor of [...persisted, ...runtime]) {
        logDescriptorDebug(descriptor, 'initialize-turn:received', {
            turnNumber: turnPayload.turnNumber ?? null,
            interceptId: descriptor?.interceptId || descriptor?.id || null,
            checkpoint: descriptor?.checkpoint || null,
            dialogueIndex: Number.isInteger(Number(descriptor?.dialogueIndex)) ? Number(descriptor.dialogueIndex) : null,
            line: Number.isInteger(Number(descriptor?.line)) ? Number(descriptor.line) : null
        });
    }

    const descriptors = [];
    let order = 0;
    for (const descriptor of persisted) {
        const normalized = normalizeDescriptor(descriptor, 'persisted', order++);
        if (normalized) descriptors.push(normalized);
    }
    for (const descriptor of runtime) {
        const normalized = normalizeDescriptor(descriptor, 'runtime', order++);
        if (normalized) descriptors.push(normalized);
    }

    state.interceptRuntime.descriptors = descriptors;
    state.interceptRuntime.statusByKey = {};
    state.interceptRuntime.currentTurnNumber = turnPayload.turnNumber || null;
}

export function resetTurnIntercepts() {
    ensureInterceptRuntimeState();
    cleanupActiveOverlay({ reason: 'reset_turn' });
    clearMainSpriteHideLocks();
    endAllBackgroundSessions('reset-turn-intercepts', { restore: false });
    endAllActorSessions('reset-turn-intercepts');
    state.interceptRuntime.descriptors = [];
    state.interceptRuntime.statusByKey = {};
    state.interceptRuntime.currentTurnNumber = null;
}

export async function runSceneEntryInterceptors(index, scene) {
    ensureInterceptRuntimeState();

    cleanupActiveOverlay({ reason: 'scene_entry' });

    const checkpoints = [];
    if (index === 0) checkpoints.push('before_first_dialogue');
    checkpoints.push('on_dialogue_enter');
    if (scene?.isVirtual) checkpoints.push('before_user_input_show');

    for (const checkpoint of checkpoints) {
        const result = await runCheckpointChain(checkpoint, {
            sceneIndex: index,
            dialogueIndex: index,
            scene
        });

        if (result.action === 'navigate' || result.action === 'submit' || result.action === 'error') {
            return {
                haltRender: true,
                action: result.action,
                result
            };
        }
    }

    return {
        haltRender: false
    };
}

export async function runBeforeSubmitInterceptors({ message = '', directorPrompt = '' } = {}) {
    ensureInterceptRuntimeState();
    logInterceptFlow('before-submit:start', {
        currentIndex: state.currentIndex,
        turnNumber: state.currentVN?.turnNumber ?? null,
        messageLength: String(message || '').length
    });
    cleanupActiveOverlay({ reason: 'before_submit' });

    const result = await runCheckpointChain('before_submit', {
        sceneIndex: state.currentIndex,
        dialogueIndex: state.currentIndex,
        scene: state.currentVN?.sequence?.[state.currentIndex] || null
    }, {
        message,
        directorPrompt
    });

    if (result.action === 'submit') {
        logInterceptFlow('before-submit:result', { action: result.action });
        return {
            allow: false,
            handledByIntercept: true,
            message: result.message,
            directorPrompt: result.directorPrompt
        };
    }

    if (result.action === 'navigate') {
        logInterceptFlow('before-submit:result', { action: result.action });
        return {
            allow: false,
            handledByIntercept: true,
            message: result.message,
            directorPrompt: result.directorPrompt
        };
    }

    if (result.action === 'cancel' || result.action === 'error') {
        logInterceptFlow('before-submit:result', { action: result.action });
        return {
            allow: false,
            handledByIntercept: true,
            message: result.message,
            directorPrompt: result.directorPrompt
        };
    }

    logInterceptFlow('before-submit:result', { action: result.action || 'continue' });
    return {
        allow: true,
        handledByIntercept: false,
        message: result.message,
        directorPrompt: result.directorPrompt
    };
}

export async function runDuringUserInputInterceptors({
    sceneIndex = state.currentIndex,
    scene = null
} = {}) {
    ensureInterceptRuntimeState();
    logInterceptFlow('during-input:start', {
        sceneIndex,
        currentIndex: state.currentIndex,
        turnNumber: state.currentVN?.turnNumber ?? null,
        sceneMode: state.currentVN?.sceneMode || null
    });
    cleanupActiveOverlay();

    const resolvedScene = scene || state.currentVN?.sequence?.[sceneIndex] || null;

    const result = await runCheckpointChain('during_user_input', {
        sceneIndex,
        dialogueIndex: sceneIndex,
        scene: resolvedScene
    });

    if (result.action === 'navigate' || result.action === 'submit' || result.action === 'error') {
        logInterceptFlow('during-input:result', { action: result.action });
        return {
            handled: true,
            action: result.action,
            result
        };
    }

    logInterceptFlow('during-input:result', { action: result.action || 'continue' });
    return {
        handled: result.action === 'cancel',
        action: result.action,
        result
    };
}
