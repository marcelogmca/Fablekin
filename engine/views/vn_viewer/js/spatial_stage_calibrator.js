import { elements } from './elements.js';
import { pixiApp } from './pixi_engine.js';
import { pixiRenderer } from './pixi_renderer.js';
import { pixiSpriteManager } from './pixi_sprite_manager.js';
import { pixiSpatialStage, normalizeSpatialStageMetadata, projectWithSpatialStageMetadata } from './pixi_spatial_stage.js';
import { CharacterShadow, normalizeSpriteShadowConfig } from './pixi_sprite_shadows.js';
import { state } from './state.js';
import { debugError, getAssetUrl, showConfirmation } from './utils.js';

const STYLE_ID = 'stage-calibrator-style';
const ACTIVE_CLASS = 'stage-calibrator-active';
const STAGE_ACCENT_COLOR = 0xf1c40f;
const EDITOR_EXTRA_WALKABLE_HEIGHT = 360;
const EDITOR_VOID_COLOR = 0x182235;
const EDITOR_PREVIEW_ACTOR_Z_INDEX = 60;
const EDITOR_FOREGROUND_OCCLUSION_Z_INDEX = 70;
const EDITOR_OVERLAY_Z_INDEX = 10000;
const DEFAULT_ENABLED_TINT_STRENGTH = 0.45;
const DEFAULT_CORNERS = Object.freeze([
    { x: 420, y: 650 },
    { x: 1500, y: 650 },
    { x: 1700, y: 970 },
    { x: 220, y: 970 }
]);
const DEFAULT_METADATA = Object.freeze({
    perspective_scale_far: 0.7,
    perspective_scale_nearby: 0.85,
    shadow: {
        enabled: true,
        angle_mode: 'single',
        angle_degrees: 45,
        angle_degrees_left: 45,
        angle_degrees_right: 45,
        strength: 0.4,
        length: 0.5,
        blur: 4,
        tint_enabled: false,
        tint_color: '#000000',
        tint_strength: 0
    }
});

let activeCalibrator = null;
function setViewerEditorMode(mode, active) {
    const body = document.body;
    if (!body) return;

    if (active) {
        body.dataset.vnEditorMode = mode;
    } else {
        if (body.dataset.vnEditorMode !== mode) return;
        delete body.dataset.vnEditorMode;
    }

    window.dispatchEvent(new CustomEvent('vn:editor-mode-changed', {
        detail: { mode, active: !!active }
    }));
}



function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
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

function isHexColor(value) {
    return /^#?[0-9a-fA-F]{6}$/.test(String(value || '').trim());
}

function lerpValue(a, b, t) {
    return a + ((b - a) * t);
}

function cloneCorners(corners) {
    return corners.map(point => ({ x: Number(point.x), y: Number(point.y) }));
}

function cloneMetadata(metadata) {
    const angleDegrees = numberOr(metadata?.shadow?.angle_degrees ?? metadata?.shadow?.angleDegrees, DEFAULT_METADATA.shadow.angle_degrees);
    return {
        perspective_scale_far: numberOr(metadata?.perspective_scale_far ?? metadata?.perspectiveScaleFar, DEFAULT_METADATA.perspective_scale_far),
        perspective_scale_nearby: numberOr(metadata?.perspective_scale_nearby ?? metadata?.perspectiveScaleNearby, DEFAULT_METADATA.perspective_scale_nearby),
        shadow: {
            enabled: metadata?.shadow?.enabled === true,
            angle_mode: normalizeAngleMode(metadata?.shadow?.angle_mode ?? metadata?.shadow?.angleMode),
            angle_degrees: angleDegrees,
            angle_degrees_left: numberOr(
                metadata?.shadow?.angle_degrees_left ?? metadata?.shadow?.angleDegreesLeft,
                angleDegrees
            ),
            angle_degrees_right: numberOr(
                metadata?.shadow?.angle_degrees_right ?? metadata?.shadow?.angleDegreesRight,
                angleDegrees
            ),
            strength: numberOr(
                metadata?.shadow?.strength ?? metadata?.shadow?.opacity ?? metadata?.shadow?.alpha,
                DEFAULT_METADATA.shadow.strength
            ),
            length: numberOr(metadata?.shadow?.length, DEFAULT_METADATA.shadow.length),
            blur: numberOr(metadata?.shadow?.blur, DEFAULT_METADATA.shadow.blur),
            tint_enabled: metadata?.shadow?.tint_enabled === true || metadata?.shadow?.tintEnabled === true,
            tint_color: normalizeHexColor(metadata?.shadow?.tint_color ?? metadata?.shadow?.tintColor, DEFAULT_METADATA.shadow.tint_color),
            tint_strength: clamp(
                numberOr(metadata?.shadow?.tint_strength ?? metadata?.shadow?.tintStrength, DEFAULT_METADATA.shadow.tint_strength),
                0,
                1
            )
        }
    };
}

function canonicalizeCornersForEditor(corners) {
    const usable = (Array.isArray(corners) ? corners : [])
        .slice(0, 4)
        .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (usable.length < 4) return cloneCorners(DEFAULT_CORNERS);

    const byY = [...usable].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]].map(point => ({ ...point }));
}

function shadowForSprite(rawShadow, normalizedX = 0.5) {
    if (!rawShadow?.enabled) return null;
    const angleDegrees = numberOr(rawShadow.angle_degrees, DEFAULT_METADATA.shadow.angle_degrees);
    const angleMode = normalizeAngleMode(rawShadow.angle_mode);
    const effectiveAngle = angleMode === 'split_x'
        ? lerpValue(
            numberOr(rawShadow.angle_degrees_left, angleDegrees),
            numberOr(rawShadow.angle_degrees_right, angleDegrees),
            clamp(numberOr(normalizedX, 0.5), 0, 1)
        )
        : angleDegrees;
    return normalizeSpriteShadowConfig({
        enabled: true,
        angle_degrees: effectiveAngle,
        strength: rawShadow.strength,
        length: rawShadow.length,
        blur: rawShadow.blur,
        tint_enabled: rawShadow.tint_enabled,
        tint_color: rawShadow.tint_color,
        tint_strength: rawShadow.tint_strength
    });
}

function getAssetLabel(assetPath) {
    const clean = String(assetPath || '').split(/[?#]/)[0].replace(/\\/g, '/');
    return clean.split('/').pop() || clean || 'unknown asset';
}

function isVideoBackgroundPath(assetPath) {
    return /\.(?:mp4|webm)$/i.test(String(assetPath || '').split(/[?#]/)[0]);
}

function isUsableSpritePath(spritePath) {
    const filename = getAssetLabel(spritePath).toLowerCase();
    if (!filename || filename.includes('generic')) return false;
    return !/(?:^|_)(?:blink|talk|talk_blink)\.[^.]+$/i.test(filename);
}

function makeCanvas(width, height) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (typeof document !== 'undefined' && document.createElement) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    return null;
}

function get2d(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
        return canvas.getContext('2d', options);
    } catch {
        return null;
    }
}

function isDrawableCandidate(candidate) {
    if (!candidate) return false;
    if (typeof HTMLImageElement !== 'undefined' && candidate instanceof HTMLImageElement) return true;
    if (typeof HTMLCanvasElement !== 'undefined' && candidate instanceof HTMLCanvasElement) return true;
    if (typeof HTMLVideoElement !== 'undefined' && candidate instanceof HTMLVideoElement) return true;
    if (typeof ImageBitmap !== 'undefined' && candidate instanceof ImageBitmap) return true;
    if (typeof OffscreenCanvas !== 'undefined' && candidate instanceof OffscreenCanvas) return true;
    return false;
}

function getTextureDrawables(texture) {
    const source = texture?.source || texture?.baseTexture || null;
    const candidates = [
        source?.resource,
        source?._resource,
        source?.resource?.source,
        source?.resource?.bitmap,
        source?.resource?.canvas,
        source?.resource?.image,
        texture?.baseTexture?.resource?.source,
        texture?.baseTexture?.resource?.image,
        texture?.baseTexture?.resource?.bitmap
    ];
    const out = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!candidate || !isDrawableCandidate(candidate) || seen.has(candidate)) continue;
        seen.add(candidate);
        out.push(candidate);
    }
    return out;
}

function getTextureSize(texture) {
    return {
        width: Math.max(1, Math.round(Number(texture?.width || texture?.frame?.width || texture?.orig?.width || 1))),
        height: Math.max(1, Math.round(Number(texture?.height || texture?.frame?.height || texture?.orig?.height || 1)))
    };
}

function drawTextureToCanvas(texture, canvas, targetWidth, targetHeight) {
    const ctx = get2d(canvas, { willReadFrequently: true });
    const drawables = getTextureDrawables(texture);
    if (!ctx || !drawables.length) return false;

    const { width, height } = getTextureSize(texture);
    const outWidth = Math.max(1, Math.round(Number(targetWidth) || width));
    const outHeight = Math.max(1, Math.round(Number(targetHeight) || height));
    const frame = texture?.frame || texture?._frame || null;
    const sx = Number.isFinite(Number(frame?.x)) ? Number(frame.x) : 0;
    const sy = Number.isFinite(Number(frame?.y)) ? Number(frame.y) : 0;
    const sw = Math.max(1, Number(frame?.width || width));
    const sh = Math.max(1, Number(frame?.height || height));

    for (const drawable of drawables) {
        try {
            ctx.clearRect(0, 0, outWidth, outHeight);
            ctx.drawImage(drawable, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
            return true;
        } catch {
            try {
                ctx.clearRect(0, 0, outWidth, outHeight);
                ctx.drawImage(drawable, 0, 0, outWidth, outHeight);
                return true;
            } catch { }
        }
    }
    return false;
}

function byteToHex(value) {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function sampleBackgroundColorAtPoint(sprite, point) {
    if (!sprite?.texture || !point) return null;
    const spriteWidth = Math.max(1, Math.abs(Number(sprite.width) || 1));
    const spriteHeight = Math.max(1, Math.abs(Number(sprite.height) || 1));
    const anchorX = Number(sprite.anchor?.x) || 0;
    const anchorY = Number(sprite.anchor?.y) || 0;
    const left = (Number(sprite.x) || 0) - (spriteWidth * anchorX);
    const top = (Number(sprite.y) || 0) - (spriteHeight * anchorY);
    const u = clamp((point.x - left) / spriteWidth, 0, 1);
    const v = clamp((point.y - top) / spriteHeight, 0, 1);
    const { width, height } = getTextureSize(sprite.texture);
    const canvas = makeCanvas(width, height);
    if (!canvas || !drawTextureToCanvas(sprite.texture, canvas, width, height)) return null;

    const ctx = get2d(canvas, { willReadFrequently: true });
    if (!ctx) return null;
    const x = clamp(Math.floor(u * (width - 1)), 0, width - 1);
    const y = clamp(Math.floor(v * (height - 1)), 0, height - 1);
    try {
        const data = ctx.getImageData(x, y, 1, 1).data;
        return `#${byteToHex(data[0])}${byteToHex(data[1])}${byteToHex(data[2])}`;
    } catch {
        return null;
    }
}

function lerpPoint(a, b, t) {
    return {
        x: a.x + ((b.x - a.x) * t),
        y: a.y + ((b.y - a.y) * t)
    };
}

function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return (dx * dx) + (dy * dy);
}

function approximateLayoutFromEditorPoint(corners, point) {
    let best = { normalizedX: 0.5, depth: 1, distance: Infinity };
    for (let step = 0; step <= 120; step += 1) {
        const depth = step / 120;
        const left = lerpPoint(corners[0], corners[3], depth);
        const right = lerpPoint(corners[1], corners[2], depth);
        const spanX = right.x - left.x;
        const spanY = right.y - left.y;
        const denom = (spanX * spanX) + (spanY * spanY);
        const rawT = denom > 0.0001
            ? (((point.x - left.x) * spanX) + ((point.y - left.y) * spanY)) / denom
            : 0.5;
        const normalizedX = clamp(rawT, 0, 1);
        const candidate = lerpPoint(left, right, normalizedX);
        const distance = distanceSquared(candidate, point);
        if (distance < best.distance) {
            best = { normalizedX, depth, distance };
        }
    }
    return {
        normalizedX: clamp(best.normalizedX, 0, 1),
        normalizedY: clamp(0.62 + (best.depth * 0.38), 0.62, 1)
    };
}

function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        body.${ACTIVE_CLASS} #controls,
        body.${ACTIVE_CLASS} #dialogue-container,
        body.${ACTIVE_CLASS} #user-input-container,
        body.${ACTIVE_CLASS} #dialogue-index-indicator {
            display: none !important;
        }

        .stage-calibrator-shell {
            position: absolute;
            inset: 0;
            z-index: 26010;
            pointer-events: none;
            color: var(--text-main);
            font-family: var(--font-ui);
        }

        .stage-calibrator-topbar,
        .stage-calibrator-panel {
            pointer-events: auto;
            position: absolute;
            background: rgba(var(--bg-surface-1-rgb), 0.88);
            border: var(--border-main);
            box-shadow: var(--shadow-lg);
            backdrop-filter: var(--glass-blur) var(--glass-saturation);
            border-radius: var(--radius-md);
        }

        .stage-calibrator-topbar {
            top: var(--space-md);
            left: var(--space-md);
            right: calc(var(--space-xl) + 76px);
            min-height: 54px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-sm);
            padding: var(--space-xs) var(--space-sm);
        }

        .stage-calibrator-title {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }

        .stage-calibrator-title strong {
            font-size: 15px;
            line-height: 1.1;
        }

        .stage-calibrator-title span {
            color: var(--text-muted);
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: min(760px, 58vw);
        }

        .stage-calibrator-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: flex-end;
            margin-right: var(--space-2xs);
        }

        .stage-calibrator-inline-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .stage-calibrator-btn {
            border: var(--border-main);
            background: var(--bg-overlay-light);
            color: var(--text-main);
            border-radius: var(--radius-md);
            padding: 8px 12px;
            font: inherit;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: var(--transition-fast);
        }

        .stage-calibrator-btn:hover {
            border-color: var(--color-primary-dim);
            background: var(--bg-overlay-med);
        }

        .stage-calibrator-btn.primary {
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--accent-dark) 100%);
            border-color: var(--color-primary);
            color: var(--text-inverse);
        }

        .stage-calibrator-btn.primary:hover {
            filter: brightness(1.08);
        }

        .stage-calibrator-btn.primary[data-save-state="saved"] {
            background: linear-gradient(135deg, #16803c 0%, #0d5b2a 100%);
            border-color: #46c46f;
        }

        .stage-calibrator-btn.primary[data-save-state="failed"] {
            background: linear-gradient(135deg, #a52b2b 0%, #6f1818 100%);
            border-color: #e26b6b;
        }

        .stage-calibrator-panel {
            top: 88px;
            right: var(--space-md);
            width: min(340px, calc(100vw - 32px));
            max-height: calc(100% - 110px);
            overflow: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }

        .stage-calibrator-panel.collapsed {
            max-height: 84px;
            overflow: hidden;
            gap: 8px;
        }

        .stage-calibrator-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            min-height: 30px;
        }

        .stage-calibrator-panel-header strong {
            color: var(--color-primary);
            font-size: 12px;
            text-transform: uppercase;
        }

        .stage-calibrator-panel.collapsed .stage-calibrator-panel-body {
            display: none;
        }

        .stage-calibrator-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .stage-calibrator-section:last-child {
            border-bottom: 0;
            padding-bottom: 0;
        }

        .stage-calibrator-section h3 {
            margin: 0;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0;
            color: var(--color-primary);
        }

        .stage-calibrator-field {
            display: grid;
            grid-template-columns: 1fr 78px;
            gap: 8px 10px;
            align-items: center;
        }

        .stage-calibrator-field label {
            grid-column: 1 / -1;
            font-size: 12px;
            color: var(--text-main);
        }

        .stage-calibrator-field input[type="range"] {
            width: 100%;
            accent-color: var(--color-primary);
        }

        .stage-calibrator-field input[type="number"] {
            width: 100%;
            background: var(--bg-overlay-dark);
            border: var(--border-main);
            color: var(--text-main);
            border-radius: var(--radius-md);
            padding: 6px 7px;
            font: inherit;
            font-size: 12px;
        }

        .stage-calibrator-conditional[hidden] {
            display: none !important;
        }

        .stage-calibrator-color-row {
            display: grid;
            grid-template-columns: 44px 1fr;
            gap: 8px;
            align-items: center;
        }

        .stage-calibrator-color-row label {
            grid-column: 1 / -1;
            font-size: 12px;
            color: var(--text-main);
        }

        .stage-calibrator-color-row input[type="color"] {
            width: 44px;
            height: 34px;
            padding: 2px;
            border: var(--border-main);
            border-radius: var(--radius-md);
            background: var(--bg-overlay-dark);
            cursor: pointer;
        }

        .stage-calibrator-color-row input[type="text"] {
            min-width: 0;
            background: var(--bg-overlay-dark);
            border: var(--border-main);
            color: var(--text-main);
            border-radius: var(--radius-md);
            padding: 7px 8px;
            font: inherit;
            font-size: 12px;
            text-transform: lowercase;
        }

        .stage-calibrator-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-main);
        }

        .stage-calibrator-btn[data-active="true"] {
            border-color: var(--color-primary);
            background: var(--bg-overlay-med);
            color: var(--color-primary);
        }

        body.${ACTIVE_CLASS}.stage-calibrator-picking-color #vn-canvas {
            cursor: crosshair !important;
        }

        .stage-calibrator-status {
            min-height: 18px;
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.35;
        }

        .stage-calibrator-status[data-tone="success"] {
            color: #71e89a;
            font-weight: 700;
        }

        .stage-calibrator-status[data-tone="error"] {
            color: #ff9c9c;
            font-weight: 700;
        }

        .stage-calibrator-note {
            margin: 0;
            color: var(--text-muted);
            font-size: 12px;
            line-height: 1.35;
        }

        @media (max-width: 820px) {
            .stage-calibrator-topbar {
                align-items: flex-start;
                flex-direction: column;
                right: calc(var(--space-md) + 58px);
            }

            .stage-calibrator-title span {
                max-width: calc(100vw - 64px);
                white-space: normal;
            }

            .stage-calibrator-panel {
                left: var(--space-md);
                right: var(--space-md);
                width: auto;
                top: 130px;
                max-height: calc(100% - 150px);
            }
        }
    `;
    document.head.appendChild(style);
}

function removeStyles() {
    document.getElementById(STYLE_ID)?.remove();
}

class StageCalibrator {
    constructor() {
        this.backgroundPath = state.currentBackground || '';
        this.projectName = state.currentVN?.projectName || null;
        this.rootEl = null;
        this.layer = null;
        this.previewActorLayer = null;
        this.voidGraphic = null;
        this.quadGraphic = null;
        this.previewHitArea = null;
        this.handleLayer = null;
        this.previewRoot = null;
        this.previewBody = null;
        this.previewBackFX = null;
        this.previewSprite = null;
        this.previewShadow = null;
        this.previewShadowSignature = null;
        this.previewBaseScale = 1;
        this.previewSpritePath = null;
        this.previewLayout = { normalizedX: 0.5, normalizedY: 1 };
        this.initialPreviewCandidate = null;
        this.handles = [];
        this.dragMode = null;
        this.dragIndex = null;
        this.colorPickActive = false;
        this.previousCanvasCursor = '';
        this.savedPixiState = null;
        this.savedSignature = null;
        this.metadata = null;
        this.corners = cloneCorners(DEFAULT_CORNERS);
        this.pendingStatus = '';
        this.panelCollapsed = false;
        this.saveFeedbackTimeout = null;
        this.onPointerMove = this.handlePointerMove.bind(this);
        this.onPointerUp = this.handlePointerUp.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);
        this.onCanvasColorPick = this.handleCanvasColorPick.bind(this);
    }

    getEditorLogicalHeight() {
        return pixiApp.LOGICAL_HEIGHT + EDITOR_EXTRA_WALKABLE_HEIGHT;
    }

    getEditorWorldScale() {
        return pixiApp.LOGICAL_HEIGHT / Math.max(1, this.getEditorLogicalHeight());
    }

    async open() {
        if (!this.backgroundPath) throw new Error('No active background to calibrate.');
        if (!pixiApp.app || !pixiApp.world) throw new Error('Pixi is not ready.');
        if (!window.socket?.emitReceive) throw new Error('Socket bridge is not ready.');

        installStyles();
        await this.loadInitialMetadata();
        this.capturePixiState();
        this.initialPreviewCandidate = this.getCurrentOnScreenPreviewCandidate();
        this.enterEditorRuntimeState();
        this.createDom();
        this.createPixiOverlay();
        await this.loadPreviewSprite();
        this.bindEvents();
        this.refreshAll();
    }

    async loadInitialMetadata() {
        const response = await window.socket.emitReceive('spatial-stage:get-sidecar', {
            backgroundPath: this.backgroundPath
        }, 10000);

        if (!response?.success) {
            this.metadata = cloneMetadata(DEFAULT_METADATA);
            this.corners = cloneCorners(DEFAULT_CORNERS);
            this.pendingStatus = response?.error || 'Using a default stage shape.';
            this.savedSignature = this.signatureForCurrentDraft();
            return;
        }

        const loaded = response.metadata || null;
        this.metadata = cloneMetadata(loaded || DEFAULT_METADATA);
        this.corners = canonicalizeCornersForEditor(loaded?.corners);
        this.pendingStatus = loaded ? `Loaded ${response.sidecarPath || 'existing sidecar'}.` : 'No sidecar yet; using a default stage shape.';
        this.savedSignature = this.signatureForCurrentDraft();
    }

    capturePixiState() {
        this.savedPixiState = {
            charactersVisible: pixiApp.layers.characters?.visible,
            interceptActorsVisible: pixiApp.layers.interceptActors?.visible,
            worldSortableChildren: pixiApp.world.sortableChildren,
            layerZIndex: {
                foregroundOcclusion: pixiApp.layers.foregroundOcclusion?.zIndex
            },
            renderer: {
                currentSrc: pixiRenderer.currentSrc,
                currentIsVideo: pixiRenderer.currentIsVideo
            },
            world: {
                x: pixiApp.world.position.x,
                y: pixiApp.world.position.y,
                pivotX: pixiApp.world.pivot.x,
                pivotY: pixiApp.world.pivot.y,
                scaleX: pixiApp.world.scale.x,
                scaleY: pixiApp.world.scale.y
            }
        };
    }

    enterEditorRuntimeState() {
        document.body.classList.add(ACTIVE_CLASS);
        setViewerEditorMode('spatial-stage-calibrator', true);
        if (pixiApp.layers.characters) pixiApp.layers.characters.visible = false;
        if (pixiApp.layers.interceptActors) pixiApp.layers.interceptActors.visible = false;
        if (pixiApp.layers.foregroundOcclusion) {
            pixiApp.layers.foregroundOcclusion.zIndex = EDITOR_FOREGROUND_OCCLUSION_Z_INDEX;
        }
        pixiApp.world.sortableChildren = true;
        const editorScale = this.getEditorWorldScale();
        const editorX = (pixiApp.LOGICAL_WIDTH - (pixiApp.LOGICAL_WIDTH * editorScale)) / 2;
        pixiApp.world.pivot.set(0, 0);
        pixiApp.world.position.set(editorX, 0);
        pixiApp.world.scale.set(editorScale);
    }

    restoreRuntimeState() {
        setViewerEditorMode('spatial-stage-calibrator', false);
        document.body.classList.remove(ACTIVE_CLASS);
        const saved = this.savedPixiState;
        if (!saved) return;
        if (pixiApp.layers.characters && saved.charactersVisible !== undefined) {
            pixiApp.layers.characters.visible = saved.charactersVisible;
        }
        if (pixiApp.layers.interceptActors && saved.interceptActorsVisible !== undefined) {
            pixiApp.layers.interceptActors.visible = saved.interceptActorsVisible;
        }
        if (pixiApp.layers.foregroundOcclusion && saved.layerZIndex?.foregroundOcclusion !== undefined) {
            pixiApp.layers.foregroundOcclusion.zIndex = saved.layerZIndex.foregroundOcclusion;
        }
        if (pixiApp.world) {
            pixiApp.world.sortableChildren = saved.worldSortableChildren;
            pixiApp.world.position.set(saved.world.x, saved.world.y);
            pixiApp.world.pivot.set(saved.world.pivotX, saved.world.pivotY);
            pixiApp.world.scale.set(saved.world.scaleX, saved.world.scaleY);
        }
        if (
            saved.renderer?.currentSrc
            && (pixiRenderer.currentSrc !== saved.renderer.currentSrc
                || pixiRenderer.currentIsVideo !== saved.renderer.currentIsVideo)
        ) {
            pixiRenderer.updateBackground(saved.renderer.currentSrc, !!saved.renderer.currentIsVideo, true);
        } else if (!saved.renderer?.currentSrc && pixiRenderer.currentSrc) {
            pixiRenderer.clearBackground(true);
        }
    }

    createDom() {
        const host = elements.gameContainer || document.body;
        this.rootEl = document.createElement('div');
        this.rootEl.className = 'stage-calibrator-shell';
        this.rootEl.innerHTML = `
            <div class="stage-calibrator-topbar">
                <div class="stage-calibrator-title">
                    <strong>Stage Calibrator</strong>
                    <span data-role="background-label">${this.backgroundPath}</span>
                </div>
                <div class="stage-calibrator-actions">
                    <button type="button" class="stage-calibrator-btn" data-action="pick-background">Pick Background</button>
                    <button type="button" class="stage-calibrator-btn" data-action="pick-sprite">Pick Sprite</button>
                    <button type="button" class="stage-calibrator-btn" data-action="reset">Reset</button>
                    <button type="button" class="stage-calibrator-btn" data-action="cancel">Cancel</button>
                    <button type="button" class="stage-calibrator-btn primary" data-action="apply">Apply</button>
                </div>
            </div>
            <div class="stage-calibrator-panel">
                <div class="stage-calibrator-panel-header">
                    <strong>Settings</strong>
                    <button type="button" class="stage-calibrator-btn" data-action="toggle-panel">Collapse</button>
                </div>
                <div class="stage-calibrator-panel-body">
                    <div class="stage-calibrator-section">
                        <h3>Preview</h3>
                        <p class="stage-calibrator-note" data-role="preview-label">Preview sprite: loading...</p>
                        <p class="stage-calibrator-note">Drag the corner handles to shape the walkable area. The shaded workspace below the image is for below-screen foot positions.</p>
                    </div>
                    <div class="stage-calibrator-section">
                        <h3>Perspective</h3>
                        ${this.renderNumberField('far', 'Far scale', 0.1, 4, 0.01, this.metadata.perspective_scale_far)}
                        ${this.renderNumberField('near', 'Nearby scale', 0.1, 4, 0.01, this.metadata.perspective_scale_nearby)}
                    </div>
                    <div class="stage-calibrator-section">
                        <h3>Shadow</h3>
                        <label class="stage-calibrator-checkbox">
                            <input type="checkbox" data-field="shadow-enabled">
                            <span>Enabled</span>
                        </label>
                        <label class="stage-calibrator-checkbox">
                            <input type="checkbox" data-field="shadow-angle-split">
                            <span>Vary angle across stage</span>
                        </label>
                        <div class="stage-calibrator-conditional" data-angle-mode="single">
                            ${this.renderNumberField('shadow-angle', 'Angle degrees', -180, 180, 1, this.metadata.shadow.angle_degrees)}
                        </div>
                        <div class="stage-calibrator-conditional" data-angle-mode="split">
                            ${this.renderNumberField('shadow-angle-left', 'Left angle', -180, 180, 1, this.metadata.shadow.angle_degrees_left)}
                            ${this.renderNumberField('shadow-angle-right', 'Right angle', -180, 180, 1, this.metadata.shadow.angle_degrees_right)}
                        </div>
                        ${this.renderNumberField('shadow-strength', 'Strength', 0, 1, 0.01, this.metadata.shadow.strength)}
                        ${this.renderNumberField('shadow-length', 'Length', 0, 4, 0.01, this.metadata.shadow.length)}
                        ${this.renderNumberField('shadow-blur', 'Blur', 0, 40, 1, this.metadata.shadow.blur)}
                        <label class="stage-calibrator-checkbox">
                            <input type="checkbox" data-field="shadow-tint-enabled">
                            <span>Tint shadow</span>
                        </label>
                        <div class="stage-calibrator-color-row">
                            <label>Tint color</label>
                            <input type="color" value="${this.metadata.shadow.tint_color}" data-field="shadow-tint-color">
                            <input type="text" value="${this.metadata.shadow.tint_color}" data-field="shadow-tint-color-text" spellcheck="false">
                        </div>
                        ${this.renderNumberField('shadow-tint-strength', 'Tint strength', 0, 1, 0.01, this.metadata.shadow.tint_strength)}
                        <div class="stage-calibrator-inline-actions">
                            <button type="button" class="stage-calibrator-btn" data-action="pick-shadow-tint">Pick from background</button>
                        </div>
                    </div>
                </div>
                <div class="stage-calibrator-status" data-role="status" role="status" aria-live="polite"></div>
            </div>
        `;
        host.appendChild(this.rootEl);

        this.rootEl.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.resetToDefault());
        this.rootEl.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.close());
        this.rootEl.querySelector('[data-action="apply"]')?.addEventListener('click', () => this.apply());
        this.rootEl.querySelector('[data-action="pick-sprite"]')?.addEventListener('click', () => this.pickPreviewSprite());
        this.rootEl.querySelector('[data-action="pick-background"]')?.addEventListener('click', () => this.pickBackground());
        this.rootEl.querySelector('[data-action="toggle-panel"]')?.addEventListener('click', () => this.togglePanelCollapsed());

        this.bindNumberField('far', value => { this.metadata.perspective_scale_far = value; });
        this.bindNumberField('near', value => { this.metadata.perspective_scale_nearby = value; });
        this.bindNumberField('shadow-angle', value => { this.metadata.shadow.angle_degrees = value; });
        this.bindNumberField('shadow-angle-left', value => { this.metadata.shadow.angle_degrees_left = value; });
        this.bindNumberField('shadow-angle-right', value => { this.metadata.shadow.angle_degrees_right = value; });
        this.bindNumberField('shadow-strength', value => { this.metadata.shadow.strength = value; });
        this.bindNumberField('shadow-length', value => { this.metadata.shadow.length = value; });
        this.bindNumberField('shadow-blur', value => { this.metadata.shadow.blur = value; });
        this.bindNumberField('shadow-tint-strength', value => { this.metadata.shadow.tint_strength = value; });

        const shadowEnabled = this.rootEl.querySelector('[data-field="shadow-enabled"]');
        if (shadowEnabled) {
            shadowEnabled.checked = this.metadata.shadow.enabled === true;
            shadowEnabled.addEventListener('change', () => {
                this.metadata.shadow.enabled = shadowEnabled.checked;
                this.refreshAll();
            });
        }

        const shadowAngleSplit = this.rootEl.querySelector('[data-field="shadow-angle-split"]');
        if (shadowAngleSplit) {
            shadowAngleSplit.checked = normalizeAngleMode(this.metadata.shadow.angle_mode) === 'split_x';
            shadowAngleSplit.addEventListener('change', () => {
                this.metadata.shadow.angle_mode = shadowAngleSplit.checked ? 'split_x' : 'single';
                this.syncAngleModeVisibility();
                this.refreshAll();
            });
        }

        const shadowTintEnabled = this.rootEl.querySelector('[data-field="shadow-tint-enabled"]');
        if (shadowTintEnabled) {
            shadowTintEnabled.checked = this.metadata.shadow.tint_enabled === true;
            shadowTintEnabled.addEventListener('change', () => {
                this.setShadowTintEnabled(shadowTintEnabled.checked);
                this.refreshAll();
            });
        }

        const tintColor = this.rootEl.querySelector('[data-field="shadow-tint-color"]');
        const tintColorText = this.rootEl.querySelector('[data-field="shadow-tint-color-text"]');
        if (tintColor) {
            tintColor.addEventListener('input', () => this.updateShadowTintColor(tintColor.value));
        }
        if (tintColorText) {
            tintColorText.addEventListener('input', () => {
                if (!isHexColor(tintColorText.value)) {
                    this.setStatus('Tint color must be a hex value like #c28a52.');
                    return;
                }
                this.updateShadowTintColor(tintColorText.value);
            });
        }

        this.rootEl.querySelector('[data-action="pick-shadow-tint"]')?.addEventListener('click', () => this.startColorPick());

        this.syncAngleModeVisibility();
        this.syncTintControls();
        this.setStatus(this.pendingStatus || '');
    }

    renderNumberField(id, label, min, max, step, value) {
        return `
            <div class="stage-calibrator-field" data-control="${id}">
                <label>${label}</label>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="${id}">
                <input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-number="${id}">
            </div>
        `;
    }

    bindNumberField(id, setter) {
        const range = this.rootEl.querySelector(`[data-range="${id}"]`);
        const number = this.rootEl.querySelector(`[data-number="${id}"]`);
        if (!range || !number) return;
        const min = Number(range.min);
        const max = Number(range.max);
        const applyValue = (rawValue, source) => {
            const value = clamp(numberOr(rawValue, Number(range.value)), min, max);
            setter(value);
            if (source !== range) range.value = String(value);
            if (source !== number) number.value = String(value);
            this.refreshAll();
        };
        range.addEventListener('input', () => applyValue(range.value, range));
        number.addEventListener('input', () => applyValue(number.value, number));
    }

    syncAngleModeVisibility() {
        const split = normalizeAngleMode(this.metadata?.shadow?.angle_mode) === 'split_x';
        const checkbox = this.rootEl?.querySelector('[data-field="shadow-angle-split"]');
        const single = this.rootEl?.querySelector('[data-angle-mode="single"]');
        const splitFields = this.rootEl?.querySelector('[data-angle-mode="split"]');
        if (checkbox) checkbox.checked = split;
        if (single) single.hidden = split;
        if (splitFields) splitFields.hidden = !split;
    }

    syncTintControls() {
        const color = normalizeHexColor(this.metadata?.shadow?.tint_color, DEFAULT_METADATA.shadow.tint_color);
        const tintEnabled = this.metadata?.shadow?.tint_enabled === true;
        const tintStrength = clamp(
            numberOr(this.metadata?.shadow?.tint_strength, DEFAULT_METADATA.shadow.tint_strength),
            0,
            1
        );
        const checkbox = this.rootEl?.querySelector('[data-field="shadow-tint-enabled"]');
        const colorInput = this.rootEl?.querySelector('[data-field="shadow-tint-color"]');
        const colorText = this.rootEl?.querySelector('[data-field="shadow-tint-color-text"]');
        const pickerButton = this.rootEl?.querySelector('[data-action="pick-shadow-tint"]');
        const strengthRange = this.rootEl?.querySelector('[data-range="shadow-tint-strength"]');
        const strengthNumber = this.rootEl?.querySelector('[data-number="shadow-tint-strength"]');
        if (checkbox) checkbox.checked = tintEnabled;
        if (colorInput) colorInput.value = color;
        if (colorText) colorText.value = color;
        if (strengthRange) strengthRange.value = String(tintStrength);
        if (strengthNumber) strengthNumber.value = String(tintStrength);
        if (pickerButton) pickerButton.dataset.active = this.colorPickActive ? 'true' : 'false';
    }

    setShadowTintEnabled(enabled) {
        this.metadata.shadow.tint_enabled = enabled === true;
        if (this.metadata.shadow.tint_enabled && numberOr(this.metadata.shadow.tint_strength, 0) <= 0) {
            this.metadata.shadow.tint_strength = DEFAULT_ENABLED_TINT_STRENGTH;
        }
        this.syncTintControls();
    }

    updateShadowTintColor(rawColor, { enableTint = false } = {}) {
        if (!isHexColor(rawColor)) return false;
        this.metadata.shadow.tint_color = normalizeHexColor(rawColor, DEFAULT_METADATA.shadow.tint_color);
        if (enableTint) this.setShadowTintEnabled(true);
        this.syncTintControls();
        this.refreshAll();
        return true;
    }

    togglePanelCollapsed() {
        this.panelCollapsed = !this.panelCollapsed;
        const panel = this.rootEl?.querySelector('.stage-calibrator-panel');
        const button = this.rootEl?.querySelector('[data-action="toggle-panel"]');
        if (panel) panel.classList.toggle('collapsed', this.panelCollapsed);
        if (button) button.textContent = this.panelCollapsed ? 'Expand' : 'Collapse';
    }

    getCanvasElement() {
        return pixiApp.app?.canvas || document.getElementById('vn-canvas');
    }

    startColorPick() {
        const canvas = this.getCanvasElement();
        if (!canvas) {
            this.setStatus('Canvas is not ready for color picking.');
            return;
        }
        if (this.colorPickActive) {
            this.cancelColorPick();
            this.setStatus('Color picker canceled.');
            return;
        }
        this.colorPickActive = true;
        this.previousCanvasCursor = canvas.style.cursor || '';
        canvas.style.cursor = 'crosshair';
        document.body.classList.add('stage-calibrator-picking-color');
        canvas.addEventListener('pointerdown', this.onCanvasColorPick, true);
        this.syncTintControls();
        this.setStatus('Color picker active: click the background to sample a shadow tint.');
    }

    cancelColorPick() {
        const canvas = this.getCanvasElement();
        if (canvas) {
            canvas.removeEventListener('pointerdown', this.onCanvasColorPick, true);
            canvas.style.cursor = this.previousCanvasCursor || '';
        }
        this.colorPickActive = false;
        document.body.classList.remove('stage-calibrator-picking-color');
        this.syncTintControls();
    }

    eventToLogicalPoint(event) {
        const canvas = this.getCanvasElement();
        const rect = canvas?.getBoundingClientRect?.();
        if (!canvas || !rect) return null;
        const screenPoint = new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top);
        const logical = pixiApp.world?.toLocal
            ? pixiApp.world.toLocal(screenPoint)
            : pixiApp.viewport?.toLocal
                ? pixiApp.viewport.toLocal(screenPoint)
            : {
                x: (screenPoint.x / Math.max(1, rect.width)) * pixiApp.LOGICAL_WIDTH,
                y: (screenPoint.y / Math.max(1, rect.height)) * pixiApp.LOGICAL_HEIGHT
            };
        if (logical.x < 0 || logical.x > pixiApp.LOGICAL_WIDTH || logical.y < 0 || logical.y > pixiApp.LOGICAL_HEIGHT) {
            return null;
        }
        return {
            x: clamp(logical.x, 0, pixiApp.LOGICAL_WIDTH),
            y: clamp(logical.y, 0, pixiApp.LOGICAL_HEIGHT)
        };
    }

    sampleCurrentBackgroundColor(point) {
        const sprite = pixiRenderer.backgroundSprite || pixiRenderer.backgroundVideo;
        return sampleBackgroundColorAtPoint(sprite, point);
    }

    handleCanvasColorPick(event) {
        if (!this.colorPickActive) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        const point = this.eventToLogicalPoint(event);
        const sampledColor = this.sampleCurrentBackgroundColor(point);
        this.cancelColorPick();

        if (!sampledColor) {
            this.setStatus('Could not sample that background pixel. Try a visible image/video area.');
            return;
        }

        this.updateShadowTintColor(sampledColor, { enableTint: true });
        this.setStatus(`Sampled shadow tint ${sampledColor}.`);
    }

    createPixiOverlay() {
        this.layer = new PIXI.Container();
        this.layer.label = 'StageCalibratorLayer';
        this.layer.zIndex = EDITOR_OVERLAY_Z_INDEX;
        this.layer.sortableChildren = true;
        this.layer.eventMode = 'static';
        this.layer.hitArea = new PIXI.Rectangle(
            0,
            0,
            pixiApp.LOGICAL_WIDTH,
            this.getEditorLogicalHeight()
        );

        this.previewActorLayer = new PIXI.Container();
        this.previewActorLayer.label = 'StageCalibratorPreviewActorLayer';
        this.previewActorLayer.zIndex = EDITOR_PREVIEW_ACTOR_Z_INDEX;

        this.voidGraphic = new PIXI.Graphics();
        this.voidGraphic.label = 'StageCalibratorBelowScreenVoid';
        this.voidGraphic.zIndex = 0;

        this.quadGraphic = new PIXI.Graphics();
        this.quadGraphic.label = 'StageCalibratorQuad';
        this.quadGraphic.zIndex = 10;

        this.previewRoot = new PIXI.Container();
        this.previewRoot.label = 'StageCalibratorPreviewRoot';
        this.previewRoot.zIndex = 50;
        this.previewRoot.eventMode = 'none';
        this.previewBackFX = new PIXI.Container();
        this.previewBody = new PIXI.Container();
        this.previewRoot.addChild(this.previewBackFX, this.previewBody);

        this.previewHitArea = new PIXI.Graphics();
        this.previewHitArea.label = 'StageCalibratorPreviewHitArea';
        this.previewHitArea.zIndex = 90;
        this.previewHitArea.eventMode = 'static';
        this.previewHitArea.cursor = 'grab';
        this.previewHitArea.on('pointerdown', (event) => {
            this.dragMode = 'preview';
            this.previewHitArea.cursor = 'grabbing';
            event.stopPropagation();
        });

        this.handleLayer = new PIXI.Container();
        this.handleLayer.label = 'StageCalibratorHandles';
        this.handleLayer.zIndex = 100;

        this.previewActorLayer.addChild(this.previewRoot);
        this.layer.addChild(this.voidGraphic, this.quadGraphic, this.previewHitArea, this.handleLayer);
        pixiApp.world.addChild(this.previewActorLayer, this.layer);
        this.createHandles();
    }


    createHandles() {
        this.handles = this.corners.map((_point, index) => {
            const handle = new PIXI.Container();
            handle.label = `StageCalibratorHandle_${index + 1}`;
            handle.eventMode = 'static';
            handle.cursor = 'grab';

            const marker = new PIXI.Graphics();
            marker.circle(0, 0, 14);
            marker.fill({ color: STAGE_ACCENT_COLOR, alpha: 1 });
            marker.stroke({ color: 0xffffff, width: 3, alpha: 0.95 });

            const label = new PIXI.Text({
                text: String(index + 1),
                style: {
                    fontFamily: 'Inter, NotoSans, Segoe UI, sans-serif',
                    fontSize: 13,
                    fill: 0xffffff,
                    fontWeight: '700'
                }
            });
            label.anchor.set(0.5);
            label.y = 0.5;

            handle.addChild(marker, label);
            handle.on('pointerdown', (event) => {
                this.dragMode = 'corner';
                this.dragIndex = index;
                handle.cursor = 'grabbing';
                event.stopPropagation();
            });
            this.handleLayer.addChild(handle);
            return handle;
        });
    }

    async loadPreviewSprite() {
        const currentCandidate = this.initialPreviewCandidate || this.getCurrentOnScreenPreviewCandidate();
        if (currentCandidate?.spritePath) {
            await this.setPreviewSprite(
                currentCandidate.spritePath,
                `Previewing current on-screen sprite: ${currentCandidate.characterName || getAssetLabel(currentCandidate.spritePath)}.`
            );
            return;
        }

        const response = await window.socket.emitReceive('spatial-stage:get-preview-sprite', {}, 10000);
        if (!response?.success || !response.spritePath) {
            this.createFallbackPreview();
            this.setStatus(response?.error || 'No non-generic preview sprite found; showing a simple placeholder.');
            return;
        }

        await this.setPreviewSprite(
            response.spritePath,
            `Previewing project sprite: ${response.characterName || getAssetLabel(response.spritePath)}.`
        );
    }

    getCurrentOnScreenPreviewCandidate() {
        const entries = typeof pixiSpriteManager.getManagedSpriteEntries === 'function'
            ? pixiSpriteManager.getManagedSpriteEntries()
            : Object.entries(pixiSpriteManager.activeSprites || {}).map(([charName, charObj]) => ({
                charName,
                charObj,
                isPluginActor: false
            }));
        const visibleEntries = entries.filter(({ charObj, isPluginActor }) => {
            if (isPluginActor || !charObj?.spritePath) return false;
            if (charObj.container?.visible === false || charObj.container?.worldVisible === false) return false;
            if (Number(charObj.container?.alpha) <= 0.01) return false;
            return true;
        });
        const preferred = visibleEntries.find(({ charObj }) => isUsableSpritePath(charObj.spritePath));
        const fallback = preferred || visibleEntries[0];
        if (!fallback) return null;
        return {
            spritePath: fallback.charObj.spritePath,
            characterName: fallback.charName
        };
    }

    clearPreviewDisplay() {
        this.destroyPreviewShadow();
        this.previewSprite = null;
        this.previewSpritePath = null;
        this.previewShadowSignature = null;
        if (!this.previewBody) return;
        const children = [...this.previewBody.children];
        children.forEach(child => {
            try { child.destroy({ children: true, texture: false, baseTexture: false }); } catch { }
        });
        this.previewBody.removeChildren();
    }

    async setPreviewSprite(spritePath, statusMessage = '') {
        this.clearPreviewDisplay();
        if (!spritePath) {
            this.createFallbackPreview();
            this.setStatus(statusMessage || 'No preview sprite selected; showing a simple placeholder.');
            return;
        }

        try {
            const texture = await PIXI.Assets.load(getAssetUrl(spritePath, this.projectName));
            this.previewSprite = new PIXI.Sprite(texture);
            this.previewSprite.anchor.set(0.5, 1);
            this.previewBody.addChild(this.previewSprite);
            this.previewBaseScale = (pixiApp.LOGICAL_HEIGHT * 0.85) / Math.max(1, texture.height);
            this.previewSpritePath = spritePath;
            this.updatePreviewLabel();
            this.setStatus(statusMessage || `Previewing ${getAssetLabel(spritePath)}.`);
            this.refreshAll();
        } catch (error) {
            debugError('[StageCalibrator] Failed to load preview sprite', error);
            this.createFallbackPreview();
            this.setStatus('Preview sprite failed to load; showing a simple placeholder.');
        }
    }

    createFallbackPreview() {
        this.clearPreviewDisplay();
        const body = new PIXI.Graphics();
        body.roundRect(-38, -168, 76, 168, 12);
        body.fill({ color: 0xe5e7eb, alpha: 0.78 });
        body.circle(0, -198, 24);
        body.fill({ color: 0xf8fafc, alpha: 0.9 });
        body.stroke({ color: 0x111827, width: 2, alpha: 0.5 });
        this.previewBody.addChild(body);
        this.previewBaseScale = 1.2;
        this.updatePreviewLabel();
    }

    updatePreviewLabel() {
        const label = this.rootEl?.querySelector('[data-role="preview-label"]');
        if (!label) return;
        label.textContent = this.previewSpritePath
            ? `Preview sprite: ${getAssetLabel(this.previewSpritePath)}`
            : 'Preview sprite: simple placeholder';
    }

    bindEvents() {
        this.layer.on('pointermove', this.onPointerMove);
        this.layer.on('pointerup', this.onPointerUp);
        this.layer.on('pointerupoutside', this.onPointerUp);
        window.addEventListener('keydown', this.onKeyDown);
    }

    unbindEvents() {
        this.cancelColorPick();
        this.layer?.off('pointermove', this.onPointerMove);
        this.layer?.off('pointerup', this.onPointerUp);
        this.layer?.off('pointerupoutside', this.onPointerUp);
        window.removeEventListener('keydown', this.onKeyDown);
    }

    handlePointerMove(event) {
        if (!this.dragMode) return;
        const local = pixiApp.world.toLocal(event.global);
        if (this.dragMode === 'corner' && this.dragIndex !== null) {
            this.corners[this.dragIndex] = {
                x: clamp(local.x, 0, pixiApp.LOGICAL_WIDTH),
                y: clamp(local.y, 0, this.getEditorLogicalHeight())
            };
        } else if (this.dragMode === 'preview') {
            this.previewLayout = approximateLayoutFromEditorPoint(this.corners, {
                x: clamp(local.x, 0, pixiApp.LOGICAL_WIDTH),
                y: clamp(local.y, 0, this.getEditorLogicalHeight())
            });
        }
        this.refreshAll();
    }

    handlePointerUp() {
        if (this.dragMode === 'corner' && this.dragIndex !== null) {
            const handle = this.handles[this.dragIndex];
            if (handle) handle.cursor = 'grab';
        }
        if (this.previewHitArea) this.previewHitArea.cursor = 'grab';
        this.dragMode = null;
        this.dragIndex = null;
    }

    handleKeyDown(event) {
        if (event.key !== 'Escape') return;
        if (this.colorPickActive) {
            this.cancelColorPick();
            this.setStatus('Color picker canceled.');
            return;
        }
        this.close();
    }

    getDraftMetadata() {
        return {
            corners: cloneCorners(this.corners),
            perspective_scale_far: numberOr(this.metadata.perspective_scale_far, DEFAULT_METADATA.perspective_scale_far),
            perspective_scale_nearby: numberOr(this.metadata.perspective_scale_nearby, DEFAULT_METADATA.perspective_scale_nearby),
            shadow: {
                enabled: this.metadata.shadow.enabled === true,
                angle_mode: normalizeAngleMode(this.metadata.shadow.angle_mode),
                angle_degrees: numberOr(this.metadata.shadow.angle_degrees, DEFAULT_METADATA.shadow.angle_degrees),
                angle_degrees_left: numberOr(this.metadata.shadow.angle_degrees_left, this.metadata.shadow.angle_degrees),
                angle_degrees_right: numberOr(this.metadata.shadow.angle_degrees_right, this.metadata.shadow.angle_degrees),
                strength: numberOr(this.metadata.shadow.strength, DEFAULT_METADATA.shadow.strength),
                length: numberOr(this.metadata.shadow.length, DEFAULT_METADATA.shadow.length),
                blur: numberOr(this.metadata.shadow.blur, DEFAULT_METADATA.shadow.blur),
                tint_enabled: this.metadata.shadow.tint_enabled === true,
                tint_color: normalizeHexColor(this.metadata.shadow.tint_color, DEFAULT_METADATA.shadow.tint_color),
                tint_strength: clamp(
                    numberOr(this.metadata.shadow.tint_strength, DEFAULT_METADATA.shadow.tint_strength),
                    0,
                    1
                )
            }
        };
    }

    signatureForCurrentDraft() {
        return JSON.stringify(this.getDraftMetadata());
    }

    isDirty() {
        return this.savedSignature !== this.signatureForCurrentDraft();
    }

    updateBackgroundLabel() {
        const label = this.rootEl?.querySelector('[data-role="background-label"]');
        if (label) label.textContent = this.backgroundPath || '';
    }

    async pickPreviewSprite() {
        const button = this.rootEl?.querySelector('[data-action="pick-sprite"]');
        if (button) button.disabled = true;
        try {
            // Native file dialogs are user-paced, so do not apply the normal RPC timeout.
            const response = await window.socket.emitReceive('spatial-stage:browse-sprite', {}, 0);
            if (!response?.success) throw new Error(response?.error || 'Sprite picker failed.');
            if (!response.spritePath) {
                this.setStatus('Sprite selection canceled.');
                return;
            }
            await this.setPreviewSprite(response.spritePath, `Previewing selected sprite: ${getAssetLabel(response.spritePath)}.`);
        } catch (error) {
            debugError('[StageCalibrator] Sprite picker failed', error);
            this.setStatus(error.message || 'Failed to choose preview sprite.');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async pickBackground() {
        if (this.isDirty()) {
            const proceed = await showConfirmation(
                'Unsaved Stage Calibration',
                'This background has unsaved calibration changes. Switch backgrounds anyway? The draft will stay in the editor only if the next background has no sidecar.'
            );
            if (!proceed) return;
        }

        const button = this.rootEl?.querySelector('[data-action="pick-background"]');
        if (button) button.disabled = true;
        try {
            // Native file dialogs are user-paced, so do not apply the normal RPC timeout.
            const response = await window.socket.emitReceive('spatial-stage:browse-background', {}, 0);
            if (!response?.success) throw new Error(response?.error || 'Background picker failed.');
            if (!response.backgroundPath) {
                this.setStatus('Background selection canceled.');
                return;
            }
            await this.switchBackground(response.backgroundPath);
        } catch (error) {
            debugError('[StageCalibrator] Background picker failed', error);
            this.setStatus(error.message || 'Failed to choose background.');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async switchBackground(backgroundPath) {
        if (!backgroundPath || backgroundPath === this.backgroundPath) return;
        const inheritedDraft = this.getDraftMetadata();
        this.backgroundPath = backgroundPath;
        this.updateBackgroundLabel();
        this.setStatus(`Loading ${getAssetLabel(backgroundPath)}...`);

        await pixiRenderer.updateBackground(backgroundPath, isVideoBackgroundPath(backgroundPath), true);

        const response = await window.socket.emitReceive('spatial-stage:get-sidecar', {
            backgroundPath
        }, 10000);

        if (response?.success && response.metadata) {
            this.metadata = cloneMetadata(response.metadata);
            this.corners = canonicalizeCornersForEditor(response.metadata.corners);
            this.savedSignature = this.signatureForCurrentDraft();
            this.setStatus(`Loaded ${response.sidecarPath || `${getAssetLabel(backgroundPath)} sidecar`}.`);
        } else {
            this.metadata = cloneMetadata(inheritedDraft);
            this.corners = canonicalizeCornersForEditor(inheritedDraft.corners);
            this.savedSignature = null;
            this.setStatus(response?.success
                ? 'No sidecar for this background; keeping the previous calibration as an unsaved draft.'
                : response?.error || 'Could not load sidecar; keeping the previous calibration as an unsaved draft.');
        }

        this.previewLayout = { normalizedX: 0.5, normalizedY: 1 };
        this.syncControlsFromMetadata();
        this.refreshAll();
    }

    refreshAll() {
        this.refreshEditorVoid();
        this.refreshQuad();
        this.refreshPreview();
    }

    refreshEditorVoid() {
        if (!this.voidGraphic) return;
        this.voidGraphic.clear();
        this.voidGraphic.rect(
            -pixiApp.LOGICAL_WIDTH * 0.25,
            pixiApp.LOGICAL_HEIGHT,
            pixiApp.LOGICAL_WIDTH * 1.5,
            this.getEditorLogicalHeight() - pixiApp.LOGICAL_HEIGHT
        );
        this.voidGraphic.fill({ color: EDITOR_VOID_COLOR, alpha: 0.84 });
        for (let y = pixiApp.LOGICAL_HEIGHT + 72; y < this.getEditorLogicalHeight(); y += 72) {
            this.voidGraphic.moveTo(-pixiApp.LOGICAL_WIDTH * 0.25, y);
            this.voidGraphic.lineTo(pixiApp.LOGICAL_WIDTH * 1.25, y);
            this.voidGraphic.stroke({ color: STAGE_ACCENT_COLOR, width: 1, alpha: 0.12 });
        }
        this.voidGraphic.moveTo(0, pixiApp.LOGICAL_HEIGHT);
        this.voidGraphic.lineTo(pixiApp.LOGICAL_WIDTH, pixiApp.LOGICAL_HEIGHT);
        this.voidGraphic.stroke({ color: STAGE_ACCENT_COLOR, width: 3, alpha: 0.5 });
    }

    refreshQuad() {
        if (!this.quadGraphic) return;
        this.quadGraphic.clear();
        const points = this.corners.flatMap(point => [point.x, point.y]);
        this.quadGraphic.poly(points, true);
        this.quadGraphic.fill({ color: STAGE_ACCENT_COLOR, alpha: 0.16 });
        this.quadGraphic.stroke({ color: STAGE_ACCENT_COLOR, width: 4, alpha: 0.92 });
        this.handles.forEach((handle, index) => {
            const point = this.corners[index];
            handle.position.set(point.x, point.y);
        });
    }

    refreshPreviewHitArea(projection) {
        if (!this.previewHitArea || !projection) return;
        const radius = Math.max(34, 48 * (this.previewBaseScale * projection.scaleMultiplier));
        this.previewHitArea.clear();
        this.previewHitArea.circle(0, 0, radius);
        this.previewHitArea.fill({ color: 0xffffff, alpha: 0.001 });
        this.previewHitArea.stroke({ color: STAGE_ACCENT_COLOR, width: 2, alpha: 0.35 });
        this.previewHitArea.position.set(projection.x, projection.y);
    }

    refreshPreview() {
        if (!this.previewRoot) return;
        const normalized = normalizeSpatialStageMetadata(this.getDraftMetadata());
        const projection = projectWithSpatialStageMetadata(normalized, {
            normalizedX: this.previewLayout.normalizedX,
            normalizedY: this.previewLayout.normalizedY,
            layoutScale: 1,
            applyDefaultCurve: false,
            activeCount: 1
        });
        if (!projection) return;

        this.previewRoot.position.set(projection.x, projection.y);
        this.previewRoot.scale.set(this.previewBaseScale * projection.scaleMultiplier);
        this.previewRoot.zIndex = projection.zIndex;
        this.refreshPreviewHitArea(projection);
        this.refreshShadow();
    }

    refreshShadow() {
        if (!this.previewSprite?.texture) {
            this.destroyPreviewShadow();
            return;
        }
        const shadowConfig = shadowForSprite(this.metadata.shadow, this.previewLayout.normalizedX);
        if (!shadowConfig) {
            this.destroyPreviewShadow();
            return;
        }
        if (!this.previewShadow) {
            this.previewShadow = new CharacterShadow({
                PIXI,
                host: this.previewBackFX,
                charName: 'stage_calibrator_preview',
                debugLog: null,
                debugError
            });
        }
        this.previewShadow.updateTexture(this.previewSprite.texture, shadowConfig, { flipSign: 1 });
        this.previewShadow.syncTransform({ flipSign: 1 });
    }

    destroyPreviewShadow() {
        if (!this.previewShadow) return;
        try { this.previewShadow.destroy(); } catch { }
        this.previewShadow = null;
        this.previewShadowSignature = null;
    }

    resetToDefault() {
        this.corners = cloneCorners(DEFAULT_CORNERS);
        this.metadata = cloneMetadata(DEFAULT_METADATA);
        this.previewLayout = { normalizedX: 0.5, normalizedY: 1 };
        this.syncControlsFromMetadata();
        this.setStatus('Reset to the default stage shape.');
        this.refreshAll();
    }

    syncControlsFromMetadata() {
        const pairs = {
            far: this.metadata.perspective_scale_far,
            near: this.metadata.perspective_scale_nearby,
            'shadow-angle': this.metadata.shadow.angle_degrees,
            'shadow-angle-left': this.metadata.shadow.angle_degrees_left,
            'shadow-angle-right': this.metadata.shadow.angle_degrees_right,
            'shadow-strength': this.metadata.shadow.strength,
            'shadow-length': this.metadata.shadow.length,
            'shadow-blur': this.metadata.shadow.blur,
            'shadow-tint-strength': this.metadata.shadow.tint_strength
        };
        for (const [id, value] of Object.entries(pairs)) {
            const range = this.rootEl?.querySelector(`[data-range="${id}"]`);
            const number = this.rootEl?.querySelector(`[data-number="${id}"]`);
            if (range) range.value = String(value);
            if (number) number.value = String(value);
        }
        const shadowEnabled = this.rootEl?.querySelector('[data-field="shadow-enabled"]');
        if (shadowEnabled) shadowEnabled.checked = this.metadata.shadow.enabled === true;
        this.syncAngleModeVisibility();
        this.syncTintControls();
    }

    async apply() {
        const applyButton = this.rootEl?.querySelector('[data-action="apply"]');
        this.clearSaveFeedbackTimeout();
        if (applyButton) {
            applyButton.disabled = true;
            applyButton.textContent = 'Saving…';
            applyButton.dataset.saveState = 'saving';
        }
        this.setStatus('Saving Spatial Stage sidecar...');
        try {
            const response = await window.socket.emitReceive('spatial-stage:save-sidecar', {
                backgroundPath: this.backgroundPath,
                metadata: this.getDraftMetadata()
            }, 10000);
            if (!response?.success) throw new Error(response?.error || 'Save failed.');

            if (response.metadata) {
                this.metadata = cloneMetadata(response.metadata);
                this.corners = canonicalizeCornersForEditor(response.metadata.corners);
                this.syncControlsFromMetadata();
            }
            this.savedSignature = this.signatureForCurrentDraft();

            pixiSpatialStage.clearBackground(this.backgroundPath, this.projectName);
            pixiSpatialStage.primeBackground(this.backgroundPath, this.projectName);
            window.dispatchEvent(new CustomEvent('spatial-stage:refresh-request', {
                detail: { reason: 'stage-calibrator-save' }
            }));
            this.setStatus(`✓ Stage calibration saved to ${response.sidecarPath || 'its sidecar'}.`, 'success');
            if (applyButton) {
                applyButton.textContent = '✓ Saved';
                applyButton.dataset.saveState = 'saved';
                applyButton.setAttribute('aria-label', 'Stage calibration saved');
            }
            this.refreshAll();
        } catch (error) {
            debugError('[StageCalibrator] Save failed', error);
            this.setStatus(error.message || 'Failed to save sidecar.', 'error');
            if (applyButton) {
                applyButton.textContent = 'Save failed';
                applyButton.dataset.saveState = 'failed';
            }
        } finally {
            if (applyButton) applyButton.disabled = false;
            this.saveFeedbackTimeout = window.setTimeout(() => {
                if (!applyButton?.isConnected) return;
                applyButton.textContent = 'Apply';
                applyButton.dataset.saveState = '';
                applyButton.removeAttribute('aria-label');
                this.saveFeedbackTimeout = null;
            }, 3000);
        }
    }

    clearSaveFeedbackTimeout() {
        if (!this.saveFeedbackTimeout) return;
        window.clearTimeout(this.saveFeedbackTimeout);
        this.saveFeedbackTimeout = null;
    }

    setStatus(message, tone = 'neutral') {
        const status = this.rootEl?.querySelector('[data-role="status"]');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    close() {
        this.destroy();
        if (activeCalibrator === this) activeCalibrator = null;
    }

    destroy() {
        this.clearSaveFeedbackTimeout();
        this.unbindEvents();
        this.destroyPreviewShadow();
        if (this.previewActorLayer?.parent) this.previewActorLayer.parent.removeChild(this.previewActorLayer);
        try { this.previewActorLayer?.destroy({ children: true }); } catch { }
        this.previewActorLayer = null;
        this.previewHitArea = null;
        this.previewRoot = null;
        this.previewBody = null;
        this.previewBackFX = null;
        if (this.layer?.parent) this.layer.parent.removeChild(this.layer);
        try { this.layer?.destroy({ children: true }); } catch { }
        this.layer = null;
        this.rootEl?.remove();
        this.rootEl = null;
        this.restoreRuntimeState();
        removeStyles();
    }
}

export async function openStageCalibrator() {
    if (activeCalibrator) return activeCalibrator;
    const calibrator = new StageCalibrator();
    activeCalibrator = calibrator;
    try {
        await calibrator.open();
        return calibrator;
    } catch (error) {
        activeCalibrator = null;
        calibrator.destroy();
        throw error;
    }
}
