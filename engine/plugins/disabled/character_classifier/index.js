// plugins/character_classifier/index.js

const logic = require('./logic.js');

module.exports = {
    id: 'character_classifier',
    name: 'Character Classifier',
    author: 'Fablekin Core',
    version: '1.1.0',
    category: 'Characters',
    wizard: {
        include: true,
        order: 400,
        group: 'Characters',
        label: 'Character Classifier',
        recommended_enabled: true,
        author_note: 'Small cost, useful payoff: this helps other systems understand who is active in a scene.',
        enabled_note: 'Classifies scene characters so downstream plugins can target characters more accurately.',
        disabled_note: 'Character-aware plugins may fall back to weaker heuristics or skip targeted behavior.',
        settings_note: 'Tune classifier model and confidence behavior in plugin settings.'
    },
    optionalDependencies: [
        { id: 'tts_core', reason: 'If gendered generic voices like "old_man" or "young_woman" are available, this plugin can classify and persist a character\'s generic voice profile.' }
    ],
    description: 'Proactively identifies and stores character attributes (Gender and Narrative Importance) by analyzing character sheets and narrative context. Used to optimize system costs by filtering minor NPCs. Gender is important for TTS/Sprites, and Narrative Importance (Major/Minor) is important to save tokens, we don\'t want to execute complex character functions on minor/nonexistent NPCs.',

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Automatically identifies and classifies characters in the story context. Uses LLM analysis to differentiate between Core Heroines, Recurring Major NPCs, and Background/Generic entities.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'A cost-optimization engine that performs proactive metadata extraction for every discovered character. It identifies "CORE" (persistent partners), "MAJOR" (recurring NPCs), and "MINOR" (unimportant entities) importance levels, as well as grammatical gender for TTS and VFX synchronization. This prevents the engine from wasting expensive LLM resources on background characters while ensuring high-fidelity tracking for pivotal cast members.'
        },
        GENERIC_SPRITE_PROFILE_OVERVIEW: {
            type: 'description',
            content: 'When semantic generic sprites are available (for example, elf/human_woman variants), this plugin can classify and persist a character\'s generic sprite profile. VN runtime then hydrates those saved profiles before sprite resolution so fallback sprites stay context-aware and consistent.'
        },
        GENERIC_VOICE_PROFILE_OVERVIEW: {
            type: 'description',
            content: 'When semantic generic voices are available (for example, old_man or monster variants), this plugin can classify and persist a character\'s generic voice profile. TTS runtime then hydrates those saved profiles before voice generation so fallback voices stay context-aware and consistent.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Low',
            immersion: 'None',
            cost: 'Low',
            latency: 'Low'
        },
        model_def: {
            type: 'select',
            label: 'Classifier Model',
            description: 'Model used for character classification. A fast, medium-end model is usually sufficient.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        retries: {
            type: 'number',
            label: 'Max Retries',
            description: 'Number of times to retry if the LLM call fails.',
            default: 3
        },
        timeout: {
            type: 'number',
            label: 'Request Timeout (ms)',
            description: 'Timeout for the LLM request in milliseconds.',
            default: 20000
        },
        temperature: {
            type: 'number',
            label: 'Temperature',
            description: 'Controls randomness. Lower is more deterministic.',
            default: 0.1,
            min: 0,
            max: 1
        },
        low_confidence_threshold: {
            type: 'number',
            label: 'Low Confidence Threshold',
            description: 'Scores below this threshold in Tier 2 (Signal Scoring) will be auto-rejected as "noncharacter".',
            default: 30,
            min: 0,
            max: 100
        },
        enable_periodic_cleanup: {
            type: 'checkbox',
            label: 'Enable Periodic Registry Cleanup',
            description: 'Every few turns, reviews low-evidence MAJOR entries with narrative context and reclassifies junk as MINOR or NONCHARACTER.',
            default: true
        },
        cleanup_frequency: {
            type: 'number',
            label: 'Cleanup Frequency (Turns)',
            description: 'How often the character registry cleanup audit runs.',
            default: 5,
            min: 3,
            max: 100
        },
        cleanup_candidate_limit: {
            type: 'number',
            label: 'Cleanup Candidate Limit',
            description: 'Maximum number of suspicious MAJOR entries to audit in one cleanup pass.',
            default: 10,
            min: 1,
            max: 50
        },
        cleanup_min_confidence: {
            type: 'number',
            label: 'Cleanup Min Confidence',
            description: 'Minimum LLM confidence required before automatic cleanup applies a demotion.',
            default: 0.75,
            min: 0.5,
            max: 1
        },
        cleanup_min_turns_between_reaudit: {
            type: 'number',
            label: 'Cleanup Min Turns Between Re-Audits',
            description: 'Cooldown window before the same character can be cleanup-audited again.',
            default: 3,
            min: 0,
            max: 100
        },
        casting_logic: {
            type: 'project-directive',
            label: 'Character Archetypes & Casting',
            description: 'Define how the AI interprets character roles and importance. Control the "flavor" of the cast.',
            placeholder: 'e.g., "In this dystopian futuristic fiction, humans use codes. Treat \'05\' and other codes as proper major characters."',
            isProjectDirective: true
        }
    },

    exports: {
        /**
         * Retrieves the importance of a character from the database.
         */
        getImportance: async (turnContext, tools, characterName) => {
            return await logic.getImportanceFact(tools, characterName);
        },
        isNewCharacter: async (turnContext, tools, characterName) => {
            return await logic.isNewCharacter(tools, characterName, turnContext.turnNumber);
        },
        hydrateGenericVoiceProfiles: async (turnContext, tools) => {
            return await logic.hydrateGenericVoiceProfiles(turnContext, tools);
        }
    },

    terminalCommands: {
        '/cc': {
            description: 'Character Classifier toolkit. Usage: /cc show | cleanup [-n <limit>] [confirm]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
                const subcommand = String(args[0] || '').toLowerCase();

                if (!subcommand || subcommand === 'help') {
                    return `\r\n${colors.bright}Character Classifier Toolkit${colors.reset}\r\n` +
                        `Usage: /cc ${colors.cyan}show${colors.reset} | ${colors.cyan}cleanup${colors.reset} ${colors.grey}[-n <limit>] [confirm]${colors.reset}\r\n\r\n` +
                        `${colors.bright}Subcommands:${colors.reset}\r\n` +
                        `  ${colors.cyan}show${colors.reset}            - Show character classifications.\r\n` +
                        `  ${colors.cyan}cleanup${colors.reset}         - Call classifier LLM, show findings, and save a pending cleanup plan.\r\n` +
                        `  ${colors.cyan}cleanup confirm${colors.reset} - Apply the latest saved cleanup plan (no blind reclassification).\r\n\r\n` +
                        `${colors.bright}Examples:${colors.reset}\r\n` +
                        `  /cc show\r\n` +
                        `  /cc cleanup\r\n` +
                        `  /cc cleanup -n 20\r\n` +
                        `  /cc cleanup confirm\r\n`;
                }

                if (subcommand === 'show') {
                    const projectName = (tools.turnContext?.projectName || '').toLowerCase();
                    const turnNumber = tools.turnContext?.turnNumber || 0;
                    if (!projectName) {
                        return `${colors.yellow}No active project found.${colors.reset}`;
                    }

                    const rows = await tools.db.chat.query(
                        `SELECT source, predicate, fact_value 
                         FROM facts 
                         WHERE project_name = ? AND predicate IN ('IMPORTANCE', 'HAS_GENDER') 
                         AND turn_number <= ? 
                         ORDER BY id ASC`,
                        [projectName, turnNumber]
                    );

                    if (!rows || rows.length === 0) {
                        return `${colors.cyan}No character classifications found in this project yet.${colors.reset}`;
                    }

                    const map = new Map();
                    for (const row of rows) {
                        const source = (row.source || '').toLowerCase();
                        if (!source) continue;
                        if (!map.has(source)) {
                            map.set(source, { name: row.source, importance: 'unknown', gender: 'unknown' });
                        }
                        const entry = map.get(source);
                        if (row.predicate === 'IMPORTANCE') {
                            entry.importance = (row.fact_value || '').toLowerCase();
                        } else if (row.predicate === 'HAS_GENDER') {
                            entry.gender = (row.fact_value || '').toLowerCase();
                        }
                    }

                    const entries = Array.from(map.values());
                    const lines = entries.map((entry, idx) => {
                        const impColor = entry.importance === 'major' ? colors.cyan : entry.importance === 'minor' ? colors.green : colors.grey;
                        return `${colors.yellow}${idx + 1}.${colors.reset} ${colors.bright}${entry.name}${colors.reset} -> ` +
                            `Importance: ${impColor}${entry.importance.toUpperCase()}${colors.reset}, ` +
                            `Gender: ${colors.magenta}${entry.gender.toUpperCase()}${colors.reset}`;
                    });

                    return `\r\n${colors.bright}Character Classifications for ${projectName}${colors.reset}\r\n` +
                        `${lines.join('\r\n')}\r\n`;
                }

                if (subcommand !== 'cleanup' && subcommand !== 'reclassify') {
                    return `${colors.yellow}Unknown subcommand. Use /cc help.${colors.reset}`;
                }

                let requestedLimit = 15;
                const nIndex = args.indexOf('-n');
                if (nIndex !== -1 && args[nIndex + 1]) {
                    const parsed = parseInt(args[nIndex + 1], 10);
                    if (!isNaN(parsed)) requestedLimit = parsed;
                }
                requestedLimit = Math.max(1, Math.min(200, requestedLimit));
                const confirmed = args.some(a => String(a).toLowerCase() === 'confirm');

                if (confirmed) {
                    const plan = await logic.loadLatestCleanupPlan(tools);
                    if (!plan || !plan.entries || plan.entries.length === 0) {
                        return `${colors.yellow}No saved cleanup findings were found.${colors.reset}\r\n` +
                            `${colors.yellow}Run /cc cleanup first so the classifier LLM can evaluate candidates.${colors.reset}`;
                    }

                    const alreadyApplied = await logic.isCleanupPlanApplied(tools, plan.runId);
                    if (alreadyApplied) {
                        return `${colors.grey}Cleanup plan ${plan.runId} was already applied.${colors.reset}\r\n` +
                            `${colors.grey}Run /cc cleanup again to generate a fresh plan.${colors.reset}`;
                    }

                    const demoted = [];
                    const kept = [];
                    const failed = [];
                    const runLog = [];

                    tools.status?.update?.(`Applying saved cleanup plan... (${plan.entries.length} entries)`);
                    try {
                        for (const entry of plan.entries) {
                            const decision = String(entry.llmImportance || 'major').toLowerCase();
                            const reason = String(entry.llmReasoning || '').trim() || 'No reason provided.';

                            try {
                                if (decision === 'minor' || decision === 'noncharacter') {
                                    await logic.reclassifyCharacterImportance(tools, entry, decision, `CLI cleanup confirm (${decision}): ${reason}`);
                                    demoted.push({ name: entry.displayName, from: decision, reason });
                                    runLog.push(`- ${entry.displayName}: ${colors.green}${decision.toUpperCase()}${colors.reset} -> reclassified to ${decision.toUpperCase()}`);
                                } else {
                                    kept.push({ name: entry.displayName, reason });
                                    runLog.push(`- ${entry.displayName}: ${colors.cyan}MAJOR${colors.reset} -> kept`);
                                }
                            } catch (error) {
                                failed.push({ name: entry.displayName, error: error.message });
                                runLog.push(`- ${entry.displayName}: ${colors.yellow}ERROR${colors.reset} (${error.message})`);
                            }
                        }
                    } finally {
                        tools.status?.clear?.();
                    }

                    await logic.markCleanupPlanApplied(tools, plan.runId, {
                        demoted: demoted.length,
                        kept: kept.length,
                        failed: failed.length
                    });

                    const summary = [
                        `${colors.bold}${colors.magenta}Character Cleanup Applied${colors.reset}`,
                        `${colors.grey}Plan: ${plan.runId}${colors.reset}`,
                        `${colors.green}Demoted:${colors.reset} ${demoted.length}`,
                        `${colors.cyan}Kept:${colors.reset} ${kept.length}`,
                        `${colors.yellow}Failed:${colors.reset} ${failed.length}`
                    ];

                    return `${summary.join('\r\n')}\r\n\r\n${runLog.join('\r\n')}`;
                }

                const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                const preview = await logic.getCleanupCandidates(tools, {
                    limit: requestedLimit,
                    minTurnsSinceAudit: Number(settings.cleanup_min_turns_between_reaudit ?? 3)
                });

                if (!preview.candidates || preview.candidates.length === 0) {
                    return `${colors.green}No suspicious MAJOR entries found for cleanup.${colors.reset}\r\n` +
                        `${colors.grey}Scanned MAJOR entries: ${preview.totalMajor || 0}${colors.reset}`;
                }

                const findings = [];
                const failed = [];
                const runLog = [];

                tools.status?.update?.(`Calling classifier LLM... (0/${preview.candidates.length})`);
                try {
                    for (let i = 0; i < preview.candidates.length; i++) {
                        const candidate = preview.candidates[i];
                        tools.status?.update?.(`Calling classifier LLM... (${i + 1}/${preview.candidates.length}) ${candidate.displayName}`);

                        runLog.push(`- Calling classifier LLM for ${candidate.displayName}...`);
                        try {
                            const decision = await logic.classifyCleanupCandidate(tools, candidate);
                            await logic.recordCleanupAudit(tools, candidate, {
                                mode: 'cli_preview',
                                decision: decision.importance,
                                confidence: decision.confidence,
                                applied: false,
                                reason: decision.reasoning
                            });
                            findings.push({
                                ...candidate,
                                llmImportance: decision.importance,
                                llmReasoning: decision.reasoning,
                                llmConfidence: decision.confidence
                            });
                            runLog.push(`  -> ${colors.cyan}${decision.importance.toUpperCase()}${colors.reset} (${Math.round((decision.confidence ?? 0) * 100)}%): ${decision.reasoning}`);
                        } catch (error) {
                            failed.push({ name: candidate.displayName, error: error.message });
                            runLog.push(`  -> ${colors.yellow}ERROR${colors.reset}: ${error.message}`);
                        }
                    }
                } finally {
                    tools.status?.clear?.();
                }

                if (findings.length === 0) {
                    return `${colors.yellow}Cleanup analysis failed for all candidates.${colors.reset}\r\n` +
                        `${runLog.join('\r\n')}`;
                }

                const saved = await logic.saveCleanupPlan(tools, { entries: findings });
                const suggestedDemotions = findings.filter(f => f.llmImportance === 'minor' || f.llmImportance === 'noncharacter');
                const suggestedKeep = findings.length - suggestedDemotions.length;

                const lines = findings.map((f, i) => {
                    const decisionColor = (f.llmImportance === 'minor' || f.llmImportance === 'noncharacter') ? colors.green : colors.cyan;
                    const heuristic = (f.reasons || []).slice(0, 2).join('; ');
                    return `${colors.cyan}${i + 1}.${colors.reset} ${colors.yellow}${f.displayName}${colors.reset} ` +
                        `${colors.grey}(score ${f.score}, lines ${f.stats?.totalLines ?? 0}, turns ${f.stats?.turnsSeen ?? 0})${colors.reset}\r\n` +
                        `   ${decisionColor}${String(f.llmImportance || 'major').toUpperCase()}${colors.reset} ` +
                        `${colors.grey}(${Math.round((f.llmConfidence ?? 0) * 100)}%) - ${f.llmReasoning}${colors.reset}\r\n` +
                        `   ${colors.grey}${heuristic}${colors.reset}`;
                }).join('\r\n');

                const summary = [
                    `${colors.bold}${colors.magenta}Character Cleanup Findings${colors.reset}`,
                    `${colors.grey}Plan saved: ${saved.runId}${colors.reset}`,
                    `${colors.green}Suggested Demotions:${colors.reset} ${suggestedDemotions.length}`,
                    `${colors.cyan}Suggested Keep:${colors.reset} ${suggestedKeep}`,
                    `${colors.yellow}Failed:${colors.reset} ${failed.length}`
                ];

                return `${summary.join('\r\n')}\r\n\r\n${lines}\r\n\r\n` +
                    `${colors.yellow}No reclassification has been applied yet.${colors.reset}\r\n` +
                    `${colors.yellow}To apply this saved plan, run: /cc cleanup confirm${colors.reset}\r\n\r\n` +
                    `${runLog.join('\r\n')}`;
            }
        }
    },

    hooks: {
        /**
         * Sequential hook to classify characters found in newly processed character sheets.
         * Runs after character_sheets plugin (priority 10) to consume its output.
         * Character sheets imply MAJOR importance by default.
         */
        'HOOK_PRE_PROMPT_BUILDER': {
            priority: 20,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                if (turnContext?.turnNumber) {
                    tools.logger.runtime(`[Cleanup] Purging character classification facts before rebuilding current turn metadata.`);
                    await tools.facts.cleanUpFactsDb();
                }

                const characterSheets = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];

                tools.logger.runtime(`HOOK_PRE_PROMPT_BUILDER: Starting classification and metadata loading.`);

                if (!turnContext.processed.characterMetadata) {
                    turnContext.processed.characterMetadata = {};
                }

                // --- 1. Load existing importance for all party members from previous turn ---
                const history = await turnContext.retrieveDatedChapters();
                const lastTurn = (history.fullchapters || []).slice(-1)[0];
                const activeNames = new Set();

                if (lastTurn?.output?.party) {
                    lastTurn.output.party.forEach(n => activeNames.add(n));
                }
                // Also include core sheets
                characterSheets.forEach(s => activeNames.add(s.name));

                if (activeNames.size > 0) {
                    tools.logger.runtime(`Loading metadata for ${activeNames.size} active characters from DB.`);
                    const loadPromises = Array.from(activeNames).map(async (name) => {
                        const importance = await logic.getImportanceFact(tools, name);
                        if (importance) {
                            const charKey = name.toLowerCase();
                            if (!turnContext.processed.characterMetadata[charKey]) {
                                turnContext.processed.characterMetadata[charKey] = { importance };
                            }
                        }
                    });
                    await Promise.all(loadPromises);
                }

                // --- 2. Process Current Sheets ---
                if (characterSheets.length > 0) {
                    tools.logger.log('Generation', `Analyzing ${characterSheets.length} character sheets for classification.`, 'start');
                    for (const item of characterSheets) {
                        const charName = item.name;
                        const sheetContent = item.sheet;
                        const charKey = charName.toLowerCase();

                        // Character from sheet is ALWAYS Major. Only save if not already in DB.
                        if (!turnContext.processed.characterMetadata[charKey]?.importance) {
                            await logic.saveImportanceFact(tools, charName, 'major');
                            turnContext.processed.characterMetadata[charKey] = { importance: 'major' };
                        }

                        // Check for gender
                        const alreadyKnown = await logic.hasGenderFact(tools, charName);
                        if (!alreadyKnown) {
                            const gender = await logic.classifyGenderOnly(tools, charName, sheetContent);
                            if (gender) {
                                await logic.saveGenderFact(tools, charName, gender);
                                turnContext.processed.characterGenders.set(charKey, gender);
                                turnContext.processed.characterMetadata[charKey].gender = gender;
                            }
                        } else {
                            const gender = turnContext.processed.characterGenders.get(charKey);
                            turnContext.processed.characterMetadata[charKey].gender = gender;
                        }
                    }
                    tools.logger.log('Generation', 'Character classification from sheets complete.', 'end');
                }

                tools.logger.runtime(`Finished classification and metadata loading.`);
            }
        },

        /**
         * HIGH PRIORITY hook to classify new characters identified in a turn.
         * This runs BEFORE Relationship/Personality trackers to allow them to skip minor NPCs.
         */
        'HOOK_NEW_CHARACTER_IDENTIFIED': {
            priority: 10, // Run very early
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const newCharacters = turnContext.processed.newlyIntroducedCharacters || [];

                tools.logger.runtime(`HOOK_NEW_CHARACTER_IDENTIFIED: Starting triage for new characters.`);

                if (newCharacters.length === 0) {
                    tools.logger.runtime(`No new characters detected in this turn.`);
                    return;
                }

                if (!turnContext.processed.characterMetadata) {
                    turnContext.processed.characterMetadata = {};
                }

                tools.logger.log('Triage', `Triage started for ${newCharacters.length} new entities.`, 'start');
                tools.logger.runtime(`New characters to triage: ${newCharacters.join(', ')}.`);

                const triagePromises = newCharacters.map(async (charName) => {
                    try {
                        const charKey = charName.toLowerCase();

                        // 1. Check if already classified in this turn's context (e.g., from sheets)
                        let contextImportance = null;
                        const contextMetadata = turnContext.processed.characterMetadata[charKey];
                        if (contextMetadata?.importance) {
                            tools.logger.log('Triage', `Already classified in context: '${charName}' is ${String(contextMetadata.importance).toUpperCase()}.`);
                            contextImportance = String(contextMetadata.importance).toLowerCase();
                            if (contextImportance !== 'minor') {
                                return;
                            }
                        }

                        // 2. Check database for existing classification
                        const existingImportance = await logic.getImportanceFact(tools, charName) || contextImportance;
                        if (existingImportance) {
                            tools.logger.log('Triage', `Existing record found in DB: '${charName}' is ${existingImportance.toUpperCase()}.`);
                            turnContext.processed.characterMetadata[charKey] = { importance: existingImportance };

                            if (existingImportance !== 'minor') {
                                return;
                            }

                            const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                            const reconsider = logic.shouldReclassifyMinorCharacter(charName, turnContext, settings);
                            if (!reconsider.shouldReclassify) {
                                tools.logger.runtime(`Previously MINOR character '${charName}' did not meet reclassification signals (${reconsider.reason}).`);
                                return;
                            }

                            tools.logger.runtime(`Previously MINOR character '${charName}' met reclassification signals (${reconsider.reason}). Re-running normal triage.`);
                        }

                        // 3. Three-Tier Triage (Heuristics -> Scoring -> LLM)
                        tools.logger.runtime(existingImportance === 'minor'
                            ? `'${charName}' is previously MINOR. Requesting re-triage...`
                            : `'${charName}' is unknown. Requesting triage...`);
                        const result = await logic.triageCharacter(tools, charName, turnContext);
                        if (result) {
                            turnContext.processed.characterMetadata[charKey] = result;

                            await Promise.all([
                                logic.saveImportanceFact(tools, charName, result.importance),
                                result.importance !== 'noncharacter' && result.gender !== 'unknown'
                                    ? logic.saveGenderFact(tools, charName, result.gender)
                                    : Promise.resolve(),
                                result.importance !== 'noncharacter' && result.genericSpriteProfile
                                    ? logic.saveGenericSpriteProfileFact(tools, charName, result.genericSpriteProfile)
                                    : Promise.resolve(),
                                result.importance !== 'noncharacter' && result.genericVoiceProfile
                                    ? logic.saveGenericVoiceProfileFact(tools, charName, result.genericVoiceProfile)
                                    : Promise.resolve()
                            ]);

                            if (result.gender !== 'unknown') {
                                turnContext.processed.characterGenders.set(charKey, result.gender);
                            }
                        }
                    } catch (error) {
                        tools.logger.error('Triage', `Failed to triage individual character '${charName}': ${error.message}`);
                    }
                });

                await Promise.all(triagePromises);
                tools.logger.log('Triage', 'Triage complete.', 'end');
                tools.logger.runtime(`All new character triage complete.`);
            }
        },

        'HOOK_VN_PIPELINE_TASKS': {
            priority: 46,
            mode: 'parallel',
            run: async (_turnContext, _tools) => ({
                key: 'genericSpriteProfileHydration',
                blocking: true,
                after: ['newCharacterIdentification'],
                before: ['spriteResolution'],
                fn: async () => logic.hydrateGenericSpriteProfiles(_turnContext, _tools)
            })
        },

        /**
         * Records dialogue stats and periodically audits low-evidence MAJOR entries.
         * The LLM makes the final cleanup decision from narrative evidence.
         */
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 110,
            mode: 'sequential',
            useSharedVnLlm: true,
            run: async (turnContext, tools) => {
                const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                await logic.recordCharacterTurnStats(turnContext, tools, settings);
                await logic.runPeriodicCleanup(turnContext, tools, settings);
            }
        }
    }
};
