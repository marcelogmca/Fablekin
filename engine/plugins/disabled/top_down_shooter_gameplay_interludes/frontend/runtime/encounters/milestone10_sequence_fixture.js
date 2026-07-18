(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m10_sequence_expansion_v1',
        title: 'Milestone 10 Sequence Expansion Fixture',
        seed: 'tds_fixture_m10_seed_v1',
        budgets: {
            maxEnemiesAlive: 24,
            maxEnemyBulletsAlive: 320,
            maxPlayerBulletsAlive: 150,
            maxEmittersAlive: 18,
            maxHazardsAlive: 36,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 36,
            maxActionsPerSecond: 180,
            maxEncounterSeconds: 160
        },
        arena: { mapSize: 1600, gridSpacing: 88 },
        player: { hp: 8 },
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 6,
                speed: 2.6,
                spreadDegrees: 44,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            }
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.25,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 900
            },
            sentry: {
                hp: 14,
                radius: 24,
                speed: 0.9,
                behavior: 'stationary_turret',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 740
            }
        },
        objectives: [
            { id: 'hold_line', type: 'survive_time', title: 'Hold the line', target: 20, required: true },
            { id: 'clear_four', type: 'defeat_count', title: 'Defeat 4 enemies', target: 4, optional: true }
        ],
        sequence: {
            startPhase: 'opening',
            initialFlags: {
                reinforceUnlocked: false
            },
            initialCounters: {
                waveCounter: 0
            },
            actionGroups: {
                delayed_burst: [
                    { type: 'spawn_enemy', enemyType: 'scout', count: 1, formation: 'random' },
                    { type: 'add_counter', counter: 'waveCounter', value: 1 }
                ],
                reinforcement_group: [
                    { type: 'spawn_enemy', enemyType: 'sentry', count: 1, at: { x: 260, y: -180 } },
                    { type: 'spawn_enemy', enemyType: 'scout', count: 1, at: { x: -260, y: -180 } }
                ]
            },
            phases: [
                {
                    id: 'opening',
                    objective: 'Sequence expansion validation',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                        { type: 'set_counter', counter: 'waveCounter', value: 1 },
                        { type: 'delay_actions', delaySeconds: 2, actions: [{ type: 'run_action_group', group: 'delayed_burst' }] }
                    ],
                    rules: [
                        {
                            when: { type: 'counter_at_least', counter: 'waveCounter', value: 2 },
                            if: { type: 'flag_is', flag: 'reinforceUnlocked', value: false },
                            do: [
                                { type: 'set_flag', flag: 'reinforceUnlocked', value: true },
                                { type: 'show_banner', text: 'Reinforcements incoming' },
                                { type: 'run_action_group', group: 'reinforcement_group', delaySeconds: 1.2 }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 3.5 },
                            repeat: { everySeconds: 2.2, limit: 4 },
                            repeatUntil: { type: 'enemy_count_at_least', count: 7 },
                            maxRepeats: 4,
                            cooldownSeconds: 0.25,
                            do: [
                                {
                                    type: 'spawn_enemies_from_table',
                                    table: [
                                        { enemyType: 'scout', count: 1, weight: 0.7 },
                                        { enemyType: 'sentry', count: 1, weight: 0.3 }
                                    ]
                                }
                            ]
                        },
                        {
                            when: { type: 'objective_progress_at_least', objective: 'clear_four', progress: 2 },
                            do: [{ type: 'show_banner', text: 'Optional objective progressing' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
