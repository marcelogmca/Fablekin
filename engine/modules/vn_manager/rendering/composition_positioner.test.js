const assert = require('assert');
const { parseCommandToUCP } = require('../ucp_parser.js');
const { compileSpriteCompositionForPayload, parseCompCommand } = require('./composition_positioner.js');

function sprite(character, slot = 0) {
  return { character, path: `sprites/${character.toLowerCase()}.webp`, slot };
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

function assertAllScaleOne(sequenceLine, message) {
  assert(sequenceLine.sprites.every(s => s.layout && s.layout.scale === 1), message);
}

function runTests() {
  // Parser tests (UCP canonical parser)
  const duelEvent = parseCommandToUCP('comp:duel:Candace:Dehya');
  assert(duelEvent, 'Expected comp duel command to parse');
  assert.strictEqual(duelEvent.type, 'comp:set');
  assert.strictEqual(duelEvent.payload.preset, 'duel');
  assert.deepStrictEqual(duelEvent.payload.actors, ['Candace', 'Dehya']);

  const protectiveEvent = parseCommandToUCP('comp:protective:Dehya:Aether:Candace:for=8:locked');
  assert(protectiveEvent, 'Expected comp protective command to parse');
  assert.strictEqual(protectiveEvent.payload.options.for, 8);
  assert.strictEqual(protectiveEvent.payload.options.locked, true);

  const clusterEvent = parseCommandToUCP('comp:cluster:Frieren:Fern:Stark:side=left');
  assert(clusterEvent, 'Expected comp cluster command to parse');
  assert.strictEqual(clusterEvent.payload.preset, 'cluster');
  assert.strictEqual(clusterEvent.payload.options.side, 'left');

  const spatialOnEvent = parseCommandToUCP('spatial:on');
  assert(spatialOnEvent, 'Expected spatial:on command to parse');
  assert.strictEqual(spatialOnEvent.type, 'spatial-stage:set');
  assert.strictEqual(spatialOnEvent.payload.mode, 'on');

  const spatialOffEvent = parseCommandToUCP('spatial:off');
  assert(spatialOffEvent, 'Expected spatial:off command to parse');
  assert.strictEqual(spatialOffEvent.type, 'spatial-stage:set');
  assert.strictEqual(spatialOffEvent.payload.mode, 'off');

  const spatialAutoEvent = parseCommandToUCP('spatial:auto');
  assert(spatialAutoEvent, 'Expected spatial:auto command to parse');
  assert.strictEqual(spatialAutoEvent.type, 'spatial-stage:set');
  assert.strictEqual(spatialAutoEvent.payload.mode, 'auto');

  const stageOnEvent = parseCommandToUCP('stage:on');
  assert(stageOnEvent, 'Expected stage:on command to parse');
  assert.strictEqual(stageOnEvent.type, 'spatial-stage:set');
  assert.strictEqual(stageOnEvent.payload.mode, 'on');

  assert.strictEqual(parseCommandToUCP('spatial:invalid'), null, 'Invalid spatial mode should be rejected');
  assert.strictEqual(parseCommandToUCP('stage:invalid'), null, 'Invalid stage mode should be rejected');

  const transitionEvent = parseCommandToUCP('transition:circle_fade|scope=scene|duration=900|blocking=true|direction=in|easing=power2.inOut');
  assert(transitionEvent, 'Expected transition command to parse');
  assert.strictEqual(transitionEvent.type, 'vn:transition');
  assert.strictEqual(transitionEvent.payload.effect, 'circle_fade');
  assert.strictEqual(transitionEvent.payload.scope, 'scene');
  assert.strictEqual(transitionEvent.payload.durationMs, 900);
  assert.strictEqual(transitionEvent.payload.blocking, true);
  assert.strictEqual(transitionEvent.payload.direction, 'in');
  assert.strictEqual(transitionEvent.payload.easing, 'power2.inOut');

  assert.strictEqual(parseCommandToUCP('comp:unknown:Candace'), null, 'Unknown comp preset should be rejected');
  assert.strictEqual(parseCompCommand('comp:unknown:Candace'), null, 'Unknown comp preset should be rejected by direct parser');
  [
    'isolate:Stella',
    'close:Beatrice',
    'over_shoulder:Stella:Beatrice',
    'tiny_in_world',
    'group_small'
  ].forEach(command => {
    assert.strictEqual(parseCommandToUCP(`comp:${command}`), null, `Disabled comp ${command} should be rejected`);
    assert.strictEqual(parseCompCommand(`comp:${command}`), null, `Disabled comp ${command} should be rejected by direct parser`);
  });

  // Composition compiler behavior tests
  const sequence = [
    line('Candace', [sprite('Candace', 0), sprite('Dehya', 1)], [duelEvent]),
    line('Dehya', [sprite('Candace', 0), sprite('Dehya', 1)]),
    line('Narrator', [sprite('Candace', 0), sprite('Dehya', 1)], [parseCommandToUCP('comp:duel:Candace:Dehya:for=1')]),
    line('Candace', [sprite('Candace', 0), sprite('Dehya', 1)]),
    line('Narrator', [sprite('Candace', 0), sprite('Dehya', 1)]),
    line('Narrator', [sprite('Candace', 0), sprite('Dehya', 1)], [parseCommandToUCP('cast:flush')]),
    line('Candace', [sprite('Candace', 0), sprite('Dehya', 1)])
  ];

  compileSpriteCompositionForPayload(sequence, { playerCharacterName: 'Aether' });

  // Sticky composition applies across lines
  assert(sequence[0].sprites.every(s => s.layout), 'Line 0 should have layout on each sprite');
  assert.strictEqual(sequence[1].composition.preset, 'duel', 'Line 1 should inherit sticky duel composition');

  // for=1 should expire after one additional line
  assert.strictEqual(sequence[3].composition.preset, 'duel', 'Line 3 should still be under duel duration');
  assert.strictEqual(sequence[4].composition.preset, 'default', 'Line 4 should fall back to default after duration expiry');

  // cast:flush clears non-locked composition state
  assert.strictEqual(sequence[6].composition.preset, 'default', 'Line after flush should reset to default');

  // no comp command still writes default layout metadata
  const noCompSequence = [line('Candace', [sprite('Candace', 1)])];
  compileSpriteCompositionForPayload(noCompSequence, { playerCharacterName: 'Aether' });
  assert(noCompSequence[0].sprites[0].layout, 'Default path should still output layout metadata');
  assert.strictEqual(noCompSequence[0].composition.preset, 'default');
  assert.strictEqual(noCompSequence[0].sprites[0].layout.x, 0.5, 'Single default sprite should remain centered');

  const defaultPair = [line('Candace', [sprite('Candace', 0), sprite('Dehya', 1)])];
  compileSpriteCompositionForPayload(defaultPair, { playerCharacterName: 'Aether' });
  assert(Math.abs(defaultPair[0].sprites[0].layout.x - (1 / 3)) < 0.0001, 'Default pair left sprite should match Pixi slot spacing');
  assert(Math.abs(defaultPair[0].sprites[1].layout.x - (2 / 3)) < 0.0001, 'Default pair right sprite should match Pixi slot spacing');

  const defaultFive = [line('Frieren', [
    sprite('Frieren', 0),
    sprite('Fern', 1),
    sprite('Stark', 2),
    sprite('Aura', 3),
    sprite('Linie', 4)
  ])];
  compileSpriteCompositionForPayload(defaultFive, { playerCharacterName: 'Aether' });
  assert(defaultFive[0].sprites.every(s => s.layout.x >= 0 && s.layout.x <= 1), 'Default five-sprite layout should stay within frame');
  assert(defaultFive[0].sprites[0].layout.x < defaultFive[0].sprites[4].layout.x, 'Default five-sprite layout should preserve left-to-right slot order');

  const reversedDuel = [line('Candace', [sprite('Dehya', 0), sprite('Candace', 1)], [
    parseCommandToUCP('comp:duel:Candace:Dehya')
  ])];
  compileSpriteCompositionForPayload(reversedDuel, { playerCharacterName: 'Aether' });
  const duelDehya = reversedDuel[0].sprites.find(s => s.character === 'Dehya');
  const duelCandace = reversedDuel[0].sprites.find(s => s.character === 'Candace');
  assert(duelDehya.layout.x < duelCandace.layout.x, 'Duel should preserve existing left/right character order');
  assert.strictEqual(duelDehya.layout.scale, duelCandace.layout.scale, 'Duel should not resize one focal actor relative to another');

  const intimateWithExtra = [line('Candace', [
    sprite('Candace', 0),
    sprite('Dehya', 1),
    sprite('Aether', 2)
  ], [parseCommandToUCP('comp:intimate:Dehya:Candace')])];
  compileSpriteCompositionForPayload(intimateWithExtra, { playerCharacterName: 'Aether' });
  const intimateCandace = intimateWithExtra[0].sprites.find(s => s.character === 'Candace');
  const intimateDehya = intimateWithExtra[0].sprites.find(s => s.character === 'Dehya');
  assert(intimateCandace.layout.x < intimateDehya.layout.x, 'Intimate should preserve existing order even when command actors are reversed');
  assertAllScaleOne(intimateWithExtra[0], 'Simple comps should keep all visible sprites at equal scale');

  const groupCompCases = [
    line('Frieren', [
      sprite('Frieren', 0),
      sprite('Fern', 1),
      sprite('Stark', 2),
      sprite('Aura', 3)
    ], [parseCommandToUCP('comp:triangle:Stark:Frieren:Fern')]),
    line('Dehya', [
      sprite('Candace', 0),
      sprite('Dehya', 1),
      sprite('Aether', 2)
    ], [protectiveEvent]),
    line('Stark', [
      sprite('Stella', 0),
      sprite('Beatrice', 1),
      sprite('Stark', 2)
    ], [parseCommandToUCP('comp:observer:Stark:Stella:Beatrice')]),
    line('Candace', [
      sprite('Dehya', 0),
      sprite('Candace', 1),
      sprite('Aether', 2)
    ], [parseCommandToUCP('comp:lineup:Candace:Dehya:Aether')]),
    line('Frieren', [
      sprite('Frieren', 0),
      sprite('Fern', 1),
      sprite('Stark', 2),
      sprite('Aura', 3),
      sprite('Linie', 4)
    ], [clusterEvent])
  ];
  compileSpriteCompositionForPayload(groupCompCases, { playerCharacterName: 'Aether' });
  groupCompCases.forEach((compLine) => {
    assertAllScaleOne(compLine, `${compLine.composition.preset} should keep every visible sprite at equal scale`);
  });

  const lineupLine = groupCompCases[3];
  const lineupDehya = lineupLine.sprites.find(s => s.character === 'Dehya');
  const lineupCandace = lineupLine.sprites.find(s => s.character === 'Candace');
  assert(lineupDehya.layout.x < lineupCandace.layout.x, 'Lineup should preserve existing left/right order despite reversed command actors');

  const protectiveLine = groupCompCases[1];
  const protectiveCandace = protectiveLine.sprites.find(s => s.character === 'Candace');
  const protectiveDehya = protectiveLine.sprites.find(s => s.character === 'Dehya');
  const protectiveAether = protectiveLine.sprites.find(s => s.character === 'Aether');
  assert(
    protectiveCandace.layout.x < protectiveDehya.layout.x && protectiveDehya.layout.x < protectiveAether.layout.x,
    'Protective should preserve current left/right order while applying role metadata'
  );

  const observerLine = groupCompCases[2];
  const observerStella = observerLine.sprites.find(s => s.character === 'Stella');
  const observerBeatrice = observerLine.sprites.find(s => s.character === 'Beatrice');
  const observerStark = observerLine.sprites.find(s => s.character === 'Stark');
  assert(
    observerStella.layout.x < observerBeatrice.layout.x && observerBeatrice.layout.x < observerStark.layout.x,
    'Observer should preserve current left/right order while applying role metadata'
  );

  const multiCompLine = [line('Candace', [sprite('Candace', 0), sprite('Dehya', 1)], [
    parseCommandToUCP('comp:separate:Candace:Dehya'),
    parseCommandToUCP('comp:intimate:Candace:Dehya')
  ])];
  compileSpriteCompositionForPayload(multiCompLine, { playerCharacterName: 'Aether' });
  assert.strictEqual(multiCompLine[0].composition.preset, 'intimate', 'Last comp event on a line should win');

  console.log('composition_positioner tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
