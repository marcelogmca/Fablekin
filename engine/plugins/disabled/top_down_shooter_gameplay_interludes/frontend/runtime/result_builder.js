(() => {
    function uniqueStrings(items) {
        const out = [];
        const seen = new Set();
        for (const item of (Array.isArray(items) ? items : [])) {
            const key = String(item || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(key);
        }
        return out;
    }

    function objectiveMap(objectives) {
        const map = {};
        for (const item of (Array.isArray(objectives) ? objectives : [])) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            map[id] = String(item?.status || 'inactive');
        }
        return map;
    }

    function evaluateResultRule(rule, snapshot) {
        const when = (rule?.when && typeof rule.when === 'object') ? rule.when : {};
        const type = String(when.type || '').toLowerCase();
        if (!type) return false;
        if (type === 'player_hp_below') return Number(snapshot.playerHpRatio) <= Math.max(0, Number(when.ratio) || 0);
        if (type === 'objective_completed') {
            const id = String(when.objective || when.objectiveId || '');
            return snapshot.objectiveStatus[id] === 'completed';
        }
        if (type === 'objective_failed') {
            const id = String(when.objective || when.objectiveId || '');
            return snapshot.objectiveStatus[id] === 'failed';
        }
        if (type === 'enemy_defeated_count_at_least') return Number(snapshot.enemiesDefeated) >= Math.max(0, Number(when.count) || 0);
        if (type === 'boss_defeated') {
            const id = String(when.bossId || when.enemyTypeId || '').trim();
            if (!id) return snapshot.bossesDefeated.length > 0 || snapshot.bossDefeated === true;
            return snapshot.bossesDefeated.includes(id);
        }
        if (type === 'retries_at_least') return Number(snapshot.retries) >= Math.max(0, Number(when.count) || 0);
        if (type === 'duration_below') return Number(snapshot.durationSeconds) <= Math.max(0, Number(when.seconds) || 0);
        if (type === 'duration_above') return Number(snapshot.durationSeconds) >= Math.max(0, Number(when.seconds) || 0);
        return false;
    }

    function buildCombatResult(runtimeState, meta = {}) {
        const phase = String(runtimeState?.phase || '');
        const played = meta.played !== false;
        const encounterId = runtimeState?.encounterId || null;
        const encounterTitle = runtimeState?.encounterTitle || null;
        const defeatedEnemies = Number(runtimeState?.defeatedEnemies) || 0;
        const elapsedMs = Number(runtimeState?.encounterElapsedMs) || 0;
        const player = runtimeState?.player || null;
        const playerHp = Number(player?.hp);
        const playerMaxHp = Number(player?.maxHp);
        const bossState = runtimeState?.bossState || null;
        const eventLog = Array.isArray(runtimeState?.eventLog) ? runtimeState.eventLog : [];
        const objectives = Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : [];
        const resultStats = (runtimeState?.resultStats && typeof runtimeState.resultStats === 'object') ? runtimeState.resultStats : {};
        const resultRules = Array.isArray(runtimeState?.resultRules) ? runtimeState.resultRules : [];

        let result = 'skipped';
        if (played && phase === 'won') result = 'victory';
        if (played && phase === 'lost') result = 'defeat';

        let grade = 'failed';
        if (result === 'victory') {
            if (Number.isFinite(playerHp) && Number.isFinite(playerMaxHp)) {
                const ratio = playerMaxHp > 0 ? (playerHp / playerMaxHp) : 0;
                if (ratio >= 0.75) grade = 'clean';
                else if (ratio >= 0.35) grade = 'wounded';
                else grade = 'desperate';
            } else {
                grade = 'wounded';
            }
        }
        if (result === 'skipped') grade = 'skipped';

        const notableEvents = [];
        for (const evt of eventLog) {
            if (evt?.type === 'boss_phase_threshold') {
                notableEvents.push('boss_phase_' + String(evt?.payload?.phaseIndex || 'x'));
            }
        }
        for (const tag of (Array.isArray(resultStats?.notableEvents) ? resultStats.notableEvents : [])) {
            notableEvents.push(String(tag || ''));
        }
        if (result === 'victory' && Number.isFinite(playerHp) && playerHp <= 1) {
            notableEvents.push('victory_on_last_hit');
        }
        if (result === 'defeat') notableEvents.push('player_defeated');
        if (bossState?.alive === false || (Array.isArray(resultStats?.bossesDefeated) && resultStats.bossesDefeated.length > 0)) notableEvents.push('boss_defeated');

        let narrativeSummary = 'The combat was skipped by the player.';
        if (result === 'victory') narrativeSummary = 'The encounter was won through gameplay.';
        if (result === 'defeat') narrativeSummary = 'The player was defeated in the encounter.';

        const requiredObjectives = objectives.filter((item) => item?.required !== false);
        const optionalObjectives = objectives.filter((item) => item?.optional === true || item?.required === false);
        const completedRequiredObjectives = requiredObjectives.filter((item) => String(item?.status || '') === 'completed').map((item) => String(item?.id || ''));
        const failedObjectives = objectives.filter((item) => String(item?.status || '') === 'failed').map((item) => String(item?.id || ''));
        const optionalCompletedObjectives = optionalObjectives.filter((item) => String(item?.status || '') === 'completed').map((item) => String(item?.id || ''));
        const bossesDefeated = uniqueStrings([
            ...(Array.isArray(resultStats?.bossesDefeated) ? resultStats.bossesDefeated : []),
            bossState?.alive === false ? String(bossState?.bossId || bossState?.enemyTypeId || 'boss') : ''
        ]);
        const playerHpRatio = (Number.isFinite(playerHp) && Number.isFinite(playerMaxHp) && playerMaxHp > 0)
            ? (playerHp / playerMaxHp)
            : 0;
        const durationSeconds = Math.max(0, Math.round(elapsedMs / 1000));
        const objectiveStatus = objectiveMap(objectives);
        const retries = Math.max(0, Number(meta.retries ?? resultStats?.retries) || 0);
        const deaths = Math.max(0, Number(meta.deaths ?? resultStats?.deaths) || 0);

        const snapshot = {
            result,
            played,
            durationSeconds,
            playerHp,
            playerMaxHp,
            playerHpRatio,
            enemiesDefeated: defeatedEnemies,
            bossesDefeated,
            bossDefeated: bossesDefeated.length > 0 || bossState?.alive === false,
            retries,
            deaths,
            objectiveStatus
        };
        const narrativeTags = [];
        for (let i = 0; i < resultRules.length; i += 1) {
            const rule = resultRules[i];
            if (!rule || typeof rule !== 'object') continue;
            if (!evaluateResultRule(rule, snapshot)) continue;
            const tags = uniqueStrings(rule.tags || [rule.tag]);
            for (const tag of tags) narrativeTags.push(tag);
            if (rule.grade && result !== 'skipped') {
                grade = String(rule.grade).toLowerCase();
            }
        }
        if (result === 'victory' && completedRequiredObjectives.length === requiredObjectives.length && requiredObjectives.length > 0) {
            narrativeTags.push('mission_complete');
        }
        if (optionalCompletedObjectives.length > 0) narrativeTags.push('optional_objectives_cleared');

        let suggestedWriterPrompt = 'Resolve the combat narratively without assuming a flawless victory.';
        if (result === 'victory') {
            suggestedWriterPrompt = grade === 'desperate'
                ? 'Continue from a narrow combat victory with visible exhaustion and damage.'
                : 'Continue from a combat victory with momentum but believable fatigue.';
        }
        if (result === 'defeat') {
            suggestedWriterPrompt = 'Continue from a failed combat attempt, retreat, or setback before the next push.';
        }

        return {
            played,
            result,
            grade,
            encounterId,
            encounterTitle,
            durationSeconds,
            playerHpRemaining: Number.isFinite(playerHp) ? playerHp : null,
            playerMaxHp: Number.isFinite(playerMaxHp) ? playerMaxHp : null,
            enemiesDefeated: defeatedEnemies,
            bossDefeated: bossesDefeated.length > 0 || bossState?.alive === false,
            bossesDefeated,
            deaths,
            objectives: {
                requiredTotal: requiredObjectives.length,
                requiredCompleted: completedRequiredObjectives,
                failed: failedObjectives,
                optionalCompleted: optionalCompletedObjectives,
                summary: objectiveStatus,
                snapshot: objectives.map((item) => ({
                    id: String(item?.id || ''),
                    title: String(item?.title || item?.id || ''),
                    required: item?.required !== false,
                    status: String(item?.status || 'inactive'),
                    progress: Number(item?.progress) || 0,
                    target: Number(item?.target) || 0
                }))
            },
            retries,
            notableEvents: uniqueStrings(notableEvents),
            narrativeTags: uniqueStrings(narrativeTags),
            narrativeSummary,
            suggestedWriterPrompt
        };
    }

    window.TDSCombatResultBuilder = {
        buildCombatResult
    };
})();
