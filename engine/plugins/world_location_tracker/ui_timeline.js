(function () {
    // Track mini-maps for the timeline
    const timelineMaps = new Map(); // turnNumber -> Map Instance
    let leafletLoadPromise = null;
    const diag = (message, data = null) => {
        if (data) console.log(`[Plugin:world_location_tracker][TimelineDiag] ${message}`, data);
        else console.log(`[Plugin:world_location_tracker][TimelineDiag] ${message}`);
    };

    const loadLeaflet = (callback) => {
        if (window.L) { callback(); return; }
        if (!leafletLoadPromise) {
            const loadStartedAt = performance.now();
            diag('Leaflet load requested');
            leafletLoadPromise = new Promise((resolve, reject) => {
                if (!document.querySelector('link[href*="leaflet.css"]')) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = context.resolvePluginPath('world_location_tracker', 'lib/leaflet.css');
                    document.head.appendChild(link);
                }

                const existingScript = document.querySelector('script[src*="world_location_tracker/lib/leaflet.js"]');
                if (existingScript) {
                    existingScript.addEventListener('load', resolve, { once: true });
                    existingScript.addEventListener('error', reject, { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.src = context.resolvePluginPath('world_location_tracker', 'lib/leaflet.js');
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            }).then((value) => {
                diag('Leaflet loaded', { elapsedMs: Math.round(performance.now() - loadStartedAt) });
                return value;
            });
        }

        leafletLoadPromise
            .then(() => callback())
            .catch((error) => console.error('[Plugin:world_location_tracker] Failed to load Leaflet:', error));
    };

    // --- REUSABLE MAP INIT ---
    const setupMapInstance = (containerEl, bundle, options = {}) => {
        const setupStartedAt = performance.now();
        if (!containerEl || !bundle) return null;

        // If no map image or tiles, show a placeholder instead of failing silently
        if (!bundle.mapImage && !bundle.tileUrl) {
            containerEl.innerHTML = `
                <div class="minimap-placeholder">
                    <div class="placeholder-icon">📍</div>
                    <div class="placeholder-text">Map asset not found for this turn.</div>
                    <div class="placeholder-subtext">Ensure a .imageworld file is present in your project.</div>
                </div>
            `;
            return null;
        }

        const w = bundle.dimensions?.width || 0;
        const h = bundle.dimensions?.height || 0;
        
        // Safety: If dimensions are 0, we cannot calculate scaling.
        if (w <= 0 || h <= 0) {
           console.warn(`[Plugin:world_location_tracker] Map initialization skipped for Turn ${bundle.turnNumber || 'unknown'}: Invalid dimensions ${w}x${h}`);
           return null;
        }

        console.log(`[Plugin:world_location_tracker] Initializing map for Turn ${bundle.turnNumber || 'unknown'} (${w}x${h})`);
        diag('Map setup starting', {
            turnNumber: bundle.turnNumber || 'unknown',
            dimensions: `${w}x${h}`,
            nodes: bundle.worldData?.nodes?.length || 0,
            tiled: !!bundle.isTiled,
            hasImage: !!bundle.mapImage,
            hasLocation: !!bundle.currentLocation,
            location: bundle.currentLocation?.name || bundle.currentLocation?.anchor || null
        });
        const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / 512)));
        const sf = Math.pow(2, maxZoom);
        
        // Safety: Prevent division by zero
        if (sf <= 0) return null;
        
        const toLeaflet = (val) => val / sf;
        const map = L.map(containerEl, {
            crs: L.CRS.Simple,
            zoomControl: false,
            attributionControl: false,
            minZoom: options.minZoom !== undefined ? options.minZoom : 0,
            maxZoom: maxZoom + 2,
            dragging: options.interactive || false,
            scrollWheelZoom: options.interactive || false,
            doubleClickZoom: options.interactive || false,
            touchZoom: options.interactive || false,
            boxZoom: false,
            keyboard: false
        });

        // Use a standard top-left (0,0) origin to bottom-right (h,w) system.
        // We use negative Y because Simple CRS y grows UP by default.
        const bounds = [[toLeaflet(-h), 0], [0, toLeaflet(w)]];

        if (bundle.isTiled && bundle.tileUrl) {
            const tilePath = context.resolveProjectPath(bundle.tileUrl, bundle.projectName);
            L.tileLayer(tilePath, {
                minZoom: 0,
                maxZoom: maxZoom + 2,
                maxNativeZoom: maxZoom,
                noWrap: true,
                tileSize: 512,
                bounds: [[-512, 0], [0, 512]]
            }).addTo(map);
        } else if (bundle.mapImage) {
            const imagePath = context.resolveProjectPath(bundle.mapImage, bundle.projectName);
            L.imageOverlay(imagePath, bounds).addTo(map);
        }

        const mapPos = (wx, wy) => [toLeaflet(wy), toLeaflet(wx)];

        // Add Nodes
        if (bundle.worldData && bundle.worldData.nodes) {
            bundle.worldData.nodes.forEach(node => {
                L.circleMarker(mapPos(node.world_x, node.world_y), {
                    radius: options.mini ? 3 : 6,
                    color: 'var(--accent)',
                    fillColor: 'var(--accent)',
                    fillOpacity: 0.9,
                    weight: 1
                }).addTo(map).bindTooltip(node.name, { permanent: false, direction: 'top' });
            });
        }

        // Add Party
        if (bundle.currentLocation && !isNaN(bundle.currentLocation.x) && !isNaN(bundle.currentLocation.y)) {
            const pPos = mapPos(bundle.currentLocation.x, bundle.currentLocation.y);
            const partyIcon = L.divIcon({
                className: 'party-marker',
                html: options.mini
                    ? `<div class="party-marker-mini"></div>`
                    : `<div class="party-marker-icon"></div>`,
                iconSize: options.mini ? [12, 12] : [24, 32],
                iconAnchor: options.mini ? [6, 6] : [12, 32]
            });

            L.marker(pPos, { icon: partyIcon }).addTo(map);
            map.setView(pPos, options.zoom || maxZoom - 1);
        } else {
            map.fitBounds(bounds);
        }

        diag('Map setup complete', {
            turnNumber: bundle.turnNumber || 'unknown',
            elapsedMs: Math.round(performance.now() - setupStartedAt),
            activeMaps: timelineMaps.size + 1
        });
        return { map };
    };

    // --- TIMELINE LIFECYCLE ---
    const handleTimelineRowShow = (e) => {
        const rowShowStartedAt = performance.now();
        const { turn } = e.detail;
        if (!turn) return;

        const timelineProvider = turn.rightCard?.find(c => c.title === 'Strategic Map');
        if (!timelineProvider || !timelineProvider.mapBundle) return;

        const row = e.target;
        const mount = row.querySelector('.minimap-leaflet-mount');
        if (!mount) return;

        loadLeaflet(() => {
            const turnKey = `turn-${turn.turnNumber}`;
            if (timelineMaps.has(turnKey)) {
                timelineMaps.get(turnKey).remove();
            }

            try {
                const result = setupMapInstance(mount, timelineProvider.mapBundle, { 
                    mini: true, 
                    interactive: false,
                    zoom: 4
                });
                
                // Safety: If setupMapInstance returned null, stop here.
                if (!result || !result.map) return;

                timelineMaps.set(turnKey, result.map);
                diag('Minimap mounted', {
                    turnNumber: turn.turnNumber,
                    elapsedMs: Math.round(performance.now() - rowShowStartedAt),
                    activeMaps: timelineMaps.size
                });
                
                // Force multiple invalidations to catch layout settle
                // Safety: Re-check if map still exists and container is still in DOM
                const safeInvalidate = () => {
                    if (timelineMaps.has(turnKey) && mount.parentNode) {
                        try { result.map.invalidateSize(); } catch {}
                    }
                };
                setTimeout(safeInvalidate, 200);
                setTimeout(safeInvalidate, 1000);
            } catch (err) {
                console.error(`[Plugin:world_location_tracker] Minimap spawning failed for Turn ${turn.turnNumber}:`, err);
            }
        });
    };

    const handleTimelineRowHide = (e) => {
        const { turn } = e.detail;
        if (!turn) return;
        const turnKey = `turn-${turn.turnNumber}`;
        if (!timelineMaps.has(turnKey)) return;

        console.log(`[Plugin:world_location_tracker] Unloading map (off-screen) for Turn ${turn.turnNumber}`);
        const mapToRem = timelineMaps.get(turnKey);
        mapToRem.remove();
        timelineMaps.delete(turnKey);
    };

    // Listen for timeline lifecycle events
    document.addEventListener('timeline-row-show', handleTimelineRowShow);
    document.addEventListener('timeline-row-hide', handleTimelineRowHide);

    // Bootstrap: Catch rows that are already visible on load
    const bootstrapTimeline = () => {
        const visibleRows = document.querySelectorAll('.turn-row:not(.is-offscreen)');
        visibleRows.forEach((row, i) => {
            if (row.turnData) {
                // Add a staggered delay to prevent Leaflet bombardment
                setTimeout(() => {
                    handleTimelineRowShow({ target: row, detail: { turn: row.turnData } });
                }, i * 200);
            }
        });
    };

    setTimeout(bootstrapTimeline, 1000);
})();
