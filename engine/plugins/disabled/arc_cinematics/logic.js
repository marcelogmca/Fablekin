const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const poemPrompting = require('./poem_prompting.js');
const cgPrompting = require('./cg_prompting.js');
const paletteExtraction = require('./palette_extraction.js');

const PLUGIN_ID = 'arc_cinematics';
const INTERCEPT_ID = 'arc_cinematic';
const PENDING_NOTICE_INTERCEPT_ID = 'arc_cinematic_pending_notice';
const MANIFEST_VERSION = 1;
const DIAGNOSTIC_VERSION = 'diag_guard_v2';
const ACTIVE_PREP_JOBS = new Map();

const OST_CATEGORIES = ['calm', 'happy', 'sad', 'battle'];
const INTRO_OST_KEYWORDS = ['intro'];
const INTRO_VFX_IDS = Object.freeze(['none', ...poemPrompting.RESTRAINED_INTRO_VFX]);
const PRIMARY_INTRO_STANZA_VFX_IDS = Object.freeze([...poemPrompting.PRIMARY_INTRO_VFX]);
const DEFAULT_CG_PROMPT_MODE = cgPrompting.DEFAULT_CG_PROMPT_MODE;
const COMPRESSED_HISTORY_PRESETS = Object.freeze({
    brief: Object.freeze({ full_chapters: 0, summary_chapters: 5, synopsis_chapters: 10 }),
    balanced: Object.freeze({ full_chapters: 1, summary_chapters: 10, synopsis_chapters: 20 }),
    deep: Object.freeze({ full_chapters: 2, summary_chapters: 16, synopsis_chapters: 40 })
});

const SETTINGS_SCHEMA = {
    PLUGIN_BRIEF: {
        type: 'description',
        content: 'Passive VN arc intro cinematics. Other plugins call this capability when a new arc opening should play.'
    },
    PLUGIN_TECHNICAL_OVERVIEW: {
        type: 'description',
        content: 'Registers persisted Pixi GUI intercepts before dialogue 0, generates a short stanza-based opening recap, optionally asks cg_generator for budget backgrounds, and plays a one-shot cinematic OST.'
    },
    PLUGIN_METRICS: {
        type: 'metrics',
        narrative_impact: 'Medium',
        immersion: 'High',
        cost: 'Medium',
        latency: 'Low'
    },
    enabled: {
        type: 'checkbox',
        label: 'Enabled',
        description: 'Allow other plugins to request arc intro cinematics.',
        default: true
    },
    force_intro: {
        type: 'checkbox',
        label: 'Force Intro (Debug)',
        description: 'Debug helper: automatically request an intro on every generated turn.',
        default: false
    },
    model_def: {
        type: 'select',
        label: 'Poem Model',
        description: 'Cheap/medium model used to write the cinematic stanza text.',
        options: 'llm-aliases',
        default: { model: 'mediumendmodel' }
    },
    poem_line_count: {
        type: 'number',
        label: 'Poem Line Count',
        description: 'Total poem lines. The value is rounded to a multiple of four.',
        default: 16,
        min: 8,
        max: 24
    },
    max_source_turns: {
        type: 'number',
        label: 'Max Source Turns',
        description: 'Maximum number of recent turns to include when no previous cinematic marker is found.',
        default: 12,
        min: 1,
        max: 40
    },
    prefer_cg: {
        type: 'checkbox',
        label: 'Request CG Backgrounds',
        description: 'If cg_generator is installed and CG Model Tier is not none, request cinematic backgrounds in the background.',
        default: true
    },
    enable_shaders: {
        type: 'checkbox',
        label: 'Enable Shaders',
        description: 'If VN PixiJS VFX is installed, allow intro-only global stanza shaders and optional restrained atmospheric beats. Each stanza may still choose none.',
        default: true
    },
    cg_model_tier: {
        type: 'select',
        label: 'CG Model Tier',
        description: 'Preferred cg_generator model tier. None disables image generation and uses existing backgrounds plus shaders.',
        options: [
            { label: 'none', description: 'Do not generate CG backgrounds. Cheapest option; shaders still provide motion if enabled.' },
            { label: 'budget', description: 'Cheapest available image model.' },
            { label: 'standard', description: 'Balanced image model.' },
            { label: 'premium', description: 'Higher quality image model.' }
        ],
        default: 'budget'
    },
    cg_prompt_mode: {
        type: 'select',
        label: 'CG Prompt Mode',
        description: 'How arc cinematic backgrounds should prompt cg_generator.',
        options: [
            {
                label: 'diffusion_positive',
                description: 'Path 1: compile a positive, background-only diffusion prompt. Best for cheap image models.'
            },
            {
                label: 'llm_instruction',
                description: 'Path 2: send a clear natural-language image prompt. Best for smarter image models.'
            },
            {
                label: 'llm_instruction_with_references',
                description: 'Path 3: natural-language prompt plus available character sprite references.'
            }
        ],
        default: DEFAULT_CG_PROMPT_MODE
    },
    maximum_duration_seconds: {
        type: 'number',
        label: 'Maximum Duration (seconds)',
        description: 'Caps long cinematic OSTs. Shorter tracks play at their natural length.',
        default: 60,
        min: 10,
        max: 300
    }
};

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toPosix(value) {
    return String(value || '').replace(/\\/g, '/');
}

function nowIso() {
    return new Date().toISOString();
}

function describeError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;

    const parts = [];
    if (error.name) parts.push(error.name);
    if (error.code) parts.push(`code=${error.code}`);
    if (error.arcCinematicsStage) parts.push(`stage=${error.arcCinematicsStage}`);
    if (error.message) parts.push(error.message);
    if (error.stack) parts.push(String(error.stack).split(/\r?\n/).slice(0, 8).join('\n'));
    return parts.filter(Boolean).join(' | ') || String(error);
}

function logArcError(tools, label, error) {
    const message = `${label}: ${describeError(error)}`;
    try { tools?.logger?.error?.('Lifecycle', message); } catch (_) { }
    try { tools?.logger?.runtime?.(message); } catch (_) { }
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizeLineCount(value, fallback = 16) {
    const clamped = clampInteger(value, fallback, 8, 24);
    const rounded = Math.round(clamped / 4) * 4;
    return Math.max(8, Math.min(24, rounded));
}

function normalizeCgPromptMode(value) {
    return cgPrompting.normalizeCgPromptMode(value);
}

function normalizeCgModelTier(value) {
    const tier = String(value || 'budget').trim().toLowerCase();
    return ['none', 'budget', 'standard', 'premium'].includes(tier) ? tier : 'budget';
}

function areShadersEnabled(settings = {}) {
    return settings.enable_shaders !== false && settings.enable_vfx !== false;
}

function isCgGenerationEnabled(settings = {}, request = {}) {
    return settings.prefer_cg !== false
        && request?.preferCg !== false
        && normalizeCgModelTier(settings.cg_model_tier) !== 'none';
}

function sanitizeSlug(value, fallback = 'arc') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return slug || fallback;
}

function randomRequestSuffix() {
    try {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        }
        if (typeof crypto.randomBytes === 'function') {
            return crypto.randomBytes(4).toString('hex');
        }
    } catch (_) {
        // Fall through to a Math.random fallback; uniqueness is best-effort only.
    }
    return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

function normalizeSettings(raw = {}) {
    const modelDef = isPlainObject(raw.model_def)
        ? raw.model_def
        : { model: 'mediumendmodel' };

    return {
        enabled: raw.enabled !== false,
        force_intro: raw.force_intro === true,
        model_def: {
            model: modelDef.model || 'mediumendmodel',
        },
        poem_line_count: normalizeLineCount(raw.poem_line_count, 16),
        max_source_turns: clampInteger(raw.max_source_turns, 12, 1, 40),
        prefer_cg: raw.prefer_cg !== false,
        enable_shaders: raw.enable_shaders !== undefined ? raw.enable_shaders !== false : raw.enable_vfx !== false,
        enable_vfx: raw.enable_shaders !== undefined ? raw.enable_shaders !== false : raw.enable_vfx !== false,
        cg_model_tier: normalizeCgModelTier(raw.cg_model_tier),
        cg_prompt_mode: normalizeCgPromptMode(raw.cg_prompt_mode),
        maximum_duration_seconds: clampInteger(raw.maximum_duration_seconds, 60, 10, 300)
    };
}

function normalizeType() {
    return 'intro';
}

function normalizeRange(rawRange, currentTurn) {
    if (!isPlainObject(rawRange)) return null;
    const startTurn = Number.parseInt(
        rawRange.startTurn ?? rawRange.fromTurn ?? rawRange.startChapter ?? rawRange.fromChapter ?? rawRange.chapterStart ?? rawRange.start,
        10
    );
    const endTurn = Number.parseInt(
        rawRange.endTurn ?? rawRange.toTurn ?? rawRange.endChapter ?? rawRange.toChapter ?? rawRange.chapterEnd ?? rawRange.end,
        10
    );
    if (!Number.isInteger(startTurn) || !Number.isInteger(endTurn)) return null;
    if (startTurn < 1 || endTurn < startTurn) return null;
    const maxEnd = Number.isInteger(currentTurn) && currentTurn > 0 ? currentTurn : endTurn;
    return {
        startTurn,
        endTurn: Math.min(endTurn, maxEnd),
        explicit: true
    };
}

function isPlaceholderArcTitle(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === ''
        || normalized === 'opening'
        || normalized === 'opening arc'
        || normalized === 'arc cinematic';
}

function selectArcTitle(requestTitle, generatedTitle, fallback = 'Arc Cinematic') {
    const requestText = String(requestTitle || '').trim();
    const generatedText = String(generatedTitle || '').trim();
    if (requestText && !isPlaceholderArcTitle(requestText)) return requestText;
    return generatedText || requestText || fallback;
}

function createRequestId(turnContext, request) {
    if (request.requestId) return String(request.requestId).trim().slice(0, 96);
    const turn = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 0;
    const type = normalizeType(request.type);
    const arc = sanitizeSlug(request.arcId || 'default', 'default');
    return `${INTERCEPT_ID}_${turn}_${type}_${arc}_${randomRequestSuffix()}`;
}

function normalizeRequest(turnContext, rawRequest = {}, settings = normalizeSettings()) {
    const request = isPlainObject(rawRequest) ? rawRequest : {};
    const currentTurn = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : null;
    const type = normalizeType(request.type);
    const arcId = String(request.arcId || 'default').trim() || 'default';

    return {
        requestId: createRequestId(turnContext, { ...request, type, arcId }),
        type,
        arcId,
        title: String(request.title || '').trim(),
        subtitle: String(request.subtitle || request.tagline || '').trim(),
        reason: String(request.reason || '').trim(),
        mood: String(request.mood || '').trim(),
        styleHint: String(request.styleHint || request.style || '').trim(),
        arcRangeLabel: String(request.arcRangeLabel || request.arc_range_label || request.chapterRangeLabel || request.chapter_range_label || '').trim(),
        range: normalizeRange(request.range, currentTurn),
        playAt: 'before_first_dialogue',
        preferCg: request.preferCg === undefined ? settings.prefer_cg : request.preferCg !== false,
        cgPromptMode: normalizeCgPromptMode(request.cgPromptMode || request.cg_prompt_mode || settings.cg_prompt_mode),
        requestedAtTurn: currentTurn,
        requestedAt: nowIso()
    };
}

function normalizeProjectAssetPath(rawPath, kind = null) {
    let text = toPosix(String(rawPath || '').replace(/^file:\/\/\/?/i, '')).trim();
    if (!text) return '';
    if (/^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(text)) return text;

    // Runtime asset loaders can hand us absolute Windows paths. Convert anything
    // under workspace/projects/[Project]/ back to a project-relative asset path.
    const lowerText = text.toLowerCase();
    const projectMarker = '/workspace/projects/';
    const projectMarkerIndex = lowerText.lastIndexOf(projectMarker);
    if (projectMarkerIndex !== -1) {
        const tail = text.slice(projectMarkerIndex + projectMarker.length);
        const segments = tail.split('/').filter(Boolean);
        if (segments.length >= 2) text = segments.slice(1).join('/');
    } else {
        const assetsIndex = lowerText.lastIndexOf('/assets/');
        const pluginsIndex = lowerText.lastIndexOf('/plugins/');
        if (assetsIndex !== -1) text = text.slice(assetsIndex + 1);
        else if (pluginsIndex !== -1) text = text.slice(pluginsIndex + 1);
    }

    if (text.startsWith('assets/') || text.startsWith('plugins/')) return text;
    if (text.startsWith('/')) return text.replace(/^\/+/, '');
    if (text.startsWith('ost/')) return `assets/${text}`;
    if (text.startsWith('backgrounds/')) return `assets/${text}`;
    if (text.startsWith('sprites/')) return `assets/${text}`;
    if (kind === 'ost') return `assets/ost/${text}`;
    if (kind === 'background') return `assets/backgrounds/${text}`;
    if (kind === 'sprite') return `assets/sprites/${text}`;
    return text;
}

function isGenericSpritePath(spritePath) {
    const filename = path.posix.basename(toPosix(spritePath)).toLowerCase();
    return filename.includes('generic') || filename.includes('npc');
}

function isGenericSpriteEntry(entry = {}) {
    const text = [
        entry.name,
        entry.character,
        entry.path,
        entry.image,
        entry.assetPath,
        entry.absolutePath
    ].map(value => String(value || '')).join(' ').toLowerCase();
    return text.includes('generic') || text.includes('npc');
}

function isGenericCharacterName(name) {
    const text = String(name || '').trim().toLowerCase();
    return !text || text === 'narrator' || text === 'system' || /\bgeneric\b/.test(text) || /\bnpc\b/.test(text);
}

function toBridgeAssetPath(rawPath, kind = null) {
    const normalized = normalizeProjectAssetPath(rawPath, kind);
    if (!normalized) return '';
    if (/^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(normalized)) return normalized;
    return `project://${normalized}`;
}

async function fileExists(filePath) {
    if (!filePath) return false;
    try {
        await fs.access(filePath);
        return true;
    } catch (_) {
        return false;
    }
}

async function resolveProjectImageAbsolutePath(tools, rawPath) {
    const text = String(rawPath || '').trim();
    if (!text || /^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(text)) return '';
    const withoutScheme = text.replace(/^file:\/\/\/?/i, '');
    if (path.isAbsolute(withoutScheme) && await fileExists(withoutScheme)) {
        return withoutScheme;
    }

    const normalized = normalizeProjectAssetPath(withoutScheme, 'background');
    const candidates = dedupeStrings([normalized, withoutScheme]);
    for (const candidate of candidates) {
        try {
            const resolved = tools?.assets?.resolvePath?.(candidate, {
                assumeProjectRelative: candidate === normalized,
                throwOnInvalid: false,
                kind: 'background'
            });
            if (resolved && await fileExists(resolved)) return resolved;
        } catch (_) {
            // Keep trying the remaining candidate forms.
        }
    }
    return '';
}

function normalizePaletteEntry(entry = {}) {
    const colors = paletteExtraction.normalizePaletteColors(entry.colors, paletteExtraction.DEFAULT_PALETTE_SIZE);
    if (colors.length === 0) return null;
    return {
        stanzaIndex: Number.isInteger(entry.stanzaIndex) ? entry.stanzaIndex : 0,
        source: String(entry.source || 'unknown'),
        path: normalizeProjectAssetPath(entry.path || '', 'background'),
        colors,
        extractedAt: entry.extractedAt || null
    };
}

function findStoredPaletteForStanza(manifest = {}, stanzaIndex = 0, sourcePath = '') {
    const normalizedPath = normalizeProjectAssetPath(sourcePath, 'background');
    const palettes = Array.isArray(manifest.assets?.backgroundPalettes)
        ? manifest.assets.backgroundPalettes
        : [];
    for (const rawEntry of palettes) {
        const entry = normalizePaletteEntry(rawEntry);
        if (!entry || Number(entry.stanzaIndex) !== Number(stanzaIndex)) continue;
        if (normalizedPath && normalizeProjectAssetPath(entry.path, 'background') !== normalizedPath) continue;
        return entry;
    }
    return null;
}

function findPlaybackPaletteForStanza(manifest = {}, stanzaIndex = 0) {
    const palettes = Array.isArray(manifest.assets?.backgroundPalettes)
        ? manifest.assets.backgroundPalettes
        : [];
    const normalized = palettes
        .map(normalizePaletteEntry)
        .filter(Boolean)
        .filter(entry => Number(entry.stanzaIndex) === Number(stanzaIndex));
    return normalized.find(entry => entry.source === 'cg') || normalized[0] || null;
}

function isPremiumReferenceCgPlayback(manifest = {}) {
    const modelTier = normalizeCgModelTier(manifest.cg?.modelTier || manifest.request?.cgModelTier || '');
    const promptMode = normalizeCgPromptMode(manifest.cg?.promptMode || manifest.request?.cgPromptMode || '');
    return modelTier === 'premium' && promptMode === 'llm_instruction_with_references';
}

function hasGeneratedBackgroundForStanza(manifest = {}, stanzaIndex = 0) {
    const generated = Array.isArray(manifest.assets?.backgrounds?.generated)
        ? manifest.assets.backgrounds.generated
        : [];
    return generated.some(entry => Number(entry?.stanzaIndex) === Number(stanzaIndex) && !!entry?.path);
}

function buildPaletteImageCandidates(manifest = {}, stanzaIndex = 0) {
    const backgrounds = manifest.assets?.backgrounds || {};
    const generated = Array.isArray(backgrounds.generated) ? backgrounds.generated : [];
    const fallback = Array.isArray(backgrounds.fallback) ? backgrounds.fallback : [];
    const addCandidate = (entry, source) => {
        const pathValue = typeof entry === 'string' ? entry : entry?.path;
        const normalized = normalizeProjectAssetPath(pathValue, 'background');
        if (!normalized) return null;
        return {
            stanzaIndex,
            source,
            path: normalized
        };
    };

    const directGenerated = generated
        .filter(entry => Number(entry?.stanzaIndex) === Number(stanzaIndex))
        .map(entry => addCandidate(entry, 'cg'))
        .filter(Boolean);
    const directFallback = fallback
        .filter(entry => Number(entry?.stanzaIndex) === Number(stanzaIndex))
        .map(entry => addCandidate(entry, 'fallback'))
        .filter(Boolean);
    const fallbackByIndex = fallback.length > 0
        ? [addCandidate(fallback[stanzaIndex % fallback.length], 'fallback')].filter(Boolean)
        : [];

    const seen = new Set();
    return [...directGenerated, ...directFallback, ...fallbackByIndex]
        .filter(candidate => {
            const key = `${candidate.source}:${candidate.path}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function extractStanzaBackgroundPalettes(turnContext, tools, manifest = {}, settings = normalizeSettings()) {
    void turnContext;
    void settings;
    if (!paletteExtraction.hasSharp()) return manifest;
    const stanzas = Array.isArray(manifest.poem?.stanzas) ? manifest.poem.stanzas : [];
    if (stanzas.length === 0) return manifest;
    manifest.assets = manifest.assets || {};
    manifest.assets.backgroundPalettes = Array.isArray(manifest.assets.backgroundPalettes)
        ? manifest.assets.backgroundPalettes.map(normalizePaletteEntry).filter(Boolean)
        : [];

    const nextPalettes = manifest.assets.backgroundPalettes.filter(entry => Number.isInteger(entry.stanzaIndex));
    const replacePalette = (entry) => {
        const existingIndex = nextPalettes.findIndex(candidate => (
            Number(candidate.stanzaIndex) === Number(entry.stanzaIndex)
            && candidate.source === entry.source
            && normalizeProjectAssetPath(candidate.path, 'background') === normalizeProjectAssetPath(entry.path, 'background')
        ));
        if (existingIndex >= 0) nextPalettes[existingIndex] = entry;
        else nextPalettes.push(entry);
    };

    for (let stanzaIndex = 0; stanzaIndex < stanzas.length; stanzaIndex += 1) {
        const candidates = buildPaletteImageCandidates(manifest, stanzaIndex);
        for (const candidate of candidates) {
            const stored = findStoredPaletteForStanza({ assets: { backgroundPalettes: nextPalettes } }, stanzaIndex, candidate.path);
            if (stored?.colors?.length > 0) break;
            try {
                const absolutePath = await resolveProjectImageAbsolutePath(tools, candidate.path);
                if (!absolutePath) continue;
                const colors = await paletteExtraction.extractProminentColorsFromFile(absolutePath, {
                    paletteSize: paletteExtraction.DEFAULT_PALETTE_SIZE
                });
                if (colors.length === 0) continue;
                replacePalette({
                    stanzaIndex,
                    source: candidate.source,
                    path: candidate.path,
                    colors,
                    extractedAt: nowIso()
                });
                break;
            } catch (error) {
                addManifestError(manifest, 'palette_extraction', error);
            }
        }
    }

    manifest.assets.backgroundPalettes = nextPalettes;
    manifest.updatedAt = nowIso();
    return manifest;
}

function dedupeStrings(values = []) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function splitIntoStanzas(lines, size = 4) {
    const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/))
        .map(line => String(line || '').trim())
        .filter(Boolean);
    const stanzas = [];
    for (let i = 0; i < cleanLines.length; i += size) {
        stanzas.push(cleanLines.slice(i, i + size));
    }
    return stanzas.filter(stanza => stanza.length > 0);
}

function ensureLineCount(lines, desiredCount, fallbackFactory) {
    const out = (Array.isArray(lines) ? lines : [])
        .map(line => String(line || '').trim())
        .filter(Boolean)
        .slice(0, desiredCount);

    let guard = 0;
    while (out.length < desiredCount && guard < desiredCount * 2) {
        const fallback = typeof fallbackFactory === 'function'
            ? fallbackFactory(out.length)
            : `The road remembers step ${out.length + 1}.`;
        out.push(fallback);
        guard += 1;
    }

    return out;
}

const normalizeStringArray = cgPrompting.normalizeStringArray;
const normalizeEnvironmentVibes = cgPrompting.normalizeEnvironmentVibes;

function normalizeSpriteEmotion(value, allowedEmotions = ['neutral']) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const allowed = new Set((Array.isArray(allowedEmotions) ? allowedEmotions : ['neutral'])
        .map(emotion => String(emotion || '').trim().toLowerCase())
        .filter(Boolean));
    allowed.add('neutral');
    return normalized && allowed.has(normalized) ? normalized : 'neutral';
}

function normalizeLooseVfxId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeVfxId(value, allowedIds = INTRO_VFX_IDS) {
    const normalized = normalizeLooseVfxId(value);
    const allowed = new Set((Array.isArray(allowedIds) ? allowedIds : INTRO_VFX_IDS)
        .map(id => String(id || '').trim().toLowerCase())
        .filter(Boolean));
    allowed.add('none');
    if (normalized.startsWith('intro-')) return 'none';
    return normalized && allowed.has(normalized) ? normalized : 'none';
}

function normalizeVfxIntensity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'medium' ? 'medium' : 'subtle';
}

function normalizeVfxBeat(rawBeat = {}, allowedIds = INTRO_VFX_IDS) {
    if (typeof rawBeat === 'string') {
        return {
            id: normalizeVfxId(rawBeat, allowedIds),
            intensity: 'subtle',
            reason: ''
        };
    }

    if (!isPlainObject(rawBeat)) {
        return {
            id: 'none',
            intensity: 'subtle',
            reason: ''
        };
    }

    const id = normalizeVfxId(rawBeat.id || rawBeat.effect || rawBeat.name || rawBeat.vfx, allowedIds);
    return {
        id,
        intensity: id === 'none' ? 'subtle' : normalizeVfxIntensity(rawBeat.intensity || rawBeat.strength),
        reason: String(rawBeat.reason || rawBeat.rationale || '').trim().slice(0, 240)
    };
}

function isIntroVfxRuntimeAvailable(tools, settings = normalizeSettings()) {
    if (!areShadersEnabled(settings)) return false;
    return tools?.plugins?.isInstalled?.('vn_pixijs_vfx') === true
        || !!tools?.plugins?.get?.('vn_pixijs_vfx');
}

function normalizeIntroStanzaVfxIds(ids = PRIMARY_INTRO_STANZA_VFX_IDS) {
    const allowed = new Set(PRIMARY_INTRO_STANZA_VFX_IDS);
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(ids) ? ids : []) {
        const normalized = normalizeLooseVfxId(value);
        if (!normalized || !allowed.has(normalized) || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function makeSeededRng(seedValue) {
    let seed = 2166136261;
    const text = String(seedValue || 'arc_cinematics');
    for (let index = 0; index < text.length; index += 1) {
        seed ^= text.charCodeAt(index);
        seed = Math.imul(seed, 16777619) >>> 0;
    }
    return () => {
        seed = ((seed * 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function shuffleWithRng(values, rng) {
    const out = values.slice();
    for (let index = out.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(rng() * (index + 1));
        [out[index], out[swapIndex]] = [out[swapIndex], out[index]];
    }
    return out;
}

function buildIntroStanzaVfxSequence(stanzaCountOrStanzas, seedValue, availableIds = PRIMARY_INTRO_STANZA_VFX_IDS) {
    const stanzaCount = Array.isArray(stanzaCountOrStanzas)
        ? stanzaCountOrStanzas.length
        : Math.max(0, Number(stanzaCountOrStanzas) || 0);
    const pool = normalizeIntroStanzaVfxIds(availableIds);
    if (stanzaCount <= 0 || pool.length === 0) return [];

    const rng = makeSeededRng(seedValue);
    const sequence = [];
    let currentPool = [];
    let previousId = '';

    while (sequence.length < stanzaCount) {
        if (currentPool.length === 0) {
            currentPool = shuffleWithRng(pool, rng);
            if (previousId && currentPool.length > 1 && currentPool[0] === previousId) {
                [currentPool[0], currentPool[1]] = [currentPool[1], currentPool[0]];
            }
        }

        const id = currentPool.shift();
        previousId = id;
        sequence.push({
            stanzaIndex: sequence.length,
            id,
            intensity: rng() < 0.38 ? 'medium' : 'subtle'
        });
    }

    return sequence;
}

function createRuntimeIntroVfxSeed(manifest = {}, descriptor = {}) {
    const base = [
        manifest.requestId || descriptor.interceptId || INTERCEPT_ID,
        manifest.request?.arcId || 'default',
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 12)
    ].join(':');
    return base;
}

function stableIndexFromText(value, modulo) {
    const count = Math.max(0, Number(modulo) || 0);
    if (count <= 1) return 0;
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % count;
}

function buildSpriteEmotionCandidates(beat, availableEmotions = ['neutral'], stanzaIndex = 0, beatIndex = 0) {
    const allowed = (Array.isArray(availableEmotions) ? availableEmotions : ['neutral'])
        .map(emotion => normalizeSpriteEmotion(emotion, availableEmotions))
        .filter(Boolean);
    const nonNeutral = Array.from(new Set(allowed.filter(emotion => emotion !== 'neutral')));
    const requested = normalizeSpriteEmotion(beat?.emotion || 'neutral', availableEmotions);
    const ordered = [];
    const add = (emotion) => {
        const normalized = normalizeSpriteEmotion(emotion, availableEmotions);
        if (!ordered.includes(normalized)) ordered.push(normalized);
    };

    if (requested !== 'neutral') add(requested);

    if (nonNeutral.length > 0) {
        const start = requested === 'neutral'
            ? stableIndexFromText(`${beat?.name || ''}:${stanzaIndex}:${beatIndex}`, nonNeutral.length)
            : 0;
        for (let offset = 0; offset < nonNeutral.length; offset += 1) {
            add(nonNeutral[(start + offset) % nonNeutral.length]);
        }
    }

    add('neutral');
    return ordered;
}

function inferEmotionFromSpritePath(spritePath, requestedEmotion = 'neutral', availableEmotions = ['neutral']) {
    const clean = String(spritePath || '').toLowerCase().replace(/\\/g, '/');
    const basename = path.posix.basename(clean).replace(/\.[^.]+$/, '');
    const haystack = `${clean} ${basename}`.replace(/[^a-z0-9]+/g, '_');
    const emotions = (Array.isArray(availableEmotions) ? availableEmotions : ['neutral'])
        .map(emotion => normalizeSpriteEmotion(emotion, availableEmotions))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);

    for (const emotion of emotions) {
        if (emotion === 'neutral') continue;
        const token = emotion.replace(/[^a-z0-9]+/g, '_');
        if (new RegExp(`(^|_)${token}(_|$)`).test(haystack)) return emotion;
    }
    if (/(^|_)(neutral|default|base|idle)(_|$)/.test(haystack)) return 'neutral';
    return normalizeSpriteEmotion(requestedEmotion, availableEmotions);
}

function normalizeCharacterBeats(rawBeats = [], relevantCharacters = [], allowedEmotions = ['neutral'], maxBeats = 3) {
    const beats = [];
    const seen = new Set();
    const addBeat = (name, emotion = 'neutral') => {
        const cleanName = String(name || '').trim();
        if (!cleanName || isGenericCharacterName(cleanName)) return;
        const key = cleanName.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        beats.push({
            name: cleanName,
            emotion: normalizeSpriteEmotion(emotion, allowedEmotions)
        });
    };

    for (const beat of Array.isArray(rawBeats) ? rawBeats : []) {
        if (typeof beat === 'string') addBeat(beat, 'neutral');
        else if (isPlainObject(beat)) addBeat(beat.name || beat.character, beat.emotion || beat.mood || 'neutral');
        if (beats.length >= maxBeats) break;
    }

    if (beats.length === 0) {
        for (const name of relevantCharacters) {
            addBeat(name, 'neutral');
            if (beats.length >= maxBeats) break;
        }
    }

    return beats;
}

function extractTurnOutput(turnish) {
    if (!turnish) return {};
    if (turnish.output && typeof turnish.output === 'object') return turnish.output;
    if (turnish.context?.output && typeof turnish.context.output === 'object') return turnish.context.output;
    return {};
}

function getTurnNumber(turnish) {
    return Number.isInteger(turnish?.turnNumber)
        ? turnish.turnNumber
        : (Number.isInteger(turnish?.context?.turnNumber) ? turnish.context.turnNumber : null);
}

function summarizeTurn(turnish) {
    const output = extractTurnOutput(turnish);
    const meta = turnish?.meta || {};
    const title = output.title || meta.title || output.abstractTitle || meta.abstractTitle || '';
    const synopsis = output.synopsis || meta.synopsis || output.summary || meta.summary || '';
    const prompt = turnish?.input?.userPrompt || turnish?.context?.input?.userPrompt || '';
    const characters = extractCharacterNamesFromTurn(turnish).slice(0, 8);
    return {
        turnNumber: getTurnNumber(turnish),
        title: String(title || '').trim(),
        synopsis: String(synopsis || '').trim(),
        prompt: String(prompt || '').trim(),
        characters
    };
}

function extractCharacterNamesFromTurn(turnish) {
    const output = extractTurnOutput(turnish);
    const counts = new Map();
    const add = (name, weight = 1) => {
        const clean = String(name || '').trim();
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (lower === 'narrator' || lower === 'narration' || lower === 'system') return;
        counts.set(clean, (counts.get(clean) || 0) + weight);
    };

    for (const name of Array.isArray(output.prominentCharacters) ? output.prominentCharacters : []) add(name, 5);
    for (const name of Array.isArray(output.party) ? output.party : []) add(name, 3);
    for (const line of Array.isArray(output.sequence) ? output.sequence : []) {
        if (line?.type && line.type !== 'dialogue') continue;
        add(line?.character, 1);
    }

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([name]) => name);
}

function getPluginTurnStateFromTurn(turnish) {
    const context = turnish?.context || turnish || {};
    return context?.processed?.plugins?.[PLUGIN_ID] || {};
}

function readLastRunMarkerFromTurn(turnish) {
    const state = getPluginTurnStateFromTurn(turnish);
    const marker = state?.arcCinematics?.lastRun;
    return isPlainObject(marker) ? marker : null;
}

function markerMatchesRequest(marker, request) {
    if (!marker || !request) return false;
    return String(marker.type || '') === String(request.type || '')
        && String(marker.arcId || 'default') === String(request.arcId || 'default');
}

function findLastRunInTurns(turns = [], request = {}) {
    const sorted = (Array.isArray(turns) ? turns : [])
        .slice()
        .sort((left, right) => (getTurnNumber(right) || 0) - (getTurnNumber(left) || 0));
    for (const turn of sorted) {
        const marker = readLastRunMarkerFromTurn(turn);
        if (markerMatchesRequest(marker, request)) return marker;
    }
    return null;
}

async function findLastRunMarker(turnContext, tools, request) {
    const currentTurn = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 0;
    if (!tools?.turns?.getPrevious || currentTurn <= 1) return null;
    try {
        const previousTurns = await tools.turns.getPrevious(currentTurn - 1, { order: 'desc' });
        return findLastRunInTurns(previousTurns, request);
    } catch (error) {
        tools?.logger?.warn?.('ArcCinematics', `Unable to scan previous cinematic markers: ${error.message}`);
        return null;
    }
}

async function resolveSourceRange(turnContext, tools, request, settings) {
    const currentTurn = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 1;
    if (request.range) {
        return {
            ...request.range,
            lastRun: null
        };
    }

    const lastRun = await findLastRunMarker(turnContext, tools, request);
    const startTurn = lastRun?.turnNumber
        ? Math.min(currentTurn, Number(lastRun.turnNumber) + 1)
        : Math.max(1, currentTurn - settings.max_source_turns + 1);

    return {
        startTurn,
        endTurn: currentTurn,
        explicit: false,
        lastRun
    };
}

async function collectSourceTurns(turnContext, tools, range) {
    const source = [];
    if (tools?.turns?.getRange && range?.startTurn && range?.endTurn) {
        try {
            source.push(...await tools.turns.getRange(range.startTurn, range.endTurn));
        } catch (error) {
            tools?.logger?.warn?.('ArcCinematics', `Unable to load requested turn range: ${error.message}`);
        }
    }

    const currentTurnNumber = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : null;
    if (currentTurnNumber && currentTurnNumber >= range.startTurn && currentTurnNumber <= range.endTurn) {
        const currentIndex = source.findIndex(turn => getTurnNumber(turn) === currentTurnNumber);
        const currentSummary = {
            context: turnContext,
            turnNumber: currentTurnNumber,
            input: turnContext.input || {},
            output: turnContext.output || {},
            meta: {
                title: turnContext.output?.title || '',
                synopsis: turnContext.output?.synopsis || '',
                summary: turnContext.output?.summary || ''
            }
        };
        if (currentIndex >= 0) source[currentIndex] = currentSummary;
        else source.push(currentSummary);
    }

    return source
        .filter(Boolean)
        .sort((left, right) => (getTurnNumber(left) || 0) - (getTurnNumber(right) || 0));
}

function buildSourceDigest(sourceTurns = [], maxChars = 7000) {
    const entries = sourceTurns.map(summarizeTurn);
    const lines = [];
    for (const entry of entries) {
        const bits = [
            entry.title ? `Title: ${entry.title}` : '',
            entry.synopsis ? `Synopsis: ${entry.synopsis}` : '',
            !entry.synopsis && entry.prompt ? `Prompt: ${entry.prompt}` : '',
            entry.characters.length ? `Characters: ${entry.characters.join(', ')}` : ''
        ].filter(Boolean);
        if (bits.length === 0) continue;
        lines.push(`Turn ${entry.turnNumber || '?'}\n${bits.join('\n')}`);
    }
    const digest = lines.join('\n\n').trim();
    if (digest.length <= maxChars) return digest;
    return digest.slice(digest.length - maxChars).trim();
}

function buildRangeContextLabel(manifest = {}) {
    const explicitLabel = String(manifest.request?.arcRangeLabel || '').trim();
    if (explicitLabel) return `Focused arc range: ${explicitLabel}`;
    const range = manifest.sourceRange || {};
    if (range.startTurn && range.endTurn) {
        const label = range.startTurn === range.endTurn
            ? `Chapter ${range.startTurn}`
            : `Chapters ${range.startTurn} to ${range.endTurn}`;
        return `Focused arc range: ${label}`;
    }
    return '';
}

function clampText(value, maxChars = 12000) {
    const text = String(value || '').trim();
    if (!text || text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n...[truncated]`;
}

function getManifestExplicitRange(manifest = {}) {
    const range = manifest.sourceRange || manifest.request?.range || null;
    if (!range?.startTurn || !range?.endTurn) return null;
    return {
        startTurn: Number(range.startTurn),
        endTurn: Number(range.endTurn)
    };
}

function collectHistoryChaptersForCompressedCoverage(turnContext = {}) {
    const chapterHistory = turnContext?.runtime?.chapterHistory || {};
    return [
        ...(Array.isArray(chapterHistory.synopsischapters) ? chapterHistory.synopsischapters : []).map(tc => ({ tc, nativeTier: 'synopsis' })),
        ...(Array.isArray(chapterHistory.summarychapters) ? chapterHistory.summarychapters : []).map(tc => ({ tc, nativeTier: 'summary' })),
        ...(Array.isArray(chapterHistory.fullchapters) ? chapterHistory.fullchapters : []).map(tc => ({ tc, nativeTier: 'full' }))
    ].filter(item => Number.isFinite(Number(item?.tc?.turnNumber)));
}

function selectCompressedHistoryTurns(allChapters = [], preset = {}) {
    const ordered = (Array.isArray(allChapters) ? allChapters : [])
        .filter(item => Number.isFinite(Number(item?.tc?.turnNumber)))
        .sort((left, right) => Number(left.tc.turnNumber) - Number(right.tc.turnNumber));
    const selectedTiers = new Map();
    let cursor = ordered.length - 1;

    const takeNewest = (tier, count) => {
        const safeCount = Math.max(0, Number(count) || 0);
        for (let index = 0; index < safeCount && cursor >= 0; index += 1) {
            selectedTiers.set(Number(ordered[cursor].tc.turnNumber), tier);
            cursor -= 1;
        }
    };

    takeNewest('full', preset.full_chapters);
    takeNewest('summary', preset.summary_chapters);
    takeNewest('synopsis', preset.synopsis_chapters);

    return ordered
        .map(item => Number(item?.tc?.turnNumber))
        .filter(turnNumber => selectedTiers.has(turnNumber));
}

function scoreCompressedCoverage(selectedTurns, range) {
    const start = Number(range?.startTurn);
    const end = Number(range?.endTurn);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return {
            fullCoverage: false,
            coveredCount: 0,
            extraCount: selectedTurns.length,
            missingCount: 0
        };
    }

    const selected = new Set(selectedTurns.map(Number).filter(Number.isFinite));
    let coveredCount = 0;
    for (let turn = start; turn <= end; turn += 1) {
        if (selected.has(turn)) coveredCount += 1;
    }
    const requestedCount = end - start + 1;
    return {
        fullCoverage: coveredCount === requestedCount,
        coveredCount,
        extraCount: selected.size - coveredCount,
        missingCount: requestedCount - coveredCount
    };
}

function selectCompressedHistoryKeyForRange(turnContext = {}, compressed = {}, range = null) {
    const availableKeys = ['brief', 'balanced', 'deep'].filter(key => compressed?.[key] && compressed[key] !== 'No story yet.');
    if (!range || availableKeys.length === 0) {
        return availableKeys.includes('balanced')
            ? { key: 'balanced', reason: 'default' }
            : (availableKeys.includes('deep') ? { key: 'deep', reason: 'default' } : (availableKeys[0] ? { key: availableKeys[0], reason: 'default' } : null));
    }

    const allChapters = collectHistoryChaptersForCompressedCoverage(turnContext);
    if (allChapters.length === 0) {
        return availableKeys.includes('deep')
            ? { key: 'deep', reason: 'range_no_coverage_metadata' }
            : (availableKeys.includes('balanced') ? { key: 'balanced', reason: 'range_no_coverage_metadata' } : { key: availableKeys[0], reason: 'range_no_coverage_metadata' });
    }

    const ranked = availableKeys
        .map(key => {
            const preset = COMPRESSED_HISTORY_PRESETS[key];
            if (!preset) return null;
            const selectedTurns = selectCompressedHistoryTurns(allChapters, preset);
            return {
                key,
                selectedTurns,
                selectedCount: selectedTurns.length,
                ...scoreCompressedCoverage(selectedTurns, range)
            };
        })
        .filter(Boolean);

    const full = ranked
        .filter(entry => entry.fullCoverage)
        .sort((left, right) => left.extraCount - right.extraCount || left.selectedCount - right.selectedCount);
    if (full[0]) return { ...full[0], reason: 'range_full_coverage' };

    const partial = ranked
        .sort((left, right) => right.coveredCount - left.coveredCount || left.missingCount - right.missingCount || right.selectedCount - left.selectedCount);
    if (partial[0]) return { ...partial[0], reason: 'range_partial_coverage' };

    return availableKeys.includes('deep')
        ? { key: 'deep', reason: 'range_no_matching_preset' }
        : { key: availableKeys[0], reason: 'range_no_matching_preset' };
}

async function getStorySoFarForPoem(turnContext, tools, manifest = null) {
    const explicitRange = getManifestExplicitRange(manifest);
    const compressed = turnContext?.runtime?.historyData?.compressedHistory || {};
    const selectedCompressed = selectCompressedHistoryKeyForRange(turnContext, compressed, explicitRange);
    const preferred = selectedCompressed?.key ? compressed[selectedCompressed.key] : '';
    if (preferred && preferred !== 'No story yet.') {
        return {
            source: `compressedHistory.${selectedCompressed.key}${selectedCompressed.reason ? `:${selectedCompressed.reason}` : ''}`,
            text: clampText(preferred, 16000)
        };
    }

    if (typeof turnContext?.getFormattedHistory === 'function') {
        try {
            const text = await turnContext.getFormattedHistory({
                count: 18,
                skip: 0,
                tierConfig: { fulltext: 1, summary: 7, synopsis: 10 }
            });
            if (text && text !== 'No older chapters available.') {
                return {
                    source: 'turnContext.getFormattedHistory',
                    text: clampText(text, 16000)
                };
            }
        } catch (error) {
            tools?.logger?.warn?.('ArcCinematics', `Unable to load formatted story context: ${error.message}`);
        }
    }

    const summaryHistory = turnContext?.runtime?.historyData?.summaryHistory || '';
    if (summaryHistory) {
        return {
            source: 'historyData.summaryHistory',
            text: clampText(summaryHistory, 16000)
        };
    }

    return {
        source: 'fallback',
        text: 'No story-so-far context is available yet.'
    };
}

function buildFallbackLines(sourceTurns = [], request = {}, desiredCount = 16) {
    const summaries = sourceTurns.map(summarizeTurn).filter(entry => entry.title || entry.synopsis || entry.prompt);
    const characters = dedupeStrings(summaries.flatMap(entry => entry.characters)).slice(0, 4);
    const arcLabel = request.title || request.reason || `${request.type || 'arc'} ${request.arcId || 'default'}`;
    const cast = characters.length ? characters.join(', ') : 'the party';
    const seed = [
        `The curtain rises on ${arcLabel}.`,
        `The road still carries ${cast}.`,
        'Old choices gleam like lanterns in rain.',
        'New vows gather quietly under the stars.',
        'What was lost becomes a map.',
        'What was found becomes a flame.',
        'The world leans close to hear them breathe.',
        'And the next door opens in gold.'
    ];

    for (const entry of summaries.slice(-4)) {
        if (entry.title) seed.push(`${entry.title} leaves its echo in the air.`);
        if (entry.synopsis) seed.push(entry.synopsis.replace(/\s+/g, ' ').slice(0, 96));
    }

    return ensureLineCount(seed, desiredCount, index => {
        const n = index + 1;
        return n % 2 === 0
            ? 'The journey answers with a brighter dawn.'
            : 'The heart remembers why it crossed the dark.';
    });
}

function buildFallbackStanzas(sourceTurns, request, settings) {
    const summaries = sourceTurns.map(summarizeTurn);
    const characters = dedupeStrings(summaries.flatMap(entry => entry.characters)).slice(0, 4);
    return splitIntoStanzas(buildFallbackLines(sourceTurns, request, settings.poem_line_count), 4)
        .map((lines, index) => ({
            index,
            lines,
            mood: request.mood || 'lyrical',
            characters,
            relevantCharacters: characters,
            characterBeats: normalizeCharacterBeats([], characters, ['neutral']),
            vfxBeat: normalizeVfxBeat('none'),
            environmentVibes: normalizeEnvironmentVibes({
                atmosphere: request.mood || 'lyrical VN opening atmosphere',
                palette: request.styleHint || 'cinematic storybook colors',
                visualMotifs: ['lantern light', 'open road', 'soft horizon']
            })
        }));
}

function buildInitialManifest({ turnContext, request, range, sourceTurns, storage, settings }) {
    const fallbackStanzas = buildFallbackStanzas(sourceTurns, request, settings);
    const sourceDigest = buildSourceDigest(sourceTurns);
    const title = selectArcTitle(request.title, '', 'Opening Arc');

    return {
        version: MANIFEST_VERSION,
        pluginId: PLUGIN_ID,
        requestId: request.requestId,
        status: 'queued',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        projectName: turnContext?.projectName || '',
        turnNumber: turnContext?.turnNumber || null,
        storage: {
            relativePath: storage.relativePath,
            storageTurnKey: storage.storageTurnKey,
            manifestFile: `manifest_${request.requestId}.json`
        },
        request,
        sourceRange: {
            startTurn: range.startTurn,
            endTurn: range.endTurn,
            explicit: !!range.explicit,
            lastRun: range.lastRun || null
        },
        sourceDigest,
        poem: {
            status: 'fallback',
            title,
            subtitle: request.subtitle || '',
            stanzas: fallbackStanzas
        },
        assets: {
            ost: null,
            sprites: [],
            backgroundPalettes: [],
            backgrounds: {
                fallback: [],
                generated: []
            }
        },
        playback: {
            maximumDurationSeconds: settings.maximum_duration_seconds,
            vfxEnabled: areShadersEnabled(settings)
        },
        cg: {
            status: isCgGenerationEnabled(settings, request) ? 'queued' : 'disabled',
            requested: isCgGenerationEnabled(settings, request),
            promptMode: request.cgPromptMode || settings.cg_prompt_mode,
            modelTier: settings.cg_model_tier,
            results: []
        },
        errors: []
    };
}

async function ensureStorage(storage) {
    await fs.mkdir(storage.absolutePath, { recursive: true });
}

function getManifestAbsolutePath(storage, requestId) {
    return path.join(storage.absolutePath, `manifest_${requestId}.json`);
}

function getManifestProjectPath(storage, requestId) {
    return toPosix(`${storage.relativePath}/manifest_${requestId}.json`);
}

async function writeJsonFile(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readJsonFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

async function readManifestFromDescriptor(context, tools, descriptor = {}) {
    const manifestPath = descriptor?.payload?.manifestPath;
    if (manifestPath && tools?.project?.readFile) {
        try {
            return JSON.parse(await tools.project.readFile(manifestPath));
        } catch (error) {
            tools?.logger?.warn?.('ArcCinematics', `Unable to read cinematic manifest '${manifestPath}': ${error.message}`);
        }
    }

    if (descriptor?.payload?.manifest && isPlainObject(descriptor.payload.manifest)) {
        return descriptor.payload.manifest;
    }

    if (descriptor?.payload?.playbackPayload && isPlainObject(descriptor.payload.playbackPayload)) {
        return {
            requestId: descriptor.payload.playbackPayload.requestId || descriptor.interceptId || INTERCEPT_ID,
            request: {},
            poem: {
                title: descriptor.payload.playbackPayload.title || 'Arc Cinematic',
                subtitle: '',
                stanzas: descriptor.payload.playbackPayload.stanzas || []
            },
            assets: {
                ost: null,
                sprites: [],
                backgrounds: { fallback: [], generated: [] }
            },
            playback: { maximumDurationSeconds: 60 }
        };
    }

    return null;
}

function normalizePoemResponse(raw, request, settings, sourceTurns, availableSpriteEmotions = ['neutral'], availableIntroVfxIds = INTRO_VFX_IDS) {
    const fallback = buildFallbackStanzas(sourceTurns, request, settings);
    if (!isPlainObject(raw)) {
        return {
            title: request.title || 'Arc Cinematic',
            subtitle: request.subtitle || '',
            stanzas: fallback
        };
    }

    const allLines = Array.isArray(raw.lines)
        ? raw.lines
        : (Array.isArray(raw.poemLines) ? raw.poemLines : []);
    let stanzas = Array.isArray(raw.stanzas)
        ? raw.stanzas.map((stanza, index) => {
            const lines = Array.isArray(stanza?.lines)
                ? stanza.lines
                : String(stanza?.text || stanza || '').split(/\r?\n/);
            const relevantCharacters = normalizeStringArray(
                stanza?.relevantCharacters || stanza?.relevant_characters || stanza?.characters || [],
                6
            );
            const environmentVibes = normalizeEnvironmentVibes(
                stanza?.environmentVibes || stanza?.environment_vibes || stanza?.backgroundEnvironment || stanza?.background_environment || {},
                request.mood || raw.mood || ''
            );
            const characterBeats = normalizeCharacterBeats(
                stanza?.characterBeats || stanza?.character_beats || [],
                relevantCharacters,
                availableSpriteEmotions
            );
            const vfxBeat = normalizeVfxBeat(
                stanza?.vfxBeat || stanza?.vfx_beat || stanza?.vfx || stanza?.effect || {},
                availableIntroVfxIds
            );
            return {
                index,
                lines: lines.map(line => String(line || '').trim()).filter(Boolean).slice(0, 4),
                mood: String(stanza?.mood || raw.mood || request.mood || '').trim(),
                characters: relevantCharacters,
                relevantCharacters,
                characterBeats,
                vfxBeat,
                environmentVibes
            };
        }).filter(stanza => stanza.lines.length > 0)
        : [];

    if (stanzas.length === 0 && allLines.length > 0) {
        const normalizedLines = ensureLineCount(allLines, settings.poem_line_count, index => fallback.flatMap(s => s.lines)[index] || '');
        stanzas = splitIntoStanzas(normalizedLines, 4).map((lines, index) => ({
            index,
            lines,
            mood: request.mood || '',
            characters: [],
            relevantCharacters: [],
            characterBeats: [],
            vfxBeat: normalizeVfxBeat('none', availableIntroVfxIds),
            environmentVibes: normalizeEnvironmentVibes({}, request.mood || '')
        }));
    }

    if (stanzas.length === 0) stanzas = fallback;

    return {
        title: selectArcTitle(request.title, raw.title, 'Arc Cinematic'),
        generatedTitle: String(raw.title || '').trim(),
        subtitle: String(request.subtitle || raw.subtitle || raw.tagline || '').trim(),
        stanzas: stanzas.map((stanza, index) => ({
            ...stanza,
            index,
            lines: ensureLineCount(stanza.lines, 4, lineIndex => fallback[index]?.lines?.[lineIndex] || 'The road shines on.'),
            relevantCharacters: normalizeStringArray(stanza.relevantCharacters || stanza.characters || fallback[index]?.relevantCharacters || [], 6),
            characters: normalizeStringArray(stanza.characters || stanza.relevantCharacters || fallback[index]?.characters || [], 6),
            characterBeats: normalizeCharacterBeats(
                stanza.characterBeats || fallback[index]?.characterBeats || [],
                normalizeStringArray(stanza.relevantCharacters || stanza.characters || fallback[index]?.relevantCharacters || [], 6),
                availableSpriteEmotions
            ),
            vfxBeat: normalizeVfxBeat(stanza.vfxBeat || fallback[index]?.vfxBeat || {}, availableIntroVfxIds),
            environmentVibes: normalizeEnvironmentVibes(
                stanza.environmentVibes || fallback[index]?.environmentVibes || {},
                stanza.mood || request.mood || ''
            )
        }))
    };
}

async function buildPoemMessages(manifest, sourceTurns, settings, turnContext = null, tools = null) {
    return await poemPrompting.buildPoemMessages({
        manifest,
        sourceTurns,
        settings,
        turnContext,
        tools,
        buildSourceDigest,
        buildRangeContextLabel,
        getStorySoFarForPoem
    });
}

async function generatePoem(manifest, sourceTurns, tools, settings, turnContext = null) {
    const availableSpriteEmotions = await poemPrompting.collectAvailableSpriteEmotions(tools);
    const introVfx = await poemPrompting.collectAvailableIntroVfx(tools, settings);
    const availableIntroVfxIds = Array.isArray(introVfx.ids) ? introVfx.ids : ['none'];
    if (!tools?.llm?.withSchema) {
        return normalizePoemResponse(null, manifest.request, settings, sourceTurns, availableSpriteEmotions, availableIntroVfxIds);
    }

    const schema = {
        type: 'object',
        required: ['title', 'stanzas'],
        properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
            stanzas: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['lines'],
                    properties: {
                        lines: { type: 'array', items: { type: 'string' } },
                        mood: { type: 'string' },
                        characters: { type: 'array', items: { type: 'string' } },
                        relevantCharacters: { type: 'array', items: { type: 'string' } },
                        characterBeats: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    emotion: { type: 'string' }
                                }
                            }
                        },
                        vfxBeat: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                intensity: { type: 'string' },
                                reason: { type: 'string' }
                            }
                        },
                        environmentVibes: {
                            type: 'object',
                            properties: {
                                locationType: { type: 'string' },
                                atmosphere: { type: 'string' },
                                timeOfDay: { type: 'string' },
                                weather: { type: 'string' },
                                palette: { type: 'string' },
                                visualMotifs: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            }
        }
    };

    const modelDef = settings.model_def || {};
    try {
        const messages = await buildPoemMessages(
            manifest,
            sourceTurns,
            {
                ...settings,
                available_sprite_emotions: availableSpriteEmotions,
                intro_vfx: introVfx
            },
            turnContext,
            tools
        );
        const response = await tools.llm.withSchema({
            msg: 'Arc Cinematic Poem',
            messages,
            model: modelDef.model || 'mediumendmodel',
            params: {
                callingModule: `Plugin:${PLUGIN_ID}:poem`,
                temperature: 0.85
            }
        }, schema);

        return normalizePoemResponse(response?.content, manifest.request, settings, sourceTurns, availableSpriteEmotions, availableIntroVfxIds);
    } catch (error) {
        tools?.logger?.warn?.('Lifecycle', `Poem generation failed; using fallback stanzas. ${describeError(error)}`);
        tools?.logger?.runtime?.(`Poem generation failed; using fallback stanzas. ${error?.message || String(error)}`);
        return normalizePoemResponse(null, manifest.request, settings, sourceTurns, availableSpriteEmotions, availableIntroVfxIds);
    }
}

function getRuntimeBucket(tools) {
    const root = tools?.pluginState?.runtime ? tools.pluginState.runtime() : {};
    if (!root.arcCinematics || typeof root.arcCinematics !== 'object') {
        root.arcCinematics = { pendingRequests: [] };
    }
    if (!Array.isArray(root.arcCinematics.pendingRequests)) {
        root.arcCinematics.pendingRequests = [];
    }
    return root.arcCinematics;
}

function getTurnStateBucket(tools) {
    const root = tools?.pluginState?.turn ? tools.pluginState.turn() : {};
    if (!root.arcCinematics || typeof root.arcCinematics !== 'object') {
        root.arcCinematics = {};
    }
    return root.arcCinematics;
}

function getAnnouncementBucket(turnContext) {
    if (!turnContext || typeof turnContext !== 'object') return null;
    if (!turnContext.runtime || typeof turnContext.runtime !== 'object') {
        turnContext.runtime = {};
    }
    if (!turnContext.runtime.plugins || typeof turnContext.runtime.plugins !== 'object') {
        turnContext.runtime.plugins = {};
    }
    if (!turnContext.runtime.plugins[PLUGIN_ID] || typeof turnContext.runtime.plugins[PLUGIN_ID] !== 'object') {
        turnContext.runtime.plugins[PLUGIN_ID] = {};
    }
    return turnContext.runtime.plugins[PLUGIN_ID];
}

function getAnnouncedArcRequest(turnContext) {
    const bucket = turnContext?.runtime?.plugins?.[PLUGIN_ID];
    return isPlainObject(bucket?.request) ? bucket.request : null;
}

function setAnnouncedArcRequest(turnContext, request) {
    const bucket = getAnnouncementBucket(turnContext);
    if (!bucket) return null;
    bucket.request = isPlainObject(request) ? request : {};
    bucket.requestStatus = 'announced';
    bucket.announcedAt = nowIso();
    return bucket.request;
}

function addPendingRequest(tools, pending) {
    const bucket = getRuntimeBucket(tools);
    const existingIndex = bucket.pendingRequests.findIndex(item => item.requestId === pending.requestId);
    if (existingIndex >= 0) bucket.pendingRequests[existingIndex] = { ...bucket.pendingRequests[existingIndex], ...pending };
    else bucket.pendingRequests.push(pending);
    return pending;
}

function markPendingFinalized(tools, requestId, patch = {}) {
    const bucket = getRuntimeBucket(tools);
    const pending = bucket.pendingRequests.find(item => item.requestId === requestId);
    if (pending) Object.assign(pending, { finalized: true, ...patch });
    return pending || null;
}

function collectBackgroundCandidates(turnContext, manifest) {
    const candidates = [];
    const add = (value) => {
        const normalized = normalizeProjectAssetPath(value, 'background');
        if (normalized) candidates.push(normalized);
    };

    add(turnContext?.output?.finalBackground);
    add(turnContext?.processed?.assetSelector?.background);
    add(turnContext?.processed?.assetSelector?.backgroundDraft);

    for (const change of Array.isArray(turnContext?.output?.bgChanges) ? turnContext.output.bgChanges : []) {
        add(change?.path);
    }

    for (const line of Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence : []) {
        add(line?.cg);
        for (const event of Array.isArray(line?.clientEvents) ? line.clientEvents : []) {
            if (event?.type === 'scene:transition') add(event?.payload?.src);
        }
    }

    for (const entry of Array.isArray(manifest?.assets?.backgrounds?.fallback) ? manifest.assets.backgrounds.fallback : []) {
        add(entry?.path || entry);
    }

    return dedupeStrings(candidates).slice(0, 8);
}

function selectCategoryOrder(request = {}) {
    const mood = `${request.mood || ''} ${request.reason || ''} ${request.type || ''}`.toLowerCase();
    let first = 'calm';
    if (/(battle|fight|boss|war|danger|chase|climax|intense)/.test(mood)) first = 'battle';
    else if (/(sad|loss|grief|farewell|melancholy|tragic|quiet)/.test(mood)) first = 'sad';
    else if (/(happy|joy|festival|celebrat|bright|comedy|victory)/.test(mood)) first = 'happy';
    return [first, ...OST_CATEGORIES.filter(category => category !== first)];
}

async function getAvailableOsts(turnContext, tools) {
    const candidates = [];
    const addMany = (values) => {
        for (const value of Array.isArray(values) ? values : []) {
            const normalized = normalizeProjectAssetPath(value, 'ost');
            if (normalized) candidates.push(normalized);
        }
    };

    addMany(turnContext?.runtime?.assets?.osts);
    addMany(turnContext?.runtime?.assets?.extraOsts);

    if (tools?.assets?.listOst) {
        for (const source of ['runtime', 'filesystem', 'auto']) {
            try {
                addMany(await tools.assets.listOst({ source, format: 'project' }));
            } catch (_) {
                // Keep going; another source may be available.
            }
        }
    }

    return dedupeStrings(candidates);
}

function pickFromCandidatePool(rawPath, available) {
    const normalized = normalizeProjectAssetPath(rawPath, 'ost');
    if (!normalized) return '';
    if (!Array.isArray(available) || available.length === 0) return normalized;
    const lower = normalized.toLowerCase();
    const filename = path.posix.basename(lower);
    const basename = filename.replace(/\.[^.]+$/, '');
    return available.find(item => {
        const itemLower = item.toLowerCase();
        const itemFile = path.posix.basename(itemLower);
        const itemBase = itemFile.replace(/\.[^.]+$/, '');
        return itemLower === lower || itemFile === filename || itemBase === basename || itemLower.endsWith(`/${filename}`);
    }) || normalized;
}

async function selectCinematicOst(turnContext = {}, tools = {}, request = {}, _settings = normalizeSettings()) {
    const available = await getAvailableOsts(turnContext, tools);
    const keywords = INTRO_OST_KEYWORDS;
    const keywordMatch = available.find(candidate => {
        const filename = path.posix.basename(candidate).toLowerCase();
        return keywords.some(keyword => keyword && filename.includes(keyword));
    });
    if (keywordMatch) {
        return { path: keywordMatch, source: 'keyword', keyword: keywords.find(k => path.posix.basename(keywordMatch).toLowerCase().includes(k)) || 'intro' };
    }

    const buckets = turnContext?.processed?.assetSelector?.ostChoicesByCategory || {};
    for (const category of selectCategoryOrder(request)) {
        const choices = Array.isArray(buckets?.[category]) ? buckets[category] : [];
        for (const choice of choices) {
            const selected = pickFromCandidatePool(choice, available);
            if (selected) return { path: selected, source: 'category', category };
        }
    }

    const finalSong = turnContext?.output?.finalSong || turnContext?.processed?.assetSelector?.ost || '';
    if (finalSong) return { path: pickFromCandidatePool(finalSong, available), source: 'finalSong' };

    if (available.length > 0) return { path: available[0], source: 'firstAvailable' };
    return null;
}

async function collectSpritePayload(turnContext, tools, sourceTurns = []) {
    const nameCounts = new Map();
    const addName = (name, weight = 1) => {
        const clean = String(name || '').trim();
        if (!clean || isGenericCharacterName(clean)) return;
        const key = clean.toLowerCase();
        const current = nameCounts.get(key) || { name: clean, count: 0 };
        current.count += weight;
        nameCounts.set(key, current);
    };

    for (const name of extractCharacterNamesFromTurn({ context: turnContext })) addName(name, 10);
    for (const turn of sourceTurns) {
        for (const name of extractCharacterNamesFromTurn(turn)) addName(name, 1);
    }

    const names = Array.from(nameCounts.values())
        .sort((left, right) => right.count - left.count)
        .map(entry => entry.name)
        .slice(0, 6);

    const sprites = [];
    const usedPaths = new Set();
    for (const name of names) {
        let spritePath = '';
        try {
            const result = await tools?.assets?.findCharacterSprite?.(name, 'neutral', { source: 'auto' });
            spritePath = result?.image || result?.assetPath || '';
        } catch (_) {
            spritePath = '';
        }
        const normalized = normalizeProjectAssetPath(spritePath, 'sprite');
        if (!normalized || usedPaths.has(normalized) || isGenericSpritePath(normalized)) continue;
        usedPaths.add(normalized);
        sprites.push({ name, path: normalized });
    }

    for (const spritePath of Array.isArray(turnContext?.output?.prominentSprites) ? turnContext.output.prominentSprites : []) {
        const normalized = normalizeProjectAssetPath(spritePath, 'sprite');
        if (!normalized || usedPaths.has(normalized) || isGenericSpritePath(normalized)) continue;
        usedPaths.add(normalized);
        sprites.push({ name: `Character ${sprites.length + 1}`, path: normalized });
        if (sprites.length >= 6) break;
    }

    return sprites.slice(0, 6);
}

async function resolveStanzaSpriteBeats(turnContext, tools, stanzas = [], maxSpritesPerStanza = 3) {
    const availableSpriteEmotions = await poemPrompting.collectAvailableSpriteEmotions(tools).catch(() => ['neutral']);
    const resolvedStanzas = [];
    const sourceStanzas = Array.isArray(stanzas) ? stanzas : [];
    for (let stanzaIndex = 0; stanzaIndex < sourceStanzas.length; stanzaIndex += 1) {
        const stanza = sourceStanzas[stanzaIndex];
        const beats = normalizeCharacterBeats(
            stanza.characterBeats || [],
            stanza.relevantCharacters || stanza.characters || [],
            availableSpriteEmotions,
            maxSpritesPerStanza
        );
        const resolvedSprites = [];
        const usedPaths = new Set();

        for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
            const beat = beats[beatIndex];
            const emotionCandidates = buildSpriteEmotionCandidates(beat, availableSpriteEmotions, stanza.index ?? stanzaIndex, beatIndex);
            let neutralPath = '';
            let neutralResult = null;
            try {
                neutralResult = await tools?.assets?.findCharacterSprite?.(beat.name, 'neutral', { source: 'auto' });
                neutralPath = normalizeProjectAssetPath(neutralResult?.image || neutralResult?.assetPath || '', 'sprite');
            } catch (_) {
                neutralResult = null;
                neutralPath = '';
            }

            let chosen = null;
            let fallback = null;
            for (const emotionCandidate of emotionCandidates) {
                let result = null;
                try {
                    result = emotionCandidate === 'neutral'
                        ? neutralResult
                        : await tools?.assets?.findCharacterSprite?.(beat.name, emotionCandidate, { source: 'auto' });
                } catch (_) {
                    result = null;
                }

                const rawPath = result?.image || result?.assetPath || '';
                const normalized = normalizeProjectAssetPath(rawPath, 'sprite');
                const resolvedEmotion = inferEmotionFromSpritePath(normalized, emotionCandidate, availableSpriteEmotions);
                const candidate = {
                    name: beat.name,
                    emotion: beat.emotion || 'neutral',
                    resolvedEmotion,
                    path: normalized,
                    image: result?.image || '',
                    assetPath: result?.assetPath || '',
                    absolutePath: result?.absolutePath || ''
                };
                if (!normalized || usedPaths.has(normalized) || isGenericSpriteEntry(candidate)) continue;

                if (!fallback) fallback = candidate;
                const isNeutralEquivalent = emotionCandidate !== 'neutral'
                    && neutralPath
                    && normalized === neutralPath;
                if (!isNeutralEquivalent && resolvedEmotion !== 'neutral') {
                    chosen = candidate;
                    break;
                }
                if (emotionCandidate === 'neutral' && !chosen) {
                    fallback = candidate;
                }
            }

            const candidate = chosen || fallback;
            if (!candidate) continue;
            usedPaths.add(candidate.path);
            resolvedSprites.push({
                name: candidate.name,
                emotion: candidate.emotion,
                resolvedEmotion: candidate.resolvedEmotion,
                path: candidate.path
            });
            if (resolvedSprites.length >= maxSpritesPerStanza) break;
        }

        resolvedStanzas.push({
            ...stanza,
            characterBeats: beats,
            sprites: resolvedSprites
        });
    }
    return resolvedStanzas;
}

function addManifestError(manifest, stage, error) {
    if (!Array.isArray(manifest.errors)) manifest.errors = [];
    manifest.errors.push({
        stage,
        message: error?.message || String(error || 'Unknown error'),
        at: nowIso()
    });
    manifest.updatedAt = nowIso();
}

function buildDiffusionPromptFallback(stanza = {}, manifest = {}) {
    return cgPrompting.buildDiffusionPromptFallback(stanza, manifest);
}

// Public plugin API wrapper. The plugin manager supplies turnContext and tools.
function getDiffusionPromptFallback(turnContext, tools, stanza = {}, manifest = {}) {
    return buildDiffusionPromptFallback(stanza, manifest);
}

async function compileDiffusionPositivePrompt(turnContext, tools, manifest, stanza, settings) {
    return await cgPrompting.compileDiffusionPositivePrompt({
        turnContext,
        tools,
        manifest,
        stanza,
        settings,
        pluginId: PLUGIN_ID,
        describeError
    });
}

function buildLlmInstructionCgPrompt(stanza = {}, manifest = {}, options = {}) {
    return cgPrompting.buildLlmInstructionCgPrompt(stanza, manifest, options);
}

async function collectStanzaReferenceImages(turnContext, tools, stanza = {}, manifest = {}) {
    return await cgPrompting.collectStanzaReferenceImages({
        turnContext,
        tools,
        stanza,
        manifest,
        normalizeProjectAssetPath,
        isGenericSpritePath
    });
}

async function buildCgRequestForStanza(turnContext, tools, manifest, stanza, settings, outputPath) {
    return await cgPrompting.buildCgRequestForStanza({
        turnContext,
        tools,
        manifest,
        stanza,
        settings,
        outputPath,
        normalizeProjectAssetPath,
        isGenericSpritePath,
        pluginId: PLUGIN_ID,
        describeError
    });
}

function mergeBackgroundPalettes(prepared = [], latest = []) {
    const entries = [];
    const add = (entry) => {
        const normalized = normalizePaletteEntry(entry);
        if (!normalized) return;
        const key = `${normalized.stanzaIndex}:${normalized.source}:${normalizeProjectAssetPath(normalized.path, 'background')}`;
        const existingIndex = entries.findIndex(candidate => (
            `${candidate.stanzaIndex}:${candidate.source}:${normalizeProjectAssetPath(candidate.path, 'background')}` === key
        ));
        if (existingIndex >= 0) entries[existingIndex] = normalized;
        else entries.push(normalized);
    };
    for (const entry of Array.isArray(prepared) ? prepared : []) add(entry);
    for (const entry of Array.isArray(latest) ? latest : []) add(entry);
    return entries.sort((left, right) => {
        const stanzaDiff = Number(left.stanzaIndex) - Number(right.stanzaIndex);
        if (stanzaDiff !== 0) return stanzaDiff;
        if (left.source === right.source) return 0;
        return left.source === 'cg' ? -1 : 1;
    });
}

function mergePreparedManifest(latest = {}, prepared = {}) {
    const latestAssets = latest.assets || {};
    const preparedAssets = prepared.assets || {};
    const latestBackgrounds = latestAssets.backgrounds || {};
    const preparedBackgrounds = preparedAssets.backgrounds || {};
    const latestErrors = Array.isArray(latest.errors) ? latest.errors : [];
    const preparedErrors = Array.isArray(prepared.errors) ? prepared.errors : [];

    return {
        ...latest,
        ...prepared,
        assets: {
            ...preparedAssets,
            ...latestAssets,
            ost: latestAssets.ost || preparedAssets.ost || null,
            sprites: Array.isArray(latestAssets.sprites) && latestAssets.sprites.length > 0
                ? latestAssets.sprites
                : (preparedAssets.sprites || []),
            backgroundPalettes: mergeBackgroundPalettes(preparedAssets.backgroundPalettes, latestAssets.backgroundPalettes),
            backgrounds: {
                ...preparedBackgrounds,
                ...latestBackgrounds,
                fallback: Array.isArray(latestBackgrounds.fallback) && latestBackgrounds.fallback.length > 0
                    ? latestBackgrounds.fallback
                    : (preparedBackgrounds.fallback || []),
                generated: Array.isArray(preparedBackgrounds.generated) && preparedBackgrounds.generated.length > 0
                    ? preparedBackgrounds.generated
                    : (latestBackgrounds.generated || [])
            }
        },
        errors: [...latestErrors, ...preparedErrors.slice(latestErrors.length)],
        updatedAt: nowIso()
    };
}

async function maybeGenerateCgAssets(turnContext, tools, manifest, settings, job = null) {
    if (!isCgGenerationEnabled(settings, manifest.request)) {
        manifest.cg.status = 'disabled';
        manifest.cg.modelTier = settings.cg_model_tier;
        return manifest;
    }
    if (!tools?.plugins?.isInstalled?.('cg_generator')) {
        manifest.cg.status = 'missing_plugin';
        return manifest;
    }

    const stanzas = Array.isArray(manifest.poem?.stanzas) ? manifest.poem.stanzas : [];
    if (stanzas.length === 0) {
        manifest.cg.status = 'skipped';
        return manifest;
    }

    manifest.cg.status = 'running';
    manifest.cg.modelTier = settings.cg_model_tier;
    manifest.cg.promptMode = normalizeCgPromptMode(manifest.request?.cgPromptMode || manifest.cg?.promptMode || settings.cg_prompt_mode);
    manifest.cg.results = Array.isArray(manifest.cg.results) ? manifest.cg.results : [];
    if (!manifest.assets.backgrounds) manifest.assets.backgrounds = { fallback: [], generated: [] };
    if (!Array.isArray(manifest.assets.backgrounds.generated)) manifest.assets.backgrounds.generated = [];

    const generationTasks = stanzas.map((stanza, stanzaOrderIndex) => async () => {
        const index = Number.isInteger(stanza.index) ? stanza.index : stanzaOrderIndex;
        const alreadyGenerated = manifest.assets.backgrounds.generated.some(entry => Number(entry.stanzaIndex) === index && entry.path);
        if (alreadyGenerated) return null;

        job?.throwIfCancelled?.();
        job?.progress?.(50 + Math.min(35, index * 8), `Generating cinematic background ${index + 1}/${stanzas.length}...`);

        const outputPath = toPosix(`${manifest.storage.relativePath}/cg_${manifest.requestId}_${index}.webp`);
        const cgPlan = await buildCgRequestForStanza(turnContext, tools, manifest, stanza, settings, outputPath);

        const result = await tools.plugins.tryCall('cg_generator', 'requestCustomCGToFile', [cgPlan.request], {
            silent: true,
            fallback: { ok: false, error: 'cg_generator unavailable' }
        });

        const normalizedResult = isPlainObject(result) ? result : { ok: false, error: 'cg_generator returned no result' };
        const resultEntry = {
            stanzaIndex: index,
            ok: normalizedResult.ok === true,
            outputPath: normalizedResult.outputPath || outputPath,
            error: normalizedResult.error || null,
            promptMode: cgPlan.promptMode,
            promptSource: cgPlan.promptSource,
            prompt: cgPlan.prompt,
            referenceNames: cgPlan.references.map(ref => ref.name).filter(Boolean),
            referencePaths: cgPlan.references.map(ref => ref.path).filter(Boolean),
            referenceCount: cgPlan.references.length,
            at: nowIso()
        };

        let generatedBackground = null;
        if (normalizedResult.ok && normalizedResult.outputPath) {
            generatedBackground = {
                stanzaIndex: index,
                path: normalizeProjectAssetPath(normalizedResult.outputPath),
                provider: normalizedResult.provider || null
            };
        }

        return { resultEntry, generatedBackground };
    });

    const taskResults = await Promise.all(generationTasks.map(task => task()));
    const existingResultKeys = new Set(manifest.cg.results.map(entry => Number(entry.stanzaIndex)));
    const existingBackgroundKeys = new Set(manifest.assets.backgrounds.generated.map(entry => Number(entry.stanzaIndex)));
    for (const taskResult of taskResults.filter(Boolean).sort((left, right) => {
        return Number(left.resultEntry?.stanzaIndex || 0) - Number(right.resultEntry?.stanzaIndex || 0);
    })) {
        const stanzaIndex = Number(taskResult.resultEntry?.stanzaIndex);
        if (!existingResultKeys.has(stanzaIndex)) {
            manifest.cg.results.push(taskResult.resultEntry);
            existingResultKeys.add(stanzaIndex);
        }
        if (taskResult.generatedBackground && !existingBackgroundKeys.has(stanzaIndex)) {
            manifest.assets.backgrounds.generated.push(taskResult.generatedBackground);
            existingBackgroundKeys.add(stanzaIndex);
        }
    }

    manifest.cg.status = manifest.assets.backgrounds.generated.length > 0 ? 'ready' : 'failed';
    manifest.updatedAt = nowIso();
    return manifest;
}

function getPrepJobKey(manifest) {
    return `${manifest.projectName || 'project'}:${manifest.storage?.storageTurnKey || manifest.turnNumber}:${manifest.requestId}`;
}

function startPreparationJob(turnContext, tools, pending, sourceTurns, settings) {
    const jobKey = getPrepJobKey(pending.manifest);
    if (ACTIVE_PREP_JOBS.has(jobKey)) return ACTIVE_PREP_JOBS.get(jobKey);

    const run = tools.jobs.withJob('Preparing arc cinematic...', {
        id: `arc_cinematic_${pending.requestId}`,
        scope: 'turn',
        allowStale: true,
        notifyOnComplete: false,
        rethrow: false
    }, async (job) => {
        let manifest = pending.manifest;
        try {
            job.progress(10, 'Writing cinematic poem...');
            const poem = await generatePoem(manifest, sourceTurns, tools, settings, turnContext);
            const latestBeforePoem = await readJsonFile(pending.absoluteManifestPath).catch(() => manifest);
            manifest = mergePreparedManifest(latestBeforePoem, {
                ...latestBeforePoem,
                status: 'poem_ready',
                poem: {
                    status: 'generated',
                    ...poem
                }
            });
            await writeJsonFile(pending.absoluteManifestPath, manifest);

            job.progress(45, 'Preparing cinematic images...');
            manifest = await maybeGenerateCgAssets(turnContext, tools, manifest, settings, job);
            manifest = await extractStanzaBackgroundPalettes(turnContext, tools, manifest, settings);
            const latestBeforeCgWrite = await readJsonFile(pending.absoluteManifestPath).catch(() => manifest);
            manifest.status = manifest.cg?.status === 'ready' ? 'ready' : 'ready_with_fallbacks';
            manifest = mergePreparedManifest(latestBeforeCgWrite, manifest);
            await writeJsonFile(pending.absoluteManifestPath, manifest);
            job.progress(100, 'Arc cinematic ready.');
            return manifest;
        } catch (error) {
            addManifestError(manifest, 'preparation', error);
            manifest.status = 'ready_with_fallbacks';
            try {
                await writeJsonFile(pending.absoluteManifestPath, manifest);
            } catch (_) {
                // Nothing useful to do; the job logger will capture the original error.
            }
            throw error;
        }
    }).finally(() => {
        ACTIVE_PREP_JOBS.delete(jobKey);
    });

    ACTIVE_PREP_JOBS.set(jobKey, run);
    return run;
}

async function enrichManifestForPlayback(turnContext, tools, manifest, sourceTurns, settings) {
    const refreshedDigest = buildSourceDigest(sourceTurns);
    if (refreshedDigest) manifest.sourceDigest = refreshedDigest;
    if (!manifest.poem || manifest.poem.status === 'fallback') {
        const existingTitle = manifest.poem?.title || manifest.request?.title || 'Arc Cinematic';
        const existingSubtitle = manifest.request?.subtitle || manifest.poem?.subtitle || '';
        manifest.poem = {
            status: 'fallback',
            title: existingTitle,
            subtitle: existingSubtitle,
            stanzas: buildFallbackStanzas(sourceTurns, manifest.request || {}, settings)
        };
    }

    const ost = await selectCinematicOst(turnContext, tools, manifest.request, settings);
    const sprites = await collectSpritePayload(turnContext, tools, sourceTurns);
    manifest.poem.stanzas = await resolveStanzaSpriteBeats(turnContext, tools, manifest.poem.stanzas, 3);
    const fallbackBackgrounds = collectBackgroundCandidates(turnContext, manifest);

    manifest.assets = manifest.assets || {};
    manifest.assets.ost = ost;
    manifest.assets.sprites = sprites;
    manifest.assets.backgrounds = manifest.assets.backgrounds || {};
    manifest.assets.backgrounds.fallback = fallbackBackgrounds.map((pathValue, index) => ({
        index,
        path: pathValue,
        source: 'vn'
    }));
    if (!Array.isArray(manifest.assets.backgrounds.generated)) {
        manifest.assets.backgrounds.generated = [];
    }
    await extractStanzaBackgroundPalettes(turnContext, tools, manifest, settings);
    manifest.playback = manifest.playback || {};
    manifest.playback.vfxEnabled = isIntroVfxRuntimeAvailable(tools, settings);
    const introVfx = await poemPrompting.collectAvailableIntroVfx(tools, settings);
    manifest.playback.availableIntroVfxIds = Array.isArray(introVfx.ids) && introVfx.ids.length > 0
        ? introVfx.ids
        : INTRO_VFX_IDS;
    manifest.playback.introStanzaVfxIds = manifest.playback.vfxEnabled
        ? normalizeIntroStanzaVfxIds(introVfx.primaryIds || PRIMARY_INTRO_STANZA_VFX_IDS)
        : [];
    manifest.updatedAt = nowIso();
    return manifest;
}

function buildPlaybackPayload(manifest = {}, descriptor = {}) {
    const poem = manifest.poem || {};
    const stanzas = Array.isArray(poem.stanzas) && poem.stanzas.length > 0
        ? poem.stanzas
        : buildFallbackStanzas([], manifest.request || {}, normalizeSettings());
    const generated = Array.isArray(manifest.assets?.backgrounds?.generated)
        ? manifest.assets.backgrounds.generated.filter(entry => entry?.path)
        : [];
    const fallback = Array.isArray(manifest.assets?.backgrounds?.fallback)
        ? manifest.assets.backgrounds.fallback.filter(entry => entry?.path || typeof entry === 'string')
        : [];
    const backgrounds = [...generated, ...fallback]
        .map((entry, index) => {
            const pathValue = typeof entry === 'string' ? entry : entry.path;
            return {
                index,
                stanzaIndex: Number.isInteger(entry?.stanzaIndex) ? entry.stanzaIndex : index,
                path: toBridgeAssetPath(pathValue, 'background'),
                source: entry?.source || (entry?.provider ? 'cg' : 'fallback')
            };
        })
        .filter(entry => entry.path);

    const sprites = (Array.isArray(manifest.assets?.sprites) ? manifest.assets.sprites : [])
        .map((entry, index) => ({
            index,
            name: entry.name || `Character ${index + 1}`,
            path: toBridgeAssetPath(entry.path, 'sprite')
        }))
        .filter(entry => entry.path && !isGenericSpriteEntry(entry));

    const ostPath = manifest.assets?.ost?.path || '';
    const availableIntroVfxIds = Array.isArray(manifest.playback?.availableIntroVfxIds) && manifest.playback.availableIntroVfxIds.length > 0
        ? manifest.playback.availableIntroVfxIds
        : INTRO_VFX_IDS;
    const introStanzaVfxIds = manifest.playback?.vfxEnabled === true
        ? normalizeIntroStanzaVfxIds([
            ...(Array.isArray(manifest.playback?.introStanzaVfxIds) ? manifest.playback.introStanzaVfxIds : []),
            ...PRIMARY_INTRO_STANZA_VFX_IDS
        ])
        : [];
    const introStanzaVfxSeed = createRuntimeIntroVfxSeed(manifest, descriptor);
    const introStanzaVfxSequence = buildIntroStanzaVfxSequence(
        stanzas.length,
        introStanzaVfxSeed,
        introStanzaVfxIds
    );
    const premiumReferenceCgPlayback = isPremiumReferenceCgPlayback(manifest);

    return {
        requestId: manifest.requestId || descriptor.interceptId || INTERCEPT_ID,
        type: 'intro',
        arcId: manifest.request?.arcId || 'default',
        title: selectArcTitle(manifest.request?.title, poem.generatedTitle || poem.title, 'Arc Cinematic'),
        subtitle: manifest.request?.subtitle || poem.subtitle || '',
        stanzas: stanzas.map((stanza, index) => ({
            index,
            lines: Array.isArray(stanza.lines) ? stanza.lines : [],
            mood: stanza.mood || manifest.request?.mood || '',
            relevantCharacters: normalizeStringArray(stanza.relevantCharacters || stanza.characters || [], 6),
            characterBeats: normalizeCharacterBeats(
                stanza.characterBeats || [],
                stanza.relevantCharacters || stanza.characters || [],
                ['neutral', ...(Array.isArray(stanza.characterBeats) ? stanza.characterBeats.map(beat => beat?.emotion).filter(Boolean) : [])]
            ),
            vfxBeat: normalizeVfxBeat(stanza.vfxBeat || stanza.vfx || {}, availableIntroVfxIds),
            sprites: (Array.isArray(stanza.sprites) ? stanza.sprites : [])
                .map((entry, spriteIndex) => ({
                    index: spriteIndex,
                    name: entry.name || `Character ${spriteIndex + 1}`,
                    emotion: entry.emotion || 'neutral',
                    resolvedEmotion: entry.resolvedEmotion || entry.emotion || 'neutral',
                    path: toBridgeAssetPath(entry.path, 'sprite')
                }))
                .filter(entry => entry.path && !isGenericSpriteEntry(entry)),
            environmentVibes: normalizeEnvironmentVibes(stanza.environmentVibes || {}, stanza.mood || ''),
            shaderPalette: findPlaybackPaletteForStanza(manifest, index),
            suppressSprites: premiumReferenceCgPlayback && hasGeneratedBackgroundForStanza(manifest, index),
            softenShadersOverImage: premiumReferenceCgPlayback && hasGeneratedBackgroundForStanza(manifest, index)
        })),
        ost: ostPath ? {
            path: toBridgeAssetPath(ostPath, 'ost'),
            label: path.posix.basename(normalizeProjectAssetPath(ostPath, 'ost')),
            source: manifest.assets.ost?.source || ''
        } : null,
        backgrounds,
        sprites,
        spriteCollageEnabled: sprites.length > 0,
        suppressSprites: premiumReferenceCgPlayback,
        softenShadersOverGeneratedImages: premiumReferenceCgPlayback,
        cgPlaybackMode: {
            modelTier: manifest.cg?.modelTier || '',
            promptMode: manifest.cg?.promptMode || '',
            premiumReference: premiumReferenceCgPlayback
        },
        maximumDurationSeconds: manifest.playback?.maximumDurationSeconds || 60,
        maximumDurationMs: (manifest.playback?.maximumDurationSeconds || 60) * 1000,
        vfxEnabled: manifest.playback?.vfxEnabled === true,
        availableIntroVfxIds,
        introStanzaVfxIds,
        introStanzaVfxSeed,
        introStanzaVfxSequence,
        introTransitionVfxIds: [],
        introTransitionVfxSequence: [],
        status: manifest.status || 'fallback'
    };
}

function stampLastRun(turnContext, tools, manifest, descriptor) {
    const state = getTurnStateBucket(tools);
    const marker = {
        requestId: manifest.requestId,
        type: 'intro',
        arcId: manifest.request?.arcId || 'default',
        turnNumber: turnContext?.turnNumber || null,
        storageTurnKey: manifest.storage?.storageTurnKey || null,
        manifestPath: getManifestProjectPath(
            {
                relativePath: manifest.storage?.relativePath || '',
                storageTurnKey: manifest.storage?.storageTurnKey || ''
            },
            manifest.requestId
        ),
        range: manifest.sourceRange || null,
        interceptId: descriptor?.interceptId || null,
        finalizedAt: nowIso()
    };
    state.lastRun = marker;
    if (!Array.isArray(state.runs)) state.runs = [];
    state.runs.push(marker);
    state.runs = state.runs.slice(-12);
    return marker;
}

function descriptorExists(turnContext, interceptId) {
    return (Array.isArray(turnContext?.output?.guiIntercepts) ? turnContext.output.guiIntercepts : [])
        .some(descriptor => descriptor?.interceptId === interceptId || descriptor?.id === interceptId);
}

function getManifestReadiness(manifest = {}) {
    const status = String(manifest?.status || '').trim().toLowerCase();
    const cgStatus = String(manifest?.cg?.status || '').trim().toLowerCase();
    const cgRequested = manifest?.cg?.requested === true || cgStatus === 'queued' || cgStatus === 'running';
    const cgPending = cgRequested && ['queued', 'running'].includes(cgStatus);
    const poemPending = status === 'queued';
    const generatedCount = Array.isArray(manifest?.assets?.backgrounds?.generated)
        ? manifest.assets.backgrounds.generated.filter(entry => entry?.path).length
        : 0;
    const ready = !poemPending && !cgPending;
    return {
        ready,
        pending: !ready,
        status: status || 'unknown',
        cgStatus: cgStatus || 'unknown',
        cgRequested,
        generatedCount,
        updatedAt: manifest?.updatedAt || manifest?.createdAt || null,
        title: manifest?.request?.title || manifest?.poem?.title || 'Arc Cinematic',
        requestId: manifest?.requestId || manifest?.request?.requestId || null
    };
}

async function getManifestStatusFromProjectPath(tools, manifestPath) {
    if (!manifestPath || !tools?.project?.readFile) {
        return {
            ready: true,
            pending: false,
            status: 'unavailable',
            cgStatus: 'unknown',
            cgRequested: false,
            generatedCount: 0,
            error: manifestPath ? 'project_read_unavailable' : 'missing_manifest_path'
        };
    }
    try {
        const manifest = JSON.parse(await tools.project.readFile(manifestPath));
        return getManifestReadiness(manifest);
    } catch (error) {
        return {
            ready: false,
            pending: true,
            status: 'read_error',
            cgStatus: 'unknown',
            cgRequested: false,
            generatedCount: 0,
            error: error.message
        };
    }
}

function registerPendingNoticeIntercept(turnContext, tools, pending, manifest, settings) {
    const readiness = getManifestReadiness(manifest);
    const mainInterceptId = pending.interceptId || `${INTERCEPT_ID}_${manifest.requestId}`;
    const interceptId = `${mainInterceptId}_pending_notice`;
    if (descriptorExists(turnContext, interceptId)) return null;

    return tools.gui.registerPersistentIntercept({
        interceptId,
        checkpoint: manifest.request?.playAt || 'before_first_dialogue',
        blocking: true,
        renderer: 'pixi',
        replayPolicy: 'every_enter',
        priority: 25,
        timeoutMs: 600000,
        autoDismiss: false,
        keepVNViewportDuringTakeover: true,
        keepVNChrome: true,
        visualState: {
            keepVNViewportDuringTakeover: true
        },
        payload: {
            requestId: manifest.requestId,
            manifestPath: pending.manifestPath,
            title: manifest.request?.title || manifest.poem?.title || 'Arc Cinematic',
            cgRequested: readiness.cgRequested,
            pollIntervalMs: 2500,
            initialStatus: readiness,
            maximumWaitMs: 600000,
            maximumDurationSeconds: settings.maximum_duration_seconds || 60
        },
        handlerRef: `guiIntercepts.${PENDING_NOTICE_INTERCEPT_ID}`
    });
}

async function finalizePendingRequest(turnContext, tools, pending, settings) {
    const manifest = await readJsonFile(pending.absoluteManifestPath).catch(() => pending.manifest);
    const range = manifest.sourceRange || pending.range;
    const sourceTurns = await collectSourceTurns(turnContext, tools, range);
    const enriched = await enrichManifestForPlayback(turnContext, tools, manifest, sourceTurns, settings);
    enriched.status = enriched.status === 'queued' ? 'ready_with_fallbacks' : enriched.status;
    await writeJsonFile(pending.absoluteManifestPath, enriched);

    const interceptId = pending.interceptId || `${INTERCEPT_ID}_${enriched.requestId}`;
    if (descriptorExists(turnContext, interceptId)) {
        return markPendingFinalized(tools, pending.requestId, { interceptId });
    }

    const playbackPayload = buildPlaybackPayload(enriched);
    const noticeDescriptor = registerPendingNoticeIntercept(turnContext, tools, pending, enriched, settings);
    if (noticeDescriptor) {
        tools?.logger?.runtime?.(`Registered arc cinematic pending notice '${noticeDescriptor.interceptId}' before '${interceptId}'.`);
    }
    const descriptor = tools.gui.registerPersistentIntercept({
        interceptId,
        checkpoint: enriched.request?.playAt || 'before_first_dialogue',
        blocking: true,
        renderer: 'pixi',
        replayPolicy: 'every_enter',
        priority: 30,
        timeoutMs: Math.max(300000, ((settings.maximum_duration_seconds || 60) * 1000) + 30000),
        autoDismiss: false,
        hideMainSpritesWhileVisible: true,
        visualState: {
            hideMainSpritesWhileVisible: true
        },
        payload: {
            requestId: enriched.requestId,
            manifestPath: pending.manifestPath,
            playbackPayload
        },
        handlerRef: `guiIntercepts.${INTERCEPT_ID}`
    });

    stampLastRun(turnContext, tools, enriched, descriptor);
    tools?.logger?.runtime?.(`Registered arc cinematic '${enriched.requestId}' at ${descriptor.checkpoint}.`);
    return markPendingFinalized(tools, pending.requestId, { interceptId: descriptor.interceptId });
}

async function finalizePendingRequests(turnContext, tools) {
    const settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
    if (!settings.enabled) return [];
    const bucket = getRuntimeBucket(tools);
    const pending = bucket.pendingRequests.filter(item => item && !item.finalized);
    const results = [];
    for (const item of pending) {
        try {
            results.push(await finalizePendingRequest(turnContext, tools, item, settings));
        } catch (error) {
            tools?.logger?.error?.('ArcCinematics', `Failed to finalize arc cinematic '${item.requestId}': ${error.message}`, error);
        }
    }
    return results;
}

function hasIntroScheduledForTurn(turnContext, tools) {
    const bucket = getRuntimeBucket(tools);
    if (bucket.pendingRequests.some(item => item && !item.finalized)) return true;
    if ((Array.isArray(turnContext?.output?.guiIntercepts) ? turnContext.output.guiIntercepts : [])
        .some(descriptor => descriptor?.pluginId === PLUGIN_ID || String(descriptor?.interceptId || '').startsWith(INTERCEPT_ID))) {
        return true;
    }
    const state = getTurnStateBucket(tools);
    return Number(state?.lastRun?.turnNumber) === Number(turnContext?.turnNumber || 0)
        && String(state?.lastRun?.type || '') === 'intro';
}

function buildForceIntroRequest(settings) {
    return {
        type: 'intro',
        arcId: 'debug_force_intro',
        reason: 'Debug Force Intro setting is enabled.',
        preferCg: isCgGenerationEnabled(settings, { preferCg: settings.prefer_cg })
    };
}

async function startAnnouncedArcCinematic(turnContext, tools, rawRequest = {}, settings = normalizeSettings()) {
    let stage = 'settings';
    try {
        if (!settings.enabled) {
            return { ok: false, status: 'disabled', error: 'arc_cinematics is disabled.' };
        }

        stage = 'normalize_request';
        const request = normalizeRequest(turnContext, rawRequest, settings);
        stage = 'resolve_source_range';
        const range = await resolveSourceRange(turnContext, tools, request, settings);
        stage = 'collect_source_turns';
        const sourceTurns = await collectSourceTurns(turnContext, tools, range);
        stage = 'resolve_storage';
        const storage = tools.project.getChatPluginStorage();
        stage = 'ensure_storage';
        await ensureStorage(storage);

        stage = 'write_manifest';
        const manifest = buildInitialManifest({ turnContext, request, range, sourceTurns, storage, settings });
        const absoluteManifestPath = getManifestAbsolutePath(storage, request.requestId);
        const manifestPath = getManifestProjectPath(storage, request.requestId);
        await writeJsonFile(absoluteManifestPath, manifest);

        stage = 'queue_request';
        const pending = addPendingRequest(tools, {
            requestId: request.requestId,
            interceptId: `${INTERCEPT_ID}_${request.requestId}`,
            manifestPath,
            absoluteManifestPath,
            range,
            finalized: false,
            manifest
        });

        stage = 'start_preparation_job';
        startPreparationJob(turnContext, tools, pending, sourceTurns, settings);

        return {
            ok: true,
            requestId: request.requestId,
            status: 'queued',
            storageTurnKey: storage.storageTurnKey,
            manifestPath
        };
    } catch (error) {
        if (error && typeof error === 'object') {
            error.arcCinematicsStage = error.arcCinematicsStage || stage;
        }
        throw error;
    }
}

async function requestArcCinematic(turnContext, tools, rawRequest = {}) {
    let stage = 'settings';
    try {
        const settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
        if (!settings.enabled) {
            return { ok: false, status: 'disabled', error: 'arc_cinematics is disabled.' };
        }
        if (!turnContext || typeof turnContext !== 'object') {
            return { ok: false, status: 'error', error: 'turnContext is required to announce an arc cinematic.' };
        }

        stage = 'normalize_request';
        const request = normalizeRequest(turnContext, rawRequest, settings);
        setAnnouncedArcRequest(turnContext, request);
        tools?.logger?.runtime?.(`Announced arc cinematic '${request.requestId}' for HOOK_PRE_WRITER.`);
        return {
            ok: true,
            requestId: request.requestId,
            status: 'announced'
        };
    } catch (error) {
        if (error && typeof error === 'object') {
            error.arcCinematicsStage = error.arcCinematicsStage || stage;
        }
        throw error;
    }
}

async function runTurnStart(turnContext, tools) {
    try {
        const settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
        if (!settings.force_intro) return;
        tools?.logger?.log?.(
            'Lifecycle',
            `HOOK_TURN_START fired. enabled=${settings.enabled} force_intro=${settings.force_intro} project=${turnContext?.projectName || 'unknown'} version=${DIAGNOSTIC_VERSION}`
        );
    } catch (error) {
        logArcError(tools, 'HOOK_TURN_START failed', error);
    }
}

async function runPreWriter(turnContext, tools) {
    try {
        const settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
        const announcedRequest = getAnnouncedArcRequest(turnContext);
        if (settings.force_intro || announcedRequest) {
            tools?.logger?.log?.(
                'Lifecycle',
                `HOOK_PRE_WRITER fired. enabled=${settings.enabled} force_intro=${settings.force_intro} announced=${!!announcedRequest} version=${DIAGNOSTIC_VERSION}`
            );
        }
        if (!settings.enabled) return;

        let request = announcedRequest;
        let source = 'announced';
        if (!request && settings.force_intro) {
            request = buildForceIntroRequest(settings);
            setAnnouncedArcRequest(turnContext, request);
            source = 'force_intro';
            tools?.logger?.log?.('Lifecycle', `Force Intro enabled: announcing debug intro before Writer. (${DIAGNOSTIC_VERSION})`, 'start');
            tools?.logger?.runtime?.('Force Intro enabled: announcing debug intro before Writer.');
        }
        if (!request) return;

        if (hasIntroScheduledForTurn(turnContext, tools)) {
            tools?.logger?.log?.('Lifecycle', 'Arc intro already pending/registered for this turn; skipping Pre-Writer start.');
            return;
        }

        const result = await startAnnouncedArcCinematic(turnContext, tools, request, settings);
        const bucket = getAnnouncementBucket(turnContext);
        if (bucket) {
            bucket.requestStatus = result?.ok ? 'queued' : result?.status || 'error';
            bucket.requestSource = source;
            bucket.requestId = result?.requestId || request.requestId || null;
            bucket.manifestPath = result?.manifestPath || null;
        }
        tools?.logger?.log?.('Lifecycle', `HOOK_PRE_WRITER arc intro result: ${JSON.stringify(result)}`);
    } catch (error) {
        logArcError(tools, 'HOOK_PRE_WRITER failed', error);
    }
}

async function runVnDialogueReady(turnContext, tools) {
    try {
        const settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
        const sequenceLength = Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence.length : 0;
        if (settings.force_intro) {
            tools?.logger?.log?.(
                'Lifecycle',
                `HOOK_VN_DIALOGUE_READY observed. enabled=${settings.enabled} force_intro=${settings.force_intro} sequence=${sequenceLength} version=${DIAGNOSTIC_VERSION}`
            );
        }
    } catch (error) {
        logArcError(tools, 'HOOK_VN_DIALOGUE_READY failed', error);
    }
}

async function runPostVnGeneration(turnContext, tools) {
    let settings = normalizeSettings();
    let pendingCount = 0;
    try {
        settings = normalizeSettings(tools?.settings?.getSelf?.() || {});
        const sequenceLength = Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence.length : 0;
        const existingIntercepts = Array.isArray(turnContext?.output?.guiIntercepts) ? turnContext.output.guiIntercepts.length : 0;
        pendingCount = getRuntimeBucket(tools).pendingRequests.filter(item => item && !item.finalized).length;
        if (settings.force_intro || pendingCount > 0) {
            tools?.logger?.log?.(
                'Lifecycle',
                `HOOK_POST_VN_GENERATION fired. enabled=${settings.enabled} force_intro=${settings.force_intro} sequence=${sequenceLength} pending=${pendingCount} existingIntercepts=${existingIntercepts} version=${DIAGNOSTIC_VERSION}`,
                'start'
            );
        }
        if (!settings.enabled) {
            if (settings.force_intro || pendingCount > 0) {
                tools?.logger?.log?.('Lifecycle', 'Arc Cinematics disabled; skipping post-VN registration.', 'end');
            }
            return;
        }
        const finalized = await finalizePendingRequests(turnContext, tools);
        const finalIntercepts = Array.isArray(turnContext?.output?.guiIntercepts) ? turnContext.output.guiIntercepts.length : 0;
        if (settings.force_intro || pendingCount > 0 || finalized.length > 0) {
            tools?.logger?.log?.(
                'Lifecycle',
                `HOOK_POST_VN_GENERATION complete. finalized=${finalized.length} finalIntercepts=${finalIntercepts}`,
                'end'
            );
        }
    } catch (error) {
        logArcError(tools, 'HOOK_POST_VN_GENERATION failed', error);
    }
}

async function buildGuiIntercept(context, tools, descriptor = {}) {
    const jsPath = path.join(__dirname, 'pixi_takeover.js');
    const js = await fs.readFile(jsPath, 'utf8');
    const manifest = await readManifestFromDescriptor(context, tools, descriptor);
    const payload = manifest
        ? buildPlaybackPayload(manifest, descriptor)
        : (descriptor?.payload?.playbackPayload || buildPlaybackPayload({}, descriptor));

    return {
        renderer: 'pixi',
        autoDismiss: false,
        visualState: {
            hideMainSpritesWhileVisible: true
        },
        payload,
        js
    };
}

async function buildPendingNoticeIntercept(context, tools, descriptor = {}) {
    const jsPath = path.join(__dirname, 'pixi_pending_notice.js');
    const js = await fs.readFile(jsPath, 'utf8');
    const payload = {
        ...(descriptor?.payload && typeof descriptor.payload === 'object' ? descriptor.payload : {})
    };
    if (payload.manifestPath) {
        payload.initialStatus = await getManifestStatusFromProjectPath(tools, payload.manifestPath);
    }
    return {
        renderer: 'pixi',
        autoDismiss: false,
        visualState: {
            keepVNViewportDuringTakeover: true
        },
        payload,
        js
    };
}

async function handleManifestStatusSocket(data, tools) {
    const manifestPath = String(data?.manifestPath || '').trim();
    const requestId = String(data?.requestId || '').trim();
    const nonce = String(data?.nonce || '').trim();
    const status = await getManifestStatusFromProjectPath(tools, manifestPath);
    tools.socket.emit('arc-cinematics-status-response', {
        nonce,
        requestId: requestId || status.requestId || null,
        manifestPath,
        ...status
    });
}

function getCapabilityPrompt() {
    return [
        'Arc Cinematics capability:',
        `- Announce a meaningful arc intro by setting turnContext.runtime.plugins.${PLUGIN_ID}.request, or by calling tools.plugins.call('${PLUGIN_ID}', 'requestArcCinematic', request) as a compatibility helper.`,
        '- The request is singular per turn; do not push an array of requests.',
        '- Heavy poem/CG preparation starts during HOOK_PRE_WRITER after the plugin sees the announced request.',
        '- It is passive; do not mention the cinematic to the Writer as story content.',
        '- Useful request fields: arcId, title, subtitle, reason, mood, styleHint, range, arcRangeLabel, preferCg, cgPromptMode.',
        '- cgPromptMode can be diffusion_positive, llm_instruction, or llm_instruction_with_references; settings default to diffusion_positive.',
        '- Image generation is skipped when CG Model Tier is none; shader intros can still run without generated images.',
        '- Shader intro effects run only when Enable Shaders is on and vn_pixijs_vfx is installed.',
        '- If VN PixiJS VFX is installed and arc cinematic VFX are enabled, the stanza planner may choose restrained per-stanza VFX; callers do not need to provide VFX commands.',
        '- The plugin is intro-only for now; request type and playAt are normalized to type="intro" and before_first_dialogue.'
    ].join('\n');
}

module.exports = {
    PLUGIN_ID,
    INTERCEPT_ID,
    PENDING_NOTICE_INTERCEPT_ID,
    SETTINGS_SCHEMA,
    normalizeSettings,
    normalizeRequest,
    normalizeProjectAssetPath,
    toBridgeAssetPath,
    splitIntoStanzas,
    findLastRunInTurns,
    resolveSourceRange,
    buildFallbackLines,
    buildFallbackStanzas,
    buildPoemMessages,
    getStorySoFarForPoem,
    buildDiffusionPromptFallback,
    buildPlaybackPayload,
    selectCinematicOst,
    requestArcCinematic,
    runTurnStart,
    runPreWriter,
    runPostVnGeneration,
    runVnDialogueReady,
    buildGuiIntercept,
    buildPendingNoticeIntercept,
    handleManifestStatusSocket,
    getCapabilityPrompt,
    getDiffusionPromptFallback,
    buildCgRequestForStanza,
    getManifestReadiness,
    _private: {
        collectBackgroundCandidates,
        collectSpritePayload,
        resolveStanzaSpriteBeats,
        normalizeCharacterBeats,
        normalizeSpriteEmotion,
        normalizeVfxBeat,
        isIntroVfxRuntimeAvailable,
        isCgGenerationEnabled,
        normalizeIntroStanzaVfxIds,
        buildIntroStanzaVfxSequence,
        normalizePoemResponse,
        buildCgRequestForStanza,
        compileDiffusionPositivePrompt,
        buildLlmInstructionCgPrompt,
        collectStanzaReferenceImages,
        extractStanzaBackgroundPalettes,
        buildPaletteImageCandidates,
        findPlaybackPaletteForStanza,
        isPremiumReferenceCgPlayback,
        hasGeneratedBackgroundForStanza,
        maybeGenerateCgAssets,
        getAnnouncedArcRequest,
        setAnnouncedArcRequest,
        startAnnouncedArcCinematic,
        findLastRunMarker,
        readLastRunMarkerFromTurn,
        startPreparationJob
    }
};
