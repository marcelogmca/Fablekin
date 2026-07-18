(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_hazard_showcase_v1',
        title: 'Hazard Showcase',
        seed: 'tds_example_hazard_showcase_seed',
        hazards: {
            lava_pool: { type: 'damage_circle', shape: 'circle', radius: 110, durationSeconds: 10, tickIntervalSeconds: 0.4, damage: 1, source: { type: 'arena_center' } },
            wind_lane: { type: 'wind_zone', shape: 'rectangle', width: 280, length: 140, force: 240, durationSeconds: 10, source: { type: 'fixed_point', x: 320, y: -120 } },
            safe_spot: { type: 'safe_zone', shape: 'circle', radius: 70, durationSeconds: 8, source: { type: 'fixed_point', x: -320, y: 220 } }
        },
        objectives: [{ id: 'hold_hazards', type: 'survive_time', title: 'Survive hazard rotation', target: 18, required: true }],
        sequence: {
            startPhase: 'hazards',
            phases: [
                {
                    id: 'hazards',
                    objective: 'Track hazard timings and spaces.',
                    enter: [{ type: 'spawn_hazard', hazard: 'lava_pool' }],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 4 }, do: [{ type: 'spawn_hazard', hazard: 'wind_lane' }] },
                        { when: { type: 'phase_elapsed', seconds: 8 }, do: [{ type: 'spawn_hazard', hazard: 'safe_spot' }] },
                        { when: { type: 'phase_elapsed', seconds: 14 }, do: [{ type: 'clear_hazards' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
