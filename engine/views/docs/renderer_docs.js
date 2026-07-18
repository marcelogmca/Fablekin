/**
 * renderer_docs.js
 * Optimized logic for the Technical Archive documentation portal.
 */
document.addEventListener('DOMContentLoaded', () => {
    window.DOCS_INDEX = window.DOCS_INDEX || [];

    const socket = window.io();
    const nav = document.getElementById('docs-nav');
    const docContent = document.getElementById('doc-content');
    const welcomeScreen = document.getElementById('welcome-screen');
    const btnBack = document.getElementById('btn-back');
    const quickLinks = document.getElementById('quick-links');
    const searchInput = document.getElementById('search-docs');
    const breadcrumbs = document.getElementById('breadcrumbs');

    let currentDocId = null;
    let docsTree = {};

    const NAV_GROUP_ORDER = [
        'user_guides',
        'plugin_development',
        'engine_reference',
        'plugin_documentation'
    ];

    const NAV_LABELS = {
        user_guides: 'User Guides',
        workspace_and_content: 'Workspace & Content',
        plugin_development: 'Plugin Development',
        engine_reference: 'Engine Reference',
        plugin_documentation: 'Plugin Documentation',
        getting_started: 'Getting Started',
        game_over_sdk: 'Game Over SDK',
        gui_intercept_sdk: 'GUI Intercept SDK',
        memory_lod: 'Memory LOD',
        persona_engine: 'Persona Engine',
        plugin_db_best_practices: 'Plugin Database Best Practices',
        plugin_dev: 'Plugin Development 101',
        plugin_sdk_tooling: 'Plugin SDK',
        sprite_setup: 'Sprite Setup',
        story_scripts: 'Story Scripts',
        ui: 'UI',
        vn: 'Visual Novel',
        vn_api: 'Visual Novel API',
        vn_rendering: 'Visual Novel Rendering'
    };

    const USER_GUIDE_SECTIONS = new Set(['getting_started', 'management', 'sprite_setup']);
    const USER_GUIDE_TOOL_DOCS = new Set([
        'content_manager_logic',
        'content_modes',
        'project_selector',
        'utility_views',
        'workspace_manager'
    ]);
    const PLUGIN_DEVELOPMENT_SECTIONS = new Set([
        'game_over_sdk',
        'gui_intercept_sdk',
        'plugin_db_best_practices',
        'plugin_dev',
        'plugin_sdk_tooling',
        'plugins',
        'story_scripts'
    ]);

    const FEATURED_DOCS = [
        {
            id: 'getting_started',
            title: 'Getting Started',
            description: 'Set up Fablekin, create a project, and generate your first story turn.'
        },
        {
            id: 'content_modes',
            title: 'Workspace & Content',
            description: 'Learn how projects, files, content modes, and the Content Manager fit together.'
        },
        {
            id: 'llm_orchestration',
            title: 'Models & Routing',
            description: 'Understand model tiers, aliases, providers, and how requests are routed.'
        },
        {
            id: 'plugin_dev',
            title: 'Plugin Development',
            description: 'Start building plugins with the SDK, examples, and security guidance.'
        }
    ];

    function getDocPriority(doc) {
        if (!doc || typeof doc !== 'object') return 0;
        // Prefer rich HTML docs over generated markdown companions when both exist.
        if (doc.extension === '.html') return 3;
        if (doc.extension === '.md') return 2;
        return 1;
    }

    function normalizePathParts(rawPath) {
        const normalized = [];
        String(rawPath || '').replace(/\\/g, '/').split('/').forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') {
                normalized.pop();
                return;
            }
            normalized.push(part);
        });
        return normalized;
    }

    function formatNavLabel(key) {
        if (NAV_LABELS[key]) return NAV_LABELS[key];
        return String(key || '')
            .replace(/\.[^/.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, character => character.toUpperCase())
            .replace(/\bApi\b/g, 'API')
            .replace(/\bGui\b/g, 'GUI')
            .replace(/\bIpc\b/g, 'IPC')
            .replace(/\bLlm\b/g, 'LLM')
            .replace(/\bSdk\b/g, 'SDK')
            .replace(/\bUi\b/g, 'UI')
            .replace(/\bVn\b/g, 'VN');
    }

    function getCoreDocParts(doc) {
        const parts = normalizePathParts(doc?.path);
        const coreIndex = parts.indexOf('core');
        if (coreIndex >= 0) return parts.slice(coreIndex + 1);
        const documentsIndex = parts.indexOf('documents');
        return documentsIndex >= 0 ? parts.slice(documentsIndex + 1) : parts;
    }

    function getNavigationParts(doc) {
        if (doc?.pluginId && doc.pluginId !== 'core') {
            const fileName = normalizePathParts(doc.path).at(-1) || `${doc.id || 'documentation'}.md`;
            return ['plugin_documentation', doc.pluginId, fileName];
        }

        const sourceParts = getCoreDocParts(doc);
        const section = sourceParts[0] || 'system';
        const remainder = sourceParts.slice(1);

        if (USER_GUIDE_TOOL_DOCS.has(doc?.id)) {
            return ['user_guides', 'workspace_and_content', ...remainder];
        }
        if (USER_GUIDE_SECTIONS.has(section)) {
            return ['user_guides', section, ...remainder];
        }
        if (PLUGIN_DEVELOPMENT_SECTIONS.has(section)) {
            return ['plugin_development', section, ...remainder];
        }
        return ['engine_reference', section, ...remainder];
    }

    // 1. Build a human-facing hierarchy without exposing fetch paths.
    function buildTree(docs) {
        const tree = {};
        docs.forEach(doc => {
            const relevantParts = getNavigationParts(doc);
            if (relevantParts.length === 0) return;
            
            let current = tree;
            for (let i = 0; i < relevantParts.length; i++) {
                const part = relevantParts[i];
                const isFile = i === relevantParts.length - 1;
                
                if (!current[part]) {
                    current[part] = isFile ? { _doc: doc } : { _isFolder: true, _children: {} };
                }
                
                if (!isFile) {
                    current = current[part]._children;
                }
            }
        });
        return tree;
    }

    // 2. Render Tree
    function renderTree(node, container, level = 0, pathPrefix = []) {
        const sortedKeys = Object.keys(node).sort((a, b) => {
            // Folders first, then alphabetical
            const aIsFolder = node[a]._isFolder;
            const bIsFolder = node[b]._isFolder;
            if (aIsFolder && !bIsFolder) return -1;
            if (!aIsFolder && bIsFolder) return 1;
            if (level === 0) {
                const aIndex = NAV_GROUP_ORDER.indexOf(a);
                const bIndex = NAV_GROUP_ORDER.indexOf(b);
                if (aIndex !== bIndex) return aIndex - bIndex;
            }
            return a.localeCompare(b);
        });

        sortedKeys.forEach(key => {
            const item = node[key];
            const currentPath = [...pathPrefix, key];
            const element = document.createElement('div');
            element.className = 'tree-node';
            
            const label = document.createElement('div');
            label.className = 'tree-label';
            
            const icon = document.createElement('svg');
            icon.className = 'tree-icon';
            icon.setAttribute('viewBox', '0 0 24 24');
            
            if (item._isFolder) {
                element.classList.add('folder-node');
                if (level === 0 && key === 'user_guides') element.classList.add('expanded');
                icon.innerHTML = '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>';
                label.appendChild(icon);
                const labelText = document.createElement('span');
                labelText.textContent = formatNavLabel(key);
                label.appendChild(labelText);
                label.dataset.treePath = currentPath.join('/');
                
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    element.classList.toggle('expanded');
                });
                
                renderTree(item._children, childrenContainer, level + 1, currentPath);
                element.appendChild(label);
                element.appendChild(childrenContainer);
            } else {
                element.classList.add('file-node');
                if (item._doc.id === currentDocId) element.classList.add('active');
                
                icon.innerHTML = '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>';
                label.appendChild(icon);
                const labelText = document.createElement('span');
                labelText.textContent = item._doc.title;
                label.appendChild(labelText);
                label.dataset.id = item._doc.id;
                label.dataset.treePath = currentPath.join('/');
                
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openDoc(item._doc.id);
                });
                
                element.appendChild(label);
            }
            
            container.appendChild(element);
        });
    }

    // 3. Open Document
    function findAnchor(anchor) {
        let decoded = String(anchor || '').replace(/^#/, '');
        try {
            decoded = decodeURIComponent(decoded);
        } catch (_) {
            // Keep the original fragment when it is not valid URI encoding.
        }
        return Array.from(docContent.querySelectorAll('[id]')).find(element => element.id === decoded) || null;
    }

    function scrollToAnchor(anchor) {
        const target = findAnchor(anchor);
        if (!target) return false;
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function normalizeDocPath(rawPath) {
        const normalized = [];
        String(rawPath || '').replace(/\\/g, '/').split('/').forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') {
                normalized.pop();
                return;
            }
            normalized.push(part);
        });
        return normalized.join('/');
    }

    function choosePreferredDoc(candidates) {
        return candidates.slice().sort((a, b) => getDocPriority(b) - getDocPriority(a))[0] || null;
    }

    function resolveInternalDoc(href) {
        const currentDoc = window.DOCS_INDEX.find(doc => doc.id === currentDocId);
        if (!currentDoc) return null;

        const [rawPath, rawFragment = ''] = String(href || '').split('#', 2);
        if (!rawPath) return { doc: currentDoc, fragment: rawFragment };
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawPath)) return null;

        const baseParts = currentDoc.path.replace(/\\/g, '/').split('/');
        baseParts.pop();
        const targetPath = normalizeDocPath(
            rawPath.startsWith('/') ? rawPath.slice(1) : [...baseParts, rawPath].join('/')
        );
        const targetBase = targetPath.replace(/\.(?:html|md)$/i, '');
        const candidates = window.DOCS_INDEX.filter(doc => {
            const docPath = normalizeDocPath(doc.path);
            const docBase = docPath.replace(/\.(?:html|md)$/i, '');
            return docPath === targetPath || docBase === targetBase || docBase === `${targetPath}/index`;
        });

        const doc = choosePreferredDoc(candidates);
        return doc ? { doc, fragment: rawFragment } : null;
    }

    async function openDoc(id, anchor = '') {
        const doc = window.DOCS_INDEX.find(d => d.id === id);
        if (!doc) return;

        currentDocId = id;

        // Update Nav UI
        document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
        const activeLabel = document.querySelector(`.tree-label[data-id="${id}"]`);
        if (activeLabel) activeLabel.parentElement.classList.add('active');

        welcomeScreen.classList.add('hidden');
        docContent.classList.remove('hidden');
        btnBack.classList.remove('hidden');

        updateBreadcrumbs(doc);

        try {
            const response = await fetch(doc.path);
            if (!response.ok) throw new Error('Failed to load document');
            const content = await response.text();
            
            if (doc.extension === '.md') {
                docContent.innerHTML = marked.parse(content);
            } else {
                // If HTML, we try to extract the body or just inject it
                const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                docContent.innerHTML = bodyMatch ? bodyMatch[1] : content;
            }
            
            // Scroll to top
            document.querySelector('.doc-viewer').scrollTop = 0;
            if (anchor) scrollToAnchor(anchor);
            
        } catch (error) {
            docContent.innerHTML = `<div class="error">Failed to load: ${error.message}</div>`;
        }
    }

    // Keep documentation navigation inside the Docs shell. External links remain blocked.
    docContent.addEventListener('click', (event) => {
        const link = event.target?.closest?.('a');
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();

        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) {
            scrollToAnchor(href);
            return;
        }

        const target = resolveInternalDoc(href);
        if (!target?.doc?.id) return;
        if (target.doc.id === currentDocId) {
            if (target.fragment) scrollToAnchor(target.fragment);
            return;
        }
        openDoc(target.doc.id, target.fragment);
    });

    function focusTreePath(treePath) {
        if (!treePath) return;
        const label = nav.querySelector(`.tree-label[data-tree-path="${treePath}"]`);
        if (!label) return;

        let node = label.closest('.tree-node');
        while (node) {
            if (node.classList.contains('folder-node')) node.classList.add('expanded');
            node = node.parentElement ? node.parentElement.closest('.tree-node') : null;
        }

        label.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function renderRootBreadcrumb() {
        breadcrumbs.innerHTML = '';
        const root = document.createElement('span');
        root.className = 'breadcrumb-item';
        root.textContent = 'Docs';
        root.addEventListener('click', resetToIndex);
        breadcrumbs.appendChild(root);
    }

    // 4. Breadcrumbs
    function updateBreadcrumbs(doc) {
        const relevantParts = getNavigationParts(doc);
        renderRootBreadcrumb();

        relevantParts.forEach((part, i) => {
            const span = document.createElement('span');
            span.className = 'breadcrumb-item';
            const isLeaf = i === relevantParts.length - 1;
            span.textContent = isLeaf ? doc.title : formatNavLabel(part);
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isLeaf) focusTreePath(relevantParts.slice(0, i + 1).join('/'));
            });
            breadcrumbs.appendChild(span);
        });
    }

    // 5. Search
    function handleSearch() {
        const query = searchInput.value.toLowerCase();
        if (!query) {
            renderNav();
            return;
        }

        const filtered = window.DOCS_INDEX.filter(d =>
            String(d.title || '').toLowerCase().includes(query) ||
            String(d.description || '').toLowerCase().includes(query) ||
            String(d.category || '').toLowerCase().includes(query)
        );

        nav.innerHTML = '';
        if (filtered.length === 0) {
            nav.innerHTML = '<div class="no-results">No documents found</div>';
            return;
        }

        const resultsGroup = document.createElement('div');
        resultsGroup.className = 'search-results';
        
        filtered.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'tree-label';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.classList.add('tree-icon');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.innerHTML = '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>';
            const label = document.createElement('span');
            label.textContent = doc.title;
            item.append(icon, label);
            item.addEventListener('click', () => openDoc(doc.id));
            resultsGroup.appendChild(item);
        });
        nav.appendChild(resultsGroup);
    }

    searchInput.addEventListener('input', handleSearch);

    // 6. Reset to Index
    function resetToIndex() {
        docContent.innerHTML = '';
        welcomeScreen.classList.remove('hidden');
        docContent.classList.add('hidden');
        btnBack.classList.add('hidden');
        document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
        currentDocId = null;
        renderRootBreadcrumb();
    }

    window.resetToIndex = resetToIndex;
    btnBack.addEventListener('click', resetToIndex);

    // 7. Render Navigation
    function renderNav() {
        nav.innerHTML = '';
        docsTree = buildTree(window.DOCS_INDEX);
        renderTree(docsTree, nav);
        
        // Keep the landing page useful and stable instead of relying on scan order.
        quickLinks.innerHTML = '';
        FEATURED_DOCS.forEach(feature => {
            const doc = choosePreferredDoc(window.DOCS_INDEX.filter(candidate => candidate.id === feature.id));
            if (!doc) return;
            const qLink = document.createElement('button');
            qLink.type = 'button';
            qLink.className = 'quick-link-item';
            const title = document.createElement('h4');
            title.textContent = feature.title;
            const description = document.createElement('p');
            description.textContent = feature.description;
            qLink.append(title, description);
            qLink.addEventListener('click', () => openDoc(doc.id));
            quickLinks.appendChild(qLink);
        });
    }

    // 8. Socket Handlers
    socket.on('docs:open', (data) => {
        if (data && data.docId) openDoc(data.docId);
    });

    socket.on('docs:res-index', (dynamicDocs) => {
        mergeDynamicDocs(dynamicDocs);
    });

    socket.on('docs:index-updated', (dynamicDocs) => {
        mergeDynamicDocs(dynamicDocs);
    });

    function mergeDynamicDocs(dynamicDocs) {
        if (!dynamicDocs || !Array.isArray(dynamicDocs)) return;
        dynamicDocs.forEach(newDoc => {
            const index = window.DOCS_INDEX.findIndex(d => d.id === newDoc.id);
            if (index !== -1) {
                const current = window.DOCS_INDEX[index];
                const currentPriority = getDocPriority(current);
                const incomingPriority = getDocPriority(newDoc);
                if (incomingPriority >= currentPriority) {
                    window.DOCS_INDEX[index] = { ...current, ...newDoc };
                }
            } else {
                window.DOCS_INDEX.push(newDoc);
            }
        });
        renderNav();
    }

    // Initialize
    socket.emit('docs:req-index');
    console.log('[Docs] System Initialized.');
});
