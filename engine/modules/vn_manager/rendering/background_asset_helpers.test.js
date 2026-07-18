const assert = require('assert');
const {
  filterForegroundOcclusionAssets,
  getForegroundOcclusionCandidates,
  isForegroundOcclusionAsset
} = require('./background_asset_helpers.js');

function runTests() {
  assert.strictEqual(isForegroundOcclusionAsset('backgrounds/bar_foreground.png'), true);
  assert.strictEqual(isForegroundOcclusionAsset('backgrounds/BAR_FOREGROUND.WEBP'), true);
  assert.strictEqual(isForegroundOcclusionAsset('C:\\project\\assets\\backgrounds\\bar_foreground.jpg'), true);
  assert.strictEqual(isForegroundOcclusionAsset('backgrounds/foreground_bar.png'), false);
  assert.strictEqual(isForegroundOcclusionAsset('backgrounds/bar.png'), false);

  assert.deepStrictEqual(
    filterForegroundOcclusionAssets([
      'backgrounds/bar.webp',
      'backgrounds/bar_foreground.png',
      'backgrounds/street_loop.mp4',
      'backgrounds/street_loop_FOREGROUND.webp'
    ]),
    [
      'backgrounds/bar.webp',
      'backgrounds/street_loop.mp4'
    ]
  );

  assert.deepStrictEqual(
    getForegroundOcclusionCandidates('backgrounds/bar.webp').slice(0, 3),
    [
      'backgrounds/bar_foreground.png',
      'backgrounds/bar_foreground.jpg',
      'backgrounds/bar_foreground.jpeg'
    ]
  );

  assert.deepStrictEqual(
    getForegroundOcclusionCandidates('backgrounds/street_loop.mp4').at(-1),
    'backgrounds/street_loop_foreground.webp'
  );

  assert.deepStrictEqual(getForegroundOcclusionCandidates('backgrounds/bar_foreground.png'), []);
}

runTests();
console.log('background_asset_helpers tests passed');
