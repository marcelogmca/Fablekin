/**
 * Shared prompt formatting utilities. Rendering (slot_renderer, Prompt)
 * imports from here — never from PluginManager at prepare() time.
 */

function escapeXmlAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = { escapeXmlAttribute };
