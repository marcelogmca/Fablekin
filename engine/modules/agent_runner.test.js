const assert = require('assert');
const {
    startAgent,
    createDummyAgentTools
} = require('./agent_runner.js');
const { buildTools } = require('./plugin_manager/runtime/tools_builder.js');

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

function makePluginManager() {
    return {
        projectRoot: 'C:\\tmp',
        repoRoot: 'C:\\tmp',
        staticDataManager: {
            projectName: 'AgentTest',
            projectRootDirectory: 'C:\\tmp'
        },
        plugins: new Map(),
        registeredRoutes: new Set(),
        io: { emit: () => {}, to: () => ({ emit: () => {} }) }
    };
}

function makeTurnContext() {
    return {
        projectName: 'AgentTest',
        turnNumber: 1,
        rootDirectory: 'C:\\tmp',
        runtime: { rootDirectory: 'C:\\tmp' },
        input: {},
        processed: {},
        output: {}
    };
}

(async () => {
    await runTestAsync('storypgrep dummy tool returns placeholder matches', async () => {
        const tools = createDummyAgentTools();
        const result = await tools.storypgrep.execute({ query: 'Crimson Gate' });

        assert.deepStrictEqual(result, {
            placeholder: true,
            query: 'Crimson Gate',
            matches: []
        });
    });

    await runTestAsync('runs tool-call then final-answer flow', async () => {
        const calls = [
            { type: 'tool_call', tool: 'storypgrep', args: { query: 'Crimson Gate' } },
            { type: 'final', answer: 'No prior matches found.' }
        ];

        const result = await startAgent({
            context: [{ role: 'user', content: 'Search for the Crimson Gate.' }],
            toolsAllowed: ['storypgrep'],
            maxIterations: 3,
            callModel: async () => ({ content: calls.shift() })
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, 'No prior matches found.');
        assert.strictEqual(result.iterations, 2);
        assert.strictEqual(result.trace.length, 1);
        assert.strictEqual(result.trace[0].observation.placeholder, true);
        assert.strictEqual(result.trace[0].observation.query, 'Crimson Gate');
    });

    await runTestAsync('rejects disallowed tool calls', async () => {
        const result = await startAgent({
            context: [{ role: 'user', content: 'Search.' }],
            toolsAllowed: ['not_storypgrep'],
            callModel: async () => ({
                content: { type: 'tool_call', tool: 'storypgrep', args: { query: 'x' } }
            })
        });

        assert.strictEqual(result.status, 'error');
        assert.match(result.error, /not allowed/);
    });

    await runTestAsync('returns max_iterations when the model keeps calling tools', async () => {
        const result = await startAgent({
            context: [{ role: 'user', content: 'Keep searching.' }],
            toolsAllowed: ['storypgrep'],
            maxIterations: 1,
            callModel: async () => ({
                content: { type: 'tool_call', tool: 'storypgrep', args: { query: 'loop' } }
            })
        });

        assert.strictEqual(result.status, 'max_iterations');
        assert.strictEqual(result.iterations, 1);
        assert.strictEqual(result.trace.length, 1);
    });

    await runTestAsync('returns token_budget_exceeded before calling the model', async () => {
        let callCount = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'x'.repeat(1000) }],
            tokenBudget: 10,
            callModel: async () => {
                callCount++;
                return { content: { type: 'final', answer: 'should not happen' } };
            }
        });

        assert.strictEqual(result.status, 'token_budget_exceeded');
        assert.strictEqual(callCount, 0);
    });

    await runTestAsync('plugin toolkit exposes agent startAgent', async () => {
        const tools = buildTools(makePluginManager(), 'agent_test', makeTurnContext());
        assert.strictEqual(typeof tools.agent.startAgent, 'function');
        assert.strictEqual(typeof tools.agent.defineTool, 'function');
        assert.strictEqual(typeof tools.agent.createDummyTools, 'function');

        const result = await tools.agent.startAgent({
            context: [{ role: 'user', content: 'Finish.' }],
            callModel: async () => ({ content: { type: 'final', answer: 'done' } })
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, 'done');
    });

    await runTestAsync('plugin toolkit agent bridge does not force JSON parsing', async () => {
        const tools = buildTools(makePluginManager(), 'agent_test', makeTurnContext());
        const llmModule = require('./llm.js');
        const originalCallLLM = llmModule.callLLM;
        llmModule.callLLM = async options => {
            const { PreparedPrompt } = require('./prompt/prompt.js');
            assert.ok(options.prompt instanceof PreparedPrompt);
            assert.strictEqual(options.prompt.manifest.rolePolicy, 'agent');
            assert.strictEqual(options.prompt.messages.at(-1).role, 'system');
            assert.match(options.prompt.messages.at(-1).content, /FINAL ITERATION/);
            assert.ok(options.prompt.manifest.occurrences.every(item =>
                options.prompt.manifest.components[item.componentId].owner === 'agent_test'));
            assert.strictEqual(options.expectJson, false);
            assert.strictEqual(typeof options.validateFn, 'function');
            await options.validateFn('## Research Dossier\n\nUseful markdown final answer.');
            return { content: '## Research Dossier\n\nUseful markdown final answer.', model: 'test-model' };
        };
        try {
            const result = await tools.agent.startAgent({
                context: [{ role: 'user', content: 'Return a markdown dossier.' }],
                maxIterations: 1,
                llm: { model: 'test-model', provider: 'test-provider' }
            });

            assert.strictEqual(result.status, 'completed');
            assert.match(result.final, /Research Dossier/);
        } finally {
            llmModule.callLLM = originalCallLLM;
        }
    });

    await runTestAsync('keeps cached prefix first and redacts it from model request events', async () => {
        const seenCalls = [];
        const events = [];
        const prefixContext = [
            { role: 'system', content: 'large shared prefix' },
            { role: 'user', content: 'shared narrative foundation' }
        ];

        const result = await startAgent({
            prefixContext,
            prefixMetadata: { hash: 'prefix123', characterCount: 44 },
            context: [{ role: 'system', content: 'research task' }],
            maxIterations: 2,
            onEvent: async event => events.push(event),
            callModel: async ({ messages }) => {
                seenCalls.push(messages);
                return { content: { type: 'final', answer: 'brief' } };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.deepStrictEqual(seenCalls[0].slice(0, 2), prefixContext);
        const requestEvent = events.find(event => event.type === 'model_request');
        assert.strictEqual(requestEvent.prefixOmitted.hash, 'prefix123');
        assert.strictEqual(requestEvent.messages.some(message => message.content === 'large shared prefix'), false);
        assert.strictEqual(requestEvent.messages.some(message => message.content === 'research task'), true);
    });

    await runTestAsync('runs a no-tools finalization call after a draft final answer', async () => {
        const calls = [];
        const events = [];
        const result = await startAgent({
            prefixContext: [{ role: 'system', content: 'cached foundation' }],
            context: [{ role: 'user', content: 'Research.' }],
            maxIterations: 3,
            phase: 'story',
            finalizeInstruction: 'Return the Story Research dossier only.',
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => ({ evidence: true })
                }
            },
            toolsAllowed: ['inspect'],
            onEvent: async event => events.push(event),
            callModel: async ({ messages }) => {
                calls.push(messages);
                return calls.length === 1
                    ? { content: { type: 'final', answer: 'draft dossier' } }
                    : { content: 'finalized dossier' };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, 'finalized dossier');
        assert.strictEqual(result.iterations, 2);
        assert.match(calls[1].map(message => message.content).join('\n'), /FINALIZATION TASK/);
        assert.match(calls[1].map(message => message.content).join('\n'), /draft dossier/);
        assert.match(calls[1][1].content, /Available tools:\n\[\]/);
        assert.strictEqual(events.some(event => event.type === 'model_request' && event.finalization === true), true);
    });

    await runTestAsync('marks the final allowed model call as final-only', async () => {
        const calls = [];
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research.' }],
            maxIterations: 2,
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => ({ evidence: true })
                }
            },
            toolsAllowed: ['inspect'],
            callModel: async ({ messages }) => {
                calls.push(messages);
                return calls.length === 1
                    ? { content: { type: 'tool_call', tool: 'inspect', args: {} } }
                    : { content: { type: 'final', answer: 'finished' } };
            }
        });

        assert.strictEqual(result.iterations, 2);
        assert.match(calls[1][calls[1].length - 1].content, /FINAL ITERATION/);
        assert.match(calls[1].map(message => message.content).join('\n'), /TOOL OBSERVATION/);
    });

    await runTestAsync('forces synthesis after the research window is exhausted', async () => {
        let calls = 0;
        let executions = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research and conclude.' }],
            maxIterations: 2,
            forceFinalAfterMax: true,
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => {
                        executions++;
                        return { evidence: true };
                    }
                }
            },
            toolsAllowed: ['inspect'],
            callModel: async () => {
                calls++;
                return calls <= 2
                    ? { content: { type: 'tool_call', tool: 'inspect', args: {} } }
                    : { content: { type: 'final', answer: 'Synthesis from gathered evidence.' } };
            }
        });

        assert.strictEqual(calls, 3);
        assert.strictEqual(executions, 1);
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.forcedConclusion, true);
        assert.strictEqual(result.final, 'Synthesis from gathered evidence.');
    });

    await runTestAsync('does not exceed a hard iteration ceiling for forced conclusions', async () => {
        let calls = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research and conclude.' }],
            maxIterations: 2,
            forceFinalAfterMax: true,
            hardIterationLimit: true,
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => ({ evidence: true })
                }
            },
            toolsAllowed: ['inspect'],
            callModel: async () => {
                calls++;
                return { content: { type: 'tool_call', tool: 'inspect', args: {} } };
            }
        });

        assert.strictEqual(calls, 2);
        assert.strictEqual(result.status, 'error');
        assert.match(result.error, /final agent iteration/i);
    });

    await runTestAsync('can reject a final-iteration tool call and ask for a real final correction', async () => {
        let calls = 0;
        const events = [];
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research and conclude.' }],
            maxIterations: 2,
            forceFinalAfterMax: true,
            hardIterationLimit: true,
            forceFinalCorrectionOnMax: true,
            phase: 'story',
            onEvent: async event => events.push(event),
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => ({ output: 'Earlier evidence about an old promise.' })
                }
            },
            toolsAllowed: ['inspect'],
            callModel: async ({ messages }) => {
                calls++;
                if (calls <= 2) {
                    return { content: { type: 'tool_call', tool: 'inspect', args: { command: calls === 1 ? 'turn 60' : 'turn 63' } } };
                }
                assert.match(messages.map(message => message.content).join('\n'), /FINAL ACTION REJECTED/);
                assert.match(messages.map(message => message.content).join('\n'), /Do not call tools/);
                return { content: 'Final dossier written by the model from existing evidence.' };
            }
        });

        assert.strictEqual(calls, 3);
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.forcedConclusion, true);
        assert.match(result.final, /Final dossier written by the model/);
        assert.strictEqual(events.some(event => event.type === 'completed' && event.forcedConclusion === true), true);
    });

    await runTestAsync('waits between tool iterations for cache propagation', async () => {
        const events = [];
        let calls = 0;
        const started = Date.now();
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research.' }],
            maxIterations: 2,
            interIterationDelayMs: 15,
            onEvent: async event => events.push(event),
            tools: {
                inspect: {
                    name: 'inspect',
                    description: 'Inspect.',
                    schema: { type: 'object', properties: {} },
                    execute: async () => ({ evidence: true })
                }
            },
            toolsAllowed: ['inspect'],
            callModel: async () => {
                calls++;
                return calls === 1
                    ? { content: { type: 'tool_call', tool: 'inspect', args: {} } }
                    : { content: { type: 'final', answer: 'finished' } };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.ok(Date.now() - started >= 10);
        assert.strictEqual(events.some(event => event.type === 'cache_wait' && event.delayMs === 15), true);
    });

    await runTestAsync('forwards native JSON response format to the LLM request', async () => {
        let requestOptions = null;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research.' }],
            maxIterations: 1,
            llm: {
                model: 'test-model',
                provider: 'test-provider',
                response_format: { type: 'json_object' }
            },
            callLLM: async options => {
                requestOptions = options;
                assert.strictEqual(options.prompt.manifest.rolePolicy, 'agent');
                assert.strictEqual(options.prompt.messages.at(-1).role, 'system');
                return { content: { type: 'final', answer: 'finished' } };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.deepStrictEqual(requestOptions.extra.response_format, { type: 'json_object' });
        assert.strictEqual(requestOptions.expectJson, false);
        assert.strictEqual(typeof requestOptions.validateFn, 'function');
        assert.strictEqual(await requestOptions.validateFn({ answer: 'missing type' }), true);
        await assert.rejects(
            () => requestOptions.validateFn({ type: 42, answer: 'invalid type' }),
            /type must be a string/
        );
        assert.strictEqual(await requestOptions.validateFn({ type: 'final', answer: 'valid' }), true);
    });

    await runTestAsync('accepts plain markdown final answers without provider JSON parsing', async () => {
        let requestOptions = null;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Return a research dossier.' }],
            maxIterations: 1,
            llm: { model: 'test-model', provider: 'test-provider' },
            callLLM: async options => {
                requestOptions = options;
                await options.validateFn('## Phase 2 Research Dossier\n\nUseful natural-language findings.');
                return { content: '## Phase 2 Research Dossier\n\nUseful natural-language findings.' };
            }
        });

        assert.strictEqual(requestOptions.expectJson, false);
        assert.strictEqual(result.status, 'completed');
        assert.match(result.final, /Phase 2 Research Dossier/);
    });

    await runTestAsync('parses JSON string tool calls while allowing plain final text', async () => {
        const calls = [
            '{"type":"tool_call","tool":"storypgrep","args":{"query":"old promise"}}',
            '## Final Dossier\n\nThe old promise can return.'
        ];
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research.' }],
            maxIterations: 2,
            toolsAllowed: ['storypgrep'],
            callModel: async ({ expectJson }) => {
                assert.strictEqual(expectJson, false);
                return { content: calls.shift() };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.match(result.final, /Final Dossier/);
        assert.strictEqual(result.trace[0].action.type, 'tool_call');
        assert.strictEqual(result.trace[0].observation.query, 'old promise');
    });

    await runTestAsync('joins a missing-type JSON array into a recoverable final answer', async () => {
        const result = await startAgent({
            context: [{ role: 'user', content: 'Return the memo.' }],
            maxIterations: 1,
            callModel: async () => ({
                content: ['## Rolling Editorial Dossier', 0, 'Useful analysis.']
            })
        });
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, '## Rolling Editorial Dossier\n\nUseful analysis.');
    });

    await runTestAsync('lets callLLM retry protocol-invalid JSON before returning it', async () => {
        let attempts = 0;
        const outputs = [
            { type: 42, answer: 'invalid typed envelope' },
            { type: 'final', answer: 'recovered' }
        ];
        const result = await startAgent({
            context: [{ role: 'user', content: 'Finish in the protocol.' }],
            maxIterations: 1,
            llm: { model: 'test-model', provider: 'test-provider', retries: 1 },
            callLLM: async options => {
                while (outputs.length > 0) {
                    attempts++;
                    const content = outputs.shift();
                    try {
                        await options.validateFn(content);
                        return { content };
                    } catch (error) {
                        if (outputs.length === 0) throw error;
                    }
                }
                throw new Error('No output.');
            }
        });

        assert.strictEqual(attempts, 2);
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, 'recovered');
    });

    await runTestAsync('rejects continuation content that embeds a tool call envelope', async () => {
        let attempts = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Research with tools.' }],
            maxIterations: 3,
            allowContinue: true,
            toolsAllowed: ['storypgrep'],
            llm: { model: 'test-model', provider: 'test-provider', retries: 1 },
            callLLM: async options => {
                attempts++;
                const content = attempts === 1
                    ? {
                        type: 'continue',
                        content: 'I should search now.\n\n{"type":"tool_call","tool":"storypgrep","args":{"query":"Mira"}}'
                    }
                    : (attempts === 2
                        ? { type: 'tool_call', tool: 'storypgrep', args: { query: 'Mira' } }
                        : { type: 'final', answer: 'Mira evidence reviewed.' });
                await options.validateFn(content);
                return { content };
            }
        });

        assert.strictEqual(attempts, 3);
        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.final, 'Mira evidence reviewed.');
        assert.match(result.trace[0].rejectionReason, /embedded AgentRunner control action/);
        const toolTrace = result.trace.find(entry => entry.action?.type === 'tool_call');
        assert.strictEqual(toolTrace.observation.query, 'Mira');
    });

    await runTestAsync('rejects continuation content that drifts into Director or Writer output', async () => {
        let attempts = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Run the room pass.' }],
            maxIterations: 3,
            allowContinue: true,
            llm: { model: 'test-model', provider: 'test-provider', retries: 1 },
            callLLM: async options => {
                attempts++;
                const content = attempts === 1
                    ? { type: 'continue', content: '## Writer Brief\nMake the next scene warm and playful.' }
                    : { type: 'final', answer: 'Room recommendation without role-output sections.' };
                await options.validateFn(content);
                return { content };
            }
        });

        assert.strictEqual(attempts, 2);
        assert.strictEqual(result.status, 'completed');
        assert.match(result.trace[0].rejectionReason, /Director\/Writer output sections/);
        assert.match(result.final, /Room recommendation/);
    });

    await runTestAsync('rejects role-wrong final content and requests a corrected conclusion', async () => {
        let calls = 0;
        const events = [];
        const result = await startAgent({
            context: [{ role: 'user', content: 'Return analysis, not prose.' }],
            maxIterations: 3,
            allowContinue: true,
            validateFinal: answer => answer.startsWith('Chapter 64:')
                ? 'This is scene prose, not analysis.'
                : true,
            onEvent: async event => events.push(event),
            callModel: async () => {
                calls++;
                return calls === 1
                    ? { content: { type: 'final', answer: 'Chapter 64: copied scene prose' } }
                    : { content: { type: 'final', answer: 'The recent chapters repeat consequence-free reassurance.' } };
            }
        });

        assert.strictEqual(calls, 2);
        assert.strictEqual(result.status, 'completed');
        assert.match(result.final, /consequence-free reassurance/);
        assert.strictEqual(events.some(event => event.type === 'final_rejected'), true);
    });

    await runTestAsync('carries continuation output into the next append-only round', async () => {
        const calls = [];
        const events = [];
        const result = await startAgent({
            prefixContext: [{ role: 'system', content: 'cached foundation' }],
            context: [{ role: 'user', content: 'Run the room.' }],
            requiredIterations: 2,
            allowContinue: true,
            phase: 'writers_room',
            iterationInstructions: ['Diagnose.', 'Conclude.'],
            onEvent: async event => events.push(event),
            callModel: async ({ messages }) => {
                calls.push(messages);
                return calls.length === 1
                    ? { content: { type: 'continue', content: 'The middle is repetitive.' } }
                    : { content: { type: 'final', answer: 'Break the repeated rhythm.' } };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.iterations, 2);
        assert.strictEqual(calls[0][0].content, 'cached foundation');
        assert.deepStrictEqual(calls[1].slice(0, calls[0].length), calls[0]);
        assert.match(calls[1].map(message => message.content).join('\n'), /The middle is repetitive/);
        assert.strictEqual(events.some(event => event.type === 'continuation' && event.phase === 'writers_room'), true);
    });

    await runTestAsync('coerces an early final into continuation until required rounds finish', async () => {
        let calls = 0;
        const result = await startAgent({
            context: [{ role: 'user', content: 'Keep reassessing.' }],
            requiredIterations: 2,
            callModel: async () => {
                calls++;
                return { content: { type: 'final', answer: calls === 1 ? 'Too early.' : 'Actually final.' } };
            }
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.iterations, 2);
        assert.strictEqual(result.final, 'Actually final.');
        assert.strictEqual(result.trace[0].action.type, 'continue');
    });

    await runTestAsync('honors an explicitly empty tool allowlist', async () => {
        let protocol = '';
        const result = await startAgent({
            context: [{ role: 'user', content: 'Reflect without tools.' }],
            tools: {},
            toolsAllowed: [],
            maxIterations: 1,
            callModel: async ({ messages }) => {
                protocol = messages[0].content;
                return { content: { type: 'final', answer: 'done' } };
            }
        });
        assert.strictEqual(result.status, 'completed');
        assert.match(protocol, /Available tools:\n\[\]/);
    });
})();
