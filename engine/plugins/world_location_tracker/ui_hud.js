(function () {
    const { debugLog, socket } = context;

    const container = document.getElementById('world-location-container');
    const expandToggle = document.getElementById('map-expand-toggle');
    const mapDiv = document.getElementById('map-leaflet');
    const undeterminedLocationNotice = document.getElementById('map-location-undetermined');
    const coordsDisplay = document.getElementById('current-coords');
    const nearbyDisplay = document.getElementById('nearby-locations');
    const navigationInfo = document.getElementById('navigation-info');
    const gameContainer = document.getElementById('game-container');
    const locationInfo = document.getElementById('location-info');
    const mapLocationLabel = document.getElementById('map-location-label');
    const mapLocationStatus = document.getElementById('map-location-status');
    const mapRailLocation = document.getElementById('map-rail-location');
    const manualControls = document.getElementById('manual-navigation-controls');
    const manualMovementToggle = document.getElementById('manual-movement-toggle');
    const movementPolicyTitle = document.getElementById('movement-policy-title');
    const movementPolicyDescription = document.getElementById('movement-policy-description');
    const mapCommandBar = document.getElementById('map-command-bar');
    const movePartyButton = document.getElementById('move-party-button');
    const cancelPartyJourneyButton = document.getElementById('cancel-party-journey-button');
    const manualStatus = document.getElementById('manual-navigation-status');
    const manualRoutePanel = document.getElementById('manual-route-panel');
    const manualRouteTitle = document.getElementById('manual-route-title');
    const manualRouteInstruction = document.getElementById('manual-route-instruction');
    const manualRouteOptions = document.getElementById('manual-route-options');
    const manualTravelersField = document.getElementById('manual-travelers-field');
    const manualTravelers = document.getElementById('manual-travelers');
    const manualTravelReasonField = document.getElementById('manual-travel-reason-field');
    const manualTravelReason = document.getElementById('manual-travel-reason');
    const manualRouteActions = document.getElementById('manual-route-actions');
    const manualRouteCancel = document.getElementById('manual-route-cancel');
    const manualPlanButton = document.getElementById('manual-plan-button');
    const manualInstantButton = document.getElementById('manual-instant-button');
    const manualInstantConfirm = document.getElementById('manual-instant-confirm');
    const manualInstantSummary = document.getElementById('manual-instant-summary');
    const manualInstantConfirmButton = document.getElementById('manual-instant-confirm-button');
    const manualInstantBackButton = document.getElementById('manual-instant-back-button');

    let mainMap = null;
    let mainPartyMarker = null;
    let mainCharacterMarkers = [];
    let mainLabelMarkers = [];
    let mainTransitRouteLayers = [];
    let manualPreviewLayers = [];
    let mainMapMeta = null;
    let lastBundle = null;
    let hasVisibleMap = false;
    let hudRegistered = false;
    let leafletLoadPromise = null;
    let mapResizeObserver = null;
    let mapLayoutSyncFrame = null;
    let manualFlow = { phase: 'idle', previewId: null, target: null, routes: [], selectedRouteId: null, travelers: [] };
    const pendingSocketRequests = new Map();
    const userInputContainer = document.getElementById('user-input-container');
    const manualOrderBanner = (() => {
        if (!userInputContainer) return null;
        const existing = document.getElementById('wlt-manual-order-banner');
        if (existing) return existing;
        const banner = document.createElement('div');
        banner.id = 'wlt-manual-order-banner';
        banner.hidden = true;
        banner.setAttribute('aria-live', 'polite');
        userInputContainer.appendChild(banner);
        return banner;
    })();

    const clearManualOrderNotice = () => {
        window.FablekinVNHud?.removePinnedNotice?.('world_location_tracker.manual_order');
        if (manualOrderBanner) {
            manualOrderBanner.hidden = true;
            manualOrderBanner.innerHTML = '';
        }
    };

    const SHAPE_CLASSES = ['map-shape-circle', 'map-shape-square'];

    const registerHudPanel = () => {
        const hud = window.FablekinVNHud;
        if (!container || !hud) {
            if (container) container.style.display = 'none';
            return false;
        }
        hud.registerPanel({
            id: 'world_location_tracker',
            pluginId: 'world_location_tracker',
            title: 'World Map',
            icon: '',
            controlIcon: '⌖',
            controlLabel: 'World Map',
            dock: 'right',
            priority: 10,
            defaultOpen: true,
            available: hasVisibleMap,
            element: container,
            onVisibilityChange: open => {
                if (!open || !hasVisibleMap) return;
                fetchData(null, context.state.currentIndex);
                scheduleMainMapLayoutSync(lastBundle);
            }
        });
        hudRegistered = true;
        return true;
    };

    const isMapAvailable = (bundle) => {
        if (!bundle) return false;
        return Boolean(bundle.isTiled || bundle.mapImage);
    };

    const isUnknownLocationLabel = (value) => /^(unknown|unknown\s+(anchor|location|place))$/i
        .test(String(value || '').trim());

    const hasDeterminedLocation = (bundle) => {
        const location = bundle?.currentLocation;
        if (!location) return false;

        const x = Number(location.x);
        const y = Number(location.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        if (x === 0 && y === 0) return false;

        return ![
            location.anchor,
            location.anchor_node,
            location.name,
            location.specific_location
        ].some(isUnknownLocationLabel);
    };

    const syncUndeterminedLocationNotice = (bundle) => {
        if (!undeterminedLocationNotice) return;
        undeterminedLocationNotice.hidden = hasDeterminedLocation(bundle);
    };

    const setHudVisibilityByMapAvailability = (hasMap) => {
        hasVisibleMap = !!hasMap;
        if (!container || (!hudRegistered && !registerHudPanel())) return;

        if (!hasVisibleMap) {
            setExpandedState(false);
            container.style.display = 'none';
        } else {
            container.style.display = '';
        }
        window.FablekinVNHud?.updatePanel('world_location_tracker', { available: hasVisibleMap });
    };

    const applyHudShape = (shapeValue) => {
        if (!container) return;
        const normalizedShape = String(shapeValue || 'circle').toLowerCase() === 'circle' ? 'circle' : 'square';
        container.classList.remove(...SHAPE_CLASSES);
        container.classList.add(`map-shape-${normalizedShape}`);
    };

    const formatLocationLabel = (location) => {
        if (!location) return 'Adventure not yet started';
        const anchor = String(location.anchor || '').trim();
        const name = String(location.name || 'Unknown Location').trim();
        // Compact minimap label should prioritize stable anchor nodes over volatile sub-location names.
        return anchor || name;
    };

    const formatMapPositionLabel = (location) => {
        if (!location) return 'Adventure not yet started';
        const specific = String(location.specific_location || '').trim();
        const name = String(location.name || '').trim();
        const anchor = String(location.anchor || location.anchor_node || '').trim();
        return specific || name || anchor || 'Unknown Location';
    };

    const formatCharacterDisplayName = (value) => {
        const text = String(value || '').trim().replace(/_/g, ' ');
        if (!text) return 'Unknown Character';
        return text.split(/(\s+|-|')/).map(part => {
            if (!part || /^\s+$/.test(part) || part === '-' || part === "'") return part;
            return part.replace(/^[A-Za-z]/, letter => letter.toUpperCase());
        }).join('');
    };

    const updateCompactInfo = (bundle) => {
        // Preserve the tracker readout (for example, "Unknown Anchor") even when
        // that state is not reliable enough to place a marker on the map.
        const location = bundle?.currentLocation || null;
        const hasLocation = !!location;
        const x = hasLocation ? Math.round(Number(location.x || 0)) : '-';
        const y = hasLocation ? Math.round(Number(location.y || 0)) : '-';
        const labelText = formatLocationLabel(location);
        const immediateName = bundle?.navigation?.immediate?.target?.name;
        const journeyName = bundle?.navigation?.journey?.target?.name;
        const statusText = immediateName
            ? `Next: ${immediateName}`
            : (journeyName ? `Journey: ${journeyName}` : (hasLocation ? String(location.underground_status || 'Above Ground') : 'Awaiting story start'));
        if (coordsDisplay) {
            coordsDisplay.innerText = hasLocation ? `Coords ${x}, ${y}` : 'Coords -, -';
        }

        if (mapLocationLabel) {
            if (mapLocationLabel.textContent !== labelText) mapLocationLabel.textContent = labelText;
        }

        if (mapLocationStatus) {
            if (mapLocationStatus.innerText !== statusText) {
                mapLocationStatus.innerText = statusText;
            }
        }

        if (nearbyDisplay) {
            if (!hasLocation) {
                nearbyDisplay.innerHTML = '<div class="no-data">Open a chapter to track the party.</div>';
                return;
            }

            const anchor = String(location.anchor || '').trim();
            const name = String(location.name || '').trim();
            const anchorHint = anchor && anchor.toLowerCase() !== name.toLowerCase()
                ? `Part of ${anchor}`
                : 'Live location tracking active';

            nearbyDisplay.innerHTML = `<span class="loc-meta">${anchorHint}</span>`;
        }
    };

    const formatNavigationCard = (scope, plan) => {
        if (!plan?.target) return '';
        const target = escapeHtml(plan.target.name || 'Unresolved destination');
        const status = escapeHtml(plan.target.map_status !== 'mapped' ? plan.target.map_status : (plan.status || 'active'));
        const summary = plan.summary ? `<div class="wlt-nav-card-summary">${escapeHtml(plan.summary)}</div>` : '';
        const stops = (plan.waypoints || []).map(waypoint => waypoint.name).filter(Boolean);
        const requirements = (plan.requirements || []).filter(Boolean);
        const meta = [
            stops.length ? `Via ${stops.join(' -> ')}` : '',
            requirements.length ? requirements.join('; ') : ''
        ].filter(Boolean).join(' | ');
        const label = scope === 'immediate' ? 'Immediate Next' : 'Broader Journey';
        const suspended = plan.status === 'suspended' ? ' wlt-nav-card--suspended' : '';
        return `<button type="button" class="wlt-nav-card wlt-nav-card--${scope}${suspended}" data-navigation-scope="${scope}">
            <span class="wlt-nav-card-header"><span class="wlt-nav-card-kicker">${label}</span><span class="wlt-nav-card-status">${status}</span></span>
            <span class="wlt-nav-card-target">${target}</span>
            ${summary}
            ${meta ? `<span class="wlt-nav-card-meta">${escapeHtml(meta)}</span>` : ''}
        </button>`;
    };

    const renderNavigationPanel = (bundle) => {
        if (!navigationInfo) return;
        const navigation = bundle?.navigation;
        if (!navigation?.immediate && !navigation?.journey) {
            navigationInfo.innerHTML = '';
            return;
        }
        navigationInfo.innerHTML = [
            formatNavigationCard('immediate', navigation.immediate),
            formatNavigationCard('journey', navigation.journey)
        ].filter(Boolean).join('');
    };

    const renderLocationPanel = (bundle) => {
        if (!container || !locationInfo) return;

        const expanded = container.classList.contains('expanded');
        locationInfo.classList.toggle('expanded', expanded);

        if (expanded) {
            renderNavigationPanel(bundle);
            const location = bundle?.currentLocation || null;
            if (mapRailLocation) {
                mapRailLocation.innerText = formatLocationLabel(location);
            }
            if (nearbyDisplay) {
                nearbyDisplay.innerHTML = bundle?.guiText || '<div class="no-data">No location data available.</div>';
            }

            if (coordsDisplay) {
                if (location) {
                    coordsDisplay.innerText = `Coords ${Math.round(Number(location.x || 0))}, ${Math.round(Number(location.y || 0))}`;
                } else {
                    coordsDisplay.innerText = 'Coords -, -';
                }
            }

            return;
        }

        if (navigationInfo) navigationInfo.innerHTML = '';
        updateCompactInfo(bundle);
    };

    const clearLayerMarkers = (markers) => {
        if (!Array.isArray(markers)) return [];
        markers.forEach((marker) => {
            try {
                marker.remove?.();
            } catch {
                // no-op
            }
        });
        markers.length = 0;
        return markers;
    };

    const clearTransitRouteLayers = () => {
        clearLayerMarkers(mainTransitRouteLayers);
        mainTransitRouteLayers = [];
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatDistanceKm = (value, providedDisplay = '') => {
        if (providedDisplay) return String(providedDisplay);
        const numeric = Number(value);
        const unit = lastBundle?.distanceUnit || { short: 'km', fromKm: 1 };
        if (!Number.isFinite(numeric)) return `? ${unit.short || 'km'}`;
        const converted = numeric * (Number(unit.fromKm) || 1);
        const precision = Math.abs(converted) < 10 && Math.abs(converted - Math.round(converted)) > 0.01 ? 1 : 0;
        return `${Number(converted.toFixed(precision))} ${unit.short || 'km'}`;
    };

    const makeRequestId = () => `wlt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const requestSocket = (eventName, payload = {}) => new Promise((resolve, reject) => {
        if (!socket) {
            reject(new Error('The map connection is unavailable.'));
            return;
        }
        const requestId = makeRequestId();
        const timeout = setTimeout(() => {
            pendingSocketRequests.delete(requestId);
            reject(new Error('The map command timed out.'));
        }, 30000);
        pendingSocketRequests.set(requestId, { resolve, reject, timeout });
        socket.emit(eventName, { ...payload, requestId });
    });

    const handleSocketResponse = (response) => {
        const pending = pendingSocketRequests.get(response?.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingSocketRequests.delete(response.requestId);
        if (response.success === false) pending.reject(new Error(response.error || 'The map command failed.'));
        else pending.resolve(response);
    };

    const setManualStatus = (message = '', error = false) => {
        if (!manualStatus) return;
        manualStatus.textContent = message;
        manualStatus.classList.toggle('is-error', error);
    };

    const clearManualPreviewLayers = () => {
        clearLayerMarkers(manualPreviewLayers);
        manualPreviewLayers = [];
    };

    const renderManualPreviewLayers = () => {
        clearManualPreviewLayers();
        if (!mainMap || !mainMapMeta || !manualFlow.routes.length) return;
        const palette = ['#f2b84b', '#52d4a3', '#ff8d73', '#89a9ff'];
        manualFlow.routes.forEach((route, index) => {
            const points = (route.corridor || []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
            if (points.length < 2) return;
            const selected = String(route.id) === String(manualFlow.selectedRouteId);
            const layer = L.polyline(points.map(point => toMapLatLng(mainMapMeta, point.x, point.y)), {
                color: palette[index % palette.length],
                weight: selected ? 6 : 3,
                opacity: selected ? 0.95 : 0.34,
                dashArray: selected ? null : '6 8',
                interactive: true,
                className: 'wlt-manual-preview-route'
            }).addTo(mainMap);
            layer.on('click', () => selectManualRoute(route.id));
            manualPreviewLayers.push(layer);
        });
        if (manualFlow.target && Number.isFinite(Number(manualFlow.target.x)) && Number.isFinite(Number(manualFlow.target.y))) {
            const marker = L.marker(toMapLatLng(mainMapMeta, manualFlow.target.x, manualFlow.target.y), {
                zIndexOffset: 1600,
                icon: L.divIcon({
                    className: 'wlt-preview-target',
                    html: '<span class="wlt-preview-target-pin"></span><span class="wlt-preview-target-label">Candidate destination</span>',
                    iconSize: [132, 32],
                    iconAnchor: [14, 24]
                })
            }).addTo(mainMap);
            marker.bindTooltip(escapeHtml(manualFlow.target.name || 'Selected destination'), { direction: 'top' });
            manualPreviewLayers.push(marker);
        }
    };

    const formatRouteOption = (route) => {
        const requirements = (route.requirements || []).join(', ');
        const stops = (route.stops || []).join(' -> ');
        const terrain = (route.terrain || []).slice(0, 4).map(run => run.distance_km > 0 ? `${formatDistanceKm(run.distance_km, run.distance_display)} ${run.label}` : run.label).join(', ');
        const details = [route.mode_label, terrain, stops ? `Stops: ${stops}` : '', requirements ? `Requires: ${requirements}` : ''].filter(Boolean).join(' | ');
        return `<button type="button" class="wlt-route-option${String(route.id) === String(manualFlow.selectedRouteId) ? ' is-selected' : ''}" data-manual-route-id="${escapeHtml(route.id)}">
            <span class="wlt-route-option-head"><span>${escapeHtml(route.title)}</span><span>${escapeHtml(formatDistanceKm(route.distance_km, route.distance_display))} / ${escapeHtml(route.duration)}</span></span>
            <span class="wlt-route-option-meta">${escapeHtml(details || route.summary || 'Direct route')}</span>
        </button>`;
    };

    const selectManualRoute = (routeId) => {
        if (!manualFlow.routes.some(route => String(route.id) === String(routeId))) return;
        manualFlow.selectedRouteId = String(routeId);
        if (manualRouteOptions) manualRouteOptions.innerHTML = manualFlow.routes.map(formatRouteOption).join('');
        renderManualPreviewLayers();
    };

    const selectedTravelerNames = () => (manualFlow.travelers || []).filter(item => item.selected !== false).map(item => item.name);

    const renderTravelerPicker = () => {
        if (!manualTravelers || !manualTravelersField) return;
        const travelers = manualFlow.travelers || [];
        manualTravelersField.hidden = !['preview', 'confirming'].includes(manualFlow.phase) || travelers.length === 0;
        manualTravelers.innerHTML = travelers.map((traveler, index) => {
            const asset = resolveCharacterAssetPath(traveler.iconPath || traveler.spritePath, lastBundle?.projectName);
            const portrait = asset
                ? `<img src="${escapeHtml(asset)}" alt="">`
                : '<span class="wlt-traveler-placeholder" aria-hidden="true">&#128100;</span>';
            return `<button type="button" class="wlt-traveler-toggle${traveler.selected !== false ? ' is-selected' : ''}" data-traveler-index="${index}" aria-pressed="${traveler.selected !== false}">${portrait}<span>${escapeHtml(formatCharacterDisplayName(traveler.name))}</span></button>`;
        }).join('');
    };

    const renderTravelerSummary = (names, candidates = manualFlow.travelers || []) => {
        const lookup = new Map(candidates.map(item => [String(item.name || '').trim().toLowerCase(), item]));
        const items = (names || []).map(name => {
            const candidate = lookup.get(String(name || '').trim().toLowerCase()) || {};
            const asset = resolveCharacterAssetPath(candidate.iconPath || candidate.spritePath, lastBundle?.projectName);
            const portrait = asset
                ? `<img src="${escapeHtml(asset)}" alt="">`
                : '<span class="wlt-traveler-placeholder" aria-hidden="true">&#128100;</span>';
            return `<span class="wlt-traveler-summary-item">${portrait}<em>${escapeHtml(formatCharacterDisplayName(name))}</em></span>`;
        }).join('');
        return items ? `<span class="wlt-manual-result-travelers">${items}</span>` : '';
    };

    const getMovePartyDisabledReason = (bundle, hasEstablishedPlan = false) => {
        if (hasEstablishedPlan) {
            return 'A travel intent is already queued. Send or cancel that journey before choosing another route.';
        }
        if (bundle?.movementPolicy?.controls_enabled !== true) {
            return 'Move Party unlocks on the latest dialogue of the current turn. Historical map views are read-only.';
        }
        return '';
    };

    const setWizardMessage = (message, tone = '') => {
        if (!manualRouteInstruction) return;
        manualRouteInstruction.textContent = message;
        manualRouteInstruction.classList.toggle('is-error', tone === 'error');
        manualRouteInstruction.classList.toggle('is-success', tone === 'success');
        manualRouteInstruction.classList.toggle('is-saving', tone === 'saving');
    };

    const setManualFlowPhase = (phase) => {
        manualFlow.phase = phase;
        const selecting = phase === 'selecting';
        document.getElementById('map-viewport')?.classList.toggle('wlt-selecting-destination', selecting);
        container?.classList.toggle('wlt-manual-flow-active', !['idle', 'established', 'success'].includes(phase));
        if (manualRoutePanel) manualRoutePanel.hidden = phase === 'idle';
        if (manualRouteActions) manualRouteActions.hidden = phase !== 'preview';
        if (manualInstantConfirm) manualInstantConfirm.hidden = phase !== 'confirming';
        if (manualTravelReasonField) manualTravelReasonField.hidden = !['preview', 'confirming'].includes(phase);
        renderTravelerPicker();
        manualRoutePanel?.classList.toggle('is-busy', ['loading', 'saving'].includes(phase));
        manualRoutePanel?.classList.toggle('is-result-state', ['success', 'established'].includes(phase));
        manualRoutePanel?.classList.toggle('is-established-state', phase === 'established');
        if (manualRouteCancel) {
            manualRouteCancel.hidden = phase === 'success';
            manualRouteCancel.textContent = phase === 'established' ? 'Cancel Journey' : 'Cancel';
            manualRouteCancel.disabled = ['loading', 'saving'].includes(phase);
        }
        if (phase === 'selecting') setWizardMessage('Click a destination. Locations within 18 screen pixels snap to their mapped node.');
        if (phase === 'loading') setWizardMessage('Reading the terrain and generating route choices...', 'saving');
        if (phase === 'preview') setWizardMessage('Select the route the party should follow.');
    };

    const cancelManualFlow = async (notifyServer = true) => {
        const previewId = manualFlow.previewId;
        manualFlow = { phase: 'idle', previewId: null, target: null, routes: [], selectedRouteId: null, travelers: [] };
        if (manualTravelReason) manualTravelReason.value = '';
        if (manualRouteOptions) manualRouteOptions.innerHTML = '';
        clearManualPreviewLayers();
        setManualFlowPhase('idle');
        setManualStatus('');
        if (notifyServer && previewId) {
            requestSocket('vn-location-cancel-manual-move', { preview_id: previewId }).catch(() => {});
        }
    };

    const startManualFlow = () => {
        if (!lastBundle?.movementPolicy?.controls_enabled) {
            setManualStatus(getMovePartyDisabledReason(lastBundle) || 'Open the latest dialogue of the current turn to move the party.', true);
            return;
        }
        manualFlow = { phase: 'selecting', previewId: null, target: null, routes: [], selectedRouteId: null, travelers: [] };
        if (manualTravelReason) manualTravelReason.value = '';
        if (manualRouteOptions) manualRouteOptions.innerHTML = '';
        clearManualPreviewLayers();
        setManualFlowPhase('selecting');
        if (manualRouteTitle) manualRouteTitle.textContent = 'Choose a destination';
        setManualStatus('Destination selection is active. Press Esc to cancel.');
    };

    const findSnapNode = (latlng) => {
        if (!mainMap || !mainMapMeta) return null;
        const clickPoint = mainMap.latLngToContainerPoint(latlng);
        let nearest = null;
        let nearestDistance = Infinity;
        for (const node of getValidNodes(lastBundle)) {
            const nodePoint = mainMap.latLngToContainerPoint(toMapLatLng(mainMapMeta, node.world_x, node.world_y));
            const distance = clickPoint.distanceTo(nodePoint);
            if (distance < nearestDistance) {
                nearest = node;
                nearestDistance = distance;
            }
        }
        return nearestDistance <= 18 ? nearest : null;
    };

    const previewManualMapClick = async (latlng) => {
        if (manualFlow.phase !== 'selecting' || !mainMapMeta) return;
        const snapNode = findSnapNode(latlng);
        setManualFlowPhase('loading');
        setManualStatus('Generating deterministic route choices...');
        try {
            const response = await requestSocket('vn-location-preview-manual-move', {
                turnNumber: context.state.currentVN?.turnNumber,
                dialogueIndex: context.state.currentIndex,
                target: snapNode
                    ? { node_uid: snapNode.uid }
                    : { x: latlng.lng * mainMapMeta.sf, y: latlng.lat * mainMapMeta.sf }
            });
            manualFlow.previewId = response.preview_id;
            manualFlow.target = response.target;
            manualFlow.routes = response.routes || [];
            manualFlow.selectedRouteId = manualFlow.routes[0]?.id || null;
            manualFlow.travelers = (response.travelers || []).map(item => ({ ...item, selected: item.selected !== false }));
            setManualFlowPhase('preview');
            if (manualRouteTitle) manualRouteTitle.textContent = response.target?.name || 'Selected destination';
            selectManualRoute(manualFlow.selectedRouteId);
            setManualStatus(`${manualFlow.routes.length} route choice${manualFlow.routes.length === 1 ? '' : 's'} ready. No route-selection model was used.`);
        } catch (error) {
            setManualFlowPhase('selecting');
            setWizardMessage(error.message, 'error');
        }
    };

    const selectedManualRoute = () => manualFlow.routes.find(route => String(route.id) === String(manualFlow.selectedRouteId)) || null;

    const commitManualRoute = async (mode) => {
        const route = selectedManualRoute();
        if (!manualFlow.previewId || !route) {
            setWizardMessage('Select a route before confirming travel.', 'error');
            return;
        }
        const target = { ...manualFlow.target };
        const reason = String(manualTravelReason?.value || '').trim();
        const travelers = selectedTravelerNames();
        if ((manualFlow.travelers || []).length > 0 && travelers.length === 0) {
            setWizardMessage('Select at least one character for this journey.', 'error');
            return;
        }
        const returnPhase = mode === 'instant' ? 'confirming' : 'preview';
        setManualFlowPhase('saving');
        if (manualRouteTitle) manualRouteTitle.textContent = mode === 'instant' ? 'Establishing arrival' : 'Saving journey';
        setWizardMessage(mode === 'instant' ? 'Updating the canonical party location and preparing the next-turn timeskip...' : 'Saving the selected route as the active user-authorized journey...', 'saving');
        setManualStatus(mode === 'instant' ? 'Establishing the arrival...' : 'Saving the selected journey...');
        try {
            const response = await requestSocket('vn-location-commit-manual-move', {
                turnNumber: context.state.currentVN?.turnNumber,
                dialogueIndex: context.state.currentIndex,
                preview_id: manualFlow.previewId,
                route_id: route.id,
                mode,
                reason,
                travelers
            });
            const committedOrder = response?.result?.order || null;
            const committedTarget = committedOrder?.target || target;
            const committedRoute = committedOrder?.route
                ? { ...route, ...committedOrder.route, id: committedOrder.selected_route_id || route.id }
                : route;
            manualFlow.previewId = null;
            manualFlow.target = committedTarget;
            manualFlow.routes = [committedRoute];
            manualFlow.selectedRouteId = committedRoute.id;
            manualFlow.committedOrder = committedOrder
                ? { ...committedOrder, undo_available: response.result.undo_available === true }
                : null;
            renderManualPreviewLayers();
            setManualFlowPhase('established');
            const destination = escapeHtml(committedTarget?.name || 'the selected destination');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Travel intent ready';
            setWizardMessage(
                `The target and route are saved as intent. Nothing moves until you press Send to begin the next turn.`,
                'success'
            );
            if (manualRouteOptions) {
                const travelerText = renderTravelerSummary(travelers);
                manualRouteOptions.innerHTML = `<div class="wlt-manual-result"><strong>${mode === 'instant' ? 'Instant arrival queued' : 'Journey intent queued'}</strong><span>${destination} via ${escapeHtml(committedRoute.title)} (${escapeHtml(formatDistanceKm(committedRoute.distance_km, committedRoute.distance_display))}, ${escapeHtml(committedRoute.duration)}).</span>${travelerText}${reason ? `<span>Reason: ${escapeHtml(reason)}</span>` : ''}<span>${mode === 'instant' ? 'Pressing Send will establish the selected travelers at the destination and apply the time skip.' : 'Pressing Send will activate this route; the selected travelers remain at their current location until narrated movement occurs.'}</span></div>`;
            }
            setManualStatus('Travel intent saved. It will activate when you press Send.');
            fetchData(null, context.state.currentIndex);
        } catch (error) {
            setManualFlowPhase(returnPhase);
            if (manualRouteTitle) manualRouteTitle.textContent = target?.name || 'Selected destination';
            setWizardMessage(`Could not save this travel decision: ${error.message}`, 'error');
        }
    };

    const showInstantConfirmation = () => {
        const route = selectedManualRoute();
        if (!route || !manualFlow.target) return;
        setManualFlowPhase('confirming');
        const requirements = (route.requirements || []).length ? route.requirements.join(', ') : 'None known';
        const reason = String(manualTravelReason?.value || '').trim();
        if (manualRouteTitle) manualRouteTitle.textContent = 'Instant Arrival';
        setWizardMessage('This establishes that the party completes the selected journey and arrives at the destination immediately, advancing the story by the estimated travel time. Choose Back if you want the journey to unfold through the story instead.', 'error');
        if (manualInstantSummary) {
            manualInstantSummary.innerHTML = `<strong>${escapeHtml(manualFlow.target.name)}</strong><br>${escapeHtml(route.title)}: approximately ${escapeHtml(formatDistanceKm(route.distance_km, route.distance_display))}, ${escapeHtml(route.duration)}.<br>Crossings and requirements: ${escapeHtml(requirements)}.${reason ? `<br>User's reason: ${escapeHtml(reason)}` : ''}`;
        }
    };

    const renderManualControls = (bundle) => {
        const policy = bundle?.movementPolicy || {};
        const enabled = policy.controls_enabled === true;
        const order = bundle?.navigation?.manual_order;
        const hasEstablishedPlan = order?.source === 'user_map' && ['pending_send', 'active'].includes(order?.status);
        const canUndoInstant = enabled
            && order?.source === 'user_map'
            && order?.mode === 'instant'
            && order?.status === 'completed'
            && order?.undo_available === true
            && Number(order?.issued_turn) === Number(bundle?.turnNumber);
        if (manualMovementToggle) {
            manualMovementToggle.checked = policy.manual_movement_only === true;
            manualMovementToggle.disabled = !enabled;
        }
        const manualOnly = policy.manual_movement_only === true;
        manualControls?.classList.toggle('is-manual-only', manualOnly);
        manualControls?.classList.toggle('is-auto-navigation', !manualOnly);
        if (movementPolicyTitle) movementPolicyTitle.textContent = manualOnly ? 'Manual Movement Only' : 'Auto Navigation On';
        if (movementPolicyDescription) {
            movementPolicyDescription.textContent = manualOnly
                ? 'Automatic departures are blocked. Characters stay inside the current major location unless you issue a Move Party command.'
                : 'Automatic journey movement is allowed. Click this switch to require manual Move Party orders instead.';
        }
        manualControls?.querySelector('.wlt-lock-control')?.classList.toggle('is-disabled', !enabled);
        const disabledReason = getMovePartyDisabledReason(bundle, hasEstablishedPlan);
        if (mapCommandBar) {
            if (disabledReason) {
                mapCommandBar.dataset.disabledReason = disabledReason;
                mapCommandBar.title = disabledReason;
            } else {
                delete mapCommandBar.dataset.disabledReason;
                mapCommandBar.removeAttribute('title');
            }
        }
        if (movePartyButton) {
            movePartyButton.hidden = hasEstablishedPlan;
            movePartyButton.disabled = !enabled || hasEstablishedPlan;
            if (disabledReason) {
                movePartyButton.title = disabledReason;
                movePartyButton.setAttribute('aria-label', `Move Party unavailable. ${disabledReason}`);
            } else {
                movePartyButton.removeAttribute('title');
                movePartyButton.setAttribute('aria-label', 'Move Party');
            }
        }
        if (cancelPartyJourneyButton) {
            cancelPartyJourneyButton.hidden = !canUndoInstant;
            cancelPartyJourneyButton.disabled = !canUndoInstant;
            cancelPartyJourneyButton.textContent = 'Undo Arrival';
            cancelPartyJourneyButton.dataset.manualAction = 'undo-instant';
        }
        if (!enabled && manualFlow.phase !== 'idle') cancelManualFlow();
        if (!enabled && container?.classList.contains('expanded')) {
            setManualStatus('Historical map view is read-only. Return to the latest dialogue to issue movement orders.');
        }
    };

    const renderPersistedManualPlan = (bundle) => {
        if (!container?.classList.contains('expanded')) return;
        const order = bundle?.navigation?.manual_order;
        const isEstablished = order?.source === 'user_map' && order.status === 'pending_send';
        if (!isEstablished) {
            if (manualFlow.phase === 'established') cancelManualFlow(false);
            return;
        }
        if (!['idle', 'established', 'success'].includes(manualFlow.phase)) return;

        const route = order.route || {};
        const characterLookup = new Map((bundle.characterLocations || []).map(item => [String(item.name || '').trim().toLowerCase(), item]));
        manualFlow = {
            phase: 'established',
            previewId: null,
            target: order.target,
            routes: [],
            selectedRouteId: null,
            travelers: (order.travelers || []).map(name => ({
                name,
                selected: true,
                ...(characterLookup.get(String(name || '').trim().toLowerCase()) || {})
            }))
        };
        clearManualPreviewLayers();
        setManualFlowPhase('established');
        if (manualRouteTitle) manualRouteTitle.textContent = 'Travel intent ready';
        setWizardMessage(`The route to ${order.target?.name || 'the selected destination'} is saved, but not active yet. Nothing moves until you press Send.`, 'success');
        const routeMeta = [
            route.title || route.mode_label || 'Selected route',
            Number(route.distance_km) > 0 ? formatDistanceKm(route.distance_km, route.distance_display) : '',
            route.duration || ''
        ].filter(Boolean).join(' - ');
        const requirements = (route.requirements || []).filter(Boolean).join(', ');
        if (manualRouteOptions) {
            const travelerText = renderTravelerSummary(order.travelers || [], manualFlow.travelers);
            manualRouteOptions.innerHTML = `<div class="wlt-manual-result"><strong>${escapeHtml(order.mode === 'instant' ? 'Instant arrival queued' : order.target?.name || 'Selected destination')}</strong><span>${escapeHtml(routeMeta)}</span>${travelerText}${order.reason ? `<span>Reason: ${escapeHtml(order.reason)}</span>` : ''}${requirements ? `<span>Requirements: ${escapeHtml(requirements)}</span>` : ''}<span>This intent and route remain visible until you press Send or Cancel Travel Intent.</span></div>`;
        }
    };

    const renderManualOrderBanner = (bundle) => {
        const order = bundle?.navigation?.manual_order;
        const isPending = order?.source === 'user_map' && order.status === 'pending_send';
        const isActivePlan = order?.source === 'user_map' && order.mode === 'planned' && order.status === 'active';
        const isCurrentInstant = order?.source === 'user_map'
            && order.mode === 'instant'
            && order.status === 'completed'
            && Number(order.issued_turn) === Number(bundle?.turnNumber);
        if (!isPending && !isActivePlan && !isCurrentInstant) {
            clearManualOrderNotice();
            return;
        }
        const targetName = String(order.target?.name || 'selected destination');
        const target = escapeHtml(targetName);
        const route = order.route || {};
        const routeMeta = [
            Number(route.distance_km) > 0 ? formatDistanceKm(route.distance_km, route.distance_display) : '',
            route.duration || ''
        ].filter(Boolean).join(', ');
        const action = isPending
            ? `${order.mode === 'instant' ? 'Instant arrival' : 'Journey'} ready for ${target}`
            : (isCurrentInstant ? `Instant travel to ${target}` : `Journey planned to ${target}`);
        const reason = String(order.reason || '').trim();
        if (window.FablekinVNHud?.setPinnedNotice) {
            window.FablekinVNHud.setPinnedNotice({
                id: 'world_location_tracker.manual_order',
                owner: 'world_location_tracker',
                priority: 20,
                tone: 'travel',
                kicker: isPending ? 'Travel intent waiting for Send' : 'Saved travel order',
                title: `${isPending
                    ? `${order.mode === 'instant' ? 'Instant arrival' : 'Journey'} ready for ${targetName}`
                    : (isCurrentInstant ? `Instant travel to ${targetName}` : `Journey planned to ${targetName}`)}${routeMeta ? ` (${routeMeta})` : ''}`,
                detail: reason ? `Why: ${reason}` : ''
            });
            if (manualOrderBanner) {
                manualOrderBanner.hidden = true;
                manualOrderBanner.innerHTML = '';
            }
            return;
        }
        if (!manualOrderBanner) return;
        manualOrderBanner.innerHTML = `<span class="wlt-order-banner-kicker">${isPending ? 'Travel intent waiting for Send' : 'Saved travel order'}</span><strong>${action}${routeMeta ? ` (${escapeHtml(routeMeta)})` : ''}</strong>${reason ? `<span class="wlt-order-banner-reason">Why: ${escapeHtml(reason)}</span>` : ''}`;
        manualOrderBanner.hidden = false;
    };

    const cancelActiveManualJourney = async () => {
        const order = lastBundle?.navigation?.manual_order;
        if (!order || !['pending_send', 'active'].includes(order.status)) return;
        const accepted = window.confirm(`Cancel the travel intent to ${order.target?.name || 'the selected destination'}? The selected characters will remain at their current position.`);
        if (!accepted) return;
        cancelPartyJourneyButton.disabled = true;
        setManualStatus('Cancelling the user-directed journey...');
        try {
            await requestSocket('vn-location-cancel-manual-order', {
                turnNumber: context.state.currentVN?.turnNumber,
                dialogueIndex: context.state.currentIndex
            });
            manualFlow = { phase: 'success', previewId: null, target: order.target, routes: [], selectedRouteId: null };
            clearManualPreviewLayers();
            setManualFlowPhase('success');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Journey cancelled';
            setWizardMessage(`The planned journey to ${order.target?.name || 'the selected destination'} is no longer active. The party remains at its current position.`, 'success');
            if (manualRouteOptions) {
                manualRouteOptions.innerHTML = '<div class="wlt-manual-result"><strong>Travel authority removed</strong><span>No coordinates were changed. Director and Writer will no longer receive this route as an active user decision.</span></div>';
            }
            setManualStatus('Journey cancelled. The party remains at its current position.');
            fetchData(null, context.state.currentIndex);
        } catch (error) {
            manualFlow = { phase: 'success', previewId: null, target: order.target, routes: [], selectedRouteId: null };
            setManualFlowPhase('success');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Could not cancel journey';
            setWizardMessage(`The journey is still active: ${error.message}`, 'error');
            if (manualRouteOptions) manualRouteOptions.innerHTML = '';
            cancelPartyJourneyButton.disabled = false;
        }
    };

    const undoInstantArrival = async () => {
        const committedOrder = manualFlow.committedOrder;
        const order = committedOrder?.mode === 'instant' && committedOrder?.status === 'completed'
            ? committedOrder
            : lastBundle?.navigation?.manual_order;
        if (!order || order.mode !== 'instant' || order.status !== 'completed' || order.undo_available !== true) {
            setManualFlowPhase('success');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Could not undo arrival';
            setWizardMessage('This instant arrival no longer has a safe rollback snapshot. The arrival remains established.', 'error');
            return;
        }
        const accepted = window.confirm(`Undo the instant arrival at ${order.target?.name || 'the selected destination'} and restore the party's previous position?`);
        if (!accepted) return;
        setManualFlowPhase('saving');
        if (manualRouteTitle) manualRouteTitle.textContent = 'Undoing instant arrival';
        setWizardMessage('Restoring the previous canonical location and cancelling the pending timeskip...', 'saving');
        setManualStatus('Undoing instant arrival...');
        try {
            await requestSocket('vn-location-undo-instant-arrival', {
                turnNumber: context.state.currentVN?.turnNumber,
                dialogueIndex: context.state.currentIndex
            });
            clearManualPreviewLayers();
            manualFlow = { phase: 'success', previewId: null, target: null, routes: [], selectedRouteId: null };
            setManualFlowPhase('success');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Instant arrival undone';
            setWizardMessage('The previous party position and navigation state were restored. The pending timeskip will not be sent next turn.', 'success');
            if (manualRouteOptions) {
                manualRouteOptions.innerHTML = '<div class="wlt-manual-result"><strong>Previous location restored</strong><span>The instant arrival no longer affects canonical location or the next narrative turn.</span></div>';
            }
            setManualStatus('Instant arrival undone successfully.');
            fetchData(null, context.state.currentIndex);
        } catch (error) {
            setManualFlowPhase('success');
            if (manualRouteTitle) manualRouteTitle.textContent = 'Could not undo arrival';
            setWizardMessage(`The instant arrival is still active: ${error.message}`, 'error');
        }
    };

    const getValidNodes = (bundle) => {
        const nodes = Array.isArray(bundle?.worldData?.nodes) ? bundle.worldData.nodes : [];
        return nodes.filter((node) => Number.isFinite(Number(node?.world_x)) && Number.isFinite(Number(node?.world_y)) && node?.name);
    };

    const toMapLatLng = (mapMeta, wx, wy) => [mapMeta.toLeaflet(Number(wy || 0)), mapMeta.toLeaflet(Number(wx || 0))];

    const squaredDistance = (ax, ay, bx, by) => {
        const dx = Number(ax || 0) - Number(bx || 0);
        const dy = Number(ay || 0) - Number(by || 0);
        return (dx * dx) + (dy * dy);
    };

    const findNodeByName = (bundle, name) => {
        if (!bundle?.worldData?.nodes || !name) return null;
        const needle = String(name).trim().toLowerCase();
        if (!needle) return null;
        return bundle.worldData.nodes.find((node) => String(node?.name || '').trim().toLowerCase() === needle) || null;
    };

    const getTransitRouteData = (bundle) => {
        if (!hasDeterminedLocation(bundle)) return null;
        const location = bundle.currentLocation;
        const status = String(location.status || location.type || '').toUpperCase();
        const isTransit = status === 'TRANSIT' && !!location.destination;
        if (!isTransit) return null;

        const destinationNode = findNodeByName(bundle, location.destination);
        if (!destinationNode || !Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) return null;

        return {
            current: { x: Number(location.x), y: Number(location.y) },
            destination: { x: Number(destinationNode.world_x), y: Number(destinationNode.world_y) }
        };
    };

    const syncTransitRouteLayers = (bundle) => {
        if (!mainMap || !mainMapMeta) return;
        clearTransitRouteLayers();

        const expanded = container?.classList.contains('expanded');
        const navigation = bundle?.navigation;
        const renderedWaypointIds = new Set();
        const pointSummary = (point) => {
            const x = Number(point?.x);
            const y = Number(point?.y);
            return Number.isFinite(x) && Number.isFinite(y) ? `(${x.toFixed(1)},${y.toFixed(1)})` : '(?,?)';
        };
        const routeSummary = (points) => {
            const source = (points || []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
            const middle = source.length ? source[Math.floor(source.length / 2)] : null;
            return {
                points: source.length,
                first: pointSummary(source[0]),
                mid: pointSummary(middle),
                last: pointSummary(source[source.length - 1])
            };
        };
        const addPlan = (scope, plan) => {
            if (!plan?.target) return;
            const corridor = (plan.corridor || []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
            const color = scope === 'immediate' ? '#f2b84b' : (scope === 'manual' ? '#ff8d73' : '#41c7f2');
            const suspended = plan.status === 'suspended';
            debugLog('World Location [HUD Route Debug]: plan', {
                scope,
                routeId: plan.route_id || plan.id || null,
                target: plan.target?.name || null,
                status: plan.status || null,
                drawn: corridor.length >= 2,
                ...routeSummary(corridor)
            });
            if (corridor.length >= 2) {
                const latLngs = corridor.map(point => toMapLatLng(mainMapMeta, point.x, point.y));
                const glow = L.polyline(latLngs, {
                    color,
                    weight: expanded ? 9 : 7,
                    opacity: suspended ? 0.08 : 0.16,
                    interactive: false
                }).addTo(mainMap);
                const route = L.polyline(latLngs, {
                    color,
                    weight: scope === 'immediate' ? (expanded ? 5 : 4) : (expanded ? 4 : 3),
                    opacity: suspended ? 0.28 : (scope === 'immediate' ? 0.9 : (scope === 'manual' ? 0.82 : 0.62)),
                    dashArray: scope === 'immediate' ? '14 8' : (scope === 'manual' ? '5 7' : (suspended ? '4 11' : '8 8')),
                    className: scope === 'immediate' ? 'wlt-route-immediate' : (scope === 'manual' ? 'wlt-route-completed' : 'wlt-route-journey'),
                    interactive: true
                }).addTo(mainMap);
                const routeLabel = scope === 'immediate' ? 'Immediate' : (scope === 'manual' ? 'User-selected travel intent' : 'Journey');
                route.bindTooltip(`${routeLabel}: ${escapeHtml(plan.target.name)}`, { sticky: true });
                mainTransitRouteLayers.push(glow, route);
            }

            if (['mapped', 'map_point'].includes(plan.target.map_status) && Number.isFinite(Number(plan.target.x)) && Number.isFinite(Number(plan.target.y))) {
                const targetMarker = L.marker(toMapLatLng(mainMapMeta, plan.target.x, plan.target.y), {
                    zIndexOffset: scope === 'immediate' ? 760 : 720,
                    icon: L.divIcon({
                        className: 'wlt-route-target',
                        html: `<span class="wlt-route-target-icon wlt-route-target-icon--${scope}"></span>`,
                        iconSize: [22, 22],
                        iconAnchor: [11, 11]
                    })
                }).addTo(mainMap);
                const targetLabel = scope === 'immediate' ? 'Immediate destination' : (scope === 'manual' ? 'Selected destination' : 'Journey destination');
                targetMarker.bindTooltip(`${targetLabel}: ${escapeHtml(plan.target.name)}`, { direction: 'top' });
                mainTransitRouteLayers.push(targetMarker);
            }

            (plan.waypoints || []).forEach((waypoint, index) => {
                const key = waypoint.uid || waypoint.name;
                if (!key || renderedWaypointIds.has(key) || !Number.isFinite(Number(waypoint.x)) || !Number.isFinite(Number(waypoint.y))) return;
                renderedWaypointIds.add(key);
                const marker = L.marker(toMapLatLng(mainMapMeta, waypoint.x, waypoint.y), {
                    zIndexOffset: 700,
                    icon: L.divIcon({
                        className: 'wlt-route-waypoint',
                        html: `<span class="wlt-route-waypoint-icon">${index + 1}</span>`,
                        iconSize: [18, 18],
                        iconAnchor: [9, 9]
                    })
                }).addTo(mainMap);
                marker.bindTooltip(`${escapeHtml(waypoint.name)}${waypoint.purpose ? `<br>${escapeHtml(waypoint.purpose)}` : ''}`, { direction: 'top' });
                mainTransitRouteLayers.push(marker);
            });
        };

        const manualOrder = navigation?.manual_order;
        const manualRouteVisible = (manualOrder?.status === 'pending_send'
            || (manualOrder?.mode === 'instant'
                && manualOrder?.status === 'completed'
                && Number(manualOrder?.issued_turn) === Number(bundle?.turnNumber)))
            && (manualOrder?.route?.corridor || []).length >= 2;
        if (navigation?.journey || navigation?.immediate || manualRouteVisible) {
            addPlan('journey', navigation.journey);
            addPlan('immediate', navigation.immediate);
            if (manualRouteVisible) {
                addPlan('manual', {
                    target: manualOrder.target,
                    status: manualOrder.status,
                    corridor: manualOrder.route.corridor,
                    waypoints: []
                });
            }
            return;
        }

        const transit = getTransitRouteData(bundle);
        if (!transit) return;
        debugLog('World Location [HUD Route Debug]: legacy_transit', {
            current: pointSummary(transit.current),
            destination: pointSummary(transit.destination),
            currentStatus: bundle?.currentLocation?.status || bundle?.currentLocation?.type || null,
            currentDestination: bundle?.currentLocation?.destination || null
        });
        const routeStart = toMapLatLng(mainMapMeta, transit.current.x, transit.current.y);
        const routeEnd = toMapLatLng(mainMapMeta, transit.destination.x, transit.destination.y);
        const legacyRoute = L.polyline([routeStart, routeEnd], {
            color: '#41c7f2', weight: expanded ? 4 : 3, opacity: 0.42, dashArray: '7 7', interactive: false
        }).addTo(mainMap);
        mainTransitRouteLayers.push(legacyRoute);
    };

    const computeNearestNodes = (bundle, count = 2) => {
        if (!hasDeterminedLocation(bundle)) return [];
        const nodes = getValidNodes(bundle);
        if (nodes.length === 0) return [];
        const current = bundle.currentLocation;
        return nodes
            .map((node) => ({
                node,
                distSq: squaredDistance(current.x, current.y, node.world_x, node.world_y)
            }))
            .filter((entry) => entry.distSq >= 0.0001)
            .sort((a, b) => a.distSq - b.distSq)
            .slice(0, Math.max(1, Number(count) || 1))
            .map((entry) => entry.node);
    };

    const updateCompactAutoZoom = (bundle) => {
        if (!mainMap || !mainMapMeta || !hasDeterminedLocation(bundle) || container?.classList.contains('expanded')) return;
        const currentLatLng = toMapLatLng(mainMapMeta, bundle.currentLocation.x, bundle.currentLocation.y);
        const navigationPoints = [bundle?.navigation?.journey, bundle?.navigation?.immediate]
            .flatMap(plan => plan?.corridor || [])
            .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
        const nearestNodes = computeNearestNodes(bundle, 2);
        const isCircleMini = container?.classList.contains('map-shape-circle');
        const paddingTopLeft = isCircleMini ? [40, 22] : [24, 20];
        const paddingBottomRight = isCircleMini ? [92, 22] : [36, 20];
        if (navigationPoints.length > 0 || nearestNodes.length > 0) {
            const latLngPoints = navigationPoints.length > 0
                ? [currentLatLng, ...navigationPoints.map(point => toMapLatLng(mainMapMeta, point.x, point.y))]
                : [currentLatLng, ...nearestNodes.map((node) => toMapLatLng(mainMapMeta, node.world_x, node.world_y))];
            const bounds = L.latLngBounds(latLngPoints);
            mainMap.fitBounds(bounds, {
                paddingTopLeft,
                paddingBottomRight,
                maxZoom: Math.max(0, mainMapMeta.maxZoom - 1),
                animate: false
            });
            return;
        }
        const fallbackZoom = Math.max(0, mainMapMeta.maxZoom - 1);
        mainMap.setView(currentLatLng, fallbackZoom, { animate: false });
        if (isCircleMini) mainMap.panBy([0, 16], { animate: false });
    };

    const focusNavigationRoute = (scope) => {
        const plan = lastBundle?.navigation?.[scope];
        if (!mainMap || !mainMapMeta || !plan) return;
        const points = (plan.corridor || []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
        if (points.length === 0 && ['mapped', 'map_point'].includes(plan.target?.map_status)) points.push(plan.target);
        if (points.length === 0) return;
        const bounds = L.latLngBounds(points.map(point => toMapLatLng(mainMapMeta, point.x, point.y)));
        mainMap.fitBounds(bounds, { padding: [36, 36], maxZoom: mainMapMeta.maxZoom, animate: true });
    };

    const focusNavigationOverview = (bundle) => {
        if (!mainMap || !mainMapMeta || !hasDeterminedLocation(bundle)) return;
        const points = [bundle.currentLocation];
        for (const plan of [bundle?.navigation?.journey, bundle?.navigation?.immediate]) {
            const corridor = (plan?.corridor || []).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
            points.push(...corridor);
            if (corridor.length === 0
                && ['mapped', 'map_point'].includes(plan?.target?.map_status)
                && Number.isFinite(Number(plan.target.x))
                && Number.isFinite(Number(plan.target.y))) {
                points.push(plan.target);
            }
        }

        const latLngs = points.map(point => toMapLatLng(mainMapMeta, point.x, point.y));
        if (latLngs.length === 1) {
            mainMap.setView(latLngs[0], Math.max(0, mainMapMeta.maxZoom - 1), { animate: false });
            return;
        }

        mainMap.fitBounds(L.latLngBounds(latLngs), {
            padding: [42, 42],
            maxZoom: mainMapMeta.maxZoom,
            animate: false
        });
    };

    const syncMainMapLayout = (bundle = lastBundle) => {
        if (!mainMap || !mainMapMeta || !mapDiv || !bundle || !mapDiv.isConnected) return false;
        const rect = mapDiv.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;

        mainMap.invalidateSize({ animate: false, pan: false });
        if (container?.classList.contains('expanded')) {
            focusNavigationOverview(bundle);
        } else {
            updateCompactAutoZoom(bundle);
        }
        renderSmartLabels(bundle);
        return true;
    };

    const scheduleMainMapLayoutSync = (bundle = lastBundle) => {
        if (mapLayoutSyncFrame !== null) cancelAnimationFrame(mapLayoutSyncFrame);
        mapLayoutSyncFrame = requestAnimationFrame(() => {
            mapLayoutSyncFrame = null;
            syncMainMapLayout(bundle || lastBundle);
        });
    };

    const resolveCharacterAssetPath = (assetPath, projectName) => {
        const clean = String(assetPath || '').trim().replace(/\\/g, '/');
        if (!clean) return null;
        if (/^(data:|blob:|https?:)/i.test(clean)) return clean;
        const relativePath = clean.startsWith('assets/') || clean.startsWith('plugins/')
            ? clean
            : `assets/${clean}`;
        return context.resolveProjectPath(relativePath, projectName);
    };

    const formatCharacterTooltipBody = (character) => {
        const name = escapeHtml(formatCharacterDisplayName(character?.name));
        const location = escapeHtml(character?.specificLocation || 'Unknown location');
        const contextText = String(character?.context || '').trim();
        return `<span class="char-tooltip-heading"><b>${name}</b><small>Last known state</small></span>
            <span class="char-tooltip-location">&#128205; ${location}</span>
            ${contextText ? `<span class="char-tooltip-context">${escapeHtml(contextText)}</span>` : ''}`;
    };

    const syncPartyMarkerVisibility = (bundle) => {
        if (!mainPartyMarker) return;
        const current = hasDeterminedLocation(bundle) ? bundle.currentLocation : null;
        const hasPartySpritesAtPin = !!current && (bundle?.characterLocations || []).some(character => (
            character?.isPlayer !== true
            && character?.isCore
            && character?.spritePath
            && squaredDistance(current.x, current.y, character.x, character.y) < 4
        ));
        mainPartyMarker.setOpacity(hasPartySpritesAtPin ? 0 : 1);
    };

    const clusterCharacters = (characters, map, sf, toLeaflet, projectName, options = {}) => {
        const compact = options.compact === true;
        const mapCharacters = characters.filter(character => character?.isPlayer !== true);
        const compactCharacters = compact
            ? mapCharacters.filter(character => character?.isCore && character?.spritePath)
            : mapCharacters;
        const visibleCharacters = hasDeterminedLocation(options.bundle || lastBundle)
            ? compactCharacters
            : compactCharacters.filter(character => !character?.isCore && !character?.isPartyMember);
        const groups = [];
        const groupingRadiusSq = 40 * 40;
        for (const rawCharacter of visibleCharacters) {
            const anchorNode = !rawCharacter?.isCore && !rawCharacter?.isPartyMember
                ? findNodeByName(options.bundle || lastBundle, rawCharacter?.anchorNode)
                : null;
            const char = anchorNode
                ? { ...rawCharacter, x: Number(anchorNode.world_x), y: Number(anchorNode.world_y) }
                : rawCharacter;
            const x = Number(char?.x);
            const y = Number(char?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            let group = groups.find(candidate => squaredDistance(x, y, candidate.x, candidate.y) <= groupingRadiusSq);
            if (!group) {
                group = { x, y, chars: [] };
                groups.push(group);
            }
            group.chars.push(char);
            const count = group.chars.length;
            group.x = ((group.x * (count - 1)) + x) / count;
            group.y = ((group.y * (count - 1)) + y) / count;
        }

        const createdMarkers = [];
        for (const { x: groupX, y: groupY, chars } of groups) {
            const coreSprites = chars.filter(character => character?.isCore && character?.spritePath);
            const portraitCharacters = chars.filter(character => !character?.isCore || !character?.spritePath);
            const visualAnchor = coreSprites.length > 0
                ? {
                    x: coreSprites.reduce((sum, character) => sum + Number(character.x), 0) / coreSprites.length,
                    y: coreSprites.reduce((sum, character) => sum + Number(character.y), 0) / coreSprites.length
                }
                : { x: groupX, y: groupY };

            coreSprites.forEach((character, index) => {
                createdMarkers.push(createCoreCharacterMarker({ ...character, ...visualAnchor }, map, toLeaflet, projectName, {
                    compact,
                    index,
                    count: coreSprites.length
                }));
            });

            if (compact || portraitCharacters.length === 0) continue;
            if (coreSprites.length > 0 && portraitCharacters.length === 1) {
                const coreHalfWidth = (((coreSprites.length - 1) / 2) * 32) + 27;
                createdMarkers.push(createCharacterMarker(
                    { ...portraitCharacters[0], ...visualAnchor },
                    map,
                    sf,
                    toLeaflet,
                    projectName,
                    { offsetX: coreHalfWidth + 38, offsetY: 28 }
                ));
                continue;
            }
            if (coreSprites.length > 0 || portraitCharacters.length >= 2) {
                createdMarkers.push(createSideCharacterCluster(
                    portraitCharacters,
                    map,
                    toLeaflet,
                    projectName,
                    { coreCount: coreSprites.length, anchorX: visualAnchor.x, anchorY: visualAnchor.y }
                ));
                continue;
            }
            if (portraitCharacters.length === 1) {
                createdMarkers.push(createCharacterMarker(portraitCharacters[0], map, sf, toLeaflet, projectName));
                continue;
            }

            portraitCharacters.forEach(char => {
                createdMarkers.push(createCharacterMarker(char, map, sf, toLeaflet, projectName));
            });
        }

        return createdMarkers;
    };

    const createSideCharacterCluster = (characters, map, toLeaflet, projectName, options = {}) => {
        const items = characters.slice(0, 12);
        const coreCount = Math.max(0, Number(options.coreCount) || 0);
        const coreHalfWidth = coreCount > 0 ? (((coreCount - 1) / 2) * 32) + 27 : 0;
        const offsetX = coreHalfWidth + (coreCount > 0 ? 36 : 0);
        const maxZoomOffsetY = coreCount > 0 ? 58 : 52;
        const iconSize = 40;
        const renderPortrait = (character, className) => {
            const imageUrl = resolveCharacterAssetPath(character.iconPath, projectName);
            if (!imageUrl) return `<span class="${className} side-character-placeholder">&#128100;</span>`;
            return `<img class="${className}" src="${escapeHtml(imageUrl)}" alt="">`;
        };
        const previewItems = items.slice(0, 2)
            .map((character, index) => renderPortrait(character, `side-character-stack-image side-character-stack-image--${index + 1}`))
            .join('');
        const fanItems = items.map((character, index) => {
            const row = Math.floor(index / 6);
            const column = index % 6;
            const itemsInRow = Math.min(6, items.length - (row * 6));
            const fanX = (column - ((itemsInRow - 1) / 2)) * 39;
            const fanY = 52 + (row * 39);
            return `<button type="button" class="side-character-fan-item" data-character-name="${escapeHtml(character.name)}" style="--fan-x:${fanX}px;--fan-y:${fanY}px" aria-label="Open ${escapeHtml(formatCharacterDisplayName(character.name))} character sheet">
                ${renderPortrait(character, 'side-character-fan-image')}
                <span class="side-character-fan-tooltip" role="tooltip">${formatCharacterTooltipBody(character)}</span>
            </button>`;
        }).join('');
        const hiddenCount = Math.max(0, characters.length - items.length);
        const countLabel = hiddenCount > 0 ? `${items.length}+` : String(characters.length);
        const countBadge = characters.length > 1 ? `<span class="side-character-count">${countLabel}</span>` : '';
        const singleCharacter = characters.length === 1;
        const html = `<div class="side-character-cluster">
            <button type="button" class="side-character-stack" aria-expanded="false" aria-label="${singleCharacter ? `Open ${escapeHtml(formatCharacterDisplayName(characters[0].name))} character sheet` : `Show ${characters.length} nearby characters`}">
                ${previewItems}
                ${countBadge}
            </button>
            ${singleCharacter ? '' : `<div class="side-character-fan">${fanItems}</div>`}
        </div>`;

        const anchorX = Number.isFinite(Number(options.anchorX)) ? Number(options.anchorX) : Number(characters[0].x);
        const anchorY = Number.isFinite(Number(options.anchorY)) ? Number(options.anchorY) : Number(characters[0].y);
        const marker = L.marker([toLeaflet(anchorY), toLeaflet(anchorX)], {
            zIndexOffset: 1200,
            icon: L.divIcon({
                className: 'side-character-cluster-marker',
                html,
                iconSize: [iconSize, iconSize],
                iconAnchor: [(iconSize / 2) - offsetX, iconSize / 2],
                tooltipAnchor: [offsetX, -iconSize]
            })
        }).addTo(map);
        marker._wltSideCluster = true;

        const element = marker.getElement?.();
        const stack = element?.querySelector('.side-character-stack');
        const updateZoomOffset = () => {
            if (!element) return;
            const rawMinZoom = Number(map.getMinZoom?.() ?? 0);
            const minZoom = Number.isFinite(rawMinZoom) ? rawMinZoom : 0;
            const rawMaxZoom = Number(map.getMaxZoom?.());
            const maxZoom = Number.isFinite(rawMaxZoom) && rawMaxZoom > minZoom ? rawMaxZoom : minZoom + 4;
            const rawCurrentZoom = Number(map.getZoom?.() ?? minZoom);
            const currentZoom = Number.isFinite(rawCurrentZoom) ? rawCurrentZoom : minZoom;
            const progress = Math.max(0, Math.min(1, (currentZoom - minZoom) / Math.max(1, maxZoom - minZoom)));
            const easedProgress = progress * progress * (3 - (2 * progress));
            element.style.setProperty('--stack-zoom-offset-y', `${Math.round(maxZoomOffsetY * easedProgress)}px`);
        };
        const collapse = () => {
            element?.classList.remove('is-expanded');
            stack?.setAttribute('aria-expanded', 'false');
        };
        if (element && stack) {
            updateZoomOffset();
            L.DomEvent.disableClickPropagation(element);
            stack.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (singleCharacter) {
                    socket.emit('character-sheets-request-single', { characterName: characters[0].name });
                    return;
                }
                const expanded = element.classList.toggle('is-expanded');
                stack.setAttribute('aria-expanded', String(expanded));
                marker.closeTooltip();
            });
            element.querySelectorAll('.side-character-fan-item').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const characterName = button.dataset.characterName;
                    if (characterName) socket.emit('character-sheets-request-single', { characterName });
                });
            });
            map.on('click zoomstart movestart', collapse);
            map.on('zoom zoomend', updateZoomOffset);
            marker.on('remove', () => {
                map.off('click zoomstart movestart', collapse);
                map.off('zoom zoomend', updateZoomOffset);
            });
        }

        return marker;
    };

    const createCoreCharacterMarker = (char, map, toLeaflet, projectName, options = {}) => {
        const compact = options.compact === true;
        const width = compact ? 30 : 54;
        const height = compact ? 44 : 78;
        const spacing = compact ? 16 : 32;
        const count = Math.max(1, Number(options.count) || 1);
        const index = Math.max(0, Number(options.index) || 0);
        const offsetX = (index - ((count - 1) / 2)) * spacing;
        const spriteUrl = resolveCharacterAssetPath(char.spritePath, projectName);
        if (!spriteUrl) return createCharacterMarker(char, map, 1, toLeaflet, projectName);

        const isDead = lastBundle?.deadCharacters?.includes(char.name);
        const deadClass = isDead ? ' is-dead' : '';
        const marker = L.marker([toLeaflet(char.y), toLeaflet(char.x)], {
            zIndexOffset: 820 + index,
            icon: L.divIcon({
                className: `core-character-marker${compact ? ' core-character-marker--compact' : ''}`,
                html: `<div class="core-character-sprite${deadClass}"><img src="${escapeHtml(spriteUrl)}" alt=""></div>`,
                iconSize: [width, height],
                iconAnchor: [(width / 2) - offsetX, height],
                tooltipAnchor: [offsetX, -height + 8]
            })
        }).addTo(map);

        const tooltipContent = `<div class="char-tooltip">${formatCharacterTooltipBody(char)}</div>`;
        marker.bindTooltip(tooltipContent, { direction: 'top', offset: [0, -4] });
        marker.on('click', () => socket.emit('character-sheets-request-single', { characterName: char.name }));
        return marker;
    };

    const createCharacterMarker = (char, map, sf, toLeaflet, projectName, options = {}) => {
        const pos = [toLeaflet(char.y), toLeaflet(char.x)];
        const iconPath = resolveCharacterAssetPath(char.iconPath, projectName);
        const isDead = lastBundle?.deadCharacters?.includes(char.name);

        let style = 'width: 32px; height: 32px; border-radius: var(--radius-sm); border: 2px solid var(--accent); box-shadow: var(--shadow-sm);';
        if (isDead) style += ' filter: grayscale(100%) opacity(0.6);';

        const iconHtml = iconPath
            ? `<img src="${escapeHtml(iconPath)}" style="${style}">`
            : '<span style="font-size: 24px; text-shadow: 0 0 3px black;">&#128100;</span>';

        const offsetX = Number(options.offsetX) || 0;
        const offsetY = Number(options.offsetY) || 0;
        const marker = L.marker(pos, {
            zIndexOffset: options.offsetX || options.offsetY ? 1180 : 0,
            icon: L.divIcon({
                className: 'character-marker',
                html: iconHtml,
                iconSize: [36, 36],
                iconAnchor: [18 - offsetX, 18 - offsetY],
                tooltipAnchor: [offsetX, -10 - offsetY]
            })
        }).addTo(map);

        const tooltipContent = `<div class="char-tooltip">${formatCharacterTooltipBody(char)}</div>`;

        marker.bindTooltip(tooltipContent, { direction: 'top', offset: [0, -10] });
        marker.on('click', () => socket.emit('character-sheets-request-single', { characterName: char.name }));

        return marker;
    };

    const renderSmartLabels = (bundle) => {
        if (!mainMap || !mainMapMeta || !bundle) {
            clearLayerMarkers(mainLabelMarkers);
            return;
        }

        clearLayerMarkers(mainLabelMarkers);
        if (!hasDeterminedLocation(bundle)) return;

        const expanded = container?.classList.contains('expanded');
        const mapRect = mainMap.getContainer().getBoundingClientRect();
        const occupied = [];

        const overlaps = (rect) => occupied.some((used) => !(
            rect.right < used.left
            || rect.left > used.right
            || rect.bottom < used.top
            || rect.top > used.bottom
        ));

        const addLabel = (latLng, text, current = false, belowFormation = false) => {
            const marker = L.marker(latLng, {
                interactive: false,
                keyboard: false,
                zIndexOffset: current ? 900 : 650,
                icon: L.divIcon({
                    className: current ? 'wlt-map-label wlt-map-label--current' : 'wlt-map-label',
                    html: `<span class="wlt-map-label-text">${escapeHtml(text)}</span>`,
                    iconAnchor: belowFormation && expanded ? [0, -52] : [0, 24]
                })
            }).addTo(mainMap);

            const el = marker.getElement?.();
            if (!el) {
                mainLabelMarkers.push(marker);
                return true;
            }

            const rect = el.getBoundingClientRect();
            const inView = rect.right >= (mapRect.left + 2)
                && rect.left <= (mapRect.right - 2)
                && rect.bottom >= (mapRect.top + 2)
                && rect.top <= (mapRect.bottom - 2);

            if (!current && (!inView || overlaps(rect))) {
                marker.remove();
                return false;
            }

            occupied.push({
                left: rect.left - 4,
                top: rect.top - 4,
                right: rect.right + 4,
                bottom: rect.bottom + 4
            });
            mainLabelMarkers.push(marker);
            return true;
        };

        const anchorName = bundle.currentLocation.anchor || bundle.currentLocation.anchor_node;
        const anchorNode = findNodeByName(bundle, anchorName);
        if (anchorNode) {
            addLabel(toMapLatLng(mainMapMeta, anchorNode.world_x, anchorNode.world_y), anchorNode.name, true, false);
            return;
        }

        const currentLatLng = toMapLatLng(mainMapMeta, bundle.currentLocation.x, bundle.currentLocation.y);
        addLabel(currentLatLng, formatMapPositionLabel(bundle.currentLocation), true, true);
    };

    const loadLeaflet = (callback) => {
        if (!leafletLoadPromise) {
            const stylesheetPromise = (() => {
                let link = document.querySelector('link[href*="leaflet.css"]');
                if (link?.sheet) return Promise.resolve();

                const shouldAppend = !link;
                if (!link) {
                    link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = context.resolvePluginPath('world_location_tracker', 'lib/leaflet.css');
                }

                const promise = new Promise((resolve, reject) => {
                    link.addEventListener('load', resolve, { once: true });
                    link.addEventListener('error', () => reject(new Error('Leaflet stylesheet failed to load.')), { once: true });
                });
                if (shouldAppend) document.head.appendChild(link);
                return promise;
            })();

            const scriptPromise = (() => {
                if (window.L) return Promise.resolve();
                let script = document.querySelector('script[src*="world_location_tracker/lib/leaflet.js"]');
                const shouldAppend = !script;
                if (!script) {
                    script = document.createElement('script');
                    script.src = context.resolvePluginPath('world_location_tracker', 'lib/leaflet.js');
                }

                const promise = new Promise((resolve, reject) => {
                    script.addEventListener('load', resolve, { once: true });
                    script.addEventListener('error', () => reject(new Error('Leaflet script failed to load.')), { once: true });
                });
                if (shouldAppend) document.head.appendChild(script);
                return promise;
            })();

            leafletLoadPromise = Promise.all([stylesheetPromise, scriptPromise]).then(() => {
                if (!window.L) throw new Error('Leaflet loaded without exposing its runtime.');
            });
        }

        leafletLoadPromise
            .then(() => callback())
            .catch(error => console.error('[Plugin:world_location_tracker] Failed to load Leaflet:', error));
    };

    const setupMapInstance = (containerEl, bundle, options = {}) => {
        const w = bundle.dimensions.width;
        const h = bundle.dimensions.height;
        const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / 512)));
        const sf = Math.pow(2, maxZoom);
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

        const southWest = [toLeaflet(-h), 0];
        const northEast = [0, toLeaflet(w)];
        const bounds = [southWest, northEast];

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
        const mapMeta = { maxZoom, sf, toLeaflet, mapPos, bounds };

        const nodeMarkers = [];
        if (bundle.worldData && bundle.worldData.nodes) {
            bundle.worldData.nodes.forEach((node) => {
                const marker = L.circleMarker(mapPos(node.world_x, node.world_y), {
                    radius: options.mini ? 3 : 6,
                    color: 'var(--accent)',
                    fillColor: 'var(--accent)',
                    fillOpacity: 0.9,
                    weight: 1
                }).addTo(map).bindTooltip(node.name, {
                    permanent: false,
                    direction: 'top',
                    className: 'wlt-node-tooltip'
                });
                nodeMarkers.push(marker);
            });
        }

        let partyMarker = null;
        if (hasDeterminedLocation(bundle)) {
            const pPos = mapPos(bundle.currentLocation.x, bundle.currentLocation.y);
            partyMarker = L.marker(pPos, {
                icon: L.divIcon({
                    className: 'party-marker',
                    html: options.mini ? '<div class="party-marker-mini"></div>' : '<div class="party-marker-icon"></div>',
                    iconSize: options.mini ? [12, 12] : [24, 32],
                    iconAnchor: options.mini ? [6, 6] : [12, 32]
                })
            }).addTo(map);
            if (options.mini) {
                map.setView(pPos, options.zoom || Math.max(0, maxZoom - 1));
            }
        } else {
            const mapCenter = mapPos(w / 2, -h / 2);
            map.setView(mapCenter, options.zoom || Math.max(0, maxZoom - 1));
        }

        let characterMarkers = [];
        if (!options.mini && bundle.characterLocations && (options.showCharacters !== false || options.showCoreCharacters === true)) {
            characterMarkers = clusterCharacters(bundle.characterLocations, map, sf, toLeaflet, bundle.projectName, {
                compact: options.showCharacters === false,
                bundle
            });
        }

        return { map, partyMarker, characterMarkers, nodeMarkers, mapMeta };
    };

    const initMainMap = (bundle) => {
        if (!mapDiv) return;

        loadLeaflet(() => {
            if (mainMap) {
                mainMap.remove();
                mainMap = null;
            }
            clearLayerMarkers(mainCharacterMarkers);
            clearLayerMarkers(mainLabelMarkers);
            clearTransitRouteLayers();
            mainMapMeta = null;
            if (!bundle.mapImage && !bundle.isTiled) return;

            const result = setupMapInstance('map-leaflet', bundle, {
                interactive: true,
                showCharacters: container?.classList.contains('expanded') === true,
                showCoreCharacters: true
            });
            mainMap = result.map;
            mainPartyMarker = result.partyMarker;
            mainCharacterMarkers = result.characterMarkers;
            mainMapMeta = result.mapMeta;
            syncPartyMarkerVisibility(bundle);
            mainMap.on('zoomend moveend', () => renderSmartLabels(lastBundle || bundle));
            mainMap.on('click', (event) => previewManualMapClick(event.latlng));
            syncTransitRouteLayers(bundle);
            scheduleMainMapLayoutSync(bundle);
        });
    };

    const refreshCharacterMarkersForMode = (bundle) => {
        if (!mainMap || !mainMapMeta) return;
        clearLayerMarkers(mainCharacterMarkers);
        const expanded = container?.classList.contains('expanded');
        if (bundle?.characterLocations && bundle.characterLocations.length > 0) {
            mainCharacterMarkers = clusterCharacters(
                bundle.characterLocations,
                mainMap,
                mainMapMeta.sf,
                mainMapMeta.toLeaflet,
                bundle.projectName,
                { compact: !expanded, bundle }
            );
        }
        syncPartyMarkerVisibility(bundle);
    };

    const fetchData = (turnNumber = null, dialogueIndex = null) => {
        const activeTurnNumber = Number.isInteger(turnNumber)
            ? turnNumber
            : context.state.currentVN?.turnNumber;
        const activeDialogueIndex = Number.isInteger(dialogueIndex)
            ? dialogueIndex
            : context.state.currentIndex;
        socket?.emit('vn-location-fetch-data', {
            turnNumber: activeTurnNumber,
            dialogueIndex: activeDialogueIndex
        });
    };

    const fetchLatestData = (turnNumber = null) => {
        const activeTurnNumber = Number.isInteger(turnNumber)
            ? turnNumber
            : context.state.currentVN?.turnNumber;
        socket?.emit('vn-location-fetch-data', {
            turnNumber: activeTurnNumber
        });
    };

    const setExpandedState = (expanded) => {
        if (!container) return;

        const isExpanded = expanded === true;
        if (!isExpanded && manualFlow.phase !== 'idle') cancelManualFlow();
        if (isExpanded) window.FablekinVNHud?.setFullscreen('world_location_tracker', true);
        container.classList.toggle('expanded', isExpanded);
        gameContainer?.classList.toggle('wlt-map-open', isExpanded);
        if (!isExpanded) window.FablekinVNHud?.setFullscreen('world_location_tracker', false);
        if (expandToggle) {
            const label = expandToggle.querySelector('.map-expand-label');
            if (label) label.innerText = isExpanded ? 'Close' : 'Map';
            expandToggle.setAttribute('aria-expanded', String(isExpanded));
            expandToggle.setAttribute('aria-label', isExpanded ? 'Close full map' : 'Open full map');
            expandToggle.dataset.originalTitle = isExpanded ? 'Return to Minimap' : 'Expand Map';
            expandToggle.removeAttribute('title');
        }

        refreshCharacterMarkersForMode(lastBundle);
        syncTransitRouteLayers(lastBundle);
        renderLocationPanel(lastBundle);
        scheduleMainMapLayoutSync(lastBundle);
        if (isExpanded) {
            fetchData(null, context.state.currentIndex);
            renderPersistedManualPlan(lastBundle);
        }
    };

    const toggleExpandedState = () => {
        setExpandedState(!container?.classList.contains('expanded'));
    };

    if (expandToggle) {
        expandToggle.addEventListener('click', toggleExpandedState);
    }

    navigationInfo?.addEventListener('click', (event) => {
        const card = event.target?.closest?.('[data-navigation-scope]');
        if (card) focusNavigationRoute(card.dataset.navigationScope);
    });

    manualRouteOptions?.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-undo-instant]')) {
            undoInstantArrival();
            return;
        }
        const option = event.target?.closest?.('[data-manual-route-id]');
        if (option) selectManualRoute(option.dataset.manualRouteId);
    });

    manualTravelers?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-traveler-index]');
        if (!button || !['preview', 'confirming'].includes(manualFlow.phase)) return;
        const index = Number(button.dataset.travelerIndex);
        const traveler = manualFlow.travelers?.[index];
        if (!traveler) return;
        traveler.selected = traveler.selected === false;
        renderTravelerPicker();
        if (manualFlow.phase === 'confirming') showInstantConfirmation();
    });

    movePartyButton?.addEventListener('click', startManualFlow);
    cancelPartyJourneyButton?.addEventListener('click', () => {
        if (cancelPartyJourneyButton.dataset.manualAction === 'undo-instant') undoInstantArrival();
        else cancelActiveManualJourney();
    });
    manualRouteCancel?.addEventListener('click', () => {
        if (manualFlow.phase === 'established') cancelActiveManualJourney();
        else cancelManualFlow();
    });
    manualPlanButton?.addEventListener('click', () => commitManualRoute('planned'));
    manualInstantButton?.addEventListener('click', showInstantConfirmation);
    manualInstantConfirmButton?.addEventListener('click', () => commitManualRoute('instant'));
    manualInstantBackButton?.addEventListener('click', () => {
        setManualFlowPhase('preview');
        if (manualRouteTitle) manualRouteTitle.textContent = manualFlow.target?.name || 'Selected destination';
    });
    manualMovementToggle?.addEventListener('change', async () => {
        const desired = manualMovementToggle.checked;
        manualMovementToggle.disabled = true;
        setManualStatus('Saving project movement policy...');
        try {
            const response = await requestSocket('vn-location-set-movement-lock', {
                enabled: desired,
                turnNumber: context.state.currentVN?.turnNumber,
                dialogueIndex: context.state.currentIndex
            });
            if (lastBundle) lastBundle.movementPolicy = { ...(lastBundle.movementPolicy || {}), ...(response.policy || {}) };
            if (lastBundle) renderManualControls(lastBundle);
            setManualStatus('Movement policy saved.');
        } catch (error) {
            manualMovementToggle.checked = !desired;
            if (lastBundle) {
                lastBundle.movementPolicy = { ...(lastBundle.movementPolicy || {}), manual_movement_only: !desired };
                renderManualControls(lastBundle);
            }
            setManualStatus(error.message, true);
        } finally {
            manualMovementToggle.disabled = lastBundle?.movementPolicy?.controls_enabled !== true;
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && container?.classList.contains('expanded')) {
            event.preventDefault();
            if (manualFlow.phase === 'established') {
                setExpandedState(false);
                expandToggle?.focus();
            } else if (manualFlow.phase !== 'idle') {
                cancelManualFlow();
            } else {
                setExpandedState(false);
                expandToggle?.focus();
            }
        }
    });

    socket?.on('vn-location-set-movement-lock-response', handleSocketResponse);
    socket?.on('vn-location-preview-manual-move-response', handleSocketResponse);
    socket?.on('vn-location-commit-manual-move-response', handleSocketResponse);
    socket?.on('vn-location-cancel-manual-move-response', handleSocketResponse);
    socket?.on('vn-location-cancel-manual-order-response', handleSocketResponse);
    socket?.on('vn-location-undo-instant-arrival-response', handleSocketResponse);

    socket?.on('vn-location-data-bundle', (bundle) => {
        if (!bundle || !mapDiv) return;
        debugLog('World Location [HUD]: Received bundle', bundle);
        const hasMap = isMapAvailable(bundle);
        setHudVisibilityByMapAvailability(hasMap);
        if (!hasMap) {
            lastBundle = bundle;
            return;
        }

        applyHudShape(bundle?.hudConfig?.shape);
        syncUndeterminedLocationNotice(bundle);

        if (bundle?.navigation?.manual_order?.mode === 'instant'
            && bundle.navigation.manual_order.status === 'completed') {
            manualFlow.committedOrder = bundle.navigation.manual_order;
        }

        if (manualFlow.phase === 'success' && (bundle?.navigation?.manual_order?.route?.corridor || []).length >= 2) {
            clearManualPreviewLayers();
        }

        const shouldReinit = !lastBundle
            || lastBundle.mapImage !== bundle.mapImage
            || lastBundle.isTiled !== bundle.isTiled
            || lastBundle.tileUrl !== bundle.tileUrl;

        if (shouldReinit) {
            initMainMap(bundle);
        } else if (mainMap) {
            if (hasDeterminedLocation(bundle)) {
                const pos = toMapLatLng(mainMapMeta, bundle.currentLocation.x, bundle.currentLocation.y);
                if (mainPartyMarker) {
                    mainPartyMarker.setLatLng(pos);
                } else {
                    mainPartyMarker = L.marker(pos, {
                        icon: L.divIcon({ className: 'party-marker', html: '<div class="party-marker-icon"></div>', iconSize: [24, 32], iconAnchor: [12, 32] })
                    }).addTo(mainMap);
                    if (container.classList.contains('expanded')) {
                        mainMap.setView(pos, Math.max(0, mainMapMeta.maxZoom - 1));
                    }
                }
            } else if (mainPartyMarker) {
                mainPartyMarker.remove();
                mainPartyMarker = null;
            }

            refreshCharacterMarkersForMode(bundle);
            syncTransitRouteLayers(bundle);
            renderSmartLabels(bundle);
            if (!container.classList.contains('expanded')) {
                updateCompactAutoZoom(bundle);
            }
        }

        renderLocationPanel(bundle);
        renderManualControls(bundle);
        renderManualOrderBanner(bundle);
        lastBundle = bundle;
        renderPersistedManualPlan(bundle);
    });

    socket?.on('character-sheets-loaded', () => {
        debugLog('World Location [HUD]: Character sheets loaded, refreshing...');
        setTimeout(fetchData, 1000);
    });

    socket?.on('vn-location-map-ready', () => fetchLatestData());
    socket?.on('vn-location-force-refresh', () => fetchLatestData());
    socket?.on('vn-processing-complete', (data) => fetchLatestData(data?.turnNumber));
    socket?.on('chat-db-switched', () => {
        cancelManualFlow(false);
        clearManualOrderNotice();
        setExpandedState(false);
        lastBundle = null;
        setHudVisibilityByMapAvailability(false);
        fetchData(null, context.state.currentIndex);
    });
    socket?.on('project-ready', () => {
        cancelManualFlow(false);
        clearManualOrderNotice();
        setExpandedState(false);
        lastBundle = null;
        setHudVisibilityByMapAvailability(false);
        fetchData(null, context.state.currentIndex);
    });

    window.addEventListener('vn:ui-visibility-toggled', (e) => {
        const { show } = e.detail;
        if (show) {
            setHudVisibilityByMapAvailability(hasVisibleMap);
            scheduleMainMapLayoutSync(lastBundle);
        }
    });

    window.addEventListener('vn:intro-visibility-changed', (event) => {
        if (event.detail?.visible === false) scheduleMainMapLayoutSync(lastBundle);
    });

    window.addEventListener('vn:hud-ready', () => {
        if (registerHudPanel()) {
            setHudVisibilityByMapAvailability(hasVisibleMap);
            scheduleMainMapLayoutSync(lastBundle);
        }
    });

    socket?.on('execute-frontend-hook', (data) => {
        if (data.hookName === 'HOOK_VN_GUI_READY') fetchData(data.turnNumber, context.state.currentIndex);
    });
    window.addEventListener('vn:dialogue-enter', (event) => {
        const dialogueIndex = Number(event?.detail?.dialogueIndex);
        fetchData(null, Number.isInteger(dialogueIndex) ? dialogueIndex : null);
    });

    if (mapDiv && typeof ResizeObserver === 'function') {
        mapResizeObserver = new ResizeObserver(() => scheduleMainMapLayoutSync(lastBundle));
        mapResizeObserver.observe(mapDiv);
    }

    window.addEventListener('beforeunload', () => {
        mapResizeObserver?.disconnect();
        if (mapLayoutSyncFrame !== null) cancelAnimationFrame(mapLayoutSyncFrame);
    }, { once: true });

    (() => {
        registerHudPanel();
        setHudVisibilityByMapAvailability(false);
        if (hudRegistered) fetchData(null, context.state.currentIndex);
    })();
})();
