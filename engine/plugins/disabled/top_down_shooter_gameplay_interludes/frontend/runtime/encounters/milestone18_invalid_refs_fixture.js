(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m18_invalid_refs_v1',
        title: 'Milestone 18 Invalid Refs Fixture',
        seed: 'tds_fixture_m18_invalid_seed_v1',
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'ghost_enemy', count: 2 },
                        { type: 'spawn_pickup', pickup: 'missing_pickup' }
                    ],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 2 }, do: [{ type: 'fire_pattern', pattern: 'missing_pattern' }] },
                        { when: { type: 'phase_elapsed', seconds: 3 }, do: [{ type: 'spawn_hazard', hazard: 'missing_hazard' }] },
                        { when: { type: 'phase_elapsed', seconds: 4 }, do: [{ type: 'transition_phase', phase: 'missing_phase' }] }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
