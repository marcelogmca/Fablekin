const { Prompt, PreparedPrompt } = require('./prompt.js');
const { normalizePluginKey } = require('./prompt_core_catalog.js');

const ROLES = new Set(['system', 'user', 'assistant']);
const HISTORY_PRESETS = new Set(['brief', 'balanced', 'deep']);

function normalizeHistorySelection(value, what) {
    const preset = typeof value === 'string' ? value : value?.preset;
    if (typeof preset !== 'string' || !preset.trim()) {
        throw new TypeError(`${what} requires a history preset: 'brief', 'balanced', or 'deep'.`);
    }
    const name = preset.trim().toLowerCase();
    if (!HISTORY_PRESETS.has(name)) {
        throw new RangeError(`${what} has unknown history preset '${preset}'. Expected 'brief', 'balanced', or 'deep'.`);
    }
    let maxChars = null;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.maxChars !== undefined) {
        if (!Number.isInteger(value.maxChars) || value.maxChars <= 0) {
            throw new TypeError(`${what} maxChars must be a positive integer.`);
        }
        maxChars = value.maxChars;
    }
    return { preset: name, maxChars };
}

// Exact precomputed view: brief/balanced/deep strings are already assembled
// by Memory LOD during precomputeHistory(). This selects one view verbatim —
// it never rebuilds LOD, mutates root.history, or falls back to another tier.
// 'No story yet.' is a valid computed view and is sent as-is.
function resolveHistoryView(turnContext, selection, what) {
    const views = turnContext?.runtime?.historyData?.compressedHistory;
    if (!views || typeof views !== 'object') {
        throw new Error(`${what} needs precomputed compressedHistory; run it after precomputeHistory().`);
    }
    if (!(selection.preset in views) || typeof views[selection.preset] !== 'string') {
        throw new Error(`${what} needs precomputed compressedHistory.${selection.preset}; run it after precomputeHistory().`);
    }
    const full = views[selection.preset];
    const rendered = selection.maxChars == null ? full : full.slice(0, selection.maxChars);
    return { full, rendered };
}

function describeHistoryView(selection, view) {
    const capped = selection.maxChars == null ? '' : `, first ${selection.maxChars} chars`;
    return `Precomputed ${selection.preset} compressed history (${view.full.length} chars${capped ? `, rendered ${view.rendered.length}` : ''}).`;
}

function labelFor(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

// Request-local identities do not need a plugin manifest: each call registers
// its own named pieces below a stable, plugin-scoped request id. Definitions
// are captured in PreparedPrompt.manifest for historical analysis.
function createPluginPromptScope(pluginId, requestId, { turnContext = null, pluginManager = null, rolePolicy = 'standard' } = {}) {
    const key = normalizePluginKey(requestId, 'requestId');
    const rootId = `${pluginId}.${key}`;
    const prompt = new Prompt({ id: rootId, turnContext, pluginManager, rolePolicy });
    prompt.registerDynamicComponent(rootId, {
        parent: 'core.plugin_tasks', label: labelFor(key),
        description: `Request ${key} from plugin ${pluginId}.`, owner: pluginId
    });
    const definitions = new Map();
    // Message-level history()/include() resolve through the same scope so
    // advanced compose() and structured {history}/{include} share one path.
    prompt._requestScope = null;
    const requestScope = {
        addHistoryPart(message, presetOrSelection) {
            addHistoryPart(scopeRef, message, { history: presetOrSelection }, turnContext, 'Message history part');
        }
    };

    const addPiece = (localPath, { label, description, parentId = rootId } = {}) => {
        if (typeof localPath !== 'string' || !localPath) {
            throw new TypeError('A request piece needs a non-empty id.');
        }
        let parent = parentId;
        const segments = localPath.split('.');
        for (const [index, segment] of segments.entries()) {
            const localKey = normalizePluginKey(segment, 'id');
            const fullId = `${parent}.${localKey}`;
            const leaf = index === segments.length - 1;
            const next = {
                parent, owner: pluginId,
                label: leaf && label !== undefined ? label : labelFor(localKey),
                description: leaf && description !== undefined
                    ? description
                    : `${labelFor(localKey)} in ${key} (${pluginId}).`
            };
            const previous = definitions.get(fullId);
            if (previous && (previous.parent !== next.parent || previous.label !== next.label ||
                previous.description !== next.description)) {
                throw new Error(`Request piece '${fullId}' was defined inconsistently.`);
            }
            prompt.registerDynamicComponent(fullId, next);
            definitions.set(fullId, next);
            parent = fullId;
        }
        return parent;
    };

    const scopeRef = { prompt, rootId, addPiece };
    prompt._requestScope = requestScope;
    return scopeRef;
}

function historyComponentId(preset) {
    return `core.history.compressed.${preset}`;
}

// Core-owned catalogue entries for the three attributed history views. They
// hang off root.history permanently: a "history piece" identifies the chosen
// VIEW, not the chapters inside it. Only the view actually rendered carries
// spans; sibling views never appear in the manifest.
function registerHistoryViewComponent(scope, selection, view) {
    const fullId = historyComponentId(selection.preset);
    scope.prompt.registerDynamicComponent('core.history.compressed', {
        parent: 'root.history',
        label: 'Compressed history views',
        description: 'Precomputed brief/balanced/deep narrative history views.',
        owner: 'core'
    });
    scope.prompt.registerDynamicComponent(fullId, {
        parent: 'core.history.compressed',
        label: `${selection.preset[0].toUpperCase()}${selection.preset.slice(1)} compressed history`,
        description: describeHistoryView(selection, view),
        owner: 'core'
    });
    return fullId;
}

function addHistoryPart(scope, message, part, turnContext, what) {
    const selection = normalizeHistorySelection(part.history, what);
    const view = resolveHistoryView(turnContext, selection, what);
    // History is a core-owned piece with its own id/owner/parent; the plugin
    // task never re-labels it. The occurrence records the full view length
    // plus what was actually rendered when maxChars truncates.
    const fullId = registerHistoryViewComponent(scope, selection, view);
    message.add(fullId, view.rendered, {
        historyView: { preset: selection.preset, fullChars: view.full.length, renderedChars: view.rendered.length }
    });
}

function addIncludePart(scope, message, part, turnContext) {
    if (typeof part.include !== 'string' || !part.include.trim()) {
        throw new TypeError('A structured prompt include part needs a fully-qualified component id.');
    }
    for (const key of Object.keys(part)) {
        if (!['include', 'instanceKey', 'sourceId'].includes(key)) {
            throw new TypeError(`A structured prompt include part accepts only include/instanceKey/sourceId, not '${key}'.`);
        }
    }
    if (part.instanceKey !== undefined && (typeof part.instanceKey !== 'string' || !part.instanceKey)) {
        throw new TypeError('A structured prompt include instanceKey must be a non-empty string.');
    }
    if (part.sourceId !== undefined && (typeof part.sourceId !== 'string' || !part.sourceId)) {
        throw new TypeError('A structured prompt include sourceId must be a non-empty string.');
    }
    message.includeComponent(part.include.trim(), {
        includeTurnContext: turnContext,
        ...(part.instanceKey !== undefined ? { instanceKey: part.instanceKey } : {}),
        ...(part.sourceId !== undefined ? { sourceId: part.sourceId } : {})
    });
}

function addOwnedPart(scope, message, part) {
    if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.text !== 'string' || !part.text.trim()) {
        throw new TypeError('A structured prompt part needs non-empty text and a named id.');
    }
    const id = scope.addPiece(part.id ?? part.piece, part);
    message.add(id, part.text);
}

function compilePluginRequest(pluginId, requestId, input, { turnContext = null, pluginManager = null, rolePolicy = 'standard', context = null } = {}) {
    if (input instanceof PreparedPrompt) {
        if (context !== null && context !== undefined) {
            throw new TypeError('History context cannot be combined with an already-prepared prompt; place {history} in the structured request instead.');
        }
        return input;
    }
    const scope = createPluginPromptScope(pluginId, requestId, { turnContext, pluginManager, rolePolicy });
    const hasContextHistory = context !== null && context !== undefined;
    if (hasContextHistory && (typeof context !== 'object' || Array.isArray(context) || !Object.hasOwn(context, 'history'))) {
        throw new TypeError("Request context supports only { history: 'brief'|'balanced'|'deep' }.");
    }
    if (typeof input === 'string') {
        if (!input.trim()) throw new TypeError('Plugin instruction must be non-empty text.');
        if (hasContextHistory) {
            // One user message, two attributed parts: the selected history
            // view first, then the plugin-owned instruction. Message-owned
            // '\n\n' joins them; neither piece owns the separator.
            scope.prompt.user(message => {
                message.separator('\n\n');
                addHistoryPart(scope, message, { history: context.history }, turnContext, 'Request context history');
                const id = scope.addPiece(scope.rootId.split('.').at(-1), {});
                message.add(id, input);
            });
        } else {
            scope.prompt.user(message => message.add(scope.rootId, input));
        }
        return scope.prompt.prepare();
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.messages) || input.messages.length === 0) {
        throw new TypeError('Plugin prompt must be text, a PreparedPrompt, or {messages:[{role,piece,text|parts}]} .');
    }
    if (hasContextHistory) {
        throw new TypeError('Request context history cannot be combined with explicit {messages}; place {history} in the message parts instead.');
    }
    for (const messageSpec of input.messages) {
        if (!messageSpec || typeof messageSpec !== 'object' || Array.isArray(messageSpec) || !ROLES.has(messageSpec.role)) {
            throw new TypeError('Structured prompt messages require role system, user, or assistant.');
        }
        if (Object.hasOwn(messageSpec, 'content')) {
            throw new TypeError('Raw {role,content} messages are not supported. Name the piece and supply text.');
        }
        if (messageSpec.parts !== undefined && !Array.isArray(messageSpec.parts)) {
            throw new TypeError('Structured prompt message parts must be an array.');
        }
        const hasParts = Array.isArray(messageSpec.parts);
        if (hasParts && (messageSpec.piece !== undefined || messageSpec.text !== undefined || messageSpec.id !== undefined || messageSpec.history !== undefined || messageSpec.include !== undefined)) {
            throw new TypeError('Use {parts} or {piece,text} in a message, not both.');
        }
        if (!hasParts && (messageSpec.history !== undefined || messageSpec.include !== undefined)) {
            if (messageSpec.history !== undefined && messageSpec.include !== undefined) {
                throw new TypeError('Use {history} or {include} in a message, not both.');
            }
            if (messageSpec.piece !== undefined || messageSpec.id !== undefined || messageSpec.label !== undefined || messageSpec.description !== undefined || messageSpec.text !== undefined || messageSpec.separator !== undefined || messageSpec.parts !== undefined) {
                throw new TypeError('History/include message shorthand accepts only {role, history|include} plus include disambiguation.');
            }
        }
        const parts = hasParts ? messageSpec.parts : (messageSpec.history !== undefined || messageSpec.include !== undefined
            ? [{ ...(messageSpec.history !== undefined ? { history: messageSpec.history } : {}),
                 ...(messageSpec.include !== undefined ? { include: messageSpec.include } : {}),
                 ...(messageSpec.instanceKey !== undefined ? { instanceKey: messageSpec.instanceKey } : {}),
                 ...(messageSpec.sourceId !== undefined ? { sourceId: messageSpec.sourceId } : {}) }]
            : [{ id: messageSpec.piece ?? messageSpec.id, text: messageSpec.text,
                label: messageSpec.label, description: messageSpec.description }]);
        if (parts.length === 0) throw new TypeError('A structured prompt message must contain at least one named piece.');
        if (messageSpec.separator !== undefined && typeof messageSpec.separator !== 'string') {
            throw new TypeError('Message separator must be a string.');
        }
        scope.prompt.message(messageSpec.role, message => {
            if (messageSpec.separator) message.separator(messageSpec.separator);
            for (const part of parts) {
                if (!part || typeof part !== 'object' || Array.isArray(part)) {
                    throw new TypeError('A structured prompt part needs non-empty text and a named id.');
                }
                if (part.history !== undefined) {
                    if (Object.keys(part).length !== 1) {
                        throw new TypeError('A history part accepts only {history}.');
                    }
                    addHistoryPart(scope, message, part, turnContext, 'Structured prompt history part');
                    continue;
                }
                if (part.include !== undefined) {
                    addIncludePart(scope, message, part, turnContext);
                    continue;
                }
                addOwnedPart(scope, message, part);
            }
        });
    }
    return scope.prompt.prepare();
}

// AgentRunner owns an ordered conversation assembled over several iterations.
// This INTERNAL adapter labels each existing message without changing its
// role, order, or text. An explicit agent policy preserves its final-iteration
// system note instead of silently rewriting it as user text.
function compileAgentMessages(ownerId, requestId, messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new TypeError('Agent request needs an ordered, non-empty message array.');
    }
    const structured = messages.map((message, index) => {
        if (!message || !ROLES.has(message.role) || typeof message.content !== 'string') {
            throw new TypeError('Agent messages require {role, content} with a supported role.');
        }
        return { role: message.role, piece: `message_${index + 1}`, text: message.content };
    });
    return compilePluginRequest(ownerId, requestId, { messages: structured }, { ...options, rolePolicy: 'agent' });
}

module.exports = { createPluginPromptScope, compilePluginRequest, compileAgentMessages };
