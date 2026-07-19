/**
 * Lore Book — UI Library  v2.0
 * Generates the full Lore Book editor as self-contained HTML/CSS/JS.
 * Communicates exclusively via the global `socket` (Socket.io) instance.
 */
const fs = require('fs');
const path = require('path');

/**
 * Renders the Lore Book editor by reading template, style, and logic files.
 * @param {string} filePath - Absolute path to the lore book JSON file.
 * @returns {string} The complete HTML/CSS/JS string to be injected into the view.
 */
function renderLoreEditor(filePath) {
    // Escape the path for safe embedding inside a JS template literal in the client-side logic
    const safePath = filePath.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

    try {
        const styles = fs.readFileSync(path.join(__dirname, 'ui_styles.css'), 'utf8');
        const template = fs.readFileSync(path.join(__dirname, 'ui_template.html'), 'utf8');
        const logic = fs.readFileSync(path.join(__dirname, 'ui_logic.js'), 'utf8')
            .replace('__FILE_PATH__', safePath);

        return `
<style>
${styles}
</style>

${template}

<script>
${logic}
</script>
        `;
    } catch (error) {
        console.error('[LoreBook] Failed to load UI components:', error);
        return `<div style="padding:20px; color:var(--status-danger)">Error loading Lore Book UI: ${error.message}</div>`;
    }
}

module.exports = { renderLoreEditor };
