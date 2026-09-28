const logic = require('./logic.js');
const researchAgent = require('./research_agent.js');

function parseTurnSelector(selector, fallbackTurn) {
    if (!selector || selector === 'latest' || selector === 'current') return fallbackTurn;

    const turnNumber = parseInt(selector, 10);
    if (Number.isNaN(turnNumber) || turnNumber < 1) return null;
    return turnNumber;
}

function parseRangeSelector(selector, fallbackEndTurn) {
    if (!selector) return { startTurn: Math.max(1, fallbackEndTurn - 9), endTurn: fallbackEndTurn };

    if (selector.includes('-')) {
        const [rawStart, rawEnd] = selector.split('-');
        const startTurn = parseInt(rawStart, 10);
        const endTurn = parseInt(rawEnd, 10);
        if (Number.isNaN(startTurn) || Number.isNaN(endTurn) || startTurn < 1 || endTurn < startTurn) {
            return null;
        }
        return { startTurn, endTurn };
    }

    const limit = parseInt(selector, 10);
    if (Number.isNaN(limit) || limit < 1) return null;
    return { startTurn: Math.max(1, fallbackEndTurn - limit + 1), endTurn: fallbackEndTurn };
}

function addDirectorCotStep(turnContext, tools, config = {}) {
    if (tools.director?.cot?.add) {
        tools.director.cot.add(config);
        return;
    }
    turnContext.runtime = turnContext.runtime || {};
    turnContext.runtime.director = turnContext.runtime.director || {};
    turnContext.runtime.director.cotPatches = turnContext.runtime.director.cotPatches || [];
    turnContext.runtime.director.cotPatches.push({
        type: 'add',
        id: config.id,
        pluginId: 'grand_story_planner',
        step: config.step,
        title: config.title,
        content: config.content
    });
}

function addWriterCotStep(turnContext, tools, config = {}) {
    if (tools.writer?.cot?.add) {
        tools.writer.cot.add(config);
        return;
    }
    turnContext.processed = turnContext.processed || {};
    turnContext.processed.writerCoTInsertions = Array.isArray(turnContext.processed.writerCoTInsertions)
        ? turnContext.processed.writerCoTInsertions
        : [];
    turnContext.processed.writerCoTInsertions.push({
        content: config.content,
        insertAfterStep: config.insertAfterStep,
        stepIdMode: config.stepIdMode || 'original'
    });
}

async function requestNarrativeArchitectBatch(turnContext, tools, settings = {}) {
    if (settings.architect_integration === false) return false;
    if (!tools.plugins?.isInstalled?.('narrative_architect')) {
        tools.logger.runtime('Grand Story Planner is due, but Narrative Architect is unavailable; continuing without a fresh tag batch.');
        return false;
    }

    const isDue = await researchAgent.shouldRunAutomatically(turnContext, tools, settings);
    if (!isDue) return false;

    const architectState = tools.pluginState
        .forPlugin('narrative_architect')
        .runtime();
    architectState.taggingRequest = {
        schema: 'narrative_architect_tagging_request_v1',
        requestedBy: 'grand_story_planner',
        requestedAtTurn: Number(turnContext.turnNumber || 0),
        batchEndTurn: Math.max(0, Number(turnContext.turnNumber || 0) - 1),
        status: 'requested'
    };

    tools.logger.runtime(`Grand Story Planner requested a Narrative Architect tag batch through Chapter ${architectState.taggingRequest.batchEndTurn}.`);
    return true;
}

function addDirectorGrandPlannerEditorialSteps(turnContext, tools) {
    const steps = [
        {
            id: 'grand_planner.story_state',
            step: '20',
            title: 'Grand Planner - Story State',
            content: 'Read # Story State in <grand_planner_director_card>. Decide whether the next scene should escalate, complicate, breathe, transition, or pay off. This decision must influence SCENE REVIEW.'
        },
        {
            id: 'grand_planner.player_alignment',
            step: '21',
            title: 'Grand Planner - Player Alignment / Taste',
            content: 'Read # Player Alignment / Taste in <grand_planner_director_card>. What has the player accepted, resisted, prolonged, or avoided? Choose one hook likely to matter without pandering, while preserving world logic and character dignity.'
        },
        {
            id: 'grand_planner.cold_discoveries',
            step: '22',
            title: 'Grand Planner - Cold Story Discoveries',
            content: 'Read # Cold Story Discoveries in <grand_planner_director_card>. Pick at most ONE dormant object, promise, relationship, scene, wound, or consequence that can naturally matter soon. If none fits, explicitly leave them dormant.'
        },
        {
            id: 'grand_planner.quality_risks',
            step: '23',
            title: 'Grand Planner - Quality Risks',
            content: 'Read # Quality Risks in <grand_planner_director_card>. Name the most likely bad writing failure this next scene could fall into. Turn it into one concrete Writer Brief warning, not abstract criticism.'
        },
        {
            id: 'grand_planner.character_pressure',
            step: '24',
            title: 'Grand Planner - Character / Relationship Pressure',
            content: 'Read # Character / Relationship Pressure in <grand_planner_director_card>. Which character risks becoming flat, passive, repetitive, or parody-like? Give the Writer one concrete agency-restoring behavior, desire, disagreement, or initiative.'
        },
        {
            id: 'grand_planner.strategic_direction',
            step: '25',
            title: 'Grand Planner - Strategic Direction',
            content: 'Read # Strategic Direction in <grand_planner_director_card>. Select only the parts relevant to the next 1-3 turns. Do not execute the whole plan now. Convert useful pressure into MANDATORY ORDERS or NARRATIVE THREADS.'
        },
        {
            id: 'grand_planner.mystery_guardrails',
            step: '26',
            title: 'Grand Planner - Mystery Guardrails',
            content: 'Read # Mystery Guardrails in <grand_planner_director_card> and the active MYST ledger entries. What must remain hidden? What can be hinted safely? Put prohibitions in MYSTERIES_NOT_TO_REVEAL.'
        },
        {
            id: 'grand_planner.routing_check',
            step: '27',
            title: 'Grand Planner - Routing Check',
            content: 'From the Grand Planner steps, choose at most 2 things for MANDATORY ORDERS, at most 2 things for NARRATIVE THREADS, all necessary spoiler guardrails for MYSTERIES_NOT_TO_REVEAL, and the most important anti-cliche/prose/characterization warnings for WRITING CRITIQUES. Do not dump planner text into WRITER_BRIEF.'
        }
    ];

    for (const step of steps) addDirectorCotStep(turnContext, tools, step);
}

async function injectPublishedResearchCards(turnContext, tools, settings = {}) {
    if (!tools.project?.getChatPluginStorage) return false;
    const latestApplicableTurn = Math.max(1, Number.parseInt(turnContext.turnNumber, 10) - 1);
    const saved = await researchAgent.loadLatestPublishedResearchArtifact(tools, latestApplicableTurn);
    const artifact = saved?.artifact;
    if (!artifact?.published) return false;

    const directorCard = researchAgent.buildGrandPlannerDirectorCard(artifact, {
        maxChars: settings.director_brief_max_chars || 6200
    });
    const writerCard = researchAgent.buildGrandPlannerWriterCard(artifact, {
        maxChars: settings.writer_editorial_max_chars || 2800
    });

    if (directorCard) {
        tools.prompt.contribute('research_director_card', {
            card: tools.prompt.wrap('grand_planner_director_card', directorCard)
        });

        addDirectorGrandPlannerEditorialSteps(turnContext, tools);
    }

    if (writerCard) {
        tools.prompt.contribute('research_writer_card', {
            card: tools.prompt.wrap('grand_planner_writer_card', writerCard)
        });

        addWriterCotStep(turnContext, tools, {
            insertAfterStep: 2,
            stepIdMode: 'original',
            content: `Step 2.5: Grand Planner - Immediate Scene Advice
- Read # Immediate Scene Advice in <grand_planner_writer_card>.
- Extract only advice that applies to this exact chapter.
- Convert it into concrete scene behavior: who acts, what changes, what pressure appears, and what should be avoided.

Step 2.6: Grand Planner - Scene Craft Pattern
- Read # Scene Craft Pattern.
- Use it as structure, not content to copy.
- Identify this chapter's ordinary task, middle complication, emotional turn, and ending behavior-change.

Step 2.7: Grand Planner - Anti-Cliche Guard
- Read # Avoid This.
- Name the exact line-pattern, emotional beat, or narration habit you must avoid.
- Replace it with subtext, action, contradiction, silence, humor, or casual familiarity.

Step 2.8: Grand Planner - Character Guardrails
- Read # Character Guardrails.
- For each key character present, decide one thing they actively want in this scene.
- Make sure they do not only react to the player or repeat their defining trait.

Step 2.9: Grand Planner - Callback Spark
- Read # Optional Callback Spark.
- If the Director included or implied a cold-story callback, integrate it lightly through an object, memory, behavior, consequence, or unfinished thread.
- If it would distract from the player action, do not force it.

Step 2.10: Grand Planner - Mystery Safety
- Read # Mystery Safety.
- You may create tension around the mystery, but must not reveal the protected answer, culprit, mechanism, or future twist.`
        });
    }

    tools.logger.log('Lifecycle', `Injected Grand Planner research cards from Turn ${artifact.turnNumber}${directorCard ? ' for Director' : ''}${writerCard ? ' and Writer' : ''}.`);
    return Boolean(directorCard || writerCard);
}

module.exports = {
    id: 'grand_story_planner',
    name: 'Grand Story Planner',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Narrative',
    wizard: {
        include: true,
        order: 210,
        group: 'Narrative',
        label: 'Grand Story Planner',
        recommended_enabled: true,
        author_note: 'Recommended if you want stronger medium-term plot direction instead of pure turn-by-turn improvisation.',
        enabled_note: 'Adds planning guidance that keeps arcs, foreshadowing, and scene purpose more coherent.',
        disabled_note: 'The writer relies more heavily on immediate context and may drift more over long sessions.',
        settings_note: 'Tune planning model, cadence, and planner references in plugin settings.'
    },
    description: 'Generates and maintains a long-term narrative roadmap, guiding the Orchestrator with hidden arcs and strategic simulation advances.',
    optionalDependencies: [
        { id: 'narrative_pacing', reason: 'Adds pacing signals so the long-term plan can vary pressure, rest, and escalation.' },
        { id: 'narrative_architect', reason: 'Adds structural analysis that helps the planner avoid repeating familiar scene shapes.' },
        { id: 'memory_recall', reason: 'Lets the planner draw on stored long-term memories instead of only recent chapters.' }
    ],

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Acts as the invisible "Director," maintaining a long-term strategic map of the narrative to ensure story arcs reach meaningful conclusions.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Runs a periodic phased planning pipeline after Director, researches story quality, and updates the hidden strategic ledger.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'Medium',
            latency: 'Low'
        },
        model_def: {
            type: 'select',
            label: 'Planning Model',
            description: 'The LLM model used to design and update the world strategy and hidden arcs.',
            options: 'llm-aliases',
            default: { model: 'veryhighendmodel' }
        },
        planner_strategy_mode: {
            type: 'select',
            label: 'Planner Strategy Mode',
            description: 'Choose between single-call planning or a two-call pipeline with a cheap story-needs classifier.',
            options: [
                { label: 'single_call', description: 'Cheaper default. Architect guidance comes from cached context or fallback selection.' },
                { label: 'two_call_classifier', description: 'Adds a cheap classifier call before planning to target better structural references.' }
            ],
            default: 'single_call'
        },
        classifier_model_def: {
            type: 'select',
            label: 'Classifier Model',
            description: 'Cheap model used only when strategy mode is two_call_classifier.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        },
        classifier_retries: {
            type: 'number',
            label: 'Classifier Retries',
            description: 'Retry count for the story-needs classifier call.',
            default: 1
        },
        classifier_timeout: {
            type: 'number',
            label: 'Classifier Timeout (ms)',
            description: 'Timeout for the story-needs classifier call.',
            default: 90000
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
            default: 360000
        },
        update_interval: {
            type: 'number',
            label: 'Update Interval (Turns)',
            description: 'How many turns to wait before the planner reviews the story and updates its master plan.',
            default: 5,
            min: 1,
            max: 50
        },
        story_research_max_calls: {
            type: 'number',
            label: 'Story Research Calls',
            description: 'Maximum calls for narrative archaeology, player-taste analysis, and story diagnosis.',
            default: 6,
            min: 2,
            max: 20
        },
        media_research_max_calls: {
            type: 'number',
            label: 'Media Research Calls',
            description: 'Maximum calls for Narrative Architect and excellent-media research.',
            default: 5,
            min: 2,
            max: 20
        },
        force_update: {
            type: 'checkbox',
            label: 'Force Active (Every Turn)',
            description: 'If enabled, the planner will review and potentially update the story strategy every single turn, ignoring the interval setting.',
            default: false
        },
        planner_context_depth: {
            type: 'number',
            label: 'Planner Context Depth',
            description: 'How many recent chapters should be compacted into the planner context capsule.',
            default: 8,
            min: 3,
            max: 20
        },
        planner_context_turn_chars: {
            type: 'number',
            label: 'Chars Per Chapter Digest',
            description: 'Maximum characters per chapter entry inside the planner context capsule.',
            default: 520,
            min: 240,
            max: 1400
        },
        planner_context_max_chars: {
            type: 'number',
            label: 'Planner Capsule Max Chars',
            description: 'Hard cap for the planner context capsule length.',
            default: 7000,
            min: 1200,
            max: 20000
        },
        architect_integration: {
            type: 'checkbox',
            label: 'Use Narrative Architect Guidance',
            description: 'If enabled, the planner asks Narrative Architect for structural references and uses them as anti-cliche guidance.',
            default: true
        },
        architect_reference_limit: {
            type: 'number',
            label: 'Architect Reference Count',
            description: 'How many structural references to pull from Narrative Architect per planner run.',
            default: 4,
            min: 1,
            max: 8
        },
        director_plan_injection_mode: {
            type: 'select',
            label: 'Director Injection Mode',
            description: 'Controls how much planner data is injected into Director turns.',
            options: [
                { label: 'focused_brief', description: 'Default. Inject only a compact, turn-aware execution brief.' },
                { label: 'full_plan', description: 'Inject the full synthesized plan only.' },
                { label: 'full_plus_brief', description: 'Inject both full plan and focused brief.' }
            ],
            default: 'focused_brief'
        },
        director_brief_item_limit: {
            type: 'number',
            label: 'Director Brief Item Limit',
            description: 'Maximum number of primary actionable items in the focused execution brief.',
            default: 6,
            min: 3,
            max: 12
        },
        director_brief_max_chars: {
            type: 'number',
            label: 'Director Brief Max Chars',
            description: 'Hard cap for the focused execution brief length.',
            default: 3800,
            min: 1200,
            max: 24000
        },
        writer_editorial_max_chars: {
            type: 'number',
            label: 'Writer Editorial Card Max Chars',
            description: 'Hard cap for Grand Planner craft guidance injected into the Writer prompt.',
            default: 2800,
            min: 800,
            max: 8000
        }
    },

    exports: {},

    terminalCommands: {
        '/planner': {
            description: 'Inspect the Grand Story Planner or run its phased planning pipeline. Usage: /planner [show|raw|used|focus|changes|research]',
            run: async (args, tools) => {
                const commandArgs = Array.isArray(args) ? args : [];
                const pluginSettings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                const colors = {
                    reset: '\x1b[0m',
                    bright: '\x1b[1m',
                    cyan: '\x1b[36m',
                    green: '\x1b[32m',
                    yellow: '\x1b[33m',
                    magenta: '\x1b[35m',
                    grey: '\x1b[90m',
                    red: '\x1b[31m'
                };

                const help = () => [
                    `${colors.bright}Grand Story Planner Toolkit${colors.reset}`,
                    `Usage: /planner ${colors.cyan}[subcommand]${colors.reset} ${colors.magenta}[turn_selector]${colors.reset}`,
                    '',
                    `${colors.bright}Subcommands:${colors.reset}`,
                    `  ${colors.cyan}show${colors.reset}      Show the synthesized plan as of the end of a turn.`,
                    `  ${colors.cyan}raw${colors.reset}       Show the exact ledger syntax as of the end of a turn.`,
                    `  ${colors.cyan}used${colors.reset}      Show the plan that would have been injected into the Director for a turn.`,
                    `  ${colors.cyan}focus${colors.reset}     Show the compact turn-aware brief used to guide Director execution.`,
                    `  ${colors.cyan}changes${colors.reset}   Show ledger patches across a range or recent N turns.`,
                    `  ${colors.cyan}research${colors.reset}  Run or inspect the CLI-only agentic story-dive PoC.`,
                    '',
                    `${colors.bright}Examples:${colors.reset}`,
                    `  /planner`,
                    `  /planner show 12`,
                    `  /planner used 12`,
                    `  /planner focus 12`,
                    `  /planner raw latest`,
                    `  /planner changes 1-12`,
                    `  /planner changes 5`,
                    `  /planner research run`,
                    `  /planner research run 8`,
                    `  /planner research show latest`,
                    `  /planner research sections latest`,
                    `  /planner research trace latest`
                ].join('\n');

                const firstArg = commandArgs[0]?.toLowerCase();
                if (!firstArg || firstArg === 'help') return help();

                if (firstArg === 'research') {
                    const researchMode = String(commandArgs[1] || 'help').toLowerCase();
                    const selector = commandArgs[2];
                    const turnContext = tools.turnContext;
                    const activeTurn = turnContext?.turnNumber || 1;

                    if (researchMode === 'run') {
                        if (!turnContext) return `${colors.red}No active turn is available for research.${colors.reset}`;
                        let maxIterations = null;
                        try {
                            maxIterations = researchAgent.resolveTotalCallLimit(commandArgs[2]);
                        } catch (error) {
                            return `${colors.red}${error.message}${colors.reset}`;
                        }
                        const configuredBudgets = researchAgent.resolvePhaseBudgets(pluginSettings, maxIterations);
                        tools.socket.emit('terminal-stream', {
                            output: `${colors.bright}${colors.green}Starting phased Grand Story Planner for Turn ${activeTurn} (${configuredBudgets.total} calls max: story ${configuredBudgets.story}, media ${configuredBudgets.media}, room ${configuredBudgets.room}, plan ${configuredBudgets.plan}, ledger ${configuredBudgets.ledger})...${colors.reset}`
                        });
                        const result = await researchAgent.runResearchAgent(turnContext, tools, {
                            ...(maxIterations === null ? {} : { maxIterations }),
                            onEvent: async (event) => {
                                const output = researchAgent.formatResearchEventForTerminal(event);
                                if (output) tools.socket.emit('terminal-stream', { output });
                            }
                        });
                        const artifact = result.artifact;
                        return [
                            `${colors.bright}Research run finished.${colors.reset}`,
                            `Status: ${artifact.status}${artifact.published ? ' (published)' : ' (not published)'}`,
                            artifact.warnings?.length ? `Warnings: ${artifact.warnings.join(' | ')}` : null,
                            `Calls: ${artifact.iterations}/${artifact.maxIterations}`,
                            `Phases: story ${artifact.phases?.story?.iterations || 0}/${artifact.budgets?.story || 0}, media ${artifact.phases?.media?.iterations || 0}/${artifact.budgets?.media || 0}, room ${artifact.phases?.room?.iterations || 0}/${artifact.budgets?.room || 0}, plan ${artifact.phases?.plan?.iterations || 0}/${artifact.budgets?.plan || 0}, ledger ${artifact.phases?.ledger?.iterations || 0}/${artifact.budgets?.ledger || 0}, objective ${artifact.phases?.objective?.iterations || 0}/${artifact.budgets?.objective || 0}`,
                            artifact.failedPhase ? `Failed phase: ${artifact.failedPhase} - ${artifact.error}` : null,
                            `Turn log: ${artifact.turnLogTitle}`,
                            `Prefix: ${artifact.prefix?.source || 'unavailable'} (${artifact.prefix?.characterCount || 0} chars${artifact.prefix?.reusedDirectorContext ? ', exact Director context reused' : ''})`,
                            `Cache settle: ${artifact.interIterationDelayMs || 0}ms between calls`,
                            `Context: ${artifact.userContext?.historySource || 'unknown'} (${artifact.userContext?.characterCount || 0} chars)`,
                            `Tools: story [${artifact.phases?.story?.tools?.join(', ') || 'none'}], media [${artifact.phases?.media?.tools?.join(', ') || 'model knowledge fallback'}]`,
                            `Saved: ${result.storage.relativePath}/${researchAgent.RESEARCH_ARTIFACT_FILENAME}`
                        ].filter(Boolean).join('\n');
                    }

                    if (researchMode === 'show' || researchMode === 'trace' || researchMode === 'sections') {
                        const wantsLatest = !selector || String(selector).toLowerCase() === 'latest';
                        const requestedTurn = parseTurnSelector(selector, activeTurn);
                        if (!requestedTurn) {
                            return `${colors.red}Invalid turn selector. Use a positive turn number, "latest", or "current".${colors.reset}`;
                        }
                        const saved = wantsLatest
                            ? await researchAgent.loadLatestResearchArtifact(tools, activeTurn)
                            : await researchAgent.loadResearchArtifact(tools, requestedTurn);
                        if (!saved) {
                            const label = wantsLatest ? `Turns 1-${activeTurn}` : `Turn ${requestedTurn}`;
                            return `${colors.yellow}No saved research artifact found for ${label}.${colors.reset}`;
                        }
                        if (researchMode === 'show') {
                            const artifact = saved.artifact;
                            return [
                                `${colors.bright}${colors.green}Grand Story Research - Turn ${artifact.turnNumber}${colors.reset}`,
                                `Status: ${artifact.status} | Published: ${artifact.published === true ? 'yes' : 'no'} | Calls: ${artifact.iterations}/${artifact.maxIterations || researchAgent.RESEARCH_MAX_ITERATIONS}`,
                                artifact.warnings?.length ? `Warnings: ${artifact.warnings.join(' | ')}` : '',
                                artifact.failedPhase ? `Failed phase: ${artifact.failedPhase} - ${artifact.error}` : '',
                                `Prefix: ${artifact.prefix?.available ? `${artifact.prefix.hash} (${artifact.prefix.characterCount} chars, source ${artifact.prefix.source || 'unknown'}${artifact.prefix.reusedDirectorContext ? ', exact Director context reused' : ''})` : 'unavailable'}`,
                                `Cache settle: ${artifact.interIterationDelayMs || 0}ms between calls`,
                                `Context: ${artifact.userContext?.historySource || 'unknown'} (${artifact.userContext?.characterCount || 0} chars)`,
                                '',
                                `${colors.bright}Phase Conclusions${colors.reset}`,
                                researchAgent.formatPhaseConclusionsForTerminal(artifact, { colors })
                            ].filter(Boolean).join('\n');
                        }
                        if (researchMode === 'sections') {
                            return [
                                `${colors.bright}${colors.green}Grand Story Research Sections - Turn ${saved.artifact.turnNumber}${colors.reset}`,
                                `Status: ${saved.artifact.status} | Published: ${saved.artifact.published === true ? 'yes' : 'no'} | Calls: ${saved.artifact.iterations}/${saved.artifact.maxIterations || researchAgent.RESEARCH_MAX_ITERATIONS}`,
                                '',
                                researchAgent.formatResearchSectionsForTerminal(saved.artifact, { colors })
                            ].filter(Boolean).join('\n');
                        }
                        return JSON.stringify({
                            schema: saved.artifact.schema,
                            turnNumber: saved.artifact.turnNumber,
                            status: saved.artifact.status,
                            prefix: saved.artifact.prefix,
                            userContext: saved.artifact.userContext,
                            budgets: saved.artifact.budgets,
                            phaseOrder: saved.artifact.phaseOrder,
                            phaseConclusions: saved.artifact.phaseConclusions || researchAgent.getReadablePhaseConclusions(saved.artifact),
                            phases: saved.artifact.phases,
                            editorial: saved.artifact.editorial,
                            ledger: saved.artifact.ledger,
                            objectiveLedger: saved.artifact.objectiveLedger,
                            events: saved.artifact.events
                        }, null, 2);
                    }

                    return [
                        `${colors.bright}Phased Grand Story Planner${colors.reset}`,
                        'Usage:',
                        `  ${colors.cyan}/planner research run [total_call_ceiling]${colors.reset}  (default ${researchAgent.RESEARCH_MAX_ITERATIONS}, range ${researchAgent.MINIMUM_TOTAL_CALLS}-${researchAgent.RESEARCH_MAX_ITERATIONS_LIMIT})`,
                        `  ${colors.cyan}/planner research show [latest|turn]${colors.reset}`,
                        `  ${colors.cyan}/planner research sections [latest|turn]${colors.reset}`,
                        `  ${colors.cyan}/planner research trace [latest|turn]${colors.reset}`
                    ].join('\n');
                }

                const explicitModes = new Set(['show', 'raw', 'used', 'focus', 'changes', 'ops']);
                if (!explicitModes.has(firstArg)) {
                    return `${colors.red}Unknown subcommand. Use /planner [show|raw|used|focus|changes].${colors.reset}`;
                }

                const mode = firstArg;
                const selector = commandArgs[1];
                const turnContext = tools.turnContext;
                const activeTurn = turnContext?.turnNumber || 1;

                if (mode === 'changes' || mode === 'ops') {
                    const range = parseRangeSelector(selector, activeTurn);
                    if (!range) {
                        return `${colors.red}Invalid range. Use X-Y or a recent-turn limit like 5.${colors.reset}`;
                    }

                    const rows = await logic.getPlanOperationsInRange(turnContext, tools, range.startTurn, range.endTurn);
                    return logic.formatPlanOperationsForTerminal(rows, { colors });
                }

                const requestedTurn = parseTurnSelector(selector, activeTurn);
                if (!requestedTurn) {
                    return `${colors.red}Invalid turn selector. Use a positive turn number, "latest", or "current".${colors.reset}`;
                }

                const lookupTurn = mode === 'used' && requestedTurn > 1 ? requestedTurn - 1 : requestedTurn;
                const entries = await logic.getPlanEntriesForTurn(turnContext, tools, lookupTurn);

                if (mode === 'raw') {
                    return logic.formatPlanEntriesRawForTerminal(entries, { colors });
                }

                if (mode === 'focus') {
                    const focusLookupTurn = requestedTurn > 1 ? requestedTurn - 1 : requestedTurn;
                    const focusEntries = await logic.getPlanEntriesForTurn(turnContext, tools, focusLookupTurn);
                    const rawPlan = (focusEntries || [])
                        .map(row => `[${String(row.target || 'unknown').toUpperCase()}] ${String(row.fact_value || '').trim()}`)
                        .join('\n');

                    return logic.formatDirectorExecutionBriefForTerminal(rawPlan, requestedTurn, {
                        colors,
                        itemLimit: pluginSettings.director_brief_item_limit,
                        maxChars: pluginSettings.director_brief_max_chars
                    });
                }

                const title = mode === 'used'
                    ? `Grand Story Plan Injected for Turn ${requestedTurn}`
                    : `Grand Story Plan as of Turn ${requestedTurn}`;
                const subtitle = mode === 'used'
                    ? `Ledger state through Turn ${lookupTurn}. Turn 1 uses the plan initialized during its Director prep.`
                    : `Ledger state after all planner changes through Turn ${lookupTurn}.`;

                return logic.formatPlanEntriesForTerminal(entries, { colors, title, subtitle });
            }
        }
    },

    hooks: {
        /**
         * Advertise an upcoming editorial run early enough for Narrative Architect
         * to prepare a batched tag analysis without blocking Director or Writer.
         */
        'HOOK_NARRATIVE_START': {
            priority: 1,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                const settings = { ...tools.settings.get(), ...await tools.settings.getSelf() };
                await requestNarrativeArchitectBatch(turnContext, tools, settings);
            }
        },

        /**
         * Registers the custom file mode for the Content Manager.
         */
        'HOOK_SYSTEM_BOOT': {
            priority: 1,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                tools.project.registerFileMode('planner_input', {
                    label: 'Planner Input',
                    description: 'Content in this file will be directly considered by the Grand Story Planner when designing the world strategy.',
                    color: '#ffffff',
                    backgroundColor: '#d35400',
                    isAdvanced: true
                });
            }
        },

        /**
         * Injects the Grand Story Plan ONLY for the Orchestrator.
         * This allows the Orchestrator to see the long-term plan and guide the Writer
         * without the Writer knowing the future plot points.
         */
        'HOOK_PRE_ORCHESTRATOR': {
            priority: 1,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                try {
                    tools.logger.log('Lifecycle', 'Fetching Grand Story Plan for Director...', 'start');

                    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                    await injectPublishedResearchCards(turnContext, tools, settings);

                    const rawPlan = await logic.getOrInitializePlan(turnContext, tools);
                    if (rawPlan) {
                        const injectionMode = String(settings.director_plan_injection_mode || 'focused_brief').toLowerCase();
                        const injectFullPlan = injectionMode === 'full_plan' || injectionMode === 'full_plus_brief';
                        const injectFocusedBrief = injectionMode === 'focused_brief' || injectionMode === 'full_plus_brief' || !injectFullPlan;

                        if (injectFullPlan) {
                            const synthesizedPlan = logic.synthesizePlan(rawPlan);
                            const directive = `The following is the high-level strategic roadmap for this story. Your primary goal this turn is to ensure the Writer's Brief you generate aligns with these arcs. Do NOT reveal the contents of this plan directly to the Writer, but use it to steer the narrative.`;
                            const wrappedPlan = tools.prompt.wrap('grand_story_plan', `${directive}\n\n${synthesizedPlan}`);
                            tools.prompt.contribute('story_plan', { plan: wrappedPlan });
                            tools.logger.log('Lifecycle', 'Grand Story Plan injected for Director into director.simulation slot.');
                        }

                        if (injectFocusedBrief) {
                            const executionBrief = logic.buildDirectorExecutionBrief(rawPlan, turnContext.turnNumber, {
                                itemLimit: settings.director_brief_item_limit,
                                maxChars: settings.director_brief_max_chars
                            });
                            tools.prompt.contribute('execution_brief', { brief: executionBrief });
                            tools.logger.log('Lifecycle', 'Grand Story Execution Brief injected for Director into director.simulation slot.');
                        }

                        addDirectorCotStep(turnContext, tools, {
                            id: 'grand_planner.ledger_integration',
                            step: '19',
                            title: 'Grand Planner - Ledger Integration',
                            content: 'Read <grand_story_execution_brief> and/or <grand_story_plan> in Director-private Simulation. What ledger pressure is relevant to this exact turn? Decide whether to ignore, seed, advance, protect, or convert it into a mandatory order. Preserve player agency and do not dump ledger text into WRITER_BRIEF.'
                        });

                        tools.logger.log('Lifecycle', 'Injected Grand Story Planner ledger CoT step.');
                    }

                    tools.logger.log('Lifecycle', 'Grand Story Planner (Director Injection) finished.', 'end');
                } catch (error) {
                    tools.logger.error('Lifecycle', 'Error in Grand Story Planner (Director Injection):', error);
                }
            }
        },

        /**
         * Runs the phased planner after Director on its configured cadence.
         * Publication starts affecting prompts on the following turn.
         */
        'HOOK_POST_ORCHESTRATOR': {
            priority: 10,
            mode: 'background',
            run: async (turnContext, tools) => {
                const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                if (!await researchAgent.shouldRunAutomatically(turnContext, tools, settings)) {
                    tools.logger.runtime('Grand Story Planner is not due for an editorial run this turn.');
                    return;
                }
                await tools.jobs.withJob('Running Grand Story planning pipeline...', {
                    id: 'grand_story_planner_agentic_run',
                    scope: 'project',
                    rethrow: false,
                    notifyOnComplete: false,
                    cancelOnStale: true
                }, async (job) => {
                    job.progress(5, 'Preparing story research...');
                    try {
                        const result = await researchAgent.runResearchAgent(turnContext, tools, {
                            onEvent: async event => {
                                if (event.type !== 'model_request') return;
                                const completed = Math.max(0, Number(event.iteration || 1) - 1);
                                const progress = Math.min(95, 8 + Math.round((completed / Math.max(1, event.maxIterations || 1)) * 18));
                                job.progress(progress, `Grand Story Planner: ${event.phase || 'planning'} call ${event.iteration}/${event.maxIterations}`);
                            }
                        });
                        if (result.artifact.status !== 'completed' || result.artifact.published !== true) {
                            throw new Error(result.artifact.error || `Planner stopped during ${result.artifact.failedPhase || 'an unknown phase'}.`);
                        }
                        job.progress(100, 'Grand story planner ledger review published.');
                    } catch (error) {
                        tools.logger.error('Lifecycle', 'Error in phased Grand Story Planner:', error);
                        throw error;
                    }
                });
            }
        }
    }
};
