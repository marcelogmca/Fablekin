(function (context) {
    const { socket, state } = context;
    const container = document.getElementById('vn-hud-container');
    const gameContainer = document.getElementById('game-container');
    const leftDock = document.getElementById('vn-hud-left-dock');
    const rightDock = document.getElementById('vn-hud-right-dock');
    const ambientLeftLayer = document.getElementById('vn-hud-ambient-left-layer');
    const ambientLayer = document.getElementById('vn-hud-ambient-layer');
    const panelControls = document.getElementById('vn-hud-panel-controls');
    const fullscreenLayer = document.getElementById('vn-hud-fullscreen-layer');
    const modalOverlay = document.getElementById('vn-hud-modal-overlay');
    const userInputContainer = document.getElementById('user-input-container');
    const panels = new Map();
    const pinnedNotices = new Map();
    const compactActive = { left: null, right: null };
    const compactTouched = { left: false, right: false };
    let uiVisible = true;
    let compactLayout = false;
    let activeFullscreenId = null;
    let persistedPanelPreferences = null;
    let preferencesLoadToken = 0;
    let preferencesDirtyVersion = 0;
    let temporaryLeaseSequence = 0;
    const temporaryPresentationLeases = new Map();
    const temporaryPanelOverrides = new Map();

    if (!container || !gameContainer || !leftDock || !rightDock || !ambientLeftLayer || !ambientLayer || !panelControls || !fullscreenLayer) return;
    const syncEditorModeVisibility = () => {
        container.classList.toggle('vn-hud-editor-suspended', Boolean(document.body?.dataset?.vnEditorMode));
    };


    gameContainer.appendChild(container);
    if (modalOverlay && modalOverlay.parentElement !== document.body) document.body.appendChild(modalOverlay);

    const syncFallbackContrast = presentation => {
        container.classList.toggle('vn-hud-fallback-contrast', presentation === 'fallback');
    };
    syncFallbackContrast(gameContainer.dataset.vnScenePresentation);
    window.addEventListener('vn:scene-presentation-changed', event => {
        syncFallbackContrast(event.detail?.presentation);
    });

    const syncDialogueHistoryContrast = visible => {
        container.classList.toggle('vn-hud-dialogue-history-contrast', visible === true);
    };
    syncDialogueHistoryContrast(gameContainer.dataset.vnDialogueHistoryVisible === 'true');
    window.addEventListener('vn:dialogue-history-visibility-changed', event => {
        syncDialogueHistoryContrast(event.detail?.visible);
    });

    const syncIntroVisibility = visible => {
        container.classList.toggle('vn-hud-intro-suspended', visible === true);
    };
    syncIntroVisibility(gameContainer.dataset.vnIntroMode === 'true');
    window.addEventListener('vn:intro-visibility-changed', event => {
        syncIntroVisibility(event.detail?.visible);
    });

    const pinnedNoticeRail = (() => {
        if (!userInputContainer) return null;
        const existing = document.getElementById('vn-hud-pinned-notice-rail');
        if (existing) return existing;
        const rail = document.createElement('div');
        rail.id = 'vn-hud-pinned-notice-rail';
        rail.setAttribute('aria-live', 'polite');
        rail.hidden = true;
        userInputContainer.appendChild(rail);
        return rail;
    })();

    const projectId = () => String(state.currentVN?.projectName || state.projectName || 'default');
    const localStorageKey = () => {
        const project = state.currentVN?.projectName || state.projectName || 'default';
        return `fablekin_vn_hud_panels:${encodeURIComponent(String(project))}`;
    };

    const loadLocalPreferences = () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(localStorageKey()) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const loadPreferences = () => {
        if (persistedPanelPreferences && typeof persistedPanelPreferences === 'object') return persistedPanelPreferences;
        return loadLocalPreferences();
    };

    const applyPreferencesToPanels = (preferences = {}) => {
        panels.forEach(panel => {
            panel.open = Object.prototype.hasOwnProperty.call(preferences, panel.id)
                ? preferences[panel.id] !== false
                : panel.defaultOpen !== false;
        });
        compactActive.left = null;
        compactActive.right = null;
        compactTouched.left = false;
        compactTouched.right = false;
        applyAllPanelStates();
    };

    const persistPreferencesToProject = () => {
        if (!socket) return;
        socket.emit('vn-hud:save-panel-preferences', {
            preferences: persistedPanelPreferences || {}
        });
    };

    const savePreferences = () => {
        preferencesDirtyVersion += 1;
        const preferences = {};
        panels.forEach((panel, id) => { preferences[id] = panel.open !== false; });
        persistedPanelPreferences = preferences;
        try { localStorage.setItem(localStorageKey(), JSON.stringify(preferences)); } catch { }
        persistPreferencesToProject();
    };

    const hydratePreferences = async () => {
        const token = ++preferencesLoadToken;
        const dirtyVersionAtStart = preferencesDirtyVersion;
        const localPreferences = loadLocalPreferences();
        persistedPanelPreferences = localPreferences;
        applyPreferencesToPanels(localPreferences);
        try {
            const response = socket?.emitReceive
                ? await socket.emitReceive('vn-hud:get-panel-preferences', {})
                : null;
            if (token !== preferencesLoadToken) return;
            if (preferencesDirtyVersion !== dirtyVersionAtStart) return;
            const savedPreferences = response?.success && response.preferences && typeof response.preferences === 'object'
                ? response.preferences
                : null;
            if (savedPreferences && typeof savedPreferences === 'object') {
                persistedPanelPreferences = savedPreferences;
                applyPreferencesToPanels(savedPreferences);
                return;
            }
            persistedPanelPreferences = localPreferences;
            if (Object.keys(localPreferences).length > 0) {
                persistPreferencesToProject();
            } else {
                applyPreferencesToPanels({});
            }
        } catch {
            persistedPanelPreferences = localPreferences;
            applyPreferencesToPanels(localPreferences);
        }
    };

    const normalizeDock = dock => ['right', 'ambient-left', 'ambient-right'].includes(dock) ? dock : 'left';
    const isEdgeDock = dock => dock === 'left' || dock === 'right';
    const dockFor = dock => dock === 'right'
        ? rightDock
        : (dock === 'ambient-right' ? ambientLayer : (dock === 'ambient-left' ? ambientLeftLayer : leftDock));

    const isCompactViewport = () => window.innerWidth <= 900 || gameContainer.clientHeight <= 700;

    const placePanel = (panel) => {
        const dock = dockFor(panel.dock);
        const siblings = Array.from(dock.children).filter(child => child !== panel.shell);
        const before = siblings.find(child => Number(child.dataset.priority || 100) > panel.priority);
        if (before) dock.insertBefore(panel.shell, before);
        else dock.appendChild(panel.shell);
    };

    const placeControl = panel => {
        if (!panel.control) return;
        const siblings = Array.from(panelControls.children).filter(child => child !== panel.control);
        const before = siblings.find(child => Number(child.dataset.priority || 100) > panel.priority);
        if (before) panelControls.insertBefore(panel.control, before);
        else panelControls.appendChild(panel.control);
    };

    const preferredCompactPanel = (dock) => {
        const preferredId = dock === 'right' ? 'world_location_tracker' : 'world_status';
        const preferred = panels.get(preferredId);
        if (preferred?.dock === dock && preferred.available !== false && preferred.open !== false) return preferredId;
        const candidates = Array.from(panels.values())
            .filter(panel => panel.dock === dock && panel.available !== false && panel.open !== false)
            .sort((a, b) => a.priority - b.priority);
        return candidates[0]?.id || null;
    };

    const normalizeIdSet = (value) => new Set((Array.isArray(value) ? value : [])
        .map(item => String(item || '').trim())
        .filter(Boolean));

    const clampOpacity = (value, fallback = 0.25) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(0.05, Math.min(1, numeric));
    };

    const hasTemporaryPresentation = () => temporaryPresentationLeases.size > 0;

    const getTemporaryPanelEffect = (panel) => {
        let mode = null;
        let opacity = 1;
        temporaryPresentationLeases.forEach(lease => {
            if (lease.excludePanelIds.has(panel.id) || lease.excludePluginIds.has(panel.pluginId || panel.id)) return;
            if (lease.mode === 'hide') {
                mode = 'hide';
                opacity = Math.min(opacity, lease.opacity);
                return;
            }
            if (lease.mode === 'dim' && mode !== 'hide') {
                mode = 'dim';
                opacity = Math.min(opacity, lease.opacity);
            }
        });
        return { mode, opacity };
    };

    const cleanupTemporaryOverrides = () => {
        const now = Date.now();
        temporaryPanelOverrides.forEach((override, id) => {
            if (!override || now - override.at > 30 * 60 * 1000) temporaryPanelOverrides.delete(id);
        });
        if (!hasTemporaryPresentation()) temporaryPanelOverrides.clear();
    };

    const applyPanelState = (panel) => {
        const responsiveOpen = !compactLayout || !isEdgeDock(panel.dock) || compactActive[panel.dock] === panel.id;
        const leaseEffect = getTemporaryPanelEffect(panel);
        const temporaryOverride = temporaryPanelOverrides.get(panel.id);
        const hasTemporaryOverride = !!temporaryOverride;
        const forcedOpenByUser = temporaryOverride?.open === true;
        const hiddenByLease = leaseEffect.mode === 'hide' && !forcedOpenByUser;
        const savedOrForcedOpen = hasTemporaryOverride ? temporaryOverride.open !== false : panel.open !== false;
        const visuallyOpen = uiVisible && panel.available !== false && savedOrForcedOpen && responsiveOpen && !hiddenByLease;
        const dimmedOpacity = leaseEffect.mode === 'dim' || (leaseEffect.mode === 'hide' && forcedOpenByUser)
            ? leaseEffect.opacity
            : null;
        panel.shell.classList.toggle('is-collapsed', !visuallyOpen);
        panel.shell.classList.toggle('is-unavailable', panel.available === false);
        panel.shell.classList.toggle('is-temporary-dimmed', dimmedOpacity !== null && dimmedOpacity < 1);
        if (dimmedOpacity !== null && dimmedOpacity < 1) {
            panel.shell.style.setProperty('--vn-hud-temporary-opacity', String(dimmedOpacity));
        } else {
            panel.shell.style.removeProperty('--vn-hud-temporary-opacity');
        }
        panel.toggle.setAttribute('aria-expanded', String(visuallyOpen));
        panel.toggle.setAttribute('aria-label', `${visuallyOpen ? 'Hide' : 'Show'} ${panel.title}`);
        panel.toggle.title = `${visuallyOpen ? 'Hide' : 'Show'} ${panel.title}`;
        panel.shell.style.height = visuallyOpen ? `${panel.mount.scrollHeight || panel.surface?.scrollHeight || 34}px` : '34px';
        if (panel.control) {
            panel.control.hidden = panel.available === false || panel.showInControls === false;
            panel.control.classList.toggle('is-active', visuallyOpen);
            panel.control.classList.toggle('is-temporary-hidden', leaseEffect.mode === 'hide' && !forcedOpenByUser);
            panel.control.classList.toggle('is-temporary-dimmed', leaseEffect.mode === 'dim' || forcedOpenByUser);
            panel.control.setAttribute('aria-pressed', String(visuallyOpen));
            panel.control.setAttribute('aria-label', `${visuallyOpen ? 'Hide' : 'Show'} ${panel.controlLabel}`);
            panel.control.title = `${visuallyOpen ? 'Hide' : 'Show'} ${panel.controlLabel}`;
        }
    };

    const applyAllPanelStates = () => {
        cleanupTemporaryOverrides();
        if (compactLayout) {
            for (const dock of ['left', 'right']) {
                const active = panels.get(compactActive[dock]);
                if (!compactTouched[dock]) {
                    compactActive[dock] = preferredCompactPanel(dock);
                } else if (compactActive[dock] !== false && (!active || active.dock !== dock || active.available === false || active.open === false)) {
                    compactActive[dock] = preferredCompactPanel(dock);
                }
            }
        }
        panels.forEach(applyPanelState);
    };

    const setPanelOpen = (id, open, options = {}) => {
        const panel = panels.get(id);
        if (!panel) return false;
        const leaseEffect = getTemporaryPanelEffect(panel);
        if (leaseEffect.mode && options.temporary !== false) {
            temporaryPanelOverrides.set(panel.id, { open: open !== false, at: Date.now() });
            applyAllPanelStates();
            panel.onVisibilityChange?.(panel.open);
            return true;
        }
        panel.open = open !== false;
        if (compactLayout) {
            compactTouched[panel.dock] = true;
            compactActive[panel.dock] = panel.open ? panel.id : false;
        }
        applyAllPanelStates();
        if (options.persist !== false) savePreferences();
        panel.onVisibilityChange?.(panel.open);
        return true;
    };

    const initializeComponents = (root) => {
        if (!root) return;
        root.querySelectorAll('.hud-toggle').forEach(toggle => {
            if (toggle.dataset.hudInitialized) return;
            toggle.dataset.hudInitialized = 'true';
            const targetId = toggle.dataset.target;
            const target = targetId ? root.querySelector(`#${targetId}`) : toggle.nextElementSibling;
            if (!target) return;
            toggle.addEventListener('click', event => {
                event.stopPropagation();
                target.classList.toggle('expanded');
            });
        });

        root.querySelectorAll('.hud-socket-emit').forEach(trigger => {
            if (trigger.dataset.hudInitialized) return;
            trigger.dataset.hudInitialized = 'true';
            trigger.addEventListener('click', event => {
                event.stopPropagation();
                let payload = {};
                try { payload = trigger.dataset.payload ? JSON.parse(trigger.dataset.payload) : {}; } catch { }
                if (trigger.dataset.event) socket?.emit(trigger.dataset.event, payload);
            });
        });
    };

    const createPanel = (options) => {
        const id = String(options.id);
        const dock = normalizeDock(options.dock);
        const shell = document.createElement('section');
        shell.id = `vn-hud-panel-${id}`;
        shell.className = 'vn-hud-panel-shell';
        shell.dataset.panelId = id;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vn-hud-panel-toggle';
        toggle.innerHTML = '<span class="vn-hud-panel-chevron" aria-hidden="true">&gt;</span>';
        shell.appendChild(toggle);

        let surface = null;
        let content = null;
        const mount = document.createElement('div');
        if (options.element) {
            mount.className = 'vn-hud-custom-mount';
            mount.appendChild(options.element);
            shell.appendChild(mount);
        } else {
            surface = document.createElement('div');
            surface.className = 'vn-hud-panel-surface';
            surface.innerHTML = `
                <div class="vn-hud-panel-header">
                    <span class="vn-hud-panel-icon" aria-hidden="true"></span>
                    <span class="vn-hud-panel-title"></span>
                </div>
                <div class="vn-hud-panel-content"></div>
            `;
            content = surface.querySelector('.vn-hud-panel-content');
            mount.appendChild(surface);
            shell.appendChild(mount);
        }

        const preferences = loadPreferences();
        const panel = {
            id,
            shell,
            toggle,
            mount,
            surface,
            content,
            element: options.element || null,
            dock,
            title: options.title || id,
            icon: options.icon || '',
            pluginId: options.pluginId || id,
            priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 100,
            defaultOpen: options.defaultOpen !== false,
            open: Object.prototype.hasOwnProperty.call(preferences, id) ? preferences[id] !== false : options.defaultOpen !== false,
            available: options.available !== false,
            controlIcon: options.controlIcon || options.icon || String(options.title || id).charAt(0).toUpperCase(),
            controlLabel: options.controlLabel || options.title || id,
            showInControls: options.showInControls !== false,
            onVisibilityChange: options.onVisibilityChange || null
        };

        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'vn-hud-panel-control';
        control.dataset.panelId = id;
        control.innerHTML = '<span class="vn-hud-panel-control-icon" aria-hidden="true"></span><span class="vn-hud-panel-control-label"></span>';
        control.addEventListener('click', () => setPanelOpen(id, panel.shell.classList.contains('is-collapsed')));
        panel.control = control;

        shell.dataset.priority = String(panel.priority);
        shell.dataset.dock = panel.dock;
        toggle.addEventListener('click', () => setPanelOpen(id, panel.shell.classList.contains('is-collapsed')));
        panels.set(id, panel);
        placePanel(panel);
        placeControl(panel);
        return panel;
    };

    const updatePanel = (id, options = {}) => {
        const panel = panels.get(String(id));
        if (!panel) return null;
        if (options.title !== undefined) panel.title = String(options.title || panel.id);
        if (options.icon !== undefined) panel.icon = options.icon || '';
        if (options.pluginId !== undefined) panel.pluginId = options.pluginId || panel.id;
        if (options.priority !== undefined) panel.priority = Number(options.priority) || 100;
        if (options.dock !== undefined) panel.dock = normalizeDock(options.dock);
        if (options.available !== undefined) panel.available = options.available !== false;
        if (options.defaultOpen !== undefined) panel.defaultOpen = options.defaultOpen !== false;
        if (options.controlIcon !== undefined) panel.controlIcon = options.controlIcon || String(panel.title).charAt(0).toUpperCase();
        if (options.controlLabel !== undefined) panel.controlLabel = options.controlLabel || panel.title;
        if (options.showInControls !== undefined) panel.showInControls = options.showInControls !== false;
        if (options.onVisibilityChange !== undefined) panel.onVisibilityChange = options.onVisibilityChange;
        panel.shell.dataset.priority = String(panel.priority);
        panel.shell.dataset.dock = panel.dock;
        if (panel.surface) {
            panel.surface.querySelector('.vn-hud-panel-title').textContent = panel.title;
            panel.surface.querySelector('.vn-hud-panel-icon').innerHTML = panel.icon;
        }
        if (panel.control) {
            panel.control.dataset.priority = String(panel.priority);
            panel.control.querySelector('.vn-hud-panel-control-icon').textContent = panel.controlIcon;
            panel.control.querySelector('.vn-hud-panel-control-label').textContent = panel.controlLabel;
        }
        if (options.html !== undefined && panel.content) {
            panel.content.innerHTML = options.html || '';
            initializeComponents(panel.content);
            window.dispatchEvent(new CustomEvent('vn:hud-panel-updated', {
                detail: { id: panel.id, content: panel.content }
            }));
        }
        placePanel(panel);
        placeControl(panel);
        requestAnimationFrame(() => applyAllPanelStates());
        return panel;
    };

    const registerPanel = (options = {}) => {
        if (!options.id) return null;
        let panel = panels.get(String(options.id));
        if (!panel) panel = createPanel(options);
        updatePanel(panel.id, options);
        applyAllPanelStates();
        return panel;
    };

    const unregisterPanel = (id) => {
        const panel = panels.get(String(id));
        if (!panel) return false;
        if (activeFullscreenId === panel.id) setFullscreen(panel.id, false);
        panel.shell.remove();
        panel.control?.remove();
        panels.delete(panel.id);
        applyAllPanelStates();
        return true;
    };

    const setFullscreen = (id, enabled) => {
        const panel = panels.get(String(id));
        if (!panel?.element) return false;
        if (enabled) {
            if (activeFullscreenId && activeFullscreenId !== panel.id) setFullscreen(activeFullscreenId, false);
            fullscreenLayer.appendChild(panel.element);
            activeFullscreenId = panel.id;
            container.classList.add('vn-hud-fullscreen-active');
        } else if (activeFullscreenId === panel.id) {
            panel.mount.appendChild(panel.element);
            activeFullscreenId = null;
            container.classList.remove('vn-hud-fullscreen-active');
            applyAllPanelStates();
        }
        return true;
    };

    const renderPinnedNotice = (notice) => {
        const node = notice.node || document.createElement('div');
        node.className = `vn-hud-pinned-notice tone-${notice.tone}`;
        node.dataset.noticeId = notice.id;

        const copy = document.createElement('div');
        copy.className = 'vn-hud-pinned-notice-copy';
        if (notice.kicker) {
            const kicker = document.createElement('span');
            kicker.className = 'vn-hud-pinned-notice-kicker';
            kicker.textContent = notice.kicker;
            copy.appendChild(kicker);
        }
        const title = document.createElement('strong');
        title.textContent = notice.title || notice.id;
        copy.appendChild(title);
        if (notice.detail) {
            const detail = document.createElement('span');
            detail.className = 'vn-hud-pinned-notice-detail';
            detail.textContent = notice.detail;
            copy.appendChild(detail);
        }

        node.replaceChildren(copy);
        if (notice.dismissible) {
            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'vn-hud-pinned-notice-action';
            dismiss.textContent = notice.dismissLabel || 'Cancel';
            dismiss.addEventListener('click', event => {
                event.stopPropagation();
                notice.onDismiss?.();
                removePinnedNotice(notice.id);
            });
            node.appendChild(dismiss);
        }
        notice.node = node;
        return node;
    };

    const applyPinnedNoticeLayout = () => {
        if (!pinnedNoticeRail) return;
        const notices = Array.from(pinnedNotices.values())
            .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        pinnedNoticeRail.hidden = notices.length === 0;
        pinnedNoticeRail.replaceChildren(...notices.map(renderPinnedNotice));
    };

    function removePinnedNotice(id) {
        const removed = pinnedNotices.delete(String(id));
        if (removed) applyPinnedNoticeLayout();
        return removed;
    }

    const setPinnedNotice = (options = {}) => {
        if (!pinnedNoticeRail || !options.id) return null;
        const id = String(options.id);
        const existing = pinnedNotices.get(id) || {};
        const notice = {
            ...existing,
            id,
            owner: String(options.owner || existing.owner || id),
            priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : (existing.priority || 100),
            tone: ['info', 'travel', 'inventory', 'warning'].includes(String(options.tone || '').toLowerCase())
                ? String(options.tone).toLowerCase()
                : 'info',
            kicker: String(options.kicker || ''),
            title: String(options.title || ''),
            detail: String(options.detail || ''),
            dismissible: options.dismissible === true,
            dismissLabel: String(options.dismissLabel || 'Cancel'),
            onDismiss: typeof options.onDismiss === 'function' ? options.onDismiss : null
        };
        pinnedNotices.set(id, notice);
        applyPinnedNoticeLayout();
        return notice;
    };

    const clearPinnedNoticesByOwner = (owner) => {
        const ownerId = String(owner || '').trim();
        if (!ownerId) return 0;
        let count = 0;
        pinnedNotices.forEach((notice, id) => {
            if (notice.owner === ownerId) {
                pinnedNotices.delete(id);
                count += 1;
            }
        });
        if (count > 0) applyPinnedNoticeLayout();
        return count;
    };

    const requestTemporaryPresentation = (options = {}) => {
        const id = String(options.id || `${options.owner || 'anonymous'}:${++temporaryLeaseSequence}`);
        const mode = String(options.mode || 'hide').toLowerCase() === 'dim' ? 'dim' : 'hide';
        const lease = {
            id,
            owner: String(options.owner || 'anonymous'),
            reason: String(options.reason || ''),
            mode,
            opacity: clampOpacity(options.opacity, mode === 'dim' ? 0.35 : 0.25),
            excludePanelIds: normalizeIdSet(options.excludePanelIds),
            excludePluginIds: normalizeIdSet(options.excludePluginIds)
        };
        temporaryPresentationLeases.set(id, lease);
        applyAllPanelStates();
        let released = false;
        return {
            id,
            release: () => {
                if (released) return false;
                released = true;
                const removed = temporaryPresentationLeases.delete(id);
                if (!hasTemporaryPresentation()) temporaryPanelOverrides.clear();
                applyAllPanelStates();
                return removed;
            }
        };
    };

    const releaseTemporaryPresentationsByOwner = (owner) => {
        const ownerId = String(owner || '').trim();
        if (!ownerId) return 0;
        let count = 0;
        temporaryPresentationLeases.forEach((lease, id) => {
            if (lease.owner === ownerId) {
                temporaryPresentationLeases.delete(id);
                count += 1;
            }
        });
        if (!hasTemporaryPresentation()) temporaryPanelOverrides.clear();
        if (count > 0) applyAllPanelStates();
        return count;
    };

    const api = {
        registerPanel,
        updatePanel,
        unregisterPanel,
        setPanelOpen,
        setFullscreen,
        setPinnedNotice,
        removePinnedNotice,
        clearPinnedNoticesByOwner,
        getPinnedNotices: () => Array.from(pinnedNotices.values()).map(notice => ({ ...notice, node: undefined, onDismiss: undefined })),
        requestTemporaryPresentation,
        releaseTemporaryPresentationsByOwner,
        getPanel: id => panels.get(String(id)) || null
    };
    window.FablekinVNHud = api;

    socket?.on('vn-hud-update-section', data => {
        if (!data?.id) return;
        registerPanel({
            id: data.id,
            title: data.title || data.id,
            icon: data.icon || '',
            pluginId: data.pluginId || data.id,
            dock: data.dock || 'left',
            priority: data.priority ?? 100,
            defaultOpen: data.defaultOpen !== false,
            available: data.available !== false,
            controlIcon: data.controlIcon,
            controlLabel: data.controlLabel,
            showInControls: data.showInControls !== false,
            html: data.html || ''
        });
    });

    const modalTitle = document.getElementById('vn-hud-modal-title');
    const modalContent = document.getElementById('vn-hud-modal-content');
    const modalClose = document.getElementById('vn-hud-modal-close');

    const showModal = data => {
        if (!data || !modalOverlay || !modalContent) return;
        const previousModalClass = modalOverlay.dataset.modalClass;
        if (previousModalClass) modalOverlay.classList.remove(previousModalClass);
        const modalClass = String(data.modalClass || '').trim();
        if (modalClass) modalOverlay.classList.add(modalClass);
        modalOverlay.dataset.modalClass = modalClass;
        const canvasScoped = data.scope === 'canvas';
        modalOverlay.classList.toggle('vn-hud-modal-canvas', canvasScoped);
        const modalParent = canvasScoped ? gameContainer : document.body;
        if (modalOverlay.parentElement !== modalParent) modalParent.appendChild(modalOverlay);
        modalTitle.textContent = data.title || 'Information';
        modalContent.innerHTML = data.html || '';
        modalContent.querySelectorAll('script').forEach(oldScript => {
            const script = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => script.setAttribute(attr.name, attr.value));
            script.textContent = oldScript.textContent;
            oldScript.replaceWith(script);
        });
        document.getElementById('hud-modal-custom-styles')?.remove();
        if (data.styles) {
            const style = document.createElement('style');
            style.id = 'hud-modal-custom-styles';
            style.textContent = data.styles;
            document.head.appendChild(style);
        }
        initializeComponents(modalContent);
        modalOverlay.classList.remove('hud-modal-hidden');
        modalOverlay.classList.add('hud-modal-visible');
    };

    const closeModal = () => {
        if (!modalOverlay) return;
        modalOverlay.classList.remove('hud-modal-visible');
        modalOverlay.classList.add('hud-modal-hidden');
        setTimeout(() => {
            if (modalOverlay.classList.contains('hud-modal-hidden')) modalContent.innerHTML = '';
        }, 300);
    };

    modalClose?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', event => { if (event.target === modalOverlay) closeModal(); });
    socket?.on('vn-hud-show-modal', showModal);
    socket?.on('vn-hud-close-modal', closeModal);

    const fetchData = (dialogueIndex = null) => {
        socket?.emit('vn-hud-fetch-data', {
            turnNumber: state.currentVN?.turnNumber,
            dialogueIndex: Number.isInteger(dialogueIndex) ? dialogueIndex : state.currentIndex
        });
    };

    const refreshResponsiveLayout = () => {
        const nextCompact = isCompactViewport();
        if (nextCompact !== compactLayout) {
            compactLayout = nextCompact;
            compactTouched.left = false;
            compactTouched.right = false;
            compactActive.left = preferredCompactPanel('left');
            compactActive.right = preferredCompactPanel('right');
        }
        applyAllPanelStates();
    };

    window.addEventListener('resize', refreshResponsiveLayout);
    window.addEventListener('vn:ui-visibility-toggled', event => {
        uiVisible = event.detail?.show !== false;
        container.classList.toggle('vn-hud-hidden', !uiVisible);
        applyAllPanelStates();
    });
    window.addEventListener('vn:editor-mode-changed', syncEditorModeVisibility);
    window.addEventListener('vn:dialogue-enter', event => {
        const index = Number(event.detail?.dialogueIndex);
        fetchData(Number.isInteger(index) ? index : null);
    });
    socket?.on('vn-hud-force-refresh', fetchData);
    socket?.on('vn-processing-complete', fetchData);
    const reloadProjectPreferences = () => setTimeout(() => {
        hydratePreferences();
    }, 0);
    socket?.on('chat-db-switched', reloadProjectPreferences);
    socket?.on('project-ready', reloadProjectPreferences);
    syncEditorModeVisibility();

    compactLayout = isCompactViewport();
    applyAllPanelStates();
    window.dispatchEvent(new CustomEvent('vn:hud-ready', { detail: { api } }));
    hydratePreferences();
    fetchData();
})(context);
