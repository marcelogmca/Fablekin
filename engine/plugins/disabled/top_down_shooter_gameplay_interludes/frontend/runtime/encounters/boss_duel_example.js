(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_boss_duel_v1',
        title: 'Boss Duel: Shield Warden',
        seed: 'tds_example_boss_duel_seed',
        enemyTypes: {
            shield_warden: {
                hp: 180,
                radius: 40,
                speed: 0.9,
                behavior: 'boss_anchor',
                boss: true,
                bossId: 'shield_warden',
                displayName: 'Shield Warden',
                shieldRatio: 0.35,
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 520,
                bossPhases: [
                    { id: 'phase_1', untilHpRatio: 0.6, attackDeckMode: 'weighted_deck', attackDeck: ['ring', 'fan'], onEnter: [{ type: 'show_banner', text: 'Warden awakens' }] },
                    { id: 'phase_2', untilHpRatio: 0.25, attackDeckMode: 'sequence', attackDeck: ['fan', 'line', 'ring'], onEnter: [{ type: 'show_banner', text: 'Shield pressure rising' }] },
                    { id: 'phase_3', untilHpRatio: 0.01, attackDeckMode: 'phase_loop', attackDeck: ['line', 'ring'], onEnter: [{ type: 'show_banner', text: 'Final stand' }] }
                ],
                attacks: [
                    { id: 'fan', pattern: 'enemy_spiral_pressure', everySeconds: 1.2, weight: 2, label: 'Shards' },
                    { id: 'ring', pattern: 'enemy_ring', everySeconds: 2.3, weight: 1, label: 'Barrier Ring' },
                    { id: 'line', pattern: 'enemy_line', everySeconds: 1.7, weight: 2, label: 'Shield Lance' }
                ]
            }
        },
        patterns: {
            enemy_spiral_pressure: { type: 'fan', count: 6, speed: 2.6, spreadDegrees: 38, projectileType: 'enemy_default_bullet', aim: { type: 'toward_player' } },
            enemy_ring: { type: 'radial', count: 12, speed: 2.4, projectileType: 'enemy_default_bullet' },
            enemy_line: { type: 'line', count: 7, speed: 3, spacing: 54, projectileType: 'enemy_default_bullet', aim: { type: 'toward_player' } }
        },
        sequence: {
            startPhase: 'duel',
            phases: [
                {
                    id: 'duel',
                    objective: 'Defeat the Shield Warden.',
                    enter: [{ type: 'spawn_enemy', enemyType: 'shield_warden', count: 1, at: { x: 0, y: -120 } }],
                    rules: [{ when: { type: 'enemy_type_defeated_count', enemyType: 'shield_warden', count: 1 }, do: [{ type: 'win' }] }]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
