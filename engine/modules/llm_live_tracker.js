/**
 * Live LLM call tracker.
 *
 * Emits lightweight `llm-update` socket events so the VN viewer can render a
 * live, auto-scrolling "road" of every active LLM call during a turn.
 *
 * This module is intentionally side-effect free apart from emitting: it never
 * mutates call behaviour and never throws into the LLM pipeline.
 */

const { emitEvent, Logger } = require('./utils');
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

// Per-call stream display state: accumulated tails plus a throttle timer so
// token deltas become a few socket events per second, never one per token.
const chunkBuffers = new Map();

function getStreamDisplayConfig() {
    try {
        const settings = require('./utils.js').readSettings?.() || {};
        return settings?.infrastructure?.llm_stream_display || {};
    } catch {
        return {};
    }
}

/**
 * Bounds a stream tail on three axes so a tooltip can never balloon: number of
 * lines, characters per line, and total characters. The newest text is always
 * at the end of the buffer, so trimming keeps the tail rather than the head.
 */
function tailText(text, { maxLines, maxLineChars, maxChars }) {
    const raw = String(text || '');
    if (!raw) return '';
    let lines = raw.split('\n');
    if (lines.length > maxLines) lines = lines.slice(-maxLines);
    lines = lines.map(line => (line.length > maxLineChars ? `…${line.slice(-maxLineChars)}` : line));
    let out = lines.join('\n');
    if (out.length > maxChars) out = `…${out.slice(-maxChars)}`;
    return out;
}

// Cap for the full streamed reasoning text kept per call for turn-log
// purposes. The tooltip tails stay small; this is the Inspector's copy.
const MAX_STREAMED_REASONING_CHARS = 200000;

function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Forward a token delta for a running call. Deltas accumulate in a per-call
 * buffer and are flushed as `type: 'chunk'` events at most every
 * `throttle_ms` (default 200ms), with a final flush when the call ends.
 * Never throws into the LLM pipeline.
 */
function chunk(callId, { content = '', reasoning = '' } = {}) {
    if (!callId || (!content && !reasoning)) return;
    const config = getStreamDisplayConfig();
    if (config.enabled === false) return;
    const tailLimits = {
        maxLines: positiveInt(config.tail_lines, 8),
        maxLineChars: positiveInt(config.tail_line_chars, 120),
        maxChars: positiveInt(config.tail_chars, 700)
    };
    const throttleMs = Number.isFinite(Number(config.throttle_ms)) && Number(config.throttle_ms) >= 0
        ? Number(config.throttle_ms)
        : 200;

    let buffer = chunkBuffers.get(callId);
    if (!buffer) {
        buffer = {
            output: '', reasoning: '', fullReasoning: '', chars: 0, tokens: 0,
            firstAt: Date.now(), lastAt: Date.now(), timer: null, tailLimits,
            reasoningTruncated: false
        };
        chunkBuffers.set(callId, buffer);
    }
    buffer.tailLimits = tailLimits;
    if (content) {
        buffer.output += content;
        buffer.chars += content.length;
        buffer.tokens += 1;
    }
    if (reasoning) {
        buffer.reasoning += reasoning;
        buffer.chars += reasoning.length;
        buffer.tokens += 1;
        // Full-fidelity copy for the turn log. LangChain's chat-completions
        // converter drops delta.reasoning_content, so the aggregated final
        // response carries no reasoning — this buffer is the only record.
        if (!buffer.reasoningTruncated) {
            const room = MAX_STREAMED_REASONING_CHARS - buffer.fullReasoning.length;
            if (room <= 0) {
                buffer.reasoningTruncated = true;
            } else if (reasoning.length > room) {
                buffer.fullReasoning += reasoning.slice(0, room);
                buffer.reasoningTruncated = true;
            } else {
                buffer.fullReasoning += reasoning;
            }
        }
    }
    buffer.lastAt = Date.now();
    if (!buffer.timer) {
        buffer.timer = setTimeout(() => flushChunkBuffer(callId), throttleMs);
        if (buffer.timer.unref) buffer.timer.unref();
    }
}

function buildChunkPayload(callId, buffer) {
    const elapsedSec = Math.max(0.001, (buffer.lastAt - buffer.firstAt) / 1000);
    return {
        type: 'chunk',
        callId,
        outputTail: tailText(buffer.output, buffer.tailLimits),
        reasoningTail: tailText(buffer.reasoning, buffer.tailLimits),
        streamChars: buffer.chars,
        streamTokens: buffer.tokens,
        streamFirstAt: buffer.firstAt,
        streamLastAt: buffer.lastAt,
        streamRate: buffer.tokens / elapsedSec
    };
}

function flushChunkBuffer(callId, final = false) {
    const buffer = chunkBuffers.get(callId);
    if (!buffer) return null;
    if (buffer.timer) {
        clearTimeout(buffer.timer);
        buffer.timer = null;
    }
    // The full streamed reasoning survives the final flush so end() can hand
    // it to the turn log; the tail buffers are display-only.
    const fullReasoning = buffer.fullReasoning || '';
    const reasoningTruncated = buffer.reasoningTruncated === true;
    if (final) chunkBuffers.delete(callId);
    if (!buffer.chars) {
        return fullReasoning
            ? { chars: 0, lastChunkAt: buffer.lastAt, streamedReasoning: fullReasoning, streamedReasoningTruncated: reasoningTruncated }
            : null;
    }
    const summary = {
        chars: buffer.chars, lastChunkAt: buffer.lastAt,
        streamedReasoning: fullReasoning || null,
        streamedReasoningTruncated: reasoningTruncated
    };
    safeEmit(buildChunkPayload(callId, buffer));
    if (!final) {
        buffer.timer = null;
    }
    return summary;
}

/**
 * Drop buffered stream state without emitting (retry attempts start fresh).
 */
function resetChunkBuffer(callId) {
    const buffer = chunkBuffers.get(callId);
    if (buffer?.timer) clearTimeout(buffer.timer);
    chunkBuffers.delete(callId);
}

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
    resetChunkBuffer(callId);
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
 * Read the accumulated streamed reasoning without ending the call. Used by
 * the LLM layer to recover reasoning the aggregated provider response omits
 * (LangChain's chat-completions converter drops delta.reasoning_content).
 */
function peekStreamedReasoning(callId) {
    const buffer = chunkBuffers.get(callId);
    const text = buffer?.fullReasoning;
    return typeof text === 'string' && text ? text : null;
}

/**
 * Mark the call finished (success, cached, or error). Returns the stream
 * summary (chars, last chunk time, and any accumulated streamed reasoning)
 * so the LLM layer can persist reasoning the provider response omits.
 */
function end(callId, { status = 'done', model, provider, cached = false, error = null, attempt } = {}) {
    if (!callId) return null;
    const buffer = chunkBuffers.get(callId);
    const summary = flushChunkBuffer(callId, true);
    if (summary) {
        // Turn-log evidence that token deltas actually reached the tracker.
        try {
            Logger.log(
                'LLM',
                'Stream',
                `Stream display: ${summary.chars} chars streamed for ${callId}${buffer ? ` over ${buffer.tokens} deltas` : ''}.`
            );
        } catch {
            // Diagnostics must never break narrative generation.
        }
    }
    safeEmit({
        type: status === 'error' ? 'error' : 'done',
        callId,
        status: status === 'error' ? 'error' : 'done',
        model: model || null,
        provider: provider || null,
        cached: cached === true,
        error: error ? String(error) : null,
        attempt: attempt || null,
        endTime: Date.now(),
        ...(summary ? { streamedChars: summary.chars, lastChunkAt: summary.lastChunkAt } : {})
    });
    return summary;
}

module.exports = {
    start,
    update,
    end,
    chunk,
    resetChunkBuffer,
    peekStreamedReasoning,
    PHASE_COLORS
};
