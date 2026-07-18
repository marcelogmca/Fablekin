// engine/plugins/world_location_tracker/editor/ui_handlers.js

import { SOCKET } from './state.js';
import { setStatus } from './ui.js';

export function onDom(target, eventName, handler, options, cleanupFns) {
    if (!target) return;
    target.addEventListener(eventName, handler, options);
    cleanupFns.push(() => target.removeEventListener(eventName, handler, options));
}

export function onSocket(eventName, handler, cleanupFns) {
    if (!SOCKET) return;
    SOCKET.on(eventName, handler);
    cleanupFns.push(() => { if (typeof SOCKET.off === 'function') SOCKET.off(eventName, handler); });
}

export function emitSocket(eventName, payload) {
    if (!SOCKET) { setStatus('Socket connection unavailable.', true); return false; }
    console.info(`[WorldMapEditor] Emitting ${eventName}`, payload);
    SOCKET.emit(eventName, payload);
    return true;
}
