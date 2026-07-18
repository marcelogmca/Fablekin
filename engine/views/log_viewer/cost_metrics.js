(function exposeCostMetrics(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.LogCostMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCostMetrics() {
    function asFiniteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function firstFiniteNumber(...values) {
        for (const value of values) {
            const number = asFiniteNumber(value);
            if (number !== null) return number;
        }
        return null;
    }

    function clampTokenCount(value, maximum) {
        const number = firstFiniteNumber(value) || 0;
        return Math.min(Math.max(0, number), Math.max(0, maximum));
    }

    function extractCacheTokens(usage = {}) {
        return {
            cacheReadTokens: firstFiniteNumber(
                usage.cached_input_tokens,
                usage.cachedInputTokens,
                usage.cache_read_tokens,
                usage.cacheReadTokens,
                usage.cache_read_input_tokens,
                usage.prompt_tokens_details?.cached_tokens,
                usage.promptTokensDetails?.cachedTokens,
                usage.input_token_details?.cache_read,
                usage.input_token_details?.cached_tokens,
                usage.inputTokenDetails?.cacheRead,
                usage.inputTokenDetails?.cachedTokens,
                usage.cachedTokens
            ) || 0,
            cacheWriteTokens: firstFiniteNumber(
                usage.cache_write_tokens,
                usage.cacheWriteTokens,
                usage.cache_creation_input_tokens,
                usage.prompt_tokens_details?.cache_write_tokens,
                usage.promptTokensDetails?.cacheWriteTokens,
                usage.input_token_details?.cache_write,
                usage.inputTokenDetails?.cacheWrite
            ) || 0
        };
    }

    function deriveReasoningTokenMetric({
        reportedReasoningTokens = null,
        generationTokens = 0,
        reasoningText = '',
        visibleText = ''
    } = {}) {
        const reported = Math.max(0, firstFiniteNumber(reportedReasoningTokens) || 0);
        if (reported > 0) return { tokens: reported, estimated: false };

        const reasoningLength = String(reasoningText || '').trim().length;
        if (reasoningLength === 0) return { tokens: 0, estimated: false };

        const visibleLength = String(visibleText || '').trim().length;
        const generation = Math.max(0, firstFiniteNumber(generationTokens) || 0);
        const totalLength = reasoningLength + visibleLength;
        const estimated = generation > 0 && totalLength > 0
            ? Math.round(generation * (reasoningLength / totalLength))
            : Math.ceil(reasoningLength / 4);

        return {
            tokens: generation > 0 ? Math.min(generation, Math.max(1, estimated)) : Math.max(1, estimated),
            estimated: true
        };
    }

    function calculateReasoningBreakdown({ reasoningTokens = 0, generationTokens = 0, outputCost = 0 } = {}) {
        const generation = Math.max(0, firstFiniteNumber(generationTokens) || 0);
        const reasoning = Math.min(generation, Math.max(0, firstFiniteNumber(reasoningTokens) || 0));
        const share = generation > 0 ? reasoning / generation : 0;
        return {
            share,
            cost: Math.max(0, firstFiniteNumber(outputCost) || 0) * share
        };
    }

    function calculateCostBreakdown({
        inputTokens = 0,
        outputTokens = 0,
        cacheReadTokens = 0,
        cacheWriteTokens = 0,
        pricing = null,
        reportedCost = 0
    } = {}) {
        const normalizedInputTokens = Math.max(0, firstFiniteNumber(inputTokens) || 0);
        const normalizedOutputTokens = Math.max(0, firstFiniteNumber(outputTokens) || 0);
        const normalizedCacheReadTokens = clampTokenCount(cacheReadTokens, normalizedInputTokens);
        const normalizedCacheWriteTokens = clampTokenCount(
            cacheWriteTokens,
            normalizedInputTokens - normalizedCacheReadTokens
        );
        const uncachedInputTokens = Math.max(
            0,
            normalizedInputTokens - normalizedCacheReadTokens - normalizedCacheWriteTokens
        );
        const normalizedReportedCost = Math.max(0, firstFiniteNumber(reportedCost) || 0);
        const inputRate = firstFiniteNumber(pricing?.input);
        const outputRate = firstFiniteNumber(pricing?.output);
        const hasPricing = inputRate !== null && outputRate !== null;

        if (!hasPricing) {
            return {
                inputTokens: normalizedInputTokens,
                outputTokens: normalizedOutputTokens,
                uncachedInputTokens,
                cacheReadTokens: normalizedCacheReadTokens,
                cacheWriteTokens: normalizedCacheWriteTokens,
                cacheHitRatio: normalizedInputTokens > 0 ? normalizedCacheReadTokens / normalizedInputTokens : 0,
                inputCost: 0,
                cacheReadCost: 0,
                cacheWriteCost: 0,
                outputCost: 0,
                cacheSavings: 0,
                estimatedCost: 0,
                reportedCost: normalizedReportedCost,
                totalCost: normalizedReportedCost,
                hasPricing: false,
                hasCacheReadPricing: false
            };
        }

        const cacheReadRate = firstFiniteNumber(pricing.cache_read, pricing.cacheRead) ?? inputRate;
        const cacheWriteRate = firstFiniteNumber(pricing.cache_write, pricing.cacheWrite) ?? inputRate;
        const inputCost = (uncachedInputTokens / 1000000) * inputRate;
        const cacheReadCost = (normalizedCacheReadTokens / 1000000) * cacheReadRate;
        const cacheWriteCost = (normalizedCacheWriteTokens / 1000000) * cacheWriteRate;
        const outputCost = (normalizedOutputTokens / 1000000) * outputRate;
        const cacheSavings = (normalizedCacheReadTokens / 1000000) * Math.max(0, inputRate - cacheReadRate);
        const estimatedCost = inputCost + cacheReadCost + cacheWriteCost + outputCost;

        return {
            inputTokens: normalizedInputTokens,
            outputTokens: normalizedOutputTokens,
            uncachedInputTokens,
            cacheReadTokens: normalizedCacheReadTokens,
            cacheWriteTokens: normalizedCacheWriteTokens,
            cacheHitRatio: normalizedInputTokens > 0 ? normalizedCacheReadTokens / normalizedInputTokens : 0,
            inputCost,
            cacheReadCost,
            cacheWriteCost,
            outputCost,
            cacheSavings,
            estimatedCost,
            reportedCost: normalizedReportedCost,
            totalCost: estimatedCost,
            hasPricing: true,
            hasCacheReadPricing: firstFiniteNumber(pricing.cache_read, pricing.cacheRead) !== null
        };
    }

    return {
        calculateCostBreakdown,
        extractCacheTokens,
        deriveReasoningTokenMetric,
        calculateReasoningBreakdown
    };
});
