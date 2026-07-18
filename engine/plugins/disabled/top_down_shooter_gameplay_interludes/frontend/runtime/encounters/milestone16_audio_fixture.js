(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_m16_audio_hooks_v1',
        title: 'Milestone 16 Audio Hooks Fixture',
        seed: 'tds_fixture_m16_seed_v1',
        music: {
            intensityTiers: {
                low: 'battle_random',
                high: 'battle_random'
            },
            intensityRules: [
                {
                    id: 'high_pressure',
                    priority: 20,
                    cooldownSeconds: 3,
                    setIntensity: 'high',
                    when: { type: 'enemy_count_at_least', count: 4 }
                },
                {
                    id: 'recover_low',
                    priority: 5,
                    cooldownSeconds: 3,
                    setIntensity: 'low',
                    when: { type: 'enemy_count_below', count: 4 }
                }
            ]
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
            captain: {
                hp: 70,
                radius: 34,
                speed: 0.9,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 520,
                boss: true,
                bossId: 'audio_captain',
                displayName: 'Audio Captain',
                phaseThresholds: [0.66, 0.33]
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Audio action check',
                    enter: [
                        { type: 'set_music', track: 'battle_random' },
                        { type: 'spawn_enemy', enemyType: 'captain', count: 1, formation: 'left_right' },
                        { type: 'spawn_enemy', enemyType: 'scout', count: 3, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'boss_phase_is', phaseId: 'phase_2' },
                            do: [
                                { type: 'music_stinger', track: 'battle_random' },
                                { type: 'set_music_intensity', level: 'high', cooldownSeconds: 2 }
                            ]
                        },
                        {
                            when: { type: 'enemy_type_defeated_count', enemyType: 'captain', count: 1 },
                            do: [
                                { type: 'restore_music' },
                                { type: 'win' }
                            ]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
