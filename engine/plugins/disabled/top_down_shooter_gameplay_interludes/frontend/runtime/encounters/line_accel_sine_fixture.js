(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_line_accel_sine_v1',
        title: 'Fixture: Line + Accelerate + Sine',
        seed: 'tds_fixture_line_accel_sine_seed_v1',
        budgets: {
            maxEnemiesAlive: 16,
            maxEnemyBulletsAlive: 260,
            maxPlayerBulletsAlive: 140,
            maxActionsPerSecond: 90
        },
        arena: {
            mapSize: 1500,
            gridSpacing: 90
        },
        player: {
            hp: 6
        },
        colors: {
            grid: 0x2a385e,
            player: 0x3af3ff,
            enemyBullet: 0xff6ca8
        },
        pressurePattern: {
            enabled: false,
            intervalMs: 120,
            originRadius: 620,
            bulletLifeTicks: 340,
            bulletSpeed: 3.2,
            bulletVz: -0.1,
            ringCount: 4,
            pattern: {
                type: 'spiral',
                count: 4,
                speed: 3.2,
                angleOffset: 0
            }
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'line',
                count: 6,
                speed: 2.35,
                baseAngle: 1.1,
                spacing: 68,
                projectileType: 'enemy_wave_lance',
                modifiers: [
                    { type: 'accelerate', perSecond: 0.42 },
                    { type: 'sine_wave', amplitude: 18, frequency: 1.25 },
                    { type: 'split_after_time', timeSeconds: 0.9, count: 3, speed: 2.2 }
                ]
            }
        },
        projectileTypes: {
            enemy_wave_lance: {
                team: 'enemy',
                damage: 1,
                radius: 8,
                lifeTicks: 340,
                vz: -0.05,
                color: 0xff6ca8,
                collision: {
                    destroyOnHit: true,
                    pierce: 0,
                    canBeCleared: true,
                    activeAfterSeconds: 0.08,
                    hitCooldownByTarget: 0.05,
                    friendlyFire: false
                },
                render: {
                    preset: 'diamond',
                    color: 0xff6ca8,
                    alpha: 0.95,
                    glow: true,
                    scale: 1.05,
                    rotationMode: 'velocity'
                }
            }
        },
        enemyTypes: {
            scout: {
                hp: 9,
                radius: 21,
                speed: 1.45,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 780
            },
            sentry: {
                hp: 17,
                radius: 25,
                speed: 0.82,
                behavior: 'keep_distance',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 640
            },
            captain: {
                hp: 78,
                radius: 36,
                speed: 0.9,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 470,
                boss: true,
                phaseThresholds: [0.66, 0.33]
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Fixture: survive and clear',
                    enter: [
                        { type: 'show_banner', text: 'Modifier fixture online' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'sentry', count: 1, formation: 'random' }
                    ],
                    rules: [
                        {
                            when: { type: 'time_elapsed', seconds: 6 },
                            repeat: { everySeconds: 5, limit: 2 },
                            do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 1, formation: 'random' }]
                        },
                        {
                            when: { type: 'enemy_defeated_count', count: 3 },
                            do: [{ type: 'transition_phase', phase: 'finale' }]
                        }
                    ]
                },
                {
                    id: 'finale',
                    objective: 'Defeat the captain',
                    enter: [
                        { type: 'show_banner', text: 'Fixture finale' },
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, at: { x: 0, y: -120 } }
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
