import { state } from './state.js';
import { elements } from './elements.js';
import { pixiApp } from './pixi_engine.js';
import { debugLog, debugError } from './utils.js';

const runtime = {
    pluginLayer: null,
    audioSnapshot: null,
    vnRuntimePaused: false
};

function createEmptyTakeoverState() {
    return {
        active: false,
        runId: null,
        pluginId: null,
        interceptId: null,
        checkpoint: null,
        startedAt: null,
        reason: null,
        inputPassthrough: false,
        keepVNPixiRuntimeDuringTakeover: false
    };
}

function ensureTakeoverState() {
    if (!state.interceptRuntime || typeof state.interceptRuntime !== 'object') {
        state.interceptRuntime = {
            descriptors: [],
            statusByKey: {},
            sessionResolved: {},
            pluginState: {},
            currentTurnNumber: null
        };
    }
    if (!state.interceptRuntime.takeover || typeof state.interceptRuntime.takeover !== 'object') {
        state.interceptRuntime.takeover = createEmptyTakeoverState();
    }
    return state.interceptRuntime.takeover;
}

function applyUiLock(active) {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('pixi-takeover-active', !!active);
    const resizePixi = () => {
        try { pixiApp?._onResize?.(); } catch (_) { }
    };
    requestAnimationFrame(() => {
        resizePixi();
        requestAnimationFrame(resizePixi);
    });
}

function snapshotAudioState() {
    const ostPlayer = elements.audioPlayer;
    const voicePlayer = elements.voicePlayer;
    const voicePlayerSecondary = elements.voicePlayerSecondary;

    return {
        ost: {
            src: ostPlayer?.src || '',
            currentTime: Number.isFinite(ostPlayer?.currentTime) ? ostPlayer.currentTime : 0,
            wasPlaying: !!(ostPlayer && !ostPlayer.paused)
        },
        voice: {
            src: voicePlayer?.src || '',
            currentTime: Number.isFinite(voicePlayer?.currentTime) ? voicePlayer.currentTime : 0,
            wasPlaying: !!(voicePlayer && !voicePlayer.paused),
            talkingCharacter: state.currentTalkingCharacter || null
        },
        voiceSecondary: {
            src: voicePlayerSecondary?.src || '',
            currentTime: Number.isFinite(voicePlayerSecondary?.currentTime) ? voicePlayerSecondary.currentTime : 0,
            wasPlaying: !!(voicePlayerSecondary && !voicePlayerSecondary.paused)
        }
    };
}

function pauseAudioSystem(snapshot) {
    if (elements.audioPlayer && snapshot?.ost?.wasPlaying) {
        elements.audioPlayer.pause();
    }
    if (elements.voicePlayer && snapshot?.voice?.wasPlaying) {
        elements.voicePlayer.pause();
    }
    if (elements.voicePlayerSecondary && snapshot?.voiceSecondary?.wasPlaying) {
        elements.voicePlayerSecondary.pause();
    }
    state.isAudioPlaying = false;
    state.currentTalkingCharacter = null;
}

function shouldKeepVnViewportDuringTakeover(descriptor = {}) {
    return descriptor?.keepVNViewportDuringTakeover === true
        || descriptor?.visualState?.keepVNViewportDuringTakeover === true;
}

function shouldKeepVnAudioDuringTakeover(descriptor = {}) {
    return descriptor?.keepVNAudioDuringTakeover === true
        || descriptor?.visualState?.keepVNAudioDuringTakeover === true;
}

function shouldKeepVnPixiRuntimeDuringTakeover(descriptor = {}) {
    return descriptor?.keepVNPixiRuntimeDuringTakeover === true
        || descriptor?.visualState?.keepVNPixiRuntimeDuringTakeover === true;
}

function restoreAudioSystem(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;

    const ostPlayer = elements.audioPlayer;
    const voicePlayer = elements.voicePlayer;
    const voicePlayerSecondary = elements.voicePlayerSecondary;

    if (
        snapshot.ost?.wasPlaying &&
        ostPlayer &&
        snapshot.ost.src &&
        ostPlayer.src === snapshot.ost.src &&
        ostPlayer.paused &&
        !state.pendingOstResume
    ) {
        try {
            if (Number.isFinite(snapshot.ost.currentTime) && snapshot.ost.currentTime > 0) {
                ostPlayer.currentTime = snapshot.ost.currentTime;
            }
        } catch {
            // Some browsers reject currentTime writes while metadata is not ready.
        }
        ostPlayer.play().catch((error) => {
            debugError('[Intercept][Pixi] Failed to resume OST after takeover', error);
        });
    }

    const resumePrimaryVoice = (
        snapshot.voice?.wasPlaying &&
        voicePlayer &&
        snapshot.voice.src &&
        voicePlayer.src === snapshot.voice.src &&
        voicePlayer.paused &&
        !state.pendingVoiceResume
    );
    if (resumePrimaryVoice) {
        try {
            if (Number.isFinite(snapshot.voice.currentTime) && snapshot.voice.currentTime > 0) {
                voicePlayer.currentTime = snapshot.voice.currentTime;
            }
        } catch {
            // Some browsers reject currentTime writes while metadata is not ready.
        }
        voicePlayer.play().then(() => {
            state.isAudioPlaying = true;
            state.currentTalkingCharacter = snapshot.voice.talkingCharacter || null;
        }).catch((error) => {
            debugError('[Intercept][Pixi] Failed to resume voice after takeover', error);
            state.isAudioPlaying = false;
            state.currentTalkingCharacter = null;
        });
    }

    const resumeSecondaryVoice = (
        snapshot.voiceSecondary?.wasPlaying &&
        voicePlayerSecondary &&
        snapshot.voiceSecondary.src &&
        voicePlayerSecondary.src === snapshot.voiceSecondary.src &&
        voicePlayerSecondary.paused &&
        !state.pendingVoiceResume
    );
    if (resumeSecondaryVoice) {
        try {
            if (Number.isFinite(snapshot.voiceSecondary.currentTime) && snapshot.voiceSecondary.currentTime > 0) {
                voicePlayerSecondary.currentTime = snapshot.voiceSecondary.currentTime;
            }
        } catch {
            // Some browsers reject currentTime writes while metadata is not ready.
        }
        voicePlayerSecondary.play().then(() => {
            state.isAudioPlaying = true;
            state.currentTalkingCharacter = snapshot.voice?.talkingCharacter || null;
        }).catch((error) => {
            debugError('[Intercept][Pixi] Failed to resume secondary voice after takeover', error);
        });
    }

    if (!resumePrimaryVoice && !resumeSecondaryVoice) {
        state.isAudioPlaying = false;
        state.currentTalkingCharacter = null;
    }
}

function removePluginLayer() {
    if (!runtime.pluginLayer) return;

    try {
        runtime.pluginLayer.removeChildren();
        if (runtime.pluginLayer.parent) {
            runtime.pluginLayer.parent.removeChild(runtime.pluginLayer);
        }
        if (typeof runtime.pluginLayer.destroy === 'function') {
            runtime.pluginLayer.destroy({ children: true });
        }
    } catch (error) {
        debugError('[Intercept][Pixi] Failed to cleanup plugin takeover layer', error);
    } finally {
        runtime.pluginLayer = null;
    }
}

export function isPixiTakeoverActive() {
    const takeover = ensureTakeoverState();
    return !!takeover.active && takeover.inputPassthrough !== true;
}

export function getPixiTakeoverContext() {
    const takeover = ensureTakeoverState();
    return { ...takeover };
}

export function getPixiTakeoverLayer(runId = null) {
    const takeover = ensureTakeoverState();
    if (!runtime.pluginLayer) return null;
    if (runId && takeover.runId !== runId) return null;
    return runtime.pluginLayer;
}

export function beginPixiTakeover({ runId, descriptor, checkpoint } = {}) {
    const takeover = ensureTakeoverState();
    if (!runId) {
        return { success: false, error: 'missing_run_id' };
    }

    if (takeover.active && takeover.runId === runId) {
        return {
            success: true,
            layer: runtime.pluginLayer,
            context: getPixiTakeoverContext()
        };
    }

    if (takeover.active && takeover.runId !== runId) {
        endPixiTakeover({ reason: 'superseded_by_new_takeover' });
    }

    if (!pixiApp.app || !pixiApp.app.stage || !window.PIXI?.Container) {
        return { success: false, error: 'pixi_runtime_unavailable' };
    }

    runtime.pluginLayer = new window.PIXI.Container();
    runtime.pluginLayer.label = `PluginTakeoverLayer_${runId}`;
    runtime.pluginLayer.sortableChildren = true;
    runtime.pluginLayer.zIndex = 999999;
    pixiApp.app.stage.addChild(runtime.pluginLayer);

    const keepVnViewportDuringTakeover = shouldKeepVnViewportDuringTakeover(descriptor);
    const keepVnAudioDuringTakeover = shouldKeepVnAudioDuringTakeover(descriptor);
    const keepVnPixiRuntimeDuringTakeover = shouldKeepVnPixiRuntimeDuringTakeover(descriptor);
    if (pixiApp.viewport && !keepVnViewportDuringTakeover) {
        pixiApp.viewport.visible = false;
    }

    runtime.vnRuntimePaused = false;
    if (!keepVnPixiRuntimeDuringTakeover) {
        // Pause all registered VN plugins (VFX, shading, alive_bg)
        const pixiPluginRuntime = window.VN?.pixiPlugins;
        if (pixiPluginRuntime) {
            pixiPluginRuntime.pauseAll();
        }

        // Freeze GSAP global timeline (stops breathing, camera tweens, etc.)
        if (window.gsap) {
            window.gsap.globalTimeline.pause();
        }
        runtime.vnRuntimePaused = true;
    }

    state.autoPlay = false;
    if (state.autoPlayTimeout) {
        clearTimeout(state.autoPlayTimeout);
        state.autoPlayTimeout = null;
    }
    if (state.progressInterval) {
        clearInterval(state.progressInterval);
    }
    if (elements.progressBar) {
        elements.progressBar.style.width = '0%';
    }

    runtime.audioSnapshot = keepVnAudioDuringTakeover ? null : snapshotAudioState();
    if (!keepVnAudioDuringTakeover) {
        pauseAudioSystem(runtime.audioSnapshot);
    }
    
    // Only hide VN chrome if the descriptor doesn't explicitly request keeping it
    if (!descriptor?.keepVNChrome) {
        applyUiLock(true);
    }

    takeover.active = true;
    takeover.runId = runId;
    takeover.pluginId = descriptor?.pluginId || null;
    takeover.interceptId = descriptor?.interceptId || descriptor?.id || null;
    takeover.checkpoint = checkpoint || null;
    takeover.startedAt = Date.now();
    takeover.reason = null;
    takeover.inputPassthrough = false;
    takeover.keepVNChrome = !!descriptor?.keepVNChrome;
    takeover.keepVNViewportDuringTakeover = keepVnViewportDuringTakeover;
    takeover.keepVNAudioDuringTakeover = keepVnAudioDuringTakeover;
    takeover.keepVNPixiRuntimeDuringTakeover = keepVnPixiRuntimeDuringTakeover;

    window.dispatchEvent(new CustomEvent('vn:pixi-takeover-started', {
        detail: {
            ...getPixiTakeoverContext(),
            keepVNChrome: !!descriptor?.keepVNChrome,
            keepVNViewportDuringTakeover: keepVnViewportDuringTakeover,
            keepVNAudioDuringTakeover: keepVnAudioDuringTakeover,
            keepVNPixiRuntimeDuringTakeover: keepVnPixiRuntimeDuringTakeover
        }
    }));

    // Notify backend systems (HUD, Timeline) about the takeover
    if (window.socket) {
        window.socket.emit('pixi-takeover-state', { active: true, ...getPixiTakeoverContext() });
    }

    debugLog('[Intercept][Pixi] Takeover started', getPixiTakeoverContext());
    return {
        success: true,
        layer: runtime.pluginLayer,
        context: getPixiTakeoverContext()
    };
}

export function endPixiTakeover({ runId = null, reason = 'released' } = {}) {
    const takeover = ensureTakeoverState();
    if (!takeover.active) return false;
    if (runId && takeover.runId && runId !== takeover.runId) return false;

    const endedContext = {
        ...takeover,
        reason
    };

    if (pixiApp.viewport) {
        pixiApp.viewport.visible = true;
    }

    if (runtime.vnRuntimePaused) {
        // Resume all registered VN plugins
        const pixiPluginRuntime = window.VN?.pixiPlugins;
        if (pixiPluginRuntime) {
            pixiPluginRuntime.resumeAll();
        }

        // Resume GSAP global timeline
        if (window.gsap) {
            window.gsap.globalTimeline.resume();
        }
        runtime.vnRuntimePaused = false;
    }
    removePluginLayer();
    applyUiLock(false);
    restoreAudioSystem(runtime.audioSnapshot);
    runtime.audioSnapshot = null;

    Object.assign(takeover, createEmptyTakeoverState(), { reason });

    window.dispatchEvent(new CustomEvent('vn:pixi-takeover-ended', {
        detail: endedContext
    }));

    if (window.socket) {
        window.socket.emit('pixi-takeover-state', { active: false, ...endedContext });
    }

    debugLog('[Intercept][Pixi] Takeover ended', endedContext);
    return true;
}

export function createPixiTakeoverBridge({
    runId,
    descriptor,
    checkpoint,
    checkpointContext = {},
    finalize
} = {}) {
    const toCancelPayload = (reason, data = {}) => {
        const payload = (data && typeof data === 'object') ? { ...data } : {};
        if (!payload.reason) payload.reason = reason;
        return payload;
    };

    return {
        resolve: (data = {}) => finalize({ action: 'continue', data }),
        finish: (data = {}) => finalize({ action: 'continue', data }),
        abort: (reason = 'aborted', data = {}) => finalize({
            action: 'cancel',
            reason,
            data: toCancelPayload(reason, data)
        }),
        skip: (reason = 'skipped', data = {}) => finalize({
            action: 'cancel',
            reason,
            data: toCancelPayload(reason, data)
        }),
        isActive: () => {
            const takeover = ensureTakeoverState();
            return !!takeover.active && takeover.runId === runId;
        },
        getContext: () => ({
            ...getPixiTakeoverContext(),
            descriptor,
            checkpoint,
            checkpointContext
        }),
        setInputPassthrough: (enabled = true) => {
            const takeover = ensureTakeoverState();
            if (!takeover.active || takeover.runId !== runId) return false;
            takeover.inputPassthrough = !!enabled;
            try {
                window.dispatchEvent(new CustomEvent('vn:pixi-takeover-passthrough', {
                    detail: { ...getPixiTakeoverContext() }
                }));
            } catch (_) { }
            return true;
        },
        isInputPassthrough: () => {
            const takeover = ensureTakeoverState();
            return !!takeover.active && takeover.runId === runId && takeover.inputPassthrough === true;
        },
        getLayer: () => getPixiTakeoverLayer(runId),
        clearLayer: () => {
            const layer = getPixiTakeoverLayer(runId);
            if (layer) layer.removeChildren();
        }
    };
}

// Debug utility — allows triggering a pixi takeover from the browser console
// Usage: window.__debugPixiTakeover()
if (typeof window !== 'undefined') {
    window.__debugPixiTakeover = function(options = {}) {
        const runId = options.runId || `debug_${Date.now()}`;
        const result = beginPixiTakeover({ runId, descriptor: { pluginId: 'debug' } });

        if (!result.success) {
            console.error('[Debug] Takeover failed:', result.error);
            return null;
        }

        console.log('[Debug] Takeover started. Layer:', result.layer);
        console.log('[Debug] Call window.__debugPixiTakeoverEnd() to release.');

        window.__debugPixiTakeoverEnd = function(reason = 'debug_released') {
            endPixiTakeover({ runId, reason });
            console.log('[Debug] Takeover ended.');
            delete window.__debugPixiTakeoverEnd;
        };

        return result;
    };
}
