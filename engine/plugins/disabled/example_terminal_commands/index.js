// Command handlers validate user input before doing bounded database work.
module.exports = {
    id: 'example_terminal_commands',
    name: 'Example: Terminal Commands',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates namespaced terminal commands, argument validation, and a bounded database query.',

    terminalCommands: {
        '/example-ping': {
            description: 'Echoes supplied arguments. Usage: /example-ping [words...]',
            run: async (args) => {
                const words = Array.isArray(args) ? args.map(String) : [];
                return words.length > 0 ? `Pong: ${words.join(' ')}` : 'Pong!';
            }
        },
        '/example-recent-turns': {
            description: 'Lists up to five recent chapter numbers. Usage: /example-recent-turns [1-5]',
            run: async (args, tools) => {
                const requested = args?.[0] === undefined ? 5 : Number.parseInt(args[0], 10);
                if (!Number.isInteger(requested) || requested < 1 || requested > 5) {
                    return 'Usage: /example-recent-turns [1-5]';
                }
                const rows = await tools.db.chat.query(
                    'SELECT chapter_number FROM chapters ORDER BY chapter_number DESC LIMIT ?',
                    [requested]
                );
                if (!Array.isArray(rows) || rows.length === 0) return 'No chapters found.';
                return `Recent chapters: ${rows.map(row => row.chapter_number).join(', ')}`;
            }
        }
    }
};
