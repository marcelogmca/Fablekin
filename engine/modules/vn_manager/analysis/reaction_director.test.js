const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { buildSpriteCatalog } = require('../rendering/sprite_finder.js');
const { resolveReactionSprites } = require('../vn_manager.js')._private;
const {
  buildReactionProfiles,
  buildReactionPrompt,
  formatEmotionAnnotatedScene,
  parseReactionResponse
} = require('./reaction_director.js');

function createFixture() {
  const spriteCatalog = buildSpriteCatalog([
    'sprites/dehya_neutral.webp',
    'sprites/dehya_happy.webp',
    'sprites/dehya_concerned.webp',
    'sprites/dehya_sad.webp',
    'sprites/candace_neutral.webp',
    'sprites/candace_sad.webp',
    'sprites/candace_angry.webp',
    'sprites/guard_neutral.webp',
    'sprites/ari_neutral.webp',
    'sprites/ari_happy.webp'
  ]);
  const turnContext = {
    input: { playerCharacterName: 'Ari', userPrompt: 'Continue.' },
    output: { party: ['Dehya', 'Candace', 'Guard'] },
    processed: {
      vnManager: {
        processedLines: [
          { type: 'dialogue', character: 'Dehya', text: 'What a lovely day!', emotion: 'happy' },
          { type: 'dialogue', character: 'Candace', text: 'My cat died.', emotion: 'sad' },
          { type: 'narrative', line: 'The tower explodes behind them.' },
          { type: 'dialogue', character: 'Dehya', text: 'Candace, I am so sorry.', emotion: 'sad' }
        ],
        spriteCatalog,
        spriteMetadata: {
          characters: {
            dehya: { emotionGuidance: 'Masks fear with restrained concern.' }
          }
        }
      }
    },
    runtime: {
      rootDirectory: 'C:/story',
      vnManager: {
        spriteCatalog,
        spriteMetadata: {
          characters: {
            dehya: { emotionGuidance: 'Masks fear with restrained concern.' }
          }
        }
      }
    }
  };
  return { spriteCatalog, turnContext };
}

test('builds profiles only for non-player characters with expression choices', () => {
  const { spriteCatalog, turnContext } = createFixture();
  const profiles = buildReactionProfiles(turnContext, spriteCatalog);

  assert.deepEqual(profiles.map(profile => profile.normalizedName), ['dehya', 'candace']);
  assert.match(profiles[0].guidance, /restrained concern/);
  assert(!profiles.some(profile => profile.normalizedName === 'ari'));
  assert(!profiles.some(profile => profile.normalizedName === 'guard'));
});

test('formats authoritative speaker expressions and narration with global indexes', () => {
  const { turnContext } = createFixture();
  const scene = formatEmotionAnnotatedScene(turnContext);

  assert.match(scene, /0\. Dehya \[speaker expression: happy\]: What a lovely day!/);
  assert.match(scene, /1\. Candace \[speaker expression: sad\]: My cat died\./);
  assert.match(scene, /2\. Narration: The tower explodes behind them\./);
});

test('accepts sparse listener and narrative changes while rejecting contradictions', () => {
  const { spriteCatalog, turnContext } = createFixture();
  const profiles = buildReactionProfiles(turnContext, spriteCatalog);
  const response = JSON.stringify({
    reactions: [
      { line: 1, character: 'dehya', emotion: 'concerned', reason: 'The news makes her smile inappropriate.' },
      { line: 1, character: 'candace', emotion: 'angry', reason: 'Invalid speaker override.' },
      { line: 2, character: 'candace', emotion: 'angry', reason: 'The explosion provokes anger.' },
      { line: 2, character: 'dehya', emotion: 'concerned', reason: 'Redundant carried expression.' },
      { line: 2, character: 'dehya', emotion: 'surprised', reason: 'Unavailable expression.' },
      { line: 99, character: 'dehya', emotion: 'sad', reason: 'Invalid line.' }
    ]
  });

  assert.deepEqual(parseReactionResponse(response, turnContext, spriteCatalog, profiles), [
    {
      line: 1,
      character: 'Dehya',
      emotion: 'concerned',
      reason: 'The news makes her smile inappropriate.'
    },
    {
      line: 2,
      character: 'Candace',
      emotion: 'angry',
      reason: 'The explosion provokes anger.'
    }
  ]);
});

test('preserves emotional contrast with an empty reaction list', () => {
  const { spriteCatalog, turnContext } = createFixture();
  const profiles = buildReactionProfiles(turnContext, spriteCatalog);
  assert.deepEqual(
    parseReactionResponse('{"reactions":[]}', turnContext, spriteCatalog, profiles),
    []
  );
});

test('builds the one-shot prompt without unresolved placeholders', () => {
  const { spriteCatalog, turnContext } = createFixture();
  const profiles = buildReactionProfiles(turnContext, spriteCatalog);
  const template = fs.readFileSync('engine/prompts/reaction_director.txt', 'utf8');
  const prompt = buildReactionPrompt(template, {
    profiles,
    indexedScene: formatEmotionAnnotatedScene(turnContext),
    projectDirectives: 'Keep reactions restrained.'
  });

  assert.match(prompt, /EXAMPLE 1: CORRECT A STALE EXPRESSION/);
  assert.match(prompt, /dehya: .*concerned/);
  assert.match(prompt, /Keep reactions restrained\./);
  assert.doesNotMatch(prompt, /\{REACTION_PROFILES\}|\{INDEXED_SCENE_WITH_SPEAKER_EXPRESSIONS\}/);
});

test('resolves reactions additively without overwriting dialogue metadata', async () => {
  const { turnContext } = createFixture();
  const targetLine = turnContext.processed.vnManager.processedLines[1];
  targetLine.fto = { class: 'normal', offsetMs: 200 };
  targetLine.speakerTarget = 'dehya';

  await resolveReactionSprites(
    turnContext,
    [],
    [],
    [{ line: 1, character: 'Dehya', emotion: 'concerned', reason: 'Listener reaction.' }],
    {
      findSprite: async () => ({ image: 'C:/story/assets/sprites/dehya_concerned.webp', rotations: ['front', 'left'] }),
      relativizeAssetPath: value => value.replace('C:/story/assets/', '')
    }
  );

  assert.deepEqual(targetLine.fto, { class: 'normal', offsetMs: 200 });
  assert.equal(targetLine.speakerTarget, 'dehya');
  assert.deepEqual(targetLine.reactionChanges, [{
    character: 'Dehya',
    emotion: 'concerned',
    image: 'sprites/dehya_concerned.webp',
    availableRotations: ['front', 'left']
  }]);
});
