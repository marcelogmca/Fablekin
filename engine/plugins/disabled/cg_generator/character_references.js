const fs = require('fs/promises');
const path = require('path');
const { normalizeText } = require('../../modules/utils.js');
const { findSprite, getProjectSpriteCatalog } = require('../../modules/vn_manager/rendering/sprite_finder.js');

async function getFileAsBase64(filePath) {
    try {
        const fileBuffer = await fs.readFile(filePath);
        return fileBuffer.toString('base64');
    } catch (_e) {
        return null;
    }
}

function normalizeCharacterNameForLookup(name) {
    if (typeof name !== 'string') return '';
    return normalizeText(name)
        .replace(/[^\w]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeVariantKey(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeMetadataScale(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function uniqueStrings(values = []) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
    }
    return out;
}

function getRootDirectory(turnContext) {
    return turnContext?.runtime?.rootDirectory || turnContext?.rootDirectory || '';
}

function getAbsoluteSpritePath(turnContext, spritePath) {
    if (typeof spritePath !== 'string' || !spritePath.trim()) return '';
    if (path.isAbsolute(spritePath)) return spritePath;

    const rootDirectory = getRootDirectory(turnContext);
    if (!rootDirectory) return '';

    const normalized = spritePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (normalized.startsWith('assets/')) return path.resolve(rootDirectory, normalized);
    return path.resolve(rootDirectory, 'assets', normalized);
}

async function getSpriteCatalog(turnContext) {
    const existingCatalog = turnContext?.runtime?.vnManager?.spriteCatalog;
    if (existingCatalog?.global?.allSprites) {
        return existingCatalog;
    }

    const { catalog } = await getProjectSpriteCatalog(getRootDirectory(turnContext), turnContext);
    return catalog || { global: {}, characters: {}, lookups: {} };
}

function findCatalogCharacter(catalog, characterName) {
    const normalized = normalizeCharacterNameForLookup(characterName);
    if (!catalog?.characters || !normalized) return null;

    if (catalog.characters[normalized]) return catalog.characters[normalized];

    const aliases = uniqueStrings([
        normalized,
        normalized.replace(/_/g, ''),
        normalized.split('_')[0]
    ]);
    for (const alias of aliases) {
        const keys = [
            ...(catalog.lookups?.byAlias?.[alias] || []),
            ...(catalog.lookups?.byFirstName?.[alias] || [])
        ];
        const hit = keys.find(key => catalog.characters[key]);
        if (hit) return catalog.characters[hit];
    }

    return null;
}

function getReferenceHint(options, characterName) {
    const key = normalizeCharacterNameForLookup(characterName);
    const hints = options?.referenceHints || options?.characterHints || null;
    if (!key || !hints) return {};
    if (hints instanceof Map) return hints.get(key) || {};
    return hints[key] || {};
}

function getVariantFiles(character, variantKey) {
    const normalizedVariant = normalizeVariantKey(variantKey);
    if (!character || !normalizedVariant || normalizedVariant === 'default') return [];
    const variantData = character.variantData?.[normalizedVariant];
    return Array.isArray(variantData?.files) ? variantData.files : [];
}

function getVariantBaseSprites(character, variantKey) {
    const normalizedVariant = normalizeVariantKey(variantKey);
    if (!character || !normalizedVariant || normalizedVariant === 'default') return [];
    const variantData = character.variantData?.[normalizedVariant];
    return Array.isArray(variantData?.baseSprites) ? variantData.baseSprites : [];
}

function pickReferenceSprite(catalog, characterName, variantKey = '') {
    const character = findCatalogCharacter(catalog, characterName);
    const referenceSprites = new Set(catalog?.global?.referenceSprites || []);
    if (!character || referenceSprites.size === 0) return '';

    const variantRefs = getVariantFiles(character, variantKey).filter(file => referenceSprites.has(file));
    const characterRefs = variantRefs.length > 0
        ? variantRefs
        : (character.files || []).filter(file => referenceSprites.has(file));
    if (characterRefs.length === 0) return '';

    const normalized = normalizeCharacterNameForLookup(characterName);
    return characterRefs.find(file => {
        const ext = path.extname(file);
        const base = path.basename(file, ext).toLowerCase();
        return base === `${normalized}_reference`;
    }) || characterRefs[0];
}

function pickIconSprite(catalog, characterName, variantKey = '') {
    const character = findCatalogCharacter(catalog, characterName);
    const iconSprites = new Set(catalog?.global?.iconSprites || []);
    if (!character || iconSprites.size === 0) return '';

    const variantIcons = getVariantFiles(character, variantKey).filter(file => iconSprites.has(file));
    const characterIcons = variantIcons.length > 0
        ? variantIcons
        : (character.files || []).filter(file => iconSprites.has(file));
    if (characterIcons.length === 0) return '';

    const normalized = normalizeCharacterNameForLookup(characterName);
    return characterIcons.find(file => {
        const ext = path.extname(file);
        const base = path.basename(file, ext).toLowerCase();
        return base === `${normalized}_icon`;
    }) || characterIcons[0];
}

function ensureSpriteFinderContext(turnContext) {
    if (!turnContext || typeof turnContext !== 'object') return turnContext;
    if (!turnContext.processed || typeof turnContext.processed !== 'object') {
        turnContext.processed = {};
    }
    return turnContext;
}

async function findProjectSprite(turnContext, characterName, sprites, allSprites) {
    if (!Array.isArray(sprites) || sprites.length === 0) return null;

    return await findSprite(
        characterName,
        'neutral',
        sprites,
        '',
        ensureSpriteFinderContext(turnContext),
        Array.isArray(allSprites) && allSprites.length > 0 ? allSprites : sprites
    );
}

function getCharacterMetadataScale(turnContext, characterName, hint = {}) {
    const hintedScale = normalizeMetadataScale(hint.metadataScale ?? hint.scale);
    if (hintedScale) return hintedScale;

    const key = normalizeCharacterNameForLookup(characterName);
    const metadataScale = turnContext?.runtime?.vnManager?.spriteMetadata?.characters?.[key]?.scale;
    return normalizeMetadataScale(metadataScale);
}

async function resolveCharacterReference(turnContext, characterName, options = {}) {
    const catalog = await getSpriteCatalog(turnContext);
    const hint = getReferenceHint(options, characterName);
    const variantKey = normalizeVariantKey(hint.variantKey || hint.variant || '');
    const referenceSprite = pickReferenceSprite(catalog, characterName, variantKey);
    const catalogCharacter = findCatalogCharacter(catalog, characterName);

    let spritePath = referenceSprite;
    let sourceType = referenceSprite ? 'reference' : '';

    if (!spritePath) {
        const variantSprites = getVariantBaseSprites(catalogCharacter, variantKey);
        const variantFiles = getVariantFiles(catalogCharacter, variantKey);
        const characterSprites = variantSprites.length > 0
            ? variantSprites
            : (Array.isArray(catalogCharacter?.baseSprites) ? catalogCharacter.baseSprites : []);
        const characterAllSprites = variantFiles.length > 0
            ? variantFiles
            : (Array.isArray(catalogCharacter?.files) ? catalogCharacter.files : characterSprites);
        const fallback = await findProjectSprite(
            turnContext,
            characterName,
            characterSprites,
            characterAllSprites
        );
        spritePath = fallback?.image || '';
        sourceType = spritePath ? 'sprite' : '';
    }

    if (!spritePath) {
        spritePath = pickIconSprite(catalog, characterName, variantKey);
        sourceType = spritePath ? 'icon' : '';
    }

    if (!spritePath) {
        const fallback = await findProjectSprite(
            turnContext,
            characterName,
            catalog?.global?.baseSprites || [],
            catalog?.global?.allSprites || []
        );
        spritePath = fallback?.image || '';
        sourceType = fallback?.genericProfile ? 'generic_profile' : (spritePath ? 'sprite' : '');
    }

    const absolutePath = getAbsoluteSpritePath(turnContext, spritePath);
    const b64 = absolutePath ? await getFileAsBase64(absolutePath) : null;
    if (!b64) return null;

    return {
        name: characterName,
        normalizedName: normalizeCharacterNameForLookup(characterName),
        b64,
        sourceType,
        variantKey: variantKey || '',
        metadataScale: getCharacterMetadataScale(turnContext, characterName, hint),
        sourcePath: absolutePath,
        sourceLabel: path.basename(spritePath)
    };
}

async function resolveCharacterReferences(turnContext, tools, characterNames = [], logLabel = 'Resolution', options = {}) {
    const resolved = [];
    const unresolved = [];

    for (const characterName of uniqueStrings(characterNames)) {
        const result = await resolveCharacterReference(turnContext, characterName, options);
        if (result) {
            resolved.push(result);
            const variantNote = result.variantKey ? ` variant=${result.variantKey}` : '';
            const scaleNote = result.metadataScale ? ` scale=${result.metadataScale}` : '';
            tools.logger.runtime(`[CG Generator] ${logLabel}: Resolved ${characterName} via ${result.sourceType} (${result.sourceLabel})${variantNote}${scaleNote}.`);
        } else {
            unresolved.push(characterName);
            tools.logger.runtime(`[CG Generator] ${logLabel}: Could not resolve sprite/reference for ${characterName}.`);
        }
    }

    return { resolved, unresolved };
}

module.exports = {
    normalizeCharacterNameForLookup,
    normalizeVariantKey,
    normalizeMetadataScale,
    resolveCharacterReferences,
    uniqueStrings
};
