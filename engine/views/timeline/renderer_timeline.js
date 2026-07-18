// renderer_timeline.js - The Timeline View v2
// Bigger nodes, thick branch lines, dynamic layout reflow

// ============================================
// #region SOCKET.IO SETUP
// ============================================

const socket = io('http://localhost:14541', { query: { view: 'timeline' } });

socket.emitReceive = function (eventName, data, timeout = 10000) {
    return new Promise((resolve) => {
        let responded = false;
        const timer = setTimeout(() => {
            if (!responded) {
                responded = true;
                resolve({ success: false, error: 'timeout' });
            }
        }, timeout);

        this.emit(eventName, data);
        this.once(`${eventName}-response`, (result) => {
            if (!responded) {
                responded = true;
                clearTimeout(timer);
                resolve(result);
            }
        });
    });
};

// #endregion

socket.on('inject-permanent-assets', (assets) => {
    console.log(`[Timeline] Receiving ${assets.length} plugin asset payloads...`);
    beginExternalResourceLoad('Injecting plugin assets...');
    try {
        assets.forEach(asset => {
            if (asset.css) {
                const style = document.createElement('style');
                style.textContent = asset.css;
                style.setAttribute('data-plugin-id', asset.pluginId);
                document.head.appendChild(style);
            }
            if (asset.js) {
                try {
                    const resolveProjectPath = (relPath, projectNameOverride) => {
                        const projectName = projectNameOverride || window.currentProjectName || 'default_project';
                        return `../../../workspace/projects/${projectName.toLowerCase()}/${relPath}`;
                    };

                    const resolvePluginPath = (pId, relPath) => {
                        return `../../plugins/${pId}/${relPath}`;
                    };

                    const context = {
                        pluginId: asset.pluginId,
                        socket,
                        debugLog: (...args) => {
                            if (args.length === 1) console.log(`[Plugin:${asset.pluginId}] ${args[0]}`);
                            else console.log(`[Plugin:${asset.pluginId}] [${args[0]}] ${args[1]}`);
                        },
                        debugError: (...args) => {
                            if (args.length === 1) console.error(`[Plugin:${asset.pluginId}] ${args[0]}`);
                            else console.error(`[Plugin:${asset.pluginId}] [${args[0]}] ${args[1]}`, args[2] || '');
                        },
                        resolveProjectPath,
                        resolvePluginPath
                    };
                    const pluginScript = new Function('context', asset.js);
                    pluginScript(context);
                } catch (error) {
                    console.error(`Error executing plugin JS for ${asset.pluginId}:`, error);
                }
            }
        });
    } finally {
        endExternalResourceLoad();
    }
});

// Mock data removed
// Mock data removed

const NODE_GRADIENTS = [
    'linear-gradient(135deg, #3a2e1e, #5c4a2a, #3a2e1e)',
    'linear-gradient(135deg, #2a3040, #3d4a5c, #2a3040)',
    'linear-gradient(135deg, #2e3a1e, #4a5c2a, #2e3a1e)',
    'linear-gradient(135deg, #3a1e2e, #5c2a4a, #3a1e2e)'
];

// #endregion

// ============================================
// #region PAN & ZOOM ENGINE
// ============================================

const viewport = document.getElementById('timeline-viewport');
const canvas = document.getElementById('timeline-canvas');

let isPanning = false;
let startX = 0, startY = 0;
let offsetX = 0, offsetY = 0;
let scale = 1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_SPEED = 0.08;

function applyTransform() {
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    const zoomLabel = document.getElementById('zoom-level');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;

    // Reposition LeaderLines to keep them instantly attached during pan/zoom
    if (typeof turnRowState !== 'undefined') {
        forEachMountedRow(positionRowLines);
    }
}

viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.branch-toggle, .branch-item, .branch-leaf, .branch-item-toggle, .turn-node-circle, .zoom-controls, button')) return;
    isPanning = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    viewport.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    applyTransform();
});

window.addEventListener('mouseup', () => {
    isPanning = false;
    viewport.classList.remove('panning');
});

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    const delta = e.deltaY > 0 ? -ZOOM_SPEED : ZOOM_SPEED;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale + delta * scale));
    offsetX = mouseX - worldX * newScale;
    offsetY = mouseY - worldY * newScale;
    scale = newScale;
    applyTransform();
}, { passive: false });

document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
    scale = Math.min(ZOOM_MAX, scale + 0.15);
    applyTransform();
});
document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
    scale = Math.max(ZOOM_MIN, scale - 0.15);
    applyTransform();
});
document.getElementById('zoom-reset-btn')?.addEventListener('click', () => {
    scale = 1; offsetX = 0; offsetY = 0;
    applyTransform();
});

function panTo(targetX, targetY, targetScale = 1, duration = 800) {
    const startX = offsetX;
    const startY = offsetY;
    const startScale = scale;
    const startTime = performance.now();

    // Easing function: easeOutQuart
    function easeOutQuart(x) {
        return 1 - Math.pow(1 - x, 4);
    }

    function animate(currentTime) {
        let elapsed = currentTime - startTime;
        let progress = Math.min(elapsed / duration, 1);
        let ease = easeOutQuart(progress);

        offsetX = startX + (targetX - startX) * ease;
        offsetY = startY + (targetY - startY) * ease;
        scale = startScale + (targetScale - startScale) * ease;

        applyTransform();

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

// Navigation Controls
document.getElementById('nav-top-btn')?.addEventListener('click', () => {
    if (turnRowState.length === 0) return;
    const targetX = window.innerWidth / 2 - (canvas.clientWidth || 1200) / 2;
    const targetY = 150;
    panTo(targetX, targetY, 1, 800);
});

document.getElementById('nav-bottom-btn')?.addEventListener('click', () => {
    if (turnRowState.length === 0) return;
    const lastRow = turnRowState[turnRowState.length - 1];
    const topStr = lastRow.el.style.top;
    const yPos = parseFloat(topStr) || 0;
    const rowMidY = yPos + lastRow.currentHeight / 2;

    // We want the last row middle to be centered vertically
    const targetX = window.innerWidth / 2 - (canvas.clientWidth || 1200) / 2;
    const targetY = (window.innerHeight / 2) - rowMidY;
    panTo(targetX, targetY, 1, 800);
});

// #endregion

// ============================================
// #region LAYOUT ENGINE & STATE
// ============================================

const BASE_ROW_HEIGHT = 440;       // Minimum height per turn row (bigger node + cards)
const CANVAS_TOP_PADDING = 100;
const ROW_GAP = 80;                // Vertical gap between turn rows
const NODE_HEIGHT_HALF = 72;       // Half of 144px node height
const BRANCH_ITEM_HEIGHT = 85;     // Approx height of a branch item
const BRANCH_ITEM_GAP = 14;       // Gap between stacked branch items
const BRANCH_OFFSET_X = 50;       // Horizontal distance from card edge to branch items
const LEAF_OFFSET_X = 40;
const GRID_WIDTH = 900;             // Width of the grid container
const GRID_MAX_HEIGHT = 420;        // Max height before scrolling kicks in

// State: array of per-row data
let turnRowState = [];
const mountedRowIndexes = new Set();
const rowMountQueue = [];
const INITIAL_MOUNT_COUNT = 8;
const HYDRATION_BUFFER_ROWS = 8;
const HYDRATION_DEBOUNCE_MS = 35;
const HYDRATION_VIEWPORT_SETTLE_MS = 180;
const HYDRATION_REQUEST_TIMEOUT_MS = 30000;
const DIAG_SLOW_MERGE_MS = 60;
const DIAG_SLOW_MOUNT_MS = 80;
const DIAG_SLOW_RERENDER_MS = 100;
const DIAG_SLOW_RELAYOUT_MS = 50;
const DIAG_SLOW_LINE_POSITION_MS = 30;
const DIAG_MOUNT_QUEUE_FRAME_MS = 12;
const DIAG_SLOW_RESOURCE_MS = 1000;
const DIAG_FRAME_GAP_MS = 250;
const DIAG_POST_MERGE_PROBE_MS = 200;
const MAX_MOUNTS_PER_FRAME = 2;
const ROW_UNMOUNT_DELAY_MS = 140;
const INDICATOR_MIN_VISIBLE_MS = 350;
const INDICATOR_IDLE_HIDE_DELAY_MS = 1200;
const OBSERVED_RESOURCE_TIMEOUT_MS = 45000;

let mountQueueScheduled = false;
let activeRowMounts = 0;
let activeExternalLoads = 0;
let activeExternalLoadLabel = '';
let observedResourceLoads = 0;
let relayoutFrame = null;
let indicatorVisibleSince = 0;
let indicatorHideTimer = null;
let lastPendingResourceDiagAt = 0;
let resourceObserver = null;
const trackedResourceElements = new Map();
let hydrationRequestSeq = 0;
let timelineLoadSeq = 0;
let activeTimelineLoad = null;
let relayoutDiagSeq = 0;
let lastAnimationFrameTime = 0;
let frameGapMonitorStarted = false;
let longTaskObserverStarted = false;

function timelineDiag(message, data = null) {
    if (data) {
        console.log(`[TimelineDiag] ${message}`, data);
    } else {
        console.log(`[TimelineDiag] ${message}`);
    }
}

function getTimelineDiagSnapshot() {
    return {
        rows: turnRowState.length,
        mounted: mountedRowIndexes.size,
        queuedMounts: rowMountQueue.length,
        activeRowMounts,
        hydrating: getPendingHydrationCount(),
        externalLoads: activeExternalLoads,
        observedResources: observedResourceLoads,
        scale: Number(scale.toFixed(2))
    };
}

function markTimelinePhase(phase, extra = {}) {
    if (!activeTimelineLoad) return;
    timelineDiag(`Load ${activeTimelineLoad.id}: ${phase}`, {
        elapsedMs: Math.round(performance.now() - activeTimelineLoad.startedAt),
        ...getTimelineDiagSnapshot(),
        ...extra
    });
}

function startFrameGapMonitor() {
    if (frameGapMonitorStarted) return;
    frameGapMonitorStarted = true;
    lastAnimationFrameTime = performance.now();

    const tick = (now) => {
        const gapMs = Math.round(now - lastAnimationFrameTime);
        if (gapMs >= DIAG_FRAME_GAP_MS) {
            timelineDiag('Main thread/frame gap detected', {
                gapMs,
                ...getTimelineDiagSnapshot()
            });
        }
        lastAnimationFrameTime = now;
        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}

function startLongTaskObserver() {
    if (longTaskObserverStarted || typeof PerformanceObserver !== 'function') return;
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                timelineDiag('Browser long task', {
                    durationMs: Math.round(entry.duration),
                    startMs: Math.round(entry.startTime),
                    name: entry.name || '',
                    attribution: Array.from(entry.attribution || []).map(item => ({
                        name: item.name,
                        entryType: item.entryType,
                        containerType: item.containerType,
                        containerName: item.containerName,
                        containerSrc: item.containerSrc
                    })).slice(0, 5),
                    ...getTimelineDiagSnapshot()
                });
            }
        });
        observer.observe({ entryTypes: ['longtask'] });
        longTaskObserverStarted = true;
        timelineDiag('Long task observer started');
    } catch (error) {
        timelineDiag('Long task observer unavailable', { error: error.message });
    }
}

function schedulePostMergeProbes(label, startedAt, extra = {}) {
    setTimeout(() => {
        timelineDiag(`${label}: setTimeout probe`, {
            delayMs: Math.round(performance.now() - startedAt),
            ...getTimelineDiagSnapshot(),
            ...extra
        });
    }, 0);

    setTimeout(() => {
        timelineDiag(`${label}: delayed timer probe`, {
            delayMs: Math.round(performance.now() - startedAt),
            targetDelayMs: DIAG_POST_MERGE_PROBE_MS,
            ...getTimelineDiagSnapshot(),
            ...extra
        });
    }, DIAG_POST_MERGE_PROBE_MS);

    requestAnimationFrame(() => {
        timelineDiag(`${label}: requestAnimationFrame probe`, {
            delayMs: Math.round(performance.now() - startedAt),
            ...getTimelineDiagSnapshot(),
            ...extra
        });
        requestAnimationFrame(() => {
            timelineDiag(`${label}: second requestAnimationFrame probe`, {
                delayMs: Math.round(performance.now() - startedAt),
                ...getTimelineDiagSnapshot(),
                ...extra
            });
        });
    });
}
let hydrationFlushTimer = null;
let hydrationSettleTimer = null;
let pendingHydrationStart = null;
let pendingHydrationEnd = null;
const hydrationRequests = new Map();

function forEachMountedRow(callback) {
    for (const index of mountedRowIndexes) {
        const rowState = turnRowState[index];
        if (rowState) callback(rowState);
    }
}

function forEachRowLine(rowState, callback) {
    if (!rowState) return;

    (rowState.primaryLines || []).forEach(callback);

    if (rowState.branchActiveLines) {
        ['left', 'right'].forEach(side => {
            (rowState.branchActiveLines[side] || []).forEach(callback);
        });
    }

    if (rowState.leafActiveLines) {
        ['left', 'right'].forEach(side => {
            const sideLines = rowState.leafActiveLines[side] || {};
            for (const idx in sideLines) {
                (sideLines[idx] || []).forEach(callback);
            }
        });
    }

    if (rowState.subleafActiveLines) {
        ['left', 'right'].forEach(side => {
            const sideLines = rowState.subleafActiveLines[side] || {};
            for (const key in sideLines) {
                (sideLines[key] || []).forEach(callback);
            }
        });
    }
}

function positionRowLines(rowState) {
    const startedAt = performance.now();
    let lineCount = 0;
    forEachRowLine(rowState, (line) => {
        try {
            lineCount += 1;
            line.position();
        } catch {}
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_LINE_POSITION_MS) {
        timelineDiag('Slow row line positioning', {
            index: rowState?.index,
            turnNumber: rowState?.data?.turnNumber,
            lineCount,
            elapsedMs
        });
    }
}

function removeRowLines(rowState, {
    removePrimary = true,
    removeBranch = true,
    removeLeaf = true,
    removeSubleaf = true
} = {}) {
    if (!rowState) return;

    if (removePrimary && rowState.primaryLines) {
        rowState.primaryLines.forEach(line => { try { line.remove(); } catch {} });
        rowState.primaryLines = [];
    }

    if (removeBranch && rowState.branchActiveLines) {
        ['left', 'right'].forEach(side => {
            rowState.branchActiveLines[side].forEach(line => { try { line.remove(); } catch {} });
            rowState.branchActiveLines[side] = [];
        });
    }

    if (removeLeaf && rowState.leafActiveLines) {
        ['left', 'right'].forEach(side => {
            const leafMap = rowState.leafActiveLines[side];
            for (const idx in leafMap) {
                leafMap[idx].forEach(line => { try { line.remove(); } catch {} });
            }
            rowState.leafActiveLines[side] = {};
        });
    }

    if (removeSubleaf && rowState.subleafActiveLines) {
        ['left', 'right'].forEach(side => {
            const subleafMap = rowState.subleafActiveLines[side];
            for (const key in subleafMap) {
                subleafMap[key].forEach(line => { try { line.remove(); } catch {} });
            }
            rowState.subleafActiveLines[side] = {};
        });
    }
}

function resetRowBranchCollections(rowState) {
    ['left', 'right'].forEach(side => {
        (rowState.branchElements[side] || []).forEach(el => { try { el.remove(); } catch {} });
        rowState.branchElements[side] = [];

        const leafMap = rowState.leafElements[side] || {};
        for (const idx in leafMap) {
            (leafMap[idx] || []).forEach(el => { try { el.remove(); } catch {} });
        }
        rowState.leafElements[side] = {};

        const subleafMap = rowState.subleafElements[side] || {};
        for (const key in subleafMap) {
            (subleafMap[key] || []).forEach(el => { try { el.remove(); } catch {} });
        }
        rowState.subleafElements[side] = {};
    });

    rowState.leftExpanded = false;
    rowState.rightExpanded = false;
    rowState.leftL3Expanded = {};
    rowState.rightL3Expanded = {};
    rowState.leftL4Expanded = {};
    rowState.rightL4Expanded = {};
}

function scheduleRelayout() {
    if (relayoutFrame) return;
    relayoutFrame = requestAnimationFrame(() => {
        relayoutFrame = null;
        relayoutTimeline();
    });
}

function isTrackableResourceElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();

    if (tag === 'IMG') {
        return !!el.getAttribute('src');
    }
    if (tag === 'SCRIPT') {
        return !!el.getAttribute('src');
    }
    if (tag === 'LINK') {
        const relAttr = (el.getAttribute('rel') || '').toLowerCase();
        return relAttr.split(/\s+/).includes('stylesheet') && !!el.getAttribute('href');
    }
    return false;
}

function shouldSkipResourceTracking(el) {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'IMG') {
        return !!el.complete;
    }
    if (tag === 'SCRIPT') {
        return !el.getAttribute('src');
    }
    if (tag === 'LINK') {
        if (!el.getAttribute('href')) return true;
        if (el.sheet) return true;
    }
    return false;
}

function untrackResourceElement(el) {
    const meta = trackedResourceElements.get(el);
    if (!meta) return;

    trackedResourceElements.delete(el);
    clearTimeout(meta.timeoutId);
    el.removeEventListener('load', meta.onDone, true);
    el.removeEventListener('error', meta.onDone, true);
    observedResourceLoads = Math.max(0, observedResourceLoads - 1);
    const elapsedMs = Math.round(performance.now() - meta.startedAt);
    if (elapsedMs >= DIAG_SLOW_RESOURCE_MS) {
        timelineDiag('Slow resource load', {
            tag: el.tagName,
            source: meta.source,
            elapsedMs
        });
    }
    updateResourceLoadingIndicator();
}

function trackResourceElement(el) {
    if (!isTrackableResourceElement(el) || shouldSkipResourceTracking(el) || trackedResourceElements.has(el)) {
        return;
    }

    const onDone = () => {
        untrackResourceElement(el);
    };

    const timeoutId = setTimeout(() => {
        untrackResourceElement(el);
    }, OBSERVED_RESOURCE_TIMEOUT_MS);

    trackedResourceElements.set(el, {
        onDone,
        timeoutId,
        startedAt: performance.now(),
        source: el.getAttribute('src') || el.getAttribute('href') || ''
    });
    observedResourceLoads += 1;

    el.addEventListener('load', onDone, { once: true, capture: true });
    el.addEventListener('error', onDone, { once: true, capture: true });
    updateResourceLoadingIndicator();
}

function scanNodeForTrackableResources(node, visitor) {
    if (!node || node.nodeType !== 1) return;

    if (isTrackableResourceElement(node)) {
        visitor(node);
    }

    const nested = node.querySelectorAll?.('img[src],script[src],link[rel~="stylesheet"][href]');
    if (!nested || nested.length === 0) return;
    nested.forEach(visitor);
}

function installResourceObserver() {
    if (resourceObserver || !document.body) return;

    // Capture resources that might already be present but still loading.
    scanNodeForTrackableResources(document.body, trackResourceElement);

    resourceObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                scanNodeForTrackableResources(node, trackResourceElement);
            });
            mutation.removedNodes.forEach((node) => {
                scanNodeForTrackableResources(node, untrackResourceElement);
            });
        });
    });

    resourceObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function clearTrackedResourceLoads() {
    const trackedEls = Array.from(trackedResourceElements.keys());
    trackedEls.forEach((el) => {
        const meta = trackedResourceElements.get(el);
        if (!meta) return;
        clearTimeout(meta.timeoutId);
        el.removeEventListener('load', meta.onDone, true);
        el.removeEventListener('error', meta.onDone, true);
        trackedResourceElements.delete(el);
    });
    observedResourceLoads = 0;
}

function getRowContentHeight(rowState) {
    if (!rowState.isMounted) {
        return Math.max(BASE_ROW_HEIGHT, rowState.currentHeight || BASE_ROW_HEIGHT);
    }

    let leftH = 0, rightH = 0;

    const calculateSideHeight = (side) => {
        let maxSideH = 0;
        const expandedL2 = rowState[side + 'Expanded'];
        const branches = rowState[side + 'Branches'];

        if (expandedL2 && branches) {
            const n = branches.length;
            let itemsH = 0;
            for (let i = 0; i < n; i++) {
                let h = BRANCH_ITEM_HEIGHT;
                if (rowState[side + 'L3Expanded'] && rowState[side + 'L3Expanded'][i]) {
                    h = Math.max(h, GRID_MAX_HEIGHT);
                }
                itemsH += h;
            }
            maxSideH = itemsH + (n > 0 ? (n - 1) * BRANCH_ITEM_GAP : 0);
        }
        return maxSideH;
    };

    leftH = calculateSideHeight('left');
    rightH = calculateSideHeight('right');

    // Measure the actual cards to enforce their height (since synopsis auto-expands)
    let cardH = 0;
    if (rowState.el) {
        const leftCard = rowState.el.querySelector('.branch-card.left');
        const rightCard = rowState.el.querySelector('.branch-card.right');
        cardH = Math.max(
            leftCard ? leftCard.offsetHeight : 0,
            rightCard ? rightCard.offsetHeight : 0
        );
    }

    const expandedH = Math.max(leftH, rightH);
    return Math.max(BASE_ROW_HEIGHT, cardH + 40, expandedH + 80);
}

function relayoutTimeline() {
    const startedAt = performance.now();
    const diagId = ++relayoutDiagSeq;
    let currentY = CANVAS_TOP_PADDING;
    let mountedRows = 0;

    for (const rowState of turnRowState) {
        if (rowState.isMounted) mountedRows += 1;
        const h = getRowContentHeight(rowState);
        rowState.currentHeight = h;
        rowState.el.style.top = `${currentY}px`;
        rowState.el.style.height = `${h}px`;

        // Reposition turn node to vertical center
        const node = rowState.el.querySelector('.turn-node');
        if (node) node.style.top = `${h / 2 - NODE_HEIGHT_HALF - 14}px`;

        // Reposition primary cards to vertical center
        const leftCard = rowState.el.querySelector('.branch-card.left');
        const rightCard = rowState.el.querySelector('.branch-card.right');
        if (leftCard) leftCard.style.top = `${h / 2}px`;
        if (rightCard) rightCard.style.top = `${h / 2}px`;

        // Layout the stacked branch items within the side dynamically
        layoutBranchSide(rowState, 'left', h);
        layoutBranchSide(rowState, 'right', h);

        currentY += h + ROW_GAP;
    }

    const totalHeight = currentY + 200;
    canvas.style.height = `${totalHeight}px`;

    const axis = canvas.querySelector('.timeline-axis');
    if (axis) axis.style.height = `${totalHeight}px`;

    // Reposition LeaderLines if they exist
    forEachMountedRow(positionRowLines);
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_RELAYOUT_MS) {
        timelineDiag('Slow relayoutTimeline', {
            diagId,
            elapsedMs,
            rows: turnRowState.length,
            mountedRows,
            mountedLineRows: mountedRowIndexes.size,
            totalHeight
        });
    }
}

function layoutBranchSide(rowState, side, rowH) {
    if (!rowState[side + 'Expanded']) return;
    const branches = rowState[side + 'Branches'];
    const items = rowState.branchElements[side];
    if (!items || items.length === 0) return;

    let totalH = 0;
    const itemHeights = [];
    for (let i = 0; i < branches.length; i++) {
        let h = BRANCH_ITEM_HEIGHT;
        if (rowState[side + 'L3Expanded'] && rowState[side + 'L3Expanded'][i]) {
            h = Math.max(h, GRID_MAX_HEIGHT);
        }
        itemHeights.push(h);
        totalH += h;
    }
    totalH += (branches.length > 0 ? (branches.length - 1) * BRANCH_ITEM_GAP : 0);

    let currentY = (rowH - totalH) / 2;

    for (let i = 0; i < branches.length; i++) {
        const item = items[i];
        if (item) {
            // Center the L2 item inside its reserved vertical block
            const itemOffset = currentY + (itemHeights[i] - BRANCH_ITEM_HEIGHT) / 2;
            item.style.top = `${itemOffset}px`;
        }

        if (rowState[side + 'L3Expanded'] && rowState[side + 'L3Expanded'][i]) {
            const leafArray = rowState.leafElements[side][i];
            if (leafArray && leafArray.length > 0) {
                const gridEl = leafArray[0];
                const gridOffset = currentY + (itemHeights[i] - GRID_MAX_HEIGHT) / 2;
                gridEl.style.top = `${gridOffset}px`;

                // If L4 toggle exists
                if (leafArray[1]) {
                    const l4Toggle = leafArray[1];
                    const toggleY = gridOffset + GRID_MAX_HEIGHT / 2;
                    l4Toggle.style.top = `${toggleY}px`;
                }

                // If L4 grid is expanded
                const key = `${i}-0`;
                if (rowState[side + 'L4Expanded'][key]) {
                    const subleafArray = rowState.subleafElements[side][key];
                    if (subleafArray && subleafArray.length > 0) {
                        const sumGrid = subleafArray[0];
                        sumGrid.style.top = `${gridOffset}px`;
                    }
                }
            }
        }
        currentY += itemHeights[i] + BRANCH_ITEM_GAP;
    }
}

// ============================================

function createTurnRowShell(turn, index) {
    const row = document.createElement('div');
    row.className = 'turn-row turn-row-shell is-offscreen';
    row.style.width = '100%';
    row.style.pointerEvents = 'none';
    row.setAttribute('data-index', index);
    row.setAttribute('data-turn', turn.turnNumber);
    row.turnData = turn;
    return row;
}

function clearRowMountQueue() {
    rowMountQueue.length = 0;
    mountQueueScheduled = false;
    activeRowMounts = 0;

    for (const rowState of turnRowState) {
        rowState.isMountQueued = false;
        rowState.isMounting = false;
        if (rowState.unmountTimer) {
            clearTimeout(rowState.unmountTimer);
            rowState.unmountTimer = null;
        }
    }
}

function clearHydrationState() {
    if (hydrationFlushTimer) {
        clearTimeout(hydrationFlushTimer);
        hydrationFlushTimer = null;
    }
    if (hydrationSettleTimer) {
        clearTimeout(hydrationSettleTimer);
        hydrationSettleTimer = null;
    }

    for (const request of hydrationRequests.values()) {
        if (request.timer) clearTimeout(request.timer);
    }

    hydrationRequests.clear();
    pendingHydrationStart = null;
    pendingHydrationEnd = null;
    updateResourceLoadingIndicator();
}

function requestHydrationForRange(startIndex, endIndex) {
    if (!Array.isArray(turnRowState) || turnRowState.length === 0) return;

    const start = Math.max(0, Math.min(turnRowState.length - 1, Math.floor(Number(startIndex) || 0)));
    const end = Math.max(start, Math.min(turnRowState.length - 1, Math.floor(Number(endIndex) || start)));
    let neededStart = null;
    let neededEnd = null;

    for (let index = start; index <= end; index++) {
        const rowState = turnRowState[index];
        if (!rowState || rowState.isHydrated || rowState.isHydrating) continue;
        rowState.isHydrating = true;
        neededStart = neededStart === null ? index : Math.min(neededStart, index);
        neededEnd = neededEnd === null ? index : Math.max(neededEnd, index);
    }

    if (neededStart === null || neededEnd === null) return;

    pendingHydrationStart = pendingHydrationStart === null ? neededStart : Math.min(pendingHydrationStart, neededStart);
    pendingHydrationEnd = pendingHydrationEnd === null ? neededEnd : Math.max(pendingHydrationEnd, neededEnd);
    updateResourceLoadingIndicator();

    if (!hydrationFlushTimer) {
        hydrationFlushTimer = setTimeout(flushHydrationRequest, HYDRATION_DEBOUNCE_MS);
    }
}

function requestHydrationForSettledViewport() {
    let firstVisible = null;
    let lastVisible = null;

    for (const rowState of turnRowState) {
        if (!rowState?.shouldBeVisible || rowState.isHydrated || rowState.isHydrating) continue;
        firstVisible = firstVisible === null ? rowState.index : Math.min(firstVisible, rowState.index);
        lastVisible = lastVisible === null ? rowState.index : Math.max(lastVisible, rowState.index);
    }

    if (firstVisible === null || lastVisible === null) return;
    requestHydrationForRange(firstVisible - HYDRATION_BUFFER_ROWS, lastVisible + HYDRATION_BUFFER_ROWS);
}

function scheduleViewportHydration() {
    if (hydrationSettleTimer) {
        clearTimeout(hydrationSettleTimer);
    }

    hydrationSettleTimer = setTimeout(() => {
        hydrationSettleTimer = null;
        requestHydrationForSettledViewport();
    }, HYDRATION_VIEWPORT_SETTLE_MS);
}

function clearHydratingFlags(startIndex, endIndex) {
    const start = Math.max(0, Math.min(turnRowState.length - 1, Math.floor(Number(startIndex) || 0)));
    const end = Math.max(start, Math.min(turnRowState.length - 1, Math.floor(Number(endIndex) || start)));

    for (let index = start; index <= end; index++) {
        const rowState = turnRowState[index];
        if (rowState && !rowState.isHydrated) rowState.isHydrating = false;
    }
}

function getPendingHydrationCount() {
    if (!Array.isArray(turnRowState) || turnRowState.length === 0) return 0;

    return turnRowState.reduce((count, rowState) => {
        return count + (rowState?.isHydrating && !rowState?.isHydrated ? 1 : 0);
    }, 0);
}

function flushHydrationRequest() {
    hydrationFlushTimer = null;
    if (pendingHydrationStart === null || pendingHydrationEnd === null) return;

    const startIndex = pendingHydrationStart;
    const endIndex = pendingHydrationEnd;
    pendingHydrationStart = null;
    pendingHydrationEnd = null;

    const requestId = `timeline_range_${Date.now()}_${++hydrationRequestSeq}`;
    const timer = setTimeout(() => {
        const request = hydrationRequests.get(requestId);
        if (!request) return;
        hydrationRequests.delete(requestId);
        clearHydratingFlags(request.startIndex, request.endIndex);
        updateResourceLoadingIndicator();
        console.warn(`[Timeline] Hydration request timed out for rows ${request.startIndex}-${request.endIndex}.`);
    }, HYDRATION_REQUEST_TIMEOUT_MS);

    hydrationRequests.set(requestId, { startIndex, endIndex, timer, requestedAt: performance.now() });
    timelineDiag('Requesting hydration range', { requestId, startIndex, endIndex });
    socket.emit('get-timeline-range-data', { requestId, startIndex, endIndex });
}

function rerenderMountedRow(rowState) {
    if (!rowState?.isMounted || rowState.isMounting) return;

    const startedAt = performance.now();
    notifyRowHide(rowState);
    removeRowLines(rowState);
    resetRowBranchCollections(rowState);
    renderTurnRow(rowState.data, rowState.index, rowState, rowState.el);
    rowState.el.classList.remove('is-offscreen', 'turn-row-shell');
    createPrimaryLinesForRow(rowState);
    scheduleRelayout();

    if (rowState.shouldBeVisible) {
        notifyRowShow(rowState);
        requestAnimationFrame(() => positionRowLines(rowState));
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_RERENDER_MS) {
        timelineDiag('Slow row rerender', {
            index: rowState.index,
            turnNumber: rowState.data?.turnNumber,
            elapsedMs,
            hydrated: rowState.isHydrated
        });
    }
}

function mergeHydratedTurnData(turnData, fallbackIndex) {
    const startedAt = performance.now();
    const index = Number.isInteger(Number(turnData?.index))
        ? Number(turnData.index)
        : fallbackIndex;
    const rowState = turnRowState[index];
    if (!rowState) return;

    rowState.data = {
        ...rowState.data,
        ...turnData,
        leftCard: Array.isArray(turnData.leftCard) ? turnData.leftCard : [],
        rightCard: Array.isArray(turnData.rightCard) ? turnData.rightCard : [],
        leftBranches: Array.isArray(turnData.leftBranches) ? turnData.leftBranches : [],
        rightBranches: Array.isArray(turnData.rightBranches) ? turnData.rightBranches : [],
        hydrated: true
    };
    rowState.leftBranches = rowState.data.leftBranches;
    rowState.rightBranches = rowState.data.rightBranches;
    rowState.isHydrated = true;
    rowState.isHydrating = false;

    if (rowState.isMounted) {
        rerenderMountedRow(rowState);
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_MERGE_MS) {
        timelineDiag('Slow hydrated row merge', {
            index,
            turnNumber: rowState.data?.turnNumber,
            elapsedMs,
            mounted: rowState.isMounted,
            leftCards: rowState.data.leftCard?.length || 0,
            rightCards: rowState.data.rightCard?.length || 0,
            leftBranches: rowState.data.leftBranches?.length || 0,
            rightBranches: rowState.data.rightBranches?.length || 0
        });
    }
}

function notifyRowShow(rowState) {
    const event = new CustomEvent('timeline-row-show', {
        detail: {
            turn: rowState.el.turnData,
            index: parseInt(rowState.el.getAttribute('data-index'))
        },
        bubbles: true
    });
    rowState.el.dispatchEvent(event);
}

function notifyRowHide(rowState) {
    const event = new CustomEvent('timeline-row-hide', {
        detail: {
            turn: rowState.el.turnData,
            index: parseInt(rowState.el.getAttribute('data-index'))
        },
        bubbles: true
    });
    rowState.el.dispatchEvent(event);
}

function createPrimaryLinesForRow(rowState) {
    if (!rowState?.el) return;

    removeRowLines(rowState, { removePrimary: true, removeBranch: false, removeLeaf: false, removeSubleaf: false });

    const node = rowState.el.querySelector('.turn-node-circle');
    const leftCard = rowState.el.querySelector('.branch-card.left');
    const rightCard = rowState.el.querySelector('.branch-card.right');

    if (node && leftCard) {
        rowState.primaryLines.push(new LeaderLine(node, leftCard, {
            color: 'rgba(255, 204, 0, 0.4)',
            size: 8,
            path: 'straight',
            startPlug: 'behind',
            endPlug: 'behind'
        }));
    }
    if (node && rightCard) {
        rowState.primaryLines.push(new LeaderLine(node, rightCard, {
            color: 'rgba(255, 204, 0, 0.4)',
            size: 8,
            path: 'straight',
            startPlug: 'behind',
            endPlug: 'behind'
        }));
    }
}

function mountRow(rowState) {
    if (!rowState || rowState.isMounted || rowState.isMounting) return;

    const startedAt = performance.now();
    rowState.isMounting = true;
    activeRowMounts += 1;
    updateResourceLoadingIndicator();

    try {
        renderTurnRow(rowState.data, rowState.index, rowState, rowState.el);
        rowState.isMounted = true;
        rowState.isVisible = true;
        rowState.el.classList.remove('is-offscreen', 'turn-row-shell');
        mountedRowIndexes.add(rowState.index);

        createPrimaryLinesForRow(rowState);
        scheduleRelayout();

        if (rowState.shouldBeVisible) {
            notifyRowShow(rowState);
            requestAnimationFrame(() => positionRowLines(rowState));
        }
    } finally {
        rowState.isMounting = false;
        activeRowMounts = Math.max(0, activeRowMounts - 1);
        updateResourceLoadingIndicator();
    }

    if (!rowState.shouldBeVisible) {
        unmountRow(rowState);
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_MOUNT_MS) {
        timelineDiag('Slow row mount', {
            index: rowState.index,
            turnNumber: rowState.data?.turnNumber,
            elapsedMs,
            hydrated: rowState.isHydrated,
            leftCards: rowState.data?.leftCard?.length || 0,
            rightCards: rowState.data?.rightCard?.length || 0,
            leftBranches: rowState.data?.leftBranches?.length || 0,
            rightBranches: rowState.data?.rightBranches?.length || 0
        });
    }
}

function unmountRow(rowState) {
    if (!rowState || !rowState.isMounted || rowState.isMounting) return;

    notifyRowHide(rowState);

    removeRowLines(rowState);
    resetRowBranchCollections(rowState);
    rowState.el.innerHTML = '';
    rowState.el.classList.add('turn-row-shell', 'is-offscreen');
    rowState.el.style.width = '100%';
    rowState.isMounted = false;
    rowState.isVisible = false;
    rowState.isMountQueued = false;

    mountedRowIndexes.delete(rowState.index);
    scheduleRelayout();
}

function queueRowMount(rowState, priority = false) {
    if (!rowState || rowState.isMounted || rowState.isMountQueued) return;
    rowState.isMountQueued = true;
    rowState.mountQueuedAt = performance.now();

    if (priority) {
        rowMountQueue.unshift(rowState);
    } else {
        rowMountQueue.push(rowState);
    }

    updateResourceLoadingIndicator();
    if (!mountQueueScheduled) {
        mountQueueScheduled = true;
        requestAnimationFrame(processRowMountQueue);
    }
}

function processRowMountQueue() {
    mountQueueScheduled = false;
    const start = performance.now();
    let processed = 0;
    const queueStartLength = rowMountQueue.length;
    const processedRows = [];

    while (rowMountQueue.length > 0 && processed < MAX_MOUNTS_PER_FRAME && (performance.now() - start) < 10) {
        const rowState = rowMountQueue.shift();
        if (!rowState) continue;
        rowState.isMountQueued = false;

        if (!rowState.shouldBeVisible || rowState.isMounted) continue;
        const queuedForMs = rowState.mountQueuedAt
            ? Math.round(performance.now() - rowState.mountQueuedAt)
            : null;
        mountRow(rowState);
        processedRows.push({
            index: rowState.index,
            turnNumber: rowState.data?.turnNumber,
            queuedForMs
        });
        processed += 1;
    }

    const frameMs = Math.round(performance.now() - start);
    if (frameMs >= DIAG_MOUNT_QUEUE_FRAME_MS || rowMountQueue.length > 0) {
        timelineDiag('Mount queue frame', {
            frameMs,
            processed,
            queueStartLength,
            queueRemaining: rowMountQueue.length,
            processedRows
        });
    }

    updateResourceLoadingIndicator();
    if (rowMountQueue.length > 0) {
        mountQueueScheduled = true;
        requestAnimationFrame(processRowMountQueue);
    }
}

/**
 * Clears the current timeline, removes all connection lines, and resets the view transform.
 * Used for initialization and when switching between chat databases.
 */
function clearTimeline() {
    console.log('[Timeline] Clearing current view.');

    clearRowMountQueue();
    clearHydrationState();
    mountedRowIndexes.clear();
    activeExternalLoads = 0;
    activeExternalLoadLabel = '';
    clearTrackedResourceLoads();
    indicatorVisibleSince = 0;
    if (indicatorHideTimer) {
        clearTimeout(indicatorHideTimer);
        indicatorHideTimer = null;
    }
    if (relayoutFrame) {
        window.cancelAnimationFrame(relayoutFrame);
        relayoutFrame = null;
    }

    // 1. Clean up ALL existing mounted content + LeaderLines
    for (const rowState of turnRowState) {
        if (rowState.isMounted) {
            notifyRowHide(rowState);
        }
        removeRowLines(rowState);
        resetRowBranchCollections(rowState);
    }

    // 2. Clear DOM and State
    canvas.innerHTML = '';
    turnRowState = [];

    // 3. Reset Pan & Zoom to defaults
    offsetX = 0;
    offsetY = 20;
    scale = 1;
    applyTransform();

    // 4. Reset virtualization observer if it exists
    if (virtualizationObserver) {
        virtualizationObserver.disconnect();
        virtualizationObserver = null;
    }

    updateResourceLoadingIndicator();
}

function renderTimeline(data) {
    // Standard cleanup
    clearTimeline();
    markTimelinePhase('renderTimeline start', { turns: Array.isArray(data) ? data.length : 0 });

    if (!data || data.length === 0) {
        // If we have no data, we just stay empty (loading overlay handles the visuals)
        return;
    }

    const axis = document.createElement('div');
    axis.className = 'timeline-axis';
    canvas.appendChild(axis);

    // Create lightweight row shells first; hydrate row content on visibility.
    data.forEach((turn, index) => {
        const rowState = {
            index,
            data: turn,
            leftBranches: turn.leftBranches || [],
            rightBranches: turn.rightBranches || [],
            leftExpanded: false,
            rightExpanded: false,
            leftL3Expanded: {},
            rightL3Expanded: {},
            leftL4Expanded: {},   // Track Level 4 expansion
            rightL4Expanded: {},
            currentHeight: BASE_ROW_HEIGHT,
            el: null,
            isMounted: false,
            isVisible: false,
            shouldBeVisible: false,
            isMountQueued: false,
            isMounting: false,
            unmountTimer: null,
            primaryLines: [],
            branchElements: { left: [], right: [] },
            leafElements: { left: {}, right: {} },
            subleafElements: { left: {}, right: {} }, // Level 4 elements
            branchActiveLines: { left: [], right: [] },
            leafActiveLines: { left: {}, right: {} }, // Level 3 dynamic LeaderLines
            subleafActiveLines: { left: {}, right: {} }, // Level 4 dynamic LeaderLines
            isHydrated: turn.hydrated === true,
            isHydrating: false
        };

        const row = createTurnRowShell(turn, index);
        rowState.el = row;
        canvas.appendChild(row);
        turnRowState.push(rowState);
    });

    // Initial layout for shells
    relayoutTimeline();
    markTimelinePhase('shell rows laid out');

    // Virtualization: hydrate visible rows on demand
    setupVirtualization();
    markTimelinePhase('virtualization setup');

    // Warm the first chunk so initial paint is quick without loading all turns.
    for (let i = 0; i < Math.min(INITIAL_MOUNT_COUNT, turnRowState.length); i++) {
        const rowState = turnRowState[i];
        rowState.shouldBeVisible = true;
        rowState.isVisible = true;
        queueRowMount(rowState, true);
    }
    requestHydrationForRange(0, Math.min(turnRowState.length - 1, INITIAL_MOUNT_COUNT + HYDRATION_BUFFER_ROWS - 1));

    // Final Post-Render Snapping Pass
    // Ensures LeaderLines align perfectly with transformed elements
    pulseSnapConnectorLines(800);
    markTimelinePhase('initial mount/hydration queued', { initialMountCount: Math.min(INITIAL_MOUNT_COUNT, turnRowState.length) });
}

/**
 * Hides the loading overlay with a fade-out transition.
 */
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        markTimelinePhase('overlay hidden');
        overlay.classList.add('hidden');
    }
}

/**
 * Shows the loading overlay (resets it to visible).
 */
function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        markTimelinePhase('overlay shown');
    }
}

function ensureResourceLoadingIndicator() {
    let indicator = document.getElementById('resource-loading-indicator');
    if (!indicator) {
        // Fallback if HTML shell does not contain the indicator node.
        indicator = document.createElement('div');
        indicator.id = 'resource-loading-indicator';
        indicator.setAttribute('aria-live', 'polite');
        indicator.innerHTML = `
            <span class="dot"></span>
            <span class="text">Loading timeline data...</span>
        `;
        document.body.appendChild(indicator);
    }

    indicator.style.position = 'fixed';
    indicator.style.left = 'var(--space-lg)';
    indicator.style.bottom = 'var(--space-lg)';
    indicator.style.zIndex = '11000';
    indicator.style.display = 'inline-flex';
    indicator.style.alignItems = 'center';
    indicator.style.gap = 'var(--space-sm)';
    indicator.style.padding = 'var(--space-sm) var(--space-md)';
    indicator.style.background = 'var(--glass-bg)';
    indicator.style.backdropFilter = 'var(--glass-blur) var(--glass-saturation)';
    indicator.style.border = 'var(--glass-border)';
    indicator.style.borderRadius = 'var(--radius-md)';
    indicator.style.boxShadow = 'var(--shadow-lg)';
    indicator.style.color = 'var(--text-main)';
    indicator.style.fontSize = 'var(--font-xs)';
    indicator.style.fontWeight = '600';
    indicator.style.letterSpacing = '0.4px';
    indicator.style.pointerEvents = 'none';
    indicator.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    if (indicator.dataset.visible !== '1') {
        indicator.dataset.visible = '0';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(8px)';
    }

    const dot = indicator.querySelector('.dot');
    if (dot) {
        dot.style.width = '9px';
        dot.style.height = '9px';
        dot.style.borderRadius = '50%';
        dot.style.background = 'var(--color-primary)';
        dot.style.boxShadow = '0 0 12px rgba(var(--color-primary-rgb), var(--opacity-dim))';

        if (typeof dot.animate === 'function' && dot.dataset.animStarted !== '1') {
            dot.dataset.animStarted = '1';
            dot.animate(
                [
                    { transform: 'scale(0.8)', opacity: 0.6 },
                    { transform: 'scale(1)', opacity: 1 },
                    { transform: 'scale(0.8)', opacity: 0.6 }
                ],
                { duration: 900, iterations: Infinity, easing: 'ease-in-out' }
            );
        }
    }

    return indicator;
}

function beginExternalResourceLoad(label = 'Loading resources...') {
    activeExternalLoads += 1;
    activeExternalLoadLabel = label;
    updateResourceLoadingIndicator();
}

function endExternalResourceLoad() {
    activeExternalLoads = Math.max(0, activeExternalLoads - 1);
    if (activeExternalLoads === 0) {
        activeExternalLoadLabel = '';
    }
    updateResourceLoadingIndicator();
}

function updateResourceLoadingIndicator() {
    const indicator = ensureResourceLoadingIndicator();
    const textEl = indicator.querySelector('.text');
    if (!textEl) return;
    const isVisible = indicator.dataset.visible === '1';

    const pendingRows = rowMountQueue.length + activeRowMounts;
    const pendingObserved = observedResourceLoads;
    const pendingHydration = getPendingHydrationCount();
    const hasPendingRows = pendingRows > 0;
    const hasExternalLoads = activeExternalLoads > 0;
    const hasObservedLoads = pendingObserved > 0;
    const hasHydration = pendingHydration > 0;
    const hasAnyPending = hasPendingRows || hasExternalLoads || hasObservedLoads || hasHydration;
    if (hasAnyPending) {
        const now = performance.now();
        if (now - lastPendingResourceDiagAt >= 1000) {
            lastPendingResourceDiagAt = now;
            const resourceSamples = Array.from(trackedResourceElements.entries()).slice(0, 8).map(([el, meta]) => ({
                tag: el.tagName,
                source: meta.source,
                ageMs: Math.round(now - meta.startedAt)
            }));
            timelineDiag('Pending timeline work/resources', {
                pendingRows,
                activeRowMounts,
                queuedMounts: rowMountQueue.length,
                pendingObserved,
                pendingHydration,
                activeExternalLoads,
                activeExternalLoadLabel,
                resourceSamples
            });
        }
    }

    if (!hasAnyPending) {
        if (!isVisible) {
            return;
        }

        const elapsed = Date.now() - indicatorVisibleSince;
        const hideNow = () => {
            indicator.dataset.visible = '0';
            indicator.style.opacity = '0';
            indicator.style.transform = 'translateY(8px)';
            indicatorHideTimer = null;
            indicatorVisibleSince = 0;
        };

        const minVisibleRemaining = Math.max(0, INDICATOR_MIN_VISIBLE_MS - elapsed);
        const hideDelay = Math.max(minVisibleRemaining, INDICATOR_IDLE_HIDE_DELAY_MS);

        if (hideDelay <= 0) {
            hideNow();
        } else if (!indicatorHideTimer) {
            indicatorHideTimer = setTimeout(hideNow, hideDelay);
        }
        return;
    }

    if (indicatorHideTimer) {
        clearTimeout(indicatorHideTimer);
        indicatorHideTimer = null;
    }

    if (hasExternalLoads && (hasPendingRows || hasObservedLoads || hasHydration)) {
        const totalPending = pendingRows + pendingObserved + pendingHydration;
        textEl.textContent = `${activeExternalLoadLabel || 'Loading resources...'} (${totalPending} item${totalPending === 1 ? '' : 's'} pending)`;
    } else if (hasExternalLoads) {
        textEl.textContent = activeExternalLoadLabel || 'Loading resources...';
    } else if ((hasPendingRows || hasObservedLoads || hasHydration) && [hasPendingRows, hasObservedLoads, hasHydration].filter(Boolean).length > 1) {
        const totalPending = pendingRows + pendingObserved + pendingHydration;
        textEl.textContent = `Loading timeline content... (${totalPending} items pending)`;
    } else if (hasObservedLoads) {
        textEl.textContent = `Loading ${pendingObserved} resource${pendingObserved === 1 ? '' : 's'}...`;
    } else if (hasHydration) {
        textEl.textContent = `Loading ${pendingHydration} timeline section${pendingHydration === 1 ? '' : 's'}...`;
    } else {
        textEl.textContent = `Loading ${pendingRows} timeline section${pendingRows === 1 ? '' : 's'}...`;
    }

    if (!isVisible) {
        indicatorVisibleSince = Date.now();
    }
    indicator.dataset.visible = '1';
    indicator.style.opacity = '1';
    indicator.style.transform = 'translateY(0)';
}


/**
 * Force-reposition all active LeaderLine instances to match current element positions.
 */
function snapConnectorLines() {
    const startedAt = performance.now();
    forEachMountedRow(positionRowLines);
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (elapsedMs >= DIAG_SLOW_LINE_POSITION_MS) {
        timelineDiag('Slow snapConnectorLines', {
            elapsedMs,
            mountedRows: mountedRowIndexes.size
        });
    }
}

/**
 * Repositions all lines repeatedly over a given duration to synchronize with layout settling.
 */
function pulseSnapConnectorLines(duration = 500) {
    const startTime = Date.now();
    let pulses = 0;
    markTimelinePhase('connector pulse started', { duration });
    const pulse = () => {
        pulses += 1;
        snapConnectorLines();
        if (Date.now() - startTime < duration) {
            requestAnimationFrame(pulse);
        } else {
            markTimelinePhase('connector pulse finished', {
                duration,
                pulses
            });
        }
    };
    requestAnimationFrame(pulse);
}

function renderTurnRow(turn, index, rowState, existingRow = null) {
    const row = existingRow || document.createElement('div');
    row.innerHTML = '';
    row.className = 'turn-row';
    row.style.width = '100%';
    row.style.pointerEvents = '';
    row.setAttribute('data-index', index);
    row.setAttribute('data-turn', turn.turnNumber);
    row.turnData = turn; // Store full turn data for plugin access
    const mountedOrder = mountedRowIndexes.size;
    const localAnimationDelay = Math.min(mountedOrder, 4) * 0.04;

    // Turn Node
    const node = document.createElement('div');
    node.className = 'turn-node';
    node.style.position = 'absolute';
    node.style.left = '50%';
    node.style.transform = 'translateX(-50%)';

    const circle = document.createElement('div');
    circle.className = 'turn-node-circle placeholder';
    if (turn.thumbnail) {
        const imgSrc = turn.thumbnail.startsWith('data:') ? turn.thumbnail : `data:image/jpeg;base64,${turn.thumbnail}`;
        circle.style.backgroundImage = `url("${imgSrc}")`;
        circle.style.backgroundSize = 'cover';
        circle.style.backgroundPosition = 'center';
        circle.classList.remove('placeholder');
        circle.innerHTML = '';
    } else {
        circle.style.background = NODE_GRADIENTS[index % NODE_GRADIENTS.length];
        circle.innerHTML = '<span style="font-size: 32px; opacity: 0.4;">⟡</span>';
    }

    const badge = document.createElement('div');
    badge.className = 'turn-badge';
    badge.textContent = `Turn ${turn.turnNumber}`;

    node.appendChild(circle);
    node.appendChild(badge);
    row.appendChild(node);

    // Left Card — built from plugin-provided sections (leftCard array) or legacy worldState
    const leftCard = createLeftCard(turn.leftCard);
    leftCard.style.animationDelay = `${localAnimationDelay}s`;
    row.appendChild(leftCard);

    // Right Card (Narrative)
    const rightCard = createNarrativeCard(turn.title, turn.abstractTitle, turn.synopsis, turn.rightCard);
    rightCard.style.animationDelay = `${localAnimationDelay + 0.04}s`;
    row.appendChild(rightCard);

    // Branch toggles
    if (turn.leftBranches && turn.leftBranches.length > 0) {
        const toggle = createBranchToggle('left');
        leftCard.appendChild(toggle);
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            handleBranchToggle(rowState, 'left', toggle);
        });
    }

    if (turn.rightBranches && turn.rightBranches.length > 0) {
        const toggle = createBranchToggle('right');
        rightCard.appendChild(toggle);
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            handleBranchToggle(rowState, 'right', toggle);
        });
    }

    return row;
}

// #endregion

// ============================================
// #region CARD BUILDERS
// ============================================

/**
 * Creates the left primary card from an array of plugin sections.
 */
function createLeftCard(sections) {
    const card = document.createElement('div');
    card.className = 'branch-card left';

    // If we have plugin-contributed sections, render them
    if (sections && sections.length > 0) {
        let html = '';
        for (const section of sections) {
            html += `<div class="branch-card-header">
                <div class="branch-card-icon">${section.icon || '◎'}</div>
                <div class="branch-card-title">${section.title || 'Data'}</div>
            </div>`;

            if (section.fields && section.fields.length > 0) {
                for (const field of section.fields) {
                    html += `<div class="card-field">
                        <span class="card-field-label">${field.label}</span>
                        <span class="card-field-value">${field.value}</span>
                    </div>`;
                }
            }

            if (section.html) {
                html += `<div class="card-section-html">${section.html}</div>`;
            }
        }
        card.innerHTML = html;
    } else {
        // Empty — no plugin data.
        card.innerHTML = `
            <div class="branch-card-header">
                <div class="branch-card-icon">◎</div>
                <div class="branch-card-title">World State</div>
            </div>
            <div class="card-field">
                <span class="card-field-value" style="opacity: 0.4; font-style: italic;">No data from plugins</span>
            </div>
        `;
    }

    return card;
}

function createNarrativeCard(title, abstractTitle, synopsis, sections = []) {
    const card = document.createElement('div');
    card.className = 'branch-card right';

    let html = `<div class="narrative-title">${title}</div>`;

    if (abstractTitle) {
        html += `<div class="narrative-subtitle">${abstractTitle}</div>`;
    }

    html += `<div class="narrative-synopsis">${synopsis}</div>`;

    // Append plugin-contributed sections
    if (sections && sections.length > 0) {
        html += `<div class="card-divider"></div>`;
        for (const section of sections) {
            html += `<div class="branch-card-header section-header">
                <div class="branch-card-icon">${section.icon || '◎'}</div>
                <div class="branch-card-title">${section.title || 'Data'}</div>
            </div>`;

            if (section.fields && section.fields.length > 0) {
                for (const field of section.fields) {
                    html += `<div class="card-field">
                        <span class="card-field-label">${field.label}</span>
                        <span class="card-field-value">${field.value}</span>
                    </div>`;
                }
            }

            if (section.html) {
                html += `<div class="card-section-html">${section.html}</div>`;
            }
        }
    }

    card.innerHTML = html;
    return card;
}

function createBranchToggle(side) {
    const btn = document.createElement('button');
    btn.className = `branch-toggle ${side}`;
    const chevron = side === 'left' ? '‹' : '›';
    btn.innerHTML = `<span class="chevron">${chevron}</span>`;
    return btn;
}

// #endregion

// ============================================
// #region BRANCH EXPANSION (Level 2)
// ============================================

function handleBranchToggle(rowState, side, toggleBtn) {
    const isExpanded = rowState[side + 'Expanded'];

    if (isExpanded) {
        collapseBranches(rowState, side, toggleBtn);
    } else {
        expandBranches(rowState, side, toggleBtn);
    }
}

function expandBranches(rowState, side, toggleBtn) {
    if (!rowState?.isMounted) return;
    rowState[side + 'Expanded'] = true;
    toggleBtn.classList.add('expanded');

    const branches = rowState[side + 'Branches'];
    const row = rowState.el;
    const canvasW = canvas.clientWidth || 1200;
    const centerX = canvasW / 2;

    // Calculate card edge X for the branch connector origin
    const cardEdgeX = side === 'left'
        ? centerX - 158 - 340 - 17  // left card right edge minus toggle
        : centerX + 158 + 510 + 17; // right card left edge plus toggle

    // Calculate where branch items will be placed
    const branchX = side === 'left'
        ? cardEdgeX - BRANCH_OFFSET_X - 240 // item width
        : cardEdgeX + BRANCH_OFFSET_X;

    // We need to relayout first to get correct row height
    relayoutTimeline();
    const rowH = rowState.currentHeight;
    const totalBranchH = branches.length * BRANCH_ITEM_HEIGHT + (branches.length - 1) * BRANCH_ITEM_GAP;
    const startY = (rowH - totalBranchH) / 2;

    // Create branch items
    branches.forEach((branch, i) => {
        const item = document.createElement('div');
        item.className = 'branch-item';
        item.style.left = `${branchX}px`;
        item.style.top = `${startY + i * (BRANCH_ITEM_HEIGHT + BRANCH_ITEM_GAP)}px`;

        item.innerHTML = `
            <div class="branch-item-label">
                <span class="branch-item-icon">${branch.icon}</span>
                ${branch.label}
            </div>
            <div class="branch-item-content">${branch.content}</div>
        `;

        // If has children, add L3 toggle
        if (branch.children && branch.children.length > 0) {
            const l3Toggle = document.createElement('button');
            l3Toggle.className = `branch-item-toggle ${side}`;
            l3Toggle.innerHTML = side === 'left' ? '‹' : '›';
            item.appendChild(l3Toggle);

            l3Toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                handleL3Toggle(rowState, side, i, l3Toggle);
            });
        }

        row.appendChild(item);
        rowState.branchElements[side].push(item);

        // Staggered reveal
        setTimeout(() => {
            if (!rowState.isMounted || !rowState.shouldBeVisible || !item.isConnected) return;
            item.classList.add('visible');
        }, i * 80);

        setTimeout(() => {
            if (!rowState.isMounted || !rowState.shouldBeVisible || !item.isConnected) return;
            const card = rowState.el.querySelector(`.branch-card.${side}`);
            if (card) {
                const line = new LeaderLine(card, item, {
                    color: 'rgba(255, 204, 0, 0.4)',
                    size: 6,
                    path: 'straight',
                    startPlug: 'behind',
                    endPlug: 'behind'
                });
                rowState.branchActiveLines[side].push(line);

                let ticks = 0;
                const trackAnim = setInterval(() => {
                    try { line.position(); } catch { clearInterval(trackAnim); }
                    if (++ticks > 25) clearInterval(trackAnim);
                }, 16);
            }
        }, i * 80);
    });

    // Relayout after expansion
    relayoutTimeline();
}

function collapseBranches(rowState, side, toggleBtn) {
    // First collapse any open L3
    const branches = rowState[side + 'Branches'];
    for (let i = 0; i < branches.length; i++) {
        if (rowState[side + 'L3Expanded'][i]) {
            collapseL3(rowState, side, i);
        }
    }

    rowState[side + 'Expanded'] = false;
    toggleBtn.classList.remove('expanded');

    const lines = [...rowState.branchActiveLines[side]];
    rowState.branchActiveLines[side] = [];
    lines.forEach(l => l.remove());

    const items = rowState.branchElements[side];
    items.forEach(item => item.classList.remove('visible'));

    setTimeout(() => {
        if (!rowState.isMounted) return;
        items.forEach(item => item.remove());
        rowState.branchElements[side] = [];
        relayoutTimeline();
    }, 500);
}

// #endregion

// ============================================
// #region BRANCH EXPANSION (Level 3 - Leaves)
// ============================================

function handleL3Toggle(rowState, side, branchIndex, toggleBtn) {
    const isExpanded = rowState[side + 'L3Expanded'][branchIndex];

    if (isExpanded) {
        collapseL3(rowState, side, branchIndex);
    } else {
        expandL3(rowState, side, branchIndex, toggleBtn);
    }
}

function expandL3(rowState, side, branchIndex) {
    if (!rowState?.isMounted) return;
    rowState[side + 'L3Expanded'][branchIndex] = true;

    const branch = rowState[side + 'Branches'][branchIndex];
    if (!branch.children || branch.children.length === 0) return;

    const row = rowState.el;
    const parentItem = rowState.branchElements[side][branchIndex];
    if (!parentItem) return;

    // Get parent item position
    const parentLeft = parseFloat(parentItem.style.left);
    const parentTop = parseFloat(parentItem.style.top);

    const children = branch.children;

    // Always use grid mode
    const totalLeafH = GRID_MAX_HEIGHT;
    const leafStartY = parentTop + BRANCH_ITEM_HEIGHT / 2 - totalLeafH / 2;

    if (!rowState.leafElements[side][branchIndex]) rowState.leafElements[side][branchIndex] = [];
    if (!rowState.leafActiveLines[side][branchIndex]) rowState.leafActiveLines[side][branchIndex] = [];

    {
        // Calculate grid container X
        const gridX = side === 'left' ? parentLeft - LEAF_OFFSET_X - GRID_WIDTH : parentLeft + 240 + LEAF_OFFSET_X;

        const gridEl = document.createElement('div');
        gridEl.className = 'branch-leaf-grid';
        gridEl.style.left = `${gridX}px`;
        gridEl.style.top = `${leafStartY}px`;

        let innerHTML = '';
        children.forEach((child) => {
            innerHTML += `
                <div class="grid-item">
                    <div class="branch-leaf-title">${child.title}</div>
                    <div>${child.text}</div>
                </div>
            `;
        });
        gridEl.innerHTML = innerHTML;

        row.appendChild(gridEl);
        rowState.leafElements[side][branchIndex].push(gridEl);

        // If branch has consolidated summaries, add an L4 toggle button
        if (branch.summaries && branch.summaries.length > 0) {
            const l4Toggle = document.createElement('button');
            l4Toggle.className = `branch-leaf-toggle ${side}`;
            l4Toggle.innerHTML = side === 'left' ? '‹' : '›';
            l4Toggle.title = `${branch.summaries.length} narrative ledger(s)`;

            // Position on row, pinned to grid edge
            const toggleX = side === 'left' ? gridX - 12 : gridX + GRID_WIDTH - 12;
            const toggleY = leafStartY + totalLeafH / 2;
            l4Toggle.style.left = `${toggleX}px`;
            l4Toggle.style.top = `${toggleY}px`;

            row.appendChild(l4Toggle);

            // Track toggle for cleanup when L3 collapses
            rowState.leafElements[side][branchIndex].push(l4Toggle);

            l4Toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                handleL4Toggle(rowState, side, branchIndex, 0, l4Toggle);
            });
        }

        setTimeout(() => {
            if (!rowState.isMounted || !rowState.shouldBeVisible || !gridEl.isConnected) return;
            gridEl.classList.add('visible');
        }, 60);

        setTimeout(() => {
            if (!rowState.isMounted || !rowState.shouldBeVisible || !gridEl.isConnected || !parentItem.isConnected) return;
            const myLine = new LeaderLine(parentItem, gridEl, {
                color: 'rgba(255, 204, 0, 0.4)',
                size: 6,
                path: 'fluid',
                startPlug: 'behind',
                endPlug: 'behind'
            });
            if (!rowState.leafActiveLines[side][branchIndex]) rowState.leafActiveLines[side][branchIndex] = [];
            rowState.leafActiveLines[side][branchIndex].push(myLine);

            // Track element bounds during CSS transitions (approx 400ms)
            let ticks = 0;
            const trackAnim = setInterval(() => {
                try { myLine.position(); } catch { clearInterval(trackAnim); }
                if (++ticks > 25) clearInterval(trackAnim);
            }, 16);
        }, 60);
    }

    relayoutTimeline();
}

function collapseL3(rowState, side, branchIndex) {
    // First collapse any L4
    const leaves = rowState.leafElements[side][branchIndex] || [];
    leaves.forEach((_, i) => {
        const key = `${branchIndex}-${i}`;
        if (rowState[side + 'L4Expanded'][key]) {
            collapseL4(rowState, side, branchIndex, i);
        }
    });

    rowState[side + 'L3Expanded'][branchIndex] = false;

    // const leaves = rowState.leafElements[side][branchIndex] || [];
    leaves.forEach(leaf => leaf.classList.remove('visible'));

    // Collapse lines
    const leafLinesArr = [...(rowState.leafActiveLines[side][branchIndex] || [])];
    rowState.leafActiveLines[side][branchIndex] = [];
    leafLinesArr.forEach(line => line.remove());

    leaves.forEach(leaf => leaf.classList.remove('visible'));

    setTimeout(() => {
        if (!rowState.isMounted) return;
        leaves.forEach(leaf => leaf.remove());
        rowState.leafElements[side][branchIndex] = [];
        relayoutTimeline();
    }, 500);
}

function collapseL4(rowState, side, branchIndex, leafIndex) {
    const key = `${branchIndex}-${leafIndex}`;
    rowState[side + 'L4Expanded'][key] = false;

    const subleaves = rowState.subleafElements[side][key] || [];
    subleaves.forEach(sl => sl.classList.remove('visible'));

    const subleafLinesArr = [...(rowState.subleafActiveLines[side][key] || [])];
    rowState.subleafActiveLines[side][key] = [];
    subleafLinesArr.forEach(line => line.remove());

    setTimeout(() => {
        if (!rowState.isMounted) return;
        subleaves.forEach(sl => sl.remove());
        rowState.subleafElements[side][key] = [];
        relayoutTimeline();
    }, 500);
}

function handleL4Toggle(rowState, side, branchIndex, leafIndex, toggleBtn) {
    const key = `${branchIndex}-${leafIndex}`;
    const isExpanded = rowState[side + 'L4Expanded'][key];

    if (isExpanded) {
        collapseL4(rowState, side, branchIndex, leafIndex);
        toggleBtn.classList.remove('expanded');
    } else {
        expandL4(rowState, side, branchIndex, leafIndex, toggleBtn);
        toggleBtn.classList.add('expanded');
    }
}

function expandL4(rowState, side, branchIndex, leafIndex, toggleBtn) {
    if (!rowState?.isMounted) return;
    const key = `${branchIndex}-${leafIndex}`;
    rowState[side + 'L4Expanded'][key] = true;

    const branch = rowState[side + 'Branches'][branchIndex];
    if (!branch.summaries || branch.summaries.length === 0) return;

    const row = rowState.el;
    // The parent is the grid element (first leaf element for this branch)
    const parentGrid = rowState.leafElements[side][branchIndex][0];
    if (!parentGrid) return;

    const parentLeft = parseFloat(parentGrid.style.left);
    const parentTop = parseFloat(parentGrid.style.top);

    if (!rowState.subleafElements[side][key]) rowState.subleafElements[side][key] = [];
    if (!rowState.subleafActiveLines[side][key]) rowState.subleafActiveLines[side][key] = [];

    // Position the summary grid further out from the relationship grid
    const summaryGridX = side === 'left' ? parentLeft - GRID_WIDTH - 150 : parentLeft + GRID_WIDTH + 150;
    const summaryGridY = parentTop;

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'branch-leaf-grid branch-summary-grid';
    summaryGrid.style.left = `${summaryGridX}px`;
    summaryGrid.style.top = `${summaryGridY}px`;

    let innerHTML = '';
    branch.summaries.forEach((summary) => {
        innerHTML += `
            <div class="grid-item summary-item">
                <div class="branch-leaf-title">${summary.title}</div>
                <div class="branch-subleaf-text">${summary.text}</div>
            </div>
        `;
    });
    summaryGrid.innerHTML = innerHTML;

    row.appendChild(summaryGrid);
    rowState.subleafElements[side][key].push(summaryGrid);

    setTimeout(() => {
        if (!rowState.isMounted || !rowState.shouldBeVisible || !summaryGrid.isConnected) return;
        summaryGrid.classList.add('visible');
    }, 60);

    setTimeout(() => {
        if (!rowState.isMounted || !rowState.shouldBeVisible || !summaryGrid.isConnected || !toggleBtn.isConnected) return;
        const myLine = new LeaderLine(toggleBtn, summaryGrid, {
            color: 'rgba(255, 204, 0, 0.4)',
            size: 4,
            path: 'fluid',
            startPlug: 'behind',
            endPlug: 'behind'
        });
        if (!rowState.subleafActiveLines[side][key]) rowState.subleafActiveLines[side][key] = [];
        rowState.subleafActiveLines[side][key].push(myLine);

        // Track element bounds during CSS transitions (approx 400ms)
        let ticks = 0;
        const trackAnim = setInterval(() => {
            try { myLine.position(); } catch { clearInterval(trackAnim); }
            if (++ticks > 25) clearInterval(trackAnim);
        }, 16);
    }, 60);

    relayoutTimeline();
}

// #endregion

// #region VIRTUALIZATION ENGINE
// ============================================

let virtualizationObserver = null;

function setupVirtualization() {
    if (virtualizationObserver) {
        virtualizationObserver.disconnect();
    }

    const options = {
        root: viewport,
        rootMargin: '400px 0px', // Buffer zone above/below
        threshold: 0.01
    };

    virtualizationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = parseInt(entry.target.getAttribute('data-index'));
            const rowState = turnRowState[index];
            if (!rowState) return;

            if (entry.isIntersecting) {
                showRow(rowState);
            } else {
                hideRow(rowState);
            }
        });
    }, options);

    // Observe all rows
    turnRowState.forEach(row => {
        virtualizationObserver.observe(row.el);
    });
}

function hideRow(rowState) {
    if (!rowState) return;
    rowState.shouldBeVisible = false;
    rowState.isVisible = false;
    scheduleViewportHydration();

    if (!rowState.isMounted && !rowState.isMounting) {
        if (rowState.unmountTimer) {
            clearTimeout(rowState.unmountTimer);
            rowState.unmountTimer = null;
        }
        updateResourceLoadingIndicator();
        return;
    }

    rowState.el.classList.add('is-offscreen');

    if (rowState.unmountTimer) {
        clearTimeout(rowState.unmountTimer);
    }
    rowState.unmountTimer = setTimeout(() => {
        rowState.unmountTimer = null;
        if (!rowState.shouldBeVisible) {
            unmountRow(rowState);
        }
    }, ROW_UNMOUNT_DELAY_MS);

    updateResourceLoadingIndicator();
}

function showRow(rowState) {
    if (!rowState) return;
    rowState.trueVisible = true; // Track real visibility for plugins
    rowState.shouldBeVisible = true;
    rowState.isVisible = true;
    scheduleViewportHydration();

    if (rowState.unmountTimer) {
        clearTimeout(rowState.unmountTimer);
        rowState.unmountTimer = null;
    }

    if (rowState.isMounted) {
        rowState.el.classList.remove('is-offscreen');
        positionRowLines(rowState);
    } else if (rowState.isMounting) {
        updateResourceLoadingIndicator();
    } else {
        queueRowMount(rowState);
    }
}

// #endregion

// ============================================
// #region INITIALIZATION & EVENTS
// ============================================

/**
 * Simple interval-based loading overlay controller.
 * Polls the DOM every 300ms to check if the timeline has been fully rendered.
 * The overlay stays visible until real content is detected — immune to socket race conditions.
 */
let loadingCheckInterval = null;
let loadingCheckTimeout = null;
let emptyStateTimeout = null;

function startLoadingWatch() {
    // Clear any existing watchers AND any pending empty-state timeouts
    stopLoadingWatch();
    if (emptyStateTimeout) {
        clearTimeout(emptyStateTimeout);
        emptyStateTimeout = null;
    }

    activeTimelineLoad = {
        id: ++timelineLoadSeq,
        startedAt: performance.now()
    };

    console.log('[Timeline] Loading watch started. Overlay visible.');
    markTimelinePhase('loading watch started');
    showLoadingOverlay();

    // Poll the DOM: check if the canvas has rendered turn rows with actual card content
    loadingCheckInterval = setInterval(() => {
        const rows = canvas.querySelectorAll('.turn-row');
        if (rows.length > 0) {
            // Check if at least one row has real content (a card-field from a plugin)
            const hasContent = canvas.querySelector('.card-field') || canvas.querySelector('.branch-card-header');
            if (hasContent) {
                console.log(`[Timeline] Detected ${rows.length} rendered rows with content. Hiding overlay.`);
                markTimelinePhase('loading watch detected content', {
                    domRows: rows.length,
                    hasContent: true
                });
                stopLoadingWatch();
                // Small delay to let the final layout settle before reveal
                setTimeout(() => {
                    markTimelinePhase('overlay hide delay elapsed');
                    hideLoadingOverlay();
                    pulseSnapConnectorLines(500);
                }, 400);
            }
        } else if (activeTimelineLoad && Math.round(performance.now() - activeTimelineLoad.startedAt) % 3000 < 350) {
            markTimelinePhase('loading watch still waiting', { domRows: rows.length });
        }
    }, 300);

    // Safety timeout: force-reveal after 30s no matter what
    loadingCheckTimeout = setTimeout(() => {
        console.warn('[Timeline] Safety timeout reached (30s). Forcing reveal.');
        markTimelinePhase('loading watch safety timeout');
        stopLoadingWatch();
        hideLoadingOverlay();
    }, 30000);
}

function stopLoadingWatch() {
    if (loadingCheckInterval) {
        clearInterval(loadingCheckInterval);
        loadingCheckInterval = null;
    }
    if (loadingCheckTimeout) {
        clearTimeout(loadingCheckTimeout);
        loadingCheckTimeout = null;
    }
}

// --- Initialization ---

function initTimeline() {
    if (initTimeline.executed) return;
    initTimeline.executed = true;

    console.log('[Timeline] Initializing.');
    startFrameGapMonitor();
    startLongTaskObserver();
    installResourceObserver();
    startLoadingWatch();
    socket.emit('get-timeline-data');
}

// Ensure initialization runs even if DOMContentLoaded already fired
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimeline);
} else {
    initTimeline();
}

// --- Socket Events ---

socket.on('timeline-data', (payload) => {
    const turnCount = payload?.turns?.length || 0;
    console.log(`[Timeline] Received data: ${turnCount} turns.`);

    if (payload && payload.turns && payload.turns.length > 0) {
        renderTimeline(payload.turns);
        // The interval will detect when the DOM is populated and hide the overlay
    } else {
        // Truly empty timeline — show empty state after a brief wait
        // (only if no more data arrives within 3s AND the loading watch isn't active)
        if (emptyStateTimeout) clearTimeout(emptyStateTimeout);
        emptyStateTimeout = setTimeout(() => {
            emptyStateTimeout = null;
            // Only act if the interval isn't running (i.e., no new request was started)
            if (!loadingCheckInterval) return;
            // Re-check: if still no rows, it's genuinely empty
            if (canvas.querySelectorAll('.turn-row').length === 0) {
                console.log('[Timeline] No data after wait. Showing empty state.');
                stopLoadingWatch();
                hideLoadingOverlay();
            }
        }, 3000);
    }
});

socket.on('timeline-range-data', (payload) => {
    const requestId = payload?.requestId || null;
    const trackedRequest = requestId ? hydrationRequests.get(requestId) : null;
    const roundTripMs = trackedRequest?.requestedAt
        ? Math.round(performance.now() - trackedRequest.requestedAt)
        : null;

    if (trackedRequest) {
        clearTimeout(trackedRequest.timer);
        hydrationRequests.delete(requestId);
    }

    const startIndex = Number.isInteger(Number(payload?.startIndex))
        ? Number(payload.startIndex)
        : (trackedRequest?.startIndex || 0);
    const endIndex = Number.isInteger(Number(payload?.endIndex))
        ? Number(payload.endIndex)
        : (trackedRequest?.endIndex || startIndex);

    if (payload?.error) {
        console.warn(`[Timeline] Failed to hydrate rows ${startIndex}-${endIndex}: ${payload.error}`);
        clearHydratingFlags(startIndex, endIndex);
        updateResourceLoadingIndicator();
        return;
    }

    const turns = Array.isArray(payload?.turns) ? payload.turns : [];
    console.log(`[Timeline] Received hydrated range ${startIndex}-${endIndex} (${turns.length} turns).`);
    timelineDiag('Hydration response received', {
        requestId,
        startIndex,
        endIndex,
        turns: turns.length,
        roundTripMs,
        backendTotalMs: payload?.diagnostics?.backendTotalMs,
        cacheHits: payload?.diagnostics?.cacheHits,
        cacheMisses: payload?.diagnostics?.cacheMisses,
        slowProviderCount: payload?.diagnostics?.slowProviderCount,
        slowRowCount: payload?.diagnostics?.slowRowCount
    });

    const mergeStartedAt = performance.now();
    turns.forEach((turn, offset) => {
        mergeHydratedTurnData(turn, startIndex + offset);
    });
    const mergeTotalMs = Math.round(performance.now() - mergeStartedAt);
    timelineDiag('Hydration range merged', {
        requestId,
        rows: turns.length,
        mergeTotalMs
    });
    schedulePostMergeProbes('Post-hydration merge', mergeStartedAt, {
        requestId,
        rows: turns.length,
        mergeTotalMs
    });
    clearHydratingFlags(startIndex, endIndex);
    updateResourceLoadingIndicator();
});

socket.on('chat-db-switched', (data) => {
    console.log('[Timeline] Chat DB switched.', data?.path);
    clearTimeline();
    startLoadingWatch();
    socket.emit('get-timeline-data');
});

// #endregion


