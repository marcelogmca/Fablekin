(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_protect_object_v1',
        title: 'Protect Object: Polluted Orchard',
        seed: 'tds_example_protect_object_seed',
        objects: {
            orchard_core: {
                type: 'protect_target',
                team: 'ally',
                hp: 28,
                radius: 34,
                source: { type: 'arena_center' }
            }
        },
        objectives: [
            { id: 'keep_core_alive', type: 'protect_object', title: 'Protect the orchard core', objectId: 'orchard_core', required: true },
            { id: 'clear_wave', type: 'defeat_count', title: 'Defeat 6 invaders', target: 6, optional: true }
        ],
        enemyTypes: {
            scout: { hp: 9, radius: 20, speed: 1.35, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 840 },
            sentry: { hp: 14, radius: 24, speed: 0.92, behavior: 'keep_distance', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 690 }
        },
        sequence: {
            startPhase: 'defense',
            phases: [
                {
                    id: 'defense',
                    objective: 'Hold the core through two pressure spikes.',
                    enter: [
                        { type: 'spawn_object', object: 'orchard_core' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 7 }, do: [{ type: 'spawn_enemy', enemyType: 'sentry', count: 2, formation: 'left_right' }] },
                        { when: { type: 'phase_elapsed', seconds: 16 }, do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'random' }] },
                        { when: { type: 'time_elapsed', seconds: 28 }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
