(() => {
    const encounter = {
        schemaVersion: 2,
        id: 'tds_example_projectile_showcase_v1',
        title: 'Projectile Showcase',
        seed: 'tds_example_projectile_showcase_seed',
        patterns: {
            enemy_spiral_pressure: {
                type: 'fan',
                count: 5,
                speed: 2.6,
                spreadDegrees: 36,
                projectileType: 'showcase_needle',
                modifiers: [{ type: 'accelerate', perSecond: 0.45 }]
            },
            showcase_ring: {
                type: 'radial',
                count: 12,
                speed: 2.2,
                projectileType: 'showcase_orb',
                modifiers: [{ type: 'sine_wave', amplitude: 10, frequency: 1.4 }]
            },
            showcase_line: {
                type: 'line',
                count: 8,
                speed: 3.1,
                spacing: 52,
                projectileType: 'showcase_lance',
                aim: { type: 'toward_player' }
            }
        },
        projectileTypes: {
            showcase_needle: { team: 'enemy', damage: 1, radius: 7, lifeTicks: 300, color: 0xff5b9d, render: { preset: 'needle', color: 0xff5b9d, rotationMode: 'velocity' } },
            showcase_orb: { team: 'enemy', damage: 1, radius: 8, lifeTicks: 320, color: 0xffc96b, render: { preset: 'orb', color: 0xffc96b, glow: true } },
            showcase_lance: { team: 'enemy', damage: 1, radius: 7, lifeTicks: 280, color: 0xff8f5d, render: { preset: 'diamond', color: 0xff8f5d } }
        },
        enemyTypes: {
            sentry: { hp: 15, radius: 24, speed: 0.9, behavior: 'stationary_turret', attackPatternId: 'enemy_spiral_pressure', attackIntervalMs: 820 }
        },
        sequence: {
            startPhase: 'showcase',
            phases: [
                {
                    id: 'showcase',
                    objective: 'Survive the projectile sampler.',
                    enter: [{ type: 'spawn_enemy', enemyType: 'sentry', count: 2, formation: 'left_right' }],
                    rules: [
                        { when: { type: 'phase_elapsed', seconds: 4 }, do: [{ type: 'telegraph_then_fire', shape: 'circle', style: 'danger', radius: 120, durationSeconds: 0.7, pattern: 'showcase_ring' }] },
                        { when: { type: 'phase_elapsed', seconds: 9 }, do: [{ type: 'fire_pattern', pattern: 'showcase_line' }] },
                        { when: { type: 'time_elapsed', seconds: 18 }, do: [{ type: 'win' }] }
                    ]
                }
            ]
        }
    };
    if (!window.TDSEncounters) window.TDSEncounters = {};
    window.TDSEncounters[encounter.id] = encounter;
})();
