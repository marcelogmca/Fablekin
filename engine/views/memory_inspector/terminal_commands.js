/**
 * terminal_commands.js
 * Handles user input and command execution for the Memory Inspector Terminal.
 */

class TerminalCommandHandler {
    constructor(term, socket) {
        this.term = term;
        this.socket = socket;
        this.currentInput = '';
        this.cursorPos = 0; // Current position in the input string
        this.promptStr = '$ ';
        
        // History management
        this.history = this.loadHistory();
        this.historyIndex = -1;
        this.tempInput = ''; 
    }

    /**
     * Normalizes backend output into CRLF line endings so xterm always resets column.
     * This prevents staircase rendering on multiline JSON/table output.
     * @param {any} output
     * @returns {string}
     */
    normalizeOutput(output) {
        if (output === null || output === undefined) return '';
        const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
    }

    /**
     * Re-renders the current line from the prompt.
     */
    renderLine() {
        // Move cursor to start of line (after prompt)
        // \x1b[2K clears the line, \r moves to start
        this.term.write('\r\x1b[2K' + this.promptStr + this.currentInput);
        
        // Move terminal cursor back to the correct position
        const moveBack = this.currentInput.length - this.cursorPos;
        if (moveBack > 0) {
            this.term.write('\x1b[' + moveBack + 'D');
        }
    }

    /**
     * Initializes listeners for terminal input and clipboard events.
     */
    init() {
        // Listen for responses from the backend
        this.socket.on('terminal-response', (data) => {
            const normalizedOutput = this.normalizeOutput(data.output);
            if (normalizedOutput) {
                this.term.write(`\r\n${normalizedOutput}`);
            }
            this.currentInput = '';
            this.cursorPos = 0;
            this.historyIndex = -1;
            this.tempInput = '';
            this.term.write('\r\n' + this.promptStr);
        });

        // Long-running plugin commands can stream progress without completing the prompt.
        this.socket.on('terminal-stream', (data) => {
            const normalizedOutput = this.normalizeOutput(data.output);
            if (normalizedOutput) this.term.write(`\r\n${normalizedOutput}`);
        });

        this.socket.on('terminal-clear', () => {
            this.term.clear();
            this.currentInput = '';
            this.cursorPos = 0;
            this.historyIndex = -1;
            this.tempInput = '';
            this.term.write('\r' + this.promptStr);
        });


        // --- CLIPBOARD SUPPORT (COPY ONLY, PASTE HANDLED BY ONDATA) ---
        this.term.attachCustomKeyEventHandler((e) => {
            const key = String(e.key || '').toLowerCase();
            const isCopyShortcut =
                (e.ctrlKey && key === 'c') ||
                (e.ctrlKey && e.shiftKey && key === 'c') ||
                (e.ctrlKey && key === 'insert') ||
                (e.metaKey && key === 'c');

            if (isCopyShortcut) {
                if (e.type !== 'keydown') return false;
                const selection = this.term.getSelection();
                if (!selection) return false;

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(selection).catch(() => {});
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = selection;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand("copy");
                    document.body.removeChild(textArea);
                }
                return false;
            }
            // Let xterm handle Ctrl+V naturally, which will trigger onData
            return true;
        });

        this.term.onData(data => {
            // ANSI escape sequences (Arrows, Home, End, etc.)
            if (data.startsWith('\x1b')) {
                switch (data) {
                    case '\x1b[A': // UP
                        this.navigateHistory(1);
                        break;
                    case '\x1b[B': // DOWN
                        this.navigateHistory(-1);
                        break;
                    case '\x1b[C': // RIGHT
                        if (this.cursorPos < this.currentInput.length) {
                            this.cursorPos++;
                            this.renderLine();
                        }
                        break;
                    case '\x1b[D': // LEFT
                        if (this.cursorPos > 0) {
                            this.cursorPos--;
                            this.renderLine();
                        }
                        break;
                    case '\x1b[3~': // DELETE key
                        if (this.cursorPos < this.currentInput.length) {
                            this.currentInput = this.currentInput.slice(0, this.cursorPos) + this.currentInput.slice(this.cursorPos + 1);
                            this.renderLine();
                        }
                        break;
                    case '\x1b[H': // HOME
                        this.cursorPos = 0;
                        this.renderLine();
                        break;
                    case '\x1b[F': // END
                        this.cursorPos = this.currentInput.length;
                        this.renderLine();
                        break;
                }
                return;
            }

            // Process characters (handles both typing and multi-character pastes)
            for (let i = 0; i < data.length; i++) {
                const char = data[i];

                if (char === '\r' || char === '\n') {
                    this.term.write('\r\n');
                    this.handleCommand(this.currentInput);
                    // For multi-line paste, we treat the first newline as the execution trigger 
                    // and ignore the rest of this chunk to prevent multiple rapid commands.
                    return; 
                } 

                if (char === '\u007f' || char === '\b') {
                    if (this.cursorPos > 0) {
                        this.currentInput = this.currentInput.slice(0, this.cursorPos - 1) + this.currentInput.slice(this.cursorPos);
                        this.cursorPos--;
                        this.historyIndex = -1;
                    }
                } else if (char >= ' ' && char <= '~') {
                    // Insert printable characters at cursor position
                    this.currentInput = this.currentInput.slice(0, this.cursorPos) + char + this.currentInput.slice(this.cursorPos);
                    this.cursorPos++;
                    this.historyIndex = -1;
                }
            }
            this.renderLine();
        });
    }

    /**
     * Navigates through command history.
     */
    navigateHistory(direction) {
        if (this.history.length === 0) return;

        if (this.historyIndex === -1) {
            this.tempInput = this.currentInput;
        }

        const newIndex = this.historyIndex + direction;

        if (newIndex >= -1 && newIndex < this.history.length) {
            this.historyIndex = newIndex;
            
            if (this.historyIndex === -1) {
                this.currentInput = this.tempInput;
            } else {
                this.currentInput = this.history[this.history.length - 1 - this.historyIndex];
            }
            
            this.cursorPos = this.currentInput.length;
            this.renderLine();
        }
    }

    /**
     * Processes the entered command.
     * @param {string} input 
     */
    handleCommand(input) {
        const cmd = input.trim();
        this.historyIndex = -1;

        if (cmd === '') {
            this.currentInput = '';
            this.cursorPos = 0;
            this.term.write(this.promptStr);
            return;
        }

        // History management
        this.history = this.history.filter(h => h !== cmd);
        this.history.push(cmd);
        if (this.history.length > 50) this.history.shift();
        this.saveHistory();

        // Improved parsing logic that respects quotes
        const parts = [];
        const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
        let match;
        while ((match = regex.exec(cmd)) !== null) {
            // Use match[1] or match[2] if the argument was quoted, otherwise use match[0]
            parts.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[0]));
        }

        if (parts.length === 0) return;
        const commandName = parts[0].toLowerCase();

        // --- BUILT-IN COMMANDS (Handled via Backend) ---
        if (commandName === '/help') {
            this.socket.emit('terminal-command', { command: '/help', args: [] });
            return;
        }

        if (commandName === '/hello') {
            this.socket.emit('terminal-command', { command: '/hello', args: [] });
            return;
        }

        if (commandName === '/turncontext') {
            const subcommand = parts[1];
            if (subcommand === 'show' || subcommand === 'tree') {
                const args = parts.slice(1);
                this.socket.emit('terminal-command', { 
                    command: '/turncontext', 
                    args: args 
                });
            } else {
                this.term.writeln('\r\nUsage:');
                this.term.writeln('  /turncontext show "path1 && path2" [limit|range]');
                this.term.writeln('  /turncontext tree [--detail] [turn_number]');
                this.currentInput = '';
                this.cursorPos = 0;
                this.term.write(this.promptStr);
            }
            return;
        }

        if (commandName === '/plugins') {
            const subcommand = parts[1];
            if (subcommand === 'list' || subcommand === 'hooks') {
                const args = parts.slice(1);
                this.socket.emit('terminal-command', { 
                    command: '/plugins', 
                    args: args 
                });
            } else {
                this.term.writeln('\r\nUsage:');
                this.term.writeln('  /plugins list');
                this.term.writeln('  /plugins hooks [filter_name]');
                this.currentInput = '';
                this.cursorPos = 0;
                this.term.write(this.promptStr);
            }
            return;
        }

        // --- PLUGIN COMMANDS (Auto-forward any command starting with /) ---
        if (commandName.startsWith('/')) {
            this.socket.emit('terminal-command', { 
                command: commandName, 
                args: parts.slice(1) 
            });
            return;
        }

        this.term.writeln(`\r\nUnknown command: ${commandName}`);
        this.term.writeln('Type /help for a list of available commands.');
        this.currentInput = '';
        this.cursorPos = 0;
        this.term.write(this.promptStr);
    }

    /**
     * Utility to write a message from the system/backend.
     * @param {string} message 
     */
    systemLog(message) {
        this.term.writeln(`\r\n\x1b[1;34m[SYSTEM]\x1b[0m ${message}`);
        this.term.write(this.promptStr);
    }

    /**
     * Programmatically sets the current command input.
     * @param {string} text 
     */
    setCommandInput(text) {
        this.currentInput = text || '';
        this.cursorPos = this.currentInput.length;
        this.renderLine();
        this.term.focus(); // Ensure terminal has focus after macro click
    }

    /**
     * Loads command history from localStorage.
     */
    loadHistory() {
        const saved = localStorage.getItem('terminal_history');
        if (saved) {
            try {
                const history = JSON.parse(saved);
                return Array.isArray(history) ? history : [];
            } catch (e) {
                console.error("Failed to parse history", e);
                return [];
            }
        }
        return [];
    }

    /**
     * Saves command history to localStorage.
     */
    saveHistory() {
        localStorage.setItem('terminal_history', JSON.stringify(this.history));
    }
}

// Export for use in renderer_memory.js
window.TerminalCommandHandler = TerminalCommandHandler;
