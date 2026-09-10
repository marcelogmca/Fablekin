const logic = require('./logic.js');
const identity = require('./libs/identity.js');
const ui = require('./libs/ui.js');
const storage = require('./libs/storage.js');
const path = require('path');
const fs = require('fs/promises');
const parser = require('./libs/parser.js');
const schemaAdapter = require('./libs/schema_adapter.js');

function resolveCharacterIconMap(characterIcons, tools) {
    const resolved = {};
    for (const [key, iconPath] of Object.entries(characterIcons || {})) {
        resolved[key] = iconPath ? tools.assets.resolveUrl(iconPath, { kind: 'sprites' }) : '';
    }
    return resolved;
}

async function getLatestCharacterIcons(tools) {
    try {
        const latestTurn = await tools.turns.getLatest();
        return latestTurn?.output?.characterIcons || {};
    } catch {
        return {};
    }
}

function selectHudPreviewNames(characters, output, turnNumber, projectName, limit = 5) {
    const byName = new Map((characters || [])
        .filter(character => character?.name)
        .map(character => [String(character.name).toLowerCase(), character]));
    const selected = [];
    const selectedKeys = new Set();
    const add = name => {
        const character = byName.get(String(name || '').toLowerCase());
        if (!character || selectedKeys.has(String(character.name).toLowerCase()) || selected.length >= limit) return;
        selected.push(character.name);
        selectedKeys.add(String(character.name).toLowerCase());
    };
    const stableScore = name => {
        const input = `${projectName || ''}:${turnNumber || 0}:${String(name).toLowerCase()}`;
        let hash = 2166136261;
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    };

    // Full sheets and the protagonist are the durable cast, regardless of current scene.
    (characters || [])
        .filter(character => character?.isPlayer || character?.type === 'full')
        .sort((left, right) => Number(right?.isPlayer) - Number(left?.isPlayer) || stableScore(left.name) - stableScore(right.name))
        .forEach(character => add(character.name));

    // Current scene/party order is already narrative relevance order.
    [...(output?.party || []), ...(output?.prominentCharacters || [])].forEach(add);

    const remaining = (characters || []).filter(character => !selectedKeys.has(String(character?.name || '').toLowerCase()));
    const lastSeen = character => Number(
        character?.capsule?.metadata?.last_turn_appeared
        ?? character?.capsule?.last_turn_appeared
        ?? 0
    ) || 0;
    const recentCutoff = Math.max(0, Number(turnNumber || 0) - 12);
    remaining
        .filter(character => lastSeen(character) >= recentCutoff && lastSeen(character) > 0)
        .sort((left, right) => lastSeen(right) - lastSeen(left) || stableScore(left.name) - stableScore(right.name))
        .forEach(character => add(character.name));

    // Stale/unknown records fill spare slots without alphabetic bias or per-refresh flicker.
    remaining
        .filter(character => !selectedKeys.has(String(character?.name || '').toLowerCase()))
        .sort((left, right) => stableScore(left.name) - stableScore(right.name))
        .forEach(character => add(character.name));

    return selected;
}

module.exports = {
    id: 'character_sheets',
    name: 'Character Sheets',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Characters',
    wizard: {
        include: true,
        order: 410,
        group: 'Characters',
        label: 'Character Sheets',
        recommended_enabled: true,
        author_note: 'Recommended for any long-running story with recurring characters.',
        enabled_note: 'Maintains structured character sheets so the system remembers identity, traits, and role information.',
        disabled_note: 'Character continuity becomes more dependent on raw chat history and other memory systems.',
        settings_note: 'Tune extraction model, update cadence, and sheet detail in plugin settings.'
    },
    description: 'Manages character sheet synthesis and caching, injecting them into the narrative context.',
    optionalDependencies: [
        { id: 'vn_hud', reason: 'Displays character-sheet information in the VN interface.' },
        { id: 'relationship_tracker', reason: 'Includes structured bonds and current relationship tensions in character sheets.' },
        { id: 'personality_tracker', reason: 'Includes tracked personality development in character sheets.' },
        { id: 'character_classifier', reason: 'Helps focus sheet work on meaningful characters instead of every minor NPC.' },
        { id: 'world_location_tracker', reason: 'Adds current location and travel context to character sheets.' }
    ],

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'The core of character continuity. It maintains high-fidelity "Thinking Sheets" for your cast, ensuring they remember who they are, how they speak, and what they have been through, even across hundreds of chapters.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'The system uses a tiered "Pyramid of Persona" to balance narrative depth with token efficiency:\n\n• PROTAGONIST: Always injected with maximum detail.\n• CORE CAST: Key heroines/companions. They receive deep, multi-paragraph sheets that are periodically "re-synthesized" to reflect long-term growth and history.\n• MAJOR CHARACTERS: Recurring NPCs. They are tracked via "Lite Capsules"—concentrated 1-3 paragraph profiles containing their biography and current status.\n• MINOR/NPC: Background entities handled by Character Classifier to save costs.\n\nLONG-TERM VALUE: Without this plugin, LLMs eventually "forget" a character\'s nuanced history as it slides out of the context window. This plugin extracts pivotal developments and stabilizes them into a persistent database, feeding the Writer agent exactly what it needs to maintain a consistent "voice" and "memory" for the entire cast.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'Medium',
            latency: 'Low'
        },

        track_major_personality: { type: 'checkbox', label: 'Track Personality for Major Characters', description: 'WARNING: Tracks many psychological metrics per character. Highly token-intensive. Recommended only for Core heroines.', default: false },
        track_major_relationships: {
            type: 'select',
            label: 'Tracking Tier (Relationships)',
            description: 'Controls which character relationships are tracked to optimize performance. "Core Only" is the most performant.',
            options: [
                { value: 'Core Only', label: 'Core Only (Core ⇿ Core)' },
                { value: 'Core Anchored', label: 'Core Anchored (Core ⇿ Core & Core ⇿ Major)' },
                { value: 'All', label: 'All Majors (Core ⇿ Core, Core ⇿ Major & Major ⇿ Major)' }
            ],
            default: 'Core Anchored'
        },
        model_def: { type: 'select', label: 'Generation Model', description: 'The LLM model used to synthesize character sheets.', options: 'llm-aliases', allowVnBackgroundModel: true, default: { inherit: 'vn_background' } },
        retries: { type: 'number', label: 'Max Retries', description: 'Maximum retries for the LLM call.', default: 4 },
        timeout: { type: 'number', label: 'Request Timeout (ms)', description: 'Maximum timeout (s) for the LLM call. Depending on the model the initial sheet generation can take a very long time (up to ~5m)', default: 360000 },
        min_characters: { type: 'number', label: 'Minimum Sheet Length', description: 'For the "core" characters: Increasing this value leads to more detailed sheets at the cost of using extra tokens.', default: 250 },
        update_frequency: { type: 'number', label: 'Update Frequency (Turns)', description: 'How often to update character sheets. The system will look back on the last N turns to update each characters sheet to be a better representation of the character in the current narrative state.', default: 5 },
        capsule_detail_level: { type: 'select', label: 'Lite Capsule Detail Level', description: 'For the "major" characters: Increasing this value leads to more detailed sheets at the cost of using extra tokens.', options: [{ label: 'Low', description: 'Extremely brief one-liners.' }, { label: 'Medium', description: 'Short descriptive paragraphs.' }, { label: 'High', description: 'Detailed summaries with rich background.' }], default: 'Medium' },
        light_capsule_limit: { type: 'number', label: 'Light Capsule Context Limit', description: 'Maximum number of major/minor characters to inject into the story context simultaneously. Higher values provide more world consistency but consume more tokens.', default: 6, min: 0, max: 20 },
        enable_capsule_auditor: { type: 'checkbox', label: 'Enable Capsule Auditor (GC)', description: 'Periodically audits recently created character capsules and removes obvious junk entries (timestamps, sentence fragments, generic labels). Recommended to keep enabled.', default: false },
        auditor_frequency: { type: 'number', label: 'Auditor Frequency (Turns)', description: 'How often the capsule auditor runs. It will review all new capsules created within this window.', default: 5, min: 3, max: 50 },
        auditor_model: { type: 'select', label: 'Auditor Model', description: 'The LLM model used for the capsule audit decision. A cheap/fast model is recommended.', options: 'llm-aliases', default: { model: 'highendmodel' } },
    },

    exports: {
        resolveName: async (context, tools, name) => identity.resolveName(tools, name),
        getRelevantCharacters: async (context, tools, limit) => logic.getRelevantCharacters(context, tools, limit),
        getCharacterImportance: async (context, tools, name) => storage.getCharacterImportance(tools, name),
        hasBootstrappedFacts: async (context, tools, name) => storage.hasBootstrappedFacts(tools, name),
        getCurrentSheet: async (context, tools, name, turnNumber) => storage.getCurrentSheet(tools, name, turnNumber),
        generateLightCapsule: async (ctx, t, name) => {
            t.logger.runtime(`Export: generateLightCapsule for ${name}`);
            return logic.generateLightCapsule(ctx, t, name);
        },
        updateLightCapsulesBatch: async (ctx, t, win) => {
            t.logger.runtime(`Export: updateLightCapsulesBatch, windowSize=${win}`);
            return logic.updateLightCapsulesBatch(ctx, t, win);
        },
        createOrUpdateCapsuleFromText: async (ctx, t, name, text, opt) => {
            t.logger.runtime(`Export: createOrUpdateCapsuleFromText for ${name}, text length=${text?.length || 0}`);
            return logic.createOrUpdateCapsuleFromText(ctx, t, name, text, opt);
        },
        provideFileView: async (turnContext, tools, { filePath }) => {
            tools.logger.runtime(`Export: provideFileView for ${filePath}`);
            await storage.initializeDatabase(tools);
            const relativePath = path.relative(turnContext.rootDirectory, filePath);
            const rows = await tools.db.project.query(`SELECT character_sheet_data FROM character_sheets WHERE source_file = ?`, [relativePath]);
            if (!rows || rows.length === 0) {
                tools.logger.runtime(`provideFileView: No sheet found for ${relativePath}`);
                return { success: false, error: 'Sheet not generated.' };
            }
            tools.logger.runtime(`provideFileView: Rendering editor for ${relativePath}`);
            return { content: ui.renderManualEditor(rows[0].character_sheet_data, filePath), type: 'html' };
        }
    },

    socketListeners: {
        'save-manual-character-sheet': async (data, tools) => {
            const { filePath, content } = data;
            tools.logger.log('Character Sheets', `Saving manual update for ${path.basename(filePath)}`);
            tools.logger.runtime(`Socket: save-manual-character-sheet for ${filePath}, content length=${content?.length || 0}`);
            await storage.initializeDatabase(tools);
            const relativePath = path.relative(tools.turnContext.rootDirectory, filePath);
            const rawContent = await tools.project.readFile(filePath);
            const crypto = require('crypto');
            const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex');
            const match = rawContent.match(/PYRAMID OF PERSONA:\s*([^\n\r]+)/i);
            const name = match ? match[1].trim() : path.basename(filePath, '.md');

            tools.logger.runtime(`save-manual-character-sheet: Identified character ${name}, hash=${contentHash}`);
            await tools.db.project.execute(
                `INSERT OR REPLACE INTO character_sheets (project_name, character_name, source_file, character_sheet_data, content_hash) VALUES (?, ?, ?, ?, ?)`,
                [tools.turnContext.projectName, name, relativePath, content, contentHash]
            );

            // Use parser to robustly extract biography
            const capsule = await parser.parseCharacterSheet(tools, content, { name });
            if (capsule && capsule.biography) {
                tools.logger.runtime(`save-manual-character-sheet: Syncing social registry for ${name}`);
                await logic.syncSocialRegistry(tools, name, capsule.biography);
            }

            tools.status.showTemporary('Character sheet updated!', 3000, '#2d5a27');
            tools.socket.emit('save-manual-character-sheet-success', { filePath });
        },

        'vn-hud-fetch-data': async (data, tools) => {
            const turnNumber = data?.turnNumber || tools.turnContext.turnNumber || 0;
            tools.logger.runtime(`Socket: vn-hud-fetch-data, turn=${turnNumber}`);
            const characters = await logic.getAllCharacters(tools, turnNumber);
            tools.logger.runtime(`vn-hud-fetch-data: Found ${characters.length} characters`);
            let output = tools.turnContext?.output || {};
            if (Number(turnNumber) !== Number(tools.turnContext?.turnNumber)) {
                try { output = (await tools.turns.get(turnNumber))?.output || output; } catch { }
            }
            const iconEntries = Object.entries(output.characterIcons || {});
            const iconFor = name => {
                const match = iconEntries.find(([key]) => key.toLowerCase() === String(name).toLowerCase());
                return match?.[1] ? tools.assets.resolveUrl(match[1], { kind: 'sprites' }) : '';
            };
            const previewNames = selectHudPreviewNames(
                characters,
                output,
                turnNumber,
                tools.turnContext?.projectName,
                5
            );
            const previewCharacters = previewNames.map(name => ({ name, icon: iconFor(name) }));
            const withRelationships = tools.plugins.isInstalled('relationship_tracker');
            tools.socket.emit('vn-hud-update-section', {
                id: 'character_sheets', pluginId: 'character_sheets', title: 'Characters', icon: '', controlIcon: '◉', controlLabel: 'Cast', priority: 30,
                dock: 'ambient-left', defaultOpen: true,
                html: ui.renderHudSection(characters.length, turnNumber, previewCharacters, { withRelationships })
            });
        },

        'character-sheets-request-full-list': async (data, tools) => {
            const turnNumber = data?.turnNumber || tools.turnContext.turnNumber || 0;
            tools.logger.log('Character Sheets', 'Opening full character registry');
            tools.logger.runtime(`Socket: character-sheets-request-full-list, turn=${turnNumber}`);
            const playerSettingsName = tools.settings.get().player_character_name || '';
            const characters = await logic.getIntegratedCharacterData(tools, turnNumber);
            tools.logger.log('Character Sheets', `Registry Request: Found ${characters.length} characters`);

            // Log full data for the first character as a sample
            if (characters.length > 0) {
                void characters[0];
            }

            let characterIcons = {};
            try {
                characterIcons = await getLatestCharacterIcons(tools);
                tools.logger.runtime(`character-sheets-request-full-list: Loaded ${Object.keys(characterIcons).length} icons`);
            } catch (e) {
                tools.logger.runtime(`character-sheets-request-full-list: Error loading icons: ${e.message}`);
            }
            characterIcons = resolveCharacterIconMap(characterIcons, tools);

            const isPlayerChar = (c) => c.isPlayer || (playerSettingsName && c.name.toLowerCase() === playerSettingsName.toLowerCase());
            const playerChar = characters.find(c => isPlayerChar(c));
            const majorChars = characters.filter(c => !isPlayerChar(c) && c.type === 'full').sort((a, b) => a.name.localeCompare(b.name));
            const otherChars = characters.filter(c => !isPlayerChar(c) && c.type !== 'full').sort((a, b) => a.name.localeCompare(b.name));

            tools.logger.log('Character Sheets', `Categorization: player=${!!playerChar}, major=${majorChars.length}, other=${otherChars.length}`);

            const schema = await schemaAdapter.loadSchema();
            const fields = schemaAdapter.getFields(schema, 'full');

            const modalHtml = `
                <div class="vn-hud-modal-search"><input type="text" class="vn-search-input" placeholder="Search characters..."></div>
                ${playerChar ? `<div class="char-registry-section-title">Protagonist</div><div class="char-grid">${ui.renderCharacterCard(playerChar, 0, true, characterIcons, playerSettingsName, fields, tools.turnContext.projectName)}</div>` : ''}
                ${majorChars.length > 0 ? `<div class="char-registry-section-title">Core Characters</div><div class="char-grid">${majorChars.map((c, i) => ui.renderCharacterCard(c, i, true, characterIcons, playerSettingsName, fields, tools.turnContext.projectName)).join('')}</div>` : ''}
                ${otherChars.length > 0 ? `<div class="char-registry-section-title">Major Characters</div><div class="char-grid">${otherChars.map((c, i) => ui.renderCharacterCard(c, i, false, characterIcons, playerSettingsName, fields, tools.turnContext.projectName)).join('')}</div>` : ''}
                <script>
                    (function() {
                        const input = document.querySelector('.vn-search-input');
                        if (input) {
                            input.addEventListener('input', (e) => {
                                const term = e.target.value.toLowerCase();
                                document.querySelectorAll('.char-citizen-card').forEach(card => {
                                    card.style.display = card.getAttribute('data-search').toLowerCase().includes(term) ? 'flex' : 'none';
                                });
                            });
                        }
                    })();
                </script>
            `;

            tools.socket.emit('vn-hud-show-modal', {
                title: 'Character Registry',
                html: modalHtml,
                scope: 'canvas',
                modalClass: 'character-registry-modal'
            });
        },

        'character-sheets-request-single': async (data, tools) => {
            const charName = data?.characterName;
            if (!charName) return;

            const turnNumber = data?.turnNumber || tools.turnContext.turnNumber || 0;
            tools.logger.runtime(`Socket: character-sheets-request-single for ${charName}, turn=${turnNumber}`);
            const characters = await logic.getIntegratedCharacterData(tools, turnNumber);
            const char = characters.find(c => c.name.toLowerCase() === charName.toLowerCase());
            if (char) {
                tools.logger.runtime(`DEBUG - Single Profile: ${char.name}, Type: ${char.type}, Capsule Keys: ${Object.keys(char.capsule).join(', ')}`);
            }

            if (!char) {
                tools.logger.runtime(`character-sheets-request-single: Character ${charName} not found`);
                tools.status.showTemporary(`Character ${charName} not found.`, 3000, '#8a1a1a');
                return;
            }

            let characterIcons = {};
            try {
                characterIcons = await getLatestCharacterIcons(tools);
            } catch { }
            characterIcons = resolveCharacterIconMap(characterIcons, tools);

            const icon = characterIcons[char.name] || characterIcons[char.name.toLowerCase()] || '';
            const isFull = char.type === 'full';
            const isPlayer = char.isPlayer;
            const isDead = char.capsule.status === 'DEAD';
            const accentColor = isDead ? 'var(--text-muted)' : (isPlayer ? 'var(--secondary)' : (isFull ? 'var(--primary)' : 'var(--accent)'));

            const schema = await schemaAdapter.loadSchema();
            const fields = schemaAdapter.getFields(schema, 'full');

            tools.logger.runtime(`character-sheets-request-single: Rendering profile for ${char.name}`);
            const modalHtml = ui.renderSingleProfileModal(char, icon, accentColor, fields, tools.turnContext.projectName);

            tools.socket.emit('vn-hud-show-modal', {
                title: `${char.name} - Profile`,
                html: modalHtml,
                scope: 'canvas',
                modalClass: 'character-profile-modal'
            });
        }
    },

    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 28,
            mode: 'parallel',
            run: async (_context, tools) => {
                try {
                    const css = await fs.readFile(path.join(__dirname, 'ui.css'), 'utf8');
                    return { id: 'character_sheets_hud', css };
                } catch (error) {
                    tools.logger.error('Frontend', `Failed to load Character HUD styles: ${error.message}`);
                    return null;
                }
            }
        },
        /**
         * Phase 1: Universal Cleanup
         * Clears any character sheet dynamic facts for the current or future turns to ensure a clean slate for retries.
         */
        'HOOK_PRE_VN_GENERATION': {
            priority: 5, // Run early
            run: async (turnContext, tools) => {
                if (!turnContext?.turnNumber) return;

                tools.logger.runtime(`[Cleanup] Purging character sheet dynamic facts for current turn scope.`);

                // Standardized cleanup for the current turn/interlude scope.
                // This ensures "Upsert-by-Turn" behavior and prevents duplicates during regeneration.
                await tools.facts.cleanUpFactsDb();
            }
        },
        'HOOK_SYSTEM_BOOT': {
            priority: 1, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_SYSTEM_BOOT');
                // Removed premature DB call
                tools.project.registerFileMode('charsheet', {
                    label: 'Character Sheet',
                    category: 'Characters',
                    description: 'Identifies a file as the basis for a *single* main character. The system summarizes this once into a high-fidelity persona database to ensure long-term character consistency.',
                    color: '#00e5ff',
                    backgroundColor: 'rgba(0, 229, 255, 0.1)'
                });
                tools.project.registerFileMode('cast_list', {
                    label: 'Supporting Cast',
                    description: 'Identifies a file as the basis for a one or more side characters. The system summarizes this once ito "lite" persona database to ensure long-term character consistency.',
                    color: '#ff9100',
                    backgroundColor: 'rgba(255, 145, 0, 0.1)'
                });
            }
        },
        'HOOK_VN_GUI_READY': {
            priority: 25, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_VN_GUI_READY');
                if (tools.plugins.isInstalled('vn_hud')) await module.exports.socketListeners['vn-hud-fetch-data']({}, tools);
            }
        },
        'HOOK_POST_DIALOGUE_PROCESSING': {
            priority: 10, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_POST_DIALOGUE_PROCESSING');
                const dp = turnContext.processed.dialogueProcessor;
                const dialogueLines = Array.isArray(dp?.processedLines) ? dp.processedLines : [];
                if (dialogueLines.length === 0) return;

                for (const line of dialogueLines) {
                    if (!line || line.type !== 'dialogue' || !line.character) continue;
                    const original = line.character;
                    line.character = await identity.resolveName(tools, line.character);
                    if (original !== line.character) tools.logger.runtime(`HOOK_POST_DIALOGUE_PROCESSING: Resolved ${original} -> ${line.character}`);
                }

                if (Array.isArray(turnContext.output.party) && turnContext.output.party.length > 0) {
                    const normalizedParty = new Set();
                    for (const member of turnContext.output.party) {
                        const resolved = await identity.resolveName(tools, member);
                        normalizedParty.add(resolved);
                        if (member !== resolved) tools.logger.runtime(`HOOK_POST_DIALOGUE_PROCESSING: Resolved party member ${member} -> ${resolved}`);
                    }
                    turnContext.output.party = Array.from(normalizedParty);
                }
            }
        },
        'HOOK_PRE_PROMPT_BUILDER': {
            priority: 10, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_PRE_PROMPT_BUILDER');
                await logic.processCoreSheetsHook(turnContext, tools);
                await logic.ensurePlayerCapsule(turnContext, tools);
            }
        },
        'HOOK_VN_BACKGROUND_TASKS:NEW_CHARACTERS': {
            priority: 30, run: async (turnContext, tools) => {
                tools.logger.runtime(`Hook: HOOK_VN_BACKGROUND_TASKS:NEW_CHARACTERS, count=${turnContext.processed.newlyIntroducedCharacters?.length || 0}`);
                await logic.handleNewCharactersHook(turnContext, tools);
            }
        },
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 50, mode: 'parallel', useSharedVnLlm: true, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_VN_BACKGROUND_TASKS');
                await logic.handleEvolutionHook(turnContext, tools);
            }
        },
        'HOOK_VN_BACKGROUND_TASKS:CAPSULE_AUDIT': {
            priority: 70, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_VN_BACKGROUND_TASKS:CAPSULE_AUDIT');
                await logic.handleCapsuleAuditHook(turnContext, tools);
            }
        },
        'HOOK_VN_BACKGROUND_TASKS:INTEGRATED_SYNC': {
            priority: 80, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_VN_BACKGROUND_TASKS:INTEGRATED_SYNC');
                if (tools.plugins.isInstalled('vn_hud')) await module.exports.socketListeners['vn-hud-fetch-data']({}, tools);
            }
        },
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 30, run: async (turnContext, tools) => {
                tools.logger.runtime('Hook: HOOK_POST_PROMPT_BUILDER');
                await logic.handlePromptInjectionHook(turnContext, tools);
            }
        }
    }
};
