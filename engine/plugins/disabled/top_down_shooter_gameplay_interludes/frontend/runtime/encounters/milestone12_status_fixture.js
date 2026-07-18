(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m12_status_v1',
        title: 'Milestone 12 Status Fixture',
        seed: 'tds_fixture_m12_seed_v1',
        statusEffects: {
            haste_aura: {
                id: 'haste_aura',
                category: 'buff',
                durationSeconds: 8,
                maxStacks: 3,
                tickIntervalSeconds: 0.5,
                modifiers: [
                    { type: 'movement_scalar', value: 1.12, perStack: true },
                    { type: 'outgoing_damage_scalar', value: 1.08, perStack: true }
                ]
            },
            sand_bleed: {
                id: 'sand_bleed',
                category: 'debuff',
                durationSeconds: 10,
                maxStacks: 4,
                tickIntervalSeconds: 0.5,
                modifiers: [
                    { type: 'bleed_per_second', value: 0.5, perStack: true },
                    { type: 'incoming_damage_scalar', value: 1.06, perStack: true }
                ]
            }
        },
        objectives: [
            { id: 'survive_status', type: 'survive_time', title: 'Survive while statuses tick', target: 28, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Status application and stacking check',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' },
                        { type: 'apply_status', target: 'player', status: 'haste_aura', stacks: 1 }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 5 },
                            do: [{ type: 'apply_status', target: 'player', status: 'sand_bleed', stacks: 2 }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 11 },
                            do: [{ type: 'apply_status', target: 'player', status: 'haste_aura', stacks: 2 }]
                        },
                        {
                            when: { type: 'status_stacks_at_least', target: 'player', status: 'haste_aura', count: 2 },
                            do: [{ type: 'show_banner', text: 'Haste stacked' }]
                        },
                        {
                            when: { type: 'status_applied_recently', target: 'player', status: 'sand_bleed', withinSeconds: 2 },
                            do: [{ type: 'show_banner', text: 'Bleed applied' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 20 },
                            do: [{ type: 'remove_status', target: 'player', status: 'sand_bleed' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
