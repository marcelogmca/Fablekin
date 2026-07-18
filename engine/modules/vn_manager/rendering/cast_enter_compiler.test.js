const assert = require('assert');
const { parseCommandToUCP } = require('../ucp_parser.js');
const { compileCastEnterForPayload } = require('./cast_enter_compiler.js');

function sprite(character, slot = 0) {
  return {
    character,
    path: `sprites/${character.toLowerCase()}_neutral.webp`,
    slot,
    availableRotations: [],
    hasBlink: false,
    hasTalk: false,
    hasTalkBlink: false
  };
}

function spriteWithPath(character, path, slot = 0) {
  return {
    ...sprite(character, slot),
    path
  };
}

function line(character, sprites = [], clientEvents = []) {
  return {
    type: character ? 'dialogue' : 'narrative',
    character,
    line: character ? `${character}: ...` : 'Narration',
    sprites,
    clientEvents
  };
}

async function runTests() {
  const castEnter = parseCommandToUCP('cast:enter:Frieren:Fern:Stark:emotion=neutral');
  assert(castEnter, 'Expected cast enter command to parse');
  assert.strictEqual(castEnter.type, 'vn:cast-enter');
  assert.deepStrictEqual(castEnter.payload.actors, ['Frieren', 'Fern', 'Stark']);
  assert.strictEqual(castEnter.payload.options.emotion, 'neutral');

  const sequence = [
    line(null, [], [castEnter]),
    line(null, []),
    line('Aura', [sprite('Aura', 3)]),
    line(null, [], [parseCommandToUCP('cast:flush')]),
    line(null, [])
  ];

  await compileCastEnterForPayload(sequence, {
    maxSprites: 5,
    spriteResolver: async actorName => sprite(actorName)
  });

  assert(sequence[0].sprites.some(s => s.character === 'Frieren'), 'Forced cast should enter on command line');
  assert(sequence[1].sprites.some(s => s.character === 'Fern'), 'Forced cast should persist across later lines');
  assert(sequence[2].sprites.some(s => s.character === 'Aura'), 'Existing visible sprites should remain visible');
  assert(sequence[2].sprites.some(s => s.character === 'Stark'), 'Forced cast should coexist with regular sprites');
  assert.strictEqual(sequence[2].sprites.filter(Boolean).length, 4, 'Forced cast should not exceed the five-sprite cap in this case');
  assert.strictEqual(sequence[4].sprites.filter(Boolean).length, 0, 'cast:flush should clear forced cast persistence');

  const capped = [
    line(null, [
      sprite('A', 0),
      sprite('B', 1),
      sprite('C', 2)
    ], [parseCommandToUCP('cast:enter:D:E')])
  ];
  await compileCastEnterForPayload(capped, {
    maxSprites: 3,
    spriteResolver: async actorName => sprite(actorName)
  });
  assert.strictEqual(capped[0].sprites.filter(Boolean).length, 3, 'Forced cast should respect max sprite cap');

  const duplicateGenericCast = [
    line(null, [
      spriteWithPath('Villager 1', 'sprites/generic_npc_female.webp', 0)
    ], [parseCommandToUCP('cast:enter:Innkeeper:Boss')])
  ];
  await compileCastEnterForPayload(duplicateGenericCast, {
    maxSprites: 5,
    spriteResolver: async actorName => spriteWithPath(actorName, 'sprites/generic_npc_female.webp')
  });
  assert.strictEqual(
    duplicateGenericCast[0].sprites.filter(Boolean).length,
    1,
    'Forced cast should suppress duplicate visual sprites in the same frame'
  );

  console.log('cast_enter_compiler tests passed');
}

if (require.main === module) {
  runTests().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runTests };
