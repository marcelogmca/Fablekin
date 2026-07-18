const { AsyncLocalStorage } = require('async_hooks');
const { PipelineAbortError } = require('./plugin_manager/runtime/errors.js');

const storage = new AsyncLocalStorage();
const activeRuns = new Map();
let llmCallSeq = 0;

function createAbortController() {
    return typeof globalThis.AbortController === 'function'
        ? new globalThis.AbortController()
        : null;
}

function createRunContext(runId, metadata = {}) {
    const controller = createAbortController();
    return {
        runId,
        metadata,
        controller,
        cancelled: false,
        reason: null,
        llmCalls: new Map()
    };
}

function registerRun(context) {
    if (!context?.runId) return;
    activeRuns.set(context.runId, context);
}

function unregisterRun(runId) {
    const context = activeRuns.get(runId);
    if (context) {
        context.llmCalls.clear();
    }
    activeRuns.delete(runId);
}

function runWithContext(context, fn) {
    return storage.run(context, fn);
}

function getCurrentContext() {
    return storage.getStore() || null;
}

function getActiveRuns() {
    return Array.from(activeRuns.values()).map(context => ({
        runId: context.runId,
        mode: context.metadata?.mode || null,
        profileId: context.metadata?.profileId || null,
        stage: context.metadata?.stage || null,
        startedAt: context.metadata?.startedAt || null,
        cancelled: context.cancelled === true,
        reason: context.reason || null,
        activeLlmCalls: context.llmCalls.size
    }));
}

function getContextForRun(runId) {
    if (runId) return activeRuns.get(runId) || null;
    const contexts = Array.from(activeRuns.values());
    return contexts.length === 1 ? contexts[0] : null;
}

function cancelContext(context, reason = 'cancelled') {
    if (!context || context.cancelled) return false;

    context.cancelled = true;
    context.reason = reason;

    if (context.controller && !context.controller.signal.aborted) {
        context.controller.abort(reason);
    }

    for (const [, call] of context.llmCalls) {
        if (call.controller && !call.controller.signal.aborted) {
            call.controller.abort(reason);
        }
    }

    return true;
}

function cancelRun(runId = null, reason = 'cancelled') {
    const targets = runId
        ? [activeRuns.get(runId)].filter(Boolean)
        : Array.from(activeRuns.values());

    const cancelledRunIds = [];
    for (const context of targets) {
        if (cancelContext(context, reason)) {
            cancelledRunIds.push(context.runId);
        }
    }

    return {
        success: cancelledRunIds.length > 0,
        cancelledRunIds,
        activeRunCount: activeRuns.size
    };
}

function isCancelled(context = getCurrentContext()) {
    return !!(context && (context.cancelled || context.controller?.signal?.aborted));
}

function throwIfCancelled(contextOrStage = null, maybeStage = null) {
    const hasContextArg = contextOrStage && typeof contextOrStage === 'object' && Object.prototype.hasOwnProperty.call(contextOrStage, 'runId');
    const context = hasContextArg ? contextOrStage : getCurrentContext();
    const stage = hasContextArg ? maybeStage : contextOrStage;

    if (!isCancelled(context)) return;

    const reason = context?.reason || context?.controller?.signal?.reason || 'cancelled';
    const suffix = stage ? ` during ${stage}` : '';
    throw new PipelineAbortError(`Generation cancelled${suffix}: ${reason}`, 'user_cancel');
}

function registerLlmCall(metadata = {}) {
    const context = getCurrentContext();
    if (!context?.runId) {
        return {
            runId: null,
            callId: null,
            signal: null,
            done: () => {},
            throwIfCancelled: () => {}
        };
    }

    throwIfCancelled(context, metadata.stage || metadata.callingModule || 'LLM request');

    const controller = createAbortController();
    if (!controller) {
        return {
            runId: context.runId,
            callId: null,
            signal: null,
            done: () => {},
            throwIfCancelled: (stage) => throwIfCancelled(context, stage)
        };
    }

    const callId = `llm_${Date.now()}_${++llmCallSeq}`;
    const abortCall = () => {
        if (!controller.signal.aborted) {
            controller.abort(context.reason || context.controller?.signal?.reason || 'cancelled');
        }
    };

    context.controller?.signal?.addEventListener('abort', abortCall, { once: true });
    context.llmCalls.set(callId, {
        callId,
        controller,
        metadata,
        startedAt: Date.now()
    });

    if (context.controller?.signal?.aborted) {
        abortCall();
    }

    return {
        runId: context.runId,
        callId,
        signal: controller.signal,
        done: () => {
            context.controller?.signal?.removeEventListener('abort', abortCall);
            context.llmCalls.delete(callId);
        },
        throwIfCancelled: (stage) => throwIfCancelled(context, stage)
    };
}

module.exports = {
    createRunContext,
    registerRun,
    unregisterRun,
    runWithContext,
    getCurrentContext,
    getActiveRuns,
    getContextForRun,
    cancelRun,
    isCancelled,
    throwIfCancelled,
    registerLlmCall
};
