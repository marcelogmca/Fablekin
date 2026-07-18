(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m15_render_feedback_v1',
        title: 'Milestone 15 Render And Feedback Fixture',
        seed: 'tds_fixture_m15_seed_v1',
        runtimeSettings: {
            showDamageNumbers: true,
            enableMicroHitStop: true
        },
        renderPresets: {
            playerBullets: {
                default: { preset: 'needle', color: 0x65f5ff, alpha: 0.95, glow: true, scale: 1.05 }
            },
            enemyBullets: {
                default: { preset: 'orb', color: 0xff4f86, alpha: 0.9, glow: true, scale: 1.05 }
            },
            hazards: {
                default: { fillColor: 0xff3a68, strokeColor: 0xffb8cc, fillAlpha: 0.14, strokeAlpha: 0.78, lineWidth: 2.4 }
            },
            telegraphs: {
                danger: { color: 0xff546f, lineWidth: 3.2, strokeAlpha: 0.92, baseAlpha: 0.28 },
                boss: { color: 0xffab42, lineWidth: 4, strokeAlpha: 0.96, baseAlpha: 0.35 }
            },
            pickups: {
                heal_orb: { color: 0x72ffaa, fillAlpha: 0.45, strokeAlpha: 0.95 },
                cooldown_reset: { color: 0x79dfff, fillAlpha: 0.45, strokeAlpha: 0.95 }
            },
            enemyArchetypes: {
                default: { fillColor: 0xff5d96, ringColor: 0xffa4c0, alpha: 1 },
                sentry: { fillColor: 0xff7a73, ringColor: 0xffb3a9, alpha: 1 }
            },
            bosses: {
                default: { fillColor: 0xffaa4f, ringColor: 0xffcf8a, alpha: 1 }
            },
            objectiveObjects: {
                default: { fillColor: 0x62a9ff, strokeColor: 0xb5d6ff, fillAlpha: 0.2, strokeAlpha: 0.88 }
            }
        },
        enemyTypes: {
            scout: {
                hp: 9,
                radius: 20,
                speed: 1.25,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 760
            },
            sentry: {
                hp: 16,
                radius: 24,
                speed: 0.9,
                behavior: 'stationary_turret',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 560
            },
            captain: {
                hp: 86,
                radius: 36,
                speed: 0.9,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 480,
                boss: true,
                bossId: 'captain',
                displayName: 'Feedback Captain',
                phaseThresholds: [0.7, 0.35]
            }
        },
        hazards: {
            hazard_lane: {
                type: 'damage_line',
                shape: 'line',
                width: 120,
                length: 720,
                durationSeconds: 4.8,
                damage: 1
            }
        },
        objectives: [
            { id: 'survive_dense', type: 'survive_time', title: 'Survive dense pressure', target: 32, required: true }
        ],
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Readability stress test',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'sentry', count: 3, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 6, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 5 },
                            do: [{ type: 'spawn_hazard', hazard: 'hazard_lane', at: { type: 'arena_center' } }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 10 },
                            do: [{ type: 'spawn_pickup', pickup: { type: 'cooldown_reset', radius: 18, durationSeconds: 8 }, at: { type: 'arena_center' } }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 14 },
                            do: [{ type: 'apply_arena_modifier', modifier: { id: 'vis_darken', type: 'darkened_visibility', intensity: 0.22, durationSeconds: 8 } }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
