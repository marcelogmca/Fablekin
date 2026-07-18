function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function toFinite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAngleMode(value) {
  return String(value || '').trim().toLowerCase() === 'split_x' ? 'split_x' : 'single';
}

function normalizeHexColor(value, fallback = '#000000') {
  const raw = String(value || fallback).trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function canonicalizeQuad(points) {
  const ordered = points
    .slice(0, 4)
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (ordered.length < 4) return null;

  const byY = [...ordered].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);

  if (top.length < 2 || bottom.length < 2) return null;

  return {
    tl: top[0],
    tr: top[1],
    bl: bottom[0],
    br: bottom[1]
  };
}

function normalizeShadow(rawShadow) {
  if (!rawShadow || typeof rawShadow !== 'object') return null;
  if (rawShadow.enabled === false) return null;

  const angleDegrees = toFinite(rawShadow.angleDegrees ?? rawShadow.angle_degrees, 45);
  const angleMode = normalizeAngleMode(rawShadow.angleMode ?? rawShadow.angle_mode);

  return {
    enabled: true,
    angleMode,
    angleDegrees,
    angleDegreesLeft: toFinite(rawShadow.angleDegreesLeft ?? rawShadow.angle_degrees_left, angleDegrees),
    angleDegreesRight: toFinite(rawShadow.angleDegreesRight ?? rawShadow.angle_degrees_right, angleDegrees),
    opacity: clamp(toFinite(rawShadow.opacity ?? rawShadow.strength ?? rawShadow.alpha, 0.4), 0, 1),
    length: clamp(toFinite(rawShadow.length, 0.5), 0, 4),
    blur: clamp(toFinite(rawShadow.blur, 4), 0, 40),
    tintEnabled: rawShadow.tintEnabled === true || rawShadow.tint_enabled === true,
    tintColor: normalizeHexColor(rawShadow.tintColor ?? rawShadow.tint_color, '#000000'),
    tintStrength: clamp(toFinite(rawShadow.tintStrength ?? rawShadow.tint_strength, 0), 0, 1)
  };
}

function projectShadow(shadow, normalizedX) {
  if (!shadow) return null;
  const projected = { ...shadow };
  if (normalizeAngleMode(projected.angleMode ?? projected.angle_mode) === 'split_x') {
    const left = toFinite(projected.angleDegreesLeft ?? projected.angle_degrees_left, projected.angleDegrees);
    const right = toFinite(projected.angleDegreesRight ?? projected.angle_degrees_right, projected.angleDegrees);
    projected.angleDegrees = lerp(left, right, normalizedX);
  } else {
    projected.angleDegrees = toFinite(projected.angleDegrees ?? projected.angle_degrees, 45);
  }
  return projected;
}

function normalizeSpatialStageMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const corners = Array.isArray(raw.corners) ? raw.corners : [];
  const quad = canonicalizeQuad(corners);
  if (!quad) return null;

  let perspectiveScaleFar = toFinite(raw.perspective_scale_far ?? raw.perspectiveScaleFar, 1);
  let perspectiveScaleNearby = toFinite(
    raw.perspective_scale_nearby ?? raw.perspectiveScaleNearby,
    perspectiveScaleFar
  );

  if (perspectiveScaleFar > perspectiveScaleNearby) {
    const tmp = perspectiveScaleFar;
    perspectiveScaleFar = perspectiveScaleNearby;
    perspectiveScaleNearby = tmp;
  }

  return {
    quad,
    perspectiveScaleFar: clamp(perspectiveScaleFar, 0.1, 4),
    perspectiveScaleNearby: clamp(perspectiveScaleNearby, 0.1, 4),
    shadow: normalizeShadow(raw.shadow)
  };
}

function getDefaultStageDepth(normalizedX) {
  const edgeWeight = Math.abs((normalizedX * 2) - 1);
  const centerDepth = 0.32;
  const edgeDepth = 0.96;
  return clamp(lerp(centerDepth, edgeDepth, edgeWeight), 0, 1);
}

function getDepth(normalizedY, normalizedX, applyDefaultCurve = false, activeCount = 0) {
  const baseDepth = clamp((normalizedY - 0.62) / 0.38, 0, 1);
  void activeCount;
  if (!applyDefaultCurve) return baseDepth;

  // Classic VN slots do not provide authored stage depth. Place them on a
  // presentation arc inside the calibrated floor instead of the near edge.
  return Math.min(baseDepth, getDefaultStageDepth(normalizedX));
}

function projectPointInQuad(quad, normalizedX, depth) {
  const leftX = lerp(quad.tl.x, quad.bl.x, depth);
  const leftY = lerp(quad.tl.y, quad.bl.y, depth);
  const rightX = lerp(quad.tr.x, quad.br.x, depth);
  const rightY = lerp(quad.tr.y, quad.br.y, depth);

  return {
    x: lerp(leftX, rightX, normalizedX),
    y: lerp(leftY, rightY, normalizedX)
  };
}

function projectWithSpatialStageMetadata(metadata, params = {}) {
  if (!metadata?.quad) return null;

  const normalizedX = clamp(toFinite(params.normalizedX, 0.5), 0, 1);
  const normalizedY = clamp(toFinite(params.normalizedY, 1), 0, 1.25);
  const layoutScale = Math.max(0.01, toFinite(params.layoutScale, 1));
  const baseZIndex = toFinite(params.baseZIndex, 0);
  const alpha = clamp(toFinite(params.alpha, 1), 0, 1);
  const applyDefaultCurve = params.applyDefaultCurve === true;
  const activeCount = Math.max(0, toFinite(params.activeCount, 0));

  const depth = getDepth(normalizedY, normalizedX, applyDefaultCurve, activeCount);
  const point = projectPointInQuad(metadata.quad, normalizedX, depth);
  const perspectiveScale = lerp(metadata.perspectiveScaleFar, metadata.perspectiveScaleNearby, depth);

  return {
    x: point.x,
    y: point.y,
    scaleMultiplier: layoutScale * perspectiveScale,
    zIndex: baseZIndex + Math.round(depth * 100),
    alpha,
    shadow: projectShadow(metadata.shadow, normalizedX),
    depth
  };
}

module.exports = {
  normalizeSpatialStageMetadata,
  projectWithSpatialStageMetadata
};
