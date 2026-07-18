const fs = require('fs/promises');
const path = require('path');
const { formatDistanceKm } = require('./distance_units.js');

const ROUTE_COLORS = ['#ff4d4d', '#f2b84b', '#41c7f2', '#d972ff', '#72e06a', '#ffffff'];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function sanitizeFilePart(value, fallback = 'route_debug') {
    const safe = String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return safe || fallback;
}

function timestampForFile(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function worldToImagePoint(point, width, height) {
    return {
        x: clamp(Number(point?.x || 0), 0, Math.max(0, width)),
        y: clamp(-Number(point?.y || 0), 0, Math.max(0, height))
    };
}

function polylinePoints(points, width, height) {
    return (points || [])
        .map(point => worldToImagePoint(point, width, height))
        .map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ');
}

function buildRouteLabel(route, points, width, height, index, distanceUnit) {
    if (!Array.isArray(points) || points.length === 0) return '';
    const anchor = worldToImagePoint(points[Math.min(points.length - 1, Math.max(0, Math.floor(points.length * 0.35)))], width, height);
    const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
    const label = `${route.title || `Path ${index + 1}`} ${route.distanceKm ? formatDistanceKm(route.distanceKm, distanceUnit) : ''}`.trim();
    const x = clamp(anchor.x + 8, 4, width - 140);
    const y = clamp(anchor.y - 8, 18, height - 8);
    return [
        `<rect x="${x - 4}" y="${y - 14}" width="${Math.max(78, label.length * 7)}" height="18" rx="5" fill="#000000" opacity="0.58"/>`,
        `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeXml(label)}</text>`
    ].join('\n');
}

function buildMarker(point, width, height, color, label) {
    const imagePoint = worldToImagePoint(point, width, height);
    const x = imagePoint.x.toFixed(1);
    const y = imagePoint.y.toFixed(1);
    return [
        `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="#ffffff" stroke-width="2"/>`,
        `<text x="${Number(x) + 11}" y="${Number(y) + 4}" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" font-family="Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(label)}</text>`
    ].join('\n');
}

function buildStopMarkers(routes, width, height) {
    const markers = [];
    for (const route of routes || []) {
        const stops = Array.isArray(route.journey_stops) && route.journey_stops.length
            ? route.journey_stops
            : (route.suggested_stops || []);
        for (const stop of stops) {
            if (!Number.isFinite(Number(stop.x)) || !Number.isFinite(Number(stop.y))) continue;
            const point = worldToImagePoint(stop, width, height);
            markers.push([
                `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="#ffe27a" stroke="#352500" stroke-width="2"/>`,
                `<text x="${(point.x + 7).toFixed(1)}" y="${(point.y - 7).toFixed(1)}" fill="#ffe27a" stroke="#000000" stroke-width="3" paint-order="stroke" font-family="Arial, sans-serif" font-size="11">${escapeXml(stop.name || 'Stop')}</text>`
            ].join('\n'));
        }
    }
    return markers.join('\n');
}

function buildLegend(routes) {
    const rows = (routes || []).map((route, index) => {
        const y = 26 + (index * 18);
        const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
        const label = `${route.title || `Path ${index + 1}`}: ${route.mode_label || ''}`.trim();
        return [
            `<line x1="18" y1="${y - 4}" x2="42" y2="${y - 4}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`,
            `<text x="50" y="${y}" fill="#ffffff" font-family="Arial, sans-serif" font-size="12">${escapeXml(label)}</text>`
        ].join('\n');
    }).join('\n');
    const height = Math.max(34, 16 + ((routes || []).length * 18));
    return [
        `<rect x="10" y="10" width="360" height="${height}" rx="8" fill="#000000" opacity="0.58"/>`,
        rows
    ].join('\n');
}

function buildOverlaySvg({ analysis, width, height }) {
    const routes = (analysis.routes || []).filter(route => Array.isArray(route.debug_path) && route.debug_path.length >= 2);
    const routeLines = routes.map((route, index) => {
        const points = polylinePoints(route.debug_path, width, height);
        const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
        return [
            `<polyline points="${points}" fill="none" stroke="#000000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.68"/>`,
            `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`,
            buildRouteLabel(route, route.debug_path, width, height, index, analysis.distance_unit?.key)
        ].join('\n');
    }).join('\n');

    const start = analysis.request?.start || analysis.start;
    const end = analysis.request?.end || analysis.end;
    const markers = [
        start ? buildMarker(start, width, height, '#35d06f', `Start: ${start.label || 'start'}`) : '',
        end ? buildMarker(end, width, height, '#ff4d4d', `End: ${end.label || 'end'}`) : '',
        buildStopMarkers(routes, width, height)
    ].filter(Boolean).join('\n');

    return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${routeLines}
  ${markers}
  ${buildLegend(routes)}
</svg>`);
}

async function writeRouteDebugImage({ analysis, mapImagePath, packagePath, requestedFileName = null }) {
    if (!analysis?.enabled) throw new Error('Route analysis is not enabled.');
    if (!mapImagePath) throw new Error('No bundled map image is available for this world package.');
    if (!packagePath) throw new Error('No .world package path is available.');

    const sharp = require('sharp');
    const base = sharp(mapImagePath);
    const metadata = await base.metadata();
    const width = Math.max(1, Number(metadata.width || analysis.grid?.width || 1));
    const height = Math.max(1, Number(metadata.height || analysis.grid?.height || 1));
    const overlay = buildOverlaySvg({ analysis, width, height });
    const debugDir = path.join(packagePath, 'debug_routes');
    await fs.mkdir(debugDir, { recursive: true });

    const requestedBase = requestedFileName
        ? sanitizeFilePart(path.basename(requestedFileName, path.extname(requestedFileName)), 'route_debug')
        : `${sanitizeFilePart(analysis.request?.start?.label, 'start')}_to_${sanitizeFilePart(analysis.request?.end?.label, 'end')}_${timestampForFile()}`;
    const outputPath = path.join(debugDir, `${requestedBase}.png`);

    await sharp(mapImagePath)
        .composite([{ input: overlay, top: 0, left: 0 }])
        .png()
        .toFile(outputPath);

    return {
        path: outputPath,
        file: path.basename(outputPath),
        relativePath: path.relative(packagePath, outputPath).replace(/\\/g, '/')
    };
}

module.exports = {
    writeRouteDebugImage
};
