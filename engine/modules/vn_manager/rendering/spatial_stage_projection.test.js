const assert = require('assert');
const {
  normalizeSpatialStageMetadata,
  projectWithSpatialStageMetadata
} = require('./spatial_stage_projection.js');

function assertApprox(actual, expected, message) {
  assert(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

function runTests() {
  const rawMetadata = {
    corners: [
      { x: 220, y: 540 },
      { x: 1700, y: 540 },
      { x: 70, y: 1040 },
      { x: 1850, y: 1040 },
      { x: 999, y: 777 } // ignored (only first four are used)
    ],
    perspective_scale_far: 0.72,
    perspective_scale_nearby: 0.92,
    shadow: {
      enabled: true,
      angle_degrees: 45,
      strength: 0.4,
      length: 0.5,
      blur: 4
    }
  };

  const normalized = normalizeSpatialStageMetadata(rawMetadata);
  assert(normalized, 'Expected valid metadata to normalize');
  assert(normalized.quad.tl.x < normalized.quad.tr.x, 'Top-left and top-right should be ordered');
  assert(normalized.perspectiveScaleFar < normalized.perspectiveScaleNearby, 'Far scale should stay smaller than nearby');
  assert.strictEqual(normalized.shadow.opacity, 0.4, 'Shadow strength should normalize into opacity');

  const left = projectWithSpatialStageMetadata(normalized, {
    normalizedX: 0.12,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: true,
    activeCount: 3
  });
  const middle = projectWithSpatialStageMetadata(normalized, {
    normalizedX: 0.5,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: true,
    activeCount: 3
  });
  const right = projectWithSpatialStageMetadata(normalized, {
    normalizedX: 0.88,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: true,
    activeCount: 3
  });

  assert(left && middle && right, 'Projected points should be generated');
  assert(left.x < middle.x && middle.x < right.x, 'Projection should preserve left-to-right ordering');
  assert(middle.y < left.y && middle.y < right.y, 'Middle should sit slightly farther back (higher on screen)');
  assert(middle.scaleMultiplier < left.scaleMultiplier, 'Middle should be slightly smaller than edges');
  assert(middle.scaleMultiplier < right.scaleMultiplier, 'Middle should be slightly smaller than edges');
  assert.strictEqual(left.shadow.angleDegrees, 45, 'Single-angle shadow should keep its authored angle');
  assert.strictEqual(left.shadow.tintStrength, 0, 'Untinted shadow should default to zero tint strength');

  const nearEdgeCenter = projectWithSpatialStageMetadata(normalized, {
    normalizedX: 0.5,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: false,
    activeCount: 1
  });
  const defaultSlotCenter = projectWithSpatialStageMetadata(normalized, {
    normalizedX: 0.5,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: true,
    activeCount: 1
  });
  assert(
    defaultSlotCenter.y < nearEdgeCenter.y,
    'Default stage slot should land on an inner presentation arc instead of the near edge'
  );
  assert(
    defaultSlotCenter.scaleMultiplier < nearEdgeCenter.scaleMultiplier,
    'Default stage slot should use smaller inner-arc perspective scale'
  );
  assert(
    defaultSlotCenter.depth <= 0.33,
    'Default center slot should sit near the back of the presentation arc'
  );

  const belowScreenStage = normalizeSpatialStageMetadata({
    ...rawMetadata,
    corners: [
      { x: 220, y: 540 },
      { x: 1700, y: 540 },
      { x: 1850, y: 1260 },
      { x: 70, y: 1260 }
    ]
  });
  const belowScreenFeet = projectWithSpatialStageMetadata(belowScreenStage, {
    normalizedX: 0.5,
    normalizedY: 1,
    layoutScale: 1,
    applyDefaultCurve: false
  });
  assert(
    belowScreenFeet.y > 1080,
    'Spatial Stage should support authoring feet below the visible canvas'
  );

  const splitShadow = normalizeSpatialStageMetadata({
    ...rawMetadata,
    shadow: {
      enabled: true,
      angle_mode: 'split_x',
      angle_degrees: 50,
      angle_degrees_left: 20,
      angle_degrees_right: 80,
      strength: 0.5,
      length: 0.7,
      blur: 5,
      tint_enabled: true,
      tint_color: '#c28a52',
      tint_strength: 0.65
    }
  });
  const splitLeft = projectWithSpatialStageMetadata(splitShadow, { normalizedX: 0, normalizedY: 1 });
  const splitMiddle = projectWithSpatialStageMetadata(splitShadow, { normalizedX: 0.5, normalizedY: 1 });
  const splitRight = projectWithSpatialStageMetadata(splitShadow, { normalizedX: 1, normalizedY: 1 });
  assertApprox(splitLeft.shadow.angleDegrees, 20, 'Split-angle left edge should use left shadow angle');
  assertApprox(splitMiddle.shadow.angleDegrees, 50, 'Split-angle middle should interpolate shadow angle');
  assertApprox(splitRight.shadow.angleDegrees, 80, 'Split-angle right edge should use right shadow angle');
  assert.strictEqual(splitMiddle.shadow.tintEnabled, true, 'Tint enabled flag should survive projection');
  assert.strictEqual(splitMiddle.shadow.tintColor, '#c28a52', 'Tint color should survive projection');
  assert.strictEqual(splitMiddle.shadow.tintStrength, 0.65, 'Tint strength should survive projection');

  const explicitSingle = normalizeSpatialStageMetadata({
    ...rawMetadata,
    shadow: {
      enabled: true,
      angle_mode: 'single',
      angle_degrees: 33,
      angle_degrees_left: 10,
      angle_degrees_right: 90
    }
  });
  const singleProjection = projectWithSpatialStageMetadata(explicitSingle, { normalizedX: 0.8, normalizedY: 1 });
  assert.strictEqual(singleProjection.shadow.angleDegrees, 33, 'Single mode should ignore split-angle endpoints');

  const invertedPerspective = normalizeSpatialStageMetadata({
    corners: rawMetadata.corners,
    perspective_scale_far: 0.95,
    perspective_scale_nearby: 0.75
  });
  assert(invertedPerspective, 'Inverted perspective metadata should still normalize');
  assert(
    invertedPerspective.perspectiveScaleFar <= invertedPerspective.perspectiveScaleNearby,
    'Inverted near/far values should be corrected'
  );

  const missingCorners = normalizeSpatialStageMetadata({
    corners: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }]
  });
  assert.strictEqual(missingCorners, null, 'Missing corners should not produce metadata');
  assert.strictEqual(projectWithSpatialStageMetadata(null, {}), null, 'Missing metadata should skip projection');

  console.log('spatial_stage_projection tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
