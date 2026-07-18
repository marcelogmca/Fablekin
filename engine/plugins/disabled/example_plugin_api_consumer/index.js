// Optional interoperability needs useful fallbacks for both absence and execution failure.
module.exports = {
    id: 'example_plugin_api_consumer',
    name: 'Example: Plugin Interoperability',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates optional dependencies and safe calls into another plugin.',
    optionalDependencies: [
        { id: 'example_plugin_api', reason: 'Provides the greeting function used by this example.' }
    ],

    terminalCommands: {
        '/example-greet': {
            description: 'Calls an optional plugin export. Usage: /example-greet <name>',
            run: async (args, tools) => {
                const name = Array.isArray(args) ? args.join(' ').trim() : '';
                if (!name) return 'Usage: /example-greet <name>';
                const result = await tools.plugins.tryCall(
                    'example_plugin_api',
                    'formatGreeting',
                    [name, { excited: true }],
                    {
                        fallback: ({ reason }) => ({
                            text: reason === 'missing_plugin'
                                ? 'Greeting provider is not enabled.'
                                : 'Greeting provider could not complete the request.'
                        })
                    }
                );
                return result.text;
            }
        }
    }
};
