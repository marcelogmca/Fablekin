const assert = require('node:assert/strict');
const test = require('node:test');
const logic = require('./logic.js');

function makeTurnContext(turnNumber = 3) {
    return {
        turnNumber,
        projectName: 'TestProject',
        input: { playerCharacterName: 'Player' },
        output: { party: ['Hero'] },
        processed: { narrativeEngine: { writerResponse: 'The party rests in Town A after a difficult road.' } },
        getFormattedHistory: async () => 'Turn 1 summary.\nTurn 2 summary.\nTurn 3 summary.'
    };
}

function makeTools(overrides = {}) {
    const facts = [];
    const characterLocationCalls = [];
    const locationEventCalls = [];
    const options = {
        lastRunRows: [],
        touchRows: [],
        characterSheetsInstalled: false,
        characterClassifierInstalled: false,
        characterImportance: {},
        llmContent: {
            character_updates: [
                {
                    name: 'Alice',
                    anchor_node: 'Town C',
                    specific_location: 'Town C archives',
                    activity: 'Studying caravan records.',
                    reason: 'She was already investigating trade routes.'
                }
            ],
            location_event_updates: [
                {
                    anchor_node: 'Town B',
                    event: 'Bandit pressure is straining food deliveries.',
                    status: 'active',
                    trajectory: 'escalating',
                    salience: 4,
                    reason: 'Recent travel trouble makes this plausible.'
                }
            ]
        },
        ...overrides
    };

    return {
        turnContext: makeTurnContext(),
        logger: {
            runtime: () => {},
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        settings: {
            getSelf: () => ({})
        },
        db: {
            chat: {
                query: async (sql) => {
                    if (String(sql).includes("predicate = ?")) return options.lastRunRows;
                    if (String(sql).includes("context = 'world_simulator'")) return options.touchRows;
                    return [];
                }
            }
        },
        facts: {
            appendToFactsDb: async (fact, scope) => {
                facts.push({ fact, scope });
                return true;
            }
        },
        prompt: {
            wrap: (tag, text) => `<${tag}>\n${text}\n</${tag}>`,
            inject: (slot, text, pillar) => {
                facts.push({ promptInjection: { slot, text, pillar } });
            }
        },
        plugins: {
            isInstalled: (pluginId) => {
                if (pluginId === 'character_sheets') return options.characterSheetsInstalled;
                if (pluginId === 'character_classifier') return options.characterClassifierInstalled;
                return true;
            },
            call: async (pluginId, method, ...args) => {
                if (pluginId === 'world_location_tracker' && method === 'getCurrentLocation') {
                    return { name: 'Town A', anchor: 'Town A' };
                }
                if (pluginId === 'world_location_tracker' && method === 'getWorldMapSummary') {
                    return {
                        nodes: [
                            { name: 'Town A', description: 'Party location.' },
                            { name: 'Town B', description: 'Trade town.' },
                            { name: 'Town C', description: 'Academy town.' },
                            { name: 'Town D', description: 'River town.' }
                        ],
                        areas: []
                    };
                }
                if (pluginId === 'world_location_tracker' && method === 'getAllCharacterLocations') {
                    return [
                        { name: 'Alice', anchorNode: 'Town B', specificLocation: 'Town B inn', context: 'Researching trade.' },
                        { name: 'Bob', anchorNode: 'Town C', specificLocation: 'Town C gate', context: 'Guard duty.' },
                        { name: 'Hero', anchorNode: 'Town A', specificLocation: 'Town A square', context: 'With the party.' }
                    ];
                }
                if (pluginId === 'world_location_tracker' && method === 'upsertCharacterLocation') {
                    characterLocationCalls.push(args[0]);
                    return { saved: true };
                }
                if (pluginId === 'world_state_tracker' && method === 'getWorldStateSnapshot') {
                    return { structuredData: { weatherChange: 'Clear' } };
                }
                if (pluginId === 'world_state_tracker' && method === 'getLocationEvents') {
                    return options.locationEvents || [];
                }
                if (pluginId === 'world_state_tracker' && method === 'upsertLocationEvent') {
                    locationEventCalls.push(args[0]);
                    return { saved: true };
                }
                if (pluginId === 'character_sheets' && method === 'getCurrentSheet') {
                    return { brief: `${args[0]} is a grounded supporting character.`, status: 'ALIVE' };
                }
                if (pluginId === 'character_sheets' && method === 'getCharacterImportance') {
                    return options.characterImportance[String(args[0] || '').toLowerCase()] || null;
                }
                if (pluginId === 'character_classifier' && method === 'getImportance') {
                    return options.characterImportance[String(args[0] || '').toLowerCase()] || null;
                }
                throw new Error(`Unexpected plugin call: ${pluginId}.${method}`);
            }
        },
        llm: {
            json: async () => ({ content: options.llmContent })
        },
        __facts: facts,
        __characterLocationCalls: characterLocationCalls,
        __locationEventCalls: locationEventCalls
    };
}

test('shouldRunSimulation skips when interval has not elapsed', async () => {
    const turnContext = makeTurnContext(3);
    const tools = makeTools({
        lastRunRows: [{ turn_number: 2, fact_value: JSON.stringify({ status: 'APPLIED' }) }]
    });

    const result = await logic.shouldRunSimulation(turnContext, tools, logic.getSettings({ update_interval: 3 }));
    assert.equal(result.run, false);
    assert.equal(result.reason, 'interval_not_reached');
});

test('selectTargets excludes party characters and current party anchor', () => {
    const selected = logic.selectTargets({
        turnNumber: 3,
        currentAnchor: 'Town A',
        partyNames: new Set(['hero', 'player']),
        touchMaps: { characters: new Map(), locations: new Map() },
        locationEvents: [],
        characterLocations: [
            { name: 'Hero', anchorNode: 'Town B', context: 'Party member.' },
            { name: 'Alice', anchorNode: 'Town A', context: 'Too close.' },
            { name: 'Bob', anchorNode: 'Town C', context: 'Grounded.' }
        ],
        nodes: [
            { name: 'Town A', description: 'Party location.' },
            { name: 'Town B', description: 'Off-screen.' }
        ]
    }, logic.getSettings({ character_update_limit: 3, location_event_limit: 3 }), () => 0);

    assert.deepEqual(selected.characters.map(c => c.name), ['Bob']);
    assert.deepEqual(selected.locations.map(n => n.name), ['Town B']);
});

test('selectTargets excludes core characters', () => {
    const selected = logic.selectTargets({
        turnNumber: 3,
        currentAnchor: 'Town A',
        partyNames: new Set(['hero', 'player']),
        coreCharacterNames: new Set(['alice']),
        touchMaps: { characters: new Map(), locations: new Map() },
        locationEvents: [],
        characterLocations: [
            { name: 'Alice', anchorNode: 'Town B', context: 'Core cast member.' },
            { name: 'Bob', anchorNode: 'Town C', context: 'Major off-screen character.' }
        ],
        nodes: [
            { name: 'Town A', description: 'Party location.' },
            { name: 'Town B', description: 'Off-screen.' }
        ]
    }, logic.getSettings({ character_update_limit: 3, location_event_limit: 0 }), () => 0);

    assert.deepEqual(selected.characters.map(c => c.name), ['Bob']);
});

test('applySimulationResult skips invalid operations', async () => {
    const turnContext = makeTurnContext(3);
    const tools = makeTools();
    const applied = await logic.applySimulationResult(turnContext, tools, {
        turnNumber: 3,
        currentAnchor: 'Town A',
        nodes: [{ name: 'Town A' }, { name: 'Town B' }]
    }, {
        characters: [{ name: 'Alice' }],
        locations: [{ name: 'Town B' }]
    }, {
        character_updates: [
            { name: 'Mallory', anchor_node: 'Town B', activity: 'Invalid character.' },
            { name: 'Alice', anchor_node: 'Unknown', activity: 'Invalid anchor.' }
        ],
        location_event_updates: [
            { anchor_node: 'Town A', event: 'Party anchor should be skipped.' },
            { anchor_node: 'Unknown', event: 'Unknown anchor.' }
        ]
    });

    assert.equal(applied.savedCharacterUpdates, 0);
    assert.equal(applied.savedLocationEvents, 0);
    assert.equal(applied.skippedOperations, 4);
});

test('applySimulationResult skips core character updates after LLM response', async () => {
    const turnContext = makeTurnContext(3);
    const tools = makeTools();
    const applied = await logic.applySimulationResult(turnContext, tools, {
        turnNumber: 3,
        currentAnchor: 'Town A',
        coreCharacterNames: new Set(['alice']),
        nodes: [{ name: 'Town A' }, { name: 'Town B' }]
    }, {
        characters: [{ name: 'Alice' }],
        locations: []
    }, {
        character_updates: [{ name: 'Alice', anchor_node: 'Town B', activity: 'Should never save.' }],
        location_event_updates: []
    });

    assert.equal(applied.savedCharacterUpdates, 0);
    assert.equal(applied.skippedOperations, 1);
    assert.equal(tools.__characterLocationCalls.length, 0);
});

test('applySimulationResult persists valid operations through world trackers', async () => {
    const turnContext = makeTurnContext(3);
    const tools = makeTools();
    const applied = await logic.applySimulationResult(turnContext, tools, {
        turnNumber: 3,
        currentAnchor: 'Town A',
        nodes: [{ name: 'Town A' }, { name: 'Town B' }, { name: 'Town C' }]
    }, {
        characters: [{ name: 'Alice' }],
        locations: [{ name: 'Town B' }]
    }, {
        character_updates: [{ name: 'Alice', anchor_node: 'Town C', specific_location: 'Archive', activity: 'Studying.' }],
        location_event_updates: [{ anchor_node: 'Town B', event: 'Markets are tense.', salience: 4 }]
    });

    assert.equal(applied.savedCharacterUpdates, 1);
    assert.equal(applied.savedLocationEvents, 1);
    assert.equal(tools.__characterLocationCalls.length, 1);
    assert.equal(tools.__locationEventCalls.length, 1);
});

test('processSimulation runs without optional character_sheets', async () => {
    const turnContext = makeTurnContext(3);
    const tools = makeTools({ characterSheetsInstalled: false });

    const result = await logic.processSimulation(turnContext, tools, {
        force_update: true,
        character_update_limit: 3,
        location_event_limit: 3
    });

    assert.equal(result.status, 'APPLIED');
    assert.equal(tools.__characterLocationCalls.length, 1);
    assert.equal(tools.__locationEventCalls.length, 1);
    assert.equal(tools.__facts.some(entry => entry.fact.predicate === 'SIMULATION_RUN'), true);
});

test('buildSimulationMessages separates system instructions from user dossier', async () => {
    const messages = await logic.buildSimulationMessages({
        selected_characters: [{ name: 'Alice' }],
        selected_locations: [{ name: 'Town B' }]
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.match(messages[0].content, /World Simulator/);
    assert.doesNotMatch(messages[0].content, /SIMULATION DOSSIER/);
    assert.match(messages[1].content, /SIMULATION DOSSIER/);
    assert.match(messages[1].content, /Alice/);
});

test('validateSimulationResponse rejects empty updates for selected targets', () => {
    assert.throws(
        () => logic.validateSimulationResponse({ character_updates: [], location_event_updates: [] }),
        /returned no updates/
    );
    assert.equal(logic.validateSimulationResponse({
        character_updates: [{ name: 'Alice', anchor_node: 'Town B', activity: 'Working.' }],
        location_event_updates: []
    }), true);
});

test('injectWorldEventsIntoPrompt inserts visible events into simulation slot', async () => {
    const turnContext = makeTurnContext(4);
    const tools = makeTools({
        locationEvents: [
            {
                anchor_node: 'Town B',
                event: 'Bandit pressure is straining food deliveries.',
                status: 'active',
                trajectory: 'escalating',
                salience: 4,
                updated_turn: 3
            },
            {
                anchor_node: 'Town C',
                event: 'A resolved event should stay hidden.',
                status: 'resolved',
                salience: 5,
                updated_turn: 3
            }
        ]
    });

    const result = await logic.injectWorldEventsIntoPrompt(turnContext, tools, { prompt_event_limit: 6 });
    const injection = tools.__facts.find(entry => entry.promptInjection)?.promptInjection;

    assert.equal(result.injected, true);
    assert.equal(result.count, 1);
    assert.equal(injection.slot, 'simulation');
    assert.equal(injection.pillar, 'root');
    assert.match(injection.text, /OFF-SCREEN WORLD EVENTS/);
    assert.match(injection.text, /Town B/);
    assert.doesNotMatch(injection.text, /Town C/);
});
