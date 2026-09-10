// engine/plugins/world_location_tracker/editor/form_manager.js

import { state, el, AREA_COLORS } from './state.js';
import { normalizeHexColor } from './utils.js';
import { resolveAreaContext } from './logic.js';
import { getAreaTrailLabel } from './ui.js';

function toFriendlyPackageLabel(packagePath) {
    const raw = String(packagePath || '').trim();
    if (!raw) return '';

    const normalized = raw.replace(/\\/g, '/');
    const marker = '/workspace/projects/';
    const markerIndex = normalized.toLowerCase().indexOf(marker);
    if (markerIndex >= 0) return normalized.slice(markerIndex + 1);

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length <= 2) return normalized;
    return segments.slice(-2).join('/');
}

export function syncMetaForm() {
    const meta = state.worldData.meta || {};
    if (el.packageLabel) {
        el.packageLabel.textContent = toFriendlyPackageLabel(state.WORLD_PACKAGE_PATH);
        el.packageLabel.title = state.WORLD_PACKAGE_PATH || '';
    }
    if (el.imageLabel) el.imageLabel.textContent = state.imageFile ? `Image: ${state.imageFile}` : 'Image: not set';
    if (el.originX) el.originX.value = meta.origin_pixel_x ?? 0;
    if (el.originY) el.originY.value = meta.origin_pixel_y ?? 0;
    if (el.scaleFactor) el.scaleFactor.value = meta.scale_factor ?? 1.0;
    if (el.pixelsPerKm) el.pixelsPerKm.value = meta.pixels_per_km ?? 7.0;
    if (el.walkSpeed) el.walkSpeed.value = meta.base_walk_speed_kmpd ?? 30.0;
    if (el.windingFactor) el.windingFactor.value = meta.winding_factor ?? 1.2;
    if (el.originReadout) el.originReadout.textContent = `Origin: ${meta.origin_pixel_x ?? 0}, ${meta.origin_pixel_y ?? 0}`;
}

export function syncNodeForm() {
    const node = state.worldData.nodes.find(n => n.uid === state.selectedNodeId);
    const disabled = !node;
    const ctx = node ? resolveAreaContext(node.world_x, node.world_y, state.worldData.areas) : null;
    if (el.nodeTitle) el.nodeTitle.textContent = node ? (node.name || 'Selected Location') : 'No Location Selected';
    [el.nodeName, el.nodeType, el.nodeWorldX, el.nodeWorldY, el.nodeDescription, el.nodeTags, el.deleteNodeBtn].forEach(t => { if (t) t.disabled = disabled; });
    if (!node) {
        [el.nodeName, el.nodeType, el.nodeWorldX, el.nodeWorldY, el.nodeDescription, el.nodeTags].forEach(t => { if (t) t.value = ''; });
        if (el.nodeAreaReadout) el.nodeAreaReadout.textContent = 'Computed area: none';
        return;
    }
    if (el.nodeAreaReadout) el.nodeAreaReadout.textContent = `Computed area: ${getAreaTrailLabel(ctx.primaryArea, state.worldData.areas)}`;
    el.nodeName.value = node.name || ''; el.nodeType.value = node.type || '';
    el.nodeWorldX.value = node.world_x; el.nodeWorldY.value = node.world_y;
    el.nodeDescription.value = node.description || ''; el.nodeTags.value = node.tags || '';
}

export function syncAreaForm() {
    const area = state.worldData.areas.find(a => a.uid === state.selectedAreaId);
    const disabled = !area;
    if (el.areaParent) {
        const descendants = new Set();
        if (area) {
            let changed = true;
            while (changed) {
                changed = false;
                (state.worldData.areas || []).forEach(candidate => {
                    if (candidate.parent_uid && (candidate.parent_uid === area.uid || descendants.has(candidate.parent_uid)) && !descendants.has(candidate.uid)) {
                        descendants.add(candidate.uid);
                        changed = true;
                    }
                });
            }
        }
        const options = ['<option value="">None</option>']
            .concat((state.worldData.areas || [])
                .filter(candidate => !area || (candidate.uid !== area.uid && !descendants.has(candidate.uid)))
                .map(candidate => `<option value="${candidate.uid}">${candidate.name || 'Untitled Area'}</option>`));
        el.areaParent.innerHTML = options.join('');
    }
    if (el.areaTitle) el.areaTitle.textContent = area ? (area.name || 'Selected Area') : 'No Area Selected';
    [el.areaName, el.areaKind, el.areaParent, el.areaColor, el.areaTags, el.areaDescription, el.deleteAreaBtn].forEach(t => { if (t) t.disabled = disabled; });
    if (!area) {
        [el.areaName, el.areaKind, el.areaColor, el.areaTags, el.areaDescription].forEach(t => { if (t) t.value = ''; });
        if (el.areaHierarchy) el.areaHierarchy.textContent = 'Hierarchy: none';
        if (el.areaPoints) el.areaPoints.textContent = 'Shape points: 0';
        return;
    }
    if (el.areaHierarchy) el.areaHierarchy.textContent = `Hierarchy: ${getAreaTrailLabel(area, state.worldData.areas)}`;
    if (el.areaPoints) el.areaPoints.textContent = `Shape points: ${area.geometry.points.length}`;
    el.areaName.value = area.name || ''; el.areaKind.value = area.kind || '';
    el.areaColor.value = normalizeHexColor(area.color, AREA_COLORS[0]);
    el.areaTags.value = area.tags || ''; el.areaDescription.value = area.description || '';
    if (el.areaParent) el.areaParent.value = area.parent_uid || '';
}
