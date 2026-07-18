const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const distanceUnits = require('./distance_units.js');

const GENERATOR_VERSION = 3;
const CACHE_FILE = 'biome_nav_grid.json';
const DEFAULT_MAX_GRID_SIDE = 256;
const MIN_PAINTED_COVERAGE = 0.25;
const AUTO_FILL_PAINTED_COVERAGE = 0.8;
const MIN_FEATURE_COVERAGE = 0.02;
const SLOW_MULTIPLIER = 1.6;
const ROAD_MULTIPLIER = 0.6;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function colorToKey(r, g, b) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toLowerCase();
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function hashFile(filePath) {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashValue(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizePalette(worldData) {
    return (worldData?.biomes?.palette || []).map((entry) => ({
        id: String(entry.id || '').trim(),
        label: String(entry.label || entry.id || '').trim(),
        color: String(entry.color || '').trim().toLowerCase(),
        needs_boat: !!entry.needs_boat,
        slows_down: !!entry.slows_down,
        is_road: !!entry.is_road,
        is_river: !!entry.is_river
    })).filter(entry => entry.id && /^#[0-9a-f]{6}$/.test(entry.color));
}

function getGridDimensions(imageWidth, imageHeight, maxSide = DEFAULT_MAX_GRID_SIDE) {
    const width = Math.max(1, Math.round(toNumber(imageWidth, 0)));
    const height = Math.max(1, Math.round(toNumber(imageHeight, 0)));
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function makeCell() {
    return {
        total: 0,
        unknown: 0,
        counts: Object.create(null),
        preserved: new Set()
    };
}

function cellIndex(x, y, width) {
    return y * width + x;
}

function sourceToCell(x, y, sourceWidth, sourceHeight, gridWidth, gridHeight) {
    return {
        x: clamp(Math.floor((x / sourceWidth) * gridWidth), 0, gridWidth - 1),
        y: clamp(Math.floor((y / sourceHeight) * gridHeight), 0, gridHeight - 1)
    };
}

function cellCenterToWorld(cellX, cellY, grid, dimensions) {
    const imageX = ((cellX + 0.5) / grid.width) * dimensions.width;
    const imageY = ((cellY + 0.5) / grid.height) * dimensions.height;
    return { x: imageX, y: -imageY };
}

function worldToCell(x, y, grid, dimensions) {
    const imageX = clamp(toNumber(x, 0), 0, Math.max(0, dimensions.width));
    const imageY = clamp(-toNumber(y, 0), 0, Math.max(0, dimensions.height));
    return {
        x: clamp(Math.floor((imageX / Math.max(1, dimensions.width)) * grid.width), 0, grid.width - 1),
        y: clamp(Math.floor((imageY / Math.max(1, dimensions.height)) * grid.height), 0, grid.height - 1)
    };
}

function readBiomeIdAt(data, offset, colorToBiome) {
    const alpha = data[offset + 3];
    if (alpha < 16) return null;
    return colorToBiome.get(colorToKey(data[offset], data[offset + 1], data[offset + 2])) || null;
}

function scanConnectedComponents(pixelBiomeIds, sourceWidth, sourceHeight, gridWidth, gridHeight) {
    const visited = new Uint8Array(pixelBiomeIds.length);
    const components = [];
    const queue = [];

    for (let start = 0; start < pixelBiomeIds.length; start += 1) {
        const biomeId = pixelBiomeIds[start];
        if (!biomeId || visited[start]) continue;

        let head = 0;
        let pixels = 0;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        const touchedCells = new Set();

        visited[start] = 1;
        queue.length = 0;
        queue.push(start);

        while (head < queue.length) {
            const current = queue[head++];
            const x = current % sourceWidth;
            const y = Math.floor(current / sourceWidth);
            pixels += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);

            const cell = sourceToCell(x, y, sourceWidth, sourceHeight, gridWidth, gridHeight);
            touchedCells.add(`${cell.x},${cell.y}`);

            const neighbors = [
                current - 1,
                current + 1,
                current - sourceWidth,
                current + sourceWidth
            ];

            for (const next of neighbors) {
                if (next < 0 || next >= pixelBiomeIds.length || visited[next]) continue;
                if ((next === current - 1 && x === 0) || (next === current + 1 && x === sourceWidth - 1)) continue;
                if (pixelBiomeIds[next] !== biomeId) continue;
                visited[next] = 1;
                queue.push(next);
            }
        }

        const boxWidth = Math.max(1, maxX - minX + 1);
        const boxHeight = Math.max(1, maxY - minY + 1);
        const aspect = Math.max(boxWidth, boxHeight) / Math.max(1, Math.min(boxWidth, boxHeight));
        const density = pixels / Math.max(1, boxWidth * boxHeight);

        components.push({
            biomeId,
            pixels,
            minX,
            minY,
            maxX,
            maxY,
            aspect,
            density,
            touchedCells
        });
    }

    return components;
}

function preserveComponentFeatures(components, cells, sourceWidth, sourceHeight, gridWidth, gridHeight) {
    for (const component of components) {
        let survives = false;
        for (const key of component.touchedCells) {
            const [x, y] = key.split(',').map(Number);
            const cell = cells[cellIndex(x, y, gridWidth)];
            const coverage = (cell.counts[component.biomeId] || 0) / Math.max(1, cell.total);
            if (coverage >= MIN_FEATURE_COVERAGE) {
                survives = true;
                break;
            }
        }

        const longThin = component.touchedCells.size >= 3 && (component.aspect >= 4 || component.density <= 0.35);
        if (longThin) {
            for (const key of component.touchedCells) {
                const [x, y] = key.split(',').map(Number);
                cells[cellIndex(x, y, gridWidth)].preserved.add(component.biomeId);
            }
        } else if (!survives && component.touchedCells.size > 0) {
            const centerX = (component.minX + component.maxX) / 2;
            const centerY = (component.minY + component.maxY) / 2;
            const centerCell = sourceToCell(centerX, centerY, sourceWidth, sourceHeight, gridWidth, gridHeight);
            let best = null;
            for (const key of component.touchedCells) {
                const [x, y] = key.split(',').map(Number);
                const dx = x - centerCell.x;
                const dy = y - centerCell.y;
                const dist = (dx * dx) + (dy * dy);
                if (!best || dist < best.dist) best = { x, y, dist };
            }
            if (best) cells[cellIndex(best.x, best.y, gridWidth)].preserved.add(component.biomeId);
        }
    }
}

function dominantBiomeId(cell) {
    let best = null;
    let bestCount = 0;
    for (const [biomeId, count] of Object.entries(cell.counts || {})) {
        if (count > bestCount) {
            best = biomeId;
            bestCount = count;
        }
    }
    return best;
}

function findNearestDominantBiome(cells, cellX, cellY, gridWidth, gridHeight) {
    const own = dominantBiomeId(cells[cellIndex(cellX, cellY, gridWidth)]);
    if (own) return own;

    const maxRadius = Math.max(gridWidth, gridHeight);
    for (let radius = 1; radius <= maxRadius; radius += 1) {
        const counts = Object.create(null);
        for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const x = cellX + dx;
                const y = cellY + dy;
                if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;
                const biomeId = dominantBiomeId(cells[cellIndex(x, y, gridWidth)]);
                if (biomeId) counts[biomeId] = (counts[biomeId] || 0) + 1;
            }
        }

        let best = null;
        let bestCount = 0;
        for (const [biomeId, count] of Object.entries(counts)) {
            if (count > bestCount) {
                best = biomeId;
                bestCount = count;
            }
        }
        if (best) return best;
    }

    return null;
}

function autoFillUnknownCells(cells, gridWidth, gridHeight) {
    let filledPixels = 0;
    let filledCells = 0;

    for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
            const cell = cells[cellIndex(x, y, gridWidth)];
            if (!cell || cell.unknown <= 0) continue;
            const fillBiome = findNearestDominantBiome(cells, x, y, gridWidth, gridHeight);
            if (!fillBiome) continue;
            cell.counts[fillBiome] = (cell.counts[fillBiome] || 0) + cell.unknown;
            filledPixels += cell.unknown;
            filledCells += 1;
            cell.unknown = 0;
        }
    }

    return { filledPixels, filledCells };
}

function finalizeCells(cells, paletteById, gridWidth, gridHeight) {
    return cells.map((cell, index) => {
        const coverage = {};
        let primary = null;
        let primaryCount = 0;

        for (const [biomeId, count] of Object.entries(cell.counts)) {
            if (count > primaryCount) {
                primary = biomeId;
                primaryCount = count;
            }
            const ratio = count / Math.max(1, cell.total);
            if (ratio >= MIN_FEATURE_COVERAGE) coverage[biomeId] = Number(ratio.toFixed(4));
        }

        const features = new Set(cell.preserved);
        for (const biomeId of Object.keys(coverage)) {
            if (biomeId !== primary) features.add(biomeId);
        }

        const allBiomeIds = new Set(primary ? [primary] : []);
        features.forEach(id => allBiomeIds.add(id));
        const flags = Array.from(allBiomeIds).reduce((acc, biomeId) => {
            const biome = paletteById.get(biomeId);
            if (biome?.needs_boat) acc.needs_boat = true;
            if (biome?.slows_down) acc.slows_down = true;
            if (biome?.is_road) acc.is_road = true;
            if (biome?.is_river) acc.is_river = true;
            return acc;
        }, { needs_boat: false, slows_down: false, is_road: false, is_river: false });

        return {
            x: index % gridWidth,
            y: Math.floor(index / gridWidth),
            primary,
            coverage,
            features: Array.from(features).sort(),
            needs_boat: flags.needs_boat,
            slows_down: flags.slows_down,
            is_road: flags.is_road,
            is_river: flags.is_river,
            unknown_ratio: Number((cell.unknown / Math.max(1, cell.total)).toFixed(4))
        };
    });
}

function compactCell(cell) {
    const flags = (cell.needs_boat ? 1 : 0)
        | (cell.slows_down ? 2 : 0)
        | (cell.is_road ? 4 : 0)
        | (cell.is_river ? 8 : 0);
    return [
        cell.primary || null,
        flags,
        Math.round(Number(cell.unknown_ratio || 0) * 10000),
        Object.keys(cell.coverage || {}).length ? cell.coverage : null,
        Array.isArray(cell.features) && cell.features.length ? cell.features : null
    ];
}

function expandCell(encoded, index, gridWidth) {
    if (!Array.isArray(encoded)) return encoded;
    const flags = Number(encoded[1] || 0);
    return {
        x: index % gridWidth,
        y: Math.floor(index / gridWidth),
        primary: encoded[0] || null,
        coverage: encoded[3] || {},
        features: encoded[4] || [],
        needs_boat: !!(flags & 1),
        slows_down: !!(flags & 2),
        is_road: !!(flags & 4),
        is_river: !!(flags & 8),
        unknown_ratio: Number(((Number(encoded[2] || 0)) / 10000).toFixed(4))
    };
}

function compactCache(cache) {
    return {
        ...cache,
        grid: {
            ...cache.grid,
            encoding: 'compact-v2',
            cells: cache.grid.cells.map(compactCell)
        }
    };
}

function expandCache(cache) {
    if (cache?.grid?.encoding !== 'compact-v2') return cache;
    return {
        ...cache,
        grid: {
            ...cache.grid,
            cells: cache.grid.cells.map((cell, index) => expandCell(cell, index, cache.grid.width))
        }
    };
}

async function generateNavigationGrid({ worldData, packagePath, biomeMaskPath, maxGridSide = DEFAULT_MAX_GRID_SIDE }) {
    if (!packagePath || !biomeMaskPath) {
        return { enabled: false, reason: 'No .world package biome mask is available.' };
    }

    const sharp = require('sharp');
    const image = sharp(biomeMaskPath).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const sourceWidth = info.width;
    const sourceHeight = info.height;
    const dimensions = {
        width: Math.max(1, Math.round(toNumber(worldData?.meta?.dimensions?.width, sourceWidth))),
        height: Math.max(1, Math.round(toNumber(worldData?.meta?.dimensions?.height, sourceHeight)))
    };
    const gridSize = getGridDimensions(dimensions.width, dimensions.height, maxGridSide);
    const palette = normalizePalette(worldData);
    const paletteById = new Map(palette.map(entry => [entry.id, entry]));
    const colorToBiome = new Map(palette.map(entry => [entry.color, entry.id]));
    const cells = Array.from({ length: gridSize.width * gridSize.height }, makeCell);
    const pixelBiomeIds = new Array(sourceWidth * sourceHeight);
    let paintedPixels = 0;
    let recognizedPixels = 0;

    for (let y = 0; y < sourceHeight; y += 1) {
        for (let x = 0; x < sourceWidth; x += 1) {
            const pixelIndex = y * sourceWidth + x;
            const offset = pixelIndex * 4;
            const alpha = data[offset + 3];
            const targetCell = sourceToCell(x, y, sourceWidth, sourceHeight, gridSize.width, gridSize.height);
            const cell = cells[cellIndex(targetCell.x, targetCell.y, gridSize.width)];
            cell.total += 1;

            if (alpha < 16) {
                cell.unknown += 1;
                continue;
            }

            paintedPixels += 1;
            const biomeId = readBiomeIdAt(data, offset, colorToBiome);
            if (!biomeId) {
                cell.unknown += 1;
                continue;
            }

            recognizedPixels += 1;
            pixelBiomeIds[pixelIndex] = biomeId;
            cell.counts[biomeId] = (cell.counts[biomeId] || 0) + 1;
        }
    }

    const paintedCoverage = paintedPixels / Math.max(1, sourceWidth * sourceHeight);
    const recognizedCoverage = recognizedPixels / Math.max(1, sourceWidth * sourceHeight);
    const components = scanConnectedComponents(pixelBiomeIds, sourceWidth, sourceHeight, gridSize.width, gridSize.height);
    const autoFill = paintedCoverage >= AUTO_FILL_PAINTED_COVERAGE
        ? autoFillUnknownCells(cells, gridSize.width, gridSize.height)
        : { filledPixels: 0, filledCells: 0 };
    preserveComponentFeatures(components, cells, sourceWidth, sourceHeight, gridSize.width, gridSize.height);

    const maskHash = await hashFile(biomeMaskPath);
    const paletteHash = hashValue(palette);
    const cache = {
        version: GENERATOR_VERSION,
        generated_at: new Date().toISOString(),
        source: {
            mask_file: path.basename(biomeMaskPath),
            mask_hash: maskHash,
            palette_hash: paletteHash,
            world_dimensions: dimensions,
            source_mask_dimensions: { width: sourceWidth, height: sourceHeight }
        },
        coverage: {
            painted: Number(paintedCoverage.toFixed(4)),
            recognized: Number(recognizedCoverage.toFixed(4)),
            enabled: paintedCoverage >= MIN_PAINTED_COVERAGE,
            auto_fill_unpainted: paintedCoverage >= AUTO_FILL_PAINTED_COVERAGE,
            auto_filled_cells: autoFill.filledCells
        },
        grid: {
            width: gridSize.width,
            height: gridSize.height,
            max_side: maxGridSide,
            cells: finalizeCells(cells, paletteById, gridSize.width, gridSize.height)
        },
        palette,
        component_summary: {
            total: components.length,
            preserved_long_thin: components.filter(c => c.touchedCells.size >= 3 && (c.aspect >= 4 || c.density <= 0.35)).length
        }
    };

    const cachePath = path.join(packagePath, CACHE_FILE);
    await fs.writeFile(cachePath, JSON.stringify(compactCache(cache)), 'utf8');
    return { enabled: cache.coverage.enabled, cache, cachePath };
}

async function loadOrCreateNavigationGrid({ worldData, packagePath, biomeMaskPath, forceRebuild = false, maxGridSide = DEFAULT_MAX_GRID_SIDE }) {
    if (!packagePath || !biomeMaskPath) {
        return { enabled: false, reason: 'No .world package biome mask is available.' };
    }

    const cachePath = path.join(packagePath, CACHE_FILE);
    const palette = normalizePalette(worldData);
    const expected = {
        version: GENERATOR_VERSION,
        maskHash: await hashFile(biomeMaskPath),
        paletteHash: hashValue(palette),
        dimensions: {
            width: Math.max(1, Math.round(toNumber(worldData?.meta?.dimensions?.width, 0))),
            height: Math.max(1, Math.round(toNumber(worldData?.meta?.dimensions?.height, 0)))
        }
    };

    if (!forceRebuild) {
        try {
            const cache = expandCache(JSON.parse(await fs.readFile(cachePath, 'utf8')));
            const source = cache?.source || {};
            if (
                cache.version === expected.version
                && source.mask_hash === expected.maskHash
                && source.palette_hash === expected.paletteHash
                && Number(source.world_dimensions?.width) === expected.dimensions.width
                && Number(source.world_dimensions?.height) === expected.dimensions.height
            ) {
                return { enabled: !!cache.coverage?.enabled, cache, cachePath, fromCache: true };
            }
        } catch {
            // Missing or invalid cache; rebuild below.
        }
    }

    return generateNavigationGrid({ worldData, packagePath, biomeMaskPath, maxGridSide });
}

class MinHeap {
    constructor() {
        this.items = [];
    }

    push(item) {
        this.items.push(item);
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (this.items.length === 0) return null;
        const top = this.items[0];
        const end = this.items.pop();
        if (this.items.length > 0) {
            this.items[0] = end;
            this.sinkDown(0);
        }
        return top;
    }

    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.items[parent].priority <= this.items[index].priority) break;
            [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
            index = parent;
        }
    }

    sinkDown(index) {
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
            if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
            if (smallest === index) break;
            [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
            index = smallest;
        }
    }
}

function heuristic(a, b, cellKmX, cellKmY) {
    const dx = Math.abs(a.x - b.x) * cellKmX;
    const dy = Math.abs(a.y - b.y) * cellKmY;
    return Math.sqrt((dx * dx) + (dy * dy));
}

function getCell(cache, x, y) {
    if (x < 0 || y < 0 || x >= cache.grid.width || y >= cache.grid.height) return null;
    return cache.grid.cells[cellIndex(x, y, cache.grid.width)] || null;
}

function lookupBiomeAtCoordinates(cache, worldData, x, y) {
    if (!cache?.coverage?.enabled || !cache?.grid?.width || !cache?.grid?.height) return null;

    const dimensions = cache.source?.world_dimensions || worldData?.meta?.dimensions || {};
    const width = toNumber(dimensions.width, 0);
    const height = toNumber(dimensions.height, 0);
    const worldX = Number(x);
    const worldY = Number(y);
    if (
        width <= 0 || height <= 0
        || !Number.isFinite(worldX) || !Number.isFinite(worldY)
        || worldX < 0 || worldX > width
        || worldY > 0 || worldY < -height
    ) {
        return null;
    }

    const cellPoint = worldToCell(worldX, worldY, cache.grid, { width, height });
    const cell = getCell(cache, cellPoint.x, cellPoint.y);
    if (!cell?.primary) return null;

    const palette = Array.isArray(cache.palette) && cache.palette.length
        ? cache.palette
        : normalizePalette(worldData);
    const paletteById = new Map(palette.map(entry => [entry.id, entry]));
    const primary = paletteById.get(cell.primary);
    if (!primary) return null;

    return {
        id: primary.id,
        label: primary.label || primary.id,
        features: (cell.features || []).map(id => {
            const feature = paletteById.get(id);
            return { id, label: feature?.label || id };
        }),
        needs_boat: !!cell.needs_boat,
        slows_down: !!cell.slows_down,
        is_road: !!cell.is_road,
        is_river: !!cell.is_river,
        unknown_ratio: Number(cell.unknown_ratio || 0)
    };
}

function inspectStraightCorridor(cache, worldData, start, end) {
    if (!cache?.coverage?.enabled || !cache?.grid?.width || !cache?.grid?.height) {
        return { available: false, reason: 'Biome navigation grid is unavailable.' };
    }

    const dimensions = cache.source?.world_dimensions || worldData?.meta?.dimensions || {};
    const width = Math.max(1, toNumber(dimensions.width, 0));
    const height = Math.max(1, toNumber(dimensions.height, 0));
    const startCell = worldToCell(start?.x, start?.y, cache.grid, { width, height });
    const endCell = worldToCell(end?.x, end?.y, cache.grid, { width, height });
    const pathCells = straightLinePathCells(cache, startCell, endCell);
    const paletteById = new Map(normalizePalette(worldData).map(entry => [entry.id, entry]));
    const runs = [];

    for (const point of pathCells) {
        const biomeId = point.cell?.primary || null;
        const label = paletteById.get(biomeId)?.label || biomeId || 'unknown terrain';
        const previous = runs[runs.length - 1];
        if (previous?.id === biomeId) {
            previous.cells += 1;
        } else {
            runs.push({ id: biomeId, label, cells: 1 });
        }
    }

    const dx = toNumber(end?.x, 0) - toNumber(start?.x, 0);
    const dy = toNumber(end?.y, 0) - toNumber(start?.y, 0);
    const pixelDistance = Math.sqrt((dx * dx) + (dy * dy));
    const corridorPoints = pathToWorldPoints(pathCells, cache).map(point => ({ x: point.x, y: point.y }));

    return {
        available: true,
        same_cell: startCell.x === endCell.x && startCell.y === endCell.y,
        map_span_ratio: pixelDistance / Math.max(width, height),
        cell_count: pathCells.length,
        needs_boat: pathCells.some(point => point.cell?.needs_boat),
        slows_down: pathCells.some(point => point.cell?.slows_down),
        has_river: pathCells.some(point => point.cell?.is_river),
        has_road: pathCells.some(point => point.cell?.is_road),
        uncertain: pathCells.some(point => !point.cell?.primary || Number(point.cell?.unknown_ratio || 0) >= 0.5),
        runs,
        corridor: corridorPoints
    };
}

function pointInCellWindow(point, window) {
    if (!window) return true;
    return point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY;
}

function routeCellCost(cell, mode, poiScores, key) {
    if (!cell) return Number.POSITIVE_INFINITY;
    if (mode === 'avoid_boat' && cell.needs_boat) return Number.POSITIVE_INFINITY;

    let cost = 1;
    if (cell.slows_down) cost *= mode === 'avoid_slow' ? SLOW_MULTIPLIER * 2.5 : SLOW_MULTIPLIER;
    if (cell.is_road) cost *= mode === 'road_favored' ? Math.min(ROAD_MULTIPLIER, 0.45) : ROAD_MULTIPLIER;
    if (cell.needs_boat) cost *= mode === 'mixed' ? 1.25 : 1.05;
    if (cell.unknown_ratio >= 0.5) cost *= 1.15;
    if (mode === 'poi_rich') cost *= Math.max(0.5, 1 - ((poiScores.get(key) || 0) * 1.6));
    return cost;
}

function buildPoiScores(nodes, cache, dimensions, scale) {
    const scores = new Map();
    const cellKm = Math.max(dimensions.width / cache.grid.width, dimensions.height / cache.grid.height) / Math.max(1, scale.pixelsPerKm);
    const radiusCells = Math.max(2, Math.ceil(20 / Math.max(1, cellKm)));

    for (const node of nodes || []) {
        const cell = worldToCell(node.world_x ?? node.x, node.world_y ?? node.y, cache.grid, dimensions);
        for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
            for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
                const dist = Math.sqrt((dx * dx) + (dy * dy));
                if (dist > radiusCells) continue;
                const x = cell.x + dx;
                const y = cell.y + dy;
                if (!getCell(cache, x, y)) continue;
                const key = `${x},${y}`;
                scores.set(key, Math.max(scores.get(key) || 0, 0.25 * (1 - (dist / radiusCells))));
            }
        }
    }
    return scores;
}

function astar(cache, startCell, endCell, options) {
    const width = cache.grid.width;
    const height = cache.grid.height;
    const dimensions = cache.source.world_dimensions;
    const scale = options.scale;
    const cellKmX = (dimensions.width / width) / Math.max(1, scale.pixelsPerKm);
    const cellKmY = (dimensions.height / height) / Math.max(1, scale.pixelsPerKm);
    const mode = options.mode || 'mixed';
    const poiScores = options.poiScores || new Map();
    const searchWindow = options.window || null;
    const open = new MinHeap();
    const startKey = `${startCell.x},${startCell.y}`;
    const endKey = `${endCell.x},${endCell.y}`;
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const dirs = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1]
    ];

    open.push({ key: startKey, x: startCell.x, y: startCell.y, priority: 0 });

    while (open.items.length > 0) {
        const current = open.pop();
        if (current.key === endKey) {
            const pathCells = [];
            let key = current.key;
            while (key) {
                const [x, y] = key.split(',').map(Number);
                pathCells.unshift({ x, y, cell: getCell(cache, x, y) });
                key = cameFrom.get(key);
            }
            return pathCells;
        }

        const currentScore = gScore.get(current.key) || 0;
        for (const [dx, dy] of dirs) {
            const nx = current.x + dx;
            const ny = current.y + dy;
            if (!pointInCellWindow({ x: nx, y: ny }, searchWindow)) continue;
            const neighbor = getCell(cache, nx, ny);
            if (!neighbor) continue;
            const neighborKey = `${nx},${ny}`;
            const stepDistance = Math.sqrt(((dx * cellKmX) ** 2) + ((dy * cellKmY) ** 2));
            const stepCost = stepDistance * routeCellCost(neighbor, mode, poiScores, neighborKey);
            if (!Number.isFinite(stepCost)) continue;
            const tentative = currentScore + stepCost;
            if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) continue;
            cameFrom.set(neighborKey, current.key);
            gScore.set(neighborKey, tentative);
            open.push({
                key: neighborKey,
                x: nx,
                y: ny,
                priority: tentative + heuristic({ x: nx, y: ny }, endCell, cellKmX, cellKmY)
            });
        }
    }

    return null;
}

function straightLinePathCells(cache, startCell, endCell) {
    const dx = endCell.x - startCell.x;
    const dy = endCell.y - startCell.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const pathCells = [];
    let previousKey = '';

    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = clamp(Math.round(startCell.x + (dx * t)), 0, cache.grid.width - 1);
        const y = clamp(Math.round(startCell.y + (dy * t)), 0, cache.grid.height - 1);
        const key = `${x},${y}`;
        if (key === previousKey) continue;
        previousKey = key;
        pathCells.push({ x, y, cell: getCell(cache, x, y) });
    }

    return pathCells;
}

function concatenatePathSegments(segments) {
    const combined = [];
    for (const segment of segments || []) {
        if (!Array.isArray(segment) || segment.length === 0) continue;
        if (combined.length === 0) {
            combined.push(...segment);
            continue;
        }
        combined.push(...segment.slice(1));
    }
    return combined;
}

function directionBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const directions = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    return directions[Math.round(((angle + 360) % 360) / 45) % 8];
}

function distanceKm(a, b, scale) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt((dx * dx) + (dy * dy)) / Math.max(1, scale.pixelsPerKm);
}

function pathToWorldPoints(pathCells, cache) {
    const dimensions = cache.source.world_dimensions;
    return pathCells.map(({ x, y, cell }) => ({
        ...cellCenterToWorld(x, y, cache.grid, dimensions),
        grid_x: x,
        grid_y: y,
        cell
    }));
}

function pointToSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.sqrt(((point.x - a.x) ** 2) + ((point.y - a.y) ** 2));
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / ((dx * dx) + (dy * dy)), 0, 1);
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    return Math.sqrt(((point.x - px) ** 2) + ((point.y - py) ** 2));
}

function nearbyNodesForPoints(points, nodes, scale, limit = 6) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const corridorPixels = Math.max(20, 12 * Math.max(1, scale.pixelsPerKm));
    const results = [];
    for (const node of nodes || []) {
        const point = { x: Number(node.world_x ?? node.x ?? 0), y: Number(node.world_y ?? node.y ?? 0) };
        let best = Number.POSITIVE_INFINITY;
        let bestSegmentIndex = 0;
        for (let i = 1; i < points.length; i += 1) {
            const distance = pointToSegmentDistance(point, points[i - 1], points[i]);
            if (distance < best) {
                best = distance;
                bestSegmentIndex = i - 1;
            }
        }
        if (best <= corridorPixels) {
            results.push({
                name: node.name || 'Untitled Location',
                type: node.type || 'POI',
                x: point.x,
                y: point.y,
                distanceKm: Math.round(best / Math.max(1, scale.pixelsPerKm)),
                segmentIndex: bestSegmentIndex
            });
        }
    }
    return results.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name)).slice(0, limit);
}

function stopCandidatesNearLine(nodes, start, end, scale, limit = 3) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared <= 0) return [];

    const corridorPixels = Math.max(30, 20 * Math.max(1, scale.pixelsPerKm));
    const candidates = [];

    for (const node of nodes || []) {
        const x = Number(node.world_x ?? node.x ?? Number.NaN);
        const y = Number(node.world_y ?? node.y ?? Number.NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const projection = ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared;
        if (projection <= 0.08 || projection >= 0.92) continue;

        const projectedPoint = {
            x: start.x + (dx * projection),
            y: start.y + (dy * projection)
        };
        const offsetPixels = Math.sqrt(((x - projectedPoint.x) ** 2) + ((y - projectedPoint.y) ** 2));
        if (offsetPixels > corridorPixels) continue;

        candidates.push({
            node,
            x,
            y,
            projection,
            offsetKm: Math.round(offsetPixels / Math.max(1, scale.pixelsPerKm)),
            name: node.name || 'Untitled Location',
            type: node.type || 'POI'
        });
    }

    return candidates
        .sort((a, b) => a.projection - b.projection || a.offsetKm - b.offsetKm || a.name.localeCompare(b.name))
        .slice(0, limit);
}

function nodeToRoutePoint(node) {
    const x = Number(node?.world_x ?? node?.x ?? Number.NaN);
    const y = Number(node?.world_y ?? node?.y ?? Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
        node,
        x,
        y,
        name: node.name || 'Untitled Location',
        type: node.type || 'POI'
    };
}

function directDistanceKm(a, b, scale) {
    return distanceKm(a, b, scale);
}

function maxStopLegKm(points, scale) {
    let maxLeg = 0;
    for (let index = 1; index < points.length; index += 1) {
        maxLeg = Math.max(maxLeg, directDistanceKm(points[index - 1], points[index], scale));
    }
    return Math.round(maxLeg);
}

function pathCellsDistanceKm(pathCells, cache, scale) {
    const points = pathToWorldPoints(pathCells || [], cache);
    return points.reduce((sum, point, index) => index === 0 ? 0 : sum + distanceKm(points[index - 1], point, scale), 0);
}

function pathCellsGridDistanceKm(pathCells, cache, scale) {
    const dimensions = cache.source.world_dimensions;
    const cellKmX = (dimensions.width / cache.grid.width) / Math.max(1, scale.pixelsPerKm);
    const cellKmY = (dimensions.height / cache.grid.height) / Math.max(1, scale.pixelsPerKm);
    return (pathCells || []).reduce((sum, point, index) => {
        if (index === 0) return 0;
        const previous = pathCells[index - 1];
        const dx = Math.abs(point.x - previous.x);
        const dy = Math.abs(point.y - previous.y);
        return sum + Math.sqrt(((dx * cellKmX) ** 2) + ((dy * cellKmY) ** 2));
    }, 0);
}

function runGridBounds(run) {
    const points = (run?.gridPoints || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length === 0) return null;
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y)
    }), { minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y });
}

function expandCellWindow(bounds, margin, grid) {
    if (!bounds) return null;
    return {
        minX: clamp(bounds.minX - margin, 0, grid.width - 1),
        maxX: clamp(bounds.maxX + margin, 0, grid.width - 1),
        minY: clamp(bounds.minY - margin, 0, grid.height - 1),
        maxY: clamp(bounds.maxY + margin, 0, grid.height - 1)
    };
}

function stopMatchesNearbyPoi(stop, poi) {
    if (!stop || !poi) return false;
    const stopName = String(stop.name || '').trim().toLowerCase();
    const poiName = String(poi.name || '').trim().toLowerCase();
    if (stopName && poiName && stopName === poiName) return true;
    if (Number.isFinite(Number(stop.x)) && Number.isFinite(Number(stop.y)) && Number.isFinite(Number(poi.x)) && Number.isFinite(Number(poi.y))) {
        return Math.sqrt(((Number(stop.x) - Number(poi.x)) ** 2) + ((Number(stop.y) - Number(poi.y)) ** 2)) <= 5;
    }
    return false;
}

function classifyCoastlineClipRun(cache, runs, index, scale) {
    const run = runs[index];
    if (!run?.needs_boat || run.is_river) return null;

    const diagnostic = {
        runIndex: index,
        label: run.label || run.biomeId || 'water',
        waterKm: Math.round(Number(run.distanceKm || 0)),
        result: 'tested'
    };

    const previous = runs[index - 1];
    const next = runs[index + 1];
    diagnostic.previous = previous?.label || previous?.biomeId || null;
    diagnostic.next = next?.label || next?.biomeId || null;
    if (!previous || !next) {
        diagnostic.result = 'not_land_sandwiched';
        diagnostic.reason = 'missing previous or next terrain run';
        return { clip: null, diagnostic };
    }
    if (previous.needs_boat || next.needs_boat) {
        diagnostic.result = 'not_land_sandwiched';
        diagnostic.reason = 'adjacent run also needs boat';
        return { clip: null, diagnostic };
    }

    const startPoint = previous.gridPoints?.[previous.gridPoints.length - 1];
    const endPoint = next.gridPoints?.[0];
    if (!startPoint || !endPoint) {
        diagnostic.result = 'missing_land_endpoints';
        diagnostic.reason = 'could not find land cells before/after water run';
        return { clip: null, diagnostic };
    }
    diagnostic.startCell = { x: startPoint.x, y: startPoint.y };
    diagnostic.endCell = { x: endPoint.x, y: endPoint.y };

    const waterBounds = runGridBounds(run);
    const bounds = waterBounds
        ? {
            minX: Math.min(waterBounds.minX, startPoint.x, endPoint.x),
            maxX: Math.max(waterBounds.maxX, startPoint.x, endPoint.x),
            minY: Math.min(waterBounds.minY, startPoint.y, endPoint.y),
            maxY: Math.max(waterBounds.maxY, startPoint.y, endPoint.y)
        }
        : null;
    const spanCells = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) : 1;
    const margin = Math.max(6, Math.ceil(spanCells * 4));
    const window = expandCellWindow(bounds, margin, cache.grid);
    diagnostic.window = window;
    diagnostic.marginCells = margin;
    const reroute = astar(
        cache,
        { x: startPoint.x, y: startPoint.y },
        { x: endPoint.x, y: endPoint.y },
        {
            mode: 'avoid_boat',
            scale,
            poiScores: new Map(),
            window
        }
    );

    if (!reroute) {
        diagnostic.result = 'no_local_land_route';
        diagnostic.reason = 'avoid-boat A* found no land route inside the local window';
        return { clip: null, diagnostic };
    }

    const avoidKm = pathCellsGridDistanceKm(reroute, cache, scale);
    const waterKm = Math.max(0.1, Number(run.distanceKm || 0));
    const detourRatio = avoidKm / waterKm;
    diagnostic.avoidKm = Math.round(avoidKm);
    diagnostic.detourRatio = Number(detourRatio.toFixed(2));
    diagnostic.routeCells = reroute.length;
    if (detourRatio > 2.25) {
        diagnostic.result = 'detour_too_large';
        diagnostic.reason = `local land detour ratio ${diagnostic.detourRatio} exceeds 2.25`;
        return { clip: null, diagnostic };
    }

    diagnostic.result = 'coastline_clip';
    return {
        diagnostic,
        clip: {
        avoidKm: Math.round(avoidKm),
        waterKm: Math.round(waterKm),
        detourRatio: Number(detourRatio.toFixed(2))
        }
    };
}

function cleanCoastlineClipRuns(cache, runs, scale) {
    const cleaned = [];
    const notes = [];
    const diagnostics = [];

    for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        const classification = classifyCoastlineClipRun(cache, runs, index, scale);
        if (classification?.diagnostic) diagnostics.push(classification.diagnostic);
        const coastlineClip = classification?.clip || null;
        if (coastlineClip) {
            const previous = cleaned[cleaned.length - 1];
            if (previous) {
                previous.distanceKm += coastlineClip.avoidKm;
                previous.coastline_adjusted = true;
                previous.endSegmentIndex = Math.max(previous.endSegmentIndex, run.endSegmentIndex);
                previous.endPoint = run.endPoint || previous.endPoint;
            }
            notes.push(`minor ${run.label} coastline clip treated as local land detour (${coastlineClip.avoidKm}km instead of ${coastlineClip.waterKm}km by water)`);
            continue;
        }
        cleaned.push(run);
    }

    return { runs: cleaned, notes, diagnostics };
}

function logCoastlineRerouteDiagnostics(logger, routeTitle, diagnostics = []) {
    if (!logger || !Array.isArray(diagnostics) || diagnostics.length === 0) return;
    const lines = diagnostics.map((test) => {
        const avoid = Number.isFinite(Number(test.avoidKm)) ? `, local land ${test.avoidKm}km` : '';
        const ratio = Number.isFinite(Number(test.detourRatio)) ? `, ratio ${test.detourRatio}` : '';
        const reason = test.reason ? ` - ${test.reason}` : '';
        return `${test.label || 'water'} ${test.waterKm || '?'}km: ${test.result}${avoid}${ratio}${reason}`;
    });
    const message = `[BiomeRoute] ${routeTitle || 'Route'} coastline reroute tests: ${lines.join(' | ')}`;
    if (typeof logger.runtime === 'function') logger.runtime(message);
    else if (typeof logger.log === 'function') logger.log('WorldLocationTracker', message);
}

function chooseSafetyStopCandidates(nodes, start, end, scale, maxWildStretchKm, limit = 8) {
    const threshold = Math.max(1, toNumber(maxWildStretchKm, 100));
    const totalKm = directDistanceKm(start, end, scale);
    if (totalKm <= threshold) return [];

    const endpointBufferKm = Math.max(2, Math.min(10, threshold * 0.08));
    const candidates = (nodes || [])
        .map(nodeToRoutePoint)
        .filter(Boolean)
        .filter(point => directDistanceKm(point, start, scale) > endpointBufferKm)
        .filter(point => directDistanceKm(point, end, scale) > endpointBufferKm);

    const stops = [];
    const used = new Set();
    let current = start;
    let previousRemainingKm = totalKm;
    const maxStops = Math.min(limit, candidates.length);

    for (let guard = 0; guard < maxStops; guard += 1) {
        const remainingKm = directDistanceKm(current, end, scale);
        if (remainingKm <= threshold) break;

        let best = null;
        for (const candidate of candidates) {
            const key = candidate.node?.uid || `${candidate.name}:${candidate.x}:${candidate.y}`;
            if (used.has(key)) continue;

            const fromCurrentKm = directDistanceKm(current, candidate, scale);
            const toEndKm = directDistanceKm(candidate, end, scale);
            if (toEndKm >= remainingKm - 1) continue;

            const detourKm = Math.max(0, (fromCurrentKm + toEndKm) - remainingKm);
            const wildPenalty = Math.max(0, fromCurrentKm - threshold) * 4;
            const projectedMaxLeg = Math.max(fromCurrentKm, toEndKm);
            const score = projectedMaxLeg + (detourKm * 0.35) + wildPenalty - Math.min(fromCurrentKm, threshold) * 0.05;

            if (!best || score < best.score) {
                best = {
                    ...candidate,
                    key,
                    distanceFromPreviousKm: Math.round(fromCurrentKm),
                    distanceToDestinationKm: Math.round(toEndKm),
                    detourKm: Math.round(detourKm),
                    score
                };
            }
        }

        if (!best) break;
        if (best.distanceToDestinationKm >= previousRemainingKm) break;

        stops.push(best);
        used.add(best.key);
        current = best;
        previousRemainingKm = best.distanceToDestinationKm;
    }

    const withStopsMaxLeg = maxStopLegKm([start, ...stops, end], scale);
    if (stops.length === 0 || withStopsMaxLeg >= Math.round(totalKm)) return [];
    return stops;
}

function makeRouteRun({ key, cell, biome, points, index }) {
    const startPoint = index > 0 ? points[index - 1] : points[index];
    return {
        key,
        biomeId: cell.primary || 'unknown',
        label: biome?.label || (cell.primary ? cell.primary : 'unknown terrain'),
        distanceKm: 0,
        needs_boat: !!cell.needs_boat,
        slows_down: !!cell.slows_down,
        is_road: !!cell.is_road,
        is_river: !!cell.is_river,
        uncertain: cell.unknown_ratio >= 0.5,
        features: new Set(cell.features || []),
        gridPoints: [],
        startPoint,
        endPoint: points[index],
        startSegmentIndex: Math.max(0, index - 1),
        endSegmentIndex: Math.max(0, index - 1)
    };
}

function summarizeRuns(points, paletteById, scale) {
    const runs = [];
    let current = null;

    for (let i = 0; i < points.length; i += 1) {
        const cell = points[i].cell || {};
        const key = [
            cell.primary || 'unknown',
            cell.needs_boat ? 'boat' : 'land',
            cell.slows_down ? 'slow' : 'normal',
            cell.is_road ? 'road' : 'offroad',
            cell.is_river ? 'river' : 'not_river',
            cell.unknown_ratio >= 0.5 ? 'unknown' : 'known'
        ].join('|');

        if (!current || current.key !== key) {
            if (current) runs.push(current);
            const biome = paletteById.get(cell.primary);
            current = makeRouteRun({ key, cell, biome, points, index: i });
        }

        current.gridPoints.push({ x: points[i].grid_x, y: points[i].grid_y, cell });
        (cell.features || []).forEach(feature => current.features.add(feature));
        if (i > 0) {
            current.distanceKm += distanceKm(points[i - 1], points[i], scale);
            current.endPoint = points[i];
            current.endSegmentIndex = i - 1;
        }
    }
    if (current) runs.push(current);

    return runs.map(run => {
        const features = Array.from(run.features)
            .filter(feature => feature && feature !== run.biomeId)
            .sort();
        return {
            biomeId: run.biomeId,
            label: run.label,
            distanceKm: Math.round(run.distanceKm),
            direction: directionBetween(run.startPoint, run.endPoint),
            needs_boat: run.needs_boat,
            slows_down: run.slows_down,
            is_road: run.is_road,
            is_river: run.is_river,
            uncertain: run.uncertain,
            coastline_adjusted: !!run.coastline_adjusted,
            features,
            gridPoints: run.gridPoints || [],
            nearby_pois: [],
            startSegmentIndex: run.startSegmentIndex,
            endSegmentIndex: run.endSegmentIndex
        };
    }).filter(run => run.distanceKm > 0 || run.is_river);
}

function attachPoisToRuns(runs, nearbyPois) {
    const enriched = runs.map(run => ({ ...run, nearby_pois: [] }));
    for (const poi of nearbyPois || []) {
        let bestIndex = -1;
        for (let index = 0; index < enriched.length; index += 1) {
            const run = enriched[index];
            if (poi.segmentIndex >= run.startSegmentIndex && poi.segmentIndex <= run.endSegmentIndex) {
                bestIndex = index;
                break;
            }
        }
        if (bestIndex < 0 && enriched.length > 0) bestIndex = 0;
        if (bestIndex >= 0) enriched[bestIndex].nearby_pois.push(poi);
    }
    return enriched.map(run => {
        const { gridPoints, ...publicRun } = run;
        return {
            ...publicRun,
            nearby_pois: run.nearby_pois.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name)).slice(0, 4)
        };
    });
}

function routeSignature(pathCells) {
    if (!pathCells) return '';
    const stride = Math.max(1, Math.floor(pathCells.length / 24));
    return pathCells.filter((_, index) => index % stride === 0).map(p => `${p.x},${p.y}`).join(';');
}

function routeCellKeys(pathCells, tolerance = 1) {
    const keys = new Set();
    for (const point of pathCells || []) {
        if (!point) continue;
        for (let dy = -tolerance; dy <= tolerance; dy += 1) {
            for (let dx = -tolerance; dx <= tolerance; dx += 1) {
                keys.add(`${point.x + dx},${point.y + dy}`);
            }
        }
    }
    return keys;
}

function routeSimilarity(pathA, pathB) {
    if (!Array.isArray(pathA) || !Array.isArray(pathB) || pathA.length === 0 || pathB.length === 0) return 0;
    const keysA = routeCellKeys(pathA, 1);
    let overlap = 0;
    for (const point of pathB) {
        if (keysA.has(`${point.x},${point.y}`)) overlap += 1;
    }
    return overlap / Math.max(1, Math.min(pathA.length, pathB.length));
}

function countPathCells(pathCells, predicate) {
    return (pathCells || []).reduce((count, point) => count + (predicate(point.cell || {}) ? 1 : 0), 0);
}

function buildRouteFromPathCells({ cache, worldData, pathCells, start, end, title, id, modeLabel, paletteById, scale, nodes, suggestedStops = [], extraNotes = [], routeMeta = {}, includeDebugPath = false, logger = null }) {
    if (!Array.isArray(pathCells) || pathCells.length < 2) return null;

    const points = pathToWorldPoints(pathCells, cache);
    const totalKm = points.reduce((sum, point, index) => index === 0 ? 0 : sum + distanceKm(points[index - 1], point, scale), 0);
    const nearby = nearbyNodesForPoints(points, nodes, scale)
        .filter(poi => !(suggestedStops || []).some(stop => stopMatchesNearbyPoi(stop, poi)));
    const coastlineCleanup = cleanCoastlineClipRuns(cache, summarizeRuns(points, paletteById, scale), scale);
    logCoastlineRerouteDiagnostics(logger, title, coastlineCleanup.diagnostics);
    const runs = attachPoisToRuns(coastlineCleanup.runs, nearby);
    const hasBoat = runs.some(run => run.needs_boat);
    const hasSlow = pathCells.some(p => p.cell?.slows_down);
    const hasRoad = pathCells.some(p => p.cell?.is_road);
    const hasRiver = pathCells.some(p => p.cell?.is_river);
    const hasUnknown = pathCells.some(p => Number(p.cell?.unknown_ratio || 0) >= 0.5);
    const notes = [];
    if (hasBoat) notes.push('requires boat crossing(s)');
    if (hasSlow) notes.push('includes slow terrain');
    if (hasRoad) notes.push('passes through marked roads/trails');
    if (hasRiver) notes.push('has river crossing/river terrain');
    if (hasUnknown) notes.push('passes through uncertain/unpainted terrain');
    for (const note of coastlineCleanup.notes) {
        notes.push(note);
    }
    for (const note of extraNotes || []) {
        if (note) notes.push(note);
    }

    const route = {
        id,
        title,
        mode_label: modeLabel,
        distanceKm: Math.round(totalKm),
        direction: directionBetween(start, end),
        notes,
        nearby_pois: nearby,
        suggested_stops: suggestedStops.length ? suggestedStops : nearby.slice(0, 4),
        journey_stops: suggestedStops,
        runs,
        cell_count: pathCells.length,
        has_boat_required: hasBoat,
        has_slow_terrain: hasSlow,
        has_river: hasRiver,
        signature: routeSignature(pathCells),
        ...routeMeta
    };
    if (includeDebugPath) {
        route.debug_path = points.map(point => ({
            x: Number(point.x.toFixed(2)),
            y: Number(point.y.toFixed(2))
        }));
    }
    route.text = buildRouteText(route);
    return route;
}

function buildRouteText(route) {
    const lines = [];
    lines.push(`${route.title}: ${route.distanceKm}km ${route.direction} (${route.mode_label})`);
    if (route.notes.length) lines.push(`Notes: ${route.notes.join('; ')}`);
    const journeyStops = Array.isArray(route.journey_stops) ? route.journey_stops : [];
    let nextStopIndex = 0;
    let routeDistanceSoFar = 0;
    let stepNumber = 1;

    const pushDueStops = () => {
        while (nextStopIndex < journeyStops.length) {
            const stop = journeyStops[nextStopIndex];
            const targetDistance = Number(stop.pathDistanceKm ?? stop.distanceFromPreviousKm ?? 0);
            if (targetDistance > 0 && routeDistanceSoFar + 0.5 < targetDistance) break;

            lines.push(`  ${stepNumber}. Stop at ${stop.name || 'Unnamed POI'}`);
            stepNumber += 1;
            nextStopIndex += 1;
        }
    };

    route.runs.forEach((run) => {
        const flags = [];
        if (run.slows_down) flags.push('slows travel');
        if (run.needs_boat) flags.push('needs boat');
        if (run.is_road) flags.push('road/easy route');
        if (run.is_river) flags.push('river crossing/river terrain');
        if (run.coastline_adjusted) flags.push('minor coastline clip adjusted');
        if (run.uncertain) flags.push('uncertain map data');
        if (run.features.length) flags.push(`features: ${run.features.join(', ')}`);
        const poiLabel = run.nearby_pois.length === 1 ? 'Nearby PoI' : 'Nearby PoIs';
        const poiText = run.nearby_pois.length
            ? ` - ${poiLabel}: ${run.nearby_pois.map(p => `${p.name}${p.distanceKm ? ` (${p.distanceKm}km off-route)` : ''}`).join(', ')}`
            : '';
        const terrainText = run.is_river
            ? `River crossing/river terrain ${run.direction}`
            : `${run.distanceKm}km ${run.label} ${run.direction}`;
        lines.push(`  ${stepNumber}. ${terrainText}${flags.length ? ` [${flags.join(', ')}]` : ''}${poiText}`);
        stepNumber += 1;
        routeDistanceSoFar += Math.max(0, Number(run.distanceKm || 0));
        pushDueStops();
    });

    while (nextStopIndex < journeyStops.length) {
        const stop = journeyStops[nextStopIndex];
        lines.push(`  ${stepNumber}. Stop at ${stop.name || 'Unnamed POI'}`);
        stepNumber += 1;
        nextStopIndex += 1;
    }
    return lines.join('\n');
}

function analyzeRoutes({ cache, worldData, start, end, routeCount = 3, includeDebugPaths = false, maxWildStretchKm = 100, logger = null }) {
    const dimensions = cache.source.world_dimensions;
    const scale = {
        pixelsPerKm: Math.max(1, toNumber(worldData?.meta?.pixels_per_km, 7)),
        baseSpeed: Math.max(1, toNumber(worldData?.meta?.base_walk_speed_kmpd, 30))
    };
    const startCell = worldToCell(start.x, start.y, cache.grid, dimensions);
    const endCell = worldToCell(end.x, end.y, cache.grid, dimensions);
    const nodes = Array.isArray(worldData?.nodes) ? worldData.nodes : [];
    const palette = normalizePalette(worldData);
    const paletteById = new Map(palette.map(entry => [entry.id, entry]));
    const poiScores = buildPoiScores(nodes, cache, dimensions, scale);
    const seen = new Set();
    const routePathCells = new Map();
    const routes = [];

    const addRoute = (route, pathCells, { allowDuplicate = false, priority = 0, replaceSimilar = false, replaceLowestIfFull = false } = {}) => {
        if (!route) return false;
        if (!allowDuplicate && seen.has(route.signature)) {
            logger?.runtime?.(`[BiomeRoute] Rejected ${route.title || route.id}: exact duplicate signature.`);
            return false;
        }
        let replaced = false;
        if (!allowDuplicate) {
            for (let index = 0; index < routes.length; index += 1) {
                const existing = routes[index];
                const existingCells = routePathCells.get(existing.id);
                const similarity = routeSimilarity(pathCells, existingCells);
                if (similarity < 0.82) continue;
                if (replaceSimilar && priority > Number(existing.priority || 0)) {
                    logger?.runtime?.(`[BiomeRoute] Replacing ${existing.title || existing.id} with ${route.title || route.id}; similarity=${similarity.toFixed(2)}.`);
                    seen.delete(existing.signature);
                    routePathCells.delete(existing.id);
                    routes.splice(index, 1);
                    replaced = true;
                    break;
                }
                logger?.runtime?.(`[BiomeRoute] Rejected ${route.title || route.id}: too similar to ${existing.title || existing.id} (${similarity.toFixed(2)}).`);
                return false;
            }
        }
        if (!replaced && routes.length >= routeCount && replaceLowestIfFull) {
            let lowestIndex = -1;
            let lowestPriority = priority;
            for (let index = 0; index < routes.length; index += 1) {
                const existingPriority = Number(routes[index].priority || 0);
                if (existingPriority < lowestPriority) {
                    lowestPriority = existingPriority;
                    lowestIndex = index;
                }
            }
            if (lowestIndex >= 0) {
                const removed = routes[lowestIndex];
                logger?.runtime?.(`[BiomeRoute] Replacing ${removed.title || removed.id} with ${route.title || route.id}; priority ${priority} beats ${lowestPriority}.`);
                seen.delete(removed.signature);
                routePathCells.delete(removed.id);
                routes.splice(lowestIndex, 1);
                replaced = true;
            }
        }
        if (!replaced && routes.length >= routeCount) {
            logger?.runtime?.(`[BiomeRoute] Rejected ${route.title || route.id}: route count already filled.`);
            return false;
        }
        route.priority = priority;
        seen.add(route.signature);
        routePathCells.set(route.id, pathCells || []);
        routes.push(route);
        logger?.runtime?.(`[BiomeRoute] Added ${route.title || route.id}: ${route.mode_label || route.id}.`);
        return true;
    };

    const straightPath = straightLinePathCells(cache, startCell, endCell);
    const straightRoute = buildRouteFromPathCells({
        cache,
        worldData,
        pathCells: straightPath,
        start,
        end,
        title: 'Path A',
        id: 'straight',
        modeLabel: 'absolute straight-line route',
        paletteById,
        scale,
        nodes,
        includeDebugPath: includeDebugPaths,
        logger
    });
    addRoute(straightRoute, straightPath, { allowDuplicate: true, priority: 100 });

    const wildStretchLimitKm = Math.max(1, toNumber(maxWildStretchKm, 100));
    const stopCandidates = chooseSafetyStopCandidates(nodes, start, end, scale, wildStretchLimitKm, 8);
    if (routes.length < routeCount && stopCandidates.length > 0) {
        const waypointCells = [start, ...stopCandidates.map(stop => ({ x: stop.x, y: stop.y })), end]
            .map(point => worldToCell(point.x, point.y, cache.grid, dimensions));
        const segments = [];
        const segmentDistances = [];
        let complete = true;
        for (let index = 1; index < waypointCells.length; index += 1) {
            const segment = astar(cache, waypointCells[index - 1], waypointCells[index], { mode: 'mixed', scale, poiScores });
            if (!segment) {
                complete = false;
                break;
            }
            segments.push(segment);
            segmentDistances.push(pathCellsDistanceKm(segment, cache, scale));
        }
        if (complete) {
            const pathCells = concatenatePathSegments(segments);
            let cumulativePathKm = 0;
            const suggestedStops = stopCandidates.map((stop, index) => {
                cumulativePathKm += segmentDistances[index] || 0;
                return {
                    name: stop.name,
                    type: stop.type,
                    distanceKm: Math.round(segmentDistances[index] || stop.distanceFromPreviousKm || 0),
                    distanceFromPreviousKm: Math.round(segmentDistances[index] || stop.distanceFromPreviousKm || 0),
                    pathDistanceKm: Math.round(cumulativePathKm),
                    x: stop.x,
                    y: stop.y
                };
            });
            const longestNoStopKm = maxStopLegKm([start, ...stopCandidates, end], scale);
            addRoute(buildRouteFromPathCells({
                cache,
                worldData,
                pathCells,
                start,
                end,
                title: 'Path B',
                id: 'poi_stops',
                modeLabel: 'minimizes long wilderness stretches via POI stops',
                paletteById,
                scale,
                nodes,
                suggestedStops,
                extraNotes: [
                    `aims for no POI-free stretch over ${wildStretchLimitKm}km; estimated longest stretch is ${longestNoStopKm}km`
                ],
                routeMeta: {
                    max_wild_stretch_setting_km: wildStretchLimitKm,
                    estimated_longest_no_stop_stretch_km: longestNoStopKm
                },
                includeDebugPath: includeDebugPaths,
                logger
            }), pathCells, { priority: 60 });
        }
    }

    const avoidBoatPathCells = astar(cache, startCell, endCell, { mode: 'avoid_boat', scale, poiScores });
    if (avoidBoatPathCells) {
        addRoute(buildRouteFromPathCells({
            cache,
            worldData,
            pathCells: avoidBoatPathCells,
            start,
            end,
            title: 'Path C',
            id: 'avoid_boat',
            modeLabel: 'avoids boat-required water',
            paletteById,
            scale,
            nodes,
            includeDebugPath: includeDebugPaths,
            logger
        }), avoidBoatPathCells, { priority: 90, replaceSimilar: true, replaceLowestIfFull: true });
    } else {
        logger?.runtime?.('[BiomeRoute] Path C skipped: no avoid-boat route exists.');
    }

    if (routes.length < routeCount && countPathCells(straightPath, cell => cell.slows_down) > 0) {
        const pathCells = astar(cache, startCell, endCell, { mode: 'avoid_slow', scale, poiScores });
        const slowCount = countPathCells(pathCells, cell => cell.slows_down);
        const straightSlowCount = countPathCells(straightPath, cell => cell.slows_down);
        if (pathCells && slowCount < straightSlowCount) {
            addRoute(buildRouteFromPathCells({
                cache,
                worldData,
                pathCells,
                start,
                end,
                title: 'Path D',
                id: 'avoid_difficult',
                modeLabel: 'avoids difficult terrain where possible',
                paletteById,
                scale,
                nodes,
                includeDebugPath: includeDebugPaths,
                logger
            }), pathCells, { priority: 50 });
        }
    }

    const fallbackCandidates = [
        { id: 'poi_rich', label: 'POI-rich alternate', mode: 'poi_rich', priority: 35 },
        { id: 'road_favored', label: 'road-favored alternate', mode: 'road_favored', priority: 34 },
        { id: 'avoid_slow_alt', label: 'terrain-easier alternate', mode: 'avoid_slow', priority: 33 },
        { id: 'mixed_alt', label: 'balanced alternate', mode: 'mixed', priority: 20 }
    ];

    for (const candidate of fallbackCandidates) {
        if (routes.length >= routeCount) break;
        if (candidate.id === 'avoid_slow_alt' && countPathCells(straightPath, cell => cell.slows_down) === 0) continue;
        const pathCells = astar(cache, startCell, endCell, { mode: candidate.mode, scale, poiScores });
        addRoute(buildRouteFromPathCells({
            cache,
            worldData,
            pathCells,
            start,
            end,
            title: `Path ${String.fromCharCode(65 + routes.length)}`,
            id: candidate.id,
            modeLabel: candidate.label,
            paletteById,
            scale,
            nodes,
            includeDebugPath: includeDebugPaths,
            logger
        }), pathCells, { priority: candidate.priority });
    }

    return {
        enabled: true,
        start,
        end,
        coverage: cache.coverage,
        pathfinding: {
            max_wild_stretch_without_poi_km: wildStretchLimitKm
        },
        grid: {
            width: cache.grid.width,
            height: cache.grid.height
        },
        routes
    };
}

function buildFallbackRoute({ worldData, start, end, reason }) {
    const scale = {
        pixelsPerKm: Math.max(1, toNumber(worldData?.meta?.pixels_per_km, 7)),
        baseSpeed: Math.max(1, toNumber(worldData?.meta?.base_walk_speed_kmpd, 30))
    };
    const directKm = Math.round(distanceKm(start, end, scale));
    const text = `Biome route analysis is OFF: ${reason}\nStraight-line fallback: ${directKm}km ${directionBetween(start, end)}.`;
    return {
        enabled: false,
        reason,
        start,
        end,
        fallback: {
            distanceKm: directKm,
            direction: directionBetween(start, end),
            text
        },
        text
    };
}

function applyDistancePresentation(analysis, distanceUnit) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    const definition = distanceUnits.getDistanceUnitDefinition(distanceUnit);
    analysis.distance_unit = definition;
    if (analysis.fallback) {
        analysis.fallback.distance_display = distanceUnits.formatDistanceKm(analysis.fallback.distanceKm, definition.key);
        analysis.fallback.text = distanceUnits.replaceDistanceMentions(analysis.fallback.text, definition.key);
    }
    for (const route of analysis.routes || []) {
        route.distanceDisplay = distanceUnits.formatDistanceKm(route.distanceKm, definition.key);
        route.notes = (route.notes || []).map(note => distanceUnits.replaceDistanceMentions(note, definition.key));
        route.text = distanceUnits.replaceDistanceMentions(route.text, definition.key);
        for (const run of route.runs || []) {
            run.distanceDisplay = distanceUnits.formatDistanceKm(run.distanceKm, definition.key);
            run.nearby_pois = (run.nearby_pois || []).map(poi => ({
                ...poi,
                distanceDisplay: distanceUnits.formatDistanceKm(poi.distanceKm, definition.key)
            }));
        }
    }
    analysis.text = distanceUnits.replaceDistanceMentions(analysis.text, definition.key);
    return analysis;
}

async function analyzeBiomeRoutes({ worldData, packagePath, biomeMaskPath, start, end, routeCount = 3, forceRebuild = false, includeDebugPaths = false, maxWildStretchKm = 100, distanceUnit = 'kilometres', logger = null }) {
    const gridResult = await loadOrCreateNavigationGrid({ worldData, packagePath, biomeMaskPath, forceRebuild });
    if (!gridResult.enabled) {
        const reason = gridResult.reason || `painted biome coverage is below ${Math.round(MIN_PAINTED_COVERAGE * 100)}%`;
        return applyDistancePresentation(buildFallbackRoute({ worldData, start, end, reason }), distanceUnit);
    }

    const analysis = analyzeRoutes({
        cache: gridResult.cache,
        worldData,
        start,
        end,
        routeCount: clamp(Math.round(toNumber(routeCount, 3)), 1, 6),
        includeDebugPaths,
        maxWildStretchKm,
        logger
    });
    analysis.cache = {
        path: gridResult.cachePath,
        fromCache: !!gridResult.fromCache,
        coverage: gridResult.cache.coverage
    };
    analysis.text = analysis.routes.map(route => route.text).join('\n\n');
    return applyDistancePresentation(analysis, distanceUnit);
}

module.exports = {
    CACHE_FILE,
    GENERATOR_VERSION,
    MIN_PAINTED_COVERAGE,
    loadOrCreateNavigationGrid,
    generateNavigationGrid,
    lookupBiomeAtCoordinates,
    inspectStraightCorridor,
    analyzeBiomeRoutes,
    buildFallbackRoute
};
