import { state } from './state.js';
import { debugError, debugLog, getAssetUrl } from './utils.js';

const VALID_MODES = new Set(['off', 'on', 'auto']);
const metadataCache = new Map();

let commandMode = null;
let listenersInitialized = false;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function toFinite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAngleMode(value) {
    return String(value || '').trim().toLowerCase() === 'split_x' ? 'split_x' : 'single';
}

function normalizeHexColor(value, fallback = '#000000') {
    const raw = String(value || fallback).trim();
    const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
    return match ? `#${match[1].toLowerCase()}` : fallback;
}

function normalizeMode(rawMode) {
    const mode = String(rawMode || '').trim().toLowerCase();
    return VALID_MODES.has(mode) ? mode : null;
}

function makeCacheKey(backgroundPath, projectName) {
    return `${String(projectName || 'default_project')}::${String(backgroundPath || '')}`;
}

function buildSidecarPath(backgroundPath) {
    const raw = String(backgroundPath || '').trim();
    if (!raw) return null;

    const [pathWithoutQuery] = raw.split(/[?#]/);
    if (!pathWithoutQuery) return null;

    if (/\.[^./\\]+$/.test(pathWithoutQuery)) {
        return pathWithoutQuery.replace(/\.[^./\\]+$/, '.json');
    }
    return `${pathWithoutQuery}.json`;
}

function canonicalizeQuad(points) {
    const ordered = points
        .slice(0, 4)
        .map((point) => ({
            x: Number(point?.x),
            y: Number(point?.y)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (ordered.length < 4) return null;

    const byY = [...ordered].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);

    if (top.length < 2 || bottom.length < 2) return null;

    return {
        tl: top[0],
        tr: top[1],
        bl: bottom[0],
        br: bottom[1]
    };
}

function normalizeShadow(rawShadow) {
    if (!rawShadow || typeof rawShadow !== 'object') return null;
    if (rawShadow.enabled === false) return null;

    const angleDegrees = toFinite(rawShadow.angleDegrees ?? rawShadow.angle_degrees, 45);
    const angleMode = normalizeAngleMode(rawShadow.angleMode ?? rawShadow.angle_mode);
    const opacity = clamp(
        toFinite(rawShadow.opacity ?? rawShadow.strength ?? rawShadow.alpha, 0.4),
        0,
        1
    );
    const length = clamp(toFinite(rawShadow.length, 0.5), 0, 4);
    const blur = clamp(toFinite(rawShadow.blur, 4), 0, 40);

    return {
        enabled: true,
        angleMode,
        angleDegrees,
        angleDegreesLeft: toFinite(rawShadow.angleDegreesLeft ?? rawShadow.angle_degrees_left, angleDegrees),
        angleDegreesRight: toFinite(rawShadow.angleDegreesRight ?? rawShadow.angle_degrees_right, angleDegrees),
        opacity,
        length,
        blur,
        tintEnabled: rawShadow.tintEnabled === true || rawShadow.tint_enabled === true,
        tintColor: normalizeHexColor(rawShadow.tintColor ?? rawShadow.tint_color, '#000000'),
        tintStrength: clamp(toFinite(rawShadow.tintStrength ?? rawShadow.tint_strength, 0), 0, 1)
    };
}

function getDefaultModeFromSettings() {
    return 'auto';
}

function getEffectiveMode() {
    return commandMode || getDefaultModeFromSettings();
}

function requestRefresh(reason = 'spatial-stage') {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('spatial-stage:refresh-request', {
        detail: { reason }
    }));
}

function getDefaultStageDepth(normalizedX) {
    const edgeWeight = Math.abs((normalizedX * 2) - 1);
    const centerDepth = 0.32;
    const edgeDepth = 0.96;
    return clamp(lerp(centerDepth, edgeDepth, edgeWeight), 0, 1);
}

function getDepth(normalizedY, normalizedX, applyDefaultCurve = false, activeCount = 0) {
    const baseDepth = clamp((normalizedY - 0.62) / 0.38, 0, 1);
    void activeCount;
    if (!applyDefaultCurve) return baseDepth;

    // Classic VN slots do not provide authored stage depth. Place them on a
    // presentation arc inside the calibrated floor instead of the near edge.
    return Math.min(baseDepth, getDefaultStageDepth(normalizedX));
}

function projectPointInQuad(quad, normalizedX, depth) {
    const leftX = lerp(quad.tl.x, quad.bl.x, depth);
    const leftY = lerp(quad.tl.y, quad.bl.y, depth);
    const rightX = lerp(quad.tr.x, quad.br.x, depth);
    const rightY = lerp(quad.tr.y, quad.br.y, depth);

    return {
        x: lerp(leftX, rightX, normalizedX),
        y: lerp(leftY, rightY, normalizedX)
    };
}

function getHorizontalBoundsInQuad(quad, depth) {
    if (!quad) return null;
    const clampedDepth = clamp(toFinite(depth, 1), 0, 1);
    const left = {
        x: lerp(quad.tl.x, quad.bl.x, clampedDepth),
        y: lerp(quad.tl.y, quad.bl.y, clampedDepth)
    };
    const right = {
        x: lerp(quad.tr.x, quad.br.x, clampedDepth),
        y: lerp(quad.tr.y, quad.br.y, clampedDepth)
    };
    return {
        leftX: Math.min(left.x, right.x),
        rightX: Math.max(left.x, right.x),
        leftY: left.y,
        rightY: right.y,
        depth: clampedDepth
    };
}

function projectShadow(shadow, normalizedX) {
    if (!shadow) return null;
    const projected = { ...shadow };
    if (normalizeAngleMode(projected.angleMode ?? projected.angle_mode) === 'split_x') {
        const left = toFinite(projected.angleDegreesLeft ?? projected.angle_degrees_left, projected.angleDegrees);
        const right = toFinite(projected.angleDegreesRight ?? projected.angle_degrees_right, projected.angleDegrees);
        projected.angleDegrees = lerp(left, right, normalizedX);
    } else {
        projected.angleDegrees = toFinite(projected.angleDegrees ?? projected.angle_degrees, 45);
    }
    return projected;
}

export function normalizeSpatialStageMetadata(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const corners = Array.isArray(raw.corners) ? raw.corners : [];
    const quad = canonicalizeQuad(corners);
    if (!quad) return null;

    let perspectiveScaleFar = toFinite(raw.perspective_scale_far ?? raw.perspectiveScaleFar, 1);
    let perspectiveScaleNearby = toFinite(
        raw.perspective_scale_nearby ?? raw.perspectiveScaleNearby,
        perspectiveScaleFar
    );

    // Keep distant actors smaller than nearby actors, even if authored values are inverted.
    if (perspectiveScaleFar > perspectiveScaleNearby) {
        const tmp = perspectiveScaleFar;
        perspectiveScaleFar = perspectiveScaleNearby;
        perspectiveScaleNearby = tmp;
    }

    return {
        quad,
        perspectiveScaleFar: clamp(perspectiveScaleFar, 0.1, 4),
        perspectiveScaleNearby: clamp(perspectiveScaleNearby, 0.1, 4),
        shadow: normalizeShadow(raw.shadow)
    };
}

export function projectWithSpatialStageMetadata(metadata, params = {}) {
    if (!metadata?.quad) return null;

    const normalizedX = clamp(toFinite(params.normalizedX, 0.5), 0, 1);
    const normalizedY = clamp(toFinite(params.normalizedY, 1), 0, 1.25);
    const layoutScale = Math.max(0.01, toFinite(params.layoutScale, 1));
    const baseZIndex = toFinite(params.baseZIndex, 0);
    const alpha = clamp(toFinite(params.alpha, 1), 0, 1);
    const applyDefaultCurve = params.applyDefaultCurve === true;
    const activeCount = Math.max(0, toFinite(params.activeCount, 0));

    const depth = getDepth(normalizedY, normalizedX, applyDefaultCurve, activeCount);
    const point = projectPointInQuad(metadata.quad, normalizedX, depth);
    const perspectiveScale = lerp(metadata.perspectiveScaleFar, metadata.perspectiveScaleNearby, depth);

    return {
        x: point.x,
        y: point.y,
        scaleMultiplier: layoutScale * perspectiveScale,
        zIndex: baseZIndex + Math.round(depth * 100),
        alpha,
        shadow: projectShadow(metadata.shadow, normalizedX),
        depth
    };
}

async function loadMetadataForBackground(backgroundPath, projectName) {
    const sidecarPath = buildSidecarPath(backgroundPath);
    if (!sidecarPath || typeof fetch !== 'function') return null;

    const url = getAssetUrl(sidecarPath, projectName);
    if (!url) return null;

    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return null;
        const parsed = await response.json();
        return normalizeSpatialStageMetadata(parsed);
    } catch (error) {
        debugLog(`[SpatialStage] Sidecar load failed for ${sidecarPath}`, error?.message || error);
        return null;
    }
}

function ensureMetadataLoad(backgroundPath, projectName) {
    const cacheKey = makeCacheKey(backgroundPath, projectName);
    const existing = metadataCache.get(cacheKey);
    if (existing?.status === 'pending') return;
    if (existing?.status === 'ready' || existing?.status === 'miss') return;

    metadataCache.set(cacheKey, { status: 'pending', metadata: null });

    loadMetadataForBackground(backgroundPath, projectName)
        .then((metadata) => {
            if (metadata) {
                metadataCache.set(cacheKey, { status: 'ready', metadata });
                requestRefresh('spatial-stage-metadata-ready');
                return;
            }
            metadataCache.set(cacheKey, { status: 'miss', metadata: null });
        })
        .catch((error) => {
            metadataCache.set(cacheKey, { status: 'miss', metadata: null });
            debugError('[SpatialStage] Metadata cache update failed', error);
        });
}

function getMetadata(backgroundPath, projectName) {
    const cacheKey = makeCacheKey(backgroundPath, projectName);
    return metadataCache.get(cacheKey) || null;
}

function initListeners() {
    if (listenersInitialized || typeof window === 'undefined') return;

    window.addEventListener('spatial-stage:set', (event) => {
        const mode = normalizeMode(event?.detail?.mode);
        if (!mode) return;
        commandMode = mode;
        requestRefresh('spatial-stage-command');
    });

    window.addEventListener('vn:settings-updated', () => {
        if (commandMode) return;
        requestRefresh('spatial-stage-settings');
    });

    listenersInitialized = true;
}

export const pixiSpatialStage = {
    init() {
        initListeners();
    },

    setMode(rawMode) {
        const mode = normalizeMode(rawMode);
        if (!mode) return false;
        commandMode = mode;
        requestRefresh('spatial-stage-set-mode');
        return true;
    },

    clearCommandMode() {
        commandMode = null;
        requestRefresh('spatial-stage-clear-command-mode');
    },

    getCommandMode() {
        return commandMode;
    },

    getMode() {
        return getEffectiveMode();
    },

    clearCache() {
        metadataCache.clear();
    },

    clearBackground(backgroundPath, projectName) {
        if (!backgroundPath) return;
        metadataCache.delete(makeCacheKey(backgroundPath, projectName));
    },

    getHorizontalBoundsAtDepth({
        backgroundPath = state.currentBackground,
        projectName = state.currentVN?.projectName || null,
        depth = 1
    } = {}) {
        const cached = getMetadata(backgroundPath, projectName);
        if (cached?.status !== 'ready' || !cached.metadata?.quad) return null;
        return getHorizontalBoundsInQuad(cached.metadata.quad, depth);
    },

    primeBackground(backgroundPath, projectName) {
        if (!backgroundPath) return;
        const mode = getEffectiveMode();
        if (mode === 'off') return;
        ensureMetadataLoad(backgroundPath, projectName);
    },

    projectSprite({
        backgroundPath = state.currentBackground,
        projectName = state.currentVN?.projectName || null,
        normalizedX = 0.5,
        normalizedY = 1,
        layoutScale = 1,
        baseZIndex = 0,
        alpha = 1,
        hasExplicitLayout = false,
        layoutRole = '',
        activeCount = 0
    } = {}) {
        initListeners();

        const mode = getEffectiveMode();
        if (mode === 'off') return null;
        if (!backgroundPath) return null;

        const cached = getMetadata(backgroundPath, projectName);
        if (!cached || cached.status === 'pending') {
            ensureMetadataLoad(backgroundPath, projectName);
            return null;
        }
        if (cached.status !== 'ready' || !cached.metadata) return null;

        const applyDefaultCurve = !hasExplicitLayout || String(layoutRole || '') === 'composed';
        return projectWithSpatialStageMetadata(cached.metadata, {
            normalizedX,
            normalizedY,
            layoutScale,
            baseZIndex,
            alpha,
            applyDefaultCurve,
            activeCount
        });
    }
};
