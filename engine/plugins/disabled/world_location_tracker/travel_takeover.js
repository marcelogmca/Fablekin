(function () {
    const { PIXI, pixiLayer, descriptor, checkpointContext, pixiApp } = context || {};
    const payload = descriptor?.payload || {};
    const debugLabel = String(descriptor?.debugLabel || descriptor?.diagnosticLabel || 'WorldTravelIntercept')
        .replace(/[^\w:.-]+/g, '_')
        .slice(0, 80) || 'WorldTravelIntercept';
    const travelDebug = (message, data = null) => {
        try {
            if (typeof window !== 'undefined') {
                const buffer = window.__VN_TRAVEL_DEBUG = Array.isArray(window.__VN_TRAVEL_DEBUG)
                    ? window.__VN_TRAVEL_DEBUG
                    : [];
                let frozenData = data;
                try {
                    frozenData = data === null || data === undefined
                        ? data
                        : JSON.parse(JSON.stringify(data));
                } catch {
                    frozenData = { unserializable: String(data) };
                }
                buffer.push({
                    t: typeof performance !== 'undefined' && performance.now ? Number(performance.now().toFixed(3)) : Date.now(),
                    message,
                    data: frozenData
                });
                if (buffer.length > 250) buffer.splice(0, buffer.length - 250);
            }
            console.info(`[${debugLabel}] takeover:${message}`, data || '');
            console.log(`[VN DEBUG] WorldTravelTakeover: ${message}`, data || '');
        } catch {
            // no-op
        }
    };
    try {
        if (typeof window !== 'undefined') window.__VN_TRAVEL_DEBUG = [];
    } catch {
        // no-op
    }
    const round = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Number(numeric.toFixed(3)) : null;
    };
    const summarizeRect = (rect) => {
        if (!rect) return null;
        const x = round(rect.x ?? rect.left);
        const y = round(rect.y ?? rect.top);
        const width = round(rect.width);
        const height = round(rect.height);
        return {
            x,
            y,
            width,
            height,
            right: round(rect.right ?? (x + width)),
            bottom: round(rect.bottom ?? (y + height))
        };
    };
    const objectLabel = (object) => {
        if (!object) return null;
        return object.label || object.name || object.constructor?.name || 'DisplayObject';
    };
    const pointSummary = (point) => point
        ? { x: round(point.x), y: round(point.y) }
        : null;
    const boundsSummary = (object, local = false) => {
        if (!object) return null;
        try {
            const bounds = local && typeof object.getLocalBounds === 'function'
                ? object.getLocalBounds()
                : (typeof object.getBounds === 'function' ? object.getBounds() : null);
            return summarizeRect(bounds);
        } catch (error) {
            return { error: error?.message || String(error) };
        }
    };
    const displaySummary = (object) => {
        if (!object) return null;
        return {
            label: objectLabel(object),
            type: object.constructor?.name || null,
            parent: objectLabel(object.parent),
            children: Array.isArray(object.children) ? object.children.length : null,
            visible: object.visible ?? null,
            renderable: object.renderable ?? null,
            destroyed: object.destroyed ?? null,
            alpha: round(object.alpha),
            worldAlpha: round(object.worldAlpha),
            zIndex: round(object.zIndex),
            position: pointSummary(object.position),
            scale: pointSummary(object.scale),
            pivot: pointSummary(object.pivot),
            mask: objectLabel(object.mask),
            bounds: boundsSummary(object),
            localBounds: boundsSummary(object, true)
        };
    };
    const parentChainSummary = (object) => {
        const chain = [];
        let current = object || null;
        for (let depth = 0; current && depth < 12; depth += 1) {
            chain.push({
                depth,
                label: objectLabel(current),
                type: current.constructor?.name || null,
                visible: current.visible ?? null,
                renderable: current.renderable ?? null,
                alpha: round(current.alpha),
                worldAlpha: round(current.worldAlpha),
                zIndex: round(current.zIndex),
                children: Array.isArray(current.children) ? current.children.length : null
            });
            current = current.parent || null;
        }
        return chain;
    };
    const childOrderSummary = (object) => {
        if (!object?.children) return null;
        return object.children.slice(0, 30).map((child, index) => ({
            index,
            label: objectLabel(child),
            type: child.constructor?.name || null,
            zIndex: round(child.zIndex),
            visible: child.visible ?? null,
            renderable: child.renderable ?? null,
            alpha: round(child.alpha),
            worldAlpha: round(child.worldAlpha),
            children: Array.isArray(child.children) ? child.children.length : null,
            mask: objectLabel(child.mask)
        }));
    };
    const elementSummary = (element) => {
        if (!element) return null;
        let style = null;
        try {
            style = typeof window !== 'undefined' && window.getComputedStyle
                ? window.getComputedStyle(element)
                : null;
        } catch {
            style = null;
        }
        return {
            tag: String(element.tagName || '').toLowerCase(),
            id: element.id || null,
            className: String(element.className || '').slice(0, 160),
            rect: summarizeRect(element.getBoundingClientRect?.()),
            zIndex: style?.zIndex || null,
            display: style?.display || null,
            visibility: style?.visibility || null,
            opacity: style?.opacity || null,
            position: style?.position || null,
            pointerEvents: style?.pointerEvents || null,
            transform: style?.transform || null
        };
    };
    const domStackSummary = (canvas) => {
        if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
        const rect = canvas?.getBoundingClientRect?.();
        const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
        const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
        const x = rect ? rect.left + (rect.width * 0.5) : (fallbackWidth * 0.5);
        const y = rect ? rect.top + (rect.height * 0.5) : (fallbackHeight * 0.5);
        return document.elementsFromPoint(x, y).slice(0, 12).map(elementSummary);
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeInCubic = (t) => t * t * t;
    const easeInOutSine = (t) => 0.5 - (Math.cos(Math.PI * t) / 2);
    const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

    const parseCssRgb = (value, fallback = [255, 255, 255]) => {
        const text = String(value || '').trim();
        if (!text) return fallback;
        const rgbMatch = text.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map((part) => clampChannel(part.trim()));
            if (parts.length >= 3) return parts.slice(0, 3);
        }
        if (text.includes(',')) {
            const parts = text.split(',').map((part) => clampChannel(part.trim()));
            if (parts.length >= 3) return parts.slice(0, 3);
        }
        if (text.startsWith('#')) {
            const hex = text.slice(1);
            if (hex.length === 3) {
                return [
                    clampChannel(parseInt(`${hex[0]}${hex[0]}`, 16)),
                    clampChannel(parseInt(`${hex[1]}${hex[1]}`, 16)),
                    clampChannel(parseInt(`${hex[2]}${hex[2]}`, 16))
                ];
            }
            if (hex.length >= 6) {
                return [
                    clampChannel(parseInt(hex.slice(0, 2), 16)),
                    clampChannel(parseInt(hex.slice(2, 4), 16)),
                    clampChannel(parseInt(hex.slice(4, 6), 16))
                ];
            }
        }
        return fallback;
    };

    const rgbToHexNum = (rgb) => {
        const parts = Array.isArray(rgb) ? rgb : [255, 255, 255];
        return (clampChannel(parts[0]) << 16) + (clampChannel(parts[1]) << 8) + clampChannel(parts[2]);
    };

    const mixHex = (leftHex, rightHex, weight = 0.5) => {
        const t = clamp(Number(weight) || 0.5, 0, 1);
        const l = Number(leftHex || 0);
        const r = Number(rightHex || 0);
        const lr = (l >> 16) & 255;
        const lg = (l >> 8) & 255;
        const lb = l & 255;
        const rr = (r >> 16) & 255;
        const rg = (r >> 8) & 255;
        const rb = r & 255;
        return ((clampChannel(lr + ((rr - lr) * t))) << 16)
            + ((clampChannel(lg + ((rg - lg) * t))) << 8)
            + clampChannel(lb + ((rb - lb) * t));
    };

    const hashSeed = (text) => {
        let hash = 2166136261;
        const str = String(text || 'travel');
        for (let index = 0; index < str.length; index += 1) {
            hash ^= str.charCodeAt(index);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0) || 1;
    };

    const mulberry32 = (seed) => {
        let state = seed >>> 0;
        return () => {
            state += 0x6D2B79F5;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    let cleanupOverlay = () => {};
    let stopTicker = () => {};
    let overlayLayer = null;
    let cleanupDone = false;
    let phase = 'preparing';
    let phaseStart = 0;
    let ended = false;

    const finishSafely = (data = {}) => {
        travelDebug('finish requested', {
            data,
            phase,
            ended,
            cleanupDone,
            overlayChildren: overlayLayer?.children?.length ?? null
        });
        cleanupOverlay();
        try {
            bridge.takeover.finish(data);
        } catch (error) {
            try {
                bridge.takeover.abort('travel_takeover_finish_failed', { error: error?.message || String(error) });
            } catch {
                // no-op
            }
        }
    };

    const failSafely = (reason, data = {}) => {
        travelDebug('aborting', {
            reason,
            data,
            phase,
            ended,
            cleanupDone,
            hasPixi: !!PIXI,
            hasPayload: !!payload,
            hasMap: !!payload?.map,
            hasRoute: !!payload?.route,
            hasPixiLayer: !!pixiLayer
        });
        cleanupOverlay();
        try {
            bridge.takeover.abort(reason || 'travel_takeover_failed', data);
        } catch {
            finishSafely({ failed: true, reason: reason || 'travel_takeover_failed' });
        }
    };

    overlayLayer = pixiLayer
        || bridge.pixi?.getLayer?.('titles')
        || bridge.pixi?.getLayer?.('fx')
        || bridge.pixi?.getLayer?.('interceptActors');

    travelDebug('bootstrap', {
        interceptId: descriptor?.interceptId || descriptor?.id || null,
        checkpoint: context?.checkpoint || null,
        dialogueIndex: checkpointContext?.dialogueIndex ?? null,
        hasPixi: !!PIXI,
        hasPixiLayer: !!pixiLayer,
        hasOverlayLayer: !!overlayLayer,
        hasPayload: !!payload,
        hasMap: !!payload?.map,
        hasRoute: !!payload?.route,
        routeFrom: payload?.route?.from?.label || null,
        routeTo: payload?.route?.to?.label || null
    });

    if (!PIXI || !overlayLayer || !payload?.map || !payload?.route) {
        failSafely('missing_payload', { detail: 'PIXI, layer, map, or route payload is missing.' });
        return;
    }

    const logicalSize = bridge.pixi?.getLogicalSize?.() || { width: 1920, height: 1080 };
    const rendererScreen = pixiApp?.app?.screen || bridge.pixi?.getApp?.()?.app?.screen || null;
    const viewWidth = Number(rendererScreen?.width || logicalSize.width || 1920);
    const viewHeight = Number(rendererScreen?.height || logicalSize.height || 1080);

    const mapMeta = payload.map || {};
    const route = payload.route || {};
    const partySprites = Array.isArray(payload.partySprites) ? payload.partySprites : [];
    const rootStyles = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' && document?.documentElement)
        ? window.getComputedStyle(document.documentElement)
        : null;
    const cssVar = (name, fallback) => {
        if (!rootStyles) return fallback;
        const value = rootStyles.getPropertyValue(name);
        return String(value || '').trim() || fallback;
    };
    const themeFontMain = cssVar('--font-main', 'Noto Sans, Segoe UI, sans-serif');
    const themePrimaryRgb = parseCssRgb(cssVar('--color-primary-rgb', '0,243,255'), [0, 243, 255]);
    const themeBgRgb = parseCssRgb(cssVar('--bg-base-rgb', '5,5,5'), [5, 5, 5]);
    const themeTextRgb = parseCssRgb(cssVar('--text-main', '#e0fbff'), [224, 251, 255]);
    const themeAccentRgb = parseCssRgb(cssVar('--accent', '#ff00ff'), [255, 0, 255]);
    const themePrimaryHex = rgbToHexNum(themePrimaryRgb);
    const themeBgHex = rgbToHexNum(themeBgRgb);
    const themeTextHex = rgbToHexNum(themeTextRgb);
    const themeAccentHex = rgbToHexNum(themeAccentRgb);
    const themeStrokeHex = mixHex(themeBgHex, 0x000000, 0.35);
    const seed = hashSeed(payload.seed || `${route?.from?.label || ''}:${route?.to?.label || ''}`);
    const rng = mulberry32(seed);
    const playerStateAtStart = bridge.player?.getState?.() || {};
    const checkpointDialogueIndex = Number(checkpointContext?.dialogueIndex);
    const playerDialogueIndex = Number(playerStateAtStart.currentIndex);
    let manualCloseBaselineIndex = Number.isInteger(checkpointDialogueIndex)
        ? checkpointDialogueIndex
        : (Number.isInteger(playerDialogueIndex) ? playerDialogueIndex : null);
    let manualCloseRequested = false;

    const dimensions = mapMeta.dimensions || {};
    const mapWidth = Number(dimensions.width || 0);
    const mapHeight = Number(dimensions.height || 0);

    if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || mapWidth <= 0 || mapHeight <= 0) {
        failSafely('invalid_map_dimensions', { width: mapWidth, height: mapHeight });
        return;
    }

    const toImageY = (value) => -Number(value);
    const finiteNumberOrNull = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };
    const resolveRoutePoint = (source, fallback = { x: 0, y: 0 }) => {
        const imageX = finiteNumberOrNull(source?.imageX);
        const imageY = finiteNumberOrNull(source?.imageY);
        const worldX = finiteNumberOrNull(source?.x);
        const worldY = finiteNumberOrNull(source?.y);
        const fallbackX = finiteNumberOrNull(fallback?.x) ?? 0;
        const fallbackY = finiteNumberOrNull(fallback?.y) ?? 0;
        const convertedWorldY = worldY === null ? null : finiteNumberOrNull(toImageY(worldY));
        const resolvedX = (imageX !== null && (worldX === null || Math.abs(imageX - worldX) < 1))
            ? imageX
            : (worldX ?? imageX ?? fallbackX);
        const resolvedY = (imageY !== null && (convertedWorldY === null || Math.abs(imageY - convertedWorldY) < 1))
            ? imageY
            : (convertedWorldY ?? imageY ?? fallbackY);
        return {
            x: resolvedX,
            y: resolvedY
        };
    };
    const activeFromPoint = resolveRoutePoint(route?.from);
    const activeToPoint = resolveRoutePoint(route?.to);
    const fullFromPoint = resolveRoutePoint(route?.journeyFrom, activeFromPoint);
    const fullToPoint = resolveRoutePoint(route?.journeyTo, activeToPoint);

    if (
        !Number.isFinite(activeFromPoint.x) || !Number.isFinite(activeFromPoint.y)
        || !Number.isFinite(activeToPoint.x) || !Number.isFinite(activeToPoint.y)
        || !Number.isFinite(fullFromPoint.x) || !Number.isFinite(fullFromPoint.y)
        || !Number.isFinite(fullToPoint.x) || !Number.isFinite(fullToPoint.y)
    ) {
        failSafely('invalid_route_points');
        return;
    }

    const routePhase = String(route?.phase || 'direct').toLowerCase();
    const routeLabelFrom = String(route?.from?.label || route?.from?.anchor || 'Unknown Place').trim() || 'Unknown Place';
    const routeLabelTo = String(route?.to?.label || route?.to?.anchor || 'Unknown Place').trim() || 'Unknown Place';
    const journeyLabelFrom = String(route?.journeyFrom?.label || route?.journeyFrom?.anchor || routeLabelFrom).trim() || routeLabelFrom;
    const journeyLabelTo = String(route?.journeyTo?.label || route?.journeyTo?.anchor || routeLabelTo).trim() || routeLabelTo;
    const startProgress = clamp(Number(route?.startProgress ?? 0), 0, 1);
    const endProgress = clamp(Number(route?.endProgress ?? 1), 0, 1);
    const viaLabel = String(route?.via?.label || route?.via?.anchor || '').trim();
    const viaProgress = clamp(Number(route?.via?.progress ?? endProgress), 0, 1);
    const hasViaMarker = !!viaLabel
        && viaProgress > 0.02
        && viaProgress < 0.98
        && viaLabel !== journeyLabelFrom
        && viaLabel !== journeyLabelTo;

    const contentRoot = new PIXI.Container();
    contentRoot.sortableChildren = true;
    contentRoot.alpha = 0;
    contentRoot.zIndex = 5000;
    contentRoot.eventMode = 'none';
    contentRoot.interactiveChildren = false;
    overlayLayer.sortableChildren = true;
    overlayLayer.addChild(contentRoot);

    const panelMask = new PIXI.Graphics();
    panelMask.label = 'WorldTravelTakeoverMask';
    contentRoot.mask = panelMask;
    contentRoot.addChild(panelMask);

    cleanupOverlay = () => {
        if (cleanupDone) return;
        travelDebug('cleanup overlay', {
            phase,
            ended,
            contentChildren: contentRoot.children?.length ?? null,
            overlayChildrenBefore: overlayLayer.children?.length ?? null
        });
        logVisibilitySnapshot('cleanup-before-destroy', { force: true });
        cleanupDone = true;
        try {
            stopTicker();
            if (contentRoot.parent) contentRoot.parent.removeChild(contentRoot);
            contentRoot.destroy({ children: true });
        } catch {
            // no-op
        }
    };
    bridge.lifecycle.onDispose(() => {
        travelDebug('lifecycle dispose received', {
            phase,
            ended,
            cleanupDone
        });
        cleanupOverlay();
    });

    const backdrop = new PIXI.Graphics();
    backdrop.rect(0, 0, viewWidth, viewHeight);
    backdrop.fill({
        color: themeBgHex,
        alpha: 0.12
    });
    contentRoot.addChild(backdrop);

    const mapViewport = new PIXI.Container();
    mapViewport.sortableChildren = true;
    contentRoot.addChild(mapViewport);

    const vignette = new PIXI.Graphics();
    vignette.rect(0, 0, viewWidth, viewHeight);
    vignette.fill({ color: themeBgHex, alpha: 0.08 });
    vignette.zIndex = 50;
    contentRoot.addChild(vignette);

    const mapLayer = new PIXI.Container();
    const routeLayer = new PIXI.Container();
    const markerLayer = new PIXI.Container();
    const actorLayer = new PIXI.Container();
    routeLayer.zIndex = 10;
    actorLayer.zIndex = 30;
    markerLayer.zIndex = 40;
    actorLayer.sortableChildren = true;
    mapViewport.addChild(mapLayer, routeLayer, markerLayer, actorLayer);

    const textLayer = new PIXI.Container();
    textLayer.zIndex = 60;
    contentRoot.addChild(textLayer);

    const routeTitle = (() => {
        if (routePhase === 'arrival') return `Arriving at ${journeyLabelTo}`;
        if (routePhase === 'departure' || routePhase === 'progress') return `On the road to ${journeyLabelTo}`;
        return `Traveling from ${journeyLabelFrom} to ${journeyLabelTo}`;
    })();

    const titleText = new PIXI.Text({
        text: routeTitle,
        style: {
            fontFamily: themeFontMain,
            fontSize: 34,
            fontWeight: '700',
            fill: themeTextHex,
            stroke: { color: themeStrokeHex, width: 4 },
            wordWrap: true,
            wordWrapWidth: Math.max(420, viewWidth - 160),
            align: 'center'
        }
    });
    titleText.anchor.set(0.5, 0);
    titleText.position.set(viewWidth / 2, 38);
    textLayer.addChild(titleText);

    const distanceKm = Number(route?.distanceKm);

    const dx = fullToPoint.x - fullFromPoint.x;
    const dy = fullToPoint.y - fullFromPoint.y;
    const routeMovesUp = dy < 0;
    const rawRouteDist = Math.sqrt((dx * dx) + (dy * dy));
    const routeSpanX = Math.max(Math.abs(dx), Math.max(220, mapWidth * 0.06));
    const routeSpanY = Math.max(Math.abs(dy), Math.max(160, mapHeight * 0.06));
    const scaleX = (viewWidth * 0.5) / routeSpanX;
    const scaleY = (viewHeight * 0.5) / routeSpanY;
    const coverScale = Math.max(viewWidth / mapWidth, viewHeight / mapHeight);
    const targetScale = clamp(Math.min(scaleX, scaleY), coverScale * 1.01, 6);

    const routeCenterX = (fullFromPoint.x + fullToPoint.x) * 0.5;
    const routeCenterY = (fullFromPoint.y + fullToPoint.y) * 0.5;

    let viewportX = (viewWidth * 0.5) - (routeCenterX * targetScale);
    let viewportY = (viewHeight * 0.5) - (routeCenterY * targetScale);

    const minViewportX = viewWidth - (mapWidth * targetScale);
    const minViewportY = viewHeight - (mapHeight * targetScale);
    viewportX = clamp(viewportX, minViewportX, 0);
    viewportY = clamp(viewportY, minViewportY, 0);

    mapViewport.scale.set(targetScale);
    mapViewport.position.set(viewportX, viewportY);

    const worldVisibleBounds = {
        left: clamp((0 - viewportX) / targetScale, 0, mapWidth),
        top: clamp((0 - viewportY) / targetScale, 0, mapHeight),
        right: clamp((viewWidth - viewportX) / targetScale, 0, mapWidth),
        bottom: clamp((viewHeight - viewportY) / targetScale, 0, mapHeight)
    };
    const visibilityDebugLogged = new Set();
    const logVisibilitySnapshot = (label, extra = {}) => {
        try {
            const key = `${label}:${phase}`;
            if (visibilityDebugLogged.has(key) && !extra.force) return;
            visibilityDebugLogged.add(key);

            const appRoot = pixiApp || bridge.pixi?.getApp?.() || {};
            const app = appRoot.app || null;
            const canvas = app?.canvas || (typeof document !== 'undefined' ? document.getElementById('vn-canvas') : null);
            const gameContainer = canvas?.parentElement || (typeof document !== 'undefined' ? document.getElementById('game-container') : null);
            const screen = app?.screen
                ? { width: round(app.screen.width), height: round(app.screen.height) }
                : null;
            const contentBounds = boundsSummary(contentRoot);
            const maskBounds = boundsSummary(panelMask);
            const boundsHitScreen = contentBounds && screen
                ? contentBounds.right > 0
                    && contentBounds.bottom > 0
                    && contentBounds.x < screen.width
                    && contentBounds.y < screen.height
                : null;

            travelDebug('visibility snapshot', {
                label,
                phase,
                extra,
                layerSelection: {
                    overlayLabel: objectLabel(overlayLayer),
                    overlayIsProvidedPixiLayer: overlayLayer === pixiLayer,
                    overlayIsTitles: overlayLayer === bridge.pixi?.getLayer?.('titles'),
                    overlayIsFx: overlayLayer === bridge.pixi?.getLayer?.('fx'),
                    overlayIsInterceptActors: overlayLayer === bridge.pixi?.getLayer?.('interceptActors')
                },
                renderer: {
                    screen,
                    resolution: round(app?.renderer?.resolution),
                    canvas: elementSummary(canvas),
                    gameContainer: elementSummary(gameContainer),
                    domStackAtCanvasCenter: domStackSummary(canvas)
                },
                layout: {
                    viewWidth,
                    viewHeight,
                    mapWidth,
                    mapHeight,
                    targetScale: round(targetScale),
                    viewportX: round(viewportX),
                    viewportY: round(viewportY),
                    routeCenter: { x: round(routeCenterX), y: round(routeCenterY) },
                    activeFromPoint: { x: round(activeFromPoint.x), y: round(activeFromPoint.y) },
                    activeToPoint: { x: round(activeToPoint.x), y: round(activeToPoint.y) },
                    worldVisibleBounds
                },
                displayObjects: {
                    stage: displaySummary(app?.stage),
                    viewport: displaySummary(appRoot.viewport),
                    world: displaySummary(appRoot.world),
                    overlayLayer: displaySummary(overlayLayer),
                    contentRoot: displaySummary(contentRoot),
                    panelMask: displaySummary(panelMask),
                    backdrop: displaySummary(backdrop),
                    mapViewport: displaySummary(mapViewport),
                    mapLayer: displaySummary(mapLayer),
                    routeLayer: displaySummary(routeLayer),
                    markerLayer: displaySummary(markerLayer),
                    actorLayer: displaySummary(actorLayer),
                    textLayer: displaySummary(textLayer)
                },
                visibilityVerdictInputs: {
                    boundsHitScreen,
                    contentBounds,
                    maskBounds,
                    contentHasParent: !!contentRoot.parent,
                    maskHasParent: !!panelMask.parent,
                    contentVisible: contentRoot.visible,
                    contentRenderable: contentRoot.renderable,
                    contentAlpha: round(contentRoot.alpha),
                    contentWorldAlpha: round(contentRoot.worldAlpha),
                    overlayVisible: overlayLayer.visible,
                    overlayRenderable: overlayLayer.renderable,
                    overlayAlpha: round(overlayLayer.alpha),
                    overlayWorldAlpha: round(overlayLayer.worldAlpha)
                },
                parentChains: {
                    contentRoot: parentChainSummary(contentRoot),
                    panelMask: parentChainSummary(panelMask),
                    overlayLayer: parentChainSummary(overlayLayer)
                },
                childOrders: {
                    stage: childOrderSummary(app?.stage),
                    viewport: childOrderSummary(appRoot.viewport),
                    world: childOrderSummary(appRoot.world),
                    overlayLayer: childOrderSummary(overlayLayer),
                    contentRoot: childOrderSummary(contentRoot)
                }
            });
        } catch (error) {
            travelDebug('visibility snapshot failed', {
                label,
                error: error?.message || String(error)
            });
        }
    };
    const scheduleVisibilitySnapshot = (label) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => logVisibilitySnapshot(label, { force: true }));
            return;
        }
        if (typeof setTimeout === 'function') {
            setTimeout(() => logVisibilitySnapshot(label, { force: true }), 0);
        }
    };
    logVisibilitySnapshot('layout-ready');

    const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(mapWidth, mapHeight) / 512)));

    const chooseTilePlan = () => {
        const planForZoom = (zoomLevel) => {
            const levelScale = Math.pow(2, zoomLevel - maxZoom);
            const worldPerTile = 512 / Math.max(levelScale, 0.00001);
            const left = Math.floor(worldVisibleBounds.left / worldPerTile);
            const right = Math.floor((worldVisibleBounds.right - 1) / worldPerTile);
            const top = Math.floor(worldVisibleBounds.top / worldPerTile);
            const bottom = Math.floor((worldVisibleBounds.bottom - 1) / worldPerTile);
            const limit = Math.max(1, Math.pow(2, zoomLevel));

            const tiles = [];
            for (let tileY = top; tileY <= bottom; tileY += 1) {
                for (let tileX = left; tileX <= right; tileX += 1) {
                    if (tileX < 0 || tileY < 0 || tileX >= limit || tileY >= limit) continue;
                    tiles.push({
                        x: tileX,
                        y: tileY,
                        worldX: tileX * worldPerTile,
                        worldY: tileY * worldPerTile,
                        worldPerTile
                    });
                }
            }
            return {
                zoomLevel,
                worldPerTile,
                tiles
            };
        };

        let zoomLevel = clamp(Math.round(maxZoom + Math.log2(Math.max(targetScale, 0.001))), 0, maxZoom);
        let plan = planForZoom(zoomLevel);
        while (plan.tiles.length > 120 && zoomLevel > 0) {
            zoomLevel -= 1;
            plan = planForZoom(zoomLevel);
        }
        return plan;
    };

    const journeyCurve = (() => {
        const midpoint = {
            x: (fullFromPoint.x + fullToPoint.x) * 0.5,
            y: (fullFromPoint.y + fullToPoint.y) * 0.5
        };
        const length = Math.max(1, rawRouteDist);
        const normal = {
            x: -dy / length,
            y: dx / length
        };
        const curvature = clamp(length * 0.22, 60, 260);
        const direction = rng() > 0.5 ? 1 : -1;

        return {
            p0: fullFromPoint,
            p1: {
                x: midpoint.x + (normal.x * curvature * direction),
                y: midpoint.y + (normal.y * curvature * direction)
            },
            p2: fullToPoint
        };
    })();

    const pointOnJourneyCurve = (t) => {
        const u = 1 - t;
        const p0 = journeyCurve.p0;
        const p1 = journeyCurve.p1;
        const p2 = journeyCurve.p2;
        return {
            x: (u * u * p0.x) + (2 * u * t * p1.x) + (t * t * p2.x),
            y: (u * u * p0.y) + (2 * u * t * p1.y) + (t * t * p2.y)
        };
    };

    const pointOnActiveCurve = (t) => {
        const clamped = clamp(t, 0, 1);
        const journeyT = startProgress + ((endProgress - startProgress) * clamped);
        return pointOnJourneyCurve(journeyT);
    };

    const drawProgressArc = (graphics, tStart, tEnd, style) => {
        const start = clamp(Math.min(tStart, tEnd), 0, 1);
        const end = clamp(Math.max(tStart, tEnd), 0, 1);
        const sampleCount = Math.max(10, Math.ceil(48 * Math.abs(end - start)));
        for (let index = 0; index <= sampleCount; index += 1) {
            const t = start + ((end - start) * (index / sampleCount));
            const point = pointOnJourneyCurve(t);
            if (index === 0) {
                graphics.moveTo(point.x, point.y);
            } else {
                graphics.lineTo(point.x, point.y);
            }
        }
        graphics.stroke(style);
    };

    const drawRoute = () => {
        const fullGlowColor = mixHex(themePrimaryHex, themeTextHex, 0.45);
        const fullPathColor = mixHex(themePrimaryHex, themeTextHex, 0.25);
        const activeGlowColor = mixHex(themeAccentHex, themePrimaryHex, 0.4);
        const activePathColor = mixHex(themeAccentHex, themeTextHex, 0.2);
        const fullGlow = new PIXI.Graphics();
        drawProgressArc(fullGlow, 0, 1, { color: fullGlowColor, alpha: 0.24, width: 38, cap: 'round', join: 'round' });
        routeLayer.addChild(fullGlow);

        const fullPath = new PIXI.Graphics();
        drawProgressArc(fullPath, 0, 1, { color: fullPathColor, alpha: 0.5, width: 7, cap: 'round', join: 'round' });
        routeLayer.addChild(fullPath);

        const activeGlow = new PIXI.Graphics();
        drawProgressArc(activeGlow, startProgress, endProgress, { color: activeGlowColor, alpha: 0.5, width: 26, cap: 'round', join: 'round' });
        routeLayer.addChild(activeGlow);

        const activePath = new PIXI.Graphics();
        drawProgressArc(activePath, startProgress, endProgress, { color: activePathColor, alpha: 0.98, width: 11, cap: 'round', join: 'round' });
        routeLayer.addChild(activePath);
    };

    const createMarker = (point, label, colorA, colorB) => {
        const marker = new PIXI.Container();
        marker.position.set(point.x, point.y);

        const pulse = new PIXI.Graphics();
        pulse.circle(0, 0, 44);
        pulse.fill({ color: colorA, alpha: 0.18 });
        marker.addChild(pulse);

        const halo = new PIXI.Graphics();
        halo.circle(0, 0, 26);
        halo.fill({ color: colorA, alpha: 0.35 });
        marker.addChild(halo);

        const core = new PIXI.Graphics();
        core.circle(0, 0, 14);
        core.fill({ color: colorB, alpha: 0.98 });
        core.stroke({ color: themeStrokeHex, alpha: 0.85, width: 3 });
        marker.addChild(core);

        const markerText = new PIXI.Text({
            text: label,
            style: {
                fontFamily: themeFontMain,
                fontSize: 20,
                fontWeight: '700',
                fill: themeTextHex,
                stroke: { color: themeStrokeHex, width: 5 }
            }
        });
        markerText.anchor.set(0.5, 1);
        // Marker labels live inside the scaled map viewport. Counter-scale them
        // so long journeys do not reduce place names to unreadable map pixels.
        const inverseViewportScale = 1 / Math.max(0.001, targetScale);
        markerText.scale.set(inverseViewportScale);
        markerText.position.set(0, -38 * inverseViewportScale);
        marker.addChild(markerText);

        markerLayer.addChild(marker);
        return { marker, pulse };
    };

    const originMarker = createMarker(journeyCurve.p0, journeyLabelFrom, mixHex(themePrimaryHex, themeTextHex, 0.35), themePrimaryHex);
    const destinationMarker = createMarker(journeyCurve.p2, journeyLabelTo, mixHex(themeAccentHex, themeTextHex, 0.5), themeAccentHex);
    const viaMarker = hasViaMarker
        ? createMarker(
            pointOnJourneyCurve(viaProgress),
            viaLabel,
            mixHex(themePrimaryHex, themeAccentHex, 0.5),
            mixHex(themeAccentHex, themePrimaryHex, 0.35)
        )
        : null;

    const tilePathFromTemplate = (template, z, x, y) => String(template || '')
        .replace(/\{z\}/g, String(z))
        .replace(/\{x\}/g, String(x))
        .replace(/\{y\}/g, String(y));

    const normalizeProjectAssetPath = (assetPath) => {
        const clean = String(assetPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
        if (!clean) return '';
        if (/^(https?:|data:|blob:|project:\/\/|plugin:\/\/)/i.test(clean)) return clean;
        if (clean.startsWith('assets/') || clean.startsWith('plugins/')) return clean;
        if (clean.startsWith('sprites/')) return `assets/${clean}`;
        return clean;
    };

    const isGenericSpritePath = (spritePath) => {
        const lower = String(spritePath || '').replace(/\\/g, '/').toLowerCase();
        if (!lower) return true;
        return /(^|[\/_-])generic([\/_-]|$)/.test(lower)
            || /(^|[\/_-])generic[_-]?npc([\/_-]|$)/.test(lower)
            || /(^|[\/_-])npc([\/_-]|$)/.test(lower)
            || /(^|[\/_-])(villager|townsfolk|citizen|crowd|guard|merchant)([\/_-]|$)/.test(lower)
            || lower.includes('background_character');
    };

    const loadMapLayer = async () => {
        if (mapMeta.isTiled && mapMeta.tileTemplate) {
            const tilePlan = chooseTilePlan();
            const tasks = tilePlan.tiles.map(async (tile) => {
                const relPath = tilePathFromTemplate(mapMeta.tileTemplate, tilePlan.zoomLevel, tile.x, tile.y);
                try {
                    const texture = await bridge.assets.loadTexture(relPath, {
                        scope: 'project',
                        projectName: mapMeta.projectName
                    });
                    const sprite = new PIXI.Sprite(texture);
                    sprite.position.set(tile.worldX, tile.worldY);
                    sprite.width = tile.worldPerTile;
                    sprite.height = tile.worldPerTile;
                    mapLayer.addChild(sprite);
                } catch {
                    // Missing tile is tolerated.
                }
            });

            await Promise.all(tasks);
            if (mapLayer.children.length > 0) return;
        }

        if (mapMeta.mapImage) {
            const texture = await bridge.assets.loadTexture(mapMeta.mapImage, {
                scope: 'project',
                projectName: mapMeta.projectName
            });
            const sprite = new PIXI.Sprite(texture);
            sprite.position.set(0, 0);
            sprite.width = mapWidth;
            sprite.height = mapHeight;
            mapLayer.addChild(sprite);
            return;
        }

        throw new Error('No map source could be rendered.');
    };

    const loadDownscaledTexture = async (spritePath) => {
        const projectName = mapMeta.projectName;
        const normalizedSpritePath = normalizeProjectAssetPath(spritePath);
        const url = bridge.assets.url(normalizedSpritePath, {
            scope: 'project',
            projectName
        });

        if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();

                let imageBitmap = await createImageBitmap(blob);
                const maxSize = 640;
                const largestSide = Math.max(imageBitmap.width, imageBitmap.height);

                if (largestSide > maxSize) {
                    const targetScale = maxSize / largestSide;
                    const resizedWidth = Math.max(1, Math.round(imageBitmap.width * targetScale));
                    const resizedHeight = Math.max(1, Math.round(imageBitmap.height * targetScale));
                    imageBitmap.close?.();
                    imageBitmap = await createImageBitmap(blob, {
                        resizeWidth: resizedWidth,
                        resizeHeight: resizedHeight,
                        resizeQuality: 'high'
                    });
                }

                const texture = PIXI.Texture.from(imageBitmap);
                bridge.lifecycle.onDispose(() => {
                    try { imageBitmap.close?.(); } catch {}
                    try { texture.destroy(true); } catch {}
                });
                return texture;
            } catch {
                // Fallback below.
            }
        }

        return bridge.assets.loadTexture(normalizedSpritePath, {
            scope: 'project',
            projectName
        });
    };

    const actorStates = [];

    const buildFallbackToken = (index) => {
        const token = new PIXI.Container();
        const dot = new PIXI.Graphics();
        const palette = [
            themePrimaryHex,
            mixHex(themePrimaryHex, themeTextHex, 0.25),
            themeAccentHex,
            mixHex(themeAccentHex, themeTextHex, 0.25),
            mixHex(themePrimaryHex, themeAccentHex, 0.5)
        ];
        const color = palette[index % palette.length];
        dot.circle(0, 0, 18);
        dot.fill({ color, alpha: 0.96 });
        dot.stroke({ color: themeStrokeHex, alpha: 0.92, width: 3 });
        token.addChild(dot);
        return token;
    };

    const applyActorDepthOrder = () => {
        const total = Math.max(1, actorStates.length);
        for (const state of actorStates) {
            state.actor.zIndex = routeMovesUp
                ? 30 + state.index
                : 30 + (total - state.index);
        }
        actorLayer.sortChildren?.();
    };

    const getDestinationOffset = (state) => {
        if (actorStates.length <= 1) return { x: 0, y: 0 };
        const center = (actorStates.length - 1) * 0.5;
        const rank = state.index - center;
        const spacing = 26 / Math.max(0.001, targetScale);
        const verticalStagger = 8 / Math.max(0.001, targetScale);
        return {
            x: rank * spacing,
            y: Math.abs(rank) * verticalStagger
        };
    };

    const buildActors = async () => {
        const spriteEntries = partySprites.filter((entry) => entry && entry.spritePath && !isGenericSpritePath(entry.spritePath));
        const tokenEntries = partySprites.length > 0 ? partySprites : [{ name: 'Party', spritePath: null }];
        const loadedSprites = [];

        for (const entry of spriteEntries) {
            try {
                const texture = await loadDownscaledTexture(entry.spritePath);
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5, 1);
                loadedSprites.push({ entry, visual: sprite });
            } catch {
                // If at least one real sprite loads, failed sprite candidates are skipped.
            }
        }

        const source = loadedSprites.length > 0
            ? loadedSprites
            : tokenEntries.map((entry, index) => ({ entry, visual: buildFallbackToken(index) }));

        for (let index = 0; index < source.length; index += 1) {
            const { entry, visual } = source[index];
            const actor = new PIXI.Container();
            actor.zIndex = 30 + index;
            actor.sortableChildren = true;

            actor.addChild(visual);
            actorLayer.addChild(actor);

            actorStates.push({
                actor,
                visual,
                name: entry.name || `Companion ${index + 1}`,
                index,
                delayMs: index * 220,
                bobOffset: rng() * Math.PI * 2,
                wobbleOffset: rng() * Math.PI * 2,
                scaleJitter: 0.92 + (rng() * 0.16)
            });
        }

        // Choose a deterministic random leader and rotate chain order.
        if (actorStates.length > 1) {
            const leaderIndex = Math.floor(rng() * actorStates.length);
            const rotated = actorStates.slice(leaderIndex).concat(actorStates.slice(0, leaderIndex));
            actorStates.length = 0;
            rotated.forEach((state, index) => {
                state.index = index;
                state.delayMs = index * 220;
                actorStates.push(state);
            });
        }

        applyActorDepthOrder();
    };

    const routeDurationMs = clamp(1800 + (rawRouteDist * 0.18), 1800, 5200);
    const disperseDurationMs = clamp(Number(payload.disperseDurationMs ?? 650), 250, 1600);
    const revealMs = 550;
    const fadeOutMs = 500;
    const minimumManualCloseMs = clamp(Number(payload.manualCloseDelayMs ?? 1200), 0, 30000);
    const destinationHoldMs = clamp(Number(payload.arrivalHoldMs ?? payload.manualCloseDelayMs ?? 1200), 0, 30000);
    const maxRevealRadius = Math.sqrt((viewWidth * viewWidth) + (viewHeight * viewHeight));
    let firstTickLogged = false;
    let animationStartAt = 0;
    let currentRevealRadius = 1;
    let currentActorProgress = 0;
    let currentDisperseProgress = 0;
    let currentActorsSettled = false;
    let fadeStartRevealRadius = maxRevealRadius;
    let fadeStartActorProgress = 1;
    let fadeStartDisperseProgress = 1;
    let fadeStartActorsSettled = true;
    const updateRevealMask = (radius) => {
        currentRevealRadius = clamp(Number(radius) || 0, 0, maxRevealRadius);
        panelMask.clear();
        panelMask.circle(viewWidth * 0.5, viewHeight * 0.5, Math.max(1, currentRevealRadius));
        panelMask.fill({ color: 0xffffff, alpha: 1 });
    };

    const hasDialogueMoved = () => {
        const currentIndex = Number(bridge.player?.getState?.()?.currentIndex);
        if (!Number.isInteger(currentIndex)) return false;
        if (!Number.isInteger(manualCloseBaselineIndex)) {
            manualCloseBaselineIndex = currentIndex;
            return false;
        }
        return currentIndex !== manualCloseBaselineIndex;
    };

    const requestManualClose = (source, data = {}) => {
        if (ended || cleanupDone || phase === 'fade' || manualCloseRequested) return;
        manualCloseRequested = true;
        travelDebug('manual close requested', {
            source,
            phase,
            baselineIndex: manualCloseBaselineIndex,
            currentIndex: Number(bridge.player?.getState?.()?.currentIndex),
            ...data
        });
    };

    const onDialogueEnter = (event) => {
        const nextIndex = Number(event?.detail?.dialogueIndex ?? event?.detail?.sceneIndex);
        if (!Number.isInteger(nextIndex)) return;
        if (Number.isInteger(manualCloseBaselineIndex) && nextIndex === manualCloseBaselineIndex) return;
        requestManualClose('dialogue-enter-event', { nextIndex });
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('vn:dialogue-enter', onDialogueEnter);
        bridge.lifecycle.onDispose(() => {
            try { window.removeEventListener('vn:dialogue-enter', onDialogueEnter); } catch {}
        });
    }

    const beginFade = (tNow) => {
        if (phase === 'fade') return;
        const elapsedInPhase = tNow - phaseStart;
        fadeStartRevealRadius = Math.max(1, currentRevealRadius || maxRevealRadius);
        fadeStartActorProgress = currentActorProgress;
        fadeStartDisperseProgress = currentDisperseProgress;
        fadeStartActorsSettled = currentActorsSettled;
        travelDebug('circle fade-out begin', {
            fromPhase: phase,
            elapsedInPhase,
            fadeStartRevealRadius,
            fadeStartActorProgress,
            fadeStartDisperseProgress,
            manualCloseBaselineIndex,
            currentIndex: Number(bridge.player?.getState?.()?.currentIndex)
        });
        phase = 'fade';
        phaseStart = tNow;
        logVisibilitySnapshot('circle-fade-out-begin', { elapsedInPhase: round(elapsedInPhase), force: true });
    };

    const updateActors = (progress, tNow, options = {}) => {
        const clampedProgress = clamp(progress, 0, 1);
        const settled = options.settled === true;
        const disperseProgress = clamp(Number(options.disperseProgress ?? (settled ? 1 : 0)), 0, 1);
        currentActorProgress = clampedProgress;
        currentDisperseProgress = disperseProgress;
        currentActorsSettled = settled;
        const movementBlend = settled
            ? 0
            : (1 - disperseProgress);

        for (const state of actorStates) {
            // Stagger route progress so companions follow the leader instead of
            // occupying the same point for the entire travel animation.
            const followLag = Math.min(0.08 * state.index, 0.72);
            const localProgress = settled
                ? 1
                : clamp((clampedProgress - followLag) / Math.max(0.001, 1 - followLag), 0, 1);
            const position = pointOnActiveCurve(localProgress);
            const finalOffset = getDestinationOffset(state);
            const destinationOffset = {
                x: finalOffset.x * disperseProgress,
                y: finalOffset.y * disperseProgress
            };

            const bob = movementBlend * Math.sin((tNow * 0.007) + state.bobOffset) * (7 / Math.max(0.001, targetScale));
            const wobble = movementBlend * Math.sin((tNow * 0.01) + state.wobbleOffset) * 0.12;
            const hop = movementBlend * Math.abs(Math.sin((tNow * 0.02) + state.wobbleOffset)) * (4 / Math.max(0.001, targetScale));

            const targetScreenHeight = 118;
            const worldHeight = targetScreenHeight / Math.max(0.001, targetScale);

            state.actor.position.set(
                position.x + destinationOffset.x + wobble,
                position.y + destinationOffset.y + bob - hop
            );

            if (state.visual instanceof PIXI.Sprite) {
                const textureHeight = Math.max(1, Number(state.visual.texture?.height || 1));
                const baseScale = worldHeight / textureHeight;
                state.visual.rotation = movementBlend * Math.sin((tNow * 0.01) + state.wobbleOffset) * 0.06;
                const squash = 1 + (movementBlend * (Math.sin((tNow * 0.028) + state.bobOffset) * 0.06));
                state.visual.scale.set(baseScale * squash, baseScale / Math.max(0.75, squash));
            } else {
                const tokenScale = worldHeight / 120;
                state.visual.scale.set(tokenScale, tokenScale);
            }
        }
    };

    const onTick = () => {
        if (ended || cleanupDone || contentRoot.destroyed) return;

        const tNow = now();

        const pulseScale = 1 + (Math.sin(tNow * 0.004) * 0.16);
        if (originMarker?.pulse?.scale) originMarker.pulse.scale.set(pulseScale);
        if (destinationMarker?.pulse?.scale) {
            destinationMarker.pulse.scale.set(1 + (Math.sin((tNow * 0.004) + 1.7) * 0.16));
        }
        if (viaMarker?.pulse?.scale) {
            viaMarker.pulse.scale.set(1 + (Math.sin((tNow * 0.004) + 0.85) * 0.12));
        }
        contentRoot.alpha = 1;
        if (!firstTickLogged) {
            firstTickLogged = true;
            logVisibilitySnapshot('first-tick', { phase, tNow: round(tNow), force: true });
        }

        if (hasDialogueMoved()) {
            requestManualClose('dialogue-index-poll');
        }
        const elapsedSinceAnimationStart = animationStartAt ? tNow - animationStartAt : 0;
        const canManualClose = manualCloseRequested && elapsedSinceAnimationStart >= minimumManualCloseMs;
        if (phase !== 'fade' && canManualClose) {
            travelDebug('manual close fade started', {
                phase,
                elapsedSinceAnimationStart,
                minimumManualCloseMs
            });
            beginFade(tNow);
        }

        const elapsed = tNow - phaseStart;

        if (phase === 'reveal') {
            const t = clamp(elapsed / revealMs, 0, 1);
            updateRevealMask(easeOutCubic(t) * maxRevealRadius);
            updateActors(0, tNow);
            if (t >= 1) {
                travelDebug('circle fade-in complete', {
                    elapsed,
                    maxRevealRadius,
                    contentAlpha: contentRoot.alpha,
                    overlayChildren: overlayLayer.children?.length ?? null
                });
                logVisibilitySnapshot('circle-fade-in-complete', { elapsed: round(elapsed), force: true });
                phase = 'travel';
                phaseStart = tNow;
            }
            return;
        }

        if (phase === 'travel') {
            updateRevealMask(maxRevealRadius);
            const t = clamp(elapsed / routeDurationMs, 0, 1);
            updateActors(easeInOutSine(t), tNow, { settled: false, disperseProgress: 0 });
            if (t >= 1) {
                travelDebug('travel motion complete', {
                    elapsed,
                    routeDurationMs
                });
                logVisibilitySnapshot('travel-motion-complete', { elapsed: round(elapsed), force: true });
                phase = 'disperse';
                phaseStart = tNow;
            }
            return;
        }

        if (phase === 'disperse') {
            updateRevealMask(maxRevealRadius);
            const t = clamp(elapsed / disperseDurationMs, 0, 1);
            updateActors(1, tNow, { settled: false, disperseProgress: easeInOutSine(t) });
            if (t >= 1) {
                travelDebug('destination hold begin', {
                    elapsed,
                    disperseDurationMs,
                    minimumManualCloseMs,
                    destinationHoldMs,
                    baselineIndex: manualCloseBaselineIndex,
                    currentIndex: Number(bridge.player?.getState?.()?.currentIndex)
                });
                logVisibilitySnapshot('destination-hold-begin', { elapsed: round(elapsed), force: true });
                phase = 'hold';
                phaseStart = tNow;
            }
            return;
        }

        if (phase === 'hold') {
            updateRevealMask(maxRevealRadius);
            updateActors(1, tNow, { settled: true, disperseProgress: 1 });
            if (elapsed >= destinationHoldMs) {
                travelDebug('destination hold complete', {
                    elapsed,
                    destinationHoldMs
                });
                beginFade(tNow);
            }
            return;
        }

        if (phase === 'fade') {
            const t = clamp(elapsed / fadeOutMs, 0, 1);
            updateRevealMask((1 - easeInCubic(t)) * fadeStartRevealRadius);
            updateActors(fadeStartActorProgress, tNow, {
                settled: fadeStartActorsSettled,
                disperseProgress: fadeStartDisperseProgress
            });
            if (elapsed >= fadeOutMs) {
                travelDebug('circle fade-out complete', {
                    elapsed,
                    fadeOutMs,
                    overlayChildren: overlayLayer.children?.length ?? null
                });
                logVisibilitySnapshot('circle-fade-out-complete', { elapsed: round(elapsed), force: true });
                ended = true;
                finishSafely({
                    traveled: true,
                    from: journeyLabelFrom,
                    to: journeyLabelTo,
                    distanceKm: Number.isFinite(distanceKm) ? distanceKm : null
                });
            }
        }
    };

    (async () => {
        try {
            travelDebug('render start', {
                mapWidth,
                mapHeight,
                isTiled: !!mapMeta.isTiled,
                hasTileTemplate: !!mapMeta.tileTemplate,
                hasMapImage: !!mapMeta.mapImage,
                partySpriteCount: partySprites.length,
                targetScale
            });
            drawRoute();
            await loadMapLayer();
            travelDebug('map layer loaded', {
                mapChildren: mapLayer.children.length,
                routeChildren: routeLayer.children.length
            });
            logVisibilitySnapshot('after-map-layer-loaded', { force: true });
            await buildActors();
            travelDebug('actors built', {
                actorCount: actorStates.length,
                actorNames: actorStates.map((state) => state.name)
            });
            logVisibilitySnapshot('after-actors-built', { force: true });

            bridge.lifecycle.onDispose(() => {
                ended = true;
            });

            if (hasDialogueMoved()) {
                ended = true;
                finishSafely({ skipped: true, reason: 'dialogue_moved_before_travel_ready' });
                return;
            }

            phase = 'reveal';
            phaseStart = now();
            animationStartAt = phaseStart;
            contentRoot.alpha = 1;
            updateRevealMask(1);
            updateActors(0, phaseStart);
            logVisibilitySnapshot('animation-start-ready', { force: true });
            travelDebug('circle fade-in begin', {
                phase,
                phaseStart,
                revealMs,
                maxRevealRadius,
                baselineIndex: manualCloseBaselineIndex,
                currentIndex: Number(bridge.player?.getState?.()?.currentIndex),
                overlayChildren: overlayLayer.children?.length ?? null
            });
            const tickerStop = bridge.pixi.onTick(onTick, 30);
            stopTicker = tickerStop || (() => {});
            scheduleVisibilitySnapshot('post-render-frame');
            travelDebug('animation started', {
                phase,
                contentChildren: contentRoot.children.length,
                overlayChildren: overlayLayer.children?.length ?? null,
                tickerRegistered: !!tickerStop
            });
        } catch (error) {
            failSafely('travel_takeover_render_failed', { error: error?.message || String(error) });
        }
    })();
})();
