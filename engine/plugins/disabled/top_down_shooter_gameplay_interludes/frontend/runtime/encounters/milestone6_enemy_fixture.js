(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m6_enemy_behaviors_v1',
        title: 'Milestone 6 Enemy Behavior Fixture',
        seed: 'tds_fixture_m6_enemy_seed_v1',
        budgets: {
            maxEnemiesAlive: 20,
            maxEnemyBulletsAlive: 320,
            maxPlayerBulletsAlive: 140,
            maxEmittersAlive: 12,
            maxHazardsAlive: 30,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 30,
            maxActionsPerSecond: 120,
            maxEncounterSeconds: 120
        },
        arena: {
            mapSize: 1650,
            gridSpacing: 96
        },
        player: { hp: 8 },
        colors: {
            grid: 0x213c67,
            player: 0x39f2ff,
            enemyBullet: 0xff3f8d
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'line',
                count: 5,
                speed: 2.8,
                spacing: 64,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            },
            enemy_ring_burst: {
                type: 'radial',
                count: 10,
                speed: 2.6,
                projectileType: 'enemy_default_bullet'
            },
            enemy_sniper_shot: {
                type: 'aimed',
                speed: 3.7,
                projectileType: 'enemy_default_bullet'
            }
        },
        enemyArchetypes: {
            charger: { behavior: 'charge_telegraphed', speed: 1.7, hp: 26, radius: 26, attackMode: 'sequence' },
            summoner: { behavior: 'summoner', speed: 0.78, hp: 24, radius: 24, summonedEnemyType: 'scout', summonedEverySeconds: 4.5 },
            sniper: { behavior: 'keep_distance', speed: 0.95, hp: 14, radius: 20 },
            elite: { behavior: 'elite', speed: 1.2, hp: 22, radius: 24 }
        },
        enemyTypes: {
            scout: {
                archetype: 'scout',
                hp: 10,
                speed: 1.4,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 850
            },
            charger_demo: {
                archetype: 'charger',
                attacks: [
                    { id: 'charge_line', pattern: 'enemy_spiral_pressure', everySeconds: 1.3, weight: 1 },
                    { id: 'charge_ring', pattern: 'enemy_ring_burst', everySeconds: 2.6, weight: 1 }
                ],
                attackMode: 'sequence'
            },
            summoner_demo: {
                archetype: 'summoner',
                attacks: [
                    { id: 'summon_shot', pattern: 'enemy_spiral_pressure', everySeconds: 1.1, weight: 2 },
                    { id: 'summon_ring', pattern: 'enemy_ring_burst', everySeconds: 2.2, weight: 1 }
                ],
                attackMode: 'weighted_deck'
            },
            elite_sniper_demo: {
                archetype: 'sniper',
                modifiers: ['elite_fast', 'elite_armored', 'elite_bullet_hell', 'elite_shielded'],
                attacks: [
                    { id: 'snipe', pattern: 'enemy_sniper_shot', everySeconds: 0.9, trigger: { type: 'player_in_range', range: 620 } },
                    { id: 'panic', pattern: 'enemy_ring_burst', everySeconds: 2.2, once: true, trigger: { type: 'hp_below', ratio: 0.55 } }
                ],
                attackMode: 'cooldown_when_in_range'
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Defeat the behavior test squad',
                    enter: [
                        { type: 'show_banner', text: 'Milestone 6 test wave' },
                        { type: 'spawn_enemy', enemyType: 'charger_demo', count: 1, at: { x: -260, y: -120 } },
                        { type: 'spawn_enemy', enemyType: 'summoner_demo', count: 1, at: { x: 240, y: -120 } },
                        { type: 'spawn_enemy', enemyType: 'elite_sniper_demo', count: 1, at: { x: 0, y: -300 } }
                    ],
                    rules: [
                        {
                            when: { type: 'enemy_defeated_count', count: 2 },
                            do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' }]
                        },
                        {
                            when: { type: 'all_enemies_defeated' },
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
