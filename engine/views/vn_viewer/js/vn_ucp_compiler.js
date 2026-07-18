import { debugLog, getSpriteCharacterKey } from './utils.js';

const CAM_BACKGROUND_ZOOM_MIN = 1;
const CAM_BACKGROUND_ZOOM_MAX = 1.35;
const COMP_AUTO_ZOOM_COOLDOWN_DEFAULT = 3;

function normalizeBackgroundFocusZoom(rawZoom) {
    const parsed = Number(rawZoom);
    if (!Number.isFinite(parsed)) return 1.08;

    // Guardrail: tolerate percentage-style zoom inputs (100 => 1.0x).
    const scalar = parsed > 10 ? parsed / 100 : parsed;
    if (!Number.isFinite(scalar)) return 1.08;

    return Math.min(CAM_BACKGROUND_ZOOM_MAX, Math.max(CAM_BACKGROUND_ZOOM_MIN, scalar));
}

function isAutoZoomSpeaker(line, playerCharName) {
    const speakingChar = line?.character ? String(line.character).trim() : null;
    if (!speakingChar) return { speakingChar: null, isAutoZoomSpeaker: false };
    const isPlayer = playerCharName && speakingChar.toLowerCase() === String(playerCharName).toLowerCase();
    const isNarrator = speakingChar.toLowerCase() === 'narrator' || speakingChar === '' || isPlayer;
    return { speakingChar, isAutoZoomSpeaker: !isNarrator };
}

function buildCompositionSignature(payload) {
    if (!payload || typeof payload !== 'object') return '';

    const preset = String(payload.preset || '').trim().toLowerCase();
    const actors = Array.isArray(payload.actors)
        ? payload.actors.map(actor => String(actor || '').trim()).filter(Boolean)
        : [];
    const rawOptions = payload.options && typeof payload.options === 'object' ? payload.options : {};
    const options = {};
    Object.keys(rawOptions).sort().forEach((key) => {
        options[key] = rawOptions[key];
    });

    return JSON.stringify({ preset, actors, options });
}


/**
* Compiles a compact UCP sequence into a frame-by-frame directorState.
* @param {Array} sequence The original sequence from the backend.
* @param {String} playerCharName The name of the player character (POV).
* @param {String} initialBackground The background the turn started with.
* @param {String} initialOst The OST the turn started with.
* @param {Array} initialVfx The active VFX state from the previous turn.
* @param {Array} initialSfx The active SFX state from the previous turn.
* @param {Object} cinematographerSettings Plugin settings for cinematography.
* @returns {Array} The augmented sequence.
*/
export function compileSequence(sequence, playerCharName, initialBackground = null, initialOst = null, initialVfx = [], initialSfx = [], cinematographerSettings = {}) {
    if (!sequence || !Array.isArray(sequence)) return sequence;

    debugLog('[DirectorCompiler] JIT Compiling Sequence...', sequence.length);

    const settings = cinematographerSettings || window.CINEMATOGRAPHER_SETTINGS || {};
    const autoEndHarsh = settings.auto_end_harsh_effects ?? true;
    const harshLimit = settings.harsh_effect_limit ?? 5;
    const harshEffects = ['glitch', 'shake', 'pixelate', 'crt', 'ascii', 'cross-hatch', 'old-film', 'bloom'];
    const compAutoZoomCooldownLines = Number.isFinite(Number(settings.comp_auto_zoom_cooldown_lines)) && Number(settings.comp_auto_zoom_cooldown_lines) > 0
        ? Number.parseInt(settings.comp_auto_zoom_cooldown_lines, 10)
        : COMP_AUTO_ZOOM_COOLDOWN_DEFAULT;

    let activeCam = { mode: 'wide', instant: true, endLine: null };
    
    // Initialize from previous turn state, adding 'age' if missing
    let activeVfx = initialVfx.map(v => ({ ...v, age: v.age || 0 }));
    let activeSfx = initialSfx.map(s => ({ ...s, age: s.age || 0 }));

    let activeBackground = initialBackground;
    let activeOst = initialOst;

    // Track the effective cam of the previous frame to handle narrator stickiness
    let lastEffectiveCam = { mode: 'wide', instant: true };
    let autoZoomMode = false;
    let flushActive = false; // Sticky state: when true, sprites are cleared until a new character speaks
    let gameOverActive = false;
    let gameOverConfig = null;
    let activeOstSilence = null;
    let activeCompositionSignature = '';
    let autoZoomSuppressionRemaining = 0;

    for (let i = 0; i < sequence.length; i++) {
        const line = sequence[i];
        let manualShotThisLine = false;
        let flushJustActivated = false;
        let camOverrideCommandThisLine = false;
        const triggers = [];

        // 1. Process discrete events on this line
        if (line.clientEvents && Array.isArray(line.clientEvents)) {
            line.clientEvents.forEach(event => {
                const { type, payload } = event;

                // --- CAM ---
                if (type.startsWith('cam:')) {
                    const instant = payload.instant !== undefined ? payload.instant : true;
                    if (type === 'cam:wide') {
                        camOverrideCommandThisLine = true;
                        activeCam = { mode: 'wide', instant, endLine: null };
                        autoZoomMode = false;
                        manualShotThisLine = true;
                    } else if (type === 'cam:auto_zoom') {
                        autoZoomMode = true;
                    } else if (type === 'cam:background_focus') {
                        camOverrideCommandThisLine = true;
                        const duration = Number.isFinite(Number(payload.duration)) && Number(payload.duration) > 0
                            ? Number(payload.duration)
                            : 2;
                        const zoom = normalizeBackgroundFocusZoom(payload.zoom);
                        activeCam = {
                            mode: 'background_focus',
                            instant,
                            duration,
                            zoom,
                            ease: payload.ease || 'power2.out',
                            endLine: i + duration
                        };
                        autoZoomMode = false;
                        manualShotThisLine = true;
                    }
                }
                else if (type === 'comp:set') {
                    const nextCompositionSignature = buildCompositionSignature(payload);
                    const compChanged = !!nextCompositionSignature && nextCompositionSignature !== activeCompositionSignature;
                    if (compChanged) {
                        activeCompositionSignature = nextCompositionSignature;
                        autoZoomSuppressionRemaining = Math.max(autoZoomSuppressionRemaining, compAutoZoomCooldownLines);
                        debugLog(`[DirectorCompiler] Composition changed at line ${i}. Suppressing cam:auto for ${compAutoZoomCooldownLines} dialogue lines.`);
                    }
                    triggers.push(event);
                }

                // --- Vfx ---
                else if (type === 'vfx:state') {
                    activeVfx = activeVfx.filter(v => v.id !== payload.id);
                    activeVfx.push({
                        ...payload,
                        intensity: payload.intensity || 0.5,
                        age: 0, // Reset age for new or explicitly restarted effects
                        endLine: payload.duration ? i + payload.duration : null
                    });
                } else if (type === 'vfx:clear') {
                    activeVfx = activeVfx.filter(v => v.id !== payload.id);
                } else if (type === 'vfx:trigger') {
                    triggers.push({ type: 'vfx:trigger', ...payload, intensity: payload.intensity || 1.0 });
                }
                // --- Sfx ---
                else if (type === 'sfx:play') {
                    if (payload.loop) {
                        activeSfx = activeSfx.filter(s => s.file !== payload.file);
                        activeSfx.push({
                            file: payload.file,
                            loop: true,
                            category: payload.category || 'background',
                            age: 0,
                            endLine: payload.duration ? i + payload.duration : null
                        });
                    } else {
                        // FIX: Use 'sfx:play' for triggers to match plugin listener
                        triggers.push({ type: 'sfx:play', file: payload.file, category: payload.category || 'effect', loop: false });
                    }
                } else if (type === 'sfx:stop') {
                    activeSfx = activeSfx.filter(s => s.file !== payload.file);
                }
                else if (type === 'scene:transition') {
                    if (payload.src) activeBackground = payload.src;
                    triggers.push({ type: 'transition', ...payload });
                }
                else if (type === 'vn:ost-change') {
                    if (payload.file) activeOst = payload.file;
                    triggers.push(event);
                }
                else if (type === 'vn:cast-flush') {
                    const instant = payload.instant !== undefined ? payload.instant : true;
                    activeCam = { mode: 'wide', instant, endLine: null };
                    autoZoomMode = false;
                    manualShotThisLine = true;
                    flushActive = true;
                    flushJustActivated = true;
                    triggers.push(event);
                }
                else if (type === 'ost:silence') {
                    const duration = Math.min(payload.duration || 5, 15); // Safety cap
                    activeOstSilence = { endLine: i + duration };
                }
                else if (type === 'vn:game-over') {
                    gameOverActive = true;
                    gameOverConfig = payload || {};
                    triggers.push(event);
                }
                else {
                    triggers.push(event);
                }
            });
        }

        if (camOverrideCommandThisLine && autoZoomSuppressionRemaining > 0) {
            debugLog(`[DirectorCompiler] Explicit camera shot override at line ${i}. Clearing composition auto-zoom suppression.`);
            autoZoomSuppressionRemaining = 0;
        }

        // --- CAST FLUSH: Sticky Sprite Clearing ---
        // On the line where flush fires: always clear sprites (old cast is gone).
        // On subsequent lines: stay cleared through narrator/player lines,
        // but deactivate the moment a new character speaks (let their sprites through).
        if (flushActive) {
            if (flushJustActivated) {
                // Flush line itself — always clear the old cast
                line.sprites = [];
                debugLog(`[DirectorCompiler] cast:flush activated at line ${i}. Sprites cleared.`);
            } else {
                // Subsequent lines — check if a real character is speaking
                const speakingChar = line.character ? line.character.trim() : null;
                const isPlayer = playerCharName && speakingChar && speakingChar.toLowerCase() === playerCharName.toLowerCase();
                const isNarrator = !speakingChar || speakingChar.toLowerCase() === 'narrator' || speakingChar === '' || isPlayer;

                if (!isNarrator) {
                    // A new character is speaking — deactivate flush, let their sprites through
                    flushActive = false;
                    debugLog(`[DirectorCompiler] cast:flush deactivated at line ${i} (${speakingChar} is now speaking). Sprites restored.`);
                } else {
                    // Still in the flush zone (narrator/transition text)
                    line.sprites = [];
                }
            }
        }

        // 2. Increment age and clean up expired durations
        activeVfx.forEach(v => v.age++);
        activeSfx.forEach(s => s.age++);

        activeVfx = activeVfx.filter(v => v.endLine === null || i < v.endLine);
        activeSfx = activeSfx.filter(s => s.endLine === null || i < s.endLine);

        // --- HARSH EFFECT SAFETY LIMIT ---
        if (autoEndHarsh) {
            const beforeCount = activeVfx.length;
            activeVfx = activeVfx.filter(v => {
                if (harshEffects.includes(v.id) && v.age >= harshLimit) {
                    debugLog(`[DirectorCompiler] Safety Limit: Auto-ending harsh effect "${v.id}" (age: ${v.age})`);
                    return false;
                }
                return true;
            });
            if (activeVfx.length < beforeCount) {
                // If we auto-ended something, we might want to trigger a visual "clear" in the triggers
                // but the directorState reconciliation handles it by omitted from the vfx list.
            }
        }

        // Handle Cam Expiry (Reaction shots, etc)
        if (activeCam.endLine !== null && i >= activeCam.endLine) {
            debugLog(`[DirectorCompiler] Cam shot expired at line ${i}. Reverting to Wide.`);
            activeCam = { mode: 'wide', instant: true, endLine: null };
        }

        // --- OST SILENCE SAFETY LIMIT ---
        if (activeOstSilence && i >= activeOstSilence.endLine) {
            debugLog(`[DirectorCompiler] OST Silence expired at line ${i}.`);
            activeOstSilence = null;
        }

        // 3. Resolve Frame-State
        let frameCam = { ...activeCam };
        const { speakingChar, isAutoZoomSpeaker: isDialogueSpeaker } = isAutoZoomSpeaker(line, playerCharName);
        const suppressAutoZoomThisLine = autoZoomSuppressionRemaining > 0 && isDialogueSpeaker;
        if (suppressAutoZoomThisLine) {
            autoZoomSuppressionRemaining -= 1;
            debugLog(`[DirectorCompiler] cam:auto suppressed at line ${i} (${speakingChar}). Remaining cooldown dialogue lines: ${autoZoomSuppressionRemaining}.`);
        }

        // Handle Auto-Zoom Expansion (Only if not manually overridden THIS line)
        if (autoZoomMode && !manualShotThisLine && !suppressAutoZoomThisLine) {
            const isNarrator = !isDialogueSpeaker;

            if (!isNarrator) {
                frameCam = {
                    mode: 'zoom',
                    target: speakingChar,
                    region: 'top',
                    instant: true
                };
            } else {
                // Narrator Stickiness: Use last frame's cam state
                frameCam = { ...lastEffectiveCam };

                // --- Drop stickiness if target character is gone ---
                if (frameCam.mode === 'zoom' && frameCam.target) {
                    const targetName = frameCam.target.toLowerCase();
                    const sprites = line.sprites || [];
                    let characterStillPresent = false;

                    if (Array.isArray(sprites)) {
                        characterStillPresent = sprites.some(s => {
                            if (!s) return false;
                            const name = getSpriteCharacterKey(s);
                            return name === targetName;
                        });
                    } else {
                        characterStillPresent = Object.values(sprites).some(s => {
                            if (!s) return false;
                            const name = getSpriteCharacterKey(s);
                            return name === targetName;
                        });
                    }

                    if (!characterStillPresent) {
                        debugLog(`[DirectorCompiler] Stickiness dropped for ${frameCam.target} (Character left scene). Setting to Wide.`);
                        frameCam = { mode: 'wide', instant: true };
                    }
                }
            }
        }

        // Non-Sticky CG Logic: Explicitly check this line only.
        const currentCg = line.cg || null;
        const isCgFrame = !!currentCg;

        // Force Wide if CG is active
        if (isCgFrame) {
            frameCam = { mode: 'wide', instant: true };
        }

        if (frameCam.mode === 'background_focus') {
            line.sprites = [];
        }

        // Keep pre-CG camera context so we can resume it after CG-only frames.
        if (!isCgFrame) {
            lastEffectiveCam = { ...frameCam };
        }

        // 4. Attach final directorState
        line.directorState = {
            cam: frameCam,
            vfx: activeVfx.map((v) => {
                const rest = { ...v };
                delete rest.endLine;
                return rest;
            }),
            sfx: activeSfx.map(s => ({ ...s })),
            background: activeBackground,
            ost: activeOst,
            ostSilence: !!activeOstSilence,
            cg: currentCg,
            triggers: triggers,
            isGameOver: gameOverActive,
            gameOverConfig: gameOverConfig
        };

        // --- LOG: AFTER EXPANSION ---
        debugLog(`[DirectorCompiler] Line ${i} (${line.character || 'N'}) - AFTER Expansion (Full State):`, {
            cam: line.directorState.cam,
            background: line.directorState.background,
            cg: line.directorState.cg,
            vfxCount: line.directorState.vfx.length,
            sfxCount: line.directorState.sfx.length,
            triggersCount: line.directorState.triggers.length
        });
    }

    return sequence;
}
