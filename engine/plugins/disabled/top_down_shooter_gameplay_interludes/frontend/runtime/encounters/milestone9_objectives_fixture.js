(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m9_objectives_v1',
        title: 'Milestone 9 Objectives Fixture',
        seed: 'tds_fixture_m9_seed_v1',
        budgets: {
            maxEnemiesAlive: 24,
            maxEnemyBulletsAlive: 340,
            maxPlayerBulletsAlive: 150,
            maxEmittersAlive: 16,
            maxHazardsAlive: 40,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 40,
            maxActionsPerSecond: 150,
            maxEncounterSeconds: 140
        },
        arena: {
            mapSize: 1600,
            gridSpacing: 90
        },
        player: { hp: 8 },
        colors: {
            grid: 0x2d2a55,
            player: 0x39f2ff,
            enemyBullet: 0xff4f84
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 6,
                speed: 2.6,
                spreadDegrees: 42,
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
                attackIntervalMs: 920
            }
        },
        hazards: {
            sandstorm: {
                type: 'damage_circle',
                shape: 'circle',
                radius: 120,
                durationSeconds: 14,
                tickIntervalSeconds: 0.4,
                damage: 1,
                source: { type: 'arena_center' }
            }
        },
        objects: {
            defense_core: {
                type: 'protect_target',
                team: 'ally',
                hp: 26,
                radius: 34,
                source: { type: 'arena_center' }
            },
            anchor_zone: {
                type: 'capture_point',
                team: 'neutral',
                hp: 999,
                radius: 48,
                capture: true,
                source: { type: 'fixed_point', x: -430, y: 320 }
            }
        },
        objectives: [
            {
                id: 'survive_wave',
                type: 'survive_time',
                title: 'Survive the ambush',
                target: 18,
                required: true
            },
            {
                id: 'protect_core',
                type: 'protect_object',
                title: 'Protect the defense core',
                objectId: 'defense_core',
                required: true
            },
            {
                id: 'clear_scouts',
                type: 'defeat_count',
                title: 'Defeat 4 scouts (optional)',
                target: 4,
                optional: true
            },
            {
                id: 'reach_anchor',
                type: 'reach_zone',
                title: 'Reach the anchor zone',
                zoneId: 'anchor_zone',
                optional: true
            }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Complete required mission objectives',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                        { type: 'spawn_object', object: 'defense_core' },
                        { type: 'spawn_object', object: 'anchor_zone' },
                        { type: 'spawn_hazard', hazard: 'sandstorm' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 6 },
                            do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'random' }]
                        },
                        {
                            when: { type: 'player_entered_zone', zone: 'anchor_zone' },
                            do: [{ type: 'complete_objective', objective: 'reach_anchor' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
