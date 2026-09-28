const storage = require('./storage.js');

const PLUGIN_ID = 'character_cortex';
const CURATION_ENABLED = false;
const DEFAULT_MODELS = {
    situation: 'mediumendmodel',
    actor: 'highendmodel',
    analysis: 'mediumendmodel'
};

const SITUATION_SCHEMA = {
    type: 'object',
    required: ['situation', 'target_dimensions', 'pressure_points', 'why_this_probe'],
    properties: {
        title: { type: 'string' },
        situation: { type: 'string' },
        target_dimensions: { type: 'array', items: { type: 'string' }, minItems: 1 },
        pressure_points: { type: 'array', items: { type: 'string' } },
        why_this_probe: { type: 'string' }
    }
};

const SITUATION_OUTPUT_CONTRACT = `OUTPUT CONTRACT
Return exactly one JSON object. Do not wrap it in "content", "result", "scenario", or Markdown fences.
Use these exact top-level keys:
{
  "title": "A short optional display title",
  "situation": "The complete situation presented to the character; do not include their response",
  "target_dimensions": ["one or more behavioral dimensions being tested"],
  "pressure_points": ["specific tensions or competing incentives in the situation"],
  "why_this_probe": "Why this situation reveals a useful character decision boundary"
}
The situation, target_dimensions, pressure_points, and why_this_probe fields are required. Use an empty array for pressure_points only when none apply.`;

const ANALYSIS_SCHEMA = {
    type: 'object',
    required: ['decomposition', 'dimensions', 'tags', 'proposals'],
    properties: {
        decomposition: {
            type: 'object',
            required: ['situation', 'perception', 'decision', 'reaction', 'voice'],
            properties: {
                situation: { type: 'string' }, perception: { type: 'string' },
                decision: { type: 'string' }, reaction: { type: 'string' }, voice: { type: 'string' }
            }
        },
        dimensions: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        proposals: {
            type: 'array',
            items: {
                type: 'object',
                required: ['action', 'title', 'statement', 'relation', 'rationale'],
                properties: {
                    action: { type: 'string', enum: ['create', 'update'] },
                    target_principle_id: { type: ['string', 'null'] },
                    title: { type: 'string' }, statement: { type: 'string' },
                    conditions: { type: 'string' }, instead_guidance: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    relation: { type: 'string', enum: ['support', 'contradict', 'neutral'] },
                    rationale: { type: 'string' }
                }
            }
        }
    }
};

const ANALYSIS_OUTPUT_CONTRACT = `OUTPUT CONTRACT
Return exactly one JSON object. Do not wrap it in "content", "result", "analysis", or Markdown fences.
Use these exact top-level keys and nesting:
{
  "decomposition": {
    "situation": "What objectively happened",
    "perception": "What the character would notice or care about",
    "decision": "The objective or choice implied by the human feedback",
    "reaction": "How that choice manifests externally",
    "voice": "How the character expresses it"
  },
  "dimensions": ["behavioral dimensions"],
  "tags": ["retrieval tags"],
  "proposals": [
    {
      "action": "create",
      "target_principle_id": null,
      "title": "Short principle title",
      "statement": "Reusable behavioral principle",
      "conditions": "When it applies",
      "instead_guidance": "Preferred behavior or avoided attractor",
      "tags": ["retrieval tags"],
      "relation": "support",
      "rationale": "How the human feedback justifies this proposal"
    }
  ]
}
All decomposition fields, dimensions, tags, and proposals are required. Use empty arrays when there are no tags or justified proposals. Each proposal action must be either "create" or "update"; relation must be "support", "contradict", or "neutral".`;

function responseContent(response) {
    const content = response?.content ?? response;
    if (content && typeof content === 'object') return content;
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content); } catch { return content; }
}

function normalizeList(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
        .map(item => String(item || '').trim().toLowerCase())
        .filter(Boolean))).slice(0, 20);
}

function getModels(tools) {
    return tools.llm.getActiveModels().map(item => ({
        label: item.label,
        alias: item.model || item.value?.model,
        provider: item.provider || null,
        resolvedModel: item.resolvedModel || null,
        subprovider: item.subprovider || null,
        disabled: item.disabled === true,
        description: item.description || ''
    })).filter(item => item.alias);
}

function getDefaultModels(models) {
    const enabled = models.filter(item => !item.disabled).map(item => item.alias);
    const pick = preferred => enabled.includes(preferred) ? preferred : enabled[0];
    return { situation: pick(DEFAULT_MODELS.situation), actor: pick(DEFAULT_MODELS.actor), analysis: pick(DEFAULT_MODELS.analysis) };
}

function requireAlias(tools, alias, role) {
    const item = getModels(tools).find(model => model.alias === alias);
    if (!item || item.disabled) throw new Error(`${role} model alias '${alias || 'unset'}' is not currently available.`);
    return item;
}

function compactPolicy(principles) {
    const active = principles.filter(item => item.status === 'active').slice(0, 80);
    if (!active.length) return 'No approved behavioral principles exist yet.';
    return active.map(item => [
        `[${item.id}] ${item.title}: ${item.statement}`,
        item.conditions_text ? `When: ${item.conditions_text}` : '',
        item.instead_guidance ? `Instead: ${item.instead_guidance}` : '',
        `Evidence: ${item.support_count} support / ${item.contradiction_count} contradiction; confidence ${Number(item.confidence).toFixed(2)}`
    ].filter(Boolean).join('\n')).join('\n\n');
}

function situationMessages(detail, input) {
    const target = String(input.target_dimension || '').trim();
    const weakest = detail.coverage.slice(0, 8).map(item => `${item.dimension}: ${item.examples} examples`).join('\n');
    const recent = detail.examples.slice(0, 10).map(item => `- ${item.scenario_title || item.scenario_text.slice(0, 100)}`).join('\n') || 'None yet.';
    return [
        {
            role: 'system',
            content: `You design diagnostic situations for human-guided character behavior training. Create one concrete, dynamic situation that tests a meaningful decision boundary. Do not write the character's response. Avoid generic repetition, trivia tests, and lore recitation.\n\n${SITUATION_OUTPUT_CONTRACT}`
        },
        {
            role: 'user',
            content: `CHARACTER PERSONA\n${detail.profile.persona_text}\n\nAPPROVED BEHAVIORAL POLICY\n${compactPolicy(detail.principles)}\n\nCOVERAGE GAPS\n${weakest}\n\nRECENT SITUATIONS TO AVOID REPEATING\n${recent}\n\nREQUESTED TARGET\n${target || 'Choose an underexplored or uncertain behavioral dimension.'}\n\nOPTIONAL USER SEED\n${String(input.seed || '').trim() || 'None.'}`
        }
    ];
}

function actorMessages(profile, scenarioText) {
    return [
        {
            role: 'system',
            content: `${profile.persona_text}\n\nYou are portraying ${profile.name}. Respond naturally and fully in character. Produce a compact reaction vignette containing only observable narration, action, and dialogue. Do not explain your reasoning, label behavioral stages, discuss the prompt, or judge whether the portrayal is accurate.`
        },
        {
            role: 'user',
            content: `SITUATION\n${scenarioText}\n\nWrite ${profile.name}'s reaction vignette.`
        }
    ];
}

function analysisMessages(detail, example, input) {
    const ratingLabels = { 1: 'Fundamentally Wrong', 2: 'Noticeably OOC', 3: 'Plausible but Generic', 4: 'In Character', 5: 'Excellent' };
    return [
        {
            role: 'system',
            content: `You are a character-policy distiller. Treat the human's judgment as authoritative. Analyze behavioral identity, not prose quality or plot preference. Preserve nuance and exceptions. Propose small, reusable principles grounded in this example. Update an existing principle only when its ID is supplied below and the new evidence genuinely refines it. A poor candidate can support an anti-pattern principle.\n\n${ANALYSIS_OUTPUT_CONTRACT}`
        },
        {
            role: 'user',
            content: `CHARACTER PERSONA\n${detail.profile.persona_text}\n\nCURRENT APPROVED POLICY\n${compactPolicy(detail.principles)}\n\nSITUATION\n${example.scenario_text}\n\nCANDIDATE REACTION\n${example.actor_response}\n\nHUMAN RATING\n${input.rating}/5 — ${ratingLabels[input.rating]}\n\nHUMAN RATIONALE\n${input.rationale}\n\nBETTER DIRECTION OR REPLACEMENT\n${input.better_direction || 'Not provided.'}\n\nExtract the situation, what this character would notice, their likely objective/decision, outward reaction, and voice. Then propose only principles justified by the human feedback.`
        }
    ];
}

async function bootstrap(_input, tools) {
    const models = getModels(tools);
    return storage.withDb(tools, async db => {
        const profiles = await storage.listProfiles(db);
        return {
            models,
            profiles,
            default_models: getDefaultModels(models),
            dimensions: storage.DEFAULT_DIMENSIONS,
            features: { curation: CURATION_ENABLED }
        };
    });
}

async function createProfile(input, tools) {
    const models = getModels(tools);
    const defaults = getDefaultModels(models);
    if (!defaults.situation) throw new Error('No valid LLM aliases are configured.');
    const requiredAliases = {
        Situation: input.situation_model || defaults.situation,
        Actor: input.actor_model || defaults.actor
    };
    if (CURATION_ENABLED) requiredAliases.Analysis = input.analysis_model || defaults.analysis;
    for (const [role, alias] of Object.entries(requiredAliases)) requireAlias(tools, alias, role);
    return storage.withDb(tools, db => storage.createProfile(db, input, defaults));
}

async function getProfile(input, tools) {
    return storage.withDb(tools, db => storage.getProfileDetail(db, input.profile_id));
}

async function updateProfile(input, tools) {
    for (const [key, role] of [['situation_model','Situation'],['actor_model','Actor'],['analysis_model','Analysis']]) {
        if (input[key]) requireAlias(tools, input[key], role);
    }
    return storage.withDb(tools, db => storage.updateProfile(db, input.profile_id, input));
}

async function savePersona(input, tools) {
    return storage.withDb(tools, db => storage.savePersona(db, input.profile_id, input.persona_text));
}

async function saveScenario(input, tools) {
    if (!String(input.scenario_text || '').trim()) throw new Error('A situation is required.');
    return storage.withDb(tools, db => storage.saveExample(db, input.profile_id, {
        ...input,
        scenario_source: input.scenario_source === 'generated' ? 'generated' : 'manual'
    }));
}

async function generateSituation(input, tools) {
    return storage.withDb(tools, async db => {
        const detail = await storage.getProfileDetail(db, input.profile_id);
        if (!detail.profile.persona_text.trim()) throw new Error('Add and save a character persona before generating situations.');
        const route = requireAlias(tools, detail.profile.situation_model, 'Situation');
        const built = situationMessages(detail, input);
        const messages = built;
        let structured;
        try {
            const response = await tools.llm.withSchema({
                model: detail.profile.situation_model,
                requestId: 'cortex_situation_generation',
                prompt: { messages: [
                    { role: 'system', piece: 'situation_rules', text: built[0].content },
                    { role: 'user', piece: 'situation_request', text: built[1].content }
                ] },
                msg: `Character Cortex: Generate situation for ${detail.profile.name}`,
                params: { retries: 1, timeout: 90000, callingModule: 'Plugin:character_cortex:Situation' }
            }, SITUATION_SCHEMA);
            structured = responseContent(response);
            if (!structured || typeof structured !== 'object') throw new Error('Situation model returned invalid structured output.');
            const example = await storage.saveExample(db, detail.profile.id, {
                scenario_source: 'generated', scenario_title: String(structured.title || '').trim() || 'Generated situation',
                scenario_text: structured.situation,
                target_dimensions: normalizeList(structured.target_dimensions),
                pressure_points: normalizeList(structured.pressure_points),
                probe_reason: structured.why_this_probe
            });
            await db.execute('UPDATE examples SET situation_prompt=?,situation_model=? WHERE id=?', [JSON.stringify(messages), detail.profile.situation_model, example.id]);
            await storage.addAttempt(db, { example_id: example.id, profile_id: detail.profile.id, kind: 'situation', model_alias: detail.profile.situation_model, route, prompt: messages, response_text: JSON.stringify(structured), structured });
            return storage.hydrateExample(await db.get('SELECT * FROM examples WHERE id=?', [example.id]));
        } catch (error) {
            await storage.addAttempt(db, { example_id: null, profile_id: detail.profile.id, kind: 'situation', model_alias: detail.profile.situation_model, route, prompt: messages, error_text: error.message });
            throw error;
        }
    });
}

async function generateActor(input, tools) {
    if (!String(input.scenario_text || '').trim()) throw new Error('Enter or generate a situation first.');
    return storage.withDb(tools, async db => {
        const profile = await storage.getProfile(db, input.profile_id);
        if (!profile) throw new Error('Character profile not found.');
        if (!profile.persona_text.trim()) throw new Error('Add and save a character persona before generating a reaction.');
        const route = requireAlias(tools, profile.actor_model, 'Actor');
        const example = await storage.saveExample(db, profile.id, {
            id: input.example_id,
            scenario_source: input.scenario_source === 'generated' ? 'generated' : 'manual',
            scenario_title: input.scenario_title || '', scenario_text: input.scenario_text,
            target_dimensions: normalizeList(input.target_dimensions),
            pressure_points: normalizeList(input.pressure_points), probe_reason: input.probe_reason || ''
        });
        const revision = await storage.ensurePersonaRevision(db, profile);
        const built = actorMessages(profile, example.scenario_text);
        const messages = built;
        try {
            const response = await tools.llm.runTask({
                model: profile.actor_model,
                requestId: 'cortex_actor_portrayal',
                prompt: { messages: [
                    { role: 'system', piece: 'actor_persona', text: built[0].content },
                    { role: 'user', piece: 'actor_situation', text: built[1].content }
                ] },
                msg: `Character Cortex: Portray ${profile.name}`,
                params: { retries: 1, timeout: 120000, callingModule: 'Plugin:character_cortex:Actor' }
            });
            const text = String(response?.content || '').trim();
            if (!text) throw new Error('Actor model returned an empty response.');
            await db.execute(
                `UPDATE examples SET persona_revision_id=?,actor_prompt=?,actor_model=?,analysis_model=?,actor_response=?,rating=NULL,rationale=NULL,better_direction=NULL,structured_analysis=NULL,status='draft',updated_at=? WHERE id=?`,
                [revision.id, JSON.stringify(messages), profile.actor_model, profile.analysis_model, text, new Date().toISOString(), example.id]
            );
            await storage.addAttempt(db, { example_id: example.id, profile_id: profile.id, kind: 'actor', model_alias: profile.actor_model, route, prompt: messages, response_text: text });
            return storage.hydrateExample(await db.get('SELECT * FROM examples WHERE id=?', [example.id]));
        } catch (error) {
            await storage.addAttempt(db, { example_id: example.id, profile_id: profile.id, kind: 'actor', model_alias: profile.actor_model, route, prompt: messages, error_text: error.message });
            throw error;
        }
    });
}

async function submitFeedback(input, tools) {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
    if (!String(input.rationale || '').trim()) throw new Error('Explain why the response earned this rating.');
    return storage.withDb(tools, async db => {
        const example = storage.hydrateExample(await db.get('SELECT * FROM examples WHERE id=? AND profile_id=?', [input.example_id, input.profile_id]));
        if (!example?.actor_response) throw new Error('Generate an actor response before submitting feedback.');
        const detail = await storage.getProfileDetail(db, input.profile_id);
        if (!CURATION_ENABLED) {
            await storage.recordFeedback(db, example.id, {
                profile_id: detail.profile.id,
                rating,
                rationale: String(input.rationale).trim(),
                better_direction: String(input.better_direction || '').trim(),
                analysis_model: null,
                structured_analysis: null,
                proposals: []
            });
            return storage.getProfileDetail(db, detail.profile.id);
        }
        const personaRevision = example.persona_revision_id
            ? await db.get('SELECT persona_text FROM persona_revisions WHERE id=?', [example.persona_revision_id])
            : null;
        const analysisDetail = personaRevision
            ? { ...detail, profile: { ...detail.profile, persona_text: personaRevision.persona_text } }
            : detail;
        const route = requireAlias(tools, detail.profile.analysis_model, 'Analysis');
        const built = analysisMessages(analysisDetail, example, { ...input, rating });
        const messages = built;
        try {
            const response = await tools.llm.withSchema({
                model: detail.profile.analysis_model,
                requestId: 'cortex_feedback_distillation',
                prompt: { messages: [
                    { role: 'system', piece: 'analysis_rules', text: built[0].content },
                    { role: 'user', piece: 'analysis_case', text: built[1].content }
                ] },
                msg: `Character Cortex: Distill feedback for ${detail.profile.name}`,
                params: { retries: 1, timeout: 120000, callingModule: 'Plugin:character_cortex:Analysis' }
            }, ANALYSIS_SCHEMA);
            const result = responseContent(response);
            if (!result || typeof result !== 'object') throw new Error('Analysis model returned invalid structured output.');
            result.dimensions = normalizeList(result.dimensions);
            result.tags = normalizeList(result.tags);
            result.proposals = (result.proposals || []).slice(0, 8).map(item => ({
                ...item, tags: normalizeList(item.tags),
                target_principle_id: item.action === 'update' ? item.target_principle_id || null : null
            }));
            await storage.recordFeedback(db, example.id, {
                profile_id: detail.profile.id, rating, rationale: String(input.rationale).trim(),
                better_direction: String(input.better_direction || '').trim(),
                analysis_model: detail.profile.analysis_model,
                structured_analysis: { decomposition: result.decomposition, dimensions: result.dimensions, tags: result.tags },
                proposals: result.proposals
            });
            await storage.addAttempt(db, { example_id: example.id, profile_id: detail.profile.id, kind: 'analysis', model_alias: detail.profile.analysis_model, route, prompt: messages, response_text: JSON.stringify(result), structured: result });
            return storage.getProfileDetail(db, detail.profile.id);
        } catch (error) {
            await storage.addAttempt(db, { example_id: example.id, profile_id: detail.profile.id, kind: 'analysis', model_alias: detail.profile.analysis_model, route, prompt: messages, error_text: error.message });
            throw error;
        }
    });
}

async function decideProposal(input, tools) {
    return storage.withDb(tools, async db => {
        const result = await storage.decideProposal(db, input.proposal_id, input.decision, input.edits || {});
        return { decision: result, detail: await storage.getProfileDetail(db, input.profile_id) };
    });
}

async function editPrinciple(input, tools) {
    return storage.withDb(tools, async db => {
        const principle = await storage.updatePrinciple(db, input.principle_id, input);
        return { principle, detail: await storage.getProfileDetail(db, input.profile_id) };
    });
}

async function archiveProfile(input, tools) {
    return storage.withDb(tools, db => storage.updateProfile(db, input.profile_id, { archived: input.archived !== false }));
}

async function deleteProfile(input, tools) {
    if (input.confirm !== true) throw new Error('Profile deletion requires confirmation.');
    return storage.withDb(tools, async db => {
        const profile = await storage.getProfile(db, input.profile_id);
        if (!profile) throw new Error('Character profile not found.');
        await db.execute('DELETE FROM profiles WHERE id=?', [profile.id]);
        return { deleted: true, profile_id: profile.id };
    });
}

async function duplicateProfile(input, tools) {
    return storage.withDb(tools, db => storage.duplicateProfile(db, input.profile_id));
}

async function exportProfile(input, tools) {
    return storage.withDb(tools, db => storage.exportProfile(db, input.profile_id));
}

async function importProfile(input, tools) {
    return storage.withDb(tools, db => storage.importProfile(db, input.payload));
}

const handlers = {
    bootstrap, 'profile:get': getProfile, 'profile:create': createProfile,
    'profile:update': updateProfile, 'profile:archive': archiveProfile,
    'profile:delete': deleteProfile, 'profile:duplicate': duplicateProfile,
    'persona:save': savePersona, 'scenario:save': saveScenario,
    'scenario:generate': generateSituation, 'actor:generate': generateActor,
    'feedback:submit': submitFeedback, 'proposal:decide': decideProposal,
    'principle:update': editPrinciple, 'profile:export': exportProfile,
    'profile:import': importProfile
};

async function dispatch(action, data, tools) {
    const handler = handlers[action];
    if (!handler) throw new Error(`Unknown Character Cortex action '${action}'.`);
    return handler(data || {}, tools);
}

module.exports = {
    PLUGIN_ID, CURATION_ENABLED, DEFAULT_MODELS, SITUATION_SCHEMA, ANALYSIS_SCHEMA,
    SITUATION_OUTPUT_CONTRACT, ANALYSIS_OUTPUT_CONTRACT,
    getModels, getDefaultModels, requireAlias, situationMessages, actorMessages,
    analysisMessages, dispatch, handlers
};
