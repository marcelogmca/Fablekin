// engine/views/vn_viewer/js/modules/status_manager.js

import { state, runtime } from '../state.js';
import { elements } from '../elements.js';
import { formatElapsedTime } from '../utils.js';

export function updateEtaDisplay() {
    let etaEl = document.getElementById('eta-tracker-display');
    if (!state.etaData) { if (etaEl) etaEl.remove(); return; }
    if (!etaEl) {
        etaEl = document.createElement('div'); etaEl.id = 'eta-tracker-display'; etaEl.className = 'eta-tracker-display';
        etaEl.innerHTML = `<div class="eta-icon">📊</div><div class="eta-content"><div class="eta-message"></div><div class="eta-progress"><div class="eta-progress-bar"></div></div><div class="eta-subtasks"></div></div>`;
        const grouper = document.getElementById('status-notification-grouper');
        if (grouper?.parentNode) grouper.parentNode.insertBefore(etaEl, grouper.nextSibling);
        else { const container = document.getElementById('status-notification-container'); if (container) container.insertBefore(etaEl, container.firstChild); }
    }
    const messageEl = etaEl.querySelector('.eta-message');
    const progressEl = etaEl.querySelector('.eta-progress-bar');
    const subtasksEl = etaEl.querySelector('.eta-subtasks');
    if (messageEl && messageEl.innerHTML !== state.etaData.message) messageEl.innerHTML = state.etaData.message;
    if (progressEl) {
        if (state.etaData.progress !== undefined && state.etaData.progress !== null) {
            progressEl.style.width = `${state.etaData.progress}%`;
            if (state.etaData.color) progressEl.style.backgroundColor = state.etaData.color;
        } else progressEl.style.width = '0%';
    }
    if (subtasksEl && state.etaData.subtasks?.length > 0) {
        const elapsed = formatElapsedTime(Date.now() - state.etaData.startTime);
        const subtasksHtml = state.etaData.subtasks.map(s => `<div class="eta-subtask"><span class="eta-subtask-status">${getStatusIcon(s.status)}</span><span class="eta-subtask-name">${s.name}</span></div>`).join('');
        subtasksEl.innerHTML = `<div class="eta-elapsed">[${elapsed}]</div>` + subtasksHtml;
    } else { subtasksEl.innerHTML = ''; }
    if (state.etaData.color) etaEl.style.borderColor = state.etaData.color;
}

export function getStatusIcon(status) {
    const s = (status || '').toLowerCase();
    if (s === 'pending' || s === 'waiting') return '⏳';
    if (s === 'running' || s === 'active') return '⚡';
    if (s === 'complete' || s === 'done') return '✅';
    return '❓';
}

export function updateBlockingOverlay() {
    if (!elements.unifiedStatusPopup) return;
    if (!state.isGenerationPhase) {
        if (elements.unifiedStatusPopup.style.display !== 'none') {
            elements.unifiedStatusPopup.style.display = 'none';
        }
        // Always reset pipeline visuals between runs so a new generation
        // cannot reopen with stale completed state from the previous run.
        hidePipelineBar();
        stopTaskTicker();
        return;
    }
    const regularBlockingTasks = Array.from(state.notifications.values()).filter(n => n.blocking === true).sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const hasEtaBlocking = state.etaData && state.etaData.blocking;
    const totalBlocking = regularBlockingTasks.length + (hasEtaBlocking ? 1 : 0);

    if (totalBlocking > 0) {
        if (elements.unifiedStatusPopup.style.display !== 'flex') {
            elements.unifiedStatusPopup.style.display = 'flex';
            // Start each generation popup from a clean pipeline visual state.
            hidePipelineBar();
            runtime.statusStartTime = Date.now();
            if (elements.unifiedStatusElapsedTime) elements.unifiedStatusElapsedTime.textContent = formatElapsedTime(0);
            startTaskTicker();
            if (state.vnSettings.audio?.mute_audio_during_generation) {
                window.dispatchEvent(new CustomEvent('audio:mute-generation'));
                if (elements.audioPlayer && !elements.audioPlayer.paused) {
                    elements.audioPlayer.pause();
                    if (elements.musicPlayPauseBtn) elements.musicPlayPauseBtn.innerHTML = '<i>▶</i>';
                }
            }
        }

        const primary = regularBlockingTasks[0];
        if (elements.unifiedStatusPopupTitle) {
            if (primary) elements.unifiedStatusPopupTitle.textContent = primary.message || 'Processing...';
            else if (hasEtaBlocking && state.etaData.subtasks?.length > 0) elements.unifiedStatusPopupTitle.textContent = state.etaData.message || 'Work remaining...';
            else elements.unifiedStatusPopupTitle.textContent = 'Processing...';
        }

        if (elements.unifiedStatusTaskList) {
            const currentItemIds = new Set();
            regularBlockingTasks.forEach((task) => {
                const id = `task-${task.id}`;
                currentItemIds.add(id);
                const elapsedMs = task.startTime ? Date.now() - task.startTime : 0;
                let taskEl = elements.unifiedStatusTaskList.querySelector(`[data-task-id="${id}"]`);
                if (!taskEl) {
                    taskEl = document.createElement('div'); taskEl.setAttribute('data-task-id', id); taskEl.className = 'blocking-task-item';
                    taskEl.innerHTML = `<div class="blocking-task-message"><span class="blocking-task-icon"></span><span class="blocking-task-text"></span></div><div class="blocking-task-time"></div>`;
                    elements.unifiedStatusTaskList.appendChild(taskEl);
                }
                const iconEl = taskEl.querySelector('.blocking-task-icon');
                const textEl = taskEl.querySelector('.blocking-task-text');
                const timeEl = taskEl.querySelector('.blocking-task-time');
                iconEl.textContent = task.icon || '⚙️';
                textEl.textContent = task.message;
                timeEl.textContent = `[${formatElapsedTime(elapsedMs)}]`;
                taskEl.classList.toggle('primary', task === primary);
                taskEl.classList.toggle('slow-warning', elapsedMs > 90000);
            });

            if (state.etaData?.subtasks?.length > 0) {
                state.etaData.subtasks.forEach((subtask, index) => {
                    const id = `eta-sub-${index}`; currentItemIds.add(id);
                    let subtaskEl = elements.unifiedStatusTaskList.querySelector(`[data-task-id="${id}"]`);
                    if (!subtaskEl) {
                        subtaskEl = document.createElement('div'); subtaskEl.setAttribute('data-task-id', id); subtaskEl.className = 'blocking-task-item subtask';
                        subtaskEl.innerHTML = `<div class="blocking-task-message"><span class="blocking-task-icon"></span><span class="blocking-task-text"></span></div><div class="blocking-task-status"></div>`;
                        elements.unifiedStatusTaskList.appendChild(subtaskEl);
                    }
                    subtaskEl.querySelector('.blocking-task-icon').textContent = getStatusIcon(subtask.status);
                    subtaskEl.querySelector('.blocking-task-text').textContent = subtask.name;
                    subtaskEl.querySelector('.blocking-task-status').textContent = subtask.status;
                    subtaskEl.classList.toggle('active', (subtask.status || '').toLowerCase() === 'running');
                });
            }
            Array.from(elements.unifiedStatusTaskList.children).forEach(child => { if (!currentItemIds.has(child.getAttribute('data-task-id'))) child.remove(); });
        }
    } else if (elements.unifiedStatusPopup.style.display !== 'none') {
        elements.unifiedStatusPopup.style.display = 'none';
        stopTaskTicker();
        state.logBuffer = [];
        window.dispatchEvent(new CustomEvent('system:update-status-console'));
    }
}

export function handleStatusUpdate(payload) {
    const { id, type, message, progress, color, icon, timeout, blocking, priority, startTime, promotionDelayMs } = payload;
    if (type === 'pipeline-status' && payload.pipeline) {
        // Ignore late pipeline events from a finished/cancelled run.
        if (!state.isGenerationPhase) return;
        const data = payload.pipeline;
        if (data.manifest) initPipelineBar(data.manifest, data.phaseColors);
        if (data.hookName) updatePipelineProgress(data.hookName);
        return;
    }
    if (id === 'eta-tracker') {
        if (type === 'clear') state.etaData = null;
        else state.etaData = { message, progress, color, icon, blocking: (blocking === true || blocking === 'true'), priority: priority || 5, startTime: startTime || Date.now(), subtasks: payload.subtasks || [] };
        updateEtaDisplay(); updateBlockingOverlay(); return;
    }
    const container = document.getElementById('status-notification-container');
    const notificationStack = document.getElementById('status-notification-stack') || container;
    const grouper = elements.statusNotificationGrouper;
    const countEl = elements.statusNotificationCount;
    if (!container || !grouper) return;
    const resolvePromotionDelayMs = (rawValue, fallbackMs) => {
        if (rawValue === null || rawValue === false) return null;
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) return fallbackMs;
        return Math.max(0, parsed);
    };
    const schedulePromotion = (data, delayMs) => {
        if (!data || !data.element) return;
        if (data.promotionTimer) clearTimeout(data.promotionTimer);
        data.promotionTimer = null;
        data.promotionDelayMs = delayMs;
        if (delayMs === null) return;
        data.promotionTimer = setTimeout(() => data.element.classList.add('is-background'), delayMs);
    };
    const updateGrouper = () => {
        const count = state.notifications.size;
        if (count > 0) {
            grouper.classList.remove('hidden'); countEl.textContent = `${count} Notification${count > 1 ? 's' : ''}`;
        } else {
            grouper.classList.add('hidden'); container.classList.remove('expanded'); grouper.classList.remove('active'); state.notificationsExpanded = false;
        }
    };
    let notifData = state.notifications.get(id);
    if (type === 'clear') {
        if (notifData) {
            if (notifData.promotionTimer) clearTimeout(notifData.promotionTimer);
            if (notifData.timeoutTimer) clearTimeout(notifData.timeoutTimer);
            notifData.element.classList.add('removing');
            setTimeout(() => { if (state.notifications.has(id)) { notifData.element.remove(); state.notifications.delete(id); updateGrouper(); updateBlockingOverlay(); } }, 300);
        }
        return;
    }
    if (!notifData) {
        const element = document.createElement('div'); element.id = `status-notif-${id}`; element.className = 'status-notification';
        if (payload.variant === 'error') element.classList.add('error-notification');
        element.innerHTML = `<div class="status-notification-header"><div class="status-notification-icon"></div><div class="status-notification-message"></div></div><div class="status-notification-details hidden"></div><div class="status-notification-progress-bg hidden"><div class="status-notification-progress-fill"></div></div>`;
        notificationStack.appendChild(element);
        const defaultPromotionDelayMs = payload.variant === 'error' ? 15000 : 3000;
        const initialPromotionDelayMs = resolvePromotionDelayMs(promotionDelayMs, defaultPromotionDelayMs);
        notifData = { id, element, blocking: (blocking === true || blocking === 'true'), priority: priority || 0, startTime: startTime || Date.now(), promotionTimer: null, promotionDelayMs: initialPromotionDelayMs };
        schedulePromotion(notifData, initialPromotionDelayMs);
        state.notifications.set(id, notifData);
    }
    if (message) notifData.message = message;
    if (blocking !== undefined) notifData.blocking = (blocking === true || blocking === 'true');
    if (priority !== undefined) notifData.priority = priority;
    if (startTime !== undefined) notifData.startTime = startTime;
    if (icon !== undefined) notifData.icon = icon;
    if (promotionDelayMs !== undefined) {
        const defaultPromotionDelayMs = payload.variant === 'error' ? 15000 : (notifData.promotionDelayMs ?? 3000);
        const nextPromotionDelayMs = resolvePromotionDelayMs(promotionDelayMs, defaultPromotionDelayMs);
        notifData.element.classList.remove('is-background');
        schedulePromotion(notifData, nextPromotionDelayMs);
    }
    const iconEl = notifData.element.querySelector('.status-notification-icon');
    const messageEl = notifData.element.querySelector('.status-notification-message');
    const detailsEl = notifData.element.querySelector('.status-notification-details');
    if (iconEl && icon) iconEl.textContent = icon;
    if (message) messageEl.innerHTML = message;
    if (detailsEl) { if (payload.details) { detailsEl.textContent = payload.details; detailsEl.classList.remove('hidden'); } else detailsEl.classList.add('hidden'); }
    if (color) notifData.element.style.borderColor = color;
    const progressBg = notifData.element.querySelector('.status-notification-progress-bg');
    const progressFill = notifData.element.querySelector('.status-notification-progress-fill');
    if (progress !== undefined && progress !== null) {
        progressBg.classList.remove('hidden'); progressFill.style.width = `${progress}%`; if (color) progressFill.style.backgroundColor = color;
    } else progressBg.classList.add('hidden');
    updateGrouper(); updateBlockingOverlay();
    if (timeout) {
        if (notifData.timeoutTimer) clearTimeout(notifData.timeoutTimer);
        notifData.timeoutTimer = setTimeout(() => { handleStatusUpdate({ id: id, type: 'clear' }); }, timeout);
    }
}

export function startTaskTicker() {
    if (runtime.statusTimerInterval) clearInterval(runtime.statusTimerInterval);
    runtime.statusTimerInterval = setInterval(() => {
        if (runtime.statusStartTime && elements.unifiedStatusElapsedTime) elements.unifiedStatusElapsedTime.textContent = formatElapsedTime(Date.now() - runtime.statusStartTime);
        updateBlockingOverlay();
        if (state.etaData) updateEtaDisplay();
    }, 1000);
}

export function stopTaskTicker() {
    if (runtime.statusTimerInterval) { clearInterval(runtime.statusTimerInterval); runtime.statusTimerInterval = null; }
}

export function initPipelineBar(manifest, phaseColors) {
    if (!elements.pipelinePhasesContainer || !manifest || manifest.length === 0) return;
    state.pipelineManifest = manifest;
    state.pipelinePhaseColors = phaseColors || {};
    const phases = [];
    const phaseMap = new Map();
    for (const hook of manifest) {
        if (!phaseMap.has(hook.phase)) {
            const phaseData = { name: hook.phase, hooks: [], totalWeight: 0 };
            phaseMap.set(hook.phase, phaseData); phases.push(phaseData);
        }
        const pd = phaseMap.get(hook.phase);
        pd.hooks.push(hook); pd.totalWeight += hook.weight;
    }
    const totalWeight = manifest.reduce((sum, h) => sum + h.weight, 0);
    if (totalWeight === 0) return;
    elements.pipelinePhasesContainer.innerHTML = '';
    for (const phase of phases) {
        const widthPct = (phase.totalWeight / totalWeight) * 100;
        const phaseColor = state.pipelinePhaseColors[phase.name] || '#888';
        const phaseEl = document.createElement('div');
        phaseEl.className = 'pipeline-phase'; phaseEl.setAttribute('data-phase', phase.name); phaseEl.style.width = `${widthPct}%`;
        const fillEl = document.createElement('div');
        fillEl.className = 'pipeline-phase-fill'; fillEl.style.backgroundColor = phaseColor; phaseEl.appendChild(fillEl);
        phaseEl.title = `Phase: ${phase.name}\n${phase.hooks.map((h, i) => `${i + 1}. ${h.name} (${h.hookName})`).join('\n')}`;
        if (widthPct > 8) {
            const labelEl = document.createElement('div'); labelEl.className = 'pipeline-phase-label'; labelEl.textContent = phase.name; phaseEl.appendChild(labelEl);
        }
        elements.pipelinePhasesContainer.appendChild(phaseEl);
    }
    elements.pipelineProgressBar.classList.remove('hidden');
    const popupContent = document.getElementById('unified-status-popup-content');
    if (popupContent) popupContent.classList.add('has-pipeline');
    state.pipelineCurrentHookIndex = -1;
    if (elements.pipelineCursor) elements.pipelineCursor.style.left = '0%';
    if (elements.pipelineLabelIcon) elements.pipelineLabelIcon.textContent = '';
    if (elements.pipelineLabelName) elements.pipelineLabelName.textContent = 'Initializing...';
}

export function updatePipelineProgress(hookName) {
    if (!state.pipelineManifest || !elements.pipelinePhasesContainer) return;
    const manifest = state.pipelineManifest;
    const totalWeight = manifest.reduce((sum, h) => sum + h.weight, 0);
    if (totalWeight === 0) return;
    const hookIdx = manifest.findIndex(h => h.hookName === hookName);
    if (hookIdx === -1) return;
    if (hookIdx < state.pipelineCurrentHookIndex) return;
    state.pipelineCurrentHookIndex = hookIdx;
    const currentHook = manifest[hookIdx];
    let completedWeight = 0;
    for (let i = 0; i < hookIdx; i++) completedWeight += manifest[i].weight;
    const cursorPct = ((completedWeight + (currentHook.weight / 2)) / totalWeight) * 100;
    const currentPhase = currentHook.phase;
    const phaseEls = elements.pipelinePhasesContainer.querySelectorAll('.pipeline-phase');
    let passedCurrentPhase = false;
    const phaseHooks = manifest.filter(h => h.phase === currentPhase);
    const phaseHookIdx = phaseHooks.findIndex(h => h.hookName === hookName);
    const phaseWeight = phaseHooks.reduce((sum, h) => sum + h.weight, 0);
    let phaseCompletedWeight = 0;
    for (let i = 0; i < phaseHookIdx; i++) phaseCompletedWeight += phaseHooks[i].weight;
    const phaseFillPct = phaseWeight > 0 ? ((phaseCompletedWeight + (currentHook.weight / 2)) / phaseWeight) * 100 : 0;
    phaseEls.forEach(el => {
        const phaseName = el.getAttribute('data-phase');
        const fillEl = el.querySelector('.pipeline-phase-fill');
        if (!fillEl) return;
        if (phaseName === currentPhase) {
            el.classList.add('active'); el.classList.remove('completed'); fillEl.style.width = `${phaseFillPct}%`; passedCurrentPhase = true;
        } else if (!passedCurrentPhase) {
            el.classList.add('completed'); el.classList.remove('active');
        } else {
            el.classList.remove('completed', 'active'); fillEl.style.width = '0%';
        }
    });
    if (elements.pipelineCursor) elements.pipelineCursor.style.left = `${cursorPct}%`;
    if (elements.pipelineLabelIcon) elements.pipelineLabelIcon.textContent = currentHook.icon;
    if (elements.pipelineLabelName) elements.pipelineLabelName.innerHTML = `${currentHook.name} <span class="pipeline-hook-id">${currentHook.hookName}</span>`;
}

export function hidePipelineBar() {
    if (elements.pipelineProgressBar) elements.pipelineProgressBar.classList.add('hidden');
    const popupContent = document.getElementById('unified-status-popup-content');
    if (popupContent) popupContent.classList.remove('has-pipeline');
    if (elements.pipelinePhasesContainer) elements.pipelinePhasesContainer.innerHTML = '';
    if (elements.pipelineCursor) elements.pipelineCursor.style.left = '0%';
    if (elements.pipelineLabelIcon) elements.pipelineLabelIcon.textContent = '';
    if (elements.pipelineLabelName) elements.pipelineLabelName.textContent = 'Initializing...';
    state.pipelineManifest = null;
    state.pipelinePhaseColors = null;
    state.pipelineCurrentHookIndex = -1;
}
