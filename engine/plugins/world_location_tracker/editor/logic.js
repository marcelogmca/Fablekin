// engine/plugins/world_location_tracker/editor/logic.js

import { toNumber, randomUid, normalizePointPair, normalizeHexColor, pointInPolygon, polygonArea } from './utils.js';
import { AREA_COLORS, DEFAULT_BIOMES, DEFAULT_BIOME_MASK_FILE } from './state.js';

export function normalizeLocalNode(node, index) {
    const input = node && typeof node === 'object' ? node : {};
    return {
        uid: typeof input.uid === 'string' && input.uid.trim() ? input.uid.trim() : `node-${index + 1}-${randomUid()}`,
        world_x: toNumber(input.world_x !== undefined ? input.world_x : input.x, 0),
        world_y: toNumber(input.world_y !== undefined ? input.world_y : input.y, 0),
        name: typeof input.name === 'string' ? input.name : '',
        type: typeof input.type === 'string' ? input.type : '',
        region: typeof input.region === 'string' ? input.region : '',
        parent_nation: typeof input.parent_nation === 'string' ? input.parent_nation : '',
        description: typeof input.description === 'string' ? input.description : '',
        tags: typeof input.tags === 'string' ? input.tags : ''
    };
}

export function normalizeLocalArea(area, index) {
    const input = area && typeof area === 'object' ? area : {};
    const geometry = input.geometry && typeof input.geometry === 'object' ? input.geometry : {};
    const rawPoints = Array.isArray(geometry.points) ? geometry.points : (Array.isArray(input.points) ? input.points : []);
    const points = rawPoints.map(normalizePointPair).filter(Boolean);
    return {
        uid: typeof input.uid === 'string' && input.uid.trim() ? input.uid.trim() : `area-${index + 1}-${randomUid()}`,
        name: typeof input.name === 'string' ? input.name : '',
        kind: typeof input.kind === 'string' ? input.kind : 'region',
        parent_uid: typeof input.parent_uid === 'string' && input.parent_uid.trim() ? input.parent_uid.trim() : null,
        color: normalizeHexColor(input.color, AREA_COLORS[index % AREA_COLORS.length]),
        tags: typeof input.tags === 'string' ? input.tags : '',
        description: typeof input.description === 'string' ? input.description : '',
        geometry: { type: 'polygon', points }
    };
}

export function slugifyBiomeId(value, fallback = 'biome') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return slug || fallback;
}

export function normalizeLocalBiomeEntry(entry, index) {
    const input = entry && typeof entry === 'object' ? entry : {};
    const fallback = DEFAULT_BIOMES[index % DEFAULT_BIOMES.length] || DEFAULT_BIOMES[0];
    const label = String(input.label || fallback.label || `Biome ${index + 1}`).trim();
    const id = slugifyBiomeId(input.id || label || fallback.id, `biome_${index + 1}`);
    const inferredFlags = inferBiomeAttributeDefaults(id, label);
    return {
        id,
        label,
        color: normalizeHexColor(input.color, fallback.color),
        needs_boat: typeof input.needs_boat === 'boolean' ? input.needs_boat : inferredFlags.needs_boat,
        slows_down: typeof input.slows_down === 'boolean' ? input.slows_down : inferredFlags.slows_down,
        is_road: typeof input.is_road === 'boolean' ? input.is_road : inferredFlags.is_road,
        is_river: typeof input.is_river === 'boolean' ? input.is_river : inferredFlags.is_river
    };
}

export function inferBiomeAttributeDefaults(id, label) {
    const key = `${id || ''} ${label || ''}`.toLowerCase();
    return {
        needs_boat: /\b(sea|ocean)\b/.test(key),
        slows_down: /\b(mountain|mountains|rainforest)\b/.test(key),
        is_road: /\b(road|trail|path|highway)\b/.test(key),
        is_river: /\b(river|stream|creek|brook)\b/.test(key)
    };
}

export function normalizeLocalBiomes(biomes = {}) {
    const input = biomes && typeof biomes === 'object' ? biomes : {};
    const rawMaskFile = String(input.mask_file || DEFAULT_BIOME_MASK_FILE).split(/[\\/]/).pop() || DEFAULT_BIOME_MASK_FILE;
    const paletteSource = Array.isArray(input.palette) ? input.palette : DEFAULT_BIOMES;
    return {
        mask_file: rawMaskFile.toLowerCase().endsWith('.png') ? rawMaskFile : DEFAULT_BIOME_MASK_FILE,
        mask_width: Math.max(0, Math.round(toNumber(input.mask_width, 0))),
        mask_height: Math.max(0, Math.round(toNumber(input.mask_height, 0))),
        palette: paletteSource.map(normalizeLocalBiomeEntry)
    };
}

export function getBiomeMaskDimensions(imageDimensions, maxSide = 1024) {
    const width = Math.max(0, Math.round(toNumber(imageDimensions?.width, 0)));
    const height = Math.max(0, Math.round(toNumber(imageDimensions?.height, 0)));
    if (width <= 0 || height <= 0) return { width: 0, height: 0 };
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

export function normalizeLocalWorldData(worldData) {
    const input = worldData && typeof worldData === 'object' ? worldData : {};
    const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
    return {
        ...input,
        meta: { image_file: '', origin_pixel_x: 0, origin_pixel_y: 0, scale_factor: 1.0, pixels_per_km: 7.0, base_walk_speed_kmpd: 30.0, winding_factor: 1.2, ...meta },
        nodes: Array.isArray(input.nodes) ? input.nodes.map(normalizeLocalNode) : [],
        areas: Array.isArray(input.areas) ? input.areas.map(normalizeLocalArea) : [],
        biomes: normalizeLocalBiomes(input.biomes)
    };
}

export function getAreaDepth(area, areaMap) {
    let depth = 0; let current = area; const seen = new Set();
    while (current && current.parent_uid && !seen.has(current.parent_uid)) {
        seen.add(current.parent_uid); const parent = areaMap.get(current.parent_uid);
        if (!parent) break; depth++; current = parent;
    }
    return depth;
}

export function getAreaHierarchy(area, areaMap) {
    const hierarchy = []; let current = area; const seen = new Set();
    while (current && !seen.has(current.uid)) {
        hierarchy.unshift(current); seen.add(current.uid);
        current = current.parent_uid ? areaMap.get(current.parent_uid) : null;
    }
    return hierarchy;
}

export function resolveAreaContext(x, y, areas) {
    const areaMap = new Map(areas.map(a => [a.uid, a]));
    const containing = areas.filter(area => {
        const points = area.geometry?.points || [];
        return points.length >= 3 && pointInPolygon(x, y, points);
    });
    containing.sort((a, b) => (getAreaDepth(b, areaMap) - getAreaDepth(a, areaMap)) || (polygonArea(a.geometry.points) - polygonArea(b.geometry.points)));
    const primary = containing[0] || null;
    return { primaryArea: primary, hierarchy: primary ? getAreaHierarchy(primary, areaMap) : [], containingAreas: containing };
}
