// plugins/personality_tracker/logic.js

const fs = require('fs/promises');
const path = require('path');

// Load schema.json synchronously at startup
let SCHEMA = null;
let TRAIT_IDS = [];
let PERSONALITY_PREDICATES = ['personality_origin', 'personality_history_summary'];

function loadSchema() {
    try {
        const schemaPath = path.join(__dirname, 'schema.json');
        const data = require(schemaPath);
        SCHEMA = data;
        if (SCHEMA && SCHEMA.traits) {
            TRAIT_IDS = SCHEMA.traits.map(t => t.predicate);
            // Combine system predicates with trait predicates
            PERSONALITY_PREDICATES = [...TRAIT_IDS, 'personality_origin', 'personality_history_summary'];
        }
    } catch (error) {
        console.error('Failed to load personality schema:', error);
        // Fallback or keep defaults
    }
}

loadSchema();

const RELATIONSHIP_OWNED_RECALL_KINDS = new Set([
    'admiration',
    'attraction',
    'attraction_catalyst',
    'compliment',
    'crush',
    'interpretive_bias',
    'physical_detail',
    'relationship',
    'value_alignment'
]);

function normalizeRecallText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeRecallKey(value) {
    return normalizeRecallText(String(value || '')).toLowerCase();
}

function clampRecallNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function normalizeRecallDurability(value) {
    const raw = normalizeRecallKey(value);
    if (raw === 'stable' || raw === 'situational' || raw === 'transient') return raw;
    return 'situational';
}

function getRecallDurabilityRank(durability) {
    if (durability === 'stable') return 2;
    if (durability === 'situational') return 1;
    return 0;
}

function filterPersonalityRecallCandidates(rawCandidates, targetCharacters, settings = {}) {
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) return [];

    const maxTotal = Math.floor(clampRecallNumber(settings.recall_max_per_turn, 0, 20, 3));
    const maxPerCharacter = Math.floor(clampRecallNumber(settings.recall_max_per_character, 0, 10, 1));
    const minSalience = Math.floor(clampRecallNumber(settings.recall_min_salience, 1, 10, 7));
    if (maxTotal <= 0 || maxPerCharacter <= 0) return [];

    const targetSet = new Set((targetCharacters || []).map(normalizeRecallKey).filter(Boolean));
    const dedupe = new Set();
    const eligible = [];

    for (const raw of rawCandidates) {
        if (!raw || typeof raw !== 'object') continue;

        const character = normalizeRecallKey(raw.character || raw.source || raw.name);
        if (!character || (targetSet.size > 0 && !targetSet.has(character))) continue;

        const target = normalizeRecallKey(raw.target);
        if (target) continue;

        const kind = normalizeRecallKey(raw.kind || 'preference').slice(0, 64) || 'preference';
        if (RELATIONSHIP_OWNED_RECALL_KINDS.has(kind)) continue;

        const memory = normalizeRecallText(raw.memory || raw.text || raw.statement);
        if (memory.length < 18) continue;

        const durability = normalizeRecallDurability(raw.durability);
        if (durability === 'transient') continue;

        const salience = Math.round(clampRecallNumber(raw.salience, 1, 10, 5));
        if (salience < minSalience) continue;
        if (durability === 'situational' && salience < Math.min(10, minSalience + 1)) continue;

        const key = `${character}|${kind}|${memory.toLowerCase()}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);

        eligible.push({
            ...raw,
            character,
            kind,
            memory,
            salience,
            durability,
            _personalityRecallRank: (salience * 10) + getRecallDurabilityRank(durability)
        });
    }

    eligible.sort((a, b) => b._personalityRecallRank - a._personalityRecallRank);

    const perCharacterCounts = new Map();
    const selected = [];
    for (const item of eligible) {
        const count = perCharacterCounts.get(item.character) || 0;
        if (count >= maxPerCharacter) continue;

        const cleanItem = { ...item };
        delete cleanItem._personalityRecallRank;
        selected.push(cleanItem);
        perCharacterCounts.set(item.character, count + 1);

        if (selected.length >= maxTotal) break;
    }

    return selected;
}

/**
 * Checks if a character already has initial personality vectors stored.
 */
async function hasInitialPersonalityVectors(tools, characterName, projectName) {
    try {
        if (TRAIT_IDS.length === 0) return false;

        // Check for the first trait in the schema
        const checkTrait = TRAIT_IDS[0];

        const query = `
            SELECT 1
            FROM facts
            WHERE
                source = ? AND
                project_name = ? AND
                predicate = ? AND
                turn_number = 0
            LIMIT 1;
        `;
        const params = [characterName.toLowerCase(), projectName.toLowerCase(), checkTrait];
        const result = await tools.db.chat.query(query, params);
        return result.length > 0;
    } catch (error) {
        tools.logger.error(`Failed to check for initial personality vectors for ${characterName}.`, error);
        return false;
    }
}

/**
 * Extracts and stores initial personality vectors for a single character.
 */
async function extractAndStoreInitialPersonalityVectors(turnContext, tools, characterData, charName) {
    if (!charName || !characterData) return;

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const modelDef = settings.initial_model_def || {};

    const config = {
        MODEL: modelDef.model || 'meta-llama/llama-3-70b-instruct',
        PROVIDER: modelDef.provider,
        LLM_PARAMS: modelDef.llm_params || { max_tokens: 32000 },
        RETRIES: settings.retries || 1,
        TIMEOUT: settings.timeout || 120000
    };

    const projectName = turnContext.projectName;
    // Check if already exists
    if (await hasInitialPersonalityVectors(tools, charName, projectName)) {
        tools.logger.log('InitialExtraction', `Initial personality already exists for ${charName}. Skipping.`);
        tools.logger.runtime(`'${charName}' already has personality vectors in DB. Skipping initial extraction.`);
        return;
    }

    tools.logger.log('InitialExtraction', `Extracting initial personality for ${charName}...`, 'start');
    tools.logger.runtime(`Requesting initial persona for '${charName}'. Model: ${config.MODEL}.`);

    const promptPath = path.join(__dirname, 'prompts/personality_vector_extractor_init_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const prompt = preparePrompt(tools, promptTemplate, {
        '${target}': charName,
        '${characterData}': characterData
    });

    try {
        const response = await tools.llm.json({
            msg: 'Initial Personality Extraction',
            requestId: 'initial_personality_extraction',
            prompt,
            model: config.MODEL,
            provider: config.PROVIDER,
            params: {
                ...config.LLM_PARAMS,
                callingModule: 'Plugin:personality_tracker:init'
            }
        });

        const personalityData = response.content;
        if (!personalityData) {
            tools.logger.runtime(`LLM returned empty data for '${charName}'. Extraction failed.`);
            return;
        }

        tools.logger.runtime(`Initial vectors received for '${charName}'. Applying to database.`);
        await applyPersonalityData(tools, personalityData, charName, projectName);

        tools.logger.log('InitialExtraction', `Initial personality extraction complete for ${charName}.`, 'end');
        tools.logger.runtime(`'${charName}' initial personality successfully registered.`);
    } catch (error) {
        tools.logger.error('InitialExtraction', `Initial personality extraction failed for ${charName}: ${error.message}`);
        tools.logger.runtime(`ERROR during initial extraction for '${charName}': ${error.message}`);
    }
}

/**
 * Extracts and stores initial personality vectors for a batch of characters.
 */
async function extractAndStoreBatchInitialPersonality(turnContext, tools, characterList) {
    if (!characterList || characterList.length === 0) return;

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const modelDef = settings.initial_model_def || {};

    const config = {
        MODEL: modelDef.model || 'meta-llama/llama-3-70b-instruct',
        PROVIDER: modelDef.provider,
        LLM_PARAMS: modelDef.llm_params || { max_tokens: 32000 },
        RETRIES: settings.retries || 1,
        TIMEOUT: settings.timeout || 120000
    };

    const projectName = turnContext.projectName;
    const canon = turnContext.renderPromptSlot('root', 'canon') || '';

    // Filter out characters who already have initial vectors
    const toProcess = [];
    for (const char of characterList) {
        if (!(await hasInitialPersonalityVectors(tools, char.name, projectName))) {
            toProcess.push(char);
        }
    }

    if (toProcess.length === 0) {
        tools.logger.runtime(`Batch init: All characters already have vectors. Skipping.`);
        return;
    }

    tools.logger.log('InitialExtraction', `Batch extracting initial personality for ${toProcess.length} characters...`, 'start');
    tools.logger.runtime(`Batch extraction started for: ${toProcess.map(c => c.name).join(', ')}.`);

    const characterBlocks = toProcess.map(c => `CHARACTER: ${c.name}\nBRIEF: ${c.brief}`).join('\n\n---\n\n');

    const promptPath = path.join(__dirname, 'prompts/batch_init_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const prompt = preparePrompt(tools, promptTemplate, {
        '${canon}': canon,
        '${characterBlocks}': characterBlocks
    });

    try {
        const response = await tools.llm.json({
            msg: 'Batch Initial Personality',
            requestId: 'batch_initial_personality',
            prompt,
            model: config.MODEL,
            provider: config.PROVIDER,
            params: {
                ...config.LLM_PARAMS,
                callingModule: 'Plugin:personality_tracker:batch_init'
            }
        });

        const data = response.content;
        if (!data || !data.characters) {
            tools.logger.runtime(`Batch extraction failed: LLM returned no character data.`);
            return;
        }

        tools.logger.runtime(`Batch response received for ${Object.keys(data.characters).length} characters. Applying updates.`);
        for (const [name, personalityData] of Object.entries(data.characters)) {
            await applyPersonalityData(tools, personalityData, name, projectName);
        }

        tools.logger.log('InitialExtraction', `Batch personality extraction complete for ${Object.keys(data.characters).length} characters.`, 'end');
        tools.logger.runtime(`Batch initial extraction complete.`);
    } catch (error) {
        tools.logger.error('InitialExtraction', `Batch personality extraction failed: ${error.message}`);
        tools.logger.runtime(`ERROR during batch extraction: ${error.message}`);
    }
}

async function applyPersonalityData(tools, personalityData, target, _projectName) {
    const vectors = Array.isArray(personalityData) ? personalityData : (personalityData.vectors || []);
    const origin = !Array.isArray(personalityData) ? personalityData.origin : null;

    // Scoped delete for turn 0 (initial state) using the managed facts toolkit.
    // This ensures we don't leave stale data when re-initializing a character.
    await tools.facts.cleanUpFactsDb({
        turn_number: 0,
        source: target.toLowerCase(),
        predicates: PERSONALITY_PREDICATES
    });

    if (origin) {
        await tools.facts.appendToFactsDb({
            source: target.toLowerCase(),
            target: '',
            predicate: 'personality_origin',
            fact_value: 0,
            context: origin
        }, { turn_number: 0 });
    }

    for (const item of vectors) {
        await tools.facts.appendToFactsDb({
            source: target.toLowerCase(),
            target: '',
            predicate: item.predicate?.toLowerCase() ?? null,
            fact_value: item.value ?? null,
            context: item.context ?? null
        }, { turn_number: 0 });
    }
}

/**
 * Analyzes a scene and extracts personality changes for a specific set of characters.
 */
async function extractAndStoreBatchPersonalityChanges(turnContext, tools, targetCharacters = null) {
    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const modelDef = settings.change_model_def || settings.plugins?.personality_tracker?.change_extractor || {};
    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef || {};

    const config = {
        MODEL: resolvedModelDef.model || 'meta-llama/llama-3-70b-instruct',
        PROVIDER: resolvedModelDef.provider,
        LLM_PARAMS: modelDef.llm_params || { max_tokens: 32000 },
        RETRIES: settings.retries || 1,
        TIMEOUT: settings.timeout || 120000
    };

    const sceneText = turnContext.processed?.narrativeEngine?.writerResponse
        || turnContext.output?.fulltext
        || turnContext.processed?.dialogueProcessor?.dialogue
        || '';
    const turnNumber = turnContext.turnNumber;
    const projectName = turnContext.projectName;

    let majorCharacters = targetCharacters;

    if (!majorCharacters) {
        const party = turnContext.output.party || [];
        if (party.length === 0) {
            tools.logger.log('BatchExtraction', 'Personality batch skipped: party is empty.');
            tools.logger.turn('Personality Batch Diagnostics', {
                turn: turnNumber,
                project: projectName,
                reason: 'empty_party',
                sceneTextLength: sceneText.length
            });
            return;
        }

        // Filter party to only include MAJOR characters
        const metadata = turnContext.processed.characterMetadata || {};
        majorCharacters = [];
        for (const charName of party) {
            const charKey = charName.toLowerCase();
            let importance = metadata[charKey]?.importance;
            if (typeof importance === 'string') importance = importance.toLowerCase();

            if (!importance) {
                importance = await tools.plugins.tryCall(
                    'character_classifier',
                    'getImportance',
                    [charName],
                    { fallback: null, silent: true }
                );
                if (typeof importance === 'string') importance = importance.toLowerCase();
            }

            if (importance === 'core') {
                majorCharacters.push(charName);
            }
        }
    }

    if (majorCharacters.length === 0) {
        tools.logger.log('BatchExtraction', 'No major characters to process. Skipping batch personality extraction.');
        tools.logger.runtime(`No major characters detected in party. Skipping change extraction.`);
        tools.logger.turn('Personality Batch Diagnostics', {
            turn: turnNumber,
            project: projectName,
            reason: 'no_selected_characters',
            targetCharacters,
            sceneTextLength: sceneText.length
        });
        return;
    }

    if (!sceneText.trim()) {
        tools.logger.log('BatchExtraction', 'Personality batch skipped: no scene text available.');
        tools.logger.runtime(`No scene text available for personality extraction.`);
        tools.logger.turn('Personality Batch Diagnostics', {
            turn: turnNumber,
            project: projectName,
            reason: 'empty_scene_text',
            targetCharacters: majorCharacters,
            model: config.MODEL,
            provider: config.PROVIDER
        });
        return;
    }

    tools.logger.log('BatchExtraction', `Personality batch input: targets=[${majorCharacters.join(', ')}], sceneTextLength=${sceneText.length}, model=${config.MODEL}, provider=${config.PROVIDER || 'default'}`);
    tools.logger.turn('Personality Batch Diagnostics', {
        turn: turnNumber,
        project: projectName,
        reason: 'calling_llm',
        targetCharacters: majorCharacters,
        sceneTextLength: sceneText.length,
        model: config.MODEL,
        provider: config.PROVIDER || null
    });
    tools.logger.runtime(`Identifying personality shifts for: ${majorCharacters.join(', ')}.`);

    try {
        const promptPath = path.join(__dirname, 'prompts/personality_change_extractor_prompt.txt');
        const promptTemplate = await fs.readFile(promptPath, 'utf-8');
        const useSharedModel = tools.llm.vnBackground?.isSelected?.(modelDef) === true;
        const prompt = preparePrompt(tools, promptTemplate, {
            '${sceneText}': useSharedModel ? 'Use CURRENT WRITER CHAPTER from the dedicated scene message above.' : sceneText,
            '${characters}': majorCharacters.join(', ')
        });

        tools.logger.log('BatchExtraction', 'Calling PersonalityChangeExtractor LLM...', 'start');
        const task = {
            msg: 'PersonalityChangeExtractor',
            requestId: 'personality_change_extraction',
            params: {
                ...config.LLM_PARAMS,
                retries: config.RETRIES,
                timeout: config.TIMEOUT,
                callingModule: 'Plugin:personality_tracker (Batch)'
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.json({ ...task, scene: 'raw', instruction: prompt })
            : await tools.llm.json({ ...task, prompt, model: config.MODEL, provider: config.PROVIDER });
        tools.logger.log('BatchExtraction', 'PersonalityChangeExtractor response received.', 'end');

        const extractedData = response.content;
        if (!extractedData || typeof extractedData !== 'object') {
            tools.logger.runtime(`No personality changes detected by LLM.`);
            return;
        }

        const recallCandidates = Array.isArray(extractedData._character_recall)
            ? extractedData._character_recall
            : [];
        const selectedRecallCandidates = filterPersonalityRecallCandidates(recallCandidates, majorCharacters, settings);

        if (recallCandidates.length > 0) {
            tools.logger.runtime(`Personality recall candidates: ${recallCandidates.length} extracted, ${selectedRecallCandidates.length} passed filters.`);
        }

        if (selectedRecallCandidates.length > 0) {
            try {
                const stored = await tools.plugins.tryCall(
                    'memory_recall',
                    'storeMemories',
                    [selectedRecallCandidates, { sourcePlugin: 'personality_tracker', domain: 'personality' }],
                    { fallback: null, silent: true }
                );
                if (stored !== null && stored !== undefined) {
                    tools.logger.runtime(`Stored ${selectedRecallCandidates.length} personality-derived recall candidates.`);
                }
            } catch (error) {
                tools.logger.warn('BatchExtraction', `Failed to store personality recall candidates: ${error.message}`);
            }
        }

        let changesStored = 0;
        for (const characterName in extractedData) {
            if (characterName.startsWith('_')) continue;
            const vectors = extractedData[characterName];
            if (Array.isArray(vectors) && vectors.length > 0) {
                tools.logger.runtime(`Found ${vectors.length} shifts for '${characterName}'.`);
                for (const item of vectors) {
                    if (item.predicate && item.value !== undefined) {
                        await tools.facts.appendToFactsDb({
                            source: characterName.toLowerCase(),
                            target: '',
                            predicate: item.predicate.toLowerCase(),
                            fact_value: item.value,
                            context: item.context ?? null
                        });
                        changesStored++;
                    }
                }
            }
        }
        tools.logger.log('BatchExtraction', `Stored ${changesStored} personality changes from batch processing.`);
        tools.logger.runtime(`Change extraction complete. Stored ${changesStored} shifts.`);
    } catch (error) {
        tools.logger.error('BatchExtraction', 'Failed to extract or store batch personality changes.', null, error);
        tools.logger.runtime(`ERROR during change extraction: ${error.message}`);
    }
}

async function getPersonalityOrigin(tools, characterName, projectName, maxTurnNumber = null) {
    try {
        let query = "SELECT context FROM facts WHERE project_name = ? AND source = ? AND predicate = 'personality_origin'";
        const params = [projectName.toLowerCase(), characterName.toLowerCase()];

        if (maxTurnNumber !== null && maxTurnNumber !== undefined) {
            query += " AND turn_number <= ?";
            params.push(maxTurnNumber);
        }

        query += " LIMIT 1";
        const rows = await tools.db.chat.query(query, params);
        return rows && rows.length > 0 ? rows[0].context : null;
    } catch {
        return null;
    }
}

async function getPersonalityHistorySummary(tools, characterName, projectName, maxTurnNumber = null) {
    try {
        let query = "SELECT context, turn_number FROM facts WHERE project_name = ? AND source = ? AND predicate = 'personality_history_summary'";
        const params = [projectName.toLowerCase(), characterName.toLowerCase()];

        if (maxTurnNumber !== null && maxTurnNumber !== undefined) {
            query += " AND turn_number <= ?";
            params.push(maxTurnNumber);
        }

        query += " ORDER BY turn_number DESC LIMIT 1";
        const rows = await tools.db.chat.query(query, params);
        return rows && rows.length > 0 ? { text: rows[0].context, turn: rows[0].turn_number } : { text: '', turn: 0 };
    } catch {
        return { text: '', turn: 0 };
    }
}

async function getRecentPersonalityBeats(tools, characterName, projectName, sinceTurn, maxTurnNumber = null) {
    try {
        let query = `SELECT DISTINCT turn_number, predicate, fact_value, context FROM facts 
             WHERE project_name = ? AND source = ? 
             AND predicate IN (${PERSONALITY_PREDICATES.filter(p => p !== 'personality_origin' && p !== 'personality_history_summary').map(() => '?').join(',')})
             AND turn_number > ?`;
        const params = [projectName.toLowerCase(), characterName.toLowerCase(), ...PERSONALITY_PREDICATES.filter(p => p !== 'personality_origin' && p !== 'personality_history_summary'), sinceTurn];

        if (maxTurnNumber !== null && maxTurnNumber !== undefined) {
            query += " AND turn_number <= ?";
            params.push(maxTurnNumber);
        }

        query += " ORDER BY turn_number ASC";
        const rows = await tools.db.chat.query(query, params);
        return rows.map(r => `Turn ${r.turn_number} (${r.predicate}): ${r.context} (Shift: ${r.fact_value > 0 ? '+' : ''}${r.fact_value})`);
    } catch {
        return [];
    }
}

async function consolidatePersonalityHistory(tools, projectName, characters) {
    const selfSettings = tools.settings.getSelf();
    if (selfSettings.enable_rolling_ledger === false) {
        tools.logger.runtime(`Rolling Ledger is disabled in settings.`);
        return;
    }

    const turnContext = tools.turnContext;
    const currentTurn = turnContext.turnNumber;

    // Testing override: Force run if turnNumber === 1
    const isTestOverride = currentTurn === 1;

    const charsToConsolidate = [];
    for (const charName of characters) {
        const lastSummary = await getPersonalityHistorySummary(tools, charName, projectName);

        const shouldConsolidate = isTestOverride || (currentTurn - lastSummary.turn >= (selfSettings.ledger_consolidation_interval || 5));

        if (shouldConsolidate) {
            const recentBeats = await getRecentPersonalityBeats(tools, charName, projectName, lastSummary.turn);
            if (recentBeats.length > 0) {
                const origin = await getPersonalityOrigin(tools, charName, projectName) || 'Unknown';
                charsToConsolidate.push({
                    name: charName,
                    origin,
                    lastSummary: lastSummary.text,
                    recentBeats
                });
            }
        }
    }

    if (charsToConsolidate.length === 0) {
        tools.logger.runtime(`No characters reach the milestone for ledger consolidation this turn.`);
        return;
    }

    tools.logger.log('Ledger', `Consolidating personality history for ${charsToConsolidate.length} characters...`, 'start');
    tools.logger.runtime(`Consolidating development ledger for: ${charsToConsolidate.map(c => c.name).join(', ')}.`);

    const ledgerInterval = selfSettings.ledger_consolidation_interval || 5;

    const characterBlocks = charsToConsolidate.map((c, i) => `
### CHARACTER ${i + 1}: ${c.name}
- **Original Personality (Origin)**: ${c.origin}
- **Evolution as of ${ledgerInterval} chapters ago (Previous Ledger)**: ${c.lastSummary || 'No previous summary.'}
- **Recent Internal Shifts (from the last ${ledgerInterval} chapters)**:
  ${c.recentBeats.join('\n  ')}
`).join('\n---\n');

    const modelDef = selfSettings.ledger_consolidation_model_def || selfSettings.change_model_def || {};
    const useSharedModel = tools.llm.vnBackground?.isSelected?.(modelDef) === true;
    const canon = useSharedModel
        ? 'Use SELECTED CANON from the shared background context.'
        : turnContext.renderPromptSlot('root', 'canon') || 'No canon data available.';
    const history = useSharedModel
        ? 'Use SELECTED NARRATIVE HISTORY from the shared background context.'
        : turnContext.renderPromptSlot('root', 'history') || 'No narrative history available.';

    const promptTemplatePath = path.join(__dirname, 'prompts/personality_ledger_consolidator_prompt.txt');
    const promptTemplate = await fs.readFile(promptTemplatePath, 'utf-8');
    const prompt = promptTemplate
        .replace('${canon}', canon)
        .replace('${history}', history)
        .replace('${characterBlocks}', characterBlocks);

    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef || {};
    const model = resolvedModelDef.model || 'meta-llama/llama-3-70b-instruct';
    const provider = resolvedModelDef.provider;

    try {
        tools.logger.runtime(`Requesting ledger consolidation from LLM. Model: ${model}.`);
        const task = {
            msg: 'PersonalityLedgerConsolidator',
            requestId: 'personality_ledger_consolidation',
            params: {
                max_tokens: 32000,
                callingModule: 'Plugin:personality_tracker'
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.json({ ...task, scene: 'none', instruction: prompt })
            : await tools.llm.json({ ...task, prompt, model, provider });

        const results = response.content;
        if (Array.isArray(results)) {
            tools.logger.runtime(`Ledger consolidation successful. Updating ${results.length} records.`);
            for (const result of results) {
                if (result.name && result.summary) {
                    await tools.facts.appendToFactsDb({
                        source: result.name.toLowerCase(),
                        target: '',
                        predicate: 'personality_history_summary',
                        fact_value: 0,
                        context: result.summary
                    });
                }
            }
            tools.logger.log('Ledger', `Personality history consolidated for ${results.length} characters.`, 'end');
        } else {
            tools.logger.runtime(`WARNING: Ledger consolidation returned unexpected format.`);
        }
    } catch (error) {
        tools.logger.error('Ledger', `Failed to consolidate personality history batch: ${error.message}`);
        tools.logger.runtime(`ERROR during ledger consolidation: ${error.message}`);
    }
}

/**
 * Retrieves the programmatic "Behavioral Ruleset" based on numerical vectors.
 */
async function getProgrammaticPersonalitySummary(tools, characterName, projectName, options = {}) {
    const significanceThreshold = options.significance_threshold ?? options.significanceThreshold ?? 25;
    const maxTurnNumber = options.maxTurnNumber ?? options.turnNumber ?? null;

    try {
        let query = `
            SELECT predicate, SUM(fact_value) as total_score
            FROM facts
            WHERE source = ? AND project_name = ? AND predicate IN (${PERSONALITY_PREDICATES.filter(p => p !== 'personality_origin' && p !== 'personality_history_summary').map(() => '?').join(',')})
        `;
        const params = [characterName.toLowerCase(), projectName.toLowerCase(), ...PERSONALITY_PREDICATES.filter(p => p !== 'personality_origin' && p !== 'personality_history_summary')];

        if (maxTurnNumber !== null && maxTurnNumber !== undefined) {
            query += " AND turn_number <= ?";
            params.push(maxTurnNumber);
        }

        query += " GROUP BY predicate;";
        const results = await tools.db.chat.query(query, params);

        if (results.length === 0) return "Currently presents a balanced and moderate personality.";

        const significantTraits = [];
        for (const row of results) {
            const score = Math.round(row.total_score);
            if (Math.abs(score) >= significanceThreshold) {
                const description = getTraitDescription(tools, row.predicate, score);
                if (description) significantTraits.push(description);
            }
        }

        return significantTraits.length === 0 ? "Currently presents a balanced and moderate personality." : significantTraits.join(' ');
    } catch {
        return null;
    }
}

/**
 * Retrieves the "Deep History" layers: Origin, Ledger, and Recent Beats.
 */
async function getLayeredPersonalityHistory(tools, characterName, projectName, options = {}) {
    const maxTurnNumber = options.maxTurnNumber ?? options.turnNumber ?? null;

    try {
        const origin = await getPersonalityOrigin(tools, characterName, projectName, maxTurnNumber);
        const historySummary = await getPersonalityHistorySummary(tools, characterName, projectName, maxTurnNumber);
        const recentBeats = await getRecentPersonalityBeats(tools, characterName, projectName, historySummary.turn, maxTurnNumber);

        let lines = [];
        if (origin) {
            lines.push(`- **Origin & Baseline**: ${origin}`);

            if (historySummary && historySummary.text) lines.push(`- **Development so far**: ${historySummary.text}`);
            else lines.push(`- **Development so far**: No significant long-term evolution recorded.`);

            if (recentBeats && recentBeats.length > 0) {
                lines.push(`- **Recent Internal Shifts**:\n  * ${recentBeats.join('\n  * ')}`);
            } else {
                lines.push(`- **Recent Internal Shifts**: Stable.`);
            }
        }

        return lines.length > 0 ? lines.join('\n') : null;
    } catch {
        return null;
    }
}

/**
 * Synthesizes a natural language summary of a character's personality.
 */
async function synthesizeCharacterPersonality(tools, characterName, projectName, options = {}) {
    const programmatic = await getProgrammaticPersonalitySummary(tools, characterName, projectName, options);
    const history = await getLayeredPersonalityHistory(tools, characterName, projectName, options);

    let finalDescription = '';
    const capitalizedName = characterName.charAt(0).toUpperCase() + characterName.slice(1);

    if (!options.noHeader) {
        finalDescription += `### PERSONALITY PROFILE: ${capitalizedName}\n`;
    }

    if (history) finalDescription += history + '\n';
    if (programmatic) finalDescription += `- **Current Behavioral Ruleset (Strict)**: ${programmatic}\n`;

    return finalDescription.trim();
}

function getTraitList() {
    return TRAIT_IDS.join(', ');
}

function getTraitRanges() {
    if (!SCHEMA || !SCHEMA.traits) return '';
    const lines = [];
    for (const trait of SCHEMA.traits) {
        lines.push(`${trait.label}:`);
        for (const range of trait.ranges) {
            let prefix = '';
            if (range.min > 0) prefix = '>';
            else if (range.max < 0) prefix = '<';
            // Simple mapping for prompt
            const val = range.min > 0 ? range.min - 1 : range.max + 1;
            lines.push(`  ${prefix}${val}: ${range.description}`);
        }
    }
    return lines.join('\n');
}

function getTraitJsonExample() {
    if (TRAIT_IDS.length === 0) return '{}';
    const example = {};
    for (let i = 0; i < Math.min(3, TRAIT_IDS.length); i++) {
        example[TRAIT_IDS[i]] = (Math.random() * 100 - 50).toFixed(1);
    }
    return JSON.stringify(example, null, 2);
}

function preparePrompt(tools, template, replacements = {}) {
    let prompt = template;
    const defaults = {
        '${traitList}': getTraitList(),
        '${traitRanges}': getTraitRanges(),
        '${traitJsonExample}': getTraitJsonExample()
    };

    const allReplacements = { ...defaults, ...replacements };
    for (const [key, value] of Object.entries(allReplacements)) {
        prompt = prompt.split(key).join(value);
    }
    return prompt;
}

function getTraitDescription(tools, predicate, score) {
    if (!SCHEMA || !SCHEMA.traits) return null;

    const trait = SCHEMA.traits.find(t => t.predicate === predicate);
    if (!trait || !trait.ranges) return null;

    const range = trait.ranges.find(r => score >= r.min && score <= r.max);
    const desc = range ? range.description : null;

    if (desc) {
        tools.logger.runtime(`Translated trait '${predicate}' (Score: ${score}) to: "${desc.substring(0, 50)}..."`);
    }
    return desc;
}

module.exports = {
    extractAndStoreInitialPersonalityVectors,
    extractAndStoreBatchInitialPersonality,
    extractAndStoreBatchPersonalityChanges,
    getProgrammaticPersonalitySummary,
    getLayeredPersonalityHistory,
    synthesizeCharacterPersonality,
    consolidatePersonalityHistory,
    getTraitList,
    getTraitRanges,
    getTraitJsonExample,
    preparePrompt,
    getTraitDescription
};
