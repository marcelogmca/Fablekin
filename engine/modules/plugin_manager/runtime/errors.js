/**
 * Specialized error for aborting the narrative pipeline.
 * Caught by executeHook and the core engine callers.
 */
class PipelineAbortError extends Error {
    constructor(reason, pluginId) {
        super(reason);
        this.name = 'PipelineAbortError';
        this.pluginId = pluginId;
        this.reason = reason;
    }
}

module.exports = { PipelineAbortError };
