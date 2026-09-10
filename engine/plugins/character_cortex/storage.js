const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const DEFAULT_DIMENSIONS = [
    'authority', 'affection', 'conflict', 'failure', 'fear', 'humor',
    'intimacy', 'morality', 'powerlessness', 'trust', 'violence', 'vulnerability'
];

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const json = value => JSON.stringify(value ?? null);
const parseJson = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
};

async function migrate(db) {
    await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const row = await db.get('PRAGMA user_version');
    const version = Number(row?.user_version || 0);
    if (version > SCHEMA_VERSION) throw new Error(`Character Cortex database version ${version} is newer than this plugin supports.`);
    if (version === 0) {
        await db.exec(`
            CREATE TABLE profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                persona_text TEXT NOT NULL DEFAULT '',
                situation_model TEXT NOT NULL,
                actor_model TEXT NOT NULL,
                analysis_model TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE persona_revisions (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                content_hash TEXT NOT NULL,
                persona_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(profile_id, content_hash)
            );
            CREATE TABLE examples (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                persona_revision_id TEXT REFERENCES persona_revisions(id) ON DELETE SET NULL,
                scenario_source TEXT NOT NULL CHECK(scenario_source IN ('manual', 'generated')),
                scenario_title TEXT NOT NULL DEFAULT '',
                scenario_text TEXT NOT NULL,
                target_dimensions TEXT NOT NULL DEFAULT '[]',
                pressure_points TEXT NOT NULL DEFAULT '[]',
                probe_reason TEXT NOT NULL DEFAULT '',
                situation_prompt TEXT,
                actor_prompt TEXT,
                situation_model TEXT,
                actor_model TEXT,
                analysis_model TEXT,
                actor_response TEXT,
                rating INTEGER CHECK(rating BETWEEN 1 AND 5),
                rationale TEXT,
                better_direction TEXT,
                structured_analysis TEXT,
                status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'rated')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE generation_attempts (
                id TEXT PRIMARY KEY,
                example_id TEXT REFERENCES examples(id) ON DELETE CASCADE,
                profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('situation', 'actor', 'analysis')),
                sequence INTEGER NOT NULL DEFAULT 1,
                model_alias TEXT NOT NULL,
                route_json TEXT,
                prompt_json TEXT NOT NULL,
                response_text TEXT,
                structured_json TEXT,
                error_text TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE principles (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                statement TEXT NOT NULL,
                conditions_text TEXT NOT NULL DEFAULT '',
                instead_guidance TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                support_count INTEGER NOT NULL DEFAULT 0,
                contradiction_count INTEGER NOT NULL DEFAULT 0,
                confidence REAL NOT NULL DEFAULT 0.5,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE principle_revisions (
                id TEXT PRIMARY KEY,
                principle_id TEXT NOT NULL REFERENCES principles(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                statement TEXT NOT NULL,
                conditions_text TEXT NOT NULL DEFAULT '',
                instead_guidance TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                change_reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE principle_evidence (
                principle_id TEXT NOT NULL REFERENCES principles(id) ON DELETE CASCADE,
                example_id TEXT NOT NULL REFERENCES examples(id) ON DELETE CASCADE,
                relation TEXT NOT NULL CHECK(relation IN ('support', 'contradict')),
                created_at TEXT NOT NULL,
                PRIMARY KEY(principle_id, example_id)
            );
            CREATE TABLE proposals (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                example_id TEXT NOT NULL REFERENCES examples(id) ON DELETE CASCADE,
                action TEXT NOT NULL CHECK(action IN ('create', 'update')),
                target_principle_id TEXT REFERENCES principles(id) ON DELETE SET NULL,
                title TEXT NOT NULL,
                statement TEXT NOT NULL,
                conditions_text TEXT NOT NULL DEFAULT '',
                instead_guidance TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                relation TEXT NOT NULL DEFAULT 'support' CHECK(relation IN ('support', 'contradict', 'neutral')),
                rationale TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
                decided_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX idx_examples_profile ON examples(profile_id, created_at DESC);
            CREATE INDEX idx_principles_profile ON principles(profile_id, status, updated_at DESC);
            CREATE INDEX idx_proposals_profile ON proposals(profile_id, status, created_at DESC);
            PRAGMA user_version = 1;
        `);
    }
}

async function withDb(tools, work) {
    const storage = tools.project.getPluginStorage();
    await fs.mkdir(storage.absolutePath, { recursive: true });
    const databasePath = path.join(storage.absolutePath, 'character_cortex.db');
    const db = await tools.db.open(databasePath);
    try {
        await migrate(db);
        return await work(db, { ...storage, databasePath });
    } finally {
        await db.close();
    }
}

function hydrateProfile(row) {
    if (!row) return null;
    return { ...row, archived: Boolean(row.archived) };
}

function hydrateExample(row) {
    if (!row) return null;
    return {
        ...row,
        target_dimensions: parseJson(row.target_dimensions, []),
        pressure_points: parseJson(row.pressure_points, []),
        structured_analysis: parseJson(row.structured_analysis, null)
    };
}

function hydratePrinciple(row) {
    if (!row) return null;
    return { ...row, tags: parseJson(row.tags_json, []) };
}

function hydrateProposal(row) {
    if (!row) return null;
    return { ...row, tags: parseJson(row.tags_json, []) };
}

async function listProfiles(db, { includeArchived = true } = {}) {
    const rows = await db.query(
        `SELECT p.*,
            (SELECT COUNT(*) FROM examples e WHERE e.profile_id = p.id AND e.status = 'rated') AS rated_count,
            (SELECT COUNT(*) FROM principles pr WHERE pr.profile_id = p.id AND pr.status = 'active') AS principle_count
         FROM profiles p
         ${includeArchived ? '' : 'WHERE p.archived = 0'}
         ORDER BY p.archived ASC, lower(p.name) ASC`,
        []
    );
    return rows.map(hydrateProfile);
}

async function getProfile(db, profileId) {
    return hydrateProfile(await db.get('SELECT * FROM profiles WHERE id = ?', [profileId]));
}

async function createProfile(db, input, defaults) {
    const timestamp = now();
    const profile = {
        id: id(),
        name: String(input.name || '').trim(),
        description: String(input.description || '').trim(),
        persona_text: String(input.persona_text || ''),
        situation_model: input.situation_model || defaults.situation,
        actor_model: input.actor_model || defaults.actor,
        analysis_model: input.analysis_model || defaults.analysis,
        archived: 0,
        created_at: timestamp,
        updated_at: timestamp
    };
    if (!profile.name) throw new Error('Character name is required.');
    await db.execute(
        `INSERT INTO profiles (id,name,description,persona_text,situation_model,actor_model,analysis_model,archived,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [profile.id, profile.name, profile.description, profile.persona_text, profile.situation_model, profile.actor_model, profile.analysis_model, 0, timestamp, timestamp]
    );
    return hydrateProfile(profile);
}

async function updateProfile(db, profileId, patch) {
    const current = await getProfile(db, profileId);
    if (!current) throw new Error('Character profile not found.');
    const next = {
        name: patch.name === undefined ? current.name : String(patch.name).trim(),
        description: patch.description === undefined ? current.description : String(patch.description),
        situation_model: patch.situation_model || current.situation_model,
        actor_model: patch.actor_model || current.actor_model,
        analysis_model: patch.analysis_model || current.analysis_model,
        archived: patch.archived === undefined ? Number(current.archived) : Number(Boolean(patch.archived)),
        updated_at: now()
    };
    if (!next.name) throw new Error('Character name is required.');
    await db.execute(
        `UPDATE profiles SET name=?,description=?,situation_model=?,actor_model=?,analysis_model=?,archived=?,updated_at=? WHERE id=?`,
        [next.name, next.description, next.situation_model, next.actor_model, next.analysis_model, next.archived, next.updated_at, profileId]
    );
    return getProfile(db, profileId);
}

async function savePersona(db, profileId, personaText) {
    const profile = await getProfile(db, profileId);
    if (!profile) throw new Error('Character profile not found.');
    const updatedAt = now();
    await db.execute('UPDATE profiles SET persona_text=?, updated_at=? WHERE id=?', [String(personaText || ''), updatedAt, profileId]);
    return { profile_id: profileId, updated_at: updatedAt };
}

async function ensurePersonaRevision(db, profile) {
    const contentHash = crypto.createHash('sha256').update(profile.persona_text || '').digest('hex');
    let revision = await db.get('SELECT * FROM persona_revisions WHERE profile_id=? AND content_hash=?', [profile.id, contentHash]);
    if (!revision) {
        revision = { id: id(), profile_id: profile.id, content_hash: contentHash, persona_text: profile.persona_text || '', created_at: now() };
        await db.execute(
            'INSERT INTO persona_revisions (id,profile_id,content_hash,persona_text,created_at) VALUES (?,?,?,?,?)',
            [revision.id, revision.profile_id, revision.content_hash, revision.persona_text, revision.created_at]
        );
    }
    return revision;
}

async function saveExample(db, profileId, input) {
    let existing = input.id ? await db.get('SELECT * FROM examples WHERE id=? AND profile_id=?', [input.id, profileId]) : null;
    // Rated evidence is immutable. Editing or regenerating from a rated example
    // creates a fresh draft while preserving the original judgment.
    if (existing?.status === 'rated') existing = null;
    const timestamp = now();
    if (existing) {
        await db.execute(
            `UPDATE examples SET scenario_source=?,scenario_title=?,scenario_text=?,target_dimensions=?,pressure_points=?,probe_reason=?,updated_at=? WHERE id=?`,
            [input.scenario_source || existing.scenario_source, String(input.scenario_title || ''), String(input.scenario_text || ''), json(input.target_dimensions || []), json(input.pressure_points || []), String(input.probe_reason || ''), timestamp, existing.id]
        );
        return hydrateExample(await db.get('SELECT * FROM examples WHERE id=?', [existing.id]));
    }
    const exampleId = id();
    await db.execute(
        `INSERT INTO examples (id,profile_id,scenario_source,scenario_title,scenario_text,target_dimensions,pressure_points,probe_reason,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [exampleId, profileId, input.scenario_source || 'manual', String(input.scenario_title || ''), String(input.scenario_text || ''), json(input.target_dimensions || []), json(input.pressure_points || []), String(input.probe_reason || ''), 'draft', timestamp, timestamp]
    );
    return hydrateExample(await db.get('SELECT * FROM examples WHERE id=?', [exampleId]));
}

async function addAttempt(db, input) {
    const sequenceRow = await db.get(
        'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM generation_attempts WHERE profile_id=? AND kind=? AND ((example_id IS NULL AND ? IS NULL) OR example_id=?)',
        [input.profile_id, input.kind, input.example_id || null, input.example_id || null]
    );
    const attempt = { id: id(), sequence: Number(sequenceRow?.sequence || 1), created_at: now(), ...input };
    await db.execute(
        `INSERT INTO generation_attempts (id,example_id,profile_id,kind,sequence,model_alias,route_json,prompt_json,response_text,structured_json,error_text,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [attempt.id, attempt.example_id || null, attempt.profile_id, attempt.kind, attempt.sequence, attempt.model_alias, json(attempt.route || null), json(attempt.prompt || []), attempt.response_text || null, json(attempt.structured || null), attempt.error_text || null, attempt.created_at]
    );
    return attempt;
}

async function getCoverage(db, profileId) {
    const examples = (await db.query("SELECT target_dimensions, structured_analysis, rating FROM examples WHERE profile_id=? AND status='rated'", [profileId])).map(hydrateExample);
    const principles = (await db.query("SELECT tags_json FROM principles WHERE profile_id=? AND status='active'", [profileId])).map(hydratePrinciple);
    const map = new Map(DEFAULT_DIMENSIONS.map(name => [name, { dimension: name, examples: 0, rating_total: 0, principles: 0 }]));
    const touch = name => {
        const key = String(name || '').trim().toLowerCase();
        if (!key) return null;
        if (!map.has(key)) map.set(key, { dimension: key, examples: 0, rating_total: 0, principles: 0 });
        return map.get(key);
    };
    for (const example of examples) {
        const dimensions = new Set([...(example.target_dimensions || []), ...(example.structured_analysis?.dimensions || [])]);
        for (const name of dimensions) {
            const item = touch(name);
            if (item) { item.examples += 1; item.rating_total += Number(example.rating || 0); }
        }
    }
    for (const principle of principles) {
        for (const name of principle.tags || []) {
            const item = touch(name);
            if (item) item.principles += 1;
        }
    }
    return Array.from(map.values()).map(item => ({
        dimension: item.dimension,
        examples: item.examples,
        average_rating: item.examples ? Number((item.rating_total / item.examples).toFixed(2)) : null,
        principles: item.principles
    })).sort((a, b) => a.examples - b.examples || a.dimension.localeCompare(b.dimension));
}

async function getProfileDetail(db, profileId) {
    const profile = await getProfile(db, profileId);
    if (!profile) throw new Error('Character profile not found.');
    const examples = (await db.query('SELECT * FROM examples WHERE profile_id=? ORDER BY updated_at DESC', [profileId])).map(hydrateExample);
    const principles = (await db.query('SELECT * FROM principles WHERE profile_id=? ORDER BY status ASC, updated_at DESC', [profileId])).map(hydratePrinciple);
    const proposals = (await db.query('SELECT * FROM proposals WHERE profile_id=? ORDER BY created_at DESC LIMIT 100', [profileId])).map(hydrateProposal);
    const attempts = await db.query('SELECT * FROM generation_attempts WHERE profile_id=? ORDER BY created_at DESC LIMIT 150', [profileId]);
    const principleIds = principles.map(item => item.id);
    const principle_revisions = principleIds.length
        ? await db.query(`SELECT * FROM principle_revisions WHERE principle_id IN (${principleIds.map(() => '?').join(',')}) ORDER BY created_at DESC`, principleIds)
        : [];
    const principle_evidence = principleIds.length
        ? await db.query(`SELECT pe.*, e.scenario_title, e.scenario_text, e.rating, e.rationale
            FROM principle_evidence pe JOIN examples e ON e.id = pe.example_id
            WHERE pe.principle_id IN (${principleIds.map(() => '?').join(',')}) ORDER BY pe.created_at DESC`, principleIds)
        : [];
    const coverage = await getCoverage(db, profileId);
    return { profile, examples, principles, proposals, attempts, principle_revisions, principle_evidence, coverage };
}

async function recordFeedback(db, exampleId, input) {
    const timestamp = now();
    await db.execute(
        `UPDATE examples SET rating=?,rationale=?,better_direction=?,analysis_model=?,structured_analysis=?,status='rated',updated_at=? WHERE id=?`,
        [input.rating, input.rationale, input.better_direction || '', input.analysis_model, json(input.structured_analysis), timestamp, exampleId]
    );
    for (const proposal of input.proposals || []) {
        await db.execute(
            `INSERT INTO proposals (id,profile_id,example_id,action,target_principle_id,title,statement,conditions_text,instead_guidance,tags_json,relation,rationale,status,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id(), input.profile_id, exampleId, proposal.action === 'update' ? 'update' : 'create', proposal.target_principle_id || null, String(proposal.title || 'Behavioral principle'), String(proposal.statement || ''), String(proposal.conditions || ''), String(proposal.instead_guidance || ''), json(proposal.tags || []), ['support','contradict','neutral'].includes(proposal.relation) ? proposal.relation : 'support', String(proposal.rationale || ''), 'pending', timestamp]
        );
    }
    return hydrateExample(await db.get('SELECT * FROM examples WHERE id=?', [exampleId]));
}

async function snapshotPrinciple(db, principle, reason) {
    await db.execute(
        `INSERT INTO principle_revisions (id,principle_id,title,statement,conditions_text,instead_guidance,tags_json,change_reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id(), principle.id, principle.title, principle.statement, principle.conditions_text, principle.instead_guidance, principle.tags_json, reason || '', now()]
    );
}

async function recalculatePrinciple(db, principleId) {
    const counts = await db.get(
        `SELECT SUM(CASE WHEN relation='support' THEN 1 ELSE 0 END) AS supports,
                SUM(CASE WHEN relation='contradict' THEN 1 ELSE 0 END) AS contradictions
         FROM principle_evidence WHERE principle_id=?`,
        [principleId]
    );
    const supports = Number(counts?.supports || 0);
    const contradictions = Number(counts?.contradictions || 0);
    const confidence = (supports + 1) / (supports + contradictions + 2);
    await db.execute(
        'UPDATE principles SET support_count=?,contradiction_count=?,confidence=?,updated_at=? WHERE id=?',
        [supports, contradictions, confidence, now(), principleId]
    );
}

async function decideProposal(db, proposalId, decision, edits = {}) {
    const proposal = await db.get('SELECT * FROM proposals WHERE id=?', [proposalId]);
    if (!proposal) throw new Error('Principle proposal not found.');
    if (proposal.status !== 'pending') throw new Error('This proposal has already been decided.');
    if (decision === 'reject') {
        await db.execute("UPDATE proposals SET status='rejected',decided_at=? WHERE id=?", [now(), proposalId]);
        return { proposal_id: proposalId, status: 'rejected' };
    }
    if (decision !== 'approve') throw new Error('Decision must be approve or reject.');

    await db.exec('BEGIN IMMEDIATE');
    try {
        const values = {
            title: String(edits.title ?? proposal.title).trim(),
            statement: String(edits.statement ?? proposal.statement).trim(),
            conditions: String(edits.conditions ?? proposal.conditions_text),
            instead: String(edits.instead_guidance ?? proposal.instead_guidance),
            tags: Array.isArray(edits.tags) ? edits.tags : parseJson(proposal.tags_json, []),
            relation: ['support','contradict','neutral'].includes(edits.relation) ? edits.relation : proposal.relation
        };
        if (!values.statement) throw new Error('A principle statement is required.');
        let principleId = proposal.target_principle_id;
        if (proposal.action === 'update' && principleId) {
            const current = await db.get('SELECT * FROM principles WHERE id=? AND profile_id=?', [principleId, proposal.profile_id]);
            if (!current) throw new Error('The target principle no longer exists.');
            await snapshotPrinciple(db, current, `Approved proposal ${proposalId}`);
            await db.execute(
                `UPDATE principles SET title=?,statement=?,conditions_text=?,instead_guidance=?,tags_json=?,updated_at=? WHERE id=?`,
                [values.title, values.statement, values.conditions, values.instead, json(values.tags), now(), principleId]
            );
        } else {
            principleId = id();
            const timestamp = now();
            await db.execute(
                `INSERT INTO principles (id,profile_id,title,statement,conditions_text,instead_guidance,tags_json,created_at,updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [principleId, proposal.profile_id, values.title || 'Behavioral principle', values.statement, values.conditions, values.instead, json(values.tags), timestamp, timestamp]
            );
        }
        if (values.relation !== 'neutral') {
            await db.execute(
                `INSERT INTO principle_evidence (principle_id,example_id,relation,created_at) VALUES (?,?,?,?)
                 ON CONFLICT(principle_id,example_id) DO UPDATE SET relation=excluded.relation,created_at=excluded.created_at`,
                [principleId, proposal.example_id, values.relation, now()]
            );
        }
        await recalculatePrinciple(db, principleId);
        await db.execute("UPDATE proposals SET status='approved',target_principle_id=?,decided_at=? WHERE id=?", [principleId, now(), proposalId]);
        await db.exec('COMMIT');
        return { proposal_id: proposalId, status: 'approved', principle_id: principleId };
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

async function updatePrinciple(db, principleId, patch) {
    const current = await db.get('SELECT * FROM principles WHERE id=?', [principleId]);
    if (!current) throw new Error('Principle not found.');
    await db.exec('BEGIN IMMEDIATE');
    try {
        await snapshotPrinciple(db, current, patch.change_reason || 'Manual edit');
        await db.execute(
            `UPDATE principles SET title=?,statement=?,conditions_text=?,instead_guidance=?,tags_json=?,status=?,updated_at=? WHERE id=?`,
            [String(patch.title ?? current.title).trim(), String(patch.statement ?? current.statement).trim(), String(patch.conditions ?? current.conditions_text), String(patch.instead_guidance ?? current.instead_guidance), json(Array.isArray(patch.tags) ? patch.tags : parseJson(current.tags_json, [])), patch.status === 'retired' ? 'retired' : 'active', now(), principleId]
        );
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
    return hydratePrinciple(await db.get('SELECT * FROM principles WHERE id=?', [principleId]));
}

async function duplicateProfile(db, profileId) {
    const detail = await exportProfile(db, profileId);
    detail.profile.name = `${detail.profile.name} — Copy`;
    return importProfile(db, detail);
}

async function exportProfile(db, profileId) {
    const profile = await getProfile(db, profileId);
    if (!profile) throw new Error('Character profile not found.');
    const tableSpecs = {
        persona_revisions: ['profile_id'], examples: ['profile_id'], generation_attempts: ['profile_id'],
        principles: ['profile_id'], proposals: ['profile_id']
    };
    const payload = { format: 'fablekin-character-cortex', version: 1, exported_at: now(), profile };
    for (const [table] of Object.entries(tableSpecs)) payload[table] = await db.query(`SELECT * FROM ${table} WHERE profile_id=?`, [profileId]);
    const principleIds = payload.principles.map(item => item.id);
    const exampleIds = payload.examples.map(item => item.id);
    payload.principle_revisions = principleIds.length ? await db.query(`SELECT * FROM principle_revisions WHERE principle_id IN (${principleIds.map(() => '?').join(',')})`, principleIds) : [];
    payload.principle_evidence = principleIds.length && exampleIds.length ? await db.query(`SELECT * FROM principle_evidence WHERE principle_id IN (${principleIds.map(() => '?').join(',')})`, principleIds) : [];
    return payload;
}

async function importProfile(db, payload) {
    if (!payload || payload.format !== 'fablekin-character-cortex' || Number(payload.version) !== 1 || !payload.profile) {
        throw new Error('Unsupported Character Cortex import file.');
    }
    const existingNames = new Set((await db.query('SELECT lower(name) AS name FROM profiles', [])).map(row => row.name));
    let name = String(payload.profile.name || 'Imported Character').trim() || 'Imported Character';
    const base = name;
    let suffix = 2;
    while (existingNames.has(name.toLowerCase())) name = `${base} (Imported ${suffix++})`;
    const maps = { profile: new Map(), persona: new Map(), example: new Map(), attempt: new Map(), principle: new Map(), proposal: new Map(), revision: new Map() };
    maps.profile.set(payload.profile.id, id());
    for (const [key, type] of [['persona_revisions','persona'],['examples','example'],['generation_attempts','attempt'],['principles','principle'],['proposals','proposal'],['principle_revisions','revision']]) {
        for (const row of payload[key] || []) maps[type].set(row.id, id());
    }
    await db.exec('BEGIN IMMEDIATE');
    try {
        const p = payload.profile;
        await db.execute(
            `INSERT INTO profiles (id,name,description,persona_text,situation_model,actor_model,analysis_model,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [maps.profile.get(p.id), name, p.description || '', p.persona_text || '', p.situation_model, p.actor_model, p.analysis_model, Number(Boolean(p.archived)), now(), now()]
        );
        for (const row of payload.persona_revisions || []) await db.execute(
            'INSERT INTO persona_revisions (id,profile_id,content_hash,persona_text,created_at) VALUES (?,?,?,?,?)',
            [maps.persona.get(row.id), maps.profile.get(p.id), row.content_hash, row.persona_text, row.created_at || now()]
        );
        for (const row of payload.examples || []) await db.execute(
            `INSERT INTO examples (id,profile_id,persona_revision_id,scenario_source,scenario_title,scenario_text,target_dimensions,pressure_points,probe_reason,situation_prompt,actor_prompt,situation_model,actor_model,analysis_model,actor_response,rating,rationale,better_direction,structured_analysis,status,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [maps.example.get(row.id), maps.profile.get(p.id), maps.persona.get(row.persona_revision_id) || null, row.scenario_source, row.scenario_title, row.scenario_text, row.target_dimensions || '[]', row.pressure_points || '[]', row.probe_reason || '', row.situation_prompt, row.actor_prompt, row.situation_model, row.actor_model, row.analysis_model, row.actor_response, row.rating, row.rationale, row.better_direction, row.structured_analysis, row.status, row.created_at || now(), row.updated_at || now()]
        );
        for (const row of payload.principles || []) await db.execute(
            `INSERT INTO principles (id,profile_id,title,statement,conditions_text,instead_guidance,tags_json,support_count,contradiction_count,confidence,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [maps.principle.get(row.id), maps.profile.get(p.id), row.title, row.statement, row.conditions_text || '', row.instead_guidance || '', row.tags_json || '[]', row.support_count || 0, row.contradiction_count || 0, row.confidence ?? 0.5, row.status || 'active', row.created_at || now(), row.updated_at || now()]
        );
        for (const row of payload.generation_attempts || []) await db.execute(
            `INSERT INTO generation_attempts (id,example_id,profile_id,kind,sequence,model_alias,route_json,prompt_json,response_text,structured_json,error_text,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [maps.attempt.get(row.id), maps.example.get(row.example_id) || null, maps.profile.get(p.id), row.kind, row.sequence || 1, row.model_alias, row.route_json, row.prompt_json || '[]', row.response_text, row.structured_json, row.error_text, row.created_at || now()]
        );
        for (const row of payload.proposals || []) await db.execute(
            `INSERT INTO proposals (id,profile_id,example_id,action,target_principle_id,title,statement,conditions_text,instead_guidance,tags_json,relation,rationale,status,decided_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [maps.proposal.get(row.id), maps.profile.get(p.id), maps.example.get(row.example_id), row.action, maps.principle.get(row.target_principle_id) || null, row.title, row.statement, row.conditions_text || '', row.instead_guidance || '', row.tags_json || '[]', row.relation || 'support', row.rationale || '', row.status || 'pending', row.decided_at, row.created_at || now()]
        );
        for (const row of payload.principle_revisions || []) await db.execute(
            `INSERT INTO principle_revisions (id,principle_id,title,statement,conditions_text,instead_guidance,tags_json,change_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
            [maps.revision.get(row.id), maps.principle.get(row.principle_id), row.title, row.statement, row.conditions_text || '', row.instead_guidance || '', row.tags_json || '[]', row.change_reason || '', row.created_at || now()]
        );
        for (const row of payload.principle_evidence || []) {
            const principleId = maps.principle.get(row.principle_id);
            const exampleId = maps.example.get(row.example_id);
            if (principleId && exampleId) await db.execute('INSERT INTO principle_evidence (principle_id,example_id,relation,created_at) VALUES (?,?,?,?)', [principleId, exampleId, row.relation, row.created_at || now()]);
        }
        await db.exec('COMMIT');
        return getProfile(db, maps.profile.get(p.id));
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

module.exports = {
    DEFAULT_DIMENSIONS, migrate, withDb, listProfiles, getProfile, getProfileDetail,
    createProfile, updateProfile, savePersona, ensurePersonaRevision, saveExample,
    addAttempt, getCoverage, recordFeedback, decideProposal, updatePrinciple,
    duplicateProfile, exportProfile, importProfile, hydrateExample, hydratePrinciple
};
