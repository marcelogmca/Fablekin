(async () => {
    const PIXI = context?.PIXI;
    const layer = context?.pixiLayer || bridge?.takeover?.getLayer?.();
    const app = context?.pixiApp?.app;
    const payload = context?.payload || {};

    if (!PIXI || !layer || !app) {
        bridge?.takeover?.finish?.({ reason: 'pixi_unavailable' });
        return;
    }

    const logicalWidth = Number(context?.pixiApp?.LOGICAL_WIDTH) || 1280;
    const logicalHeight = Number(context?.pixiApp?.LOGICAL_HEIGHT) || 720;
    const stanzas = Array.isArray(payload.stanzas) && payload.stanzas.length > 0
        ? payload.stanzas
        : [{ lines: ['The road remembers.', 'The curtain rises.', 'The stars lean close.', 'The story goes on.'] }];
    const introVfxEnabled = payload.vfxEnabled === true;
    const introVfxIds = new Set(Array.isArray(payload.availableIntroVfxIds)
        ? payload.availableIntroVfxIds
        : ['none', 'fog', 'clouds', 'desert-dust', 'snow', 'embers', 'magic-dust', 'leaves', 'godray', 'vignette', 'bloom']);
    const introStanzaVfxSequence = Array.isArray(payload.introStanzaVfxSequence)
        ? payload.introStanzaVfxSequence
        : [];
    const maximumDurationSeconds = Math.max(10, Number(payload.maximumDurationSeconds) || 60);
    const maximumDurationMs = Math.max(1000, Number(payload.maximumDurationMs) || maximumDurationSeconds * 1000);
    const backgroundEntries = Array.isArray(payload.backgrounds) ? payload.backgrounds : [];
    const logPrefix = `[ArcCinematics:${payload.requestId || payload.arcId || 'unknown'}]`;
    function arcLog(event, data = null) {
        try {
            if (data === null || data === undefined) {
                console.info(`${logPrefix} ${event}`);
            } else {
                console.info(`${logPrefix} ${event}`, data);
            }
        } catch (_) { }
        try {
            bridge.log?.info?.(`${logPrefix} ${event}`, data || {});
        } catch (_) { }
    }
    const isGoodSpriteEntry = (entry) => {
        const text = `${entry?.name || ''} ${entry?.path || ''} ${entry?.image || ''} ${entry?.assetPath || ''}`.toLowerCase();
        return !text.includes('generic') && !text.includes('npc');
    };
    const isPlaceholderSpriteName = (name) => {
        const text = String(name || '').trim().toLowerCase();
        return !text || /^character\s+\d+$/.test(text) || text === 'unknown' || text === 'sprite';
    };
    const nameToIdentity = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.(png|webp|jpe?g|gif|avif)$/i, '')
        .replace(/[_-]+(neutral|default|happy|sad|angry|soft|serious|determined|smile|smiling|surprised|battle|combat|idle)$/i, '')
        .replace(/[^a-z0-9]+/g, '');
    const inferSpriteIdentity = (entry) => {
        const directName = isPlaceholderSpriteName(entry?.name || entry?.character)
            ? ''
            : nameToIdentity(entry?.name || entry?.character);
        if (directName) return directName;
        const rawPath = String(entry?.path || entry?.image || entry?.assetPath || '').replace(/\\/g, '/');
        const cleanPath = rawPath.split(/[?#]/)[0];
        const segments = cleanPath.split('/').map(segment => segment.trim()).filter(Boolean);
        const spritesIndex = segments.findIndex(segment => /^sprites?$/i.test(segment));
        if (spritesIndex >= 0 && segments[spritesIndex + 1]) {
            const fromSpriteDir = nameToIdentity(segments[spritesIndex + 1]);
            if (fromSpriteDir) return fromSpriteDir;
        }
        if (segments.length >= 2) {
            const fromParentDir = nameToIdentity(segments[segments.length - 2]);
            if (fromParentDir && fromParentDir !== 'assets' && fromParentDir !== 'characters') return fromParentDir;
        }
        return nameToIdentity(segments[segments.length - 1] || rawPath);
    };
    const spriteCharacterKey = (entry) => {
        const identity = inferSpriteIdentity(entry);
        if (identity) return `character:${identity}`;
        return `path:${String(entry?.path || entry?.image || entry?.assetPath || '').trim().toLowerCase()}`;
    };
    const dedupeSpriteEntries = (entries, maxItems = 2) => {
        const seen = new Set();
        const output = [];
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (!isGoodSpriteEntry(entry)) continue;
            const key = spriteCharacterKey(entry);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            output.push(entry);
            if (output.length >= maxItems) break;
        }
        return output;
    };
    const requestKeyFromName = (name) => `character:${nameToIdentity(name)}`;
    const stableUnit = (value) => {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash / 4294967296;
    };
    const globalSpriteEntries = payload.spriteCollageEnabled === true && Array.isArray(payload.sprites)
        ? dedupeSpriteEntries(payload.sprites, 8)
        : [];
    const globalSpritesByKey = new Map(globalSpriteEntries.map(entry => [spriteCharacterKey(entry), entry]));
    function spritesFromStanzaCharacterHints(stanza) {
        const names = [
            ...(Array.isArray(stanza?.characterBeats) ? stanza.characterBeats.map(beat => beat?.name || beat?.character) : []),
            ...(Array.isArray(stanza?.relevantCharacters) ? stanza.relevantCharacters : []),
            ...(Array.isArray(stanza?.characters) ? stanza.characters : [])
        ];
        return dedupeSpriteEntries(names.map(name => globalSpritesByKey.get(requestKeyFromName(name))).filter(Boolean), 2);
    }
    const stanzaSpriteEntries = stanzas.map((stanza, stanzaIndex) => {
        if (stanza?.suppressSprites === true) return [];
        const nativeEntries = dedupeSpriteEntries(stanza?.sprites, 2);
        if (nativeEntries.length > 0) return nativeEntries;
        const hintedEntries = spritesFromStanzaCharacterHints(stanza);
        if (hintedEntries.length > 0) return hintedEntries;
        if (globalSpriteEntries.length > 0) return [globalSpriteEntries[stanzaIndex % globalSpriteEntries.length]];
        return [];
    });
    const hasStanzaSpriteEntries = stanzaSpriteEntries.some(entries => entries.length > 0);
    const normalizeVfxBeat = (beat = {}) => {
        const rawId = typeof beat === 'string'
            ? beat
            : (beat?.id || beat?.effect || beat?.name || beat?.vfx || 'none');
        const id = String(rawId || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const intensity = String(beat?.intensity || '').trim().toLowerCase() === 'medium'
            ? 'medium'
            : 'subtle';
        return {
            id: introVfxIds.has(id) ? id : 'none',
            intensity
        };
    };
    const normalizeIntroStanzaVfxBeat = (beat = {}) => {
        const rawId = typeof beat === 'string'
            ? beat
            : (beat?.id || beat?.effect || beat?.name || beat?.vfx || 'none');
        const id = String(rawId || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const intensity = String(beat?.intensity || '').trim().toLowerCase() === 'medium'
            ? 'medium'
            : 'subtle';
        return {
            id: id.startsWith('intro-') ? id : 'none',
            intensity
        };
    };

    let finished = false;
    let startedAt = performance.now();
    let durationMs = maximumDurationMs;
    let timerId = null;
    let audioHandle = null;
    let audio = null;
    let audioBaseVolume = null;
    let activeVfxId = 'none';
    const startedVfxIds = new Set();
    let controlsVisibleBeforeIntro = null;
    const immersiveFallbackLocks = [];

    function getControlsVisibleSnapshot() {
        try {
            const settings = bridge.player?.getSettings?.();
            const value = settings?.interface?.show_controls;
            return typeof value === 'boolean' ? value : null;
        } catch (_) {
            return null;
        }
    }

    function engageImmersiveMode() {
        controlsVisibleBeforeIntro = getControlsVisibleSnapshot();
        let engaged = false;
        try {
            engaged = bridge.player?.ui?.setImmersive?.(true) === true;
        } catch (_) {
            engaged = false;
        }
        if (!engaged) {
            for (const hide of [
                () => bridge.player?.ui?.hideDialogue?.(),
                () => bridge.player?.ui?.hideControls?.(),
                () => bridge.player?.ui?.hideInput?.()
            ]) {
                try {
                    const lock = hide();
                    if (lock && typeof lock.release === 'function') immersiveFallbackLocks.push(lock);
                } catch (_) { }
            }
        }
        arcLog('immersive-engaged', {
            controlsVisibleBeforeIntro,
            viaSetImmersive: engaged,
            fallbackLocks: immersiveFallbackLocks.length
        });
    }

    function restoreImmersiveMode() {
        for (const lock of immersiveFallbackLocks.splice(0)) {
            try { lock.release?.(); } catch (_) { }
        }
        if (controlsVisibleBeforeIntro !== null) {
            try {
                bridge.player?.ui?.setImmersive?.(!controlsVisibleBeforeIntro);
            } catch (_) { }
        }
        arcLog('immersive-restored', { controlsVisibleBeforeIntro });
        controlsVisibleBeforeIntro = null;
    }

    engageImmersiveMode();
    if (bridge.audio?.suspendVN) {
        bridge.audio.suspendVN({ pause: true, mute: true });
    }
    bridge.actors?.hideNativeSprites?.(true);

    const root = new PIXI.Container();
    root.sortableChildren = true;
    layer.addChild(root);
    const introVfxController = window.__VFX?.intro?.createController?.({
        PIXI,
        gsap: window.gsap,
        root,
        app,
        logicalWidth,
        logicalHeight,
        debugLog: (...args) => {
            try { console.info(`${logPrefix} intro-controller`, ...args); } catch (_) { }
            try { bridge.log?.info?.(`${logPrefix} intro-controller`, { args }); } catch (_) { }
        },
    }) || null;
    arcLog('init', {
        stanzas: stanzas.length,
        vfxEnabled: introVfxEnabled,
        hasIntroVfxController: !!introVfxController,
        stanzaGlobalVfxSequence: introStanzaVfxSequence.map(entry => entry?.id || entry),
        atmosphericVfxBeats: stanzas.map(stanza => stanza?.vfxBeat?.id || 'none')
    });

    function requestPixiResize() {
        try { context?.pixiApp?._onResize?.(); } catch (_) { }
    }

    function applyRootCoverTransform() {
        const screenWidth = Number(app.screen?.width) || Number(app.renderer?.width) || logicalWidth;
        const screenHeight = Number(app.screen?.height) || Number(app.renderer?.height) || logicalHeight;
        const scale = Math.max(screenWidth / logicalWidth, screenHeight / logicalHeight);
        root.pivot.set(logicalWidth / 2, logicalHeight / 2);
        root.position.set(screenWidth / 2, screenHeight / 2);
        root.scale.set(scale);
        root.hitArea = new PIXI.Rectangle(0, 0, logicalWidth, logicalHeight);
    }
    requestPixiResize();
    applyRootCoverTransform();
    requestAnimationFrame(() => {
        requestPixiResize();
        applyRootCoverTransform();
        requestAnimationFrame(() => {
            requestPixiResize();
            applyRootCoverTransform();
        });
    });
    const offResize = bridge.surface?.onResize?.(() => applyRootCoverTransform(), { immediate: false }) || null;

    const fallbackBg = new PIXI.Graphics();
    fallbackBg.beginFill(0x000000, 1);
    fallbackBg.drawRect(0, 0, logicalWidth, logicalHeight);
    fallbackBg.endFill();
    fallbackBg.zIndex = 0;
    root.addChild(fallbackBg);

    const backgroundLayer = new PIXI.Container();
    backgroundLayer.zIndex = 5;
    root.addChild(backgroundLayer);

    const spriteLayer = new PIXI.Container();
    spriteLayer.zIndex = 15;
    root.addChild(spriteLayer);

    const shade = new PIXI.Graphics();
    shade.beginFill(0x000000, 0.30);
    shade.drawRect(0, 0, logicalWidth, logicalHeight);
    shade.endFill();
    shade.zIndex = 20;
    root.addChild(shade);

    const textLayer = new PIXI.Container();
    textLayer.zIndex = 35;
    textLayer.sortableChildren = true;
    root.addChild(textLayer);

    const titleStyle = new PIXI.TextStyle({
        fontFamily: 'Georgia, Palatino Linotype, serif',
        fontSize: 42,
        fill: 0xfff2cc,
        letterSpacing: 1.5,
        dropShadow: true,
        dropShadowColor: '#000000',
        dropShadowBlur: 8,
        dropShadowDistance: 3
    });
    const hintStyle = new PIXI.TextStyle({
        fontFamily: 'Georgia, Palatino Linotype, serif',
        fontSize: 18,
        fill: 0xe8d9bd,
        align: 'center'
    });

    const titleText = new PIXI.Text(payload.title || 'Arc Cinematic', titleStyle);
    titleText.anchor.set(0.5, 0);
    titleText.x = logicalWidth / 2;
    titleText.y = logicalHeight * 0.08;
    titleText.zIndex = 35;
    root.addChild(titleText);

    const skipText = new PIXI.Text('Click to continue', hintStyle);
    skipText.anchor.set(0.5, 1);
    skipText.x = logicalWidth / 2;
    skipText.y = logicalHeight - 22;
    skipText.alpha = 0.74;
    skipText.zIndex = 45;
    root.addChild(skipText);

    let paused = false;
    let pausedElapsedMs = 0;
    let totalPausedMs = 0;
    let playbackStarted = false;

    const pauseButton = new PIXI.Container();
    pauseButton.label = 'Arc_Cinematic_PauseResume';
    pauseButton.x = 18;
    pauseButton.y = 18;
    pauseButton.zIndex = 70;
    pauseButton.eventMode = 'static';
    pauseButton.cursor = 'pointer';
    root.addChild(pauseButton);

    const pauseButtonBg = new PIXI.Graphics();
    const pauseButtonIcon = new PIXI.Graphics();
    pauseButton.addChild(pauseButtonBg);
    pauseButton.addChild(pauseButtonIcon);

    function drawPauseButton(hovered = false) {
        pauseButtonBg.clear();
        pauseButtonBg.beginFill(0x080c12, hovered ? 0.52 : 0.34);
        pauseButtonBg.lineStyle(1, 0xfff2cc, hovered ? 0.38 : 0.20);
        pauseButtonBg.drawRoundedRect(0, 0, 42, 42, 14);
        pauseButtonBg.endFill();

        pauseButtonIcon.clear();
        pauseButtonIcon.beginFill(0xfff2cc, hovered ? 0.92 : 0.76);
        if (paused) {
            pauseButtonIcon.moveTo(17, 13);
            pauseButtonIcon.lineTo(17, 29);
            pauseButtonIcon.lineTo(29, 21);
            pauseButtonIcon.lineTo(17, 13);
        } else {
            pauseButtonIcon.drawRoundedRect(15, 13, 4, 16, 2);
            pauseButtonIcon.drawRoundedRect(24, 13, 4, 16, 2);
        }
        pauseButtonIcon.endFill();
    }

    function getCinematicElapsed(now = performance.now()) {
        return paused
            ? pausedElapsedMs
            : Math.max(0, now - startedAt - totalPausedMs);
    }

    function pauseCinematic(reason = 'button') {
        if (!playbackStarted || paused || finished) return;
        const now = performance.now();
        pausedElapsedMs = getCinematicElapsed(now);
        paused = true;
        try { audio?.pause?.(); } catch (_) { }
        drawPauseButton();
        arcLog('pause', { reason, elapsedMs: Math.round(pausedElapsedMs) });
    }

    function resumeCinematic(reason = 'button') {
        if (!playbackStarted || !paused || finished) return;
        const now = performance.now();
        totalPausedMs = Math.max(0, now - startedAt - pausedElapsedMs);
        paused = false;
        if (audio) {
            try {
                const promise = audio.play?.();
                promise?.catch?.(() => {});
            } catch (_) { }
        }
        drawPauseButton();
        arcLog('resume', { reason, elapsedMs: Math.round(getCinematicElapsed(now)) });
    }

    function togglePause(reason = 'button') {
        if (paused) resumeCinematic(reason);
        else pauseCinematic(reason);
    }

    drawPauseButton(false);
    pauseButton.on('pointerover', () => drawPauseButton(true));
    pauseButton.on('pointerout', () => drawPauseButton(false));
    pauseButton.on('pointerdown', (event) => {
        event?.stopPropagation?.();
    });
    pauseButton.on('pointertap', (event) => {
        event?.stopPropagation?.();
        togglePause('button');
    });

    function fitCover(sprite) {
        const width = Number(sprite.texture?.width) || logicalWidth;
        const height = Number(sprite.texture?.height) || logicalHeight;
        const scale = Math.max(logicalWidth / width, logicalHeight / height);
        sprite.anchor.set(0.5);
        sprite.scale.set(scale);
        sprite.x = logicalWidth / 2;
        sprite.y = logicalHeight / 2;
    }

    async function loadTexture(path) {
        if (!path) return null;
        try {
            return await bridge.assets.loadTexture(path);
        } catch (error) {
            bridge.log?.warn?.('Arc cinematic texture failed to load', { path, error: error.message });
            return null;
        }
    }

    const backgroundSprites = [];
    for (const entry of backgroundEntries.slice(0, 8)) {
        const texture = await loadTexture(entry.path);
        if (!texture) continue;
        const sprite = new PIXI.Sprite(texture);
        fitCover(sprite);
        sprite.alpha = 0;
        sprite.zIndex = 5;
        sprite.__arcBaseScale = sprite.scale.x;
        backgroundLayer.addChild(sprite);
        backgroundSprites.push(sprite);
    }

    const characterSprites = [];
    const characterGroups = new Map();
    async function addCharacterSprite(entry, visualIndex, stanzaIndex = null, slotIndex = visualIndex, groupSize = 0) {
        const texture = await loadTexture(entry.path);
        if (!texture) return null;
        const sprite = new PIXI.Sprite(texture);
        const textureHeight = Number(texture.height) || 512;
        const groupKey = stanzaIndex === null ? 'fallback' : String(stanzaIndex);
        const characterKey = spriteCharacterKey(entry);
        const closeSeed = stableUnit(`${payload.requestId || payload.arcId || 'arc'}:${groupKey}:${characterKey}:${slotIndex}:close`);
        const isCloseUp = closeSeed < 0.75;
        const targetHeight = logicalHeight * (isCloseUp ? 2.05 : 0.86);
        const scale = Math.min(2.75, Math.max(0.08, targetHeight / textureHeight));
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(scale);
        const singleSlot = stableUnit(`${payload.requestId || payload.arcId || 'arc'}:${groupKey}:${characterKey}:slot`) < 0.5 ? 0.30 : 0.70;
        const slots = groupSize <= 1 ? [singleSlot] : (groupSize === 2 ? [0.28, 0.72] : [0.18, 0.50, 0.82]);
        sprite.x = logicalWidth * slots[Math.min(slotIndex, slots.length - 1)];
        const verticalDrop = isCloseUp
            ? Math.max(260, targetHeight * 0.58)
            : 38;
        sprite.y = logicalHeight + verticalDrop;
        sprite.alpha = 0;
        sprite.zIndex = 15 + visualIndex;
        sprite.__arcBaseX = sprite.x;
        sprite.__arcBaseY = sprite.y;
        sprite.__arcBaseScale = scale;
        sprite.__arcPanDirection = stableUnit(`${payload.requestId || payload.arcId || 'arc'}:${groupKey}:${characterKey}:pan`) < 0.5 ? -1 : 1;
        sprite.__arcPanDistance = isCloseUp ? 36 : 46;
        sprite.__arcEntryOffsetX = sprite.__arcPanDirection * (isCloseUp ? 44 : 58);
        sprite.__arcStanzaIndex = stanzaIndex;
        sprite.__arcSlotIndex = slotIndex;
        sprite.__arcGroupKey = groupKey;
        sprite.__arcCharacterKey = characterKey;
        sprite.__arcCloseUp = isCloseUp;
        sprite.__arcActive = false;
        sprite.__arcAlphaFrom = 0;
        sprite.__arcAlphaTo = 0;
        sprite.__arcAlphaStartedAt = 0;
        sprite.__arcAlphaDuration = 1;
        spriteLayer.addChild(sprite);
        characterSprites.push(sprite);
        if (!characterGroups.has(groupKey)) characterGroups.set(groupKey, []);
        characterGroups.get(groupKey).push(sprite);
        return sprite;
    }

    let visualIndex = 0;
    if (hasStanzaSpriteEntries) {
        for (let stanzaIndex = 0; stanzaIndex < stanzaSpriteEntries.length; stanzaIndex += 1) {
            const entries = stanzaSpriteEntries[stanzaIndex];
            for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
                await addCharacterSprite(entries[slotIndex], visualIndex, stanzaIndex, slotIndex, entries.length);
                visualIndex += 1;
            }
        }
    }

    const runtimeTextSeed = [
        payload.requestId || payload.arcId || 'arc_cinematic',
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 12)
    ].join(':');
    let randomSeed = Array.from(runtimeTextSeed)
        .reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
    function seededRandom() {
        randomSeed = ((randomSeed * 1664525) + 1013904223) >>> 0;
        return randomSeed / 4294967296;
    }

    const textPalette = [0xfff2cc, 0xdff7ff, 0xffdfdf, 0xe8f5cf, 0xf6ddff, 0xffffff];
    const textZones = [
        { x1: 0.10, y1: 0.18, x2: 0.90, y2: 0.42 },
        { x1: 0.10, y1: 0.47, x2: 0.90, y2: 0.80 },
        { x1: 0.08, y1: 0.28, x2: 0.50, y2: 0.74 },
        { x1: 0.50, y1: 0.28, x2: 0.92, y2: 0.74 },
        { x1: 0.18, y1: 0.24, x2: 0.82, y2: 0.72 }
    ];
    const TEXT_FADE_IN_MS = 1250;
    const TEXT_FADE_OUT_MS = 1150;
    const TEXT_SPAWN_DELAY_MS = 520;
    const TEXT_DESTROY_GRACE_MS = 180;
    const activeTextSpawns = [];

    function makeFloatingTextStyle(wordWrapWidth, stanzaIndex) {
        const fontSize = 28;
        return new PIXI.TextStyle({
            fontFamily: 'Georgia, Palatino Linotype, serif',
            fontSize,
            fill: textPalette[stanzaIndex % textPalette.length],
            align: 'center',
            lineHeight: Math.round(fontSize * 1.22),
            letterSpacing: 0.4,
            wordWrap: true,
            wordWrapWidth,
            dropShadow: true,
            dropShadowColor: '#000000',
            dropShadowBlur: 8,
            dropShadowDistance: 3
        });
    }

    function getVisualBounds(displayObject) {
        return {
            width: Math.max(1, Number(displayObject?.width) || 1),
            height: Math.max(1, Number(displayObject?.height) || 1)
        };
    }

    function fitTextToZone(text, zone, stanzaIndex) {
        const zoneWidth = Math.max(120, (zone.x2 - zone.x1) * logicalWidth);
        const zoneHeight = Math.max(64, (zone.y2 - zone.y1) * logicalHeight);
        const maxWidth = Math.max(120, zoneWidth - 36);
        const maxHeight = Math.max(48, zoneHeight - 22);
        text.style = makeFloatingTextStyle(maxWidth, stanzaIndex);
        const bounds = getVisualBounds(text);
        const fitScale = Math.min(1, maxWidth / bounds.width, maxHeight / bounds.height);
        text.scale.set(fitScale);
        return getVisualBounds(text);
    }

    function placeTextSpawn(text, stanzaIndex) {
        const preferred = (stanzaIndex * 2 + Math.floor(seededRandom() * textZones.length)) % textZones.length;
        let selected = null;
        let selectedBounds = null;

        for (let attempt = 0; attempt < textZones.length; attempt += 1) {
            const zone = textZones[(preferred + attempt) % textZones.length];
            const bounds = fitTextToZone(text, zone, stanzaIndex);
            const minX = zone.x1 * logicalWidth + bounds.width / 2 + 12;
            const maxX = zone.x2 * logicalWidth - bounds.width / 2 - 12;
            const minY = zone.y1 * logicalHeight + bounds.height / 2 + 10;
            const maxY = zone.y2 * logicalHeight - bounds.height / 2 - 10;
            if (minX > maxX || minY > maxY) continue;
            selected = {
                x: minX + seededRandom() * (maxX - minX),
                y: minY + seededRandom() * (maxY - minY)
            };
            selectedBounds = bounds;
            break;
        }

        if (!selected) {
            text.style = makeFloatingTextStyle(logicalWidth * 0.72, stanzaIndex);
            const rawBounds = getVisualBounds(text);
            const maxWidth = logicalWidth * 0.72;
            const maxHeight = logicalHeight * 0.34;
            text.scale.set(Math.min(1, maxWidth / rawBounds.width, maxHeight / rawBounds.height));
            selectedBounds = getVisualBounds(text);
            const minX = selectedBounds.width / 2 + 36;
            const maxX = logicalWidth - selectedBounds.width / 2 - 36;
            const minY = selectedBounds.height / 2 + 92;
            const maxY = logicalHeight - selectedBounds.height / 2 - 88;
            selected = {
                x: minX <= maxX ? minX + seededRandom() * (maxX - minX) : logicalWidth / 2,
                y: minY <= maxY ? minY + seededRandom() * (maxY - minY) : logicalHeight / 2
            };
        }

        text.x = Math.max(selectedBounds.width / 2 + 18, Math.min(logicalWidth - selectedBounds.width / 2 - 18, selected.x));
        text.y = Math.max(selectedBounds.height / 2 + 18, Math.min(logicalHeight - selectedBounds.height / 2 - 34, selected.y));
        return selected;
    }

    function spawnStanza(index, elapsedMs = 0) {
        const stanza = stanzas[Math.max(0, Math.min(stanzas.length - 1, index))] || stanzas[0];
        const lines = (Array.isArray(stanza.lines) ? stanza.lines : [])
            .map(line => String(line || '').trim())
            .filter(Boolean)
            .slice(0, 4);
        for (const spawn of activeTextSpawns) {
            if (spawn.despawnAt === null) spawn.despawnAt = elapsedMs;
        }

        const stanzaText = lines.join('\n');
        if (!stanzaText) return;
        const text = new PIXI.Text(stanzaText, makeFloatingTextStyle(logicalWidth * 0.58, index));
        text.anchor.set(0.5);
        text.alpha = 0;
        text.zIndex = 40;
        textLayer.addChild(text);
        placeTextSpawn(text, index);
        activeTextSpawns.push({
            text,
            spawnAt: elapsedMs + TEXT_SPAWN_DELAY_MS,
            despawnAt: null,
            baseX: text.x,
            baseY: text.y,
            baseScale: text.scale.x,
            driftX: (seededRandom() - 0.5) * 76,
            driftY: (seededRandom() - 0.5) * 46,
            phase: seededRandom() * Math.PI * 2,
            rotation: (seededRandom() - 0.5) * 0.016
        });
    }

    function updateTextSpawns(elapsedMs) {
        for (let i = activeTextSpawns.length - 1; i >= 0; i -= 1) {
            const spawn = activeTextSpawns[i];
            const text = spawn.text;
            const age = elapsedMs - spawn.spawnAt;
            if (!text || text.destroyed) {
                activeTextSpawns.splice(i, 1);
                continue;
            }
            if (age < 0) {
                text.alpha = 0;
                continue;
            }

            let alpha = easeInOutCubic(Math.min(1, age / TEXT_FADE_IN_MS));
            if (spawn.despawnAt !== null) {
                const outAge = elapsedMs - spawn.despawnAt;
                alpha *= 1 - easeInOutCubic(Math.min(1, Math.max(0, outAge / TEXT_FADE_OUT_MS)));
                if (outAge > TEXT_FADE_OUT_MS + TEXT_DESTROY_GRACE_MS) {
                    try { text.destroy?.(); } catch (_) { }
                    activeTextSpawns.splice(i, 1);
                    continue;
                }
            }

            const driftProgress = easeInOutCubic(Math.min(1, Math.max(0, age / 9200)));
            text.alpha = alpha * 0.96;
            const driftX = spawn.driftX * driftProgress + Math.sin(elapsedMs / 3200 + spawn.phase) * 3.2;
            const driftY = spawn.driftY * driftProgress + Math.cos(elapsedMs / 3600 + spawn.phase) * 2.6;
            text.x = spawn.baseX + driftX;
            text.y = spawn.baseY + driftY;
            text.rotation = spawn.rotation + Math.sin(elapsedMs / 4200 + spawn.phase) * 0.006;
            text.scale.set(spawn.baseScale * (1 + Math.sin(elapsedMs / 3600 + spawn.phase) * 0.010));
            const bounds = getVisualBounds(text);
            text.x = Math.max(bounds.width / 2 + 18, Math.min(logicalWidth - bounds.width / 2 - 18, text.x));
            text.y = Math.max(bounds.height / 2 + 18, Math.min(logicalHeight - bounds.height / 2 - 34, text.y));
        }
    }

    function dispatchVfxEvent(name, detail = {}) {
        if (!introVfxEnabled || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
        try {
            arcLog('dispatch-atmospheric-vfx-event', { name, detail });
            window.dispatchEvent(new CustomEvent(name, { detail }));
        } catch (error) {
            bridge.log?.warn?.('Arc cinematic VFX event failed', { name, error: error?.message || String(error) });
        }
    }

    function isLocalIntroVfx(id) {
        return !!id && id.startsWith('intro-') && introVfxController?.isIntroEffect?.(id);
    }

    function isIntroOnlyVfx(id) {
        return !!id && id.startsWith('intro-');
    }

    function getActiveTextObjects() {
        return activeTextSpawns
            .map(spawn => spawn?.text)
            .filter(text => text && !text.destroyed && text.alpha > 0.001);
    }

    function clearIntroVfx(id, force = false) {
        if (!introVfxEnabled || !id || id === 'none') return;
        if (isLocalIntroVfx(id)) {
            arcLog('clear-global-stanza-vfx', { id, force });
            introVfxController.clear(id);
            return;
        }
        if (isIntroOnlyVfx(id)) return;
        arcLog('clear-atmospheric-vfx', { id, force });
        dispatchVfxEvent(`vfx:clear-${id}`, {
            arcCinematic: true,
            requestId: payload.requestId || null,
            force
        });
    }

    function clearAllStartedIntroVfx(force = false) {
        for (const id of startedVfxIds) {
            clearIntroVfx(id, force);
        }
        activeVfxId = 'none';
    }

    function activateStanzaVfx(stanzaIndex) {
        if (!introVfxEnabled) return;
        const stanza = stanzas[Math.max(0, Math.min(stanzas.length - 1, stanzaIndex))] || {};
        const beat = normalizeVfxBeat(stanza.vfxBeat || stanza.vfx || {});
        if (isIntroOnlyVfx(beat.id)) return;
        if (beat.id === activeVfxId) return;

        clearIntroVfx(activeVfxId, false);
        activeVfxId = beat.id;
        if (beat.id === 'none') {
            arcLog('atmospheric-vfx:none', { stanzaIndex });
            return;
        }

        startedVfxIds.add(beat.id);
        const stanzaDurationMs = Math.max(1000, durationMs / Math.max(1, stanzas.length));
        arcLog('start-atmospheric-vfx', {
            stanzaIndex,
            id: beat.id,
            intensity: beat.intensity,
            durationMs: Math.round(stanzaDurationMs + 900)
        });
        dispatchVfxEvent(`vfx:start-${beat.id}`, {
            arcCinematic: true,
            requestId: payload.requestId || null,
            duration: Math.round(stanzaDurationMs + 900),
            opacity: beat.intensity === 'medium' ? 0.62 : 0.34
        });
    }

    function activateIntroStanzaVfx(stanzaIndex, elapsedMs = 0) {
        if (!introVfxEnabled || !introVfxController || introStanzaVfxSequence.length === 0) {
            arcLog('global-stanza-vfx:skipped', {
                stanzaIndex,
                vfxEnabled: introVfxEnabled,
                hasIntroVfxController: !!introVfxController,
                sequenceLength: introStanzaVfxSequence.length
            });
            return;
        }
        const rawBeat = introStanzaVfxSequence.find(entry => Number(entry?.stanzaIndex) === stanzaIndex)
            || introStanzaVfxSequence[stanzaIndex]
            || { id: 'none' };
        const beat = normalizeIntroStanzaVfxBeat(rawBeat);
        if (beat.id === 'none') {
            arcLog('global-stanza-vfx:none', { stanzaIndex });
            try { introVfxController.clear?.('all'); } catch (_) { }
            return;
        }
        if (!introVfxController.isIntroEffect?.(beat.id)) {
            arcLog('global-stanza-vfx:unknown', { stanzaIndex, id: beat.id });
            try { introVfxController.clear?.('all'); } catch (_) { }
            return;
        }
        const stanzaDurationMs = Math.max(1000, durationMs / Math.max(1, stanzas.length));
        const stanza = stanzas[Math.max(0, Math.min(stanzas.length - 1, stanzaIndex))] || {};
        const shaderPalette = stanza.shaderPalette || null;
        arcLog('start-global-stanza-vfx', {
            stanzaIndex,
            id: beat.id,
            intensity: beat.intensity,
            durationMs: stanzaDurationMs,
            paletteSource: shaderPalette?.source || null,
            paletteColorCount: Array.isArray(shaderPalette?.colors) ? shaderPalette.colors.length : 0,
            softenShadersOverImage: stanza.softenShadersOverImage === true
        });
        introVfxController.activate({
            id: beat.id,
            intensity: beat.intensity,
            stanzaIndex,
            stanzaDurationMs,
            shaderPalette,
            softenOverImage: stanza.softenShadersOverImage === true,
            backgroundSprites,
            characterSprites,
            textObjects: getActiveTextObjects(),
            elapsedMs,
        });
    }

    function cleanup() {
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
        app.ticker.remove(tick);
        try {
            audio?.removeEventListener?.('ended', onAudioEnded);
        } catch (_) { }
        try {
            audioHandle?.stop?.();
        } catch (_) { }
        arcLog('cleanup', { activeVfxId, startedVfxIds: Array.from(startedVfxIds) });
        clearAllStartedIntroVfx(false);
        try { introVfxController?.destroy?.(); } catch (_) { }
        if (bridge.audio?.resumeVN) {
            bridge.audio.resumeVN();
        } else if (bridge.audio?.restoreVN) {
            bridge.audio.restoreVN();
        }
        restoreImmersiveMode();
        try { bridge.actors?.hideNativeSprites?.(false); } catch (_) { }
        try { offResize?.(); } catch (_) { }
    }

    function finish(reason = 'complete') {
        if (finished) return;
        finished = true;
        arcLog('finish', { reason });
        cleanup();
        bridge.takeover.finish({ reason, requestId: payload.requestId || null });
    }

    function skip(reason = 'skipped') {
        if (finished) return;
        finished = true;
        arcLog('skip', { reason });
        cleanup();
        bridge.takeover.finish({ reason, skipped: true, requestId: payload.requestId || null });
    }

    function onAudioEnded() {
        finish('audio_ended');
    }

    function waitForMetadata(media, timeoutMs = 2200) {
        return new Promise(resolve => {
            if (!media) {
                resolve(false);
                return;
            }
            if (Number.isFinite(media.duration) && media.duration > 0) {
                resolve(true);
                return;
            }
            let done = false;
            const settle = (value) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                media.removeEventListener('loadedmetadata', onLoaded);
                media.removeEventListener('durationchange', onLoaded);
                media.removeEventListener('error', onError);
                resolve(value);
            };
            const onLoaded = () => settle(true);
            const onError = () => settle(false);
            const timeout = setTimeout(() => settle(false), timeoutMs);
            media.addEventListener('loadedmetadata', onLoaded);
            media.addEventListener('durationchange', onLoaded);
            media.addEventListener('error', onError);
        });
    }

    async function getWindowFocusState() {
        try {
            if (socket && typeof socket.emitReceive === 'function') {
                const focusData = await socket.emitReceive('get-window-focus-state', {});
                if (typeof focusData?.isFocused === 'boolean') return focusData.isFocused;
            }
        } catch (_) { }
        if (typeof document !== 'undefined' && typeof document.hasFocus === 'function') {
            return document.hasFocus();
        }
        return true;
    }

    function waitForStableFocus() {
        return new Promise(resolve => {
            let done = false;
            let focusTimer = null;
            let offWindowFocus = null;

            const cleanup = () => {
                if (focusTimer) {
                    clearTimeout(focusTimer);
                    focusTimer = null;
                }
                try { offWindowFocus?.(); } catch (_) { }
                offWindowFocus = null;
                try { socket?.off?.('window-focus-changed', onFocusChanged); } catch (_) { }
            };

            const settle = () => {
                if (done) return;
                done = true;
                cleanup();
                resolve();
            };

            const verifyAfterDebounce = () => {
                if (focusTimer) clearTimeout(focusTimer);
                focusTimer = setTimeout(async () => {
                    if (await getWindowFocusState()) settle();
                }, 300);
            };

            const onFocusChanged = (data = {}) => {
                if (data.isFocused) verifyAfterDebounce();
            };

            bridge.lifecycle?.onDispose?.(() => {
                cleanup();
                if (!done) {
                    done = true;
                    resolve();
                }
            });

            try { socket?.on?.('window-focus-changed', onFocusChanged); } catch (_) { }
            offWindowFocus = bridge.lifecycle?.onWindow?.('focus', verifyAfterDebounce) || null;
            getWindowFocusState().then(isFocused => {
                if (isFocused) verifyAfterDebounce();
            }).catch(settle);
        });
    }

    function easeInOutCubic(value) {
        const t = Math.max(0, Math.min(1, value));
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function easeOutCubic(value) {
        const t = Math.max(0, Math.min(1, value));
        return 1 - Math.pow(1 - t, 3);
    }

    function getStanzaBackgroundAlpha(stanzaAgeMs, stanzaDurationMs) {
        const duration = Math.max(1, Number(stanzaDurationMs) || 1);
        const baseBlackInMs = 4000;
        const baseFadeInMs = 2200;
        const baseHoldMs = 7000;
        const baseFadeOutMs = 2200;
        const baseBlackOutMs = 4000;
        const baseTotalMs = baseBlackInMs + baseFadeInMs + baseHoldMs + baseFadeOutMs + baseBlackOutMs;
        const scale = Math.min(1, duration / baseTotalMs);
        const blackInMs = baseBlackInMs * scale;
        const fadeInMs = baseFadeInMs * scale;
        const holdMs = baseHoldMs * scale;
        const fadeOutMs = baseFadeOutMs * scale;
        const blackOutStart = blackInMs + fadeInMs + holdMs + fadeOutMs;
        const age = Math.max(0, Math.min(duration, Number(stanzaAgeMs) || 0));

        if (age < blackInMs) return 0;
        if (age < blackInMs + fadeInMs) {
            return easeInOutCubic((age - blackInMs) / Math.max(1, fadeInMs));
        }
        if (age < blackInMs + fadeInMs + holdMs) return 1;
        if (age < blackOutStart) {
            return 1 - easeInOutCubic((age - blackInMs - fadeInMs - holdMs) / Math.max(1, fadeOutMs));
        }
        return 0;
    }

    function setSpriteAlphaTransition(sprite, targetAlpha, elapsedMs, durationMs) {
        const currentAlpha = Number(sprite?.alpha) || 0;
        if (Math.abs((Number(sprite.__arcAlphaTo) || 0) - targetAlpha) < 0.001 && sprite.__arcActive === (targetAlpha > 0)) {
            return;
        }
        sprite.__arcAlphaFrom = currentAlpha;
        sprite.__arcAlphaTo = targetAlpha;
        sprite.__arcAlphaStartedAt = elapsedMs;
        sprite.__arcAlphaDuration = Math.max(1, durationMs);
        sprite.__arcActive = targetAlpha > 0;
    }

    let activeGroupKey = '';
    function activateCharacterGroup(stanzaIndex, elapsedMs) {
        activeGroupKey = String(stanzaIndex);

        for (const sprite of characterSprites) {
            const active = sprite.__arcGroupKey === activeGroupKey;
            setSpriteAlphaTransition(sprite, active ? 0.90 : 0, elapsedMs, active ? 1350 : 1150);
        }
    }

    let currentStanza = -1;
    let currentStanzaStartedAt = 0;
    function tick() {
        if (finished) return;
        const now = performance.now();
        const elapsed = getCinematicElapsed(now);
        const shaderElapsed = Math.max(0, now - startedAt);
        const progress = Math.min(1, elapsed / durationMs);
        if (elapsed >= durationMs) {
            finish('duration_complete');
            return;
        }
        const stanzaIndex = Math.min(stanzas.length - 1, Math.floor(progress * stanzas.length));
        if (stanzaIndex !== currentStanza) {
            currentStanza = stanzaIndex;
            currentStanzaStartedAt = elapsed;
            arcLog('stanza-enter', {
                stanzaIndex,
                lines: Array.isArray(stanzas[stanzaIndex]?.lines) ? stanzas[stanzaIndex].lines : []
            });
            spawnStanza(stanzaIndex, elapsed);
            activateCharacterGroup(stanzaIndex, elapsed);
            activateIntroStanzaVfx(stanzaIndex, elapsed);
            activateStanzaVfx(stanzaIndex, elapsed);
        }

        const stanzaAge = Math.max(0, elapsed - currentStanzaStartedAt);
        const stanzaDurationMs = Math.max(1, durationMs / Math.max(1, stanzas.length));
        const stanzaProgress = Math.min(1, stanzaAge / stanzaDurationMs);
        const enterEase = easeOutCubic(stanzaAge / 1600);
        const backgroundAlphaEnvelope = getStanzaBackgroundAlpha(stanzaAge, stanzaDurationMs);
        updateTextSpawns(elapsed);
        titleText.alpha = Math.min(1, 0.25 + progress * 5);
        skipText.alpha = 0.45 + Math.sin(shaderElapsed / 650) * 0.16;

        if (backgroundSprites.length > 0) {
            for (let i = 0; i < backgroundSprites.length; i += 1) {
                const sprite = backgroundSprites[i];
                const active = i === (stanzaIndex % backgroundSprites.length);
                const targetAlpha = active ? backgroundAlphaEnvelope : 0;
                sprite.alpha += (targetAlpha - sprite.alpha) * 0.10;
                const breathe = 1 + progress * 0.055 + Math.sin(elapsed / 4800 + i) * 0.008;
                const waterOverscan = Number(sprite.__introWaterOverscan) || 1;
                sprite.scale.set(sprite.__arcBaseScale * breathe * waterOverscan);
                sprite.x = logicalWidth / 2 + Math.sin(elapsed / 6200 + i) * 22;
                sprite.y = logicalHeight / 2 + Math.cos(elapsed / 7000 + i) * 14;
            }
        }

        if (audio && audioBaseVolume !== null) {
            const fadeOutMs = Math.min(5000, Math.max(1200, durationMs * 0.12));
            const remainingMs = Math.max(0, durationMs - elapsed);
            const fadeFactor = remainingMs < fadeOutMs ? remainingMs / fadeOutMs : 1;
            audio.volume = Math.max(0, audioBaseVolume * fadeFactor);
        }

        for (let i = 0; i < characterSprites.length; i += 1) {
            const sprite = characterSprites[i];
            const active = sprite.__arcGroupKey === activeGroupKey;
            const alphaAge = elapsed - (Number(sprite.__arcAlphaStartedAt) || 0);
            const alphaT = easeInOutCubic(alphaAge / (Number(sprite.__arcAlphaDuration) || 1));
            const fromAlpha = Number(sprite.__arcAlphaFrom) || 0;
            const toAlpha = Number(sprite.__arcAlphaTo) || 0;
            sprite.alpha = fromAlpha + (toAlpha - fromAlpha) * alphaT;
            if (!active && sprite.alpha < 0.01) {
                sprite.alpha = 0;
                continue;
            }

            if (active) {
                const pan = (stanzaProgress - 0.5) * 2 * sprite.__arcPanDistance * sprite.__arcPanDirection;
                const entryOffset = (1 - enterEase) * sprite.__arcEntryOffsetX;
                sprite.x = sprite.__arcBaseX - entryOffset + pan;
                sprite.y = sprite.__arcBaseY + (1 - enterEase) * 10;
                sprite.scale.set(sprite.__arcBaseScale);
            }
        }

        introVfxController?.update?.({
            elapsedMs: shaderElapsed,
            stanzaProgress,
            stanzaIndex,
            backgroundVisibility: backgroundAlphaEnvelope,
            backgroundSprites,
            characterSprites,
            textObjects: getActiveTextObjects(),
        });

        if (!audio && elapsed >= durationMs) {
            finish('timer_complete');
        }
    }

    const offKey = bridge.lifecycle?.onWindow?.('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            skip(event.key === 'Escape' ? 'escape' : 'keyboard');
        }
    });
    root.eventMode = 'static';
    root.hitArea = new PIXI.Rectangle(0, 0, logicalWidth, logicalHeight);
    root.on('pointertap', () => skip('pointer'));
    bridge.lifecycle?.onDispose?.(() => {
        offKey?.();
        cleanup();
    });

    await waitForStableFocus();
    if (finished) return;

    if (payload.ost?.path) {
        bridge.log?.info?.('Arc cinematic OST starting', { path: payload.ost.path });
        audioHandle = bridge.audio.play(payload.ost.path, {
            id: `arc_cinematic_${payload.requestId || Date.now()}`,
            loop: false,
            category: 'ost',
            volume: 1
        });
        audio = audioHandle?.audio || null;
        if (audio) {
            audioBaseVolume = audio.volume;
            audio.addEventListener('error', () => {
                const mediaError = audio?.error;
                bridge.log?.warn?.('Arc cinematic OST media error', {
                    path: payload.ost.path,
                    src: audioHandle?.src || audio.currentSrc || audio.src || '',
                    code: mediaError?.code || null,
                    message: mediaError?.message || ''
                });
            }, { once: true });
            if (audioHandle?.playPromise) {
                const played = await audioHandle.playPromise;
                if (played === false) {
                    try { await audioHandle.play?.(); } catch (error) {
                        bridge.log?.warn?.('Arc cinematic OST failed to play', {
                            path: payload.ost.path,
                            src: audioHandle?.src || audio.currentSrc || audio.src || '',
                            error: error?.message || audio.__bridgeLastPlayError?.message || String(error)
                        });
                    }
                } else {
                    bridge.log?.info?.('Arc cinematic OST playing', {
                        path: payload.ost.path,
                        src: audioHandle?.src || audio.currentSrc || audio.src || ''
                    });
                }
            }
            await waitForMetadata(audio);
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                durationMs = Math.min(maximumDurationMs, Math.max(1000, audio.duration * 1000));
            }
            audio.addEventListener('ended', onAudioEnded, { once: true });
        }
    }

    startedAt = performance.now();
    playbackStarted = true;
    app.ticker.add(tick);
})();
