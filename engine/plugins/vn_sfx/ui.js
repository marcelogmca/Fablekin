(function (context) {
    const { debugLog, debugError } = context;

    const activeLoops = new Map();
    const pendingLoops = new Set();
    const activeOneOffs = new Set(); // Track one-offs so we can kill them on jumps/turn changes
    const SOUNDS_BASE_PATH = 'plugins/vn_sfx/sounds/';

    function getVolume(category) {
        const audio = context.state?.vnSettings?.audio || {};
        if (category === 'background') return audio.bgm_sfx_volume !== undefined ? audio.bgm_sfx_volume : 0.3;
        return audio.sfx_volume !== undefined ? audio.sfx_volume : 0.5;
    }

    function playSfx(file, loop = false, category = 'effect', locked = false, isSweep = false, srcOverride = null) {
        if (!file) return;

        // Never play one-off sound effects during a fast-forward/sweep catchup
        if (!loop && isSweep) return;

        // If this loop is requested again, track it as pending so it can't be prematurely killed by an old stop
        if (loop) pendingLoops.add(file);
        
        // Phase 2: Robust Path Resolution
        const possiblePaths = [];
        if (srcOverride) {
            // If we have an explicit override, it's relative to server root
            possiblePaths.push(`../../../../${srcOverride}`);
        }

        if (file.includes('/')) {
            possiblePaths.push(file);
        } else {
            // Priority based on category
            if (category === 'background') {
                possiblePaths.push(`background/${file}`);
                possiblePaths.push(`effects/${file}`);
            } else {
                possiblePaths.push(`effects/${file}`);
                possiblePaths.push(`background/${file}`);
            }
            possiblePaths.push(file);
        }

        const tryPlayNext = (index) => {
            if (index >= possiblePaths.length) {
                debugError(`[vn_sfx] Could not resolve sound path for: ${file}. Tried: ${possiblePaths.join(', ')}`);
                return;
            }

            const path = possiblePaths[index];
            const src = `../../${SOUNDS_BASE_PATH}${path}`;
            const audio = new Audio(src);
            
            audio.addEventListener('error', () => {
                tryPlayNext(index + 1);
            }, { once: true });

            audio.addEventListener('canplaythrough', () => {
                if (loop) {
                    // Start was cancelled by a sequence stop before audio finished loading!
                    if (!pendingLoops.has(file)) {
                        debugLog(`[vn_sfx] Aborted looping SFX (Stopped before load): ${file}`);
                        return;
                    }
                    pendingLoops.delete(file);

                    if (activeLoops.has(file)) {
                        debugLog(`[vn_sfx] Sound ${file} is already looping.`);
                        return;
                    }
                }

                audio.loop = loop;
                audio.volume = getVolume(category);

                // SAFEGUARD: If we resolved this sound from the 'background/' folder, 
                // it MUST be treated as a loop, even if it was called via sfx:trigger.
                // This prevents 3-minute ambient clips from becoming unstoppable one-off "ghost" sounds.
                let effectiveLoop = loop;
                if (path.startsWith('background/') && !loop) {
                    debugLog(`[vn_sfx] Safeguard: Forcing loop=true for ambient sound: ${path}`);
                    effectiveLoop = true;
                    audio.loop = true;
                }

                // Ensure new sounds start muted if generation is active or resume is pending
                if ((context.state?.isGenerationPhase || context.state?.pendingSfxResume) && context.state?.vnSettings?.audio?.mute_audio_during_generation) {
                    audio.muted = true;
                }

                audio.play().catch(err => {
                    debugError(`[vn_sfx] Playback failed: ${path}`, err);
                });

                if (effectiveLoop) {
                    activeLoops.set(file, { audio, category, resolvedPath: path, locked });
                    debugLog(`[vn_sfx] Started looping ${category} SFX: ${path}${locked ? ' (LOCKED)' : ''}`);
                    if (isSweep) debugLog(`[vn_sfx] (Sweep Catchup Enabled)`);
                } else {
                    debugLog(`[vn_sfx] Playing one-off ${category} SFX: ${path}`);
                    const oneOffData = { file, audio, category };
                    activeOneOffs.add(oneOffData);
                    audio.addEventListener('ended', () => {
                        activeOneOffs.delete(oneOffData);
                    }, { once: true });
                }
            }, { once: true });
        };

        tryPlayNext(0);
    }

    function stopSfx(file, force = false) {
        // Cancel any load requests in flight so they don't asynchronously play later
        pendingLoops.delete(file);

        if (activeLoops.has(file)) {
            const state = activeLoops.get(file);
            if (state.locked && !force) return;

            state.audio.pause();
            state.audio.currentTime = 0;
            activeLoops.delete(file);
            debugLog(`[vn_sfx] Stopped looping SFX: ${file}`);
        }

        // Also kill any active one-offs matching this file (in case a long one-off needs manual stopping)
        activeOneOffs.forEach(data => {
            if (data.file === file) {
                data.audio.pause();
                data.audio.currentTime = 0;
                activeOneOffs.delete(data);
                debugLog(`[vn_sfx] Stopped one-off SFX early: ${file}`);
            }
        });
    }

    function clearAllSfx(force = false) {
        debugLog(`[vn_sfx] Clearing active loops (force=${force})`);
        
        if (force) pendingLoops.clear();

        activeLoops.forEach((state, file) => {
            if (state.locked && !force) {
                debugLog(`[vn_sfx] clearAllSfx >> Skipping locked loop: ${file}`);
                return;
            }
            state.audio.pause();
            state.audio.currentTime = 0;
            activeLoops.delete(file);
        });

        // Always kill one-offs when clearing all SFX
        activeOneOffs.forEach(data => {
            data.audio.pause();
            data.audio.currentTime = 0;
        });
        activeOneOffs.clear();
    }

    function syncVolumes() {
        activeLoops.forEach(({ audio, category }) => {
            audio.volume = getVolume(category);
        });
    }

    // --- Event Listeners ---
    window.addEventListener('sfx:play', (e) => {
        const { file, loop, category, locked, srcOverride } = e.detail || {};
        playSfx(file, !!loop, category || 'effect', !!locked, e.detail?._isSweepCatchup, srcOverride);
    });

    window.addEventListener('sfx:stop', (e) => {
        const { file, force } = e.detail || {};
        stopSfx(file, !!force);
    });

    window.addEventListener('vn:settings-updated', () => {
        syncVolumes();
    });

    window.addEventListener('sfx:sync', (e) => {
        const { sfx, instant } = e.detail || {};
        if (!sfx || !Array.isArray(sfx)) return;

        // If this is a hard scene jump (instant=true), cut all lingering one-off effects
        if (instant) {
            activeOneOffs.forEach(data => {
                data.audio.pause();
                data.audio.currentTime = 0;
            });
            activeOneOffs.clear();
        }

        const requestedFiles = new Set(sfx.map(s => s.file));

        // 1. Stop loops not in the request
        activeLoops.forEach((data, file) => {
            if (!requestedFiles.has(file)) {
                stopSfx(file, true); // Use force for sync jumps
            }
        });

        // 2. Start loops not already playing
        sfx.forEach(({ file, category, locked, srcOverride }) => {
            if (!activeLoops.has(file)) {
                playSfx(file, true, category || 'background', !!locked, false, srcOverride);
            }
        });
    });

    window.addEventListener('animation:sync', (e) => {
        const { state: animState } = e.detail || {};
        if (animState === 'generating') {
             // Optional: handle animation state sync if needed
        }
    });

    window.addEventListener('audio:mute-generation', () => {
        debugLog('[vn_sfx] Muting all active SFX loops for generation.');
        activeLoops.forEach(({ audio }) => {
            audio.muted = true;
        });
    });

    window.addEventListener('audio:unmute-generation', () => {
        debugLog('[vn_sfx] Unmuting all active SFX loops after generation.');
        activeLoops.forEach(({ audio }) => {
            audio.muted = false;
        });
    });

    window.addEventListener('system:clear-all-volatile-events', (e) => {
        clearAllSfx(!!e.detail?.force);
    });

    debugLog('[vn_sfx] Plugin initialized.');

})(typeof context !== 'undefined' ? context : {
    debugLog: console.log,
    debugError: console.error
});
