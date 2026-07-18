const assert = require('assert');
const { extractBattleOstChoices, regenerateEncounterSocket } = require('./logic.js');

function runTest(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

runTest('descriptor combat OST choices win over descriptor battle and context choices', () => {
    const context = {
        processed: {
            assetSelector: {
                ostChoicesByCategory: {
                    combat: ['ctx_combat_a.ogg'],
                    battle: ['ctx_battle_a.ogg']
                }
            }
        }
    };
    const descriptorPayload = {
        combatOstChoices: ['desc_combat_a.ogg', 'desc_combat_b.ogg'],
        battleOstChoices: ['desc_battle_a.ogg']
    };
    const out = extractBattleOstChoices(context, descriptorPayload);
    assert.deepStrictEqual(out, ['desc_combat_a.ogg', 'desc_combat_b.ogg']);
});

runTest('descriptor battle choices are used when descriptor combat choices are unavailable', () => {
    const context = {
        processed: {
            assetSelector: {
                ostChoicesByCategory: {
                    combat: ['ctx_combat_a.ogg'],
                    battle: ['ctx_battle_a.ogg']
                }
            }
        }
    };
    const descriptorPayload = {
        battleOstChoices: ['desc_battle_a.ogg', 'desc_battle_b.ogg']
    };
    const out = extractBattleOstChoices(context, descriptorPayload);
    assert.deepStrictEqual(out, ['desc_battle_a.ogg', 'desc_battle_b.ogg']);
});

runTest('context combat choices are used when descriptor payload has none', () => {
    const context = {
        processed: {
            assetSelector: {
                ostChoicesByCategory: {
                    combat: ['ctx_combat_a.ogg', { file: 'ctx_combat_b.ogg' }, 'ctx_combat_a.ogg'],
                    battle: ['ctx_battle_a.ogg']
                }
            }
        }
    };
    const out = extractBattleOstChoices(context, null);
    assert.deepStrictEqual(out, ['ctx_combat_a.ogg', 'ctx_combat_b.ogg']);
});

runTest('context battle fallback still works when only battle choices are available', () => {
    const context = {
        processed: {
            assetSelector: {
                ostChoicesByCategory: {
                    battle: [{ path: 'ctx_battle_a.ogg' }, { src: 'ctx_battle_b.ogg' }]
                }
            }
        }
    };
    const out = extractBattleOstChoices(context, null);
    assert.deepStrictEqual(out, ['ctx_battle_a.ogg', 'ctx_battle_b.ogg']);
});

(async () => {
    await runTestAsync('regenerate socket returns generated encounter flavor pack metadata', async () => {
        const emitted = [];
        const facade = [
            'BEGIN_TDS_ENCOUNTER_FACADE',
            'encounter "Generated" id generated_ok length=medium difficulty=normal mode=waves',
            'style readable mobile_crossfire',
            'wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge',
            'wave pressure enemy=ranger count=medium pressure=medium pattern=line pickup=heal spawn=random',
            'END_TDS_ENCOUNTER_FACADE'
        ].join('\n');
        const flavorPack = JSON.stringify({
            schemaVersion: 1,
            characters: ['Ineyv', 'Lyra'],
            lines: [
                { event: 'combat_start', speaker: 'Ineyv', text: 'Contact front.' },
                { event: 'hit_taken', speaker: 'Lyra', text: 'That clipped us.' },
                { event: 'hp_low', speaker: 'Ineyv', text: 'Need breathing room.' },
                { event: 'momentum_1', speaker: 'Lyra', text: 'Push left lane.' },
                { event: 'momentum_2', speaker: 'Ineyv', text: 'Pressure is cracking.' },
                { event: 'boss_pressure', speaker: 'Lyra', text: 'Big windup incoming.' },
                { event: 'victory', speaker: 'Ineyv', text: 'Hostiles down.' },
                { event: 'defeat', speaker: 'Lyra', text: 'Reset and try again.' }
            ]
        });

        const tools = {
            logger: { warn: () => {} },
            settings: {
                getSelf: () => ({
                    enabled: true,
                    generate_dynamic_encounters: true,
                    encounter_generation_model: { model: 'mockmodel' },
                    encounter_generation_timeout_ms: 10000
                })
            },
            turns: {
                getCurrent: async () => ({
                    context: {
                        turnNumber: 9,
                        input: {
                            playerCharacterName: 'Ineyv',
                            userPrompt: 'Advance through the glass corridor.'
                        },
                        processed: {
                            director: {
                                scenePhase: 'COMBAT',
                                writerBrief: 'A corridor ambush with glass drones.'
                            }
                        },
                        output: {
                            text: 'The corridor erupts with pink fire.',
                            party: ['Lyra']
                        }
                    }
                })
            },
            llm: {
                runTask: async (task) => {
                    const title = String(task?.title || '');
                    if (title.includes('Flavor')) return { content: flavorPack };
                    return { content: facade };
                }
            },
            socket: {
                emit: (event, payload) => emitted.push({ event, payload })
            }
        };

        await regenerateEncounterSocket({}, tools);
        assert.strictEqual(emitted.length > 0, true);
        const last = emitted[emitted.length - 1];
        assert.strictEqual(last.event, 'top_down_shooter_gameplay_interludes:regenerate-encounter-response');
        assert.strictEqual(last.payload.success, true);
        assert.strictEqual(last.payload.ok, true);
        assert.strictEqual(last.payload.encounterSource, 'generated_encounter_facade');
        assert.strictEqual(last.payload.generatedEncounter.generationPipeline, 'facade_plus_flavor_v1');
        assert.strictEqual(last.payload.generatedEncounter.flavorPack.schemaVersion, 1);
        assert.strictEqual(Array.isArray(last.payload.generatedEncounter.flavorPack.lines), true);
        assert.strictEqual(last.payload.generatedEncounter.flavorPack.lines.length, 8);
    });
})();
