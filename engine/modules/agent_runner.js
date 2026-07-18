const { callLLM, repairJson, resolveModelAlias } = require('./llm.js');
const { TurnLogger } = require('./utils.js');
const { runWithDiagnosticContext } = require('./diagnostic_context.js');

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_CALLING_MODULE = 'AgentRunner';
const VALID_ROLES = new Set(['system', 'assistant', 'user']);

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

function estimateMessagesTokens(messages) {
    return estimateTokens(JSON.stringify(messages || []));
}

function normalizeMessages(context) {
    if (!Array.isArray(context)) {
        throw new Error('startAgent requires context to be an array of messages.');
    }

    return context.map((message, index) => {
        const role = String(message?.role || '').trim().toLowerCase();
        if (!VALID_ROLES.has(role)) {
            throw new Error(`Invalid agent context role at index ${index}: ${message?.role}`);
        }
        return {
            role,
            content: String(message?.content ?? '')
        };
    });
}

function normalizeToolName(name) {
    return String(name || '').trim();
}

function defineAgentTool(config = {}) {
    const name = normalizeToolName(config.name);
    const description = String(config.description || '').trim();
    const schema = config.schema && typeof config.schema === 'object'
        ? config.schema
        : { type: 'object', properties: {} };

    if (typeof config.execute !== 'function') {
        throw new Error(`Agent tool '${name || '(unnamed)'}' requires an execute function.`);
    }

    return {
        name,
        description,
        schema,
        execute: config.execute
    };
}

function createDummyAgentTools() {
    return {
        storypgrep: defineAgentTool({
            name: 'storypgrep',
            description: 'Placeholder story text search. It accepts a query and returns no matches.',
            schema: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' }
                }
            },
            execute: async (args = {}) => {
                const query = typeof args.query === 'string' ? args.query : '';
                return {
                    placeholder: true,
                    query,
                    matches: []
                };
            }
        })
    };
}

function normalizeTools(tools = null) {
    const source = {
        ...createDummyAgentTools(),
        ...((tools && typeof tools === 'object') ? tools : {})
    };
    const registry = {};

    for (const [registryName, rawTool] of Object.entries(source)) {
        if (!rawTool || typeof rawTool !== 'object') continue;
        const name = normalizeToolName(rawTool.name || registryName);
        if (!name) continue;
        registry[name] = {
            ...rawTool,
            name
        };
    }

    return registry;
}

function normalizeToolsAllowed(toolsAllowed, registry) {
    const availableNames = Object.keys(registry);
    const names = Array.isArray(toolsAllowed) ? toolsAllowed : availableNames;

    return new Set(
        names
            .map(normalizeToolName)
            .filter(name => name && registry[name])
    );
}

function describeTools(registry, allowedTools) {
    return Array.from(allowedTools)
        .map(name => {
            const tool = registry[name];
            return {
                name,
                description: tool.description || '',
                schema: tool.schema || { type: 'object', properties: {} }
            };
        });
}

function buildProtocolMessage(registry, allowedTools, maxIterations, allowContinue) {
    const toolDescriptions = describeTools(registry, allowedTools);
    const instructions = [
        'You are running inside Fablekin AgentRunner.',
        'This AgentRunner protocol and the current task after it override any earlier cached agent-role instructions.',
        'Use a compact ReAct loop: reason privately, then choose exactly one next action.',
        'Tool observations are authoritative evidence. Use another tool only when it materially reduces uncertainty.',
        `You have at most ${maxIterations} total model calls, including your final answer. Finish as soon as you have enough evidence.`,
        'Use JSON only for control actions. Natural-language final answers may be plain text or Markdown.',
        'To use a tool, reply with exactly one JSON object: {"type":"tool_call","tool":"tool_name","args":{...}}'
    ];
    if (allowContinue) {
        instructions.push('To preserve useful working conclusions and continue reflecting, reply with exactly one JSON object: {"type":"continue","content":"natural-language working output"}');
    }
    instructions.push(
        'To finish, either reply directly with the natural-language answer, or use JSON: {"type":"final","answer":"your answer"}',
        'Available tools:',
        JSON.stringify(toolDescriptions)
    );
    return {
        role: 'system',
        content: instructions.join('\n')
    };
}

async function emitAgentEvent(options, event) {
    if (typeof options.onEvent !== 'function') return;
    try {
        await options.onEvent(event);
    } catch {
        // Diagnostic consumers must not be able to break an agent run.
    }
}

function looksLikeJsonEnvelope(text) {
    return /^[\s`]*(?:json\s*)?[\[{]/i.test(String(text || ''));
}

function containsEmbeddedControlEnvelope(text) {
    const source = String(text || '');
    if (!source) return false;
    return /["']type["']\s*:\s*["'](?:tool_call|continue|final)["']/.test(source)
        || /\{\s*["'](?:tool|name)["']\s*:\s*["'][^"']+["']/.test(source);
}

function containsScratchpadContinuation(text) {
    return /(?:^|\n)\s*(?:---\s*)?(?:scratchpad|private reasoning|chain[- ]of[- ]thought|hidden reasoning)(?:\s*---)?\s*(?:\n|$|:)/i
        .test(String(text || ''));
}

function containsRoleOutputContinuation(text) {
    return /(?:^|\n)\s*(?:#{1,6}\s*)?(?:director[_ ]brief|writer[_ ]brief|director[_ ]notes|writer[_ ]directives|scene[_ ]plan|monologue|chapter output|assistant response)\b\s*:?\s*(?:\n|$)/i
        .test(String(text || ''));
}

function normalizeAction(content) {
    if (typeof content === 'string') {
        const text = content.trim();
        if (!text) throw new Error('Agent response was empty.');
        if (looksLikeJsonEnvelope(text)) {
            try {
                return normalizeAction(repairJson(text));
            } catch {
                // Fall through: a markdown final answer can legitimately start with punctuation.
            }
        }
        return {
            type: 'final',
            answer: content,
            coerced: true,
            coercionReason: 'plain text inferred as final answer'
        };
    }

    const action = content && typeof content === 'object' ? content : null;
    if (!action) {
        throw new Error('Agent response must be a JSON object with a string type.');
    }

    if (typeof action.type !== 'string') {
        if (Object.prototype.hasOwnProperty.call(action, 'type')) {
            throw new Error('Agent response type must be a string.');
        }
        if (typeof action.tool === 'string' || typeof action.name === 'string') {
            return {
                type: 'tool_call',
                tool: normalizeToolName(action.tool || action.name),
                args: action.args && typeof action.args === 'object' && !Array.isArray(action.args)
                    ? action.args
                    : (action.arguments && typeof action.arguments === 'object' && !Array.isArray(action.arguments)
                        ? action.arguments
                        : {}),
                coerced: true,
                coercionReason: 'missing type; inferred tool_call'
            };
        }
        const answer = action.answer ?? action.final ?? action.output ?? action.content;
        const inferredAnswer = Array.isArray(action)
            ? action.filter(value => typeof value === 'string').join('\n\n')
            : (typeof answer === 'string' ? answer : JSON.stringify(answer ?? action, null, 2));
        return {
            type: 'final',
            answer: inferredAnswer,
            coerced: true,
            coercionReason: 'missing type; inferred final answer'
        };
    }

    const type = action.type.trim();
    if (type === 'final') {
        return {
            type,
            answer: String(action.answer ?? '')
        };
    }

    if (type === 'tool_call') {
        return {
            type,
            tool: normalizeToolName(action.tool),
            args: action.args && typeof action.args === 'object' && !Array.isArray(action.args)
                ? action.args
                : {}
        };
    }

    if (type === 'continue') {
        return {
            type,
            content: String(action.content ?? '')
        };
    }

    throw new Error(`Unsupported agent action type: ${type}`);
}

async function callAgentModel(messages, options) {
    if (typeof options.callModel === 'function') {
        const result = await options.callModel({
            messages,
            llm: options.llm || {},
            expectJson: false,
            validateAction: options.validateAction,
            iteration: options.iteration
        });
        return result && Object.prototype.hasOwnProperty.call(result, 'content')
            ? result
            : { content: result };
    }

    const llm = options.llm || {};
    const extra = { ...(llm.extra || {}) };
    if (llm.temperature !== undefined) extra.temperature = llm.temperature;
    if (llm.response_format !== undefined) extra.response_format = llm.response_format;

    const title = llm.logTitle || llm.title || llm.callingModule || DEFAULT_CALLING_MODULE;
    return await runWithDiagnosticContext({
        executionLane: 'core',
        phase: 'Agent',
        component: 'AgentRunner',
        taskKey: String(title || DEFAULT_CALLING_MODULE),
        blocking: llm.blocking !== false
    }, async () => {
        const route = llm.model && typeof options.callLLM !== 'function'
            ? resolveModelAlias(llm.model)
            : null;
        const loggedModel = route?.model || llm.model;
        const loggedProvider = route?.provider || llm.provider;
        TurnLogger.logRequest(title, messages, loggedModel, loggedProvider);
        const llmCall = typeof options.callLLM === 'function' ? options.callLLM : callLLM;
        const response = await llmCall({
            messages,
            model: llm.model,
            retries: llm.retries ?? 1,
            timeout: llm.timeout ?? 60000,
            extra,
            expectJson: false,
            validateFn: options.validateAction,
            callingModule: llm.callingModule || DEFAULT_CALLING_MODULE,
            turnLogTitle: title
        });
        TurnLogger.logResponse(title, {
            ...response,
            model: response?.model || loggedModel,
            provider: response?.provider || loggedProvider
        });
        return response;
    });
}

function makeResult(status, details = {}) {
    return {
        status,
        final: details.final ?? null,
        iterations: details.iterations ?? 0,
        trace: details.trace || [],
        messages: details.messages || [],
        error: details.error || null,
        forcedConclusion: details.forcedConclusion === true
    };
}

function normalizeIterationInstructions(value) {
    if (!Array.isArray(value)) return [];
    return value.map(instruction => String(instruction || '').trim());
}

async function waitForNextIteration(options, iteration, delayMs) {
    if (delayMs <= 0) return;
    await emitAgentEvent(options, {
        type: 'cache_wait',
        phase: options.phase || null,
        iteration,
        delayMs
    });
    await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function validateFinalAnswer(options, answer, details = {}) {
    if (typeof options.validateFinal !== 'function') return null;
    try {
        const validation = await options.validateFinal(answer, details);
        if (validation === false) return 'Final answer did not satisfy phase requirements.';
        if (typeof validation === 'string' && validation.trim()) return validation.trim();
        return null;
    } catch (error) {
        return error.message || 'Final answer validation failed.';
    }
}

function isRecoverableAgentResponseError(error) {
    return /failed to parse json|custom validation failed|agent response|final answer|unsupported agent action|recovery conclusion|embedded AgentRunner control action|continuation content contains|continuation content resembles|continuation content is too long/i
        .test(String(error?.message || ''));
}

async function startAgent(options = {}) {
    const trace = [];
    let messages = [];
    let prefixMessages = [];

    try {
        messages = normalizeMessages(options.context || []);
        prefixMessages = normalizeMessages(options.prefixContext || []);
        const registry = normalizeTools(options.tools);
        const allowedTools = normalizeToolsAllowed(options.toolsAllowed, registry);
        const configuredMax = Math.max(1, Number.parseInt(options.maxIterations ?? DEFAULT_MAX_ITERATIONS, 10) || DEFAULT_MAX_ITERATIONS);
        const requiredIterations = Math.max(0, Number.parseInt(options.requiredIterations ?? 0, 10) || 0);
        const maxIterations = requiredIterations > 0 ? requiredIterations : configuredMax;
        const minimumIterations = Math.min(
            maxIterations,
            Math.max(1, Number.parseInt(options.minimumIterations ?? (requiredIterations || 1), 10) || 1)
        );
        const allowContinue = options.allowContinue === false
            ? false
            : (options.allowContinue === true || minimumIterations > 1);
        const continuationMaxChars = Math.max(
            0,
            Number.parseInt(options.maxContinuationChars ?? 0, 10) || 0
        );
        const iterationInstructions = normalizeIterationInstructions(options.iterationInstructions);
        const phase = String(options.phase || '').trim() || null;
        const finalizeInstruction = String(options.finalizeInstruction || '').trim();
        const hardIterationLimit = options.hardIterationLimit === true;
        const interIterationDelayMs = Math.max(
            0,
            Math.min(30000, Number.parseInt(options.interIterationDelayMs ?? 0, 10) || 0)
        );
        const tokenBudget = Number.isFinite(Number(options.tokenBudget)) ? Number(options.tokenBudget) : null;
        const protocolMessage = buildProtocolMessage(registry, allowedTools, maxIterations, allowContinue);
        const prefixMetadata = {
            ...((options.prefixMetadata && typeof options.prefixMetadata === 'object') ? options.prefixMetadata : {}),
            hash: options.prefixMetadata?.hash || null,
            characterCount: options.prefixMetadata?.characterCount
                ?? prefixMessages.reduce((sum, message) => sum + message.content.length, 0),
            messageCount: prefixMessages.length
        };

        const runFinalizationCall = async ({ iteration, forcedConclusion = false, reason = '' }) => {
            const finalizationProtocol = buildProtocolMessage(registry, new Set(), 1, false);
            const instructionParts = [];
            if (reason) instructionParts.push(reason);
            instructionParts.push(
                'FINALIZATION TASK:',
                finalizeInstruction || 'Use only the evidence already present in this conversation. Return the requested final answer now.'
            );
            const finalizationInstruction = {
                role: 'user',
                content: instructionParts.join('\n\n')
            };
            const finalizationSystem = {
                role: 'system',
                content: 'FINALIZATION CALL: Tools are unavailable. Do not continue. Return the requested final answer only.'
            };
            const visibleMessages = [finalizationProtocol, ...messages, finalizationInstruction, finalizationSystem];
            const callMessages = [...prefixMessages, ...visibleMessages];
            const validateFinalization = async content => {
                const candidate = normalizeAction(content);
                if (candidate.type !== 'final') throw new Error('The finalization call must return a final answer.');
                const rejectionReason = await validateFinalAnswer(options, candidate.answer, {
                    phase,
                    iteration,
                    finalIteration: true,
                    forcedConclusion,
                    finalization: true
                });
                if (rejectionReason) throw new Error(`${forcedConclusion ? 'Forced conclusion' : 'Final answer'} rejected: ${rejectionReason}`);
                return true;
            };

            await emitAgentEvent(options, {
                type: 'model_request',
                phase,
                iteration,
                maxIterations: iteration,
                finalIteration: true,
                forcedConclusion,
                finalization: true,
                prefixOmitted: prefixMetadata,
                messages: visibleMessages
            });
            const response = await callAgentModel(callMessages, {
                ...options,
                iteration,
                validateAction: validateFinalization
            });
            const finalAction = normalizeAction(response?.content);
            await emitAgentEvent(options, {
                type: 'model_response',
                phase,
                iteration,
                forcedConclusion,
                finalization: true,
                action: finalAction
            });
            if (finalAction.type !== 'final') {
                throw new Error('The finalization call must return a final answer.');
            }
            const rejectionReason = await validateFinalAnswer(options, finalAction.answer, {
                phase,
                iteration,
                finalIteration: true,
                forcedConclusion,
                finalization: true
            });
            if (rejectionReason) throw new Error(`${forcedConclusion ? 'Forced conclusion' : 'Final answer'} rejected: ${rejectionReason}`);
            messages.push({ role: 'assistant', content: JSON.stringify(finalAction) });
            await emitAgentEvent(options, {
                type: 'completed',
                phase,
                iteration,
                forcedConclusion,
                finalization: true,
                answer: finalAction.answer
            });
            return makeResult('completed', {
                final: finalAction.answer,
                iterations: iteration,
                trace,
                messages,
                forcedConclusion
            });
        };

        for (let index = 0; index < maxIterations; index++) {
            const isFinalIteration = index === maxIterations - 1;
            const iterationInstruction = iterationInstructions[index] || '';
            if (iterationInstruction) {
                messages.push({
                    role: 'user',
                    content: `ITERATION ${index + 1} TASK:\n${iterationInstruction}`
                });
            }
            const finalIterationMessage = isFinalIteration
                ? [{
                    role: 'system',
                    content: 'FINAL ITERATION: You must return a final answer now. Do not call another tool or continue.'
                }]
                : [];
            const visibleMessages = [protocolMessage, ...messages, ...finalIterationMessage];
            const callMessages = [...prefixMessages, ...visibleMessages];
            if (tokenBudget !== null && estimateMessagesTokens(callMessages) > tokenBudget) {
                return makeResult('token_budget_exceeded', {
                    iterations: index,
                    trace,
                    messages
                });
            }

            await emitAgentEvent(options, {
                type: 'model_request',
                phase,
                iteration: index + 1,
                maxIterations,
                finalIteration: isFinalIteration,
                prefixOmitted: prefixMetadata,
                messages: visibleMessages
            });

            const validateAction = async content => {
                const candidate = normalizeAction(content);
                if (candidate.type === 'continue' && !allowContinue) {
                    throw new Error('This agent run does not allow continuation outputs.');
                }
                if (candidate.type === 'continue' && containsEmbeddedControlEnvelope(candidate.content)) {
                    throw new Error('Continuation content contains an embedded AgentRunner control action. Return exactly one action: tool_call, continue, or final.');
                }
                if (candidate.type === 'continue' && containsScratchpadContinuation(candidate.content)) {
                    throw new Error('Continuation content contains scratchpad or hidden reasoning text. Reason privately and return compact working notes only.');
                }
                if (candidate.type === 'continue' && containsRoleOutputContinuation(candidate.content)) {
                    throw new Error('Continuation content resembles Director/Writer output sections. This agent must return phase analysis notes only.');
                }
                if (candidate.type === 'continue' && continuationMaxChars > 0 && candidate.content.length > continuationMaxChars) {
                    throw new Error(`Continuation content is too long (${candidate.content.length} chars). Keep continuation notes under ${continuationMaxChars} chars.`);
                }
                if (candidate.type === 'tool_call' && !allowedTools.has(candidate.tool)) {
                    throw new Error(`Tool '${candidate.tool}' is not allowed for this agent run.`);
                }
                if (isFinalIteration && candidate.type !== 'final'
                    && (hardIterationLimit || options.forceFinalAfterMax !== true)
                    && options.forceFinalCorrectionOnMax !== true) {
                    throw new Error('The final agent iteration must return a final answer.');
                }
                if (candidate.type === 'final' && !finalizeInstruction) {
                    const rejectionReason = await validateFinalAnswer(options, candidate.answer, {
                        phase,
                        iteration: index + 1,
                        finalIteration: isFinalIteration,
                        forcedConclusion: false
                    });
                    if (rejectionReason) throw new Error(`Final answer rejected: ${rejectionReason}`);
                }
                return true;
            };
            let response;
            try {
                response = await callAgentModel(callMessages, {
                    ...options,
                    iteration: index + 1,
                    validateAction
                });
            } catch (error) {
                if (!isRecoverableAgentResponseError(error)) throw error;
                const reason = error.message || 'Invalid agent response.';
                trace.push({ iteration: index + 1, rejected: true, rejectionReason: reason });
                messages.push({
                    role: 'user',
                    content: `MODEL RESPONSE REJECTED: ${reason}\nFollow the AgentRunner envelope and phase output requirements exactly, then try again using the evidence already gathered.`
                });
                await emitAgentEvent(options, {
                    type: 'final_rejected',
                    phase,
                    iteration: index + 1,
                    reason
                });
                if (!isFinalIteration) {
                    await waitForNextIteration(options, index + 1, interIterationDelayMs);
                    continue;
                }
                if (options.forceFinalAfterMax === true && !hardIterationLimit) continue;
                throw error;
            }
            let action = normalizeAction(response?.content);
            if (action.type === 'final' && index + 1 < minimumIterations) {
                action = { type: 'continue', content: action.answer };
            }
            await emitAgentEvent(options, {
                type: 'model_response',
                phase,
                iteration: index + 1,
                action
            });

            if (isFinalIteration && action.type !== 'final' && options.forceFinalCorrectionOnMax === true) {
                const correctionIteration = maxIterations + 1;
                const deniedObservation = action.type === 'tool_call'
                    ? { error: true, message: 'Research window closed; final tool call was not executed. Synthesize a final answer from existing evidence.' }
                    : null;
                trace.push({
                    iteration: index + 1,
                    action,
                    ...(deniedObservation ? { observation: deniedObservation } : {})
                });
                messages.push({ role: 'assistant', content: JSON.stringify(action) });
                if (deniedObservation) {
                    messages.push({
                        role: 'user',
                        content: `TOOL OBSERVATION (${action.tool}):\n${JSON.stringify(deniedObservation)}`
                    });
                    await emitAgentEvent(options, {
                        type: 'tool_observation',
                        phase,
                        iteration: index + 1,
                        tool: action.tool,
                        args: action.args,
                        observation: deniedObservation
                    });
                } else if (action.type === 'continue') {
                    await emitAgentEvent(options, {
                        type: 'continuation',
                        phase,
                        iteration: index + 1,
                        content: action.content
                    });
                }
                if (finalizeInstruction) {
                    messages.push({
                        role: 'user',
                        content: [
                            'FINAL ACTION REJECTED: the research/tool window is closed.',
                            action.type === 'tool_call'
                                ? `The requested tool call (${action.tool}) was not executed.`
                                : 'Continuation is not allowed now.',
                            'Use only the evidence and observations already present in this conversation.'
                        ].join('\n')
                    });
                    return await runFinalizationCall({
                        iteration: correctionIteration,
                        forcedConclusion: true,
                        reason: 'The previous attempted action was rejected because the phase work window is closed.'
                    });
                }

                const correctionProtocol = buildProtocolMessage(registry, new Set(), 1, false);
                const correctionInstruction = {
                    role: 'user',
                    content: [
                        'FINAL ACTION REJECTED: the research/tool window is closed.',
                        action.type === 'tool_call'
                            ? `The requested tool call (${action.tool}) was not executed.`
                            : 'Continuation is not allowed now.',
                        'Do not call tools. Do not continue.',
                        'Use only the evidence and observations already present in this conversation.',
                        'Return the requested final answer for this phase now.'
                    ].join('\n')
                };
                const correctionVisibleMessages = [correctionProtocol, ...messages, correctionInstruction, {
                    role: 'system',
                    content: 'FINAL CORRECTION: Return a final answer now. Tools are unavailable.'
                }];
                const correctionMessages = [...prefixMessages, ...correctionVisibleMessages];
                const validateCorrection = async content => {
                    const candidate = normalizeAction(content);
                    if (candidate.type !== 'final') throw new Error('The final correction call must return a final answer.');
                    const rejectionReason = await validateFinalAnswer(options, candidate.answer, {
                        phase,
                        iteration: correctionIteration,
                        finalIteration: true,
                        forcedConclusion: true
                    });
                    if (rejectionReason) throw new Error(`Forced conclusion rejected: ${rejectionReason}`);
                    return true;
                };

                await emitAgentEvent(options, {
                    type: 'model_request',
                    phase,
                    iteration: correctionIteration,
                    maxIterations: correctionIteration,
                    finalIteration: true,
                    forcedConclusion: true,
                    prefixOmitted: prefixMetadata,
                    messages: correctionVisibleMessages
                });
                const correctionResponse = await callAgentModel(correctionMessages, {
                    ...options,
                    iteration: correctionIteration,
                    validateAction: validateCorrection
                });
                const finalAction = normalizeAction(correctionResponse?.content);
                await emitAgentEvent(options, {
                    type: 'model_response',
                    phase,
                    iteration: correctionIteration,
                    forcedConclusion: true,
                    action: finalAction
                });
                if (finalAction.type !== 'final') {
                    throw new Error('The final correction call must return a final answer.');
                }
                const rejectionReason = await validateFinalAnswer(options, finalAction.answer, {
                    phase,
                    iteration: correctionIteration,
                    finalIteration: true,
                    forcedConclusion: true
                });
                if (rejectionReason) throw new Error(`Forced conclusion rejected: ${rejectionReason}`);
                await emitAgentEvent(options, {
                    type: 'completed',
                    phase,
                    iteration: correctionIteration,
                    forcedConclusion: true,
                    answer: finalAction.answer
                });
                messages.push({ role: 'assistant', content: JSON.stringify(finalAction) });
                return makeResult('completed', {
                    final: finalAction.answer,
                    iterations: correctionIteration,
                    trace,
                    messages,
                    forcedConclusion: true
                });
            }

            if (isFinalIteration && hardIterationLimit && action.type !== 'final') {
                throw new Error('The final agent iteration must return a final answer.');
            }

            if (action.type === 'final') {
                if (finalizeInstruction) {
                    messages.push({ role: 'assistant', content: JSON.stringify(action) });
                    return await runFinalizationCall({
                        iteration: index + 2,
                        forcedConclusion: false,
                        reason: 'The previous message was a draft conclusion. Rewrite it into the required final phase output format.'
                    });
                }
                const rejectionReason = await validateFinalAnswer(options, action.answer, {
                    phase,
                    iteration: index + 1,
                    finalIteration: isFinalIteration,
                    forcedConclusion: false
                });
                if (rejectionReason) {
                    trace.push({ iteration: index + 1, action, rejected: true, rejectionReason });
                    messages.push({ role: 'assistant', content: JSON.stringify(action) });
                    messages.push({
                        role: 'user',
                        content: `FINAL ANSWER REJECTED: ${rejectionReason}\nUse the evidence already gathered, correct the problem, and return the requested analytical conclusion rather than scene prose.`
                    });
                    await emitAgentEvent(options, {
                        type: 'final_rejected',
                        phase,
                        iteration: index + 1,
                        reason: rejectionReason
                    });
                    if (!isFinalIteration) {
                        await waitForNextIteration(options, index + 1, interIterationDelayMs);
                        continue;
                    }
                    if (options.forceFinalAfterMax === true && !hardIterationLimit) continue;
                    throw new Error(`Final answer rejected: ${rejectionReason}`);
                }
                await emitAgentEvent(options, {
                    type: 'completed',
                    phase,
                    iteration: index + 1,
                    answer: action.answer
                });
                return makeResult('completed', {
                    final: action.answer,
                    iterations: index + 1,
                    trace,
                    messages
                });
            }

            if (isFinalIteration && options.forceFinalAfterMax === true && !hardIterationLimit) {
                const deniedObservation = action.type === 'tool_call'
                    ? { error: true, message: 'Research window closed; tool call was not executed.' }
                    : null;
                trace.push({
                    iteration: index + 1,
                    action,
                    ...(deniedObservation ? { observation: deniedObservation } : {})
                });
                messages.push({ role: 'assistant', content: JSON.stringify(action) });
                if (deniedObservation) {
                    messages.push({
                        role: 'user',
                        content: `TOOL OBSERVATION (${action.tool}):\n${JSON.stringify(deniedObservation)}`
                    });
                    await emitAgentEvent(options, {
                        type: 'tool_observation',
                        phase,
                        iteration: index + 1,
                        tool: action.tool,
                        args: action.args,
                        observation: deniedObservation
                    });
                } else if (action.type === 'continue') {
                    await emitAgentEvent(options, {
                        type: 'continuation',
                        phase,
                        iteration: index + 1,
                        content: action.content
                    });
                }
                continue;
            }

            if (action.type === 'continue') {
                if (!allowContinue) {
                    throw new Error('This agent run does not allow continuation outputs.');
                }
                const traceEntry = {
                    iteration: index + 1,
                    action
                };
                trace.push(traceEntry);
                messages.push({ role: 'assistant', content: JSON.stringify(action) });
                await emitAgentEvent(options, {
                    type: 'continuation',
                    phase,
                    iteration: index + 1,
                    content: action.content
                });
                if (!isFinalIteration) {
                    await waitForNextIteration(options, index + 1, interIterationDelayMs);
                }
                continue;
            }

            if (!allowedTools.has(action.tool)) {
                throw new Error(`Tool '${action.tool}' is not allowed for this agent run.`);
            }

            const tool = registry[action.tool];
            if (!tool || typeof tool.execute !== 'function') {
                throw new Error(`Tool '${action.tool}' is not registered.`);
            }

            let observation;
            try {
                observation = await tool.execute(action.args);
            } catch (error) {
                observation = {
                    error: true,
                    message: error.message
                };
            }

            const traceEntry = {
                iteration: index + 1,
                action,
                observation
            };
            trace.push(traceEntry);
            await emitAgentEvent(options, {
                type: 'tool_observation',
                phase,
                iteration: index + 1,
                tool: action.tool,
                args: action.args,
                observation
            });
            messages.push({ role: 'assistant', content: JSON.stringify(action) });
            messages.push({
                role: 'user',
                content: `TOOL OBSERVATION (${action.tool}):\n${JSON.stringify(observation)}`
            });

            await waitForNextIteration(options, index + 1, interIterationDelayMs);
        }

        if (options.forceFinalAfterMax === true && !hardIterationLimit) {
            const conclusionIteration = maxIterations + 1;
            const conclusionProtocol = buildProtocolMessage(registry, new Set(), 1, false);
            const conclusionInstruction = {
                role: 'system',
                content: 'RESEARCH WINDOW CLOSED: Tools are unavailable. Synthesize the evidence already gathered and return a final answer now.'
            };
            const visibleMessages = [conclusionProtocol, ...messages, conclusionInstruction];
            const callMessages = [...prefixMessages, ...visibleMessages];
            const validateConclusion = async content => {
                const candidate = normalizeAction(content);
                if (candidate.type !== 'final') throw new Error('The recovery conclusion call must return a final answer.');
                const rejectionReason = await validateFinalAnswer(options, candidate.answer, {
                    phase,
                    iteration: conclusionIteration,
                    finalIteration: true,
                    forcedConclusion: true
                });
                if (rejectionReason) throw new Error(`Forced conclusion rejected: ${rejectionReason}`);
                return true;
            };

            await emitAgentEvent(options, {
                type: 'model_request',
                phase,
                iteration: conclusionIteration,
                maxIterations: conclusionIteration,
                finalIteration: true,
                forcedConclusion: true,
                prefixOmitted: prefixMetadata,
                messages: visibleMessages
            });
            const response = await callAgentModel(callMessages, {
                ...options,
                iteration: conclusionIteration,
                validateAction: validateConclusion
            });
            const action = normalizeAction(response?.content);
            await emitAgentEvent(options, {
                type: 'model_response',
                phase,
                iteration: conclusionIteration,
                forcedConclusion: true,
                action
            });
            if (action.type === 'final') {
                const rejectionReason = await validateFinalAnswer(options, action.answer, {
                    phase,
                    iteration: conclusionIteration,
                    finalIteration: true,
                    forcedConclusion: true
                });
                if (rejectionReason) {
                    throw new Error(`Forced conclusion rejected: ${rejectionReason}`);
                }
                messages.push({ role: 'assistant', content: JSON.stringify(action) });
                await emitAgentEvent(options, {
                    type: 'completed',
                    phase,
                    iteration: conclusionIteration,
                    forcedConclusion: true,
                    answer: action.answer
                });
                return makeResult('completed', {
                    final: action.answer,
                    iterations: conclusionIteration,
                    trace,
                    messages,
                    forcedConclusion: true
                });
            }
        }

        await emitAgentEvent(options, {
            type: 'max_iterations',
            phase,
            iterations: maxIterations
        });
        return makeResult('max_iterations', {
            iterations: maxIterations,
            trace,
            messages
        });
    } catch (error) {
        return makeResult('error', {
            iterations: trace.length,
            trace,
            messages,
            error: error.message
        });
    }
}

module.exports = {
    startAgent,
    defineAgentTool,
    createDummyAgentTools,
    estimateTokens
};
