const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { _private } = require('./asset_selector.js');

test('asset selections preserve every compact global line assignment', () => {
  const assets = [
    path.join('assets', 'ost', 'calm.mp3'),
    path.join('assets', 'ost', 'danger.mp3')
  ];
  const result = _private.parseMultiAssetSelection(
    '0. calm.mp3\n12) danger.mp3',
    assets,
    ['calm.mp3', 'danger.mp3']
  );

  assert.equal(result.path, assets[0]);
  assert.deepEqual(result.changes, [
    { line: 0, path: assets[0] },
    { line: 12, path: assets[1] }
  ]);
});

test('asset selection parser remains compatible with legacy Line X output', () => {
  const assets = [path.join('assets', 'backgrounds', 'tavern.png')];
  const result = _private.parseMultiAssetSelection(
    'Line 4: tavern.png',
    assets,
    ['tavern.png']
  );

  assert.deepEqual(result.changes, [{ line: 4, path: assets[0] }]);
});
