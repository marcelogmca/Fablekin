// renderer.js - The file for index.html

// #region EVENT LISTENERS
document.addEventListener('DOMContentLoaded', () => {
    applySocketQueryParamsToWebviews();
    initializeTabs();
    loadPluginTabs();
    initializeSecurityListeners();
    initializePreviewListeners();
    initializeTheme(); // Apply initial theme
});
// #endregion

const socket = io('http://localhost:14541');

function getSocketQueryParamsFromLocation() {
    const params = new URLSearchParams(window.location.search || '');
    const keys = ['socketProtocol', 'socketHost', 'socketPort', 'socketToken'];
    const result = {};

    for (const key of keys) {
        const value = params.get(key);
        if (value) {
            result[key] = value;
        }
    }

    return result;
}

function appendSocketQueryParams(rawUrl) {
    if (!rawUrl) return rawUrl;

    const targetUrl = new URL(rawUrl, window.location.href);
    const socketParams = getSocketQueryParamsFromLocation();

    for (const [key, value] of Object.entries(socketParams)) {
        if (!targetUrl.searchParams.has(key)) {
            targetUrl.searchParams.set(key, value);
        }
    }

    return targetUrl.toString();
}

function applySocketQueryParamsToWebviews() {
    const webviews = document.querySelectorAll('webview');
    webviews.forEach((webview) => {
        const baseSrc = webview.getAttribute('data-base-src') || webview.getAttribute('src');
        if (!baseSrc) return;

        if (!webview.hasAttribute('data-base-src')) {
            webview.setAttribute('data-base-src', baseSrc);
        }

        const nextSrc = appendSocketQueryParams(baseSrc);
        if (nextSrc && webview.getAttribute('src') !== nextSrc) {
            webview.setAttribute('src', nextSrc);
        }
    });
}

// Handle tab switch requests from the backend
socket.on('switch-tab', (data) => {
    if (data && data.tab) {
        console.log(`[Renderer] Switching to tab: ${data.tab}`);
        const tabToActivate = document.querySelector(`.tab-btn[data-tab="${data.tab}"]`);
        if (tabToActivate) {
            tabToActivate.click();
        }
    }
});

socket.on('docs:open', (data) => {
    console.log(`[Renderer] Force opening doc: ${data.docId}`);
    const docsTabBtn = document.querySelector(`.tab-btn[data-tab="docs"]`);
    if (docsTabBtn) {
        docsTabBtn.click();
        // Since we are using socket.io for everything, the docs view itself
        // will be listening for 'docs:open' on its own socket.
    }
});

socket.on('reload-plugin-tabs', () => {
    console.log('[Renderer] Reloading plugin tabs...');
    loadPluginTabs(true);
});

socket.on('vn-fullscreen-state-changed', (data) => {
    console.log('[Renderer] Fullscreen state changed:', data.isFullScreen);
    if (data.isFullScreen) {
        document.body.classList.add('vn-fullscreen-mode');
    } else {
        document.body.classList.remove('vn-fullscreen-mode');
    }
});

// Handle global theme updates
socket.on('theme-updated', (data) => {
    if (data && data.theme) {
        console.log(`[Renderer] Global theme updated to: ${data.theme}`);
        applyTheme(data.theme);
    }
});

/**
 * Applies a theme to the main window by updating the theme link.
 * Also broadcasts the reload to all active webviews.
 * @param {string} themeName - The name of the theme file (e.g., 'default.css').
 */
function applyTheme() {
    const themeLink = document.getElementById('theme-link');
    if (themeLink) {
        // Point to the master file and add a timestamp to force the browser to re-read the disk copy
        const timestamp = Date.now();
        themeLink.href = `themes/active/global.css?t=${timestamp}`;
        console.log(`[Renderer] Applied global theme to main window (t=${timestamp})`);

        // Broadcast to all active webviews
        const webviews = document.querySelectorAll('webview');
        const reloadCode = `
            (function() {
                const links = document.querySelectorAll('link[rel="stylesheet"]');
                let found = false;
                for (const link of links) {
                    if (link.href.includes('themes/active/global.css')) {
                        const base = link.href.split('?')[0];
                        link.href = base + '?t=${timestamp}';
                        found = true;
                    }
                }
                if (found) {
                    console.log('[ThemeBridge] Global theme reloaded successfully.');
                }
            })();
        `;

        webviews.forEach(webview => {
            try {
                // Ensure the webview is ready before executing
                if (typeof webview.executeJavaScript === 'function') {
                    webview.executeJavaScript(reloadCode);
                }
            } catch (e) {
                console.warn('[Renderer] Failed to broadcast theme reload to webview:', e);
            }
        });
    }
}

/**
 * Initializes the application theme from the backend settings.
 */
function initializeTheme() {
    socket.emit('get-global-settings');
}

// Global listener for settings response
socket.on('get-global-settings-response', (response) => {
    if (response && response.success && response.settings && response.settings.infrastructure?.theme) {
        applyTheme(response.settings.infrastructure.theme);
    }
});

// #region TAB INITIALIZATION
/**
 * Initializes the tab switching functionality for the application.
 */
function initializeTabs() {
    // Action controls such as "Switch Projects" share the tab button styling,
    // but must not participate in tab navigation.
    const tabButtons = document.querySelectorAll('.tab-btn[data-tab]');
    const viewerWebview = document.getElementById('viewer-iframe');
    const switchProjectBtn = document.getElementById('switch-project-btn');

    // Bind action controls before tab restoration or webview synchronization.
    // Those later operations may fail while a webview is still starting, but
    // switching projects must always remain available.
    switchProjectBtn?.addEventListener('click', () => {
        console.log('[Renderer] Requesting app restart for project switch...');
        socket.emit('restart-app');
    });

    function notifyViewerTabActivity(isActive) {
        if (!viewerWebview || typeof viewerWebview.executeJavaScript !== 'function') return;
        const script = `window.__fablekinViewerTabActive = ${isActive === true}; window.dispatchEvent(new CustomEvent('fablekin:viewer-tab-activity', { detail: { isActive: window.__fablekinViewerTabActive } }));`;
        try {
            const execution = viewerWebview.executeJavaScript(script);
            execution?.catch?.(() => {
                // The dom-ready listener below will synchronize once the guest is available.
            });
        } catch {
            // The dom-ready listener below will synchronize once the guest is available.
        }
    }

    viewerWebview?.addEventListener('dom-ready', () => {
        notifyViewerTabActivity(document.getElementById('viewer-tab')?.classList.contains('active') === true);
    });

    function attachTabListener(btn) {
        if (!btn?.dataset?.tab) return;

        btn.addEventListener('click', function () {
            // Remove active from all buttons (including dynamically added ones)
            document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
            // Remove active from all panes (including dynamically added ones)
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPaneId = btn.dataset.tab + '-tab';
            const targetPane = document.getElementById(targetPaneId);
            if (targetPane) {
                targetPane.classList.add('active');
            }

            localStorage.setItem('activeTab', btn.dataset.tab);
            notifyViewerTabActivity(btn.dataset.tab === 'viewer');
        });
    }

    tabButtons.forEach(btn => attachTabListener(btn));

    // Expose attachTabListener for dynamic tabs
    window.attachTabListener = attachTabListener;

    const lastTab = localStorage.getItem('activeTab');
    if (lastTab) {
        const tabToActivate = document.querySelector(`.tab-btn[data-tab="${lastTab}"]`);
        if (tabToActivate) {
            tabToActivate.click();
        }
    }

    notifyViewerTabActivity(document.getElementById('viewer-tab')?.classList.contains('active') === true);

    // Handle messages from webviews (e.g., scene history requesting a tab switch)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'switch-tab') {
            const tabToActivate = document.querySelector(`.tab-btn[data-tab="${event.data.tab}"]`);
            if (tabToActivate) {
                tabToActivate.click();
            }
        }
    });
}

/**
 * Fetches plugin views from the backend and creates tabs for them.
 * @param {boolean} clearExisting - Whether to remove existing plugin tabs first.
 */
function loadPluginTabs(clearExisting = false) {
    socket.emit('get-plugin-views', (views) => {
        const tabsContainer = document.getElementById('plugin-tabs-container');
        const contentContainer = document.getElementById('tab-content');
        const separator = document.getElementById('plugin-tabs-separator');

        if (clearExisting) {
            // Remove existing dynamic tabs
            tabsContainer.innerHTML = '';
            // Remove existing dynamic panes (those starting with plugin-)
            const pluginPanes = contentContainer.querySelectorAll('.tab-pane[id^="plugin-"]');
            pluginPanes.forEach(p => p.remove());
            if (separator) separator.style.display = 'none';
        }

        if (!views || views.length === 0) return;

        console.log(`[Renderer] Received ${views.length} plugin views.`);
        if (separator) separator.style.display = 'inline-block';

        views.forEach(view => {
            const tabId = `plugin-${view.pluginId}-${view.id}`;

            // Create Button
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.dataset.tab = tabId;
            btn.textContent = view.label;
            tabsContainer.appendChild(btn);

            // Create Pane
            const pane = document.createElement('div');
            pane.id = `${tabId}-tab`;
            pane.className = 'tab-pane';

            // Note: Using webview for plugins to ensure isolation and access to nodeIntegration if needed
            const webview = document.createElement('webview');
            webview.id = `${tabId}-iframe`;
            // Add viewId and pluginId as query params for the bridge
            const pluginViewUrl = `${view.entry}?viewId=${view.id}&pluginId=${view.pluginId}`;
            webview.src = appendSocketQueryParams(pluginViewUrl);
            webview.style.width = '100%';
            webview.style.height = '100%';
            webview.style.border = 'none';
            // Allow plugins to have node integration if the main app allows it
            webview.setAttribute('nodeintegration', '');

            pane.appendChild(webview);
            contentContainer.appendChild(pane);

            // Attach listener
            if (window.attachTabListener) {
                window.attachTabListener(btn);
            }
        });

        // Re-check last active tab in case it was a plugin tab
        const lastTab = localStorage.getItem('activeTab');
        if (lastTab && lastTab.startsWith('plugin-')) {
            const tabToActivate = document.querySelector(`.tab-btn[data-tab="${lastTab}"]`);
            if (tabToActivate) {
                tabToActivate.click();
            }
        }
    });
}
// #endregion
/**
 * Injects the global premium tooltip system into a webview.
 * @param {HTMLWebViewElement} webview 
 */
function injectPremiumTooltips(webview) {
    const fs = require('fs');
    const path = require('path');
    const scriptPath = path.join(__dirname, 'views', 'scripts', 'tooltips.js');

    const doInject = () => {
        try {
            if (!fs.existsSync(scriptPath)) {
                console.error(`[Renderer] Tooltips script not found at: ${scriptPath}`);
                return;
            }
            const scriptContent = fs.readFileSync(scriptPath, 'utf8');
            if (typeof webview.executeJavaScript === 'function') {
                webview.executeJavaScript(scriptContent).then(() => {
                    console.log(`[Renderer] Successfully injected tooltips into ${webview.id || 'webview'}`);
                }).catch(() => {
                    // This often happens if the webview isn't fully ready, which is fine as dom-ready will catch it
                    console.warn(`[Renderer] Tooltip injection skipped/failed (normal if loading): ${webview.id || 'webview'}`);
                });
            } else {
                // Not ready yet, dom-ready will handle it later
            }
        } catch (err) {
            console.error('[Renderer] Critical error during tooltip injection:', err);
        }
    };

    // Inject on dominant ready event
    webview.addEventListener('dom-ready', doInject);

    // Also try to catch it if it's already there
    doInject();
}

// Global injection for all existing and future webviews
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.tagName === 'WEBVIEW') {
                injectPremiumTooltips(node);
            } else if (node.querySelectorAll) {
                node.querySelectorAll('webview').forEach(injectPremiumTooltips);
            }
        });
    });
});

observer.observe(document.body, { childList: true, subtree: true });

// Also handle webviews already in the DOM
document.querySelectorAll('webview').forEach(injectPremiumTooltips);

// #region STORY SCRIPT SECURITY
let currentSecurityResponseEvent = null;

socket.on('gui-security-warning', (data) => {
    const { scripts, responseEvent } = data;
    currentSecurityResponseEvent = responseEvent;

    console.log('[Renderer] Security Warning received:', scripts);

    const modal = document.getElementById('security-warning-modal');
    const listContainer = document.getElementById('unapproved-scripts-list');

    if (modal && listContainer) {
        listContainer.innerHTML = '';
        scripts.forEach(sc => {
            const item = document.createElement('div');
            item.className = 'security-script-item';
            item.style.marginBottom = '8px';
            item.style.padding = '5px 10px';
            item.style.background = 'rgba(255,255,255,0.05)';
            item.style.borderRadius = '4px';
            item.style.cursor = 'pointer';
            item.style.transition = 'background 0.2s';

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

            const identity = document.createElement('span');
            identity.style.cssText = 'display: flex; align-items: center; gap: 6px;';
            if (sc.hasDangerousKeywords) {
                const warning = document.createElement('span');
                warning.style.cssText = 'color: #ff9800; font-weight: bold; font-size: 0.85em; background: rgba(255,152,0,0.1); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid rgba(255,152,0,0.3);';
                warning.title = 'High-risk keywords detected';
                warning.textContent = '⚠️ WARNING ⚠️';
                identity.appendChild(warning);
            }

            const scriptLabel = document.createElement('span');
            scriptLabel.textContent = `> ${sc.name} (${sc.hash.substring(0, 8)}...)`;
            identity.appendChild(scriptLabel);

            const action = document.createElement('span');
            action.style.cssText = 'font-size: 0.8em; color: #b83b5e; font-weight: bold;';
            action.textContent = '(click to view code)';

            row.append(identity, action);
            item.appendChild(row);

            item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.1)');
            item.addEventListener('mouseleave', () => item.style.background = 'rgba(255,255,255,0.05)');

            item.addEventListener('click', () => {
                showScriptPreview(sc.name, sc.content || '');
            });

            listContainer.appendChild(item);
        });
        modal.classList.remove('hidden');
    }
});

socket.on('peek-script-content-response', (response) => {
    if (response && response.success) {
        // Find the script name from the filePath
        const fileName = response.filePath.split(/[\\\/]/).pop();
        showScriptPreview(fileName, response.content);
    } else {
        console.error('[Renderer] Failed to fetch script content for preview');
        alert('Failed to load script content.');
    }
});

const SECURITY_REGISTRY = {
    'File System Access': {
        color: '#f44336',
        description: 'Can allow a script to read, write, or delete files on your hard drive. Story scripts should rarely need this.',
        keywords: ['fs', 'fs-extra', 'readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'rmSync', 'rmdirSync', 'unlinkSync']
    },
    'Code Execution': {
        color: '#ff5722',
        description: 'Highly dangerous. Can run hidden terminal commands or background applications on your computer.',
        keywords: ['child_process', 'exec', 'execSync', 'spawn', 'eval', 'Function']
    },
    'Network & Data Stealing': {
        color: '#ff9800',
        description: 'Can be used to send your private data (like API keys) to an external server.',
        keywords: ['http', 'https', 'net', 'fetch', 'axios', 'node-fetch', 'request', 'XMLHttpRequest']
    },
    'Module Loading & Obfuscation': {
        color: '#ffc107',
        description: 'Common methods used to import dangerous modules or hide malicious activity.',
        keywords: ['require', 'import', 'Buffer.from', 'atob', 'btoa', 'process.env']
    },
    'System/Electron Control': {
        color: '#9c27b0',
        description: 'Direct access to the application\'s engine or operating system-level information.',
        keywords: ['electron', 'remote', 'ipcRenderer', '__dirname', '__filename']
    }
};

function showScriptPreview(name, content) {
    const modal = document.getElementById('script-preview-modal');
    const title = document.getElementById('preview-modal-title');
    const codeArea = document.getElementById('script-preview-code');
    const securityBox = document.getElementById('script-preview-security-box');
    const findingsList = document.getElementById('security-scan-findings');

    if (modal && title && codeArea) {
        title.textContent = `Preview: ${name}`;

        // 1. Scan for dangerous keywords
        const findings = [];
        const allKeywords = [];

        for (const [category, data] of Object.entries(SECURITY_REGISTRY)) {
            const matches = data.keywords.filter(kw => {
                const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
                return regex.test(content);
            });

            if (matches.length > 0) {
                findings.push({ category, matches, description: data.description, color: data.color });
                allKeywords.push(...matches);
            }
        }

        // 2. Update Security Information Box
        if (findings.length > 0) {
            findingsList.innerHTML = '';
            findings.forEach(f => {
                const li = document.createElement('li');
                li.innerHTML = `<strong style="color: ${f.color}">${f.category}:</strong> ${f.description} <br> <span style="opacity: 0.7; font-size: 0.9em;">Detected keywords: ${f.matches.join(', ')}</span>`;
                findingsList.appendChild(li);
            });
            securityBox.classList.remove('hidden');
        } else {
            securityBox.classList.add('hidden');
        }

        // 3. Highlight keywords in the code
        // We escape HTML first to be safe, then inject our spans
        let escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        if (allKeywords.length > 0) {
            // Sort keywords by length descending to avoid partial matches on longer strings (e.g., 'fs' vs 'fs-extra')
            const sortedKeywords = [...new Set(allKeywords)].sort((a, b) => b.length - a.length);

            sortedKeywords.forEach(kw => {
                const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
                escapedContent = escapedContent.replace(regex, `<span class="dangerous-keyword">${kw}</span>`);
            });

            codeArea.innerHTML = escapedContent;
        } else {
            codeArea.textContent = content; // Fallback to safe textContent
        }

        modal.classList.remove('hidden');
    }
}

function initializePreviewListeners() {
    const modal = document.getElementById('script-preview-modal');
    const closeBtn = document.getElementById('close-preview-btn');
    const closeFooterBtn = document.getElementById('close-preview-footer-btn');

    const close = () => {
        if (modal) modal.classList.add('hidden');
    };

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (closeFooterBtn) closeFooterBtn.addEventListener('click', close);

    // Also close on click outside
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
    }
}

const closeSecurityModal = (decision) => {
    const modal = document.getElementById('security-warning-modal');
    if (modal) modal.classList.add('hidden');
    console.log(`[Renderer] Closing security modal with decision: ${decision}`);
    if (currentSecurityResponseEvent === 'gui-security-decision') {
        console.log(`[Renderer] Emitting security decision: ${decision} via static event`);
        socket.emit('gui-security-decision', { decision: decision });

        currentSecurityResponseEvent = null;
    } else {
        console.warn(`[Renderer] Unknown security response event: ${currentSecurityResponseEvent}`);
    }
};

function initializeSecurityListeners() {
    console.log('[Renderer] Initializing Security Listeners...');

    const btnSafeMode = document.getElementById('security-btn-safe-mode');
    const btnTrust = document.getElementById('security-btn-trust');

    if (btnSafeMode) {
        console.log('[Renderer] Attached listener to Safe Mode button');
        btnSafeMode.addEventListener('click', () => closeSecurityModal('safe'));
    } else {
        console.error('[Renderer] Safe Mode button NOT found in DOM during initialization');
    }

    if (btnTrust) {
        console.log('[Renderer] Attached listener to Trust button');
        btnTrust.addEventListener('click', () => closeSecurityModal('trust'));
    } else {
        console.error('[Renderer] Trust & Execute button NOT found in DOM during initialization');
    }
}
// #endregion
