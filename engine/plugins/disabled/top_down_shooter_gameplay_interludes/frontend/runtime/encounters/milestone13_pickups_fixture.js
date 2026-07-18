(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m13_pickups_v1',
        title: 'Milestone 13 Pickups Fixture',
        seed: 'tds_fixture_m13_seed_v1',
        statusEffects: {
            pickup_haste: {
                id: 'pickup_haste',
                category: 'buff',
                durationSeconds: 7,
                maxStacks: 1,
                tickIntervalSeconds: 0.5,
                modifiers: [{ type: 'movement_scalar', value: 1.2 }]
            }
        },
        pickups: {
            heal_orb_small: {
                id: 'heal_orb_small',
                type: 'heal_orb',
                radius: 18,
                durationSeconds: 12,
                dropWeight: 1
            },
            cooldown_reset_core: {
                id: 'cooldown_reset_core',
                type: 'cooldown_reset',
                radius: 19,
                durationSeconds: 10,
                dropWeight: 0.65
            },
            haste_pickup: {
                id: 'haste_pickup',
                type: 'status_pickup',
                radius: 20,
                durationSeconds: 14,
                statusOnPickup: 'pickup_haste',
                dropWeight: 0.45
            }
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.2,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 980,
                pickupDrops: [
                    { pickup: 'heal_orb_small', weight: 1 },
                    { pickup: 'haste_pickup', weight: 0.6 }
                ]
            },
            sentry: {
                hp: 16,
                radius: 25,
                speed: 0.85,
                behavior: 'stationary_turret',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 760,
                pickupDrops: [
                    { pickup: 'cooldown_reset_core', weight: 1 },
                    { pickup: 'heal_orb_small', weight: 0.4 }
                ]
            }
        },
        objectives: [
            { id: 'collect_two', type: 'survive_time', title: 'Collect at least 2 pickups', target: 40, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Collect pickup drops',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'sentry', count: 1, formation: 'left_right' },
                        { type: 'spawn_pickup', pickup: 'heal_orb_small', at: { type: 'fixed_point', x: -120, y: -40 } }
                    ],
                    rules: [
                        {
                            when: { type: 'pickup_collected_count', count: 2 },
                            do: [{ type: 'show_banner', text: 'Pickup objective complete' }]
                        },
                        {
                            when: { type: 'pickup_collected', pickup: 'cooldown_reset_core', withinSeconds: 3 },
                            do: [{ type: 'show_banner', text: 'Cooldown reset collected' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 18 },
                            do: [{ type: 'spawn_pickup', pickup: 'haste_pickup', at: { type: 'arena_center' } }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
