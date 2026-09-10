const fs = require('fs/promises');
const path = require('path');
const Logic = require('./logic.js');
const { writeRouteDebugImage } = require('./route_debug_renderer.js');

const DEFAULT_BIOME_MASK_FILE = 'biome_mask.png';
const TIMELINE_CONTEXT_CACHE_MAX = 64;
const timelineContextCache = new Map();

function rememberTimelineContext(cacheKey, value) {
    timelineContextCache.set(cacheKey, value);
    while (timelineContextCache.size > TIMELINE_CONTEXT_CACHE_MAX) {
        const oldestKey = timelineContextCache.keys().next().value;
        timelineContextCache.delete(oldestKey);
    }
    return value;
}

async function resolveTimelineProviderContext(turnContext, tools) {
    if (!turnContext?.isSkeleton) return turnContext;
    if (!tools?.turns) return turnContext;

    const chatKey = turnContext.chatDbFullPath || turnContext.projectName || 'unknown_chat';
    const contextKey = turnContext.dbId
        ? `${chatKey}:db:${turnContext.dbId}`
        : `${chatKey}:creation:${turnContext.creationTurnNumber || turnContext.turnNumber}`;

    if (timelineContextCache.has(contextKey)) {
        const cached = await timelineContextCache.get(contextKey);
        timelineContextCache.delete(contextKey);
        timelineContextCache.set(contextKey, cached);
        return cached || turnContext;
    }

    const promise = (async () => {
        try {
            if (turnContext.dbId) {
                const byDbId = await tools.turns.getByDbId(turnContext.dbId);
                if (byDbId?.context) return byDbId.context;
            }
            if (Number.isInteger(turnContext.creationTurnNumber) && turnContext.creationTurnNumber > 0) {
                const byCreation = await tools.turns.getByCreationTurnNumber(turnContext.creationTurnNumber);
                if (byCreation?.context) return byCreation.context;
            }
            if (Number.isInteger(turnContext.turnNumber) && turnContext.turnNumber > 0) {
                const byDisplay = await tools.turns.get(turnContext.turnNumber);
                if (byDisplay?.context) return byDisplay.context;
            }
        } catch (error) {
            tools.logger.warn('TimelineDiag', `WLT failed to inflate timeline turn ${turnContext.turnNumber || turnContext.creationTurnNumber || 'unknown'}: ${error.message}`);
        }
        return turnContext;
    })();

    rememberTimelineContext(contextKey, promise);
    const resolved = await promise;
    rememberTimelineContext(contextKey, resolved);
    return resolved || turnContext;
}

function isPathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;

    const normalizedRoot = path.resolve(rootPath);
    const normalizedTarget = path.resolve(targetPath);
    const relativePath = path.relative(normalizedRoot, normalizedTarget);

    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function sanitizeBiomeMaskFile(value) {
    const basename = path.basename(String(value || DEFAULT_BIOME_MASK_FILE).trim() || DEFAULT_BIOME_MASK_FILE);
    return basename.toLowerCase().endsWith('.png') ? basename : DEFAULT_BIOME_MASK_FILE;
}

function decodeBiomeMaskDataUrl(dataUrl) {
    const raw = String(dataUrl || '').trim();
    if (!raw) return null;
    const match = raw.match(/^data:image\/png;base64,(.+)$/);
    if (!match) throw new Error('Invalid biome mask payload.');
    return Buffer.from(match[1], 'base64');
}

const CLI_COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    grey: "\x1b[90m",
    red: "\x1b[31m",
    bold: "\x1b[1m"
};

const CLI_VALUE_FLAGS = new Set(['-n', '--limit', '-p', '--page', '--type', '--area', '--anchor', '--view', '--name', '--routes']);
const CLI_SWITCH_FLAGS = new Set(['--json', '--raw', '--chars', '--no-chars', '--rebuild', '--debug-image']);

function hasCliFlag(args, names) {
    const allNames = Array.isArray(names) ? names : [names];
    return args.some((arg) => allNames.includes(arg) || allNames.some((name) => arg.startsWith(`${name}=`)));
}

function getCliFlagValue(args, names, fallback = null) {
    const allNames = Array.isArray(names) ? names : [names];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const eqName = allNames.find((name) => arg.startsWith(`${name}=`));
        if (eqName) return arg.slice(eqName.length + 1);
        if (allNames.includes(arg) && args[index + 1] !== undefined) return args[index + 1];
    }
    return fallback;
}

function stripCliOptions(args) {
    const result = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const flagName = arg.includes('=') ? arg.split('=')[0] : arg;
        if (CLI_VALUE_FLAGS.has(flagName)) {
            if (!arg.includes('=')) index += 1;
            continue;
        }
        if (CLI_SWITCH_FLAGS.has(flagName)) continue;
        result.push(arg);
    }
    return result;
}

function getRouteDebugImageFileName(args) {
    const arg = (args || []).find(item => String(item || '').startsWith('--debug-image='));
    if (!arg) return null;
    const value = String(arg).slice('--debug-image='.length).trim();
    return value || null;
}

function parseTravelInterceptTarget(descriptor = {}) {
    const payload = descriptor?.payload || {};
    const numericOrNull = (value) => {
        const numeric = Number(value);
        return Number.isInteger(numeric) ? numeric : null;
    };

    let line = numericOrNull(descriptor.line ?? descriptor.travelLine ?? payload.line ?? payload.travelLine);
    const dialogueIndex = numericOrNull(descriptor.dialogueIndex);
    if (line === null && dialogueIndex !== null && dialogueIndex >= 0) line = dialogueIndex;
    if (line === null && String(descriptor.checkpoint || '').toLowerCase() === 'before_first_dialogue') line = 0;

    let segmentIndex = numericOrNull(descriptor.segmentIndex ?? descriptor.travelSegmentIndex ?? payload.segmentIndex ?? payload.travelSegmentIndex);

    const id = String(descriptor.interceptId || descriptor.id || '');
    const idMatch = id.match(/_(\d+)_(\d+)$/);
    if (idMatch) {
        if (line === null) line = numericOrNull(idMatch[1]);
        if (segmentIndex === null) segmentIndex = numericOrNull(idMatch[2]);
    }

    return { line, segmentIndex };
}

function isTravelRouteInterceptDescriptor(descriptor = {}) {
    if (!descriptor || typeof descriptor !== 'object') return false;
    const pluginId = descriptor.pluginId || descriptor.plugin || 'world_location_tracker';
    if (pluginId !== 'world_location_tracker') return false;

    const interceptId = String(descriptor.interceptId || descriptor.id || descriptor.handlerId || '');
    const handlerRef = String(descriptor.handlerRef || '');
    return interceptId.startsWith('travel_route_')
        || handlerRef.endsWith('travel_route')
        || descriptor.travelLine !== undefined
        || descriptor.travelSegmentIndex !== undefined
        || descriptor.payload?.travelLine !== undefined
        || descriptor.payload?.travelSegmentIndex !== undefined;
}

function normalizeTravelRouteInterceptDescriptor(descriptor = {}) {
    if (!isTravelRouteInterceptDescriptor(descriptor)) return descriptor;
    return {
        ...descriptor,
        pluginId: descriptor.pluginId || 'world_location_tracker',
        debugLabel: descriptor.debugLabel || 'WorldTravelIntercept',
        renderer: 'pixi',
        blocking: true,
        autoDismiss: false,
        keepVNViewportDuringTakeover: true,
        visualState: {
            ...(descriptor.visualState && typeof descriptor.visualState === 'object' ? descriptor.visualState : {}),
            keepVNViewportDuringTakeover: true
        },
        timeoutMs: Number.isFinite(Number(descriptor.timeoutMs)) ? Number(descriptor.timeoutMs) : 45000
    };
}

async function buildTravelTakeoverUi(context, tools, descriptor = {}) {
    const jsPath = path.join(__dirname, 'travel_takeover.js');
    const js = await fs.readFile(jsPath, 'utf8');
    let payload = null;

    try {
        const logic = new Logic(tools);
        const status = await logic.getOperationalStatus(context);
        if (!status.active) return null;
        const target = parseTravelInterceptTarget(descriptor);
        const rebuilt = await logic.buildTravelInterceptPayloads(context);
        if (Array.isArray(rebuilt) && rebuilt.length > 0) {
            const sameLine = target.line === null
                ? rebuilt
                : rebuilt.filter(entry => Number(entry.line) === target.line);
            const pool = sameLine.length > 0 ? sameLine : rebuilt;
            const exact = target.segmentIndex === null
                ? null
                : pool.find(entry => Number(entry.index) === target.segmentIndex);
            payload = (exact || pool[0])?.payload || null;
        }
        tools.logger.runtime(`[WorldTravelIntercept] Playback payload rebuild: targetLine=${target.line ?? 'any'}, targetSegment=${target.segmentIndex ?? 'any'}, rebuilt=${Array.isArray(rebuilt) ? rebuilt.length : 0}, hasPayload=${!!payload}`);
    } catch (error) {
        tools.logger.error('WorldTravelIntercept', `Failed to rebuild live travel payload: ${error.message}`);
    }

    return {
        renderer: 'pixi',
        autoDismiss: false,
        js,
        payload
    };
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

function parsePaging(args, defaults = {}) {
    const maxLimit = defaults.maxLimit || 200;
    const limit = parsePositiveInt(getCliFlagValue(args, ['-n', '--limit']), defaults.limit || 25, 1, maxLimit);
    const page = parsePositiveInt(getCliFlagValue(args, ['-p', '--page']), 1, 1, 999999);
    return { limit, page, offset: (page - 1) * limit };
}

function truncateCli(value, maxLength = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeCliLineEndings(value) {
    return String(value || '').replace(/\r\n|\r|\n/g, '\r\n');
}

function wrapCliLine(line, width = 120) {
    if (line.length <= width) return [line];

    const leadingWhitespace = line.match(/^\s*/)?.[0] || '';
    const listIndent = /^(\s*(?:[-*]|\d+\.|->)\s+)/.exec(line)?.[1] || '';
    const continuationIndent = listIndent
        ? ' '.repeat(listIndent.length)
        : `${leadingWhitespace}  `;
    const words = line.trim().split(/\s+/);
    const lines = [];
    let current = leadingWhitespace;

    for (const word of words) {
        const separator = current.trim() ? ' ' : '';
        if ((current + separator + word).length > width && current.trim()) {
            lines.push(current);
            current = continuationIndent + word;
        } else {
            current += separator + word;
        }
    }

    if (current.trim()) lines.push(current);
    return lines.length ? lines : [line];
}

function formatCliPreviewBlock(value, width = 118) {
    return normalizeCliLineEndings(value)
        .split('\r\n')
        .flatMap((line) => wrapCliLine(line, width))
        .join('\r\n');
}

function normalizeCliText(value) {
    return String(value || '').trim().toLowerCase();
}

function getLocationRows(logic) {
    const nodes = Array.isArray(logic.worldData?.nodes) ? logic.worldData.nodes : [];
    return nodes.map((node) => {
        const x = Number(node.world_x ?? node.x ?? 0);
        const y = Number(node.world_y ?? node.y ?? 0);
        const areaContext = logic.getAreaContextForCoordinates(x, y);
        const areaTrail = areaContext.hierarchy.map((area) => area.name).filter(Boolean).join(' / ');
        return {
            uid: node.uid || '',
            name: node.name || 'Untitled Location',
            type: node.type || 'POI',
            x,
            y,
            area: areaTrail || 'none',
            tags: node.tags || '',
            description: node.description || ''
        };
    }).sort((left, right) => left.name.localeCompare(right.name));
}

function getAreaRows(logic) {
    const areas = Array.isArray(logic.worldData?.areas) ? logic.worldData.areas : [];
    const areaMap = logic.getAreaMap();
    return areas.map((area) => ({
        uid: area.uid || '',
        name: area.name || 'Untitled Area',
        type: area.kind || 'region',
        hierarchy: logic.getAreaHierarchy(area, areaMap).map((item) => item.name || 'Untitled Area').join(' / '),
        points: logic.getAreaPoints(area).length,
        tags: area.tags || '',
        description: area.description || ''
    })).sort((left, right) => left.hierarchy.localeCompare(right.hierarchy));
}

function filterRows(rows, args, explicitQuery = '') {
    const query = normalizeCliText(explicitQuery);
    const typeFilter = normalizeCliText(getCliFlagValue(args, '--type', ''));
    const areaFilter = normalizeCliText(getCliFlagValue(args, '--area', ''));

    return rows.filter((row) => {
        if (typeFilter && !normalizeCliText(row.type).includes(typeFilter)) return false;
        if (areaFilter && !normalizeCliText(row.area || row.hierarchy).includes(areaFilter)) return false;
        if (!query) return true;

        return [
            row.name,
            row.type,
            row.area,
            row.hierarchy,
            row.tags,
            row.description,
            row.uid,
            row.x,
            row.y
        ].some((part) => normalizeCliText(part).includes(query));
    });
}

function paginateRows(rows, paging) {
    return rows.slice(paging.offset, paging.offset + paging.limit);
}

function formatPageFooter(total, displayed, paging, colors = CLI_COLORS) {
    const pages = Math.max(1, Math.ceil(total / paging.limit));
    const hidden = Math.max(0, total - (paging.offset + displayed));
    let output = `${colors.grey}Page ${paging.page} of ${pages} (${total} match${total === 1 ? '' : 'es'}).${colors.reset}`;
    if (hidden > 0) {
        output += `\r\n${colors.yellow}${hidden} more not shown. Use -p ${paging.page + 1} to continue.${colors.reset}`;
    }
    return output;
}

function formatLocationRows(rows, total, paging, colors = CLI_COLORS) {
    const lines = rows.map((row, index) => {
        const absoluteIndex = paging.offset + index + 1;
        const tags = row.tags ? ` | tags: ${truncateCli(row.tags, 50)}` : '';
        return `  ${colors.grey}${absoluteIndex}.${colors.reset} ${colors.cyan}${row.name}${colors.reset} ${colors.magenta}[${row.type}]${colors.reset} @ ${row.x}, ${row.y} | area: ${colors.green}${row.area}${colors.reset}${tags}`;
    });
    return `${lines.join('\r\n')}\r\n${formatPageFooter(total, rows.length, paging, colors)}`;
}

function formatAreaRows(rows, total, paging, colors = CLI_COLORS) {
    const lines = rows.map((row, index) => {
        const absoluteIndex = paging.offset + index + 1;
        return `  ${colors.grey}${absoluteIndex}.${colors.reset} ${colors.cyan}${row.hierarchy}${colors.reset} ${colors.magenta}[${row.type}]${colors.reset} | ${row.points} points`;
    });
    return `${lines.join('\r\n')}\r\n${formatPageFooter(total, rows.length, paging, colors)}`;
}

function findNearestNode(nodes, x, y) {
    let nearest = null;
    for (const node of nodes || []) {
        const dx = Number(node.world_x ?? node.x ?? 0) - x;
        const dy = Number(node.world_y ?? node.y ?? 0) - y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!nearest || distance < nearest.pixelDistance) {
            nearest = { node, pixelDistance: distance };
        }
    }
    return nearest;
}

function isNumericCliToken(value) {
    if (value === undefined || value === null) return false;
    const text = String(value).trim();
    if (!text) return false;
    return Number.isFinite(Number(text));
}

function stripWrappingQuotes(value) {
    const text = String(value || '').trim();
    if (text.length < 2) return text;
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return text.slice(1, -1).trim();
    }
    return text;
}

function normalizeNodeLookupText(value) {
    return stripWrappingQuotes(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugifyNodeLookupText(value) {
    return normalizeNodeLookupText(value)
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getNodeCoordinates(node) {
    return {
        x: Number(node?.world_x ?? node?.x ?? 0),
        y: Number(node?.world_y ?? node?.y ?? 0)
    };
}

function findNodeByCliName(nodes, rawName) {
    const query = normalizeNodeLookupText(rawName);
    const querySlug = slugifyNodeLookupText(rawName);
    if (!query && !querySlug) return null;

    const candidates = (nodes || [])
        .map((node) => {
            const name = node?.name || '';
            const uid = node?.uid || '';
            const nameExact = normalizeNodeLookupText(name);
            const uidExact = normalizeNodeLookupText(uid);
            const nameSlug = slugifyNodeLookupText(name);
            const uidSlug = slugifyNodeLookupText(uid);

            if (uidExact && uidExact === query) return { node, rank: 50 };
            if (nameExact && nameExact === query) return { node, rank: 45 };
            if (uidSlug && uidSlug === querySlug) return { node, rank: 40 };
            if (nameSlug && nameSlug === querySlug) return { node, rank: 35 };
            return null;
        })
        .filter(Boolean)
        .sort((left, right) => right.rank - left.rank);

    return candidates[0] || null;
}

function resolveRouteEndpoint(tokens, nodes) {
    const cleanTokens = (tokens || []).map((token) => String(token || '').trim()).filter(Boolean);
    if (cleanTokens.length === 2 && cleanTokens.every(isNumericCliToken)) {
        const x = Number(cleanTokens[0]);
        const y = Number(cleanTokens[1]);
        return {
            type: 'coordinates',
            x,
            y,
            label: `${x}, ${y}`,
            score: 60
        };
    }

    const name = cleanTokens.join(' ').trim();
    const match = findNodeByCliName(nodes, name);
    if (!match) return null;

    const coords = getNodeCoordinates(match.node);
    if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;

    return {
        type: 'node',
        x: coords.x,
        y: coords.y,
        label: match.node.name || match.node.uid || name,
        node: match.node,
        score: match.rank
    };
}

function parseRouteEndpoints(args, nodes) {
    const positional = stripCliOptions(args);
    const candidates = [];

    for (let splitIndex = 1; splitIndex < positional.length; splitIndex += 1) {
        const start = resolveRouteEndpoint(positional.slice(0, splitIndex), nodes);
        const end = resolveRouteEndpoint(positional.slice(splitIndex), nodes);
        if (!start || !end) continue;

        const coordinateShapeBonus =
            (start.type === 'coordinates' && splitIndex === 2 ? 8 : 0)
            + (end.type === 'coordinates' && positional.length - splitIndex === 2 ? 8 : 0);

        candidates.push({
            start,
            end,
            score: start.score + end.score + coordinateShapeBonus,
            splitIndex
        });
    }

    candidates.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.splitIndex - right.splitIndex;
    });

    return candidates[0] || null;
}

async function loadWorldDataForCli(tools) {
    const context = tools.turnContext || {};
    const logic = new Logic(tools);
    await logic.loadWorldData(context, { skipTiling: true });
    return { logic, context };
}

async function runLocationPromptSimulation(args, tools, logic, context, colors = CLI_COLORS) {
    const x = Number(args[0]);
    const y = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return `${colors.yellow}Usage: /location prompt <x> <y> [specific_name] [--anchor <node>] [--view <text>] [--no-chars] [--raw]${colors.reset}`;
    }

    const remainingName = stripCliOptions(args.slice(2)).join(' ').trim();
    const nearest = findNearestNode(logic.worldData?.nodes || [], x, y);
    const exactNode = nearest && nearest.pixelDistance <= 5 ? nearest.node : null;
    const name = getCliFlagValue(args, '--name')
        || remainingName
        || (exactNode ? exactNode.name : (nearest ? `Near ${nearest.node.name}` : 'Unmapped location'));
    const anchor = getCliFlagValue(args, '--anchor')
        || (nearest ? nearest.node.name : null);
    const view = getCliFlagValue(args, '--view', 'Above Ground');
    const relevantLimit = parsePositiveInt(getCliFlagValue(args, ['-n', '--limit']), 15, 1, 100);
    const includeCharacters = !hasCliFlag(args, '--no-chars');

    const promptText = await logic.buildLocationPromptText(context, {
        x,
        y,
        name,
        anchor,
        underground_status: view
    }, {
        includeCharacters,
        relevantLimit
    });

    const wrapped = hasCliFlag(args, '--raw') || !tools.prompt?.wrap
        ? promptText
        : tools.prompt.wrap('current_location', promptText);
    const formattedPreview = formatCliPreviewBlock(wrapped);
    const nearestLine = nearest
        ? `${colors.grey}Nearest map node: ${nearest.node.name} (${Math.round(nearest.pixelDistance)}px away).${colors.reset}\r\n`
        : '';

    return `\r\n${colors.bright}World Location Prompt Preview${colors.reset}\r\n` +
        `${colors.grey}Coordinates: ${x}, ${y} | Name: ${name}${anchor ? ` | Anchor: ${anchor}` : ''} | View: ${view}${colors.reset}\r\n` +
        nearestLine +
        `\r\n${formattedPreview}`;
}

async function runLocationRouteAnalysis(args, logic, context, colors = CLI_COLORS) {
    const endpoints = parseRouteEndpoints(args, logic.worldData?.nodes || []);

    if (!endpoints) {
        return `${colors.yellow}Usage: /location route <startX> <startY> <endX> <endY> [--routes <n>] [--rebuild] [--json] [--debug-image]\r\n` +
            `       /location route <startX> <startY> <node_name> [--routes <n>] [--rebuild] [--json] [--debug-image]\r\n` +
            `       /location route <node_name_1> <node_name_2> [--routes <n>] [--rebuild] [--json] [--debug-image]${colors.reset}`;
    }

    const routeCount = parsePositiveInt(getCliFlagValue(args, '--routes'), 3, 1, 6);
    const wantsDebugImage = hasCliFlag(args, '--debug-image');
    const analysis = await logic.analyzeBiomeRouteBetweenCoordinates(
        context,
        { x: endpoints.start.x, y: endpoints.start.y },
        { x: endpoints.end.x, y: endpoints.end.y },
        {
            routeCount,
            forceRebuild: hasCliFlag(args, '--rebuild'),
            includeDebugPaths: wantsDebugImage
        }
    );

    analysis.request = {
        start: {
            type: endpoints.start.type,
            label: endpoints.start.label,
            x: endpoints.start.x,
            y: endpoints.start.y,
            uid: endpoints.start.node?.uid || null
        },
        end: {
            type: endpoints.end.type,
            label: endpoints.end.label,
            x: endpoints.end.x,
            y: endpoints.end.y,
            uid: endpoints.end.node?.uid || null
        }
    };

    if (wantsDebugImage && analysis.enabled) {
        try {
            analysis.debug_image = await writeRouteDebugImage({
                analysis,
                mapImagePath: logic.mapImage,
                packagePath: logic.worldPackagePath,
                requestedFileName: getRouteDebugImageFileName(args)
            });
        } catch (error) {
            analysis.debug_image_error = error.message;
        }
    }

    if (hasCliFlag(args, '--json')) return JSON.stringify(analysis, null, 2);

    if (!analysis.enabled) {
        return `\r\n${colors.bright}Biome Route Analysis${colors.reset}\r\n` +
            `${colors.yellow}${analysis.fallback?.text || analysis.reason || 'Biome routing unavailable.'}${colors.reset}`;
    }

    const cacheLine = analysis.cache
        ? `${colors.grey}Grid: ${analysis.grid.width}x${analysis.grid.height} | painted: ${Math.round((analysis.coverage?.painted || 0) * 100)}% | cache: ${analysis.cache.fromCache ? 'hit' : 'rebuilt'}${colors.reset}\r\n`
        : '';
    const pathfindingLine = analysis.pathfinding?.max_wild_stretch_without_poi_km
        ? `${colors.grey}Pathfinding: tries to avoid POI-free stretches over ${logic.formatDistance(analysis.pathfinding.max_wild_stretch_without_poi_km)}${colors.reset}\r\n`
        : '';
    const routeText = (analysis.routes || []).map((route) => {
        const body = formatCliPreviewBlock(route.text || '', 118);
        const hasJourneyStops = Array.isArray(route.journey_stops) && route.journey_stops.length;
        const stops = !hasJourneyStops && Array.isArray(route.suggested_stops) && route.suggested_stops.length
            ? `\r\n${colors.grey}Suggested stops: ${route.suggested_stops.map(stop => stop.name).join(', ')}${colors.reset}`
            : '';
        return `${body}${stops}`;
    }).join('\r\n\r\n');

    return `\r\n${colors.bright}Biome Route Analysis${colors.reset}\r\n` +
        `${colors.grey}From ${endpoints.start.label} (${endpoints.start.x}, ${endpoints.start.y}) to ${endpoints.end.label} (${endpoints.end.x}, ${endpoints.end.y})${colors.reset}\r\n` +
        cacheLine +
        pathfindingLine +
        `\r\n${routeText || `${colors.yellow}No route candidates found.${colors.reset}`}` +
        (analysis.debug_image?.relativePath ? `\r\n\r\n${colors.green}Debug image saved: ${analysis.debug_image.relativePath}${colors.reset}` : '') +
        (analysis.debug_image_error ? `\r\n\r\n${colors.yellow}Route analysis succeeded, but debug image export failed: ${analysis.debug_image_error}${colors.reset}` : '');
}

const locationTerminalCommand = {
    description: 'Inspect world map locations and preview location prompt injection. Usage: /location [list|search|show|areas|prompt|route]',
    run: async (args, tools) => {
        const colors = CLI_COLORS;
        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'help') {
            return `\r\n${colors.bright}World Location Tracker Toolkit${colors.reset}\r\n` +
                `Usage: /location ${colors.cyan}[subcommand]${colors.reset} ${colors.yellow}[query|coords]${colors.reset} ${colors.grey}[options]${colors.reset}\r\n\r\n` +
                `${colors.bright}Subcommands:${colors.reset}\r\n` +
                `  ${colors.cyan}list${colors.reset}       - Page through map locations.\r\n` +
                `  ${colors.cyan}search${colors.reset}     - Search locations by name, type, tags, description, area, or coordinates.\r\n` +
                `  ${colors.cyan}show${colors.reset}       - Show one location by name or uid.\r\n` +
                `  ${colors.cyan}areas${colors.reset}      - Page through drawn map areas.\r\n` +
                `  ${colors.cyan}prompt${colors.reset}     - Simulate the current_location prompt block for coordinates.\r\n` +
                `  ${colors.cyan}route${colors.reset}      - Generate biome-aware route options between coordinates or named nodes.\r\n\r\n` +
                `${colors.bright}Options:${colors.reset}\r\n` +
                `  -n, --limit ${colors.magenta}<num>${colors.reset}   Result limit, default 25, max 200 for lists.\r\n` +
                `  -p, --page ${colors.magenta}<num>${colors.reset}    Page number for large maps.\r\n` +
                `  --type ${colors.magenta}<text>${colors.reset}       Filter locations/areas by type.\r\n` +
                `  --area ${colors.magenta}<text>${colors.reset}       Filter locations by computed area.\r\n` +
                `  --routes ${colors.magenta}<num>${colors.reset}      Route candidates for /location route, default 3, max 6.\r\n` +
                `  --rebuild           Force biome navigation grid cache regeneration.\r\n` +
                `  --debug-image       Save a route overlay PNG inside the .world/debug_routes folder.\r\n` +
                `  --debug-image=${colors.magenta}<file>${colors.reset} Same as above, with a custom PNG filename.\r\n` +
                `  --json              Output list/search/show as JSON.\r\n` +
                `  --raw               For prompt preview, omit the XML wrapper.\r\n` +
                `  --no-chars          For prompt preview, omit character-location synthesis.\r\n\r\n` +
                `${colors.bright}Examples:${colors.reset}\r\n` +
                `  /location list -n 30 -p 2\r\n` +
                `  /location search "Port" --area Sumeru\r\n` +
                `  /location show "Aaru Village"\r\n` +
                `  /location areas --type nation\r\n` +
                `  /location prompt 6127 -6696 "Aaru Village"\r\n` +
                `  /location prompt 6200 -6800 "Roadside Camp" --anchor "Aaru Village" --raw\r\n` +
                `  /location route 6127 -6696 7200 -7420 --routes 3\r\n` +
                `  /location route 672 -900 anchor_node_name --routes 3 --rebuild\r\n` +
                `  /location route anchor_node_1 anchor_node_2 --routes 3\r\n` +
                `  /location route Voll Vorig --routes 4 --debug-image\r\n`;
        }

        const { logic, context } = await loadWorldDataForCli(tools);
        const operationalStatus = logic.getLoadedOperationalStatus();
        if (!operationalStatus.active) {
            return `${colors.yellow}World Location Tracker is inactive: ${operationalStatus.reason}${colors.reset}`;
        }
        const worldData = logic.worldData;
        if (!worldData || (!Array.isArray(worldData.nodes) && !Array.isArray(worldData.areas))) {
            return `${colors.yellow}No world map data is currently loaded for this project.${colors.reset}`;
        }

        if (['list', 'locations', 'ls'].includes(subcommand)) {
            const commandArgs = args.slice(1);
            const paging = parsePaging(commandArgs, { limit: 25, maxLimit: 200 });
            const rows = filterRows(getLocationRows(logic), commandArgs);
            const pageRows = paginateRows(rows, paging);
            if (hasCliFlag(commandArgs, '--json')) {
                return JSON.stringify({ page: paging.page, limit: paging.limit, total: rows.length, locations: pageRows }, null, 2);
            }
            if (pageRows.length === 0) return `${colors.grey}No locations found on page ${paging.page}.${colors.reset}`;
            return `\r\n${colors.bright}World Locations${colors.reset}\r\n` + formatLocationRows(pageRows, rows.length, paging, colors);
        }

        if (subcommand === 'search') {
            const commandArgs = args.slice(1);
            const query = stripCliOptions(commandArgs).join(' ').trim();
            if (!query && !getCliFlagValue(commandArgs, '--type') && !getCliFlagValue(commandArgs, '--area')) {
                return `${colors.yellow}Usage: /location search <query> [-n <limit>] [-p <page>] [--type <type>] [--area <area>]${colors.reset}`;
            }
            const paging = parsePaging(commandArgs, { limit: 25, maxLimit: 200 });
            const rows = filterRows(getLocationRows(logic), commandArgs, query);
            const pageRows = paginateRows(rows, paging);
            if (hasCliFlag(commandArgs, '--json')) {
                return JSON.stringify({ query, page: paging.page, limit: paging.limit, total: rows.length, locations: pageRows }, null, 2);
            }
            if (pageRows.length === 0) return `${colors.grey}No locations matched "${query || 'filters'}".${colors.reset}`;
            return `\r\n${colors.bright}Location Search${colors.reset} ${colors.grey}${query || '(filters only)'}${colors.reset}\r\n` +
                formatLocationRows(pageRows, rows.length, paging, colors);
        }

        if (['show', 'view'].includes(subcommand)) {
            const commandArgs = args.slice(1);
            const target = stripCliOptions(commandArgs).join(' ').trim();
            if (!target) return `${colors.yellow}Usage: /location show <name|uid>${colors.reset}`;
            const targetText = normalizeCliText(target);
            const rows = getLocationRows(logic);
            const exact = rows.find((row) => normalizeCliText(row.uid) === targetText || normalizeCliText(row.name) === targetText);
            const partial = exact || rows.find((row) => normalizeCliText(row.name).includes(targetText));
            if (!partial) return `${colors.grey}No location found for "${target}".${colors.reset}`;
            if (hasCliFlag(commandArgs, '--json')) return JSON.stringify(partial, null, 2);
            return `\r\n${colors.bright}Location Detail${colors.reset}\r\n` +
                `  ${colors.cyan}Name:${colors.reset} ${partial.name}\r\n` +
                `  ${colors.cyan}Type:${colors.reset} ${partial.type}\r\n` +
                `  ${colors.cyan}Coordinates:${colors.reset} ${partial.x}, ${partial.y}\r\n` +
                `  ${colors.cyan}Area:${colors.reset} ${partial.area}\r\n` +
                `  ${colors.cyan}Tags:${colors.reset} ${partial.tags || 'none'}\r\n` +
                `  ${colors.cyan}Description:${colors.reset} ${partial.description || 'none'}\r\n` +
                `  ${colors.grey}uid: ${partial.uid || 'none'}${colors.reset}`;
        }

        if (subcommand === 'areas') {
            const commandArgs = args.slice(1);
            const query = stripCliOptions(commandArgs).join(' ').trim();
            const paging = parsePaging(commandArgs, { limit: 25, maxLimit: 200 });
            const rows = filterRows(getAreaRows(logic), commandArgs, query);
            const pageRows = paginateRows(rows, paging);
            if (hasCliFlag(commandArgs, '--json')) {
                return JSON.stringify({ query, page: paging.page, limit: paging.limit, total: rows.length, areas: pageRows }, null, 2);
            }
            if (pageRows.length === 0) return `${colors.grey}No areas found on page ${paging.page}.${colors.reset}`;
            return `\r\n${colors.bright}World Areas${colors.reset}\r\n` + formatAreaRows(pageRows, rows.length, paging, colors);
        }

        if (['prompt', 'simulate', 'sim'].includes(subcommand)) {
            return await runLocationPromptSimulation(args.slice(1), tools, logic, context, colors);
        }

        if (['route', 'routes', 'path'].includes(subcommand)) {
            return await runLocationRouteAnalysis(args.slice(1), logic, context, colors);
        }

        return `${colors.yellow}Unknown subcommand "${subcommand}". Use /location help.${colors.reset}`;
    }
};

module.exports = {
    id: 'world_location_tracker',
    name: 'World Location Tracker',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'World',
    wizard: {
        include: true,
        order: 530,
        group: 'World',
        label: 'World Location Tracker',
        recommended_enabled: true,
        author_note: 'Recommended for travel-heavy stories or any campaign with meaningful places.',
        enabled_note: 'Tracks party movement, location anchors, travel time, and relevant places.',
        disabled_note: 'Location continuity becomes looser and travel context is less structured.',
        settings_note: 'Tune location model, travel assumptions, and relevance limits in plugin settings.'
    },
    description: 'Tracks party movement across a world map, calculating travel times and distances between narrative sub-locations and anchor nodes.',
    optionalDependencies: [
        { id: 'vn_hud', reason: 'Displays location, travel, and map information in the VN interface.' },
        { id: 'character_sheets', reason: 'Adds structured character context to movement and location history.' },
        { id: 'personality_tracker', reason: 'Lets travel and location events reflect tracked character tendencies.' },
        { id: 'relationship_tracker', reason: 'Lets location context account for relationship-driven travel or group tension.' },
        { id: 'memory_recall', reason: 'Preserves places and travel history for long-term recall.' }
    ],

    settingsSchema: {

        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Tracks where you are in the world. Manages travel times and distances between different regions.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Maintains a spatial database of the story world. It calculates relative distances using a "Narrative Anchor" system, ensuring that if you travel from the Forest to the City, the engine knows how much time passes and what environmental transitions should occur.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'Medium',
            cost: 'Medium',
            latency: 'Medium'
        },
        model_def: {
            type: 'select',
            label: 'Location Model',
            description: 'Model used for all World Location Tracker LLM work, including movement analysis, destination grounding, initialization, and complex route selection.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        },
        relevant_location_limit: {
            type: 'number',
            label: 'Relevant Characters Location Limit',
            description: 'The maximum number of characters to show in the prompt location synthesis.',
            default: 15
        },
        story_mentioned_location_recent_chapters: {
            type: 'number',
            label: 'Story-Mentioned Location Chapter Window',
            description: 'Number of recent previous chapters searched for mapped location names to add to the location prompt.',
            default: 6
        },
        story_mentioned_location_limit: {
            type: 'number',
            label: 'Story-Mentioned Location Limit',
            description: 'Maximum mapped locations mentioned in recent prose or active ledgers to add to the location prompt.',
            default: 8
        },
        hud_minimap_shape: {
            type: 'select',
            label: 'HUD Minimap Shape',
            description: 'Choose the compact minimap frame style in the VN viewer HUD.',
            options: [
                { label: 'Circle', description: 'Circular minimap frame.' },
                { label: 'Square', description: 'Rounded-square minimap frame.' }
            ],
            default: 'Circle'
        },
        distance_unit: {
            type: 'select',
            label: 'Distance Unit',
            description: 'Choose how World Location Tracker displays distances in the GUI and newly generated guidance. Internal map calculations remain metric.',
            options: [
                { value: 'kilometres', label: 'Kilometres (km)' },
                { value: 'miles', label: 'Miles (mi)' }
            ],
            default: 'kilometres'
        },
        PATHFINDING_SECTION: {
            type: 'description',
            content: 'Pathfinding'
        },
        auto_navigation_planning_enabled: {
            type: 'checkbox',
            label: 'Enable Auto-Navigation Planning',
            description: 'Detect immediate travel intent, plan useful routes, and provide coordinate-free guidance to Director and Writer. Narrated movement remains the only thing that advances the party pin.',
            default: true
        },
        simple_route_max_map_span_percent: {
            type: 'number',
            label: 'Simple Route Max Map Span (%)',
            description: 'Maximum relative map span for safe straight-corridor guidance that skips A* and the route-planning LLM.',
            default: 5,
            min: 1,
            max: 25
        },
        pathfinding_max_wild_stretch_km: {
            type: 'number',
            label: 'Max Wild Stretch Without POI Stop',
            description: 'Route analysis will try to avoid traveling farther than this without a mapped POI/rest point. This value uses the selected Distance Unit.',
            default: 100
        },
        travel_animation_enabled: {
            type: 'checkbox',
            label: 'Enable Travel Takeover Animation',
            description: 'Show a world-map travel takeover between significant location changes.',
            default: true
        },
        travel_min_distance_km: {
            type: 'number',
            label: 'Travel Animation Min Distance',
            description: 'Minimum travel distance required to trigger the takeover animation. This value uses the selected Distance Unit.',
            default: 25
        },
        travel_max_party_sprites: {
            type: 'number',
            label: 'Travel Animation Max Party Sprites',
            description: 'Maximum number of party sprites shown in the travel chain animation.',
            default: 5
        },
        travel_arrival_hold_ms: {
            type: 'number',
            label: 'Travel Arrival Manual Dismiss Delay (ms)',
            description: 'Minimum time to keep the destination view visible after arrival before dialogue navigation dismisses it.',
            default: 1200
        }
    },
    timelineProviders: [
        {
            type: 'card',
            side: 'left',
            fn: async (turnContext, tools) => {
                const providerStartedAt = Date.now();
                const historicalContext = await resolveTimelineProviderContext(turnContext, tools);
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(historicalContext);
                if (!status.active) return null;
                // We pass the historical turnContext. getCurrentLocation will gracefully fallback
                // to DB query: WHERE turn_number <= turnContext.turnNumber if memory state is absent.
                const locationStartedAt = Date.now();
                const locState = await logic.getCurrentLocation(historicalContext);
                const locationMs = Date.now() - locationStartedAt;

                if (!locState) return null;
                const totalMs = Date.now() - providerStartedAt;
                if (totalMs >= 50) {
                    tools.logger.log('TimelineDiag', `WLT Party Location turn=${turnContext.turnNumber} creation=${historicalContext.creationTurnNumber || ''} inflated=${historicalContext !== turnContext} total=${totalMs}ms location=${locationMs}ms name="${locState.name || ''}" anchor="${locState.anchor || locState.anchor_node || ''}"`);
                }

                const fields = [];
                if (locState.name) fields.push({ label: 'Location', value: locState.name });
                if (locState.anchor && locState.anchor !== locState.name) {
                    fields.push({ label: 'Region', value: locState.anchor });
                }

                if (fields.length === 0) return null;

                return {
                    icon: '📍',
                    title: 'Party Location',
                    fields
                };
            }
        },
        {
            type: 'card',
            side: 'right',
            fn: async (turnContext, tools) => {
                const providerStartedAt = Date.now();
                const historicalContext = await resolveTimelineProviderContext(turnContext, tools);
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(historicalContext);
                if (!status.active) return null;
                const locationStartedAt = Date.now();
                const locState = await logic.getCurrentLocation(historicalContext);
                const locationMs = Date.now() - locationStartedAt;

                if (!locState) return null;

                const bundleStartedAt = Date.now();
                const bundle = await logic.getMapBundle(historicalContext, {
                    timelinePreview: true,
                    currentLocation: locState
                });
                const bundleMs = Date.now() - bundleStartedAt;
                const totalMs = Date.now() - providerStartedAt;
                if (totalMs >= 50) {
                    tools.logger.log('TimelineDiag', `WLT Strategic Map turn=${turnContext.turnNumber} creation=${historicalContext.creationTurnNumber || ''} inflated=${historicalContext !== turnContext} total=${totalMs}ms location=${locationMs}ms bundle=${bundleMs}ms name="${bundle.currentLocation?.name || locState.name || ''}" anchor="${bundle.currentLocation?.anchor || bundle.currentLocation?.anchor_node || locState.anchor || ''}" timelineEvents=${Array.isArray(bundle.locationTimeline) ? bundle.locationTimeline.length : 0} nodes=${bundle.worldData?.nodes?.length || 0} tiled=${!!bundle.isTiled}`);
                }
                const underground = locState.underground_status || 'Above Ground';

                return {
                    icon: '🗺️',
                    title: 'Strategic Map',
                    // Pass the bundle so the frontend JS can use it to init Leaflet
                    mapBundle: bundle,
                    html: `
                        <div class="minimap-preview-container" id="minimap-turn-${turnContext.turnNumber}">
                            <div class="minimap-location-badge">${underground}</div>
                            <div class="minimap-leaflet-mount"></div>
                        </div>
                    `
                };
            }
        }
    ],
    terminalCommands: {
        '/location': locationTerminalCommand
    },
    hooks: {
        'HOOK_SYSTEM_BOOT': {
            priority: 5,
            run: async (_turnContext, tools) => {
                tools.project.registerFileMode('world_map', {
                    label: 'World Map',
                    description: 'Editable world map package managed by the World Location Tracker.',
                    color: '#f4f1e8',
                    backgroundColor: '#2b6777',
                    customEditor: true,
                    package: {
                        extension: '.world',
                        manifestFile: 'world.json'
                    },
                    conversion: {
                        targetType: 'package',
                        targetExtension: '.world',
                        title: 'Convert to World Map',
                        message: 'Convert this markdown file into a World Map package? This will delete the current text file and replace it with a .world folder containing editable map data.'
                    }
                });
            }
        },
        'HOOK_FILE_CONVERTED': {
            priority: 20,
            run: async (turnContext, tools, { pluginId, mode, newPath, conversionType }) => {
                if (pluginId !== 'world_location_tracker' || mode !== 'world_map' || conversionType !== 'package') return;

                const logic = new Logic(tools);
                const worldJsonPath = path.join(newPath, 'world.json');
                await fs.mkdir(newPath, { recursive: true });
                await fs.writeFile(worldJsonPath, JSON.stringify(logic.createDefaultWorldData(), null, 4), 'utf8');
            }
        },
        'HOOK_DIRECTOR_PRE_PROMPT': {
            priority: 35,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(turnContext);
                if (!status.active) {
                    tools.logger.runtime(`[WorldLocationTracker] Director hook dormant: ${status.reason}`);
                    return;
                }

                await logic.activatePendingManualOrder(turnContext);

                const movementPolicy = await logic.getManualMovementPolicy();
                if (movementPolicy.manual_movement_only) {
                    const movementConstraint = await logic.buildMovementConstraintPrompt(turnContext);
                    tools.director.cot.add({
                        id: 'world_location_tracker.manual_movement_only',
                        step: '13.6',
                        title: 'Manual Movement Only is enabled',
                        content: movementConstraint
                    });
                }

                tools.director.cot.add({
                    id: 'world_location_tracker.route_intent',
                    step: '13.7',
                    title: 'World Location Tracker plugin is enabled',
                    content: 'A plugin is enabled that has physical knowledge about the world. When going through long journeys, if we show intent to go somewhere and resolve the chapter without immediately setting off, then the plugin can help at the start of next turn, by explaining the physical route, obstacles, biomes, towns, etc before setting off, allowing for a more immersive non-instant journey.'
                });

                tools.director.cot.add({
                    id: 'world_location_tracker.route_intent',
                    step: '13.7A',
                    title: 'Route Intent vs Current Location',
                    content: 'When map/location data is available, separate exact current location from long-term route intent, keeping track of both in the ledger at all times. If the party is stopped at a waypoint, decide whether it is a temporary stop on a known route or a true narrative redirection. Treat observed location data as grounding, and use the Director ledger for durable journey intent.'
                });

                const biomeNavigationStatus = logic.isAutoNavigationPlanningEnabled()
                    ? await logic.getBiomeNavigationStatus()
                    : { enabled: false };
                if (biomeNavigationStatus.enabled) {
                    tools.director.cot.add({
                        id: 'world_location_tracker.defer_new_long_journey',
                        step: '13.7B',
                        title: 'Stage Newly Declared Long Journeys',
                        content: 'World Location Tracker pathfinding is active. If this turn newly establishes intent for a long journey and no accepted navigation guidance exists yet, do not invent or immediately resolve the detailed route, terrain sequence, crossings, stopovers, or full arrival. In the WRITER_BRIEF, guide the Writer to establish the decision, preparations, local errands, or initial departure instead. After this chapter, the tracker will analyze the confirmed intent and provide grounded route assistance for the next turn. This does not delay ordinary local movement, an already planned journey, or an explicit user request to skip or resolve the travel immediately.'
                    });
                } else if (logic.isAutoNavigationPlanningEnabled()) {
                    const coverage = biomeNavigationStatus.coverage;
                    const painted = Number(coverage?.painted);
                    tools.logger.runtime(`[WorldLocationTracker] Director pathfinding staging is dormant because biome navigation is unavailable${Number.isFinite(painted) ? ` (${(painted * 100).toFixed(2)}% painted; 25% required)` : ''}.`);
                }

                turnContext.runtime = turnContext.runtime || {};
                turnContext.runtime.worldLocationTracker = turnContext.runtime.worldLocationTracker || {};
                turnContext.runtime.worldLocationTracker.directorLocation = '';
                try {
                    const directorLocation = await tools.director.ledger.read({
                        prefix: 'WL',
                        maxChars: 2000
                    });
                    turnContext.runtime.worldLocationTracker.directorLocation = directorLocation;
                } catch (error) {
                    tools.logger.warn('Director', `Could not read Director location context: ${error.message}`);
                }
            }
        },

        'HOOK_FRONTEND_INJECTION': {
            priority: 25,
            mode: 'parallel',
            run: async (context, tools) => {
                try {
                    const htmlPath = path.join(__dirname, 'ui.html');
                    const cssPath = path.join(__dirname, 'ui.css');
                    const jsPath = path.join(__dirname, 'ui_hud.js'); // Use HUD-specific script

                    let [html, css, js] = await Promise.all([
                        fs.readFile(htmlPath, 'utf8'),
                        fs.readFile(cssPath, 'utf8'),
                        fs.readFile(jsPath, 'utf8')
                    ]);

                    return { id: 'world_location_tracker', html, css, js };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read frontend injection files for world_location_tracker HUD:', error);
                    return null;
                }
            }
        },
        'HOOK_FRONTEND_TIMELINE_INJECTION': {
            priority: 25,
            mode: 'parallel',
            run: async (context, tools) => {
                try {
                    const cssPath = path.join(__dirname, 'ui.css');
                    const jsPath = path.join(__dirname, 'ui_timeline.js'); // Use Timeline-specific script

                    let [css, js] = await Promise.all([
                        fs.readFile(cssPath, 'utf8'),
                        fs.readFile(jsPath, 'utf8')
                    ]);

                    // Timeline doesn't need the ui.html (the tab/container),
                    // as it uses the renderer_timeline's own card structure.
                    return { pluginId: 'world_location_tracker', id: 'world_location_tracker', css, js };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read frontend injection files for world_location_tracker Timeline:', error);
                    return null;
                }
            }
        },
        'HOOK_CHAT_DB_INITIALIZED': {
            priority: 10,
            mode: 'background',
            run: async (context, tools) => {
                tools.socket.emit('vn-location-force-refresh');
            }
        },
        'HOOK_VN_PIPELINE_TASKS': {
            priority: 50,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(turnContext);
                if (!status.active) {
                    tools.logger.runtime(`[WorldLocationTracker] VN pipeline dormant: ${status.reason}`);
                    return null;
                }

                return {
                    key: 'worldLocationTimeline',
                    blocking: true,
                    after: ['finalBackground'],
                    fn: async () => {
                        tools.logger.log('VNPipeline', 'World Location Tracker blocking analysis starting...', 'start');
                        try {
                            await logic.updateLocation(turnContext);
                            tools.logger.log('VNPipeline', 'World Location Tracker blocking analysis complete.', 'end');
                        } catch (error) {
                            tools.logger.error('VNPipeline', `World Location Tracker timeline task failed: ${error.message}`);
                            tools.logger.log('VNPipeline', `Failed: ${error.message}`, 'end');
                        }
                    }
                };
            }
        },
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 50,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                tools.logger.log('Background', 'World Location Tracker background tasks starting...', 'start');
                try {
                    const logic = new Logic(tools);

                    // 1. Check/Trigger Tiling proactively (if needed)
                    await logic.loadWorldData(turnContext);
                    const status = logic.getLoadedOperationalStatus();
                    if (!status.active) {
                        tools.logger.runtime(`[WorldLocationTracker] Background tasks dormant: ${status.reason}`);
                        tools.socket.emit('vn-location-map-ready');
                        tools.logger.log('Background', 'World Location Tracker dormant (no map).', 'end');
                        return;
                    }

                    // Signal the frontend that the map is ready (tiling finished, location established)
                    tools.logger.runtime('Emitting vn-location-map-ready to frontend.');
                    tools.socket.emit('vn-location-map-ready');

                    const refined = await logic.completePendingNavigation(turnContext);
                    if (refined) {
                        tools.logger.runtime('Emitting vn-location-force-refresh after background navigation refinement.');
                        tools.socket.emit('vn-location-force-refresh');
                    }
                    tools.logger.log('Background', 'World Location Tracker background tasks complete.', 'end');
                } catch (error) {
                    tools.logger.error('Background', `Error in world_location_tracker background tasks: ${error.message}`);
                    tools.logger.log('Background', `Failed: ${error.message}`, 'end');
                }
            }
        },
        'HOOK_POST_VN_GENERATION': {
            priority: 55,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                try {
                    const logic = new Logic(tools);
                    const status = await logic.getOperationalStatus(turnContext);
                    if (!status.active) {
                        tools.logger.runtime(`[WorldLocationTracker] Travel intercepts dormant: ${status.reason}`);
                        return;
                    }
                    const travelPayloads = await logic.buildTravelInterceptPayloads(turnContext);
                    if (!Array.isArray(travelPayloads) || travelPayloads.length === 0) return;

                    travelPayloads
                        .sort((left, right) => (left.line || 0) - (right.line || 0))
                        .forEach((entry, index) => {
                            const interceptId = `travel_route_${turnContext.turnNumber || 0}_${entry.line}_${index}`;
                            const descriptor = {
                                interceptId,
                                debugLabel: 'WorldTravelIntercept',
                                line: entry.line,
                                travelLine: entry.line,
                                travelSegmentIndex: entry.index,
                                checkpoint: entry.checkpoint || (entry.line === 0 ? 'before_first_dialogue' : 'on_dialogue_enter'),
                                blocking: true,
                                renderer: 'pixi',
                                replayPolicy: 'every_enter',
                                priority: 45 + index,
                                autoDismiss: false,
                                keepVNViewportDuringTakeover: true,
                                visualState: {
                                    keepVNViewportDuringTakeover: true
                                },
                                timeoutMs: 45000,
                                preserveOnDialogueEnter: true,
                                payload: {
                                    line: entry.line,
                                    travelLine: entry.line,
                                    segmentIndex: entry.index,
                                    travelSegmentIndex: entry.index
                                }
                            };
                            if (Number.isInteger(entry.dialogueIndex) && entry.dialogueIndex > 0) {
                                descriptor.dialogueIndex = entry.dialogueIndex;
                            }
                            tools.gui.registerPersistentIntercept(descriptor);
                            tools.logger.runtime(`[WorldTravelIntercept] Registered descriptor ${interceptId}: checkpoint=${descriptor.checkpoint}, line=${descriptor.line}, dialogueIndex=${descriptor.dialogueIndex ?? 'none'}, segment=${descriptor.travelSegmentIndex}`);
                        });

                    tools.logger.runtime(`Registered ${travelPayloads.length} world travel intercept(s).`);
                } catch (error) {
                    tools.logger.error('WorldTravelIntercept', `Failed to register travel intercepts: ${error.message}`);
                }
            }
        },
        'HOOK_VN_EMIT_TURN': {
            priority: 45,
            run: async (turnContext, tools) => {
                const intercepts = Array.isArray(turnContext?.output?.guiIntercepts)
                    ? turnContext.output.guiIntercepts
                    : [];
                let normalizedCount = 0;
                turnContext.output.guiIntercepts = intercepts.map((descriptor) => {
                    if (!isTravelRouteInterceptDescriptor(descriptor)) return descriptor;
                    normalizedCount += 1;
                    return normalizeTravelRouteInterceptDescriptor(descriptor);
                });
                if (normalizedCount > 0) {
                    tools.logger.runtime(`Normalized ${normalizedCount} world travel intercept(s) for PIXI takeover playback.`);
                }
                const activation = turnContext?.runtime?.worldLocationTracker?.manualOrderActivation;
                if (activation?.order) {
                    const logic = new Logic(tools);
                    await logic.appendManualOrderFact(turnContext, activation.order, 'user_map_order_finalized_on_emit');
                    tools.logger.runtime(`[WorldLocationTracker] Finalized ${activation.order.mode} user travel order after successful turn emission.`);
                }
                const directiveId = turnContext?.runtime?.worldLocationTracker?.injectedTimeskipDirectiveId;
                if (directiveId) {
                    const logic = new Logic(tools);
                    await logic.markTimeskipDirectiveConsumed(turnContext, directiveId);
                    tools.logger.runtime('[WorldLocationTracker] Manual timeskip directive consumed after successful turn emission.');
                }
            }
        },
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 40, // Runs AFTER character_sheets (priority 30)
            mode: 'parallel',
            eta: { default: { min: 5000, max: 15000 } },
            run: async (turnContext, tools) => {
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(turnContext);
                if (!status.active) {
                    tools.logger.runtime(`[WorldLocationTracker] Prompt hook dormant: ${status.reason}`);
                    return;
                }

                await logic.activatePendingManualOrder(turnContext);

                tools.logger.log('Prompt', 'World Location Tracker prompt building starting...', 'start');
                tools.logger.runtime(`Turn Number: ${turnContext.turnNumber}`);
                await tools.jobs.withJob('Processing world map and location...', {
                    id: 'world_location_prompt_build',
                    scope: 'turn',
                    rethrow: false,
                    notifyOnComplete: false
                }, async (job) => {
                    try {
                        job.progress(10, 'Loading world map data...');

                        // 1. Ensure world data is loaded
                        await logic.loadWorldData(turnContext);

                        // 2. Establishing location state for the prompt.
                        // We rely on the Background Tasks from the PREVIOUS turn to have 
                        // populated the 'location_change' facts.
                        if (turnContext.turnNumber === 1) {
                            await logic.initializeLocation(turnContext);
                            tools.logger.runtime('Turn 1 detected. Initial position established from Intro/Canon before story generation.');
                        } else {
                            tools.logger.runtime(`Turn ${turnContext.turnNumber} detected. Using location established by previous turn's background task.`);
                        }

                        job.progress(45, 'Building current location bundle...');
                        const bundle = await logic.getMapBundle(turnContext);

                        if (bundle && bundle.currentLocation) {
                            const limit = (tools.settings && tools.settings.get) ? (tools.settings.get('world_location_tracker.relevant_location_limit') || 15) : 15;
                            const locationInjectedText = await logic.buildLocationPromptText(turnContext, bundle.currentLocation, {
                                includeCharacters: true,
                                relevantLimit: limit
                            });

                            // Build one ordered plugin record: prior decisions first, current state second.
                            const wrappedLocation = tools.prompt.wrap('current_location', locationInjectedText);
                            const currentStateParts = [wrappedLocation];

                            const movementConstraint = await logic.buildMovementConstraintPrompt(turnContext);
                            if (movementConstraint) {
                                const wrappedConstraint = tools.prompt.wrap('manual_movement_only', movementConstraint);
                                currentStateParts.push(wrappedConstraint);
                                tools.prompt.inject('directives', wrappedConstraint, 'writer', { directable: true });
                                tools.logger.runtime('Injected Manual Movement Only constraint for Director/Writer continuity.');
                            }

                            const navigationText = await logic.buildNavigationAssistancePrompt(turnContext);
                            if (navigationText) {
                                const wrappedNavigation = tools.prompt.wrap('active_navigation', navigationText);
                                currentStateParts.push(wrappedNavigation);
                            }

                            const directorPluginFeedbackEnabled = tools.settings.get('narrative_agents.director.direct_plugins_enabled') !== false;
                            const pluginPromptParts = [];
                            if (directorPluginFeedbackEnabled) {
                                const previousTurnUpdate = await logic.buildPreviousTurnUpdatePrompt(turnContext);
                                pluginPromptParts.push(tools.prompt.wrap('previous_turn_update', previousTurnUpdate || 'No previous turn update is available.'));
                            }
                            pluginPromptParts.push(tools.prompt.wrap('current_state', currentStateParts.join('\n\n')));
                            const pluginPrompt = pluginPromptParts.join('\n\n');
                            tools.logger.runtime('Injecting ordered location update and current state into [simulation] slot.');
                            tools.prompt.inject('simulation', pluginPrompt, 'root', { directable: true });

                            const pendingTimeskip = await logic.getPendingTimeskipDirective(turnContext);
                            if (pendingTimeskip?.text) {
                                turnContext.runtime = turnContext.runtime || {};
                                turnContext.runtime.worldLocationTracker = turnContext.runtime.worldLocationTracker || {};
                                const runtime = turnContext.runtime.worldLocationTracker;
                                if (runtime.injectedTimeskipDirectiveId !== pendingTimeskip.id) {
                                    const currentPrompt = String(turnContext.input?.userPrompt || '');
                                    if (!currentPrompt.startsWith(pendingTimeskip.text)) {
                                        turnContext.input = turnContext.input || {};
                                        turnContext.input.userPrompt = `${pendingTimeskip.text}\n\n${currentPrompt}`;
                                    }
                                    runtime.injectedTimeskipDirectiveId = pendingTimeskip.id;
                                    tools.logger.runtime('[WorldLocationTracker] Prepended pending user-authorized timeskip directive.');
                                }
                            }

                            tools.logger.log('Prompt', 'Successfully injected location data and nearby characters into simulation slot.', 'end');
                        } else {
                            tools.logger.warn('Prompt', 'Could not establish current location for prompt injection.');
                            tools.logger.log('Prompt', 'Finished (No location established)', 'end');
                        }

                        // --- INJECT TIMELINE ROUTING FOR PAST CHAPTERS ---
                        try {
                            job.progress(75, 'Updating timeline location routing...');
                            const locRows = await tools.db.chat.query(
                                `SELECT turn_number, fact_value as location_name 
                                 FROM facts 
                                 WHERE project_name = ? 
                                   AND predicate = 'location_change' 
                                   AND turn_number <= ? 
                                 ORDER BY turn_number ASC, id ASC`,
                                [turnContext.projectName.toLowerCase(), turnContext.turnNumber]
                            );

                            if (!turnContext.runtime.timelineRouting) {
                                turnContext.runtime.timelineRouting = { pre: {}, post: {} };
                            }

                            let lastKnownLocation = "Unknown Location";
                            const locAtTurn = {};

                            for (const row of locRows) {
                                locAtTurn[row.turn_number] = row.location_name;
                            }

                            for (let i = 1; i <= turnContext.turnNumber; i++) {
                                if (locAtTurn[i]) {
                                    lastKnownLocation = locAtTurn[i];
                                }
                                const existingPre = turnContext.runtime.timelineRouting.pre[i] || '';
                                const prefix = existingPre ? `${existingPre} | ` : '';
                                turnContext.runtime.timelineRouting.pre[i] = `${prefix}${lastKnownLocation}`;
                            }
                        } catch (locErr) {
                            tools.logger.error('LocationRouting', `Failed to inject timeline location: ${locErr.message}`);
                        }
                        // --- END TIMELINE ROUTING INJECTION ---
                        job.progress(100, 'World map and location context ready.');
                    } catch (error) {
                        tools.logger.error('Prompt', `Failed to process location data: ${error.message}`);
                        tools.logger.log('Prompt', `Failed: ${error.message}`, 'end');
                        throw error;
                    }
                });
            }
        }
    },
    exports: {
        getOperationalStatus: async (context, tools) => {
            const logic = new Logic(tools);
            return await logic.getOperationalStatus(context);
        },
        guiIntercepts: {
            default: async (context, tools, descriptor) => {
                try {
                    return await buildTravelTakeoverUi(context, tools, descriptor);
                } catch (error) {
                    tools.logger.error('WorldTravelIntercept', `Failed to load travel takeover UI payload: ${error.message}`);
                    return null;
                }
            },
            travel_route: async (context, tools, descriptor) => {
                try {
                    return await buildTravelTakeoverUi(context, tools, descriptor);
                } catch (error) {
                    tools.logger.error('WorldTravelIntercept', `Failed to load travel takeover UI payload: ${error.message}`);
                    return null;
                }
            }
        },
        getCharacterLocation: async (context, tools, charName, options = {}) => {
            const turnNumber = options.turnNumber || context.turnNumber;
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return null;
            return await logic.getCharacterLocation(charName, turnNumber, context);
        },
        getCurrentLocation: async (context, tools, options = {}) => {
            const logic = new Logic(tools);
            const requestContext = options.context || context;
            const status = await logic.getOperationalStatus(requestContext);
            if (!status.active) return null;
            const currentLocation = await logic.getCurrentLocation(requestContext);
            const dialogueIndex = logic.normalizeDialogueIndex(options.dialogueIndex);
            if (!Number.isInteger(dialogueIndex)) return currentLocation;

            const timeline = await logic.getLocationTimelineForTurn(requestContext);
            const activeEntry = logic.getActiveLocationTimelineEntry(timeline, dialogueIndex);
            if (!activeEntry) return currentLocation;
            return await logic.enrichCoordinateState(
                logic.buildLocationStateFromEvent(activeEntry, currentLocation || null)
            );
        },
        calculateTravel: async (context, tools, origin, destination, transportType = 'walk') => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return null;
            return logic.calculateTravel(origin || {}, destination || {}, transportType);
        },
        getWorldMapSummary: async (context, tools, options = {}) => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return null;
            return logic.getWorldMapSummary(options);
        },
        getAllCharacterLocations: async (context, tools) => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return [];
            return await logic.getAllCharacterLocations(context);
        },
        upsertCharacterLocation: async (context, tools, update, options = {}) => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return { saved: false, reason: 'tracker_inactive' };
            return await logic.upsertCharacterLocation(context, update, options);
        },
        bootstrapCharacterLocations: async (context, tools, characters, loreContext) => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return null;
            return await logic.bootstrapCharacterLocations(characters, loreContext, context);
        },
        isNewAnchorNode: async (context, tools, anchorName) => {
            const logic = new Logic(tools);
            const status = await logic.getOperationalStatus(context);
            if (!status.active) return false;
            return await logic.isNewAnchorNode(anchorName, context.turnNumber, context.projectName);
        },
        provideFileView: async (turnContext, tools, { filePath }) => {
            const root = turnContext?.rootDirectory || tools.turnContext?.rootDirectory || '';
            if (!filePath || !filePath.toLowerCase().endsWith('.world') || !isPathInsideRoot(filePath, root)) {
                throw new Error('World Map editor can only open package paths inside the current project.');
            }

            const logic = new Logic(tools);
            await fs.mkdir(filePath, { recursive: true });

            const worldJsonPath = path.join(filePath, 'world.json');
            try {
                await fs.access(worldJsonPath);
            } catch {
                await fs.writeFile(worldJsonPath, JSON.stringify(logic.createDefaultWorldData(), null, 4), 'utf8');
            }

            const pkg = await logic.loadWorldPackage(filePath, turnContext);
            const dimensions = (pkg.worldData?.meta?.dimensions?.width > 0) 
                ? pkg.worldData.meta.dimensions 
                : (pkg.imagePath ? await logic.getImageDimensions(pkg.imagePath) : { width: 0, height: 0 });
            
            const tilePath = pkg.isCompiled ? pkg.tilesPath : (pkg.imagePath ? await logic.processMapTiling(turnContext, pkg.imagePath, filePath) : null);
            const tileUrlRaw = tilePath ? logic.getProjectStaticTileTemplate(tilePath, turnContext) : null;
            const tileUrl = tileUrlRaw ? `${tileUrlRaw}?v=${Date.now()}` : null;
            let biomeMaskUrl = pkg.biomeMaskUrl ? `${pkg.biomeMaskUrl}?v=${Date.now()}` : '';
            if (pkg.biomeMaskPath) {
                try {
                    const maskBuffer = await fs.readFile(pkg.biomeMaskPath);
                    biomeMaskUrl = `data:image/png;base64,${maskBuffer.toString('base64')}`;
                } catch { }
            }
            const html = await fs.readFile(path.join(__dirname, 'editor.html'), 'utf8');
            const css = await fs.readFile(path.join(__dirname, 'editor.css'), 'utf8');
            const js = await fs.readFile(path.join(__dirname, 'editor.js'), 'utf8');

            const finalJs = js
                .replace('__WORLD_PACKAGE_PATH__', JSON.stringify(filePath))
                .replace('__INITIAL_WORLD_DATA__', JSON.stringify(pkg.worldData))
                .replace('__INITIAL_IMAGE_URL__', JSON.stringify(pkg.imageUrl || ''))
                .replace('__INITIAL_IMAGE_FILE__', JSON.stringify(pkg.imageFile || ''))
                .replace('__INITIAL_IS_TILED__', JSON.stringify(!!tileUrl))
                .replace('__INITIAL_TILE_URL__', JSON.stringify(tileUrl || ''))
                .replace('__INITIAL_DIMENSIONS__', JSON.stringify(dimensions))
                .replace('__INITIAL_BIOME_MASK_URL__', JSON.stringify(biomeMaskUrl));

            return {
                type: 'html',
                content: `
<style>${css}</style>
${html}
<script>${finalJs}</script>
                `
            };
        }
    },
    socketListeners: {
        'vn-location-fetch-data': async (data, tools) => {
            try {
                const liveContext = tools.turnContext;
                let context = liveContext;

                // If a specific turnNumber is requested (e.g. from history navigation), resolve its context
                if (data && data.turnNumber
                    && Number(data.turnNumber) !== Number(liveContext?.turnNumber || 0)) {
                    const historicalTurn = await tools.turns.get(data.turnNumber);
                    if (historicalTurn?.context) {
                        context = historicalTurn.context;
                    }
                }

                const logic = new Logic(tools);
                const dialogueIndex = Number.isFinite(Number(data?.dialogueIndex))
                    ? Math.max(0, Math.round(Number(data.dialogueIndex)))
                    : null;
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(context) - 1);
                const isLiveTurn = Number(context?.turnNumber || 0) === Number(liveContext?.turnNumber || 0);
                const controlsEnabled = isLiveTurn
                    && (!Number.isInteger(dialogueIndex) || dialogueIndex >= latestDialogueIndex);
                const bundle = await logic.getMapBundle(context, { dialogueIndex, controlsEnabled });
                const shapeRaw = (tools.settings && tools.settings.get)
                    ? tools.settings.get('world_location_tracker.hud_minimap_shape')
                    : 'Circle';
                const shape = String(shapeRaw || 'Circle').toLowerCase() === 'circle' ? 'circle' : 'square';
                bundle.hudConfig = {
                    ...(bundle.hudConfig || {}),
                    shape
                };
                tools.socket.emit('vn-location-data-bundle', bundle);
            } catch (error) {
                tools.socket.emit('vn-location-data-bundle', { error: error.message });
                tools.logger.error('Socket', `Error in vn-location-fetch-data: ${error.message}`);
            }
        },
        'vn-location-set-movement-lock': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const logic = new Logic(tools);
                const status = await logic.getOperationalStatus(tools.turnContext);
                if (!status.active) throw new Error(status.reason);
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(tools.turnContext) - 1);
                if (Number(data?.turnNumber) !== Number(tools.turnContext?.turnNumber)
                    || Number(data?.dialogueIndex) < latestDialogueIndex) {
                    throw new Error('Movement policy can be changed only from the latest dialogue of the current turn.');
                }
                const policy = await logic.setManualMovementPolicy(data?.enabled === true);
                tools.socket.emit('vn-location-set-movement-lock-response', { requestId, success: true, policy });
                tools.socket.emit('vn-location-force-refresh');
            } catch (error) {
                tools.logger.error('ManualNavigation', `Movement policy update failed: ${error.message}`);
                tools.socket.emit('vn-location-set-movement-lock-response', { requestId, success: false, error: error.message });
            }
        },
        'vn-location-preview-manual-move': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const context = tools.turnContext;
                const logic = new Logic(tools);
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(context) - 1);
                if (Number(data?.turnNumber) !== Number(context?.turnNumber)
                    || Number(data?.dialogueIndex) < latestDialogueIndex) {
                    throw new Error('Manual movement is available only on the latest dialogue of the current turn.');
                }
                const preview = await logic.previewManualDestination(context, data?.target || {});
                tools.socket.emit('vn-location-preview-manual-move-response', { requestId, success: true, ...preview });
            } catch (error) {
                tools.logger.error('ManualNavigation', `Route preview failed: ${error.message}`);
                tools.socket.emit('vn-location-preview-manual-move-response', { requestId, success: false, error: error.message });
            }
        },
        'vn-location-commit-manual-move': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const context = tools.turnContext;
                const logic = new Logic(tools);
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(context) - 1);
                if (Number(data?.turnNumber) !== Number(context?.turnNumber)
                    || Number(data?.dialogueIndex) < latestDialogueIndex) {
                    throw new Error('Manual movement is available only on the latest dialogue of the current turn.');
                }
                const result = await logic.commitManualDestination(context, data || {});
                tools.socket.emit('vn-location-commit-manual-move-response', { requestId, success: true, result });
                tools.socket.emit('vn-location-force-refresh');
            } catch (error) {
                tools.logger.error('ManualNavigation', `Route commit failed: ${error.message}`);
                tools.socket.emit('vn-location-commit-manual-move-response', { requestId, success: false, error: error.message });
            }
        },
        'vn-location-cancel-manual-move': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const logic = new Logic(tools);
                const cancelled = logic.cancelManualDestinationPreview(tools.turnContext, data?.preview_id);
                tools.socket.emit('vn-location-cancel-manual-move-response', { requestId, success: true, cancelled });
            } catch (error) {
                tools.logger.error('ManualNavigation', `Preview cancellation failed: ${error.message}`);
                tools.socket.emit('vn-location-cancel-manual-move-response', { requestId, success: false, error: error.message });
            }
        },
        'vn-location-cancel-manual-order': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const context = tools.turnContext;
                const logic = new Logic(tools);
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(context) - 1);
                if (Number(data?.turnNumber) !== Number(context?.turnNumber)
                    || Number(data?.dialogueIndex) < latestDialogueIndex) {
                    throw new Error('A manual journey can be cancelled only from the latest dialogue of the current turn.');
                }
                const result = await logic.cancelManualNavigationOrder(context);
                tools.socket.emit('vn-location-cancel-manual-order-response', { requestId, success: true, result });
                tools.socket.emit('vn-location-force-refresh');
            } catch (error) {
                tools.logger.error('ManualNavigation', `Journey cancellation failed: ${error.message}`);
                tools.socket.emit('vn-location-cancel-manual-order-response', { requestId, success: false, error: error.message });
            }
        },
        'vn-location-undo-instant-arrival': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const context = tools.turnContext;
                const logic = new Logic(tools);
                const latestDialogueIndex = Math.max(0, logic.getProcessedLineCount(context) - 1);
                if (Number(data?.turnNumber) !== Number(context?.turnNumber)
                    || Number(data?.dialogueIndex) < latestDialogueIndex) {
                    throw new Error('Instant arrival can be undone only from the latest dialogue of the current turn.');
                }
                const result = await logic.undoManualInstantArrival(context);
                tools.socket.emit('vn-location-undo-instant-arrival-response', { requestId, success: true, result });
                tools.socket.emit('vn-location-force-refresh');
            } catch (error) {
                tools.logger.error('ManualNavigation', `Instant arrival undo failed: ${error.message}`);
                tools.socket.emit('vn-location-undo-instant-arrival-response', { requestId, success: false, error: error.message });
            }
        },
        'world-map-save-package': async (data, tools) => {
            try {
                const packagePath = path.resolve(data.packagePath || '');
                const root = tools.turnContext?.rootDirectory || '';
                tools.logger.log('WorldMapEditor', `Save request received for ${packagePath}`);

                if (!packagePath.toLowerCase().endsWith('.world') || !isPathInsideRoot(packagePath, root)) {
                    throw new Error('Unauthorized package path.');
                }

                const logic = new Logic(tools);
                const worldData = logic.normalizeWorldData(data.worldData);
                worldData.biomes = logic.normalizeBiomes(worldData.biomes);
                worldData.biomes.mask_file = sanitizeBiomeMaskFile(worldData.biomes.mask_file);
                await fs.mkdir(packagePath, { recursive: true });

                const biomeMaskBuffer = decodeBiomeMaskDataUrl(data.biomeMaskDataUrl);
                if (biomeMaskBuffer) {
                    await fs.writeFile(path.join(packagePath, worldData.biomes.mask_file), biomeMaskBuffer);
                }

                await fs.writeFile(path.join(packagePath, 'world.json'), JSON.stringify(worldData, null, 4), 'utf8');
                tools.logger.log('WorldMapEditor', `Saved world package at ${packagePath} (${worldData.areas.length} areas, ${worldData.nodes.length} locations)`);

                tools.socket.emit('world-map-save-package-response', {
                    success: true,
                    packagePath,
                    areaCount: worldData.areas.length,
                    nodeCount: worldData.nodes.length
                });
            } catch (error) {
                tools.logger.error('WorldMapEditor', `Save failed: ${error.message}`);
                tools.socket.emit('world-map-save-package-response', {
                    success: false,
                    error: error.message
                });
            }
        },
        'world-map-upload-image': async (data, tools) => {
            try {
                const packagePath = path.resolve(data.packagePath || '');
                const root = tools.turnContext?.rootDirectory || '';
                tools.logger.log('WorldMapEditor', `Image upload request received for ${packagePath}`);

                if (!packagePath.toLowerCase().endsWith('.world') || !isPathInsideRoot(packagePath, root)) {
                    throw new Error('Unauthorized package path.');
                }

                const rawDataUrl = data.dataUrl || '';
                const match = rawDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
                if (!match) {
                    throw new Error('Invalid image payload.');
                }

                const originalExtension = path.extname(data.fileName || '').toLowerCase();
                const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
                const finalExtension = allowedExtensions.has(originalExtension) ? originalExtension : '.png';
                const targetFileName = `map${finalExtension}`;
                const targetPath = path.join(packagePath, targetFileName);
                const buffer = Buffer.from(match[2], 'base64');
                tools.logger.log('WorldMapEditor', `Decoded image payload for ${packagePath} (${buffer.length} bytes)`);

                const logic = new Logic(tools);
                const pkg = await logic.loadWorldPackage(packagePath, tools.turnContext);

                if (pkg.imagePath) {
                    tools.logger.log('WorldMapEditor', `Removing stale tiles for ${pkg.imagePath}`);
                    await logic.deleteMapTiles(tools.turnContext, pkg.imagePath);
                }

                if (pkg.imagePath && path.normalize(pkg.imagePath) !== path.normalize(targetPath)) {
                    try {
                        await fs.rm(pkg.imagePath, { force: true });
                    } catch { }
                }

                await fs.mkdir(packagePath, { recursive: true });
                await fs.writeFile(targetPath, buffer);

                const worldData = logic.normalizeWorldData(data.worldData);
                worldData.biomes = logic.normalizeBiomes(worldData.biomes);
                worldData.biomes.mask_file = sanitizeBiomeMaskFile(worldData.biomes.mask_file);
                worldData.meta.image_file = targetFileName;
                const biomeMaskBuffer = decodeBiomeMaskDataUrl(data.biomeMaskDataUrl);
                if (biomeMaskBuffer) {
                    await fs.writeFile(path.join(packagePath, worldData.biomes.mask_file), biomeMaskBuffer);
                }
                await fs.writeFile(path.join(packagePath, 'world.json'), JSON.stringify(worldData, null, 4), 'utf8');
                tools.logger.log('WorldMapEditor', `Stored image ${targetFileName} for ${packagePath}`);

                tools.logger.log('WorldMapEditor', `Generating map tiles for ${targetFileName}`);
                const tilePath = await logic.processMapTiling(tools.turnContext, targetPath, packagePath);
                const dimensions = await logic.getImageDimensions(targetPath);
                const biomeMaskDimensions = logic.getBiomeMaskDimensions(dimensions);
                worldData.meta.dimensions = dimensions;
                worldData.meta.is_compiled = !!tilePath;
                worldData.biomes.mask_width = biomeMaskDimensions.width;
                worldData.biomes.mask_height = biomeMaskDimensions.height;
                await fs.writeFile(path.join(packagePath, 'world.json'), JSON.stringify(worldData, null, 4), 'utf8');
                const tileUrlRaw = tilePath ? logic.getProjectStaticTileTemplate(tilePath, tools.turnContext) : null;
                const tileUrl = tileUrlRaw ? `${tileUrlRaw}?v=${Date.now()}` : null;

                tools.socket.emit('world-map-upload-image-response', {
                    success: true,
                    packagePath,
                    imageFile: targetFileName,
                    imageUrl: `${logic.getProjectStaticUrl(targetPath, tools.turnContext)}?v=${Date.now()}`,
                    isTiled: !!tileUrl,
                    tileUrl,
                    dimensions,
                    areaCount: worldData.areas.length,
                    nodeCount: worldData.nodes.length
                });
            } catch (error) {
                tools.logger.error('WorldMapEditor', `Image upload failed: ${error.message}`);
                tools.socket.emit('world-map-upload-image-response', {
                    success: false,
                    error: error.message
                });
            }
        },
        'world-map-simulate-travel': async (data, tools) => {
            const requestId = data?.requestId || null;
            try {
                const packagePath = path.resolve(data?.packagePath || '');
                const root = tools.turnContext?.rootDirectory || '';
                tools.logger.log('WorldMapEditor', `Travel simulation request received for ${packagePath}`);

                if (!packagePath.toLowerCase().endsWith('.world') || !isPathInsideRoot(packagePath, root)) {
                    throw new Error('Unauthorized package path.');
                }

                const originNodeUid = String(data?.originNodeUid || '').trim();
                const destinationNodeUid = String(data?.destinationNodeUid || '').trim();
                if (!originNodeUid || !destinationNodeUid) {
                    throw new Error('Origin and destination nodes are required.');
                }

                const logic = new Logic(tools);
                const worldData = logic.normalizeWorldData(data?.worldData || {});
                const simulation = logic.simulateTravelBetweenNodes(worldData, originNodeUid, destinationNodeUid, 'walk');

                tools.socket.emit('world-map-simulate-travel-response', {
                    success: true,
                    requestId,
                    packagePath,
                    originNodeUid: simulation.originNode.uid,
                    destinationNodeUid: simulation.destinationNode.uid,
                    distanceKm: simulation.travel.distanceKm,
                    days: simulation.travel.days,
                    narrativeText: simulation.travel.narrativeText
                });
            } catch (error) {
                tools.logger.error('WorldMapEditor', `Travel simulation failed: ${error.message}`);
                tools.socket.emit('world-map-simulate-travel-response', {
                    success: false,
                    requestId,
                    error: error.message
                });
            }
        }
    }
};
