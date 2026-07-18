// engine/views/vn_viewer/js/engine.js

import { elements } from './elements.js';
import { updateAudioVolume, updateVoiceVolume, stopAudio, stopVoice } from './modules/audio_manager.js';
import { toggleStatusConsole, processMessage, handleSystemLog } from './modules/generation_manager.js';
import {
    cancelAutoPlaySchedule,
    handleWindowFocusChanged,
    resumeAutoPlayForCurrentMessage,
    showNextMessage,
    showPrevMessage,
    showLastMessage
} from './modules/dialogue_orchestrator.js';
import { applyVNResult, resetViewerState } from './modules/payload_manager.js';
import { handleStatusUpdate, updateBlockingOverlay } from './modules/status_manager.js';

// Exports for backward compatibility and cross-module access
export { updateAudioVolume, updateVoiceVolume, stopAudio, stopVoice };
export { applyVNResult, resetViewerState };
export { processMessage, handleSystemLog, toggleStatusConsole };
export {
    cancelAutoPlaySchedule,
    handleWindowFocusChanged,
    resumeAutoPlayForCurrentMessage,
    showNextMessage,
    showPrevMessage,
    showLastMessage
};
export { handleStatusUpdate, updateBlockingOverlay };

// Initialization and Global Listeners
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (elements.audioPlayer) {
            elements.audioPlayer.addEventListener('timeupdate', () => {
                if (elements.musicProgressFill) {
                    const progress = (elements.audioPlayer.currentTime / elements.audioPlayer.duration) * 100;
                    elements.musicProgressFill.style.width = `${progress}%`;
                }
                if (elements.musicTimeDisplay) {
                    const current = Math.floor(elements.audioPlayer.currentTime / 60) + ':' + Math.floor(elements.audioPlayer.currentTime % 60).toString().padStart(2, '0');
                    const total = Math.floor(elements.audioPlayer.duration / 60) + ':' + Math.floor(elements.audioPlayer.duration % 60).toString().padStart(2, '0');
                    elements.musicTimeDisplay.textContent = `${current} / ${total}`;
                }
            });
            elements.audioPlayer.addEventListener('play', () => { if (elements.musicPlayPauseBtn) elements.musicPlayPauseBtn.innerHTML = '<i>⏸</i>'; });
            elements.audioPlayer.addEventListener('pause', () => { if (elements.musicPlayPauseBtn) elements.musicPlayPauseBtn.innerHTML = '<i>▶</i>'; });
            if (elements.statusConsoleToggle) elements.statusConsoleToggle.addEventListener('click', toggleStatusConsole);
        }
    }, 100);
});

// Proxy for dynamic calls if needed (rare in this architecture but good for safety)
window.vnEngine = {
    applyVNResult,
    resetViewerState,
    processMessage,
    showNextMessage,
    showPrevMessage,
    showLastMessage,
    cancelAutoPlaySchedule,
    resumeAutoPlayForCurrentMessage,
    handleStatusUpdate,
    handleSystemLog,
    handleWindowFocusChanged
};
