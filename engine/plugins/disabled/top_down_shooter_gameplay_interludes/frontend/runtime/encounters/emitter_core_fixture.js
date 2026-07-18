(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_fixture_emitter_core_v1',
        title: 'Emitter Core Fixture',
        seed: 'tds_fixture_emitter_core_seed_v1',
        budgets: {
            maxEnemiesAlive: 10,
            maxEnemyBulletsAlive: 260,
            maxPlayerBulletsAlive: 120,
            maxEmittersAlive: 12,
            maxHazardsAlive: 20,
            maxTelegraphsAlive: 30,
            maxActionsPerSecond: 120,
            maxEncounterSeconds: 90
        },
        arena: {
            mapSize: 1500,
            gridSpacing: 96
        },
        player: { hp: 6 },
        colors: {
            grid: 0x1f3557,
            player: 0x39f2ff,
            enemyBullet: 0xff3f8d
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'line',
                count: 5,
                speed: 2.7,
                spacing: 60,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            }
        },
        emitters: {
            edge_beam: {
                emitterId: 'edge_beam',
                source: { type: 'arena_edge', edge: 'top', position: 0.3 },
                pattern: 'enemy_spiral_pressure',
                intervalSeconds: 0.55,
                durationSeconds: 12,
                startDelaySeconds: 0.25,
                aim: { type: 'toward_player' },
                movement: { type: 'linear', vx: 90, vy: 0 }
            }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Emitter control fixture',
                    enter: [
                        { type: 'spawn_emitter', emitter: 'edge_beam' }
                    ],
                    rules: [
                        {
                            when: { type: 'phase_elapsed', seconds: 3 },
                            do: [{ type: 'pause_emitter', emitterId: 'edge_beam' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 5 },
                            do: [{ type: 'resume_emitter', emitterId: 'edge_beam' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 8 },
                            do: [{ type: 'stop_emitter', emitterId: 'edge_beam' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 10 },
                            do: [{ type: 'clear_emitters' }]
                        },
                        {
                            when: { type: 'phase_elapsed', seconds: 12 },
                            do: [{ type: 'win' }]
                        }
                    ]
                }
            ]
        }
    };

    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
