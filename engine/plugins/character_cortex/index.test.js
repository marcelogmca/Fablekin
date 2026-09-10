const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('./logic.js');
const plugin = require('./index.js');

test('registers a standalone utility view without narrative or VN hooks', () => {
    assert.equal(plugin.id, 'character_cortex');
    assert.equal(plugin.category, 'Utility');
    assert.equal(plugin.hooks, undefined);
    assert.deepEqual(plugin.views, [{ id: 'character_cortex_lab', label: 'Character Cortex', entry: 'ui.html' }]);
    for (const file of ['ui.html', 'ui.css', 'ui.js']) assert.ok(fs.existsSync(path.join(__dirname, file)));
});

test('UI exposes manual situations, three model selectors, feedback, and policy review', () => {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    assert.match(html, /id="scenario-text"/);
    assert.match(html, /Write my own/);
    assert.match(html, /id="situation-model"/);
    assert.match(html, /id="actor-model"/);
    assert.match(html, /id="analysis-model"/);
    assert.match(html, /data-rating="5"/);
    assert.match(js, /character-cortex:save-scenario/);
    assert.match(js, /character-cortex:decide-proposal/);
});

test('current workflow saves judgments while keeping curation visibly disabled', () => {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    assert.match(html, />Save judgment</);
    assert.match(html, /id="analysis-model" disabled/);
    assert.match(html, /Disabled for now/);
    assert.match(js, /Judgment saved to the evidence list/);
    assert.match(js, /!state\.features\.curation/);
});

test('UI inherits the active Fablekin theme and avoids a private color palette', () => {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');
    assert.match(html, /href="\/engine\/themes\/active\/global\.css"/);
    assert.match(html, /src="\/engine\/vendor\/js\/socket\.io\.min\.js"/);
    assert.match(html, /src="\/engine\/views\/libs\/plugin_bridge\.js"/);
    assert.match(css, /var\(--text-main\)/);
    assert.match(css, /var\(--color-primary\)/);
    assert.match(css, /var\(--bg-surface-2\)/);
    assert.doesNotMatch(css, /--cc-/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
});

test('native dropdown menus inherit themed surfaces and text colors', () => {
    const css = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');
    assert.match(css, /html\s*\{\s*color-scheme:\s*dark/);
    assert.match(css, /select option,[\s\S]*select optgroup\s*\{[^}]*background-color:\s*var\(--bg-surface-2\)[^}]*color:\s*var\(--text-main\)/);
    assert.match(css, /select option:checked\s*\{[^}]*background-color:\s*var\(--color-primary\)[^}]*color:\s*var\(--text-inverse\)/);
    assert.match(css, /select option:disabled\s*\{[^}]*color:\s*var\(--text-muted\)/);
});

test('profile dialog is opaque, centered, cancellable without validation, and uses generic copy', () => {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.match(css, /dialog\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*margin:\s*auto/s);
    assert.match(css, /dialog\s*\{[^}]*background:\s*var\(--bg-surface-2\)/s);
    assert.match(html, /type="button" id="close-profile-dialog"/);
    assert.match(html, /type="button" id="cancel-profile-dialog"/);
    assert.match(js, /close-profile-dialog.*closeCreateDialog/s);
    assert.doesNotMatch(html, /Arlecchino/i);
});

test('UI quietly retries bootstrap while project selection is still finishing', () => {
    const js = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    assert.match(js, /isProjectUnavailable/);
    assert.match(js, /bootstrapWithRetry/);
    assert.match(js, /bridge\.on\('project-changed', handleProjectChanged\)/);
});

test('socket listeners use consistent success and error envelopes', async () => {
    const original = logic.dispatch;
    const emitted = [];
    const tools = { socket: { emit: (...args) => emitted.push(args) }, logger: { error() {} } };
    try {
        logic.dispatch = async action => ({ action });
        await plugin.socketListeners['character-cortex:bootstrap']({}, tools);
        assert.deepEqual(emitted.shift(), ['character-cortex:bootstrap-response', { success: true, result: { action: 'bootstrap' } }]);
        logic.dispatch = async () => { throw new Error('fixture failure'); };
        await plugin.socketListeners['character-cortex:save-persona']({}, tools);
        assert.deepEqual(emitted.shift(), ['character-cortex:save-persona-response', { success: false, error: 'fixture failure' }]);
    } finally {
        logic.dispatch = original;
    }
});
