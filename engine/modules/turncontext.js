// #region MODULE IMPORTS
const { Logger, readSettings } = require('./utils.js');

// Stable component source ids: assigned once at insertion, persisted in
// snapshots as enumerable plain strings. crypto.randomUUID() (with a
// deterministic test override below) so ids survive serialize()/fromSnapshot
// and stay unique across processes — never the raw object identity.
function allocatePromptComponentSourceId() {
    if (typeof globalThis.__promptSourceIdForTests === 'function') {
        return globalThis.__promptSourceIdForTests();
    }
    const { randomUUID } = require('node:crypto');
    return `pcs-${randomUUID()}`;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Assigns a stable sourceId to a node and every descendant that lacks one.
// Existing ids are never overwritten: backfill only touches legacy/test
// occurrences pushed without them. Throws on duplicates within the subtree.
function ensurePromptComponentSourceIds(node, seen = new Set()) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.sourceId !== 'string' || !node.sourceId) {
        node.sourceId = allocatePromptComponentSourceId();
    }
    if (seen.has(node.sourceId)) {
        throw new Error(`Duplicate prompt source '${node.sourceId}'.`);
    }
    seen.add(node.sourceId);
    if (Array.isArray(node.children)) {
        for (const child of node.children) ensurePromptComponentSourceIds(child, seen);
    }
    return node;
}

function collectPromptComponentSourceIds(node, into = []) {
    if (!node || typeof node !== 'object') return into;
    if (typeof node.sourceId === 'string' && node.sourceId) into.push(node.sourceId);
    if (Array.isArray(node.children)) {
        for (const child of node.children) collectPromptComponentSourceIds(child, into);
    }
    return into;
}

function validatePromptOccurrenceShape(node, where) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new TypeError(`Prompt occurrence in ${where} must be an object.`);
    }
    if (node.kind !== 'component') {
        throw new TypeError(`Prompt occurrence in ${where} must have kind 'component'.`);
    }
    if (typeof node.componentId !== 'string' || !node.componentId) {
        throw new TypeError(`Prompt occurrence in ${where} requires a componentId.`);
    }
    if (typeof node.text !== 'string') {
        throw new TypeError(`Prompt occurrence ${node.componentId} in ${where} requires string text.`);
    }
    if (!Array.isArray(node.children)) {
        throw new TypeError(`Prompt occurrence ${node.componentId} in ${where} requires a children array.`);
    }
    if (typeof node.owner !== 'string' || !node.owner) {
        throw new TypeError(`Prompt occurrence ${node.componentId} in ${where} requires an owner.`);
    }
    for (const child of node.children) validatePromptOccurrenceShape(child, where);
}

// Deep-freeze one occurrence subtree (children + arrays). Called when the
// shared root prefix freezes: the same sourceId must never point at
// different text later in the turn.
function deepFreezePromptOccurrence(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node.children)) {
        for (const child of node.children) deepFreezePromptOccurrence(child);
        Object.freeze(node.children);
    }
    Object.freeze(node);
    return node;
}

// Snapshot restore: structured occurrences keep their persisted sourceIds
// exactly (no re-stamping). Validates shape + uniqueness across all slots
// and descendants; old snapshots lacking ids are rejected at this boundary.
function validateRestoredPromptComponents(promptComponents) {
    if (!promptComponents || typeof promptComponents !== 'object') return;
    const seen = new Set();
    const check = (node, where) => {
        validatePromptOccurrenceShape(node, where);
        if (typeof node.sourceId !== 'string' || !node.sourceId) {
            throw new Error(
                `Stored prompt snapshot in ${where} lacks a stable sourceId for ${node.componentId}; ` +
                'old string-era snapshots are not loadable into the prompt-model cutover.'
            );
        }
        if (seen.has(node.sourceId)) {
            throw new Error(`Duplicate prompt source '${node.sourceId}' in stored snapshot.`);
        }
        seen.add(node.sourceId);
        for (const child of node.children) check(child, where);
    };
    for (const [target, pillar] of Object.entries(promptComponents)) {
        if (!pillar || typeof pillar !== 'object') continue;
        for (const [slot, items] of Object.entries(pillar)) {
            if (!Array.isArray(items)) continue;
            for (const item of items) check(item, `${target}.${slot}`);
        }
    }
}
// #endregion

// #region CLASS DEFINITION
class TurnContext {
    // #region PROPERTIES
    dbId = null; // To store the permanent ID from the database, once committed to the DB
    _dynamicTurnNumberCache = -1; // A cache for the calculated turn number based on its position in the story flow

    // Path to the chat DB for initialization (if needed)
    chatDbFullPath = null; // The absolute path to the SQLite database file for the current project's chat history
    thumbnail = null; // To store the base64 thumbnail string for the turn

    // Internal reference to chaptermanagement module
    _chapterManagement = null; // An instance of the chaptermanagement module, injected to handle DB operations

    // Skeleton state
    isSkeleton = false; // If true, only metadata fields (id, title, synopsis, summary, thumbnail) are populated
    sceneMode = 'mainline'; // 'mainline' | 'interlude'
    parentTurnDbId = null; // Canonical parent turn ID when sceneMode='interlude'
    interludeOrdinal = null; // 1-based index within parent turn

    // #region STATIC DATA (known at the start of a turn)
    projectName; // The name of the currently active project
    turnNumber = -1; // This is the real turn number, dynamically calculated as the sequential position of the turn within the story flow. Used for most purposes.

    creationTurnNumber = -1; // This is the original turn number when the turn was first created, never changes.
    timestamp; // The timestamp when this TurnContext instance was created.
    // #endregion

    // #region INPUTS
    input = {
        userPrompt: null, // The initial prompt or instruction provided by the user for this turn
        directorPrompt: null, // High-priority manual director instructions for this turn
        softFeedback: null, // Non-overriding feedback/hints from the player
        submitted: null, // Immutable copy of the three VN Viewer text inputs before pipeline transformations
        selectedFiles: [], // List of files selected by the user, if any, for processing in this turn
        assets: { sprites: [], backgrounds: [], osts: [] }, // Initially selected assets by the user or system for this turn
        playerCharacterName: null, // The name of the player character, configured per project
        playerCharacterBio: null, // The bio/personality of the player character
        directives: {}, // Project-specific creative directives/feedback per module
        /* finalPrompt: ...returns the concatenation of playerCharacterName + ": "+userPrompt */
    };
    // #endregion

    // #region PROCESSED STATE
    /**
     * The Prompt Component Registry: ordered structured occurrences per
     * target.slot. Each occurrence names a component registered in the prompt
     * catalogue (core entry or contribution-time plugin definition, namespaced by owner),
     * optionally an instanceKey, its own text, and child pieces. Text lives
     * here exactly once — there is no parallel string-slot projection.
     * Readers that need flat text must render through an explicit accessor.
     *
     * Root slots freeze once the shared prefix is prepared; scoped slots are
     * private agent suffixes.
     */
    promptComponents = {
        root: {
            protocol: [],
            canon: [],
            dynamic_knowledge: [],
            simulation: [],
            history: [],
            directives: []
        },
        writer: {
            protocol: [],
            canon: [],
            dynamic_knowledge: [],
            simulation: [],
            history: [],
            directives: []
        },
        director: {
            protocol: [],
            canon: [],
            dynamic_knowledge: [],
            simulation: [],
            history: [],
            directives: []
        }
    };
    // Definitions registered at contribution time are stored with the turn.
    // Interludes can restore these pieces even when their producing hook does
    // not run. Prompt validates this saved catalogue independently of the
    // occurrence text; occurrence metadata alone is never a registration.
    promptDefinitions = {};

    processed = {
        directorEnabled: true, // Plugin-agnostic flag to enable/disable the director
        writerCoTEnabled: true, // Plugin-agnostic flag to enable/disable the writer's CoT
        writerMinimumWordCount: 0, // Writer-owned minimum response size; 0 disables rejection of undersized responses
        dialogueProcessorEnabled: true, // Plugin-agnostic flag to enable/disable the dialogue processor
        emotionClassifierEnabled: true, // Plugin-agnostic flag to enable/disable the emotion classifier
        focusAnalyzerEnabled: true, // Plugin-agnostic flag to enable/disable the focus analyzer
        spriteVariantOrchestratorEnabled: true, // Plugin-agnostic flag to enable/disable the sprite variant orchestrator
        promptBuilder: {
            messages: [], // Array of messages formatted as conversation history for the LLM
            sharedPrefixHash: null,
            sharedPrefixCharacterCount: 0,
            sharedPrefixEstimatedTokens: 0,
            lorebook: '', // Content from the lorebook, integrated into the prompt
            staticLore: '', // Content from static lore files, integrated into the prompt
            writerFeedback: null, // Feedback provided by the "writer" (LLM or user) on the narrative direction
            writerPromptSnapshot: null // Canonical writer prompt payload used for interlude prompt restoration
        },
        narrativeEngine: {
            writerResponse: '', // The raw narrative text output from the LLM
            turn0Feedback: null // Specific feedback from the LLM for "Turn 0" orchestration
        },
        dialogueProcessor: { //Dialogue processor only triggers an LLM call when the writer LLM is not able to properly output a VN compatible format. Otherwise, it's just a simple cleanup operation.
            outputLines: [], // Processed lines of dialogue, potentially with metadata
            dialoguesToClassify: [], // Dialogue segments identified for emotion classification
            dialogue: '' // The main dialogue content extracted
        },
        emotionClassifier: { emotions: [] }, // Detected emotions for characters in the dialogue
        assetSelector: {
            extraDetails: '',
            background: '',
            ost: '',
            ostChoicesByCategory: { calm: [], happy: [], sad: [], battle: [] },
            ostChoicesMeta: {
                source: '',
                updatedAt: '',
                candidatePoolSize: 0
            }
        }, // Media selection state: `extraDetails` is optional world-state/media context (location/weather/time, etc.) that background/OST and other media-centric modules may use as guidance when choosing assets; not guaranteed to be populated by core (typically filled by plugins). `background` and `ost` store chosen assets. `ostChoicesByCategory` stores reusable per-mood OST pools.
        factExtractor: { facts: [] }, // Structured facts extracted from the narrative (e.g., LOCATION_CHANGE, INVENTORY_CHANGE)
        director: {
            writerBrief: null,
            directorNotes: null,
            fullResponse: '',
            pluginFeedback: {
                schemaVersion: 1,
                sourceTurn: 0,
                byPlugin: {}
            },
            sceneBoundaryStrategy: null,
            capabilityWriterGuidance: {
                enabled: false,
                handoffAllowed: false,
                excludedPhases: [],
                entries: [],
                generatedText: ''
            },
            gameplayHandoffWindow: {
                allowed: true,
                excludedPhases: [],
                reason: 'Core default: dynamic event opportunities are always available unless overridden by WRITER_BRIEF.',
                raw: ''
            },
            scenePhase: 'NORMAL',
            scenePluginId: null
        }, // Populated dynamically by the director module // Full response from the director LLM, writer feedback, and director's notebook entries
        scenePhaseClassifier: {
            capability: 'none',
            confidence: 0,
            isHandoff: false,
            boundaryExcerpt: '',
            boundaryType: 'none',
            boundaryStrength: 'none',
            interruptibility: 'clear',
            currentEngagement: '',
            cadence: {
                capabilityKey: '',
                recentCount: 0,
                consecutiveCount: 0,
                turnsSinceLast: null,
                overused: false
            },
            capabilityTemperature: [],
            directorAdvisory: {
                severity: 'none',
                capability: '',
                topic: '',
                message: '',
                expiresAfterTurns: 0
            },
            repetitionRisk: 'low',
            reason: '',
            repetitionNote: '',
            requestedPluginId: null,
            gatingNotes: [],
            resolvedPhase: 'NORMAL',
            resolvedPluginId: null
        },
        vnManager: {
            processedLines: [], // Enriched dialogue lines with emotions and sprite assignments
            spriteVariantLocks: {}, // Scene-level sprite variant lock map (character_key -> variant_key)
            spriteVariantLockSchedule: [] // Dialogue-indexed lock changes (later dialogue index overrides earlier)
        },
        worldState: { locations: [], weatherChange: '', inventory: [], relationships: [] }, // Extracted world state changes (locations, weather, inventory, relationships)
        personalityState: null, // TODO: Extracted and synthesized personality states of characters
        plugins: {}, // Namespaced storage for plugin-specific data
        elevationOverrides: { fulltext: [], summaries: [] }, // Plugin-provided elevation arrays 
        historyOverrides: {}, // Turn-based tier overrides (e.g., { 5: 'full' })
        slottedRAG: {}, // Registry for slotted memories
        characterGenders: new Map(), // Shared Registry: Single Source of Truth for character genders
        writerBottomInstruction: null, // Hook for plugins to inject absolute bottom instructions for the Writer only
        writerCoTInstruction: null, // Hook for plugins to inject absolute instructions for the Writer's Chain of Thought (thinking process)
        writerCoTInsertions: [], // Structured CoT insertions with positional step metadata
        chapterIntroConfig: null, // Optional configuration for the core chapter intro text
    };
    // #endregion

    // #region FINAL OUTPUT
    output = {
        sequence: [], // The final sequence of events/actions for the visual novel
        party: [], // The current party members involved in the turn
        characterIcons: {}, // Map of character names to their icon asset paths (e.g., { "Dehya": "dehya_icon.webp" })
        prominentCharacters: [], // Character names ordered by voice line frequency (most to fewest)
        finalBackground: '', // The background asset to be used in the final VN output
        prominentSprites: [], // The prominent sprite assets to be used in the final VN output
        finalSong: '', // The OST asset to be used in the final VN output
        title: '', // AI-generated title for the turn
        abstractTitle: '', // AI-generated abstract, poetic title
        summary: '', // A summary of the generated turn's narrative
        synopsis: '', // A synopsis of the generated turn's narrative
        worldStateSynthesized: '', // A synthesized natural language description of the world state changes
        guiIntercepts: [], // Persisted GUI intercept descriptors replayable with historical turns
        isGameOver: false, // Flag to indicate if the turn marks a game over
        gameOverConfig: null, // Optional configuration for the game over screen (e.g., { text: 'YOU DIED' })
        /*fulltext: ...returns a copy of narrativeEngine.writerResponse, for ease of access ((Object.defineProperty)*/
    };
    // #endregion

    // #region POST-PROCESSING INJECTION
    postContent = {
        userInputInjection: '', // Data to inject into the next turn's prompt
        userInputOverride: ''   // Data to replace the user prompt entirely
    };
    // #endregion

    // #region RUNTIME DATA (not persisted) - Useful for temporary data storage
    runtime = {
        assets: {
            sprites: [],            // List of project-specific sprite asset paths
            backgrounds: [],        // List of project-specific background asset paths
            osts: [],               // List of project-specific OST asset paths
            extraSprites: [],       // Dynamically injected sprite paths from plugins
            extraBackgrounds: [],   // Dynamically injected background paths from plugins
            extraOsts: []           // Dynamically injected OST paths from plugins
        }, // Assets loaded and used during current runtime, not necessarily persisted
        director: {
            cotSteps: [], // Additional CoT steps from plugins (array of content strings)
            cotPatches: [], // Structured CoT add/override/disable/remove operations from plugins
            ledgerSections: [], // Additional ledger sections from plugins (array of content strings)
            ledgerSectionPatches: [], // Structured ledger section registrations from plugins
            ledgerOverrides: {}, // Native ledger section overrides (set to empty string to disable)
            outputOverrides: {}, // Native output section overrides (set to empty string to disable)
            additionalInputs: [], // Additional canon data to inject into PART 1 (for plugins like story_cards)
            registeredCapabilities: [], // Mechanical systems registered by plugins
            sceneBoundaryStrategy: null // Core RNG boundary-style signal consumed by Director CoT
        },
        scenePhaseClassifier: {
            definitionAddenda: [] // Runtime prompt-rule addenda appended by plugins for classifier guidance
        },
        narrativeEngine: {
            writerRequestMessages: [] // Exact runtime-only message sequence sent to the Writer LLM
        },
        vnManager: {
            spriteCatalog: null, // Runtime-only sprite intelligence map for early pipeline/plugin decisions
            spriteMetadata: null // Runtime-only merged sprite metadata (currently used for emotion guidance)
        },
        systemPromptParts: [],
        chatHistoryMessages: [],
        pipelineErrors: [], // A bucket for non-catastrophic errors encountered during the pipeline (ephemeral)
        performance: { hooks: {} }, // Chronological tracking of hook and plugin execution timings
        plugins: {}, // Namespaced storage for plugin-specific runtime data (e.g. logs)
        guiIntercepts: [], // Runtime-only GUI intercept descriptors (one-off, non-replay lane)
        timelineRouting: { pre: {}, post: {} } // Plugin-provided header/footer injections for chapter text
    };
    // #endregion

    // #region CONSTRUCTOR
    constructor(projectName, chatDbFullPath = null, rootDirectory = null, playerCharacterName = null, playerCharacterBio = null) {
        this.projectName = projectName;
        this.timestamp = new Date();
        this.chatDbFullPath = chatDbFullPath;
        this.rootDirectory = rootDirectory; // Store rootDirectory

        // Store playerCharacterName and playerCharacterBio in input
        this.input.playerCharacterName = playerCharacterName;
        this.input.playerCharacterBio = playerCharacterBio;

        // Define finalPrompt as a getter on input
        Object.defineProperty(this.input, 'finalPrompt', {
            enumerable: true,
            configurable: true,
            get: () => {
                const name = this.input.playerCharacterName || '';
                const prompt = this.input.userPrompt || '';
                if (!name && !prompt) return '';
                if (!name) return prompt; // If no character name, just return the prompt
                if (!prompt) return name + ':'; // If no prompt, just return the character name with a colon

                // Check if the prompt already starts with the character name followed by a colon
                const nameWithColon = `${name}:`;
                if (prompt.toLowerCase().startsWith(nameWithColon.toLowerCase())) {
                    return prompt; // If it does, return the prompt as is to avoid duplication
                }

                return name + ': ' + prompt; // Otherwise, prepend the character name and colon
            }
        });

        Object.defineProperty(this.output, 'fulltext', {
            enumerable: true,
            configurable: true,
            get: () => (this.processed && this.processed.narrativeEngine ? this.processed.narrativeEngine.writerResponse : '')
        });

        const settings = readSettings() || {};
        this.writerCoTEnabled = settings.narrative_agents?.writer?.enable_chain_of_thought !== false;
    }

    // Getters for plugin-agnostic flags
    get directorEnabled() { return this.processed.directorEnabled; }
    set directorEnabled(val) { this.processed.directorEnabled = !!val; }

    get writerCoTEnabled() { return this.processed.writerCoTEnabled; }
    set writerCoTEnabled(val) { this.processed.writerCoTEnabled = !!val; }

    get writerMinimumWordCount() {
        const value = Number(this.processed.writerMinimumWordCount);
        return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }
    set writerMinimumWordCount(val) {
        const value = Number(val);
        this.processed.writerMinimumWordCount = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }

    get dialogueProcessorEnabled() { return this.processed.dialogueProcessorEnabled; }
    set dialogueProcessorEnabled(val) { this.processed.dialogueProcessorEnabled = !!val; }

    get emotionClassifierEnabled() { return this.processed.emotionClassifierEnabled; }
    set emotionClassifierEnabled(val) { this.processed.emotionClassifierEnabled = !!val; }

    get focusAnalyzerEnabled() { return this.processed.focusAnalyzerEnabled; }
    set focusAnalyzerEnabled(val) { this.processed.focusAnalyzerEnabled = !!val; }

    get spriteVariantOrchestratorEnabled() { return this.processed.spriteVariantOrchestratorEnabled; }
    set spriteVariantOrchestratorEnabled(val) { this.processed.spriteVariantOrchestratorEnabled = !!val; }

    /**
     * Retrieves a project-specific directive for a given module or plugin ID.
     * @param {string} id - The ID of the core module or plugin.
     * @param {string} [fieldKey='creative_style'] - The field key within the directive.
     * @returns {string} The directive text, or an empty string if not found.
     */
    // Renders ordered structured occurrences in one pillar.slot to flat text.
    // The ONLY supported reader for promptComponents content: joins each
    // occurrence's own text plus descendant texts depth-first with '\n\n',
    // applying the toolkit-owned directable wrapper around opted-in entries.
    // Built for brutish cutovers — callers that used .join() on string slots
    // switch to this and keep working while provenance is being wired.
    renderPromptSlot(target, slot) {
        const items = this.promptComponents?.[target]?.[slot];
        if (!Array.isArray(items)) {
            throw new Error(`Unknown prompt target/slot: ${target}.${slot}`);
        }
        // Single-source rule: flat text is the slot_renderer fragment
        // sequence joined to a string (same rule the composer compiles into
        // manifest spans — see prompt/slot_renderer.js).
        const { renderSlotText } = require('./prompt/slot_renderer.js');
        return renderSlotText(items);
    }

    // Trusted source resolver for typed inclusion: returns the LIVE stored
    // occurrence for a sourceId, or throws. Callers resolve identity through
    // this (validated registration), never through an occurrence's embedded
    // declaration or a caller-supplied component id. Backfills stable ids on
    // legacy/test occurrences pushed without them — insertion paths stamp
    // ids, but direct array pushes in tests must also resolve.
    // Single insertion point for prompt occurrences: validates shape, stamps
    // stable sourceIds recursively (never overwrites), rejects duplicates,
    // and appends atomically. All producers (core pushes, plugin
    // contributions, writer-private) must funnel through here.
    addPromptOccurrence(target, slot, occurrence) {
        const pillar = this.promptComponents?.[target];
        if (!pillar || !Array.isArray(pillar[slot])) {
            throw new Error(`Unknown prompt target/slot: ${target}.${slot}`);
        }
        validatePromptOccurrenceShape(occurrence, `${target}.${slot}`);
        ensurePromptComponentSourceIds(occurrence);
        const existing = new Set();
        for (const item of pillar[slot]) {
            for (const id of collectPromptComponentSourceIds(item)) existing.add(id);
        }
        for (const id of collectPromptComponentSourceIds(occurrence)) {
            if (existing.has(id)) {
                throw new Error(`Duplicate prompt source '${id}' in ${target}.${slot}.`);
            }
            existing.add(id);
        }
        pillar[slot].push(occurrence);
        return occurrence;
    }

    // Read-only trusted lookup: returns the LIVE stored occurrence for a
    // sourceId, or throws. Never backfills, never invents: insertion and
    // snapshot restore are the only places ids are stamped.
    getPromptSource(target, slot, sourceId) {
        const items = this.promptComponents?.[target]?.[slot];
        if (!Array.isArray(items)) {
            throw new Error(`Unknown prompt target/slot: ${target}.${slot}`);
        }
        const found = [];
        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.sourceId === sourceId) found.push(node);
            for (const child of node.children || []) walk(child);
        };
        for (const item of items) walk(item);
        if (found.length === 0) {
            throw new Error(`Unknown prompt source '${sourceId}' in ${target}.${slot}.`);
        }
        if (found.length > 1) {
            throw new Error(`Duplicate prompt source '${sourceId}' in ${target}.${slot}.`);
        }
        return found[0];
    }

    getDirective(id, fieldKey = 'creative_style') {
        const directives = this.input?.directives || {};
        const entityDirectives = directives[id] || {};
        
        // If specific key exists and is not empty, return it
        if (entityDirectives[fieldKey] && entityDirectives[fieldKey].trim()) {
            return entityDirectives[fieldKey];
        }
        
        // Smart Fallback: If we're looking for the default 'creative_style' but it's empty,
        // check if this entity has ANY non-empty directive values and return the first one.
        // This allows plugins to rename their internal keys without breaking prompt injection.
        if (fieldKey === 'creative_style') {
            const values = Object.values(entityDirectives).filter(v => typeof v === 'string' && v.trim());
            if (values.length > 0) return values[0];
        }
        
        return '';
    }

    /**
     * Returns a formatted string for the directive, suitable for inclusion in prompts.
     * Returns an empty string if the directive is blank.
     * @param {string} id - The ID of the core module or plugin.
     * @param {Object} [options] - Formatting options.
     * @param {string} [options.header='### PROJECT DIRECTIVES'] - The header to prepend.
     * @param {string} [options.fieldKey='creative_style'] - The field key.
     * @returns {string} The formatted directive block or an empty string.
     */
    getFormattedDirective(id, options = {}) {
        const { header = '### PROJECT DIRECTIVES', fieldKey = 'creative_style' } = options;
        const content = this.getDirective(id, fieldKey);
        if (!content || !content.trim()) return '';
        
        return `${header}\n${content.trim()}`;
    }
    // #endregion

    // #region DEPENDENCY INJECTION
    /**
     * Sets the chapter management module for this TurnContext instance.
     * This is used to inject the dependency and break circular references.
     * @param {object} chapterManagementModule - The chaptermanagement module.
     */
    setChapterManagement(chapterManagementModule) {
        this._chapterManagement = chapterManagementModule;
    }
    // #endregion

    // #region HELPER METHODS
    async ensureChapterManagementInitialized() {
        if (!this._chapterManagement) {
            Logger.error('TurnContext', 'Chapter management module not set. Call setChapterManagement() first.');
            throw new Error('Chapter management module not set.');
        }
        if (!this._chapterManagement.db && this.chatDbFullPath) {
            Logger.log('TurnContext', 'Chapter management not initialized, attempting to initialize...');
            try {
                await this._chapterManagement.init(this.chatDbFullPath);
                Logger.log('TurnContext', 'Chapter management initialized successfully.');
            } catch (error) {
                Logger.error('TurnContext', 'Failed to initialize chapter management:', error);
                throw error;
            }
        } else if (!this.chatDbFullPath) {
            if (Logger.warn) Logger.warn('TurnContext', 'Cannot ensure chapter management is initialized: chatDbFullPath is not provided.');
            else Logger.log('TurnContext', 'Cannot ensure chapter management is initialized: chatDbFullPath is not provided.');
        }
    }
    // #endregion

    // #region CHAPTER MANAGEMENT METHODS
    /**
     * Initializes the TurnContext instance by setting its turnNumber.
     * This should be called before populating the TurnContext with data.
     */
    async init() {
        await this.ensureChapterManagementInitialized();
        const count = await this._chapterManagement.getChapterCount();
        this.creationTurnNumber = count + 1;
        this.turnNumber = count + 1; // For a new turn, creation and dynamic are the same initially.
        Logger.log('TurnContext', `Initialized with turnNumber: ${this.turnNumber}`);
    }

    /**
     * Commits the current TurnContext instance to the database.
     * This should be called after the TurnContext has been populated with data.
     * If the turn already exists (has a dbId), it will perform an update.
     */
    async commit() {
        if (this.creationTurnNumber === -1) {
            Logger.error('TurnContext', 'TurnContext not initialized. Call init() first.');
            throw new Error('TurnContext not initialized. Call init() first.');
        }
        await this.ensureChapterManagementInitialized();

        if (this.dbId) {
            await this._chapterManagement.updateTurn(this);
            Logger.log('TurnContext', `Updated turn ${this.creationTurnNumber} (dbId: ${this.dbId}) in database.`);
        } else {
            await this._chapterManagement.appendMessage(this, this.thumbnail);
            Logger.log('TurnContext', `Committed new turn ${this.creationTurnNumber} to database.`);
        }
    }
    // #endregion

    /**
     * Inflates a skeleton TurnContext with data from a full snapshot.
     * @param {object} snapshotData - The full snapshot data from the database.
     */
    inflate(snapshotData) {
        if (!snapshotData) return;
        for (const key in snapshotData) {
            if (Object.prototype.hasOwnProperty.call(this, key) && typeof this[key] === 'object' && this[key] !== null) {
                // Special handling for objects with getters to avoid overwriting them
                if (key === 'output' && snapshotData[key].hasOwnProperty('fulltext')) {
                    const restOfOutput = { ...snapshotData[key] };
                    delete restOfOutput.fulltext;
                    Object.assign(this[key], restOfOutput);
                } else if (key === 'input' && snapshotData[key].hasOwnProperty('finalPrompt')) {
                    const restOfInput = { ...snapshotData[key] };
                    delete restOfInput.finalPrompt;
                    Object.assign(this[key], restOfInput);
                } else if (key === 'processed') {
                    // Deep merge for processed to keep getter-backed fields safe.
                    const { dialogueProcessor, characterGenders, ...restOfProcessed } = snapshotData[key];
                    Object.assign(this.processed, restOfProcessed);
                    if (dialogueProcessor && typeof dialogueProcessor === 'object') {
                        const restOfDP = { ...dialogueProcessor };
                        Object.assign(this.processed.dialogueProcessor, restOfDP);
                    }

                    if (Array.isArray(characterGenders)) {
                        this.processed.characterGenders = new Map(characterGenders);
                    } else if (characterGenders && typeof characterGenders === 'object') {
                        this.processed.characterGenders = new Map(Object.entries(characterGenders));
                    }
                } else {
                    Object.assign(this[key], snapshotData[key]);
                }
            } else {
                this[key] = snapshotData[key];
            }
        }
        this.isSkeleton = false;
        Logger.log('TurnContext', `Turn ${this.turnNumber} inflated successfully.`);
    }

    /**
     * Ensures that the TurnContext is fully populated.
     * If it is a skeleton, it fetches the full blob from the database and inflates itself.
     */
    async ensureFull() {
        if (!this.isSkeleton) return;
        if (!this.dbId) {
            Logger.error('TurnContext', 'Cannot ensureFull: missing dbId for skeleton.');
            return;
        }
        await this.ensureChapterManagementInitialized();
        Logger.log('TurnContext', `Inflating skeleton for turn ${this.turnNumber} (dbId: ${this.dbId})...`);
        const snapshotData = await this._chapterManagement.getTurnBlob(this.dbId);
        if (snapshotData) {
            this.inflate(snapshotData);
        } else {
            Logger.error('TurnContext', `Failed to retrieve full blob for dbId: ${this.dbId}`);
        }
    }

    // #region SERIALIZATION

    /**
     * Keys that must NEVER be persisted from runtime, even when enableRuntimePersistence is on.
     * These contain transient caches, circular TurnContext references, or non-serializable handles.
     */
    static RUNTIME_PERSIST_DENY_LIST = [
        'chapterHistory',      // Contains full TurnContext objects → recursive growth
        'historyData',         // Contains assembled prompt text (narrative history, compressed views, chat arrays)
        'chatHistoryMessages', // Assembled chat message array for the LLM
        'narrativeHistory',    // Full history string for the orchestrator
        'searchStringHandler', // Function reference (non-serializable)
        'staticDataManager',   // Module reference (non-serializable)
        'isContentManagerMode',// Transient flag
        'rootDirectory',       // Already serialized as a top-level key
        'pipelineErrors',      // Ephemeral error log
        'vnManager',           // Runtime-only VN caches (e.g. sprite catalog)
        'promptBuilder',       // Runtime-only frozen Director/Writer shared prefix
        'guiIntercepts',       // Runtime-only GUI intercept lane (must never persist)
    ];

    /** Maximum allowed snapshot size in bytes before emergency stripping kicks in. */
    static MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024; // 5 MB

    serialize() {
        const serializableKeys = ['input', 'processed', 'output', 'postContent', 'rootDirectory', 'promptComponents', 'promptDefinitions'];

        const settings = readSettings();
        if (settings && settings.infrastructure?.enable_runtime_persistence) {
            serializableKeys.push('runtime');
        }

        const snapshot = {};
        const root = this.rootDirectory;
        const path = require('path');

        for (const key of serializableKeys) {
            // Perform a deep copy to ensure the snapshot is immutable
            let sourceData = this[key];
            
            // Special handling for characterGenders Map before stringification
            if (key === 'processed' && sourceData.characterGenders instanceof Map) {
                sourceData = { ...sourceData, characterGenders: Array.from(sourceData.characterGenders.entries()) };
            }

            let data = JSON.parse(JSON.stringify(sourceData));

            // Layer 1: Strip denied keys from runtime
            if (key === 'runtime') {
                for (const denied of TurnContext.RUNTIME_PERSIST_DENY_LIST) {
                    delete data[denied];
                }
            }

            // Layer 1.5: Relativize paths in selectedFiles
            if (key === 'input' && data.selectedFiles && Array.isArray(data.selectedFiles) && root) {
                data.selectedFiles = data.selectedFiles.map(f => {
                    if (f.path && path.isAbsolute(f.path)) {
                        return {
                            ...f,
                            path: path.relative(root, f.path)
                        };
                    }
                    return f;
                });
            }

            snapshot[key] = data;
        }

        // Layer 2: Size guard — if the snapshot is dangerously large, strip heavy transient data
        const serialized = JSON.stringify(snapshot);
        if (serialized.length > TurnContext.MAX_SNAPSHOT_SIZE) {
            Logger.error('TurnContext', `⚠️ CRITICAL: Snapshot size (${(serialized.length / 1024 / 1024).toFixed(1)} MB) exceeds ${(TurnContext.MAX_SNAPSHOT_SIZE / 1024 / 1024).toFixed(0)} MB limit! Emergency stripping engaged.`);

            // Emergency strip: remove the heaviest transient data
            if (snapshot.promptComponents) delete snapshot.promptComponents;
            if (snapshot.runtime) {
                if (snapshot.runtime.director) {
                    delete snapshot.runtime.director.cotSteps;
                    delete snapshot.runtime.director.cotPatches;
                    delete snapshot.runtime.director.ledgerSections;
                    delete snapshot.runtime.director.ledgerSectionPatches;
                    delete snapshot.runtime.director.additionalInputs;
                }
                delete snapshot.runtime.systemPromptParts;
                delete snapshot.runtime.performance;
                // keep assets, timelineRouting, and any small plugin data
            }
            if (snapshot.processed?.promptBuilder?.messages) snapshot.processed.promptBuilder.messages = [];
            // Prepared-prompt provenance lives in the turn log (payload.promptTrace),
            // joined by callId. The snapshot keeps only hash/characterCount; the
            // full manifest and rehydratable prepared copy would balloon chat.db
            // blobs the same way messages did.
            if (snapshot.processed?.promptBuilder?.writerPromptManifest) delete snapshot.processed.promptBuilder.writerPromptManifest;
            if (snapshot.processed?.promptBuilder?.writerPromptPrepared) delete snapshot.processed.promptBuilder.writerPromptPrepared;
            if (snapshot.processed?.promptBuilder?.sharedPrefixManifest) delete snapshot.processed.promptBuilder.sharedPrefixManifest;
            if (snapshot.processed?.promptBuilder?.sharedPrefixPrepared) delete snapshot.processed.promptBuilder.sharedPrefixPrepared;
            if (snapshot.processed?.director?.analysisPromptManifest) delete snapshot.processed.director.analysisPromptManifest;
            if (snapshot.processed?.director?.analysisPromptPrepared) delete snapshot.processed.director.analysisPromptPrepared;
            if (snapshot.processed?.chapterHistory) delete snapshot.processed.chapterHistory;
            if (snapshot.processed?.historyData) delete snapshot.processed.historyData;

            const afterSize = JSON.stringify(snapshot).length;
            Logger.error('TurnContext', `Emergency strip reduced snapshot from ${(serialized.length / 1024 / 1024).toFixed(1)} MB to ${(afterSize / 1024 / 1024).toFixed(1)} MB.`);
        }

        return snapshot;
    }

    static fromSnapshot(snapshotData, projectName, creationTurnNumber, chatDbFullPath = null, rootDirectory = null, dbId = null, thumbnail = null) {
        const turn = new TurnContext(projectName, chatDbFullPath, rootDirectory);
        const path = require('path');
        turn.creationTurnNumber = creationTurnNumber; // Store the original number
        turn.dbId = dbId; // Set the database ID
        turn.thumbnail = thumbnail; // Set the thumbnail
        for (const key in snapshotData) {
            if (Object.prototype.hasOwnProperty.call(turn, key) && typeof turn[key] === 'object' && turn[key] !== null) {
                // Special handling for 'output' to avoid setting 'fulltext' getter
                if (key === 'output' && snapshotData[key].hasOwnProperty('fulltext')) {
                    const restOfOutput = { ...snapshotData[key] };
                    delete restOfOutput.fulltext;
                    Object.assign(turn[key], restOfOutput);
                } else if (key === 'input' && snapshotData[key].hasOwnProperty('finalPrompt')) {
                    const restOfInput = { ...snapshotData[key] };
                    delete restOfInput.finalPrompt;
                    
                    // Absolutize paths in selectedFiles
                    if (restOfInput.selectedFiles && Array.isArray(restOfInput.selectedFiles) && rootDirectory) {
                        restOfInput.selectedFiles = restOfInput.selectedFiles.map(f => {
                            if (f.path && !path.isAbsolute(f.path)) {
                                return {
                                    ...f,
                                    path: path.resolve(rootDirectory, f.path)
                                };
                            }
                            return f;
                        });
                    }

                    Object.assign(turn[key], restOfInput);
                }
                else if (key === 'processed') {
                    const { dialogueProcessor, characterGenders, ...restOfProcessed } = snapshotData[key];
                    Object.assign(turn[key], restOfProcessed);
                    if (dialogueProcessor && typeof dialogueProcessor === 'object') {
                        const restOfDP = { ...dialogueProcessor };
                        delete restOfDP.metaDialogue;
                        delete restOfDP.metaContext;
                        Object.assign(turn.processed.dialogueProcessor, restOfDP);
                    }
                    if (Array.isArray(characterGenders)) {
                        turn[key].characterGenders = new Map(characterGenders);
                    } else if (characterGenders && typeof characterGenders === 'object') {
                        turn[key].characterGenders = new Map(Object.entries(characterGenders));
                    }
                }
                else if (key === 'promptComponents') {
                    validateRestoredPromptComponents(snapshotData[key]);
                    Object.assign(turn[key], snapshotData[key]);
                }
                else if (key === 'promptDefinitions') {
                    const { validatePromptPieces } = require('./prompt/prompt_core_catalog.js');
                    for (const [pluginId, pieces] of Object.entries(snapshotData[key] || {})) {
                        validatePromptPieces(pluginId, pieces);
                    }
                    Object.assign(turn[key], snapshotData[key]);
                }
                else {
                    Object.assign(turn[key], snapshotData[key]);
                }
            } else {
                // Prevent overwritting rootDirectory with stale data from the snapshot
                if (key !== 'rootDirectory') {
                    turn[key] = snapshotData[key];
                }
            }
        }
        return turn;
    }
    // #endregion
    /**
     * Dynamically retrieves the current turn number (position) from the database.
     * Caches the result to avoid redundant DB calls within the same operation.
     * @returns {Promise<number>} The 1-based position of this turn in the story.
     */
    async getTurnNumber() {
        if (this._dynamicTurnNumberCache > 0) {
            return this._dynamicTurnNumberCache;
        }
        if (!this.dbId) {
            // This is a new, unsaved turn. Its number is the current total count + 1.
            await this.ensureChapterManagementInitialized();
            const count = await this._chapterManagement.getChapterCount();
            return count + 1;
        }

        await this.ensureChapterManagementInitialized();
        const position = await this._chapterManagement.getPositionOfTurn(this.dbId);
        this._dynamicTurnNumberCache = position;
        return position;
    }

    async getChapter(chapterNum) { // Renamed from getTurnSnapshot
        await this.ensureChapterManagementInitialized();
        // Assuming chaptermanagement.getTurnSnapshot is now chaptermanagement.getTurnContext
        const turnContextInstance = await this._chapterManagement.getTurnContext(chapterNum);
        if (!turnContextInstance) return null;
        // The getTurnContext already returns a TurnContext instance, so no need to re-create from snapshot
        return turnContextInstance;
    }

    async getPreviousChapter() {
        await this.ensureChapterManagementInitialized();
        const currentTurn = this.turnNumber > -1 ? this.turnNumber : await this._chapterManagement.getChapterCount();
        if (currentTurn > 1) { // Only try to retrieve if there's a *previous* turn (i.e., currentTurn > 1)
            return this.getChapter(currentTurn - 1);
        }
        return null; // For currentTurn <= 1, there's no previous chapter to fetch from DB
    }

    /**
     * Retrieves categorized TurnContext instances (full, summary, synopsis) for the current project.
     * @returns {Promise<{fullchapters: Array<TurnContext>, summarychapters: Array<TurnContext>, synopsischapters: Array<TurnContext>}>}
     */
    async retrieveDatedChapters() {
        await this.ensureChapterManagementInitialized();
        const overrides = this.processed?.historyOverrides || {};
        const explicitMaxTurnNumber = Number.parseInt(this?.processed?.historyMaxTurnNumber, 10);
        const creationTurnNumber = Number.parseInt(this?.creationTurnNumber, 10);
        const dynamicTurnNumber = Number.parseInt(this?.turnNumber, 10);

        const resolvedMaxTurnNumber = Number.isInteger(explicitMaxTurnNumber) && explicitMaxTurnNumber > 0
            ? explicitMaxTurnNumber
            : (
                Number.isInteger(creationTurnNumber) && creationTurnNumber > 0
                    ? creationTurnNumber
                    : (Number.isInteger(dynamicTurnNumber) && dynamicTurnNumber > 0 ? dynamicTurnNumber : null)
            );

        return await this._chapterManagement.retrieveDatedChapters(overrides, {
            maxTurnNumber: resolvedMaxTurnNumber
        });
    }

    /**
     * Retrieves and formats a string of chapter history, suitable for prompts.
     * Can skip the most recent chapters and limit the total count.
     * @param {object} options
     * @param {number} [options.count=10] - The maximum number of chapters to include.
     * @param {number} [options.skip=1] - The number of most recent chapters to skip.
     * @returns {Promise<string>} A formatted string of chapter history.
     */
    /**
     * Retrieves and formats a string of chapter history, suitable for prompts.
     * Supports tiered fidelity (fulltext, summary, synopsis).
     * 
     * @param {object} options
     * @param {number} [options.count=10] - Total chapters to include.
     * @param {number} [options.skip=1] - Chapters to skip from the end.
     * @param {object} [options.tierConfig] - Optional fidelity mapping, e.g. { fulltext: 1, summary: 4 }
     * @returns {Promise<string>} A formatted string of chapter history.
     */
    async getFormattedHistory({ count = 10, skip = 1, tierConfig = null } = {}) {
        await this.ensureChapterManagementInitialized();

        const { fullchapters, summarychapters, synopsischapters } = await this.retrieveDatedChapters();
        const allChapters = [...synopsischapters, ...summarychapters, ...fullchapters]
            .sort((a, b) => Number(a?.turnNumber) - Number(b?.turnNumber));

        // 1. Slice based on skip/count
        const relevantChapters = allChapters.slice(0, skip > 0 ? -skip : allChapters.length);
        const finalChapters = relevantChapters.slice(-count);

        if (finalChapters.length === 0) {
            return "No older chapters available.";
        }

        // 2. Map Fidelity Tiers
        // tierConfig format: { fulltext: N, summary: M, synopsis: K }
        // We apply tiers from newest to oldest within the finalChapters array.
        const config = tierConfig || { fulltext: 0, summary: count, synopsis: 0 };

        const formatInterludeCapsules = (tc) => {
            const capsules = tc?.processed?.plugins?.interludeCapsules;
            if (!Array.isArray(capsules) || capsules.length === 0) return '';

            const lines = capsules
                .slice()
                .sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0))
                .map(c => {
                    const label = c?.label ? ` — ${c.label}` : '';
                    const text = typeof c?.capsule === 'string' ? c.capsule.trim() : '';
                    if (!text) return null;
                    return `- ${tc.turnNumber}.${c.ordinal}${label}: ${text}`;
                })
                .filter(Boolean);

            if (lines.length === 0) return '';
            return `\n\n[Interlude Capsules]\n${lines.join('\n')}`;
        };

        const historyPromises = finalChapters.map(async (tc, index) => {
            const reverseIndex = finalChapters.length - 1 - index;
            let fidelity = 'synopsis';

            if (reverseIndex < (config.fulltext || 0)) fidelity = 'fulltext';
            else if (reverseIndex < (config.fulltext || 0) + (config.summary || 0)) fidelity = 'summary';

            let content = "";
            if (fidelity === 'fulltext') {
                await tc.ensureFull();
                content = tc.processed?.dialogueProcessor?.dialogue || tc.output?.fulltext || tc.output?.summary || "No full text available.";
            } else if (fidelity === 'summary') {
                if (tc.isSkeleton) await tc.ensureFull();
                content = tc.output.summary || tc.output.synopsis || "No summary available.";
            } else {
                if (tc.isSkeleton) await tc.ensureFull();
                content = tc.output.synopsis || tc.output.summary || "No synopsis available.";
            }

            content += formatInterludeCapsules(tc);
            return `Chapter ${tc.turnNumber} [${fidelity.toUpperCase()}]:\n${content.trim()}`;
        });

        const historyParts = await Promise.all(historyPromises);
        return historyParts.join('\n\n---\n\n');
    }

    // #endregion
}
// #endregion

// #region EXPORTS
module.exports = TurnContext;
module.exports.ensurePromptComponentSourceIds = ensurePromptComponentSourceIds;
module.exports.allocatePromptComponentSourceId = allocatePromptComponentSourceId;
module.exports.collectPromptComponentSourceIds = collectPromptComponentSourceIds;
module.exports.validatePromptOccurrenceShape = validatePromptOccurrenceShape;
module.exports.deepFreezePromptOccurrence = deepFreezePromptOccurrence;
module.exports.validateRestoredPromptComponents = validateRestoredPromptComponents;
// #endregion
