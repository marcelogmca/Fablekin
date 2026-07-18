(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m7_boss_framework_v1',
        title: 'Milestone 7 Boss Framework Fixture',
        seed: 'tds_fixture_m7_boss_seed_v1',
        budgets: {
            maxEnemiesAlive: 24,
            maxEnemyBulletsAlive: 360,
            maxPlayerBulletsAlive: 140,
            maxEmittersAlive: 14,
            maxHazardsAlive: 30,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 40,
            maxActionsPerSecond: 140,
            maxEncounterSeconds: 140
        },
        arena: {
            mapSize: 1700,
            gridSpacing: 92
        },
        player: { hp: 8 },
        colors: {
            grid: 0x233f6e,
            player: 0x39f2ff,
            enemyBullet: 0xff3f8d
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 6,
                speed: 2.7,
                spreadDegrees: 38,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            },
            boss_ring: {
                type: 'radial',
                count: 14,
                speed: 2.55,
                projectileType: 'enemy_default_bullet'
            },
            boss_lance: {
                type: 'line',
                count: 7,
                speed: 3.1,
                spacing: 52,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            }
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.35,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 900
            },
            polluted_fruit: {
                boss: true,
                bossId: 'polluted_fruit',
                displayName: 'Polluted Fruit',
                bossSubtitle: 'Protect the farmland',
                hp: 220,
                radius: 44,
                speed: 0.9,
                behavior: 'boss_anchor',
                shieldRatio: 0.38,
                attackMode: 'weighted_deck',
                attacks: [
                    { id: 'burst_fan', pattern: 'enemy_spiral_pressure', everySeconds: 1.1, weight: 2, label: 'Spore Fan' },
                    { id: 'ring_blast', pattern: 'boss_ring', everySeconds: 2.4, weight: 1, label: 'Pollution Ring' },
                    { id: 'lance_wall', pattern: 'boss_lance', everySeconds: 1.8, weight: 2, label: 'Lance Wall' }
                ],
                bossPhases: [
                    {
                        id: 'phase_seed',
                        untilHpRatio: 0.7,
                        attackDeckMode: 'weighted_deck',
                        attackDeck: ['burst_fan', 'ring_blast'],
                        onEnter: [
                            { type: 'show_banner', text: 'Polluted Fruit emerges' }
                        ]
                    },
                    {
                        id: 'phase_roots',
                        untilHpRatio: 0.4,
                        attackDeckMode: 'sequence',
                        attackDeck: ['lance_wall', 'burst_fan', 'ring_blast'],
                        noRepeatWindow: 1,
                        onEnter: [
                            { type: 'show_banner', text: 'Roots spread across the field' },
                            { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                            { type: 'lock_boss_damage', bossId: 'polluted_fruit' },
                            { type: 'spawn_enemy', enemyType: 'scout', count: 1, at: { x: 0, y: -260 } },
                            { type: 'unlock_boss_damage', bossId: 'polluted_fruit' }
                        ]
                    },
                    {
                        id: 'phase_enrage',
                        untilHpRatio: 0.01,
                        attackDeckMode: 'phase_loop',
                        attackDeck: ['lance_wall', 'ring_blast', 'burst_fan'],
                        noRepeatWindow: 2,
                        onEnter: [
                            { type: 'show_banner', text: 'Polluted Fruit enrages!' },
                            { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'random' }
                        ]
                    }
                ]
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Defeat Polluted Fruit',
                    enter: [
                        { type: 'show_banner', text: 'Boss Encounter' },
                        { type: 'spawn_enemy', enemyType: 'polluted_fruit', count: 1, at: { x: 0, y: -120 } }
                    ],
                    rules: [
                        {
                            when: { type: 'enemy_type_defeated_count', enemyType: 'polluted_fruit', count: 1 },
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
