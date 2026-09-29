const socket = io('http://localhost:14541');

document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeThemeSelection();
    initializeGlobalSettings();
    initializeProviderSettings();
    initializeDynamicBindings();
    initializeMemoryLodSimulator();
    initializeSyncAction();
    initializePluginAudit();
    initializeHomeDeepLinks();
});

/**
 * Handles switching between different settings tabs.
 */
function initializeTabs() {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const tabContents = document.querySelectorAll('.tab-content');

    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');

            // Update active sidebar item
            sidebarItems.forEach(si => si.classList.remove('active'));
            item.classList.add('active');

            // Update active tab content
            tabContents.forEach(tc => tc.classList.remove('active'));
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
}

function initializeHomeDeepLinks() {
    socket.on('settings-manager:open-section', (payload = {}) => {
        const requestedTab = payload.tab || payload.section || 'providers';
        const sidebarItem = document.querySelector(`.sidebar-item[data-tab="${requestedTab}"]`);
        if (sidebarItem) {
            sidebarItem.click();
        }

        if (payload.path) {
            setTimeout(() => focusSettingsPath(payload.path), 120);
        }
    });
}

function focusSettingsPath(path) {
    const target = document.querySelector(`[data-settings-path="${path}"]`)
        || document.querySelector(`[data-focus-path="${path}"]`);
    if (!target) return;

    const group = target.closest('.form-group') || target;
    group.classList.add('home-deeplink-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof target.focus === 'function' && !target.readOnly) {
        target.focus({ preventScroll: true });
    }

    setTimeout(() => group.classList.remove('home-deeplink-highlight'), 2200);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function initializeThemeSelection() {
    const themeSelect = document.getElementById('theme-select');
    socket.emit('get-available-themes');
    socket.on('get-available-themes-response', (response) => {
        if (response && response.success) {
            themeSelect.innerHTML = '';
            response.themes.forEach(theme => {
                const option = document.createElement('option');
                option.value = theme;
                option.textContent = theme.replace('.css', '').charAt(0).toUpperCase() + theme.replace('.css', '').slice(1);
                themeSelect.appendChild(option);
            });
            PremiumSelect.initAll();
            socket.emit('get-global-settings');
        }
    });

    /* Handled by dynamic binding system via data-settings-path */
}

function syncThemeSelection(theme) {
    const themeSelect = document.getElementById('theme-select');
    if (!themeSelect || typeof theme !== 'string' || !theme) return;

    themeSelect.value = theme;
    themeSelect.__premiumSelect?.refreshOptions();
}

function initializeGlobalSettings() {
    socket.on('get-global-settings-response', (response) => {
        if (response && response.success && response.settings) {
            // Theme and other fields are now handled by populateDynamicBindings
            populateDynamicBindings(response.settings);
        }
    });

    socket.on('theme-updated', (data) => {
        if (data && data.theme) {
            syncThemeSelection(data.theme);
            applyTheme(data.theme);
        }
    });
}

function initializeProviderSettings() {
    const container = document.getElementById('provider-cards-container');

    const PROVIDERS = [
        { id: 'OPENROUTER_API_KEY', name: 'OpenRouter', description: 'Consolidated LLM access point for hundreds of models.' },
        { id: 'OPENAI_API_KEY', name: 'OpenAI', description: 'Official access for GPT-4o and O1 models.' },
        { id: 'ANTHROPIC_API_KEY', name: 'Anthropic', description: 'Official access for Claude 3.5 Sonnet / Opus.' },
        { id: 'GEMINI_API_KEY', name: 'Google Gemini', description: 'Official access for Gemini 1.5 Flash and Pro.' },
        { id: 'DEEPSEEK_API_KEY', name: 'DeepSeek', description: 'High-performance reasoning models.' },
        { id: 'NANO_GPT_API_KEY', name: 'NanoGPT', description: 'OpenAI-compatible gateway for multi-provider model access.' },
        { id: 'GENERIC_API_KEY', name: 'Generic (OpenAI-compatible)', description: 'Custom OpenAI-compatible endpoint. Set its Base URL under Models & Routing.' }
    ];

    // Request current status of keys
    socket.emit('get-provider-secrets');

    socket.on('get-provider-secrets-response', (response) => {
        if (response && response.success) {
            providerSecretStatuses = response.providersStatus || {};
            renderProviderItems(PROVIDERS, providerSecretStatuses, container);
            if (currentSettingsCache) renderModelAliasCards(currentSettingsCache);
        }
    });

    socket.on('save-provider-secret-response', (response) => {
        if (response && response.success) {
            socket.emit('get-provider-secrets');
            showNotify('Key safely encrypted and stored.', 'success');
        } else {
            showNotify('Failed to save secret: ' + response.error, 'error');
        }
    });

    const globalSaveBtn = document.getElementById('save-providers-btn');
    if (globalSaveBtn) {
        globalSaveBtn.addEventListener('click', () => {
            const inputs = document.querySelectorAll('.provider-key-input');
            let savedCount = 0;
            inputs.forEach(input => {
                const val = input.value.trim();
                const key = input.dataset.key;
                if (val) {
                    socket.emit('save-provider-secret', { key, value: val });
                    input.value = ''; // clear for security
                    input.type = 'password';
                    savedCount++;
                }
            });
            if (savedCount === 0) {
                if (window.showNotification) {
                    window.showNotification('No new keys were entered.', 'info');
                }
            }
        });
    }
}

function renderProviderItems(providers, statuses, container) {
    container.innerHTML = '';

    providers.forEach(p => {
        const isConfigured = statuses[p.id];
        
        const group = document.createElement('div');
        group.className = 'form-group';
        
        group.innerHTML = `
            <label>
                ${p.name} 
                <span class="provider-status ${isConfigured ? 'status-configured' : 'status-missing'}">
                    ${isConfigured ? 'Configured' : 'Missing'}
                </span>
            </label>
            <div class="description">${p.description}</div>
            <div class="secret-input-wrapper">
                <input type="password" class="premium-input provider-key-input" id="input-${p.id}" data-key="${p.id}"
                    placeholder="${isConfigured ? '••••••••••••••••' : 'Enter your API key'}">
            </div>
        `;

        container.appendChild(group);
        const input = group.querySelector('.provider-key-input');
        if (input) input.placeholder = isConfigured ? '••••••••••••••••' : 'Enter your API key';
    });
}

function applyTheme() {
    const themeLink = document.getElementById('theme-link');
    if (themeLink) {
        themeLink.href = `../../themes/active/global.css?t=${Date.now()}`;
    }
}

/**
 * Dynamic Settings Binding System
 */
let currentSettingsCache = null;
let providerDependentRefreshTimer = null;
let providerSecretStatuses = {};
const MODEL_TIER_ORDER = ['lowendmodel', 'mediumendmodel', 'highendmodel', 'veryhighendmodel'];
const MODEL_ALIAS_META = {
    lowendmodel: { label: 'Low', description: 'Fast and inexpensive utility work.' },
    mediumendmodel: { label: 'Medium', description: 'Balanced cost and quality.' },
    highendmodel: { label: 'High', description: 'Strong general-purpose intelligence.' },
    veryhighendmodel: { label: 'Very High', description: 'Best configured route for writing and planning.' }
};
const REASONING_EFFORT_OPTIONS = [
    ['', 'Automatic'],
    ['none', 'None'],
    ['minimal', 'Minimal'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['xhigh', 'Extra high']
];
const REASONING_EFFORT_PROVIDERS = new Set(['nano_gpt', 'openrouter', 'openai', 'deepseek', 'generic']);
// Commander GOAT (generic) only accepts low/medium/high/xhigh/max. 'none' is
// expressed by omitting the parameter; 'minimal' maps to 'low' (see
// normalizeReasoningParamsForProvider in engine/modules/llm.js).
const GENERIC_EFFORT_OPTIONS = [
    ['', 'Automatic'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['xhigh', 'Extra high']
];

function getNormalizedProviderConfig(rawConfig) {
    if (!rawConfig) return null;
    if (typeof rawConfig === 'object') return rawConfig;
    if (typeof rawConfig !== 'string') return null;
    try { return JSON.parse(rawConfig.trim()); } catch { return null; }
}

function getProviderRegistry(settings) {
    const raw = settings?.infrastructure?.providers || {};
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, getNormalizedProviderConfig(value) || value]));
}

function getSelectableProviderKeys(settings) {
    return Array.from(new Set([
        ...Object.keys(getProviderRegistry(settings)),
        'openrouter', 'openai', 'anthropic', 'deepseek', 'gemini', 'nano_gpt', 'generic', 'ollama'
    ])).sort();
}

function getAliasRegistry(settings) {
    const aliases = settings?.infrastructure?.llm_routing?.aliases;
    return aliases && typeof aliases === 'object' ? aliases : {};
}

function getAliasEntries(settings) {
    const aliases = getAliasRegistry(settings);
    return [
        ...MODEL_TIER_ORDER.filter(alias => aliases[alias] !== undefined),
        ...Object.keys(aliases).filter(alias => !MODEL_TIER_ORDER.includes(alias)).sort()
    ].map(alias => {
        const route = aliases[alias] || {};
        return {
            alias,
            label: MODEL_ALIAS_META[alias]?.label || alias,
            description: MODEL_ALIAS_META[alias]?.description || 'Custom alias managed in workspace/settings.json.',
            route,
            builtIn: MODEL_TIER_ORDER.includes(alias),
            valid: !!route.provider && !!route.model
        };
    });
}

function getAliasOptionsHtml(settings) {
    return getAliasEntries(settings).map(item =>
        `<option value="${escapeHtml(item.alias)}" ${item.valid ? '' : 'disabled'}>${escapeHtml(item.label)}</option>`
    ).join('');
}

function getRouteSummary(settings, alias) {
    const route = getAliasRegistry(settings)[alias];
    if (!route?.provider || !route?.model) return 'Route is incomplete';
    const reasoningSummary = REASONING_EFFORT_PROVIDERS.has(route.provider)
        ? (route.reasoning_effort ? `reasoning ${route.reasoning_effort}` : 'reasoning automatic')
        : 'reasoning effort unsupported';
    const primaryRoute = [route.provider, route.model, route.subprovider ? `via ${route.subprovider}` : null, reasoningSummary]
        .filter(Boolean)
        .join(' · ');
    const fallback = route.fallback;
    if (!fallback?.provider || !fallback?.model) return primaryRoute;
    const fallbackReasoning = REASONING_EFFORT_PROVIDERS.has(fallback.provider)
        ? (fallback.reasoning_effort ? `reasoning ${fallback.reasoning_effort}` : 'reasoning automatic')
        : 'reasoning effort unsupported';
    const fallbackRoute = [fallback.provider, fallback.model, fallback.subprovider ? `via ${fallback.subprovider}` : null, fallbackReasoning]
        .filter(Boolean)
        .join(' · ');
    return `${primaryRoute} → fallback: ${fallbackRoute}`;
}

function initializeDynamicBindings() {
    document.addEventListener('blur', event => {
        if (event.target.matches('[data-settings-path]:not(select)')) saveDynamicBinding(event.target);
    }, true);

    document.addEventListener('change', event => {
        const el = event.target;
        if (el.matches('[data-settings-path]')) saveDynamicBinding(el);
        if (el.matches('[data-alias-field]')) saveAliasCard(el.dataset.alias);
        if (el.matches('[data-validation-role="model"]')) refreshRouteSummaries();
    }, true);

    socket.on('update-global-setting-response', response => {
        if (!response.success) showNotify(`Error saving: ${response.error}`, 'error');
        else showNotify('Settings synchronized.', 'success');
    });

    socket.on('global-setting-updated', ({ path, value }) => {
        if (!currentSettingsCache) return;
        setNestedValue(currentSettingsCache, path, value);
        if (path.startsWith('infrastructure.narrative_history')) renderMemoryLodSimulator(currentSettingsCache);
        if (isProviderRoutingPath(path)) scheduleProviderDependentRefresh();
        if (path.startsWith('plugins.')) initializePluginAudit();
    });

    socket.on('vn-settings-updated', settings => {
        if (!currentSettingsCache || !settings?.plugins) return;
        currentSettingsCache.plugins = settings.plugins;
        initializePluginAudit();
    });
}

function isProviderRoutingPath(path) {
    return typeof path === 'string' && (
        path.startsWith('infrastructure.providers') ||
        path.startsWith('infrastructure.llm_routing')
    );
}

function scheduleProviderDependentRefresh() {
    if (providerDependentRefreshTimer) clearTimeout(providerDependentRefreshTimer);
    providerDependentRefreshTimer = setTimeout(() => {
        providerDependentRefreshTimer = null;
        refreshProviderDependentUi();
    }, 150);
}

function refreshProviderDependentUi() {
    if (!currentSettingsCache) return;
    renderModelAliasCards(currentSettingsCache);
    renderDynamicEngineManagement(currentSettingsCache);
    renderReferenceGuide(currentSettingsCache);
    populateBoundValues(currentSettingsCache);
    refreshRouteSummaries();
    initializePluginAudit();
}

function providerHasSecret(provider) {
    if (provider === 'ollama') return true;
    if (provider === 'generic') return providerHasGenericEndpoint(currentSettingsCache);
    const map = {
        openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY', gemini: 'GEMINI_API_KEY', nano_gpt: 'NANO_GPT_API_KEY',
        generic: 'GENERIC_API_KEY'
    };
    return !!providerSecretStatuses[map[provider]];
}

function providerHasGenericEndpoint(settings) {
    return !!String(settings?.infrastructure?.providers?.generic?.url || '').trim();
}

function renderModelAliasCards(settings) {
    const container = document.getElementById('model-alias-cards');
    if (!container) return;
    const providers = getSelectableProviderKeys(settings);
    const providerOptions = providers.map(provider => `<option value="${provider}">${provider}</option>`).join('');
    const entries = getAliasEntries(settings);
    container.innerHTML = entries.filter(item => item.builtIn).map(item => {
        const route = item.route || {};
        const fallback = route.fallback || {};
        const supportsReasoningEffort = REASONING_EFFORT_PROVIDERS.has(route.provider);
        const fallbackSupportsReasoningEffort = REASONING_EFFORT_PROVIDERS.has(fallback.provider);
        const effortOptionsFor = (provider) => provider === 'generic' ? GENERIC_EFFORT_OPTIONS : REASONING_EFFORT_OPTIONS;
        const reasoningOptions = effortOptionsFor(route.provider).map(([value, label]) =>
            `<option value="${value}"${route.reasoning_effort === value ? ' selected' : ''}>${label}</option>`
        ).join('');
        const fallbackReasoningOptions = effortOptionsFor(fallback.provider).map(([value, label]) =>
            `<option value="${value}"${fallback.reasoning_effort === value ? ' selected' : ''}>${label}</option>`
        ).join('');
        const status = !route.provider || !route.model
            ? { kind: 'missing', text: 'Incomplete route' }
            : !providerHasSecret(route.provider)
                ? { kind: 'warn', text: route.provider === 'generic' ? 'Endpoint URL missing' : 'Provider key missing' }
                : { kind: 'configured', text: 'Ready' };
        return `
            <article class="model-alias-card" data-alias-card="${item.alias}">
                <div class="model-alias-card-header">
                    <div><h3>${item.label}</h3><code>${item.alias}</code></div>
                    <span class="alias-route-status alias-route-status-${status.kind}">${status.text}</span>
                </div>
                <p>${item.description}</p>
                <div class="engine-config-row">
                    <div class="form-group mini-form-group"><label>Provider</label>
                        <select class="premium-select mini-input" data-alias="${item.alias}" data-alias-field="provider">
                            <option value="">Select provider...</option>${providerOptions}
                        </select>
                    </div>
                    <div class="form-group mini-form-group"><label>Concrete Model</label>
                        <input class="premium-input mini-input" value="${escapeHtml(route.model || '')}" data-alias="${item.alias}" data-alias-field="model">
                    </div>
                </div>
                <div class="engine-config-row">
                    <div class="form-group mini-form-group"><label>Subprovider <span class="optional-label">optional</span></label>
                        <input class="premium-input mini-input" value="${escapeHtml(route.subprovider || '')}" data-alias="${item.alias}" data-alias-field="subprovider">
                    </div>
                    <div class="form-group mini-form-group"><label>Thinking effort</label>
                        <select class="premium-select mini-input" data-alias="${item.alias}" data-alias-field="reasoning_effort"${supportsReasoningEffort ? '' : ' disabled'}>${reasoningOptions}</select>
                        ${supportsReasoningEffort ? '' : '<small class="description">Not supported by this provider adapter.</small>'}
                    </div>
                </div>
                <div class="engine-config-row">
                    <div class="form-group mini-form-group"><label>Fallback provider <span class="optional-label">optional</span></label>
                        <select class="premium-select mini-input" data-alias="${item.alias}" data-alias-field="fallback_provider">
                            <option value="">No fallback</option>${providerOptions}
                        </select>
                    </div>
                    <div class="form-group mini-form-group"><label>Fallback model <span class="optional-label">optional</span></label>
                        <input class="premium-input mini-input" value="${escapeHtml(fallback.model || '')}" data-alias="${item.alias}" data-alias-field="fallback_model">
                    </div>
                </div>
                <div class="engine-config-row">
                    <div class="form-group mini-form-group"><label>Fallback subprovider <span class="optional-label">optional</span></label>
                        <input class="premium-input mini-input" value="${escapeHtml(fallback.subprovider || '')}" data-alias="${item.alias}" data-alias-field="fallback_subprovider">
                    </div>
                    <div class="form-group mini-form-group"><label>Fallback thinking effort</label>
                        <select class="premium-select mini-input" data-alias="${item.alias}" data-alias-field="fallback_reasoning_effort"${fallback.provider && !fallbackSupportsReasoningEffort ? ' disabled' : ''}>${fallbackReasoningOptions}</select>
                        ${fallback.provider && !fallbackSupportsReasoningEffort ? '<small class="description">Not supported by this provider adapter.</small>' : ''}
                    </div>
                </div>
                <div class="alias-route-summary">${escapeHtml(getRouteSummary(settings, item.alias))}</div>
            </article>`;
    }).join('');

    container.querySelectorAll('[data-alias-field="provider"]').forEach(select => {
        select.value = getAliasRegistry(settings)[select.dataset.alias]?.provider || '';
    });
    container.querySelectorAll('[data-alias-field="fallback_provider"]').forEach(select => {
        select.value = getAliasRegistry(settings)[select.dataset.alias]?.fallback?.provider || '';
    });
    container.querySelectorAll('[data-alias-field="fallback_reasoning_effort"]').forEach(select => {
        select.value = getAliasRegistry(settings)[select.dataset.alias]?.fallback?.reasoning_effort || '';
    });

    const custom = entries.filter(item => !item.builtIn);
    const customContainer = document.getElementById('custom-alias-summary');
    if (customContainer) {
        customContainer.innerHTML = custom.length
            ? `<h3>Custom aliases</h3><p>Custom aliases are created and edited in workspace/settings.json.</p>${custom.map(item =>
                `<div class="custom-alias-row"><code>${escapeHtml(item.alias)}</code><span>${escapeHtml(getRouteSummary(settings, item.alias))}</span></div>`
              ).join('')}`
            : '<p class="description">No custom aliases are defined.</p>';
    }
    PremiumSelect.initAll(container);
}

function saveAliasCard(alias) {
    if (!currentSettingsCache || !alias) return;
    const card = document.querySelector(`[data-alias-card="${alias}"]`);
    if (!card) return;
    const provider = card.querySelector('[data-alias-field="provider"]')?.value?.trim() || '';
    const model = card.querySelector('[data-alias-field="model"]')?.value?.trim() || '';
    const subprovider = card.querySelector('[data-alias-field="subprovider"]')?.value?.trim() || '';
    const reasoningEffort = card.querySelector('[data-alias-field="reasoning_effort"]')?.value?.trim() || '';
    const fallbackProvider = card.querySelector('[data-alias-field="fallback_provider"]')?.value?.trim() || '';
    const fallbackModel = card.querySelector('[data-alias-field="fallback_model"]')?.value?.trim() || '';
    const fallbackSubprovider = card.querySelector('[data-alias-field="fallback_subprovider"]')?.value?.trim() || '';
    const fallbackReasoningEffort = card.querySelector('[data-alias-field="fallback_reasoning_effort"]')?.value?.trim() || '';
    if (!provider || !model) {
        showNotify(`Alias "${alias}" requires both a provider and a model.`, 'error');
        return;
    }
    const route = { provider, model };
    if (subprovider) route.subprovider = subprovider;
    if (reasoningEffort) route.reasoning_effort = reasoningEffort;
    if (fallbackProvider || fallbackModel) {
        if (!fallbackProvider || !fallbackModel) {
            // Fallback fields are edited independently; wait until the route is complete
            // before persisting so an intermediate UI edit cannot break the active alias.
            return;
        }
        route.fallback = { provider: fallbackProvider, model: fallbackModel };
        if (fallbackSubprovider) route.fallback.subprovider = fallbackSubprovider;
        if (fallbackReasoningEffort) route.fallback.reasoning_effort = fallbackReasoningEffort;
    }
    setNestedValue(currentSettingsCache, `infrastructure.llm_routing.aliases.${alias}`, route);
    socket.emit('update-global-setting', { path: `infrastructure.llm_routing.aliases.${alias}`, value: route });
    scheduleProviderDependentRefresh();
}

function renderDynamicEngineManagement(settings) {
    const container = document.getElementById('engine-management-list');
    if (!container || !settings.narrative_agents) return;
    const aliasOptions = getAliasOptionsHtml(settings);
    const agentKeys = Object.keys(settings.narrative_agents).sort((a, b) => {
        if (a === 'writer') return -1;
        if (b === 'writer') return 1;
        return a.localeCompare(b);
    });

    container.innerHTML = agentKeys.map(key => {
        const agent = settings.narrative_agents[key];
        const isWriter = key === 'writer';
        const title = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        const modelFields = Object.keys(agent).filter(prop =>
            (prop === 'model' || prop.endsWith('_model')) && !(key === 'summarizer' && prop === 'character_sheet_model')
        );
        const assignments = modelFields.map(field => {
            const prefix = field === 'model' ? '' : field.replace(/_model$/, '');
            const label = prefix ? prefix.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Main';
            const path = `narrative_agents.${key}.${field}`;
            return `<div class="engine-config-row"><div class="form-group mini-form-group">
                <label>${label} Model Tier</label>
                <select class="premium-select mini-input" data-settings-path="${path}" data-validation-role="model">
                    <option value="">Select alias...</option>${aliasOptions}
                </select>
                <div class="alias-route-summary" data-route-summary-for="${path}"></div>
            </div></div>`;
        }).join('');
        const status = isWriter ? '' : `<div class="engine-config-row"><div class="form-group mini-form-group">
            <label>Module Status</label><select class="premium-select mini-input" data-settings-path="narrative_agents.${key}.enabled" data-is-boolean="true">
                <option value="true">Enabled</option><option value="false">Disabled</option>
            </select></div></div>`;
        const writerCot = isWriter ? `<div class="engine-config-row writer-cot-row"><div class="form-group mini-form-group">
            <label>Writer Chain of Thought</label><select class="premium-select mini-input" data-settings-path="narrative_agents.writer.enable_chain_of_thought" data-is-boolean="true">
                <option value="true">Enabled</option><option value="false">Disabled</option>
            </select></div></div>` : '';
        return `<div class="engine-group-box ${isWriter ? 'engine-writer' : ''}">
            <div class="engine-title-row"><h3>${title}</h3><div class="engine-badge">${isWriter || key === 'director' ? 'Core' : 'Utility'}</div></div>
            ${status}${assignments}${writerCot}
            ${agent.description ? `<div class="writer-description-panel"><span>What this does</span><p>${escapeHtml(agent.description)}</p></div>` : ''}
        </div>`;
    }).join('');
}

function renderReferenceGuide(settings) {
    const container = document.getElementById('engine-reference-guide');
    if (!container) return;
    queueMicrotask(() => {
        container.querySelectorAll('.m-arrow').forEach(arrow => { arrow.textContent = '→'; });
    });
    container.innerHTML = `<div class="reference-guide-container"><div class="reference-guide-header"><div>
        <h4>Global Model Alias Reference</h4><p>Every module and plugin resolves these shared routes.</p>
    </div></div><div class="reference-grid">${getAliasEntries(settings).map(item =>
        `<div class="reference-card"><div class="reference-card-title">${escapeHtml(item.label)}</div>
        <div class="mapping-item"><span class="m-keyword">${escapeHtml(item.alias)}</span><span class="m-arrow">Ã¢â€ â€™</span>
        <span class="m-target">${escapeHtml(getRouteSummary(settings, item.alias))}</span></div></div>`
    ).join('')}</div></div>`;
}

function refreshRouteSummaries() {
    if (!currentSettingsCache) return;
    document.querySelectorAll('[data-route-summary-for]').forEach(summary => {
        const select = document.querySelector(`[data-settings-path="${summary.dataset.routeSummaryFor}"]`);
        summary.textContent = select?.value ? getRouteSummary(currentSettingsCache, select.value) : 'No alias selected';
    });
}

function initializeMemoryLodSimulator() {
    const turnInput = document.getElementById('memory-sim-current-turn');
    if (!turnInput) return;

    turnInput.addEventListener('input', () => {
        renderMemoryLodSimulator(currentSettingsCache);
    });
}

const MEMORY_SIM_TOKEN_COSTS = {
    full: 2500,
    summary: 250,
    synopsis: 100,
    arc: 500,
    ragChunk: 140
};

function getNumericSetting(settings, path, fallback) {
    const parsed = Number(getNestedValue(settings, path));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getBooleanSetting(settings, path, fallback) {
    const value = getNestedValue(settings, path);
    return typeof value === 'boolean' ? value : fallback;
}

function renderMemoryLodSimulator(settings) {
    const turnInput = document.getElementById('memory-sim-current-turn');
    const timeline = document.getElementById('memory-sim-timeline');
    const stack = document.getElementById('memory-sim-stack');
    const verticalStack = document.getElementById('memory-sim-vertical-stack');
    if (!turnInput || !timeline || !stack || !verticalStack || !settings) return;

    const currentTurn = Math.max(1, Math.floor(Number(turnInput.value) || 1));
    if (String(currentTurn) !== turnInput.value) {
        turnInput.value = currentTurn;
    }

    const simulation = buildMemoryLodSimulation(settings, currentTurn);
    const totalTokens = simulation.totalTokens;

    setText('memory-sim-total-tokens', totalTokens.toLocaleString());
    setText('memory-sim-full-count', simulation.counts.full);
    setText('memory-sim-summary-count', simulation.counts.summary);
    setText('memory-sim-synopsis-count', simulation.counts.synopsis);
    setText('memory-sim-arc-count', simulation.counts.arc);

    renderMemoryStack(stack, simulation.tokenBuckets, totalTokens);
    renderMemoryTimeline(timeline, simulation.items);
    renderMemoryVerticalStack(verticalStack, simulation.items);

    const slottedText = simulation.ragChunks > 0
        ? `${simulation.smartRagChunks} smart RAG chunks and ${simulation.randomRagChunks} associative recall chunks add roughly ${(simulation.ragChunks * MEMORY_SIM_TOKEN_COSTS.ragChunk).toLocaleString()} tokens.`
        : 'Slotted RAG is not adding extra simulated chunks.';
    const omittedText = simulation.omittedCount > 0
        ? ` ${simulation.omittedCount} older chapters are outside the configured synopsis window.`
        : '';

    setText(
        'memory-sim-summary',
        `Turn ${currentTurn} sees ${simulation.historyCount} prior chapters. ${slottedText}${omittedText}`
    );
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function buildMemoryLodSimulation(settings, currentTurn) {
    const historyCount = Math.max(0, currentTurn - 1);
    const fullChapters = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.full_chapters', 0));
    const summaryChapters = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.summary_chapters', 0));
    const synopsisChapters = getNumericSetting(settings, 'infrastructure.narrative_history.synopsis_chapters', -1);

    const fullStart = Math.max(historyCount - fullChapters, 0);
    const summaryStart = Math.max(fullStart - summaryChapters, 0);
    const synopsisStart = synopsisChapters === -1
        ? 0
        : Math.max(summaryStart - Math.max(0, synopsisChapters), 0);

    const omittedCount = synopsisStart;
    const chapters = [];
    for (let index = synopsisStart; index < historyCount; index++) {
        const turn = index + 1;
        let type = 'synopsis';
        let tokens = MEMORY_SIM_TOKEN_COSTS.synopsis;

        if (index >= fullStart) {
            type = 'full';
            tokens = MEMORY_SIM_TOKEN_COSTS.full;
        } else if (index >= summaryStart) {
            type = 'summary';
            tokens = MEMORY_SIM_TOKEN_COSTS.summary;
        }

        chapters.push({
            turn,
            type,
            nativeType: type,
            tokens,
            hasRag: false,
            ragChunks: 0,
            smartRagChunks: 0,
            randomRagChunks: 0,
            ragTokens: 0
        });
    }

    applySimulatedElevation(settings, chapters);
    const { smartRagChunks, randomRagChunks } = applySimulatedRag(settings, chapters, currentTurn);
    const ragChunks = smartRagChunks + randomRagChunks;
    const items = applySimulatedArcCompression(settings, chapters, currentTurn);

    const counts = { full: 0, summary: 0, synopsis: 0, arc: 0 };
    const tokenBuckets = {
        full: 0,
        summary: 0,
        synopsis: 0,
        elevated: 0,
        arc: 0,
        rag: smartRagChunks * MEMORY_SIM_TOKEN_COSTS.ragChunk,
        'random-rag': randomRagChunks * MEMORY_SIM_TOKEN_COSTS.ragChunk
    };
    let totalTokens = tokenBuckets.rag + tokenBuckets['random-rag'];

    items.forEach(item => {
        totalTokens += item.tokens;
        if (item.type === 'arc') {
            counts.arc += 1;
            tokenBuckets.arc += item.tokens;
            return;
        }

        if (item.type === 'elevated-full' || item.type === 'elevated-summary') {
            tokenBuckets.elevated += item.tokens;
        } else {
            tokenBuckets[item.type] += item.tokens;
        }

        if (item.type === 'full' || item.type === 'elevated-full') counts.full += 1;
        else if (item.type === 'summary' || item.type === 'elevated-summary') counts.summary += 1;
        else if (item.type === 'synopsis') counts.synopsis += 1;
    });

    return { historyCount, omittedCount, items, counts, tokenBuckets, totalTokens, ragChunks, smartRagChunks, randomRagChunks };
}

function applySimulatedElevation(settings, chapters) {
    const enabled = getBooleanSetting(settings, 'infrastructure.narrative_history.memory_lod.enabled', false);
    if (!enabled) return;

    const fullBudget = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.full_chapters', 0));
    const summaryBudget = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.summary_chapters', 0));
    const candidates = chapters.filter(ch => ch.type === 'synopsis');
    const selected = pickScatteredChapters(candidates, fullBudget + summaryBudget, 31);

    selected.forEach((chapter, index) => {
        if (index < fullBudget) {
            chapter.type = 'elevated-full';
            chapter.tokens = MEMORY_SIM_TOKEN_COSTS.full;
        } else {
            chapter.type = 'elevated-summary';
            chapter.tokens = MEMORY_SIM_TOKEN_COSTS.summary;
        }
    });
}

function deterministicNoise(value, salt = 0) {
    const raw = Math.sin((value + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return raw - Math.floor(raw);
}

function pickScatteredChapters(items, count, salt) {
    if (count <= 0 || items.length === 0) return [];
    if (count >= items.length) return [...items];

    return [...items]
        .map(item => ({
            item,
            score: deterministicNoise(item.turn, salt) + (item.turn % 7 === 0 ? 0.22 : 0) + (item.turn % 11 === 0 ? 0.16 : 0)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(entry => entry.item)
        .sort((a, b) => a.turn - b.turn);
}

function applySimulatedRag(settings, chapters, currentTurn) {
    const enabled = getBooleanSetting(settings, 'infrastructure.narrative_history.auto_slot_rag_old_chapters', true);
    if (!enabled) return { smartRagChunks: 0, randomRagChunks: 0 };

    const maxChunks = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.max_chunks_auto_slot_rag_old_chapters', 0));
    const randomChunkBudget = Math.max(0, getNumericSetting(settings, 'infrastructure.narrative_history.random_slot_rag_chunks', 0));
    const candidates = chapters.filter(ch => ch.type === 'synopsis');
    if ((maxChunks === 0 && randomChunkBudget === 0) || candidates.length === 0) {
        return { smartRagChunks: 0, randomRagChunks: 0 };
    }

    let smartRagChunks = 0;
    if (maxChunks > 0) {
        const chapterBudget = Math.min(
            candidates.length,
            Math.max(1, Math.ceil(Math.sqrt(maxChunks)))
        );
        const selected = pickScatteredChapters(candidates, chapterBudget, currentTurn);
        let remainingChunks = maxChunks;

        selected.forEach((chapter, index) => {
            const slotsLeft = selected.length - index;
            const weightedShare = Math.max(1, Math.floor(remainingChunks / slotsLeft));
            const jitter = deterministicNoise(chapter.turn, currentTurn) > 0.66 && remainingChunks > weightedShare ? 1 : 0;
            const chunks = Math.min(remainingChunks, weightedShare + jitter);
            chapter.hasRag = true;
            chapter.smartRagChunks += chunks;
            chapter.ragChunks += chunks;
            chapter.ragTokens += chunks * MEMORY_SIM_TOKEN_COSTS.ragChunk;
            remainingChunks -= chunks;
        });
        smartRagChunks = maxChunks - remainingChunks;
    }

    let randomRagChunks = 0;
    if (randomChunkBudget > 0) {
        let remainingRandom = randomChunkBudget;
        const randomChapterBudget = Math.min(
            candidates.length,
            Math.max(1, Math.ceil(Math.sqrt(randomChunkBudget)) + 1)
        );
        const selectedRandom = pickScatteredChapters(candidates, randomChapterBudget, currentTurn + 719);

        selectedRandom.forEach((chapter, index) => {
            const slotsLeft = selectedRandom.length - index;
            const share = Math.max(1, Math.floor(remainingRandom / slotsLeft));
            const jitter = deterministicNoise(chapter.turn, currentTurn + 991) > 0.52 && remainingRandom > share ? 1 : 0;
            const chunks = Math.min(remainingRandom, share + jitter);
            chapter.hasRag = true;
            chapter.randomRagChunks += chunks;
            chapter.ragChunks += chunks;
            chapter.ragTokens += chunks * MEMORY_SIM_TOKEN_COSTS.ragChunk;
            remainingRandom -= chunks;
        });
        randomRagChunks = randomChunkBudget - remainingRandom;
    }

    return { smartRagChunks, randomRagChunks };
}

function applySimulatedArcCompression(settings, chapters, currentTurn) {
    const enabled = getBooleanSetting(settings, 'infrastructure.narrative_history.memory_lod.enable_arc_compression', false);
    if (!enabled) return chapters;

    const threshold = Math.max(1, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.arc_compress_old_chapter_min_threshold', 3));
    const olderThan = Math.max(1, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.arc_compress_older_chapters_than', 10));
    const grace = Math.max(1, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.arc_rollover_grace_chapters', 5));
    const tileChapters = Math.max(grace, getNumericSetting(settings, 'infrastructure.narrative_history.memory_lod.arc_tile_chapters', 25));
    const items = [];
    let bucket = [];

    const flush = () => {
        const readyCount = bucket.length - (bucket.length % grace);
        const ready = bucket.slice(0, readyCount);
        let tile = [];
        let tileIndex = null;

        const flushTile = () => {
            if (tile.length >= threshold) {
                items.push({
                    type: 'arc',
                    startTurn: tile[0].turn,
                    endTurn: tile[tile.length - 1].turn,
                    chapterCount: tile.length,
                    tokens: MEMORY_SIM_TOKEN_COSTS.arc
                });
            } else {
                items.push(...tile);
            }
            tile = [];
            tileIndex = null;
        };

        ready.forEach(chapter => {
            const nextTileIndex = Math.floor((chapter.turn - 1) / tileChapters);
            if (tileIndex !== null && nextTileIndex !== tileIndex) flushTile();
            tile.push(chapter);
            tileIndex = nextTileIndex;
        });
        flushTile();

        if (readyCount < bucket.length) {
            items.push(...bucket.slice(readyCount));
        }
        bucket = [];
    };

    chapters.forEach(chapter => {
        const age = currentTurn - chapter.turn;
        const canCompress = chapter.type === 'synopsis' && !chapter.hasRag && age > olderThan;
        if (canCompress) {
            bucket.push(chapter);
        } else {
            flush();
            items.push(chapter);
        }
    });
    flush();

    return items;
}

function renderMemoryStack(stack, tokenBuckets, totalTokens) {
    stack.innerHTML = '';
    const buckets = [
        ['full', tokenBuckets.full],
        ['summary', tokenBuckets.summary],
        ['synopsis', tokenBuckets.synopsis],
        ['elevated', tokenBuckets.elevated],
        ['arc', tokenBuckets.arc],
        ['rag', tokenBuckets.rag],
        ['random-rag', tokenBuckets['random-rag']]
    ].filter(([, tokens]) => tokens > 0);

    if (buckets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'memory-sim-stack-segment memory-sim-stack-synopsis';
        empty.style.width = '100%';
        stack.appendChild(empty);
        return;
    }

    buckets.forEach(([type, tokens]) => {
        const segment = document.createElement('div');
        segment.className = `memory-sim-stack-segment memory-sim-stack-${type}`;
        segment.style.width = `${Math.max(2, (tokens / totalTokens) * 100)}%`;
        segment.title = `${type}: ~${tokens.toLocaleString()} tokens`;
        stack.appendChild(segment);
    });
}

function renderMemoryTimeline(timeline, items) {
    timeline.innerHTML = '';

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'memory-sim-summary';
        empty.textContent = 'No prior chapters yet.';
        timeline.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const chip = document.createElement('div');
        if (item.type === 'arc') {
            chip.className = 'memory-sim-chip memory-sim-chip-arc';
            chip.textContent = `${item.startTurn}-${item.endTurn}`;
            chip.title = `Arc summary: turns ${item.startTurn}-${item.endTurn}, ~${item.tokens} tokens`;
        } else {
            chip.className = `memory-sim-chip memory-sim-chip-${item.type}${item.smartRagChunks ? ' memory-sim-chip-rag' : ''}${item.randomRagChunks ? ' memory-sim-chip-random-rag' : ''}`;
            chip.textContent = item.turn;
            const ragTitle = item.ragChunks
                ? ` + ${item.smartRagChunks || 0} smart / ${item.randomRagChunks || 0} random RAG chunks`
                : '';
            chip.title = `Turn ${item.turn}: ${item.type.replace('-', ' ')}, ~${item.tokens} tokens${ragTitle}`;
        }
        timeline.appendChild(chip);
    });
}

function renderMemoryVerticalStack(verticalStack, items) {
    verticalStack.innerHTML = '';

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'memory-sim-summary';
        empty.textContent = 'No stackable memory yet.';
        verticalStack.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const block = document.createElement('div');
        const visualTokens = item.tokens + (item.ragTokens || 0);
        block.className = `memory-size-block memory-sim-chip-${item.type}${item.smartRagChunks ? ' memory-sim-chip-rag' : ''}${item.randomRagChunks ? ' memory-sim-chip-random-rag' : ''}`;
        block.style.setProperty('--sim-block-height', `${getMemorySizeBlockHeight(item, visualTokens)}px`);

        if (item.type === 'arc') {
            block.innerHTML = `
                <div class="memory-size-block-label">${item.startTurn}-${item.endTurn}</div>
                <div class="memory-size-block-main">Arc summary (${item.chapterCount} turns)</div>
                <div class="memory-size-block-tokens">~${visualTokens}</div>
                <div class="memory-size-arc-markers">
                    ${Array.from({ length: Math.min(item.chapterCount, 18) }).map(() => '<span class="memory-size-arc-marker"></span>').join('')}
                </div>
            `;
        } else {
            block.innerHTML = `
                <div class="memory-size-block-label">T${item.turn}</div>
                <div class="memory-size-block-main">${formatMemoryTypeLabel(item.type)}</div>
                <div class="memory-size-block-tokens">~${visualTokens}</div>
                ${item.smartRagChunks > 0 ? `
                    <div class="memory-size-rag-stack" title="${item.smartRagChunks} smart RAG chunks">
                        ${Array.from({ length: Math.min(item.smartRagChunks, 10) }).map(() => '<span class="memory-size-rag-fragment"></span>').join('')}
                    </div>
                ` : ''}
                ${item.randomRagChunks > 0 ? `
                    <div class="memory-size-rag-stack memory-size-rag-stack-random" title="${item.randomRagChunks} associative recall chunks">
                        ${Array.from({ length: Math.min(item.randomRagChunks, 10) }).map(() => '<span class="memory-size-rag-fragment memory-size-rag-fragment-random"></span>').join('')}
                    </div>
                ` : ''}
            `;
        }

        block.title = item.type === 'arc'
            ? `Arc summary: turns ${item.startTurn}-${item.endTurn}, ~${item.tokens} tokens`
            : `Turn ${item.turn}: ${formatMemoryTypeLabel(item.type)}, ~${item.tokens} base tokens${item.ragChunks ? ` + ${item.smartRagChunks || 0} smart / ${item.randomRagChunks || 0} random RAG chunks` : ''}`;
        verticalStack.appendChild(block);
    });
}

function getMemorySizeBlockHeight(item, visualTokens) {
    if (item.type === 'arc') {
        return Math.min(92, Math.max(34, 24 + item.chapterCount * 3));
    }
    if (item.type === 'full' || item.type === 'elevated-full') return 74;
    if (item.type === 'elevated-summary') return 42;
    if (item.type === 'summary') return 34;
    if (item.type === 'synopsis') {
        const ragGrowth = (item.ragChunks || 0) * 8;
        const tokenGrowth = Math.ceil(Math.max(0, visualTokens - MEMORY_SIM_TOKEN_COSTS.synopsis) / 140) * 2;
        return Math.min(128, Math.max(22, 22 + ragGrowth + tokenGrowth));
    }
    return 22;
}

function formatMemoryTypeLabel(type) {
    if (type === 'elevated-full') return 'Elevated full';
    if (type === 'elevated-summary') return 'Elevated summary';
    return type.charAt(0).toUpperCase() + type.slice(1);
}

function populateBoundValues(settings) {
    document.querySelectorAll('[data-settings-path]').forEach(el => {
        const path = el.getAttribute('data-settings-path');
        const value = getNestedValue(settings, path);
        if (value === undefined) return;
        if (typeof value === 'object' && value !== null) {
            if (el.tagName === 'TEXTAREA') {
                el.value = JSON.stringify(redactSecrets(JSON.parse(JSON.stringify(value))), null, 2);
                el.setAttribute('data-is-json', 'true');
            }
            return;
        }
        if (el.getAttribute('data-is-boolean') === 'true') el.value = String(value);
        else el.value = value;
    });
}

function populateDynamicBindings(settings) {
    currentSettingsCache = settings;
    renderModelAliasCards(settings);
    renderDynamicEngineManagement(settings);
    renderMemoryLodSimulator(settings);
    renderReferenceGuide(settings);
    populateBoundValues(settings);
    PremiumSelect.initAll();
    syncThemeSelection(getNestedValue(settings, 'infrastructure.theme'));
    refreshRouteSummaries();
}
function saveDynamicBinding(el) {
    const path = el.getAttribute('data-settings-path');
    let value = el.value;
    const isJson = el.getAttribute('data-is-json') === 'true';
    const isBoolean = el.getAttribute('data-is-boolean') === 'true';
    const valueType = el.getAttribute('data-value-type');

    if (isJson) {
        try {
            value = JSON.parse(value);
            
            // RESTORE real secrets from cache if they were masked with asterisks
            const originalVal = getNestedValue(currentSettingsCache, path);
            if (originalVal && typeof originalVal === 'object') {
                value = restoreSecrets(value, originalVal);
            }
        } catch {
            showNotify(`Invalid JSON in field: ${path}. Changes not saved.`, 'error');
            el.classList.add('input-error');
            return;
        }
    } else if (isBoolean) {
        value = value === 'true';
    } else if (valueType === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            showNotify(`Invalid number in field: ${path}. Changes not saved.`, 'error');
            el.classList.add('input-error');
            return;
        }
        value = parsed;
    }

    el.classList.remove('input-error');
    if (currentSettingsCache) {
        setNestedValue(currentSettingsCache, path, value);
        if (path.startsWith('infrastructure.narrative_history')) {
            renderMemoryLodSimulator(currentSettingsCache);
        }
    }
    socket.emit('update-global-setting', { path, value });
}

function getNestedValue(obj, path) {
    if (!obj) return undefined;
    return path.split('.').reduce((prev, curr) => {
        return prev ? prev[curr] : undefined;
    }, obj);
}

function setNestedValue(obj, path, value) {
    if (!obj || !path) return;
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

function redactSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    Object.keys(obj).forEach(key => {
        if (key.toLowerCase().includes('apikey')) {
            if (typeof obj[key] === 'string' && obj[key].length > 0) {
                obj[key] = '******';
            }
        } else if (typeof obj[key] === 'object') {
            redactSecrets(obj[key]);
        }
    });
    return obj;
}

function restoreSecrets(target, source) {
    if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return target;
    
    Object.keys(target).forEach(key => {
        if (key.toLowerCase().includes('apikey')) {
            if (target[key] === '******' && source[key]) {
                target[key] = source[key];
            }
        } else if (typeof target[key] === 'object' && source[key]) {
            restoreSecrets(target[key], source[key]);
        }
    });
    return target;
}

function showNotify(message, type = 'success') {
    if (type === 'error') {
        const title = 'Validation Error';
        Modals.alert(title, message);
    } else {
        showTransientToast(message);
    }
}

let activeTransientToast = null;
let activeTransientToastTimer = null;

function showTransientToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    if (activeTransientToast && activeTransientToast.parentNode) {
        const messageEl = activeTransientToast.querySelector('.toast-message');
        if (messageEl) messageEl.textContent = message;
        if (activeTransientToastTimer) clearTimeout(activeTransientToastTimer);
        activeTransientToastTimer = setTimeout(() => {
            if (activeTransientToast?.parentNode) {
                activeTransientToast.parentNode.removeChild(activeTransientToast);
            }
            activeTransientToast = null;
            activeTransientToastTimer = null;
        }, 3000);
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'save-toast';
    queueMicrotask(() => {
        const icon = toast.querySelector('.toast-icon');
        if (icon) icon.textContent = '✓';
    });
    toast.innerHTML = `
        <span class="toast-icon">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);
    activeTransientToast = toast;

    // Remove from DOM after animation finishes
    activeTransientToastTimer = setTimeout(() => {
        if (toast.parentNode) {
            container.removeChild(toast);
        }
        if (activeTransientToast === toast) {
            activeTransientToast = null;
            activeTransientToastTimer = null;
        }
    }, 3000);
}

function initializeSyncAction() {
    const syncBtn = document.getElementById('sync-settings-btn');
    if (!syncBtn) return;

    syncBtn.addEventListener('click', () => {
        syncBtn.classList.add('loading');
        
        // Re-fetch everything
        socket.emit('get-global-settings');
        socket.emit('get-provider-secrets');
        initializePluginAudit();

        // We listen for the dynamic rendering to finish by watching for the response
        socket.once('get-global-settings-response', () => {
            setTimeout(() => {
                syncBtn.classList.remove('loading');
                showNotify('System configuration synchronized.', 'success');
            }, 500); // Small buffer for visual polish
        });
    });
}

function initializePluginAudit() {
    socket.emit('get-plugins', {}, (plugins) => {
        renderPluginAudit(plugins);
    });
}

function renderPluginAudit(plugins) {
    const container = document.getElementById('plugin-audit-grid');
    if (!container) return;

    // Filter plugins that have LLM assignments in their schema
    const auditPlugins = plugins.filter(p => {
        if (!p.settingsSchema) return false;
        return Object.values(p.settingsSchema).some(s => s.isLlmAlias);
    });

    if (auditPlugins.length === 0) {
        container.innerHTML = '<div class="audit-no-data">No active plugins with LLM assignments found.</div>';
        return;
    }

    let html = '';
    auditPlugins.forEach(p => {
        html += `
            <div class="audit-card">
                <div class="audit-card-header">
                    <div class="audit-card-title">
                        <span>${p.name}</span>
                    </div>
                    <div class="audit-card-lock" title="Read-only: Assignments are managed in the Plugin Manager">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢</div>
                </div>
                <div class="audit-pipe-list">
        `;

        Object.entries(p.settingsSchema).forEach(([key, schema]) => {
            if (schema.isLlmAlias) {
                const label = schema.label || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                let settingValue = (p.settings && p.settings[key]);
                
                let modelTier = 'None';
                const resolvedAssignment = (p.llmModelAssignments || []).find(assignment => assignment.settingKey === key);
                let providerName = resolvedAssignment?.provider || '';

                if (typeof settingValue === 'string') {
                    modelTier = settingValue;
                } else if (settingValue && typeof settingValue === 'object' && settingValue.inherit === 'vn_background') {
                    modelTier = resolvedAssignment ? `VN Background: ${resolvedAssignment.model}` : 'VN Background Model';
                } else if (settingValue && typeof settingValue === 'object' && settingValue.model) {
                    modelTier = settingValue.model;
                } else if (resolvedAssignment) {
                    modelTier = resolvedAssignment.model;
                }

                html += `
                    <div class="audit-pipe">
                        <div class="audit-pipe-label">${label}</div>
                        <div class="audit-pipe-value">
                            <span class="audit-model-badge">${modelTier}</span>
                            ${providerName ? `<span class="audit-provider-tag">on ${providerName}</span>` : ''}
                        </div>
                    </div>
                `;
            }
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
}

