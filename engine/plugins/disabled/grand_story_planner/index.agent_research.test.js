const assert = require('assert');
const plugin = require('./index.js');
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

(async () => {
    await runTestAsync('planner research run streams phased events and reports publication', async () => {
        const originalRun = researchAgent.runResearchAgent;
        const emitted = [];
        researchAgent.runResearchAgent = async (_context, _tools, options) => {
            assert.strictEqual(options.maxIterations, 9);
            await options.onEvent({
                type: 'model_response',
                phase: 'story',
                iteration: 1,
                action: { type: 'continue', content: 'working' }
            });
            return {
                artifact: {
                    status: 'completed',
                    published: true,
                    iterations: 9,
                    maxIterations: 9,
                    turnLogTitle: 'Grand Story Planner Agentic Run',
                    budgets: { story: 2, media: 2, room: 1, plan: 3, ledger: 1, objective: 0 },
                    prefix: { source: 'runtime.sharedNarrativePrefix', characterCount: 100, reusedDirectorContext: false },
                    userContext: { historySource: 'balanced', characterCount: 50 },
                    phases: {
                        story: { iterations: 2, tools: ['story_text', 'memory_recall'] },
                        media: { iterations: 2, tools: ['narrative_architect'] },
                        room: { iterations: 1 },
                        plan: { iterations: 3 },
                        ledger: { iterations: 1 },
                        objective: { iterations: 0 }
                    }
                },
                storage: { relativePath: 'plugins/Test/3/grand_story_planner' }
            };
        };

        const tools = {
            turnContext: { projectName: 'Test', turnNumber: 3 },
            settings: { get: () => ({}), getSelf: () => ({}) },
            socket: { emit: (event, payload) => emitted.push({ event, payload }) }
        };

        try {
            const output = await plugin.terminalCommands['/planner'].run(['research', 'run', '9'], tools);
            assert.strictEqual(emitted.length, 2);
            assert.strictEqual(emitted.every(item => item.event === 'terminal-stream'), true);
            assert.match(emitted[1].payload.output, /STORY CALL 1: OUTPUT/);
            assert.match(output, /Status: completed \(published\)/);
            assert.match(output, /Calls: 9\/9/);
            assert.match(output, /ledger 1\/1/);
            assert.match(output, /research\.json/);
        } finally {
            researchAgent.runResearchAgent = originalRun;
        }
    });

    await runTestAsync('planner research show and sections print ordered research data', async () => {
        const originalLoad = researchAgent.loadLatestResearchArtifact;
        researchAgent.loadLatestResearchArtifact = async () => ({
            artifact: {
                schema: 'grand_story_research_v2',
                turnNumber: 9,
                status: 'completed',
                published: true,
                iterations: 10,
                maxIterations: 16,
                prefix: { available: true, hash: 'abc', characterCount: 120, source: 'test' },
                userContext: { historySource: 'balanced', characterCount: 80 },
                phaseConclusions: [
                    { phase: 'story', title: 'Story Research', status: 'completed', calls: 3, maxCalls: 6, conclusion: 'Story found cold promises.' },
                    { phase: 'media', title: 'Media Research', status: 'completed', calls: 2, maxCalls: 5, conclusion: 'Media found useful episode machinery.' },
                    { phase: 'room', title: "Writers' Room Advice", status: 'completed', calls: 1, maxCalls: 1, conclusion: 'Room converted research into advice.' }
                ],
                phases: {
                    story: {
                        sections: { story_state: 'Cold promises matter.' },
                        sectionOrder: [{ key: 'story_state', title: 'Story State' }]
                    },
                    media: {
                        sections: { best_references: 'FMA.' },
                        sectionOrder: [{ key: 'best_references', title: 'Best References' }]
                    }
                }
            }
        });
        try {
            const tools = {
                turnContext: { projectName: 'Test', turnNumber: 9 },
                settings: { get: () => ({}), getSelf: () => ({}) }
            };
            const show = await plugin.terminalCommands['/planner'].run(['research', 'show', 'latest'], tools);
            assert.match(show, /Phase Conclusions/);
            assert.match(show, /Story Research/);
            assert.match(show, /Story found cold promises/);
            assert.doesNotMatch(show, /"phase"/);

            const sections = await plugin.terminalCommands['/planner'].run(['research', 'sections', 'latest'], tools);
            assert.match(sections, /Grand Story Research Sections/);
            assert.match(sections, /# Story State/);
            assert.match(sections, /Cold promises matter/);
        } finally {
            researchAgent.loadLatestResearchArtifact = originalLoad;
        }
    });

    await runTestAsync('automatic post-orchestrator hook runs a due project-scoped planner job', async () => {
        const originalShouldRun = researchAgent.shouldRunAutomatically;
        const originalRun = researchAgent.runResearchAgent;
        let jobOptions = null;
        researchAgent.shouldRunAutomatically = async () => true;
        researchAgent.runResearchAgent = async () => ({ artifact: { status: 'completed', published: true } });
        try {
            await plugin.hooks.HOOK_POST_ORCHESTRATOR.run(
                { projectName: 'Test', turnNumber: 6 },
                {
                    settings: { get: () => ({}), getSelf: () => ({ update_interval: 5 }) },
                    logger: { runtime: () => {}, error: () => {} },
                    jobs: {
                        withJob: async (_name, options, callback) => {
                            jobOptions = options;
                            await callback({ progress: () => {} });
                        }
                    }
                }
            );
            assert.strictEqual(jobOptions.scope, 'project');
            assert.strictEqual(jobOptions.id, 'grand_story_planner_agentic_run');
        } finally {
            researchAgent.shouldRunAutomatically = originalShouldRun;
            researchAgent.runResearchAgent = originalRun;
        }
    });

    await runTestAsync('published research artifacts inject compact Director and Writer cards with CoT steps', async () => {
        const originalPlan = logic.getOrInitializePlan;
        const originalLoad = researchAgent.loadLatestPublishedResearchArtifact;
        const injections = [];
        const directorCot = [];
        const writerCot = [];
        logic.getOrInitializePlan = async () => '';
        researchAgent.loadLatestPublishedResearchArtifact = async () => ({
            artifact: {
                turnNumber: 5,
                published: true,
                phases: {
                    story: {
                        sections: {
                            story_state: 'The story is emotionally safe but structurally soft.',
                            player_alignment_taste: 'The player follows intimate domestic beats but avoids old threat hooks.',
                            cold_story_discoveries: 'The old key and river promise can return.',
                            repetitive_bad_writing: 'Avoid another gratitude speech.',
                            cliches_identified: 'Do not repeat guardian-shield monologues.'
                        },
                        sectionOrder: []
                    },
                    media: {
                        sections: {
                            focus_on_a_single_chapter_what_can_we_learn_and_apply_so_a_single_chapter_can_feel_as_good_as_these_episodes_what_is_the_beat_map: 'Use ordinary task, middle complication, changed behavior.'
                        },
                        sectionOrder: []
                    },
                    room: {
                        sections: {
                            immediate_chapter_craft: 'Let the boutique task expose pressure without speeches.',
                            reference_mechanisms_to_steal: 'Make the middle beat change what someone wants.',
                            character_specific_advice: 'Give Candace a private want and Dehya a choice.'
                        },
                        sectionOrder: []
                    },
                    plan: {
                        sections: {
                            grand_plan: 'Move from comfort into consequence.',
                            immediate_next_chapters: 'Use Chiori boutique as texture and social pressure.',
                            medium_term_direction: 'Bring the old promise back indirectly.',
                            long_term_direction: 'Build toward consequences without forcing the player.',
                            cliches_not_to_do: 'No more “you taught me to live” declarations.',
                            character_specific_guidance: 'Let companions initiate.'
                        },
                        sectionOrder: []
                    }
                },
                ledger: {
                    operations: 'INSERT [MYST-001] | Span: Turns 6-12 | Content: Mystery: river promise. Slowly build through missing objects. Do not reveal the cause until the player returns to the river.'
                }
            }
        });
        try {
            const turnContext = { projectName: 'Test', turnNumber: 6, processed: {}, runtime: {} };
            await plugin.hooks.HOOK_PRE_ORCHESTRATOR.run(
                turnContext,
                {
                    settings: { get: () => ({}), getSelf: () => ({}) },
                    project: { getChatPluginStorage: () => ({ absolutePath: '.', relativePath: '.' }) },
                    prompt: {
                        wrap: (tag, content) => `<${tag}>${content}</${tag}>`,
                        inject: (slot, content, pillar) => injections.push({ slot, content, pillar })
                    },
                    director: { cot: { add: config => directorCot.push(config) } },
                    writer: { cot: { add: config => writerCot.push(config) } },
                    logger: { log: () => {}, error: () => {} }
                }
            );
            assert.ok(injections.some(item => item.pillar === 'director' && item.slot === 'simulation' && /grand_planner_director_card/.test(item.content)));
            assert.ok(injections.some(item => item.pillar === 'writer' && item.slot === 'directives' && /grand_planner_writer_card/.test(item.content)));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.story_state' && item.step === '20'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.player_alignment' && item.step === '21'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.cold_discoveries' && item.step === '22'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.quality_risks' && item.step === '23'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.character_pressure' && item.step === '24'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.strategic_direction' && item.step === '25'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.mystery_guardrails' && item.step === '26'));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.routing_check' && item.step === '27'));
            assert.strictEqual(writerCot.length, 1);
            assert.match(writerCot[0].content, /Grand Planner - Anti-Cliche Guard/);
            assert.match(writerCot[0].content, /Grand Planner - Scene Craft Pattern/);
        } finally {
            logic.getOrInitializePlan = originalPlan;
            researchAgent.loadLatestPublishedResearchArtifact = originalLoad;
        }
    });

    await runTestAsync('ledger-only Director guidance uses structured CoT patch instead of legacy Step 1000 path', async () => {
        const originalPlan = logic.getOrInitializePlan;
        const originalLoad = researchAgent.loadLatestPublishedResearchArtifact;
        const directorCot = [];
        const injections = [];
        logic.getOrInitializePlan = async () => '[SHORT-001] | Span: Turns 6-8 | Content: Keep the current scene moving without forcing the player.';
        researchAgent.loadLatestPublishedResearchArtifact = async () => null;
        try {
            const turnContext = { projectName: 'Test', turnNumber: 6, processed: {}, runtime: {} };
            await plugin.hooks.HOOK_PRE_ORCHESTRATOR.run(
                turnContext,
                {
                    settings: { get: () => ({}), getSelf: () => ({}) },
                    project: { getChatPluginStorage: () => ({ absolutePath: '.', relativePath: '.' }) },
                    prompt: {
                        wrap: (tag, content) => `<${tag}>${content}</${tag}>`,
                        inject: (slot, content, pillar) => injections.push({ slot, content, pillar })
                    },
                    director: { cot: { add: config => directorCot.push(config) } },
                    logger: { log: () => {}, error: () => {} }
                }
            );
            assert.ok(injections.some(item => item.pillar === 'director' && item.slot === 'simulation' && /grand_story_execution_brief/.test(item.content)));
            assert.ok(directorCot.some(item => item.id === 'grand_planner.ledger_integration' && item.step === '19'));
            assert.strictEqual(turnContext.runtime?.director?.cotSteps, undefined);
            assert.doesNotMatch(JSON.stringify(directorCot), /GRAND STORY PLAN INTEGRATION/);
        } finally {
            logic.getOrInitializePlan = originalPlan;
            researchAgent.loadLatestPublishedResearchArtifact = originalLoad;
        }
    });
})();
