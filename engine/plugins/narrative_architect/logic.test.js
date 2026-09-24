const assert = require('assert');
const logic = require('./logic.js');
const plugin = require('./index.js');

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

function chapter(turnNumber, summary) {
    return {
        turnNumber,
        creationTurnNumber: turnNumber,
        output: { summary }
    };
}

(async () => {
    await runTest('planner and architect Narrative Start hooks preserve request-before-worker priority', async () => {
        const planner = require('../grand_story_planner/index.js');
        assert.strictEqual(planner.hooks.HOOK_NARRATIVE_START.priority, 1);
        assert.strictEqual(plugin.hooks.HOOK_NARRATIVE_START.priority, 2);
        assert.strictEqual(plugin.hooks.HOOK_NARRATIVE_START.mode, 'background');
        assert.strictEqual(plugin.hooks.HOOK_VN_BACKGROUND_TASKS, undefined);
    });

    await runTest('collectChapterBatch uses only unprocessed completed chapters and enforces its cap', async () => {
        const turnContext = {
            projectName: 'Test',
            turnNumber: 10,
            retrieveDatedChapters: async () => ({
                synopsischapters: [chapter(4, 'old')],
                summarychapters: [chapter(6, 'six'), chapter(7, 'seven')],
                fullchapters: [chapter(8, 'eight'), chapter(9, 'nine')]
            })
        };
        const tools = {
            db: {
                chat: {
                    query: async sql => sql.includes("predicate = 'architect_tag_batch'")
                        ? [{ turn_number: 6, context: JSON.stringify({ batchEndTurn: 5 }) }]
                        : []
                }
            }
        };

        const batch = await logic.collectChapterBatch(
            turnContext,
            tools,
            { batch_max_chapters: 3, batch_chapter_max_chars: 200 },
            { batchEndTurn: 9 }
        );

        assert.deepStrictEqual(batch.chapters.map(item => item.turnNumber), [7, 8, 9]);
        assert.strictEqual(batch.startTurn, 7);
        assert.strictEqual(batch.endTurn, 9);
        assert.match(batch.promptText, /Chapter 7: seven/);
        assert.doesNotMatch(batch.promptText, /Chapter 6:/);
    });

    await runTest('requested batch performs one tag call and persists a multi-reference cache', async () => {
        const appended = [];
        let llmCalls = 0;
        const episodes = [
            { filename: 'episode-a', series: 'A', summary: 'A tense choice.', tags_json: '["rising_tension","deepen_relationship"]', status: 'done' },
            { filename: 'episode-b', series: 'B', summary: 'A quiet consequence.', tags_json: '["deepen_relationship"]', status: 'done' },
            { filename: 'episode-c', series: 'C', summary: 'An unrelated beat.', tags_json: '[]', status: 'done' }
        ];
        const turnContext = {
            projectName: 'Test',
            turnNumber: 10,
            input: { userPrompt: 'Continue toward the old promise.' },
            retrieveDatedChapters: async () => ({
                synopsischapters: [],
                summarychapters: [chapter(6, 'A warning arrived.'), chapter(7, 'Trust was tested.')],
                fullchapters: [chapter(8, 'The group chose to stay.'), chapter(9, 'The cost became visible.')]
            })
        };
        const tools = {
            db: {
                chat: {
                    query: async sql => {
                        if (sql.includes("predicate = 'architect_tag_batch'")) {
                            return [{ turn_number: 6, context: JSON.stringify({ batchEndTurn: 5 }) }];
                        }
                        if (sql.includes("predicate = 'architect_used'")) return [];
                        return [];
                    }
                },
                open: async () => ({
                    query: async () => episodes,
                    close: async () => {}
                })
            },
            facts: {
                cleanUpFactsDb: async options => assert.deepStrictEqual(options.predicates, ['architect_cache', 'architect_used', 'architect_tag_batch']),
                appendToFactsDb: async (fact, overrides) => appended.push({ fact, overrides })
            },
            llm: {
                resolveModelDefinition: value => ({ ...value, model: 'cheap', provider: 'test' }),
                withSchema: async task => {
                    llmCalls++;
                    assert.match(task.messages[0].content, /CHAPTERS 6-9/);
                    assert.match(task.messages[0].content, /Chapter 6: A warning arrived/);
                    return { content: { tags: ['rising_tension', 'deepen_relationship'], series: ['A'] } };
                }
            },
            logger: { log: () => {}, error: () => {} }
        };

        const result = await logic.processRequestedBatch(
            turnContext,
            tools,
            { planner_reference_limit: 2, max_cooldown: 5 },
            { requestedBy: 'grand_story_planner', batchEndTurn: 9 }
        );

        assert.strictEqual(llmCalls, 1);
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.chapterCount, 4);
        const cache = appended.find(item => item.fact.predicate === 'architect_cache');
        const cachePayload = JSON.parse(cache.fact.fact_value);
        assert.strictEqual(cachePayload.patterns.length, 2);
        assert.strictEqual(cachePayload.batchStartTurn, 6);
        assert.ok(appended.some(item => item.fact.predicate === 'architect_tag_batch'));
        assert.strictEqual(appended.filter(item => item.fact.predicate === 'architect_used').length, 2);
    });

    await runTest('Narrative Architect hook does nothing without a TurnContext request', async () => {
        const original = logic.processRequestedBatch;
        let calls = 0;
        logic.processRequestedBatch = async () => { calls++; };
        try {
            await plugin.hooks.HOOK_NARRATIVE_START.run(
                { turnNumber: 8 },
                {
                    pluginState: { runtime: () => ({}) },
                    settings: { getSelf: async () => ({}) },
                    logger: { error: () => {} }
                }
            );
            assert.strictEqual(calls, 0);
        } finally {
            logic.processRequestedBatch = original;
        }
    });
})();
