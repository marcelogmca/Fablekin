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

  const narrativeCommandSequence = [
    {
      type: 'dialogue',
      character: 'Ari',
      line: 'Ari: Look.',
      availableRotations: ['front', 'back'],
      sprites: [{ character: 'Ari', path: 'sprites/ari_neutral_front.webp', slot: 0 }]
    },
    {
      type: 'narrative',
      line: 'Lightning tears across the horizon.',
      availableRotations: ['front', 'back'],
      sprites: [{ character: 'Ari', path: 'sprites/ari_neutral_front.webp', slot: 0 }]
    }
  ];
  applyRotationLogic(
    narrativeCommandSequence,
    [{ line: 1, commands: ['focus:away:1'] }],
    'Player',
    new Set()
  );
  assert.strictEqual(
    narrativeCommandSequence[1].sprites[0].path,
    'sprites/ari_neutral_back.webp',
    'A gaze command on a narrative line should apply at that exact global scene index'
  );

  const reactionSequence = computeSpritePositions([
    {
      type: 'dialogue',
      character: 'Dehya',
      image: 'sprites/dehya_happy.webp',
      line: 'Dehya: What a lovely day!'
    },
    {
      type: 'dialogue',
      character: 'Candace',
      image: 'sprites/candace_sad.webp',
      line: 'Candace: My cat died.',
      fto: { class: 'hesitate', offsetMs: 650 },
      speakerTarget: 'Dehya',
      reactionChanges: [{
        character: 'Dehya',
        emotion: 'concerned',
        image: 'sprites/dehya_concerned.webp',
        availableRotations: []
      }]
    }
  ], []);
  const reactingDehya = reactionSequence[1].sprites.find(sprite => sprite?.character === 'Dehya');
  assert.strictEqual(
    reactingDehya.path,
    'sprites/dehya_concerned.webp',
    'A sparse non-speaker reaction should replace the carried expression on its trigger line'
  );
  assert.strictEqual(reactionSequence[1].reactionChanges, undefined, 'Internal reaction changes should not enter the viewer payload');
  assert.deepStrictEqual(reactionSequence[1].fto, { class: 'hesitate', offsetMs: 650 }, 'Reaction rendering should preserve FTO metadata');
  assert.strictEqual(reactionSequence[1].speakerTarget, 'Dehya', 'Reaction rendering should preserve speaker targeting');

  const multiActorReactionSequence = [{
    type: 'narrative',
    line: 'Dehya recoils from Candace while Candace turns her back on the blast.',
    sprites: [
      {
        character: 'Dehya',
        path: 'sprites/dehya_neutral_front.webp',
        slot: 0,
        availableRotations: ['front', 'left', 'right', 'back']
      },
      {
        character: 'Candace',
        path: 'sprites/candace_neutral_front.webp',
        slot: 1,
        availableRotations: ['front', 'left', 'right', 'back']
      }
    ]
  }];
  applyRotationLogic(
    multiActorReactionSequence,
    [
      { line: 0, commands: ['avoid:Dehya:Candace:0'] },
      { line: 0, commands: ['face:Candace:back:0'] }
    ],
    'Player',
    new Set()
  );
  assert.strictEqual(
    multiActorReactionSequence[0].sprites[0].path,
    'sprites/dehya_neutral_left.webp',
    'Avoid should turn a character opposite the target sprite'
  );
  assert.strictEqual(
    multiActorReactionSequence[0].sprites[1].path,
    'sprites/candace_neutral_back.webp',
    'Separate gaze entries on one narrative line should merge and support explicit facing'
  );

  const conversationalFacingSequence = [{
    type: 'dialogue',
    character: 'Dehya',
    speakerTarget: 'Candace',
    line: 'Dehya: You know what I mean.',
    sprites: [
      {
        character: 'Dehya',
        path: 'sprites/dehya_neutral_front.webp',
        slot: 0,
        availableRotations: ['front', 'left', 'right']
      },
      {
        character: 'Candace',
        path: 'sprites/candace_neutral_front.webp',
        slot: 1,
        availableRotations: ['front', 'left', 'right']
      }
    ]
  }];
  applyRotationLogic(conversationalFacingSequence, [], 'Player', new Set());
  assert.strictEqual(
    conversationalFacingSequence[0].sprites[0].path,
    'sprites/dehya_neutral_right.webp',
    'Future speakerTarget data should direct the ordinary speaker toward their addressee'
  );
  assert.strictEqual(
    conversationalFacingSequence[0].sprites[1].path,
    'sprites/candace_neutral_left.webp',
    'Ordinary listeners should still face the current speaker'
  );

  const groupTargetSequence = [{
    type: 'dialogue',
    character: 'Dehya',
    speakerTarget: 'group',
    line: 'Dehya: Listen, all of you.',
    sprites: [
      { character: 'Candace', path: 'sprites/candace_neutral_front.webp', slot: 0, availableRotations: ['front', 'left', 'right'] },
      { character: 'Aether', path: 'sprites/aether_neutral_front.webp', slot: 1, availableRotations: ['front', 'left', 'right'] },
      { character: 'Dehya', path: 'sprites/dehya_neutral_front.webp', slot: 2, availableRotations: ['front', 'left', 'right'] }
    ]
  }];
  applyRotationLogic(groupTargetSequence, [], 'Player', new Set());
  assert.strictEqual(
    groupTargetSequence[0].sprites[2].path,
    'sprites/dehya_neutral_left.webp',
    'A group target should face the speaker toward the other visible characters'
  );

  const playerTargetSequence = [
    {
      type: 'dialogue',
      character: 'Candace',
      line: 'Candace: Your turn.',
      sprites: [
        { character: 'Dehya', path: 'sprites/dehya_neutral_front.webp', slot: 0, availableRotations: ['front', 'left', 'right'] },
        { character: 'Candace', path: 'sprites/candace_neutral_front.webp', slot: 1, availableRotations: ['front', 'left', 'right'] }
      ]
    },
    {
      type: 'dialogue',
      character: 'Dehya',
      speakerTarget: 'Player',
      line: 'Dehya: I am talking to you.',
      sprites: [
        { character: 'Dehya', path: 'sprites/dehya_neutral_front.webp', slot: 0, availableRotations: ['front', 'left', 'right'] },
        { character: 'Candace', path: 'sprites/candace_neutral_front.webp', slot: 1, availableRotations: ['front', 'left', 'right'] }
      ]
    }
  ];
  applyRotationLogic(playerTargetSequence, [], 'Player', new Set());
  assert.strictEqual(
    playerTargetSequence[1].sprites[0].path,
    'sprites/dehya_neutral_front.webp',
    'A player target should override the legacy previous-speaker fallback and face the camera'
  );

  const exceptionalOverrideSequence = [{
    type: 'dialogue',
    character: 'Dehya',
    speaker_target: 'Candace',
    line: 'Dehya: I cannot look at you right now.',
    sprites: [
      {
        character: 'Dehya',
        path: 'sprites/dehya_neutral_front.webp',
        slot: 0,
        availableRotations: ['front', 'left', 'right', 'back']
      },
      {
        character: 'Candace',
        path: 'sprites/candace_neutral_front.webp',
        slot: 1,
        availableRotations: ['front', 'left', 'right', 'back']
      }
    ]
  }];
  applyRotationLogic(
    exceptionalOverrideSequence,
    [{ line: 0, commands: ['avoid:Dehya:Candace:0'] }],
    'Player',
    new Set()
  );
  assert.strictEqual(
    exceptionalOverrideSequence[0].sprites[0].path,
    'sprites/dehya_neutral_left.webp',
    'Exceptional gaze instructions should override future conversational speaker targets'
  );

  console.log('sprite_positioner tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
