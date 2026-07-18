(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_survive_timer_v1',
        title: 'Survive Timer: Crossfire',
        seed: 'tds_example_survive_timer_seed_v1',
        objectives: [
            { id: 'hold_line', type: 'survive_time', title: 'Survive for 24 seconds', target: 24, required: true }
        ],
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 5,
                speed: 2.45,
                spreadDegrees: 34,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            },
            ring_pressure: {
                type: 'radial',
                count: 10,
                speed: 2.15,
                projectileType: 'enemy_default_bullet',
                modifiers: [{ type: 'sine_wave', amplitude: 8, frequency: 1.2 }]
            }
        },
        emitters: {
            left_edge: {
                emitterId: 'left_edge',
                source: { type: 'arena_edge', edge: 'left', position: 0.35 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.8,
                durationSeconds: 9,
                startDelaySeconds: 0.2,
                aim: { type: 'toward_player' }
            },
            right_edge: {
                emitterId: 'right_edge',
                source: { type: 'arena_edge', edge: 'right', position: 0.65 },
                pattern: 'ring_pressure',
                intervalSeconds: 1.1,
                durationSeconds: 8.5,
                startDelaySeconds: 0.6,
                aim: { type: 'toward_player' }
            }
        },
        pickups: {
            med_orb: {
                id: 'med_orb',
                type: 'heal_orb',
                radius: 18,
                durationSeconds: 10
            }
        },
        enemyTypes: {
            scout: { hp: 8, radius: 19, speed: 1.35, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 880 },
            sentry: { hp: 13, radius: 23, speed: 0.85, behavior: 'stationary_turret', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 760 }
        },
        sequence: {
            startPhase: 'hold',
            phases: [
                {
                    id: 'hold',
                    objective: 'Stay alive while crossfire ramps up.',
                    enter: [
                        { type: 'show_banner', text: 'Hold Position' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 3 }, do: [{ type: 'spawn_emitter', emitter: 'left_edge' }] },
                        { when: { type: 'phase_elapsed', seconds: 7 }, do: [{ type: 'spawn_enemy', enemyType: 'sentry', count: 1, formation: 'random' }] },
                        { when: { type: 'phase_elapsed', seconds: 9 }, do: [{ type: 'spawn_emitter', emitter: 'right_edge' }] },
                        { when: { type: 'phase_elapsed', seconds: 15 }, do: [{ type: 'spawn_pickup', pickup: 'med_orb', at: { type: 'arena_center' } }] },
                        { when: { type: 'objective_completed', objective: 'hold_line' }, do: [{ type: 'clear_emitters' }, { type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
