import { state } from './state.js';
import { pixiRenderer } from './pixi_renderer.js';

const backgroundSessions = new Map();

function normalizeSrc(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function inferIsVideo(src) {
    return /\.mp4$|\.webm$/i.test(String(src || '').trim());
}

function getCurrentVisibleBackground() {
    const liveSrc = normalizeSrc(pixiRenderer.currentSrc);
    if (liveSrc) {
        return {
            src: liveSrc,
            isVideo: !!pixiRenderer.currentIsVideo
        };
    }

    const naturalSrc = normalizeSrc(state.currentBackground);
    if (naturalSrc) {
        return {
            src: naturalSrc,
            isVideo: inferIsVideo(naturalSrc)
        };
    }

    return {
        src: null,
        isVideo: false
    };
}

function getNaturalBackground() {
    const naturalSrc = normalizeSrc(state.currentBackground);
    if (naturalSrc) {
        return {
            src: naturalSrc,
            isVideo: inferIsVideo(naturalSrc)
        };
    }

    return null;
}

function getSessionSnapshotBackground() {
    // Intercept backgrounds are temporary visual overrides. Their restore target
    // should be the VN's authored/natural background, not another temporary
    // override that happens to be visible during an async handoff.
    return getNaturalBackground() || getCurrentVisibleBackground();
}

function ensureSession(runId) {
    if (!runId) {
        throw new Error('Background session requires a runId.');
    }
    if (!backgroundSessions.has(runId)) {
        backgroundSessions.set(runId, {
            original: null,
            hasSnapshot: false,
            hasOverride: false,
            lastApplied: null
        });
    }
    return backgroundSessions.get(runId);
}

function dispatchBackgroundOverride({ src, isVideo = false, instant = true, runId = null, reason = null } = {}) {
    const finalSrc = normalizeSrc(src);
    if (!finalSrc) return false;
    try {
        window.dispatchEvent(new CustomEvent('vn:background-override', {
            detail: {
                src: finalSrc,
                isVideo: !!isVideo,
                instant: !!instant,
                source: 'intercept_background_bridge',
                runId: runId || null,
                reason: reason || null
            }
        }));
        return true;
    } catch {
        return false;
    }
}

export function getSessionBackgroundState(runId) {
    const session = backgroundSessions.get(runId);
    const current = getCurrentVisibleBackground();
    if (!session) {
        return {
            runId,
            active: false,
            hasSnapshot: false,
            hasOverride: false,
            original: null,
            current,
            lastApplied: null
        };
    }
    return {
        runId,
        active: true,
        hasSnapshot: !!session.hasSnapshot,
        hasOverride: !!session.hasOverride,
        original: session.original ? { ...session.original } : null,
        current,
        lastApplied: session.lastApplied ? { ...session.lastApplied } : null
    };
}

export function setSessionBackground(runId, options = {}) {
    const session = ensureSession(runId);
    const src = normalizeSrc(options.src || options.background || options.path);
    if (!src) {
        return {
            ...getSessionBackgroundState(runId),
            ok: false,
            reason: 'missing_src'
        };
    }

    if (!session.hasSnapshot) {
        const snapshot = getSessionSnapshotBackground();
        session.original = snapshot.src ? { ...snapshot } : null;
        session.hasSnapshot = true;
    }

    const isVideo = (typeof options.isVideo === 'boolean')
        ? options.isVideo
        : inferIsVideo(src);
    const instant = (options.instant !== undefined)
        ? !!options.instant
        : true;

    const applied = dispatchBackgroundOverride({
        src,
        isVideo,
        instant,
        runId,
        reason: 'session-set'
    });

    if (applied) {
        session.hasOverride = true;
        session.lastApplied = {
            src,
            isVideo,
            instant,
            at: Date.now()
        };
    }

    return {
        ...getSessionBackgroundState(runId),
        ok: applied
    };
}

export function restoreSessionBackground(runId, options = {}) {
    const session = backgroundSessions.get(runId);
    if (!session) {
        return {
            ...getSessionBackgroundState(runId),
            ok: false,
            restored: false,
            reason: 'missing_session'
        };
    }

    const instant = (options.instant !== undefined)
        ? !!options.instant
        : false;

    const target = session.original && session.original.src
        ? session.original
        : getNaturalBackground();

    if (!target?.src) {
        const lastAppliedSrc = normalizeSrc(session.lastApplied?.src);
        const currentVisibleSrc = normalizeSrc(pixiRenderer.currentSrc);
        const shouldClearOverride = !!lastAppliedSrc && currentVisibleSrc === lastAppliedSrc;
        if (shouldClearOverride) {
            pixiRenderer.clearBackground(instant);
        }
        session.hasOverride = false;
        session.lastApplied = null;
        return {
            ...getSessionBackgroundState(runId),
            ok: shouldClearOverride,
            restored: shouldClearOverride,
            reason: shouldClearOverride ? 'cleared_override_without_restore_target' : 'missing_restore_target'
        };
    }

    const applied = dispatchBackgroundOverride({
        src: target.src,
        isVideo: !!target.isVideo,
        instant,
        runId,
        reason: options.reason || 'session-restore'
    });

    if (applied) {
        session.hasOverride = false;
        session.lastApplied = null;
    }

    return {
        ...getSessionBackgroundState(runId),
        ok: applied,
        restored: applied
    };
}

export function endSessionBackground(runId, reason = 'session-end', options = {}) {
    const session = backgroundSessions.get(runId);
    if (!session) return false;

    const shouldRestore = options.restore !== false;
    if (shouldRestore && session.hasOverride) {
        restoreSessionBackground(runId, {
            instant: !!options.instant,
            reason
        });
    }

    backgroundSessions.delete(runId);
    return true;
}

export function endAllBackgroundSessions(reason = 'session-end-all', options = {}) {
    for (const runId of Array.from(backgroundSessions.keys())) {
        endSessionBackground(runId, reason, options);
    }
}
