// engine/views/vn_viewer/js/modules/generation_manager.js

import { state, runtime } from '../state.js';
import { elements } from '../elements.js';
import { debugError } from '../utils.js';
import { applyVNSettings, debouncedSaveVNSettings } from '../settings_manager.js';
import { updateBlockingOverlay, handleStatusUpdate } from './status_manager.js';
import { setInputsEnabled } from './ui_manager.js';
import { applyVNResult } from './payload_manager.js';

export async function processMessage(message, directorPromptOverride = null, softFeedbackOverride = null, metadata = {}) {
    try {
        setInputsEnabled(false);
        state.logBuffer = [];
        updateStatusConsole();
        const directorPrompt = (directorPromptOverride !== null && directorPromptOverride !== undefined)
            ? String(directorPromptOverride)
            : (elements.directorMessage ? elements.directorMessage.value.trim() : '');
        const softFeedback = (softFeedbackOverride !== null && softFeedbackOverride !== undefined)
            ? String(softFeedbackOverride)
            : (elements.feedbackMessage ? elements.feedbackMessage.value.trim() : '');
        const response = await window.socket.emitReceive('generate-vn-turn', {
            prompt: message,
            directorPrompt,
            softFeedback,
            metadata: metadata && typeof metadata === 'object' ? metadata : {}
        }, 1800000);
        if (response && response.success) {
            if (elements.userMessage) elements.userMessage.value = '';
            if (elements.directorMessage) elements.directorMessage.value = '';
            if (elements.feedbackMessage) elements.feedbackMessage.value = '';
            applyVNResult(response.result);
            return true;
        } else {
            const errorMsg = response?.error || 'Unknown error';
            const wasCancelled = state.generationCancelRequested || /aborted|cancelled|canceled/i.test(errorMsg);
            Modals.show({
                title: wasCancelled ? 'Generation Cancelled' : 'Generation Failed',
                variant: wasCancelled ? 'default' : 'danger',
                className: wasCancelled ? '' : 'modal-variant-danger',
                content: `<p>${wasCancelled ? 'The current generation was cancelled.' : errorMsg}</p>`,
                buttons: [{ text: 'Close', class: wasCancelled ? '' : 'danger' }]
            });
            if (wasCancelled) handleStatusUpdate({ id: 'cancel_generation', type: 'clear' });
            setInputsEnabled(true); updateBlockingOverlay(); return false;
        }
    } catch (error) {
        debugError('Error during processMessage', error);
        Modals.show({ title: 'Unexpected Error', variant: 'danger', className: 'modal-variant-danger', content: `<p>${error.message}</p>`, buttons: [{ text: 'Dismiss', class: 'danger' }] });
        setInputsEnabled(true); updateBlockingOverlay(); return false;
    }
}

export function handleSystemLog(payload) {
    if (!state.isGenerationPhase) return;
    if (!state.logBuffer) state.logBuffer = [];
    state.logBuffer.push(payload);
    if (!runtime.logBatchTimeout) {
        runtime.logBatchTimeout = setTimeout(() => { updateStatusConsole(); runtime.logBatchTimeout = null; }, 100);
    }
}

export function updateStatusConsole() {
    const consoleEl = elements.statusConsole || document.getElementById('unified-status-console');
    if (!consoleEl) return;
    if (state.vnSettings.debug?.show_system_console && state.logBuffer?.length > 0) consoleEl.classList.remove('hidden');
    else { consoleEl.classList.add('hidden'); if (state.logBuffer?.length === 0) consoleEl.innerHTML = ''; return; }
    const previousScrollTop = consoleEl.scrollTop;
    const distanceFromBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight;
    const shouldFollowTail = distanceFromBottom <= 24;
    const fragment = document.createDocumentFragment();
    state.logBuffer.forEach(log => {
        const line = document.createElement('div'); line.className = 'system-log-line';
        const sectionClass = `section-${(log.section || 'unknown').toLowerCase()}`;
        const levelClass = log.level === 'error' ? 'system-log-level-error' : '';
        const extra = (log.extraArgs && log.extraArgs.length > 0) ? ` <span class="system-log-extra">${log.extraArgs.join(' ')}</span>` : '';
        line.innerHTML = `<span class="system-log-time">[${log.timestamp}]</span> <span class="system-log-section ${sectionClass}">[${log.section}]</span> <span class="system-log-message ${levelClass}">${log.subSection ? `[${log.subSection}] ` : ''}${log.startEnd === 'start' ? '>>> ' : ''}${log.message}${log.startEnd === 'end' ? ' <<<' : ''}</span>${extra}`;
        fragment.appendChild(line);
    });
    consoleEl.innerHTML = '';
    consoleEl.appendChild(fragment);
    consoleEl.scrollTop = shouldFollowTail ? consoleEl.scrollHeight : previousScrollTop;
}

export function toggleStatusConsole() {
    state.vnSettings.debug.show_system_console = !state.vnSettings.debug.show_system_console;
    applyVNSettings(); debouncedSaveVNSettings(window.socket); updateStatusConsole();
}
