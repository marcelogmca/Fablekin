const fs = require('fs/promises');
const path = require('path');

let sharp = null;
try {
    sharp = require('sharp');
} catch (_) {
    sharp = null;
}

const DEFAULT_PALETTE_SIZE = 5;
const DEFAULT_SAMPLE_SIZE = 80;

function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}

function toHexChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0');
}

function rgbToHex(rgb) {
    return `#${toHexChannel(rgb[0])}${toHexChannel(rgb[1])}${toHexChannel(rgb[2])}`;
}

function normalizeRgb(rgb) {
    if (!Array.isArray(rgb)) return null;
    const values = rgb.slice(0, 3).map(value => Number(value));
    if (values.some(value => !Number.isFinite(value))) return null;
    return values.map(value => clamp01(value > 1 ? value / 255 : value));
}

function colorDistance(left, right) {
    const dr = left[0] - right[0];
    const dg = left[1] - right[1];
    const db = left[2] - right[2];
    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function getSaturation(rgb255) {
    const r = rgb255[0] / 255;
    const g = rgb255[1] / 255;
    const b = rgb255[2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const lightness = (max + min) / 2;
    return (max - min) / (1 - Math.abs((2 * lightness) - 1));
}

function quantizeChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value / 32) * 32));
}

function rankBuckets(buckets, totalPixels) {
    return Array.from(buckets.values())
        .map(bucket => {
            const rgb255 = [
                bucket.r / bucket.count,
                bucket.g / bucket.count,
                bucket.b / bucket.count
            ];
            const saturation = getSaturation(rgb255);
            const weight = bucket.count / Math.max(1, totalPixels);
            return {
                rgb255,
                weight,
                score: bucket.count * (0.65 + (saturation * 0.35))
            };
        })
        .sort((left, right) => right.score - left.score);
}

function selectDistinctColors(ranked, paletteSize) {
    const selected = [];
    for (const minDistance of [72, 48, 28, 0]) {
        for (const candidate of ranked) {
            if (selected.length >= paletteSize) break;
            if (selected.some(color => color.hex === rgbToHex(candidate.rgb255))) continue;
            const distinct = selected.every(color => colorDistance(color.rgb255, candidate.rgb255) >= minDistance);
            if (!distinct) continue;
            selected.push({
                hex: rgbToHex(candidate.rgb255),
                rgb: candidate.rgb255.map(value => clamp01(value / 255)),
                rgb255: candidate.rgb255,
                weight: Number(candidate.weight.toFixed(4))
            });
        }
        if (selected.length >= paletteSize) break;
    }
    return selected.slice(0, paletteSize).map((color) => {
        const normalizedColor = { ...color };
        delete normalizedColor.rgb255;
        return normalizedColor;
    });
}

function normalizePaletteColors(colors, paletteSize = DEFAULT_PALETTE_SIZE) {
    const normalized = [];
    for (const color of Array.isArray(colors) ? colors : []) {
        const rgb = normalizeRgb(color?.rgb);
        if (!rgb) continue;
        normalized.push({
            hex: color?.hex && /^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex.toLowerCase() : rgbToHex(rgb.map(value => value * 255)),
            rgb,
            weight: Number.isFinite(Number(color?.weight)) ? Number(color.weight) : 0
        });
        if (normalized.length >= paletteSize) break;
    }
    return normalized;
}

async function extractProminentColorsFromImage(input, options = {}) {
    if (!sharp) return [];
    const paletteSize = Math.max(1, Math.min(12, Number(options.paletteSize) || DEFAULT_PALETTE_SIZE));
    const sampleSize = Math.max(16, Math.min(256, Number(options.sampleSize) || DEFAULT_SAMPLE_SIZE));
    if (!input) return [];

    const { data, info } = await sharp(input)
        .rotate()
        .resize(sampleSize, sampleSize, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const channels = info.channels || 4;
    const buckets = new Map();
    let totalPixels = 0;
    for (let offset = 0; offset + channels - 1 < data.length; offset += channels) {
        const alpha = channels >= 4 ? data[offset + 3] : 255;
        if (alpha < 32) continue;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const key = `${quantizeChannel(r)},${quantizeChannel(g)},${quantizeChannel(b)}`;
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
        totalPixels += 1;
    }

    if (totalPixels === 0 || buckets.size === 0) return [];
    return selectDistinctColors(rankBuckets(buckets, totalPixels), paletteSize);
}

async function extractProminentColorsFromFile(filePath, options = {}) {
    if (!filePath || /^https?:|^data:|^blob:/i.test(String(filePath))) return [];
    const absolutePath = path.resolve(String(filePath));
    await fs.access(absolutePath);
    return extractProminentColorsFromImage(absolutePath, options);
}

function hasSharp() {
    return !!sharp;
}

module.exports = {
    DEFAULT_PALETTE_SIZE,
    DEFAULT_SAMPLE_SIZE,
    extractProminentColorsFromFile,
    extractProminentColorsFromImage,
    normalizePaletteColors,
    hasSharp,
    _private: {
        rgbToHex,
        normalizeRgb,
        colorDistance,
        getSaturation,
        rankBuckets,
        selectDistinctColors
    }
};
