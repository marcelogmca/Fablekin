// Settings are plugin-scoped; keep keys stable and use atomic update() for related changes.
const DEFAULTS = Object.freeze({
    user_name: 'Test User',
    power_level: 9000,
    theme_selection: 'obsidian',
    enable_notifications: true
});

module.exports = {
    id: 'example_plugin_settings',
    name: 'Example: Plugin Settings',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates settings schemas, defaults, reads, individual writes, and atomic updates.',

    settingsSchema: {
        user_name: {
            type: 'text',
            label: 'User Name',
            description: 'A basic text setting.',
            default: 'Test User'
        },
        power_level: {
            type: 'number',
            label: 'Power Level',
            description: 'A bounded numeric setting.',
            default: 9000,
            min: 0,
            max: 9001
        },
        theme_selection: {
            type: 'select',
            label: 'Interface Theme',
            description: 'A select setting with separate labels and stored values.',
            options: [
                { label: 'Cyberpunk', value: 'cyber' },
                { label: 'Obsidian', value: 'obsidian' },
                { label: 'Classic', value: 'classic' }
            ],
            default: 'obsidian'
        },
        enable_notifications: {
            type: 'checkbox',
            label: 'Enable Notifications',
            description: 'A boolean setting.',
            default: true
        }
    },

    hooks: {
        HOOK_SYSTEM_BOOT: {
            priority: 100,
            run: async (_context, tools) => {
                tools.logger.log('Current settings:', tools.settings.getSelf());
            }
        }
    },

    socketListeners: {
        'example_plugin_settings:write': async (data, tools) => {
            try {
                if (data?.action === 'set_name') {
                    await tools.settings.set('user_name', String(data.value || '').trim() || DEFAULTS.user_name);
                } else if (data?.action === 'reset') {
                    await tools.settings.update({ ...DEFAULTS });
                } else {
                    throw new Error('Expected action "set_name" or "reset".');
                }
                tools.socket.emit('example_plugin_settings:write-response', {
                    success: true,
                    settings: tools.settings.getSelf()
                });
            } catch (error) {
                tools.socket.emit('example_plugin_settings:write-response', {
                    success: false,
                    error: error.message
                });
            }
        }
    }
};
