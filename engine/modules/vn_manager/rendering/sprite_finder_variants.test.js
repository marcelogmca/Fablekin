const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSpriteCatalog, findSprite } = require('./sprite_finder.js');

function buildTurnContext(variant) {
  return {
    projectName: 'VariantTest',
    input: { playerCharacterName: 'Player' },
    processed: {
      characterGenders: new Map([['frieren', 'female']]),
      vnManager: {
        spriteVariantLocks: { frieren: variant },
        spriteVariantLockSchedule: []
      }
    }
  };
}

const sprites = [
  'sprites/Frieren_Happy.webp',
  'sprites/Frieren/Frieren_Sad.webp',
  'sprites/Frieren/Default/Frieren_Angry.webp',
  'sprites/Frieren/Nightgown/Frieren_Happy.webp',
  'sprites/Frieren/Nightgown/Frieren_Sad.webp',
  'sprites/Frieren/Nightgown/Frieren_Angry.webp'
];

test('default lock accepts every supported default layout and excludes named variants', async () => {
  const catalog = buildSpriteCatalog(sprites);
  const turnContext = buildTurnContext('default');

  const happy = await findSprite('Frieren', 'happy', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites, 1);
  const sad = await findSprite('Frieren', 'sad', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites, 2);
  const angry = await findSprite('Frieren', 'angry', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites, 3);

  assert.equal(happy.image, 'sprites/Frieren_Happy.webp');
  assert.equal(sad.image, 'sprites/Frieren/Frieren_Sad.webp');
  assert.equal(angry.image, 'sprites/Frieren/Default/Frieren_Angry.webp');
  assert.ok([happy.image, sad.image, angry.image].every(image => !image.includes('/Nightgown/')));
});

test('named variant lock remains restricted to its own folder', async () => {
  const catalog = buildSpriteCatalog(sprites);
  const turnContext = buildTurnContext('nightgown');

  const result = await findSprite('Frieren', 'happy', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites, 1);

  assert.equal(result.image, 'sprites/Frieren/Nightgown/Frieren_Happy.webp');
});
