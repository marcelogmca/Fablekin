(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_emitter_showcase_v1',
        title: 'Emitter Showcase',
        seed: 'tds_example_emitter_showcase_seed',
        emitters: {
            left_stream: {
                emitterId: 'left_stream',
                source: { type: 'arena_edge', edge: 'left', position: 0.5 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.9,
                durationSeconds: 20,
                movement: { type: 'linear', vx: 40, vy: 10 }
            },
            right_stream: {
                emitterId: 'right_stream',
                source: { type: 'arena_edge', edge: 'right', position: 0.5 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.9,
                durationSeconds: 20,
                movement: { type: 'linear', vx: -40, vy: -10 }
            }
        },
        sequence: {
            startPhase: 'emitters',
            phases: [
                {
                    id: 'emitters',
                    objective: 'Observe emitter controls.',
                    enter: [
                        { type: 'spawn_emitter', emitter: 'left_stream' },
                        { type: 'spawn_emitter', emitter: 'right_stream' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 6 }, do: [{ type: 'pause_emitter', emitterId: 'left_stream' }] },
                        { when: { type: 'phase_elapsed', seconds: 9 }, do: [{ type: 'resume_emitter', emitterId: 'left_stream' }] },
                        { when: { type: 'phase_elapsed', seconds: 13 }, do: [{ type: 'stop_emitter', emitterId: 'right_stream' }] },
                        { when: { type: 'time_elapsed', seconds: 18 }, do: [{ type: 'clear_emitters' }, { type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
