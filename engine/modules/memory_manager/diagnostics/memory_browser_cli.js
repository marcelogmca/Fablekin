/**
 * memory_browser_cli.js
 * Backend logic for the Memory Inspector Terminal.
 */

const { Logger, getSystemLogBuffer } = require('../../utils.js');
const chaptermanagement = require('../../chaptermanagement.js');
const pluginManager = require('../../plugin_manager/plugin_manager.js');
const vectorStoreManager = require('../storage/vector_store_manager.js');
const fs = require('fs');
const path = require('path');

const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    underscore: '\x1b[4m',
    blink: '\x1b[5m',
    reverse: '\x1b[7m',
    hidden: '\x1b[8m',

    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    grey: '\x1b[90m',

    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m'
};

class MemoryBrowserCLI {
    constructor(io) {
        this.io = io;
        this.builtInCommands = new Map();
        this._registerBuiltInCommands();
    }

    /**
     * Registers all standard system commands.
     */
    _registerBuiltInCommands() {
        this.builtInCommands.set('/help', {
            description: 'Show this help message',
            run: async (socket, args) => await this.handleHelpCommand(socket, args)
        });

        this.builtInCommands.set('/hello', {
            description: 'Test socket communication',
            run: async (socket, _args) => {
                socket.emit('terminal-response', {
                    success: true,
                    output: 'hello world'
                });
            }
        });

        this.builtInCommands.set('/turncontext', {
            description: 'Inspect TurnContext data structure and history',
            run: async (socket, args) => await this.handleTurnContextCommand(socket, args)
        });

        this.builtInCommands.set('/plugins', {
            description: 'Manage and inspect the plugin system',
            run: async (socket, args) => await this.handlePluginsCommand(socket, args)
        });

        this.builtInCommands.set('/perf', {
            description: 'Visualize pipeline performance and hook timings',
            run: async (socket, args) => await this.handlePerfCommand(socket, args)
        });

        this.builtInCommands.set('/prompt', {
            description: 'Inspect assembled LLM prompt components',
            run: async (socket, args) => await this.handlePromptCommand(socket, args)
        });

        this.builtInCommands.set('/sql', {
            description: 'Execute raw SQL on the chat database (WRITE access allowed)',
            run: async (socket, args) => await this.handleSqlCommand(socket, args)
        });

        this.builtInCommands.set('/facts', {
            description: 'Query the FactManager ledger',
            run: async (socket, args) => await this.handleFactsCommand(socket, args)
        });

        this.builtInCommands.set('/history', {
            description: 'Show turn history and summaries',
            run: async (socket, args) => await this.handleHistoryCommand(socket, args)
        });

        this.builtInCommands.set('/settings', {
            description: 'View current system and project settings',
            run: async (socket, args) => await this.handleSettingsCommand(socket, args)
        });

        this.builtInCommands.set('/diff', {
            description: 'Compare two turn contexts',
            run: async (socket, args) => await this.handleDiffCommand(socket, args)
        });

        this.builtInCommands.set('/clear', {
            description: 'Clear the terminal screen',
            run: async (socket, args) => await this.handleClearCommand(socket, args)
        });

        this.builtInCommands.set('/rag', {
            description: 'Query and manage LanceDB vector stores',
            run: async (socket, args) => await this.handleRagCommand(socket, args)
        });

        this.builtInCommands.set('/export', {
            description: 'Export a turn context snapshot to a JSON file',
            run: async (socket, args) => await this.handleExportCommand(socket, args)
        });

        this.builtInCommands.set('/sprites', {
            description: 'Visualize available character sprites, emotions and rotations',
            run: async (socket, args) => await this.handleSpritesCommand(socket, args)
        });
    }

    /**
     * Registers socket listeners for the terminal.
     * @param {Socket} socket 
     */
    registerSocketHandlers(socket) {
        socket.on('memory-system-log-buffer-request', (data = {}) => {
            const afterId = Number(data.afterId) || 0;
            const limit = Object.prototype.hasOwnProperty.call(data, 'limit') ? Number(data.limit) : 0;
            socket.emit('memory-system-log-buffer-response', getSystemLogBuffer({ afterId, limit }));
        });

        socket.on('terminal-command', async (data) => {
            const { command, args } = data;
            Logger.log('MemoryCLI', `Received command: ${command} with args:`, args);

            try {
                // 1. Check if it's a plugin-registered command
                const pluginCmds = pluginManager.getRegisteredTerminalCommands();
                if (pluginCmds.has(command)) {
                    await this.handlePluginCommand(socket, command, args);
                    return;
                }

                // 2. Check built-in commands
                if (this.builtInCommands.has(command)) {
                    const cmdDef = this.builtInCommands.get(command);
                    await cmdDef.run(socket, args);
                    return;
                }

                socket.emit('terminal-response', {
                    success: false,
                    output: `\x1b[1;31mUnknown command: ${command}\x1b[0m`
                });
            } catch (error) {
                Logger.error('MemoryCLI', `Error executing ${command}:`, error);
                socket.emit('terminal-response', {
                    success: false,
                    output: `\x1b[1;31mError: ${error.message}\x1b[0m`
                });
            }
        });
    }

    /**
     * Standardized turn resolution.
     * Tries active context first, then DB (latest or index).
     */
    async _resolveTurn(turnSelector = null) {
        // Handle null, undefined, or empty string
        if (!turnSelector) {
            // Priority 1: Current active context in PluginManager
            const current = pluginManager.getCurrentTurnContext();
            if (current) return current;

            // Priority 2: Latest from DB
            if (chaptermanagement.isInitialized()) {
                const latest = await chaptermanagement.getLatestNChapters(1);
                return latest && latest.length > 0 ? latest[0] : null;
            }
            return null;
        }

        // Handle string keywords if any (like 'latest')
        if (turnSelector === 'latest') {
            if (chaptermanagement.isInitialized()) {
                const latest = await chaptermanagement.getLatestNChapters(1);
                return latest && latest.length > 0 ? latest[0] : null;
            }
            return null;
        }

        // Priority 3: Specific Turn Number
        const turnIndex = parseInt(turnSelector);
        if (isNaN(turnIndex) || turnIndex < 1) return null;

        if (chaptermanagement.isInitialized()) {
            return await chaptermanagement.getTurnContext(turnIndex);
        }

        return null;
    }

    /**
     * Executes a command registered by a plugin.
     */
    async handlePluginCommand(socket, command, args) {
        const cmdDef = pluginManager.getRegisteredTerminalCommands().get(command);
        if (!cmdDef) return;

        try {
            // Build tools using the pluginManager's internal builder
            // We pass the current context so plugins know the active turn
            let context = pluginManager.getCurrentTurnContext();
            if (!context) {
                const latest = await chaptermanagement.getLatestNChapters(1);
                context = latest && latest.length > 0 ? latest[0] : null;
            }

            const tools = pluginManager._buildTools(cmdDef.pluginId, context, socket);

            const result = await cmdDef.run(args, tools);

            if (result !== undefined) {
                const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                socket.emit('terminal-response', {
                    success: true,
                    output: output.replace(/\n/g, '\r\n')
                });
            }
        } catch (error) {
            Logger.error('MemoryCLI', `Error in plugin command ${command} (${cmdDef.pluginId}):`, error);
            socket.emit('terminal-response', {
                success: false,
                output: `\x1b[1;31mPlugin Error [${cmdDef.pluginId}]: ${error.message}\x1b[0m`
            });
        }
    }

    /**
     * Lists all available commands, including plugin ones.
     */
    async handleHelpCommand(socket, _args) {
        let output = `\x1b[1;32mMemory Inspector CLI - Available Commands:\x1b[0m\r\n`;
        output += `  \x1b[1;33mSystem Commands:\x1b[0m\r\n`;

        // Sort system commands alphabetically
        const sortedBuiltIn = Array.from(this.builtInCommands.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        for (const [name, def] of sortedBuiltIn) {
            output += `    \x1b[1;36m${name.padEnd(15)}\x1b[0m - ${def.description}\r\n`;
        }

        output += `\r\n  \x1b[1;33mPlugin Commands:\x1b[0m\r\n`;
        const pluginCmds = pluginManager.getRegisteredTerminalCommands();
        const activePlugins = Array.from(pluginManager.plugins.keys());
        Logger.log('MemoryCLI', `Help command triggered. Found ${pluginCmds.size} plugin commands. Active plugins: ${activePlugins.join(', ')}`);

        if (pluginCmds.size > 0) {
            // Group by plugin for better readability
            const grouped = {};
            for (const [cmd, def] of pluginCmds.entries()) {
                if (!grouped[def.pluginId]) grouped[def.pluginId] = [];
                grouped[def.pluginId].push({ cmd, desc: def.description || 'No description provided.' });
            }

            for (const [pluginId, cmds] of Object.entries(grouped)) {
                output += `  \x1b[1;35m${pluginId}:\x1b[0m\r\n`;
                cmds.forEach(c => {
                    output += `    \x1b[1;36m${c.cmd}\x1b[0m - ${c.desc}\r\n`;
                });
            }
        }

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Handles the /plugins command routing.
     */
    async handlePluginsCommand(socket, args) {
        const subcommand = args[0];

        if (!subcommand || subcommand === 'help') {
            const help = `\r\n${COLORS.bright}Plugin Management Toolkit${COLORS.reset}\r\n` +
                `Usage: /plugins ${COLORS.cyan}[subcommand]${COLORS.reset} ${COLORS.grey}[args]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Subcommands:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}list${COLORS.reset}       - List all active and disabled plugins.\r\n` +
                `  ${COLORS.cyan}hooks${COLORS.reset}      - Show registry for all hooks or a specific one.\r\n` +
                `  ${COLORS.cyan}logs${COLORS.reset}       - View runtime logs for a plugin in the latest turn.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /plugins list\r\n` +
                `  /plugins hooks HOOK_TURN_START\r\n` +
                `  /plugins logs knowledge_graph\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        if (subcommand === 'list') {
            await this.handlePluginsListCommand(socket, args);
        } else if (subcommand === 'hooks') {
            await this.handlePluginsHooksCommand(socket, args);
        } else if (subcommand === 'logs') {
            await this.handlePluginsLogsCommand(socket, args);
        } else {
            socket.emit('terminal-response', {
                success: false,
                output: `\x1b[1;31mUnknown subcommand: ${subcommand}\x1b[0m. Use '/plugins help' for usage.`
            });
        }
    }

    /**
     * Handles the /perf command.
     */
    async handlePerfCommand(socket, args) {
        if (!args[0] || args[0] === 'help') {
            const help = `\r\n${COLORS.bright}Pipeline Performance Toolkit${COLORS.reset}\r\n` +
                `Usage: /perf ${COLORS.cyan}[turn_selector]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Parameters:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}[turn_selector]${COLORS.reset}  - Turn number, 'latest', or blank (active context).\r\n\r\n` +
                `${COLORS.bright}Description:${COLORS.reset}\r\n` +
                `  Visualizes hook execution timings and plugin overhead for a specific turn.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /perf latest\r\n` +
                `  /perf 42\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        // Refactored to use _resolveTurn for robust fallback and crash prevention
        const turn = await this._resolveTurn(args[0]);

        if (!turn) {
            const errorMsg = !chaptermanagement.isInitialized()
                ? 'Database not initialized. Please load a project first.'
                : 'No turn found for performance analysis.';
            socket.emit('terminal-response', { success: false, output: `\x1b[1;31mError: ${errorMsg}\x1b[0m` });
            return;
        }

        const perf = turn.runtime?.performance;
        if (!perf || !perf.hooks || Object.keys(perf.hooks).length === 0) {
            socket.emit('terminal-response', {
                success: true,
                output: `\r\n\x1b[1;33mNo performance data tracked for Turn ${turn.turnNumber}.\x1b[0m`
            });
            return;
        }

        let output = `\r\n\x1b[1;32mPipeline Performance Analysis - Turn ${turn.turnNumber}\x1b[0m\r\n`;

        // Sort hooks by start time
        const sortedHooks = Object.entries(perf.hooks).sort((a, b) => a[1].start - b[1].start);
        const totalStart = sortedHooks[0][1].start;
        const totalEnd = sortedHooks[sortedHooks.length - 1][1].end || Date.now();
        const totalDuration = totalEnd - totalStart;

        output += `\x1b[1;30mTotal Duration: ${(totalDuration / 1000).toFixed(2)}s\x1b[0m\r\n\r\n`;

        for (const [hookName, data] of sortedHooks) {
            const hookDuration = data.duration || 0;
            const hookOffset = data.start - totalStart;
            const barWidth = 40;
            const hookStartPos = Math.floor((hookOffset / totalDuration) * barWidth);
            const hookLenPos = Math.max(1, Math.ceil((hookDuration / totalDuration) * barWidth));

            let bar = ' '.repeat(hookStartPos) + '\x1b[47m' + ' '.repeat(hookLenPos) + '\x1b[0m';

            output += `\x1b[1;36m${hookName.padEnd(30)}\x1b[0m \x1b[1;33m${String(hookDuration).padStart(5)}ms\x1b[0m ${bar}\r\n`;

            if (data.listeners && data.listeners.length > 0) {
                for (const l of data.listeners) {
                    const lDuration = l.duration || 0;
                    output += `  \x1b[0;90m└─ ${l.pluginId.padEnd(26)}\x1b[0m \x1b[0;37m${String(lDuration).padStart(5)}ms\x1b[0m \x1b[0;90m(${l.mode})\x1b[0m\r\n`;
                }
            }
        }

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Handles the /prompt command.
     */
    async handlePromptCommand(socket, args) {
        if (!args[0] || args[0] === 'help') {
            const help = `\r\n${COLORS.bright}Prompt Inspection Toolkit${COLORS.reset}\r\n` +
                `Usage: /prompt ${COLORS.cyan}[turn_selector]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Parameters:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}[turn_selector]${COLORS.reset}  - Turn number, 'latest', or blank (active context).\r\n\r\n` +
                `${COLORS.bright}Description:${COLORS.reset}\r\n` +
                `  Shows the final messages (System, User, Assistant) sent to the LLM for the turn.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /prompt latest\r\n` +
                `  /prompt 5\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        const turn = await this._resolveTurn(args[0]);
        if (!turn) {
            socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Turn context not found.\x1b[0m' });
            return;
        }

        const messages = turn.processed?.promptBuilder?.messages;
        if (!messages || !Array.isArray(messages)) {
            socket.emit('terminal-response', { success: true, output: `\x1b[1;33mNo prompt component data found for Turn ${turn.turnNumber}.\x1b[0m` });
            return;
        }

        let output = `\r\n\x1b[1;32mAssembled Prompt Components - Turn ${turn.turnNumber}\x1b[0m\r\n`;
        messages.forEach((m) => {
            const color = m.role === 'system' ? '\x1b[1;35m' : (m.role === 'user' ? '\x1b[1;36m' : '\x1b[1;33m');
            output += `\r\n${color}[${m.role.toUpperCase()}]\x1b[0m\r\n`;

            const rawLines = m.content.split(/\r?\n/);
            const cappedLines = rawLines.slice(0, 10);
            const isTruncated = rawLines.length > 10;

            cappedLines.forEach(line => {
                output += `  ${line}\r\n`;
            });

            if (isTruncated) {
                output += `  \x1b[1;30m[... ${rawLines.length - 10} more lines truncated ...]\x1b[0m\r\n`;
            }

            output += `\x1b[1;30m------------------------------------------------------------\x1b[0m\r\n`;
        });

        output += `\r\n\x1b[1;30m* Note: Messages are capped at 10 lines for brevity. Use the Logs Inspector for full logs.\x1b[0m\r\n`;

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Handles the /sql command.
     */
    async handleSqlCommand(socket, args) {
        if (args.length === 0 || args[0] === 'help') {
            const help = `\r\n${COLORS.bright}Database SQL Toolkit${COLORS.reset}\r\n` +
                `Usage: /sql ${COLORS.cyan}"[query]"${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Description:${COLORS.reset}\r\n` +
                `  Executes raw SQLite queries on the project chat database.\r\n` +
                `  ${COLORS.red}${COLORS.bright}WARNING:${COLORS.reset} Write access is enabled. Use with caution.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /sql SELECT * FROM chat_turns LIMIT 5\r\n` +
                `  /sql PRAGMA table_info(chat_turns)\r\n` +
                `  /sql DELETE FROM chat_turns WHERE id > 100\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        if (!chaptermanagement.isInitialized()) {
            socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Database not initialized.\x1b[0m' });
            return;
        }

        const sql = args.join(' ');
        try {
            const trimmed = sql.trim().toUpperCase();
            const isRead = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN');
            let result;

            if (isRead) {
                result = await chaptermanagement.genericQuery(sql);
                if (!result || result.length === 0) {
                    socket.emit('terminal-response', { success: true, output: 'Query executed. 0 results.' });
                    return;
                }
                const { renderTable } = require('../../utils.js');
                socket.emit('terminal-response', { success: true, output: renderTable(result) });
            } else {
                result = await chaptermanagement.genericExecute(sql);
                socket.emit('terminal-response', { success: true, output: `\x1b[1;32mCommand executed successfully.\x1b[0m Rows modified: ${result?.changes || 0}` });
            }
        } catch (err) {
            socket.emit('terminal-response', { success: false, output: `\x1b[1;31mSQL Error: ${err.message}\x1b[0m` });
        }
    }

    /**
     * Handles the /facts command.
     */
    async handleFactsCommand(socket, args) {
        const subcommand = args[0];

        if (!subcommand || subcommand === 'help') {
            const help = `\r\n${COLORS.bright}Factual Memory Navigator${COLORS.reset}\r\n` +
                `Usage: /facts ${COLORS.cyan}[subcommand]${COLORS.reset} ${COLORS.grey}[args]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Subcommands:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}list predicates${COLORS.reset}    - List all unique fact predicates.\r\n` +
                `  ${COLORS.cyan}list sources${COLORS.reset}       - List all unique fact sources.\r\n` +
                `  ${COLORS.cyan}source [name]${COLORS.reset}      - Show last 10 facts for a specific source.\r\n` +
                `  ${COLORS.cyan}predicate [name]${COLORS.reset}   - Show last 10 facts for a specific predicate.\r\n` +
                `  ${COLORS.cyan}search [query]${COLORS.reset}     - Fuzzy search through fact values.\r\n` +
                `  ${COLORS.cyan}latest${COLORS.reset}             - Show the 5 most recently added facts.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /facts list predicates\r\n` +
                `  /facts source Dehya\r\n` +
                `  /facts search "Mora"\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        if (!chaptermanagement.isInitialized()) {
            socket.emit('terminal-response', { success: false, output: `\x1b[1;31mError: Database not initialized.\x1b[0m` });
            return;
        }

        try {
            let sql = '';
            let params = [];

            switch (subcommand) {
                case 'list':
                    const listType = args[1] === 'sources' ? 'source' : 'predicate';
                    sql = `SELECT DISTINCT ${listType} FROM facts ORDER BY ${listType} ASC`;
                    break;
                case 'source':
                    if (!args[1]) throw new Error("Usage: /facts source [name]");
                    sql = `SELECT * FROM facts WHERE LOWER(source) = ? ORDER BY turn_number DESC, id DESC LIMIT 10`;
                    params = [args[1].toLowerCase()];
                    break;
                case 'predicate':
                    if (!args[1]) throw new Error("Usage: /facts predicate [name]");
                    sql = `SELECT * FROM facts WHERE UPPER(predicate) = ? ORDER BY turn_number DESC, id DESC LIMIT 10`;
                    params = [args[1].toUpperCase()];
                    break;
                case 'search':
                    if (!args[1]) throw new Error("Usage: /facts search [query]");
                    sql = `SELECT * FROM facts WHERE fact_value LIKE ? ORDER BY turn_number DESC, id DESC LIMIT 10`;
                    params = [`%${args[1]}%`];
                    break;
                case 'latest':
                    sql = `SELECT * FROM facts ORDER BY turn_number DESC, id DESC LIMIT 5`;
                    break;
                default:
                    throw new Error(`Unknown subcommand: ${subcommand}`);
            }

            const results = await chaptermanagement.genericQuery(sql, params);
            if (!results || results.length === 0) {
                socket.emit('terminal-response', { success: true, output: 'No facts found matching your criteria.' });
                return;
            }

            const { renderTable } = require('../../utils.js');

            // If it's a full fact row, we map it to cleaner columns
            // If it's just a 'list' result (e.g. DISTINCT source), we leave it as is
            let displayData = results;
            if (results[0].fact_value !== undefined) {
                displayData = results.map(f => ({
                    Turn: f.turn_number,
                    Source: f.source,
                    Predicate: f.predicate,
                    Value: f.fact_value
                }));
            }

            socket.emit('terminal-response', { success: true, output: renderTable(displayData) });
        } catch (err) {
            socket.emit('terminal-response', { success: false, output: `\x1b[1;31mFacts Error: ${err.message}\x1b[0m` });
        }
    }

    /**
     * Handles the /history command.
     */
    async handleHistoryCommand(socket, args) {
        if (!args[0] || args[0] === 'help') {
            const help = `\r\n${COLORS.bright}Turn History Toolkit${COLORS.reset}\r\n` +
                `Usage: /history ${COLORS.cyan}[limit]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Parameters:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}[limit]${COLORS.reset}    - Number of recent turns to show.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /history 10\r\n` +
                `  /history 25\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        if (!chaptermanagement.isInitialized()) {
            socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Database not initialized.\x1b[0m' });
            return;
        }

        const limit = parseInt(args[0]) || 10;
        try {
            const turns = await chaptermanagement.getLatestNChapters(limit);
            let output = `\r\n\x1b[1;32mTurn History (Last ${limit})\x1b[0m\r\n`;

            const { renderTable } = require('../../utils.js');
            const tableData = turns.map(t => ({
                Turn: t.turnNumber,
                Character: t.mainCharacterName || 'Narrator',
                Title: t.output?.title || 'Untitled',
                Summary: (t.output?.summary || '').substring(0, 50) + '...'
            }));

            output += renderTable(tableData);
            socket.emit('terminal-response', { success: true, output: output });
        } catch (err) {
            socket.emit('terminal-response', { success: false, output: `\x1b[1;31mError: ${err.message}\x1b[0m` });
        }
    }

    /**
     * Handles the /settings command.
     */
    async handleSettingsCommand(socket, args) {
        if (args[0] === 'help') {
            const help = `\r\n${COLORS.bright}System Settings Toolkit${COLORS.reset}\r\n` +
                `Usage: /settings\r\n\r\n` +
                `${COLORS.bright}Description:${COLORS.reset}\r\n` +
                `  Displays the current system-wide and project-specific configuration.\r\n` +
                `  Sensitive values like API keys are automatically redacted.\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        const { readSettings } = require('../../utils.js');
        const settings = readSettings();

        if (!settings) {
            socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Could not load settings.\x1b[0m' });
            return;
        }

        // Deep clone and redact sensitive keys before display
        const redacted = JSON.parse(JSON.stringify(settings));
        const redactKeys = ['apiKey', 'api_key', 'apikey', 'secret', 'password', 'token'];
        const redactObj = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
                if (redactKeys.some(r => key.toLowerCase().includes(r)) && typeof obj[key] === 'string' && obj[key].length > 0) {
                    obj[key] = obj[key].substring(0, 4) + '...[REDACTED]';
                } else if (typeof obj[key] === 'object') {
                    redactObj(obj[key]);
                }
            }
        };
        redactObj(redacted);

        let output = `\r\n\x1b[1;32mCurrent System Configuration Registry\x1b[0m\r\n`;

        const renderLevel = (obj, prefix = '') => {
            const keys = Object.keys(obj).sort();
            for (const key of keys) {
                const path = prefix ? `${prefix}.${key}` : key;
                const val = obj[key];

                if (val !== null && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0) {
                    renderLevel(val, path);
                } else {
                    const displayVal = this.formatValue(val, "    ");
                    output += `\r\n  \x1b[1;36m${path.padEnd(35)}\x1b[0m: ${displayVal}`;
                }
            }
        };

        renderLevel(redacted);
        output += `\r\n`;

        socket.emit('terminal-response', { success: true, output: output });
    }



    /**
     * Handles the /diff command.
     */
    async handleDiffCommand(socket, args) {
        if (args.length < 2 || args[0] === 'help') {
            const help = `\r\n${COLORS.bright}Context Diff Toolkit${COLORS.reset}\r\n` +
                `Usage: /diff ${COLORS.cyan}[turn_a]${COLORS.reset} ${COLORS.cyan}[turn_b]${COLORS.reset} ${COLORS.grey}[field_path]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Description:${COLORS.reset}\r\n` +
                `  Performs a deep recursive comparison between two TurnContext snapshots.\r\n` +
                `  If [field_path] is provided, only that property is compared with a high text limit.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /diff 41 42\r\n` +
                `  /diff 1 latest processed.director.writerBrief\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        const turnA = await this._resolveTurn(args[0]);
        const turnB = await this._resolveTurn(args[1]);
        const filterPath = args[2];

        if (!turnA || !turnB) {
            socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: One or both turns not found.\x1b[0m' });
            return;
        }

        let output = `\r\n\x1b[1;32mContext Diff: Turn ${turnA.turnNumber} vs Turn ${turnB.turnNumber}${filterPath ? ` (Filtered: ${filterPath})` : ''}\x1b[0m\r\n`;

        // Recursive diff on serialized snapshots for meaningful comparison
        let snapA = turnA.serialize ? turnA.serialize() : turnA;
        let snapB = turnB.serialize ? turnB.serialize() : turnB;

        if (filterPath) {
            snapA = this.getNestedValue(snapA, filterPath);
            snapB = this.getNestedValue(snapB, filterPath);
        }

        let diffCount = 0;
        const textLimit = filterPath ? 2000 : 500;

        const diffKeys = (objA, objB, prefix = '') => {
            // Handle non-object comparisons at the current level
            if (typeof objA !== 'object' || typeof objB !== 'object' || objA === null || objB === null || Array.isArray(objA) || Array.isArray(objB)) {
                if (JSON.stringify(objA) !== JSON.stringify(objB)) {
                    diffCount++;
                    const format = (v) => {
                        let s = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
                        if (s.length > textLimit) s = s.substring(0, textLimit - 3) + '...';
                        return s.replace(/\r?\n/g, '\r\n    '); // Indent for diff
                    };
                    output += `\x1b[1;36m${prefix || filterPath || 'root'}\x1b[0m\r\n`;
                    output += `  \x1b[1;31m- ${format(objA)}\x1b[0m\r\n`;
                    output += `  \x1b[1;32m+ ${format(objB)}\x1b[0m\r\n`;
                }
                return;
            }

            const allKeys = Array.from(new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})])).sort();
            for (const k of allKeys) {
                const path = prefix ? `${prefix}.${k}` : k;
                const vA = objA?.[k];
                const vB = objB?.[k];

                if (JSON.stringify(vA) === JSON.stringify(vB)) continue;

                if (vA && vB && typeof vA === 'object' && typeof vB === 'object' && !Array.isArray(vA) && !Array.isArray(vB)) {
                    diffKeys(vA, vB, path);
                    continue;
                }

                diffCount++;
                const format = (v) => {
                    let s = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
                    if (s.length > textLimit) s = s.substring(0, textLimit - 3) + '...';
                    return s.replace(/\r?\n/g, '\r\n    ');
                };
                output += `\x1b[1;36m${path}\x1b[0m\r\n`;
                output += `  \x1b[1;31m- ${format(vA)}\x1b[0m\r\n`;
                output += `  \x1b[1;32m+ ${format(vB)}\x1b[0m\r\n`;
            }
        };

        diffKeys(snapA, snapB, filterPath || '');
        output += `\r\n\x1b[1;30m${diffCount} difference(s) found.\x1b[0m\r\n`;

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Shows runtime logs for a specific plugin in the current turn.
     * If no plugin ID is provided, lists all plugins that have runtime logs.
     */
    async handlePluginsLogsCommand(socket, args) {
        const pluginId = args[1];

        // Use _resolveTurn for safe fallback (avoids DB crash when uninitialized)
        const turn = await this._resolveTurn();

        if (!turn) {
            socket.emit('terminal-response', { success: false, output: 'No turns found.' });
            return;
        }

        if (!pluginId) {
            // List plugins with logs
            const runtimePlugins = turn.runtime?.plugins || {};
            const pluginsWithLogs = Object.keys(runtimePlugins).filter(id => Array.isArray(runtimePlugins[id].logs) && runtimePlugins[id].logs.length > 0);

            if (pluginsWithLogs.length === 0) {
                socket.emit('terminal-response', {
                    success: true,
                    output: `\r\n\x1b[1;33mNo plugin runtime logs found for Turn ${turn.turnNumber}.\x1b[0m`
                });
                return;
            }

            let output = `\r\n\x1b[1;32mPlugins with Runtime Logs (Turn ${turn.turnNumber}):\x1b[0m\r\n`;
            pluginsWithLogs.forEach(id => {
                const count = runtimePlugins[id].logs.length;
                output += `  \x1b[1;36m${id}\x1b[0m: ${count} logs\r\n`;
            });
            output += `\r\nUsage: /plugins logs [plugin_id] to view details.`;

            socket.emit('terminal-response', { success: true, output: output });
            return;
        }

        const logs = this.getNestedValue(turn, `runtime.plugins.${pluginId}.logs`);
        if (logs === '[NULL]' || logs === '[UNDEFINED]' || !Array.isArray(logs)) {
            socket.emit('terminal-response', { success: true, output: `No runtime logs found for plugin '${pluginId}' in Turn ${turn.turnNumber}.` });
            return;
        }

        let output = `\r\n\x1b[1;32mRuntime Logs for Plugin '${pluginId}' (Turn ${turn.turnNumber}):\x1b[0m\r\n`;
        output += logs.join('\r\n');

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Lists all active and disabled plugins.
     */
    async handlePluginsListCommand(socket, _args) {
        const metadata = pluginManager.getAllPluginsMetadata();

        if (!metadata || metadata.length === 0) {
            socket.emit('terminal-response', { success: true, output: 'No plugins found.' });
            return;
        }

        let output = '\r\n\x1b[1;32mRegistered Plugins:\x1b[0m\r\n';
        metadata.forEach(p => {
            const status = p.enabled ? '\x1b[1;32m[ACTIVE]\x1b[0m' : '\x1b[1;31m[DISABLED]\x1b[0m';
            output += `  ${status} \x1b[1;36m${p.id}\x1b[0m (v${p.version}) - ${p.description}\r\n`;
        });

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Shows hooks and their subscribers.
     */
    async handlePluginsHooksCommand(socket, args) {
        const filter = args[1] ? args[1].toLowerCase() : null;
        const allHooks = Array.from(pluginManager.hooks.entries()).sort((a, b) => a[0].localeCompare(b[0]));

        if (allHooks.length === 0) {
            socket.emit('terminal-response', { success: true, output: 'No hooks registered.' });
            return;
        }

        let output = `\r\n\x1b[1;32mPlugin Hooks Registry${filter ? ` (Filter: ${filter})` : ''}:\x1b[0m\r\n`;
        let found = false;

        for (const [hookName, allListeners] of allHooks) {
            if (filter && !hookName.toLowerCase().includes(filter)) continue;
            found = true;

            output += `\r\n\x1b[1;33m${hookName}\x1b[0m\r\n`;

            const background = allListeners.filter(l => l.mode === 'background');
            const blocking = allListeners.filter(l => l.mode !== 'background');

            // Group blocking listeners by priority
            const priorityGroups = [];
            let currentGroup = null;

            for (const listener of blocking) {
                if (!currentGroup || currentGroup.priority !== listener.priority) {
                    currentGroup = { priority: listener.priority, listeners: [] };
                    priorityGroups.push(currentGroup);
                }
                currentGroup.listeners.push(listener);
            }

            let step = 1;

            // Execute priority groups logic for display
            for (const group of priorityGroups) {
                let i = 0;
                while (i < group.listeners.length) {
                    const listener = group.listeners[i];
                    if (listener.mode === 'sequential') {
                        output += `  \x1b[1;30m[${String(step++).padStart(2, '0')}]\x1b[0m \x1b[0;36mSequential:\x1b[0m \x1b[1;37m${listener.pluginId}\x1b[0m \x1b[0;90m(Priority: ${listener.priority})\x1b[0m\r\n`;
                        i++;
                    } else if (listener.mode === 'parallel') {
                        const parallelBatch = [];
                        while (i < group.listeners.length && group.listeners[i].mode === 'parallel') {
                            parallelBatch.push(group.listeners[i]);
                            i++;
                        }

                        if (parallelBatch.length > 0) {
                            output += `  \x1b[1;30m[${String(step++).padStart(2, '0')}]\x1b[0m \x1b[0;35mParallel Block:\x1b[0m \x1b[0;90m(Priority: ${group.priority})\x1b[0m\r\n`;
                            parallelBatch.forEach(l => {
                                output += `       \x1b[1;30m-\x1b[0m \x1b[1;37m${l.pluginId}\x1b[0m\r\n`;
                            });
                        }
                    } else {
                        i++;
                    }
                }
            }

            // Background
            if (background.length > 0) {
                output += `  \x1b[1;30m[--]\x1b[0m \x1b[0;34mBackground (Async):\x1b[0m\r\n`;
                background.forEach(l => {
                    output += `       \x1b[1;30m-\x1b[0m \x1b[1;37m${l.pluginId}\x1b[0m \x1b[0;90m(Priority: ${l.priority})\x1b[0m\r\n`;
                });
            }
        }

        if (!found && filter) {
            output = `\x1b[1;31mNo hooks found matching filter: ${filter}\x1b[0m`;
        }

        socket.emit('terminal-response', { success: true, output: output });
    }

    /**
     * Handles the /turncontext command routing.
     */
    async handleTurnContextCommand(socket, args) {
        const subcommand = args[0];

        if (!subcommand || subcommand === 'help') {
            const help = `\r\n${COLORS.bright}TurnContext Inspection Toolkit${COLORS.reset}\r\n` +
                `Usage: /turncontext ${COLORS.cyan}[subcommand]${COLORS.reset} ${COLORS.grey}[args]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Subcommands:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}show${COLORS.reset}       - Inspect specific properties across turns (e.g. /turncontext show "runtime.performance")\r\n` +
                `  ${COLORS.cyan}tree${COLORS.reset}       - Visualize the contextual hierarchy/snapshot tree structure.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /turncontext show "runtime.assets" latest\r\n` +
                `  /turncontext show "input.userPrompt && output.fulltext" 5-10\r\n` +
                `  /turncontext tree 42\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        if (subcommand === 'show') {
            await this.handleTurnContextShowCommand(socket, args);
        } else if (subcommand === 'tree') {
            await this.handleTurnContextTreeCommand(socket, args);
        } else {
            socket.emit('terminal-response', {
                success: false,
                output: `\x1b[1;31mUnknown subcommand: ${subcommand}\x1b[0m. Use '/turncontext help' for usage.`
            });
        }
    }

    /**
     * Original logic for /turncontext show.
     */
    async handleTurnContextShowCommand(socket, args) {
        if (args.length < 2) {
            socket.emit('terminal-response', {
                success: false,
                output: 'Usage: /turncontext show "path1 && path2" [limit|range]'
            });
            return;
        }

        // Robust argument extraction:
        // args[0] is 'show'
        // The last arg might be a limit (number) or a range (X-Y)
        // Everything in between is part of the field path
        let fieldPathRaw = "";
        let selector = "1";

        const lastArg = args[args.length - 1];
        const isRange = lastArg.includes('-');
        const isLimit = !isNaN(parseInt(lastArg)) && !lastArg.includes('.') && !lastArg.includes('/') && !lastArg.includes('\\');

        if ((isRange || isLimit) && args.length > 2) {
            selector = lastArg;
            fieldPathRaw = args.slice(1, -1).join(' ');
        } else {
            fieldPathRaw = args.slice(1).join(' ');
        }

        const cleanPathArg = fieldPathRaw.trim().replace(/^"|"$/g, '');
        const fieldPaths = cleanPathArg.split('&&').map(p => p.trim()).filter(p => p !== '');

        if (fieldPaths.length === 0) {
            socket.emit('terminal-response', {
                success: false,
                output: 'Error: No field paths specified.'
            });
            return;
        }

        let turns = [];
        if (selector.includes('-')) {
            if (!chaptermanagement.isInitialized()) {
                socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Database not initialized.\x1b[0m' });
                return;
            }
            const [start, end] = selector.split('-').map(n => parseInt(n));
            if (isNaN(start) || isNaN(end)) {
                socket.emit('terminal-response', { success: false, output: 'Invalid range format. Use X-Y.' });
                return;
            }
            turns = await chaptermanagement.getTurnRange(start, end);
        } else {
            const limit = parseInt(selector) || 1;
            if (limit === 1) {
                // Try resolving latest turn without depending entirely on db
                const singleTurn = await this._resolveTurn(null);
                if (singleTurn) turns = [singleTurn];
            } else {
                if (!chaptermanagement.isInitialized()) {
                    socket.emit('terminal-response', { success: false, output: '\x1b[1;31mError: Database not initialized.\x1b[0m' });
                    return;
                }
                turns = await chaptermanagement.getLatestNChapters(limit);
            }
        }

        if (!turns || turns.length === 0) {
            socket.emit('terminal-response', {
                success: true,
                output: '\x1b[1;33mNo turns found for the specified criteria.\x1b[0m'
            });
            return;
        }

        let output = `\r\n\x1b[1;32mShowing ${fieldPaths.length} fields for ${turns.length} turns:\x1b[0m\r\n`;

        turns.forEach(turn => {
            output += `\r\n\x1b[1;33m[Turn ${turn.turnNumber}]\x1b[0m`;

            fieldPaths.forEach(fieldPath => {
                const val = this.getNestedValue(turn, fieldPath);
                const displayVal = this.formatValue(val, "    ");
                output += `\r\n  \x1b[1;36m${fieldPath}\x1b[0m: ${displayVal}`;
            });
            output += `\r\n`;
        });

        socket.emit('terminal-response', {
            success: true,
            output: output
        });
    }

    /**
     * Logic for /turncontext tree.
     */
    async handleTurnContextTreeCommand(socket, args) {
        // args = ['tree', '--detail', '5'] or ['tree', '5'] or ['tree']
        let showDetail = false;
        let turnSelector = null;

        for (let i = 1; i < args.length; i++) {
            if (args[i] === '--detail') {
                showDetail = true;
            } else if (!isNaN(parseInt(args[i]))) {
                turnSelector = args[i];
            }
        }

        // Use _resolveTurn helper - avoids reinventing the wheel and prevents uninitialized DB crashes
        const turn = await this._resolveTurn(turnSelector);

        if (!turn) {
            socket.emit('terminal-response', {
                success: false,
                output: `\x1b[1;31mTurn ${turnSelector || 'latest'} not found.\x1b[0m`
            });
            return;
        }

        const snapshot = turn.serialize();
        const paths = [];
        this.traverseAndCollectPaths(snapshot, '', paths, showDetail);

        let output = `\r\n\x1b[1;32mTree structure for Turn ${turn.turnNumber}${showDetail ? ' (with details)' : ''}:\x1b[0m\r\n`;
        output += paths.join('\r\n');

        socket.emit('terminal-response', {
            success: true,
            output: output
        });
    }

    /**
     * Recursively traverses an object and collects all dot-notated paths.
     */
    traverseAndCollectPaths(obj, prefix, results, showDetail) {
        if (obj === null || typeof obj !== 'object') return;

        // Sort keys to ensure consistent output
        const keys = Object.keys(obj).sort();

        for (const key of keys) {
            const path = prefix ? `${prefix}.${key}` : key;
            const val = obj[key];

            if (showDetail) {
                results.push(`\x1b[1;36m${path}\x1b[0m ${this.formatBriefValue(val)}`);
            } else {
                let label = "";
                if (Array.isArray(val)) {
                    label = ` ${this.formatBriefValue(val)}`;
                } else if (val !== null && typeof val === 'object') {
                    label = ` ${this.formatBriefValue(val)}`;
                }
                results.push(`\x1b[1;36m${path}\x1b[0m${label}`);
            }

            // Recursively go deeper
            if (val !== null && typeof val === 'object') {
                if (!Array.isArray(val)) {
                    // Standard nested object
                    this.traverseAndCollectPaths(val, path, results, showDetail);
                } else if (val.length > 0) {
                    // If it's an array, recurse into the first element to show its structure
                    const firstElem = val[0];
                    if (firstElem !== null && typeof firstElem === 'object') {
                        this.traverseAndCollectPaths(firstElem, path + "[0]", results, showDetail);
                    }
                }
            }
        }
    }

    /**
     * Formats a value concisely for the tree view.
     */
    formatBriefValue(val) {
        if (val === null || val === '[NULL]') return '\x1b[1;30m[NULL]\x1b[0m';
        if (val === undefined || val === '[UNDEFINED]') return '\x1b[1;30m[UNDEFINED]\x1b[0m';

        if (Array.isArray(val)) {
            return `\x1b[1;34m[ARRAY(${val.length})]\x1b[0m`;
        }

        if (typeof val === 'object') {
            return `\x1b[1;34m[OBJECT]\x1b[0m`;
        }

        let str = String(val).replace(/[\r\n]/g, ' ');
        const limit = 150;
        if (str.length > limit) {
            str = str.substring(0, limit - 3) + '...';
        }
        return `\x1b[0;37m"${str}"\x1b[0m`;
    }

    /**
     * Formats a value for terminal display, handling objects and multiline strings gracefully.
     */
    formatValue(val, basePadding = "    ") {
        if (val === null || val === '[NULL]') return '\x1b[1;30m[NULL]\x1b[0m';
        if (val === undefined || val === '[UNDEFINED]') return '\x1b[1;30m[UNDEFINED]\x1b[0m';

        const str = (typeof val === 'object') ? JSON.stringify(val, null, 1) : String(val);
        const lines = str.split(/\r?\n/);

        return lines.map((line, i) => {
            if (i === 0) return line; // First line follows the "field: "
            return `\r\n${basePadding}${line}`; // Subsequent lines get basePadding and a proper carriage return
        }).join('');
    }

    /**
     * Safely retrieves a nested value from an object.
     */
    getNestedValue(obj, path) {
        if (!path) return obj;
        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return '[NULL]';
            }
            current = current[part];
        }

        return current === undefined ? '[UNDEFINED]' : (current === null ? '[NULL]' : current);
    }

    async handleClearCommand(socket, _args) {
        socket.emit('terminal-clear');
    }

    async handleRagCommand(socket, args) {
        const subcommand = args[0];

        if (!subcommand || subcommand === 'help') {
            const help = `\r\n${COLORS.bright}LanceDB Vector Inspection Toolkit${COLORS.reset}\r\n` +
                `Usage: /rag ${COLORS.cyan}[subcommand]${COLORS.reset} ${COLORS.grey}[args]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Subcommands:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}list${COLORS.reset}           - List available vector databases in the active project.\r\n` +
                `  ${COLORS.cyan}stats${COLORS.reset} ${COLORS.grey}[db]${COLORS.reset}      - Show statistics for a specific database (name or path).\r\n` +
                `  ${COLORS.cyan}query${COLORS.reset} ${COLORS.grey}[db] [q]${COLORS.reset}  - Execute a semantic search query.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /rag list\r\n` +
                `  /rag stats chapters\r\n` +
                `  /rag query static_lore "Who is Dehya?" 3\r\n` +
                `  /rag stats "C:/Project/vectors/custom_db"\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        const turn = await this._resolveTurn('latest');
        const projectRoot = turn?.rootDirectory;

        if (subcommand === 'list') {
            if (!projectRoot) {
                socket.emit('terminal-response', { success: false, output: `${COLORS.red}Error: Could not determine project root.${COLORS.reset}` });
                return;
            }
            const vectorsPath = path.join(projectRoot, 'vectors');
            if (!fs.existsSync(vectorsPath)) {
                socket.emit('terminal-response', { success: true, output: `No vector databases found at ${vectorsPath}` });
                return;
            }
            const dirs = fs.readdirSync(vectorsPath).filter(f => fs.statSync(path.join(vectorsPath, f)).isDirectory());
            let output = `\r\n${COLORS.bright}Available Vector DBs in ${path.basename(projectRoot)}:${COLORS.reset}\r\n`;
            dirs.forEach(d => output += `  ${COLORS.cyan}- ${d}${COLORS.reset}\r\n`);
            socket.emit('terminal-response', { success: true, output: output });
        } else if (subcommand === 'stats') {
            const dbTarget = args[1];
            if (!dbTarget) {
                socket.emit('terminal-response', { success: false, output: 'Usage: /rag stats [dbname|path]' });
                return;
            }
            try {
                const isAbs = path.isAbsolute(dbTarget);
                const options = isAbs ? { rawPath: dbTarget } : {};
                const dbName = isAbs ? 'external' : dbTarget;
                const store = await vectorStoreManager.getStore(turn?.projectName || 'default', dbName, options);
                const rows = await store.rowCount();
                socket.emit('terminal-response', { success: true, output: `${COLORS.bright}${dbTarget}${COLORS.reset}: ${COLORS.green}${rows}${COLORS.reset} rows.` });
            } catch (e) {
                socket.emit('terminal-response', { success: false, output: `${COLORS.red}Failed to get stats: ${e.message}${COLORS.reset}` });
            }
        } else if (subcommand === 'query') {
            const dbTarget = args[1];
            const queryText = args[2];
            const limit = parseInt(args[3]) || 3;
            if (!dbTarget || !queryText) {
                socket.emit('terminal-response', { success: false, output: 'Usage: /rag query [dbname|path] "[query]" [limit]' });
                return;
            }
            try {
                const isAbs = path.isAbsolute(dbTarget);
                const options = isAbs ? { rawPath: dbTarget } : {};
                const dbName = isAbs ? 'external' : dbTarget;
                const store = await vectorStoreManager.getStore(turn?.projectName || 'default', dbName, options);
                const results = await store.similaritySearch(queryText, limit);

                let output = `\r\n${COLORS.bright}Top ${results.length} results for "${queryText}":${COLORS.reset}\r\n`;
                results.forEach((r, i) => {
                    output += `\r\n${COLORS.yellow}[Result ${i + 1}]${COLORS.reset}\r\n`;
                    output += `  ${r.pageContent.substring(0, 500)}${r.pageContent.length > 500 ? '...' : ''}\r\n`;
                    output += `  ${COLORS.dim}Metadata: ${JSON.stringify(r.metadata)}${COLORS.reset}\r\n`;
                });
                socket.emit('terminal-response', { success: true, output: output });
            } catch (e) {
                socket.emit('terminal-response', { success: false, output: `${COLORS.red}Query failed: ${e.message}${COLORS.reset}` });
            }
        } else {
            socket.emit('terminal-response', { success: false, output: `Unknown subcommand: ${subcommand}. Use /rag help.` });
        }
    }

    async handleExportCommand(socket, args) {
        const turnSelector = args[0];
        if (!turnSelector || turnSelector === 'help') {
            const help = `\r\n${COLORS.bright}TurnContext Export Tool${COLORS.reset}\r\n` +
                `Usage: /export ${COLORS.cyan}[turn_selector]${COLORS.reset}\r\n\r\n` +
                `Exports the full TurnContext snapshot to a pretty-printed JSON file in the project's 'exports' folder.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /export latest\r\n` +
                `  /export 42\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        const turn = await this._resolveTurn(turnSelector);
        if (!turn) {
            socket.emit('terminal-response', { success: false, output: `${COLORS.red}Turn ${turnSelector} not found.${COLORS.reset}` });
            return;
        }

        try {
            await turn.ensureFull();
            const snapshot = turn.serialize();
            const projectRoot = turn.rootDirectory;
            if (!projectRoot) throw new Error("Could not determine project root.");

            const exportsDir = path.join(projectRoot, 'exports');
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `turn_${turn.turnNumber}_${timestamp}.json`;
            const filePath = path.join(exportsDir, fileName);

            fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
            socket.emit('terminal-response', { success: true, output: `${COLORS.green}Successfully exported Turn ${turn.turnNumber} to:${COLORS.reset}\r\n${filePath}` });
        } catch (e) {
            socket.emit('terminal-response', { success: false, output: `${COLORS.red}Export failed: ${e.message}${COLORS.reset}` });
        }
    }

    /**
     * Handles the /sprites command to visualize available assets.
     */
    async handleSpritesCommand(socket, args) {
        const { getProjectSpriteCatalog } = require('../../vn_manager/rendering/sprite_finder.js');
        const subcommand = args[0] ? args[0].toLowerCase() : null;
        const charFilter = args[1] ? args[1].toLowerCase() : null;

        if (!subcommand || subcommand === 'help') {
            const help = `\r\n${COLORS.bright}Sprite Asset Navigator${COLORS.reset}\r\n` +
                `Usage: /sprites ${COLORS.cyan}<subcommand>${COLORS.reset} ${COLORS.grey}[args]${COLORS.reset}\r\n\r\n` +
                `${COLORS.bright}Subcommands:${COLORS.reset}\r\n` +
                `  ${COLORS.cyan}all${COLORS.reset}             - List every character and variant in the project.\r\n` +
                `  ${COLORS.cyan}char${COLORS.reset} ${COLORS.yellow}[name]${COLORS.reset}    - Show sprites for a specific character.\r\n` +
                `  ${COLORS.cyan}help${COLORS.reset}            - Show this help message.\r\n\r\n` +
                `${COLORS.bright}Examples:${COLORS.reset}\r\n` +
                `  /sprites all\r\n` +
                `  /sprites char Dehya\r\n`;
            socket.emit('terminal-response', { success: true, output: help });
            return;
        }

        // 1. Gather catalog from sprite_finder
        const turn = await this._resolveTurn();
        const { catalog, searchedDir } = await getProjectSpriteCatalog(pluginManager.projectRoot, turn);

        if (!catalog) {
            socket.emit('terminal-response', {
                success: false,
                output: `\x1b[1;31mNo sprites found in current project.${COLORS.reset}\r\n${COLORS.dim}Searched in: ${searchedDir}${COLORS.reset}`
            });
            return;
        }

        let output = `\r\n${COLORS.bright}${COLORS.green}Character Sprite Manifest${COLORS.reset}\r\n`;
        output += `${COLORS.dim}Found ${catalog.summary.characterCount} characters, ${catalog.summary.totalSprites} total files.${COLORS.reset}\r\n\r\n`;

        const characterKeys = Object.keys(catalog.characters).sort();
        let filteredKeys = characterKeys;

        if (subcommand === 'char') {
            if (!charFilter) {
                socket.emit('terminal-response', { success: false, output: 'Usage: /sprites char [name]' });
                return;
            }
            filteredKeys = characterKeys.filter(k => k.includes(charFilter));
        }

        if (filteredKeys.length === 0) {
            socket.emit('terminal-response', { success: true, output: output + `No characters found matching search criteria.` });
            return;
        }

        const complexKeys = filteredKeys.filter(k => catalog.characters[k].isComplex);
        const simpleKeys = filteredKeys.filter(k => !catalog.characters[k].isComplex);

        // 1. Render Complex Characters (Full Grids)
        for (const charKey of complexKeys) {
            const char = catalog.characters[charKey];
            output += `${COLORS.bright}${COLORS.cyan}${charKey.toUpperCase()}${COLORS.reset}\r\n`;

            for (const variantKey of char.variants) {
                const variant = char.variantData[variantKey];
                const variantLabel = variantKey === 'default' ? '' : ` (${COLORS.magenta}${variantKey}${COLORS.reset})`;
                output += `  ${COLORS.bright}Variant:${COLORS.reset}${variantLabel}\r\n`;

                const emotionsMap = variant.emotionData || {};

                // Render Grid
                output += `    ${COLORS.bright}${COLORS.white}${'Expression'.padEnd(15)} |  F  R  L  B  |  I  R  | Animations${COLORS.reset}\r\n`;
                output += `    ${COLORS.dim}------------------------------------------------------------${COLORS.reset}\r\n`;

                const sortedEmotions = Object.keys(emotionsMap).sort();
                for (const emo of sortedEmotions) {
                    const e = emotionsMap[emo];
                    const f = e.F ? `${COLORS.green}F${COLORS.reset}` : `${COLORS.dim}f${COLORS.reset}`;
                    const r = e.R ? `${COLORS.green}R${COLORS.reset}` : `${COLORS.dim}r${COLORS.reset}`;
                    const l = e.L ? `${COLORS.green}L${COLORS.reset}` : `${COLORS.dim}l${COLORS.reset}`;
                    const b = e.B ? `${COLORS.green}B${COLORS.reset}` : `${COLORS.dim}b${COLORS.reset}`;
                    
                    const icon = e.I ? `${COLORS.magenta}I${COLORS.reset}` : `${COLORS.dim}i${COLORS.reset}`;
                    const ref = e.R_ref ? `${COLORS.magenta}R${COLORS.reset}` : `${COLORS.dim}r${COLORS.reset}`;

                    const talk = e.T ? `${COLORS.yellow}[T]${COLORS.reset}` : '   ';
                    const blink = e.B_layer ? `${COLORS.cyan}[B]${COLORS.reset}` : '   ';
                    const both = e.TB ? `${COLORS.magenta}[TB]${COLORS.reset}` : '    ';

                    output += `    ${emo.padEnd(15)} |  ${f}  ${r}  ${l}  ${b}  |  ${icon}  ${ref}  | ${talk} ${blink} ${both}\r\n`;
                }
                output += `\r\n`;
            }
        }

        // 2. Render Simple Characters (Summary Table)
        if (simpleKeys.length > 0) {
            output += `${COLORS.bright}${COLORS.green}Background Assets & Simple Characters${COLORS.reset}\r\n`;
            output += `${COLORS.bright}${COLORS.white}${'Character'.padEnd(20)} | Sprite | Icon | Ref${COLORS.reset}\r\n`;
            output += `${COLORS.dim}------------------------------------------------------------${COLORS.reset}\r\n`;

            for (const charKey of simpleKeys) {
                const char = catalog.characters[charKey];
                // For simple characters, we check the default variant's properties
                const defaultVariant = char.variantData[char.defaultVariant] || {};
                
                const hasSprite = char.baseSprites.length > 0 ? `${COLORS.green}  X   ${COLORS.reset}` : '      ';
                const hasIcon = defaultVariant.hasIcon ? `${COLORS.magenta}  X   ${COLORS.reset}` : '      ';
                const hasRef = defaultVariant.hasReference ? `${COLORS.magenta}  X   ${COLORS.reset}` : '      ';

                output += `${charKey.padEnd(20)} | ${hasSprite} | ${hasIcon} | ${hasRef}\r\n`;
            }
            output += `\r\n`;
        }

        // Add Legend
        output += `${COLORS.dim}------------------------------------------------------------${COLORS.reset}\r\n`;
        output += `${COLORS.bright}Legend:${COLORS.reset} ${COLORS.green}FRLB${COLORS.reset}=Rotations | ${COLORS.magenta}I${COLORS.reset}=Icon, ${COLORS.magenta}R${COLORS.reset}=Ref | ` +
            `${COLORS.yellow}[T]${COLORS.reset}=Talk, ${COLORS.cyan}[B]${COLORS.reset}=Blink, ${COLORS.magenta}[TB]${COLORS.reset}=Talk+Blink\r\n`;

        socket.emit('terminal-response', { success: true, output: output });
    }
}

module.exports = MemoryBrowserCLI;
