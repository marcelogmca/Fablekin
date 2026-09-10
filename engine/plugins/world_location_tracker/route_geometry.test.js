const assert = require('node:assert/strict');
const test = require('node:test');

const geometry = require('./route_geometry.js');

test('advanceAlongCorridor interpolates and returns the unconsumed suffix', () => {
    const result = geometry.advanceAlongCorridor(
        [{ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 10, y: -10 }],
        { x: 0, y: 0 },
        15
    );
    assert.deepEqual(result.point, { x: 5, y: -10 });
    assert.deepEqual(result.remaining, [{ x: 5, y: -10 }, { x: 10, y: -10 }]);
    assert.equal(result.reachedEnd, false);
});

test('advanceAlongCorridor clamps overshoot to the route endpoint', () => {
    const result = geometry.advanceAlongCorridor(
        [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        { x: 0, y: 0 },
        50
    );
    assert.deepEqual(result.point, { x: 10, y: 0 });
    assert.equal(result.consumedPixels, 10);
    assert.equal(result.reachedEnd, true);
});

test('projection honors a monotonic minimum corridor distance', () => {
    const corridor = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }];
    const projection = geometry.projectPointToCorridor({ x: 4, y: 0 }, corridor, 12);
    assert.ok(projection.distance >= 12);
    assert.equal(projection.segmentIndex, 1);
});
