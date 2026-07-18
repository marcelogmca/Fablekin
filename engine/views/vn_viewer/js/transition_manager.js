import { pixiApp } from './pixi_engine.js';
import { debugError, debugLog } from './utils.js';

const DEFAULT_DESCRIPTOR = Object.freeze({
    effect: 'fade',
    scope: 'scene',
    target: null,
    durationMs: 800,
    direction: 'in',
    easing: 'power2.inOut',
    blocking: true,
    options: {}
});

const KNOWN_SCOPES = new Set(['scene', 'background', 'characters', 'intercept']);
const transitionRegistry = new Map();
let builtinsRegistered = false;
let listenersInitialized = false;

function parseBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return fallback;
}

function normalizeDescriptor(raw = {}) {
    const source = (raw && typeof raw === 'object') ? raw : {};
    const effect = String(source.effect || DEFAULT_DESCRIPTOR.effect).trim().toLowerCase();
    const rawScope = String(source.scope || DEFAULT_DESCRIPTOR.scope).trim().toLowerCase();
    const scope = KNOWN_SCOPES.has(rawScope) ? rawScope : DEFAULT_DESCRIPTOR.scope;
    const durationMs = Number.isFinite(Number(source.durationMs))
        ? Math.max(0, Math.min(15000, Number(source.durationMs)))
        : DEFAULT_DESCRIPTOR.durationMs;
    const direction = String(source.direction || DEFAULT_DESCRIPTOR.direction).trim().toLowerCase();
    const easing = String(source.easing || DEFAULT_DESCRIPTOR.easing).trim();
    const blocking = parseBoolean(source.blocking, DEFAULT_DESCRIPTOR.blocking);
    const options = (source.options && typeof source.options === 'object') ? { ...source.options } : {};

    return {
        effect,
        scope,
        target: source.target || null,
        durationMs,
        direction,
        easing: easing || DEFAULT_DESCRIPTOR.easing,
        blocking,
        options
    };
}

function buildDeadline(durationMs) {
    return Math.max(1000, Math.min(20000, durationMs + 1200));
}

function waitForGsap(target, vars, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        let timeoutHandle = null;

        const finalize = (ok, reason = null) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            resolve({ ok, reason });
        };

        timeoutHandle = setTimeout(() => finalize(false, 'timeout'), timeoutMs);
        try {
            gsap.to(target, {
                ...vars,
                onComplete: () => finalize(true),
                onInterrupt: () => finalize(false, 'interrupted')
            });
        } catch (error) {
            finalize(false, error?.message || 'gsap_error');
        }
    });
}

function createPixiOverlayHost() {
    if (!pixiApp?.layers?.titles) return null;
    const host = new PIXI.Container();
    host.label = 'TransitionOverlayHost';
    pixiApp.layers.titles.addChild(host);
    return host;
}

function destroyPixiOverlayHost(host) {
    if (!host) return;
    try { gsap.killTweensOf(host); } catch (_) { }
    try {
        if (host.parent) host.parent.removeChild(host);
    } catch (_) { }
    try {
        host.destroy({ children: true });
    } catch (_) { }
}

function getPixiTarget(scope, context = {}) {
    if (!pixiApp?.app || !pixiApp?.layers) return null;
    if (scope === 'background') return pixiApp.layers.background;
    if (scope === 'characters') return pixiApp.layers.characters;
    if (scope === 'intercept') return context?.pixiLayer || pixiApp.layers.interceptActors || pixiApp.layers.titles;
    return pixiApp.world || null;
}

function resolveDomTarget(context = {}) {
    if (context?.domElement) return context.domElement;
    if (context?.hostEl) return context.hostEl;
    if (context?.scope === 'intercept') {
        return document.getElementById('plugin-overlay') || document.querySelector('.plugin-intercept-nonblocking-host');
    }
    return null;
}

async function runDomTransition(targetEl, descriptor) {
    const effect = descriptor.effect;
    const durationSec = descriptor.durationMs / 1000;
    const fadeIn = descriptor.direction !== 'out';
    const axis = String(descriptor.options?.axis || descriptor.direction || 'left').toLowerCase();
    const wipeDirection = effect.replace('wipe_', '') || axis;
    const restoreVisibleState = () => {
        try {
            gsap.set(targetEl, { clearProps: 'opacity,transform,filter,clipPath,willChange' });
        } catch (_) {
            targetEl.style.opacity = '1';
            targetEl.style.transform = '';
            targetEl.style.filter = '';
            targetEl.style.clipPath = '';
            targetEl.style.willChange = '';
        }
    };

    let from = { opacity: fadeIn ? 0 : 1 };
    let to = { opacity: fadeIn ? 1 : 0 };

    if (effect === 'circle_fade') {
        from = { clipPath: fadeIn ? 'circle(0% at 50% 50%)' : 'circle(150% at 50% 50%)', opacity: 1 };
        to = { clipPath: fadeIn ? 'circle(150% at 50% 50%)' : 'circle(0% at 50% 50%)', opacity: 1 };
    } else if (effect.startsWith('wipe_')) {
        const hidden = {
            right: 'inset(0 100% 0 0)',
            up: 'inset(100% 0 0 0)',
            down: 'inset(0 0 100% 0)',
            left: 'inset(0 0 0 100%)'
        }[wipeDirection] || 'inset(0 0 0 100%)';
        from = { clipPath: fadeIn ? hidden : 'inset(0 0 0 0)', opacity: 1 };
        to = { clipPath: fadeIn ? 'inset(0 0 0 0)' : hidden, opacity: 1 };
    } else if (effect === 'slide_push') {
        const offset = (axis === 'right' ? -6 : 6);
        from = { opacity: fadeIn ? 0 : 1, xPercent: fadeIn ? offset : 0 };
        to = { opacity: fadeIn ? 1 : 0, xPercent: fadeIn ? 0 : -offset };
    } else if (effect === 'zoom_blur') {
        from = { opacity: fadeIn ? 0 : 1, scale: fadeIn ? 1.04 : 1, filter: fadeIn ? 'blur(10px)' : 'blur(0px)' };
        to = { opacity: fadeIn ? 1 : 0, scale: fadeIn ? 1 : 1.04, filter: fadeIn ? 'blur(0px)' : 'blur(10px)' };
    } else if (effect === 'flash_cut') {
        from = { opacity: fadeIn ? 0.15 : 1, filter: 'brightness(2.2)' };
        to = { opacity: fadeIn ? 1 : 0, filter: 'brightness(1)' };
    } else {
        from = { opacity: fadeIn ? 0 : 1, scale: fadeIn ? 0.985 : 1, filter: fadeIn ? 'blur(4px)' : 'blur(0px)' };
        to = { opacity: fadeIn ? 1 : 0, scale: fadeIn ? 1 : 1.015, filter: 'blur(0px)' };
    }

    targetEl.style.willChange = 'opacity, transform, filter';
    try { gsap.killTweensOf(targetEl); } catch (_) { }
    try {
        gsap.set(targetEl, from);
        await waitForGsap(targetEl, {
            ...to,
            duration: durationSec,
            ease: descriptor.easing,
            overwrite: true
        }, buildDeadline(descriptor.durationMs));
    } finally {
        if (fadeIn) restoreVisibleState();
        else targetEl.style.willChange = '';
    }
    return { ok: true };
}

async function runFadeTransition(descriptor) {
    const host = createPixiOverlayHost();
    if (!host) return { ok: false, reason: 'pixi_unavailable' };

    const cover = new PIXI.Graphics();
    cover.rect(0, 0, pixiApp.LOGICAL_WIDTH, pixiApp.LOGICAL_HEIGHT);
    cover.fill({ color: 0x000000, alpha: 1 });
    cover.alpha = descriptor.direction === 'out' ? 0 : 1;
    host.addChild(cover);

    const result = await waitForGsap(cover, {
        alpha: descriptor.direction === 'out' ? 1 : 0,
        duration: descriptor.durationMs / 1000,
        ease: descriptor.easing
    }, buildDeadline(descriptor.durationMs));

    destroyPixiOverlayHost(host);
    return result;
}

async function runFlashCutTransition(descriptor) {
    const host = createPixiOverlayHost();
    if (!host) return { ok: false, reason: 'pixi_unavailable' };

    const flash = new PIXI.Graphics();
    flash.rect(0, 0, pixiApp.LOGICAL_WIDTH, pixiApp.LOGICAL_HEIGHT);
    flash.fill({ color: 0xffffff, alpha: 1 });
    flash.alpha = 0;
    host.addChild(flash);

    const half = Math.max(120, descriptor.durationMs * 0.5);
    await waitForGsap(flash, { alpha: 0.95, duration: half / 1000, ease: 'power2.out' }, buildDeadline(half));
    const result = await waitForGsap(flash, { alpha: 0, duration: half / 1000, ease: 'power2.in' }, buildDeadline(half));
    destroyPixiOverlayHost(host);
    return result;
}

async function runCircleFadeTransition(descriptor) {
    const target = getPixiTarget(descriptor.scope, descriptor);
    if (!target) return { ok: false, reason: 'target_unavailable' };
    const originalMask = target.mask || null;
    const mask = new PIXI.Graphics();
    mask.x = pixiApp.LOGICAL_WIDTH / 2;
    mask.y = pixiApp.LOGICAL_HEIGHT / 2;
    target.parent?.addChild(mask);
    target.mask = mask;

    const maxRadius = Math.hypot(pixiApp.LOGICAL_WIDTH, pixiApp.LOGICAL_HEIGHT);
    const state = { radius: descriptor.direction === 'out' ? maxRadius : 0 };
    const durationSec = descriptor.durationMs / 1000;
    const redraw = () => {
        mask.clear();
        mask.circle(0, 0, state.radius);
        mask.fill({ color: 0xffffff, alpha: 1 });
    };
    redraw();

    try {
        return await waitForGsap(state, {
            radius: descriptor.direction === 'out' ? 0 : maxRadius,
            duration: durationSec,
            ease: descriptor.easing,
            onUpdate: redraw
        }, buildDeadline(descriptor.durationMs));
    } finally {
        target.mask = originalMask;
        try { if (mask.parent) mask.parent.removeChild(mask); } catch (_) { }
        try { mask.destroy(); } catch (_) { }
    }
}

async function runWipeTransition(descriptor) {
    const target = getPixiTarget(descriptor.scope, descriptor);
    if (!target) return { ok: false, reason: 'target_unavailable' };
    const direction = descriptor.effect.replace('wipe_', '') || 'left';
    const originalMask = target.mask || null;
    const mask = new PIXI.Graphics();
    target.parent?.addChild(mask);
    target.mask = mask;

    const state = { progress: descriptor.direction === 'out' ? 1 : 0 };
    const redraw = () => {
        mask.clear();
        const w = pixiApp.LOGICAL_WIDTH;
        const h = pixiApp.LOGICAL_HEIGHT;
        const p = Math.max(0, Math.min(1, state.progress));
        if (direction === 'right') {
            mask.rect(w * (1 - p), 0, w * p, h);
        } else if (direction === 'up') {
            mask.rect(0, h * (1 - p), w, h * p);
        } else if (direction === 'down') {
            mask.rect(0, 0, w, h * p);
        } else {
            mask.rect(0, 0, w * p, h);
        }
        mask.fill({ color: 0xffffff, alpha: 1 });
    };
    redraw();

    try {
        return await waitForGsap(state, {
            progress: descriptor.direction === 'out' ? 0 : 1,
            duration: descriptor.durationMs / 1000,
            ease: descriptor.easing,
            onUpdate: redraw
        }, buildDeadline(descriptor.durationMs));
    } finally {
        target.mask = originalMask;
        try { if (mask.parent) mask.parent.removeChild(mask); } catch (_) { }
        try { mask.destroy(); } catch (_) { }
    }
}

async function runSlidePushTransition(descriptor) {
    const target = getPixiTarget(descriptor.scope, descriptor);
    if (!target) return { ok: false, reason: 'target_unavailable' };
    const dir = (descriptor.options?.axis || descriptor.direction || 'left').toLowerCase();
    const delta = (dir === 'right' ? 1 : -1) * Math.round(pixiApp.LOGICAL_WIDTH * 0.08);
    const originalX = target.x || 0;
    const timeline = gsap.timeline();
    const completion = new Promise((resolve) => {
        timeline
            .to(target, { x: originalX + delta, duration: (descriptor.durationMs / 2000), ease: descriptor.easing })
            .to(target, {
                x: originalX,
                duration: (descriptor.durationMs / 2000),
                ease: descriptor.easing,
                onComplete: () => resolve({ ok: true })
            });
    });
    return await Promise.race([
        completion,
        new Promise((resolve) => setTimeout(() => {
            try { timeline.kill(); } catch (_) { }
            target.x = originalX;
            resolve({ ok: false, reason: 'timeout' });
        }, buildDeadline(descriptor.durationMs)))
    ]);
}

async function runZoomBlurTransition(descriptor) {
    const target = getPixiTarget(descriptor.scope, descriptor);
    if (!target) return { ok: false, reason: 'target_unavailable' };
    const blurFilter = new PIXI.BlurFilter();
    blurFilter.blur = descriptor.direction === 'out' ? 0 : 14;
    const originalFilters = Array.isArray(target.filters) ? [...target.filters] : [];
    target.filters = [...originalFilters, blurFilter];
    const originalScaleX = target.scale?.x ?? 1;
    const originalScaleY = target.scale?.y ?? 1;
    const zoomTo = descriptor.direction === 'out' ? 1.08 : 1;
    const fromScale = descriptor.direction === 'out' ? 1 : 1.08;
    if (target.scale) target.scale.set(fromScale, fromScale);

    const half = Math.max(120, descriptor.durationMs / 2);
    const p1 = waitForGsap(blurFilter, { blur: descriptor.direction === 'out' ? 16 : 0, duration: half / 1000, ease: descriptor.easing }, buildDeadline(half));
    const p2 = target.scale
        ? waitForGsap(target.scale, { x: zoomTo, y: zoomTo, duration: descriptor.durationMs / 1000, ease: descriptor.easing }, buildDeadline(descriptor.durationMs))
        : Promise.resolve({ ok: true });
    try {
        const results = await Promise.all([p1, p2]);
        return results.every(r => r.ok) ? { ok: true } : { ok: false, reason: 'interrupted' };
    } finally {
        target.filters = originalFilters;
        if (target.scale) target.scale.set(originalScaleX, originalScaleY);
    }
}

function registerBuiltinTransitions() {
    if (builtinsRegistered) return;
    registerTransition('fade', runFadeTransition);
    registerTransition('crossfade', runFadeTransition);
    registerTransition('circle_fade', runCircleFadeTransition);
    registerTransition('slide_push', runSlidePushTransition);
    registerTransition('zoom_blur', runZoomBlurTransition);
    registerTransition('flash_cut', runFlashCutTransition);
    registerTransition('wipe_left', runWipeTransition);
    registerTransition('wipe_right', runWipeTransition);
    registerTransition('wipe_up', runWipeTransition);
    registerTransition('wipe_down', runWipeTransition);
    builtinsRegistered = true;
}

export function registerTransition(name, implFn) {
    const key = String(name || '').trim().toLowerCase();
    if (!key || typeof implFn !== 'function') return false;
    transitionRegistry.set(key, implFn);
    return true;
}

export async function playTransition(rawDescriptor = {}, context = {}) {
    registerBuiltinTransitions();
    const descriptor = normalizeDescriptor(rawDescriptor);
    const runner = transitionRegistry.get(descriptor.effect);

    if (!runner) {
        debugLog(`[TransitionManager] Unknown transition effect "${descriptor.effect}".`);
        return { ok: true, reason: 'unknown_effect' };
    }

    const domTarget = resolveDomTarget({ ...context, scope: descriptor.scope });
    if (descriptor.scope === 'intercept' && domTarget instanceof HTMLElement) {
        try {
            await runDomTransition(domTarget, descriptor);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: error?.message || 'dom_transition_error' };
        }
    }

    try {
        const result = await runner({ ...descriptor, ...context });
        return result && typeof result === 'object' ? result : { ok: true };
    } catch (error) {
        debugError('[TransitionManager] Transition execution failed', error);
        return { ok: false, reason: error?.message || 'transition_error' };
    }
}

export function initTransitionRuntimeListeners() {
    if (listenersInitialized) return;
    registerBuiltinTransitions();
    window.addEventListener('vn:transition', (event) => {
        const descriptor = event?.detail || {};
        const normalized = normalizeDescriptor(descriptor);
        if (normalized.blocking) {
            playTransition(normalized).catch(error => debugError('[TransitionManager] Blocking event failed', error));
            return;
        }
        playTransition(normalized).catch(error => debugError('[TransitionManager] Non-blocking event failed', error));
    });
    listenersInitialized = true;
}
