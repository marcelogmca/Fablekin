// engine/views/vn_viewer/js/modules/payload_manager.js

import { state } from '../state.js';
import { elements } from '../elements.js';
import { debugLog, debugError, getAssetUrl, SERVER_URL } from '../utils.js';
import { resetSpriteState } from '../sprite_manager.js';
import { pixiSpriteManager } from '../pixi_sprite_manager.js';
import { pixiRenderer } from '../pixi_renderer.js';
import { pixiTitleManager } from '../pixi_title_manager.js';
import { compileSequence } from '../vn_ucp_compiler.js';
import { initializeTurnIntercepts, resetTurnIntercepts } from '../intercept_orchestrator.js';
import { 
    stopAudio, stopVoice, clearMissingTtsCrcs, playAudio
} from './audio_manager.js';
import { 
    updateBlockingOverlay, handleStatusUpdate 
} from './status_manager.js';
import { setInputsEnabled, hidePrologueOverlay, setScenePresentation, setDialogueHistoryVisible } from './ui_manager.js';
import { cancelAutoPlaySchedule, showMessage } from './dialogue_orchestrator.js';

let autoOpenedDialogueHistory = false;

function normalizeSceneMode(value) {
    return String(value || 'mainline').toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
}

function getInterludeIdFromResult(result) {
    const parsedId = Number.parseInt(result?.interlude?.id, 10);
    return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
}

function clearPendingJumpState() {
    state.pendingJumpIndex = null;
    state.pendingJumpTurn = null;
    state.pendingJumpSceneMode = null;
    state.pendingJumpInterludeId = null;
}

function setMusicPlayerAvailable(available) {
    if (elements.musicPlayerBtn) elements.musicPlayerBtn.style.display = available ? '' : 'none';
    if (elements.miniMusicPlayer) {
        elements.miniMusicPlayer.style.display = available ? '' : 'none';
        if (!available) elements.miniMusicPlayer.classList.add('minimized');
    }
}

function openDialogueHistory() {
    if (!elements.logContainer) return;
    setDialogueHistoryVisible(true);
    autoOpenedDialogueHistory = true;
    setTimeout(() => {
        if (elements.logMessages) {
            elements.logMessages.scrollTop = elements.logMessages.scrollHeight;
        }
    }, 0);
}

function closeAutoOpenedDialogueHistory() {
    if (!autoOpenedDialogueHistory) return;
    setDialogueHistoryVisible(false);
    autoOpenedDialogueHistory = false;
}

function hasDrawableSpriteEntry(entry) {
    if (!entry) return false;
    if (typeof entry === 'string') return entry.trim().length > 0;
    if (typeof entry !== 'object') return false;

    const assetPath = entry.path || entry.image || entry.src || entry.file;
    return typeof assetPath === 'string' && assetPath.trim().length > 0;
}

function sceneHasDrawableSprites(scene) {
    const sprites = scene?.sprites;
    if (Array.isArray(sprites)) return sprites.some(hasDrawableSpriteEntry);
    if (sprites && typeof sprites === 'object') return Object.values(sprites).some(hasDrawableSpriteEntry);
    return false;
}

function sequenceHasDrawableSprites(sequence) {
    return Array.isArray(sequence) && sequence.some(sceneHasDrawableSprites);
}

function shouldPreloadSequenceSpriteAssets() {
    return state.vnSettings?.performance?.sprite_texture_sequence_preload === true;
}

function pendingJumpMatchesResult(result) {
    if (state.pendingJumpIndex === null) return false;
    const pendingTurn = Number.parseInt(state.pendingJumpTurn, 10);
    const resultTurn = Number.parseInt(result?.turnNumber, 10);
    if (!Number.isInteger(pendingTurn) || pendingTurn !== resultTurn) return false;

    const pendingSceneMode = normalizeSceneMode(state.pendingJumpSceneMode);
    const resultSceneMode = normalizeSceneMode(result?.sceneMode);
    if (pendingSceneMode !== resultSceneMode) return false;

    if (resultSceneMode !== 'interlude') return true;
    const pendingInterludeId = Number.parseInt(state.pendingJumpInterludeId, 10);
    const resultInterludeId = getInterludeIdFromResult(result);
    return Number.isInteger(pendingInterludeId)
        && pendingInterludeId > 0
        && pendingInterludeId === resultInterludeId;
}

function consumePendingJumpIndex(result) {
    if (!pendingJumpMatchesResult(result)) return null;
    const parsedIndex = Number.parseInt(state.pendingJumpIndex, 10);
    clearPendingJumpState();
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) return 0;
    const sequenceMaxIndex = Array.isArray(result?.sequence)
        ? Math.max(0, result.sequence.length - 1)
        : 0;
    return Math.min(parsedIndex, sequenceMaxIndex);
}

export function resetViewerState() {
    window.dispatchEvent(new CustomEvent('system:clear-all-volatile-events'));
    state.isAtTurnZero = false;
    state.isGameOver = false;
    state.gameOverConfig = null;
    if (elements.userInputContainer) {
        elements.userInputContainer.classList.remove('game-over-active');
        elements.userInputContainer.style.display = ''; elements.userInputContainer.style.opacity = ''; elements.userInputContainer.style.pointerEvents = '';
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.classList.remove('game-over-active', 'has-character-speaker');
        elements.dialogueContainer.style.opacity = '';
    }
    import('../pixi_game_over.js').then(m => m.pixiGameOver.clear());
    resetSpriteState();
    pixiSpriteManager.reset();
    if (elements.background) {
        const video = elements.background.querySelector('.bg-video');
        if (video) { video.pause(); video.remove(); }
        state.currentBackground = '';
        pixiRenderer.reset();
    }
    state.currentCg = '';
    import('../pixi_renderer.js').then(m => m.pixiRenderer.updateCg('', true));
    if (elements.dialogueText) elements.dialogueText.textContent = '';
    if (elements.characterName) elements.characterName.textContent = '';
    if (elements.nameLine) elements.nameLine.style.display = 'none';
    if (elements.dialogueIndexIndicator) elements.dialogueIndexIndicator.textContent = '';
    stopAudio();
    stopVoice();
    state.isAudioPlaying = false;
    if (elements.logMessages) elements.logMessages.innerHTML = '';
    state.turnHistory = [];
    state.navigation = { prev: null, next: null };
    if (elements.prevChapterNav) elements.prevChapterNav.classList.add('hidden');
    if (elements.nextChapterNav) elements.nextChapterNav.classList.add('hidden');
    state.currentVN = null;
    state.currentIndex = 0;
    state.dialogueTransitionRequestID = null;
    state.isVoiceAudioPlaybackActive = false;
    clearPendingJumpState();
    state.lastShownIndex = undefined;
    state.charactersDisplayed = 0;
    if (state.typewriterInterval) clearInterval(state.typewriterInterval);
    cancelAutoPlaySchedule();
    if (elements.progressBar) elements.progressBar.style.width = '0%';
    state.pipelineManifest = null;
    state.pipelinePhaseColors = null;
    updateBlockingOverlay();
    setInputsEnabled(false);
    hidePrologueOverlay();
    if (state.notifications) state.notifications.forEach((n, id) => handleStatusUpdate({ id, type: 'clear' }));
    state.logBuffer = [];
    clearMissingTtsCrcs();
    resetTurnIntercepts();
}

export async function preloadAssets(result) {
    const assets = [];
    const spriteAssetUrls = [];
    const preloadSprites = shouldPreloadSequenceSpriteAssets();
    const turnStorageKey = result?.storageTurnKey || result?.turnNumber;
    if (result.finalBackground) assets.push(getAssetUrl(result.finalBackground, result.projectName));
    const sprites = new Set();
    result.sequence.forEach(scene => {
        if (preloadSprites && scene.sprites) Object.values(scene.sprites).forEach(sd => {
            if (typeof sd === 'string') sprites.add(sd);
            else if (sd?.path) sprites.add(sd.path);
        });
        if (scene.cg) assets.push(getAssetUrl(scene.cg, result.projectName));
        if (scene.crc && turnStorageKey) {
            assets.push(getAssetUrl(`projects/${result.projectName}/plugins/${result.chatFileName}/${turnStorageKey}/tts_core/${scene.crc}.wav`, result.projectName));
        }
        if (scene.clientEvents) {
            scene.clientEvents.forEach(ev => {
                if (ev.type === 'scene:transition' && ev.payload?.src) assets.push(getAssetUrl(ev.payload.src, result.projectName));
                if (ev.type === 'vn:ost-change' && ev.payload?.file) assets.push(getAssetUrl(`ost/${ev.payload.file}`, result.projectName));
            });
        }
    });
    sprites.forEach(s => {
        const url = getAssetUrl(s, result.projectName);
        assets.push(url);
        spriteAssetUrls.push(url);
    });
    if (assets.length === 0) {
        debugLog('[PixiJS] No assets to preload');
        return;
    }
    try {
        await PIXI.Assets.load(assets);
        if (spriteAssetUrls.length > 0) pixiSpriteManager.registerPreloadedSpriteAssets(spriteAssetUrls);
        debugLog('[PixiJS] Assets Preloaded', assets.length);
    } catch (e) { debugError('[PixiJS] Preload Failed', e); }
}

export async function applyVNResult(result) {
    const wasGenerationPhase = state.isGenerationPhase || result.isReplay === false;
    const applyToken = (Number.isInteger(state.vnApplyToken) ? state.vnApplyToken : 0) + 1;
    state.vnApplyToken = applyToken;
    state.isApplyingVNResult = true;
    try {
        debugLog('Received VN Payload:', result);

        state.isAtTurnZero = false;
        const previousVN = state.currentVN || null;
        const previousSceneMode = String(previousVN?.sceneMode || 'mainline').toLowerCase();
        const nextSceneMode = String(result?.sceneMode || 'mainline').toLowerCase();
        const previousStorageKey = previousVN?.storageTurnKey || previousVN?.turnNumber || null;
        const nextStorageKey = result?.storageTurnKey || result?.turnNumber || null;
        const crossesInterludeBoundary = !!previousVN
            && (previousSceneMode === 'interlude' || nextSceneMode === 'interlude')
            && (previousSceneMode !== nextSceneMode || previousStorageKey !== nextStorageKey);

        state.lastMessageRequestID += 1;
        state.dialogueTransitionRequestID = null;
        state.isVoiceAudioPlaybackActive = false;
        clearInterval(state.typewriterInterval);
        cancelAutoPlaySchedule();
        if (elements.progressBar) elements.progressBar.style.width = '0%';

        if (crossesInterludeBoundary) {
            pixiTitleManager.clearAll();
            resetSpriteState();
            pixiSpriteManager.reset();
            state.currentBackground = null;
            pixiRenderer.clearBackground(true);
            state.currentCg = '';
            pixiRenderer.updateCg('', true);
        }

        if (result.sequence && result.sequence.length > 0 && (!result.navigation || !result.navigation.next)) {
            const last = result.sequence[result.sequence.length - 1];
            result.sequence.push({ character: '', text: '', line: '', sprites: last.sprites ? (Array.isArray(last.sprites) ? [...last.sprites] : { ...last.sprites }) : [], isVirtual: true });
        }

        const prevLast = previousVN?.sequence?.[previousVN.sequence.length - 1];
        const startsFreshVisualScene = crossesInterludeBoundary || result.isReplay === true || !previousVN;
        const useOwnFinalBackgroundAsInitial = startsFreshVisualScene
            && nextSceneMode === 'interlude'
            && result.finalBackground;
        const effectiveInitialBackground = useOwnFinalBackgroundAsInitial
            ? result.finalBackground
            : (result.initialBackground || result.finalBackground || null);
        const initialVfx = crossesInterludeBoundary ? [] : (prevLast?.directorState?.vfx || []);
        const initialSfx = crossesInterludeBoundary ? [] : (prevLast?.directorState?.sfx || []);
        result.initialBackground = effectiveInitialBackground;
        result.sequence = compileSequence(result.sequence, result.playerCharacterName, effectiveInitialBackground, result.finalSong, initialVfx, initialSfx, window.CINEMATOGRAPHER_SETTINGS || {});

        if (previousVN?.turnNumber !== undefined && previousVN.turnNumber < result.turnNumber) {
            if (!state.turnHistory.find(t => t.turnNumber === previousVN.turnNumber)) state.turnHistory.push(previousVN);
        }

        if (typeof result.playerCharacterName === 'string') {
            state.playerCharacterName = result.playerCharacterName.trim();
        }

        state.currentVN = result;
        if (result.isGameOver) {
            state.gameOverConfig = result.gameOverConfig || { text: 'GAME OVER', subtext: '' };
            if (!result.sequence.some(s => s.directorState?.isGameOver)) {
                const lastRealIdx = result.sequence.length - 1 - (result.sequence[result.sequence.length - 1]?.isVirtual ? 1 : 0);
                if (lastRealIdx >= 0) {
                    const lastReal = result.sequence[lastRealIdx];
                    if (!lastReal.directorState) lastReal.directorState = {};
                    lastReal.directorState.isGameOver = true;
                    lastReal.directorState.gameOverConfig = state.gameOverConfig;
                }
            }
        }

        clearMissingTtsCrcs();
        initializeTurnIntercepts(result);
        const restoredJumpIndex = consumePendingJumpIndex(result);
        state.currentIndex = restoredJumpIndex !== null ? restoredJumpIndex : 0;

        state.lastShownIndex = undefined;
        state.navigation = result.navigation || { prev: null, next: null };

        const hasDrawableSprites = sequenceHasDrawableSprites(result.sequence);
        setScenePresentation(hasDrawableSprites ? 'scene' : 'fallback', hasDrawableSprites ? '' : 'no-drawable-sprites');

        const targetDirectorState = result.sequence?.[state.currentIndex]?.directorState;
        const hasTargetBackground = !!targetDirectorState
            && Object.prototype.hasOwnProperty.call(targetDirectorState, 'background');
        const displayBackground = hasTargetBackground
            ? targetDirectorState.background
            : (effectiveInitialBackground || result.finalBackground);
        const prepareBackground = async () => {
            if (displayBackground) {
                const isVideo = displayBackground.endsWith('.mp4') || displayBackground.endsWith('.webm');
                state.currentBackground = displayBackground;
                await pixiRenderer.updateBackground(displayBackground, isVideo, crossesInterludeBoundary);
                window.dispatchEvent(new CustomEvent('vn:background-updated', { detail: { background: displayBackground, isVideo } }));
            } else if (hasTargetBackground || crossesInterludeBoundary) {
                state.currentBackground = null;
                pixiRenderer.clearBackground(true);
            }
        };

        // Loading the restored scene background alongside the existing bounded
        // preload avoids waiting behind unrelated turn assets without retaining more.
        await Promise.all([preloadAssets(result), prepareBackground()]);

        if (wasGenerationPhase) {
            try {
                const focusData = await window.socket.emitReceive('get-window-focus-state', {});
                state.isFocused = focusData.isFocused;
            } catch (e) { debugError('Failed to verify true focus state', e); }
        }

        if (result.finalSong) {
            setMusicPlayerAvailable(true);
            if (wasGenerationPhase && state.vnSettings.audio?.mute_audio_during_generation && !state.isFocused) {
                const src = getAssetUrl(result.finalSong, result.projectName);
                elements.audioPlayer.src = new URL(src, window.location.href).href;
                elements.audioPlayer.loop = true;
                if (elements.musicSongName) elements.musicSongName.textContent = result.finalSong.split('/').pop().replace(/[_-]/g, ' ');
                state.pendingOstResume = true; state.pendingSfxResume = true;
            } else playAudio(getAssetUrl(result.finalSong, result.projectName), result.finalSong);
        } else {
            stopAudio();
            setMusicPlayerAvailable(false);
        }

        pixiTitleManager.init();
        pixiRenderer.initRuntimeListeners();

        state.notifications.forEach((n, id) => { if (n.blocking) handleStatusUpdate({ id, type: 'clear' }); });
        if (state.etaData) handleStatusUpdate({ id: 'eta-tracker', type: 'clear' });

        handleGenerationOutcome(wasGenerationPhase);

        if (wasGenerationPhase && result.pipelineErrors?.length > 0) {
            result.pipelineErrors.forEach((err, idx) => {
                setTimeout(() => handleStatusUpdate({ id: `pipeline-err-${Date.now()}-${idx}`, message: `Issue in: ${err.step}`, details: err.error, icon: '⚠️', timeout: 60000, variant: 'error' }), 500 + (idx * 300));
            });
        }

        await showMessage(state.currentIndex, result.isReplay);

        if (hasDrawableSprites) {
            closeAutoOpenedDialogueHistory();
        } else {
            openDialogueHistory();
        }

        await window.socket.emitReceive('execute-frontend-hook', {
            hookName: 'HOOK_VN_GUI_READY',
            turnNumber: result.turnNumber,
            dialogueIndex: state.currentIndex
        });
    } catch (e) {
        debugError('Failed to apply VN result', e);
    } finally {
        if (state.vnApplyToken === applyToken) {
            state.isApplyingVNResult = false;
        }
        try {
            window.dispatchEvent(new CustomEvent('vn:result-applied', {
                detail: {
                    turnNumber: result?.turnNumber ?? null,
                    sceneMode: result?.sceneMode || 'mainline'
                }
            }));
        } catch (_) { }
    }
}

function handleGenerationOutcome(wasGen = false) {
    if (!wasGen && !state.isGenerationPhase) return;
    if (state.vnSettings.audio?.play_sound_on_ready) playReadySound();
    if (state.vnSettings.interface?.blink_taskbar_on_ready) window.socket.emit('vn:blink-taskbar');
    if (state.vnSettings.audio?.mute_audio_during_generation) {
        if (state.isFocused) {
            window.dispatchEvent(new CustomEvent('audio:unmute-generation'));
            if (elements.audioPlayer?.paused && elements.audioPlayer.src) elements.audioPlayer.play().catch(e => debugError('OST resume fail', e));
        } else {
            state.pendingOstResume = true; state.pendingSfxResume = true; state.pendingVoiceResume = true;
        }
    }
}

function playReadySound() {
    const audio = new Audio(`${SERVER_URL}/engine/views/vn_viewer/assets/sounds/ready_notification.wav`);
    audio.volume = (state.vnSettings.audio?.sfx_volume ?? 0.5) * 0.6;
    audio.play().catch(() => handleStatusUpdate({ id: 'sound-blocked', message: 'Notification sound blocked.', color: '#ffaa00', timeout: 3000 }));
}
