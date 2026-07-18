const { Logger } = require('../../utils.js');

const SUPPORTED_PRESETS = new Set([
  'default',
  'duel',
  'separate',
  'intimate',
  'triangle',
  'protective',
  'observer',
  'lineup',
  'cluster'
]);

const DEFAULT_LAYOUT = Object.freeze({
  x: 0.5,
  y: 1,
  scale: 1,
  zIndex: 0,
  alpha: 1
});

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseForOption(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const duration = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration;
}

function splitCompTokens(rawLine) {
  if (typeof rawLine !== 'string') return null;
  const trimmed = rawLine.trim();
  if (!trimmed.toLowerCase().startsWith('comp:')) return null;
  return trimmed.split(':').map(p => p.trim()).filter(Boolean);
}

function parseCompCommand(rawLine) {
  const tokens = splitCompTokens(rawLine);
  if (!tokens || tokens.length < 2) return null;

  const preset = normalizeName(tokens[1]);
  if (!SUPPORTED_PRESETS.has(preset)) return null;

  const actors = [];
  const options = {};

  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (lower === 'locked') {
      options.locked = true;
      continue;
    }
    if (lower === 'instant') {
      options.instant = true;
      continue;
    }
    if (lower.startsWith('for=')) {
      const parsedFor = parseForOption(token.slice(4));
      if (parsedFor !== null) options.for = parsedFor;
      continue;
    }
    if (lower.startsWith('ease=')) {
      const easeValue = token.slice(5).trim();
      if (easeValue) options.ease = easeValue;
      continue;
    }
    if (token.includes('=')) {
      const eqIdx = token.indexOf('=');
      const key = token.slice(0, eqIdx).trim();
      const value = token.slice(eqIdx + 1).trim();
      if (key && value) options[key] = value;
      continue;
    }
    actors.push(token);
  }

  return { preset, actors, options };
}

function extractCompEvent(line) {
  const events = Array.isArray(line?.clientEvents) ? line.clientEvents : [];
  let found = null;
  for (const ev of events) {
    if (ev?.type === 'comp:set') {
      const payload = ev.payload || {};
      const preset = normalizeName(payload.preset);
      if (!SUPPORTED_PRESETS.has(preset)) continue;
      found = {
        preset,
        actors: Array.isArray(payload.actors) ? payload.actors : [],
        options: payload.options && typeof payload.options === 'object' ? payload.options : {}
      };
    }
  }
  if (found) return found;

  const commands = events
    .map(ev => (typeof ev?.originalCommand === 'string' ? ev.originalCommand : null))
    .filter(Boolean);
  for (const cmd of commands) {
    const parsed = parseCompCommand(cmd);
    if (parsed) found = parsed;
  }
  if (found) return found;

  const rawLine = line?.line || line?.text || '';
  return parseCompCommand(rawLine);
}

function addCompositionMetadata(line, metadata) {
  line.composition = {
    preset: metadata.preset,
    actors: metadata.actors.slice(),
    resolvedActors: metadata.resolvedActors.slice(),
    options: { ...metadata.options },
    sticky: metadata.sticky
  };
}

function collectVisibleSprites(line) {
  if (!Array.isArray(line?.sprites)) return [];
  return line.sprites.filter(s => s && typeof s === 'object' && s.path);
}

function toCharMap(sprites) {
  const map = new Map();
  for (const sprite of sprites) {
    const key = normalizeName(sprite.character);
    if (key) map.set(key, sprite);
  }
  return map;
}

function findActiveActors(actorNames, charMap, playerLower) {
  const named = actorNames.map(name => ({ raw: name, key: normalizeName(name) })).filter(a => a.key);
  const visible = [];
  const missing = [];
  for (const actor of named) {
    if (charMap.has(actor.key)) {
      visible.push(actor.key);
    } else if (actor.key !== playerLower) {
      missing.push(actor.key);
    }
  }
  return { visible, missing };
}

function spreadRatios(count) {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  if (count === 2) return [1 / 3, 2 / 3];
  if (count === 3) return [1 / 6, 0.5, 5 / 6];

  const margin = count >= 5 ? 0.08 : 0.12;
  const span = 1 - (margin * 2);
  return Array.from({ length: count }, (_unused, idx) => margin + (span * (idx / (count - 1))));
}

function compactRatios(count, center = 0.5, step = 0.09, min = 0.06, max = 0.94) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_unused, idx) => {
    const offset = (idx - (count - 1) / 2) * step;
    return clamp(center + offset, min, max);
  });
}

function sideFromOptions(options, fallback = 'left') {
  const side = normalizeName(options?.side || options?.anchor || fallback);
  return side === 'right' ? 'right' : 'left';
}

function mirroredSide(side) {
  return side === 'right' ? 'left' : 'right';
}

function sideCenter(side, near = 0.24, far = 0.76) {
  return side === 'right' ? far : near;
}

function supportRatios(count) {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  if (count === 2) return [0.16, 0.84];
  if (count === 3) return [0.12, 0.5, 0.88];
  return spreadRatios(count);
}

function peripheralRatios(count, preferredSide = 'right') {
  if (count <= 0) return [];
  if (count === 1) return [preferredSide === 'left' ? 0.16 : 0.84];
  if (count === 2) return [0.16, 0.84];
  if (count === 3) return [0.12, 0.5, 0.88];
  return spreadRatios(count);
}

function slotOf(charMap, charKey) {
  const slot = Number(charMap.get(charKey)?.slot);
  return Number.isFinite(slot) ? slot : null;
}

function normalizedSlots(sprites) {
  const fallbackOrder = sprites
    .map((sprite, index) => ({ sprite, slot: Number.isFinite(Number(sprite.slot)) ? Number(sprite.slot) : index }))
    .sort((a, b) => a.slot - b.slot);
  const ratios = spreadRatios(fallbackOrder.length);
  const map = new Map();
  fallbackOrder.forEach((entry, idx) => {
    map.set(entry.sprite, ratios[idx] ?? 0.5);
  });
  return map;
}

function lineupOrder(visibleActorKeys, sprites) {
  const namedSet = new Set(visibleActorKeys);
  const extras = sprites
    .filter(sprite => !namedSet.has(normalizeName(sprite.character)))
    .map(sprite => normalizeName(sprite.character))
    .filter(Boolean);
  return [...visibleActorKeys, ...extras];
}

function visibleCharacterOrder(sprites) {
  return sprites
    .map((sprite, index) => ({
      key: normalizeName(sprite.character),
      order: Number.isFinite(Number(sprite.slot)) ? Number(sprite.slot) : index
    }))
    .filter(entry => entry.key)
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.key);
}

function preserveCurrentActorOrder(actorKeys, sprites) {
  const orderMap = new Map();
  visibleCharacterOrder(sprites).forEach((key, index) => {
    if (!orderMap.has(key)) orderMap.set(key, index);
  });

  return actorKeys
    .slice()
    .sort((a, b) => (orderMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function applyLayoutsByOrder(order, charMap, templateForIndex, shared = {}) {
  const layouts = new Map();
  order.forEach((charKey, idx) => {
    const sprite = charMap.get(charKey);
    if (!sprite) return;
    const tpl = templateForIndex(idx, order.length, charKey) || {};
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      ...tpl,
      ...shared
    });
  });
  return layouts;
}

function applyDefaultLayoutsForRemaining(layouts, sprites, excludedKeys, role = 'support') {
  const slotMap = normalizedSlots(sprites);
  for (const sprite of sprites) {
    if (excludedKeys.has(normalizeName(sprite.character))) continue;
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(sprite) ?? 0.5,
      role
    });
  }
}

function solveDefaultLayout(sprites) {
  const slotMap = normalizedSlots(sprites);
  const layouts = new Map();
  for (const sprite of sprites) {
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(sprite) ?? 0.5
    });
  }
  return layouts;
}

function solveDuel(charMap, actorKeys, sprites, options = {}) {
  const candidates = actorKeys.length >= 2 ? actorKeys.slice(0, 2) : visibleCharacterOrder(sprites).slice(0, 2);
  const order = preserveCurrentActorOrder(candidates, sprites);
  if (order.length < 2) {
    return solveDefaultLayout(sprites);
  }
  const layouts = applyLayoutsByOrder(order, charMap, idx => (
    idx === 0
      ? { x: 0.33, scale: 1, zIndex: 20, role: 'duel_left', facingHint: 'right' }
      : { x: 0.67, scale: 1, zIndex: 20, role: 'duel_right', facingHint: 'left' }
  ), options);
  applyDefaultLayoutsForRemaining(layouts, sprites, new Set(order));
  return layouts;
}

function solveSeparate(charMap, actorKeys, sprites, options = {}) {
  const candidates = actorKeys.length >= 2 ? actorKeys.slice(0, 2) : visibleCharacterOrder(sprites).slice(0, 2);
  const order = preserveCurrentActorOrder(candidates, sprites);
  if (order.length < 2) return solveDefaultLayout(sprites);
  const layouts = applyLayoutsByOrder(order, charMap, idx => (
    idx === 0
      ? { x: 0.16, scale: 1, zIndex: 18, role: 'separate_left', facingHint: 'right' }
      : { x: 0.84, scale: 1, zIndex: 18, role: 'separate_right', facingHint: 'left' }
  ), options);
  applyDefaultLayoutsForRemaining(layouts, sprites, new Set(order), 'background');
  return layouts;
}

function solveIntimate(charMap, actorKeys, sprites, options = {}) {
  const candidates = actorKeys.length >= 2 ? actorKeys.slice(0, 2) : visibleCharacterOrder(sprites).slice(0, 2);
  const order = preserveCurrentActorOrder(candidates, sprites);
  if (order.length < 2) return solveDefaultLayout(sprites);
  const layouts = applyLayoutsByOrder(order, charMap, idx => (
    idx === 0
      ? { x: 0.44, scale: 1, zIndex: 22, role: 'intimate_left', facingHint: 'right' }
      : { x: 0.56, scale: 1, zIndex: 22, role: 'intimate_right', facingHint: 'left' }
  ), options);
  applyDefaultLayoutsForRemaining(layouts, sprites, new Set(order));
  return layouts;
}

function solveTriangle(charMap, actorKeys, sprites, options = {}) {
  const candidates = actorKeys.length > 0 ? actorKeys : visibleCharacterOrder(sprites);
  const order = preserveCurrentActorOrder(candidates, sprites).slice(0, 3);
  if (order.length <= 1) return solveDefaultLayout(sprites);
  if (order.length === 2) return solveDuel(charMap, order, sprites, options);
  const positions = [
    { x: 0.28, scale: 1, zIndex: 18, role: 'triangle_left' },
    { x: 0.5, scale: 1, zIndex: 24, role: 'triangle_center' },
    { x: 0.72, scale: 1, zIndex: 18, role: 'triangle_right' }
  ];
  const layouts = applyLayoutsByOrder(order, charMap, idx => positions[idx], options);
  applyDefaultLayoutsForRemaining(layouts, sprites, new Set(order));
  return layouts;
}

function solveProtective(charMap, actorKeys, sprites, options = {}) {
  const protector = actorKeys[0] || lineupOrder(actorKeys, sprites)[0];
  const protectedTarget = actorKeys[1] || lineupOrder(actorKeys, sprites)[1];
  const ally = actorKeys[2] || lineupOrder(actorKeys, sprites)[2];
  if (!protector) return solveDefaultLayout(sprites);

  const layouts = new Map();
  const slotMap = normalizedSlots(sprites);
  const protectorSprite = charMap.get(protector);
  if (protectorSprite) {
    layouts.set(protectorSprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(protectorSprite) ?? 0.5,
      scale: 1,
      zIndex: 28,
      role: 'protector_foreground',
      facingHint: 'front',
      ...options
    });
  }

  if (protectedTarget && charMap.has(protectedTarget)) {
    const protectedSprite = charMap.get(protectedTarget);
    layouts.set(protectedSprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(protectedSprite) ?? 0.5,
      scale: 1,
      zIndex: 16,
      alpha: 0.92,
      role: 'protected_center',
      ...options
    });
  }

  if (ally && charMap.has(ally)) {
    const allySprite = charMap.get(ally);
    layouts.set(allySprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(allySprite) ?? 0.5,
      scale: 1,
      zIndex: 14,
      role: 'protector_support',
      ...options
    });
  }

  const remaining = sprites.filter(sprite => !layouts.has(sprite));
  const positions = supportRatios(remaining.length);
  remaining.forEach((sprite, idx) => {
    if (layouts.has(sprite)) return;
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: positions[idx] ?? 0.15,
      scale: 1,
      alpha: 0.72,
      zIndex: 6,
      role: 'support'
    });
  });
  return layouts;
}

function solveObserver(charMap, actorKeys, sprites, options = {}) {
  const observer = actorKeys[0] || lineupOrder(actorKeys, sprites)[0];
  const pair = preserveCurrentActorOrder(
    lineupOrder(actorKeys.slice(1), sprites).filter(k => k !== observer),
    sprites
  ).slice(0, 2);
  const layouts = new Map();
  const slotMap = normalizedSlots(sprites);

  if (observer && charMap.has(observer)) {
    const observerSprite = charMap.get(observer);
    layouts.set(observerSprite, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(observerSprite) ?? 0.5,
      scale: 1,
      alpha: 0.7,
      zIndex: 8,
      role: 'observer',
      ...options
    });
  }

  if (pair[0] && charMap.has(pair[0])) {
    const subjectA = charMap.get(pair[0]);
    layouts.set(subjectA, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(subjectA) ?? 0.5,
      scale: 1,
      zIndex: 20,
      role: 'subject_a',
      ...options
    });
  }

  if (pair[1] && charMap.has(pair[1])) {
    const subjectB = charMap.get(pair[1]);
    layouts.set(subjectB, {
      ...DEFAULT_LAYOUT,
      x: slotMap.get(subjectB) ?? 0.5,
      scale: 1,
      zIndex: 20,
      role: 'subject_b',
      ...options
    });
  }

  const remaining = sprites.filter(sprite => !layouts.has(sprite));
  const positions = compactRatios(remaining.length, 0.82, 0.08, 0.66, 0.94);
  remaining.forEach((sprite, idx) => {
    if (layouts.has(sprite)) return;
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: positions[idx] ?? 0.82,
      scale: 1,
      alpha: 0.7,
      zIndex: 6,
      role: 'support'
    });
  });
  return layouts;
}

function solveIsolate(charMap, actorKeys, sprites, options = {}) {
  const target = actorKeys[0] || lineupOrder(actorKeys, sprites)[0];
  return solveClose(charMap, target, sprites, {
    ...options,
    role: 'isolated_subject',
    othersAlpha: 0.5,
    othersScale: 0.74
  });
}

function solveGroupSmall(charMap, _actorKeys, sprites, options = {}) {
  const order = lineupOrder([], sprites);
  const offsets = compactRatios(order.length, 0.5, 0.085);
  const layouts = applyLayoutsByOrder(order, charMap, idx => ({
    x: offsets[idx] ?? 0.5,
    y: 0.86,
    scale: 0.78,
    alpha: 0.94,
    zIndex: 12,
    role: 'group_small'
  }), options);
  return layouts;
}

function solveTinyInWorld(charMap, _actorKeys, sprites, options = {}) {
  const order = lineupOrder([], sprites);
  const offsets = order.length <= 3
    ? [0.32, 0.5, 0.68]
    : spreadRatios(order.length).map(x => 0.18 + (x * 0.64));
  return applyLayoutsByOrder(order, charMap, idx => ({
    x: offsets[idx] ?? 0.5,
    y: 0.74,
    scale: 0.46,
    alpha: 0.9,
    zIndex: 6,
    role: 'tiny_in_world'
  }), options);
}

function solveClose(charMap, targetKey, sprites, options = {}) {
  const target = targetKey && charMap.has(targetKey) ? targetKey : lineupOrder([], sprites)[0];
  if (!target) return solveDefaultLayout(sprites);
  const layouts = new Map();
  const targetRole = options.role || 'close_subject';
  const otherCount = sprites.filter(sprite => normalizeName(sprite.character) !== target).length;
  const targetX = otherCount > 0 ? 0.44 : 0.5;
  layouts.set(charMap.get(target), {
    ...DEFAULT_LAYOUT,
    x: targetX,
    scale: 1.1,
    zIndex: 30,
    alpha: 1,
    role: targetRole,
    ...options
  });
  const othersAlpha = safeNumber(options.othersAlpha, 0.76);
  const othersScale = safeNumber(options.othersScale, 0.84);
  const others = sprites.filter(sprite => normalizeName(sprite.character) !== target);
  const positions = peripheralRatios(others.length, 'right');
  others.forEach((sprite, idx) => {
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: positions[idx] ?? 0.5,
      y: 0.92,
      scale: othersScale,
      alpha: othersAlpha,
      zIndex: 12,
      role: 'close_support'
    });
  });
  return layouts;
}

function solveOverShoulder(charMap, actorKeys, sprites, options = {}) {
  const shoulder = actorKeys[0] || lineupOrder(actorKeys, sprites)[0];
  const subject = actorKeys[1] || lineupOrder(actorKeys.slice(1), sprites)[0];
  if (!shoulder || !subject || !charMap.has(subject)) {
    return solveClose(charMap, subject || shoulder, sprites, options);
  }
  const shoulderSlot = slotOf(charMap, shoulder);
  const subjectSlot = slotOf(charMap, subject);
  const shoulderSide = shoulderSlot !== null && subjectSlot !== null && shoulderSlot > subjectSlot ? 'right' : 'left';
  const subjectX = shoulderSide === 'left' ? 0.62 : 0.38;
  const shoulderX = shoulderSide === 'left' ? 0.12 : 0.88;
  const layouts = new Map();
  if (charMap.has(shoulder)) {
    layouts.set(charMap.get(shoulder), {
      ...DEFAULT_LAYOUT,
      x: shoulderX,
      scale: 1.12,
      alpha: 0.72,
      zIndex: 34,
      role: 'over_shoulder_foreground',
      facingHint: shoulderSide === 'left' ? 'right' : 'left',
      ...options
    });
  }
  layouts.set(charMap.get(subject), {
    ...DEFAULT_LAYOUT,
    x: subjectX,
    scale: 1.04,
    zIndex: 22,
    role: 'over_shoulder_subject',
    facingHint: shoulderSide === 'left' ? 'left' : 'right',
    ...options
  });
  const remaining = sprites.filter(sprite => !layouts.has(sprite));
  const positions = peripheralRatios(remaining.length, shoulderSide === 'left' ? 'right' : 'left');
  remaining.forEach((sprite, idx) => {
    if (layouts.has(sprite)) return;
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: positions[idx] ?? (shoulderSide === 'left' ? 0.84 : 0.16),
      scale: 0.8,
      alpha: 0.68,
      zIndex: 6,
      role: 'support'
    });
  });
  return layouts;
}

function solveLineup(charMap, actorKeys, sprites, options = {}) {
  const candidates = actorKeys.length > 0 ? actorKeys : visibleCharacterOrder(sprites);
  const order = preserveCurrentActorOrder(lineupOrder(candidates, sprites), sprites);
  if (order.length <= 1) return solveDefaultLayout(sprites);
  const positions = order.length === 2 ? [0.25, 0.75] : spreadRatios(order.length);
  return applyLayoutsByOrder(order, charMap, (idx, total) => {
    return {
      x: positions[idx] ?? 0.5,
      y: 0.96,
      scale: 1,
      zIndex: 16 + (total - idx),
      role: `lineup_${idx + 1}`
    };
  }, options);
}

function solveCluster(charMap, actorKeys, sprites, options = {}) {
  const side = sideFromOptions(options, 'left');
  const counterSide = mirroredSide(side);
  const orderedVisibleActors = preserveCurrentActorOrder(actorKeys.filter(key => charMap.has(key)), sprites);
  const clusterOrder = orderedVisibleActors.length > 0 ? orderedVisibleActors : lineupOrder([], sprites);
  const clusterSet = new Set(clusterOrder);
  const clusterCenter = sideCenter(side, 0.24, 0.76);
  const clusterMin = side === 'left' ? 0.08 : 0.56;
  const clusterMax = side === 'left' ? 0.44 : 0.92;
  const clusterPositions = compactRatios(clusterOrder.length, clusterCenter, clusterOrder.length >= 4 ? 0.06 : 0.095, clusterMin, clusterMax);
  const layouts = applyLayoutsByOrder(clusterOrder, charMap, (idx) => ({
    x: clusterPositions[idx] ?? clusterCenter,
    y: 0.93,
    scale: 1,
    alpha: 0.98,
    zIndex: 12 + idx,
    role: `cluster_${side}_${idx + 1}`,
    facingHint: side === 'left' ? 'right' : 'left'
  }), options);

  const counterSprites = sprites.filter(sprite => !clusterSet.has(normalizeName(sprite.character)));
  const counterCenter = sideCenter(counterSide, 0.24, 0.76);
  const counterMin = counterSide === 'left' ? 0.06 : 0.58;
  const counterMax = counterSide === 'left' ? 0.42 : 0.94;
  const counterPositions = compactRatios(counterSprites.length, counterCenter, counterSprites.length >= 3 ? 0.08 : 0.14, counterMin, counterMax);
  counterSprites.forEach((sprite, idx) => {
    layouts.set(sprite, {
      ...DEFAULT_LAYOUT,
      x: counterPositions[idx] ?? counterCenter,
      y: 0.96,
      scale: 1,
      alpha: 1,
      zIndex: 22 + idx,
      role: `cluster_counter_${counterSide}_${idx + 1}`,
      facingHint: counterSide === 'left' ? 'right' : 'left',
      ...options
    });
  });

  return layouts;
}

function solvePreset(preset, context) {
  const { charMap, actorKeys, sprites, options } = context;
  switch (preset) {
    case 'default': return solveDefaultLayout(sprites);
    case 'duel': return solveDuel(charMap, actorKeys, sprites, options);
    case 'separate': return solveSeparate(charMap, actorKeys, sprites, options);
    case 'intimate': return solveIntimate(charMap, actorKeys, sprites, options);
    case 'triangle': return solveTriangle(charMap, actorKeys, sprites, options);
    case 'protective': return solveProtective(charMap, actorKeys, sprites, options);
    case 'observer': return solveObserver(charMap, actorKeys, sprites, options);
    case 'isolate': return solveIsolate(charMap, actorKeys, sprites, options);
    case 'group_small': return solveGroupSmall(charMap, actorKeys, sprites, options);
    case 'tiny_in_world': return solveTinyInWorld(charMap, actorKeys, sprites, options);
    case 'close': return solveClose(charMap, actorKeys[0], sprites, options);
    case 'over_shoulder': return solveOverShoulder(charMap, actorKeys, sprites, options);
    case 'lineup': return solveLineup(charMap, actorKeys, sprites, options);
    case 'cluster': return solveCluster(charMap, actorKeys, sprites, options);
    default: return solveDefaultLayout(sprites);
  }
}

function normalizeLayout(layout, baseRole) {
  return {
    x: clamp(safeNumber(layout.x, 0.5), 0, 1),
    y: clamp(safeNumber(layout.y, 1), 0, 1.2),
    scale: clamp(safeNumber(layout.scale, 1), 0.4, 1.5),
    zIndex: safeNumber(layout.zIndex, 0),
    alpha: clamp(safeNumber(layout.alpha, 1), 0.2, 1),
    role: layout.role || baseRole || 'composed',
    facingHint: layout.facingHint || null,
    transition: {
      instant: !!layout.instant,
      ease: typeof layout.ease === 'string' && layout.ease ? layout.ease : 'smooth'
    }
  };
}

function applyLayoutMapToSprites(sprites, layoutMap, sharedOptions = {}) {
  for (const sprite of sprites) {
    const solved = layoutMap.get(sprite) || DEFAULT_LAYOUT;
    sprite.layout = normalizeLayout(
      { ...solved, ...sharedOptions },
      solved.role || 'composed'
    );
  }
}

function hasFlushEvent(line) {
  const events = Array.isArray(line?.clientEvents) ? line.clientEvents : [];
  return events.some(ev => ev?.type === 'vn:cast-flush');
}

function nextStateFromCommand(command, lineIndex) {
  if (!command || !SUPPORTED_PRESETS.has(command.preset)) return null;
  const options = command.options || {};
  const duration = parseForOption(options.for);
  return {
    preset: command.preset,
    actors: Array.isArray(command.actors) ? command.actors.filter(Boolean) : [],
    options: {
      ...options,
      instant: !!options.instant,
      locked: !!options.locked,
      ease: typeof options.ease === 'string' ? options.ease : 'smooth'
    },
    expiresAt: duration ? lineIndex + duration : null
  };
}

function compileSpriteCompositionForPayload(sequence, { playerCharacterName = '' } = {}) {
  if (!Array.isArray(sequence)) return sequence;

  const playerLower = normalizeName(playerCharacterName);
  let activeComposition = null;
  let compEventCount = 0;
  let composedLineCount = 0;
  let layoutSpriteCount = 0;
  let firstCompSummary = null;

  for (let index = 0; index < sequence.length; index++) {
    const line = sequence[index];

    if (activeComposition && activeComposition.expiresAt !== null && index > activeComposition.expiresAt) {
      activeComposition = null;
    }

    if (hasFlushEvent(line) && activeComposition && !activeComposition.options.locked) {
      activeComposition = null;
    }

    const command = extractCompEvent(line);
    if (command) {
      compEventCount++;
      if (!firstCompSummary) {
        firstCompSummary = `${command.preset} at sequence line ${index}`;
      }
      const nextState = nextStateFromCommand(command, index);
      if (nextState) {
        activeComposition = nextState;
      }
    }

    const sprites = collectVisibleSprites(line);
    if (sprites.length === 0) {
      if (line && typeof line === 'object') {
        line.composition = activeComposition ? {
          preset: activeComposition.preset,
          actors: activeComposition.actors.slice(),
          resolvedActors: [],
          options: { ...activeComposition.options },
          sticky: true
        } : null;
      }
      continue;
    }

    const effective = activeComposition || {
      preset: 'default',
      actors: [],
      options: { instant: false, locked: false, ease: 'smooth' },
      expiresAt: null
    };

    const charMap = toCharMap(sprites);
    const actorResolution = findActiveActors(effective.actors, charMap, playerLower);
    const actorKeys = actorResolution.visible.slice();
    const solveOptions = {
      ...effective.options,
      instant: !!effective.options.instant,
      ease: effective.options.ease || 'smooth'
    };
    const layoutMap = solvePreset(effective.preset, {
      charMap,
      actorKeys,
      sprites,
      options: solveOptions
    });

    applyLayoutMapToSprites(sprites, layoutMap, {
      instant: !!effective.options.instant,
      ease: effective.options.ease || 'smooth'
    });
    composedLineCount++;
    layoutSpriteCount += sprites.filter(sprite => sprite?.layout).length;

    addCompositionMetadata(line, {
      preset: effective.preset,
      actors: effective.actors,
      resolvedActors: actorResolution.visible,
      options: effective.options,
      sticky: !!activeComposition
    });
  }

  if (compEventCount > 0) {
    Logger.log(
      'CompositionPositioner',
      `Compiled ${compEventCount} comp event(s); first=${firstCompSummary}; laid out ${layoutSpriteCount} sprite instance(s) across ${composedLineCount} line(s).`
    );
  }

  return sequence;
}

module.exports = {
  SUPPORTED_PRESETS,
  parseCompCommand,
  compileSpriteCompositionForPayload
};
