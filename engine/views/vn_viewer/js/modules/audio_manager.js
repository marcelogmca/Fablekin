// engine/views/vn_viewer/js/modules/audio_manager.js
let volumeFadeInterval = null;
const activeVoicePlaybacks = new Map();
const talkingReferenceCounts = new Map();
let primaryVoicePlayback = null;

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
    const volume = state.vnSettings.audio?.tts_volume ?? 0.5;
    for (const player of getVoicePlayers()) player.volume = volume;
}

function getVoicePlayers() {
    return [elements.voicePlayer, elements.voicePlayerSecondary].filter(Boolean);
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

    if (!state.isViewerTabActive) {
        state.pendingOstResume = true;
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

function syncVoiceState() {
    const active = Array.from(activeVoicePlaybacks.values()).filter(playback => !playback.finished && playback.started);
    const primary = primaryVoicePlayback && !primaryVoicePlayback.finished ? primaryVoicePlayback : active.at(-1) || null;
    if (!primaryVoicePlayback || primaryVoicePlayback.finished) primaryVoicePlayback = primary;

    state.isAudioPlaying = active.length > 0;
    state.isVoiceAudioPlaybackActive = !!primary?.actualAudioPlaying;
    state.currentTalkingCharacter = primary?.character || null;
    state.activeTalkingCharacters = Object.fromEntries(talkingReferenceCounts.entries());
}

function startTalkingForPlayback(playback) {
    if (!playback?.character || playback.talkingStarted) return;
    playback.talkingStarted = true;
    const count = (talkingReferenceCounts.get(playback.character) || 0) + 1;
    talkingReferenceCounts.set(playback.character, count);
    if (count === 1) {
        if (state.activeAnimators[playback.character]) state.activeAnimators[playback.character].startTalking();
        pixiSpriteManager.startTalking(playback.character);
    }
    syncVoiceState();
}

function stopTalkingForPlayback(playback) {
    if (!playback?.character || !playback.talkingStarted) return;
    playback.talkingStarted = false;
    const count = Math.max(0, (talkingReferenceCounts.get(playback.character) || 1) - 1);
    if (count > 0) {
        talkingReferenceCounts.set(playback.character, count);
        return;
    }
    talkingReferenceCounts.delete(playback.character);
    if (state.activeAnimators[playback.character]) state.activeAnimators[playback.character].stopTalking();
    pixiSpriteManager.stopTalking(playback.character);
}

function estimateTalkingDurationMs(lineText) {
    const words = (lineText || '').trim().split(/\s+/).filter(Boolean).length;
    const punctuationPauses = ((lineText || '').match(/[,.!?;:]/g) || []).length;
    return Math.max(1200, Math.min(15000, 500 + (words * 320) + (punctuationPauses * 140)));
}

function selectVoicePlayer() {
    const players = getVoicePlayers();
    const occupiedPlayers = new Set(
        Array.from(activeVoicePlaybacks.values())
            .filter(playback => !playback.finished && playback.player)
            .map(playback => playback.player)
    );
    const available = players.find(player => !occupiedPlayers.has(player));
    if (available) return available;

    // Two channels are intentionally the maximum. A third overlapping line evicts
    // the oldest voice instead of creating unbounded conversational polyphony.
    const oldest = Array.from(activeVoicePlaybacks.values())
        .filter(playback => !playback.finished && playback.player)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) oldest.finish({ stopPlayer: true, clearSource: true });
    return players.find(player => !Array.from(activeVoicePlaybacks.values()).some(
        playback => !playback.finished && playback.player === player
    )) || players[0] || null;
}

export function stopVoice() {
    state.voicePlaybackToken++;
    for (const playback of Array.from(activeVoicePlaybacks.values())) {
        playback.finish({ stopPlayer: true, clearSource: true });
    }
    for (const player of getVoicePlayers()) {
        try { player.pause(); } catch (_) { }
        player.src = '';
    }
    activeVoicePlaybacks.clear();
    primaryVoicePlayback = null;
    state.currentVoicePlayback = null;
    state.currentAudioEndedPromise = null;
    talkingReferenceCounts.clear();
    state.audioEndedPromiseResolver = null;
    state.emulatedTalkingTimeout = null;
    stopAllTalking();
    pixiSpriteManager.stopAllTalking();
    syncVoiceState();
}

/**
 * Returns the delay from now until the requested floor-transfer boundary.
 * Null means there is no playable voice anchor and Auto-Play should use its
 * ordinary delay fallback.
 */
export async function getVoiceBoundaryDelay(playback, offsetMs) {
    if (!playback || !Number.isFinite(offsetMs)) return null;
    await playback.readyPromise;
    if (!playback.actualAudioStarted) return null;
    if (playback.finished) return Math.max(0, offsetMs);

    const durationMs = Number.isFinite(playback.durationMs)
        ? playback.durationMs
        : (Number.isFinite(playback.player?.duration) ? playback.player.duration * 1000 : null);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

    const currentTimeMs = Number.isFinite(playback.player?.currentTime)
        ? playback.player.currentTime * 1000
        : Math.max(0, performance.now() - playback.startedAt);
    return Math.max(0, (durationMs - currentTimeMs) + offsetMs);
}

export async function resumePendingVoicePlayback() {
    const resumable = Array.from(activeVoicePlaybacks.values())
        .filter(playback => !playback.finished && typeof playback.resume === 'function');
    if (resumable.length === 0) return false;
    const results = await Promise.allSettled(resumable.map(playback => playback.resume()));
    return results.some(result => result.status === 'fulfilled');
}

export function playVoice(crc, resolveAudioEnded, talkingCharacterRaw, text, options = {}) {
    const preserveOutgoing = options.preserveOutgoing === true;
    const emulateMissing = options.emulateMissing !== false;

    if (!preserveOutgoing) stopVoice();

    let resolveEndedPromise;
    let resolveReadyPromise;
    const playback = {
        token: ++state.voicePlaybackToken,
        character: normalizeCharacterKey(talkingCharacterRaw),
        crc: crc ? String(crc) : null,
        player: null,
        createdAt: performance.now(),
        startedAt: null,
        durationMs: null,
        started: false,
        actualAudioStarted: false,
        actualAudioPlaying: false,
        talkingStarted: false,
        finished: false,
        watchdogTimeout: null,
        voiceErrorHandler: null,
        playAttemptId: 0,
        readyResolved: false,
        endedPromise: new Promise(resolve => { resolveEndedPromise = resolve; }),
        readyPromise: new Promise(resolve => { resolveReadyPromise = resolve; })
    };

    playback.resolveReady = () => {
        if (playback.readyResolved) return;
        playback.readyResolved = true;
        resolveReadyPromise(playback);
    };

    playback.finish = ({ stopPlayer = false, clearSource = false } = {}) => {
        if (playback.finished) return;
        playback.finished = true;
        playback.actualAudioPlaying = false;
        if (playback.watchdogTimeout) clearTimeout(playback.watchdogTimeout);
        playback.watchdogTimeout = null;
        const player = playback.player;
        if (player) {
            player.removeEventListener('ended', playback.onEnded);
            player.removeEventListener('loadedmetadata', playback.onMetadata);
            player.removeEventListener('durationchange', playback.onMetadata);
            if (playback.voiceErrorHandler) player.removeEventListener('error', playback.voiceErrorHandler);
            if (stopPlayer) {
                try { player.pause(); } catch (_) { }
            }
            if (clearSource) player.src = '';
        }
        stopTalkingForPlayback(playback);
        activeVoicePlaybacks.delete(playback.token);
        if (primaryVoicePlayback === playback) {
            primaryVoicePlayback = Array.from(activeVoicePlaybacks.values()).filter(item => !item.finished).at(-1) || null;
        }
        playback.resolveReady();
        syncVoiceState();
        resolveEndedPromise();
        if (resolveAudioEnded) resolveAudioEnded();
    };

    playback.onEnded = () => playback.finish();
    playback.onMetadata = () => {
        if (Number.isFinite(playback.player?.duration) && playback.player.duration > 0) {
            playback.durationMs = playback.player.duration * 1000;
            if (!playback.actualAudioStarted) return;
            if (playback.watchdogTimeout) clearTimeout(playback.watchdogTimeout);
            playback.watchdogTimeout = setTimeout(
                () => playback.finish(),
                Math.max(250, ((playback.player.duration - (playback.player.currentTime || 0)) * 1000) + 250)
            );
        }
    };

    activeVoicePlaybacks.set(playback.token, playback);
    primaryVoicePlayback = playback;
    syncVoiceState();

    if (isPixiTakeoverActive() || (!crc && !emulateMissing)) {
        playback.finish();
        return playback;
    }

    const startEmulatedTalking = () => {
        if (playback.finished) return;
        if (playback.player) {
            playback.player.removeEventListener('ended', playback.onEnded);
            playback.player.removeEventListener('loadedmetadata', playback.onMetadata);
            playback.player.removeEventListener('durationchange', playback.onMetadata);
            if (playback.voiceErrorHandler) {
                playback.player.removeEventListener('error', playback.voiceErrorHandler);
            }
            try { playback.player.pause(); } catch (_) { }
            playback.player.src = '';
        }
        playback.player = null;
        playback.started = true;
        playback.startedAt = performance.now();
        playback.actualAudioStarted = false;
        playback.actualAudioPlaying = false;
        playback.durationMs = estimateTalkingDurationMs(text);
        startTalkingForPlayback(playback);
        playback.resolveReady();
        playback.watchdogTimeout = setTimeout(() => playback.finish(), playback.durationMs);
        syncVoiceState();
    };

    if (!crc) {
        startEmulatedTalking();
        return playback;
    }

    const player = selectVoicePlayer();
    if (!player) {
        startEmulatedTalking();
        return playback;
    }
    playback.player = player;
    player.addEventListener('ended', playback.onEnded);
    player.addEventListener('loadedmetadata', playback.onMetadata);
    player.addEventListener('durationchange', playback.onMetadata);

    const fallbackUrl = `http://127.0.0.1:8000/audio/${crc}.wav`;
    const handlePlaybackFailure = (attemptId, isFallback) => {
        if (playback.finished || attemptId !== playback.playAttemptId) return;
        if (!isFallback) {
            tryPlay(fallbackUrl, true);
            return;
        }
        addMissingTtsCrc(crc);
        startEmulatedTalking();
    };

    const tryPlay = (url, isFallback = false) => {
        if (playback.finished) return;
        const attemptId = ++playback.playAttemptId;
        if (playback.voiceErrorHandler) player.removeEventListener('error', playback.voiceErrorHandler);
        playback.voiceErrorHandler = () => handlePlaybackFailure(attemptId, isFallback);
        player.addEventListener('error', playback.voiceErrorHandler, { once: true });
        player.src = url;
        updateVoiceVolume();
        playback.resume = () => player.play().then(() => {
            if (playback.finished || attemptId !== playback.playAttemptId) return;
            playback.started = true;
            playback.actualAudioStarted = true;
            playback.actualAudioPlaying = true;
            playback.startedAt = performance.now();
            startTalkingForPlayback(playback);
            playback.onMetadata();
            playback.resolveReady();
            removeMissingTtsCrc(crc);
            syncVoiceState();
        }).catch(() => handlePlaybackFailure(attemptId, isFallback));
        if (state.pendingVoiceResume) return;
        playback.resume();
    };

    const sceneData = state.currentVN;
    const storageTurnKey = sceneData?.storageTurnKey || sceneData?.turnNumber;
    const archiveUrl = (sceneData?.projectName && sceneData?.chatFileName && storageTurnKey)
        ? getAssetUrl(`projects/${sceneData.projectName}/plugins/${sceneData.chatFileName}/${storageTurnKey}/tts_core/${crc}.wav`, sceneData.projectName)
        : null;
    archiveUrl ? tryPlay(archiveUrl) : tryPlay(fallbackUrl, true);
    return playback;
}
