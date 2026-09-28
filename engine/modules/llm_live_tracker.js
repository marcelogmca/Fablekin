/**
 * Live LLM call tracker.
 *
 * Emits lightweight `llm-update` socket events so the VN viewer can render a
 * live, auto-scrolling "road" of every active LLM call during a turn.
 *
 * This module is intentionally side-effect free apart from emitting: it never
 * mutates call behaviour and never throws into the LLM pipeline.
 */

const { emitEvent } = require('./utils');
const { getDiagnosticContext } = require('./diagnostic_context.js');
const cancellation = require('./pipeline_cancellation.js');

// Mirrors the pipeline phase palette (hook_executor PHASE_COLORS) plus the
// diagnostic-context phase names used by the core VN pipeline.
const PHASE_COLORS = {
    'Turn': '#4ecdc4',
    'Turn Start': '#4ecdc4',
    'Narrative': '#3498db',
    'Prompt': '#9b59b6',
    'Director': '#f39c12',
    'Writer': '#e74c3c',
    'VN': '#2ecc71',
    'VN Pipeline': '#2ecc71',
    'VN Transformation': '#2ecc71',
    'Persistence': '#95a5a6',
    'Plugin LLM': '#00bcd4'
};

const PHASE_ICONS = {
    'Turn': '▶️',
    'Turn Start': '▶️',
    'Narrative': '📖',
    'Prompt': '🏗️',
    'Director': '🧠',
    'Writer': '🖋️',
    'VN': '🎬',
    'VN Pipeline': '🎬',
    'VN Transformation': '🎬',
    'Persistence': '💾',
    'Plugin LLM': '🔌'
};

const FALLBACK_PALETTE = ['#4ecdc4', '#3498db', '#9b59b6', '#f39c12', '#e74c3c', '#2ecc71', '#00bcd4', '#e67e22'];

let callSeq = 0;

function hashColor(seed) {
    const text = String(seed || 'llm');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

function resolvePhase(diagnostics, title) {
    const phase = diagnostics?.phase || diagnostics?.hookName || null;
    if (phase) return phase;
    return String(title || '').trim() || 'LLM';
}

function resolveColor(phase) {
    if (PHASE_COLORS[phase]) return PHASE_COLORS[phase];
    const lower = String(phase || '').toLowerCase();
    for (const [key, value] of Object.entries(PHASE_COLORS)) {
        if (lower.includes(key.toLowerCase())) return value;
    }
    return hashColor(phase);
}

function resolveIcon(phase) {
    if (PHASE_ICONS[phase]) return PHASE_ICONS[phase];
    const lower = String(phase || '').toLowerCase();
    for (const [key, value] of Object.entries(PHASE_ICONS)) {
        if (lower.includes(key.toLowerCase())) return value;
    }
    return '⚡';
}

function currentRunId() {
    try {
        return cancellation.getCurrentContext()?.runId || null;
    } catch {
        return null;
    }
}

/**
 * Emit an event, never throwing into the caller.
 */
function safeEmit(payload) {
    try {
        emitEvent('llm-update', payload);
    } catch {
        // Diagnostics must never break narrative generation.
    }
}

/**
 * Register the start of a logical LLM call (spanning all retry attempts).
 * @returns {string} A stable callId for this call.
 */
function start({ title, callingModule, model, provider, maxAttempts } = {}) {
    callSeq += 1;
    const callId = `llm_live_${Date.now()}_${callSeq}`;
    const diagnostics = getDiagnosticContext() || {};
    const phase = resolvePhase(diagnostics, title);
    const startTime = Date.now();

    safeEmit({
        type: 'start',
        callId,
        runId: currentRunId(),
        status: 'running',
        title: title || callingModule || 'LLM',
        callingModule: callingModule || null,
        model: model || null,
        provider: provider || null,
        attempt: 1,
        maxAttempts: maxAttempts || 1,
        phase,
        hookName: diagnostics.hookName || null,
        pluginId: diagnostics.pluginId || null,
        blocking: diagnostics.blocking !== false,
        color: resolveColor(phase),
        icon: resolveIcon(phase),
        startTime,
        endTime: null
    });

    return callId;
}

/**
 * Report an in-flight status change (retry / fallback) without ending the call.
 */
function update(callId, { status = 'retrying', attempt, model, provider, message } = {}) {
    if (!callId) return;
    safeEmit({
        type: 'retry',
        callId,
        status,
        attempt: attempt || null,
        model: model || null,
        provider: provider || null,
        message: message || null
    });
}

/**
 * Mark the call finished (success, cached, or error).
 */
function end(callId, { status = 'done', model, provider, cached = false, error = null, attempt } = {}) {
    if (!callId) return;
    safeEmit({
        type: status === 'error' ? 'error' : 'done',
        callId,
        status: status === 'error' ? 'error' : 'done',
        model: model || null,
        provider: provider || null,
        cached: cached === true,
        error: error ? String(error) : null,
        attempt: attempt || null,
        endTime: Date.now()
    });
}

module.exports = {
    start,
    update,
    end,
    PHASE_COLORS
};
