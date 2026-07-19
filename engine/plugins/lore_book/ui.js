(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────
    const FILE_PATH = '{{LORE_BOOK_PATH}}';
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
        const debugPayload = payload && payload.importData
            ? { ...payload, importData: '[lorebook payload omitted]' }
            : payload;
        debugLog("Emitting '" + eventName + "'.", debugPayload);
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
        secondaryKeywords: [],
        bookSettings: {
            token_budget: null,
            default_scan_depth: null,
            scan_depth_unit: 'chapters',
            recursive_scanning: true,
        },
        search:     '',
        sort:       'priority',
        catFilter:  '__all__',
        pendingImport: null,
        pendingImportName: '',
        applySourceSettings: true,
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
        secondaryTagWrap: $('lb-secondary-tag-wrap'),
        secondaryKwInput: $('lb-secondary-kw-input'),
        content:    $('lb-content'),
        tokenCount: $('lb-token-count'),
        priority:   $('lb-priority'),
        priorityV:  $('lb-priority-val'),
        category:   $('lb-category'),
        scanDepth:  $('lb-scan-depth'),
        scanDepthUnit: $('lb-scan-depth-unit'),
        position:   $('lb-position'),
        selectiveLogic: $('lb-selective-logic'),
        probability: $('lb-probability'),
        recursionDelay: $('lb-recursion-delay'),
        diagnostic: $('lb-diagnostic'),
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
        togSelective: $('lb-tog-selective'),
        togProbability: $('lb-tog-probability'),
        togExcludeRecursion: $('lb-tog-exclude-recursion'),
        togPreventRecursion: $('lb-tog-prevent-recursion'),
        togIgnoreBudget: $('lb-tog-ignore-budget'),
        togIncludeName: $('lb-tog-include-name'),
        cbEnabled:   $('lb-enabled'),
        cbConstant:  $('lb-constant'),
        cbCase:      $('lb-case-sensitive'),
        cbWord:      $('lb-whole-word'),
        cbRegex:     $('lb-use-regex'),
        cbSelective: $('lb-selective'),
        cbProbability: $('lb-use-probability'),
        cbExcludeRecursion: $('lb-exclude-recursion'),
        cbPreventRecursion: $('lb-prevent-recursion'),
        cbIgnoreBudget: $('lb-ignore-budget'),
        cbIncludeName: $('lb-include-name'),
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

    function addImportStat(container, value, label, tone) {
        const stat = document.createElement('div');
        stat.className = 'lb-import-stat' + (tone ? ` lb-import-stat-${tone}` : '');
        const number = document.createElement('strong');
        number.textContent = String(value);
        const caption = document.createElement('span');
        caption.textContent = label;
        stat.append(number, caption);
        container.appendChild(stat);
    }

    function hasImportWarnings(report) {
        return report.skippedEntries > 0 || report.disabledEntries > 0 ||
            (report.warnings || []).some(item => (item.severity || 'warning') === 'warning');
    }

    function formatRecommendedSettings(settings) {
        const parts = [];
        if (settings.token_budget) parts.push(`${settings.token_budget} lore tokens`);
        if (settings.default_scan_depth !== null && settings.default_scan_depth !== undefined) {
            parts.push(`${settings.default_scan_depth} ${settings.scan_depth_unit || 'chapters'}`);
        }
        if (settings.recursive_scanning !== undefined) {
            parts.push(`recursion ${settings.recursive_scanning ? 'enabled' : 'disabled'}`);
        }
        return parts.join(', ');
    }

    function buildImportReport(report, { completed = false, showSourceSettings = false } = {}) {
        const root = document.createElement('div');
        root.className = 'lb-import-report';

        const intro = document.createElement('p');
        intro.className = 'lb-import-intro';
        intro.textContent = completed
            ? `Finished importing “${report.bookName}”. Imported data, compatibility notes, and any unsupported rules are summarized below.`
            : `Detected “${report.bookName}” as ${String(report.format).replaceAll('_', ' ')}. Review the compatibility report before importing.`;
        root.appendChild(intro);

        const stats = document.createElement('div');
        stats.className = 'lb-import-stats';
        addImportStat(stats, report.sourceEntries, 'Source entries');
        addImportStat(stats, report.importedEntries, completed ? 'Imported' : 'Importable', 'ok');
        addImportStat(stats, report.disabledEntries, 'Disabled for review', report.disabledEntries ? 'warn' : 'ok');
        addImportStat(stats, report.skippedEntries, 'Skipped', report.skippedEntries ? 'danger' : 'ok');
        root.appendChild(stats);

        if (report.warnings && report.warnings.length) {
            const sections = [
                { severity: 'warning', title: 'Unsupported rules requiring review' },
                { severity: 'approximation', title: 'Safe approximations' },
                { severity: 'info', title: 'Import information' }
            ];
            sections.forEach((section) => {
                const items = report.warnings.filter((item) => (item.severity || 'warning') === section.severity);
                if (!items.length) return;
                const heading = document.createElement('div');
                heading.className = `lb-import-section-title lb-severity-${section.severity}`;
                heading.textContent = section.title;
                root.appendChild(heading);

                const warningList = document.createElement('div');
                warningList.className = 'lb-import-warning-list';
                items.forEach((warning) => {
                    const item = document.createElement('div');
                    item.className = `lb-import-warning-item lb-severity-${section.severity}`;
                    const header = document.createElement('div');
                    header.className = 'lb-import-warning-header';
                    const label = document.createElement('strong');
                    label.textContent = warning.message;
                    const count = document.createElement('span');
                    count.textContent = warning.examples?.length
                        ? `${warning.count} affected`
                        : (warning.count > 1 ? `${warning.count} entries` : 'Book setting');
                    header.append(label, count);
                    item.appendChild(header);
                    if (warning.examples && warning.examples.length) {
                        const examples = document.createElement('small');
                        examples.textContent = `Examples: ${warning.examples.join(', ')}`;
                        item.appendChild(examples);
                    }
                    warningList.appendChild(item);
                });
                root.appendChild(warningList);
            });
        } else {
            const clean = document.createElement('div');
            clean.className = 'lb-import-clean';
            clean.textContent = 'All detected fields have a supported Fablekin mapping.';
            root.appendChild(clean);
        }

        const note = document.createElement('p');
        note.className = 'lb-import-note';
        note.textContent = 'Original source fields for imported entries are preserved in the lore database even when Fablekin cannot apply their behavior.';
        root.appendChild(note);

        const recommended = report.recommendedSettings || {};
        if (showSourceSettings && Object.keys(recommended).length) {
            const settingChoice = document.createElement('label');
            settingChoice.className = 'lb-settings-check';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = S.applySourceSettings;
            checkbox.addEventListener('change', () => { S.applySourceSettings = checkbox.checked; });
            const copy = document.createElement('span');
            copy.textContent = `Apply source book settings: ${formatRecommendedSettings(recommended)}. The global Fablekin token cap remains the final safety limit.`;
            settingChoice.append(checkbox, copy);
            root.appendChild(settingChoice);
        }

        if (completed && report.appliedSourceSettings) {
            const applied = document.createElement('div');
            applied.className = 'lb-import-clean';
            applied.textContent = `Applied source book settings: ${formatRecommendedSettings(recommended)}.`;
            root.appendChild(applied);
        }
        return root;
    }

    function beginAnalyzedImport(mode) {
        if (!S.pendingImport) return;
        setStatus(`Importing ${S.pendingImportName || 'lorebook'}…`, 'warn');
        emitSocket('lore-book:import', {
            filePath: FILE_PATH,
            importData: S.pendingImport,
            mode,
            applySourceSettings: S.applySourceSettings
        });
    }

    function showImportPreview(report) {
        const hasWarnings = hasImportWarnings(report);
        S.applySourceSettings = true;
        Modals.show({
            title: hasWarnings ? 'Lore Book Import Warnings' : 'Lore Book Import Compatibility',
            content: buildImportReport(report, { showSourceSettings: true }),
            className: hasWarnings ? 'modal-variant-warning' : '',
            width: 'min(760px, 92vw)',
            closeOnOverlayClick: false,
            buttons: [
                { text: 'Cancel', class: 'secondary' },
                { text: 'Replace all entries', class: 'danger', onclick: () => beginAnalyzedImport('replace') },
                { text: 'Merge with existing', class: 'primary', onclick: () => beginAnalyzedImport('merge') }
            ]
        });
    }

    function showImportResult(report) {
        const hasWarnings = hasImportWarnings(report);
        Modals.show({
            title: hasWarnings ? 'Lore Book Imported with Warnings' : 'Lore Book Imported',
            content: buildImportReport(report, { completed: true }),
            className: hasWarnings ? 'modal-variant-warning' : '',
            width: 'min(760px, 92vw)',
            buttons: [{ text: 'Done', class: 'primary' }]
        });
    }

    function createSettingsField(labelText, control, hintText) {
        const field = document.createElement('div');
        field.className = 'lb-field';
        const label = document.createElement('label');
        label.className = 'lb-label';
        label.textContent = labelText;
        field.append(label, control);
        if (hintText) {
            const hint = document.createElement('div');
            hint.className = 'lb-hint';
            hint.textContent = hintText;
            field.appendChild(hint);
        }
        return field;
    }

    function showBookSettings() {
        const settings = S.bookSettings || {};
        const form = document.createElement('div');
        form.className = 'lb-settings-form';
        const grid = document.createElement('div');
        grid.className = 'lb-settings-grid';

        const tokenBudget = document.createElement('input');
        tokenBudget.className = 'lb-input';
        tokenBudget.type = 'number';
        tokenBudget.min = '1';
        tokenBudget.placeholder = 'Inherit global cap';
        tokenBudget.value = settings.token_budget ?? '';

        const scanDepth = document.createElement('input');
        scanDepth.className = 'lb-input';
        scanDepth.type = 'number';
        scanDepth.min = '0';
        scanDepth.placeholder = 'Inherit global default';
        scanDepth.value = settings.default_scan_depth ?? '';

        const scanUnit = document.createElement('select');
        scanUnit.className = 'lb-select-full';
        [['chapters', 'Chapters'], ['messages', 'Messages']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            scanUnit.appendChild(option);
        });
        scanUnit.value = settings.scan_depth_unit || 'chapters';

        grid.append(
            createSettingsField('Lorebook Token Budget', tokenBudget, 'Optional per-book cap beneath the global Lore Book budget.'),
            createSettingsField('Default Scan Depth', scanDepth, 'Blank inherits the plugin-wide default.'),
            createSettingsField('Scan Depth Unit', scanUnit, 'Message mode counts user and narrative messages separately.')
        );
        form.appendChild(grid);

        const recursionChoice = document.createElement('label');
        recursionChoice.className = 'lb-settings-check';
        const recursion = document.createElement('input');
        recursion.type = 'checkbox';
        recursion.checked = settings.recursive_scanning !== false;
        const recursionCopy = document.createElement('span');
        recursionCopy.textContent = 'Allow recursive scanning for this lorebook. Individual entries can still opt out or prevent their content from triggering another pass.';
        recursionChoice.append(recursion, recursionCopy);
        form.appendChild(recursionChoice);

        Modals.show({
            title: 'Lore Book Settings',
            content: form,
            width: 'min(620px, 92vw)',
            buttons: [
                { text: 'Cancel', class: 'secondary' },
                {
                    text: 'Save Settings',
                    class: 'primary',
                    onclick: () => emitSocket('lore-book:save-settings', {
                        filePath: FILE_PATH,
                        settings: {
                            token_budget: tokenBudget.value === '' ? null : parseInt(tokenBudget.value, 10),
                            default_scan_depth: scanDepth.value === '' ? null : parseInt(scanDepth.value, 10),
                            scan_depth_unit: scanUnit.value,
                            recursive_scanning: recursion.checked
                        }
                    })
                }
            ]
        });
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
                (e.secondary_keywords || []).some(k => k.toLowerCase().includes(q)) ||
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
                (e.hit_count > 0 ? '<span class="lb-cat-label" title="Lifetime matches: How many times this entry has been injected into your prompts.">· ' + e.hit_count + ' hits</span>' : '') +
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
    function renderTags(mark = true) {
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
        if (mark) markDirty();
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

    function renderSecondaryTags(mark = true) {
        Array.from(el.secondaryTagWrap.querySelectorAll('.lb-tag')).forEach(tag => tag.remove());
        const fragment = document.createDocumentFragment();
        S.secondaryKeywords.forEach((keyword, index) => {
            const tag = document.createElement('span');
            tag.className = 'lb-tag';
            const label = document.createElement('span');
            label.textContent = keyword;
            const remove = document.createElement('span');
            remove.className = 'lb-tag-x';
            remove.textContent = '\u00d7';
            remove.addEventListener('click', (event) => {
                event.stopPropagation();
                S.secondaryKeywords.splice(index, 1);
                renderSecondaryTags();
            });
            tag.append(label, remove);
            fragment.appendChild(tag);
        });
        el.secondaryTagWrap.insertBefore(fragment, el.secondaryKwInput);
        if (mark) markDirty();
    }

    function addSecondaryKeyword(raw) {
        const keyword = raw.trim();
        if (!keyword || S.secondaryKeywords.includes(keyword)) return;
        S.secondaryKeywords.push(keyword);
        renderSecondaryTags();
    }

    function renderDiagnostic(diagnostic) {
        el.diagnostic.classList.remove('lb-diagnostic-injected', 'lb-diagnostic-skipped');
        if (!diagnostic) {
            el.diagnostic.textContent = 'No chapter has evaluated this entry yet.';
            return;
        }
        const lines = [diagnostic.reason || diagnostic.status];
        if (diagnostic.primary_matches?.length) lines.push(`Primary matches: ${diagnostic.primary_matches.join(', ')}`);
        if (diagnostic.secondary_matches?.length) lines.push(`Secondary matches: ${diagnostic.secondary_matches.join(', ')}`);
        if (diagnostic.secondary_missing?.length) lines.push(`Secondary keys not found: ${diagnostic.secondary_missing.join(', ')}`);
        if (diagnostic.scan_depth !== undefined) lines.push(`Scanned: ${diagnostic.scan_depth} ${diagnostic.scan_unit || 'chapters'}`);
        if (diagnostic.depth > 0) lines.push(`Recursion depth: ${diagnostic.depth}`);
        el.diagnostic.textContent = lines.join('\n');
        if (diagnostic.status === 'injected') el.diagnostic.classList.add('lb-diagnostic-injected');
        else if (diagnostic.status.includes('skipped') || diagnostic.status.includes('failed')) {
            el.diagnostic.classList.add('lb-diagnostic-skipped');
        }
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
        S.secondaryKeywords = Array.isArray(entry.secondary_keywords) ? entry.secondary_keywords.slice() : [];

        el.empty.style.display  = 'none';
        el.editor.style.display = 'flex';

        el.name.value     = entry.name || '';
        el.content.value  = entry.content || '';
        el.priority.value = entry.priority ?? 50;

        el.category.value = entry.category || 'General';
        el.scanDepth.value = (entry.scan_depth !== null && entry.scan_depth !== undefined) ? entry.scan_depth : '';
        el.scanDepthUnit.value = entry.scan_depth_unit || 'chapters';
        el.position.value = entry.position || 'shared_dynamic';
        el.selectiveLogic.value = String(entry.selective_logic ?? 0);
        el.probability.value = entry.probability ?? 100;
        el.recursionDelay.value = entry.delay_until_recursion ?? 0;
        el.comment.value  = entry.comment || '';

        setToggle(el.togEnabled,  el.cbEnabled,  entry.enabled);
        setToggle(el.togConstant, el.cbConstant, entry.constant);
        setToggle(el.togCase,     el.cbCase,     entry.case_sensitive);
        setToggle(el.togWord,     el.cbWord,     entry.match_whole_word);
        setToggle(el.togRegex,    el.cbRegex,    entry.use_regex);
        setToggle(el.togSelective, el.cbSelective, entry.selective);
        setToggle(el.togProbability, el.cbProbability, entry.use_probability);
        setToggle(el.togExcludeRecursion, el.cbExcludeRecursion, entry.exclude_recursion);
        setToggle(el.togPreventRecursion, el.cbPreventRecursion, entry.prevent_recursion);
        setToggle(el.togIgnoreBudget, el.cbIgnoreBudget, entry.ignore_budget);
        setToggle(el.togIncludeName, el.cbIncludeName, entry.include_name_in_prompt);

        updateSliderFill(entry.priority ?? 50);
        updateTokenCount();

        el.crumbCat.textContent  = entry.category || 'General';
        el.crumbHits.textContent = entry.hit_count + ' hits';
        el.crumbHits.title       = 'Lifetime matches: How many times this entry has been injected into your prompts.';

        renderTags(false);
        renderSecondaryTags(false);
        renderDiagnostic(entry.last_diagnostic);
        S.dirty = false;
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
            secondary_keywords: S.secondaryKeywords,
            content:         el.content.value,
            priority:        parseInt(el.priority.value, 10),
            enabled:         el.cbEnabled.checked,
            constant:        el.cbConstant.checked,

            category:        el.category.value.trim() || 'General',
            case_sensitive:  el.cbCase.checked,
            use_regex:       el.cbRegex.checked,
            match_whole_word: el.cbWord.checked,
            scan_depth:      el.scanDepth.value !== '' ? parseInt(el.scanDepth.value, 10) : null,
            scan_depth_unit: el.scanDepthUnit.value,
            position:        el.position.value,
            selective:       el.cbSelective.checked,
            selective_logic: parseInt(el.selectiveLogic.value, 10),
            probability:     Math.max(0, Math.min(100, parseInt(el.probability.value, 10) || 0)),
            use_probability: el.cbProbability.checked,
            exclude_recursion: el.cbExcludeRecursion.checked,
            prevent_recursion: el.cbPreventRecursion.checked,
            delay_until_recursion: Math.max(0, parseInt(el.recursionDelay.value, 10) || 0),
            ignore_budget: el.cbIgnoreBudget.checked,
            include_name_in_prompt: el.cbIncludeName.checked,
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
        
        Modals.confirm('Delete Entry', `Delete "${entry.name}"? This cannot be undone.`, { variant: 'danger' }).then(confirmed => {
            if (confirmed) {
                emitSocket('lore-book:delete-entry', { filePath: FILE_PATH, id: S.selected });
            }
        });
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

        onSocket('lore-book:loaded', ({ filePath, entries, settings }) => {
            if (filePath !== FILE_PATH) return;
            debugLog('Received lore-book:loaded.', { filePath, count: entries.length });
            S.entries = entries;
            if (settings) S.bookSettings = settings;
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
                    S.entries[idx] = {
                        ...entry,
                        last_diagnostic: entry.last_diagnostic || S.entries[idx].last_diagnostic || null
                    };
                    // If the updated entry is the currently selected one, we may need to update the header
                    // but we should NEVER call selectEntry() here as it would hijack focus from a new selection.
                    if (S.selected === entry.id) {
                        el.crumbHits.textContent = entry.hit_count + ' hits';
                        // If the user hasn't typed a name yet, show the auto-generated one from the server
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

        onSocket('lore-book:import-analysis', ({ filePath, report, error }) => {
            if (filePath !== FILE_PATH) return;
            if (error) {
                setStatus('Import analysis failed.', 'err');
                Modals.alert('Lore Book Import Warning', error, { variant: 'warning' });
                S.pendingImport = null;
                S.pendingImportName = '';
                return;
            }
            setStatus('Import ready for review.', hasImportWarnings(report) ? 'warn' : 'ok');
            showImportPreview(report);
        });

        onSocket('lore-book:imported', ({ filePath, report, settings }) => {
            if (filePath !== FILE_PATH) return;
            if (settings) S.bookSettings = settings;
            setStatus(`Imported ${report.importedEntries} of ${report.sourceEntries} entries.`, hasImportWarnings(report) ? 'warn' : 'ok');
            showImportResult(report);
            S.pendingImport = null;
            S.pendingImportName = '';
        });

        onSocket('lore-book:settings-saved', ({ filePath, settings }) => {
            if (filePath !== FILE_PATH) return;
            S.bookSettings = settings;
            setStatus('Lorebook settings saved.', 'ok');
            notify('Lorebook settings saved.');
        });

        onSocket('lore-book:diagnostics-updated', ({ filePath, diagnostics }) => {
            if (filePath !== FILE_PATH || !diagnostics?.entries) return;
            S.entries.forEach((entry) => {
                entry.last_diagnostic = diagnostics.entries[String(entry.id)] || null;
            });
            if (S.selected) {
                const selected = S.entries.find((entry) => entry.id === S.selected);
                renderDiagnostic(selected?.last_diagnostic || null);
            }
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
        $('lb-book-settings-btn').addEventListener('click', showBookSettings);

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
        [
            el.name, el.content, el.category, el.scanDepth, el.scanDepthUnit,
            el.position, el.selectiveLogic, el.probability, el.recursionDelay, el.comment
        ].forEach(f => {
            f.addEventListener('input', markDirty);
            f.addEventListener('change', markDirty);
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
            [el.togSelective, el.cbSelective],
            [el.togProbability, el.cbProbability],
            [el.togExcludeRecursion, el.cbExcludeRecursion],
            [el.togPreventRecursion, el.cbPreventRecursion],
            [el.togIgnoreBudget, el.cbIgnoreBudget],
            [el.togIncludeName, el.cbIncludeName],
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

        el.secondaryKwInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ',') {
                ev.preventDefault();
                addSecondaryKeyword(el.secondaryKwInput.value);
                el.secondaryKwInput.value = '';
            } else if (ev.key === 'Backspace' && !el.secondaryKwInput.value && S.secondaryKeywords.length) {
                S.secondaryKeywords.pop();
                renderSecondaryTags();
            }
        });
        el.secondaryKwInput.addEventListener('blur', () => {
            if (el.secondaryKwInput.value.trim()) {
                addSecondaryKeyword(el.secondaryKwInput.value);
                el.secondaryKwInput.value = '';
            }
        });
        el.secondaryTagWrap.addEventListener('click', () => el.secondaryKwInput.focus());

        // Export
        $('lb-export-btn').addEventListener('click', () => {
            if (!SOCKET) return;
            emitSocket('lore-book:export', { filePath: FILE_PATH });
        });

        // Import SillyTavern World Info, Character Book, or native Fablekin JSON.
        const importFileInput = $('lb-import-file');
        const openImportPicker = () => importFileInput.click();
        $('lb-import-btn').addEventListener('click', openImportPicker);
        $('lb-empty-import').addEventListener('click', openImportPicker);
        importFileInput.addEventListener('change', (ev) => {
            const file = ev.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    S.pendingImport = data;
                    S.pendingImportName = file.name;
                    setStatus(`Analyzing ${file.name}…`, 'warn');
                    emitSocket('lore-book:analyze-import', { filePath: FILE_PATH, importData: data });
                } catch (err) {
                    setStatus('Import file could not be read.', 'err');
                    Modals.alert('Lore Book Import Warning', `The selected file is not valid JSON: ${err.message}`, { variant: 'warning' });
                }
            };
            reader.onerror = () => {
                setStatus('Import file could not be read.', 'err');
                Modals.alert('Lore Book Import Warning', 'The selected file could not be read.', { variant: 'warning' });
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
