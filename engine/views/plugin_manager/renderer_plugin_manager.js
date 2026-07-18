// renderer_plugin_manager.js - The file for plugin_manager.html

const socket = io('http://localhost:14541');

let currentViewMode = 'grid'; // Default view mode
let isExperimentalExpanded = true; // Default expanded state
let isProcessingToggle = false; // Prevents race conditions during settings sync

let searchQuery = '';
let activeStatus = 'all';
let activeCategory = 'all';
let allPluginsData = []; // Cache for filtering
let pluginMetadataRefreshTimer = null;

function normalizePluginViewMode(mode) {
    return mode === 'list' ? 'list' : 'grid';
}

const PLUGIN_CATEGORIES = Object.freeze([
    'Narrative',
    'Characters',
    'World',
    'Gameplay',
    'Visual',
    'Audio',
    'Utility',
    'Uncategorized'
]);
const PLUGIN_CATEGORY_LOOKUP = new Map(
    PLUGIN_CATEGORIES.map(category => [category.toLowerCase(), category])
);

function normalizePluginCategory(category) {
    const categoryKey = typeof category === 'string' ? category.trim().toLowerCase() : '';
    return PLUGIN_CATEGORY_LOOKUP.get(categoryKey) || 'Uncategorized';
}

/* --- METRIC DEFINITIONS --- */
const METRIC_DESCRIPTIONS = {
    narrative_impact: {
        Low: {
            label: "Ambient Flavor",
            tooltip: "Provides subtle context hints to the AI. Helps ground the scene (e.g., weather awareness, basic location) but rarely alters the direction of the plot."
        },
        Medium: {
            label: "Consistent Influence",
            tooltip: "Actively tracks and enforces background continuity (e.g., inventory, shifting personality traits). It ensures long-term realism without dictating the immediate action."
        },
        High: {
            label: "Core Plot Driver",
            tooltip: "Directly affectsstory decisions, relationship arcs, pacing or helps keeping high-quality continuity and immersion to the story. This plugin fundamentally changes how the quality of the AI writing the story."
        }
    },

    immersion: {
        Low: {
            label: "Under the Hood",
            tooltip: "Operates invisibly in the background. Does not generate new UI elements, graphics, or sounds for the player to experience directly."
        },
        Medium: {
            label: "GUI Enhancement",
            tooltip: "Adds noticeable polish to the experience, such as dynamic UI widgets, ambient soundscapes, or basic visual state updates."
        },
        High: {
            label: "Cinematic Presence",
            tooltip: "Takes over the screen. Drives full-screen WebGL shaders, synchronized camera movements, custom HUDs, or heavy audio-visual experiences."
        }
    },

    cost: {
        Low: {
            label: "Negligible (Many fractions of a cent)",
            tooltip: "Executes tiny, highly-optimized prompts on cheap, fast LLMs. Can be left on permanently without budget concerns. Requires many calls, sometimes hundreds, to reach a noticeable cost of a single cent."
        },
        Medium: {
            label: "Moderate (A cent or less per turn)",
            tooltip: "Requires a dedicated LLM call or processes medium-sized context windows (e.g., summarizing recent events or extracting complex state data)."
        },
        High: {
            label: "Premium (Noticeable API spend)",
            tooltip: "Executes dense, multi-step reasoning, requires massive context windows, utilizes expensive top-tier models or runs frequently."
        }
    },

    latency: {
        Low: {
            label: "Instant (Local/Async)",
            tooltip: "Executes in milliseconds or runs entirely in the background while you read. Adds zero noticeable waiting time to the critical generation path."
        },
        Medium: {
            label: "Brief Pause (5s to 30s)",
            tooltip: "Requires the main engine to wait for a specific calculation, database query, or fast API response before the scene can finish rendering."
        },
        High: {
            label: "Sequential Block (30s to 3m)",
            tooltip: "Forces the engine to halt while it performs heavy lifting (e.g., waiting for Text-to-Speech audio, complex image generation, or deep RAG extraction)."
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Plugin Manager] Loaded');

    const refreshBtn = document.getElementById('refresh-plugins-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log('[Plugin Manager] Refreshing plugins...');
            loadPlugins();
        });
    }

    document.querySelectorAll('[data-view-mode]').forEach(button => {
        button.addEventListener('click', () => {
            currentViewMode = button.dataset.viewMode;
            updateViewUI();
            renderPlugins(allPluginsData);
            saveViewSettings();
        });
    });

    const restartBtn = document.getElementById('restart-app-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            console.log('[Plugin Manager] Requesting app restart...');
            socket.emit('restart-app');
        });
    }

    const experimentalHeader = document.getElementById('experimental-header');
    if (experimentalHeader) {
        experimentalHeader.addEventListener('click', () => {
            isExperimentalExpanded = !isExperimentalExpanded;
            updateViewUI();
            saveViewSettings();
        });
    }

    // Search and Filters Event Listeners
    const searchInput = document.getElementById('plugin-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderPlugins(allPluginsData);
            saveViewSettings();
        });
    }

    const clearSearchBtn = document.getElementById('clear-search');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchQuery = '';
                renderPlugins(allPluginsData);
                saveViewSettings();
            }
        });
    }

    const statusFilters = document.getElementById('status-filters');
    if (statusFilters) {
        statusFilters.querySelectorAll('.toggle-item').forEach(btn => {
            btn.addEventListener('click', () => {
                statusFilters.querySelectorAll('.toggle-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeStatus = btn.dataset.status;
                renderPlugins(allPluginsData);
                saveViewSettings();
            });
        });
    }

    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) {
        categoryFilters.querySelectorAll('.chip').forEach(btn => {
            btn.addEventListener('click', () => {
                categoryFilters.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeCategory = btn.dataset.category;
                renderPlugins(allPluginsData);
                saveViewSettings();
            });
        });
    }

    // Modal instance tracking
    window.currentModalInstance = null;

    // Listen for settings responses
    socket.on('get-global-settings-response', (response) => {
        if (isProcessingToggle) return; // Skip update if we are currently saving a toggle

        if (response && response.success && response.settings && response.settings.visual_novel?.settings) {
            const vns = response.settings.visual_novel.settings;
            const expanded = vns.interface?.experimental_plugins_expanded !== undefined
                ? vns.interface.experimental_plugins_expanded
                : true;

            const savedSearch = vns.interface?.plugin_search_query || '';
            const savedStatus = vns.interface?.plugin_status_filter || 'all';
            const savedCategory = vns.interface?.plugin_category_filter || 'all';
            const savedMode = vns.interface?.plugin_manager_view_mode || currentViewMode;

            currentViewMode = normalizePluginViewMode(savedMode);

            isExperimentalExpanded = expanded;
            searchQuery = savedSearch.toLowerCase();
            activeStatus = savedStatus;
            activeCategory = savedCategory === 'all'
                ? 'all'
                : normalizePluginCategory(savedCategory);

            // Update UI to reflect saved state
            const searchInput = document.getElementById('plugin-search');
            if (searchInput) searchInput.value = savedSearch;

            const statusFilters = document.getElementById('status-filters');
            if (statusFilters) {
                statusFilters.querySelectorAll('.toggle-item').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.status === activeStatus);
                });
            }

            const categoryFilters = document.getElementById('category-filters');
            if (categoryFilters) {
                categoryFilters.querySelectorAll('.chip').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.category === activeCategory);
                });
            }

            updateViewUI();
            if (allPluginsData.length > 0) renderPlugins(allPluginsData);
        }
    });

    loadViewSettings();
    initializeHotSettingsRefresh();
    initializeHomeDeepLinks();
    loadPlugins();
});

function getPluginDependencyId(dependency) {
    return typeof dependency === 'string' ? dependency : dependency?.id;
}

function initializeHotSettingsRefresh() {
    socket.on('global-setting-updated', ({ path }) => {
        if (isProviderRoutingPath(path)) {
            schedulePluginMetadataRefresh();
        }
    });

    socket.on('vn-settings-updated', (settings) => {
        if (settings && settings.plugins) {
            schedulePluginMetadataRefresh();
        }
    });
}

function isProviderRoutingPath(path) {
    return typeof path === 'string' && path.startsWith('infrastructure.providers');
}

function schedulePluginMetadataRefresh() {
    if (pluginMetadataRefreshTimer) clearTimeout(pluginMetadataRefreshTimer);
    pluginMetadataRefreshTimer = setTimeout(() => {
        pluginMetadataRefreshTimer = null;
        loadPlugins();
    }, 150);
}

function initializeHomeDeepLinks() {
    socket.on('plugin-manager:open-settings', (payload = {}) => {
        const pluginId = payload.pluginId || payload.id;
        if (!pluginId) return;

        socket.emit('get-plugins', {}, (plugins) => {
            allPluginsData = plugins || [];
            renderPlugins(allPluginsData);

            const plugin = allPluginsData.find(p => p.id === pluginId);
            if (!plugin) {
                Modals.alert('Plugin Not Found', `Could not find plugin "${pluginId}".`);
                return;
            }

            if (!plugin.settingsSchema || Object.keys(plugin.settingsSchema).length === 0) {
                Modals.alert('No Settings', `${plugin.name || plugin.id} does not expose configurable settings.`);
                return;
            }

            if (!plugin.enabled) {
                showEnableToConfigureModal(plugin);
                return;
            }

            openSettingsModal(plugin);
        });
    });
}

/**
 * Updates the UI based on the current view mode.
 */
function updateViewUI() {
    const pluginList = document.getElementById('plugin-list');
    const experimentalList = document.getElementById('test-plugin-list');
    const experimentalSection = document.querySelector('.experimental-section');

    if (!pluginList) return;

    currentViewMode = normalizePluginViewMode(currentViewMode);
    [pluginList, experimentalList].filter(Boolean).forEach(list => {
        list.classList.toggle('list-view', currentViewMode === 'list');
        list.classList.toggle('grid-view', currentViewMode === 'grid');
    });
    document.querySelectorAll('[data-view-mode]').forEach(button => button.classList.toggle('active', button.dataset.viewMode === currentViewMode));
    // Apply Expanded/Collapsed State
    if (experimentalSection) {
        if (isExperimentalExpanded) {
            experimentalSection.classList.remove('collapsed');
        } else {
            experimentalSection.classList.add('collapsed');
        }
    }
}

/**
 * Shows the restart warning banner and button.
 */
function showRestartWarning() {
    const banner = document.getElementById('restart-banner');
    const btn = document.getElementById('restart-app-btn');
    if (banner) banner.classList.remove('hidden');
    if (btn) btn.classList.remove('hidden');
}

/**
 * Loads the view settings from the backend.
 */
function loadViewSettings() {
    socket.emit('get-global-settings', {});
}

/**
 * Saves the current view mode to the backend.
 */
function saveViewSettings() {
    isProcessingToggle = true;

    // Fetch latest settings first to avoid overwriting other global settings
    socket.once('get-global-settings-response', (response) => {
        const vns = (response && response.success && response.settings && response.settings.visual_novel?.settings)
            ? response.settings.visual_novel.settings
            : {};

        // Ensure interface block exists
        if (!vns.interface) vns.interface = {};
        vns.interface.plugin_manager_view_mode = currentViewMode;
        vns.interface.experimental_plugins_expanded = isExperimentalExpanded;
        vns.interface.plugin_search_query = searchQuery;
        vns.interface.plugin_status_filter = activeStatus;
        vns.interface.plugin_category_filter = activeCategory;

        // Save back to the visual_novel.settings block
        socket.emit('save-vn-settings', { vnSettings: vns });

        // Keep the lock for a short duration to allow the save to propagate
        setTimeout(() => {
            isProcessingToggle = false;
        }, 500);
    });

    socket.emit('get-global-settings', {});
}

let currentEditingPluginId = null;

/**
 * Loads the list of plugins from the backend.
 */
function loadPlugins() {
    const pluginList = document.getElementById('plugin-list');
    if (!pluginList) return;

    pluginList.innerHTML = '<p style="color: #aaa;">Loading plugins...</p>';

    socket.emit('get-plugins', {}, (plugins) => {
        console.log('[Plugin Manager] Received plugins:', plugins);
        allPluginsData = Array.isArray(plugins)
            ? plugins.map(plugin => ({
                ...plugin,
                category: normalizePluginCategory(plugin.category)
            }))
            : [];
        renderPlugins(allPluginsData);
    });
}

function renderPlugins(plugins) {
    const pluginList = document.getElementById('plugin-list');
    const testPluginList = document.getElementById('test-plugin-list');
    const experimentalSection = document.querySelector('.experimental-section');

    if (!pluginList) return;

    pluginList.innerHTML = '';
    if (testPluginList) testPluginList.innerHTML = '';
    if (experimentalSection) experimentalSection.style.display = 'none';

    if (!plugins || plugins.length === 0) {
        pluginList.innerHTML = '<p style="color: #aaa;">No plugins found.</p>';
        return;
    }

    // Apply Filters
    const filteredPlugins = plugins.filter(plugin => {
        // Search Filter
        const searchMatch = !searchQuery ||
            plugin.name.toLowerCase().includes(searchQuery) ||
            plugin.id.toLowerCase().includes(searchQuery) ||
            (plugin.author && plugin.author.toLowerCase().includes(searchQuery)) ||
            (plugin.description && plugin.description.toLowerCase().includes(searchQuery));

        if (!searchMatch) return false;

        // Status Filter
        if (activeStatus === 'active' && !plugin.enabled) return false;
        if (activeStatus === 'disabled' && plugin.enabled) return false;

        // Category Filter
        if (activeCategory !== 'all' && plugin.category !== activeCategory) return false;

        return true;
    });

    if (filteredPlugins.length === 0) {
        pluginList.innerHTML = '<div class="no-results">No plugins match your current filters.</div>';
        return;
    }

    let standardCount = 0;
    let experimentalCount = 0;

    filteredPlugins.forEach(plugin => {
        const item = document.createElement('div');
        item.className = `plugin-item ${!plugin.enabled ? 'is-disabled' : ''}`;

        const hasSettings = plugin.settingsSchema && Object.keys(plugin.settingsSchema).length > 0;

        // Calculate if blocked
        let isBlocked = false;
        let missingDeps = [];
        if (plugin.dependencies && plugin.dependencies.length > 0) {
            missingDeps = plugin.dependencies
                .map(getPluginDependencyId)
                .filter(depId => depId && !plugins.find(p => p.id === depId && p.enabled));
            isBlocked = missingDeps.length > 0;
        }

        let depsHtml = '';
        if ((plugin.dependencies && plugin.dependencies.length > 0) || (plugin.optionalDependencies && plugin.optionalDependencies.length > 0)) {
            depsHtml = '<div class="plugin-dependencies" style="margin-top: 8px; font-size: 0.75em; display: flex; flex-wrap: wrap; gap: 5px;">';

            if (plugin.dependencies && plugin.dependencies.length > 0) {
                plugin.dependencies.forEach(dependency => {
                    const depId = getPluginDependencyId(dependency);
                    const isSatisfied = plugins.find(p => p.id === depId && p.enabled);
                    depsHtml += `<span class="dep-tag hard-dep ${isSatisfied ? 'satisfied' : 'missing'}" 
                        title="${dependency?.reason || `Hard Dependency: ${isSatisfied ? 'Satisfied' : 'MISSING (Activation Blocked)'}`}">
                        REQ: ${depId}
                    </span>`;
                });
            }

            if (plugin.optionalDependencies && plugin.optionalDependencies.length > 0) {
                plugin.optionalDependencies.forEach(dependency => {
                    const depId = getPluginDependencyId(dependency);
                    const isActive = plugins.find(p => p.id === depId && p.enabled);
                    depsHtml += `<span class="dep-tag soft-dep ${isActive ? 'active' : 'inactive'}" 
                        title="${dependency?.reason || `Optional Integration: ${isActive ? 'Active' : 'Not currently active'}`}">
                        OPT: ${depId}
                    </span>`;
                });
            }

            depsHtml += '</div>';
        }

        let metricsHtml = '';
        if (plugin.settingsSchema && plugin.settingsSchema.PLUGIN_METRICS) {
            const m = plugin.settingsSchema.PLUGIN_METRICS;
            const metrics = [
                { key: 'narrative_impact', label: 'Impact', icon: '🎭' },
                { key: 'immersion', label: 'Immersion', icon: '🕯️' },
                { key: 'cost', label: 'Cost', icon: '💰' },
                { key: 'latency', label: 'Latency', icon: '⚡' }
            ];

            metricsHtml = '<div class="plugin-metrics">';
            metrics.forEach(metric => {
                const val = m[metric.key] || 'None';
                if (val === 'None') return;

                const desc = METRIC_DESCRIPTIONS[metric.key]?.[val] || '';
                const descText = typeof desc === 'object' ? `${desc.label ? `${desc.label}: ` : ''}${desc.tooltip || ''}` : desc;
                const tooltip = `${metric.label}: ${val}${descText ? ` — ${descText}` : ''}`;

                metricsHtml += `
                    <div class="metric-badge m-${val.toLowerCase()}" title="${tooltip}">
                        <span class="metric-icon">${metric.icon}</span>
                        <span class="metric-val">${val}</span>
                    </div>
                `;
            });
            metricsHtml += '</div>';
        }

        const basePath = plugin.enabled
            ? `../../plugins/${plugin.id}/`
            : `../../plugins/disabled/${plugin.id}/`;
        const screenshots = plugin.screenshots || [];
        const primaryPreviewUrl = screenshots.length
            ? window.resolvePluginPreviewUrl(screenshots[0].url)
            : '';
        const previewHtml = currentViewMode === 'grid' && screenshots.length
            ? `<button class="plugin-grid-preview" type="button" aria-label="View ${plugin.name} previews"><img src="${primaryPreviewUrl}" alt="${plugin.name} preview" loading="lazy"><span>${screenshots.length} preview${screenshots.length === 1 ? '' : 's'}</span></button>`
            : `<div class="plugin-thumbnail-wrapper ${!plugin.enabled ? 'is-disabled' : ''}"><img src="${basePath}icon.webp" alt="${plugin.name}" class="plugin-thumbnail" onerror="if(this.src.endsWith('.webp')){this.src='${basePath}icon.png'}else{this.parentElement.style.display='none'}"></div>`;

        item.innerHTML = `
            ${previewHtml}
            <div class="plugin-info-main">
                <div class="plugin-title">
                    <span>${plugin.name}</span>
                    <span class="plugin-version">v${plugin.version}</span>
                </div>
                <div class="plugin-author ${plugin.author === 'Fablekin Core' ? 'author-core' : ''}">
                    by ${plugin.author || 'Unknown Author'}
                </div>
                <div class="plugin-id-label">ID: ${plugin.id}</div>
                <div class="plugin-description">${plugin.description}</div>
                ${metricsHtml}
                ${depsHtml}
            </div>
            <div class="plugin-footer">
                <div class="plugin-actions">
                    <button class="btn-base btn-sm status-btn ${plugin.enabled ? 'status-active' : (isBlocked ? 'status-blocked' : 'status-disabled')} ${isBlocked && !plugin.enabled ? 'is-blocked' : ''}" 
                        data-id="${plugin.id}" 
                        title="${isBlocked && !plugin.enabled ? 'Activation Blocked: Missing Requirements' : `Click to ${plugin.enabled ? 'Disable' : 'Enable'}`}">
                        ${plugin.enabled ? 'Active' : (isBlocked ? 'Inactive' : 'Disabled')}
                    </button>
                    ${hasSettings ? `<button class="btn-base btn-secondary btn-sm settings-btn" title="Configure Plugin Settings">Settings</button>` : ''}
                    ${screenshots.length ? `<button class="btn-base btn-secondary btn-sm previews-btn" title="View plugin previews">Previews</button>` : ''}
                </div>
                ${isBlocked && !plugin.enabled ? `<span class="blocked-warning" title="Missing: ${missingDeps.join(', ')}">⚠️ Blocked</span>` : ''}
            </div>
        `;

        const statusBtn = item.querySelector('.status-btn');
        statusBtn.addEventListener('click', () => {
            if (isBlocked && !plugin.enabled) return;
            togglePlugin(plugin.id);
        });

        item.querySelector('.plugin-grid-preview')?.addEventListener('click', () => window.PluginPreviewGallery?.open(plugin));
        item.querySelector('.previews-btn')?.addEventListener('click', () => window.PluginPreviewGallery?.open(plugin));

        if (hasSettings) {
            const settingsBtn = item.querySelector('.settings-btn');
            settingsBtn.addEventListener('click', () => {
                if (!plugin.enabled) {
                    showEnableToConfigureModal(plugin);
                    return;
                }

                openSettingsModal(plugin);
            });
        }

        if (plugin.isDeveloperPlugin && testPluginList) {
            testPluginList.appendChild(item);
            if (experimentalSection) experimentalSection.style.display = 'block';
            experimentalCount++;
        } else {
            pluginList.appendChild(item);
            standardCount++;
        }
    });

    // Handle empty filtered states for both sections
    if (standardCount === 0 && filteredPlugins.length > 0) {
        pluginList.innerHTML = '<div class="no-results">No standard plugins match these filters.</div>';
    }

    if (experimentalCount === 0 && experimentalSection && experimentalSection.style.display === 'block') {
        // This case is unlikely given the logic above, but good for safety
        testPluginList.innerHTML = '<div class="no-results">No experimental plugins match these filters.</div>';
    }
}

function showEnableToConfigureModal(plugin) {
    Modals.alert(
        'Enable plugin to change settings',
        `${plugin.name || 'This plugin'} is disabled. Enable it first to change its settings.`
    );
}

/**
 * Opens the settings modal for a specific plugin.
 * @param {Object} plugin 
 */
function openSettingsModal(plugin) {
    currentEditingPluginId = plugin.id;
    const content = document.getElementById('settings-modal-content');
    const formEl = document.getElementById('settings-form');
    const saveBtn = document.getElementById('save-settings');
    const cancelBtn = document.getElementById('cancel-settings');

    formEl.innerHTML = ''; // Clear existing

    if (plugin.screenshots?.length) {
        const previewsButton = document.createElement('button');
        previewsButton.type = 'button';
        previewsButton.className = 'btn-base btn-secondary plugin-settings-previews';
        previewsButton.textContent = `View Previews (${plugin.screenshots.length})`;
        previewsButton.addEventListener('click', () => window.PluginPreviewGallery?.open(plugin));
        formEl.appendChild(previewsButton);
    }

    // Generate Form
    Object.entries(plugin.settingsSchema).forEach(([key, schema]) => {
        if (key === 'PLUGIN_METRICS') return; // Hide metrics from settings form

        const currentVal = (plugin.settings && plugin.settings[key] !== undefined)
            ? plugin.settings[key]
            : (schema.default !== undefined ? schema.default : '');

        const group = document.createElement('div');
        group.className = 'form-group';
        if (schema.type === 'checkbox') group.classList.add('checkbox-group');
        if (schema.type === 'header') group.classList.add('header-group');
        if (schema.type === 'description') group.classList.add('description-group');

        let input;
        if (schema.type === 'header') {
            const header = document.createElement('div');
            header.className = 'settings-header';
            header.textContent = schema.label || schema.content || key;
            group.appendChild(header);
        } else if (schema.type === 'description') {
            const desc = document.createElement('div');
            desc.className = 'settings-description-block';
            desc.style.whiteSpace = 'pre-wrap'; // Preserve formatting
            desc.textContent = schema.content || schema.label || '';
            group.appendChild(desc);
        } else if (schema.type === 'checkbox') {
            // Checkbox: Input FIRST, then a wrapper for Label + Description
            const checkboxId = `setting-${plugin.id}-${key}`;

            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = checkboxId;
            input.checked = !!currentVal;
            input.dataset.key = key;
            input.dataset.type = schema.type;
            group.appendChild(input);

            const labelWrapper = document.createElement('div');
            labelWrapper.className = 'checkbox-text-content';

            const label = document.createElement('label');
            label.setAttribute('for', checkboxId);
            label.textContent = schema.label || key;
            labelWrapper.appendChild(label);

            if (schema.description) {
                const desc = document.createElement('div');
                desc.className = 'description';
                desc.textContent = schema.description;
                labelWrapper.appendChild(desc);
            }
            group.appendChild(labelWrapper);
            
            // Make the entire group clickable for better UX
            group.addEventListener('click', (e) => {
                if (e.target !== input) {
                    e.preventDefault();
                    input.checked = !input.checked;
                    // Note: 'change' event might be needed if we add listeners to inputs later, 
                    // but saveCurrentSettings currently reads values on Save button click.
                }
            });
        } else {
            // Default: Label FIRST, then Input
            const label = document.createElement('label');
            label.textContent = schema.label || key;
            group.appendChild(label);

            if (schema.description) {
                const desc = document.createElement('div');
                desc.className = 'description';
                desc.textContent = schema.description;
                group.appendChild(desc);
            }

            if (schema.type === 'select') {
                input = document.createElement('select');
                input.className = 'premium-select';
                const options = Array.isArray(schema.options) ? schema.options : [];
                options.forEach(opt => {
                    const o = document.createElement('option');
                    const isObj = typeof opt === 'object' && opt !== null;

                    let val = isObj ? (opt.value !== undefined ? opt.value : opt.label) : opt;
                    const label = isObj ? (opt.label !== undefined ? opt.label : opt.value) : opt;

                    if (typeof val === 'object' && val !== null) {
                        o.value = JSON.stringify(val);
                    } else {
                        o.value = val;
                    }

                    o.textContent = label;
                    if (isObj && opt.disabled === true) o.disabled = true;
                    if (isObj && opt.description) o.dataset.description = opt.description;

                    const compareVal = (typeof currentVal === 'object' && currentVal !== null) ? JSON.stringify(currentVal) : currentVal;
                    if (o.value == compareVal) o.selected = true;

                    input.appendChild(o);
                });
            } else if (schema.type === 'number') {
                input = document.createElement('input');
                input.type = 'number';
                input.value = currentVal;
                if (schema.min !== undefined) input.min = schema.min;
                if (schema.max !== undefined) input.max = schema.max;
            } else if (schema.type === 'secret') {
                const wrapper = document.createElement('div');
                wrapper.className = 'secret-input-wrapper';

                input = document.createElement('input');
                input.type = 'password';
                input.value = currentVal;
                input.dataset.key = key;
                input.dataset.type = schema.type;
                wrapper.appendChild(input);
                group.appendChild(wrapper);
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.value = currentVal;
            }

            if (schema.type !== 'secret') {
                input.dataset.key = key;
                input.dataset.type = schema.type;
                group.appendChild(input);
            }
        }

        formEl.appendChild(group);
    });

    // Initialize custom selects in the form
    PremiumSelect.initAll(formEl);

    // Re-attach listeners (safe since we clone or just use existing)
    saveBtn.onclick = saveCurrentSettings;
    cancelBtn.onclick = () => window.currentModalInstance.close();

    window.currentModalInstance = Modals.show({
        title: `Settings: ${plugin.name}`,
        content: content,
        buttons: []
    });
}

/**
 * Collects and saves the settings from the modal.
 */
function saveCurrentSettings() {
    if (!currentEditingPluginId) return;

    const formEl = document.getElementById('settings-form');
    const inputs = formEl.querySelectorAll('input, select');
    const newSettings = {};

    inputs.forEach(input => {
        const key = input.dataset.key;
        const type = input.dataset.type;
        let val;

        if (type === 'checkbox') {
            val = input.checked;
        } else if (type === 'number') {
            val = parseFloat(input.value);
        } else {
            val = input.value;
            // Attempt to parse JSON if it looks like an object
            if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                try {
                    val = JSON.parse(val);
                } catch {
                    // Not valid JSON, keep as string
                }
            }
        }
        newSettings[key] = val;
    });

    console.log(`[Plugin Manager] Saving settings for ${currentEditingPluginId}:`, newSettings);

    socket.emit('save-plugin-settings', {
        pluginId: currentEditingPluginId,
        settings: newSettings
    }, (response) => {
        if (response && response.success) {
            console.log('[Plugin Manager] Settings saved successfully');
            if (window.currentModalInstance) window.currentModalInstance.close();
            loadPlugins(); // Refresh list to update internal state
        } else {
            Modals.alert('Error', `Failed to save settings: ${response ? response.error : 'Unknown error'}`);
        }
    });
}

/**
 * Toggles a plugin's status on the backend.
 * @param {string} pluginId 
 */
function togglePlugin(pluginId) {
    console.log(`[Plugin Manager] Toggling plugin: ${pluginId}`);
    socket.emit('toggle-plugin-status', { pluginId }, (response) => {
        if (response && response.success) {
            console.log(`[Plugin Manager] Successfully toggled plugin: ${pluginId}`);
            showRestartWarning();
            loadPlugins(); // Refresh the list
        } else {
            console.error(`[Plugin Manager] Failed to toggle plugin ${pluginId}:`, response ? response.error : 'Unknown error');
            Modals.alert('Error', `Failed to toggle plugin: ${response ? response.error : 'Unknown error'}`);
        }
    });
}

