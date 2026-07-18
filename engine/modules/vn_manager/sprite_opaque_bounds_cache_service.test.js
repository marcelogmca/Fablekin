const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  CACHE_SCHEMA_VERSION,
  BOUNDS_ALGORITHM_VERSION,
  createSpriteOpaqueBoundsCacheService
} = require('./sprite_opaque_bounds_cache_service.js');

async function createTestSprite(spritePath, rect = { x: 20, y: 10, width: 50, height: 70 }) {
  const svg = Buffer.from(`
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="rgba(0,0,0,0)" />
      <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="rgba(255,255,255,1)" />
    </svg>
  `);
  await sharp(svg).png().toFile(spritePath);
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-sprite-bounds-'));
  const spritesDir = path.join(root, 'assets', 'sprites');
  const spritePath = path.join(spritesDir, 'hero_neutral.png');
  await fs.mkdir(spritesDir, { recursive: true });

  try {
    await createTestSprite(spritePath);
    const service = createSpriteOpaqueBoundsCacheService({
      path,
      fs,
      sharp,
      getRootDirectory: () => root,
      maxAnalysisSize: 64
    });

    const first = await service.getOrCreate('sprites/hero_neutral.png');
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.cacheHit, false);
    assert.strictEqual(first.detected, true);
    assert(first.boundsNormalized.x <= 0.2, 'padding should not crop the left opaque edge');
    assert(first.boundsNormalized.y <= 0.1, 'padding should not crop the top opaque edge');
    assert(first.boundsNormalized.x + first.boundsNormalized.width >= 0.7, 'padding should not crop the right opaque edge');
    assert(first.boundsNormalized.y + first.boundsNormalized.height >= 0.8, 'padding should not crop the bottom opaque edge');

    const cachePath = path.join(spritesDir, '.sprite-render-cache.json');
    const persisted = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    assert.strictEqual(persisted.schemaVersion, CACHE_SCHEMA_VERSION);
    assert.strictEqual(persisted.algorithmVersion, BOUNDS_ALGORITHM_VERSION);
    assert(persisted.entries['sprites/hero_neutral.png']);

    const reloadedService = createSpriteOpaqueBoundsCacheService({
      path,
      fs,
      sharp: () => { throw new Error('persistent cache miss'); },
      getRootDirectory: () => root,
      maxAnalysisSize: 64
    });
    const second = await reloadedService.getOrCreate('sprites/hero_neutral.png');
    assert.strictEqual(second.cacheHit, true);
    assert.deepStrictEqual(second.boundsNormalized, first.boundsNormalized);

    await new Promise(resolve => setTimeout(resolve, 20));
    await createTestSprite(spritePath, { x: 5, y: 5, width: 20, height: 20 });
    const changed = await service.getOrCreate('sprites/hero_neutral.png');
    assert.strictEqual(changed.cacheHit, false, 'changed files must invalidate persisted bounds');
    assert(changed.boundsNormalized.width < first.boundsNormalized.width);

    await assert.rejects(
      () => service.getOrCreate('../outside.png'),
      /outside the project assets directory/
    );

    const secondSpritePath = path.join(spritesDir, 'companion_neutral.png');
    await createTestSprite(secondSpritePath, { x: 60, y: 20, width: 25, height: 60 });
    await fs.unlink(cachePath);
    const concurrentService = createSpriteOpaqueBoundsCacheService({
      path,
      fs,
      sharp,
      getRootDirectory: () => root,
      maxAnalysisSize: 64
    });
    await Promise.all([
      concurrentService.getOrCreate('sprites/hero_neutral.png'),
      concurrentService.getOrCreate('sprites/companion_neutral.png')
    ]);
    const concurrentCache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    assert(concurrentCache.entries['sprites/hero_neutral.png']);
    assert(concurrentCache.entries['sprites/companion_neutral.png']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log('sprite_opaque_bounds_cache_service tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
