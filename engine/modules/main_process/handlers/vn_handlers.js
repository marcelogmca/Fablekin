const { createTurnRunner } = require('../../turn_runner/turn_runner.js');
const { compileCastEnterForPayload } = require('../../vn_manager/rendering/cast_enter_compiler.js');
const { compileSpriteCompositionForPayload } = require('../../vn_manager/rendering/composition_positioner.js');
const { getMaxSpriteSlotsFromSettings } = require('../../vn_manager/rendering/sprite_positioner.js');
const { createSpatialStageSidecarService } = require('../../vn_manager/spatial_stage_sidecar_service.js');
const { createSpriteOpaqueBoundsCacheService } = require('../../vn_manager/sprite_opaque_bounds_cache_service.js');

const { resolveTurnStorageKey } = require('../../turn_storage_key.js');
const { replacePlayerPlaceholders } = require('../../player_placeholders.js');

let electronDialog = null;
try {
    ({ dialog: electronDialog } = require('electron'));
} catch (_) {
    electronDialog = null;
}

function createVnHandlers({
    path,
    fs,
    Logger,
    io,
    sendUiNotification,
    getProjectName,
    TurnLogger,
    pluginManager,
    emitResponse,
    chaptermanagement,
    timeline,
    getSettings,
    initFactManager,
    TurnContext,
    getRootDirectory,
    getMainCharacterName,
    getMainCharacterBio,
    StaticDataManager,
    getStaticDataManager,
    setStaticDataManager,
    narrativeEngine,
    addWorkItem,
    clearWorkQueue,
    getProjectSprites,
    getProjectBackgrounds,
    getProjectOSTs,
    getLastSearchstring,
    getTotalSteps,
    vnmanager,
    PipelineAbortError,
    getMainWindow,
    requestTabSwitch,
    contentManager
}) {
    function interludesEnabled() {
        const settings = getSettings();
        return settings?.infrastructure?.interludes?.enabled !== false;
    }

    const turnRunner = createTurnRunner({
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
    });
    const spatialStageSidecars = createSpatialStageSidecarService({
        path,
        fs,
        getRootDirectory,
        getProjectSprites
    });
    const spriteOpaqueBoundsCache = createSpriteOpaqueBoundsCacheService({
        path,
        fs,
        getRootDirectory,
        getProjectName
    });
    const spriteBoundsFailureLog = new Map();

    const spritePickerExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);
    const backgroundPickerExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.webm']);

    function getPickerDefaultPath(defaultSubdir) {
        const rootDirectory = getRootDirectory?.();
        if (!rootDirectory) return undefined;
        return path.resolve(rootDirectory, 'assets', defaultSubdir);
    }

    async function browseSpatialStageAsset({
        title,
        defaultSubdir,
        filters,
        allowedExtensions,
        resultKey,
        fieldName
    }) {
        if (!electronDialog?.showOpenDialog) {
            return { success: false, error: 'Native file picker is not available.' };
        }

        const mainWindow = getMainWindow?.() || undefined;
        const options = {
            title,
            defaultPath: getPickerDefaultPath(defaultSubdir),
            properties: ['openFile'],
            filters
        };
        const result = mainWindow
            ? await electronDialog.showOpenDialog(mainWindow, options)
            : await electronDialog.showOpenDialog(options);

        if (result?.canceled || !Array.isArray(result?.filePaths) || !result.filePaths[0]) {
            return { success: true, canceled: true, [resultKey]: null };
        }

        const projectAssetPath = spatialStageSidecars.resolveProjectAssetRelative(result.filePaths[0], {
            allowedExtensions,
            fieldName,
            strictAbsolute: true
        });
        return { success: true, canceled: false, [resultKey]: projectAssetPath };
    }

    async function emitVNTurn(turnContext, isReplay = false, responseEvent = null, extraPayload = null) {
        const chatFileName = turnContext.chatDbFullPath ? path.basename(turnContext.chatDbFullPath, '.db') : null;

        // Final modification point before data is sent to the viewer.
        await pluginManager.executeHook('HOOK_VN_EMIT_TURN', turnContext);

        const turnNumber = turnContext.turnNumber;
        let navigation = { prev: null, next: null };
        let initialBackground = null;

        try {
            const sceneMode = turnContext.sceneMode || 'mainline';

            if (sceneMode !== 'interlude' && turnNumber > 1) {
                const prevTC = await chaptermanagement.getTurnMetadata(turnNumber - 1);
                if (prevTC) {
                    navigation.prev = {
                        turnNumber: prevTC.turnNumber,
                        title: prevTC.output.title || `Turn ${prevTC.turnNumber}`,
                        synopsis: prevTC.output.synopsis,
                        thumbnail: prevTC.thumbnail
                    };
                    const prevFullTC = await chaptermanagement.getTurnContext(turnNumber - 1).catch(() => null);
                    initialBackground = prevFullTC?.output?.finalBackground || prevTC.output.finalBackground || null;
                }
            }

            if (sceneMode === 'interlude' && turnNumber > 0) {
                const parentTC = await chaptermanagement.getTurnContext(turnNumber).catch(() => null);
                initialBackground = parentTC?.output?.finalBackground || null;
            }

            if (sceneMode !== 'interlude') {
                const nextTC = await chaptermanagement.getTurnMetadata(turnNumber + 1);
                if (nextTC) {
                    navigation.next = {
                        turnNumber: nextTC.turnNumber,
                        title: nextTC.output.title || `Turn ${nextTC.turnNumber}`,
                        synopsis: nextTC.output.synopsis,
                        thumbnail: nextTC.thumbnail
                    };
                }
            }
        } catch (err) {
            Logger.error('Main', 'VNOperations', 'Error fetching navigation metadata', err);
        }

        // Core staging pass: materialize forced cast entries, then compile comp:*
        // cinematic layout directives immediately before payload emission.
        try {
            await compileCastEnterForPayload(turnContext?.output?.sequence, {
                turnContext,
                playerCharacterName: turnContext?.input?.playerCharacterName || '',
                maxSprites: getMaxSpriteSlotsFromSettings(getSettings())
            });
        } catch (error) {
            Logger.error('Main', 'VNOperations', 'Cast enter compiler failed before emit', error);
        }

        try {
            compileSpriteCompositionForPayload(turnContext?.output?.sequence, {
                playerCharacterName: turnContext?.input?.playerCharacterName || ''
            });
        } catch (error) {
            Logger.error('Main', 'VNOperations', 'Composition compiler failed before emit', error);
        }

        const payload = {
            ...turnContext.output,
            processed: turnContext.processed,
            pipelineErrors: turnContext.runtime.pipelineErrors || [],
            intercepts: {
                version: 1,
                persisted: Array.isArray(turnContext.output?.guiIntercepts) ? turnContext.output.guiIntercepts : [],
                runtime: Array.isArray(turnContext.runtime?.guiIntercepts) ? turnContext.runtime.guiIntercepts : []
            },
            turnNumber: turnContext.turnNumber,
            chatFileName,
            projectName: turnContext.projectName,
            playerCharacterName: turnContext.input?.playerCharacterName || '',
            isReplay,
            navigation,
            initialBackground,
            sceneMode: turnContext.sceneMode || 'mainline',
            storageTurnKey: resolveTurnStorageKey(turnContext)
        };
        if (extraPayload && typeof extraPayload === 'object') {
            Object.assign(payload, extraPayload);
        }
        emitResponse(responseEvent || (isReplay ? 'play-historical-turn-response' : 'generate-vn-turn-response'), { success: true, result: payload });
    }

    const handlers = {
        async generateVNTurn(socket, { prompt, directorPrompt, softFeedback, metadata }) {
            Logger.log('TurnLifecycle', '[TURN GEN START]', 'start');
            Logger.log('Main', 'Lifecycle', 'generateVNTurn entered', 'start');
            io.emit('generation-phase-start');
            Logger.log('Main', 'VNOperations', '--- GENERATE VN TURN START ---', null, { prompt });

            sendUiNotification({
                id: 'narrative_pipeline',
                message: '\u{1F680} Booting Turn Sequence...',
                blocking: true,
                priority: 100,
                icon: '\u{1F680}'
            });

            const projectName = getProjectName();
            await TurnLogger.startNewTurnLog(projectName);

            // Turn initialization before any logic runs.
            await pluginManager.executeHook('HOOK_TURN_START', { projectName });

            try {
                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u{1F4BE} Loading world database...',
                    blocking: true,
                    priority: 100,
                    icon: '\u{1F4BE}'
                });

                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u{1F9E0} Initializing Turn Context...',
                    blocking: true,
                    priority: 100,
                    icon: '\u{1F9E0}'
                });

                Logger.log('Main', 'VNOperations', 'Delegating generation to TurnRunner');
                const runResult = await turnRunner.runTurn({
                    mode: 'mainline',
                    socket,
                    prompt,
                    directorPrompt,
                    softFeedback,
                    metadata
                });
                const newTurnContext = runResult.turnContext;
                Logger.log('Main', 'VNOperations', `TurnRunner completed runId=${runResult.run?.runId || 'n/a'}`);

                const currentLogPath = TurnLogger.getCurrentLogPath();
                if (currentLogPath) {
                    io.emit('new-log-available', { filename: path.basename(currentLogPath) });
                } else {
                    Logger.warn('Main', 'Lifecycle', 'TurnLogger.getCurrentLogPath() returned null or undefined. Skipping log-available emission.');
                }

                Logger.log('Main', 'Lifecycle', 'Step D: Responding to renderer...');
                await emitVNTurn(newTurnContext);
                Logger.log('TurnLifecycle', '[TURN GEN ENDS] (Blocking)', 'end');

                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u2728 Scene ready!',
                    blocking: true,
                    priority: 100,
                    icon: '\u2728',
                    timeout: 3000
                });
                Logger.log('Main', 'VNOperations', '#######################\nGENERATE VN TURN COMPLETE\n#######################');
            } catch (error) {
                if (error instanceof PipelineAbortError) {
                    Logger.warn('Main', 'Lifecycle', `Generation aborted: ${error.message}`);
                    emitResponse('generate-vn-turn-response', { success: false, error: `Aborted: ${error.message}` });
                } else {
                    Logger.error('Main', 'Lifecycle', 'Error during VN turn generation', null, error);
                    emitResponse('generate-vn-turn-response', { success: false, error: error.message });
                }
            } finally {
                sendUiNotification({
                    id: 'narrative_pipeline',
                    type: 'clear'
                });
                clearWorkQueue();
            }

            const currentLogPath = TurnLogger.getCurrentLogPath();
            if (currentLogPath) {
                io.emit('new-log-available', {
                    projectName: getProjectName(),
                    filename: path.basename(currentLogPath)
                });
            } else {
                Logger.warn('Main', 'Lifecycle', 'TurnLogger.getCurrentLogPath() returned null or undefined at the end of the function. Skipping log-available emission.');
            }
            Logger.log('Main', 'Lifecycle', 'generateVNTurn finished', 'end');
            Logger.log('Main', 'VNOperations', '--- GENERATE VN TURN COMPLETE ---');
            const mainWindow = getMainWindow();
            io.emit('generation-phase-end', { isFocused: mainWindow ? mainWindow.isFocused() : false });
        },

        async reprocessVNTurn(socket, { turnNumber, editedProse }) {
            Logger.log('Main', 'VNOperations', `Reprocessing turn ${turnNumber}...`);

            await requestTabSwitch(socket, { tab: 'viewer' });

            // Give the UI a small tick to process the transition before blocking the event loop.
            await new Promise(resolve => setTimeout(resolve, 150));

            io.emit('generation-phase-start');

            sendUiNotification({
                id: 'narrative_pipeline',
                message: '\u23ED\uFE0F Bypassing Writer Engine...',
                blocking: true,
                priority: 100,
                icon: '\u23ED\uFE0F'
            });

            try {
                const turnContext = await chaptermanagement.getTurnContext(turnNumber);
                if (!turnContext) throw new Error(`Turn ${turnNumber} not found.`);

                if (editedProse !== undefined) {
                    turnContext.processed.narrativeEngine.writerResponse = editedProse;
                }

                // Ensure StaticDataManager is initialized for the reprocess flow.
                let staticDataManager = getStaticDataManager();
                const rootDirectory = getRootDirectory();
                if (!staticDataManager) {
                    const projectName = getProjectName();
                    staticDataManager = new StaticDataManager(projectName, rootDirectory);
                    await staticDataManager.initialize();
                    setStaticDataManager(staticDataManager);
                    Logger.log('Main', 'Database', `StaticDataManager initialized on demand for project: ${projectName} (reprocess)`);
                }
                turnContext.runtime.staticDataManager = staticDataManager;

                // Re-populate transient runtime values lost during DB serialization.
                turnContext.runtime.rootDirectory = rootDirectory;
                turnContext.input.directives = await pluginManager.getProjectDirectivesValues(rootDirectory);

                // Re-load assets to ensure latest project files are available.
                const sprites = await getProjectSprites();
                const backgrounds = await getProjectBackgrounds();
                const osts = await getProjectOSTs();

                turnContext.runtime.assets.sprites = sprites;
                turnContext.runtime.assets.backgrounds = backgrounds;
                turnContext.runtime.assets.osts = osts;

                Logger.log('Main', 'Plugins', 'Executing HOOK_PRE_MANUAL_REPROCESS');
                await pluginManager.executeHook('HOOK_PRE_MANUAL_REPROCESS', turnContext);
                await pluginManager.executeHook('HOOK_ASSETS_LOADED', turnContext);

                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u{1F3AC} Computing visions...',
                    blocking: true,
                    priority: 100,
                    icon: '\u{1F3AC}'
                });

                await vnmanager.transformVNProject(turnContext);
                await turnContext.commit();

                Logger.log('Main', 'VNOperations', `Reprocessing turn ${turnNumber} complete.`);

                emitResponse('reprocess-vn-turn-response', { success: true, turnNumber });

                // Broadcast update to all clients.
                io.emit('turn-updated', { turnNumber, dbId: turnContext.dbId });

                // Play the refined turn (transition already happened at start).
                handlers.playHistoricalTurn(socket, { turnNumber });
            } catch (error) {
                Logger.error('Main', 'VNOperations', `Error reprocessing turn ${turnNumber}:`, error);
                emitResponse('reprocess-vn-turn-response', { success: false, error: error.message });
            } finally {
                sendUiNotification({
                    id: 'narrative_pipeline',
                    type: 'clear'
                });
                const mainWindow = getMainWindow();
                io.emit('generation-phase-end', { isFocused: mainWindow ? mainWindow.isFocused() : false });
            }
        },

        async playHistoricalTurn(socket, { turnNumber }) {
            Logger.log('Main', 'VNOperations', `playHistoricalTurn requested for turn ${turnNumber}`, 'start');
            try {
                const turnContext = await chaptermanagement.getTurnContext(turnNumber);
                if (!turnContext) {
                    Logger.error('Main', 'VNOperations', `Turn ${turnNumber} not found.`);
                    return emitResponse('play-historical-turn-response', { success: false, error: `Turn ${turnNumber} not found.` });
                }
                pluginManager.setCurrentTurnContext(turnContext);

                await emitVNTurn(turnContext, true);
                Logger.log('Main', 'VNOperations', `Historical turn ${turnNumber} sent to viewer.`, 'end');
            } catch (error) {
                Logger.error('Main', 'VNOperations', `Error playing historical turn ${turnNumber}`, error);
                emitResponse('play-historical-turn-response', { success: false, error: error.message });
            }
        },

        async cancelVnGeneration(_socket, { runId = null, reason = 'User cancelled generation.' } = {}) {
            const cancelReason = typeof reason === 'string' && reason.trim()
                ? reason.trim()
                : 'User cancelled generation.';
            const activeRunsBeforeCancel = turnRunner.getActiveRuns();
            Logger.warn('Main', 'VNOperations', `[GenerationFlow] cancel-vn-generation requested runId=${runId || 'all'} reason="${cancelReason}" activeRuns=${activeRunsBeforeCancel.map((run) => run.runId).join(', ') || 'none'}`);
            const result = turnRunner.cancelRun(runId || null, cancelReason);

            if (result.success) {
                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: 'Cancelling generation...',
                    blocking: true,
                    priority: 120,
                    icon: 'Stop'
                });
                Logger.warn('Main', 'VNOperations', `Cancel requested for VN generation run(s): ${result.cancelledRunIds.join(', ')}`);
            }
            Logger.warn('Main', 'VNOperations', `[GenerationFlow] cancel-vn-generation result success=${result.success} cancelledRunIds=${result.cancelledRunIds.join(', ') || 'none'} activeRunCount=${result.activeRunCount}`);

            emitResponse('cancel-vn-generation-response', {
                success: result.success,
                cancelledRunIds: result.cancelledRunIds,
                activeRunCount: result.activeRunCount,
                error: result.success ? null : 'No active generation run found.'
            });
        },

        async generateInterludeTurn(socket, { parentTurnNumber, prompt, directorPrompt, interludeMeta = null, softFeedback, label, isStoryRelevant, runProfileId = null, runProfile = null, runDirector = false }) {
            if (!interludesEnabled()) {
                return emitResponse('generate-interlude-turn-response', { success: false, error: 'Interludes are disabled by settings.' });
            }

            Logger.log('Main', 'VNOperations', `generateInterludeTurn entered (parent=${parentTurnNumber})`, 'start');
            Logger.log('Main', 'VNOperations', `InterludeDirector flags: runDirector=${runDirector === true}, hasDirectorPrompt=${typeof directorPrompt === 'string' && directorPrompt.trim().length > 0}`);
            Logger.log('Main', 'VNOperations', `[GenerationFlow] interlude-request parent=${parentTurnNumber} optionKey=${interludeMeta?.optionKey || 'n/a'} isCustomInvite=${interludeMeta?.isCustomInvite === true} participants=${Array.isArray(interludeMeta?.participants) ? interludeMeta.participants.join(', ') : 'none'} runProfileId=${runProfileId || runProfile || 'default'}`);
            io.emit('generation-phase-start');
            sendUiNotification({
                id: 'narrative_pipeline',
                message: '\u{1F3D5}\uFE0F Preparing interlude sequence...',
                blocking: true,
                priority: 100,
                icon: '\u{1F3D5}\uFE0F'
            });
            const projectName = getProjectName();
            await TurnLogger.startNewTurnLog(projectName);

            try {
                const requestedProfile = typeof runProfileId === 'string' && runProfileId.trim()
                    ? runProfileId.trim()
                    : (typeof runProfile === 'string' && runProfile.trim() ? runProfile.trim() : null);
                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u{1F9E0} Initializing interlude context...',
                    blocking: true,
                    priority: 100,
                    icon: '\u{1F9E0}'
                });

                const runResult = await turnRunner.runTurn({
                    mode: 'interlude',
                    socket,
                    parentTurnNumber,
                    prompt,
                    directorPrompt,
                    runDirector: runDirector === true,
                    interludeMeta,
                    softFeedback,
                    label,
                    isStoryRelevant,
                    runProfileId: requestedProfile
                });
                const interludeContext = runResult.turnContext;
                const parentTurn = runResult.parentTurn;
                const saved = runResult.savedInterlude;
                const effectiveRunProfileId = runResult?.run?.profileId || interludeContext?.runtime?.turnPipeline?.runProfileId || null;
                Logger.log('Main', 'VNOperations', `[GenerationFlow] interlude-run-complete runId=${runResult?.run?.runId || 'n/a'} savedInterludeId=${saved?.id || 'n/a'} ordinal=${saved?.ordinal || 'n/a'}`);

                await emitVNTurn(
                    interludeContext,
                    false,
                    'generate-interlude-turn-response',
                    {
                        interlude: {
                            id: saved.id,
                            parentTurnNumber: parentTurn.turnNumber,
                            ordinal: saved.ordinal,
                            label: label || null,
                            displayTurn: `${parentTurn.turnNumber}.${saved.ordinal}`,
                            isStoryRelevant: saved.isStoryRelevant === true,
                            integrationState: saved.integrationState,
                            runProfileId: effectiveRunProfileId
                        }
                    }
                );

                const currentLogPath = TurnLogger.getCurrentLogPath();
                if (currentLogPath) {
                    io.emit('new-log-available', {
                        projectName,
                        filename: path.basename(currentLogPath)
                    });
                }
                sendUiNotification({
                    id: 'narrative_pipeline',
                    message: '\u2728 Interlude ready!',
                    blocking: true,
                    priority: 100,
                    icon: '\u2728',
                    timeout: 3000
                });
            } catch (error) {
                if (error instanceof PipelineAbortError) {
                    Logger.warn('Main', 'VNOperations', `Interlude generation aborted: ${error.message}`);
                    emitResponse('generate-interlude-turn-response', { success: false, error: `Aborted: ${error.message}` });
                } else {
                    Logger.error('Main', 'VNOperations', 'Error during interlude generation', error);
                    emitResponse('generate-interlude-turn-response', { success: false, error: error.message });
                }
            } finally {
                sendUiNotification({
                    id: 'narrative_pipeline',
                    type: 'clear'
                });
                clearWorkQueue();
                const currentLogPath = TurnLogger.getCurrentLogPath();
                if (currentLogPath) {
                    io.emit('new-log-available', {
                        projectName,
                        filename: path.basename(currentLogPath)
                    });
                }
                const mainWindow = getMainWindow();
                Logger.log('Main', 'VNOperations', '[GenerationFlow] interlude-phase-end emitted');
                io.emit('generation-phase-end', { isFocused: mainWindow ? mainWindow.isFocused() : false });
            }
        },

        async playInterludeTurn(_socket, { interludeId }) {
            if (!interludesEnabled()) {
                return emitResponse('play-interlude-turn-response', { success: false, error: 'Interludes are disabled by settings.' });
            }
            try {
                Logger.log('Main', 'VNOperations', `[GenerationFlow] play-interlude-turn requested interludeId=${interludeId}`);
                const turnContext = await chaptermanagement.getInterludeContext(interludeId);
                if (!turnContext) {
                    return emitResponse('play-interlude-turn-response', { success: false, error: `Interlude ${interludeId} not found.` });
                }
                pluginManager.setCurrentTurnContext(turnContext);
                const displayTurn = `${turnContext.turnNumber}.${turnContext.interludeOrdinal}`;
                await emitVNTurn(turnContext, true, 'play-interlude-turn-response', {
                    interlude: {
                        id: interludeId,
                        parentTurnNumber: turnContext.turnNumber,
                        ordinal: turnContext.interludeOrdinal,
                        displayTurn,
                        isStoryRelevant: turnContext.runtime?.interlude?.isStoryRelevant === true,
                        integrationState: turnContext.runtime?.interlude?.integrationState || 'none',
                        integrationNote: turnContext.runtime?.interlude?.integrationNote || null
                    }
                });
                Logger.log('Main', 'VNOperations', `[GenerationFlow] play-interlude-turn emitted turn=${turnContext.turnNumber}.${turnContext.interludeOrdinal}`);
            } catch (error) {
                Logger.error('Main', 'VNOperations', `Error playing interlude ${interludeId}`, error);
                emitResponse('play-interlude-turn-response', { success: false, error: error.message });
            }
        },

        async getPendingInterludeIntegrations(_socket, { parentTurnNumber = null, limit = 50 } = {}) {
            if (!interludesEnabled()) {
                return emitResponse('get-pending-interlude-integrations-response', { success: false, error: 'Interludes are disabled by settings.' });
            }
            try {
                let parentTurnDbId = null;
                if (Number.isInteger(parentTurnNumber) && parentTurnNumber > 0) {
                    const parentMeta = await chaptermanagement.getTurnMetadata(parentTurnNumber);
                    if (!parentMeta) {
                        return emitResponse('get-pending-interlude-integrations-response', { success: false, error: `Parent turn ${parentTurnNumber} not found.` });
                    }
                    parentTurnDbId = parentMeta.dbId;
                }

                const rows = await chaptermanagement.getPendingInterludeIntegrations({
                    parentTurnDbId,
                    limit: Number.isInteger(limit) && limit > 0 ? limit : 50
                });
                const result = rows.map(r => ({
                    ...r,
                    parentTurnNumber: r.parent_creation_turn_number,
                    displayTurn: `${r.parent_creation_turn_number}.${r.ordinal}`
                }));

                emitResponse('get-pending-interlude-integrations-response', { success: true, result });
            } catch (error) {
                Logger.error('Main', 'VNOperations', 'Error fetching pending interlude integrations', error);
                emitResponse('get-pending-interlude-integrations-response', { success: false, error: error.message });
            }
        },

        async integrateInterlude(_socket, { interludeId, force = false } = {}) {
            if (!interludesEnabled()) {
                return emitResponse('integrate-interlude-response', { success: false, error: 'Interludes are disabled by settings.' });
            }
            try {
                const result = await chaptermanagement.integrateInterludeIntoParent(interludeId, { force: force === true });
                await timeline.refresh();
                emitResponse('integrate-interlude-response', { success: true, result });
            } catch (error) {
                Logger.error('Main', 'VNOperations', `Error integrating interlude ${interludeId}`, error);
                emitResponse('integrate-interlude-response', { success: false, error: error.message });
            }
        },

        async deleteInterlude(_socket, { interludeId } = {}) {
            if (!interludesEnabled()) {
                return emitResponse('delete-interlude-response', { success: false, error: 'Interludes are disabled by settings.' });
            }
            try {
                const parsedId = Number.parseInt(interludeId, 10);
                if (!Number.isInteger(parsedId) || parsedId < 1) {
                    return emitResponse('delete-interlude-response', { success: false, error: 'interludeId must be a positive integer.' });
                }

                const result = await chaptermanagement.deleteInterlude(parsedId);
                if (!result) {
                    return emitResponse('delete-interlude-response', { success: false, error: `Interlude ${parsedId} not found.` });
                }

                await timeline.refresh();
                emitResponse('delete-interlude-response', { success: true, result });
            } catch (error) {
                Logger.error('Main', 'VNOperations', `Error deleting interlude ${interludeId}`, error);
                emitResponse('delete-interlude-response', { success: false, error: error.message });
            }
        },

        async getProjectSprites(_socket) {
            Logger.log('Main', 'VNOperations', 'Get project sprites requested');
            const files = await getProjectSprites();
            emitResponse('get-project-sprites-response', files);
        },

        async getProjectBackgrounds(_socket) {
            Logger.log('Main', 'VNOperations', 'Get project backgrounds requested');
            const files = await getProjectBackgrounds();
            emitResponse('get-project-backgrounds-response', files);
        },

        async getSpriteOpaqueBounds(socket, data = {}) {
            const requestId = typeof data?.requestId === 'string' && /^[a-z0-9-]{1,64}$/i.test(data.requestId)
                ? data.requestId
                : null;
            const responseEvent = requestId
                ? `sprite-opaque-bounds:get-response:${requestId}`
                : 'sprite-opaque-bounds:get-response';
            const respond = payload => {
                if (requestId && typeof socket?.emit === 'function') socket.emit(responseEvent, payload);
                else emitResponse(responseEvent, payload);
            };
            try {
                const result = await spriteOpaqueBoundsCache.getOrCreate(data?.spritePath);
                respond(result);
            } catch (error) {
                // Rate-limit this: every visible sprite triggers one request per
                // texture, and a persistently failing sprite would otherwise
                // spam the log once per second per texture (see pixi-side
                // negative caching below). Log the full cause Path once, then
                // stay quiet for a while so the log stays usable.
                const now = Date.now();
                const failureKey = String(data?.spritePath || '(unknown path)');
                const last = spriteBoundsFailureLog.get(failureKey) || 0;
                if (now - last > 60000) {
                    spriteBoundsFailureLog.set(failureKey, now);
                    Logger.error('Main', 'SpriteBounds', `Failed to resolve sprite opaque bounds for ${failureKey}`, error);
                }
                respond({
                    success: false,
                    error: error.message || 'Failed to resolve sprite opaque bounds.'
                });
            }
        },

        async spatialStageGetSidecar(_socket, data = {}) {
            try {
                const result = await spatialStageSidecars.readSidecar(data?.backgroundPath);
                emitResponse('spatial-stage:get-sidecar-response', result);
            } catch (error) {
                Logger.error('Main', 'SpatialStage', 'Failed to read Spatial Stage sidecar', error);
                emitResponse('spatial-stage:get-sidecar-response', {
                    success: false,
                    error: error.message || 'Failed to read Spatial Stage sidecar.'
                });
            }
        },

        async spatialStageSaveSidecar(_socket, data = {}) {
            try {
                const result = await spatialStageSidecars.saveSidecar(data?.backgroundPath, data?.metadata);
                emitResponse('spatial-stage:save-sidecar-response', result);
            } catch (error) {
                Logger.error('Main', 'SpatialStage', 'Failed to save Spatial Stage sidecar', error);
                emitResponse('spatial-stage:save-sidecar-response', {
                    success: false,
                    error: error.message || 'Failed to save Spatial Stage sidecar.'
                });
            }
        },

        async spatialStageGetPreviewSprite(_socket) {
            try {
                const result = await spatialStageSidecars.getPreviewSprite();
                emitResponse('spatial-stage:get-preview-sprite-response', result);
            } catch (error) {
                Logger.error('Main', 'SpatialStage', 'Failed to resolve Spatial Stage preview sprite', error);
                emitResponse('spatial-stage:get-preview-sprite-response', {
                    success: false,
                    error: error.message || 'Failed to resolve Spatial Stage preview sprite.'
                });
            }
        },

        async spatialStageBrowseSprite(_socket) {
            try {
                const result = await browseSpatialStageAsset({
                    title: 'Choose Stage Calibrator preview sprite',
                    defaultSubdir: 'sprites',
                    filters: [
                        { name: 'Image sprites', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
                    ],
                    allowedExtensions: spritePickerExtensions,
                    resultKey: 'spritePath',
                    fieldName: 'spritePath'
                });
                emitResponse('spatial-stage:browse-sprite-response', result);
            } catch (error) {
                Logger.error('Main', 'SpatialStage', 'Failed to browse Spatial Stage preview sprite', error);
                emitResponse('spatial-stage:browse-sprite-response', {
                    success: false,
                    error: error.message || 'Failed to browse for preview sprite.'
                });
            }
        },

        async spatialStageBrowseBackground(_socket) {
            try {
                const result = await browseSpatialStageAsset({
                    title: 'Choose Stage Calibrator background',
                    defaultSubdir: 'backgrounds',
                    filters: [
                        { name: 'Background assets', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'mp4', 'webm'] }
                    ],
                    allowedExtensions: backgroundPickerExtensions,
                    resultKey: 'backgroundPath',
                    fieldName: 'backgroundPath'
                });
                emitResponse('spatial-stage:browse-background-response', result);
            } catch (error) {
                Logger.error('Main', 'SpatialStage', 'Failed to browse Spatial Stage background', error);
                emitResponse('spatial-stage:browse-background-response', {
                    success: false,
                    error: error.message || 'Failed to browse for background.'
                });
            }
        },

        async getPrologueContent(_socket) {
            const rootDirectory = getRootDirectory();
            if (!rootDirectory) return emitResponse('get-prologue-content-response', { success: false, error: 'Project not loaded.' });
            try {
                const chapterCount = typeof chaptermanagement?.getChapterCount === 'function'
                    ? await chaptermanagement.getChapterCount()
                    : 0;
                const config = await contentManager.loadFileConfig(rootDirectory);
                const introFiles = [];
                for (const filePath in config.files) {
                    const mode = typeof config.files[filePath] === 'string' ? config.files[filePath] : config.files[filePath].mode;
                    if (mode === 'intro') {
                        introFiles.push({ path: filePath, order: config.files[filePath].order || 0 });
                    }
                }

                introFiles.sort((a, b) => a.order - b.order);

                let concatenatedContent = '';
                for (const file of introFiles) {
                    const content = await fs.readFile(file.path, 'utf-8');
                    concatenatedContent += content.trim() + '\n\n';
                }

                emitResponse('get-prologue-content-response', {
                    success: true,
                    content: replacePlayerPlaceholders(concatenatedContent.trim(), {
                        playerName: getMainCharacterName(),
                        fallbackName: 'the protagonist'
                    }),
                    isTurnZero: chapterCount === 0
                });
            } catch (error) {
                Logger.error('Main', 'VNOperations', 'Error getting prologue content', error);
                emitResponse('get-prologue-content-response', { success: false, error: error.message });
            }
        }
    };

    return handlers;
}

module.exports = {
    createVnHandlers
};
