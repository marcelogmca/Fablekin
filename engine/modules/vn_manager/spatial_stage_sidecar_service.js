const DEFAULT_METADATA = Object.freeze({
  perspective_scale_far: 1,
  perspective_scale_nearby: 1,
  shadow: {
    enabled: false,
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

const BACKGROUND_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.mp4',
  '.webm'
]);

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp'
]);

const { isForegroundOcclusionAsset } = require('./rendering/background_asset_helpers.js');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isPathInside(parentPath, childPath, pathModule) {
  const parent = pathModule.resolve(parentPath);
  const child = pathModule.resolve(childPath);
  const rel = pathModule.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !pathModule.isAbsolute(rel));
}

function stripUrlDecorators(rawPath) {
  return String(rawPath || '').trim().split(/[?#]/)[0].replace(/\\/g, '/');
}

function toFiniteNumber(value, fieldName, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function normalizeAngleMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'split_x' ? 'split_x' : 'single';
}

function normalizeHexColor(value, fieldName) {
  const raw = String(value || DEFAULT_METADATA.shadow.tint_color).trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    throw new Error(`${fieldName} must be a hex color like #000000.`);
  }
  return `#${match[1].toLowerCase()}`;
}

function normalizePoint(point, index) {
  const obj = ensureObject(point);
  if (!obj) throw new Error(`corners[${index}] must be an object.`);
  return {
    x: toFiniteNumber(obj.x, `corners[${index}].x`),
    y: toFiniteNumber(obj.y, `corners[${index}].y`)
  };
}

function normalizeShadow(rawShadow = {}) {
  const shadow = ensureObject(rawShadow) || {};
  const enabled = shadow.enabled === true;
  const angleDegrees = toFiniteNumber(
    shadow.angle_degrees ?? shadow.angleDegrees ?? DEFAULT_METADATA.shadow.angle_degrees,
    'shadow.angle_degrees',
    { min: -3600, max: 3600 }
  );
  return {
    enabled,
    angle_mode: normalizeAngleMode(shadow.angle_mode ?? shadow.angleMode ?? DEFAULT_METADATA.shadow.angle_mode),
    angle_degrees: angleDegrees,
    angle_degrees_left: toFiniteNumber(
      shadow.angle_degrees_left ?? shadow.angleDegreesLeft ?? angleDegrees,
      'shadow.angle_degrees_left',
      { min: -3600, max: 3600 }
    ),
    angle_degrees_right: toFiniteNumber(
      shadow.angle_degrees_right ?? shadow.angleDegreesRight ?? angleDegrees,
      'shadow.angle_degrees_right',
      { min: -3600, max: 3600 }
    ),
    strength: toFiniteNumber(
      shadow.strength ?? shadow.opacity ?? shadow.alpha ?? DEFAULT_METADATA.shadow.strength,
      'shadow.strength',
      { min: 0, max: 1 }
    ),
    length: toFiniteNumber(
      shadow.length ?? DEFAULT_METADATA.shadow.length,
      'shadow.length',
      { min: 0, max: 4 }
    ),
    blur: toFiniteNumber(
      shadow.blur ?? DEFAULT_METADATA.shadow.blur,
      'shadow.blur',
      { min: 0, max: 40 }
    ),
    tint_enabled: shadow.tint_enabled === true || shadow.tintEnabled === true,
    tint_color: normalizeHexColor(
      shadow.tint_color ?? shadow.tintColor ?? DEFAULT_METADATA.shadow.tint_color,
      'shadow.tint_color'
    ),
    tint_strength: toFiniteNumber(
      shadow.tint_strength ?? shadow.tintStrength ?? DEFAULT_METADATA.shadow.tint_strength,
      'shadow.tint_strength',
      { min: 0, max: 1 }
    )
  };
}

function normalizeSpatialStageSidecarMetadata(rawMetadata) {
  const metadata = ensureObject(rawMetadata);
  if (!metadata) throw new Error('metadata must be an object.');

  const rawCorners = Array.isArray(metadata.corners) ? metadata.corners : [];
  if (rawCorners.length < 4) {
    throw new Error('metadata.corners must contain at least four points.');
  }

  let perspectiveScaleFar = toFiniteNumber(
    metadata.perspective_scale_far ?? metadata.perspectiveScaleFar ?? DEFAULT_METADATA.perspective_scale_far,
    'perspective_scale_far',
    { min: 0.1, max: 4 }
  );
  let perspectiveScaleNearby = toFiniteNumber(
    metadata.perspective_scale_nearby ?? metadata.perspectiveScaleNearby ?? DEFAULT_METADATA.perspective_scale_nearby,
    'perspective_scale_nearby',
    { min: 0.1, max: 4 }
  );

  if (perspectiveScaleFar > perspectiveScaleNearby) {
    const tmp = perspectiveScaleFar;
    perspectiveScaleFar = perspectiveScaleNearby;
    perspectiveScaleNearby = tmp;
  }

  return {
    corners: rawCorners.slice(0, 4).map(normalizePoint),
    perspective_scale_far: perspectiveScaleFar,
    perspective_scale_nearby: perspectiveScaleNearby,
    shadow: normalizeShadow(metadata.shadow)
  };
}

function getCharacterNameFromSprite(spritePath, pathModule) {
  const filename = pathModule.basename(String(spritePath || ''), pathModule.extname(String(spritePath || '')));
  if (!filename) return null;
  return filename
    .replace(/_(?:blink|talk|talk_blink)$/i, '')
    .split('_')[0]
    .toLowerCase();
}

function isUsablePreviewSprite(spritePath, pathModule) {
  const filename = pathModule.basename(String(spritePath || '')).toLowerCase();
  if (!filename || filename.includes('generic')) return false;
  if (/(?:^|_)(?:blink|talk|talk_blink)\.[^.]+$/i.test(filename)) return false;
  return true;
}

function createSpatialStageSidecarService({
  path: pathModule,
  fs,
  getRootDirectory,
  getProjectSprites = async () => [],
  random = Math.random
}) {
  if (!pathModule) throw new Error('path module is required.');
  if (!fs) throw new Error('fs promises module is required.');

  function getProjectRoot() {
    const root = getRootDirectory?.();
    if (!root) throw new Error('Project not loaded.');
    return pathModule.resolve(root);
  }

  function getAssetsRoot() {
    return pathModule.resolve(getProjectRoot(), 'assets');
  }

  function toProjectAssetRelative(absolutePath) {
    const assetsRoot = getAssetsRoot();
    const resolved = pathModule.resolve(absolutePath);
    if (!isPathInside(assetsRoot, resolved, pathModule)) return resolved.replace(/\\/g, '/');
    return pathModule.relative(assetsRoot, resolved).replace(/\\/g, '/');
  }

  function resolveAssetPath(rawAssetPath, fieldName = 'backgroundPath') {
    const root = getProjectRoot();
    const assetsRoot = getAssetsRoot();
    const clean = stripUrlDecorators(rawAssetPath);
    if (!clean) throw new Error(`${fieldName} is required.`);
    if (/^(?:https?:|data:|blob:)/i.test(clean)) {
      throw new Error('Only project-local assets can be calibrated.');
    }

    let candidate = clean;
    const projectMarker = '/assets/';
    const markerIndex = candidate.toLowerCase().lastIndexOf(projectMarker);
    if (markerIndex >= 0) {
      candidate = candidate.slice(markerIndex + 1);
    }

    if (candidate.startsWith('projects/')) {
      const parts = candidate.split('/');
      const assetsIndex = parts.findIndex(part => part.toLowerCase() === 'assets');
      if (assetsIndex >= 0) {
        candidate = parts.slice(assetsIndex).join('/');
      }
    }

    const absolutePath = pathModule.isAbsolute(candidate)
      ? pathModule.resolve(candidate)
      : pathModule.resolve(root, candidate.startsWith('assets/') ? candidate : pathModule.join('assets', candidate));

    if (!isPathInside(assetsRoot, absolutePath, pathModule)) {
      throw new Error(`Resolved ${fieldName} is outside the project assets directory.`);
    }

    return absolutePath;
  }

  function resolveProjectAssetRelative(rawAssetPath, {
    allowedExtensions = null,
    fieldName = 'assetPath',
    strictAbsolute = false
  } = {}) {
    let absolutePath;
    if (strictAbsolute) {
      const clean = stripUrlDecorators(rawAssetPath);
      if (!clean) throw new Error(`${fieldName} is required.`);
      if (!pathModule.isAbsolute(clean)) {
        throw new Error(`${fieldName} must be an absolute project asset path.`);
      }
      absolutePath = pathModule.resolve(clean);
      if (!isPathInside(getAssetsRoot(), absolutePath, pathModule)) {
        throw new Error(`Selected ${fieldName} is outside the project assets directory.`);
      }
    } else {
      absolutePath = resolveAssetPath(rawAssetPath, fieldName);
    }
    const ext = pathModule.extname(absolutePath).toLowerCase();
    if (allowedExtensions && !allowedExtensions.has(ext)) {
      throw new Error(`Unsupported ${fieldName} extension '${ext || '(none)'}'.`);
    }
    if (fieldName === 'backgroundPath' && isForegroundOcclusionAsset(absolutePath)) {
      throw new Error('Foreground occlusion companions cannot be selected as backgrounds.');
    }
    return toProjectAssetRelative(absolutePath);
  }

  function resolveSidecarPath(backgroundPath) {
    const backgroundAbs = resolveAssetPath(backgroundPath, 'backgroundPath');
    const ext = pathModule.extname(backgroundAbs).toLowerCase();
    if (!BACKGROUND_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported background extension '${ext || '(none)'}'.`);
    }
    const sidecarAbs = pathModule.join(
      pathModule.dirname(backgroundAbs),
      `${pathModule.basename(backgroundAbs, ext)}.json`
    );
    if (!isPathInside(getAssetsRoot(), sidecarAbs, pathModule)) {
      throw new Error('Resolved sidecar path is outside the project assets directory.');
    }
    return {
      backgroundPath: backgroundAbs,
      sidecarPath: sidecarAbs,
      sidecarProjectPath: pathModule.relative(getProjectRoot(), sidecarAbs).replace(/\\/g, '/')
    };
  }

  async function readSidecar(backgroundPath) {
    const resolved = resolveSidecarPath(backgroundPath);
    let raw = null;
    try {
      raw = await fs.readFile(resolved.sidecarPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          success: true,
          metadata: null,
          sidecarPath: resolved.sidecarProjectPath
        };
      }
      throw error;
    }

    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
    return {
      success: true,
      metadata: normalizeSpatialStageSidecarMetadata(parsed),
      sidecarPath: resolved.sidecarProjectPath
    };
  }

  async function saveSidecar(backgroundPath, metadata) {
    const resolved = resolveSidecarPath(backgroundPath);
    const normalized = normalizeSpatialStageSidecarMetadata(metadata);
    await fs.mkdir(pathModule.dirname(resolved.sidecarPath), { recursive: true });
    await fs.writeFile(resolved.sidecarPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return {
      success: true,
      metadata: normalized,
      sidecarPath: resolved.sidecarProjectPath
    };
  }

  async function getPreviewSprite() {
    const sprites = await getProjectSprites();
    const candidates = (Array.isArray(sprites) ? sprites : [])
      .filter(spritePath => isUsablePreviewSprite(spritePath, pathModule));
    if (candidates.length === 0) {
      return { success: true, spritePath: null, characterName: null };
    }

    const index = Math.max(0, Math.min(candidates.length - 1, Math.floor(random() * candidates.length)));
    const spritePath = candidates[index];
    return {
      success: true,
      spritePath: toProjectAssetRelative(spritePath),
      characterName: getCharacterNameFromSprite(spritePath, pathModule)
    };
  }

  return {
    normalizeSpatialStageSidecarMetadata,
    BACKGROUND_EXTENSIONS,
    IMAGE_EXTENSIONS,
    resolveSidecarPath,
    resolveProjectAssetRelative,
    readSidecar,
    saveSidecar,
    getPreviewSprite
  };
}

module.exports = {
  createSpatialStageSidecarService,
  normalizeSpatialStageSidecarMetadata
};
