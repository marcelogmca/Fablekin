// engine/views/vn_viewer/js/modules/dialogue_orchestrator.js

import { state, runtime } from '../state.js';
import { elements } from '../elements.js';
import { normalizeCharacterKey } from '../utils.js';
import { getVoiceBoundaryDelay, playVoice, stopVoice } from './audio_manager.js';
import { syncDialogueLog, addToLog, setInputsEnabled, updateNavigationUI, showGameOverScreen } from './ui_manager.js';
import { runSceneEntryInterceptors, runDuringUserInputInterceptors } from '../intercept_orchestrator.js';
import { pixiSpriteManager } from '../pixi_sprite_manager.js';
import { syncDirectorState } from './director_sync.js';
import { pixiTitleManager } from '../pixi_title_manager.js';
import { isPixiTakeoverActive } from '../pixi_takeover_manager.js';

function buildDefaultChapterIntroConfig(vnPayload) {
    if (!vnPayload) return null;

    const isInterlude = String(vnPayload?.sceneMode || '').toLowerCase() === 'interlude';
    const chapterNumber = Number.isInteger(vnPayload?.turnNumber) ? vnPayload.turnNumber : 1;
    const ordinal = Number.isInteger(vnPayload?.interlude?.ordinal)
        ? vnPayload.interlude.ordinal
        : null;
    const text = isInterlude
        ? `Chapter ${chapterNumber} Interlude ${ordinal || 1}`
        : `Chapter ${chapterNumber}`;

    return {
        enabled: true,
        text,
        subtext: vnPayload.output?.abstractTitle || vnPayload.abstractTitle || "",
        preset: 'chapter_intro'
    };
}

function getSceneFocusCharacter(scene) {
    const cam = scene?.directorState?.cam;
    if (cam?.mode === 'zoom' && cam.target) return cam.target;
    return null;
}

function getSceneText(scene) {
    return String(scene?.text || scene?.line || '');
}

function getAutoPlayDelay() {
    const configuredDelay = Number(state.vnSettings.interface?.auto_play_delay);
    return Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 500;
}

const MIN_FTO_MS = -500;
const MAX_FTO_MS = 5000;

/**
 * FTO belongs to the incoming line: it describes when that speaker takes the
 * floor relative to the end of the preceding line. The object form is the
 * canonical payload; numeric and snake_case aliases keep the boundary tolerant.
 */
export function getSceneFtoOffset(scene) {
    const fto = scene?.fto;
    const rawValue = typeof fto === 'number'
        ? fto
        : fto?.offsetMs ?? fto?.offset_ms
            ?? scene?.floorTransferOffsetMs
            ?? scene?.floor_transfer_offset_ms;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(MAX_FTO_MS, Math.max(MIN_FTO_MS, Math.round(parsed)));
}

export function cancelAutoPlaySchedule(resetProgress = true) {
    state.autoPlayScheduleToken += 1;
    if (state.autoPlayTimeout) {
        clearTimeout(state.autoPlayTimeout);
        state.autoPlayTimeout = null;
    }
    if (state.progressInterval) {
        clearInterval(state.progressInterval);
        state.progressInterval = null;
    }
    if (resetProgress && elements.progressBar) elements.progressBar.style.width = '0%';
}

function scheduleAutoAdvance(index, requestID, options = {}) {
    cancelAutoPlaySchedule();
    const scheduleToken = state.autoPlayScheduleToken;
    const configuredDelay = Number(options.delayMs);
    const delay = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : getAutoPlayDelay();
    const preserveOutgoingVoice = options.preserveOutgoingVoice === true;

    if (delay > 0) {
        let width = 0;
        const progressInterval = setInterval(() => {
            if (scheduleToken !== state.autoPlayScheduleToken || width >= 100) {
                clearInterval(progressInterval);
                if (state.progressInterval === progressInterval) state.progressInterval = null;
                return;
            }
            width += 0.5;
            if (elements.progressBar) elements.progressBar.style.width = `${Math.min(100, width)}%`;
        }, delay / 200);
        state.progressInterval = progressInterval;
    }

    const autoPlayTimeout = setTimeout(() => {
        if (scheduleToken !== state.autoPlayScheduleToken
            || !state.autoPlay
            || state.currentIndex !== index
            || state.lastMessageRequestID !== requestID) {
            if (state.autoPlayTimeout === autoPlayTimeout) state.autoPlayTimeout = null;
            return;
        }

        state.autoPlayTimeout = null;
        showNextMessage({ expectedIndex: index, preserveOutgoingVoice });
    }, delay);
    state.autoPlayTimeout = autoPlayTimeout;
}

export async function checkCompletion(index, requestID = state.lastMessageRequestID) {
    if (requestID !== state.lastMessageRequestID || index !== state.currentIndex) return;
    if (state.isGameOver) return;
    const isLast = index === state.currentVN.sequence.length - 1;
    if (isLast) {
        try { await window.socket.emitReceive('execute-frontend-hook', { hookName: 'HOOK_VN_GUI_LAST_DIALOGUE' }); }
        finally {
            updateNavigationUI();
            // Run "during_user_input" intercepts on the last scene even when this is a
            // historical/read-only turn (navigation.next exists). This lets persistent
            // end-of-turn overlays (like camp interludes) replay reliably.
            if (!state.isGameOver) {
                await runDuringUserInputInterceptors({
                    sceneIndex: index,
                    scene: state.currentVN?.sequence?.[index] || null
                });
            }
        }
    } else {
        setInputsEnabled(false);
        updateNavigationUI();
    }
    if (state.autoPlay && !isLast) {
        const naturalTimingEnabled = state.vnSettings.interface?.natural_conversation_timing !== false;
        const nextScene = state.currentVN.sequence[index + 1];
        const ftoOffsetMs = naturalTimingEnabled ? getSceneFtoOffset(nextScene) : null;

        if (ftoOffsetMs !== null) {
            const boundaryDelayMs = await getVoiceBoundaryDelay(state.currentVoicePlayback, ftoOffsetMs);
            if (!state.autoPlay
                || requestID !== state.lastMessageRequestID
                || index !== state.currentIndex) return;
            if (boundaryDelayMs !== null) {
                scheduleAutoAdvance(index, requestID, {
                    delayMs: boundaryDelayMs,
                    preserveOutgoingVoice: ftoOffsetMs < 0
                });
                return;
            }
        }

        const audioEndedPromise = state.isVoiceAudioPlaybackActive ? state.currentAudioEndedPromise : null;
        if (audioEndedPromise) await audioEndedPromise;
        if (!state.autoPlay
            || requestID !== state.lastMessageRequestID
            || index !== state.currentIndex) return;
        scheduleAutoAdvance(index, requestID);
    }
}

export function resumeAutoPlayForCurrentMessage() {
    if (!state.autoPlay || state.dialogueTransitionRequestID !== null) return;
    const scene = state.currentVN?.sequence?.[state.currentIndex];
    if (!scene) return;
    if (state.currentIndex >= state.currentVN.sequence.length - 1) return;
    if (state.charactersDisplayed >= getSceneText(scene).length) {
        checkCompletion(state.currentIndex, state.lastMessageRequestID);
    }
}

export async function showMessage(index, options = {}) {
    if (!state.currentVN?.sequence?.[index]) return;
    const normalizedOptions = typeof options === 'boolean' ? { skipAudio: options } : (options || {});
    const skipAudio = normalizedOptions.skipAudio === true;
    const preserveOutgoingVoice = normalizedOptions.preserveOutgoingVoice === true;
    state.charactersDisplayed = 0;
    const requestID = ++state.lastMessageRequestID;
    state.dialogueTransitionRequestID = requestID;

    clearInterval(state.typewriterInterval);
    cancelAutoPlaySchedule();
    if (!preserveOutgoingVoice) stopVoice();

    const scene = state.currentVN.sequence[index];
    const character = scene.character || 'Narrator';
    const text = getSceneText(scene);
    const talkingCharacter = normalizeCharacterKey(character);

    let isSequentialAdvance = false;
    try {
        const interceptResult = await runSceneEntryInterceptors(index, scene);
        if (requestID !== state.lastMessageRequestID) return;
        if (interceptResult?.haltRender) return;

        isSequentialAdvance = (state.lastShownIndex === index - 1);
        state.lastShownIndex = index;
        window.dispatchEvent(new CustomEvent('vn:dialogue-enter', {
            detail: {
                turnNumber: state.currentVN?.turnNumber ?? null,
                dialogueIndex: index,
                sceneIndex: index,
                sceneMode: state.currentVN?.sceneMode || 'mainline'
            }
        }));
        syncDialogueLog(index, isSequentialAdvance);

        const voicePlayback = playVoice(skipAudio ? null : scene.crc, null, talkingCharacter, text, {
            // The orchestrator already applied the transition's stop/preserve policy
            // before interceptors ran, so playback itself must not stop again here.
            preserveOutgoing: true,
            emulateMissing: !skipAudio
        });
        state.currentVoicePlayback = voicePlayback;
        state.currentAudioEndedPromise = voicePlayback?.endedPromise || Promise.resolve();

        await pixiSpriteManager.updateSprites(scene.sprites, {
            focusCharacter: getSceneFocusCharacter(scene)
        });
        if (requestID !== state.lastMessageRequestID) return;

        if (scene.directorState) await syncDirectorState(scene.directorState, isSequentialAdvance);
        if (requestID !== state.lastMessageRequestID) return;
    } finally {
        if (state.dialogueTransitionRequestID === requestID) {
            state.dialogueTransitionRequestID = null;
        }
    }

    if (scene.directorState?.isGameOver) {
        state.isGameOver = true;
        state.gameOverConfig = scene.directorState.gameOverConfig || state.gameOverConfig || { text: 'GAME OVER', subtext: '' };
        showGameOverScreen(state.gameOverConfig);
        return;
    }

    if (index === 0) {
        let config = state.currentVN?.processed?.chapterIntroConfig;
        if (!config && state.currentVN) {
            config = buildDefaultChapterIntroConfig(state.currentVN);
        }
        if (config && config.enabled !== false && state.vnSettings.visuals?.show_chapter_intro !== false) {
            pixiTitleManager.showTitle(config);
        }
    }

    if (elements.dialogueIndexIndicator) {
        const total = state.currentVN.sequence.length - (state.currentVN.sequence[state.currentVN.sequence.length - 1].isVirtual ? 1 : 0);
        elements.dialogueIndexIndicator.textContent = `${scene.isVirtual ? total : index + 1} / ${total}`;
    }

    updateNavigationUI();

    if (runtime.saveStateTimeout) clearTimeout(runtime.saveStateTimeout);
    runtime.saveStateTimeout = setTimeout(() => {
        const vn = state.currentVN;
        if (vn?.turnNumber !== undefined) {
            const sceneMode = String(vn.sceneMode || 'mainline').toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
            const parsedInterludeId = Number.parseInt(vn.interlude?.id, 10);
            window.socket.emit('save-viewer-state', {
                turnNumber: vn.turnNumber,
                dialogueIndex: state.currentIndex,
                sceneMode,
                interludeId: sceneMode === 'interlude' && Number.isInteger(parsedInterludeId) && parsedInterludeId > 0
                    ? parsedInterludeId
                    : null,
                storageTurnKey: vn.storageTurnKey || null
            });
        }
    }, 1000);

    const hasCharacterSpeaker = character !== "Narrator";
    if (elements.dialogueContainer) {
        elements.dialogueContainer.classList.toggle('has-character-speaker', hasCharacterSpeaker);
    }

    let displayName = (character === "MainCharacter") ? "You" : (character.endsWith('.png') ? character.slice(0, -4) : character);
    if (!hasCharacterSpeaker) {
        elements.characterName.textContent = "";
        elements.nameLine.style.display = "none";
    } else {
        elements.characterName.textContent = displayName;
        elements.nameLine.style.display = "block";
    }

    if (elements.dialogueText) {
        elements.dialogueText.style.textAlign = state.vnSettings.interface?.text_alignment || 'left';
        elements.dialogueText.innerHTML = '<span id="typed-text"></span><span class="blinking-cursor"></span><span id="untyped-text" style="opacity: 0;"></span>';
    }
    const typedSpan = document.getElementById('typed-text');
    const untypedSpan = document.getElementById('untyped-text');

    untypedSpan.textContent = text;

    state.typewriterInterval = setInterval(() => {
        if (state.charactersDisplayed < text.length) {
            state.charactersDisplayed++;
            typedSpan.textContent = text.substring(0, state.charactersDisplayed);
            untypedSpan.textContent = text.substring(state.charactersDisplayed);
            if (elements.dialogueText) {
                const cursor = elements.dialogueText.querySelector('.blinking-cursor');
                if (cursor) {
                    const containerHeight = elements.dialogueText.clientHeight;
                    const cursorTop = cursor.offsetTop;
                    const cursorHeight = cursor.offsetHeight;
                    const currentScroll = elements.dialogueText.scrollTop;
                    if (cursorTop + cursorHeight > currentScroll + containerHeight) {
                        elements.dialogueText.scrollTop = cursorTop + cursorHeight - containerHeight;
                    }
                }
            }
        } else {
            clearInterval(state.typewriterInterval);
            state.typewriterInterval = null;
            state.charactersDisplayed = text.length;
            elements.dialogueText.textContent = text;
            checkCompletion(index, requestID);
        }
    }, state.vnSettings.visuals?.write_speed || 30);
}

export function completeCurrentTypewriter() {
    if (state.dialogueTransitionRequestID !== null) return false;
    const scene = state.currentVN?.sequence?.[state.currentIndex];
    if (!scene) return false;

    const text = getSceneText(scene);
    if (state.charactersDisplayed >= text.length) return false;

    clearInterval(state.typewriterInterval);
    state.typewriterInterval = null;
    state.charactersDisplayed = text.length;

    if (elements.dialogueText) {
        elements.dialogueText.textContent = text;
        elements.dialogueText.scrollTop = elements.dialogueText.scrollHeight;
    }

    checkCompletion(state.currentIndex, state.lastMessageRequestID);
    return true;
}

export function showNextMessage(options = {}) {
    if (!options?.force && isPixiTakeoverActive()) return;
    if (!options?.force && state.dialogueTransitionRequestID !== null) return;
    if (state.isGameOver) return;
    if (Number.isInteger(options?.expectedIndex) && state.currentIndex !== options.expectedIndex) return;
    if (state.currentVN && state.currentIndex < state.currentVN.sequence.length - 1) {
        const nextIndex = state.currentIndex + 1;
        state.currentIndex = nextIndex;
        return showMessage(nextIndex, {
            preserveOutgoingVoice: options.preserveOutgoingVoice === true
        });
    }
}

export function completeOrAdvanceDialogue(options = {}) {
    if (!options?.force && isPixiTakeoverActive()) return;
    if (!options?.force && state.dialogueTransitionRequestID !== null) return;
    if (state.isGameOver) return;
    if (completeCurrentTypewriter()) return;
    showNextMessage(options);
}

export function showPrevMessage(options = {}) {
    if (!options?.force && isPixiTakeoverActive()) return;
    if (!options?.force && state.dialogueTransitionRequestID !== null) return;
    if (state.currentIndex > 0) {
        if (state.isGameOver) {
            state.isGameOver = false;
            if (elements.userInputContainer) {
                elements.userInputContainer.classList.remove('game-over-active');
                elements.userInputContainer.style.display = '';
                elements.userInputContainer.style.opacity = '';
                elements.userInputContainer.style.pointerEvents = '';
            }
            if (elements.dialogueContainer) elements.dialogueContainer.style.opacity = '';
            import('../pixi_game_over.js').then(m => m.pixiGameOver.clear());
        }
        showMessage(--state.currentIndex);
    }
}

export function showLastMessage(options = {}) {
    if (!options?.force && isPixiTakeoverActive()) return;
    if (!options?.force && state.dialogueTransitionRequestID !== null) return;
    if (!state.currentVN?.sequence) return;
    if (state.isGameOver) return;
    let target = state.currentVN.sequence.length - 1;
    const gameOverIdx = state.currentVN.sequence.findIndex(s => s.directorState?.isGameOver);
    if (gameOverIdx >= 0 && gameOverIdx < target) target = gameOverIdx;
    if (state.currentIndex === target) return;
    for (let i = state.currentIndex; i < target; i++) {
        const s = state.currentVN.sequence[i];
        if (s && !s.isVirtual) {
            const char = s.character || 'Narrator';
            const text = s.text || s.line;
            const displayName = (char === "MainCharacter") ? "You" : (char.endsWith('.png') ? char.slice(0, -4) : char);
            addToLog(char, displayName, text);
        }
    }
    state.currentIndex = target;
    state.lastShownIndex = target;
    showMessage(target);
}

export function handleWindowFocusChanged(isFocused) {
    if (isFocused && state.currentIndex === 0 && state.currentVN && !state.isGenerationPhase) {
        let config = state.currentVN?.processed?.chapterIntroConfig;
        if (!config && state.currentVN) {
            config = buildDefaultChapterIntroConfig(state.currentVN);
        }
        if (config && config.enabled !== false && state.vnSettings.visuals?.show_chapter_intro !== false) {
            pixiTitleManager.clearAll();
            pixiTitleManager.showTitle(config);
        }
    }
}
