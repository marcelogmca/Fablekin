(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_ability_showcase_v1',
        title: 'Ability Showcase',
        seed: 'tds_example_ability_showcase_seed',
        playerKit: {
            id: 'ability_showcase',
            maxHp: 8,
            moveSpeed: 4.8,
            dash: { variant: 'phased_dash', cooldownMs: 1000, durationMs: 170, iframeMs: 260, speedMultiplier: 3.2 },
            abilities: [
                { id: 'flare_burst', key: 'q', cooldownSeconds: 7, charges: 1, castActions: [{ type: 'spawn_pattern', pattern: { type: 'radial', projectileType: 'player_default_bullet', count: 10, speed: 5.6 } }] },
                { id: 'aegis_window', key: 'e', cooldownSeconds: 11, charges: 1, castActions: [{ type: 'aegis_window', durationSeconds: 1.1 }] }
            ]
        },
        enemyTypes: {
            scout: { hp: 10, radius: 20, speed: 1.25, behavior: 'chase_player', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 900 }
        },
        sequence: {
            startPhase: 'ability_demo',
            phases: [
                {
                    id: 'ability_demo',
                    objective: 'Use your kit and clear pressure.',
                    enter: [{ type: 'spawn_enemy', enemyType: 'scout', count: 4, formation: 'left_right' }],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 5 }, do: [{ type: 'grant_player_ability', ability: { id: 'focus_beam', key: 'r', cooldownSeconds: 12, charges: 1, castActions: [{ type: 'spawn_pattern', pattern: { type: 'line', projectileType: 'player_default_bullet', count: 6, speed: 6.2, spacing: 40 } }] } }] },
                        { when: { type: 'phase_elapsed', seconds: 10 }, do: [{ type: 'reset_player_ability_cooldown', abilityId: 'focus_beam' }] },
                        { when: { type: 'time_elapsed', seconds: 20 }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
