(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────
    const FILE_PATH = `__FILE_PATH__`;
    const ESTIMATE_TOKENS = (txt) => Math.ceil((txt || '').length / 4);
    const SOCKET = window.socket || null;
    const HOST_CONTAINER = document.getElementById('pluginViewContainer');
    const cleanupFns = [];
    let destroyed = false;

    function debugLog(message, data) {
        if (data !== undefined) console.log('[LoreBookUI]', message, data);
        else console.log('[LoreBookUI]', message);
    }

    function debugWarn(message, data) {
        if (data !== undefined) console.warn('[LoreBookUI]', message, data);
        else console.warn('[LoreBookUI]', message);
    }

    function addCleanup(fn) {
        cleanupFns.push(fn);
        return fn;
    }

    function cleanup() {
        if (destroyed) return;
        destroyed = true;
        debugLog('Cleaning up lore editor instance.', { filePath: FILE_PATH });

        while (cleanupFns.length) {
            const fn = cleanupFns.pop();
            try { fn(); } catch { }
        }

        if (HOST_CONTAINER && HOST_CONTAINER.__pluginCleanup === cleanup) {
            HOST_CONTAINER.__pluginCleanup = null;
        }
    }

    function emitSocket(eventName, payload) {
        if (!SOCKET) {
            debugWarn("Tried to emit '" + eventName + "' without an active socket.");
            return false;
        }
        debugLog("Emitting '" + eventName + "'.", payload);
        SOCKET.emit(eventName, payload);
        return true;
    }

    function onSocket(eventName, handler) {
        if (!SOCKET) return;
        debugLog("Registering socket listener '" + eventName + "'.");
        SOCKET.on(eventName, handler);
        addCleanup(() => {
            if (typeof SOCKET.off === 'function') {
                SOCKET.off(eventName, handler);
            }
        });
    }

    function onDom(target, eventName, handler, options) {
        if (!target) return;
        target.addEventListener(eventName, handler, options);
        addCleanup(() => target.removeEventListener(eventName, handler, options));
    }

    // ── State ──────────────────────────────────────────
    const S = {
        entries:    [],     // all entries from DB
        selected:   null,   // currently selected entry (id)
        dirty:      false,  // unsaved changes in editor
        keywords:   [],     // live keyword list for current entry
        search:     '',
        sort:       'priority',
        catFilter:  '__all__',
    };

    // ── DOM refs ───────────────────────────────────────
    const $  = (id) => document.getElementById(id);
    const el = {
        root:       $('lb-root'),
        list:       $('lb-list'),
        empty:      $('lb-empty'),
        editor:     $('lb-editor'),
        status:     $('lb-status'),
        fileName:   $('lb-file-name'),
        search:     $('lb-search'),
        sort:       $('lb-sort'),
        catFilter:  $('lb-cat-filter'),
        statTotal:  $('lb-stat-total'),
        statActive: $('lb-stat-active'),
        statTokens: $('lb-stat-tokens'),
        // editor fields
        name:       $('lb-name'),
        tagWrap:    $('lb-tag-wrap'),
        kwInput:    $('lb-kw-input'),
        content:    $('lb-content'),
        tokenCount: $('lb-token-count'),
        priority:   $('lb-priority'),
        priorityV:  $('lb-priority-val'),
        category:   $('lb-category'),
        scanDepth:  $('lb-scan-depth'),
        comment:    $('lb-comment'),
        saveStatus: $('lb-save-status'),
        saveBtn:    $('lb-save-btn'),
        deleteBtn:  $('lb-delete-btn'),
        crumbCat:   $('lb-crumb-cat'),
        crumbHits:  $('lb-crumb-hits'),
        // toggles
        togEnabled:  $('lb-tog-enabled'),
        togConstant: $('lb-tog-constant'),
        togCase:     $('lb-tog-case'),
        togWord:     $('lb-tog-word'),
        togRegex:    $('lb-tog-regex'),
        cbEnabled:   $('lb-enabled'),
        cbConstant:  $('lb-constant'),
        cbCase:      $('lb-case-sensitive'),
        cbWord:      $('lb-whole-word'),
        cbRegex:     $('lb-use-regex'),
    };

    if (HOST_CONTAINER) {
        HOST_CONTAINER.__pluginCleanup = cleanup;
    }

    if (window && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', cleanup);
        addCleanup(() => window.removeEventListener('beforeunload', cleanup));
    }

    if (window.MutationObserver && el.root) {
        const observer = new MutationObserver(() => {
            if (!document.body.contains(el.root)) {
                cleanup();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        addCleanup(() => observer.disconnect());
    }

    // ── Notification toast ─────────────────────────────
    function notify(msg, isErr) {
        const n = document.createElement('div');
        n.className = 'lb-notif' + (isErr ? ' lb-notif-err' : '');
        n.textContent = msg;
        document.body.appendChild(n);
        setTimeout(() => { n.classList.add('lb-fade'); setTimeout(() => n.remove(), 400); }, 2400);
    }

    function setStatus(message, tone) {
        el.status.textContent = message;
        el.status.classList.remove('lb-status-ok', 'lb-status-warn', 'lb-status-err');
        if (tone === 'ok') el.status.classList.add('lb-status-ok');
        if (tone === 'warn') el.status.classList.add('lb-status-warn');
        if (tone === 'err') el.status.classList.add('lb-status-err');
    }

    // ── Category filter population ─────────────────────
    function rebuildCatFilter() {
        const cats = ['__all__', ...new Set(S.entries.map(e => e.category || 'General').filter(Boolean))].sort();
        const cur  = el.catFilter.value;
        el.catFilter.innerHTML = cats.map(c =>
            '<option value="' + c + '">' + (c === '__all__' ? 'All categories' : c) + '</option>'
        ).join('');
        if (cats.includes(cur)) el.catFilter.value = cur;
    }

    // ── Filtered + sorted entry list ───────────────────
    function filteredEntries() {
        let list = S.entries.slice();
        const q  = S.search.toLowerCase().trim();

        if (q) {
            list = list.filter(e =>
                e.name.toLowerCase().includes(q) ||
                (e.keywords || []).some(k => k.toLowerCase().includes(q)) ||
                (e.category || '').toLowerCase().includes(q) ||
                (e.content   || '').toLowerCase().includes(q)
            );
        }
        if (S.catFilter !== '__all__') {
            list = list.filter(e => (e.category || 'General') === S.catFilter);
        }
        list.sort((a, b) => {
            if (S.sort === 'priority') return b.priority - a.priority;
            if (S.sort === 'name')     return a.name.localeCompare(b.name);
            if (S.sort === 'hits')     return b.hit_count - a.hit_count;
            if (S.sort === 'recent')   return (b.updated_at || '').localeCompare(a.updated_at || '');
            return 0;
        });
        return list;
    }

    // ── Render sidebar list ────────────────────────────
    function renderList() {
        const list = filteredEntries();
        rebuildCatFilter();

        // Stats
        const totalTok = S.entries.filter(e => e.enabled).reduce((s, e) => s + ESTIMATE_TOKENS(e.content), 0);
        el.statTotal.textContent  = S.entries.length;
        el.statActive.textContent = S.entries.filter(e => e.enabled).length;
        el.statTokens.textContent = totalTok;

        if (list.length === 0) {
            el.list.innerHTML = '<div style="padding:20px;text-align:center;color:#555;font-size:12px;">' +
                (S.search ? 'No entries match your search.' : 'No entries yet. Create one!') + '</div>';
            return;
        }

        el.list.innerHTML = list.map(e => {
            const kws     = e.keywords || [];
            const shown   = kws.slice(0, 2);
            const more    = kws.length - shown.length;
            const prioCol = e.priority >= 75 ? '#00e5ff' : e.priority >= 40 ? '#aaa' : '#555';
            return (
                '<div class="lb-entry-card' +
                (e.id === S.selected ? ' lb-selected' : '') +
                (!e.enabled ? ' lb-disabled' : '') +
                '" data-id="' + e.id + '">' +
                '<div class="lb-card-body">' +
                '<div class="lb-card-name">' +
                '<span class="lb-status-dot' + (e.enabled ? ' lb-active' : '') + '"></span>' +
                esc(e.name) + '</div>' +
                '<div class="lb-card-keywords">' +
                shown.map(k => '<span class="lb-kw-chip" title="' + esc(k) + '">' + esc(k) + '</span>').join('') +
                (more > 0 ? '<span class="lb-kw-more">+' + more + '</span>' : '') +
                (!kws.length && !e.constant ? '<span class="lb-kw-more" style="color:#555">no keywords</span>' : '') +
                (e.constant ? '<span class="lb-kw-chip" style="color:#ffc800;border-color:rgba(255,200,0,0.25);background:rgba(255,200,0,0.08)">★ always</span>' : '') +
                '</div>' +
                '<div class="lb-card-meta">' +
                '<span class="lb-priority-pip" style="color:' + prioCol + '">' + e.priority + '</span>' +
                '<span class="lb-cat-label">' + esc(e.category || 'General') + '</span>' +
                (e.hit_count > 0 ? '<span class="lb-cat-label">· ' + e.hit_count + ' hits</span>' : '') +
                '</div>' +
                '</div>' +
                '</div>'
            );
        }).join('');

        // Click to select
        el.list.querySelectorAll('.lb-entry-card').forEach(card => {
            card.addEventListener('click', () => selectEntry(parseInt(card.dataset.id, 10)));
        });
    }

    // ── HTML escape ────────────────────────────────────
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Toggle helper ──────────────────────────────────
    function setToggle(wrapper, cb, val) {
        cb.checked = val;
        if (val) wrapper.classList.add('lb-toggle-on');
        else      wrapper.classList.remove('lb-toggle-on');
    }

    // ── Priority slider track fill ─────────────────────
    function updateSliderFill(val) {
        el.priority.style.setProperty('--pct', val + '%');
        el.priorityV.textContent = val;
    }

    // ── Keyword tag rendering ──────────────────────────
    function renderTags() {
        // Remove old tags (keep the input)
        Array.from(el.tagWrap.querySelectorAll('.lb-tag')).forEach(t => t.remove());
        const frag = document.createDocumentFragment();
        S.keywords.forEach((kw, i) => {
            const tag = document.createElement('span');
            tag.className = 'lb-tag';
            const sp = document.createElement('span');
            sp.textContent = kw;
            const x = document.createElement('span');
            x.className = 'lb-tag-x';
            x.textContent = '×';
            x.addEventListener('click', (ev) => { ev.stopPropagation(); removeKeyword(i); });
            tag.appendChild(sp);
            tag.appendChild(x);
            frag.appendChild(tag);
        });
        el.tagWrap.insertBefore(frag, el.kwInput);
        markDirty();
    }

    function addKeyword(raw) {
        const kw = raw.trim();
        if (!kw || S.keywords.includes(kw)) return;
        S.keywords.push(kw);
        renderTags();
    }

    function removeKeyword(idx) {
        S.keywords.splice(idx, 1);
        renderTags();
    }

    // ── Select entry ───────────────────────────────────
    function selectEntry(id) {
        if (S.dirty) {
            // Auto-save on switch to avoid frustrating data loss
            saveEntry(false);
        }
        const entry = S.entries.find(e => e.id === id);
        if (!entry) return;

        S.selected = id;
        S.dirty    = false;
        S.keywords = Array.isArray(entry.keywords) ? entry.keywords.slice() : [];

        el.empty.style.display  = 'none';
        el.editor.style.display = 'flex';

        el.name.value     = entry.name || '';
        el.content.value  = entry.content || '';
        el.priority.value = entry.priority ?? 50;

        el.category.value = entry.category || 'General';
        el.scanDepth.value = (entry.scan_depth !== null && entry.scan_depth !== undefined) ? entry.scan_depth : '';
        el.comment.value  = entry.comment || '';

        setToggle(el.togEnabled,  el.cbEnabled,  entry.enabled);
        setToggle(el.togConstant, el.cbConstant, entry.constant);
        setToggle(el.togCase,     el.cbCase,     entry.case_sensitive);
        setToggle(el.togWord,     el.cbWord,     entry.match_whole_word);
        setToggle(el.togRegex,    el.cbRegex,    entry.use_regex);

        updateSliderFill(entry.priority ?? 50);
        updateTokenCount();

        el.crumbCat.textContent  = entry.category || 'General';
        el.crumbHits.textContent = entry.hit_count + ' hits';

        renderTags();
        el.saveStatus.textContent = '';
        renderList(); // refresh selection highlight
    }

    function updateTokenCount() {
        const t = ESTIMATE_TOKENS(el.content.value);
        el.tokenCount.textContent = t + ' tokens';
    }

    function markDirty() {
        S.dirty = true;
        el.saveStatus.textContent = '● unsaved';
    }

    // ── Collect current editor state ───────────────────
    function collectEntry() {
        return {
            id:              S.selected || undefined,
            name:            el.name.value.trim(),
            keywords:        S.keywords,
            content:         el.content.value,
            priority:        parseInt(el.priority.value, 10),
            enabled:         el.cbEnabled.checked,
            constant:        el.cbConstant.checked,

            category:        el.category.value.trim() || 'General',
            case_sensitive:  el.cbCase.checked,
            use_regex:       el.cbRegex.checked,
            match_whole_word: el.cbWord.checked,
            scan_depth:      el.scanDepth.value !== '' ? parseInt(el.scanDepth.value, 10) : null,
            comment:         el.comment.value,
        };
    }

    // ── Save ───────────────────────────────────────────
    function saveEntry(notify_user) {
        if (!SOCKET) return;
        const entry = collectEntry();
        el.saveStatus.textContent = '⏳ Saving…';
        el.saveBtn.disabled = true;
        emitSocket('lore-book:upsert-entry', { filePath: FILE_PATH, entry });
        S.dirty = false;
        if (notify_user !== false) {
            // feedback handled by lore-book:entry-saved listener
        }
    }

    // ── New entry ──────────────────────────────────────
    function newEntry() {
        emitSocket('lore-book:upsert-entry', {
            filePath: FILE_PATH,
            entry: { name: '', keywords: [], content: '', priority: 50, enabled: true }
        });
    }

    // ── Delete ─────────────────────────────────────────
    function deleteEntry() {
        if (!S.selected) return;
        const entry = S.entries.find(e => e.id === S.selected);
        if (!entry) return;
        if (!confirm('Delete "' + entry.name + '"? This cannot be undone.')) return;
        emitSocket('lore-book:delete-entry', { filePath: FILE_PATH, id: S.selected });
    }

    // ── Socket listeners ───────────────────────────────
    function initSocket() {
        if (!SOCKET) {
            debugWarn('No socket found during initSocket().');
            setStatus('No socket available. Lore editor cannot connect.', 'err');
            return;
        }

        debugLog('Initializing socket connection for lore editor.', {
            filePath: FILE_PATH,
            socketId: SOCKET.id || null,
            connected: !!SOCKET.connected
        });
        emitSocket('lore-book:ping', { filePath: FILE_PATH, source: 'editor-init' });
        emitSocket('lore-book:load', { filePath: FILE_PATH });
        setTimeout(() => {
            if (!S.entries.length && !S.selected && el.status.textContent.includes('Connecting')) {
                debugWarn('No lore-book response received yet after initial load request.', {
                    filePath: FILE_PATH,
                    socketId: SOCKET.id || null,
                    connected: !!SOCKET.connected
                });
                setStatus('Still waiting for lore backend response. Check console logs for lore-book events.', 'warn');
            }
        }, 2000);

        onSocket('lore-book:loaded', ({ filePath, entries }) => {
            if (filePath !== FILE_PATH) return;
            debugLog('Received lore-book:loaded.', { filePath, count: entries.length });
            S.entries = entries;
            el.fileName.textContent = FILE_PATH.split(/[\\/]/).pop();
            setStatus('Archive connected.', 'ok');
            renderList();
            // Re-select if still valid
            if (S.selected && S.entries.find(e => e.id === S.selected)) {
                selectEntry(S.selected);
            }
        });

        onSocket('lore-book:entry-saved', ({ filePath, entry, isNew }) => {
            if (filePath !== FILE_PATH) return;
            debugLog('Received lore-book:entry-saved.', { filePath, id: entry.id, isNew });
            el.saveBtn.disabled = false;
            if (isNew) {
                S.entries.push(entry);
                selectEntry(entry.id);
            } else {
                const idx = S.entries.findIndex(e => e.id === entry.id);
                if (idx !== -1) {
                    S.entries[idx] = entry;
                    if (S.selected === entry.id) {
                        el.crumbHits.textContent = entry.hit_count + ' hits';
                        if (el.name.value === '' || el.name.value === 'New Entry') {
                            el.name.value = entry.name;
                        }
                        renderList(); // Refresh sidebar title/status
                    }
                }
            }
            el.saveStatus.textContent = '✓ Saved';
            el.crumbHits.textContent  = entry.hit_count + ' hits';
            setTimeout(() => { el.saveStatus.textContent = ''; }, 2000);
            rebuildCatFilter();
            renderList();
        });

        onSocket('lore-book:entry-deleted', ({ filePath, id }) => {
            if (filePath !== FILE_PATH) return;
            debugLog('Received lore-book:entry-deleted.', { filePath, id });
            S.entries = S.entries.filter(e => e.id !== id);
            S.selected = null;
            S.dirty    = false;
            el.editor.style.display = 'none';
            el.empty.style.display  = 'flex';
            renderList();
            notify('Entry deleted.');
        });

        onSocket('lore-book:exported', ({ filePath, data }) => {
            if (filePath !== FILE_PATH) return;
            debugLog('Received lore-book:exported.', { filePath, count: data.entries.length });
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = (data.book || 'lorebook') + '.json';
            a.click();
            URL.revokeObjectURL(url);
            notify('Exported ' + data.entries.length + ' entries.');
        });

        onSocket('lore-book:pong', (data) => {
            debugLog('Received lore-book:pong.', data);
            setStatus('Archive link stable · ' + data.serverTime, 'ok');
        });

        onSocket('lore-book:error', ({ message }) => {
            debugWarn('Received lore-book:error.', { message });
            setStatus('Backend error: ' + message, 'err');
            notify('Error: ' + message, true);
            el.saveBtn.disabled     = false;
            el.saveStatus.textContent = '';
        });
    }

    // ── Event wiring ───────────────────────────────────
    function initEvents() {
        // Sidebar controls
        el.search.addEventListener('input',  () => { S.search    = el.search.value;    renderList(); });
        el.sort.addEventListener('change',   () => { S.sort      = el.sort.value;       renderList(); });
        el.catFilter.addEventListener('change', () => { S.catFilter = el.catFilter.value; renderList(); });

        // New entry
        $('lb-new-btn').addEventListener('click',       newEntry);
        $('lb-empty-new').addEventListener('click',     newEntry);

        // Save & delete
        el.saveBtn.addEventListener('click',   () => saveEntry(true));
        el.deleteBtn.addEventListener('click', deleteEntry);

        // Keyboard shortcuts
        onDom(document, 'keydown', (ev) => {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
                ev.preventDefault();
                if (S.selected) saveEntry(true);
            }
        });

        // Editor field changes → mark dirty
        [el.name, el.content, el.category, el.scanDepth, el.comment].forEach(f => {
            f.addEventListener('input', markDirty);
        });
        el.content.addEventListener('input', updateTokenCount);

        // Priority slider
        el.priority.addEventListener('input', () => {
            updateSliderFill(el.priority.value);
            markDirty();
        });

        // Toggle clicks
        [
            [el.togEnabled,  el.cbEnabled],
            [el.togConstant, el.cbConstant],
            [el.togCase,     el.cbCase],
            [el.togWord,     el.cbWord],
            [el.togRegex,    el.cbRegex],
        ].forEach(([wrap, cb]) => {
            wrap.addEventListener('click', () => {
                cb.checked = !cb.checked;
                cb.checked ? wrap.classList.add('lb-toggle-on') : wrap.classList.remove('lb-toggle-on');
                markDirty();
            });
        });

        // Keyword tag input
        el.kwInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ',') {
                ev.preventDefault();
                addKeyword(el.kwInput.value);
                el.kwInput.value = '';
            } else if (ev.key === 'Backspace' && !el.kwInput.value && S.keywords.length) {
                removeKeyword(S.keywords.length - 1);
            }
        });
        el.kwInput.addEventListener('blur', () => {
            if (el.kwInput.value.trim()) {
                addKeyword(el.kwInput.value);
                el.kwInput.value = '';
            }
        });
        el.tagWrap.addEventListener('click', () => el.kwInput.focus());

        // Export
        $('lb-export-btn').addEventListener('click', () => {
            if (!SOCKET) return;
            emitSocket('lore-book:export', { filePath: FILE_PATH });
        });

        // Import
        $('lb-import-btn').addEventListener('click', () => $('lb-import-file').click());
        $('lb-import-file').addEventListener('change', (ev) => {
            const file = ev.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.entries) throw new Error('Invalid lorebook format.');
                    const mode = confirm(
                        'Import ' + data.entries.length + ' entries.\n\n' +
                        'OK = Merge with existing\nCancel = Replace all existing'
                    ) ? 'merge' : 'replace';
                    emitSocket('lore-book:import', { filePath: FILE_PATH, importData: data, mode });
                } catch (err) {
                    notify('Import failed: ' + err.message, true);
                }
            };
            reader.readAsText(file);
            ev.target.value = '';
        });
    }

    // ── Boot ───────────────────────────────────────────
    function init() {
        debugLog('Booting lore editor.', {
            filePath: FILE_PATH,
            hasSocket: !!SOCKET
        });
        el.fileName.textContent = FILE_PATH.split(/[\\/]/).pop();
        setStatus('Connecting to archive...', 'warn');
        initEvents();
        initSocket();
    }

    init();
})();
