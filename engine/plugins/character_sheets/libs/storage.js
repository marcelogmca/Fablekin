/**
 * Character Sheets - Storage & Search Library
 * Handles SQL persistence, Vector DB synchronization, and Hybrid Search Probes.
 */
const parser = require('./parser.js');
const schemaAdapter = require('./schema_adapter.js');

async function initializeDatabase(tools) {
    tools.logger.runtime('storage: initializeDatabase');
    await tools.db.project.execute(`
        CREATE TABLE IF NOT EXISTS character_sheets (
            project_name TEXT NOT NULL,
            character_name TEXT NOT NULL,
            source_file TEXT PRIMARY KEY,
            character_sheet_data TEXT,
            content_hash TEXT
        )
    `);
    await tools.db.project.execute(`
        CREATE TABLE IF NOT EXISTS supporting_cast_cache (
            file_path TEXT PRIMARY KEY,
            content_hash TEXT,
            character_data TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function setFact(tools, source, target, predicate, value, turnNumber, origin = 'Character Sheet System') {
    // Use the managed facts toolkit for timeline-safe persistence
    await tools.facts.appendToFactsDb({
        source: source.toLowerCase().trim(),
        target,
        predicate,
        fact_value: value,
        context: origin
    }, { turn_number: turnNumber });
}

async function bootstrapCharacterSheet(tools, capsule, turnNumber = 0) {
    const characterName = capsule.metadata.name;
    const lowerName = characterName.toLowerCase();

    tools.logger.runtime(`storage: bootstrapCharacterSheet for ${characterName}, turn=${turnNumber}`);
    await initializeDatabase(tools); // Ensure tables exist

    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, 'full');

    try {
        await setFact(tools, lowerName, characterName, 'IMPORTANCE', 'CORE', turnNumber);
    } catch (e) {
        tools.logger.runtime(`bootstrapCharacterSheet: Error inserting IMPORTANCE for ${characterName}: ${e.message}`);
    }

    const entries = [
        { predicate: 'CHAR_SHEET:FIRST_APPEARED', value: turnNumber.toString() },
        { predicate: 'CHAR_SHEET:LAST_APPEARED', value: turnNumber.toString() }
    ];

    // Dynamic fields from schema
    fields.forEach(f => {
        if (f.predicate && capsule[f.id]) {
            entries.push({ predicate: f.predicate, value: capsule[f.id] });
        }
    });

    if (capsule.aliases) {
        const ignoredAliases = new Set(['none', 'n/a', 'na', 'unknown', 'null', '-']);
        const aliasList = capsule.aliases.split(',').map(a => a.trim()).filter(a => a.length > 0 && !ignoredAliases.has(a.toLowerCase()));
        tools.logger.runtime(`bootstrapCharacterSheet: Processing ${aliasList.length} aliases for ${characterName}`);
        for (const alias of aliasList) {
            entries.push({ predicate: 'IS_ALIAS_OF', value: characterName, source: alias.toLowerCase() });
        }
    }

    tools.logger.runtime(`bootstrapCharacterSheet: Persisting ${entries.length} fields for ${characterName}`);
    for (const entry of entries) {
        if (!entry.value) continue;
        const source = entry.source || lowerName;
        // Use characterName (Display Name) as target for attributes to allow case-sensitive storage while keeping source normalized ID
        const target = entry.predicate === 'IS_ALIAS_OF' ? entry.value : characterName;

        await setFact(tools, source, target, entry.predicate, entry.value, turnNumber);

        if (entry.predicate === 'CHAR_SHEET:BIOGRAPHY' || entry.predicate === 'CHAR_SHEET:BRIEF') {
            await syncSocialRegistry(tools, characterName, entry.value);
        }
    }
}

async function syncSocialRegistry(tools, characterName, brief) {
    if (!brief || typeof brief !== 'string' || brief.trim().length === 0) return;
    tools.logger.runtime(`storage: syncSocialRegistry for ${characterName}, brief length=${brief.length}`);
    try {
        const collection = 'social_registry';
        // Check if vector tool exists
        if (tools.vector) {
            await tools.vector.delete(collection, { name: characterName });
            await tools.vector.add([{ pageContent: brief, metadata: { name: characterName, type: 'light_capsule' } }], collection);
            tools.logger.runtime(`syncSocialRegistry: Successfully synced ${characterName} to vector DB`);
        }
    } catch (error) {
        tools.logger.error('Vector', `Failed to sync ${characterName} to social_registry: ${error.message}`);
    }
}

async function updateAppearanceMetadata(tools, charName, turnNumber) {
    try {
        const lowerName = charName.toLowerCase();
        tools.logger.runtime(`storage: updateAppearanceMetadata for ${charName}, turn=${turnNumber}`);
        
        const existingFirst = await tools.db.chat.query(
            `SELECT 1 FROM facts WHERE source = ? AND predicate = 'CHAR_SHEET:FIRST_APPEARED' AND turn_number <= ?`, 
            [lowerName, turnNumber]
        );
        
        if (existingFirst.length === 0) {
            tools.logger.runtime(`updateAppearanceMetadata: Setting FIRST_APPEARED for ${charName} to ${turnNumber}`);
            await tools.facts.appendToFactsDb({
                source: lowerName,
                target: 'self',
                predicate: 'CHAR_SHEET:FIRST_APPEARED',
                fact_value: turnNumber.toString(),
                context: 'Character Sheet System: Introduction'
            });
        }
        
        await tools.facts.appendToFactsDb({
            source: lowerName,
            target: 'self',
            predicate: 'CHAR_SHEET:LAST_APPEARED',
            fact_value: turnNumber.toString(),
            context: 'Character Sheet System: Appearance'
        });
    } catch (error) {
        tools.logger.runtime(`updateAppearanceMetadata: Error for ${charName}: ${error.message}`);
    }
}

async function searchSocialRegistry(turnContext, tools) {
    const prompt = turnContext.input.userPrompt;
    const history = await turnContext.retrieveDatedChapters();
    const lastTurnSummary = (history.fullchapters || []).slice(-1)[0]?.output?.summary || '';
    const combinedQuery = `${lastTurnSummary}\n\n${prompt}`;
    const discoveredNames = new Set();

    tools.logger.runtime(`storage: searchSocialRegistry, query length=${combinedQuery.length}`);

    const words = combinedQuery.match(/\b[A-Z][a-z]+\b/g) || [];
    if (words.length > 0) {
        const uniqueWords = Array.from(new Set(words.map(w => w.toLowerCase())));
        const placeholders = uniqueWords.map(() => '?').join(',');
        const turnNumber = tools.turnContext?.turnNumber || 0;
        const rows = await tools.db.chat.query(
            `SELECT DISTINCT source FROM facts 
             WHERE source IN (${placeholders}) AND predicate = 'CHAR_SHEET:BRIEF' 
             AND turn_number <= ?`,
            [...uniqueWords, turnNumber]
        );
        rows.forEach(r => discoveredNames.add(r.source.toLowerCase()));
        if (rows.length > 0) tools.logger.runtime(`searchSocialRegistry: Keywords found ${rows.length} characters in SQL`);
    }

    if (tools.vector) {
        const vectorResults = await tools.vector.query(combinedQuery, 5, null, 'social_registry');
        if (vectorResults) {
            vectorResults.forEach(res => { if (res.metadata?.name) discoveredNames.add(res.metadata.name.toLowerCase()); });
            tools.logger.runtime(`searchSocialRegistry: Vector found ${vectorResults.length} potential matches`);
        }
    }

    if (discoveredNames.size === 0) {
        tools.logger.runtime('searchSocialRegistry: No characters discovered');
        return [];
    }

    const finalResults = [];
    const nameList = Array.from(discoveredNames);
    tools.logger.runtime(`searchSocialRegistry: Discovered ${nameList.length} unique character names: ${nameList.join(', ')}`);
    const placeholders = nameList.map(() => '?').join(',');
    const turnNumber = tools.turnContext?.turnNumber || 0;
    const briefRows = await tools.db.chat.query(
        `SELECT source, fact_value as brief FROM facts 
         WHERE source IN (${placeholders}) AND predicate = 'CHAR_SHEET:BRIEF' 
         AND turn_number <= ?
         GROUP BY source`,
        [...nameList, turnNumber]
    );

    for (const row of briefRows) {
        const statusRows = await tools.db.chat.query(
            `SELECT fact_value FROM facts 
             WHERE source = ? AND predicate = 'CHAR_STATUS' 
             AND turn_number <= ? 
             ORDER BY turn_number DESC, id DESC LIMIT 1`,
            [row.source.toLowerCase(), turnNumber]
        );
        finalResults.push({ name: row.source, brief: row.brief, status: statusRows[0]?.fact_value || 'ALIVE' });
    }
    return finalResults;
}

async function getCurrentSheet(tools, characterName, turnNumber) {
    try {
        const lowerName = characterName.toLowerCase();
        const projectName = (tools.turnContext?.projectName || '').toLowerCase();
        tools.logger.runtime(`storage: getCurrentSheet for ${characterName}, turn=${turnNumber}`);
        const importanceRows = await tools.db.chat.query(
            `SELECT fact_value FROM facts
             WHERE project_name = ? AND source = ? AND predicate = 'IMPORTANCE' AND turn_number <= ?
             ORDER BY
                CASE LOWER(fact_value)
                    WHEN 'core' THEN 0
                    WHEN 'major' THEN 1
                    WHEN 'minor' THEN 2
                    WHEN 'noncharacter' THEN 3
                    ELSE 4
                END ASC,
                turn_number DESC,
                id DESC
             LIMIT 1`,
            [projectName, lowerName, turnNumber]
        );
        if (importanceRows.length > 0 && (importanceRows[0].fact_value.toLowerCase() === 'minor' || importanceRows[0].fact_value.toLowerCase() === 'noncharacter')) {
            tools.logger.runtime(`getCurrentSheet: Character ${characterName} is ${importanceRows[0].fact_value.toUpperCase()}, skipping`);
            return null;
        }

        const rows = await tools.db.chat.query(
            `SELECT predicate, fact_value, MAX(turn_number) as latest_turn FROM facts WHERE source = ? AND predicate LIKE 'CHAR_SHEET:%' AND turn_number <= ? GROUP BY predicate`,
            [lowerName, turnNumber]
        );

        if (rows.length === 0) {
            tools.logger.runtime(`getCurrentSheet: No fields found for ${characterName}`);
            return null;
        }

        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, 'full');
        const predicateToId = schemaAdapter.getPredicateToIdMap(fields);

        const capsule = {
            metadata: { name: characterName, last_updated_turn: 0, first_turn_appeared: null, last_turn_appeared: null },
            brief: '' // Helper field, might not be in schema
        };

        // Initialize schema fields
        fields.forEach(f => {
            capsule[f.id] = '';
        });

        // Add extra mappings for metadata
        predicateToId['CHAR_SHEET:BRIEF'] = 'brief';
        predicateToId['CHAR_SHEET:FIRST_APPEARED'] = 'first_turn_appeared';
        predicateToId['CHAR_SHEET:LAST_APPEARED'] = 'last_turn_appeared';

        for (const row of rows) {
            const key = predicateToId[row.predicate];
            if (key) {
                if (key.includes('_appeared')) capsule.metadata[key] = parseInt(row.fact_value);
                else capsule[key] = row.fact_value;
                if (row.latest_turn > capsule.metadata.last_updated_turn) capsule.metadata.last_updated_turn = row.latest_turn;
            }
        }

        // --- Reconstruct Aliases ---
        const aliasRows = await tools.db.chat.query(
            `SELECT source FROM facts WHERE target = ? AND predicate = 'IS_ALIAS_OF' AND turn_number <= ?`,
            [lowerName, turnNumber] // target is canonical name (lowerName)
        );
        if (aliasRows.length > 0) {
            const aliases = aliasRows.map(r => r.source.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')); // Capitalize
            capsule.aliases = aliases.join(', ');
        }
        // ---------------------------

        tools.logger.runtime(`getCurrentSheet: Successfully reconstructed capsule for ${characterName}`);
        return capsule;
    } catch (error) {
        tools.logger.runtime(`getCurrentSheet: Error for ${characterName}: ${error.message}`);
        return null;
    }
}

async function getAllCharacters(tools, turnNumber) {
    const characters = {};
    try {
        const projectName = (tools.turnContext?.projectName || '').toLowerCase();
        tools.logger.runtime(`storage: getAllCharacters, turn=${turnNumber}`);
        await initializeDatabase(tools); // Ensure tables exist

        // 1. Fetch all aliases to map source -> target AND to populate alias lists
        const aliasMap = {};
        const aliasesByTarget = {}; // target -> [source]

        const aliasRows = await tools.db.chat.query(`SELECT source, target FROM facts WHERE predicate = 'IS_ALIAS_OF' AND turn_number <= ?`, [turnNumber]);
        for (const row of aliasRows) {
            const src = row.source.toLowerCase();
            const tgt = row.target.toLowerCase(); // keep lowercase for map key
            aliasMap[src] = row.target; // preserve case for target? row.target is whatever was saved.

            if (!aliasesByTarget[tgt]) aliasesByTarget[tgt] = new Set();
            aliasesByTarget[tgt].add(src);
        }

        const resolveLocal = (name) => aliasMap[name.toLowerCase()] || name;
        if (aliasRows.length > 0) tools.logger.runtime(`getAllCharacters: Loaded ${aliasRows.length} alias facts`);

        // Load schema once
        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, 'full');
        const predicateToId = schemaAdapter.getPredicateToIdMap(fields);
        // Add extras
        predicateToId['CHAR_SHEET:BRIEF'] = 'brief';
        predicateToId['CHAR_STATUS'] = 'status';
        predicateToId['CHAR_SHEET:FIRST_APPEARED'] = 'first_turn_appeared';
        predicateToId['CHAR_SHEET:LAST_APPEARED'] = 'last_turn_appeared';

        const staticRows = await tools.db.project.query(`SELECT character_name, source_file, character_sheet_data FROM character_sheets`);
        tools.logger.runtime(`getAllCharacters: Loaded ${staticRows.length} static core sheets`);
        for (const row of staticRows) {
            const parsedCapsule = await parser.parseCharacterSheet(tools, row.character_sheet_data, { source_file: row.source_file, name: row.character_name });
            characters[row.character_name.toLowerCase()] = {
                name: row.character_name, type: 'full', isMajor: true,
                capsule: parsedCapsule
            };
        }

        const dynamicRows = await tools.db.chat.query(
            `SELECT source, predicate, fact_value, MAX(turn_number) as latest_turn FROM facts WHERE (predicate LIKE 'CHAR_SHEET:%' OR predicate = 'CHAR_STATUS') AND turn_number <= ? GROUP BY source, predicate`, [turnNumber]
        );
        tools.logger.runtime(`getAllCharacters: Loaded ${dynamicRows.length} dynamic fact rows`);

        const dynamicMap = {};
        for (const row of dynamicRows) {
            const resolvedName = resolveLocal(row.source);
            const lowRes = resolvedName.toLowerCase();
            if (!dynamicMap[lowRes]) dynamicMap[lowRes] = { metadata: { name: resolvedName, last_updated_turn: 0 }, status: 'ALIVE' };
            const cap = dynamicMap[lowRes];

            const key = predicateToId[row.predicate];
            if (key) {
                if (key.includes('_appeared')) cap.metadata[key] = parseInt(row.fact_value);
                else if (key === 'status') cap.status = row.fact_value;
                else cap[key] = row.fact_value;
                if (row.latest_turn > cap.metadata.last_updated_turn) cap.metadata.last_updated_turn = row.latest_turn;
            }
        }

        for (const [low, cap] of Object.entries(dynamicMap)) {
            if (characters[low]) {
                Object.assign(characters[low].capsule.metadata, cap.metadata);
                // Merge schema fields dynamically
                fields.forEach(f => {
                    if (cap[f.id]) characters[low].capsule[f.id] = cap[f.id];
                });
                // Note: aliases handled below
            } else {
                characters[low] = { name: cap.metadata.name, type: 'light', capsule: cap, isMajor: false };
            }
        }

        // Apply aliases from facts to all characters
        for (const [low, char] of Object.entries(characters)) {
            if (aliasesByTarget[low]) {
                const aliasSet = aliasesByTarget[low];
                const fmtAliases = Array.from(aliasSet).map(a => a.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
                char.capsule.aliases = fmtAliases.join(', ');
            }
        }

        const playerRows = await tools.db.chat.query(`SELECT source FROM facts WHERE predicate = 'IS_PLAYER' AND fact_value = 'true' AND turn_number <= ?`, [turnNumber]);
        const playerNames = new Set(playerRows.map(r => r.source.toLowerCase()));
        const importanceRows = await tools.db.chat.query(
            `SELECT source, fact_value FROM facts
             WHERE project_name = ? AND predicate = 'IMPORTANCE' AND turn_number <= ?
             ORDER BY source ASC, turn_number ASC, id ASC`,
            [projectName, turnNumber]
        );
        const impMap = {};
        for (const r of importanceRows) impMap[resolveLocal(r.source).toLowerCase()] = r.fact_value.toUpperCase();

        for (const low of Object.keys(characters)) {
            if (low === 'party') { delete characters[low]; continue; }
            characters[low].isPlayer = playerNames.has(low);
            if (impMap[low] === 'MINOR' || impMap[low] === 'NONCHARACTER') {
                tools.logger.runtime(`getAllCharacters: Filtering out ${impMap[low]} entity ${characters[low].name}`);
                delete characters[low];
                continue;
            }
            characters[low].isMajor = (characters[low].type === 'full') || (impMap[low] === 'MAJOR' || impMap[low] === 'CORE');
        }
        tools.logger.runtime(`getAllCharacters: Final character count: ${Object.keys(characters).length}`);
    } catch (e) { tools.logger.error('Storage', `getAllCharacters failed: ${e.message}`); }
    return Object.values(characters);
}

function compactRelationshipText(text, maxLength = 220) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned === 'Stable' || cleaned === 'Unknown') return '';

    const firstSentence = cleaned.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() || cleaned;
    if (firstSentence.length <= maxLength) return firstSentence;

    const clipped = firstSentence.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
    return clipped ? `${clipped}...` : firstSentence.slice(0, maxLength).trim();
}

function renderRelationshipPromptEntry(relationship) {
    const name = relationship.character;
    const archetype = relationship.archetype || 'Acquaintances';
    const guidance = relationship.guidance || 'No established bond.';
    const isMain = relationship.isMainRelationship || relationship.detailTier === 'main';

    let entry = `- **${name}** (${archetype}): ${guidance}`;
    if (isMain) {
        entry += `\n  * Origin: ${relationship.origin || 'Unknown'}`;
        entry += `\n  * Evolution: ${relationship.evolution || 'Stable'}`;
        return entry;
    }

    const compactContext = compactRelationshipText(relationship.evolution) || compactRelationshipText(relationship.origin);
    if (compactContext) {
        entry += `\n  * Context: ${compactContext}`;
    }
    return entry;
}

async function getIntegratedCharacterData(tools, turnNumber) {
    tools.logger.runtime(`storage: getIntegratedCharacterData, turn=${turnNumber}`);
    const characters = await getAllCharacters(tools, turnNumber);

    const hasP = tools.plugins.isInstalled('personality_tracker');
    const hasR = tools.plugins.isInstalled('relationship_tracker');
    const hasL = tools.plugins.isInstalled('world_location_tracker');
    const hasE = tools.plugins.isInstalled('character_echoes');

    const trackMajorPersonality = tools.settings.get('character_sheets')?.track_major_personality === true;

    tools.logger.runtime(`getIntegratedCharacterData: Enriching ${characters.length} characters (Personality=${hasP}, Relationships=${hasR}, Locations=${hasL})`);

    await Promise.all(characters.map(async (char) => {
        const enrich = {};
        // Use schema to check if personality field exists? Or just assume if plugin installed.
        // Assuming plugin installed is enough.
        if (hasP && (char.type === 'full' || (char.isMajor && trackMajorPersonality))) {
            const p = await tools.plugins.call('personality_tracker', 'getPersonality', char.name, { turnNumber, noHeader: true });
            if (p) enrich.personality_profile = p;
        }
        if (hasR) {
            const r = await tools.plugins.call('relationship_tracker', 'getTopRelationships', char.name, { limit: 10, turnNumber });
            if (r) {
                enrich.social_connections = r.map(renderRelationshipPromptEntry).join('\n');
            }
        }
        if (hasL && !char.isPlayer) {
            const l = await tools.plugins.call('world_location_tracker', 'getCharacterLocation', char.name, { turnNumber });
            if (l) enrich.current_context = `${l.specific_location}, ${l.context}`;
        }
        if (hasE) {
            const e = await tools.plugins.call('character_echoes', 'getLatestEchoes', char.name, { turnNumber });
            if (e) enrich.recent_echoes = e;
        }
        Object.assign(char.capsule, enrich);
    }));
    return characters;
}

async function getCharacterImportance(tools, characterName) {
    if (!characterName) return undefined;
    const lowerName = characterName.toLowerCase().trim();
    try {
        const turnNumber = tools.turnContext?.turnNumber || 0;
        const projectName = (tools.turnContext?.projectName || '').toLowerCase();
        const rows = await tools.db.chat.query(
            `SELECT fact_value FROM facts
             WHERE project_name = ? AND source = ? AND predicate = 'IMPORTANCE'
             AND turn_number <= ? 
             ORDER BY
                CASE LOWER(fact_value)
                    WHEN 'core' THEN 0
                    WHEN 'major' THEN 1
                    WHEN 'minor' THEN 2
                    WHEN 'noncharacter' THEN 3
                    ELSE 4
                END ASC,
                turn_number DESC,
                id DESC
             LIMIT 1`,
            [projectName, lowerName, turnNumber]
        );
        if (rows && rows.length > 0) {
            return rows[0].fact_value.toLowerCase();
        }
    } catch (e) {
        tools.logger.error('Storage', `Error fetching character importance for ${characterName}: ${e.message}`);
    }
    return undefined;
}

async function hasBootstrappedFacts(tools, characterName) {
    if (!characterName) return false;
    const lowerName = characterName.toLowerCase().trim();
    try {
        const turnNumber = tools.turnContext?.turnNumber || 0;
        const rows = await tools.db.chat.query(
            `SELECT 1 FROM facts 
             WHERE source = ? AND predicate = 'CHAR_SHEET:FIRST_APPEARED' 
             AND turn_number <= ? LIMIT 1`,
            [lowerName, turnNumber]
        );
        return rows && rows.length > 0;
    } catch (e) {
        tools.logger.error('Storage', `Error checking bootstrapped facts for ${characterName}: ${e.message}`);
        return false;
    }
}

module.exports = {
    initializeDatabase, // Export for use elsewhere
    bootstrapCharacterSheet, syncSocialRegistry, updateAppearanceMetadata,
    searchSocialRegistry, getCurrentSheet, getAllCharacters, getIntegratedCharacterData,
    getCharacterImportance, setFact, hasBootstrappedFacts
};
