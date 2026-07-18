(() => {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function uniqueStrings(values) {
        const out = [];
        const seen = new Set();
        for (const value of values || []) {
            const normalized = String(value || '').trim();
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            out.push(normalized);
        }
        return out;
    }

    function normalizeCharacterKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function toPathNoExt(pathLike) {
        return String(pathLike || '')
            .replace(/\\/g, '/')
            .replace(/\.[^.]+$/, '')
            .toLowerCase();
    }

    function toFileStem(pathLike) {
        const normalized = String(pathLike || '').replace(/\\/g, '/');
        const fileName = normalized.split('/').pop() || '';
        return fileName.replace(/\.[^.]+$/, '').toLowerCase();
    }

    function parseSpriteDirection(pathLike) {
        const fullNoExt = toPathNoExt(pathLike);
        const fileStem = toFileStem(pathLike);
        if (!fullNoExt || !fileStem) return null;
        if (fileStem.endsWith('_icon') || fileStem.endsWith('_reference')) return null;
        if (fileStem.endsWith('_talk') || fileStem.endsWith('_blink') || fileStem.endsWith('_talk_blink')) return null;

        const match = fullNoExt.match(/^(.*)_(left|right|back|front)$/i);
        if (match) {
            return {
                stem: match[1],
                direction: String(match[2] || '').toLowerCase()
            };
        }
        return {
            stem: fullNoExt,
            direction: 'front'
        };
    }

    function scoreStemDirectionMap(directionMap, stem) {
        const dirs = directionMap.get(stem) || {};
        const hasFront = !!dirs.front;
        const hasLeft = !!dirs.left;
        const hasRight = !!dirs.right;
        const hasBack = !!dirs.back;
        const fullCount = (hasFront ? 1 : 0) + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0) + (hasBack ? 1 : 0);
        const neutralBonus = stem.includes('_neutral') ? 1 : 0;
        return (fullCount * 100) + (neutralBonus * 10);
    }

    function getStemCharacterRoot(stem) {
        const value = String(stem || '');
        if (!value) return '';
        const slash = value.lastIndexOf('/');
        const prefix = slash >= 0 ? value.slice(0, slash + 1) : '';
        const file = slash >= 0 ? value.slice(slash + 1) : value;
        const lastUnderscore = file.lastIndexOf('_');
        if (lastUnderscore <= 0) return value;
        return prefix + file.slice(0, lastUnderscore);
    }

    function buildDirectionalFromBestFront(byStem, stemScores) {
        if (!(byStem instanceof Map) || byStem.size === 0) return null;

        const orderedStems = Array.from(byStem.keys())
            .sort((a, b) => (stemScores.get(b) || 0) - (stemScores.get(a) || 0));
        const frontStem = orderedStems.find(stem => !!(byStem.get(stem) || {}).front);
        if (!frontStem) return null;

        const frontDirs = byStem.get(frontStem) || {};
        const characterRoot = getStemCharacterRoot(frontStem);
        const out = { front: frontDirs.front, left: '', right: '', back: '' };

        const pickDirection = (dir) => {
            if (frontDirs[dir]) return frontDirs[dir];

            for (const stem of orderedStems) {
                if (getStemCharacterRoot(stem) !== characterRoot) continue;
                const dirs = byStem.get(stem) || {};
                if (dirs[dir]) return dirs[dir];
            }

            for (const stem of orderedStems) {
                const dirs = byStem.get(stem) || {};
                if (dirs[dir]) return dirs[dir];
            }

            return '';
        };

        out.left = pickDirection('left');
        out.right = pickDirection('right');
        out.back = pickDirection('back');
        return (out.front && out.left && out.right && out.back) ? out : null;
    }

    function resolveProfileFromPaths(paths) {
        const files = uniqueStrings(paths || []);
        if (!files.length) return { directional: null, staticFront: null };

        const byStem = new Map();
        for (const pathValue of files) {
            const parsed = parseSpriteDirection(pathValue);
            if (!parsed || !parsed.stem) continue;
            if (!byStem.has(parsed.stem)) byStem.set(parsed.stem, {});
            const dirMap = byStem.get(parsed.stem);
            if (!dirMap[parsed.direction]) dirMap[parsed.direction] = String(pathValue);
        }

        const stemScores = new Map();
        let bestDirectionalStem = null;
        let bestDirectionalScore = -1;
        let bestStaticStem = null;
        let bestStaticScore = -1;

        for (const stem of byStem.keys()) {
            const dirs = byStem.get(stem) || {};
            const score = scoreStemDirectionMap(byStem, stem);
            stemScores.set(stem, score);
            const hasDirectionalSet = !!(dirs.front && dirs.left && dirs.right && dirs.back);
            const hasStaticFront = !!dirs.front;
            if (hasDirectionalSet && score > bestDirectionalScore) {
                bestDirectionalScore = score;
                bestDirectionalStem = stem;
            }
            if (hasStaticFront && score > bestStaticScore) {
                bestStaticScore = score;
                bestStaticStem = stem;
            }
        }

        let directional = bestDirectionalStem
            ? {
                front: byStem.get(bestDirectionalStem).front,
                left: byStem.get(bestDirectionalStem).left,
                right: byStem.get(bestDirectionalStem).right,
                back: byStem.get(bestDirectionalStem).back
            }
            : null;
        if (!directional) {
            directional = buildDirectionalFromBestFront(byStem, stemScores);
        }
        const staticFront = bestStaticStem
            ? { front: byStem.get(bestStaticStem).front }
            : null;
        return { directional, staticFront };
    }

    function extractSpritePathValue(entry) {
        if (!entry) return '';
        if (typeof entry === 'string') return entry.trim();
        if (typeof entry === 'object') {
            return String(entry.path || entry.src || entry.image || entry.file || '').trim();
        }
        return '';
    }

    function collectCharacterPathsFromTurn(turn, characterName) {
        const sequence = Array.isArray(turn?.sequence) ? turn.sequence : [];
        const targetKey = normalizeCharacterKey(characterName);
        if (!targetKey || !sequence.length) return [];
        const out = [];
        const seen = new Set();
        const addPath = (value) => {
            const pathValue = String(value || '').trim();
            if (!pathValue || seen.has(pathValue)) return;
            seen.add(pathValue);
            out.push(pathValue);
        };

        for (const line of sequence) {
            if (normalizeCharacterKey(line?.character) !== targetKey) continue;
            addPath(line?.image);
            const sprites = line?.sprites;
            if (Array.isArray(sprites)) {
                for (const entry of sprites) addPath(extractSpritePathValue(entry));
            } else if (sprites && typeof sprites === 'object') {
                for (const entry of Object.values(sprites)) addPath(extractSpritePathValue(entry));
            }
        }
        return out;
    }

    function deriveSelectionFromBridge(bridge) {
        const playerState = bridge?.player?.getState?.() || null;
        const turn = bridge?.player?.getTurn?.() || null;
        const playerCharacterName = String(playerState?.playerCharacterName || '').trim();
        const party = Array.isArray(turn?.party) ? turn.party : [];
        const partyWithoutPlayer = [];
        const seenParty = new Set();
        const playerKey = normalizeCharacterKey(playerCharacterName);
        for (const name of party) {
            const clean = String(name || '').trim();
            const key = normalizeCharacterKey(clean);
            if (!clean || !key || key === playerKey || seenParty.has(key)) continue;
            seenParty.add(key);
            partyWithoutPlayer.push(clean);
        }

        const resolveCharacterProfile = (name) => resolveProfileFromPaths(collectCharacterPathsFromTurn(turn, name));

        // 1) player directional
        if (playerCharacterName) {
            const profile = resolveCharacterProfile(playerCharacterName);
            if (profile.directional) {
                return {
                    enabled: true,
                    mode: 'directional',
                    source: 'player',
                    characterName: playerCharacterName,
                    sprites: profile.directional
                };
            }
        }
        // 2) party directional
        for (const name of partyWithoutPlayer) {
            const profile = resolveCharacterProfile(name);
            if (profile.directional) {
                return {
                    enabled: true,
                    mode: 'directional',
                    source: 'party',
                    characterName: name,
                    sprites: profile.directional
                };
            }
        }
        // 3) player static
        if (playerCharacterName) {
            const profile = resolveCharacterProfile(playerCharacterName);
            if (profile.staticFront) {
                return {
                    enabled: true,
                    mode: 'static',
                    source: 'player',
                    characterName: playerCharacterName,
                    sprites: profile.staticFront
                };
            }
        }
        // 4) party static
        for (const name of partyWithoutPlayer) {
            const profile = resolveCharacterProfile(name);
            if (profile.staticFront) {
                return {
                    enabled: true,
                    mode: 'static',
                    source: 'party',
                    characterName: name,
                    sprites: profile.staticFront
                };
            }
        }

        return { enabled: true, mode: 'none', source: null, characterName: null, sprites: null };
    }

    function createSpriteVisualController({ PIXI, bridge, spriteSelection, playerContainer, coreGraphic }) {
        const directionOrder = ['front', 'left', 'right', 'back'];
        const visualLayer = new PIXI.Container();
        visualLayer.zIndex = 4;
        playerContainer.addChild(visualLayer);
        playerContainer.sortableChildren = true;

        let activeDirection = 'front';
        let activeSprite = null;
        let activeSpritePath = '';
        let disposed = false;
        const textures = new Map();
        const spritePathsByDirection = {};

        function normalizeSelectionMode(mode) {
            const value = String(mode || '').trim().toLowerCase();
            if (value === 'directional' || value === 'static') return value;
            return 'none';
        }

        const hasProvidedSelection = !!spriteSelection
            && (normalizeSelectionMode(spriteSelection?.mode) === 'directional' || normalizeSelectionMode(spriteSelection?.mode) === 'static')
            && spriteSelection?.sprites
            && typeof spriteSelection.sprites === 'object';

        const derivedSelection = hasProvidedSelection ? null : deriveSelectionFromBridge(bridge);
        const effectiveSelection = hasProvidedSelection ? spriteSelection : derivedSelection;

        const selectionMode = normalizeSelectionMode(effectiveSelection?.mode);
        const sprites = effectiveSelection?.sprites && typeof effectiveSelection.sprites === 'object'
            ? effectiveSelection.sprites
            : {};

        if (selectionMode === 'directional') {
            for (const key of directionOrder) {
                const pathValue = String(sprites[key] || '').trim();
                if (pathValue) spritePathsByDirection[key] = pathValue;
            }
        } else if (selectionMode === 'static') {
            const front = String(sprites.front || '').trim();
            if (front) {
                for (const key of directionOrder) spritePathsByDirection[key] = front;
            }
        }

        function buildDirectionalSiblingPath(frontPath, direction) {
            const raw = String(frontPath || '').replace(/\\/g, '/').trim();
            if (!raw || !direction) return '';
            const extMatch = raw.match(/(\.[a-z0-9]+)$/i);
            const ext = extMatch ? extMatch[1] : '';
            const noExt = ext ? raw.slice(0, -ext.length) : raw;
            const match = noExt.match(/^(.*)_(front|left|right|back)$/i);
            const base = match ? match[1] : noExt;
            return `${base}_${String(direction).toLowerCase()}${ext}`;
        }

        function expandDirectionalCandidatesFromFront() {
            const front = String(spritePathsByDirection.front || '').trim();
            if (!front) return;
            const allowOverride = selectionMode === 'static';
            for (const dir of ['left', 'right', 'back']) {
                const current = String(spritePathsByDirection[dir] || '').trim();
                if (!allowOverride && current) continue;
                if (allowOverride && current && current !== front) continue;
                const candidate = buildDirectionalSiblingPath(front, dir);
                if (candidate && candidate !== front) {
                    spritePathsByDirection[dir] = candidate;
                }
            }
        }

        expandDirectionalCandidatesFromFront();

        const distinctPaths = uniqueStrings(Object.values(spritePathsByDirection));
        const canUseSprites = distinctPaths.length > 0;

        function resolvePath(pathLike) {
            const raw = String(pathLike || '').trim();
            if (!raw) return '';
            if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
            if (raw.startsWith('/')) return raw;
            if (raw.startsWith('project://') || raw.startsWith('plugin://')) {
                try {
                    return bridge?.assets?.url?.(raw) || raw;
                } catch (_) {
                    return raw;
                }
            }
            if (raw.startsWith('sprites/')) {
                try {
                    return bridge?.assets?.getProjectAssetUrl?.(raw) || raw;
                } catch (_) {
                    return raw;
                }
            }
            if (raw.startsWith('assets/')) {
                try {
                    return bridge?.assets?.getProjectAssetUrl?.(raw) || raw;
                } catch (_) {
                    return raw;
                }
            }
            return raw;
        }

        function loadImage(url) {
            if (bridge?.assets?.loadImage && typeof bridge.assets.loadImage === 'function') {
                return bridge.assets.loadImage(url);
            }
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Failed to load image: ' + url));
                image.src = url;
            });
        }

        async function loadDownscaledTexture(pathLike) {
            const resolved = resolvePath(pathLike);
            if (!resolved) return null;
            try {
                const image = await loadImage(resolved);
                if (!image || disposed) return null;

                const sourceW = Number(image.naturalWidth || image.width || 0);
                const sourceH = Number(image.naturalHeight || image.height || 0);
                if (sourceW <= 0 || sourceH <= 0) return null;

                const maxDimension = 768;
                const ratio = Math.min(1, maxDimension / Math.max(sourceW, sourceH));
                const targetW = Math.max(1, Math.round(sourceW * ratio));
                const targetH = Math.max(1, Math.round(sourceH * ratio));

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(image, 0, 0, targetW, targetH);

                const texture = PIXI.Texture.from(canvas);
                texture.baseTexture.scaleMode = 'linear';
                return texture;
            } catch (_) {
                return null;
            }
        }

        function setSpriteTextureForDirection(direction) {
            const key = directionOrder.includes(direction) ? direction : 'front';
            const pathValue = spritePathsByDirection[key] || spritePathsByDirection.front || '';
            if (!pathValue) return false;

            const texture = textures.get(pathValue);
            if (!texture) return false;

            if (!activeSprite) {
                activeSprite = new PIXI.Sprite(texture);
                activeSprite.anchor.set(0.5, 1);
                activeSprite.zIndex = 8;
                visualLayer.addChild(activeSprite);
                coreGraphic.alpha = 0.04;
            } else {
                activeSprite.texture = texture;
            }

            // Keep sprite footprint close to the old crystal character size.
            const targetHeight = 86;
            const safeHeight = Math.max(1, Number(texture.height) || 1);
            const scale = targetHeight / safeHeight;
            activeSprite.scale.set(scale);
            activeSprite.y = 14;

            activeDirection = key;
            activeSpritePath = pathValue;
            return true;
        }

        async function init() {
            if (!canUseSprites) return false;
            for (const pathValue of distinctPaths) {
                if (disposed) return false;
                const texture = await loadDownscaledTexture(pathValue);
                if (texture) textures.set(pathValue, texture);
            }
            if (disposed) return false;
            return setSpriteTextureForDirection('front');
        }

        function updateDirection(nextDirection) {
            if (!canUseSprites || !activeSprite) return;
            const key = directionOrder.includes(nextDirection) ? nextDirection : 'front';
            if (key === activeDirection) return;
            const nextPath = spritePathsByDirection[key] || spritePathsByDirection.front || '';
            if (!nextPath || nextPath === activeSpritePath) {
                activeDirection = key;
                return;
            }
            setSpriteTextureForDirection(key);
        }

        function setInvulnerable(isInvulnerable) {
            if (activeSprite) activeSprite.tint = isInvulnerable ? 0xff8da1 : 0xffffff;
            coreGraphic.tint = isInvulnerable ? 0xff8da1 : 0xffffff;
        }

        function applyWobble(offsetY, rotation) {
            if (activeSprite) {
                activeSprite.rotation = rotation;
                activeSprite.y = 14 + offsetY;
            }
        }

        function disposeVisuals() {
            disposed = true;
            if (activeSprite && activeSprite.parent) {
                activeSprite.parent.removeChild(activeSprite);
            }
            if (activeSprite) {
                activeSprite.destroy();
                activeSprite = null;
            }
            for (const texture of textures.values()) {
                try { texture.destroy(true); } catch (_) {}
            }
            textures.clear();
        }

        return {
            init,
            updateDirection,
            setInvulnerable,
            applyWobble,
            dispose: disposeVisuals,
            hasSprite: () => !!activeSprite
        };
    }

    function createPlayerRuntime({
        PIXI,
        bridge,
        parentLayer,
        mapSize,
        toIsometric,
        input,
        config,
        playerKit,
        spriteSelection,
        arenaAdapter,
        onFireProjectile,
        onAbilityCast,
        onPlayerEvent
    }) {
        const fallbackWorldClamp = Math.max(300, Number(mapSize) || 1500);
        const resolvedKit = (playerKit && typeof playerKit === 'object') ? playerKit : {
            id: 'default',
            maxHp: config.PLAYER_HP,
            moveSpeed: config.PLAYER_SPEED,
            autoAttack: {
                intervalMs: config.AUTO_ATTACK_INTERVAL_MS,
                projectileSpeed: config.PLAYER_PROJECTILE_SPEED
            },
            dash: {
                variant: 'burst_dash',
                cooldownMs: config.DASH_COOLDOWN_MS,
                durationMs: config.DASH_DURATION_MS,
                iframeMs: config.DASH_IFRAME_MS,
                speedMultiplier: config.DASH_SPEED_MULTIPLIER
            },
            abilities: []
        };
        const dashVariants = {
            burst_dash: {
                id: 'burst_dash',
                cooldownMs: Number(resolvedKit?.dash?.cooldownMs) || config.DASH_COOLDOWN_MS,
                durationMs: Number(resolvedKit?.dash?.durationMs) || config.DASH_DURATION_MS,
                iframeMs: Number(resolvedKit?.dash?.iframeMs) || config.DASH_IFRAME_MS,
                speedMultiplier: Number(resolvedKit?.dash?.speedMultiplier) || config.DASH_SPEED_MULTIPLIER
            },
            blink_short: {
                id: 'blink_short',
                cooldownMs: 900,
                durationMs: 70,
                iframeMs: 120,
                speedMultiplier: 5.2
            },
            phased_dash: {
                id: 'phased_dash',
                cooldownMs: 1300,
                durationMs: 240,
                iframeMs: 260,
                speedMultiplier: 2.7
            }
        };
        let activeDashVariant = String(resolvedKit?.dash?.variant || 'burst_dash').toLowerCase();
        if (!dashVariants[activeDashVariant]) activeDashVariant = 'burst_dash';
        const abilities = [];
        for (const ability of (Array.isArray(resolvedKit?.abilities) ? resolvedKit.abilities : [])) {
            const key = String(ability?.key || '').toLowerCase();
            if (!['q', 'e', 'r'].includes(key)) continue;
            abilities.push({
                id: String(ability?.id || ('ability_' + abilities.length)),
                key,
                cooldownMs: Math.max(100, (Number(ability?.cooldownSeconds) || 8) * 1000),
                chargesMax: Math.max(1, Number(ability?.charges) || 1),
                charges: Math.max(1, Number(ability?.charges) || 1),
                cooldownRemainingMs: 0,
                castActions: Array.isArray(ability?.castActions) ? ability.castActions : [],
                passiveTags: Array.isArray(ability?.passiveTags) ? ability.passiveTags : [],
                lastCastMs: -Infinity
            });
        }

        const state = {
            worldPos: { x: 0, y: 0 },
            hp: Number(resolvedKit?.maxHp) || config.PLAYER_HP,
            maxHp: Number(resolvedKit?.maxHp) || config.PLAYER_HP,
            invulnMsRemaining: 0,
            dashCooldownMsRemaining: 0,
            dashMsRemaining: 0,
            autoAttackMsRemaining: 0,
            aimWorld: { x: 0, y: 0 },
            movementScreen: { vx: 0, vy: 0 },
            facingDirection: 'front',
            moveAnimMs: 0,
            elapsedMs: 0,
            mitigationMsRemaining: 0
        };

        const player = new PIXI.Container();
        const shadow = new PIXI.Graphics();
        shadow.ellipse(0, 0, 18, 10);
        shadow.fill({ color: 0x000000, alpha: 0.35 });
        player.addChild(shadow);

        const core = new PIXI.Graphics();
        player.addChild(core);

        function drawPlayer(colorOverride) {
            const color = colorOverride || config.COLORS.PLAYER;
            core.clear();
            core.circle(0, 0, 15);
            core.fill({ color, alpha: 0.14 });
            core.moveTo(0, -18);
            core.lineTo(12, 0);
            core.lineTo(0, 18);
            core.lineTo(-12, 0);
            core.closePath();
            core.fill({ color, alpha: 1 });
            core.circle(0, 0, 5);
            core.fill({ color: 0xffffff, alpha: 0.72 });
        }
        drawPlayer();
        parentLayer.addChild(player);

        const spriteController = createSpriteVisualController({
            PIXI,
            bridge,
            spriteSelection,
            playerContainer: player,
            coreGraphic: core
        });
        Promise.resolve(spriteController.init()).catch(() => {});

        function resolveFacingDirectionFromMovement(vx, vy) {
            const absX = Math.abs(vx);
            const absY = Math.abs(vy);
            const movementDeadzone = 0.01;
            if (absX < movementDeadzone && absY < movementDeadzone) return state.facingDirection || 'front';
            if (absX > absY) return vx < 0 ? 'left' : 'right';
            return vy < 0 ? 'back' : 'front';
        }

        function updateAimFromCursor(screen, viewport, screenToWorld) {
            const wx = screenToWorld(screen.x - viewport.x, screen.y - viewport.y, 0);
            state.aimWorld.x = wx.x;
            state.aimWorld.y = wx.y;
        }

        function applyArenaPolicy() {
            const fn = arenaAdapter?.applyPointPolicy;
            if (typeof fn !== 'function') return;
            const next = fn({
                x: state.worldPos.x,
                y: state.worldPos.y,
                entityType: 'player',
                radius: 12
            }) || null;
            if (!next) return;
            if (Number.isFinite(Number(next.x))) state.worldPos.x = Number(next.x);
            if (Number.isFinite(Number(next.y))) state.worldPos.y = Number(next.y);
        }

        function constrainWorldPosition() {
            const fn = arenaAdapter?.applyPointPolicy;
            if (typeof fn === 'function') {
                applyArenaPolicy();
                return;
            }
            state.worldPos.x = clamp(state.worldPos.x, -fallbackWorldClamp, fallbackWorldClamp);
            state.worldPos.y = clamp(state.worldPos.y, -fallbackWorldClamp, fallbackWorldClamp);
        }

        function update(deltaMs, viewport, screenToWorld) {
            state.elapsedMs += Math.max(0, Number(deltaMs) || 0);
            state.invulnMsRemaining = Math.max(0, state.invulnMsRemaining - deltaMs);
            state.dashCooldownMsRemaining = Math.max(0, state.dashCooldownMsRemaining - deltaMs);
            state.dashMsRemaining = Math.max(0, state.dashMsRemaining - deltaMs);
            state.autoAttackMsRemaining = Math.max(0, state.autoAttackMsRemaining - deltaMs);
            state.mitigationMsRemaining = Math.max(0, state.mitigationMsRemaining - deltaMs);
            for (const ability of abilities) {
                ability.cooldownRemainingMs = Math.max(0, ability.cooldownRemainingMs - deltaMs);
                if (ability.cooldownRemainingMs <= 0) ability.charges = ability.chargesMax;
            }

            const moveSpeed = Number(resolvedKit?.moveSpeed) || config.PLAYER_SPEED;
            const movement = input.getMovementVector(moveSpeed * (deltaMs / 16.6667));
            state.movementScreen.vx = movement.vx;
            state.movementScreen.vy = movement.vy;
            const cursor = input.getCursorScreen();
            updateAimFromCursor(cursor, viewport, screenToWorld);

            const dxAim = state.aimWorld.x - state.worldPos.x;
            const dyAim = state.aimWorld.y - state.worldPos.y;
            const aimLen = Math.hypot(dxAim, dyAim) || 1;

            const dashVariant = dashVariants[activeDashVariant] || dashVariants.burst_dash;
            if (input.consumeDashPressed() && state.dashCooldownMsRemaining <= 0) {
                state.dashMsRemaining = Number(dashVariant.durationMs) || config.DASH_DURATION_MS;
                state.dashCooldownMsRemaining = Number(dashVariant.cooldownMs) || config.DASH_COOLDOWN_MS;
                state.invulnMsRemaining = Math.max(state.invulnMsRemaining, Number(dashVariant.iframeMs) || config.DASH_IFRAME_MS);
                onPlayerEvent?.({
                    type: 'player_dash_used',
                    payload: { dashVariant: activeDashVariant, elapsedMs: state.elapsedMs }
                });
                if (activeDashVariant === 'blink_short') {
                    state.worldPos.x += (dxAim / aimLen) * 120;
                    state.worldPos.y += (dyAim / aimLen) * 120;
                    constrainWorldPosition();
                }
            }

            const moveScale = state.dashMsRemaining > 0 ? (Number(dashVariant.speedMultiplier) || config.DASH_SPEED_MULTIPLIER) : 1;
            const worldDelta = screenDeltaToWorld(movement.vx, movement.vy, config.ISOMETRIC_ANGLE);
            state.worldPos.x += worldDelta.x * moveScale;
            state.worldPos.y += worldDelta.y * moveScale;
            constrainWorldPosition();

            state.facingDirection = resolveFacingDirectionFromMovement(movement.vx, movement.vy);
            spriteController.updateDirection(state.facingDirection);

            if (input.isPrimaryHeld() && state.autoAttackMsRemaining <= 0) {
                state.autoAttackMsRemaining = Number(resolvedKit?.autoAttack?.intervalMs) || config.AUTO_ATTACK_INTERVAL_MS;
                const shotSpeed = Number(resolvedKit?.autoAttack?.projectileSpeed) || config.PLAYER_PROJECTILE_SPEED;
                onFireProjectile?.({
                    x: state.worldPos.x,
                    y: state.worldPos.y,
                    z: 20,
                    vx: (dxAim / aimLen) * shotSpeed,
                    vy: (dyAim / aimLen) * shotSpeed,
                    vz: 0,
                    life: 90,
                    color: config.COLORS.PLAYER,
                    team: 'player',
                    projectileType: 'player_default_bullet'
                });
            }

            for (const key of ['q', 'e', 'r']) {
                if (!input.consumePressed(key)) continue;
                const ability = abilities.find((item) => item.key === key);
                if (!ability) {
                    onPlayerEvent?.({ type: 'player_ability_cast_failed', payload: { key, reason: 'missing_slot' } });
                    continue;
                }
                if (ability.charges <= 0) {
                    onPlayerEvent?.({ type: 'player_ability_cast_failed', payload: { key, reason: 'no_charges', abilityId: ability.id } });
                    continue;
                }
                if (ability.cooldownRemainingMs > 0) {
                    onPlayerEvent?.({ type: 'player_ability_cast_failed', payload: { key, reason: 'cooldown', abilityId: ability.id } });
                    continue;
                }
                ability.lastCastMs = state.elapsedMs;
                ability.charges = Math.max(0, ability.charges - 1);
                ability.cooldownRemainingMs = ability.cooldownMs;
                onAbilityCast?.({
                    abilityId: ability.id,
                    key: ability.key,
                    castActions: ability.castActions,
                    playerState: getState()
                });
                onPlayerEvent?.({
                    type: 'player_ability_used',
                    payload: { abilityId: ability.id, key: ability.key, elapsedMs: state.elapsedMs }
                });
            }

            const iso = toIsometric(state.worldPos.x, state.worldPos.y);
            player.x = iso.x;
            player.y = iso.y;
            player.scale.set(iso.scale);

            const moveMagnitude = Math.hypot(movement.vx, movement.vy);
            const moving = moveMagnitude > 0.02;
            if (moving) {
                state.moveAnimMs += deltaMs;
            } else {
                state.moveAnimMs = Math.max(0, state.moveAnimMs - (deltaMs * 0.85));
            }
            const wobbleProgress = state.moveAnimMs * 0.022;
            const wobbleAmountY = moving ? (Math.sin(wobbleProgress) * 2.8) : 0;
            const wobbleRotation = moving ? (Math.sin(wobbleProgress * 1.25) * 0.05) : 0;
            spriteController.applyWobble(wobbleAmountY, wobbleRotation);
            shadow.scale.x = moving ? 0.92 : 1;
            shadow.scale.y = moving ? 0.86 : 1;

            spriteController.setInvulnerable(state.invulnMsRemaining > 0);
        }

        function tryDamage(amount) {
            if (state.invulnMsRemaining > 0 || state.hp <= 0) return false;
            const damage = Math.max(0, Number(amount) || 0);
            if (damage <= 0) return false;
            const mitigated = state.mitigationMsRemaining > 0 ? damage * 0.5 : damage;
            state.hp = Math.max(0, state.hp - mitigated);
            state.invulnMsRemaining = config.PLAYER_HIT_IFRAME_MS;
            return true;
        }

        function heal(amount) {
            const value = Math.max(0, Number(amount) || 0);
            if (value <= 0) return;
            state.hp = clamp(state.hp + value, 0, state.maxHp);
        }

        function applyExternalForce(force) {
            const fx = Number(force?.x) || 0;
            const fy = Number(force?.y) || 0;
            state.worldPos.x += fx * (1 / 60);
            state.worldPos.y += fy * (1 / 60);
            constrainWorldPosition();
        }

        function setDashVariant(variantId) {
            const key = String(variantId || '').toLowerCase();
            if (!dashVariants[key]) return false;
            activeDashVariant = key;
            return true;
        }

        function grantAbility(def) {
            const source = def && typeof def === 'object' ? def : {};
            const key = String(source.key || 'q').toLowerCase();
            if (!['q', 'e', 'r'].includes(key)) return false;
            const id = String(source.id || ('ability_' + key));
            let ability = abilities.find((item) => item.id === id);
            if (!ability) {
                ability = {
                    id,
                    key,
                    cooldownMs: Math.max(100, (Number(source.cooldownSeconds) || 8) * 1000),
                    chargesMax: Math.max(1, Number(source.charges) || 1),
                    charges: Math.max(1, Number(source.charges) || 1),
                    cooldownRemainingMs: 0,
                    castActions: Array.isArray(source.castActions) ? source.castActions : [],
                    passiveTags: Array.isArray(source.passiveTags) ? source.passiveTags : [],
                    lastCastMs: -Infinity
                };
                abilities.push(ability);
            } else {
                ability.key = key;
                ability.cooldownMs = Math.max(100, (Number(source.cooldownSeconds) || (ability.cooldownMs / 1000) || 8) * 1000);
                ability.chargesMax = Math.max(1, Number(source.charges) || ability.chargesMax || 1);
                ability.charges = ability.chargesMax;
                ability.castActions = Array.isArray(source.castActions) ? source.castActions : ability.castActions;
                ability.passiveTags = Array.isArray(source.passiveTags) ? source.passiveTags : ability.passiveTags;
            }
            return true;
        }

        function removeAbility(idOrKey) {
            const token = String(idOrKey || '').toLowerCase();
            if (!token) return false;
            const idx = abilities.findIndex((item) => String(item.id || '').toLowerCase() === token || String(item.key || '').toLowerCase() === token);
            if (idx < 0) return false;
            abilities.splice(idx, 1);
            return true;
        }

        function resetAbilityCooldown(idOrKey) {
            const token = String(idOrKey || '').toLowerCase();
            if (!token) return false;
            const ability = abilities.find((item) => String(item.id || '').toLowerCase() === token || String(item.key || '').toLowerCase() === token);
            if (!ability) return false;
            ability.cooldownRemainingMs = 0;
            ability.charges = ability.chargesMax;
            return true;
        }

        function applyMitigationWindow(durationSeconds) {
            const ms = Math.max(0, (Number(durationSeconds) || 0) * 1000);
            state.mitigationMsRemaining = Math.max(state.mitigationMsRemaining, ms);
        }

        function getState() {
            return {
                worldPos: { x: state.worldPos.x, y: state.worldPos.y },
                hp: state.hp,
                maxHp: state.maxHp,
                dead: state.hp <= 0,
                dashCooldownRatio: state.dashCooldownMsRemaining / Math.max(1, Number((dashVariants[activeDashVariant] || dashVariants.burst_dash).cooldownMs) || config.DASH_COOLDOWN_MS),
                dashVariant: activeDashVariant,
                dashActive: state.dashMsRemaining > 0,
                mitigationActive: state.mitigationMsRemaining > 0,
                abilities: abilities.map((ability) => ({
                    id: ability.id,
                    key: ability.key,
                    cooldownRemaining: Math.max(0, ability.cooldownRemainingMs) / 1000,
                    cooldownRatio: Math.max(0, Math.min(1, ability.cooldownRemainingMs / Math.max(1, ability.cooldownMs))),
                    charges: ability.charges,
                    chargesMax: ability.chargesMax
                })),
                playerKit: {
                    id: String(resolvedKit?.id || 'default')
                }
            };
        }

        function dispose() {
            spriteController.dispose();
            if (player.parent) player.parent.removeChild(player);
            player.destroy({ children: true });
        }

        return {
            update,
            tryDamage,
            heal,
            applyExternalForce,
            setDashVariant,
            grantAbility,
            removeAbility,
            resetAbilityCooldown,
            applyMitigationWindow,
            getState,
            dispose
        };
    }

    function screenDeltaToWorld(screenDx, screenDy, isoAngle) {
        const cos = Math.cos(isoAngle);
        const sin = Math.sin(isoAngle);
        const inv2Cos = 1 / (2 * cos);
        const inv2Sin = 1 / (2 * sin);
        return {
            x: (screenDx * inv2Cos) + (screenDy * inv2Sin),
            y: (-screenDx * inv2Cos) + (screenDy * inv2Sin)
        };
    }

    window.TDSPlayerRuntime = {
        create: createPlayerRuntime
    };
})();
