const NAVIGATION_STATE_VERSION = 4;
const MAX_DELIBERATION_OPTIONS = 3;
const INTENT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_SIMPLE_MAP_SPAN_PERCENT = 5;
const MAX_CORRIDOR_POINTS = 256;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeText(value, maxLength = 4000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeGuidanceText(value, maxLength = 4000) {
    return normalizeText(value, maxLength)
        .replace(/\bx\s*[:=]\s*-?\d+(?:\.\d+)?\s*[,;]?\s*y\s*[:=]\s*-?\d+(?:\.\d+)?\b/gi, 'an internal map position')
        .replace(/\(?\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)?/g, 'an internal map position');
}

function normalizePositiveNumber(value, max = 3650) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Number(Math.min(numeric, max).toFixed(2));
}

function normalizeName(value) {
    return normalizeText(value, 300).toLowerCase();
}

function findNodeByName(nodes, name) {
    const target = normalizeName(name);
    if (!target) return null;
    return (nodes || []).find(node => normalizeName(node?.name) === target) || null;
}

function nodeRef(node) {
    if (!node) return null;
    return { uid: String(node.uid || ''), name: String(node.name || ''), map_status: 'mapped', candidates: [] };
}

function normalizeTarget(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const uid = normalizeText(raw.uid, 200) || null;
    const name = normalizeText(raw.name, 300);
    const inferred = uid ? 'mapped' : 'unmapped';
    const mapStatus = ['mapped', 'unmapped', 'ambiguous', 'map_point'].includes(raw.map_status)
        ? raw.map_status
        : inferred;
    const target = {
        ...raw,
        uid,
        name,
        map_status: mapStatus,
        candidates: Array.isArray(raw.candidates) ? raw.candidates.slice(0, 5) : []
    };
    if (mapStatus === 'map_point') {
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        target.x = Number(x.toFixed(2));
        target.y = Number(y.toFixed(2));
    }
    return target;
}

function normalizeManualOrder(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const target = normalizeTarget(raw.target);
    if (!target) return null;
    return {
        ...raw,
        id: normalizeText(raw.id, 200),
        source: 'user_map',
        mode: raw.mode === 'instant' ? 'instant' : 'planned',
        status: ['pending_send', 'active', 'completed', 'cancelled'].includes(raw.status) ? raw.status : 'active',
        target,
        selected_route_id: normalizeText(raw.selected_route_id || raw.route_id || 'direct', 200),
        issued_turn: Math.max(0, Math.round(Number(raw.issued_turn) || 0)),
        completed_turn: Number.isFinite(Number(raw.completed_turn)) ? Math.max(0, Math.round(Number(raw.completed_turn))) : null,
        authorized: raw.authorized !== false,
        reason: normalizeGuidanceText(raw.reason, 600),
        travelers: Array.isArray(raw.travelers)
            ? raw.travelers.map(name => normalizeText(name, 200)).filter(Boolean).slice(0, 24)
            : []
    };
}

function normalizeCorridor(points) {
    return downsampleCorridor(points, MAX_CORRIDOR_POINTS);
}

function normalizeWaypoints(points) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(points) ? points : []) {
        const uid = normalizeText(raw?.uid, 200);
        const name = normalizeText(raw?.name, 300);
        const key = uid || normalizeName(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({
            uid,
            name,
            purpose: normalizeGuidanceText(raw?.purpose, 500),
            status: ['pending', 'reached', 'skipped'].includes(raw?.status) ? raw.status : 'pending'
        });
    }
    return result.slice(0, 24);
}

function normalizeRoutePlan(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const corridor = normalizeCorridor(raw.corridor);
    const remainingCorridor = normalizeCorridor(
        Array.isArray(raw.remaining_corridor) && raw.remaining_corridor.length > 0
            ? raw.remaining_corridor
            : corridor
    );
    const status = ['active', 'suspended', 'awaiting', 'provisional', 'accepted'].includes(raw.status)
        ? raw.status
        : 'accepted';
    return {
        ...raw,
        destination: normalizeTarget(raw.destination),
        selected_route_id: normalizeText(raw.selected_route_id || raw.route_id || 'direct', 200),
        route_profile: raw.route_profile && typeof raw.route_profile === 'object'
            ? {
                id: normalizeText(raw.route_profile.id || raw.selected_route_id || raw.route_id || 'direct', 200),
                mode: normalizeText(raw.route_profile.mode || raw.route_profile.label, 300)
            }
            : {
                id: normalizeText(raw.selected_route_id || raw.route_id || 'direct', 200),
                mode: ''
            },
        summary: normalizeGuidanceText(raw.summary, 2500),
        waypoints: normalizeWaypoints(raw.waypoints),
        suggested_next_waypoint: raw.suggested_next_waypoint && typeof raw.suggested_next_waypoint === 'object'
            ? { ...raw.suggested_next_waypoint }
            : null,
        route_notes: (Array.isArray(raw.route_notes) ? raw.route_notes : [])
            .map(note => normalizeGuidanceText(note, 500))
            .filter(Boolean)
            .slice(0, 12),
        distance_km: normalizePositiveNumber(raw.distance_km, 100000),
        narrative_duration_days: normalizePositiveNumber(raw.narrative_duration_days),
        duration_label: normalizeGuidanceText(raw.duration_label || raw.duration, 200),
        corridor,
        remaining_corridor: remainingCorridor,
        status
    };
}

function emptyNavigationState() {
    return {
        version: NAVIGATION_STATE_VERSION,
        status: 'idle',
        journey_target: null,
        active_target: null,
        journey_plan: null,
        active_leg_plan: null,
        deliberation: null,
        last_reached_target: null,
        manual_order: null,
        last_operation: 'KEEP'
    };
}

function normalizeNavigationState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyNavigationState();
    const status = ['idle', 'active', 'awaiting_intent'].includes(raw.status) ? raw.status : 'idle';
    const activeTarget = normalizeTarget(raw.active_target);
    const journeyPlan = normalizeRoutePlan(raw.journey_plan);
    let activeLegPlan = normalizeRoutePlan(raw.active_leg_plan);
    const activeMatchesJourney = activeTarget && journeyPlan?.destination
        && normalizeName(activeTarget.name) === normalizeName(journeyPlan.destination.name);
    if (activeLegPlan && activeMatchesJourney && activeLegPlan.corridor.length < 2 && journeyPlan.corridor.length >= 2) {
        activeLegPlan = normalizeRoutePlan({ ...journeyPlan, ...activeLegPlan, corridor: journeyPlan.corridor, remaining_corridor: journeyPlan.remaining_corridor });
    }
    const normalized = {
        version: NAVIGATION_STATE_VERSION,
        status,
        journey_target: raw.journey_target && typeof raw.journey_target === 'object'
            ? normalizeTarget(raw.journey_target)
            : (journeyPlan?.destination ? { ...journeyPlan.destination } : null),
        active_target: activeTarget,
        journey_plan: journeyPlan,
        active_leg_plan: activeLegPlan,
        deliberation: raw.deliberation && typeof raw.deliberation === 'object'
            ? {
                ...raw.deliberation,
                options: Array.isArray(raw.deliberation.options)
                    ? raw.deliberation.options.slice(0, MAX_DELIBERATION_OPTIONS).map(option => ({ ...option }))
                    : []
            }
            : null,
        last_reached_target: raw.last_reached_target && typeof raw.last_reached_target === 'object' ? normalizeTarget(raw.last_reached_target) : null,
        manual_order: normalizeManualOrder(raw.manual_order),
        last_operation: ['KEEP', 'SET_JOURNEY', 'SET_LEG', 'CLEAR', 'COMPLETE'].includes(raw.last_operation) ? raw.last_operation : 'KEEP'
    };
    if (normalized.manual_order?.mode === 'instant' && normalized.manual_order.status === 'completed') {
        const completedUid = normalizeName(normalized.manual_order.target?.uid);
        const completedName = normalizeName(normalized.manual_order.target?.name);
        const matchesCompletedInstant = target => {
            const targetUid = normalizeName(target?.uid);
            const targetName = normalizeName(target?.name);
            return (!!targetUid && !!completedUid && targetUid === completedUid)
                || (!!targetName && !!completedName && targetName === completedName);
        };
        if (!normalized.journey_target || matchesCompletedInstant(normalized.journey_target)) {
            normalized.journey_target = null;
            normalized.journey_plan = null;
        }
        if (!normalized.active_target || matchesCompletedInstant(normalized.active_target)) {
            normalized.active_target = null;
            normalized.active_leg_plan = null;
        }
        normalized.status = normalized.active_target ? 'active' : 'awaiting_intent';
        normalized.deliberation = null;
        normalized.last_reached_target = normalized.last_reached_target || { ...normalized.manual_order.target };
        normalized.last_operation = 'COMPLETE';
    }
    return normalized;
}

function normalizeNavigationIntent(raw, nodes, threshold = INTENT_CONFIDENCE_THRESHOLD) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const operation = String(input.operation || 'KEEP').trim().toUpperCase();
    const confidenceValue = Number(input.confidence);
    const confidence = Number.isFinite(confidenceValue) ? clamp(confidenceValue, 0, 1) : 0;
    const evidenceLineValue = Number(input.evidence_line);
    const base = {
        operation: ['KEEP', 'SET_JOURNEY', 'SET_LEG', 'CLEAR', 'COMPLETE'].includes(operation) ? operation : 'KEEP',
        destination: null,
        evidence_line: Number.isFinite(evidenceLineValue) ? Math.max(0, Math.round(evidenceLineValue)) : 0,
        confidence,
        reasoning: normalizeText(input.reasoning, 1000)
    };

    if (base.operation === 'CLEAR' || base.operation === 'COMPLETE') return confidence >= threshold ? base : { ...base, operation: 'KEEP' };
    if (base.operation === 'KEEP' || confidence < threshold) return { ...base, operation: 'KEEP' };

    const grounding = input.destination_grounding && typeof input.destination_grounding === 'object'
        ? input.destination_grounding
        : null;
    if (grounding && ['unmapped', 'ambiguous'].includes(grounding.outcome)) {
        return {
            ...base,
            destination: {
                uid: null,
                name: normalizeText(input.destination_mention || input.destination, 300),
                map_status: grounding.outcome,
                candidates: Array.isArray(grounding.candidates) ? grounding.candidates.slice(0, 5) : []
            }
        };
    }
    const node = grounding?.selected_node || findNodeByName(nodes, input.destination || input.destination_mention);
    if (!node) return { ...base, operation: 'KEEP', reasoning: `${base.reasoning} Destination grounding was unavailable.`.trim() };
    return { ...base, destination: nodeRef(node) };
}

function downsampleCorridor(points, maxPoints = MAX_CORRIDOR_POINTS) {
    const source = Array.isArray(points) ? points.filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))) : [];
    if (source.length <= maxPoints) return source.map(point => ({ x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) }));
    const result = [];
    for (let index = 0; index < maxPoints; index += 1) {
        const sourceIndex = Math.round((index / (maxPoints - 1)) * (source.length - 1));
        const point = source[sourceIndex];
        result.push({ x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) });
    }
    return result;
}

function isSimpleCorridor(inspection, mapSpanPercent = DEFAULT_SIMPLE_MAP_SPAN_PERCENT) {
    const maxRatio = clamp(Number(mapSpanPercent) || DEFAULT_SIMPLE_MAP_SPAN_PERCENT, 1, 25) / 100;
    if (!inspection?.available) return false;
    return inspection.map_span_ratio <= maxRatio
        && !inspection.needs_boat
        && !inspection.slows_down
        && !inspection.has_river
        && !inspection.uncertain;
}

function buildSimpleSummary(destinationName, direction, inspection, terrainVerified = true) {
    const terrain = (inspection?.runs || []).map(run => run.label).filter(Boolean);
    const uniqueTerrain = [...new Set(terrain)];
    const terrainText = uniqueTerrain.length ? ` through ${uniqueTerrain.join(' and ')}` : '';
    const roadText = inspection?.has_road ? ', using the marked road where available' : '';
    const verificationText = terrainVerified
        ? ' No difficult crossing or slowed terrain is currently known.'
        : ' Terrain details are unavailable, so this direct guidance is provisional.';
    return `Travel ${direction || 'directly'} toward ${destinationName}${terrainText}${roadText}.${verificationText}`;
}

function routeNames(route) {
    const names = new Set();
    for (const collection of [route?.journey_stops, route?.suggested_stops, route?.nearby_pois]) {
        for (const item of collection || []) {
            const name = normalizeName(typeof item === 'string' ? item : item?.name);
            if (name) names.add(name);
        }
    }
    return names;
}

function chooseFallbackRoute(routes) {
    const candidates = (routes || []).filter(route => route && Number.isFinite(Number(route.distanceKm)));
    const nonBoat = candidates.filter(route => !route.has_boat_required);
    const pool = nonBoat.length ? nonBoat : candidates;
    return pool.sort((left, right) => Number(left.distanceKm) - Number(right.distanceKm))[0] || null;
}

function normalizePlannerResult(raw, routes, nodes, destinationNode) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const selectedRoute = (routes || []).find(route => String(route.id) === String(input.selected_route_id));
    if (!selectedRoute) return null;

    const allowedNames = routeNames(selectedRoute);
    allowedNames.add(normalizeName(destinationNode?.name));
    const worldNodes = new Map((nodes || []).map(node => [normalizeName(node.name), node]));
    const waypoints = [];
    for (const waypoint of Array.isArray(input.waypoints) ? input.waypoints : []) {
        const key = normalizeName(waypoint?.name);
        const node = worldNodes.get(key);
        if (!node || !allowedNames.has(key) || waypoints.some(entry => entry.uid === node.uid)) continue;
        waypoints.push({ uid: String(node.uid || ''), name: node.name, purpose: normalizeGuidanceText(waypoint.purpose, 500) });
    }

    const suggestedKey = normalizeName(input.suggested_next_waypoint);
    const suggestedNode = allowedNames.has(suggestedKey) ? worldNodes.get(suggestedKey) : null;
    return {
        selectedRoute,
        summary: normalizeGuidanceText(input.summary, 2500) || normalizeGuidanceText(selectedRoute.text, 2500),
        waypoints,
        suggested_next_waypoint: suggestedNode ? nodeRef(suggestedNode) : null,
        requirements: (Array.isArray(input.requirements) ? input.requirements : [])
            .map(value => normalizeGuidanceText(value, 500))
            .filter(Boolean)
            .slice(0, 8),
        narrative_duration_days: normalizePositiveNumber(input.narrative_duration_days),
        duration_label: normalizeGuidanceText(input.duration_label, 200),
        reasoning: normalizeText(input.reasoning, 1500)
    };
}

function buildNavigationPromptText(rawState) {
    const state = normalizeNavigationState(rawState);
    if (state.status === 'idle' && !state.active_target && !state.journey_plan && !state.deliberation?.options?.length) return '';

    const lines = ['ACTIVE NAVIGATION ASSISTANCE', ''];
    if (state.journey_plan?.destination?.name) {
        lines.push(`Accepted broader plan: Reach ${state.journey_plan.destination.name}.`);
        if (state.journey_plan.summary) lines.push(normalizeGuidanceText(state.journey_plan.summary, 2500));
        lines.push('');
    }

    if (state.manual_order?.status === 'active') {
        lines.push('This navigation order was explicitly selected by the user on the world map. Treat its destination and chosen route as authoritative until the user cancels it or later narrative establishes arrival.');
        if (state.manual_order.travelers?.length) lines.push(`Traveling group selected by the user: ${state.manual_order.travelers.join(', ')}.`);
        if (state.manual_order.reason) lines.push(`User's stated reason for this journey: ${state.manual_order.reason}`);
        lines.push('');
    }

    if (state.status === 'awaiting_intent') {
        if (state.last_reached_target?.name) lines.push(`The party has reached ${state.last_reached_target.name}.`);
        if (!state.journey_plan && !state.journey_target) {
            lines.push('No broader journey is currently established. Do not resume a previous route automatically. If further travel matters, let the narrative explicitly establish a new destination.');
        }
        const suggested = state.journey_plan?.suggested_next_waypoint?.name;
        if (suggested) lines.push(`A likely next waypoint is ${suggested}, but it is not active travel intent yet.`);
        lines.push('Wait for the narrative to establish the next immediate destination before advancing the journey.');
        if (!state.deliberation?.options?.length) return lines.join('\n').trim();
    }

    if (state.active_target?.name) {
        lines.push(`Immediate travel intent: Reach ${state.active_target.name}.`);
        if (state.active_target.map_status === 'unmapped') {
            lines.push('This destination is not represented by a mapped node, so no map-based route or mechanical displacement is proposed. Use the narrative as authority while retaining the last confirmed map reference.');
        } else if (state.active_target.map_status === 'ambiguous') {
            const candidates = (state.active_target.candidates || []).map(candidate => candidate.name).filter(Boolean);
            lines.push(`This reference is not grounded to one mapped node${candidates.length ? `; plausible interpretations include ${candidates.join(', ')}` : ''}. No route is selected, and the narrative should determine the intended place.`);
        }
        const repeatsJourneySummary = state.journey_plan?.destination?.name === state.active_target.name
            && state.journey_plan?.summary === state.active_leg_plan?.summary;
        if (state.active_leg_plan?.summary && !repeatsJourneySummary) {
            lines.push('', 'Recommended current leg:', normalizeGuidanceText(state.active_leg_plan.summary, 2500));
        }
    }

    if (state.active_target?.map_status === 'mapped') {
        lines.push('', 'Continuity guidance: This is the tracker\'s current route recommendation based on established narrative intent. Revise it whenever later narrative establishes a different direction.');
    }

    if (state.deliberation?.options?.length) {
        lines.push('', 'TRAVEL OPTIONS UNDER DISCUSSION', '', 'The party has not committed to one of these researched alternatives:');
        for (const option of state.deliberation.options) {
            const supporters = Array.isArray(option.supporters) ? option.supporters.filter(Boolean) : [];
            const opponents = Array.isArray(option.opponents) ? option.opponents.filter(Boolean) : [];
            const attribution = [
                supporters.length ? `proposed or supported by ${supporters.join(', ')}` : '',
                opponents.length ? `opposed by ${opponents.join(', ')}` : ''
            ].filter(Boolean).join('; ');
            lines.push('', `${option.target?.name || 'Unresolved destination'}${attribution ? ` (${attribution})` : ''}:`);
            if (option.route_plan?.summary) {
                lines.push(normalizeGuidanceText(option.route_plan.summary, 1800));
                if (option.route_plan.route_notes?.length) lines.push(`Known concerns: ${option.route_plan.route_notes.join('; ')}.`);
            } else if (option.target?.map_status === 'unmapped') {
                lines.push('This is a valid narrative destination but is not represented by a mapped node, so no map route is available.');
            } else {
                lines.push('The reference is not grounded to one mapped node, so no route has been selected.');
            }
        }
        lines.push('', 'These are researched alternatives, not an accepted destination. Do not choose between them on the tracker\'s behalf; let subsequent narrative establish the decision.');
    }
    return lines.join('\n').trim();
}

module.exports = {
    NAVIGATION_STATE_VERSION,
    INTENT_CONFIDENCE_THRESHOLD,
    DEFAULT_SIMPLE_MAP_SPAN_PERCENT,
    MAX_CORRIDOR_POINTS,
    MAX_DELIBERATION_OPTIONS,
    emptyNavigationState,
    normalizeNavigationState,
    normalizeNavigationIntent,
    normalizeRoutePlan,
    normalizeWaypoints,
    downsampleCorridor,
    isSimpleCorridor,
    buildSimpleSummary,
    chooseFallbackRoute,
    normalizePlannerResult,
    buildNavigationPromptText,
    findNodeByName,
    nodeRef,
    normalizeTarget,
    normalizeManualOrder
};
