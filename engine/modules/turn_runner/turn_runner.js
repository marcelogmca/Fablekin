const { resolveRunProfile } = require('./run_profiles.js');
const cancellation = require('../pipeline_cancellation.js');
const { PipelineAbortError } = require('../plugin_manager/runtime/errors.js');

function createTurnRunner({
    Logger,
    io,
    chaptermanagement,
    timeline,
    getSettings,
    initFactManager,
    TurnContext,
    getProjectName,
    getRootDirectory,
    getMainCharacterName,
    getMainCharacterBio,
    StaticDataManager,
    getStaticDataManager,
    setStaticDataManager,
    pluginManager,
    narrativeEngine,
    addWorkItem,
    getProjectSprites,
    getProjectBackgrounds,
    getProjectOSTs,
    getLastSearchstring,
    getTotalSteps,
    vnmanager
}) {
    let runSeq = 0;
    const activeRuns = new Map();
    let currentChatDbPath = null;

    function createRunState(mode, profileId) {
        runSeq += 1;
        const runId = `run_${Date.now()}_${runSeq}`;
        const state = {
            runId,
            mode,
            profileId,
            startedAt: Date.now(),
            stage: 'init'
        };
        state.cancelContext = cancellation.createRunContext(runId, state);
        cancellation.registerRun(state.cancelContext);
        activeRuns.set(runId, state);
        io.emit('generation-run-started', { runId, mode, profileId, startedAt: state.startedAt });
        return state;
    }

    function finishRun(runState, status, error = null) {
        runState.finishedAt = Date.now();
        runState.status = status;
        if (error) runState.error = error;
        activeRuns.delete(runState.runId);
        cancellation.unregisterRun(runState.runId);
    }

    function throwIfCancelled(runState, stage) {
        cancellation.throwIfCancelled(runState?.cancelContext, stage);
    }

    async function cleanupCancelledRun(runState) {
        const turnContext = runState?.turnContext;
        if (runState?.mode !== 'mainline' || !turnContext?.dbId) return;
        if (typeof chaptermanagement.deleteTurnIfLatest !== 'function') return;

        try {
            const removed = await chaptermanagement.deleteTurnIfLatest(turnContext.dbId);
            if (removed) {
                Logger.log('TurnRunner', 'Cancellation', `Removed cancelled pre-committed turn dbId=${turnContext.dbId}.`);
            }
        } catch (cleanupError) {
            Logger.warn('TurnRunner', 'Cancellation', `Failed to clean up cancelled turn dbId=${turnContext.dbId}: ${cleanupError.message}`);
        }
    }

    async function resolveSelectedFiles(socket) {
        const response = await socket.emitReceive('get-selected-files', {}, 15000);
        if (response && response.success) return response.selectedFiles || [];
        if (Array.isArray(response)) return response;
        return [];
    }

    function findActiveChatFile(files) {
        return files.find(f => f.mode === 'chat');
    }

    function applyRunProfileToTurnContext(turnContext, runState, profile) {
        turnContext.sceneMode = profile.sceneMode;
        turnContext.runtime.runId = runState.runId;
        turnContext.runtime.turnPipeline = {
            runProfileId: profile.id,
            mode: profile.mode,
            sceneMode: profile.sceneMode,
            persistenceMode: profile.persistenceMode,
            canonicalWrites: profile.canonicalWrites !== false,
            awaitBackgroundTasks: profile.awaitBackgroundTasks === true,
            hookPolicy: profile.hookPolicy || 'all'
        };
    }

    async function ensureStaticDataManager(projectName, rootDirectory, modeLabel) {
        let staticDataManager = getStaticDataManager();
        if (!staticDataManager) {
            staticDataManager = new StaticDataManager(projectName, rootDirectory);
            await staticDataManager.initialize();
            setStaticDataManager(staticDataManager);
            Logger.log('TurnRunner', 'Database', `StaticDataManager initialized on demand for project: ${projectName}${modeLabel ? ` (${modeLabel})` : ''}`);
        }
        return staticDataManager;
    }

    function refreshTimelineInBackground(reason) {
        Promise.resolve(timeline.refresh({ reason }))
            .catch(error => {
                Logger.error('TurnRunner', 'Timeline', `Background timeline refresh failed: ${error.message}`, error);
            });
    }

    async function initializeChatLifecycle(chatDbFullPath, { emitChatDbSwitched = false } = {}) {
        await chaptermanagement.init(chatDbFullPath);

        const chatDbChanged = currentChatDbPath !== chatDbFullPath;
        if (emitChatDbSwitched && chatDbChanged) {
            const viewerState = await chaptermanagement.getViewerState();
            io.emit('chat-db-switched', { path: chatDbFullPath, viewerState });
            currentChatDbPath = chatDbFullPath;
            refreshTimelineInBackground('chat-db-switched');
        } else if (emitChatDbSwitched) {
            Logger.log('TurnRunner', 'Lifecycle', 'Skipping chat-db-switched/timeline refresh: active chat DB unchanged.');
        }

        const settings = getSettings();
        if (settings.narrative_agents?.facts?.enabled !== false) {
            const factManager = require('../memory_manager/storage/fact_manager.js');
            Logger.log('TurnRunner', 'Database', `Initializing FactManager for project: ${getProjectName()} with DB: ${chatDbFullPath}`, 'start');
            await initFactManager(chatDbFullPath);
            await factManager.pruneOrphanInterludeFacts(getProjectName());
            Logger.log('TurnRunner', 'Database', `FactManager initialized for project: ${getProjectName()}`, 'end');
        }

        await pluginManager.executeHook('HOOK_POST_FACT_MANAGER_INIT', { chatDbPath: chatDbFullPath });
        await pluginManager.executeHook('HOOK_CHAT_DB_INITIALIZED', { chatDbPath: chatDbFullPath });
    }

    async function runNarrativeAndTransform(turnContext, settings) {
        const directorConfig = settings.narrative_agents?.director;
        const shouldRunAutomatedDirector =
            directorConfig?.enabled !== false
            && turnContext.directorEnabled === true
            && !turnContext.input?.directorPrompt;
        if (shouldRunAutomatedDirector) {
            addWorkItem('director', 'Director', 60000, 180000);
        }
        addWorkItem('writer', 'Writer', 120000, 300000);

        cancellation.throwIfCancelled('narrative LLM generation');
        await narrativeEngine.generateNextChapter(turnContext);
        cancellation.throwIfCancelled('narrative LLM generation');

        const sprites = await getProjectSprites();
        const backgrounds = await getProjectBackgrounds();
        const osts = await getProjectOSTs();
        cancellation.throwIfCancelled('asset loading');

        turnContext.runtime.assets.sprites = sprites;
        turnContext.runtime.assets.backgrounds = backgrounds;
        turnContext.runtime.assets.osts = osts;

        await pluginManager.executeHook('HOOK_ASSETS_LOADED', turnContext);
        cancellation.throwIfCancelled('assets loaded hook');

        turnContext.runtime.lastSearchstring = getLastSearchstring();
        turnContext.runtime.progress = {
            totalSteps: getTotalSteps(),
            startTime: Date.now(),
            currentStep: 0,
            runId: turnContext.runtime.runId || null
        };

        await vnmanager.transformVNProject(turnContext);
        cancellation.throwIfCancelled('VN transformation');
    }

    async function runMainline(spec, runState, profile) {
        const files = await resolveSelectedFiles(spec.socket);
        const activeChatDbFile = findActiveChatFile(files);
        if (!activeChatDbFile) {
            throw new Error('No active chat database file selected.');
        }
        const chatDbFullPath = activeChatDbFile.path;

        runState.stage = 'initialize_chat';
        throwIfCancelled(runState, 'chat initialization');
        await initializeChatLifecycle(chatDbFullPath, { emitChatDbSwitched: true });
        throwIfCancelled(runState, 'chat initialization');

        const activeProjectName = getProjectName();
        const rootDirectory = getRootDirectory();
        const promptWithCharacter = spec.prompt;

        const turnContext = new TurnContext(activeProjectName, chatDbFullPath, rootDirectory, getMainCharacterName(), getMainCharacterBio());
        runState.turnContext = turnContext;
        turnContext.setChapterManagement(chaptermanagement);
        await turnContext.init();
        applyRunProfileToTurnContext(turnContext, runState, profile);

        turnContext.input.selectedFiles = files;
        turnContext.input.userPrompt = promptWithCharacter;
        turnContext.input.directorPrompt = spec.directorPrompt;
        turnContext.input.softFeedback = spec.softFeedback;
        if (spec.metadata?.inventoryIntent && typeof spec.metadata.inventoryIntent === 'object') {
            turnContext.input.inventoryIntent = spec.metadata.inventoryIntent;
        }
        turnContext.input.directives = await pluginManager.getProjectDirectivesValues(rootDirectory);
        turnContext.runtime.rootDirectory = rootDirectory;
        turnContext.runtime.staticDataManager = await ensureStaticDataManager(activeProjectName, rootDirectory, null);

        pluginManager.setCurrentTurnContext(turnContext);
        runState.stage = 'gatekeeper';
        throwIfCancelled(runState, 'GUI gatekeeper');
        await pluginManager.executeHook('HOOK_GUI_GATEKEEPER', turnContext);
        throwIfCancelled(runState, 'GUI gatekeeper');

        const settings = getSettings();
        runState.stage = 'narrative_transform';
        throwIfCancelled(runState, 'narrative generation');
        await runNarrativeAndTransform(turnContext, settings);
        throwIfCancelled(runState, 'VN transformation');

        runState.stage = 'commit';
        throwIfCancelled(runState, 'turn commit');
        await turnContext.commit();

        return {
            mode: 'mainline',
            turnContext,
            chatDbFullPath
        };
    }

    async function runInterlude(spec, runState, profile) {
        const files = await resolveSelectedFiles(spec.socket);
        const activeChatDbFile = findActiveChatFile(files);
        if (!activeChatDbFile) {
            throw new Error('No active chat database file selected.');
        }
        const chatDbFullPath = activeChatDbFile.path;

        runState.stage = 'initialize_chat';
        throwIfCancelled(runState, 'interlude chat initialization');
        await chaptermanagement.init(chatDbFullPath);
        const interludeSettings = getSettings();
        if (interludeSettings.narrative_agents?.facts?.enabled !== false) {
            const factManager = require('../memory_manager/storage/fact_manager.js');
            Logger.log('TurnRunner', 'Database', `Initializing FactManager for interlude run with DB: ${chatDbFullPath}`, 'start');
            await initFactManager(chatDbFullPath);
            await factManager.pruneOrphanInterludeFacts(getProjectName());
            Logger.log('TurnRunner', 'Database', `FactManager initialized for interlude run.`, 'end');
        }

        const parentTurn = await chaptermanagement.getTurnContext(spec.parentTurnNumber);
        if (!parentTurn) {
            throw new Error(`Parent turn ${spec.parentTurnNumber} not found.`);
        }
        const nextInterludeOrdinal = await chaptermanagement.getNextInterludeOrdinal(parentTurn.dbId);
        const parentBaseTurnNumber = Number.isInteger(parentTurn.creationTurnNumber) && parentTurn.creationTurnNumber > 0
            ? parentTurn.creationTurnNumber
            : parentTurn.turnNumber;

        const rootDirectory = getRootDirectory();
        const activeProjectName = getProjectName();
        const mainCharacter = getMainCharacterName() || 'None';
        const promptWithCharacter = mainCharacter === 'None' ? spec.prompt : `${mainCharacter}: ${spec.prompt}`;

        const turnContext = new TurnContext(activeProjectName, chatDbFullPath, rootDirectory, getMainCharacterName(), getMainCharacterBio());
        runState.turnContext = turnContext;
        turnContext.setChapterManagement(chaptermanagement);
        turnContext.parentTurnDbId = parentTurn.dbId;
        turnContext.turnNumber = parentTurn.turnNumber;
        turnContext.creationTurnNumber = parentTurn.creationTurnNumber;
        const runDirectorOnInterlude = spec?.runDirector === true;
        Logger.log('TurnRunner', 'InterludeDirector', `Incoming spec: runDirector=${runDirectorOnInterlude}, hasDirectorPrompt=${typeof spec?.directorPrompt === 'string' && spec.directorPrompt.trim().length > 0}`);

        turnContext.interludeOrdinal = nextInterludeOrdinal;
        turnContext.directorEnabled = runDirectorOnInterlude;
        applyRunProfileToTurnContext(turnContext, runState, profile);
        turnContext.runtime.turnPipeline.runDirector = runDirectorOnInterlude;
        Logger.log('TurnRunner', 'InterludeDirector', `Applied context: directorEnabled=${turnContext.directorEnabled}, sceneMode=${turnContext.sceneMode}, runProfile=${profile.id}`);

        turnContext.input.selectedFiles = files;
        turnContext.input.userPrompt = promptWithCharacter;
        turnContext.input.directorPrompt = runDirectorOnInterlude
            ? (typeof spec.directorPrompt === 'string' ? spec.directorPrompt : null)
            : null;
        turnContext.input.softFeedback = spec.softFeedback;
        turnContext.input.directives = await pluginManager.getProjectDirectivesValues(rootDirectory);
        turnContext.runtime.rootDirectory = rootDirectory;
        turnContext.runtime.staticDataManager = await ensureStaticDataManager(activeProjectName, rootDirectory, 'interlude');
        turnContext.runtime.interlude = {
            ...(turnContext.runtime.interlude || {}),
            pluginId: typeof spec?.interludeMeta?.pluginId === 'string' ? spec.interludeMeta.pluginId.trim() || null : null,
            parentTurnNumber: parentTurn.turnNumber,
            ordinal: nextInterludeOrdinal,
            label: spec.label || null,
            storageTurnKey: `${parentBaseTurnNumber}.${nextInterludeOrdinal}`,
            optionKey: typeof spec?.interludeMeta?.optionKey === 'string' ? spec.interludeMeta.optionKey.trim().toLowerCase() : null,
            participants: Array.isArray(spec?.interludeMeta?.participants)
                ? spec.interludeMeta.participants
                    .filter(name => typeof name === 'string')
                    .map(name => name.trim())
                    .filter(Boolean)
                : [],
            isCustomInvite: spec?.interludeMeta?.isCustomInvite === true
        };

        pluginManager.setCurrentTurnContext(turnContext);
        runState.stage = 'gatekeeper';
        throwIfCancelled(runState, 'interlude GUI gatekeeper');
        await pluginManager.executeHook('HOOK_GUI_GATEKEEPER', turnContext);
        throwIfCancelled(runState, 'interlude GUI gatekeeper');

        const settings = getSettings();
        runState.stage = 'narrative_transform';
        throwIfCancelled(runState, 'interlude narrative generation');
        await runNarrativeAndTransform(turnContext, settings);
        throwIfCancelled(runState, 'interlude VN transformation');

        const isStoryRelevant = typeof spec.isStoryRelevant === 'boolean'
            ? spec.isStoryRelevant
            : profile.storyRelevantDefault === true;

        runState.stage = 'persist_interlude';
        throwIfCancelled(runState, 'interlude persistence');
        const saved = await chaptermanagement.appendInterlude(parentTurn.dbId, turnContext, {
            ordinal: nextInterludeOrdinal,
            label: spec.label || null,
            isStoryRelevant
        });
        turnContext.interludeOrdinal = saved.ordinal;
        turnContext.runtime.interlude = {
            ...(turnContext.runtime.interlude || {}),
            id: saved.id,
            ordinal: saved.ordinal,
            label: spec.label || null,
            isStoryRelevant: isStoryRelevant === true,
            integrationState: saved.integrationState,
            storageTurnKey: `${parentBaseTurnNumber}.${saved.ordinal}`
        };

        refreshTimelineInBackground('interlude-persisted');

        return {
            mode: 'interlude',
            turnContext,
            parentTurn,
            savedInterlude: saved,
            chatDbFullPath
        };
    }

    async function runTurn(spec) {
        const mode = spec?.mode || 'mainline';
        const profile = resolveRunProfile({
            mode,
            profileId: spec?.runProfileId || spec?.runProfile || null,
            isStoryRelevant: spec?.isStoryRelevant === true
        });
        if (profile.mode !== mode) {
            throw new Error(`Run profile mismatch: mode='${mode}' cannot use profile='${profile.id}' (profile mode='${profile.mode}').`);
        }

        const runState = createRunState(mode, profile.id);
        chaptermanagement.clearBlobCache();

        return await cancellation.runWithContext(runState.cancelContext, async () => {
            try {
                throwIfCancelled(runState, 'run start');
                let result;
                if (mode === 'interlude') {
                    result = await runInterlude(spec, runState, profile);
                } else {
                    result = await runMainline(spec, runState, profile);
                }
                finishRun(runState, 'ok');
                return {
                    ...result,
                    run: {
                        runId: runState.runId,
                        mode: runState.mode,
                        profileId: runState.profileId,
                        startedAt: runState.startedAt,
                        finishedAt: runState.finishedAt
                    }
                };
            } catch (error) {
                const wasPipelineCancelled = error instanceof PipelineAbortError
                    || cancellation.isCancelled(runState.cancelContext);
                if (wasPipelineCancelled) {
                    await cleanupCancelledRun(runState);
                }
                finishRun(runState, wasPipelineCancelled ? 'cancelled' : 'failed', error.message);
                throw error;
            }
        });
    }

    function getActiveRuns() {
        return Array.from(activeRuns.values()).map(v => ({
            runId: v.runId,
            mode: v.mode,
            profileId: v.profileId,
            startedAt: v.startedAt,
            stage: v.stage,
            status: v.status || null,
            cancelled: v.cancelContext?.cancelled === true,
            reason: v.cancelContext?.reason || null,
            activeLlmCalls: v.cancelContext?.llmCalls?.size || 0
        }));
    }

    return {
        runTurn,
        getActiveRuns,
        cancelRun: (runId = null, reason = 'cancelled') => cancellation.cancelRun(runId, reason)
    };
}

module.exports = {
    createTurnRunner
};
