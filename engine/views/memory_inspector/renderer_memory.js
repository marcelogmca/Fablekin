// memory_inspector/renderer_memory.js

const socket = io('http://localhost:14541');

const state = {
    memory: {
        initialized: false,
        term: null,
        fitAddon: null,
        commandHandler: null,
        macros: [],
        defaultMacros: [
            { id: 'def-help', name: 'Help', command: '/help' },
            { id: 'def-tree', name: 'Turn Tree', command: '/turncontext tree' },
            { id: 'def-plugins', name: 'Plugins List', command: '/plugins list' },
            { id: 'def-hooks', name: 'Hook Registry', command: '/plugins hooks' }
        ]
    },
    system: {
        initialized: false,
        term: null,
        fitAddon: null,
        logBuffer: [],
        seenLogIds: new Set(),
        lastLogId: 0,
        filterText: '',
        followTail: true,
        suppressScrollTracking: false
    }
};

function normalizeForTerminal(text) {
    const asString = String(text ?? '');
    return asString.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}

function writeTerminalLine(term, text = '') {
    term.write(`${normalizeForTerminal(text)}\r\n`);
}

function withSuppressedSystemScrollTracking(fn) {
    state.system.suppressScrollTracking = true;
    try {
        fn();
    } finally {
        state.system.suppressScrollTracking = false;
    }
}

function getThemeValue(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

function buildTerminalTheme() {
    return {
        background: getThemeValue('--bg-base', '#121212'),
        foreground: getThemeValue('--text-main', '#f5f6fa'),
        cursor: getThemeValue('--color-primary', '#f1c40f'),
        selectionBackground: 'rgba(241, 196, 15, 0.3)',
        black: '#000000',
        red: getThemeValue('--status-danger', '#b83b5e'),
        green: getThemeValue('--status-success', '#2ecc71'),
        yellow: getThemeValue('--color-primary', '#f1c40f'),
        blue: getThemeValue('--status-info', '#3498db'),
        magenta: getThemeValue('--area-chronicles', '#b450ff'),
        cyan: getThemeValue('--area-directives', '#00b4ff'),
        white: getThemeValue('--text-main', '#f5f6fa'),
        brightBlack: getThemeValue('--text-muted', '#a4b0be'),
        brightRed: getThemeValue('--status-danger', '#b83b5e'),
        brightGreen: getThemeValue('--status-success', '#2ecc71'),
        brightYellow: getThemeValue('--color-primary', '#f1c40f'),
        brightBlue: getThemeValue('--status-info', '#3498db'),
        brightMagenta: getThemeValue('--area-chronicles', '#b450ff'),
        brightCyan: getThemeValue('--area-directives', '#00b4ff'),
        brightWhite: '#ffffff'
    };
}

function applyTheme(term) {
    if (!term) return;
    term.options.theme = buildTerminalTheme();
    term.options.fontFamily = 'Consolas, "Courier New", monospace';
    term.options.fontSize = 14;
}

function createTerminal(containerId, options = {}) {
    const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        scrollback: 12000,
        ...options
    });
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById(containerId));
    applyTheme(terminal);
    fitAddon.fit();
    return { terminal, fitAddon };
}

function installCopyShortcut(term) {
    term.attachCustomKeyEventHandler((event) => {
        const key = String(event.key || '').toLowerCase();
        const isCopyShortcut =
            (event.ctrlKey && key === 'c') ||
            (event.ctrlKey && event.shiftKey && key === 'c') ||
            (event.ctrlKey && key === 'insert') ||
            (event.metaKey && key === 'c');

        if (!isCopyShortcut) return true;
        if (event.type !== 'keydown') return false;

        const selection = term.getSelection();
        if (!selection) return false;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(selection).catch(() => {});
            return false;
        }

        const textArea = document.createElement('textarea');
        textArea.value = selection;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (_error) {
            // Best-effort fallback.
        }
        document.body.removeChild(textArea);
        return false;
    });
}

function fitTerminals() {
    if (state.memory.initialized && state.memory.fitAddon) state.memory.fitAddon.fit();
    if (state.system.initialized && state.system.fitAddon) state.system.fitAddon.fit();
}

function applyThemeToTerminals() {
    if (state.memory.initialized) applyTheme(state.memory.term);
    if (state.system.initialized) applyTheme(state.system.term);
}

function writeMemoryWelcome(term) {
    writeTerminalLine(term, '\x1b[1;33m  ███████╗ █████╗ ██████╗ ██╗     ███████╗██╗  ██╗██╗███╗   ██╗\x1b[0m');
    writeTerminalLine(term, '\x1b[1;33m  ██╔════╝██╔══██╗██╔══██╗██║     ██╔════╝██║ ██╔╝██║████╗  ██║\x1b[0m');
    writeTerminalLine(term, '\x1b[1;33m  █████╗  ███████║██████╔╝██║     █████╗  █████╔╝ ██║██╔██╗ ██║\x1b[0m');
    writeTerminalLine(term, '\x1b[1;33m  ██╔══╝  ██╔══██║██╔══██╗██║     ██╔══╝  ██╔═██╗ ██║██║╚██╗██║\x1b[0m');
    writeTerminalLine(term, '\x1b[1;33m  ██║     ██║  ██║██████╔╝███████╗███████╗██║  ██╗██║██║ ╚████║\x1b[0m');
    writeTerminalLine(term, '\x1b[1;33m  ╚═╝     ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝\x1b[0m');
    writeTerminalLine(term, '');
    writeTerminalLine(term, '\x1b[1;36mWelcome to the Fablekin Memory Inspector.\x1b[0m');
    writeTerminalLine(term, 'This console provides a direct window into the engine\'s internal state.');
    writeTerminalLine(term, 'Use it to inspect active narrative context, monitor plugin hooks, and query system data.');
    writeTerminalLine(term, '');
    writeTerminalLine(term, 'Type \x1b[1;32m/help\x1b[0m to get started.');
}

function initMemoryTerminal() {
    if (state.memory.initialized) return;
    const { terminal, fitAddon } = createTerminal('terminal-container');
    state.memory.term = terminal;
    state.memory.fitAddon = fitAddon;
    installCopyShortcut(terminal);

    writeMemoryWelcome(terminal);
    writeTerminalLine(terminal, '');

    const commandHandler = new TerminalCommandHandler(terminal, socket);
    commandHandler.init();
    state.memory.commandHandler = commandHandler;

    initMacroSidebar();
    terminal.write('\r\n$ ');
    state.memory.initialized = true;
}

function initMacroSidebar() {
    const macrosContainer = document.getElementById('macros-container');
    const addMacroBtn = document.getElementById('add-macro-btn');

    const renderMacros = () => {
        if (!macrosContainer) return;
        macrosContainer.innerHTML = '';
        state.memory.macros.forEach(macro => {
            const item = document.createElement('div');
            item.className = 'macro-item';
            item.innerHTML = `
                <div class="macro-info">
                    <span class="macro-name">${macro.name}</span>
                    <span class="macro-cmd">${macro.command}</span>
                </div>
                <button class="delete-macro-btn" title="Delete Macro">x</button>
            `;
            item.onclick = (event) => {
                if (event.target.classList.contains('delete-macro-btn')) return;
                state.memory.commandHandler.setCommandInput(macro.command);
            };
            item.querySelector('.delete-macro-btn').onclick = (event) => {
                event.stopPropagation();
                deleteMacro(macro.id);
            };
            macrosContainer.appendChild(item);
        });
    };

    const saveMacros = () => {
        socket.once('get-global-settings-response', (response) => {
            const vnSettings = (response && response.success && response.settings && response.settings.visual_novel?.settings)
                ? response.settings.visual_novel.settings
                : {};
            vnSettings.commandMacros = state.memory.macros;
            socket.emit('save-vn-settings', { vnSettings });
        });
        socket.emit('get-global-settings', {});
    };

    const loadMacros = () => {
        socket.once('get-global-settings-response', (response) => {
            if (response && response.success && response.settings && response.settings.visual_novel?.settings) {
                const vnSettings = response.settings.visual_novel.settings;
                state.memory.macros = vnSettings.commandMacros || [...state.memory.defaultMacros];
                if (!vnSettings.commandMacros) saveMacros();
                renderMacros();
                return;
            }
            state.memory.macros = [...state.memory.defaultMacros];
            renderMacros();
        });
        socket.emit('get-global-settings', {});
    };

    const deleteMacro = (id) => {
        state.memory.macros = state.memory.macros.filter(macro => macro.id !== id);
        renderMacros();
        saveMacros();
    };

    if (addMacroBtn) {
        addMacroBtn.onclick = () => {
            const content = document.createElement('div');
            content.className = 'macro-form-container';
            content.innerHTML = `
                <div class="form-group" style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: var(--font-xs);">Macro Name</label>
                    <input type="text" id="new-macro-name" class="premium-modal-input" placeholder="e.g. Help" style="width: 100%;">
                </div>
                <div class="form-group">
                    <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: var(--font-xs);">Command</label>
                    <input type="text" id="new-macro-cmd" class="premium-modal-input" placeholder="e.g. /help" style="width: 100%;">
                </div>
            `;

            Modals.show({
                title: 'Add New Macro',
                content,
                buttons: [
                    { text: 'Cancel', class: 'secondary' },
                    {
                        text: 'Save Macro',
                        class: 'primary',
                        onclick: (modal) => {
                            const name = document.getElementById('new-macro-name').value.trim();
                            const command = document.getElementById('new-macro-cmd').value.trim();
                            if (!name || !command) {
                                alert('Please provide both a name and a command.');
                                return false;
                            }
                            state.memory.macros.push({
                                id: Date.now().toString(),
                                name,
                                command
                            });
                            renderMacros();
                            saveMacros();
                            modal.close();
                            return true;
                        }
                    }
                ]
            });
        };
    }

    loadMacros();
}

function tryPrettyJson(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return '';
    if (!((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']')))) {
        return String(text ?? '');
    }
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return String(text ?? '');
    }
}

function doesSystemLogMatchFilter(log, filterText) {
    if (!filterText) return true;
    const haystack = [
        log.section,
        log.subSection,
        log.message,
        ...(Array.isArray(log.extraArgs) ? log.extraArgs : []),
        log.ansiLine
    ]
        .map(v => String(v ?? ''))
        .join(' ')
        .toLowerCase();
    return haystack.includes(filterText);
}

function formatSystemLogLine(log) {
    const hasAnsiCodes = typeof log.ansiLine === 'string' && /\x1b\[[0-9;]*m/.test(log.ansiLine);
    if (hasAnsiCodes) {
        return log.ansiLine;
    }

    const timestamp = log.timestamp || '--:--:--';
    const section = log.section || 'System';
    const sectionTag = (typeof log.sectionAnsiTag === 'string' && /\x1b\[[0-9;]*m/.test(log.sectionAnsiTag))
        ? log.sectionAnsiTag
        : `[\x1b[36m${section}\x1b[0m]`;
    const subSectionTag = (typeof log.subSectionAnsiTag === 'string' && /\x1b\[[0-9;]*m/.test(log.subSectionAnsiTag))
        ? `${log.subSectionAnsiTag} `
        : (log.subSection ? `[\x1b[35m${log.subSection}\x1b[0m] ` : '');
    const start = log.startEnd === 'start' ? '>>> ' : '';
    const end = log.startEnd === 'end' ? ' <<<' : '';

    const messageText = tryPrettyJson(log.message || '');
    const extraArgs = Array.isArray(log.extraArgs) ? log.extraArgs : [];
    const prettyExtras = extraArgs.map(tryPrettyJson);
    const extrasText = prettyExtras.length > 0 ? `\n${prettyExtras.map(arg => `    ${arg}`).join('\n')}` : '';

    const timeColor = '\x1b[90m';
    const reset = '\x1b[0m';
    const messageColor = log.level === 'error'
        ? '\x1b[1;31m'
        : (log.level === 'warn' ? '\x1b[1;33m' : '\x1b[37m');

    return `${timeColor}[${timestamp}]${reset} ${sectionTag} ${subSectionTag}${messageColor}${start}${messageText}${end}${extrasText}${reset}`;
}

function appendSystemLine(line, controlScroll = true) {
    if (!state.system.term) return;
    const term = state.system.term;
    const activeBuffer = term.buffer?.active;
    const viewportBefore = activeBuffer?.viewportY ?? 0;
    const shouldFollow = state.system.followTail;

    writeTerminalLine(term, line);

    if (!controlScroll) return;
    if (shouldFollow) {
        withSuppressedSystemScrollTracking(() => term.scrollToBottom());
        return;
    }
    withSuppressedSystemScrollTracking(() => term.scrollToLine(viewportBefore));
}

function writeSystemLog(log, controlScroll = true) {
    appendSystemLine(formatSystemLogLine(log), controlScroll);
}

function rerenderSystemLogView() {
    if (!state.system.term) return;
    const term = state.system.term;
    const activeBuffer = term.buffer?.active;
    const viewportBefore = activeBuffer?.viewportY ?? 0;
    const shouldFollow = state.system.followTail;

    withSuppressedSystemScrollTracking(() => {
        term.clear();
        writeSystemHeader(false);
        state.system.logBuffer.forEach(log => {
            if (doesSystemLogMatchFilter(log, state.system.filterText)) {
                writeSystemLog(log, false);
            }
        });
        if (shouldFollow) {
            term.scrollToBottom();
        } else {
            const maxViewport = term.buffer?.active?.baseY ?? 0;
            term.scrollToLine(Math.min(viewportBefore, maxViewport));
        }
    });
}

function pushSystemLog(log) {
    if (!log || typeof log !== 'object') return;

    const logId = Number(log.logId) || 0;
    if (logId > 0) {
        if (state.system.seenLogIds.has(logId)) return;
        state.system.seenLogIds.add(logId);
        state.system.lastLogId = Math.max(state.system.lastLogId, logId);
    }

    state.system.logBuffer.push(log);

    if (state.system.initialized && doesSystemLogMatchFilter(log, state.system.filterText)) {
        writeSystemLog(log, true);
    }
}

function writeSystemHeader(controlScroll = true) {
    if (!state.system.term) return;
    appendSystemLine('\x1b[1;33mFablekin System Console Stream\x1b[0m', controlScroll);
    writeSystemLog({
        timestamp: '--:--:--',
        level: 'log',
        section: 'Filter',
        message: state.system.filterText ? `Active text filter: "${state.system.filterText}"` : 'No active filter (showing all logs)',
        extraArgs: []
    }, controlScroll);
    appendSystemLine('', controlScroll);
}

function initSystemTerminal() {
    if (state.system.initialized) return;

    const { terminal, fitAddon } = createTerminal('system-terminal-mount', {
        cursorBlink: false,
        disableStdin: true,
        scrollback: 1000000
    });

    state.system.term = terminal;
    state.system.fitAddon = fitAddon;
    installCopyShortcut(terminal);
    state.system.term.onScroll(() => {
        if (state.system.suppressScrollTracking) return;
        const active = state.system.term?.buffer?.active;
        if (!active) return;
        state.system.followTail = active.viewportY >= active.baseY;
    });

    writeSystemHeader(false);
    state.system.logBuffer.forEach(log => {
        if (doesSystemLogMatchFilter(log, state.system.filterText)) {
            writeSystemLog(log, false);
        }
    });
    withSuppressedSystemScrollTracking(() => state.system.term.scrollToBottom());
    state.system.followTail = true;
    state.system.initialized = true;
}

function setupSystemLogStream() {
    socket.on('memory-system-log-buffer-response', (payload) => {
        const logs = Array.isArray(payload?.logs) ? payload.logs : [];
        logs.forEach(pushSystemLog);
        const payloadLastId = Number(payload?.lastLogId) || 0;
        if (payloadLastId > state.system.lastLogId) {
            state.system.lastLogId = payloadLastId;
        }
    });

    socket.on('system-log', pushSystemLog);
    socket.emit('memory-system-log-buffer-request', { afterId: 0 });
}

function bindUiEvents() {
    const filterInput = document.getElementById('system-log-filter-input');
    const clearFilterBtn = document.getElementById('clear-system-filter-btn');

    filterInput.addEventListener('input', () => {
        state.system.filterText = String(filterInput.value || '').trim().toLowerCase();
        rerenderSystemLogView();
    });

    clearFilterBtn.addEventListener('click', () => {
        filterInput.value = '';
        state.system.filterText = '';
        rerenderSystemLogView();
    });

    document.getElementById('clear-system-terminal-btn').addEventListener('click', () => {
        if (!state.system.initialized) return;
        withSuppressedSystemScrollTracking(() => {
            state.system.term.clear();
            writeSystemHeader(false);
            if (state.system.followTail) state.system.term.scrollToBottom();
        });
    });

    window.addEventListener('resize', () => {
        fitTerminals();
        applyThemeToTerminals();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindUiEvents();
    setupSystemLogStream();
    initMemoryTerminal();
    initSystemTerminal();
    setInterval(applyThemeToTerminals, 500);
    requestAnimationFrame(fitTerminals);
});
