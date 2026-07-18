// plugins/cg_generator/providers.js

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_NANO_GPT_TIMEOUT_MS = 240000;
const DEFAULT_NANO_GPT_ATTEMPTS_PER_SIZE = 2;
const DEFAULT_RETRY_DELAY_MS = 2500;
const CATALOG_TIMEOUT_MS = 15000;
const NANO_GPT_IMAGE_MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TARGET_WIDESCREEN_RATIO = 16 / 9;
const DEFAULT_ASPECT_RATIO = '16:9';
const NANO_GPT_SIZE_CANDIDATES = [
    '4k',
    '2k',
    '1k',
    '2048x1152',
    '1920x1080',
    '1792x1024',
    '1664x936',
    '1600x900',
    '1536x864',
    '1365x768',
    '1280x720',
    '1024x576',
    '1536x1024',
    '1024x1024'
];
const OPENROUTER_IMAGE_SIZE_CANDIDATES = ['4K', '2K', '1K'];
const SYMBOLIC_RESOLUTION_RANKS = {
    '0.5k': 0.5,
    '1k': 1,
    '2k': 2,
    '4k': 4,
    '8k': 8
};
const SYMBOLIC_RESOLUTION_TARGET_AREAS = {
    '0.5k': 512 * 288,
    '1k': 1024 * 576,
    '2k': 2048 * 1152,
    '4k': 3840 * 2160,
    '8k': 7680 * 4320
};

let nanoGptImageModelsCache = {
    fetchedAt: 0,
    data: null,
    promise: null
};

function getPluginSettings(tools) {
    return tools?.settings?.getSelf?.() || {};
}

function simplifyProviderId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

const PROVIDER_ALIASES = {
    wisgate: 'wisgate',
    wisgatemirror: 'wisgate',
    wisdomgate: 'wisgate',
    wisdomgatemirror: 'wisgate',
    google: 'google',
    googlegemini: 'google',
    googlegeminidirect: 'google',
    googledirect: 'google',
    gemini: 'google',
    openrouter: 'openrouter',
    nanogpt: 'nanogpt',
    nanogptopenaicompatible: 'nanogpt',
    nano: 'nanogpt',
    openai: 'openai',
    openaiimages: 'openai',
    openaiimagesapi: 'openai',
    replicate: 'replicate',
    replicatepredictions: 'replicate',
    replicatepredictionsapi: 'replicate',
    fal: 'fal',
    falqueue: 'fal',
    falqueueapi: 'fal',
    comfyui: 'comfyui',
    comfyuiworkflow: 'comfyui',
    comfyuiworkflowapi: 'comfyui'
};
const MODEL_TIER_ALIASES = {
    expensive: 'expensive',
    premium: 'expensive',
    high: 'expensive',
    highend: 'expensive',
    best: 'expensive',
    medium: 'medium',
    mid: 'medium',
    default: 'medium',
    normal: 'medium',
    balanced: 'medium',
    budget: 'budget',
    cheap: 'budget',
    low: 'budget',
    economy: 'budget',
    economical: 'budget',
    fast: 'budget'
};

function normalizeProviderId(value, fallback = 'wisgate') {
    const simplified = simplifyProviderId(value);
    if (!simplified) return fallback;
    return PROVIDER_ALIASES[simplified] || simplified;
}

function getProviderId(tools, overrides = {}) {
    if (overrides.provider) return normalizeProviderId(overrides.provider);
    const settings = getPluginSettings(tools);
    return normalizeProviderId(settings.imageProvider);
}

function normalizeModelTier(value, fallback = 'expensive') {
    const normalized = String(value || '').trim().toLowerCase();
    return MODEL_TIER_ALIASES[normalized] || fallback;
}

function getRequestedModelTier(settings = {}, overrides = {}) {
    const explicit = overrides.modelTier || overrides.tier || overrides.qualityTier;
    if (explicit) return normalizeModelTier(explicit);
    return normalizeModelTier(settings.preferredModelTier || 'expensive');
}

function getConfiguredTierModel(settings = {}, tier = 'expensive') {
    const tierModel = {
        expensive: String(settings.expensiveModel || '').trim(),
        medium: String(settings.mediumModel || '').trim(),
        budget: String(settings.budgetModel || '').trim()
    };
    return tierModel[tier] || '';
}

function getProviderDefaultModel(providerId) {
    const defaults = {
        wisgate: 'gemini-3-pro-image-preview',
        google: 'gemini-3-pro-image-preview',
        openrouter: 'google/gemini-3-pro-image-preview',
        nanogpt: 'hidream',
        openai: 'gpt-image-1',
        replicate: '',
        fal: 'fal-ai/flux/schnell',
        comfyui: 'workflow'
    };
    return defaults[providerId] || '';
}

function getTierFallbackOrder(requestedTier = 'expensive') {
    if (requestedTier === 'budget') return ['budget', 'medium', 'expensive'];
    if (requestedTier === 'medium') return ['medium', 'expensive', 'budget'];
    return ['expensive', 'medium', 'budget'];
}

function parseNonNegativeNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function parsePositiveInteger(value, fallback = 0, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

function getProviderTimeoutMs(settings = {}, overrides = {}, fallback = DEFAULT_TIMEOUT_MS) {
    return parsePositiveInteger(
        overrides.timeoutMs ?? settings.providerTimeoutMs ?? settings.nanoGptTimeoutMs,
        fallback,
        { min: 30000, max: 1800000 }
    );
}

function getProviderAttemptsPerResolution(settings = {}, overrides = {}, fallback = 2) {
    return parsePositiveInteger(
        overrides.attemptsPerResolution ?? overrides.attemptsPerSize ?? settings.providerAttemptsPerResolution ?? settings.nanoGptAttemptsPerSize,
        fallback,
        { min: 1, max: 5 }
    );
}

function collectErrorSignals(error) {
    const signals = [];
    const seen = new Set();
    let current = error;

    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        for (const key of ['name', 'message', 'code', 'type']) {
            if (current[key]) signals.push(String(current[key]));
        }
        current = current.cause;
    }

    return signals.join(' ').toLowerCase();
}

function isTimeoutLikeError(error) {
    const signal = collectErrorSignals(error);
    return (
        signal.includes('timeout')
        || signal.includes('aborted due to timeout')
        || signal.includes('timed out')
    );
}

function isTransientFetchError(error) {
    const signal = collectErrorSignals(error);
    return (
        isTimeoutLikeError(error)
        || signal.includes('fetch failed')
        || signal.includes('network')
        || signal.includes('socket')
        || signal.includes('terminated')
        || signal.includes('connection closed')
        || signal.includes('other side closed')
        || signal.includes('econnreset')
        || signal.includes('econnaborted')
        || signal.includes('etimedout')
        || signal.includes('und_err')
    );
}

function isRetryableHttpStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    return seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
}

function getTierPricePerImageUsd(settings = {}, tier = 'expensive') {
    const byTier = {
        expensive: settings.expensiveModelPricePerImage,
        medium: settings.mediumModelPricePerImage,
        budget: settings.budgetModelPricePerImage
    };
    return parseNonNegativeNumber(byTier[tier], 0);
}

function normalizeProviderResult(rawResult) {
    if (Array.isArray(rawResult)) {
        return { images: rawResult, usage: null, metadata: {} };
    }
    if (!rawResult || typeof rawResult !== 'object') {
        return { images: [], usage: null, metadata: {} };
    }

    const images = Array.isArray(rawResult.images)
        ? rawResult.images
        : (Array.isArray(rawResult.data) ? rawResult.data : []);
    const usage = rawResult.usage && typeof rawResult.usage === 'object'
        ? rawResult.usage
        : null;
    const metadata = rawResult.metadata && typeof rawResult.metadata === 'object'
        ? rawResult.metadata
        : {};

    return { images, usage, metadata };
}

function getProviderModelId(settings = {}, providerId, overrides = {}) {
    const explicitModel = String(overrides.model || '').trim();
    if (explicitModel) return explicitModel;

    const requestedTier = getRequestedModelTier(settings, overrides);
    for (const tier of getTierFallbackOrder(requestedTier)) {
        const candidate = getConfiguredTierModel(settings, tier);
        if (candidate) return candidate;
    }

    return getProviderDefaultModel(providerId);
}

function joinTextParts(parts = []) {
    return parts
        .filter(p => p && typeof p.text === 'string' && p.text.trim() !== '')
        .map(p => p.text.trim())
        .join('\n\n')
        .trim();
}

function resolvePrompt(parts = [], fallback = 'Use the provided images as references and produce a coherent final image.') {
    const prompt = joinTextParts(parts);
    if (prompt) return prompt;
    return fallback;
}

function extractInlineDataUrls(parts = []) {
    const urls = [];
    for (const p of parts) {
        if (p?.inlineData?.data) {
            const mime = p.inlineData.mimeType || 'image/png';
            urls.push(`data:${mime};base64,${p.inlineData.data}`);
        }
    }
    return urls;
}

function mimeToExtension(mimeType = 'image/png') {
    const normalized = String(mimeType || 'image/png').toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    return 'png';
}

function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mimeType: match[1] || 'image/png',
        base64Data: match[2]
    };
}

function parseSizeToken(token) {
    const match = String(token || '').trim().toLowerCase().match(/^(\d{2,5})x(\d{2,5})$/);
    if (!match) return null;
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const ratio = width / height;
    return {
        token: `${width}x${height}`,
        width,
        height,
        ratio,
        area: width * height,
        ratioDelta: Math.abs(ratio - TARGET_WIDESCREEN_RATIO)
    };
}

function normalizeAspectRatioToken(value, fallback = DEFAULT_ASPECT_RATIO) {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
    if (!match) return fallback;
    const width = Number.parseFloat(match[1]);
    const height = Number.parseFloat(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    return `${match[1]}:${match[2]}`;
}

function aspectRatioTokenToNumber(value, fallback = TARGET_WIDESCREEN_RATIO) {
    const token = normalizeAspectRatioToken(value, '');
    const match = token.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!match) return fallback;
    const width = Number.parseFloat(match[1]);
    const height = Number.parseFloat(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    return width / height;
}

function getRequestedAspectRatio(settings = {}, overrides = {}) {
    return normalizeAspectRatioToken(
        overrides.aspectRatio
        ?? overrides.aspect_ratio
        ?? overrides.imageAspectRatio
        ?? settings.aspectRatio
        ?? settings.imageAspectRatio
        ?? DEFAULT_ASPECT_RATIO
    );
}

function normalizeSymbolicResolutionToken(token) {
    const normalized = String(token || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!/^(?:0\.5|1|2|4|8)k$/.test(normalized)) return null;
    return normalized;
}

function parseResolutionToken(token) {
    const size = parseSizeToken(token);
    if (size) {
        return {
            kind: 'dimension',
            canonical: size.token,
            ...size
        };
    }

    const symbolic = normalizeSymbolicResolutionToken(token);
    if (!symbolic) return null;

    return {
        kind: 'symbolic',
        token: symbolic,
        canonical: symbolic,
        rank: SYMBOLIC_RESOLUTION_RANKS[symbolic] || 0,
        targetArea: SYMBOLIC_RESOLUTION_TARGET_AREAS[symbolic] || null
    };
}

function uniqueResolutionTokens(tokens = []) {
    const unique = [];
    const seen = new Set();
    for (const token of tokens) {
        const parsed = parseResolutionToken(token);
        if (!parsed || seen.has(parsed.canonical)) continue;
        seen.add(parsed.canonical);
        unique.push(parsed.token);
    }
    return unique;
}

function getRequestedResolutionPreference(settings = {}, overrides = {}) {
    const aspectRatio = getRequestedAspectRatio(settings, overrides);
    const targetRatio = aspectRatioTokenToNumber(aspectRatio);
    const explicitSize = String(
        overrides.size
        ?? overrides.imageSizeOverride
        ?? settings.imageSizeOverride
        ?? settings.nanoGptSize
        ?? ''
    ).trim();
    const raw = explicitSize || overrides.imageResolution || overrides.resolution || settings.imageResolution || '4K';
    const normalized = String(raw || '').trim().toLowerCase();
    if (['auto', 'best', 'highest', 'max'].includes(normalized)) {
        return { kind: 'auto', token: 'auto', canonical: 'auto', aspectRatio, targetRatio };
    }

    const parsed = parseResolutionToken(raw);
    return parsed ? { ...parsed, aspectRatio, targetRatio } : {
        kind: 'symbolic',
        token: '4k',
        canonical: '4k',
        rank: 4,
        targetArea: SYMBOLIC_RESOLUTION_TARGET_AREAS['4k'],
        aspectRatio,
        targetRatio
    };
}

function formatImageSizePreferenceForGemini(settings = {}, overrides = {}) {
    const preference = getRequestedResolutionPreference(settings, overrides);
    if (preference.kind === 'symbolic') return preference.token.toUpperCase();
    return '4K';
}

function sortSymbolicCandidatesForPreference(candidates = [], preference = { kind: 'auto' }) {
    const desiredRank = preference.kind === 'symbolic' ? preference.rank : Infinity;
    return [...candidates].sort((a, b) => {
        if (!Number.isFinite(desiredRank) || desiredRank >= 4) return b.rank - a.rank;

        const aAtOrBelow = a.rank <= desiredRank;
        const bAtOrBelow = b.rank <= desiredRank;
        if (aAtOrBelow !== bAtOrBelow) return aAtOrBelow ? -1 : 1;
        if (aAtOrBelow) return b.rank - a.rank;
        return a.rank - b.rank;
    });
}

function sortDimensionCandidatesForPreference(candidates = [], preference = { kind: 'auto' }) {
    const targetRatio = Number(preference.targetRatio) || TARGET_WIDESCREEN_RATIO;
    const targetArea = preference.kind === 'dimension'
        ? preference.area
        : preference.kind === 'symbolic'
            ? preference.targetArea
            : null;
    const preferLargest = !targetArea || (preference.kind === 'symbolic' && preference.rank >= 4);

    return [...candidates].sort((a, b) => {
        const aRatioDelta = Math.abs(a.ratio - targetRatio);
        const bRatioDelta = Math.abs(b.ratio - targetRatio);
        if (aRatioDelta !== bRatioDelta) return aRatioDelta - bRatioDelta;
        if (preferLargest) {
            if (a.area !== b.area) return b.area - a.area;
        } else {
            const aAreaDelta = Math.abs(a.area - targetArea);
            const bAreaDelta = Math.abs(b.area - targetArea);
            if (aAreaDelta !== bAreaDelta) return aAreaDelta - bAreaDelta;
            if (a.area !== b.area) return b.area - a.area;
        }
        return b.width - a.width;
    });
}

function parseResolutionCandidates(tokens = []) {
    return uniqueResolutionTokens(tokens)
        .map(parseResolutionToken)
        .filter(Boolean);
}

function chooseBestResolutionToken(tokens = [], preference = { kind: 'auto' }) {
    const candidates = parseResolutionCandidates(tokens);
    if (candidates.length === 0) return null;

    if (preference.kind === 'dimension') {
        const exactDimension = candidates.find(candidate => candidate.kind === 'dimension' && candidate.token === preference.token);
        if (exactDimension) return exactDimension.token;
    }

    if (preference.kind === 'symbolic') {
        const exactSymbolic = candidates.find(candidate => candidate.kind === 'symbolic' && candidate.token === preference.token);
        if (exactSymbolic) return exactSymbolic.token;
    }

    const symbolic = candidates.filter(candidate => candidate.kind === 'symbolic');
    if (symbolic.length > 0) {
        return sortSymbolicCandidatesForPreference(symbolic, preference)[0].token;
    }

    const dimensions = candidates.filter(candidate => candidate.kind === 'dimension');
    if (dimensions.length > 0) {
        return sortDimensionCandidatesForPreference(dimensions, preference)[0].token;
    }

    return null;
}

function orderResolutionTokensForPreference(tokens = [], preference = { kind: 'auto' }) {
    const candidates = parseResolutionCandidates(tokens);
    const preferred = chooseBestResolutionToken(tokens, preference);
    const symbolic = sortSymbolicCandidatesForPreference(candidates.filter(candidate => candidate.kind === 'symbolic'), preference);
    const dimensions = sortDimensionCandidatesForPreference(candidates.filter(candidate => candidate.kind === 'dimension'), preference);
    return uniqueResolutionTokens([
        preferred,
        ...symbolic.map(candidate => candidate.token),
        ...dimensions.map(candidate => candidate.token)
    ]);
}

function extractSupportedResolutionsFromError(errorText = '') {
    const text = String(errorText || '');
    const dimensionMatches = text.match(/\b\d{2,5}x\d{2,5}\b/g) || [];
    const symbolicMatches = text.match(/\b(?:0\.5|1|2|4|8)\s*k\b/gi) || [];
    return uniqueResolutionTokens([...dimensionMatches, ...symbolicMatches]);
}

function collectResolutionValues(value, out = []) {
    if (!value) return out;
    if (typeof value === 'string') {
        out.push(value);
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectResolutionValues(item, out);
        return out;
    }
    if (typeof value === 'object') {
        for (const key of ['value', 'id', 'size', 'resolution', 'name', 'label']) {
            if (typeof value[key] === 'string') out.push(value[key]);
        }
    }
    return out;
}

function normalizeModelLookupValue(value) {
    return String(value || '').trim().toLowerCase();
}

function compactLookupValue(value) {
    return normalizeModelLookupValue(value).replace(/[^a-z0-9]/g, '');
}

function getNanoGptCatalogList(payload) {
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.models)) return payload.models;
    if (Array.isArray(payload)) return payload;
    return [];
}

async function fetchNanoGptImageModelsCatalog(tools) {
    const now = Date.now();
    if (nanoGptImageModelsCache.data && now - nanoGptImageModelsCache.fetchedAt < NANO_GPT_IMAGE_MODELS_CACHE_TTL_MS) {
        return nanoGptImageModelsCache.data;
    }

    if (!nanoGptImageModelsCache.promise) {
        nanoGptImageModelsCache.promise = (async () => {
            const response = await fetch('https://nano-gpt.com/api/v1/image-models?detailed=true', {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`NanoGPT image model catalog error ${response.status}: ${text}`);
            }

            const payload = await parseJsonOrThrow(response);
            const data = getNanoGptCatalogList(payload);
            nanoGptImageModelsCache = {
                fetchedAt: Date.now(),
                data,
                promise: null
            };
            return data;
        })();
    }

    try {
        return await nanoGptImageModelsCache.promise;
    } catch (error) {
        nanoGptImageModelsCache.promise = null;
        tools?.logger?.runtime?.(`[CG Generator] NanoGPT image model catalog unavailable; falling back to built-in resolution guesses. ${error.message}`);
        return [];
    }
}

function findNanoGptImageModel(catalog = [], model = '') {
    const rawNeedles = [model];
    const withoutSuffix = String(model || '').split(':')[0];
    if (withoutSuffix && withoutSuffix !== model) rawNeedles.push(withoutSuffix);

    const exactNeedles = new Set(rawNeedles.map(normalizeModelLookupValue).filter(Boolean));
    const compactNeedles = new Set(rawNeedles.map(compactLookupValue).filter(Boolean));

    for (const item of catalog) {
        const values = [
            item?.id,
            item?.model,
            item?.slug,
            item?.canonicalId,
            item?.canonical_id,
            item?.canonical_slug,
            item?.name
        ];
        if (values.some(value => exactNeedles.has(normalizeModelLookupValue(value)))) return item;
        if (values.some(value => compactNeedles.has(compactLookupValue(value)))) return item;
    }

    return null;
}

function collectNanoGptModelResolutionTokens(modelDef = null) {
    if (!modelDef) return [];

    const values = [];
    collectResolutionValues(modelDef?.supported_parameters?.resolutions, values);
    collectResolutionValues(modelDef?.supportedParameters?.resolutions, values);
    collectResolutionValues(modelDef?.supported_parameters?.sizes, values);
    collectResolutionValues(modelDef?.supportedParameters?.sizes, values);
    collectResolutionValues(modelDef?.supported_parameters?.image_sizes, values);
    collectResolutionValues(modelDef?.supportedParameters?.imageSizes, values);

    if (modelDef?.pricing?.per_image && typeof modelDef.pricing.per_image === 'object') {
        values.push(...Object.keys(modelDef.pricing.per_image));
    }
    if (modelDef?.pricing?.perImage && typeof modelDef.pricing.perImage === 'object') {
        values.push(...Object.keys(modelDef.pricing.perImage));
    }

    return uniqueResolutionTokens(values);
}

async function getNanoGptModelResolutionTokens(tools, model) {
    const catalog = await fetchNanoGptImageModelsCatalog(tools);
    const modelDef = findNanoGptImageModel(catalog, model);
    const resolutions = collectNanoGptModelResolutionTokens(modelDef);
    if (modelDef && resolutions.length > 0) {
        tools?.logger?.runtime?.(`[CG Generator] NanoGPT model ${model} supports resolutions: ${resolutions.join(', ')}.`);
    } else if (catalog.length > 0) {
        tools?.logger?.runtime?.(`[CG Generator] NanoGPT catalog did not list resolutions for model ${model}; using fallback guesses.`);
    }
    return resolutions;
}

async function getNanoGptSizeAttemptOrder(tools, settings = {}, overrides = {}, model = '') {
    const explicit = parseResolutionToken(
        overrides.size
        ?? overrides.imageSizeOverride
        ?? settings.imageSizeOverride
        ?? settings.nanoGptSize
        ?? ''
    );
    const preference = getRequestedResolutionPreference(settings, overrides);
    const order = [];
    if (explicit) {
        order.push(explicit.token);
    } else {
        const catalogResolutions = await getNanoGptModelResolutionTokens(tools, model);
        order.push(...orderResolutionTokensForPreference(catalogResolutions, preference));
    }

    order.push(...orderResolutionTokensForPreference(NANO_GPT_SIZE_CANDIDATES, preference));
    return uniqueResolutionTokens(order);
}

function getOpenRouterImageSizeAttemptOrder(settings = {}, overrides = {}) {
    const preference = getRequestedResolutionPreference(settings, overrides);
    return orderResolutionTokensForPreference(OPENROUTER_IMAGE_SIZE_CANDIDATES, preference)
        .map(token => token.toUpperCase());
}

function isPathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function readComfyWorkflowJson(tools, settings = {}, overrides = {}) {
    const workflowFile = typeof overrides.comfyUiWorkflowFile === 'string'
        ? overrides.comfyUiWorkflowFile.trim()
        : String(settings.comfyUiWorkflowFile || '').trim();

    if (workflowFile) {
        const contextRoot =
            tools?.turnContext?.runtime?.rootDirectory ||
            tools?.turnContext?.rootDirectory ||
            null;
        if (!contextRoot) {
            throw new Error('ComfyUI workflow file requested but rootDirectory is unavailable.');
        }

        const resolved = path.isAbsolute(workflowFile)
            ? path.resolve(workflowFile)
            : path.resolve(contextRoot, workflowFile);

        if (!isPathInsideRoot(resolved, contextRoot)) {
            throw new Error(`ComfyUI workflow file must stay inside project root. root=${contextRoot} target=${resolved}`);
        }
        return await fs.readFile(resolved, 'utf8');
    }

    throw new Error('ComfyUI workflow file is missing. Set comfyUiWorkflowFile in settings or request override.');
}

function extractInlineBase64(parts = []) {
    const list = [];
    for (const p of parts) {
        if (p?.inlineData?.data) list.push(p.inlineData.data);
    }
    return list;
}

function extractLogPayload(parts = []) {
    return parts
        .map(p => {
            if (p?.text) return p.text;
            if (p?.inlineData?.mimeType) return `[IMAGE ATTACHMENT: ${p.inlineData.mimeType}]`;
            return '[UNKNOWN PART]';
        })
        .join('\n\n');
}

async function parseJsonOrThrow(response) {
    let payload;
    try {
        payload = await response.json();
    } catch {
        const body = await response.text();
        throw new Error(`Expected JSON response, got: ${body.slice(0, 200)}`);
    }
    return payload;
}

async function fetchImageUrlAsBase64(url, timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) {
                lastError = new Error(`Failed to download generated image URL (${response.status})`);
                if (isRetryableHttpStatus(response.status) && attempt < maxAttempts) {
                    await sleep(DEFAULT_RETRY_DELAY_MS);
                    continue;
                }
                throw lastError;
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer).toString('base64');
        } catch (error) {
            lastError = error;
            if (isTransientFetchError(error) && attempt < maxAttempts) {
                await sleep(DEFAULT_RETRY_DELAY_MS);
                continue;
            }
            throw error;
        }
    }

    throw lastError || new Error('Failed to download generated image URL.');
}

async function parseOpenAiStyleDataArray(data = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    const out = [];
    for (const item of data || []) {
        if (item?.b64_json) {
            out.push(item.b64_json);
            continue;
        }
        if (typeof item?.url === 'string' && item.url) {
            out.push(await fetchImageUrlAsBase64(item.url, timeoutMs));
        }
    }
    return out;
}

function parseGeminiCandidates(candidates = []) {
    const out = [];
    for (const candidate of candidates || []) {
        for (const part of candidate?.content?.parts || []) {
            if (part?.inlineData?.data) out.push(part.inlineData.data);
        }
    }
    return out;
}

function pushBase64FromDataUrl(out, url) {
    if (typeof url !== 'string') return;
    const idx = url.indexOf('base64,');
    if (idx !== -1) out.push(url.slice(idx + 'base64,'.length));
}

function parseOpenRouterContent(message = null) {
    const out = [];
    const content = message?.content;

    if (typeof content === 'string') {
        pushBase64FromDataUrl(out, content);
    }

    if (Array.isArray(content)) {
        for (const part of content) {
            const url = part?.image_url?.url;
            if (part?.type === 'image_url' && typeof url === 'string') {
                pushBase64FromDataUrl(out, url);
            }
        }
    }

    if (Array.isArray(message?.images)) {
        for (const image of message.images) {
            pushBase64FromDataUrl(out, image?.image_url?.url || image?.imageUrl?.url || image?.url);
        }
    }

    return out;
}

function getComfyHeaders(settings = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const key = settings.comfyUiApiKey;
    if (key && String(key).trim()) {
        headers['X-API-Key'] = key;
    }
    return headers;
}

function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function applyTemplatePlaceholders(value, replacements = {}) {
    if (typeof value === 'string') {
        let out = value;
        for (const [key, replacement] of Object.entries(replacements)) {
            out = out.split(key).join(String(replacement));
        }
        return out;
    }

    if (Array.isArray(value)) {
        return value.map(v => applyTemplatePlaceholders(v, replacements));
    }

    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = applyTemplatePlaceholders(v, replacements);
        }
        return out;
    }

    return value;
}

function maybeInjectComfyPromptNode(workflow, nodeId, text) {
    if (!nodeId || !workflow[nodeId] || !workflow[nodeId].inputs) return;
    if (typeof workflow[nodeId].inputs.text === 'string') {
        workflow[nodeId].inputs.text = text;
    }
}

function maybeInjectComfySeedNode(workflow, nodeId, seed) {
    if (!nodeId || !workflow[nodeId] || !workflow[nodeId].inputs) return;
    if (Object.prototype.hasOwnProperty.call(workflow[nodeId].inputs, 'seed')) {
        workflow[nodeId].inputs.seed = seed;
    }
}

function maybeInjectComfyImageNodes(workflow, csvNodeIds = '', imageRefs = []) {
    if (!csvNodeIds || !Array.isArray(imageRefs) || imageRefs.length === 0) return;
    const nodeIds = String(csvNodeIds)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

    for (let i = 0; i < nodeIds.length; i++) {
        const nodeId = nodeIds[i];
        const imageRef = imageRefs[i] || imageRefs[0];
        if (!imageRef || !workflow[nodeId] || !workflow[nodeId].inputs) continue;
        if (typeof workflow[nodeId].inputs.image === 'string') {
            workflow[nodeId].inputs.image = imageRef;
        }
    }
}

async function uploadComfyInputImages(baseUrl, settings = {}, imageDataUrls = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    const uploadedRefs = [];
    for (let i = 0; i < imageDataUrls.length; i++) {
        const parsed = parseDataUrl(imageDataUrls[i]);
        if (!parsed?.base64Data) continue;

        const ext = mimeToExtension(parsed.mimeType);
        const fileName = `cg_input_${Date.now()}_${i + 1}.${ext}`;
        const binary = Buffer.from(parsed.base64Data, 'base64');
        const formData = new FormData();
        formData.append('image', new Blob([binary], { type: parsed.mimeType }), fileName);
        formData.append('type', 'input');
        formData.append('overwrite', 'true');
        if (settings.comfyUiUploadSubfolder) {
            formData.append('subfolder', String(settings.comfyUiUploadSubfolder));
        }

        const headers = {};
        if (settings.comfyUiApiKey) headers['X-API-Key'] = settings.comfyUiApiKey;

        const response = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            headers,
            body: formData,
            signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`ComfyUI upload/image error ${response.status}: ${text}`);
        }

        const data = await parseJsonOrThrow(response);
        const ref = data?.subfolder ? `${data.subfolder}/${data.name}` : data?.name;
        if (ref) uploadedRefs.push(ref);
    }
    return uploadedRefs;
}

async function callGeminiStyleProvider({ tools: _tools, url, headers, payload, providerLabel, modelLabel: _modelLabel, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${providerLabel} API Error ${response.status}: ${text}`);
    }

    const data = await parseJsonOrThrow(response);

    return parseGeminiCandidates(data?.candidates);
}

async function providerWisgate(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.apiKey;
    if (!apiKey) throw new Error('Wisgate API Key is missing. Please configure it in settings.');

    const model = getProviderModelId(settings, 'wisgate', overrides);
    const timeoutMs = getProviderTimeoutMs(settings, overrides);
    const payload = {
        contents: [{ parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: getRequestedAspectRatio(settings, overrides), imageSize: formatImageSizePreferenceForGemini(settings, overrides) }
        }
    };

    return callGeminiStyleProvider({
        tools,
        url: `https://wisdom-gate.juheapi.com/v1beta/models/${model}:generateContent`,
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        payload,
        providerLabel: 'wisgate',
        modelLabel: model,
        timeoutMs
    });
}

async function providerGoogle(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.googleApiKey;
    if (!apiKey) throw new Error('Google direct API Key is missing. Please configure it in settings.');

    const model = getProviderModelId(settings, 'google', overrides);
    const timeoutMs = getProviderTimeoutMs(settings, overrides);
    const payload = {
        contents: [{ parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: getRequestedAspectRatio(settings, overrides), imageSize: formatImageSizePreferenceForGemini(settings, overrides) }
        }
    };

    return callGeminiStyleProvider({
        tools,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        payload,
        providerLabel: 'google',
        modelLabel: model,
        timeoutMs
    });
}

async function providerOpenRouter(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.openrouterApiKey;
    if (!apiKey) throw new Error('OpenRouter API Key is missing. Please configure it in settings.');

    const model = getProviderModelId(settings, 'openrouter', overrides);
    const timeoutMs = getProviderTimeoutMs(settings, overrides);
    const content = parts.map(p => {
        if (p?.text) return { type: 'text', text: p.text };
        if (p?.inlineData?.data) {
            return {
                type: 'image_url',
                image_url: { url: `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}` }
            };
        }
        return null;
    }).filter(Boolean);

    const basePayload = {
        model,
        messages: [{ role: 'user', content }],
        modalities: ['image', 'text']
    };

    const aspectRatio = getRequestedAspectRatio(settings, overrides);
    const attempts = getOpenRouterImageSizeAttemptOrder(settings, overrides).map(imageSize => ({
        label: `${aspectRatio} ${imageSize}`,
        image_config: { aspect_ratio: aspectRatio, image_size: imageSize },
        provider: { require_parameters: true }
    }));
    attempts.push(
        {
            label: `${aspectRatio} aspect only`,
            image_config: { aspect_ratio: aspectRatio },
            provider: { require_parameters: true }
        },
        {
            label: `${aspectRatio} best effort`,
            image_config: { aspect_ratio: aspectRatio },
            provider: null
        }
    );

    let lastError = 'OpenRouter request failed.';
    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const payload = {
            ...basePayload,
            image_config: attempt.image_config
        };
        if (attempt.provider) payload.provider = attempt.provider;

        tools.logger.runtime(`[CG Generator] OpenRouter request attempt ${i + 1}/${attempts.length} using ${attempt.label}.`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs)
        });

        if (response.ok) {
            const data = await parseJsonOrThrow(response);
            const images = parseOpenRouterContent(data?.choices?.[0]?.message);
            if (images.length > 0) {
                return {
                    images,
                    usage: data?.usage || null,
                    metadata: {
                        responseId: data?.id || null
                    }
                };
            }
            lastError = `OpenRouter returned no images for ${attempt.label}.`;
            continue;
        }

        const text = await response.text();
        lastError = `OpenRouter API Error ${response.status}: ${text}`;
        if (response.status === 401 || response.status === 403) throw new Error(lastError);
    }

    throw new Error(lastError);
}

async function providerNanoGpt(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.nanoGptApiKey;
    if (!apiKey) throw new Error('NanoGPT API key is missing. Please configure it in settings.');

    const model = getProviderModelId(settings, 'nanogpt', overrides);
    const prompt = resolvePrompt(parts);
    const timeoutMs = getProviderTimeoutMs(settings, overrides, DEFAULT_NANO_GPT_TIMEOUT_MS);
    const attemptsPerSize = getProviderAttemptsPerResolution(settings, overrides, DEFAULT_NANO_GPT_ATTEMPTS_PER_SIZE);

    const imageDataUrls = extractInlineDataUrls(parts);
    const queue = await getNanoGptSizeAttemptOrder(tools, settings, overrides, model);
    const preference = getRequestedResolutionPreference(settings, overrides);
    const tried = new Set();
    let sizeAttempts = 0;
    const maxSizeAttempts = Math.min(queue.length, 12);
    let lastError = 'NanoGPT request failed.';

    while (queue.length > 0 && sizeAttempts < maxSizeAttempts) {
        const size = queue.shift();
        if (!size || tried.has(size)) continue;
        tried.add(size);
        sizeAttempts += 1;

        const payload = {
            model,
            prompt,
            n: 1,
            size,
            response_format: 'url'
        };

        if (imageDataUrls.length === 1) payload.imageDataUrl = imageDataUrls[0];
        if (imageDataUrls.length > 1) payload.imageDataUrls = imageDataUrls;

        for (let networkAttempt = 1; networkAttempt <= attemptsPerSize; networkAttempt++) {
            tools.logger.runtime(`[CG Generator] NanoGPT request size ${size} (${sizeAttempts}/${maxSizeAttempts}), network attempt ${networkAttempt}/${attemptsPerSize}, timeout ${formatDuration(timeoutMs)}.`);
            let response;
            try {
                response = await fetch('https://nano-gpt.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(timeoutMs)
                });
            } catch (error) {
                const transient = isTransientFetchError(error);
                lastError = isTimeoutLikeError(error)
                    ? `NanoGPT request timed out after ${formatDuration(timeoutMs)} (size=${size}).`
                    : `NanoGPT request failed before receiving a response (size=${size}): ${error.message}`;

                if (transient && networkAttempt < attemptsPerSize) {
                    tools.logger.runtime(`[CG Generator] ${lastError} Retrying same size in ${formatDuration(DEFAULT_RETRY_DELAY_MS)}.`);
                    await sleep(DEFAULT_RETRY_DELAY_MS);
                    continue;
                }

                if (transient) {
                    tools.logger.runtime(`[CG Generator] ${lastError} Trying next size candidate if available.`);
                    break;
                }

                throw error;
            }

            if (response.ok) {
                const data = await parseJsonOrThrow(response);
                const images = await parseOpenAiStyleDataArray(data?.data, timeoutMs);
                return {
                    images,
                    usage: data?.usage || null
                };
            }

            const text = await response.text();
            lastError = `NanoGPT API Error ${response.status}: ${text}`;
            if (response.status === 401 || response.status === 403) throw new Error(lastError);

            const supportedFromError = extractSupportedResolutionsFromError(text);
            const bestSupported = chooseBestResolutionToken(supportedFromError, preference);
            if (bestSupported && !tried.has(bestSupported)) {
                queue.unshift(bestSupported);
                tools.logger.runtime(`[CG Generator] NanoGPT reported supported sizes; retrying with best widescreen candidate ${bestSupported}.`);
                break;
            }

            if (isRetryableHttpStatus(response.status) && networkAttempt < attemptsPerSize) {
                tools.logger.runtime(`[CG Generator] ${lastError.slice(0, 240)} Retrying same size in ${formatDuration(DEFAULT_RETRY_DELAY_MS)}.`);
                await sleep(DEFAULT_RETRY_DELAY_MS);
                continue;
            }

            if (isRetryableHttpStatus(response.status)) {
                tools.logger.runtime(`[CG Generator] ${lastError.slice(0, 240)} Trying next size candidate if available.`);
            }
            break;
        }
    }

    throw new Error(lastError);
}

async function providerOpenAi(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.openaiApiKey;
    if (!apiKey) throw new Error('OpenAI API key is missing. Please configure it in settings.');

    const model = getProviderModelId(settings, 'openai', overrides);
    const timeoutMs = getProviderTimeoutMs(settings, overrides);
    const prompt = resolvePrompt(parts);
    const imageDataUrls = extractInlineDataUrls(parts);
    const hasInputImages = imageDataUrls.length > 0;
    const sizePreference = getRequestedResolutionPreference(settings, overrides);
    const imageSize = sizePreference.kind === 'dimension'
        ? sizePreference.token
        : settings.openaiImageSize || '1024x1024';
    const endpoint = hasInputImages ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations';

    const payload = hasInputImages
        ? {
            model,
            prompt,
            images: imageDataUrls.map(url => ({ image_url: url })),
            n: 1,
            size: imageSize,
            response_format: 'b64_json'
        }
        : {
            model,
            prompt,
            n: 1,
            size: imageSize,
            response_format: 'b64_json'
        };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API Error ${response.status}: ${text}`);
    }

    const data = await parseJsonOrThrow(response);
    const images = await parseOpenAiStyleDataArray(data?.data, timeoutMs);
    return {
        images,
        usage: data?.usage || null
    };
}

async function providerReplicate(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.replicateApiToken;
    if (!apiKey) throw new Error('Replicate API token is missing. Please configure it in settings.');

    const version = getProviderModelId(settings, 'replicate', overrides);
    if (!version) throw new Error('Replicate model version is missing. Configure an image model tier in settings.');

    const requestTimeoutMs = getProviderTimeoutMs(settings, overrides);
    const prompt = resolvePrompt(parts);

    const input = { prompt };
    const imageDataList = extractInlineBase64(parts);
    if (imageDataList.length === 1) {
        input.image = `data:image/png;base64,${imageDataList[0]}`;
    } else if (imageDataList.length > 1) {
        input.input_images = imageDataList.map(data => `data:image/png;base64,${data}`);
    }

    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            Prefer: 'wait=60'
        },
        body: JSON.stringify({ version, input }),
        signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (!createResponse.ok) {
        const text = await createResponse.text();
        throw new Error(`Replicate create prediction error ${createResponse.status}: ${text}`);
    }

    let prediction = await parseJsonOrThrow(createResponse);
    const pollMs = Number.parseInt(settings.replicatePollMs, 10) || 1500;
    const deadline = Date.now() + (Number.parseInt(settings.replicateTimeoutMs, 10) || requestTimeoutMs);

    while (prediction?.status && !['succeeded', 'successful', 'failed', 'canceled'].includes(prediction.status)) {
        if (Date.now() > deadline) throw new Error('Replicate request timed out while waiting for completion.');
        const getUrl = prediction?.urls?.get || `https://api.replicate.com/v1/predictions/${prediction?.id}`;
        await new Promise(resolve => setTimeout(resolve, pollMs));

        const statusRes = await fetch(getUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(requestTimeoutMs)
        });

        if (!statusRes.ok) {
            const text = await statusRes.text();
            throw new Error(`Replicate status error ${statusRes.status}: ${text}`);
        }
        prediction = await parseJsonOrThrow(statusRes);
    }

    if (prediction?.status === 'failed' || prediction?.status === 'canceled') {
        throw new Error(`Replicate generation failed: ${prediction?.error || prediction?.status}`);
    }

    const output = prediction?.output;
    const urls = [];
    if (typeof output === 'string') urls.push(output);
    if (Array.isArray(output)) {
        for (const item of output) {
            if (typeof item === 'string') urls.push(item);
            else if (item?.url) urls.push(item.url);
        }
    }

    const images = [];
    for (const url of urls) {
        images.push(await fetchImageUrlAsBase64(url, requestTimeoutMs));
    }

    return images;
}

async function providerFal(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const apiKey = settings.falApiKey;
    if (!apiKey) throw new Error('fal API key is missing. Please configure it in settings.');

    const endpointId = getProviderModelId(settings, 'fal', overrides);
    const requestTimeoutMs = getProviderTimeoutMs(settings, overrides);
    const prompt = resolvePrompt(parts);

    const submitRes = await fetch(`https://queue.fal.run/${endpointId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Key ${apiKey}`
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (!submitRes.ok) {
        const text = await submitRes.text();
        throw new Error(`fal queue submission error ${submitRes.status}: ${text}`);
    }

    const submitData = await parseJsonOrThrow(submitRes);
    const requestId = submitData?.request_id;
    if (!requestId) throw new Error('fal queue response did not include request_id.');

    const pollMs = Number.parseInt(settings.falPollMs, 10) || 1500;
    const deadline = Date.now() + (Number.parseInt(settings.falTimeoutMs, 10) || requestTimeoutMs);

    let statusData = null;
    while (Date.now() < deadline) {
        const statusRes = await fetch(`https://queue.fal.run/${endpointId}/requests/${requestId}/status`, {
            headers: { Authorization: `Key ${apiKey}` },
            signal: AbortSignal.timeout(requestTimeoutMs)
        });

        if (!statusRes.ok) {
            const text = await statusRes.text();
            throw new Error(`fal status error ${statusRes.status}: ${text}`);
        }

        statusData = await parseJsonOrThrow(statusRes);
        const status = String(statusData?.status || '').toUpperCase();
        if (status === 'COMPLETED') break;
        if (status === 'FAILED') throw new Error(`fal request failed: ${JSON.stringify(statusData)}`);
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    if (!statusData || String(statusData?.status || '').toUpperCase() !== 'COMPLETED') {
        throw new Error('fal request timed out while waiting for completion.');
    }

    const resultRes = await fetch(`https://queue.fal.run/${endpointId}/requests/${requestId}`, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (!resultRes.ok) {
        const text = await resultRes.text();
        throw new Error(`fal result fetch error ${resultRes.status}: ${text}`);
    }

    const resultData = await parseJsonOrThrow(resultRes);
    const images = resultData?.images || resultData?.output?.images || [];

    const out = [];
    for (const img of images) {
        if (typeof img?.url === 'string') {
            out.push(await fetchImageUrlAsBase64(img.url, requestTimeoutMs));
        }
    }
    return out;
}

async function providerComfyUi(tools, parts, overrides = {}) {
    const settings = getPluginSettings(tools);
    const baseUrl = String(settings.comfyUiBaseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
    const requestTimeoutMs = getProviderTimeoutMs(settings, overrides);
    const workflowRaw = await readComfyWorkflowJson(tools, settings, overrides);

    let workflow;
    try {
        workflow = JSON.parse(workflowRaw);
    } catch (error) {
        throw new Error(`Invalid ComfyUI workflow JSON: ${error.message}`);
    }

    workflow = deepCloneJson(workflow);

    const promptText = resolvePrompt(parts);
    const imageDataUrls = extractInlineDataUrls(parts);
    let uploadedInputRefs = [];

    if (imageDataUrls.length > 0 && settings.comfyUiUploadInputs !== false) {
        uploadedInputRefs = await uploadComfyInputImages(baseUrl, settings, imageDataUrls, requestTimeoutMs);
    }

    const replacements = {
        '%prompt%': promptText,
        '%negative_prompt%': settings.comfyUiNegativePrompt || '',
        '%input_image_count%': String(imageDataUrls.length)
    };

    for (let i = 0; i < imageDataUrls.length; i++) {
        const idx = i + 1;
        const parsed = parseDataUrl(imageDataUrls[i]);
        replacements[`%input_image_data_url_${idx}%`] = imageDataUrls[i];
        replacements[`%input_image_base64_${idx}%`] = parsed?.base64Data || '';
        replacements[`%input_image_mime_${idx}%`] = parsed?.mimeType || 'image/png';
        replacements[`%input_image_${idx}%`] = uploadedInputRefs[i] || '';
    }

    workflow = applyTemplatePlaceholders(workflow, replacements);

    maybeInjectComfyPromptNode(workflow, settings.comfyUiPromptNodeId, promptText);
    maybeInjectComfyPromptNode(workflow, settings.comfyUiNegativePromptNodeId, settings.comfyUiNegativePrompt || '');
    maybeInjectComfySeedNode(workflow, settings.comfyUiSeedNodeId, Math.floor(Math.random() * 2147483647));
    maybeInjectComfyImageNodes(workflow, settings.comfyUiInputImageNodeIds, uploadedInputRefs);

    const promptId = crypto.randomUUID();
    const clientId = settings.comfyUiClientId || crypto.randomUUID();

    const queueRes = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: getComfyHeaders(settings),
        body: JSON.stringify({
            prompt: workflow,
            client_id: clientId,
            prompt_id: promptId
        }),
        signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (!queueRes.ok) {
        const text = await queueRes.text();
        throw new Error(`ComfyUI prompt submission error ${queueRes.status}: ${text}`);
    }

    const queueData = await parseJsonOrThrow(queueRes);
    const finalPromptId = queueData?.prompt_id || promptId;

    const pollMs = Number.parseInt(settings.comfyUiPollMs, 10) || 1200;
    const timeoutMs = Number.parseInt(settings.comfyUiTimeoutMs, 10) || requestTimeoutMs;
    const deadline = Date.now() + timeoutMs;

    let historyEntry = null;
    while (Date.now() < deadline) {
        const historyRes = await fetch(`${baseUrl}/history/${encodeURIComponent(finalPromptId)}`, {
            headers: settings.comfyUiApiKey ? { 'X-API-Key': settings.comfyUiApiKey } : {},
            signal: AbortSignal.timeout(requestTimeoutMs)
        });

        if (!historyRes.ok) {
            const text = await historyRes.text();
            throw new Error(`ComfyUI history error ${historyRes.status}: ${text}`);
        }

        const historyData = await parseJsonOrThrow(historyRes);
        historyEntry = historyData?.[finalPromptId] || historyData?.[String(finalPromptId)] || null;
        if (historyEntry?.outputs) break;

        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    if (!historyEntry?.outputs) {
        throw new Error('ComfyUI history did not contain outputs before timeout.');
    }

    const outputNodeId = settings.comfyUiOutputNodeId;
    const imageDescriptors = [];

    if (outputNodeId && historyEntry.outputs[outputNodeId]?.images) {
        imageDescriptors.push(...historyEntry.outputs[outputNodeId].images);
    } else {
        for (const nodeOutput of Object.values(historyEntry.outputs)) {
            if (Array.isArray(nodeOutput?.images)) {
                imageDescriptors.push(...nodeOutput.images);
            }
        }
    }

    const out = [];
    for (const img of imageDescriptors) {
        const query = new URLSearchParams({
            filename: img.filename || '',
            subfolder: img.subfolder || '',
            type: img.type || 'output'
        }).toString();

        const imageRes = await fetch(`${baseUrl}/view?${query}`, {
            headers: settings.comfyUiApiKey ? { 'X-API-Key': settings.comfyUiApiKey } : {},
            signal: AbortSignal.timeout(requestTimeoutMs)
        });

        if (!imageRes.ok) {
            const text = await imageRes.text();
            throw new Error(`ComfyUI view error ${imageRes.status}: ${text}`);
        }

        const arrayBuffer = await imageRes.arrayBuffer();
        out.push(Buffer.from(arrayBuffer).toString('base64'));
    }

    return out;
}

const PROVIDERS = {
    wisgate: providerWisgate,
    google: providerGoogle,
    openrouter: providerOpenRouter,
    nanogpt: providerNanoGpt,
    openai: providerOpenAi,
    replicate: providerReplicate,
    fal: providerFal,
    comfyui: providerComfyUi
};

function listProviders() {
    return Object.keys(PROVIDERS);
}

async function generateImages(tools, parts, overrides = {}) {
    const providerId = getProviderId(tools, overrides);
    const handler = PROVIDERS[providerId];
    if (!handler) {
        throw new Error(`Unsupported image provider '${providerId}'. Supported providers: ${listProviders().join(', ')}`);
    }

    const logPayload = extractLogPayload(parts);
    const settings = getPluginSettings(tools);
    const modelTier = getRequestedModelTier(settings, overrides);
    const model = getProviderModelId(settings, providerId, overrides);
    const providerOverrides = { ...overrides, model, modelTier };
    const logTopic = `CG Generator - Image Generation (${providerId})`;
    const tierPricePerImageUsd = getTierPricePerImageUsd(settings, modelTier);

    tools.logger.llmRequest({
        msg: logTopic,
        messages: [{ role: 'user', content: logPayload }],
        model,
        provider: providerId
    });

    tools.logger.runtime(`[CG Generator] Preparing ${providerId} image request (tier=${modelTier}, model=${model || 'n/a'})...`);
    try {
        const rawResult = await handler(tools, parts, providerOverrides);
        const normalized = normalizeProviderResult(rawResult);
        const images = normalized.images;
        const providerUsage = normalized.usage || {};
        const providerCostRaw = providerUsage.total_cost ?? providerUsage.cost;
        const hasProviderCost = Number.isFinite(Number.parseFloat(providerCostRaw));
        const providerCostUsd = hasProviderCost ? parseNonNegativeNumber(providerCostRaw, 0) : 0;
        const estimatedCostUsd = parseNonNegativeNumber(tierPricePerImageUsd * images.length, 0);
        const finalCostUsd = hasProviderCost ? providerCostUsd : estimatedCostUsd;

        tools.logger.llmResponse({
            msg: logTopic,
            content: {
                status: 'ok',
                provider: providerId,
                model,
                modelTier,
                imageCount: images.length,
                outputType: 'base64',
                estimatedCostUsd,
                usedCostUsd: finalCostUsd,
                costSource: hasProviderCost ? 'provider_reported' : 'tier_price_estimate'
            },
            model,
            provider: providerId,
            usage: {
                ...providerUsage,
                prompt_tokens: Number(
                    providerUsage.prompt_tokens
                    ?? providerUsage.promptTokens
                    ?? providerUsage.input_tokens
                    ?? providerUsage.inputTokens
                    ?? 0
                ) || 0,
                completion_tokens: Number(
                    providerUsage.completion_tokens
                    ?? providerUsage.completionTokens
                    ?? providerUsage.output_tokens
                    ?? providerUsage.outputTokens
                    ?? 0
                ) || 0,
                cost: finalCostUsd,
                total_cost: finalCostUsd,
                image_count: images.length,
                image_cost_source: hasProviderCost ? 'provider_reported' : 'tier_price_estimate',
                price_per_image_usd: tierPricePerImageUsd,
                model_tier: modelTier,
                is_image_generation: true
            }
        });

        tools.logger.runtime(`[CG Generator] ${providerId} API returned ${images.length} images.`);
        return images;
    } catch (error) {
        tools.logger.llmResponse({
            msg: logTopic,
            content: {
                status: 'error',
                provider: providerId,
                model,
                modelTier,
                error: error.message
            },
            model,
            provider: providerId,
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                cost: 0,
                total_cost: 0,
                image_count: 0,
                image_cost_source: 'none_error',
                price_per_image_usd: tierPricePerImageUsd,
                model_tier: modelTier,
                is_image_generation: true
            }
        });
        throw error;
    }
}

module.exports = {
    generateImages,
    listProviders,
    resolveProviderId: normalizeProviderId
};
