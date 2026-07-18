/**
 * engine/views/vn_viewer/js/vn_ucp_dispatcher.js
 *
 * Frontend UCP command dispatcher.
 * Parses a UCP command string and dispatches the corresponding CustomEvent.
 * Used by the generic socket bridge (vn-command) and VN.command() API.
 */

import { debugLog, debugError } from './utils.js';

// --- UCP Parser (Frontend ES Module copy) ---
// This is the same grammar as engine/modules/ucp_parser.js (backend, CommonJS).
// Kept as a separate copy because the frontend uses ES modules and can't require() Node modules.
// If the grammar changes, both files must be updated.

const SHADOW_OPTION_ALIASES = Object.freeze({
    angle: 'angleDegrees',
    angledegrees: 'angleDegrees',
    angle_degrees: 'angleDegrees',
    opacity: 'opacity',
    strength: 'opacity',
    alpha: 'opacity',
    length: 'length',
    blur: 'blur'
});

const CAM_BACKGROUND_DEFAULTS = Object.freeze({
    duration: 2,
    zoom: 1.08,
    ease: 'power2.out'
});

const CAM_BACKGROUND_ZOOM_MIN = 1;
const CAM_BACKGROUND_ZOOM_MAX = 1.35;

function parseShadowValue(value) {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(lower)) return true;
    if (['false', 'no', 'off', '0'].includes(lower)) return false;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
}

function parseShadowCommand(parts) {
    const action = String(parts[1] || '').trim().toLowerCase();
    const rawBody = parts.slice(2).join(':').trim();
    if (!rawBody) return null;

    const segments = rawBody.split('|').map(token => token.trim()).filter(Boolean);
    const charName = segments.shift();
    if (!charName) return null;

    if (['off', 'disable', 'disabled', 'clear'].includes(action)) {
        return {
            type: 'vn:sprite-shadow',
            payload: { charName, shadow: { enabled: false } }
        };
    }

    if (!['on', 'enable', 'enabled', 'set'].includes(action)) return null;

    const shadow = { enabled: true };
    for (const token of segments) {
        const eqIdx = token.indexOf('=');
        if (eqIdx <= 0) continue;
        const rawKey = token.slice(0, eqIdx).trim();
        const rawValue = token.slice(eqIdx + 1).trim();
        if (!rawKey || !rawValue) continue;

        const canonicalKey = SHADOW_OPTION_ALIASES[rawKey.replace(/[-\s]/g, '_').toLowerCase()];
        if (!canonicalKey) continue;
        shadow[canonicalKey] = parseShadowValue(rawValue);
    }

    return { type: 'vn:sprite-shadow', payload: { charName, shadow } };
}

function normalizeCamBackgroundZoom(rawZoom) {
    const parsed = Number.parseFloat(rawZoom);
    if (!Number.isFinite(parsed)) return null;

    // Guardrail: some generators send percentage-style zoom (e.g. 100 for 100%).
    const scalar = parsed > 10 ? parsed / 100 : parsed;
    if (!Number.isFinite(scalar)) return null;

    return Math.min(CAM_BACKGROUND_ZOOM_MAX, Math.max(CAM_BACKGROUND_ZOOM_MIN, scalar));
}

function parseCamBackgroundOptions(parts, basePayload) {
    const payload = { ...basePayload, ...CAM_BACKGROUND_DEFAULTS };
    for (let i = 2; i < parts.length; i++) {
        const token = String(parts[i] || '').trim();
        if (!token) continue;
        const lower = token.toLowerCase();
        if (lower.startsWith('for=')) {
            const duration = Number.parseInt(token.slice(4), 10);
            if (Number.isFinite(duration) && duration > 0) payload.duration = duration;
            continue;
        }
        if (lower.startsWith('zoom=')) {
            const zoom = normalizeCamBackgroundZoom(token.slice(5));
            if (zoom !== null) payload.zoom = zoom;
            continue;
        }
        if (lower.startsWith('ease=')) {
            const ease = token.slice(5).trim();
            if (ease) payload.ease = ease;
        }
    }
    return payload;
}

function parseCommandToUCP(cmd) {
    if (typeof cmd !== 'string' || !cmd.trim()) return null;

    const rawCommand = cmd.trim();
    const parts = rawCommand.split(':');
    const prefix = parts[0];

    // Modifiers in the string (e.g. :locked, :instant)
    const isLocked = cmd.includes(':locked');
    const isInstant = cmd.includes(':instant');

    // 1. CAMERA (cam:mode:...)
    if (prefix === 'cam') {
        const mode = parts[1]; // wide, auto
        const payload = { instant: isInstant, locked: isLocked };

        if (mode === 'wide') return { type: 'cam:wide', payload };
        if (mode === 'auto') return { type: 'cam:auto_zoom', payload };
        if (mode === 'background') {
            return {
                type: 'cam:background_focus',
                payload: parseCamBackgroundOptions(parts, payload)
            };
        }

        return null;
    }

    // 2. ANIMATIONS (anim:type:character_name)
    if (prefix === 'anim') {
        const animType = parts[1];
        const charName = parts[2];
        if (!charName) return null; // Character name is required for anims

        if (['bounce', 'shake', 'sink', 'slowsink', 'panic'].includes(animType)) {
            return { type: `vn:anim-${animType}`, payload: { charName } };
        }
        return null;
    }

    // 3. EMOTES (emote:type:character_name)
    if (prefix === 'emote') {
        const emoteType = parts[1];
        const charName = parts[2];
        if (!charName) return null;
        return { type: 'vn:emote', payload: { type: emoteType, charName } };
    }

    // 4. SPRITE SHADOWS (shadow:on:Character|angle=82|opacity=0.35 OR shadow:off:Character)
    if (prefix === 'shadow') {
        return parseShadowCommand(parts);
    }

    // 4. CAST (cast:action)
    if (prefix === 'cast') {
        const action = parts[1];
        if (action === 'flush') return { type: 'vn:cast-flush', payload: {} };
        if (action === 'enter' || action === 'show') {
            const actors = [];
            const options = {};
            for (let i = 2; i < parts.length; i++) {
                const token = String(parts[i] || '').trim();
                if (!token) continue;
                const lower = token.toLowerCase();
                if (lower === 'instant') {
                    options.instant = true;
                    continue;
                }
                if (token.includes('=')) {
                    const eqIdx = token.indexOf('=');
                    const key = token.slice(0, eqIdx).trim();
                    const value = token.slice(eqIdx + 1).trim();
                    if (key && value) options[key] = value;
                    continue;
                }
                token.split(',').map(v => v.trim()).filter(Boolean).forEach(actor => actors.push(actor));
            }
            if (actors.length === 0) return null;
            return { type: 'vn:cast-enter', payload: { actors, options } };
        }
        return null;
    }

    // 5. VFX (vfx:action:id:payload)
    if (prefix === 'vfx') {
        const action = parts[1]; // start, clear, trigger
        const id = parts[2];
        if (!id) return null;

        const type = action === 'start' ? 'vfx:state' :
            action === 'clear' ? 'vfx:clear' : 'vfx:trigger';

        // Optional 4th part: JSON payload
        let extraParams = {};
        if (parts[3]) {
            try {
                // Join back remaining parts in case the JSON contains colons
                const jsonStr = parts.slice(3).join(':');
                extraParams = JSON.parse(jsonStr);
            } catch {
                // ignore invalid JSON
            }
        }

        return {
            type,
            payload: { id, instant: isInstant, locked: isLocked, ...extraParams }
        };
    }

    // 3. SFX (sfx:action:file)
    if (prefix === 'sfx') {
        const action = parts[1]; // start, stop, trigger
        const file = parts[2];
        if (!file) return null;

        return {
            type: action === 'stop' ? 'sfx:stop' : 'sfx:play',
            payload: {
                file: file,
                loop: action === 'start',
                category: action === 'start' ? 'background' : 'effect',
                locked: isLocked
            }
        };
    }

    // 4. VN TRANSITIONS (transition:effect|scope=scene|duration=900|blocking=true)
    if (prefix === 'transition') {
        const rawBody = parts.slice(1).join(':').trim();
        if (!rawBody) return null;

        const segments = rawBody.split('|').map(token => token.trim()).filter(Boolean);
        if (segments.length === 0) return null;

        const descriptor = {
            effect: String(segments[0] || '').trim().toLowerCase(),
            scope: 'scene',
            blocking: true
        };
        const extraOptions = {};

        for (let i = 1; i < segments.length; i++) {
            const token = segments[i];
            const eqIndex = token.indexOf('=');
            if (eqIndex <= 0) continue;
            const key = token.slice(0, eqIndex).trim().toLowerCase();
            const value = token.slice(eqIndex + 1).trim();
            if (!value) continue;

            if (key === 'scope') descriptor.scope = value.toLowerCase();
            else if (key === 'target') descriptor.target = value;
            else if (key === 'duration' || key === 'durationms') {
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed) && parsed >= 0) descriptor.durationMs = parsed;
            } else if (key === 'blocking') {
                descriptor.blocking = ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
            } else if (key === 'direction') descriptor.direction = value.toLowerCase();
            else if (key === 'easing' || key === 'ease') descriptor.easing = value;
            else extraOptions[key] = value;
        }

        if (!descriptor.effect) return null;
        if (Object.keys(extraOptions).length > 0) descriptor.options = extraOptions;
        return { type: 'vn:transition', payload: descriptor };
    }

    // 4. TRANSITIONS (scene:transition:type:bg)
    if (prefix === 'scene') {
        const action = parts[1];
        if (action === 'transition') {
            const type = parts[2] || 'fade_to_black';
            const bg = parts[3];
            return {
                type: 'scene:transition',
                payload: { src: bg, transition: type, instant: isInstant || type === 'instant' }
            };
        }
    }

    // 5. SPATIAL STAGE (spatial:on|off|auto or stage:on|off|auto)
    if (prefix === 'spatial' || prefix === 'stage') {
        const mode = String(parts[1] || '').trim().toLowerCase();
        if (!['on', 'off', 'auto'].includes(mode)) return null;
        return {
            type: 'spatial-stage:set',
            payload: { mode }
        };
    }

    // 6. TITLES (title:{...json...})
    if (prefix === 'title') {
        const remaining = parts.slice(1).join(':').trim();

        // Check if it's JSON
        if (remaining.startsWith('{') && remaining.endsWith('}')) {
            try {
                const config = JSON.parse(remaining);
                return { type: 'vn:title-popout', payload: config };
            } catch { return null; }
        }
        return null;
    }

    // 7. GAME OVER (gameover or gameover:text:subtext)
    if (prefix === 'gameover') {
        const text = parts[1] || 'GAME OVER';
        const subtext = parts.slice(2).join(':') || '';
        return {
            type: 'vn:game-over',
            payload: { text, subtext }
        };
    }

    // 8. OST (ost:action:duration)
    if (prefix === 'ost') {
        const action = parts[1];
        if (action === 'silence') {
            const duration = parseInt(parts[2]) || 5;
            return { type: 'ost:silence', payload: { duration } };
        }
    }

    // 9. COMPOSITION (comp:preset:actors:options)
    if (prefix === 'comp') {
        const preset = String(parts[1] || '').trim().toLowerCase();
        const validPresets = new Set([
            'default', 'duel', 'separate', 'intimate', 'triangle',
            'protective', 'observer', 'isolate', 'group_small',
            'tiny_in_world', 'close', 'over_shoulder', 'lineup',
            'cluster'
        ]);
        if (!preset || !validPresets.has(preset)) return null;

        const actors = [];
        const options = {};
        for (let i = 2; i < parts.length; i++) {
            const token = String(parts[i] || '').trim();
            if (!token) continue;
            const lower = token.toLowerCase();
            if (lower === 'locked') {
                options.locked = true;
                continue;
            }
            if (lower === 'instant') {
                options.instant = true;
                continue;
            }
            if (lower.startsWith('for=')) {
                const parsedFor = Number.parseInt(token.slice(4), 10);
                if (Number.isFinite(parsedFor) && parsedFor > 0) options.for = parsedFor;
                continue;
            }
            if (lower.startsWith('ease=')) {
                const ease = token.slice(5).trim();
                if (ease) options.ease = ease;
                continue;
            }
            if (token.includes('=')) {
                const eqIdx = token.indexOf('=');
                const key = token.slice(0, eqIdx).trim();
                const value = token.slice(eqIdx + 1).trim();
                if (key && value) options[key] = value;
                continue;
            }
            actors.push(token);
        }

        return { type: 'comp:set', payload: { preset, actors, options }, originalCommand: rawCommand };
    }

    return null;
}

/**
 * Parses a UCP command string and dispatches it as the appropriate CustomEvent.
 * @param {string} cmdString - UCP command (e.g. "sfx:trigger:boom.mp3")
 * @returns {boolean} True if dispatched, false if invalid command.
 */
export function dispatchUCPCommand(cmdString) {
    if (typeof cmdString !== 'string' || !cmdString.trim()) return false;

    const event = parseCommandToUCP(cmdString);
    if (!event) {
        debugError(`[UCP Dispatcher] Invalid command: "${cmdString}"`);
        return false;
    }

    debugLog(`[UCP Dispatcher] Dispatching: ${event.type}`, event.payload);
    window.dispatchEvent(new CustomEvent(event.type, { detail: event.payload }));
    return true;
}
