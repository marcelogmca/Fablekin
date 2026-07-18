const path = require('path');
const fsSync = require('fs');
const { readSettings, listFilesRecursive, relativizeAssetPath } = require('../../utils.js');
const {
    findSprite,
    buildSpriteCatalog,
    getProjectSpriteCatalog
} = require('../../vn_manager/rendering/sprite_finder.js');
const {
    loadSpriteMetadataRegistry,
    normalizeSpriteToken
} = require('../../vn_manager/rendering/sprite_metadata.js');
const { filterForegroundOcclusionAssets } = require('../../vn_manager/rendering/background_asset_helpers.js');

const VALID_EXTENSIONS = {
    sprites: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
    backgrounds: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.webm'],
    ost: ['.mp3', '.ogg', '.wav']
};

const SCAN_DEPTHS = {
    sprites: 3,
    backgrounds: 2,
    ost: 2
};

const RUNTIME_KEYS = {
    sprites: 'sprites',
    backgrounds: 'backgrounds',
    ost: 'osts'
};

const RUNTIME_EXTRA_KEYS = {
    sprites: 'extraSprites',
    backgrounds: 'extraBackgrounds',
    ost: 'extraOsts'
};

const ASSET_KIND_PREFIXES = {
    sprite: 'sprites',
    sprites: 'sprites',
    background: 'backgrounds',
    backgrounds: 'backgrounds',
    ost: 'ost',
    voice: 'voices',
    voices: 'voices'
};

function isPathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function toPosix(raw) {
    return String(raw || '').replace(/\\/g, '/');
}

function isRemoteRef(assetRef) {
    const text = String(assetRef || '').trim().toLowerCase();
    return text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:');
}

function encodePathSegments(relPath) {
    return String(relPath || '')
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function isAssetSubPath(cleanPath) {
    return cleanPath.startsWith('sprites/')
        || cleanPath.startsWith('backgrounds/')
        || cleanPath.startsWith('ost/')
        || cleanPath.startsWith('voices/');
}

function normalizeAssetKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase();
    return ASSET_KIND_PREFIXES[normalized] || '';
}

function applyAssetKind(projectRelativePath, kind) {
    const clean = String(projectRelativePath || '').replace(/^\/+/, '');
    if (!clean) return '';
    if (clean.startsWith('assets/') || clean.startsWith('plugins/')) return clean;
    if (isAssetSubPath(clean)) return `assets/${clean}`;

    const assetKind = normalizeAssetKind(kind);
    if (assetKind) return `assets/${assetKind}/${clean}`;
    return `assets/${clean}`;
}

function stripProjectsPrefix(cleanPath, projectName) {
    if (!cleanPath.startsWith('projects/')) return cleanPath;
    const parts = cleanPath.split('/');
    if (parts.length < 3) return cleanPath;
    const targetProject = String(projectName || '').toLowerCase();
    const fromPathProject = String(parts[1] || '').toLowerCase();
    if (targetProject && fromPathProject && fromPathProject !== targetProject) return cleanPath;
    return parts.slice(2).join('/');
}

function normalizeProjectRelativePath(assetRef, projectRoot, projectName) {
    if (!assetRef) return '';
    if (isRemoteRef(assetRef)) return String(assetRef).trim();

    const raw = String(assetRef).trim().replace(/^file:\/\/\/?/i, '');
    if (!raw) return '';

    if (path.isAbsolute(raw)) {
        if (projectRoot && isPathInsideRoot(raw, projectRoot)) {
            return toPosix(path.relative(projectRoot, raw));
        }
        const relativizedAssets = relativizeAssetPath(raw, projectRoot, true);
        if (relativizedAssets && !path.isAbsolute(relativizedAssets)) {
            return toPosix(relativizedAssets);
        }
        return toPosix(raw);
    }

    let clean = toPosix(raw).replace(/^\/+/, '');
    clean = stripProjectsPrefix(clean, projectName);

    const marker = 'workspace/projects/';
    const markerIndex = clean.toLowerCase().lastIndexOf(marker);
    if (markerIndex !== -1) {
        const tail = clean.slice(markerIndex + marker.length);
        const segments = tail.split('/').filter(Boolean);
        if (segments.length >= 2) {
            clean = segments.slice(1).join('/');
        }
    }

    if (clean.startsWith('assets/') || clean.startsWith('plugins/')) {
        return clean;
    }

    if (isAssetSubPath(clean)) {
        return `assets/${clean}`;
    }

    return clean;
}

function toAssetRelativePath(projectRelativePath) {
    const clean = String(projectRelativePath || '').replace(/^\/+/, '');
    if (clean.startsWith('assets/')) return clean.slice('assets/'.length);
    return clean;
}

function dedupe(list) {
    const out = [];
    const seen = new Set();
    for (const entry of list || []) {
        const key = String(entry || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function createAssetFormatter({
    projectRoot,
    projectName,
    resolvePath,
    resolveUrl
}) {
    return (entry, format = 'project', options = {}) => {
        const normalized = normalizeProjectRelativePath(entry, projectRoot, projectName);
        if (!normalized) return '';

        if (format === 'project') return normalized;
        if (format === 'asset') return toAssetRelativePath(normalized);
        if (format === 'url') return resolveUrl(normalized, { ...options, assumeProjectRelative: true });

        if (format === 'absolute') {
            if (path.isAbsolute(normalized)) return toPosix(normalized);
            const absolute = resolvePath(normalized, { ...options, assumeProjectRelative: true, throwOnInvalid: false });
            return absolute ? toPosix(absolute) : '';
        }

        return normalized;
    };
}

function buildAssetsTools({
    pluginManager,
    turnContext,
    context,
    resolvedRoot
}) {
    const projectName = context?.projectName || pluginManager?.staticDataManager?.projectName || 'default_project';
    const projectRoot = resolvedRoot || context?.rootDirectory || turnContext?.rootDirectory || null;
    let spriteMetadataPromise = null;

    function getServerBaseUrl() {
        const fromEnv = process.env.FABLEKIN_SOCKET_URL;
        if (fromEnv && typeof fromEnv === 'string') {
            return fromEnv.replace(/\/$/, '');
        }
        const infrastructure = readSettings()?.infrastructure || {};
        const host = infrastructure.socket_host || '127.0.0.1';
        const port = infrastructure.socket_port || 14541;
        return `http://${host}:${port}`;
    }

    function resolvePath(assetRef, options = {}) {
        const {
            assumeProjectRelative = false,
            throwOnInvalid = true,
            kind = null
        } = options;

        if (!projectRoot) {
            if (throwOnInvalid) throw new Error('tools.assets.resolvePath failed: No project root available.');
            return '';
        }

        if (!assetRef) return '';
        if (isRemoteRef(assetRef)) return '';

        const normalized = assumeProjectRelative
            ? String(assetRef || '')
            : normalizeProjectRelativePath(assetRef, projectRoot, projectName);
        if (!normalized) return '';

        if (path.isAbsolute(normalized)) {
            const absoluteNormalized = path.resolve(normalized);
            if (!isPathInsideRoot(absoluteNormalized, projectRoot)) {
                if (throwOnInvalid) {
                    throw new Error(`tools.assets.resolvePath denied path outside project root: ${absoluteNormalized}`);
                }
                return '';
            }
            return absoluteNormalized;
        }

        const projectRelative = applyAssetKind(normalized, kind);
        const target = path.resolve(projectRoot, projectRelative);
        if (!isPathInsideRoot(target, projectRoot)) {
            if (throwOnInvalid) {
                throw new Error(`tools.assets.resolvePath denied path outside project root: ${target}`);
            }
            return '';
        }
        return target;
    }

    function resolveUrl(assetRef, options = {}) {
        if (!assetRef) return '';
        if (isRemoteRef(assetRef)) return String(assetRef).trim();

        const {
            base = 'plugin',
            from = null,
            fromIsFile = null,
            projectNameOverride = projectName,
            assumeProjectRelative = false,
            kind = null
        } = options;

        const normalized = assumeProjectRelative
            ? String(assetRef || '')
            : normalizeProjectRelativePath(assetRef, projectRoot, projectNameOverride);
        if (!normalized) return '';
        if (path.isAbsolute(normalized)) return toPosix(normalized);

        const projectRelative = applyAssetKind(normalized, kind);

        if (base === 'server') {
            const serverBase = getServerBaseUrl();
            return `${serverBase}/projects/${encodeURIComponent(projectNameOverride)}/${encodePathSegments(projectRelative)}`;
        }

        if (base === 'relative') {
            if (!from) {
                throw new Error('tools.assets.resolveUrl with base=relative requires options.from.');
            }
            const fromAbsolute = path.isAbsolute(from)
                ? path.resolve(from)
                : path.resolve(process.cwd(), from);
            const fromLooksFile = typeof fromIsFile === 'boolean'
                ? fromIsFile
                : !!path.extname(fromAbsolute);
            const fromDir = fromLooksFile ? path.dirname(fromAbsolute) : fromAbsolute;
            const target = resolvePath(projectRelative, { assumeProjectRelative: true });
            let relativePath = toPosix(path.relative(fromDir, target));
            if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
            return relativePath;
        }

        if (base === 'vnViewer') {
            return projectRelative;
        }

        // Default plugin-injected frontend path:
        // engine/plugins/[pluginId] -> ../../../workspace/projects/[project]/...
        return `../../../workspace/projects/${projectNameOverride}/${projectRelative}`;
    }

    const formatEntry = createAssetFormatter({
        projectRoot,
        projectName,
        resolvePath,
        resolveUrl
    });

    async function scanKind(kind) {
        if (!projectRoot) return [];
        const extensions = VALID_EXTENSIONS[kind];
        const maxDepth = SCAN_DEPTHS[kind];
        const folderName = kind === 'ost' ? 'ost' : kind;
        const targetDir = path.join(projectRoot, 'assets', folderName);
        if (!fsSync.existsSync(targetDir)) return [];
        const files = await listFilesRecursive(targetDir, extensions, 0, maxDepth);
        return (files || [])
            .map(file => normalizeProjectRelativePath(file, projectRoot, projectName))
            .filter(Boolean);
    }

    function collectRuntimeKind(kind, includeExtra = true) {
        const runtimeAssets = context?.runtime?.assets || {};
        const primary = Array.isArray(runtimeAssets[RUNTIME_KEYS[kind]]) ? runtimeAssets[RUNTIME_KEYS[kind]] : [];
        const extras = includeExtra && Array.isArray(runtimeAssets[RUNTIME_EXTRA_KEYS[kind]])
            ? runtimeAssets[RUNTIME_EXTRA_KEYS[kind]]
            : [];
        return [...primary, ...extras]
            .map(entry => normalizeProjectRelativePath(entry, projectRoot, projectName))
            .filter(Boolean);
    }

    async function listKind(kind, options = {}) {
        const {
            source = 'auto',
            includeExtra = true,
            format = 'project'
        } = options;

        let entries = [];
        if (source === 'runtime') {
            entries = collectRuntimeKind(kind, includeExtra);
        } else if (source === 'filesystem') {
            entries = await scanKind(kind);
        } else {
            const runtimeEntries = collectRuntimeKind(kind, includeExtra);
            if (runtimeEntries.length > 0) {
                entries = runtimeEntries;
            } else {
                entries = await scanKind(kind);
            }
        }

        if (kind === 'backgrounds') {
            entries = filterForegroundOcclusionAssets(entries);
        }

        const formatted = entries
            .map(entry => formatEntry(entry, format, options))
            .filter(Boolean);

        return dedupe(formatted);
    }

    async function getSpriteCatalog(options = {}) {
        const { source = 'auto' } = options;
        if (!projectRoot) return null;

        if (source === 'filesystem') {
            const spriteProjectPaths = await listKind('sprites', { source: 'filesystem', format: 'asset' });
            return buildSpriteCatalog(spriteProjectPaths);
        }

        const { catalog } = await getProjectSpriteCatalog(projectRoot, context);
        if (catalog) return catalog;

        const fallbackProjectPaths = await listKind('sprites', { source: 'filesystem', format: 'asset' });
        if (fallbackProjectPaths.length === 0) return null;
        return buildSpriteCatalog(fallbackProjectPaths);
    }

    async function getSpriteMetadata() {
        if (!spriteMetadataPromise) {
            spriteMetadataPromise = (async () => {
                const runtimeMetadata = context?.runtime?.vnManager?.spriteMetadata;
                if (runtimeMetadata?.characters && typeof runtimeMetadata.characters === 'object') {
                    return runtimeMetadata;
                }

                const spritePaths = await listKind('sprites', { source: 'filesystem', format: 'absolute' });
                return loadSpriteMetadataRegistry(spritePaths);
            })().catch(error => {
                spriteMetadataPromise = null;
                throw error;
            });
        }

        return spriteMetadataPromise;
    }

    async function getCharacterSpriteMetadata(characterName) {
        const characterKey = normalizeSpriteToken(characterName);
        if (!characterKey) return null;

        const registry = await getSpriteMetadata();
        return registry?.characters?.[characterKey] || null;
    }

    async function findCharacterSprite(characterName, emotion = null, options = {}) {
        if (!characterName) return { found: false, image: null };
        const spriteCatalog = await getSpriteCatalog({ source: options.source || 'auto' });
        const allSprites = Array.isArray(spriteCatalog?.global?.allSprites) ? spriteCatalog.global.allSprites : [];
        const baseSprites = Array.isArray(spriteCatalog?.global?.baseSprites) && spriteCatalog.global.baseSprites.length > 0
            ? spriteCatalog.global.baseSprites
            : allSprites;

        const spriteTurnContext = (context && typeof context === 'object') ? context : {};
        if (!spriteTurnContext.processed || typeof spriteTurnContext.processed !== 'object') {
            spriteTurnContext.processed = {};
        }
        if (!(spriteTurnContext.processed.characterGenders instanceof Map)) {
            spriteTurnContext.processed.characterGenders = new Map();
        }
        if (!spriteTurnContext.runtime || typeof spriteTurnContext.runtime !== 'object') {
            spriteTurnContext.runtime = {};
        }
        if (!spriteTurnContext.projectName) {
            spriteTurnContext.projectName = projectName;
        }

        const result = await findSprite(
            characterName,
            emotion || 'neutral',
            baseSprites,
            context?.input?.playerCharacterName || null,
            spriteTurnContext,
            allSprites,
            Number.isInteger(options.dialogueIndex) ? options.dialogueIndex : null
        );

        const image = result?.image || null;
        const projectRelative = image ? normalizeProjectRelativePath(image, projectRoot, projectName) : '';
        const assetRelative = projectRelative ? toAssetRelativePath(projectRelative) : '';
        const absolutePath = projectRelative
            ? resolvePath(projectRelative, { assumeProjectRelative: true, throwOnInvalid: false })
            : '';

        return {
            found: !!image,
            image: projectRelative || image,
            assetPath: assetRelative || image,
            absolutePath: absolutePath || '',
            url: projectRelative ? resolveUrl(projectRelative, { assumeProjectRelative: true }) : '',
            gender: result?.gender || null,
            rotations: Array.isArray(result?.rotations) ? result.rotations : []
        };
    }

    return {
        listSprites: async (options = {}) => listKind('sprites', options),
        listBackgrounds: async (options = {}) => listKind('backgrounds', options),
        listOst: async (options = {}) => listKind('ost', options),
        resolvePath,
        resolveUrl,
        getSpriteCatalog,
        getSpriteMetadata,
        getCharacterSpriteMetadata,
        findCharacterSprite
    };
}

module.exports = {
    buildAssetsTools
};
