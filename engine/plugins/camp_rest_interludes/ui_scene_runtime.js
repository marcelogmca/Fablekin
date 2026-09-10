(() => {
    const ACTOR_LOGICAL_HEIGHT = 420;
    const POSITION_SWAP_INTERVAL_MS = 30000;
    const CONVO_STEP_MIN_MS = 3000;
    const CONVO_STEP_MAX_MS = 8000;
    const CONVO_PAUSE_MIN_MS = 450;
    const CONVO_PAUSE_MAX_MS = 1400;
    const CONVO_EMOTION_PULSE_MIN_MS = 1800;
    const CONVO_EMOTION_PULSE_MAX_MS = 4600;
    const CONVO_SPEAKER_EMOTION_CHANCE = 0.42;
    const CONVO_LISTENER_EMOTION_CHANCE = 0.12;
    const CONVO_AMBIENT_EMOTION_CHANCE = 0.65;
    const DEFAULT_LOGICAL_HEIGHT = 1080;
    const CONVO_SLOT_BIAS_CHANCE = 0.92;
    const CONVO_SLOT_WEIGHT = 4.75;
    const SOLO_SLOT_WEIGHT = 1.0;
    const POSITION_FADE_DOWN_ALPHA = 0;
    const POSITION_FADE_DOWN_MS = 4000;
    const POSITION_FADE_UP_MS = 4000;
    const INITIAL_LAYOUT_RETRY_COUNT = 8;
    const INITIAL_LAYOUT_RETRY_DELAY_MS = 450;
    const ENABLE_CONVERSATION_ACTOR_UPDATES = true;

    function normalizeDirection(value) {
        const dir = String(value || '').trim().toLowerCase();
        return dir === 'left' ? 'left' : 'right';
    }

    function normalizeCharacterKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function randomBetween(min, max) {
        const lower = Math.max(0, Number(min) || 0);
        const upper = Math.max(lower, Number(max) || lower);
        return Math.floor(lower + Math.random() * (upper - lower + 1));
    }

    function randomDirection() {
        return Math.random() < 0.5 ? 'left' : 'right';
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function shuffled(list) {
        const arr = Array.isArray(list) ? [...list] : [];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function dedupePositions(list) {
        const out = [];
        const seen = new Set();
        for (const entry of Array.isArray(list) ? list : []) {
            const x = Number(entry?.x);
            const y = Number(entry?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const key = positionKey(entry);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(entry);
        }
        return out;
    }

    function positionKey(position) {
        const x = Number(position?.x);
        const y = Number(position?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
        return `${Math.round(x * 10) / 10}:${Math.round(y * 10) / 10}`;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    window.CampRestSceneRuntime = function createCampRestSceneRuntime({
        bridge,
        allCharacters,
        campScene,
        campSpriteProfiles
    }) {
        const actorApi = bridge?.actors || null;
        const backgroundApi = bridge?.background || null;
        const profiles = (campSpriteProfiles && typeof campSpriteProfiles === 'object') ? campSpriteProfiles : {};
        const logicalHeight = Number.isFinite(Number(window?.pixiApp?.LOGICAL_HEIGHT))
            ? Number(window.pixiApp.LOGICAL_HEIGHT)
            : DEFAULT_LOGICAL_HEIGHT;
        const parsedPerspectiveFar = Number(campScene?.perspectiveScaleFar);
        const parsedPerspectiveNear = Number(campScene?.perspectiveScaleNearby);
        const fallbackPerspectiveRatio = Number(campScene?.perspectiveRatio);
        let perspectiveScaleFar = Number.isFinite(parsedPerspectiveFar)
            ? parsedPerspectiveFar
            : (Number.isFinite(fallbackPerspectiveRatio) ? fallbackPerspectiveRatio : 1);
        let perspectiveScaleNearby = Number.isFinite(parsedPerspectiveNear)
            ? parsedPerspectiveNear
            : perspectiveScaleFar;
        // Layout authoring can accidentally invert near/far values. We normalize so
        // lower-on-screen actors (higher Y) remain the larger "nearby" subjects.
        if (perspectiveScaleFar > perspectiveScaleNearby) {
            const tmp = perspectiveScaleFar;
            perspectiveScaleFar = perspectiveScaleNearby;
            perspectiveScaleNearby = tmp;
        }
        const campShadow = (campScene?.shadow && typeof campScene.shadow === 'object' && campScene.shadow.enabled === true)
            ? { ...campScene.shadow, enabled: true }
            : null;
        let campBackgroundApplied = false;
        let overlayAlive = true;
        let layoutTimer = null;
        let layoutInFlight = false;
        let convoGeneration = 0;
        let aliveBgParallaxOverridden = false;
        let aliveBgHadOwnParallax = false;
        let aliveBgPreviousParallax = true;
        const convoTimeouts = new Map();
        const actorStates = new Map();

        const scenePositions = Array.isArray(campScene?.positions)
            ? campScene.positions
                .map((entry, index) => {
                    const x = Number(entry?.x);
                    const y = Number(entry?.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                    return {
                        x,
                        y,
                        direction: typeof entry?.direction === 'string' && entry.direction.trim()
                            ? normalizeDirection(entry.direction)
                            : null,
                        slot: String(entry?.slot || `slot_${index + 1}`).trim()
                    };
                })
                .filter(Boolean)
            : [];

        const getFallbackPositions = (count) => {
            const normalizedCount = Math.max(1, Math.min(3, Number(count) || 1));
            const spacing = 290;
            const centerX = 980;
            const baseY = 1020;
            const startX = centerX - ((normalizedCount - 1) * spacing) / 2;
            const out = [];
            for (let i = 0; i < normalizedCount; i++) {
                out.push({
                    x: startX + (i * spacing),
                    y: baseY,
                    direction: null,
                    slot: `fallback_${i + 1}`
                });
            }
            return out;
        };

        const getProfileForCharacter = (characterName) => {
            const key = normalizeCharacterKey(characterName);
            return profiles[key] || null;
        };

        const pickRandomEmotion = (profile) => {
            const emotions = Array.isArray(profile?.emotions) ? profile.emotions.filter(Boolean) : [];
            if (emotions.length === 0) return 'neutral';
            return emotions[Math.floor(Math.random() * emotions.length)] || 'neutral';
        };

        const buildSpriteCandidatesForState = (profile, requestedEmotion, requestedDirection) => {
            const direction = normalizeDirection(requestedDirection);
            const emotionMap = profile?.byEmotion && typeof profile.byEmotion === 'object' ? profile.byEmotion : {};
            const availableEmotions = Object.keys(emotionMap);
            const emotionCandidates = [];
            const normalizedRequestedEmotion = normalizeCharacterKey(requestedEmotion || '');
            if (normalizedRequestedEmotion) emotionCandidates.push(normalizedRequestedEmotion);
            if (!emotionCandidates.includes('neutral')) emotionCandidates.push('neutral');
            for (const emo of availableEmotions) {
                if (!emotionCandidates.includes(emo)) emotionCandidates.push(emo);
            }

            const candidates = [];
            const seen = new Set();
            const addCandidate = (spritePath, emotion, hasDirectionalRotation) => {
                const pathKey = String(spritePath || '').trim();
                if (!pathKey) return;
                if (seen.has(pathKey)) return;
                seen.add(pathKey);
                candidates.push({
                    spritePath: pathKey,
                    emotion: emotion || normalizedRequestedEmotion || 'neutral',
                    hasDirectionalRotation: hasDirectionalRotation === true
                });
            };

            for (const emotionKey of emotionCandidates) {
                const bucket = emotionMap[emotionKey];
                if (!bucket || typeof bucket !== 'object') continue;

                addCandidate(bucket[direction], emotionKey, true);
                addCandidate(bucket.front, emotionKey, false);
                addCandidate(bucket.any, emotionKey, false);
            }

            if (profile?.fallbackSprite) {
                addCandidate(profile.fallbackSprite, normalizedRequestedEmotion || 'neutral', false);
            }

            return candidates;
        };

        const applyCampBackground = () => {
            if (!campScene?.backgroundUrl) return;
            if (!backgroundApi || typeof backgroundApi.set !== 'function') return;
            try {
                const result = backgroundApi.set({
                    src: String(campScene.backgroundUrl),
                    isVideo: campScene.backgroundIsVideo === true,
                    instant: true
                });
                campBackgroundApplied = result?.ok !== false;
            } catch (error) {
                console.warn('[camp_rest_test] Failed to set camp background:', error?.message || error);
            }
        };

        const applyAliveBgSettingsUpdate = () => {
            try {
                if (window.__ALIVE_PIPELINE && typeof window.__ALIVE_PIPELINE.update === 'function') {
                    window.__ALIVE_PIPELINE.update(window.ALIVE_BG_SETTINGS || {});
                }
            } catch (_) { }
            try {
                if (window.__ALIVE_BG && typeof window.__ALIVE_BG.onSettingsUpdated === 'function') {
                    window.__ALIVE_BG.onSettingsUpdated(window.ALIVE_BG_SETTINGS || {});
                }
            } catch (_) { }
        };

        const disableAliveBgParallaxForOverlay = () => {
            if (!window.ALIVE_BG_SETTINGS || typeof window.ALIVE_BG_SETTINGS !== 'object') return;
            if (!window.__ALIVE_PIPELINE && !window.__ALIVE_BG) return;

            const settings = window.ALIVE_BG_SETTINGS;
            aliveBgHadOwnParallax = Object.prototype.hasOwnProperty.call(settings, 'enable_parallax');
            aliveBgPreviousParallax = settings.enable_parallax !== false;

            if (settings.enable_parallax === false) return;
            settings.enable_parallax = false;
            aliveBgParallaxOverridden = true;
            applyAliveBgSettingsUpdate();
        };

        const restoreAliveBgParallaxForOverlay = () => {
            if (!aliveBgParallaxOverridden) return;
            if (!window.ALIVE_BG_SETTINGS || typeof window.ALIVE_BG_SETTINGS !== 'object') return;
            const settings = window.ALIVE_BG_SETTINGS;

            if (aliveBgHadOwnParallax) {
                settings.enable_parallax = !!aliveBgPreviousParallax;
            } else {
                delete settings.enable_parallax;
            }
            applyAliveBgSettingsUpdate();
            aliveBgParallaxOverridden = false;
        };

        const restoreCampBackground = () => {
            if (!campBackgroundApplied) return;
            if (!backgroundApi || typeof backgroundApi.restore !== 'function') return;
            try {
                backgroundApi.restore({ instant: false });
            } catch (error) {
                console.warn('[camp_rest_test] Failed to restore camp background:', error?.message || error);
            }
            campBackgroundApplied = false;
        };

        const releaseCampBackground = () => {
            campBackgroundApplied = false;
        };

        const resetCameraForOverlay = (duration = 0) => {
            const finalDuration = Number.isFinite(Number(duration))
                ? Math.max(0, Number(duration))
                : 0;
            try {
                if (window?.VN?.cam && typeof window.VN.cam.reset === 'function') {
                    window.VN.cam.reset(finalDuration);
                    return;
                }
            } catch (_) { }

            try {
                window.dispatchEvent(new CustomEvent('vn:cam-reset', {
                    detail: {
                        duration: finalDuration,
                        instant: finalDuration === 0
                    }
                }));
            } catch (_) { }
        };

        const clearCampActors = () => {
            if (!actorApi || typeof actorApi.clear !== 'function') return;
            try { actorApi.clear('camp-overlay-dismiss'); } catch (_) { }
            actorStates.clear();
        };

        const stopConversationLoops = () => {
            convoGeneration += 1;
            for (const handle of convoTimeouts.values()) {
                try { clearTimeout(handle); } catch (_) { }
            }
            convoTimeouts.clear();
        };

        const stopLayoutLoop = () => {
            if (layoutTimer) {
                try { clearInterval(layoutTimer); } catch (_) { }
                layoutTimer = null;
            }
        };

        const resolveActiveCharacters = () => {
            const all = (Array.isArray(allCharacters) ? allCharacters : [])
                .map(c => String(c || '').trim())
                .filter(c => c.length > 0)
                .slice(0, 10);
            const withProfiles = all.filter(name => !!getProfileForCharacter(name));
            return (withProfiles.length > 0 ? withProfiles : all);
        };

        const analyzeCampLayout = (sourcePositions) => {
            const grouped = new Map();
            for (let i = 0; i < sourcePositions.length; i++) {
                const entry = sourcePositions[i];
                const slotRaw = String(entry?.slot || '').trim().toLowerCase();
                const fallbackSlot = positionKey(entry) || `pos_${i + 1}`;
                const slotKey = slotRaw || fallbackSlot;
                if (!grouped.has(slotKey)) {
                    grouped.set(slotKey, {
                        slotKey,
                        positions: []
                    });
                }
                grouped.get(slotKey).positions.push(entry);
            }

            const clusters = Array.from(grouped.values())
                .map((cluster) => {
                    const positions = dedupePositions(cluster.positions);
                    return {
                        slotKey: cluster.slotKey,
                        positions,
                        capacity: positions.length,
                        isConversation: positions.length >= 2
                    };
                })
                .filter((cluster) => cluster.capacity > 0);

            const conversationClusters = clusters
                .filter((cluster) => cluster.isConversation)
                .sort((a, b) => {
                    if (b.capacity !== a.capacity) return b.capacity - a.capacity;
                    return a.slotKey.localeCompare(b.slotKey);
                });

            const largestConversationCapacity = conversationClusters.length > 0
                ? conversationClusters[0].capacity
                : 0;

            const rankMap = new Map();
            for (let i = 0; i < conversationClusters.length; i++) {
                rankMap.set(conversationClusters[i].slotKey, i);
            }

            return {
                clusters,
                conversationClusters,
                largestConversationCapacity,
                rankMap
            };
        };

        const pickWeightedIndex = (items, randomize = true) => {
            if (!Array.isArray(items) || items.length === 0) return -1;
            if (!randomize) {
                let bestIndex = 0;
                let bestScore = Number(items[0]?.score) || 0;
                for (let i = 1; i < items.length; i++) {
                    const score = Number(items[i]?.score) || 0;
                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = i;
                    }
                }
                return bestIndex;
            }

            const totalWeight = items.reduce((sum, item) => {
                return sum + Math.max(0.001, Number(item?.score) || 0.001);
            }, 0);
            let roll = Math.random() * totalWeight;
            for (let i = 0; i < items.length; i++) {
                roll -= Math.max(0.001, Number(items[i]?.score) || 0.001);
                if (roll <= 0) return i;
            }
            return Math.max(0, items.length - 1);
        };

        const planClusterOccupancy = (layout, characterCount, randomize = true) => {
            const clusters = Array.isArray(layout?.clusters) ? layout.clusters : [];
            if (clusters.length === 0 || characterCount <= 0) return new Map();

            const maxCharacters = Math.min(
                Math.max(0, Number(characterCount) || 0),
                clusters.reduce((sum, cluster) => sum + cluster.capacity, 0)
            );
            const occupancy = new Map(clusters.map((cluster) => [cluster.slotKey, 0]));
            const rankMap = layout.rankMap || new Map();
            const largestConversationCapacity = Math.max(2, Number(layout?.largestConversationCapacity) || 2);
            const conversationClusters = Array.isArray(layout?.conversationClusters) ? layout.conversationClusters : [];

            // Not every cycle should strongly cluster in the same way.
            const biasGate = randomize ? (Math.random() < CONVO_SLOT_BIAS_CHANCE ? 1 : 0.58) : 1;
            const convoWeightScalar = biasGate * Math.max(0.5, Number(CONVO_SLOT_WEIGHT) || 1);
            const soloWeightScalar = Math.max(0.5, Number(SOLO_SLOT_WEIGHT) || 1);

            let remaining = maxCharacters;
            while (remaining > 0) {
                const hasConversationPair = conversationClusters.some((cluster) => {
                    return (occupancy.get(cluster.slotKey) || 0) >= 2;
                });

                const candidates = [];
                for (const cluster of clusters) {
                    const current = occupancy.get(cluster.slotKey) || 0;
                    if (current >= cluster.capacity) continue;

                    const next = current + 1;
                    const rank = rankMap.has(cluster.slotKey) ? rankMap.get(cluster.slotKey) : null;
                    const rankNorm = (rank === null || conversationClusters.length <= 1)
                        ? 0
                        : (1 - (rank / (conversationClusters.length - 1)));
                    const sizeNorm = cluster.isConversation
                        ? clamp(cluster.capacity / largestConversationCapacity, 0.25, 1.25)
                        : 0.25;

                    let score = 1;

                    if (cluster.isConversation) {
                        score *= (1.05 + (sizeNorm * 1.15 * convoWeightScalar * 0.35));
                        score *= (1 + (rankNorm * 0.45 * biasGate));
                        if (remaining > 1) {
                            score *= (1 + Math.max(0, cluster.capacity - 2) * 0.06 * biasGate);
                        }
                    } else {
                        score *= (0.72 * soloWeightScalar);
                    }

                    // Existing occupancy attracts additional members (soft clustering).
                    if (current > 0) {
                        score *= (1 + Math.min(1.25, current * 0.42));
                    }

                    // Strong boost to complete conversation pairs.
                    if (cluster.isConversation && current === 1) {
                        score *= 1.95;
                    }

                    // Ensure at least one conversation pair forms early when possible.
                    if (cluster.isConversation && current === 0 && !hasConversationPair && remaining >= 2) {
                        score *= 1.28;
                    }

                    // Soft saturation: do not always fill big clusters to hard capacity.
                    const softCap = cluster.isConversation ? Math.min(cluster.capacity, 3) : 1;
                    if (next > softCap) {
                        const overflow = next - softCap;
                        score *= Math.max(0.3, 1 - (overflow * 0.34));
                    }
                    const fillRatio = next / Math.max(1, cluster.capacity);
                    if (fillRatio > 0.85) {
                        score *= 0.64;
                    }

                    // If many characters remain, prefer conversation zones over solo seats.
                    if (!cluster.isConversation && remaining > 2) {
                        score *= 0.78;
                    }

                    if (randomize) {
                        score *= (0.84 + (Math.random() * 0.32));
                    }

                    candidates.push({
                        cluster,
                        score: Math.max(0.001, Number(score) || 0.001)
                    });
                }

                if (candidates.length === 0) break;
                const pickedIndex = pickWeightedIndex(candidates, randomize);
                if (pickedIndex < 0) break;

                const pickedCluster = candidates[pickedIndex].cluster;
                occupancy.set(
                    pickedCluster.slotKey,
                    (occupancy.get(pickedCluster.slotKey) || 0) + 1
                );
                remaining -= 1;
            }

            return occupancy;
        };

        const buildAssignments = (characters, randomize = true) => {
            const sourcePositions = dedupePositions(scenePositions.length > 0 ? scenePositions : getFallbackPositions(characters.length));
            if (!Array.isArray(sourcePositions) || sourcePositions.length === 0) return [];

            const layout = analyzeCampLayout(sourcePositions);
            if (!Array.isArray(layout.clusters) || layout.clusters.length === 0) return [];

            const maxCount = Math.min(
                characters.length,
                sourcePositions.length
            );
            if (maxCount <= 0) return [];

            const characterPool = randomize
                ? shuffled(characters).slice(0, maxCount)
                : characters.slice(0, maxCount);
            const occupancyPlan = planClusterOccupancy(layout, characterPool.length, randomize);

            const clustersToUse = layout.clusters
                .filter((cluster) => (occupancyPlan.get(cluster.slotKey) || 0) > 0)
                .sort((a, b) => {
                    const occA = occupancyPlan.get(a.slotKey) || 0;
                    const occB = occupancyPlan.get(b.slotKey) || 0;
                    if (occB !== occA) return occB - occA;
                    if (b.capacity !== a.capacity) return b.capacity - a.capacity;
                    return a.slotKey.localeCompare(b.slotKey);
                });

            const assignments = [];
            let characterIndex = 0;

            for (const cluster of clustersToUse) {
                const targetCount = Math.min(
                    occupancyPlan.get(cluster.slotKey) || 0,
                    cluster.capacity,
                    characterPool.length - characterIndex
                );
                if (targetCount <= 0) continue;

                const availablePositions = randomize
                    ? shuffled(cluster.positions)
                    : [...cluster.positions];

                for (let i = 0; i < targetCount; i++) {
                    if (characterIndex >= characterPool.length) break;
                    const character = characterPool[characterIndex];
                    const currentState = actorStates.get(normalizeCharacterKey(character));
                    const currentKey = positionKey(currentState?.currentPosition);

                    let pickIndex = i % availablePositions.length;
                    if (currentKey && availablePositions.length > 1) {
                        const altIdx = availablePositions.findIndex((pos) => positionKey(pos) !== currentKey);
                        if (altIdx >= 0) pickIndex = altIdx;
                    }

                    const [pickedPosition] = availablePositions.splice(pickIndex, 1);
                    assignments.push({
                        character,
                        position: pickedPosition || cluster.positions[i % cluster.positions.length],
                        index: assignments.length
                    });
                    characterIndex += 1;
                }
            }

            // Safety fallback in case plan/assignment under-fills due to edge constraints.
            if (assignments.length < characterPool.length) {
                const assignedCharacters = new Set(assignments.map((entry) => entry.character));
                const unassigned = characterPool.filter((character) => !assignedCharacters.has(character));
                const usedPosKeys = new Set(assignments.map((entry) => positionKey(entry.position)));
                const freePositions = sourcePositions.filter((pos) => !usedPosKeys.has(positionKey(pos)));
                const fallbackPositions = randomize ? shuffled(freePositions) : freePositions;
                for (const character of unassigned) {
                    const position = fallbackPositions.shift();
                    if (!position) break;
                    assignments.push({
                        character,
                        position,
                        index: assignments.length
                    });
                }
            }

            return assignments.slice(0, maxCount);
        };

        const ensureActorState = (characterName) => {
            const character = String(characterName || '').trim();
            const key = normalizeCharacterKey(character);
            if (!key) return null;
            if (!actorStates.has(key)) {
                actorStates.set(key, {
                    key,
                    character,
                    actorId: `camp_${key}`,
                    profile: getProfileForCharacter(character),
                    spawned: false,
                    updateChain: Promise.resolve(),
                    lockSpritePath: false,
                    currentSpritePath: '',
                    currentSpriteUsesDirectional: false,
                    currentAlpha: 1,
                    currentZIndex: 50,
                    currentDirection: 'right',
                    currentEmotion: 'neutral',
                    currentSlot: '',
                    currentPosition: null
                });
            }
            return actorStates.get(key);
        };

        const upsertActorVisual = async (state, { position, direction, emotion, talking = false, zIndex = 50, alpha = null, forceSpriteRefresh = false } = {}) => {
            if (!overlayAlive || !state || !actorApi) return;

            const run = async () => {
                const preferredDirection = normalizeDirection(direction || state.currentDirection || 'right');
                const profile = state.profile || getProfileForCharacter(state.character);
                const capabilities = profile?.capabilities || {};
                const requestedEmotion = emotion || state.currentEmotion || pickRandomEmotion(profile);
                const spriteCandidates = buildSpriteCandidatesForState(profile, requestedEmotion, preferredDirection);
                const shouldForceSpriteRefresh = forceSpriteRefresh === true;
                const currentSpritePath = String(state.currentSpritePath || '').trim();

                const candidatePool = [];
                const seenCandidates = new Set();
                const addCandidate = (candidate) => {
                    const resolvedPath = String(candidate?.spritePath || '').trim();
                    if (!resolvedPath) return;
                    if (seenCandidates.has(resolvedPath)) return;
                    seenCandidates.add(resolvedPath);
                    candidatePool.push({
                        spritePath: resolvedPath,
                        emotion: candidate?.emotion || requestedEmotion || 'neutral',
                        hasDirectionalRotation: candidate?.hasDirectionalRotation === true
                    });
                };

                if (shouldForceSpriteRefresh && Array.isArray(spriteCandidates)) {
                    for (const candidate of spriteCandidates) addCandidate(candidate);
                }

                if (currentSpritePath) {
                    addCandidate({
                        spritePath: currentSpritePath,
                        emotion: state.currentEmotion || requestedEmotion || 'neutral',
                        hasDirectionalRotation: state.currentSpriteUsesDirectional === true
                    });
                }

                if ((!state.spawned || shouldForceSpriteRefresh) && Array.isArray(spriteCandidates)) {
                    for (const candidate of spriteCandidates) addCandidate(candidate);
                }

                const refreshCandidate = shouldForceSpriteRefresh
                    ? (
                        candidatePool.find((candidate) => candidate.spritePath !== currentSpritePath)
                        || candidatePool.find((candidate) => !!candidate.spritePath)
                        || null
                    )
                    : null;
                const resolvedEmotion = refreshCandidate?.emotion || requestedEmotion || state.currentEmotion || 'neutral';
                const resolvedDirectionalSprite = refreshCandidate
                    ? (refreshCandidate.hasDirectionalRotation === true)
                    : (state.currentSpriteUsesDirectional === true);

                const rawY = Number(position?.y);
                const yNorm = Number.isFinite(rawY) ? clamp(rawY / Math.max(1, logicalHeight), 0, 1) : 1;
                const perspectiveScale = perspectiveScaleFar + ((perspectiveScaleNearby - perspectiveScaleFar) * yNorm);
                const metadataScale = Number(profile?.metadataScale);
                const characterScale = Number.isFinite(metadataScale) && metadataScale > 0
                    ? metadataScale
                    : 1;
                const effectiveHeight = ACTOR_LOGICAL_HEIGHT * Math.max(0.05, perspectiveScale) * characterScale;
                const requestedAlpha = Number(alpha);
                const resolvedAlpha = Number.isFinite(requestedAlpha)
                    ? clamp(requestedAlpha, 0, 1)
                    : null;

                const basePatch = {
                    x: Number(position?.x),
                    y: rawY,
                    height: effectiveHeight,
                    zIndex,
                    hasBlink: capabilities.hasBlink === true,
                    hasTalk: capabilities.hasTalk === true,
                    hasTalkBlink: capabilities.hasTalkBlink === true,
                    talking: !!talking
                };
                if (campShadow) {
                    basePatch.shadow = campShadow;
                }
                if (resolvedAlpha !== null) {
                    basePatch.alpha = resolvedAlpha;
                }
                if (state.spawned) {
                    basePatch.flipX = resolvedDirectionalSprite
                        ? 1
                        : (preferredDirection === 'left' ? -1 : 1);
                }

                // Spawn path (first-time / recovered)
                if (!state.spawned && typeof actorApi.spawn === 'function') {
                    let lastError = null;

                    for (const candidate of candidatePool) {
                        const resolvedSpritePath = String(candidate?.spritePath || '').trim();
                        if (!resolvedSpritePath) continue;
                        try {
                            const spawnPatch = {
                                ...basePatch,
                                flipX: candidate?.hasDirectionalRotation === true
                                    ? 1
                                    : (preferredDirection === 'left' ? -1 : 1)
                            };
                            const spawned = await actorApi.spawn({
                                actorId: state.actorId,
                                character: state.character,
                                ...spawnPatch,
                                spritePath: resolvedSpritePath
                            });
                            if (!spawned) {
                                throw new Error(`Spawn returned no actor handle for '${state.actorId}'.`);
                            }
                            state.spawned = true;
                            state.lockSpritePath = true;
                            state.currentSpritePath = resolvedSpritePath;
                            state.currentSpriteUsesDirectional = candidate?.hasDirectionalRotation === true;
                            state.currentEmotion = candidate?.emotion || requestedEmotion || state.currentEmotion;
                            state.currentDirection = preferredDirection;
                            state.currentPosition = position || state.currentPosition;
                            state.currentSlot = String(position?.slot || state.currentSlot || '');
                            state.currentZIndex = Number.isFinite(Number(zIndex)) ? Number(zIndex) : state.currentZIndex;
                            if (resolvedAlpha !== null) state.currentAlpha = resolvedAlpha;
                            return;
                        } catch (error) {
                            lastError = error;
                        }
                    }

                    // Fallback: spawn from native character reference (stable even when generated paths are imperfect).
                    try {
                        const referenceSpawnPatch = {
                            ...basePatch,
                            flipX: preferredDirection === 'left' ? -1 : 1
                        };
                        const spawned = await actorApi.spawn({
                            actorId: state.actorId,
                            character: state.character,
                            referenceCharacter: state.character,
                            ...referenceSpawnPatch
                        });
                        if (!spawned) {
                            throw new Error(`Reference spawn returned no actor handle for '${state.actorId}'.`);
                        }
                        state.spawned = true;
                        state.lockSpritePath = true;
                        state.currentSpritePath = '';
                        state.currentSpriteUsesDirectional = false;
                        state.currentEmotion = requestedEmotion || state.currentEmotion;
                        state.currentDirection = preferredDirection;
                        state.currentPosition = position || state.currentPosition;
                        state.currentSlot = String(position?.slot || state.currentSlot || '');
                        state.currentZIndex = Number.isFinite(Number(zIndex)) ? Number(zIndex) : state.currentZIndex;
                        if (resolvedAlpha !== null) state.currentAlpha = resolvedAlpha;
                        return;
                    } catch (fallbackError) {
                        console.warn(
                            '[camp_rest_test] Failed to spawn actor visual:',
                            state.character,
                            fallbackError?.message || fallbackError,
                            '| initial error:',
                            lastError?.message || lastError || 'unknown'
                        );
                        return;
                    }
                }

                // Update path (stable sprite, transform + alpha + talking only)
                if (typeof actorApi.update === 'function') {
                    const updatePatch = { ...basePatch };
                    if (
                        shouldForceSpriteRefresh
                        && refreshCandidate?.spritePath
                        && refreshCandidate.spritePath !== currentSpritePath
                    ) {
                        updatePatch.spritePath = refreshCandidate.spritePath;
                        updatePatch.hasBlink = capabilities.hasBlink === true;
                        updatePatch.hasTalk = capabilities.hasTalk === true;
                        updatePatch.hasTalkBlink = capabilities.hasTalkBlink === true;
                        updatePatch.flipX = refreshCandidate.hasDirectionalRotation === true
                            ? 1
                            : (preferredDirection === 'left' ? -1 : 1);
                    }

                    let updated = null;
                    try {
                        updated = await actorApi.update(state.actorId, updatePatch);
                    } catch (error) {
                        console.warn('[camp_rest_test] Actor update failed; attempting recovery:', state.character, error?.message || error);
                    }
                    if (!updated) {
                        // Recover on session map loss: force respawn using current known path or reference fallback.
                        state.spawned = false;
                        if (typeof actorApi.spawn === 'function') {
                            let recovered = false;
                            const currentPath = String(state.currentSpritePath || '').trim();
                            if (currentPath) {
                                try {
                                    const respawnPatch = {
                                        ...basePatch,
                                        flipX: state.currentSpriteUsesDirectional === true
                                            ? 1
                                            : (preferredDirection === 'left' ? -1 : 1)
                                    };
                                    const respawned = await actorApi.spawn({
                                        actorId: state.actorId,
                                        character: state.character,
                                        ...respawnPatch,
                                        spritePath: currentPath
                                    });
                                    recovered = !!respawned;
                                } catch (_) { }
                            }
                            if (!recovered) {
                                try {
                                    const referenceRespawnPatch = {
                                        ...basePatch,
                                        flipX: preferredDirection === 'left' ? -1 : 1
                                    };
                                    const respawned = await actorApi.spawn({
                                        actorId: state.actorId,
                                        character: state.character,
                                        referenceCharacter: state.character,
                                        ...referenceRespawnPatch
                                    });
                                    recovered = !!respawned;
                                    if (recovered) {
                                        state.currentSpritePath = '';
                                        state.currentSpriteUsesDirectional = false;
                                        state.lockSpritePath = true;
                                    }
                                } catch (_) { }
                            }
                            if (!recovered) {
                                console.warn('[camp_rest_test] Failed to recover actor after update miss:', state.character);
                                return;
                            }
                            state.spawned = true;
                        } else {
                            return;
                        }
                    }

                    if (shouldForceSpriteRefresh && refreshCandidate?.spritePath) {
                        state.currentSpritePath = refreshCandidate.spritePath;
                        state.currentSpriteUsesDirectional = refreshCandidate.hasDirectionalRotation === true;
                    }
                }

                state.currentDirection = preferredDirection;
                state.currentEmotion = resolvedEmotion;
                state.currentPosition = position || state.currentPosition;
                state.currentSlot = String(position?.slot || state.currentSlot || '');
                state.currentZIndex = Number.isFinite(Number(zIndex)) ? Number(zIndex) : state.currentZIndex;
                if (resolvedAlpha !== null) {
                    state.currentAlpha = resolvedAlpha;
                }
            };

            const previous = state.updateChain || Promise.resolve();
            const next = previous.then(run, run);
            const tracked = next.catch(() => { });
            state.updateChain = tracked;
            tracked.finally(() => {
                if (state.updateChain === tracked) {
                    state.updateChain = Promise.resolve();
                }
            }).catch(() => { });
            return next;
        };

        const hasPositionChanged = (beforePosition, afterPosition) => {
            if (!beforePosition || !afterPosition) return true;
            const beforeX = Number(beforePosition.x);
            const beforeY = Number(beforePosition.y);
            const afterX = Number(afterPosition.x);
            const afterY = Number(afterPosition.y);
            const beforeSlot = String(beforePosition.slot || '').trim();
            const afterSlot = String(afterPosition.slot || '').trim();
            if (beforeSlot !== afterSlot) return true;
            if (!Number.isFinite(beforeX) || !Number.isFinite(beforeY) || !Number.isFinite(afterX) || !Number.isFinite(afterY)) return true;
            return Math.abs(beforeX - afterX) > 0.5 || Math.abs(beforeY - afterY) > 0.5;
        };

        const fadeActorAlpha = async (state, fromAlpha, toAlpha, durationMs) => {
            if (!overlayAlive || !state) return;
            if (!state.currentPosition) return;
            const start = clamp(Number.isFinite(Number(fromAlpha)) ? Number(fromAlpha) : (Number.isFinite(state.currentAlpha) ? state.currentAlpha : 1), 0, 1);
            const end = clamp(Number.isFinite(Number(toAlpha)) ? Number(toAlpha) : start, 0, 1);
            const duration = Math.max(50, Number(durationMs) || 0);
            const steps = Math.max(2, Math.round(duration / 90));
            const stepMs = duration / steps;

            for (let i = 1; i <= steps; i++) {
                if (!overlayAlive) return;
                const t = i / steps;
                const alpha = start + ((end - start) * t);
                await upsertActorVisual(state, {
                    position: state.currentPosition,
                    direction: state.currentDirection,
                    emotion: state.currentEmotion || 'neutral',
                    talking: false,
                    zIndex: Number.isFinite(state.currentZIndex) ? state.currentZIndex : 50,
                    alpha
                });
                if (i < steps) {
                    await sleep(stepMs);
                }
            }
        };

        const applyLayout = async (randomize = true) => {
            if (!overlayAlive || layoutInFlight) return;
            if (!actorApi || typeof actorApi.spawn !== 'function') return;

            const candidates = resolveActiveCharacters();
            if (candidates.length === 0) return;
            const assignments = buildAssignments(candidates, randomize);
            if (assignments.length === 0) return;

            layoutInFlight = true;
            try {
                stopConversationLoops();
                const prepared = [];
                for (const row of assignments) {
                    const state = ensureActorState(row.character);
                    if (!state) continue;
                    state.currentPosition = state.currentPosition || row.position;
                    state.currentDirection = state.currentDirection || row.position?.direction || 'right';
                    state.currentZIndex = Number.isFinite(state.currentZIndex) ? state.currentZIndex : (50 + row.index);
                    const moved = state.spawned === true && hasPositionChanged(state.currentPosition, row.position);
                    const shouldRefreshPose = moved || state.spawned !== true;
                    const targetDirection = moved
                        ? randomDirection()
                        : (row.position?.direction || (shouldRefreshPose ? randomDirection() : (state.currentDirection || randomDirection())));
                    prepared.push({
                        row,
                        state,
                        wasSpawned: state.spawned === true,
                        moved,
                        targetDirection,
                        targetEmotion: shouldRefreshPose ? pickRandomEmotion(state.profile) : (state.currentEmotion || 'neutral')
                    });
                }
                if (prepared.length === 0) return;

                for (const entry of prepared) {
                    const row = entry.row;
                    const state = entry.state;
                    if (!state.spawned) {
                        await upsertActorVisual(state, {
                            position: row.position,
                            direction: entry.targetDirection,
                            emotion: entry.targetEmotion,
                            talking: false,
                            zIndex: 50 + row.index,
                            alpha: 1
                        });
                    }
                }

                const movedEntries = randomize
                    ? prepared.filter((entry) => entry.moved && entry.state.spawned)
                    : [];
                const shouldTransitionMoved = randomize && movedEntries.length > 0;

                if (shouldTransitionMoved && movedEntries.length > 0) {
                    await Promise.all(
                        movedEntries.map((entry) =>
                            fadeActorAlpha(
                                entry.state,
                                Number.isFinite(entry.state.currentAlpha) ? entry.state.currentAlpha : 1,
                                POSITION_FADE_DOWN_ALPHA,
                                POSITION_FADE_DOWN_MS
                            )
                        )
                    );
                }

                if (movedEntries.length > 0) {
                    for (const entry of movedEntries) {
                        const row = entry.row;
                        const state = entry.state;
                        await upsertActorVisual(state, {
                            position: row.position,
                            direction: entry.targetDirection,
                            emotion: entry.targetEmotion,
                            talking: false,
                            zIndex: 50 + row.index,
                            alpha: shouldTransitionMoved ? POSITION_FADE_DOWN_ALPHA : 1,
                            forceSpriteRefresh: true
                        });
                    }
                }

                for (const entry of prepared) {
                    if (entry.moved) continue;
                    const row = entry.row;
                    const state = entry.state;
                    await upsertActorVisual(state, {
                        position: row.position,
                        direction: entry.targetDirection,
                        emotion: entry.targetEmotion,
                        talking: false,
                        zIndex: 50 + row.index,
                        alpha: 1
                    });
                }

                if (shouldTransitionMoved && movedEntries.length > 0) {
                    await Promise.all(
                        movedEntries.map((entry) =>
                            fadeActorAlpha(
                                entry.state,
                                Number.isFinite(entry.state.currentAlpha) ? entry.state.currentAlpha : POSITION_FADE_DOWN_ALPHA,
                                1,
                                POSITION_FADE_UP_MS
                            )
                        )
                    );
                }

                // Safety net: never leave actors partially transparent.
                for (const entry of prepared) {
                    const state = entry.state;
                    if (!state) continue;
                    if (!state.currentPosition) continue;
                    await upsertActorVisual(state, {
                        position: state.currentPosition,
                        direction: state.currentDirection,
                        emotion: state.currentEmotion || 'neutral',
                        talking: false,
                        zIndex: Number.isFinite(state.currentZIndex) ? state.currentZIndex : 50,
                        alpha: 1
                    });
                }
            } finally {
                layoutInFlight = false;
            }
        };

        const getConversationGroups = () => {
            const groups = new Map();
            for (const state of actorStates.values()) {
                if (!state.spawned || !state.currentPosition) continue;
                const slot = String(state.currentSlot || '').trim();
                if (!slot) continue;
                if (!groups.has(slot)) groups.set(slot, []);
                groups.get(slot).push(state);
            }

            const out = [];
            for (const [slot, members] of groups.entries()) {
                if (!Array.isArray(members) || members.length < 2) continue;
                const sorted = [...members].sort((a, b) => (a.currentPosition?.x || 0) - (b.currentPosition?.x || 0));
                out.push({
                    key: `${slot}:${sorted.map((state) => state.key).join(':')}`,
                    slot,
                    memberKeys: sorted.map((state) => state.key)
                });
            }
            return out;
        };

        const pickConversationEmotion = (state, chance) => {
            if (!state?.profile || Math.random() >= chance) return state?.currentEmotion || 'neutral';
            return pickRandomEmotion(state.profile);
        };

        const updateActorPerformance = async (state, { talking = null, emotion = null, direction = null } = {}) => {
            if (!overlayAlive || !state?.spawned) return false;
            if (!actorApi || typeof actorApi.update !== 'function') return false;

            const patch = {};
            if (typeof talking === 'boolean') {
                patch.talking = talking === true;
            }
            const requestedEmotion = emotion || state.currentEmotion || 'neutral';
            const requestedDirection = normalizeDirection(direction || state.currentDirection || randomDirection());
            const candidates = buildSpriteCandidatesForState(state.profile, requestedEmotion, requestedDirection);
            const spriteCandidate = Array.isArray(candidates) ? candidates.find((candidate) => candidate?.spritePath) : null;
            const nextUsesDirectionalSprite = spriteCandidate?.spritePath
                ? spriteCandidate.hasDirectionalRotation === true
                : state.currentSpriteUsesDirectional === true;
            const spriteWillChange = !!(spriteCandidate?.spritePath && spriteCandidate.spritePath !== state.currentSpritePath);
            if (spriteWillChange) {
                const capabilities = state.profile?.capabilities || {};
                patch.spritePath = spriteCandidate.spritePath;
                patch.hasBlink = capabilities.hasBlink === true;
                patch.hasTalk = capabilities.hasTalk === true;
                patch.hasTalkBlink = capabilities.hasTalkBlink === true;
            }
            if (requestedDirection !== state.currentDirection || spriteWillChange || nextUsesDirectionalSprite !== state.currentSpriteUsesDirectional) {
                patch.flipX = nextUsesDirectionalSprite
                    ? 1
                    : (requestedDirection === 'left' ? -1 : 1);
            }

            try {
                const updated = await actorApi.update(state.actorId, patch);
                if (!updated) {
                    state.spawned = false;
                    return false;
                }
                state.currentEmotion = spriteCandidate?.emotion || requestedEmotion || state.currentEmotion;
                state.currentDirection = requestedDirection;
                if (spriteCandidate?.spritePath) {
                    state.currentSpritePath = spriteCandidate.spritePath;
                    state.currentSpriteUsesDirectional = spriteCandidate.hasDirectionalRotation === true;
                }
                return true;
            } catch (error) {
                console.warn('[camp_rest_test] Conversation actor performance update failed:', state.character, error?.message || error);
                return false;
            }
        };

        const directionToward = (fromState, toState) => {
            const fromX = Number(fromState?.currentPosition?.x);
            const toX = Number(toState?.currentPosition?.x);
            if (!Number.isFinite(fromX) || !Number.isFinite(toX) || Math.abs(fromX - toX) < 1) {
                return randomDirection();
            }
            return fromX < toX ? 'right' : 'left';
        };

        const pickSpeakerDirection = (speaker, listeners) => {
            const pool = Array.isArray(listeners) ? listeners.filter(Boolean) : [];
            if (pool.length === 0) return randomDirection();
            const target = pool[Math.floor(Math.random() * pool.length)];
            return directionToward(speaker, target);
        };

        const scheduleConversationEmotionPulse = (group, generationId) => {
            const delay = randomBetween(CONVO_EMOTION_PULSE_MIN_MS, CONVO_EMOTION_PULSE_MAX_MS);
            const handle = setTimeout(async () => {
                if (!overlayAlive || generationId !== convoGeneration) return;

                const liveMembers = group.memberKeys
                    .map((key) => actorStates.get(key))
                    .filter((state) => state?.spawned && state.currentPosition);

                if (liveMembers.length >= 2 && Math.random() < CONVO_AMBIENT_EMOTION_CHANCE) {
                    const target = liveMembers[Math.floor(Math.random() * liveMembers.length)];
                    await updateActorPerformance(target, {
                        emotion: pickRandomEmotion(target.profile),
                        direction: target.currentDirection || randomDirection()
                    });
                }

                if (overlayAlive && generationId === convoGeneration) {
                    scheduleConversationEmotionPulse(group, generationId);
                }
            }, delay);
            convoTimeouts.set(`${group.key}:emotion`, handle);
        };

        const startConversationLoops = () => {
            stopConversationLoops();
            if (!ENABLE_CONVERSATION_ACTOR_UPDATES) return;

            const generationId = convoGeneration;
            const groups = getConversationGroups();
            for (const group of groups) {
                let nextSpeakerIndex = Math.floor(Math.random() * Math.max(1, group.memberKeys.length));
                scheduleConversationEmotionPulse(group, generationId);

                const step = async () => {
                    if (!overlayAlive || generationId !== convoGeneration) return;
                    const liveMembers = group.memberKeys
                        .map((key) => actorStates.get(key))
                        .filter((state) => state?.spawned && state.currentPosition);
                    if (liveMembers.length < 2) return;

                    const speakerIndex = nextSpeakerIndex % liveMembers.length;
                    const speaker = liveMembers[speakerIndex];
                    const listeners = liveMembers.filter((_, index) => index !== speakerIndex);

                    await updateActorPerformance(speaker, {
                        talking: true,
                        emotion: pickConversationEmotion(speaker, CONVO_SPEAKER_EMOTION_CHANCE),
                        direction: pickSpeakerDirection(speaker, listeners)
                    });
                    if (!overlayAlive || generationId !== convoGeneration) return;
                    await Promise.all(listeners.map((listener) =>
                        updateActorPerformance(listener, {
                            talking: false,
                            emotion: pickConversationEmotion(listener, CONVO_LISTENER_EMOTION_CHANCE),
                            direction: directionToward(listener, speaker)
                        })
                    ));
                    if (!overlayAlive || generationId !== convoGeneration) return;

                    const talkDuration = randomBetween(CONVO_STEP_MIN_MS, CONVO_STEP_MAX_MS);
                    const handle = setTimeout(async () => {
                        if (!overlayAlive || generationId !== convoGeneration) return;
                        await updateActorPerformance(speaker, { talking: false });
                        if (!overlayAlive || generationId !== convoGeneration) return;
                        await Promise.all(listeners.map((listener) => updateActorPerformance(listener, { talking: false })));
                        if (!overlayAlive || generationId !== convoGeneration) return;
                        nextSpeakerIndex = (speakerIndex + 1 + Math.floor(Math.random() * (liveMembers.length - 1))) % liveMembers.length;
                        const pauseDuration = randomBetween(CONVO_PAUSE_MIN_MS, CONVO_PAUSE_MAX_MS);
                        const nextHandle = setTimeout(() => step().catch((error) => {
                            console.warn('[camp_rest_test] Conversation loop step failed:', error?.message || error);
                        }), pauseDuration);
                        convoTimeouts.set(group.key, nextHandle);
                    }, talkDuration);
                    convoTimeouts.set(group.key, handle);
                };

                step().catch((error) => {
                    console.warn('[camp_rest_test] Conversation loop step failed:', error?.message || error);
                });
            }
        };

        const startLayoutLoop = () => {
            stopLayoutLoop();
            layoutTimer = setInterval(() => {
                if (!overlayAlive) return;
                applyLayout(true)
                    .then(() => startConversationLoops())
                    .catch((error) => {
                        console.warn('[camp_rest_test] Layout loop update failed:', error?.message || error);
                    });
            }, POSITION_SWAP_INTERVAL_MS);
        };

        const getSpawnedActorCount = () => {
            let count = 0;
            for (const state of actorStates.values()) {
                if (state?.spawned === true) count += 1;
            }
            return count;
        };

        const ensureInitialLayout = async () => {
            const sourcePositions = scenePositions.length > 0 ? scenePositions : getFallbackPositions(resolveActiveCharacters().length);
            const expectedActorCount = Math.max(1, Math.min(resolveActiveCharacters().length, sourcePositions.length || 1));
            for (let attempt = 0; attempt < INITIAL_LAYOUT_RETRY_COUNT; attempt++) {
                if (!overlayAlive) return;
                await applyLayout(false);
                await Promise.all(Array.from(actorStates.values()).map((state) => state.updateChain || Promise.resolve()));
                if (getSpawnedActorCount() >= expectedActorCount) return;
                await sleep(INITIAL_LAYOUT_RETRY_DELAY_MS);
            }
        };

        return {
            async start() {
                // Ensure camp overlays always begin from a neutral framing.
                // This prevents leaked camera zoom from skip-to-end scenes.
                resetCameraForOverlay(0);
                disableAliveBgParallaxForOverlay();
                applyCampBackground();
                await ensureInitialLayout();
                startConversationLoops();
                startLayoutLoop();
            },
            stop(options = {}) {
                const shouldRestoreBackground = options?.restoreBackground !== false;
                overlayAlive = false;
                stopLayoutLoop();
                stopConversationLoops();
                clearCampActors();
                if (shouldRestoreBackground) {
                    restoreCampBackground();
                } else {
                    releaseCampBackground();
                }
                restoreAliveBgParallaxForOverlay();
                // Leave camera in a neutral state when the overlay exits.
                resetCameraForOverlay(0);
            }
        };
    };
})();
