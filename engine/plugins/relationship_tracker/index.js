// plugins/relationship_tracker/index.js

const logic = require('./logic.js');
const fs = require('fs/promises');
const path = require('path');
const bondsProvider = require('./timeline/bonds_provider.js');
const relCommand = require('./commands/rel_command.js');
const cleanupHook = require('./hooks/cleanup.js');
const prePromptBootstrapperHook = require('./hooks/pre_prompt_bootstrapper.js');
const promptInjectorHook = require('./hooks/prompt_injector.js');
const backgroundProcessorHook = require('./hooks/background_processor.js');
const newCharacterBootstrapperHook = require('./hooks/new_character_bootstrapper.js');
const { hudListener, fetchProcessedBonds } = require('./sockets/hud_listener.js');

module.exports = {
    id: 'relationship_tracker',
    name: 'Relationship Tracker',
    author: 'Fablekin Core',
    version: '1.2.0',
    category: 'Characters',
    wizard: {
        include: true,
        order: 420,
        group: 'Characters',
        label: 'Relationship Tracker',
        recommended_enabled: true,
        author_note: 'Recommended for party dynamics, romance, rivalries, and recurring social tension.',
        enabled_note: 'Tracks bonds such as friendship, romance, trust, fear, and respect between characters.',
        disabled_note: 'Relationships rely more on recent prose and are less available as structured state.',
        settings_note: 'Tune bond extraction, HUD display, and injection behavior in plugin settings.'
    },
    description: 'Models complex symmetrical bonds between characters using five vectors: Friendship, Romance, Trust, Fear, and Respect.',
    optionalDependencies: [
        { id: 'vn_hud', reason: 'Displays relationship state and changes in the VN interface.' },
        { id: 'character_sheets', reason: 'Feeds structured relationship details back into character context.' },
        { id: 'memory_recall', reason: 'Preserves important relationship history for later recall.' }
    ],
    interludeMode: 'all',

    timelineProviders: [
        bondsProvider
    ],

    exports: {
        /**
         * Gets the high-level bond dynamic (Archetype + Guidance).
         */
        getBond: async (context, tools, charA, charB, options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return null;
            const states = await logic.getCurrentRelationshipStates(tools, projectName, options.turnNumber);
            const stats = states[charA.toLowerCase()]?.[charB.toLowerCase()];
            if (!stats) return null;
            return logic.evaluatePairDynamicDetailed(charA, charB, stats);
        },
        /**
         * Gets the deep history: Origin + Rolling Ledger + Recent Beats.
         */
        getBondLedger: async (context, tools, charA, charB, _options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return null;

            const origin = (await logic.getRelationshipOrigins(tools, projectName))[`${charA.toLowerCase()}|${charB.toLowerCase()}`];
            const historySummary = await logic.getRelationshipHistorySummary(tools, projectName, charA, charB);
            const recentBeats = await logic.getRecentBeats(tools, projectName, charA, charB, historySummary.turn);

            let lines = [];
            if (origin) lines.push(`- **Origin**: ${origin}`);
            if (historySummary && historySummary.text) lines.push(`- **Narrative Evolution**: ${historySummary.text}`);
            if (recentBeats && recentBeats.length > 0) lines.push(`- **Recent Developments**:\n  * ${recentBeats.join('\n  * ')}`);

            return lines.length > 0 ? lines.join('\n') : null;
        },
        /**
         * THE TIERED RELEVANCE ALGORITHM (For LAYER 9)
         * Returns the top most relevant relationships based on State, Weight, and Thematic context.
         */
        getRelevantRelationships: async (context, tools, characterName, options = {}) => {
            return await logic.getTieredRelevantRelationships(tools, context, characterName, options);
        },
        /**
         * Gets the raw relationship states for all characters.
         */
        getRelationshipStates: async (context, tools, options = {}) => {
            const projectName = context?.projectName;
            const turnNumber = options.turnNumber;
            if (!projectName) return {};
            return await logic.getCurrentRelationshipStates(tools, projectName, turnNumber);
        },
        /**
         * Gets a synthesized natural-language summary of relationship states.
         */
        getRelationshipSummary: async (context, tools, party = [], options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return 'Project context missing.';
            return await logic.synthesizeTargetedRelationshipStates(tools, projectName, party, options);
        },
        /**
         * Gets the top significant relationships for a character.
         */
        getTopRelationships: async (context, tools, characterName, options = {}) => {
            const projectName = context?.projectName;
            if (!projectName) return [];
            return await logic.getTopRelationships(tools, projectName, characterName, options);
        }
    },

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Tracks evolving character bonds across friendship, romance, trust, fear, and respect.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Generates baseline bonds for known characters, extracts relationship shifts after each turn, and periodically consolidates recent beats into a long-term relationship ledger. These ledgers feed character sheets, HUD views, and prompt-time relationship context.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'Medium',
            cost: 'Medium',
            latency: 'Medium'
        },
        generator_model_def: {
            type: 'select',
            label: 'Initial Relationship Model',
            description: 'Model used to establish baseline relationship vectors for new or newly initialized characters.',
            options: 'llm-aliases',
            default: { model: 'highendmodel' }
        },
        extractor_model_def: {
            type: 'select',
            label: 'Relationship Evolution Model',
            description: 'Model used to identify relationship changes after each turn.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        retries: {
            type: 'number',
            label: 'Max Retries',
            description: 'Number of times to retry relationship LLM calls if they fail.',
            min: 0,
            max: 5,
            default: 1
        },
        timeout: {
            type: 'number',
            label: 'Request Timeout (ms)',
            description: 'Timeout for relationship LLM requests in milliseconds.',
            min: 10000,
            default: 120000
        },
        pacing_multiplier: {
            type: 'number',
            label: 'Relationship Change Pacing',
            description: 'Multiplier applied to extracted vector changes. Lower values make relationships evolve more slowly; higher values make shifts stronger.',
            min: 0.1,
            max: 5,
            default: 1
        },
        enable_rolling_ledger: {
            type: 'checkbox',
            label: 'Enable Rolling Relationship Ledger',
            description: 'Periodically consolidates relationship beats into long-term narrative summaries.',
            default: true
        },
        ledger_consolidation_interval: {
            type: 'number',
            label: 'Ledger Consolidation Interval',
            description: 'How many turns to wait before merging new relationship beats into the long-term bond ledger.',
            min: 1,
            max: 20,
            default: 5
        },
        ledger_consolidation_model_def: {
            type: 'select',
            label: 'Ledger Consolidation Model',
            description: 'Model used to summarize and consolidate relationship history.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        }
    },

    terminalCommands: {
        '/rel': relCommand
    },

    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 27,
            mode: 'parallel',
            run: async (_context, tools) => {
                try {
                    const css = await fs.readFile(path.join(__dirname, 'ui.css'), 'utf8');
                    return { id: 'relationship_tracker_hud', css };
                } catch (error) {
                    tools.logger.error('Frontend', `Failed to load Relationship HUD styles: ${error.message}`);
                    return null;
                }
            }
        },
        'HOOK_PRE_VN_GENERATION': cleanupHook,
        'HOOK_PRE_PROMPT_BUILDER': prePromptBootstrapperHook,
        'HOOK_POST_PROMPT_BUILDER': promptInjectorHook,
        'HOOK_VN_BACKGROUND_TASKS': backgroundProcessorHook,
        'HOOK_NEW_CHARACTER_IDENTIFIED': newCharacterBootstrapperHook,
        'HOOK_VN_GUI_READY': {
            priority: 25,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                if (tools.plugins.isInstalled('vn_hud')) {
                    tools.logger.runtime(`HOOK_VN_GUI_READY: Refreshing HUD data.`);
                    await module.exports.socketListeners['vn-hud-fetch-data']({}, tools);
                }
            }
        }
    },

    socketListeners: {
        'vn-hud-fetch-data': hudListener,
        'relationship-tracker-request-full-registry': async (data, tools) => {
            const processed = await fetchProcessedBonds(data, tools);
            if (!processed) return;

            const requestedFilter = String(data?.filter || '').trim();
            const normalizedFilter = requestedFilter.toLowerCase();
            const escapedFilter = requestedFilter
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            const projectName = tools.turnContext?.projectName;
            let playerName = tools.turnContext?.input?.playerCharacterName;
            if (!playerName) {
                try {
                    const rows = await tools.db.project.query("SELECT setting_value FROM project_settings WHERE setting_key = 'player_character_name'");
                    if (rows && rows.length > 0) playerName = rows[0].setting_value;
                } catch { }
            }

            // Fetch origins and history summaries
            let origins = {};
            try {
                origins = await logic.getRelationshipOrigins(tools, projectName);
            } catch { }

            const getVectorColor = (vector) => {
                const colors = {
                    friendship: '#4caf50',
                    romance: '#e91e63',
                    trust: '#2196f3',
                    fear: '#9c27b0',
                    respect: '#ffc107'
                };
                return colors[vector] || '#ffffff';
            };

            const renderCard = (rel, isWorld = false) => {
                const color = getVectorColor(rel.dominant.vector);
                const score = rel.dominant.score;
                const absScore = Math.abs(score);

                let fullChar = '◆'; let emptyChar = '◇';
                if (rel.dominant.vector === 'romance' && score > 0) { fullChar = '❤'; emptyChar = '🖤'; }
                else if (rel.dominant.vector === 'fear' && score > 20) { fullChar = '💀'; emptyChar = '◇'; }
                else if (rel.dominant.vector === 'friendship' && score < -20) { fullChar = '⚔'; emptyChar = '◇'; }
                else if (rel.dominant.vector === 'respect' && score > 50) { fullChar = '🎖'; emptyChar = '◇'; }

                let pipCount = absScore > 80 ? 5 : absScore > 60 ? 4 : absScore > 40 ? 3 : absScore > 20 ? 2 : 1;
                const pips = `<span style="color: ${color}; letter-spacing: 1px;">` + fullChar.repeat(pipCount) + '</span>' +
                    `<span style="color: rgba(255,255,255,0.1); letter-spacing: 1px;">` + emptyChar.repeat(5 - pipCount) + '</span>';

                const vectors = ['friendship', 'romance', 'trust', 'fear', 'respect'];
                const statsHtml = vectors.map(v => {
                    const score = rel.stats[v] || 0;
                    if (score === 0) return '';
                    const vColor = getVectorColor(v);
                    const label = logic.getRelationshipLabel ? logic.getRelationshipLabel(score, v) : v;
                    const roundedScore = Math.round(score);
                    return `
                        <div style="display: flex; justify-content: space-between; font-size: 0.8em; margin-bottom: 4px; opacity: 0.8; border-bottom: 1px solid rgba(255,255,255,0.02);">
                            <span style="color: ${vColor}; text-transform: capitalize;">${label}:</span>
                            <span style="font-family: monospace;">${roundedScore > 0 ? '+' : ''}${roundedScore}</span>
                        </div>
                    `;
                }).join('');

                const getIconImg = (path) => path ? `<img src="${path}" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); object-fit: cover; vertical-align: middle; margin-right: 8px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">` : '';

                let header = '';
                if (isWorld) {
                    header = `
                        <div class="rel-char-group" style="display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${getIconImg(rel.iconA)}
                            <span style="font-size: var(--font-sm);">${rel.charA.toUpperCase()}</span>
                            <span style="margin: 0 6px; opacity: 0.3;">⇿</span>
                            ${getIconImg(rel.iconB)}
                            <span style="font-size: var(--font-sm);">${rel.charB.toUpperCase()}</span>
                        </div>
                    `;
                } else {
                    header = `
                        <div class="rel-char-group" style="display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <span style="color: var(--accent); font-size: var(--font-sm);">${playerName ? playerName.toUpperCase() : 'YOU'}</span>
                            <span style="margin: 0 10px; opacity: 0.3;">⇿</span>
                            ${getIconImg(rel.targetIcon)}
                            <span style="font-size: var(--font-sm);">${rel.displayName}</span>
                        </div>
                    `;
                }

                const pairKey = `${rel.charA.toLowerCase()}|${rel.charB.toLowerCase()}`;
                const originText = origins[pairKey] || origins[`${rel.charB.toLowerCase()}|${rel.charA.toLowerCase()}`];
                const searchText = `${rel.charA} ${rel.charB} ${rel.archetype}`;
                const initialDisplay = normalizedFilter && !searchText.toLowerCase().includes(normalizedFilter) ? ' display: none;' : '';

                return `
                    <div class="rel-registry-card" style="--local-accent: ${color};${initialDisplay}" data-search="${searchText}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);">
                            <div style="font-weight: bold;">${header}</div>
                            <div class="rel-pips-container">${pips}</div>
                        </div>
                        <div style="color: var(--local-accent); font-weight: bold; text-transform: uppercase; font-size: var(--font-xs); letter-spacing: 1px; margin-bottom: var(--space-xs);">${rel.archetype}</div>
                        <div style="font-size: var(--font-xs); font-style: italic; color: var(--text-main); margin-bottom: var(--space-md); line-height: 1.4; background: rgba(0,0,0,0.2); padding: var(--space-sm); border-radius: var(--radius-sm); border: var(--divider-weight) solid var(--divider-color);">${rel.guidance}</div>

                        ${originText ? `
                            <div style="margin-bottom: var(--space-sm);">
                                <div style="font-size: var(--font-xs); opacity: 0.5; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; font-weight: bold;">Origin Story</div>
                                <div style="font-size: var(--font-xs); line-height: 1.5; color: var(--text-muted);">${originText}</div>
                            </div>
                        ` : ''}

                        ${rel.evolution ? `
                            <div style="margin-bottom: var(--space-sm);">
                                <div style="font-size: var(--font-xs); opacity: 0.5; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; font-weight: bold;">Evolution</div>
                                <div style="font-size: var(--font-xs); line-height: 1.5; color: var(--text-muted); border-left: 2px solid var(--divider-color); padding-left: var(--space-xs);">${rel.evolution}</div>
                            </div>
                        ` : ''}

                        <div style="display: flex; flex-direction: column; gap: 2px; background: rgba(0, 0, 0, 0.1); padding: var(--space-sm); border-radius: var(--radius-sm);">${statsHtml}</div>
                    </div>
                `;
            };

            // Fetch narrative evolution for all pairs in parallel
            const allPairs = [...processed.allBonds, ...processed.allWorldDynamics];
            try {
                await Promise.all(allPairs.map(async rel => {
                    const hist = await logic.getRelationshipHistorySummary(tools, projectName, rel.charA, rel.charB);
                    if (hist && hist.text) {
                        rel.evolution = hist.text;
                    }
                }));
            } catch { }

            let modalHtml = `
                <div class="rel-registry-shell">
                    <section class="rel-registry-hero">
                        <div class="rel-registry-badge" aria-hidden="true">∞</div>
                        <div class="rel-registry-copy">
                            <div class="rel-registry-kicker">Social Ledger</div>
                            <h2>Relationship Registry</h2>
                            <div class="rel-registry-next">${processed.allBonds.length} personal bond${processed.allBonds.length === 1 ? '' : 's'} · ${processed.allWorldDynamics.length} world dynamic${processed.allWorldDynamics.length === 1 ? '' : 's'}</div>
                        </div>
                        <div class="rel-registry-score">
                            <strong>${processed.totalCount}</strong>
                            <span>Total Bonds</span>
                        </div>
                    </section>
                    <section class="rel-registry-stats" aria-label="Relationship registry statistics">
                        <span><strong>${processed.tier1Bonds.length}</strong>Closest</span>
                        <span><strong>${processed.hudBonds.length}</strong>Party/Core</span>
                        <span><strong>${processed.tier2Contacts.length}</strong>Contacts</span>
                        <span><strong>${processed.displayedWorldDynamics.length}</strong>Dynamics</span>
                    </section>
                    <div class="vn-hud-modal-search">
                        <input type="text" class="vn-search-input" value="${escapedFilter}" placeholder="Search characters or bonds..." oninput="const term = this.value.toLowerCase(); document.querySelectorAll('.rel-registry-card').forEach(c => c.style.display = c.getAttribute('data-search').toLowerCase().includes(term) ? '' : 'none');">
                    </div>
                    <div class="rel-modal-grid">
            `;

            if (processed.allBonds.length > 0) {
                modalHtml += `<div class="rel-section-title">Your Bonds</div>`;
                modalHtml += processed.allBonds.map(rel => renderCard(rel, false)).join('');
            }

            if (processed.allWorldDynamics.length > 0) {
                modalHtml += `<div class="rel-section-title">World Dynamics</div>`;
                modalHtml += processed.allWorldDynamics.map(rel => renderCard(rel, true)).join('');
            }

            modalHtml += `</div></div>`;

            tools.socket.emit('vn-hud-show-modal', {
                title: 'Relationship Registry',
                html: modalHtml,
                scope: 'canvas',
                modalClass: 'relationship-registry-modal'
            });
        }
    }
};
