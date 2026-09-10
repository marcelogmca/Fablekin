/* global context */
(function (context) {
    const { socket, state, debugLog, PIXI, pixiApp } = context;
    const PANEL_ID = 'quest_tracker';
    let registered = false;
    let lastPanelSignature = '';
    const currentEntryNotifications = new Set();

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getTurnNumber = explicitTurn => {
        const numeric = Number(explicitTurn);
        if (Number.isInteger(numeric) && numeric > 0) return numeric;
        return state.currentVN?.turnNumber || state.currentTurnNumber || null;
    };

    const getDialogueIndex = explicitIndex => {
        if (explicitIndex !== undefined && explicitIndex !== null) {
            const numeric = Number(explicitIndex);
            if (Number.isInteger(numeric) && numeric >= 0) return numeric;
        }
        const current = Number(state.currentIndex);
        return Number.isInteger(current) && current >= 0 ? current : null;
    };

    const ensurePanel = () => {
        const hud = window.FablekinVNHud;
        if (!hud) return null;
        const existing = hud.getPanel?.(PANEL_ID);
        if (existing) {
            registered = true;
            return existing;
        }
        const panel = hud.registerPanel({
            id: PANEL_ID,
            pluginId: 'quest_tracker',
            title: 'Story Threads',
            icon: '',
            controlIcon: 'Q',
            controlLabel: 'Story Threads',
            dock: 'right',
            priority: 20,
            defaultOpen: true,
            available: false
        });
        registered = true;
        return panel;
    };

    const requestData = (turnNumber = null, dialogueIndex = null) => {
        if (!socket || !ensurePanel()) return;
        socket.emit('quest-tracker-fetch-data', {
            turnNumber: getTurnNumber(turnNumber),
            dialogueIndex: getDialogueIndex(dialogueIndex)
        });
    };

    const getNotificationTitle = status => {
        switch (String(status || '').toLowerCase()) {
            case 'completed': return 'Quest Complete';
            case 'failed': return 'Quest Failed';
            case 'expired': return 'Quest Expired';
            case 'dropped': return 'Quest Dropped';
            default: return 'Quest Updated';
        }
    };

    const cssVar = (name, fallback = '') => {
        try {
            return String(getComputedStyle(document.documentElement).getPropertyValue(name) || fallback).trim();
        } catch {
            return fallback;
        }
    };

    const parseColor = (value, fallback) => {
        const text = String(value || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
        if (/^#[0-9a-f]{3}$/i.test(text)) {
            return parseInt(text.slice(1).split('').map(ch => ch + ch).join(''), 16);
        }
        const rgb = text.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (rgb) return (Number(rgb[1]) << 16) + (Number(rgb[2]) << 8) + Number(rgb[3]);
        return fallback;
    };

    const hasSdkNotificationIntercept = (notification, dialogueIndex) => {
        const descriptors = Array.isArray(state.interceptRuntime?.descriptors)
            ? state.interceptRuntime.descriptors
            : [];
        if (descriptors.length === 0) return false;

        const questId = String(notification?.id || notification?.questId || '').trim();
        const status = String(notification?.status || '').trim().toLowerCase();
        const line = Number(notification?.outcomeLineNumber);
        return descriptors.some(descriptor => {
            const interceptId = String(descriptor?.interceptId || descriptor?.id || '');
            const handlerRef = String(descriptor?.handlerRef || '');
            const payload = descriptor?.payload || {};
            const descriptorLine = Number(descriptor?.dialogueIndex ?? descriptor?.line ?? payload.outcomeLineNumber);
            const descriptorQuestId = String(payload.questId || payload.id || '').trim();
            const descriptorStatus = String(payload.status || '').trim().toLowerCase();
            const isQuestNotification = descriptor?.pluginId === 'quest_tracker'
                && (interceptId.startsWith('quest_notification_') || handlerRef.endsWith('quest_notification'));
            return isQuestNotification
                && Number.isInteger(line)
                && Number.isInteger(dialogueIndex)
                && Number.isInteger(descriptorLine)
                && descriptorLine === line
                && descriptorLine === dialogueIndex
                && (!questId || !descriptorQuestId || descriptorQuestId === questId)
                && (!status || !descriptorStatus || descriptorStatus === status);
        });
    };

    const showPixiQuestNotification = (notification, settings = {}) => {
        if (!notification || settings.enabled === false || !PIXI || !pixiApp?.app) return;
        const line = Number.isInteger(Number(notification.outcomeLineNumber)) ? Number(notification.outcomeLineNumber) : 'x';
        const key = `${notification.turnNumber || 0}:${notification.id || 'quest'}:${notification.status || 'resolved'}:${line}`;
        if (currentEntryNotifications.has(key)) return;
        currentEntryNotifications.add(key);

        const app = pixiApp.app;
        const layer = pixiApp.layers?.titles || pixiApp.layers?.fx || app.stage;
        if (!layer) return;

        const screen = app.screen || app.renderer || {};
        const width = Number(pixiApp.LOGICAL_WIDTH) || Number(screen.width) || 1920;
        const height = Number(pixiApp.LOGICAL_HEIGHT) || Number(screen.height) || 1080;
        const durationMs = Math.max(1500, Math.min(12000, Number(settings.durationMs) || 4200));
        const status = String(notification.status || 'completed').toLowerCase();
        const failed = status === 'failed' || status === 'expired';
        const dropped = status === 'dropped';
        const mainColor = failed
            ? parseColor(cssVar('--status-danger'), 0xb83b5e)
            : (dropped ? 0xa9b0bd : parseColor(cssVar('--color-primary'), 0xf1c40f));
        const surfaceColor = parseColor(cssVar('--bg-surface-1'), 0x1e1e24);
        const textColor = parseColor(cssVar('--text-main'), 0xf5f6fa);
        const mutedColor = parseColor(cssVar('--text-muted'), 0xa4b0be);
        const accentColor = failed ? 0xffc4ba : (dropped ? 0xe6ebf5 : 0xfff0b8);
        const titleText = String(notification.label || notification.id || 'Story quest').replace(/\s+/g, ' ').trim();
        const safeTitle = titleText.length > 72 ? `${titleText.slice(0, 71).trimEnd()}...` : titleText;
        const messageText = String(notification.message || '').replace(/\s+/g, ' ').trim();
        const safeMessage = messageText.length > 120 ? `${messageText.slice(0, 119).trimEnd()}...` : messageText;

        const createText = (text, style) => {
            try {
                return new PIXI.Text({ text, style });
            } catch {
                return new PIXI.Text(text, style);
            }
        };
        const drawRoundRect = (graphics, x, y, w, h, r, fill, alpha = 1, stroke = null) => {
            graphics.roundRect(x, y, w, h, r);
            graphics.fill({ color: fill, alpha });
            if (stroke) graphics.stroke(stroke);
        };

        const container = new PIXI.Container();
        container.label = 'QuestTrackerLiveNotification';
        container.alpha = 0;
        container.zIndex = 999990;
        container.eventMode = 'static';
        container.cursor = 'pointer';
        layer.sortableChildren = true;
        layer.addChild(container);

        const cardWidth = Math.min(760, Math.max(500, width * 0.54));
        const cardHeight = safeMessage ? 156 : 116;
        const settledX = Math.round((width - cardWidth) / 2);
        const settledY = Math.round((height - cardHeight) / 2);
        const startY = settledY - 28;
        container.x = settledX;
        container.y = startY;

        const shadow = new PIXI.Graphics();
        drawRoundRect(shadow, 8, 10, cardWidth - 16, cardHeight, 24, 0x000000, 0.28);
        container.addChild(shadow);

        const card = new PIXI.Graphics();
        drawRoundRect(card, 0, 0, cardWidth, cardHeight, 24, surfaceColor, 0.92, {
            color: mainColor,
            width: 2,
            alpha: 0.72
        });
        container.addChild(card);

        const glyphBack = new PIXI.Graphics();
        drawRoundRect(glyphBack, 24, 28, 56, 56, 18, mainColor, 0.18, {
            color: mainColor,
            width: 2,
            alpha: 0.9
        });
        container.addChild(glyphBack);

        const glyph = createText(status === 'completed' ? 'Q+' : 'Q', {
            fontFamily: 'Cinzel, serif',
            fontSize: 24,
            fontWeight: '900',
            fill: accentColor,
            align: 'center'
        });
        glyph.anchor.set(0.5);
        glyph.x = 52;
        glyph.y = 56;
        container.addChild(glyph);

        const kicker = createText(getNotificationTitle(status), {
            fontFamily: 'Inter, NotoSans, sans-serif',
            fontSize: 14,
            fontWeight: '900',
            fill: mainColor,
            align: 'left'
        });
        kicker.x = 100;
        kicker.y = 24;
        container.addChild(kicker);

        const title = createText(safeTitle, {
            fontFamily: 'Cinzel, serif',
            fontSize: 21,
            fontWeight: '900',
            fill: textColor,
            align: 'left',
            wordWrap: true,
            wordWrapWidth: cardWidth - 132,
            lineHeight: 25
        });
        title.x = 100;
        title.y = 46;
        container.addChild(title);

        if (safeMessage) {
            const message = createText(safeMessage, {
                fontFamily: 'Inter, NotoSans, sans-serif',
                fontSize: 14,
                fill: mutedColor,
                align: 'left',
                wordWrap: true,
                wordWrapWidth: cardWidth - 132,
                lineHeight: 20
            });
            message.x = 100;
            message.y = Math.max(84, title.y + Math.min(title.height, 52) + 8);
            container.addChild(message);
        }

        const file = String(settings?.sfx || '').trim();
        if (file) {
            window.dispatchEvent(new CustomEvent('sfx:play', {
                detail: { file, loop: false, category: 'effect' }
            }));
        }

        let finished = false;
        const startedAt = Date.now();
        const exitStartMs = Math.max(900, durationMs - 420);
        const finish = () => {
            if (finished) return;
            finished = true;
            try { app.ticker?.remove?.(tick); } catch { }
            try { container.parent?.removeChild(container); } catch { }
            try { container.destroy?.({ children: true }); } catch { }
        };
        const tick = () => {
            const elapsed = Date.now() - startedAt;
            const enter = Math.min(1, elapsed / 360);
            const exit = elapsed > exitStartMs ? Math.min(1, (elapsed - exitStartMs) / 360) : 0;
            const easedEnter = 1 - Math.pow(1 - enter, 3);
            const easedExit = exit * exit;
            container.alpha = Math.max(0, easedEnter * (1 - easedExit));
            container.y = startY + (settledY - startY) * easedEnter - (12 * easedExit);
            container.scale.set(0.97 + 0.03 * easedEnter);
            if (elapsed >= durationMs) finish();
        };

        app.ticker?.add?.(tick);
        container.on('pointerdown', finish);
    };

    const handleNotifications = payload => {
        const settings = payload?.notificationSettings || {};
        if (settings.enabled === false) return;
        const dialogueIndex = Number(payload?.dialogueIndex);
        const notifications = Array.isArray(payload?.pendingNotifications) ? payload.pendingNotifications : [];
        notifications
            .filter(notification => {
                const outcomeLine = Number(notification?.outcomeLineNumber);
                return Number.isInteger(dialogueIndex)
                    && Number.isInteger(outcomeLine)
                    && dialogueIndex === outcomeLine
                    && !hasSdkNotificationIntercept(notification, dialogueIndex);
            })
            .forEach(notification => showPixiQuestNotification(notification, settings));
    };

    const hasContent = objectiveState => Boolean(
        objectiveState?.last_completed?.label ||
        objectiveState?.current_activity?.label ||
        (Array.isArray(objectiveState?.active_goals) && objectiveState.active_goals.length > 0)
    );

    const getRegistryStats = registry => {
        const quests = Array.isArray(registry) ? registry : [];
        const active = quests.filter(quest => quest?.status === 'active' || quest?.status === 'pending').length;
        const resolved = quests.filter(quest => ['completed', 'failed', 'expired', 'dropped'].includes(quest?.status)).length;
        return { total: quests.length, active, resolved };
    };

    const normalizeDeadline = quest => {
        const deadline = Number(quest?.deadline_turn);
        return Number.isFinite(deadline) && deadline > 0 ? deadline : Number.MAX_SAFE_INTEGER;
    };

    const getDeadlineLabel = (quest, currentTurn) => {
        const deadline = normalizeDeadline(quest);
        if (deadline === Number.MAX_SAFE_INTEGER) return 'No deadline';
        const turn = Number(currentTurn);
        if (!Number.isFinite(turn) || turn <= 0) return 'Deadline set';
        const turnsLeft = deadline - turn;
        if (turnsLeft <= 0) return 'Due now';
        if (turnsLeft === 1) return '1 turn left';
        return `${turnsLeft} turns left`;
    };

    const getActiveQuests = registry => Array.isArray(registry)
        ? registry
            .filter(quest => quest?.status === 'active' || quest?.status === 'pending')
            .sort((a, b) => normalizeDeadline(a) - normalizeDeadline(b))
        : [];

    const render = payload => {
        const hud = window.FablekinVNHud;
        if (!hud || !ensurePanel()) return;
        const objectiveState = payload?.state || null;
        const stats = getRegistryStats(payload?.registry);
        handleNotifications(payload);
        if (payload?.enabledInHud === false || (!hasContent(objectiveState) && stats.total === 0)) {
            const hiddenSignature = 'hidden';
            if (lastPanelSignature !== hiddenSignature) {
                lastPanelSignature = hiddenSignature;
                hud.updatePanel(PANEL_ID, { available: false, html: '' });
            }
            return;
        }

        const lastCompleted = objectiveState?.last_completed?.label
            ? escapeHtml(objectiveState.last_completed.label)
            : '<span class="quest-tracker-muted">Nothing closed yet.</span>';
        const currentActivity = objectiveState?.current_activity?.label
            ? escapeHtml(objectiveState.current_activity.label)
            : '<span class="quest-tracker-muted">Finding the next thread.</span>';
        const activeQuests = getActiveQuests(payload?.registry);
        const activeQuestCount = activeQuests.length;
        const hasQuestInfo = stats.total > 0;
        const panelTitle = hasQuestInfo ? 'Quests' : 'Story Threads';
        const shownQuests = activeQuests.slice(0, 3);
        const extraQuestCount = Math.max(0, activeQuests.length - shownQuests.length);
        const turnNumber = getTurnNumber(payload?.turnNumber);
        const dialogueIndex = getDialogueIndex(payload?.dialogueIndex);
        const questItemsHtml = shownQuests.map(quest => {
            const questLabel = quest.objective || quest.brief || quest.id || 'Unnamed quest';
            const deadlineLabel = getDeadlineLabel(quest, turnNumber);
            return `
                <li class="quest-tracker-thread quest-tracker-quest">
                    <span title="${escapeHtml(questLabel)}">${escapeHtml(questLabel)}</span>
                    <em>${escapeHtml(deadlineLabel)}</em>
                </li>
            `;
        }).join('');
        const goals = !hasQuestInfo && Array.isArray(objectiveState?.active_goals) && objectiveState.active_goals.length > 0
            ? objectiveState.active_goals.slice(0, 3)
            : [];
        const threadItemsHtml = goals.map(goal => `
            <li class="quest-tracker-thread">
                <span>${escapeHtml(goal.label || 'Unnamed thread')}</span>
                ${goal.status ? `<em>${escapeHtml(goal.status)}</em>` : ''}
            </li>
        `).join('');
        const extraQuestHtml = hasQuestInfo && extraQuestCount > 0
            ? `<div class="quest-tracker-more">${escapeHtml(extraQuestCount)} more active ${extraQuestCount === 1 ? 'quest' : 'quests'}</div>`
            : '';
        const goalsHtml = hasQuestInfo
            ? (questItemsHtml || '<li class="quest-tracker-thread quest-tracker-thread-empty"><span>No active quests.</span></li>')
            : (threadItemsHtml || '<li class="quest-tracker-thread quest-tracker-thread-empty"><span>No active threads.</span></li>');
        const html = `
            <div class="quest-tracker-shell">
                <div class="quest-tracker-heading">
                    <span class="quest-tracker-heading-mark" aria-hidden="true"></span>
                    <span>${escapeHtml(panelTitle)}</span>
                    <button type="button" class="hud-socket-emit quest-tracker-log-link"
                            data-event="quest-tracker-request-full-log"
                            data-payload='{"turnNumber": ${turnNumber || 'null'}, "dialogueIndex": ${dialogueIndex ?? 'null'}}'
                            aria-label="Open story quest log, ${activeQuestCount} active ${activeQuestCount === 1 ? 'quest' : 'quests'}">
                        Open Quest Log <strong>${activeQuestCount}</strong>
                    </button>
                </div>
                <div class="quest-tracker-line quest-tracker-current">
                    <div class="quest-tracker-kicker">Now</div>
                    <div class="quest-tracker-text">${currentActivity}</div>
                </div>
                <div class="quest-tracker-line">
                    <div class="quest-tracker-kicker">Last</div>
                    <div class="quest-tracker-text">${lastCompleted}</div>
                </div>
                <div class="quest-tracker-line quest-tracker-thread-list">
                    <div class="quest-tracker-kicker">${hasQuestInfo ? 'Quests' : 'Threads'}</div>
                    <ul class="quest-tracker-goals">${goalsHtml}</ul>
                    ${extraQuestHtml}
                </div>
            </div>
        `;
        const panelSignature = JSON.stringify({
            available: true,
            title: panelTitle,
            controlLabel: panelTitle,
            html
        });
        if (panelSignature === lastPanelSignature) return;
        lastPanelSignature = panelSignature;

        hud.updatePanel(PANEL_ID, {
            available: true,
            title: panelTitle,
            controlLabel: panelTitle,
            html
        });
    };

    socket?.on('quest-tracker-data', render);
    socket?.on('vn-processing-complete', data => requestData(data?.turnNumber));
    socket?.on('chat-db-switched', () => {
        lastPanelSignature = '';
        window.FablekinVNHud?.updatePanel(PANEL_ID, { available: false, html: '' });
        setTimeout(() => requestData(), 300);
    });
    socket?.on('project-ready', () => setTimeout(() => requestData(), 300));
    socket?.on('execute-frontend-hook', data => {
        if (data?.hookName === 'HOOK_VN_GUI_READY') requestData();
    });
    window.addEventListener('vn:dialogue-enter', event => {
        currentEntryNotifications.clear();
        const index = Number(event?.detail?.dialogueIndex);
        requestData(null, Number.isInteger(index) ? index : null);
    });
    window.addEventListener('vn:hud-ready', () => requestData());

    if (ensurePanel()) requestData();
    debugLog?.(`Quest Tracker [HUD]: ${registered ? 'registered' : 'waiting for VN HUD'}.`);
})(context);
