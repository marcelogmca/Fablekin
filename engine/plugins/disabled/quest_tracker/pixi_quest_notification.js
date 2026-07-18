(function () {
    const { PIXI, pixiLayer, pixiApp, payload, checkpointContext } = context || {};
    const notification = payload || {};
    const bridgeTakeover = bridge?.takeover;

    if (!PIXI) {
        bridgeTakeover?.abort?.('missing_pixi_notification_runtime');
        return;
    }

    const app = pixiApp?.app || pixiApp;
    const targetLayer = pixiLayer
        || bridge?.pixi?.getLayer?.('titles')
        || bridge?.pixi?.getLayer?.('fx')
        || app?.stage
        || null;
    if (!app || !targetLayer?.addChild) {
        bridgeTakeover?.abort?.('missing_pixi_notification_layer');
        return;
    }

    const screen = app?.screen || app?.renderer || {};
    const width = Number(pixiApp?.LOGICAL_WIDTH) || Number(screen.width) || 1920;
    const height = Number(pixiApp?.LOGICAL_HEIGHT) || Number(screen.height) || 1080;
    const status = String(notification.status || 'completed').toLowerCase();
    const durationMs = Math.max(1500, Math.min(12000, Number(notification.durationMs) || 4200));

    const css = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(document.documentElement)
        : null;
    const cssVar = (name, fallback = '') => String(css?.getPropertyValue?.(name) || fallback).trim();
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
    const colorPrimary = parseColor(cssVar('--color-primary'), 0xf1c40f);
    const colorSurface = parseColor(cssVar('--bg-surface-1'), 0x1e1e24);
    const colorText = parseColor(cssVar('--text-main'), 0xf5f6fa);
    const colorMuted = parseColor(cssVar('--text-muted'), 0xa4b0be);
    const colorDanger = parseColor(cssVar('--status-danger'), 0xb83b5e);

    const paletteByStatus = {
        completed: { main: colorPrimary, deep: 0x211b08, accent: 0xfff0b8, glow: colorPrimary },
        failed: { main: colorDanger, deep: 0x321614, accent: 0xffc4ba, glow: colorDanger },
        expired: { main: colorDanger, deep: 0x321614, accent: 0xffc4ba, glow: colorDanger },
        dropped: { main: 0xa9b0bd, deep: 0x181d26, accent: 0xe6ebf5, glow: 0x7d8796 }
    };
    const palette = paletteByStatus[status] || paletteByStatus.completed;

    const safeText = (value, fallback = '', max = 180) => {
        const text = String(value ?? fallback).replace(/\s+/g, ' ').trim();
        const finalText = text || fallback;
        return finalText.length > max ? `${finalText.slice(0, Math.max(0, max - 1)).trimEnd()}...` : finalText;
    };

    const createText = (text, style) => {
        try {
            return new PIXI.Text({ text, style });
        } catch (_) {
            return new PIXI.Text(text, style);
        }
    };

    const drawRoundRect = (graphics, x, y, w, h, r, fill, alpha = 1, stroke = null) => {
        graphics.roundRect(x, y, w, h, r);
        if (fill !== null && fill !== undefined) graphics.fill({ color: fill, alpha });
        if (stroke) graphics.stroke(stroke);
    };

    const container = new PIXI.Container();
    container.label = 'QuestTrackerNotification';
    container.alpha = 0;
    container.zIndex = 999990;
    container.eventMode = 'static';
    container.cursor = 'pointer';
    if (bridge?.pixi?.add) {
        bridge.pixi.add(container, {
            layer: pixiLayer ? 'takeover' : 'titles',
            zIndex: 999990,
            label: 'QuestTrackerNotification',
            destroyOnDispose: true
        });
    } else {
        targetLayer.sortableChildren = true;
        targetLayer.addChild(container);
    }

    const cardWidth = Math.min(760, Math.max(500, width * 0.54));
    const titleText = safeText(notification.label, 'Story quest', 72);
    const messageText = notification.message ? safeText(notification.message, '', 120) : '';
    const cardHeight = messageText ? 156 : 116;
    const settledX = Math.round((width - cardWidth) / 2);
    const settledY = Math.round((height - cardHeight) / 2);
    const startY = settledY - 28;
    container.x = settledX;
    container.y = startY;

    const shadow = new PIXI.Graphics();
    drawRoundRect(shadow, 8, 10, cardWidth - 16, cardHeight, 24, 0x000000, 0.28);
    container.addChild(shadow);

    const glow = new PIXI.Graphics();
    drawRoundRect(glow, -3, -3, cardWidth + 6, cardHeight + 6, 27, palette.glow, 0.08);
    container.addChild(glow);

    const card = new PIXI.Graphics();
    drawRoundRect(card, 0, 0, cardWidth, cardHeight, 24, colorSurface, 0.92, {
        color: palette.main,
        width: 2,
        alpha: 0.72
    });
    container.addChild(card);

    const inner = new PIXI.Graphics();
    drawRoundRect(inner, 10, 10, cardWidth - 20, cardHeight - 20, 18, 0xffffff, 0, {
        color: palette.accent,
        width: 1,
        alpha: 0.18
    });
    container.addChild(inner);

    const glyphBack = new PIXI.Graphics();
    drawRoundRect(glyphBack, 24, 28, 56, 56, 18, palette.main, 0.18, {
        color: palette.main,
        width: 2,
        alpha: 0.9
    });
    container.addChild(glyphBack);

    const glyph = createText(status === 'completed' ? 'Q+' : 'Q', {
        fontFamily: 'Cinzel, serif',
        fontSize: 24,
        fontWeight: '900',
        fill: palette.accent,
        align: 'center'
    });
    glyph.anchor.set(0.5);
    glyph.x = 52;
    glyph.y = 56;
    container.addChild(glyph);

    const kicker = createText(safeText(notification.title, 'Quest Updated', 28), {
        fontFamily: 'Inter, NotoSans, sans-serif',
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 1.5,
        fill: palette.main,
        align: 'left'
    });
    kicker.x = 100;
    kicker.y = 24;
    container.addChild(kicker);

    const title = createText(titleText, {
        fontFamily: 'Cinzel, serif',
        fontSize: 21,
        fontWeight: '900',
        fill: colorText,
        align: 'left',
        wordWrap: true,
        wordWrapWidth: cardWidth - 132,
        lineHeight: 25
    });
    title.x = 100;
    title.y = 46;
    container.addChild(title);

    if (messageText) {
        const message = createText(messageText, {
            fontFamily: 'Inter, NotoSans, sans-serif',
            fontSize: 14,
            fill: colorMuted,
            align: 'left',
            wordWrap: true,
            wordWrapWidth: cardWidth - 132,
            lineHeight: 20
        });
        message.x = 100;
        message.y = Math.max(84, title.y + Math.min(title.height, 52) + 8);
        container.addChild(message);
    }

    const lineLabel = Number.isInteger(Number(notification.outcomeLineNumber))
        ? `Line ${Number(notification.outcomeLineNumber)}`
        : (Number.isInteger(Number(checkpointContext?.dialogueIndex)) ? `Line ${Number(checkpointContext.dialogueIndex)}` : '');
    if (lineLabel) {
        const badge = createText(lineLabel, {
            fontFamily: 'Trebuchet MS, Verdana, sans-serif',
            fontSize: 11,
            fontWeight: '800',
            fill: colorMuted,
            align: 'right'
        });
        badge.anchor.set(1, 0);
        badge.x = cardWidth - 24;
        badge.y = cardHeight - 26;
        container.addChild(badge);
    }

    const sfx = safeText(notification.sfx);
    if (sfx && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sfx:play', {
            detail: { file: sfx, loop: false, category: 'effect' }
        }));
    }

    let finished = false;
    const startedAt = Date.now();
    const exitStartMs = Math.max(900, durationMs - 420);

    const cleanup = () => {
        if (finished) return;
        finished = true;
        try {
            if (app?.ticker && tickerFn) app.ticker.remove(tickerFn);
        } catch (_) { }
        try {
            if (container.parent) container.parent.removeChild(container);
            container.destroy?.({ children: true });
        } catch (_) { }
    };

    const finish = () => {
        cleanup();
        if (bridgeTakeover?.isActive?.()) {
            bridgeTakeover.finish({
                result: 'quest_notification_complete',
                notificationId: notification.notificationId || null
            });
        }
    };

    bridge?.lifecycle?.onDispose?.(cleanup);

    const tickerFn = () => {
        const elapsed = Date.now() - startedAt;
        const enter = Math.min(1, elapsed / 360);
        const exit = elapsed > exitStartMs ? Math.min(1, (elapsed - exitStartMs) / 360) : 0;
        const easedEnter = 1 - Math.pow(1 - enter, 3);
        const easedExit = exit * exit;
        container.alpha = Math.max(0, easedEnter * (1 - easedExit));
        container.y = startY + (settledY - startY) * easedEnter - (12 * easedExit);
        container.scale.set(0.97 + 0.03 * easedEnter);
        glow.alpha = 0.55 + Math.sin(elapsed / 120) * 0.1;
        if (elapsed >= durationMs) finish();
    };

    if (app?.ticker) app.ticker.add(tickerFn);
    else {
        const interval = window.setInterval(() => {
            tickerFn();
            if (finished) window.clearInterval(interval);
        }, 16);
    }

    container.on('pointerdown', finish);
}());
