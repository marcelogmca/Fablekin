const assert = require('assert');
const {
    buildCompressedHistoryViews,
    createEmptyCompressedHistory
} = require('./memory_lod.js');

const formatters = {
    applyGlobalReplacements: (text) => String(text || ''),
    wrap: (tagName, content) => `<${tagName}>\n${content}\n</${tagName}>`
};

function runTest(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

function makeTurn(turnNumber, options = {}) {
    const turn = {
        turnNumber,
        input: { userPrompt: `user ${turnNumber}` },
        processed: {
            dialogueProcessor: { dialogue: `dialogue ${turnNumber}` },
            plugins: {}
        },
        output: {
            fulltext: `full ${turnNumber}`,
            summary: `summary ${turnNumber}`,
            synopsis: `synopsis ${turnNumber}`
        },
        isSkeleton: options.isSkeleton === true,
        ensureFull: async () => {
            turn.inflated = true;
            turn.isSkeleton = false;
        }
    };

    if (options.interludeCapsule) {
        turn.processed.plugins.interludeCapsules = [{
            ordinal: 1,
            label: 'Camp',
            displayTurn: `${turnNumber}.1`,
            capsule: options.interludeCapsule
        }];
    }

    return turn;
}

function makeContext(options = {}) {
    return {
        runtime: {
            timelineRouting: options.timelineRouting || { pre: {}, post: {} }
        },
        processed: {
            slottedRAG: options.slottedRAG || {}
        }
    };
}

function makeChapterItems(count) {
    return Array.from({ length: count }, (_unused, index) => ({
        tc: makeTurn(index + 1),
        nativeTier: 'synopsis'
    }));
}

function chapterNumbers(text) {
    return Array.from(String(text || '').matchAll(/Chapter (\d+):/g)).map(match => Number(match[1]));
}

function makeArcCompressionHarness(options = {}) {
    const cache = new Map();
    const calls = [];
    const requests = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;
    return {
        calls,
        requests,
        get maxActiveCalls() {
            return maxActiveCalls;
        },
        arcCompression: {
            get: async key => cache.get(key) || null,
            save: async (key, value) => {
                cache.set(key, value);
            },
            callLLM: async request => {
                requests.push(request);
                const prompt = request.messages?.[0]?.content || '';
                const chapters = Array.from(prompt.matchAll(/Chapter (\d+):/g)).map(match => Number(match[1]));
                const first = chapters[0];
                const last = chapters.at(-1);
                activeCalls += 1;
                maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
                if (options.delayMs) {
                    await new Promise(resolve => setTimeout(resolve, options.delayMs));
                }
                calls.push({ first, last, count: chapters.length });
                activeCalls -= 1;
                return { content: `cached arc ${first}-${last} (${chapters.length} chapters)` };
            }
        }
    };
}

function makeArcTailSettings(presetCounts, arcTail = {}) {
    return {
        infrastructure: {
            narrative_history: {
                memory_lod: {
                    enable_arc_compression: true,
                    arc_compression_model: 'lowendmodel',
                    arc_compression_provider: 'nano_gpt'
                },
                compressed_history: {
                    arc_tail: {
                        enabled: true,
                        max_chapters_per_chunk: 50,
                        min_chapters: 3,
                        target_words: 300,
                        ...arcTail
                    },
                    presets: {
                        brief: presetCounts,
                        balanced: presetCounts,
                        deep: presetCounts
                    }
                }
            }
        }
    };
}

runTest('empty compressed history is default-safe', () => {
    assert.deepStrictEqual(createEmptyCompressedHistory(), {
        brief: 'No story yet.',
        balanced: 'No story yet.',
        deep: 'No story yet.'
    });
});

(async () => {
    await runTestAsync('default presets select expected chapter counts and tiers chronologically', async () => {
        const views = await buildCompressedHistoryViews(makeChapterItems(50), makeContext(), formatters, { settings: {} });

        assert.strictEqual(chapterNumbers(views.brief).length, 15);
        assert.deepStrictEqual(chapterNumbers(views.brief).slice(0, 2), [36, 37]);
        assert.strictEqual(chapterNumbers(views.brief).at(-1), 50);
        assert.strictEqual(views.brief.includes('[USER]:'), false);
        assert.strictEqual(views.brief.includes('synopsis 45'), true);
        assert.strictEqual(views.brief.includes('summary 46'), true);

        assert.strictEqual(chapterNumbers(views.balanced).length, 31);
        assert.strictEqual(chapterNumbers(views.balanced)[0], 20);
        assert.strictEqual(chapterNumbers(views.balanced).at(-1), 50);
        assert.strictEqual(views.balanced.includes('synopsis 39'), true);
        assert.strictEqual(views.balanced.includes('summary 40'), true);
        assert.strictEqual(views.balanced.includes('[USER]: user 50'), true);

        assert.strictEqual(chapterNumbers(views.deep).length, 50);
        assert.strictEqual(chapterNumbers(views.deep)[0], 1);
        assert.strictEqual(views.deep.includes('summary 33'), true);
        assert.strictEqual(views.deep.includes('[USER]: user 49'), true);
        assert.strictEqual(views.deep.includes('[USER]: user 50'), true);
    });

    await runTestAsync('hidden preset config overrides full summary and synopsis counts', async () => {
        const settings = {
            infrastructure: {
                narrative_history: {
                    compressed_history: {
                        presets: {
                            brief: {
                                full_chapters: 1,
                                summary_chapters: 1,
                                synopsis_chapters: 1
                            }
                        }
                    }
                }
            }
        };
        const views = await buildCompressedHistoryViews(makeChapterItems(5), makeContext(), formatters, { settings });

        assert.deepStrictEqual(chapterNumbers(views.brief), [3, 4, 5]);
        assert.strictEqual(views.brief.includes('synopsis 3'), true);
        assert.strictEqual(views.brief.includes('summary 4'), true);
        assert.strictEqual(views.brief.includes('[USER]: user 5'), true);
        assert.strictEqual(views.brief.includes('Chapter 2:'), false);
    });

    await runTestAsync('compressed history includes routing slotted rag and interlude capsules', async () => {
        const items = [{ tc: makeTurn(1, { interludeCapsule: 'Shared a quiet meal.' }), nativeTier: 'synopsis' }];
        const context = makeContext({
            timelineRouting: {
                pre: { 1: 'Before marker' },
                post: { 1: 'After marker' }
            },
            slottedRAG: {
                1: 'remembered detail'
            }
        });
        const settings = {
            infrastructure: {
                narrative_history: {
                    compressed_history: {
                        presets: {
                            brief: { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 1 }
                        }
                    }
                }
            }
        };

        const views = await buildCompressedHistoryViews(items, context, formatters, { settings });

        assert.strictEqual(views.brief.includes('[Before marker]'), true);
        assert.strictEqual(views.brief.includes('[After marker]'), true);
        assert.strictEqual(views.brief.includes('<relevant_memories>'), true);
        assert.strictEqual(views.brief.includes('remembered detail'), true);
        assert.strictEqual(views.brief.includes('[Interlude Summaries]'), true);
        assert.strictEqual(views.brief.includes('Shared a quiet meal.'), true);
    });

    await runTestAsync('arc tail chunks 200 out-of-scope chapters into four cached 50-chapter calls', async () => {
        const harness = makeArcCompressionHarness({ delayMs: 10 });
        const presetCounts = { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 0 };
        const settings = makeArcTailSettings(presetCounts);

        const views = await buildCompressedHistoryViews(makeChapterItems(200), makeContext(), formatters, {
            settings,
            arcCompression: harness.arcCompression
        });

        assert.deepStrictEqual(harness.calls, [
            { first: 1, last: 50, count: 50 },
            { first: 51, last: 100, count: 50 },
            { first: 101, last: 150, count: 50 },
            { first: 151, last: 200, count: 50 }
        ]);
        assert.strictEqual(harness.maxActiveCalls, 4);
        assert.deepStrictEqual(harness.requests[0].extra, {
            reasoning: { effort: 'none' }
        });
        assert.strictEqual(views.brief.includes('Chapter 1 to 50:'), true);
        assert.strictEqual(views.brief.includes('cached arc 151-200'), true);
        assert.strictEqual(views.balanced, views.brief);
        assert.strictEqual(views.deep, views.brief);
    });

    await runTestAsync('arc tail reuses cached chunks across repeated compressed-history builds', async () => {
        const harness = makeArcCompressionHarness();
        const presetCounts = { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 10 };
        const settings = makeArcTailSettings(presetCounts);
        const chapters = makeChapterItems(80);

        const firstViews = await buildCompressedHistoryViews(chapters, makeContext(), formatters, {
            settings,
            arcCompression: harness.arcCompression
        });
        const callsAfterFirstBuild = harness.calls.length;
        const secondViews = await buildCompressedHistoryViews(chapters, makeContext(), formatters, {
            settings,
            arcCompression: harness.arcCompression
        });

        assert.strictEqual(callsAfterFirstBuild, 2);
        assert.strictEqual(harness.calls.length, callsAfterFirstBuild);
        assert.strictEqual(secondViews.brief, firstViews.brief);
        assert.strictEqual(secondViews.brief.includes('Chapter 1 to 50:'), true);
        assert.strictEqual(secondViews.brief.includes('Chapter 51 to 75:'), true);
        assert.deepStrictEqual(chapterNumbers(secondViews.brief).slice(-2), [79, 80]);
    });

    await runTestAsync('arc tails for different presets run concurrently', async () => {
        const harness = makeArcCompressionHarness({ delayMs: 10 });
        const settings = makeArcTailSettings(
            { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 0 },
            { max_chapters_per_chunk: 200 }
        );
        settings.infrastructure.narrative_history.compressed_history.presets = {
            brief: { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 0 },
            balanced: { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 10 },
            deep: { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 20 }
        };

        await buildCompressedHistoryViews(makeChapterItems(120), makeContext(), formatters, {
            settings,
            arcCompression: harness.arcCompression
        });

        assert.strictEqual(harness.calls.length, 3);
        assert.strictEqual(harness.maxActiveCalls, 3);
    });

    await runTestAsync('arc rollover keeps its source stable for five turns', async () => {
        const harness = makeArcCompressionHarness();
        const presetCounts = { full_chapters: 0, summary_chapters: 0, synopsis_chapters: 10 };
        const settings = makeArcTailSettings(presetCounts, {
            tile_chapters: 25,
            rollover_grace_chapters: 5
        });
        const liveSynopsisCounts = [];

        for (let chapterCount = 80; chapterCount <= 84; chapterCount++) {
            const views = await buildCompressedHistoryViews(makeChapterItems(chapterCount), makeContext(), formatters, {
                settings,
                arcCompression: harness.arcCompression
            });
            liveSynopsisCounts.push(chapterNumbers(views.brief).length);
        }

        assert.deepStrictEqual(liveSynopsisCounts, [5, 6, 7, 8, 9]);
        assert.deepStrictEqual(harness.calls, [
            { first: 1, last: 25, count: 25 },
            { first: 26, last: 50, count: 25 },
            { first: 51, last: 75, count: 25 }
        ]);

        const rolloverViews = await buildCompressedHistoryViews(makeChapterItems(85), makeContext(), formatters, {
            settings,
            arcCompression: harness.arcCompression
        });

        assert.strictEqual(chapterNumbers(rolloverViews.brief).length, 5);
        assert.deepStrictEqual(harness.calls.at(-1), { first: 76, last: 80, count: 5 });
        assert.strictEqual(harness.calls.length, 4);
    });
})();
