const assert = require('node:assert/strict');
const test = require('node:test');

const LocationTrackerLogic = require('./logic.js');
const biomeNavigation = require('./biome_navigation.js');
const navigationCopilot = require('./navigation_copilot.js');
const destinationGrounding = require('./destination_grounding.js');

function makeLogic() {
    const logic = new LocationTrackerLogic({
        settings: { getSelf: () => ({}) },
        turnContext: {},
        logger: {
            runtime: () => {},
            warn: () => {},
            error: () => {}
        }
    });
    logic.worldData = logic.normalizeWorldData({
        meta: {
            pixels_per_km: 10,
            winding_factor: 1,
            base_walk_speed_kmpd: 30,
            dimensions: { width: 1000, height: 1000 }
        },
        nodes: [
            { uid: 'a', name: 'Town A', world_x: 0, world_y: 0 },
            { uid: 'b', name: 'Town B', world_x: 1000, world_y: 0 },
            { uid: 'c', name: 'Town C', world_x: 0, world_y: -1000 }
        ],
        areas: []
    });
    return logic;
}

function atTownA(logic) {
    return logic.buildLocationStateFromEvent({
        status: 'ARRIVED',
        anchor_node: 'Town A',
        specific_location: 'Town A'
    });
}

test('coordinate movement accumulates from the latest canonical position', () => {
    const logic = makeLogic();
    const start = atTownA(logic);
    const first = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 10
    }, start);
    const second = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 15
    }, first);

    assert.equal(first.x, 100);
    assert.equal(second.x, 250);
    assert.equal(second.anchor_node, 'Town A');
    assert.equal(second.destination, 'Town B');
    assert.equal(second.position_model, 'coordinate_v1');
    assert.equal('progress' in second, false);
});

test('first-turn transit can initialize from its confirmed anchor', () => {
    const logic = makeLogic();
    const state = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        anchor_node: 'Town A',
        destination: 'Town B',
        distance_traveled_km: 10
    });

    assert.equal(state.x, 100);
    assert.equal(state.anchor_node, 'Town A');
    assert.equal(state.destination, 'Town B');
});

test('an unresolved first-turn location does not fabricate a zero-coordinate position', async () => {
    const logic = makeLogic();
    logic.getOperationalStatus = async () => ({ active: true });
    logic.tools.pluginState = {
        fromContext: () => ({ turn: () => ({}) })
    };
    logic.tools.db = {
        chat: {
            query: async (sql) => {
                if (sql.includes("predicate = 'location_change'")) return [{ fact_value: 'Unmapped Camp' }];
                if (sql.includes("predicate = 'location_anchor'")) return [{ fact_value: 'Unknown Frontier' }];
                return [];
            }
        }
    };

    const location = await logic.getCurrentLocation({
        isSkeleton: true,
        projectName: 'test-project',
        turnNumber: 1
    });

    assert.equal(location, null);
});

test('location title contributions track displayed place changes but ignore coordinate-only movement', () => {
    const logic = makeLogic();
    const contributions = logic.buildLocationTitleContributions([
        { line: 0, name: 'Town A', specific_location: 'Town A', x: 0, y: 0 },
        { line: 3, name: 'Town A', specific_location: 'Town A', x: 50, y: 0 },
        { line: 6, name: 'Market Square', specific_location: 'Market Square', x: 60, y: 0 }
    ], { name: 'Town A', specific_location: 'Town A', x: 0, y: 0 });

    assert.deepEqual(contributions, [{
        line: 6,
        kind: 'location',
        text: 'Market Square'
    }]);
});

test('zero-distance transit stops in place and redirection starts there', () => {
    const logic = makeLogic();
    const start = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 20
    }, atTownA(logic));
    const stopped = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 0
    }, start);
    const redirected = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town C',
        distance_traveled_km: 10
    }, stopped);

    assert.equal(stopped.x, 200);
    assert.equal(stopped.y, 0);
    assert.equal(redirected.destination, 'Town C');
    assert.ok(redirected.x < stopped.x);
    assert.ok(redirected.y < stopped.y);
});

test('travel progress context gives the location model an active route odometer', () => {
    const logic = makeLogic();
    const state = navigationCopilot.normalizeNavigationState({
        status: 'active',
        active_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        active_leg_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            selected_route_id: 'avoid_boat',
            route_profile: { id: 'avoid_boat', mode: 'overland route' },
            narrative_duration_days: 4,
            duration_label: 'about four days',
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
            remaining_corridor: [{ x: 600, y: 0 }, { x: 1000, y: 0 }]
        }
    });

    const context = logic.buildTravelProgressContext(state);

    assert.match(context, /Active destination: Town B/);
    assert.match(context, /Selected route: avoid_boat \(overland route\)/);
    assert.match(context, /Total accepted route distance: 100/);
    assert.match(context, /Already traveled before this chapter: 60/);
    assert.match(context, /Remaining before this chapter: 40/);
    assert.match(context, /Progress before this chapter: 60\.0%/);
    assert.match(context, /Accepted narrative travel time: about four days \(4\.00 route-days\)/);
    assert.match(context, /Route-time consumed before this chapter: 2\.40 day\(s\); remaining route-time: 1\.60 day\(s\)/);
    assert.match(context, /Narrative route pace: 25/);
    assert.match(context, /additional distance covered in this chapter only/);
});

test('timeline entries resolve sequentially within a chapter', async () => {
    const logic = makeLogic();
    const first = await logic.buildTimelineEntry({
        line: 2,
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 10
    }, atTownA(logic));
    const second = await logic.buildTimelineEntry({
        line: 5,
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 10
    }, first);

    assert.equal(first.x, 100);
    assert.equal(second.x, 200);
    assert.equal(second.line, 5);
});

test('timeline lookup uses creation turn storage key before display index', async () => {
    const logic = makeLogic();
    let capturedSql = '';
    let capturedParams = [];
    logic.tools.db = {
        chat: {
            query: async (sql, params) => {
                capturedSql = sql;
                capturedParams = params;
                return [{
                    fact_value: JSON.stringify([{
                        line: 3,
                        status: 'ARRIVED',
                        anchor_node: 'Town C',
                        specific_location: 'Town C'
                    }])
                }];
            }
        }
    };
    logic.tools.pluginState = {
        fromContext: () => ({ turn: () => ({}) })
    };

    const timeline = await logic.getLocationTimelineForTurn({
        projectName: 'TestProject',
        turnNumber: 65,
        creationTurnNumber: 74,
        output: {}
    });

    assert.match(capturedSql, /turn_key = \?/);
    assert.equal(capturedParams[1], '74');
    assert.ok(capturedParams.includes(74));
    assert.ok(capturedParams.includes(65));
    assert.equal(timeline[0].anchor_node, 'Town C');
});

test('navigation lookup uses creation turn storage key before display index', async () => {
    const logic = makeLogic();
    const persisted = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        journey_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            selected_route_id: 'avoid_boat',
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        }
    });
    let capturedSql = '';
    let capturedParams = [];
    logic.tools.db = {
        chat: {
            query: async (sql, params) => {
                capturedSql = sql;
                capturedParams = params;
                return [{ fact_value: JSON.stringify(persisted) }];
            }
        }
    };
    logic.tools.pluginState = {
        fromContext: () => ({ turn: () => ({}) })
    };

    const restored = await logic.getNavigationStateForContext({
        projectName: 'TestProject',
        turnNumber: 65,
        creationTurnNumber: 74,
        output: {}
    }, { preferPersisted: true });

    assert.match(capturedSql, /turn_key = \?/);
    assert.equal(capturedParams[1], '74');
    assert.ok(capturedParams.includes(74));
    assert.ok(capturedParams.includes(65));
    assert.equal(restored.journey_plan.selected_route_id, 'avoid_boat');
    assert.equal(restored.journey_plan.corridor.length, 2);
});

test('normalized transit events carry destination but never emit legacy progress', () => {
    const logic = makeLogic();
    const previous = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 10
    }, atTownA(logic));
    const events = logic.normalizeLocationEvents({
        location_events: [{
            line: 0,
            status: 'TRANSIT',
            anchor_node: 'Town A',
            distance_traveled_km: 5
        }]
    }, previous, { processed: { vnManager: { processedLines: [{}] } } });

    assert.equal(events[0].destination, 'Town B');
    assert.equal(events[0].distance_traveled_km, 5);
    assert.equal('origin' in events[0], false);
    assert.equal('progress' in events[0], false);
});

test('movement reaching or overshooting the destination becomes arrival', () => {
    const logic = makeLogic();
    const arrived = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 150
    }, atTownA(logic));

    assert.equal(arrived.status, 'ARRIVED');
    assert.equal(arrived.type, 'NODE');
    assert.equal(arrived.x, 1000);
    assert.equal(arrived.anchor_node, 'Town B');
    assert.equal(arrived.destination, null);
    assert.equal(arrived.movement_distance_km, 100);
});

test('invalid distance and unresolved destinations cannot move the pin', () => {
    const logic = makeLogic();
    const start = atTownA(logic);
    const invalidDistance = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: -20
    }, start);
    const unresolved = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Missing Town',
        distance_traveled_km: 20
    }, invalidDistance);

    assert.equal(invalidDistance.x, 0);
    assert.equal(invalidDistance.status, 'TRANSIT');
    assert.equal(unresolved.x, 0);
    assert.equal(unresolved.destination, 'Town B');
    assert.equal(unresolved.movement_distance_km, 0);
});

test('nearest node is geometric while confirmed anchor remains narrative', () => {
    const logic = makeLogic();
    const state = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 60
    }, atTownA(logic));

    assert.equal(state.anchor_node, 'Town A');
    assert.equal(state.nearest_node.name, 'Town B');
    assert.equal(state.nearest_node.distance_km, 40);
});

test('accepted route corridors drive canonical movement around bends', () => {
    const logic = makeLogic();
    const navigationState = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        active_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'road_favored',
            corridor: [{ x: 0, y: 0 }, { x: 0, y: -500 }, { x: 1000, y: 0 }]
        },
        active_leg_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'road_favored',
            corridor: [{ x: 0, y: 0 }, { x: 0, y: -500 }, { x: 1000, y: 0 }]
        }
    });
    const resolved = logic.resolveCoordinateMovementWithNavigation({
        status: 'TRANSIT', destination: 'Town B', distance_traveled_km: 50
    }, atTownA(logic), navigationState);

    assert.equal(resolved.location.x, 0);
    assert.equal(resolved.location.y, -500);
    assert.deepEqual(resolved.navigationState.active_leg_plan.remaining_corridor[0], { x: 0, y: -500 });
});

test('accepted route distance controls route progress when available', () => {
    const logic = makeLogic();
    logic.worldData.meta.winding_factor = 2;
    const navigationState = navigationCopilot.normalizeNavigationState({
        status: 'active',
        active_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        active_leg_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'story_paced',
            distance_km: 100,
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        }
    });

    const resolved = logic.resolveCoordinateMovementWithNavigation({
        status: 'TRANSIT', destination: 'Town B', distance_traveled_km: 50
    }, atTownA(logic), navigationState);

    assert.equal(resolved.location.x, 500);
    assert.equal(resolved.location.movement_distance_km, 50);
    assert.deepEqual(resolved.navigationState.active_leg_plan.remaining_corridor[0], { x: 500, y: 0 });
});

test('route movement can arrive at and retire an intermediate waypoint', () => {
    const logic = makeLogic();
    const navigationState = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'poi_stops',
            corridor: [{ x: 0, y: 0 }, { x: 0, y: -1000 }, { x: 1000, y: 0 }],
            waypoints: [{ uid: 'c', name: 'Town C', purpose: 'Rest', status: 'pending' }]
        }
    });
    const resolved = logic.resolveCoordinateMovementWithNavigation({
        status: 'TRANSIT', destination: 'Town C', distance_traveled_km: 100
    }, atTownA(logic), navigationState);

    assert.equal(resolved.location.status, 'ARRIVED');
    assert.equal(resolved.location.anchor_node, 'Town C');
    assert.equal(resolved.navigationState.journey_plan.waypoints[0].status, 'reached');
    assert.deepEqual(resolved.navigationState.journey_plan.remaining_corridor[0], { x: 0, y: -1000 });
});

test('v2 active legs inherit their matching journey corridor', () => {
    const state = navigationCopilot.normalizeNavigationState({
        version: 2,
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        active_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: { destination: { uid: 'b', name: 'Town B' }, corridor: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        active_leg_plan: { destination: { uid: 'b', name: 'Town B' }, summary: 'Continue.' }
    });
    assert.equal(state.version, navigationCopilot.NAVIGATION_STATE_VERSION);
    assert.deepEqual(state.active_leg_plan.remaining_corridor, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test('biome lookup uses enabled navigation-grid cells and rejects unknowns', () => {
    const cache = {
        coverage: { enabled: true },
        source: { world_dimensions: { width: 100, height: 100 } },
        palette: [
            { id: 'forest', label: 'Forest' },
            { id: 'road', label: 'Road' }
        ],
        grid: {
            width: 2,
            height: 2,
            cells: [
                { primary: 'forest', features: ['road'], slows_down: false, needs_boat: false, is_road: true, is_river: false, unknown_ratio: 0 },
                { primary: null, features: [], unknown_ratio: 1 },
                { primary: 'forest', features: [], unknown_ratio: 0 },
                { primary: 'forest', features: [], unknown_ratio: 0 }
            ]
        }
    };

    const forest = biomeNavigation.lookupBiomeAtCoordinates(cache, {}, 25, -25);
    assert.equal(forest.label, 'Forest');
    assert.deepEqual(forest.features, [{ id: 'road', label: 'Road' }]);
    assert.equal(forest.is_road, true);
    assert.equal(biomeNavigation.lookupBiomeAtCoordinates(cache, {}, 75, -25), null);
    assert.equal(biomeNavigation.lookupBiomeAtCoordinates(cache, {}, -1, -25), null);
    assert.equal(biomeNavigation.lookupBiomeAtCoordinates({ ...cache, coverage: { enabled: false } }, {}, 25, -25), null);
});

test('travel segments animate the actual coordinate displacement as a full segment', async () => {
    const logic = makeLogic();
    const previous = atTownA(logic);
    const current = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 10
    }, previous);
    current.line = 3;
    current.travel_party = ['Hero'];

    logic.isTravelAnimationEnabled = () => true;
    logic.getLocationTimelineForTurn = async () => [current];
    logic.loadWorldData = async () => {};
    logic.getCurrentLocation = async () => previous;
    logic.getTravelMinDistanceKm = () => 0;

    const segments = await logic.buildTravelSegments({
        getPreviousChapter: async () => ({ turnNumber: 1 })
    });

    assert.equal(segments.length, 1);
    assert.equal(segments[0].from.x, 0);
    assert.equal(segments[0].to.x, 100);
    assert.equal(segments[0].journeyFrom.x, 0);
    assert.equal(segments[0].journeyTo.x, 100);
    assert.equal(segments[0].startProgress, 0);
    assert.equal(segments[0].endProgress, 1);
});

test('navigation intent distinguishes journey, leg, keep, clear, and low confidence', () => {
    const nodes = makeLogic().worldData.nodes;
    assert.equal(navigationCopilot.normalizeNavigationIntent({ operation: 'SET_JOURNEY', destination: 'Town B', confidence: 0.9 }, nodes).operation, 'SET_JOURNEY');
    assert.equal(navigationCopilot.normalizeNavigationIntent({ operation: 'SET_LEG', destination: 'Town C', confidence: 0.9 }, nodes).operation, 'SET_LEG');
    assert.equal(navigationCopilot.normalizeNavigationIntent({ operation: 'CLEAR', confidence: 0.9 }, nodes).operation, 'CLEAR');
    assert.equal(navigationCopilot.normalizeNavigationIntent({ operation: 'SET_JOURNEY', destination: 'Town B', confidence: 0.4 }, nodes).operation, 'KEEP');
    assert.equal(navigationCopilot.normalizeNavigationIntent({ operation: 'SET_JOURNEY', destination: 'Missing', confidence: 1 }, nodes).operation, 'KEEP');
});

test('safe local corridor uses deterministic assistance without pathfinding', async () => {
    const logic = makeLogic();
    logic.inspectNavigationCorridor = async () => ({
        available: true,
        same_cell: false,
        map_span_ratio: 0.03,
        needs_boat: false,
        slows_down: false,
        has_river: false,
        uncertain: false,
        has_road: true,
        runs: [{ id: 'plains', label: 'Plains' }],
        corridor: [{ x: 0, y: 0 }, { x: 30, y: 0 }]
    });
    logic.analyzeBiomeRouteBetweenCoordinates = async () => {
        throw new Error('A* should not run for a safe local corridor.');
    };

    const result = await logic.planNavigationRoute({}, atTownA(logic), logic.findWorldNodeByName('Town B'), {}, navigationCopilot.emptyNavigationState());
    assert.equal(result.plan.selection_source, 'simple');
    assert.match(result.plan.summary, /marked road/i);
});

test('unverified local route remains simple and a same-cell target needs no plan', async () => {
    const logic = makeLogic();
    logic.inspectNavigationCorridor = async () => ({ available: false, same_cell: false, map_span_ratio: 0.04, corridor: [] });
    const unverified = await logic.planNavigationRoute({}, atTownA(logic), logic.findWorldNodeByName('Town B'), {}, navigationCopilot.emptyNavigationState());
    assert.equal(unverified.plan.selection_source, 'simple');
    assert.match(unverified.plan.summary, /provisional/i);

    logic.inspectNavigationCorridor = async () => ({ available: true, same_cell: true, map_span_ratio: 0.001 });
    const sameCell = await logic.planNavigationRoute({}, atTownA(logic), logic.findWorldNodeByName('Town B'), {}, navigationCopilot.emptyNavigationState());
    assert.equal(sameCell.reached, true);
});

test('complex planner validation rejects invented routes and waypoints', () => {
    const logic = makeLogic();
    const routes = [{
        id: 'safe',
        distanceKm: 100,
        has_boat_required: false,
        journey_stops: [{ name: 'Town C' }],
        nearby_pois: [],
        suggested_stops: [],
        text: 'Safe route'
    }];
    const valid = navigationCopilot.normalizePlannerResult({
        selected_route_id: 'safe',
        summary: 'Travel through Town C.',
        waypoints: [
            { name: 'Town C', purpose: 'Rest' },
            { name: 'Invented Place', purpose: 'Impossible' }
        ],
        suggested_next_waypoint: 'Town C',
        narrative_duration_days: 4.5,
        duration_label: 'about 4-5 days'
    }, routes, logic.worldData.nodes, logic.findWorldNodeByName('Town B'));

    assert.equal(valid.waypoints.length, 1);
    assert.equal(valid.waypoints[0].name, 'Town C');
    assert.equal(valid.narrative_duration_days, 4.5);
    assert.equal(valid.duration_label, 'about 4-5 days');
    assert.equal(navigationCopilot.normalizePlannerResult({ selected_route_id: 'invented' }, routes, logic.worldData.nodes), null);
});

test('non-simple corridor invokes route analysis and planner selection', async () => {
    const logic = makeLogic();
    const routes = [
        { id: 'boat', distanceKm: 10, has_boat_required: true, notes: ['boat'], text: 'Boat route', debug_path: [] },
        { id: 'land', distanceKm: 30, has_boat_required: false, notes: [], text: 'Land route', debug_path: [] }
    ];
    let routeAnalysisCalls = 0;
    let plannerCalls = 0;
    logic.inspectNavigationCorridor = async () => ({ available: true, same_cell: false, map_span_ratio: 0.2, needs_boat: true });
    logic.analyzeBiomeRouteBetweenCoordinates = async () => {
        routeAnalysisCalls += 1;
        return { enabled: true, routes };
    };
    logic.gatherRoutePlannerContext = async () => ({});
    logic.chooseComplexNavigationRoute = async () => {
        plannerCalls += 1;
        return {
            selectedRoute: routes[1],
            summary: 'Take the land route.',
            waypoints: [],
            suggested_next_waypoint: null,
            requirements: [],
            narrative_duration_days: 4.5,
            duration_label: 'about 4-5 days'
        };
    };

    const result = await logic.planNavigationRoute({}, atTownA(logic), logic.findWorldNodeByName('Town B'), {}, navigationCopilot.emptyNavigationState());
    assert.equal(routeAnalysisCalls, 1);
    assert.equal(plannerCalls, 1);
    assert.equal(result.plan.selection_source, 'route_llm');
    assert.equal(result.plan.selected_route_id, 'land');
    assert.equal(result.plan.narrative_duration_days, 4.5);
    assert.equal(result.plan.duration_label, 'about 4-5 days');
});

test('planner fallback chooses shortest non-boat route before shorter boat route', () => {
    const selected = navigationCopilot.chooseFallbackRoute([
        { id: 'boat', distanceKm: 10, has_boat_required: true },
        { id: 'land-long', distanceKm: 30, has_boat_required: false },
        { id: 'land-short', distanceKm: 20, has_boat_required: false }
    ]);
    assert.equal(selected.id, 'land-short');
});

test('layered navigation operations preserve the broader journey plan', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    logic.planNavigationRoute = async (_context, _location, destinationNode) => ({
        reached: false,
        plan: {
            destination: navigationCopilot.nodeRef(destinationNode),
            selected_route_id: 'direct',
            selection_source: 'simple',
            summary: `Proceed to ${destinationNode.name}.`,
            waypoints: [],
            suggested_next_waypoint: null,
            route_notes: [],
            corridor: [],
            created_turn: 5,
            updated_turn: 5,
            status: 'accepted'
        }
    });
    const context = { turnNumber: 5, output: {} };
    const location = atTownA(logic);
    const journey = await logic.updateNavigationCopilot(context, {
        operation: 'SET_JOURNEY', destination: 'Town B', confidence: 1, evidence_line: 2
    }, navigationCopilot.emptyNavigationState(), location);
    const leg = await logic.updateNavigationCopilot(context, {
        operation: 'SET_LEG', destination: 'Town C', confidence: 1, evidence_line: 4
    }, journey, location);

    assert.equal(journey.journey_plan.destination.name, 'Town B');
    assert.equal(leg.journey_plan.destination.name, 'Town B');
    assert.equal(leg.journey_plan.status, 'suspended');
    assert.equal(leg.active_target.name, 'Town C');
    assert.equal(leg.active_leg_plan.destination.name, 'Town C');
    assert.equal(location.x, 0, 'navigation planning must not move the canonical pin');

    const arrived = await logic.updateNavigationCopilot(context, { operation: 'KEEP', confidence: 1 }, leg, logic.buildLocationStateFromEvent({ status: 'ARRIVED', anchor_node: 'Town C' }));
    assert.equal(arrived.status, 'awaiting_intent');
    assert.equal(arrived.journey_plan.destination.name, 'Town B');
    assert.equal(arrived.active_target, null);

    const cleared = await logic.updateNavigationCopilot(context, { operation: 'CLEAR', confidence: 1 }, arrived, location);
    assert.equal(cleared.status, 'idle');
    assert.equal(cleared.journey_plan, null);
});

test('deterministic journey resume preserves strategy and skips waypoints behind the pin', async () => {
    const logic = makeLogic();
    logic.worldData.nodes.push({ uid: 'w', name: 'Old Stop', world_x: 250, world_y: 0 });
    logic.analyzeBiomeRouteBetweenCoordinates = async (_context, start, end) => ({
        enabled: true,
        routes: [{
            id: 'road_favored',
            mode_label: 'road-favored alternate',
            debug_path: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]
        }]
    });
    const oldPlan = navigationCopilot.normalizeRoutePlan({
        destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        selected_route_id: 'road_favored',
        route_profile: { id: 'road_favored', mode: 'road-favored alternate' },
        corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
        remaining_corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
        waypoints: [{ uid: 'w', name: 'Old Stop', purpose: 'Rest', status: 'pending' }],
        status: 'suspended'
    });
    const rebuilt = await logic.rebuildJourneyPlanDeterministically(
        { turnNumber: 8 },
        { x: 600, y: -100 },
        oldPlan,
        logic.findWorldNodeByName('Town B')
    );

    assert.equal(rebuilt.route_profile.id, 'road_favored');
    assert.equal(rebuilt.waypoints[0].status, 'skipped');
    assert.deepEqual(rebuilt.remaining_corridor[0], { x: 600, y: -100 });
});

test('selecting the next journey waypoint resumes rather than re-suspends the journey', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    const suspended = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'poi_stops',
            corridor: [{ x: 0, y: 0 }, { x: 0, y: -1000 }, { x: 1000, y: 0 }],
            waypoints: [{ uid: 'c', name: 'Town C', purpose: 'Rest', status: 'pending' }],
            status: 'suspended'
        }
    });
    logic.resumeJourneyPlan = async () => navigationCopilot.normalizeRoutePlan({ ...suspended.journey_plan, status: 'active' });
    const resumed = await logic.updateNavigationCopilot({ turnNumber: 9 }, {
        operation: 'SET_LEG', destination: 'Town C', confidence: 1, evidence_line: 2
    }, suspended, atTownA(logic));

    assert.equal(resumed.active_target.name, 'Town C');
    assert.equal(resumed.journey_plan.status, 'active');
    assert.equal(resumed.active_leg_plan.destination.name, 'Town C');

    const arrived = logic.resolveCoordinateMovementWithNavigation({
        status: 'TRANSIT', destination: 'Town C', distance_traveled_km: 100
    }, atTownA(logic), resumed);
    assert.equal(arrived.location.anchor_node, 'Town C');
    assert.deepEqual(arrived.navigationState.journey_plan.remaining_corridor.at(-1), { x: 1000, y: 0 });
});

test('map navigation payload exposes only renderable route guidance', () => {
    const logic = makeLogic();
    const payload = logic.buildNavigationMapPayload({
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped', reasoning: 'private' },
        active_target: { uid: null, name: 'Breakfast stall', map_status: 'unmapped', reasoning: 'private' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B' },
            summary: 'Follow the road.',
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
            waypoints: [{ uid: 'c', name: 'Town C', purpose: 'Rest' }],
            route_notes: ['Bring supplies']
        },
        active_leg_plan: { destination: { name: 'Breakfast stall', map_status: 'unmapped' }, summary: 'Eat first.' }
    }, atTownA(logic));

    assert.equal(payload.journey.target.name, 'Town B');
    assert.equal(payload.immediate.target.map_status, 'unmapped');
    assert.deepEqual(payload.immediate.corridor, []);
    assert.equal(payload.journey.waypoints[0].name, 'Town C');
    assert.doesNotMatch(JSON.stringify(payload), /private|reasoning|confidence/i);
});

test('map navigation payload does not invent straight corridors for route plans without geometry', () => {
    const logic = makeLogic();
    const payload = logic.buildNavigationMapPayload({
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            selected_route_id: 'avoid_boat',
            summary: 'Use the selected overland route.',
            corridor: []
        }
    }, atTownA(logic));

    assert.equal(payload.journey.target.name, 'Town B');
    assert.equal(payload.journey.route_id, 'avoid_boat');
    assert.deepEqual(payload.journey.corridor, []);
    assert.equal(payload.journey.status, 'provisional');
});

test('navigation timeline delays new immediate intent until its evidence line', () => {
    const logic = makeLogic();
    const previous = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: { destination: { uid: 'b', name: 'Town B' }, corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }
    });
    const final = navigationCopilot.normalizeNavigationState({
        ...previous,
        active_target: { uid: 'c', name: 'Town C', map_status: 'mapped' },
        active_leg_plan: { destination: { uid: 'c', name: 'Town C' }, corridor: [{ x: 0, y: 0 }, { x: 0, y: -1000 }] }
    });
    const timeline = logic.buildNavigationTimeline(previous, final, {
        navigation_update: {
            journey: { operation: 'KEEP', evidence_line: 0 },
            immediate: { operation: 'SET', evidence_line: 31 },
            deliberation: { operation: 'KEEP', options: [] }
        }
    });

    assert.equal(timeline.find(entry => entry.line === 0).state.active_target, null);
    assert.equal(timeline.find(entry => entry.line === 31).state.active_target.name, 'Town C');
});

test('navigation assistance is coordinate-free and waits at completed legs', () => {
    const state = {
        version: 1,
        status: 'awaiting_intent',
        active_target: null,
        active_leg_plan: null,
        last_reached_target: { uid: 'c', name: 'Town C', x: 10, y: -20 },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B' },
            summary: 'Continue via Town C at (10, -20).',
            suggested_next_waypoint: { uid: 'a', name: 'Town A' },
            corridor: [{ x: 10, y: -20 }]
        },
        last_operation: 'KEEP'
    };
    const text = navigationCopilot.buildNavigationPromptText(state);
    assert.match(text, /reached Town C/i);
    assert.match(text, /not active travel intent/i);
    assert.doesNotMatch(text, /\bx\b|\by\b|-20|corridor/i);
});

test('navigation state persists to turn state and falls back to facts', async () => {
    const logic = makeLogic();
    const turnBucket = {};
    const storedFacts = [];
    const storedOverrides = [];
    logic.tools.pluginState = {
        turn: () => turnBucket,
        fromContext: () => ({ turn: () => ({}) })
    };
    logic.tools.facts = {
        cleanUpFactsDb: async () => {},
        appendToFactsDb: async (fact, overrides) => {
            storedFacts.push(fact);
            storedOverrides.push(overrides);
        }
    };
    const context = { turnNumber: 7, creationTurnNumber: 9, projectName: 'TestProject', output: {} };
    const state = {
        ...navigationCopilot.emptyNavigationState(),
        status: 'active',
        active_target: { uid: 'b', name: 'Town B' }
    };
    await logic.persistNavigationState(context, state);
    assert.equal(turnBucket.navigationState.active_target.name, 'Town B');
    assert.equal(storedFacts[0].predicate, 'navigation_state');
    assert.equal(storedOverrides[0].turn_number, 9);
    assert.equal(storedOverrides[0].turn_key, '9');

    logic.tools.db = {
        chat: {
            query: async () => [{ fact_value: storedFacts[0].fact_value }]
        }
    };
    const restored = await logic.getNavigationStateForContext(context);
    assert.equal(restored.active_target.name, 'Town B');
});

test('disabled auto-navigation performs no planning or persistence', async () => {
    const logic = makeLogic();
    logic.settings.auto_navigation_planning_enabled = false;
    logic.planNavigationRoute = async () => {
        throw new Error('Planning should be disabled.');
    };
    logic.persistNavigationState = async () => {
        throw new Error('Persistence should not run while disabled.');
    };
    const previous = navigationCopilot.emptyNavigationState();
    const result = await logic.updateNavigationCopilot({}, {
        operation: 'SET_JOURNEY', destination: 'Town B', confidence: 1
    }, previous, atTownA(logic));
    assert.deepEqual(result, previous);
});

test('KEEP repairs an accepted journey that has no route plan', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    let plannedDestination = null;
    logic.planNavigationRoute = async (_context, currentLocation, destinationNode) => {
        plannedDestination = destinationNode.name;
        return {
            reached: false,
            plan: logic.buildAcceptedPlan({
                destinationNode,
                selectionSource: 'repair',
                summary: 'Repair route.',
                corridor: [{ x: currentLocation.x, y: currentLocation.y }, { x: destinationNode.world_x, y: destinationNode.world_y }],
                turnNumber: 12,
                currentLocation
            })
        };
    };
    const stale = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: null,
        active_target: null,
        active_leg_plan: null
    });

    const repaired = await logic.updateNavigationCopilot({ turnNumber: 12 }, {
        operation: 'KEEP',
        confidence: 1
    }, stale, atTownA(logic));

    assert.equal(plannedDestination, 'Town B');
    assert.equal(repaired.status, 'active');
    assert.equal(repaired.journey_plan.destination.name, 'Town B');
    assert.equal(repaired.journey_plan.corridor.length, 2);
    assert.equal(repaired.active_target.name, 'Town B');
    assert.equal(repaired.active_leg_plan.corridor.length, 2);
});

test('layered KEEP repairs a journey plan with an empty corridor', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    let planCalls = 0;
    logic.planNavigationRoute = async (_context, currentLocation, destinationNode) => {
        planCalls += 1;
        return {
            reached: false,
            plan: logic.buildAcceptedPlan({
                destinationNode,
                selectionSource: 'repair',
                summary: 'Repair route.',
                corridor: [{ x: currentLocation.x, y: currentLocation.y }, { x: destinationNode.world_x, y: destinationNode.world_y }],
                turnNumber: 13,
                currentLocation
            })
        };
    };
    const stale = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        journey_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        journey_plan: {
            destination: { uid: 'b', name: 'Town B', map_status: 'mapped' },
            corridor: []
        },
        active_target: { uid: 'b', name: 'Town B', map_status: 'mapped' },
        active_leg_plan: null
    });

    const repaired = await logic.updateLayeredNavigationCopilot({ turnNumber: 13 }, {
        journey: { operation: 'KEEP', confidence: 1 },
        immediate: { operation: 'KEEP', confidence: 1 },
        deliberation: { operation: 'KEEP', options: [] }
    }, stale, atTownA(logic));

    assert.equal(planCalls, 1);
    assert.equal(repaired.journey_plan.corridor.length, 2);
    assert.equal(repaired.active_leg_plan.corridor.length, 2);
    assert.equal(repaired.last_operation, 'KEEP');
});

test('live map navigation prefers the newest persisted fact over a stale context snapshot', async () => {
    const logic = makeLogic();
    const stale = navigationCopilot.normalizeNavigationState({
        status: 'idle',
        last_operation: 'KEEP'
    });
    const persisted = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        journey_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        },
        manual_order: {
            id: 'live-order', source: 'user_map', mode: 'planned', status: 'active', authorized: true,
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    logic.tools.pluginState = {
        fromContext: () => ({ turn: () => ({ navigationState: stale }) })
    };
    logic.tools.db = {
        chat: { query: async () => [{ fact_value: JSON.stringify(persisted) }] }
    };
    const context = { turnNumber: 10, projectName: 'TestProject' };
    assert.equal((await logic.getNavigationStateForContext(context)).status, 'idle');
    const live = await logic.getNavigationStateForContext(context, { preferPersisted: true });
    assert.equal(live.manual_order.id, 'live-order');
    assert.equal(live.journey_plan.corridor.length, 2);
});

test('exact destination grounding is deterministic while partial names use one batched call', async () => {
    const logic = makeLogic();
    logic.worldData.nodes.push(logic.normalizeWorldNode({ uid: 'aaru-node', name: 'Aaru Village', world_x: 300, world_y: -100, type: 'Village' }, 3));
    let calls = 0;
    logic.tools.llm = {
        json: async request => {
            calls += 1;
            assert.equal(request.model, 'location-model');
            assert.equal(request.messages.length, 3);
            return { content: { resolutions: [{ key: 'aaru', outcome: 'MAPPED', selected_uid: 'aaru-node' }] } };
        }
    };
    logic.settings.model_def = { model: 'location-model' };

    const exact = await logic.groundLocationAnalysis({
        location_events: [{ line: 0, status: 'TRANSIT', destination_mention: 'Aaru Village' }],
        navigation_intent: { operation: 'SET_JOURNEY', destination_mention: 'Aaru Village', confidence: 1 }
    }, [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }], atTownA(logic), null);
    assert.equal(calls, 0);
    assert.equal(exact.location_events[0].destination, 'Aaru Village');

    const partial = await logic.groundLocationAnalysis({
        location_events: [{ line: 0, status: 'TRANSIT', destination_mention: 'Aaru' }],
        navigation_intent: { operation: 'SET_JOURNEY', destination_mention: 'Aaru', confidence: 1 }
    }, [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }], atTownA(logic), null);
    assert.equal(calls, 1);
    assert.equal(partial.location_events[0].destination_uid, 'aaru-node');
    assert.equal(partial.navigation_intent.destination_grounding.outcome, 'mapped');
});

test('grounding batches references and rejects invented candidate UIDs', async () => {
    const logic = makeLogic();
    let requestMessages;
    logic.tools.llm = { json: async request => {
        requestMessages = request.messages.map(message => ({ ...message }));
        return { content: { resolutions: [
            { key: 'town', outcome: 'MAPPED', selected_uid: 'invented' },
            { key: 'town b', outcome: 'MAPPED', selected_uid: 'b' }
        ] } };
    } };
    const result = await logic.groundLocationAnalysis({
        location_events: [
            { line: 0, status: 'TRANSIT', anchor_reference: 'Town', destination_mention: 'Town B' },
            { line: 3, status: 'ARRIVED', anchor_reference: 'Town' }
        ],
        navigation_intent: { operation: 'SET_LEG', destination_mention: 'Town', confidence: 1 }
    }, [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }], atTownA(logic), null);

    assert.equal(requestMessages.length, 3, 'all fuzzy references should share one resolver request');
    assert.equal(result.location_events[0].anchor_map_status, 'ambiguous');
    assert.equal(result.navigation_intent.destination_grounding.outcome, 'ambiguous');
    assert.equal(result.location_events[0].destination_uid, 'b');
});

test('resolver may preserve a fuzzy narrative place as genuinely unmapped', async () => {
    const logic = makeLogic();
    logic.tools.llm = { json: async () => ({
        content: { resolutions: [{ key: 'town', outcome: 'UNMAPPED', selected_uid: null }] }
    }) };
    const result = await logic.groundLocationAnalysis({
        location_events: [{ line: 0, status: 'TRANSIT', destination_mention: 'Town' }],
        navigation_intent: { operation: 'SET_JOURNEY', destination_mention: 'Town', confidence: 1 }
    }, [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }], atTownA(logic), null);
    assert.equal(result.location_events[0].destination_map_status, 'unmapped');
    assert.equal(result.location_events[0].destination, 'Town');
    assert.equal(result.navigation_intent.destination_grounding.outcome, 'unmapped');
});

test('ambiguous active targets are retried and can become mapped on a later KEEP turn', async () => {
    const logic = makeLogic();
    logic.tools.llm = { json: async () => ({
        content: { resolutions: [{ key: 'town', outcome: 'MAPPED', selected_uid: 'b' }] }
    }) };
    const previous = {
        ...navigationCopilot.emptyNavigationState(),
        status: 'active',
        active_target: {
            uid: null,
            name: 'Town',
            map_status: 'ambiguous',
            candidates: [{ uid: 'a', name: 'Town A' }, { uid: 'b', name: 'Town B' }],
            intent_operation: 'SET_LEG',
            evidence_line: 2
        }
    };
    const result = await logic.groundLocationAnalysis({
        location_events: [],
        navigation_intent: { operation: 'KEEP', confidence: 1 }
    }, [{ role: 'user', content: 'later narrative' }, { role: 'assistant', content: '{}' }], atTownA(logic), previous);
    assert.equal(result.navigation_intent.operation, 'SET_LEG');
    assert.equal(result.navigation_intent.destination, 'Town B');
    assert.equal(result.navigation_intent.destination_grounding.outcome, 'mapped');
});

test('unmapped transit retains narrative intent without moving the pin', () => {
    const logic = makeLogic();
    const start = logic.resolveCoordinateMovement({ status: 'TRANSIT', destination: 'Town B', distance_traveled_km: 5 }, atTownA(logic));
    const state = logic.resolveCoordinateMovement({
        status: 'TRANSIT',
        specific_location: 'Crossing the outer wilds',
        destination: 'Dungeon on the outskirts',
        destination_map_status: 'unmapped',
        distance_traveled_km: 30
    }, start);
    assert.equal(state.x, start.x);
    assert.equal(state.y, start.y);
    assert.equal(state.anchor_node, 'Town A');
    assert.equal(state.destination, 'Dungeon on the outskirts');
    assert.equal(state.destination_map_status, 'unmapped');
    assert.equal(state.movement_distance_km, 0);
});

test('unmapped legs preserve broader journeys and COMPLETE closes only the leg', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    const context = { turnNumber: 8, output: {} };
    const broader = {
        ...navigationCopilot.emptyNavigationState(),
        status: 'active',
        journey_plan: { destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), summary: 'Reach Town B.' }
    };
    const leg = await logic.updateNavigationCopilot(context, {
        operation: 'SET_LEG',
        destination_mention: 'Dungeon on the outskirts',
        destination_grounding: { outcome: 'unmapped', candidates: [] },
        confidence: 1
    }, broader, atTownA(logic));
    assert.equal(leg.active_target.map_status, 'unmapped');
    assert.equal(leg.journey_plan.destination.name, 'Town B');

    const completed = await logic.updateNavigationCopilot(context, { operation: 'COMPLETE', confidence: 1 }, leg, atTownA(logic));
    assert.equal(completed.status, 'awaiting_intent');
    assert.equal(completed.active_target, null);
    assert.equal(completed.journey_plan.destination.name, 'Town B');
});

test('grounding and route selection reuse one transcript and location model', async () => {
    const logic = makeLogic();
    logic.settings.model_def = { model: 'shared-model' };
    const requests = [];
    logic.tools.llm = { json: async request => {
        requests.push({ messages: request.messages.map(message => ({ ...message })), model: request.model, provider: request.provider });
        if (requests.length === 1) return { content: { resolutions: [{ key: 'town', outcome: 'MAPPED', selected_uid: 'b' }] } };
        return { content: { selected_route_id: 'direct', summary: 'Proceed to Town B.', waypoints: [], requirements: [] } };
    } };
    const transcript = [{ role: 'user', content: 'original analysis prompt' }, { role: 'assistant', content: '{"analysis":true}' }];
    await logic.groundLocationAnalysis({
        location_events: [],
        navigation_intent: { operation: 'SET_JOURNEY', destination_mention: 'Town', confidence: 1 }
    }, transcript, atTownA(logic), null);
    const routes = [{ id: 'direct', distanceKm: 100, has_boat_required: false, text: 'Direct route', journey_stops: [], nearby_pois: [] }];
    await logic.chooseComplexNavigationRoute({}, routes, logic.findWorldNodeByName('Town B'), {}, navigationCopilot.emptyNavigationState(), transcript);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'shared-model');
    assert.equal(requests[1].model, 'shared-model');
    assert.deepEqual(requests[1].messages.slice(0, requests[0].messages.length), requests[0].messages);
});

test('destination candidate ranking favors canonical partial names', () => {
    const nodes = [{ uid: 'v', name: 'Aaru Village', type: 'Village' }, { uid: 'r', name: 'Ruins of Dahri', type: 'Ruins' }];
    assert.equal(destinationGrounding.rankCandidates(nodes, 'Aaru')[0].node.uid, 'v');
});

test('layered update preserves a mapped journey beneath an unmapped immediate errand', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    logic.planNavigationRoute = async (_context, _location, node) => ({
        reached: false,
        plan: {
            destination: navigationCopilot.nodeRef(node),
            selected_route_id: 'direct',
            summary: `Route to ${node.name}`,
            route_notes: [],
            planning_basis: logic.buildPlanningBasis(atTownA(logic), node)
        }
    });
    const result = await logic.updateLayeredNavigationCopilot({ turnNumber: 10 }, {
        journey: {
            operation: 'SET', destination_mention: 'Town B', destination: 'Town B', confidence: 1,
            destination_grounding: { outcome: 'mapped', selected_node: logic.findWorldNodeByName('Town B'), candidates: [] }
        },
        immediate: {
            operation: 'SET', destination_mention: 'Marketplace', destination: 'Marketplace', confidence: 1,
            destination_grounding: { outcome: 'unmapped', selected_node: null, candidates: [] }
        },
        deliberation: { operation: 'KEEP', options: [] }
    }, navigationCopilot.emptyNavigationState(), atTownA(logic));

    assert.equal(result.journey_target.name, 'Town B');
    assert.equal(result.journey_plan.destination.name, 'Town B');
    assert.equal(result.active_target.name, 'Marketplace');
    assert.equal(result.active_target.map_status, 'unmapped');
});

test('deliberation researches contested mapped options in one batched planner call', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    logic.inspectNavigationCorridor = async () => ({ available: true, same_cell: false, map_span_ratio: 0.2, needs_boat: true });
    logic.analyzeBiomeRouteBetweenCoordinates = async (_context, _start, end) => {
        const suffix = end.x > 0 ? 'b' : 'c';
        return { enabled: true, routes: [{ id: `${suffix}-route`, distanceKm: 100, has_boat_required: false, notes: [], text: `Route ${suffix}`, journey_stops: [], nearby_pois: [], debug_path: [] }] };
    };
    logic.gatherRoutePlannerContext = async () => ({});
    let plannerCalls = 0;
    logic.tools.llm = { json: async request => {
        plannerCalls += 1;
        assert.match(request.messages.at(-1).content, /Town B/);
        assert.match(request.messages.at(-1).content, /Town C/);
        return { content: { selections: [
            { target_uid: 'b', selected_route_id: 'b-route', summary: 'Research Town B.', waypoints: [], requirements: [] },
            { target_uid: 'c', selected_route_id: 'invented-route', summary: 'Invalid selection.', waypoints: [], requirements: [] }
        ] } };
    } };
    const mapped = name => ({ outcome: 'mapped', selected_node: logic.findWorldNodeByName(name), candidates: [] });
    const result = await logic.updateLayeredNavigationCopilot({ turnNumber: 11 }, {
        journey: { operation: 'KEEP' },
        immediate: { operation: 'KEEP' },
        deliberation: { operation: 'REPLACE', options: [
            { destination: 'Town B', destination_mention: 'Town B', destination_grounding: mapped('Town B'), supporters: ['Char 1'], opponents: ['Char 2'], evidence_lines: [4], confidence: 1 },
            { destination: 'Town C', destination_mention: 'Town C', destination_grounding: mapped('Town C'), supporters: ['Char 2'], opponents: [], evidence_lines: [7], confidence: 1 }
        ] }
    }, navigationCopilot.emptyNavigationState(), atTownA(logic), { messages: [{ role: 'user', content: 'analysis' }] });

    assert.equal(plannerCalls, 1);
    assert.equal(result.deliberation.options.length, 2);
    assert.equal(result.deliberation.options.find(option => option.target.name === 'Town B').route_plan.selection_source, 'route_llm');
    assert.equal(result.deliberation.options.find(option => option.target.name === 'Town C').route_plan.selection_source, 'fallback');
    assert.deepEqual(result.deliberation.options.find(option => option.target.name === 'Town B').opponents, ['Char 2']);
    assert.equal(result.journey_target, null, 'research must not commit either destination');
});

test('layered journey, immediate, and deliberation references share one grounding call', async () => {
    const logic = makeLogic();
    logic.worldData.nodes.push(logic.normalizeWorldNode({ uid: 'aaru-node', name: 'Aaru Village', world_x: 400, world_y: 100 }, 3));
    let calls = 0;
    logic.tools.llm = { json: async () => {
        calls += 1;
        return { content: { resolutions: [
            { key: 'town', outcome: 'MAPPED', selected_uid: 'b' },
            { key: 'aaru', outcome: 'MAPPED', selected_uid: 'aaru-node' }
        ] } };
    } };
    const result = await logic.groundLocationAnalysis({
        location_events: [],
        navigation_update: {
            journey: { operation: 'SET', destination_mention: 'Town', confidence: 1 },
            immediate: { operation: 'KEEP' },
            deliberation: { operation: 'REPLACE', options: [{ destination_mention: 'Aaru', confidence: 1 }] }
        }
    }, [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }], atTownA(logic), null);
    assert.equal(calls, 1);
    assert.equal(result.navigation_update.journey.destination, 'Town B');
    assert.equal(result.navigation_update.deliberation.options[0].destination, 'Aaru Village');
});

test('committing a deliberated option reuses its valid researched plan', async () => {
    const logic = makeLogic();
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    const location = atTownA(logic);
    const node = logic.findWorldNodeByName('Town B');
    const researchedPlan = {
        destination: navigationCopilot.nodeRef(node),
        selected_route_id: 'researched',
        summary: 'Previously researched route.',
        route_notes: [],
        corridor: [{ x: location.x, y: location.y }, { x: node.world_x, y: node.world_y }],
        planning_basis: logic.buildPlanningBasis(location, node)
    };
    const previous = {
        ...navigationCopilot.emptyNavigationState(),
        deliberation: { status: 'open', options: [{ target: navigationCopilot.nodeRef(node), supporters: ['Char 1'], opponents: [], route_plan: researchedPlan }] }
    };
    logic.planNavigationRoute = async () => { throw new Error('Valid researched plan should be reused.'); };
    const result = await logic.updateLayeredNavigationCopilot({ turnNumber: 12 }, {
        journey: { operation: 'SET', destination: 'Town B', destination_mention: 'Town B', confidence: 1, destination_grounding: { outcome: 'mapped', selected_node: node, candidates: [] } },
        immediate: { operation: 'KEEP' },
        deliberation: { operation: 'CLEAR' }
    }, previous, location);
    assert.equal(result.journey_plan.selected_route_id, 'researched');
    assert.equal(result.deliberation, null);
});

test('deliberation keeps only the three strongest distinct options', () => {
    const logic = makeLogic();
    logic.worldData.nodes.push(
        logic.normalizeWorldNode({ uid: 'd', name: 'Town D', world_x: 500, world_y: 500 }, 3),
        logic.normalizeWorldNode({ uid: 'e', name: 'Town E', world_x: -500, world_y: 500 }, 4)
    );
    const option = (name, confidence, line, supporters = []) => ({
        destination: name,
        destination_mention: name,
        destination_grounding: { outcome: 'mapped', selected_node: logic.findWorldNodeByName(name), candidates: [] },
        confidence,
        evidence_lines: [line],
        supporters
    });
    const options = logic.normalizeDeliberationOptions([
        option('Town A', 0.8, 1),
        option('Town B', 1, 2),
        option('Town C', 0.9, 3),
        option('Town D', 0.8, 4, ['A', 'B']),
        option('Town E', 0.4, 5),
        { ...option('Town A', 1, 6, ['C']), status: 'rejected' }
    ]);
    assert.deepEqual(options.map(item => item.target.name), ['Town B', 'Town C', 'Town D']);
});

test('navigation assistance presents researched options without choosing a winner', () => {
    const text = navigationCopilot.buildNavigationPromptText({
        ...navigationCopilot.emptyNavigationState(),
        deliberation: { status: 'open', options: [
            { target: { uid: 'a', name: 'Town A', map_status: 'mapped' }, supporters: ['Char 1'], opponents: ['Char 2'], route_plan: { summary: 'Cross the plains.', route_notes: ['slow mountains'] } },
            { target: { uid: 'b', name: 'Town B', map_status: 'mapped' }, supporters: ['Char 2'], opponents: [], route_plan: { summary: 'Follow the river road.', route_notes: ['river crossing'] } }
        ] }
    });
    assert.match(text, /TRAVEL OPTIONS UNDER DISCUSSION/);
    assert.match(text, /Town A/);
    assert.match(text, /Town B/);
    assert.match(text, /not an accepted destination/i);
    assert.doesNotMatch(text, /best destination|choose Town/i);
});

test('disabled biome coverage logs why deliberation uses fallback instead of route selection', async () => {
    const logic = makeLogic();
    const runtimeLogs = [];
    logic.tools.logger.runtime = message => runtimeLogs.push(message);
    logic.inspectNavigationCorridor = async () => ({
        available: false,
        map_span_ratio: 0.1,
        corridor: [],
        coverage: { painted: 0.2174, recognized: 0.0981, enabled: false }
    });
    logic.analyzeBiomeRouteBetweenCoordinates = async () => ({
        enabled: false,
        fallback: { text: 'Biome navigation is disabled; use straight-line travel guidance.' }
    });
    const prepared = await logic.prepareDeliberationRoute({ turnNumber: 13 }, atTownA(logic), {
        target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
    });
    assert.equal(prepared.kind, 'planned');
    assert.equal(prepared.plan.selection_source, 'fallback');
    assert.match(runtimeLogs.join('\n'), /biome pathfinding unavailable/i);
    assert.match(runtimeLogs.join('\n'), /21\.74%/);
    assert.match(runtimeLogs.join('\n'), /route-selection LLM skipped/i);
});

test('provisional grounding never calls the resolver LLM and preserves fuzzy references as ambiguous', async () => {
    const logic = makeLogic();
    logic.tools.llm = { json: async () => { throw new Error('Resolver LLM must be deferred.'); } };
    const messages = [{ role: 'user', content: 'analysis' }, { role: 'assistant', content: '{}' }];
    const result = await logic.groundLocationAnalysis({
        location_events: [{ line: 0, status: 'TRANSIT', destination_mention: 'Town' }],
        navigation_update: {
            journey: { operation: 'SET', destination_mention: 'Town', confidence: 1 },
            immediate: { operation: 'KEEP' },
            deliberation: { operation: 'KEEP', options: [] }
        }
    }, messages, atTownA(logic), null, { allowLlm: false });
    assert.equal(messages.length, 2);
    assert.equal(result.location_events[0].destination_map_status, 'ambiguous');
    assert.equal(result.navigation_update.journey.destination_grounding.outcome, 'ambiguous');
});

test('background continuation refines facts, plans navigation, and clears pending work', async () => {
    const logic = makeLogic();
    const calls = [];
    logic.loadWorldData = async () => {};
    logic.groundLocationAnalysis = async (_result, _messages, _location, _state, options) => {
        calls.push(`ground:${options.allowLlm}`);
        return {
            location_events: [{ line: 0, status: 'STAYED', anchor_node: 'Town A', specific_location: 'Town A' }],
            navigation_update: { journey: { operation: 'KEEP' }, immediate: { operation: 'KEEP' }, deliberation: { operation: 'KEEP' } }
        };
    };
    logic.cleanCurrentTurnLocationFacts = async () => calls.push('clean');
    logic.persistLocationTimeline = async () => {
        calls.push('persist');
        logic.tools.pluginState.turn().locationState = atTownA(logic);
    };
    logic.updateLayeredNavigationCopilot = async () => calls.push('navigate');
    logic.tools.pluginState = { turn: () => ({}) };
    const context = {
        turnNumber: 20,
        runtime: { worldLocationTracker: { pendingNavigation: {
            result: {}, messages: [], previousLocation: atTownA(logic), previousNavigationState: navigationCopilot.emptyNavigationState(), currentNarrative: 'Scene', previousScene: 'Prior'
        } } }
    };
    assert.equal(await logic.completePendingNavigation(context), true);
    assert.deepEqual(calls, ['ground:true', 'clean', 'persist', 'navigate']);
    assert.equal(context.runtime.worldLocationTracker.pendingNavigation, undefined);
});

test('map character decoration assigns travel sprites to CORE and active-party characters', async () => {
    const logic = makeLogic();
    let requestedNames = [];
    logic.resolveTravelPartySprites = async (_context, names, options) => {
        requestedNames = names;
        assert.equal(options.allowCatalogFallback, false);
        return [
            { name: 'Core Hero', spritePath: 'assets/sprites/core_hero_neutral.png' },
            { name: 'Major Friend', spritePath: 'assets/sprites/major_friend_neutral.png' }
        ];
    };

    const decorated = await logic.attachCoreMapSprites({}, [
        { name: 'Core Hero', importance: 'core', iconPath: 'core.webp' },
        { name: 'Major Friend', importance: 'major', isPartyMember: true, iconPath: 'major.webp' },
        { name: 'Major Local', importance: 'major', iconPath: 'local.webp' }
    ]);

    assert.deepEqual(requestedNames, ['Core Hero', 'Major Friend']);
    assert.equal(decorated[0].isCore, true);
    assert.equal(decorated[0].spritePath, 'assets/sprites/core_hero_neutral.png');
    assert.equal(decorated[1].isCore, true);
    assert.equal(decorated[1].spritePath, 'assets/sprites/major_friend_neutral.png');
    assert.equal(decorated[2].isCore, undefined);
    assert.equal(decorated[2].spritePath, undefined);
});

test('travel sprite resolution trusts explicit party members and excludes generic art', async () => {
    const logic = makeLogic();
    logic.tools.plugins = {
        isInstalled: id => id === 'character_classifier' || id === 'character_sheets',
        call: async (pluginId, method, name) => {
            assert.equal(pluginId, 'character_sheets');
            assert.equal(method, 'resolveName');
            return name === 'Hero Alias' ? 'Hero' : name;
        }
    };
    logic.tools.assets = {
        getSpriteCatalog: async () => ({
            characters: {
                hero: {
                    displayName: 'Hero',
                    defaultVariant: 'default',
                    baseSprites: ['assets/sprites/hero_neutral.webp'],
                    neutralSprites: ['assets/sprites/hero_neutral.webp'],
                    variantData: {}
                },
                hired_sword: {
                    displayName: 'Hired Sword',
                    defaultVariant: 'default',
                    baseSprites: ['assets/sprites/generic_npc_neutral.webp'],
                    neutralSprites: ['assets/sprites/generic_npc_neutral.webp'],
                    variantData: {}
                }
            },
            lookups: { byAlias: {}, byFirstName: {} }
        }),
        findCharacterSprite: async name => ({
            assetPath: name === 'Hired Sword'
                ? 'assets/sprites/generic_npc_neutral.webp'
                : ''
        })
    };
    logic.resolveCharacterImportance = async () => '';

    const result = await logic.resolveTravelPartySprites({
        input: { playerCharacterName: 'Hero Alias' },
        output: { sequence: [] },
        runtime: {}
    }, ['Hero Alias', 'Hired Sword']);

    assert.deepEqual(result, [{
        name: 'Hero',
        spritePath: 'assets/sprites/hero_neutral.webp',
        isPlayer: true
    }]);
});

test('map location data identifies the player and trusts unclassified party members', async () => {
    const logic = makeLogic();
    logic.tools.plugins = {
        isInstalled: id => id === 'character_classifier',
        call: async () => null
    };
    logic.tools.db = {
        chat: { query: async () => [] }
    };
    logic.resolveCharacterImportance = async () => '';
    logic.getCurrentLocation = async () => ({
        x: 125,
        y: -75,
        name: 'Road to Town B',
        specific_location: 'Road to Town B',
        anchor: 'Town A'
    });
    logic.getCharacterLocation = async name => ({
        x: 125,
        y: -75,
        specific_location: 'Road to Town B',
        anchor_node: 'Town A',
        context: `${name} is traveling with the party.`
    });
    logic.resolveTravelPartySprites = async (_context, names) => names.map(name => ({
        name,
        spritePath: `assets/sprites/${name.toLowerCase()}_neutral.webp`
    }));

    const locations = await logic.getAllCharacterLocations({
        projectName: 'test',
        turnNumber: 12,
        input: { playerCharacterName: 'Hero' },
        output: {
            party: ['Friend'],
            characterIcons: {}
        }
    });

    assert.deepEqual(locations.map(location => location.name), ['Hero', 'Friend']);
    assert.ok(locations.every(location => location.isPartyMember === true));
    assert.ok(locations.every(location => location.isCore === true));
    assert.equal(locations[0].isPlayer, true);
    assert.equal(locations[1].isPlayer, false);
    assert.equal(locations[0].spritePath, 'assets/sprites/hero_neutral.webp');
    assert.equal(locations[0].x, 125);
    assert.equal(locations[0].y, -75);

    logic.getCharacterLocation = async () => null;
    const fallbackLocations = await logic.getAllCharacterLocations({
        projectName: 'test',
        turnNumber: 12,
        input: { playerCharacterName: 'Hero' },
        output: {
            party: ['Friend'],
            characterIcons: {}
        }
    });
    const friend = fallbackLocations.find(location => location.name === 'Friend');
    assert.equal(friend?.specificLocation, 'Road to Town B');
    assert.equal(friend?.spritePath, 'assets/sprites/friend_neutral.webp');
});

test('navigation v4 normalizes user map-point orders without exposing legacy states', () => {
    const state = navigationCopilot.normalizeNavigationState({
        version: 3,
        status: 'active',
        active_target: { name: 'Forest northwest of Town A', map_status: 'map_point', x: 125.126, y: -88.884 },
        manual_order: {
            id: 'order-1', mode: 'planned', status: 'active', authorized: true,
            reason: '  Warn   the village.  ',
            target: { name: 'Forest northwest of Town A', map_status: 'map_point', x: 125.126, y: -88.884 }
        }
    });
    assert.equal(state.version, 4);
    assert.equal(state.active_target.map_status, 'map_point');
    assert.deepEqual({ x: state.active_target.x, y: state.active_target.y }, { x: 125.13, y: -88.88 });
    assert.equal(state.manual_order.source, 'user_map');
    assert.equal(state.manual_order.reason, 'Warn the village.');
});

test('manual movement policy is project-scoped and round-trips through project settings', async () => {
    const logic = makeLogic();
    let stored = null;
    logic.tools.db = { project: {
        query: async () => stored === null ? [] : [{ setting_value: stored }],
        execute: async (_sql, params) => { stored = params[1]; }
    } };
    assert.equal((await logic.getManualMovementPolicy()).manual_movement_only, false);
    assert.equal((await logic.setManualMovementPolicy(true)).manual_movement_only, true);
    assert.equal(JSON.parse(stored).enabled, true);
});

test('manual movement lock clamps unauthorized departures but permits the active user route', () => {
    const logic = makeLogic();
    const start = atTownA(logic);
    const event = { status: 'TRANSIT', destination: 'Town B', distance_traveled_km: 10 };
    assert.equal(logic.shouldClampMovementEvent(event, start, navigationCopilot.emptyNavigationState()), true);

    const authorized = navigationCopilot.normalizeNavigationState({
        status: 'active',
        active_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        manual_order: {
            id: 'order-2', status: 'active', authorized: true,
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    assert.equal(logic.shouldClampMovementEvent(event, start, authorized), false);
    const clamped = logic.clampMovementEvent(event, start);
    assert.equal(clamped.status, 'STAYED');
    assert.equal(clamped.distance_traveled_km, 0);
});

test('manual route previews are deterministic, LLM-free, and stale after the pin changes', async () => {
    const logic = makeLogic();
    const context = { turnNumber: 7, runtime: {} };
    let current = atTownA(logic);
    logic.loadWorldData = async () => {};
    logic.getLoadedOperationalStatus = () => ({ active: true });
    logic.getCurrentLocation = async () => current;
    logic.tools.llm = { json: async () => { throw new Error('Manual previews must not call an LLM.'); } };
    logic.analyzeBiomeRouteBetweenCoordinates = async (_context, start, end) => ({
        enabled: true,
        routes: [{
            id: 'straight', title: 'Direct', mode_label: 'straight', distanceKm: 100,
            direction: 'E', text: 'Travel east.', debug_path: [start, end], notes: [], runs: []
        }]
    });
    const preview = await logic.previewManualDestination(context, { node_uid: 'b' });
    assert.equal(preview.routes.length, 1);
    assert.equal(preview.target.name, 'Town B');
    current = { ...current, x: 10 };
    await assert.rejects(
        logic.getValidatedManualPreview(context, preview.preview_id, 'straight'),
        /position or world map changed/i
    );
});

test('instant map points adopt the nearest anchor and snap within one percent of world scale', () => {
    const logic = makeLogic();
    const nearTownB = {
        uid: null, name: 'Wilderness near Town B', map_status: 'map_point',
        x: 995, y: 0,
        nearest_node: { uid: 'b', name: 'Town B', distance_km: 0.5, direction: 'E' }
    };
    const snapped = logic.resolveInstantArrivalTarget(nearTownB);
    assert.equal(snapped.map_status, 'mapped');
    assert.equal(snapped.name, 'Town B');
    assert.equal(snapped.x, 1000);
    assert.equal(logic.resolveManualArrivalAnchor(snapped, atTownA(logic)), 'Town B');

    const fartherPoint = {
        ...nearTownB,
        x: 950,
        name: 'Wilderness west of Town B'
    };
    const unsnapped = logic.resolveInstantArrivalTarget(fartherPoint);
    assert.equal(unsnapped.map_status, 'map_point');
    assert.equal(unsnapped.x, 950);
    assert.equal(logic.resolveManualArrivalAnchor(unsnapped, atTownA(logic)), 'Town B');

    const aligned = logic.alignManualRouteToTarget({
        distance_km: 100,
        corridor: [{ x: 0, y: 0 }, { x: 995, y: 0 }]
    }, nearTownB, snapped);
    assert.deepEqual(aligned.corridor.at(-1), { x: 1000, y: 0 });

});

test('saving a manual route stages intent without granting authority or moving coordinates', async () => {
    const logic = makeLogic();
    const context = { turnNumber: 8, runtime: {}, output: {}, processed: { vnManager: { processedLines: [{}] } } };
    const start = atTownA(logic);
    logic.loadWorldData = async () => {};
    logic.getCurrentLocation = async () => start;
    let savedState = null;
    logic.persistNavigationState = async (_context, state) => { savedState = navigationCopilot.normalizeNavigationState(state); return savedState; };
    let savedOrder = null;
    logic.appendManualOrderFact = async (_context, order, factContext) => { savedOrder = { order, factContext }; };
    const preview = {
        id: 'preview-1', turn_number: 8, created_at: Date.now(), origin: { x: 0, y: 0 },
        target: { ...navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), x: 1000, y: 0 },
        signature: await logic.buildManualValidationSignature(start),
        routes: [{ id: 'straight', title: 'Direct', mode_label: 'straight', distance_km: 100, duration: 'about 3 days', summary: 'Go east.', requirements: [], stops: [], corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }]
    };
    logic.getManualPreviewStore(context).set(preview.id, preview);
    const result = await logic.commitManualDestination(context, {
        preview_id: preview.id,
        route_id: 'straight',
        mode: 'planned',
        reason: '  Warn   Town B before the storm. '
    });
    assert.equal(result.order.status, 'pending_send');
    assert.equal(result.order.authorized, false);
    assert.equal(result.staged, true);
    assert.equal(savedState, null);
    assert.equal(savedOrder.factContext, 'user_map_pending_send');
    assert.equal(savedOrder.order.reason, 'Warn Town B before the storm.');
    assert.equal(savedOrder.order.route.title, 'Direct');
    assert.deepEqual(savedOrder.order.route.corridor, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    assert.deepEqual(start, atTownA(logic));
});

test('Send activation turns a staged planned order into canonical navigation without moving the pin', async () => {
    const logic = makeLogic();
    const start = atTownA(logic);
    const pending = navigationCopilot.normalizeManualOrder({
        id: 'pending-plan', source: 'user_map', mode: 'planned', status: 'pending_send', authorized: false,
        issued_turn: 8, target: { ...navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), x: 1000, y: 0 },
        travelers: ['Hero', 'Scout'], reason: 'Warn the town.',
        route: {
            id: 'straight', title: 'Direct', mode_label: 'straight', distance_km: 100,
            duration: 'about 3 days', summary: 'Go east.', requirements: [], stops: [],
            origin: { x: 0, y: 0 }, corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        }
    });
    logic.getPendingManualOrder = async () => pending;
    logic.getCurrentLocation = async () => start;
    logic.getNavigationTimelineForContext = async () => [];
    let savedState = null;
    logic.persistNavigationState = async (_context, state) => { savedState = navigationCopilot.normalizeNavigationState(state); return savedState; };
    logic.persistManualNavigationTimeline = async () => {};
    logic.appendManualOrderFact = async () => {};

    const result = await logic.activatePendingManualOrder({ turnNumber: 9, runtime: {}, output: {}, processed: { vnManager: { processedLines: [{}] } } });
    assert.equal(result.order.status, 'active');
    assert.equal(result.order.authorized, true);
    assert.deepEqual(result.order.travelers, ['Hero', 'Scout']);
    assert.equal(savedState.journey_plan.selection_source, 'user_map');
    assert.equal(savedState.manual_order.reason, 'Warn the town.');
    assert.deepEqual(start, atTownA(logic));
});

test('instant travel activates only at Send and moves only selected character facts', async () => {
    const logic = makeLogic();
    const pending = navigationCopilot.normalizeManualOrder({
        id: 'pending-instant', source: 'user_map', mode: 'instant', status: 'pending_send', authorized: false,
        issued_turn: 10, target: { ...navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), x: 1000, y: 0 },
        travelers: ['Hero'],
        route: { title: 'Direct', distance_km: 100, duration: 'about 3 days', requirements: [], stops: [], origin: { x: 0, y: 0 }, corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }
    });
    logic.getPendingManualOrder = async () => pending;
    let arrivalTravelers = null;
    logic.persistManualArrival = async (_context, _preview, _route, _id, travelers) => {
        arrivalTravelers = travelers;
        return logic.buildLocationStateFromEvent({ status: 'ARRIVED', anchor_node: 'Town B', specific_location: 'Town B' });
    };
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    logic.persistManualNavigationTimeline = async () => {};
    logic.appendManualOrderFact = async () => {};
    logic.createPendingTimeskipDirective = async (_context, _preview, _route, _id, _reason, travelers) => ({ id: 'pending-instant', travelers });

    const context = { turnNumber: 11, runtime: {}, output: {}, processed: { vnManager: { processedLines: [{}] } } };
    const first = await logic.activatePendingManualOrder(context);
    const retry = await logic.activatePendingManualOrder(context);
    assert.equal(first.order.status, 'completed');
    assert.equal(first.navigation_state.status, 'awaiting_intent');
    assert.equal(first.navigation_state.journey_plan, null);
    assert.equal(first.navigation_state.journey_target, null);
    assert.deepEqual(arrivalTravelers, ['Hero']);
    assert.equal(retry, first);
    assert.deepEqual(first.directive.travelers, ['Hero']);
    assert.match(navigationCopilot.buildNavigationPromptText(first.navigation_state), /No broader journey is currently established/i);
});

test('post-Writer KEEP cannot resurrect or silence a broader journey cleared by instant arrival', async () => {
    const logic = makeLogic();
    const arrived = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        last_reached_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        manual_order: {
            id: 'instant-cleared', source: 'user_map', mode: 'instant', status: 'completed',
            authorized: true, target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    logic.persistNavigationState = async (_context, state) => navigationCopilot.normalizeNavigationState(state);
    const result = await logic.updateLayeredNavigationCopilot(
        { turnNumber: 15 },
        {
            journey: { operation: 'KEEP' },
            immediate: { operation: 'KEEP' },
            deliberation: { operation: 'KEEP' }
        },
        arrived,
        logic.buildLocationStateFromEvent({ status: 'ARRIVED', anchor_node: 'Town B', specific_location: 'Town B' })
    );
    assert.equal(result.status, 'awaiting_intent');
    assert.equal(result.journey_target, null);
    assert.equal(result.journey_plan, null);
    assert.match(navigationCopilot.buildNavigationPromptText(result), /Do not resume a previous route automatically/i);
});

test('instant arrival directives are coordinate-free, next-turn, and retry consumable', async () => {
    const logic = makeLogic();
    const appended = [];
    logic.tools.facts = { appendToFactsDb: async fact => appended.push(fact) };
    const directive = await logic.createPendingTimeskipDirective(
        { turnNumber: 9 },
        { target: { name: 'Town B' } },
        { distance_km: 100, duration: 'about 3 days' },
        'order-3',
        'Find the missing caravan.'
    );
    assert.match(directive.text, /user explicitly advanced the story/i);
    assert.match(directive.text, /Town B/);
    assert.match(directive.text, /reason.*Find the missing caravan/i);
    assert.doesNotMatch(directive.text, /\(-?\d+\s*,\s*-?\d+\)/);
    await logic.markTimeskipDirectiveConsumed({ turnNumber: 10 }, directive.id);
    assert.equal(appended[1].predicate, 'manual_timeskip_consumed:order-3');
});

test('completed instant orders remain available to the current-turn input banner', () => {
    const logic = makeLogic();
    const payload = logic.buildNavigationMapPayload({
        status: 'idle',
        manual_order: {
            id: 'instant-1', source: 'user_map', mode: 'instant', status: 'completed',
            issued_turn: 12, reason: 'Reach the festival before sunset.',
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            route: {
                distance_km: 100,
                duration: 'about 3 days',
                corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
            },
            rollback: { location: atTownA(logic), navigation_state: navigationCopilot.emptyNavigationState() }
        }
    }, atTownA(logic));
    assert.equal(payload.journey, null);
    assert.equal(payload.immediate, null);
    assert.equal(payload.manual_order.mode, 'instant');
    assert.equal(payload.manual_order.reason, 'Reach the festival before sunset.');
    assert.equal(payload.manual_order.issued_turn, 12);
    assert.equal(payload.manual_order.undo_available, true);
    assert.deepEqual(payload.manual_order.route.corridor, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
});

test('normalization preserves new broader routes after completed instant arrivals', () => {
    const logic = makeLogic();
    const nextJourney = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        journey_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town C')),
        journey_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town C')),
            corridor: [{ x: 0, y: 0 }, { x: 0, y: -1000 }]
        },
        manual_order: {
            id: 'instant-stale', source: 'user_map', mode: 'instant', status: 'completed',
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    assert.equal(nextJourney.status, 'awaiting_intent');
    assert.equal(nextJourney.journey_target.name, 'Town C');
    assert.equal(nextJourney.journey_plan.destination.name, 'Town C');
    assert.equal(nextJourney.journey_plan.corridor.length, 2);
    assert.equal(nextJourney.last_reached_target.name, 'Town B');
});

test('normalization removes routes that belong to completed instant arrivals', () => {
    const logic = makeLogic();
    const completed = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        active_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        journey_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        },
        active_leg_plan: {
            destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
        },
        manual_order: {
            id: 'instant-completed', source: 'user_map', mode: 'instant', status: 'completed',
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    assert.equal(completed.status, 'awaiting_intent');
    assert.equal(completed.journey_target, null);
    assert.equal(completed.active_target, null);
    assert.equal(completed.journey_plan, null);
    assert.equal(completed.active_leg_plan, null);
    assert.equal(completed.last_reached_target.name, 'Town B');
});

test('pending manual intent is renderable on the map while canonical navigation stays idle', () => {
    const logic = makeLogic();
    const payload = logic.buildNavigationMapPayload({
        status: 'idle',
        manual_order: {
            id: 'pending-map-1', source: 'user_map', mode: 'instant', status: 'pending_send',
            authorized: false, issued_turn: 12, travelers: ['Hero'],
            target: { ...navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), x: 1000, y: 0 },
            route: { distance_km: 100, corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }
        }
    }, atTownA(logic));
    assert.equal(payload.status, 'idle');
    assert.equal(payload.journey, null);
    assert.equal(payload.immediate, null);
    assert.equal(payload.manual_order.status, 'pending_send');
    assert.deepEqual(payload.manual_order.travelers, ['Hero']);
    assert.deepEqual(payload.manual_order.route.corridor, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
});

test('pending manual intent can be cancelled before Send without changing navigation state', async () => {
    const logic = makeLogic();
    const pending = navigationCopilot.normalizeManualOrder({
        id: 'pending-cancel-1', source: 'user_map', mode: 'instant', status: 'pending_send',
        authorized: false, issued_turn: 13,
        target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
    });
    const existing = navigationCopilot.normalizeNavigationState({ status: 'awaiting_intent' });
    logic.loadWorldData = async () => {};
    logic.getPendingManualOrder = async () => pending;
    logic.getNavigationStateForContext = async () => existing;
    let savedOrder = null;
    logic.appendManualOrderFact = async (_context, order, factContext) => { savedOrder = { order, factContext }; };
    const result = await logic.cancelManualNavigationOrder({ turnNumber: 13 });
    assert.equal(result.order.status, 'cancelled');
    assert.equal(result.navigation_state.status, 'awaiting_intent');
    assert.equal(savedOrder.factContext, 'user_map_pending_cancelled');
});

test('a completed canonical instant arrival suppresses its stale pending order', async () => {
    const logic = makeLogic();
    const target = navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'));
    const pending = navigationCopilot.normalizeManualOrder({
        id: 'sticky-order', source: 'user_map', mode: 'instant', status: 'pending_send',
        issued_turn: 16, target
    });
    const completed = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        manual_order: {
            ...pending,
            status: 'completed',
            authorized: true,
            activated_turn: 17,
            completed_turn: 17
        },
        last_reached_target: target
    });
    assert.equal(logic.isPendingManualOrderSuperseded(pending, completed), true);
    assert.equal(logic.isPendingManualOrderFulfilledByLocation(pending, {
        x: 1000, y: 0, manual_order_id: 'sticky-order'
    }, 18), true);
    logic.getPendingManualOrder = async () => pending;
    logic.getCurrentLocation = async () => ({ x: 1000, y: 0, manual_order_id: 'sticky-order' });
    logic.getNavigationStateForContext = async () => completed;
    assert.equal(await logic.activatePendingManualOrder({ turnNumber: 18, runtime: {} }), null);
});

test('cancelling an active manual journey clears route authority without moving the pin', async () => {
    const logic = makeLogic();
    const start = atTownA(logic);
    const active = navigationCopilot.normalizeNavigationState({
        status: 'active',
        journey_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        active_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
        journey_plan: { destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
        active_leg_plan: { destination: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')), corridor: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
        manual_order: {
            id: 'planned-1', source: 'user_map', mode: 'planned', status: 'active', authorized: true,
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B'))
        }
    });
    logic.loadWorldData = async () => {};
    logic.getNavigationStateForContext = async () => active;
    let saved = null;
    let fact = null;
    logic.persistNavigationState = async (_context, state) => { saved = navigationCopilot.normalizeNavigationState(state); return saved; };
    logic.persistManualNavigationTimeline = async () => {};
    logic.appendManualOrderFact = async (_context, order, factContext) => { fact = { order, factContext }; };
    const result = await logic.cancelManualNavigationOrder({ turnNumber: 13 });
    assert.equal(result.order.status, 'cancelled');
    assert.equal(result.order.authorized, false);
    assert.equal(saved.status, 'idle');
    assert.equal(saved.journey_plan, null);
    assert.equal(saved.active_target, null);
    assert.equal(fact.factContext, 'user_map_navigation_cancelled');
    assert.deepEqual(start, atTownA(logic));
});

test('same-turn instant arrival undo restores its private rollback snapshot and consumes the timeskip', async () => {
    const logic = makeLogic();
    const previousNavigation = navigationCopilot.normalizeNavigationState({
        status: 'awaiting_intent',
        last_reached_target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town A'))
    });
    const state = navigationCopilot.normalizeNavigationState({
        status: 'idle',
        manual_order: {
            id: 'instant-undo-1', source: 'user_map', mode: 'instant', status: 'completed',
            issued_turn: 14, authorized: true,
            target: navigationCopilot.nodeRef(logic.findWorldNodeByName('Town B')),
            rollback: { location: atTownA(logic), navigation_state: previousNavigation }
        }
    });
    logic.loadWorldData = async () => {};
    logic.getNavigationStateForContext = async () => state;
    logic.persistManualRollbackLocation = async (_context, snapshot) => snapshot;
    let restored = null;
    logic.persistNavigationState = async (_context, next, options) => {
        assert.equal(options.allowUserRollback, true);
        restored = navigationCopilot.normalizeNavigationState(next);
        return restored;
    };
    logic.persistManualNavigationTimeline = async () => {};
    let historicalOrder = null;
    logic.appendManualOrderFact = async (_context, order, factContext) => { historicalOrder = { order, factContext }; };
    let consumed = null;
    logic.markTimeskipDirectiveConsumed = async (_context, id) => { consumed = id; };

    const result = await logic.undoManualInstantArrival({ turnNumber: 14 });
    assert.equal(result.location.anchor_node, 'Town A');
    assert.equal(restored.status, 'awaiting_intent');
    assert.equal(historicalOrder.order.status, 'cancelled');
    assert.equal(historicalOrder.factContext, 'user_map_instant_arrival_undone');
    assert.equal(consumed, 'instant-undo-1');
});

test('location update brief reports accepted movement before its reasoning', () => {
    const logic = makeLogic();
    const brief = logic.buildLocationUpdateBrief([{
        line: 3,
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 12,
        reasoning: 'The chapter explicitly began the journey.'
    }]);

    assert.match(brief, /Recorded the party in transit toward Town B after 12 km of travel/);
    assert.match(brief, /Reasoning: The chapter explicitly began the journey/);
    assert.ok(brief.indexOf('Recorded the party') < brief.indexOf('Reasoning:'));
});

test('miles setting changes new human-facing distance output while keeping mechanics in kilometres', () => {
    const logic = makeLogic();
    logic.settings.distance_unit = 'miles';
    const brief = logic.buildLocationUpdateBrief([{
        line: 1,
        status: 'TRANSIT',
        destination: 'Town B',
        distance_traveled_km: 100
    }]);
    assert.match(brief, /62 mi of travel/);
    assert.doesNotMatch(brief, /100 km/);
    assert.equal(logic.resolveTravelScale().pixelsPerKm, 10);
    assert.equal(Number(logic.getTravelMinDistanceKm().toFixed(2)), 40.23);
});
