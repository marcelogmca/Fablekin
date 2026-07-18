const crypto = require('crypto');

const CLEANUP_PATTERNS = ['MEMORY_RECALL:%'];
const DOMAIN_CONFIG = {
    personality: {
        predicatePrefix: 'MEMORY_RECALL:PERSONALITY:MEMORY:',
        vectorCollection: 'personality_memories',
        wrapperTag: 'personality_recalls',
        defaultLimit: 3
    },
    relationship: {
        predicatePrefix: 'MEMORY_RECALL:RELATIONSHIP:MEMORY:',
        vectorCollection: 'relationship_memories',
        wrapperTag: 'relationship_recalls',
        defaultLimit: 8
    },
    world: {
        predicatePrefix: 'MEMORY_RECALL:WORLD:MEMORY:',
        vectorCollection: 'world_memories',
        wrapperTag: 'world_recalls',
        defaultLimit: 4
    },
    location: {
        predicatePrefix: 'MEMORY_RECALL:LOCATION:MEMORY:',
        vectorCollection: 'location_memories',
        wrapperTag: 'location_recalls',
        defaultLimit: 4
    },
    general: {
        predicatePrefix: 'MEMORY_RECALL:GENERAL:MEMORY:',
        vectorCollection: 'general_memories',
        wrapperTag: 'general_recalls',
        defaultLimit: 6
    }
};
const PROMPT_DOMAINS = ['personality', 'relationship'];
const WORLD_PROMPT_DOMAINS = ['world', 'location'];

function toLowerSafe(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function normalizeText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function normalizeDurability(value) {
    const raw = toLowerSafe(value);
    if (raw === 'stable' || raw === 'situational' || raw === 'transient') return raw;
    return 'situational';
}

function normalizeCues(cues) {
    if (!Array.isArray(cues)) return [];
    const out = [];
    for (const cue of cues) {
        const normalized = normalizeText(String(cue || ''));
        if (!normalized) continue;
        out.push(normalized.toLowerCase());
    }
    return Array.from(new Set(out)).slice(0, 8);
}

function normalizeDomain(value) {
    const raw = toLowerSafe(value);
    if (raw === 'personality' || raw === 'relationship' || raw === 'world' || raw === 'location' || raw === 'general') return raw;
    return 'general';
}

function inferDomainFromSourcePlugin(sourcePlugin) {
    const normalizedSource = toLowerSafe(sourcePlugin);
    if (normalizedSource === 'personality_tracker') return 'personality';
    if (normalizedSource === 'relationship_tracker') return 'relationship';
    if (normalizedSource === 'world_state_tracker') return 'world';
    if (normalizedSource === 'world_location_tracker') return 'location';
    return 'general';
}

function inferDomain(options = {}) {
    if (options.domain) return normalizeDomain(options.domain);

    return inferDomainFromSourcePlugin(options.sourcePlugin || options.source_plugin);
}

function getDomainConfig(domain) {
    return DOMAIN_CONFIG[normalizeDomain(domain)] || DOMAIN_CONFIG.general;
}

function buildMemoryHash(record) {
    const raw = [
        record.subject,
        record.target || '',
        record.kind,
        normalizeText(record.memory).toLowerCase()
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseContextJson(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function sanitizeMemory(raw, options = {}) {
    if (!raw || typeof raw !== 'object') return null;

    const minLength = clampNumber(options.minMemoryLength, 8, 120, 14);
    const domain = normalizeDomain(options.domain);

    const subject = toLowerSafe(
        raw.subject ||
        raw.entity ||
        raw.location ||
        raw.character ||
        raw.source ||
        raw.name ||
        options.subject ||
        options.entity ||
        options.location ||
        (domain === 'world' ? 'world' : '')
    );
    const target = toLowerSafe(raw.target);
    const kind = normalizeText(raw.kind || 'preference').toLowerCase().slice(0, 64) || 'preference';
    const memory = normalizeText(raw.memory || raw.text || raw.statement);
    const evidence = normalizeText(raw.evidence || raw.context || '');
    const cues = normalizeCues(raw.cues || raw.tags || []);

    if (!subject) return null;
    if (!memory || memory.length < minLength) return null;

    return {
        subject,
        character: subject,
        target,
        kind,
        memory,
        evidence,
        cues,
        salience: clampNumber(raw.salience, 1, 10, 5),
        durability: normalizeDurability(raw.durability)
    };
}

function buildVectorContent(record) {
    const cuesText = record.cues.length > 0 ? record.cues.join(', ') : 'none';
    return [
        `SUBJECT: ${record.subject}`,
        `KIND: ${record.kind}`,
        `MEMORY: ${record.memory}`,
        `CUES: ${cuesText}`,
        `DURABILITY: ${record.durability}`,
        record.target ? `TARGET: ${record.target}` : ''
    ].filter(Boolean).join('\n');
}

async function hasMemoryHash(tools, projectName, subject, hashPrefix, turnNumber, domain) {
    const config = getDomainConfig(domain);
    const predicates = [`${config.predicatePrefix}${hashPrefix}`];
    const placeholders = predicates.map(() => '?').join(', ');
    const rows = await tools.db.chat.query(
        `SELECT 1
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND predicate IN (${placeholders})
           AND turn_number <= ?
         LIMIT 1`,
        [projectName.toLowerCase(), subject, ...predicates, turnNumber]
    );
    return Array.isArray(rows) && rows.length > 0;
}

async function cleanupCurrentTurn(turnContext, tools) {
    tools.logger.runtime('[Cleanup] Purging memory recall facts and vector rows for current turn scope.');

    for (const pattern of CLEANUP_PATTERNS) {
        await tools.facts.cleanUpFactsDb({ predicates: [pattern] });
    }

    if (tools.vector) {
        for (const collection of Object.values(DOMAIN_CONFIG).map(c => c.vectorCollection)) {
            try {
                await tools.vector.delete(collection, { turn_number: { $eq: turnContext.turnNumber } });
            } catch (error) {
                tools.logger.warn('MemoryRecall', `Vector cleanup skipped for ${collection}: ${error.message}`);
            }
        }
    }
}

async function storeMemories(turnContext, tools, memories, options = {}) {
    if (!Array.isArray(memories) || memories.length === 0) {
        return { stored: 0, skipped: 0 };
    }

    const settings = tools.settings.getSelf() || {};
    const minMemoryLength = settings.min_memory_length ?? 14;
    const projectName = turnContext.projectName;
    const turnNumber = turnContext.turnNumber || 0;
    const sourcePlugin = normalizeText(options.sourcePlugin || options.source_plugin || 'unknown').toLowerCase() || 'unknown';
    const domain = inferDomain(options);
    const domainConfig = getDomainConfig(domain);
    const defaultSubject = options.subject || options.entity || options.location || (domain === 'world' ? 'world' : '');

    let stored = 0;
    let skipped = 0;
    const vectorDocs = [];

    for (const raw of memories) {
        const record = sanitizeMemory(raw, { minMemoryLength, domain, subject: defaultSubject });
        if (!record) {
            skipped++;
            continue;
        }

        const fullHash = buildMemoryHash(record);
        const hashPrefix = fullHash.slice(0, 20);
        const alreadyExists = await hasMemoryHash(tools, projectName, record.subject, hashPrefix, turnNumber, domain);
        if (alreadyExists) {
            skipped++;
            continue;
        }

        const predicate = `${domainConfig.predicatePrefix}${hashPrefix}`;
        const contextPayload = {
            memory_hash: fullHash,
            domain,
            kind: record.kind,
            cues: record.cues,
            evidence: record.evidence,
            salience: record.salience,
            durability: record.durability,
            source_plugin: sourcePlugin
        };

        await tools.facts.appendToFactsDb({
            source: record.subject,
            target: record.target || '',
            predicate,
            fact_value: record.memory,
            context: JSON.stringify(contextPayload)
        });

        vectorDocs.push({
            pageContent: buildVectorContent(record),
            metadata: {
                subject: record.subject,
                character: record.character,
                target: record.target || '',
                kind: record.kind,
                memory: record.memory,
                evidence: record.evidence,
                cues: record.cues.join('|'),
                salience: record.salience,
                durability: record.durability,
                memory_hash: fullHash,
                domain,
                source_plugin: sourcePlugin,
                turn_number: turnNumber
            }
        });

        stored++;
    }

    if (vectorDocs.length > 0 && tools.vector) {
        try {
            await tools.vector.add(vectorDocs, domainConfig.vectorCollection);
        } catch (error) {
            tools.logger.warn('MemoryRecall', `Vector add failed: ${error.message}`);
        }
    }

    tools.logger.runtime(`Memory recall store complete. Domain=${domain}, Stored=${stored}, Skipped=${skipped}.`);
    return { stored, skipped };
}

function scoreMemory(memory, queryText) {
    let score = clampNumber(memory.salience, 1, 10, 5);
    const q = toLowerSafe(queryText);
    if (!q) return score;

    if (q.includes(memory.memory.toLowerCase())) score += 4;
    if (memory.kind && q.includes(memory.kind)) score += 1.5;

    for (const cue of memory.cues || []) {
        if (cue && q.includes(cue)) score += 2;
    }

    return score;
}

function mapVectorResultToMemory(doc) {
    const meta = doc?.metadata || {};
    const cues = normalizeCues(String(meta.cues || '').split('|'));
    const sourcePlugin = normalizeText(meta.source_plugin || '').toLowerCase();
    const subject = toLowerSafe(meta.subject || meta.character);
    return {
        subject,
        character: subject,
        target: toLowerSafe(meta.target),
        kind: normalizeText(meta.kind || 'preference').toLowerCase(),
        memory: normalizeText(meta.memory || ''),
        evidence: normalizeText(meta.evidence || ''),
        cues,
        salience: clampNumber(meta.salience, 1, 10, 5),
        durability: normalizeDurability(meta.durability),
        domain: meta.domain ? normalizeDomain(meta.domain) : inferDomainFromSourcePlugin(sourcePlugin),
        turnNumber: clampNumber(meta.turn_number, 0, Number.MAX_SAFE_INTEGER, 0),
        memoryHash: normalizeText(meta.memory_hash || '')
    };
}

async function getFallbackFactMemories(tools, projectName, subject, turnNumber, limit = 16, options = {}) {
    const domain = normalizeDomain(options.domain);
    const config = getDomainConfig(domain);
    const predicateLikes = [config.predicatePrefix + '%'];
    const predicateClause = predicateLikes.map(() => 'predicate LIKE ?').join(' OR ');
    const rows = await tools.db.chat.query(
        `SELECT predicate, fact_value, context, turn_number
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND (${predicateClause})
           AND turn_number <= ?
         ORDER BY turn_number DESC
         LIMIT ?`,
        [projectName.toLowerCase(), subject, ...predicateLikes, turnNumber, limit]
    );

    return rows.map((row) => {
        const contextJson = parseContextJson(row.context) || {};
        const sourcePlugin = normalizeText(contextJson.source_plugin || '').toLowerCase();
        return {
            subject,
            character: subject,
            target: '',
            kind: normalizeText(contextJson.kind || 'preference').toLowerCase(),
            memory: normalizeText(row.fact_value || ''),
            evidence: normalizeText(contextJson.evidence || ''),
            cues: normalizeCues(contextJson.cues || []),
            salience: clampNumber(contextJson.salience, 1, 10, 5),
            durability: normalizeDurability(contextJson.durability),
            domain: contextJson.domain ? normalizeDomain(contextJson.domain) : inferDomainFromSourcePlugin(sourcePlugin),
            turnNumber: clampNumber(row.turn_number, 0, Number.MAX_SAFE_INTEGER, 0),
            memoryHash: normalizeText(contextJson.memory_hash || row.predicate)
        };
    }).filter(x => x.memory && x.domain === domain);
}

async function getRelevantMemories(turnContext, tools, subjectName, options = {}) {
    const subject = toLowerSafe(subjectName);
    if (!subject) return [];

    const settings = tools.settings.getSelf() || {};
    const maxTotal = clampNumber(options.maxTotal ?? settings.max_total_results, 4, 80, 48);
    const limit = clampNumber(options.limit ?? settings.per_character_limit, 1, 20, 8);
    const queryText = normalizeText(options.query || turnContext.input?.userPrompt || '');
    const domain = normalizeDomain(options.domain);
    const domainConfig = getDomainConfig(domain);

    let candidates = [];
    if (tools.vector) {
        try {
            const docs = await tools.vector.query(queryText, maxTotal, { subject: { $eq: subject } }, domainConfig.vectorCollection);
            candidates = docs.map(mapVectorResultToMemory).filter(x => x.memory && x.subject === subject && x.domain === domain);
        } catch (error) {
            tools.logger.warn('MemoryRecall', `Vector query failed for ${subject} (${domain}): ${error.message}`);
        }

        if (candidates.length === 0) {
            try {
                const docs = await tools.vector.query(queryText, maxTotal, { character: { $eq: subject } }, domainConfig.vectorCollection);
                candidates = docs.map(mapVectorResultToMemory).filter(x => x.memory && x.subject === subject && x.domain === domain);
            } catch (error) {
                tools.logger.warn('MemoryRecall', `Character-compatible vector query failed for ${subject} (${domain}): ${error.message}`);
            }
        }

    }

    if (candidates.length === 0) {
        candidates = await getFallbackFactMemories(tools, turnContext.projectName, subject, turnContext.turnNumber, maxTotal, { domain });
    }

    const dedup = new Map();
    for (const item of candidates) {
        const key = item.memoryHash || `${item.subject}|${item.kind}|${item.memory}`;
        if (!dedup.has(key)) dedup.set(key, item);
    }

    const ranked = Array.from(dedup.values())
        .map(item => ({ ...item, _score: scoreMemory(item, queryText) }))
        .sort((a, b) => b._score - a._score || b.turnNumber - a.turnNumber)
        .slice(0, limit);

    return ranked;
}

async function formatRecallBlock(turnContext, tools, characterName, options = {}) {
    const memories = await getRelevantMemories(turnContext, tools, characterName, options);
    if (!memories || memories.length === 0) return '';

    const lines = memories.map((m) => {
        const cueText = m.cues.length > 0 ? ` Use when: ${m.cues.slice(0, 4).join(', ')}.` : '';
        return `- ${m.memory}${cueText}`;
    });

    return `MEMORY RECALL CANDIDATES:\n${lines.join('\n')}`;
}

function getDisplayName(name) {
    const text = normalizeText(name);
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeXml(value) {
    return normalizeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function uniqueNames(names) {
    const out = [];
    const seen = new Set();
    for (const name of names || []) {
        const normalized = toLowerSafe(name);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

async function getFallbackActiveCharacters(turnContext, tools, limit = 10) {
    const names = [];
    const playerChar = turnContext.input?.playerCharacterName;
    if (playerChar && playerChar !== 'None') names.push(playerChar);

    for (const char of turnContext.output?.party || []) {
        names.push(char);
    }

    try {
        const history = await turnContext.retrieveDatedChapters();
        const allPrev = [...(history.synopsischapters || []), ...(history.summarychapters || []), ...(history.fullchapters || [])];
        const lastTurn = allPrev.length > 0 ? allPrev[allPrev.length - 1] : null;
        for (const char of lastTurn?.output?.party || []) {
            names.push(char);
        }
    } catch (error) {
        tools.logger.warn('MemoryRecall', `Fallback history roster failed: ${error.message}`);
    }

    if (names.length < limit) {
        try {
            const rows = await tools.db.chat.query(
                `SELECT source, MAX(turn_number) as last_turn
                 FROM facts
                 WHERE project_name = ?
                   AND (
                       predicate LIKE 'MEMORY_RECALL:PERSONALITY:%'
                       OR predicate LIKE 'MEMORY_RECALL:RELATIONSHIP:%'
                       OR predicate LIKE 'CHAR_RECALL:PERSONALITY:%'
                       OR predicate LIKE 'CHAR_RECALL:RELATIONSHIP:%'
                       OR predicate LIKE 'CHAR_RECALL:MEMORY:%'
                   )
                   AND turn_number <= ?
                 GROUP BY source
                 ORDER BY last_turn DESC
                 LIMIT ?`,
                [turnContext.projectName.toLowerCase(), turnContext.turnNumber || 0, limit * 2]
            );
            for (const row of rows || []) names.push(row.source);
        } catch (error) {
            tools.logger.warn('MemoryRecall', `Fallback recall roster failed: ${error.message}`);
        }
    }

    return uniqueNames(names).slice(0, limit);
}

async function getActiveCharacters(turnContext, tools, options = {}) {
    const limit = clampNumber(options.characterLimit, 1, 40, 12);
    const activeFromSheets = tools.pluginState
        ?.forPlugin?.('character_sheets')
        ?.turn?.()
        ?.activeCharacters;

    if (Array.isArray(activeFromSheets) && activeFromSheets.length > 0) {
        return uniqueNames(activeFromSheets).slice(0, limit);
    }

    return await getFallbackActiveCharacters(turnContext, tools, limit);
}

function formatMemoryLine(memory) {
    const cueText = memory.cues?.length > 0 ? ` Use when: ${memory.cues.slice(0, 4).map(escapeXml).join(', ')}.` : '';
    const targetText = memory.target ? ` About target: ${escapeXml(getDisplayName(memory.target))}.` : '';
    return `- ${escapeXml(memory.memory)}${targetText}${cueText}`;
}

function formatGenericMemoryLine(memory) {
    const cueText = memory.cues?.length > 0 ? ` Use when: ${memory.cues.slice(0, 4).map(escapeXml).join(', ')}.` : '';
    return `- ${escapeXml(memory.memory)}${cueText}`;
}

async function getActiveLocationSubjects(turnContext, tools, options = {}) {
    const provided = uniqueNames(options.locationSubjects || options.locations || []);
    if (provided.length > 0) return provided;

    const subjects = [];
    try {
        if (tools.plugins?.isInstalled && !tools.plugins.isInstalled('world_location_tracker')) {
            return subjects;
        }

        const LocationLogic = require('../world_location_tracker/logic.js');
        const locLogic = new LocationLogic(tools);
        const currentLocation = await locLogic.getCurrentLocation(turnContext);
        if (currentLocation?.name) subjects.push(currentLocation.name);
        if (currentLocation?.anchor) subjects.push(currentLocation.anchor);
        if (currentLocation?.anchor_node) subjects.push(currentLocation.anchor_node);
        if (Array.isArray(currentLocation?.area_hierarchy)) {
            for (const area of currentLocation.area_hierarchy) {
                if (typeof area === 'string') subjects.push(area);
                else if (area?.name) subjects.push(area.name);
            }
        }
    } catch (error) {
        tools.logger.warn('MemoryRecall', `Location subject discovery failed: ${error.message}`);
    }

    return uniqueNames(subjects).slice(0, clampNumber(options.locationSubjectLimit, 1, 8, 4));
}

async function formatRecallContext(turnContext, tools, options = {}) {
    const settings = tools.settings.getSelf() || {};
    const characters = uniqueNames(options.characters || await getActiveCharacters(turnContext, tools, options));
    const query = normalizeText(options.query || turnContext.input?.userPrompt || '');
    const sections = [];

    for (const domain of PROMPT_DOMAINS) {
        const domainConfig = getDomainConfig(domain);
        const limitOption = domain === 'personality'
            ? (options.personalityLimit ?? settings.personality_per_character_limit ?? domainConfig.defaultLimit)
            : (options.relationshipLimit ?? settings.relationship_per_character_limit ?? settings.per_character_limit ?? domainConfig.defaultLimit);
        const perCharacterLimit = clampNumber(limitOption, 1, 20, domainConfig.defaultLimit);
        const characterBlocks = [];

        for (const character of characters) {
            const memories = await getRelevantMemories(turnContext, tools, character, {
                domain,
                query,
                limit: perCharacterLimit,
                maxTotal: options.maxTotal ?? settings.max_total_results,
            });

            if (memories.length === 0) continue;

            const lines = memories.map(formatMemoryLine).join('\n');
            characterBlocks.push(`<character name="${escapeXml(getDisplayName(character))}">\n${lines}\n</character>`);
        }

        if (characterBlocks.length > 0) {
            sections.push(`<${domainConfig.wrapperTag}>\n${characterBlocks.join('\n')}\n</${domainConfig.wrapperTag}>`);
        }
    }

    for (const domain of WORLD_PROMPT_DOMAINS) {
        const domainConfig = getDomainConfig(domain);
        const limitOption = domain === 'world'
            ? (options.worldLimit ?? settings.world_recall_limit ?? domainConfig.defaultLimit)
            : (options.locationLimit ?? settings.location_recall_limit ?? domainConfig.defaultLimit);
        const limit = clampNumber(limitOption, 1, 20, domainConfig.defaultLimit);

        if (domain === 'world') {
            const worldSubject = toLowerSafe(options.worldSubject || 'world');
            const memories = await getRelevantMemories(turnContext, tools, worldSubject, {
                domain,
                query,
                limit,
                maxTotal: options.maxTotal ?? settings.max_total_results,
            });

            if (memories.length > 0) {
                sections.push(`<${domainConfig.wrapperTag}>\n${memories.map(formatGenericMemoryLine).join('\n')}\n</${domainConfig.wrapperTag}>`);
            }
            continue;
        }

        const locationSubjects = await getActiveLocationSubjects(turnContext, tools, options);
        const locationBlocks = [];
        for (const locationSubject of locationSubjects) {
            const memories = await getRelevantMemories(turnContext, tools, locationSubject, {
                domain,
                query,
                limit,
                maxTotal: options.maxTotal ?? settings.max_total_results,
            });

            if (memories.length === 0) continue;
            const lines = memories.map(formatGenericMemoryLine).join('\n');
            locationBlocks.push(`<location name="${escapeXml(getDisplayName(locationSubject))}">\n${lines}\n</location>`);
        }

        if (locationBlocks.length > 0) {
            sections.push(`<${domainConfig.wrapperTag}>\n${locationBlocks.join('\n')}\n</${domainConfig.wrapperTag}>`);
        }
    }

    if (sections.length === 0) return '';
    return `<recall_context>\n${sections.join('\n')}\n</recall_context>`;
}

module.exports = {
    cleanupCurrentTurn,
    storeMemories,
    getRelevantMemories,
    formatRecallBlock,
    formatRecallContext
};
