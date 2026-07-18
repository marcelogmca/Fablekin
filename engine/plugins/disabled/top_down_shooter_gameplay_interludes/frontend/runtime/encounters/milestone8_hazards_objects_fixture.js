(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m8_hazards_objects_v1',
        title: 'Milestone 8 Hazards And Objects Fixture',
        seed: 'tds_fixture_m8_hazards_objects_seed_v1',
        budgets: {
            maxEnemiesAlive: 20,
            maxEnemyBulletsAlive: 320,
            maxPlayerBulletsAlive: 150,
            maxEmittersAlive: 12,
            maxHazardsAlive: 40,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 32,
            maxActionsPerSecond: 140,
            maxEncounterSeconds: 160
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
                spreadDegrees: 44,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            }
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.2,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 880
            }
        },
        hazards: {
            storm_damage: {
                type: 'damage_circle',
                shape: 'circle',
                radius: 130,
                durationSeconds: 16,
                tickIntervalSeconds: 0.35,
                damage: 1,
                source: { type: 'arena_center' }
            },
            force_lane: {
                type: 'push_zone',
                shape: 'line',
                width: 250,
                length: 720,
                angle: 0,
                durationSeconds: 12,
                tickIntervalSeconds: 0.15,
                force: 180,
                source: { type: 'fixed_point', x: 0, y: -180 }
            },
            healing_corner: {
                type: 'healing_zone',
                shape: 'circle',
                radius: 110,
                durationSeconds: 14,
                tickIntervalSeconds: 0.5,
                damage: 1,
                source: { type: 'fixed_point', x: 520, y: 420 }
            }
        },
        objects: {
            defense_core: {
                type: 'protect_target',
                team: 'ally',
                hp: 28,
                radius: 34,
                source: { type: 'arena_center' },
                onDestroyed: [
                    { type: 'show_banner', text: 'Defense core destroyed!' },
                    { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' }
                ]
            },
            capture_anchor: {
                type: 'capture_point',
                team: 'neutral',
                hp: 999,
                radius: 46,
                capture: true,
                source: { type: 'fixed_point', x: -420, y: 360 }
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Survive hazards and defend the core',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                        { type: 'spawn_hazard', hazard: 'storm_damage' },
                        { type: 'spawn_hazard', hazard: 'force_lane' },
                        { type: 'spawn_hazard', hazard: 'healing_corner' },
                        { type: 'spawn_object', object: 'defense_core' },
                        { type: 'spawn_object', object: 'capture_anchor' }
                    ],
                    rules: [
                        {
                            when: { type: 'player_entered_zone', zone: 'capture_anchor' },
                            do: [{ type: 'show_banner', text: 'Capture zone entered' }]
                        },
                        {
                            when: { type: 'object_destroyed', object: 'defense_core' },
                            do: [{ type: 'show_banner', text: 'Core lost. Hold your ground.' }]
                        },
                        {
                            when: { type: 'time_elapsed', seconds: 35 },
                            do: [{ type: 'clear_hazards' }, { type: 'win' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
