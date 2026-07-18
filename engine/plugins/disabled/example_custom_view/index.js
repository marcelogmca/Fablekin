// The plugin owns both sides of this namespaced request/response channel.
const REQUEST_EVENT = 'example_custom_view:get-status';
const RESPONSE_EVENT = 'example_custom_view:get-status-response';

module.exports = {
    id: 'example_custom_view',
    name: 'Example: Custom View',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates a custom application view with a plugin-owned socket request and response.',

    views: [
        {
            id: 'example_dashboard',
            label: 'Example View',
            entry: 'ui.html'
        }
    ],

    socketListeners: {
        [REQUEST_EVENT]: async (data, tools) => {
            tools.socket.emit(RESPONSE_EVENT, {
                success: true,
                message: String(data?.message || 'Hello from the plugin backend.'),
                pluginId: 'example_custom_view'
            });
        }
    }
};
