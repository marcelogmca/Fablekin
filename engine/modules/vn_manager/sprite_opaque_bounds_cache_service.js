const CACHE_SCHEMA_VERSION = 1;
const BOUNDS_ALGORITHM_VERSION = 1;
const DEFAULT_MAX_ANALYSIS_SIZE = 384;
const DEFAULT_ALPHA_THRESHOLD = 16;
const SAMPLE_PADDING = 2;
const CACHE_FILENAME = '.sprite-render-cache.json';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.avif'
]);

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isPathInside(parentPath, childPath, pathModule) {
  const parent = pathModule.resolve(parentPath);
  const child = pathModule.resolve(childPath);
  const relative = pathModule.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !pathModule.isAbsolute(relative));
}

function stripUrlDecorators(rawPath) {
  return String(rawPath || '').trim().split(/[?#]/)[0].replace(/\\/g, '/');
}

function makeEmptyCache(maxAnalysisSize = DEFAULT_MAX_ANALYSIS_SIZE) {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    algorithmVersion: BOUNDS_ALGORITHM_VERSION,
    maxAnalysisSize,
    entries: {}
  };
}

function normalizeBounds(rawBounds) {
  const bounds = ensureObject(rawBounds);
  if (!bounds) return null;

  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1) return null;
  if ((x + width) > 1.000001 || (y + height) > 1.000001) return null;

  return { x, y, width, height };
}

function normalizeCacheDocument(rawCache, expectedAnalysisSize = DEFAULT_MAX_ANALYSIS_SIZE) {
  const cache = ensureObject(rawCache);
  if (
    !cache
    || cache.schemaVersion !== CACHE_SCHEMA_VERSION
    || cache.algorithmVersion !== BOUNDS_ALGORITHM_VERSION
    || cache.maxAnalysisSize !== expectedAnalysisSize
  ) {
    return makeEmptyCache(expectedAnalysisSize);
  }

  const normalized = makeEmptyCache(expectedAnalysisSize);
  const entries = ensureObject(cache.entries) || {};
  for (const [assetPath, rawEntry] of Object.entries(entries)) {
    const entry = ensureObject(rawEntry);
    const bounds = normalizeBounds(entry?.boundsNormalized);
    if (!assetPath || !entry || typeof entry.fingerprint !== 'string' || !bounds) continue;
    normalized.entries[assetPath] = {
      fingerprint: entry.fingerprint,
      boundsNormalized: bounds,
      detected: entry.detected === true,
      sourceWidth: Math.max(1, Math.round(Number(entry.sourceWidth) || 1)),
      sourceHeight: Math.max(1, Math.round(Number(entry.sourceHeight) || 1)),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null
    };
  }
  return normalized;
}

function createSpriteOpaqueBoundsCacheService({
  path: pathModule,
  fs,
  getRootDirectory,
  getProjectName = null,
  sharp: sharpFactory = null,
  maxAnalysisSize = DEFAULT_MAX_ANALYSIS_SIZE,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD
}) {
  if (!pathModule) throw new Error('path module is required.');
  if (!fs) throw new Error('fs promises module is required.');

  const analysisSize = Math.max(64, Math.min(1024, Math.round(Number(maxAnalysisSize) || DEFAULT_MAX_ANALYSIS_SIZE)));
  const threshold = Math.max(0, Math.min(255, Math.round(Number(alphaThreshold) || DEFAULT_ALPHA_THRESHOLD)));
  const pending = new Map();
  let loadedCachePath = null;
  let cacheDocument = null;
  let cacheLoadQueue = Promise.resolve();
  let writeQueue = Promise.resolve();

  function getSharp() {
    if (sharpFactory) return sharpFactory;
    try {
      sharpFactory = require('sharp');
    } catch (error) {
      // Sharp's native binding can be missing/broken in some installs even
      // when the package resolves. Throwing here would be logged per sprite
      // without the real cause. Include the load failure explicitly.
      throw new Error(`sharp unavailable: ${error?.code || error?.message || error}`);
    }
    return sharpFactory;
  }

  function getProjectRoot() {
    const root = getRootDirectory?.();
    if (!root) throw new Error('Project not loaded.');
    return pathModule.resolve(root);
  }

  function getAssetsRoot() {
    return pathModule.resolve(getProjectRoot(), 'assets');
  }

  function getCachePath() {
    return pathModule.join(getAssetsRoot(), 'sprites', CACHE_FILENAME);
  }

  function resolveSpritePath(rawSpritePath) {
    const root = getProjectRoot();
    const assetsRoot = getAssetsRoot();
    let candidate = stripUrlDecorators(rawSpritePath);
    if (!candidate) throw new Error('spritePath is required.');

    // Accept the app's own loopback asset URLs
    // (http://127.0.0.1:<port>/projects/<name>/assets/...). The frontend
    // legitimately produces these via getAssetUrl(); the pathname maps
    // directly onto the project assets directory. Cross-project and remote
    // URLs keep failing closed below.
    const loopbackMatch = candidate.match(/^https?:\/\/([^/?#]+)([/?#].*)?$/i);
    if (loopbackMatch) {
      const host = String(loopbackMatch[1] || '').toLowerCase();
      const pathname = String(loopbackMatch[2] || '').split(/[?#]/)[0];
      if (/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) {
        const projectName = typeof getProjectName === 'function' ? String(getProjectName() || '') : '';
        const projectMatch = pathname.match(/^\/projects\/([^/]+)\/assets\/(.+)$/i);
        if (!projectMatch) {
          throw new Error('Only project-local sprite assets can be analyzed.');
        }
        if (projectName && projectMatch[1] !== projectName) {
          throw new Error('Sprite URL belongs to a different project.');
        }
        candidate = `assets/${decodeURIComponent(projectMatch[2]).replace(/^\/+/, '')}`;
      } else {
        throw new Error('Only project-local sprite assets can be analyzed.');
      }
    }

    if (/^(?:https?:|data:|blob:)/i.test(candidate)) {
      throw new Error('Only project-local sprite assets can be analyzed.');
    }

    const assetsMarker = '/assets/';
    const markerIndex = candidate.toLowerCase().lastIndexOf(assetsMarker);
    if (markerIndex >= 0) {
      candidate = candidate.slice(markerIndex + 1);
    }

    if (candidate.startsWith('projects/')) {
      const segments = candidate.split('/');
      const assetsIndex = segments.findIndex(segment => segment.toLowerCase() === 'assets');
      if (assetsIndex >= 0) candidate = segments.slice(assetsIndex).join('/');
    }

    const absolutePath = pathModule.isAbsolute(candidate)
      ? pathModule.resolve(candidate)
      : pathModule.resolve(root, candidate.startsWith('assets/') ? candidate : pathModule.join('assets', candidate));

    if (!isPathInside(assetsRoot, absolutePath, pathModule)) {
      throw new Error('Resolved sprite path is outside the project assets directory.');
    }

    const extension = pathModule.extname(absolutePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported sprite extension '${extension || '(none)'}.`);
    }

    return {
      absolutePath,
      cacheKey: pathModule.relative(assetsRoot, absolutePath).replace(/\\/g, '/'),
      cachePath: pathModule.join(assetsRoot, 'sprites', CACHE_FILENAME)
    };
  }

  function loadCache(cachePath = getCachePath()) {
    const work = cacheLoadQueue
      .catch(() => {})
      .then(async () => {
        if (cachePath === loadedCachePath && cacheDocument) {
          return { cachePath, cache: cacheDocument };
        }

        let parsed = null;
        try {
          const raw = await fs.readFile(cachePath, 'utf8');
          parsed = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
        } catch (error) {
          if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }

        loadedCachePath = cachePath;
        cacheDocument = normalizeCacheDocument(parsed, analysisSize);
        pending.clear();
        return { cachePath, cache: cacheDocument };
      });
    cacheLoadQueue = work.then(() => null, () => null);
    return work;
  }

  function makeFingerprint(stat) {
    return `${Number(stat?.size) || 0}:${Math.trunc(Number(stat?.mtimeMs) || 0)}`;
  }

  async function writeCache(cachePath, cache) {
    const snapshot = JSON.stringify(cache, null, 2) + '\n';
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(pathModule.dirname(cachePath), { recursive: true });
        const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
        try {
          await fs.writeFile(tempPath, snapshot, 'utf8');
          await fs.rename(tempPath, cachePath);
        } finally {
          await fs.unlink(tempPath).catch(() => {});
        }
      });
    return writeQueue;
  }

  async function analyzeSprite(absolutePath) {
    const sharp = getSharp();
    const image = sharp(absolutePath, { animated: false, failOn: 'none' });
    const metadata = await image.metadata();
    const { data, info } = await image
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .resize({
        width: analysisSize,
        height: analysisSize,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel?.nearest || 'nearest'
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = Math.max(1, Number(info?.width) || 1);
    const height = Math.max(1, Number(info?.height) || 1);
    const channels = Math.max(1, Number(info?.channels) || 4);
    const alphaChannel = Math.min(channels - 1, 3);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[((y * width) + x) * channels + alphaChannel];
        if (alpha < threshold) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) {
      return {
        boundsNormalized: { x: 0, y: 0, width: 1, height: 1 },
        detected: false,
        sourceWidth: Math.max(1, Math.round(Number(metadata?.width) || width)),
        sourceHeight: Math.max(1, Math.round(Number(metadata?.height) || height))
      };
    }

    minX = Math.max(0, minX - SAMPLE_PADDING);
    minY = Math.max(0, minY - SAMPLE_PADDING);
    maxX = Math.min(width - 1, maxX + SAMPLE_PADDING);
    maxY = Math.min(height - 1, maxY + SAMPLE_PADDING);

    return {
      boundsNormalized: {
        x: minX / width,
        y: minY / height,
        width: (maxX - minX + 1) / width,
        height: (maxY - minY + 1) / height
      },
      detected: true,
      sourceWidth: Math.max(1, Math.round(Number(metadata?.width) || width)),
      sourceHeight: Math.max(1, Math.round(Number(metadata?.height) || height))
    };
  }

  async function getOrCreate(rawSpritePath) {
    const resolved = resolveSpritePath(rawSpritePath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error('Resolved sprite path is not a file.');
    const fingerprint = makeFingerprint(stat);
    const { cachePath, cache } = await loadCache(resolved.cachePath);
    const cached = cache.entries[resolved.cacheKey];
    if (cached?.fingerprint === fingerprint && normalizeBounds(cached.boundsNormalized)) {
      return {
        success: true,
        cacheHit: true,
        assetPath: resolved.cacheKey,
        boundsNormalized: cached.boundsNormalized,
        detected: cached.detected === true,
        sourceWidth: cached.sourceWidth,
        sourceHeight: cached.sourceHeight
      };
    }

    const pendingKey = `${cachePath}|${resolved.cacheKey}|${fingerprint}`;
    if (pending.has(pendingKey)) return pending.get(pendingKey);

    const work = (async () => {
      const analyzed = await analyzeSprite(resolved.absolutePath);
      const entry = {
        fingerprint,
        ...analyzed,
        updatedAt: new Date().toISOString()
      };
      cache.entries[resolved.cacheKey] = entry;
      await writeCache(cachePath, cache);
      return {
        success: true,
        cacheHit: false,
        assetPath: resolved.cacheKey,
        ...analyzed
      };
    })().finally(() => pending.delete(pendingKey));

    pending.set(pendingKey, work);
    return work;
  }

  return {
    getOrCreate,
    resolveSpritePath,
    getCachePath
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  BOUNDS_ALGORITHM_VERSION,
  DEFAULT_MAX_ANALYSIS_SIZE,
  normalizeBounds,
  createSpriteOpaqueBoundsCacheService
};
