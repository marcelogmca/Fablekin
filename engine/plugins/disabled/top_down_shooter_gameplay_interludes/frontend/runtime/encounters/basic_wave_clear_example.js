(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_basic_wave_clear_v1',
        title: 'Basic Wave Clear',
        seed: 'tds_example_basic_wave_clear_seed',
        enemyTypes: {
            scout: { hp: 9, radius: 20, speed: 1.25, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 850 },
            sentry: { hp: 14, radius: 24, speed: 0.9, behavior: 'stationary_turret', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 700 },
            captain: { hp: 72, radius: 34, speed: 0.95, behavior: 'boss_anchor', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 520, boss: true, bossId: 'wave_captain' }
        },
        sequence: {
            startPhase: 'wave_1',
            phases: [
                {
                    id: 'wave_1',
                    objective: 'Defeat the first ambush.',
                    enter: [{ type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' }],
                    rules: [{ when: { type: 'all_enemies_defeated' }, do: [{ type: 'transition_phase', phase: 'wave_2' }] }]
                },
                {
                    id: 'wave_2',
                    objective: 'Captain arrives with support.',
                    enter: [
                        { type: 'show_banner', text: 'Wave 2' },
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, at: { x: 0, y: -120 } },
                        { type: 'spawn_enemy', enemyType: 'sentry', count: 2, formation: 'left_right' }
                    ],
                    rules: [{ when: { type: 'enemy_type_defeated_count', enemyType: 'captain', count: 1 }, do: [{ type: 'win' }] }]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
