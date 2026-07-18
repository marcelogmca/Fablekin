(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_weird_llm_showcase_v1',
        title: 'Weird LLM Showcase',
        seed: 'tds_example_weird_llm_showcase_seed',
        arena: {
            shape: 'ring',
            bounds: 'damage',
            modifiers: [{ id: 'slow_rotate', type: 'rotating_safe_wedge', durationSeconds: 14, speedDegPerSecond: 16 }]
        },
        hazards: {
            pulse_ring: { type: 'expanding_ring', shape: 'ring', radius: 80, growthPerSecond: 55, durationSeconds: 8, tickIntervalSeconds: 0.4, damage: 1, source: { type: 'arena_center' } }
        },
        emitters: {
            orbit_left: {
                emitterId: 'orbit_left',
                source: { type: 'arena_edge', edge: 'left', position: 0.25 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.7,
                durationSeconds: 14,
                movement: { type: 'linear', vx: 55, vy: 35 }
            }
        },
        resultRules: [
            { id: 'wild_survivor', when: { type: 'duration_above', seconds: 16 }, tags: ['chaos_survivor'] }
        ],
        sequence: {
            startPhase: 'chaos',
            phases: [
                {
                    id: 'chaos',
                    objective: 'Survive the strange pattern stack.',
                    enter: [
                        { type: 'apply_arena_modifier', modifier: { id: 'low_vis', type: 'darkened_visibility', intensity: 0.2, durationSeconds: 12 } },
                        { type: 'spawn_hazard', hazard: 'pulse_ring' },
                        { type: 'spawn_emitter', emitter: 'orbit_left' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 6 }, do: [{ type: 'set_music_intensity', level: 'high' }] },
                        { when: { type: 'phase_elapsed', seconds: 10 }, do: [{ type: 'clear_hazards' }] },
                        { when: { type: 'time_elapsed', seconds: 18 }, do: [{ type: 'clear_emitters' }, { type: 'clear_arena_modifiers' }, { type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
