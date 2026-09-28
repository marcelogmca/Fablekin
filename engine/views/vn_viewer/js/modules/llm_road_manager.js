// engine/views/vn_viewer/js/modules/llm_road_manager.js
//
// Live LLM "road": a Gantt-style timeline of every LLM call in the active turn.
// Time flows left -> right with "now" pinned at the right edge; finished calls
// dim and drift left as the road moves. One lane per logical call.

import { state, runtime } from '../state.js';
import { elements } from '../elements.js';
import { formatElapsedTime } from '../utils.js';

const PX_PER_SEC = 6;
const GUTTER_PX = 156;
const RIGHT_PAD_PX = 44;
const ROAD_TICK_MS = 250;
const SLOW_THRESHOLD_MS = 90000;
const MAX_LANES = 90;

const laneEls = new Map();
let listenersBound = false;

function roadAvailable() {
    return !!(elements.llmRoad && elements.llmRoadScroll && elements.llmRoadLanes && elements.llmRoadGrid);
}

function isRunning(call) {
    return call.status === 'running' || call.status === 'retrying';
}

function nowMs() {
    if (state.llmRoadFrozen && state.llmRoadFrozenAt) return state.llmRoadFrozenAt;
    return Date.now();
}

function ensureRunStart(startTime) {
    if (!state.llmRunStartTime || startTime < state.llmRunStartTime) {
        state.llmRunStartTime = startTime;
    }
}

function updateFollowButton() {
    const btn = elements.llmRoadFollow;
    if (!btn) return;
    btn.textContent = state.llmFollowMode ? 'Follow: ON' : 'Follow: OFF';
    btn.classList.toggle('is-off', !state.llmFollowMode);
}

function setFollowMode(enabled) {
    if (state.llmFollowMode === enabled) return;
    state.llmFollowMode = enabled;
    updateFollowButton();
    if (enabled) renderLlmRoad();
}

function statusChip(call) {
    if (call.status === 'error') return '✖';
    if (call.status === 'retrying') return `↻${call.attempt || 2}`;
    if (isRunning(call)) return 'running';
    if (call.cached) return '⚡cache';
    return '✅';
}

function timeText(call, elapsedMs, slow) {
    if (call.status === 'error') return '✖ failed';
    if (call.cached) return `⚡ cache`;
    if (isRunning(call)) return `[${formatElapsedTime(elapsedMs)}]${slow ? ' ⚠️' : ''}`;
    return `✅ ${formatElapsedTime(elapsedMs)}`;
}

export function initLlmRoad() {
    if (listenersBound) return;
    listenersBound = true;

    const btn = elements.llmRoadFollow;
    if (btn) btn.addEventListener('click', () => setFollowMode(!state.llmFollowMode));

    const scroll = elements.llmRoadScroll;
    if (scroll) {
        // Auto-follow pauses only when the user moves the road horizontally.
        // Vertical scrolling (browsing lanes) and plain clicks do not stop it.
        scroll.addEventListener('scroll', () => {
            if (!state.llmFollowMode) return;
            const drift = Math.abs(scroll.scrollLeft - (runtime.llmRoadLastAutoScrollLeft || 0));
            if (drift > 2) setFollowMode(false);
        }, { passive: true });
    }

    if (!runtime.llmRoadResizeHandler) {
        runtime.llmRoadResizeHandler = () => {
            if (state.llmCalls.size > 0) renderLlmRoad();
        };
        window.addEventListener('resize', runtime.llmRoadResizeHandler);
    }

    updateFollowButton();
}

export function clearLlmRoad() {
    state.llmCalls.clear();
    state.llmRunId = null;
    state.llmRunStartTime = null;
    state.llmRoadFrozen = false;
    state.llmRoadFrozenAt = null;
    state.llmSequence = 0;
    state.llmFollowMode = true;
    laneEls.clear();

    if (elements.llmRoadLanes) elements.llmRoadLanes.innerHTML = '';
    if (elements.llmRoadGrid) elements.llmRoadGrid.style.width = '100%';
    if (elements.llmRoadScroll) {
        runtime.llmRoadLastAutoScrollLeft = 0;
        elements.llmRoadScroll.scrollLeft = 0;
        elements.llmRoadScroll.scrollTop = 0;
    }
    if (elements.llmRoadEmpty) elements.llmRoadEmpty.classList.remove('hidden');

    stopLlmRoadTicker();
    updateFollowButton();
}

export function freezeLlmRoad() {
    state.llmRoadFrozen = true;
    state.llmRoadFrozenAt = Date.now();
    stopLlmRoadTicker();
    renderLlmRoad();
}

export function handleLlmUpdate(payload) {
    if (!payload || !payload.callId) return;
    const { callId, type } = payload;

    if (type === 'start') {
        // Only live calls that begin during the active generation phase belong
        // to the road. Late background calls after phase-end are ignored.
        if (!state.isGenerationPhase) return;

        const startTime = Number(payload.startTime) || Date.now();
        ensureRunStart(startTime);
        state.llmRunId = payload.runId || state.llmRunId;
        state.llmSequence += 1;

        const call = {
            callId,
            title: payload.title || payload.callingModule || 'LLM',
            callingModule: payload.callingModule || null,
            model: payload.model || null,
            provider: payload.provider || null,
            phase: payload.phase || null,
            hookName: payload.hookName || null,
            pluginId: payload.pluginId || null,
            blocking: payload.blocking !== false,
            color: payload.color || '#4ecdc4',
            icon: payload.icon || '⚡',
            startTime,
            endTime: null,
            status: 'running',
            cached: false,
            error: null,
            attempt: payload.attempt || 1,
            maxAttempts: payload.maxAttempts || 1,
            retryMessage: null,
            seq: state.llmSequence
        };

        state.llmCalls.set(callId, call);
        createLane(call);
        pruneLanes();
        if (elements.llmRoadEmpty) elements.llmRoadEmpty.classList.add('hidden');
        startLlmRoadTicker();
        if (state.llmFollowMode && !state.llmRoadFrozen) scrollRoadToBottom();
        renderLlmRoad();
        return;
    }

    const call = state.llmCalls.get(callId);
    if (!call) return; // Unknown / stale run — its start was never accepted.

    if (type === 'retry') {
        call.status = 'retrying';
        if (payload.attempt) call.attempt = payload.attempt;
        if (payload.model) call.model = payload.model;
        if (payload.provider) call.provider = payload.provider;
        call.retryMessage = payload.message || null;
        renderLlmRoad();
        return;
    }

    call.status = payload.status === 'error' ? 'error' : 'done';
    call.endTime = Number(payload.endTime) || Date.now();
    call.cached = payload.cached === true;
    call.error = payload.error || null;
    if (payload.model) call.model = payload.model;
    if (payload.provider) call.provider = payload.provider;
    renderLlmRoad();
}

function createLane(call) {
    if (!roadAvailable()) return;

    const row = document.createElement('div');
    row.className = 'llm-lane';
    row.setAttribute('data-call-id', call.callId);

    const label = document.createElement('div');
    label.className = 'llm-lane-label';

    const iconEl = document.createElement('span');
    iconEl.className = 'llm-lane-icon';
    iconEl.textContent = call.icon;

    const titleEl = document.createElement('span');
    titleEl.className = 'llm-lane-title';
    titleEl.textContent = call.title;

    const statusEl = document.createElement('span');
    statusEl.className = 'llm-lane-status';

    label.appendChild(iconEl);
    label.appendChild(titleEl);
    label.appendChild(statusEl);

    const plot = document.createElement('div');
    plot.className = 'llm-lane-plot';

    const bar = document.createElement('div');
    bar.className = 'llm-lane-bar';

    const barTitle = document.createElement('span');
    barTitle.className = 'llm-lane-bar-title';
    barTitle.textContent = call.title;
    bar.appendChild(barTitle);

    const time = document.createElement('span');
    time.className = 'llm-lane-time';

    plot.appendChild(bar);
    plot.appendChild(time);

    row.appendChild(label);
    row.appendChild(plot);
    elements.llmRoadLanes.appendChild(row);

    laneEls.set(call.callId, { row, bar, time, statusEl });
}

function removeLane(callId) {
    const refs = laneEls.get(callId);
    if (refs?.row?.parentNode) refs.row.parentNode.removeChild(refs.row);
    laneEls.delete(callId);
}

function pruneLanes() {
    if (state.llmCalls.size <= MAX_LANES) return;
    const finished = Array.from(state.llmCalls.values())
        .filter(call => !isRunning(call))
        .sort((a, b) => a.seq - b.seq);
    while (state.llmCalls.size > MAX_LANES && finished.length > 0) {
        const victim = finished.shift();
        removeLane(victim.callId);
        state.llmCalls.delete(victim.callId);
    }
}

export function renderLlmRoad() {
    if (!roadAvailable()) return;
    // With no lanes yet the grid must still fill the scroll box; otherwise the
    // absolutely-positioned "waiting" placeholder gets clipped to ~1 line.
    if (state.llmCalls.size === 0) {
        if (elements.llmRoadGrid) elements.llmRoadGrid.style.width = '100%';
        return;
    }

    const now = nowMs();
    const runStart = state.llmRunStartTime || now;
    const elapsedSec = Math.max(0, (now - runStart) / 1000);

    const containerWidth = elements.llmRoadScroll.clientWidth || 0;
    const minPlot = Math.max(containerWidth - GUTTER_PX, 240);
    const plotWidth = Math.max(elapsedSec * PX_PER_SEC + RIGHT_PAD_PX, minPlot);
    const totalWidth = GUTTER_PX + plotWidth;
    elements.llmRoadGrid.style.width = `${totalWidth}px`;

    if (elements.llmRoadNow) {
        elements.llmRoadNow.style.left = `${GUTTER_PX + elapsedSec * PX_PER_SEC}px`;
    }

    for (const call of state.llmCalls.values()) {
        const refs = laneEls.get(call.callId);
        if (!refs) continue;

        const end = isRunning(call) ? now : (call.endTime || now);
        const leftPx = Math.max(0, ((call.startTime - runStart) / 1000) * PX_PER_SEC);
        const widthPx = Math.max(4, ((end - call.startTime) / 1000) * PX_PER_SEC);
        const elapsedMs = Math.max(0, end - call.startTime);
        const slow = isRunning(call) && elapsedMs > SLOW_THRESHOLD_MS;

        refs.bar.style.left = `${leftPx}px`;
        refs.bar.style.width = `${widthPx}px`;
        refs.bar.style.backgroundColor = call.color;
        refs.time.style.left = `${leftPx + widthPx + 6}px`;

        refs.row.classList.toggle('is-running', isRunning(call));
        refs.row.classList.toggle('is-done', call.status === 'done');
        refs.row.classList.toggle('is-error', call.status === 'error');
        refs.row.classList.toggle('is-cached', call.cached === true);
        refs.row.classList.toggle('is-retrying', call.status === 'retrying');
        refs.row.classList.toggle('is-slow', slow);

        refs.statusEl.textContent = statusChip(call);
        refs.time.textContent = timeText(call, elapsedMs, slow);
        // Use the themed tooltip channel only (no native `title` attribute, so
        // the browser's own tooltip never appears alongside ours).
        refs.row.dataset.originalTitle = buildTooltip(call, elapsedMs);
    }

    applyAutoScroll(totalWidth);
}

function buildTooltip(call, elapsedMs) {
    const parts = [call.title];
    if (call.model) parts.push(`${call.provider || 'provider'}/${call.model}`);
    parts.push(`attempt ${call.attempt || 1}/${call.maxAttempts || 1}`);
    if (call.hookName) parts.push(call.hookName);
    if (call.pluginId) parts.push(`plugin: ${call.pluginId}`);
    parts.push(`elapsed ${formatElapsedTime(elapsedMs)}`);
    if (call.retryMessage) parts.push(call.retryMessage);
    if (call.error) parts.push(`error: ${call.error}`);
    return parts.join('\n');
}

function applyAutoScroll(totalWidth) {
    if (!state.llmFollowMode || state.llmRoadFrozen) return;
    const scroll = elements.llmRoadScroll;
    if (!scroll) return;
    // Horizontal only: the road follows "now" left-to-right. Vertical position
    // is user-controlled and only nudged down when a new lane appears.
    scroll.scrollLeft = Math.max(0, totalWidth - scroll.clientWidth);
    runtime.llmRoadLastAutoScrollLeft = scroll.scrollLeft;
}

function scrollRoadToBottom() {
    const scroll = elements.llmRoadScroll;
    if (!scroll) return;
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
}

export function startLlmRoadTicker() {
    if (runtime.llmRoadTickerInterval) return;
    runtime.llmRoadTickerInterval = setInterval(renderLlmRoad, ROAD_TICK_MS);
}

export function stopLlmRoadTicker() {
    if (runtime.llmRoadTickerInterval) {
        clearInterval(runtime.llmRoadTickerInterval);
        runtime.llmRoadTickerInterval = null;
    }
}
