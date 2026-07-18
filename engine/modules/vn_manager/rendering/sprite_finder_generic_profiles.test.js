const assert = require('assert');
const { buildSpriteCatalog, findSprite } = require('./sprite_finder.js');

function createTurnContext(spriteCatalog, genericSpriteProfiles = {}) {
  return {
    projectName: 'test_project',
    input: {},
    processed: {
      characterGenders: new Map([['stella', 'female']]),
      vnManager: {
        genericSpriteProfiles
      }
    },
    runtime: {
      vnManager: {
        spriteCatalog
      }
    }
  };
}

async function testCatalogExtractsSemanticGenericProfiles() {
  const catalog = buildSpriteCatalog([
    'sprites/2_elf_generic.webp',
    'sprites/1_elf_generic.webp',
    'sprites/1_generic.webp',
    'sprites/generic_npc_female.webp'
  ]);

  assert.deepStrictEqual(Object.keys(catalog.global.genericProfiles).sort(), ['elf', 'generic']);
  assert.deepStrictEqual(catalog.global.genericProfiles.elf.files, [
    'sprites/1_elf_generic.webp',
    'sprites/2_elf_generic.webp'
  ]);
  assert.strictEqual(catalog.summary.genericProfileCount, 2);
  assert.strictEqual(catalog.summary.semanticGenericProfileCount, 1);
  assert.ok(!catalog.global.genericProfiles.generic_npc_female);
}

async function testProfilePayloadSelectsDeterministicSemanticGenericSprite() {
  const catalog = buildSpriteCatalog([
    'sprites/2_elf_generic.webp',
    'sprites/1_elf_generic.webp',
    'sprites/generic_npc_female.webp'
  ]);
  const turnContext = createTurnContext(catalog, {
    stella: { profileKey: 'elf', source: 'facts' }
  });

  const first = await findSprite('Stella', 'happy', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites);
  const second = await findSprite('Stella', 'happy', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites);

  assert.ok(first.image.includes('_elf_generic.webp'));
  assert.strictEqual(first.image, second.image);
}

async function testStaleProfileFallsBackToLegacyGenderGeneric() {
  const catalog = buildSpriteCatalog([
    'sprites/1_generic.webp',
    'sprites/generic_npc_female.webp'
  ]);
  const turnContext = createTurnContext(catalog, {
    stella: { profileKey: 'elf', source: 'facts' }
  });

  const result = await findSprite('Stella', 'happy', catalog.global.baseSprites, null, turnContext, catalog.global.allSprites);

  assert.strictEqual(result.image, 'sprites/generic_npc_female.webp');
  assert.strictEqual(result.gender, 'female');
}

async function run() {
  await testCatalogExtractsSemanticGenericProfiles();
  await testProfilePayloadSelectsDeterministicSemanticGenericSprite();
  await testStaleProfileFallsBackToLegacyGenderGeneric();
  console.log('sprite finder generic profile tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
