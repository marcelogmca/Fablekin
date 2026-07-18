const path = require('path');

const FOREGROUND_OCCLUSION_SUFFIX = '_foreground';
const FOREGROUND_OCCLUSION_IMAGE_EXTENSIONS = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp'
]);

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function stripUrlDecorators(value) {
  return normalizeSlashes(value).split(/[?#]/)[0];
}

function isForegroundOcclusionAsset(assetPath) {
  const clean = stripUrlDecorators(assetPath);
  if (!clean) return false;
  const filename = clean.split('/').pop() || '';
  const parsed = path.posix.parse(filename);
  return parsed.name.toLowerCase().endsWith(FOREGROUND_OCCLUSION_SUFFIX);
}

function filterForegroundOcclusionAssets(assetPaths) {
  if (!Array.isArray(assetPaths)) return [];
  return assetPaths.filter(assetPath => !isForegroundOcclusionAsset(assetPath));
}

function getForegroundOcclusionCandidates(backgroundPath, extensions = FOREGROUND_OCCLUSION_IMAGE_EXTENSIONS) {
  const clean = stripUrlDecorators(backgroundPath);
  if (!clean || isForegroundOcclusionAsset(clean)) return [];

  const slashIndex = clean.lastIndexOf('/');
  const dir = slashIndex >= 0 ? clean.slice(0, slashIndex + 1) : '';
  const filename = slashIndex >= 0 ? clean.slice(slashIndex + 1) : clean;
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return [];

  const base = filename.slice(0, dotIndex);
  const seen = new Set();
  return extensions
    .map(ext => `${dir}${base}${FOREGROUND_OCCLUSION_SUFFIX}${ext}`)
    .filter(candidate => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

module.exports = {
  FOREGROUND_OCCLUSION_SUFFIX,
  FOREGROUND_OCCLUSION_IMAGE_EXTENSIONS,
  filterForegroundOcclusionAssets,
  getForegroundOcclusionCandidates,
  isForegroundOcclusionAsset
};
