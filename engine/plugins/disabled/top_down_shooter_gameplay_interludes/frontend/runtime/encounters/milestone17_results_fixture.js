(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m17_results_v1',
        title: 'Milestone 17 Result Rules Fixture',
        seed: 'tds_fixture_m17_seed_v1',
        objectives: [
            { id: 'main_hold', type: 'survive_time', title: 'Hold the line', target: 20, required: true },
            { id: 'optional_no_loss', type: 'defeat_count', title: 'Defeat 6 foes', target: 6, optional: true }
        ],
        resultRules: [
            {
                id: 'barely_survived',
                when: { type: 'player_hp_below', ratio: 0.25 },
                tags: ['hard_won', 'barely_survived'],
                grade: 'desperate'
            },
            {
                id: 'optional_clear',
                when: { type: 'objective_completed', objective: 'optional_no_loss' },
                tag: 'optional_cleared'
            },
            {
                id: 'captain_down',
                when: { type: 'boss_defeated', bossId: 'results_captain' },
                tag: 'captain_defeated'
            },
            {
                id: 'slow_clear',
                when: { type: 'duration_above', seconds: 30 },
                tag: 'attrition_victory'
            }
        ],
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 20,
                speed: 1.3,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 760
            },
            captain: {
                hp: 78,
                radius: 34,
                speed: 0.92,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 540,
                boss: true,
                bossId: 'results_captain',
                displayName: 'Result Captain',
                phaseThresholds: [0.66, 0.33]
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Survive and defeat the captain',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 4, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'enemy_type_defeated_count', enemyType: 'captain', count: 1 },
                            do: [{ type: 'win' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
