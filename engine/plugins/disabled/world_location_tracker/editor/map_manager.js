// engine/plugins/world_location_tracker/editor/map_manager.js

import { state } from './state.js';
import { toNumber } from './utils.js';

const LEAFLET_CSS_URL = new URL('../lib/leaflet.css', import.meta.url).href;
const LEAFLET_JS_URL = new URL('../lib/leaflet.js', import.meta.url).href;

export function loadLeaflet() {
    return new Promise((resolve, reject) => {
        if (window.L) { resolve(); return; }
        if (!document.querySelector('link[data-world-map-leaflet]')) {
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = LEAFLET_CSS_URL;
            link.setAttribute('data-world-map-leaflet', 'true'); document.head.appendChild(link);
        }
        const existing = document.querySelector('script[data-world-map-leaflet]');
        if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
        const script = document.createElement('script'); script.src = LEAFLET_JS_URL;
        script.setAttribute('data-world-map-leaflet', 'true'); script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
}

export function toMapLatLng(x, y) {
    const scale = state.mapScale || 1;
    return [toNumber(y, 0) / scale, toNumber(x, 0) / scale];
}

export function fromMapLatLng(latLng) {
    const scale = state.mapScale || 1;
    return { x: Math.round(toNumber(latLng?.lng, 0) * scale), y: Math.round(toNumber(latLng?.lat, 0) * scale) };
}

export function buildNodeIcon(isSelected) {
    return window.L.divIcon({ className: '', html: `<div class="world-map-marker ${isSelected ? 'selected' : ''}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

export function buildOriginIcon() {
    return window.L.divIcon({ className: '', html: '<div class="world-map-origin-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
}

export function buildDraftVertexIcon() {
    return window.L.divIcon({ className: '', html: '<div class="world-map-draft-vertex"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
}

export function destroyMap() {
    if (state.map) { state.map.remove(); state.map = null; }
    state.nodeMarkers = []; state.areaLayers = []; state.draftAreaLayer = null; state.originMarker = null; state.biomeOverlay = null; state.biomeBrushPreviewEl = null;
}
