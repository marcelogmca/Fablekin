import { state } from './state.js';
import { elements } from './elements.js';
import { debugLog, debugError, canNavigate, getPluginRouteUrl } from './utils.js';
import { applyVNResult, handleStatusUpdate, resetViewerState, handleWindowFocusChanged } from './engine.js';
import { showPrologueOverlay, hidePrologueOverlay } from './modules/ui_manager.js';
import { compileSequence } from './vn_ucp_compiler.js';
import { dispatchUCPCommand } from './vn_ucp_dispatcher.js';

const _injectedPermanentIds = new Set();

function cancelActiveTtsQueue(reason = 'viewer_context_switched') {
    fetch(getPluginRouteUrl('tts_core', 'cancel-all'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        keepalive: true
    }).catch(() => {
        // Best-effort signal only.
    });
}

function normalizeSceneMode(value) {
    return String(value || 'mainline').toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
}

function normalizeSavedViewerState(rawState) {
    if (!rawState || typeof rawState !== 'object') return null;
    const turnNumber = Number.parseInt(rawState.turnNumber, 10);
    if (!Number.isInteger(turnNumber) || turnNumber <= 0) return null;

    const dialogueIndex = Number.parseInt(rawState.dialogueIndex, 10);
    const sceneMode = normalizeSceneMode(rawState.sceneMode);
    const parsedInterludeId = Number.parseInt(rawState.interludeId, 10);
    const interludeId = sceneMode === 'interlude' && Number.isInteger(parsedInterludeId) && parsedInterludeId > 0
        ? parsedInterludeId
        : null;

    return {
        turnNumber,
        dialogueIndex: Number.isInteger(dialogueIndex) && dialogueIndex >= 0 ? dialogueIndex : 0,
        sceneMode: interludeId ? 'interlude' : 'mainline',
        interludeId,
        storageTurnKey: rawState.storageTurnKey || null
    };
}

function setPendingJumpState(viewerState) {
    state.pendingJumpIndex = viewerState.dialogueIndex;
    state.pendingJumpTurn = viewerState.turnNumber;
    state.pendingJumpSceneMode = viewerState.sceneMode;
    state.pendingJumpInterludeId = viewerState.interludeId;
}

function clearPendingJumpState() {
    state.pendingJumpIndex = null;
    state.pendingJumpTurn = null;
    state.pendingJumpSceneMode = null;
    state.pendingJumpInterludeId = null;
}

function pendingJumpEqualsViewerState(viewerState) {
    return !!viewerState
        && state.pendingJumpTurn === viewerState.turnNumber
        && state.pendingJumpIndex === viewerState.dialogueIndex
        && normalizeSceneMode(state.pendingJumpSceneMode) === viewerState.sceneMode
        && (state.pendingJumpInterludeId || null) === (viewerState.interludeId || null);
}

export function initSocketHandlers(socket) {
    const syncPlayerCharacterName = async () => {
        try {
            const response = await socket.emitReceive('get-player-metadata', {});
            if (response?.success && response.playerMetadata) {
                const resolvedName = typeof response.playerMetadata.name === 'string'
                    ? response.playerMetadata.name.trim()
                    : '';
                state.playerCharacterName = resolvedName;
            }
        } catch (_error) {
            // Best-effort sync only.
        }
    };

    const requestPrologueContentIfTurnZero = (reason = 'turn-zero-refresh') => {
        if (!state.isAtTurnZero || state.isGenerationPhase) return;
        socket.emit('get-prologue-content', { reason });
    };

    // Seed player metadata for reconnects/project switches where the broadcast event
    // may have happened before this viewer session attached.
    syncPlayerCharacterName();

    socket.on('vn-fullscreen-state-changed', (data) => {
        if (data.isFullScreen) {
            document.body.classList.add('fullscreen-mode');
            elements.fullscreenBtn.querySelector('i').textContent = '⤫';
        } else {
            document.body.classList.remove('fullscreen-mode');
            elements.fullscreenBtn.querySelector('i').textContent = '⛶';
        }
    });

    socket.on('vn-processing-background', (data) => {
        debugLog('Background processing started:', data.message);
        socket.emit('status-update', {
            id: 'background_pipeline',
            message: 'Processing background tasks...',
            progress: 10,
            color: 'var(--accent)'
        });
    });

    socket.on('vn-processing-complete', (data) => {
        debugLog('Background processing finished:', data.message);
        socket.emit('status-update', { id: 'background_pipeline', type: 'clear' });
    });

    socket.on('vn-cg-ready', (payload) => {
        if (!state.currentVN) return;
        if (state.currentVN.turnNumber === payload.turnNumber && payload.cgData) {
            const { image, startIdx, endIdx } = payload.cgData;
            for (let i = startIdx; i <= endIdx && i < state.currentVN.sequence.length; i++) {
                state.currentVN.sequence[i].cg = image;
                delete state.currentVN.sequence[i].cg_pending;
                delete state.currentVN.sequence[i].cg_pending_at;
                delete state.currentVN.sequence[i].cg_failed;
                delete state.currentVN.sequence[i].cg_error;
                delete state.currentVN.sequence[i].cg_failed_at;
            }
            if (state.currentIndex >= startIdx && state.currentIndex <= endIdx) {
                const shouldResetCamForCg = !state.currentCg;
                const previousCg = state.currentCg;
                Promise.all([import('./pixi_engine.js'), import('./pixi_renderer.js')]).then(([engineModule, rendererModule]) => {
                    if (shouldResetCamForCg) {
                        engineModule.pixiApp.cam.reset(0, true);
                    }
                    rendererModule.pixiRenderer.updateCg(image, true);
                    state.currentCg = image;
                }).catch((error) => {
                    state.currentCg = previousCg;
                    debugError('[CG] Failed to apply live CG update from vn-cg-ready.', error);
                });
            }

            // Re-compile the sequence so the directorState knows about the new CG coverage
            const prevTurn = state.turnHistory[state.turnHistory.length - 1];
            const prevLastLine = prevTurn?.sequence?.[prevTurn.sequence.length - 1];
            const initialVfx = prevLastLine?.directorState?.vfx || [];
            const initialSfx = prevLastLine?.directorState?.sfx || [];
            const cinematographerSettings = window.CINEMATOGRAPHER_SETTINGS || {};
            state.currentVN.sequence = compileSequence(
                state.currentVN.sequence, 
                state.playerCharacterName, 
                state.currentVN.initialBackground, 
                state.currentVN.finalSong,
                initialVfx,
                initialSfx,
                cinematographerSettings
            );

            PIXI.Assets.load(`../../${image}`).catch(() => {});
        }
    });

    socket.on('vn-cg-failed', (payload) => {
        if (!state.currentVN) return;
        if (state.currentVN.turnNumber === payload.turnNumber && payload.cgData) {
            const { startIdx, endIdx, reason } = payload.cgData;
            if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return;
            for (let i = startIdx; i <= endIdx && i < state.currentVN.sequence.length; i++) {
                delete state.currentVN.sequence[i].cg_pending;
                delete state.currentVN.sequence[i].cg_pending_at;
                if (!state.currentVN.sequence[i].cg) {
                    state.currentVN.sequence[i].cg_failed = true;
                    state.currentVN.sequence[i].cg_error = reason || 'CG generation failed.';
                    state.currentVN.sequence[i].cg_failed_at = new Date().toISOString();
                }
            }
        }
    });

    socket.on('vn-processing-error', (data) => {
        debugError('Background processing error:', data.message);
        handleStatusUpdate({
            id: 'background_pipeline_error',
            message: 'Background task issue',
            details: data.details || data.message,
            icon: '⚠️',
            variant: 'error',
            timeout: 60000
        });
        // Clear the regular background processing status
        handleStatusUpdate({ id: 'background_pipeline', type: 'clear' });
    });

    socket.on('generation-phase-start', () => {
        console.info('[GenerationFlow] phase-start', {
            turnNumber: state.currentVN?.turnNumber ?? null,
            sceneMode: state.currentVN?.sceneMode || null,
            sceneIndex: state.currentIndex
        });
        state.isGenerationPhase = true;
        state.activeGenerationRunId = null;
        state.generationCancelRequested = false;
        if (elements.cancelGenerationBtn) {
            elements.cancelGenerationBtn.disabled = false;
            elements.cancelGenerationBtn.textContent = 'Cancel';
        }
        hidePrologueOverlay();
        // We need updateBlockingOverlay here, but it's in engine.js
        // For circular dependencies or shared functions, we might need a separate dispatcher or just import it.
        import('./engine.js').then(m => m.updateBlockingOverlay());
    });

    socket.on('generation-run-started', (payload = {}) => {
        state.activeGenerationRunId = payload.runId || null;
        console.info('[GenerationFlow] run-started', {
            runId: state.activeGenerationRunId,
            mode: payload.mode || null,
            profileId: payload.profileId || null
        });
    });

    socket.on('generation-phase-end', () => {
        console.info('[GenerationFlow] phase-end', {
            activeRunId: state.activeGenerationRunId || null,
            cancelRequested: state.generationCancelRequested === true,
            turnNumber: state.currentVN?.turnNumber ?? null,
            sceneMode: state.currentVN?.sceneMode || null,
            sceneIndex: state.currentIndex
        });
        state.isGenerationPhase = false;
        state.activeGenerationRunId = null;
        state.generationCancelRequested = false;
        if (elements.cancelGenerationBtn) {
            elements.cancelGenerationBtn.disabled = false;
            elements.cancelGenerationBtn.textContent = 'Cancel';
        }
        handleStatusUpdate({ id: 'cancel_generation', type: 'clear' });
        import('./engine.js').then(m => m.updateBlockingOverlay());
    });

    socket.on('status-update', (payload) => {
        handleStatusUpdate(payload);
    });

    socket.on('system-log', (payload) => {
        import('./engine.js').then(m => m.handleSystemLog(payload));
    });

    socket.on('inject-permanent-assets', async (payloads) => {
        if (!Array.isArray(payloads)) return;

        // Install the complete permanent DOM/CSS surface before plugin code can
        // request data and render markup owned by later-priority plugins.
        for (const payload of payloads) {
            if (!payload) continue;
            const { id, css, html } = payload;
            const pluginId = id || 'unknown-plugin';

            // CSS: dedup by style element ID (existing logic)
            if (css) {
                const styleId = `permanent-css-${pluginId}`;
                if (!document.getElementById(styleId)) {
                    const styleTag = document.createElement('style');
                    styleTag.id = styleId;
                    styleTag.textContent = css;
                    document.head.appendChild(styleTag);
                }
            }

            // HTML: dedup by container element ID
            if (html) {
                const htmlId = `permanent-html-${pluginId}`;
                if (!document.getElementById(htmlId)) {
                    const div = document.createElement('div');
                    div.id = htmlId;
                    div.innerHTML = html;
                    document.body.appendChild(div);
                }
            }

        }

        // Preserve payload order for JavaScript initialization, but only run it
        // after every plugin's permanent structure and styles are available.
        for (const payload of payloads) {
            if (!payload) continue;
            const { id, js } = payload;
            const pluginId = id || 'unknown-plugin';
            if (js) {
                const jsKey = `permanent-js-${pluginId}`;
                if (_injectedPermanentIds.has(jsKey)) {
                    debugLog(`[SocketHandler] Skipping duplicate JS injection for "${pluginId}"`);
                    continue;
                }
                _injectedPermanentIds.add(jsKey);

                try {
                    const { pixiApp } = await import('./pixi_engine.js');
                    const { pixiSpriteManager } = await import('./pixi_sprite_manager.js');
                    const resolveProjectPath = (relPath, projectNameOverride) => {
                        const projectName = projectNameOverride || state.currentVN?.projectName || state.projectName || window.currentProjectName || 'default_project';
                        let repoRoot = '../../../';
                        return `${repoRoot}workspace/projects/${projectName.toLowerCase()}/${relPath}`;
                    };

                    const resolvePluginPath = (pId, relPath) => {
                        let engineRoot = '../../';
                        return `${engineRoot}plugins/${pId}/${relPath}`;
                    };

                    const context = { 
                        pluginId, socket, elements, state, debugLog, debugError,
                        PIXI: window.PIXI,
                        pixiApp,
                        pixiSpriteManager,
                        resolveProjectPath,
                        resolvePluginPath
                    };
                    const pluginScript = new Function('context', js);
                    pluginScript(context);
                } catch (error) { debugError(`Error executing permanent JS for ${pluginId}:`, error); }
            }
        }
    });

    socket.on('gui-plugin-intercept', async (payload) => {
        const { pluginId, data, interceptRunId } = payload;
        if (data.html || data.css || data.js) {
            injectPluginUI(pluginId, data, socket, interceptRunId);
        } else {
            window.alert(`Plugin ${pluginId} requested more information: ${JSON.stringify(data)}`);
            socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: { confirmed: true, timestamp: Date.now() }, interceptRunId });
        }
    });

    socket.on('player-character-updated', (data) => {
        state.playerCharacterName = data.name;
        requestPrologueContentIfTurnZero('player-character-updated');
    });

    let focusStabilizerTimeout = null;

    socket.on('window-focus-changed', (data) => {
        console.log('[VN Focus] Received window-focus-changed:', data.isFocused);
        state.isFocused = data.isFocused;

        // Clear any existing stabilization timeout
        if (focusStabilizerTimeout) clearTimeout(focusStabilizerTimeout);

        if (state.isFocused && (state.pendingOstResume || state.pendingSfxResume || state.pendingVoiceResume)) {
            // Apply a 300ms debounce to stabilize false 'focus' blips caused by flashFrame()
            focusStabilizerTimeout = setTimeout(() => {
                // Verify window is STILL focused after the grace period
                if (state.isFocused) {
                    if (state.pendingOstResume) {
                        state.pendingOstResume = false;
                        if (elements.audioPlayer && elements.audioPlayer.paused && elements.audioPlayer.src) {
                            elements.audioPlayer.play().then(() => {
                                if (elements.musicPlayPauseBtn) elements.musicPlayPauseBtn.innerHTML = '<i>⏸</i>';
                            }).catch(e => debugError('OST resume on focus fail', e));
                        }
                    }
                    if (state.pendingSfxResume) {
                        state.pendingSfxResume = false;
                        window.dispatchEvent(new CustomEvent('audio:unmute-generation'));
                    }
                    if (state.pendingVoiceResume) {
                        state.pendingVoiceResume = false;
                        if (elements.voicePlayer && elements.voicePlayer.paused && elements.voicePlayer.src) {
                            import('./engine.js').then(() => {
                                elements.voicePlayer.play().then(() => {
                                    state.isAudioPlaying = true;
                                    state.isVoiceAudioPlaybackActive = true;
                                    // Let the existing audio-ended watchdog and visual handlers run
                                    // Note: If we need visual talking to start perfectly in sync, 
                                    // engine might need a public method, but for now this resumes the paused dialogue audio.
                                }).catch(e => debugError('Voice resume on focus fail', e));
                            });
                        }
                    }
                }
            }, 300);
        }
        
        // --- RE-TRIGGER CHAPTER INTRO ON FOCUS ---
        if (data.isFocused) {
            handleWindowFocusChanged(true);
        }
    });

    socket.on('play-historical-turn-response', (res) => {
        if (state.isGenerationPhase) return;
        if (res.success) applyVNResult(res.result);
    });

    socket.on('chat-db-switched', async (data) => {
        if (state.isGenerationPhase) return;
        const viewerState = normalizeSavedViewerState(data.viewerState);
        if (state.lastSwitchedPath === data.path && pendingJumpEqualsViewerState(viewerState)) {
            return;
        }
        const switchToken = (Number.isInteger(state.chatDbSwitchToken) ? state.chatDbSwitchToken : 0) + 1;
        state.chatDbSwitchToken = switchToken;
        state.lastSwitchedPath = data.path;
        syncPlayerCharacterName();
        cancelActiveTtsQueue('chat_db_switched');
        resetViewerState();
        if (viewerState) {
            state.isAtTurnZero = false;
            if (!canNavigate()) return;
            hidePrologueOverlay();
            setPendingJumpState(viewerState);
            if (viewerState.sceneMode === 'interlude') {
                try {
                    const response = await socket.emitReceive('play-interlude-turn', {
                        interludeId: viewerState.interludeId
                    }, 180000);
                    if (state.chatDbSwitchToken !== switchToken || state.isGenerationPhase) return;
                    if (response?.success && response.result) {
                        applyVNResult(response.result);
                    } else {
                        debugError(`Failed to restore interlude ${viewerState.interludeId}; falling back to parent turn.`, response?.error || response);
                        setPendingJumpState({
                            turnNumber: viewerState.turnNumber,
                            dialogueIndex: 0,
                            sceneMode: 'mainline',
                            interludeId: null
                        });
                        socket.emit('play-historical-turn', { turnNumber: viewerState.turnNumber });
                    }
                } catch (error) {
                    if (state.chatDbSwitchToken !== switchToken || state.isGenerationPhase) return;
                    debugError(`Failed to restore interlude ${viewerState.interludeId}; falling back to parent turn.`, error);
                    setPendingJumpState({
                        turnNumber: viewerState.turnNumber,
                        dialogueIndex: 0,
                        sceneMode: 'mainline',
                        interludeId: null
                    });
                    socket.emit('play-historical-turn', { turnNumber: viewerState.turnNumber });
                }
            } else {
                socket.emit('play-historical-turn', { turnNumber: viewerState.turnNumber });
            }
        } else {
            clearPendingJumpState();
            if (data.path) {
                state.isAtTurnZero = true;
                requestPrologueContentIfTurnZero('chat-db-empty');
            } else {
                state.isAtTurnZero = false;
                import('./engine.js').then(m => m.showPrologueOverlay("No Active Chronology\n\nYour story hasn't started yet! Please go to the Chronicles area in the Content Manager and select a Story Chat (.db) to begin your journey.", false));
            }
        }
    });

    socket.on('get-prologue-content-response', (res) => {
        if (res?.isTurnZero === false) {
            state.isAtTurnZero = false;
            hidePrologueOverlay();
            return;
        }

        if (res?.isTurnZero === true) {
            state.isAtTurnZero = true;
        }

        if (state.isAtTurnZero && res?.success) {
            const content = res.content || "Your story hasn't started yet.\n\nWrite your first action below to begin.";
            showPrologueOverlay(content);
        } else {
            hidePrologueOverlay();
        }
    });

    socket.on('prologue-content-invalidated', (payload = {}) => {
        const reason = payload?.reason || 'prologue-content-invalidated';
        requestPrologueContentIfTurnZero(reason);
    });

    // --- Generic UCP Command Bridge ---
    // Backend plugins can send any UCP command string via: 
    //   tools.socket.emit('vn-command', 'anim:shake:Skirk')
    //   tools.socket.emit('vn-command', 'sfx:trigger:explosion.mp3')
    socket.on('vn-command', (payload) => {
        if (typeof payload === 'string') {
            // Direct UCP string: 'anim:shake:Skirk'
            dispatchUCPCommand(payload);
        } else if (payload && typeof payload.command === 'string') {
            // Object form: { command: 'anim:shake:Skirk' }
            dispatchUCPCommand(payload.command);
        } else if (payload && typeof payload.type === 'string') {
            // Pre-parsed event object: { type: 'vn:anim-shake', payload: { charName: 'Skirk' } }
            window.dispatchEvent(new CustomEvent(payload.type, { detail: payload.payload || payload }));
        }
    });
}

function injectPluginUI(pluginId, uiData, socket, interceptRunId = null) {
    const overlay = document.getElementById('plugin-overlay');
    if (!overlay) return;
    cleanupPluginUI(pluginId);
    if (uiData.css) {
        const styleTag = document.createElement('style');
        styleTag.id = `plugin-css-${pluginId}`;
        styleTag.textContent = uiData.css;
        document.head.appendChild(styleTag);
    }
    overlay.innerHTML = uiData.html || '';
    const resolveProjectPath = (relPath, projectNameOverride) => {
        const projectName = projectNameOverride || state.currentVN?.projectName || state.projectName || window.currentProjectName || 'default_project';
        return `../../../workspace/projects/${projectName.toLowerCase()}/${relPath}`;
    };

    const resolvePluginPath = (pId, relPath) => {
        return `../../plugins/${pId}/${relPath}`;
    };

    const bridge = {
        resolve: (resolutionData) => {
            cleanupPluginUI(pluginId);
            overlay.classList.add('hidden');
            socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: resolutionData, interceptRunId });
        },
        intercept: {
            resolve: (resolutionData) => {
                cleanupPluginUI(pluginId);
                overlay.classList.add('hidden');
                socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: resolutionData, interceptRunId });
            },
            reject: (reason = 'rejected') => {
                cleanupPluginUI(pluginId);
                overlay.classList.add('hidden');
                socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: { canceled: true, reason }, interceptRunId });
            },
            skip: (reason = 'skipped') => {
                cleanupPluginUI(pluginId);
                overlay.classList.add('hidden');
                socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: { canceled: true, reason }, interceptRunId });
            },
            getContext: () => ({
                pluginId,
                interceptRunId,
                turnNumber: state.currentVN?.turnNumber ?? null,
                dialogueIndex: state.currentIndex
            })
        },
        nav: {
            forward: async (steps = 1) => {
                const { showNextMessage } = await import('./engine.js');
                const count = Math.max(1, Number.parseInt(steps, 10) || 1);
                for (let i = 0; i < count; i++) showNextMessage({ force: true });
            },
            back: async (steps = 1) => {
                const { showPrevMessage } = await import('./engine.js');
                const count = Math.max(1, Number.parseInt(steps, 10) || 1);
                for (let i = 0; i < count; i++) showPrevMessage({ force: true });
            },
            goTo: async (index) => {
                const { showMessage } = await import('./engine.js');
                const target = Number.parseInt(index, 10);
                if (!state.currentVN?.sequence || !Number.isInteger(target)) return;
                if (target < 0 || target >= state.currentVN.sequence.length) return;
                state.currentIndex = target;
                showMessage(target);
            }
        },
        input: {
            getText: () => elements.userMessage?.value || '',
            setText: (text) => {
                if (elements.userMessage) elements.userMessage.value = text ?? '';
            },
            submitAndGenerate: async (options = {}) => {
                const { submitUserInput } = await import('./ui_events.js');
                await submitUserInput({
                    skipBeforeSubmit: true,
                    textOverride: typeof options.textOverride === 'string' ? options.textOverride : null,
                    directorPromptOverride: typeof options.directorPromptOverride === 'string' ? options.directorPromptOverride : null
                });
            },
            cancelSubmit: (reason = 'cancelled') => {
                cleanupPluginUI(pluginId);
                overlay.classList.add('hidden');
                socket.emit('gui-plugin-resolved', { pluginId: pluginId, data: { canceled: true, reason }, interceptRunId });
            }
        },
        resolveProjectPath,
        resolvePluginPath
    };
    if (uiData.js) {
        try {
            const pluginScript = new Function('bridge', uiData.js);
            pluginScript(bridge);
        } catch (error) {
            debugError(`Error JS plugin ${pluginId}:`, error);
            bridge.resolve({ error: error.message });
        }
    }
    overlay.classList.remove('hidden');
}

function cleanupPluginUI(pluginId) {
    const styleTag = document.getElementById(`plugin-css-${pluginId}`);
    if (styleTag) styleTag.remove();
    const overlay = document.getElementById('plugin-overlay');
    if (overlay) overlay.innerHTML = '';
}
