const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { relativizeAssetPath, readSettings } = require('../../modules/utils.js');
const { resolveTurnStorageKey, resolveBaseTurnNumber } = require('../../modules/turn_storage_key.js');
const { formatIndexedScene } = require('../../modules/vn_manager/scene_prompt_formatter.js');
const biomeNavigation = require('./biome_navigation.js');
const navigationCopilot = require('./navigation_copilot.js');
const destinationGrounding = require('./destination_grounding.js');
const routeGeometry = require('./route_geometry.js');
const distanceUnits = require('./distance_units.js');

const TERRAIN_MODIFIERS = {
    'Road': 1.0,
    'Plains': 1.0,
    'Forest': 1.2, // 20% slower
    'Desert': 1.3, // Sand is hard to walk on
    'Mountain': 2.0, // Very slow
    'Water': 0.8 // Boats are usually faster than walking if wind is good
};

const DEFAULT_BIOME_MASK_FILE = 'biome_mask.png';
const MANUAL_MOVEMENT_SETTING_KEY = 'world_location_tracker.manual_movement_only';
const MANUAL_PREVIEW_LIMIT = 8;
const WORLD_DATA_CACHE_MAX = 8;
const worldDataCache = new Map();
const DEFAULT_BIOME_PALETTE = [
    { id: 'forest', label: 'Forest', color: '#4fb84f', needs_boat: false, slows_down: false, is_road: false, is_river: false },
    { id: 'rainforest', label: 'Rainforest', color: '#126b35', needs_boat: false, slows_down: true, is_road: false, is_river: false },
    { id: 'plains', label: 'Plains', color: '#95c95c', needs_boat: false, slows_down: false, is_road: false, is_river: false },
    { id: 'mountains', label: 'Mountains', color: '#55585d', needs_boat: false, slows_down: true, is_road: false, is_river: false },
    { id: 'desert', label: 'Desert', color: '#d8bd74', needs_boat: false, slows_down: false, is_road: false, is_river: false },
    { id: 'snowfield', label: 'Snowfield', color: '#f2f5f6', needs_boat: false, slows_down: false, is_road: false, is_river: false },
    { id: 'sea', label: 'Sea', color: '#236db5', needs_boat: true, slows_down: false, is_road: false, is_river: false },
    { id: 'river', label: 'River', color: '#61bce8', needs_boat: false, slows_down: false, is_road: false, is_river: true },
    { id: 'road', label: 'Road', color: '#b8b8b8', needs_boat: false, slows_down: false, is_road: true, is_river: false },
    { id: 'town', label: 'Town', color: '#d0d0c8', needs_boat: false, slows_down: false, is_road: false, is_river: false }
];

class LocationTrackerLogic {
    constructor(tools) {
        this.tools = tools;
        this.turnContext = tools?.turnContext;
        this.worldData = null;
        this.mapImage = null;
        this.tilePath = null;
        this.worldPackagePath = null;
        this.biomeMaskPath = null;
        this.biomeGridResultPromise = null;
        this.biomeGridResult = null;
        this.worldDataLoadAttempted = false;
        this.settings = tools?.settings?.getSelf() || {};
    }

    async getManualMovementPolicy() {
        try {
            const rows = await this.tools.db.project.query(
                'SELECT setting_value FROM project_settings WHERE setting_key = ?',
                [MANUAL_MOVEMENT_SETTING_KEY]
            );
            const raw = rows?.[0]?.setting_value;
            let enabled = false;
            if (typeof raw === 'string') {
                try {
                    const parsed = JSON.parse(raw);
                    enabled = parsed === true || parsed?.enabled === true;
                } catch {
                    enabled = raw === '1' || raw.toLowerCase() === 'true';
                }
            } else {
                enabled = raw === true || raw === 1;
            }
            return {
                manual_movement_only: enabled,
                description: 'Local movement within the current major location is allowed. Departure, map displacement, and arrival elsewhere require a user-issued map order.'
            };
        } catch (error) {
            this.tools.logger.warn('MovementPolicy', `Could not read project movement policy: ${error.message}`);
            return { manual_movement_only: false, description: '' };
        }
    }

    async setManualMovementPolicy(enabled) {
        const policy = { enabled: enabled === true, updated_at: new Date().toISOString() };
        await this.tools.db.project.execute(
            'INSERT OR REPLACE INTO project_settings (setting_key, setting_value) VALUES (?, ?)',
            [MANUAL_MOVEMENT_SETTING_KEY, JSON.stringify(policy)]
        );
        this.logDecision(`Manual Movement Only ${policy.enabled ? 'enabled' : 'disabled'} for this project.`);
        return await this.getManualMovementPolicy();
    }

    getManualPreviewStore(turnContext = null) {
        const context = turnContext || this.tools.turnContext;
        context.runtime = context.runtime || {};
        context.runtime.worldLocationTracker = context.runtime.worldLocationTracker || {};
        const runtime = context.runtime.worldLocationTracker;
        if (!(runtime.manualRoutePreviews instanceof Map)) runtime.manualRoutePreviews = new Map();
        return runtime.manualRoutePreviews;
    }

    buildWorldNavigationSignature(currentLocation = null) {
        const basis = {
            dimensions: this.worldData?.meta?.dimensions || null,
            biomes: this.worldData?.biomes || null,
            nodes: (this.worldData?.nodes || []).map(node => [node.uid, node.name, node.world_x, node.world_y]),
            position: currentLocation ? [Number(currentLocation.x).toFixed(2), Number(currentLocation.y).toFixed(2)] : null
        };
        return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex');
    }

    async buildManualValidationSignature(currentLocation = null) {
        let maskFile = null;
        if (this.biomeMaskPath) {
            try {
                const stat = await fs.stat(this.biomeMaskPath);
                maskFile = { size: stat.size, modified_ms: stat.mtimeMs };
            } catch {
                maskFile = null;
            }
        }
        return crypto.createHash('sha256').update(JSON.stringify({
            world: this.getNavigationWorldSignature(),
            mask_file: maskFile,
            position: currentLocation ? [Number(currentLocation.x).toFixed(2), Number(currentLocation.y).toFixed(2)] : null
        })).digest('hex');
    }

    getLoadedOperationalStatus() {
        const hasWorldData = !!this.worldData && Array.isArray(this.worldData.nodes);
        const hasMapAsset = !!(this.mapImage || this.tilePath);

        if (!hasWorldData) {
            return {
                active: false,
                code: 'no_world_data',
                reason: 'No world map is configured for this project.'
            };
        }

        if (!hasMapAsset) {
            return {
                active: false,
                code: 'no_map_asset',
                reason: 'The configured world map has no renderable map image or compiled tiles.'
            };
        }

        return { active: true, code: 'active', reason: '' };
    }

    async getOperationalStatus(turnContext, options = {}) {
        if (!this.worldDataLoadAttempted || options.reload) {
            await this.loadWorldData(turnContext || this.turnContext, { skipTiling: options.skipTiling !== false });
        }
        return this.getLoadedOperationalStatus();
    }

    buildInactiveMapBundle(turnContext, status, options = {}) {
        return {
            pluginActive: false,
            inactiveReason: status?.reason || 'World Location Tracker is inactive.',
            worldData: null,
            mapImage: null,
            isTiled: false,
            tileUrl: null,
            dimensions: { width: 0, height: 0 },
            activeDialogueIndex: this.normalizeDialogueIndex(options?.dialogueIndex),
            locationTimeline: [],
            currentLocation: null,
            navigation: null,
            distanceUnit: this.getDistanceUnitDefinition(),
            movementPolicy: { manual_movement_only: false, controls_enabled: false, read_only: true },
            nearbyText: '',
            guiText: '',
            characterLocations: [],
            projectName: turnContext?.projectName || this.tools.turnContext?.projectName
        };
    }

    resolveTravelScale(metaInput = null) {
        const meta = metaInput && typeof metaInput === 'object'
            ? metaInput
            : (this.worldData?.meta || {});

        const pixelsPerKm = this.toNumeric(meta.pixels_per_km, 7.0);
        const baseSpeed = this.toNumeric(meta.base_walk_speed_kmpd, 30.0);
        const windingFactor = this.toNumeric(meta.winding_factor, 1.2);

        return {
            pixelsPerKm: pixelsPerKm > 0 ? pixelsPerKm : 7.0,
            baseSpeed: baseSpeed > 0 ? baseSpeed : 30.0,
            windingFactor: windingFactor > 0 ? windingFactor : 1.2
        };
    }

    getDistanceUnit() {
        return distanceUnits.normalizeDistanceUnit(this.settings?.distance_unit);
    }

    getDistanceUnitDefinition() {
        return distanceUnits.getDistanceUnitDefinition(this.getDistanceUnit());
    }

    formatDistance(distanceKm, options = {}) {
        return distanceUnits.formatDistanceKm(distanceKm, this.getDistanceUnit(), options);
    }

    replaceDistanceMentions(text) {
        return distanceUnits.replaceDistanceMentions(text, this.getDistanceUnit());
    }

    configuredDistanceToKm(value) {
        return distanceUnits.configuredDistanceToKm(value, this.getDistanceUnit());
    }

    calculateTravel(nodeA, nodeB, transportType = 'walk') {
        // 0. Resolve scale from world package meta (single source of truth).
        const scale = this.resolveTravelScale(this.worldData?.meta);

        // 1. Get raw pixel distance (Euclidean)
        const dx = (nodeA.world_x ?? nodeA.x ?? 0) - (nodeB.world_x ?? nodeB.x ?? 0);
        const dy = (nodeA.world_y ?? nodeA.y ?? 0) - (nodeB.world_y ?? nodeB.y ?? 0);
        const pixelDist = Math.sqrt(dx * dx + dy * dy);

        // 2. Convert to Kilometers
        // Apply winding factor because characters don't fly in straight lines
        const kmDist = (pixelDist / scale.pixelsPerKm) * scale.windingFactor;

        // 3. Determine Speed
        let dailySpeed = scale.baseSpeed;

        // Transport Modifiers
        if (transportType === 'carriage') dailySpeed *= 1.5;
        if (transportType === 'boat') dailySpeed = 50;
        if (transportType === 'vision_flight') dailySpeed *= 4.0;

        // 4. Terrain Modifier
        let terrainMod = 1.0;
        const targetTags = (nodeB.tags || "").toLowerCase();

        if (targetTags.includes('mountain')) terrainMod = TERRAIN_MODIFIERS.Mountain;
        else if (targetTags.includes('desert')) terrainMod = TERRAIN_MODIFIERS.Desert;
        else if (targetTags.includes('forest')) terrainMod = TERRAIN_MODIFIERS.Forest;

        // 5. Final Calculation
        const totalDays = (kmDist / dailySpeed) * terrainMod;

        const result = {
            distanceKm: Math.round(kmDist),
            days: parseFloat(totalDays.toFixed(1)),
            narrativeText: this.generateTimeText(totalDays)
        };

        return result;
    }

    simulateTravelBetweenNodes(worldData, originNodeUid, destinationNodeUid, transportType = 'walk') {
        const normalizedWorldData = this.normalizeWorldData(worldData);
        const originUid = String(originNodeUid || '').trim();
        const destinationUid = String(destinationNodeUid || '').trim();

        if (!originUid || !destinationUid) {
            throw new Error('Origin and destination nodes are required.');
        }

        const nodes = Array.isArray(normalizedWorldData.nodes) ? normalizedWorldData.nodes : [];
        const originNode = nodes.find((node) => node.uid === originUid);
        const destinationNode = nodes.find((node) => node.uid === destinationUid);

        if (!originNode) throw new Error('Origin node not found.');
        if (!destinationNode) throw new Error('Destination node not found.');

        const previousWorldData = this.worldData;
        this.worldData = normalizedWorldData;
        try {
            const travel = this.calculateTravel(originNode, destinationNode, transportType);
            return {
                originNode,
                destinationNode,
                travel,
                scale: this.resolveTravelScale(normalizedWorldData.meta)
            };
        } finally {
            this.worldData = previousWorldData;
        }
    }

    async analyzeBiomeRouteBetweenCoordinates(turnContext, start, end, options = {}) {
        if (!this.worldData) await this.loadWorldData(turnContext, { skipTiling: true });

        const startPoint = {
            x: this.toNumeric(start?.x, Number.NaN),
            y: this.toNumeric(start?.y, Number.NaN)
        };
        const endPoint = {
            x: this.toNumeric(end?.x, Number.NaN),
            y: this.toNumeric(end?.y, Number.NaN)
        };

        if (!Number.isFinite(startPoint.x) || !Number.isFinite(startPoint.y) || !Number.isFinite(endPoint.x) || !Number.isFinite(endPoint.y)) {
            throw new Error('Start and destination coordinates must be finite numbers.');
        }

        if (!this.worldData) {
            throw new Error('No world map data is currently loaded for this project.');
        }

        return await biomeNavigation.analyzeBiomeRoutes({
            worldData: this.worldData,
            packagePath: this.worldPackagePath,
            biomeMaskPath: this.biomeMaskPath,
            start: startPoint,
            end: endPoint,
            routeCount: options.routeCount,
            forceRebuild: !!options.forceRebuild,
            includeDebugPaths: !!options.includeDebugPaths,
            maxWildStretchKm: Number.isFinite(Number(options.maxWildStretchKm))
                ? Number(options.maxWildStretchKm)
                : this.getPathfindingMaxWildStretchKm(),
            distanceUnit: this.getDistanceUnit(),
            logger: this.tools?.logger || null
        });
    }

    findWorldNodeByUid(uid) {
        const key = String(uid || '').trim();
        return key ? (this.worldData?.nodes || []).find(node => String(node.uid || '') === key) || null : null;
    }

    async buildManualMapPoint(x, y) {
        const dimensions = this.worldData?.meta?.dimensions || {};
        const maxX = Math.max(0, Number(dimensions.width) || 0);
        const maxY = Math.max(0, Number(dimensions.height) || 0);
        const point = {
            x: Math.max(0, Math.min(maxX, Number(x))),
            y: Math.max(-maxY, Math.min(0, Number(y)))
        };
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('The selected map point is invalid.');
        const nearest = this.getNearestNodeContext(point);
        const biome = await this.getBiomeContextAtCoordinates(point.x, point.y);
        const terrain = biome?.label || 'Wilderness';
        const relation = nearest?.name
            ? `${nearest.distance_km <= 1 ? 'near' : `${this.formatDistance(nearest.distance_km)} ${nearest.direction} of`} ${nearest.name}`
            : 'in an unmapped part of the world';
        return {
            uid: null,
            name: `${terrain} ${relation}`,
            map_status: 'map_point',
            x: Number(point.x.toFixed(2)),
            y: Number(point.y.toFixed(2)),
            biome: biome ? { id: biome.id, label: biome.label } : null,
            nearest_node: nearest
        };
    }

    resolveInstantArrivalTarget(target) {
        if (!target || target.map_status === 'mapped') return target;
        const nearest = this.getNearestNodeContext(target);
        const node = nearest?.uid
            ? this.findWorldNodeByUid(nearest.uid)
            : this.findWorldNodeByName(nearest?.name);
        if (!node) return target;
        const dimensions = this.worldData?.meta?.dimensions || {};
        const snapThreshold = Math.max(Number(dimensions.width) || 0, Number(dimensions.height) || 0) * 0.01;
        const pixelDistance = Math.hypot(
            Number(target.x) - Number(node.world_x),
            Number(target.y) - Number(node.world_y)
        );
        const nearestNode = {
            uid: String(node.uid || ''),
            name: node.name,
            distance_km: Number(this.coordinateDistanceKm(target, node).toFixed(1)),
            direction: this.getCardinalDirection(target, node)
        };
        if (snapThreshold > 0 && pixelDistance <= snapThreshold) {
            return {
                ...navigationCopilot.nodeRef(node),
                x: Number(node.world_x),
                y: Number(node.world_y),
                nearest_node: nearestNode,
                snapped_from_map_point: true
            };
        }
        return { ...target, nearest_node: nearestNode };
    }

    alignManualRouteToTarget(route, originalTarget, resolvedTarget) {
        if (!route || !resolvedTarget || (Number(originalTarget?.x) === Number(resolvedTarget.x) && Number(originalTarget?.y) === Number(resolvedTarget.y))) {
            return route;
        }
        const originalCorridor = routeGeometry.normalizePoints(route.corridor || []);
        const corridor = originalCorridor.length
            ? [...originalCorridor.slice(0, -1), { x: Number(resolvedTarget.x), y: Number(resolvedTarget.y) }]
            : [];
        const oldLength = routeGeometry.corridorLength(originalCorridor);
        const newLength = routeGeometry.corridorLength(corridor);
        const distanceKm = oldLength > 0
            ? Number((Number(route.distance_km || 0) * (newLength / oldLength)).toFixed(1))
            : Number(route.distance_km || 0);
        return {
            ...route,
            distance_km: distanceKm,
            distance_display: this.formatDistance(distanceKm),
            summary: String(route.summary || '').split(String(originalTarget?.name || '')).join(String(resolvedTarget.name || originalTarget?.name || '')),
            corridor: navigationCopilot.downsampleCorridor(corridor)
        };
    }

    resolveManualArrivalAnchor(target, previousLocation = null) {
        const node = target?.map_status === 'mapped' ? this.findWorldNodeByUid(target.uid) : null;
        const nearest = node
            || this.findWorldNodeByUid(target?.nearest_node?.uid)
            || this.findWorldNodeByName(target?.nearest_node?.name)
            || null;
        return nearest?.name || previousLocation?.anchor || previousLocation?.anchor_node || null;
    }

    summarizeManualRoute(route, fallback = false) {
        const requirements = [];
        if (route?.has_boat_required) requirements.push('Boat passage');
        if (route?.has_river) requirements.push('River crossing');
        if (route?.has_slow_terrain) requirements.push('Difficult terrain');
        for (const note of route?.notes || []) {
            const clean = String(note || '').trim();
            if (clean && !requirements.includes(clean)) requirements.push(clean);
        }
        const stops = [...new Set([
            ...(route?.journey_stops || []).map(item => typeof item === 'string' ? item : item?.name),
            ...(route?.suggested_stops || []).map(item => typeof item === 'string' ? item : item?.name)
        ].filter(Boolean))].slice(0, 12);
        return {
            id: String(route?.id || 'direct'),
            title: String(route?.title || (fallback ? 'Provisional direct route' : 'Route')),
            mode_label: String(route?.mode_label || (fallback ? 'provisional straight route' : 'manual route')),
            distance_km: Number(Number(route?.distanceKm || 0).toFixed(1)),
            distance_display: this.formatDistance(route?.distanceKm || 0),
            direction: String(route?.direction || ''),
            summary: String(route?.text || route?.summary || '').trim(),
            terrain: (route?.runs || []).map(run => ({
                label: String(run?.label || run?.biome || 'Unknown'),
                distance_km: Number(Number(run?.distanceKm || run?.distance_km || 0).toFixed(1)),
                distance_display: this.formatDistance(run?.distanceKm || run?.distance_km || 0)
            })).filter(run => run.label),
            requirements: requirements.slice(0, 12),
            stops,
            corridor: navigationCopilot.downsampleCorridor(route?.debug_path || [])
        };
    }

    async previewManualDestination(turnContext, input = {}) {
        await this.loadWorldData(turnContext, { skipTiling: true });
        const status = this.getLoadedOperationalStatus();
        if (!status.active) throw new Error(status.reason);
        const currentLocation = await this.getCurrentLocation(turnContext);
        if (!currentLocation || !Number.isFinite(Number(currentLocation.x)) || !Number.isFinite(Number(currentLocation.y))) {
            throw new Error('The party does not have a canonical map position yet.');
        }

        const node = this.findWorldNodeByUid(input.node_uid);
        const target = node
            ? { ...navigationCopilot.nodeRef(node), x: Number(node.world_x), y: Number(node.world_y) }
            : await this.buildManualMapPoint(input.x, input.y);
        const start = { x: Number(currentLocation.x), y: Number(currentLocation.y) };
        const end = { x: Number(target.x), y: Number(target.y) };
        let analysis;
        try {
            analysis = await this.analyzeBiomeRouteBetweenCoordinates(turnContext, start, end, {
                routeCount: 4,
                includeDebugPaths: true
            });
        } catch (error) {
            this.tools.logger.warn('ManualNavigation', `Route preview fell back to a direct line: ${error.message}`);
            analysis = { enabled: false };
        }

        let routes = [];
        if (analysis?.enabled && Array.isArray(analysis.routes)) {
            routes = analysis.routes.slice(0, 4).map(route => this.summarizeManualRoute(route));
        }
        if (routes.length === 0) {
            const travel = this.calculateTravel(start, end);
            routes = [this.summarizeManualRoute({
                id: 'direct',
                title: 'Provisional direct route',
                mode_label: 'straight route; terrain unavailable',
                distanceKm: travel.distanceKm,
                direction: this.getCardinalDirection(start, end),
                text: `Proceed directly toward ${target.name}. Detailed terrain routing is unavailable.`,
                debug_path: [start, end]
            }, true)];
        }
        routes = routes.map(route => ({
            ...route,
            duration: this.generateTimeText(route.distance_km / this.resolveTravelScale().baseSpeed)
        }));
        const travelers = await this.getManualTravelerCandidates(turnContext);

        const preview = {
            id: crypto.randomUUID(),
            created_at: Date.now(),
            turn_number: Number(turnContext?.turnNumber || 0),
            signature: await this.buildManualValidationSignature(currentLocation),
            origin: start,
            target,
            routes,
            travelers
        };
        const store = this.getManualPreviewStore(turnContext);
        store.set(preview.id, preview);
        while (store.size > MANUAL_PREVIEW_LIMIT) store.delete(store.keys().next().value);
        this.logDecision(`Manual preview: ${routes.length} deterministic route(s) to ${target.name}; no LLM used.`);
        return { preview_id: preview.id, target, routes, travelers };
    }

    cancelManualDestinationPreview(turnContext, previewId) {
        return this.getManualPreviewStore(turnContext).delete(String(previewId || ''));
    }

    async getValidatedManualPreview(turnContext, previewId, routeId) {
        const store = this.getManualPreviewStore(turnContext);
        const preview = store.get(String(previewId || ''));
        if (!preview) throw new Error('This route preview expired. Please select the destination again.');
        const currentLocation = await this.getCurrentLocation(turnContext);
        if (preview.turn_number !== Number(turnContext?.turnNumber || 0)
            || preview.signature !== await this.buildManualValidationSignature(currentLocation)) {
            store.delete(preview.id);
            throw new Error('The party position or world map changed. Please preview the route again.');
        }
        const route = preview.routes.find(candidate => String(candidate.id) === String(routeId));
        if (!route) throw new Error('The selected route is no longer available.');
        return { store, preview, route, currentLocation };
    }

    buildManualRoutePlan(preview, route, turnNumber) {
        const waypoints = route.stops.map(name => this.findWorldNodeByName(name)).filter(Boolean).map(node => ({
            uid: String(node.uid || ''), name: node.name, purpose: 'User-selected journey stop', status: 'pending'
        }));
        return navigationCopilot.normalizeRoutePlan({
            destination: preview.target,
            selected_route_id: route.id,
            selection_source: 'user_map',
            summary: route.summary || `Follow the user-selected route to ${preview.target.name}.`,
            waypoints,
            suggested_next_waypoint: waypoints[0] || null,
            route_notes: route.requirements,
            corridor: route.corridor,
            remaining_corridor: route.corridor,
            route_profile: { id: route.id, mode: route.mode_label },
            planning_basis: { origin: preview.origin, target_uid: preview.target.uid, world_signature: preview.signature },
            created_turn: turnNumber,
            updated_turn: turnNumber,
            status: 'active',
            source: 'user_map'
        });
    }

    async appendManualOrderFact(turnContext, order, context = 'user_map_navigation_order') {
        turnContext.runtime = turnContext.runtime || {};
        turnContext.runtime.worldLocationTracker = turnContext.runtime.worldLocationTracker || {};
        turnContext.runtime.worldLocationTracker.latestManualOrder = order;
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker', target: 'party', predicate: 'manual_navigation_order',
            fact_value: JSON.stringify(order), context
        }, { turn_number: Number(turnContext?.turnNumber || 0) });
    }

    async getLatestManualOrder(turnContext) {
        const runtimeOrder = turnContext?.runtime?.worldLocationTracker?.latestManualOrder;
        if (runtimeOrder?.id) return navigationCopilot.normalizeManualOrder(runtimeOrder);
        try {
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts
                 WHERE project_name = ? AND source = 'world_location_tracker'
                   AND predicate = 'manual_navigation_order' AND turn_number <= ?
                 ORDER BY turn_number DESC, id DESC LIMIT 1`,
                [this.getEffectiveProjectName(turnContext), Number(turnContext?.turnNumber || 0)]
            );
            return rows?.[0]?.fact_value
                ? navigationCopilot.normalizeManualOrder(JSON.parse(rows[0].fact_value))
                : null;
        } catch (error) {
            this.tools.logger.warn('ManualNavigation', `Could not restore the latest manual order: ${error.message}`);
            return null;
        }
    }

    async getPendingManualOrder(turnContext) {
        const order = await this.getLatestManualOrder(turnContext);
        return order?.status === 'pending_send' ? order : null;
    }

    isPendingManualOrderSuperseded(pendingOrder, rawNavigationState) {
        if (!pendingOrder?.id) return true;
        const canonicalOrder = navigationCopilot.normalizeNavigationState(rawNavigationState).manual_order;
        if (!canonicalOrder || canonicalOrder.status === 'pending_send') return false;
        if (canonicalOrder.id === pendingOrder.id) return true;
        const canonicalTurn = Number(canonicalOrder.activated_turn ?? canonicalOrder.completed_turn ?? canonicalOrder.issued_turn ?? -1);
        return Number.isFinite(canonicalTurn) && canonicalTurn >= Number(pendingOrder.issued_turn || 0);
    }

    isPendingManualOrderFulfilledByLocation(pendingOrder, location, turnNumber = 0) {
        if (!pendingOrder?.id || pendingOrder.mode !== 'instant' || !location) return false;
        if (String(location.manual_order_id || '') === String(pendingOrder.id)) return true;
        if (Number(turnNumber || 0) <= Number(pendingOrder.issued_turn || 0)) return false;
        const dx = Number(location.x) - Number(pendingOrder.target?.x);
        const dy = Number(location.y) - Number(pendingOrder.target?.y);
        return Number.isFinite(dx) && Number.isFinite(dy) && Math.sqrt((dx * dx) + (dy * dy)) <= 1;
    }

    async getManualTravelerCandidates(turnContext) {
        const names = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
        const icons = turnContext?.output?.characterIcons || {};
        let locations = [];
        try {
            locations = await this.getAllCharacterLocations(turnContext);
        } catch {
            locations = [];
        }
        const byName = new Map(locations.map(location => [this.normalizeCharacterKey(location?.name), location]));
        const seen = new Set();
        return names.map(rawName => {
            const name = String(rawName || '').trim();
            const key = this.normalizeCharacterKey(name);
            if (!key || seen.has(key)) return null;
            seen.add(key);
            const location = byName.get(key) || {};
            return {
                name,
                iconPath: location.iconPath || icons[name] || icons[key] || '',
                spritePath: location.spritePath || '',
                selected: true
            };
        }).filter(Boolean).slice(0, 24);
    }

    async persistManualNavigationTimeline(turnContext, state) {
        const line = Math.max(0, this.getProcessedLineCount(turnContext) - 1);
        const existing = await this.getNavigationTimelineForContext(turnContext);
        const timeline = [...existing.filter(entry => Number(entry?.line) !== line), { line, state }]
            .sort((left, right) => Number(left.line) - Number(right.line));
        await this.persistNavigationTimeline(turnContext, timeline);
    }

    async persistManualArrival(turnContext, preview, route, orderId = null, travelers = []) {
        const previous = await this.getCurrentLocation(turnContext);
        const node = preview.target.map_status === 'mapped' ? this.findWorldNodeByUid(preview.target.uid) : null;
        const arrivalAnchor = this.resolveManualArrivalAnchor(preview.target, previous);
        const line = Math.max(0, this.getProcessedLineCount(turnContext) - 1);
        const state = await this.enrichCoordinateState({
            position_model: 'coordinate_v1',
            status: 'ARRIVED',
            type: node ? 'NODE' : 'TRANSIT',
            name: preview.target.name,
            specific_location: preview.target.name,
            anchor: arrivalAnchor,
            anchor_node: arrivalAnchor,
            destination: null,
            movement_distance_km: route.distance_km,
            underground_status: previous?.underground_status || 'Above Ground',
            x: Number(preview.target.x),
            y: Number(preview.target.y),
            manual_order_id: orderId || preview.id
        });
        const existing = await this.getLocationTimelineForTurn(turnContext);
        const entry = { ...state, line, travel_party: this.normalizeCharacterList(travelers), confidence: 1, reasoning: 'User-authorized instant arrival from the world map.' };
        const timeline = [...existing.filter(item => Number(item?.line) !== line), entry]
            .sort((left, right) => Number(left.line) - Number(right.line));

        this.tools.pluginState.turn().locationTimeline = timeline;
        this.tools.pluginState.turn().locationState = entry;
        turnContext.output.locationTimeline = timeline;
        await this.tools.facts.cleanUpFactsDb({
            source: 'party',
            predicates: ['location_timeline', `location_event:${line}`]
        });
        await this.tools.facts.appendToFactsDb({
            source: 'party', target: 'self', predicate: 'location_timeline',
            fact_value: JSON.stringify(timeline), context: 'manual_map_arrival'
        }, { turn_number: turnContext.turnNumber });
        await this.tools.facts.appendToFactsDb({
            source: 'party', target: 'self', predicate: `location_event:${line}`,
            fact_value: JSON.stringify(entry), context: 'manual_map_arrival'
        }, { turn_number: turnContext.turnNumber });
        await this._applyLocationState(turnContext, entry, previous);
        await this.persistManualTravelerArrival(turnContext, entry, travelers);
        return entry;
    }

    async persistManualTravelerArrival(turnContext, location, travelers = []) {
        const names = this.normalizeCharacterList(travelers);
        for (const name of names) {
            const factValue = JSON.stringify({
                specific_location: location.specific_location || location.name,
                anchor_node: location.anchor_node || location.anchor || null,
                x: Number(location.x),
                y: Number(location.y),
                context: `Travelled with the user-selected group to ${location.name || location.specific_location}.`
            });
            await this.tools.facts.appendToFactsDb({
                source: name.toLowerCase(), target: 'self', predicate: 'CHAR_LOCATION',
                fact_value: factValue, context: 'user_map_instant_arrival'
            }, { turn_number: Number(turnContext?.turnNumber || 0) });
        }
    }

    async createPendingTimeskipDirective(turnContext, preview, route, orderId, reason = '', travelers = []) {
        const duration = route.duration || this.generateTimeText(route.distance_km / this.resolveTravelScale().baseSpeed);
        const normalizedReason = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        const reasonLine = normalizedReason ? `\nThe user's stated reason for this travel was: ${normalizedReason}.` : '';
        const travelerNames = this.normalizeCharacterList(travelers);
        const travelerLine = travelerNames.length ? `\nThe user selected these travelers for the journey: ${travelerNames.join(', ')}.` : '';
        const directive = {
            id: orderId,
            issue_turn: Number(turnContext?.turnNumber || 0),
            destination: preview.target.name,
            distance_km: route.distance_km,
            duration,
            reason: normalizedReason,
            travelers: travelerNames,
            text: `[The user explicitly advanced the story until the selected traveling group arrived at ${preview.target.name}.\nThe selected journey covered approximately ${this.formatDistance(route.distance_km)} and took approximately ${duration}.${reasonLine}${travelerLine}\nTreat arrival as established. Do not replay the complete journey unless narratively useful.]`
        };
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker', target: 'party', predicate: 'manual_timeskip_directive',
            fact_value: JSON.stringify(directive), context: 'pending_next_turn_directive'
        }, { turn_number: turnContext.turnNumber });
        return directive;
    }

    async getPendingTimeskipDirective(turnContext) {
        const projectName = this.getEffectiveProjectName(turnContext);
        const turnNumber = Number(turnContext?.turnNumber || 0);
        try {
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts
                 WHERE project_name = ? AND source = 'world_location_tracker'
                   AND predicate = 'manual_timeskip_directive' AND turn_number <= ?
                 ORDER BY id DESC LIMIT 8`,
                [projectName, turnNumber]
            );
            for (const row of rows || []) {
                let directive;
                try { directive = JSON.parse(row.fact_value); } catch { continue; }
                if (!directive?.id) continue;
                const consumed = await this.tools.db.chat.query(
                    `SELECT id FROM facts WHERE project_name = ? AND source = 'world_location_tracker'
                     AND predicate = ? ORDER BY id DESC LIMIT 1`,
                    [projectName, `manual_timeskip_consumed:${directive.id}`]
                );
                if (!consumed?.length) return directive;
            }
        } catch (error) {
            this.tools.logger.warn('ManualNavigation', `Could not read pending timeskip directive: ${error.message}`);
        }
        return null;
    }

    async markTimeskipDirectiveConsumed(turnContext, directiveId) {
        if (!directiveId) return;
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker', target: 'party', predicate: `manual_timeskip_consumed:${directiveId}`,
            fact_value: JSON.stringify({ consumed_turn: Number(turnContext?.turnNumber || 0) }),
            context: 'manual_timeskip_consumed'
        }, { turn_number: turnContext.turnNumber });
    }

    async commitManualDestination(turnContext, input = {}) {
        await this.loadWorldData(turnContext, { skipTiling: true });
        const { store, preview, route } = await this.getValidatedManualPreview(turnContext, input.preview_id, input.route_id);
        const mode = input.mode === 'instant' ? 'instant' : 'planned';
        const reason = String(input.reason || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        const turnNumber = Number(turnContext?.turnNumber || 0);
        const allowedTravelers = new Map((preview.travelers || []).map(item => [this.normalizeCharacterKey(item.name), item.name]));
        const requestedTravelers = Array.isArray(input.travelers) ? input.travelers : (preview.travelers || []).map(item => item.name);
        const travelers = [...new Set(requestedTravelers
            .map(name => allowedTravelers.get(this.normalizeCharacterKey(name)))
            .filter(Boolean))];
        if (allowedTravelers.size > 0 && travelers.length === 0) throw new Error('Select at least one traveler before saving this movement intent.');
        const target = mode === 'instant' ? this.resolveInstantArrivalTarget(preview.target) : preview.target;
        const selectedRoute = mode === 'instant' ? this.alignManualRouteToTarget(route, preview.target, target) : route;
        const order = {
            id: crypto.randomUUID(),
            source: 'user_map',
            mode,
            status: 'pending_send',
            target,
            selected_route_id: selectedRoute.id,
            issued_turn: turnNumber,
            completed_turn: null,
            authorized: false,
            reason,
            travelers,
            route: {
                title: selectedRoute.title,
                mode_label: selectedRoute.mode_label,
                summary: selectedRoute.summary,
                distance_km: selectedRoute.distance_km,
                distance_display: selectedRoute.distance_display || this.formatDistance(selectedRoute.distance_km),
                duration: selectedRoute.duration,
                requirements: selectedRoute.requirements,
                stops: selectedRoute.stops,
                corridor: navigationCopilot.downsampleCorridor(selectedRoute.corridor || []),
                origin: preview.origin
            },
            rollback: null
        };
        await this.appendManualOrderFact(turnContext, order, 'user_map_pending_send');
        store.delete(preview.id);
        this.logDecision(`Saved ${mode} travel intent to ${target.name}; activation waits for Send${target.snapped_from_map_point ? ' (snapped to nearby anchor)' : ''}.`);
        return { mode, order, staged: true };
    }

    async activatePendingManualOrder(turnContext) {
        turnContext.runtime = turnContext.runtime || {};
        turnContext.runtime.worldLocationTracker = turnContext.runtime.worldLocationTracker || {};
        const runtime = turnContext.runtime.worldLocationTracker;
        if (runtime.manualOrderActivation) return runtime.manualOrderActivation;

        const pending = await this.getPendingManualOrder(turnContext);
        if (!pending) return null;
        const currentLocation = await this.getCurrentLocation(turnContext);
        if (this.isPendingManualOrderFulfilledByLocation(pending, currentLocation, turnContext?.turnNumber)) {
            this.logDecision(`Ignored stale pending instant order ${pending.id}; canonical location already reflects its arrival.`);
            return null;
        }
        const canonicalNavigation = await this.getNavigationStateForContext(turnContext, { preferPersisted: true });
        if (this.isPendingManualOrderSuperseded(pending, canonicalNavigation)) {
            this.logDecision(`Ignored stale pending manual order ${pending.id}; its canonical result is already persisted.`);
            return null;
        }
        const turnNumber = Number(turnContext?.turnNumber || 0);
        const route = pending.route || {};
        const preview = {
            target: pending.target,
            origin: route.origin || {},
            signature: '',
            routes: [route]
        };
        const activatedOrder = {
            ...pending,
            status: pending.mode === 'instant' ? 'completed' : 'active',
            authorized: true,
            activated_turn: turnNumber,
            completed_turn: pending.mode === 'instant' ? turnNumber : null
        };
        let result;
        if (pending.mode === 'planned') {
            const plan = this.buildManualRoutePlan(preview, route, turnNumber);
            const firstWaypoint = plan.waypoints.find(waypoint => waypoint.status === 'pending') || null;
            const activeTarget = firstWaypoint
                ? navigationCopilot.nodeRef(this.findWorldNodeByUid(firstWaypoint.uid))
                : pending.target;
            const activeLegPlan = firstWaypoint
                ? this.buildWaypointLegPlan(plan, activeTarget, turnNumber)
                : navigationCopilot.normalizeRoutePlan({ ...plan, destination: activeTarget, status: 'active' });
            const state = navigationCopilot.normalizeNavigationState({
                status: 'active', journey_target: pending.target, active_target: activeTarget,
                journey_plan: plan, active_leg_plan: activeLegPlan, deliberation: null,
                manual_order: activatedOrder, last_operation: 'SET_JOURNEY'
            });
            await this.persistNavigationState(turnContext, state);
            await this.persistManualNavigationTimeline(turnContext, state);
            await this.appendManualOrderFact(turnContext, activatedOrder, 'user_map_activated_on_send');
            result = { mode: 'planned', order: activatedOrder, navigation_state: state };
        } else {
            const location = await this.persistManualArrival(turnContext, preview, route, pending.id, pending.travelers);
            const state = navigationCopilot.normalizeNavigationState({
                ...navigationCopilot.emptyNavigationState(),
                status: 'awaiting_intent',
                last_reached_target: { ...pending.target, reached_turn: turnNumber },
                manual_order: activatedOrder,
                last_operation: 'COMPLETE'
            });
            await this.persistNavigationState(turnContext, state);
            await this.persistManualNavigationTimeline(turnContext, state);
            await this.appendManualOrderFact(turnContext, activatedOrder, 'user_map_instant_arrival_on_send');
            const directive = await this.createPendingTimeskipDirective(turnContext, preview, route, pending.id, pending.reason, pending.travelers);
            result = { mode: 'instant', order: activatedOrder, location, navigation_state: state, directive };
        }
        runtime.manualOrderActivation = result;
        this.logDecision(`Activated ${pending.mode} user travel to ${pending.target.name} after Send.`);
        return result;
    }

    async persistManualRollbackLocation(turnContext, snapshot, orderId) {
        const current = await this.getCurrentLocation(turnContext);
        const line = Math.max(0, this.getProcessedLineCount(turnContext) - 1);
        const { manual_order_id: _ignored, ...rawSnapshot } = snapshot || {};
        const state = await this.enrichCoordinateState({
            ...rawSnapshot,
            position_model: 'coordinate_v1',
            status: 'STAYED',
            destination: rawSnapshot.destination || null,
            movement_distance_km: 0
        });
        if (!state || !Number.isFinite(Number(state.x)) || !Number.isFinite(Number(state.y))) {
            throw new Error('The previous canonical location snapshot is unavailable.');
        }
        const entry = {
            ...state,
            line,
            travel_party: [],
            confidence: 1,
            reasoning: `User undid instant map arrival ${orderId}.`
        };
        const existing = await this.getLocationTimelineForTurn(turnContext);
        const timeline = [...existing.filter(item => Number(item?.line) !== line), entry]
            .sort((left, right) => Number(left.line) - Number(right.line));
        this.tools.pluginState.turn().locationTimeline = timeline;
        this.tools.pluginState.turn().locationState = entry;
        turnContext.output.locationTimeline = timeline;
        await this.tools.facts.cleanUpFactsDb({
            source: 'party',
            predicates: ['location_timeline', `location_event:${line}`, 'location_change', 'location_anchor', 'location_view']
        });
        await this.tools.facts.appendToFactsDb({
            source: 'party', target: 'self', predicate: 'location_timeline',
            fact_value: JSON.stringify(timeline), context: 'manual_map_arrival_undo'
        }, { turn_number: turnContext.turnNumber });
        await this.tools.facts.appendToFactsDb({
            source: 'party', target: 'self', predicate: `location_event:${line}`,
            fact_value: JSON.stringify(entry), context: 'manual_map_arrival_undo'
        }, { turn_number: turnContext.turnNumber });
        await this._applyLocationState(turnContext, entry, current);
        return entry;
    }

    async undoManualInstantArrival(turnContext) {
        await this.loadWorldData(turnContext, { skipTiling: true });
        const state = navigationCopilot.normalizeNavigationState(await this.getNavigationStateForContext(turnContext));
        const order = state.manual_order;
        const turnNumber = Number(turnContext?.turnNumber || 0);
        if (!order || order.source !== 'user_map' || order.mode !== 'instant' || order.status !== 'completed') {
            throw new Error('There is no completed instant arrival to undo.');
        }
        if (Number(order.issued_turn) !== turnNumber) {
            throw new Error('Instant arrival can only be undone during the turn in which it was issued.');
        }
        const rollback = order.rollback;
        if (!rollback?.location) {
            throw new Error('This instant arrival has no rollback snapshot and cannot be safely undone.');
        }

        const location = await this.persistManualRollbackLocation(turnContext, rollback.location, order.id);
        const restoredNavigation = navigationCopilot.normalizeNavigationState(rollback.navigation_state);
        await this.persistNavigationState(turnContext, restoredNavigation, { allowUserRollback: true });
        await this.persistManualNavigationTimeline(turnContext, restoredNavigation);
        const undoneOrder = {
            ...order,
            status: 'cancelled',
            authorized: false,
            cancelled_turn: turnNumber,
            undo: true,
            rollback: null
        };
        await this.appendManualOrderFact(turnContext, undoneOrder, 'user_map_instant_arrival_undone');
        await this.markTimeskipDirectiveConsumed(turnContext, order.id);
        this.logDecision(`User undid instant arrival to ${order.target.name}; restored ${location.name || location.anchor || 'previous location'}.`);
        return { order: undoneOrder, location, navigation_state: restoredNavigation };
    }

    async cancelManualNavigationOrder(turnContext) {
        await this.loadWorldData(turnContext, { skipTiling: true });
        const pending = await this.getPendingManualOrder(turnContext);
        if (pending) {
            const cancelledOrder = {
                ...pending,
                status: 'cancelled',
                authorized: false,
                cancelled_turn: Number(turnContext?.turnNumber || 0)
            };
            await this.appendManualOrderFact(turnContext, cancelledOrder, 'user_map_pending_cancelled');
            this.logDecision(`Cancelled pending ${pending.mode} intent to ${pending.target.name} before Send.`);
            return { order: cancelledOrder, navigation_state: await this.getNavigationStateForContext(turnContext) };
        }
        const current = await this.getNavigationStateForContext(turnContext);
        const state = navigationCopilot.normalizeNavigationState(current);
        const order = state.manual_order;
        if (!order || order.source !== 'user_map' || order.status !== 'active' || order.mode !== 'planned') {
            throw new Error('There is no active user-planned journey to cancel.');
        }
        const cancelledOrder = {
            ...order,
            status: 'cancelled',
            authorized: false,
            cancelled_turn: Number(turnContext?.turnNumber || 0)
        };
        const cancelledState = navigationCopilot.normalizeNavigationState({
            ...navigationCopilot.emptyNavigationState(),
            last_reached_target: state.last_reached_target,
            manual_order: cancelledOrder,
            last_operation: 'CLEAR'
        });
        await this.persistNavigationState(turnContext, cancelledState);
        await this.persistManualNavigationTimeline(turnContext, cancelledState);
        await this.appendManualOrderFact(turnContext, cancelledOrder, 'user_map_navigation_cancelled');
        this.logDecision(`User cancelled the manual journey to ${order.target.name}; canonical position retained.`);
        return { order: cancelledOrder, navigation_state: cancelledState };
    }

    isAutoNavigationPlanningEnabled() {
        return this.settings?.auto_navigation_planning_enabled !== false;
    }

    getSimpleNavigationMapSpanPercent() {
        const value = Number(this.settings?.simple_route_max_map_span_percent);
        return Number.isFinite(value) ? Math.max(1, Math.min(25, value)) : navigationCopilot.DEFAULT_SIMPLE_MAP_SPAN_PERCENT;
    }

    getLocationModel() {
        return this.settings?.model_def || { model: 'mediumendmodel' };
    }

    logDecision(message) {
        this.tools.logger.runtime(`[WLT Decision] ${message}`);
    }

    debugPoint(point) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return '(?,?)';
        return `(${x.toFixed(1)},${y.toFixed(1)})`;
    }

    summarizeRouteGeometryForDebug(points, start = null, end = null) {
        const source = routeGeometry.normalizePoints(points || []);
        const first = source[0] || null;
        const middle = source.length ? source[Math.floor(source.length / 2)] : null;
        const last = source.at(-1) || null;
        const directStart = start || first;
        const directEnd = end || last;
        const directLength = directStart && directEnd
            ? Math.hypot(Number(directEnd.x) - Number(directStart.x), Number(directEnd.y) - Number(directStart.y))
            : 0;
        const pathLength = routeGeometry.corridorLength(source);
        const ratio = directLength > 1e-9 ? pathLength / directLength : 0;
        return `pts=${source.length}, ratio=${ratio.toFixed(2)}, first=${this.debugPoint(first)}, mid=${this.debugPoint(middle)}, last=${this.debugPoint(last)}`;
    }

    summarizeRouteCandidateForDebug(route, start, end) {
        if (!route) return 'none';
        const debugPath = Array.isArray(route.debug_path) ? route.debug_path : [];
        const distance = Number.isFinite(Number(route.distanceKm)) ? `${Number(route.distanceKm).toFixed(0)}km` : 'unknown km';
        const notes = (route.notes || []).slice(0, 3).join('|') || 'none';
        return `${route.id || 'unknown'}:${route.title || 'untitled'}, dist=${distance}, debug=${debugPath.length}, ${this.summarizeRouteGeometryForDebug(debugPath, start, end)}, notes=${notes}`;
    }

    summarizePlanGeometryForDebug(planInput) {
        const plan = navigationCopilot.normalizeRoutePlan(planInput);
        if (!plan) return 'none';
        const corridor = plan.remaining_corridor?.length ? plan.remaining_corridor : plan.corridor;
        return `${plan.selected_route_id || 'direct'}, status=${plan.status || 'unknown'}, ${this.summarizeRouteGeometryForDebug(corridor)}`;
    }

    summarizeLocationEvents(events) {
        return (events || []).map(event => {
            const status = String(event.status || 'STAYED').toUpperCase();
            const place = status === 'TRANSIT'
                ? `toward ${event.destination || event.destination_mention || 'an unresolved destination'}`
                : (event.anchor_node || event.anchor_reference || event.specific_location || 'unknown');
            const distance = status === 'TRANSIT' ? `, ${this.formatDistance(this.normalizeMovementDistance(event.distance_traveled_km))}` : '';
            return `L${event.line ?? 0} ${status} ${place}${distance}`;
        }).join('; ');
    }

    summarizeNavigationUpdate(update) {
        if (!update || typeof update !== 'object') return 'legacy navigation intent';
        const layer = (name) => {
            const value = update[name] || {};
            const operation = String(value.operation || 'KEEP').toUpperCase();
            const destination = value.destination || value.destination_mention;
            return `${name}=${operation}${destination ? `(${destination})` : ''}`;
        };
        const deliberation = update.deliberation || {};
        return `${layer('journey')}, ${layer('immediate')}, deliberation=${String(deliberation.operation || 'KEEP').toUpperCase()}(${Array.isArray(deliberation.options) ? deliberation.options.length : 0})`;
    }

    buildLocationUpdateBrief(locationTimeline = [], navigationTimeline = []) {
        const actions = [];
        const reasons = [];
        const addAction = (text) => {
            const normalized = String(text || '').replace(/\s+/g, ' ').trim();
            if (normalized && !actions.includes(normalized)) actions.push(normalized);
        };

        for (const event of locationTimeline || []) {
            const status = String(event?.status || 'STAYED').toUpperCase();
            const place = String(event?.specific_location || event?.name || event?.anchor_node || event?.anchor || 'the previous location').trim();
            if (status === 'TRANSIT') {
                const destination = String(event?.destination || event?.destination_mention || 'an unresolved destination').trim();
                const distance = this.normalizeMovementDistance(event?.distance_traveled_km ?? event?.movement_distance_km);
                addAction(`Recorded the party in transit toward ${destination}${distance > 0 ? ` after ${this.formatDistance(distance)} of travel` : ''}.`);
            } else if (status === 'ARRIVED') {
                addAction(`Recorded the party's arrival at ${place}.`);
            } else {
                addAction(`Kept the party at ${place}; no map-level departure was established.`);
            }

            const reasoning = String(event?.reasoning || '').replace(/\s+/g, ' ').trim();
            if (reasoning && !reasons.includes(reasoning)) reasons.push(reasoning.slice(0, 500));
        }

        const navigationEntries = (Array.isArray(navigationTimeline) ? navigationTimeline : [])
            .filter((entry) => entry?.state)
            .sort((left, right) => Number(left.line || 0) - Number(right.line || 0));
        if (navigationEntries.length > 0) {
            const first = navigationCopilot.normalizeNavigationState(navigationEntries[0].state);
            const last = navigationCopilot.normalizeNavigationState(navigationEntries.at(-1).state);
            const firstJourney = first.journey_target?.name || first.journey_plan?.destination?.name || '';
            const lastJourney = last.journey_target?.name || last.journey_plan?.destination?.name || '';
            const firstTarget = first.active_target?.name || '';
            const lastTarget = last.active_target?.name || '';

            if (firstJourney !== lastJourney) {
                addAction(lastJourney
                    ? `${firstJourney ? 'Changed' : 'Recorded'} the broader journey intent${firstJourney ? ` from ${firstJourney}` : ''} to ${lastJourney}.`
                    : `Cleared the broader journey intent to ${firstJourney}.`);
            }
            if (firstTarget !== lastTarget) {
                addAction(lastTarget
                    ? `${firstTarget ? 'Changed' : 'Set'} the immediate navigation target${firstTarget ? ` from ${firstTarget}` : ''} to ${lastTarget}.`
                    : `Cleared the immediate navigation target to ${firstTarget}.`);
            }
        }

        if (actions.length === 0) return '';
        if (reasons.length > 0) actions.push(`Reasoning: ${reasons.slice(0, 3).join(' ')}`);
        return actions.map((line) => `- ${line}`).join('\n');
    }

    async buildPreviousTurnUpdatePrompt(turnContext) {
        const previousTurnNumber = Number(turnContext?.turnNumber || 0) - 1;
        if (previousTurnNumber < 1) return '';

        let previousContext = null;
        if (typeof turnContext?.getPreviousChapter === 'function') {
            try {
                previousContext = await turnContext.getPreviousChapter();
            } catch {
                previousContext = null;
            }
        }
        previousContext = previousContext || {
            projectName: turnContext?.projectName,
            rootDirectory: turnContext?.rootDirectory,
            turnNumber: previousTurnNumber
        };

        const locationTimeline = await this.getLocationTimelineForTurn(previousContext);
        const navigationTimeline = await this.getNavigationTimelineForContext(previousContext);
        return this.buildLocationUpdateBrief(locationTimeline, navigationTimeline);
    }

    buildGroundingCandidate(candidate, currentLocation) {
        const node = candidate.node;
        const travel = currentLocation ? this.calculateTravel(currentLocation, node) : null;
        return {
            uid: node.uid,
            name: node.name,
            type: node.type || '',
            region: node.region || '',
            parent_nation: node.parent_nation || '',
            tags: node.tags || '',
            description: String(node.description || '').slice(0, 500),
            lexical_score: Number(candidate.score.toFixed(3)),
            distance_km: travel?.distanceKm ?? null,
            direction: currentLocation ? this.getCardinalDirection(currentLocation, node) : null
        };
    }

    async groundLocationAnalysis(result, messages, currentLocation, previousNavigationState, options = {}) {
        const allowLlm = options.allowLlm !== false;
        const references = destinationGrounding.collectReferences(result, previousNavigationState);
        if (references.length === 0) return result;

        const decisions = new Map();
        const unresolved = [];
        for (const reference of references) {
            const exact = destinationGrounding.exactNode(this.worldData?.nodes || [], reference.mention);
            if (exact) {
                decisions.set(reference.key, { outcome: 'mapped', selected_node: exact, candidates: [] });
                continue;
            }
            const candidates = destinationGrounding.rankCandidates(this.worldData?.nodes || [], reference.mention, 5);
            if (candidates.length === 0) {
                decisions.set(reference.key, { outcome: 'unmapped', selected_node: null, candidates: [] });
            } else {
                unresolved.push({ ...reference, candidates });
            }
        }

        if (unresolved.length > 0 && !allowLlm) {
            for (const item of unresolved) {
                decisions.set(item.key, {
                    outcome: 'ambiguous',
                    selected_node: null,
                    candidates: item.candidates.map(candidate => ({ uid: String(candidate.node.uid || ''), name: candidate.node.name }))
                });
            }
        } else if (unresolved.length > 0) {
            try {
                const template = await fs.readFile(path.join(__dirname, 'prompts', 'destination_grounding.txt'), 'utf8');
                const payload = unresolved.map(item => ({
                    key: item.key,
                    mention: item.mention,
                    uses: item.references,
                    candidates: item.candidates.map(candidate => this.buildGroundingCandidate(candidate, currentLocation))
                }));
                const userMessage = { role: 'user', content: template.replace('${references}', JSON.stringify(payload, null, 2)) };
                messages.push(userMessage);
                const modelDef = this.getLocationModel();
                const response = await this.tools.llm.json({
                    msg: 'Location Destination Grounding',
                    requestId: 'location_destination_grounding',
                    prompt: { messages: messages.map((message, index) => ({
                        role: message.role,
                        piece: `history.message_${index + 1}`,
                        text: String(message.content ?? '')
                    })) },
                    model: modelDef.model || 'mediumendmodel',
                    provider: modelDef.provider,
                    callingModule: 'Plugin:world_location_tracker:destination_grounding'
                });
                messages.push({ role: 'assistant', content: JSON.stringify(response?.content || {}) });
                const rawByKey = new Map((response?.content?.resolutions || []).map(item => [destinationGrounding.normalizeText(item?.key), item]));
                for (const item of unresolved) {
                    const validated = destinationGrounding.validateDecision(rawByKey.get(item.key), item);
                    decisions.set(item.key, {
                        ...validated,
                        candidates: item.candidates.map(candidate => ({ uid: String(candidate.node.uid || ''), name: candidate.node.name }))
                    });
                }
            } catch (error) {
                this.tools.logger.warn('DestinationGrounding', `Destination grounding failed: ${error.message}`);
                for (const item of unresolved) {
                    decisions.set(item.key, {
                        outcome: 'ambiguous',
                        selected_node: null,
                        candidates: item.candidates.map(candidate => ({ uid: String(candidate.node.uid || ''), name: candidate.node.name }))
                    });
                }
            }
        }

        const grounded = JSON.parse(JSON.stringify(result));
        const decisionFor = mention => decisions.get(destinationGrounding.normalizeText(mention));
        for (const event of grounded.location_events || []) {
            const anchorMention = event.anchor_reference || event.anchor_node || event.location;
            const anchorDecision = decisionFor(anchorMention);
            if (anchorDecision) {
                event.anchor_reference = anchorMention;
                event.anchor_map_status = anchorDecision.outcome;
                event.anchor_node = anchorDecision.selected_node?.name || null;
                event.anchor_node_uid = anchorDecision.selected_node?.uid || null;
            }
            const destinationMention = event.destination_mention || event.destination;
            const destinationDecision = decisionFor(destinationMention);
            if (destinationDecision) {
                event.destination_mention = destinationMention;
                event.destination_map_status = destinationDecision.outcome;
                event.destination = destinationDecision.selected_node?.name || destinationMention;
                event.destination_uid = destinationDecision.selected_node?.uid || null;
                event.destination_candidates = destinationDecision.candidates;
            }
        }

        const intent = grounded.navigation_intent || {};
        let intentMention = intent.destination_mention || intent.destination;
        let intentOperation = String(intent.operation || 'KEEP').toUpperCase();
        if (intentOperation === 'KEEP' && previousNavigationState?.active_target?.map_status === 'ambiguous') {
            intentMention = previousNavigationState.active_target.name;
            const pendingDecision = decisionFor(intentMention);
            if (pendingDecision && pendingDecision.outcome !== 'ambiguous') {
                intentOperation = previousNavigationState.active_target.intent_operation || 'SET_JOURNEY';
                intent.operation = intentOperation;
                intent.destination_mention = intentMention;
                intent.confidence = 1;
            }
        }
        const intentDecision = decisionFor(intentMention);
        if (['SET_JOURNEY', 'SET_LEG'].includes(intentOperation) && intentDecision) {
            intent.destination_mention = intentMention;
            intent.destination = intentDecision.selected_node?.name || intentMention;
            intent.destination_grounding = {
                outcome: intentDecision.outcome,
                selected_node: intentDecision.selected_node,
                candidates: intentDecision.candidates
            };
        }
        grounded.navigation_intent = intent;

        const navigationUpdate = grounded.navigation_update;
        if (navigationUpdate && typeof navigationUpdate === 'object') {
            for (const layerName of ['journey', 'immediate']) {
                const layer = navigationUpdate[layerName];
                if (!layer || String(layer.operation || '').toUpperCase() !== 'SET') continue;
                const mention = layer.destination_mention || layer.destination;
                const decision = decisionFor(mention);
                if (!decision) continue;
                layer.destination_mention = mention;
                layer.destination = decision.selected_node?.name || mention;
                layer.destination_grounding = {
                    outcome: decision.outcome,
                    selected_node: decision.selected_node,
                    candidates: decision.candidates
                };
            }
            if (String(navigationUpdate.deliberation?.operation || '').toUpperCase() === 'REPLACE') {
                for (const option of navigationUpdate.deliberation.options || []) {
                    const mention = option.destination_mention || option.destination;
                    const decision = decisionFor(mention);
                    if (!decision) continue;
                    option.destination_mention = mention;
                    option.destination = decision.selected_node?.name || mention;
                    option.destination_grounding = {
                        outcome: decision.outcome,
                        selected_node: decision.selected_node,
                        candidates: decision.candidates
                    };
                }
            }
        }
        const outcomeCounts = { mapped: 0, unmapped: 0, ambiguous: 0 };
        for (const decision of decisions.values()) {
            if (Object.hasOwn(outcomeCounts, decision.outcome)) outcomeCounts[decision.outcome] += 1;
        }
        this.lastGroundingSummary = {
            references: references.length,
            deferred: allowLlm ? 0 : unresolved.length,
            used_llm: allowLlm && unresolved.length > 0,
            ...outcomeCounts
        };
        if (allowLlm) {
            this.logDecision(`Grounding: ${references.length} reference(s) -> ${outcomeCounts.mapped} mapped, ${outcomeCounts.unmapped} unmapped, ${outcomeCounts.ambiguous} ambiguous${unresolved.length ? ' (resolver LLM used)' : ' (deterministic)'}.`);
        }
        return grounded;
    }

    async getPreviousNavigationState(turnContext, previousChapter = null) {
        let previous = previousChapter;
        if (!previous && typeof turnContext?.getPreviousChapter === 'function') {
            try {
                previous = await turnContext.getPreviousChapter();
            } catch {
                previous = null;
            }
        }
        if (previous) {
            try {
                const state = this.tools.pluginState.fromContext(previous).turn().navigationState;
                if (state) return navigationCopilot.normalizeNavigationState(state);
            } catch {
                // Fall through to persisted facts.
            }
        }

        const projectName = this.getEffectiveProjectName(turnContext);
        const turnNumber = this.getFactBaseTurnNumber(turnContext);
        if (!projectName || turnNumber <= 1) return navigationCopilot.emptyNavigationState();
        try {
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts
                 WHERE project_name = ?
                   AND source = 'world_location_tracker'
                   AND predicate = 'navigation_state'
                   AND turn_number < ?
                 ORDER BY turn_number DESC, id DESC LIMIT 1`,
                [projectName, turnNumber]
            );
            return rows?.[0]?.fact_value
                ? navigationCopilot.normalizeNavigationState(JSON.parse(rows[0].fact_value))
                : navigationCopilot.emptyNavigationState();
        } catch {
            return navigationCopilot.emptyNavigationState();
        }
    }

    async getNavigationStateForContext(turnContext, options = {}) {
        const readContextState = () => {
            try {
                const state = this.tools.pluginState.fromContext(turnContext).turn().navigationState;
                return state ? navigationCopilot.normalizeNavigationState(state) : null;
            } catch {
                return null;
            }
        };
        if (!options.preferPersisted) {
            const contextState = readContextState();
            if (contextState) return contextState;
        }

        const projectName = this.getEffectiveProjectName(turnContext);
        const factTurnNumber = this.getFactBaseTurnNumber(turnContext);
        const displayTurnNumber = Number(turnContext?.turnNumber || 0);
        const turnKey = this.getFactTurnKey(turnContext);
        if (!projectName) return navigationCopilot.emptyNavigationState();
        try {
            const turnNumbers = [...new Set([factTurnNumber, displayTurnNumber]
                .filter(value => Number.isInteger(value) && value >= 1))];
            const placeholders = turnNumbers.length ? turnNumbers.map(() => '?').join(',') : '?';
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts
                 WHERE project_name = ?
                   AND source = 'world_location_tracker'
                   AND predicate = 'navigation_state'
                   AND (turn_key = ? OR turn_number IN (${placeholders}) OR turn_number <= ?)
                 ORDER BY
                   CASE
                     WHEN turn_key = ? THEN 0
                     WHEN turn_number = ? THEN 1
                     ELSE 2
                   END,
                   turn_number DESC,
                   id DESC LIMIT 1`,
                [
                    projectName,
                    turnKey,
                    ...(turnNumbers.length ? turnNumbers : [factTurnNumber || 999999]),
                    factTurnNumber || displayTurnNumber || 999999,
                    turnKey,
                    factTurnNumber || displayTurnNumber || 999999
                ]
            );
            if (rows?.[0]?.fact_value) {
                return navigationCopilot.normalizeNavigationState(JSON.parse(rows[0].fact_value));
            }
        } catch {
            // Fall through to the in-memory state.
        }
        return readContextState() || navigationCopilot.emptyNavigationState();
    }

    async buildNavigationAssistancePrompt(turnContext) {
        const state = await this.getNavigationStateForContext(turnContext);
        if (!this.isAutoNavigationPlanningEnabled() && state.manual_order?.status !== 'active') return '';
        return this.replaceDistanceMentions(navigationCopilot.buildNavigationPromptText(state));
    }

    async buildMovementConstraintPrompt(turnContext) {
        const policy = await this.getManualMovementPolicy();
        if (!policy.manual_movement_only) return '';
        const state = await this.getNavigationStateForContext(turnContext);
        const correction = await this.getPreviousMovementLockCorrection(turnContext);
        const order = state.manual_order?.status === 'active' ? state.manual_order : null;
        const lines = [
            'MANUAL MOVEMENT ONLY - HARD CONTINUITY CONSTRAINT',
            'The user has disabled automatic map travel. The party may move locally inside its current major/anchor location, such as between an inn, bazaar, tavern, room, or nearby street.',
            'Do not narrate departure from the current major location, map-level displacement, travel progress, or arrival at another mapped location unless an active user-issued world-map order below explicitly authorizes it.'
        ];
        if (order) {
            lines.push(`User-authorized exception: proceed only along the selected journey toward ${order.target.name}. This exception does not authorize unrelated travel.`);
            if (order.reason) lines.push(`The user's stated reason for this journey is: ${order.reason}`);
        } else {
            lines.push('There is no active user-authorized map journey. Keep the party within the current major location regardless of character suggestions or inferred intent.');
        }
        if (correction) lines.push('', correction);
        return lines.join('\n');
    }

    async persistNavigationState(turnContext, state, options = {}) {
        let normalized = navigationCopilot.normalizeNavigationState(state);
        const existing = navigationCopilot.normalizeNavigationState(this.tools.pluginState.turn().navigationState);
        const existingOrder = existing.manual_order;
        if (!options.allowUserRollback
            && existingOrder?.source === 'user_map'
            && existingOrder.issued_turn >= Number(turnContext?.turnNumber || 0)
            && existingOrder.id !== normalized.manual_order?.id) {
            this.logDecision(`Ignored stale navigation write after user map order ${existingOrder.id}.`);
            normalized = existing;
        }
        this.logDecision(`Navigation state: status=${normalized.status}, journey=${normalized.journey_target?.name || normalized.journey_plan?.destination?.name || 'none'}, immediate=${normalized.active_target?.name || 'none'}, deliberation=${normalized.deliberation?.options?.length || 0}.`);
        this.logDecision(`Navigation geometry debug: journey=${this.summarizePlanGeometryForDebug(normalized.journey_plan)}; active=${this.summarizePlanGeometryForDebug(normalized.active_leg_plan)}.`);
        this.tools.pluginState.turn().navigationState = normalized;
        turnContext.output.navigationState = normalized;
        const factScope = {
            turn_number: this.getFactBaseTurnNumber(turnContext),
            turn_key: this.getFactTurnKey(turnContext)
        };
        await this.tools.facts.cleanUpFactsDb({
            source: 'world_location_tracker',
            predicates: ['navigation_state'],
            ...factScope
        });
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker',
            target: 'party',
            predicate: 'navigation_state',
            fact_value: JSON.stringify(normalized),
            context: 'intent_aware_navigation_state'
        }, factScope);
        return normalized;
    }

    buildNavigationTimeline(previousState, finalState, rawUpdate = {}, movementTimeline = []) {
        const baseline = navigationCopilot.normalizeNavigationState(previousState);
        const final = navigationCopilot.normalizeNavigationState(finalState);
        const entries = [{ line: 0, state: baseline }];
        for (const item of movementTimeline || []) {
            if (!item?.state) continue;
            entries.push({ line: this.clampLineIndex(item.line, 999999), state: navigationCopilot.normalizeNavigationState(item.state) });
        }
        const lastMovementLine = Math.max(0, ...(movementTimeline || []).map(item => Number(item?.line || 0)).filter(Number.isFinite));
        const afterMovement = (line) => Math.max(lastMovementLine, Number(line || 0));

        const layered = rawUpdate?.navigation_update || rawUpdate;
        const changes = [];
        if (layered?.journey && String(layered.journey.operation || 'KEEP').toUpperCase() !== 'KEEP') {
            changes.push({ scope: 'journey', line: afterMovement(layered.journey.evidence_line) });
        }
        if (layered?.immediate && String(layered.immediate.operation || 'KEEP').toUpperCase() !== 'KEEP') {
            changes.push({ scope: 'immediate', line: afterMovement(layered.immediate.evidence_line) });
        }
        if (layered?.deliberation && String(layered.deliberation.operation || 'KEEP').toUpperCase() !== 'KEEP') {
            const lines = (layered.deliberation.options || []).flatMap(option => option.evidence_lines || []);
            changes.push({ scope: 'deliberation', line: afterMovement(lines.length ? Math.min(...lines.map(Number).filter(Number.isFinite)) : 0) });
        }
        if (!layered?.journey && rawUpdate?.navigation_intent && String(rawUpdate.navigation_intent.operation || 'KEEP').toUpperCase() !== 'KEEP') {
            changes.push({ scope: 'all', line: afterMovement(rawUpdate.navigation_intent.evidence_line) });
        }

        changes.sort((left, right) => left.line - right.line || ['journey', 'immediate', 'deliberation', 'all'].indexOf(left.scope) - ['journey', 'immediate', 'deliberation', 'all'].indexOf(right.scope));
        let current = entries.sort((left, right) => left.line - right.line).at(-1)?.state || baseline;
        for (const change of changes) {
            if (change.scope === 'all') {
                current = final;
            } else if (change.scope === 'journey') {
                current = navigationCopilot.normalizeNavigationState({
                    ...current,
                    journey_target: final.journey_target,
                    journey_plan: final.journey_plan
                });
            } else if (change.scope === 'immediate') {
                current = navigationCopilot.normalizeNavigationState({
                    ...current,
                    status: final.status,
                    active_target: final.active_target,
                    active_leg_plan: final.active_leg_plan,
                    last_reached_target: final.last_reached_target
                });
            } else if (change.scope === 'deliberation') {
                current = navigationCopilot.normalizeNavigationState({ ...current, deliberation: final.deliberation });
            }
            entries.push({ line: this.clampLineIndex(change.line, 999999), state: current });
        }

        if (changes.length === 0 && movementTimeline.length === 0) entries.push({ line: 0, state: final });
        const byLine = new Map();
        for (const entry of entries.sort((left, right) => left.line - right.line)) byLine.set(entry.line, entry);
        return [...byLine.values()].sort((left, right) => left.line - right.line).slice(0, 16);
    }

    async persistNavigationTimeline(turnContext, timeline) {
        const normalized = (timeline || []).map(entry => ({
            line: this.clampLineIndex(entry.line, 999999),
            state: navigationCopilot.normalizeNavigationState(entry.state)
        }));
        this.tools.pluginState.turn().navigationTimeline = normalized;
        turnContext.output.navigationTimeline = normalized;
        const factScope = {
            turn_number: this.getFactBaseTurnNumber(turnContext),
            turn_key: this.getFactTurnKey(turnContext)
        };
        await this.tools.facts.cleanUpFactsDb({ source: 'world_location_tracker', predicates: ['navigation_timeline'], ...factScope });
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker',
            target: 'party',
            predicate: 'navigation_timeline',
            fact_value: JSON.stringify(normalized),
            context: 'indexed_navigation_states'
        }, factScope);
        return normalized;
    }

    async getNavigationTimelineForContext(turnContext) {
        try {
            const timeline = this.tools.pluginState.fromContext(turnContext).turn().navigationTimeline;
            if (Array.isArray(timeline)) return timeline;
        } catch {
            // Fall through to facts.
        }
        const projectName = this.getEffectiveProjectName(turnContext);
        try {
            const factTurnNumber = this.getFactBaseTurnNumber(turnContext);
            const displayTurnNumber = Number(turnContext?.turnNumber || 0);
            const turnKey = this.getFactTurnKey(turnContext);
            const turnNumbers = [...new Set([factTurnNumber, displayTurnNumber]
                .filter(value => Number.isInteger(value) && value >= 1))];
            const placeholders = turnNumbers.length ? turnNumbers.map(() => '?').join(',') : '?';
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts
                 WHERE project_name = ? AND source = 'world_location_tracker'
                   AND predicate = 'navigation_timeline'
                   AND (turn_key = ? OR turn_number IN (${placeholders}))
                 ORDER BY
                   CASE
                     WHEN turn_key = ? THEN 0
                     WHEN turn_number = ? THEN 1
                     ELSE 2
                   END,
                   id DESC LIMIT 1`,
                [
                    projectName,
                    turnKey,
                    ...(turnNumbers.length ? turnNumbers : [factTurnNumber || displayTurnNumber || 0]),
                    turnKey,
                    factTurnNumber || displayTurnNumber || 0
                ]
            );
            const parsed = rows?.[0]?.fact_value ? JSON.parse(rows[0].fact_value) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    async getNavigationStateForDialogue(turnContext, dialogueIndex = null) {
        if (!Number.isInteger(dialogueIndex)) return await this.getNavigationStateForContext(turnContext);
        const timeline = await this.getNavigationTimelineForContext(turnContext);
        const eligible = timeline
            .filter(entry => Number(entry?.line) <= dialogueIndex)
            .sort((left, right) => Number(left.line) - Number(right.line));
        return eligible.length
            ? navigationCopilot.normalizeNavigationState(eligible.at(-1).state)
            : await this.getPreviousNavigationState(turnContext);
    }

    isNavigationTargetReached(location, target) {
        if (!location || !target?.name) return false;
        if (target.map_status && target.map_status !== 'mapped') return false;
        const anchorName = String(location.anchor || location.anchor_node || '').trim().toLowerCase();
        if (anchorName && anchorName === String(target.name).trim().toLowerCase() && String(location.status || location.type).toUpperCase() !== 'TRANSIT') {
            return true;
        }
        const node = this.findWorldNodeByName(target.name);
        if (!node) return false;
        const dx = Number(location.x) - Number(node.world_x);
        const dy = Number(location.y) - Number(node.world_y);
        return Number.isFinite(dx) && Number.isFinite(dy) && Math.sqrt((dx * dx) + (dy * dy)) <= 1;
    }

    applyNavigationArrival(rawState, currentLocation, turnNumber = 0) {
        const state = navigationCopilot.normalizeNavigationState(rawState);
        if (!state.active_target || !this.isNavigationTargetReached(currentLocation, state.active_target)) return state;
        const reachedTarget = { ...state.active_target, reached_turn: Number(turnNumber || 0) };
        const reachedJourneyDestination = state.journey_plan?.destination?.name
            && String(state.journey_plan.destination.name).toLowerCase() === String(state.active_target.name).toLowerCase();
        if (reachedJourneyDestination) {
            return {
                ...navigationCopilot.emptyNavigationState(),
                last_reached_target: reachedTarget,
                last_operation: 'KEEP'
            };
        }
        return {
            ...state,
            status: 'awaiting_intent',
            active_target: null,
            active_leg_plan: null,
            last_reached_target: reachedTarget,
            last_operation: 'KEEP'
        };
    }

    async inspectNavigationCorridor(start, end) {
        const dimensions = this.worldData?.meta?.dimensions || {};
        const dx = Number(end?.x) - Number(start?.x);
        const dy = Number(end?.y) - Number(start?.y);
        const mapSpanRatio = Math.sqrt((dx * dx) + (dy * dy))
            / Math.max(1, Number(dimensions.width || 0), Number(dimensions.height || 0));
        if (!this.worldPackagePath || !this.biomeMaskPath) {
            return { available: false, map_span_ratio: mapSpanRatio, corridor: [start, end] };
        }
        try {
            if (!this.biomeGridResultPromise) {
                this.biomeGridResultPromise = biomeNavigation.loadOrCreateNavigationGrid({
                    worldData: this.worldData,
                    packagePath: this.worldPackagePath,
                    biomeMaskPath: this.biomeMaskPath
                });
            }
            const gridResult = await this.biomeGridResultPromise;
            this.biomeGridResult = gridResult;
            if (!gridResult?.enabled || !gridResult.cache) {
                return { available: false, map_span_ratio: mapSpanRatio, corridor: [start, end], coverage: gridResult?.coverage || gridResult?.cache?.coverage || null };
            }
            return biomeNavigation.inspectStraightCorridor(gridResult.cache, this.worldData, start, end);
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Straight-corridor inspection failed: ${error.message}`);
            return { available: false, map_span_ratio: mapSpanRatio, corridor: [start, end] };
        }
    }

    async getBiomeNavigationStatus() {
        if (!this.worldPackagePath || !this.biomeMaskPath) return { enabled: false, coverage: null };
        try {
            if (!this.biomeGridResultPromise) {
                this.biomeGridResultPromise = biomeNavigation.loadOrCreateNavigationGrid({
                    worldData: this.worldData,
                    packagePath: this.worldPackagePath,
                    biomeMaskPath: this.biomeMaskPath
                });
            }
            const result = await this.biomeGridResultPromise;
            this.biomeGridResult = result;
            return { enabled: !!result?.enabled, coverage: result?.coverage || result?.cache?.coverage || null };
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Could not inspect biome navigation availability: ${error.message}`);
            return { enabled: false, coverage: null };
        }
    }

    async gatherRoutePlannerContext(turnContext, currentNarrative, previousScene) {
        let previousChapter = null;
        if (typeof turnContext?.getPreviousChapter === 'function') {
            try {
                previousChapter = await turnContext.getPreviousChapter();
            } catch {
                previousChapter = null;
            }
        }
        const party = this.normalizeCharacterList([
            ...(turnContext?.output?.party || []),
            ...(previousChapter?.output?.party || [])
        ]).slice(0, 6);
        const turnNumber = Number(turnContext?.turnNumber || 0);
        const characterContext = [];

        for (const name of party) {
            const sheet = await this.tools.plugins.tryCall('character_sheets', 'getCurrentSheet', [name, turnNumber], { fallback: null, silent: true });
            const traits = await this.tools.plugins.tryCall('personality_tracker', 'getTraitSummary', [name, { turnNumber }], { fallback: null, silent: true });
            const serialize = (value, limit) => {
                try {
                    return String(typeof value === 'string' ? value : JSON.stringify(value || '')).slice(0, limit);
                } catch {
                    return '';
                }
            };
            characterContext.push({
                name,
                sheet: serialize(sheet, 1200),
                traits: serialize(traits, 500)
            });
        }

        const relationships = await this.tools.plugins.tryCall(
            'relationship_tracker',
            'getRelationshipSummary',
            [party, { turnNumber }],
            { fallback: '', silent: true }
        );
        const history = turnContext?.runtime?.historyData?.compressedHistory || {};
        return {
            currentNarrative: String(currentNarrative || '').slice(0, 6000),
            previousScene: String(previousScene || '').slice(0, 3000),
            briefHistory: String(history.brief || history.medium || '').slice(0, 4000),
            party: characterContext,
            relationships: String(relationships || '').slice(0, 1500)
        };
    }

    getNavigationWorldSignature() {
        const gridSource = this.biomeGridResult?.cache?.source || null;
        const payload = {
            meta: this.worldData?.meta || {},
            nodes: (this.worldData?.nodes || []).map(node => [node.uid, node.world_x, node.world_y, node.name]),
            biomes: this.worldData?.biomes || null,
            gridSource
        };
        return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    }

    buildPlanningBasis(currentLocation, destinationNode) {
        return {
            origin_x: Number(currentLocation?.x),
            origin_y: Number(currentLocation?.y),
            target_uid: String(destinationNode?.uid || ''),
            world_signature: this.getNavigationWorldSignature()
        };
    }

    async isRoutePlanReusable(plan, currentLocation, destinationNode) {
        if (!this.biomeGridResult && this.worldPackagePath && this.biomeMaskPath) {
            await this.inspectNavigationCorridor(currentLocation, currentLocation);
        }
        const basis = plan?.planning_basis;
        return !!basis
            && String(basis.target_uid) === String(destinationNode?.uid || '')
            && basis.world_signature === this.getNavigationWorldSignature()
            && Math.abs(Number(basis.origin_x) - Number(currentLocation?.x)) < 1e-6
            && Math.abs(Number(basis.origin_y) - Number(currentLocation?.y)) < 1e-6;
    }

    normalizeLayerTarget(layer, scope) {
        const operation = String(layer?.operation || 'KEEP').toUpperCase();
        if (operation !== 'SET') return { operation, destination: null, evidence_line: Number(layer?.evidence_line || 0), confidence: Number(layer?.confidence || 0) };
        const normalized = navigationCopilot.normalizeNavigationIntent({
            ...layer,
            operation: scope === 'journey' ? 'SET_JOURNEY' : 'SET_LEG'
        }, this.worldData?.nodes || []);
        return { ...normalized, operation: normalized.operation === 'KEEP' ? 'KEEP' : 'SET' };
    }

    normalizeDeliberationOptions(options) {
        const deduped = new Map();
        for (const raw of Array.isArray(options) ? options : []) {
            if (!['', 'viable', 'proposed', 'contested'].includes(String(raw?.status || '').toLowerCase())) continue;
            const confidence = Math.max(0, Math.min(1, Number(raw?.confidence || 0)));
            if (confidence < navigationCopilot.INTENT_CONFIDENCE_THRESHOLD) continue;
            const normalized = navigationCopilot.normalizeNavigationIntent({
                operation: 'SET_JOURNEY',
                destination: raw.destination,
                destination_mention: raw.destination_mention,
                destination_grounding: raw.destination_grounding,
                confidence
            }, this.worldData?.nodes || []);
            if (!normalized.destination) continue;
            const target = normalized.destination;
            const key = target.uid || destinationGrounding.normalizeText(target.name);
            const supporters = this.normalizeCharacterList(raw.supporters);
            const opponents = this.normalizeCharacterList(raw.opponents);
            const evidenceLines = [...new Set((raw.evidence_lines || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
            const existing = deduped.get(key);
            if (existing) {
                existing.supporters = this.normalizeCharacterList([...existing.supporters, ...supporters]);
                existing.opponents = this.normalizeCharacterList([...existing.opponents, ...opponents]);
                existing.evidence_lines = [...new Set([...existing.evidence_lines, ...evidenceLines])].sort((a, b) => a - b);
                existing.confidence = Math.max(existing.confidence, confidence);
            } else {
                deduped.set(key, {
                    target,
                    supporters,
                    opponents,
                    evidence_lines: evidenceLines,
                    confidence,
                    reasoning: String(raw.reasoning || '').slice(0, 1000),
                    route_plan: null
                });
            }
        }
        return [...deduped.values()].sort((left, right) => {
            if (left.confidence !== right.confidence) return right.confidence - left.confidence;
            if (left.supporters.length !== right.supporters.length) return right.supporters.length - left.supporters.length;
            return (right.evidence_lines.at(-1) || 0) - (left.evidence_lines.at(-1) || 0);
        }).slice(0, navigationCopilot.MAX_DELIBERATION_OPTIONS);
    }

    async prepareDeliberationRoute(turnContext, currentLocation, option) {
        if (option.target.map_status !== 'mapped') return { option, kind: option.target.map_status };
        const destinationNode = this.findWorldNodeByName(option.target.name);
        if (!destinationNode) return { option, kind: 'ambiguous' };
        const start = { x: Number(currentLocation.x), y: Number(currentLocation.y) };
        const end = { x: Number(destinationNode.world_x), y: Number(destinationNode.world_y) };
        const inspection = await this.inspectNavigationCorridor(start, end);
        const maxRatio = this.getSimpleNavigationMapSpanPercent() / 100;
        if (navigationCopilot.isSimpleCorridor(inspection, this.getSimpleNavigationMapSpanPercent())
            || (!inspection.available && inspection.map_span_ratio <= maxRatio)) {
            this.logDecision(`Route option '${destinationNode.name}': simple deterministic guidance; route-selection LLM skipped.`);
            const summary = navigationCopilot.buildSimpleSummary(destinationNode.name, this.getCardinalDirection(currentLocation, destinationNode), inspection, !!inspection.available);
            return {
                option,
                kind: 'planned',
                plan: this.buildAcceptedPlan({ destinationNode, selectionSource: 'simple', summary, corridor: inspection.corridor || [start, end], turnNumber: turnContext.turnNumber, currentLocation })
            };
        }
        let analysis;
        try {
            analysis = await this.analyzeBiomeRouteBetweenCoordinates(turnContext, start, end, { routeCount: 4, includeDebugPaths: true });
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Deliberation route analysis failed for ${destinationNode.name}: ${error.message}`);
        }
        if (!analysis?.enabled || !analysis.routes?.length) {
            const recognized = Number(inspection.coverage?.recognized ?? inspection.coverage?.recognized_ratio);
            const painted = Number(inspection.coverage?.painted ?? inspection.coverage?.painted_ratio);
            const coverageText = Number.isFinite(recognized)
                ? ` Recognized biome coverage is ${(recognized * 100).toFixed(2)}%${Number.isFinite(painted) ? `; painted coverage is ${(painted * 100).toFixed(2)}%` : ''}.`
                : '';
            this.logDecision(`Route option '${destinationNode.name}': biome pathfinding unavailable.${coverageText} Straight-line fallback saved; route-selection LLM skipped.`);
            return {
                option,
                kind: 'planned',
                plan: this.buildAcceptedPlan({ destinationNode, selectionSource: 'fallback', summary: analysis?.fallback?.text || `Proceed directly toward ${destinationNode.name}; detailed terrain routing is unavailable.`, corridor: [start, end], turnNumber: turnContext.turnNumber, currentLocation })
            };
        }
        this.logDecision(`Route option '${destinationNode.name}': generated ${analysis.routes.length} alternative(s) for batched selection.`);
        return { option, kind: 'complex', destinationNode, routes: analysis.routes, start, end };
    }

    async chooseDeliberationRoutes(turnContext, groups, plannerContext, messages = []) {
        if (!groups.length) return new Map();
        try {
            const template = await fs.readFile(path.join(__dirname, 'prompts', 'navigation_deliberation_planner.txt'), 'utf8');
            const payload = groups.map(group => ({
                target_uid: group.destinationNode.uid,
                destination: group.destinationNode.name,
                routes: group.routes.map(route => ({
                    id: route.id,
                    title: route.title,
                    distance: route.distanceDisplay || this.formatDistance(route.distanceKm),
                    notes: route.notes,
                    journey_stops: route.journey_stops,
                    nearby_pois: route.nearby_pois,
                    text: route.text
                }))
            }));
            messages.push({ role: 'user', content: template.replace('${groups}', JSON.stringify(payload, null, 2)).replace('${story_context}', JSON.stringify(plannerContext, null, 2)) });
            const modelDef = this.getLocationModel();
            const response = await this.tools.llm.json({
                msg: 'Navigation Deliberation Route Planning',
                requestId: 'navigation_deliberation_routing',
                prompt: { messages: messages.map((message, index) => ({
                    role: message.role,
                    piece: `history.message_${index + 1}`,
                    text: String(message.content ?? '')
                })) },
                model: modelDef.model || 'mediumendmodel',
                provider: modelDef.provider,
                callingModule: 'Plugin:world_location_tracker:navigation_deliberation'
            });
            messages.push({ role: 'assistant', content: JSON.stringify(response?.content || {}) });
            const selections = new Map((response?.content?.selections || []).map(selection => [String(selection.target_uid), selection]));
            const result = new Map();
            for (const group of groups) {
                const normalized = navigationCopilot.normalizePlannerResult(selections.get(String(group.destinationNode.uid)), group.routes, this.worldData?.nodes || [], group.destinationNode);
                if (normalized) result.set(String(group.destinationNode.uid), normalized);
            }
            return result;
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Batched deliberation route planning failed: ${error.message}`);
            return new Map();
        }
    }

    async planDeliberationOptions(turnContext, currentLocation, options, contextData = {}) {
        this.logDecision(`Deliberation: researching ${options.length} live travel option(s).`);
        const prepared = [];
        for (const option of options) prepared.push(await this.prepareDeliberationRoute(turnContext, currentLocation, option));
        const complex = prepared.filter(item => item.kind === 'complex');
        const plannerContext = complex.length
            ? await this.gatherRoutePlannerContext(turnContext, contextData.currentNarrative, contextData.previousScene)
            : {};
        const selections = await this.chooseDeliberationRoutes(turnContext, complex, plannerContext, contextData.messages || []);
        if (complex.length) this.logDecision(`Deliberation: batched route selection completed for ${complex.length} complex destination(s).`);
        return prepared.map(item => {
            if (item.kind !== 'complex') return item.plan ? { ...item.option, route_plan: item.plan } : item.option;
            const selected = selections.get(String(item.destinationNode.uid));
            const route = selected?.selectedRoute || navigationCopilot.chooseFallbackRoute(item.routes);
            this.logDecision(`Route option '${item.destinationNode.name}': ${selected ? 'selected' : 'fallback selected'} '${route?.title || route?.id || 'direct'}'.`);
            const plan = this.buildAcceptedPlan({
                destinationNode: item.destinationNode,
                route,
                selectionSource: selected ? 'route_llm' : 'fallback',
                summary: selected?.summary || route?.text,
                waypoints: selected?.waypoints || [],
                suggestedNextWaypoint: selected?.suggested_next_waypoint || null,
                requirements: selected?.requirements || [],
                corridor: route?.debug_path || [item.start, item.end],
                turnNumber: turnContext.turnNumber,
                currentLocation,
                narrativeDurationDays: selected?.narrative_duration_days,
                durationLabel: selected?.duration_label
            });
            return { ...item.option, route_plan: plan };
        });
    }

    async chooseComplexNavigationRoute(turnContext, routes, destinationNode, plannerContext, previousState, messages = []) {
        try {
            const promptTemplate = await fs.readFile(path.join(__dirname, 'prompts', 'navigation_route_planner.txt'), 'utf8');
            const prompt = promptTemplate
                .replace('${destination}', destinationNode.name)
                .replace('${routes}', JSON.stringify(routes.map(route => ({
                    id: route.id,
                    title: route.title,
                    mode_label: route.mode_label,
                    distance: route.distanceDisplay || this.formatDistance(route.distanceKm),
                    notes: route.notes,
                    journey_stops: route.journey_stops,
                    nearby_pois: route.nearby_pois,
                    text: route.text
                })), null, 2))
                .replace('${story_context}', JSON.stringify(plannerContext, null, 2))
                .replace('${navigation_state}', this.replaceDistanceMentions(navigationCopilot.buildNavigationPromptText(previousState)) || 'No existing accepted navigation plan.');
            const modelDef = this.getLocationModel();
            messages.push({ role: 'user', content: prompt });
            const response = await this.tools.llm.json({
                msg: 'Navigation Route Planning',
                requestId: 'navigation_route_planning',
                prompt: { messages: messages.map((message, index) => ({
                    role: message.role,
                    piece: `history.message_${index + 1}`,
                    text: String(message.content ?? '')
                })) },
                model: modelDef.model || 'mediumendmodel',
                provider: modelDef.provider,
                callingModule: 'Plugin:world_location_tracker:navigation_copilot'
            });
            messages.push({ role: 'assistant', content: JSON.stringify(response?.content || {}) });
            return navigationCopilot.normalizePlannerResult(response?.content, routes, this.worldData?.nodes || [], destinationNode);
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Route planning LLM failed: ${error.message}`);
            return null;
        }
    }

    buildAcceptedPlan({ destinationNode, route, selectionSource, summary, waypoints = [], suggestedNextWaypoint = null, requirements = [], corridor = [], turnNumber, currentLocation = null, status = 'active', narrativeDurationDays = null, durationLabel = '' }) {
        const normalizedCorridor = navigationCopilot.downsampleCorridor(corridor);
        const distanceKm = Number.isFinite(Number(route?.distanceKm))
            ? Number(Number(route.distanceKm).toFixed(1))
            : Number(this.corridorDistanceKm(normalizedCorridor).toFixed(1));
        const routeDurationDays = Number(narrativeDurationDays ?? route?.narrative_duration_days);
        const narrativeDuration = Number.isFinite(routeDurationDays) && routeDurationDays > 0
            ? Number(routeDurationDays.toFixed(2))
            : (distanceKm > 0 ? Number((distanceKm / this.resolveTravelScale().baseSpeed).toFixed(2)) : null);
        const resolvedDurationLabel = String(durationLabel || route?.duration_label || '').trim()
            || (narrativeDuration ? this.generateTimeText(narrativeDuration) : '');
        return {
            destination: navigationCopilot.nodeRef(destinationNode),
            selected_route_id: route?.id || 'direct',
            selection_source: selectionSource,
            summary: String(summary || route?.text || '').trim(),
            waypoints: navigationCopilot.normalizeWaypoints(waypoints),
            suggested_next_waypoint: suggestedNextWaypoint,
            route_notes: [...new Set([...(route?.notes || []), ...requirements].filter(Boolean))],
            corridor: normalizedCorridor,
            remaining_corridor: normalizedCorridor,
            route_profile: {
                id: route?.id || 'direct',
                mode: route?.mode_label || selectionSource || ''
            },
            distance_km: distanceKm || null,
            narrative_duration_days: narrativeDuration,
            duration_label: resolvedDurationLabel,
            planning_basis: currentLocation ? this.buildPlanningBasis(currentLocation, destinationNode) : null,
            created_turn: turnNumber,
            updated_turn: turnNumber,
            status
        };
    }

    buildActiveLegPlan(plan, target, turnNumber) {
        if (!plan) {
            return navigationCopilot.normalizeRoutePlan({
                destination: target,
                summary: `The destination ${target?.name || 'unknown'} is not grounded to a mapped route.`,
                selected_route_id: 'unmapped',
                corridor: [],
                status: 'provisional',
                created_turn: turnNumber
            });
        }
        return navigationCopilot.normalizeRoutePlan({
            ...plan,
            destination: target || plan.destination,
            status: 'active',
            created_turn: turnNumber
        });
    }

    hasRenderableRoutePlan(plan) {
        const normalized = navigationCopilot.normalizeRoutePlan(plan);
        const points = [
            ...(normalized?.corridor || []),
            ...(normalized?.remaining_corridor || [])
        ];
        return points.filter(point =>
            Number.isFinite(Number(point?.x))
            && Number.isFinite(Number(point?.y))
        ).length >= 2;
    }

    navigationTargetsMatch(left, right) {
        const leftKey = String(left?.uid || left?.name || '').toLowerCase();
        const rightKey = String(right?.uid || right?.name || '').toLowerCase();
        return !!leftKey && !!rightKey && leftKey === rightKey;
    }

    findWorldNodeForTarget(target) {
        if (!target) return null;
        return this.findWorldNodeByUid(target.uid) || this.findWorldNodeByName(target.name);
    }

    async repairIncompleteJourneyRoute(turnContext, rawState, currentLocation, contextData = {}) {
        const state = navigationCopilot.normalizeNavigationState(rawState);
        const target = state.journey_target || state.journey_plan?.destination;
        if (!target) return state;
        if (target.map_status && target.map_status !== 'mapped') {
            this.logDecision(`Navigation repair skipped: journey target '${target.name || 'unknown'}' is not mapped.`);
            return state;
        }

        const destinationNode = this.findWorldNodeForTarget(target);
        if (!destinationNode) {
            this.logDecision(`Navigation repair skipped: journey target '${target.name || 'unknown'}' could not be resolved to a world node.`);
            return state;
        }

        const journeyPlanUsable = this.hasRenderableRoutePlan(state.journey_plan);
        const activeMatchesJourney = this.navigationTargetsMatch(state.active_target, target);
        const activeLegUsable = this.hasRenderableRoutePlan(state.active_leg_plan);
        if (journeyPlanUsable && (!activeMatchesJourney || activeLegUsable)) return state;

        if (!Number.isFinite(Number(currentLocation?.x)) || !Number.isFinite(Number(currentLocation?.y))) {
            this.logDecision(`Navigation repair skipped: journey '${destinationNode.name}' has no current map coordinates.`);
            return state;
        }

        this.logDecision(`Navigation repair: journey '${destinationNode.name}' had no usable route plan; planning now.`);
        const result = await this.planNavigationRoute(turnContext, currentLocation, destinationNode, contextData, state);
        if (result?.reached || !result?.plan) {
            this.logDecision(`Navigation repair skipped: journey '${destinationNode.name}' is already reached or produced no route plan.`);
            return state;
        }
        if (!this.hasRenderableRoutePlan(result.plan)) {
            this.logDecision(`Navigation repair skipped: journey '${destinationNode.name}' produced no drawable route corridor.`);
            return state;
        }

        const repairedPlan = navigationCopilot.normalizeRoutePlan(result.plan);
        const repairedTarget = navigationCopilot.nodeRef(destinationNode);
        const nextState = {
            ...state,
            journey_target: state.journey_target || repairedTarget,
            journey_plan: repairedPlan
        };

        if (!nextState.active_target || activeMatchesJourney) {
            nextState.active_target = {
                ...(nextState.active_target || repairedTarget),
                ...repairedTarget,
                source_turn: nextState.active_target?.source_turn || turnContext?.turnNumber,
                intent_operation: nextState.active_target?.intent_operation || 'SET_JOURNEY'
            };
            nextState.active_leg_plan = this.buildActiveLegPlan(repairedPlan, nextState.active_target, turnContext?.turnNumber);
        }

        nextState.status = nextState.active_target ? 'active' : (nextState.journey_target ? 'awaiting_intent' : 'idle');
        nextState.last_operation = nextState.last_operation || 'KEEP';
        return navigationCopilot.normalizeNavigationState(nextState);
    }

    isJourneyWaypoint(state, target) {
        const targetKey = String(target?.uid || target?.name || '').toLowerCase();
        return !!targetKey && (state?.journey_plan?.waypoints || []).some(waypoint =>
            waypoint.status === 'pending'
            && String(waypoint.uid || waypoint.name || '').toLowerCase() === targetKey
        );
    }

    buildWaypointLegPlan(journeyPlan, target, turnNumber) {
        const plan = navigationCopilot.normalizeRoutePlan(journeyPlan);
        const node = this.findWorldNodeByName(target?.name);
        if (!plan || !node) return null;
        const projection = routeGeometry.projectPointToCorridor(
            { x: Number(node.world_x), y: Number(node.world_y) },
            plan.remaining_corridor
        );
        if (!projection) return null;
        const corridor = routeGeometry.normalizePoints([
            ...plan.remaining_corridor.slice(0, projection.segmentIndex + 1),
            { x: Number(node.world_x), y: Number(node.world_y) }
        ]);
        return navigationCopilot.normalizeRoutePlan({
            ...plan,
            destination: target,
            corridor,
            remaining_corridor: corridor,
            waypoints: [],
            summary: `Continue along the accepted journey route to ${target.name}.`,
            status: 'active',
            created_turn: turnNumber
        });
    }

    async planNavigationRoute(turnContext, currentLocation, destinationNode, contextData, previousState) {
        const turnNumber = Number(turnContext?.turnNumber || 0);
        const start = { x: Number(currentLocation.x), y: Number(currentLocation.y) };
        const end = { x: Number(destinationNode.world_x), y: Number(destinationNode.world_y) };
        if (this.isNavigationTargetReached(currentLocation, navigationCopilot.nodeRef(destinationNode))) {
            return { reached: true, plan: null };
        }

        const inspection = await this.inspectNavigationCorridor(start, end);
        if (inspection.same_cell) return { reached: true, plan: null };
        const maxRatio = this.getSimpleNavigationMapSpanPercent() / 100;
        const isUnverifiedSimple = !inspection.available && inspection.map_span_ratio <= maxRatio;
        if (navigationCopilot.isSimpleCorridor(inspection, this.getSimpleNavigationMapSpanPercent()) || isUnverifiedSimple) {
            this.logDecision(`Route '${destinationNode.name}': simple deterministic guidance; A* and route-selection LLM skipped.`);
            const summary = navigationCopilot.buildSimpleSummary(
                destinationNode.name,
                this.getCardinalDirection(currentLocation, destinationNode),
                inspection,
                !!inspection.available
            );
            return {
                reached: false,
                plan: this.buildAcceptedPlan({
                    destinationNode,
                    selectionSource: 'simple',
                    summary,
                    corridor: inspection.corridor || [start, end],
                    turnNumber,
                    currentLocation
                })
            };
        }

        let analysis;
        try {
            analysis = await this.analyzeBiomeRouteBetweenCoordinates(turnContext, start, end, {
                routeCount: 4,
                includeDebugPaths: true
            });
        } catch (error) {
            this.tools.logger.warn('NavigationCopilot', `Complex route analysis failed: ${error.message}`);
            analysis = { enabled: false, fallback: { text: `Proceed directly toward ${destinationNode.name}; detailed terrain routing is unavailable.` } };
        }
        if (!analysis.enabled || !Array.isArray(analysis.routes) || analysis.routes.length === 0) {
            const coverage = analysis.cache?.coverage;
            const painted = Number(coverage?.painted);
            this.logDecision(`Route '${destinationNode.name}': biome alternatives unavailable${Number.isFinite(painted) ? ` (${(painted * 100).toFixed(2)}% painted)` : ''}; straight-line fallback saved.`);
            return {
                reached: false,
                plan: this.buildAcceptedPlan({
                    destinationNode,
                    selectionSource: 'fallback',
                    summary: analysis.fallback?.text || `Proceed directly toward ${destinationNode.name}; detailed terrain routing is unavailable.`,
                    corridor: [start, end],
                    turnNumber,
                    currentLocation
                })
            };
        }

        this.logDecision(`Route '${destinationNode.name}' debug candidates: ${analysis.routes.map(route => this.summarizeRouteCandidateForDebug(route, start, end)).join(' || ')}`);

        const plannerContext = await this.gatherRoutePlannerContext(turnContext, contextData.currentNarrative, contextData.previousScene);
        const selected = await this.chooseComplexNavigationRoute(turnContext, analysis.routes, destinationNode, plannerContext, previousState, contextData.messages || []);
        if (selected) {
            this.logDecision(`Route '${destinationNode.name}': selected '${selected.selectedRoute?.title || selected.selectedRoute?.id}' from ${analysis.routes.length} generated alternative(s).`);
            const selectedDebugPath = Array.isArray(selected.selectedRoute?.debug_path) ? selected.selectedRoute.debug_path : [];
            this.logDecision(`Route '${destinationNode.name}' debug selected: id=${selected.selectedRoute?.id || 'unknown'}, fallback_corridor=${selectedDebugPath.length < 2}, ${this.summarizeRouteCandidateForDebug(selected.selectedRoute, start, end)}`);
            return {
                reached: false,
                plan: this.buildAcceptedPlan({
                    destinationNode,
                    route: selected.selectedRoute,
                    selectionSource: 'route_llm',
                    summary: selected.summary,
                    waypoints: selected.waypoints,
                    suggestedNextWaypoint: selected.suggested_next_waypoint,
                    requirements: selected.requirements,
                    corridor: selected.selectedRoute.debug_path || [start, end],
                    turnNumber,
                    currentLocation,
                    narrativeDurationDays: selected.narrative_duration_days,
                    durationLabel: selected.duration_label
                })
            };
        }

        const fallbackRoute = navigationCopilot.chooseFallbackRoute(analysis.routes);
        this.logDecision(`Route '${destinationNode.name}': planner output invalid or unavailable; fallback selected '${fallbackRoute?.title || fallbackRoute?.id || 'direct'}'.`);
        this.logDecision(`Route '${destinationNode.name}' debug fallback: ${this.summarizeRouteCandidateForDebug(fallbackRoute, start, end)}`);
        return {
            reached: false,
            plan: this.buildAcceptedPlan({
                destinationNode,
                route: fallbackRoute,
                selectionSource: 'fallback',
                summary: fallbackRoute?.text || `Proceed toward ${destinationNode.name}.`,
                corridor: fallbackRoute?.debug_path || [start, end],
                turnNumber,
                currentLocation
            })
        };
    }

    getForwardJourneyWaypoints(plan, currentLocation) {
        const normalized = navigationCopilot.normalizeRoutePlan(plan);
        if (!normalized) return [];
        const projection = routeGeometry.projectPointToCorridor(currentLocation, normalized.remaining_corridor || []);
        return normalized.waypoints.map((waypoint) => {
            if (waypoint.status !== 'pending') return waypoint;
            const node = this.findWorldNodeByName(waypoint.name);
            const waypointProjection = node
                ? routeGeometry.projectPointToCorridor(
                    { x: Number(node.world_x), y: Number(node.world_y) },
                    normalized.remaining_corridor || []
                )
                : null;
            if (projection && waypointProjection && waypointProjection.distance + 1e-6 < projection.distance) {
                return { ...waypoint, status: 'skipped' };
            }
            return waypoint;
        });
    }

    selectRouteForProfile(routes, profileId) {
        const id = String(profileId || 'straight');
        const aliases = {
            direct: ['straight'],
            poi_stops: ['poi_stops', 'poi_rich', 'road_favored', 'mixed_alt', 'straight'],
            avoid_difficult: ['avoid_difficult', 'avoid_slow_alt', 'road_favored', 'mixed_alt', 'straight'],
            road_favored: ['road_favored', 'mixed_alt', 'straight'],
            fallback: ['mixed_alt', 'straight']
        };
        const accepted = new Set([id, ...(aliases[id] || [])]);
        return (routes || []).find(route => accepted.has(String(route?.id || ''))) || null;
    }

    async rebuildJourneyPlanDeterministically(turnContext, currentLocation, oldPlan, destinationNode) {
        const normalized = navigationCopilot.normalizeRoutePlan(oldPlan);
        if (!normalized || !destinationNode) return null;
        const waypoints = this.getForwardJourneyWaypoints(normalized, currentLocation);
        const pendingNodes = waypoints
            .filter(waypoint => waypoint.status === 'pending')
            .map(waypoint => this.findWorldNodeByName(waypoint.name))
            .filter(Boolean);
        const targets = [...pendingNodes, destinationNode].filter((node, index, all) =>
            index === 0 || String(node.uid || node.name) !== String(all[index - 1]?.uid || all[index - 1]?.name)
        );
        const combined = [{ x: Number(currentLocation.x), y: Number(currentLocation.y) }];
        let segmentStart = combined[0];
        let provisional = false;

        for (const target of targets) {
            const targetPoint = { x: Number(target.world_x), y: Number(target.world_y) };
            const analysis = await this.analyzeBiomeRouteBetweenCoordinates(turnContext, segmentStart, targetPoint, {
                routeCount: 6,
                includeDebugPaths: true
            });
            if (!analysis?.enabled) {
                provisional = true;
                combined.push(targetPoint);
                segmentStart = targetPoint;
                continue;
            }
            const selected = this.selectRouteForProfile(analysis.routes, normalized.route_profile?.id || normalized.selected_route_id);
            if (!selected?.debug_path?.length) return null;
            combined.push(...selected.debug_path.slice(1));
            segmentStart = targetPoint;
        }

        return this.buildAcceptedPlan({
            destinationNode,
            route: {
                id: normalized.route_profile?.id || normalized.selected_route_id,
                mode_label: normalized.route_profile?.mode || 'preserved route strategy',
                debug_path: combined,
                notes: normalized.route_notes
            },
            selectionSource: provisional ? 'fallback' : 'deterministic_repath',
            summary: provisional
                ? `Resume toward ${destinationNode.name} through the remaining planned stops; detailed terrain routing is unavailable.`
                : `Resume the accepted journey toward ${destinationNode.name} from the party's current position.`,
            waypoints,
            suggestedNextWaypoint: waypoints.find(waypoint => waypoint.status === 'pending') || null,
            requirements: normalized.route_notes,
            corridor: combined,
            turnNumber: turnContext.turnNumber,
            currentLocation,
            status: provisional ? 'provisional' : 'active',
            narrativeDurationDays: normalized.narrative_duration_days,
            durationLabel: normalized.duration_label
        });
    }

    async resumeJourneyPlan(turnContext, currentLocation, state, destinationNode, contextData) {
        const rebuilt = await this.rebuildJourneyPlanDeterministically(
            turnContext,
            currentLocation,
            state.journey_plan,
            destinationNode
        );
        if (rebuilt) {
            this.logDecision(`Journey '${destinationNode.name}': resumed deterministically from the current pin.`);
            return rebuilt;
        }
        this.logDecision(`Journey '${destinationNode.name}': deterministic resume unavailable; selecting a fresh comparable route.`);
        return (await this.planNavigationRoute(turnContext, currentLocation, destinationNode, contextData, state)).plan;
    }

    async updateLayeredNavigationCopilot(turnContext, rawUpdate, previousState, currentLocation, contextData = {}) {
        if (!this.isAutoNavigationPlanningEnabled()) return navigationCopilot.normalizeNavigationState(previousState);
        let state = this.applyNavigationArrival(previousState, currentLocation, turnContext.turnNumber);
        const journey = this.normalizeLayerTarget(rawUpdate?.journey, 'journey');
        const immediate = this.normalizeLayerTarget(rawUpdate?.immediate, 'immediate');
        const previousJourneyName = state.journey_target?.name;
        const sameTarget = (left, right) => String(left?.uid || left?.name || '').toLowerCase() === String(right?.uid || right?.name || '').toLowerCase();
        const makeActive = (target, plan, intentOperation) => ({
            ...target,
            source_turn: turnContext.turnNumber,
            evidence_line: intentOperation.evidence_line,
            intent_operation: intentOperation.operation === 'SET' && intentOperation === journey ? 'SET_JOURNEY' : 'SET_LEG'
        });

        let committedThisTurn = false;
        if (journey.operation === 'SET' && journey.destination) {
            committedThisTurn = true;
            const target = journey.destination;
            let plan = null;
            if (target.map_status === 'mapped') {
                const node = this.findWorldNodeByName(target.name);
                const researched = state.deliberation?.options?.find(option => sameTarget(option.target, target));
                if (node && sameTarget(target, state.journey_target) && state.journey_plan?.status === 'suspended') {
                    plan = await this.resumeJourneyPlan(turnContext, currentLocation, state, node, contextData);
                } else if (node && researched?.route_plan && await this.isRoutePlanReusable(researched.route_plan, currentLocation, node)) {
                    plan = { ...researched.route_plan, updated_turn: turnContext.turnNumber };
                } else if (node) {
                    const result = await this.planNavigationRoute(turnContext, currentLocation, node, contextData, state);
                    plan = result.plan;
                }
            }
            state.journey_target = { ...target, source_turn: turnContext.turnNumber, evidence_line: journey.evidence_line };
            state.journey_plan = plan;
            state.deliberation = null;
            const activeWasJourney = !state.active_target || String(state.active_target.name || '').toLowerCase() === String(previousJourneyName || '').toLowerCase();
            if (immediate.operation !== 'SET' && activeWasJourney) {
                state.active_target = makeActive(target, plan, journey);
                state.active_leg_plan = this.buildActiveLegPlan(plan, target, turnContext.turnNumber);
            }
        } else if (['CLEAR', 'COMPLETE'].includes(journey.operation)) {
            if (!state.journey_target?.map_status || state.journey_target.map_status !== 'mapped' || journey.operation === 'CLEAR') {
                if (sameTarget(state.active_target, state.journey_target)) {
                    state.active_target = null;
                    state.active_leg_plan = null;
                }
                state.journey_target = null;
                state.journey_plan = null;
            }
        }

        if (immediate.operation === 'SET' && immediate.destination) {
            const target = immediate.destination;
            let plan = null;
            if (target.map_status === 'mapped') {
                const resumesJourney = sameTarget(target, state.journey_target) || this.isJourneyWaypoint(state, target);
                if (resumesJourney && state.journey_plan) {
                    const journeyNode = this.findWorldNodeByName(state.journey_target?.name);
                    const resumedJourney = state.journey_plan.status === 'suspended' && journeyNode
                        ? await this.resumeJourneyPlan(turnContext, currentLocation, state, journeyNode, contextData)
                        : state.journey_plan;
                    state.journey_plan = navigationCopilot.normalizeRoutePlan({ ...resumedJourney, status: 'active' });
                    plan = sameTarget(target, state.journey_target)
                        ? state.journey_plan
                        : this.buildWaypointLegPlan(state.journey_plan, target, turnContext.turnNumber);
                } else {
                    const node = this.findWorldNodeByName(target.name);
                    if (node) plan = (await this.planNavigationRoute(turnContext, currentLocation, node, contextData, state)).plan;
                }
            }
            state.active_target = makeActive(target, plan, immediate);
            state.active_leg_plan = this.buildActiveLegPlan(plan, target, turnContext.turnNumber);
            if (state.journey_plan && !sameTarget(target, state.journey_target) && !this.isJourneyWaypoint(state, target)) {
                state.journey_plan = navigationCopilot.normalizeRoutePlan({
                    ...state.journey_plan,
                    status: 'suspended',
                    suspended_turn: turnContext.turnNumber,
                    suspended_by: navigationCopilot.nodeRef(this.findWorldNodeByName(target.name)) || target
                });
            }
        } else if (['CLEAR', 'COMPLETE'].includes(immediate.operation)) {
            if (!state.active_target?.map_status || state.active_target.map_status !== 'mapped' || immediate.operation === 'CLEAR') {
                state.last_reached_target = immediate.operation === 'COMPLETE' && state.active_target
                    ? { ...state.active_target, reached_turn: turnContext.turnNumber }
                    : state.last_reached_target;
                state.active_target = null;
                state.active_leg_plan = null;
            }
        }

        const deliberationOperation = String(rawUpdate?.deliberation?.operation || 'KEEP').toUpperCase();
        if (deliberationOperation === 'CLEAR' || committedThisTurn) {
            state.deliberation = null;
        } else if (deliberationOperation === 'REPLACE') {
            const options = this.normalizeDeliberationOptions(rawUpdate.deliberation.options);
            state.deliberation = options.length ? {
                status: 'open',
                options: await this.planDeliberationOptions(turnContext, currentLocation, options, contextData),
                created_turn: state.deliberation?.created_turn || turnContext.turnNumber,
                updated_turn: turnContext.turnNumber
            } : null;
        }

        const completedInstantArrival = state.manual_order?.mode === 'instant'
            && state.manual_order?.status === 'completed'
            && !!state.last_reached_target;
        state.status = state.active_target
            ? 'active'
            : (state.journey_target || completedInstantArrival ? 'awaiting_intent' : 'idle');
        state.last_operation = committedThisTurn ? 'SET_JOURNEY' : (immediate.operation === 'SET' ? 'SET_LEG' : 'KEEP');
        state = await this.repairIncompleteJourneyRoute(turnContext, state, currentLocation, contextData);
        return await this.persistNavigationState(turnContext, state);
    }

    async updateNavigationCopilot(turnContext, rawIntent, previousState, currentLocation, contextData = {}) {
        if (!this.isAutoNavigationPlanningEnabled()) return navigationCopilot.normalizeNavigationState(previousState);

        let state = this.applyNavigationArrival(previousState, currentLocation, turnContext.turnNumber);
        const intent = navigationCopilot.normalizeNavigationIntent(rawIntent, this.worldData?.nodes || []);
        if (intent.operation === 'KEEP') {
            state.last_operation = 'KEEP';
            state = await this.repairIncompleteJourneyRoute(turnContext, state, currentLocation, contextData);
            return await this.persistNavigationState(turnContext, state);
        }
        if (intent.operation === 'CLEAR') {
            const cleared = {
                ...navigationCopilot.emptyNavigationState(),
                last_reached_target: state.last_reached_target,
                last_operation: 'CLEAR'
            };
            return await this.persistNavigationState(turnContext, cleared);
        }

        if (intent.operation === 'COMPLETE') {
            if (!state.active_target || state.active_target.map_status === 'mapped') {
                state.last_operation = 'KEEP';
                return await this.persistNavigationState(turnContext, state);
            }
            const reachedTarget = { ...state.active_target, reached_turn: turnContext.turnNumber };
            const completedLeg = state.active_target.intent_operation === 'SET_LEG' && !!state.journey_plan;
            return await this.persistNavigationState(turnContext, completedLeg ? {
                ...state,
                status: 'awaiting_intent',
                active_target: null,
                active_leg_plan: null,
                last_reached_target: reachedTarget,
                last_operation: 'COMPLETE'
            } : {
                ...navigationCopilot.emptyNavigationState(),
                last_reached_target: reachedTarget,
                last_operation: 'COMPLETE'
            });
        }

        const mapStatus = intent.destination?.map_status || (intent.destination?.uid ? 'mapped' : 'unmapped');
        const destinationNode = mapStatus === 'mapped' ? this.findWorldNodeByName(intent.destination?.name) : null;
        if (mapStatus === 'mapped' && !destinationNode) return await this.persistNavigationState(turnContext, state);
        const existingTargetName = String(state.active_target?.name || '').toLowerCase();
        if (existingTargetName && existingTargetName === String(intent.destination.name).toLowerCase()
            && state.active_target?.map_status === mapStatus && state.active_leg_plan) {
            state.last_operation = 'KEEP';
            return await this.persistNavigationState(turnContext, state);
        }

        const preserveJourney = intent.operation === 'SET_LEG' && !!state.journey_plan;
        if (mapStatus !== 'mapped') {
            const activeTarget = {
                ...intent.destination,
                source_turn: turnContext.turnNumber,
                evidence_line: intent.evidence_line,
                intent_operation: intent.operation
            };
            return await this.persistNavigationState(turnContext, {
                ...state,
                status: 'active',
                active_target: activeTarget,
                journey_plan: preserveJourney ? state.journey_plan : null,
                active_leg_plan: {
                    destination: intent.destination,
                    summary: `The narrative currently points toward ${intent.destination.name}, which is not grounded to one mapped node.`,
                    route_id: null,
                    created_turn: turnContext.turnNumber
                },
                last_reached_target: null,
                last_operation: intent.operation
            });
        }

        const resumesJourney = !!state.journey_plan
            && String(state.journey_target?.name || '').toLowerCase() === String(intent.destination?.name || '').toLowerCase()
            && state.journey_plan.status === 'suspended';
        const resumesWaypoint = preserveJourney && this.isJourneyWaypoint(state, intent.destination);
        let resumedPlan = null;
        if (resumesJourney || resumesWaypoint) {
            const journeyNode = this.findWorldNodeByName(state.journey_target?.name);
            const resumedJourney = journeyNode
                ? await this.resumeJourneyPlan(turnContext, currentLocation, state, journeyNode, contextData)
                : null;
            if (resumedJourney) {
                state.journey_plan = navigationCopilot.normalizeRoutePlan({ ...resumedJourney, status: 'active' });
                resumedPlan = resumesWaypoint
                    ? this.buildWaypointLegPlan(state.journey_plan, intent.destination, turnContext.turnNumber)
                    : state.journey_plan;
            }
        }
        const routeResult = resumedPlan
            ? { reached: false, plan: resumedPlan }
            : await this.planNavigationRoute(turnContext, currentLocation, destinationNode, contextData, state);
        if (routeResult.reached) {
            const reachedState = intent.operation === 'SET_LEG' && state.journey_plan
                ? {
                    ...state,
                    status: 'awaiting_intent',
                    active_target: null,
                    active_leg_plan: null,
                    last_reached_target: { ...intent.destination, reached_turn: turnContext.turnNumber },
                    last_operation: intent.operation
                }
                : {
                    ...navigationCopilot.emptyNavigationState(),
                    last_reached_target: { ...intent.destination, reached_turn: turnContext.turnNumber },
                    last_operation: intent.operation
                };
            return await this.persistNavigationState(turnContext, reachedState);
        }

        const activeTarget = {
            ...intent.destination,
            source_turn: turnContext.turnNumber,
            evidence_line: intent.evidence_line,
            intent_operation: intent.operation
        };
        const activeLegPlan = this.buildActiveLegPlan(routeResult.plan, intent.destination, turnContext.turnNumber);
        const nextState = {
            ...state,
            status: 'active',
            active_target: activeTarget,
            journey_plan: preserveJourney ? state.journey_plan : routeResult.plan,
            active_leg_plan: activeLegPlan,
            last_reached_target: null,
            last_operation: intent.operation
        };
        if (preserveJourney && !resumesWaypoint && nextState.journey_plan) {
            nextState.journey_plan = navigationCopilot.normalizeRoutePlan({
                ...nextState.journey_plan,
                status: 'suspended',
                suspended_turn: turnContext.turnNumber,
                suspended_by: intent.destination
            });
        }
        return await this.persistNavigationState(turnContext, nextState);
    }

    generateTimeText(days) {
        if (days < 0.2) return "A short walk";
        if (days < 1.0) return "A few hours";
        if (days < 1.5) return "A full day's travel";
        if (days < 3.0) return "About two days";
        if (days < 7.0) return "Several days";
        if (days < 10.0) return "Over a week";
        return "A long journey";
    }

    async ensureTables() {
        await this.tools.db.project.execute(`
            CREATE TABLE IF NOT EXISTS world_location_map_cache (
                map_path TEXT PRIMARY KEY,
                hash TEXT,
                tile_path TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    async calculateFileHash(filePath) {
        this.tools.logger.runtime(`Calculating hash for: ${filePath}`);
        try {
            const buffer = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(buffer).digest('hex');
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to calculate hash for ${filePath}: ${error.message}`);
            return null;
        }
    }

    isChildPath(targetPath, parentPath) {
        const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath));
        return !!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    }

    async removeTileDirectory(tilePath, root) {
        if (!tilePath || !root) return false;

        const pluginCacheRoot = path.join(root, 'plugins', 'world_location_tracker');
        if (!this.isChildPath(tilePath, pluginCacheRoot)) {
            this.tools.logger.warn('MapTiling', `Refusing to delete tile cache outside plugin cache root: ${tilePath}`);
            return false;
        }

        await fs.rm(tilePath, { recursive: true, force: true });
        return true;
    }

    async processMapTiling(turnContext, imagePath, packagePath = null) {
        this.tools.logger.runtime(`[MapTiling] Processing tiling for ${imagePath}`);
        await this.ensureTables();
        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory;
        if (!root) {
            this.tools.logger.warn('Logic', 'No root directory found, skipping tiling.');
            this.tools.logger.runtime(`[MapTiling] Processing tiling for ${imagePath} failed: No root`);
            return;
        }

        const absolutePath = path.resolve(imagePath);
        const fileHash = await this.calculateFileHash(absolutePath);
        if (!fileHash) {
            this.tools.logger.runtime(`[MapTiling] Processing tiling for ${imagePath} failed: Hash calculation failed`);
            return;
        }

        // Add format to hash to trigger retile if tile generation changes.
        const hash = crypto.createHash('sha256').update(fileHash + '_png_v3').digest('hex');

        const rows = await this.tools.db.project.query(
            "SELECT hash, tile_path FROM world_location_map_cache WHERE map_path = ?",
            [absolutePath]
        );

        const mapName = path.basename(imagePath, path.extname(imagePath)).replace(/[^a-z0-9_-]/gi, '_') || 'map';
        
        let tilesDir;
        let isPackageLocal = false;
        
        if (packagePath) {
            tilesDir = path.join(packagePath, 'tiles');
            isPackageLocal = true;
        } else {
            const relativeImagePath = path.relative(root, absolutePath);
            const pathHash = crypto.createHash('md5').update(relativeImagePath || absolutePath).digest('hex').slice(0, 12);
            tilesDir = path.join(root, 'plugins', 'world_location_tracker', 'tiles', `${mapName}_${pathHash}_${hash.slice(0, 10)}`);
        }
        
        const pluginCacheRoot = path.join(root, 'plugins', 'world_location_tracker');

        // Check if we can skip tiling
        if (rows && rows.length > 0 && rows[0].hash === hash) {
            try {
                // If it's package local, it doesn't need to be in the pluginCacheRoot
                if (!isPackageLocal && (!rows[0].tile_path || !this.isChildPath(rows[0].tile_path, pluginCacheRoot))) {
                    throw new Error('Cached tile path is outside the plugin cache root.');
                }
                await fs.access(rows[0].tile_path);
                this.tools.logger.runtime(`[MapTiling] Map tiles for ${mapName} are up to date.`);
                return rows[0].tile_path;
            } catch (error) {
                this.tools.logger.runtime(`[MapTiling] Cache entry for ${mapName} is unusable (${error.message}). Regenerating.`);
            }
        }

        this.tools.logger.runtime(`[MapTiling] Processing tiles for ${mapName}... (Large image detected)`);

        try {
            if (rows && rows.length > 0 && rows[0].tile_path && path.normalize(rows[0].tile_path) !== path.normalize(tilesDir)) {
                // Only remove if it was in the global cache. Package local tiles should be managed by the package.
                if (!isPackageLocal) {
                    await this.removeTileDirectory(rows[0].tile_path, root);
                }
            }

            await fs.rm(tilesDir, { recursive: true, force: true });
            await fs.mkdir(tilesDir, { recursive: true });

            // --- TILING LOGIC ---
            const sharp = require('sharp');

            this.tools.logger.runtime(`Starting tiling with Sharp: ${absolutePath} -> ${tilesDir}`);

            const sharpInstance = sharp(absolutePath);
            const meta = await sharpInstance.metadata();
            
            await sharpInstance
                .png()
                .tile({
                    size: 512,
                    overlap: 0,
                    layout: 'google'
                })
                .toFile(tilesDir);

            this.tools.logger.runtime(`[MapTiling] Tiling complete for ${mapName}.`);

            await this.tools.db.project.execute(
                "INSERT OR REPLACE INTO world_location_map_cache (map_path, hash, tile_path, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                [absolutePath, hash, tilesDir]
            );

            // Update world.json if it's a package
            if (packagePath) {
                const worldJsonPath = path.join(packagePath, 'world.json');
                try {
                    const content = await fs.readFile(worldJsonPath, 'utf8');
                    const worldData = JSON.parse(content);
                    worldData.meta = worldData.meta || {};
                    worldData.meta.dimensions = { width: meta.width, height: meta.height };
                    worldData.meta.is_compiled = true;
                    await fs.writeFile(worldJsonPath, JSON.stringify(worldData, null, 4), 'utf8');
                    this.tools.logger.runtime(`[MapTiling] Updated world.json with compilation metadata.`);
                } catch (err) {
                    this.tools.logger.error('MapTiling', `Failed to update world.json: ${err.message}`);
                }
            }

            return tilesDir;
        } catch (error) {
            this.tools.logger.error('MapTiling', `Tiling failed: ${error.message}. Make sure 'sharp' is installed.`);
            this.tools.logger.runtime(`[MapTiling] Tiling failed: ${error.message}`);
            return null;
        }
    }

    async deleteMapTiles(turnContext, imagePath) {
        if (!imagePath) return;

        await this.ensureTables();
        const absolutePath = path.resolve(imagePath);
        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory || this.turnContext?.rootDirectory;

        try {
            const rows = await this.tools.db.project.query(
                "SELECT tile_path FROM world_location_map_cache WHERE map_path = ?",
                [absolutePath]
            );

            if (rows && rows.length > 0 && rows[0].tile_path) {
                const removed = await this.removeTileDirectory(rows[0].tile_path, root);
                if (removed) {
                    this.tools.logger.runtime(`[MapTiling] Removed stale tiles for ${absolutePath}`);
                }
            }

            await this.tools.db.project.execute(
                "DELETE FROM world_location_map_cache WHERE map_path = ?",
                [absolutePath]
            );
        } catch (error) {
            this.tools.logger.warn('MapTiling', `Failed to remove stale tiles for ${absolutePath}: ${error.message}`);
        }
    }

    async getImageDimensions(imagePath) {
        if (!imagePath) return { width: 0, height: 0 };

        try {
            const sharp = require('sharp');
            const meta = await sharp(imagePath).metadata();
            return {
                width: meta.width || 0,
                height: meta.height || 0
            };
        } catch (error) {
            this.tools.logger.warn('MapTiling', `Failed to read image dimensions for ${imagePath}: ${error.message}`);
            return { width: 0, height: 0 };
        }
    }

    createDefaultWorldData() {
        return {
            meta: {
                image_file: '',
                origin_pixel_x: 0,
                origin_pixel_y: 0,
                scale_factor: 1.0,
                pixels_per_km: 7.0,
                base_walk_speed_kmpd: 30.0,
                winding_factor: 1.2,
                dimensions: { width: 0, height: 0 },
                is_compiled: false
            },
            nodes: [],
            areas: [],
            biomes: this.normalizeBiomes()
        };
    }

    toNumeric(value, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    normalizeWorldNode(node, index = 0) {
        const input = node && typeof node === 'object' ? node : {};
        const seed = JSON.stringify({
            index,
            name: input.name || '',
            x: input.world_x !== undefined ? input.world_x : input.x,
            y: input.world_y !== undefined ? input.world_y : input.y
        });

        return {
            ...input,
            uid: typeof input.uid === 'string' && input.uid.trim()
                ? input.uid.trim()
                : crypto.createHash('md5').update(seed).digest('hex').slice(0, 8),
            world_x: this.toNumeric(input.world_x !== undefined ? input.world_x : input.x, 0),
            world_y: this.toNumeric(input.world_y !== undefined ? input.world_y : input.y, 0),
            name: typeof input.name === 'string' ? input.name : '',
            type: typeof input.type === 'string' ? input.type : '',
            region: typeof input.region === 'string' ? input.region : '',
            parent_nation: typeof input.parent_nation === 'string' ? input.parent_nation : '',
            description: typeof input.description === 'string' ? input.description : '',
            tags: typeof input.tags === 'string' ? input.tags : ''
        };
    }

    normalizeWorldArea(area, index = 0) {
        const input = area && typeof area === 'object' ? area : {};
        const geometry = input.geometry && typeof input.geometry === 'object' ? input.geometry : {};
        const rawPoints = Array.isArray(geometry.points)
            ? geometry.points
            : (Array.isArray(input.points) ? input.points : []);

        const points = rawPoints
            .map((point) => {
                if (Array.isArray(point) && point.length >= 2) {
                    return [this.toNumeric(point[0], 0), this.toNumeric(point[1], 0)];
                }
                if (point && typeof point === 'object') {
                    return [this.toNumeric(point.x, 0), this.toNumeric(point.y, 0)];
                }
                return null;
            })
            .filter(Boolean);

        const seed = JSON.stringify({
            index,
            name: input.name || '',
            points: points.slice(0, 8)
        });

        return {
            uid: typeof input.uid === 'string' && input.uid.trim()
                ? input.uid.trim()
                : crypto.createHash('md5').update(seed).digest('hex').slice(0, 8),
            name: typeof input.name === 'string' ? input.name : '',
            kind: typeof input.kind === 'string' ? input.kind : 'region',
            parent_uid: typeof input.parent_uid === 'string' && input.parent_uid.trim() ? input.parent_uid.trim() : null,
            color: typeof input.color === 'string' && input.color.trim() ? input.color.trim() : '#4f8fc0',
            tags: typeof input.tags === 'string' ? input.tags : '',
            description: typeof input.description === 'string' ? input.description : '',
            geometry: {
                type: 'polygon',
                points
            }
        };
    }

    normalizeBiomePaletteEntry(entry, index = 0) {
        const input = entry && typeof entry === 'object' ? entry : {};
        const fallback = DEFAULT_BIOME_PALETTE[index % DEFAULT_BIOME_PALETTE.length] || DEFAULT_BIOME_PALETTE[0];
        const rawId = String(input.id || input.label || fallback.id || `biome_${index + 1}`)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const color = String(input.color || fallback.color || '#ffffff').trim();
        const label = String(input.label || fallback.label || rawId || `Biome ${index + 1}`).trim();
        const inferredFlags = this.inferBiomeAttributeDefaults(rawId, label);

        return {
            id: rawId || `biome_${index + 1}`,
            label,
            color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback.color,
            needs_boat: typeof input.needs_boat === 'boolean' ? input.needs_boat : inferredFlags.needs_boat,
            slows_down: typeof input.slows_down === 'boolean' ? input.slows_down : inferredFlags.slows_down,
            is_road: typeof input.is_road === 'boolean' ? input.is_road : inferredFlags.is_road,
            is_river: typeof input.is_river === 'boolean' ? input.is_river : inferredFlags.is_river
        };
    }

    inferBiomeAttributeDefaults(id, label) {
        const key = `${id || ''} ${label || ''}`.toLowerCase();
        return {
            needs_boat: /\b(sea|ocean)\b/.test(key),
            slows_down: /\b(mountain|mountains|rainforest)\b/.test(key),
            is_road: /\b(road|trail|path|highway)\b/.test(key),
            is_river: /\b(river|stream|creek|brook)\b/.test(key)
        };
    }

    normalizeBiomes(biomes = {}) {
        const input = biomes && typeof biomes === 'object' ? biomes : {};
        const rawMaskFile = path.basename(String(input.mask_file || DEFAULT_BIOME_MASK_FILE).trim() || DEFAULT_BIOME_MASK_FILE);
        const maskFile = rawMaskFile.toLowerCase().endsWith('.png') ? rawMaskFile : DEFAULT_BIOME_MASK_FILE;
        const paletteSource = Array.isArray(input.palette)
            ? input.palette
            : DEFAULT_BIOME_PALETTE;

        return {
            mask_file: maskFile,
            mask_width: Math.max(0, Math.round(this.toNumeric(input.mask_width, 0))),
            mask_height: Math.max(0, Math.round(this.toNumeric(input.mask_height, 0))),
            palette: paletteSource.map((entry, index) => this.normalizeBiomePaletteEntry(entry, index))
        };
    }

    getBiomeMaskDimensions(imageDimensions, maxSide = 1024) {
        const width = Math.max(0, Math.round(this.toNumeric(imageDimensions?.width, 0)));
        const height = Math.max(0, Math.round(this.toNumeric(imageDimensions?.height, 0)));
        if (width <= 0 || height <= 0) return { width: 0, height: 0 };
        const scale = Math.min(1, maxSide / Math.max(width, height));
        return {
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale))
        };
    }

    normalizeWorldData(worldData) {
        const base = this.createDefaultWorldData();
        const input = worldData && typeof worldData === 'object' ? worldData : {};
        const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
        const normalized = {
            ...base,
            ...input,
            meta: {
                ...base.meta,
                ...meta
            },
            nodes: Array.isArray(input.nodes) ? input.nodes.map((node, index) => this.normalizeWorldNode(node, index)) : [],
            areas: Array.isArray(input.areas) ? input.areas.map((area, index) => this.normalizeWorldArea(area, index)) : [],
            biomes: this.normalizeBiomes(input.biomes)
        };

        if (!normalized.meta.image_file && typeof normalized.meta.image_path === 'string' && normalized.meta.image_path.trim()) {
            normalized.meta.image_file = path.basename(normalized.meta.image_path);
        }

        const biomeMaskDimensions = this.getBiomeMaskDimensions(normalized.meta.dimensions);
        if (biomeMaskDimensions.width > 0 && biomeMaskDimensions.height > 0) {
            normalized.biomes.mask_width = biomeMaskDimensions.width;
            normalized.biomes.mask_height = biomeMaskDimensions.height;
        }

        return normalized;
    }

    getAreaMap() {
        return new Map((this.worldData?.areas || []).map((area) => [area.uid, area]));
    }

    getAreaPoints(area) {
        return Array.isArray(area?.geometry?.points) ? area.geometry.points : [];
    }

    pointInPolygon(x, y, points) {
        if (!Array.isArray(points) || points.length < 3) return false;

        let inside = false;
        for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
            const xi = points[index][0];
            const yi = points[index][1];
            const xj = points[previousIndex][0];
            const yj = points[previousIndex][1];

            const intersects = ((yi > y) !== (yj > y))
                && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9)) + xi);

            if (intersects) inside = !inside;
        }

        return inside;
    }

    polygonArea(points) {
        if (!Array.isArray(points) || points.length < 3) return Number.POSITIVE_INFINITY;

        let area = 0;
        for (let index = 0; index < points.length; index += 1) {
            const [x1, y1] = points[index];
            const [x2, y2] = points[(index + 1) % points.length];
            area += (x1 * y2) - (x2 * y1);
        }

        return Math.abs(area / 2);
    }

    getAreaDepth(area, areaMap = this.getAreaMap()) {
        let depth = 0;
        let current = area;
        const seen = new Set();

        while (current && current.parent_uid && !seen.has(current.parent_uid)) {
            seen.add(current.parent_uid);
            const parent = areaMap.get(current.parent_uid);
            if (!parent) break;
            depth += 1;
            current = parent;
        }

        return depth;
    }

    getAreaHierarchy(area, areaMap = this.getAreaMap()) {
        const hierarchy = [];
        let current = area;
        const seen = new Set();

        while (current && !seen.has(current.uid)) {
            hierarchy.unshift(current);
            seen.add(current.uid);
            current = current.parent_uid ? areaMap.get(current.parent_uid) : null;
        }

        return hierarchy;
    }

    getAreaContextForCoordinates(x, y) {
        const areaMap = this.getAreaMap();
        const containingAreas = (this.worldData?.areas || []).filter((area) => {
            const points = this.getAreaPoints(area);
            return points.length >= 3 && this.pointInPolygon(x, y, points);
        });

        containingAreas.sort((left, right) => {
            const depthDiff = this.getAreaDepth(right, areaMap) - this.getAreaDepth(left, areaMap);
            if (depthDiff) return depthDiff;

            const sizeDiff = this.polygonArea(this.getAreaPoints(left)) - this.polygonArea(this.getAreaPoints(right));
            if (sizeDiff) return sizeDiff;

            return (left.name || '').localeCompare(right.name || '');
        });

        const primaryArea = containingAreas[0] || null;
        const hierarchy = primaryArea ? this.getAreaHierarchy(primaryArea, areaMap) : [];

        return {
            primaryArea,
            topLevelArea: hierarchy[0] || primaryArea || null,
            hierarchy,
            containingAreas
        };
    }

    enrichCoordinatesWithAreas(coords) {
        if (!coords) return coords;

        const areaContext = this.getAreaContextForCoordinates(coords.x, coords.y);
        return {
            ...coords,
            primary_area: areaContext.primaryArea ? areaContext.primaryArea.name : null,
            top_level_area: areaContext.topLevelArea ? areaContext.topLevelArea.name : null,
            area_hierarchy: areaContext.hierarchy.map((area) => area.name),
            containing_areas: areaContext.containingAreas.map((area) => area.name),
            area_tags: areaContext.containingAreas
                .map((area) => {
                    const tags = (Array.isArray(area.tags) ? area.tags : String(area.tags || '').split(','))
                        .map((tag) => String(tag || '').trim())
                        .filter(Boolean);
                    return tags.length > 0 ? `${area.name}: ${tags.join(', ')}` : '';
                })
                .filter(Boolean)
        };
    }

    isCoordinateLabel(value) {
        return /^coordinates\s*\(/i.test(String(value || '').trim());
    }

    getAreaTrail(coords) {
        return Array.isArray(coords?.area_hierarchy) && coords.area_hierarchy.length > 0
            ? coords.area_hierarchy.filter(Boolean).join(' / ')
            : '';
    }

    getPromptLocationName(coords) {
        const name = String(coords?.name || '').trim();
        if (name && !this.isCoordinateLabel(name)) return name;

        const anchor = String(coords?.anchor || '').trim();
        if (anchor && !this.isCoordinateLabel(anchor)) return `Near ${anchor}`;

        const areaTrail = this.getAreaTrail(coords);
        if (areaTrail) return areaTrail;

        return 'Unmapped location';
    }

    getDistanceBand(distanceKm) {
        const distance = this.toNumeric(distanceKm, 0);
        if (distance <= 50) return 'close by';
        if (distance <= 250) return 'distant';
        return 'very far';
    }

    formatDistanceSummary(distanceKm, distanceBand, direction) {
        const safeDistance = this.toNumeric(distanceKm, 0);
        const safeBand = String(distanceBand || '').trim() || this.getDistanceBand(safeDistance);
        const safeDirection = String(direction || '').trim();
        if (!safeDirection) {
            return `${this.formatDistance(safeDistance)} ${safeBand} (same area)`;
        }
        return `${this.formatDistance(safeDistance)} ${safeBand} to the ${safeDirection}`;
    }

    getCardinalDirection(nodeA, nodeB) {
        const dx = (nodeB.world_x ?? nodeB.x ?? 0) - (nodeA.world_x ?? nodeA.x ?? 0);
        const dy = (nodeB.world_y ?? nodeB.y ?? 0) - (nodeA.world_y ?? nodeA.y ?? 0);

        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return '';

        // World coordinates use Y-up while image space is Y-down.
        // Flip Y for compass math so north/south labels match visual map orientation.
        const compassDy = -dy;
        const angle = Math.atan2(compassDy, dx) * 180 / Math.PI;

        if (angle >= -22.5 && angle < 22.5) return 'E';
        if (angle >= 22.5 && angle < 67.5) return 'NE';
        if (angle >= 67.5 && angle < 112.5) return 'N';
        if (angle >= 112.5 && angle < 157.5) return 'NW';
        if (angle >= 157.5 || angle < -157.5) return 'W';
        if (angle >= -157.5 && angle < -112.5) return 'SW';
        if (angle >= -112.5 && angle < -67.5) return 'S';
        if (angle >= -67.5 && angle < -22.5) return 'SE';

        return '';
    }

    getAreaTrailForNode(node) {
        if (!node) return 'unmapped';
        const areaContext = this.getAreaContextForCoordinates(
            this.toNumeric(node.world_x !== undefined ? node.world_x : node.x, 0),
            this.toNumeric(node.world_y !== undefined ? node.world_y : node.y, 0)
        );
        const trail = areaContext.hierarchy.map((area) => area.name).filter(Boolean).join(' / ');
        return trail || 'unmapped';
    }

    getProjectStaticPath(absPath, turnContext = null) {
        if (!absPath) return null;

        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory || this.turnContext?.rootDirectory;
        if (!root) return null;

        const resolvedRoot = path.resolve(root);
        const resolvedTarget = path.resolve(absPath);
        const relativePath = path.relative(resolvedRoot, resolvedTarget);
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        const encodedPath = relativePath
            .split(path.sep)
            .filter(Boolean)
            .map(segment => encodeURIComponent(segment))
            .join('/');
        const projectName = encodeURIComponent(path.basename(resolvedRoot));
        return `/projects/${projectName}/${encodedPath}`;
    }

    getServerBaseUrl() {
        const fromEnv = process.env.FABLEKIN_SOCKET_URL;
        if (fromEnv && typeof fromEnv === 'string') {
            return fromEnv.replace(/\/$/, '');
        }

        const infrastructure = readSettings()?.infrastructure || {};
        const host = infrastructure.socket_host || '127.0.0.1';
        const port = infrastructure.socket_port || 14541;
        return `http://${host}:${port}`;
    }

    getProjectStaticUrl(absPath, turnContext = null) {
        const staticPath = this.getProjectStaticPath(absPath, turnContext);
        if (!staticPath) return null;
        return `${this.getServerBaseUrl()}${staticPath}`;
    }

    getProjectTileTemplate(tilePath, turnContext = null) {
        if (!tilePath) return null;

        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory || this.turnContext?.rootDirectory;
        if (!root) return null;

        const relativePath = path.relative(root, tilePath);
        if (!relativePath || relativePath.startsWith('..')) return null;

        return `${relativePath.replace(/\\/g, '/')}/{z}/{y}/{x}.png`;
    }

    getProjectStaticTileTemplate(tilePath, turnContext = null) {
        const staticBase = this.getProjectStaticPath(tilePath, turnContext);
        return staticBase ? `${this.getServerBaseUrl()}${staticBase}/{z}/{y}/{x}.png` : null;
    }

    async loadWorldPackage(packagePath, turnContext = null) {
        const normalizedPackagePath = path.resolve(packagePath);
        const worldJsonPath = path.join(normalizedPackagePath, 'world.json');

        let worldData = this.createDefaultWorldData();
        try {
            const content = await fs.readFile(worldJsonPath, 'utf8');
            worldData = this.normalizeWorldData(JSON.parse(content));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const meta = worldData.meta || {};
        const imageFile = meta.image_file || '';
        const imagePath = imageFile ? path.join(normalizedPackagePath, imageFile) : null;
        let imageExists = false;

        if (imagePath) {
            try {
                await fs.access(imagePath);
                imageExists = true;
            } catch {
                imageExists = false;
            }
        }

        const tilesPath = path.join(normalizedPackagePath, 'tiles');
        let tilesExist = false;
        try {
            await fs.access(tilesPath);
            tilesExist = true;
        } catch {
            tilesExist = false;
        }

        const isCompiled = !!(meta.is_compiled && tilesExist && meta.dimensions?.width > 0);
        const biomeMaskFile = worldData.biomes?.mask_file || DEFAULT_BIOME_MASK_FILE;
        const biomeMaskPath = biomeMaskFile ? path.join(normalizedPackagePath, biomeMaskFile) : null;
        let biomeMaskExists = false;

        if (biomeMaskPath) {
            try {
                await fs.access(biomeMaskPath);
                biomeMaskExists = true;
            } catch {
                biomeMaskExists = false;
            }
        }

        return {
            packagePath: normalizedPackagePath,
            worldJsonPath,
            worldData,
            imageFile,
            imagePath: imageExists ? imagePath : null,
            imageUrl: imageExists ? this.getProjectStaticUrl(imagePath, turnContext) : null,
            isCompiled,
            tilesPath: tilesExist ? tilesPath : null,
            biomeMaskFile,
            biomeMaskPath: biomeMaskExists ? biomeMaskPath : null,
            biomeMaskUrl: biomeMaskExists ? this.getProjectStaticUrl(biomeMaskPath, turnContext) : null
        };
    }

    async loadWorldData(turnContext, options = {}) {
        this.worldDataLoadAttempted = true;
        const skipTiling = !!options.skipTiling;
        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory;
        const cacheKey = root ? `${path.resolve(root).toLowerCase()}::${skipTiling ? 'preview' : 'full'}` : null;
        if (cacheKey && options.reload !== true && worldDataCache.has(cacheKey)) {
            const cached = worldDataCache.get(cacheKey);
            this.worldData = cached.worldData;
            this.mapImage = cached.mapImage;
            this.tilePath = cached.tilePath;
            this.worldPackagePath = cached.worldPackagePath;
            this.biomeMaskPath = cached.biomeMaskPath;
            this.biomeGridResultPromise = null;
            this.biomeGridResult = null;
            worldDataCache.delete(cacheKey);
            worldDataCache.set(cacheKey, cached);
            return;
        }

        this.worldData = null;
        this.mapImage = null;
        this.tilePath = null;
        this.worldPackagePath = null;
        this.biomeMaskPath = null;
        this.biomeGridResultPromise = null;
        this.biomeGridResult = null;

        try {
            const path = require('path');
            const fullConfig = await this.tools.project.getFullProjectConfig();
            
            const configEntries = Object.entries(fullConfig.files || {});

            let worldFile = null;
            let imageWorldFile = null;
            let worldPackage = null;

            // Optional fallback source for unusual cases
            const selectedFiles = (turnContext && turnContext.input && Array.isArray(turnContext.input.selectedFiles)) ? turnContext.input.selectedFiles : [];

            // 1. Discover package-backed world maps.
            const packageEntry = configEntries.find(([filePath, settings]) =>
                filePath.toLowerCase().endsWith('.world') &&
                settings &&
                typeof settings === 'object' &&
                settings.mode === 'world_map'
            );
            const worldEntry = configEntries.find(([filePath, settings]) => 
                filePath.toLowerCase().endsWith('.world') && settings.mode === 'auto-included'
            );
            const imageEntry = configEntries.find(([filePath, settings]) => 
                (filePath.toLowerCase().endsWith('.png.imageworld') || filePath.toLowerCase().endsWith('.jpg.imageworld')) && 
                settings.mode === 'auto-included'
            );

            if (packageEntry) {
                const absPath = packageEntry[0];
                worldPackage = await this.loadWorldPackage(absPath, turnContext);
            } else if (selectedFiles.length > 0) {
                const foundPackage = selectedFiles.find(f => f.path.toLowerCase().endsWith('.world'));
                if (foundPackage) {
                    const absPath = path.resolve(root, foundPackage.path);
                    worldPackage = await this.loadWorldPackage(absPath, turnContext);
                }
            }

            if (!worldPackage && worldEntry) {
                const absPath = worldEntry[0];
                worldFile = { path: absPath };
            } else if (!worldPackage && selectedFiles.length > 0) {
                // Fallback to selected files if config is missing (unusual cases)
                const found = selectedFiles.find(f => f.path.toLowerCase().endsWith('.world'));
                if (found) worldFile = { path: path.resolve(root, found.path) };
            }

            if (imageEntry) {
                const absPath = imageEntry[0];
                imageWorldFile = { path: absPath };
            } else if (selectedFiles.length > 0) {
                // Fallback to selected files if config is missing (unusual cases)
                const found = selectedFiles.find(f => f.path.toLowerCase().endsWith('.png.imageworld') || f.path.toLowerCase().endsWith('.jpg.imageworld'));
                if (found) imageWorldFile = { path: path.resolve(root, found.path) };
            }

            if (worldPackage) {
                this.worldData = worldPackage.worldData;
                this.mapImage = worldPackage.imagePath;
                this.worldPackagePath = worldPackage.packagePath;
                this.biomeMaskPath = worldPackage.biomeMaskPath;
                
                if (worldPackage.isCompiled) {
                    this.tilePath = worldPackage.tilesPath;
                }
            } else if (worldFile) {
                const content = await this.tools.project.readFile(worldFile.path);
                this.worldData = this.normalizeWorldData(JSON.parse(content));
            }

            if (worldPackage && !worldPackage.isCompiled) {
                if (worldPackage.imagePath && !skipTiling) {
                    this.tilePath = await this.processMapTiling(turnContext, this.mapImage, worldPackage.packagePath);
                }
            } else if (!worldPackage && imageWorldFile) {
                this.mapImage = imageWorldFile.path;

                if (!skipTiling) {
                    // Process tiling
                    this.tilePath = await this.processMapTiling(turnContext, this.mapImage);
                }
            }

            if (cacheKey) {
                worldDataCache.set(cacheKey, {
                    worldData: this.worldData,
                    mapImage: this.mapImage,
                    tilePath: this.tilePath,
                    worldPackagePath: this.worldPackagePath,
                    biomeMaskPath: this.biomeMaskPath
                });
                while (worldDataCache.size > WORLD_DATA_CACHE_MAX) {
                    const oldestKey = worldDataCache.keys().next().value;
                    worldDataCache.delete(oldestKey);
                }
            }
        } catch (error) {
            this.tools.logger.error('WorldData', `Failed to load world data: ${error.message}`);
            this.tools.logger.runtime(`[WorldData] Loading world data failed: ${error.message}`);
        }
    }

    async initializeLocation(turnContext) {
        this.tools.logger.runtime(`[LocationInit] Initializing location for Turn ${turnContext?.turnNumber}`);
        const context = turnContext || this.turnContext;
        const turnNumber = context?.turnNumber;
        const projectName = (context?.projectName || this.tools.turnContext?.projectName || "default").toLowerCase();

        if (turnNumber !== 1) {
            this.tools.logger.runtime(`Skipping initializeLocation - Turn is ${turnNumber}, not 1.`);
            this.tools.logger.runtime(`[LocationInit] Skipped: Not Turn 1`);
            return;
        }

        await this.loadWorldData(context);
        const operationalStatus = this.getLoadedOperationalStatus();
        if (!operationalStatus.active) {
            this.tools.logger.runtime(`[LocationInit] Dormant: ${operationalStatus.reason}`);
            return;
        }

        const pc = context.promptComponents;
        const canonContext = (pc?.root?.canon || []).join('\n').trim();
        const introContext = String(context.processed?.turnOneIntroText || '').trim();
        const loreContext = [
            introContext ? `### TURN 1 INTRO / PROLOGUE (REFERENCE BASELINE)\n${introContext}` : '',
            canonContext ? `### WORLD LORE & STORY BIBLE\n${canonContext}` : ''
        ].filter(Boolean).join('\n\n');

        const { generateHash } = require('../../modules/utils.js');
        const contentHash = generateHash(JSON.stringify(this.worldData.nodes) + loreContext);

        this.tools.logger.runtime(`Checking for cached starting location for project: ${projectName}...`);

        // Try to fetch from cache
        try {
            await this.tools.db.project.execute(`
                CREATE TABLE IF NOT EXISTS world_location_start_cache (
                    project_name TEXT PRIMARY KEY,
                    content_hash TEXT,
                    start_node TEXT,
                    specific_location TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            const cached = await this.tools.db.project.query(
                "SELECT start_node, specific_location, content_hash FROM world_location_start_cache WHERE project_name = ?",
                [projectName]
            );

            if (cached && cached.length > 0 && cached[0].content_hash === contentHash) {
                this.tools.logger.runtime(`Cache Hit! start_node: ${cached[0].start_node}`);
                await this._applyLocationState(context, {
                    anchor_node: cached[0].start_node,
                    specific_location: cached[0].specific_location
                });
                this.tools.logger.runtime(`[LocationInit] Success (Cached): ${cached[0].start_node}`);
                return;
            } else if (cached && cached.length > 0) {
                this.tools.logger.runtime(`Cache Invalidation: Hash mismatch (Old: ${cached[0].content_hash}, New: ${contentHash})`);
            }
        } catch (error) {
            this.tools.logger.error('Logic', `Cache lookup failed: ${error.message}`);
        }

        this.tools.logger.runtime('No valid cache found. Initializing starting location via LLM...');

        try {
            const promptPath = path.join(__dirname, 'prompts', 'location_init.txt');
            let promptTemplate = await fs.readFile(promptPath, 'utf-8');

            // On Turn 1, we rely on bootstrapCharacterLocations for all character placements.
            // initializeLocation should focus primarily on the PARTY'S starting point.
            const prompt = promptTemplate
                .replace('${worldData}', JSON.stringify(this.worldData.nodes, null, 2))
                .replace('${sceneText}', loreContext || "No specific lore provided.")
                .replace('${characterTrackingSection}', "")
                .replace('${characterJsonField}', "");

            const messages = [{ role: 'user', content: prompt }];

            const modelDef = this.getLocationModel();

            this.tools.logger.runtime(`[LLM_Call] Calling LLM for location initialization`);
            const llmResponse = await this.tools.llm.json({
                msg: 'Location Init',
                requestId: 'location_init',
                prompt,
                model: modelDef.model || 'mediumendmodel',
                provider: modelDef.provider,
                callingModule: 'Plugin:world_location_tracker'
            });
            this.tools.logger.runtime(`[LLM_Call] LLM response received for location initialization`);

            const result = llmResponse.content;
            if (result && (result.anchor_node || result.location)) {
                const anchorName = result.anchor_node || result.location;
                const specificLoc = result.specific_location || anchorName;

                this.tools.logger.runtime(`Saving results to project cache: ${anchorName}`);
                // Save to cache
                await this.tools.db.project.execute(
                    "INSERT OR REPLACE INTO world_location_start_cache (project_name, content_hash, start_node, specific_location, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                    [projectName, contentHash, anchorName, specificLoc]
                );

                await this._applyLocationState(turnContext, {
                    anchor_node: anchorName,
                    specific_location: specificLoc,
                    underground_status: result.underground_status || "Above Ground"
                }, null);
                await this.storeLocationMemoryRecalls(turnContext, result, {
                    anchor: anchorName,
                    name: specificLoc,
                    specific_location: specificLoc
                });
                this.tools.logger.runtime(`[LocationInit] Success (LLM): ${anchorName}`);
            } else {
                this.tools.logger.warn('Logic', 'LLM failed to return a valid starting location.');
                this.tools.logger.runtime(`[LocationInit] Failed: Invalid LLM response`);
            }
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to initialize location: ${error.message}`);
            this.tools.logger.runtime(`[LocationInit] Failed: ${error.message}`);
        }
    }

    async _applyLocationState(turnContext, result, previousLocation = null) {
        const turnNumber = turnContext.turnNumber;

        // Check if we are already in TRANSIT. If so, updateLocation already set the party state.
        // We only want to run the party-level logic if we are NOT in transit, or if the party state is missing.
        const isTransit = result.status === 'TRANSIT';
        let locationState = this.tools.pluginState.turn().locationState;

        if (!locationState) {
            locationState = await this.enrichCoordinateState(this.buildLocationStateFromEvent(result, previousLocation));
            this.tools.pluginState.turn().locationState = locationState;
        }

        if (!isTransit && locationState) {

            // 1. Save Party Facts (Only if changed or first turn)
            const hasMoved = !previousLocation ||
                result.status === 'ARRIVED' ||
                (result.status === 'STAYED' && (
                    locationState.name !== previousLocation.name
                    || Math.abs(Number(locationState.x) - Number(previousLocation.x)) > 1e-6
                    || Math.abs(Number(locationState.y) - Number(previousLocation.y)) > 1e-6
                ));

            if (hasMoved) {
                await this.tools.facts.appendToFactsDb({
                    source: 'party',
                    target: 'self',
                    predicate: 'location_change',
                    fact_value: locationState.name
                }, { turn_number: turnNumber });

                if (locationState.anchor && locationState.anchor !== locationState.name) {
                    await this.tools.facts.appendToFactsDb({
                        source: 'party',
                        target: 'self',
                        predicate: 'location_anchor',
                        fact_value: locationState.anchor
                    }, { turn_number: turnNumber });
                }

                // 1b. Save Underground Status
                await this.tools.facts.appendToFactsDb({
                    source: 'party',
                    target: 'self',
                    predicate: 'location_view',
                    fact_value: locationState.underground_status
                }, { turn_number: turnNumber });
            } else {
            }
        }

        // 2. Handle Individual Character Locations
        if (result.characters && locationState) {
            const isCharSheetActive = this.tools.plugins.isInstalled('character_sheets');
            const hasClassifier = this.tools.plugins.isInstalled('character_classifier');

            for (let [charName, charLoc] of Object.entries(result.characters)) {
                if (!charLoc) continue;

                // Resolve name to canonical if possible
                if (isCharSheetActive) {
                    const resolved = await this.tools.plugins.call('character_sheets', 'resolveName', charName);
                    if (resolved && resolved !== charName) {
                        this.tools.logger.runtime(`Resolved character name for location: '${charName}' -> '${resolved}'`);
                        charName = resolved;
                    }
                }

                const importance = await this.resolveCharacterImportance(charName, turnContext);

                // Guard: Skip minor characters
                if (this.isFilteredImportance(importance)) {
                    this.tools.logger.runtime(`Skipping DB location persistence for ${importance.toUpperCase()} character: ${charName}`);
                    continue;
                }
                if (hasClassifier && !importance) {
                    this.tools.logger.runtime(`Skipping DB location persistence for unclassified character: ${charName}`);
                    continue;
                }

                const locText = charLoc.specific_location || locationState.name;
                const contextText = charLoc.context || charLoc.activity || "Present in the scene.";
                const fullText = `${locText}, ${contextText}`;

                const factValue = JSON.stringify({
                    specific_location: locText,
                    anchor_node: charLoc.anchor_node || locationState.anchor,
                    context: contextText
                });

                // Primary location fact (for map tracker)
                await this.tools.facts.appendToFactsDb({
                    source: charName.toLowerCase(),
                    target: 'self',
                    predicate: 'CHAR_LOCATION',
                    fact_value: factValue
                }, { turn_number: turnNumber });

                // Secondary location fact (for character sheets/HUD)
                await this.tools.facts.appendToFactsDb({
                    source: charName.toLowerCase(),
                    target: 'self',
                    predicate: 'CHAR_SHEET:CURRENT_CONTEXT',
                    fact_value: fullText
                }, { turn_number: turnNumber });
            }
        }
    }

    buildNumberedScript(turnContext) {
        const processedLines = turnContext?.processed?.vnManager?.processedLines || [];
        return formatIndexedScene(processedLines);
    }

    formatBackgroundChangeHints(turnContext) {
        const bgChanges = Array.isArray(turnContext?.output?.bgChanges) ? turnContext.output.bgChanges : [];
        if (bgChanges.length === 0) {
            return 'No background changes were selected. Treat this as a weak signal that the visual setting may remain stable.';
        }

        return bgChanges
            .map(change => {
                const line = Number.isInteger(change.line) ? change.line : 0;
                const bgPath = change.path || '';
                return `${line}. ${path.basename(bgPath) || bgPath || 'unknown background'}`;
            })
            .join('\n');
    }

    normalizeCharacterList(rawList) {
        const source = Array.isArray(rawList)
            ? rawList
            : (typeof rawList === 'string' ? rawList.split(/[,;\n]/) : []);
        const seen = new Set();
        const out = [];

        for (const entry of source) {
            const name = String(entry || '').trim();
            const key = this.normalizeCharacterKey(name);
            if (!name || !key || seen.has(key)) continue;
            seen.add(key);
            out.push(name);
        }

        return out;
    }

    isFilteredImportance(importance) {
        const normalized = String(importance || '').toLowerCase().trim();
        return normalized === 'minor' || normalized === 'noncharacter';
    }

    getImportanceCache(turnContext) {
        if (!turnContext?.processed) return null;
        if (!turnContext.processed._wltImportanceCache || !(turnContext.processed._wltImportanceCache instanceof Map)) {
            turnContext.processed._wltImportanceCache = new Map();
        }
        return turnContext.processed._wltImportanceCache;
    }

    async resolveCharacterImportance(name, turnContext) {
        const key = this.normalizeCharacterKey(name);
        const rawLower = String(name || '').trim().toLowerCase();
        if (!key || !turnContext) return '';

        const cache = this.getImportanceCache(turnContext);
        if (cache && cache.has(key)) return cache.get(key);

        const metadata = turnContext.processed?.characterMetadata || {};
        let importance = String(metadata[key]?.importance || metadata[rawLower]?.importance || '').toLowerCase().trim();

        if (!importance && this.tools.plugins.isInstalled('character_classifier')) {
            try {
                importance = String(await this.tools.plugins.call('character_classifier', 'getImportance', name) || '').toLowerCase().trim();
            } catch (error) {
                this.tools.logger.runtime(`resolveCharacterImportance: classifier lookup failed for '${name}': ${error.message}`);
            }
        }

        if (importance && turnContext.processed) {
            const existing = turnContext.processed.characterMetadata?.[key] || {};
            if (!turnContext.processed.characterMetadata) turnContext.processed.characterMetadata = {};
            turnContext.processed.characterMetadata[key] = { ...existing, importance };
            if (rawLower && rawLower !== key) {
                const rawExisting = turnContext.processed.characterMetadata?.[rawLower] || {};
                turnContext.processed.characterMetadata[rawLower] = { ...rawExisting, importance };
            }
        }

        if (cache) cache.set(key, importance || '');
        return importance || '';
    }

    async getTravelPartyCandidateNames(turnContext, previousChapter = null) {
        const playerName = String(turnContext?.input?.playerCharacterName || '').trim();
        const currentParty = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
        const previousParty = Array.isArray(previousChapter?.output?.party) ? previousChapter.output.party : [];
        const candidates = this.normalizeCharacterList([playerName, ...currentParty, ...previousParty]);
        const filtered = [];

        for (const name of candidates) {
            if (this.isGenericCharacterName(name)) continue;
            const importance = await this.resolveCharacterImportance(name, turnContext);
            if (this.isFilteredImportance(importance)) continue;
            filtered.push(name);
        }

        return filtered;
    }

    formatTravelPartyCandidateSection(candidates) {
        const names = this.normalizeCharacterList(candidates);
        if (names.length === 0) {
            return 'No reliable character candidate list is available. If travel is clear, infer the visible travelers from the indexed script.';
        }

        return [
            'Use this list only to choose who should appear in the travel animation. It is not character-location tracking.',
            ...names.map((name) => `- ${name}`)
        ].join('\n');
    }

    getProcessedLineCount(turnContext) {
        const processedLines = turnContext?.processed?.vnManager?.processedLines || [];
        return processedLines.length;
    }

    clampLineIndex(value, lineCount) {
        const numeric = Number(value);
        const maxLine = Math.max(0, (lineCount || 1) - 1);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(Math.round(numeric), maxLine));
    }

    normalizeTransitProgress(value, fallback = 0.5) {
        const numeric = Number(value);
        const fallbackNumeric = Number(fallback);
        const base = Number.isFinite(numeric)
            ? numeric
            : (Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0.5);
        return Math.min(0.85, Math.max(0.15, base));
    }

    normalizeMovementDistance(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    }

    findWorldNodeByName(name) {
        if (!name || !Array.isArray(this.worldData?.nodes)) return null;
        const normalized = String(name).toLowerCase().trim();
        return this.worldData.nodes.find(node => String(node.name).toLowerCase().trim() === normalized) || null;
    }

    isTransitLocationState(state) {
        return String(state?.status || state?.type || '').toUpperCase() === 'TRANSIT'
            || !!(state?.destination && (state?.origin || state?.position_model === 'coordinate_v1'));
    }

    coordinateDistanceKm(from, to) {
        const dx = Number(to?.world_x ?? to?.x ?? 0) - Number(from?.world_x ?? from?.x ?? 0);
        const dy = Number(to?.world_y ?? to?.y ?? 0) - Number(from?.world_y ?? from?.y ?? 0);
        const pixels = Math.sqrt((dx * dx) + (dy * dy));
        const scale = this.resolveTravelScale();
        return (pixels / scale.pixelsPerKm) * scale.windingFactor;
    }

    corridorDistanceKm(points) {
        const pixels = routeGeometry.corridorLength(points || []);
        const scale = this.resolveTravelScale();
        return (pixels / scale.pixelsPerKm) * scale.windingFactor;
    }

    buildTravelProgressContext(rawNavigationState) {
        const state = navigationCopilot.normalizeNavigationState(rawNavigationState);
        const plan = navigationCopilot.normalizeRoutePlan(state.active_leg_plan || state.journey_plan);
        if (!plan || plan.corridor.length < 2) return 'No active route odometer is available.';

        const fullPixels = routeGeometry.corridorLength(plan.corridor);
        const remainingPixels = routeGeometry.corridorLength(plan.remaining_corridor?.length ? plan.remaining_corridor : plan.corridor);
        const measuredTotalKm = this.corridorDistanceKm(plan.corridor);
        const savedTotalKm = Number(plan.distance_km);
        const totalKm = Number.isFinite(savedTotalKm) && savedTotalKm > 0 ? savedTotalKm : measuredTotalKm;
        const remainingRatio = fullPixels > 0 ? Math.max(0, Math.min(1, remainingPixels / fullPixels)) : 1;
        const remainingKm = totalKm * remainingRatio;
        if (totalKm <= 0) return 'No active route odometer is available.';

        const traveledKm = Math.max(0, totalKm - remainingKm);
        const progressPercent = Math.max(0, Math.min(100, (traveledKm / totalKm) * 100));
        const destination = plan.destination?.name || state.active_target?.name || state.journey_target?.name || 'unknown destination';
        const routeId = plan.selected_route_id || plan.route_profile?.id || 'direct';
        const routeLabel = plan.route_profile?.mode || plan.selection_source || '';
        const narrativeDurationDays = Number(plan.narrative_duration_days);
        const hasNarrativeDuration = Number.isFinite(narrativeDurationDays) && narrativeDurationDays > 0;
        const consumedRouteDays = hasNarrativeDuration ? (traveledKm / totalKm) * narrativeDurationDays : null;
        const remainingRouteDays = hasNarrativeDuration ? Math.max(0, narrativeDurationDays - consumedRouteDays) : null;
        const narrativePace = hasNarrativeDuration ? totalKm / narrativeDurationDays : null;
        const speed = this.resolveTravelScale().baseSpeed;
        const lines = [
            `Active destination: ${destination}`,
            `Selected route: ${routeId}${routeLabel ? ` (${routeLabel})` : ''}`,
            `Total accepted route distance: ${this.formatDistance(totalKm, { long: true })}`,
            hasNarrativeDuration
                ? `Accepted narrative travel time: ${plan.duration_label || `${narrativeDurationDays.toFixed(1)} days`} (${narrativeDurationDays.toFixed(2)} route-days)`
                : 'Accepted narrative travel time: unavailable; use normal travel pace as fallback.',
            `Already traveled before this chapter: ${this.formatDistance(traveledKm, { long: true })}`,
            `Remaining before this chapter: ${this.formatDistance(remainingKm, { long: true })}`,
            `Progress before this chapter: ${progressPercent.toFixed(1)}%`,
            hasNarrativeDuration
                ? `Route-time consumed before this chapter: ${consumedRouteDays.toFixed(2)} day(s); remaining route-time: ${remainingRouteDays.toFixed(2)} day(s).`
                : `Normal travel pace: ${this.formatDistance(speed, { long: true })} per full travel day`,
            hasNarrativeDuration
                ? `Narrative route pace: ${this.formatDistance(narrativePace, { long: true })} per route-day. Use this for elapsed-time progress on this accepted route.`
                : 'Narrative route pace: unavailable.',
            'For TRANSIT events, distance_traveled_km must be the additional distance covered in this chapter only.'
        ];
        return lines.join('\n');
    }

    getNearestNodeContext(coords) {
        if (!Number.isFinite(Number(coords?.x)) || !Number.isFinite(Number(coords?.y))) return null;
        const nodes = Array.isArray(this.worldData?.nodes) ? this.worldData.nodes : [];
        let nearest = null;
        let nearestDistanceKm = Number.POSITIVE_INFINITY;

        for (const node of nodes) {
            const x = Number(node.world_x);
            const y = Number(node.world_y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const distanceKm = this.coordinateDistanceKm(coords, node);
            if (distanceKm < nearestDistanceKm) {
                nearestDistanceKm = distanceKm;
                nearest = {
                    uid: node.uid || '',
                    name: node.name || '',
                    distance_km: Number(distanceKm.toFixed(1)),
                    direction: this.getCardinalDirection(coords, node)
                };
            }
        }

        return nearest;
    }

    decorateCoordinateState(state) {
        if (!state) return null;
        const anchorName = String(state.anchor || state.anchor_node || '').trim() || null;
        const canonicalState = { ...state };
        delete canonicalState.origin;
        delete canonicalState.progress;
        const decorated = this.enrichCoordinatesWithAreas({
            ...canonicalState,
            position_model: 'coordinate_v1',
            anchor: anchorName,
            anchor_node: anchorName,
            movement_distance_km: this.normalizeMovementDistance(state.movement_distance_km)
        });
        return {
            ...decorated,
            nearest_node: this.getNearestNodeContext(decorated)
        };
    }

    async getBiomeContextAtCoordinates(x, y) {
        if (!this.worldPackagePath || !this.biomeMaskPath) return null;
        try {
            if (!this.biomeGridResultPromise) {
                this.biomeGridResultPromise = biomeNavigation.loadOrCreateNavigationGrid({
                    worldData: this.worldData,
                    packagePath: this.worldPackagePath,
                    biomeMaskPath: this.biomeMaskPath
                });
            }
            const gridResult = await this.biomeGridResultPromise;
            this.biomeGridResult = gridResult;
            if (!gridResult?.enabled || !gridResult.cache) return null;
            return biomeNavigation.lookupBiomeAtCoordinates(gridResult.cache, this.worldData, x, y);
        } catch (error) {
            this.tools.logger.warn('BiomeLocation', `Could not resolve biome at current coordinates: ${error.message}`);
            return null;
        }
    }

    async enrichCoordinateState(state) {
        const decorated = this.decorateCoordinateState(state);
        if (!decorated) return null;
        return {
            ...decorated,
            biome: await this.getBiomeContextAtCoordinates(decorated.x, decorated.y)
        };
    }

    createDefaultLocationEvent(previousLocation = null, travelParty = []) {
        const previousTransit = this.isTransitLocationState(previousLocation);
        if (previousTransit) {
            const destination = previousLocation?.destination || previousLocation?.anchor || previousLocation?.name || 'Unknown Destination';
            return {
                line: 0,
                status: 'TRANSIT',
                specific_location: `On the road to ${destination}`,
                anchor_node: previousLocation?.anchor || previousLocation?.anchor_node || previousLocation?.origin || destination,
                underground_status: previousLocation?.underground_status || 'Above Ground',
                destination: previousLocation?.destination || null,
                distance_traveled_km: 0,
                travel_party: this.normalizeCharacterList(travelParty),
                confidence: previousLocation ? 1.0 : 0.0,
                reasoning: 'No clear location update was detected; carrying forward the previous transit state without moving the party.'
            };
        }

        return {
            line: 0,
            status: 'STAYED',
            specific_location: previousLocation?.name || 'Unknown Location',
            anchor_node: previousLocation?.anchor || previousLocation?.name || 'Unknown Anchor',
            underground_status: previousLocation?.underground_status || 'Above Ground',
            travel_party: this.normalizeCharacterList(travelParty),
            confidence: previousLocation ? 1.0 : 0.0,
            reasoning: previousLocation
                ? 'No clear movement was detected; carrying forward the previous location.'
                : 'No clear movement was detected and no previous location was available.'
        };
    }

    normalizeLocationEvents(result, previousLocation, turnContext) {
        const lineCount = this.getProcessedLineCount(turnContext);
        const defaultTravelParty = this.normalizeCharacterList(result?.travel_party || result?.moving_party_members || result?.party_members_moving);
        let rawEvents = [];

        if (Array.isArray(result?.location_events)) {
            rawEvents = result.location_events;
        } else if (result && typeof result === 'object' && (result.status || result.anchor_node || result.location || result.origin || result.destination)) {
            rawEvents = [{ ...result, line: result.line ?? 0 }];
        }

        if (rawEvents.length === 0) {
            rawEvents = [this.createDefaultLocationEvent(previousLocation, defaultTravelParty)];
        }

        const seenLines = new Set();
        const normalized = rawEvents
            .map(event => {
                const line = this.clampLineIndex(event.line ?? event.index ?? event.start_line, lineCount);
                const statusRaw = String(event.status || 'STAYED').toUpperCase().trim();
                const status = ['STAYED', 'ARRIVED', 'TRANSIT'].includes(statusRaw) ? statusRaw : 'STAYED';
                const fallback = previousLocation || {};
                const fallbackTransit = this.isTransitLocationState(fallback);
                const explicitLocationSignal = event.anchor_reference || event.anchor_node || event.location || event.origin || event.destination_mention || event.destination;
                const normalizedStatus = (fallbackTransit && status === 'STAYED' && !explicitLocationSignal) ? 'TRANSIT' : status;
                const fallbackDestination = fallbackTransit ? (fallback.destination || null) : null;
                const anchorNode = normalizedStatus === 'TRANSIT'
                    ? (fallback.anchor || fallback.anchor_node || fallback.origin || event.anchor_node || event.location || fallback.name || 'Unknown Anchor')
                    : (event.anchor_node || event.location || fallback.anchor || fallback.anchor_node || fallback.name || 'Unknown Anchor');
                const destination = (normalizedStatus === 'TRANSIT' ? (event.destination || fallbackDestination) : null)
                    || null;
                const transitLocationLabel = destination ? `On the road to ${destination}` : (fallback.name || 'On the road');

                return {
                    line,
                    status: normalizedStatus,
                    specific_location: normalizedStatus === 'TRANSIT'
                        ? (event.specific_location || transitLocationLabel)
                        : (event.specific_location || event.location || fallback.name || anchorNode),
                    anchor_node: anchorNode,
                    anchor_reference: event.anchor_reference || event.anchor_node || event.location || anchorNode,
                    anchor_map_status: event.anchor_map_status || (event.anchor_node ? 'mapped' : null),
                    anchor_node_uid: event.anchor_node_uid || null,
                    underground_status: event.underground_status || fallback.underground_status || 'Above Ground',
                    destination,
                    destination_mention: event.destination_mention || destination,
                    destination_map_status: event.destination_map_status || fallback.destination_map_status || (destination ? 'mapped' : null),
                    destination_uid: event.destination_uid || fallback.destination_uid || null,
                    destination_candidates: Array.isArray(event.destination_candidates)
                        ? event.destination_candidates.slice(0, 5)
                        : (Array.isArray(fallback.destination_candidates) ? fallback.destination_candidates.slice(0, 5) : []),
                    distance_traveled_km: normalizedStatus === 'TRANSIT'
                        ? this.normalizeMovementDistance(event.distance_traveled_km ?? event.distance_km)
                        : 0,
                    travel_party: this.normalizeCharacterList(event.travel_party || event.moving_party_members || event.party_members_moving || defaultTravelParty),
                    confidence: Number.isFinite(Number(event.confidence)) ? Math.min(Math.max(Number(event.confidence), 0), 1) : null,
                    reasoning: event.reasoning || ''
                };
            })
            .sort((left, right) => left.line - right.line)
            .filter(event => {
                if (seenLines.has(event.line)) return false;
                seenLines.add(event.line);
                return true;
            });

        if (!normalized.some(event => event.line === 0)) {
            normalized.unshift(this.createDefaultLocationEvent(previousLocation, defaultTravelParty));
        }

        return normalized;
    }

    buildLocationStateFromEvent(event, previousLocation = null) {
        if (!event) return null;

        const status = String(event.status || event.type || '').toUpperCase() === 'TRANSIT'
            ? 'TRANSIT'
            : (String(event.status || '').toUpperCase() === 'STAYED' ? 'STAYED' : 'ARRIVED');
        const hasCoordinates = Number.isFinite(Number(event.x)) && Number.isFinite(Number(event.y));

        if (hasCoordinates) {
            const anchorName = event.anchor || event.anchor_node || event.origin
                || previousLocation?.anchor || previousLocation?.anchor_node || null;
            return this.decorateCoordinateState({
                ...event,
                status,
                type: status === 'TRANSIT' ? 'TRANSIT' : 'NODE',
                name: event.name || event.specific_location || (status === 'TRANSIT' ? `On the road to ${event.destination}` : anchorName),
                specific_location: event.specific_location || event.name || anchorName,
                anchor: anchorName,
                destination: status === 'TRANSIT' ? (event.destination || null) : null,
                x: Number(event.x),
                y: Number(event.y)
            });
        }

        // Compatibility for old transit facts that predate canonical coordinates.
        if (event.status === 'TRANSIT' && event.origin && event.destination) {
            const originNode = this.findWorldNodeByName(event.origin);
            const destNode = this.findWorldNodeByName(event.destination);
            if (originNode && destNode) {
                const progress = this.normalizeTransitProgress(event.progress, 0.5);
                const x = originNode.world_x + (destNode.world_x - originNode.world_x) * progress;
                const y = originNode.world_y + (destNode.world_y - originNode.world_y) * progress;
                const locationState = {
                    position_model: 'coordinate_v1',
                    status: 'TRANSIT',
                    type: 'TRANSIT',
                    name: `On the road to ${destNode.name}`,
                    specific_location: event.specific_location || `On the road to ${destNode.name}`,
                    anchor: originNode.name,
                    anchor_node: originNode.name,
                    destination: destNode.name,
                    movement_distance_km: 0,
                    x,
                    y
                };
                return this.decorateCoordinateState(locationState);
            }
        }

        const anchorName = event.anchor_node || event.location || previousLocation?.anchor || previousLocation?.name || 'Unknown Anchor';
        const node = this.findWorldNodeByName(anchorName);
        const locationState = {
            position_model: 'coordinate_v1',
            status,
            type: 'NODE',
            name: event.specific_location || (node ? node.name : anchorName) || previousLocation?.name || 'Unknown Location',
            specific_location: event.specific_location || (node ? node.name : anchorName) || previousLocation?.name || 'Unknown Location',
            anchor: node ? node.name : anchorName,
            anchor_node: node ? node.name : anchorName,
            underground_status: event.underground_status || previousLocation?.underground_status || 'Above Ground',
            destination: null,
            movement_distance_km: 0,
            x: node ? node.world_x : (Number.isFinite(Number(event.x)) ? Number(event.x) : (previousLocation?.x || 0)),
            y: node ? node.world_y : (Number.isFinite(Number(event.y)) ? Number(event.y) : (previousLocation?.y || 0))
        };
        return this.decorateCoordinateState(locationState);
    }

    getMovementRouteContext(event, rawNavigationState) {
        const state = navigationCopilot.normalizeNavigationState(rawNavigationState);
        if (!this.isAutoNavigationPlanningEnabled() && state.manual_order?.status !== 'active') return null;
        const destinationName = String(event?.destination || '').trim().toLowerCase();
        if (!destinationName) return null;
        const matches = (target) => String(target?.name || '').trim().toLowerCase() === destinationName;
        if (matches(state.active_target) && ['mapped', 'map_point'].includes(state.active_target?.map_status)) {
            const plan = navigationCopilot.normalizeRoutePlan(state.active_leg_plan);
            if (plan?.remaining_corridor?.length >= 2) {
                return { state, plan, scope: 'active', syncJourney: this.isJourneyWaypoint(state, state.active_target) };
            }
        }
        const pendingWaypoint = state.journey_plan?.waypoints?.find(waypoint => waypoint.status === 'pending' && matches(waypoint));
        if ((matches(state.journey_target) || pendingWaypoint) && !['unmapped', 'ambiguous'].includes(state.journey_target?.map_status)) {
            const plan = navigationCopilot.normalizeRoutePlan(state.journey_plan);
            if (plan?.remaining_corridor?.length >= 2 && plan.status !== 'suspended') return { state, plan, scope: 'journey', pendingWaypoint };
        }
        return null;
    }

    corridorThroughDestination(corridor, destinationNode, allowIntermediate = false) {
        const points = routeGeometry.normalizePoints(corridor);
        if (!allowIntermediate || points.length < 2) {
            return routeGeometry.normalizePoints([...points, { x: Number(destinationNode.world_x), y: Number(destinationNode.world_y) }]);
        }
        const projection = routeGeometry.projectPointToCorridor(destinationNode, points);
        if (!projection) return points;
        return routeGeometry.normalizePoints([
            ...points.slice(0, projection.segmentIndex + 1),
            { x: Number(destinationNode.world_x), y: Number(destinationNode.world_y) }
        ]);
    }

    applyAdvancedRouteState(routeContext, fullRemainingCorridor, destinationNode, arrived) {
        const state = navigationCopilot.normalizeNavigationState(routeContext.state);
        const updatePlan = (plan, remainingCorridor = fullRemainingCorridor) => navigationCopilot.normalizeRoutePlan({
            ...plan,
            remaining_corridor: remainingCorridor,
            waypoints: (plan?.waypoints || []).map(waypoint => (
                arrived && String(waypoint.name || '').toLowerCase() === String(destinationNode.name || '').toLowerCase()
                    ? { ...waypoint, status: 'reached' }
                    : waypoint
            )),
            status: arrived && String(plan?.destination?.name || '').toLowerCase() === String(destinationNode.name || '').toLowerCase()
                ? 'awaiting'
                : 'active'
        });

        if (routeContext.scope === 'active') state.active_leg_plan = updatePlan(state.active_leg_plan);
        if (routeContext.scope === 'journey' || String(state.journey_target?.name || '').toLowerCase() === String(state.active_target?.name || '').toLowerCase()) {
            state.journey_plan = updatePlan(state.journey_plan);
        } else if (routeContext.syncJourney && state.journey_plan) {
            const currentPoint = fullRemainingCorridor[0];
            const alignedJourney = routeGeometry.alignCorridorToPoint(state.journey_plan.remaining_corridor, currentPoint).corridor;
            state.journey_plan = updatePlan(state.journey_plan, alignedJourney);
        }
        if (arrived && state.manual_order?.status === 'active'
            && String(state.manual_order.target?.name || '').toLowerCase() === String(destinationNode.name || '').toLowerCase()) {
            state.manual_order = { ...state.manual_order, status: 'completed' };
            state.last_reached_target = { ...state.manual_order.target };
            state.active_target = null;
            state.active_leg_plan = null;
            state.journey_target = null;
            state.journey_plan = null;
            state.status = 'awaiting_intent';
            state.last_operation = 'COMPLETE';
        }
        return navigationCopilot.normalizeNavigationState(state);
    }

    resolveCoordinateMovementWithNavigation(event, previousLocation = null, rawNavigationState = null) {
        const routeContext = String(event?.status || '').toUpperCase() === 'TRANSIT'
            ? this.getMovementRouteContext(event, rawNavigationState)
            : null;
        const routeTarget = routeContext?.state?.active_target?.name?.toLowerCase() === String(event?.destination || '').toLowerCase()
            ? routeContext.state.active_target
            : routeContext?.state?.journey_target;
        const destinationNode = routeContext
            ? (this.findWorldNodeByName(event.destination)
                || (routeTarget?.map_status === 'map_point' ? {
                    uid: null,
                    name: routeTarget.name,
                    world_x: Number(routeTarget.x),
                    world_y: Number(routeTarget.y),
                    map_status: 'map_point'
                } : null))
            : null;
        const previous = previousLocation ? this.buildLocationStateFromEvent(previousLocation) : null;
        if (!routeContext || !destinationNode || !previous) {
            return { location: this.resolveCoordinateMovementDirect(event, previousLocation), navigationState: rawNavigationState };
        }

        const requestedKm = this.normalizeMovementDistance(event.distance_traveled_km ?? event.distance_km);
        const scale = this.resolveTravelScale();
        const fullCorridor = routeGeometry.normalizePoints(routeContext.plan.remaining_corridor);
        const destinationIsWaypoint = !!routeContext.pendingWaypoint;
        const movementCorridor = this.corridorThroughDestination(fullCorridor, destinationNode, destinationIsWaypoint);
        const fullRemainingPixels = routeGeometry.corridorLength(fullCorridor);
        const movementPixels = routeGeometry.corridorLength(movementCorridor);
        const planTotalPixels = routeGeometry.corridorLength(routeContext.plan.corridor);
        const planTotalKm = Number(routeContext.plan.distance_km);
        const routeDistanceScale = Number.isFinite(planTotalKm) && planTotalKm > 0 && planTotalPixels > 0 && fullRemainingPixels > 0
            ? {
                remainingKm: planTotalKm * (fullRemainingPixels / planTotalPixels),
                movementKm: planTotalKm * (movementPixels / planTotalPixels)
            }
            : null;
        const displacementPixels = routeDistanceScale?.movementKm > 0
            ? Math.min(movementPixels, (requestedKm / routeDistanceScale.movementKm) * movementPixels)
            : (requestedKm * scale.pixelsPerKm) / scale.windingFactor;
        const advanced = routeGeometry.advanceAlongCorridor(movementCorridor, previous, displacementPixels);
        if (!advanced.point || movementCorridor.length < 2) {
            return { location: this.resolveCoordinateMovementDirect(event, previousLocation), navigationState: rawNavigationState };
        }

        const destinationDistance = Math.hypot(
            Number(advanced.point.x) - Number(destinationNode.world_x),
            Number(advanced.point.y) - Number(destinationNode.world_y)
        );
        const arrived = advanced.reachedEnd || destinationDistance <= 1e-6;
        let fullRemaining = advanced.remaining;
        if (destinationIsWaypoint) {
            const projection = routeGeometry.projectPointToCorridor(destinationNode, fullCorridor);
            if (projection) {
                const afterWaypoint = routeGeometry.trimCorridorFromProjection(fullCorridor, projection);
                fullRemaining = arrived
                    ? routeGeometry.normalizePoints([{ x: destinationNode.world_x, y: destinationNode.world_y }, ...afterWaypoint.slice(1)])
                    : routeGeometry.normalizePoints([...advanced.remaining, ...afterWaypoint.slice(1)]);
            }
        }
        const consumedKm = routeDistanceScale?.movementKm > 0 && movementPixels > 0
            ? routeDistanceScale.movementKm * (Number(advanced.consumedPixels || 0) / movementPixels)
            : (Number(advanced.consumedPixels || 0) / scale.pixelsPerKm) * scale.windingFactor;
        const anchorName = previous.anchor || previous.anchor_node || event.anchor_node || null;
        const isMapPoint = destinationNode.map_status === 'map_point';
        const location = arrived
            ? this.decorateCoordinateState({
                position_model: 'coordinate_v1', status: 'ARRIVED', type: isMapPoint ? 'TRANSIT' : 'NODE', name: destinationNode.name,
                specific_location: destinationNode.name, anchor: isMapPoint ? anchorName : destinationNode.name, anchor_node: isMapPoint ? anchorName : destinationNode.name,
                destination: null, movement_distance_km: consumedKm,
                underground_status: event.underground_status || previous.underground_status || 'Above Ground',
                x: Number(destinationNode.world_x), y: Number(destinationNode.world_y)
            })
            : this.decorateCoordinateState({
                position_model: 'coordinate_v1', status: 'TRANSIT', type: 'TRANSIT',
                name: event.specific_location || `On the road to ${destinationNode.name}`,
                specific_location: event.specific_location || `On the road to ${destinationNode.name}`,
                anchor: anchorName, anchor_node: anchorName, destination: destinationNode.name,
                destination_uid: destinationNode.uid, destination_map_status: destinationNode.map_status || 'mapped', movement_distance_km: consumedKm,
                underground_status: event.underground_status || previous.underground_status || 'Above Ground',
                x: Number(advanced.point.x), y: Number(advanced.point.y)
            });
        return {
            location,
            navigationState: this.applyAdvancedRouteState(routeContext, fullRemaining, destinationNode, arrived)
        };
    }

    resolveCoordinateMovement(event, previousLocation = null, options = {}) {
        return this.resolveCoordinateMovementWithNavigation(event, previousLocation, options.navigationState).location;
    }

    resolveCoordinateMovementDirect(event, previousLocation = null) {
        if (!event) return this.buildLocationStateFromEvent(previousLocation);
        let previous = previousLocation ? this.buildLocationStateFromEvent(previousLocation) : null;
        const status = String(event.status || 'STAYED').toUpperCase();

        if (status === 'ARRIVED') {
            const node = this.findWorldNodeByName(event.anchor_node || event.location || event.destination);
            if (!node) {
                this.tools.logger.warn('LocationMovement', `Arrival node '${event.anchor_node || event.destination || ''}' was not found; retaining previous coordinates.`);
                return previous ? this.decorateCoordinateState({
                    ...previous,
                    status: 'ARRIVED',
                    type: 'NODE',
                    name: event.specific_location || previous.name,
                    specific_location: event.specific_location || previous.specific_location || previous.name,
                    anchor_reference: event.anchor_reference || null,
                    anchor_map_status: event.anchor_map_status || 'unmapped',
                    destination: null,
                    movement_distance_km: 0
                }) : null;
            }
            const movementKm = previous ? this.coordinateDistanceKm(previous, node) : 0;
            return this.decorateCoordinateState({
                position_model: 'coordinate_v1',
                status: 'ARRIVED',
                type: 'NODE',
                name: event.specific_location || node.name,
                specific_location: event.specific_location || node.name,
                anchor: node.name,
                anchor_node: node.name,
                destination: null,
                movement_distance_km: movementKm,
                underground_status: event.underground_status || previous?.underground_status || 'Above Ground',
                x: Number(node.world_x),
                y: Number(node.world_y)
            });
        }

        if (status === 'TRANSIT') {
            if (!previous) {
                const startNode = this.findWorldNodeByName(event.anchor_node || event.origin);
                if (startNode) {
                    previous = this.decorateCoordinateState({
                        position_model: 'coordinate_v1',
                        status: 'STAYED',
                        type: 'NODE',
                        name: startNode.name,
                        specific_location: startNode.name,
                        anchor: startNode.name,
                        anchor_node: startNode.name,
                        destination: null,
                        movement_distance_km: 0,
                        underground_status: event.underground_status || 'Above Ground',
                        x: Number(startNode.world_x),
                        y: Number(startNode.world_y)
                    });
                }
            }
            const destinationName = event.destination || previous?.destination;
            if (event.destination_map_status && event.destination_map_status !== 'mapped') {
                if (!previous) return null;
                return this.decorateCoordinateState({
                    ...previous,
                    status: 'TRANSIT',
                    type: 'TRANSIT',
                    name: event.specific_location || `Travelling toward ${destinationName}`,
                    specific_location: event.specific_location || `Travelling toward ${destinationName}`,
                    destination: destinationName,
                    destination_uid: null,
                    destination_map_status: event.destination_map_status,
                    destination_candidates: event.destination_candidates || [],
                    movement_distance_km: 0,
                    underground_status: event.underground_status || previous.underground_status || 'Above Ground'
                });
            }
            const destinationNode = this.findWorldNodeByName(destinationName);
            if (!previous || !destinationNode) {
                this.tools.logger.warn('LocationMovement', `Transit destination '${destinationName || ''}' could not be resolved; retaining previous coordinates.`);
                return previous ? this.decorateCoordinateState({ ...previous, movement_distance_km: 0 }) : null;
            }

            const requestedKm = this.normalizeMovementDistance(event.distance_traveled_km ?? event.distance_km);
            const scale = this.resolveTravelScale();
            const dx = Number(destinationNode.world_x) - Number(previous.x);
            const dy = Number(destinationNode.world_y) - Number(previous.y);
            const remainingPixels = Math.sqrt((dx * dx) + (dy * dy));
            const remainingKm = (remainingPixels / scale.pixelsPerKm) * scale.windingFactor;

            if (remainingPixels <= 1e-9 || requestedKm >= remainingKm) {
                return this.decorateCoordinateState({
                    position_model: 'coordinate_v1',
                    status: 'ARRIVED',
                    type: 'NODE',
                    name: destinationNode.name,
                    specific_location: destinationNode.name,
                    anchor: destinationNode.name,
                    anchor_node: destinationNode.name,
                    destination: null,
                    movement_distance_km: remainingKm,
                    underground_status: event.underground_status || previous.underground_status || 'Above Ground',
                    x: Number(destinationNode.world_x),
                    y: Number(destinationNode.world_y)
                });
            }

            const displacementPixels = (requestedKm * scale.pixelsPerKm) / scale.windingFactor;
            const ratio = remainingPixels > 0 ? displacementPixels / remainingPixels : 0;
            const anchorName = previous.anchor || previous.anchor_node || event.anchor_node || null;
            return this.decorateCoordinateState({
                position_model: 'coordinate_v1',
                status: 'TRANSIT',
                type: 'TRANSIT',
                name: event.specific_location || `On the road to ${destinationNode.name}`,
                specific_location: event.specific_location || `On the road to ${destinationNode.name}`,
                anchor: anchorName,
                anchor_node: anchorName,
                destination: destinationNode.name,
                destination_uid: destinationNode.uid,
                destination_map_status: 'mapped',
                movement_distance_km: requestedKm,
                underground_status: event.underground_status || previous.underground_status || 'Above Ground',
                x: Number(previous.x) + (dx * ratio),
                y: Number(previous.y) + (dy * ratio)
            });
        }

        if (previous) {
            return this.decorateCoordinateState({
                ...previous,
                status: 'STAYED',
                type: 'NODE',
                name: event.specific_location || previous.name,
                specific_location: event.specific_location || previous.specific_location || previous.name,
                anchor_reference: event.anchor_reference || previous.anchor_reference || null,
                anchor_map_status: event.anchor_map_status || previous.anchor_map_status || 'mapped',
                destination: null,
                movement_distance_km: 0,
                underground_status: event.underground_status || previous.underground_status || 'Above Ground'
            });
        }

        return this.buildLocationStateFromEvent(event, previousLocation);
    }

    async buildTimelineEntry(event, previousLocation = null, options = {}) {
        const resolved = this.resolveCoordinateMovementWithNavigation(event, previousLocation, options.navigationState);
        const state = await this.enrichCoordinateState(resolved.location);
        if (!state) return null;
        const entry = {
            ...state,
            line: event.line,
            travel_party: this.normalizeCharacterList(event.travel_party),
            confidence: event.confidence,
            reasoning: event.reasoning
        };
        return options.returnResolution ? { entry, navigationState: resolved.navigationState } : entry;
    }

    normalizeMemoryRecallCandidates(rawCandidates = [], options = {}) {
        if (!Array.isArray(rawCandidates)) return [];

        const maxCandidates = Math.max(0, Math.min(Number(options.limit ?? 2) || 0, 4));
        const defaultSubject = String(options.defaultSubject || '').replace(/\s+/g, ' ').trim();
        const memories = [];
        const seen = new Set();

        for (const raw of rawCandidates) {
            if (!raw || typeof raw !== 'object') continue;

            const subject = String(raw.subject || raw.location || raw.anchor_node || raw.entity || raw.source || defaultSubject).replace(/\s+/g, ' ').trim();
            const memory = String(raw.memory || raw.text || raw.statement || '').replace(/\s+/g, ' ').trim();
            const evidence = String(raw.evidence || raw.scene_basis || raw.context || '').replace(/\s+/g, ' ').trim();
            const whyItMatters = String(raw.why_it_matters || raw.future_use || raw.importance || '').replace(/\s+/g, ' ').trim();
            const notAlreadyTracked = String(raw.not_already_tracked || raw.not_tracked_by || raw.distinct_from_tracker || '').replace(/\s+/g, ' ').trim();
            const line = Number(raw.line ?? raw.evidence_line);
            const hasSceneBasis = Number.isInteger(line) || evidence.length > 0;

            if (!subject || !memory || !hasSceneBasis || !whyItMatters || !notAlreadyTracked) continue;

            const key = `${subject.toLowerCase()}|${memory.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            memories.push({
                subject,
                kind: String(raw.kind || 'location_memory').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 64) || 'location_memory',
                memory,
                evidence: [
                    Number.isInteger(line) ? `Line ${line}` : '',
                    evidence,
                    `Why it matters later: ${whyItMatters}`,
                    `Not already tracked because: ${notAlreadyTracked}`
                ].filter(Boolean).join(' | '),
                cues: Array.isArray(raw.cues) ? raw.cues : [],
                durability: raw.durability || 'situational',
                salience: Number.isFinite(Number(raw.salience)) ? Number(raw.salience) : 5
            });

            if (memories.length >= maxCandidates) break;
        }

        return memories;
    }

    async storeLocationMemoryRecalls(turnContext, result = {}, defaultLocation = null) {
        const defaultSubject = defaultLocation?.anchor || defaultLocation?.anchor_node || defaultLocation?.name || defaultLocation?.specific_location || 'unknown location';
        const candidates = this.normalizeMemoryRecallCandidates(result?._memory_recall, {
            defaultSubject,
            limit: 2
        });

        if (candidates.length === 0) return;

        try {
            const stored = await this.tools.plugins.tryCall(
                'memory_recall',
                'storeMemories',
                [candidates, { sourcePlugin: 'world_location_tracker', domain: 'location' }],
                { fallback: null, silent: true }
            );
            if (stored !== null && stored !== undefined) {
                this.tools.logger.runtime(`Stored ${candidates.length} location memory recall candidate(s).`);
            }
        } catch (error) {
            this.tools.logger.warn('Logic', `Failed to store location memory recall candidates: ${error.message}`);
        }
    }

    async cleanCurrentTurnLocationFacts(turnContext) {
        const timeline = this.tools.pluginState.turn().locationTimeline || turnContext?.output?.locationTimeline || [];
        const predicates = [
            'location_timeline',
            'location_change',
            'location_anchor',
            'location_view',
            ...timeline.map(event => `location_event:${event.line}`)
        ];
        await this.tools.facts.cleanUpFactsDb({ predicates: [...new Set(predicates)] });
    }

    isManualMovementAuthorized(event, rawNavigationState) {
        const state = navigationCopilot.normalizeNavigationState(rawNavigationState);
        const order = state.manual_order;
        if (!order?.authorized || order.status !== 'active') return false;
        const references = [
            order.target?.name,
            ...(state.journey_plan?.waypoints || []).filter(waypoint => waypoint.status === 'pending').map(waypoint => waypoint.name)
        ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
        const requested = [event?.destination, event?.anchor_node, event?.location]
            .map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
        return requested.some(value => references.includes(value));
    }

    shouldClampMovementEvent(event, previousLocation, navigationState) {
        if (!event || !previousLocation) return false;
        const status = String(event.status || 'STAYED').toUpperCase();
        let attemptsMapMovement = status === 'TRANSIT' || status === 'ARRIVED';
        const requestedAnchor = this.findWorldNodeByName(event.anchor_node || event.location);
        const currentAnchor = this.findWorldNodeByName(previousLocation.anchor || previousLocation.anchor_node);
        if (requestedAnchor && currentAnchor && String(requestedAnchor.uid) !== String(currentAnchor.uid)) attemptsMapMovement = true;
        return attemptsMapMovement && !this.isManualMovementAuthorized(event, navigationState);
    }

    clampMovementEvent(event, previousLocation) {
        return {
            ...event,
            status: 'STAYED',
            destination: null,
            destination_uid: null,
            distance_traveled_km: 0,
            distance_km: 0,
            anchor_node: previousLocation?.anchor_node || previousLocation?.anchor || null,
            anchor_reference: previousLocation?.anchor_node || previousLocation?.anchor || null,
            specific_location: previousLocation?.specific_location || previousLocation?.name || 'Current location',
            reasoning: `${String(event?.reasoning || '').trim()} Movement was mechanically clamped because Manual Movement Only is enabled and no user map order authorized this departure.`.trim()
        };
    }

    async recordMovementLockViolation(turnContext, event, previousLocation) {
        const violation = {
            turn_number: Number(turnContext?.turnNumber || 0),
            attempted_destination: String(event?.destination || event?.anchor_node || event?.location || 'another mapped location'),
            retained_location: String(previousLocation?.specific_location || previousLocation?.name || previousLocation?.anchor || 'the current location'),
            line: Number(event?.line || 0)
        };
        await this.tools.facts.appendToFactsDb({
            source: 'world_location_tracker', target: 'party', predicate: 'movement_lock_violation',
            fact_value: JSON.stringify(violation), context: 'manual_movement_only_clamp'
        }, { turn_number: turnContext.turnNumber });
        this.logDecision(`Manual movement lock clamped unauthorized travel toward ${violation.attempted_destination}.`);
    }

    async getPreviousMovementLockCorrection(turnContext) {
        const turnNumber = Number(turnContext?.turnNumber || 0);
        if (turnNumber <= 1) return '';
        try {
            const rows = await this.tools.db.chat.query(
                `SELECT fact_value FROM facts WHERE project_name = ? AND source = 'world_location_tracker'
                 AND predicate = 'movement_lock_violation' AND turn_number = ? ORDER BY id DESC LIMIT 1`,
                [this.getEffectiveProjectName(turnContext), turnNumber - 1]
            );
            if (!rows?.length) return '';
            const violation = JSON.parse(rows[0].fact_value || '{}');
            return `CONTINUITY CORRECTION: The previous chapter described unauthorized map travel toward ${violation.attempted_destination || 'another location'}, but Manual Movement Only was enabled. Mechanically, the party remained at ${violation.retained_location || 'its prior location'}. Continue from the retained location and do not treat the unauthorized departure or arrival as established.`;
        } catch {
            return '';
        }
    }

    getDisplayLocationLabel(location) {
        return String(
            location?.specific_location
            || location?.name
            || location?.anchor_node
            || location?.anchor
            || ''
        ).replace(/\s+/g, ' ').trim();
    }

    buildLocationTitleContributions(timeline = [], previousLocation = null) {
        let previousLabel = this.getDisplayLocationLabel(previousLocation);
        const contributions = [];
        const sorted = (Array.isArray(timeline) ? timeline : [])
            .filter(entry => entry && Number.isFinite(Number(entry.line)))
            .slice()
            .sort((left, right) => Number(left.line) - Number(right.line));

        for (const entry of sorted) {
            const currentLabel = this.getDisplayLocationLabel(entry);
            if (!currentLabel) continue;
            if (currentLabel.toLowerCase() !== previousLabel.toLowerCase()) {
                contributions.push({
                    line: Math.max(0, Math.round(Number(entry.line))),
                    kind: 'location',
                    text: currentLabel
                });
            }
            previousLabel = currentLabel;
        }
        return contributions;
    }

    async registerLocationTitleContributions(turnContext, timeline, previousLocation) {
        if (!this.tools.plugins?.isInstalled?.('vn_cinematographer')) return [];
        const contributions = this.buildLocationTitleContributions(timeline, previousLocation);
        return await this.tools.plugins.tryCall(
            'vn_cinematographer',
            'replaceTitleContributions',
            [{ source: 'world_location_tracker', contributions }],
            { fallback: [], silent: true }
        );
    }

    async persistLocationTimeline(turnContext, events, previousLocation, result = {}, options = {}) {
        const existingManualLocation = this.tools.pluginState.turn().locationState;
        if (existingManualLocation?.manual_order_id) {
            this.logDecision(`Ignored stale location timeline write after manual arrival ${existingManualLocation.manual_order_id}.`);
            const retainedTimeline = this.tools.pluginState.turn().locationTimeline || [];
            await this.registerLocationTitleContributions(turnContext, retainedTimeline, previousLocation);
            return {
                finalEntry: existingManualLocation,
                navigationState: options.navigationState || null,
                timeline: retainedTimeline,
                navigationTimeline: []
            };
        }
        const turnNumber = turnContext.turnNumber;
        const timeline = [];
        const navigationTimeline = [];
        let sequentialState = previousLocation;
        let sequentialNavigationState = options.navigationState || null;
        const movementPolicy = await this.getManualMovementPolicy();
        for (const event of events) {
            let effectiveEvent = event;
            if (movementPolicy.manual_movement_only && this.shouldClampMovementEvent(event, sequentialState, sequentialNavigationState)) {
                await this.recordMovementLockViolation(turnContext, event, sequentialState);
                effectiveEvent = this.clampMovementEvent(event, sequentialState);
            }
            const resolved = await this.buildTimelineEntry(effectiveEvent, sequentialState, {
                navigationState: sequentialNavigationState,
                returnResolution: true
            });
            if (!resolved?.entry) continue;
            timeline.push(resolved.entry);
            sequentialState = resolved.entry;
            sequentialNavigationState = resolved.navigationState;
            if (sequentialNavigationState) {
                navigationTimeline.push({ line: effectiveEvent.line, state: navigationCopilot.normalizeNavigationState(sequentialNavigationState) });
            }
        }
        const finalEntry = timeline[timeline.length - 1] || null;

        this.tools.pluginState.turn().locationTimeline = timeline;
        if (finalEntry) {
            this.tools.pluginState.turn().locationState = finalEntry;
        }
        turnContext.output.locationTimeline = timeline;
        await this.registerLocationTitleContributions(turnContext, timeline, previousLocation);

        await this.tools.facts.appendToFactsDb({
            source: 'party',
            target: 'self',
            predicate: 'location_timeline',
            fact_value: JSON.stringify(timeline),
            context: 'indexed_location_events'
        }, { turn_number: turnNumber });

        for (const event of timeline) {
            await this.tools.facts.appendToFactsDb({
                source: 'party',
                target: 'self',
                predicate: `location_event:${event.line}`,
                fact_value: JSON.stringify(event),
                context: 'indexed_location_event'
            }, { turn_number: turnNumber });
        }

        if (!finalEntry) return { finalEntry: null, navigationState: sequentialNavigationState, timeline, navigationTimeline };

        if (options.storeMemoryRecalls !== false) {
            await this.storeLocationMemoryRecalls(turnContext, result, finalEntry);
        }

        const finalResult = {
            ...finalEntry,
            status: finalEntry.status,
            specific_location: finalEntry.specific_location || finalEntry.name,
            anchor_node: finalEntry.anchor_node || finalEntry.anchor,
            underground_status: finalEntry.underground_status || 'Above Ground',
            destination: finalEntry.destination,
            movement_distance_km: finalEntry.movement_distance_km,
            travel_party: this.normalizeCharacterList(finalEntry.travel_party),
            characters: options.applyCharacters === false ? null : result.characters
        };

        await this._applyLocationState(turnContext, finalResult, previousLocation);
        return { finalEntry, navigationState: sequentialNavigationState, timeline, navigationTimeline };
    }

    async updateLocation(turnContext) {
        const context = turnContext || this.tools.turnContext;
        const turnNumber = context?.turnNumber;

        // updateLocation runs as a VN pipeline task after background selection.
        // It analyzes the narrative output to establish indexed location states for this turn.
        if (turnNumber < 1) {
            this.tools.logger.runtime(`Skipping updateLocation - Invalid Turn Number: ${turnNumber}`);
            this.tools.logger.runtime(`[LocationUpdate] Skipped`);
            return;
        }

        await this.loadWorldData(context, { skipTiling: true });
        const operationalStatus = this.getLoadedOperationalStatus();
        if (!operationalStatus.active) {
            this.tools.logger.runtime(`[LocationUpdate] Dormant: ${operationalStatus.reason}`);
            return;
        }

        // Ensure no leftover location data from a failed/retried turn only when tracking is active.
        await this.tools.facts.cleanUpFactsDb();

        const previousChapter = await context.getPreviousChapter();
        const manualActivation = context?.runtime?.worldLocationTracker?.manualOrderActivation || null;
        const previousLocation = manualActivation?.location
            || await this.getCurrentLocation(previousChapter || context);
        const previousNavigationState = manualActivation?.navigation_state
            ? navigationCopilot.normalizeNavigationState(manualActivation.navigation_state)
            : await this.getPreviousNavigationState(context, previousChapter);

        // Use writerResponse as the source of truth for narrative analysis.
        const currentNarrative = context.processed?.narrativeEngine?.writerResponse || "";

        if (!currentNarrative) {
            this.tools.logger.warn('Logic', 'No narrative output found for location update.');
            this.tools.logger.runtime(`[LocationUpdate] Skipped: No narrative`);
            return;
        }

        // Provide previous turn's output as context
        let previousScene = "";
        if (previousChapter) {
            previousScene = previousChapter.output.fulltext || previousChapter.processed?.narrativeEngine?.writerResponse || "";
        }

        if (!this.worldData || !this.worldData.nodes) {
            this.tools.logger.warn('Logic', 'No world data loaded, skipping update.');
            this.tools.logger.runtime(`[LocationUpdate] Failed: No world data`);
            return;
        }

        try {
            const promptPath = path.join(__dirname, 'prompts', 'location_update.txt');
            let promptTemplate = await fs.readFile(promptPath, 'utf-8');

            let characterTrackingSection = "";
            let characterJsonField = "";
            const isCharSheetActive = this.tools.plugins.isInstalled('character_sheets');

            if (isCharSheetActive) {
                let partyChars = turnContext.output?.party || [];

                // If proactive pass (no party yet), fallback to previous turn's party
                if (partyChars.length === 0 && previousChapter) {
                    partyChars = previousChapter.output?.party || [];
                }

                // Filter out minor characters
                let activeChars = partyChars;
                if (this.tools.plugins.isInstalled('character_classifier')) {
                    const filtered = [];
                    for (const char of partyChars) {
                        const importance = await this.resolveCharacterImportance(char, turnContext);
                        if (!this.isFilteredImportance(importance) && !!importance) {
                            filtered.push(char);
                        }
                    }
                    activeChars = filtered;
                    this.tools.logger.runtime(`Filtered ${partyChars.length} party members to ${activeChars.length} MAJOR characters for location tracking.`);
                }

                if (activeChars.length > 0) {
                    this.tools.logger.runtime(`Enabling character tracking for: ${activeChars.join(', ')}`);
                    characterTrackingSection = `### CHARACTER TRACKING:
For each character in the ACTIVE CHARACTERS list below, determine their current location and context.
- anchor_node (MANDATORY): Pick something from the WORLD LOCATIONS list.
- specific_location: Where inside that location.
- context: What the character is doing there (can be mundane like "living there").
- confidence: Score from 0.0 to 1.0 (for debug).
- reasoning: Why the model chose this (for debug).

ACTIVE CHARACTERS:
${activeChars.join(', ')}`;

                    characterJsonField = `"characters": { "Character Name": { "specific_location": "...", "anchor_node": "...", "context": "...", "confidence": 0.0, "reasoning": "..." } },`;
                }
            }

            const previousStatus = this.isTransitLocationState(previousLocation) ? 'TRANSIT' : 'AT LOCATION';
            const prevLocName = previousLocation
                ? [
                    `${previousLocation.name || previousLocation.anchor || 'Unknown Location'}`,
                    `State: ${previousStatus}`,
                    `Confirmed anchor: ${previousLocation.anchor || previousLocation.anchor_node || previousLocation.origin || previousLocation.name || 'Unknown Anchor'}`,
                    previousLocation.destination ? `Current destination: ${previousLocation.destination}` : '',
                    `View: ${previousLocation.underground_status || 'Above Ground'}`
                ].filter(Boolean).join('\n')
                : "Unknown Start";
            const travelScale = this.resolveTravelScale();
            const distanceDefinition = this.getDistanceUnitDefinition();
            const travelAssumptions = `Preferred narrative distance unit: ${distanceDefinition.label}. Normal walking pace: approximately ${this.formatDistance(travelScale.baseSpeed, { long: true })} per full travel day. Use explicit narrative distance or elapsed time first; otherwise estimate conservatively. Convert the result to kilometres only for the internal distance_traveled_km JSON field.`;
            const travelProgressContext = this.buildTravelProgressContext(previousNavigationState);
            const directorLocation = String(context.runtime?.worldLocationTracker?.directorLocation || '').trim();
            const directorLocationSection = directorLocation
                ? `### DIRECTOR WORLD LOCATION CONTEXT:\n${directorLocation}\n\nThis is Director continuity context. Use the current narrative as authority for the party's actual location.`
                : '';
            const numberedScript = this.buildNumberedScript(context);
            const backgroundChanges = this.formatBackgroundChangeHints(context);
            const directorPluginFeedback = await this.tools.director.getFeedback();
            const travelPartyCandidates = this.formatTravelPartyCandidateSection(
                await this.getTravelPartyCandidateNames(context, previousChapter)
            );

            const prompt = promptTemplate
                .replace('${worldData}', JSON.stringify(this.worldData.nodes, null, 2))
                .replace('${previousLocation}', prevLocName)
                .replace('${previousNavigationState}', this.replaceDistanceMentions(navigationCopilot.buildNavigationPromptText(previousNavigationState)) || 'No active navigation intent or accepted route.')
                .replace('${travelAssumptions}', travelAssumptions)
                .replace('${distanceUnitGuidance}', `Use ${distanceDefinition.label} in human-facing reasoning. The distance_traveled_km field remains an internal kilometre value.`)
                .replace('${travelProgressContext}', travelProgressContext)
                .replace('${directorLocationSection}', directorLocationSection)
                .replace('${previousScene}', previousScene)
                .replace('${currentNarrative}', currentNarrative)
                .replace('${numberedScript}', numberedScript || currentNarrative)
                .replace('${backgroundChanges}', backgroundChanges)
                .replace('${directorPluginFeedback}', directorPluginFeedback || 'No previous-turn Director feedback is available for this plugin.')
                .replace('${travelPartyCandidates}', travelPartyCandidates)
                .replace('${characterTrackingSection}', characterTrackingSection)
                .replace('${characterJsonField}', characterJsonField);

            const messages = [{ role: 'user', content: prompt }];

            const modelDef = this.getLocationModel();
            const llmResponse = await this.tools.llm.json({
                msg: 'Location Update',
                requestId: 'location_update',
                prompt,
                model: modelDef.model || 'mediumendmodel',
                provider: modelDef.provider,
                callingModule: 'Plugin:world_location_tracker'
            });

            const result = llmResponse.content;
            if (!result) {
                this.tools.logger.warn('Logic', 'LLM returned empty content for location update.');
                this.tools.logger.runtime(`[LocationUpdate] Failed: Empty LLM response`);
                return;
            }

            messages.push({ role: 'assistant', content: JSON.stringify(result) });
            const provisionalResult = await this.groundLocationAnalysis(result, messages, previousLocation, previousNavigationState, { allowLlm: false });
            const events = this.normalizeLocationEvents(provisionalResult, previousLocation, context);
            await this.persistLocationTimeline(context, events, previousLocation, provisionalResult, {
                navigationState: previousNavigationState
            });
            context.runtime = context.runtime || {};
            context.runtime.worldLocationTracker = context.runtime.worldLocationTracker || {};
            Object.defineProperty(context.runtime.worldLocationTracker, 'pendingNavigation', {
                value: { result, messages, previousLocation, previousNavigationState, currentNarrative, previousScene },
                configurable: true,
                enumerable: false,
                writable: true
            });
            const grounding = this.lastGroundingSummary || { references: 0, deferred: 0 };
            this.logDecision(`Blocking pass: ${this.summarizeLocationEvents(events) || 'no location events'}; ${this.summarizeNavigationUpdate(result.navigation_update)}; grounding=${grounding.references} reference(s), ${grounding.deferred} deferred. Provisional GUI state published; background continuation queued.`);
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to update location: ${error.message}`);
            this.tools.logger.runtime(`[LocationUpdate] Failed: ${error.message}`);
        }
    }

    async completePendingNavigation(turnContext) {
        const pending = turnContext?.runtime?.worldLocationTracker?.pendingNavigation;
        if (!pending) {
            return false;
        }

        const refinementStartedAt = Date.now();
        await this.loadWorldData(turnContext, { skipTiling: true });
        try {
            this.logDecision('Background refinement started: destination grounding, route research, and navigation persistence.');
            const groundedResult = await this.groundLocationAnalysis(
                pending.result,
                pending.messages,
                pending.previousLocation,
                pending.previousNavigationState,
                { allowLlm: true }
            );

            await this.cleanCurrentTurnLocationFacts(turnContext);
            const events = this.normalizeLocationEvents(groundedResult, pending.previousLocation, turnContext);
            const movementResult = await this.persistLocationTimeline(turnContext, events, pending.previousLocation, groundedResult, {
                storeMemoryRecalls: false,
                applyCharacters: false,
                navigationState: pending.previousNavigationState
            });

            if (this.isAutoNavigationPlanningEnabled()) {
                try {
                    const currentLocation = this.tools.pluginState.turn().locationState || pending.previousLocation;
                    let finalNavigationState;
                    if (groundedResult.navigation_update) {
                        finalNavigationState = await this.updateLayeredNavigationCopilot(
                            turnContext,
                            groundedResult.navigation_update,
                            movementResult?.navigationState || pending.previousNavigationState,
                            currentLocation,
                            { currentNarrative: pending.currentNarrative, previousScene: pending.previousScene, messages: pending.messages }
                        );
                    } else {
                        finalNavigationState = await this.updateNavigationCopilot(
                            turnContext,
                            groundedResult.navigation_intent,
                            movementResult?.navigationState || pending.previousNavigationState,
                            currentLocation,
                            { currentNarrative: pending.currentNarrative, previousScene: pending.previousScene, messages: pending.messages }
                        );
                    }
                    const navigationTimeline = this.buildNavigationTimeline(
                        pending.previousNavigationState,
                        finalNavigationState,
                        groundedResult,
                        movementResult?.navigationTimeline || []
                    );
                    await this.persistNavigationTimeline(turnContext, navigationTimeline);
                } catch (navigationError) {
                    this.tools.logger.error('NavigationCopilot', `Background route planning failed after location refinement: ${navigationError.message}`);
                }
            }
            const elapsedSeconds = ((Date.now() - refinementStartedAt) / 1000).toFixed(1);
            this.logDecision(`Background refinement complete in ${elapsedSeconds}s: ${this.summarizeLocationEvents(events) || 'no location events'}. HUD refresh requested.`);
            return true;
        } finally {
            delete turnContext.runtime.worldLocationTracker.pendingNavigation;
        }
    }

    async isNewAnchorNode(anchorName, turnNumber, projectName) {
        if (!anchorName) return false;
        try {
            const rows = await this.tools.db.chat.query(
                `SELECT id FROM facts 
                 WHERE project_name = ? 
                   AND predicate IN ('location_anchor', 'location_change') 
                   AND fact_value = ? 
                   AND turn_number < ? 
                 ORDER BY id DESC LIMIT 1`,
                [projectName.toLowerCase(), anchorName, turnNumber]
            );
            return !(rows && rows.length > 0);
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to check for new anchor node: ${error.message}`);
            return false;
        }
    }

    async getCharacterLocation(charName, turnNumber, turnContext) {
        if (!charName) {
            return null;
        }

        const operationalStatus = await this.getOperationalStatus(turnContext || this.turnContext);
        if (!operationalStatus.active) return null;

        const importance = await this.resolveCharacterImportance(charName, turnContext);
        if (this.isFilteredImportance(importance)) {
            return null;
        }
        if (this.tools.plugins.isInstalled('character_classifier') && !importance) {
            return null;
        }

        // 1. Check if the character is in the Party for the CURRENT turn
        // If they are, they share the party's location state
        const party = turnContext?.output?.party || [];
        if (party.includes(charName)) {
            const partyLoc = await this.getCurrentLocation(turnContext);
            if (partyLoc) {
                const locName = partyLoc.anchor && partyLoc.anchor !== partyLoc.name 
                    ? `${partyLoc.name} (${partyLoc.anchor})`
                    : partyLoc.name;
                return {
                    anchor_node: partyLoc.anchor || partyLoc.destination || partyLoc.name,
                    specific_location: locName,
                    underground_status: partyLoc.underground_status || "Above Ground",
                    context: "With the party.",
                    x: Number.isFinite(Number(partyLoc.x)) ? Number(partyLoc.x) : null,
                    y: Number.isFinite(Number(partyLoc.y)) ? Number(partyLoc.y) : null,
                    status: partyLoc.type || null,
                    destination: partyLoc.destination || null,
                    movement_distance_km: this.normalizeMovementDistance(partyLoc.movement_distance_km),
                    nearest_node: partyLoc.nearest_node || null,
                    biome: partyLoc.biome || null
                };
            }
        }

        // 2. Query the database for the most recent CHAR_LOCATION fact for this character
        const projectName = (turnContext?.projectName || this.tools.turnContext?.projectName || "default").toLowerCase();
        if (projectName) {
            try {
                const result = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? 
                       AND source = ? 
                       AND predicate = 'CHAR_LOCATION'
                       AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName, charName.toLowerCase(), turnNumber]
                );

                if (result && result.length > 0) {
                    const data = JSON.parse(result[0].fact_value);
                    return {
                        anchor_node: data.anchor_node || data.specific_location,
                        specific_location: data.specific_location || "Unknown",
                        underground_status: data.underground_status || "Above Ground",
                        context: data.context || "No context provided."
                    };
                }
            } catch (error) {
                this.tools.logger.error('Logic', `Failed to fetch character location from DB: ${error.message}`);
            }
        }

        return null;
    }

    async bootstrapCharacterLocations(characters, loreContext, turnContext) {
        this.tools.logger.runtime(`[LocationBootstrap] Bootstrapping locations for ${characters ? characters.length : 0} characters`);
        const operationalStatus = await this.getOperationalStatus(turnContext || this.turnContext);
        if (!operationalStatus.active) {
            this.tools.logger.runtime(`[LocationBootstrap] Dormant: ${operationalStatus.reason}`);
            return;
        }
        if (!characters || characters.length === 0) {
            this.tools.logger.runtime(`[LocationBootstrap] Skipped: No characters`);
            return;
        }

        // Ensure no leftover location data from a failed/retried bootstrap
        await this.tools.facts.cleanUpFactsDb();

        const playerCharacterName = turnContext.input?.playerCharacterName || 'Player';
        const hasClassifier = this.tools.plugins.isInstalled('character_classifier');
        const filteredChars = [];
        for (const c of characters) {
            if (!c || !c.name || c.name === playerCharacterName || c.status === 'DEAD') continue;
            const importance = await this.resolveCharacterImportance(c.name, turnContext);
            if (this.isFilteredImportance(importance)) {
                this.tools.logger.runtime(`Skipping bootstrap candidate '${c.name}' due to importance=${importance}.`);
                continue;
            }
            if (hasClassifier && !importance) {
                this.tools.logger.runtime(`Skipping bootstrap candidate '${c.name}' because classifier has no importance record.`);
                continue;
            }
            filteredChars.push(c);
        }

        this.tools.logger.runtime(`Filtered ${characters.length} characters down to ${filteredChars.length} (Excluding dead, player, and invalid).`);

        if (filteredChars.length === 0) {
            this.tools.logger.runtime(`[LocationBootstrap] Skipped: No valid characters after filtering`);
            return;
        }

        try {
            await this.loadWorldData(turnContext);
            if (!this.worldData || !this.worldData.nodes) {
                this.tools.logger.warn('Logic', 'No world data nodes available for bootstrap.');
                this.tools.logger.runtime(`[LocationBootstrap] Failed: No world data nodes`);
                return;
            }

            const promptPath = path.join(__dirname, 'prompts', 'location_bootstrap.txt');
            let promptTemplate = await fs.readFile(promptPath, 'utf-8');

            const charList = filteredChars.map(c => `- ${c.name}: ${c.brief || c.biography || 'No description'}`).join('\n');

            const prompt = promptTemplate
                .replace('${worldData}', JSON.stringify(this.worldData.nodes, null, 2))
                .replace('${characterList}', charList)
                .replace('${loreContext}', loreContext || "No additional lore provided.");

            const messages = [{ role: 'user', content: prompt }];

            // Use the plugin's configured model, falling back to a medium model
            const modelDef = this.getLocationModel();
            const targetModel = modelDef.model || 'mediumendmodel';
            const targetProvider = modelDef.provider;

            this.tools.logger.runtime(`Requesting batch location bootstrap from ${targetProvider}/${targetModel}...`);

            this.tools.logger.runtime(`[LLM_Call] Calling LLM for character location bootstrap`);
            const llmResponse = await this.tools.llm.json({
                msg: 'Location Bootstrap',
                requestId: 'location_bootstrap',
                prompt,
                model: targetModel,
                provider: targetProvider,
                callingModule: 'Plugin:world_location_tracker:bootstrap'
            });
            this.tools.logger.runtime(`[LLM_Call] LLM response received for character location bootstrap`);

            const result = llmResponse.content;
            if (result && result.characters) {
                const turnNumber = 0; // Seeding at Turn 0

                // Robust handling of both Object and Array formats
                const charEntries = Array.isArray(result.characters)
                    ? result.characters.map(c => [c.name || c.CharacterName, c])
                    : Object.entries(result.characters);

                this.tools.logger.runtime(`Processing ${charEntries.length} character locations from LLM.`);
                const isCharSheetActive = this.tools.plugins.isInstalled('character_sheets');

                for (let [charName, charLoc] of charEntries) {
                    if (!charName || !charLoc) continue;

                    // Resolve name to canonical if possible
                    if (isCharSheetActive) {
                        const resolved = await this.tools.plugins.call('character_sheets', 'resolveName', charName);
                        if (resolved && resolved !== charName) {
                            this.tools.logger.runtime(`Resolved character name for bootstrap: '${charName}' -> '${resolved}'`);
                            charName = resolved;
                        }
                    }

                    const importance = await this.resolveCharacterImportance(charName, turnContext);
                    if (this.isFilteredImportance(importance)) {
                        this.tools.logger.runtime(`Skipping bootstrap DB persistence for ${importance.toUpperCase()} character: ${charName}`);
                        continue;
                    }
                    if (hasClassifier && !importance) {
                        this.tools.logger.runtime(`Skipping bootstrap DB persistence for unclassified character: ${charName}`);
                        continue;
                    }

                    const locText = charLoc.specific_location || charLoc.location || "Unknown";
                    const anchorName = charLoc.anchor_node || charLoc.anchor || locText;
                    const contextText = charLoc.context || charLoc.activity || "Living their life.";
                    const fullText = `${locText}, ${contextText}`;

                    const factValue = JSON.stringify({
                        specific_location: locText,
                        anchor_node: anchorName,
                        context: contextText
                    });

                    this.tools.logger.runtime(`  - Saving location for ${charName}: ${locText} (Anchor: ${anchorName})`);
                    // Primary location fact (for map tracker)
                    await this.tools.facts.appendToFactsDb({
                        source: charName.toLowerCase(),
                        target: 'self',
                        predicate: 'CHAR_LOCATION',
                        fact_value: factValue
                    }, { turn_number: turnNumber });

                    // Secondary location fact (for character sheets/HUD)
                    await this.tools.facts.appendToFactsDb({
                        source: charName.toLowerCase(),
                        target: 'self',
                        predicate: 'CHAR_SHEET:CURRENT_CONTEXT',
                        fact_value: fullText
                    }, { turn_number: turnNumber });
                }
                this.tools.logger.runtime(`[LocationBootstrap] Success: ${charEntries.length} characters placed.`);
            } else {
                this.tools.logger.warn('Logic', 'LLM failed to return valid characters for bootstrap.');
                this.tools.logger.runtime(`[LocationBootstrap] Failed: Invalid LLM response structure`);
            }
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to bootstrap character locations: ${error.message}`);
            this.tools.logger.runtime(`[LocationBootstrap] Failed: ${error.message}`);
        }
    }

    async getCurrentLocation(turnContext) {
        // this.tools.logger.log('CurrentLocation', 'Retrieving current party location...', 'start');
        if (!turnContext) {
            this.tools.logger.warn('Logic', 'getCurrentLocation called without turnContext.');
            // this.tools.logger.log('CurrentLocation', 'Failed: No turnContext', 'end');
            return null;
        }

        const operationalStatus = await this.getOperationalStatus(turnContext);
        if (!operationalStatus.active) return null;

        // 1. Try to get from the provided TurnContext
        const currentLocationState = this.tools.pluginState.fromContext(turnContext).turn().locationState;
        if (currentLocationState) {
            const loc = currentLocationState;
            // this.tools.logger.log('CurrentLocation', `Success (Memory): ${loc.name}`, 'end');
            if (!this.worldData) await this.loadWorldData(turnContext);
            return await this.enrichCoordinateState(this.buildLocationStateFromEvent(loc));
        }

        // 2. If it's a "fresh" turn context (no state yet), try to get from the PREVIOUS chapter
        // This prevents the map from resetting to 0,0 during live generation.
        // IMPORTANT: Skip this for skeleton TurnContexts (used by Timeline) — skeletons must
        // resolve their own turn's location from the DB facts, not the previous turn's state.
        if (!turnContext.isSkeleton && typeof turnContext.getPreviousChapter === 'function') {
            try {
                const prevChapter = await turnContext.getPreviousChapter();
                const previousLocationState = prevChapter
                    ? this.tools.pluginState.fromContext(prevChapter).turn().locationState
                    : null;
                if (previousLocationState) {
                    const loc = previousLocationState;
                    // this.tools.logger.log('CurrentLocation', `Success (Prev Chapter): ${loc.name}`, 'end');
                    if (!this.worldData) await this.loadWorldData(turnContext);
                    return await this.enrichCoordinateState(this.buildLocationStateFromEvent(loc));
                }
            } catch (err) {
                this.tools.logger.error('Logic', `Failed to retrieve previous chapter for location fallback: ${err.message}`);
            }
        }

        // 3. Fallback to DB fact search (last resort)
        const projectName = this.getEffectiveProjectName(turnContext);
        const factTurnNumber = this.getFactBaseTurnNumber(turnContext) || 999999;
        let locationName = null;
        let anchorName = null;

        if (projectName) {
            try {
                const timelineResult = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? 
                       AND predicate = 'location_timeline' 
                       AND source = 'party'
                       AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName, factTurnNumber]
                );
                if (timelineResult && timelineResult.length > 0) {
                    const parsed = JSON.parse(timelineResult[0].fact_value || '[]');
                    const timeline = Array.isArray(parsed)
                        ? parsed
                        : (Array.isArray(parsed.location_events) ? parsed.location_events : []);
                    const finalEvent = timeline
                        .filter(event => event && typeof event === 'object')
                        .sort((left, right) => this.clampLineIndex(left.line, 999999) - this.clampLineIndex(right.line, 999999))
                        .at(-1);

                    if (finalEvent) {
                        const timelineState = this.buildLocationStateFromEvent(finalEvent);
                        if (timelineState) {
                            return await this.enrichCoordinateState(timelineState);
                        }
                    }
                }
            } catch (error) {
                this.tools.logger.warn('Logic', `Failed to fetch current location timeline from DB: ${error.message}`);
            }

            try {
                // Fetch the latest location_change
                const locResult = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? 
                       AND predicate = 'location_change' 
                       AND source = 'party'
                       AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName, factTurnNumber]
                );
                if (locResult && locResult.length > 0) {
                    locationName = locResult[0].fact_value;
                }

                // Also fetch the latest location_anchor for coordinates
                const anchorResult = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? 
                       AND predicate = 'location_anchor' 
                       AND source = 'party'
                       AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName, factTurnNumber]
                );
                if (anchorResult && anchorResult.length > 0) {
                    anchorName = anchorResult[0].fact_value;
                }
            } catch (error) {
                this.tools.logger.error('Logic', `Failed to fetch current location from DB: ${error.message}`);
            }
        }

        if (!locationName && !anchorName) {
            // this.tools.logger.log('CurrentLocation', 'Failed: No DB data', 'end');
            return null;
        }

        // Resolve coordinates from worldData
        if (!this.worldData) await this.loadWorldData(turnContext);

        // Try anchor first if available (most reliable for coordinates)
        let node = null;
        if (anchorName) {
            node = this.worldData?.nodes?.find(n => String(n.name).toLowerCase().trim() === String(anchorName).toLowerCase().trim());
        }

        // Then try exact match of locationName
        if (!node && locationName) {
            node = this.worldData?.nodes?.find(n => String(n.name).toLowerCase().trim() === String(locationName).toLowerCase().trim());
        }

        // Finally try fuzzy fallback with locationName
        if (!node && locationName && this.worldData?.nodes) {
            node = this.worldData.nodes.find(n =>
                String(locationName).toLowerCase().trim().includes(String(n.name).toLowerCase().trim()) ||
                String(n.name).toLowerCase().trim().includes(String(locationName).toLowerCase().trim())
            );
        }

        if (node) {
            // Try to find the latest underground status for this project
            let undergroundStatus = "Above Ground";
            try {
                const viewResult = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? 
                       AND predicate = 'location_view' 
                       AND source = 'party'
                       AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName, factTurnNumber]
                );
                if (viewResult && viewResult.length > 0) {
                    undergroundStatus = viewResult[0].fact_value;
                }
            } catch {}

            const result = {
                position_model: 'coordinate_v1',
                status: 'ARRIVED',
                type: 'NODE',
                x: node.world_x, 
                y: node.world_y, 
                name: locationName || anchorName, 
                anchor: node.name,
                anchor_node: node.name,
                destination: null,
                movement_distance_km: 0,
                underground_status: undergroundStatus
            };
            // this.tools.logger.log('CurrentLocation', `Success (Resolved): ${result.name}`, 'end');
            return await this.enrichCoordinateState(result);
        }

        // Final fallback: accept a fuzzy anchor only when it still resolves to a real node.
        let fallbackNode = null;
        if (anchorName && this.worldData?.nodes) {
            // The anchor from DB didn't match — try a fuzzy match on it too
            fallbackNode = this.worldData.nodes.find(n =>
                String(anchorName).toLowerCase().trim().includes(String(n.name).toLowerCase().trim()) ||
                String(n.name).toLowerCase().trim().includes(String(anchorName).toLowerCase().trim())
            );
        }

        // An unresolved narrative place has no map position. Do not use (0,0) as
        // a sentinel because it may itself be a valid coordinate in the world.
        if (!fallbackNode) return null;

        const fallback = {
            position_model: 'coordinate_v1',
            status: 'STAYED',
            type: 'NODE',
            x: fallbackNode.world_x,
            y: fallbackNode.world_y,
            name: locationName || anchorName || "Unknown Location",
            anchor: fallbackNode.name,
            anchor_node: fallbackNode.name,
            destination: null,
            movement_distance_km: 0,
            underground_status: "Above Ground"
        };
        // this.tools.logger.log('CurrentLocation', `Success (Fallback): ${fallback.name}`, 'end');
        return await this.enrichCoordinateState(fallback);
    }

    // Story-mentioned locations are prompt-only hints; WLT does not persist route/destination intent here.
    getNumericSetting(key, defaultValue, maxValue = 100) {
        let rawValue = this.settings?.[key];
        if ((rawValue === undefined || rawValue === null || rawValue === '') && typeof this.tools?.settings?.get === 'function') {
            rawValue = this.tools.settings.get(`world_location_tracker.${key}`);
        }

        if (rawValue === undefined || rawValue === null || rawValue === '') return defaultValue;

        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) return defaultValue;
        return Math.max(0, Math.min(maxValue, Math.round(parsed)));
    }

    getStoryMentionedLocationRecentChapterWindow() {
        return this.getNumericSetting('story_mentioned_location_recent_chapters', 6, 24);
    }

    getStoryMentionedLocationLimit() {
        return this.getNumericSetting('story_mentioned_location_limit', 8, 30);
    }

    getPathfindingMaxWildStretchKm() {
        return Math.min(10000, this.configuredDistanceToKm(
            this.getNumericSetting('pathfinding_max_wild_stretch_km', 100, 10000)
        ));
    }

    normalizeLocationMentionText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    normalizedPhraseOccurs(aliasText, normalizedSourceText) {
        if (!aliasText || !normalizedSourceText) return false;
        return ` ${normalizedSourceText} `.includes(` ${aliasText} `);
    }

    buildLocationMentionAliases(node) {
        const aliases = [];
        const pushAlias = (value) => {
            if (Array.isArray(value)) {
                value.forEach(pushAlias);
                return;
            }
            if (value === undefined || value === null) return;
            if (typeof value !== 'string' && typeof value !== 'number') return;

            const raw = String(value).trim();
            if (!raw) return;

            raw.split(/[,\n;|]+/).map(part => part.trim()).filter(Boolean).forEach((candidate) => {
                aliases.push(candidate);
            });
        };

        pushAlias(node?.name);
        pushAlias(node?.displayName);
        pushAlias(node?.display_name);
        pushAlias(node?.label);
        pushAlias(node?.alias);
        pushAlias(node?.aliases);
        pushAlias(node?.altName);
        pushAlias(node?.alt_name);
        pushAlias(node?.altNames);
        pushAlias(node?.alt_names);
        pushAlias(node?.alternateName);
        pushAlias(node?.alternate_name);
        pushAlias(node?.alternateNames);
        pushAlias(node?.alternate_names);
        pushAlias(node?.shortName);
        pushAlias(node?.short_name);
        pushAlias(node?.commonName);
        pushAlias(node?.common_name);
        pushAlias(node?.commonNames);
        pushAlias(node?.common_names);

        const seen = new Set();
        return aliases.map((raw) => ({
            raw,
            normalized: this.normalizeLocationMentionText(raw)
        })).filter((alias) => {
            if (!alias.normalized) return false;
            if (!alias.normalized.includes(' ') && alias.normalized.length < 4) return false;
            if (seen.has(alias.normalized)) return false;
            seen.add(alias.normalized);
            return true;
        });
    }

    getLocationPromptExclusionKeys(coords, promptLocationName = null) {
        const keys = new Set();
        [
            coords?.name,
            coords?.anchor,
            promptLocationName || this.getPromptLocationName(coords || {})
        ].forEach((value) => {
            const normalized = this.normalizeLocationMentionText(value);
            if (normalized) keys.add(normalized);
        });
        return keys;
    }

    buildPromptLocationEntry(coords, node, promptLocationName = null) {
        const originName = promptLocationName || this.getPromptLocationName(coords || {});
        const travel = this.calculateTravel({ x: coords.x, y: coords.y, name: originName }, node);
        return {
            node,
            name: node.name,
            dist: travel.distanceKm,
            days: travel.days,
            timeText: travel.narrativeText,
            areaTrail: this.getAreaTrailForNode(node),
            isCapital: node.type === 'Capital' || node.region === 'Capital' || (node.tags || "").toLowerCase().includes('capital'),
            direction: this.getCardinalDirection({ x: coords.x, y: coords.y }, node)
        };
    }

    async collectStoryMentionLocationTextSources(turnContext) {
        const sources = [];
        const addSource = (label, text, priority, turnNumber = null) => {
            const safeText = String(text || '').trim();
            if (!safeText || safeText === 'Empty.') return;
            sources.push({
                label,
                text: safeText,
                priority,
                turnNumber: Number.isFinite(Number(turnNumber)) ? Number(turnNumber) : null
            });
        };

        addSource(
            'current user prompt',
            turnContext?.input?.userPrompt || turnContext?.input?.prompt || turnContext?.input?.user_prompt || turnContext?.userPrompt,
            0,
            turnContext?.turnNumber
        );

        const recentChapterWindow = this.getStoryMentionedLocationRecentChapterWindow();
        if (recentChapterWindow > 0 && typeof turnContext?.getPreviousChapter === 'function') {
            let cursor = turnContext;
            const seenChapters = new Set();
            const seenTurnNumbers = new Set();

            for (let index = 0; index < recentChapterWindow; index += 1) {
                if (typeof cursor?.getPreviousChapter !== 'function') break;

                let chapter = null;
                try {
                    chapter = await cursor.getPreviousChapter();
                } catch (error) {
                    this.tools?.logger?.warn?.('WorldLocationTracker', `Failed to read previous chapter for story-mentioned locations: ${error.message}`);
                    break;
                }

                if (!chapter || seenChapters.has(chapter)) break;
                seenChapters.add(chapter);

                const chapterTurn = Number.isFinite(Number(chapter.turnNumber)) ? Number(chapter.turnNumber) : null;
                if (chapterTurn !== null) {
                    if (seenTurnNumbers.has(chapterTurn)) break;
                    seenTurnNumbers.add(chapterTurn);
                }

                addSource(
                    'recent user prompt',
                    chapter?.input?.userPrompt || chapter?.input?.prompt || chapter?.input?.user_prompt || chapter?.userPrompt,
                    20 + index,
                    chapterTurn
                );
                addSource(
                    'recent narrative',
                    chapter?.output?.fulltext || chapter?.output?.fullText || chapter?.output?.text,
                    40 + index,
                    chapterTurn
                );

                cursor = chapter;
            }
        }

        if (typeof this.tools?.facts?.getFormattedLedger === 'function') {
            const projectName = this.getEffectiveProjectName(turnContext);
            const turnNumber = Number.isFinite(Number(turnContext?.turnNumber ?? this.tools?.turnContext?.turnNumber))
                ? Number(turnContext?.turnNumber ?? this.tools?.turnContext?.turnNumber)
                : null;

            try {
                const directorLedger = await this.tools.facts.getFormattedLedger('director', projectName, turnNumber);
                addSource('director ledger', directorLedger, 10, turnNumber);
            } catch (error) {
                this.tools?.logger?.warn?.('WorldLocationTracker', `Failed to read director ledger for story-mentioned locations: ${error.message}`);
            }

            const hasGrandStoryPlanner = typeof this.tools?.plugins?.isInstalled === 'function'
                ? this.tools.plugins.isInstalled('grand_story_planner')
                : false;
            if (hasGrandStoryPlanner) {
                try {
                    const plannerLedger = await this.tools.facts.getFormattedLedger('grand_story_planner', projectName, turnNumber);
                    addSource('grand story planner ledger', plannerLedger, 11, turnNumber);
                } catch (error) {
                    this.tools?.logger?.warn?.('WorldLocationTracker', `Failed to read grand story planner ledger for story-mentioned locations: ${error.message}`);
                }
            }
        }

        return sources;
    }

    async getStoryMentionedLocationsForPrompt(turnContext, coords) {
        const limit = this.getStoryMentionedLocationLimit();
        if (limit <= 0 || !coords || !Array.isArray(this.worldData?.nodes) || this.worldData.nodes.length === 0) {
            return [];
        }

        const sources = await this.collectStoryMentionLocationTextSources(turnContext);
        const normalizedSources = sources.map((source) => ({
            ...source,
            normalizedText: this.normalizeLocationMentionText(source.text)
        })).filter(source => source.normalizedText);
        if (normalizedSources.length === 0) return [];

        const promptLocationName = this.getPromptLocationName(coords);
        const exclusionKeys = this.getLocationPromptExclusionKeys(coords, promptLocationName);
        const hits = new Map();

        for (const node of this.worldData.nodes) {
            const nodeKey = this.normalizeLocationMentionText(node?.name);
            if (!nodeKey || exclusionKeys.has(nodeKey)) continue;

            const aliases = this.buildLocationMentionAliases(node);
            if (aliases.length === 0) continue;

            for (const source of normalizedSources) {
                const matched = aliases.some(alias => this.normalizedPhraseOccurs(alias.normalized, source.normalizedText));
                if (!matched) continue;

                if (!hits.has(nodeKey)) {
                    hits.set(nodeKey, {
                        entry: this.buildPromptLocationEntry(coords, node, promptLocationName),
                        sourceLabels: [],
                        sourceLabelSet: new Set(),
                        bestPriority: source.priority,
                        latestTurnNumber: source.turnNumber
                    });
                }

                const hit = hits.get(nodeKey);
                hit.bestPriority = Math.min(hit.bestPriority, source.priority);
                if (source.turnNumber !== null) {
                    hit.latestTurnNumber = hit.latestTurnNumber === null
                        ? source.turnNumber
                        : Math.max(hit.latestTurnNumber, source.turnNumber);
                }
                if (!hit.sourceLabelSet.has(source.label)) {
                    hit.sourceLabelSet.add(source.label);
                    hit.sourceLabels.push(source.label);
                }
            }
        }

        return Array.from(hits.values())
            .sort((left, right) => {
                if (left.bestPriority !== right.bestPriority) return left.bestPriority - right.bestPriority;
                const leftTurn = left.latestTurnNumber ?? -1;
                const rightTurn = right.latestTurnNumber ?? -1;
                if (leftTurn !== rightTurn) return rightTurn - leftTurn;
                if (left.entry.dist !== right.entry.dist) return left.entry.dist - right.entry.dist;
                return String(left.entry.name).localeCompare(String(right.entry.name));
            })
            .slice(0, limit)
            .map((hit) => ({
                ...hit.entry,
                mentionedSources: hit.sourceLabels,
                mentionedSourceSummary: hit.sourceLabels.slice(0, 3).join(', ')
            }));
    }

    getNearbyLocations(coords, options = {}) {
        if (!coords) {
            return "";
        }
        if (!this.worldData || !this.worldData.nodes) {
            return "No world data loaded.";
        }

        const nodes = this.worldData.nodes;
        const promptLocationName = this.getPromptLocationName(coords);
        const exclusionKeys = this.getLocationPromptExclusionKeys(coords, promptLocationName);

        // Calculate travel info for all nodes
        const allLocations = nodes
            .map(node => this.buildPromptLocationEntry(coords, node, promptLocationName))
            .filter(loc => !exclusionKeys.has(this.normalizeLocationMentionText(loc.name))); // Don't show current location or anchor

        // Sort by distance
        allLocations.sort((a, b) => a.dist - b.dist);

        // Take closest 10 so the Writer has a useful local spatial palette.
        const closest = allLocations.slice(0, 10);

        // Always include major anchors if they are not already in the closest list.
        const majorAnchors = allLocations.filter(loc => loc.isCapital && !closest.find(c => c.name === loc.name));

        const closestKeys = new Set(closest.map(loc => this.normalizeLocationMentionText(loc.name)));
        const storyMentionedKeys = new Set();
        const storyMentionedLocations = (Array.isArray(options.storyMentionedLocations) ? options.storyMentionedLocations : [])
            .filter((loc) => {
                const key = this.normalizeLocationMentionText(loc?.name);
                if (!key || exclusionKeys.has(key) || closestKeys.has(key) || storyMentionedKeys.has(key)) return false;
                storyMentionedKeys.add(key);
                return true;
            });

        const formatLoc = (loc) => {
            const mentionSummary = loc.mentionedSourceSummary
                || (Array.isArray(loc.mentionedSources) ? loc.mentionedSources.slice(0, 3).join(', ') : '');
            const mentionSuffix = mentionSummary ? ` [mentioned: ${mentionSummary}]` : '';
            return `-> ${loc.name} [${loc.areaTrail}] (${this.formatDistance(loc.dist)} ${loc.direction}, ${loc.timeText})${mentionSuffix}`;
        };

        let output = "[TRAVEL LOGIC]: The party is currently in " + promptLocationName + ".\n";
        const currentAreaTrail = this.getAreaTrail(coords);
        if (currentAreaTrail) {
            output += "Current mapped area: " + currentAreaTrail + ".\n";
        }
        output += "Closest locations:\n" + closest.map(formatLoc).join('\n');

        if (storyMentionedLocations.length > 0) {
            output += "\nStory-Mentioned Mapped Locations:\n" + storyMentionedLocations.map(formatLoc).join('\n');
        }

        if (majorAnchors.length > 0) {
            output += "\nMajor World Anchors:\n" + majorAnchors.map(formatLoc).join('\n');
        }

        output += "\n\nIf you wish to move them to another location do not have them arrive instantly. Describe the passage of time, camping by the road, and the changing landscape. You can even have entire scenes happening somewhere along the journey.";

        return output;
    }

    async buildLocationPromptText(turnContext, coords, options = {}) {
        const operationalStatus = await this.getOperationalStatus(turnContext);
        if (!operationalStatus.active) return '';

        const x = this.toNumeric(coords?.x ?? coords?.world_x, 0);
        const y = this.toNumeric(coords?.y ?? coords?.world_y, 0);
        const location = this.enrichCoordinatesWithAreas({
            x,
            y,
            name: coords?.name || '',
            anchor: coords?.anchor || null,
            underground_status: coords?.underground_status || coords?.view || 'Above Ground'
        });
        const storyMentionedLocations = await this.getStoryMentionedLocationsForPrompt(turnContext, location);
        const nearbyNodes = this.getNearbyLocations(location, { storyMentionedLocations }) || "";
        const underground = location.underground_status || "Above Ground";
        const promptLocationName = this.getPromptLocationName(location);
        const anchorName = String(location.anchor || '').trim();
        const normalizedAnchor = anchorName.toLowerCase();
        const normalizedPromptName = promptLocationName.toLowerCase();
        const hasDistinctAnchor = anchorName
            && normalizedPromptName !== normalizedAnchor
            && normalizedPromptName !== `near ${normalizedAnchor}`;
        const displayLocation = hasDistinctAnchor
            ? `${promptLocationName} (${anchorName})`
            : promptLocationName;

        let locationInjectedText = `Location: ${displayLocation}\nView: ${underground}`;
        if (nearbyNodes) {
            locationInjectedText += `\n${nearbyNodes}`;
        }

        const includeCharacters = options.includeCharacters !== false;
        if (includeCharacters && this.tools.plugins.isInstalled('character_sheets')) {
            const relevantLimit = options.relevantLimit || 15;
            const charLocSynth = await this.getCharacterLocationsSynthesis(turnContext, this.tools, relevantLimit, location);
            if (charLocSynth) {
                locationInjectedText += `\n\n${charLocSynth}`;
            }
        }

        return locationInjectedText;
    }

    getGUILocationText(coords) {
        if (!coords) return `<div class="no-data">Adventure not yet started.</div>`;
        if (!this.worldData || !this.worldData.nodes) return "";

        const nodes = this.worldData.nodes;
        const allLocations = nodes.map(node => {
            const travel = this.calculateTravel({ world_x: coords.x, world_y: coords.y }, node);
            return {
                name: node.name,
                dist: travel.distanceKm,
                timeText: travel.narrativeText,
                isCapital: node.type === 'Capital' || node.region === 'Capital' || (node.tags || "").toLowerCase().includes('capital')
            };
        }).filter(loc => loc.name.toLowerCase() !== coords.name.toLowerCase() && loc.name.toLowerCase() !== (coords.anchor || "").toLowerCase());

        allLocations.sort((a, b) => a.dist - b.dist);
        const closest = allLocations.slice(0, 3);

        let output = `<div class="current-loc-header">📍 <b>Current:</b> ${coords.name}</div>`;
        if (coords.anchor && coords.anchor !== coords.name) {
            output += `<div class="anchor-subtext">Part of ${coords.anchor}</div>`;
        }
        if (Array.isArray(coords.area_hierarchy) && coords.area_hierarchy.length > 0) {
            output += `<div class="anchor-subtext">Area: ${coords.area_hierarchy.join(' / ')}</div>`;
        }

        output += `<div class="nearby-header">🧭 <b>Nearby:</b></div><ul class="nearby-list">`;

        closest.forEach(loc => {
            output += `<li><span class="loc-name">${loc.name}</span> <span class="loc-meta">(${this.formatDistance(loc.dist)}, ${loc.timeText})</span></li>`;
        });

        output += `</ul>`;
        return output;
    }

    async getNearbyCharacters(turnContext, tools, limit = 5) {
        if (!this.worldData || !this.worldData.nodes) {
            return null;
        }

        const coords = await this.getCurrentLocation(turnContext);
        if (!coords) {
            return null;
        }

        const party = new Set((turnContext?.output?.party || []).map(p => p.toLowerCase()));
        const projectName = (turnContext?.projectName || this.tools.turnContext?.projectName || "default").toLowerCase();
        const hasClassifier = this.tools.plugins.isInstalled('character_classifier');

        try {
            // 1. Fetch the latest location for EVERY character in this project
            const rows = await this.tools.db.chat.query(
                `SELECT source, fact_value FROM facts 
                 WHERE project_name = ? AND predicate = 'CHAR_LOCATION'
                 AND id IN (
                    SELECT MAX(id) FROM facts 
                    WHERE project_name = ? AND predicate = 'CHAR_LOCATION'
                    GROUP BY source
                 )`,
                [projectName, projectName]
            );

            if (!rows || rows.length === 0) {
                return null;
            }

            const nearby = [];

            for (const row of rows) {
                const charName = row.source;
                if (party.has(charName.toLowerCase())) continue; // Skip party members
                const importance = await this.resolveCharacterImportance(charName, turnContext);
                if (this.isFilteredImportance(importance)) continue;
                if (hasClassifier && !importance) continue;

                let data;
                try {
                    data = JSON.parse(row.fact_value);
                } catch { continue; }

                if (!data.anchor_node) continue;

                // Find the node coordinates
                const node = this.worldData.nodes.find(n => n.name.toLowerCase() === data.anchor_node.toLowerCase());
                if (!node) continue;

                // Calculate distance
                const travel = this.calculateTravel({ x: coords.x, y: coords.y, name: coords.name }, node);

                nearby.push({
                    name: charName,
                    specific_location: data.specific_location || data.anchor_node,
                    anchor_node: data.anchor_node,
                    context: data.context || "Present in the world.",
                    distanceKm: travel.distanceKm,
                    timeText: travel.narrativeText,
                    direction: this.getCardinalDirection({ x: coords.x, y: coords.y }, node)
                });
            }

            // 2. Sort by distance
            nearby.sort((a, b) => a.distanceKm - b.distanceKm);

            // 3. Take top X
            const sliced = nearby.slice(0, limit);
            if (sliced.length === 0) {
                return null;
            }

            // 4. Format into a summary string
            let summary = `[GEOGRAPHIC DISCOVERY]: Nearby Characters (not in current party):\n`;
            sliced.forEach((char, idx) => {
                const charAnchor = char.anchor_node && char.anchor_node !== char.specific_location 
                    ? ` (${char.anchor_node})`
                    : "";
                const directionSuffix = char.direction ? ` to the ${char.direction}` : ' (same area)';
                summary += `${idx + 1}. ${char.name}: Currently at ${char.specific_location}${charAnchor}. Context: ${char.context} [Distance: ${this.formatDistance(char.distanceKm)}${directionSuffix}, ${char.timeText}]\n`;
            });

            return summary.trim();

        } catch (error) {
            this.tools.logger.error('Logic', `Failed to calculate nearby characters: ${error.message}`);
            return null;
        }
    }

    async getCharacterLocationsSynthesis(turnContext, tools, relevantLimit = 15, coordsOverride = null) {

        if (!this.worldData || !this.worldData.nodes) {
            return null;
        }

        const coords = coordsOverride ? this.enrichCoordinatesWithAreas(coordsOverride) : await this.getCurrentLocation(turnContext);
        if (!coords) {
            return null;
        }

        const allLocations = await this.getAllCharacterLocations(turnContext);
        if (!allLocations || allLocations.length === 0) {
            return null;
        }

        const promptLocationName = this.getPromptLocationName(coords);
        const playerChar = (turnContext?.input?.playerCharacterName || '').toLowerCase();
        const activeParty = new Set((turnContext?.output?.party || []).map(n => n.toLowerCase()));

        // Collect all non-party characters that have resolvable map locations, then sort by distance.
        const distanceRankedChars = [];

        for (const loc of allLocations) {
            const lowName = loc.name.toLowerCase();

            // Skip player and active party members
            if (lowName === playerChar || activeParty.has(lowName)) continue;

            const charAnchor = loc.anchorNode || loc.specificLocation || "";
            const node = this.worldData.nodes.find(n => n.name.toLowerCase() === charAnchor.toLowerCase());
            if (!node) continue;

            const travel = this.calculateTravel({ x: coords.x, y: coords.y, name: promptLocationName }, node);
            distanceRankedChars.push({
                loc,
                distanceKm: travel.distanceKm,
                distanceBand: this.getDistanceBand(travel.distanceKm),
                direction: this.getCardinalDirection({ x: coords.x, y: coords.y }, node)
            });
        }

        distanceRankedChars.sort((a, b) =>
            a.distanceKm - b.distanceKm ||
            a.loc.name.localeCompare(b.loc.name)
        );
        const displayChars = distanceRankedChars.slice(0, relevantLimit);

        if (displayChars.length === 0) {
            return null;
        }

        let summary = `[WORLD TRACKER]: Notable Characters (not in current party):\n`;

        displayChars.forEach(({ loc, distanceKm, distanceBand, direction }) => {
            const charAnchor = loc.anchorNode && loc.anchorNode !== loc.specificLocation 
                ? ` (${loc.anchorNode})`
                : "";
            const distanceText = this.formatDistanceSummary(distanceKm, distanceBand, direction);
            summary += `- ${loc.name}: Currently at ${loc.specificLocation}${charAnchor}. Distance: ${distanceText}. Context: ${loc.context || "Present in the world."}\n`;
        });

        return summary.trim();
    }

    async getAllCharacterLocations(turnContext) {
        if (!this.worldData || !this.worldData.nodes) {
            return [];
        }

        const charIcons = turnContext?.output?.characterIcons || {};
        const playerChar = turnContext?.input?.playerCharacterName;
        const projectName = this.getEffectiveProjectName(turnContext);
        const turnNumber = turnContext.turnNumber || 0;
        const canonicalNameByLower = new Map();
        const rememberCanonicalName = (rawName) => {
            const text = String(rawName || '').trim();
            if (!text) return;
            const lower = text.toLowerCase();
            if (!canonicalNameByLower.has(lower)) canonicalNameByLower.set(lower, text);
        };
        rememberCanonicalName(playerChar);
        (turnContext?.output?.party || []).forEach(rememberCanonicalName);
        Object.keys(charIcons || {}).forEach(rememberCanonicalName);

        const locations = [];

        try {
            // 1. Get current party members' locations from turnContext
            const partyMembers = this.normalizeCharacterList([
                playerChar,
                ...(turnContext?.output?.party || [])
            ]);
            const partyLocations = new Map(); // Map<lowerName, locationInfo>
            const hasClassifier = this.tools.plugins.isInstalled('character_classifier');
            const currentPartyLocation = playerChar ? await this.getCurrentLocation(turnContext) : null;

            for (const rawName of partyMembers) {
                const charName = await this.resolveTravelCharacterName(rawName);
                if (this.isGenericCharacterName(charName)) continue;
                const isPlayer = this.normalizeCharacterKey(charName) === this.normalizeCharacterKey(playerChar);
                const importance = await this.resolveCharacterImportance(charName, turnContext);
                if (this.isFilteredImportance(importance)) {
                    continue;
                }

                const locInfo = isPlayer
                    ? currentPartyLocation
                    : (await this.getCharacterLocation(charName, turnNumber, turnContext) || currentPartyLocation);

                if (locInfo) {
                    const directX = Number(locInfo.x);
                    const directY = Number(locInfo.y);
                    const hasDirectCoords = Number.isFinite(directX) && Number.isFinite(directY);
                    let resolvedX = null;
                    let resolvedY = null;
                    let resolvedAnchor = locInfo.anchor_node || '';

                    if (hasDirectCoords) {
                        resolvedX = directX;
                        resolvedY = directY;
                    } else if (locInfo.anchor_node) {
                        const node = this.worldData.nodes.find(n =>
                            n.name.toLowerCase() === locInfo.anchor_node.toLowerCase()
                        );
                        if (node) {
                            resolvedX = Number(node.world_x);
                            resolvedY = Number(node.world_y);
                            resolvedAnchor = node.name;
                        }
                    }

                    if (Number.isFinite(resolvedX) && Number.isFinite(resolvedY)) {
                        const lowerName = charName.toLowerCase();
                        partyLocations.set(lowerName, {
                            name: charName,
                            importance: String(importance || '').toLowerCase(),
                            isPartyMember: true,
                            isPlayer,
                            iconPath: charIcons[charName] || charIcons[lowerName] || '',
                            x: resolvedX,
                            y: resolvedY,
                            specificLocation: locInfo.specific_location || locInfo.name || resolvedAnchor || 'Unknown',
                            anchorNode: resolvedAnchor || locInfo.anchor || null,
                            context: locInfo.context || (isPlayer ? 'Current party position.' : 'With the party.')
                        });
                    }
                }
            }

            // 2. Query database for LATEST location facts for all characters (not just party members)
            const rows = await this.tools.db.chat.query(
                `SELECT source as char_name, fact_value as location_data
                 FROM facts
                 WHERE project_name = ? AND predicate = 'CHAR_LOCATION' AND turn_number <= ?
                 AND id IN (
                    SELECT MAX(id) FROM facts 
                    WHERE project_name = ? AND predicate = 'CHAR_LOCATION' AND turn_number <= ?
                    GROUP BY source
                 )`,
                [projectName, turnNumber, projectName, turnNumber]
            );

            if (!rows || rows.length === 0) {
                return await this.attachCoreMapSprites(turnContext, Array.from(partyLocations.values()));
            }

            // 3. Process DB characters (skip those already in party)
            for (const row of rows) {
                const charName = row.char_name;
                const lowerName = charName.toLowerCase();
                if (playerChar && lowerName === playerChar.toLowerCase()) continue;
                // Skip if already in party
                if (partyLocations.has(lowerName)) continue;
                const importance = await this.resolveCharacterImportance(charName, turnContext);
                if (this.isFilteredImportance(importance)) continue;
                if (hasClassifier && !importance) continue;

                let locData;
                try {
                    locData = typeof row.location_data === 'string' ? JSON.parse(row.location_data) : row.location_data;
                } catch {
                    continue; // Skip invalid location data
                }

                if (!locData.anchor_node) continue;

                // Resolve to world coordinates
                const node = this.worldData.nodes.find(n =>
                    n.name.toLowerCase() === locData.anchor_node.toLowerCase()
                );

                if (node) {
                    locations.push({
                        name: canonicalNameByLower.get(lowerName) || charName,
                        importance: String(importance || '').toLowerCase(),
                        iconPath: charIcons[canonicalNameByLower.get(lowerName) || ''] || charIcons[charName] || charIcons[charName.toLowerCase()] || '',
                        x: node.world_x,
                        y: node.world_y,
                        specificLocation: locData.specific_location || locData.anchor_node,
                        anchorNode: locData.anchor_node,
                        context: locData.context || "No context provided."
                    });
                }
            }

            // 4. Add party locations
            for (const loc of partyLocations.values()) {
                locations.push(loc);
            }

            return await this.attachCoreMapSprites(turnContext, locations);
        } catch (error) {
            this.tools.logger.error('Logic', `Failed to fetch all character locations: ${error.message}`);
            return [];
        }
    }

    async attachCoreMapSprites(turnContext, locations) {
        const source = Array.isArray(locations) ? locations : [];
        const coreNames = source
            .filter(location => location?.isPartyMember === true || String(location?.importance || '').toLowerCase() === 'core')
            .map(location => location.name)
            .filter(Boolean);
        if (coreNames.length === 0) return source;

        const sprites = await this.resolveTravelPartySprites(turnContext, coreNames, {
            allowCatalogFallback: false,
            maxSprites: Math.min(24, coreNames.length)
        });
        const spritesByName = new Map(
            sprites
                .filter(entry => entry?.spritePath)
                .map(entry => [this.normalizeCharacterKey(entry.name), entry.spritePath])
        );

        return source.map((location) => {
            const usesPartySprite = location?.isPartyMember === true
                || String(location?.importance || '').toLowerCase() === 'core';
            if (!usesPartySprite) return location;
            return {
                ...location,
                isCore: true,
                spritePath: spritesByName.get(this.normalizeCharacterKey(location.name)) || ''
            };
        });
    }

    getWorldMapSummary(options = {}) {
        const nodeLimit = Number.isFinite(Number(options.nodeLimit)) ? Math.max(0, Number(options.nodeLimit)) : 250;
        const areaLimit = Number.isFinite(Number(options.areaLimit)) ? Math.max(0, Number(options.areaLimit)) : 120;
        const nodes = Array.isArray(this.worldData?.nodes) ? this.worldData.nodes : [];
        const areas = Array.isArray(this.worldData?.areas) ? this.worldData.areas : [];

        return {
            nodes: nodes.slice(0, nodeLimit).map(node => ({
                uid: node.uid || '',
                name: node.name || '',
                type: node.type || '',
                region: node.region || '',
                parent_nation: node.parent_nation || '',
                tags: node.tags || '',
                description: node.description || '',
                x: Number(node.world_x ?? node.x ?? 0),
                y: Number(node.world_y ?? node.y ?? 0)
            })),
            areas: areas.slice(0, areaLimit).map(area => ({
                uid: area.uid || '',
                name: area.name || '',
                kind: area.kind || '',
                parent_uid: area.parent_uid || null,
                tags: area.tags || '',
                description: area.description || ''
            }))
        };
    }

    async upsertCharacterLocation(turnContext, update = {}, options = {}) {
        const charName = String(update.name || update.character || '').trim();
        if (!charName) return { saved: false, reason: 'missing_character' };

        await this.loadWorldData(turnContext, { skipTiling: true });
        const operationalStatus = this.getLoadedOperationalStatus();
        if (!operationalStatus.active) return { saved: false, reason: 'tracker_inactive' };
        const nodes = Array.isArray(this.worldData?.nodes) ? this.worldData.nodes : [];
        const anchorInput = String(update.anchor_node || update.anchorNode || update.anchor || '').trim();
        const node = nodes.find(n => String(n.name || '').toLowerCase() === anchorInput.toLowerCase());
        if (!node) return { saved: false, reason: 'unknown_anchor' };

        const turnNumber = Number.isInteger(Number(options.turnNumber))
            ? Number(options.turnNumber)
            : (turnContext?.turnNumber || this.tools.turnContext?.turnNumber || 0);
        const specificLocation = String(update.specific_location || update.specificLocation || node.name || '').trim() || node.name;
        const contextText = String(update.context || update.activity || 'Living their life.').trim() || 'Living their life.';
        const factValue = JSON.stringify({
            specific_location: specificLocation,
            anchor_node: node.name,
            context: contextText
        });
        const fullText = `${specificLocation}, ${contextText}`;

        await this.tools.facts.appendToFactsDb({
            source: charName.toLowerCase(),
            target: 'self',
            predicate: 'CHAR_LOCATION',
            fact_value: factValue,
            context: options.context || 'world_simulator'
        }, { turn_number: turnNumber });

        await this.tools.facts.appendToFactsDb({
            source: charName.toLowerCase(),
            target: 'self',
            predicate: 'CHAR_SHEET:CURRENT_CONTEXT',
            fact_value: fullText,
            context: options.context || 'world_simulator'
        }, { turn_number: turnNumber });

        return {
            saved: true,
            name: charName,
            anchor_node: node.name,
            specific_location: specificLocation,
            context: contextText
        };
    }

    isTravelAnimationEnabled() {
        return this.settings.travel_animation_enabled !== false;
    }

    getTravelMinDistanceKm() {
        const value = Number(this.settings.travel_min_distance_km);
        if (!Number.isFinite(value) || value < 0) return this.configuredDistanceToKm(25);
        return this.configuredDistanceToKm(value);
    }

    getTravelMaxPartySprites() {
        const value = Number(this.settings.travel_max_party_sprites);
        if (!Number.isFinite(value) || value < 1) return 5;
        return Math.min(12, Math.max(1, Math.round(value)));
    }

    getTravelArrivalHoldMs() {
        const value = Number(this.settings.travel_arrival_hold_ms);
        if (!Number.isFinite(value) || value < 0) return 1200;
        return Math.min(30000, Math.max(0, Math.round(value)));
    }

    normalizeCharacterKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    isGenericCharacterName(name) {
        const normalized = this.normalizeCharacterKey(name);
        if (!normalized) return true;
        if (normalized === 'npc') return true;
        if (normalized.startsWith('generic')) return true;
        if (normalized.startsWith('generic_npc')) return true;
        if (normalized.includes('generic_npc')) return true;
        if (normalized.includes('background_character')) return true;
        if (normalized.includes('townsfolk')) return true;
        if (normalized.includes('crowd')) return true;
        if (normalized.includes('villager')) return true;
        if (normalized.includes('guard')) return true;
        if (normalized.includes('merchant')) return true;
        if (normalized.includes('citizen')) return true;
        return false;
    }

    isGenericSpritePath(spritePath) {
        const lower = String(spritePath || '').replace(/\\/g, '/').toLowerCase();
        if (!lower) return true;
        return /(^|[\/_-])generic([\/_-]|$)/.test(lower)
            || /(^|[\/_-])generic[_-]?npc([\/_-]|$)/.test(lower)
            || /(^|[\/_-])npc([\/_-]|$)/.test(lower)
            || /(^|[\/_-])(villager|townsfolk|citizen|crowd|guard|merchant)([\/_-]|$)/.test(lower)
            || lower.includes('background_character');
    }

    resolveCatalogCharacterKey(rawCharacterName, spriteCatalog) {
        const normalized = this.normalizeCharacterKey(rawCharacterName);
        if (!normalized || !spriteCatalog || !spriteCatalog.characters) return null;
        if (spriteCatalog.characters[normalized]) return normalized;

        const aliasMap = spriteCatalog.lookups?.byAlias || {};
        const compactKey = normalized.replace(/_/g, '');
        for (const candidate of [normalized, compactKey]) {
            const hits = Array.isArray(aliasMap[candidate]) ? aliasMap[candidate] : [];
            if (hits.length > 0) return hits[0];
        }

        const firstNameMap = spriteCatalog.lookups?.byFirstName || {};
        const firstName = normalized.split('_')[0];
        const firstHits = Array.isArray(firstNameMap[firstName]) ? firstNameMap[firstName] : [];
        if (firstHits.length > 0) return firstHits[0];

        const allCharacterKeys = Object.keys(spriteCatalog.characters);
        const fuzzy = allCharacterKeys.find((key) => key.includes(normalized) || normalized.includes(key));
        return fuzzy || null;
    }

    scoreTravelSpritePath(spritePath) {
        const lower = String(spritePath || '').toLowerCase();
        if (!lower) return -99999;
        if (this.isGenericSpritePath(spritePath)) return -99999;
        if (lower.endsWith('_icon.png') || lower.endsWith('_icon.webp') || lower.includes('_icon.')) return -5000;
        if (lower.endsWith('_reference.png') || lower.endsWith('_reference.webp') || lower.includes('_reference.')) return -5000;
        if (lower.includes('_talk_blink')) return -2500;
        if (lower.includes('_talk') || lower.includes('_blink')) return -1500;

        let score = 0;
        if (lower.includes('_neutral')) score += 200;
        if (lower.includes('_front')) score += 150;
        if (lower.includes('_default')) score += 50;
        if (lower.includes('_left') || lower.includes('_right') || lower.includes('_back')) score -= 500;
        return score;
    }

    selectBestTravelSpritePath(characterState) {
        if (!characterState || typeof characterState !== 'object') return null;
        const defaultVariantKey = characterState.defaultVariant || 'default';
        const variantState = characterState.variantData?.[defaultVariantKey] || null;

        const pool = [
            ...(Array.isArray(variantState?.neutralSprites) ? variantState.neutralSprites : []),
            ...(Array.isArray(variantState?.baseSprites) ? variantState.baseSprites : []),
            ...(Array.isArray(characterState.neutralSprites) ? characterState.neutralSprites : []),
            ...(Array.isArray(characterState.baseSprites) ? characterState.baseSprites : []),
            ...(Array.isArray(variantState?.files) ? variantState.files : []),
            ...(Array.isArray(characterState.files) ? characterState.files : [])
        ]
            .map((item) => String(item || '').trim())
            .filter(Boolean);

        if (pool.length === 0) return null;

        const deduped = Array.from(new Set(pool));
        deduped.sort((left, right) => this.scoreTravelSpritePath(right) - this.scoreTravelSpritePath(left));
        const best = deduped.find((item) => this.scoreTravelSpritePath(item) > -4000);
        return best || null;
    }

    normalizeTravelSpritePath(spritePath, turnContext) {
        if (!spritePath) return '';
        let clean = String(spritePath).trim().replace(/\\/g, '/');
        if (!clean) return '';
        if (/^(https?:|data:|blob:|plugin:\/\/|project:\/\/)/i.test(clean)) return clean;

        const root = turnContext?.runtime?.rootDirectory
            || turnContext?.rootDirectory
            || this.tools.turnContext?.runtime?.rootDirectory
            || this.tools.turnContext?.rootDirectory
            || null;
        if (path.isAbsolute(clean) && root) {
            const rel = relativizeAssetPath(clean, root, true);
            clean = String(rel || clean).replace(/\\/g, '/');
        }

        clean = clean.replace(/^\/+/, '');
        if (clean.startsWith('assets/') || clean.startsWith('plugins/')) return clean;
        if (clean.startsWith('sprites/')) return `assets/${clean}`;
        return clean;
    }

    async resolveTravelCharacterName(rawName) {
        const name = String(rawName || '').trim();
        if (!name || !this.tools.plugins.isInstalled('character_sheets')) return name;
        try {
            const resolved = await this.tools.plugins.call('character_sheets', 'resolveName', name);
            return String(resolved || name).trim() || name;
        } catch (error) {
            this.tools.logger.warn('TravelTakeover', `Character name resolution failed for ${name}: ${error.message}`);
            return name;
        }
    }

    extractSpritePathValue(entry) {
        if (!entry) return '';
        if (typeof entry === 'string') return entry.trim();
        if (typeof entry === 'object') {
            return String(entry.path || entry.src || entry.image || entry.file || entry.assetPath || '').trim();
        }
        return '';
    }

    collectCharacterSpritePathsFromSequence(turnContext, characterName) {
        const sequence = Array.isArray(turnContext?.output?.sequence)
            ? turnContext.output.sequence
            : [];
        const characterKey = this.normalizeCharacterKey(characterName);
        if (!characterKey || sequence.length === 0) return [];

        const out = [];
        const seen = new Set();
        const addPath = (pathValue) => {
            const normalized = this.normalizeTravelSpritePath(pathValue, turnContext);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            out.push(normalized);
        };

        for (const line of sequence) {
            const lineCharKey = this.normalizeCharacterKey(line?.character);
            const directLineMatch = lineCharKey && lineCharKey === characterKey;
            if (directLineMatch) addPath(line?.image);

            const sprites = line?.sprites;
            if (Array.isArray(sprites)) {
                for (const entry of sprites) {
                    const spriteCharKey = this.normalizeCharacterKey(entry?.character || line?.character);
                    if (spriteCharKey && spriteCharKey !== characterKey) continue;
                    addPath(this.extractSpritePathValue(entry));
                }
            } else if (sprites && typeof sprites === 'object') {
                for (const entry of Object.values(sprites)) {
                    const spriteCharKey = this.normalizeCharacterKey(entry?.character || line?.character);
                    if (spriteCharKey && spriteCharKey !== characterKey) continue;
                    addPath(this.extractSpritePathValue(entry));
                }
            }
        }

        return out;
    }

    worldToImageCoordinates(x, y) {
        const worldX = Number(x);
        const worldY = Number(y);
        return {
            x: Number.isFinite(worldX) ? worldX : 0,
            y: Number.isFinite(worldY) ? -worldY : 0
        };
    }

    sanitizeWaypointLabel(value, fallback = 'Unknown Location') {
        const label = String(value || '').trim();
        if (!label) return fallback;
        return label;
    }

    buildWaypointFromState(state, fallbackLine = 0) {
        if (!state) return null;
        const x = Number(state.x);
        const y = Number(state.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const inferredStatus = (() => {
            const raw = String(state.status || '').toUpperCase().trim();
            if (raw === 'TRANSIT' || raw === 'ARRIVED' || raw === 'STAYED') return raw;
            if (String(state.type || '').toUpperCase() === 'TRANSIT' || (state.origin && state.destination)) return 'TRANSIT';
            return 'ARRIVED';
        })();
        const transitDestination = inferredStatus === 'TRANSIT'
            ? (state.destination || state.anchor_node || state.anchor || null)
            : null;
        const waypointName = inferredStatus === 'TRANSIT'
            ? this.sanitizeWaypointLabel(
                state.specific_location || state.name || (transitDestination ? `On the road to ${transitDestination}` : null),
                'On the road'
            )
            : this.sanitizeWaypointLabel(state.specific_location || state.name || state.anchor || state.anchor_node);
        const anchorName = this.sanitizeWaypointLabel(state.anchor || state.anchor_node || state.origin || state.name);

        const image = this.worldToImageCoordinates(x, y);
        return {
            line: Number.isInteger(state.line) ? state.line : fallbackLine,
            status: inferredStatus,
            name: waypointName,
            anchor: anchorName,
            x,
            y,
            imageX: image.x,
            imageY: image.y,
            undergroundStatus: state.underground_status || 'Above Ground',
            travelParty: this.normalizeCharacterList(state.travel_party),
            destination: inferredStatus === 'TRANSIT'
                ? (transitDestination || state.destination || null)
                : null,
            movementDistanceKm: this.normalizeMovementDistance(state.movement_distance_km)
        };
    }

    async getTravelMapBundle(turnContext) {
        await this.loadWorldData(turnContext, { skipTiling: true });

        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory;
        const projectName = turnContext?.projectName || this.tools.turnContext?.projectName;

        let dimensions = { width: 0, height: 0 };
        if (this.worldData?.meta?.dimensions?.width > 0) {
            dimensions = { ...this.worldData.meta.dimensions };
        } else if (this.mapImage) {
            dimensions = await this.getImageDimensions(this.mapImage);
        }

        let mapImage = null;
        if (this.mapImage) {
            mapImage = this.getProjectStaticPath(this.mapImage, turnContext);
            if (!mapImage && root) {
                mapImage = relativizeAssetPath(this.mapImage, root, true);
                if (path.isAbsolute(mapImage)) {
                    mapImage = path.relative(root, mapImage).replace(/\\/g, '/');
                }
            }
        }

        const isTiled = !!this.tilePath;
        const tileStaticBase = isTiled ? this.getProjectStaticPath(this.tilePath, turnContext) : null;
        const tileTemplate = tileStaticBase
            ? `${tileStaticBase}/{z}/{y}/{x}.png`
            : (isTiled ? this.getProjectTileTemplate(this.tilePath, turnContext) : null);

        return {
            projectName,
            mapImage,
            isTiled,
            tileTemplate,
            dimensions: {
                width: Number(dimensions?.width || 0),
                height: Number(dimensions?.height || 0)
            }
        };
    }

    async resolveTravelPartySprites(turnContext, preferredNames = [], options = {}) {
        const requestedMax = Number(options.maxSprites);
        const maxSprites = Number.isFinite(requestedMax) && requestedMax > 0
            ? Math.min(24, Math.max(1, Math.round(requestedMax)))
            : this.getTravelMaxPartySprites();
        const playerName = await this.resolveTravelCharacterName(turnContext?.input?.playerCharacterName);
        const preferredPartyNames = this.normalizeCharacterList(preferredNames);
        const partyNames = preferredPartyNames.length > 0
            ? preferredPartyNames
            : await this.getTravelPartyCandidateNames(turnContext);
        const spriteCatalog = turnContext?.runtime?.vnManager?.spriteCatalog
            || (this.tools.assets?.getSpriteCatalog ? await this.tools.assets.getSpriteCatalog({ source: 'auto' }) : null);

        const seen = new Set();
        const queue = [];
        for (const rawName of partyNames) {
            const name = await this.resolveTravelCharacterName(rawName);
            if (!name || this.isGenericCharacterName(name)) continue;
            const key = this.normalizeCharacterKey(name);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            queue.push(name);
        }

        const tokenFallbackNames = [];
        const resolved = [];
        for (const name of queue) {
            if (resolved.length >= maxSprites) break;

            const importance = await this.resolveCharacterImportance(name, turnContext);
            if (this.isFilteredImportance(importance)) continue;

            let spritePath = null;
            if (spriteCatalog) {
                const catalogKey = this.resolveCatalogCharacterKey(name, spriteCatalog);
                const characterState = catalogKey ? spriteCatalog.characters?.[catalogKey] : null;
                spritePath = this.selectBestTravelSpritePath(characterState);
            }

            if (!spritePath) {
                const sequencePaths = this.collectCharacterSpritePathsFromSequence(turnContext, name);
                spritePath = this.selectBestTravelSpritePath({
                    files: sequencePaths,
                    baseSprites: sequencePaths,
                    neutralSprites: sequencePaths
                });
            }

            if (!spritePath && this.tools.assets?.findCharacterSprite) {
                try {
                    const fallback = await this.tools.assets.findCharacterSprite(name, 'neutral', { dialogueIndex: 0 });
                    spritePath = fallback?.assetPath || fallback?.image || null;
                } catch (error) {
                    this.tools.logger.warn('TravelTakeover', `Sprite lookup fallback failed for ${name}: ${error.message}`);
                }
            }

            if (!spritePath) {
                tokenFallbackNames.push(name);
                continue;
            }
            if (this.isGenericSpritePath(spritePath)) continue;
            resolved.push({
                name,
                spritePath: this.normalizeTravelSpritePath(spritePath, turnContext),
                isPlayer: playerName && this.normalizeCharacterKey(name) === this.normalizeCharacterKey(playerName)
            });
        }

        // Fallback for debug/demo cases where party resolution yields no sprites:
        // sample from sprite catalog so travel animation still showcases character art.
        if (resolved.length === 0 && options.allowCatalogFallback === true && spriteCatalog?.characters) {
            const catalogKeys = Object.keys(spriteCatalog.characters);
            for (const key of catalogKeys) {
                if (resolved.length >= maxSprites) break;
                if (this.isGenericCharacterName(key)) continue;

                const state = spriteCatalog.characters[key];
                const spritePath = this.selectBestTravelSpritePath(state);
                if (!spritePath || this.isGenericSpritePath(spritePath)) continue;

                const label = String(state?.displayName || state?.name || key)
                    .replace(/_/g, ' ')
                    .trim();

                resolved.push({
                    name: label || key,
                    spritePath: this.normalizeTravelSpritePath(spritePath, turnContext),
                    isPlayer: false
                });
            }

            if (resolved.length > 0) {
                this.tools.logger.runtime(`Travel sprite fallback selected ${resolved.length} catalog sprite(s).`);
            }
        }

        if (resolved.length === 0) {
            const tokenNames = tokenFallbackNames.length > 0 ? tokenFallbackNames : ['Party'];
            return tokenNames.slice(0, maxSprites).map((name) => ({
                name,
                spritePath: null,
                isPlayer: playerName && this.normalizeCharacterKey(name) === this.normalizeCharacterKey(playerName),
                tokenOnly: true
            }));
        }

        return resolved;
    }

    async buildTravelSegments(turnContext) {
        if (!this.isTravelAnimationEnabled()) return [];

        const timeline = await this.getLocationTimelineForTurn(turnContext);
        if (timeline.length === 0) {
            this.tools.logger.runtime('[WorldTravelIntercept] No location timeline available for travel segment build.');
            return [];
        }

        await this.loadWorldData(turnContext, { skipTiling: true });

        const previousChapter = typeof turnContext?.getPreviousChapter === 'function'
            ? await turnContext.getPreviousChapter()
            : null;
        const previousLocation = previousChapter ? await this.getCurrentLocation(previousChapter) : null;
        const previousWaypoint = this.buildWaypointFromState(previousLocation, -1);

        const sortedTimeline = timeline
            .filter((entry) => entry && typeof entry === 'object')
            .sort((left, right) => this.clampLineIndex(left.line, 999999) - this.clampLineIndex(right.line, 999999));

        const waypoints = [];
        if (previousWaypoint) {
            waypoints.push({
                ...previousWaypoint,
                source: 'previous_turn'
            });
        }

        for (const entry of sortedTimeline) {
            const waypoint = this.buildWaypointFromState(entry, this.clampLineIndex(entry.line, 999999));
            if (!waypoint) continue;
            waypoints.push({
                ...waypoint,
                source: 'timeline'
            });
        }

        this.tools.logger.runtime(`[WorldTravelIntercept] Segment build inputs: timeline=${timeline.length}, waypoints=${waypoints.length}, previousWaypoint=${!!previousWaypoint}`);

        if (waypoints.length < 2) return [];

        const minDistanceKm = this.getTravelMinDistanceKm();
        const segments = [];

        for (let index = 0; index < waypoints.length - 1; index += 1) {
            const from = waypoints[index];
            const to = waypoints[index + 1];
            if (!to || !Number.isInteger(to.line) || to.line < 0) continue;

            const dx = Number(to.x) - Number(from.x);
            const dy = Number(to.y) - Number(from.y);
            if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.sqrt((dx * dx) + (dy * dy)) <= 1e-9) continue;

            const fromIsTransit = from.status === 'TRANSIT';
            const toIsTransit = to.status === 'TRANSIT';
            const phase = !fromIsTransit && toIsTransit
                ? 'departure'
                : (fromIsTransit && !toIsTransit ? 'arrival' : (fromIsTransit && toIsTransit ? 'progress' : 'direct'));

            const fromNode = { name: from.name, world_x: from.x, world_y: from.y, tags: '' };
            const toNode = { name: to.name, world_x: to.x, world_y: to.y, tags: '' };
            const legTravel = this.calculateTravel(fromNode, toNode);
            const journeyDistanceKm = Number(legTravel.distanceKm || 0);
            const anchorChanged = this.normalizeCharacterKey(from.anchor) !== this.normalizeCharacterKey(to.anchor);
            const isSignificant = journeyDistanceKm >= minDistanceKm || anchorChanged;
            if (!isSignificant) continue;
            const travelParty = this.normalizeCharacterList(to.travelParty && to.travelParty.length > 0 ? to.travelParty : from.travelParty);

            segments.push({
                index: segments.length,
                line: to.line,
                checkpoint: to.line === 0 ? 'before_first_dialogue' : 'on_dialogue_enter',
                dialogueIndex: to.line === 0 ? null : to.line,
                phase,
                from,
                to,
                journeyFrom: from,
                journeyTo: to,
                via: null,
                startProgress: 0,
                endProgress: 1,
                travelParty,
                travel: {
                    distanceKm: journeyDistanceKm,
                    days: Number.isFinite(Number(legTravel.days)) ? Number(legTravel.days) : null,
                    narrativeText: legTravel.narrativeText || 'A short trip',
                    legDistanceKm: journeyDistanceKm
                }
            });
        }

        return segments;
    }

    async buildTravelInterceptPayloads(turnContext) {
        if (!this.isTravelAnimationEnabled()) {
            this.tools.logger.runtime('[WorldTravelIntercept] Skipped: travel animation disabled.');
            return [];
        }

        const map = await this.getTravelMapBundle(turnContext);
        const width = Number(map?.dimensions?.width || 0);
        const height = Number(map?.dimensions?.height || 0);
        const hasMap = (map?.isTiled && map?.tileTemplate) || !!map?.mapImage;
        if (!hasMap || width <= 0 || height <= 0) {
            this.tools.logger.runtime(`[WorldTravelIntercept] Skipped: invalid map bundle. hasMap=${hasMap}, width=${width}, height=${height}`);
            return [];
        }

        const segments = await this.buildTravelSegments(turnContext);
        if (segments.length === 0) {
            this.tools.logger.runtime('[WorldTravelIntercept] Skipped: no travel segments built.');
            return [];
        }
        this.tools.logger.runtime(`[WorldTravelIntercept] Built ${segments.length} travel segment(s): ${segments.map(segment => `line=${segment.line}, phase=${segment.phase}, from=${segment.from?.name}, to=${segment.to?.name}, journey=${segment.journeyFrom?.name}->${segment.journeyTo?.name}`).join(' | ')}`);

        const arrivalHoldMs = this.getTravelArrivalHoldMs();

        const payloads = [];
        for (const segment of segments) {
            const partySprites = await this.resolveTravelPartySprites(
                turnContext,
                segment.travelParty,
                { allowCatalogFallback: false }
            );

            payloads.push({
                ...segment,
                payload: {
                    seed: `${turnContext.turnNumber || 0}:${segment.line}:${segment.index}`,
                    map: {
                        projectName: map.projectName,
                        isTiled: !!map.isTiled,
                        tileTemplate: map.tileTemplate || null,
                        mapImage: map.mapImage || null,
                        dimensions: map.dimensions
                    },
                    route: {
                        phase: segment.phase || 'direct',
                        from: {
                            label: segment.from.name,
                            anchor: segment.from.anchor,
                            x: segment.from.x,
                            y: segment.from.y,
                            imageX: segment.from.imageX,
                            imageY: segment.from.imageY
                        },
                        to: {
                            label: segment.to.name,
                            anchor: segment.to.anchor,
                            x: segment.to.x,
                            y: segment.to.y,
                            imageX: segment.to.imageX,
                            imageY: segment.to.imageY
                        },
                        journeyFrom: {
                            label: segment.journeyFrom?.name || segment.from.name,
                            anchor: segment.journeyFrom?.anchor || segment.from.anchor,
                            x: segment.journeyFrom?.x ?? segment.from.x,
                            y: segment.journeyFrom?.y ?? segment.from.y,
                            imageX: segment.journeyFrom?.imageX ?? segment.from.imageX,
                            imageY: segment.journeyFrom?.imageY ?? segment.from.imageY
                        },
                        journeyTo: {
                            label: segment.journeyTo?.name || segment.to.name,
                            anchor: segment.journeyTo?.anchor || segment.to.anchor,
                            x: segment.journeyTo?.x ?? segment.to.x,
                            y: segment.journeyTo?.y ?? segment.to.y,
                            imageX: segment.journeyTo?.imageX ?? segment.to.imageX,
                            imageY: segment.journeyTo?.imageY ?? segment.to.imageY
                        },
                        via: segment.via ? {
                            label: segment.via.name,
                            anchor: segment.via.anchor,
                            x: segment.via.x,
                            y: segment.via.y,
                            imageX: segment.via.imageX,
                            imageY: segment.via.imageY,
                            progress: Number.isFinite(Number(segment.endProgress)) ? Number(segment.endProgress) : null
                        } : null,
                        startProgress: Number.isFinite(Number(segment.startProgress)) ? Number(segment.startProgress) : 0,
                        endProgress: Number.isFinite(Number(segment.endProgress)) ? Number(segment.endProgress) : 1,
                        distanceKm: segment.travel.distanceKm,
                        days: segment.travel.days,
                        narrativeText: segment.travel.narrativeText,
                        legDistanceKm: segment.travel.legDistanceKm,
                        travelParty: this.normalizeCharacterList(segment.travelParty)
                    },
                    partySprites,
                    manualCloseDelayMs: arrivalHoldMs,
                    arrivalHoldMs
                }
            });
        }

        return payloads;
    }

    normalizeDialogueIndex(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        return Math.max(0, Math.round(numeric));
    }

    async getLocationTimelineForTurn(turnContext) {
        const sortTimeline = (timeline) => timeline
            .filter((entry) => entry && typeof entry === 'object')
            .sort((left, right) => this.clampLineIndex(left.line, 999999) - this.clampLineIndex(right.line, 999999));

        const projectName = this.getEffectiveProjectName(turnContext);
        const factTurnNumber = this.getFactBaseTurnNumber(turnContext);
        const displayTurnNumber = Number(turnContext?.turnNumber || 0);
        const turnKey = this.getFactTurnKey(turnContext);
        if (projectName && factTurnNumber >= 1) {
            try {
                const turnNumbers = [...new Set([factTurnNumber, displayTurnNumber]
                    .filter(value => Number.isInteger(value) && value >= 1))];
                const placeholders = turnNumbers.map(() => '?').join(',');
                const rows = await this.tools.db.chat.query(
                    `SELECT fact_value FROM facts
                     WHERE project_name = ?
                       AND predicate = 'location_timeline'
                       AND source = 'party'
                       AND (turn_key = ? OR turn_number IN (${placeholders}))
                     ORDER BY
                       CASE
                         WHEN turn_key = ? THEN 0
                         WHEN turn_number = ? THEN 1
                         ELSE 2
                       END,
                       id DESC LIMIT 1`,
                    [projectName, turnKey, ...turnNumbers, turnKey, factTurnNumber]
                );
                if (rows && rows.length > 0) {
                    const parsed = JSON.parse(rows[0].fact_value || '[]');
                    const timeline = Array.isArray(parsed)
                        ? parsed
                        : (Array.isArray(parsed.location_events) ? parsed.location_events : []);
                    const sorted = sortTimeline(timeline);
                    if (sorted.length > 0) return sorted;
                }
            } catch (error) {
                this.tools.logger.warn('Logic', `Failed to resolve location timeline from DB: ${error.message}`);
            }
        }

        const contextTimeline = Array.isArray(turnContext?.output?.locationTimeline)
            ? turnContext.output.locationTimeline
            : null;
        if (contextTimeline && contextTimeline.length > 0) {
            return sortTimeline(contextTimeline);
        }

        const turnStateTimeline = this.tools.pluginState.fromContext(turnContext).turn().locationTimeline;
        if (Array.isArray(turnStateTimeline) && turnStateTimeline.length > 0) {
            return sortTimeline(turnStateTimeline);
        }

        return [];
    }

    getActiveLocationTimelineEntry(timeline, dialogueIndex) {
        if (!Array.isArray(timeline) || timeline.length === 0) return null;
        const normalizedIndex = this.normalizeDialogueIndex(dialogueIndex);
        if (!Number.isInteger(normalizedIndex)) {
            return timeline[timeline.length - 1] || null;
        }

        const eligible = timeline.filter((entry) => this.clampLineIndex(entry.line, 999999) <= normalizedIndex);
        if (eligible.length > 0) return eligible[eligible.length - 1];
        return timeline[0] || null;
    }

    buildNavigationMapTarget(target) {
        if (!target || typeof target !== 'object') return null;
        if (target.map_status === 'map_point' && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y))) {
            return {
                uid: null,
                name: String(target.name || 'Selected map point'),
                map_status: 'map_point',
                x: Number(target.x),
                y: Number(target.y)
            };
        }
        const node = target.uid
            ? (this.worldData?.nodes || []).find(candidate => String(candidate.uid) === String(target.uid))
            : this.findWorldNodeByName(target.name);
        return {
            uid: node?.uid || target.uid || null,
            name: node?.name || String(target.name || 'Unresolved destination'),
            map_status: node ? 'mapped' : (target.map_status || 'unmapped'),
            ...(node ? { x: Number(node.world_x), y: Number(node.world_y) } : {})
        };
    }

    buildNavigationMapPlan(planInput, targetInput, currentLocation, fallbackStatus = 'active') {
        const plan = navigationCopilot.normalizeRoutePlan(planInput);
        const target = this.buildNavigationMapTarget(targetInput || plan?.destination);
        if (!target) return null;
        let corridor = routeGeometry.normalizePoints(plan?.remaining_corridor || plan?.corridor || []);
        let provisional = plan?.status === 'provisional';
        if (['mapped', 'map_point'].includes(target.map_status) && corridor.length < 2 && plan) provisional = true;
        if (!['mapped', 'map_point'].includes(target.map_status)) corridor = [];
        const waypoints = (plan?.waypoints || [])
            .filter(waypoint => waypoint.status === 'pending')
            .map(waypoint => {
                const resolved = this.buildNavigationMapTarget(waypoint);
                return resolved?.map_status === 'mapped'
                    ? { ...resolved, purpose: waypoint.purpose || '', status: waypoint.status }
                    : null;
            })
            .filter(Boolean);
        return {
            target,
            route_id: plan?.selected_route_id || 'direct',
            summary: this.replaceDistanceMentions(plan?.summary || ''),
            status: provisional ? 'provisional' : (plan?.status || fallbackStatus),
            corridor,
            waypoints,
            requirements: (plan?.route_notes || []).map(note => this.replaceDistanceMentions(note)).slice(0, 12)
        };
    }

    buildNavigationMapPayload(rawState, currentLocation) {
        const state = navigationCopilot.normalizeNavigationState(rawState);
        if (!this.isAutoNavigationPlanningEnabled() && !state.manual_order) return null;
        const journeyPlan = state.journey_plan && state.status === 'awaiting_intent' && state.journey_plan.status !== 'suspended'
            ? { ...state.journey_plan, status: 'awaiting' }
            : state.journey_plan;
        const journey = state.journey_target || journeyPlan?.destination
            ? this.buildNavigationMapPlan(journeyPlan, state.journey_target, currentLocation, state.status === 'awaiting_intent' ? 'awaiting' : 'active')
            : null;
        const immediate = state.active_target
            ? this.buildNavigationMapPlan(state.active_leg_plan, state.active_target, currentLocation, 'active')
            : null;
        const manualOrder = state.manual_order ? {
            id: state.manual_order.id,
            source: state.manual_order.source,
            mode: state.manual_order.mode,
            status: state.manual_order.status,
            target: this.buildNavigationMapTarget(state.manual_order.target),
            reason: state.manual_order.reason || '',
            travelers: (state.manual_order.travelers || []).slice(0, 24),
            issued_turn: state.manual_order.issued_turn,
            undo_available: state.manual_order.mode === 'instant'
                && state.manual_order.status === 'completed'
                && !!state.manual_order.rollback?.location,
            route: state.manual_order.route ? {
                title: String(state.manual_order.route.title || ''),
                mode_label: String(state.manual_order.route.mode_label || ''),
                summary: this.replaceDistanceMentions(state.manual_order.route.summary || ''),
                distance_km: Number(state.manual_order.route.distance_km || 0),
                distance_display: this.formatDistance(state.manual_order.route.distance_km || 0),
                duration: String(state.manual_order.route.duration || ''),
                requirements: (state.manual_order.route.requirements || []).map(note => this.replaceDistanceMentions(note)).slice(0, 12),
                stops: (state.manual_order.route.stops || []).slice(0, 12),
                corridor: navigationCopilot.downsampleCorridor(state.manual_order.route.corridor || [])
            } : null
        } : null;
        if (!journey && !immediate && !manualOrder) return null;
        this.logDecision(`Map navigation geometry debug: current=${String(currentLocation?.status || currentLocation?.type || 'unknown')}->${currentLocation?.destination || 'none'}, journey=${journey ? `${journey.route_id}, pts=${journey.corridor?.length || 0}, status=${journey.status}` : 'none'}, immediate=${immediate ? `${immediate.route_id}, pts=${immediate.corridor?.length || 0}, status=${immediate.status}` : 'none'}, manual=${manualOrder?.route ? `pts=${manualOrder.route.corridor?.length || 0}` : 'none'}.`);
        return {
            status: state.status,
            immediate,
            journey,
            manual_order: manualOrder
        };
    }

    async getMapBundle(turnContext, options = {}) {
        const timelinePreview = options.timelinePreview === true;
        if (!this.worldDataLoadAttempted || options.reload === true) {
            await this.loadWorldData(turnContext, { skipTiling: timelinePreview || options.skipTiling === true });
        }
        const operationalStatus = this.getLoadedOperationalStatus();
        if (!operationalStatus.active) {
            return this.buildInactiveMapBundle(turnContext, operationalStatus, options);
        }
        const requestedDialogueIndex = this.normalizeDialogueIndex(options?.dialogueIndex);
        const movementPolicy = timelinePreview
            ? { manual_movement_only: false, controls_enabled: false, read_only: true }
            : await this.getManualMovementPolicy();

        // Check if chat is empty to fulfill "clear GUI" requirement
        let isChatEmpty = false;
        if (!timelinePreview) {
            try {
                const turnCount = await this.tools.turns.count();
                isChatEmpty = !turnCount || turnCount === 0;
            } catch {
                // DB might not be initialized yet
            }
        }

        const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory;
        const projectName = turnContext?.projectName || this.tools.turnContext?.projectName;
        const timeline = await this.getLocationTimelineForTurn(turnContext);
        const fallbackCoords = options.currentLocation || await this.getCurrentLocation(turnContext);
        const activeTimelineEntry = this.getActiveLocationTimelineEntry(timeline, requestedDialogueIndex);
        const timelineResolvedCoords = activeTimelineEntry
            ? this.buildLocationStateFromEvent(activeTimelineEntry, fallbackCoords || null)
            : null;
        const coords = timelineResolvedCoords
            ? this.enrichCoordinatesWithAreas(timelineResolvedCoords)
            : fallbackCoords;
        let navigation = null;
        if (!timelinePreview) {
            let navigationState = options.controlsEnabled === true
                ? await this.getNavigationStateForContext(turnContext, { preferPersisted: true })
                : await this.getNavigationStateForDialogue(turnContext, requestedDialogueIndex);
            navigation = this.buildNavigationMapPayload(navigationState, coords);
            let pendingManualOrder = options.controlsEnabled === true
                ? await this.getPendingManualOrder(turnContext)
                : null;
            if (this.isPendingManualOrderSuperseded(pendingManualOrder, navigationState)
                || this.isPendingManualOrderFulfilledByLocation(pendingManualOrder, coords, turnContext?.turnNumber)) {
                pendingManualOrder = null;
            }
            if (pendingManualOrder) {
                const pendingPayload = {
                    id: pendingManualOrder.id,
                    source: 'user_map',
                    mode: pendingManualOrder.mode,
                    status: 'pending_send',
                    target: this.buildNavigationMapTarget(pendingManualOrder.target),
                    reason: pendingManualOrder.reason || '',
                    travelers: (pendingManualOrder.travelers || []).slice(0, 24),
                    issued_turn: pendingManualOrder.issued_turn,
                    undo_available: false,
                    route: pendingManualOrder.route ? {
                        title: String(pendingManualOrder.route.title || ''),
                        mode_label: String(pendingManualOrder.route.mode_label || ''),
                        summary: String(pendingManualOrder.route.summary || ''),
                        distance_km: Number(pendingManualOrder.route.distance_km || 0),
                        distance_display: this.formatDistance(pendingManualOrder.route.distance_km || 0),
                        duration: String(pendingManualOrder.route.duration || ''),
                        requirements: (pendingManualOrder.route.requirements || []).map(note => this.replaceDistanceMentions(note)).slice(0, 12),
                        stops: (pendingManualOrder.route.stops || []).slice(0, 12),
                        corridor: navigationCopilot.downsampleCorridor(pendingManualOrder.route.corridor || [])
                    } : null
                };
                navigation = navigation || { status: 'idle', immediate: null, journey: null, manual_order: null };
                navigation.manual_order = pendingPayload;
            }
            if (options.controlsEnabled === true && navigation?.manual_order?.status === 'active') {
                turnContext.runtime = turnContext.runtime || {};
                turnContext.runtime.worldLocationTracker = turnContext.runtime.worldLocationTracker || {};
                const runtime = turnContext.runtime.worldLocationTracker;
                const restoreSignature = JSON.stringify([
                    navigation.manual_order.id,
                    navigation.manual_order.status,
                    navigation.journey?.corridor?.length || 0
                ]);
                if (runtime.lastManualMapRestoreSignature !== restoreSignature) {
                    runtime.lastManualMapRestoreSignature = restoreSignature;
                    this.tools.logger.runtime(`[WLT Map Restore] Restored ${navigation.manual_order.mode} order to ${navigation.manual_order.target?.name || 'destination'}; corridor points=${navigation.journey?.corridor?.length || 0}.`);
                }
            }
        }

        let displayPath = this.mapImage;
        let isTiled = false;
        let tileUrl = null;
        let dimensions = { width: 0, height: 0 };

        // 1. Prioritize persisted dimensions from metadata (Compiled Map Architecture)
        if (this.worldData?.meta?.dimensions?.width > 0) {
            dimensions = { ...this.worldData.meta.dimensions };
        } else if (this.mapImage) {
            // 2. Fallback to reading the image file if dimensions are missing
            try {
                const sharp = require('sharp');
                const meta = await sharp(this.mapImage).metadata();
                dimensions.width = meta.width;
                dimensions.height = meta.height;
            } catch (e) {
                this.tools.logger.error('Logic', `Failed to get image metadata: ${e.message}`);
            }
        }

        if (this.tilePath) {
            isTiled = true;
            // Sharp 'google' layout: zoom/y/x.png
            tileUrl = this.getProjectTileTemplate(this.tilePath, turnContext);
        }

        if (this.mapImage) {
            displayPath = relativizeAssetPath(this.mapImage, root, true);
            // If the path is still absolute (meaning it was outside /assets/), 
            // we must relativize it to the project root for the frontend.
            if (path.isAbsolute(displayPath)) {
                displayPath = path.relative(root, displayPath).replace(/\\/g, '/');
            }
        }

        // If chat is empty, we force-clear the map assets from the bundle
        if (isChatEmpty) {
            return {
                worldData: null,
                mapImage: null,
                isTiled: false,
                tileUrl: null,
                dimensions: { width: 0, height: 0 },
                activeDialogueIndex: requestedDialogueIndex,
                locationTimeline: [],
                currentLocation: null,
                navigation: null,
                distanceUnit: this.getDistanceUnitDefinition(),
                movementPolicy: { ...movementPolicy, controls_enabled: false, read_only: true },
                nearbyText: "",
                guiText: `<div class="no-data">Adventure not yet started.</div>`,
                characterLocations: [],
                projectName: projectName
            };
        }

        if (timelinePreview) {
            return {
                pluginActive: true,
                inactiveReason: '',
                worldData: this.worldData,
                mapImage: displayPath,
                isTiled: isTiled,
                tileUrl: tileUrl,
                dimensions: dimensions,
                activeDialogueIndex: requestedDialogueIndex,
                locationTimeline: timeline,
                currentLocation: coords,
                navigation: null,
                distanceUnit: this.getDistanceUnitDefinition(),
                movementPolicy,
                nearbyText: '',
                guiText: '',
                characterLocations: [],
                projectName: projectName,
                turnNumber: Number(turnContext?.turnNumber || 0)
            };
        }

        let characterContext = turnContext;
        if (Number.isInteger(requestedDialogueIndex) && typeof turnContext?.getPreviousChapter === 'function') {
            try {
                const previousChapter = await turnContext.getPreviousChapter();
                if (previousChapter) {
                    characterContext = previousChapter;
                }
            } catch (error) {
                this.tools.logger.warn('Logic', `Failed to resolve previous chapter for spoiler-safe character map: ${error.message}`);
            }
        }

        let characterLocations = await this.getAllCharacterLocations(characterContext);

        // Keep non-party markers spoiler-safe (previous chapter), but always render
        // active party members at live current-turn coordinates for map coherence.
        if (characterContext !== turnContext) {
            const livePartyNames = new Set(
                (Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [])
                    .map(name => this.normalizeCharacterKey(name))
                    .filter(Boolean)
            );

            if (livePartyNames.size > 0) {
                const liveCurrentLocations = await this.getAllCharacterLocations(turnContext);
                const livePartyLocations = liveCurrentLocations.filter(loc =>
                    livePartyNames.has(this.normalizeCharacterKey(loc?.name))
                );

                if (livePartyLocations.length > 0) {
                    const nonPartyLocations = characterLocations.filter(loc =>
                        !livePartyNames.has(this.normalizeCharacterKey(loc?.name))
                    );
                    characterLocations = [...nonPartyLocations, ...livePartyLocations];
                }
            }
        }

        this.logDecision(`Map bundle: ${dimensions.width}x${dimensions.height}, ${characterLocations.length} character marker(s), location=${coords?.name || 'unknown'}.`);
        return {
            pluginActive: true,
            inactiveReason: '',
            worldData: this.worldData,
            mapImage: displayPath,
            isTiled: isTiled,
            tileUrl: tileUrl,
            dimensions: dimensions,
            activeDialogueIndex: requestedDialogueIndex,
            locationTimeline: timeline,
            currentLocation: coords,
            navigation,
            distanceUnit: this.getDistanceUnitDefinition(),
            movementPolicy: {
                ...movementPolicy,
                controls_enabled: options.controlsEnabled === true,
                read_only: options.controlsEnabled !== true
            },
            nearbyText: this.getNearbyLocations(coords),
            guiText: this.getGUILocationText(coords),
            characterLocations: characterLocations,
            projectName: projectName,
            turnNumber: Number(turnContext?.turnNumber || 0)
        };
    }
    getEffectiveProjectName(turnContext) {
        let name = turnContext?.projectName || this.tools.turnContext?.projectName;
        if (!name || name === 'default') {
            const root = turnContext?.rootDirectory || this.tools.turnContext?.rootDirectory;
            if (root) {
                const path = require('path');
                name = path.basename(root);
            }
        }
        return (name || 'default').toLowerCase();
    }

    getFactBaseTurnNumber(turnContext) {
        const baseTurn = resolveBaseTurnNumber(turnContext);
        return Number.isInteger(baseTurn) && baseTurn > 0
            ? baseTurn
            : Number(turnContext?.turnNumber || 0);
    }

    getFactTurnKey(turnContext) {
        return resolveTurnStorageKey(turnContext);
    }
}

module.exports = LocationTrackerLogic;
