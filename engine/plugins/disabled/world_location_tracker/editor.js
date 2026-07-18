(async function () {
    'use strict';

    // 1. Capture Placeholders
    const WORLD_PACKAGE_PATH = __WORLD_PACKAGE_PATH__;
    const INITIAL_WORLD_DATA = __INITIAL_WORLD_DATA__;
    const INITIAL_IMAGE_URL = __INITIAL_IMAGE_URL__;
    const INITIAL_IMAGE_FILE = __INITIAL_IMAGE_FILE__;
    const INITIAL_IS_TILED = __INITIAL_IS_TILED__;
    const INITIAL_TILE_URL = __INITIAL_TILE_URL__;
    const INITIAL_DIMENSIONS = __INITIAL_DIMENSIONS__;
    const INITIAL_BIOME_MASK_URL = __INITIAL_BIOME_MASK_URL__;

    const PLUGIN_BASE = '../../../plugins/world_location_tracker';

    // 2. Dynamic Imports
    const { state, el, cleanupFns, refreshDomRefs } = await import(`${PLUGIN_BASE}/editor/state.js`);
    const { deepClone, normalizeDimensions, randomUid, toNumber, escapeHtml } = await import(`${PLUGIN_BASE}/editor/utils.js`);
    const { normalizeLocalWorldData, normalizeLocalNode, normalizeLocalArea, normalizeLocalBiomes, getBiomeMaskDimensions, resolveAreaContext } = await import(`${PLUGIN_BASE}/editor/logic.js`);
    const { setStatus, setDirty, syncSaveAffordance, renderNodeList, renderAreaList, renderBiomeList, getAreaTrailLabel } = await import(`${PLUGIN_BASE}/editor/ui.js`);
    const { onDom, onSocket, emitSocket } = await import(`${PLUGIN_BASE}/editor/ui_handlers.js`);
    const { syncMetaForm, syncNodeForm, syncAreaForm } = await import(`${PLUGIN_BASE}/editor/form_manager.js`);
    const { setInteractionMode, renderTotals } = await import(`${PLUGIN_BASE}/editor/interaction_manager.js`);
    const { loadLeaflet, destroyMap, toMapLatLng, fromMapLatLng, buildNodeIcon, buildOriginIcon, buildDraftVertexIcon } = await import(`${PLUGIN_BASE}/editor/map_manager.js`);

    // 3. Initialize State
    while (cleanupFns.length) { try { cleanupFns.pop()(); } catch { } }
    destroyMap();
    refreshDomRefs();
    state.WORLD_PACKAGE_PATH = WORLD_PACKAGE_PATH;
    state.worldData = normalizeLocalWorldData(deepClone(INITIAL_WORLD_DATA));
    state.imageUrl = INITIAL_IMAGE_URL || '';
    state.imageFile = INITIAL_IMAGE_FILE || '';
    state.isTiled = !!INITIAL_IS_TILED;
    state.tileUrl = INITIAL_TILE_URL || '';
    state.imageDimensions = normalizeDimensions(INITIAL_DIMENSIONS);
    state.biomeMaskUrl = INITIAL_BIOME_MASK_URL || '';
    state.biomeCanvas = null;
    state.biomeCtx = null;
    state.biomeOverlay = null;
    state.selectedBiomeId = state.worldData.biomes?.palette?.[0]?.id || 'forest';
    state.biomeBrushSize = 24;
    state.biomeMaskOpacity = 0.45;
    state.biomeEraser = false;
    state.biomePainting = false;
    state.biomeRightPanning = false;
    state.biomeRightPanLastPoint = null;
    state.biomeBrushPreviewEl = null;
    state.biomeMaskLoaded = false;
    state.biomeOverlayUpdateQueued = false;
    state.selectedNodeId = null;
    state.selectedAreaId = null;
    state.interactionMode = 'pan';
    state.draftAreaPoints = [];
    state.draftAreaParentId = null;
    state.activeIndexTab = 'nodes';
    state.indexSearch = '';
    state.dirty = false;
    state.dirtyReasons.clear();
    state.saving = false;
    state.simOriginNodeUid = null;
    state.simDestinationNodeUid = null;
    state.simRequestSeq = 0;
    state.simPendingRequestId = null;
    state.simLatestRequestId = null;

    function cleanup() {
        while (cleanupFns.length) { try { cleanupFns.pop()(); } catch { } }
        destroyMap();
        const host = document.getElementById('pluginViewContainer');
        if (host && host.__pluginCleanup === cleanup) host.__pluginCleanup = null;
    }

    function selectedNode() {
        return (state.worldData.nodes || []).find(node => node.uid === state.selectedNodeId) || null;
    }

    function selectedArea() {
        return (state.worldData.areas || []).find(area => area.uid === state.selectedAreaId) || null;
    }

    function selectedBiome() {
        return (state.worldData.biomes?.palette || []).find(biome => biome.id === state.selectedBiomeId) || null;
    }

    function ensureBiomeMetadata() {
        state.worldData.biomes = normalizeLocalBiomes(state.worldData.biomes);
        const target = getBiomeMaskDimensions(state.imageDimensions);
        if (target.width > 0 && target.height > 0) {
            state.worldData.biomes.mask_width = target.width;
            state.worldData.biomes.mask_height = target.height;
        }
        if (!selectedBiome() && state.worldData.biomes.palette.length > 0) {
            state.selectedBiomeId = state.worldData.biomes.palette[0].id;
        }
        return state.worldData.biomes;
    }

    function createEmptyBiomeCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
    }

    function resizeBiomeCanvasIfNeeded() {
        const biomes = ensureBiomeMetadata();
        if (!biomes.mask_width || !biomes.mask_height) return false;

        const needsCanvas = !state.biomeCanvas;
        const needsResize = state.biomeCanvas
            && (state.biomeCanvas.width !== biomes.mask_width || state.biomeCanvas.height !== biomes.mask_height);
        if (!needsCanvas && !needsResize) return true;

        const nextCanvas = createEmptyBiomeCanvas(biomes.mask_width, biomes.mask_height);
        const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true });
        if (state.biomeCanvas && state.biomeCanvas.width > 0 && state.biomeCanvas.height > 0) {
            nextCtx.imageSmoothingEnabled = false;
            nextCtx.drawImage(state.biomeCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
        }

        state.biomeCanvas = nextCanvas;
        state.biomeCtx = nextCtx;
        return true;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            if (!src) { resolve(null); return; }
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load biome mask image.'));
            img.src = src;
        });
    }

    async function initializeBiomeCanvas({ loadMask = true } = {}) {
        if (!resizeBiomeCanvasIfNeeded()) return;
        if (!loadMask || !state.biomeMaskUrl || state.biomeMaskLoaded) {
            scheduleBiomeOverlayUpdate();
            return;
        }

        try {
            const img = await loadImage(state.biomeMaskUrl);
            if (img && state.biomeCtx) {
                state.biomeCtx.clearRect(0, 0, state.biomeCanvas.width, state.biomeCanvas.height);
                state.biomeCtx.imageSmoothingEnabled = false;
                state.biomeCtx.drawImage(img, 0, 0, state.biomeCanvas.width, state.biomeCanvas.height);
            }
            state.biomeMaskLoaded = true;
            scheduleBiomeOverlayUpdate();
        } catch (error) {
            setStatus(error.message || 'Failed to load biome mask.', true);
        }
    }

    function syncBiomeOverlay() {
        if (!state.map || !state.imageBounds || !state.biomeCanvas) return;
        const opacity = Math.max(0, Math.min(1, Number(state.biomeMaskOpacity) || 0));
        const dataUrl = state.biomeCanvas.toDataURL('image/png');
        if (!state.biomeOverlay) {
            state.biomeOverlay = window.L.imageOverlay(dataUrl, state.imageBounds, {
                opacity,
                interactive: false
            }).addTo(state.map);
            const element = state.biomeOverlay.getElement?.();
            if (element) element.style.pointerEvents = 'none';
        } else {
            state.biomeOverlay.setOpacity(opacity);
            state.biomeOverlay.setUrl(dataUrl);
        }
    }

    function scheduleBiomeOverlayUpdate() {
        if (state.biomeOverlayUpdateQueued) return;
        state.biomeOverlayUpdateQueued = true;
        requestAnimationFrame(() => {
            state.biomeOverlayUpdateQueued = false;
            syncBiomeOverlay();
        });
    }

    function parseHexColor(hex) {
        const match = String(hex || '').match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
        if (!match) return null;
        return {
            r: parseInt(match[1], 16),
            g: parseInt(match[2], 16),
            b: parseInt(match[3], 16)
        };
    }

    function normalizePaintColor(color, fallback = '#ffffff') {
        return /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())
            ? String(color).trim().toLowerCase()
            : fallback;
    }

    function isBiomeColorInUse(color, exceptBiomeId = '') {
        const normalized = normalizePaintColor(color);
        return (state.worldData.biomes?.palette || []).some(biome => (
            biome.id !== exceptBiomeId
            && normalizePaintColor(biome.color) === normalized
        ));
    }

    function nextAvailableBiomeColor(preferredColor = '#ffffff') {
        const candidates = [preferredColor, '#f4a261', '#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#ffcad4'];
        const available = candidates.find(color => !isBiomeColorInUse(color));
        if (available) return normalizePaintColor(available);

        for (let index = 1; index < 256; index += 1) {
            const value = ((index * 2654435761) >>> 8) & 0xffffff;
            const color = `#${value.toString(16).padStart(6, '0')}`;
            if (!isBiomeColorInUse(color)) return color;
        }
        return '#ffffff';
    }

    function replaceBiomeColor(oldColor, newColor) {
        if (!state.biomeCtx || !state.biomeCanvas || oldColor === newColor) return;
        const oldRgb = parseHexColor(oldColor);
        const newRgb = parseHexColor(newColor);
        if (!oldRgb || !newRgb) return;
        const image = state.biomeCtx.getImageData(0, 0, state.biomeCanvas.width, state.biomeCanvas.height);
        for (let i = 0; i < image.data.length; i += 4) {
            if (image.data[i + 3] === 0) continue;
            if (image.data[i] === oldRgb.r && image.data[i + 1] === oldRgb.g && image.data[i + 2] === oldRgb.b) {
                image.data[i] = newRgb.r;
                image.data[i + 1] = newRgb.g;
                image.data[i + 2] = newRgb.b;
                image.data[i + 3] = 255;
            }
        }
        state.biomeCtx.putImageData(image, 0, 0);
        scheduleBiomeOverlayUpdate();
    }

    function clearBiomeColor(color) {
        if (!state.biomeCtx || !state.biomeCanvas) return;
        const rgb = parseHexColor(color);
        if (!rgb) return;
        const image = state.biomeCtx.getImageData(0, 0, state.biomeCanvas.width, state.biomeCanvas.height);
        for (let i = 0; i < image.data.length; i += 4) {
            if (image.data[i + 3] === 0) continue;
            if (image.data[i] === rgb.r && image.data[i + 1] === rgb.g && image.data[i + 2] === rgb.b) {
                image.data[i + 3] = 0;
            }
        }
        state.biomeCtx.putImageData(image, 0, 0);
        scheduleBiomeOverlayUpdate();
    }

    function worldPointToBiomeMaskPoint(pos) {
        if (!state.biomeCanvas || !state.imageDimensions.width || !state.imageDimensions.height) return null;
        const imageX = Math.max(0, Math.min(state.imageDimensions.width, pos.x));
        const imageY = Math.max(0, Math.min(state.imageDimensions.height, -pos.y));
        return {
            x: (imageX / state.imageDimensions.width) * state.biomeCanvas.width,
            y: (imageY / state.imageDimensions.height) * state.biomeCanvas.height
        };
    }

    function paintBiomeAtLatLng(latLng) {
        if (!resizeBiomeCanvasIfNeeded() || !state.biomeCtx || !state.biomeCanvas) return;
        const pos = fromMapLatLng(latLng);
        const maskPoint = worldPointToBiomeMaskPoint(pos);
        if (!maskPoint) return;

        const biome = selectedBiome();
        if (!state.biomeEraser && !biome) return;

        const radius = Math.max(1, Number(state.biomeBrushSize || 24)) * (state.biomeCanvas.width / Math.max(1, state.imageDimensions.width));
        state.biomeCtx.save();
        state.biomeCtx.globalCompositeOperation = state.biomeEraser ? 'destination-out' : 'source-over';
        state.biomeCtx.fillStyle = state.biomeEraser ? 'rgba(0,0,0,1)' : biome.color;
        state.biomeCtx.beginPath();
        state.biomeCtx.arc(maskPoint.x, maskPoint.y, radius, 0, Math.PI * 2);
        state.biomeCtx.fill();
        state.biomeCtx.restore();
        scheduleBiomeOverlayUpdate();
        setDirty(true, 'biome-mask');
    }

    function syncBiomeForm() {
        const biome = selectedBiome();
        if (el.biomeName) el.biomeName.value = biome?.label || '';
        if (el.biomeColor) el.biomeColor.value = biome?.color || '#ffffff';
        if (el.biomeNeedsBoat) el.biomeNeedsBoat.checked = !!biome?.needs_boat;
        if (el.biomeSlowsDown) el.biomeSlowsDown.checked = !!biome?.slows_down;
        if (el.biomeIsRoad) el.biomeIsRoad.checked = !!biome?.is_road;
        if (el.biomeIsRiver) el.biomeIsRiver.checked = !!biome?.is_river;
        if (el.biomeNeedsBoat) el.biomeNeedsBoat.disabled = !biome;
        if (el.biomeSlowsDown) el.biomeSlowsDown.disabled = !biome;
        if (el.biomeIsRoad) el.biomeIsRoad.disabled = !biome;
        if (el.biomeIsRiver) el.biomeIsRiver.disabled = !biome;
        if (el.biomeBrushSize) el.biomeBrushSize.value = String(state.biomeBrushSize);
        if (el.biomeBrushSizeReadout) el.biomeBrushSizeReadout.textContent = String(state.biomeBrushSize);
        if (el.biomeOpacity) el.biomeOpacity.value = String(Math.round(state.biomeMaskOpacity * 100));
        if (el.biomeOpacityReadout) el.biomeOpacityReadout.textContent = `${Math.round(state.biomeMaskOpacity * 100)}%`;
        if (el.biomeEraser) el.biomeEraser.checked = !!state.biomeEraser;
        if (el.deleteBiomeBtn) el.deleteBiomeBtn.disabled = !biome;
    }

    function ensureBiomeBrushPreview() {
        if (state.biomeBrushPreviewEl) return state.biomeBrushPreviewEl;
        if (!el.map) return null;
        const preview = document.createElement('div');
        preview.className = 'world-map-brush-preview hidden';
        el.map.appendChild(preview);
        state.biomeBrushPreviewEl = preview;
        return preview;
    }

    function hideBiomeBrushPreview() {
        state.biomeBrushPreviewEl?.classList.add('hidden');
    }

    function updateBiomeBrushPreview(event, latLng) {
        if (state.interactionMode !== 'paint-biome' || state.biomeRightPanning || !state.map || !el.map || !latLng) {
            hideBiomeBrushPreview();
            return;
        }

        const preview = ensureBiomeBrushPreview();
        if (!preview) return;

        const centerPoint = state.map.latLngToContainerPoint(latLng);
        const sourcePoint = fromMapLatLng(latLng);
        const radiusSourcePixels = Math.max(1, Number(state.biomeBrushSize || 24));
        const edgePoint = state.map.latLngToContainerPoint(toMapLatLng(sourcePoint.x + radiusSourcePixels, sourcePoint.y));
        const radiusPixels = Math.max(2, Math.abs(edgePoint.x - centerPoint.x));
        const diameter = Math.round(radiusPixels * 2);
        const pointerX = Number.isFinite(event?.clientX) ? event.clientX - el.map.getBoundingClientRect().left : centerPoint.x;
        const pointerY = Number.isFinite(event?.clientY) ? event.clientY - el.map.getBoundingClientRect().top : centerPoint.y;
        const biome = selectedBiome();

        preview.style.width = `${diameter}px`;
        preview.style.height = `${diameter}px`;
        preview.style.transform = `translate(${Math.round(pointerX - radiusPixels)}px, ${Math.round(pointerY - radiusPixels)}px)`;
        preview.style.setProperty('--wm-brush-color', state.biomeEraser ? 'rgba(255, 255, 255, 0.92)' : (biome?.color || '#ffffff'));
        preview.classList.toggle('eraser', !!state.biomeEraser);
        preview.classList.remove('hidden');
    }

    function beginBiomeRightPan(event) {
        if (state.interactionMode !== 'paint-biome' || !event) return;
        event.preventDefault();
        event.stopPropagation?.();
        state.biomePainting = false;
        state.biomeRightPanning = true;
        state.biomeRightPanLastPoint = { x: event.clientX, y: event.clientY };
        hideBiomeBrushPreview();
    }

    function panBiomeMapFromMouseEvent(event) {
        if (!state.biomeRightPanning || !state.map || !state.biomeRightPanLastPoint) return;
        event.preventDefault();
        const dx = event.clientX - state.biomeRightPanLastPoint.x;
        const dy = event.clientY - state.biomeRightPanLastPoint.y;
        state.biomeRightPanLastPoint = { x: event.clientX, y: event.clientY };
        state.map.panBy([-dx, -dy], { animate: false });
    }

    function endBiomeRightPan() {
        state.biomeRightPanning = false;
        state.biomeRightPanLastPoint = null;
    }

    function syncIndexUi() {
        const showingAreas = state.activeIndexTab === 'areas';
        const showingBiomes = state.activeIndexTab === 'biomes';
        el.nodeTabBtn?.classList.toggle('active', !showingAreas && !showingBiomes);
        el.areaTabBtn?.classList.toggle('active', showingAreas);
        el.biomeTabBtn?.classList.toggle('active', showingBiomes);
        el.nodeList?.classList.toggle('world-map-hidden', showingAreas || showingBiomes);
        el.areaList?.classList.toggle('world-map-hidden', !showingAreas);
        el.biomeList?.classList.toggle('world-map-hidden', !showingBiomes);
        el.nodeEditorPanel?.classList.toggle('world-map-hidden', showingAreas || showingBiomes);
        el.areaEditorPanel?.classList.toggle('world-map-hidden', !showingAreas);
        el.biomeEditorPanel?.classList.toggle('world-map-hidden', !showingBiomes);
        if (el.nodeCount) {
            const count = showingBiomes ? (state.worldData.biomes?.palette || []).length : (showingAreas ? (state.worldData.areas || []).length : (state.worldData.nodes || []).length);
            el.nodeCount.textContent = `${count} ${showingBiomes ? 'biomes' : (showingAreas ? 'areas' : 'locations')}`;
        }
        if (el.indexSearch) {
            el.indexSearch.placeholder = showingAreas
                ? 'Search areas by name, type, tags, or hierarchy'
                : (showingBiomes ? 'Search biomes by name, id, or color' : 'Search locations by name, type, tags, or area');
        }
    }

    function syncSelectionSummary() {
        if (!el.selectionSummary) return;
        const node = selectedNode();
        const area = selectedArea();
        const biome = state.activeIndexTab === 'biomes' ? selectedBiome() : null;
        if (node) {
            el.selectionSummary.textContent = node.name ? `Location: ${node.name}` : 'Location selected';
        } else if (area) {
            el.selectionSummary.textContent = area.name ? `Area: ${area.name}` : 'Area selected';
        } else if (biome) {
            el.selectionSummary.textContent = state.biomeEraser ? 'Biome eraser active' : `Biome: ${biome.label}`;
        } else {
            el.selectionSummary.textContent = 'Nothing selected';
        }
    }

    function refreshEditorState({ redrawMap = true, syncForms = true } = {}) {
        ensureBiomeMetadata();
        renderTotals();
        renderNodeList();
        renderAreaList();
        renderBiomeList();
        syncIndexUi();
        syncSelectionSummary();
        syncTravelSimulationControls();
        if (syncForms) {
            syncNodeForm();
            syncAreaForm();
            syncBiomeForm();
        }
        if (redrawMap) renderMapDecorations();
    }

    function activateIndexTab(tab) {
        state.activeIndexTab = tab === 'areas' ? 'areas' : (tab === 'biomes' ? 'biomes' : 'nodes');
        if (state.activeIndexTab === 'areas') {
            state.selectedNodeId = null;
            state.biomePainting = false;
            endBiomeRightPan();
            hideBiomeBrushPreview();
            if (state.interactionMode === 'paint-biome') setInteractionMode('pan');
        } else if (state.activeIndexTab === 'biomes') {
            state.selectedNodeId = null;
            state.selectedAreaId = null;
            setInteractionMode('paint-biome');
        } else {
            state.selectedAreaId = null;
            state.biomePainting = false;
            endBiomeRightPan();
            hideBiomeBrushPreview();
            if (state.interactionMode === 'paint-biome') setInteractionMode('pan');
        }
        renderNodeList();
        renderAreaList();
        renderBiomeList();
        syncIndexUi();
        syncSelectionSummary();
        syncNodeForm();
        syncAreaForm();
        syncBiomeForm();
        renderMapDecorations();
    }

    function createWorldDataPayload() {
        ensureBiomeMetadata();
        const worldData = normalizeLocalWorldData(deepClone(state.worldData));
        worldData.meta = worldData.meta || {};
        if (state.imageFile) worldData.meta.image_file = state.imageFile;
        if (state.imageDimensions?.width > 0 && state.imageDimensions?.height > 0) {
            worldData.meta.dimensions = { ...state.imageDimensions };
        }
        worldData.meta.is_compiled = !!state.isTiled;
        return worldData;
    }

    function prepareWorldDataForSave() {
        state.worldData = createWorldDataPayload();
        return state.worldData;
    }

    function setSimulationState(label, muted = true) {
        if (!el.simState) return;
        el.simState.textContent = label;
        el.simState.classList.toggle('muted', muted);
    }

    function setSimulationReadout(distance = '-', days = '-', narrative = '-') {
        if (el.simDistance) el.simDistance.textContent = distance;
        if (el.simDays) el.simDays.textContent = days;
        if (el.simNarrativeLabel) el.simNarrativeLabel.textContent = narrative;
    }

    function syncTravelSimulationControls() {
        const nodes = Array.isArray(state.worldData?.nodes) ? state.worldData.nodes : [];
        const hasEnoughNodes = nodes.length >= 2;

        if (!hasEnoughNodes) {
            state.simOriginNodeUid = null;
            state.simDestinationNodeUid = null;
            state.simPendingRequestId = null;
            state.simLatestRequestId = null;
            if (el.simOriginNode) {
                el.simOriginNode.innerHTML = '<option value="">Not enough locations</option>';
                el.simOriginNode.disabled = true;
            }
            if (el.simDestinationNode) {
                el.simDestinationNode.innerHTML = '<option value="">Not enough locations</option>';
                el.simDestinationNode.disabled = true;
            }
            if (el.simMessage) el.simMessage.textContent = 'Add at least two locations to validate travel distance and time.';
            setSimulationState('Disabled', true);
            setSimulationReadout('-', '-', '-');
            return false;
        }

        const hasNode = (uid) => nodes.some((node) => node.uid === uid);
        if (!hasNode(state.simOriginNodeUid)) state.simOriginNodeUid = nodes[0].uid;
        if (!hasNode(state.simDestinationNodeUid) || state.simDestinationNodeUid === state.simOriginNodeUid) {
            const fallbackDestination = nodes.find((node) => node.uid !== state.simOriginNodeUid) || nodes[0];
            state.simDestinationNodeUid = fallbackDestination.uid;
        }

        const optionsHtml = nodes.map((node) => {
            const label = node.name
                ? `${node.name} (${Math.round(node.world_x)}, ${Math.round(node.world_y)})`
                : `Untitled (${Math.round(node.world_x)}, ${Math.round(node.world_y)})`;
            return `<option value="${escapeHtml(node.uid)}">${escapeHtml(label)}</option>`;
        }).join('');

        if (el.simOriginNode) {
            el.simOriginNode.innerHTML = optionsHtml;
            el.simOriginNode.disabled = false;
            el.simOriginNode.value = state.simOriginNodeUid;
        }
        if (el.simDestinationNode) {
            el.simDestinationNode.innerHTML = optionsHtml;
            el.simDestinationNode.disabled = false;
            el.simDestinationNode.value = state.simDestinationNodeUid;
        }

        setSimulationState('Ready', true);
        if (el.simMessage) el.simMessage.textContent = 'Travel math matches runtime walk simulation.';
        return true;
    }

    function requestTravelSimulation() {
        if (!syncTravelSimulationControls()) return;
        const originNodeUid = state.simOriginNodeUid;
        const destinationNodeUid = state.simDestinationNodeUid;
        if (!originNodeUid || !destinationNodeUid) return;

        const requestId = `world-map-sim-${Date.now()}-${++state.simRequestSeq}`;
        state.simPendingRequestId = requestId;
        state.simLatestRequestId = requestId;
        setSimulationState('Calculating', false);
        if (el.simMessage) el.simMessage.textContent = 'Computing travel with current map meta values...';

        const emitted = emitSocket('world-map-simulate-travel', {
            requestId,
            packagePath: WORLD_PACKAGE_PATH,
            worldData: createWorldDataPayload(),
            originNodeUid,
            destinationNodeUid
        });

        if (!emitted) {
            state.simPendingRequestId = null;
            state.simLatestRequestId = null;
            setSimulationState('Offline', true);
            if (el.simMessage) el.simMessage.textContent = 'Socket unavailable. Cannot run travel validation.';
        }
    }

    function saveWorldPackage() {
        const worldData = prepareWorldDataForSave();
        state.saving = true;
        syncSaveAffordance();
        setStatus('Saving changes...', false);
        const biomeMaskDataUrl = state.biomeCanvas ? state.biomeCanvas.toDataURL('image/png') : '';
        if (!emitSocket('world-map-save-package', { packagePath: WORLD_PACKAGE_PATH, worldData, biomeMaskDataUrl })) {
            state.saving = false;
            syncSaveAffordance();
        }
    }

    // 4. Map Logic (Orchestrated)
    function renderMapDecorations() {
        if (!state.map) return;
        state.nodeMarkers.forEach(m => m.remove()); state.nodeMarkers = [];
        state.areaLayers.forEach(l => l.remove()); state.areaLayers = [];
        if (state.draftAreaLayer) { state.draftAreaLayer.remove(); state.draftAreaLayer = null; }
        syncBiomeOverlay();

        const isBiomePaintMode = state.interactionMode === 'paint-biome';
        const isAreaDrawMode = state.interactionMode === 'draw-area';

        (state.worldData.areas || []).forEach(area => {
            if (area.geometry.points.length < 3) return;
            const polygon = window.L.polygon(area.geometry.points.map(p => toMapLatLng(p[0], p[1])), {
                color: area.color, weight: area.uid === state.selectedAreaId ? 3 : 2, opacity: 0.7, fillColor: area.color, fillOpacity: 0.15,
                interactive: !isAreaDrawMode && !isBiomePaintMode
            }).addTo(state.map);
            polygon.bindTooltip(area.name || 'Untitled', { sticky: true });
            polygon.on('click', (e) => { e.originalEvent?.stopPropagation(); selectArea(area.uid); });
            state.areaLayers.push(polygon);
        });

        if (state.draftAreaPoints.length > 0) {
            const group = window.L.layerGroup().addTo(state.map);
            state.draftAreaLayer = group;
            state.draftAreaPoints.forEach(p => window.L.marker(toMapLatLng(p[0], p[1]), { icon: buildDraftVertexIcon(), interactive: false }).addTo(group));
            if (state.draftAreaPoints.length >= 2) {
                const latLngs = state.draftAreaPoints.map(p => toMapLatLng(p[0], p[1]));
                const shape = latLngs.length >= 3 ? window.L.polygon(latLngs, { color: '#fff', dashArray: '5 5', fillOpacity: 0.1 }) : window.L.polyline(latLngs, { color: '#fff', dashArray: '5 5' });
                shape.addTo(group);
            }
        }

        (state.worldData.nodes || []).forEach(node => {
            const marker = window.L.marker(toMapLatLng(node.world_x, node.world_y), {
                draggable: !isAreaDrawMode && !isBiomePaintMode,
                icon: buildNodeIcon(node.uid === state.selectedNodeId),
                interactive: !isBiomePaintMode
            }).addTo(state.map);
            marker.bindTooltip(node.name || 'Untitled');
            marker.on('click', () => selectNode(node.uid));
            marker.on('dragend', (e) => {
                const pos = fromMapLatLng(e.target.getLatLng());
                node.world_x = pos.x; node.world_y = pos.y;
                if (node.uid === state.selectedNodeId) syncNodeForm();
                setDirty(true);
                renderNodeList();
                renderMapDecorations();
                requestTravelSimulation();
            });
            state.nodeMarkers.push(marker);
        });
        syncOriginMarker();
    }

    function syncOriginMarker() {
        if (!state.map) return;
        const latLng = toMapLatLng(state.worldData.meta.origin_pixel_x, -state.worldData.meta.origin_pixel_y);
        if (!state.originMarker) state.originMarker = window.L.marker(latLng, { icon: buildOriginIcon(), interactive: false }).addTo(state.map);
        else state.originMarker.setLatLng(latLng);
    }

    function finishDraftArea() {
        if (state.draftAreaPoints.length < 3) {
            setStatus('At least 3 points are required to finish an area.', true);
            return;
        }
        const area = normalizeLocalArea({
            uid: `area-${randomUid()}`,
            name: 'New Area',
            geometry: { type: 'polygon', points: [...state.draftAreaPoints] }
        }, state.worldData.areas.length);
        state.worldData.areas.push(area);
        state.draftAreaPoints = [];
        selectArea(area.uid);
        setInteractionMode('pan');
        setDirty(true);
        setStatus('Area polygon saved.', false);
    }

    async function ensureMap() {
        const hasSource = (state.isTiled && state.tileUrl) || state.imageUrl;
        if (!hasSource) { destroyMap(); if (el.canvasEmpty) el.canvasEmpty.style.display = 'flex'; return; }
        await loadLeaflet();
        if (el.canvasEmpty) el.canvasEmpty.style.display = 'none';
        destroyMap();
        const dim = state.imageDimensions;
        const nativeZoomLevel = state.isTiled
            ? Math.max(0, Math.ceil(Math.log2(Math.max(dim.width, dim.height) / 512)))
            : 0;
        const overzoomSteps = 4;
        state.maxNativeZoom = nativeZoomLevel;
        state.mapScale = state.isTiled ? Math.pow(2, nativeZoomLevel) : 1;
        const bounds = [[-dim.height / state.mapScale, 0], [0, dim.width / state.mapScale]];
        state.imageBounds = bounds;
        state.map = window.L.map(el.map, {
            crs: window.L.CRS.Simple,
            doubleClickZoom: false,
            maxZoom: state.isTiled ? (state.maxNativeZoom + overzoomSteps) : 8
        });
        if (state.isTiled) {
            window.L.tileLayer(state.tileUrl, {
                noWrap: true,
                tileSize: 512,
                bounds,
                maxNativeZoom: state.maxNativeZoom,
                maxZoom: state.maxNativeZoom + overzoomSteps
            }).addTo(state.map);
        }
        else window.L.imageOverlay(state.imageUrl, bounds).addTo(state.map);
        state.map.fitBounds(bounds);
        await initializeBiomeCanvas({ loadMask: true });

        state.map.on('click', (e) => {
            const pos = fromMapLatLng(e.latlng);
            if (state.interactionMode === 'add-node') {
                const node = normalizeLocalNode({ uid: `node-${randomUid()}`, world_x: pos.x, world_y: pos.y, name: 'New Location' }, state.worldData.nodes.length);
                state.worldData.nodes.push(node);
                selectNode(node.uid);
                setInteractionMode('pan');
                setDirty(true);
                requestTravelSimulation();
            } else if (state.interactionMode === 'set-origin') {
                state.worldData.meta.origin_pixel_x = pos.x; state.worldData.meta.origin_pixel_y = -pos.y;
                syncMetaForm(); renderMapDecorations(); setInteractionMode('pan'); setDirty(true);
            } else if (state.interactionMode === 'draw-area') {
                state.draftAreaPoints.push([pos.x, pos.y]);
                renderMapDecorations();
                setInteractionMode('draw-area');
                setDirty(true, 'draft-area');
            }
        });
        state.map.on('mousedown', (e) => {
            if (state.interactionMode !== 'paint-biome') return;
            const button = e.originalEvent?.button ?? 0;
            if (button === 2) {
                beginBiomeRightPan(e.originalEvent);
                return;
            }
            if (button !== 0) return;
            e.originalEvent?.preventDefault();
            state.biomePainting = true;
            paintBiomeAtLatLng(e.latlng);
            updateBiomeBrushPreview(e.originalEvent, e.latlng);
        });
        state.map.on('mouseup', () => {
            state.biomePainting = false;
        });
        state.map.on('mouseout', () => {
            state.biomePainting = false;
            hideBiomeBrushPreview();
        });
        state.map.on('contextmenu', (e) => {
            if (state.interactionMode === 'paint-biome') {
                e.originalEvent?.preventDefault();
                e.originalEvent?.stopPropagation();
                return;
            }
            if (state.interactionMode !== 'draw-area') return;
            e.originalEvent?.preventDefault();
            e.originalEvent?.stopPropagation();
            if (state.draftAreaPoints.length === 0) return;
            state.draftAreaPoints.pop();
            renderMapDecorations();
            setInteractionMode('draw-area');
            setDirty(true, 'draft-area');
            setStatus(`Removed last point. ${state.draftAreaPoints.length} point(s) remaining.`, false);
        });
        state.map.on('dblclick', (e) => {
            if (state.interactionMode !== 'draw-area') return;
            e.originalEvent?.preventDefault();
            e.originalEvent?.stopPropagation();
            finishDraftArea();
        });
        state.map.on('mousemove', (e) => {
            const pos = fromMapLatLng(e.latlng);
            if (el.cursor) el.cursor.textContent = `Cursor: ${pos.x}, ${pos.y}`;
            const ctx = resolveAreaContext(pos.x, pos.y, state.worldData.areas);
            if (el.areaReadout) el.areaReadout.textContent = `Area: ${getAreaTrailLabel(ctx.primaryArea, state.worldData.areas)}`;
            updateBiomeBrushPreview(e.originalEvent, e.latlng);
            if (state.interactionMode === 'paint-biome' && state.biomePainting) {
                paintBiomeAtLatLng(e.latlng);
            }
        });
        renderMapDecorations();
    }

    function selectNode(uid) {
        state.selectedNodeId = uid;
        state.selectedAreaId = null;
        activateIndexTab('nodes');
        renderMapDecorations();
    }

    function selectArea(uid) {
        state.selectedAreaId = uid;
        state.selectedNodeId = null;
        activateIndexTab('areas');
        renderMapDecorations();
    }

    function selectBiome(uid) {
        state.selectedBiomeId = uid;
        state.selectedAreaId = null;
        state.selectedNodeId = null;
        activateIndexTab('biomes');
        renderMapDecorations();
    }

    function updateMetaFromForm() {
        const meta = state.worldData.meta || {};
        meta.origin_pixel_x = Math.round(toNumber(el.originX?.value, meta.origin_pixel_x ?? 0));
        meta.origin_pixel_y = Math.round(toNumber(el.originY?.value, meta.origin_pixel_y ?? 0));
        meta.scale_factor = toNumber(el.scaleFactor?.value, meta.scale_factor ?? 1.0);
        meta.pixels_per_km = toNumber(el.pixelsPerKm?.value, meta.pixels_per_km ?? 7.0);
        meta.base_walk_speed_kmpd = toNumber(el.walkSpeed?.value, meta.base_walk_speed_kmpd ?? 30.0);
        meta.winding_factor = toNumber(el.windingFactor?.value, meta.winding_factor ?? 1.2);
        state.worldData.meta = meta;
        syncMetaForm();
        syncOriginMarker();
        setDirty(true);
        requestTravelSimulation();
    }

    function updateNodeFromForm({ redrawMap = true } = {}) {
        const node = selectedNode();
        if (!node) return;
        const prevX = node.world_x;
        const prevY = node.world_y;
        node.name = el.nodeName?.value || '';
        node.type = el.nodeType?.value || '';
        node.world_x = Math.round(toNumber(el.nodeWorldX?.value, node.world_x));
        node.world_y = Math.round(toNumber(el.nodeWorldY?.value, node.world_y));
        node.description = el.nodeDescription?.value || '';
        node.tags = el.nodeTags?.value || '';
        if (el.nodeTitle) el.nodeTitle.textContent = node.name || 'Selected Location';
        const ctx = resolveAreaContext(node.world_x, node.world_y, state.worldData.areas);
        if (el.nodeAreaReadout) el.nodeAreaReadout.textContent = `Computed area: ${getAreaTrailLabel(ctx.primaryArea, state.worldData.areas)}`;
        renderNodeList();
        syncSelectionSummary();
        if (redrawMap) renderMapDecorations();
        setDirty(true);
        if (node.world_x !== prevX || node.world_y !== prevY) {
            requestTravelSimulation();
        }
    }

    function updateAreaFromForm({ redrawMap = true } = {}) {
        const area = selectedArea();
        if (!area) return;
        area.name = el.areaName?.value || '';
        area.kind = el.areaKind?.value || 'region';
        area.parent_uid = el.areaParent?.value || null;
        area.color = el.areaColor?.value || area.color || '#4f8fc0';
        area.tags = el.areaTags?.value || '';
        area.description = el.areaDescription?.value || '';
        if (el.areaTitle) el.areaTitle.textContent = area.name || 'Selected Area';
        if (el.areaHierarchy) el.areaHierarchy.textContent = `Hierarchy: ${getAreaTrailLabel(area, state.worldData.areas)}`;
        renderAreaList();
        syncSelectionSummary();
        if (redrawMap) renderMapDecorations();
        setDirty(true);
    }

    function updateBiomeFromForm() {
        const biome = selectedBiome();
        if (!biome) return;
        const previousColor = biome.color;
        biome.label = el.biomeName?.value || '';
        const requestedColor = normalizePaintColor(el.biomeColor?.value, biome.color || '#ffffff');
        if (requestedColor !== normalizePaintColor(previousColor) && isBiomeColorInUse(requestedColor, biome.id)) {
            if (el.biomeColor) el.biomeColor.value = previousColor || '#ffffff';
            setStatus('That color is already used by another biome. Pick a unique color for mask-safe editing.', true);
            renderBiomeList();
            syncSelectionSummary();
            setDirty(true);
            return;
        }
        biome.color = requestedColor;
        biome.needs_boat = !!el.biomeNeedsBoat?.checked;
        biome.slows_down = !!el.biomeSlowsDown?.checked;
        biome.is_road = !!el.biomeIsRoad?.checked;
        biome.is_river = !!el.biomeIsRiver?.checked;
        if (previousColor !== biome.color) replaceBiomeColor(previousColor, biome.color);
        renderBiomeList();
        syncSelectionSummary();
        setDirty(true);
    }

    function addBiome() {
        const palette = state.worldData.biomes?.palette || [];
        let index = palette.length + 1;
        let id = `custom_${index}`;
        const existingIds = new Set(palette.map(b => b.id));
        while (existingIds.has(id)) {
            index += 1;
            id = `custom_${index}`;
        }
        const biome = { id, label: `Custom ${index}`, color: nextAvailableBiomeColor('#ffffff'), needs_boat: false, slows_down: false, is_road: false, is_river: false };
        palette.push(biome);
        state.worldData.biomes.palette = palette;
        state.selectedBiomeId = biome.id;
        renderBiomeList();
        syncBiomeForm();
        syncSelectionSummary();
        setDirty(true);
    }

    function deleteSelectedBiome() {
        const biome = selectedBiome();
        if (!biome) return;
        clearBiomeColor(biome.color);
        state.worldData.biomes.palette = (state.worldData.biomes.palette || []).filter(candidate => candidate.id !== biome.id);
        state.selectedBiomeId = state.worldData.biomes.palette[0]?.id || '';
        renderBiomeList();
        syncBiomeForm();
        syncSelectionSummary();
        setDirty(true);
    }

    function clearBiomeMask() {
        if (!state.biomeCtx || !state.biomeCanvas) return;
        state.biomeCtx.clearRect(0, 0, state.biomeCanvas.width, state.biomeCanvas.height);
        scheduleBiomeOverlayUpdate();
        setDirty(true, 'biome-mask');
        setStatus('Biome mask cleared.', false);
    }

    function deleteSelectedNode() {
        const node = selectedNode();
        if (!node) return;
        state.worldData.nodes = (state.worldData.nodes || []).filter(candidate => candidate.uid !== node.uid);
        state.selectedNodeId = null;
        refreshEditorState();
        setDirty(true);
        setStatus('Location deleted.', false);
        requestTravelSimulation();
    }

    function deleteSelectedArea() {
        const area = selectedArea();
        if (!area) return;
        state.worldData.areas = (state.worldData.areas || []).filter(candidate => candidate.uid !== area.uid);
        state.worldData.areas.forEach(candidate => {
            if (candidate.parent_uid === area.uid) candidate.parent_uid = null;
        });
        state.selectedAreaId = null;
        refreshEditorState();
        setDirty(true);
        setStatus('Area deleted.', false);
    }

    // 5. Lifecycle & Socket Handlers
    function handleSaveResponse(res) {
        if (res?.success) {
            state.saving = false;
            setDirty(false);
            setStatus('Changes saved.', false);
        } else {
            state.saving = false;
            syncSaveAffordance();
            setStatus(res?.error || 'Failed to save world package.', true);
        }
    }

    function handleUploadResponse(res) {
        if (res?.success) {
            state.imageUrl = res.imageUrl || '';
            state.imageFile = res.imageFile || res.fileName || '';
            state.isTiled = !!res.isTiled;
            state.tileUrl = res.tileUrl || '';
            state.imageDimensions = normalizeDimensions(res.dimensions);
            if (!state.worldData) state.worldData = { meta: {}, nodes: [], areas: [] };
            state.worldData.meta = state.worldData.meta || {};
            state.worldData.meta.image_file = state.imageFile;
            state.worldData.meta.dimensions = { ...state.imageDimensions };
            state.worldData.meta.is_compiled = !!state.isTiled;
            syncMetaForm();
            ensureMap().catch((error) => {
                const detail = error?.message || String(error || 'unknown error');
                setStatus(`Failed to initialize map: ${detail}`, true);
            });
            setDirty(false);
            requestTravelSimulation();
            setStatus('Image uploaded and map ready.', false);
        } else {
            setStatus(res?.error || 'Image upload failed.', true);
        }
    }

    function handleTravelSimulationResponse(res) {
        const requestId = typeof res?.requestId === 'string' ? res.requestId : '';
        if (!requestId) return;
        if (requestId !== state.simLatestRequestId) return;
        state.simPendingRequestId = null;
        state.simLatestRequestId = null;

        if (!syncTravelSimulationControls()) return;

        if (!res?.success) {
            setSimulationState('Error', false);
            if (el.simMessage) el.simMessage.textContent = res?.error || 'Travel simulation failed.';
            setSimulationReadout('-', '-', '-');
            return;
        }

        const distanceKm = Number(res.distanceKm);
        const days = Number(res.days);
        const narrativeText = String(res.narrativeText || '-');
        setSimulationReadout(
            Number.isFinite(distanceKm) ? String(distanceKm) : '-',
            Number.isFinite(days) ? days.toFixed(1) : '-',
            narrativeText
        );

        setSimulationState('Validated', true);
        const nodes = Array.isArray(state.worldData?.nodes) ? state.worldData.nodes : [];
        const origin = nodes.find((node) => node.uid === (res.originNodeUid || state.simOriginNodeUid));
        const destination = nodes.find((node) => node.uid === (res.destinationNodeUid || state.simDestinationNodeUid));
        if (el.simMessage) {
            const originName = origin?.name || 'Origin';
            const destinationName = destination?.name || 'Destination';
            el.simMessage.textContent = `${originName} -> ${destinationName} using current world scale values.`;
        }
    }

    // Current backend response events.
    onSocket('world-map-save-package-response', handleSaveResponse, cleanupFns);
    onSocket('world-map-upload-image-response', handleUploadResponse, cleanupFns);
    onSocket('world-map-simulate-travel-response', handleTravelSimulationResponse, cleanupFns);

    // 6. Final Initialization
    if (el.uploadBtn) onDom(el.uploadBtn, 'click', () => el.imageInput?.click(), {}, cleanupFns);
    if (el.imageInput) onDom(el.imageInput, 'change', (e) => { if (e.target.files?.[0]) {
        const reader = new FileReader(); reader.onload = () => emitSocket('world-map-upload-image', {
            packagePath: WORLD_PACKAGE_PATH,
            fileName: e.target.files[0].name,
            dataUrl: reader.result,
            worldData: prepareWorldDataForSave(),
            biomeMaskDataUrl: state.biomeCanvas ? state.biomeCanvas.toDataURL('image/png') : ''
        });
        reader.readAsDataURL(e.target.files[0]);
    }}, {}, cleanupFns);
    if (el.saveBtn) onDom(el.saveBtn, 'click', saveWorldPackage, {}, cleanupFns);
    if (el.saveNudgeBtn) onDom(el.saveNudgeBtn, 'click', saveWorldPackage, {}, cleanupFns);
    if (el.addNodeBtn) onDom(el.addNodeBtn, 'click', () => setInteractionMode('add-node'), {}, cleanupFns);
    if (el.originModeBtn) onDom(el.originModeBtn, 'click', () => setInteractionMode('set-origin'), {}, cleanupFns);
    if (el.drawAreaBtn) onDom(el.drawAreaBtn, 'click', () => { state.draftAreaPoints = []; setInteractionMode('draw-area'); }, {}, cleanupFns);
    if (el.cancelAreaBtn) onDom(el.cancelAreaBtn, 'click', () => { state.draftAreaPoints = []; setInteractionMode('pan'); renderMapDecorations(); }, {}, cleanupFns);
    if (el.finishAreaBtn) onDom(el.finishAreaBtn, 'click', finishDraftArea, {}, cleanupFns);
    if (el.resetViewBtn) onDom(el.resetViewBtn, 'click', () => { if (state.map && state.imageBounds) state.map.fitBounds(state.imageBounds); }, {}, cleanupFns);
    if (el.nodeTabBtn) onDom(el.nodeTabBtn, 'click', () => activateIndexTab('nodes'), {}, cleanupFns);
    if (el.areaTabBtn) onDom(el.areaTabBtn, 'click', () => activateIndexTab('areas'), {}, cleanupFns);
    if (el.biomeTabBtn) onDom(el.biomeTabBtn, 'click', () => activateIndexTab('biomes'), {}, cleanupFns);
    if (el.indexSearch) onDom(el.indexSearch, 'input', () => {
        state.indexSearch = el.indexSearch.value || '';
        renderNodeList();
        renderAreaList();
        renderBiomeList();
        syncIndexUi();
    }, {}, cleanupFns);
    if (el.nodeList) onDom(el.nodeList, 'click', (event) => {
        const item = event.target?.closest?.('[data-node-id]');
        if (item?.dataset?.nodeId) selectNode(item.dataset.nodeId);
    }, {}, cleanupFns);
    if (el.areaList) onDom(el.areaList, 'click', (event) => {
        const item = event.target?.closest?.('[data-area-id]');
        if (item?.dataset?.areaId) selectArea(item.dataset.areaId);
    }, {}, cleanupFns);
    if (el.biomeList) onDom(el.biomeList, 'click', (event) => {
        const item = event.target?.closest?.('[data-biome-id]');
        if (item?.dataset?.biomeId) selectBiome(item.dataset.biomeId);
    }, {}, cleanupFns);
    [el.originX, el.originY, el.scaleFactor, el.pixelsPerKm, el.walkSpeed, el.windingFactor].forEach(input => {
        if (input) onDom(input, 'change', updateMetaFromForm, {}, cleanupFns);
    });
    if (el.simOriginNode) onDom(el.simOriginNode, 'change', () => {
        state.simOriginNodeUid = el.simOriginNode.value || null;
        if (state.simOriginNodeUid && state.simOriginNodeUid === state.simDestinationNodeUid) {
            const nodes = Array.isArray(state.worldData?.nodes) ? state.worldData.nodes : [];
            const fallback = nodes.find((node) => node.uid !== state.simOriginNodeUid);
            state.simDestinationNodeUid = fallback ? fallback.uid : state.simDestinationNodeUid;
        }
        syncTravelSimulationControls();
        requestTravelSimulation();
    }, {}, cleanupFns);
    if (el.simDestinationNode) onDom(el.simDestinationNode, 'change', () => {
        state.simDestinationNodeUid = el.simDestinationNode.value || null;
        if (state.simDestinationNodeUid && state.simDestinationNodeUid === state.simOriginNodeUid) {
            const nodes = Array.isArray(state.worldData?.nodes) ? state.worldData.nodes : [];
            const fallback = nodes.find((node) => node.uid !== state.simDestinationNodeUid);
            state.simOriginNodeUid = fallback ? fallback.uid : state.simOriginNodeUid;
        }
        syncTravelSimulationControls();
        requestTravelSimulation();
    }, {}, cleanupFns);
    [el.nodeName, el.nodeType, el.nodeDescription, el.nodeTags].forEach(input => {
        if (input) onDom(input, 'input', () => updateNodeFromForm({ redrawMap: false }), {}, cleanupFns);
    });
    [el.nodeWorldX, el.nodeWorldY].forEach(input => {
        if (input) onDom(input, 'change', () => updateNodeFromForm({ redrawMap: true }), {}, cleanupFns);
    });
    [el.areaName, el.areaKind, el.areaTags, el.areaDescription].forEach(input => {
        if (input) onDom(input, 'input', () => updateAreaFromForm({ redrawMap: false }), {}, cleanupFns);
    });
    [el.areaParent, el.areaColor].forEach(input => {
        if (input) onDom(input, 'change', () => updateAreaFromForm({ redrawMap: true }), {}, cleanupFns);
    });
    [el.biomeName].forEach(input => {
        if (input) onDom(input, 'input', updateBiomeFromForm, {}, cleanupFns);
    });
    if (el.biomeColor) onDom(el.biomeColor, 'change', updateBiomeFromForm, {}, cleanupFns);
    [el.biomeNeedsBoat, el.biomeSlowsDown, el.biomeIsRoad, el.biomeIsRiver].forEach(input => {
        if (input) onDom(input, 'change', updateBiomeFromForm, {}, cleanupFns);
    });
    if (el.biomeBrushSize) onDom(el.biomeBrushSize, 'input', () => {
        state.biomeBrushSize = Math.max(2, Math.round(toNumber(el.biomeBrushSize.value, 24)));
        syncBiomeForm();
    }, {}, cleanupFns);
    if (el.biomeOpacity) onDom(el.biomeOpacity, 'input', () => {
        state.biomeMaskOpacity = Math.max(0, Math.min(1, toNumber(el.biomeOpacity.value, 45) / 100));
        syncBiomeForm();
        scheduleBiomeOverlayUpdate();
    }, {}, cleanupFns);
    if (el.biomeEraser) onDom(el.biomeEraser, 'change', () => {
        state.biomeEraser = !!el.biomeEraser.checked;
        setInteractionMode('paint-biome');
        syncSelectionSummary();
    }, {}, cleanupFns);
    if (el.addBiomeBtn) onDom(el.addBiomeBtn, 'click', addBiome, {}, cleanupFns);
    if (el.deleteBiomeBtn) onDom(el.deleteBiomeBtn, 'click', deleteSelectedBiome, {}, cleanupFns);
    if (el.clearBiomeMaskBtn) onDom(el.clearBiomeMaskBtn, 'click', clearBiomeMask, {}, cleanupFns);
    if (el.deleteNodeBtn) onDom(el.deleteNodeBtn, 'click', deleteSelectedNode, {}, cleanupFns);
    if (el.deleteAreaBtn) onDom(el.deleteAreaBtn, 'click', deleteSelectedArea, {}, cleanupFns);
    onDom(document, 'mousemove', panBiomeMapFromMouseEvent, {}, cleanupFns);
    onDom(document, 'mouseup', () => {
        state.biomePainting = false;
        endBiomeRightPan();
    }, {}, cleanupFns);
    onDom(document, 'contextmenu', (event) => {
        if (state.interactionMode !== 'paint-biome') return;
        if (el.map && !el.map.contains(event.target)) return;
        event.preventDefault();
    }, {}, cleanupFns);
    onDom(document, 'keydown', (event) => {
        if (state.interactionMode !== 'draw-area') return;
        const tagName = String(event.target?.tagName || '').toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target?.isContentEditable) return;
        if (event.key !== 'Backspace' && event.key !== 'Delete') return;
        if (state.draftAreaPoints.length === 0) return;
        event.preventDefault();
        state.draftAreaPoints.pop();
        renderMapDecorations();
        setInteractionMode('draw-area');
        setDirty(true, 'draft-area');
        setStatus(`Removed last point. ${state.draftAreaPoints.length} point(s) remaining.`, false);
    }, {}, cleanupFns);

    const host = document.getElementById('pluginViewContainer');
    if (host) host.__pluginCleanup = cleanup;

    syncMetaForm();
    refreshEditorState({ redrawMap: false });
    syncSaveAffordance();
    requestTravelSimulation();
    ensureMap().catch((error) => {
        const detail = error?.message || String(error || 'unknown error');
        setStatus(`Failed to initialize map: ${detail}`, true);
    });

})();
