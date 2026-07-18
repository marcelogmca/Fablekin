const assert = require('assert');
const { FLAVOR_EVENT_IDS, GENERATION_PIPELINE, generateEncounterFromScene } = require('./encounter_generation.js');

const VALID_FACADE = `
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Generated" id generated_ok length=medium difficulty=normal mode=waves
style readable mobile_crossfire
wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge
wave pressure enemy=ranger count=medium pressure=medium pattern=line pickup=heal spawn=random
END_TDS_ENCOUNTER_FACADE
`;

const INVALID_FACADE = `
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Generated" id generated_bad length=medium difficulty=normal mode=waves
wave opening enemy=chaser count=3 pressure=heavy pattern=fan spawn=edge
END_TDS_ENCOUNTER_FACADE
`;

const VALID_FLAVOR_PACK = JSON.stringify({
    schemaVersion: 1,
    characters: ['Ineyv', 'Lyra'],
    lines: FLAVOR_EVENT_IDS.map((eventId, index) => ({
        event: eventId,
        speaker: index % 2 === 0 ? 'Ineyv' : 'Lyra',
        text: 'Line for ' + eventId + '.'
    }))
}, null, 2);

function createContext() {
    return {
        turnNumber: 7,
        input: {
            playerCharacterName: 'Ineyv',
            userPrompt: 'The glass drones rush the alley.'
        },
        promptComponents: {
            root: {
                canon: [
                    '<world_lore>Captain Lyra always keeps formation under fire.</world_lore>'
                ]
            },
            writer: { canon: [], history: [], simulation: [], dynamic_knowledge: [] },
            director: { canon: [], history: [], simulation: [], dynamic_knowledge: [] }
        },
        runtime: {
            historyData: {
                compressedHistory: {
                    balanced: 'Chapter 6:\n[NARRATIVE]: Ineyv and Lyra rebuilt trust after the market ambush.'
                },
                summaryHistory: 'Chapter 5: The party crossed the dunes under pressure.'
            }
        },
        processed: {
            director: {
                scenePhase: 'COMBAT',
                writerBrief: 'Combat erupts in a narrow alley.'
            }
        },
        output: {
            text: 'The alley flashes crimson as hostile drones arrive.',
            sequence: [
                { character: 'Narrator', text: 'The glass drones rush the alley.' }
            ]
        }
    };
}

function createTools(options = {}) {
    const calls = [];
    const facadeQueue = Array.isArray(options.facadeResponses) ? options.facadeResponses.slice() : [VALID_FACADE];
    const flavorQueue = Array.isArray(options.flavorResponses) ? options.flavorResponses.slice() : [VALID_FLAVOR_PACK];
    return {
        calls,
        logger: {
            warn: (message) => calls.push({ type: 'warn', message })
        },
        llm: {
            runTask: async (task) => {
                const title = String(task?.title || '');
                const type = title.includes('Flavor') ? 'flavor' : 'facade';
                calls.push({ type, task });
                if (type === 'flavor') return { content: flavorQueue.shift() || VALID_FLAVOR_PACK };
                return { content: facadeQueue.shift() || INVALID_FACADE };
            }
        }
    };
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

(async () => {
    await runTest('generates compiled encounter with facade plus flavor calls', async () => {
        const tools = createTools({
            facadeResponses: [VALID_FACADE],
            flavorResponses: [VALID_FLAVOR_PACK]
        });
        const result = await generateEncounterFromScene(createContext(), tools, {
            modelDef: { model: 'mockmodel' },
            timeoutMs: 10000
        });
        assert.strictEqual(result.ok, true, JSON.stringify(result.generatedEncounter, null, 2));
        assert.strictEqual(result.encounterSource, 'generated_encounter_facade');
        assert.strictEqual(result.generatedEncounter.repaired, false);
        assert.strictEqual(result.generatedEncounter.scriptKind, 'encounter_facade_v1');
        assert(result.generatedEncounter.expandedEncounterSummary && result.generatedEncounter.expandedEncounterSummary.mode);
        assert.strictEqual(result.generatedEncounter.generationPipeline, GENERATION_PIPELINE);
        assert.strictEqual(result.generatedEncounter.flavorPack?.schemaVersion, 1);
        assert.strictEqual(Array.isArray(result.generatedEncounter.flavorPack?.lines), true);
        assert.strictEqual(result.generatedEncounter.flavorPack.lines.length, FLAVOR_EVENT_IDS.length);
        assert.strictEqual(typeof result.generatedEncounter.flavorPackHash, 'string');
        assert(result.generatedEncounter.flavorPackHash.length > 0);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(result.generatedEncounter, 'creativeBrief'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(result.generatedEncounter, 'creativeBriefHash'), false);
        assert.strictEqual(tools.calls.filter((call) => call.type === 'facade').length, 1);
        assert.strictEqual(tools.calls.filter((call) => call.type === 'flavor').length, 1);
    });

    await runTest('compile failure skips flavor call and returns fallback', async () => {
        const tools = createTools({
            facadeResponses: [INVALID_FACADE],
            flavorResponses: [VALID_FLAVOR_PACK]
        });
        const result = await generateEncounterFromScene(createContext(), tools, {
            modelDef: { model: 'mockmodel' },
            timeoutMs: 10000
        });
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.encounterSource, 'generated_encounter_facade_fallback');
        assert(result.generatedEncounter.errors.length > 0);
        assert.strictEqual(tools.calls.filter((call) => call.type === 'facade').length, 1);
        assert.strictEqual(tools.calls.filter((call) => call.type === 'flavor').length, 0);
    });

    await runTest('flavor parse failure keeps encounter and falls back to default lines', async () => {
        const tools = createTools({
            facadeResponses: [VALID_FACADE],
            flavorResponses: ['not json at all']
        });
        const result = await generateEncounterFromScene(createContext(), tools, {
            modelDef: { model: 'mockmodel' },
            timeoutMs: 10000
        });
        assert.strictEqual(result.ok, true, JSON.stringify(result.generatedEncounter, null, 2));
        assert.strictEqual(result.encounterSource, 'generated_encounter_facade');
        assert.strictEqual(result.generatedEncounter.flavorPack.lines.length, FLAVOR_EVENT_IDS.length);
        assert(result.generatedEncounter.warnings.some((item) => item.code === 'TDSG-W100'));
    });

    await runTest('facade prompt avoids creative-brief flow and low-level tuning asks', async () => {
        const tools = createTools({
            facadeResponses: [VALID_FACADE],
            flavorResponses: [VALID_FLAVOR_PACK]
        });
        const result = await generateEncounterFromScene(createContext(), tools, {
            modelDef: { model: 'mockmodel' },
            timeoutMs: 10000
        });
        assert.strictEqual(result.ok, true, JSON.stringify(result.generatedEncounter, null, 2));
        assert.strictEqual(tools.calls.filter((call) => call.type === 'facade').length, 1);
        assert.strictEqual(tools.calls.filter((call) => call.type === 'flavor').length, 1);
        const facadeCall = tools.calls.find((call) => call.type === 'facade');
        assert(facadeCall.task.messages[0].content.includes('EncounterFacade v1'));
        assert(facadeCall.task.messages[1].content.includes('EncounterFacade v1 grammar'));
        assert(facadeCall.task.messages[1].content.includes('mode=waves|survive|boss'));
        assert(!facadeCall.task.messages[1].content.includes('creative brief'));
        assert(!facadeCall.task.messages[1].content.includes('hp='));
        assert(!facadeCall.task.messages[1].content.includes('speed='));
        assert(!facadeCall.task.messages[1].content.includes('cooldown='));
        const flavorCall = tools.calls.find((call) => call.type === 'flavor');
        assert(flavorCall.task.messages[1].content.includes('Allowed event ids'));
        assert(flavorCall.task.messages[1].content.includes('combat_start'));
        assert(flavorCall.task.messages[1].content.includes('Part 1 - Canon data'));
        assert(flavorCall.task.messages[1].content.includes('Captain Lyra always keeps formation under fire.'));
        assert(flavorCall.task.messages[1].content.includes('Part 3 - Narrative history (balanced)'));
        assert(flavorCall.task.messages[1].content.includes('Ineyv and Lyra rebuilt trust after the market ambush.'));
    });
})();
