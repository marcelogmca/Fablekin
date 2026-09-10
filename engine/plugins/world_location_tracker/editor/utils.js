// engine/plugins/world_location_tracker/editor/utils.js

export function deepClone(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

export function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function randomUid() {
    return Math.random().toString(16).slice(2, 10);
}

export function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeDimensions(value) {
    const input = value && typeof value === 'object' ? value : {};
    return { width: Math.max(0, Math.round(toNumber(input.width, 0))), height: Math.max(0, Math.round(toNumber(input.height, 0))) };
}

export function normalizeHexColor(value, fallback) {
    const candidate = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : fallback;
}

export function normalizePointPair(point) {
    if (Array.isArray(point) && point.length >= 2) return [toNumber(point[0], 0), toNumber(point[1], 0)];
    if (point && typeof point === 'object') return [toNumber(point.x, 0), toNumber(point.y, 0)];
    return null;
}

export function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return Number.POSITIVE_INFINITY;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        area += (x1 * y2) - (x2 * y1);
    }
    return Math.abs(area / 2);
}

export function pointInPolygon(x, y, points) {
    if (!Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        const intersects = ((yi > y) !== (yj > y)) && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9)) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}
