const assert = require('assert');
const {
    calculateCostBreakdown,
    extractCacheTokens,
    deriveReasoningTokenMetric,
    calculateReasoningBreakdown
} = require('./cost_metrics.js');

function runTest(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

runTest('extracts NanoGPT cache reads', () => {
    assert.deepStrictEqual(extractCacheTokens({
        input_token_details: { cache_read: 57664 }
    }), {
        cacheReadTokens: 57664,
        cacheWriteTokens: 0
    });
});

runTest('extracts OpenRouter cache read and write details', () => {
    assert.deepStrictEqual(extractCacheTokens({
        prompt_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 }
    }), {
        cacheReadTokens: 12000,
        cacheWriteTokens: 3000
    });
});

runTest('prices cached input separately and calculates savings', () => {
    const result = calculateCostBreakdown({
        inputTokens: 100000,
        outputTokens: 10000,
        cacheReadTokens: 90000,
        pricing: { input: 1, cache_read: 0.1, output: 2 }
    });

    assert.strictEqual(result.uncachedInputTokens, 10000);
    assert.strictEqual(result.cacheHitRatio, 0.9);
    assert.strictEqual(result.inputCost, 0.01);
    assert.strictEqual(result.cacheReadCost, 0.009);
    assert.strictEqual(result.outputCost, 0.02);
    assert.ok(Math.abs(result.cacheSavings - 0.081) < 1e-12);
    assert.ok(Math.abs(result.totalCost - 0.039) < 1e-12);
});

runTest('falls back to the input rate when cache pricing is absent', () => {
    const result = calculateCostBreakdown({
        inputTokens: 100000,
        cacheReadTokens: 90000,
        pricing: { input: 1, output: 2 }
    });

    assert.strictEqual(result.cacheReadCost, 0.09);
    assert.strictEqual(result.cacheSavings, 0);
    assert.ok(Math.abs(result.totalCost - 0.1) < 1e-12);
    assert.strictEqual(result.hasCacheReadPricing, false);
});

runTest('uses provider-reported cost only when local pricing is unavailable', () => {
    const result = calculateCostBreakdown({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        reportedCost: 0.004
    });

    assert.strictEqual(result.totalCost, 0.004);
    assert.strictEqual(result.reportedCost, 0.004);
    assert.strictEqual(result.hasPricing, false);
    assert.strictEqual(result.hasReportedCost, true);
});

runTest('prefers the provider-reported total over the local estimate', () => {
    const result = calculateCostBreakdown({
        inputTokens: 56104,
        outputTokens: 6511,
        reportedCost: 0.025426158080000004,
        pricing: { input: 1, output: 2 }
    });

    assert.ok(result.estimatedCost > result.reportedCost);
    assert.strictEqual(result.totalCost, result.reportedCost);
    assert.strictEqual(result.hasReportedCost, true);
});

runTest('preserves positive provider reasoning counts', () => {
    assert.deepStrictEqual(deriveReasoningTokenMetric({
        reportedReasoningTokens: 321,
        generationTokens: 1000,
        reasoningText: 'reasoning'
    }), { tokens: 321, estimated: false });
});

runTest('estimates reasoning when text exists but provider reports zero', () => {
    assert.deepStrictEqual(deriveReasoningTokenMetric({
        reportedReasoningTokens: 0,
        generationTokens: 1000,
        reasoningText: 'a'.repeat(300),
        visibleText: 'b'.repeat(700)
    }), { tokens: 300, estimated: true });
});

runTest('does not invent reasoning without captured text', () => {
    assert.deepStrictEqual(deriveReasoningTokenMetric({
        reportedReasoningTokens: 0,
        generationTokens: 1000
    }), { tokens: 0, estimated: false });
});

runTest('allocates output cost by reasoning share without increasing total cost', () => {
    assert.deepStrictEqual(calculateReasoningBreakdown({
        reasoningTokens: 250,
        generationTokens: 1000,
        outputCost: 0.02
    }), { share: 0.25, cost: 0.005 });
});

runTest('clamps reasoning share to generated tokens', () => {
    assert.deepStrictEqual(calculateReasoningBreakdown({
        reasoningTokens: 1200,
        generationTokens: 1000,
        outputCost: 0.02
    }), { share: 1, cost: 0.02 });
});
