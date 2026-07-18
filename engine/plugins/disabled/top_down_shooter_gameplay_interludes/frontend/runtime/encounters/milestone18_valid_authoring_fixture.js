(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m18_valid_authoring_v1',
        title: 'Milestone 18 Valid Authoring Fixture',
        seed: 'tds_fixture_m18_valid_seed_v1',
        budgets: {
            maxEnemiesAlive: 18,
            maxEnemyBulletsAlive: 260,
            maxActionsPerSecond: 90
        },
        resultRules: [
            { id: 'quick_clear', when: { type: 'duration_below', seconds: 32 }, tags: ['fast_clear'] },
            { id: 'captain_down', when: { type: 'boss_defeated', bossId: 'm18_captain' }, tag: 'boss_down' }
        ],
        enemyTypes: {
            scout: { hp: 10, radius: 20, speed: 1.2, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 780 },
            captain: { hp: 72, radius: 34, speed: 0.9, behavior: 'boss_anchor', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 520, boss: true, bossId: 'm18_captain' }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'random' }
                    ],
                    rules: [
                        { when: { type: 'enemy_type_defeated_count', enemyType: 'captain', count: 1 }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
