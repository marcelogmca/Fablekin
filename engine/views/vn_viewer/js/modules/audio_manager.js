// engine/views/vn_viewer/js/modules/audio_manager.js
let volumeFadeInterval = null;

import { state, runtime } from '../state.js';
import { elements } from '../elements.js';
import { debugLog, debugError, getAssetUrl, normalizeCharacterKey } from '../utils.js';
import { stopAllTalking } from '../sprite_manager.js';
import { pixiSpriteManager } from '../pixi_sprite_manager.js';
import { isPixiTakeoverActive } from '../pixi_takeover_manager.js';

export function updateAudioVolume() {
    if (elements.audioPlayer && !volumeFadeInterval) {
        elements.audioPlayer.volume = state.vnSettings.audio?.ost_volume ?? 0.5;
    }
}

export function setOstVolumeFade(targetVolume, durationMs) {
    if (!elements.audioPlayer) return;
    if (volumeFadeInterval) clearInterval(volumeFadeInterval);

    const startVolume = elements.audioPlayer.volume;
    const startTime = performance.now();

    volumeFadeInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        
        elements.audioPlayer.volume = startVolume + (targetVolume - startVolume) * progress;

        if (progress >= 1) {
            clearInterval(volumeFadeInterval);
            volumeFadeInterval = null;
        }
    }, 16); // ~60fps
}

export function updateVoiceVolume() {
    if (elements.voicePlayer) elements.voicePlayer.volume = state.vnSettings.audio?.tts_volume ?? 0.5;
}

function emitMissingTtsUpdate() {
    const list = Array.isArray(state.missingTtsCrcs) ? [...state.missingTtsCrcs] : [];
    window.dispatchEvent(new CustomEvent('tts:missing-lines-updated', {
        detail: { count: list.length, crcs: list }
    }));
}

export function clearMissingTtsCrcs() {
    state.missingTtsCrcs = [];
    emitMissingTtsUpdate();
}

export function getMissingTtsCrcs() {
    return Array.isArray(state.missingTtsCrcs) ? [...state.missingTtsCrcs] : [];
}

export function addMissingTtsCrc(crc) {
    if (!crc) return;
    const normalized = String(crc);
    if (!Array.isArray(state.missingTtsCrcs)) state.missingTtsCrcs = [];
    if (!state.missingTtsCrcs.includes(normalized)) {
        state.missingTtsCrcs.push(normalized);
        emitMissingTtsUpdate();
    }
}

export function removeMissingTtsCrc(crc) {
    if (!crc || !Array.isArray(state.missingTtsCrcs)) return;
    const normalized = String(crc);
    const next = state.missingTtsCrcs.filter(existing => existing !== normalized);
    if (next.length !== state.missingTtsCrcs.length) {
        state.missingTtsCrcs = next;
        emitMissingTtsUpdate();
    }
}

function formatSongName(name) {
    if (!name) return 'Unknown OST';
    let cleanName = name.split('/').pop().replace(/\.(mp3|wav|ogg|webm|m4a)$/i, '').replace(/[_-]/g, ' ');
    return cleanName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function playAudio(src, filename) {
    if (!elements.audioPlayer || !src) return;
    if (isPixiTakeoverActive()) {
        debugLog('[Audio] Ignoring OST play request while PIXI takeover is active.');
        return;
    }

    const normalizedFile = filename ? filename.replace(/^ost\//, '') : null;
    let absoluteSrc;
    try { absoluteSrc = new URL(src, window.location.href).href; } catch { absoluteSrc = src; }

    const currentSrc = elements.audioPlayer.src;
    const isSameSrc = currentSrc && (currentSrc === absoluteSrc || currentSrc.includes(src) || absoluteSrc.includes(currentSrc));

    if (isSameSrc && !elements.audioPlayer.paused) {
        state.currentOst = normalizedFile;
        return;
    }

    if (state.pendingOstResume) {
        state.currentOst = normalizedFile;
        elements.audioPlayer.src = absoluteSrc;
        elements.audioPlayer.loop = true;
        updateAudioVolume();
        if (elements.musicSongName) elements.musicSongName.textContent = formatSongName(filename || src);
        return;
    }

    if (isSameSrc && elements.audioPlayer.paused) {
        state.currentOst = normalizedFile;
        elements.audioPlayer.play().catch(e => debugError('BG audio resume fail', e));
        return;
    }

    debugLog(`[Audio] Switching OST to: ${filename}`);
    state.currentOst = normalizedFile;
    elements.audioPlayer.src = absoluteSrc;
    elements.audioPlayer.loop = true;
    updateAudioVolume();
    elements.audioPlayer.play().catch(e => debugError('BG audio fail', e));

    if (elements.musicSongName) elements.musicSongName.textContent = formatSongName(filename || src);

    if (state.vnSettings.interface?.show_ost_popup && !state.vnSettings.interface?.show_music_player && elements.miniMusicPlayer) {
        if (runtime.musicPopupTimeout) clearTimeout(runtime.musicPopupTimeout);
        elements.miniMusicPlayer.classList.remove('minimized');
        runtime.musicPopupTimeout = setTimeout(() => {
            if (!state.vnSettings.interface?.show_music_player) elements.miniMusicPlayer.classList.add('minimized');
            runtime.musicPopupTimeout = null;
        }, 5000);
    }
}

export function stopAudio() {
    state.currentOst = null;
    if (elements.audioPlayer) {
        elements.audioPlayer.pause();
        elements.audioPlayer.src = '';
    }
    if (elements.musicSongName) elements.musicSongName.textContent = 'No OST Playing';
    if (elements.musicProgressFill) elements.musicProgressFill.style.width = '0%';
    if (elements.musicTimeDisplay) elements.musicTimeDisplay.textContent = '0:00 / 0:00';
    if (elements.musicPlayPauseBtn) elements.musicPlayPauseBtn.innerHTML = '<i>▶</i>';
}

export function stopVoice() {
    state.voicePlaybackToken++;
    state.isAudioPlaying = false;
    state.isVoiceAudioPlaybackActive = false;
    state.currentTalkingCharacter = null;
    if (state.emulatedTalkingTimeout) {
        clearTimeout(state.emulatedTalkingTimeout);
        state.emulatedTalkingTimeout = null;
    }
    if (elements.voicePlayer) {
        elements.voicePlayer.pause();
        if (state.audioEndedPromiseResolver) {
            const previousResolver = state.audioEndedPromiseResolver;
            state.audioEndedPromiseResolver = null;
            previousResolver();
        }
        elements.voicePlayer.src = '';
    }
    stopAllTalking();
    pixiSpriteManager.stopAllTalking();
}

export function playVoice(crc, resolveAudioEnded, talkingCharacterRaw, text) {
    if (isPixiTakeoverActive()) {
        state.isAudioPlaying = false;
        state.isVoiceAudioPlaybackActive = false;
        state.currentTalkingCharacter = null;
        if (resolveAudioEnded) resolveAudioEnded();
        return;
    }

    const sceneData = state.currentVN;
    const talkingCharacter = normalizeCharacterKey(talkingCharacterRaw);
    const voiceToken = ++state.voicePlaybackToken;
    state.isVoiceAudioPlaybackActive = false;
    const isStaleVoiceSession = () => state.voicePlaybackToken !== voiceToken;
    let hasResolved = false;
    let voiceErrorHandler = null;
    let playAttemptId = 0;

    stopAllTalking();
    pixiSpriteManager.stopAllTalking();

    const estimateTalkingDurationMs = (lineText) => {
        const words = (lineText || '').trim().split(/\s+/).filter(Boolean).length;
        const punctuationPauses = ((lineText || '').match(/[,.!?;:]/g) || []).length;
        return Math.max(1200, Math.min(15000, 500 + (words * 320) + (punctuationPauses * 140)));
    };

    const startTalkingVisuals = () => {
        if (talkingCharacter && state.activeAnimators[talkingCharacter]) state.activeAnimators[talkingCharacter].startTalking();
        pixiSpriteManager.startTalking(talkingCharacter);
    };

    const scheduleEmulatedTalkingStop = (durationMs) => {
        if (isStaleVoiceSession()) return;
        if (state.emulatedTalkingTimeout) clearTimeout(state.emulatedTalkingTimeout);
        state.emulatedTalkingTimeout = setTimeout(() => {
            if (state.emulatedTalkingTimeout) { clearTimeout(state.emulatedTalkingTimeout); state.emulatedTalkingTimeout = null; }
            resolveVoiceEnded();
        }, Math.max(250, durationMs));
    };

    const startEmulatedTalking = () => {
        if (isStaleVoiceSession() || hasResolved) return;
        state.isAudioPlaying = true;
        state.isVoiceAudioPlaybackActive = false;
        state.currentTalkingCharacter = talkingCharacter;
        startTalkingVisuals();
        scheduleEmulatedTalkingStop(estimateTalkingDurationMs(text));
    };

    const armAudioEndWatchdog = () => {
        if (isStaleVoiceSession()) return;
        const durationSeconds = elements.voicePlayer?.duration;
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
        scheduleEmulatedTalkingStop(Math.max(0, (durationSeconds - (elements.voicePlayer.currentTime || 0)) * 1000) + 250);
    };

    const resolveVoiceEnded = () => {
        if (hasResolved) return;
        hasResolved = true;
        elements.voicePlayer.removeEventListener('ended', resolveVoiceEnded);
        if (voiceErrorHandler) elements.voicePlayer.removeEventListener('error', voiceErrorHandler);
        elements.voicePlayer.removeEventListener('loadedmetadata', armAudioEndWatchdog);
        elements.voicePlayer.removeEventListener('durationchange', armAudioEndWatchdog);
        if (!isStaleVoiceSession()) {
            state.isAudioPlaying = false;
            state.isVoiceAudioPlaybackActive = false;
            state.currentTalkingCharacter = null;
            if (state.emulatedTalkingTimeout) { clearTimeout(state.emulatedTalkingTimeout); state.emulatedTalkingTimeout = null; }
            if (talkingCharacter && state.activeAnimators[talkingCharacter]) state.activeAnimators[talkingCharacter].stopTalking();
            pixiSpriteManager.stopAllTalking();
            if (state.audioEndedPromiseResolver === resolveVoiceEnded) state.audioEndedPromiseResolver = null;
        }
        if (resolveAudioEnded) resolveAudioEnded();
    };

    elements.voicePlayer.pause();
    if (state.audioEndedPromiseResolver) {
        elements.voicePlayer.removeEventListener('ended', state.audioEndedPromiseResolver);
        elements.voicePlayer.removeEventListener('error', state.audioEndedPromiseResolver);
        const previousResolver = state.audioEndedPromiseResolver;
        state.audioEndedPromiseResolver = null;
        previousResolver();
    }

    if (!crc) { startEmulatedTalking(); return; }

    state.isAudioPlaying = false;
    state.currentTalkingCharacter = talkingCharacter;
    state.audioEndedPromiseResolver = resolveVoiceEnded;
    elements.voicePlayer.addEventListener('ended', resolveVoiceEnded);
    elements.voicePlayer.addEventListener('loadedmetadata', armAudioEndWatchdog);
    elements.voicePlayer.addEventListener('durationchange', armAudioEndWatchdog);

    const fallbackUrl = `http://127.0.0.1:8000/audio/${crc}.wav`;

    const handlePlaybackFailure = (attemptId, isFallback) => {
        if (isStaleVoiceSession() || hasResolved || attemptId !== playAttemptId) return;
        if (!isFallback) {
            tryPlay(fallbackUrl, true);
            return;
        }
        addMissingTtsCrc(crc);
        startEmulatedTalking();
    };

    const tryPlay = (url, isFallback = false) => {
        if (isStaleVoiceSession()) return;
        const attemptId = ++playAttemptId;
        if (voiceErrorHandler) elements.voicePlayer.removeEventListener('error', voiceErrorHandler);
        voiceErrorHandler = () => handlePlaybackFailure(attemptId, isFallback);
        elements.voicePlayer.addEventListener('error', voiceErrorHandler, { once: true });
        elements.voicePlayer.src = url;
        updateVoiceVolume();
        if (state.pendingVoiceResume) return;
        elements.voicePlayer.play().then(() => {
            if (isStaleVoiceSession() || hasResolved || attemptId !== playAttemptId) return;
            state.isAudioPlaying = true;
            state.isVoiceAudioPlaybackActive = true;
            startTalkingVisuals();
            armAudioEndWatchdog();
            removeMissingTtsCrc(crc);
        }).catch(() => {
            handlePlaybackFailure(attemptId, isFallback);
        });
    };
    const storageTurnKey = sceneData?.storageTurnKey || sceneData?.turnNumber;
    const archiveUrl = (sceneData?.projectName && sceneData?.chatFileName && storageTurnKey)
        ? getAssetUrl(`projects/${sceneData.projectName}/plugins/${sceneData.chatFileName}/${storageTurnKey}/tts_core/${crc}.wav`, sceneData.projectName)
        : null;
    archiveUrl ? tryPlay(archiveUrl) : tryPlay(fallbackUrl, true);
}
