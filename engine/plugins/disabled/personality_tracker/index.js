// plugins/personality_tracker/index.js

const logic = require('./logic.js');

async function resolveTrackingImportance(turnContext, tools, characterName) {
    const charKey = characterName.toLowerCase().trim();
    const metadata = turnContext.processed.characterMetadata || {};
    const metadataImportance = typeof metadata[charKey]?.importance === 'string'
        ? metadata[charKey].importance.toLowerCase()
        : '';

    let sheetImportance = '';
    if (tools.plugins.isInstalled('character_sheets')) {
        sheetImportance = await tools.plugins.call('character_sheets', 'getCharacterImportance', characterName);
        if (typeof sheetImportance === 'string') sheetImportance = sheetImportance.toLowerCase();
    }

    let classifierImportance = '';
    if (tools.plugins.isInstalled('character_classifier')) {
        classifierImportance = await tools.plugins.call('character_classifier', 'getImportance', characterName);
        if (typeof classifierImportance === 'string') classifierImportance = classifierImportance.toLowerCase();
    }

    if (sheetImportance) {
        return {
            importance: sheetImportance,
            source: 'character_sheets.getCharacterImportance',
            metadataImportance,
            sheetImportance,
            classifierImportance
        };
    }

    if (metadataImportance) {
        return {
            importance: metadataImportance,
            source: 'turnContext.processed.characterMetadata',
            metadataImportance,
            sheetImportance,
            classifierImportance
        };
    }

    return {
        importance: classifierImportance,
        source: classifierImportance ? 'character_classifier.getImportance' : 'none',
        metadataImportance,
        sheetImportance,
        classifierImportance
    };
}

module.exports = {
    id: 'personality_tracker',
    name: 'Personality Tracker',
    author: 'Fablekin Core',
    version: '1.1.0',
    category: 'Characters',
    wizard: {
        include: true,
        order: 430,
        group: 'Characters',
        label: 'Personality Tracker',
        recommended_enabled: true,
        author_note: 'Recommended if you care about characters changing gradually instead of staying static.',
        enabled_note: 'Tracks personality movement and provides behavioral context for recurring characters.',
        disabled_note: 'Character development becomes less measurable and less available to other modules.',
        settings_note: 'Tune trait extraction, update frequency, and injection behavior in plugin settings.'
    },
    description: 'Tracks and evolves character personalities across 6 core metrics (OCEAN + Esteem) based on their narrative actions and dialogue.',
    optionalDependencies: [
        { id: 'memory_recall', reason: 'Lets personality changes and important behavioral moments remain available over long campaigns.' }
    ],
    exports: {
        /**
         * Gets the high-level behavioral profile (programmatic traits).
         * Used for immediate "Writer's Ruleset".
         */
        getTraitSummary: async (context, tools, characterName, options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return null;
            return await logic.getProgrammaticPersonalitySummary(tools, characterName, projectName, options);
        },
        /**
         * Gets the deep history: Origin + Rolling Ledger + Recent Beats.
         * Used for longitudinal context.
         */
        getDevelopmentLedger: async (context, tools, characterName, options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return null;
            return await logic.getLayeredPersonalityHistory(tools, characterName, projectName, options);
        },
        /**
         * LEGACY: Gets the fully synthesized personality (Summary + Ledger).
         */
        getPersonality: async (context, tools, characterName, options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return null;
            return await logic.synthesizeCharacterPersonality(tools, characterName, projectName, options);
        }
    },
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Deep-simulates character behavior by tracking 16 core personality traits and psychological needs.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Analyzes every narrative beat for behavioral shifts across vectors like the Big Five traits, moral alignments, and Maslow-inspired needs. It maintains a "Longitudinal Development Ledger" that records significant internal changes, allowing the AI to understand not just "who" a character is, but "why" they have changed over time.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'None',
            cost: 'Medium',
            latency: 'Medium'
        },
        initial_model_def: {
            type: 'select',
            label: 'Initial Extraction Model',
            description: 'Model used to establish the baseline personality for new characters.',
            options: 'llm-aliases',
            default: { model: 'highendmodel' }
        },
        change_model_def: {
            type: 'select',
            label: 'Evolution Model',
            description: 'Model used to identify personality changes after each turn.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        retries: {
            type: 'number',
            label: 'Max Retries',
            description: 'Number of times to retry if the LLM call fails.',
            default: 1
        },
        timeout: {
            type: 'number',
            label: 'Request Timeout (ms)',
            description: 'Timeout for the LLM request in milliseconds.',
            default: 120000
        },
        significance_threshold: {
            type: 'number',
            label: 'Significance Threshold',
            description: 'The minimum score required for a personality trait to be included in the natural language summary (1-100).',
            default: 25,
            min: 1,
            max: 100
        },
        recall_max_per_turn: {
            type: 'number',
            label: 'Max Personality Recalls Per Turn',
            description: 'Hard cap for personality-derived recall memories stored after each turn. Set to 0 to disable personality recall capture.',
            default: 3,
            min: 0,
            max: 20
        },
        recall_max_per_character: {
            type: 'number',
            label: 'Max Personality Recalls Per Character',
            description: 'Hard cap for personality-derived recall memories stored for a single character after each turn.',
            default: 1,
            min: 0,
            max: 10
        },
        recall_min_salience: {
            type: 'number',
            label: 'Minimum Personality Recall Salience',
            description: 'Minimum salience for personality-derived recalls. Situational recalls must exceed this by one point.',
            default: 7,
            min: 1,
            max: 10
        },
        enable_rolling_ledger: {
            type: 'checkbox',
            label: 'Enable Rolling Narrative Ledger',
            description: 'Periodically synthesizes personality history into a rolling summary, providing the AI with "intimate" knowledge of internal development.',
            default: true
        },
        ledger_consolidation_interval: {
            type: 'number',
            label: 'Ledger Consolidation Interval',
            description: 'How many turns to wait before merging new events into the long-term personality summary.',
            min: 1,
            max: 20,
            default: 5
        },
        ledger_consolidation_model_def: {
            type: 'select',
            label: 'Ledger Consolidation Model',
            description: 'Model used to summarize and consolidate personality history.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        }
    },
    terminalCommands: {
        '/traits': {
            description: 'Inspect character personality traits and development. Usage: /traits [subcommand] [target] [turn_selector]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
                const subcommand = args[0]?.toLowerCase();

                if (!subcommand || subcommand === 'help') {
                    return `\r\n${colors.bright}Personality Tracker Toolkit${colors.reset}\r\n` +
                        `Usage: /traits ${colors.cyan}[subcommand]${colors.reset} ${colors.yellow}[target]${colors.reset} ${colors.magenta}[turn_selector]${colors.reset}\r\n\r\n` +
                        `${colors.bright}Subcommands:${colors.reset}\r\n` +
                        `  ${colors.cyan}list${colors.reset}       - List all characters currently present in personality memory.\r\n` +
                        `  ${colors.cyan}inspect${colors.reset}    - Show detailed persona profile and trait evolution for a character.\r\n\r\n` +
                        `${colors.bright}Parameters:${colors.reset}\r\n` +
                        `  ${colors.yellow}[target]${colors.reset}         - Name of the character to inspect.\r\n` +
                        `  ${colors.magenta}[turn_selector]${colors.reset}  - History navigation. Use ${colors.bright}N${colors.reset} for limit or ${colors.bright}X-Y${colors.reset} for a specific range.\r\n\r\n` +
                        `${colors.bright}Examples:${colors.reset}\r\n` +
                        `  /traits list\r\n` +
                        `  /traits inspect arthur 5\r\n` +
                        `  /traits inspect merlin 1-10\r\n`;
                }

                let selector = args[1];
                if (subcommand === 'inspect' && args[2] && isNaN(parseInt(args[1]))) selector = args[2];

                const projectName = tools.turnContext.projectName;

                // Parse Range/Limit
                let startTurn, endTurn, isRange = false;
                const latestTurn = tools.turnContext.turnNumber || 1;

                if (selector && typeof selector === 'string' && selector.includes('-')) {
                    [startTurn, endTurn] = selector.split('-').map(n => parseInt(n));
                    isRange = true;
                } else {
                    const limit = (selector && !isNaN(parseInt(selector))) ? parseInt(selector) : 1;
                    startTurn = Math.max(1, latestTurn - limit + 1);
                    endTurn = latestTurn;
                }

                if (subcommand === 'list') {
                    const rows = await tools.db.chat.query(
                        `SELECT DISTINCT source FROM facts 
                         WHERE project_name = ? AND predicate LIKE 'personality_%' AND turn_number <= ?`,
                        [projectName.toLowerCase(), endTurn]
                    );

                    if (!rows || rows.length === 0) return `No personality data found at Turn ${endTurn}.`;

                    let output = `\r\n\x1b[1;32mPersona Profiles at Turn ${endTurn}:\x1b[0m\r\n`;
                    for (const row of rows) {
                        const charName = row.source;
                        const programmatic = await logic.getProgrammaticPersonalitySummary(tools, charName, projectName, { turnNumber: endTurn });
                        output += `  \x1b[1;36m${charName.toUpperCase()}\x1b[0m: \x1b[0;90m${programmatic}\x1b[0m\r\n`;
                    }
                    return output;
                } else if (subcommand === 'inspect') {
                    const charName = args[1]?.toLowerCase();
                    if (!charName) return 'Usage: /traits inspect <character> [limit|range]';

                    let output = `\r\n\x1b[1;32mInspecting Personality: ${charName.toUpperCase()}\x1b[0m\r\n`;

                    if (isRange) {
                        const beats = await logic.getRecentPersonalityBeats(tools, charName, projectName, startTurn - 1, endTurn);
                        if (!beats || beats.length === 0) return `No personality shifts recorded for ${charName} between Turn ${startTurn} and ${endTurn}.`;

                        output += `\x1b[1;33mInternal Shifts (Turns ${startTurn}-${endTurn}):\x1b[0m\r\n`;
                        beats.forEach(b => {
                            output += `  ${b}\r\n`;
                        });
                        return output;
                    } else {
                        const profile = await logic.synthesizeCharacterPersonality(tools, charName, projectName, { turnNumber: endTurn, noHeader: true });
                        if (!profile || profile.includes('Stable')) return `No personality data found for ${charName} at Turn ${endTurn}.`;

                        output += profile.split('\n').map(line => `  ${line}`).join('\r\n') + '\r\n';
                        return output;
                    }
                }

                return 'Unknown subcommand. Use /traits [list|inspect]';
            }
        }
    },

    hooks: {
        /**
         * Phase 1: Universal Cleanup
         * Clears any personality evolution data for the current or future turns to ensure a clean slate for retries.
         */
        'HOOK_PRE_VN_GENERATION': {
            priority: 5, // Run early
            run: async (turnContext, tools) => {
                if (!turnContext?.turnNumber) return;

                tools.logger.runtime(`[Cleanup] Purging personality tracker facts for current turn scope.`);

                // Standardized cleanup for the current turn/interlude scope.
                // This ensures "Upsert-by-Turn" behavior and prevents duplicates during regeneration.
                await tools.facts.cleanUpFactsDb();
            }
        },
        /**
         * Sequential hook to initialize personality for proactively discovered characters.
         */
        'HOOK_PRE_PROMPT_BUILDER': {
            priority: 20, // After character_sheets discovery
            mode: 'sequential',
            eta: { default: { min: 10000, max: 60000 }, turn1: { min: 60000, max: 180000 } },
            run: async (turnContext, tools) => {
                const coreSheets = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];

                // Only bootstrap characters with core sheets
                const allNewChars = coreSheets.map(s => ({ name: s.name, brief: s.sheet.substring(0, 1000) }));

                tools.logger.runtime(`HOOK_PRE_PROMPT_BUILDER: Checking for ${allNewChars.length} major characters to bootstrap.`);

                if (allNewChars.length === 0) return;

                tools.logger.runtime(`Initiating batch personality bootstrapping for ${allNewChars.length} characters.`);
                await logic.extractAndStoreBatchInitialPersonality(turnContext, tools, allNewChars);
            }
        },
        /**
         * Sequential hook called after the prompt components are gathered but before final assembly.
         * Used to inject personality snapshots into the system prompt.
         */
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 20,
            mode: 'parallel',
            eta: { default: { min: 5000, max: 15000 } },
            run: async (turnContext, tools) => {
                const projectName = turnContext.projectName;

                // 0. DETECT CHARACTER_SHEETS: If character_sheets is active, it handles personality injection
                // inside Layer 2A of each character. We skip global injection to avoid duplication.
                if (tools.plugins.isInstalled('character_sheets')) {
                    tools.logger.runtime(`HOOK_POST_PROMPT_BUILDER: 'character_sheets' is active. Skipping global personality injection.`);
                    return;
                }

                tools.logger.runtime(`HOOK_POST_PROMPT_BUILDER: Preparing personality context for the prompt.`);
                tools.logger.log('Synthesis', 'Starting personality synthesis...', 'start');

                // Identify characters to synthesize (party members from previous turn)
                const charactersSet = new Set();

                // Retrieve history to find the previous turn's party
                const history = await turnContext.retrieveDatedChapters();
                const allPrev = [...(history.synopsischapters || []), ...(history.summarychapters || []), ...(history.fullchapters || [])];
                const lastTurn = allPrev.length > 0 ? allPrev[allPrev.length - 1] : null;

                if (lastTurn) {
                    if (lastTurn.output && Array.isArray(lastTurn.output.party)) {
                        tools.logger.log('Synthesis', `Found previous turn party: ${JSON.stringify(lastTurn.output.party)}`);
                        tools.logger.runtime(`Analyzing previous party members: ${lastTurn.output.party.join(', ')}.`);

                        const csSettings = tools.settings.get('character_sheets') || {};
                        const allowMajor = csSettings.track_major_personality === true;

                        for (const char of lastTurn.output.party) {
                            const { importance } = await resolveTrackingImportance(turnContext, tools, char);

                            if (importance === 'minor' || importance === 'noncharacter' || (importance === 'major' && !allowMajor)) {
                                tools.logger.log('Synthesis', `Skipping personality synthesis for ${importance?.toUpperCase() || 'MINOR/NONCHARACTER'} entity: ${char}`);
                                tools.logger.runtime(`Character '${char}' tracking is disabled (${importance}). Skipping personality context.`);
                                continue;
                            }

                            charactersSet.add(char.trim());
                        }
                    } else {
                        tools.logger.log('Synthesis', 'Previous turn has no party data.');
                        tools.logger.runtime(`No party data found in the previous turn.`);
                    }
                } else {
                    tools.logger.log('Synthesis', 'No previous turn found (Turn 1).');
                    tools.logger.runtime(`Turn 1 detected. No previous history to synthesize personality from.`);
                }

                if (charactersSet.size > 0) {
                    tools.logger.log('Synthesis', `Synthesizing personality for: ${Array.from(charactersSet).join(', ')}`);
                    tools.logger.runtime(`Generating behavioral profiles for: ${Array.from(charactersSet).join(', ')}.`);

                    const synthesisPromises = Array.from(charactersSet).map(async (charName) => {
                        try {
                            const summary = await logic.synthesizeCharacterPersonality(tools, charName, projectName, { turnNumber: turnContext.turnNumber });
                            if (summary && summary.length > 10) {
                                tools.logger.runtime(`Successfully synthesized profile for '${charName}'.`);
                                return tools.prompt.wrap('personality_snapshot', summary, { name: charName });
                            } else {
                                tools.logger.log('Synthesis', `No significant personality found for ${charName} (or synthesis returned null/empty).`);
                                tools.logger.runtime(`No significant data for '${charName}'. Context will be minimal.`);
                                return null;
                            }
                        } catch (error) {
                            tools.logger.error('Synthesis', `Failed to synthesize personality for ${charName}.`, null, error);
                            tools.logger.runtime(`ERROR synthesizing for '${charName}': ${error.message}`);
                            return null;
                        }
                    });

                    const results = await Promise.all(synthesisPromises);
                    const dynamicPersonalitySummaries = results.filter(r => r !== null);

                    if (dynamicPersonalitySummaries.length > 0) {
                        dynamicPersonalitySummaries.forEach(summary => {
                            tools.prompt.inject('simulation', summary, 'root');
                        });
                        tools.logger.log('Synthesis', `Injected ${dynamicPersonalitySummaries.length} personality snapshots into simulation slot.`);
                        tools.logger.runtime(`Injected ${dynamicPersonalitySummaries.length} profiles into the prompt.`);
                    }
                } else {
                    tools.logger.log('Synthesis', 'No characters identified for personality synthesis.');
                    tools.logger.runtime(`No characters required personality context for this turn.`);
                }
                tools.logger.log('Synthesis', 'Personality synthesis complete.', 'end');
            }
        },

        /**
         * Generic hook for background tasks.
         * Used to extract personality changes from the writer's response.
         */
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 50,
            mode: 'parallel',
            useSharedVnLlm: true,
            eta: { default: { min: 10000, max: 60000 } },
            run: async (turnContext, tools) => {
                tools.logger.log('BatchExtraction', 'HOOK_VN_BACKGROUND_TASKS fired for personality tracker.', 'start');
                tools.logger.runtime(`HOOK_VN_BACKGROUND_TASKS: Starting background personality processing.`);
                try {
                    const party = turnContext.output.party || [];
                    const metadata = turnContext.processed.characterMetadata || {};
                    const majorCharacters = [];

                    const csSettings = tools.settings.get('character_sheets') || {};
                    const allowMajor = csSettings.track_major_personality === true;
                    const diagnostics = {
                        turn: turnContext.turnNumber || 0,
                        project: turnContext.projectName,
                        party,
                        allowMajorPersonality: allowMajor,
                        hasCharacterSheets: tools.plugins.isInstalled('character_sheets'),
                        hasCharacterClassifier: tools.plugins.isInstalled('character_classifier'),
                        metadataKeys: Object.keys(metadata),
                        decisions: []
                    };

                    tools.logger.log('BatchExtraction', `Personality tracker eligibility check: party=[${party.join(', ')}], allowMajor=${allowMajor}`);
                    tools.logger.runtime(`Personality eligibility: partyCount=${party.length}, allowMajor=${allowMajor}.`);

                    for (const char of party) {
                        const importanceResult = await resolveTrackingImportance(turnContext, tools, char);
                        const { importance, source: importanceSource } = importanceResult;

                        // Undefined importance defaults to being tracked (treated as core)
                        if (importance === 'minor' || importance === 'noncharacter' || (importance === 'major' && !allowMajor)) {
                            diagnostics.decisions.push({ character: char, importance: importance || 'undefined', importanceSource, ...importanceResult, action: 'skip' });
                            tools.logger.log('BatchExtraction', `Skipping background personality tasks for non-core character: ${char} (${importance})`);
                            tools.logger.runtime(`Skipping evolution for entity '${char}' (Importance: ${importance}).`);
                        } else {
                            diagnostics.decisions.push({ character: char, importance: importance || 'undefined-as-core', importanceSource, ...importanceResult, action: 'track' });
                            majorCharacters.push(char);
                        }
                    }

                    diagnostics.selectedCharacters = majorCharacters;
                    tools.logger.turn('Personality Tracker Diagnostics', diagnostics);

                    if (majorCharacters.length > 0) {
                        tools.logger.log('BatchExtraction', `Personality tracker selected characters: ${majorCharacters.join(', ')}`);
                        tools.logger.runtime(`Detecting personality shifts for active characters: ${majorCharacters.join(', ')}.`);
                        await logic.extractAndStoreBatchPersonalityChanges(turnContext, tools, majorCharacters);

                        // Consolidate history for active major characters if needed
                        tools.logger.runtime(`Checking if any character development ledgers need consolidation.`);
                        await logic.consolidatePersonalityHistory(tools, turnContext.projectName, majorCharacters);
                    } else {
                        tools.logger.log('BatchExtraction', 'No major characters to process in background.');
                        tools.logger.runtime(`No major characters in scene. Skipping evolution check.`);
                    }
                } catch (error) {
                    tools.logger.error('BatchExtraction', `Error in batch personality extraction: ${error.message}`);
                    tools.logger.runtime(`CRITICAL ERROR in background tasks: ${error.message}`);
                } finally {
                    tools.logger.log('BatchExtraction', 'HOOK_VN_BACKGROUND_TASKS complete for personality tracker.', 'end');
                    tools.logger.runtime(`Background processing finished.`);
                }
            }
        },

        /**
         * Parallel-blocking hook called when new characters are identified in a scene.
         * Used to bootstrap initial personality for them.
         */
        'HOOK_NEW_CHARACTER_IDENTIFIED': {
            priority: 40,
            mode: 'parallel',
            eta: { default: { min: 10000, max: 20000 } },
            run: async (turnContext, tools) => {
                const rawNewCharacters = turnContext.processed.newlyIntroducedCharacters || [];

                tools.logger.runtime(`HOOK_NEW_CHARACTER_IDENTIFIED: Checking ${rawNewCharacters.length} new entities.`);

                if (rawNewCharacters.length === 0) return;

                // Only bootstrap core characters (or major if toggled)
                const csSettings = tools.settings.get('character_sheets') || {};
                const allowMajor = csSettings.track_major_personality === true;

                const newCharacters = [];
                for (const charName of rawNewCharacters) {
                    const { importance, source } = await resolveTrackingImportance(turnContext, tools, charName);

                    if (importance === 'minor' || importance === 'noncharacter' || (importance === 'major' && !allowMajor)) {
                        tools.logger.log('InitialExtraction', `Skipping personality initialization for non-core character: ${charName} (${importance}, source=${source})`);
                        tools.logger.runtime(`'${charName}' tracking is disabled (${importance}, source=${source}). Skipping personality initialization.`);
                    } else {
                        newCharacters.push(charName);
                    }
                }

                if (newCharacters.length === 0) {
                    tools.logger.log('InitialExtraction', 'No major new characters to process for personality.');
                    tools.logger.runtime(`No major new characters require personality bootstrapping.`);
                    return;
                }

                await tools.jobs.withJob('Analyzing personalities for new characters...', {
                    id: 'personality_tracker_new_character_bootstrap',
                    scope: 'turn',
                    rethrow: false,
                    notifyOnComplete: false
                }, async (job) => {
                    try {
                        job.progress(15, `Bootstrapping ${newCharacters.length} personality profiles...`);
                        tools.logger.log('InitialExtraction', `HOOK_NEW_CHARACTER_IDENTIFIED fired. Major new characters: ${JSON.stringify(newCharacters)}`, 'start');
                        tools.logger.runtime(`Bootstrapping personalities for: ${newCharacters.join(', ')}.`);
                        const dialogue = turnContext.processed.dialogueProcessor.dialogue;
                        const staticDataManager = turnContext.runtime.staticDataManager;

                        const extractionPromises = newCharacters.map(async (charName) => {
                            let characterData;
                            const cleanedCharacterName = charName.trim();

                            try {
                                const cachedSheet = await staticDataManager.getCharacterSheet(cleanedCharacterName);
                                if (cachedSheet && cachedSheet.character_sheet_data) {
                                    tools.logger.log('InitialExtraction', `Using character sheet for initial personality extraction for: ${charName}`);
                                    tools.logger.runtime(`Found character sheet for '${charName}'. Using it for high-fidelity persona extraction.`);
                                    characterData = cachedSheet.character_sheet_data;
                                } else {
                                    tools.logger.log('InitialExtraction', `No character sheet found for ${charName}. Using scene context.`);
                                    tools.logger.runtime(`No sheet found for '${charName}'. Extrapolating traits from scene context.`);
                                    characterData = `You must extract the personality vectors JUST for character ${charName}. If this character is known from fiction, use your own knowledge to fill in the vectors, otherwise, extrapolate every vector from their interactions in the following text:\n\n${dialogue}`;
                                }
                            } catch (error) {
                                tools.logger.error('InitialExtraction', `Error accessing character sheet for ${charName}.`, null, error);
                                tools.logger.runtime(`Error finding sheet for '${charName}'. Falling back to scene context.`);
                                characterData = `You must extract the personality vectors JUST for character ${charName}. If this character is known from fiction, use your own knowledge to fill in the vectors, otherwise, extrapolate every vector from their interactions in the following text:\n\n${dialogue}`;
                            }

                            return logic.extractAndStoreInitialPersonalityVectors(turnContext, tools, characterData, charName);
                        });

                        await Promise.all(extractionPromises);
                        tools.logger.log('InitialExtraction', 'Initial personality extraction complete.', 'end');
                        tools.logger.runtime(`Initial personality extraction complete.`);
                        job.progress(100, 'Personality bootstrapping complete.');
                    } catch (error) {
                        tools.logger.error('InitialExtraction', `Error in new character personality identification: ${error.message}`);
                        tools.logger.runtime(`Error during personality identification: ${error.message}`);
                        throw error;
                    }
                });
            }
        }
    },

    timelineProviders: [
        {
            type: 'branch',
            side: 'right', // Fits with character internal data
            fn: async (turnContext, tools) => {
                const projectName = turnContext.projectName;
                if (!projectName) return null;
                const targetTurn = turnContext.turnNumber;

                try {
                    // 1. Fetch all personality shifts that happened EXACTLY on this turn
                    const traitsStr = logic.getTraitList();
                    const traitIds = traitsStr ? traitsStr.split(', ') : [];

                    if (traitIds.length === 0) return null;

                    const placeholders = traitIds.map(() => '?').join(',');
                    const params = [projectName.toLowerCase(), targetTurn, ...traitIds];

                    const turnShifts = await tools.db.chat.query(
                        `SELECT source, predicate as trait, fact_value as delta, context as brief
                         FROM facts 
                         WHERE project_name = ? AND turn_number = ? 
                         AND predicate IN (${placeholders})`,
                        params
                    );

                    if (!turnShifts || turnShifts.length === 0) return null;

                    // 2. Group by character
                    const charActivity = {};
                    for (const shift of turnShifts) {
                        if (!shift.source) continue; // Safety check
                        const charName = shift.source.toLowerCase();
                        if (!charActivity[charName]) {
                            charActivity[charName] = {
                                name: charName,
                                deltas: {},
                                briefs: []
                            };
                        }

                        // We aggregate deltas in case multiple facts occurred for the same trait (unlikely but safe)
                        charActivity[charName].deltas[shift.trait] = (charActivity[charName].deltas[shift.trait] || 0) + Number(shift.delta || 0);

                        if (shift.brief && shift.brief !== 'Scene-based change') {
                            charActivity[charName].briefs.push(shift.brief);
                        }
                    }

                    // If no valid character shifts found after filtering, bail out early
                    if (Object.keys(charActivity).length === 0) return null;

                    // 3. For each active character, get cumulative programmatic trait summary for archetype/labeling
                    const allTraits = {};
                    for (const charName in charActivity) {
                        const progSummary = await logic.getProgrammaticPersonalitySummary(tools, charName, projectName, { turnNumber: targetTurn });
                        allTraits[charName] = progSummary;
                    }

                    // 4. Fetch rolling summaries for this turn
                    const histories = await tools.db.chat.query(
                        `SELECT source, context FROM facts 
                         WHERE project_name = ? AND turn_number = ? AND predicate = 'personality_history_summary'`,
                        [projectName.toLowerCase(), targetTurn]
                    );
                    const charSummaries = {};
                    for (const hist of histories) {
                        if (hist.source) {
                            charSummaries[hist.source.toLowerCase()] = hist.context;
                        }
                    }

                    const children = [];
                    for (const charName in charActivity) {
                        const act = charActivity[charName];

                        // Aesthetic colors for common domains (OCEAN roughly mapped)
                        const getTraitColor = (trait) => {
                            const t = trait.toLowerCase();
                            if (t.includes('openness')) return '#00bcd4';
                            if (t.includes('conscientiousness')) return '#4caf50';
                            if (t.includes('extraversion')) return '#ff9800';
                            if (t.includes('agreeableness')) return '#e91e63';
                            if (t.includes('neuroticism')) return '#9c27b0';
                            if (t.includes('axis')) return '#f44336';
                            return '#ffc107'; // default
                        };

                        // Determine primary trait color based on highest absolute delta shift this turn
                        let maxDelta = 0;
                        let maxTrait = '';
                        for (const [trait, delta] of Object.entries(act.deltas)) {
                            if (Math.abs(delta) > maxDelta) {
                                maxDelta = Math.abs(delta);
                                maxTrait = trait;
                            }
                        }
                        const color = maxTrait ? getTraitColor(maxTrait) : '#00bcd4';

                        const displayName = act.name.charAt(0).toUpperCase() + act.name.slice(1);

                        // Combine briefs if multiple
                        const briefText = act.briefs.length > 0 ? act.briefs.join(' | ') : null;

                        // Score Deltas Breakdown
                        const deltaLines = Object.entries(act.deltas).map(([trait, delta]) => {
                            const vColor = getTraitColor(trait);
                            const symbol = delta > 0 ? '+' : '';
                            // Clean up trait names like "lawful_chaotic_axis" -> "Lawful Chaotic Axis"
                            const cleanTrait = trait.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            return `<span style="color: ${vColor}; margin-right: 8px;">${cleanTrait}: ${symbol}${delta.toFixed(1)}</span><br>`;
                        }).join('');

                        children.push({
                            title: displayName,
                            text: `
                                <div class="psyche-shift-card" style="--local-accent: ${color};">
                                    <div class="psyche-shift-header">
                                        <div class="psyche-shift-label">
                                            <span>Behavioral Shift</span>
                                        </div>
                                    </div>
                                    ${briefText ? `<div class="psyche-shift-brief">"${briefText}"</div>` : ''}
                                    <div class="psyche-shift-deltas">
                                        ${deltaLines}
                                    </div>
                                </div>
                            `
                        });
                    }

                    // Collect rolling summaries into a single consolidated array
                    const summaries = [];
                    for (const charName in charActivity) {
                        const act = charActivity[charName];
                        const rollingSummary = charSummaries[charName];
                        if (rollingSummary) {
                            const displayName = act.name.charAt(0).toUpperCase() + act.name.slice(1);
                            summaries.push({ title: displayName, text: rollingSummary });
                        }
                    }

                    const subtext = `${children.length} dynamic psychological shift${children.length > 1 ? 's' : ''}.`;

                    return {
                        id: 'personality',
                        icon: '🧠',
                        title: 'Psychological Shifts',
                        label: 'Psyche',
                        content: subtext,
                        children: children,
                        summaries: summaries.length > 0 ? summaries : undefined
                    };

                } catch (e) {
                    tools.logger.error('Timeline', 'Failed to fetch personality activity: ' + e.message);
                    return null;
                }
            }
        }
    ]
};
