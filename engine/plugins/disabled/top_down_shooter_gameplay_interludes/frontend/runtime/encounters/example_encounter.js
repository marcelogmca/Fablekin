(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_glass_ambush_v1',
        title: 'Glass Ambush',
        seed: 'tds_glass_ambush_seed_v1',
        budgets: {
            maxEnemiesAlive: 18,
            maxEnemyBulletsAlive: 260,
            maxPlayerBulletsAlive: 140,
            maxEmittersAlive: 12,
            maxActionsPerSecond: 90,
            maxEncounterSeconds: 95
        },
        arena: {
            mapSize: 1600,
            gridSpacing: 92
        },
        player: {
            hp: 6
        },
        colors: {
            grid: 0x26406a,
            player: 0x39f2ff,
            enemyBullet: 0xff3f8d
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 5,
                speed: 2.7,
                spreadDegrees: 34,
                projectileType: 'enemy_sand_lance',
                aim: { type: 'toward_player' },
                modifiers: [{ type: 'accelerate', perSecond: 0.35 }]
            },
            captain_ring: {
                type: 'radial',
                count: 12,
                speed: 2.25,
                projectileType: 'enemy_sand_lance',
                modifiers: [{ type: 'sine_wave', amplitude: 9, frequency: 1.1 }]
            },
            captain_line: {
                type: 'line',
                count: 7,
                speed: 3.0,
                spacing: 52,
                projectileType: 'enemy_sand_lance',
                aim: { type: 'toward_player' },
                modifiers: [{ type: 'split_after_time', timeSeconds: 0.95, count: 3, speed: 2.2 }]
            }
        },
        emitters: {
            opening_edge_emitter: {
                emitterId: 'opening_edge_emitter',
                source: { type: 'arena_edge', edge: 'right', position: 0.45 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.85,
                durationSeconds: 8,
                startDelaySeconds: 0.2,
                aim: { type: 'toward_player' },
                movement: { type: 'linear', vx: -85, vy: 10 }
            }
        },
        pickups: {
            med_orb: {
                id: 'med_orb',
                type: 'heal_orb',
                radius: 18,
                durationSeconds: 12
            },
            reset_orb: {
                id: 'reset_orb',
                type: 'cooldown_reset',
                radius: 18,
                durationSeconds: 10
            }
        },
        projectileTypes: {
            enemy_sand_lance: {
                team: 'enemy',
                damage: 1,
                radius: 8,
                lifeTicks: 320,
                vz: -0.05,
                color: 0xff3f8d
            }
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.5,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 860
            },
            sentry: {
                hp: 17,
                radius: 25,
                speed: 0.85,
                behavior: 'stationary_turret',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 700
            },
            ranger: {
                hp: 12,
                radius: 21,
                speed: 1.05,
                behavior: 'keep_distance',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 760
            },
            charger: {
                hp: 20,
                radius: 24,
                speed: 1.2,
                behavior: 'charge_telegraphed',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 940
            },
            captain: {
                hp: 165,
                radius: 40,
                speed: 0.9,
                behavior: 'boss_anchor',
                boss: true,
                bossId: 'glass_captain',
                displayName: 'Glass Captain',
                attackPatternId: 'captain_ring',
                attackIntervalMs: 620,
                attacks: [
                    { id: 'ring', pattern: 'captain_ring', everySeconds: 2.2, weight: 1 },
                    { id: 'line', pattern: 'captain_line', everySeconds: 1.4, weight: 2 }
                ],
                bossPhases: [
                    { id: 'phase_1', untilHpRatio: 0.65, attackDeckMode: 'weighted_deck', attackDeck: ['ring', 'line'], onEnter: [{ type: 'show_banner', text: 'Captain engages' }] },
                    { id: 'phase_2', untilHpRatio: 0.3, attackDeckMode: 'weighted_deck', attackDeck: ['line', 'ring'], onEnter: [{ type: 'show_banner', text: 'Captain enraged' }] },
                    { id: 'phase_3', untilHpRatio: 0.01, attackDeckMode: 'weighted_deck', attackDeck: ['line', 'line', 'ring'], onEnter: [{ type: 'show_banner', text: 'Final volley' }] }
                ]
            }
        },
        objectives: [
            { id: 'captain_down', type: 'defeat_boss', title: 'Defeat the Glass Captain', target: 1, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Survive the ambush and push through.',
                    enter: [
                        { type: 'show_banner', text: 'Glass Ambush' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'ranger', count: 1, formation: 'random' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 4 },
                            repeat: { everySeconds: 7, limit: 2 },
                            do: [
                                {
                                    type: 'telegraph_then_fire',
                                    shape: 'circle',
                                    style: 'danger',
                                    radius: 140,
                                    durationSeconds: 0.7,
                                    source: { type: 'arena_center' },
                                    pattern: 'enemy_spiral_pressure'
                                }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 6 },
                            do: [{ type: 'spawn_emitter', emitter: 'opening_edge_emitter' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 15 },
                            do: [{ type: 'clear_emitters' }]
                        },
                        {
                            when: { type: 'enemy_defeated_count', count: 5 },
                            do: [{ type: 'transition_phase', phase: 'boss' }]
                        }
                    ]
                },
                {
                    id: 'boss',
                    objective: 'Defeat the Glass Captain.',
                    enter: [
                        { type: 'show_banner', text: 'Boss: Glass Captain' },
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, at: { x: 0, y: -120 } },
                        { type: 'spawn_enemy', enemyType: 'sentry', count: 1, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'charger', count: 1, formation: 'random' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 7 }, do: [{ type: 'spawn_pickup', pickup: 'med_orb', at: { type: 'arena_center' } }] },
                        { when: { type: 'boss_hp_below', ratio: 0.45 }, do: [{ type: 'spawn_pickup', pickup: 'reset_orb', at: { type: 'arena_center' } }] },
                        { when: { type: 'objective_completed', objective: 'captain_down' }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
