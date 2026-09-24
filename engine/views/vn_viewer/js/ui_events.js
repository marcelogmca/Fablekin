import { state } from './state.js';
import { elements } from './elements.js';
import { canNavigate, debugError, getPluginRouteUrl, showConfirmation } from './utils.js';
import {
    showPrevMessage,
    showNextMessage,
    showLastMessage,
    processMessage,
    updateAudioVolume,
    updateVoiceVolume
} from './engine.js';
import {
    cancelAutoPlaySchedule,
    completeOrAdvanceDialogue,
    resumeAutoPlayForCurrentMessage,
    showMessage
} from './modules/dialogue_orchestrator.js';
import { getMissingTtsCrcs } from './modules/audio_manager.js';
import { applyVNSettings, debouncedSaveVNSettings } from './settings_manager.js';
import { runBeforeSubmitInterceptors, setInterceptBridgeHandlers, setInterceptSocket } from './intercept_orchestrator.js';
import { isPixiTakeoverActive } from './pixi_takeover_manager.js';
import { handleStatusUpdate } from './modules/status_manager.js';
import { setDialogueHistoryVisible } from './modules/ui_manager.js';

const DIALOGUE_WHEEL_NAVIGATION_THRESHOLD = 40;
const DIALOGUE_WHEEL_NAVIGATION_COOLDOWN_MS = 160;

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

function clampToolbarVerticalPosition(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(300, Math.max(0, parsed));
}

function clampDialogueBoxHeight(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 200;
    return Math.min(420, Math.max(140, parsed));
}

function setDialogueBoxHeightCss(value) {
    const dialogueHeight = clampDialogueBoxHeight(value);
    const cssValue = `${dialogueHeight}px`;
    document.documentElement.style.setProperty('--vn-dialogue-box-height', cssValue);
    if (elements.gameContainer) {
        elements.gameContainer.style.setProperty('--vn-dialogue-box-height', cssValue);
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-dialogue-box-height', cssValue);
    }
    setToolbarVerticalPositionCss(state.vnSettings?.visuals?.toolbar_vertical_offset ?? 0, dialogueHeight);
    return dialogueHeight;
}

function setToolbarVerticalPositionCss(value, dialogueHeightValue = state.vnSettings?.visuals?.dialogue_height ?? 200) {
    const position = clampToolbarVerticalPosition(value);
    const dialogueHeight = clampDialogueBoxHeight(dialogueHeightValue);
    const offsetFromBottom = Math.round(dialogueHeight * position) / 100;
    const top = `calc(100% - ${offsetFromBottom}px)`;
    const translate = `${Math.min(0, position - 100)}%`;

    if (elements.gameContainer) {
        elements.gameContainer.style.setProperty('--vn-toolbar-top', top);
        elements.gameContainer.style.setProperty('--vn-toolbar-translate-y', translate);
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-toolbar-top', top);
        elements.dialogueContainer.style.setProperty('--vn-toolbar-translate-y', translate);
    }
    return position;
}

function getDialogueWheelDeltaY(event) {
    const rawDelta = Number(event?.deltaY);
    if (!Number.isFinite(rawDelta) || rawDelta === 0) return 0;
    if (event.deltaMode === 1) return rawDelta * 16;
    if (event.deltaMode === 2) return rawDelta * window.innerHeight;
    return rawDelta;
}

function isDialogueWheelIgnoredTarget(target) {
    return !!target?.closest?.('#mini-music-player, button, input, textarea, select, a');
}

function getActiveInterludeState() {
    if (state.currentVN?.sceneMode !== 'interlude') return null;
    const interlude = state.currentVN?.interlude || {};
    const interludeId = Number.parseInt(interlude.id, 10);
    const parentTurnNumber = Number.parseInt(interlude.parentTurnNumber ?? state.currentVN?.turnNumber, 10);
    if (!Number.isInteger(parentTurnNumber) || parentTurnNumber < 1) return null;
    return {
        interludeId: Number.isInteger(interludeId) && interludeId > 0 ? interludeId : null,
        parentTurnNumber
    };
}

function restoreUndoneChapterInputs(restoredInputs) {
    if (!restoredInputs || typeof restoredInputs !== 'object') return;
    if (elements.userMessage) elements.userMessage.value = typeof restoredInputs.userPrompt === 'string' ? restoredInputs.userPrompt : '';
    if (elements.directorMessage) elements.directorMessage.value = typeof restoredInputs.directorPrompt === 'string' ? restoredInputs.directorPrompt : '';
    if (elements.feedbackMessage) elements.feedbackMessage.value = typeof restoredInputs.softFeedback === 'string' ? restoredInputs.softFeedback : '';
    if (elements.userMessage && !elements.userMessage.disabled) elements.userMessage.focus();
}

export async function submitUserInput(options = {}) {
    const {
        skipBeforeSubmit = false,
        textOverride = null,
        directorPromptOverride = null,
        softFeedbackOverride = null,
        allowDuringTakeover = false,
        allowInterludeSubmit = false
    } = options;

    if (!canNavigate()) return { success: false, reason: 'cannot_navigate' };
    if (isPixiTakeoverActive() && !allowDuringTakeover) {
        return { success: false, reason: 'pixi_takeover_active' };
    }
    if (!state.lastSwitchedPath) {
        await showConfirmation("No Database", "No active chat database selected. Please select a .db file in the Content Manager and set it to 'Chat' mode.");
        return { success: false, reason: 'no_database' };
    }
    if (state.currentVN?.sceneMode === 'interlude' && !allowInterludeSubmit) {
        return { success: false, reason: 'interlude_input_disabled' };
    }

    let msg = typeof textOverride === 'string' ? textOverride : elements.userMessage.value;
    msg = (msg || '').trim();

    let directorPrompt = typeof directorPromptOverride === 'string'
        ? directorPromptOverride
        : (elements.directorMessage ? elements.directorMessage.value.trim() : '');

    let softFeedback = typeof softFeedbackOverride === 'string'
        ? softFeedbackOverride
        : (elements.feedbackMessage ? elements.feedbackMessage.value.trim() : '');

    const submitDetail = {
        message: msg,
        directorPrompt,
        softFeedback,
        turnNumber: state.currentVN?.turnNumber ?? null,
        dialogueIndex: state.currentIndex
    };
    window.dispatchEvent(new CustomEvent('vn:before-user-input-submit', { detail: submitDetail }));
    if (typeof submitDetail.message === 'string') msg = submitDetail.message.trim();
    if (typeof submitDetail.directorPrompt === 'string') directorPrompt = submitDetail.directorPrompt;
    if (typeof submitDetail.softFeedback === 'string') softFeedback = submitDetail.softFeedback;
    const metadata = {};
    if (submitDetail.inventoryIntent && typeof submitDetail.inventoryIntent === 'object') {
        metadata.inventoryIntent = submitDetail.inventoryIntent;
    }

    if (msg.length === 0) return { success: false, reason: 'empty_message' };

    if (!skipBeforeSubmit) {
        const interceptDecision = await runBeforeSubmitInterceptors({
            message: msg,
            directorPrompt,
            softFeedback
        });

        if (!interceptDecision.allow) {
            return {
                success: false,
                reason: 'intercept_blocked',
                handledByIntercept: !!interceptDecision.handledByIntercept
            };
        }

        if (typeof interceptDecision.message === 'string') {
            msg = interceptDecision.message.trim();
            if (elements.userMessage) elements.userMessage.value = msg;
        }
        if (typeof interceptDecision.directorPrompt === 'string') {
            directorPrompt = interceptDecision.directorPrompt;
            if (elements.directorMessage) elements.directorMessage.value = directorPrompt;
        }
        if (typeof interceptDecision.softFeedback === 'string') {
            softFeedback = interceptDecision.softFeedback;
            if (elements.feedbackMessage) elements.feedbackMessage.value = softFeedback;
        }
    }

    if (!state.playerCharacterName?.trim()) {
        const proceed = await showConfirmation("Missing Name", "Player Character name is not defined. Continue?");
        if (!proceed) return { success: false, reason: 'missing_name_rejected' };
    }

    await processMessage(msg, directorPrompt, softFeedback, metadata);
    return { success: true };
}

export function initUIEvents(socket) {
    setInterceptSocket(socket);
    let vnSettingsModalHandle = null;

    const closeVnSettingsModalIfOpen = async () => {
        if (!vnSettingsModalHandle?.close) return;
        try {
            await vnSettingsModalHandle.close();
        } catch {
            // Best effort close only.
        } finally {
            vnSettingsModalHandle = null;
        }
    };

    const handleSendMessage = async () => {
        await submitUserInput();
    };

    let dialogueWheelDelta = 0;
    let lastDialogueWheelNavigationAt = 0;

    const handleCancelGeneration = async () => {
        if (!state.isGenerationPhase || state.generationCancelRequested) return;

        const confirmed = await showConfirmation(
            'Cancel Generation',
            'Stop the current generation? Active LLM requests will be asked to abort, and the turn will not be applied.'
        );
        if (!confirmed) return;

        console.info('[GenerationFlow] cancel-clicked', {
            runId: state.activeGenerationRunId || null,
            turnNumber: state.currentVN?.turnNumber ?? null,
            sceneMode: state.currentVN?.sceneMode || null,
            sceneIndex: state.currentIndex
        });
        state.generationCancelRequested = true;
        if (elements.cancelGenerationBtn) {
            elements.cancelGenerationBtn.disabled = true;
            elements.cancelGenerationBtn.textContent = 'Cancelling...';
        }

        handleStatusUpdate({
            id: 'cancel_generation',
            message: 'Cancelling generation...',
            blocking: true,
            priority: 120,
            icon: 'Stop',
            promotionDelayMs: null
        });

        try {
            const response = await socket.emitReceive('cancel-vn-generation', {
                runId: state.activeGenerationRunId,
                reason: 'User cancelled from VN Viewer.'
            }, 30000);
            console.info('[GenerationFlow] cancel-response', response || null);

            if (!response?.success) {
                state.generationCancelRequested = false;
                handleStatusUpdate({ id: 'cancel_generation', type: 'clear' });
                if (elements.cancelGenerationBtn) {
                    elements.cancelGenerationBtn.disabled = false;
                    elements.cancelGenerationBtn.textContent = 'Cancel';
                }
                window.Modals?.show({
                    title: 'Cancel Unavailable',
                    content: `<p>${response?.error || 'No active generation run was found.'}</p>`,
                    buttons: [{ text: 'Close' }]
                });
            }
        } catch (error) {
            console.error('[GenerationFlow] cancel-error', error);
            state.generationCancelRequested = false;
            handleStatusUpdate({ id: 'cancel_generation', type: 'clear' });
            if (elements.cancelGenerationBtn) {
                elements.cancelGenerationBtn.disabled = false;
                elements.cancelGenerationBtn.textContent = 'Cancel';
            }
            window.Modals?.show({
                title: 'Cancel Failed',
                content: `<p>${error.message || 'Unable to send the cancel request.'}</p>`,
                buttons: [{ text: 'Close' }]
            });
        }
    };

    setInterceptBridgeHandlers({
        navigateForward: async (steps = 1) => {
            const count = Math.max(1, Number.parseInt(steps, 10) || 1);
            for (let i = 0; i < count; i++) showNextMessage({ force: true });
        },
        navigateBack: async (steps = 1) => {
            const count = Math.max(1, Number.parseInt(steps, 10) || 1);
            for (let i = 0; i < count; i++) showPrevMessage({ force: true });
        },
        navigateTo: async (index) => {
            const target = Number.parseInt(index, 10);
            if (!state.currentVN?.sequence || !Number.isInteger(target)) return;
            if (target < 0 || target >= state.currentVN.sequence.length) return;
            state.currentIndex = target;
            showMessage(target);
        },
        submitAndGenerate: async (options = {}) => {
            const text = typeof options.textOverride === 'string' ? options.textOverride : null;
            const directorPrompt = typeof options.directorPromptOverride === 'string' ? options.directorPromptOverride : null;
            const softFeedback = typeof options.softFeedbackOverride === 'string' ? options.softFeedbackOverride : null;
            await submitUserInput({
                skipBeforeSubmit: true,
                textOverride: text,
                directorPromptOverride: directorPrompt,
                softFeedbackOverride: softFeedback,
                allowDuringTakeover: true,
                allowInterludeSubmit: true
            });
        }
    });

    const isInterceptActive = () => isPixiTakeoverActive() || (elements.pluginOverlay && !elements.pluginOverlay.classList.contains('hidden'));

    const jumpToParentTurnInputState = async (parentTurnNumber) => {
        const maxAttempts = 200;
        const sleepMs = 50;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const vn = state.currentVN;
            const onParentMainlineTurn = vn
                && Number.parseInt(vn.turnNumber, 10) === parentTurnNumber
                && String(vn.sceneMode || 'mainline').toLowerCase() !== 'interlude';

            if (onParentMainlineTurn && state.isApplyingVNResult !== true) {
                showLastMessage({ force: true });
                return;
            }

            await new Promise(resolve => setTimeout(resolve, sleepMs));
        }
    };

    const returnToParentTurn = async (parentTurnNumber) => {
        const response = await socket.emitReceive('play-historical-turn', { turnNumber: parentTurnNumber }, 180000);
        if (!response || !response.success) {
            throw new Error(response?.error || `Failed to return to chapter ${parentTurnNumber}.`);
        }
        await jumpToParentTurnInputState(parentTurnNumber);
    };

    const openHistoricalTurnAtLatestDialogue = async (turnNumber) => {
        const response = await socket.emitReceive('play-historical-turn', { turnNumber }, 180000);
        if (!response || !response.success) {
            throw new Error(response?.error || `Failed to open chapter ${turnNumber}.`);
        }
        await jumpToParentTurnInputState(turnNumber);
    };

    const handleReturnFromInterlude = async () => {
        if (isInterceptActive()) return;
        if (!canNavigate()) return;
        const interludeState = getActiveInterludeState();
        if (!interludeState) return;

        cancelActiveTtsQueue('interlude_return_requested');
        if (elements.interludeReturnBtn) elements.interludeReturnBtn.disabled = true;
        try {
            await returnToParentTurn(interludeState.parentTurnNumber);
        } catch (err) {
            await showConfirmation('Error', err.message || 'Failed to return to parent chapter.');
            if (elements.interludeReturnBtn) elements.interludeReturnBtn.disabled = false;
        }
    };

    const toggleAutoPlay = () => {
        if (isInterceptActive()) return;
        state.autoPlay = !state.autoPlay;
        elements.autoBtn.classList.toggle('is-auto-playing', state.autoPlay);

        if (state.autoPlay) {
            resumeAutoPlayForCurrentMessage();
        } else {
            cancelAutoPlaySchedule();
        }
    };

    const handleUndo = async () => {
        if (isInterceptActive()) return;
        if (!canNavigate()) return;

        const interludeState = getActiveInterludeState();
        if (interludeState) {
            const confirmDeleteInterlude = await showConfirmation(
                'Undo Interlude',
                `This interlude will be deleted and you will return to Chapter ${interludeState.parentTurnNumber}. Continue?`
            );
            if (!confirmDeleteInterlude) return;
            cancelActiveTtsQueue('undo_interlude_requested');

            if (elements.undoBtn) elements.undoBtn.disabled = true;
            if (elements.interludeReturnBtn) elements.interludeReturnBtn.disabled = true;
            const statusId = 'undo-interlude-progress';
            handleStatusUpdate({
                id: statusId,
                message: 'Deleting interlude and rebuilding chapter memory... (can take ~20s)',
                blocking: true,
                priority: 95,
                promotionDelayMs: null
            });
            try {
                if (interludeState.interludeId) {
                    const deleteResponse = await socket.emitReceive('delete-interlude', { interludeId: interludeState.interludeId }, 180000);
                    if (!deleteResponse || !deleteResponse.success) {
                        const message = deleteResponse?.error || 'Failed to delete interlude.';
                        const isMissing = /not found|missing|does not exist/i.test(String(message));
                        if (!isMissing) {
                            throw new Error(message);
                        }
                    }
                }
                handleStatusUpdate({
                    id: statusId,
                    message: `Returning to Chapter ${interludeState.parentTurnNumber}...`,
                    blocking: true,
                    priority: 95,
                    promotionDelayMs: null
                });
                await returnToParentTurn(interludeState.parentTurnNumber);
            } catch (err) {
                console.error('Error during interlude undo:', err);
                await showConfirmation('Error', err.message || 'An error occurred while undoing this interlude.');
                if (elements.undoBtn) elements.undoBtn.disabled = false;
                if (elements.interludeReturnBtn) elements.interludeReturnBtn.disabled = false;
            } finally {
                handleStatusUpdate({ id: statusId, type: 'clear' });
            }
            return;
        }

        const confirmDelete = await showConfirmation('Undo Chapter', 'This chapter will be deleted. You will be returned to the end of the previous chapter. Are you sure?');
        if (confirmDelete) {
            cancelActiveTtsQueue('undo_turn_requested');
            try {
                const response = await socket.emitReceive('delete-latest-turn');
                if (!response || !response.success) {
                    await showConfirmation('Error', 'Failed to undo last chapter: ' + (response?.error || 'Unknown error'));
                } else {
                    restoreUndoneChapterInputs(response.restoredInputs);
                }
            } catch (err) {
                console.error('Error during undo:', err);
                await showConfirmation('Error', 'An error occurred while trying to undo.');
            }
        }
    };

    let backendMissingTtsCount = null;
    let backendMissingTtsCrcs = [];
    let backendMissingRefreshInFlight = null;
    let backendMissingRefreshTimer = null;

    const applyMissingTtsButtonState = () => {
        if (!elements.rerequestMissingTtsBtn) return;

        const fallbackCount = getMissingTtsCrcs().length;
        const resolvedCount = Number.isFinite(backendMissingTtsCount) && backendMissingTtsCount >= 0
            ? backendMissingTtsCount
            : fallbackCount;

        if (elements.missingTtsCount) elements.missingTtsCount.textContent = String(resolvedCount);
        elements.rerequestMissingTtsBtn.disabled = resolvedCount === 0;
        elements.rerequestMissingTtsBtn.textContent = resolvedCount > 0
            ? `Re-request Missing Voice Lines (${resolvedCount})`
            : 'Re-request Missing Voice Lines';
    };

    const refreshMissingTtsButtonState = async () => {
        if (backendMissingRefreshInFlight) return backendMissingRefreshInFlight;

        backendMissingRefreshInFlight = (async () => {
            try {
                const response = await fetch(getPluginRouteUrl('tts_core', 'missing-current-turn'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ include_crcs: true }),
                    keepalive: true
                });
                const payload = await response.json().catch(() => ({}));

                if (response.ok && payload.success === true) {
                    backendMissingTtsCount = Number.isFinite(payload.missing_count) ? payload.missing_count : 0;
                    backendMissingTtsCrcs = Array.isArray(payload.crcs) ? payload.crcs.map(crc => String(crc)) : [];
                } else {
                    backendMissingTtsCount = null;
                    backendMissingTtsCrcs = [];
                }
            } catch {
                backendMissingTtsCount = null;
                backendMissingTtsCrcs = [];
            } finally {
                applyMissingTtsButtonState();
                backendMissingRefreshInFlight = null;
            }
        })();

        return backendMissingRefreshInFlight;
    };

    const updateMissingTtsButtonState = () => {
        applyMissingTtsButtonState();
        if (backendMissingRefreshTimer) clearTimeout(backendMissingRefreshTimer);
        backendMissingRefreshTimer = setTimeout(() => {
            backendMissingRefreshTimer = null;
            refreshMissingTtsButtonState().catch(() => {});
        }, 150);
    };

    window.addEventListener('tts:missing-lines-updated', updateMissingTtsButtonState);
    window.addEventListener('vn:result-applied', () => {
        backendMissingTtsCount = null;
        backendMissingTtsCrcs = [];
        updateMissingTtsButtonState();
    });
    updateMissingTtsButtonState();

    elements.sendMessageBtn.addEventListener('click', handleSendMessage);
    elements.undoBtn.addEventListener('click', handleUndo);
    elements.cancelGenerationBtn?.addEventListener('click', handleCancelGeneration);
    if (elements.interludeReturnBtn) {
        elements.interludeReturnBtn.addEventListener('click', handleReturnFromInterlude);
    }
    elements.startBtn.addEventListener('click', () => {
        if (isInterceptActive()) return;
        if (state.currentVN && state.currentIndex !== 0) {
            state.currentIndex = 0;
            showMessage(0);
        }
    });
    elements.prevBtn.addEventListener('click', () => {
        if (isInterceptActive()) return;
        showPrevMessage();
    });
    elements.nextBtn.addEventListener('click', () => {
        if (isInterceptActive()) return;
        showNextMessage();
    });
    elements.skipBtn.addEventListener('click', () => {
        if (isInterceptActive()) return;
        showLastMessage();
    });
    elements.autoBtn.addEventListener('click', toggleAutoPlay);
    elements.dialogueContainer?.addEventListener('click', (event) => {
        if (isInterceptActive()) return;
        if (!state.currentVN?.sequence) return;
        if (event.target.closest('#controls, #mini-music-player, button, input, textarea, select, a')) return;
        completeOrAdvanceDialogue();
    });
    elements.dialogueContainer?.addEventListener('wheel', (event) => {
        if (isInterceptActive()) return;
        if (!state.currentVN?.sequence) return;
        if (isDialogueWheelIgnoredTarget(event.target)) return;

        const deltaY = getDialogueWheelDeltaY(event);
        if (deltaY === 0) return;

        event.preventDefault();
        event.stopPropagation();

        const direction = deltaY > 0 ? 1 : -1;
        if (Math.sign(dialogueWheelDelta) !== direction) {
            dialogueWheelDelta = 0;
        }

        dialogueWheelDelta += deltaY;
        if (Math.abs(dialogueWheelDelta) < DIALOGUE_WHEEL_NAVIGATION_THRESHOLD) return;

        const now = performance.now();
        dialogueWheelDelta = 0;
        if (now - lastDialogueWheelNavigationAt < DIALOGUE_WHEEL_NAVIGATION_COOLDOWN_MS) return;

        lastDialogueWheelNavigationAt = now;
        if (direction > 0) showNextMessage();
        else showPrevMessage();
    }, { passive: false });
    elements.logBtn.addEventListener('click', () => {
        const isVisible = elements.logContainer.style.display === 'flex';
        setDialogueHistoryVisible(!isVisible);
        if (!isVisible) {
            // Scroll to bottom when opening the log
            setTimeout(() => {
                if (elements.logMessages) {
                    elements.logMessages.scrollTop = elements.logMessages.scrollHeight;
                }
            }, 0);
        }
    });


    elements.closeLog.addEventListener('click', () => {
        setDialogueHistoryVisible(false);
    });
    elements.fullscreenBtn.addEventListener('click', () => socket.emit('toggle-vn-fullscreen'));



    [elements.prevChapterNav, elements.nextChapterNav].forEach((el, i) => {
        if (!el) return;
        const type = i === 0 ? 'prev' : 'next';
        el.addEventListener('click', async () => {
            if (isInterceptActive()) return;
            if (!canNavigate()) return;
            if (state.navigation[type]) {
                cancelActiveTtsQueue('historical_turn_requested');
                const targetTurnNumber = state.navigation[type].turnNumber;
                if (type === 'prev') {
                    try {
                        await openHistoricalTurnAtLatestDialogue(targetTurnNumber);
                    } catch (err) {
                        await showConfirmation('Error', err.message || `Failed to open chapter ${targetTurnNumber}.`);
                    }
                    return;
                }
                socket.emit('play-historical-turn', { turnNumber: targetTurnNumber });
            }
        });
    });

    elements.userMessage.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });

    if (elements.statusNotificationGrouper) {
        elements.statusNotificationGrouper.addEventListener('click', () => {
            state.notificationsExpanded = !state.notificationsExpanded;
            const container = document.getElementById('status-notification-container');
            if (container) container.classList.toggle('expanded', state.notificationsExpanded);
            elements.statusNotificationGrouper.classList.toggle('active', state.notificationsExpanded);
        });
    }

    if (elements.vnSettingsBtn) {
        elements.vnSettingsBtn.addEventListener('click', async () => {
            const settingsContent = document.getElementById('vn-settings-content');
            if (settingsContent) {
                await closeVnSettingsModalIfOpen();
                settingsContent.style.display = 'grid';
                vnSettingsModalHandle = window.Modals.show({
                    title: 'VN Settings',
                    content: settingsContent,
                    width: 'min(860px, 94vw)',
                    className: 'vn-settings-modal',
                    draggable: true,
                    onClose: () => {
                        settingsContent.style.display = 'none';
                        document.body.appendChild(settingsContent);
                        vnSettingsModalHandle = null;
                    }
                });
            }
            applyVNSettings();
        });
    }

    elements.ostVolumeSlider?.addEventListener('input', (e) => {
        state.vnSettings.audio.ost_volume = parseFloat(e.target.value);
        if (elements.ostVolumeValue) elements.ostVolumeValue.textContent = `${Math.round(state.vnSettings.audio.ost_volume * 100)}%`;
        updateAudioVolume();
        debouncedSaveVNSettings(socket);
    });

    elements.ttsVolumeSlider?.addEventListener('input', (e) => {
        state.vnSettings.audio.tts_volume = parseFloat(e.target.value);
        if (elements.ttsVolumeValue) elements.ttsVolumeValue.textContent = `${Math.round(state.vnSettings.audio.tts_volume * 100)}%`;
        updateVoiceVolume();
        debouncedSaveVNSettings(socket);
    });

    elements.rerequestMissingTtsBtn?.addEventListener('click', async () => {
        await refreshMissingTtsButtonState();
        const fallbackMissingCount = getMissingTtsCrcs().length;
        const missingCount = Number.isFinite(backendMissingTtsCount) && backendMissingTtsCount >= 0
            ? backendMissingTtsCount
            : fallbackMissingCount;
        if (missingCount === 0) return;

        elements.rerequestMissingTtsBtn.disabled = true;
        const originalText = elements.rerequestMissingTtsBtn.textContent;
        elements.rerequestMissingTtsBtn.textContent = 'Re-requesting missing lines...';

        try {
            const response = await fetch(getPluginRouteUrl('tts_core', 'regenerate-missing-current-turn'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: backendMissingTtsCrcs.length > 0
                    ? JSON.stringify({ crcs: backendMissingTtsCrcs })
                    : JSON.stringify({}),
                keepalive: true
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success === false) {
                await showConfirmation('TTS Re-request Failed', payload.error || 'Unable to re-request missing TTS lines.');
            } else {
                const requested = Number.isFinite(payload.requested) ? payload.requested : 0;
                if (requested > 0) {
                    const jobSuffix = payload.job_id ? `\nJob ID: ${payload.job_id}` : '';
                    await showConfirmation('TTS Re-request Sent', `Requested ${requested} missing line(s).${jobSuffix}`);
                } else {
                    const reason = payload.reason ? ` (${payload.reason})` : '';
                    await showConfirmation('TTS Re-request', `No lines were queued${reason}.`);
                }
            }
        } catch (error) {
            await showConfirmation('TTS Re-request Failed', error.message || 'Network error while re-requesting TTS.');
        } finally {
            elements.rerequestMissingTtsBtn.textContent = originalText;
            await refreshMissingTtsButtonState();
        }
    });

    elements.bgmSfxVolumeSlider?.addEventListener('input', (e) => {
        state.vnSettings.audio.bgm_sfx_volume = parseFloat(e.target.value);
        if (elements.bgmSfxVolumeValue) elements.bgmSfxVolumeValue.textContent = `${Math.round(state.vnSettings.audio.bgm_sfx_volume * 100)}%`;
        window.dispatchEvent(new CustomEvent('vn:settings-updated', { detail: state.vnSettings }));
        debouncedSaveVNSettings(socket);
    });

    elements.sfxVolumeSlider?.addEventListener('input', (e) => {
        state.vnSettings.audio.sfx_volume = parseFloat(e.target.value);
        if (elements.sfxVolumeValue) elements.sfxVolumeValue.textContent = `${Math.round(state.vnSettings.audio.sfx_volume * 100)}%`;
        window.dispatchEvent(new CustomEvent('vn:settings-updated', { detail: state.vnSettings }));
        debouncedSaveVNSettings(socket);
    });

    elements.spriteOffsetSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.sprite_offset = parseInt(e.target.value);
        if (elements.characterContainer) elements.characterContainer.style.setProperty('--sprite-vertical-offset', `${state.vnSettings.visuals.sprite_offset}px`);
        if (elements.spriteOffsetValue) elements.spriteOffsetValue.textContent = `${state.vnSettings.visuals.sprite_offset}px`;

        // Update PixiJS sprites in real time
        import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.updateVerticalOffset(state.vnSettings.visuals.sprite_offset));

        debouncedSaveVNSettings(socket);
    });

    elements.spriteSizeMultiplierSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.sprite_size_multiplier = parseFloat(e.target.value);
        if (elements.spriteSizeMultiplierValue) elements.spriteSizeMultiplierValue.textContent = `${state.vnSettings.visuals.sprite_size_multiplier.toFixed(2)}x`;

        // Update PixiJS sprites in real time
        import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.updateSpriteMultiplier(state.vnSettings.visuals.sprite_size_multiplier));

        debouncedSaveVNSettings(socket);
    });

    elements.spriteHorizontalPaddingSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.sprite_horizontal_padding = parseInt(e.target.value, 10);
        if (elements.spriteHorizontalPaddingValue) {
            elements.spriteHorizontalPaddingValue.textContent = `${state.vnSettings.visuals.sprite_horizontal_padding}%`;
        }

        import('./pixi_sprite_manager.js').then(m => {
            m.pixiSpriteManager.updateHorizontalPadding(state.vnSettings.visuals.sprite_horizontal_padding);
        });

        debouncedSaveVNSettings(socket);
    });

    elements.foregroundBackgroundBlurSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.foreground_background_blur_strength = parseFloat(e.target.value);
        if (elements.foregroundBackgroundBlurValue) {
            elements.foregroundBackgroundBlurValue.textContent = `${state.vnSettings.visuals.foreground_background_blur_strength.toFixed(1)}px`;
        }
        import('./pixi_renderer.js').then(m => m.pixiRenderer.applyForegroundBackgroundBlur());
        debouncedSaveVNSettings(socket);
    });

    elements.dialogueWidthSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.dialogue_width = parseInt(e.target.value, 10);
        if (elements.dialogueWidthValue) elements.dialogueWidthValue.textContent = `${state.vnSettings.visuals.dialogue_width}%`;
        if (elements.dialogueContainer) {
            elements.dialogueContainer.style.setProperty('--vn-dialogue-box-width', `${state.vnSettings.visuals.dialogue_width}%`);
        }
        debouncedSaveVNSettings(socket);
    });

    elements.dialogueHeightSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.dialogue_height = setDialogueBoxHeightCss(e.target.value);
        if (elements.dialogueHeightValue) elements.dialogueHeightValue.textContent = `${state.vnSettings.visuals.dialogue_height}px`;
        debouncedSaveVNSettings(socket);
    });

    elements.toolbarVerticalOffsetSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.toolbar_vertical_offset = setToolbarVerticalPositionCss(e.target.value);
        if (elements.toolbarVerticalOffsetValue) elements.toolbarVerticalOffsetValue.textContent = `${state.vnSettings.visuals.toolbar_vertical_offset}%`;
        debouncedSaveVNSettings(socket);
    });

    elements.panelTransparencySlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.panel_transparency = parseFloat(e.target.value);
        if (elements.panelTransparencyValue) elements.panelTransparencyValue.textContent = `${Math.round(state.vnSettings.visuals.panel_transparency * 100)}%`;
        if (elements.dialogueContainer) {
            elements.dialogueContainer.style.setProperty('--vn-dialogue-panel-opacity', state.vnSettings.visuals.panel_transparency);
        }
        debouncedSaveVNSettings(socket);
    });
    
    elements.panelBlurSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.panel_blur = parseInt(e.target.value);
        if (elements.panelBlurValue) elements.panelBlurValue.textContent = `${state.vnSettings.visuals.panel_blur}px`;
        if (elements.dialogueContainer) {
            elements.dialogueContainer.style.setProperty('--vn-dialogue-panel-blur', `${state.vnSettings.visuals.panel_blur}px`);
            elements.dialogueContainer.style.backdropFilter = 'none';
            elements.dialogueContainer.style.webkitBackdropFilter = 'none';
        }
        debouncedSaveVNSettings(socket);
    });

    elements.textAlignmentSelect?.addEventListener('change', (e) => {
        state.vnSettings.interface.text_alignment = e.target.value;
        if (elements.dialogueText) elements.dialogueText.style.textAlign = state.vnSettings.interface.text_alignment;
        debouncedSaveVNSettings(socket);
    });

    elements.spriteMorphMethodSelect?.addEventListener('change', (e) => {
        state.vnSettings.visuals.sprite_morph_method = e.target.value;
        debouncedSaveVNSettings(socket);
    });

    elements.fontSizeSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.font_size_multiplier = parseFloat(e.target.value);
        if (elements.fontSizeValue) elements.fontSizeValue.textContent = `${state.vnSettings.visuals.font_size_multiplier.toFixed(2)}x`;
        if (elements.dialogueContainer) elements.dialogueContainer.style.setProperty('--vn-font-multiplier', state.vnSettings.visuals.font_size_multiplier);
        debouncedSaveVNSettings(socket);
    });

    elements.modalOverlayOpacitySlider?.addEventListener('input', (e) => {
        state.vnSettings.interface.modal_overlay_opacity = parseFloat(e.target.value);
        if (elements.modalOverlayOpacityValue) {
            elements.modalOverlayOpacityValue.textContent = `${Math.round(state.vnSettings.interface.modal_overlay_opacity * 100)}%`;
        }
        document.documentElement.style.setProperty('--modal-overlay-opacity', state.vnSettings.interface.modal_overlay_opacity);
        debouncedSaveVNSettings(socket);
    });

    elements.writeSpeedSlider?.addEventListener('input', (e) => {
        state.vnSettings.visuals.write_speed = parseInt(e.target.value);
        if (elements.writeSpeedValue) elements.writeSpeedValue.textContent = `${state.vnSettings.visuals.write_speed}ms`;
        debouncedSaveVNSettings(socket);
    });

    elements.autoPlayDelaySlider?.addEventListener('input', (e) => {
        state.vnSettings.interface.auto_play_delay = parseInt(e.target.value);
        if (elements.autoPlayDelayValue) elements.autoPlayDelayValue.textContent = `${state.vnSettings.interface.auto_play_delay}ms`;
        debouncedSaveVNSettings(socket);
    });

    elements.naturalConversationTimingCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.interface.natural_conversation_timing = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.toggleControlsBtn?.addEventListener('click', () => {
        state.vnSettings.interface.show_controls = !state.vnSettings.interface.show_controls;
        const show = state.vnSettings.interface.show_controls;

        // Update master visibility for core controls
        import('./settings_manager.js').then(m => m.updateControlsVisibility());

        // Dispatch event for plugins (HUD, Map, etc.) to sync their visibility
        window.dispatchEvent(new CustomEvent('vn:ui-visibility-toggled', { detail: { show } }));

        debouncedSaveVNSettings(socket);
    });


    elements.hideMainSpritesCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.visuals.hide_main_sprites = e.target.checked;
        import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.updateSpriteVisibility());
        debouncedSaveVNSettings(socket);
    });

    elements.debugViewportCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.debug.debug_viewport = e.target.checked;
        if (!state.vnSettings.debug.debug_viewport) {
            import('./pixi_engine.js').then(m => m.pixiApp.resetViewport());
        }

        // Signal plugins that debug viewport setting has changed
        window.dispatchEvent(new CustomEvent('vn:debug-viewport-updated', {
            detail: { enabled: state.vnSettings.debug.debug_viewport }
        }));

        debouncedSaveVNSettings(socket);
    });

    elements.spatialStageModeSelect?.addEventListener('change', async (e) => {
        const mode = String(e.target.value || 'default');
        const { pixiSpatialStage } = await import('./pixi_spatial_stage.js');
        if (mode === 'default') {
            pixiSpatialStage.clearCommandMode();
            return;
        }
        pixiSpatialStage.setMode(mode);
    });

    elements.ostPopupCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.interface.show_ost_popup = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.showChapterIntroCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.visuals.show_chapter_intro = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.disableOstDuringLoadingCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.audio.disable_ost_during_loading = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.playSoundOnReadyCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.audio.play_sound_on_ready = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.blinkTaskbarOnReadyCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.interface.blink_taskbar_on_ready = e.target.checked;
        debouncedSaveVNSettings(socket);
    });

    elements.showDialogueIndexIndicatorCheckbox?.addEventListener('change', (e) => {
        state.vnSettings.interface.show_dialogue_index_indicator = e.target.checked;
        import('./settings_manager.js').then(m => m.updateControlsVisibility());
        debouncedSaveVNSettings(socket);
    });

    elements.debugZoomSmoothBtn?.addEventListener('click', async () => {
        const { pixiSpriteManager } = await import('./pixi_sprite_manager.js');
        const { pixiApp } = await import('./pixi_engine.js');
        const charNames = Object.keys(pixiSpriteManager.activeSprites);
        if (charNames.length > 0) {
            const randomChar = charNames[Math.floor(Math.random() * charNames.length)];
            const regions = ['top', 'face', 'bottom', 'center'];
            const randomRegion = regions[Math.floor(Math.random() * regions.length)];
            pixiApp.cam.zoomToCharacter(randomChar, randomRegion, 1.5);
        }
    });

    elements.debugZoomInstantBtn?.addEventListener('click', async () => {
        const { pixiSpriteManager } = await import('./pixi_sprite_manager.js');
        const { pixiApp } = await import('./pixi_engine.js');
        const charNames = Object.keys(pixiSpriteManager.activeSprites);
        if (charNames.length > 0) {
            const randomChar = charNames[Math.floor(Math.random() * charNames.length)];
            const regions = ['top', 'face', 'bottom', 'center'];
            const randomRegion = regions[Math.floor(Math.random() * regions.length)];
            pixiApp.cam.zoomToCharacter(randomChar, randomRegion, 0);
        }
    });

    elements.debugCameraClearBtn?.addEventListener('click', () => {
        import('./pixi_engine.js').then(m => m.pixiApp.cam.reset(1));
    });

    elements.stageCalibratorBtn?.addEventListener('click', async () => {
        try {
            await closeVnSettingsModalIfOpen();
            const module = await import('./spatial_stage_calibrator.js');
            await module.openStageCalibrator();
        } catch (error) {
            debugError('[StageCalibrator] Failed to open', error);
            await showConfirmation('Stage Calibrator', error.message || 'Unable to open Stage Calibrator.');
        }
    });

    // Music Player Controls
    elements.musicPlayerBtn?.addEventListener('click', () => {
        state.vnSettings.interface.show_music_player = !state.vnSettings.interface.show_music_player;
        elements.miniMusicPlayer.classList.toggle('minimized', !state.vnSettings.interface.show_music_player);
        debouncedSaveVNSettings(socket);
    });

    elements.musicPlayPauseBtn?.addEventListener('click', () => {
        if (elements.audioPlayer.paused) {
            elements.audioPlayer.play().catch(e => debugError('Music play fail', e));
            elements.musicPlayPauseBtn.innerHTML = '<i>⏸</i>';
        } else {
            elements.audioPlayer.pause();
            elements.musicPlayPauseBtn.innerHTML = '<i>▶</i>';
        }
    });

    const cycleFocus = (reverse = false) => {
        const focusable = [];
        if (state.vnSettings.debug.director_mode && elements.directorMessage) focusable.push(elements.directorMessage);
        if (elements.userMessage) focusable.push(elements.userMessage);
        if (state.vnSettings.debug.feedback_mode && elements.feedbackMessage) focusable.push(elements.feedbackMessage);
        if (elements.sendMessageBtn) focusable.push(elements.sendMessageBtn);
        if (elements.undoBtn) focusable.push(elements.undoBtn);

        if (focusable.length === 0) return;

        const currentIndex = focusable.indexOf(document.activeElement);
        let nextIndex;
        if (reverse) {
            nextIndex = (currentIndex <= 0) ? focusable.length - 1 : currentIndex - 1;
        } else {
            nextIndex = (currentIndex === -1 || currentIndex >= focusable.length - 1) ? 0 : currentIndex + 1;
        }
        focusable[nextIndex].focus();
    };

    // Keyboard Navigation
    window.addEventListener('keydown', (e) => {
        if (isInterceptActive()) return;

        // Space to toggle auto-play (if not in an input)
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            toggleAutoPlay();
            return;
        }

        // Tab to cycle focus
        if (e.key === 'Tab') {
            e.preventDefault();
            cycleFocus(e.shiftKey);
            return;
        }

        // Prevent navigation if user is typing in an input field or textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (!canNavigate()) return;

        if (e.key === 'ArrowLeft') {
            showPrevMessage();
        } else if (e.key === 'ArrowRight') {
            showNextMessage();
        }
    });

    // Window Focus/Blur Listeners have been moved to socket_handler.js 
    // to accurately read from the Electron main process via window-focus-changed event.

    // Director Lip Toggle
    if (elements.directorLip && elements.inputsFrame) {
        elements.directorLip.addEventListener('click', () => {
            state.vnSettings.debug.director_mode = !state.vnSettings.debug.director_mode;
            elements.inputsFrame.classList.toggle('director-active', state.vnSettings.debug.director_mode);
            if (state.vnSettings.debug.director_mode && elements.directorMessage) {
                elements.directorMessage.focus();
            }
            debouncedSaveVNSettings(socket);
        });
    }

    // Feedback Lip Toggle
    if (elements.feedbackLip && elements.inputsFrame) {
        elements.feedbackLip.addEventListener('click', () => {
            state.vnSettings.debug.feedback_mode = !state.vnSettings.debug.feedback_mode;
            elements.inputsFrame.classList.toggle('feedback-active', state.vnSettings.debug.feedback_mode);
            if (state.vnSettings.debug.feedback_mode && elements.feedbackMessage) {
                elements.feedbackMessage.focus();
            }
            debouncedSaveVNSettings(socket);
        });
    }
}
