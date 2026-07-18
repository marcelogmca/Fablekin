(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_capture_zones_v1',
        title: 'Capture Zones: Three Sigils',
        seed: 'tds_example_capture_zones_seed',
        objects: {
            sigil_a: { type: 'capture_point', team: 'neutral', hp: 999, radius: 42, capture: true, source: { type: 'fixed_point', x: -420, y: 280 } },
            sigil_b: { type: 'capture_point', team: 'neutral', hp: 999, radius: 42, capture: true, source: { type: 'fixed_point', x: 420, y: 280 } },
            sigil_c: { type: 'capture_point', team: 'neutral', hp: 999, radius: 42, capture: true, source: { type: 'fixed_point', x: 0, y: -320 } }
        },
        objectives: [
            { id: 'reach_a', type: 'reach_zone', title: 'Reach Sigil A', zoneId: 'sigil_a', required: true },
            { id: 'reach_b', type: 'reach_zone', title: 'Reach Sigil B', zoneId: 'sigil_b', required: true },
            { id: 'reach_c', type: 'reach_zone', title: 'Reach Sigil C', zoneId: 'sigil_c', required: true }
        ],
        enemyTypes: {
            scout: { hp: 8, radius: 19, speed: 1.4, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 860 }
        },
        sequence: {
            startPhase: 'capture',
            phases: [
                {
                    id: 'capture',
                    objective: 'Touch all three sigils.',
                    enter: [
                        { type: 'spawn_object', object: 'sigil_a' },
                        { type: 'spawn_object', object: 'sigil_b' },
                        { type: 'spawn_object', object: 'sigil_c' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'random' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 8 }, do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'random' }] },
                        { when: { type: 'phase_elapsed', seconds: 16 }, do: [{ type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'random' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
