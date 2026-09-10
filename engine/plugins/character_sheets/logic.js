const path = require('path');
const fs = require('fs/promises');

// Import modular libraries
const identity = require('./libs/identity.js');
const parser = require('./libs/parser.js');
const storage = require('./libs/storage.js');
const discovery = require('./libs/discovery.js');
const schemaAdapter = require('./libs/schema_adapter.js');
const auditor = require('./libs/auditor.js');

function isLikelyGarbageEntityName(name) {
    if (!name || typeof name !== 'string') return true;
    const cleaned = name.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!cleaned) return true;

    if (/^\d+$/.test(cleaned)) return true;
    if (/^\d{1,2}\s*(am|pm)$/i.test(cleaned)) return true;
    if (/^\d{1,2}[:.]\d{2}\s*(am|pm)?$/i.test(cleaned)) return true;

    const lower = cleaned.toLowerCase();
    const noiseSet = new Set(['noise', 'machine', 'system', 'narrator', 'voice', 'unknown', 'none', 'null', 'timestamp']);
    if (noiseSet.has(lower)) return true;

    if (/^(the\s+)?(lost girl|stranger|guard|soldier|machine|noise)$/i.test(cleaned)) return true;
    return false;
}

function normalizeImportance(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function isTrackableImportance(importance) {
    return importance === 'core' || importance === 'major';
}

function getFieldPriority(field) {
    const direct = typeof field?.priority === 'string' ? field.priority : '';
    const behavior = typeof field?.behavior?.priority === 'string' ? field.behavior.priority : '';
    return (direct || behavior || 'normal').trim().toLowerCase();
}

function isHardPriorityField(field) {
    return getFieldPriority(field) === 'hard';
}

function cleanCapsuleValue(value) {
    if (value === undefined || value === null) return '';
    const text = String(value).replace(/\r\n/g, '\n').trim();
    if (!text || text === 'N/A') return '';
    return text;
}

const DEFAULT_MUTABLE_FIELD_SOFT_LIMIT_CHARS = 1400;
const FIELD_SOFT_LIMIT_CHARS = {
    current_context: 700,
    affinities_preferences: 1200,
    knowledge: 1600,
    narrative_arc_status: 1400,
    appearance_continuity: 1200,
    core_motivation: 1000,
    paradox_and_evolution: 1400,
    intimacy_profile: 1200,
    dynamic_growth_engine: 1400
};

function getFieldSoftLimit(field) {
    return FIELD_SOFT_LIMIT_CHARS[field.id] || DEFAULT_MUTABLE_FIELD_SOFT_LIMIT_CHARS;
}

function buildFieldSizeAdvisory(fields, currentCapsule, activeManaged) {
    const warnings = [];
    for (const field of fields) {
        if (field.behavior?.immutable === true || activeManaged.has(field.id)) continue;

        const text = cleanCapsuleValue(currentCapsule[field.id]);
        if (!text) continue;

        const softLimit = getFieldSoftLimit(field);
        if (text.length <= softLimit) continue;

        warnings.push(`- [${field.id}] ${field.label}: ${text.length} characters, above the ${softLimit} character soft target.`);
    }

    if (warnings.length === 0) return '';

    return [
        '### FIELD SIZE ADVISORY',
        'These mutable fields are getting too large. If you touch one of them, prefer a concise complete-field replacement that preserves important facts, removes repetition, and avoids adding more text unless the recent history truly requires it.',
        warnings.join('\n')
    ].join('\n');
}

function formatCapsuleSection(field, value, options = {}) {
    const text = cleanCapsuleValue(value);
    if (!text) return '';

    const indexLabel = Number.isInteger(options.index) ? `Layer ${options.index}: ` : '';
    const priority = getFieldPriority(field);
    const priorityLabel = priority === 'hard' ? ' | priority=hard' : '';
    const title = `${indexLabel}${field.label}${priorityLabel}`;

    return [
        `--- ${title} ---`,
        text
    ].join('\n');
}

function formatBriefSection(value) {
    const text = cleanCapsuleValue(value);
    if (!text) return '';
    return [
        '--- Brief ---',
        text
    ].join('\n');
}

function compactSchemaInstruction(value, maxLength = 900) {
    const text = cleanCapsuleValue(value).replace(/\s+/g, ' ');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3).trim()}...`;
}

function buildUpdateSchemaBrief(fields, activeManaged) {
    return fields.map((field, index) => {
        const isImmutable = field.behavior?.immutable === true;
        const manager = field.behavior?.managed_by || '';
        const managedByActivePlugin = activeManaged.has(field.id);
        const mutable = !isImmutable && !managedByActivePlugin;
        const priority = getFieldPriority(field);
        const status = mutable
            ? 'MUTABLE'
            : (managedByActivePlugin ? `READ-ONLY, managed by ${manager}` : 'READ-ONLY, immutable baseline');
        const priorityText = priority === 'hard' ? '\nPriority: hard continuity; do not contradict casually.' : '';
        const managerText = manager && !managedByActivePlugin ? `\nManager: ${manager} is not active, so this field may be edited if listed as mutable.` : '';

        return [
            `LAYER ${index}: ${field.label}`,
            `Field id: ${field.id}`,
            `Status: ${status}${priorityText}${managerText}`,
            `Meaning: ${compactSchemaInstruction(field.instructions)}`
        ].join('\n');
    }).join('\n\n');
}

function addHardPriorityEntries(entriesByCharacter, characterName, capsule, hardFields) {
    if (!characterName || !capsule || !Array.isArray(hardFields)) return;

    const entries = [];
    for (const field of hardFields) {
        const value = cleanCapsuleValue(capsule[field.id]);
        if (value) entries.push({ label: field.label, value });
    }

    if (entries.length > 0) {
        entriesByCharacter.set(characterName, entries);
    }
}

function buildHardPriorityDirective(entriesByCharacter) {
    if (!entriesByCharacter || entriesByCharacter.size === 0) return '';

    const blocks = [];
    for (const [characterName, entries] of entriesByCharacter.entries()) {
        const lines = [`Character: ${characterName}`];
        for (const entry of entries) {
            lines.push(`- ${entry.label}: ${entry.value}`);
        }
        blocks.push(lines.join('\n'));
    }

    return [
        '## CHARACTER HARD CONTINUITY',
        'The following hard-priority capsule facts override narrative history, prior generated wording, model defaults, and stylistic variation. Do not contradict them.',
        '',
        toolsSafeWrap('character_hard_continuity', blocks.join('\n\n'))
    ].join('\n');
}

function toolsSafeWrap(tagName, content) {
    const text = cleanCapsuleValue(content);
    if (!text) return '';
    return `<${tagName} priority="hard">\n${text}\n</${tagName}>`;
}

async function getClassifierImportance(turnContext, tools, characterName) {
    if (!characterName) return '';
    const charKey = characterName.toLowerCase().trim();
    let importance = normalizeImportance(turnContext.processed.characterMetadata?.[charKey]?.importance);

    if (!importance && tools.plugins.isInstalled('character_classifier')) {
        importance = normalizeImportance(await tools.plugins.call('character_classifier', 'getImportance', characterName));
        if (importance) {
            if (!turnContext.processed.characterMetadata) turnContext.processed.characterMetadata = {};
            const existing = turnContext.processed.characterMetadata[charKey] || {};
            turnContext.processed.characterMetadata[charKey] = { ...existing, importance };
        }
    }

    return importance;
}

/**
 * ============================================================================
 * CORE GENERATION & EVOLUTION FUNCTIONS
 * ============================================================================
 */

async function getOrGenerateSheet(turnContext, tools, file, promptTemplate) {
    const projectName = turnContext.projectName;
    const playerCharacterName = turnContext.input.playerCharacterName || '';

    tools.logger.runtime(`logic: getOrGenerateSheet for ${file.path}`);
    // Ensure tables exist
    await storage.initializeDatabase(tools);

    try {
        const rawContent = await fs.readFile(file.path, 'utf-8');
        const content = rawContent.replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);
        const contentHash = tools.turnContext.runtime.generateHash ? tools.turnContext.runtime.generateHash(content, 'sha256') : parser.simpleHash(content);
        const relativePath = path.relative(turnContext.rootDirectory, file.path);
        const match = content.match(/PYRAMID OF PERSONA:\s*([^\n\r]+)/i);
        const characterName = match ? match[1].trim() : path.basename(file.path, '.md');

        tools.logger.runtime(`getOrGenerateSheet: Character=${characterName}, Hash=${contentHash}`);

        const rows = await tools.db.project.query(
            `SELECT character_sheet_data, content_hash FROM character_sheets WHERE source_file = ?`,
            [relativePath]
        );

        if (rows && rows.length > 0 && rows[0].content_hash === contentHash) {
            tools.logger.runtime(`getOrGenerateSheet: Cache hit for ${characterName}`);
            const sheet = rows[0].character_sheet_data;
            const capsule = await parser.parseCharacterSheet(tools, sheet, {
                source_file: relativePath, content_hash: contentHash, last_updated_turn: turnContext.turnNumber || 0
            });
            return { name: characterName, sheet, capsule, isCached: true };
        }

        tools.logger.log('Character Sheets', `Generating character sheet for ${characterName}...`);
        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, 'full');
        const dynamicSchemaText = schemaAdapter.generatePromptSchema(fields);

        const messages = [{ role: 'system', content: promptTemplate.replace('{{DYNAMIC_SCHEMA}}', dynamicSchemaText) }, { role: 'user', content: content }];
        const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
        const rawModelDef = settings.model_def || settings.narrative_agents?.summarizer;
        const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef || {};

        tools.logger.runtime(`getOrGenerateSheet: Calling LLM (${modelDef.provider}/${modelDef.model})`);
        const response = await tools.llm.runTask({
            msg: 'Character Sheet Generator',
            messages,
            model: modelDef.model,
            provider: modelDef.provider,
            params: {
                retries: settings.retries,
                timeout: settings.timeout,
                min_characters: settings.min_characters || 250,
                callingModule: 'Plugin:character_sheets'
            }
        });

        const sheetContent = response.content;
        tools.logger.runtime(`getOrGenerateSheet: Received response, length=${sheetContent?.length || 0}`);
        const capsule = await parser.parseCharacterSheet(tools, sheetContent, {
            source_file: relativePath, content_hash: contentHash, last_updated_turn: turnContext.turnNumber || 0
        });

        await tools.db.project.execute(
            `INSERT OR REPLACE INTO character_sheets (project_name, character_name, source_file, character_sheet_data, content_hash) VALUES (?, ?, ?, ?, ?)`,
            [projectName, characterName, relativePath, sheetContent, contentHash]
        );
        tools.logger.log('Character Sheets', `Finished generating character sheet for ${characterName}.`);
        return { name: characterName, sheet: sheetContent, capsule, isCached: false };
    } catch (error) {
        tools.logger.runtime(`getOrGenerateSheet: Error: ${error.message}`);
        throw error;
    }
}

async function updateCharacterSheet(turnContext, tools, characterName) {
    const turnNumber = turnContext.turnNumber || 0;
    tools.logger.runtime(`logic: updateCharacterSheet for ${characterName}, turn=${turnNumber}`);
    const currentCapsule = await storage.getCurrentSheet(tools, characterName, turnNumber);
    if (!currentCapsule) {
        tools.logger.runtime(`updateCharacterSheet: No current capsule for ${characterName}`);
        return;
    }

    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, 'full');

    // Smart Fallback: Check which plugins are actually active
    const activeManaged = new Set();
    fields.forEach(f => {
        if (f.behavior && f.behavior.managed_by) {
            // Only treat as managed if the plugin is actually installed/active
            if (tools.plugins.isInstalled(f.behavior.managed_by)) {
                activeManaged.add(f.id);
            }
        }
    });

    // Build current text dynamically
    let currentText = `PYRAMID OF PERSONA: ${characterName}\n\n`;
    currentText += fields.map((f, i) => {
        const rawVal = currentCapsule[f.id] || '';
        const val = cleanCapsuleValue(rawVal);
        const isManaged = activeManaged.has(f.id);
        const isImmutable = f.behavior?.immutable === true;
        const readonly = isManaged ? ' [READ-ONLY]' : '';
        const displayVal = val || (!isManaged && !isImmutable ? '[NEEDS UPDATE]' : '');
        return `LAYER ${i}: ${f.label}${readonly}\n${displayVal}`;
    }).join('\n\n');

    const promptUpdate = await fs.readFile(path.join(__dirname, 'prompts/prompt_update.txt'), 'utf-8');
    const history = await turnContext.getFormattedHistory({ count: 5, tierConfig: { fulltext: 2, summary: 3 } });

    // Replace dynamic placeholders
    // Mutable fields are those NOT immutable AND (NOT managed OR managed but plugin missing)
    const mutableFields = fields.filter(f => !f.behavior?.immutable && !activeManaged.has(f.id));
    const immutableFields = fields.filter(f => f.behavior?.immutable || activeManaged.has(f.id));
    const mutableFieldIds = new Set(mutableFields.map(f => f.id));
    const fieldSizeAdvisory = buildFieldSizeAdvisory(fields, currentCapsule, activeManaged);

    const finalPrompt = promptUpdate
        .replace('{{DYNAMIC_SCHEMA_BRIEF}}', buildUpdateSchemaBrief(fields, activeManaged))
        .replace('{{DYNAMIC_MUTABLE_LIST}}', schemaAdapter.generateList(mutableFields))
        .replace('{{DYNAMIC_IMMUTABLE_LIST}}', schemaAdapter.generateList(immutableFields))
        .replace('{{DYNAMIC_SIZE_ADVISORY}}', fieldSizeAdvisory);

    const messages = [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: `RECENT NARRATIVE HISTORY:\n${history || '(No recent history available.)'}` },
        {
            role: 'user',
            content: [
                `CURRENT CHARACTER SHEET:\n${currentText}`,
                '',
                'TASK:',
                `Update ${characterName}'s mutable character-sheet layers based only on the recent narrative history.`,
                'Use SEARCH/REPLACE patches only. If no mutable layer needs an earned update, output nothing.'
            ].join('\n')
        }
    ];
    const settings = tools.settings.getSelf();
    const rawModelDef = settings.model_def || tools.settings.get().summarizer;
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef || {};
    const useSharedModel = tools.llm.vnBackground?.isSelected?.(rawModelDef) === true;

    tools.logger.log('Character Sheets', `Evolving ${characterName}...`);
    tools.logger.runtime(`updateCharacterSheet: Calling LLM for evolution`);
    const task = {
        msg: 'Character Evolution',
        params: {
            retries: settings.retries,
            timeout: settings.timeout,
            callingModule: 'Plugin:character_sheets:evolution'
        }
    };
    const response = useSharedModel
        ? await tools.llm.vnBackground.call({ ...task, scene: 'raw', suffix: `${finalPrompt}\n\nCURRENT CHARACTER SHEET:\n${currentText}\n\nTASK:\nUpdate ${characterName}'s mutable layers using the shared narrative context. Use SEARCH/REPLACE patches only.` })
        : await tools.llm.runTask({ ...task, messages, model: modelDef.model, provider: modelDef.provider });

    if (!response.content || !response.content.includes('<<<<<<< SEARCH')) {
        tools.logger.runtime(`updateCharacterSheet: No patches found in response for ${characterName}`);
        return;
    }

    tools.logger.runtime(`updateCharacterSheet: Applying patches for ${characterName}`);
    const updatedText = parser.applySearchReplacePatches(currentText, response.content, tools, {
        fields,
        mutableFieldIds
    });
    const newCapsule = await parser.parseCharacterSheet(tools, updatedText, { name: characterName });
    let changeCount = 0;
    for (const f of fields) {
        // Skip read-only fields even if a text patch tried to touch them.
        if (!mutableFieldIds.has(f.id)) continue;

        if (!newCapsule[f.id] || newCapsule[f.id] === currentCapsule[f.id]) continue;
        if (!f.predicate) continue;

        tools.logger.runtime(`updateCharacterSheet: Field ${f.id} changed for ${characterName}`);
        await storage.setFact(tools, characterName.toLowerCase(), characterName, f.predicate, newCapsule[f.id], turnNumber, 'Sheet Evolution');
        changeCount++;
    }
    tools.logger.runtime(`updateCharacterSheet: ${changeCount} fields updated for ${characterName}`);
}

async function updateLightCapsulesBatch(turnContext, tools, windowSize = 5) {
    const turnNumber = turnContext.turnNumber || 0;
    const playerCharacterName = turnContext.input.playerCharacterName;
    const settings = tools.settings.getSelf();

    tools.logger.runtime(`logic: updateLightCapsulesBatch, turn=${turnNumber}, window=${windowSize}`);

    const chapters = await turnContext.getFormattedHistory({
        count: windowSize, skip: 0, tierConfig: { fulltext: 1, summary: windowSize - 1 }
    });
    if (!chapters || chapters.length === 0) {
        tools.logger.runtime(`updateLightCapsulesBatch: No history chapters available`);
        return;
    }

    const activeNames = new Set();
    const history = await turnContext.retrieveDatedChapters();
    const recentTurns = (history.fullchapters || []).slice(-windowSize);

    const fullSheetRows = await tools.db.project.query("SELECT character_name FROM character_sheets");
    const fullSheetNames = new Set(fullSheetRows.map(r => r.character_name.toLowerCase().trim()));

    if (playerCharacterName) {
        const resolvedPlayer = await identity.resolveName(tools, playerCharacterName);
        const lowerPlayer = resolvedPlayer.toLowerCase().trim();
        
        if (!fullSheetNames.has(lowerPlayer)) {
            // Player is lite/capsule-only, so we MUST include them in batch updates
            tools.logger.runtime(`updateLightCapsulesBatch: Including player '${resolvedPlayer}' in batch update (No full sheet found)`);
            activeNames.add(resolvedPlayer);
        } else {
            tools.logger.runtime(`updateLightCapsulesBatch: Skipping player '${resolvedPlayer}' in batch update (Full sheet exists)`);
        }
    }

    for (const turn of recentTurns) {
        if (turn.output && Array.isArray(turn.output.party)) {
            for (const char of turn.output.party) {
                const resolved = await identity.resolveName(tools, char);
                const lower = resolved.toLowerCase().trim();
                
                if (!fullSheetNames.has(lower) && !activeNames.has(resolved)) {
                    let importance = await storage.getCharacterImportance(tools, resolved);
                    if (tools.plugins.isInstalled('character_classifier')) {
                        importance = await getClassifierImportance(turnContext, tools, resolved);
                        if (!isTrackableImportance(importance)) {
                            tools.logger.runtime(`updateLightCapsulesBatch: Skipping '${resolved}' (Classifier importance: ${importance || 'unclassified'})`);
                            continue;
                        }
                    } else if (importance === 'minor' || importance === 'noncharacter') {
                        tools.logger.runtime(`updateLightCapsulesBatch: Skipping '${resolved}' (Importance: ${importance})`);
                        continue;
                    }

                    tools.logger.runtime(`updateLightCapsulesBatch: Adding '${resolved}' to batch update`);
                    activeNames.add(resolved);
                }
            }
        }
    }

    if (activeNames.size === 0) {
        tools.logger.runtime(`updateLightCapsulesBatch: No non-core active characters found for batch update`);
        return;
    }
    const charactersToUpdate = Array.from(activeNames);
    tools.logger.runtime(`updateLightCapsulesBatch: Updating ${charactersToUpdate.length} characters: ${charactersToUpdate.join(', ')}`);

    // Load Schema and get fields based on settings
    const detailInstruction = parser.getDetailInstruction(settings.capsule_detail_level);
    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, settings.capsule_detail_level || 'Medium');
    const predicates = fields.map(f => f.predicate).filter(p => p);

    // Add status/context explicitly if not in schema or handled separately
    predicates.push('CHAR_STATUS');

    const characterData = {};

    for (const name of charactersToUpdate) {
        const lowerName = name.toLowerCase();
        // Construct query dynamically
        const placeholders = predicates.map(() => '?').join(',');
        const rows = await tools.db.chat.query(
            `SELECT predicate, fact_value FROM facts 
             WHERE source = ? AND predicate IN (${placeholders}) 
             AND turn_number <= ? 
             ORDER BY turn_number DESC, id DESC`,
            [lowerName, ...predicates, turnNumber]
        );
        const latestFields = {};
        rows.forEach(row => { if (!latestFields[row.predicate]) latestFields[row.predicate] = row.fact_value; });

        characterData[name] = {};
        fields.forEach(f => {
            if (f.predicate) characterData[name][f.id] = latestFields[f.predicate] || 'N/A';
        });
        characterData[name].status = latestFields['CHAR_STATUS'] || 'ALIVE';
    }

    const promptPath = path.join(__dirname, 'prompts/batch_update_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');

    const characterStateBlocks = charactersToUpdate.map(name => {
        let block = `### ${name}\n`;
        fields.forEach(f => {
            block += `- ${f.label}: ${characterData[name][f.id]}\n`;
        });
        block += `- Status: ${characterData[name].status}`;
        return block;
    }).join('\n');

    const prompt = promptTemplate.replace('${windowSize}', windowSize).replace('${characterStateBlocks}', characterStateBlocks)
        .replace('${chapters}', chapters).replace('${detailInstruction}', detailInstruction)
        .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields))
        .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields))
        .replace('{{DYNAMIC_JSON_STRUCT}}', schemaAdapter.generateJsonStructure(fields));

    const messages = [{ role: 'user', content: prompt }];
    const rawModelDef = settings.model_def || tools.settings.get().summarizer || { model: 'highendmodel' };
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef;

    tools.logger.log('Character Sheets', `Batch updating ${charactersToUpdate.length} light capsules (Turn ${turnNumber}): ${charactersToUpdate.join(', ')}...`);
    tools.logger.runtime(`updateLightCapsulesBatch: Calling LLM for batch update`);
    const response = tools.llm.vnBackground?.isSelected?.(rawModelDef) === true
        ? await tools.llm.vnBackground.json({
            msg: 'Batch Capsule Update',
            suffix: chapters
                ? prompt.replace(chapters, 'Use SELECTED NARRATIVE HISTORY and CURRENT WRITER CHAPTER from the dedicated scene message above.')
                : prompt,
            scene: chapters ? 'raw' : 'none',
            callingModule: 'Plugin:character_sheets:batch_evolution'
        })
        : await tools.llm.json({
            msg: 'Batch Capsule Update',
            messages,
            model: modelDef.model,
            provider: modelDef.provider,
            callingModule: 'Plugin:character_sheets:batch_evolution'
        });

    const parsed = response.content || {};
    const updates = parsed.characters || parsed.updates || [];
    tools.logger.runtime(`updateLightCapsulesBatch: Received ${updates.length} character updates from LLM`);

    for (const update of updates) {
        const charName = update.name;
        if (!charName) continue;
        const lowerName = charName.toLowerCase();
        const current = characterData[charName] || {};

        tools.logger.runtime(`updateLightCapsulesBatch: Processing update for ${charName}`);
        for (const f of fields) {
            if (!f.predicate) continue;
            const newVal = update[f.id];
            const oldVal = current[f.id];

            if (newVal && newVal !== oldVal && newVal !== 'N/A' && newVal !== `[${f.label}]`) {
                tools.logger.runtime(`updateLightCapsulesBatch: Updating field ${f.id} for ${charName}`);
                await storage.setFact(tools, lowerName, charName, f.predicate, newVal, turnNumber, 'Batch Evolution');
                if (f.id === 'biography' || f.id === 'brief') await storage.syncSocialRegistry(tools, charName, newVal);
            }
        }

        if (update.status && update.status !== current.status) {
            tools.logger.runtime(`updateLightCapsulesBatch: Updating status for ${charName}: ${update.status}`);
            await storage.setFact(tools, lowerName, charName, 'CHAR_STATUS', update.status, turnNumber, 'Batch Evolution');
        }
    }
}

async function processCoreSheetsHook(turnContext, tools) {
    // Autodetect mistakenly classified full files that are actually character sheets
    for (const f of turnContext.input.selectedFiles) {
        if (f.mode === 'full' && f.path.endsWith('.md')) {
            try {
                const content = await fs.readFile(f.path, 'utf-8');
                if (content.includes('PYRAMID OF PERSONA:')) {
                    tools.logger.runtime(`processCoreSheetsHook: Auto-detected 'PYRAMID OF PERSONA' in ${f.path}. Changing mode to charsheet.`);
                    f.mode = 'charsheet';
                }
            } catch { }
        }
    }

    const files = turnContext.input.selectedFiles.filter(f => f.mode === 'charsheet');
    const isTurnOne = (turnContext.turnNumber === 1);

    tools.logger.runtime(`logic: processCoreSheetsHook, turn=${turnContext.turnNumber}, selectedFiles=${files.length}`);

    const turnState = tools.pluginState.turn();
    turnState.character_sheets = { sheets: [] };
    turnContext.processed.proactiveMajorCharacters = [];

    if (files.length === 0 && !isTurnOne) {
        tools.logger.runtime(`processCoreSheetsHook: No character sheets to process`);
        return;
    }

    tools.status.hook(`Processing ${files.length} character sheets...`);
    tools.logger.log('Character Sheets', `Processing ${files.length} character sheets from files...`);
    const promptTemplate = await fs.readFile(path.join(__dirname, 'prompts/prompt.txt'), 'utf-8');

    const sheetPromises = files.map(async (file) => {
        const result = await getOrGenerateSheet(turnContext, tools, file, promptTemplate);
        if (result?.capsule) {
            const hasExisting = await storage.hasBootstrappedFacts(tools, result.name);
            if (!result.isCached || !hasExisting) {
                tools.logger.runtime(`processCoreSheetsHook: Bootstrapping ${result.name}`);
                await storage.bootstrapCharacterSheet(tools, result.capsule, turnContext.turnNumber || 0);
            } else {
                tools.logger.runtime(`processCoreSheetsHook: Skipping bootstrap for ${result.name} (cached and already bootstrapped)`);
            }
        }
        return result;
    });

    const results = (await Promise.all(sheetPromises)).filter(r => r !== null);
    tools.logger.runtime(`processCoreSheetsHook: Processed ${results.length} sheets`);
    turnState.character_sheets.sheets = results;
}

async function ensurePlayerCapsule(turnContext, tools) {
    // Clear bio from input so it doesn't get double injected by other systems
    const rawBio = turnContext.input.playerCharacterBio;
    turnContext.input.playerCharacterBio = null;

    const metadata = await tools.project.getMetadata();
    const playerMetadata = metadata.player || {};
    const playerName = playerMetadata.name || turnContext.input.playerCharacterName;
    const playerBio = playerMetadata.bio || rawBio || '';

    if (!playerName || playerName === 'None' || playerName === 'Player') {
        tools.logger.log('Lifecycle', 'No specific player character name set. Skipping player capsule checks.');
        return;
    }

    tools.logger.runtime(`ensurePlayerCapsule: Checking player '${playerName}'`);

    // First check if the player is already fully managed by a file this turn
    const selectedSheetNames = new Set((tools.pluginState.forPlugin('character_sheets').turn().sheets || []).map(s => s.name.toLowerCase().trim()));
    if (selectedSheetNames.has(playerName.toLowerCase().trim())) {
        tools.logger.runtime(`ensurePlayerCapsule: Player '${playerName}' is loaded via full sheet. Setting IS_PLAYER and skipping Lite generation.`);
        await tools.facts.appendToFactsDb({
            source: playerName.toLowerCase().trim(),
            target: 'self',
            predicate: 'IS_PLAYER',
            fact_value: 'true',
            context: 'Character Sheet System: Registration'
        });
        return;
    }

    // 1. Check if ANY capsule data exists, respecting timeline
    const rows = await tools.db.chat.query(
        `SELECT 1 FROM facts WHERE source = ? AND (predicate LIKE 'CHAR_SHEET:%' OR predicate = 'IS_PLAYER') AND turn_number <= ? LIMIT 1`,
        [playerName.toLowerCase(), turnContext.turnNumber || 0]
    );

    let isNewCapsule = rows.length === 0;

    if (isNewCapsule) {
        tools.logger.log('Character Sheets', `Creating new capsule for player ${playerName}...`);

        if (playerBio && playerBio.trim().length > 0) {
            tools.logger.runtime(`ensurePlayerCapsule: Saving raw bio directly to database for ${playerName}`);
            const tNum = turnContext.turnNumber || 0;
            const lowName = playerName.toLowerCase().trim();
            const canonName = playerName.trim();

            // Write the core facts directly to ensure persistence and bypass LLM conversion
            await tools.facts.appendToFactsDb({
                source: lowName,
                target: 'self',
                predicate: 'IS_PLAYER',
                fact_value: 'true',
                context: 'Character Sheet System: Player Sync'
            });
            await tools.facts.appendToFactsDb({
                source: lowName,
                target: canonName,
                predicate: 'IMPORTANCE',
                fact_value: 'CORE',
                context: 'Character Sheet System: Player Sync'
            });
            await tools.facts.appendToFactsDb({
                source: lowName,
                target: canonName,
                predicate: 'CHAR_SHEET:BIOGRAPHY',
                fact_value: playerBio.trim(),
                context: 'Character Sheet System: Player Sync'
            });
            await tools.facts.appendToFactsDb({
                source: lowName,
                target: 'self',
                predicate: 'CHAR_SHEET:FIRST_APPEARED',
                fact_value: tNum.toString(),
                context: 'Character Sheet System: Player Sync'
            });

            // Sync to vector DB immediately so memory recognizes it
            await storage.syncSocialRegistry(tools, canonName, playerBio.trim());
        } else {
            // Fallback to text synthesis only if absolutely necessary (e.g. they only have a name)
            await createOrUpdateCapsuleFromText(turnContext, tools, playerName, '', {
                isPlayer: true,
                importance: 'CORE'
            });
        }

    } else {
        // Ensure IS_PLAYER fact exists for legacy players or manual edits
        const playerCheck = await tools.db.chat.query(
            `SELECT 1 FROM facts WHERE source = ? AND predicate = 'IS_PLAYER' AND turn_number <= ? LIMIT 1`,
            [playerName.toLowerCase(), turnContext.turnNumber || 0]
        );
        if (playerCheck.length === 0) {
            await tools.facts.appendToFactsDb({
                source: playerName.toLowerCase().trim(),
                target: 'self',
                predicate: 'IS_PLAYER',
                fact_value: 'true',
                context: 'Character Sheet System: Registration (Sync)'
            });
        }
    }
}

async function handleNewCharactersHook(turnContext, tools) {
    const newCharacters = turnContext.processed.newlyIntroducedCharacters || [];
    tools.logger.runtime(`logic: handleNewCharactersHook, newlyIntroducedCharacters=${newCharacters.length}`);
    if (newCharacters.length === 0) return;

    const namesToGenerate = [];
    for (const charName of newCharacters) {
        const resolved = await identity.resolveName(tools, charName);
        const charKey = resolved.toLowerCase();

        if (tools.plugins.isInstalled('character_classifier')) {
            const importance = await getClassifierImportance(turnContext, tools, resolved);
            tools.logger.runtime(`handleNewCharactersHook: Character ${resolved} classifier importance=${importance || 'unclassified'}`);
            if (!isTrackableImportance(importance)) {
                tools.logger.runtime(`handleNewCharactersHook: Skipping capsule generation for '${resolved}' because classifier did not accept it as trackable.`);
                continue;
            }
        }

        const inContext = tools.pluginState.forPlugin('character_sheets').turn().sheets?.some(s => s.name.toLowerCase() === charKey);
        const inFacts = await storage.getCurrentSheet(tools, resolved, turnContext.turnNumber);

        if (inContext || inFacts) {
            tools.logger.runtime(`handleNewCharactersHook: Character ${resolved} already exists, updating appearance`);
            await storage.updateAppearanceMetadata(tools, resolved, turnContext.turnNumber || 0);
            continue;
        }
        namesToGenerate.push(resolved);
    }

    if (namesToGenerate.length > 0) {
        const uniqueNames = Array.from(new Set(namesToGenerate));
        tools.logger.log('Character Sheets', `Batch generating light capsules for newly introduced: ${uniqueNames.join(', ')}...`);
        const results = await discovery.batchGenerateLightCapsules(turnContext, tools, uniqueNames);

        if (results && results.length > 0 && tools.plugins.isInstalled('world_location_tracker')) {
            tools.logger.runtime(`handleNewCharactersHook: Bootstrapping locations for ${results.length} characters`);
            const loreContext = turnContext.processed?.dialogueProcessor?.dialogue || turnContext.output?.fulltext || "";
            tools.plugins.call('world_location_tracker', 'bootstrapCharacterLocations', results, loreContext);
        }
    }
}

async function handleEvolutionHook(turnContext, tools) {
    const settings = tools.settings.getSelf();
    const frequency = settings.update_frequency || 1;
    const turnNumber = turnContext.turnNumber || 0;
    const pcName = turnContext.input.playerCharacterName;

    // Filter out PC if they have a full sheet file? 
    // Actually, `updateCharacterSheet` relies on a file-based full sheet (it loads 'character_sheets' table).
    // So for the Player, if they are Lite-Only, we want them in `updateLightCapsulesBatch` (handled above), NOT `updateCharacterSheet`.
    // So we filter pcName OUT of the 'full sheet evolution' list `active` below, but ensure they are caught by batch update above.
    // The previous implementation of `active` was strictly for `updateCharacterSheet`.

    const party = turnContext.output.party || [];
    const trackedParty = [];
    for (const charName of party) {
        if (tools.plugins.isInstalled('character_classifier')) {
            const resolved = await identity.resolveName(tools, charName);
            const importance = await getClassifierImportance(turnContext, tools, resolved);
            if (!isTrackableImportance(importance)) {
                tools.logger.runtime(`handleEvolutionHook: Skipping '${resolved}' because classifier importance is ${importance || 'unclassified'}.`);
                continue;
            }
        }
        trackedParty.push(charName);
    }

    const active = trackedParty.filter(c => c !== pcName);
    tools.logger.runtime(`logic: handleEvolutionHook, turn=${turnNumber}, activeParty=${active.length}`);

    // Update metadata for all active characters including player
    const allActive = trackedParty;
    await Promise.all(allActive.map(c => storage.updateAppearanceMetadata(tools, c, turnNumber)));

    if (turnNumber > 0 && turnNumber % frequency === 0) {
        tools.logger.log('Character Sheets', `Evolving active characters (Turn ${turnNumber})...`);
        tools.logger.runtime(`handleEvolutionHook: Frequency reached (${frequency}), triggering evolution`);

        // Evolve Full Sheets
        if (active.length > 0) {
            await Promise.all(active.map(c => updateCharacterSheet(turnContext, tools, c)));
        }

        // Evolve Light Capsules (includes Player if applicable)
        await updateLightCapsulesBatch(turnContext, tools, frequency);
    }
}

async function getRelevantCharacters(turnContext, tools, limit = 6) {
    const playerChar = turnContext.input.playerCharacterName || 'Player';
    const turnNumber = turnContext.turnNumber || 0;
    const scores = new Map();

    (turnContext.output.party || []).forEach(c => {
        if (c !== playerChar) scores.set(c.toLowerCase(), 10000);
    });

    const history = await turnContext.retrieveDatedChapters();
    const recentTurns = (history.fullchapters || []).slice(-3).reverse();
    recentTurns.forEach((turn, index) => {
        const score = 5000 - (index * 1000);
        if (turn.output && Array.isArray(turn.output.party)) {
            turn.output.party.forEach(char => {
                const lowChar = char.toLowerCase();
                if (char !== playerChar && !scores.has(lowChar)) {
                    scores.set(lowChar, Math.max(scores.get(lowChar) || 0, score));
                }
            });
        }
    });

    if (tools.plugins.isInstalled('world_location_tracker')) {
        try {
            const allLocs = await tools.plugins.call('world_location_tracker', 'getAllCharacterLocations', turnContext);
            const myLoc = await tools.plugins.call('world_location_tracker', 'getCharacterLocation', playerChar, { turnNumber });
            if (myLoc && allLocs) {
                const myAnchor = (myLoc.anchor_node || myLoc.specific_location || "").toLowerCase();
                if (myAnchor) {
                    allLocs.forEach(loc => {
                        const charAnchor = (loc.anchorNode || loc.specificLocation || "").toLowerCase();
                        if (charAnchor === myAnchor && loc.name.toLowerCase() !== playerChar.toLowerCase()) {
                            const low = loc.name.toLowerCase();
                            scores.set(low, Math.max(scores.get(low) || 0, 8000));
                        }
                    });
                }
            }
        } catch (e) {
            tools.logger.warn('getRelevantCharacters', `Failed spatial relevancy check: ${e.message}`);
        }
    }

    const thematic = await storage.searchSocialRegistry(turnContext, tools);
    tools.logger.runtime(`getRelevantCharacters: Social registry search returned ${thematic.length} thematic matches`);
    thematic.forEach(res => {
        const low = res.name.toLowerCase();
        if (low !== playerChar.toLowerCase()) {
            scores.set(low, Math.max(scores.get(low) || 0, 7000));
        }
    });

    if (turnNumber === 1 && turnContext.processed.proactiveMajorCharacters) {
        tools.logger.runtime(`getRelevantCharacters: Including ${turnContext.processed.proactiveMajorCharacters.length} proactive major characters`);
        turnContext.processed.proactiveMajorCharacters.forEach(char => {
            const lowChar = char.name.toLowerCase();
            if (!scores.has(lowChar)) scores.set(lowChar, 500);
        });
    }

    if (scores.size < limit * 2) {
        try {
            const recentRows = await tools.db.chat.query(
                `SELECT source, CAST(fact_value AS INTEGER) as last_seen 
                 FROM facts 
                 WHERE predicate = 'CHAR_SHEET:LAST_APPEARED' 
                 AND turn_number <= ?
                 ORDER BY last_seen DESC LIMIT ?`,
                [turnNumber, limit * 3]
            );
            recentRows.forEach((row, index) => {
                const low = row.source.toLowerCase();
                if (low !== playerChar.toLowerCase()) {
                    const score = 2000 - (index * 50);
                    if (!scores.has(low)) {
                        scores.set(low, score);
                    }
                }
            });
        } catch (e) {
            tools.logger.warn('getRelevantCharacters', `Failed to fallback to recent characters: ${e.message}`);
        }
    }

    const selectedSheetNames = new Set((tools.pluginState.forPlugin('character_sheets').turn().sheets || []).map(s => s.name.toLowerCase()));

    const candidates = Array.from(scores.entries())
        .filter(([name]) => !selectedSheetNames.has(name))
        .sort((a, b) => b[1] - a[1]);

    const topCandidates = candidates.slice(0, limit);
    return topCandidates.map(([name]) => name);
}

async function handlePromptInjectionHook(turnContext, tools) {
    tools.logger.runtime('logic: handlePromptInjectionHook');
    // 1. Run the Proactive Discovery (from the previous fix)
    if (typeof handleProactiveDiscovery === 'function') {
        await handleProactiveDiscovery(turnContext, tools);
    }

    const playerChar = turnContext.input.playerCharacterName || 'Player';
    const turnNumber = turnContext.turnNumber || 0;

    const limit = tools.settings.getSelf().light_capsule_limit ?? 6;
    const candidateNames = await getRelevantCharacters(turnContext, tools, limit);

    tools.logger.runtime(`handlePromptInjectionHook: Total candidates for injection: ${candidateNames.length}`);

    let contextBlocks = '';
    const handled = new Set();

    // === PLAYER INJECTION HANDLING ===
    // Check if Player has a full sheet loaded this turn
    const selectedSheetNames = new Set((tools.pluginState.forPlugin('character_sheets').turn().sheets || []).map(s => s.name.toLowerCase().trim()));
    const playerIsFullSheet = selectedSheetNames.has(playerChar.toLowerCase().trim());

    if (!playerIsFullSheet) {
        tools.logger.runtime(`handlePromptInjectionHook: Injecting player capsule (Lite Mode)`);

        // Fetch latest capsule data
        const capsule = await storage.getCurrentSheet(tools, playerChar, turnNumber);

        if (capsule) {
            const sections = [];

            // Build text dynamically based on what exists
            const briefSection = formatBriefSection(capsule.brief || capsule.biography);
            if (briefSection) sections.push(briefSection);

            // Add other fields from schema if available
            const schema = await schemaAdapter.loadSchema();
            const fields = schemaAdapter.getFields(schema, 'full'); // Use full fields for player

            fields.forEach((f, i) => {
                if (f.id === 'biography' || f.id === 'brief') return;
                const section = formatCapsuleSection(f, capsule[f.id], { index: i });
                if (section) sections.push(section);
            });

            const capsuleText = [
                `PLAYER CHARACTER: ${playerChar} (Exclusively player-controlled)`,
                sections.join('\n\n')
            ].filter(Boolean).join('\n\n');

            contextBlocks += tools.prompt.wrap('sheet', capsuleText.trim(), { name: playerChar, type: 'player', persistence: 'sticky' }) + '\n';
        }
    }
    handled.add(playerChar.toLowerCase());
    // =================================

    // Inject Full Sheets
    const coreSheets = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];
    tools.logger.runtime(`handlePromptInjectionHook: Injecting ${coreSheets.length} core sheets`);

    // Optimization: Fetch integrated data ONCE for all characters
    const integratedData = await storage.getIntegratedCharacterData(tools, turnNumber);

    // Load schema for dynamic injection
    const schema = await schemaAdapter.loadSchema();
    const fullFields = schemaAdapter.getFields(schema, 'full');
    const settings = tools.settings.getSelf();
    const detailLevel = settings.capsule_detail_level || 'Medium';
    const liteFields = schemaAdapter.getFields(schema, detailLevel);
    const hardFields = fullFields.filter(isHardPriorityField);
    const hardPriorityEntries = new Map();

    if (!playerIsFullSheet) {
        const playerCapsule = await storage.getCurrentSheet(tools, playerChar, turnNumber);
        if (playerCapsule) addHardPriorityEntries(hardPriorityEntries, playerChar, playerCapsule, hardFields);
    }

    for (const item of coreSheets) {
        handled.add(item.name.toLowerCase());
        const char = integratedData.find(c => c.name.toLowerCase() === item.name.toLowerCase());

        if (char && char.capsule) {
            tools.logger.runtime(`handlePromptInjectionHook: Constructing display sheet for ${item.name}`);
            const isPlayer = item.name.toLowerCase() === playerChar.toLowerCase();
            const playerRule = isPlayer ? `(PLAYER CHARACTER: Exclusively player-controlled. Track metrics/state only.)\n` : '';

            const displaySections = [];

            fullFields.forEach((f, i) => {
                const section = formatCapsuleSection(f, char.capsule[f.id], { index: i });
                if (section) displaySections.push(section);
            });

            const displaySheet = [
                `PYRAMID OF PERSONA: ${item.name}`,
                playerRule.trim(),
                displaySections.join('\n\n')
            ].filter(Boolean).join('\n\n');

            addHardPriorityEntries(hardPriorityEntries, item.name, char.capsule, hardFields);

            contextBlocks += tools.prompt.wrap('sheet', displaySheet.trim(), { name: item.name }) + '\n';
        }
    }

    // Inject Light Capsules
    tools.logger.runtime(`handlePromptInjectionHook: Injecting ${candidateNames.length} light capsules (Limit: ${limit})`);
    for (const charKey of candidateNames) {
        const canonicalName = charKey.charAt(0).toUpperCase() + charKey.slice(1);
        if (handled.has(charKey)) continue; // Skip if already handled (e.g. player)

        const char = integratedData.find(c => c.name.toLowerCase() === charKey);
        const capsule = char ? char.capsule : null;

        if (capsule) {
            tools.logger.runtime(`handlePromptInjectionHook: Injecting light capsule for ${canonicalName}`);
            const sections = [];

            const briefSection = formatBriefSection(capsule.brief || capsule.biography);
            if (briefSection) sections.push(briefSection);

            liteFields.forEach(f => {
                if (f.id === 'biography' || f.id === 'brief') return;
                const section = formatCapsuleSection(f, capsule[f.id]);
                if (section) sections.push(section);
            });

            const light = [
                `CHARACTER CAPSULE: ${canonicalName.toUpperCase()}`,
                sections.join('\n\n')
            ].filter(Boolean).join('\n\n');

            addHardPriorityEntries(hardPriorityEntries, canonicalName, capsule, hardFields);
            contextBlocks += tools.prompt.wrap('light_capsule', light.trim(), { name: canonicalName }) + '\n';
            handled.add(charKey);
        }
    }



    tools.logger.runtime(`handlePromptInjectionHook: Injecting final context blocks, total length=${contextBlocks.length}`);
    const cleanedBlocks = contextBlocks.replace(/^#+\s*/gm, '');
    tools.prompt.inject('canon', tools.prompt.wrap('character_sheets', cleanedBlocks.trim()), 'root');

    const hardDirective = buildHardPriorityDirective(hardPriorityEntries);
    if (hardDirective) {
        tools.prompt.inject('directives', tools.prompt.wrap('character_sheet_hard_priority', hardDirective), 'writer');
    }

    const turnState = tools.pluginState.turn();
    if (!turnState.character_sheets || typeof turnState.character_sheets !== 'object') turnState.character_sheets = {};
    turnState.character_sheets.activeCharacters = Array.from(handled);
}

// ... handleProactiveDiscovery (same as before but calls discovery) ...
async function handleProactiveDiscovery(turnContext, tools) {
    const turnNumber = turnContext.turnNumber || 0;
    if (turnNumber !== 1) return;

    const castFiles = turnContext.input.selectedFiles.filter(f => f.mode === 'cast_list');
    const coreSheets = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];
    const canon = (turnContext.promptComponents.root.canon || []).join('\n').trim();

    tools.logger.runtime(`logic: handleProactiveDiscovery, castFiles=${castFiles.length}, coreSheets=${coreSheets.length}`);

    if (castFiles.length > 0 || coreSheets.length > 0) {
        tools.status.hook(`Discovering supporting characters...`);
        try {
            // Prepare exclusion list for cast file processing (Player + Core Characters)
            const playerChar = turnContext.input.playerCharacterName;
            const coreNamesSet = new Set(coreSheets.map(s => s.name));
            if (playerChar && playerChar !== 'None') coreNamesSet.add(playerChar);
            const excludedNames = Array.from(coreNamesSet);

            const castResultsPromise = (async () => {
                if (castFiles.length === 0) return [];
                tools.logger.runtime(`handleProactiveDiscovery: Processing ${castFiles.length} cast files`);
                const castPromises = castFiles.map(async (file) => {
                    try {
                        return await discovery.processSupportingCastFile(turnContext, tools, file, canon, excludedNames);
                    } catch (e) {
                        tools.logger.runtime(`handleProactiveDiscovery: Error processing cast file ${file.path}: ${e.message}`);
                        return [];
                    }
                });
                return (await Promise.all(castPromises)).flat();
            })();

            // Wait for cast results to complete so we can filter them from mentions
            const castResults = await castResultsPromise;

            const mentionedResultsPromise = (async () => {
                if (coreSheets.length === 0) return [];
                tools.logger.runtime(`handleProactiveDiscovery: Extracting mentioned names from core sheets`);
                const mentionedNames = await discovery.extractMentionedNames(tools, coreSheets);
                const coreNamesLower = new Set(coreSheets.map(s => s.name.toLowerCase()));
                if (playerChar) coreNamesLower.add(playerChar.toLowerCase());

                const candidates = mentionedNames.filter(name => !coreNamesLower.has(name.toLowerCase()));

                // Add names found in cast files to exclusion
                const castNamesLower = new Set(castResults.map(c => c.name.toLowerCase()));
                const finalCandidates = candidates.filter(name => !castNamesLower.has(name.toLowerCase()));

                if (finalCandidates.length > 0) {
                    tools.logger.runtime(`handleProactiveDiscovery: Found ${finalCandidates.length} candidates for proactive generation`);
                    return await discovery.proactiveBatchGeneration(turnContext, tools, finalCandidates, coreSheets, canon);
                }
                return [];
            })();

            const mentionedResults = await mentionedResultsPromise;
            const allProactive = [...castResults, ...mentionedResults];
            tools.logger.runtime(`handleProactiveDiscovery: Total proactive characters discovered: ${allProactive.length}`);

            if (allProactive.length > 0) {
                const coreNames = new Set(coreSheets.map(s => s.name.toLowerCase()));
                const uniqueProactive = await identity.dedupeAndMergeCharacters(tools, allProactive, coreNames);
                const schema = await schemaAdapter.loadSchema();
                const fields = schemaAdapter.getFields(schema, 'full');

                tools.logger.runtime(`handleProactiveDiscovery: Bootstrapping ${uniqueProactive.length} unique proactive characters`);
                for (const major of uniqueProactive) {
                    if (isLikelyGarbageEntityName(major.name)) {
                        tools.logger.runtime(`handleProactiveDiscovery: Skipping likely garbage proactive entry '${major.name}'.`);
                        continue;
                    }

                    const lowerName = major.name.toLowerCase();

                    // Bootstrap facts using schema
                    const entries = [
                        { pred: 'IMPORTANCE', val: 'MAJOR' },
                        { pred: 'CHAR_STATUS', val: major.status || 'ALIVE' }
                    ];

                    fields.forEach(f => {
                        if (f.predicate && major[f.id]) entries.push({ pred: f.predicate, val: major[f.id] });
                    });

                    // Explicitly add BRIEF for compatibility if a field is flagged as such in schema
                    const briefField = fields.find(f => f.use_as_brief);
                    if (briefField && major[briefField.id]) {
                        entries.push({ pred: 'CHAR_SHEET:BRIEF', val: major[briefField.id] });
                    }

                    for (const field of entries) {
                        if (field.val) {
                            await storage.setFact(tools, lowerName, major.name, field.pred, field.val, turnNumber, 'Turn 1 Proactive');
                        }
                    }

                    if (major.biography) await storage.syncSocialRegistry(tools, major.name, major.biography);

                    if (!turnContext.processed.proactiveMajorCharacters) turnContext.processed.proactiveMajorCharacters = [];
                    turnContext.processed.proactiveMajorCharacters.push(major);
                }

                if (tools.plugins.isInstalled('world_location_tracker')) {
                    tools.logger.runtime(`handleProactiveDiscovery: Bootstrapping locations for ${uniqueProactive.length} proactive characters`);
                    await tools.plugins.call('world_location_tracker', 'bootstrapCharacterLocations', uniqueProactive, canon);
                }
            }
        } catch (error) {
            tools.logger.runtime(`handleProactiveDiscovery: Unexpected error: ${error.message}`);
            console.error(error);
        }
    }
}

async function createOrUpdateCapsuleFromText(turnContext, tools, charName, text, options = {}) {
    const { isPlayer = false, importance = 'LITE' } = options;
    const turnNumber = turnContext.turnNumber || 0;
    const lowerName = charName.toLowerCase();
    tools.logger.runtime(`logic: createOrUpdateCapsuleFromText for ${charName}, isPlayer=${isPlayer}, importance=${importance}`);

    try {
        let capsuleData = text;
        const isStructured = text.includes('PYRAMID OF PERSONA') || text.includes('[BRIEF]') || text.includes('### CHARACTER CAPSULE');

        if (!isStructured) {
            tools.logger.runtime(`createOrUpdateCapsuleFromText: Text for ${charName} is unstructured, calling LLM to synthesize`);
            const promptPath = path.join(__dirname, 'prompts/prompt.txt');
            const promptTemplate = await fs.readFile(promptPath, 'utf-8');

            const schema = await schemaAdapter.loadSchema();
            const fields = schemaAdapter.getFields(schema, 'full');
            const dynamicSchemaText = schemaAdapter.generatePromptSchema(fields);

            const messages = [{ role: 'system', content: promptTemplate.replace('{{DYNAMIC_SCHEMA}}', dynamicSchemaText) }, { role: 'user', content: `Character Name: ${charName}\n\nRecent Narrative Summary:\n${text}` }];
            const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
            const rawModelDef = settings.model_def || settings.narrative_agents?.summarizer || { model: 'highendmodel' };
            const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef;
            const response = await tools.llm.runTask({
                msg: 'Text to Capsule Conversion',
                messages,
                model: modelDef.model,
                provider: modelDef.provider,
                callingModule: 'Plugin:character_sheets:text_to_capsule'
            });
            capsuleData = response.content;
        }

        let capsule;
        if (capsuleData.includes('PYRAMID OF PERSONA')) capsule = await parser.parseCharacterSheet(tools, capsuleData, { name: charName });
        else {
            capsule = await parser.parseCharacterSheet(tools, capsuleData, { name: charName });
        }

        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, 'full');

        const entries = [];
        fields.forEach(f => {
            if (f.predicate && capsule[f.id]) entries.push({ predicate: f.predicate, value: capsule[f.id] });
        });
        entries.push({ predicate: 'CHAR_STATUS', value: 'ALIVE' });

        // Explicitly add BRIEF for compatibility if a field is flagged as such in schema
        const briefField = fields.find(f => f.use_as_brief);
        if (briefField && capsule[briefField.id]) {
            entries.push({ predicate: 'CHAR_SHEET:BRIEF', value: capsule[briefField.id] });
        }

        if (isPlayer) { entries.push({ predicate: 'IMPORTANCE', value: 'CORE' }); entries.push({ predicate: 'IS_PLAYER', value: 'true' }); }
        else entries.push({ predicate: 'IMPORTANCE', value: importance });

        tools.logger.runtime(`createOrUpdateCapsuleFromText: Persisting ${entries.length} facts for ${charName}`);
        let finalBrief = capsule.biography; // Initialize with biography
        for (const entry of entries) {
            if (entry.value !== undefined && entry.value !== '') {
                await storage.setFact(tools, lowerName, charName, entry.predicate, entry.value, turnNumber, 'Player/Lite Gen');
                if (entry.predicate === 'CHAR_SHEET:BIOGRAPHY' || entry.predicate === 'CHAR_SHEET:BRIEF') {
                    finalBrief = entry.value; // Update finalBrief if a more specific brief/biography is found
                }
            }
        }
        if (finalBrief) await storage.syncSocialRegistry(tools, charName, finalBrief);
        return capsule;
    } catch (error) {
        tools.logger.runtime(`createOrUpdateCapsuleFromText: Error for ${charName}: ${error.message}`);
        return null;
    }
}

/**
 * Hook handler for the capsule auditor.
 * Checks settings and turn frequency before running the audit.
 */
async function handleCapsuleAuditHook(turnContext, tools) {
    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    if (settings.enable_capsule_auditor === false) {
        tools.logger.runtime('handleCapsuleAuditHook: Capsule Auditor is disabled.');
        return;
    }

    const frequency = settings.auditor_frequency || 10;
    const turnNumber = turnContext.turnNumber || 0;

    if (turnNumber < frequency || turnNumber % frequency !== 0) {
        tools.logger.runtime(`handleCapsuleAuditHook: Skipping (turn ${turnNumber}, frequency ${frequency})`);
        return;
    }

    tools.logger.log('Character Sheets', `Capsule Auditor triggered on turn ${turnNumber}`);
    tools.status.show('Auditing character capsules...');

    try {
        const result = await auditor.runCapsuleAudit(turnContext, tools);
        if (result.flagged > 0) {
            tools.logger.log('Character Sheets', `Capsule Auditor: Flagged ${result.flagged} junk entries: ${result.names.join(', ')}`);
        }
    } catch (error) {
        tools.logger.error('CapsuleAuditor', `Audit failed: ${error.message}`);
    }
}

module.exports = {
    processCoreSheetsHook, handleNewCharactersHook, handleEvolutionHook, handlePromptInjectionHook,
    handleCapsuleAuditHook,
    getRelevantCharacters,
    ensurePlayerCapsule,
    getOrGenerateSheet, updateCharacterSheet, updateLightCapsulesBatch,
    batchGenerateLightCapsules: async (ctx, t, names) => discovery.batchGenerateLightCapsules(ctx, t, names),
    createOrUpdateCapsuleFromText,
    generateLightCapsule: discovery.generateLightCapsule,
    getAllCharacters: storage.getAllCharacters, getIntegratedCharacterData: storage.getIntegratedCharacterData,
    getCurrentSheet: storage.getCurrentSheet, syncSocialRegistry: storage.syncSocialRegistry,
    searchSocialRegistry: storage.searchSocialRegistry, bootstrapCharacterSheet: storage.bootstrapCharacterSheet,
    updateAppearanceMetadata: storage.updateAppearanceMetadata
};
