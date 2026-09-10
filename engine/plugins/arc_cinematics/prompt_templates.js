const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, 'prompts');
const TEMPLATE_CACHE = new Map();

function readPromptTemplate(filename) {
    const safeName = path.basename(String(filename || ''));
    if (!safeName) throw new Error('Prompt template filename is required.');
    if (!TEMPLATE_CACHE.has(safeName)) {
        const absolutePath = path.join(TEMPLATE_DIR, safeName);
        TEMPLATE_CACHE.set(safeName, fs.readFileSync(absolutePath, 'utf8').trim());
    }
    return TEMPLATE_CACHE.get(safeName);
}

function renderPromptTemplate(filename, variables = {}) {
    const template = readPromptTemplate(filename);
    return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
        const value = variables[key];
        if (value === undefined || value === null) return '';
        return String(value);
    }).trim();
}

module.exports = {
    readPromptTemplate,
    renderPromptTemplate
};
