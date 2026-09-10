const fs = require('fs/promises');
const path = require('path');

const PLUGIN_ID = 'world_simulator';
const RUN_PREDICATE = 'SIMULATION_RUN';
const SUCCESS_STATUSES = new Set(['APPLIED', 'NO_VALID_CHANGES', 'NO_TARGETS']);
const SIMULATION_PROMPT_PATH = path.join(__dirname, 'prompts', 'simulation_prompt.txt');

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function compactText(value, maxLength = 900) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function parsePositiveInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function logInfo(tools, message) {
    if (tools?.logger?.log) tools.logger.log('WorldSimulator', message);
    else if (tools?.logger?.runtime) tools.logger.runtime(`[WorldSimulator] ${message}`);
}

function logWarn(tools, message) {
    if (tools?.logger?.warn) tools.logger.warn('WorldSimulator', message);
    else logInfo(tools, `WARN: ${message}`);
}

function logError(tools, message) {
    if (tools?.logger?.error) tools.logger.error('WorldSimulator', message);
    else logInfo(tools, `ERROR: ${message}`);
}

function getTurnNumber(turnContext, tools) {
    return Number.isInteger(Number(turnContext?.turnNumber))
        ? Number(turnContext.turnNumber)
        : Number(tools?.turnContext?.turnNumber || 0);
}

function getSettings(settings = {}) {
    return {
        model_def: settings.model_def || { model: 'highendmodel' },
        update_interval: parsePositiveInt(settings.update_interval, 3, 1, 30),
        character_update_limit: parsePositiveInt(settings.character_update_limit, 3, 0, 12),
        location_event_limit: parsePositiveInt(settings.location_event_limit, 3, 0, 12),
        prompt_event_limit: parsePositiveInt(settings.prompt_event_limit, 6, 0, 20),
        history_depth: parsePositiveInt(settings.history_depth, 6, 1, 20),
        retries: parsePositiveInt(settings.retries, 1, 0, 5),
        request_timeout_ms: parsePositiveInt(settings.request_timeout_ms, 120000, 15000, 600000),
        force_update: settings.force_update === true
    };
}

async function getLastSuccessfulRunTurn(turnContext, tools) {
    const projectName = normalizeKey(turnContext?.projectName || tools.turnContext?.projectName);
    if (!projectName) return 0;

    const rows = await tools.db.chat.query(
        `SELECT turn_number, fact_value
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND target = 'scheduler'
           AND predicate = ?
           AND turn_number <= ?
         ORDER BY turn_number DESC, id DESC
         LIMIT 20`,
        [projectName, PLUGIN_ID, RUN_PREDICATE, getTurnNumber(turnContext, tools)]
    );

    for (const row of rows || []) {
        try {
            const payload = JSON.parse(row.fact_value || '{}');
            if (SUCCESS_STATUSES.has(payload.status)) return Number(row.turn_number || 0);
        } catch {
            // Ignore malformed older rows.
        }
    }
    return 0;
}

async function shouldRunSimulation(turnContext, tools, settings) {
    const turnNumber = getTurnNumber(turnContext, tools);
    if (turnNumber < 1) return { run: false, reason: 'invalid_turn', turnNumber, lastRunTurn: 0 };
    if (settings.force_update) return { run: true, reason: 'force_update', turnNumber, lastRunTurn: 0 };

    const lastRunTurn = await getLastSuccessfulRunTurn(turnContext, tools);
    const turnsSince = Math.max(0, turnNumber - lastRunTurn);
    if (turnsSince < settings.update_interval) {
        return { run: false, reason: 'interval_not_reached', turnNumber, lastRunTurn };
    }
    return { run: true, reason: 'interval_reached', turnNumber, lastRunTurn };
}

async function recordRun(turnContext, tools, payload) {
    const turnNumber = getTurnNumber(turnContext, tools);
    await tools.facts.appendToFactsDb({
        source: PLUGIN_ID,
        target: 'scheduler',
        predicate: RUN_PREDICATE,
        fact_value: JSON.stringify({
            schema: 'world_simulator_run_v1',
            status: payload.status || 'UNKNOWN',
            selected_characters: payload.selected_characters || [],
            selected_locations: payload.selected_locations || [],
            saved_character_updates: payload.saved_character_updates || 0,
            saved_location_events: payload.saved_location_events || 0,
            skipped_operations: payload.skipped_operations || 0,
            reason: payload.reason || '',
            turn: turnNumber
        }),
        context: payload.context || null
    }, { turn_number: turnNumber });
}

async function getSimulationTouchMaps(turnContext, tools) {
    const projectName = normalizeKey(turnContext?.projectName || tools.turnContext?.projectName);
    const turnNumber = getTurnNumber(turnContext, tools);
    if (!projectName) return { characters: new Map(), locations: new Map() };

    const rows = await tools.db.chat.query(
        `SELECT source, target, predicate, MAX(turn_number) AS latest_turn
         FROM facts
         WHERE project_name = ?
           AND context = 'world_simulator'
           AND turn_number <= ?
           AND predicate IN ('CHAR_LOCATION', 'WORLD_LOCATION_EVENT')
         GROUP BY source, target, predicate`,
        [projectName, turnNumber]
    );

    const characters = new Map();
    const locations = new Map();
    for (const row of rows || []) {
        if (row.predicate === 'CHAR_LOCATION' && row.source) {
            characters.set(normalizeKey(row.source), Number(row.latest_turn || 0));
        }
        if (row.predicate === 'WORLD_LOCATION_EVENT' && row.target) {
            locations.set(normalizeKey(row.target), Number(row.latest_turn || 0));
        }
    }
    return { characters, locations };
}

function scoreByStaleness(latestTurn, turnNumber, interval) {
    if (!latestTurn) return 8;
    const age = Math.max(0, turnNumber - latestTurn);
    return Math.min(8, Math.floor(age / Math.max(1, interval)) + 1);
}

function weightedPick(candidates, limit, randomFn = Math.random) {
    const pool = candidates.filter(candidate => candidate.weight > 0);
    const selected = [];
    while (pool.length > 0 && selected.length < limit) {
        const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = randomFn() * total;
        let chosenIndex = 0;
        for (let index = 0; index < pool.length; index += 1) {
            roll -= pool[index].weight;
            if (roll <= 0) {
                chosenIndex = index;
                break;
            }
        }
        selected.push(pool.splice(chosenIndex, 1)[0].value);
    }
    return selected;
}

function getPartyNameSet(turnContext) {
    const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
    const player = turnContext?.input?.playerCharacterName;
    return new Set([...party, player].filter(Boolean).map(normalizeKey));
}

function isCoreImportance(value) {
    return normalizeKey(value) === 'core';
}

async function getCharacterImportance(turnContext, tools, characterName) {
    const charKey = normalizeKey(characterName);
    const metadataImportance = turnContext?.processed?.characterMetadata?.[charKey]?.importance;
    if (metadataImportance) return metadataImportance;

    if (tools.plugins.isInstalled('character_classifier')) {
        const importance = await tools.plugins.call('character_classifier', 'getImportance', characterName);
        if (importance) return importance;
    }

    if (tools.plugins.isInstalled('character_sheets')) {
        return await tools.plugins.call('character_sheets', 'getCharacterImportance', characterName);
    }

    return null;
}

async function getCoreCharacterNameSet(turnContext, tools, characterLocations) {
    const coreNames = new Set();
    const uniqueNames = Array.from(new Set((characterLocations || [])
        .map(loc => String(loc.name || '').trim())
        .filter(Boolean)));

    for (const name of uniqueNames) {
        try {
            const importance = await getCharacterImportance(turnContext, tools, name);
            if (isCoreImportance(importance)) coreNames.add(normalizeKey(name));
        } catch (error) {
            logWarn(tools, `Failed to read character importance for ${name}: ${error.message}`);
        }
    }

    return coreNames;
}

function findNodeByAnchor(nodes, anchor) {
    const key = normalizeKey(anchor);
    return nodes.find(node => normalizeKey(node.name) === key) || null;
}

function selectTargets(context, settings, randomFn = Math.random) {
    const turnNumber = context.turnNumber || 0;
    const partyNames = context.partyNames || new Set();
    const coreCharacterNames = context.coreCharacterNames || new Set();
    const currentAnchorKey = normalizeKey(context.currentAnchor);
    const characterCandidates = [];
    const locationCandidates = [];

    for (const loc of context.characterLocations || []) {
        const name = String(loc.name || '').trim();
        const key = normalizeKey(name);
        const anchorKey = normalizeKey(loc.anchorNode || loc.anchor_node || loc.specificLocation);
        if (!name || partyNames.has(key) || coreCharacterNames.has(key) || (currentAnchorKey && anchorKey === currentAnchorKey)) continue;
        const latestTurn = context.touchMaps.characters.get(key) || 0;
        let weight = 1 + scoreByStaleness(latestTurn, turnNumber, settings.update_interval);
        if (loc.context) weight += 2;
        if (loc.anchorNode || loc.anchor_node) weight += 2;
        characterCandidates.push({ weight, value: loc });
    }

    const eventAnchors = new Set((context.locationEvents || []).map(event => normalizeKey(event.anchor_node)));
    for (const node of context.nodes || []) {
        const name = String(node.name || '').trim();
        const key = normalizeKey(name);
        if (!name || (currentAnchorKey && key === currentAnchorKey)) continue;
        const latestTurn = context.touchMaps.locations.get(key) || 0;
        let weight = 1 + scoreByStaleness(latestTurn, turnNumber, settings.update_interval);
        if (node.description || node.tags) weight += 2;
        if (eventAnchors.has(key)) weight += 3;
        locationCandidates.push({ weight, value: node });
    }

    return {
        characters: weightedPick(characterCandidates, settings.character_update_limit, randomFn),
        locations: weightedPick(locationCandidates, settings.location_event_limit, randomFn)
    };
}

async function getCharacterGrounding(turnContext, tools, selectedCharacters) {
    if (!tools.plugins.isInstalled('character_sheets')) return [];

    const turnNumber = getTurnNumber(turnContext, tools);
    const grounded = [];
    for (const character of selectedCharacters) {
        try {
            const sheet = await tools.plugins.call('character_sheets', 'getCurrentSheet', character.name, turnNumber);
            if (!sheet) continue;
            grounded.push({
                name: character.name,
                brief: compactText(sheet.brief || sheet.biography || sheet.current_context || '', 700),
                status: sheet.status || sheet.CHAR_STATUS || ''
            });
        } catch (error) {
            logWarn(tools, `Failed to read character grounding for ${character.name}: ${error.message}`);
        }
    }
    return grounded;
}

async function buildSimulationMessages(dossier) {
    const template = await fs.readFile(SIMULATION_PROMPT_PATH, 'utf8');
    const outputSchema = JSON.stringify({
        character_updates: [
            {
                name: 'Selected character name',
                anchor_node: 'Exact node name from selected_locations or world_nodes',
                specific_location: 'Where inside/near that node',
                activity: 'What they are doing there',
                reason: 'Why this follows from the dossier'
            }
        ],
        location_event_updates: [
            {
                anchor_node: 'Exact selected location node name',
                event: 'One current off-screen event at this location',
                status: 'active',
                trajectory: 'stable',
                salience: 3,
                reason: 'Why this follows from the dossier'
            }
        ]
    }, null, 2);

    return [
        {
            role: 'system',
            content: template.replace('${outputSchema}', outputSchema)
        },
        {
            role: 'user',
            content: [
                'SIMULATION DOSSIER',
                'Use only this data as grounding. Exact names matter.',
                '',
                JSON.stringify(dossier, null, 2)
            ].join('\n')
        }
    ];
}

function normalizeLlmResult(rawResult) {
    const result = rawResult && typeof rawResult === 'object' ? rawResult : {};
    return {
        character_updates: Array.isArray(result.character_updates) ? result.character_updates : [],
        location_event_updates: Array.isArray(result.location_event_updates) ? result.location_event_updates : []
    };
}

function validateSimulationResponse(data) {
    const result = normalizeLlmResult(data);
    if (result.character_updates.length === 0 && result.location_event_updates.length === 0) {
        throw new Error('World simulation returned no updates for selected targets.');
    }
    return true;
}

async function gatherContext(turnContext, tools, settings) {
    const turnNumber = getTurnNumber(turnContext, tools);
    const partyNames = getPartyNameSet(turnContext);
    const currentLocation = await tools.plugins.call('world_location_tracker', 'getCurrentLocation', { turnNumber });
    const currentAnchor = currentLocation?.anchor || currentLocation?.anchor_node || currentLocation?.name || '';
    const worldState = await tools.plugins.call('world_state_tracker', 'getWorldStateSnapshot', { turnNumber });
    const locationEvents = await tools.plugins.call('world_state_tracker', 'getLocationEvents', { turnNumber });
    const mapSummary = await tools.plugins.call('world_location_tracker', 'getWorldMapSummary', {
        nodeLimit: 250,
        areaLimit: 120
    });
    const characterLocations = await tools.plugins.call('world_location_tracker', 'getAllCharacterLocations');
    const history = await turnContext.getFormattedHistory({
        count: settings.history_depth,
        skip: 0,
        tierConfig: { summary: settings.history_depth }
    });
    const touchMaps = await getSimulationTouchMaps(turnContext, tools);
    const coreCharacterNames = await getCoreCharacterNameSet(turnContext, tools, characterLocations);

    return {
        turnNumber,
        partyNames,
        coreCharacterNames,
        currentLocation,
        currentAnchor,
        worldState,
        locationEvents: Array.isArray(locationEvents) ? locationEvents : [],
        nodes: Array.isArray(mapSummary?.nodes) ? mapSummary.nodes : [],
        areas: Array.isArray(mapSummary?.areas) ? mapSummary.areas : [],
        characterLocations: Array.isArray(characterLocations) ? characterLocations : [],
        history: compactText(history, 9000),
        currentNarrative: compactText(turnContext?.processed?.narrativeEngine?.writerResponse || '', 3000),
        touchMaps
    };
}

function buildDossier(context, selectedTargets, characterGrounding) {
    return {
        current_turn: context.turnNumber,
        current_party_anchor: context.currentAnchor || null,
        current_party_location: context.currentLocation || null,
        recent_history: context.history,
        current_scene: context.currentNarrative,
        world_state: context.worldState?.structuredData || null,
        existing_location_events: context.locationEvents,
        selected_characters: selectedTargets.characters.map(char => ({
            name: char.name,
            anchor_node: char.anchorNode || char.anchor_node || '',
            specific_location: char.specificLocation || char.specific_location || '',
            context: char.context || ''
        })),
        character_grounding: characterGrounding,
        selected_locations: selectedTargets.locations.map(node => ({
            name: node.name,
            type: node.type || '',
            region: node.region || '',
            parent_nation: node.parent_nation || '',
            tags: node.tags || '',
            description: compactText(node.description, 600)
        })),
        world_nodes: context.nodes.map(node => ({
            name: node.name,
            type: node.type || '',
            region: node.region || '',
            tags: node.tags || ''
        }))
    };
}

async function applySimulationResult(turnContext, tools, context, selectedTargets, rawResult) {
    const result = normalizeLlmResult(rawResult);
    const nodes = context.nodes || [];
    const selectedCharactersByKey = new Map(selectedTargets.characters.map(char => [normalizeKey(char.name), char]));
    const selectedLocationKeys = new Set(selectedTargets.locations.map(node => normalizeKey(node.name)));
    const coreCharacterNames = context.coreCharacterNames || new Set();
    const currentAnchorKey = normalizeKey(context.currentAnchor);
    let savedCharacterUpdates = 0;
    let savedLocationEvents = 0;
    let skippedOperations = 0;

    for (const update of result.character_updates) {
        const nameKey = normalizeKey(update.name);
        if (!selectedCharactersByKey.has(nameKey)) {
            skippedOperations += 1;
            continue;
        }
        if (coreCharacterNames.has(nameKey)) {
            skippedOperations += 1;
            logInfo(tools, `Skipped core character update for ${update.name}.`);
            continue;
        }
        const node = findNodeByAnchor(nodes, update.anchor_node);
        if (!node || (currentAnchorKey && normalizeKey(node.name) === currentAnchorKey)) {
            skippedOperations += 1;
            continue;
        }
        const activity = String(update.activity || update.context || '').trim();
        if (!activity) {
            skippedOperations += 1;
            continue;
        }

        const selected = selectedCharactersByKey.get(nameKey);
        const saved = await tools.plugins.call('world_location_tracker', 'upsertCharacterLocation', {
            name: selected.name,
            anchor_node: node.name,
            specific_location: update.specific_location || node.name,
            activity,
            reason: update.reason || ''
        }, { turnNumber: context.turnNumber, context: 'world_simulator' });

        if (saved?.saved) savedCharacterUpdates += 1;
        else skippedOperations += 1;
    }

    for (const event of result.location_event_updates) {
        const node = findNodeByAnchor(nodes, event.anchor_node);
        const anchorKey = normalizeKey(node?.name);
        if (!node || !selectedLocationKeys.has(anchorKey) || (currentAnchorKey && anchorKey === currentAnchorKey)) {
            skippedOperations += 1;
            continue;
        }
        const eventText = String(event.event || '').replace(/\s+/g, ' ').trim();
        if (!eventText) {
            skippedOperations += 1;
            continue;
        }

        const saved = await tools.plugins.call('world_state_tracker', 'upsertLocationEvent', {
            anchor_node: node.name,
            event: eventText,
            status: event.status || 'active',
            trajectory: event.trajectory || 'stable',
            salience: Math.max(1, Math.min(5, Math.round(Number(event.salience) || 3))),
            reason: event.reason || ''
        }, { turnNumber: context.turnNumber, context: 'world_simulator' });

        if (saved?.saved) savedLocationEvents += 1;
        else skippedOperations += 1;
    }

    return { savedCharacterUpdates, savedLocationEvents, skippedOperations };
}

async function processSimulation(turnContext, tools, rawSettings = {}) {
    const settings = getSettings(rawSettings);
    const schedule = await shouldRunSimulation(turnContext, tools, settings);
    logInfo(
        tools,
        `Schedule check turn=${schedule.turnNumber} run=${schedule.run} reason=${schedule.reason} last_success=${schedule.lastRunTurn || 0} interval=${settings.update_interval} force=${settings.force_update}`
    );

    if (!schedule.run) {
        tools.logger.runtime(`World simulator skipped: ${schedule.reason}`);
        return { status: 'SKIPPED', reason: schedule.reason };
    }

    try {
        logInfo(tools, `Gathering context (history_depth=${settings.history_depth})...`);
        const context = await gatherContext(turnContext, tools, settings);
        logInfo(
            tools,
            `Context ready: nodes=${context.nodes.length}, areas=${context.areas.length}, character_locations=${context.characterLocations.length}, core_characters=${context.coreCharacterNames.size}, existing_events=${context.locationEvents.length}, current_anchor="${context.currentAnchor || 'unknown'}"`
        );

        const selectedTargets = selectTargets(context, settings);
        const selectedCharacterNames = selectedTargets.characters.map(char => char.name);
        const selectedLocationNames = selectedTargets.locations.map(node => node.name);
        logInfo(
            tools,
            `Selected targets: characters=[${selectedCharacterNames.join(', ') || 'none'}], locations=[${selectedLocationNames.join(', ') || 'none'}]`
        );

        if (selectedTargets.characters.length === 0 && selectedTargets.locations.length === 0) {
            await recordRun(turnContext, tools, {
                status: 'NO_TARGETS',
                reason: 'No eligible off-screen targets.',
                selected_characters: [],
                selected_locations: []
            });
            return { status: 'NO_TARGETS' };
        }

        const characterGrounding = await getCharacterGrounding(turnContext, tools, selectedTargets.characters);
        const dossier = buildDossier(context, selectedTargets, characterGrounding);
        logInfo(tools, `Character grounding loaded: ${characterGrounding.length}/${selectedTargets.characters.length}`);

        const messages = await buildSimulationMessages(dossier);
        const promptLength = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
        const modelDef = settings.model_def || {};
        const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;
        const model = resolvedModelDef.model || 'highendmodel';
        const provider = resolvedModelDef.provider;
        logInfo(
            tools,
            `LLM request starting: model=${model}, provider=${provider || 'default'}, timeout_ms=${settings.request_timeout_ms}, retries=${settings.retries}, prompt_chars=${promptLength}`
        );

        const task = {
            msg: 'World Simulation',
            retries: settings.retries,
            timeout: settings.request_timeout_ms,
            validateFn: validateSimulationResponse,
            callingModule: 'Plugin:world_simulator'
        };
        const response = tools.llm.vnBackground?.isSelected?.(modelDef) === true
            ? await tools.llm.vnBackground.json({ ...task, scene: 'none', suffix: messages })
            : await tools.llm.json({ ...task, messages, model, provider });

        const normalized = normalizeLlmResult(response?.content);
        logInfo(
            tools,
            `LLM response received: character_updates=${normalized.character_updates.length}, location_event_updates=${normalized.location_event_updates.length}`
        );

        const applied = await applySimulationResult(turnContext, tools, context, selectedTargets, normalized);
        const status = (applied.savedCharacterUpdates + applied.savedLocationEvents) > 0 ? 'APPLIED' : 'NO_VALID_CHANGES';
        logInfo(
            tools,
            `Validation/save complete: status=${status}, saved_characters=${applied.savedCharacterUpdates}, saved_events=${applied.savedLocationEvents}, skipped=${applied.skippedOperations}`
        );

        await recordRun(turnContext, tools, {
            status,
            selected_characters: selectedCharacterNames,
            selected_locations: selectedLocationNames,
            saved_character_updates: applied.savedCharacterUpdates,
            saved_location_events: applied.savedLocationEvents,
            skipped_operations: applied.skippedOperations
        });

        logInfo(tools, `Run metadata saved with status=${status}.`);
        logInfo(tools, `Simulation ${status}: ${applied.savedCharacterUpdates} character update(s), ${applied.savedLocationEvents} location event(s).`);
        return { status, ...applied };
    } catch (error) {
        logError(tools, `Simulation failed: ${error.message}`);
        await recordRun(turnContext, tools, {
            status: 'FAILED',
            reason: error.message
        });
        logInfo(tools, 'Run metadata saved with status=FAILED.');
        return { status: 'FAILED', reason: error.message };
    }
}

function isPromptVisibleEvent(event) {
    const status = normalizeKey(event?.status || 'active');
    return !!event?.event && !['resolved', 'deleted', 'inactive'].includes(status);
}

function formatPromptEvent(event) {
    const salience = Math.max(1, Math.min(5, Math.round(Number(event.salience) || 3)));
    const trajectory = event.trajectory ? `, trajectory: ${event.trajectory}` : '';
    const status = event.status ? `, status: ${event.status}` : '';
    const updated = Number.isInteger(Number(event.updated_turn || event.turn_number))
        ? `, updated turn: ${Number(event.updated_turn || event.turn_number)}`
        : '';
    return `- ${event.anchor_node}: ${event.event} (salience: ${salience}${status}${trajectory}${updated})`;
}

async function injectWorldEventsIntoPrompt(turnContext, tools, rawSettings = {}) {
    const settings = getSettings(rawSettings);
    if (settings.prompt_event_limit <= 0) return { injected: false, reason: 'disabled' };

    const turnNumber = getTurnNumber(turnContext, tools);
    const synthTurn = turnNumber > 1 ? turnNumber - 1 : turnNumber;
    const events = await tools.plugins.call('world_state_tracker', 'getLocationEvents', { turnNumber: synthTurn });
    const visibleEvents = (Array.isArray(events) ? events : [])
        .filter(isPromptVisibleEvent)
        .sort((left, right) => {
            const salienceDiff = Number(right.salience || 0) - Number(left.salience || 0);
            if (salienceDiff) return salienceDiff;
            return Number(right.updated_turn || right.turn_number || 0) - Number(left.updated_turn || left.turn_number || 0);
        })
        .slice(0, settings.prompt_event_limit);

    if (visibleEvents.length === 0) return { injected: false, reason: 'no_events' };

    const text = [
        '## OFF-SCREEN WORLD EVENTS',
        'These are current world conditions happening away from the active party. Treat them as ambient simulation state, not mandatory scene beats unless the current scene naturally intersects with them.',
        '',
        visibleEvents.map(formatPromptEvent).join('\n')
    ].join('\n');

    const wrapped = tools.prompt.wrap('world_simulator_events', text);
    tools.prompt.inject('simulation', wrapped, 'root');
    return { injected: true, count: visibleEvents.length };
}

module.exports = {
    processSimulation,
    getSettings,
    shouldRunSimulation,
    selectTargets,
    applySimulationResult,
    injectWorldEventsIntoPrompt,
    normalizeLlmResult,
    validateSimulationResponse,
    buildDossier,
    buildSimulationMessages
};
