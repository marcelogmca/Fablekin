(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m18_oversized_budget_v1',
        title: 'Milestone 18 Oversized Budget Fixture',
        seed: 'tds_fixture_m18_oversized_seed_v1',
        budgets: {
            maxEnemiesAlive: 5000,
            maxEnemyBulletsAlive: 99999,
            maxPlayerBulletsAlive: 50000,
            maxActionsPerSecond: 50000,
            maxEncounterSeconds: 99999
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    enter: [{ type: 'spawn_enemy', enemyType: 'scout', count: 1, formation: 'left_right' }],
                    rules: [{ when: { type: 'all_enemies_defeated' }, do: [{ type: 'win' }] }]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
