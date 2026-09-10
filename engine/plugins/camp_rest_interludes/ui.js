(() => {
    const uiId = __UI_ID_JSON__;
    const mode = __MODE_JSON__;
    const payload = __PAYLOAD_JSON__;
    const root = document.querySelector(`.camp-rest-test-shell[data-camp-rest-ui-id="${uiId}"]`);

    if (!root) return;

    const bridgeLifecycle = bridge?.lifecycle || null;
    const bridgeSocket = bridge?.socket || null;
    const bridgePlayerUi = bridge?.player?.ui || null;
    const bridgeAssets = bridge?.assets || null;
    const bridgeLog = bridge?.log || null;

    const logWarn = (...args) => {
        if (bridgeLog?.warn) bridgeLog.warn(...args);
        else console.warn('[camp_rest_interludes]', ...args);
    };
    const logFlow = (event, data = null) => {
        const message = `[CampFlow] ${event}`;
        if (bridgeLog?.info) {
            bridgeLog.info(message, data || '');
            return;
        }
        if (data === null || data === undefined || data === '') {
            console.info(message);
        } else {
            console.info(message, data);
        }
    };

    const scheduleTimeout = (fn, ms) => {
        if (bridgeLifecycle?.setTimeout) return bridgeLifecycle.setTimeout(fn, ms);
        return setTimeout(fn, ms);
    };
    const clearScheduledTimeout = (id) => {
        if (id === null || id === undefined) return;
        if (bridgeLifecycle?.clearTimeout) {
            bridgeLifecycle.clearTimeout(id);
            return;
        }
        clearTimeout(id);
    };

    const onWindowEvent = (eventName, handler, options) => {
        if (bridgeLifecycle?.onWindow) return bridgeLifecycle.onWindow(eventName, handler, options);
        window.addEventListener(eventName, handler, options);
        return () => {
            try { window.removeEventListener(eventName, handler, options); } catch (_) { }
        };
    };

    const socketRequest = async (eventName, data, timeout = 10000) => {
        if (bridgeSocket?.request) {
            return await bridgeSocket.request(eventName, data, timeout);
        }
        if (socket?.emitReceive) {
            return await socket.emitReceive(eventName, data, timeout);
        }
        return { success: false, error: 'socket_request_unavailable' };
    };

    const socketEmit = (eventName, data) => {
        if (bridgeSocket?.emit) {
            bridgeSocket.emit(eventName, data);
            return;
        }
        socket?.emit?.(eventName, data);
    };

    const resolveAssetUrl = (path, options = {}) => {
        if (typeof path !== 'string' || !path.trim()) return path;
        if (bridgeAssets?.url) {
            try {
                return bridgeAssets.url(path, options);
            } catch (_) { }
        }
        return path;
    };

    // Safety cleanup for legacy leaked shells (from older re-parenting behavior).
    // Keep only shells that are still correctly attached to an intercept host.
    const staleShells = Array.from(document.querySelectorAll('.camp-rest-test-shell'))
        .filter((node) => {
            if (node === root) return false;
            return !node.closest('.plugin-intercept-nonblocking-host, .plugin-intercept-blocking-host');
        });
    staleShells.forEach((node) => {
        try { node.remove(); } catch (_) { }
    });

    function applyViewerResult(response) {
        logFlow('apply-viewer-result:start', {
            success: response?.success === true,
            hasResult: !!response?.result,
            turnNumber: response?.result?.turnNumber ?? null,
            sceneMode: response?.result?.sceneMode || null,
            interludeId: response?.result?.interlude?.id ?? null
        });
        if (!response || response.success !== true || !response.result) {
            throw new Error((response && response.error) || 'Unknown interlude error.');
        }
        if (window.vnEngine && typeof window.vnEngine.applyVNResult === 'function') {
            return window.vnEngine.applyVNResult(response.result).then((result) => {
                logFlow('apply-viewer-result:complete', {
                    turnNumber: response?.result?.turnNumber ?? null,
                    sceneMode: response?.result?.sceneMode || null,
                    interludeId: response?.result?.interlude?.id ?? null
                });
                return result;
            });
        }
        logFlow('apply-viewer-result:complete-no-engine');
        return Promise.resolve();
    }

    if (mode === 'overlay') {
        bridgeLog?.info?.('Camp rest overlay mounted', { uiId, mode });
        logFlow('overlay-mounted', { uiId, mode });
        const cleanupCallbacks = [];
        const overlayHost = root.closest('.plugin-intercept-nonblocking-host, .plugin-intercept-blocking-host') || root;
        if (overlayHost && overlayHost !== root) {
            // Keep camp UI constrained to the VN canvas/game container.
            overlayHost.style.position = 'absolute';
            overlayHost.style.inset = '0';
            overlayHost.style.width = '100%';
            overlayHost.style.height = '100%';
            // Keep camp overlay above scene visuals, but below core VN chrome (controls/notifications/music/HUD).
            overlayHost.style.zIndex = '7';
            overlayHost.style.pointerEvents = 'none';
        }
        const hudPresentationLease = (() => {
            try {
                return window.FablekinVNHud?.requestTemporaryPresentation?.({
                    owner: 'camp_rest_interludes',
                    reason: 'camp_rest_overlay',
                    mode: 'hide',
                    opacity: 0.25,
                    excludePanelIds: ['world_location_tracker', 'world_clock', 'world_environment', 'world_conditions'],
                    excludePluginIds: ['world_location_tracker']
                }) || null;
            } catch (_) {
                return null;
            }
        })();

        const options = Array.isArray(payload?.options) ? payload.options : [];
        const invitationScenes = Array.isArray(payload?.invitationScenes) ? payload.invitationScenes : [];
        const allCharacters = Array.isArray(payload?.allCharacters) ? payload.allCharacters : [];
        const invitedCharacters = Array.isArray(payload?.invitedCharacters) ? payload.invitedCharacters : [];
        const invitedCharacterKeys = new Set(invitedCharacters.map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
        const normalizedCampScene = (payload?.campScene && typeof payload.campScene === 'object')
            ? {
                ...payload.campScene,
                backgroundUrl: resolveAssetUrl(payload.campScene.backgroundUrl, { scope: 'project' })
            }
            : null;
        const normalizedCampSpriteProfiles = (() => {
            const source = (payload?.campSpriteProfiles && typeof payload.campSpriteProfiles === 'object')
                ? payload.campSpriteProfiles
                : {};
            const out = {};
            for (const [characterKey, profile] of Object.entries(source)) {
                if (!profile || typeof profile !== 'object') {
                    out[characterKey] = profile;
                    continue;
                }
                const next = { ...profile };
                if (typeof profile.fallbackSprite === 'string') {
                    next.fallbackSprite = resolveAssetUrl(profile.fallbackSprite, { scope: 'project' });
                }
                if (profile.byEmotion && typeof profile.byEmotion === 'object') {
                    const byEmotion = {};
                    for (const [emotionKey, emotionMap] of Object.entries(profile.byEmotion)) {
                        if (!emotionMap || typeof emotionMap !== 'object') {
                            byEmotion[emotionKey] = emotionMap;
                            continue;
                        }
                        const normalizedEmotionMap = {};
                        for (const [variantKey, spritePath] of Object.entries(emotionMap)) {
                            normalizedEmotionMap[variantKey] = (typeof spritePath === 'string')
                                ? resolveAssetUrl(spritePath, { scope: 'project' })
                                : spritePath;
                        }
                        byEmotion[emotionKey] = normalizedEmotionMap;
                    }
                    next.byEmotion = byEmotion;
                }
                out[characterKey] = next;
            }
            return out;
        })();
        const parentTurnNumber = Number.parseInt(payload?.parentTurnNumber, 10);
        const bindEventName = payload?.bindEventName || 'camp-rest-interludes:bind-option-interlude';
        const saveInvitationEventName = payload?.saveInvitationEventName || 'camp-rest-interludes:save-invitation';
        const saveLayoutEventName = payload?.saveLayoutEventName || 'camp-rest-interludes:save-overlay-layout';
        const panelLayoutSeed = (payload?.panelLayout && typeof payload.panelLayout === 'object') ? payload.panelLayout : null;
        const defaultRunProfileId = payload?.defaultRunProfileId || 'interlude_sandbox';
        const runDirector = payload?.runDirector !== false;
        const autoContinue = payload?.autoContinue === true || (options.length === 0 && invitationScenes.length === 0);
        const fallbackMessage = (typeof payload?.fallbackMessage === 'string' && payload.fallbackMessage.trim().length > 0)
            ? payload.fallbackMessage
            : 'No interlude options or invitation scenes available. Continuing chapter.';
        const fallbackReason = (typeof payload?.fallbackReason === 'string' && payload.fallbackReason.trim().length > 0)
            ? payload.fallbackReason
            : 'no_interlude_options';
        const statusEl = root.querySelector('.camp-rest-test-status');
        const sceneButtons = Array.from(root.querySelectorAll('.camp-rest-scene-wheel-item'));
        let busyUiLock = null;
        let isBusy = false;
        const processingOverlay = document.createElement('div');
        processingOverlay.className = 'camp-rest-processing-overlay';
        processingOverlay.innerHTML = `
            <div class="camp-rest-processing-card">
                <div class="camp-rest-processing-title">Preparing Interlude</div>
                <p class="camp-rest-processing-message">
                    Working on your side scene<span class="camp-rest-processing-dots"></span>
                </p>
            </div>
        `;
        root.appendChild(processingOverlay);

        const setProcessing = (active, message = 'Working on your side scene') => {
            const msgEl = processingOverlay.querySelector('.camp-rest-processing-message');
            if (msgEl) {
                msgEl.textContent = message;
                const dots = document.createElement('span');
                dots.className = 'camp-rest-processing-dots';
                msgEl.appendChild(dots);
            }
            processingOverlay.classList.toggle('visible', !!active);
            document.body.classList.toggle('camp-rest-interlude-busy', !!active);
            if (active) {
                if (busyUiLock?.release) busyUiLock.release();
                busyUiLock = bridgePlayerUi?.lock?.({ busy: message || 'Working on your side scene' }) || null;
            } else if (busyUiLock?.release) {
                busyUiLock.release();
                busyUiLock = null;
            }
        };
        const setInviteModalActive = (active) => {
            document.body.classList.toggle('camp-rest-invite-modal-open', !!active);
        };

        const setBusy = (busy) => {
            isBusy = !!busy;
            sceneButtons.forEach(btn => { btn.disabled = isBusy; });
            root.querySelectorAll('.camp-rest-invite-avatar').forEach(btn => {
                btn.disabled = isBusy || btn.getAttribute('data-invited') === 'true';
            });
            const triggerBtn = root.querySelector('#camp-rest-invite-trigger-btn');
            if (triggerBtn) triggerBtn.disabled = isBusy || root.querySelectorAll('#camp-rest-selected-characters .camp-rest-invite-avatar').length === 0;
            const sendBtn = root.querySelector('#camp-rest-send-invitation-btn');
            if (sendBtn) sendBtn.disabled = isBusy;
        };

        const setStatus = (text, isError = false) => {
            if (!statusEl) return;
            statusEl.textContent = text || '';
            statusEl.classList.toggle('error', !!isError);
        };

        const setOverlayVisible = (visible) => {
            root.classList.toggle('camp-rest-overlay-hidden', !visible);
        };
        const syncWithViewerUi = (show) => {
            setOverlayVisible(show !== false);
        };
        const immersiveToggleHandler = (e) => {
            syncWithViewerUi(e?.detail?.show !== false);
        };
        const isViewerUiVisible = () => {
            const toggleBtn = document.getElementById('toggle-controls-btn');
            return !toggleBtn || !toggleBtn.classList.contains('collapsed');
        };
        const disposeImmersiveListener = onWindowEvent('vn:ui-visibility-toggled', immersiveToggleHandler);
        syncWithViewerUi(isViewerUiVisible());

        const setupFloatingPanels = () => {
            const panelHost = root.querySelector('.camp-rest-test-card');
            const leftPanel = root.querySelector('.camp-rest-left-panel');
            const rightPanel = root.querySelector('.camp-rest-right-panel');
            if (!panelHost || !leftPanel || !rightPanel) return () => { };

            const panelEntries = [
                { key: 'left', panel: leftPanel },
                { key: 'right', panel: rightPanel }
            ];

            // Capture the authored (pre-floating) panel layout first so default spawn stays faithful:
            // left panel pinned left, invitation panel on the right side.
            const authoredDefaultRects = new Map();
            const hostRectForDefaults = panelHost.getBoundingClientRect();
            panelEntries.forEach(({ key, panel }) => {
                const measured = panel.getBoundingClientRect();
                authoredDefaultRects.set(key, {
                    x: measured.left - hostRectForDefaults.left,
                    y: measured.top - hostRectForDefaults.top,
                    width: measured.width,
                    height: measured.height
                });
            });

            const panelRects = new Map();
            const panelRelativeRects = new Map();
            let activeGesture = null;
            let persistTimer = null;
            let initRafId = null;

            const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
            const toNumber = (value, fallback) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : fallback;
            };
            const parseSeedRect = (value) => {
                if (!value || typeof value !== 'object') return null;
                const unit = String(value.unit || value.mode || value.space || '').trim().toLowerCase();
                const xRatio = toNumber(value.xRatio, null);
                const yRatio = toNumber(value.yRatio, null);
                const widthRatio = toNumber(value.widthRatio, null);
                const heightRatio = toNumber(value.heightRatio, null);
                const hasRelativeValues =
                    Number.isFinite(xRatio)
                    && Number.isFinite(yRatio)
                    && Number.isFinite(widthRatio)
                    && Number.isFinite(heightRatio);
                if (unit === 'relative' || hasRelativeValues) {
                    if (!hasRelativeValues) return null;
                    return {
                        unit: 'relative',
                        xRatio: clamp(xRatio, 0, 1),
                        yRatio: clamp(yRatio, 0, 1),
                        widthRatio: clamp(widthRatio, 0, 1),
                        heightRatio: clamp(heightRatio, 0, 1)
                    };
                }
                const x = toNumber(value.x, null);
                const y = toNumber(value.y, null);
                const width = toNumber(value.width, null);
                const height = toNumber(value.height, null);
                if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
                    return null;
                }
                return {
                    unit: 'absolute',
                    x,
                    y,
                    width,
                    height
                };
            };

            const getHostBounds = () => {
                const width = Math.max(320, panelHost.clientWidth || 0);
                const height = Math.max(220, panelHost.clientHeight || 0);
                return { width, height };
            };

            const getPanelMinSize = (panelKey) => {
                if (panelKey === 'left') {
                    return { width: 310, height: 430 };
                }
                return { width: 380, height: 260 };
            };

            const rectToRelative = (panelKey, rectLike) => {
                const { width: hostWidth, height: hostHeight } = getHostBounds();
                const minSize = getPanelMinSize(panelKey);
                const safeWidth = Math.max(minSize.width, hostWidth);
                const safeHeight = Math.max(minSize.height, hostHeight);

                return {
                    unit: 'relative',
                    xRatio: clamp((toNumber(rectLike.x, 0) / safeWidth), 0, 1),
                    yRatio: clamp((toNumber(rectLike.y, 0) / safeHeight), 0, 1),
                    widthRatio: clamp((toNumber(rectLike.width, minSize.width) / safeWidth), 0, 1),
                    heightRatio: clamp((toNumber(rectLike.height, minSize.height) / safeHeight), 0, 1)
                };
            };

            const relativeToRect = (panelKey, relativeLike) => {
                const { width: hostWidth, height: hostHeight } = getHostBounds();
                const minSize = getPanelMinSize(panelKey);
                return {
                    x: toNumber(relativeLike.xRatio, 0) * hostWidth,
                    y: toNumber(relativeLike.yRatio, 0) * hostHeight,
                    width: Math.max(minSize.width, toNumber(relativeLike.widthRatio, 0) * hostWidth),
                    height: Math.max(minSize.height, toNumber(relativeLike.heightRatio, 0) * hostHeight)
                };
            };

            const normalizeRect = (panelKey, rectLike) => {
                const { width: hostWidth, height: hostHeight } = getHostBounds();
                const minSize = getPanelMinSize(panelKey);
                const maxWidth = Math.max(minSize.width, hostWidth - 8);
                const maxHeight = Math.max(minSize.height, hostHeight - 8);

                const width = clamp(toNumber(rectLike.width, minSize.width), minSize.width, maxWidth);
                const height = clamp(toNumber(rectLike.height, minSize.height), minSize.height, maxHeight);
                const maxX = Math.max(0, hostWidth - width);
                const maxY = Math.max(0, hostHeight - height);
                const x = clamp(toNumber(rectLike.x, 0), 0, maxX);
                const y = clamp(toNumber(rectLike.y, 0), 0, maxY);

                return {
                    x: Math.round(x),
                    y: Math.round(y),
                    width: Math.round(width),
                    height: Math.round(height)
                };
            };

            const applyRect = (panelKey, panel, rectLike, options = {}) => {
                const { updateRelative = true } = options;
                const rect = normalizeRect(panelKey, rectLike || {});
                panelRects.set(panelKey, rect);
                if (updateRelative) {
                    panelRelativeRects.set(panelKey, rectToRelative(panelKey, rect));
                }
                panel.style.left = `${rect.x}px`;
                panel.style.top = `${rect.y}px`;
                panel.style.width = `${rect.width}px`;
                panel.style.height = `${rect.height}px`;
            };

            const queuePersist = () => {
                if (persistTimer) {
                    clearScheduledTimeout(persistTimer);
                }
                persistTimer = scheduleTimeout(() => {
                    persistTimer = null;
                    const left = panelRelativeRects.get('left') || null;
                    const right = panelRelativeRects.get('right') || null;
                    if (!left && !right) return;
                    try {
                        socketEmit(saveLayoutEventName, {
                            layout: {
                                version: 2,
                                left,
                                right
                            }
                        });
                    } catch (_) { }
                }, 120);
            };

            const onPointerMove = (event) => {
                if (!activeGesture) return;
                const dx = event.clientX - activeGesture.startX;
                const dy = event.clientY - activeGesture.startY;

                if (activeGesture.type === 'drag') {
                    applyRect(activeGesture.key, activeGesture.panel, {
                        x: activeGesture.initial.x + dx,
                        y: activeGesture.initial.y + dy,
                        width: activeGesture.initial.width,
                        height: activeGesture.initial.height
                    });
                    return;
                }

                if (activeGesture.type === 'resize') {
                    applyRect(activeGesture.key, activeGesture.panel, {
                        x: activeGesture.initial.x,
                        y: activeGesture.initial.y,
                        width: activeGesture.initial.width + dx,
                        height: activeGesture.initial.height + dy
                    });
                }
            };

            const endGesture = () => {
                if (!activeGesture) return;
                if (activeGesture.panel) {
                    activeGesture.panel.classList.remove('camp-rest-panel-dragging');
                    activeGesture.panel.classList.remove('camp-rest-panel-resizing');
                }
                activeGesture = null;
                document.body.classList.remove('camp-rest-panel-interacting');
                queuePersist();
            };

            const onPointerUp = () => endGesture();
            const onPointerCancel = () => endGesture();

            const onWindowResize = () => {
                panelEntries.forEach(({ key, panel }) => {
                    const relativeRect = panelRelativeRects.get(key);
                    const absoluteRect = panelRects.get(key);
                    if (relativeRect && relativeRect.unit === 'relative') {
                        applyRect(key, panel, relativeToRect(key, relativeRect), { updateRelative: false });
                        return;
                    }
                    if (absoluteRect) {
                        applyRect(key, panel, absoluteRect);
                    }
                });
            };

            panelEntries.forEach(({ key, panel }) => {
                panel.classList.add('camp-rest-panel-floating');
                panel.style.position = 'absolute';
                panel.style.margin = '0';
                panel.style.maxWidth = 'none';
                panel.style.maxHeight = 'none';

                const header = panel.querySelector('.camp-rest-section-header');
                if (header) {
                    header.classList.add('camp-rest-panel-drag-handle');
                    header.addEventListener('pointerdown', (event) => {
                        if (event.button !== 0) return;
                        const initialRect = panelRects.get(key);
                        if (!initialRect) return;
                        activeGesture = {
                            type: 'drag',
                            key,
                            panel,
                            startX: event.clientX,
                            startY: event.clientY,
                            initial: { ...initialRect }
                        };
                        panel.classList.add('camp-rest-panel-dragging');
                        document.body.classList.add('camp-rest-panel-interacting');
                        event.preventDefault();
                    });
                }

                const resizeHandle = document.createElement('button');
                resizeHandle.type = 'button';
                resizeHandle.className = 'camp-rest-panel-resize-handle';
                resizeHandle.setAttribute('aria-label', `Resize ${key} panel`);
                resizeHandle.addEventListener('pointerdown', (event) => {
                    if (event.button !== 0) return;
                    const initialRect = panelRects.get(key);
                    if (!initialRect) return;
                    activeGesture = {
                        type: 'resize',
                        key,
                        panel,
                        startX: event.clientX,
                        startY: event.clientY,
                        initial: { ...initialRect }
                    };
                    panel.classList.add('camp-rest-panel-resizing');
                    document.body.classList.add('camp-rest-panel-interacting');
                    event.preventDefault();
                });
                panel.appendChild(resizeHandle);
            });

            const initializePanels = () => {
                panelEntries.forEach(({ key, panel }) => {
                    const defaultRect = authoredDefaultRects.get(key) || {
                        x: 0,
                        y: 0,
                        width: panel.clientWidth || 320,
                        height: panel.clientHeight || 220
                    };
                    const seeded = parseSeedRect(panelLayoutSeed?.[key]);
                    if (seeded && seeded.unit === 'relative') {
                        panelRelativeRects.set(key, {
                            unit: 'relative',
                            xRatio: seeded.xRatio,
                            yRatio: seeded.yRatio,
                            widthRatio: seeded.widthRatio,
                            heightRatio: seeded.heightRatio
                        });
                        applyRect(key, panel, relativeToRect(key, seeded), { updateRelative: false });
                        return;
                    }
                    if (seeded && seeded.unit === 'absolute') {
                        applyRect(key, panel, seeded);
                        return;
                    }
                    applyRect(key, panel, defaultRect);
                });
            };

            initRafId = requestAnimationFrame(() => {
                initializePanels();
            });

            const offPointerMove = onWindowEvent('pointermove', onPointerMove);
            const offPointerUp = onWindowEvent('pointerup', onPointerUp);
            const offPointerCancel = onWindowEvent('pointercancel', onPointerCancel);
            const offResize = onWindowEvent('resize', onWindowResize);

            return () => {
                if (persistTimer) {
                    clearScheduledTimeout(persistTimer);
                    persistTimer = null;
                }
                if (initRafId) {
                    cancelAnimationFrame(initRafId);
                    initRafId = null;
                }
                try { offPointerMove?.(); } catch (_) { }
                try { offPointerUp?.(); } catch (_) { }
                try { offPointerCancel?.(); } catch (_) { }
                try { offResize?.(); } catch (_) { }
                document.body.classList.remove('camp-rest-panel-interacting');
            };
        };

        const panelRuntimeCleanup = setupFloatingPanels();

        const sceneRuntimeFactory = window.CampRestSceneRuntime;
        const sceneRuntime = (typeof sceneRuntimeFactory === 'function')
            ? sceneRuntimeFactory({
                bridge,
                allCharacters,
                campScene: normalizedCampScene,
                campSpriteProfiles: normalizedCampSpriteProfiles
            })
            : null;

        let overlayDisposed = false;
        let detachObserver = null;
        let disposeBeforeUnloadListener = null;
        let sceneWheelCleanup = null;
        const beforeUnloadHandler = () => disposeOverlayRuntime();

        const disposeOverlayRuntime = (options = {}) => {
            if (overlayDisposed) return;
            overlayDisposed = true;
            const restoreBackground = options?.restoreBackground !== false;
            const clearVolatile = options?.clearVolatile !== false;
            logFlow('overlay-dispose:start', {
                restoreBackground,
                clearVolatile
            });

            if (detachObserver) {
                try { detachObserver.disconnect(); } catch (_) { }
                detachObserver = null;
            }
            try { disposeBeforeUnloadListener?.(); } catch (_) { }
            disposeBeforeUnloadListener = null;
            try { disposeImmersiveListener?.(); } catch (_) { }
            try {
                if (typeof panelRuntimeCleanup === 'function') {
                    panelRuntimeCleanup();
                }
            } catch (_) { }
            try { sceneWheelCleanup?.(); } catch (_) { }
            sceneWheelCleanup = null;
            cleanupCallbacks.forEach((fn) => {
                try { fn?.(); } catch (_) { }
            });
            cleanupCallbacks.length = 0;
            try { hudPresentationLease?.release?.(); } catch (_) { }

            if (sceneRuntime && typeof sceneRuntime.stop === 'function') {
                try { sceneRuntime.stop({ restoreBackground }); } catch (_) { }
            }
            if (bridge?.actors && typeof bridge.actors.hideNativeSprites === 'function') {
                try { bridge.actors.hideNativeSprites(false); } catch (_) { }
            }
            if (bridge?.actors && typeof bridge.actors.end === 'function') {
                try { bridge.actors.end('camp-runtime-dispose'); } catch (_) { }
            } else if (bridge?.actors && typeof bridge.actors.clear === 'function') {
                try { bridge.actors.clear('camp-runtime-dispose'); } catch (_) { }
            }
            if (bridge?.background && typeof bridge.background.end === 'function') {
                try { bridge.background.end('camp-runtime-dispose', { restore: restoreBackground, instant: false }); } catch (_) { }
            } else if (bridge?.background && typeof bridge.background.restore === 'function') {
                if (restoreBackground) {
                    try { bridge.background.restore({ instant: false }); } catch (_) { }
                }
            }
            if (clearVolatile) {
                try { window.dispatchEvent(new CustomEvent('system:clear-all-volatile-events')); } catch (_) { }
            }
            if (busyUiLock?.release) {
                try { busyUiLock.release(); } catch (_) { }
                busyUiLock = null;
            }
            document.body.classList.remove('camp-rest-interlude-busy');
            document.body.classList.remove('camp-rest-invite-modal-open');
            logFlow('overlay-dispose:complete');
        };

        const installDetachGuard = () => {
            disposeBeforeUnloadListener = onWindowEvent('beforeunload', beforeUnloadHandler);
            if (typeof MutationObserver !== 'function') return;
            detachObserver = new MutationObserver(() => {
                if (!document.body.contains(root) || (overlayHost && overlayHost.isConnected === false)) {
                    disposeOverlayRuntime();
                }
            });
            try {
                detachObserver.observe(document.body, { childList: true, subtree: true });
            } catch (_) { }
            if (bridgeLifecycle?.onDispose) {
                bridgeLifecycle.onDispose(() => {
                    try { disposeBeforeUnloadListener?.(); } catch (_) { }
                    disposeBeforeUnloadListener = null;
                    try { detachObserver?.disconnect?.(); } catch (_) { }
                });
            }
        };

        installDetachGuard();
        if (bridgeLifecycle?.onDispose) {
            bridgeLifecycle.onDispose(() => {
                disposeOverlayRuntime();
            });
        }

        const removeOverlayHost = (options = {}) => {
            logFlow('overlay-host:remove', options || {});
            disposeOverlayRuntime(options);
            if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
        };

        const removeOverlayHostForViewerHandoff = () => {
            logFlow('overlay-handoff:remove-host');
            removeOverlayHost({
                restoreBackground: false,
                clearVolatile: false
            });
        };

        const findOption = (optionKey) => options.find(opt => opt && opt.optionKey === optionKey);

        const setupSceneWheel = () => {
            if (sceneButtons.length === 0) return () => { };
            const wheel = root.querySelector('.camp-rest-scene-wheel');
            let activeIndex = 0;
            let wheelPendingDirection = 0;
            let wheelRafId = null;
            let lastWheelAdvanceAt = 0;
            const WHEEL_ADVANCE_COOLDOWN_MS = 90;

            const normalizeIndex = (index) => {
                if (sceneButtons.length <= 0) return 0;
                const count = sceneButtons.length;
                return ((index % count) + count) % count;
            };

            const circularOffset = (index) => {
                const count = sceneButtons.length;
                let offset = index - activeIndex;
                if (count > 2) {
                    const half = count / 2;
                    if (offset > half) offset -= count;
                    if (offset < -half) offset += count;
                }
                return offset;
            };

            const setWheelIndex = (index) => {
                activeIndex = normalizeIndex(index);
                sceneButtons.forEach((btn, index) => {
                    const offset = circularOffset(index);
                    const abs = Math.abs(offset);
                    const scale = abs === 0 ? 1 : (abs === 1 ? 0.68 : 0.48);
                    const opacity = abs === 0 ? 1 : (abs === 1 ? 0.9 : (abs === 2 ? 0.6 : 0));
                    const y = offset * 122;
                    const rimX = 28;
                    const arcRecede = Math.pow(Math.min(abs, 4), 1.55) * 54;
                    const x = rimX - arcRecede;
                    btn.classList.toggle('active', offset === 0);
                    btn.classList.toggle('near', abs === 1);
                    btn.classList.toggle('far', abs > 1);
                    btn.style.transform = `translate(-50%, calc(-50% + ${y}px)) translateX(${x}px) scale(${scale})`;
                    btn.style.opacity = String(opacity);
                    btn.style.zIndex = String(100 - abs);
                    btn.style.filter = '';
                    btn.style.pointerEvents = abs > 2 ? 'none' : 'auto';
                    btn.setAttribute('aria-current', offset === 0 ? 'true' : 'false');
                });
            };

            const scheduleWheelAdvance = () => {
                if (wheelRafId) return;
                wheelRafId = requestAnimationFrame(() => {
                    wheelRafId = null;
                    if (wheelPendingDirection === 0) return;
                    const now = performance.now();
                    if ((now - lastWheelAdvanceAt) < WHEEL_ADVANCE_COOLDOWN_MS) {
                        scheduleWheelAdvance();
                        return;
                    }
                    const direction = wheelPendingDirection > 0 ? 1 : -1;
                    wheelPendingDirection = 0;
                    lastWheelAdvanceAt = now;
                    setWheelIndex(activeIndex + direction);
                    if (wheelPendingDirection !== 0) {
                        scheduleWheelAdvance();
                    }
                });
            };

            const activateCurrentScene = () => {
                const btn = sceneButtons[activeIndex];
                if (!btn || isBusy) return;
                const kind = btn.getAttribute('data-scene-kind');
                if (kind === 'invitation') {
                    onInvitationReplayClick(btn.getAttribute('data-interlude-id'));
                    return;
                }
                onOptionClick(btn.getAttribute('data-option-key'));
            };

            const onWheelClick = (event) => {
                const target = event.target instanceof Element ? event.target : event.target?.parentElement;
                const btn = target?.closest('.camp-rest-scene-wheel-item');
                if (!btn || !root.contains(btn) || isBusy) return;
                const index = Number.parseInt(btn.getAttribute('data-wheel-index'), 10);
                if (!Number.isInteger(index)) return;
                if (index !== activeIndex) {
                    setWheelIndex(index);
                    return;
                }
                activateCurrentScene();
            };

            const onArrowClick = (event) => {
                const shift = Number.parseInt(event.currentTarget.getAttribute('data-wheel-shift'), 10);
                if (!Number.isInteger(shift) || isBusy) return;
                setWheelIndex(activeIndex + shift);
            };

            const onWheelScroll = (event) => {
                if (Math.abs(event.deltaY) < 2) return;
                event.preventDefault();
                event.stopPropagation();
                if (isBusy) return;
                wheelPendingDirection += event.deltaY > 0 ? 1 : -1;
                scheduleWheelAdvance();
            };

            const onKeyDown = (event) => {
                if (isBusy) return;
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setWheelIndex(activeIndex + 1);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setWheelIndex(activeIndex - 1);
                } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateCurrentScene();
                }
            };

            sceneButtons.forEach(btn => btn.addEventListener('click', onWheelClick));
            root.querySelectorAll('.camp-rest-wheel-arrow').forEach(btn => btn.addEventListener('click', onArrowClick));
            if (wheel) {
                wheel.addEventListener('wheel', onWheelScroll, { passive: false });
                wheel.addEventListener('keydown', onKeyDown);
                wheel.setAttribute('tabindex', '0');
            }
            setWheelIndex(0);

            return () => {
                sceneButtons.forEach(btn => btn.removeEventListener('click', onWheelClick));
                root.querySelectorAll('.camp-rest-wheel-arrow').forEach(btn => btn.removeEventListener('click', onArrowClick));
                if (wheel) {
                    wheel.removeEventListener('wheel', onWheelScroll);
                    wheel.removeEventListener('keydown', onKeyDown);
                }
                if (wheelRafId) {
                    cancelAnimationFrame(wheelRafId);
                    wheelRafId = null;
                }
            };
        };

        const onOptionClick = async (optionKey) => {
            const option = findOption(optionKey);
            if (!option) return;
            logFlow('option-click:start', {
                optionKey,
                hasBoundInterlude: Number.isInteger(option.interludeId) && option.interludeId > 0,
                interludeId: option.interludeId ?? null
            });
            setBusy(true);
            setStatus('');
            setOverlayVisible(true);
            setProcessing(true, 'Loading selected side scene');

            try {
                let response = null;
                const hasBoundInterlude = Number.isInteger(option.interludeId) && option.interludeId > 0;
                if (hasBoundInterlude) {
                    logFlow('option-click:play-existing:start', {
                        optionKey,
                        interludeId: option.interludeId
                    });
                    response = await socketRequest('play-interlude-turn', {
                        interludeId: option.interludeId
                    }, 180000);
                    logFlow('option-click:play-existing:response', {
                        optionKey,
                        interludeId: option.interludeId,
                        success: response?.success === true,
                        error: response?.error || null
                    });

                    if (!response || response.success !== true || !response.result) {
                        const message = (response && response.error) || '';
                        const deletedOrMissing = /not found|missing|does not exist/i.test(String(message));
                        if (!deletedOrMissing) {
                            throw new Error(message || 'Failed to replay interlude.');
                        }
                        option.interludeId = null;
                        response = null;
                    }
                }

                if (!response) {
                    logFlow('option-click:generate:start', {
                        optionKey: option.optionKey,
                        parentTurnNumber,
                        runProfileId: option.runProfileId || defaultRunProfileId
                    });
                    response = await socketRequest('generate-interlude-turn', {
                        parentTurnNumber,
                        prompt: option.prompt,
                        runDirector,
                        interludeMeta: {
                            pluginId: 'camp_rest_interludes',
                            optionKey: option.optionKey,
                            participants: Array.isArray(option.participants) ? option.participants : []
                        },
                        label: option.label,
                        isStoryRelevant: false,
                        runProfileId: option.runProfileId || defaultRunProfileId
                    }, 600000);
                    logFlow('option-click:generate:response', {
                        optionKey: option.optionKey,
                        success: response?.success === true,
                        error: response?.error || null,
                        generatedInterludeId: response?.result?.interlude?.id ?? null
                    });

                    const generatedId = response && response.result && response.result.interlude
                        ? response.result.interlude.id
                        : null;

                    if (Number.isInteger(generatedId) && generatedId > 0) {
                        option.interludeId = generatedId;
                        socketEmit(bindEventName, {
                            parentTurnNumber,
                            optionKey: option.optionKey,
                            interludeId: generatedId,
                            runProfileId: option.runProfileId || defaultRunProfileId
                        });
                    }
                }

                logFlow('option-click:handoff', {
                    optionKey,
                    responseSuccess: response?.success === true,
                    responseInterludeId: response?.result?.interlude?.id ?? null
                });
                await applyViewerResult(response);
                removeOverlayHostForViewerHandoff();
                logFlow('option-click:complete', { optionKey });
            } catch (error) {
                logFlow('option-click:error', {
                    optionKey,
                    message: error?.message || String(error)
                });
                setProcessing(false);
                setOverlayVisible(true);
                setStatus(error.message || 'Failed to open interlude.', true);
                setBusy(false);
            }
        };

        const onInvitationReplayClick = async (interludeId) => {
            const resolvedInterludeId = Number.parseInt(interludeId, 10);
            if (!Number.isInteger(resolvedInterludeId) || resolvedInterludeId < 1) return;
            logFlow('invitation-replay:start', {
                interludeId: resolvedInterludeId
            });

            setBusy(true);
            setStatus('');
            setOverlayVisible(true);
            setProcessing(true, 'Loading invitation scene');

            try {
                const response = await socketRequest('play-interlude-turn', {
                    interludeId: resolvedInterludeId
                }, 180000);
                logFlow('invitation-replay:response', {
                    interludeId: resolvedInterludeId,
                    success: response?.success === true,
                    error: response?.error || null
                });

                if (!response || response.success !== true || !response.result) {
                    throw new Error((response && response.error) || 'Failed to replay invitation scene.');
                }

                await applyViewerResult(response);
                removeOverlayHostForViewerHandoff();
                logFlow('invitation-replay:complete', {
                    interludeId: resolvedInterludeId
                });
            } catch (error) {
                logFlow('invitation-replay:error', {
                    interludeId: resolvedInterludeId,
                    message: error?.message || String(error)
                });
                setProcessing(false);
                setOverlayVisible(true);
                setStatus(error.message || 'Failed to replay invitation scene.', true);
                setBusy(false);
            }
        };

        sceneWheelCleanup = setupSceneWheel();

        /* --- Custom Character Invitations Workflow --- */
        const triggerBtn = root.querySelector('#camp-rest-invite-trigger-btn');
        const customModal = root.querySelector('#camp-rest-custom-invite-modal');
        const closeModalBtn = root.querySelector('#camp-rest-modal-close-btn');
        const sendInvitationBtn = root.querySelector('#camp-rest-send-invitation-btn');
        const invitedNamesList = root.querySelector('#invited-names-list');
        const invitedPromptInput = root.querySelector('#invited-prompt-input');
        const availableBucket = root.querySelector('#camp-rest-available-characters');
        const selectedBucket = root.querySelector('#camp-rest-selected-characters');

        let selectedCharacters = [];
        const selectedEmptyState = selectedBucket?.querySelector('.camp-rest-selected-empty') || null;
        const railDisposers = [];
        const railRefreshers = [];
        const refreshCharacterRails = () => {
            railRefreshers.forEach((refresh) => {
                if (typeof refresh !== 'function') return;
                try { refresh(); } catch (_) { }
            });
        };

        const setupCharacterRail = (bucket) => {
            if (!bucket || !(bucket instanceof HTMLElement) || bucket.parentElement?.classList.contains('camp-rest-avatar-rail')) {
                return null;
            }
            const rail = document.createElement('div');
            rail.className = 'camp-rest-avatar-rail';
            bucket.parentElement.insertBefore(rail, bucket);
            rail.appendChild(bucket);

            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'camp-rest-avatar-nav left';
            prevBtn.setAttribute('aria-label', 'Show previous characters');
            prevBtn.textContent = '';

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'camp-rest-avatar-nav right';
            nextBtn.setAttribute('aria-label', 'Show next characters');
            nextBtn.textContent = '';

            rail.appendChild(prevBtn);
            rail.appendChild(nextBtn);

            let startIndex = 0;
            const getAvatarItems = () => Array.from(bucket.querySelectorAll('.camp-rest-invite-avatar'));
            const getInnerBucketWidth = () => {
                const computed = window.getComputedStyle(bucket);
                const paddingLeft = Number.parseFloat(computed.paddingLeft || '0') || 0;
                const paddingRight = Number.parseFloat(computed.paddingRight || '0') || 0;
                return Math.max(1, (bucket.clientWidth || 0) - paddingLeft - paddingRight);
            };
            const getGap = () => {
                const computed = window.getComputedStyle(bucket);
                const gap = Number.parseFloat(computed.columnGap || computed.gap || '0') || 0;
                return Math.max(0, gap);
            };
            const getItemFootprint = (items) => {
                if (!Array.isArray(items) || items.length === 0) return 0;
                const source = items[0];
                const visual = source.querySelector('.camp-rest-circle-img-avatar, .camp-rest-circle-avatar');
                const visualWidth = Math.round(
                    visual?.getBoundingClientRect?.().width
                    || visual?.offsetWidth
                    || source.getBoundingClientRect().width
                    || source.offsetWidth
                    || 54
                );
                // Keep slight breathing room without underfilling the rail.
                return Math.max(56, visualWidth + 4);
            };
            const getFitCount = (availableWidth, itemFootprint, gap) => {
                if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
                if (!Number.isFinite(itemFootprint) || itemFootprint <= 0) return 1;
                const unitWidth = Math.max(1, itemFootprint + Math.max(0, gap));
                return Math.max(1, Math.floor((availableWidth + Math.max(0, gap)) / unitWidth));
            };

            const refreshNavState = () => {
                const items = getAvatarItems();
                if (items.length === 0) {
                    startIndex = 0;
                    prevBtn.style.display = 'none';
                    nextBtn.style.display = 'none';
                    prevBtn.disabled = true;
                    nextBtn.disabled = true;
                    return;
                }

                const gap = getGap();
                const fullWidth = getInnerBucketWidth();
                const itemFootprint = getItemFootprint(items);
                const visibleCount = Math.min(items.length, getFitCount(fullWidth, itemFootprint, gap));
                const shouldEnableCarousel = items.length > visibleCount;
                const maxStart = Math.max(0, items.length - visibleCount);
                startIndex = Math.max(0, Math.min(startIndex, maxStart));

                items.forEach((item, index) => {
                    const isVisible = index >= startIndex && index < (startIndex + visibleCount);
                    item.style.display = isVisible ? '' : 'none';
                });

                const needsNav = shouldEnableCarousel;
                prevBtn.style.display = needsNav ? 'inline-flex' : 'none';
                nextBtn.style.display = needsNav ? 'inline-flex' : 'none';
                if (!needsNav) {
                    prevBtn.disabled = true;
                    nextBtn.disabled = true;
                    return;
                }

                prevBtn.disabled = startIndex <= 0;
                nextBtn.disabled = startIndex >= maxStart;
            };

            const onPrev = () => {
                if (prevBtn.disabled) return;
                startIndex = Math.max(0, startIndex - 1);
                refreshNavState();
            };
            const onNext = () => {
                if (nextBtn.disabled) return;
                startIndex += 1;
                refreshNavState();
            };

            prevBtn.addEventListener('click', onPrev);
            nextBtn.addEventListener('click', onNext);
            const settleTimers = [];
            const scheduleRailRefresh = (delayMs) => {
                settleTimers.push(scheduleTimeout(refreshNavState, delayMs));
            };
            // Re-run during initial paint/asset settling so first render matches final layout.
            [0, 80, 220, 420].forEach(scheduleRailRefresh);

            const onAssetLoaded = () => refreshNavState();
            bucket.addEventListener('load', onAssetLoaded, true);
            bucket.addEventListener('error', onAssetLoaded, true);

            const offResize = onWindowEvent('resize', refreshNavState);
            const resizeObserver = (typeof ResizeObserver !== 'undefined')
                ? new ResizeObserver(() => refreshNavState())
                : null;
            if (resizeObserver) {
                try { resizeObserver.observe(bucket); } catch (_) { }
                try { resizeObserver.observe(rail); } catch (_) { }
            }

            return {
                refresh: refreshNavState,
                dispose: () => {
                    settleTimers.forEach((id) => clearScheduledTimeout(id));
                    try { bucket.removeEventListener('load', onAssetLoaded, true); } catch (_) { }
                    try { bucket.removeEventListener('error', onAssetLoaded, true); } catch (_) { }
                    try { resizeObserver?.disconnect?.(); } catch (_) { }
                    try { prevBtn.removeEventListener('click', onPrev); } catch (_) { }
                    try { nextBtn.removeEventListener('click', onNext); } catch (_) { }
                    try { offResize?.(); } catch (_) { }
                }
            };
        };

        const availableRail = setupCharacterRail(availableBucket);
        if (availableRail?.dispose) railDisposers.push(availableRail.dispose);
        if (availableRail?.refresh) railRefreshers.push(availableRail.refresh);
        const selectedRail = setupCharacterRail(selectedBucket);
        if (selectedRail?.dispose) railDisposers.push(selectedRail.dispose);
        if (selectedRail?.refresh) railRefreshers.push(selectedRail.refresh);

        const getCharacterSortIndex = (characterName) => {
            const key = String(characterName || '').trim().toLowerCase();
            const index = allCharacters.findIndex(name => String(name || '').trim().toLowerCase() === key);
            return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
        };

        const sortAvailableBucket = () => {
            if (!availableBucket) return;
            const avatars = Array.from(availableBucket.querySelectorAll('.camp-rest-invite-avatar'));
            avatars
                .sort((a, b) => getCharacterSortIndex(a.getAttribute('data-character')) - getCharacterSortIndex(b.getAttribute('data-character')))
                .forEach(node => availableBucket.appendChild(node));
            refreshCharacterRails();
        };

        const refreshInvitationBucketState = () => {
            selectedCharacters = selectedBucket
                ? Array.from(selectedBucket.querySelectorAll('.camp-rest-invite-avatar'))
                    .map(btn => btn.getAttribute('data-character'))
                    .filter(Boolean)
                : [];
            if (selectedEmptyState) {
                selectedEmptyState.style.display = selectedCharacters.length > 0 ? 'none' : '';
            }
            if (triggerBtn) {
                triggerBtn.disabled = isBusy || selectedCharacters.length === 0;
            }
            refreshCharacterRails();
        };

        const moveCharacterToSelected = (button) => {
            if (!button || !selectedBucket) return;
            if (button.getAttribute('data-invited') === 'true') return;
            button.classList.add('selected');
            selectedBucket.appendChild(button);
            refreshInvitationBucketState();
        };

        const moveCharacterToAvailable = (button) => {
            if (!button || !availableBucket) return;
            button.classList.remove('selected');
            availableBucket.appendChild(button);
            sortAvailableBucket();
            refreshInvitationBucketState();
        };

        if (availableBucket) {
            availableBucket.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : event.target?.parentElement;
                const button = target?.closest('.camp-rest-invite-avatar');
                if (!button || isBusy || button.disabled) return;
                moveCharacterToSelected(button);
            });
        }

        if (selectedBucket) {
            selectedBucket.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : event.target?.parentElement;
                const button = target?.closest('.camp-rest-invite-avatar');
                if (!button || isBusy || button.disabled) return;
                moveCharacterToAvailable(button);
            });
        }
        refreshInvitationBucketState();

        if (triggerBtn && customModal && closeModalBtn && sendInvitationBtn) {
            triggerBtn.addEventListener('click', () => {
                refreshInvitationBucketState();
                if (selectedCharacters.length === 0) {
                    setStatus('Select at least 1 character to invite!', true);
                    return;
                }
                const alreadyInvited = selectedCharacters.filter(name => invitedCharacterKeys.has(String(name || '').trim().toLowerCase()));
                if (alreadyInvited.length > 0) {
                    setStatus(`${alreadyInvited.join(', ')} already ${alreadyInvited.length === 1 ? 'has' : 'have'} an invitation scene.`, true);
                    return;
                }
                invitedNamesList.textContent = selectedCharacters.join(', ');
                invitedPromptInput.value = '';
                customModal.style.display = 'flex';
                setInviteModalActive(true);
            });

            closeModalBtn.addEventListener('click', () => {
                customModal.style.display = 'none';
                setInviteModalActive(false);
            });

            sendInvitationBtn.addEventListener('click', async () => {
                const userPrompt = invitedPromptInput.value.trim();
                if (!userPrompt) {
                    setStatus('Please describe what you will do with the selected companion(s).', true);
                    return;
                }
                logFlow('invitation-generate:start', {
                    selectedCharacters: selectedCharacters.slice(),
                    promptLength: userPrompt.length
                });

                setBusy(true);
                customModal.style.display = 'none';
                setInviteModalActive(false);
                setStatus('');
                setOverlayVisible(true);
                setProcessing(true, 'Building invitation scene');

                try {
                    // 1. Generate custom interlude
                    const label = `Invitation with ${selectedCharacters.join(', ')}`;

                    const response = await socketRequest('generate-interlude-turn', {
                        parentTurnNumber,
                        prompt: userPrompt,
                        runDirector,
                        interludeMeta: {
                            pluginId: 'camp_rest_interludes',
                            optionKey: `custom_invite_${Date.now()}`,
                            participants: selectedCharacters,
                            isCustomInvite: true
                        },
                        label: label,
                        isStoryRelevant: false,
                        runProfileId: defaultRunProfileId
                    }, 600000);
                    logFlow('invitation-generate:response', {
                        success: response?.success === true,
                        error: response?.error || null,
                        generatedInterludeId: response?.result?.interlude?.id ?? null
                    });

                    // 2. Persist invitation lock scoped to the generated interlude (parent.ordinal).
                    const generatedInterlude = response?.result?.interlude || null;
                    const generatedInterludeId = Number.parseInt(generatedInterlude?.id, 10);
                    const generatedInterludeOrdinal = Number.parseInt(generatedInterlude?.ordinal, 10);
                    if (Number.isInteger(generatedInterludeId) && generatedInterludeId > 0
                        && Number.isInteger(generatedInterludeOrdinal) && generatedInterludeOrdinal > 0) {
                        const saveRes = await socketRequest(saveInvitationEventName, {
                            parentTurnNumber,
                            interludeId: generatedInterludeId,
                            interludeOrdinal: generatedInterludeOrdinal,
                            characterNames: selectedCharacters
                        }, 15000);
                        if (saveRes && saveRes.success === false) {
                            logWarn('Invitation lock save failed:', saveRes.error || 'unknown error');
                        }
                    } else {
                        logWarn('Missing interlude metadata; invitation lock was not persisted.');
                    }

                    await applyViewerResult(response);
                    removeOverlayHostForViewerHandoff();
                    logFlow('invitation-generate:complete', {
                        generatedInterludeId: response?.result?.interlude?.id ?? null
                    });
                } catch (error) {
                    logFlow('invitation-generate:error', {
                        message: error?.message || String(error)
                    });
                    setProcessing(false);
                    setOverlayVisible(true);
                    setStatus(error.message || 'Failed to generate interlude invitation.', true);
                    setBusy(false);
                }
            });
        }

        if (autoContinue) {
            setStatus(fallbackMessage, true);
            scheduleTimeout(() => {
                try {
                    if (bridge?.intercept && typeof bridge.intercept.resolve === 'function') {
                        bridge.intercept.resolve({
                            autoContinue: true,
                            reason: fallbackReason
                        });
                    }
                } catch (_) { }
                removeOverlayHost();
            }, 600);
        }

        if (sceneRuntime && typeof sceneRuntime.start === 'function') {
            sceneRuntime.start().catch((error) => {
                logWarn('Failed to initialize camp layout:', error?.message || error);
            });
        }
        railDisposers.forEach((dispose) => {
            if (typeof dispose !== 'function') return;
            cleanupCallbacks.push(() => {
                try { dispose(); } catch (_) { }
            });
        });
        return;
    }

    if (mode === 'return') {
        const parentTurnNumber = Number.parseInt(payload?.parentTurnNumber, 10);
        const returnBtn = root.querySelector('button[data-action="return-parent"]');
        const statusEl = root.querySelector('.camp-rest-test-return-status');
        if (!returnBtn) return;

        const setStatus = (text) => {
            if (statusEl) statusEl.textContent = text || '';
        };

        returnBtn.onclick = async () => {
            returnBtn.disabled = true;
            setStatus('Returning to parent turn...');
            try {
                const response = await socketRequest('play-historical-turn', {
                    turnNumber: parentTurnNumber
                }, 180000);

                if (!response || response.success !== true || !response.result) {
                    throw new Error((response && response.error) || 'Failed to return to parent turn.');
                }

                bridge.intercept.resolve({ returnedToParent: true });
                await applyViewerResult(response);
            } catch (error) {
                setStatus(error.message || 'Return failed.');
                returnBtn.disabled = false;
            }
        };
    }
})();

