(() => {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeType(value, fallback = '') {
        const v = String(value || fallback).trim().toLowerCase();
        return v || fallback;
    }

    function toFinite(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function weightedPick(items, randomFloat) {
        if (!Array.isArray(items) || items.length === 0) return null;
        const total = items.reduce((acc, item) => acc + Math.max(0.01, Number(item?.weight) || 1), 0);
        if (total <= 0) return items[0] || null;
        let roll = randomFloat() * total;
        for (const item of items) {
            roll -= Math.max(0.01, Number(item?.weight) || 1);
            if (roll <= 0) return item;
        }
        return items[items.length - 1] || null;
    }

    function sanitizeBossPhase(phase, index) {
        const source = (phase && typeof phase === 'object') ? phase : {};
        return {
            id: String(source.id || ('boss_phase_' + index)),
            untilHpRatio: Number.isFinite(Number(source.untilHpRatio)) ? clamp(Number(source.untilHpRatio), 0.01, 1) : null,
            untilElapsedSeconds: Number.isFinite(Number(source.untilElapsedSeconds)) ? clamp(Number(source.untilElapsedSeconds), 0, 600) : null,
            attackDeckMode: normalizeType(source.attackDeckMode, 'weighted_deck'),
            attackDeck: Array.isArray(source.attackDeck) ? source.attackDeck.map((item) => String(item || '').trim()).filter(Boolean) : [],
            noRepeatWindow: Math.max(0, Number(source.noRepeatWindow) || 0),
            onEnter: Array.isArray(source.onEnter) ? source.onEnter : []
        };
    }

    function createEnemyRuntime({
        PIXI,
        gameLayer,
        encounter,
        entities,
        toIsometric,
        playerStateProvider,
        emitPattern,
        randomFloat,
        eventBus,
        mapSizeProvider,
        budgetsProvider,
        arenaAdapter,
        renderPresetResolver
    }) {
        const active = [];
        const pendingBossActions = [];
        const rand = (typeof randomFloat === 'function') ? randomFloat : Math.random;
        const mapSize = Math.max(300, Number(mapSizeProvider?.() || encounter?.arena?.mapSize) || 1500);
        const behaviorRegistry = window.TDSBehaviorRegistry?.create?.() || null;
        const collection = encounter?.runtimeCollections || {};
        if (!Array.isArray(collection.pickups)) collection.pickups = [];
        encounter.runtimeCollections = collection;

        function emitEvent(type, payload = {}) {
            eventBus?.emit?.(type, payload);
        }

        function createEnemySprite(template) {
            const radius = clamp(toFinite(template?.radius, 12), 6, 240);
            const preset = (typeof renderPresetResolver === 'function'
                ? (renderPresetResolver('enemyArchetypes', String(template?.archetype || ''), template) || renderPresetResolver(template?.boss ? 'bosses' : 'enemyArchetypes', template?.boss ? 'boss_default' : 'enemy_default', template) || {})
                : {});
            const fillColor = Number.isFinite(Number(preset?.fillColor))
                ? Number(preset.fillColor)
                : (template?.boss ? 0xff8c3a : 0xff4d8e);
            const ringColor = Number.isFinite(Number(preset?.ringColor)) ? Number(preset.ringColor) : 0xff8db2;
            const alpha = Math.max(0.2, Math.min(1, Number(preset?.alpha) || 1));
            const sprite = new PIXI.Graphics();
            sprite.circle(0, 0, radius * 0.95);
            sprite.fill({ color: ringColor, alpha: 0.2 });
            sprite.moveTo(0, -radius * 1.1);
            sprite.lineTo(radius * 0.75, 0);
            sprite.lineTo(0, radius * 1.1);
            sprite.lineTo(-radius * 0.75, 0);
            sprite.closePath();
            sprite.fill({ color: fillColor, alpha });
            return sprite;
        }

        function findById(enemyId) {
            return active.find((enemy) => enemy?.id === enemyId && enemy.alive && enemy.hp > 0) || null;
        }

        function getAliveEnemies() {
            return active.filter((enemy) => enemy && enemy.alive && enemy.hp > 0);
        }

        function deriveArchetype(enemyTypeId, raw) {
            const source = raw && typeof raw === 'object' ? raw : {};
            return normalizeType(source.archetype || enemyTypeId || 'scout', 'scout');
        }

        function defaultBossScript(template) {
            const thresholds = Array.isArray(template?.phaseThresholds) ? template.phaseThresholds.slice() : [];
            const baseAttackIds = Array.isArray(template?.attacks) ? template.attacks.map((item) => String(item?.id || '')).filter(Boolean) : [];
            if (thresholds.length === 0) {
                return [sanitizeBossPhase({
                    id: 'phase_1',
                    untilHpRatio: 0.01,
                    attackDeck: baseAttackIds,
                    onEnter: []
                }, 0)];
            }
            const out = [];
            for (let i = 0; i <= thresholds.length; i += 1) {
                const id = 'phase_' + (i + 1);
                const untilHpRatio = i < thresholds.length ? Number(thresholds[i]) : 0.01;
                out.push(sanitizeBossPhase({
                    id,
                    untilHpRatio,
                    attackDeck: baseAttackIds,
                    onEnter: i === 0 ? [] : [{ type: 'show_banner', text: 'Boss ' + id.replace('_', ' ') }]
                }, i));
            }
            return out;
        }

        function applyEnemyModifiers(template) {
            const modifiers = Array.isArray(template?.modifiers) ? template.modifiers : [];
            const out = { ...(template || {}) };
            for (const modRaw of modifiers) {
                const mod = normalizeType(modRaw);
                if (mod === 'elite_fast') {
                    out.speed = clamp((Number(out.speed) || 1) * 1.35, 0.1, 12);
                } else if (mod === 'elite_armored') {
                    out.hp = clamp(Math.floor((Number(out.hp) || 8) * 1.45), 1, 20000);
                } else if (mod === 'elite_splitter') {
                    out.onDeathSpawn = { enemyType: 'scout', count: 2 };
                } else if (mod === 'elite_explosive') {
                    out.explodeOnDeath = true;
                } else if (mod === 'elite_regenerating') {
                    out.regenPerSecond = clamp(Number(out.regenPerSecond) || 0.6, 0, 30);
                } else if (mod === 'elite_shielded') {
                    out.shieldRatio = clamp(Number(out.shieldRatio) || 0.35, 0, 0.9);
                } else if (mod === 'elite_bullet_hell') {
                    out.attackCadenceMultiplier = clamp(Number(out.attackCadenceMultiplier) || 0.65, 0.1, 2);
                    out.attackBurstBonus = Math.max(0, Number(out.attackBurstBonus) || 1);
                }
            }
            return out;
        }

        function defaultAttacksForTemplate(template) {
            if (Array.isArray(template?.attacks) && template.attacks.length > 0) {
                return template.attacks.map((attack, index) => ({
                    id: String(attack?.id || ('atk_' + index)),
                    pattern: String(attack?.pattern || template.attackPatternId || 'enemy_spiral_pressure'),
                    everySeconds: clamp(toFinite(attack?.everySeconds, Math.max(0.12, (Number(template.attackIntervalMs) || 900) / 1000)), 0.1, 30),
                    initialDelaySeconds: clamp(toFinite(attack?.initialDelaySeconds, 0), 0, 60),
                    weight: clamp(toFinite(attack?.weight, 1), 0.01, 100),
                    trigger: (attack?.trigger && typeof attack.trigger === 'object') ? attack.trigger : null,
                    once: attack?.once === true,
                    source: (attack?.source && typeof attack.source === 'object') ? attack.source : null,
                    aim: (attack?.aim && typeof attack.aim === 'object') ? attack.aim : null
                }));
            }
            return [{
                id: 'legacy_attack',
                pattern: String(template?.attackPatternId || 'enemy_spiral_pressure'),
                everySeconds: clamp(toFinite((Number(template?.attackIntervalMs) || 900) / 1000, 0.9), 0.1, 30),
                initialDelaySeconds: 0,
                weight: 1,
                trigger: null,
                once: false,
                source: null,
                aim: null
            }];
        }

        function buildTemplate(enemyTypeId) {
            const base = encounter?.enemyTypes?.[enemyTypeId];
            if (!base) return null;
            const archetypeId = deriveArchetype(enemyTypeId, base);
            const archetype = encounter?.enemyArchetypes?.[archetypeId] || {};
            const merged = {
                hp: clamp(toFinite(archetype.hp, 8), 1, 20000),
                radius: clamp(toFinite(archetype.radius, 20), 6, 260),
                speed: clamp(toFinite(archetype.speed, 1.25), 0.05, 14),
                behavior: normalizeType(archetype.behavior, 'chase_player'),
                attackPatternId: String(archetype.attackPatternId || 'enemy_spiral_pressure'),
                attackIntervalMs: clamp(Math.floor(toFinite(archetype.attackIntervalMs, 900)), 120, 30000),
                attackMode: normalizeType(archetype.attackMode, 'fixed_interval'),
                ...archetype,
                ...base
            };
            merged.archetype = archetypeId;
            const withModifiers = applyEnemyModifiers(merged);
            withModifiers.attacks = defaultAttacksForTemplate(withModifiers);
            const explicitBossPhases = Array.isArray(withModifiers?.bossPhases) ? withModifiers.bossPhases : (Array.isArray(withModifiers?.phases) ? withModifiers.phases : []);
            withModifiers.bossPhases = (withModifiers?.boss === true)
                ? (explicitBossPhases.length > 0 ? explicitBossPhases.map((phase, index) => sanitizeBossPhase(phase, index)) : defaultBossScript(withModifiers))
                : [];
            return withModifiers;
        }

        function canSpawnByBudget(extra = 1) {
            const max = Number(budgetsProvider?.().maxEnemiesAlive) || 24;
            return (getAliveEnemies().length + Math.max(0, Number(extra) || 0)) <= max;
        }

        function spawnEnemy(enemyTypeId, spawn) {
            const template = buildTemplate(enemyTypeId);
            if (!template) return null;
            if (!canSpawnByBudget(1)) {
                emitEvent('enemy_budget_reached', { enemyTypeId });
                return null;
            }

            const sprite = createEnemySprite(template);
            gameLayer.addChild(sprite);
            const initialShield = clamp(Math.floor((Number(template.shieldRatio) || 0) * Number(template.hp || 1)), 0, Number(template.hp || 0));
            const base = entities.createEntity({
                type: 'enemy',
                team: 'enemy',
                radius: template.radius,
                hp: template.hp,
                maxHp: template.hp,
                x: Number(spawn?.x) || 0,
                y: Number(spawn?.y) || 0,
                data: {
                    enemyTypeId,
                    archetype: template.archetype,
                    moveSpeed: Number(template.speed) || 1.2,
                    behavior: normalizeType(template.behavior, 'chase_player'),
                    attackPatternId: String(template.attackPatternId || 'enemy_spiral_pressure'),
                    attackIntervalMs: Number(template.attackIntervalMs) || 900,
                    attackMode: normalizeType(template.attackMode, 'fixed_interval'),
                    attacks: Array.isArray(template.attacks) ? template.attacks : [],
                    isBoss: template.boss === true,
                    bossId: String(template.bossId || enemyTypeId || 'boss'),
                    bossDisplayName: String(template.displayName || template.bossName || enemyTypeId || 'Boss'),
                    bossSubtitle: String(template.bossSubtitle || template.objectiveLabel || ''),
                    bossWeakPoints: Array.isArray(template.weakPoints) ? template.weakPoints : [],
                    bossParts: Array.isArray(template.parts) ? template.parts : [],
                    bossPhases: Array.isArray(template.bossPhases) ? template.bossPhases : [],
                    bossShield: template.shield && typeof template.shield === 'object' ? template.shield : null,
                    damageLocked: template.damageLocked === true,
                    phaseThresholds: Array.isArray(template.phaseThresholds) ? template.phaseThresholds.slice() : [],
                    triggeredThresholds: [],
                    bossPhaseIndex: 0,
                    patrolPoints: Array.isArray(template.patrolPoints) ? template.patrolPoints : [],
                    movePoints: Array.isArray(template.movePoints) ? template.movePoints : [],
                    guardZone: template.guardZone && typeof template.guardZone === 'object' ? template.guardZone : null,
                    escortTargetId: template.escortTargetId ? String(template.escortTargetId) : null,
                    protectBoss: template.protectBoss === true,
                    regenPerSecond: clamp(toFinite(template.regenPerSecond, 0), 0, 30),
                    explodeOnDeath: template.explodeOnDeath === true,
                    onDeathSpawn: template.onDeathSpawn && typeof template.onDeathSpawn === 'object' ? template.onDeathSpawn : null,
                    summonedEnemyType: String(template.summonedEnemyType || 'scout'),
                    summonedEverySeconds: clamp(toFinite(template.summonedEverySeconds, 6), 0.5, 60),
                    healEverySeconds: clamp(toFinite(template.healEverySeconds, 4), 0.5, 60),
                    healAmount: clamp(toFinite(template.healAmount, 2), 0.1, 100),
                    shieldEverySeconds: clamp(toFinite(template.shieldEverySeconds, 6), 0.5, 60),
                    shieldAmount: clamp(toFinite(template.shieldAmount, 3), 0.1, 100),
                    attackCadenceMultiplier: clamp(toFinite(template.attackCadenceMultiplier, 1), 0.1, 4),
                    attackBurstBonus: Math.max(0, Number(template.attackBurstBonus) || 0),
                    modifiers: Array.isArray(template.modifiers) ? template.modifiers.slice() : [],
                    pickupDrops: Array.isArray(template.pickupDrops) ? template.pickupDrops : []
                }
            });

            const runtimeEnemy = {
                ...base,
                sprite,
                shield: initialShield,
                maxShield: initialShield,
                attackMs: 0,
                behaviorState: {
                    elapsedMs: 0,
                    phase: 'idle',
                    cooldownMs: 0,
                    stepIndex: 0,
                    lastDashAtMs: -Infinity,
                    burrowed: false,
                    burrowCooldownMs: 0,
                    supportCooldownMs: 0,
                    attackState: {
                        cooldownByAttackId: Object.create(null),
                        usedOnce: Object.create(null),
                        sequenceIndex: 0,
                        phaseLoopIndex: 0
                    },
                    boss: {
                        activePhaseIndex: 0,
                        activePhaseId: null,
                        phaseStartedMs: 0,
                        currentAttackLabel: '',
                        noRepeatHistory: []
                    }
                }
            };
            if (runtimeEnemy.data.isBoss && Array.isArray(runtimeEnemy.data.bossPhases) && runtimeEnemy.data.bossPhases.length > 0) {
                const firstPhase = runtimeEnemy.data.bossPhases[0];
                runtimeEnemy.behaviorState.boss.activePhaseIndex = 0;
                runtimeEnemy.behaviorState.boss.activePhaseId = String(firstPhase?.id || 'phase_1');
                runtimeEnemy.behaviorState.boss.phaseStartedMs = 0;
                emitEvent('boss_phase_started', {
                    enemyId: runtimeEnemy.id,
                    bossId: runtimeEnemy.data.bossId,
                    phaseId: runtimeEnemy.behaviorState.boss.activePhaseId,
                    phaseIndex: 0
                });
                for (const action of Array.isArray(firstPhase?.onEnter) ? firstPhase.onEnter : []) {
                    pendingBossActions.push({ enemyId: runtimeEnemy.id, action });
                }
            }
            active.push(runtimeEnemy);
            return runtimeEnemy;
        }

        function spawnByFormation(enemyTypeId, count, formation) {
            const total = Math.max(1, Number.parseInt(count, 10) || 1);
            for (let i = 0; i < total; i += 1) {
                if (!canSpawnByBudget(1)) return;
                if (formation === 'left_right') {
                    const side = (i % 2 === 0) ? -1 : 1;
                    const row = Math.floor(i / 2);
                    spawnEnemy(enemyTypeId, { x: side * 680, y: (row * 180) - 140 });
                    continue;
                }
                spawnEnemy(enemyTypeId, { x: (rand() - 0.5) * 900, y: (rand() - 0.5) * 900 });
            }
        }

        function spawnFromAction(action) {
            const enemyTypeId = action?.enemyType;
            const count = Math.max(1, Number.parseInt(action?.count, 10) || 1);
            const formation = String(action?.formation || '');
            if (action?.at && typeof action.at === 'object') {
                const x = Number(action.at.x) || 0;
                const y = Number(action.at.y) || 0;
                for (let i = 0; i < count; i += 1) {
                    if (!canSpawnByBudget(1)) return;
                    const offset = i * 26;
                    spawnEnemy(enemyTypeId, { x: x + offset, y });
                }
                return;
            }
            spawnByFormation(enemyTypeId, count, formation);
        }

        function clampEnemy(enemy) {
            const fn = arenaAdapter?.applyPointPolicy;
            if (typeof fn === 'function') {
                const next = fn({
                    x: Number(enemy?.x) || 0,
                    y: Number(enemy?.y) || 0,
                    entityType: 'enemy',
                    entityId: enemy?.id || null,
                    radius: Number(enemy?.radius) || 10
                }) || null;
                if (next) {
                    if (Number.isFinite(Number(next.x))) enemy.x = Number(next.x);
                    if (Number.isFinite(Number(next.y))) enemy.y = Number(next.y);
                    return next;
                }
            } else {
                enemy.x = clamp(enemy.x, -mapSize, mapSize);
                enemy.y = clamp(enemy.y, -mapSize, mapSize);
            }
            return null;
        }

        function moveToward(enemy, tx, ty, speed, dtScale) {
            const dx = tx - enemy.x;
            const dy = ty - enemy.y;
            const len = Math.hypot(dx, dy) || 1;
            enemy.x += (dx / len) * speed * dtScale;
            enemy.y += (dy / len) * speed * dtScale;
            return { dx, dy, len };
        }

        function triggerSatisfied(enemy, trigger, runtime) {
            if (!trigger || typeof trigger !== 'object') return true;
            const type = normalizeType(trigger.type);
            if (type === 'hp_below') {
                const ratio = Number(trigger.ratio);
                if (!Number.isFinite(ratio) || enemy.maxHp <= 0) return false;
                return (enemy.hp / enemy.maxHp) <= ratio;
            }
            if (type === 'player_in_range') {
                const player = runtime.player;
                if (!player?.worldPos) return false;
                const r = Math.max(0, Number(trigger.range) || 300);
                return Math.hypot((player.worldPos.x - enemy.x), (player.worldPos.y - enemy.y)) <= r;
            }
            if (type === 'phase_elapsed') {
                const seconds = Math.max(0, Number(trigger.seconds) || 0);
                return runtime.elapsedMs >= (seconds * 1000);
            }
            return true;
        }

        function selectAttack(enemy, runtime) {
            const attacks = Array.isArray(enemy?.data?.attacks) ? enemy.data.attacks : [];
            if (attacks.length === 0) return null;
            let mode = normalizeType(enemy?.data?.attackMode, 'fixed_interval');
            const state = enemy.behaviorState.attackState;
            const nowMs = runtime.elapsedMs;
            let attackIdAllowList = null;
            let noRepeatBlocked = null;
            if (enemy?.data?.isBoss === true) {
                const bossState = enemy?.behaviorState?.boss || {};
                const phaseIndex = Math.max(0, Number(bossState.activePhaseIndex) || 0);
                const phase = Array.isArray(enemy?.data?.bossPhases) ? enemy.data.bossPhases[phaseIndex] : null;
                if (phase && Array.isArray(phase.attackDeck) && phase.attackDeck.length > 0) {
                    attackIdAllowList = new Set(phase.attackDeck.map((item) => String(item || '')));
                }
                if (phase?.attackDeckMode) mode = normalizeType(phase.attackDeckMode, mode);
                const noRepeatWindow = Math.max(0, Number(phase?.noRepeatWindow) || 0);
                if (noRepeatWindow > 0) {
                    const history = Array.isArray(enemy?.behaviorState?.boss?.noRepeatHistory)
                        ? enemy.behaviorState.boss.noRepeatHistory
                        : [];
                    if (history.length > 0) {
                        noRepeatBlocked = new Set(history.slice(-noRepeatWindow).map((item) => String(item || '')));
                    }
                }
            }

            let valid = attacks.filter((attack) => {
                const id = String(attack?.id || '');
                if (!id) return false;
                if (attackIdAllowList && !attackIdAllowList.has(id)) return false;
                if (attack?.once && state.usedOnce[id]) return false;
                if (!triggerSatisfied(enemy, attack?.trigger, runtime)) return false;
                const cooldownMs = Number(state.cooldownByAttackId[id]) || 0;
                return nowMs >= cooldownMs;
            });
            if (valid.length === 0) return null;
            if (noRepeatBlocked && noRepeatBlocked.size > 0) {
                const nonRepeating = valid.filter((attack) => !noRepeatBlocked.has(String(attack?.id || '')));
                if (nonRepeating.length > 0) valid = nonRepeating;
            }

            if (mode === 'weighted_deck') return weightedPick(valid, rand);
            if (mode === 'sequence') {
                const next = valid[state.sequenceIndex % valid.length];
                state.sequenceIndex = (state.sequenceIndex + 1) % Math.max(1, valid.length);
                return next;
            }
            if (mode === 'phase_loop') {
                const next = valid[state.phaseLoopIndex % valid.length];
                state.phaseLoopIndex = (state.phaseLoopIndex + 1) % Math.max(1, valid.length);
                return next;
            }
            if (mode === 'cooldown_when_in_range') {
                const player = runtime.player;
                if (!player?.worldPos) return null;
                const ranged = valid.filter((attack) => {
                    const range = Math.max(10, Number(attack?.range) || 420);
                    return Math.hypot((player.worldPos.x - enemy.x), (player.worldPos.y - enemy.y)) <= range;
                });
                if (ranged.length === 0) return null;
                return weightedPick(ranged, rand);
            }
            if (mode === 'triggered_once') {
                return valid.find((attack) => attack?.once) || valid[0];
            }
            return valid[0];
        }

        function fireAttack(enemy, attack, runtime) {
            if (!attack) return;
            const id = String(attack?.id || 'attack');
            emitPattern?.(enemy, attack);
            const bonus = Math.max(0, Number(enemy?.data?.attackBurstBonus) || 0);
            for (let i = 0; i < bonus; i += 1) emitPattern?.(enemy, attack);
            enemy.behaviorState.attackState.usedOnce[id] = attack?.once === true;
            const cadenceScale = clamp(Number(enemy?.data?.attackCadenceMultiplier) || 1, 0.1, 4);
            const every = clamp(toFinite(attack?.everySeconds, Math.max(0.12, (Number(enemy?.data?.attackIntervalMs) || 900) / 1000)), 0.1, 30);
            enemy.behaviorState.attackState.cooldownByAttackId[id] = runtime.elapsedMs + (every * 1000 * cadenceScale);
            if (enemy?.data?.isBoss === true) {
                enemy.behaviorState.boss.currentAttackLabel = String(attack?.label || attack?.id || attack?.pattern || 'Attack');
                const phaseIndex = Math.max(0, Number(enemy?.behaviorState?.boss?.activePhaseIndex) || 0);
                const phase = Array.isArray(enemy?.data?.bossPhases) ? enemy.data.bossPhases[phaseIndex] : null;
                const windowSize = Math.max(0, Number(phase?.noRepeatWindow) || 0);
                if (windowSize > 0) {
                    const history = Array.isArray(enemy.behaviorState.boss.noRepeatHistory) ? enemy.behaviorState.boss.noRepeatHistory : [];
                    history.push(id);
                    while (history.length > windowSize) history.shift();
                    enemy.behaviorState.boss.noRepeatHistory = history;
                }
            }
            emitEvent('enemy_attack_fired', { enemyId: enemy.id, enemyTypeId: enemy?.data?.enemyTypeId || null, attackId: id, pattern: attack?.pattern || null });
        }

        function updateBossPhase(enemy, runtime) {
            if (!enemy?.data?.isBoss) return;
            const phases = Array.isArray(enemy?.data?.bossPhases) ? enemy.data.bossPhases : [];
            if (phases.length === 0) return;
            const bossState = enemy.behaviorState.boss || {};
            const currentIndex = Math.max(0, Math.min(phases.length - 1, Number(bossState.activePhaseIndex) || 0));
            const currentPhase = phases[currentIndex] || null;
            if (!currentPhase) return;
            const hpRatio = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) : 0;
            const elapsedInPhase = Math.max(0, runtime.elapsedMs - (Number(bossState.phaseStartedMs) || 0));
            let shouldTransition = false;
            if (Number.isFinite(Number(currentPhase.untilHpRatio)) && hpRatio <= Number(currentPhase.untilHpRatio) && currentIndex < (phases.length - 1)) {
                shouldTransition = true;
            }
            if (Number.isFinite(Number(currentPhase.untilElapsedSeconds)) && elapsedInPhase >= (Number(currentPhase.untilElapsedSeconds) * 1000) && currentIndex < (phases.length - 1)) {
                shouldTransition = true;
            }
            if (!shouldTransition) return;
            const nextIndex = currentIndex + 1;
            const nextPhase = phases[nextIndex];
            bossState.activePhaseIndex = nextIndex;
            bossState.activePhaseId = String(nextPhase?.id || ('phase_' + (nextIndex + 1)));
            bossState.phaseStartedMs = runtime.elapsedMs;
            bossState.currentAttackLabel = '';
            enemy.behaviorState.boss = bossState;
            enemy.data.bossPhaseIndex = nextIndex;
            emitEvent('boss_phase_completed', {
                enemyId: enemy.id,
                bossId: enemy.data.bossId,
                phaseId: String(currentPhase?.id || ''),
                phaseIndex: currentIndex
            });
            emitEvent('boss_phase_started', {
                enemyId: enemy.id,
                bossId: enemy.data.bossId,
                phaseId: bossState.activePhaseId,
                phaseIndex: nextIndex
            });
            for (const action of Array.isArray(nextPhase?.onEnter) ? nextPhase.onEnter : []) {
                pendingBossActions.push({ enemyId: enemy.id, action });
            }
        }

        function runSupportHooks(enemy, runtime) {
            const behavior = normalizeType(enemy?.data?.behavior, 'chase_player');
            const state = enemy.behaviorState;
            state.supportCooldownMs = Math.max(0, Number(state.supportCooldownMs) - runtime.deltaMs);
            if (state.supportCooldownMs > 0) return;

            if (behavior === 'summoner') {
                const countAlive = getAliveEnemies().length;
                const maxAlive = Number(budgetsProvider?.().maxEnemiesAlive) || 24;
                if (countAlive < maxAlive) {
                    const spawnType = String(enemy?.data?.summonedEnemyType || 'scout');
                    spawnEnemy(spawnType, { x: enemy.x + ((rand() - 0.5) * 120), y: enemy.y + ((rand() - 0.5) * 120) });
                    emitEvent('enemy_summoned_add', { enemyId: enemy.id, summonedType: spawnType });
                }
                state.supportCooldownMs = (Number(enemy?.data?.summonedEverySeconds) || 6) * 1000;
                return;
            }
            if (behavior === 'healer') {
                const ally = getAliveEnemies()
                    .filter((item) => item.id !== enemy.id && item.hp < item.maxHp)
                    .sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)))[0];
                if (ally) {
                    ally.hp = Math.min(ally.maxHp, ally.hp + Math.max(0.1, Number(enemy?.data?.healAmount) || 2));
                    emitEvent('enemy_heal_cast', { healerId: enemy.id, allyId: ally.id });
                }
                state.supportCooldownMs = (Number(enemy?.data?.healEverySeconds) || 4) * 1000;
                return;
            }
            if (behavior === 'shielder') {
                const ally = getAliveEnemies().filter((item) => item.id !== enemy.id).sort((a, b) => a.hp - b.hp)[0];
                if (ally) {
                    const boost = Math.max(0.1, Number(enemy?.data?.shieldAmount) || 3);
                    ally.shield = Math.max(0, Number(ally.shield) || 0) + boost;
                    ally.maxShield = Math.max(Number(ally.maxShield) || 0, Number(ally.shield) || 0);
                    emitEvent('enemy_shield_cast', { casterId: enemy.id, allyId: ally.id, amount: boost });
                }
                state.supportCooldownMs = (Number(enemy?.data?.shieldEverySeconds) || 6) * 1000;
            }
        }

        function registerBehaviors() {
            if (!behaviorRegistry) return;
            behaviorRegistry.register('stationary_turret', () => {});
            behaviorRegistry.register('chase_player', (enemy, ctx) => {
                moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed, ctx.dt);
            });
            behaviorRegistry.register('keep_distance', (enemy, ctx) => {
                const preferred = 360;
                const { dx, dy, len } = moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, 0, ctx.dt);
                if (len < preferred - 40) {
                    enemy.x -= (dx / len) * ctx.moveSpeed * ctx.dt;
                    enemy.y -= (dy / len) * ctx.moveSpeed * ctx.dt;
                } else if (len > preferred + 60) {
                    enemy.x += (dx / len) * ctx.moveSpeed * ctx.dt;
                    enemy.y += (dy / len) * ctx.moveSpeed * ctx.dt;
                }
                enemy.x += (-dy / len) * ctx.moveSpeed * 0.28 * ctx.dt;
                enemy.y += (dx / len) * ctx.moveSpeed * 0.28 * ctx.dt;
            });
            behaviorRegistry.register('strafe_player', (enemy, ctx) => {
                const dx = ctx.player.worldPos.x - enemy.x;
                const dy = ctx.player.worldPos.y - enemy.y;
                const len = Math.hypot(dx, dy) || 1;
                enemy.x += (-dy / len) * ctx.moveSpeed * ctx.dt;
                enemy.y += (dx / len) * ctx.moveSpeed * ctx.dt;
            });
            behaviorRegistry.register('orbit_player', (enemy, ctx) => {
                const preferred = 320;
                const dx = ctx.player.worldPos.x - enemy.x;
                const dy = ctx.player.worldPos.y - enemy.y;
                const len = Math.hypot(dx, dy) || 1;
                const radial = (len - preferred) * 0.02;
                enemy.x += ((dx / len) * radial + (-dy / len) * 0.8) * ctx.moveSpeed * ctx.dt;
                enemy.y += ((dy / len) * radial + (dx / len) * 0.8) * ctx.moveSpeed * ctx.dt;
            });
            behaviorRegistry.register('charge_telegraphed', (enemy, ctx) => {
                const state = enemy.behaviorState;
                state.cooldownMs = Math.max(0, Number(state.cooldownMs) - ctx.deltaMs);
                if (state.phase !== 'charge' && state.cooldownMs <= 0) {
                    state.phase = 'telegraph';
                    state.cooldownMs = 650;
                    enemy.sprite.alpha = 0.45;
                } else if (state.phase === 'telegraph' && state.cooldownMs <= 0) {
                    state.phase = 'charge';
                    state.cooldownMs = 250;
                    enemy.sprite.alpha = 1;
                }
                if (state.phase === 'charge') {
                    moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 4.2, ctx.dt);
                    if (state.cooldownMs <= 0) {
                        state.phase = 'recover';
                        state.cooldownMs = 900;
                    }
                } else if (state.phase === 'recover') {
                    if (state.cooldownMs <= 0) state.phase = 'idle';
                } else if (state.phase !== 'telegraph') {
                    moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.65, ctx.dt);
                }
            });
            behaviorRegistry.register('dash_through_player', (enemy, ctx) => {
                const state = enemy.behaviorState;
                state.cooldownMs = Math.max(0, Number(state.cooldownMs) - ctx.deltaMs);
                if (state.cooldownMs <= 0) {
                    const dx = ctx.player.worldPos.x - enemy.x;
                    const dy = ctx.player.worldPos.y - enemy.y;
                    const len = Math.hypot(dx, dy) || 1;
                    state.dashVx = (dx / len) * ctx.moveSpeed * 5;
                    state.dashVy = (dy / len) * ctx.moveSpeed * 5;
                    state.cooldownMs = 1100;
                    state.phase = 'dashing';
                }
                if (state.phase === 'dashing') {
                    enemy.x += (Number(state.dashVx) || 0) * ctx.dt;
                    enemy.y += (Number(state.dashVy) || 0) * ctx.dt;
                    state.cooldownMs -= ctx.deltaMs * 2.3;
                    if (state.cooldownMs <= 500) state.phase = 'idle';
                } else {
                    moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.45, ctx.dt);
                }
            });
            behaviorRegistry.register('wander', (enemy, ctx) => {
                const state = enemy.behaviorState;
                state.wanderMs = Math.max(0, Number(state.wanderMs) - ctx.deltaMs);
                if (state.wanderMs <= 0 || !Number.isFinite(state.wanderTx) || !Number.isFinite(state.wanderTy)) {
                    state.wanderTx = (ctx.random() * 2 - 1) * mapSize;
                    state.wanderTy = (ctx.random() * 2 - 1) * mapSize;
                    state.wanderMs = 1200 + (ctx.random() * 1600);
                }
                moveToward(enemy, state.wanderTx, state.wanderTy, ctx.moveSpeed, ctx.dt);
            });
            behaviorRegistry.register('patrol_points', (enemy, ctx) => {
                const points = Array.isArray(enemy?.data?.patrolPoints) && enemy.data.patrolPoints.length > 0
                    ? enemy.data.patrolPoints
                    : [{ x: -420, y: -220 }, { x: 420, y: -220 }, { x: 420, y: 220 }, { x: -420, y: 220 }];
                const idx = enemy.behaviorState.stepIndex % points.length;
                const target = points[idx];
                const dx = (Number(target.x) || 0) - enemy.x;
                const dy = (Number(target.y) || 0) - enemy.y;
                if (Math.hypot(dx, dy) < 40) {
                    enemy.behaviorState.stepIndex = (enemy.behaviorState.stepIndex + 1) % points.length;
                }
                moveToward(enemy, Number(target.x) || 0, Number(target.y) || 0, ctx.moveSpeed, ctx.dt);
            });
            behaviorRegistry.register('move_to_points', (enemy, ctx) => {
                const points = Array.isArray(enemy?.data?.movePoints) ? enemy.data.movePoints : [];
                if (points.length === 0) return;
                const idx = Math.min(points.length - 1, enemy.behaviorState.stepIndex);
                const target = points[idx];
                moveToward(enemy, Number(target.x) || 0, Number(target.y) || 0, ctx.moveSpeed, ctx.dt);
                if (Math.hypot((Number(target.x) || 0) - enemy.x, (Number(target.y) || 0) - enemy.y) < 34 && idx < points.length - 1) {
                    enemy.behaviorState.stepIndex += 1;
                }
            });
            behaviorRegistry.register('flee_when_low_hp', (enemy, ctx) => {
                const ratio = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) : 0;
                if (ratio > 0.45) return moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.7, ctx.dt);
                const dx = enemy.x - ctx.player.worldPos.x;
                const dy = enemy.y - ctx.player.worldPos.y;
                const len = Math.hypot(dx, dy) || 1;
                enemy.x += (dx / len) * ctx.moveSpeed * 1.3 * ctx.dt;
                enemy.y += (dy / len) * ctx.moveSpeed * 1.3 * ctx.dt;
            });
            behaviorRegistry.register('guard_zone', (enemy, ctx) => {
                const zone = enemy?.data?.guardZone || { x: 0, y: 0, radius: 240 };
                const zx = Number(zone.x) || 0;
                const zy = Number(zone.y) || 0;
                const zr = Math.max(30, Number(zone.radius) || 240);
                const dz = Math.hypot(enemy.x - zx, enemy.y - zy);
                if (dz > zr) {
                    moveToward(enemy, zx, zy, ctx.moveSpeed * 1.15, ctx.dt);
                } else {
                    const dx = ctx.player.worldPos.x - enemy.x;
                    const dy = ctx.player.worldPos.y - enemy.y;
                    const len = Math.hypot(dx, dy) || 1;
                    enemy.x += (-dy / len) * ctx.moveSpeed * 0.55 * ctx.dt;
                    enemy.y += (dx / len) * ctx.moveSpeed * 0.55 * ctx.dt;
                }
            });
            behaviorRegistry.register('escort_target', (enemy, ctx) => {
                const target = findById(enemy?.data?.escortTargetId) || null;
                if (!target) return moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.8, ctx.dt);
                moveToward(enemy, target.x + 85, target.y + 30, ctx.moveSpeed, ctx.dt);
            });
            behaviorRegistry.register('protect_boss', (enemy, ctx) => {
                const boss = getAliveEnemies().find((item) => item?.data?.isBoss === true);
                if (!boss) return moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed, ctx.dt);
                moveToward(enemy, boss.x + 120, boss.y + 60, ctx.moveSpeed, ctx.dt);
            });
            behaviorRegistry.register('avoid_player', (enemy, ctx) => {
                const dx = enemy.x - ctx.player.worldPos.x;
                const dy = enemy.y - ctx.player.worldPos.y;
                const len = Math.hypot(dx, dy) || 1;
                enemy.x += (dx / len) * ctx.moveSpeed * ctx.dt;
                enemy.y += (dy / len) * ctx.moveSpeed * ctx.dt;
            });
            behaviorRegistry.register('avoid_bullets', (enemy, ctx) => {
                let awayX = 0;
                let awayY = 0;
                entities.forEachBullet((b) => {
                    if (!b || String(b.team || '') !== 'player') return;
                    const dx = enemy.x - Number(b.x || 0);
                    const dy = enemy.y - Number(b.y || 0);
                    const dist = Math.hypot(dx, dy);
                    if (dist <= 0 || dist > 240) return;
                    awayX += dx / dist;
                    awayY += dy / dist;
                });
                if (Math.hypot(awayX, awayY) < 0.001) {
                    return moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.7, ctx.dt);
                }
                const len = Math.hypot(awayX, awayY) || 1;
                enemy.x += (awayX / len) * ctx.moveSpeed * ctx.dt;
                enemy.y += (awayY / len) * ctx.moveSpeed * ctx.dt;
            });
            behaviorRegistry.register('mirror_player', (enemy, ctx) => {
                enemy.x += ((-ctx.player.worldPos.x) - enemy.x) * 0.08;
                enemy.y += ((-ctx.player.worldPos.y) - enemy.y) * 0.08;
            });
            behaviorRegistry.register('burrow_and_reappear', (enemy, ctx) => {
                const state = enemy.behaviorState;
                state.burrowCooldownMs = Math.max(0, Number(state.burrowCooldownMs) - ctx.deltaMs);
                if (!state.burrowed && state.burrowCooldownMs <= 0) {
                    state.burrowed = true;
                    state.burrowCooldownMs = 1100;
                    enemy.sprite.alpha = 0.2;
                    return;
                }
                if (state.burrowed && state.burrowCooldownMs <= 350) {
                    const around = 140 + (ctx.random() * 220);
                    const a = ctx.random() * Math.PI * 2;
                    enemy.x = ctx.player.worldPos.x + Math.cos(a) * around;
                    enemy.y = ctx.player.worldPos.y + Math.sin(a) * around;
                    state.burrowed = false;
                    state.burrowCooldownMs = 1800;
                    enemy.sprite.alpha = 1;
                }
                if (!state.burrowed) moveToward(enemy, ctx.player.worldPos.x, ctx.player.worldPos.y, ctx.moveSpeed * 0.8, ctx.dt);
            });
            behaviorRegistry.register('boss_anchor', (enemy, ctx) => {
                const preferred = 300;
                const dx = ctx.player.worldPos.x - enemy.x;
                const dy = ctx.player.worldPos.y - enemy.y;
                const len = Math.hypot(dx, dy) || 1;
                if (len > preferred + 90) {
                    enemy.x += (dx / len) * ctx.moveSpeed * ctx.dt;
                    enemy.y += (dy / len) * ctx.moveSpeed * ctx.dt;
                } else if (len < preferred - 70) {
                    enemy.x -= (dx / len) * ctx.moveSpeed * ctx.dt;
                    enemy.y -= (dy / len) * ctx.moveSpeed * ctx.dt;
                }
                enemy.x += (-dy / len) * ctx.moveSpeed * 0.42 * ctx.dt;
                enemy.y += (dx / len) * ctx.moveSpeed * 0.42 * ctx.dt;
            });
            behaviorRegistry.register('sniper', behaviorRegistry.get('keep_distance'));
            behaviorRegistry.register('orbiter', behaviorRegistry.get('orbit_player'));
            behaviorRegistry.register('summoner', behaviorRegistry.get('guard_zone'));
            behaviorRegistry.register('healer', behaviorRegistry.get('avoid_player'));
            behaviorRegistry.register('shielder', behaviorRegistry.get('protect_boss'));
            behaviorRegistry.register('mine_layer', behaviorRegistry.get('wander'));
            behaviorRegistry.register('leasher', behaviorRegistry.get('strafe_player'));
            behaviorRegistry.register('zone_keeper', behaviorRegistry.get('guard_zone'));
            behaviorRegistry.register('charger', behaviorRegistry.get('charge_telegraphed'));
            behaviorRegistry.register('bruiser', behaviorRegistry.get('chase_player'));
            behaviorRegistry.register('sentry', behaviorRegistry.get('stationary_turret'));
            behaviorRegistry.register('scout', behaviorRegistry.get('chase_player'));
            behaviorRegistry.register('elite', behaviorRegistry.get('keep_distance'));
            behaviorRegistry.register('splitter', behaviorRegistry.get('chase_player'));
            behaviorRegistry.register('bomber', behaviorRegistry.get('dash_through_player'));
            behaviorRegistry.register('stationary', behaviorRegistry.get('stationary_turret'));
        }

        registerBehaviors();

        function update(deltaMs) {
            const dt = deltaMs / 16.6667;
            const player = playerStateProvider?.();
            if (!player || player.dead) return;

            for (let i = active.length - 1; i >= 0; i -= 1) {
                const enemy = active[i];
                if (!enemy || !enemy.alive || enemy.hp <= 0) continue;
                const speed = Number(enemy?.data?.moveSpeed) || 1.2;
                if (Number(enemy?.data?.regenPerSecond) > 0) {
                    enemy.hp = Math.min(enemy.maxHp, enemy.hp + ((Number(enemy.data.regenPerSecond) * deltaMs) / 1000));
                }
                const context = {
                    enemy,
                    player,
                    entities,
                    random: rand,
                    moveSpeed: speed,
                    dt,
                    deltaMs
                };
                const behaviorId = normalizeType(enemy?.data?.behavior, 'chase_player');
                const handler = behaviorRegistry?.get?.(behaviorId) || behaviorRegistry?.get?.('chase_player');
                if (!behaviorRegistry?.has?.(behaviorId)) {
                    emitEvent('enemy_behavior_fallback', { enemyId: enemy.id, enemyTypeId: enemy?.data?.enemyTypeId || null, behavior: behaviorId });
                }
                handler?.(enemy, context);
                const arenaPolicy = clampEnemy(enemy);
                if (arenaPolicy?.outside && String(arenaPolicy?.bounds || '') === 'damage') {
                    const edgeDps = Math.max(0.5, Number(arenaPolicy?.effects?.edgeDamagePerSecond) || 2.8);
                    const edgeDamage = edgeDps * (Math.max(0, Number(deltaMs) || 0) / 1000);
                    if (edgeDamage > 0) applyDamage(enemy, edgeDamage);
                }

                const iso = toIsometric(enemy.x, enemy.y);
                enemy.sprite.x = iso.x;
                enemy.sprite.y = iso.y;
                enemy.sprite.scale.set(iso.scale * 1.15);
                if (enemy.shield > 0) enemy.sprite.tint = 0x9fc8ff;
                else enemy.sprite.tint = 0xffffff;

                enemy.attackMs += deltaMs;
                enemy.behaviorState.elapsedMs += deltaMs;
                updateBossPhase(enemy, { elapsedMs: enemy.behaviorState.elapsedMs, player, deltaMs });
                runSupportHooks(enemy, { deltaMs, elapsedMs: enemy.behaviorState.elapsedMs, player });
                const attack = selectAttack(enemy, { elapsedMs: enemy.behaviorState.elapsedMs, player, deltaMs });
                if (attack) fireAttack(enemy, attack, { elapsedMs: enemy.behaviorState.elapsedMs, player, deltaMs });
            }
        }

        function spawnDeathEffects(enemy) {
            if (!enemy) return;
            const data = enemy.data || {};
            if (data.explodeOnDeath === true) {
                emitPattern?.(enemy, { pattern: String(data.attackPatternId || 'enemy_spiral_pressure') });
            }
            if (data.onDeathSpawn && typeof data.onDeathSpawn === 'object') {
                const type = String(data.onDeathSpawn.enemyType || 'scout');
                const count = Math.max(1, Number(data.onDeathSpawn.count) || 1);
                for (let i = 0; i < count; i += 1) {
                    if (!canSpawnByBudget(1)) break;
                    spawnEnemy(type, { x: enemy.x + ((rand() - 0.5) * 80), y: enemy.y + ((rand() - 0.5) * 80) });
                }
            }
        }

        function applyDamage(enemy, damage) {
            if (!enemy || !enemy.alive) return false;
            const amount = Math.max(0, Number(damage) || 0);
            if (amount <= 0) return false;
            if (enemy?.data?.isBoss === true && enemy?.data?.damageLocked === true) {
                return {
                    defeated: false,
                    enemyTypeId: enemy?.data?.enemyTypeId || null,
                    enemyId: enemy.id,
                    enemy,
                    isBoss: true,
                    events: [{ type: 'boss_damage_blocked', enemyId: enemy.id }]
                };
            }
            if (Number(enemy.shield) > 0) {
                const absorbed = Math.min(Number(enemy.shield), amount);
                enemy.shield = Math.max(0, Number(enemy.shield) - absorbed);
                if (absorbed >= amount) {
                    return {
                        defeated: false,
                        enemyTypeId: enemy?.data?.enemyTypeId || null,
                        enemyId: enemy.id,
                        enemy,
                        isBoss: enemy?.data?.isBoss === true,
                        events: [{ type: 'shield_absorb', enemyId: enemy.id, absorbed }]
                    };
                }
                enemy.hp = Math.max(0, enemy.hp - (amount - absorbed));
            } else {
                enemy.hp = Math.max(0, enemy.hp - amount);
            }

            const events = [];
            if (enemy.data?.isBoss && Number(enemy.maxHp) > 0) {
                const ratio = enemy.hp / enemy.maxHp;
                const thresholds = Array.isArray(enemy.data.phaseThresholds) ? enemy.data.phaseThresholds : [];
                for (let i = 0; i < thresholds.length; i += 1) {
                    const threshold = Number(thresholds[i]);
                    if (!Number.isFinite(threshold)) continue;
                    if (enemy.data.triggeredThresholds.includes(threshold)) continue;
                    if (ratio <= threshold) {
                        enemy.data.triggeredThresholds.push(threshold);
                        enemy.data.bossPhaseIndex += 1;
                        events.push({
                            type: 'boss_phase_threshold',
                            enemyId: enemy.id,
                            enemyTypeId: enemy?.data?.enemyTypeId || null,
                            threshold,
                            bossPhaseIndex: enemy.data.bossPhaseIndex
                        });
                    }
                }
            }

            if (enemy.hp <= 0) {
                enemy.alive = false;
                enemy.sprite?.parent?.removeChild(enemy.sprite);
                entities.removeEntityById(enemy.id);
                spawnDeathEffects(enemy);
                return {
                    defeated: true,
                    enemyTypeId: enemy?.data?.enemyTypeId || null,
                    enemyId: enemy.id,
                    enemy,
                    isBoss: enemy?.data?.isBoss === true,
                    events
                };
            }
            return {
                defeated: false,
                enemyTypeId: enemy?.data?.enemyTypeId || null,
                enemyId: enemy.id,
                enemy,
                isBoss: enemy?.data?.isBoss === true,
                events
            };
        }

        function lockBossDamage(action = {}) {
            const targetId = String(action?.bossId || action?.enemyId || '').trim();
            const list = getAliveEnemies().filter((enemy) => enemy?.data?.isBoss === true);
            for (const enemy of list) {
                if (targetId && String(enemy?.data?.bossId || '') !== targetId && String(enemy?.id || '') !== targetId) continue;
                enemy.data.damageLocked = true;
            }
        }

        function unlockBossDamage(action = {}) {
            const targetId = String(action?.bossId || action?.enemyId || '').trim();
            const list = getAliveEnemies().filter((enemy) => enemy?.data?.isBoss === true);
            for (const enemy of list) {
                if (targetId && String(enemy?.data?.bossId || '') !== targetId && String(enemy?.id || '') !== targetId) continue;
                enemy.data.damageLocked = false;
            }
        }

        function getPrimaryBossState() {
            const boss = getAliveEnemies().find((enemy) => enemy?.data?.isBoss === true) || null;
            if (!boss) return null;
            const hpRatio = boss.maxHp > 0 ? (Number(boss.hp) / Number(boss.maxHp)) : 0;
            const shieldMax = Math.max(0, Number(boss.maxShield) || 0);
            const shieldValue = Math.max(0, Number(boss.shield) || 0);
            const shieldRatio = shieldMax > 0 ? (shieldValue / shieldMax) : 0;
            const bossMeta = boss.behaviorState?.boss || {};
            const phases = Array.isArray(boss?.data?.bossPhases) ? boss.data.bossPhases : [];
            return {
                enemyId: boss.id,
                enemyTypeId: boss?.data?.enemyTypeId || null,
                bossId: boss?.data?.bossId || null,
                displayName: boss?.data?.bossDisplayName || boss?.data?.enemyTypeId || 'Boss',
                subtitle: boss?.data?.bossSubtitle || '',
                alive: true,
                hpRatio: clamp(hpRatio, 0, 1),
                shieldRatio: clamp(shieldRatio, 0, 1),
                shieldValue,
                shieldMax,
                phaseIndex: Math.max(0, Number(bossMeta.activePhaseIndex) || 0),
                phaseId: String(bossMeta.activePhaseId || ''),
                phaseCount: phases.length,
                currentAttackLabel: String(bossMeta.currentAttackLabel || ''),
                damageLocked: boss?.data?.damageLocked === true
            };
        }

        function consumeBossActions() {
            if (pendingBossActions.length === 0) return [];
            const out = pendingBossActions.splice(0, pendingBossActions.length);
            return out;
        }

        function dispose() {
            for (const enemy of active) {
                try { enemy.sprite?.parent?.removeChild(enemy.sprite); } catch (_) {}
            }
            active.splice(0, active.length);
        }

        return {
            spawnByFormation,
            spawnFromAction,
            update,
            applyDamage,
            lockBossDamage,
            unlockBossDamage,
            consumeBossActions,
            getPrimaryBossState,
            getAliveEnemies,
            dispose
        };
    }

    window.TDSEnemyRuntime = {
        create: createEnemyRuntime
    };
})();
