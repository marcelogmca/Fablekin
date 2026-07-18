(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m14_arena_modifiers_v1',
        title: 'Milestone 14 Arena Modifiers Fixture',
        seed: 'tds_fixture_m14_seed_v1',
        arena: {
            mapSize: 1450,
            gridSpacing: 100,
            shape: 'diamond',
            bounds: 'soft',
            backgroundPreset: 'crimson_grid',
            modifiers: [
                { id: 'opening_shrink', type: 'shrink_arena', scale: 0.88, durationSeconds: 16 },
                { id: 'opening_wind', type: 'periodic_wind', strength: 120, periodSeconds: 2.6, durationSeconds: 18 }
            ]
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 20,
                speed: 1.2,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 920
            }
        },
        objectives: [
            { id: 'survive_arena_mods', type: 'survive_time', title: 'Survive shifting arena conditions', target: 36, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Arena modifier flow test',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 4, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 8 },
                            do: [
                                {
                                    type: 'apply_arena_modifier',
                                    modifier: { id: 'edge_damage', type: 'damage_edge', damagePerSecond: 4.2, durationSeconds: 12 }
                                },
                                {
                                    type: 'apply_arena_modifier',
                                    modifier: { id: 'mud_zone', type: 'mud_slow_patches', durationSeconds: 10 }
                                }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 14 },
                            do: [
                                {
                                    type: 'apply_arena_modifier',
                                    modifier: { id: 'spawn_gate', type: 'enemy_spawn_gates', cycleSeconds: 3.2, openSeconds: 1.2, durationSeconds: 12 }
                                },
                                {
                                    type: 'spawn_enemy',
                                    enemyType: 'scout',
                                    count: 2,
                                    formation: 'left_right'
                                }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 20 },
                            do: [
                                {
                                    type: 'apply_arena_modifier',
                                    modifier: { id: 'safe_wedge', type: 'rotating_safe_wedge', halfAngleDegrees: 34, rotationSpeedDegreesPerSecond: 55, durationSeconds: 10 }
                                },
                                {
                                    type: 'apply_arena_modifier',
                                    modifier: { id: 'zoom_phase', type: 'camera_zoom_phase', zoom: 1.16, durationSeconds: 7 }
                                }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 26 },
                            do: [
                                { type: 'remove_arena_modifier', modifierId: 'mud_zone' },
                                { type: 'apply_arena_modifier', modifier: { id: 'bullet_wrap_short', type: 'bullet_wrap', durationSeconds: 6 } }
                            ]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 32 },
                            do: [{ type: 'clear_arena_modifiers', reason: 'fixture_cleanup' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
