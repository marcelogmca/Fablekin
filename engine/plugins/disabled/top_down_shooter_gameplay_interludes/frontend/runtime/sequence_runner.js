(() => {
    function createSequenceRunner(encounter, handlers) {
        const sequence = encounter?.sequence || {};
        const phases = Array.isArray(sequence.phases) ? sequence.phases : [];
        const phasesById = new Map(phases.map((phase) => [phase.id, phase]));
        const actionGroups = (sequence.actionGroups && typeof sequence.actionGroups === 'object') ? sequence.actionGroups : {};
        const initialFlags = (sequence.initialFlags && typeof sequence.initialFlags === 'object') ? sequence.initialFlags : {};
        const initialCounters = (sequence.initialCounters && typeof sequence.initialCounters === 'object') ? sequence.initialCounters : {};
        let activePhaseId = sequence.startPhase || (phases[0]?.id || null);
        const firedRuleKeys = new Set();
        const repeatingState = new Map();
        let lastRuntimeState = {};
        let phaseStartElapsedMs = 0;
        const actionRegistry = window.TDSActionRegistry?.create?.();
        const triggerRegistry = window.TDSTriggerRegistry?.create?.();
        const sequenceFlags = {};
        const sequenceCounters = {};
        const scheduledActions = [];
        let scheduleOrder = 0;

        const MAX_SCHEDULED_ACTIONS = 500;
        const MAX_ACTIONS_PER_TICK = 80;

        for (const [key, value] of Object.entries(initialFlags)) {
            sequenceFlags[String(key)] = !!value;
        }
        for (const [key, value] of Object.entries(initialCounters)) {
            const n = Number(value);
            sequenceCounters[String(key)] = Number.isFinite(n) ? n : 0;
        }

        function normalizeType(value) {
            return String(value || '').trim().toLowerCase();
        }

        function getRandomFloat() {
            const fn = handlers?.randomFloat;
            if (typeof fn === 'function') return fn();
            return Math.random();
        }

        function scheduleDelayedActions(actions, delaySeconds, runtimeState) {
            const list = Array.isArray(actions) ? actions : [];
            if (!list.length) return;
            const baseMs = Number(runtimeState?.elapsedMs) || Number(lastRuntimeState?.elapsedMs) || 0;
            const delayMs = Math.max(0, (Number(delaySeconds) || 0) * 1000);
            for (const action of list) {
                if (scheduledActions.length >= MAX_SCHEDULED_ACTIONS) {
                    handlers?.logEvent?.('sequence_warning', { message: 'Scheduled action cap reached; dropping delayed action.' });
                    break;
                }
                scheduledActions.push({
                    dueMs: baseMs + delayMs,
                    order: scheduleOrder++,
                    action
                });
            }
        }

        function processScheduledActions(runtimeState, actionBudgetRef) {
            if (!scheduledActions.length) return;
            const nowMs = Number(runtimeState?.elapsedMs) || 0;
            scheduledActions.sort((a, b) => (Number(a?.dueMs) || 0) - (Number(b?.dueMs) || 0) || (Number(a?.order) || 0) - (Number(b?.order) || 0));
            while (scheduledActions.length > 0) {
                if (actionBudgetRef.count >= MAX_ACTIONS_PER_TICK) return;
                const next = scheduledActions[0];
                if ((Number(next?.dueMs) || 0) > nowMs) break;
                scheduledActions.shift();
                actionBudgetRef.count += 1;
                runAction(next?.action, runtimeState);
            }
        }

        function evaluateInlineCondition(when, runtimeState) {
            const type = normalizeType(when?.type);
            const fromRegistry = triggerRegistry?.get?.(type);
            if (typeof fromRegistry === 'function') return !!fromRegistry(when, runtimeState);
            handlers?.logEvent?.('sequence_warning', { message: 'Unknown inline trigger "' + type + '"' });
            return false;
        }

        function evaluateConditionalGate(spec, runtimeState) {
            if (!spec || typeof spec !== 'object') return true;
            return evaluateInlineCondition(spec, runtimeState);
        }

        function registerDefaults() {
            if (!actionRegistry || !triggerRegistry) return;

            actionRegistry.register('spawn_enemy', (action) => {
                handlers?.spawnEnemy?.(action);
                handlers?.logEvent?.('action_spawn_enemy', {
                    enemyType: action?.enemyType || null,
                    count: Number(action?.count) || 1,
                    formation: action?.formation || null
                });
            });
            actionRegistry.register('spawn_enemies_from_table', (action) => {
                const table = Array.isArray(action?.table) ? action.table : [];
                if (!table.length) return;
                const totalWeight = table.reduce((sum, item) => sum + Math.max(0, Number(item?.weight) || 0), 0);
                if (totalWeight <= 0) return;
                let pick = getRandomFloat() * totalWeight;
                let chosen = table[0];
                for (const candidate of table) {
                    pick -= Math.max(0, Number(candidate?.weight) || 0);
                    if (pick <= 0) {
                        chosen = candidate;
                        break;
                    }
                }
                handlers?.spawnEnemy?.({
                    type: 'spawn_enemy',
                    enemyType: chosen?.enemyType || action?.enemyType,
                    count: Number(chosen?.count) || Number(action?.count) || 1,
                    formation: chosen?.formation || action?.formation,
                    at: chosen?.at || action?.at
                });
                handlers?.logEvent?.('action_spawn_enemies_from_table', {
                    chosenEnemyType: String(chosen?.enemyType || ''),
                    chosenCount: Number(chosen?.count) || 1
                });
            });
            actionRegistry.register('delay_actions', (action, runtimeState) => {
                const actions = Array.isArray(action?.actions) ? action.actions : [];
                scheduleDelayedActions(actions, Number(action?.delaySeconds) || 0, runtimeState);
                handlers?.logEvent?.('action_delay_actions', { delaySeconds: Number(action?.delaySeconds) || 0, count: actions.length });
            });
            actionRegistry.register('run_action_group', (action, runtimeState) => {
                const groupId = String(action?.group || action?.groupId || '').trim();
                if (!groupId) return;
                const groupActions = Array.isArray(actionGroups[groupId]) ? actionGroups[groupId] : null;
                if (!groupActions) {
                    handlers?.logEvent?.('sequence_warning', { message: 'Unknown action group "' + groupId + '"' });
                    return;
                }
                if (Number(action?.delaySeconds) > 0) {
                    scheduleDelayedActions(groupActions, Number(action?.delaySeconds), runtimeState);
                } else {
                    for (const groupAction of groupActions) runAction(groupAction, runtimeState);
                }
                handlers?.logEvent?.('action_run_action_group', { groupId, count: groupActions.length });
            });
            actionRegistry.register('set_flag', (action) => {
                const key = String(action?.key || action?.flag || '').trim();
                if (!key) return;
                sequenceFlags[key] = action?.value !== false;
                handlers?.logEvent?.('action_set_flag', { key, value: sequenceFlags[key] });
            });
            actionRegistry.register('clear_flag', (action) => {
                const key = String(action?.key || action?.flag || '').trim();
                if (!key) return;
                sequenceFlags[key] = false;
                handlers?.logEvent?.('action_clear_flag', { key });
            });
            actionRegistry.register('toggle_flag', (action) => {
                const key = String(action?.key || action?.flag || '').trim();
                if (!key) return;
                sequenceFlags[key] = !sequenceFlags[key];
                handlers?.logEvent?.('action_toggle_flag', { key, value: sequenceFlags[key] });
            });
            actionRegistry.register('set_counter', (action) => {
                const key = String(action?.key || action?.counter || '').trim();
                if (!key) return;
                const value = Number(action?.value);
                sequenceCounters[key] = Number.isFinite(value) ? value : 0;
                handlers?.logEvent?.('action_set_counter', { key, value: sequenceCounters[key] });
            });
            actionRegistry.register('add_counter', (action) => {
                const key = String(action?.key || action?.counter || '').trim();
                if (!key) return;
                const delta = Number(action?.value);
                sequenceCounters[key] = (Number(sequenceCounters[key]) || 0) + (Number.isFinite(delta) ? delta : 1);
                handlers?.logEvent?.('action_add_counter', { key, value: sequenceCounters[key] });
            });
            actionRegistry.register('sub_counter', (action) => {
                const key = String(action?.key || action?.counter || '').trim();
                if (!key) return;
                const delta = Number(action?.value);
                sequenceCounters[key] = (Number(sequenceCounters[key]) || 0) - (Number.isFinite(delta) ? delta : 1);
                handlers?.logEvent?.('action_sub_counter', { key, value: sequenceCounters[key] });
            });
            actionRegistry.register('transition_phase', (action) => {
                setPhase(action?.phase);
                handlers?.logEvent?.('action_transition_phase', { phase: action?.phase || null });
            });
            actionRegistry.register('set_objective', (action) => {
                const text = String(action?.text || '');
                handlers?.setObjective?.(text);
                handlers?.logEvent?.('action_set_objective', { text });
            });
            actionRegistry.register('show_banner', (action) => {
                const text = String(action?.text || '');
                handlers?.showBanner?.(text);
                handlers?.logEvent?.('action_show_banner', { text });
            });
            actionRegistry.register('fire_pattern', (action, runtimeState) => {
                handlers?.firePattern?.(action, runtimeState);
                handlers?.logEvent?.('action_fire_pattern', {
                    patternId: String(action?.pattern || ''),
                    sourceType: String(action?.source?.type || 'phase_anchor')
                });
            });
            actionRegistry.register('spawn_telegraph', (action, runtimeState) => {
                handlers?.spawnTelegraph?.(action, runtimeState);
                handlers?.logEvent?.('action_spawn_telegraph', {
                    shape: String(action?.shape || 'circle'),
                    durationSeconds: Number(action?.durationSeconds) || 0
                });
            });
            actionRegistry.register('telegraph_then_fire', (action, runtimeState) => {
                handlers?.telegraphThenFire?.(action, runtimeState);
                handlers?.logEvent?.('action_telegraph_then_fire', {
                    patternId: String(action?.pattern || ''),
                    shape: String(action?.shape || 'circle'),
                    durationSeconds: Number(action?.durationSeconds) || 0
                });
            });
            actionRegistry.register('telegraph_then_spawn_enemy', (action, runtimeState) => {
                handlers?.telegraphThenSpawnEnemy?.(action, runtimeState);
                handlers?.logEvent?.('action_telegraph_then_spawn_enemy', {
                    enemyType: String(action?.enemyType || ''),
                    shape: String(action?.shape || 'circle'),
                    durationSeconds: Number(action?.durationSeconds) || 0
                });
            });
            actionRegistry.register('telegraph_then_spawn_hazard', (action, runtimeState) => {
                handlers?.telegraphThenSpawnHazard?.(action, runtimeState);
                handlers?.logEvent?.('action_telegraph_then_spawn_hazard', {
                    hazardType: String(action?.hazardType || action?.hazard?.type || ''),
                    shape: String(action?.shape || 'circle'),
                    durationSeconds: Number(action?.durationSeconds) || 0
                });
            });
            actionRegistry.register('clear_telegraphs', (_action, runtimeState) => {
                handlers?.clearTelegraphs?.(runtimeState);
                handlers?.logEvent?.('action_clear_telegraphs', {});
            });
            actionRegistry.register('spawn_emitter', (action, runtimeState) => {
                handlers?.spawnEmitter?.(action, runtimeState);
                handlers?.logEvent?.('action_spawn_emitter', {
                    emitterId: String(action?.emitterId || action?.emitter || ''),
                    pattern: String(action?.pattern || '')
                });
            });
            actionRegistry.register('stop_emitter', (action, runtimeState) => {
                handlers?.stopEmitter?.(action, runtimeState);
                handlers?.logEvent?.('action_stop_emitter', { emitterId: String(action?.emitterId || action?.emitter || '') });
            });
            actionRegistry.register('pause_emitter', (action, runtimeState) => {
                handlers?.pauseEmitter?.(action, runtimeState);
                handlers?.logEvent?.('action_pause_emitter', { emitterId: String(action?.emitterId || action?.emitter || '') });
            });
            actionRegistry.register('resume_emitter', (action, runtimeState) => {
                handlers?.resumeEmitter?.(action, runtimeState);
                handlers?.logEvent?.('action_resume_emitter', { emitterId: String(action?.emitterId || action?.emitter || '') });
            });
            actionRegistry.register('clear_emitters', (_action, runtimeState) => {
                handlers?.clearEmitters?.(runtimeState);
                handlers?.logEvent?.('action_clear_emitters', {});
            });
            actionRegistry.register('spawn_hazard', (action, runtimeState) => {
                handlers?.spawnHazard?.(action, runtimeState);
                handlers?.logEvent?.('action_spawn_hazard', { hazard: String(action?.hazard || action?.hazardId || '') });
            });
            actionRegistry.register('clear_hazards', (_action, runtimeState) => {
                handlers?.clearHazards?.(runtimeState);
                handlers?.logEvent?.('action_clear_hazards', {});
            });
            actionRegistry.register('spawn_object', (action, runtimeState) => {
                handlers?.spawnObject?.(action, runtimeState);
                handlers?.logEvent?.('action_spawn_object', { object: String(action?.object || action?.objectId || '') });
            });
            actionRegistry.register('despawn_object', (action, runtimeState) => {
                handlers?.despawnObject?.(action, runtimeState);
                handlers?.logEvent?.('action_despawn_object', { object: String(action?.object || action?.objectId || '') });
            });
            actionRegistry.register('damage_object', (action, runtimeState) => {
                handlers?.damageObject?.(action, runtimeState);
                handlers?.logEvent?.('action_damage_object', { object: String(action?.object || action?.objectId || '') });
            });
            actionRegistry.register('activate_objective', (action, runtimeState) => {
                handlers?.activateObjective?.(action, runtimeState);
                handlers?.logEvent?.('action_activate_objective', { objective: String(action?.objective || action?.objectiveId || '') });
            });
            actionRegistry.register('complete_objective', (action, runtimeState) => {
                handlers?.completeObjective?.(action, runtimeState);
                handlers?.logEvent?.('action_complete_objective', { objective: String(action?.objective || action?.objectiveId || '') });
            });
            actionRegistry.register('fail_objective', (action, runtimeState) => {
                handlers?.failObjective?.(action, runtimeState);
                handlers?.logEvent?.('action_fail_objective', { objective: String(action?.objective || action?.objectiveId || '') });
            });
            actionRegistry.register('set_objective_progress', (action, runtimeState) => {
                handlers?.setObjectiveProgress?.(action, runtimeState);
                handlers?.logEvent?.('action_set_objective_progress', { objective: String(action?.objective || action?.objectiveId || ''), progress: Number(action?.progress) || 0 });
            });
            actionRegistry.register('grant_player_ability', (action, runtimeState) => {
                handlers?.grantPlayerAbility?.(action, runtimeState);
                handlers?.logEvent?.('action_grant_player_ability', { abilityId: String(action?.abilityId || action?.id || '') });
            });
            actionRegistry.register('remove_player_ability', (action, runtimeState) => {
                handlers?.removePlayerAbility?.(action, runtimeState);
                handlers?.logEvent?.('action_remove_player_ability', { abilityId: String(action?.abilityId || action?.id || action?.key || '') });
            });
            actionRegistry.register('reset_player_ability_cooldown', (action, runtimeState) => {
                handlers?.resetPlayerAbilityCooldown?.(action, runtimeState);
                handlers?.logEvent?.('action_reset_player_ability_cooldown', { abilityId: String(action?.abilityId || action?.id || action?.key || '') });
            });
            actionRegistry.register('set_player_dash_variant', (action, runtimeState) => {
                handlers?.setPlayerDashVariant?.(action, runtimeState);
                handlers?.logEvent?.('action_set_player_dash_variant', { variant: String(action?.variant || '') });
            });
            actionRegistry.register('apply_status', (action, runtimeState) => {
                handlers?.applyStatus?.(action, runtimeState);
                handlers?.logEvent?.('action_apply_status', { status: String(action?.status || action?.statusId || ''), target: String(action?.target || 'player') });
            });
            actionRegistry.register('remove_status', (action, runtimeState) => {
                handlers?.removeStatus?.(action, runtimeState);
                handlers?.logEvent?.('action_remove_status', { status: String(action?.status || action?.statusId || ''), target: String(action?.target || 'player') });
            });
            actionRegistry.register('clear_statuses', (action, runtimeState) => {
                handlers?.clearStatuses?.(action, runtimeState);
                handlers?.logEvent?.('action_clear_statuses', { target: String(action?.target || 'player') });
            });
            actionRegistry.register('spawn_pickup', (action, runtimeState) => {
                handlers?.spawnPickup?.(action, runtimeState);
                handlers?.logEvent?.('action_spawn_pickup', { pickup: String(action?.pickup || action?.pickupId || '') });
            });
            actionRegistry.register('clear_pickups', (action, runtimeState) => {
                handlers?.clearPickups?.(action, runtimeState);
                handlers?.logEvent?.('action_clear_pickups', { reason: String(action?.reason || 'manual') });
            });
            actionRegistry.register('apply_arena_modifier', (action, runtimeState) => {
                handlers?.applyArenaModifier?.(action, runtimeState);
                handlers?.logEvent?.('action_apply_arena_modifier', { type: String(action?.modifier?.type || action?.typeName || action?.modifierType || '') });
            });
            actionRegistry.register('remove_arena_modifier', (action, runtimeState) => {
                handlers?.removeArenaModifier?.(action, runtimeState);
                handlers?.logEvent?.('action_remove_arena_modifier', { token: String(action?.modifierId || action?.id || action?.modifierType || '') });
            });
            actionRegistry.register('clear_arena_modifiers', (action, runtimeState) => {
                handlers?.clearArenaModifiers?.(action, runtimeState);
                handlers?.logEvent?.('action_clear_arena_modifiers', { reason: String(action?.reason || 'manual') });
            });
            actionRegistry.register('lock_boss_damage', (action, runtimeState) => {
                handlers?.lockBossDamage?.(action, runtimeState);
                handlers?.logEvent?.('action_lock_boss_damage', { bossId: String(action?.bossId || action?.enemyId || '') });
            });
            actionRegistry.register('unlock_boss_damage', (action, runtimeState) => {
                handlers?.unlockBossDamage?.(action, runtimeState);
                handlers?.logEvent?.('action_unlock_boss_damage', { bossId: String(action?.bossId || action?.enemyId || '') });
            });
            actionRegistry.register('set_music', (action, runtimeState) => {
                handlers?.setMusic?.(action, runtimeState);
                handlers?.logEvent?.('action_set_music', { track: String(action?.track || action?.path || action?.choice || '') });
            });
            actionRegistry.register('restore_music', (action, runtimeState) => {
                handlers?.restoreMusic?.(action, runtimeState);
                handlers?.logEvent?.('action_restore_music', { reason: String(action?.reason || '') });
            });
            actionRegistry.register('play_sfx', (action, runtimeState) => {
                handlers?.playSfx?.(action, runtimeState);
                handlers?.logEvent?.('action_play_sfx', { track: String(action?.track || action?.path || action?.sfx || '') });
            });
            actionRegistry.register('music_stinger', (action, runtimeState) => {
                handlers?.musicStinger?.(action, runtimeState);
                handlers?.logEvent?.('action_music_stinger', { track: String(action?.track || action?.path || action?.sfx || '') });
            });
            actionRegistry.register('set_music_intensity', (action, runtimeState) => {
                handlers?.setMusicIntensity?.(action, runtimeState);
                handlers?.logEvent?.('action_set_music_intensity', { level: String(action?.level || action?.intensity || '') });
            });
            actionRegistry.register('win', () => {
                handlers?.win?.();
                handlers?.logEvent?.('action_win', {});
            });

            triggerRegistry.register('all_enemies_defeated', (_when, runtimeState) => (runtimeState?.aliveEnemies || 0) <= 0);
            triggerRegistry.register('time_elapsed', (when, runtimeState) => (runtimeState?.elapsedMs || 0) >= ((Number(when?.seconds) || 0) * 1000));
            triggerRegistry.register('phase_elapsed', (when, runtimeState) => (runtimeState?.phaseElapsedMs || 0) >= ((Number(when?.seconds) || 0) * 1000));
            triggerRegistry.register('enemy_defeated_count', (when, runtimeState) => (runtimeState?.defeatedEnemies || 0) >= (Number(when?.count) || 0));
            triggerRegistry.register('enemy_type_defeated_count', (when, runtimeState) => (Number(runtimeState?.defeatedByType?.[String(when?.enemyType || '')]) || 0) >= (Number(when?.count) || 0));
            triggerRegistry.register('boss_hp_below', (when, runtimeState) => {
                const ratio = Number(when?.ratio);
                const boss = runtimeState?.bossState || null;
                if (!Number.isFinite(ratio) || !boss || !Number.isFinite(Number(boss.hpRatio))) return false;
                return Number(boss.hpRatio) <= ratio;
            });
            triggerRegistry.register('player_hp_below', (when, runtimeState) => {
                const ratio = Number(when?.ratio);
                const hp = Number(runtimeState?.playerHp) || 0;
                const maxHp = Number(runtimeState?.playerMaxHp) || 1;
                if (!Number.isFinite(ratio)) return false;
                return hp <= (maxHp * ratio);
            });
            triggerRegistry.register('object_destroyed', (when, runtimeState) => {
                const objectId = String(when?.object || when?.objectId || '');
                if (!objectId) return false;
                return runtimeState?.destroyedObjects?.[objectId] === true;
            });
            triggerRegistry.register('object_hp_below', (when, runtimeState) => {
                const objectId = String(when?.object || when?.objectId || '');
                const ratio = Number(when?.ratio);
                if (!objectId || !Number.isFinite(ratio)) return false;
                const object = runtimeState?.objectSnapshots?.[objectId];
                if (!object) return false;
                const hp = Number(object.hp) || 0;
                const maxHp = Math.max(1, Number(object.maxHp) || 1);
                return (hp / maxHp) <= ratio;
            });
            triggerRegistry.register('player_entered_zone', (when, runtimeState) => {
                const zoneId = String(when?.zone || when?.zoneId || '');
                if (!zoneId) return false;
                const zone = runtimeState?.zoneState?.[zoneId];
                return zone === 'entered' || zone === 'inside';
            });
            triggerRegistry.register('player_left_zone', (when, runtimeState) => {
                const zoneId = String(when?.zone || when?.zoneId || '');
                if (!zoneId) return false;
                const zone = runtimeState?.zoneState?.[zoneId];
                return zone === 'left' || zone === 'outside';
            });
            triggerRegistry.register('objective_completed', (when, runtimeState) => {
                const id = String(when?.objective || when?.objectiveId || '');
                if (!id) return false;
                const objectives = Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : [];
                return objectives.some((item) => String(item?.id || '') === id && String(item?.status || '') === 'completed');
            });
            triggerRegistry.register('objective_failed', (when, runtimeState) => {
                const id = String(when?.objective || when?.objectiveId || '');
                if (!id) return false;
                const objectives = Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : [];
                return objectives.some((item) => String(item?.id || '') === id && String(item?.status || '') === 'failed');
            });
            triggerRegistry.register('objective_progress_at_least', (when, runtimeState) => {
                const id = String(when?.objective || when?.objectiveId || '');
                const progress = Number(when?.progress);
                if (!id || !Number.isFinite(progress)) return false;
                const objectives = Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : [];
                const objective = objectives.find((item) => String(item?.id || '') === id);
                return objective ? (Number(objective.progress) || 0) >= progress : false;
            });
            triggerRegistry.register('enemy_count_below', (when, runtimeState) => (runtimeState?.aliveEnemies || 0) < (Number(when?.count) || 0));
            triggerRegistry.register('enemy_count_at_least', (when, runtimeState) => (runtimeState?.aliveEnemies || 0) >= (Number(when?.count) || 0));
            triggerRegistry.register('boss_phase_is', (when, runtimeState) => {
                const phase = String(when?.phase || when?.phaseId || '');
                if (!phase) return false;
                const boss = runtimeState?.bossState || null;
                if (!boss) return false;
                return String(boss?.phaseId || '') === phase;
            });
            triggerRegistry.register('boss_alive', (_when, runtimeState) => {
                const boss = runtimeState?.bossState || null;
                return !!boss && boss.alive !== false;
            });
            triggerRegistry.register('hazard_count_below', (when, runtimeState) => (runtimeState?.hazardCount || 0) < (Number(when?.count) || 0));
            triggerRegistry.register('hazard_count_at_least', (when, runtimeState) => (runtimeState?.hazardCount || 0) >= (Number(when?.count) || 0));
            triggerRegistry.register('random_chance', (when) => {
                const chance = Number(when?.chance);
                if (!Number.isFinite(chance)) return false;
                const clamped = Math.max(0, Math.min(1, chance));
                return getRandomFloat() <= clamped;
            });
            triggerRegistry.register('flag_is', (when) => {
                const key = String(when?.key || when?.flag || '').trim();
                if (!key) return false;
                const expected = when?.value !== false;
                return !!sequenceFlags[key] === expected;
            });
            triggerRegistry.register('counter_at_least', (when) => {
                const key = String(when?.key || when?.counter || '').trim();
                const value = Number(when?.value);
                if (!key || !Number.isFinite(value)) return false;
                return (Number(sequenceCounters[key]) || 0) >= value;
            });
            triggerRegistry.register('counter_below', (when) => {
                const key = String(when?.key || when?.counter || '').trim();
                const value = Number(when?.value);
                if (!key || !Number.isFinite(value)) return false;
                return (Number(sequenceCounters[key]) || 0) < value;
            });
            triggerRegistry.register('player_ability_used', (when, runtimeState) => {
                const abilityId = String(when?.abilityId || when?.id || when?.ability || '');
                const withinSeconds = Math.max(0, Number(when?.withinSeconds) || 1.5);
                const events = Array.isArray(runtimeState?.playerRecentEvents) ? runtimeState.playerRecentEvents : [];
                const nowMs = Number(runtimeState?.elapsedMs) || 0;
                return events.some((evt) => String(evt?.type || '') === 'player_ability_used'
                    && (!abilityId || String(evt?.payload?.abilityId || '') === abilityId)
                    && (nowMs - (Number(evt?.elapsedMs) || 0)) <= (withinSeconds * 1000));
            });
            triggerRegistry.register('player_dash_used', (when, runtimeState) => {
                const variant = String(when?.variant || '').toLowerCase();
                const withinSeconds = Math.max(0, Number(when?.withinSeconds) || 1.2);
                const events = Array.isArray(runtimeState?.playerRecentEvents) ? runtimeState.playerRecentEvents : [];
                const nowMs = Number(runtimeState?.elapsedMs) || 0;
                return events.some((evt) => String(evt?.type || '') === 'player_dash_used'
                    && (!variant || String(evt?.payload?.dashVariant || '').toLowerCase() === variant)
                    && (nowMs - (Number(evt?.elapsedMs) || 0)) <= (withinSeconds * 1000));
            });
            triggerRegistry.register('status_active', (when, runtimeState) => {
                const statusId = String(when?.status || when?.statusId || '').trim();
                const target = String(when?.target || 'player').toLowerCase();
                if (!statusId || target !== 'player') return false;
                return !!runtimeState?.playerStatuses?.[statusId];
            });
            triggerRegistry.register('status_stacks_at_least', (when, runtimeState) => {
                const statusId = String(when?.status || when?.statusId || '').trim();
                const target = String(when?.target || 'player').toLowerCase();
                const count = Math.max(1, Number(when?.count) || 1);
                if (!statusId || target !== 'player') return false;
                return (Number(runtimeState?.playerStatuses?.[statusId]?.stacks) || 0) >= count;
            });
            triggerRegistry.register('status_applied_recently', (when, runtimeState) => {
                const statusId = String(when?.status || when?.statusId || '').trim();
                const target = String(when?.target || 'player').toLowerCase();
                const withinSeconds = Math.max(0, Number(when?.withinSeconds) || 1.5);
                const events = Array.isArray(runtimeState?.statusRecentEvents) ? runtimeState.statusRecentEvents : [];
                const nowMs = Number(runtimeState?.elapsedMs) || 0;
                return events.some((evt) => String(evt?.type || '') === 'status_applied'
                    && (!statusId || String(evt?.statusId || '') === statusId)
                    && (!target || String(evt?.target || '') === target)
                    && (nowMs - (Number(evt?.elapsedMs) || 0)) <= (withinSeconds * 1000));
            });
            triggerRegistry.register('pickup_collected', (when, runtimeState) => {
                const pickupId = String(when?.pickup || when?.pickupId || '').trim();
                const withinSeconds = Math.max(0, Number(when?.withinSeconds) || 1.5);
                const events = Array.isArray(runtimeState?.pickupRecentEvents) ? runtimeState.pickupRecentEvents : [];
                const nowMs = Number(runtimeState?.elapsedMs) || 0;
                return events.some((evt) => String(evt?.type || '') === 'pickup_collected'
                    && (!pickupId || String(evt?.pickupId || '') === pickupId)
                    && (nowMs - (Number(evt?.elapsedMs) || 0)) <= (withinSeconds * 1000));
            });
            triggerRegistry.register('pickup_collected_count', (when, runtimeState) => {
                const pickupId = String(when?.pickup || when?.pickupId || '').trim();
                const count = Math.max(1, Number(when?.count) || 1);
                if (!pickupId) return (Number(runtimeState?.pickupCollectedCounts?.__all) || 0) >= count;
                return (Number(runtimeState?.pickupCollectedCounts?.[pickupId]) || 0) >= count;
            });
        }

        function runAction(action, runtimeState) {
            if (!action || typeof action !== 'object') return;
            if (!evaluateConditionalGate(action.if, runtimeState)) {
                const elseActions = Array.isArray(action.elseActions) ? action.elseActions : [];
                for (const elseAction of elseActions) runAction(elseAction, runtimeState);
                return;
            }
            const type = normalizeType(action?.type);
            const fromRegistry = actionRegistry?.get?.(type);
            if (typeof fromRegistry === 'function') {
                fromRegistry(action, runtimeState || getRuntimeStateSnapshot());
                return;
            }
            if (type === 'win') handlers?.win?.();
            else handlers?.logEvent?.('sequence_warning', { message: 'Unknown sequence action "' + type + '"' });
        }

        function runActionList(actions, runtimeState, actionBudgetRef) {
            const list = Array.isArray(actions) ? actions : [];
            for (const action of list) {
                if (actionBudgetRef.count >= MAX_ACTIONS_PER_TICK) return;
                actionBudgetRef.count += 1;
                runAction(action, runtimeState);
            }
        }

        function runEnterActions(phase, runtimeState) {
            runActionList(phase?.enter, runtimeState, { count: 0 });
        }

        function setPhase(nextPhaseId) {
            const id = String(nextPhaseId || '');
            if (!id || !phasesById.has(id)) return;
            activePhaseId = id;
            phaseStartElapsedMs = Number(lastRuntimeState?.elapsedMs) || 0;
            handlers?.setObjective?.(phasesById.get(id)?.objective || '');
            handlers?.logEvent?.('phase_started', { phaseId: id });
            runEnterActions(phasesById.get(id), getRuntimeStateSnapshot());
        }

        function evaluateRule(rule, runtimeState) {
            const when = rule?.when || {};
            const type = normalizeType(when.type);
            const fromRegistry = triggerRegistry?.get?.(type);
            if (typeof fromRegistry === 'function') return !!fromRegistry(when, runtimeState);
            handlers?.logEvent?.('sequence_warning', { message: 'Unknown rule trigger "' + type + '"' });
            return false;
        }

        function getRuntimeStateSnapshot() {
            return lastRuntimeState || {};
        }

        function tick(runtimeState) {
            lastRuntimeState = runtimeState || {};
            const augmentedRuntimeState = {
                ...lastRuntimeState,
                phaseElapsedMs: Math.max(0, (Number(lastRuntimeState?.elapsedMs) || 0) - phaseStartElapsedMs),
                sequenceFlags: { ...sequenceFlags },
                sequenceCounters: { ...sequenceCounters }
            };
            const actionBudgetRef = { count: 0 };
            processScheduledActions(augmentedRuntimeState, actionBudgetRef);

            const phase = phasesById.get(activePhaseId);
            if (!phase) return;
            const rules = Array.isArray(phase.rules) ? phase.rules : [];
            for (let i = 0; i < rules.length; i += 1) {
                if (actionBudgetRef.count >= MAX_ACTIONS_PER_TICK) break;
                const key = phase.id + '::' + i;
                const rule = rules[i] || {};
                if (!evaluateConditionalGate(rule.if, augmentedRuntimeState)) {
                    const elseActions = Array.isArray(rule.elseActions) ? rule.elseActions : [];
                    runActionList(elseActions, augmentedRuntimeState, actionBudgetRef);
                    continue;
                }
                const repeat = rule?.repeat && typeof rule.repeat === 'object' ? rule.repeat : null;
                const cooldownMs = Math.max(0, (Number(rule?.cooldownSeconds) || 0) * 1000);
                const current = repeatingState.get(key) || { lastMs: -Infinity, count: 0 };
                const elapsedMs = Number(augmentedRuntimeState?.phaseElapsedMs) || 0;
                if (cooldownMs > 0 && (elapsedMs - Number(current.lastMs || -Infinity)) < cooldownMs) continue;
                if (!repeat) {
                    if (firedRuleKeys.has(key)) continue;
                    if (!evaluateRule(rule, augmentedRuntimeState)) continue;
                    firedRuleKeys.add(key);
                    current.lastMs = elapsedMs;
                    current.count = (Number(current.count) || 0) + 1;
                    repeatingState.set(key, current);
                    runActionList(rule?.do, augmentedRuntimeState, actionBudgetRef);
                    continue;
                }

                if (!evaluateRule(rule, augmentedRuntimeState)) continue;
                const everyMs = Math.max(100, (Number(repeat.everySeconds) || 1) * 1000);
                const limit = Number.isFinite(Number(repeat.limit)) ? Math.max(1, Number(repeat.limit)) : null;
                const maxRepeats = Number.isFinite(Number(rule?.maxRepeats)) ? Math.max(1, Number(rule.maxRepeats)) : null;
                if (limit !== null && current.count >= limit) continue;
                if (maxRepeats !== null && current.count >= maxRepeats) continue;
                const repeatUntil = (rule?.repeatUntil && typeof rule.repeatUntil === 'object') ? rule.repeatUntil : null;
                if (repeatUntil && evaluateInlineCondition(repeatUntil, augmentedRuntimeState)) continue;
                if ((elapsedMs - Number(current.lastMs || -Infinity)) < everyMs) continue;
                current.lastMs = elapsedMs;
                current.count += 1;
                repeatingState.set(key, current);
                runActionList(rule?.do, augmentedRuntimeState, actionBudgetRef);
            }
        }

        function start() {
            registerDefaults();
            if (!activePhaseId && phases[0]?.id) activePhaseId = phases[0].id;
            const first = phasesById.get(activePhaseId);
            if (first) {
                phaseStartElapsedMs = Number(lastRuntimeState?.elapsedMs) || 0;
                handlers?.setObjective?.(first.objective || '');
                runEnterActions(first, getRuntimeStateSnapshot());
            }
        }

        function dispose() {
            scheduledActions.splice(0, scheduledActions.length);
        }

        return {
            start,
            tick,
            dispose,
            getState: () => ({
                activePhaseId,
                sequenceFlags: { ...sequenceFlags },
                sequenceCounters: { ...sequenceCounters },
                scheduledActionsCount: scheduledActions.length,
                scheduledActionsPreview: scheduledActions.slice(0, 10).map((item) => ({
                    dueMs: Number(item?.dueMs) || 0,
                    type: String(item?.action?.type || '')
                }))
            })
        };
    }

    window.TDSSequenceRunner = {
        create: createSequenceRunner
    };
})();
