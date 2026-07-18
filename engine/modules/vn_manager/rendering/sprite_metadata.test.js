const assert = require('assert');
const {
  extractSpriteMetadataRegistry,
  mergeSpriteMetadataRegistry,
  normalizeCharacterScale
} = require('./sprite_metadata.js');

function runTests() {
  assert.strictEqual(normalizeCharacterScale(0.7), 0.7, 'Positive scale should be accepted');
  assert.strictEqual(normalizeCharacterScale(0), null, 'Zero scale should be ignored');
  assert.strictEqual(normalizeCharacterScale(-1), null, 'Negative scale should be ignored');
  assert.strictEqual(normalizeCharacterScale('bad'), null, 'Non-numeric scale should be ignored');
  assert.strictEqual(normalizeCharacterScale(0.01), 0.1, 'Tiny scale should clamp to minimum');
  assert.strictEqual(normalizeCharacterScale(7), 3, 'Huge scale should clamp to maximum');

  const extracted = extractSpriteMetadataRegistry({
    characters: {
      Frieren: {
        scale: 0.7,
        emotionGuidance: 'Small, restrained expressions.'
      },
      Fern: {
        scale: 1
      },
      Stark: {
        scale: 'invalid',
        guidance: 'Energetic reactions.'
      }
    }
  });

  assert.strictEqual(extracted.characters.frieren.scale, 0.7, 'Character scale should be parsed');
  assert.strictEqual(extracted.characters.frieren.emotionGuidance, 'Small, restrained expressions.');
  assert.strictEqual(extracted.characters.fern.scale, 1, 'Scale-only metadata should be retained');
  assert.strictEqual(extracted.characters.stark.scale, null, 'Invalid scale should not become an override');
  assert.strictEqual(extracted.characters.stark.emotionGuidance, 'Energetic reactions.');

  const merged = { characters: {}, sources: [] };
  mergeSpriteMetadataRegistry(merged, extracted);
  mergeSpriteMetadataRegistry(merged, extractSpriteMetadataRegistry({
    characters: {
      Frieren: {
        scale: 0.9
      }
    }
  }));

  assert.strictEqual(merged.characters.frieren.scale, 0.9, 'Later metadata should override scale');
  assert.strictEqual(
    merged.characters.frieren.emotionGuidance,
    'Small, restrained expressions.',
    'Scale-only override should not erase existing emotion guidance'
  );

  console.log('sprite_metadata tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
