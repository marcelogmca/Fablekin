(() => {
    const patternHandlers = Object.create(null);
    const modifierHandlers = Object.create(null);

    function normalizeNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeType(value, fallback = '') {
        const v = String(value || fallback).trim().toLowerCase();
        return v || fallback;
    }

    function resolveSource(sourceSpec, context) {
        const spec = sourceSpec && typeof sourceSpec === 'object' ? sourceSpec : {};
        const sourceType = normalizeType(spec.type, 'context_source');
        const baseSource = context?.source || { x: 0, y: 0 };
        const mapSize = Number(context?.mapSize) || 1500;
        const random = typeof context?.randomFloat === 'function' ? context.randomFloat : Math.random;
        if (sourceType === 'arena_center') return { x: 0, y: 0 };
        if (sourceType === 'random_arena') {
            return {
                x: (random() * 2 - 1) * mapSize,
                y: (random() * 2 - 1) * mapSize
            };
        }
        if (sourceType === 'arena_edge') {
            const edge = normalizeType(spec.edge, 'top');
            const p = clamp(normalizeNumber(spec.position, random()), 0, 1);
            if (edge === 'left') return { x: -mapSize, y: ((p * 2) - 1) * mapSize };
            if (edge === 'right') return { x: mapSize, y: ((p * 2) - 1) * mapSize };
            if (edge === 'bottom') return { x: ((p * 2) - 1) * mapSize, y: mapSize };
            return { x: ((p * 2) - 1) * mapSize, y: -mapSize };
        }
        if (sourceType === 'player') {
            return context?.player || baseSource;
        }
        if (sourceType === 'target') {
            return context?.target || baseSource;
        }
        return baseSource;
    }

    function resolveBaseAngle(pattern, context, source, aimSpec) {
        const mode = normalizeType(aimSpec?.type, 'pattern');
        const target = context?.target || source;
        const dx = Number(target?.x) - Number(source?.x);
        const dy = Number(target?.y) - Number(source?.y);
        const toward = Math.atan2(dy || 0, dx || 0);
        if (mode === 'toward_player' || mode === 'toward_target') return toward;
        if (mode === 'away_from_player') return toward + Math.PI;
        if (mode === 'clockwise_around_player') return toward - (Math.PI * 0.5);
        if (mode === 'counterclockwise_around_player') return toward + (Math.PI * 0.5);
        if (mode === 'fixed_angle') return normalizeNumber(aimSpec?.angle, normalizeNumber(pattern?.baseAngle, 0));
        if (mode === 'random') {
            const random = typeof context?.randomFloat === 'function' ? context.randomFloat : Math.random;
            return random() * Math.PI * 2;
        }
        return normalizeNumber(pattern?.baseAngle, toward);
    }

    function withSharedPayload(pattern, payload, source) {
        const modifiers = Array.isArray(pattern?.modifiers) ? pattern.modifiers : [];
        return {
            ...payload,
            x: Number(source?.x) || 0,
            y: Number(source?.y) || 0,
            modifiers: modifiers.slice()
        };
    }

    function fireSpiral(pattern, context, emitProjectile, source, angleInfo) {
        const count = Math.max(1, Math.floor(normalizeNumber(pattern.count, 4)));
        const speed = normalizeNumber(pattern.speed, 3.5);
        const t = normalizeNumber(context.timeSeconds, 0);
        for (let i = 0; i < count; i += 1) {
            const angle = (t * 2.5) + angleInfo.baseAngle + ((i * Math.PI * 2) / count);
            emitProjectile(withSharedPayload(pattern, { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }, source));
        }
    }

    function fireRadial(pattern, _context, emitProjectile, source, angleInfo) {
        const count = Math.max(1, Math.floor(normalizeNumber(pattern.count, 8)));
        const speed = normalizeNumber(pattern.speed, 3.2);
        for (let i = 0; i < count; i += 1) {
            const angle = angleInfo.baseAngle + ((i * Math.PI * 2) / count);
            emitProjectile(withSharedPayload(pattern, { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }, source));
        }
    }

    function fireFan(pattern, _context, emitProjectile, source, angleInfo) {
        const count = Math.max(1, Math.floor(normalizeNumber(pattern.count, 5)));
        const speed = normalizeNumber(pattern.speed, 3.5);
        const spreadDeg = normalizeNumber(pattern.spreadDegrees, 48);
        const spreadRad = (spreadDeg * Math.PI) / 180;
        const half = (count - 1) * 0.5;
        for (let i = 0; i < count; i += 1) {
            const t = half === 0 ? 0 : (i - half) / half;
            const angle = angleInfo.baseAngle + (t * spreadRad * 0.5);
            emitProjectile(withSharedPayload(pattern, { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }, source));
        }
    }

    function fireAimed(pattern, context, emitProjectile, source) {
        const speed = normalizeNumber(pattern.speed, 3.8);
        const target = context?.target || source;
        const dx = Number(target?.x) - Number(source?.x);
        const dy = Number(target?.y) - Number(source?.y);
        const len = Math.hypot(dx, dy) || 1;
        emitProjectile(withSharedPayload(pattern, { vx: (dx / len) * speed, vy: (dy / len) * speed }, source));
    }

    function fireLine(pattern, _context, emitProjectile, source, angleInfo) {
        const count = Math.max(1, Math.floor(normalizeNumber(pattern.count, 6)));
        const speed = normalizeNumber(pattern.speed, 3.2);
        const spacing = normalizeNumber(pattern.spacing, 60);
        const tangentX = Math.cos(angleInfo.baseAngle + (Math.PI * 0.5));
        const tangentY = Math.sin(angleInfo.baseAngle + (Math.PI * 0.5));
        const half = (count - 1) * 0.5;
        for (let i = 0; i < count; i += 1) {
            const offset = (i - half) * spacing;
            emitProjectile(withSharedPayload(pattern, {
                vx: Math.cos(angleInfo.baseAngle) * speed,
                vy: Math.sin(angleInfo.baseAngle) * speed,
                xOffset: tangentX * offset,
                yOffset: tangentY * offset
            }, source));
        }
    }

    function fireRain(pattern, _context, emitProjectile, source) {
        const count = Math.max(1, Math.floor(normalizeNumber(pattern.count, 8)));
        const speed = normalizeNumber(pattern.speed, 3.4);
        const width = normalizeNumber(pattern.width, 900);
        const originY = normalizeNumber(pattern.originYOffset, -480);
        const downwardBias = normalizeNumber(pattern.downwardBias, 0.18);
        const half = (count - 1) * 0.5;
        for (let i = 0; i < count; i += 1) {
            const t = half === 0 ? 0 : (i - half) / half;
            const xOffset = t * (width * 0.5);
            const vx = t * speed * 0.2;
            const vy = (speed * (1 - Math.abs(t) * downwardBias)) + (Math.abs(t) * speed * downwardBias);
            emitProjectile(withSharedPayload(pattern, {
                vx,
                vy: Math.max(0.2, vy),
                xOffset,
                yOffset: originY
            }, source));
        }
    }

    function registerPattern(type, handler) {
        const key = String(type || '').trim().toLowerCase();
        if (!key || typeof handler !== 'function') return false;
        patternHandlers[key] = handler;
        return true;
    }

    function registerModifier(type, handler) {
        const key = String(type || '').trim().toLowerCase();
        if (!key || typeof handler !== 'function') return false;
        modifierHandlers[key] = handler;
        return true;
    }

    function applyModifiers(projectile, deltaMs, context = null) {
        if (!projectile || !Array.isArray(projectile.modifiers) || projectile.modifiers.length === 0) return;
        for (const modifier of projectile.modifiers) {
            const type = String(modifier?.type || '').toLowerCase();
            const handler = modifierHandlers[type];
            if (typeof handler === 'function') {
                handler(projectile, modifier, deltaMs, context || {});
            }
        }
    }

    function generatePatternSpawns(pattern, context) {
        const p = pattern || {};
        const c = context || {};
        const type = normalizeType(p?.type, 'spiral');
        const handler = patternHandlers[type] || patternHandlers.spiral;
        if (!handler) return [];

        const source = resolveSource(p?.source, c);
        const angleInfo = {
            baseAngle: resolveBaseAngle(p, c, source, p?.aim)
        };
        const baseSpawns = [];
        handler(p, c, (spawn) => baseSpawns.push(spawn), source, angleInfo);

        const burstCount = Math.max(1, Math.floor(normalizeNumber(p?.burstCount, 1)));
        const burstIntervalSeconds = Math.max(0, normalizeNumber(p?.burstIntervalSeconds, 0));
        const angleStepPerBurst = normalizeNumber(p?.angleStepPerBurst, 0);
        const countStepPerBurst = Math.floor(normalizeNumber(p?.countStepPerBurst, 0));
        const speedStepPerBurst = normalizeNumber(p?.speedStepPerBurst, 0);

        if (burstCount <= 1) return baseSpawns;

        const expanded = [];
        for (let burstIndex = 0; burstIndex < burstCount; burstIndex += 1) {
            const delaySeconds = burstIndex * burstIntervalSeconds;
            for (const spawn of baseSpawns) {
                const next = { ...spawn };
                const speed = Math.hypot(Number(next.vx) || 0, Number(next.vy) || 0);
                if (speed > 0.0001) {
                    const angle = Math.atan2(Number(next.vy) || 0, Number(next.vx) || 0) + (burstIndex * angleStepPerBurst * (Math.PI / 180));
                    const finalSpeed = Math.max(0, speed + (burstIndex * speedStepPerBurst));
                    next.vx = Math.cos(angle) * finalSpeed;
                    next.vy = Math.sin(angle) * finalSpeed;
                }
                next.delaySeconds = Math.max(0, Number(next.delaySeconds) || 0) + delaySeconds;
                if (countStepPerBurst !== 0 && burstIndex > 0) {
                    const copies = Math.max(1, 1 + (burstIndex * countStepPerBurst));
                    for (let i = 0; i < copies; i += 1) expanded.push({ ...next });
                } else {
                    expanded.push(next);
                }
            }
        }
        return expanded;
    }

    function firePattern(pattern, context, emitProjectile) {
        const spawns = generatePatternSpawns(pattern, context);
        if (typeof emitProjectile === 'function') {
            for (const spawn of spawns) emitProjectile(spawn);
        }
        return spawns;
    }

    registerPattern('spiral', fireSpiral);
    registerPattern('radial', fireRadial);
    registerPattern('fan', fireFan);
    registerPattern('aimed', fireAimed);
    registerPattern('line', fireLine);
    registerPattern('rain', fireRain);

    function queueSpawn(projectile, request) {
        if (!projectile || !request || typeof request !== 'object') return;
        if (!Array.isArray(projectile._spawnRequests)) projectile._spawnRequests = [];
        projectile._spawnRequests.push(request);
    }

    registerModifier('accelerate', (projectile, modifier, deltaMs) => {
        const perSecond = normalizeNumber(modifier?.perSecond, 0);
        if (perSecond === 0) return;
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (!Number.isFinite(speed) || speed <= 0.0001) return;
        const nextSpeed = Math.max(0, speed + (perSecond * deltaScale));
        const ratio = nextSpeed / speed;
        projectile.vx *= ratio;
        projectile.vy *= ratio;
    });

    registerModifier('sine_wave', (projectile, modifier, deltaMs) => {
        const amplitude = normalizeNumber(modifier?.amplitude, 0);
        const frequency = normalizeNumber(modifier?.frequency, 0);
        if (amplitude === 0 || frequency === 0) return;

        const runtime = projectile._sineWave || {
            elapsedMs: 0,
            baseVx: Number(projectile.vx) || 0,
            baseVy: Number(projectile.vy) || 0
        };
        runtime.elapsedMs += Math.max(0, Number(deltaMs) || 0);
        const elapsedSeconds = runtime.elapsedMs / 1000;
        const baseSpeed = Math.hypot(runtime.baseVx, runtime.baseVy) || 1;
        const dirX = runtime.baseVx / baseSpeed;
        const dirY = runtime.baseVy / baseSpeed;
        const perpX = -dirY;
        const perpY = dirX;
        const waveVelocity = Math.cos(elapsedSeconds * frequency * Math.PI * 2) * (amplitude * frequency * Math.PI * 2);
        projectile.vx = (dirX * baseSpeed) + (perpX * waveVelocity);
        projectile.vy = (dirY * baseSpeed) + (perpY * waveVelocity);
        projectile._sineWave = runtime;
    });

    registerModifier('decelerate', (projectile, modifier, deltaMs) => {
        const perSecond = Math.abs(normalizeNumber(modifier?.perSecond, 0));
        if (perSecond <= 0) return;
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (!Number.isFinite(speed) || speed <= 0.0001) return;
        const nextSpeed = Math.max(0, speed - (perSecond * deltaScale));
        const ratio = nextSpeed / speed;
        projectile.vx *= ratio;
        projectile.vy *= ratio;
    });

    registerModifier('max_speed', (projectile, modifier) => {
        const maxSpeed = Math.max(0, normalizeNumber(modifier?.value, normalizeNumber(modifier?.maxSpeed, 0)));
        if (maxSpeed <= 0) return;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (speed <= maxSpeed || speed <= 0.0001) return;
        const ratio = maxSpeed / speed;
        projectile.vx *= ratio;
        projectile.vy *= ratio;
    });

    registerModifier('min_speed', (projectile, modifier) => {
        const minSpeed = Math.max(0, normalizeNumber(modifier?.value, normalizeNumber(modifier?.minSpeed, 0)));
        if (minSpeed <= 0) return;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (speed >= minSpeed || speed <= 0.0001) return;
        const ratio = minSpeed / speed;
        projectile.vx *= ratio;
        projectile.vy *= ratio;
    });

    registerModifier('rotate_velocity', (projectile, modifier, deltaMs) => {
        const degPerSecond = normalizeNumber(modifier?.degreesPerSecond, normalizeNumber(modifier?.degPerSecond, 0));
        if (degPerSecond === 0) return;
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const angleStep = (degPerSecond * Math.PI / 180) * deltaScale;
        const x = Number(projectile.vx) || 0;
        const y = Number(projectile.vy) || 0;
        projectile.vx = (x * Math.cos(angleStep)) - (y * Math.sin(angleStep));
        projectile.vy = (x * Math.sin(angleStep)) + (y * Math.cos(angleStep));
    });

    registerModifier('curve', (projectile, modifier, deltaMs) => {
        const turn = normalizeNumber(modifier?.radiansPerSecond, normalizeNumber(modifier?.turnRate, 0));
        if (turn === 0) return;
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (speed <= 0.0001) return;
        const angle = Math.atan2(projectile.vy || 0, projectile.vx || 0) + (turn * deltaScale);
        projectile.vx = Math.cos(angle) * speed;
        projectile.vy = Math.sin(angle) * speed;
    });

    registerModifier('friction', (projectile, modifier, deltaMs) => {
        const frictionPerSecond = clamp(normalizeNumber(modifier?.value, normalizeNumber(modifier?.perSecond, 0)), 0, 0.99);
        if (frictionPerSecond <= 0) return;
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const factor = Math.max(0, 1 - (frictionPerSecond * deltaScale));
        projectile.vx *= factor;
        projectile.vy *= factor;
    });

    registerModifier('home_to_player', (projectile, modifier, deltaMs, context) => {
        const player = context?.player;
        if (!player) return;
        const delay = Math.max(0, normalizeNumber(modifier?.delaySeconds, 0));
        const ageSeconds = (Number(projectile?.ageMs) || 0) / 1000;
        if (ageSeconds < delay) return;
        const turnRate = Math.max(0, normalizeNumber(modifier?.maxTurnRateDegPerSecond, 180)) * (Math.PI / 180);
        const deltaScale = (Number(deltaMs) || 0) / 1000;
        const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
        if (speed <= 0.0001) return;
        const current = Math.atan2(projectile.vy || 0, projectile.vx || 0);
        const target = Math.atan2((player.y - projectile.y) || 0, (player.x - projectile.x) || 0);
        let diff = target - current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxStep = turnRate * deltaScale;
        const applied = clamp(diff, -maxStep, maxStep);
        const next = current + applied;
        projectile.vx = Math.cos(next) * speed;
        projectile.vy = Math.sin(next) * speed;
    });

    registerModifier('split_after_time', (projectile, modifier) => {
        if (projectile._splitDone) return;
        const splitAt = Math.max(0, normalizeNumber(modifier?.timeSeconds, 0.8));
        const ageSeconds = (Number(projectile?.ageMs) || 0) / 1000;
        if (ageSeconds < splitAt) return;
        projectile._splitDone = true;
        const count = Math.max(2, Math.floor(normalizeNumber(modifier?.count, 3)));
        const speed = Math.max(0.2, normalizeNumber(modifier?.speed, Math.hypot(projectile.vx || 0, projectile.vy || 0) || 2.5));
        const baseAngle = Math.atan2(projectile.vy || 0, projectile.vx || 0);
        for (let i = 0; i < count; i += 1) {
            const angle = baseAngle + ((i * Math.PI * 2) / count);
            queueSpawn(projectile, {
                x: projectile.x,
                y: projectile.y,
                z: projectile.z,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                team: projectile.team,
                projectileType: projectile.projectileType
            });
        }
        projectile.life = Math.min(projectile.life, 1);
    });

    registerModifier('explode_on_timeout', (projectile, modifier) => {
        if (projectile._timeoutExplodeDone) return;
        if ((Number(projectile.life) || 0) > 1) return;
        projectile._timeoutExplodeDone = true;
        const count = Math.max(4, Math.floor(normalizeNumber(modifier?.count, 8)));
        const speed = Math.max(0.2, normalizeNumber(modifier?.speed, 2.8));
        for (let i = 0; i < count; i += 1) {
            const angle = (i * Math.PI * 2) / count;
            queueSpawn(projectile, {
                x: projectile.x,
                y: projectile.y,
                z: projectile.z,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                team: projectile.team,
                projectileType: projectile.projectileType
            });
        }
    });

    registerModifier('pierce', (projectile, modifier) => {
        const value = Math.max(0, Math.floor(normalizeNumber(modifier?.value, normalizeNumber(modifier?.count, 0))));
        projectile.remainingPierce = Math.max(Number(projectile.remainingPierce) || 0, value);
    });

    registerModifier('dash_clearable', (projectile, modifier) => {
        projectile.collision = projectile.collision || {};
        projectile.collision.canBeCleared = modifier?.enabled !== false;
    });

    registerModifier('grazable', (projectile, modifier) => {
        projectile.grazable = modifier?.enabled !== false;
    });

    registerModifier('pulse', (projectile, modifier, deltaMs) => {
        const amp = Math.max(0, normalizeNumber(modifier?.amplitude, 0.18));
        const freq = Math.max(0.01, normalizeNumber(modifier?.frequency, 2));
        projectile._pulseMs = (Number(projectile._pulseMs) || 0) + Math.max(0, Number(deltaMs) || 0);
        const wave = 1 + (Math.sin((projectile._pulseMs / 1000) * Math.PI * 2 * freq) * amp);
        projectile.visualScaleMultiplier = wave;
    });

    registerModifier('spin', (projectile, modifier, deltaMs) => {
        const degPerSecond = normalizeNumber(modifier?.degreesPerSecond, 180);
        projectile.visualSpin = (Number(projectile.visualSpin) || 0) + ((degPerSecond * Math.PI / 180) * ((Number(deltaMs) || 0) / 1000));
    });

    registerModifier('color_shift', (projectile, modifier, deltaMs) => {
        const speed = Math.max(0.01, normalizeNumber(modifier?.speed, 0.8));
        projectile._colorShiftMs = (Number(projectile._colorShiftMs) || 0) + Math.max(0, Number(deltaMs) || 0);
        const t = (projectile._colorShiftMs / 1000) * speed;
        const colorA = Number(modifier?.fromColor);
        const colorB = Number(modifier?.toColor);
        if (!Number.isFinite(colorA) || !Number.isFinite(colorB)) return;
        const mix = (Math.sin(t * Math.PI * 2) + 1) * 0.5;
        const ar = (colorA >> 16) & 0xff; const ag = (colorA >> 8) & 0xff; const ab = colorA & 0xff;
        const br = (colorB >> 16) & 0xff; const bg = (colorB >> 8) & 0xff; const bb = colorB & 0xff;
        const rr = Math.round(ar + ((br - ar) * mix));
        const rg = Math.round(ag + ((bg - ag) * mix));
        const rb = Math.round(ab + ((bb - ab) * mix));
        projectile.visualColor = (rr << 16) | (rg << 8) | rb;
    });

    registerModifier('scale_over_time', (projectile, modifier) => {
        const duration = Math.max(0.01, normalizeNumber(modifier?.durationSeconds, 1));
        const age = (Number(projectile.ageMs) || 0) / 1000;
        const t = clamp(age / duration, 0, 1);
        const from = Math.max(0.1, normalizeNumber(modifier?.from, 1));
        const to = Math.max(0.1, normalizeNumber(modifier?.to, 1.5));
        projectile.visualScaleMultiplier = from + ((to - from) * t);
    });

    registerModifier('alpha_over_time', (projectile, modifier) => {
        const duration = Math.max(0.01, normalizeNumber(modifier?.durationSeconds, 1));
        const age = (Number(projectile.ageMs) || 0) / 1000;
        const t = clamp(age / duration, 0, 1);
        const from = clamp(normalizeNumber(modifier?.from, 1), 0.05, 1);
        const to = clamp(normalizeNumber(modifier?.to, 0.2), 0.05, 1);
        projectile.visualAlpha = from + ((to - from) * t);
    });

    registerModifier('warning_until_active', (projectile) => {
        const activeAfterMs = Math.max(0, Number(projectile?.collision?.activeAfterSeconds) || 0) * 1000;
        projectile.visualAlpha = (Number(projectile?.ageMs) || 0) < activeAfterMs ? 0.35 : 1;
    });

    window.TDSPatternRegistry = {
        firePattern,
        generatePatternSpawns,
        applyModifiers,
        registerPattern,
        registerModifier
    };
})();
