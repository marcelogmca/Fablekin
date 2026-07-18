// Treat exported functions as public boundaries: validate input and keep output stable.
function normalizeName(value) {
    const name = String(value || '').trim();
    if (!name) throw new Error('A non-empty name is required.');
    if (name.length > 80) throw new Error('Name must be 80 characters or fewer.');
    return name;
}

module.exports = {
    id: 'example_plugin_api',
    name: 'Example: Plugin Exports',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates a small validated API exported for other plugins.',

    exports: {
        formatGreeting: async (_context, _tools, name, options = {}) => {
            const normalizedName = normalizeName(name);
            const punctuation = options.excited === true ? '!' : '.';
            return {
                text: `Hello, ${normalizedName}${punctuation}`,
                normalizedName
            };
        }
    }
};
