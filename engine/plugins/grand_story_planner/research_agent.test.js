const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const researchAgent = require('./research_agent.js');
const logic = require('./logic.js');

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

function descriptor(name) {
    return {
        name,
        description: `${name} tool`,
        schema: { type: 'object', properties: { command: { type: 'string' } } },
        execute: async () => ({ ok: true })
    };
}

function makeTurnContext(turnNumber = 7) {
    return {
        projectName: 'Test Story',
        turnNumber,
        input: { userPrompt: 'Ask Mira about the road.' },
        runtime: {
            promptBuilder: {
                sharedNarrativePrefix: {
                    messages: [{ role: 'system', content: 'shared foundation' }],
                    prefixHash: 'abc123',
                    characterCount: 17
                }
            }
        },
        processed: { director: { writerBrief: 'Keep consequences alive.' } }
    };
}

function makeTools(outputDir, options = {}) {
    const agentCalls = [];
    const llmCalls = [];
    const pluginCalls = [];
    const facts = { processed: [], reviews: [] };
    const outputs = {
        story: [
            '# Story State',
            'The road refusal and an old unpaid promise are cold-story opportunities that should return with consequence.',
            '# Player Alignment / Taste',
            'The player appears to prefer relationship consequence over generic errands.'
        ].join('\n\n'),
        media: [
            '# Best References',
            'Fullmetal Alchemist and Frieren provide useful consequence-return and quiet emotional movement machinery.',
            '# Why These References Fit',
            'They answer the diagnosed problem by turning old material into new pressure instead of adding random villains.'
        ].join('\n\n'),
        room: [
            '# Phase 1 Problems To Fix',
            'The story needs consequence from the old promise rather than another agreeable scene.',
            '# Reference Mechanisms To Steal',
            'Use FMA-style returning consequences and Frieren-style changed behavior.',
            '# Practical Repair Advice',
            'Bring the promise back through Mira and make the solution cost an easier alliance.'
        ].join('\n\n'),
        plan: [
            [
                '# Plan Changes Needed',
                'Remove stale generic travel pressure and make the old promise the immediate engine.',
                '# Comprehensive Draft Direction',
                'Mira should face a relationship consequence that complicates the next chapters.'
            ].join('\n\n'),
            [
                '# Self-Reflect Critic',
                'The draft still risks feeling generic if the promise arrives as exposition rather than behavior.',
                '# Weak Ideas To Reject',
                'Reject a generic villain or coincidence that forces Mira to care.'
            ].join('\n\n'),
            [
                '# Grand Plan',
                'Use the old promise as the next dramatic engine while preserving player agency and relationship texture.',
                '# Immediate Next Chapters',
                'Make Mira react to the returning obligation through choices, not speeches.',
                '# Cliches Not To Do',
                'Do not add a generic villain to force movement.',
                '# Character-Specific Guidance',
                'Let Mira withhold, misread, or choose, rather than merely agree.'
            ].join('\n\n')
        ],
        ledger: 'INSERT [SHORT-9] | Span: Turns 8-10 | Content: Let the old promise return through Mira and complicate an easier alliance.',
        objective: 'INSERT [QUEST-001] | Deadline: 3 turns | Stakes: medium | Brief: Mira asks for help honoring an old promise. | Objective: Help Mira resolve the promise without simply declaring it solved. | AI: The missing proof is held by a reluctant witness; seed hints but do not reveal directly. | Fail: Mira loses trust and withdraws from the alliance. | Success: Mira commits to helping the party on the next difficult choice.'
    };
    if (options.badLedgerCategory) outputs.ledger = 'INSERT [LOCAL-9] | Span: Turns 8-10 | Content: Wrong category.';
    if (options.badMystery) outputs.ledger = 'INSERT [MYST-2] | Span: Turns 8-12 | Content: A secret exists.';
    if (options.unboundedLedger) outputs.ledger = 'INSERT [SHORT-9] | Span: Ongoing | Content: Keep this forever.';
    if (options.unbracketedObjective) {
        outputs.objective = 'INSERT QUEST-001 | Deadline: 1 | Stakes: HIGH | Brief: Mira asks for help honoring an old promise. | Objective: Help Mira resolve the promise without simply declaring it solved. | AI: The missing proof is held by a reluctant witness; seed hints but do not reveal directly. | Fail: Mira loses trust and withdraws from the alliance. | Success: Mira commits to helping the party on the next difficult choice.';
    }
    if (options.badObjective) outputs.objective = 'INSERT QUEST-001 | Brief: Missing deadline and required fields.';

    return {
        agentCalls,
        llmCalls,
        pluginCalls,
        factsState: facts,
        settings: {
            get: () => ({ infrastructure: { prompt_caching: { vn_pipeline: { follower_delay_ms: 0 } } } }),
            getSelf: () => ({
                model_def: { model: 'test-model' },
                retries: 0,
                timeout: 1000
            })
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'quest_tracker' && options.objectiveInstalled === true,
            tryCall: async (pluginId, functionName, args = []) => {
                pluginCalls.push({ pluginId, functionName, args });
                if (pluginId === 'quest_tracker' && functionName === 'getQuestRegistry') return options.questRegistry || [];
                if (pluginId === 'quest_tracker' && functionName === 'refreshQuestRegistry') return { registry: options.questRegistry || [] };
                if (pluginId === 'memory_recall') return [descriptor('memory_recall')];
                if (pluginId === 'narrative_architect' && options.architectThrows) throw new Error('Architect unavailable.');
                if (pluginId === 'narrative_architect' && !options.missingArchitect) return [descriptor('narrative_architect')];
                return [];
            }
        },
        agent: {
            defineTool: value => value,
            startAgent: async agentOptions => {
                agentCalls.push(agentOptions);
                if (agentOptions.phase === 'media' && options.mediaAgentFailure && agentOptions.toolsAllowed.length > 0) {
                    return { status: 'error', final: null, iterations: 1, trace: [], messages: [], error: 'tool failure' };
                }
                const phase = agentOptions.phase;
                return {
                    status: 'completed',
                    final: outputs[phase],
                    iterations: agentOptions.minimumIterations || 1,
                    trace: [],
                    messages: [],
                    error: null
                };
            }
        },
        llm: {
            call: async (messages, params) => {
                const phase = String(params.callingModule || '').split(':').pop();
                llmCalls.push({ phase, messages, params });
                let content;
                if (phase === 'plan') {
                    const planCalls = llmCalls.filter(call => call.phase === 'plan').length;
                    content = outputs.plan[planCalls - 1];
                } else {
                    content = outputs[phase];
                }
                if (typeof params.validateFn === 'function') await params.validateFn(content);
                return { content, model: params.model, provider: params.provider };
            },
            runTask: async (task) => {
                const phase = String(task?.params?.callingModule || '').split(':').pop();
                const messages = task?.prompt?.messages || [];
                llmCalls.push({ phase, messages, params: task?.params || {} });
                let content;
                if (phase === 'plan') {
                    const planCalls = llmCalls.filter(call => call.phase === 'plan').length;
                    content = outputs.plan[planCalls - 1];
                } else {
                    content = outputs[phase];
                }
                return { content, model: task?.model, provider: task?.provider };
            }
        },
        project: {
            getChatPluginStorage: turn => {
                const key = String(turn || 7);
                return {
                    absolutePath: path.join(outputDir, key),
                    relativePath: `plugins/Test/${key}/grand_story_planner`,
                    storageTurnKey: key
                };
            }
        },
        db: { chat: { query: async () => [] } },
        facts: {
            getFormattedLedger: async category => {
                if (category === 'quest_tracker') return 'Empty.';
                if (options.nonQuestObjectiveLedger) return '[THEME-1] | Span: Global/Constant | Content: Non-quest planner entry.';
                return '[SHORT-1] | Span: Turns 1-12 | Content: Existing short-term arc.';
            },
            cleanUpFactsDb: async () => {},
            processLedgerOperations: async (text, category) => facts.processed.push({ text, category }),
            appendToFactsDb: async row => facts.reviews.push(row)
        },
        logger: { log: () => {}, warn: () => {}, runtime: () => {} }
    };
}

(async () => {
    await runTestAsync('allocates story and media budgets with fixed deterministic phases', async () => {
        assert.deepStrictEqual(researchAgent.resolvePhaseBudgets({}, null), {
            story: 6, media: 5, room: 1, plan: 3, ledger: 1, objective: 0, total: 16, ceiling: 16
        });
        assert.deepStrictEqual(researchAgent.resolvePhaseBudgets({}, 9), {
            story: 2, media: 2, room: 1, plan: 3, ledger: 1, objective: 0, total: 9, ceiling: 9
        });
        const reduced = researchAgent.resolvePhaseBudgets({}, 12);
        assert.strictEqual(reduced.total, 12);
        assert.throws(() => researchAgent.resolveTotalCallLimit('8'), /between 9 and 60/);
    });

    await runTestAsync('runs two agentic phases then deterministic room plan and ledger phases', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir);
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.published, true);
            assert.deepStrictEqual(result.artifact.phaseOrder, ['story', 'media', 'room', 'plan', 'ledger', 'objective']);
            assert.strictEqual(result.artifact.phases.objective.status, 'unavailable');
            assert.strictEqual(result.artifact.editorial, null);
            assert.strictEqual(tools.agentCalls.length, 2);
            assert.deepStrictEqual(tools.agentCalls[0].toolsAllowed.sort(), ['memory_recall', 'story_text']);
            assert.deepStrictEqual(tools.agentCalls[1].toolsAllowed, ['narrative_architect']);
            assert.deepStrictEqual(tools.llmCalls.map(call => call.phase), ['room', 'plan', 'plan', 'plan', 'ledger']);
            assert.match(tools.llmCalls[0].messages.map(message => message.text ?? message.content).join('\n'), /Do not redo Phase 1 story research/);
            assert.match(tools.llmCalls[1].messages.map(message => message.text ?? message.content).join('\n'), /CURRENT GRAND STORY PLANNER LEDGER/);
            assert.strictEqual(tools.factsState.processed.length, 1);
            assert.strictEqual(tools.factsState.processed[0].category, 'grand_story_planner');
            assert.match(tools.factsState.processed[0].text, /\[SHORT-9\]/);
            const published = JSON.parse(await fs.readFile(path.join(outputDir, '7', 'research_published.json'), 'utf8'));
            assert.match(published.phases.room.sections.practical_repair_advice, /Mira/);
            assert.match(published.phases.plan.sections.grand_plan, /old promise/);
            assert.match(researchAgent.formatResearchSectionsForTerminal(published), /Phase 1 Problems To Fix/);
            assert.strictEqual(published.researchTranscript.phaseConclusionCount, 5);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('uses model-knowledge media fallback when Architect is absent or fails', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_fallback');
        await fs.rm(outputDir, { recursive: true, force: true });
        try {
            const missingTools = makeTools(outputDir, { missingArchitect: true });
            const missing = await researchAgent.runResearchAgent(makeTurnContext(7), missingTools);
            assert.strictEqual(missing.artifact.published, true);
            assert.strictEqual(missing.artifact.phases.media.fallbackUsed, true);
            assert.deepStrictEqual(missingTools.agentCalls[1].toolsAllowed, []);

            const failingTools = makeTools(outputDir, { mediaAgentFailure: true });
            const failing = await researchAgent.runResearchAgent(makeTurnContext(8), failingTools);
            assert.strictEqual(failing.artifact.published, true);
            assert.strictEqual(failing.artifact.phases.media.fallbackUsed, true);
            assert.strictEqual(failingTools.agentCalls.filter(call => call.phase === 'media').length, 2);
            assert.deepStrictEqual(failingTools.agentCalls[2].toolsAllowed, []);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('rejects unsupported or malformed grand story ledger categories', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_bad_ledger');
        await fs.rm(outputDir, { recursive: true, force: true });
        try {
            const badCategory = await researchAgent.runResearchAgent(makeTurnContext(7), makeTools(outputDir, { badLedgerCategory: true }));
            assert.strictEqual(badCategory.artifact.status, 'failed');
            assert.strictEqual(badCategory.artifact.failedPhase, 'ledger');
            assert.match(badCategory.artifact.error, /unsupported category/);

            const badMystery = await researchAgent.runResearchAgent(makeTurnContext(8), makeTools(outputDir, { badMystery: true }));
            assert.strictEqual(badMystery.artifact.status, 'failed');
            assert.strictEqual(badMystery.artifact.failedPhase, 'ledger');
            assert.match(badMystery.artifact.error, /MYST entries/);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('filters non-quest objective ledger rows out of the phase 5 compiler context', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_objective_filter');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir, { nonQuestObjectiveLedger: true });
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.published, true);
            assert.strictEqual(tools.llmCalls.filter(call => call.phase === 'ledger').length, 1);
            const ledgerPrompt = tools.llmCalls.find(call => call.phase === 'ledger').messages.map(message => message.text ?? message.content).join('\n');
            const compilerBlock = ledgerPrompt.slice(ledgerPrompt.lastIndexOf('# PHASE 5: GRAND STORY LEDGER COMPILER'));
            assert.doesNotMatch(compilerBlock, /THEME-1/);
            assert.match(compilerBlock, /No existing IDs are available/);
            assert.strictEqual(tools.factsState.processed.length, 1);
            assert.match(tools.factsState.processed[0].text, /INSERT \[SHORT-9\]/);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('optional objective phase writes only to the objective namespace', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_objective');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir, { objectiveInstalled: true });
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.phases.objective.status, 'completed');
            assert.strictEqual(result.artifact.objectiveLedger.applied, true);
            assert.deepStrictEqual(tools.factsState.processed.map(item => item.category), [
                'grand_story_planner',
                'quest_tracker'
            ]);
            assert.match(tools.factsState.processed[1].text, /\[QUEST-001\]/);
            assert.deepStrictEqual(tools.pluginCalls.filter(call => call.pluginId === 'quest_tracker').map(call => call.functionName), [
                'getQuestRegistry',
                'refreshQuestRegistry'
            ]);
            assert.strictEqual(tools.pluginCalls.find(call => call.pluginId === 'quest_tracker' && call.functionName === 'refreshQuestRegistry').args[0].emitHud, true);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('normalizes loose quest objective operations before persistence', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_objective_unbracketed');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir, { objectiveInstalled: true, unbracketedObjective: true });
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.objectiveLedger.applied, true);
            assert.strictEqual(tools.factsState.processed[1].category, 'quest_tracker');
            assert.match(tools.factsState.processed[1].text, /^INSERT \[QUEST-001\] \| Deadline: 3 turns \| Stakes: high \| Brief:/);
            assert.strictEqual(tools.pluginCalls.some(call => call.pluginId === 'quest_tracker' && call.functionName === 'refreshQuestRegistry'), true);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('objective phase passes quest portfolio pressure to compiler prompt', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_objective_portfolio');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir, {
            objectiveInstalled: true,
            questRegistry: [{
                id: 'QUEST-AARU-01',
                status: 'active',
                stakes: 'low',
                objective: 'Collect Dehya\'s commission and leave Fontaine.',
                updated_turn: 70,
                deadline_turn: 75,
                deadline_turns: 5
            }]
        });
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(72), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.objectiveLedger.portfolio.active, 1);
            const objectivePrompt = tools.llmCalls.find(call => call.phase === 'objective').messages.map(message => message.text ?? message.content).join('\n');
            assert.match(objectivePrompt, /LOW QUEST INVENTORY/);
            assert.match(objectivePrompt, /QUEST-AARU-01/);
            assert.match(objectivePrompt, /3 turn\(s\) left/);
            assert.match(objectivePrompt, /3-5 turns, one medium quest at 6-9 turns, and one longer quest at 10-16 turns/);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('degrades optional objective phase without failing planner publication', async () => {
        const outputDir = path.join(__dirname, '.research_agent_test_output_objective_degraded');
        await fs.rm(outputDir, { recursive: true, force: true });
        const tools = makeTools(outputDir, { objectiveInstalled: true, badObjective: true });
        try {
            const result = await researchAgent.runResearchAgent(makeTurnContext(), tools);
            assert.strictEqual(result.artifact.status, 'completed');
            assert.strictEqual(result.artifact.published, true);
            assert.strictEqual(result.artifact.phases.objective.status, 'degraded');
            assert.strictEqual(result.artifact.objectiveLedger.applied, false);
            assert.match(result.artifact.objectiveLedger.warning, /Quest objective phase skipped/);
            assert.deepStrictEqual(tools.factsState.processed.map(item => item.category), ['grand_story_planner']);
        } finally {
            await fs.rm(outputDir, { recursive: true, force: true });
        }
    });

    await runTestAsync('quest objective prompts demand player-experienced outcomes and multiple hooks', async () => {
        const compiler = await fs.readFile(path.join(__dirname, 'prompts', '5_1_quest_tracker.txt'), 'utf8');
        const finalPrompt = await fs.readFile(path.join(__dirname, 'prompts', '5_1_quest_tracker_final.txt'), 'utf8');

        assert.match(compiler, /PLAYER-EXPERIENCED consequences/);
        assert.match(compiler, /0-1 active quests/);
        assert.match(compiler, /2-4 INSERTs/);
        assert.match(compiler, /stagger deadlines/);
        assert.match(compiler, /NPC taking command|Command loss/);
        assert.match(compiler, /refuses easy affection/);
        assert.match(compiler, /future-facing instructions/);
        assert.match(compiler, /player-experienced delta/);
        assert.match(compiler, /what the player visibly loses/);
        assert.match(compiler, /would not happen by default/);
        assert.match(compiler, /how it resists cheap handwaving/);
        assert.match(compiler, /Reject continuity-only successes/);
        assert.match(compiler, /Avoid weak bookkeeping phrases/);
        assert.match(compiler, /QUEST TRACKER PORTFOLIO PRESSURE/);
        assert.match(finalPrompt, /Prefer 2-4 quests/);
        assert.match(finalPrompt, /Quest inventory policy is high priority/);
        assert.match(finalPrompt, /10-16 turns/);
        assert.match(finalPrompt, /refusal to accept instant forgiveness/);
        assert.match(finalPrompt, /who\/what reacts/);
        assert.match(finalPrompt, /what visible playable benefit appears/);
        assert.match(finalPrompt, /story now treats the player character differently/);
        assert.match(finalPrompt, /concrete reward or affordance/);
        assert.match(finalPrompt, /Bad Fail: "The boutique scene loses its window/);
    });

    await runTestAsync('builds context while omitting Director-only cache suffixes', async () => {
        const prefix = researchAgent.getPrefixDetails({
            processed: {
                promptBuilder: {
                    messages: [
                        { role: 'system', content: 'shared system' },
                        { role: 'user', content: 'shared state' },
                        { role: 'user', content: 'writer suffix' }
                    ],
                    writerPromptSnapshot: { sharedPrefix: { hash: 'same-hash', messageCount: 2 } }
                },
                director: {
                    researchCacheSharedPrefixHash: 'same-hash',
                    researchCacheContextMessage: 'exact Director context',
                    researchCacheAnalysisInstructions: 'exact Director analysis'
                }
            }
        });
        assert.deepStrictEqual(prefix.messages.map(message => message.content), [
            'shared system', 'shared state'
        ]);
        assert.strictEqual(prefix.metadata.reusedDirectorContext, false);
        assert.strictEqual(prefix.metadata.reusedDirectorAnalysis, false);
        assert.strictEqual(prefix.metadata.directorResearchSuffixAvailable, true);
        assert.strictEqual(prefix.metadata.directorResearchSuffixHashMatched, true);
        assert.strictEqual(prefix.metadata.directorResearchSuffixOmitted, true);
    });
})();
