// renderer_kg.js (ES module) — Final fixes:
//  - robust camera fit (median + trimmed extent)
//  - neighbor labels set to white; hovered node label black
//  - node size computed from degree (connections)

import Sigma from 'https://cdn.skypack.dev/sigma';
import Graph from 'https://cdn.skypack.dev/graphology';
import * as FA2pkg from 'https://esm.sh/graphology-layout-forceatlas2@0.8.1';

// socket.io is loaded from HTML global <script>
const socket = io("http://localhost:14541");

// DOM refs
const container = document.getElementById('container');
const tooltip = document.getElementById('kg-tooltip');

console.log('Renderer initializing (finalized build)...');

// Normalize ForceAtlas2 import shape
const forceAtlas2 = (function normalize(pkg) {
  if (!pkg) return null;
  if (typeof pkg.inferSettings === 'function' && typeof pkg.assign === 'function') return pkg;
  if (pkg.default && typeof pkg.default.inferSettings === 'function' && typeof pkg.default.assign === 'function') return pkg.default;
  const maybe = {
    inferSettings: pkg.inferSettings || (pkg.default && pkg.default.inferSettings),
    assign: pkg.assign || (pkg.default && pkg.default.assign)
  };
  if (typeof maybe.inferSettings === 'function' && typeof maybe.assign === 'function') return maybe;
  return null;
})(FA2pkg);

if (!forceAtlas2) console.warn('ForceAtlas2 import shape unexpected — layout may be skipped.');

// Globals
let renderer = null;
let graph = null;
let currentHoveredNodeId = null;

// caches for restoring visuals
const originalNodeAttrs = new Map();
const originalEdgeAttrs = new Map();
function cacheNodeOriginals(nodeId) { if (!originalNodeAttrs.has(nodeId)) originalNodeAttrs.set(nodeId, { ...graph.getNodeAttributes(nodeId) }); }
function cacheEdgeOriginals(edgeKey) { if (!originalEdgeAttrs.has(edgeKey)) originalEdgeAttrs.set(edgeKey, { ...graph.getEdgeAttributes(edgeKey) }); }
function restoreAllOriginals() {
  originalNodeAttrs.forEach((attrs, id) => { try { Object.entries(attrs).forEach(([k, v]) => graph.setNodeAttribute(id, k, v)); } catch {} });
  originalEdgeAttrs.forEach((attrs, k) => { try { Object.entries(attrs).forEach(([kk, vv]) => graph.setEdgeAttribute(k, kk, vv)); } catch {} });
  originalNodeAttrs.clear(); originalEdgeAttrs.clear();
}

// visual setters
function setNodeVisual(nodeId, attrs) {
  cacheNodeOriginals(nodeId);
  Object.entries(attrs).forEach(([k, v]) => graph.setNodeAttribute(nodeId, k, v));
}
function setEdgeVisual(edgeKey, attrs) {
  cacheEdgeOriginals(edgeKey);
  Object.entries(attrs).forEach(([k, v]) => graph.setEdgeAttribute(edgeKey, k, v));
}

/** Build relation lines like "A → REL → B" (used in tooltip)
 */
function buildRelationLinesFor(nodeId, max = 12) {
  if (!graph || !graph.hasNode(nodeId)) return [];
  const lines = [];
  graph.forEachEdge((edge, attr, source, target) => {
    if (source === nodeId || target === nodeId) {
      const pred = (attr && attr.label) ? String(attr.label) : '(rel)';
      lines.push(`${source} → ${pred} → ${target}`);
    }
  });
  return lines.slice(0, max);
}

/** Highlight neighborhood: hovered node white/black label, neighbors orange and WHITE label,
 *  incident edges orange and their labels made high-contrast.
 */
function highlightNeighborhood(nodeId) {
  if (!graph || !graph.hasNode(nodeId)) return;
  const neighbors = new Set(graph.neighbors(nodeId) || []);
  neighbors.add(nodeId);

  // 1) dim all nodes & edges (cache originals)
  graph.forEachNode((n) => {
    cacheNodeOriginals(n);
    if (!neighbors.has(n)) {
      graph.setNodeAttribute(n, 'color', '#1a1d20'); // dim
      graph.setNodeAttribute(n, 'size', Math.max(3, (graph.getNodeAttribute(n, 'size') || 6) * 0.75));
      graph.setNodeAttribute(n, 'labelColor', '#9aa6b2'); // muted label
    }
  });

  graph.forEachEdge((edge, attr) => {
    cacheEdgeOriginals(edge);
    // dim all edges for now; we'll highlight incident ones below
    setEdgeVisual(edge, { color: '#2a2e33', size: Math.max(0.6, (attr.size || 1) * 0.8), labelColor: (attr.labelColor || '#4b5560') });
  });

  // 2) hovered node: white fill + BLACK label
  setNodeVisual(nodeId, { color: '#ffffff', size: (graph.getNodeAttribute(nodeId, 'size') || 8) * 1.4, labelColor: '#000000' });

  // 3) neighbors: orange fill and WHITE label so they remain legible on dark background
  neighbors.forEach((nid) => {
    if (nid === nodeId) return;
    setNodeVisual(nid, {
      color: '#ff9a33',
      size: (graph.getNodeAttribute(nid, 'size') || 6) * 1.15,
      labelColor: '#ffffff'   // <<-- important: white text for neighbor nodes
    });
  });

  // 4) incident edges: orange + white label
  graph.forEachEdge((edge, attr, src, tgt) => {
    if (src === nodeId || tgt === nodeId) {
      setEdgeVisual(edge, { color: '#ff9a33', size: (attr.size || 1) * 1.6, labelColor: '#ffffff', hidden: false });
    }
  });
}

function clearHighlight() {
  currentHoveredNodeId = null;
  restoreAllOriginals();
}

// Tooltip: shows relations, limited to avoid huge lists
function showTooltipFor(nodeId, clientX, clientY) {
  if (!graph || !graph.hasNode(nodeId) || !tooltip) return;
  const attrs = graph.getNodeAttributes(nodeId);
  const relations = buildRelationLinesFor(nodeId, 12);
  const relHtml = relations.length ? `<div style="margin-top:6px;font-size:12px;color:#222;">${relations.map(r => `<div>${escapeHtml(r)}</div>`).join('')}</div>` : '';
  tooltip.innerHTML = `<div class="title">${escapeHtml(String(attrs.label || nodeId))}</div>
                       <div class="meta">id: ${escapeHtml(String(nodeId))}</div>
                       ${relHtml}`;
  tooltip.style.display = 'block';
  tooltip.setAttribute('aria-hidden', 'false');

  // position
  const pad = 12;
  const rect = tooltip.getBoundingClientRect();
  let left = clientX + 12;
  let top = clientY + 12;
  if (left + rect.width + pad > window.innerWidth) left = clientX - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = clientY - rect.height - 14;
  tooltip.style.left = `${Math.max(6, left)}px`;
  tooltip.style.top = `${Math.max(6, top)}px`;
}
function hideTooltip() { if (!tooltip) return; tooltip.style.display = 'none'; tooltip.setAttribute('aria-hidden', 'true'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"'`=\/]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;','=':'&#61;' }[c]));
}

// --- socket logic (request on connect) ---
socket.on('connect', () => {
  console.log('Connected to backend (socket id=' + socket.id + ') — requesting knowledge graph.');
  socket.emit('get-all-knowledge-graph');
});
if (socket && socket.connected) {
  socket.emit('get-all-knowledge-graph');
}

// --- main handler: build graph, compute degree-based sizes, layout, render ---
socket.on('get-all-knowledge-graph-response', (data) => {
  try {
    const triples = data.triples || [];
    if (triples.length === 0) { console.log('No triples'); return; }
    console.log(`Received ${triples.length} triples. Building graph...`);

    graph = new Graph({ multi: true });

    // 1) Add nodes/edges with base attributes (labelColor white so static labels show)
    triples.forEach((t, idx) => {
      const s = t.subject, o = t.object;
      if (!s || !o) return;

      if (!graph.hasNode(s)) {
        graph.addNode(s, {
          label: s,
          // size: we'll set from degree below
          color: '#6aa6c8',
          labelColor: '#ffffff',
          x: (Math.random() - 0.5) * 400,
          y: (Math.random() - 0.5) * 400
        });
      }
      if (!graph.hasNode(o)) {
        graph.addNode(o, {
          label: o,
          color: '#6aa6c8',
          labelColor: '#ffffff',
          x: (Math.random() - 0.5) * 400,
          y: (Math.random() - 0.5) * 400
        });
      }

      const key = `e${idx}_${s}->${o}`;
      const label = (t.predicate || '').toString();
      try {
        graph.addEdgeWithKey(key, s, o, {
          label,
          size: 1,
          color: '#2f3338',
          labelColor: '#9aa6b2',
          type: 'arrow'
        });
      } catch {
        try { graph.addEdge(s, o); } catch {}
      }
    });

    // 2) compute degrees & set node sizes based on degree
    // size function: base + scale * sqrt(degree)
    const baseSize = 4;
    const scale = 4; // tweak this multiplier to taste
    graph.forEachNode((n) => {
      let deg = 0;
      // try graph.degree(n) if available; otherwise use neighbors count
      if (typeof graph.degree === 'function') {
        try { deg = graph.degree(n); } catch { deg = (graph.neighbors(n) || []).length; }
      } else {
        deg = (graph.neighbors(n) || []).length;
      }
      const size = Math.max(3, baseSize + scale * Math.sqrt(deg));
      graph.setNodeAttribute(n, 'size', size);
    });

    // 3) Ensure x/y exist for all nodes
    graph.forEachNode((n) => {
      const a = graph.getNodeAttributes(n);
      if (typeof a.x !== 'number' || typeof a.y !== 'number') {
        graph.setNodeAttribute(n, 'x', (Math.random() - 0.5) * 400);
        graph.setNodeAttribute(n, 'y', (Math.random() - 0.5) * 400);
      }
    });

    // 4) ForceAtlas2 layout if available
    if (forceAtlas2) {
      let inferred = {};
      try { if (typeof forceAtlas2.inferSettings === 'function') inferred = forceAtlas2.inferSettings(graph); } catch (err) { console.warn('inferSettings failed', err); }
      const settings = { ...(inferred || {}), scalingRatio: (inferred && inferred.scalingRatio) ? inferred.scalingRatio : 2 };
      try {
        forceAtlas2.assign(graph, { iterations: 120, settings });
        console.log('ForceAtlas2 complete.');
      } catch (err) {
        console.warn('ForceAtlas2.assign failed', err);
      }
    } else {
      console.log('Skipping ForceAtlas2 (not available).');
    }

    // 5) Create renderer or swap graph
    if (!renderer) {
      renderer = new Sigma(graph, container, {
        renderLabels: true,
        renderEdgeLabels: true,
        labelColor: { attribute: 'labelColor', color: '#ffffff' },        // use per-node labelColor
        edgeLabelColor: { attribute: 'labelColor', color: '#9aa6b2' },    // per-edge labelColor
        labelSize: 12,
        edgeLabelSize: 11,
        defaultNodeType: 'circle',
        defaultEdgeType: 'arrow',
        zIndex: true
      });

      // events
      renderer.on('enterNode', ({ node, event }) => {
        try {
          currentHoveredNodeId = node;
          highlightNeighborhood(node);
          const ev = event && (event.clientX ? event : (event.srcEvent || event));
          const clientX = ev && (ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX)) || 12;
          const clientY = ev && (ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY)) || 12;
          showTooltipFor(node, clientX, clientY);
        } catch (e) { console.warn('enterNode handler failed', e); }
      });

      renderer.on('leaveNode', () => { try { clearHighlight(); hideTooltip(); } catch {} });

      renderer.getMouseCaptor().on('mousemovebody', (e) => {
        try {
          if (!currentHoveredNodeId) return;
          const ev = e && (e.clientX ? e : (e.srcEvent || e));
          const clientX = ev && (ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX)) || 12;
          const clientY = ev && (ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY)) || 12;
          showTooltipFor(currentHoveredNodeId, clientX, clientY);
        } catch {}
      });
    } else {
      renderer.setGraph(graph);
    }

    // 6) Fit camera to graph: use robust center (median) + trimmed extents to avoid outliers
    try {
      fitCameraToGraph(graph, renderer, container);
    } catch {
      // fallback simple center
      //try { renderer.getCamera().animate({ x: 0, y: 0, ratio: 1 }, { duration: 800 }); } catch (_) {}
    }

    console.log('Rendering complete (final).');
  } catch (err) {
    console.error('Error in get-all-knowledge-graph-response handler:', err);
  }
});

/** Fit camera robustly:
 *  - compute median center (resistant to outliers)
 *  - compute trimmed extents (10th-90th percentile) to get the main cloud size
 *  - set ratio = max(extentX / (w*0.75), extentY / (h*0.75)) and clamp it
 */
function fitCameraToGraph(g, rendererInstance, containerEl) {
  if (!g || !rendererInstance) return;

  const xs = [];
  const ys = [];
  g.forEachNode((n) => {
    const a = g.getNodeAttributes(n);
    if (typeof a.x === 'number' && typeof a.y === 'number') {
      xs.push(a.x);
      ys.push(a.y);
    }
  });
  if (xs.length === 0) return;

  xs.sort((a,b)=>a-b);
  ys.sort((a,b)=>a-b);

  // median for center
  const median = (arr) => {
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 === 1 ? arr[m] : (arr[m-1] + arr[m]) / 2;
  };
  const centerX = median(xs);
  const centerY = median(ys);

  // trimmed extents (10th - 90th percentile) to avoid outliers
  const p10 = (arr) => arr[Math.floor(arr.length * 0.10)];
  const p90 = (arr) => arr[Math.floor(arr.length * 0.90)];
  const minX = p10(xs), maxX = p90(xs);
  const minY = p10(ys), maxY = p90(ys);

  // if trimmed box empty fallback to overall min/max
  const bboxWidth = Math.max(1, (isFinite(maxX) && isFinite(minX)) ? (maxX - minX) : (xs[xs.length-1] - xs[0]));
  const bboxHeight = Math.max(1, (isFinite(maxY) && isFinite(minY)) ? (maxY - minY) : (ys[ys.length-1] - ys[0]));

  const w = containerEl.clientWidth || 800;
  const h = containerEl.clientHeight || 600;

  // The layout's "ratio" is worldUnitsPerPixel style — to fit the bounding box nicely:
  // ratio = max(bboxWidth / (w * margin), bboxHeight / (h * margin))
  const margin = 0.75; // smaller margin -> a bit more zoomed out; tweak to taste
  let ratio = Math.max(bboxWidth / (w * margin), bboxHeight / (h * margin));

  // clamp ratio to reasonable values to prevent extreme zooms
  const minRatio = 0.0005;  // zoomed in
  const maxRatio = 3.0;     // zoomed out (adjust if your graph uses huge coordinate scales)
  ratio = Math.min(Math.max(ratio, minRatio), maxRatio);

  // animate camera
  try {
    rendererInstance.getCamera().animate({ x: centerX, y: centerY, ratio }, { duration: 800 });
  } catch {
    // camera animate not available? fallback to set
    try { rendererInstance.getCamera().set({ x: centerX, y: centerY, ratio }); } catch {}
  }
}
