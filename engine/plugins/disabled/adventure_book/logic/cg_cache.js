const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toStringSafe } = require('./text_utils.js');

const cgMemoryCache = new Map();

function toPosix(value) {
    return String(value || '').replace(/\\/g, '/');
}

function normalizeProjectAssetPath(rawPath) {
    let text = toPosix(String(rawPath || '').replace(/^file:\/\/\/?/i, '')).trim();
    if (!text) return '';
    if (/^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(text)) return text;

    const lowerText = text.toLowerCase();
    const projectMarker = '/workspace/projects/';
    const markerIndex = lowerText.lastIndexOf(projectMarker);
    if (markerIndex !== -1) {
        const tail = text.slice(markerIndex + projectMarker.length);
        const segments = tail.split('/').filter(Boolean);
        if (segments.length >= 2) text = segments.slice(1).join('/');
    } else {
        const pluginsIndex = lowerText.lastIndexOf('/plugins/');
        const assetsIndex = lowerText.lastIndexOf('/assets/');
        if (pluginsIndex !== -1) text = text.slice(pluginsIndex + 1);
        else if (assetsIndex !== -1) text = text.slice(assetsIndex + 1);
    }

    if (text.startsWith('assets/') || text.startsWith('plugins/')) return text;
    return text.replace(/^\/+/, '');
}

function isGenericSpritePath(spritePath) {
    const lower = String(spritePath || '').replace(/\\/g, '/').toLowerCase();
    const filename = lower.split('/').pop() || lower;
    return /\bgeneric\b/.test(filename) || /\bnpc\b/.test(filename);
}

function toProjectAssetPath(rawPath) {
    const normalized = normalizeProjectAssetPath(rawPath);
    if (!normalized || /^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(normalized)) return normalized;
    return `project://${normalized}`;
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashCgPromptRequest(request = {}) {
    const payload = {
        prompt: toStringSafe(request.prompt || request.text, ''),
        modelTier: toStringSafe(request.modelTier, ''),
        aspectRatio: toStringSafe(request.aspectRatio || request.aspect_ratio, ''),
        imageResolution: toStringSafe(request.imageResolution || request.resolution || request.size || request.imageSizeOverride, ''),
        references: Array.isArray(request.references)
            ? request.references.map(ref => ({
                name: toStringSafe(ref?.name, ''),
                path: toStringSafe(ref?.path, '')
            }))
            : []
    };
    return crypto.createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 24);
}

function readCgCacheManifest(storage) {
    if (!storage?.absolutePath) return {};
    const cachePath = path.join(storage.absolutePath, 'cg_cache.json');
    try {
        if (!fs.existsSync(cachePath)) return {};
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeCgCacheManifest(storage, manifest) {
    if (!storage?.absolutePath) return;
    try {
        fs.mkdirSync(storage.absolutePath, { recursive: true });
        fs.writeFileSync(path.join(storage.absolutePath, 'cg_cache.json'), JSON.stringify(manifest || {}, null, 2), 'utf8');
    } catch (_) {}
}

function resolveCacheAbsolutePath(storage, relativePath) {
    if (!storage?.absolutePath || !storage?.relativePath || !relativePath) return '';
    const storageRel = toPosix(storage.relativePath).replace(/\/+$/, '');
    const cleanRel = toPosix(relativePath).replace(/^project:\/\//, '');
    if (!cleanRel.startsWith(`${storageRel}/`)) return '';
    const tail = cleanRel.slice(storageRel.length + 1);
    return path.join(storage.absolutePath, tail);
}

function getCachedCgImagePath(storage, requestHash) {
    const memory = cgMemoryCache.get(requestHash);
    if (memory?.relativePath) {
        const absolutePath = memory.absolutePath || resolveCacheAbsolutePath(storage, memory.relativePath);
        if (!absolutePath || fs.existsSync(absolutePath)) return memory.relativePath;
    }

    const manifest = readCgCacheManifest(storage);
    const entry = manifest[requestHash];
    if (!entry?.relativePath) return '';
    const absolutePath = resolveCacheAbsolutePath(storage, entry.relativePath);
    if (absolutePath && !fs.existsSync(absolutePath)) return '';
    cgMemoryCache.set(requestHash, { relativePath: entry.relativePath, absolutePath });
    return entry.relativePath;
}

function rememberCachedCgImagePath(storage, requestHash, relativePath) {
    if (!requestHash || !relativePath) return;
    const absolutePath = resolveCacheAbsolutePath(storage, relativePath);
    cgMemoryCache.set(requestHash, { relativePath, absolutePath });
    const manifest = readCgCacheManifest(storage);
    manifest[requestHash] = {
        relativePath,
        updatedAt: new Date().toISOString()
    };
    writeCgCacheManifest(storage, manifest);
}

module.exports = {
    toPosix,
    normalizeProjectAssetPath,
    isGenericSpritePath,
    toProjectAssetPath,
    stableJson,
    hashCgPromptRequest,
    getCachedCgImagePath,
    rememberCachedCgImagePath
};
