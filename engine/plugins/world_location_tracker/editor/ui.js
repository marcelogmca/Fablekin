// engine/plugins/world_location_tracker/editor/ui.js

import { state, el } from './state.js';
import { escapeHtml } from './utils.js';
import { getAreaDepth, getAreaHierarchy, resolveAreaContext } from './logic.js';

export function setStatus(message, isError) {
    if (!el.status) return;
    el.status.textContent = message; el.status.classList.toggle('error', !!isError);
}

export function syncSaveAffordance() {
    const isDirty = !!state.dirty; const isSaving = !!state.saving;
    if (el.root) { el.root.classList.toggle('has-unsaved-changes', isDirty); el.root.classList.toggle('is-saving-world-map', isSaving); }
    if (el.dirtyPill) {
        el.dirtyPill.textContent = isSaving ? 'Saving' : (isDirty ? 'Unsaved' : 'Saved');
        el.dirtyPill.classList.toggle('muted', !isDirty && !isSaving);
        el.dirtyPill.classList.toggle('unsaved', isDirty && !isSaving);
        el.dirtyPill.classList.toggle('saving', isSaving);
    }
    [el.saveBtn, el.saveNudgeBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = isSaving || !isDirty;
        btn.textContent = isSaving ? 'Saving...' : (isDirty ? 'Save Changes' : 'Saved');
        btn.classList.toggle('world-map-btn-save-attention', isDirty && !isSaving);
    });
}

export function setDirty(isDirty, reason = 'manual') {
    if (isDirty) {
        state.dirty = true;
        if (reason) state.dirtyReasons.add(String(reason));
    } else {
        state.dirty = false;
        state.dirtyReasons.clear();
    }
    state.saving = false;
    syncSaveAffordance();
}

export function getAreaTrailLabel(area, areas) {
    if (!area) return 'none';
    const areaMap = new Map(areas.map(a => [a.uid, a]));
    return getAreaHierarchy(area, areaMap).map(item => item.name || 'Untitled Area').join(' / ');
}

export function renderNodeList() {
    if (!el.nodeList) return;
    const all = state.worldData.nodes || [];
    const filtered = all.filter(n => {
        const ctx = resolveAreaContext(n.world_x || 0, n.world_y || 0, state.worldData.areas);
        const query = state.indexSearch.toLowerCase();
        return !query || [n.name, n.type, n.description, n.tags, getAreaTrailLabel(ctx.primaryArea, state.worldData.areas)].some(s => String(s || '').toLowerCase().includes(query));
    });
    if (el.nodeCount && state.activeIndexTab === 'nodes') el.nodeCount.textContent = state.indexSearch ? `${filtered.length}/${all.length} locations` : `${all.length} locations`;
    if (all.length === 0) { el.nodeList.innerHTML = '<div class="world-map-list-empty">No locations yet.</div>'; return; }
    el.nodeList.innerHTML = filtered.map(n => `
        <div class="world-map-item ${n.uid === state.selectedNodeId ? 'active' : ''}" data-node-id="${n.uid}">
            <div class="world-map-swatch" style="background-color: #7bd8cf;"></div>
            <div><strong>${escapeHtml(n.name || 'Untitled')}</strong><span>${escapeHtml(n.type || 'POI')} - ${Math.round(n.world_x)}, ${Math.round(n.world_y)}</span></div>
        </div>
    `).join('');
}

export function renderAreaList() {
    if (!el.areaList) return;
    const all = state.worldData.areas || [];
    const areaMap = new Map(all.map(a => [a.uid, a]));
    const sorted = [...all].sort((a, b) => getAreaDepth(a, areaMap) - getAreaDepth(b, areaMap) || getAreaTrailLabel(a, all).localeCompare(getAreaTrailLabel(b, all)));
    const filtered = sorted.filter(a => {
        const query = state.indexSearch.toLowerCase();
        return !query || [a.name, a.kind, a.tags, a.description, getAreaTrailLabel(a, all)].some(s => String(s || '').toLowerCase().includes(query));
    });
    if (el.areaCount) el.areaCount.textContent = `${all.length} areas`;
    el.areaList.innerHTML = filtered.map(a => `
        <div class="world-map-item ${a.uid === state.selectedAreaId ? 'active' : ''}" data-area-id="${a.uid}">
            <div class="world-map-swatch" style="background-color: ${escapeHtml(a.color || '#4f8fc0')};"></div>
            <div><strong>${escapeHtml(a.name || 'Untitled')}</strong><span>${escapeHtml(a.kind || 'region')} | ${a.geometry.points.length} points</span></div>
        </div>
    `).join('');
}

export function renderBiomeList() {
    if (!el.biomeList) return;
    const all = state.worldData.biomes?.palette || [];
    const query = state.indexSearch.toLowerCase();
    const filtered = all.filter(b => !query || [b.label, b.id, b.color].some(s => String(s || '').toLowerCase().includes(query)));
    if (el.biomeCount) el.biomeCount.textContent = `${all.length} biomes`;
    if (el.biomeTotal) el.biomeTotal.textContent = String(all.length);
    if (all.length === 0) {
        el.biomeList.innerHTML = '<div class="world-map-list-empty">No biomes yet.</div>';
        return;
    }
    el.biomeList.innerHTML = filtered.map(b => `
        <div class="world-map-item ${b.id === state.selectedBiomeId ? 'active' : ''}" data-biome-id="${escapeHtml(b.id)}">
            <div class="world-map-swatch" style="background-color: ${escapeHtml(b.color || '#ffffff')};"></div>
            <div>
                <strong>${escapeHtml(b.label || 'Untitled')}</strong>
                <span>
                    ${escapeHtml(b.id || 'biome')} - ${escapeHtml(b.color || '')}
                    ${b.needs_boat ? '<em class="world-map-mini-badge">needs boat</em>' : ''}
                    ${b.slows_down ? '<em class="world-map-mini-badge">slows</em>' : ''}
                    ${b.is_road ? '<em class="world-map-mini-badge">road</em>' : ''}
                    ${b.is_river ? '<em class="world-map-mini-badge">river</em>' : ''}
                </span>
            </div>
        </div>
    `).join('');
}
