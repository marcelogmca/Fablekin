((root) => {
    const capabilityModule = (() => {
        if (root?.TDSV1CapabilityProfile?.profile) return root.TDSV1CapabilityProfile;
        if (typeof module !== 'undefined' && module?.exports && typeof require === 'function') {
            try {
                return require('./v1_capability_profile.js');
            } catch (_error) {
                return null;
            }
        }
        return null;
    })();

    const V1_PROFILE = capabilityModule?.profile || {};
    const V1_STRICT_TOP_LEVEL_FIELDS = new Set(Array.isArray(V1_PROFILE.strictTopLevelFields) ? V1_PROFILE.strictTopLevelFields : []);
    const V1_DISALLOWED_TOP_LEVEL_FIELDS = new Set(Array.isArray(V1_PROFILE.disallowedTopLevelFields) ? V1_PROFILE.disallowedTopLevelFields : []);
    const V1_DISALLOWED_SEQUENCE_FIELDS = new Set(Array.isArray(V1_PROFILE.disallowedSequenceFields) ? V1_PROFILE.disallowedSequenceFields : []);
    const V1_PATTERN_TYPES = new Set(Array.isArray(V1_PROFILE.patternTypes) ? V1_PROFILE.patternTypes : ['spiral', 'radial', 'fan', 'aimed', 'line', 'rain']);
    const V1_PROJECTILE_MODIFIERS = new Set(Array.isArray(V1_PROFILE.projectileModifierTypes) ? V1_PROFILE.projectileModifierTypes : ['accelerate', 'sine_wave', 'home_to_player', 'split_after_time']);
    const V1_ENEMY_BEHAVIORS = new Set(Array.isArray(V1_PROFILE.enemyBehaviors) ? V1_PROFILE.enemyBehaviors : ['chase_player', 'stationary_turret', 'keep_distance', 'charge_telegraphed', 'boss_anchor']);
    const V1_OBJECTIVE_TYPES = new Set(Array.isArray(V1_PROFILE.objectiveTypes) ? V1_PROFILE.objectiveTypes : ['survive_time', 'defeat_count', 'defeat_enemy_type', 'defeat_boss']);
    const V1_PICKUP_TYPES = new Set(Array.isArray(V1_PROFILE.pickupTypes) ? V1_PROFILE.pickupTypes : ['heal_orb', 'cooldown_reset']);
    const V1_ACTION_TYPES = new Set(Array.isArray(V1_PROFILE.actionTypes) ? V1_PROFILE.actionTypes : []);
    const V1_TRIGGER_TYPES = new Set(Array.isArray(V1_PROFILE.triggerTypes) ? V1_PROFILE.triggerTypes : []);

    const DEFAULTS = Object.freeze({
        schemaVersion: 2,
        id: 'tds_example_encounter_v1',
        title: 'Fallback Encounter',
        seed: 'tds_default_seed',
        budgets: {
            maxEnemiesAlive: 24,
            maxEnemyBulletsAlive: 420,
            maxPlayerBulletsAlive: 120,
            maxEmittersAlive: 32,
            maxHazardsAlive: 80,
            maxPickupsAlive: 20,
            maxTelegraphsAlive: 80,
            maxActionsPerSecond: 120,
            maxEncounterSeconds: 180
        },
        arena: {
            mapSize: 1500,
            gridSpacing: 100,
            shape: 'diamond',
            bounds: 'soft',
            backgroundPreset: 'crimson_grid',
            backgroundColor: 0x080d1f,
            modifiers: []
        },
        renderPresets: {},
        music: {
            intensityTiers: {},
            intensityRules: []
        },
        resultRules: [],
        runtimeSettings: {
            showDamageNumbers: false,
            enableMicroHitStop: true
        },
        player: {
            hp: 6
        },
        playerKit: {
            id: 'default',
            maxHp: 6,
            moveSpeed: 4.5,
            autoAttack: {
                intervalMs: 180,
                projectileSpeed: 9
            },
            dash: {
                variant: 'burst_dash',
                cooldownMs: 1100,
                durationMs: 180,
                iframeMs: 220,
                speedMultiplier: 3.1
            },
            abilities: []
        },
        colors: {
            grid: 0x1a0a2e,
            player: 0x00f2ff,
            enemyBullet: 0xff00cc
        },
        pressurePattern: {
            enabled: true,
            intervalMs: 120,
            originRadius: 600,
            bulletLifeTicks: 300,
            bulletSpeed: 3.5,
            bulletVz: -0.1,
            ringCount: 4,
            pattern: {
                type: 'spiral',
                count: 4,
                speed: 3.5,
                spreadDegrees: 48,
                baseAngle: 0,
                angleOffset: 0
            }
        },
        patterns: {
            enemy_spiral_pressure: {
                type: 'spiral',
                count: 4,
                speed: 3.5,
                angleOffset: 0,
                projectileType: 'enemy_default_bullet',
                modifiers: []
            }
        },
        objectives: {},
        statusEffects: {},
        hazards: {},
        objects: {},
        pickups: {},
        emitters: {},
        projectileTypes: {
            enemy_default_bullet: {
                team: 'enemy',
                damage: 1,
                radius: 8,
                lifeTicks: 320,
                vz: -0.05,
                color: 0xff00cc,
                collision: {
                    destroyOnHit: true,
                    pierce: 0,
                    canBeCleared: true,
                    activeAfterSeconds: 0,
                    hitCooldownByTarget: 0,
                    friendlyFire: false
                },
                render: {
                    preset: 'orb',
                    color: 0xff00cc,
                    alpha: 1,
                    glow: true,
                    scale: 1,
                    rotationMode: 'fixed'
                }
            },
            player_default_bullet: {
                team: 'player',
                damage: 1,
                radius: 7,
                lifeTicks: 100,
                vz: 0,
                color: 0x39f2ff,
                collision: {
                    destroyOnHit: true,
                    pierce: 0,
                    canBeCleared: false,
                    activeAfterSeconds: 0,
                    hitCooldownByTarget: 0,
                    friendlyFire: false
                },
                render: {
                    preset: 'needle',
                    color: 0x39f2ff,
                    alpha: 1,
                    glow: true,
                    scale: 1,
                    rotationMode: 'velocity'
                }
            }
        },
        enemyTypes: {
            scout: {
                hp: 8,
                radius: 20,
                speed: 1.25,
                behavior: 'chase_player',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 950
            },
            sentry: {
                hp: 14,
                radius: 24,
                speed: 0.95,
                behavior: 'keep_distance',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 680
            },
            captain: {
                hp: 72,
                radius: 36,
                speed: 0.88,
                behavior: 'boss_anchor',
                attackPatternId: 'enemy_spiral_pressure',
                attackIntervalMs: 520,
                boss: true,
                bossId: 'captain',
                displayName: 'Captain',
                bossSubtitle: '',
                phaseThresholds: [0.66, 0.33]
            }
        },
        enemyArchetypes: {
            scout: { behavior: 'chase_player', speed: 1.25, hp: 8, radius: 20 },
            sentry: { behavior: 'stationary_turret', speed: 0.25, hp: 14, radius: 24 },
            charger: { behavior: 'charge_telegraphed', speed: 1.6, hp: 18, radius: 24 },
            bruiser: { behavior: 'chase_player', speed: 0.85, hp: 32, radius: 30 },
            sniper: { behavior: 'keep_distance', speed: 0.8, hp: 12, radius: 20 },
            orbiter: { behavior: 'orbit_player', speed: 1.0, hp: 14, radius: 22 },
            summoner: { behavior: 'summoner', speed: 0.7, hp: 18, radius: 24 },
            healer: { behavior: 'healer', speed: 0.95, hp: 14, radius: 22 },
            shielder: { behavior: 'shielder', speed: 0.9, hp: 18, radius: 25 },
            bomber: { behavior: 'dash_through_player', speed: 1.1, hp: 16, radius: 22 },
            splitter: { behavior: 'splitter', speed: 1.0, hp: 20, radius: 24 },
            mine_layer: { behavior: 'mine_layer', speed: 0.8, hp: 18, radius: 24 },
            leasher: { behavior: 'leasher', speed: 1.0, hp: 16, radius: 22 },
            zone_keeper: { behavior: 'zone_keeper', speed: 0.95, hp: 20, radius: 24 },
            elite: { behavior: 'elite', speed: 1.2, hp: 24, radius: 24 }
        },
        sequence: {
            startPhase: 'opening',
            phases: [
                {
                    id: 'opening',
                    objective: 'Defeat enemy scouts',
                    enter: [
                        { type: 'spawn_enemy', enemyType: 'scout', count: 2, formation: 'left_right' }
                    ],
                    rules: [
                        {
                            when: { type: 'all_enemies_defeated' },
                            do: [{ type: 'win' }]
                        }
                    ]
                }
            ]
        }
    });
    const SUPPORTED_PATTERN_TYPES = V1_PATTERN_TYPES;

    function toFinite(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function toInt(value, fallback) {
        const n = Number.parseInt(value, 10);
        return Number.isInteger(n) ? n : fallback;
    }

    function toColorInt(value, fallback) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return clamp(Math.floor(value), 0, 0xFFFFFF);
        }
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const shortHex = raw.match(/^#([0-9a-fA-F]{3})$/);
        if (shortHex) {
            const h = shortHex[1];
            return Number.parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
        }
        const fullHex = raw.match(/^#([0-9a-fA-F]{6})$/);
        if (fullHex) {
            return Number.parseInt(fullHex[1], 16);
        }
        if (/^0x[0-9a-fA-F]{1,6}$/.test(raw)) {
            return Number.parseInt(raw.slice(2), 16);
        }
        const decimal = Number.parseInt(raw, 10);
        return Number.isInteger(decimal) ? clamp(decimal, 0, 0xFFFFFF) : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeBudgets(rawBudgets) {
        const source = (rawBudgets && typeof rawBudgets === 'object') ? rawBudgets : {};
        return {
            maxEnemiesAlive: clamp(toInt(source.maxEnemiesAlive, DEFAULTS.budgets.maxEnemiesAlive), 1, 400),
            maxEnemyBulletsAlive: clamp(toInt(source.maxEnemyBulletsAlive, DEFAULTS.budgets.maxEnemyBulletsAlive), 10, 3000),
            maxPlayerBulletsAlive: clamp(toInt(source.maxPlayerBulletsAlive, DEFAULTS.budgets.maxPlayerBulletsAlive), 10, 2000),
            maxEmittersAlive: clamp(toInt(source.maxEmittersAlive, DEFAULTS.budgets.maxEmittersAlive), 0, 300),
            maxHazardsAlive: clamp(toInt(source.maxHazardsAlive, DEFAULTS.budgets.maxHazardsAlive), 0, 500),
            maxPickupsAlive: clamp(toInt(source.maxPickupsAlive, DEFAULTS.budgets.maxPickupsAlive), 0, 300),
            maxTelegraphsAlive: clamp(toInt(source.maxTelegraphsAlive, DEFAULTS.budgets.maxTelegraphsAlive), 0, 500),
            maxActionsPerSecond: clamp(toInt(source.maxActionsPerSecond, DEFAULTS.budgets.maxActionsPerSecond), 10, 1000),
            maxEncounterSeconds: clamp(toInt(source.maxEncounterSeconds, DEFAULTS.budgets.maxEncounterSeconds), 15, 3600)
        };
    }

    function normalizeProjectileCollision(raw, fallback) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const base = (fallback && typeof fallback === 'object') ? fallback : {};
        return {
            destroyOnHit: source.destroyOnHit !== false && base.destroyOnHit !== false,
            pierce: clamp(toInt(source.pierce, toInt(base.pierce, 0)), 0, 50),
            canBeCleared: source.canBeCleared !== false && base.canBeCleared !== false,
            activeAfterSeconds: clamp(toFinite(source.activeAfterSeconds, toFinite(base.activeAfterSeconds, 0)), 0, 10),
            hitCooldownByTarget: clamp(toFinite(source.hitCooldownByTarget, toFinite(base.hitCooldownByTarget, 0)), 0, 10),
            friendlyFire: source.friendlyFire === true || base.friendlyFire === true
        };
    }

    function normalizeProjectileRender(raw, fallback, defaultColor) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const base = (fallback && typeof fallback === 'object') ? fallback : {};
        const preset = String(source.preset || base.preset || 'orb').toLowerCase();
        const rotationModeRaw = String(source.rotationMode || base.rotationMode || 'fixed').toLowerCase();
        const rotationMode = ['fixed', 'velocity', 'spin'].includes(rotationModeRaw) ? rotationModeRaw : 'fixed';
        return {
            preset,
            color: toInt(source.color, toInt(base.color, defaultColor)),
            secondaryColor: toInt(source.secondaryColor, toInt(base.secondaryColor, defaultColor)),
            alpha: clamp(toFinite(source.alpha, toFinite(base.alpha, 1)), 0.05, 1),
            glow: source.glow !== false && base.glow !== false,
            scale: clamp(toFinite(source.scale, toFinite(base.scale, 1)), 0.2, 4),
            rotationMode
        };
    }

    function normalizeEmitter(raw, emitterId) {
        const source = (raw?.source && typeof raw.source === 'object') ? raw.source : {};
        const movement = (raw?.movement && typeof raw.movement === 'object') ? raw.movement : {};
        const sourceType = String(source.type || 'fixed_point').toLowerCase();
        const movementType = String(movement.type || 'none').toLowerCase();
        return {
            emitterId: String(raw?.emitterId || emitterId || ''),
            source: {
                type: ['fixed_point', 'arena_center', 'arena_edge'].includes(sourceType) ? sourceType : 'fixed_point',
                x: toFinite(source.x, 0),
                y: toFinite(source.y, 0),
                edge: String(source.edge || 'top').toLowerCase(),
                position: clamp(toFinite(source.position, 0.5), 0, 1)
            },
            pattern: String(raw?.pattern || ''),
            intervalSeconds: clamp(toFinite(raw?.intervalSeconds, 1), 0.05, 60),
            durationSeconds: clamp(toFinite(raw?.durationSeconds, 6), 0.1, 600),
            startDelaySeconds: clamp(toFinite(raw?.startDelaySeconds, 0), 0, 120),
            aim: (raw?.aim && typeof raw.aim === 'object') ? raw.aim : {},
            movement: {
                type: ['none', 'linear'].includes(movementType) ? movementType : 'none',
                vx: toFinite(movement.vx, 0),
                vy: toFinite(movement.vy, 0)
            },
            ownerType: raw?.ownerType ? String(raw.ownerType) : null,
            ownerId: raw?.ownerId ? String(raw.ownerId) : null
        };
    }

    function normalizeHazard(raw, hazardId) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const shape = String(source.shape || source.form || 'circle').toLowerCase();
        const type = String(source.type || 'damage_circle').toLowerCase();
        return {
            hazardId: String(source.hazardId || hazardId || ''),
            type,
            shape,
            source: (source.source && typeof source.source === 'object') ? source.source : {
                type: 'arena_center',
                x: toFinite(source.x, 0),
                y: toFinite(source.y, 0)
            },
            radius: clamp(toFinite(source.radius, 120), 6, 4000),
            width: clamp(toFinite(source.width, 220), 6, 4000),
            length: clamp(toFinite(source.length, 220), 6, 4000),
            angle: toFinite(source.angle, 0),
            durationSeconds: clamp(toFinite(source.durationSeconds, 3), 0.1, 300),
            tickIntervalSeconds: clamp(toFinite(source.tickIntervalSeconds, source.damageIntervalSeconds), 0.05, 30),
            damage: clamp(toFinite(source.damage, 1), 0, 999),
            force: clamp(toFinite(source.force, 140), -4000, 4000),
            growthPerSecond: clamp(toFinite(source.growthPerSecond, 0), -2000, 2000),
            statusOnHit: source.statusOnHit ? String(source.statusOnHit) : null,
            affectTeams: Array.isArray(source.affectTeams) ? source.affectTeams.map((v) => String(v || '').toLowerCase()).filter(Boolean) : ['player'],
            render: (source.render && typeof source.render === 'object') ? source.render : {},
            tags: Array.isArray(source.tags) ? source.tags.map((v) => String(v || '')).filter(Boolean) : []
        };
    }

    function normalizeObject(raw, objectId) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        return {
            objectId: String(source.objectId || objectId || ''),
            type: String(source.type || 'destructible').toLowerCase(),
            team: String(source.team || 'neutral').toLowerCase(),
            hp: clamp(toFinite(source.hp, 20), 1, 99999),
            radius: clamp(toFinite(source.radius, 28), 4, 600),
            source: (source.source && typeof source.source === 'object') ? source.source : {
                type: 'arena_center',
                x: toFinite(source.x, 0),
                y: toFinite(source.y, 0)
            },
            tags: Array.isArray(source.tags) ? source.tags.map((v) => String(v || '')).filter(Boolean) : [],
            render: (source.render && typeof source.render === 'object') ? source.render : {},
            onDestroyed: Array.isArray(source.onDestroyed) ? source.onDestroyed : [],
            onDamaged: Array.isArray(source.onDamaged) ? source.onDamaged : [],
            pickupDrops: Array.isArray(source.pickupDrops) ? source.pickupDrops : [],
            protect: source.protect === true,
            escort: source.escort === true,
            capture: source.capture === true
        };
    }

    function normalizeStatusEffect(raw, statusId) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const category = String(source.category || 'debuff').toLowerCase();
        return {
            id: String(source.id || statusId || ''),
            category: category === 'buff' ? 'buff' : 'debuff',
            durationSeconds: clamp(toFinite(source.durationSeconds, 2.5), 0.05, 600),
            maxStacks: clamp(toInt(source.maxStacks, 1), 1, 50),
            tickIntervalSeconds: clamp(toFinite(source.tickIntervalSeconds, 1), 0.05, 60),
            modifiers: Array.isArray(source.modifiers) ? source.modifiers : [],
            onApplyActions: Array.isArray(source.onApplyActions) ? source.onApplyActions : [],
            onExpireActions: Array.isArray(source.onExpireActions) ? source.onExpireActions : []
        };
    }

    function normalizePickup(raw, pickupId) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        return {
            id: String(source.id || pickupId || ''),
            type: String(source.type || 'heal_orb').toLowerCase(),
            radius: clamp(toFinite(source.radius, 22), 4, 220),
            durationSeconds: clamp(toFinite(source.durationSeconds, 12), 0.2, 600),
            maxAlive: clamp(toInt(source.maxAlive, 9999), 1, 9999),
            effectActions: Array.isArray(source.effectActions) ? source.effectActions : [],
            dropWeight: clamp(toFinite(source.dropWeight, 1), 0, 1000),
            statusOnPickup: source.statusOnPickup ? String(source.statusOnPickup) : null,
            render: (source.render && typeof source.render === 'object') ? source.render : {}
        };
    }

    function normalizePattern(raw, fallback = null) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const base = (fallback && typeof fallback === 'object') ? fallback : DEFAULTS.patterns.enemy_spiral_pressure;
        return {
            type: String(source.type || base.type || 'spiral').toLowerCase(),
            count: clamp(toInt(source.count, toInt(base.count, 4)), 1, 128),
            speed: clamp(toFinite(source.speed, toFinite(base.speed, 3.5)), 0.05, 80),
            spreadDegrees: clamp(toFinite(source.spreadDegrees, toFinite(base.spreadDegrees, 48)), 0, 360),
            baseAngle: toFinite(source.baseAngle, toFinite(base.baseAngle, 0)),
            angleOffset: toFinite(source.angleOffset, toFinite(base.angleOffset, 0)),
            spacing: clamp(toFinite(source.spacing, toFinite(base.spacing, 60)), 0, 4000),
            width: clamp(toFinite(source.width, toFinite(base.width, 900)), 0, 6000),
            originYOffset: toFinite(source.originYOffset, toFinite(base.originYOffset, -480)),
            downwardBias: clamp(toFinite(source.downwardBias, toFinite(base.downwardBias, 0.18)), 0, 4),
            projectileType: String(source.projectileType || base.projectileType || 'enemy_default_bullet'),
            source: (source.source && typeof source.source === 'object')
                ? source.source
                : ((base.source && typeof base.source === 'object') ? base.source : null),
            aim: (source.aim && typeof source.aim === 'object')
                ? source.aim
                : ((base.aim && typeof base.aim === 'object') ? base.aim : null),
            modifiers: Array.isArray(source.modifiers) ? source.modifiers : (Array.isArray(base.modifiers) ? base.modifiers : []),
            burstCount: clamp(toInt(source.burstCount, toInt(base.burstCount, 1)), 1, 64),
            burstIntervalSeconds: clamp(toFinite(source.burstIntervalSeconds, toFinite(base.burstIntervalSeconds, 0)), 0, 30),
            angleStepPerBurst: clamp(toFinite(source.angleStepPerBurst, toFinite(base.angleStepPerBurst, 0)), -360, 360),
            countStepPerBurst: clamp(toInt(source.countStepPerBurst, toInt(base.countStepPerBurst, 0)), -4, 8),
            speedStepPerBurst: clamp(toFinite(source.speedStepPerBurst, toFinite(base.speedStepPerBurst, 0)), -10, 10)
        };
    }

    function normalizeObjective(raw, fallbackId) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const type = String(source.type || 'survive_time').toLowerCase();
        const target = clamp(toFinite(source.target, source.count), 0, 999999);
        const timeoutSeconds = source.timeoutSeconds === null
            ? null
            : clamp(toFinite(source.timeoutSeconds, 0), 0, 3600);
        const visibility = String(source.visibility || 'visible').toLowerCase();
        return {
            id: String(source.id || fallbackId || ''),
            type,
            title: String(source.title || source.label || source.id || fallbackId || 'Objective'),
            target,
            required: source.required !== false && source.optional !== true,
            optional: source.optional === true || source.required === false,
            failureCondition: (source.failureCondition && typeof source.failureCondition === 'object') ? source.failureCondition : null,
            timeoutSeconds,
            visibility: ['visible', 'hidden', 'minimal'].includes(visibility) ? visibility : 'visible',
            rewardTags: Array.isArray(source.rewardTags) ? source.rewardTags.map((v) => String(v || '')).filter(Boolean) : [],
            enemyType: source.enemyType ? String(source.enemyType) : null,
            objectId: source.objectId ? String(source.objectId) : (source.object ? String(source.object) : null),
            zoneId: source.zoneId ? String(source.zoneId) : (source.zone ? String(source.zone) : null)
        };
    }

    function normalizeMusic(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const tiersRaw = (source.intensityTiers && typeof source.intensityTiers === 'object') ? source.intensityTiers : {};
        const tiers = {};
        for (const [key, value] of Object.entries(tiersRaw)) {
            const tierKey = String(key || '').trim().toLowerCase();
            if (!tierKey) continue;
            if (typeof value === 'string') {
                tiers[tierKey] = value;
                continue;
            }
            if (value && typeof value === 'object') {
                tiers[tierKey] = {
                    track: String(value.track || value.path || '').trim(),
                    duckFactor: Number.isFinite(Number(value.duckFactor)) ? clamp(toFinite(value.duckFactor, 0.75), 0, 1) : null
                };
            }
        }
        const rulesRaw = Array.isArray(source.intensityRules) ? source.intensityRules : [];
        const rules = [];
        for (let i = 0; i < rulesRaw.length; i += 1) {
            const rule = (rulesRaw[i] && typeof rulesRaw[i] === 'object') ? rulesRaw[i] : null;
            if (!rule) continue;
            rules.push({
                id: String(rule.id || ('rule_' + (i + 1))),
                priority: Number(rule.priority) || 0,
                cooldownSeconds: clamp(toFinite(rule.cooldownSeconds, 0), 0, 120),
                setIntensity: String(rule.setIntensity || rule.level || 'base').toLowerCase(),
                track: rule.track ? String(rule.track) : null,
                duckFactor: Number.isFinite(Number(rule.duckFactor)) ? clamp(toFinite(rule.duckFactor, 0.75), 0, 1) : null,
                when: (rule.when && typeof rule.when === 'object') ? rule.when : {}
            });
        }
        return {
            intensityTiers: tiers,
            intensityRules: rules
        };
    }

    function normalizeResultRule(raw, index) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const id = String(source.id || ('result_rule_' + (index + 1))).trim();
        const when = (source.when && typeof source.when === 'object') ? source.when : {};
        const tag = typeof source.tag === 'string' ? source.tag.trim() : '';
        const tags = Array.isArray(source.tags)
            ? source.tags.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (tag) tags.unshift(tag);
        return {
            id,
            when,
            tags: Array.from(new Set(tags)),
            grade: source.grade ? String(source.grade).trim().toLowerCase() : null
        };
    }

    function normalizePlayerKit(raw, fallback) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const base = (fallback && typeof fallback === 'object') ? fallback : DEFAULTS.playerKit;
        const autoAttack = (source.autoAttack && typeof source.autoAttack === 'object') ? source.autoAttack : {};
        const dash = (source.dash && typeof source.dash === 'object') ? source.dash : {};
        const abilitiesRaw = Array.isArray(source.abilities) ? source.abilities : (Array.isArray(base.abilities) ? base.abilities : []);
        return {
            id: String(source.id || base.id || 'default'),
            maxHp: clamp(toInt(source.maxHp, base.maxHp || DEFAULTS.player.hp), 1, 99),
            moveSpeed: clamp(toFinite(source.moveSpeed, base.moveSpeed || 4.5), 0.5, 20),
            autoAttack: {
                intervalMs: clamp(toInt(autoAttack.intervalMs, base.autoAttack?.intervalMs || 180), 60, 2000),
                projectileSpeed: clamp(toFinite(autoAttack.projectileSpeed, base.autoAttack?.projectileSpeed || 9), 1, 30)
            },
            dash: {
                variant: ['blink_short', 'burst_dash', 'phased_dash'].includes(String(dash.variant || '').toLowerCase())
                    ? String(dash.variant).toLowerCase()
                    : String(base.dash?.variant || 'burst_dash'),
                cooldownMs: clamp(toInt(dash.cooldownMs, base.dash?.cooldownMs || 1100), 100, 5000),
                durationMs: clamp(toInt(dash.durationMs, base.dash?.durationMs || 180), 40, 1200),
                iframeMs: clamp(toInt(dash.iframeMs, base.dash?.iframeMs || 220), 0, 2400),
                speedMultiplier: clamp(toFinite(dash.speedMultiplier, base.dash?.speedMultiplier || 3.1), 1, 10)
            },
            abilities: abilitiesRaw
                .filter((item) => item && typeof item === 'object')
                .map((item, index) => ({
                    id: String(item.id || ('ability_' + index)),
                    key: String(item.key || (index === 0 ? 'q' : (index === 1 ? 'e' : 'r'))).toLowerCase(),
                    cooldownSeconds: clamp(toFinite(item.cooldownSeconds, 8), 0.1, 120),
                    charges: clamp(toInt(item.charges, 1), 1, 10),
                    castActions: Array.isArray(item.castActions) ? item.castActions : [],
                    passiveTags: Array.isArray(item.passiveTags) ? item.passiveTags.map((v) => String(v || '')).filter(Boolean) : []
                }))
        };
    }

    function normalizeAttack(raw, index, fallbackPattern, fallbackIntervalMs) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const trigger = (source.trigger && typeof source.trigger === 'object') ? source.trigger : null;
        return {
            id: String(source.id || ('attack_' + index)),
            pattern: String(source.pattern || fallbackPattern || 'enemy_spiral_pressure'),
            everySeconds: clamp(toFinite(source.everySeconds, Math.max(0.12, (Number(fallbackIntervalMs) || 900) / 1000)), 0.1, 30),
            initialDelaySeconds: clamp(toFinite(source.initialDelaySeconds, 0), 0, 30),
            weight: clamp(toFinite(source.weight, 1), 0.01, 100),
            once: source.once === true,
            trigger,
            range: clamp(toFinite(source.range, 420), 10, 4000),
            source: (source.source && typeof source.source === 'object') ? source.source : null,
            aim: (source.aim && typeof source.aim === 'object') ? source.aim : null
        };
    }

    function normalizeEnemyType(raw, fallback) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const base = (fallback && typeof fallback === 'object') ? fallback : {};
        const fallbackPatternId = String(source.attackPatternId || base.attackPatternId || 'enemy_spiral_pressure');
        const fallbackIntervalMs = clamp(toInt(source.attackIntervalMs, toInt(base.attackIntervalMs, 900)), 120, 30000);
        const attacksRaw = Array.isArray(source.attacks) ? source.attacks : [];
        const attacks = attacksRaw.map((attack, index) => normalizeAttack(attack, index, fallbackPatternId, fallbackIntervalMs));
        const rawBossPhases = Array.isArray(source.bossPhases)
            ? source.bossPhases
            : (Array.isArray(source.phases) ? source.phases : []);
        const normalizedBossPhases = rawBossPhases.map((phase, index) => {
            const item = (phase && typeof phase === 'object') ? phase : {};
            return {
                id: String(item.id || ('phase_' + (index + 1))),
                untilHpRatio: Number.isFinite(Number(item.untilHpRatio)) ? clamp(Number(item.untilHpRatio), 0.01, 1) : null,
                untilElapsedSeconds: Number.isFinite(Number(item.untilElapsedSeconds)) ? clamp(Number(item.untilElapsedSeconds), 0, 600) : null,
                attackDeckMode: String(item.attackDeckMode || 'weighted_deck').toLowerCase(),
                attackDeck: Array.isArray(item.attackDeck) ? item.attackDeck.map((id) => String(id || '').trim()).filter(Boolean) : [],
                noRepeatWindow: clamp(toInt(item.noRepeatWindow, 0), 0, 10),
                onEnter: Array.isArray(item.onEnter) ? item.onEnter : []
            };
        });
        return {
            hp: clamp(toInt(source.hp, toInt(base.hp, 8)), 1, 20000),
            radius: clamp(toFinite(source.radius, toFinite(base.radius, 20)), 6, 260),
            speed: clamp(toFinite(source.speed, toFinite(base.speed, 1.2)), 0.05, 14),
            behavior: String(source.behavior || base.behavior || 'chase_player').toLowerCase(),
            archetype: String(source.archetype || base.archetype || '').toLowerCase(),
            attackPatternId: fallbackPatternId,
            attackIntervalMs: fallbackIntervalMs,
            attackMode: String(source.attackMode || base.attackMode || 'fixed_interval').toLowerCase(),
            attacks,
            boss: source.boss === true || base.boss === true,
            bossId: String(source.bossId || base.bossId || ''),
            displayName: String(source.displayName || base.displayName || ''),
            bossSubtitle: String(source.bossSubtitle || source.objectiveLabel || base.bossSubtitle || ''),
            bossPhases: normalizedBossPhases,
            shield: (source.shield && typeof source.shield === 'object') ? source.shield : ((base.shield && typeof base.shield === 'object') ? base.shield : null),
            weakPoints: Array.isArray(source.weakPoints) ? source.weakPoints : [],
            parts: Array.isArray(source.parts) ? source.parts : [],
            damageLocked: source.damageLocked === true,
            phaseThresholds: Array.isArray(source.phaseThresholds)
                ? source.phaseThresholds.map((value) => clamp(toFinite(value, 0), 0.05, 0.95)).sort((a, b) => b - a)
                : (Array.isArray(base.phaseThresholds) ? base.phaseThresholds.slice() : []),
            modifiers: Array.isArray(source.modifiers) ? source.modifiers.map((item) => String(item || '').toLowerCase()).filter(Boolean) : [],
            patrolPoints: Array.isArray(source.patrolPoints) ? source.patrolPoints : [],
            movePoints: Array.isArray(source.movePoints) ? source.movePoints : [],
            guardZone: (source.guardZone && typeof source.guardZone === 'object') ? source.guardZone : null,
            escortTargetId: source.escortTargetId ? String(source.escortTargetId) : null,
            protectBoss: source.protectBoss === true,
            summonedEnemyType: String(source.summonedEnemyType || 'scout'),
            summonedEverySeconds: clamp(toFinite(source.summonedEverySeconds, 6), 0.5, 60),
            healEverySeconds: clamp(toFinite(source.healEverySeconds, 4), 0.5, 60),
            healAmount: clamp(toFinite(source.healAmount, 2), 0.1, 100),
            shieldEverySeconds: clamp(toFinite(source.shieldEverySeconds, 6), 0.5, 60),
            shieldAmount: clamp(toFinite(source.shieldAmount, 3), 0.1, 100),
            regenPerSecond: clamp(toFinite(source.regenPerSecond, 0), 0, 30),
            shieldRatio: clamp(toFinite(source.shieldRatio, 0), 0, 0.9),
            explodeOnDeath: source.explodeOnDeath === true,
            onDeathSpawn: (source.onDeathSpawn && typeof source.onDeathSpawn === 'object') ? source.onDeathSpawn : null,
            attackCadenceMultiplier: clamp(toFinite(source.attackCadenceMultiplier, 1), 0.1, 4),
            attackBurstBonus: clamp(toInt(source.attackBurstBonus, 0), 0, 8)
            ,pickupDrops: Array.isArray(source.pickupDrops) ? source.pickupDrops : []
        };
    }

    function normalizeEncounter(source, _diagnostics = null) {
        const raw = (source && typeof source === 'object') ? source : {};
        const schemaVersion = clamp(toInt(raw.schemaVersion, DEFAULTS.schemaVersion), 1, 99);
        const arena = (raw.arena && typeof raw.arena === 'object') ? raw.arena : {};
        const player = (raw.player && typeof raw.player === 'object') ? raw.player : {};
        const playerKit = (raw.playerKit && typeof raw.playerKit === 'object') ? raw.playerKit : {};
        const colors = (raw.colors && typeof raw.colors === 'object') ? raw.colors : {};
        const pressure = (raw.pressurePattern && typeof raw.pressurePattern === 'object') ? raw.pressurePattern : {};
        const pressurePattern = (pressure.pattern && typeof pressure.pattern === 'object') ? pressure.pattern : {};
        const patterns = (raw.patterns && typeof raw.patterns === 'object') ? raw.patterns : {};
        const projectileTypes = (raw.projectileTypes && typeof raw.projectileTypes === 'object') ? raw.projectileTypes : {};
        const enemyTypes = (raw.enemyTypes && typeof raw.enemyTypes === 'object') ? raw.enemyTypes : {};
        const emitters = (raw.emitters && typeof raw.emitters === 'object') ? raw.emitters : {};
        const hazards = (raw.hazards && typeof raw.hazards === 'object') ? raw.hazards : {};
        const objects = (raw.objects && typeof raw.objects === 'object') ? raw.objects : {};
        const statusEffects = (raw.statusEffects && typeof raw.statusEffects === 'object') ? raw.statusEffects : {};
        const pickups = (raw.pickups && typeof raw.pickups === 'object') ? raw.pickups : {};
        const renderPresets = (raw.renderPresets && typeof raw.renderPresets === 'object') ? raw.renderPresets : {};
        const runtimeSettings = (raw.runtimeSettings && typeof raw.runtimeSettings === 'object') ? raw.runtimeSettings : {};
        const music = (raw.music && typeof raw.music === 'object') ? raw.music : {};
        const resultRules = Array.isArray(raw.resultRules) ? raw.resultRules : [];
        const objectives = raw.objectives;
        const sequence = (raw.sequence && typeof raw.sequence === 'object') ? raw.sequence : {};
        const enemyArchetypes = (raw.enemyArchetypes && typeof raw.enemyArchetypes === 'object') ? raw.enemyArchetypes : {};
        const rawPhases = Array.isArray(sequence.phases) ? sequence.phases : DEFAULTS.sequence.phases;
        const rawActionGroups = (sequence.actionGroups && typeof sequence.actionGroups === 'object') ? sequence.actionGroups : {};
        const normalizedActionGroups = {};
        for (const [groupId, actions] of Object.entries(rawActionGroups)) {
            const key = String(groupId || '').trim();
            if (!key) continue;
            normalizedActionGroups[key] = Array.isArray(actions) ? actions : [];
        }
        const rawInitialFlags = (sequence.initialFlags && typeof sequence.initialFlags === 'object') ? sequence.initialFlags : {};
        const normalizedInitialFlags = {};
        for (const [flagKey, flagValue] of Object.entries(rawInitialFlags)) {
            const key = String(flagKey || '').trim();
            if (!key) continue;
            normalizedInitialFlags[key] = !!flagValue;
        }
        const rawInitialCounters = (sequence.initialCounters && typeof sequence.initialCounters === 'object') ? sequence.initialCounters : {};
        const normalizedInitialCounters = {};
        for (const [counterKey, counterValue] of Object.entries(rawInitialCounters)) {
            const key = String(counterKey || '').trim();
            if (!key) continue;
            const n = Number(counterValue);
            normalizedInitialCounters[key] = Number.isFinite(n) ? n : 0;
        }
        const normalizedProjectileTypes = {};
        const projectileEntries = Object.entries(projectileTypes);
        if (projectileEntries.length === 0) {
            normalizedProjectileTypes.enemy_default_bullet = { ...DEFAULTS.projectileTypes.enemy_default_bullet };
        } else {
            for (const [typeId, value] of projectileEntries) {
                if (!typeId || typeof value !== 'object') continue;
                const key = String(typeId).trim();
                if (!key) continue;
                const fallback = DEFAULTS.projectileTypes.enemy_default_bullet;
                normalizedProjectileTypes[key] = {
                    team: String(value.team || 'enemy').toLowerCase() === 'player' ? 'player' : 'enemy',
                    damage: clamp(toFinite(value.damage, 1), 0, 999),
                    radius: clamp(toFinite(value.radius, 8), 2, 40),
                    lifeTicks: clamp(toFinite(value.lifeTicks, 320), 10, 2400),
                    vz: clamp(toFinite(value.vz, -0.05), -8, 8),
                    color: toInt(value.color, 0xff00cc),
                    collision: normalizeProjectileCollision(value.collision, fallback.collision),
                    render: normalizeProjectileRender(value.render, fallback.render, toInt(value.color, 0xff00cc))
                };
            }
        }
        if (!normalizedProjectileTypes.enemy_default_bullet) {
            normalizedProjectileTypes.enemy_default_bullet = { ...DEFAULTS.projectileTypes.enemy_default_bullet };
        }
        if (!normalizedProjectileTypes.player_default_bullet) {
            normalizedProjectileTypes.player_default_bullet = { ...DEFAULTS.projectileTypes.player_default_bullet };
        }
        const normalizedEmitters = {};
        for (const [emitterId, value] of Object.entries(emitters)) {
            if (!emitterId || !value || typeof value !== 'object') continue;
            normalizedEmitters[String(emitterId)] = normalizeEmitter(value, emitterId);
        }
        const normalizedHazards = {};
        for (const [hazardId, value] of Object.entries(hazards)) {
            if (!hazardId || !value || typeof value !== 'object') continue;
            normalizedHazards[String(hazardId)] = normalizeHazard(value, hazardId);
        }
        const normalizedObjects = {};
        for (const [objectId, value] of Object.entries(objects)) {
            if (!objectId || !value || typeof value !== 'object') continue;
            normalizedObjects[String(objectId)] = normalizeObject(value, objectId);
        }
        const normalizedObjectives = [];
        if (Array.isArray(objectives)) {
            for (let i = 0; i < objectives.length; i += 1) {
                const item = normalizeObjective(objectives[i], 'objective_' + (i + 1));
                if (!item.id) item.id = 'objective_' + (i + 1);
                normalizedObjectives.push(item);
            }
        } else if (objectives && typeof objectives === 'object') {
            for (const [objectiveId, value] of Object.entries(objectives)) {
                if (!objectiveId || !value || typeof value !== 'object') continue;
                normalizedObjectives.push(normalizeObjective({ ...value, id: value.id || objectiveId }, objectiveId));
            }
        }
        const normalizedEnemyArchetypes = {};
        const normalizedStatusEffects = {};
        for (const [statusId, value] of Object.entries(statusEffects)) {
            if (!statusId || !value || typeof value !== 'object') continue;
            normalizedStatusEffects[String(statusId)] = normalizeStatusEffect(value, statusId);
        }
        const normalizedPickups = {};
        for (const [pickupId, value] of Object.entries(pickups)) {
            if (!pickupId || !value || typeof value !== 'object') continue;
            normalizedPickups[String(pickupId)] = normalizePickup(value, pickupId);
        }
        for (const [archetypeId, value] of Object.entries({ ...(DEFAULTS.enemyArchetypes || {}), ...enemyArchetypes })) {
            if (!archetypeId || !value || typeof value !== 'object') continue;
            normalizedEnemyArchetypes[String(archetypeId).toLowerCase()] = normalizeEnemyType(value, DEFAULTS.enemyArchetypes?.[archetypeId] || {});
        }
        const rawEnemyEntries = Object.entries(enemyTypes);
        const normalizedEnemyTypes = {};
        if (rawEnemyEntries.length === 0) {
            const fallbackKeys = ['scout', 'sentry', 'captain'];
            for (const key of fallbackKeys) normalizedEnemyTypes[key] = normalizeEnemyType(DEFAULTS.enemyTypes[key], DEFAULTS.enemyTypes[key]);
        } else {
            for (const [enemyTypeId, value] of rawEnemyEntries) {
                if (!enemyTypeId || !value || typeof value !== 'object') continue;
                normalizedEnemyTypes[String(enemyTypeId)] = normalizeEnemyType(value, DEFAULTS.enemyTypes[String(enemyTypeId)] || DEFAULTS.enemyTypes.scout);
            }
        }
        const normalizedPatterns = {};
        const rawPatternEntries = Object.entries(patterns);
        if (rawPatternEntries.length === 0) {
            normalizedPatterns.enemy_spiral_pressure = normalizePattern(
                DEFAULTS.patterns.enemy_spiral_pressure,
                DEFAULTS.patterns.enemy_spiral_pressure
            );
        } else {
            for (const [patternId, value] of rawPatternEntries) {
                if (!patternId || !value || typeof value !== 'object') continue;
                const key = String(patternId).trim();
                if (!key) continue;
                normalizedPatterns[key] = normalizePattern(value, DEFAULTS.patterns[key] || DEFAULTS.patterns.enemy_spiral_pressure);
            }
        }
        if (!normalizedPatterns.enemy_spiral_pressure) {
            normalizedPatterns.enemy_spiral_pressure = normalizePattern(
                DEFAULTS.patterns.enemy_spiral_pressure,
                DEFAULTS.patterns.enemy_spiral_pressure
            );
        }

        return {
            schemaVersion,
            id: String(raw.id || DEFAULTS.id),
            title: String(raw.title || DEFAULTS.title),
            seed: String(raw.seed || raw.id || DEFAULTS.seed),
            budgets: normalizeBudgets(raw.budgets),
            arena: {
                mapSize: clamp(toFinite(arena.mapSize, DEFAULTS.arena.mapSize), 400, 5000),
                gridSpacing: clamp(toFinite(arena.gridSpacing, DEFAULTS.arena.gridSpacing), 40, 320),
                shape: String(arena.shape || DEFAULTS.arena.shape).toLowerCase(),
                bounds: String(arena.bounds || DEFAULTS.arena.bounds).toLowerCase(),
                backgroundPreset: String(arena.backgroundPreset || DEFAULTS.arena.backgroundPreset),
                backgroundColor: toColorInt(arena.backgroundColor, DEFAULTS.arena.backgroundColor),
                modifiers: Array.isArray(arena.modifiers) ? arena.modifiers : []
            },
            player: {
                hp: clamp(toInt(player.hp, DEFAULTS.player.hp), 1, 99)
            },
            playerKit: normalizePlayerKit(playerKit, {
                ...DEFAULTS.playerKit,
                maxHp: clamp(toInt(player.hp, DEFAULTS.player.hp), 1, 99)
            }),
            colors: {
                grid: toInt(colors.grid, DEFAULTS.colors.grid),
                player: toInt(colors.player, DEFAULTS.colors.player),
                enemyBullet: toInt(colors.enemyBullet, DEFAULTS.colors.enemyBullet)
            },
            pressurePattern: {
                enabled: pressure.enabled !== false,
                intervalMs: clamp(toInt(pressure.intervalMs, DEFAULTS.pressurePattern.intervalMs), 40, 3000),
                originRadius: clamp(toFinite(pressure.originRadius, DEFAULTS.pressurePattern.originRadius), 100, 2000),
                bulletLifeTicks: clamp(toFinite(pressure.bulletLifeTicks, DEFAULTS.pressurePattern.bulletLifeTicks), 20, 1200),
                bulletSpeed: clamp(toFinite(pressure.bulletSpeed, DEFAULTS.pressurePattern.bulletSpeed), 0.2, 20),
                bulletVz: clamp(toFinite(pressure.bulletVz, DEFAULTS.pressurePattern.bulletVz), -8, 8),
                ringCount: clamp(toInt(pressure.ringCount, DEFAULTS.pressurePattern.ringCount), 1, 32),
                pattern: {
                    type: String(pressurePattern.type || DEFAULTS.pressurePattern.pattern.type).toLowerCase(),
                    count: clamp(toInt(pressurePattern.count, DEFAULTS.pressurePattern.pattern.count), 1, 64),
                    speed: clamp(toFinite(pressurePattern.speed, DEFAULTS.pressurePattern.pattern.speed), 0.2, 20),
                    spreadDegrees: clamp(toFinite(pressurePattern.spreadDegrees, DEFAULTS.pressurePattern.pattern.spreadDegrees), 0, 360),
                    baseAngle: toFinite(pressurePattern.baseAngle, DEFAULTS.pressurePattern.pattern.baseAngle),
                    angleOffset: toFinite(pressurePattern.angleOffset, DEFAULTS.pressurePattern.pattern.angleOffset)
                }
            },
            patterns: normalizedPatterns,
            objectives: normalizedObjectives,
            statusEffects: normalizedStatusEffects,
            hazards: normalizedHazards,
            objects: normalizedObjects,
            pickups: normalizedPickups,
            emitters: normalizedEmitters,
            projectileTypes: normalizedProjectileTypes,
            enemyArchetypes: normalizedEnemyArchetypes,
            enemyTypes: normalizedEnemyTypes,
            sequence: {
                startPhase: String(sequence.startPhase || DEFAULTS.sequence.startPhase),
                actionGroups: normalizedActionGroups,
                initialFlags: normalizedInitialFlags,
                initialCounters: normalizedInitialCounters,
                phases: rawPhases.map((phase, phaseIndex) => ({
                    id: String(phase?.id || ('phase_' + phaseIndex)),
                    objective: String(phase?.objective || ''),
                    enter: Array.isArray(phase?.enter) ? phase.enter : [],
                    rules: Array.isArray(phase?.rules) ? phase.rules : []
                }))
            },
            renderPresets: renderPresets,
            music: normalizeMusic(music),
            resultRules: resultRules.map((rule, index) => normalizeResultRule(rule, index)),
            runtimeSettings: {
                showDamageNumbers: runtimeSettings.showDamageNumbers === true,
                enableMicroHitStop: runtimeSettings.enableMicroHitStop !== false
            }
        };
    }

    function validateEncounterBaseline(source) {
        const warnings = [];
        const errors = [];
        let encounter = null;
        try {
            encounter = normalizeEncounter(source, { warnings, errors });
        } catch (error) {
            errors.push('Failed to normalize encounter: ' + (error?.message || String(error)));
            encounter = normalizeEncounter(null, { warnings, errors });
        }

        const requestedVersion = toInt(source?.schemaVersion, DEFAULTS.schemaVersion);
        if (Number.isFinite(requestedVersion) && requestedVersion > DEFAULTS.schemaVersion) {
            warnings.push('Encounter schemaVersion ' + requestedVersion + ' is newer than runtime support; using compatibility normalization.');
        }

        for (const [patternId, pattern] of Object.entries(encounter?.patterns || {})) {
            const projectileType = String(pattern?.projectileType || '').trim();
            if (!projectileType) continue;
            if (encounter.projectileTypes?.[projectileType]) continue;
            warnings.push('Pattern "' + patternId + '" references unknown projectileType "' + projectileType + '"; falling back to enemy_default_bullet.');
            encounter.patterns[patternId].projectileType = 'enemy_default_bullet';
        }
        const enemyEntries = Object.entries(encounter?.enemyTypes || {});
        for (const [enemyTypeId, enemyType] of enemyEntries) {
            if (!enemyType?.boss) continue;
            const attacks = Array.isArray(enemyType?.attacks) ? enemyType.attacks : [];
            const attackIds = new Set(attacks.map((item) => String(item?.id || '')).filter(Boolean));
            const phases = Array.isArray(enemyType?.bossPhases) ? enemyType.bossPhases : [];
            for (const phase of phases) {
                const deck = Array.isArray(phase?.attackDeck) ? phase.attackDeck : [];
                for (const attackId of deck) {
                    if (attackIds.has(String(attackId || ''))) continue;
                    warnings.push('Boss "' + enemyTypeId + '" phase "' + String(phase?.id || '') + '" references unknown attack id "' + String(attackId || '') + '".');
                }
            }
        }
        const knownHazards = new Set(Object.keys(encounter?.hazards || {}));
        const knownObjects = new Set(Object.keys(encounter?.objects || {}));
        const knownStatuses = new Set(Object.keys(encounter?.statusEffects || {}));
        const knownPickups = new Set(Object.keys(encounter?.pickups || {}));
        const knownArenaShapes = new Set(['rectangle', 'diamond', 'circle', 'ring', 'corridor', 'islands', 'cross']);
        const knownArenaBounds = new Set(['soft', 'damage', 'wrap']);
        const knownArenaModifiers = new Set([
            'shrink_arena',
            'expand_arena',
            'rotating_safe_wedge',
            'periodic_wind',
            'low_friction_floor',
            'mud_slow_patches',
            'damage_edge',
            'bullet_wrap',
            'enemy_spawn_gates',
            'darkened_visibility',
            'camera_zoom_phase'
        ]);
        const knownObjectiveTypes = new Set([
            'survive_time',
            'defeat_count',
            'defeat_enemy_type',
            'defeat_boss',
            'protect_object',
            'reach_zone',
            'clear_hazards'
        ]);
        const objectiveIds = new Set((Array.isArray(encounter?.objectives) ? encounter.objectives : []).map((item) => String(item?.id || '')).filter(Boolean));
        for (const ability of (Array.isArray(encounter?.playerKit?.abilities) ? encounter.playerKit.abilities : [])) {
            const key = String(ability?.key || '').toLowerCase();
            if (!['q', 'e', 'r'].includes(key)) warnings.push('Ability "' + String(ability?.id || '') + '" uses unsupported key "' + key + '".');
            if (!Array.isArray(ability?.castActions) || ability.castActions.length === 0) warnings.push('Ability "' + String(ability?.id || '') + '" has no castActions.');
        }
        for (const objective of (Array.isArray(encounter?.objectives) ? encounter.objectives : [])) {
            const objectiveId = String(objective?.id || '');
            const type = String(objective?.type || '').toLowerCase();
            if (!knownObjectiveTypes.has(type)) warnings.push('Objective "' + objectiveId + '" uses unknown type "' + type + '"; objective will be inert.');
            if (!objectiveId) warnings.push('Objective is missing id.');
        }
        if (!knownArenaShapes.has(String(encounter?.arena?.shape || '').toLowerCase())) {
            warnings.push('Arena uses unknown shape "' + String(encounter?.arena?.shape || '') + '"; runtime will fallback.');
        }
        if (!knownArenaBounds.has(String(encounter?.arena?.bounds || '').toLowerCase())) {
            warnings.push('Arena uses unknown bounds mode "' + String(encounter?.arena?.bounds || '') + '"; runtime will fallback.');
        }
        for (const modifier of (Array.isArray(encounter?.arena?.modifiers) ? encounter.arena.modifiers : [])) {
            const type = String(modifier?.type || '').toLowerCase();
            if (!type) continue;
            if (!knownArenaModifiers.has(type)) {
                warnings.push('Arena modifier "' + type + '" is unknown; runtime will no-op it.');
            }
        }
        for (const [pickupId, pickup] of Object.entries(encounter?.pickups || {})) {
            if (!pickupId) continue;
            if (pickup?.statusOnPickup && !knownStatuses.has(String(pickup.statusOnPickup))) {
                warnings.push('Pickup "' + pickupId + '" references unknown status "' + String(pickup.statusOnPickup) + '".');
            }
        }
        for (const rule of (Array.isArray(encounter?.music?.intensityRules) ? encounter.music.intensityRules : [])) {
            const whenType = String(rule?.when?.type || '').toLowerCase();
            if (!whenType) warnings.push('Music intensity rule "' + String(rule?.id || '') + '" has no trigger type.');
        }
        const knownResultRuleTypes = new Set([
            'player_hp_below',
            'objective_completed',
            'objective_failed',
            'enemy_defeated_count_at_least',
            'boss_defeated',
            'retries_at_least',
            'duration_below',
            'duration_above'
        ]);
        for (const rule of (Array.isArray(encounter?.resultRules) ? encounter.resultRules : [])) {
            const whenType = String(rule?.when?.type || '').toLowerCase();
            if (!whenType) {
                warnings.push('Result rule "' + String(rule?.id || '') + '" has no trigger type and will be ignored.');
                continue;
            }
            if (!knownResultRuleTypes.has(whenType)) {
                warnings.push('Result rule "' + String(rule?.id || '') + '" uses unknown trigger type "' + whenType + '" and will be ignored.');
            }
            if (!Array.isArray(rule?.tags) || rule.tags.length === 0) {
                warnings.push('Result rule "' + String(rule?.id || '') + '" has no tag/tags payload and will have no effect.');
            }
        }
        const phases = Array.isArray(encounter?.sequence?.phases) ? encounter.sequence.phases : [];
        for (const phase of phases) {
            const actions = collectActionsFromPhase(phase);
            for (const action of actions) {
                const type = String(action?.type || '').toLowerCase();
                if ((type === 'spawn_hazard' || type === 'telegraph_then_spawn_hazard') && action?.hazard && typeof action.hazard === 'string') {
                    if (!knownHazards.has(String(action.hazard))) {
                        warnings.push('Action "' + type + '" references unknown hazard "' + String(action.hazard) + '".');
                    }
                }
                if ((type === 'spawn_object' || type === 'damage_object' || type === 'despawn_object') && action?.object && typeof action.object === 'string') {
                    if (!knownObjects.has(String(action.object))) {
                        warnings.push('Action "' + type + '" references unknown object "' + String(action.object) + '".');
                    }
                }
                if ((type === 'activate_objective' || type === 'complete_objective' || type === 'fail_objective' || type === 'set_objective_progress') && action?.objective && typeof action.objective === 'string') {
                    if (!objectiveIds.has(String(action.objective))) {
                        warnings.push('Action "' + type + '" references unknown objective "' + String(action.objective) + '".');
                    }
                }
                if ((type === 'apply_status' || type === 'remove_status') && action?.status && typeof action.status === 'string') {
                    if (!knownStatuses.has(String(action.status))) {
                        warnings.push('Action "' + type + '" references unknown status "' + String(action.status) + '".');
                    }
                }
                if (type === 'spawn_pickup' && action?.pickup && typeof action.pickup === 'string') {
                    if (!knownPickups.has(String(action.pickup))) {
                        warnings.push('Action "' + type + '" references unknown pickup "' + String(action.pickup) + '".');
                    }
                }
            }
        }
        const actionGroups = encounter?.sequence?.actionGroups || {};
        for (const [groupId, actions] of Object.entries(actionGroups)) {
            const groupActions = [];
            collectActionsFromList(actions, groupActions);
            for (const action of groupActions) {
                const type = String(action?.type || '').toLowerCase();
                if ((type === 'spawn_hazard' || type === 'telegraph_then_spawn_hazard') && action?.hazard && typeof action.hazard === 'string') {
                    if (!knownHazards.has(String(action.hazard))) warnings.push('Action group "' + groupId + '" action "' + type + '" references unknown hazard "' + String(action.hazard) + '".');
                }
                if ((type === 'spawn_object' || type === 'damage_object' || type === 'despawn_object') && action?.object && typeof action.object === 'string') {
                    if (!knownObjects.has(String(action.object))) warnings.push('Action group "' + groupId + '" action "' + type + '" references unknown object "' + String(action.object) + '".');
                }
                if ((type === 'activate_objective' || type === 'complete_objective' || type === 'fail_objective' || type === 'set_objective_progress') && action?.objective && typeof action.objective === 'string') {
                    if (!objectiveIds.has(String(action.objective))) warnings.push('Action group "' + groupId + '" action "' + type + '" references unknown objective "' + String(action.objective) + '".');
                }
                if ((type === 'apply_status' || type === 'remove_status') && action?.status && typeof action.status === 'string') {
                    if (!knownStatuses.has(String(action.status))) warnings.push('Action group "' + groupId + '" action "' + type + '" references unknown status "' + String(action.status) + '".');
                }
                if (type === 'spawn_pickup' && action?.pickup && typeof action.pickup === 'string') {
                    if (!knownPickups.has(String(action.pickup))) warnings.push('Action group "' + groupId + '" action "' + type + '" references unknown pickup "' + String(action.pickup) + '".');
                }
            }
        }

        return {
            ok: errors.length === 0,
            encounter,
            normalized: true,
            warnings,
            errors
        };
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clampMultiplier(value, fallback = 1, min = 0.2, max = 4) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return clamp(n, min, max);
    }

    function normalizeEncounterDifficulty(encounter, difficultySpec = null) {
        const src = (encounter && typeof encounter === 'object') ? deepClone(encounter) : normalizeEncounter(null);
        const spec = (difficultySpec && typeof difficultySpec === 'object') ? difficultySpec : {};
        const profileId = String(spec.profileId || spec.id || spec.tier || 'custom').trim();
        const enemyHpMul = clampMultiplier(spec.enemyHpMultiplier, 1, 0.2, 6);
        const spawnCountMul = clampMultiplier(spec.spawnCountMultiplier, 1, 0.25, 4);
        const projectileSpeedMul = clampMultiplier(spec.projectileSpeedMultiplier, 1, 0.25, 4);
        const enemyBulletMul = clampMultiplier(spec.enemyBulletCountMultiplier || spec.enemyBulletBurstMultiplier, 1, 0.25, 4);
        const cadenceMul = clampMultiplier(spec.cadenceMultiplier, 1, 0.25, 4);
        const cooldownMul = clampMultiplier(spec.cooldownMultiplier, 1, 0.25, 4);
        const playerHpMul = clampMultiplier(spec.playerHpMultiplier, 1, 0.25, 4);

        const scaleCount = (count) => clamp(Math.round((Number(count) || 0) * spawnCountMul), 0, 999);
        const scaleBullets = (count) => clamp(Math.round((Number(count) || 0) * enemyBulletMul), 1, 128);

        src.player = src.player || {};
        src.player.hp = clamp(Math.round((Number(src.player.hp) || DEFAULTS.player.hp) * playerHpMul), 1, 999);
        src.playerKit = src.playerKit || {};
        src.playerKit.maxHp = clamp(Math.round((Number(src.playerKit.maxHp) || src.player.hp || DEFAULTS.player.hp) * playerHpMul), 1, 999);
        if (Array.isArray(src.playerKit.abilities)) {
            for (const ability of src.playerKit.abilities) {
                ability.cooldownSeconds = clamp((Number(ability.cooldownSeconds) || 1) * cooldownMul, 0.05, 240);
            }
        }

        const enemyTypes = src.enemyTypes || {};
        for (const enemyType of Object.values(enemyTypes)) {
            if (!enemyType || typeof enemyType !== 'object') continue;
            enemyType.hp = clamp(Math.round((Number(enemyType.hp) || 1) * enemyHpMul), 1, 99999);
            enemyType.attackIntervalMs = clamp(Math.round((Number(enemyType.attackIntervalMs) || 900) / cadenceMul), 60, 60000);
            if (Array.isArray(enemyType.attacks)) {
                for (const attack of enemyType.attacks) {
                    attack.everySeconds = clamp((Number(attack.everySeconds) || 1) / cadenceMul, 0.05, 60);
                }
            }
        }

        const patterns = src.patterns || {};
        for (const pattern of Object.values(patterns)) {
            if (!pattern || typeof pattern !== 'object') continue;
            if (Number.isFinite(Number(pattern.speed))) pattern.speed = clamp(Number(pattern.speed) * projectileSpeedMul, 0.05, 80);
            if (Number.isFinite(Number(pattern.count))) pattern.count = scaleBullets(pattern.count);
            if (Number.isFinite(Number(pattern.burstCount))) pattern.burstCount = clamp(Math.round(Number(pattern.burstCount) * enemyBulletMul), 1, 64);
        }

        if (src.pressurePattern && typeof src.pressurePattern === 'object') {
            src.pressurePattern.bulletSpeed = clamp((Number(src.pressurePattern.bulletSpeed) || 1) * projectileSpeedMul, 0.05, 80);
            src.pressurePattern.ringCount = clamp(Math.round((Number(src.pressurePattern.ringCount) || 1) * enemyBulletMul), 1, 64);
            if (src.pressurePattern.pattern && typeof src.pressurePattern.pattern === 'object') {
                src.pressurePattern.pattern.speed = clamp((Number(src.pressurePattern.pattern.speed) || 1) * projectileSpeedMul, 0.05, 80);
                src.pressurePattern.pattern.count = scaleBullets(src.pressurePattern.pattern.count);
            }
        }

        const scaleActions = (actions) => {
            const list = Array.isArray(actions) ? actions : [];
            for (const action of list) {
                if (!action || typeof action !== 'object') continue;
                const type = String(action.type || '').toLowerCase();
                if (type === 'spawn_enemy') {
                    action.count = scaleCount(action.count || 1);
                } else if (type === 'spawn_enemies_from_table') {
                    if (Array.isArray(action.table)) {
                        for (const item of action.table) {
                            if (!item || typeof item !== 'object') continue;
                            item.count = scaleCount(item.count || 1);
                        }
                    }
                    action.count = scaleCount(action.count || 1);
                } else if (type === 'set_music_intensity') {
                    if (Number.isFinite(Number(action.cooldownSeconds))) {
                        action.cooldownSeconds = clamp((Number(action.cooldownSeconds) || 0) * cooldownMul, 0, 180);
                    }
                }
            }
        };

        const phases = Array.isArray(src?.sequence?.phases) ? src.sequence.phases : [];
        for (const phase of phases) {
            if (!phase || typeof phase !== 'object') continue;
            scaleActions(phase.enter);
            const rules = Array.isArray(phase.rules) ? phase.rules : [];
            for (const rule of rules) {
                if (!rule || typeof rule !== 'object') continue;
                scaleActions(rule.do);
                scaleActions(rule.elseActions);
            }
        }

        return {
            encounter: normalizeEncounter(src),
            appliedDifficultyProfile: {
                profileId,
                enemyHpMultiplier: enemyHpMul,
                spawnCountMultiplier: spawnCountMul,
                projectileSpeedMultiplier: projectileSpeedMul,
                enemyBulletCountMultiplier: enemyBulletMul,
                cadenceMultiplier: cadenceMul,
                cooldownMultiplier: cooldownMul,
                playerHpMultiplier: playerHpMul
            }
        };
    }

    function collectActionsFromList(actions, out) {
        for (const action of (Array.isArray(actions) ? actions : [])) {
            if (!action || typeof action !== 'object') continue;
            out.push(action);
            if (Array.isArray(action.actions)) collectActionsFromList(action.actions, out);
        }
    }

    function collectActionsFromPhase(phase) {
        const out = [];
        if (!phase || typeof phase !== 'object') return out;
        collectActionsFromList(phase.enter, out);
        for (const rule of (Array.isArray(phase.rules) ? phase.rules : [])) {
            collectActionsFromList(rule?.do, out);
            collectActionsFromList(rule?.elseActions, out);
        }
        return out;
    }

    function collectActionContextsFromPhase(phase) {
        const out = [];
        const phaseId = String(phase?.id || '').trim() || 'unknown_phase';
        const pushWithOrigin = (actions, origin) => {
            for (const action of (Array.isArray(actions) ? actions : [])) {
                if (!action || typeof action !== 'object') continue;
                out.push({ action, origin });
                if (Array.isArray(action.actions)) pushWithOrigin(action.actions, origin + ' (nested)');
            }
        };
        pushWithOrigin(phase?.enter, 'phase "' + phaseId + '" enter');
        const rules = Array.isArray(phase?.rules) ? phase.rules : [];
        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
            const ruleLabel = 'phase "' + phaseId + '" rule #' + (ruleIndex + 1);
            const rule = rules[ruleIndex];
            pushWithOrigin(rule?.do, ruleLabel + ' do');
            pushWithOrigin(rule?.elseActions, ruleLabel + ' elseActions');
        }
        return out;
    }

    function collectActionContextsFromActionGroups(actionGroups) {
        const out = [];
        const pushWithOrigin = (actions, origin) => {
            for (const action of (Array.isArray(actions) ? actions : [])) {
                if (!action || typeof action !== 'object') continue;
                out.push({ action, origin });
                if (Array.isArray(action.actions)) pushWithOrigin(action.actions, origin + ' (nested)');
            }
        };
        for (const [groupId, actions] of Object.entries(actionGroups || {})) {
            const groupKey = String(groupId || '').trim();
            if (!groupKey) continue;
            pushWithOrigin(actions, 'actionGroup "' + groupKey + '"');
        }
        return out;
    }

    function validateEncounterDefinition(source, options = null) {
        const base = validateEncounterBaseline(source);
        const warnings = Array.isArray(base.warnings) ? base.warnings.slice() : [];
        const errors = Array.isArray(base.errors) ? base.errors.slice() : [];
        let encounter = base.encounter;
        let appliedDifficultyProfile = null;
        const raw = (source && typeof source === 'object') ? source : {};

        const pushWarning = (code, message) => warnings.push(String(code || 'TDSV-W000') + ': ' + String(message || ''));
        const pushError = (code, message) => errors.push(String(code || 'TDSV-E000') + ': ' + String(message || ''));
        const strictCapabilities = options?.strictCapabilities === true || String(options?.capabilityProfile || '').toLowerCase() === 'v1';
        const pushCapabilityIssue = (errorCode, warningCode, message) => {
            if (strictCapabilities) pushError(errorCode, message);
            else pushWarning(warningCode, message);
        };

        const difficultySpec = options?.difficultyProfile || null;
        if (difficultySpec && typeof difficultySpec === 'object') {
            try {
                const transformed = normalizeEncounterDifficulty(encounter, difficultySpec);
                encounter = transformed.encounter;
                appliedDifficultyProfile = transformed.appliedDifficultyProfile || null;
            } catch (error) {
                pushError('TDSV-E060', 'Difficulty normalization failed: ' + (error?.message || String(error)));
            }
        }

        const knownTopLevel = new Set([
            'schemaVersion', 'id', 'title', 'seed', 'budgets', 'arena', 'renderPresets', 'music', 'resultRules', 'runtimeSettings',
            'player', 'playerKit', 'colors', 'pressurePattern', 'patterns', 'objectives', 'statusEffects', 'hazards', 'objects',
            'pickups', 'emitters', 'projectileTypes', 'enemyTypes', 'enemyArchetypes', 'sequence'
        ]);
        for (const key of Object.keys(raw || {})) {
            const normalizedKey = String(key || '');
            if (knownTopLevel.has(normalizedKey) === false) {
                pushWarning('TDSV-W001', 'Unknown top-level field "' + normalizedKey + '".');
            }
            if (V1_DISALLOWED_TOP_LEVEL_FIELDS.has(normalizedKey)) {
                pushCapabilityIssue('TDSV-E100', 'TDSV-W100', 'Top-level field "' + normalizedKey + '" is disabled in V1.');
            } else if (strictCapabilities && V1_STRICT_TOP_LEVEL_FIELDS.size > 0 && !V1_STRICT_TOP_LEVEL_FIELDS.has(normalizedKey)) {
                pushError('TDSV-E101', 'Top-level field "' + normalizedKey + '" is not part of the V1 authoring contract.');
            }
        }

        const rawSequence = (raw?.sequence && typeof raw.sequence === 'object') ? raw.sequence : {};
        for (const key of Object.keys(rawSequence)) {
            const normalizedKey = String(key || '');
            if (V1_DISALLOWED_SEQUENCE_FIELDS.has(normalizedKey)) {
                pushCapabilityIssue('TDSV-E102', 'TDSV-W102', 'Sequence field "' + normalizedKey + '" is disabled in V1.');
            }
        }

        if (strictCapabilities && rawSequence && typeof rawSequence === 'object') {
            if (Array.isArray(rawSequence.actionGroups) && rawSequence.actionGroups.length > 0) {
                pushError('TDSV-E103', 'Sequence actionGroups are disabled in V1.');
            }
            if (rawSequence.initialFlags && typeof rawSequence.initialFlags === 'object' && Object.keys(rawSequence.initialFlags).length > 0) {
                pushError('TDSV-E104', 'Sequence initialFlags are disabled in V1.');
            }
            if (rawSequence.initialCounters && typeof rawSequence.initialCounters === 'object' && Object.keys(rawSequence.initialCounters).length > 0) {
                pushError('TDSV-E105', 'Sequence initialCounters are disabled in V1.');
            }
        }

        const rawArenaModifiers = Array.isArray(raw?.arena?.modifiers) ? raw.arena.modifiers : [];
        if (rawArenaModifiers.length > 0) {
            pushCapabilityIssue('TDSV-E106', 'TDSV-W106', 'Arena modifiers are disabled in V1.');
        }

        for (const objective of (Array.isArray(encounter?.objectives) ? encounter.objectives : [])) {
            const objectiveId = String(objective?.id || '');
            const objectiveType = String(objective?.type || '').toLowerCase();
            if (!V1_OBJECTIVE_TYPES.has(objectiveType)) {
                pushCapabilityIssue(
                    'TDSV-E107',
                    'TDSV-W107',
                    'Objective "' + objectiveId + '" uses unsupported V1 type "' + objectiveType + '".'
                );
            }
        }

        for (const [enemyTypeId, enemyType] of Object.entries(encounter?.enemyTypes || {})) {
            const behavior = String(enemyType?.behavior || '').toLowerCase();
            if (!behavior) continue;
            if (!V1_ENEMY_BEHAVIORS.has(behavior)) {
                pushCapabilityIssue(
                    'TDSV-E108',
                    'TDSV-W108',
                    'Enemy "' + enemyTypeId + '" uses behavior "' + behavior + '" which is disabled in V1.'
                );
            }
        }

        for (const [pickupId, pickup] of Object.entries(encounter?.pickups || {})) {
            const pickupType = String(pickup?.type || '').toLowerCase();
            if (!pickupType) continue;
            if (!V1_PICKUP_TYPES.has(pickupType)) {
                pushCapabilityIssue(
                    'TDSV-E109',
                    'TDSV-W109',
                    'Pickup "' + pickupId + '" uses type "' + pickupType + '" which is disabled in V1.'
                );
            }
        }

        for (const [patternId, pattern] of Object.entries(encounter?.patterns || {})) {
            const modifiers = Array.isArray(pattern?.modifiers) ? pattern.modifiers : [];
            for (const modifier of modifiers) {
                const modifierType = String(modifier?.type || '').toLowerCase();
                if (!modifierType) continue;
                if (!V1_PROJECTILE_MODIFIERS.has(modifierType)) {
                    pushCapabilityIssue(
                        'TDSV-E110',
                        'TDSV-W110',
                        'Pattern "' + patternId + '" uses projectile modifier "' + modifierType + '" which is disabled in V1.'
                    );
                }
            }
        }

        if (strictCapabilities && raw?.hazards && Object.keys(raw.hazards || {}).length > 0) {
            pushError('TDSV-E111', 'Hazards are disabled in V1.');
        }
        if (strictCapabilities && raw?.objects && Object.keys(raw.objects || {}).length > 0) {
            pushError('TDSV-E112', 'Objects are disabled in V1.');
        }
        if (strictCapabilities && raw?.statusEffects && Object.keys(raw.statusEffects || {}).length > 0) {
            pushError('TDSV-E113', 'Status effects are disabled in V1.');
        }
        if (strictCapabilities && raw?.music && Object.keys(raw.music || {}).length > 0) {
            pushError('TDSV-E114', 'Music scripting fields are disabled in V1.');
        }

        const budgets = encounter?.budgets || {};
        if ((Number(raw?.budgets?.maxEnemyBulletsAlive) || 0) > (Number(budgets.maxEnemyBulletsAlive) || 0)) {
            pushWarning('TDSV-W010', 'Requested maxEnemyBulletsAlive exceeds safe cap and was clamped.');
        }
        if ((Number(raw?.budgets?.maxActionsPerSecond) || 0) > (Number(budgets.maxActionsPerSecond) || 0)) {
            pushWarning('TDSV-W011', 'Requested maxActionsPerSecond exceeds safe cap and was clamped.');
        }

        const phaseList = Array.isArray(encounter?.sequence?.phases) ? encounter.sequence.phases : [];
        const phaseIdSet = new Set();
        const duplicatePhases = new Set();
        for (const phase of phaseList) {
            const id = String(phase?.id || '').trim();
            if (!id) continue;
            if (phaseIdSet.has(id)) duplicatePhases.add(id);
            phaseIdSet.add(id);
        }
        for (const id of duplicatePhases) pushError('TDSV-E020', 'Duplicate phase id "' + id + '".');
        const startPhase = String(encounter?.sequence?.startPhase || '').trim();
        if (!startPhase || !phaseIdSet.has(startPhase)) pushError('TDSV-E021', 'Start phase "' + startPhase + '" is missing from sequence phases.');

        const adjacency = {};
        for (const phase of phaseList) {
            const id = String(phase?.id || '').trim();
            if (!id) continue;
            adjacency[id] = new Set();
            const actions = collectActionsFromPhase(phase);
            for (const action of actions) {
                if (String(action?.type || '').toLowerCase() !== 'transition_phase') continue;
                const target = String(action?.phase || '').trim();
                if (!target) continue;
                adjacency[id].add(target);
                if (!phaseIdSet.has(target)) pushError('TDSV-E022', 'Phase "' + id + '" transitions to unknown phase "' + target + '".');
            }
        }
        if (phaseIdSet.has(startPhase)) {
            const visited = new Set();
            const queue = [startPhase];
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current || visited.has(current)) continue;
                visited.add(current);
                for (const next of Array.from(adjacency[current] || [])) {
                    if (!visited.has(next)) queue.push(next);
                }
            }
            for (const id of phaseIdSet) {
                if (!visited.has(id)) pushWarning('TDSV-W023', 'Phase "' + id + '" is unreachable from start phase.');
            }
        }

        let hasWinAction = false;
        const knownEnemyTypes = new Set(Object.keys(encounter?.enemyTypes || {}));
        const knownPatterns = new Set(Object.keys(encounter?.patterns || {}));
        const knownProjectiles = new Set(Object.keys(encounter?.projectileTypes || {}));
        const knownHazards = new Set(Object.keys(encounter?.hazards || {}));
        const knownPickups = new Set(Object.keys(encounter?.pickups || {}));
        const knownStatuses = new Set(Object.keys(encounter?.statusEffects || {}));
        const knownEmitters = new Set(Object.keys(encounter?.emitters || {}));
        const knownObjectives = new Set((Array.isArray(encounter?.objectives) ? encounter.objectives : []).map((item) => String(item?.id || '')).filter(Boolean));

        const maxSeconds = Number(encounter?.budgets?.maxEncounterSeconds) || 180;
        const dangerousPatternTypes = new Set(['beam', 'beam_sweep', 'meteor', 'wall']);
        const telegraphActionTypes = new Set(['spawn_telegraph', 'telegraph_then_fire', 'telegraph_then_spawn_enemy', 'telegraph_then_spawn_hazard']);

        const validateActionReference = (action, origin, hasTelegraphAction) => {
            const type = String(action?.type || '').toLowerCase();
            if (!type) return;
            if (V1_ACTION_TYPES.size > 0 && !V1_ACTION_TYPES.has(type)) {
                pushCapabilityIssue(
                    'TDSV-E115',
                    'TDSV-W115',
                    'Action "' + type + '" in ' + origin + ' is disabled in V1.'
                );
            }
            if (type === 'win') hasWinAction = true;
            if (type === 'spawn_enemy') {
                const enemyType = String(action?.enemyType || '').trim();
                if (enemyType && !knownEnemyTypes.has(enemyType)) pushError('TDSV-E030', 'Action spawn_enemy in ' + origin + ' references unknown enemyType "' + enemyType + '".');
            }
            if (type === 'fire_pattern' || type === 'telegraph_then_fire') {
                const patternId = String(action?.pattern || '').trim();
                if (patternId && !knownPatterns.has(patternId)) pushError('TDSV-E031', 'Action ' + type + ' in ' + origin + ' references unknown pattern "' + patternId + '".');
                const pattern = encounter?.patterns?.[patternId] || null;
                const pType = String(pattern?.type || '').toLowerCase();
                if (dangerousPatternTypes.has(pType) && !hasTelegraphAction && type === 'fire_pattern') {
                    pushWarning('TDSV-W032', origin + ' fires dangerous pattern "' + patternId + '" without telegraph actions.');
                }
            }
            if (type === 'spawn_hazard') {
                const hazardId = String(action?.hazard || '').trim();
                if (hazardId && !knownHazards.has(hazardId)) pushError('TDSV-E033', 'Action spawn_hazard in ' + origin + ' references unknown hazard "' + hazardId + '".');
            }
            if (type === 'spawn_pickup') {
                const pickupRef = action?.pickup;
                if (typeof pickupRef === 'string') {
                    const pickupId = pickupRef.trim();
                    if (pickupId && !knownPickups.has(pickupId)) pushError('TDSV-E034', 'Action spawn_pickup in ' + origin + ' references unknown pickup "' + pickupId + '".');
                } else if (pickupRef && typeof pickupRef === 'object') {
                    const inlinePickup = normalizePickup(pickupRef, String(action?.pickupId || 'inline_pickup'));
                    if (inlinePickup.statusOnPickup && !knownStatuses.has(String(inlinePickup.statusOnPickup))) {
                        pushError('TDSV-E034A', 'Inline pickup in ' + origin + ' references unknown status "' + String(inlinePickup.statusOnPickup) + '".');
                    }
                }
            }
            if (type === 'apply_status' || type === 'remove_status') {
                const statusId = String(action?.status || '').trim();
                if (statusId && !knownStatuses.has(statusId)) pushError('TDSV-E035', 'Action ' + type + ' in ' + origin + ' references unknown status "' + statusId + '".');
            }
            if (type === 'spawn_emitter') {
                const emitterId = String(action?.emitterId || action?.emitter || '').trim();
                if (emitterId && !knownEmitters.has(emitterId)) pushError('TDSV-E036', 'Action spawn_emitter in ' + origin + ' references unknown emitter "' + emitterId + '".');
            }
            if (type === 'activate_objective' || type === 'complete_objective' || type === 'fail_objective' || type === 'set_objective_progress') {
                const objectiveId = String(action?.objective || action?.objectiveId || '').trim();
                if (objectiveId && !knownObjectives.has(objectiveId)) pushError('TDSV-E037', 'Action ' + type + ' in ' + origin + ' references unknown objective "' + objectiveId + '".');
            }
        };

        for (const phase of phaseList) {
            const phaseId = String(phase?.id || '').trim();
            const contexts = collectActionContextsFromPhase(phase);
            const hasTelegraphAction = contexts.some(({ action }) => telegraphActionTypes.has(String(action?.type || '').toLowerCase()));
            for (const { action, origin } of contexts) {
                validateActionReference(action, origin, hasTelegraphAction);
            }

            for (const rule of (Array.isArray(phase?.rules) ? phase.rules : [])) {
                const whenType = String(rule?.when?.type || '').toLowerCase();
                if (whenType && V1_TRIGGER_TYPES.size > 0 && !V1_TRIGGER_TYPES.has(whenType)) {
                    pushCapabilityIssue(
                        'TDSV-E116',
                        'TDSV-W116',
                        'Trigger "' + whenType + '" in phase "' + phaseId + '" is disabled in V1.'
                    );
                }
                const seconds = Number(rule?.when?.seconds);
                if ((whenType === 'time_elapsed' || whenType === 'phase_elapsed') && Number.isFinite(seconds) && seconds > maxSeconds) {
                    pushWarning('TDSV-W040', 'Rule trigger "' + whenType + '" in phase "' + phaseId + '" uses seconds beyond maxEncounterSeconds.');
                }
            }
        }

        const actionGroups = encounter?.sequence?.actionGroups || {};
        const actionGroupContexts = collectActionContextsFromActionGroups(actionGroups);
        const groupHasTelegraphByOrigin = new Map();
        for (const { action, origin } of actionGroupContexts) {
            const groupOrigin = String(origin || '').split(' (nested)')[0];
            if (!groupHasTelegraphByOrigin.has(groupOrigin)) groupHasTelegraphByOrigin.set(groupOrigin, false);
            if (telegraphActionTypes.has(String(action?.type || '').toLowerCase())) {
                groupHasTelegraphByOrigin.set(groupOrigin, true);
            }
        }
        for (const { action, origin } of actionGroupContexts) {
            const groupOrigin = String(origin || '').split(' (nested)')[0];
            validateActionReference(action, origin, groupHasTelegraphByOrigin.get(groupOrigin) === true);
        }
        if (!hasWinAction) pushWarning('TDSV-W024', 'No explicit win action found across sequence phases.');

        for (const [enemyTypeId, enemyType] of Object.entries(encounter?.enemyTypes || {})) {
            if (!enemyType || typeof enemyType !== 'object') continue;
            const directPatternId = String(enemyType.attackPatternId || '').trim();
            if (directPatternId && !knownPatterns.has(directPatternId)) {
                pushError('TDSV-E041', 'Enemy "' + enemyTypeId + '" references unknown attackPatternId "' + directPatternId + '".');
            }
            for (const attack of (Array.isArray(enemyType.attacks) ? enemyType.attacks : [])) {
                const patternId = String(attack?.pattern || '').trim();
                if (patternId && !knownPatterns.has(patternId)) pushError('TDSV-E042', 'Enemy "' + enemyTypeId + '" attack references unknown pattern "' + patternId + '".');
            }
        }

        for (const [patternId, pattern] of Object.entries(encounter?.patterns || {})) {
            const type = String(pattern?.type || '').toLowerCase();
            if (!SUPPORTED_PATTERN_TYPES.has(type)) {
                pushWarning('TDSV-W052', 'Pattern "' + patternId + '" uses unsupported type "' + type + '" and may fallback to spiral at runtime.');
            }
            const projectileId = String(pattern?.projectileType || '').trim();
            if (projectileId && !knownProjectiles.has(projectileId)) {
                pushError('TDSV-E044', 'Pattern "' + patternId + '" references unknown projectileType "' + projectileId + '".');
            }
        }

        for (const [groupId, actions] of Object.entries(actionGroups)) {
            const count = Array.isArray(actions) ? actions.length : 0;
            if (count > 120) pushWarning('TDSV-W050', 'Action group "' + groupId + '" exceeds recommended step cap (120).');
        }
        for (const [patternId, pattern] of Object.entries(encounter?.patterns || {})) {
            const modifiers = Array.isArray(pattern?.modifiers) ? pattern.modifiers : [];
            if (modifiers.length > 12) pushWarning('TDSV-W051', 'Pattern "' + patternId + '" exceeds modifier cap (12).');
            const type = String(pattern?.type || '').toLowerCase();
            if (type === 'nested') {
                const child = String(pattern?.childPattern || pattern?.pattern || '').trim();
                if (child && child === String(patternId)) pushError('TDSV-E052', 'Pattern "' + patternId + '" recursively references itself.');
            }
        }

        return {
            ok: errors.length === 0,
            encounter,
            normalized: true,
            warnings,
            errors,
            appliedDifficultyProfile
        };
    }

    function validateEncounter(source, options = null) {
        return validateEncounterDefinition(source, options);
    }

    const api = {
        DEFAULTS,
        capabilityProfile: V1_PROFILE,
        normalizeEncounter,
        validateEncounter,
        validateEncounterDefinition,
        normalizeEncounterDifficulty
    };

    if (root) root.TDSEncounterSchema = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
