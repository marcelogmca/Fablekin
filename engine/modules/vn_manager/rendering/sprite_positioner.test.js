const assert = require('assert');
const { computeSpritePositions, getMaxSpriteSlotsFromSettings, applyRotationLogic } = require('./sprite_positioner.js');

function dialogue(character, index) {
  return {
    type: 'dialogue',
    character,
    image: `sprites/${character.toLowerCase()}_neutral.webp`,
    line: `${character}: line ${index}`
  };
}

function show(character) {
  return {
    type: 'narrative',
    character,
    image: `sprites/${character.toLowerCase()}_neutral.webp`,
    line: `show ${character}`
  };
}

function showWithImage(character, image) {
  return {
    type: 'narrative',
    character,
    image,
    line: `show ${character}`
  };
}

function visibleCharacters(line) {
  return line.sprites.filter(Boolean).map(sprite => sprite.character);
}

function runTests() {
  const lateCameoSequence = Array.from({ length: 100 }, (_, index) => {
    if (index === 84) return dialogue('Innkeeper', index + 1);
    return dialogue('Hero', index + 1);
  });

  const lateCameoOutput = computeSpritePositions(lateCameoSequence, []);

  assert(
    visibleCharacters(lateCameoOutput[84]).includes('Innkeeper'),
    'Late cameo should be visible on the line they speak'
  );
  assert(
    !visibleCharacters(lateCameoOutput[85]).includes('Innkeeper'),
    'Late cameo should leave immediately after their final line'
  );
  assert(
    visibleCharacters(lateCameoOutput[85]).includes('Hero'),
    'Main speaker should remain visible after cameo exits'
  );

  const scaledOutput = computeSpritePositions([
    dialogue('Frieren', 1),
    dialogue('Fern', 2)
  ], [], {
    spriteMetadata: {
      characters: {
        frieren: { scale: 0.7 }
      }
    }
  });
  const frierenSprite = scaledOutput[0].sprites.find(sprite => sprite?.character === 'Frieren');
  const fernSprite = scaledOutput[1].sprites.find(sprite => sprite?.character === 'Fern');

  assert.strictEqual(frierenSprite.metadataScale, 0.7, 'Character metadata scale should be emitted into sprite payload');
  assert.strictEqual(fernSprite.metadataScale, 1, 'Characters without metadata scale should default to 1');

  assert.strictEqual(
    getMaxSpriteSlotsFromSettings({ visual_novel: { settings: { visuals: { max_sprite_slots: 2 } } } }),
    2,
    'Max sprite slots should read from visual_novel.settings.visuals.max_sprite_slots'
  );

  const cappedOutput = computeSpritePositions([
    show('Alpha'),
    show('Bravo'),
    show('Charlie')
  ], [], { maxSpriteSlots: 2 });
  assert.strictEqual(
    cappedOutput[2].sprites.filter(Boolean).length,
    2,
    'Sprite positioning should respect maxSpriteSlots option'
  );

  const duplicateGenericOutput = computeSpritePositions([
    showWithImage('Villager 1', 'sprites/generic_npc_female.webp'),
    showWithImage('Innkeeper', 'sprites/generic_npc_female.webp'),
    showWithImage('Boss', 'sprites/generic_npc_female.webp'),
    showWithImage('Guard', 'sprites/generic_npc_male.webp'),
    showWithImage('Beatrice', 'sprites/beatrice_happy.webp'),
    showWithImage('Johnny', 'sprites/johnny_thinking.webp')
  ], [], { maxSpriteSlots: 6 });
  const finalVisibleSprites = duplicateGenericOutput[5].sprites.filter(Boolean);

  assert.deepStrictEqual(
    finalVisibleSprites.map(sprite => sprite.path).sort(),
    [
      'sprites/beatrice_happy.webp',
      'sprites/generic_npc_female.webp',
      'sprites/generic_npc_male.webp',
      'sprites/johnny_thinking.webp'
    ].sort(),
    'Duplicate visual sprites should be suppressed per dialogue frame'
  );
  const survivingGenericFemale = finalVisibleSprites.find(sprite => sprite.path === 'sprites/generic_npc_female.webp');
  assert.deepStrictEqual(
    [...survivingGenericFemale.visualAliases].sort(),
    ['Boss', 'Innkeeper', 'Villager 1'],
    'Surviving duplicate generic sprite should retain aliases for suppressed speakers'
  );

  const duplicateTalkLayerOutput = computeSpritePositions([
    showWithImage('Villager 1', 'sprites/generic_npc_female.webp'),
    showWithImage('Innkeeper', 'sprites/generic_npc_female_talk.webp')
  ], [], { maxSpriteSlots: 2 });
  assert.strictEqual(
    duplicateTalkLayerOutput[1].sprites.filter(Boolean).length,
    1,
    'Animation-layer variants should count as the same visual sprite'
  );
  const duplicateTalkLayerSprite = duplicateTalkLayerOutput[1].sprites.find(Boolean);
  assert.deepStrictEqual(
    [...duplicateTalkLayerSprite.visualAliases].sort(),
    ['Innkeeper', 'Villager 1'],
    'Animation-layer duplicate suppression should retain speaker aliases'
  );

  const aliasRotationSequence = [{
    type: 'dialogue',
    character: 'Villager 1',
    line: 'Villager 1: Over here!',
    sprites: [
      {
        character: 'Innkeeper',
        path: 'sprites/generic_npc_female.webp',
        slot: 0,
        visualAliases: ['Innkeeper', 'Villager 1']
      },
      {
        character: 'Beatrice',
        path: 'sprites/beatrice_happy.webp',
        slot: 1,
        availableRotations: ['front', 'left', 'right']
      }
    ]
  }];
  applyRotationLogic(
    aliasRotationSequence,
    [],
    'Player',
    new Set([
      'sprites/beatrice_happy_front.webp',
      'sprites/beatrice_happy_left.webp',
      'sprites/beatrice_happy_right.webp'
    ])
  );
  assert.strictEqual(
    aliasRotationSequence[0].sprites[1].path,
    'sprites/beatrice_happy_left.webp',
    'Named listeners should rotate toward a generic speaker represented by a surviving alias'
  );

  console.log('sprite_positioner tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
