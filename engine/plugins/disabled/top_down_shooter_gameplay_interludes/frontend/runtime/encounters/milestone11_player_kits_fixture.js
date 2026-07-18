(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m11_player_kits_v1',
        title: 'Milestone 11 Player Kit Fixture',
        seed: 'tds_fixture_m11_seed_v1',
        playerKit: {
            id: 'mage_v1',
            maxHp: 7,
            moveSpeed: 4.8,
            autoAttack: {
                intervalMs: 170,
                projectileSpeed: 9.4
            },
            dash: {
                variant: 'phased_dash'
            },
            abilities: [
                {
                    id: 'flare_burst',
                    key: 'q',
                    cooldownSeconds: 5,
                    charges: 1,
                    castActions: [
                        {
                            type: 'spawn_pattern',
                            pattern: {
                                type: 'radial',
                                count: 12,
                                speed: 4.4,
                                projectileType: 'player_default_bullet'
                            }
                        }
                    ]
                },
                {
                    id: 'aegis_window',
                    key: 'e',
                    cooldownSeconds: 8,
                    charges: 1,
                    castActions: [
                        { type: 'aegis_window', durationSeconds: 1.5 },
                        { type: 'clear_enemy_bullets', radius: 180 }
                    ]
                }
            ]
        },
        enemyTypes: {
            scout: {
                hp: 10,
                radius: 22,
                speed: 1.2,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 940
            }
        },
        objectives: [
            { id: 'survive_test', type: 'survive_time', title: 'Survive the trial', target: 20, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Use Q/E abilities during combat',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 6 },
                            do: [{ type: 'set_player_dash_variant', variant: 'blink_short' }]
                        },
                        {
                            when: { type: 'player_ability_used', abilityId: 'flare_burst', withinSeconds: 2.2 },
                            do: [{ type: 'show_banner', text: 'Flare burst detected' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 10 },
                            do: [{
                                type: 'grant_player_ability',
                                ability: {
                                    id: 'focus_beam',
                                    key: 'q',
                                    cooldownSeconds: 6,
                                    charges: 1,
                                    castActions: [
                                        {
                                            type: 'spawn_pattern',
                                            pattern: {
                                                type: 'line',
                                                count: 5,
                                                speed: 5.2,
                                                spacing: 36,
                                                projectileType: 'player_default_bullet',
                                                aim: { type: 'toward_cursor' }
                                            }
                                        }
                                    ]
                                }
                            }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 12 },
                            do: [{ type: 'reset_player_ability_cooldown', abilityId: 'focus_beam' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 16 },
                            do: [{ type: 'remove_player_ability', abilityId: 'focus_beam' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
