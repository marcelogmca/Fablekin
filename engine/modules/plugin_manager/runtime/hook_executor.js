const { Logger, sendUiNotification } = require('../../utils.js');
const { buildTools } = require('./tools_builder.js');
const { PipelineAbortError } = require('./errors.js');
const cancellation = require('../../pipeline_cancellation.js');
const { runWithDiagnosticContext } = require('../../diagnostic_context.js');

/**
 * WorkQueue - Tracks ETA for remaining work items.
 * Provides rough time estimates for user-facing progress.
 */
class WorkQueue {
    constructor() {
        this.items = new Map(); // id -> { name, min, max, status, addedAt }
        this.notificationId = 'eta-tracker';
    }

    /**
     * Add a work item to the queue.
     * @param {string} id - Unique identifier for the item.
     * @param {string} name - Display name for the item.
     * @param {number} minMs - Minimum estimated time in milliseconds.
     * @param {number} maxMs - Maximum estimated time in milliseconds.
     * @param {string} status - Initial status ('pending', 'running', 'complete').
     */
    add(id, name, minMs, maxMs, status = 'pending') {
        this.items.set(id, {
            name,
            min: minMs,
            max: maxMs,
            status,
            addedAt: Date.now()
        });
        this.updateDisplay();
    }

    /**
     * Remove a work item from the queue.
     * @param {string} id - The item to remove.
     */
    remove(id) {
        this.items.delete(id);
        this.updateDisplay();
    }

    /**
     * Update the status of a work item.
     * @param {string} id - The item to update.
     * @param {string} status - New status ('pending', 'running', 'complete').
     */
    updateStatus(id, status) {
        const item = this.items.get(id);
        if (item) {
            item.status = status;
            this.updateDisplay();
        }
    }

    /**
     * Calculate total ETA from remaining items.
     * @returns {string} Formatted ETA string like "3m to 8m left".
     */
    calculate() {
        let totalMin = 0;
        let totalMax = 0;

        for (const [, item] of this.items.entries()) {
            totalMin += item.min;
            totalMax += item.max;
        }

        if (this.items.size === 0) return '';

        return this.formatTime(totalMin) + ' to ' + this.formatTime(totalMax) + ' left';
    }

    /**
     * Get the list of items for UI display.
     * @returns {Array<Object>} Array of { name, status } objects.
     */
    getList() {
        return Array.from(this.items.values()).map(item => ({
            name: item.name,
            status: item.status
        }));
    }

    /**
     * Format milliseconds to human-readable time.
     * @param {number} ms - Milliseconds to format.
     * @returns {string} Formatted time (e.g., "5s", "2m", "1h").
     */
    formatTime(ms) {
        if (ms < 60000) return Math.ceil(ms / 1000) + 's';
        if (ms < 3600000) return Math.ceil(ms / 60000) + 'm';
        return Math.ceil(ms / 3600000) + 'h';
    }

    /**
     * Update the UI notification with current ETA.
     */
    updateDisplay() {
        const eta = this.calculate();

        if (!eta) {
            // Queue empty, clear notification
            sendUiNotification({ id: this.notificationId, type: 'clear' });
            return;
        }

        sendUiNotification({
            id: this.notificationId,
            message: '📊 ETA: ' + eta,
            blocking: true,  // eta-tracker should always be visible as blocking
            priority: 5,
            icon: '📊',
            subtasks: this.getList()
        });
    }

    /**
     * Clear all items from the queue.
     */
    clear() {
        this.items.clear();
        this.updateDisplay();
    }
}

// Global work queue instance
const workQueue = new WorkQueue();

function buildListenerDiagnosticContext(hookName, hookInfo, listener, mode, priority) {
    const isBlocking = mode !== 'background' && !hookInfo.forceNonBlocking;
    return {
        executionLane: 'hook',
        phase: hookInfo.phase || hookInfo.name || hookName,
        hookName,
        hookDisplayName: hookInfo.name || hookName,
        pluginId: listener.pluginId,
          listenerMode: mode,
          hookPriority: priority,
          sharedVnLlm: listener.useSharedVnLlm === true,
          blocking: isBlocking
    };
}

function attachPipelineTaskDiagnostics(result, diagnostics) {
    if (!result || !diagnostics) return result;
    if (Array.isArray(result)) {
        return result.map(item => attachPipelineTaskDiagnostics(item, diagnostics));
    }
    if (typeof result !== 'object') return result;

    if (typeof result.fn === 'function' || result.key !== undefined) {
        return {
            ...result,
            diagnostics: {
                ...(result.diagnostics && typeof result.diagnostics === 'object' ? result.diagnostics : {}),
                ...diagnostics,
                executionLane: 'vn_pipeline_task',
                taskKey: result.key,
                blocking: result.blocking !== false,
                after: result.after,
                before: result.before
            }
        };
    }

    return result;
}

// Pipeline phase color scheme (hardcoded identity colors, independent of theme)
const PHASE_COLORS = {
    'Turn': '#4ecdc4',
    'Narrative': '#3498db',
    'Prompt': '#9b59b6',
    'Director': '#f39c12',
    'Writer': '#e74c3c',
    'VN': '#2ecc71',
    'Persistence': '#95a5a6'
};

// Registry for hook-specific icons, names, order, descriptions, phases, and weights
const HOOK_INFO = {
    // System & Project Lifecycle Hooks (10-40)
    'HOOK_SYSTEM_BOOT': { isPipeline: false, icon: '🚀', name: 'System Boot', order: 10, phase: 'System', description: 'Fired when the application starts up.' },
    'HOOK_PROJECT_LOADED': { isPipeline: false, icon: '📁', name: 'Project Loaded', order: 20, phase: 'System', description: 'Fired when a new project is selected or loaded.' },
    'HOOK_CHAT_DB_INITIALIZED': { isPipeline: false, icon: '💾', name: 'Chat DB Ready', order: 30, phase: 'System', description: 'Fired when the active story database (Chat.db) is initialized.' },
    'HOOK_POST_FACT_MANAGER_INIT': { isPipeline: false, icon: '🧠', name: 'Fact Manager Ready', order: 40, phase: 'System', description: 'Fired after FactManager is initialized and ready. Plugins can initialize fact-based systems.' },
    'HOOK_TURN_DELETED': { isPipeline: false, icon: '🗑️', name: 'Turn Deleted', order: 50, phase: 'System', description: 'Fired when a turn is deleted (rewound). Plugins should clean up turn-specific physical assets.' },
    'HOOK_CHAT_DELETED': { isPipeline: false, icon: '🧨', name: 'Chat Deleted', order: 60, phase: 'System', description: 'Fired when an entire chat database is deleted. Plugins should clean up all associated data.' },
    'HOOK_CHAT_BRANCHED': { isPipeline: false, icon: '🌿', name: 'Chat Branched', order: 70, phase: 'System', description: 'Fired when a chat is branched. Plugins can sync or initialize state for the new branch.' },

    // VN Turn Generation Hooks (100-3500)
    'HOOK_TURN_START': { isPipeline: true, weight: 1, icon: '▶️', name: 'Turn Start', order: 100, phase: 'Turn Start', description: 'Fired at the very start of a new turn. Allows plugins to set up turn-specific tracking.' },
    'HOOK_GUI_GATEKEEPER': { isPipeline: true, weight: 1, icon: '🚪', name: 'GUI Check', order: 200, phase: 'Turn Start', description: 'First hook in turn generation. Allows GUI interception to pause backend before processing.' },
    'HOOK_ASSETS_LOADED': { isPipeline: true, weight: 2, icon: '🖼️', name: 'Assets Loaded', order: 300, phase: 'Turn Start', description: 'Fired after all project assets (sprites, backgrounds, OSTs) are loaded into TurnContext.' },
    'HOOK_TURN_1_SPECIAL': { isPipeline: false, icon: '🎬', name: 'First Turn', order: 400, phase: 'Turn Start', description: 'Fired for Turn 1 only. Allows special initialization for opening sequences.' },
    'HOOK_NARRATIVE_START': { isPipeline: true, weight: 1, icon: '🚀', name: 'Narrative Start', order: 500, phase: 'Turn Start', description: 'Fired at the start of narrative generation.' },

    // Prompt Builder Hooks (800-1300)
    'HOOK_FOUNDATION_START': { isPipeline: true, weight: 1, icon: '🏗️', name: 'Foundation Start', order: 800, phase: 'Prompt', description: 'Fired right before foundation gathering starts.' },
    'HOOK_PROMPT_COMPONENTS_RESET': { isPipeline: true, weight: 1, icon: '🔄', name: 'Components Reset', order: 900, phase: 'Prompt', description: 'Fired after the prompt component registry is reset. Plugins can register custom slots.' },
    'HOOK_PRE_PROMPT_BUILDER': { isPipeline: true, weight: 1, icon: '🛠️', name: 'Context Assembly', order: 1000, phase: 'Prompt', description: 'Fired before gathering shared context (lore, RAG, world state).' },
    'HOOK_EXTRACT_ENTITIES': { isPipeline: true, weight: 2, icon: '🔍', name: 'Entity Extraction', order: 1100, phase: 'Prompt', description: 'Fired for entity extraction to drive RAG and Knowledge Graph searches.' },
    'HOOK_POST_FILE_PROCESSING': { isPipeline: true, weight: 1, icon: '📄', name: 'File Processing', order: 1200, phase: 'Prompt', description: 'Fired after each static lore file is processed (summary/full mode).' },
    'HOOK_POST_PROMPT_BUILDER': { isPipeline: true, weight: 4, icon: '🏗️', name: 'Prompt Building', order: 1300, phase: 'Prompt', description: 'Fired after all foundation context is gathered. Final slot injection point.' },

    // Director Hooks (1400-1700)
    'HOOK_PRE_ORCHESTRATOR': { isPipeline: true, weight: 2, icon: '🧠', name: 'Director Prep', order: 1400, phase: 'Director', description: 'Fired immediately before the Director AI runs.' },
    'HOOK_DIRECTOR_PRE_PROMPT': { isPipeline: true, weight: 20, icon: '📋', name: 'Director LLM Running', order: 1500, phase: 'Director', description: 'Fired before the Director prompt is assembled. Allows CoT/ledger/output customization.' },
    'HOOK_POST_ORCHESTRATOR': { isPipeline: true, weight: 2, icon: '📝', name: 'Director Notes', order: 1600, phase: 'Director', description: 'Fired after the Director generates the Writer\'s Brief and other sections.' },
    'HOOK_DIRECTOR_NOTES_PATCHED': { isPipeline: true, weight: 1, icon: '📝', name: 'Notes Patched', order: 1700, phase: 'Director', description: 'Fired after Director notes are SEARCH/REPLACE patched for turn > 1.' },

    // Writer Hooks (1800-1900)
    'HOOK_PRE_WRITER': { isPipeline: true, weight: 35, icon: '🖋️', name: 'Writer LLM Running', order: 1800, phase: 'Writer', description: 'Fired immediately before the Writer AI LLM call.' },
    'HOOK_POST_WRITER': { isPipeline: true, weight: 2, icon: '📖', name: 'Writer Complete', order: 1900, phase: 'Writer', description: 'Fired after the Writer AI generates the narrative text. [TURN GEN ENDS] (Narrative) marker.' },

    // VN Transformation Hooks (2000-3000)
    'HOOK_PRE_VN_GENERATION': { isPipeline: true, weight: 1, icon: '🎬', name: 'Scene Prep', order: 2000, phase: 'VN', description: 'Fired at the very start of VN transformation. Good for injecting initial context.' },
    'HOOK_PRE_DIALOGUE_PROCESSING': { isPipeline: true, weight: 3, icon: '📝', name: 'Pre-Dialogue', order: 2100, phase: 'VN', description: 'Fired before raw narrative text is parsed into dialogue/narrative objects.' },
    'HOOK_POST_DIALOGUE_PROCESSING': { isPipeline: true, weight: 1, icon: '💬', name: 'Post-Dialogue', order: 2200, phase: 'VN', description: 'Fired after text is parsed. Good for modifying lines or forcing emotions before asset assignment.' },
    'HOOK_PARTY_CALCULATED': { isPipeline: true, weight: 0.1, icon: '👥', name: 'Party Ready', order: 2300, phase: 'VN', description: 'Fired after the active party and prominent characters are calculated.' },
    'HOOK_PROMINENT_CHARACTERS': { isPipeline: true, weight: 0.1, icon: '🌟', name: 'Prominence Ready', order: 2400, phase: 'VN', description: 'Fired after character prominence scores are calculated. Plugins can modify prominence.' },
    'HOOK_VN_DIALOGUE_READY': { isPipeline: true, weight: 0.1, icon: '💬', name: 'Dialogue Ready', order: 2500, phase: 'VN', description: 'Fired after emotions, sprites, and genders are assigned to dialogue lines. Ideal for TTS (background).' },
    'HOOK_VN_PIPELINE_TASKS': { isPipeline: true, weight: 0.1, icon: '⚙️', name: 'Task Registration', order: 2550, phase: 'VN', description: 'Fired before blocking VN tasks run. Plugins can return task descriptors with key, blocking, after, before, and fn.' },
    'HOOK_VN_BLOCKING_TASKS': { isPipeline: true, weight: 3, icon: '⚡', name: 'Asset Selection', order: 2600, phase: 'VN', description: 'Parallel hook for blocking tasks: emotion classification, background/OST selection, new character identification.' },
    'HOOK_PRE_SPRITE_POSITIONING': { isPipeline: true, weight: 0.1, icon: '📐', name: 'Sprite Layout', order: 2700, phase: 'VN', description: 'Fired after assets are selected but before sprite positions are computed on screen.' },
    'HOOK_VN_BACKGROUND_TASKS': { isPipeline: true, weight: 0.1, icon: '⏳', name: 'Background Tasks', order: 2800, phase: 'VN', forceNonBlocking: true, description: 'Fire-and-forget background hook for non-critical tasks: summary, synopsis, TTS, KG updates.' },
    'HOOK_NEW_CHARACTER_IDENTIFIED': { isPipeline: false, icon: '🆕', name: 'New Character', order: 2900, phase: 'VN', description: 'Fired when new characters are identified in the scene. Used for bootstrapping personalities/relationships.' },
    'HOOK_VN_GUI_READY': { isPipeline: true, weight: 0.1, icon: '🖥️', name: 'GUI Ready', order: 2950, phase: 'VN', description: 'Fired after the VN viewer GUI has finished rendering the turn.' },
    'HOOK_POST_VN_GENERATION': { isPipeline: true, weight: 0.1, icon: '🏁', name: 'Scene Complete', order: 3000, phase: 'VN', description: 'Fired at the very end of VN transformation. TurnContext is fully populated with output.' },

    // Persistence Hooks (3100-3300)
    'HOOK_BACKGROUND_TASKS_COMPLETE': { isPipeline: true, weight: 1, icon: '✅', name: 'BG Tasks Done', order: 3100, phase: 'Persistence', description: 'Fired after all background tasks complete. Good for cleanup and final validation.' },
    'HOOK_POST_DB_UPDATE': { isPipeline: true, weight: 2, icon: '💾', name: 'DB Updated', order: 3200, phase: 'Persistence', description: 'Fired after the turn is updated in the database. Plugins can sync to external systems.' },

    // Content Manager Hooks
    'HOOK_CONTENT_MANAGER_GUI_READY': { isPipeline: false, icon: '📋', name: 'Content Manager Ready', order: 3400, phase: 'UI', description: 'Fired when the Content Manager GUI is ready.' },
    'HOOK_FILE_CONVERTED': { isPipeline: false, icon: '🔄', name: 'File Converted', order: 3450, phase: 'UI', description: 'Fired after a file is converted between plugin modes.' },

    // UI Hooks (3400-3500)
    'HOOK_FRONTEND_INJECTION': { isPipeline: false, icon: '🖥️', name: 'HUD Injection', order: 3500, phase: 'UI', description: 'Fired to gather HTML/CSS/JS to inject into the main Game HUD (VN Viewer).' },
    'HOOK_FRONTEND_TIMELINE_INJECTION': { isPipeline: false, icon: '⏳', name: 'Timeline Injection', order: 3550, phase: 'UI', description: 'Fired to gather HTML/CSS/JS specifically for the Timeline View.' },
};

/**
 * Build pipeline manifest — sorted array of all pipeline hooks with metadata.
 * @returns {Array} Sorted pipeline hook descriptors.
 */
function buildPipelineManifest() {
    return Object.entries(HOOK_INFO)
        .filter(([_, info]) => info.isPipeline)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([key, info]) => ({
            hookName: key,
            name: info.name,
            icon: info.icon,
            phase: info.phase,
            weight: info.weight || 1
        }));
}

// Tracks whether the pipeline manifest has been sent this generation
let pipelineManifestSent = false;
let pipelineManifestRunId = null;

function normalizeSceneMode(sceneMode) {
    return String(sceneMode || 'mainline').trim().toLowerCase();
}

function resolveHookPolicy(context) {
    const configured = String(context?.runtime?.turnPipeline?.hookPolicy || '').trim().toLowerCase();
    if (configured === 'all' || configured === 'opt-in') return configured;

    const sceneMode = normalizeSceneMode(context?.sceneMode);
    return sceneMode === 'interlude' ? 'opt-in' : 'all';
}

function shouldExecuteListenerForContext(listener, context) {
    const sceneMode = normalizeSceneMode(context?.sceneMode);
    const hookPolicy = resolveHookPolicy(context);

    if (hookPolicy === 'all') {
        if (Array.isArray(listener.sceneModes) && listener.sceneModes.length > 0) {
            return listener.sceneModes.includes(sceneMode);
        }
        return true;
    }

    if (Array.isArray(listener.sceneModes) && listener.sceneModes.length > 0) {
        return listener.sceneModes.includes(sceneMode);
    }

    if (sceneMode === 'interlude') {
        return listener.allowInterlude === true;
    }

    return false;
}

function filterListenersForContext(listeners, context, hookName) {
    if (!Array.isArray(listeners) || listeners.length === 0) return [];

    const hookPolicy = resolveHookPolicy(context);
    if (hookPolicy === 'all') return listeners;

    const filtered = listeners.filter(listener => shouldExecuteListenerForContext(listener, context));
    const skipped = listeners.length - filtered.length;
    if (skipped > 0) {
        const sceneMode = normalizeSceneMode(context?.sceneMode);
        Logger.log('PluginManager', hookName, `Hook policy '${hookPolicy}' for sceneMode='${sceneMode}' filtered ${skipped} listener(s).`);
    }
    return filtered;
}

/**
 * Emit pipeline status to the frontend for the progress bar.
 * Sends the full manifest on the first pipeline hook of a generation.
 * @param {string} hookName - The hook being executed.
 */
function emitPipelineStatus(hookName, context = null) {
    const hookInfo = HOOK_INFO[hookName];
    if (!hookInfo || !hookInfo.isPipeline) return;

    const currentRunId = context?.runtime?.runId || null;
    if (currentRunId && currentRunId !== pipelineManifestRunId) {
        pipelineManifestRunId = currentRunId;
        pipelineManifestSent = false;
    } else if (!currentRunId && (
        hookName === 'HOOK_TURN_START'
        || hookName === 'HOOK_GUI_GATEKEEPER'
        || hookName === 'HOOK_NARRATIVE_START'
    )) {
        // Fallback for contexts that don't propagate runId.
        pipelineManifestRunId = null;
        pipelineManifestSent = false;
    }

    const payload = { hookName };

    // Send manifest on the first pipeline hook of each generation
    if (!pipelineManifestSent) {
        payload.manifest = buildPipelineManifest();
        payload.phaseColors = PHASE_COLORS;
        pipelineManifestSent = true;
    }

    sendUiNotification({
        id: '__pipeline_status__',
        type: 'pipeline-status',
        pipeline: payload
    });
}

/**
 * Executes a specific hook across all registered plugins.
 * @param {Object} pluginManager - The PluginManager instance.
 * @param {string} hookName - The name of the hook to execute.
 * @param {Object} turnContext - The current turn context (optional).
 * @returns {Promise<Array>} - Array of results from sequential and parallel listeners.
 */
async function executeHook(pluginManager, hookName, turnContext = null, ...args) {
    Logger.log('PluginManager', hookName, `Executing hook: '${hookName}'`, 'start');

    // Use snapshotted context if none provided
    const context = turnContext || pluginManager.currentTurnContext;
    cancellation.throwIfCancelled(`hook ${hookName}`);

    if (!pluginManager.isInitialized) {
        Logger.warn('PluginManager', hookName, `Attempted to execute hook '${hookName}' before initialization.`);
        Logger.log('PluginManager', hookName, `Executing hook: '${hookName}'`, 'end');
        return null; // Return null to indicate 'system not ready' vs 'no listeners' ([])
    }

    const registeredListeners = pluginManager.hooks.get(hookName) || [];
    const allListeners = filterListenersForContext(registeredListeners, context, hookName);

    // Performance tracking initialization
    if (context) {
        if (!context.runtime) context.runtime = {};
        if (!context.runtime.performance) context.runtime.performance = { hooks: {} };
        context.runtime.performance.hooks[hookName] = {
            start: Date.now(),
            listeners: []
        };
    }

    // Reset pipeline manifest tracking on turn start, then emit pipeline status
    // This runs BEFORE the empty-listener early return so hooks with
    // zero listeners (like HOOK_TURN_START) still send their pipeline event.
    emitPipelineStatus(hookName, context);

    if (allListeners.length === 0) {
        if (context && context.runtime.performance.hooks[hookName]) {
            context.runtime.performance.hooks[hookName].end = Date.now();
            context.runtime.performance.hooks[hookName].duration = context.runtime.performance.hooks[hookName].end - context.runtime.performance.hooks[hookName].start;
        }
        Logger.log('PluginManager', hookName, `No listeners found for hook '${hookName}'.`, 'end');
        return [];
    }

    const results = [];
    const hookId = `hook_${hookName}`;
    const activeStatusIds = new Set();

    // Calculate foreground listeners for progress tracking (excluding background)
    const foregroundListeners = allListeners.filter(l => l.mode !== 'background');
    const totalForeground = foregroundListeners.length;
    let executedForeground = 0;

    const hookInfo = HOOK_INFO[hookName] || { icon: '⚙️', name: hookName.replace('HOOK_', '') };

    // Helper to send status updates
    const reportStatus = (message, progress, isBlocking = true, priority = 50, id = hookId, currentExecuted = executedForeground) => {
        const progressSuffix = (currentExecuted > 0) ? ` (${currentExecuted}/${totalForeground} plugins)` : '';
        activeStatusIds.add(id);
        sendUiNotification({
            id: id,
            message: `${hookInfo.name}: ${message}${progressSuffix}`,
            progress: progress,
            blocking: isBlocking,
            priority: priority,
            icon: hookInfo.icon
        });
    };

    // WorkQueue integration: Check if hook has ETA metadata and add to queue
    const hookEta = hookInfo.eta;
    if (hookEta) {
        // Check for turn-specific override (turn1)
        const isTurn1 = context && context.turnNumber === 1;
        const etaData = (isTurn1 && hookEta.turn1) ? hookEta.turn1 : (hookEta.default || hookEta);

        if (etaData && etaData.min && etaData.max) {
            // Start directly with 'running' status to avoid spamming 'pending' updates
            workQueue.add(hookId, hookInfo.name, etaData.min, etaData.max, 'running');
        }
    }

    try {
        // Initial report defaults to blocking; frontend handles phase-based visibility
        reportStatus('Preparing...', 0, true, 40);

        Logger.log('PluginManager', hookName, `Hook '${hookName}': Found ${allListeners.length} listeners`);

        // Group ALL listeners by priority
        const priorityGroups = [];
        let currentGroup = null;

        for (const listener of allListeners) {
            if (!currentGroup || currentGroup.priority !== listener.priority) {
                currentGroup = { priority: listener.priority, listeners: [] };
                priorityGroups.push(currentGroup);
            }
            currentGroup.listeners.push(listener);
        }

        // Execute priority groups in order
        for (const group of priorityGroups) {
            cancellation.throwIfCancelled(`hook ${hookName} priority ${group.priority}`);
            const sub = `${hookName}:P${group.priority}`;
            Logger.log('PluginManager', sub, `Executing priority group ${group.priority} (${group.listeners.length} listeners)`, 'start');

            let i = 0;
            while (i < group.listeners.length) {
                const listener = group.listeners[i];
                const isBlocking = listener.mode !== 'background' && !hookInfo.forceNonBlocking;

                if (listener.mode === 'sequential') {
                    cancellation.throwIfCancelled(`hook ${hookName} listener ${listener.pluginId}`);
                    executedForeground++;
                    const progress = totalForeground > 0 ? Math.round(((executedForeground - 1) / totalForeground) * 100) : 0;
                    const lSub = `${sub}:${listener.pluginId}:Seq`;
                    const currentId = `${hookId}_${listener.pluginId}`;

                    try {
                        reportStatus(`Processing ${listener.pluginId}...`, progress, isBlocking, 60, currentId);
                        Logger.log('PluginManager', lSub, `Running sequential listener`, 'start');

                        const diagnostics = buildListenerDiagnosticContext(hookName, hookInfo, listener, 'sequential', group.priority);
                        const tools = buildTools(pluginManager, listener.pluginId, context, null, {
                            hookStatusId: currentId,
                            reportHookStatus: (msg) => reportStatus(`${listener.pluginId}: ${msg}`, progress, isBlocking, 60, currentId)
                        });

                        const pStart = Date.now();
                        let result = await runWithDiagnosticContext(diagnostics, async () => listener.fn(context, tools, ...args));
                        if (hookName === 'HOOK_VN_PIPELINE_TASKS') {
                            result = attachPipelineTaskDiagnostics(result, diagnostics);
                        }
                        const pEnd = Date.now();

                        if (context && context.runtime.performance.hooks[hookName]) {
                            context.runtime.performance.hooks[hookName].listeners.push({
                                pluginId: listener.pluginId,
                                start: pStart,
                                end: pEnd,
                                duration: pEnd - pStart,
                                mode: 'sequential'
                            });
                        }

                        if (result !== undefined) results.push(result);
                        Logger.log('PluginManager', lSub, `Finished sequential listener`, 'end');
                    } catch (error) {
                        if (error instanceof PipelineAbortError) throw error;
                        Logger.error('PluginManager', lSub, `[Sequential] Error in plugin:`, 'end', error);
                    } finally {
                        sendUiNotification({ id: currentId, type: 'clear' });
                        i++;
                    }
                } else if (listener.mode === 'parallel') {
                    cancellation.throwIfCancelled(`hook ${hookName} parallel listeners`);
                    const parallelBatch = [];
                    while (i < group.listeners.length && group.listeners[i].mode === 'parallel') {
                        parallelBatch.push(group.listeners[i]);
                        i++;
                    }

                    if (parallelBatch.length > 0) {
                        const batchStartCount = executedForeground;
                        executedForeground += parallelBatch.length;
                        const bSub = `${sub}:Batch:Par`;

                        Logger.log('PluginManager', bSub, `Running ${parallelBatch.length} parallel listeners`, 'start');

                        const batchResults = await Promise.all(parallelBatch.map(async (pListener, batchIdx) => {
                            cancellation.throwIfCancelled(`hook ${hookName} listener ${pListener.pluginId}`);
                            const pSub = `${sub}:${pListener.pluginId}:Par`;
                            const currentExecuted = batchStartCount + batchIdx + 1;
                            const progress = totalForeground > 0 ? Math.round(((currentExecuted - 1) / totalForeground) * 100) : 0;
                            const currentId = `${hookId}_${pListener.pluginId}`;

                            try {
                                // Update status for parallel plugins to show which one(s) are active
                                reportStatus(`Processing ${pListener.pluginId}...`, progress, isBlocking, 60, currentId, currentExecuted);
                                
                                Logger.log('PluginManager', pSub, `Running parallel listener`, 'start');

                                const diagnostics = buildListenerDiagnosticContext(hookName, hookInfo, pListener, 'parallel', group.priority);
                                const tools = buildTools(pluginManager, pListener.pluginId, context, null, {
                                    hookStatusId: currentId,
                                    reportHookStatus: (msg) => reportStatus(`${pListener.pluginId}: ${msg}`, progress, isBlocking, 60, currentId, currentExecuted)
                                });

                                const pStart = Date.now();
                                let res = await runWithDiagnosticContext(diagnostics, async () => pListener.fn(context, tools, ...args));
                                if (hookName === 'HOOK_VN_PIPELINE_TASKS') {
                                    res = attachPipelineTaskDiagnostics(res, diagnostics);
                                }
                                const pEnd = Date.now();

                                if (context && context.runtime.performance.hooks[hookName]) {
                                    context.runtime.performance.hooks[hookName].listeners.push({
                                        pluginId: pListener.pluginId,
                                        start: pStart,
                                        end: pEnd,
                                        duration: pEnd - pStart,
                                        mode: 'parallel'
                                    });
                                }

                                Logger.log('PluginManager', pSub, `Finished parallel listener`, 'end');
                                return res;
                            } catch (error) {
                                if (error instanceof PipelineAbortError) throw error;
                                Logger.error('PluginManager', pSub, `[Parallel] Error in plugin:`, 'end', error);
                                return undefined;
                            } finally {
                                sendUiNotification({ id: currentId, type: 'clear' });
                            }
                        }));
                        results.push(...batchResults.filter(r => r !== undefined));
                        Logger.log('PluginManager', bSub, `Finished parallel batch`, 'end');
                    }
                } else if (listener.mode === 'background') {
                    cancellation.throwIfCancelled(`hook ${hookName} background listener ${listener.pluginId}`);
                    const lSub = `${sub}:${listener.pluginId}:Bg`;
                    try {
                        // Background listeners don't report status at hook level to avoid blocking
                        Logger.log('PluginManager', lSub, `Starting background listener`, 'start');
                        const diagnostics = buildListenerDiagnosticContext(hookName, hookInfo, listener, 'background', group.priority);
                        runWithDiagnosticContext(diagnostics, () => {
                            const tools = buildTools(pluginManager, listener.pluginId, context);
                            return listener.fn(context, tools, ...args);
                        }).then(() => {
                            Logger.log('PluginManager', lSub, `Finished background listener`, 'end');
                        }).catch(error => {
                            if (error instanceof PipelineAbortError) {
                                Logger.warn('PluginManager', lSub, `[Background] Cancelled: ${error.message}`);
                                return;
                            }
                            Logger.error('PluginManager', lSub, `[Background] Error in plugin:`, 'end', error);
                        });
                    } catch (error) {
                        Logger.error('PluginManager', lSub, `[Background] Immediate error in plugin:`, 'end', error);
                    }
                    i++;
                } else {
                    i++;
                }
            }
            Logger.log('PluginManager', sub, `Finished priority group ${group.priority}`, 'end');
        }
    } catch (error) {
        if (error instanceof PipelineAbortError) {
            const abortMsg = `Hook '${hookName}' ABORTED by plugin '${error.pluginId}': ${error.reason}`;
            Logger.warn('PluginManager', hookName, abortMsg);

            // Optionally notify UI
            sendUiNotification({
                id: `abort_${hookName}`,
                message: `📢 Pipeline Aborted: ${error.reason}`,
                color: '#ff9800',
                timeout: 5000,
                icon: '⚠️'
            });

            // Re-throw if we want the parent (NarrativeEngine) to also stop.
            // For now, we stop the hook listeners, but let's see if we should propagate.
            // User said: "feels odd for it to live inside turnContext", implying they want it to be a real control flow.
            throw error;
        }
        throw error; // Re-throw other errors
    } finally {
        // Remove from WorkQueue if this hook had an ETA item
        if (hookEta) {
            workQueue.remove(hookId);
        }

        // Always clear all hook statuses
        for (const id of activeStatusIds) {
            sendUiNotification({ id: id, type: 'clear' });
        }
        sendUiNotification({ id: hookId, type: 'clear' }); // Failsafe for the initial one

        // Performance tracking Finalization
        if (context && context.runtime.performance.hooks[hookName]) {
            context.runtime.performance.hooks[hookName].end = Date.now();
            context.runtime.performance.hooks[hookName].duration = context.runtime.performance.hooks[hookName].end - context.runtime.performance.hooks[hookName].start;
        }

        Logger.log('PluginManager', hookName, `Executing hook: '${hookName}'`, 'end');
    }

    return results;
}

/**
 * Executes an exported function from a specific plugin.
 * @param {Object} pluginManager - The PluginManager instance.
 * @param {string} pluginId - The ID of the plugin.
 * @param {string} functionName - The name of the function to call.
 * @param {Object} turnContext - The current turn context.
 * @param {...any} args - Arguments to pass to the function.
 * @returns {Promise<any>}
 */
async function callPluginFunction(pluginManager, pluginId, functionName, turnContext, ...args) {
    if (!pluginManager.exportedFunctions.has(pluginId)) {
        Logger.warn('PluginManager', `Attempted to call function '${functionName}' on non-existent or export-less plugin '${pluginId}'.`);
        return null;
    }

    const exports = pluginManager.exportedFunctions.get(pluginId);
    if (typeof exports[functionName] !== 'function') {
        Logger.warn('PluginManager', `Plugin '${pluginId}' does not export a function named '${functionName}'.`);
        return null;
    }

    try {
        const context = turnContext || pluginManager.currentTurnContext;
        const tools = buildTools(pluginManager, pluginId, context);
        const finalContext = tools.turnContext;
        return await exports[functionName](finalContext, tools, ...args);
    } catch (error) {
        Logger.error('PluginManager', `Error executing exported function '${functionName}' for plugin '${pluginId}':`, error);
        return null;
    }
}

/**
 * Requests a custom file view from a plugin.
 * @param {Object} pluginManager - The PluginManager instance.
 * @param {string} pluginId
 * @param {string} modeId
 * @param {string} filePath
 * @returns {Promise<{success: boolean, content?: string, type?: 'html'|'text', error?: string}>}
 */
async function provideFileView(pluginManager, pluginId, modeId, filePath) {
    Logger.log('PluginManager', `Requesting file view for ${filePath} (${modeId}) from plugin ${pluginId}`);

    const plugin = pluginManager.plugins.get(pluginId);
    if (!plugin) {
        return { success: false, error: 'Plugin not found or inactive.' };
    }

    const turnContext = pluginManager.currentTurnContext;
    const tools = buildTools(pluginManager, pluginId, turnContext);

    try {
        if (plugin.exports && typeof plugin.exports.provideFileView === 'function') {
            const result = await plugin.exports.provideFileView(turnContext, tools, { modeId, filePath });
            return { success: true, ...result };
        }

        return { success: false, error: 'Plugin does not implement provideFileView export.' };
    } catch (error) {
        Logger.error('PluginManager', `Error in provideFileView for plugin ${pluginId}:`, error);
        return { success: false, error: error.message };
    }
}

module.exports = { executeHook, callPluginFunction, provideFileView, workQueue };
