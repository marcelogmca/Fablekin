const fs = require('fs/promises');
const path = require('path');
const { Logger, TurnLogger } = require('../../utils.js');
const { PipelineAbortError } = require('./errors.js');
const sequenceApi = require('../../vn_manager/sequence_api.js');
const SecureStorage = require('../../main_process/secure_storage.js');
const { getProjectMetadata, setProjectMetadata } = require('../../config/project_config_store.js');
const { resolveTurnStorageKey, parseTurnStorageKey } = require('../../turn_storage_key.js');
const { buildAssetsTools } = require('./assets_tools.js');
const { buildTurnsTools } = require('./turns_tools.js');
const { buildJobsTools } = require('./jobs_tools.js');
const { startAgent, defineAgentTool, createDummyAgentTools } = require('../../agent_runner.js');
const TurnContext = require('../../turncontext.js');
const { getDiagnosticContext, runWithDiagnosticContext } = require('../../diagnostic_context.js');
const { isPathInsideRoot } = require('../../main_process/shared/path_guard.js');

function ensureDirectorRuntime(context) {
    if (!context) return null;
    context.runtime = context.runtime || {};
    context.runtime.director = context.runtime.director || {};
    context.runtime.director.cotSteps = context.runtime.director.cotSteps || [];
    context.runtime.director.cotPatches = context.runtime.director.cotPatches || [];
    context.runtime.director.ledgerSections = context.runtime.director.ledgerSections || [];
    context.runtime.director.ledgerSectionPatches = context.runtime.director.ledgerSectionPatches || [];
    context.runtime.director.ledgerOverrides = context.runtime.director.ledgerOverrides || {};
    context.runtime.director.additionalInputs = context.runtime.director.additionalInputs || [];
    context.runtime.director.registeredCapabilities = context.runtime.director.registeredCapabilities || [];
    return context.runtime.director;
}

function resolveProjectPluginStorage(rootDirectory, pluginId, projectName = 'default_project') {
    const root = rootDirectory ? path.resolve(rootDirectory) : null;
    const safePluginId = String(pluginId || '').trim();
    if (!root) throw new Error(`No project root directory available for plugin '${safePluginId || 'unknown'}'.`);
    if (!/^[a-zA-Z0-9_-]+$/.test(safePluginId)) {
        throw new Error(`Invalid plugin id for project storage: '${safePluginId}'.`);
    }

    const relativePath = `plugins/${safePluginId}`;
    const absolutePath = path.resolve(root, 'plugins', safePluginId);
    if (!isPathInsideRoot(absolutePath, root)) {
        throw new Error(`Access denied: Plugin storage escaped the active project root.`);
    }

    return {
        absolutePath,
        relativePath,
        projectName: String(projectName || 'default_project'),
        pluginId: safePluginId
    };
}

function normalizeDirectorContributionId(pluginId, id) {
    const text = typeof id === 'string' ? id.trim() : '';
    return text || `${pluginId}.unnamed`;
}

function normalizeDirectorText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function escapeXmlAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function wrapDirectablePluginPrompt(pluginId, content) {
    const trimmed = typeof content === 'string' ? content.trim() : content;
    return `<plugin_context directable_plugin="${escapeXmlAttribute(pluginId)}">
${trimmed}
</plugin_context>`;
}

function registerDirectorCotPatch(context, pluginId, logger, patch = {}) {
    const director = ensureDirectorRuntime(context);
    if (!director) return;

    const type = normalizeDirectorText(patch.type).toLowerCase();
    const id = normalizeDirectorContributionId(pluginId, patch.id);
    if (!['add', 'override', 'disable', 'remove'].includes(type)) {
        logger.warn('PluginManager', `Ignoring invalid Director CoT patch type from plugin '${pluginId}': ${type || '(empty)'}`);
        return;
    }

    const normalized = {
        type,
        id,
        pluginId,
        step: normalizeDirectorText(patch.step),
        target: normalizeDirectorText(patch.target),
        title: normalizeDirectorText(patch.title),
        content: normalizeDirectorText(patch.content),
        reason: normalizeDirectorText(patch.reason)
    };

    director.cotPatches = director.cotPatches.filter(existing => existing?.id !== id);
    director.cotPatches.push(normalized);
    logger.log('PluginManager', `Plugin '${pluginId}' registered Director CoT ${type} [${id}].`);
}

function normalizeLedgerSectionId(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function registerDirectorLedgerSection(context, pluginId, logger, config = {}) {
    const director = ensureDirectorRuntime(context);
    if (!director) return;

    const id = normalizeLedgerSectionId(config.id || config.title);
    const content = normalizeDirectorText(config.content);
    if (!id || !content) {
        logger.warn('PluginManager', `Ignoring invalid Director ledger section from plugin '${pluginId}'.`);
        return;
    }

    const normalized = {
        id,
        title: normalizeDirectorText(config.title),
        content,
        pluginId
    };

    director.ledgerSectionPatches = director.ledgerSectionPatches.filter(existing =>
        normalizeLedgerSectionId(existing?.id) !== id
    );
    director.ledgerSectionPatches.push(normalized);
    logger.log('PluginManager', `Plugin '${pluginId}' registered Director ledger section [${id}].`);
}

function registerWriterCotInsertion(context, pluginId, logger, config = {}) {
    if (!context?.processed) return;

    const content = normalizeDirectorText(config.content);
    if (!content) {
        logger.warn('PluginManager', `Ignoring empty Writer CoT insertion from plugin '${pluginId}'.`);
        return;
    }

    if (!Array.isArray(context.processed.writerCoTInsertions)) {
        context.processed.writerCoTInsertions = [];
    }

    const insertion = {
        pluginId,
        content,
        stepIdMode: config.stepIdMode === 'current' ? 'current' : 'original'
    };

    const insertAfterStep = Number.parseInt(config.insertAfterStep, 10);
    if (Number.isInteger(insertAfterStep)) insertion.insertAfterStep = insertAfterStep;

    context.processed.writerCoTInsertions.push(insertion);
    logger.log('PluginManager', `Plugin '${pluginId}' registered Writer CoT insertion${Number.isInteger(insertAfterStep) ? ` after Step ${insertAfterStep}` : ''}.`);
}

async function readDirectorLedgerEntries(context, options = {}) {
    const factManager = require('../../memory_manager/storage/fact_manager.js');
    const projectName = context?.projectName || 'default_project';
    const maxChars = Number.isFinite(Number(options.maxChars))
        ? Math.max(0, Number(options.maxChars))
        : 4000;
    const prefix = normalizeDirectorText(options.prefix);
    const sectionId = normalizeLedgerSectionId(options.sectionId);
    const effectivePrefix = prefix || (sectionId ? `${sectionId}_` : '');

    const ledger = await factManager.getFormattedLedger('director', projectName);
    if (!ledger || ledger === 'Empty.') return '';

    let lines = ledger.split(/\r?\n/).filter(Boolean);
    if (effectivePrefix) {
        lines = lines.filter(line => {
            const match = line.match(/^\[([^\]]+)\]/);
            return match && match[1].startsWith(effectivePrefix);
        });
    }

    const text = lines.join('\n');
    if (maxChars <= 0) return '';
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Builds the tools object provided to plugins.
 * @param {Object} pluginManager - The PluginManager instance.
 * @param {string} pluginId - The ID of the plugin.
 * @param {Object} turnContext - The current turn context.
 * @param {Object} activeSocket - The active Socket.IO socket instance (optional).
 * @param {Object} [extra={}] - Extra tools or overrides (optional).
 * @returns {Object}
 */
function buildTools(pluginManager, pluginId, turnContext, activeSocket = null, extra = {}) {
    const { sendUiNotification, updateSettings, readSettings } = require('../../utils.js');
    let interceptCounter = 0;

    // Root priority: turnContext.runtime.rootDirectory -> turnContext snapshot -> explicitly set projectRoot -> staticDataManager's root
    const resolvedRoot = turnContext?.runtime?.rootDirectory || turnContext?.rootDirectory || pluginManager.projectRoot || pluginManager.staticDataManager?.projectRootDirectory;

    // Ensure we always have a context object, even if minimal
    const context = turnContext || {
        projectName: pluginManager.staticDataManager?.projectName || 'default_project',
        rootDirectory: resolvedRoot,
        isFallbackContext: true
    };

    const registerInterceptInternal = (descriptor = {}, lane = 'persisted') => {
        if (!context) return null;
        const normalizeTransitionDescriptor = (input = null) => {
            if (!input || typeof input !== 'object') return null;
            const effect = String(input.effect || '').trim().toLowerCase();
            if (!effect) return null;
            const normalized = {
                effect,
                scope: String(input.scope || '').trim().toLowerCase() || 'intercept',
                blocking: input.blocking !== false
            };
            if (typeof input.target === 'string' && input.target.trim()) normalized.target = input.target.trim();
            if (Number.isFinite(Number(input.durationMs))) normalized.durationMs = Math.max(0, Math.min(15000, Number(input.durationMs)));
            if (typeof input.direction === 'string' && input.direction.trim()) normalized.direction = input.direction.trim().toLowerCase();
            if (typeof input.easing === 'string' && input.easing.trim()) normalized.easing = input.easing.trim();
            if (input.options && typeof input.options === 'object') normalized.options = { ...input.options };
            return normalized;
        };

        const safeDescriptor = (descriptor && typeof descriptor === 'object') ? { ...descriptor } : {};
        safeDescriptor.pluginId = safeDescriptor.pluginId || pluginId;
        safeDescriptor.interceptId =
            safeDescriptor.interceptId ||
            safeDescriptor.id ||
            `intercept_${Date.now()}_${++interceptCounter}_${Math.random().toString(16).slice(2, 8)}`;
        safeDescriptor.checkpoint = safeDescriptor.checkpoint || 'on_dialogue_enter';
        safeDescriptor.priority = Number.isFinite(safeDescriptor.priority) ? safeDescriptor.priority : 100;
        safeDescriptor.blocking = safeDescriptor.blocking !== false;
        safeDescriptor.replayPolicy = safeDescriptor.replayPolicy || 'every_enter';
        safeDescriptor.stateScope = safeDescriptor.stateScope || 'turn';
        safeDescriptor.persistence = lane === 'runtime' ? 'runtime' : 'persisted';
        const transitionIn = normalizeTransitionDescriptor(safeDescriptor.transitionIn);
        const transitionOut = normalizeTransitionDescriptor(safeDescriptor.transitionOut);
        if (transitionIn) safeDescriptor.transitionIn = transitionIn;
        else delete safeDescriptor.transitionIn;
        if (transitionOut) safeDescriptor.transitionOut = transitionOut;
        else delete safeDescriptor.transitionOut;

        if (lane === 'runtime') {
            if (!context.runtime || typeof context.runtime !== 'object') context.runtime = {};
            if (!Array.isArray(context.runtime.guiIntercepts)) context.runtime.guiIntercepts = [];
            context.runtime.guiIntercepts.push(safeDescriptor);
        } else {
            if (!context.output || typeof context.output !== 'object') context.output = {};
            if (!Array.isArray(context.output.guiIntercepts)) context.output.guiIntercepts = [];
            context.output.guiIntercepts.push(safeDescriptor);
        }

        return safeDescriptor;
    };

    const resolveFactScope = (overrides = {}) => {
        const projectName = context?.projectName || 'default_project';
        const defaultTurnNumber = Number.isInteger(context?.turnNumber) ? context.turnNumber : 0;
        const baseTurnKey = resolveTurnStorageKey(context);
        const parsedKey = parseTurnStorageKey(baseTurnKey);
        const runtimeInterlude = context?.runtime?.interlude || {};
        const sceneMode = String(context?.sceneMode || 'mainline').trim().toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
        const derivedInterludeOrdinal = Number.isInteger(context?.interludeOrdinal)
            ? context.interludeOrdinal
            : (Number.isInteger(runtimeInterlude?.ordinal) ? runtimeInterlude.ordinal : (parsedKey?.ordinal || null));
        const derivedInterludeId = Number.isInteger(runtimeInterlude?.id) ? runtimeInterlude.id : null;

        const scope = {
            projectName,
            turn_number: defaultTurnNumber,
            turn_key: baseTurnKey,
            scene_mode: sceneMode,
            interlude_id: derivedInterludeId,
            interlude_ordinal: derivedInterludeOrdinal,
            plugin_id: pluginId
        };

        if (overrides && typeof overrides === 'object') {
            if (Number.isInteger(overrides.turn_number)) scope.turn_number = overrides.turn_number;
            if (typeof overrides.turn_key === 'string' && overrides.turn_key.trim()) scope.turn_key = overrides.turn_key.trim();
            if (typeof overrides.scene_mode === 'string' && overrides.scene_mode.trim()) scope.scene_mode = overrides.scene_mode.trim().toLowerCase();
            if (Number.isInteger(overrides.interlude_id)) scope.interlude_id = overrides.interlude_id;
            if (overrides.interlude_id === null) scope.interlude_id = null;
            if (Number.isInteger(overrides.interlude_ordinal)) scope.interlude_ordinal = overrides.interlude_ordinal;
            if (overrides.interlude_ordinal === null) scope.interlude_ordinal = null;
            if (typeof overrides.plugin_id === 'string' && overrides.plugin_id.trim()) scope.plugin_id = overrides.plugin_id.trim();
            if (typeof overrides.projectName === 'string' && overrides.projectName.trim()) scope.projectName = overrides.projectName.trim();
        }

        return scope;
    };

    const resolveContextSnapshot = (sourceContext = context) => {
        const source = sourceContext || context || {};
        const projectName = source.projectName || context?.projectName || pluginManager.staticDataManager?.projectName || 'default_project';
        const normalizedProjectName = String(projectName || 'default_project').trim() || 'default_project';
        const turnNumber = Number.isInteger(source.turnNumber)
            ? source.turnNumber
            : (Number.isInteger(context?.turnNumber) ? context.turnNumber : 0);
        const rootDirectory =
            source?.runtime?.rootDirectory ||
            source?.rootDirectory ||
            context?.runtime?.rootDirectory ||
            context?.rootDirectory ||
            resolvedRoot ||
            null;
        const turnKey = resolveTurnStorageKey(source);
        const parsedTurnKey = parseTurnStorageKey(turnKey);
        const runtimeInterlude = source?.runtime?.interlude || {};
        const sceneMode = String(source?.sceneMode || 'mainline').trim().toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
        const interludeOrdinal = Number.isInteger(source?.interludeOrdinal)
            ? source.interludeOrdinal
            : (Number.isInteger(runtimeInterlude?.ordinal) ? runtimeInterlude.ordinal : (parsedTurnKey?.ordinal || null));
        const interludeId = Number.isInteger(runtimeInterlude?.id) ? runtimeInterlude.id : null;

        return {
            projectName: normalizedProjectName,
            projectKey: normalizedProjectName.toLowerCase(),
            turnNumber,
            turnKey,
            sceneMode,
            interludeId,
            interludeOrdinal,
            rootDirectory,
            pluginId,
            isFallbackContext: !!source?.isFallbackContext
        };
    };

    const resolveChatPluginStorage = (sourceTurnContext, turnOverride = null) => {
        const chatPath = sourceTurnContext?.chatDbFullPath;
        if (!chatPath) {
            throw new Error(`getChatPluginStorage failed: No active chat context available for plugin '${pluginId}'.`);
        }
        const chatName = path.basename(chatPath, '.db');
        const overrideText = turnOverride !== null && turnOverride !== undefined
            ? String(turnOverride).trim()
            : '';
        const storageTurnKey = overrideText || resolveTurnStorageKey(sourceTurnContext);
        const parsed = parseTurnStorageKey(storageTurnKey);
        const baseTurnNumber = parsed?.baseTurn || (sourceTurnContext?.turnNumber || 0);

        const relativePath = `plugins/${chatName}/${storageTurnKey}/${pluginId}`;
        const absolutePath = path.join(resolvedRoot, relativePath);

        return {
            absolutePath,
            relativePath,
            chatName,
            turnNumber: baseTurnNumber,
            storageTurnKey
        };
    };

    const normalizePluginStateId = (id, fallback = pluginId) => {
        const normalized = String(id || '').trim();
        return normalized || fallback;
    };

    const materializeDefaultPluginState = (defaultValue = {}) => {
        if (defaultValue && typeof defaultValue === 'object') {
            return Array.isArray(defaultValue) ? defaultValue.slice() : { ...defaultValue };
        }
        return {};
    };

    const getPluginStateBucket = (sourceTurnContext, lane, targetPluginId, defaultValue = {}) => {
        if (!sourceTurnContext || typeof sourceTurnContext !== 'object') {
            throw new Error(`pluginState.${lane} failed: No TurnContext available.`);
        }

        const normalizedPluginId = normalizePluginStateId(targetPluginId);
        const rootKey = lane === 'runtime' ? 'runtime' : 'processed';
        if (!sourceTurnContext[rootKey] || typeof sourceTurnContext[rootKey] !== 'object') {
            sourceTurnContext[rootKey] = {};
        }

        const root = sourceTurnContext[rootKey];
        if (!root.plugins || typeof root.plugins !== 'object') {
            root.plugins = {};
        }

        if (root.plugins[normalizedPluginId] === undefined || root.plugins[normalizedPluginId] === null) {
            root.plugins[normalizedPluginId] = materializeDefaultPluginState(defaultValue);
        } else if (typeof root.plugins[normalizedPluginId] !== 'object') {
            root.plugins[normalizedPluginId] = { value: root.plugins[normalizedPluginId] };
        }

        return root.plugins[normalizedPluginId];
    };

    const clearPluginStateBucket = (sourceTurnContext, lane, targetPluginId) => {
        if (!sourceTurnContext || typeof sourceTurnContext !== 'object') return false;
        const normalizedPluginId = normalizePluginStateId(targetPluginId);
        const rootKey = lane === 'runtime' ? 'runtime' : 'processed';
        const root = sourceTurnContext[rootKey];
        if (!root?.plugins || typeof root.plugins !== 'object') return false;
        const existed = Object.prototype.hasOwnProperty.call(root.plugins, normalizedPluginId);
        delete root.plugins[normalizedPluginId];
        return existed;
    };

    const buildPluginStateTools = (sourceTurnContext = context, scopedPluginId = pluginId) => ({
        runtime: (defaultValue = {}) => getPluginStateBucket(sourceTurnContext, 'runtime', scopedPluginId, defaultValue),
        turn: (defaultValue = {}) => getPluginStateBucket(sourceTurnContext, 'turn', scopedPluginId, defaultValue),
        clearRuntime: () => clearPluginStateBucket(sourceTurnContext, 'runtime', scopedPluginId),
        clearTurn: () => clearPluginStateBucket(sourceTurnContext, 'turn', scopedPluginId),
        forPlugin: (targetPluginId) => buildPluginStateTools(sourceTurnContext, normalizePluginStateId(targetPluginId, scopedPluginId)),
        fromContext: (sourceContext) => buildPluginStateTools(sourceContext, scopedPluginId)
    });

    const resolveScopedStatusId = (customId = null) => {
        return customId ? `${pluginId}_${customId}` : pluginId;
    };

    const statusUpdate = (message, options = {}) => {
        const id = resolveScopedStatusId(options.id);
        return sendUiNotification({ id, message, ...options });
    };

    const statusClear = (customId = null) => {
        const id = resolveScopedStatusId(customId);
        return sendUiNotification({ id, type: 'clear' });
    };

    const statusWithTask = async (message, optionsOrWork = {}, maybeWork = null) => {
        const options = (optionsOrWork && typeof optionsOrWork === 'object' && !Array.isArray(optionsOrWork))
            ? optionsOrWork
            : {};
        const work = typeof optionsOrWork === 'function' ? optionsOrWork : maybeWork;
        const autoClear = options.autoClear !== false;
        const statusOptions = { ...options };
        delete statusOptions.autoClear;

        if (typeof work !== 'function') {
            throw new Error(`tools.status.withTask requires a task function for plugin '${pluginId}'.`);
        }

        statusUpdate(message, statusOptions);
        try {
            return await work();
        } finally {
            if (autoClear) {
                statusClear(statusOptions.id || null);
            }
        }
    };

    const llmCall = async (messages, params = {}, options = {}) => {
        const { callLLM } = require('../../llm.js');
        const normalizedParams = normalizeLlmParams(params);
        const route = resolveLlmRoute(normalizedParams.model);
        const effectiveModule = normalizedParams?.callingModule || `Plugin:${pluginId}`;
        const shouldLog = options.log !== false;
        const logTitle = options.logTitle || normalizedParams.logTitle || normalizedParams.title || normalizedParams.msg || effectiveModule;

        const executeCall = async () => {
            if (shouldLog) {
                TurnLogger.logRequest(logTitle, messages, route?.model || normalizedParams.model, route?.provider || normalizedParams.provider);
            }

            let response;
            try {
                response = await callLLM({
                    ...normalizedParams,
                    messages,
                    callingModule: effectiveModule,
                    turnLogTitle: shouldLog ? logTitle : normalizedParams.turnLogTitle
                });
                response = enrichLlmResponseRoute(response, route);
            } catch (error) {
                if (shouldLog && !error?.turnLoggerLogged) {
                    TurnLogger.logError(logTitle, error, route?.model || normalizedParams.model, route?.provider || normalizedParams.provider);
                    error.turnLoggerLogged = true;
                }
                throw error;
            }

            if (shouldLog) {
                TurnLogger.logResponse(
                    logTitle,
                    response?.content,
                    response?.model || route?.model || normalizedParams.model,
                    response?.provider || route?.provider || normalizedParams.provider
                );
            }

            return response;
        };

        const activeDiagnostics = getDiagnosticContext();
        if (activeDiagnostics && Object.keys(activeDiagnostics).length > 0) {
            return await executeCall();
        }

        return await runWithDiagnosticContext({
            executionLane: 'plugin',
            phase: 'Plugin LLM',
            pluginId,
            component: `Plugin:${pluginId}`,
            taskKey: logTitle,
            blocking: normalizedParams.blocking !== false
        }, executeCall);
    };

    const llmDirectParamKeys = [
        'model',
        'retries',
        'timeout',
        'expectJson',
        'json',
        'validationRegex',
        'validateFn',
        'minCharacters',
        'min_characters',
        'minWords',
        'min_words',
        'callingModule',
        'turnLogTitle'
    ];

    const llmExtraParamKeys = [
        'temperature',
        'max_tokens',
        'maxTokens',
        'top_p',
        'topP',
        'topK',
        'frequency_penalty',
        'presence_penalty',
        'repetition_penalty',
        'stop',
        'seed',
        'reasoning',
        'response_format'
    ];

    const normalizeLlmParams = (rawParams = {}) => {
        const params = (rawParams && typeof rawParams === 'object') ? { ...rawParams } : {};

        if (params.json !== undefined && params.expectJson === undefined) {
            params.expectJson = params.json;
        }
        delete params.json;

        if (params.min_characters !== undefined && params.minCharacters === undefined) {
            params.minCharacters = params.min_characters;
        }
        delete params.min_characters;

        if (params.min_words !== undefined && params.minWords === undefined) {
            params.minWords = params.min_words;
        }
        delete params.min_words;

        // Provider ownership belongs exclusively to the selected model alias.
        delete params.provider;

        for (const key of llmExtraParamKeys) {
            if (params[key] === undefined) continue;
            if (!params.extra || typeof params.extra !== 'object') params.extra = {};
            if (params.extra[key] === undefined) params.extra[key] = params[key];
            delete params[key];
        }

        return params;
    };

    const resolveLlmRoute = (model) => {
        if (!model) return null;
        const { resolveModelAlias } = require('../../llm.js');
        try {
            return resolveModelAlias(model);
        } catch {
            // Let the authoritative LLM call surface alias errors. This keeps injected
            // adapters free to use fixture-only concrete model names in tests.
            return null;
        }
    };

    const enrichLlmResponseRoute = (response, route) => {
        if (!response || typeof response !== 'object' || !route) return response;
        return {
            ...response,
            model: response.model || route.model,
            provider: response.provider || route.provider
        };
    };

    const buildLlmTaskPayload = (task = {}, overrides = {}) => {
        const base = Array.isArray(task)
            ? { messages: task }
            : ((task && typeof task === 'object') ? { ...task } : {});
        const overrideObj = (overrides && typeof overrides === 'object') ? { ...overrides } : {};
        const params = {
            ...((base.params && typeof base.params === 'object') ? base.params : {}),
            ...((overrideObj.params && typeof overrideObj.params === 'object') ? overrideObj.params : {})
        };
        const payload = { ...base, ...overrideObj, params };

        for (const key of llmDirectParamKeys) {
            if (payload[key] !== undefined) params[key] = payload[key];
        }

        if (payload.extra && typeof payload.extra === 'object') {
            params.extra = { ...((params.extra && typeof params.extra === 'object') ? params.extra : {}), ...payload.extra };
        }

        for (const key of llmExtraParamKeys) {
            if (payload[key] !== undefined) params[key] = payload[key];
        }

        payload.messages = Array.isArray(payload.messages) ? payload.messages : [];
        payload.params = normalizeLlmParams(params);
        return payload;
    };

    const validateSchemaValue = (value, schema, pathLabel = 'value') => {
        if (!schema || typeof schema !== 'object') return true;

        const expectedTypes = Array.isArray(schema.type)
            ? schema.type
            : (schema.type ? [schema.type] : []);
        const typeMatches = (expectedType) => {
            switch (expectedType) {
                case 'any':
                    return true;
                case 'array':
                    return Array.isArray(value);
                case 'object':
                    return value !== null && typeof value === 'object' && !Array.isArray(value);
                case 'integer':
                    return Number.isInteger(value);
                case 'number':
                    return typeof value === 'number' && Number.isFinite(value);
                case 'null':
                    return value === null;
                default:
                    return typeof value === expectedType;
            }
        };

        if (expectedTypes.length > 0 && !expectedTypes.some(typeMatches)) {
            throw new Error(`${pathLabel} expected ${expectedTypes.join('|')}.`);
        }

        if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
            throw new Error(`${pathLabel} must be one of: ${schema.enum.join(', ')}.`);
        }

        if (schema.type === 'array' || Array.isArray(value)) {
            if (!Array.isArray(value)) throw new Error(`${pathLabel} expected array.`);
            if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
                throw new Error(`${pathLabel} expected at least ${schema.minItems} items.`);
            }
            if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
                throw new Error(`${pathLabel} expected at most ${schema.maxItems} items.`);
            }
            if (schema.items) {
                value.forEach((item, index) => validateSchemaValue(item, schema.items, `${pathLabel}[${index}]`));
            }
        }

        if (schema.properties || Array.isArray(schema.required)) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error(`${pathLabel} expected object.`);
            }

            const required = Array.isArray(schema.required) ? schema.required : [];
            for (const key of required) {
                if (value[key] === undefined) throw new Error(`${pathLabel}.${key} is required.`);
            }

            const properties = schema.properties || {};
            for (const [key, childSchema] of Object.entries(properties)) {
                if (childSchema?.required === true && value[key] === undefined) {
                    throw new Error(`${pathLabel}.${key} is required.`);
                }
                if (value[key] !== undefined) {
                    validateSchemaValue(value[key], childSchema, `${pathLabel}.${key}`);
                }
            }

            if (schema.additionalProperties === false) {
                const allowed = new Set(Object.keys(properties));
                for (const key of Object.keys(value)) {
                    if (!allowed.has(key)) throw new Error(`${pathLabel}.${key} is not allowed.`);
                }
            }
        }

        return true;
    };

    const normalizeLlmSchema = (schema) => {
        if (!schema || typeof schema === 'function') return schema;
        if (schema.type || schema.properties || schema.items || schema.enum || Array.isArray(schema.required)) {
            return schema;
        }
        return { type: 'object', properties: schema };
    };

    const buildSchemaValidateFn = (schema, existingValidateFn = null) => {
        const normalizedSchema = normalizeLlmSchema(schema);
        return async (data, messages) => {
            if (typeof normalizedSchema === 'function') {
                const isValid = await normalizedSchema(data, messages);
                if (isValid === false) throw new Error('Schema validation function returned false.');
            } else {
                validateSchemaValue(data, normalizedSchema, 'content');
            }

            if (typeof existingValidateFn === 'function') {
                const isValid = await existingValidateFn(data, messages);
                if (isValid === false) throw new Error('Custom validation function returned false.');
            }

            return true;
        };
    };

    const llmRunTask = async (task = {}, overrides = {}) => {
        const payload = buildLlmTaskPayload(task, overrides);
        const messages = payload.messages;
        if (messages.length === 0) {
            throw new Error(`tools.llm.runTask requires a non-empty messages array for plugin '${pluginId}'.`);
        }

        const params = payload.params;
        const route = resolveLlmRoute(params.model);
        const requestMsg = payload.msg || payload.title || 'Plugin LLM Task';
        const shouldLogRequest = payload.logRequest !== false;
        const shouldLogResponse = payload.logResponse !== false;

        if (shouldLogRequest) {
            TurnLogger.logRequest({
                msg: requestMsg,
                messages,
                model: route?.model || params.model,
                provider: route?.provider || params.provider
            });
        }

        let response;
        try {
            response = await llmCall(messages, { ...params, turnLogTitle: shouldLogRequest ? requestMsg : params.turnLogTitle }, { log: false });
            response = enrichLlmResponseRoute(response, route);
        } catch (error) {
            if (shouldLogRequest && !error?.turnLoggerLogged) {
                TurnLogger.logError({
                    msg: requestMsg,
                    error,
                    model: route?.model || params.model,
                    provider: route?.provider || params.provider
                });
                error.turnLoggerLogged = true;
            }
            throw error;
        }

        if (shouldLogResponse) {
            TurnLogger.logResponse({
                msg: requestMsg,
                content: response?.content,
                model: response?.model || route?.model || params.model,
                provider: response?.provider || route?.provider || params.provider
            });
        }

        return response;
    };

    const llmJson = async (task = {}, overrides = {}) => {
        const overrideParams = {
            ...((overrides.params && typeof overrides.params === 'object') ? overrides.params : {}),
            expectJson: true
        };
        return await llmRunTask(task, { ...overrides, expectJson: true, params: overrideParams });
    };

    const llmRepairJson = (input, options = {}) => {
        const { repairJson } = require('../../llm.js');
        try {
            return repairJson(input, options);
        } catch (error) {
            if (Object.prototype.hasOwnProperty.call(options, 'fallback')) {
                return options.fallback;
            }
            if (options.throwOnError === false) return null;
            throw error;
        }
    };

    const llmWithSchema = async (task = {}, schema = null, overrides = {}) => {
        const baseTask = Array.isArray(task)
            ? { messages: task }
            : ((task && typeof task === 'object') ? { ...task } : {});
        const schemaToUse = schema || baseTask.schema;
        if (!schemaToUse) {
            throw new Error(`tools.llm.withSchema requires a schema for plugin '${pluginId}'.`);
        }

        const payload = buildLlmTaskPayload(baseTask, overrides);
        payload.params.expectJson = true;
        payload.params.validateFn = buildSchemaValidateFn(schemaToUse, payload.params.validateFn);
        return await llmRunTask(payload);
    };

    const llmGetActiveModels = (options = {}) => {
        const aliases = typeof pluginManager.getActiveModelAliases === 'function'
            ? pluginManager.getActiveModelAliases()
            : [];
        if (options.forSettings === true) return aliases;

        return aliases.map(item => {
            const assignment = getLlmModelRegistry().resolveDefinition(item.value);
            return {
                label: item.label,
                model: item.value?.model,
                provider: assignment?.provider || null,
                resolvedModel: assignment?.resolvedModel || null,
                subprovider: assignment?.subprovider || null,
                value: item.value,
                disabled: item.disabled === true,
                description: item.description || ''
            };
        });
    };

    let llmModelRegistry = null;
    const getLlmModelRegistry = () => {
        if (llmModelRegistry) return llmModelRegistry;
        const { resolveModelAlias } = require('../../llm.js');
        const { createLlmModelRegistry } = require('./llm_model_registry.js');
        llmModelRegistry = createLlmModelRegistry({
            pluginManager,
            readSettings,
            resolveModelAlias
        });
        return llmModelRegistry;
    };

    const llmResolveModelDefinition = (definition) => {
        return getLlmModelRegistry().resolveDefinition(definition);
    };

    const getVnBackgroundTools = () => {
        const {
            buildVnBackgroundMessages,
            getVnBackgroundAssignment,
            isVnBackgroundInheritance,
            waitForVnBackgroundCacheSlot
        } = require('../../vn_manager/background_llm_cache.js');

        const getAssignment = () => {
            const base = getVnBackgroundAssignment(readSettings());
            return llmResolveModelDefinition(base.definition) || base;
        };
        const getMessages = (suffix, options = {}) => buildVnBackgroundMessages(context, suffix, options);
        const buildTask = async (task = {}) => {
            const source = task && typeof task === 'object' ? { ...task } : {};
            if (source.model !== undefined || source.provider !== undefined || source.messages !== undefined) {
                throw new Error(`tools.llm.vnBackground does not accept model, provider, or messages overrides for plugin '${pluginId}'.`);
            }
            const suffix = source.suffix;
            const scene = source.scene || 'none';
            delete source.suffix;
            delete source.scene;
            const assignment = getAssignment();
            await waitForVnBackgroundCacheSlot(context, `plugin:${pluginId}:${source.msg || source.title || 'task'}`);
            return {
                ...source,
                messages: getMessages(suffix, { scene }),
                model: assignment.model,
                provider: assignment.provider,
                params: {
                    ...((source.params && typeof source.params === 'object') ? source.params : {}),
                    callingModule: source.params?.callingModule || source.callingModule || `Plugin:${pluginId}:VNBackground`
                }
            };
        };

        return {
            getAssignment,
            getMessages,
            isSelected: isVnBackgroundInheritance,
            call: async (task = {}) => await llmRunTask(await buildTask(task)),
            json: async (task = {}) => await llmJson(await buildTask(task)),
            withSchema: async (task = {}, schema = null) => await llmWithSchema(await buildTask(task), schema)
        };
    };

    const llmBatch = async (items = [], factoryOrOptions = {}, maybeOptions = {}) => {
        if (!Array.isArray(items)) {
            throw new Error(`tools.llm.batch requires an array for plugin '${pluginId}'.`);
        }

        const hasFactory = typeof factoryOrOptions === 'function';
        const factory = hasFactory ? factoryOrOptions : ((item) => item);
        const options = hasFactory ? (maybeOptions || {}) : (factoryOrOptions || {});
        const concurrencyRaw = Number(options.concurrency || options.limit || items.length || 1);
        const concurrency = Math.max(1, Math.min(items.length || 1, Number.isFinite(concurrencyRaw) ? concurrencyRaw : 1));
        const settle = options.settle === true || options.allSettled === true;
        const results = new Array(items.length);
        let nextIndex = 0;

        const runOne = async (item, index) => {
            const produced = await factory(item, index, items);
            if (produced && typeof produced === 'object' && Array.isArray(produced.messages)) {
                const task = { ...produced };
                if (options.schema && !task.schema) task.schema = options.schema;
                if (task.schema) return await llmWithSchema(task);
                if (options.json === true || task.json === true || task.expectJson === true || task.params?.json === true || task.params?.expectJson === true) {
                    return await llmJson(task);
                }
                return await llmRunTask(task);
            }
            return produced;
        };

        const runWorker = async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                try {
                    const value = await runOne(items[index], index);
                    results[index] = settle ? { status: 'fulfilled', value, index } : value;
                    if (typeof options.onProgress === 'function') {
                        await options.onProgress(results[index], { index, total: items.length });
                    }
                } catch (error) {
                    if (!settle) throw error;
                    results[index] = { status: 'rejected', reason: error, index };
                    if (typeof options.onProgress === 'function') {
                        await options.onProgress(results[index], { index, total: items.length });
                    }
                }
            }
        };

        const workers = Array.from({ length: concurrency }, () => runWorker());
        await Promise.all(workers);
        return results;
    };

    const assetsTools = buildAssetsTools({
        pluginManager,
        pluginId,
        turnContext,
        context,
        resolvedRoot
    });
    const turnsTools = buildTurnsTools({
        pluginManager,
        context,
        pluginId
    });
    const jobsTools = buildJobsTools({
        pluginManager,
        pluginId,
        context,
        resolveContextSnapshot,
        sendUiNotification,
        logger: Logger
    });

    return {
        turnContext: context, // Provide access to context in tools
        context: {
            get: () => context,
            resolve: (sourceContext = null) => resolveContextSnapshot(sourceContext || context),
            projectName: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).projectName,
            projectKey: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).projectKey,
            turnNumber: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).turnNumber,
            turnKey: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).turnKey,
            rootDir: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).rootDirectory,
            rootDirectory: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).rootDirectory,
            sceneMode: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).sceneMode,
            interludeId: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).interludeId,
            interludeOrdinal: (sourceContext = null) => resolveContextSnapshot(sourceContext || context).interludeOrdinal
        },
        utils: {
            calculateCrc: (text) => {
                const { calculateCrc } = require('../../utils.js');
                return calculateCrc(text);
            },
            sanitizeForCrc: (text) => {
                const { sanitizeForCrc } = require('../../utils.js');
                return sanitizeForCrc(text);
            },
            cleanTtsText: (text) => {
                const { cleanTtsText } = require('../../utils.js');
                return cleanTtsText(text);
            },
            normalizeText: (text) => {
                const { normalizeText } = require('../../utils.js');
                return normalizeText(text);
            },
            generateHash: (content, algo) => {
                const { generateHash } = require('../../utils.js');
                return generateHash(content, algo);
            }
        },
        assets: assetsTools,
        turns: turnsTools,
        pipeline: {
            abort: (reason) => {
                throw new PipelineAbortError(reason, pluginId);
            }
        },
        status: {
            update: statusUpdate,
            clear: statusClear,
            hook: (message, options = {}) => {
                if (extra && typeof extra.reportHookStatus === 'function') {
                    return extra.reportHookStatus(message, options);
                }
            },
            showTemporary: (message, timeout = 3000, color = null) => sendUiNotification({ id: `${pluginId}_temp_${Date.now()}`, message, timeout, color }),
            withTask: statusWithTask
        },
        jobs: jobsTools,
        interludes: {
            createProgrammatic: async (payload = {}) => {
                if (!pluginManager.chapterManager) {
                    throw new Error(`tools.interludes failed: Chat DB manager not available for plugin '${pluginId}'.`);
                }

                const parentTurnNumber = Number.parseInt(payload?.parentTurnNumber, 10);
                if (!Number.isInteger(parentTurnNumber) || parentTurnNumber < 1) {
                    throw new Error('tools.interludes.createProgrammatic requires a positive parentTurnNumber.');
                }

                const parentTurn = await pluginManager.chapterManager.getTurnContextByCreationTurnNumber(parentTurnNumber);
                if (!parentTurn) {
                    throw new Error(`Parent turn ${parentTurnNumber} not found.`);
                }
                if (!Number.isInteger(parentTurn.dbId) || parentTurn.dbId < 1) {
                    throw new Error(`Parent turn ${parentTurnNumber} is missing a database id.`);
                }

                const resolvedPluginId = String(payload?.pluginId || pluginId || '').trim() || pluginId;
                const label = typeof payload?.label === 'string' && payload.label.trim()
                    ? payload.label.trim()
                    : (typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Programmatic Interlude');
                const fulltext = typeof payload?.fulltext === 'string' ? payload.fulltext.trim() : '';
                const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
                const synopsis = typeof payload?.synopsis === 'string' ? payload.synopsis.trim() : '';
                const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : label;
                const rootDirectory =
                    parentTurn.runtime?.rootDirectory ||
                    parentTurn.rootDirectory ||
                    context?.runtime?.rootDirectory ||
                    context?.rootDirectory ||
                    resolvedRoot ||
                    null;
                const chatDbFullPath = parentTurn.chatDbFullPath || context?.chatDbFullPath || null;
                const interludeContext = new TurnContext(
                    parentTurn.projectName || context?.projectName || 'default_project',
                    chatDbFullPath,
                    rootDirectory,
                    parentTurn.input?.playerCharacterName || context?.input?.playerCharacterName || null,
                    parentTurn.input?.playerCharacterBio || context?.input?.playerCharacterBio || null
                );

                interludeContext.setChapterManagement(pluginManager.chapterManager);
                interludeContext.sceneMode = 'interlude';
                interludeContext.parentTurnDbId = parentTurn.dbId;
                interludeContext.turnNumber = parentTurn.turnNumber;
                interludeContext.creationTurnNumber = parentTurn.creationTurnNumber || parentTurn.turnNumber;
                interludeContext.input.userPrompt = typeof payload?.prompt === 'string' ? payload.prompt : label;
                interludeContext.input.selectedFiles = Array.isArray(parentTurn.input?.selectedFiles) ? parentTurn.input.selectedFiles : [];
                interludeContext.input.directives = parentTurn.input?.directives || {};
                interludeContext.runtime.rootDirectory = rootDirectory;
                interludeContext.runtime.turnPipeline = {
                    runProfileId: 'programmatic_interlude',
                    mode: 'interlude',
                    sceneMode: 'interlude',
                    persistenceMode: 'virtual',
                    canonicalWrites: false,
                    awaitBackgroundTasks: false,
                    hookPolicy: 'opt-in',
                    programmatic: true
                };
                interludeContext.runtime.interlude = {
                    pluginId: resolvedPluginId,
                    parentTurnNumber: parentTurn.turnNumber,
                    label,
                    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
                    isStoryRelevant: payload?.isStoryRelevant !== false
                };
                interludeContext.processed.narrativeEngine.writerResponse = fulltext || summary || synopsis || label;
                interludeContext.processed.dialogueProcessor.dialogue = fulltext || summary || synopsis || label;
                interludeContext.output.title = title;
                interludeContext.output.abstractTitle = typeof payload?.abstractTitle === 'string' ? payload.abstractTitle : '';
                interludeContext.output.summary = summary || synopsis || fulltext.slice(0, 600);
                interludeContext.output.synopsis = synopsis || summary || fulltext.slice(0, 300);
                interludeContext.output.sequence = [{
                    line: fulltext || summary || synopsis || label,
                    text: fulltext || summary || synopsis || label,
                    type: 'narrative',
                    isProgrammaticInterlude: true
                }];
                interludeContext.thumbnail = payload?.thumbnail || null;

                const saved = await pluginManager.chapterManager.appendInterlude(parentTurn.dbId, interludeContext, {
                    label,
                    thumbnail: payload?.thumbnail || null,
                    isStoryRelevant: payload?.isStoryRelevant !== false,
                    integrationNote: typeof payload?.integrationNote === 'string' ? payload.integrationNote : null,
                    refreshParentMemory: payload?.refreshParentMemory !== false
                });

                const baseTurnNumber = interludeContext.creationTurnNumber || parentTurn.turnNumber;
                interludeContext.interludeOrdinal = saved.ordinal;
                interludeContext.runtime.interlude = {
                    ...(interludeContext.runtime.interlude || {}),
                    id: saved.id,
                    ordinal: saved.ordinal,
                    storageTurnKey: `${baseTurnNumber}.${saved.ordinal}`,
                    integrationState: saved.integrationState
                };

                return {
                    interludeId: saved.id,
                    ordinal: saved.ordinal,
                    displayTurn: `${baseTurnNumber}.${saved.ordinal}`,
                    isStoryRelevant: saved.isStoryRelevant,
                    integrationState: saved.integrationState,
                    parentRefresh: saved.parentRefresh || null
                };
            }
        },
        network: {
            /**
             * Registers a dynamic route on the Express app for the plugin.
             * Routes are automatically prefixed with /plugins/[pluginId]/
             * @param {string} method - 'GET', 'POST', 'PUT', 'DELETE', etc.
             * @param {string} routePath - The path relative to the plugin's namespace.
             * @param {Function} handler - (req, res, tools) => { ... }
             */
            registerRoute: (method, routePath, handler) => {
                if (!pluginManager.appExpress) {
                    Logger.warn('PluginManager', `Plugin '${pluginId}' tried to register a route but appExpress is not available.`);
                    return;
                }

                const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
                const fullPath = `/plugins/${pluginId}${normalizedPath}`;
                const expressMethod = method.toLowerCase();
                const routeKey = `${expressMethod}:${fullPath}`;

                if (pluginManager.registeredRoutes.has(routeKey)) {
                    return; // Already registered
                }

                if (typeof pluginManager.appExpress[expressMethod] !== 'function') {
                    Logger.error('PluginManager', `Invalid HTTP method '${method}' requested by plugin '${pluginId}'.`);
                    return;
                }

                Logger.log('PluginManager', `Registering dynamic route for plugin '${pluginId}': ${method.toUpperCase()} ${fullPath}`);
                pluginManager.registeredRoutes.add(routeKey);

                pluginManager.appExpress[expressMethod](fullPath, async (req, res) => {
                    Logger.log('PluginManager', `Route hit: ${method.toUpperCase()} ${fullPath} for plugin '${pluginId}'`);
                    try {
                        // Re-fetch context for each request to ensure it uses the latest snapshot
                        const currentContext = pluginManager.currentTurnContext;
                        const requestTools = buildTools(pluginManager, pluginId, currentContext);
                        await handler(req, res, requestTools);
                    } catch (error) {
                        Logger.error('PluginManager', `Error handling dynamic route '${fullPath}' for plugin '${pluginId}':`, error);
                        if (!res.headersSent) {
                            res.status(500).send({ error: 'Internal Plugin Error', message: error.message });
                        }
                    }
                });
            }
        },
        logger: {
            log: (...args) => Logger.log(`Plugin:${pluginId}`, ...args),
            error: (...args) => Logger.error(`Plugin:${pluginId}`, ...args),
            warn: (...args) => Logger.warn(`Plugin:${pluginId}`, ...args),
            llmRequest: (titleOrObj, content, model, provider) => {
                if (typeof titleOrObj === 'object' && titleOrObj !== null && !Array.isArray(titleOrObj)) {
                    return TurnLogger.logRequest(titleOrObj);
                }
                return TurnLogger.logRequest(titleOrObj, content, model, provider);
            },
            llmResponse: (titleOrObj, content, model, provider) => {
                if (typeof titleOrObj === 'object' && titleOrObj !== null && !Array.isArray(titleOrObj)) {
                    return TurnLogger.logResponse(titleOrObj);
                }
                return TurnLogger.logResponse(titleOrObj, content, model, provider);
            },
            turn: (titleOrObj, content, model, provider) => {
                if (typeof titleOrObj === 'object' && titleOrObj !== null && !Array.isArray(titleOrObj)) {
                    return TurnLogger.log(titleOrObj);
                }
                return TurnLogger.log(titleOrObj, content, model, provider);
            },
            runtime: (message) => {
                if (!context || !context.runtime) return;
                if (!context.runtime.plugins) context.runtime.plugins = {}; // Failsafe
                if (!context.runtime.plugins[pluginId] || typeof context.runtime.plugins[pluginId] !== 'object') {
                    context.runtime.plugins[pluginId] = {};
                }
                if (!Array.isArray(context.runtime.plugins[pluginId].logs)) {
                    context.runtime.plugins[pluginId].logs = [];
                }

                const timestamp = new Date().toLocaleTimeString();
                const logEntry = `[${timestamp}] ${message}`;
                context.runtime.plugins[pluginId].logs.push(logEntry);
            }
        },
        director: {
            /**
             * Returns Director feedback from the previous turn.
             * By default, plugins only receive their own feedback.
             * @param {Object} [options] - Set allPlugins to true to fetch feedback for every plugin.
             * @returns {Promise<string|Object>}
             */
            getFeedback: async (options = {}) => {
                const allPlugins = options === true || options?.allPlugins === true;
                if (typeof context?.getPreviousChapter !== 'function') return allPlugins ? {} : '';

                try {
                    const previousTurn = await context.getPreviousChapter();
                    const stored = previousTurn?.processed?.director?.pluginFeedback?.byPlugin;
                    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return allPlugins ? {} : '';

                    const feedbackByPlugin = {};
                    for (const [storedPluginId, entry] of Object.entries(stored)) {
                        const feedback = typeof entry === 'string'
                            ? entry.trim()
                            : String(entry?.feedback || '').trim();
                        const assessment = typeof entry === 'object'
                            ? String(entry?.assessment || '').trim().toUpperCase()
                            : '';
                        if (feedback) {
                            feedbackByPlugin[storedPluginId] = assessment
                                ? `Director assessment: ${assessment}\n${feedback}`
                                : feedback;
                        }
                    }
                    return allPlugins ? feedbackByPlugin : (feedbackByPlugin[pluginId] || '');
                } catch (error) {
                    Logger.warn(`Plugin:${pluginId}`, `Could not read previous-turn Director plugin feedback: ${error.message}`);
                    return allPlugins ? {} : '';
                }
            },
            /**
             * Registers a mechanical capability (e.g. Combat, Traveling) for the Director to consider.
             * @param {Object} config - { phase, description, handoffHint, writerBoundaryRule, writerBoundaryLabel }
             */
            registerCapability: (config) => {
                const directorRuntime = ensureDirectorRuntime(context);
                if (!directorRuntime) return;
                const { phase, description, handoffHint, writerBoundaryRule, writerBoundaryLabel } = config || {};
                directorRuntime.registeredCapabilities.push({
                    phase,
                    pluginId,
                    description,
                    handoffHint,
                    writerBoundaryRule,
                    writerBoundaryLabel
                });
            },
            cot: {
                add: (config = {}) => {
                    registerDirectorCotPatch(context, pluginId, Logger, {
                        type: 'add',
                        id: config.id,
                        step: config.step,
                        title: config.title,
                        content: config.content
                    });
                },
                override: (config = {}) => {
                    registerDirectorCotPatch(context, pluginId, Logger, {
                        type: 'override',
                        id: config.id,
                        target: config.target,
                        title: config.title,
                        content: config.content
                    });
                },
                disable: (config = {}) => {
                    registerDirectorCotPatch(context, pluginId, Logger, {
                        type: 'disable',
                        id: config.id,
                        target: config.target,
                        reason: config.reason
                    });
                },
                remove: (id) => {
                    registerDirectorCotPatch(context, pluginId, Logger, {
                        type: 'remove',
                        id
                    });
                }
            },
            ledger: {
                registerSection: (config = {}) => {
                    registerDirectorLedgerSection(context, pluginId, Logger, config);
                },
                read: async (options = {}) => {
                    return await readDirectorLedgerEntries(context, options);
                }
            }
        },
        writer: {
            cot: {
                add: (config = {}) => {
                    registerWriterCotInsertion(context, pluginId, Logger, config);
                }
            }
        },
        settings: {
            get: (key) => {
                const all = readSettings();
                if (!key) return all;

                // Simple dot-notation resolver
                const resolve = (obj, path) => {
                    return path.split('.').reduce((prev, curr) => {
                        return prev ? prev[curr] : undefined;
                    }, obj);
                };

                let val = resolve(all, key);
                
                // Fallback: If not found at root, check if it's a plugin ID
                if (val === undefined && !key.includes('.')) {
                    val = all.plugins ? all.plugins[key] : undefined;
                }

                return val;
            },
            getSelf: () => {
                const all = readSettings();
                const selfSettings = (all.plugins && all.plugins[pluginId]) ? { ...all.plugins[pluginId] } : {};
                
                // Fallback to defaults from schema if keys are missing
                const plugin = pluginManager.plugins.get(pluginId);
                if (plugin && plugin.settingsSchema) {
                    for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                        if (selfSettings[key] === undefined && schema.default !== undefined) {
                            selfSettings[key] = schema.default;
                        }
                    }
                }

                // Merge secrets (OS-bound)
                const secrets = SecureStorage.getPluginSecrets(pluginId);
                return { ...selfSettings, ...secrets };
            },
            set: async (key, value) => {
                return await updateSettings(`plugins.${pluginId}.${key}`, value);
            },
            update: async (obj) => {
                const current = (readSettings().plugins && readSettings().plugins[pluginId]) ? readSettings().plugins[pluginId] : {};
                const merged = { ...current, ...obj };
                return await updateSettings(`plugins.${pluginId}`, merged);
            }
        },
        directives: {
            /**
             * Retrieves a project-specific directive for this plugin or another module.
             * @param {string} [id] - The ID of the module. Defaults to current pluginId.
             * @param {string} [fieldKey='creative_style'] - The field key.
             * @returns {string}
             */
            get: (id = pluginId, fieldKey = 'creative_style') => {
                if (typeof turnContext?.getDirective !== 'function') return '';
                return turnContext.getDirective(id, fieldKey);
            },
            /**
             * Convenience method for a plugin to get its own project directive.
             * @param {string} [fieldKey='creative_style']
             * @returns {string}
             */
            getSelf: (fieldKey = 'creative_style') => {
                if (typeof turnContext?.getDirective !== 'function') return '';
                return turnContext.getDirective(pluginId, fieldKey);
            },
            /**
             * Returns a formatted directive block (with header) or empty string if blank.
             * @param {string} [id] - Defaults to current pluginId.
             * @param {Object} [options] - Formatting options (header, fieldKey).
             * @returns {string}
             */
            getFormatted: (id = pluginId, options = {}) => {
                if (typeof turnContext?.getFormattedDirective !== 'function') return '';
                return turnContext.getFormattedDirective(id, options);
            }
        },
        agent: {
            startAgent: async (options = {}) => {
                const agentOptions = (options && typeof options === 'object') ? { ...options } : {};
                if (typeof agentOptions.callModel !== 'function') {
                    agentOptions.callModel = async ({ messages, llm = {}, expectJson = false, validateAction = null }) => {
                        return await llmCall(messages, {
                            ...llm,
                            expectJson,
                            validateFn: validateAction,
                            callingModule: llm.callingModule || `Plugin:${pluginId}:Agent`
                        });
                    };
                }
                return await startAgent(agentOptions);
            },
            defineTool: defineAgentTool,
            createDummyTools: createDummyAgentTools
        },
        llm: {
            call: llmCall,
            runTask: llmRunTask,
            json: llmJson,
            repairJson: llmRepairJson,
            withSchema: llmWithSchema,
            batch: llmBatch,
            getActiveModels: llmGetActiveModels,
            getCoreModel: (moduleId, role = 'main') => getLlmModelRegistry().getCoreModel(moduleId, role),
            getCoreModels: (moduleId = null) => getLlmModelRegistry().getCoreModels(moduleId),
            getPluginModel: (targetPluginId, settingKey = 'model_def') => getLlmModelRegistry().getPluginModel(targetPluginId, settingKey),
            getPluginModels: (targetPluginId = null) => getLlmModelRegistry().getPluginModels(targetPluginId),
            resolveModelDefinition: llmResolveModelDefinition,
            vnBackground: getVnBackgroundTools(),
            countTokens: (text) => {
                if (!text) return 0;
                // Rough estimate for context budgeting: 4 chars per token is standard for average prose
                return Math.ceil(text.length / 4);
            }
        },
        gui: {
            registerIntercept: (descriptor = {}, options = {}) => {
                const lane = options.runtime === true || options.persistence === 'runtime'
                    ? 'runtime'
                    : 'persisted';
                return registerInterceptInternal(descriptor, lane);
            },
            registerPersistentIntercept: (descriptor = {}) => {
                return registerInterceptInternal(descriptor, 'persisted');
            },
            registerRuntimeIntercept: (descriptor = {}) => {
                return registerInterceptInternal(descriptor, 'runtime');
            },
            clearIntercepts: ({ lane = 'both' } = {}) => {
                if (!context) return;
                if ((lane === 'persisted' || lane === 'both') && context.output) {
                    context.output.guiIntercepts = [];
                }
                if ((lane === 'runtime' || lane === 'both') && context.runtime) {
                    context.runtime.guiIntercepts = [];
                }
            },
            inject: (payload, targetView = null) => {
                Logger.log('PluginManager', `Plugin '${pluginId}' is injecting into ${targetView || 'active view'}`);
                const eventData = { ...payload, targetView: targetView || '*' };
                if (targetView) {
                    pluginManager.io.to(`view:${targetView}`).emit('gui-plugin-inject', eventData);
                } else {
                    pluginManager.io.emit('gui-plugin-inject', eventData);
                }
            },
            /**
             * Opens a new Electron window for a plugin-specific Single Page Application (SPA).
             * @param {Object} options - { title, path, width, height, webPreferences }
             */
            openWindow: (options = {}) => {
                const { BrowserWindow } = require('electron');
                const path = require('path');
                const fs = require('fs');
                
                // Resolve path relative to the plugin directory
                const pluginDir = path.join(pluginManager.pluginsDir, pluginId);
                let viewPath = options.path;
                if (!path.isAbsolute(viewPath)) {
                    viewPath = path.join(pluginDir, viewPath);
                }

                // Use engine icon (engine/icon.png)
                const engineIconPath = path.resolve(path.join(__dirname, '../../../icon.png'));
                const { nativeImage } = require('electron');
                const winIcon = fs.existsSync(engineIconPath) ? nativeImage.createFromPath(engineIconPath) : null;

                let win = new BrowserWindow({
                    width: options.width || 1024,
                    height: options.height || 768,
                    title: options.title || `Plugin Window - ${pluginId}`,
                    icon: (winIcon && !winIcon.isEmpty()) ? winIcon : undefined,
                    show: true,
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        ...(options.webPreferences || {})
                    }
                });

                if (winIcon && !winIcon.isEmpty()) {
                    win.setIcon(winIcon);
                }

                const runtimeSocketQuery = {};
                if (process.env.FABLEKIN_SOCKET_PROTOCOL) runtimeSocketQuery.socketProtocol = process.env.FABLEKIN_SOCKET_PROTOCOL;
                if (process.env.FABLEKIN_SOCKET_HOST) runtimeSocketQuery.socketHost = process.env.FABLEKIN_SOCKET_HOST;
                if (process.env.FABLEKIN_SOCKET_PORT) runtimeSocketQuery.socketPort = process.env.FABLEKIN_SOCKET_PORT;
                if (process.env.FABLEKIN_SOCKET_TOKEN) runtimeSocketQuery.socketToken = process.env.FABLEKIN_SOCKET_TOKEN;

                if (Object.keys(runtimeSocketQuery).length > 0) {
                    win.loadFile(viewPath, { query: runtimeSocketQuery });
                } else {
                    win.loadFile(viewPath);
                }
                
                win.on('closed', () => {
                    win = null;
                });

                return win;
            }
        },
        prompt: {
            wrap: (tagName, content, attributes = {}) => {
                if (!content) return '';
                const trimmed = typeof content === 'string' ? content.trim() : content;
                const attrStr = Object.entries(attributes)
                    .map(([key, val]) => ` ${key}="${val}"`)
                    .join('');
                return `<${tagName}${attrStr}>
${trimmed}
</${tagName}>`;
            },
            inject: (slot, content, target = 'root', options = {}) => {
                if (!context || !context.promptComponents) return;
                if (target === 'root') {
                    const { isSharedPrefixFrozen } = require('../../shared_narrative_prompt.js');
                    if (isSharedPrefixFrozen(context)) {
                        Logger.warn(`Plugin:${pluginId}`, `Rejected late shared prompt injection into root.${slot}; HOOK_PRE_ORCHESTRATOR is the final shared-prefix mutation point.`);
                        return false;
                    }
                }
                const pillar = context.promptComponents[target];
                if (pillar && pillar[slot]) {
                    const injectedContent = options?.directable === true
                        ? wrapDirectablePluginPrompt(pluginId, content)
                        : content;
                    pillar[slot].push(injectedContent);
                    return true;
                } else {
                    Logger.warn(`Plugin:${pluginId}`, `Attempted to inject into invalid target/slot: ${target}.${slot}`);
                    return false;
                }
            }
        },
        socket: {
            emit: (event, data) => {
                if (activeSocket) {
                    activeSocket.emit(event, data);
                } else {
                    if (pluginManager.io) pluginManager.io.emit(event, data);
                }
            },
            broadcast: (event, data) => {
                if (pluginManager.io) pluginManager.io.emit(event, data);
            }
        },
        vector: {
            embed: async (text) => {
                const { embeddings } = require('../../memory_manager/storage/vector_store_manager.js');
                return await embeddings.embedQuery(text);
            },
            add: async (documents, suffix = 'default') => {
                const { getStore } = require('../../memory_manager/storage/vector_store_manager.js');
                const projectName = context?.projectName || 'default';
                const isolatedSuffix = `p_${pluginId}_${suffix}`;
                const store = await getStore(projectName, isolatedSuffix);

                const docs = Array.isArray(documents) ? documents : [documents];
                const formattedDocs = docs.map(doc => {
                    if (typeof doc === 'string') {
                        return { pageContent: doc, metadata: { pluginId, projectName, timestamp: new Date().toISOString() } };
                    }
                    return {
                        ...doc,
                        metadata: {
                            ...(doc.metadata || {}),
                            pluginId,
                            projectName,
                            timestamp: new Date().toISOString()
                        }
                    };
                });
                return await store.addDocuments(formattedDocs);
            },
            query: async (queryText, k = 4, filter = null, suffixOrOptions = 'default') => {
                const { getStore } = require('../../memory_manager/storage/vector_store_manager.js');
                const projectName = context?.projectName || 'default';

                // Phase 2: Automatic Temporal Boundary
                let temporalFilter = filter;
                if (context && context.turnNumber && !context.isFallbackContext) {
                    const turnBoundary = `turn_number <= ${context.turnNumber}`;
                    if (!temporalFilter) {
                        temporalFilter = turnBoundary;
                    } else if (typeof temporalFilter === 'string') {
                        if (!temporalFilter.includes('turn_number')) {
                            temporalFilter = `(${temporalFilter}) AND ${turnBoundary}`;
                        }
                    } else if (typeof temporalFilter === 'object') {
                        // Support for MongoDB-style filters used in translateFilter
                        if (!temporalFilter.$and) {
                            temporalFilter = { $and: [temporalFilter, { turn_number: { $lte: context.turnNumber } }] };
                        } else {
                            temporalFilter.$and.push({ turn_number: { $lte: context.turnNumber } });
                        }
                    }
                }

                if (typeof suffixOrOptions === 'object' && suffixOrOptions.isRawPath && suffixOrOptions.path) {
                    Logger.log(`Plugin:${pluginId}`, `Querying external LanceDB at: ${suffixOrOptions.path}`);
                    const store = await getStore(projectName, null, { rawPath: suffixOrOptions.path });
                    return await store.similaritySearch(queryText, k, temporalFilter);
                }

                const suffix = typeof suffixOrOptions === 'string' ? suffixOrOptions : 'default';
                const targetSuffix = suffix === '__global__' ? 'global' : `p_${pluginId}_${suffix}`;
                const store = await getStore(projectName, targetSuffix);
                return await store.similaritySearch(queryText, k, temporalFilter);
            },
            delete: async (suffixOrFilter = 'default', possibleFilter = null) => {
                const { getStore, deleteStore } = require('../../memory_manager/storage/vector_store_manager.js');
                const projectName = context?.projectName || 'default';

                let suffix = 'default';
                let filter = null;

                if (possibleFilter) {
                    suffix = suffixOrFilter;
                    filter = possibleFilter;
                } else if (typeof suffixOrFilter === 'object') {
                    filter = suffixOrFilter;
                } else {
                    suffix = suffixOrFilter;
                }

                const isolatedSuffix = `p_${pluginId}_${suffix}`;

                if (filter) {
                    const store = await getStore(projectName, isolatedSuffix);
                    return await store.delete(filter);
                } else {
                    return await deleteStore(projectName, isolatedSuffix);
                }
            }
        },
        facts: {
            getScope: (overrides = {}) => resolveFactScope(overrides),
            getFormattedLedger: async (category, projectNameOrOptions = null, maxTurnNumber = undefined) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                let projectName = context?.projectName || 'default_project';
                let scopedMaxTurn = context?.turnNumber ?? null;

                if (typeof projectNameOrOptions === 'string' && projectNameOrOptions.trim()) {
                    projectName = projectNameOrOptions;
                    scopedMaxTurn = maxTurnNumber ?? scopedMaxTurn;
                } else if (Number.isFinite(Number(projectNameOrOptions))) {
                    scopedMaxTurn = Number(projectNameOrOptions);
                } else if (projectNameOrOptions && typeof projectNameOrOptions === 'object') {
                    if (typeof projectNameOrOptions.projectName === 'string' && projectNameOrOptions.projectName.trim()) {
                        projectName = projectNameOrOptions.projectName;
                    }
                    scopedMaxTurn = projectNameOrOptions.maxTurnNumber
                        ?? projectNameOrOptions.turnNumber
                        ?? scopedMaxTurn;
                }

                return await factManager.getFormattedLedger(category, projectName, scopedMaxTurn);
            },
            processLedgerOperations: async (operationsText, category) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const projectName = context?.projectName || 'default_project';
                const turnNumber = context?.turnNumber || 0;
                return await factManager.processLedgerOperations(operationsText, turnNumber, projectName, category);
            },
            getLatestFactsByPredicate: async (predicate) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const projectName = context?.projectName || 'default_project';
                const turnNumber = context?.turnNumber || null;
                return await factManager.getLatestFactsByPredicate(predicate, projectName, turnNumber);
            },
            addFact: async (fact) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const scope = resolveFactScope();
                const factToStore = {
                    turn_number: scope.turn_number,
                    turn_key: scope.turn_key,
                    scene_mode: scope.scene_mode,
                    interlude_id: scope.interlude_id,
                    interlude_ordinal: scope.interlude_ordinal,
                    plugin_id: scope.plugin_id,
                    ...fact
                };
                return await factManager.addFact(factToStore, scope.projectName);
            },
            upsert: async (fact, overrides = {}) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const scope = resolveFactScope(overrides);
                const factToStore = {
                    turn_number: scope.turn_number,
                    turn_key: scope.turn_key,
                    scene_mode: scope.scene_mode,
                    interlude_id: scope.interlude_id,
                    interlude_ordinal: scope.interlude_ordinal,
                    plugin_id: scope.plugin_id,
                    ...fact
                };
                return await factManager.addFact(factToStore, scope.projectName);
            },
            appendToFactsDb: async (fact, overrides = {}) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const scope = resolveFactScope(overrides);
                const factToStore = {
                    turn_number: scope.turn_number,
                    turn_key: scope.turn_key,
                    scene_mode: scope.scene_mode,
                    interlude_id: scope.interlude_id,
                    interlude_ordinal: scope.interlude_ordinal,
                    plugin_id: scope.plugin_id,
                    ...fact
                };
                return await factManager.addFact(factToStore, scope.projectName);
            },
            cleanUpFactsDb: async (options = {}) => {
                const factManager = require('../../memory_manager/storage/fact_manager.js');
                const scope = resolveFactScope(options);
                const cleanupResult = await factManager.clearFactsForScope({
                    turn_number: scope.turn_number,
                    turn_key: scope.turn_key,
                    plugin_id: scope.plugin_id,
                    source: options?.source,
                    target: options?.target,
                    predicates: options?.predicates
                }, scope.projectName);

                // Safety by default: prune interlude orphans after scoped cleanup.
                // Guarded to run once per project+turn_key within this runtime context.
                const pruneProject = String(scope.projectName || '').toLowerCase();
                const pruneKey = `${pruneProject}::${scope.turn_key}`;
                if (!context.runtime || typeof context.runtime !== 'object') context.runtime = {};
                if (!context.runtime.__factsOrphanPruneKeys || typeof context.runtime.__factsOrphanPruneKeys !== 'object') {
                    context.runtime.__factsOrphanPruneKeys = {};
                }
                if (!context.runtime.__factsOrphanPruneKeys[pruneKey]) {
                    await factManager.pruneOrphanInterludeFacts(scope.projectName);
                    context.runtime.__factsOrphanPruneKeys[pruneKey] = true;
                }

                return cleanupResult;
            }
        },
        db: {
            chat: {
                query: (sql, params) => {
                    if (!pluginManager.chapterManager) throw new Error("Chat DB Manager not available.");
                    return pluginManager.chapterManager.genericQuery(sql, params);
                },
                execute: (sql, params) => {
                    if (!pluginManager.chapterManager) throw new Error("Chat DB Manager not available.");
                    return pluginManager.chapterManager.genericExecute(sql, params);
                },
                getTurnContext: (index) => {
                    if (!pluginManager.chapterManager) throw new Error("Chat DB Manager not available.");
                    return pluginManager.chapterManager.getTurnContext(index);
                }
            },
            project: {
                query: (sql, params) => {
                    if (!pluginManager.staticDataManager) throw new Error("Project DB Manager not available.");
                    return pluginManager.staticDataManager.genericQuery(sql, params);
                },
                execute: (sql, params) => {
                    if (!pluginManager.staticDataManager) throw new Error("Project DB Manager not available.");
                    return pluginManager.staticDataManager.genericExecute(sql, params);
                }
            },
            open: async (dbPath) => {
                const sqlite3 = require('sqlite3');
                const { open } = require('sqlite');
                const db = await open({ filename: dbPath, driver: sqlite3.Database });
                return {
                    execute: (sql, params = []) => db.run(sql, params),
                    query: (sql, params = []) => db.all(sql, params),
                    get: (sql, params = []) => db.get(sql, params),
                    exec: (sql) => db.exec(sql),
                    close: () => db.close()
                };
            }
        },
        engine: {
            /**
             * Checks if a core narrative module (agent) is enabled in settings.
             * @param {string} moduleId - The ID of the module (e.g., 'director', 'summarizer').
             * @returns {boolean}
             */
            isModuleEnabled: (moduleId) => {
                const settings = readSettings();
                const agents = settings.narrative_agents || {};
                const agent = agents[moduleId];
                if (!agent) return false;
                
                // Critical modules that cannot be disabled
                if (agent.disabled_behavior && agent.disabled_behavior.toLowerCase().includes("critical")) return true;
                
                // Standard modules with an enabled toggle
                return agent.enabled !== false;
            }
        },
        plugins: {
            list: () => Array.from(pluginManager.plugins.keys()),
            isInstalled: (id) => pluginManager.plugins.has(id),
            get: (id) => pluginManager.plugins.get(id),
            getMetadata: (id) => {
                const plugin = pluginManager.plugins.get(id);
                if (!plugin) return null;
                return {
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || 'unknown'
                };
            },
            call: (targetPluginId, functionName, ...args) => {
                return pluginManager.callPluginFunction(targetPluginId, functionName, context, ...args);
            },
            tryCall: async (targetPluginId, functionName, args = [], options = {}) => {
                const normalizedArgs = Array.isArray(args) ? args : [args];
                const opts = (options && typeof options === 'object') ? options : {};
                const resolveFallback = (meta = {}) => {
                    if (typeof opts.fallback === 'function') return opts.fallback(meta);
                    return opts.fallback;
                };

                if (!pluginManager.plugins.has(targetPluginId)) {
                    if (!opts.silent) {
                        Logger.warn(`Plugin:${pluginId}`, `tryCall skipped: plugin '${targetPluginId}' is not installed.`);
                    }
                    if (typeof opts.onMissing === 'function') {
                        await opts.onMissing({ targetPluginId, functionName });
                    }
                    return resolveFallback({ reason: 'missing_plugin', targetPluginId, functionName });
                }

                try {
                    return await pluginManager.callPluginFunction(targetPluginId, functionName, context, ...normalizedArgs);
                } catch (error) {
                    if (!opts.silent) {
                        Logger.warn(`Plugin:${pluginId}`, `tryCall failed: ${targetPluginId}.${functionName} -> ${error.message}`);
                    }
                    if (typeof opts.onError === 'function') {
                        await opts.onError(error, { targetPluginId, functionName, args: normalizedArgs });
                    }
                    if (opts.rethrow) throw error;
                    return resolveFallback({
                        reason: 'call_error',
                        targetPluginId,
                        functionName,
                        error
                    });
                }
            },
            fireHook: async (hookName, ...args) => {
                const { executeHook } = require('./hook_executor.js');
                return await executeHook(pluginManager, hookName, context, ...args);
            }
        },
        pluginState: buildPluginStateTools(context, pluginId),
        memory: {
            create: async (rawPath) => {
                const { getStore } = require('../../memory_manager/storage/vector_store_manager.js');
                const projectName = context?.projectName || 'default';
                return await getStore(projectName, null, { rawPath });
            },
            findStore: async (dir) => {
                const fs = require('fs');
                const path = require('path');
                const isLance = (p) => {
                    try {
                        const files = fs.readdirSync(p);
                        return files.some(f => f.endsWith('.lance') || f === 'data' || f === '_latest.json');
                    } catch { return false; }
                };
                if (isLance(dir)) return dir;
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const fullPath = path.join(dir, entry.name);
                            if (isLance(fullPath)) return fullPath;
                        }
                    }
                } catch { }
                return dir;
            },
            search: async (queries, options = {}) => {
                const memorymanagement = require('../../memory_manager/memory_manager.js');
                const projectName = options.projectName || context?.projectName || 'default';
                let storeType = options.storeType || 'chapters';
                if (storeType === 'Auto') storeType = 'static_lore';
                if (storeType === 'Chapters') storeType = 'chapters';

                return await memorymanagement.memoryProcessor(Array.isArray(queries) ? queries : [queries], {
                    ...options,
                    projectName,
                    storeType
                });
            },
            customSearch: async (rawPath, queries, options = {}) => {
                const { getStore } = require('../../memory_manager/storage/vector_store_manager.js');
                const projectName = context?.projectName || 'default';
                const store = await getStore(projectName, null, { rawPath });
                const k = options.limit || options.top_k || 5;
                const filter = options.filter || null;
                const queryArr = Array.isArray(queries) ? queries : (queries ? [queries] : [null]);

                return await store.similaritySearch(queryArr[0], k, filter);
            }
        },
        project: {
            registerFileMode: (modeId, label) => {
                pluginManager.registerFileMode(modeId, label, pluginId);
            },
            /**
             * Returns the absolute and relative paths for plugin storage, isolated by chat and turn.
             * Structure: plugins/[ChatName]/[TurnStorageKey]/[PluginId]/
             * TurnStorageKey examples:
             * - Mainline: "53"
             * - Interlude: "53.1"
             * @param {number|string} [turnOverride=null] - Optional turn key override.
             * @returns {{absolutePath: string, relativePath: string, chatName: string, turnNumber: number, storageTurnKey: string}}
             */
            getChatPluginStorage: (turnOverride = null) => {
                return resolveChatPluginStorage(turnContext, turnOverride);
            },
            /**
             * Returns plugin storage paths for an explicit turn context.
             * Useful for async callbacks that finalize work for an older chapter/interlude.
             * @param {object} sourceTurnContext - The turn context to resolve storage against.
             * @param {number|string} [turnOverride=null] - Optional turn key override.
             * @returns {{absolutePath: string, relativePath: string, chatName: string, turnNumber: number, storageTurnKey: string}}
             */
            getChatPluginStorageFromContext: (sourceTurnContext, turnOverride = null) => {
                return resolveChatPluginStorage(sourceTurnContext, turnOverride);
            },
            /**
             * Returns project-wide storage paths isolated to the current plugin.
             * Structure: plugins/[PluginId]/
             * Unlike getChatPluginStorage(), this path is not tied to a chat or turn.
             */
            getPluginStorage: () => {
                return resolveProjectPluginStorage(
                    resolvedRoot,
                    pluginId,
                    context?.projectName || pluginManager.staticDataManager?.projectName
                );
            },
            getFrontendAssetPrefix: () => {
                // Returns the relative path from a plugin UI (running in engine/plugins/[pluginId]/)
                // to the workspace/projects/ directory.
                // engine/plugins/[pluginId]/ -> .. (plugins) -> .. (engine) -> .. (root) -> workspace/projects/
                return "../../../workspace/projects";
            },
            resolveAssetUrl: (assetPath) => {
                return assetsTools.resolveUrl(assetPath);
            },
            glob: async (pattern) => {
                const { glob } = require('glob');
                const root = resolvedRoot;
                if (!root) {
                    Logger.warn(`Plugin:${pluginId}`, "glob failed: No project root directory available.");
                    return [];
                }
                try {
                    const matches = await glob(pattern, { cwd: root, absolute: true });
                    return matches.map(m => ({
                        name: path.basename(m),
                        path: m
                    }));
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Glob search failed for ${pattern}: ${err.message}`);
                    return [];
                }
            },
            listFiles: async (extension = null) => {
                const root = resolvedRoot;
                if (!root) {
                    Logger.warn(`Plugin:${pluginId}`, "listFiles failed: No project root directory available.");
                    return [];
                }
                try {
                    const entries = await fs.readdir(root, { withFileTypes: true });
                    let files = entries
                        .filter(e => e.isFile())
                        .map(e => ({
                            name: e.name,
                            path: path.join(root, e.name)
                        }));
                    if (extension) {
                        files = files.filter(f => f.name.endsWith(extension));
                    }
                    return files;
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to list project files: ${err.message}`);
                    return [];
                }
            },
            listDirs: async () => {
                const root = resolvedRoot;
                if (!root) {
                    Logger.warn(`Plugin:${pluginId}`, "listDirs failed: No project root directory available.");
                    return [];
                }
                try {
                    const entries = await fs.readdir(root, { withFileTypes: true });
                    return entries
                        .filter(e => e.isDirectory() && !['plugins', 'vectors'].includes(e.name))
                        .map(e => ({
                            name: e.name,
                            path: path.join(root, e.name)
                        }));
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to list project directories: ${err.message}`);
                    return [];
                }
            },
            readFile: async (fileNameOrPath, encoding = 'utf8') => {
                const root = resolvedRoot;
                if (!root) throw new Error("No project root directory available.");

                let fullPath = fileNameOrPath;
                if (!path.isAbsolute(fileNameOrPath)) {
                    fullPath = path.join(root, fileNameOrPath);
                }

                if (!isPathInsideRoot(fullPath, root)) {
                    throw new Error(`Access denied: Attempted to read file outside of project directory. Root: ${root}, Target: ${fullPath}`);
                }

                return await fs.readFile(fullPath, encoding);
            },
            getSelectedFiles: async () => {
                if (activeSocket && typeof activeSocket.emitReceive === 'function') {
                    const response = await activeSocket.emitReceive('get-selected-files', {});
                    if (response) {
                        if (response.success && Array.isArray(response.selectedFiles)) {
                            return response.selectedFiles;
                        }
                        if (Array.isArray(response)) {
                            return response;
                        }
                    }
                }

                if (context && context.input && Array.isArray(context.input.selectedFiles)) {
                    return context.input.selectedFiles;
                }

                return [];
            },
            getFileConfig: async (filePath) => {
                const contentManager = require('../../content_manager/content_manager.js');
                const root = resolvedRoot;
                if (!root) return null;

                try {
                    const config = await contentManager.getFileConfig(filePath, root);
                    return config;
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to get file config for ${filePath}: ${err.message}`);
                    return null;
                }
            },
            getMetadata: async () => {
                const contentManager = require('../../content_manager/content_manager.js');
                const root = resolvedRoot;
                if (!root) return {};

                try {
                    const config = await contentManager.loadFileConfig(root);
                    return getProjectMetadata(config);
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to get project metadata: ${err.message}`);
                    return {};
                }
            },
            getFullProjectConfig: async () => {
                const contentManager = require('../../content_manager/content_manager.js');
                const root = resolvedRoot;
                if (!root) return {};

                try {
                    const config = await contentManager.loadFileConfig(root);
                    return config || {};
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to get full project config: ${err.message}`);
                    return {};
                }
            },
            updateMetadata: async (metadata) => {
                const contentManager = require('../../content_manager/content_manager.js');
                const root = resolvedRoot;
                if (!root) return;

                try {
                    const config = await contentManager.loadFileConfig(root);
                    const updatedConfig = setProjectMetadata(config, metadata);
                    await contentManager.saveFileConfig(root, updatedConfig);
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to update project metadata: ${err.message}`);
                }
            }
        },
        vn: {
            recomputeThumbnail: async (tc) => {
                try {
                    const { generateThumbnail } = require('../../vn_manager/rendering/thumbnail_generator.js');
                    const chaptermgmt = require('../../chaptermanagement.js');

                    Logger.log(`Plugin:${pluginId}`, 'Recomputing thumbnail for turn ' + tc.turnNumber);
                    const newThumbnailBase64 = await generateThumbnail(tc);
                    if (newThumbnailBase64) {
                        tc.thumbnail = newThumbnailBase64;
                        if (tc.dbId) {
                            await chaptermgmt.updateTurn(tc);
                        }
                    }
                    return newThumbnailBase64;
                } catch (err) {
                    Logger.error(`Plugin:${pluginId}`, `Failed to recompute thumbnail: ${err.message}`);
                    return null;
                }
            }
        },
        sequence: {
            get: () => sequenceApi.getSequence(context),
            getLine: (index) => sequenceApi.getLine(context, index),
            findLines: (predicate) => sequenceApi.findLines(context, predicate),
            findCharacter: (name) => sequenceApi.findCharacter(context, name),
            createEvent: (cmdString) => sequenceApi.createEvent(cmdString),
            addCommand: (lineIndex, cmdString) => sequenceApi.addCommand(context, lineIndex, cmdString),
            addCommandToCharacter: (charName, cmdString) => sequenceApi.addCommandToCharacter(context, charName, cmdString),
            addCommandToOpening: (cmdString) => sequenceApi.addCommandToOpening(context, cmdString),
            addCommandToClosing: (cmdString) => sequenceApi.addCommandToClosing(context, cmdString),
            buildShadowCommand: (charName, shadow = {}) => sequenceApi.buildShadowCommand(charName, shadow),
            addShadowCommand: (lineIndex, charName, shadow = {}) => sequenceApi.addShadowCommand(context, lineIndex, charName, shadow),
            enableShadow: (lineIndex, charName, options = {}) => sequenceApi.enableShadow(context, lineIndex, charName, options),
            disableShadow: (lineIndex, charName) => sequenceApi.disableShadow(context, lineIndex, charName)
        }
    };
}

module.exports = { buildTools, resolveProjectPluginStorage };
