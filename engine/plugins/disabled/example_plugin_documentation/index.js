// Documentation paths are resolved relative to this plugin directory.
module.exports = {
    id: 'example_plugin_documentation',
    name: 'Example: Plugin Documentation',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates how a plugin contributes a page to the documentation portal.',

    documentation: [
        {
            id: 'example_plugin_documentation_guide',
            title: 'Example Plugin Documentation',
            description: 'Manifest fields, plugin-relative paths, and themed documentation pages.',
            path: 'docs/guide.html',
            category: 'Plugins'
        }
    ]
};
