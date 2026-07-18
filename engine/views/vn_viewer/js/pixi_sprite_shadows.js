const DEFAULT_SHADOW_CONFIG = Object.freeze({
    enabled: false,
    angleDegrees: 135,
    opacity: 0.35,
    tintColor: '#000000',
    tintStrength: 0,
    length: 0.85,
    blur: 5,
    alphaThreshold: 24,
    pointSpacing: 3,
    maxSourceSize: 640,
    contactSearchBand: 0.05,
    contactReliefBand: 0.05,
    contactProminence: 10,
    contactFeatherColumns: 12,
    contactFadeHeight: 0.32,
    maxCorrection: 170
});

const SHADOW_ALGORITHM_VERSION = 9;
const maskCache = new WeakMap();

function isObject(value) {
    return !!value && typeof value === 'object';
}

function numberFrom(raw, camelKey, snakeKey, fallback, min = -Infinity, max = Infinity) {
    const value = Number(raw?.[camelKey] ?? raw?.[snakeKey]);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

function numberFromAny(raw, keys, fallback, min = -Infinity, max = Infinity) {
    for (const key of keys) {
        const value = Number(raw?.[key]);
        if (Number.isFinite(value)) return Math.max(min, Math.min(max, value));
    }
    return fallback;
}

function boolFrom(raw, key, fallback = false) {
    if (raw?.[key] === true) return true;
    if (raw?.[key] === false) return false;
    return fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeHexColor(value, fallback = '#000000') {
    const raw = String(value || fallback).trim();
    const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
    return match ? `#${match[1].toLowerCase()}` : fallback;
}

function shadowTintToNumber(tintColor, tintStrength) {
    const amount = clamp(Number(tintStrength) || 0, 0, 1);
    if (amount <= 0) return 0x000000;

    const hex = normalizeHexColor(tintColor, '#000000').slice(1);
    const target = Number.parseInt(hex, 16);
    if (!Number.isFinite(target)) return 0x000000;

    const r = Math.round(((target >> 16) & 0xff) * amount);
    const g = Math.round(((target >> 8) & 0xff) * amount);
    const b = Math.round((target & 0xff) * amount);
    return (r << 16) | (g << 8) | b;
}

function applyShadowDisplayState(displayObject, config) {
    if (!displayObject || !config) return;
    displayObject.alpha = config.opacity;
    displayObject.tint = shadowTintToNumber(config.tintColor, config.tintStrength);
}

function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value >= edge1 ? 1 : 0;
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - (2 * t));
}

function median(values) {
    if (!values.length) return -1;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function configSignature(config, flipSign) {
    return [
        SHADOW_ALGORITHM_VERSION,
        flipSign < 0 ? -1 : 1,
        config.angleDegrees,
        config.length,
        config.blur,
        config.alphaThreshold,
        config.pointSpacing,
        config.maxSourceSize,
        config.contactSearchBand,
        config.contactReliefBand,
        config.contactProminence,
        config.contactFeatherColumns,
        config.contactFadeHeight,
        config.maxCorrection
    ].join('|');
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
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(w, h);
    }
    return null;
}

function releaseCanvas(canvas) {
    if (!canvas) return;
    try {
        const ctx = get2d(canvas);
        if (ctx) ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
    } catch (_error) { }
    try {
        canvas.width = 1;
        canvas.height = 1;
    } catch (_error) { }
}

function deferDispose(fn) {
    if (typeof fn !== 'function') return;
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            try { fn(); } catch (_error) { }
        });
        return;
    }
    setTimeout(() => {
        try { fn(); } catch (_error) { }
    }, 0);
}

function get2d(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
        return canvas.getContext('2d', options);
    } catch (_error) {
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
        if (!candidate) continue;
        if (!isDrawableCandidate(candidate)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        out.push(candidate);
    }

    return out;
}

function getTextureSize(texture) {
    const width = Math.max(1, Math.round(Number(texture?.width || texture?.frame?.width || texture?.orig?.width || 1)));
    const height = Math.max(1, Math.round(Number(texture?.height || texture?.frame?.height || texture?.orig?.height || 1)));
    return { width, height };
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
        } catch (_error) {
            try {
                ctx.clearRect(0, 0, outWidth, outHeight);
                ctx.drawImage(drawable, 0, 0, outWidth, outHeight);
                return true;
            } catch (_fallbackError) { }
        }
    }
    return false;
}

function removeSmallComponents(solid, width, height, solidCount) {
    const total = width * height;
    const visited = new Uint8Array(total);
    const keep = new Uint8Array(total);
    const minPixels = Math.max(8, Math.floor(solidCount * 0.00012));
    const queue = [];
    const component = [];

    for (let i = 0; i < total; i++) {
        if (!solid[i] || visited[i]) continue;
        queue.length = 0;
        component.length = 0;
        queue.push(i);
        visited[i] = 1;

        for (let q = 0; q < queue.length; q++) {
            const idx = queue[q];
            component.push(idx);
            const x = idx % width;
            const y = Math.floor(idx / width);
            const neighbors = [
                x > 0 ? idx - 1 : -1,
                x < width - 1 ? idx + 1 : -1,
                y > 0 ? idx - width : -1,
                y < height - 1 ? idx + width : -1
            ];
            for (const next of neighbors) {
                if (next < 0 || visited[next] || !solid[next]) continue;
                visited[next] = 1;
                queue.push(next);
            }
        }

        if (component.length >= minPixels) {
            for (const idx of component) keep[idx] = 1;
        }
    }

    return keep;
}

function getMask(texture, config) {
    if (!texture) return null;
    let thresholdMap = maskCache.get(texture);
    if (!thresholdMap) {
        thresholdMap = new Map();
        maskCache.set(texture, thresholdMap);
    }

    const threshold = Math.round(config.alphaThreshold);
    const sourceSize = getTextureSize(texture);
    const sourceMax = Math.max(sourceSize.width, sourceSize.height);
    const maxSourceSize = Math.max(128, Math.round(config.maxSourceSize));
    const sourceScale = sourceMax > maxSourceSize ? (maxSourceSize / sourceMax) : 1;
    const width = Math.max(1, Math.round(sourceSize.width * sourceScale));
    const height = Math.max(1, Math.round(sourceSize.height * sourceScale));
    const cacheKey = `${threshold}|${width}x${height}`;
    if (thresholdMap.has(cacheKey)) return thresholdMap.get(cacheKey);

    const canvas = makeCanvas(width, height);
    if (!canvas) return null;
    if (!drawTextureToCanvas(texture, canvas, width, height)) {
        releaseCanvas(canvas);
        return null;
    }

    const ctx = get2d(canvas, { willReadFrequently: true });
    if (!ctx) {
        releaseCanvas(canvas);
        return null;
    }

    let imageData = null;
    try {
        imageData = ctx.getImageData(0, 0, width, height);
    } catch (_error) {
        releaseCanvas(canvas);
        return null;
    }

    const raw = imageData.data;
    let solid = new Uint8Array(width * height);
    let solidCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (raw[(idx * 4) + 3] <= threshold) continue;
            solid[idx] = 1;
            solidCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    imageData = null;
    releaseCanvas(canvas);

    if (solidCount <= 0) return null;
    solid = removeSmallComponents(solid, width, height, solidCount);

    solidCount = 0;
    minX = width;
    minY = height;
    maxX = -1;
    maxY = -1;
    for (let idx = 0; idx < solid.length; idx++) {
        if (!solid[idx]) continue;
        const x = idx % width;
        const y = Math.floor(idx / width);
        solidCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    if (solidCount <= 0) return null;

    const mask = {
        width,
        height,
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
        sourceScale,
        solid,
        solidCount,
        bbox: { minX, minY, maxX, maxY }
    };
    thresholdMap.set(cacheKey, mask);
    return mask;
}

function isSolid(mask, x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) return false;
    return mask.solid[(iy * mask.width) + ix] === 1;
}

function extractLowerEnvelope(mask, spacing) {
    const columnCount = Math.max(1, Math.ceil(mask.width / spacing));
    const columns = [];
    let baselineY = -1;

    for (let column = 0; column < columnCount; column++) {
        const x0 = Math.max(0, Math.floor(column * spacing));
        const x1 = Math.min(mask.width - 1, Math.ceil(((column + 1) * spacing) - 1));
        let bottomY = -1;
        for (let x = x0; x <= x1; x++) {
            for (let y = mask.bbox.maxY; y >= mask.bbox.minY; y--) {
                if (!isSolid(mask, x, y)) continue;
                if (y > bottomY) bottomY = y;
                break;
            }
        }
        if (bottomY > baselineY) baselineY = bottomY;
        columns.push({ column, x: x0 + ((x1 - x0) / 2), bottomY, smoothBottomY: bottomY });
    }

    const radius = 2;
    for (let i = 0; i < columns.length; i++) {
        const values = [];
        for (let j = Math.max(0, i - radius); j <= Math.min(columns.length - 1, i + radius); j++) {
            if (columns[j].bottomY >= 0) values.push(columns[j].bottomY);
        }
        columns[i].smoothBottomY = median(values);
    }

    return { columns, baselineY };
}

function findContactRegions(envelope, mask, config, spacing) {
    const { columns, baselineY } = envelope;
    if (baselineY < 0) return { baselineY: mask.bbox.maxY, regions: [], supportColumns: [] };

    const searchBandPx = Math.max(6, mask.height * config.contactSearchBand);
    const maxRegionColumns = Math.max(8, Math.floor(columns.length * 0.18));
    const baselineColumns = columns.filter((entry) => {
        return entry.smoothBottomY >= 0 && entry.smoothBottomY >= baselineY - searchBandPx;
    });
    const lowerReliefTop = mask.bbox.minY + ((mask.bbox.maxY - mask.bbox.minY) * (1 - config.contactReliefBand));
    const reliefColumns = columns.filter((entry) => {
        return entry.bottomY >= 0 && entry.bottomY >= lowerReliefTop;
    });
    const supportColumnMap = new Map();
    for (const entry of baselineColumns) supportColumnMap.set(entry.column, entry);
    for (const entry of reliefColumns) supportColumnMap.set(entry.column, entry);
    const candidateColumns = Array.from(supportColumnMap.values())
        .sort((a, b) => a.column - b.column);

    const groups = [];
    let current = [];
    for (const entry of candidateColumns) {
        const previous = current[current.length - 1];
        if (!previous || entry.column <= previous.column + 1) {
            current.push(entry);
        } else {
            if (current.length) groups.push(current);
            current = [entry];
        }
    }
    if (current.length) groups.push(current);

    const regions = [];
    for (const group of groups) {
        const peakY = Math.max(...group.map(entry => entry.smoothBottomY));
        const contactAllowance = Math.max(
            config.contactProminence,
            config.contactProminence * 3,
            mask.height * 0.07
        );
        const active = group.filter(entry => entry.smoothBottomY >= peakY - contactAllowance);
        if (!active.length) continue;
        const start = active[0].column;
        const end = active[active.length - 1].column;
        const widthColumns = end - start + 1;
        if (widthColumns > maxRegionColumns) continue;
        if (widthColumns * spacing > mask.width * 0.28) continue;
        regions.push({
            start,
            end,
            peakY,
            peakColumn: active.reduce((best, entry) => entry.smoothBottomY > best.smoothBottomY ? entry : best, active[0]).column,
            columns: group
        });
    }

    regions.sort((a, b) => b.peakY - a.peakY || (a.end - a.start) - (b.end - b.start));
    return { baselineY, regions: regions.slice(0, 4), supportColumns: candidateColumns };
}

function directionFromDegrees(angleDegrees, flipSign) {
    const radians = (angleDegrees * Math.PI) / 180;
    const screenX = Math.cos(radians);
    const screenY = Math.sin(radians);
    const sign = flipSign < 0 ? -1 : 1;
    return { x: screenX * sign, y: screenY };
}

function clampVector(vector, maxLength) {
    const length = Math.hypot(vector.x, vector.y);
    if (!Number.isFinite(length) || length <= maxLength || length === 0) return vector;
    const scale = maxLength / length;
    return { x: vector.x * scale, y: vector.y * scale };
}

function buildCorrections(contact, config, dir) {
    const corrections = [];
    const columnMap = new Map();
    for (const entry of Array.isArray(contact.supportColumns) ? contact.supportColumns : []) {
        columnMap.set(entry.column, entry);
    }
    for (const region of contact.regions || []) {
        for (const entry of region.columns || []) {
            columnMap.set(entry.column, entry);
        }
    }

    for (const entry of columnMap.values()) {
        const contactY = Number.isFinite(entry.bottomY) && entry.bottomY >= 0
            ? entry.bottomY
            : entry.smoothBottomY;
        const contactHeight = Math.max(0, contact.baselineY - contactY);
        const projectedContactX = entry.x + (dir.x * contactHeight * config.length);
        const projectedContactY = contact.baselineY + (dir.y * contactHeight * config.length);
        const gap = clampVector({
            x: -dir.x * contactHeight * config.length,
            y: contactY - projectedContactY
        }, config.maxCorrection);
        const bridge = clampVector({
            x: projectedContactX - entry.x,
            y: projectedContactY - contactY
        }, config.maxCorrection);
        corrections.push({
            column: entry.column,
            contactHeight,
            contactX: entry.x,
            contactY,
            bridgeEndX: entry.x + bridge.x,
            bridgeEndY: contactY + bridge.y,
            gapX: gap.x,
            gapY: gap.y
        });
    }
    return corrections;
}

function nearestCorrection(column, corrections, featherColumns) {
    let best = null;
    let bestDistance = Infinity;
    for (const correction of corrections) {
        const distance = Math.abs(column - correction.column);
        if (distance > featherColumns || distance >= bestDistance) continue;
        best = correction;
        bestDistance = distance;
    }
    if (!best) return null;
    return { correction: best, distance: bestDistance };
}

function sampleSolidCells(mask, spacing) {
    const points = [];
    const { minX, minY, maxX, maxY } = mask.bbox;
    for (let y0 = minY; y0 <= maxY; y0 += spacing) {
        for (let x0 = minX; x0 <= maxX; x0 += spacing) {
            let count = 0;
            let sumX = 0;
            let sumY = 0;
            const xEnd = Math.min(maxX, x0 + spacing - 1);
            const yEnd = Math.min(maxY, y0 + spacing - 1);
            for (let y = y0; y <= yEnd; y++) {
                for (let x = x0; x <= xEnd; x++) {
                    if (!isSolid(mask, x, y)) continue;
                    count++;
                    sumX += x;
                    sumY += y;
                }
            }
            if (!count) continue;
            points.push({
                x: sumX / count,
                y: sumY / count,
                sourceColumn: Math.floor(x0 / spacing)
            });
        }
    }
    return points;
}

function buildWarpedPoints(mask, config, flipSign) {
    const spacing = Math.max(1, Math.round(config.pointSpacing));
    const envelope = extractLowerEnvelope(mask, spacing);
    const contact = findContactRegions(envelope, mask, config, spacing);
    const dir = directionFromDegrees(config.angleDegrees, flipSign);
    const corrections = buildCorrections(contact, config, dir);
    const sourcePoints = sampleSolidCells(mask, spacing);
    const fadeHeight = Math.max(1, mask.height * config.contactFadeHeight);
    const featherColumns = Math.max(0, config.contactFeatherColumns);
    const points = [];

    for (const point of sourcePoints) {
        const sourceHeight = Math.max(0, contact.baselineY - point.y);
        let x = point.x + (dir.x * sourceHeight * config.length);
        let y = contact.baselineY + (dir.y * sourceHeight * config.length);
        const match = featherColumns > 0 ? nearestCorrection(point.sourceColumn, corrections, featherColumns) : null;

        if (match) {
            const { correction, distance } = match;
            const aboveContact = Math.max(0, sourceHeight - correction.contactHeight);
            const verticalWeight = 1 - smoothstep(0, 1, aboveContact / fadeHeight);
            const sideWeight = 1 - smoothstep(0, 1, distance / Math.max(1, featherColumns));
            const weight = verticalWeight * sideWeight;
            x += correction.gapX * weight;
            y += correction.gapY * weight;
        }

        points.push({ x, y });
    }

    return {
        points,
        spacing,
        bridges: corrections
            .filter((correction) => {
                return Math.hypot(
                    correction.bridgeEndX - correction.contactX,
                    correction.bridgeEndY - correction.contactY
                ) >= spacing;
            })
            .map((correction) => ({
                x1: correction.contactX,
                y1: correction.contactY,
                x2: correction.bridgeEndX,
                y2: correction.bridgeEndY
            }))
    };
}

function rasterizeShadow(mask, warped, config) {
    const { points, spacing } = warped;
    if (!points.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
    }
    if (Array.isArray(warped.bridges)) {
        for (const bridge of warped.bridges) {
            minX = Math.min(minX, bridge.x1, bridge.x2);
            minY = Math.min(minY, bridge.y1, bridge.y2);
            maxX = Math.max(maxX, bridge.x1, bridge.x2);
            maxY = Math.max(maxY, bridge.y1, bridge.y2);
        }
    }

    const blur = Math.max(0, Number(config.blur) || 0);
    const bridgeLineWidth = Math.max(1.25, spacing * 1.35);
    const padding = Math.ceil(blur * 2 + spacing * 3 + bridgeLineWidth + 4);
    const width = Math.max(1, Math.ceil(maxX - minX + (padding * 2)));
    const height = Math.max(1, Math.ceil(maxY - minY + (padding * 2)));
    const maskCanvas = makeCanvas(width, height);
    const maskCtx = get2d(maskCanvas);
    if (!maskCanvas || !maskCtx) return null;

    maskCtx.clearRect(0, 0, width, height);
    // Keep the raster as a white alpha matte so Pixi tint can recolor it.
    // The display object still tints to black by default, preserving old shadows.
    maskCtx.fillStyle = '#fff';
    const drawSize = Math.max(1, spacing + 1);
    const half = drawSize / 2;
    for (const point of points) {
        maskCtx.fillRect(
            (point.x - minX) + padding - half,
            (point.y - minY) + padding - half,
            drawSize,
            drawSize
        );
    }
    if (Array.isArray(warped.bridges) && warped.bridges.length > 0) {
        maskCtx.strokeStyle = '#fff';
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.lineWidth = bridgeLineWidth;
        for (const bridge of warped.bridges) {
            maskCtx.beginPath();
            maskCtx.moveTo((bridge.x1 - minX) + padding, (bridge.y1 - minY) + padding);
            maskCtx.lineTo((bridge.x2 - minX) + padding, (bridge.y2 - minY) + padding);
            maskCtx.stroke();
        }
    }

    const outCanvas = makeCanvas(width, height);
    const outCtx = get2d(outCanvas);
    if (!outCanvas || !outCtx) {
        releaseCanvas(maskCanvas);
        return null;
    }

    outCtx.clearRect(0, 0, width, height);
    outCtx.globalAlpha = 1;
    if (blur > 0 && 'filter' in outCtx) {
        outCtx.filter = `blur(${blur}px)`;
    }
    outCtx.drawImage(maskCanvas, 0, 0);
    if ('filter' in outCtx) outCtx.filter = 'none';
    releaseCanvas(maskCanvas);

    return {
        canvas: outCanvas,
        offsetX: minX - padding - (mask.width / 2),
        offsetY: minY - padding - mask.height,
        sourceScale: mask.sourceScale || 1
    };
}

function buildShadowRender(texture, config, flipSign) {
    const mask = getMask(texture, config);
    if (!mask) return null;
    const warped = buildWarpedPoints(mask, config, flipSign);
    return rasterizeShadow(mask, warped, config);
}

function resolveShadowDefaults(rawDefaults) {
    if (!isObject(rawDefaults)) return DEFAULT_SHADOW_CONFIG;
    return {
        ...DEFAULT_SHADOW_CONFIG,
        angleDegrees: numberFrom(rawDefaults, 'angleDegrees', 'angle_degrees', DEFAULT_SHADOW_CONFIG.angleDegrees, -3600, 3600),
        opacity: numberFromAny(rawDefaults, ['opacity', 'strength', 'alpha'], DEFAULT_SHADOW_CONFIG.opacity, 0, 1),
        tintColor: normalizeHexColor(rawDefaults.tintColor ?? rawDefaults.tint_color, DEFAULT_SHADOW_CONFIG.tintColor),
        tintStrength: numberFromAny(rawDefaults, ['tintStrength', 'tint_strength'], DEFAULT_SHADOW_CONFIG.tintStrength, 0, 1),
        length: numberFrom(rawDefaults, 'length', 'length', DEFAULT_SHADOW_CONFIG.length, 0, 4),
        blur: numberFrom(rawDefaults, 'blur', 'blur', DEFAULT_SHADOW_CONFIG.blur, 0, 40),
        alphaThreshold: numberFrom(rawDefaults, 'alphaThreshold', 'alpha_threshold', DEFAULT_SHADOW_CONFIG.alphaThreshold, 0, 254),
        pointSpacing: numberFrom(rawDefaults, 'pointSpacing', 'point_spacing', DEFAULT_SHADOW_CONFIG.pointSpacing, 1, 8),
        maxSourceSize: numberFrom(rawDefaults, 'maxSourceSize', 'max_source_size', DEFAULT_SHADOW_CONFIG.maxSourceSize, 128, 2048),
        contactSearchBand: numberFrom(rawDefaults, 'contactSearchBand', 'contact_search_band', DEFAULT_SHADOW_CONFIG.contactSearchBand, 0.02, 0.6),
        contactReliefBand: numberFrom(rawDefaults, 'contactReliefBand', 'contact_relief_band', DEFAULT_SHADOW_CONFIG.contactReliefBand, 0.02, 0.6),
        contactProminence: numberFrom(rawDefaults, 'contactProminence', 'contact_prominence', DEFAULT_SHADOW_CONFIG.contactProminence, 0, 80),
        contactFeatherColumns: numberFrom(rawDefaults, 'contactFeatherColumns', 'contact_feather_columns', DEFAULT_SHADOW_CONFIG.contactFeatherColumns, 0, 80),
        contactFadeHeight: numberFrom(rawDefaults, 'contactFadeHeight', 'contact_fade_height', DEFAULT_SHADOW_CONFIG.contactFadeHeight, 0.02, 1.2),
        maxCorrection: numberFrom(rawDefaults, 'maxCorrection', 'max_correction', DEFAULT_SHADOW_CONFIG.maxCorrection, 0, 600)
    };
}

export function normalizeSpriteShadowConfig(raw, rawDefaults = null) {
    if (!isObject(raw)) return null;
    const enabled = boolFrom(raw, 'enabled', false);
    if (!enabled) return null;
    const defaults = resolveShadowDefaults(rawDefaults);
    const rawTintStrength = numberFromAny(raw, ['tintStrength', 'tint_strength'], defaults.tintStrength, 0, 1);
    const explicitTintEnabled = raw.tintEnabled ?? raw.tint_enabled;
    const tintEnabled = explicitTintEnabled === undefined ? rawTintStrength > 0 : explicitTintEnabled === true;

    return {
        ...defaults,
        enabled: true,
        angleDegrees: numberFrom(raw, 'angleDegrees', 'angle_degrees', defaults.angleDegrees, -3600, 3600),
        opacity: numberFromAny(raw, ['opacity', 'strength', 'alpha'], defaults.opacity, 0, 1),
        tintColor: normalizeHexColor(raw.tintColor ?? raw.tint_color, defaults.tintColor),
        tintStrength: tintEnabled ? rawTintStrength : 0,
        length: numberFrom(raw, 'length', 'length', defaults.length, 0, 4),
        blur: numberFrom(raw, 'blur', 'blur', defaults.blur, 0, 40),
        alphaThreshold: defaults.alphaThreshold,
        pointSpacing: defaults.pointSpacing,
        maxSourceSize: defaults.maxSourceSize,
        contactSearchBand: defaults.contactSearchBand,
        contactReliefBand: defaults.contactReliefBand,
        contactProminence: defaults.contactProminence,
        contactFeatherColumns: defaults.contactFeatherColumns,
        contactFadeHeight: defaults.contactFadeHeight,
        maxCorrection: defaults.maxCorrection
    };
}

export class CharacterShadow {
    constructor({ PIXI: pixiNamespace = null, host = null, charName = 'actor', debugLog = null, debugError = null } = {}) {
        this.PIXI = pixiNamespace || (typeof window !== 'undefined' ? window.PIXI : null);
        this.host = host;
        this.charName = charName;
        this.debugLog = debugLog;
        this.debugError = debugError;
        this.displayObject = null;
        this.texture = null;
        this.canvas = null;
        this.sourceTexture = null;
        this.config = null;
        this.flipSign = 1;
        this.signature = '';
    }

    _detachDisplayObject() {
        const display = this.displayObject;
        if (!display || display.destroyed) return;
        try { display.renderable = false; } catch (_error) { }
        try { display.visible = false; } catch (_error) { }
        try { display.filters = null; } catch (_error) { }
        try { display.mask = null; } catch (_error) { }
        if (this.PIXI?.Texture?.EMPTY) {
            try { display.texture = this.PIXI.Texture.EMPTY; } catch (_error) { }
        }
        try {
            if (display.parent) display.parent.removeChild(display);
        } catch (_error) { }
    }

    updateTexture(texture, rawConfig, options = {}) {
        const config = normalizeSpriteShadowConfig(rawConfig);
        if (!config || !texture || !this.PIXI?.Texture || !this.PIXI?.Sprite) {
            this.destroy();
            return false;
        }

        const flipSign = Number(options.flipSign) < 0 ? -1 : 1;
        const signature = configSignature(config, flipSign);
        if (this.sourceTexture === texture && this.signature === signature && this.displayObject && !this.displayObject.destroyed) {
            applyShadowDisplayState(this.displayObject, config);
            this.config = config;
            return true;
        }

        const render = buildShadowRender(texture, config, flipSign);
        if (!render?.canvas) {
            this.destroy();
            return false;
        }

        let nextTexture = null;
        try {
            nextTexture = this.PIXI.Texture.from(render.canvas);
        } catch (error) {
            releaseCanvas(render.canvas);
            throw error;
        }
        const oldTexture = this.texture;
        const oldCanvas = this.canvas;
        if (!this.displayObject || this.displayObject.destroyed) {
            this.displayObject = new this.PIXI.Sprite(nextTexture);
            this.displayObject.label = `sprite-contact-shadow:${this.charName}`;
            this.displayObject.eventMode = 'none';
            if (this.displayObject.anchor) this.displayObject.anchor.set(0, 0);
        } else {
            this.displayObject.texture = nextTexture;
        }

        const renderScale = Math.max(0.001, Number(render.sourceScale) || 1);
        this.displayObject.position.set(render.offsetX / renderScale, render.offsetY / renderScale);
        this.displayObject.scale.set(1 / renderScale, 1 / renderScale);
        applyShadowDisplayState(this.displayObject, config);
        this.displayObject.visible = true;

        if (this.host && this.displayObject.parent !== this.host) {
            this.host.addChildAt(this.displayObject, 0);
        } else if (this.host && this.host.children?.[0] !== this.displayObject) {
            try { this.host.setChildIndex(this.displayObject, 0); } catch (_error) { }
        }

        this.texture = nextTexture;
        this.canvas = render.canvas;
        this.sourceTexture = texture;
        this.config = config;
        this.flipSign = flipSign;
        this.signature = signature;

        if (oldTexture && oldTexture !== nextTexture) {
            deferDispose(() => {
                try { oldTexture.destroy(true); } catch (_error) { }
                releaseCanvas(oldCanvas);
            });
        }
        return true;
    }

    syncTransform(options = {}) {
        const flipSign = Number(options.flipSign) < 0 ? -1 : 1;
        if (!this.sourceTexture || !this.config) return false;
        if (flipSign === this.flipSign) return true;
        return this.updateTexture(this.sourceTexture, this.config, { flipSign });
    }

    destroy() {
        const oldDisplay = this.displayObject;
        const oldTexture = this.texture;
        const oldCanvas = this.canvas;
        this._detachDisplayObject();
        this.displayObject = null;
        this.texture = null;
        this.canvas = null;
        this.sourceTexture = null;
        this.config = null;
        this.signature = '';

        deferDispose(() => {
            if (oldDisplay && !oldDisplay.destroyed) {
                try { oldDisplay.destroy({ children: true }); } catch (_error) { }
            }
            if (oldTexture && !oldTexture.destroyed) {
                try { oldTexture.destroy(true); } catch (_error) { }
            }
            releaseCanvas(oldCanvas);
        });
    }
}
