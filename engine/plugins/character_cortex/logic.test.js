const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const logic = require('./logic.js');
const storage = require('./storage.js');

async function makeTools(t, llmOverrides = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'character-cortex-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const models = ['lowendmodel', 'mediumendmodel', 'highendmodel'].map(alias => ({
        label: alias, model: alias, provider: 'fixture', resolvedModel: `fixture/${alias}`, disabled: false
    }));
    const tools = {
        project: {
            getPluginStorage: () => ({
                absolutePath: path.join(root, 'plugins', 'character_cortex'),
                relativePath: 'plugins/character_cortex', projectName: 'Test', pluginId: 'character_cortex'
            })
        },
        db: {
            open: async filename => {
                const db = await open({ filename, driver: sqlite3.Database });
                return {
                    execute: (sql, params = []) => db.run(sql, params),
                    query: (sql, params = []) => db.all(sql, params),
                    get: (sql, params = []) => db.get(sql, params),
                    exec: sql => db.exec(sql), close: () => db.close()
                };
            }
        },
        llm: {
            getActiveModels: () => models,
            runTask: async () => ({ content: 'She quietly asks what happened, watching for the first inconsistency.' }),
            withSchema: async task => task.msg.includes('Generate situation')
                ? { content: { title: 'The Lost Report', situation: 'A junior admits losing a confidential report.', target_dimensions: ['authority', 'failure'], pressure_points: ['honesty'], why_this_probe: 'Tests discipline versus restraint.' } }
                : { content: { decomposition: { situation: 'A junior failed.', perception: 'She notices the immediate confession.', decision: 'Determine cause before punishment.', reaction: 'Questions them calmly.', voice: 'Controlled and precise.' }, dimensions: ['authority', 'failure'], tags: ['restraint'], proposals: [{ action: 'create', target_principle_id: null, title: 'Investigate before punishment', statement: 'Honest failure prompts diagnosis before consequences.', conditions: 'A subordinate admits a mistake.', instead_guidance: 'Question calmly before deciding consequences.', tags: ['authority', 'failure'], relation: 'support', rationale: 'Directly reflects the human correction.' }] } },
            ...llmOverrides
        },
        logger: { error() {}, log() {} },
        socket: { emit() {} }
    };
    return { tools, root };
}

test('creates the project-local database and preserves persona revisions used by examples', async t => {
    const { tools, root } = await makeTools(t);
    const profile = await logic.handlers['profile:create']({ name: 'Arlecchino' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'Controlled, pragmatic, and observant.' }, tools);
    const example = await logic.handlers['actor:generate']({
        profile_id: profile.id, scenario_source: 'manual', scenario_title: 'Confession',
        scenario_text: 'A subordinate immediately confesses to an avoidable failure.'
    }, tools);
    const detail = await logic.handlers['profile:get']({ profile_id: profile.id }, tools);
    assert.equal(example.scenario_source, 'manual');
    assert.match(example.actor_response, /quietly asks/);
    assert.ok(example.persona_revision_id);
    assert.equal(detail.examples.length, 1);
    const dbPath = path.join(root, 'plugins', 'character_cortex', 'character_cortex.db');
    await fs.access(dbPath);

    await logic.handlers['actor:generate']({ ...example, profile_id: profile.id, example_id: example.id }, tools);
    const exported = await logic.handlers['profile:export']({ profile_id: profile.id }, tools);
    assert.equal(exported.persona_revisions.length, 1, 'same persona content reuses its immutable revision');
    assert.equal(exported.generation_attempts.filter(item => item.kind === 'actor').length, 2);
});

test('generates editable situations and saves full judgments without invoking curation', async t => {
    const calls = [];
    const { tools } = await makeTools(t, {
        runTask: async task => { calls.push(['actor', task]); return { content: 'A measured response.' }; },
        withSchema: async task => {
            calls.push([task.msg.includes('Generate situation') ? 'situation' : 'analysis', task]);
            return task.msg.includes('Generate situation')
                ? { content: { title: 'Probe', situation: 'Someone offers sincere praise.', target_dimensions: ['affection'], pressure_points: [], why_this_probe: 'Tests an uncovered dimension.' } }
                : { content: { decomposition: { situation: 'Praise.', perception: 'Intent.', decision: 'Accept carefully.', reaction: 'Brief thanks.', voice: 'Reserved.' }, dimensions: ['affection'], tags: [], proposals: [] } };
        }
    });
    const profile = await logic.handlers['profile:create']({ name: 'A', situation_model: 'lowendmodel', actor_model: 'highendmodel', analysis_model: 'mediumendmodel' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'Persona starts here.' }, tools);
    const scenario = await logic.handlers['scenario:generate']({ profile_id: profile.id }, tools);
    scenario.scenario_text = 'A manually edited version of the generated probe.';
    const acted = await logic.handlers['actor:generate']({ ...scenario, profile_id: profile.id, example_id: scenario.id }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'A later persona edit.' }, tools);
    const saved = await logic.handlers['feedback:submit']({ profile_id: profile.id, example_id: acted.id, rating: 4, rationale: 'The restraint is appropriate in full.', better_direction: 'Keep the complete alternate direction.' }, tools);
    assert.equal(calls[0][1].model, 'lowendmodel');
    assert.equal(calls[1][1].model, 'highendmodel');
    assert.equal(calls.length, 2, 'feedback storage does not invoke the analysis model while curation is disabled');
    assert.match(calls[1][1].prompt.messages[0].text, /^Persona starts here\./, 'persona begins the actor input');
    assert.match(calls[1][1].prompt.messages[1].text, /manually edited/);
    const evidence = saved.examples.find(item => item.id === acted.id);
    assert.equal(evidence.scenario_text, 'A manually edited version of the generated probe.');
    assert.equal(evidence.actor_response, 'A measured response.');
    assert.equal(evidence.rationale, 'The restraint is appropriate in full.');
    assert.equal(evidence.better_direction, 'Keep the complete alternate direction.');
    assert.equal(saved.proposals.length, 0);
});

test('structured prompts state their exact JSON contracts and situation titles remain optional', async t => {
    const { tools } = await makeTools(t, {
        withSchema: async (task, schema) => {
            assert.match(task.prompt.messages[0].text, /Use these exact top-level keys/);
            assert.match(task.prompt.messages[0].text, /"situation"/);
            assert.match(task.prompt.messages[0].text, /Do not wrap it in "content"/);
            assert.ok(!schema.required.includes('title'));
            return {
                content: {
                    situation: 'A colleague challenges a decision in private.',
                    target_dimensions: ['authority'],
                    pressure_points: ['criticism'],
                    why_this_probe: 'Tests how authority responds to respectful dissent.'
                }
            };
        }
    });
    const profile = await logic.handlers['profile:create']({ name: 'A' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'A concise persona.' }, tools);
    const scenario = await logic.handlers['scenario:generate']({ profile_id: profile.id }, tools);
    assert.equal(scenario.scenario_title, 'Generated situation');
    assert.match(scenario.scenario_text, /challenges a decision/);

    const analysisPrompt = logic.analysisMessages(
        { profile, principles: [] },
        { scenario_text: 'A test.', actor_response: 'A response.' },
        { rating: 4, rationale: 'Appropriate.' }
    )[0].content;
    assert.match(analysisPrompt, /"decomposition"/);
    assert.match(analysisPrompt, /"proposals"/);
    assert.match(analysisPrompt, /Do not wrap it in "content"/);
});

test('human feedback remains immutable while dormant proposal storage remains available', async t => {
    const { tools } = await makeTools(t);
    const profile = await logic.handlers['profile:create']({ name: 'A' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'A careful authority figure.' }, tools);
    const acted = await logic.handlers['actor:generate']({ profile_id: profile.id, scenario_source: 'manual', scenario_text: 'A subordinate fails.' }, tools);
    let detail = await logic.handlers['feedback:submit']({ profile_id: profile.id, example_id: acted.id, rating: 2, rationale: 'Too theatrical.', better_direction: 'Ask why first.' }, tools);
    assert.equal(detail.proposals.length, 0);
    await storage.withDb(tools, db => storage.recordFeedback(db, acted.id, {
        profile_id: profile.id,
        rating: 2,
        rationale: 'Too theatrical.',
        better_direction: 'Ask why first.',
        analysis_model: null,
        structured_analysis: null,
        proposals: [{
            action: 'create', title: 'Investigate first',
            statement: 'Determine the cause before imposing consequences.',
            relation: 'support', rationale: 'Fixture for the dormant curation path.'
        }]
    }));
    detail = await logic.handlers['profile:get']({ profile_id: profile.id }, tools);
    const proposal = detail.proposals.find(item => item.status === 'pending');
    const decided = await logic.handlers['proposal:decide']({ profile_id: profile.id, proposal_id: proposal.id, decision: 'approve', edits: {} }, tools);
    assert.equal(decided.detail.principles.length, 1);
    assert.equal(decided.detail.principles[0].support_count, 1);
    assert.equal(decided.detail.principles[0].confidence, 2 / 3);

    const regenerated = await logic.handlers['actor:generate']({ ...acted, profile_id: profile.id, example_id: acted.id }, tools);
    assert.notEqual(regenerated.id, acted.id, 'regenerating rated evidence creates a new draft');
    detail = await logic.handlers['profile:get']({ profile_id: profile.id }, tools);
    const original = detail.examples.find(item => item.id === acted.id);
    assert.equal(original.rating, 2);
    assert.equal(original.rationale, 'Too theatrical.');
});

test('export/import round trip remaps relationships and duplicates conflicting names safely', async t => {
    const { tools } = await makeTools(t);
    const profile = await logic.handlers['profile:create']({ name: 'Portable' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'Portable persona.' }, tools);
    const acted = await logic.handlers['actor:generate']({ profile_id: profile.id, scenario_source: 'manual', scenario_text: 'A test.' }, tools);
    await logic.handlers['feedback:submit']({ profile_id: profile.id, example_id: acted.id, rating: 5, rationale: 'Exactly right.' }, tools);
    await storage.withDb(tools, db => storage.recordFeedback(db, acted.id, {
        profile_id: profile.id,
        rating: 5,
        rationale: 'Exactly right.',
        analysis_model: null,
        structured_analysis: null,
        proposals: [{
            action: 'create', title: 'Portable principle', statement: 'Portable statement.',
            relation: 'support', rationale: 'Fixture for relationship remapping.'
        }]
    }));
    const detail = await logic.handlers['profile:get']({ profile_id: profile.id }, tools);
    await logic.handlers['proposal:decide']({ profile_id: profile.id, proposal_id: detail.proposals[0].id, decision: 'approve', edits: {} }, tools);
    const payload = await logic.handlers['profile:export']({ profile_id: profile.id }, tools);
    const imported = await logic.handlers['profile:import']({ payload }, tools);
    assert.equal(imported.name, 'Portable (Imported 2)');
    const importedDetail = await logic.handlers['profile:get']({ profile_id: imported.id }, tools);
    assert.equal(importedDetail.examples.length, 1);
    assert.equal(importedDetail.principles.length, 1);
    assert.equal(importedDetail.principle_evidence.length, 1);
    assert.notEqual(importedDetail.examples[0].id, acted.id);
});

test('rejects missing rationale and unavailable aliases without fallback', async t => {
    const { tools } = await makeTools(t);
    const profile = await logic.handlers['profile:create']({ name: 'A' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'Persona.' }, tools);
    const acted = await logic.handlers['actor:generate']({ profile_id: profile.id, scenario_source: 'manual', scenario_text: 'Situation.' }, tools);
    await assert.rejects(() => logic.handlers['feedback:submit']({ profile_id: profile.id, example_id: acted.id, rating: 3, rationale: '' }, tools), /Explain why/);
    tools.llm.getActiveModels = () => [{ label: 'Broken', model: 'highendmodel', disabled: true }];
    await assert.rejects(() => logic.handlers['actor:generate']({ profile_id: profile.id, scenario_source: 'manual', scenario_text: 'Situation.' }, tools), /not currently available/);
});

test('database migration enables foreign keys and cascade deletion', async t => {
    const { tools } = await makeTools(t);
    const profile = await logic.handlers['profile:create']({ name: 'Cascade' }, tools);
    await logic.handlers['persona:save']({ profile_id: profile.id, persona_text: 'Persona.' }, tools);
    await logic.handlers['actor:generate']({ profile_id: profile.id, scenario_source: 'manual', scenario_text: 'Situation.' }, tools);
    await logic.handlers['profile:delete']({ profile_id: profile.id, confirm: true }, tools);
    const payload = await storage.withDb(tools, async db => ({
        foreignKeys: await db.get('PRAGMA foreign_keys'),
        examples: await db.get('SELECT COUNT(*) AS count FROM examples')
    }));
    assert.equal(payload.foreignKeys.foreign_keys, 1);
    assert.equal(payload.examples.count, 0);
});
