(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m18_fairness_warning_v1',
        title: 'Milestone 18 Fairness Warning Fixture',
        seed: 'tds_fixture_m18_fairness_seed_v1',
        patterns: {
            enemy_spiral_pressure: {
                type: 'beam',
                count: 1,
                speed: 5,
                projectileType: 'enemy_default_bullet'
            }
        },
        enemyTypes: {
            captain: {
                hp: 65,
                radius: 34,
                speed: 0.9,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 420,
                boss: true,
                bossId: 'fairness_captain'
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, formation: 'left_right' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 1 }, do: [{ type: 'fire_pattern', pattern: 'enemy_spiral_pressure' }] },
                        { when: { type: 'enemy_type_defeated_count', enemyType: 'captain', count: 1 }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
