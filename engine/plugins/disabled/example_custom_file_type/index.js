// Selected project files are untrusted: filter by mode and handle every read/parse failure.
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

module.exports = {
    id: 'example_custom_file_type',
    name: 'Example: Custom File Type',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates a structured Content Manager file type and safe use of selected project files.',

    exports: {
        provideFileView: async (_turnContext, tools, { modeId, filePath } = {}) => {
            if (modeId !== 'example_item') {
                return { type: 'text', content: 'This viewer only supports Example Item files.' };
            }
            if (!filePath) {
                return { type: 'text', content: 'No Example Item file was selected.' };
            }

            try {
                const item = JSON.parse(await tools.project.readFile(filePath));
                const quantity = Number(item.quantity);
                const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
                return {
                    type: 'html',
                    content: `<article style="padding:1rem;line-height:1.5">
                        <h2>${escapeHtml(item.title || 'Untitled Item')}</h2>
                        <dl>
                            <dt>Quantity</dt><dd>${escapeHtml(safeQuantity)}</dd>
                            <dt>Category</dt><dd>${escapeHtml(item.category || 'Misc')}</dd>
                            <dt>Rare</dt><dd>${item.is_rare === true ? 'Yes' : 'No'}</dd>
                        </dl>
                    </article>`
                };
            } catch (error) {
                tools.logger.warn(`Could not render Example Item file: ${error.message}`);
                return { type: 'text', content: 'This Example Item file is missing or malformed.' };
            }
        }
    },

    hooks: {
        HOOK_PROJECT_LOADED: {
            priority: 100,
            run: async (_context, tools) => {
                tools.project.registerFileMode('example_item', {
                    label: 'Example Item',
                    description: 'A small structured JSON file contributed by an example plugin.',
                    backgroundColor: '#4a1a8a',
                    color: '#ffffff',
                    viewer: true,
                    schema: {
                        title: { type: 'text', label: 'Item Title' },
                        quantity: { type: 'number', label: 'Quantity', min: 0, max: 100, default: 1 },
                        category: {
                            type: 'select',
                            label: 'Category',
                            options: ['Weapon', 'Armor', 'Potion', 'Misc'],
                            default: 'Misc'
                        },
                        is_rare: { type: 'checkbox', label: 'Is Rare?', default: false }
                    }
                });
            }
        },
        HOOK_PRE_PROMPT_BUILDER: {
            priority: 100,
            run: async (_context, tools) => {
                const selectedFiles = await tools.project.getSelectedFiles();
                const exampleFiles = selectedFiles.filter(file => file?.mode === 'example_item' && file.path);
                for (const file of exampleFiles) {
                    try {
                        const parsed = JSON.parse(await tools.project.readFile(file.path));
                        if (!parsed.is_rare || !Number.isFinite(Number(parsed.quantity)) || Number(parsed.quantity) <= 0) continue;
                        const note = `The party has ${Number(parsed.quantity)} rare ${String(parsed.title || 'item')} (${String(parsed.category || 'Misc')}).`;
                        tools.prompt.inject('simulation', tools.prompt.wrap('example_item', note), 'root');
                    } catch (error) {
                        tools.logger.warn(`Skipped invalid example item '${file.name || file.path}': ${error.message}`);
                    }
                }
            }
        }
    }
};
