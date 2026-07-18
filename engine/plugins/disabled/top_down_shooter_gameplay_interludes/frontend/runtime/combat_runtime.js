(() => {
    const PHASES = Object.freeze({
        MENU: 'menu',
        LOADING: 'loading',
        PAUSED: 'paused',
        PLAYING: 'playing',
        WON: 'won',
        LOST: 'lost',
        DISPOSED: 'disposed'
    });

    const DEFAULT_CONFIG = {
        ISOMETRIC_ANGLE: Math.PI / 6,
        PLAYER_SPEED: 4.5,
        PLAYER_HP: 6,
        PLAYER_HIT_IFRAME_MS: 800,
        DASH_COOLDOWN_MS: 1100,
        DASH_DURATION_MS: 180,
        DASH_IFRAME_MS: 220,
        DASH_SPEED_MULTIPLIER: 3.1,
        AUTO_ATTACK_INTERVAL_MS: 180,
        PLAYER_PROJECTILE_SPEED: 9,
        COLORS: {
            GRID: 0x1a0a2e,
            PLAYER: 0x00f2ff,
            BULLET_PRIMARY: 0xff00cc
        }
    };
    const DEFAULT_ENCOUNTER_ID = 'tds_glass_ambush_v1';

    function createCombatRuntime({ bridge, config = DEFAULT_CONFIG, payload = null }) {
        const PIXI = window.PIXI;
        if (!PIXI) return {
            async start() {},
            stop() {},
            pause() { return false; },
            resume() { return false; },
            retry() {},
            dispose() {},
            onStateChange() {},
            getState() { return { phase: PHASES.DISPOSED }; }
        };

        const input = window.TDSInputController?.create?.();
        const entities = window.TDSEntityManager?.create?.();
        const pixi = bridge?.pixi || null;
        if (!pixi || !input || !entities) return {
            async start() {},
            stop() {},
            pause() { return false; },
            resume() { return false; },
            retry() {},
            dispose() {},
            onStateChange() {},
            getState() { return { phase: PHASES.DISPOSED }; }
        };

        let phase = PHASES.MENU;
        let encounter = null;
        let encounterSource = 'default';
        let requestedEncounterId = null;
        let selectedEncounterId = DEFAULT_ENCOUNTER_ID;
        let encounterLoadWarning = '';
        let encounterLoadDiagnostics = null;
        let encounterPhaseId = 'opening';
        let encounterElapsedMs = 0;
        let objectiveText = '';
        let bannerText = '';
        let defeatedEnemies = 0;
        let defeatedByType = {};
        let bossState = null;
        let schemaVersion = 1;
        let validationWarnings = [];
        let validationErrors = [];
        let objectiveStates = {};
        let objectiveOrder = [];
        let explicitWinRequested = false;
        let activeSeed = '';
        let rngInitialSeed = 0;
        let randomFloat = Math.random;
        const eventLog = [];
        const budgetWarnings = [];
        const eventBus = window.TDSEventBus?.create?.({ maxEvents: 120 }) || {
            emit() {},
            on() { return () => {}; },
            off() { return false; },
            recent() { return []; },
            clear() {}
        };
        let stateListener = null;
        let worldContainer = null;
        let dustLayer = null;
        let gameLayer = null;
        let telegraphLayer = null;
        let bloomLayer = null;
        let playerRuntime = null;
        let tickOff = null;
        let shakePower = 0;
        let enemyRuntime = null;
        let sequenceRunner = null;
        let audioController = null;
        const patternIntervals = [];
        const delayedPatternSpawns = [];
        const activeTelegraphs = [];
        const activeEmitters = [];
        const destroyedObjects = {};
        const objectSnapshots = {};
        const zoneState = {};
        const recentHazardEvents = [];
        const playerRecentEvents = [];
        const statusRecentEvents = [];
        const pickupRecentEvents = [];
        const pickupCollectedCounts = {};
        const playerStatuses = {};
        const enemyStatusById = {};
        const objectStatusById = {};
        const pendingObjectActions = [];
        const activeArenaModifiers = [];
        const arenaRecentEvents = [];
        const feedbackRecentEvents = [];
        const damageNumberSprites = [];
        const feedbackCounters = {
            hitFlash: 0,
            deathBurst: 0,
            bulletClearShockwave: 0,
            dashStreak: 0,
            abilityReadyPulse: 0,
            bossPhaseBurst: 0
        };
        let microHitStopMsRemaining = 0;
        let abilityReadyLastState = { q: false, e: false, r: false };
        let lastBossPhaseId = '';
        const enemySpawnGateState = {
            blocked: false,
            untilMs: 0
        };
        const arenaBoundaryState = {
            playerOutside: false,
            playerNextDamageMs: 0
        };
        const camera = { x: 0, y: 0 };
        const actionCounter = {
            secondKey: 0,
            count: 0
        };
        let resultStats = createEmptyResultStats();

        function createEmptyResultStats() {
            return {
                startedAtMs: Date.now(),
                retries: 0,
                deaths: 0,
                bossesDefeated: [],
                notableEvents: [],
                objectiveSnapshot: [],
                finalized: false,
                finalPhase: null,
                finalizedAtEncounterMs: 0
            };
        }

        function addNotableEvent(tag) {
            const value = String(tag || '').trim();
            if (!value) return;
            if (!Array.isArray(resultStats.notableEvents)) resultStats.notableEvents = [];
            if (!resultStats.notableEvents.includes(value)) resultStats.notableEvents.push(value);
        }

        function addBossDefeat(tag) {
            const value = String(tag || '').trim();
            if (!value) return;
            if (!Array.isArray(resultStats.bossesDefeated)) resultStats.bossesDefeated = [];
            if (!resultStats.bossesDefeated.includes(value)) resultStats.bossesDefeated.push(value);
        }

        function updateResultStatsForEvent(type, payload = {}) {
            const eventType = String(type || '').toLowerCase();
            if (!eventType) return;
            if (eventType === 'boss_phase_started') {
                const phaseId = String(payload?.phaseId || '');
                if (phaseId) addNotableEvent('boss_phase_' + phaseId + '_seen');
                return;
            }
            if (eventType === 'boss_phase_threshold') {
                const idx = Number(payload?.bossPhaseIndex);
                if (Number.isFinite(idx)) addNotableEvent('boss_phase_' + idx + '_seen');
                return;
            }
            if (eventType === 'player_damaged') {
                const hp = Number(payload?.hpRemaining);
                if (Number.isFinite(hp) && hp <= 1) addNotableEvent('player_hp_critical');
                return;
            }
            if (eventType === 'objective_completed') {
                const objectiveId = String(payload?.objectiveId || '');
                if (objectiveId) addNotableEvent('objective_' + objectiveId + '_completed');
                return;
            }
            if (eventType === 'objective_failed') {
                const objectiveId = String(payload?.objectiveId || '');
                if (objectiveId) addNotableEvent('objective_' + objectiveId + '_failed');
                return;
            }
            if (eventType === 'object_destroyed') {
                const objectId = String(payload?.objectId || '');
                if (objectId) addNotableEvent('object_' + objectId + '_destroyed');
                return;
            }
            if (eventType === 'enemy_defeated' && payload?.isBoss === true) {
                addBossDefeat(String(payload?.bossId || payload?.enemyTypeId || payload?.enemyId || 'boss'));
                addNotableEvent('boss_defeated');
            }
        }

        function finalizeResultStats(nextPhase) {
            if (resultStats.finalized) return;
            resultStats.finalized = true;
            resultStats.finalPhase = String(nextPhase || phase || '');
            resultStats.finalizedAtEncounterMs = encounterElapsedMs;
            resultStats.objectiveSnapshot = sortedObjectivesSnapshot();
            if (resultStats.finalPhase === PHASES.LOST) addNotableEvent('player_defeated');
            if (resultStats.finalPhase === PHASES.WON) addNotableEvent('encounter_victory');
        }

        function resetResultStats() {
            resultStats = createEmptyResultStats();
        }

        function nowSecondKey() {
            return Math.floor(Date.now() / 1000);
        }

        function getBudgets() {
            const fromEncounter = encounter?.budgets || {};
            return {
                maxEnemiesAlive: Number(fromEncounter.maxEnemiesAlive) || 24,
                maxEnemyBulletsAlive: Number(fromEncounter.maxEnemyBulletsAlive) || 420,
                maxPlayerBulletsAlive: Number(fromEncounter.maxPlayerBulletsAlive) || 120,
                maxEmittersAlive: Number(fromEncounter.maxEmittersAlive) || 32,
                maxHazardsAlive: Number(fromEncounter.maxHazardsAlive) || 80,
                maxPickupsAlive: Number(fromEncounter.maxPickupsAlive) || 20,
                maxTelegraphsAlive: Number(fromEncounter.maxTelegraphsAlive) || 80,
                maxActionsPerSecond: Number(fromEncounter.maxActionsPerSecond) || 120,
                maxEncounterSeconds: Number(fromEncounter.maxEncounterSeconds) || 180
            };
        }

        function countByCollection(collectionName) {
            if (collectionName === 'telegraphs') return activeTelegraphs.length;
            if (collectionName === 'emitters') return activeEmitters.length;
            const store = encounter?.runtimeCollections;
            const arr = Array.isArray(store?.[collectionName]) ? store[collectionName] : null;
            return arr ? arr.length : 0;
        }

        function countBulletsByTeam(team) {
            let count = 0;
            entities.forEachBullet((bullet) => {
                if (String(bullet?.team || '') === String(team || '')) count += 1;
            });
            return count;
        }

        function pushBudgetWarning(message) {
            const text = String(message || '').trim();
            if (!text) return;
            budgetWarnings.push({ ts: Date.now(), message: text });
            if (budgetWarnings.length > 30) budgetWarnings.splice(0, budgetWarnings.length - 30);
            logEvent('budget_warning', { message: text });
        }

        function canRunAction() {
            const limit = getBudgets().maxActionsPerSecond;
            const secondKey = nowSecondKey();
            if (actionCounter.secondKey !== secondKey) {
                actionCounter.secondKey = secondKey;
                actionCounter.count = 0;
            }
            if (actionCounter.count >= limit) {
                pushBudgetWarning('Action budget exceeded for this second; skipping action.');
                return false;
            }
            actionCounter.count += 1;
            return true;
        }

        function setPhase(next, extra) {
            const previous = phase;
            phase = next;
            if (next === PHASES.LOST && previous !== PHASES.LOST) {
                resultStats.deaths = Math.max(0, Number(resultStats.deaths) || 0) + 1;
            }
            if ((next === PHASES.WON || next === PHASES.LOST) && previous !== next) {
                finalizeResultStats(next);
            }
            stateListener?.({ phase, ...(extra || {}) });
        }

        function setObjective(text) {
            objectiveText = String(text || '');
            stateListener?.({
                phase,
                objectiveText
            });
        }

        function setBanner(text) {
            bannerText = String(text || '');
            stateListener?.({
                phase,
                bannerText
            });
        }

        function objectiveById(id) {
            return objectiveStates[String(id || '').trim()] || null;
        }

        function sortedObjectivesSnapshot() {
            const entries = Object.values(objectiveStates || {});
            entries.sort((a, b) => {
                if (!!a.required !== !!b.required) return a.required ? -1 : 1;
                return objectiveOrder.indexOf(a.id) - objectiveOrder.indexOf(b.id);
            });
            return entries.map((item) => ({ ...item }));
        }

        function objectiveStatusLabel(item) {
            const status = String(item?.status || 'inactive');
            if (status === 'completed') return 'Completed';
            if (status === 'failed') return 'Failed';
            if (status === 'active') return 'Active';
            return 'Inactive';
        }

        function refreshObjectiveDisplay() {
            const items = sortedObjectivesSnapshot().filter((item) => String(item.visibility || 'visible') !== 'hidden');
            if (!items.length) return;
            const lines = items.map((item) => {
                const p = Math.max(0, Number(item.progress) || 0);
                const t = Math.max(0, Number(item.target) || 0);
                const ratioText = t > 0 ? (' (' + Math.min(t, Math.round(p)) + '/' + Math.round(t) + ')') : '';
                return objectiveStatusLabel(item) + ': ' + String(item.title || item.id) + ratioText;
            });
            objectiveText = lines[0] || objectiveText;
        }

        function setObjectiveState(id, patch) {
            const key = String(id || '').trim();
            if (!key || !objectiveStates[key]) return;
            const previousStatus = String(objectiveStates[key]?.status || '');
            objectiveStates[key] = {
                ...objectiveStates[key],
                ...(patch && typeof patch === 'object' ? patch : {})
            };
            const nextStatus = String(objectiveStates[key]?.status || '');
            if (nextStatus !== previousStatus) {
                if (nextStatus === 'completed') logEvent('objective_completed', { objectiveId: key });
                if (nextStatus === 'failed') logEvent('objective_failed', { objectiveId: key });
            }
            refreshObjectiveDisplay();
        }

        function initializeObjectives() {
            objectiveStates = {};
            objectiveOrder = [];
            const defs = Array.isArray(encounter?.objectives) ? encounter.objectives : [];
            for (const def of defs) {
                const id = String(def?.id || '').trim();
                if (!id) continue;
                objectiveOrder.push(id);
                objectiveStates[id] = {
                    id,
                    type: String(def?.type || 'survive_time').toLowerCase(),
                    title: String(def?.title || id),
                    target: Math.max(0, Number(def?.target) || 0),
                    required: def?.required !== false && def?.optional !== true,
                    optional: def?.optional === true || def?.required === false,
                    timeoutSeconds: Number.isFinite(Number(def?.timeoutSeconds)) ? Math.max(0, Number(def.timeoutSeconds)) : null,
                    visibility: String(def?.visibility || 'visible').toLowerCase(),
                    rewardTags: Array.isArray(def?.rewardTags) ? def.rewardTags : [],
                    enemyType: def?.enemyType ? String(def.enemyType) : null,
                    objectId: def?.objectId ? String(def.objectId) : null,
                    zoneId: def?.zoneId ? String(def.zoneId) : null,
                    status: 'active',
                    progress: 0,
                    startedAtMs: encounterElapsedMs,
                    completedAtMs: null,
                    failedAtMs: null,
                    lastEvent: null
                };
            }
            refreshObjectiveDisplay();
        }

        function updateObjectives(_playerState) {
            const objectives = Object.values(objectiveStates || {});
            if (!objectives.length) return { requiredFailed: false, requiredCompleted: false };
            const aliveBoss = bossState || null;
            for (const item of objectives) {
                if (!item || (item.status !== 'active' && item.status !== 'inactive')) continue;
                if (item.status === 'inactive') continue;
                if (Number.isFinite(item.timeoutSeconds) && item.timeoutSeconds > 0) {
                    const ageSec = Math.max(0, (encounterElapsedMs - Number(item.startedAtMs || 0)) / 1000);
                    if (ageSec >= item.timeoutSeconds && item.status !== 'completed') {
                        setObjectiveState(item.id, { status: 'failed', failedAtMs: encounterElapsedMs, lastEvent: 'timeout' });
                        continue;
                    }
                }
                if (item.type === 'survive_time') {
                    const target = Math.max(1, Number(item.target) || 1);
                    const elapsed = Math.max(0, encounterElapsedMs - Number(item.startedAtMs || 0)) / 1000;
                    const progress = Math.min(target, elapsed);
                    setObjectiveState(item.id, { progress, lastEvent: 'survive_tick' });
                    if (elapsed >= target) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'survive_complete' });
                } else if (item.type === 'defeat_count') {
                    const target = Math.max(1, Number(item.target) || 1);
                    const progress = Math.min(target, defeatedEnemies);
                    setObjectiveState(item.id, { progress, lastEvent: 'defeat_count_tick' });
                    if (defeatedEnemies >= target) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'defeat_count_complete' });
                } else if (item.type === 'defeat_enemy_type') {
                    const target = Math.max(1, Number(item.target) || 1);
                    const enemyTypeId = String(item.enemyType || '');
                    const current = enemyTypeId ? (Number(defeatedByType?.[enemyTypeId]) || 0) : 0;
                    const progress = Math.min(target, current);
                    setObjectiveState(item.id, { progress, lastEvent: 'defeat_enemy_type_tick' });
                    if (current >= target) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'defeat_enemy_type_complete' });
                } else if (item.type === 'defeat_boss') {
                    const defeated = aliveBoss && aliveBoss.alive === false;
                    setObjectiveState(item.id, { progress: defeated ? 1 : 0, target: 1, lastEvent: 'defeat_boss_tick' });
                    if (defeated) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'defeat_boss_complete' });
                } else if (item.type === 'protect_object') {
                    const objectId = String(item.objectId || '');
                    if (objectId && destroyedObjects[objectId] === true) {
                        setObjectiveState(item.id, { status: 'failed', failedAtMs: encounterElapsedMs, lastEvent: 'protect_object_failed' });
                    } else {
                        setObjectiveState(item.id, { progress: 1, target: 1, lastEvent: 'protect_object_tick' });
                    }
                } else if (item.type === 'reach_zone') {
                    const zoneId = String(item.zoneId || '');
                    const zone = zoneState[zoneId];
                    const reached = zone === 'entered' || zone === 'inside';
                    setObjectiveState(item.id, { progress: reached ? 1 : 0, target: 1, lastEvent: 'reach_zone_tick' });
                    if (reached) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'reach_zone_complete' });
                } else if (item.type === 'clear_hazards') {
                    const target = Math.max(0, Number(item.target) || 0);
                    const remaining = Math.max(0, countByCollection('hazards'));
                    const progress = Math.max(0, target - remaining);
                    setObjectiveState(item.id, { progress, target: Math.max(1, target), lastEvent: 'clear_hazards_tick' });
                    if (remaining <= target) setObjectiveState(item.id, { status: 'completed', completedAtMs: encounterElapsedMs, lastEvent: 'clear_hazards_complete' });
                }
            }
            const required = objectives.filter((item) => item.required !== false);
            const requiredFailed = required.some((item) => item.status === 'failed');
            const requiredCompleted = required.length > 0 && required.every((item) => item.status === 'completed');
            return { requiredFailed, requiredCompleted };
        }

        function logEvent(type, payload = {}) {
            const event = eventBus.emit(type, payload);
            eventLog.push(event || {
                ts: Date.now(),
                type: String(type || ''),
                payload: payload && typeof payload === 'object' ? payload : {}
            });
            if (eventLog.length > 30) eventLog.splice(0, eventLog.length - 30);
            updateResultStatsForEvent(type, payload);
        }

        function pushPlayerEvent(event) {
            if (!event || typeof event !== 'object') return;
            playerRecentEvents.push({
                type: String(event.type || ''),
                payload: (event.payload && typeof event.payload === 'object') ? event.payload : {},
                elapsedMs: Number(event.payload?.elapsedMs) || encounterElapsedMs
            });
            if (playerRecentEvents.length > 40) playerRecentEvents.splice(0, playerRecentEvents.length - 40);
            if (String(event.type || '') === 'player_dash_used') {
                const player = playerRuntime?.getState?.();
                if (player?.worldPos) {
                    spawnSimpleShockwave(player.worldPos.x, player.worldPos.y, 0x8de8ff, 18, 220);
                    feedbackCounters.dashStreak += 1;
                    emitFeedback('dash_streak', {});
                }
            }
        }

        function pushStatusEvent(type, payload = {}) {
            const item = {
                type: String(type || ''),
                elapsedMs: encounterElapsedMs,
                target: String(payload?.target || 'player'),
                statusId: String(payload?.statusId || ''),
                stacks: Number(payload?.stacks) || 0
            };
            statusRecentEvents.push(item);
            if (statusRecentEvents.length > 80) statusRecentEvents.splice(0, statusRecentEvents.length - 80);
            logEvent(String(type || 'status_event'), payload);
        }

        function pushPickupEvent(type, payload = {}) {
            const item = {
                type: String(type || ''),
                elapsedMs: encounterElapsedMs,
                pickupId: String(payload?.pickupId || ''),
                pickupType: String(payload?.pickupType || '')
            };
            pickupRecentEvents.push(item);
            if (pickupRecentEvents.length > 80) pickupRecentEvents.splice(0, pickupRecentEvents.length - 80);
            logEvent(String(type || 'pickup_event'), payload);
        }

        function getStatusContainer(targetType, targetId) {
            const target = String(targetType || 'player').toLowerCase();
            if (target === 'player') return playerStatuses;
            if (target === 'enemy') {
                const id = String(targetId || '').trim();
                if (!id) return null;
                if (!enemyStatusById[id]) enemyStatusById[id] = {};
                return enemyStatusById[id];
            }
            if (target === 'object') {
                const id = String(targetId || '').trim();
                if (!id) return null;
                if (!objectStatusById[id]) objectStatusById[id] = {};
                return objectStatusById[id];
            }
            return null;
        }

        function resolveStatusDefinition(statusId) {
            const key = String(statusId || '').trim();
            if (!key) return null;
            const map = encounter?.statusEffects || {};
            return map[key] || null;
        }

        function applyStatusToTarget({ statusId, targetType = 'player', targetId = null, stacks = 1, source = null }) {
            const def = resolveStatusDefinition(statusId);
            if (!def) {
                pushBudgetWarning('Unknown status "' + String(statusId || '') + '" in apply_status.');
                return false;
            }
            const container = getStatusContainer(targetType, targetId);
            if (!container) return false;
            const key = String(def.id || statusId);
            const nowMs = encounterElapsedMs;
            const current = container[key] || null;
            const maxStacks = Math.max(1, Number(def.maxStacks) || 1);
            const addStacks = Math.max(1, Number(stacks) || 1);
            const nextStacks = Math.min(maxStacks, (Number(current?.stacks) || 0) + addStacks);
            const effect = {
                id: key,
                targetType: String(targetType || 'player').toLowerCase(),
                targetId: targetId ? String(targetId) : null,
                category: String(def.category || 'debuff'),
                durationMs: Math.max(50, (Number(def.durationSeconds) || 1) * 1000),
                remainingMs: Math.max(50, (Number(def.durationSeconds) || 1) * 1000),
                tickIntervalMs: Math.max(50, (Number(def.tickIntervalSeconds) || 1) * 1000),
                nextTickMs: nowMs + Math.max(50, (Number(def.tickIntervalSeconds) || 1) * 1000),
                stacks: nextStacks,
                modifiers: Array.isArray(def.modifiers) ? def.modifiers : [],
                onApplyActions: Array.isArray(def.onApplyActions) ? def.onApplyActions : [],
                onExpireActions: Array.isArray(def.onExpireActions) ? def.onExpireActions : [],
                source: source ? String(source) : null
            };
            container[key] = effect;
            if (!current) {
                for (const action of effect.onApplyActions) pendingObjectActions.push(action);
            }
            pushStatusEvent('status_applied', { target: effect.targetType, targetId: effect.targetId, statusId: key, stacks: effect.stacks, source: effect.source });
            return true;
        }

        function removeStatusFromTarget({ statusId, targetType = 'player', targetId = null, expired = false }) {
            const container = getStatusContainer(targetType, targetId);
            if (!container) return false;
            const key = String(statusId || '').trim();
            if (!key || !container[key]) return false;
            const effect = container[key];
            delete container[key];
            if (expired) {
                for (const action of (Array.isArray(effect?.onExpireActions) ? effect.onExpireActions : [])) pendingObjectActions.push(action);
            }
            pushStatusEvent(expired ? 'status_expired' : 'status_removed', { target: String(targetType || 'player'), targetId: targetId ? String(targetId) : null, statusId: key, stacks: Number(effect?.stacks) || 0 });
            return true;
        }

        function clearStatusesOnTarget({ targetType = 'player', targetId = null }) {
            const container = getStatusContainer(targetType, targetId);
            if (!container) return;
            for (const key of Object.keys(container)) {
                removeStatusFromTarget({ statusId: key, targetType, targetId, expired: false });
            }
        }

        function getMapSize() {
            return Number(encounter?.arena?.mapSize) || 1500;
        }

        function pushArenaEvent(type, payload = {}) {
            const item = { type: String(type || ''), payload: payload && typeof payload === 'object' ? payload : {}, elapsedMs: encounterElapsedMs };
            arenaRecentEvents.push(item);
            if (arenaRecentEvents.length > 80) arenaRecentEvents.splice(0, arenaRecentEvents.length - 80);
            logEvent(item.type || 'arena_event', item.payload);
        }

        function arenaShape() {
            const base = String(encounter?.arena?.shape || 'diamond').toLowerCase();
            return ['rectangle', 'diamond', 'circle', 'ring', 'corridor', 'islands', 'cross'].includes(base) ? base : 'diamond';
        }

        function arenaBoundsMode() {
            const explicit = String(encounter?.arena?.bounds || 'soft').toLowerCase();
            if (explicit === 'damage' || explicit === 'wrap' || explicit === 'soft') return explicit;
            return 'soft';
        }

        function getArenaEffectsState() {
            const state = {
                sizeScale: 1,
                edgeDamagePerSecond: arenaBoundsMode() === 'damage' ? 2.8 : 0,
                wind: { x: 0, y: 0 },
                friction: 1,
                mud: false,
                bulletWrap: false,
                darkenedVisibility: 0,
                cameraZoom: 1,
                rotatingSafeWedge: null
            };
            for (const modifier of activeArenaModifiers) {
                if (!modifier || modifier.paused) continue;
                const type = String(modifier.type || '').toLowerCase();
                if (type === 'shrink_arena') state.sizeScale *= Math.max(0.2, Number(modifier.scale) || 0.8);
                else if (type === 'expand_arena') state.sizeScale *= Math.max(1, Number(modifier.scale) || 1.2);
                else if (type === 'damage_edge') state.edgeDamagePerSecond = Math.max(state.edgeDamagePerSecond, Math.max(0, Number(modifier.damagePerSecond) || 3.5));
                else if (type === 'periodic_wind') {
                    const strength = Number(modifier.strength) || 120;
                    const period = Math.max(0.1, Number(modifier.periodSeconds) || 2.5);
                    const t = (encounterElapsedMs / 1000) / period;
                    state.wind.x += Math.cos(t * Math.PI * 2) * strength;
                    state.wind.y += Math.sin(t * Math.PI * 2) * strength;
                } else if (type === 'low_friction_floor') state.friction = Math.min(state.friction, Math.max(0.4, Number(modifier.friction) || 0.7));
                else if (type === 'mud_slow_patches') state.mud = true;
                else if (type === 'bullet_wrap') state.bulletWrap = true;
                else if (type === 'darkened_visibility') state.darkenedVisibility = Math.max(state.darkenedVisibility, Math.max(0.1, Number(modifier.intensity) || 0.25));
                else if (type === 'camera_zoom_phase') state.cameraZoom = Math.max(0.6, Math.min(1.5, Number(modifier.zoom) || 1.1));
                else if (type === 'rotating_safe_wedge') {
                    const speed = Number(modifier.rotationSpeedDegreesPerSecond) || 42;
                    const halfAngleDeg = Math.max(6, Number(modifier.halfAngleDegrees) || 38);
                    const radius = Math.max(80, Number(modifier.radius) || (getMapSize() * 0.66));
                    const angle = ((Number(modifier.baseAngleDegrees) || 0) + ((encounterElapsedMs / 1000) * speed)) * (Math.PI / 180);
                    state.rotatingSafeWedge = { angle, halfAngle: halfAngleDeg * (Math.PI / 180), radius };
                }
            }
            return state;
        }

        function pointInsideArenaShape(x, y, shape, mapSizeEffective) {
            const nx = Number(x) || 0;
            const ny = Number(y) || 0;
            const s = Math.max(40, Number(mapSizeEffective) || getMapSize());
            if (shape === 'diamond') return Math.abs(nx) <= s && Math.abs(ny) <= s;
            if (shape === 'rectangle') return Math.abs(nx) <= s && Math.abs(ny) <= s * 0.72;
            if (shape === 'circle') return ((nx * nx) + (ny * ny)) <= (s * s);
            if (shape === 'ring') {
                const d2 = (nx * nx) + (ny * ny);
                const inner = s * 0.42;
                return d2 <= (s * s) && d2 >= (inner * inner);
            }
            if (shape === 'corridor') return Math.abs(nx) <= s && Math.abs(ny) <= s * 0.28;
            if (shape === 'cross') return (Math.abs(nx) <= s * 0.24 && Math.abs(ny) <= s) || (Math.abs(ny) <= s * 0.24 && Math.abs(nx) <= s);
            if (shape === 'islands') {
                const r = s * 0.34;
                const centers = [{ x: -s * 0.42, y: -s * 0.2 }, { x: s * 0.34, y: -s * 0.28 }, { x: -s * 0.08, y: s * 0.34 }, { x: s * 0.48, y: s * 0.22 }];
                for (const c of centers) {
                    const dx = nx - c.x;
                    const dy = ny - c.y;
                    if (((dx * dx) + (dy * dy)) <= (r * r)) return true;
                }
                return false;
            }
            // Default to the same screen-diamond projection used by the background grid.
            return Math.abs(nx) <= s && Math.abs(ny) <= s;
        }

        function clampPointToArena(x, y, shape, mapSizeEffective) {
            const nx = Number(x) || 0;
            const ny = Number(y) || 0;
            const s = Math.max(40, Number(mapSizeEffective) || getMapSize());
            if (shape === 'diamond') {
                return { x: Math.max(-s, Math.min(s, nx)), y: Math.max(-s, Math.min(s, ny)) };
            }
            if (shape === 'rectangle') {
                return { x: Math.max(-s, Math.min(s, nx)), y: Math.max(-(s * 0.72), Math.min(s * 0.72, ny)) };
            }
            if (shape === 'circle' || shape === 'ring') {
                const len = Math.hypot(nx, ny) || 1;
                const cap = Math.min(len, s);
                const out = { x: (nx / len) * cap, y: (ny / len) * cap };
                if (shape === 'ring') {
                    const inner = s * 0.42;
                    const len2 = Math.hypot(out.x, out.y) || 1;
                    if (len2 < inner) return { x: (out.x / len2) * inner, y: (out.y / len2) * inner };
                }
                return out;
            }
            if (shape === 'corridor') {
                return { x: Math.max(-s, Math.min(s, nx)), y: Math.max(-(s * 0.28), Math.min(s * 0.28, ny)) };
            }
            if (shape === 'cross') {
                const ax = Math.abs(nx);
                const ay = Math.abs(ny);
                if (ax > ay) return { x: Math.max(-s, Math.min(s, nx)), y: Math.max(-(s * 0.24), Math.min(s * 0.24, ny)) };
                return { x: Math.max(-(s * 0.24), Math.min(s * 0.24, nx)), y: Math.max(-s, Math.min(s, ny)) };
            }
            if (shape === 'islands') {
                const r = s * 0.34;
                const centers = [{ x: -s * 0.42, y: -s * 0.2 }, { x: s * 0.34, y: -s * 0.28 }, { x: -s * 0.08, y: s * 0.34 }, { x: s * 0.48, y: s * 0.22 }];
                let best = centers[0];
                let bestD = Infinity;
                for (const c of centers) {
                    const dx = nx - c.x; const dy = ny - c.y;
                    const d = (dx * dx) + (dy * dy);
                    if (d < bestD) { bestD = d; best = c; }
                }
                const dx = nx - best.x; const dy = ny - best.y;
                const len = Math.hypot(dx, dy) || 1;
                return { x: best.x + ((dx / len) * Math.min(len, r)), y: best.y + ((dy / len) * Math.min(len, r)) };
            }
            return { x: Math.max(-s, Math.min(s, nx)), y: Math.max(-s, Math.min(s, ny)) };
        }

        function wrapPointToArena(x, y, shape, mapSizeEffective) {
            const nx = Number(x) || 0;
            const ny = Number(y) || 0;
            const s = Math.max(40, Number(mapSizeEffective) || getMapSize());
            let outX = nx;
            let outY = ny;
            let wrapped = false;

            if (shape === 'diamond') {
                if (Math.abs(outX) > s) { outX = outX < 0 ? s : -s; wrapped = true; }
                if (Math.abs(outY) > s) { outY = outY < 0 ? s : -s; wrapped = true; }
                return { x: outX, y: outY, wrapped };
            }

            if (shape === 'rectangle') {
                if (Math.abs(outX) > s) { outX = outX < 0 ? s : -s; wrapped = true; }
                const yCap = s * 0.72;
                if (Math.abs(outY) > yCap) { outY = outY < 0 ? yCap : -yCap; wrapped = true; }
                return { x: outX, y: outY, wrapped };
            }

            if (shape === 'corridor') {
                if (Math.abs(outX) > s) { outX = outX < 0 ? s : -s; wrapped = true; }
                const yCap = s * 0.28;
                if (Math.abs(outY) > yCap) { outY = outY < 0 ? yCap : -yCap; wrapped = true; }
                return { x: outX, y: outY, wrapped };
            }
            if (Math.abs(outX) > s) { outX = outX < 0 ? s : -s; wrapped = true; }
            if (Math.abs(outY) > s) { outY = outY < 0 ? s : -s; wrapped = true; }
            return { x: outX, y: outY, wrapped };
        }

        function resolveArenaPolicySize(shape, baseSize, effectSize, radius) {
            const rawSize = Math.max(120, Number(effectSize) || Number(baseSize) || getMapSize());
            const visualCap = shape === 'diamond'
                ? Math.max(120, Number(baseSize) || getMapSize())
                : rawSize;
            const entityInset = Math.max(6, Math.min(32, (Number(radius) || 0) + 6));
            return Math.max(120, Math.min(rawSize, visualCap) - entityInset);
        }

        function applyPointPolicy({ x, y, entityType = 'player', entityId = null, radius = 10 }) {
            const effects = getArenaEffectsState();
            const shape = arenaShape();
            const baseSize = getMapSize();
            const rawEffectiveSize = Math.max(120, baseSize * Math.max(0.2, effects.sizeScale));
            const effectiveSize = resolveArenaPolicySize(shape, baseSize, rawEffectiveSize, radius);
            const bounds = arenaBoundsMode();
            const inside = pointInsideArenaShape(x, y, shape, effectiveSize);
            let outX = Number(x) || 0;
            let outY = Number(y) || 0;
            let wrapped = false;
            let outside = !inside;
            if (effects.rotatingSafeWedge) {
                const dx = outX;
                const dy = outY;
                const distance = Math.hypot(dx, dy);
                const theta = Math.atan2(dy, dx);
                const delta = Math.atan2(Math.sin(theta - effects.rotatingSafeWedge.angle), Math.cos(theta - effects.rotatingSafeWedge.angle));
                if (distance <= effects.rotatingSafeWedge.radius && Math.abs(delta) > effects.rotatingSafeWedge.halfAngle) {
                    outside = true;
                }
            }
            if (bounds === 'wrap') {
                const wrappedPoint = wrapPointToArena(outX, outY, shape, effectiveSize);
                outX = wrappedPoint.x;
                outY = wrappedPoint.y;
                wrapped = wrappedPoint.wrapped === true;
                if (wrapped) outside = false;
            } else if (bounds === 'soft') {
                if (!inside) {
                    const c = clampPointToArena(outX, outY, shape, effectiveSize);
                    outX = c.x; outY = c.y; outside = false;
                }
            }
            if (wrapped) {
                pushArenaEvent('arena_wrapped', { entityType: String(entityType || 'unknown'), entityId: entityId || null });
            }
            return {
                x: outX,
                y: outY,
                outside,
                inside: !outside,
                wrapped,
                effects,
                effectiveSize,
                rawEffectiveSize,
                shape,
                bounds,
                radius: Number(radius) || 10
            };
        }

        function addArenaModifier(spec, source = 'encounter') {
            const modifier = (spec && typeof spec === 'object') ? { ...spec } : null;
            if (!modifier) return false;
            const type = String(modifier.type || '').toLowerCase();
            if (!type) return false;
            modifier.id = String(modifier.id || (type + '_' + Date.now() + '_' + Math.floor(randomFloat() * 100000)));
            modifier.type = type;
            modifier.source = source;
            modifier.bornMs = encounterElapsedMs;
            modifier.durationMs = Number.isFinite(Number(modifier.durationSeconds)) ? Math.max(50, Number(modifier.durationSeconds) * 1000) : null;
            modifier.paused = false;
            activeArenaModifiers.push(modifier);
            pushArenaEvent('arena_modifier_applied', { modifierId: modifier.id, type: modifier.type, source });
            return true;
        }

        function removeArenaModifier(idOrType) {
            const token = String(idOrType || '').trim().toLowerCase();
            if (!token) return 0;
            let removed = 0;
            for (let i = activeArenaModifiers.length - 1; i >= 0; i -= 1) {
                const item = activeArenaModifiers[i];
                if (!item) continue;
                if (String(item.id || '').toLowerCase() !== token && String(item.type || '').toLowerCase() !== token) continue;
                activeArenaModifiers.splice(i, 1);
                removed += 1;
            }
            if (removed > 0) pushArenaEvent('arena_modifier_removed', { token, count: removed });
            return removed;
        }

        function clearArenaModifiers(reason = 'manual') {
            if (activeArenaModifiers.length === 0) return;
            activeArenaModifiers.splice(0, activeArenaModifiers.length);
            pushArenaEvent('arena_modifiers_cleared', { reason: String(reason || 'manual') });
        }

        function updateArenaModifiers(_deltaMs) {
            let spawnGateBlocked = false;
            for (let i = activeArenaModifiers.length - 1; i >= 0; i -= 1) {
                const item = activeArenaModifiers[i];
                if (!item) continue;
                if (String(item.type || '') === 'enemy_spawn_gates') {
                    const cycle = Math.max(0.2, Number(item.cycleSeconds) || 3.2);
                    const openSeconds = Math.max(0.05, Number(item.openSeconds) || 1.25);
                    const t = ((encounterElapsedMs - Number(item.bornMs || 0)) / 1000) % cycle;
                    if (t > openSeconds) spawnGateBlocked = true;
                }
                if (!Number.isFinite(Number(item.durationMs))) continue;
                if ((encounterElapsedMs - Number(item.bornMs || 0)) >= Number(item.durationMs)) {
                    activeArenaModifiers.splice(i, 1);
                    pushArenaEvent('arena_modifier_expired', { modifierId: item.id, type: item.type });
                }
            }
            enemySpawnGateState.blocked = spawnGateBlocked;
            const effects = getArenaEffectsState();
            if (effects.darkenedVisibility > 0) {
                dustLayer.alpha = Math.max(0.45, 1 - effects.darkenedVisibility);
            } else {
                dustLayer.alpha = 1;
            }
        }

        function initializeRng() {
            const factory = window.TDSRng?.createSeededRng;
            const requestedSeed = String(encounter?.seed || encounter?.id || 'tds_default_seed');
            activeSeed = requestedSeed;
            if (typeof factory === 'function') {
                const rng = factory(requestedSeed);
                randomFloat = () => rng.next();
                rngInitialSeed = Number(rng.getInitialSeed?.()) || 0;
            } else {
                randomFloat = Math.random;
                rngInitialSeed = 0;
            }
        }

        function toIso(x, y, z = 0) {
            const isoX = (x - y) * Math.cos(config.ISOMETRIC_ANGLE);
            const isoY = (x + y) * Math.sin(config.ISOMETRIC_ANGLE) - z;
            const perspective = 1 + (isoY / 3000) * 0.15;
            return { x: isoX * perspective, y: isoY * perspective, scale: perspective };
        }

        function toWorld(x, y, z = 0) {
            const ix = x / Math.cos(config.ISOMETRIC_ANGLE);
            const iy = (y + z) / Math.sin(config.ISOMETRIC_ANGLE);
            return { x: (ix + iy) * 0.5, y: (iy - ix) * 0.5 };
        }

        function getLogicalSize() {
            return pixi?.getLogicalSize?.() || { width: 1920, height: 1080 };
        }

        function clampByte(value) {
            return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
        }

        function colorToRgb(color) {
            const c = Number(color) || 0;
            return {
                r: (c >> 16) & 255,
                g: (c >> 8) & 255,
                b: c & 255
            };
        }

        function rgbToColor(r, g, b) {
            return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
        }

        function blendColor(fromColor, toColor, amount) {
            const t = Math.max(0, Math.min(1, Number(amount) || 0));
            const from = colorToRgb(fromColor);
            const to = colorToRgb(toColor);
            return rgbToColor(
                from.r + ((to.r - from.r) * t),
                from.g + ((to.g - from.g) * t),
                from.b + ((to.b - from.b) * t)
            );
        }

        function colorLuminance(color) {
            const { r, g, b } = colorToRgb(color);
            return ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255;
        }

        function resolveArenaBackgroundPalette() {
            const raw = Number(encounter?.arena?.backgroundColor);
            const baseColor = Number.isFinite(raw)
                ? (Math.max(0, Math.min(0xFFFFFF, Math.floor(raw))) & 0xFFFFFF)
                : 0x080d1f;
            const underlayColor = blendColor(baseColor, 0x000000, 0.12);
            const luminance = colorLuminance(underlayColor);
            if (luminance < 0.45) {
                return {
                    vignetteColor: blendColor(underlayColor, 0x000000, 0.58),
                    underlayColor,
                    glowAColor: blendColor(underlayColor, 0xffffff, 0.22),
                    glowAAlpha: 0.14,
                    glowBColor: blendColor(underlayColor, 0x000000, 0.28),
                    glowBAlpha: 0.13
                };
            }
            return {
                vignetteColor: blendColor(underlayColor, 0x000000, 0.74),
                underlayColor,
                glowAColor: blendColor(underlayColor, 0xffffff, 0.08),
                glowAAlpha: 0.1,
                glowBColor: blendColor(underlayColor, 0x000000, 0.22),
                glowBAlpha: 0.12
            };
        }

        function resolveAutoGridColors(baseUnderlayColor) {
            const luminance = colorLuminance(baseUnderlayColor);
            if (luminance < 0.45) {
                return {
                    gridColor: blendColor(baseUnderlayColor, 0xffffff, 0.68),
                    boundaryColor: blendColor(baseUnderlayColor, 0xffffff, 0.82)
                };
            }
            return {
                gridColor: blendColor(baseUnderlayColor, 0x000000, 0.68),
                boundaryColor: blendColor(baseUnderlayColor, 0x000000, 0.82)
            };
        }

        function getRuntimeSettings() {
            const settings = encounter?.runtimeSettings || {};
            return {
                showDamageNumbers: settings.showDamageNumbers === true,
                enableMicroHitStop: settings.enableMicroHitStop !== false
            };
        }

        function getRenderPresets() {
            return (encounter?.renderPresets && typeof encounter.renderPresets === 'object') ? encounter.renderPresets : {};
        }

        function resolveRenderPreset(group, key, fallback = null) {
            const presets = getRenderPresets();
            const section = (presets?.[group] && typeof presets[group] === 'object') ? presets[group] : {};
            const byKey = section?.[String(key || '')];
            const byDefault = section?.default;
            const base = (fallback && typeof fallback === 'object') ? fallback : {};
            return {
                ...base,
                ...(byDefault && typeof byDefault === 'object' ? byDefault : {}),
                ...(byKey && typeof byKey === 'object' ? byKey : {})
            };
        }

        function isEnemyColor(color) {
            const c = Number(color) || 0;
            const r = (c >> 16) & 255;
            const g = (c >> 8) & 255;
            const b = c & 255;
            return (r >= b && r >= g) || (r > 150 && b > 150);
        }

        function enforceReadabilityForBullet(team, render, fallbackColor) {
            const out = { ...(render || {}) };
            const playerDefault = Number(encounter?.colors?.player) || config.COLORS.PLAYER;
            const enemyDefault = Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY;
            let color = Number.isFinite(Number(out.color)) ? Number(out.color) : (Number(fallbackColor) || (team === 'player' ? playerDefault : enemyDefault));
            if (team === 'enemy' && !isEnemyColor(color)) color = enemyDefault;
            if (team === 'player' && isEnemyColor(color)) color = playerDefault;
            out.color = color;
            if (team === 'enemy' && (!out.preset || out.preset === 'needle')) out.preset = 'orb';
            if (team === 'player' && (!out.preset || out.preset === 'orb')) out.preset = 'needle';
            out.alpha = Math.max(0.22, Math.min(1, Number(out.alpha) || 1));
            out.scale = Math.max(0.35, Math.min(2.8, Number(out.scale) || 1));
            return out;
        }

        function emitFeedback(type, payload = {}) {
            feedbackRecentEvents.push({ type: String(type || ''), elapsedMs: encounterElapsedMs, payload: payload && typeof payload === 'object' ? payload : {} });
            if (feedbackRecentEvents.length > 100) feedbackRecentEvents.splice(0, feedbackRecentEvents.length - 100);
        }

        function spawnDamageNumber(x, y, text, color = 0xffd7d7) {
            if (!getRuntimeSettings().showDamageNumbers) return;
            if (!PIXI.Text) return;
            if (damageNumberSprites.length >= 60) return;
            const label = new PIXI.Text({
                text: String(text || ''),
                style: {
                    fontFamily: 'Cinzel, serif',
                    fontSize: 18,
                    fill: Number(color) || 0xffffff,
                    stroke: { color: 0x101423, width: 3 }
                }
            });
            const iso = toIso(Number(x) || 0, Number(y) || 0, 24);
            label.x = iso.x;
            label.y = iso.y;
            label.alpha = 0.95;
            telegraphLayer.addChild(label);
            damageNumberSprites.push({ sprite: label, bornMs: encounterElapsedMs, lifeMs: 650, vy: -0.04 });
        }

        function spawnSimpleShockwave(x, y, color = 0xffffff, radius = 28, lifeMs = 260) {
            const g = new PIXI.Graphics();
            g.circle(0, 0, Math.max(2, radius));
            g.stroke({ width: 3, color: Number(color) || 0xffffff, alpha: 0.88 });
            const iso = toIso(Number(x) || 0, Number(y) || 0, 0);
            g.x = iso.x;
            g.y = iso.y;
            bloomLayer.addChild(g);
            damageNumberSprites.push({ sprite: g, bornMs: encounterElapsedMs, lifeMs: Math.max(120, lifeMs), shockwave: true });
        }

        function createBackground() {
            const size = getLogicalSize();
            const palette = resolveArenaBackgroundPalette();
            const autoGrid = resolveAutoGridColors(palette.underlayColor);

            const vignette = new PIXI.Graphics();
            vignette.rect(0, 0, size.width, size.height);
            vignette.fill({ color: palette.vignetteColor, alpha: 1 });
            dustLayer.addChild(vignette);

            const glowA = new PIXI.Graphics();
            glowA.circle(size.width * 0.24, size.height * 0.18, Math.max(size.width, size.height) * 0.45);
            glowA.fill({ color: palette.glowAColor, alpha: Number(palette.glowAAlpha) || 0.16 });
            dustLayer.addChild(glowA);

            const glowB = new PIXI.Graphics();
            glowB.circle(size.width * 0.78, size.height * 0.72, Math.max(size.width, size.height) * 0.48);
            glowB.fill({ color: palette.glowBColor, alpha: Number(palette.glowBAlpha) || 0.15 });
            dustLayer.addChild(glowB);

            const g = new PIXI.Graphics();
            const mapSize = getMapSize();
            const gridSpacing = Number(encounter?.arena?.gridSpacing) || 100;
            const gridColor = Number(autoGrid.gridColor) || config.COLORS.GRID;
            const boundaryColor = Number(autoGrid.boundaryColor) || gridColor;
            const shape = arenaShape();

            // Opaque underlay in world-space so VN background never bleeds through
            // between projected grid lines or at camera offsets.
            const underlayScale = 2.4;
            const s = mapSize * underlayScale;
            const a = toIso(-s, -s);
            const b = toIso(s, -s);
            const c = toIso(s, s);
            const d = toIso(-s, s);
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.lineTo(c.x, c.y);
            g.lineTo(d.x, d.y);
            g.closePath();
            g.fill({ color: palette.underlayColor, alpha: 1 });

            for (let i = -mapSize; i <= mapSize; i += gridSpacing) {
                const p1 = toIso(i, -mapSize);
                const p2 = toIso(i, mapSize);
                g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y);
                const p3 = toIso(-mapSize, i);
                const p4 = toIso(mapSize, i);
                g.moveTo(p3.x, p3.y); g.lineTo(p4.x, p4.y);
            }
            g.stroke({ width: 1, color: gridColor, alpha: 0.5 });

            // The visible "diamond" arena is a square in world coordinates after isometric projection.
            if (shape === 'diamond') {
                const boundary = [
                    toIso(-mapSize, -mapSize),
                    toIso(mapSize, -mapSize),
                    toIso(mapSize, mapSize),
                    toIso(-mapSize, mapSize)
                ];
                g.moveTo(boundary[0].x, boundary[0].y);
                for (let i = 1; i < boundary.length; i += 1) g.lineTo(boundary[i].x, boundary[i].y);
                g.closePath();
                g.stroke({ width: 3, color: boundaryColor, alpha: 0.84 });
            }
            gameLayer.addChild(g);
        }

        function createDust() {
            const size = getLogicalSize();
            for (let i = 0; i < 90; i += 1) {
                const d = new PIXI.Graphics();
                d.circle(0, 0, (randomFloat() * 2) + 1);
                d.fill({ color: 0xffffff, alpha: randomFloat() * 0.2 });
                d.x = randomFloat() * size.width;
                d.y = randomFloat() * size.height;
                dustLayer.addChild(d);
            }
        }

        function spawnBullet(state) {
            const team = String(state?.team || 'enemy');
            const budgets = getBudgets();
            const limit = team === 'player' ? budgets.maxPlayerBulletsAlive : budgets.maxEnemyBulletsAlive;
            const current = countBulletsByTeam(team);
            if (current >= limit) {
                pushBudgetWarning('Bullet budget reached for team "' + team + '".');
                return false;
            }

            const fallbackTypeId = team === 'player' ? 'player_default_bullet' : 'enemy_default_bullet';
            const projectileType = resolveProjectileType(state?.projectileType, fallbackTypeId);
            const resolvedState = {
                ...state,
                team: String(state?.team || projectileType?.team || team),
                damage: Number.isFinite(Number(state?.damage)) ? Number(state.damage) : (Number(projectileType?.damage) || 1),
                radius: Number.isFinite(Number(state?.radius)) ? Number(state.radius) : (Number(projectileType?.radius) || 8),
                life: Number.isFinite(Number(state?.life)) ? Number(state.life) : (Number(projectileType?.lifeTicks) || 320),
                vz: Number.isFinite(Number(state?.vz)) ? Number(state.vz) : (Number(projectileType?.vz) || 0),
                color: Number.isFinite(Number(state?.color)) ? Number(state.color) : Number(projectileType?.color),
                collision: (state?.collision && typeof state.collision === 'object') ? state.collision : (projectileType?.collision || null),
                render: (state?.render && typeof state.render === 'object') ? state.render : (projectileType?.render || null)
            };
            const teamPresetKey = resolvedState.team === 'player' ? 'player_default' : 'enemy_default';
            const presetFromSchema = resolveRenderPreset(
                resolvedState.team === 'player' ? 'playerBullets' : 'enemyBullets',
                String(resolvedState?.render?.presetKey || teamPresetKey),
                {}
            );
            const rawRender = {
                ...(presetFromSchema || {}),
                ...((resolvedState?.render && typeof resolvedState.render === 'object') ? resolvedState.render : {})
            };
            const render = enforceReadabilityForBullet(String(resolvedState.team || team), rawRender, resolvedState?.color);
            const color = Number(render.color ?? resolvedState?.color) || 0xffffff;
            const alpha = Math.max(0.05, Math.min(1, Number(render.alpha) || 1));
            const radius = Math.max(2, Number(resolvedState?.radius) || 8);
            const scale = Math.max(0.2, Number(render.scale) || 1);
            const preset = String(render.preset || 'orb').toLowerCase();
            const s = new PIXI.Graphics();
            if (preset === 'needle') {
                s.moveTo(radius * 1.35, 0);
                s.lineTo(-radius * 0.9, -radius * 0.45);
                s.lineTo(-radius * 0.9, radius * 0.45);
                s.closePath();
                s.fill({ color, alpha });
            } else if (preset === 'diamond') {
                s.moveTo(0, -radius * 1.1);
                s.lineTo(radius * 0.9, 0);
                s.lineTo(0, radius * 1.1);
                s.lineTo(-radius * 0.9, 0);
                s.closePath();
                s.fill({ color, alpha });
            } else if (preset === 'ring') {
                s.circle(0, 0, radius * 1.05);
                s.stroke({ width: Math.max(1.2, radius * 0.35), color, alpha });
            } else if (preset === 'square') {
                s.rect(-radius, -radius, radius * 2, radius * 2);
                s.fill({ color, alpha });
            } else {
                s.circle(0, 0, radius);
                s.fill({ color, alpha });
            }
            if (render.glow !== false) {
                s.circle(0, 0, radius * 2.1);
                s.fill({ color, alpha: Math.min(0.35, alpha * 0.35) });
                s.blendMode = 'add';
            }
            s.scale.set(scale);
            bloomLayer.addChild(s);
            entities.spawnBullet(s, {
                ...resolvedState,
                color,
                render,
                modifiers: Array.isArray(resolvedState?.modifiers) ? resolvedState.modifiers : []
            });
            return true;
        }

        function resolveProjectileType(projectileTypeId, fallbackId = 'enemy_default_bullet') {
            return encounter?.projectileTypes?.[String(projectileTypeId || fallbackId)]
                || encounter?.projectileTypes?.[fallbackId]
                || null;
        }

        function resolvePointFromSpec(spec, fallback = { x: 0, y: 0 }) {
            const source = spec && typeof spec === 'object' ? spec : {};
            const type = String(source.type || '').toLowerCase();
            const mapSize = getMapSize();
            if (type === 'player') {
                const player = playerRuntime?.getState?.();
                if (player?.worldPos) return { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 };
            }
            if (type === 'arena_center') return { x: 0, y: 0 };
            if (type === 'arena_edge') {
                const edge = String(source.edge || 'top').toLowerCase();
                const t = Math.max(0, Math.min(1, Number(source.position) || randomFloat()));
                if (edge === 'left') return { x: -mapSize, y: ((t * 2) - 1) * mapSize };
                if (edge === 'right') return { x: mapSize, y: ((t * 2) - 1) * mapSize };
                if (edge === 'bottom') return { x: ((t * 2) - 1) * mapSize, y: mapSize };
                return { x: ((t * 2) - 1) * mapSize, y: -mapSize };
            }
            if (Number.isFinite(Number(source.x)) || Number.isFinite(Number(source.y))) {
                return { x: Number(source.x) || 0, y: Number(source.y) || 0 };
            }
            return { x: Number(fallback.x) || 0, y: Number(fallback.y) || 0 };
        }

        function styleColorForTelegraph(style) {
            const key = String(style || 'danger').toLowerCase();
            if (key === 'boss') return 0xff8c3a;
            if (key === 'friendly') return 0x40d4ff;
            if (key === 'objective') return 0xffd54a;
            if (key === 'healing') return 0x65ff9a;
            return 0xff4d68;
        }

        function clearTelegraphs() {
            for (let i = activeTelegraphs.length - 1; i >= 0; i -= 1) {
                const t = activeTelegraphs[i];
                if (t?.sprite?.parent) t.sprite.parent.removeChild(t.sprite);
            }
            activeTelegraphs.splice(0, activeTelegraphs.length);
        }

        function spawnTelegraph(action, onComplete = null) {
            const budgets = getBudgets();
            if (activeTelegraphs.length >= Math.max(0, Number(budgets.maxTelegraphsAlive) || 0)) {
                pushBudgetWarning('Telegraph budget reached; telegraph action skipped.');
                return false;
            }
            const shape = String(action?.shape || 'circle').toLowerCase();
            const durationSeconds = Math.max(0.08, Number(action?.durationSeconds) || 0.8);
            const style = String(action?.style || 'danger');
            const telegraphPreset = resolveRenderPreset('telegraphs', style, {});
            const at = resolvePointFromSpec(action?.at || action?.source, { x: 0, y: 0 });
            const radius = Math.max(8, Number(action?.radius) || 120);
            const width = Math.max(6, Number(action?.width) || 240);
            const length = Math.max(12, Number(action?.length) || 340);
            const angle = Number(action?.angle) || 0;
            const innerRadius = Math.max(0, Math.min(radius - 1, Number(action?.innerRadius) || (radius * 0.6)));
            const startAngle = Number(action?.startAngle) || (angle - 0.65);
            const endAngle = Number(action?.endAngle) || (angle + 0.65);
            const points = Array.isArray(action?.points) ? action.points : [];

            const sprite = new PIXI.Graphics();
            const color = Number.isFinite(Number(telegraphPreset?.color)) ? Number(telegraphPreset.color) : styleColorForTelegraph(style);
            const strokeAlpha = Math.max(0.35, Math.min(1, Number(telegraphPreset?.strokeAlpha) || 0.9));
            const lineWidth = Math.max(2, Number(telegraphPreset?.lineWidth) || 3);
            if (shape === 'line' || shape === 'beam_line') {
                sprite.rect(-length * 0.5, -width * 0.5, length, width);
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            } else if (shape === 'cone') {
                sprite.moveTo(0, 0);
                sprite.lineTo(Math.cos(angle - 0.45) * length, Math.sin(angle - 0.45) * length);
                sprite.lineTo(Math.cos(angle + 0.45) * length, Math.sin(angle + 0.45) * length);
                sprite.closePath();
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            } else if (shape === 'ring') {
                sprite.circle(0, 0, radius);
                sprite.circle(0, 0, innerRadius);
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            } else if (shape === 'rectangle') {
                sprite.rect(-width * 0.5, -length * 0.5, width, length);
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            } else if (shape === 'arc') {
                sprite.arc(0, 0, radius, startAngle, endAngle);
                sprite.stroke({ width: Math.max(lineWidth, Number(action?.strokeWidth) || lineWidth), color, alpha: strokeAlpha });
            } else if (shape === 'cross') {
                const arm = Math.max(6, Number(action?.armWidth) || Math.min(width, length) * 0.25);
                sprite.rect(-arm * 0.5, -length * 0.5, arm, length);
                sprite.rect(-width * 0.5, -arm * 0.5, width, arm);
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            } else if (shape === 'path') {
                if (points.length > 0) {
                    const first = points[0] || {};
                    sprite.moveTo(Number(first.x) || 0, Number(first.y) || 0);
                    for (let i = 1; i < points.length; i += 1) {
                        const p = points[i] || {};
                        sprite.lineTo(Number(p.x) || 0, Number(p.y) || 0);
                    }
                    sprite.stroke({ width: Math.max(2, Number(action?.strokeWidth) || 4), color, alpha: strokeAlpha });
                } else {
                    sprite.circle(0, 0, radius);
                    sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
                }
            } else if (shape === 'zone_outline') {
                sprite.rect(-width * 0.5, -length * 0.5, width, length);
                sprite.stroke({ width: Math.max(4, lineWidth + 1), color, alpha: Math.max(0.5, strokeAlpha) });
            } else {
                sprite.circle(0, 0, radius);
                sprite.stroke({ width: lineWidth, color, alpha: strokeAlpha });
            }
            const iso = toIso(at.x, at.y, 0);
            sprite.x = iso.x;
            sprite.y = iso.y;
            sprite.alpha = Math.max(0.2, Math.min(0.65, Number(telegraphPreset?.baseAlpha) || 0.25));
            telegraphLayer.addChild(sprite);
            activeTelegraphs.push({
                sprite,
                bornMs: encounterElapsedMs,
                durationMs: durationSeconds * 1000,
                onComplete: typeof onComplete === 'function' ? onComplete : null
            });
            return true;
        }

        function resolveEmitterSource(source) {
            const sourceSpec = source && typeof source === 'object' ? source : {};
            const sourceType = String(sourceSpec.type || 'fixed_point').toLowerCase();
            const mapSize = getMapSize();
            if (sourceType === 'arena_center') return { x: 0, y: 0 };
            if (sourceType === 'arena_edge') {
                const edge = String(sourceSpec.edge || 'top').toLowerCase();
                const t = Math.max(0, Math.min(1, Number(sourceSpec.position) || randomFloat()));
                if (edge === 'left') return { x: -mapSize, y: ((t * 2) - 1) * mapSize };
                if (edge === 'right') return { x: mapSize, y: ((t * 2) - 1) * mapSize };
                if (edge === 'bottom') return { x: ((t * 2) - 1) * mapSize, y: mapSize };
                return { x: ((t * 2) - 1) * mapSize, y: -mapSize };
            }
            return { x: Number(sourceSpec.x) || 0, y: Number(sourceSpec.y) || 0 };
        }

        function resolveHazardDefinition(action) {
            const hazardRef = action?.hazard;
            if (typeof hazardRef === 'string' && encounter?.hazards?.[hazardRef]) {
                return {
                    ...encounter.hazards[hazardRef],
                    hazardId: String(action?.hazardId || hazardRef)
                };
            }
            if (typeof hazardRef === 'string' && !encounter?.hazards?.[hazardRef]) {
                pushBudgetWarning('Unknown hazard id "' + hazardRef + '" in spawn_hazard action.');
                return null;
            }
            if (hazardRef && typeof hazardRef === 'object') {
                return {
                    ...hazardRef,
                    hazardId: String(action?.hazardId || hazardRef?.hazardId || ('hazard_' + Date.now()))
                };
            }
            return {
                type: String(action?.hazardType || action?.type || 'damage_circle'),
                shape: String(action?.shape || 'circle'),
                radius: Number(action?.radius) || 90,
                width: Number(action?.width) || 160,
                length: Number(action?.length) || 160,
                durationSeconds: Number(action?.durationSeconds) || 3,
                tickIntervalSeconds: Number(action?.tickIntervalSeconds) || Number(action?.damageIntervalSeconds) || 0.4,
                damage: Number(action?.damage) || 1,
                force: Number(action?.force) || 0,
                growthPerSecond: Number(action?.growthPerSecond) || 0,
                affectTeams: Array.isArray(action?.affectTeams) ? action.affectTeams : ['player'],
                hazardId: String(action?.hazardId || ('hazard_' + Date.now() + '_' + Math.floor(randomFloat() * 100000)))
            };
        }

        function drawHazardSprite(sprite, hazard) {
            sprite.clear();
            const shape = String(hazard?.shape || 'circle').toLowerCase();
            const radius = Math.max(6, Number(hazard?.radius) || 90);
            const width = Math.max(6, Number(hazard?.width) || (radius * 2));
            const length = Math.max(6, Number(hazard?.length) || width);
            const angle = Number(hazard?.angle) || 0;
            sprite.rotation = 0;
            if (shape === 'line' || shape === 'rectangle' || shape === 'laser_wall' || shape === 'zone_outline') {
                sprite.rect(-width * 0.5, -length * 0.5, width, length);
            } else if (shape === 'cone') {
                sprite.moveTo(0, 0);
                sprite.lineTo(Math.cos(angle - 0.45) * length, Math.sin(angle - 0.45) * length);
                sprite.lineTo(Math.cos(angle + 0.45) * length, Math.sin(angle + 0.45) * length);
                sprite.closePath();
            } else if (shape === 'ring') {
                sprite.circle(0, 0, radius);
                sprite.circle(0, 0, Math.max(2, radius * 0.62));
            } else {
                sprite.circle(0, 0, radius);
            }
            const preset = resolveRenderPreset('hazards', String(hazard?.type || 'default'), {});
            const fillColor = Number.isFinite(Number(preset?.fillColor)) ? Number(preset.fillColor) : 0xff4d68;
            const strokeColor = Number.isFinite(Number(preset?.strokeColor)) ? Number(preset.strokeColor) : 0xffb0be;
            const fillAlpha = Math.max(0.08, Math.min(0.5, Number(preset?.fillAlpha) || 0.15));
            const strokeAlpha = Math.max(0.3, Math.min(1, Number(preset?.strokeAlpha) || 0.6));
            sprite.fill({ color: fillColor, alpha: fillAlpha });
            sprite.stroke({ width: Math.max(1.5, Number(preset?.lineWidth) || 2), color: strokeColor, alpha: strokeAlpha });
        }

        function pushRecentHazardEvent(event) {
            if (!event || typeof event !== 'object') return;
            recentHazardEvents.push({ ts: Date.now(), ...event });
            if (recentHazardEvents.length > 20) recentHazardEvents.splice(0, recentHazardEvents.length - 20);
        }

        function pointInsideHazard(hazard, point) {
            const hx = Number(hazard?.x) || 0;
            const hy = Number(hazard?.y) || 0;
            const px = Number(point?.x) || 0;
            const py = Number(point?.y) || 0;
            const dx = px - hx;
            const dy = py - hy;
            const shape = String(hazard?.shape || 'circle').toLowerCase();
            const radius = Math.max(1, Number(hazard?.radius) || 1);
            const width = Math.max(1, Number(hazard?.width) || (radius * 2));
            const length = Math.max(1, Number(hazard?.length) || width);
            if (shape === 'line' || shape === 'rectangle' || shape === 'laser_wall' || shape === 'zone_outline') {
                return Math.abs(dx) <= (width * 0.5) && Math.abs(dy) <= (length * 0.5);
            }
            if (shape === 'cone') {
                const angle = Number(hazard?.angle) || 0;
                const coneHalf = Math.max(0.1, Number(hazard?.coneHalfAngle) || 0.45);
                const distance = Math.sqrt((dx * dx) + (dy * dy));
                if (distance > length) return false;
                const theta = Math.atan2(dy, dx);
                const delta = Math.atan2(Math.sin(theta - angle), Math.cos(theta - angle));
                return Math.abs(delta) <= coneHalf;
            }
            if (shape === 'ring') {
                const inner = Math.max(0, Number(hazard?.innerRadius) || (radius * 0.62));
                const d2 = (dx * dx) + (dy * dy);
                return d2 <= (radius * radius) && d2 >= (inner * inner);
            }
            const d2 = (dx * dx) + (dy * dy);
            return d2 <= (radius * radius);
        }

        function updateZoneState(zoneId, inside) {
            const key = String(zoneId || '').trim();
            if (!key) return;
            const prev = zoneState[key];
            if (inside) {
                zoneState[key] = (prev === 'inside' || prev === 'entered') ? 'inside' : 'entered';
            } else {
                zoneState[key] = (prev === 'inside' || prev === 'entered') ? 'left' : 'outside';
            }
        }

        function applyHazardEffectToPlayer(hazard, playerState) {
            if (!hazard || !playerState || playerState.dead) return;
            const type = String(hazard?.type || 'damage_circle').toLowerCase();
            const allowPlayer = !Array.isArray(hazard?.affectTeams) || hazard.affectTeams.includes('player');
            const point = { x: Number(playerState?.worldPos?.x) || 0, y: Number(playerState?.worldPos?.y) || 0 };
            const inside = pointInsideHazard(hazard, point);
            const zoneId = String(hazard?.zoneId || hazard?.id || '');
            if (zoneId) updateZoneState(zoneId, inside);
            if (!inside || !allowPlayer) return;

            const now = encounterElapsedMs;
            if (now < Number(hazard?.nextTickMs || 0)) return;
            hazard.nextTickMs = now + Math.max(50, Number(hazard?.tickIntervalMs) || 400);
            const force = Number(hazard?.force) || 0;
            const dx = point.x - (Number(hazard?.x) || 0);
            const dy = point.y - (Number(hazard?.y) || 0);
            const distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
            const nx = dx / distance;
            const ny = dy / distance;

            if (type === 'healing_zone') {
                if (typeof playerRuntime?.heal === 'function') playerRuntime.heal(Math.max(0, Number(hazard?.damage) || 1));
                pushRecentHazardEvent({ type: 'healing_tick', hazardId: hazard.id });
                return;
            }
            if (type === 'bullet_clear_zone') {
                entities.forEachBullet((b, i) => {
                    if (!b || b.team !== 'enemy') return;
                    const bdx = (Number(b.x) || 0) - (Number(hazard?.x) || 0);
                    const bdy = (Number(b.y) || 0) - (Number(hazard?.y) || 0);
                    const rr = Math.max(6, Number(hazard?.radius) || 120);
                    if ((bdx * bdx) + (bdy * bdy) > (rr * rr)) return;
                    if (String(b?.collision?.canBeCleared) === 'false') return;
                    try { bloomLayer.removeChild(b.sprite); } catch (_) {}
                    entities.removeBulletAt(i);
                });
                pushRecentHazardEvent({ type: 'bullet_clear_tick', hazardId: hazard.id });
                return;
            }

            if (force !== 0 && typeof playerRuntime?.applyExternalForce === 'function') {
                const scale = Math.max(0, Number(hazard?.forceScale) || 1);
                if (type === 'pull_zone') playerRuntime.applyExternalForce({ x: -nx * force * scale, y: -ny * force * scale });
                else if (type === 'push_zone' || type === 'wind_zone') playerRuntime.applyExternalForce({ x: nx * force * scale, y: ny * force * scale });
                else playerRuntime.applyExternalForce({ x: nx * force * 0.35 * scale, y: ny * force * 0.35 * scale });
            }

            if (type === 'safe_zone') return;

            const dmg = Math.max(0, Number(hazard?.damage) || 0);
            if (dmg > 0) {
                const incoming = getPlayerStatusScalars();
                const hit = playerRuntime.tryDamage(dmg * Math.max(0, Number(incoming.incomingDamage) || 1));
                if (hit) {
                    pushRecentHazardEvent({ type: 'damage_tick', hazardId: hazard.id, damage: dmg });
                    feedbackCounters.hitFlash += 1;
                    emitFeedback('player_hit_flash', { source: 'hazard' });
                    if (getRuntimeSettings().enableMicroHitStop) microHitStopMsRemaining = Math.max(microHitStopMsRemaining, 22);
                    spawnDamageNumber(point.x, point.y, '-' + Math.max(1, Math.round(dmg)), 0xff9b9b);
                    if (hazard?.statusOnHit) {
                        applyStatusToTarget({ statusId: String(hazard.statusOnHit), targetType: 'player', stacks: 1, source: hazard.id });
                    }
                    shakePower = Math.max(shakePower, 7);
                }
            }
            for (let i = damageNumberSprites.length - 1; i >= 0; i -= 1) {
                const item = damageNumberSprites[i];
                const age = encounterElapsedMs - (Number(item?.bornMs) || 0);
                const life = Math.max(120, Number(item?.lifeMs) || 500);
                const ratio = Math.max(0, Math.min(1, age / life));
                const sprite = item?.sprite;
                if (sprite) {
                    if (item.shockwave) {
                        const scale = 1 + (ratio * 1.8);
                        sprite.scale.set(scale);
                        sprite.alpha = 0.9 * (1 - ratio);
                    } else {
                        sprite.y += Number(item?.vy) || -0.04;
                        sprite.alpha = Math.max(0, 0.95 * (1 - ratio));
                    }
                }
                if (age >= life) {
                    try { sprite?.parent?.removeChild(sprite); } catch (_) {}
                    try { sprite?.destroy?.({ children: true }); } catch (_) {}
                    damageNumberSprites.splice(i, 1);
                }
            }
        }

        function clearHazards() {
            const hazards = encounter?.runtimeCollections?.hazards;
            if (!Array.isArray(hazards)) return;
            for (const hazard of hazards) {
                try { hazard?.sprite?.parent?.removeChild(hazard.sprite); } catch (_) {}
            }
            hazards.splice(0, hazards.length);
        }

        function spawnEncounterHazard(action) {
            const hazards = encounter?.runtimeCollections?.hazards;
            if (!Array.isArray(hazards)) return false;
            if (hazards.length >= getBudgets().maxHazardsAlive) {
                pushBudgetWarning('Hazard budget reached; hazard action skipped.');
                return false;
            }
            const def = resolveHazardDefinition(action);
            if (!def) return false;
            const source = (action?.at && typeof action.at === 'object') ? action.at : (def?.source || action?.source);
            const at = resolvePointFromSpec(source, { x: 0, y: 0 });
            const sprite = new PIXI.Graphics();
            drawHazardSprite(sprite, def);
            const iso = toIso(at.x, at.y, 0);
            sprite.x = iso.x;
            sprite.y = iso.y;
            gameLayer.addChild(sprite);
            hazards.push({
                id: String(def?.hazardId || ('hazard_' + Date.now() + '_' + Math.floor(randomFloat() * 100000))),
                type: String(def?.type || 'damage_circle').toLowerCase(),
                shape: String(
                    def?.shape
                    || (String(def?.type || '').includes('line') ? 'line' : '')
                    || (String(def?.type || '').includes('cone') ? 'cone' : '')
                    || (String(def?.type || '').includes('ring') ? 'ring' : '')
                    || (String(def?.type || '').includes('zone') ? 'circle' : 'circle')
                ).toLowerCase(),
                x: Number(at.x) || 0,
                y: Number(at.y) || 0,
                radius: Math.max(6, Number(def?.radius) || 90),
                width: Math.max(6, Number(def?.width) || 160),
                length: Math.max(6, Number(def?.length) || 160),
                angle: Number(def?.angle) || 0,
                damage: Math.max(0, Number(def?.damage) || 1),
                force: Number(def?.force) || 0,
                growthPerSecond: Number(def?.growthPerSecond) || 0,
                affectTeams: Array.isArray(def?.affectTeams) ? def.affectTeams : ['player'],
                statusOnHit: def?.statusOnHit || null,
                zoneId: String(def?.zoneId || def?.hazardId || ''),
                tags: Array.isArray(def?.tags) ? def.tags : [],
                tickIntervalMs: Math.max(50, (Number(def?.tickIntervalSeconds) || 0.4) * 1000),
                nextTickMs: encounterElapsedMs + Math.max(50, (Number(def?.tickIntervalSeconds) || 0.4) * 1000),
                sprite,
                bornMs: encounterElapsedMs,
                expiresMs: encounterElapsedMs + (Math.max(0.2, Number(def?.durationSeconds) || 3) * 1000)
            });
            logEvent('hazard_spawned', { hazardId: String(def?.hazardId || ''), type: String(def?.type || ''), shape: String(def?.shape || '') });
            return true;
        }

        function resolveObjectDefinition(action) {
            const ref = action?.object;
            if (typeof ref === 'string' && encounter?.objects?.[ref]) {
                return { ...encounter.objects[ref], objectId: String(action?.objectId || ref) };
            }
            if (typeof ref === 'string' && !encounter?.objects?.[ref]) {
                pushBudgetWarning('Unknown object id "' + ref + '" in object action.');
                return null;
            }
            if (ref && typeof ref === 'object') {
                return { ...ref, objectId: String(action?.objectId || ref.objectId || ('object_' + Date.now())) };
            }
            return {
                objectId: String(action?.objectId || ('object_' + Date.now() + '_' + Math.floor(randomFloat() * 100000))),
                type: String(action?.objectType || 'destructible').toLowerCase(),
                team: String(action?.team || 'neutral').toLowerCase(),
                hp: Math.max(1, Number(action?.hp) || 20),
                radius: Math.max(4, Number(action?.radius) || 28),
                source: (action?.at && typeof action.at === 'object') ? action.at : (action?.source || { type: 'arena_center' }),
                tags: Array.isArray(action?.tags) ? action.tags : [],
                onDestroyed: Array.isArray(action?.onDestroyed) ? action.onDestroyed : [],
                pickupDrops: Array.isArray(action?.pickupDrops) ? action.pickupDrops : []
            };
        }

        function drawObjectSprite(sprite, object) {
            sprite.clear();
            const radius = Math.max(4, Number(object?.radius) || 28);
            const type = String(object?.type || 'destructible').toLowerCase();
            if (type === 'shield_generator') {
                sprite.rect(-radius * 0.9, -radius * 0.9, radius * 1.8, radius * 1.8);
            } else if (type === 'capture_point' || type === 'capture_zone') {
                sprite.circle(0, 0, radius);
                sprite.circle(0, 0, Math.max(3, radius * 0.56));
            } else {
                sprite.rect(-radius, -radius, radius * 2, radius * 2);
            }
            const presetKey = object?.type === 'capture_point' || object?.capture ? 'objective_default' : 'object_default';
            const preset = resolveRenderPreset('objectiveObjects', String(object?.renderPreset || presetKey), {});
            const fillColor = Number.isFinite(Number(preset?.fillColor)) ? Number(preset.fillColor) : 0x5cb4ff;
            const strokeColor = Number.isFinite(Number(preset?.strokeColor)) ? Number(preset.strokeColor) : 0x9ed1ff;
            sprite.fill({ color: fillColor, alpha: Math.max(0.08, Math.min(0.5, Number(preset?.fillAlpha) || 0.2)) });
            sprite.stroke({ width: Math.max(1.5, Number(preset?.lineWidth) || 2), color: strokeColor, alpha: Math.max(0.35, Math.min(1, Number(preset?.strokeAlpha) || 0.85)) });
        }

        function spawnEncounterObject(action) {
            const objects = encounter?.runtimeCollections?.objects;
            if (!Array.isArray(objects)) return false;
            const maxObjects = Math.max(1, Number(getBudgets().maxPickupsAlive || 20) + 20);
            if (objects.length >= maxObjects) {
                pushBudgetWarning('Object budget reached; object action skipped.');
                return false;
            }
            const def = resolveObjectDefinition(action);
            if (!def) return false;
            const at = resolvePointFromSpec(def?.source, { x: 0, y: 0 });
            const sprite = new PIXI.Graphics();
            drawObjectSprite(sprite, def);
            const iso = toIso(at.x, at.y, 0);
            sprite.x = iso.x;
            sprite.y = iso.y;
            gameLayer.addChild(sprite);
            const object = {
                id: String(def.objectId || ('object_' + Date.now())),
                type: String(def.type || 'destructible').toLowerCase(),
                team: String(def.team || 'neutral').toLowerCase(),
                hp: Math.max(1, Number(def.hp) || 20),
                maxHp: Math.max(1, Number(def.hp) || 20),
                radius: Math.max(4, Number(def.radius) || 28),
                x: Number(at.x) || 0,
                y: Number(at.y) || 0,
                tags: Array.isArray(def.tags) ? def.tags : [],
                onDestroyed: Array.isArray(def.onDestroyed) ? def.onDestroyed : [],
                onDamaged: Array.isArray(def.onDamaged) ? def.onDamaged : [],
                pickupDrops: Array.isArray(def.pickupDrops) ? def.pickupDrops : [],
                capture: def.capture === true,
                status: 'alive',
                sprite,
                playerInside: false
            };
            objects.push(object);
            objectSnapshots[object.id] = {
                id: object.id,
                type: object.type,
                hp: object.hp,
                maxHp: object.maxHp,
                x: object.x,
                y: object.y,
                radius: object.radius
            };
            destroyedObjects[object.id] = false;
            if (object.type === 'capture_point' || object.type === 'capture_zone' || object.capture === true) {
                zoneState[object.id] = 'outside';
            }
            logEvent('object_spawned', { objectId: object.id, objectType: object.type });
            return true;
        }

        function clearObjects() {
            const objects = encounter?.runtimeCollections?.objects;
            if (!Array.isArray(objects)) return;
            for (const object of objects) {
                try { object?.sprite?.parent?.removeChild(object.sprite); } catch (_) {}
            }
            objects.splice(0, objects.length);
            for (const key of Object.keys(objectSnapshots)) delete objectSnapshots[key];
            for (const key of Object.keys(destroyedObjects)) delete destroyedObjects[key];
            for (const key of Object.keys(zoneState)) delete zoneState[key];
        }

        function damageObjectById(objectId, damage = 0) {
            const objects = encounter?.runtimeCollections?.objects;
            if (!Array.isArray(objects)) return null;
            const target = objects.find((item) => String(item?.id || '') === String(objectId || ''));
            if (!target || target.status !== 'alive') return null;
            const amount = Math.max(0, Number(damage) || 0);
            if (amount <= 0) return null;
            target.hp = Math.max(0, Number(target.hp) - amount);
            logEvent('object_damaged', { objectId: target.id, hp: target.hp, maxHp: target.maxHp });
            objectSnapshots[target.id] = {
                id: target.id,
                type: target.type,
                hp: target.hp,
                maxHp: target.maxHp,
                x: target.x,
                y: target.y,
                radius: target.radius
            };
            if (target.hp <= 0) {
                target.status = 'destroyed';
                if (target.sprite?.parent) target.sprite.parent.removeChild(target.sprite);
                destroyedObjects[target.id] = true;
                zoneState[target.id] = 'outside';
                if (Array.isArray(target.onDestroyed) && target.onDestroyed.length > 0) {
                    for (const action of target.onDestroyed) pendingObjectActions.push(action);
                }
                maybeSpawnPickupDrops(target);
                delete objectStatusById[target.id];
                logEvent('object_destroyed', { objectId: target.id, objectType: target.type });
                return { destroyed: true, object: target };
            }
            if (Array.isArray(target.onDamaged) && target.onDamaged.length > 0) {
                for (const action of target.onDamaged) pendingObjectActions.push(action);
            }
            return { destroyed: false, object: target };
        }

        function getPlayerStatusSnapshot() {
            const out = {};
            for (const [id, effect] of Object.entries(playerStatuses)) {
                if (!effect) continue;
                out[id] = {
                    stacks: Number(effect.stacks) || 0,
                    remainingMs: Math.max(0, Number(effect.remainingMs) || 0),
                    category: String(effect.category || 'debuff')
                };
            }
            return out;
        }

        function getPlayerStatusScalars() {
            const scalars = {
                move: 1,
                incomingDamage: 1,
                outgoingDamage: 1,
                mitigationWindow: false
            };
            for (const effect of Object.values(playerStatuses)) {
                if (!effect) continue;
                const stacks = Math.max(1, Number(effect.stacks) || 1);
                for (const modifier of (Array.isArray(effect.modifiers) ? effect.modifiers : [])) {
                    const type = String(modifier?.type || '').toLowerCase();
                    const value = Number(modifier?.value);
                    const perStack = modifier?.perStack === true;
                    const resolved = Number.isFinite(value) ? value : 1;
                    const amount = perStack ? resolved * stacks : resolved;
                    if (type === 'movement_scalar') scalars.move *= Math.max(0.05, amount);
                    if (type === 'incoming_damage_scalar') scalars.incomingDamage *= Math.max(0, amount);
                    if (type === 'outgoing_damage_scalar') scalars.outgoingDamage *= Math.max(0, amount);
                    if (type === 'mitigation_window_flag' && amount > 0) scalars.mitigationWindow = true;
                }
            }
            return scalars;
        }

        function runStatusTick(effect) {
            if (!effect) return;
            const targetType = String(effect.targetType || 'player');
            const stacks = Math.max(1, Number(effect.stacks) || 1);
            for (const modifier of (Array.isArray(effect.modifiers) ? effect.modifiers : [])) {
                const type = String(modifier?.type || '').toLowerCase();
                const value = Number(modifier?.value);
                const perStack = modifier?.perStack === true;
                const resolved = Number.isFinite(value) ? value : 0;
                const amount = perStack ? resolved * stacks : resolved;
                if (targetType === 'player') {
                    if (type === 'regen_per_second' && amount > 0) {
                        playerRuntime?.heal?.(amount * (Number(effect.tickIntervalMs) || 0) / 1000);
                    } else if (type === 'bleed_per_second' && amount > 0) {
                        playerRuntime?.tryDamage?.(amount * (Number(effect.tickIntervalMs) || 0) / 1000);
                    } else if (type === 'mitigation_window_flag' && amount > 0) {
                        playerRuntime?.applyMitigationWindow?.((Number(effect.tickIntervalMs) || 0) / 1000);
                    }
                } else if (targetType === 'enemy') {
                    const enemyId = String(effect.targetId || '');
                    const targetEnemy = enemyRuntime?.getAliveEnemies?.().find((item) => String(item?.id || '') === enemyId);
                    if (targetEnemy && type === 'bleed_per_second' && amount > 0) {
                        enemyRuntime?.applyDamage?.(targetEnemy, amount * (Number(effect.tickIntervalMs) || 0) / 1000);
                    }
                } else if (targetType === 'object') {
                    const objectId = String(effect.targetId || '');
                    if (objectId && type === 'bleed_per_second' && amount > 0) {
                        damageObjectById(objectId, amount * (Number(effect.tickIntervalMs) || 0) / 1000);
                    }
                }
            }
            pushStatusEvent('status_ticked', { target: targetType, targetId: effect.targetId, statusId: effect.id, stacks });
        }

        function updateStatusContainer(container, deltaMs) {
            const nowMs = encounterElapsedMs;
            for (const key of Object.keys(container || {})) {
                const effect = container[key];
                if (!effect) continue;
                effect.remainingMs = Math.max(0, (Number(effect.remainingMs) || 0) - deltaMs);
                while (nowMs >= Number(effect.nextTickMs || 0) && effect.remainingMs > 0) {
                    runStatusTick(effect);
                    effect.nextTickMs += Math.max(50, Number(effect.tickIntervalMs) || 1000);
                }
                if (effect.remainingMs <= 0) removeStatusFromTarget({ statusId: key, targetType: effect.targetType, targetId: effect.targetId, expired: true });
            }
        }

        function updateStatuses(deltaMs) {
            updateStatusContainer(playerStatuses, deltaMs);
            for (const [enemyId, container] of Object.entries(enemyStatusById)) {
                updateStatusContainer(container, deltaMs);
                if (Object.keys(container || {}).length === 0) delete enemyStatusById[enemyId];
            }
            for (const [objectId, container] of Object.entries(objectStatusById)) {
                updateStatusContainer(container, deltaMs);
                if (Object.keys(container || {}).length === 0) delete objectStatusById[objectId];
            }
        }

        function resolvePickupDefinition(action) {
            const ref = action?.pickup;
            if (typeof ref === 'string' && encounter?.pickups?.[ref]) return { ...encounter.pickups[ref], id: String(action?.pickupId || ref) };
            if (typeof ref === 'string' && !encounter?.pickups?.[ref]) {
                pushBudgetWarning('Unknown pickup id "' + ref + '" in pickup action.');
                return null;
            }
            if (ref && typeof ref === 'object') return { ...ref, id: String(action?.pickupId || ref.id || ('pickup_' + Date.now())) };
            return null;
        }

        function drawPickupSprite(sprite, pickup) {
            sprite.clear();
            const radius = Math.max(4, Number(pickup?.radius) || 14);
            const type = String(pickup?.type || 'heal_orb').toLowerCase();
            const preset = resolveRenderPreset('pickups', type, {});
            const color = Number.isFinite(Number(preset?.color))
                ? Number(preset.color)
                : (type === 'heal_orb' ? 0x5eff9b : (type === 'cooldown_reset' ? 0x59d6ff : (type === 'shield_pickup' ? 0xbcc8ff : 0xffdb5e)));
            sprite.circle(0, 0, radius);
            sprite.fill({ color, alpha: Math.max(0.2, Math.min(0.9, Number(preset?.fillAlpha) || 0.4)) });
            sprite.circle(0, 0, radius * 0.42);
            sprite.fill({ color: 0xffffff, alpha: 0.72 });
            sprite.stroke({ width: Math.max(1.2, Number(preset?.lineWidth) || 2), color, alpha: Math.max(0.35, Math.min(1, Number(preset?.strokeAlpha) || 0.95)) });
        }

        function spawnPickup(action) {
            const pickups = encounter?.runtimeCollections?.pickups;
            if (!Array.isArray(pickups)) return false;
            if (pickups.length >= getBudgets().maxPickupsAlive) {
                pushBudgetWarning('Pickup budget reached; pickup action skipped.');
                return false;
            }
            const def = resolvePickupDefinition(action);
            if (!def) return false;
            const at = resolvePointFromSpec(action?.at || action?.source || { type: 'arena_center' }, { x: 0, y: 0 });
            const sprite = new PIXI.Graphics();
            drawPickupSprite(sprite, def);
            const iso = toIso(at.x, at.y, 0);
            sprite.x = iso.x;
            sprite.y = iso.y;
            gameLayer.addChild(sprite);
            const item = {
                id: String(def.id || ('pickup_' + Date.now() + '_' + Math.floor(randomFloat() * 100000))),
                type: String(def.type || 'heal_orb').toLowerCase(),
                x: Number(at.x) || 0,
                y: Number(at.y) || 0,
                radius: Math.max(4, Number(def.radius) || 14),
                bornMs: encounterElapsedMs,
                expiresMs: encounterElapsedMs + (Math.max(0.1, Number(def.durationSeconds) || 10) * 1000),
                statusOnPickup: def.statusOnPickup ? String(def.statusOnPickup) : null,
                effectActions: Array.isArray(def.effectActions) ? def.effectActions : [],
                sprite
            };
            pickups.push(item);
            pushPickupEvent('pickup_spawned', { pickupId: item.id, pickupType: item.type });
            return true;
        }

        function clearPickups() {
            const pickups = encounter?.runtimeCollections?.pickups;
            if (!Array.isArray(pickups)) return;
            for (const item of pickups) {
                try { item?.sprite?.parent?.removeChild(item.sprite); } catch (_) {}
            }
            pickups.splice(0, pickups.length);
        }

        function collectPickup(item) {
            if (!item) return;
            const type = String(item.type || 'heal_orb');
            if (type === 'heal_orb') playerRuntime?.heal?.(2);
            if (type === 'cooldown_reset') {
                playerRuntime?.resetAbilityCooldown?.('q');
                playerRuntime?.resetAbilityCooldown?.('e');
                playerRuntime?.resetAbilityCooldown?.('r');
            }
            if (type === 'shield_pickup') playerRuntime?.applyMitigationWindow?.(2.2);
            if (type === 'status_pickup' && item.statusOnPickup) {
                applyStatusToTarget({ statusId: item.statusOnPickup, targetType: 'player', stacks: 1, source: item.id });
            }
            if (type === 'ammo_pickup' || type === 'charge_pickup') {
                playerRuntime?.grantAbility?.({ id: 'charge_pickup_grant', key: 'q', charges: 1, cooldownSeconds: 1, castActions: [] });
            }
            for (const action of (Array.isArray(item.effectActions) ? item.effectActions : [])) {
                pendingObjectActions.push(action);
            }
            pickupCollectedCounts.__all = (Number(pickupCollectedCounts.__all) || 0) + 1;
            pickupCollectedCounts[item.id] = (Number(pickupCollectedCounts[item.id]) || 0) + 1;
            pushPickupEvent('pickup_collected', { pickupId: item.id, pickupType: item.type });
        }

        function maybeSpawnPickupDrops(enemy) {
            if (!enemy) return;
            const fromData = Array.isArray(enemy?.data?.pickupDrops) ? enemy.data.pickupDrops : [];
            const fromObject = Array.isArray(enemy?.pickupDrops) ? enemy.pickupDrops : [];
            const drops = fromData.length ? fromData : fromObject;
            if (!drops.length) return;
            let total = 0;
            for (const d of drops) total += Math.max(0, Number(d?.weight) || 0);
            if (total <= 0) return;
            let pick = randomFloat() * total;
            let chosen = null;
            for (const d of drops) {
                pick -= Math.max(0, Number(d?.weight) || 0);
                if (pick <= 0) {
                    chosen = d;
                    break;
                }
            }
            if (!chosen) return;
            spawnPickup({
                pickup: String(chosen.pickup || chosen.pickupId || ''),
                at: { type: 'fixed_point', x: Number(enemy.x) || 0, y: Number(enemy.y) || 0 }
            });
        }

        function removeEmitterAt(index) {
            if (index < 0 || index >= activeEmitters.length) return;
            activeEmitters.splice(index, 1);
        }

        function clearEmitters() {
            activeEmitters.splice(0, activeEmitters.length);
            if (Array.isArray(encounter?.runtimeCollections?.emitters)) {
                encounter.runtimeCollections.emitters.splice(0, encounter.runtimeCollections.emitters.length);
            }
        }

        function emitterIdFromAction(action) {
            return String(action?.emitterId || action?.id || action?.emitter || '').trim();
        }

        function spawnEmitter(action) {
            const templateId = String(action?.emitter || action?.emitterId || '').trim();
            const template = templateId ? encounter?.emitters?.[templateId] : null;
            const resolved = template ? { ...template, ...action } : action;
            const patternId = String(resolved?.pattern || '').trim();
            if (!patternId) return false;
            const pattern = encounter?.patterns?.[patternId];
            if (!pattern) {
                pushBudgetWarning('Unknown pattern "' + patternId + '" in spawn_emitter action.');
                return false;
            }
            if (activeEmitters.length >= getBudgets().maxEmittersAlive) {
                pushBudgetWarning('Emitter budget reached; spawn_emitter action skipped.');
                return false;
            }

            const id = emitterIdFromAction(resolved) || templateId || ('emitter_' + Date.now() + '_' + Math.floor(randomFloat() * 100000));
            const source = resolved?.source && typeof resolved.source === 'object' ? resolved.source : { type: 'fixed_point', x: 0, y: 0 };
            const movement = resolved?.movement && typeof resolved.movement === 'object' ? resolved.movement : { type: 'none' };
            const intervalSeconds = Math.max(0.05, Number(resolved?.intervalSeconds) || 1);
            const durationSeconds = Math.max(0.1, Number(resolved?.durationSeconds) || 6);
            const startDelaySeconds = Math.max(0, Number(resolved?.startDelaySeconds) || 0);
            const point = resolveEmitterSource(source);
            const emitter = {
                emitterId: id,
                patternId,
                source,
                aim: resolved?.aim && typeof resolved.aim === 'object' ? resolved.aim : null,
                movement,
                intervalMs: intervalSeconds * 1000,
                durationMs: durationSeconds * 1000,
                startDelayMs: startDelaySeconds * 1000,
                bornMs: encounterElapsedMs,
                nextFireMs: encounterElapsedMs + (startDelaySeconds * 1000),
                x: point.x,
                y: point.y,
                paused: false,
                stopped: false,
                ownerType: resolved?.ownerType ? String(resolved.ownerType) : null,
                ownerId: resolved?.ownerId ? String(resolved.ownerId) : null
            };
            activeEmitters.push(emitter);
            if (Array.isArray(encounter?.runtimeCollections?.emitters)) encounter.runtimeCollections.emitters.push(emitter);
            return true;
        }

        function updateEmitterMovement(emitter, deltaMs) {
            const movement = emitter?.movement || {};
            const type = String(movement.type || 'none').toLowerCase();
            if (type !== 'linear') return;
            const seconds = Math.max(0, Number(deltaMs) || 0) / 1000;
            emitter.x += (Number(movement.vx) || 0) * seconds;
            emitter.y += (Number(movement.vy) || 0) * seconds;
        }

        function fireEmitter(emitter, runtimeState) {
            const pattern = encounter?.patterns?.[emitter.patternId];
            if (!pattern) {
                pushBudgetWarning('Emitter "' + emitter.emitterId + '" references unknown pattern "' + emitter.patternId + '".');
                emitter.stopped = true;
                return;
            }
            const player = playerRuntime?.getState?.();
            const playerPos = player?.worldPos
                ? { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 }
                : { x: 0, y: 0 };
            const patternForAction = {
                ...pattern,
                source: { type: 'fixed_point', x: Number(emitter.x) || 0, y: Number(emitter.y) || 0 },
                aim: emitter.aim && typeof emitter.aim === 'object' ? emitter.aim : pattern?.aim
            };
            const projectileTypeId = String(pattern?.projectileType || 'enemy_default_bullet');
            const projectileType = resolveProjectileType(projectileTypeId, 'enemy_default_bullet');
            const spawns = window.TDSPatternRegistry?.firePattern?.(
                patternForAction,
                {
                    timeSeconds: (Number(runtimeState?.elapsedMs) || encounterElapsedMs) / 1000,
                    source: { x: emitter.x, y: emitter.y },
                    target: playerPos,
                    player: playerPos,
                    mapSize: getMapSize(),
                    randomFloat
                }
            );
            schedulePatternSpawns(spawns, (instruction) => {
                spawnBullet({
                    projectileType: projectileTypeId,
                    x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                    y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                    z: 20,
                    vx: Number(instruction?.vx) || 0,
                    vy: Number(instruction?.vy) || 0,
                    vz: Number.isFinite(Number(projectileType?.vz)) ? Number(projectileType.vz) : -0.05,
                    life: Number(projectileType?.lifeTicks) || 320,
                    color: Number(projectileType?.color) || Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                    team: String(projectileType?.team || 'enemy'),
                    radius: Number(projectileType?.radius) || 8,
                    damage: Math.max(0, Number(projectileType?.damage) || 1),
                    collision: projectileType?.collision || null,
                    render: projectileType?.render || null,
                    modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                });
            });
        }

        function runBossAction(action, runtimeState = {}) {
            const type = String(action?.type || '').trim().toLowerCase();
            if (!type) return;
            if (type === 'show_banner') {
                setBanner(String(action?.text || ''));
                return;
            }
            if (type === 'set_objective') {
                setObjective(String(action?.text || ''));
                return;
            }
            if (type === 'spawn_enemy') {
                if (enemySpawnGateState.blocked) return;
                const alive = enemyRuntime?.getAliveEnemies?.().length || 0;
                if (alive >= getBudgets().maxEnemiesAlive) {
                    pushBudgetWarning('Enemy budget reached; boss onEnter spawn skipped.');
                    return;
                }
                enemyRuntime?.spawnFromAction?.(action);
                return;
            }
            if (type === 'fire_pattern') {
                const patternId = String(action?.pattern || '').trim();
                if (!patternId) return;
                const pattern = encounter?.patterns?.[patternId];
                if (!pattern) return;
                const player = playerRuntime?.getState?.();
                const playerPos = player?.worldPos ? { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 } : { x: 0, y: 0 };
                const patternForAction = {
                    ...pattern,
                    source: (action?.source && typeof action.source === 'object') ? action.source : pattern?.source,
                    aim: (action?.aim && typeof action.aim === 'object') ? action.aim : pattern?.aim
                };
                const projectileTypeId = String(pattern?.projectileType || 'enemy_default_bullet');
                const projectileType = resolveProjectileType(projectileTypeId, 'enemy_default_bullet');
                const spawns = window.TDSPatternRegistry?.firePattern?.(
                    patternForAction,
                    {
                        timeSeconds: (Number(runtimeState?.elapsedMs) || encounterElapsedMs) / 1000,
                        source: { x: 0, y: 0 },
                        target: playerPos,
                        player: playerPos,
                        mapSize: getMapSize(),
                        randomFloat
                    }
                );
                schedulePatternSpawns(spawns, (instruction) => {
                    spawnBullet({
                        projectileType: projectileTypeId,
                        x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                        y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                        z: 20,
                        vx: Number(instruction?.vx) || 0,
                        vy: Number(instruction?.vy) || 0,
                        vz: Number.isFinite(Number(projectileType?.vz)) ? Number(projectileType.vz) : -0.05,
                        life: Number(projectileType?.lifeTicks) || 320,
                        color: Number(projectileType?.color) || Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                        team: String(projectileType?.team || 'enemy'),
                        radius: Number(projectileType?.radius) || 8,
                        damage: Math.max(0, Number(projectileType?.damage) || 1),
                        collision: projectileType?.collision || null,
                        render: projectileType?.render || null,
                        modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                    });
                });
                return;
            }
            if (type === 'spawn_telegraph') {
                spawnTelegraph(action);
                return;
            }
            if (type === 'telegraph_then_fire') {
                spawnTelegraph(action, () => runBossAction({ ...action, type: 'fire_pattern' }, runtimeState));
                return;
            }
            if (type === 'spawn_hazard') {
                spawnEncounterHazard(action);
                return;
            }
            if (type === 'clear_hazards') {
                clearHazards();
                return;
            }
            if (type === 'spawn_object') {
                spawnEncounterObject(action);
                return;
            }
            if (type === 'despawn_object') {
                const objectId = String(action?.objectId || action?.object || '').trim();
                if (!objectId) return;
                const objects = encounter?.runtimeCollections?.objects;
                if (!Array.isArray(objects)) return;
                for (let i = objects.length - 1; i >= 0; i -= 1) {
                    const obj = objects[i];
                    if (String(obj?.id || '') !== objectId) continue;
                    obj.status = 'destroyed';
                    if (obj?.sprite?.parent) obj.sprite.parent.removeChild(obj.sprite);
                    objects.splice(i, 1);
                    destroyedObjects[objectId] = true;
                    logEvent('object_destroyed', { objectId, reason: 'boss_action_despawn' });
                    break;
                }
                return;
            }
            if (type === 'damage_object') {
                const objectId = String(action?.objectId || action?.object || '').trim();
                if (!objectId) return;
                damageObjectById(objectId, Math.max(0, Number(action?.damage) || 1));
                return;
            }
            if (type === 'activate_objective') {
                const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                if (!objectiveId || !objectiveById(objectiveId)) return;
                setObjectiveState(objectiveId, { status: 'active', startedAtMs: encounterElapsedMs, lastEvent: 'manual_activate' });
                return;
            }
            if (type === 'complete_objective') {
                const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                const item = objectiveById(objectiveId);
                if (!objectiveId || !item) return;
                setObjectiveState(objectiveId, { status: 'completed', completedAtMs: encounterElapsedMs, progress: Math.max(Number(item.target) || 1, Number(item.progress) || 0), lastEvent: 'manual_complete' });
                return;
            }
            if (type === 'fail_objective') {
                const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                if (!objectiveId || !objectiveById(objectiveId)) return;
                setObjectiveState(objectiveId, { status: 'failed', failedAtMs: encounterElapsedMs, lastEvent: 'manual_fail' });
                return;
            }
            if (type === 'set_objective_progress') {
                const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                const item = objectiveById(objectiveId);
                if (!objectiveId || !item) return;
                const progress = Math.max(0, Number(action?.progress) || 0);
                const target = Number.isFinite(Number(action?.target)) ? Math.max(0, Number(action.target)) : Number(item.target) || 0;
                setObjectiveState(objectiveId, { progress, target, lastEvent: 'manual_progress' });
                return;
            }
            if (type === 'clear_telegraphs') {
                clearTelegraphs();
                return;
            }
            if (type === 'spawn_emitter') {
                spawnEmitter(action);
                return;
            }
            if (type === 'stop_emitter') {
                const id = emitterIdFromAction(action);
                if (!id) return;
                for (let i = activeEmitters.length - 1; i >= 0; i -= 1) {
                    if (String(activeEmitters[i]?.emitterId || '') !== id) continue;
                    activeEmitters[i].stopped = true;
                    removeEmitterAt(i);
                }
                return;
            }
            if (type === 'clear_emitters') {
                clearEmitters();
                return;
            }
            if (type === 'lock_boss_damage') {
                enemyRuntime?.lockBossDamage?.(action);
                return;
            }
            if (type === 'unlock_boss_damage') {
                enemyRuntime?.unlockBossDamage?.(action);
                return;
            }
            if (type === 'apply_status') {
                const statusId = String(action?.status || action?.statusId || '').trim();
                if (!statusId) return;
                applyStatusToTarget({
                    statusId,
                    targetType: String(action?.target || action?.targetType || 'player').toLowerCase(),
                    targetId: String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null,
                    stacks: Math.max(1, Number(action?.stacks) || 1),
                    source: String(action?.source || 'boss_action')
                });
                return;
            }
            if (type === 'remove_status') {
                const statusId = String(action?.status || action?.statusId || '').trim();
                if (!statusId) return;
                removeStatusFromTarget({
                    statusId,
                    targetType: String(action?.target || action?.targetType || 'player').toLowerCase(),
                    targetId: String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null,
                    expired: false
                });
                return;
            }
            if (type === 'clear_statuses') {
                clearStatusesOnTarget({
                    targetType: String(action?.target || action?.targetType || 'player').toLowerCase(),
                    targetId: String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null
                });
                return;
            }
            if (type === 'spawn_pickup') {
                spawnPickup(action);
                return;
            }
            if (type === 'clear_pickups') {
                clearPickups();
                return;
            }
            if (type === 'apply_arena_modifier') {
                const modifier = (action?.modifier && typeof action.modifier === 'object')
                    ? action.modifier
                    : (action && typeof action === 'object' ? action : null);
                if (!modifier) return;
                addArenaModifier(modifier, 'boss_action');
                return;
            }
            if (type === 'remove_arena_modifier') {
                const token = String(action?.modifierId || action?.id || action?.modifierType || action?.typeName || action?.token || '').trim();
                if (!token) return;
                removeArenaModifier(token);
                return;
            }
            if (type === 'clear_arena_modifiers') {
                clearArenaModifiers('boss_action');
            }
        }

        function emitEnemyPattern(enemy, attackSpec = null) {
            const patternRegistry = window.TDSPatternRegistry || null;
            const patternId = String(attackSpec?.pattern || enemy?.data?.attackPatternId || '').trim();
            const basePattern = encounter?.patterns?.[patternId];
            const pattern = basePattern
                ? {
                    ...basePattern,
                    source: (attackSpec?.source && typeof attackSpec.source === 'object') ? attackSpec.source : basePattern.source,
                    aim: (attackSpec?.aim && typeof attackSpec.aim === 'object') ? attackSpec.aim : basePattern.aim
                }
                : null;
            if (!pattern || !patternRegistry?.firePattern) return;
            const player = playerRuntime?.getState?.();
            if (!player || player.dead) return;
            const spawnFromInstruction = (instruction) => {
                const projectileTypeId = String(pattern?.projectileType || 'enemy_default_bullet');
                const projectileType = resolveProjectileType(projectileTypeId, 'enemy_default_bullet');
                spawnBullet({
                    projectileType: projectileTypeId,
                    x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                    y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                    z: 20,
                    vx: Number(instruction?.vx) || 0,
                    vy: Number(instruction?.vy) || 0,
                    vz: Number.isFinite(Number(projectileType?.vz)) ? Number(projectileType.vz) : -0.05,
                    life: Number(projectileType?.lifeTicks) || 320,
                    color: Number(projectileType?.color) || Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                    team: String(projectileType?.team || 'enemy'),
                    radius: Number(projectileType?.radius) || 8,
                    damage: Math.max(0, Number(projectileType?.damage) || 1),
                    collision: projectileType?.collision || null,
                    render: projectileType?.render || null,
                    modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                });
            };
            const spawns = patternRegistry.firePattern(pattern, {
                timeSeconds: encounterElapsedMs / 1000,
                source: { x: enemy.x, y: enemy.y },
                target: { x: player.worldPos.x, y: player.worldPos.y },
                player: { x: player.worldPos.x, y: player.worldPos.y },
                mapSize: getMapSize(),
                randomFloat
            });
            schedulePatternSpawns(spawns, spawnFromInstruction);
        }

        function startEnemyPatterns(playerStateProvider) {
            if (encounter?.pressurePattern?.enabled === false) return;
            const pressure = encounter?.pressurePattern || {};
            const patternRegistry = window.TDSPatternRegistry || null;
            patternIntervals.push(setInterval(() => {
                const p = playerStateProvider();
                if (!p || p.dead || phase !== PHASES.PLAYING) return;
                const t = (encounterElapsedMs / 1000) * 0.8;
                const cx = Math.sin(t) * (Number(pressure.originRadius) || 600);
                const cy = Math.cos(t) * (Number(pressure.originRadius) || 600);
                const bulletLifeTicks = Number(pressure.bulletLifeTicks) || 300;
                const bulletVz = Number(pressure.bulletVz);
                const defaultPattern = {
                    type: 'spiral',
                    count: Math.max(1, Number.parseInt(pressure.ringCount, 10) || 4),
                    speed: Number(pressure.bulletSpeed) || 3.5
                };
                const chosenPattern = (pressure.pattern && typeof pressure.pattern === 'object')
                    ? pressure.pattern
                    : defaultPattern;

                const spawnFromInstruction = (instruction) => {
                    spawnBullet({
                        x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                        y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                        z: 40,
                        vx: Number(instruction?.vx) || 0,
                        vy: Number(instruction?.vy) || 0,
                        vz: Number.isFinite(bulletVz) ? bulletVz : -0.1,
                        life: bulletLifeTicks,
                        color: Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                        team: 'enemy',
                        modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                    });
                };

                if (patternRegistry && typeof patternRegistry.firePattern === 'function') {
                    const spawns = patternRegistry.firePattern(
                        chosenPattern,
                        {
                            timeSeconds: encounterElapsedMs / 1000,
                            source: { x: cx, y: cy },
                            target: { x: p.worldPos.x, y: p.worldPos.y },
                            player: { x: p.worldPos.x, y: p.worldPos.y },
                            mapSize: getMapSize(),
                            randomFloat
                        }
                    );
                    schedulePatternSpawns(spawns, spawnFromInstruction);
                } else {
                    spawnFromInstruction({ x: cx, y: cy, vx: 0, vy: Number(pressure.bulletSpeed) || 3.5 });
                }
            }, Math.max(40, Number.parseInt(pressure.intervalMs, 10) || 120)));
        }

        function runPlayerAbilityCast(payloadAbility) {
            const castActions = Array.isArray(payloadAbility?.castActions) ? payloadAbility.castActions : [];
            const player = playerRuntime?.getState?.();
            const source = player?.worldPos ? { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 } : { x: 0, y: 0 };
            const target = player?.aimWorld ? { x: Number(player.aimWorld.x) || source.x, y: Number(player.aimWorld.y) || source.y } : source;
            for (const action of castActions) {
                const type = String(action?.type || '').toLowerCase();
                if (type === 'spawn_pattern' || type === 'fire_pattern_player') {
                    const pattern = (action?.pattern && typeof action.pattern === 'object') ? action.pattern : null;
                    if (!pattern) continue;
                    const spawns = window.TDSPatternRegistry?.firePattern?.(
                        {
                            ...pattern,
                            source: { type: 'fixed_point', x: source.x, y: source.y },
                            aim: (pattern?.aim && typeof pattern.aim === 'object') ? pattern.aim : { type: 'toward_cursor' }
                        },
                        {
                            timeSeconds: encounterElapsedMs / 1000,
                            source,
                            target,
                            player: source,
                            mapSize: getMapSize(),
                            randomFloat
                        }
                    );
                    schedulePatternSpawns(spawns, (instruction) => {
                        spawnBullet({
                            projectileType: String(action?.projectileType || pattern?.projectileType || 'player_default_bullet'),
                            x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                            y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                            z: 20,
                            vx: Number(instruction?.vx) || 0,
                            vy: Number(instruction?.vy) || 0,
                            vz: 0,
                            life: Number(action?.lifeTicks) || 120,
                            team: 'player',
                            modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                        });
                    });
                    continue;
                }
                if (type === 'clear_enemy_bullets' || type === 'dash_reset_field') {
                    const radius = Math.max(20, Number(action?.radius) || 260);
                    let cleared = 0;
                    entities.forEachBullet((b, i) => {
                        if (!b || b.team !== 'enemy') return;
                        const dx = (Number(b.x) || 0) - source.x;
                        const dy = (Number(b.y) || 0) - source.y;
                        if ((dx * dx) + (dy * dy) > (radius * radius)) return;
                        try { bloomLayer.removeChild(b.sprite); } catch (_) {}
                        entities.removeBulletAt(i);
                        cleared += 1;
                    });
                    if (cleared > 0) {
                        spawnSimpleShockwave(source.x, source.y, 0x8fd8ff, Math.max(16, radius * 0.12), 280);
                        feedbackCounters.bulletClearShockwave += 1;
                        emitFeedback('bullet_clear_shockwave', { cleared });
                    }
                    continue;
                }
                if (type === 'mitigation_window' || type === 'aegis_window') {
                    playerRuntime?.applyMitigationWindow?.(Math.max(0.1, Number(action?.durationSeconds) || 1.2));
                    continue;
                }
                if (type === 'dash_cooldown_reset') {
                    playerRuntime?.resetAbilityCooldown?.('dash');
                }
            }
        }

        function clearPatterns() {
            for (const id of patternIntervals) {
                try { clearInterval(id); } catch (_) {}
            }
            patternIntervals.length = 0;
            delayedPatternSpawns.splice(0, delayedPatternSpawns.length);
        }

        function schedulePatternSpawns(spawns, spawnFromInstruction) {
            if (!Array.isArray(spawns) || typeof spawnFromInstruction !== 'function') return;
            for (const spawn of spawns) {
                const delaySeconds = Math.max(0, Number(spawn?.delaySeconds) || 0);
                if (delaySeconds <= 0.0001) {
                    spawnFromInstruction(spawn);
                } else {
                    delayedPatternSpawns.push({
                        dueMs: encounterElapsedMs + (delaySeconds * 1000),
                        execute: () => spawnFromInstruction(spawn)
                    });
                }
            }
        }

        function flushDuePatternSpawns() {
            if (delayedPatternSpawns.length === 0) return;
            for (let i = delayedPatternSpawns.length - 1; i >= 0; i -= 1) {
                const item = delayedPatternSpawns[i];
                if (!item || encounterElapsedMs < (Number(item.dueMs) || 0)) continue;
                delayedPatternSpawns.splice(i, 1);
                try { item.execute?.(); } catch (_) {}
            }
        }

        function update(deltaTime = 1) {
            if (phase !== PHASES.PLAYING) return;
            let dtMs = (Number(deltaTime) || 1) * 16.6667;
            if (microHitStopMsRemaining > 0) {
                const consume = Math.min(microHitStopMsRemaining, dtMs);
                microHitStopMsRemaining = Math.max(0, microHitStopMsRemaining - consume);
                dtMs = Math.max(0, dtMs - consume);
            }
            if (dtMs <= 0) return;
            encounterElapsedMs += dtMs;
            updateStatuses(dtMs);
            updateArenaModifiers(dtMs);
            const budgets = getBudgets();
            if (encounterElapsedMs >= (Math.max(1, budgets.maxEncounterSeconds) * 1000)) {
                setPhase(PHASES.WON, { reason: 'budget_max_encounter_seconds' });
                clearPatterns();
                return;
            }
            const viewport = { x: gameLayer.x, y: gameLayer.y };
            playerRuntime.update(dtMs, viewport, toWorld);
            const playerState = playerRuntime.getState();
            for (const ability of (Array.isArray(playerState?.abilities) ? playerState.abilities : [])) {
                const key = String(ability?.key || '').toLowerCase();
                if (!key) continue;
                const ready = (Number(ability?.cooldownRemaining) || 0) <= 0 && (Number(ability?.charges) || 0) > 0;
                if (ready && !abilityReadyLastState[key]) {
                    const p = playerState?.worldPos || { x: 0, y: 0 };
                    spawnSimpleShockwave(Number(p.x) || 0, Number(p.y) || 0, 0xffef9a, 10, 180);
                    feedbackCounters.abilityReadyPulse += 1;
                    emitFeedback('ability_ready_pulse', { key });
                }
                abilityReadyLastState[key] = ready;
            }
            const arenaPolicy = applyPointPolicy({ x: playerState?.worldPos?.x || 0, y: playerState?.worldPos?.y || 0, entityType: 'player', radius: 12 });
            if (arenaPolicy?.outside && !arenaBoundaryState.playerOutside) {
                arenaBoundaryState.playerOutside = true;
                pushArenaEvent('arena_edge_entered', { entityType: 'player' });
            } else if (!arenaPolicy?.outside) {
                arenaBoundaryState.playerOutside = false;
            }
            if (arenaPolicy?.outside && arenaPolicy?.bounds === 'damage') {
                if (encounterElapsedMs >= Number(arenaBoundaryState.playerNextDamageMs || 0)) {
                    const damagePerSecond = Math.max(0.5, Number(arenaPolicy?.effects?.edgeDamagePerSecond) || 2.8);
                    const dmg = damagePerSecond * 0.25;
                    const took = playerRuntime.tryDamage(dmg);
                    if (took) pushArenaEvent('arena_edge_damaged', { entityType: 'player', damage: dmg });
                    arenaBoundaryState.playerNextDamageMs = encounterElapsedMs + 250;
                }
            }
            const effectsNow = arenaPolicy?.effects || getArenaEffectsState();
            if ((Math.abs(Number(effectsNow?.wind?.x) || 0) + Math.abs(Number(effectsNow?.wind?.y) || 0)) > 0.01) {
                const windScale = (dtMs / 1000) * 0.08;
                playerRuntime.applyExternalForce({
                    x: (Number(effectsNow.wind.x) || 0) * windScale,
                    y: (Number(effectsNow.wind.y) || 0) * windScale
                });
            }
            if (effectsNow?.mud === true) {
                playerRuntime.applyExternalForce({
                    x: -Number(playerState?.worldPos?.x || 0) * 0.00035,
                    y: -Number(playerState?.worldPos?.y || 0) * 0.00035
                });
            }
            enemyRuntime?.update?.(dtMs);
            for (let i = activeTelegraphs.length - 1; i >= 0; i -= 1) {
                const t = activeTelegraphs[i];
                if (!t || !t.sprite) continue;
                const elapsed = Math.max(0, encounterElapsedMs - (Number(t.bornMs) || 0));
                const ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, Number(t.durationMs) || 1)));
                t.sprite.alpha = 0.2 + (ratio * 0.65);
                if (elapsed >= (Number(t.durationMs) || 0)) {
                    if (t.sprite.parent) t.sprite.parent.removeChild(t.sprite);
                    activeTelegraphs.splice(i, 1);
                    try { t.onComplete?.(); } catch (_) {}
                }
            }
            const hazards = encounter?.runtimeCollections?.hazards;
            if (Array.isArray(hazards)) {
                for (let i = hazards.length - 1; i >= 0; i -= 1) {
                    const hazard = hazards[i];
                    const growthPerSecond = Number(hazard?.growthPerSecond) || 0;
                    if (growthPerSecond !== 0) {
                        const nextRadius = Math.max(6, (Number(hazard.radius) || 90) + (growthPerSecond * (dtMs / 1000)));
                        hazard.radius = nextRadius;
                        hazard.width = Math.max(6, (Number(hazard.width) || nextRadius * 2) + (growthPerSecond * (dtMs / 1000) * 1.5));
                        hazard.length = Math.max(6, (Number(hazard.length) || hazard.width) + (growthPerSecond * (dtMs / 1000) * 1.5));
                        drawHazardSprite(hazard.sprite, hazard);
                    }
                    applyHazardEffectToPlayer(hazard, playerState);
                    if (encounterElapsedMs < Number(hazard?.expiresMs || 0)) continue;
                    if (hazard?.sprite?.parent) hazard.sprite.parent.removeChild(hazard.sprite);
                    hazards.splice(i, 1);
                }
            }
            const objects = encounter?.runtimeCollections?.objects;
            if (Array.isArray(objects)) {
                for (let i = objects.length - 1; i >= 0; i -= 1) {
                    const object = objects[i];
                    if (!object || object.status === 'destroyed') {
                        if (object?.sprite?.parent) object.sprite.parent.removeChild(object.sprite);
                        objects.splice(i, 1);
                        continue;
                    }
                    objectSnapshots[object.id] = {
                        id: object.id,
                        type: object.type,
                        hp: Number(object.hp) || 0,
                        maxHp: Number(object.maxHp) || 1,
                        x: Number(object.x) || 0,
                        y: Number(object.y) || 0,
                        radius: Number(object.radius) || 1
                    };
                    if (object.capture === true || object.type === 'capture_point' || object.type === 'capture_zone') {
                        const dx = (Number(playerState?.worldPos?.x) || 0) - (Number(object.x) || 0);
                        const dy = (Number(playerState?.worldPos?.y) || 0) - (Number(object.y) || 0);
                        const inside = ((dx * dx) + (dy * dy)) <= Math.pow(Math.max(4, Number(object.radius) || 24), 2);
                        updateZoneState(object.id, inside);
                    }
                }
            }
            const pickups = encounter?.runtimeCollections?.pickups;
            if (Array.isArray(pickups)) {
                for (let i = pickups.length - 1; i >= 0; i -= 1) {
                    const item = pickups[i];
                    if (!item) continue;
                    const iso = toIso(Number(item.x) || 0, Number(item.y) || 0, 0);
                    if (item.sprite) {
                        item.sprite.x = iso.x;
                        item.sprite.y = iso.y;
                        item.sprite.alpha = 0.65 + (Math.sin((encounterElapsedMs + (i * 120)) / 220) * 0.2);
                    }
                    const dx = (Number(playerState?.worldPos?.x) || 0) - (Number(item.x) || 0);
                    const dy = (Number(playerState?.worldPos?.y) || 0) - (Number(item.y) || 0);
                    const r = Math.max(4, Number(item.radius) || 12) + 10;
                    if (((dx * dx) + (dy * dy)) <= (r * r)) {
                        collectPickup(item);
                        if (item?.sprite?.parent) item.sprite.parent.removeChild(item.sprite);
                        pickups.splice(i, 1);
                        continue;
                    }
                    if (encounterElapsedMs >= Number(item.expiresMs || 0)) {
                        if (item?.sprite?.parent) item.sprite.parent.removeChild(item.sprite);
                        pickups.splice(i, 1);
                    }
                }
            }
            for (let i = activeEmitters.length - 1; i >= 0; i -= 1) {
                const emitter = activeEmitters[i];
                if (!emitter || emitter.stopped) {
                    removeEmitterAt(i);
                    continue;
                }
                const ageMs = encounterElapsedMs - Number(emitter.bornMs || 0);
                if (ageMs >= Number(emitter.durationMs || 0)) {
                    emitter.stopped = true;
                    removeEmitterAt(i);
                    continue;
                }
                updateEmitterMovement(emitter, dtMs);
                if (emitter.paused) continue;
                if (encounterElapsedMs < Number(emitter.nextFireMs || 0)) continue;
                if (!canRunAction()) continue;
                fireEmitter(emitter, { elapsedMs: encounterElapsedMs });
                emitter.nextFireMs = encounterElapsedMs + Math.max(50, Number(emitter.intervalMs) || 1000);
            }
            if (Array.isArray(encounter?.runtimeCollections?.emitters)) {
                encounter.runtimeCollections.emitters = activeEmitters.slice();
            }
            flushDuePatternSpawns();
            const pIso = toIso(playerState.worldPos.x, playerState.worldPos.y);
            const size = getLogicalSize();

            const zoom = Math.max(0.6, Math.min(1.5, Number(effectsNow?.cameraZoom) || 1));
            worldContainer.scale.set(zoom);
            const targetX = (size.width / 2) - (pIso.x * zoom);
            const targetY = (size.height / 2) - (pIso.y * zoom);
            camera.x += (targetX - camera.x) * 0.12;
            camera.y += (targetY - camera.y) * 0.12;
            gameLayer.x = camera.x;
            gameLayer.y = camera.y;
            telegraphLayer.x = camera.x;
            telegraphLayer.y = camera.y;
            bloomLayer.x = camera.x;
            bloomLayer.y = camera.y;

            entities.forEachBullet((b, i) => {
                window.TDSPatternRegistry?.applyModifiers?.(b, dtMs, {
                    player: playerState?.worldPos || null,
                    timeSeconds: encounterElapsedMs / 1000
                });
                b.ageMs = (Number(b.ageMs) || 0) + dtMs;
                b.x += b.vx * (dtMs / 16.6667);
                b.y += b.vy * (dtMs / 16.6667);
                b.z += b.vz * (dtMs / 16.6667);
                b.life -= (dtMs / 16.6667);
                const bulletArena = getArenaEffectsState();
                if (bulletArena.bulletWrap === true) {
                    const edge = Math.max(120, getMapSize() * Math.max(0.2, Number(bulletArena.sizeScale) || 1));
                    if (b.x < -edge) b.x = edge;
                    else if (b.x > edge) b.x = -edge;
                    if (b.y < -edge) b.y = edge;
                    else if (b.y > edge) b.y = -edge;
                }
                const iso = toIso(b.x, b.y, b.z);
                b.sprite.x = iso.x;
                b.sprite.y = iso.y;
                if (Number.isFinite(Number(b.visualColor))) b.sprite.tint = Number(b.visualColor);
                if (Number.isFinite(Number(b.visualAlpha))) b.sprite.alpha = Math.max(0.05, Math.min(1, Number(b.visualAlpha)));
                if (Number.isFinite(Number(b.visualScaleMultiplier))) {
                    const mul = Math.max(0.1, Number(b.visualScaleMultiplier));
                    b.sprite.scale.set(mul);
                }
                if (Number.isFinite(Number(b.visualSpin))) b.sprite.rotation += Number(b.visualSpin);
                const rotationMode = String(b?.render?.rotationMode || 'fixed').toLowerCase();
                if (rotationMode === 'velocity') {
                    b.sprite.rotation = Math.atan2(Number(b.vy) || 0, Number(b.vx) || 0);
                } else if (rotationMode === 'spin') {
                    b.sprite.rotation += 0.1 * (dtMs / 16.6667);
                }
                if (Array.isArray(b._spawnRequests) && b._spawnRequests.length > 0) {
                    const requests = b._spawnRequests.splice(0, b._spawnRequests.length);
                    for (const req of requests) {
                        spawnBullet({
                            projectileType: String(req?.projectileType || b.projectileType || ''),
                            x: Number(req?.x) || b.x,
                            y: Number(req?.y) || b.y,
                            z: Number.isFinite(Number(req?.z)) ? Number(req.z) : b.z,
                            vx: Number(req?.vx) || 0,
                            vy: Number(req?.vy) || 0,
                            team: String(req?.team || b.team || 'enemy'),
                            modifiers: Array.isArray(req?.modifiers) ? req.modifiers : []
                        });
                    }
                }
                if (b.life <= 0) {
                    bloomLayer.removeChild(b.sprite);
                    entities.removeBulletAt(i);
                    return;
                }
                const activeAfterMs = Math.max(0, Number(b?.collision?.activeAfterSeconds) || 0) * 1000;
                if (Number(b.ageMs) < activeAfterMs) return;
                const hitCooldownMs = Math.max(0, Number(b?.collision?.hitCooldownByTarget) || 0) * 1000;
                const nowTs = Date.now();
                const canHitTarget = (targetId) => {
                    if (!targetId) return true;
                    const last = Number(b?.hitTargetTs?.[targetId]) || 0;
                    return (nowTs - last) >= hitCooldownMs;
                };
                const markHitTarget = (targetId) => {
                    if (!targetId) return;
                    b.hitTargetTs[targetId] = nowTs;
                };
                const consumeOnHit = () => {
                    if (b?.collision?.destroyOnHit === false) return false;
                    if (Number(b.remainingPierce) > 0) {
                        b.remainingPierce -= 1;
                        return false;
                    }
                    return true;
                };
                if (b.team === 'enemy') {
                    const dx = b.x - playerState.worldPos.x;
                    const dy = b.y - playerState.worldPos.y;
                    if (((dx * dx) + (dy * dy)) < 260 && Math.abs(b.z) < 28) {
                        if (canHitTarget('player')) {
                            const incoming = getPlayerStatusScalars();
                            const hit = playerRuntime.tryDamage(Math.max(0, Number(b.damage) || 1) * Math.max(0, Number(incoming.incomingDamage) || 1));
                            if (hit) {
                                feedbackCounters.hitFlash += 1;
                                emitFeedback('player_hit_flash', { source: 'enemy_bullet' });
                                if (getRuntimeSettings().enableMicroHitStop) microHitStopMsRemaining = Math.max(microHitStopMsRemaining, 26);
                                spawnDamageNumber(playerState.worldPos.x, playerState.worldPos.y, '-' + Math.max(1, Math.round(Number(b.damage) || 1)), 0xff8f8f);
                                markHitTarget('player');
                                if (consumeOnHit()) {
                                    bloomLayer.removeChild(b.sprite);
                                    entities.removeBulletAt(i);
                                }
                                shakePower = 14;
                            }
                        }
                    }
                    return;
                }

                if (b.team === 'player') {
                    const aliveEnemies = enemyRuntime?.getAliveEnemies?.() || [];
                    const playerScalars = getPlayerStatusScalars();
                    let consumedByHit = false;
                    for (let e = 0; e < aliveEnemies.length; e += 1) {
                        const enemy = aliveEnemies[e];
                        const dx = b.x - enemy.x;
                        const dy = b.y - enemy.y;
                        const r = (Number(enemy.radius) || 10) + (Number(b.radius) || 8);
                        if (((dx * dx) + (dy * dy)) <= (r * r)) {
                            if (!canHitTarget(enemy.id)) continue;
                            const outgoingDamage = Math.max(0, Number(b.damage) || 1) * Math.max(0, Number(playerScalars.outgoingDamage) || 1);
                            const result = enemyRuntime.applyDamage(enemy, outgoingDamage);
                            markHitTarget(enemy.id);
                            if (result?.defeated) {
                                defeatedEnemies += 1;
                                const enemyTypeId = String(result.enemyTypeId || 'unknown');
                                defeatedByType[enemyTypeId] = (Number(defeatedByType[enemyTypeId]) || 0) + 1;
                                logEvent('enemy_defeated', {
                                    enemyTypeId,
                                    enemyId: result?.enemyId || enemy?.id || null,
                                    isBoss: result?.isBoss === true,
                                    bossId: result?.enemy?.data?.bossId || null
                                });
                                maybeSpawnPickupDrops(result?.enemy || enemy);
                                delete enemyStatusById[String(enemy?.id || '')];
                                spawnSimpleShockwave(enemy.x, enemy.y, 0xffa6d4, 22, 260);
                                feedbackCounters.deathBurst += 1;
                                emitFeedback('enemy_death_burst', { enemyTypeId });
                            }
                            if (Array.isArray(result?.events) && result.events.length > 0) {
                                for (const evt of result.events) {
                                    logEvent(String(evt?.type || 'enemy_event'), evt && typeof evt === 'object' ? evt : {});
                                }
                            }
                            if (consumeOnHit()) {
                                bloomLayer.removeChild(b.sprite);
                                entities.removeBulletAt(i);
                                consumedByHit = true;
                            }
                            break;
                        }
                    }
                    if (consumedByHit) return;
                    const objects = encounter?.runtimeCollections?.objects;
                    if (Array.isArray(objects)) {
                        for (let o = 0; o < objects.length; o += 1) {
                            const obj = objects[o];
                            if (!obj || obj.status !== 'alive') continue;
                            const dx = (Number(b.x) || 0) - (Number(obj.x) || 0);
                            const dy = (Number(b.y) || 0) - (Number(obj.y) || 0);
                            const r = (Number(obj.radius) || 8) + (Number(b.radius) || 8);
                            if (((dx * dx) + (dy * dy)) > (r * r)) continue;
                            if (!canHitTarget('object:' + obj.id)) continue;
                            markHitTarget('object:' + obj.id);
                            const outgoingDamage = Math.max(0, Number(b.damage) || 1) * Math.max(0, Number(playerScalars.outgoingDamage) || 1);
                            damageObjectById(obj.id, outgoingDamage);
                            if (consumeOnHit()) {
                                bloomLayer.removeChild(b.sprite);
                                entities.removeBulletAt(i);
                            }
                            break;
                        }
                    }
                }
            });

            const aliveEnemies = enemyRuntime?.getAliveEnemies?.() || [];
            if (pendingObjectActions.length > 0) {
                const objectActions = pendingObjectActions.splice(0, pendingObjectActions.length);
                for (const action of objectActions) {
                    if (!action || typeof action !== 'object') continue;
                    runBossAction(action, { elapsedMs: encounterElapsedMs });
                }
            }
            const pendingBossActions = enemyRuntime?.consumeBossActions?.() || [];
            for (const item of pendingBossActions) {
                const action = item?.action;
                if (!action || typeof action !== 'object') continue;
                runBossAction(action, { elapsedMs: encounterElapsedMs });
            }
            bossState = enemyRuntime?.getPrimaryBossState?.() || null;
            const phaseIdNow = String(bossState?.phaseId || '');
            if (phaseIdNow && phaseIdNow !== lastBossPhaseId) {
                const p = playerState?.worldPos || { x: 0, y: 0 };
                spawnSimpleShockwave(Number(p.x) || 0, Number(p.y) || 0, 0xffcc7a, 26, 340);
                feedbackCounters.bossPhaseBurst += 1;
                emitFeedback('boss_phase_burst', { phaseId: phaseIdNow });
                if (getRuntimeSettings().enableMicroHitStop) microHitStopMsRemaining = Math.max(microHitStopMsRemaining, 44);
                lastBossPhaseId = phaseIdNow;
            }
            if (sequenceRunner) {
                sequenceRunner.tick({
                    elapsedMs: encounterElapsedMs,
                    aliveEnemies: aliveEnemies.length,
                    hazardCount: countByCollection('hazards'),
                    pickupCount: countByCollection('pickups'),
                    playerHp: playerState.hp,
                    playerMaxHp: playerState.maxHp,
                    defeatedEnemies,
                    defeatedByType,
                    bossState,
                    objectives: sortedObjectivesSnapshot(),
                    destroyedObjects,
                    objectSnapshots,
                    zoneState,
                    playerRecentEvents,
                    playerStatuses: getPlayerStatusSnapshot(),
                    statusRecentEvents,
                    pickupRecentEvents,
                    pickupCollectedCounts
                });
                encounterPhaseId = sequenceRunner.getState?.().activePhaseId || encounterPhaseId;
            }
            try {
                audioController?.processIntensityRules?.({
                    elapsedMs: encounterElapsedMs,
                    aliveEnemies: aliveEnemies.length,
                    playerHp: playerState?.hp,
                    playerMaxHp: playerState?.maxHp,
                    bossState,
                    objectives: sortedObjectivesSnapshot()
                });
            } catch (_) {}

            const objectiveResolution = updateObjectives(playerState);
            const shouldLoseFromPlayerDeath = !!playerState?.dead;
            const shouldLoseFromObjectives = !!objectiveResolution?.requiredFailed;
            const shouldWinFromObjectives = !!objectiveResolution?.requiredCompleted;
            if (shouldLoseFromPlayerDeath) {
                setPhase(PHASES.LOST, { reason: 'player_dead' });
                clearPatterns();
                return;
            }
            if (shouldLoseFromObjectives) {
                setPhase(PHASES.LOST, { reason: 'objective_failed' });
                clearPatterns();
                return;
            }
            if (shouldWinFromObjectives) {
                setPhase(PHASES.WON, { reason: 'objectives_completed' });
                clearPatterns();
                return;
            }
            if (explicitWinRequested) {
                setPhase(PHASES.WON, { reason: 'sequence_win' });
                clearPatterns();
                return;
            }

            if (shakePower > 0) {
                worldContainer.x = (randomFloat() - 0.5) * shakePower;
                worldContainer.y = (randomFloat() - 0.5) * shakePower;
                shakePower *= 0.86;
            } else {
                worldContainer.x = 0;
                worldContainer.y = 0;
            }

            for (let i = 0; i < dustLayer.children.length; i += 1) {
                const d = dustLayer.children[i];
                d.y -= ((i % 8) + 2) * 0.05;
                if (d.y < -20) d.y = size.height + 20;
            }

        }

        function resolveRootLayer() {
            return (
                pixi.getLayer?.('takeover')
                || pixi.getLayer?.('fx')
                || pixi.getLayer?.('world')
                || pixi.getLayer?.('stage')
                || pixi.getLayer?.()
                || null
            );
        }

        function buildLayerTree() {
            const rootLayer = resolveRootLayer();
            if (!rootLayer?.addChild) {
                throw new Error('No VN Pixi layer available for combat runtime.');
            }
            worldContainer = new PIXI.Container();
            dustLayer = new PIXI.Container();
            gameLayer = new PIXI.Container();
            telegraphLayer = new PIXI.Container();
            bloomLayer = new PIXI.Container();
            worldContainer.addChild(dustLayer);
            worldContainer.addChild(gameLayer);
            worldContainer.addChild(telegraphLayer);
            worldContainer.addChild(bloomLayer);
            rootLayer.addChild(worldContainer);
            createDust();
            createBackground();
        }

        function normalizeEncounterId(value) {
            if (typeof value !== 'string') return '';
            const trimmed = value.trim();
            return trimmed || '';
        }

        function isEncounterDefinitionCandidate(value) {
            return !!value && typeof value === 'object' && !Array.isArray(value);
        }

        function loadEncounterResultById(loader, encounterId) {
            const result = (typeof loader.loadEncounterResult === 'function')
                ? loader.loadEncounterResult(encounterId)
                : { ok: true, encounter: loader.loadEncounter(encounterId), warnings: [], errors: [] };
            return {
                ok: result?.ok !== false,
                encounter: result?.encounter || null,
                warnings: Array.isArray(result?.warnings) ? result.warnings.slice() : [],
                errors: Array.isArray(result?.errors) ? result.errors.slice() : [],
                requestedId: normalizeEncounterId(result?.requestedId || encounterId || ''),
                resolvedId: normalizeEncounterId(result?.resolvedId || ''),
                usedDefaultFallback: result?.usedDefaultFallback === true
            };
        }

        function loadEncounterDefinitionResult(loader, encounterDefinition, validationOptions = null) {
            const schema = window.TDSEncounterSchema;
            if (typeof loader.loadEncounterDefinitionResult === 'function') {
                const result = loader.loadEncounterDefinitionResult(encounterDefinition, validationOptions);
                return {
                    ok: result?.ok !== false,
                    encounter: result?.encounter || null,
                    warnings: Array.isArray(result?.warnings) ? result.warnings.slice() : [],
                    errors: Array.isArray(result?.errors) ? result.errors.slice() : [],
                    requestedId: normalizeEncounterId(result?.requestedId || ''),
                    resolvedId: normalizeEncounterId(result?.resolvedId || ''),
                    usedDefaultFallback: result?.usedDefaultFallback === true
                };
            }
            if (!schema || typeof schema.validateEncounterDefinition !== 'function') {
                return {
                    ok: false,
                    encounter: null,
                    warnings: [],
                    errors: ['Encounter schema validator is unavailable for inline encounterDefinition.'],
                    requestedId: '',
                    resolvedId: '',
                    usedDefaultFallback: false
                };
            }
            const result = schema.validateEncounterDefinition(encounterDefinition, validationOptions);
            return {
                ok: result?.ok !== false,
                encounter: result?.encounter || null,
                warnings: Array.isArray(result?.warnings) ? result.warnings.slice() : [],
                errors: Array.isArray(result?.errors) ? result.errors.slice() : [],
                requestedId: '',
                resolvedId: '',
                usedDefaultFallback: false
            };
        }

        function resolveEncounterLoadResult(loader) {
            const requestedId = normalizeEncounterId(payload?.encounterId || '');
            const requestedDefinition = isEncounterDefinitionCandidate(payload?.encounterDefinition) ? payload.encounterDefinition : null;
            const sourceHint = String(payload?.encounterSource || '').trim();
            const diagnostics = {
                requestedEncounterId: requestedId || null,
                sourceHint: sourceHint || null,
                requestedDefinition: requestedDefinition ? true : false,
                selectedSource: 'default',
                usedFallback: false,
                fallbackReason: null
            };

            const finalize = (selection, source) => {
                const next = selection || {};
                const warnings = Array.isArray(next.warnings) ? next.warnings.slice() : [];
                const errors = Array.isArray(next.errors) ? next.errors.slice() : [];
                diagnostics.selectedSource = String(source || 'default');
                return {
                    encounter: next.encounter || null,
                    warnings,
                    errors,
                    requestedId: normalizeEncounterId(next.requestedId || requestedId || ''),
                    resolvedId: normalizeEncounterId(next.resolvedId || next.encounter?.id || ''),
                    warningText: '',
                    diagnostics
                };
            };

            const fallbackToDefault = (reason, prependWarnings = [], prependErrors = []) => {
                const fallback = loadEncounterResultById(loader, DEFAULT_ENCOUNTER_ID);
                const warnings = Array.isArray(prependWarnings) ? prependWarnings.slice() : [];
                const errors = Array.isArray(prependErrors) ? prependErrors.slice() : [];
                warnings.push(...(Array.isArray(fallback.warnings) ? fallback.warnings : []));
                errors.push(...(Array.isArray(fallback.errors) ? fallback.errors : []));
                diagnostics.selectedSource = 'default';
                diagnostics.usedFallback = true;
                diagnostics.fallbackReason = String(reason || 'fallback_to_default');
                let warningText = 'Encounter data fallback: loaded default encounter.';
                if (reason === 'invalid_encounter_definition') {
                    warningText = 'Encounter definition was invalid. Loaded default encounter.';
                } else if (reason === 'unknown_encounter_id') {
                    warningText = requestedId
                        ? ('Encounter "' + requestedId + '" was not found. Loaded default encounter.')
                        : 'Encounter id was missing. Loaded default encounter.';
                } else if (reason === 'invalid_encounter_id_data') {
                    warningText = requestedId
                        ? ('Encounter "' + requestedId + '" failed validation. Loaded default encounter.')
                        : 'Encounter failed validation. Loaded default encounter.';
                }
                return {
                    encounter: fallback.encounter || null,
                    warnings,
                    errors,
                    requestedId: requestedId || null,
                    resolvedId: normalizeEncounterId(fallback.resolvedId || fallback.encounter?.id || DEFAULT_ENCOUNTER_ID),
                    warningText,
                    diagnostics
                };
            };

            if (requestedDefinition) {
                const strictV1 = sourceHint === 'generated_encounter_script' || sourceHint === 'generated_encounter_facade';
                const selection = loadEncounterDefinitionResult(loader, requestedDefinition, strictV1 ? {
                    capabilityProfile: 'v1',
                    strictCapabilities: true
                } : null);
                if (selection.ok && selection.encounter && Array.isArray(selection.errors) && selection.errors.length === 0) {
                    const result = finalize(selection, 'definition');
                    result.resolvedId = normalizeEncounterId(selection.encounter?.id || selection.resolvedId || requestedId || 'inline_definition');
                    return result;
                }
                return fallbackToDefault('invalid_encounter_definition', selection.warnings, selection.errors);
            }

            if (requestedId) {
                const selection = loadEncounterResultById(loader, requestedId);
                const hasErrors = Array.isArray(selection.errors) && selection.errors.length > 0;
                if (selection.usedDefaultFallback && normalizeEncounterId(selection.resolvedId) !== requestedId) {
                    return fallbackToDefault('unknown_encounter_id', selection.warnings, selection.errors);
                }
                if (!selection.ok || hasErrors || !selection.encounter) {
                    return fallbackToDefault('invalid_encounter_id_data', selection.warnings, selection.errors);
                }
                return finalize(selection, 'id');
            }

            return finalize(loadEncounterResultById(loader, DEFAULT_ENCOUNTER_ID), 'default');
        }

        async function start(resetSession = true) {
            if (phase === PHASES.PLAYING || phase === PHASES.LOADING) return;
            if (phase !== PHASES.MENU) {
                // Ensure no previous tickers/intervals survive restarts from LOST/WON.
                cleanupWorld();
                setPhase(PHASES.MENU);
            }
            if (resetSession) resetResultStats();
            setPhase(PHASES.LOADING);
            const loader = window.TDSEncounterLoader;
            if (!loader || typeof loader.loadEncounter !== 'function') {
                throw new Error('TDSEncounterLoader is unavailable.');
            }
            const encounterSelection = resolveEncounterLoadResult(loader);
            encounter = encounterSelection?.encounter || loader.loadEncounter(DEFAULT_ENCOUNTER_ID);
            validationWarnings = Array.isArray(encounterSelection?.warnings) ? encounterSelection.warnings.slice() : [];
            validationErrors = Array.isArray(encounterSelection?.errors) ? encounterSelection.errors.slice() : [];
            requestedEncounterId = normalizeEncounterId(encounterSelection?.requestedId || payload?.encounterId || '') || null;
            selectedEncounterId = normalizeEncounterId(encounterSelection?.resolvedId || encounter?.id || DEFAULT_ENCOUNTER_ID) || DEFAULT_ENCOUNTER_ID;
            encounterSource = String(encounterSelection?.diagnostics?.selectedSource || 'default');
            encounterLoadWarning = String(encounterSelection?.warningText || '').trim();
            encounterLoadDiagnostics = encounterSelection?.diagnostics && typeof encounterSelection.diagnostics === 'object'
                ? { ...encounterSelection.diagnostics }
                : null;
            encounter.runtimeCollections = encounter.runtimeCollections || {};
            if (!Array.isArray(encounter.runtimeCollections.emitters)) encounter.runtimeCollections.emitters = [];
            if (!Array.isArray(encounter.runtimeCollections.hazards)) encounter.runtimeCollections.hazards = [];
            if (!Array.isArray(encounter.runtimeCollections.objects)) encounter.runtimeCollections.objects = [];
            if (!Array.isArray(encounter.runtimeCollections.pickups)) encounter.runtimeCollections.pickups = [];
            schemaVersion = Number(encounter?.schemaVersion) || 1;
            encounterPhaseId = 'opening';
            encounterElapsedMs = 0;
            defeatedEnemies = 0;
            defeatedByType = {};
            bossState = null;
            lastBossPhaseId = '';
            bannerText = '';
            objectiveText = '';
            explicitWinRequested = false;
            eventLog.splice(0, eventLog.length);
            eventBus.clear();
            budgetWarnings.splice(0, budgetWarnings.length);
            recentHazardEvents.splice(0, recentHazardEvents.length);
            playerRecentEvents.splice(0, playerRecentEvents.length);
            statusRecentEvents.splice(0, statusRecentEvents.length);
            pickupRecentEvents.splice(0, pickupRecentEvents.length);
            pendingObjectActions.splice(0, pendingObjectActions.length);
            clearArenaModifiers('restart');
            arenaRecentEvents.splice(0, arenaRecentEvents.length);
            feedbackRecentEvents.splice(0, feedbackRecentEvents.length);
            damageNumberSprites.splice(0, damageNumberSprites.length);
            feedbackCounters.hitFlash = 0;
            feedbackCounters.deathBurst = 0;
            feedbackCounters.bulletClearShockwave = 0;
            feedbackCounters.dashStreak = 0;
            feedbackCounters.abilityReadyPulse = 0;
            feedbackCounters.bossPhaseBurst = 0;
            microHitStopMsRemaining = 0;
            abilityReadyLastState = { q: false, e: false, r: false };
            enemySpawnGateState.blocked = false;
            enemySpawnGateState.untilMs = 0;
            arenaBoundaryState.playerOutside = false;
            arenaBoundaryState.playerNextDamageMs = 0;
            for (const key of Object.keys(playerStatuses)) delete playerStatuses[key];
            for (const key of Object.keys(enemyStatusById)) delete enemyStatusById[key];
            for (const key of Object.keys(objectStatusById)) delete objectStatusById[key];
            for (const key of Object.keys(pickupCollectedCounts)) delete pickupCollectedCounts[key];
            for (const key of Object.keys(destroyedObjects)) delete destroyedObjects[key];
            for (const key of Object.keys(objectSnapshots)) delete objectSnapshots[key];
            for (const key of Object.keys(zoneState)) delete zoneState[key];
            initializeObjectives();
            actionCounter.secondKey = nowSecondKey();
            actionCounter.count = 0;
            if (encounterLoadWarning) {
                logEvent('encounter_load_warning', {
                    warning: encounterLoadWarning,
                    requestedEncounterId,
                    selectedEncounterId,
                    encounterSource,
                    diagnostics: encounterLoadDiagnostics
                });
            }
            initializeRng();
            for (const modifier of (Array.isArray(encounter?.arena?.modifiers) ? encounter.arena.modifiers : [])) {
                if (!modifier || typeof modifier !== 'object') continue;
                addArenaModifier(modifier, 'encounter');
            }
            entities.clearBullets();
            buildLayerTree();
            input.setPointerMapper((event) => pixi.toLogicalPoint(event));
            input.bind();
            playerRuntime = window.TDSPlayerRuntime.create({
                PIXI,
                parentLayer: gameLayer,
                mapSize: getMapSize(),
                toIsometric: toIso,
                input,
                bridge,
                config: {
                    ...config,
                    PLAYER_HP: Number(encounter?.playerKit?.maxHp || encounter?.player?.hp) || config.PLAYER_HP,
                    PLAYER_SPEED: Number(encounter?.playerKit?.moveSpeed) || config.PLAYER_SPEED,
                    AUTO_ATTACK_INTERVAL_MS: Number(encounter?.playerKit?.autoAttack?.intervalMs) || config.AUTO_ATTACK_INTERVAL_MS,
                    PLAYER_PROJECTILE_SPEED: Number(encounter?.playerKit?.autoAttack?.projectileSpeed) || config.PLAYER_PROJECTILE_SPEED,
                    COLORS: {
                        ...config.COLORS,
                        PLAYER: Number(encounter?.colors?.player) || config.COLORS.PLAYER
                    }
                },
                playerKit: encounter?.playerKit || null,
                spriteSelection: payload?.combatPlayerSprite || null,
                arenaAdapter: {
                    applyPointPolicy
                },
                onFireProjectile: spawnBullet,
                onAbilityCast: runPlayerAbilityCast,
                onPlayerEvent: pushPlayerEvent
            });

            enemyRuntime = window.TDSEnemyRuntime?.create?.({
                PIXI,
                gameLayer,
                encounter,
                entities,
                toIsometric: toIso,
                playerStateProvider: () => playerRuntime.getState(),
                emitPattern: emitEnemyPattern,
                randomFloat,
                eventBus,
                mapSizeProvider: () => getMapSize(),
                budgetsProvider: () => getBudgets(),
                arenaAdapter: {
                    applyPointPolicy
                },
                renderPresetResolver: (group, key, template) => resolveRenderPreset(group, key, template)
            }) || null;
            audioController = window.TDSAudioController?.create?.({
                bridge,
                payload,
                encounter,
                randomFloat,
                logEvent: (type, data) => logEvent(type, data),
                onWarning: (message) => pushBudgetWarning(message)
            }) || null;

            sequenceRunner = window.TDSSequenceRunner?.create?.(encounter, {
                spawnEnemy: (action) => {
                    if (!canRunAction()) return;
                    if (enemySpawnGateState.blocked) return;
                    const alive = enemyRuntime?.getAliveEnemies?.().length || 0;
                    const maxEnemiesAlive = getBudgets().maxEnemiesAlive;
                    if (alive >= maxEnemiesAlive) {
                        pushBudgetWarning('Enemy budget reached; spawn action skipped.');
                        return;
                    }
                    enemyRuntime?.spawnFromAction?.(action);
                },
                firePattern: (action, runtimeState) => {
                    if (!canRunAction()) return;
                    const patternId = String(action?.pattern || '').trim();
                    if (!patternId) return;
                    const pattern = encounter?.patterns?.[patternId];
                    if (!pattern) {
                        pushBudgetWarning('Unknown pattern "' + patternId + '" in fire_pattern action.');
                        return;
                    }
                    const player = playerRuntime?.getState?.();
                    const playerPos = player?.worldPos
                        ? { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 }
                        : { x: 0, y: 0 };
                    const patternForAction = {
                        ...pattern,
                        source: (action?.source && typeof action.source === 'object') ? action.source : pattern?.source,
                        aim: (action?.aim && typeof action.aim === 'object') ? action.aim : pattern?.aim
                    };
                    const spawnFromInstruction = (instruction) => {
                        const projectileTypeId = String(pattern?.projectileType || 'enemy_default_bullet');
                        const projectileType = resolveProjectileType(projectileTypeId, 'enemy_default_bullet');
                        spawnBullet({
                            projectileType: projectileTypeId,
                            x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                            y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                            z: 20,
                            vx: Number(instruction?.vx) || 0,
                            vy: Number(instruction?.vy) || 0,
                            vz: Number.isFinite(Number(projectileType?.vz)) ? Number(projectileType.vz) : -0.05,
                            life: Number(projectileType?.lifeTicks) || 320,
                            color: Number(projectileType?.color) || Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                            team: String(projectileType?.team || 'enemy'),
                            radius: Number(projectileType?.radius) || 8,
                            damage: Math.max(0, Number(projectileType?.damage) || 1),
                            collision: projectileType?.collision || null,
                            render: projectileType?.render || null,
                            modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                        });
                    };
                    const spawns = window.TDSPatternRegistry?.firePattern?.(
                        patternForAction,
                        {
                            timeSeconds: (Number(runtimeState?.elapsedMs) || encounterElapsedMs) / 1000,
                            source: { x: 0, y: 0 },
                            target: playerPos,
                            player: playerPos,
                            mapSize: getMapSize(),
                            randomFloat
                        }
                    );
                    schedulePatternSpawns(spawns, spawnFromInstruction);
                },
                spawnTelegraph: (action) => {
                    if (!canRunAction()) return;
                    spawnTelegraph(action);
                },
                telegraphThenFire: (action, runtimeState) => {
                    if (!canRunAction()) return;
                    const patternId = String(action?.pattern || '').trim();
                    const pattern = encounter?.patterns?.[patternId];
                    if (!pattern) {
                        pushBudgetWarning('Unknown pattern "' + patternId + '" in telegraph_then_fire action.');
                        return;
                    }
                    spawnTelegraph(action, () => {
                        const player = playerRuntime?.getState?.();
                        const playerPos = player?.worldPos
                            ? { x: Number(player.worldPos.x) || 0, y: Number(player.worldPos.y) || 0 }
                            : { x: 0, y: 0 };
                        const patternForAction = {
                            ...pattern,
                            source: (action?.source && typeof action.source === 'object') ? action.source : pattern?.source,
                            aim: (action?.aim && typeof action.aim === 'object') ? action.aim : pattern?.aim
                        };
                        const spawns = window.TDSPatternRegistry?.firePattern?.(
                            patternForAction,
                            {
                                timeSeconds: (Number(runtimeState?.elapsedMs) || encounterElapsedMs) / 1000,
                                source: { x: 0, y: 0 },
                                target: playerPos,
                                player: playerPos,
                                mapSize: getMapSize(),
                                randomFloat
                            }
                        );
                        const projectileTypeId = String(pattern?.projectileType || 'enemy_default_bullet');
                        const projectileType = resolveProjectileType(projectileTypeId, 'enemy_default_bullet');
                        schedulePatternSpawns(spawns, (instruction) => {
                            spawnBullet({
                                projectileType: projectileTypeId,
                                x: Number(instruction?.x) + (Number(instruction?.xOffset) || 0),
                                y: Number(instruction?.y) + (Number(instruction?.yOffset) || 0),
                                z: 20,
                                vx: Number(instruction?.vx) || 0,
                                vy: Number(instruction?.vy) || 0,
                                vz: Number.isFinite(Number(projectileType?.vz)) ? Number(projectileType.vz) : -0.05,
                                life: Number(projectileType?.lifeTicks) || 320,
                                color: Number(projectileType?.color) || Number(encounter?.colors?.enemyBullet) || config.COLORS.BULLET_PRIMARY,
                                team: String(projectileType?.team || 'enemy'),
                                radius: Number(projectileType?.radius) || 8,
                                damage: Math.max(0, Number(projectileType?.damage) || 1),
                                collision: projectileType?.collision || null,
                                render: projectileType?.render || null,
                                modifiers: Array.isArray(instruction?.modifiers) ? instruction.modifiers : []
                            });
                        });
                    });
                },
                telegraphThenSpawnEnemy: (action) => {
                    if (!canRunAction()) return;
                    spawnTelegraph(action, () => {
                        const alive = enemyRuntime?.getAliveEnemies?.().length || 0;
                        if (alive >= getBudgets().maxEnemiesAlive) {
                            pushBudgetWarning('Enemy budget reached; telegraph spawn enemy skipped.');
                            return;
                        }
                        enemyRuntime?.spawnFromAction?.(action);
                    });
                },
                telegraphThenSpawnHazard: (action) => {
                    if (!canRunAction()) return;
                    spawnTelegraph(action, () => {
                        spawnEncounterHazard(action);
                    });
                },
                clearTelegraphs: () => clearTelegraphs(),
                spawnEmitter: (action) => {
                    if (!canRunAction()) return;
                    spawnEmitter(action);
                },
                stopEmitter: (action) => {
                    const id = emitterIdFromAction(action);
                    if (!id) return;
                    let found = false;
                    for (let i = activeEmitters.length - 1; i >= 0; i -= 1) {
                        if (String(activeEmitters[i]?.emitterId || '') !== id) continue;
                        found = true;
                        activeEmitters[i].stopped = true;
                        removeEmitterAt(i);
                    }
                    if (!found) pushBudgetWarning('stop_emitter target not found: "' + id + '".');
                },
                pauseEmitter: (action) => {
                    const id = emitterIdFromAction(action);
                    if (!id) return;
                    const emitter = activeEmitters.find((item) => String(item?.emitterId || '') === id);
                    if (!emitter) {
                        pushBudgetWarning('pause_emitter target not found: "' + id + '".');
                        return;
                    }
                    emitter.paused = true;
                },
                resumeEmitter: (action) => {
                    const id = emitterIdFromAction(action);
                    if (!id) return;
                    const emitter = activeEmitters.find((item) => String(item?.emitterId || '') === id);
                    if (!emitter) {
                        pushBudgetWarning('resume_emitter target not found: "' + id + '".');
                        return;
                    }
                    emitter.paused = false;
                    emitter.nextFireMs = Math.max(encounterElapsedMs + 25, Number(emitter.nextFireMs) || encounterElapsedMs);
                },
                clearEmitters: () => clearEmitters(),
                spawnHazard: (action) => {
                    if (!canRunAction()) return;
                    spawnEncounterHazard(action);
                },
                clearHazards: () => clearHazards(),
                spawnObject: (action) => {
                    if (!canRunAction()) return;
                    spawnEncounterObject(action);
                },
                despawnObject: (action) => {
                    const objectId = String(action?.objectId || action?.object || '').trim();
                    if (!objectId) return;
                    const objects = encounter?.runtimeCollections?.objects;
                    if (!Array.isArray(objects)) return;
                    for (let i = objects.length - 1; i >= 0; i -= 1) {
                        const object = objects[i];
                        if (String(object?.id || '') !== objectId) continue;
                        object.status = 'destroyed';
                        if (object?.sprite?.parent) object.sprite.parent.removeChild(object.sprite);
                        objects.splice(i, 1);
                        destroyedObjects[objectId] = true;
                        delete objectStatusById[objectId];
                        logEvent('object_destroyed', { objectId, reason: 'despawn_action' });
                        break;
                    }
                },
                damageObject: (action) => {
                    const objectId = String(action?.objectId || action?.object || '').trim();
                    if (!objectId) return;
                    damageObjectById(objectId, Math.max(0, Number(action?.damage) || 1));
                },
                activateObjective: (action) => {
                    const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                    if (!objectiveId) return;
                    const item = objectiveById(objectiveId);
                    if (!item) return;
                    setObjectiveState(objectiveId, { status: 'active', startedAtMs: encounterElapsedMs, lastEvent: 'manual_activate' });
                },
                completeObjective: (action) => {
                    const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                    if (!objectiveId) return;
                    const item = objectiveById(objectiveId);
                    if (!item) return;
                    setObjectiveState(objectiveId, { status: 'completed', completedAtMs: encounterElapsedMs, progress: Math.max(Number(item.target) || 1, Number(item.progress) || 0), lastEvent: 'manual_complete' });
                },
                failObjective: (action) => {
                    const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                    if (!objectiveId) return;
                    if (!objectiveById(objectiveId)) return;
                    setObjectiveState(objectiveId, { status: 'failed', failedAtMs: encounterElapsedMs, lastEvent: 'manual_fail' });
                },
                setObjectiveProgress: (action) => {
                    const objectiveId = String(action?.objectiveId || action?.objective || '').trim();
                    if (!objectiveId) return;
                    const item = objectiveById(objectiveId);
                    if (!item) return;
                    const progress = Math.max(0, Number(action?.progress) || 0);
                    const target = Number.isFinite(Number(action?.target)) ? Math.max(0, Number(action.target)) : Number(item.target) || 0;
                    setObjectiveState(objectiveId, { progress, target, lastEvent: 'manual_progress' });
                },
                grantPlayerAbility: (action) => {
                    const ability = (action?.ability && typeof action.ability === 'object') ? action.ability : {
                        id: String(action?.abilityId || action?.id || action?.key || 'ability_dynamic'),
                        key: String(action?.key || 'q').toLowerCase(),
                        cooldownSeconds: Number(action?.cooldownSeconds) || 8,
                        charges: Number(action?.charges) || 1,
                        castActions: Array.isArray(action?.castActions) ? action.castActions : []
                    };
                    playerRuntime?.grantAbility?.(ability);
                },
                removePlayerAbility: (action) => {
                    const token = String(action?.abilityId || action?.id || action?.key || '').trim();
                    if (!token) return;
                    playerRuntime?.removeAbility?.(token);
                },
                resetPlayerAbilityCooldown: (action) => {
                    const token = String(action?.abilityId || action?.id || action?.key || '').trim();
                    if (!token) return;
                    playerRuntime?.resetAbilityCooldown?.(token);
                },
                applyStatus: (action) => {
                    const statusId = String(action?.status || action?.statusId || '').trim();
                    if (!statusId) return;
                    const targetType = String(action?.target || action?.targetType || 'player').toLowerCase();
                    const targetId = String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null;
                    applyStatusToTarget({
                        statusId,
                        targetType,
                        targetId,
                        stacks: Math.max(1, Number(action?.stacks) || 1),
                        source: String(action?.source || 'sequence')
                    });
                },
                removeStatus: (action) => {
                    const statusId = String(action?.status || action?.statusId || '').trim();
                    if (!statusId) return;
                    const targetType = String(action?.target || action?.targetType || 'player').toLowerCase();
                    const targetId = String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null;
                    removeStatusFromTarget({ statusId, targetType, targetId, expired: false });
                },
                clearStatuses: (action) => {
                    const targetType = String(action?.target || action?.targetType || 'player').toLowerCase();
                    const targetId = String(action?.targetId || action?.enemyId || action?.objectId || '').trim() || null;
                    clearStatusesOnTarget({ targetType, targetId });
                },
                spawnPickup: (action) => {
                    if (!canRunAction()) return;
                    spawnPickup(action);
                },
                clearPickups: () => clearPickups(),
                applyArenaModifier: (action) => {
                    const modifier = (action?.modifier && typeof action.modifier === 'object')
                        ? action.modifier
                        : (action && typeof action === 'object' ? action : null);
                    if (!modifier) return;
                    addArenaModifier(modifier, 'sequence');
                },
                removeArenaModifier: (action) => {
                    const token = String(action?.modifierId || action?.id || action?.modifierType || action?.typeName || action?.type || '').trim();
                    if (!token) return;
                    removeArenaModifier(token);
                },
                clearArenaModifiers: (action) => {
                    clearArenaModifiers(String(action?.reason || 'sequence'));
                },
                setPlayerDashVariant: (action) => {
                    const variant = String(action?.variant || '').trim();
                    if (!variant) return;
                    playerRuntime?.setDashVariant?.(variant);
                },
                lockBossDamage: (action) => {
                    enemyRuntime?.lockBossDamage?.(action);
                },
                unlockBossDamage: (action) => {
                    enemyRuntime?.unlockBossDamage?.(action);
                },
                setMusic: (action) => {
                    audioController?.setMusic?.(action);
                },
                restoreMusic: (action) => {
                    audioController?.restoreMusic?.(action);
                },
                playSfx: (action) => {
                    audioController?.playSfx?.(action);
                },
                musicStinger: (action) => {
                    audioController?.musicStinger?.(action);
                },
                setMusicIntensity: (action) => {
                    audioController?.setMusicIntensity?.(action);
                },
                setObjective: (text) => setObjective(text),
                showBanner: (text) => setBanner(text),
                logEvent: (type, payload) => logEvent(type, payload),
                win: () => {
                    if (phase !== PHASES.PLAYING) return;
                    explicitWinRequested = true;
                }
            }) || null;
            sequenceRunner?.start?.();

            startEnemyPatterns(() => playerRuntime.getState());
            tickOff = pixi.onTick((ticker) => update(ticker?.deltaTime || 1));
            setPhase(PHASES.PLAYING);
        }

        function cleanupWorld() {
            clearPatterns();
            clearTelegraphs();
            const hazards = encounter?.runtimeCollections?.hazards;
            if (Array.isArray(hazards)) {
                for (const hazard of hazards) {
                    try { hazard?.sprite?.parent?.removeChild(hazard.sprite); } catch (_) {}
                }
                hazards.splice(0, hazards.length);
            }
            clearObjects();
            clearPickups();
            clearEmitters();
            clearArenaModifiers('cleanup');
            for (const item of damageNumberSprites) {
                try { item?.sprite?.parent?.removeChild(item.sprite); } catch (_) {}
                try { item?.sprite?.destroy?.({ children: true }); } catch (_) {}
            }
            damageNumberSprites.splice(0, damageNumberSprites.length);
            input.setPointerMapper(null);
            input.unbind();
            if (typeof entities.clearAll === 'function') {
                entities.clearAll();
            } else {
                entities.clearBullets();
            }
            if (tickOff) {
                try { tickOff(); } catch (_) {}
                tickOff = null;
            }
            if (playerRuntime) {
                playerRuntime.dispose();
                playerRuntime = null;
            }
            if (enemyRuntime) {
                enemyRuntime.dispose();
                enemyRuntime = null;
            }
            if (audioController) {
                try { audioController.dispose?.(); } catch (_) {}
                audioController = null;
            }
            try { sequenceRunner?.dispose?.(); } catch (_) {}
            sequenceRunner = null;
            pendingObjectActions.splice(0, pendingObjectActions.length);
            if (worldContainer) {
                try { pixi.destroy(worldContainer, { destroy: true, children: true }); } catch (_) {}
                worldContainer = null;
            }
        }

        function stop() {
            cleanupWorld();
            setPhase(PHASES.MENU);
        }

        function pause() {
            if (phase !== PHASES.PLAYING) return false;
            setPhase(PHASES.PAUSED, { reason: 'manual_pause', elapsedMs: encounterElapsedMs });
            return true;
        }

        function resume() {
            if (phase !== PHASES.PAUSED) return false;
            setPhase(PHASES.PLAYING, { reason: 'manual_resume', elapsedMs: encounterElapsedMs });
            return true;
        }

        async function retry() {
            resultStats.retries = Math.max(0, Number(resultStats.retries) || 0) + 1;
            stop();
            await start(false);
        }

        function dispose() {
            cleanupWorld();
            eventBus.clear();
            setPhase(PHASES.DISPOSED);
        }

        return {
            start,
            stop,
            pause,
            resume,
            retry,
            dispose,
            onStateChange: (listener) => { stateListener = typeof listener === 'function' ? listener : null; },
            onEvent: (type, handler) => eventBus.on(type, handler),
            getState: () => ({
                sequence: sequenceRunner?.getState?.() || null,
                phase,
                schemaVersion,
                activeSeed,
                rngInitialSeed,
                encounterId: selectedEncounterId || encounter?.id || null,
                requestedEncounterId,
                encounterSource,
                encounterTitle: encounter?.title || null,
                encounterLoadWarning: encounterLoadWarning || '',
                loadWarning: encounterLoadWarning || '',
                encounterLoadDiagnostics: encounterLoadDiagnostics && typeof encounterLoadDiagnostics === 'object'
                    ? { ...encounterLoadDiagnostics }
                    : null,
                resultRules: Array.isArray(encounter?.resultRules) ? encounter.resultRules : [],
                encounterPhaseId,
                encounterElapsedMs,
                objectiveText,
                objectiveLines: sortedObjectivesSnapshot()
                    .filter((item) => String(item.visibility || 'visible') !== 'hidden')
                    .map((item) => {
                        const p = Math.max(0, Number(item.progress) || 0);
                        const t = Math.max(0, Number(item.target) || 0);
                        const ratioText = t > 0 ? (' (' + Math.min(t, Math.round(p)) + '/' + Math.round(t) + ')') : '';
                        return objectiveStatusLabel(item) + ': ' + String(item.title || item.id) + ratioText;
                    }),
                objectives: sortedObjectivesSnapshot(),
                bannerText,
                defeatedEnemies,
                bossState,
                bulletCountEnemy: countBulletsByTeam('enemy'),
                bulletCountPlayer: countBulletsByTeam('player'),
                enemyCount: enemyRuntime?.getAliveEnemies?.().length || 0,
                emitterCount: countByCollection('emitters'),
                hazardCount: countByCollection('hazards'),
                objectCount: countByCollection('objects'),
                pickupCount: countByCollection('pickups'),
                telegraphCount: countByCollection('telegraphs'),
                zoneState: { ...zoneState },
                hazardEvents: recentHazardEvents.slice(-10),
                playerRecentEvents: playerRecentEvents.slice(-10),
                statusRecentEvents: statusRecentEvents.slice(-10),
                pickupRecentEvents: pickupRecentEvents.slice(-10),
                pickupCollectedCounts: { ...pickupCollectedCounts },
                playerStatuses: getPlayerStatusSnapshot(),
                arenaState: {
                    shape: arenaShape(),
                    bounds: arenaBoundsMode(),
                    activeModifiers: activeArenaModifiers.map((item) => ({
                        id: String(item?.id || ''),
                        type: String(item?.type || ''),
                        source: String(item?.source || ''),
                        bornMs: Number(item?.bornMs) || 0,
                        durationMs: Number(item?.durationMs) || null
                    })),
                    effects: getArenaEffectsState(),
                    mapSize: getMapSize()
                },
                arenaRecentEvents: arenaRecentEvents.slice(-10),
                readability: {
                    activeDamageNumbers: damageNumberSprites.length,
                    microHitStopMsRemaining,
                    feedbackCounters: { ...feedbackCounters },
                    presetGroupsAvailable: Object.keys(getRenderPresets() || {}),
                    contrastFlags: {
                        enemyBulletDistinct: true,
                        telegraphContrast: true,
                        playerVisibilityGuard: true
                    },
                    feedbackRecentEvents: feedbackRecentEvents.slice(-12)
                },
                resultStats: {
                    startedAtMs: Number(resultStats.startedAtMs) || 0,
                    retries: Math.max(0, Number(resultStats.retries) || 0),
                    deaths: Math.max(0, Number(resultStats.deaths) || 0),
                    bossesDefeated: Array.isArray(resultStats.bossesDefeated) ? resultStats.bossesDefeated.slice() : [],
                    notableEvents: Array.isArray(resultStats.notableEvents) ? resultStats.notableEvents.slice() : [],
                    finalized: resultStats.finalized === true,
                    finalPhase: resultStats.finalPhase || null,
                    finalizedAtEncounterMs: Number(resultStats.finalizedAtEncounterMs) || 0,
                    objectiveSnapshot: Array.isArray(resultStats.objectiveSnapshot) ? resultStats.objectiveSnapshot.map((item) => ({ ...item })) : []
                },
                audio: audioController?.getDebugState?.() || null,
                budgetWarnings: budgetWarnings.slice(-5),
                validationWarnings: validationWarnings.slice(-5),
                validationErrors: validationErrors.slice(-5),
                eventLog: eventLog.slice(-10),
                recentEvents: eventBus.recent(10),
                player: playerRuntime?.getState?.() || null
            })
        };
    }

    window.TDSCombatRuntime = {
        create: createCombatRuntime
    };
})();
