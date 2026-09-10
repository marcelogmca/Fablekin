// engine/plugins/world_location_tracker/editor/interaction_manager.js

import { state, el, DEFAULT_DRAW_HINT } from './state.js';

export function setInteractionMode(mode) {
    state.interactionMode = mode;
    if (el.map) {
        el.map.classList.toggle('world-map-drawing', mode === 'draw-area');
        el.map.classList.toggle('world-map-painting', mode === 'paint-biome');
    }
    if (state.map?.dragging) {
        if (mode === 'paint-biome') state.map.dragging.disable();
        else state.map.dragging.enable();
    }
    if (el.modeIndicator) {
        let label = 'Mode: Pan';
        if (mode === 'add-node') label = 'Mode: Add Location';
        if (mode === 'set-origin') label = 'Mode: Set Origin';
        if (mode === 'draw-area') label = `Mode: Draw Area (${state.draftAreaPoints.length} points)`;
        if (mode === 'paint-biome') label = state.biomeEraser ? 'Mode: Erase Biome' : 'Mode: Paint Biome';
        el.modeIndicator.textContent = label;
    }
    updateInteractionButtons();
    syncDrawHint();
}

function updateInteractionButtons() {
    const drawing = state.interactionMode === 'draw-area';
    if (el.addNodeBtn) el.addNodeBtn.classList.toggle('active', state.interactionMode === 'add-node');
    if (el.originModeBtn) el.originModeBtn.classList.toggle('active', state.interactionMode === 'set-origin');
    if (el.drawAreaBtn) el.drawAreaBtn.classList.toggle('active', drawing);
    if (el.finishAreaBtn) el.finishAreaBtn.disabled = !drawing || state.draftAreaPoints.length < 3;
    if (el.cancelAreaBtn) el.cancelAreaBtn.disabled = !drawing;
}

function syncDrawHint() {
    if (!el.drawHint) return;
    if (state.interactionMode === 'paint-biome') {
        el.drawHint.textContent = 'Left-drag to paint the selected biome. Right-drag to pan. Enable eraser to clear painted terrain.';
        return;
    }
    if (state.interactionMode !== 'draw-area') { el.drawHint.textContent = DEFAULT_DRAW_HINT; return; }
    const parent = state.draftAreaParentId ? state.worldData.areas.find(a => a.uid === state.draftAreaParentId) : null;
    el.drawHint.textContent = parent ? `Drawing child area inside "${parent.name}". ${DEFAULT_DRAW_HINT}` : `Drawing top-level area. ${DEFAULT_DRAW_HINT}`;
}

export function renderTotals() {
    const n = (state.worldData.nodes || []).length;
    const a = (state.worldData.areas || []).length;
    const b = (state.worldData.biomes?.palette || []).length;
    if (el.nodeTotal) el.nodeTotal.textContent = String(n);
    if (el.areaTotal) el.areaTotal.textContent = String(a);
    if (el.biomeTotal) el.biomeTotal.textContent = String(b);
    if (el.nodeCount) el.nodeCount.textContent = `${n} locations`;
    if (el.areaCount) el.areaCount.textContent = `${a} areas`;
    if (el.biomeCount) el.biomeCount.textContent = `${b} biomes`;
}
