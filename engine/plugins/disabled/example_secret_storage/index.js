// Read secrets only through getSelf() and expose configuration status, never the value.
module.exports = {
    id: 'example_secret_storage',
    name: 'Example: Secret Storage',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates declaring and safely checking an encrypted plugin secret.',

    settingsSchema: {
        api_token: {
            type: 'secret',
            label: 'API Token',
            description: 'Stored through the application secure-storage service.'
        },
        public_name: {
            type: 'text',
            label: 'Public Name',
            default: 'Fablekin User'
        }
    },

    hooks: {
        HOOK_SYSTEM_BOOT: {
            priority: 100,
            run: async (_context, tools) => {
                const settings = tools.settings.getSelf();
                tools.logger.log('Secret storage status:', {
                    api_token_configured: Boolean(settings.api_token),
                    public_name: settings.public_name
                });
            }
        }
    }
};
