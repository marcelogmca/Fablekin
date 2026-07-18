const path = require('path');
const { findSprite } = require('./sprite_finder.js');
const { MAX_SPRITE_SLOTS, suppressDuplicateSpriteVisuals } = require('./sprite_positioner.js');
const { Logger, relativizeAssetPath } = require('../../utils.js');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeAssetPath(assetPath) {
  return String(assetPath || '').replace(/\\/g, '/');
}

function collectEvents(line) {
  return Array.isArray(line?.clientEvents) ? line.clientEvents : [];
}

function getCastEnterEvents(line) {
  return collectEvents(line).filter(ev => ev?.type === 'vn:cast-enter');
}

function hasCastFlush(line) {
  return collectEvents(line).some(ev => ev?.type === 'vn:cast-flush');
}

function getVisibleSprites(line) {
  if (!Array.isArray(line?.sprites)) return [];
  return line.sprites.filter(sprite => sprite && typeof sprite === 'object' && sprite.path);
}

function hasActorVisible(line, actorKey) {
  return getVisibleSprites(line).some(sprite => normalizeName(sprite.character) === actorKey);
}

function chooseOpenSlot(sprites, maxSprites) {
  const occupied = new Set(
    getVisibleSprites({ sprites })
      .map(sprite => Number(sprite.slot))
      .filter(slot => Number.isFinite(slot))
  );
  for (let slot = 0; slot < maxSprites; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

function addSpriteToLine(line, spriteTemplate, maxSprites) {
  if (!line || !spriteTemplate) return false;
  if (!Array.isArray(line.sprites)) line.sprites = [];
  const actorKey = normalizeName(spriteTemplate.character);
  if (!actorKey || hasActorVisible(line, actorKey)) return false;

  const visibleCount = getVisibleSprites(line).length;
  if (visibleCount >= maxSprites) return false;

  const slot = chooseOpenSlot(line.sprites, maxSprites);
  if (slot === null) return false;

  const sprite = {
    ...spriteTemplate,
    slot,
    forcedEnter: true
  };

  const nullIdx = line.sprites.findIndex(entry => entry === null || entry === undefined);
  if (nullIdx >= 0) {
    line.sprites[nullIdx] = sprite;
  } else {
    line.sprites.push(sprite);
  }
  return true;
}

function buildSpriteFlags(image, allSpritesSet) {
  const ext = path.extname(image);
  const basePath = normalizeAssetPath(image.slice(0, -ext.length));
  return {
    hasBlink: allSpritesSet.has(`${basePath}_blink${ext}`),
    hasTalk: allSpritesSet.has(`${basePath}_talk${ext}`),
    hasTalkBlink: allSpritesSet.has(`${basePath}_talk_blink${ext}`)
  };
}

function getAllSprites(turnContext) {
  const rawSprites = [
    ...(turnContext?.runtime?.assets?.sprites || []),
    ...(turnContext?.runtime?.assets?.extraSprites || [])
  ];
  const rootDir = turnContext?.runtime?.rootDirectory || turnContext?.rootDirectory;
  return rawSprites.map(sprite => relativizeAssetPath(sprite, rootDir));
}

async function resolveSpriteForActor(actorName, options) {
  const {
    turnContext,
    playerCharacterName = '',
    allSprites = [],
    baseSprites = []
  } = options || {};

  const emotion = String(options?.emotion || 'neutral').trim() || 'neutral';
  const result = await findSprite(
    actorName,
    emotion,
    baseSprites,
    playerCharacterName,
    turnContext,
    allSprites,
    null
  );

  if (!result?.image) return null;

  const rootDir = turnContext?.runtime?.rootDirectory || turnContext?.rootDirectory;
  const image = relativizeAssetPath(result.image, rootDir);
  const allSpritesSet = new Set(allSprites.map(normalizeAssetPath));

  return {
    character: actorName,
    path: image,
    availableRotations: result.rotations || [],
    ...buildSpriteFlags(image, allSpritesSet)
  };
}

function updateForcedTemplateFromVisibleSprites(forcedCast, line) {
  for (const sprite of getVisibleSprites(line)) {
    const key = normalizeName(sprite.character);
    if (key && forcedCast.has(key)) {
      forcedCast.set(key, { ...sprite, forcedEnter: true });
    }
  }
}

async function compileCastEnterForPayload(sequence, {
  turnContext = null,
  playerCharacterName = '',
  maxSprites = MAX_SPRITE_SLOTS,
  spriteResolver = null
} = {}) {
  if (!Array.isArray(sequence)) return sequence;

  const hasCastEnterEvents = sequence.some(line =>
    Array.isArray(line?.clientEvents) &&
    line.clientEvents.some(ev => ev?.type === 'vn:cast-enter')
  );
  if (!hasCastEnterEvents) return sequence;

  if (!turnContext && !spriteResolver) return sequence;
  if (turnContext && (!turnContext.processed || typeof turnContext.processed !== 'object')) {
    turnContext.processed = {};
  }

  const allSprites = getAllSprites(turnContext);
  const baseSprites = Array.isArray(turnContext?.runtime?.vnManager?.spriteCatalog?.global?.baseSprites)
    ? turnContext.runtime.vnManager.spriteCatalog.global.baseSprites
    : allSprites;
  const forcedCast = new Map();
  const resolver = spriteResolver || ((actorName, eventOptions) => resolveSpriteForActor(actorName, {
    turnContext,
    playerCharacterName,
    allSprites,
    baseSprites,
    emotion: eventOptions?.emotion
  }));

  let inserted = 0;

  for (const line of sequence) {
    if (!line || typeof line !== 'object') continue;

    if (hasCastFlush(line)) {
      forcedCast.clear();
    }

    for (const event of getCastEnterEvents(line)) {
      const actors = Array.isArray(event?.payload?.actors) ? event.payload.actors : [];
      const eventOptions = event?.payload?.options || {};
      for (const actorName of actors) {
        const key = normalizeName(actorName);
        if (!key) continue;

        const resolved = await resolver(actorName, eventOptions);
        if (!resolved?.path) {
          Logger.warn('CastEnterCompiler', `Unable to resolve sprite for forced cast enter: ${actorName}`);
          continue;
        }

        forcedCast.set(key, {
          ...resolved,
          character: resolved.character || actorName
        });
      }
    }

    updateForcedTemplateFromVisibleSprites(forcedCast, line);

    for (const [actorKey, spriteTemplate] of forcedCast.entries()) {
      if (hasActorVisible(line, actorKey)) continue;
      if (addSpriteToLine(line, spriteTemplate, maxSprites)) inserted++;
    }

    line.sprites = suppressDuplicateSpriteVisuals(line.sprites);
  }

  if (inserted > 0) {
    Logger.log('CastEnterCompiler', `Inserted ${inserted} forced cast sprite instance(s).`);
  }

  return sequence;
}

module.exports = {
  compileCastEnterForPayload
};
