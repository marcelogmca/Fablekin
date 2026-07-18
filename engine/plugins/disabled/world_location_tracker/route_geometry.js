function finitePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizePoints(points) {
    const result = [];
    for (const raw of Array.isArray(points) ? points : []) {
        const point = finitePoint(raw);
        if (!point) continue;
        const previous = result[result.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-9) result.push(point);
    }
    return result;
}

function corridorLength(points) {
    const source = normalizePoints(points);
    let length = 0;
    for (let index = 1; index < source.length; index += 1) {
        length += Math.hypot(source[index].x - source[index - 1].x, source[index].y - source[index - 1].y);
    }
    return length;
}

function projectPointToCorridor(pointInput, pointsInput, minimumDistance = 0) {
    const point = finitePoint(pointInput);
    const points = normalizePoints(pointsInput);
    if (!point || points.length < 2) return null;

    let best = null;
    let traversed = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength <= 1e-9) continue;
        const segmentStartDistance = traversed;
        const rawT = (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / (segmentLength * segmentLength);
        const minT = Math.max(0, (Number(minimumDistance || 0) - segmentStartDistance) / segmentLength);
        const t = Math.max(minT, Math.min(1, rawT));
        if (t > 1) {
            traversed += segmentLength;
            continue;
        }
        const projected = { x: start.x + (dx * t), y: start.y + (dy * t) };
        const offset = Math.hypot(point.x - projected.x, point.y - projected.y);
        const distance = segmentStartDistance + (segmentLength * t);
        if (!best || offset < best.offset - 1e-9 || (Math.abs(offset - best.offset) <= 1e-9 && distance > best.distance)) {
            best = { point: projected, offset, distance, segmentIndex: index, segmentT: t };
        }
        traversed += segmentLength;
    }
    return best;
}

function trimCorridorFromProjection(pointsInput, projection) {
    const points = normalizePoints(pointsInput);
    if (!projection || points.length < 2) return points;
    return normalizePoints([projection.point, ...points.slice(projection.segmentIndex + 1)]);
}

function alignCorridorToPoint(pointsInput, pointInput, minimumDistance = 0) {
    const points = normalizePoints(pointsInput);
    const point = finitePoint(pointInput);
    if (!point || points.length < 2) return { corridor: points, projection: null };
    const projection = projectPointToCorridor(point, points, minimumDistance);
    if (!projection) return { corridor: points, projection: null };
    const corridor = trimCorridorFromProjection(points, projection);
    corridor[0] = point;
    return { corridor: normalizePoints(corridor), projection };
}

function advanceAlongCorridor(pointsInput, startInput, distancePixels) {
    const start = finitePoint(startInput);
    const aligned = alignCorridorToPoint(pointsInput, start);
    const points = aligned.corridor;
    const requested = Math.max(0, Number(distancePixels) || 0);
    if (!start || points.length < 2 || requested <= 0) {
        return { point: start, remaining: points, consumedPixels: 0, reachedEnd: false, projection: aligned.projection };
    }

    let remainingDistance = requested;
    let consumed = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
        if (segmentLength <= 1e-9) continue;
        if (remainingDistance < segmentLength - 1e-9) {
            const ratio = remainingDistance / segmentLength;
            const point = {
                x: from.x + ((to.x - from.x) * ratio),
                y: from.y + ((to.y - from.y) * ratio)
            };
            return {
                point,
                remaining: normalizePoints([point, ...points.slice(index)]),
                consumedPixels: consumed + remainingDistance,
                reachedEnd: false,
                projection: aligned.projection
            };
        }
        remainingDistance -= segmentLength;
        consumed += segmentLength;
    }

    const point = points[points.length - 1];
    return { point, remaining: [point], consumedPixels: consumed, reachedEnd: true, projection: aligned.projection };
}

module.exports = {
    finitePoint,
    normalizePoints,
    corridorLength,
    projectPointToCorridor,
    trimCorridorFromProjection,
    alignCorridorToPoint,
    advanceAlongCorridor
};
