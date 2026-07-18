(() => {
    function createAudioController({ bridge = null, payload = null, encounter = null, randomFloat = null, logEvent = null, onWarning = null }) {
        const bridgeAudio = bridge?.audio || null;
        const bridgeAssets = bridge?.assets || null;
        const managedHandles = new Map();
        const recentEvents = [];
        const intensityState = {
            level: 'base',
            changedAtMs: 0,
            activeRuleId: null
        };
        let currentMusic = null;
        let fallbackSnapshot = null;
        let vnDucked = false;

        function rng() {
            if (typeof randomFloat === 'function') return randomFloat();
            return Math.random();
        }

        function pushRecent(type, payloadData = {}) {
            const item = {
                type: String(type || ''),
                at: Date.now(),
                payload: payloadData && typeof payloadData === 'object' ? payloadData : {}
            };
            recentEvents.push(item);
            if (recentEvents.length > 40) recentEvents.splice(0, recentEvents.length - 40);
            if (typeof logEvent === 'function') logEvent('audio_' + item.type, item.payload);
        }

        function warn(message) {
            const text = String(message || '').trim();
            if (!text) return;
            pushRecent('warning', { message: text });
            if (typeof onWarning === 'function') onWarning(text);
        }

        function getBattleChoices() {
            return Array.isArray(payload?.battleOstChoices) ? payload.battleOstChoices.map((item) => String(item || '').trim()).filter(Boolean) : [];
        }

        function pickRandomBattleTrack() {
            const list = getBattleChoices();
            if (!list.length) return '';
            const idx = Math.max(0, Math.min(list.length - 1, Math.floor(rng() * list.length)));
            return String(list[idx] || '').trim();
        }

        function resolveTrackPath(rawValue) {
            const raw = String(rawValue || '').trim();
            if (!raw) return '';
            if (raw === 'battle_random') return pickRandomBattleTrack();
            if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
            if (raw.startsWith('/')) return raw;
            if ((raw.startsWith('project://') || raw.startsWith('plugin://')) && typeof bridgeAssets?.url === 'function') {
                try { return bridgeAssets.url(raw); } catch (_) {}
            }
            const normalized = raw.startsWith('ost/') ? raw : ('ost/' + raw.replace(/^ost\//, ''));
            if (typeof bridgeAssets?.getProjectAssetUrl === 'function') {
                try { return bridgeAssets.getProjectAssetUrl(normalized); } catch (_) {}
            }
            return normalized;
        }

        function readFallbackAudioElement() {
            return document.getElementById('audio-player');
        }

        function captureFallbackSnapshot(audioEl) {
            if (!audioEl || fallbackSnapshot) return;
            fallbackSnapshot = {
                src: audioEl.src || '',
                currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0,
                paused: !!audioEl.paused,
                loop: !!audioEl.loop
            };
        }

        function restoreFallbackSnapshot() {
            const audioEl = readFallbackAudioElement();
            const snapshot = fallbackSnapshot;
            fallbackSnapshot = null;
            if (!audioEl || !snapshot) return;
            try {
                if (snapshot.src) {
                    audioEl.src = snapshot.src;
                    audioEl.loop = !!snapshot.loop;
                    if (Number.isFinite(snapshot.currentTime) && snapshot.currentTime > 0) {
                        try { audioEl.currentTime = snapshot.currentTime; } catch (_) {}
                    }
                    if (snapshot.paused) audioEl.pause();
                    else audioEl.play().catch(() => {});
                } else {
                    audioEl.pause();
                    audioEl.src = '';
                }
            } catch (_) {}
        }

        function stopHandle(handle) {
            if (!handle) return false;
            try {
                if (typeof handle.stop === 'function') {
                    handle.stop();
                    return true;
                }
                if (handle.id && typeof bridgeAudio?.stop === 'function') {
                    bridgeAudio.stop(handle.id);
                    return true;
                }
            } catch (_) {}
            return false;
        }

        function createManagedHandle(path, options = {}, loop = false) {
            const resolvedPath = resolveTrackPath(path);
            if (!resolvedPath) {
                warn('Audio path is empty or unresolved.');
                return null;
            }

            if (bridgeAudio && typeof bridgeAudio.play === 'function') {
                try {
                    const handle = loop && typeof bridgeAudio.loop === 'function'
                        ? bridgeAudio.loop(resolvedPath, options)
                        : bridgeAudio.play(resolvedPath, options);
                    if (handle?.id) managedHandles.set(String(handle.id), handle);
                    return handle || null;
                } catch (error) {
                    warn('Bridge audio playback failed for "' + resolvedPath + '".');
                }
            }

            const audioEl = readFallbackAudioElement();
            if (!audioEl) {
                warn('No fallback audio element available for "' + resolvedPath + '".');
                return null;
            }
            try {
                captureFallbackSnapshot(audioEl);
                audioEl.src = resolvedPath;
                audioEl.loop = !!loop;
                audioEl.currentTime = 0;
                audioEl.play().catch(() => {});
                return { id: 'fallback_audio', stop: () => { try { audioEl.pause(); } catch (_) {} } };
            } catch (_) {
                warn('Fallback audio playback failed for "' + resolvedPath + '".');
                return null;
            }
        }

        function maybeDuckVnAudio(shouldDuck = true, factor = 0.35) {
            if (!shouldDuck) return;
            if (bridgeAudio && typeof bridgeAudio.duckVN === 'function') {
                try {
                    bridgeAudio.duckVN({ factor });
                    vnDucked = true;
                } catch (_) {}
            }
        }

        function restoreVnAudio() {
            if (bridgeAudio && typeof bridgeAudio.restoreVN === 'function') {
                try { bridgeAudio.restoreVN(); } catch (_) {}
            }
            vnDucked = false;
        }

        function stopManagedSounds({ includeMusic = true } = {}) {
            for (const [id, handle] of Array.from(managedHandles.entries())) {
                if (!includeMusic && currentMusic && String(currentMusic.handleId || '') === String(id)) continue;
                stopHandle(handle);
                managedHandles.delete(id);
            }
        }

        function stopCurrentMusic() {
            if (!currentMusic) return;
            const id = String(currentMusic.handleId || '');
            const handle = managedHandles.get(id);
            if (handle) {
                stopHandle(handle);
                managedHandles.delete(id);
            }
            currentMusic = null;
        }

        function setMusic(action = {}) {
            const pathRaw = action.track || action.path || action.music || action.choice || 'battle_random';
            const resolvedPath = resolveTrackPath(pathRaw);
            if (!resolvedPath) {
                warn('set_music could not resolve a track.');
                return false;
            }
            stopCurrentMusic();
            maybeDuckVnAudio(action.duckVn !== false, Number.isFinite(Number(action.duckFactor)) ? Number(action.duckFactor) : 0.35);
            const handle = createManagedHandle(resolvedPath, {
                category: action.category || 'music',
                volume: Number.isFinite(Number(action.volume)) ? Number(action.volume) : 1,
                respectSettings: action.respectSettings !== false,
                loop: true
            }, true);
            if (!handle) return false;
            currentMusic = {
                handleId: String(handle.id || ''),
                track: resolvedPath,
                key: String(action.key || pathRaw || ''),
                startedAtMs: Date.now()
            };
            intensityState.changedAtMs = Date.now();
            pushRecent('set_music', { track: resolvedPath, key: currentMusic.key });
            return true;
        }

        function playSfx(action = {}) {
            const pathRaw = action.path || action.track || action.sfx;
            const resolvedPath = resolveTrackPath(pathRaw);
            if (!resolvedPath) {
                warn('play_sfx could not resolve a track.');
                return false;
            }
            const handle = createManagedHandle(resolvedPath, {
                category: action.category || 'sfx',
                volume: Number.isFinite(Number(action.volume)) ? Number(action.volume) : 1,
                respectSettings: action.respectSettings !== false,
                loop: false
            }, false);
            if (!handle) return false;
            pushRecent('play_sfx', { track: resolvedPath });
            return true;
        }

        function musicStinger(action = {}) {
            const ok = playSfx({ ...action, category: action.category || 'music' });
            if (ok) pushRecent('music_stinger', { track: String(action.path || action.track || action.sfx || '') });
            return ok;
        }

        function intensityTrack(level) {
            const music = encounter?.music || {};
            const tiers = (music.intensityTiers && typeof music.intensityTiers === 'object') ? music.intensityTiers : {};
            const config = tiers[level] || null;
            if (!config) return null;
            if (typeof config === 'string') return config;
            if (config && typeof config === 'object') return config.track || config.path || null;
            return null;
        }

        function setMusicIntensity(action = {}) {
            const level = String(action.level || action.intensity || 'base').toLowerCase();
            const now = Date.now();
            const cooldownMs = Math.max(0, (Number(action.cooldownSeconds) || 0) * 1000);
            if (cooldownMs > 0 && (now - Number(intensityState.changedAtMs || 0)) < cooldownMs) return false;

            intensityState.level = level;
            intensityState.changedAtMs = now;
            if (action.ruleId) intensityState.activeRuleId = String(action.ruleId);

            const tierTrack = action.track || intensityTrack(level);
            if (tierTrack) {
                setMusic({
                    track: tierTrack,
                    key: 'intensity:' + level,
                    duckVn: action.duckVn !== false,
                    duckFactor: action.duckFactor,
                    volume: action.volume
                });
                pushRecent('set_music_intensity', { level, mode: 'track_switch', track: tierTrack });
                return true;
            }

            if (bridgeAudio && typeof bridgeAudio.duckVN === 'function') {
                const factorMap = { low: 0.45, medium: 0.65, high: 0.85, extreme: 1 };
                const factor = Number.isFinite(Number(action.duckFactor)) ? Number(action.duckFactor) : (factorMap[level] || 0.75);
                try {
                    bridgeAudio.duckVN({ factor: Math.max(0, Math.min(1, factor)) });
                    vnDucked = true;
                } catch (_) {}
            }
            pushRecent('set_music_intensity', { level, mode: 'duck' });
            return true;
        }

        function restoreMusic() {
            stopManagedSounds({ includeMusic: true });
            currentMusic = null;
            restoreVnAudio();
            restoreFallbackSnapshot();
            pushRecent('restore_music', {});
            return true;
        }

        function evaluateCondition(rule, runtimeState) {
            const when = (rule?.when && typeof rule.when === 'object') ? rule.when : {};
            const type = String(when.type || '').toLowerCase();
            if (!type) return false;
            const elapsedSec = Math.max(0, Number(runtimeState?.elapsedMs) || 0) / 1000;
            if (type === 'boss_phase_is') return String(runtimeState?.bossState?.phaseId || '') === String(when.phaseId || when.phase || '');
            if (type === 'boss_alive') return !!runtimeState?.bossState;
            if (type === 'enemy_count_at_least') return (Number(runtimeState?.aliveEnemies) || 0) >= (Number(when.count) || 0);
            if (type === 'enemy_count_below') return (Number(runtimeState?.aliveEnemies) || 0) < (Number(when.count) || 0);
            if (type === 'player_hp_ratio_below') {
                const hp = Math.max(0, Number(runtimeState?.playerHp) || 0);
                const max = Math.max(1, Number(runtimeState?.playerMaxHp) || 1);
                return (hp / max) <= Math.max(0, Number(when.ratio) || 0);
            }
            if (type === 'elapsed_seconds_at_least') return elapsedSec >= (Number(when.seconds) || 0);
            if (type === 'objective_completed') {
                const target = String(when.objectiveId || when.objective || '');
                return (Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : []).some((item) => String(item?.id || '') === target && String(item?.status || '') === 'completed');
            }
            if (type === 'objective_failed') {
                const target = String(when.objectiveId || when.objective || '');
                return (Array.isArray(runtimeState?.objectives) ? runtimeState.objectives : []).some((item) => String(item?.id || '') === target && String(item?.status || '') === 'failed');
            }
            return false;
        }

        function processIntensityRules(runtimeState) {
            const rules = Array.isArray(encounter?.music?.intensityRules) ? encounter.music.intensityRules : [];
            if (!rules.length) return;
            const sorted = rules.slice().sort((a, b) => (Number(b?.priority) || 0) - (Number(a?.priority) || 0));
            for (const rule of sorted) {
                if (!rule || typeof rule !== 'object') continue;
                if (!evaluateCondition(rule, runtimeState)) continue;
                const cooldownSeconds = Math.max(0, Number(rule.cooldownSeconds) || 0);
                const level = String(rule.setIntensity || rule.level || 'base').toLowerCase();
                if (level === intensityState.level && intensityState.activeRuleId === String(rule.id || '')) return;
                setMusicIntensity({
                    level,
                    ruleId: String(rule.id || ''),
                    cooldownSeconds,
                    track: rule.track || null,
                    duckFactor: rule.duckFactor
                });
                return;
            }
        }

        function getDebugState() {
            return {
                currentMusic: currentMusic ? { ...currentMusic } : null,
                intensity: { ...intensityState },
                activeManagedAudioCount: managedHandles.size,
                vnDucked: !!vnDucked,
                recentAudioEvents: recentEvents.slice(-12)
            };
        }

        function dispose() {
            restoreMusic();
        }

        return {
            setMusic,
            restoreMusic,
            playSfx,
            musicStinger,
            setMusicIntensity,
            processIntensityRules,
            getDebugState,
            dispose
        };
    }

    window.TDSAudioController = {
        create: createAudioController
    };
})();
