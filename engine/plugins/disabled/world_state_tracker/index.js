// plugins/world_state_tracker/index.js

const logic = require('./logic.js');
const fs = require('fs/promises');
const path = require('path');

module.exports = {
    id: 'world_state_tracker',
    name: 'World State Tracker',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'World',
    wizard: {
        include: true,
        order: 510,
        group: 'World',
        label: 'World State Tracker',
        recommended_enabled: true,
        author_note: 'Recommended for continuity around time, weather, inventory, and global situation.',
        enabled_note: 'Extracts and persists world-state facts so future turns can stay situationally consistent.',
        disabled_note: 'World facts become less stable unless captured by other memory or lore systems.',
        settings_note: 'Tune extraction model and tracked state behavior in plugin settings.'
    },
    description: 'Extracts and tracks global world facts like time, weather, and party inventory to ensure situational consistency.',
    optionalDependencies: [
        { id: 'vn_hud', reason: 'Displays tracked time, weather, inventory, and world-state updates in the VN interface.' },
        { id: 'world_location_tracker', reason: 'Keeps world-state changes grounded in the party\'s actual location and travel.' },
        { id: 'memory_recall', reason: 'Preserves important world-state facts for later story recall.' }
    ],
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Tracks the time, weather, and inventory of the story world.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Extracts environmental and material facts from the narrative output. It ensures that if the Writer agent mentions it is raining or that the party found a sword, those facts are persisted in the database and echoed in future prompt assembly to maintain consistency.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'Low',
            cost: 'Medium',
            latency: 'Medium'
        },
        model_def: {
            type: 'select',
            label: 'Extraction Model',
            description: 'Model used to extract state changes and time progression from narrative text.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        },
        dawn_start: {
            type: 'number',
            label: 'Dawn Start Hour',
            max: 23,
            default: 5
        },
        day_start: {
            type: 'number',
            label: 'Day Start Hour',
            description: 'The hour (0-23) when Day begins.',
            min: 0,
            max: 23,
            default: 9
        },
        dusk_start: {
            type: 'number',
            label: 'Dusk Start Hour',
            description: 'The hour (0-23) when Dusk begins.',
            min: 0,
            max: 23,
            default: 18
        },
        night_start: {
            type: 'number',
            label: 'Night Start Hour',
            description: 'The hour (0-23) when Night begins.',
            min: 0,
            max: 23,
            default: 21
        },
        world_logic: {
            type: 'project-directive',
            label: 'World Tracking Logic',
            description: 'Guide how the AI interprets world changes from the story. Define default conditions or rules for tracking time, weather, and inventory facts.',
            placeholder: 'e.g., "In Arrakis it never rains, default the weather to clear. Characters use credits instead of gold."',
            isProjectDirective: true
        }
    },
    timelineProviders: [
        {
            type: 'card',
            side: 'left',
            fn: async (turnContext, tools) => {
                const hasLocationTracker = tools.plugins.isInstalled('world_location_tracker');
                const worldState = await logic.synthesizeWorldState(turnContext, tools, turnContext.turnNumber, { skipLocation: hasLocationTracker });
                if (!worldState || !worldState.structuredData) return null;

                const data = worldState.structuredData;
                const fields = [];

                if (data.qualitativeTime && data.formattedDate) {
                    const statusIcons = { 'Dawn': '🌅', 'Day': '☀️', 'Dusk': '🌇', 'Night': '🌙' };
                    fields.push({ label: 'Time', value: `${statusIcons[data.qualitativeTime] || '🕒'} ${data.qualitativeTime} (${data.formattedDate})` });
                }
                if (data.elapsedTime) fields.push({ label: 'Elapsed', value: `⏳ ${data.elapsedTime}` });
                if (data.weatherChange) fields.push({ label: 'Weather', value: data.weatherChange });
                if (data.climate) fields.push({ label: 'Climate', value: data.climate });
                if (data.safetyLevel) fields.push({ label: 'Safety', value: data.safetyLevel });

                if (fields.length === 0) return null;

                return {
                    icon: '◎',
                    title: 'World State',
                    fields
                };
            }
        },
        {
            type: 'branch',
            side: 'left',
            fn: async (turnContext, tools) => {
                const projectName = turnContext.projectName;
                if (!projectName) return null;
                const targetTurn = turnContext.turnNumber;

                try {
                    // Fetch inventory shifts for this exact turn
                    const turnShifts = await tools.db.chat.query(
                        `SELECT target as item, SUM(fact_value) as delta, context as brief
                         FROM facts 
                         WHERE project_name = ? AND turn_number = ? AND predicate = 'inventory'
                         GROUP BY target, context
                         ORDER BY id ASC`,
                        [projectName.toLowerCase(), targetTurn]
                    );

                    if (!turnShifts || turnShifts.length === 0) return null;

                    let changes = [];
                    for (const shift of turnShifts) {
                        const delta = Number(shift.delta || 0);
                        if (delta === 0) continue;

                        const symbol = delta > 0 ? '+' : '';
                        const color = delta > 0 ? 'var(--status-success)' : 'var(--status-danger)';

                        let icon = '📦';
                        try {
                            const iconRes = await tools.db.chat.query(
                                `SELECT fact_value FROM facts 
                                 WHERE project_name = ? AND target = ? AND predicate = 'inventory_icon' AND turn_number <= ? 
                                 ORDER BY turn_number DESC, id DESC LIMIT 1`,
                                [projectName.toLowerCase(), shift.item, targetTurn]
                            );
                            if (iconRes && iconRes.length > 0) icon = iconRes[0].fact_value;
                        } catch { }

                        changes.push({
                            item: shift.item,
                            deltaStr: `${symbol}${delta}`,
                            color: color,
                            icon: icon,
                            brief: shift.brief
                        });
                    }

                    if (changes.length === 0) return null;

                    const children = changes.map(change => {
                        const displayName = change.item.charAt(0).toUpperCase() + change.item.slice(1);
                        return {
                            title: displayName,
                            text: `
                                 <div style="margin-top: var(--space-xs); border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-card-light); border-left: var(--divider-weight) solid ${change.color}; padding: var(--space-xs) var(--space-sm);">
                                     <div style="font-weight: bold; font-size: var(--font-size-sm); color: ${change.color};">
                                         <span>${change.icon} ${change.deltaStr}</span>
                                     </div>
                                     ${change.brief && change.brief !== 'Scene-based change' ? `<div style="margin-top: var(--space-xs); font-size: var(--font-size-xs); color: var(--text-muted); font-style: italic; line-height: 1.3;">"${change.brief}"</div>` : ''}
                                 </div>
                             `
                        };
                    });

                    return {
                        id: 'inventory_shifts',
                        icon: '🎒',
                        title: 'Party Inventory',
                        label: 'Items',
                        content: `${children.length} item${children.length > 1 ? 's' : ''} modified.`,
                        children: children
                    };
                } catch (e) {
                    tools.logger.error('Timeline', 'Failed to fetch inventory activity: ' + e.message);
                    return null;
                }
            }
        }
    ],
    exports: {
        'getWorldStateSnapshot': async (turnContext, tools, options = {}) => {
            const requestContext = options.context || turnContext;
            const targetTurn = options.turnNumber || requestContext.turnNumber || turnContext.turnNumber;
            const hasLocationTracker = tools.plugins.isInstalled('world_location_tracker');
            return await logic.synthesizeWorldState(requestContext, tools, targetTurn, {
                skipLocation: options.skipLocation !== undefined ? options.skipLocation : hasLocationTracker
            });
        },
        'upsertLocationEvent': async (turnContext, tools, event, options = {}) => {
            const requestContext = options.context || turnContext;
            return await logic.upsertLocationEvent(requestContext, tools, event, options);
        },
        'getLocationEvents': async (turnContext, tools, options = {}) => {
            const requestContext = options.context || turnContext;
            return await logic.getLocationEvents(requestContext, tools, options);
        },
        'getLocationEvent': async (turnContext, tools, anchorNode, options = {}) => {
            const requestContext = options.context || turnContext;
            return await logic.getLocationEvent(requestContext, tools, anchorNode, options);
        },
        'getInjectedData': async (turnContext, tools, options = {}) => {
            const hasLocationTracker = tools.plugins.isInstalled('world_location_tracker');
            const requestContext = options.context || turnContext;
            const targetTurn = options.turnNumber || requestContext.turnNumber || turnContext.turnNumber;
            const dialogueIndex = Number.isFinite(Number(options.dialogueIndex))
                ? Math.max(0, Math.round(Number(options.dialogueIndex)))
                : null;

            const worldState = Number.isInteger(dialogueIndex)
                ? await logic.synthesizeWorldStateForDialogue(requestContext, tools, targetTurn, dialogueIndex, { skipLocation: hasLocationTracker })
                : await logic.synthesizeWorldState(requestContext, tools, targetTurn, { skipLocation: hasLocationTracker });
            if (!worldState || !worldState.structuredData) return null;

            const data = worldState.structuredData;
            const pluginSettings = await Promise.resolve(tools.settings.getSelf()) || {};

            const escapeHudText = value => String(value ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const phase = ['Dawn', 'Day', 'Dusk', 'Night'].includes(data.qualitativeTime)
                ? data.qualitativeTime
                : 'Day';
            const dateMatch = String(data.formattedDate || '').match(/Day\s+(\d+),\s+(\d{1,2}:\d{2})\s+(AM|PM)/i);
            const clockDay = dateMatch ? `Day ${dateMatch[1]}` : 'Current day';
            const clockTime = dateMatch ? dateMatch[2] : '--:--';
            const clockMeridiem = dateMatch ? dateMatch[3].toUpperCase() : '';
            const toHour24 = (hour, meridiem) => {
                let value = Number(hour) || 0;
                if (String(meridiem).toUpperCase() === 'PM' && value !== 12) value += 12;
                if (String(meridiem).toUpperCase() === 'AM' && value === 12) value = 0;
                return value;
            };
            const dayNumber = dateMatch ? Number(dateMatch[1]) : 1;
            const [displayHour, displayMinute] = dateMatch ? dateMatch[2].split(':').map(Number) : [8, 0];
            const hour24 = toHour24(displayHour, clockMeridiem);
            const minuteOfDay = (hour24 * 60) + displayMinute;
            const absoluteMinutes = ((Math.max(1, dayNumber) - 1) * 1440) + minuteOfDay;
            const clampHour = (value, fallback) => Math.max(0, Math.min(23, Number.isFinite(Number(value)) ? Number(value) : fallback));
            const dawnMinute = clampHour(pluginSettings.dawn_start, 5) * 60;
            const dayMinute = clampHour(pluginSettings.day_start, 9) * 60;
            const duskMinute = clampHour(pluginSettings.dusk_start, 18) * 60;
            const nightMinute = clampHour(pluginSettings.night_start, 21) * 60;
            const classify = (value, choices, fallback) => {
                const normalized = String(value || '').toLowerCase();
                return choices.find(choice => normalized.includes(choice)) || fallback;
            };
            const weatherClass = classify(data.weatherChange, ['sunny', 'rainy', 'overcast', 'stormy', 'clear', 'foggy'], 'neutral');
            const safetyClass = classify(data.safetyLevel, ['safe', 'caution', 'danger', 'combat'], 'safe');
            const crowdClass = classify(data.crowdDensity, ['alone', 'sparse', 'crowded'], 'alone');

            const clockHtml = `
                <div class="world-clock-card phase-${phase.toLowerCase()} weather-${weatherClass} safety-${safetyClass} crowd-${crowdClass}"
                     data-clock-minutes="${absoluteMinutes}"
                     data-clock-dawn="${dawnMinute}"
                     data-clock-day="${dayMinute}"
                     data-clock-dusk="${duskMinute}"
                     data-clock-night="${nightMinute}">
                    <div class="world-clock-orb" aria-hidden="true">
                        <span class="world-clock-stars"></span>
                        <span class="world-clock-celestial world-clock-sun"></span>
                        <span class="world-clock-celestial world-clock-moon"></span>
                        <span class="world-clock-horizon"></span>
                    </div>
                    <div class="world-clock-readout">
                        <span class="world-clock-phase">${escapeHudText(phase)}</span>
                        <div class="world-clock-time">
                            <strong>${escapeHudText(clockTime)}</strong>
                            <span>${escapeHudText(clockMeridiem)}</span>
                        </div>
                        <span class="world-clock-day">${escapeHudText(clockDay)}</span>
                    </div>
                </div>
            `;

            const environmentHtml = `
                <div class="world-environment-card weather-${weatherClass} safety-${safetyClass} crowd-${crowdClass}">
                    <div class="world-environment-item world-clock-weather">
                        <i aria-hidden="true"></i>
                        <span><small>Weather</small><strong>${escapeHudText(data.weatherChange || 'Unknown')}</strong></span>
                    </div>
                    <div class="world-environment-item world-clock-climate">
                        <i aria-hidden="true"></i>
                        <span><small>Climate</small><strong>${escapeHudText(data.climate || 'Unknown')}</strong></span>
                    </div>
                    <div class="world-environment-item world-clock-safety">
                        <i aria-hidden="true"></i>
                        <span><small>Safety</small><strong>${escapeHudText(data.safetyLevel || 'Safe')}</strong></span>
                    </div>
                    <div class="world-environment-item world-clock-crowd">
                        <i aria-hidden="true"></i>
                        <span><small>Crowd</small><strong>${escapeHudText(data.crowdDensity || 'Alone')}</strong></span>
                    </div>
                </div>
            `;

            const inventoryItems = data.inventory.filter(item => item.quantity > 0);
            const totalItems = inventoryItems.length;
            const totalQuantity = inventoryItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

            const inventoryHtml = `
                <button type="button" class="hud-socket-emit inventory-hud-button"
                        data-event="world-state-tracker-request-full-inventory"
                        data-payload='{"turnNumber": ${targetTurn}, "dialogueIndex": ${Number.isInteger(dialogueIndex) ? dialogueIndex : 'null'}}'
                        aria-label="Open inventory: ${totalQuantity} items across ${totalItems} types">
                    <span class="inventory-hud-satchel" aria-hidden="true"><i></i></span>
                    <span class="inventory-hud-copy">
                        <strong>Inventory</strong>
                        <small>${totalQuantity} ${totalQuantity === 1 ? 'item' : 'items'} · ${totalItems} ${totalItems === 1 ? 'type' : 'types'}</small>
                    </span>
                    <span class="inventory-hud-open" aria-hidden="true">↗</span>
                </button>
            `;

            return {
                clock: {
                    id: 'world_clock',
                    pluginId: 'world_state_tracker',
                    title: 'World Clock',
                    icon: '',
                    controlIcon: '◷',
                    controlLabel: 'World Clock',
                    priority: 5,
                    dock: 'ambient-right',
                    defaultOpen: true,
                    html: `<div class="world_state_tracker_container">${clockHtml}</div>`
                },
                environment: {
                    id: 'world_environment',
                    pluginId: 'world_state_tracker',
                    title: 'World Conditions',
                    icon: '',
                    controlIcon: '☁',
                    controlLabel: 'World Conditions',
                    priority: 6,
                    dock: 'ambient-right',
                    defaultOpen: true,
                    html: `<div class="world_state_tracker_container">${environmentHtml}</div>`
                },
                inventory: {
                    id: 'inventory',
                    pluginId: 'world_state_tracker',
                    title: 'Inventory',
                    icon: '',
                    controlIcon: '▣',
                    controlLabel: 'Inventory',
                    priority: 40,
                    dock: 'ambient-left',
                    defaultOpen: true,
                    html: `<div class="world_state_tracker_container">${inventoryHtml}</div>`
                }
            };
        }
    },
    terminalCommands: {
        '/world': {
            description: 'Inspect World State and Inventory history. Usage: /world [subcommand] [turn_selector]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
                const subcommand = args[0]?.toLowerCase();

                if (!subcommand || subcommand === 'help') {
                    return `\r\n${colors.bright}World State Tracker Toolkit${colors.reset}\r\n` +
                        `Usage: /world ${colors.cyan}[subcommand]${colors.reset} ${colors.magenta}[turn_selector]${colors.reset}\r\n\r\n` +
                        `${colors.bright}Subcommands:${colors.reset}\r\n` +
                        `  ${colors.cyan}state${colors.reset}      - Show the current world state / global variables.\r\n` +
                        `  ${colors.cyan}inv${colors.reset}        - Inspect player inventory history and modifications.\r\n` +
                        `  ${colors.cyan}stats${colors.reset}      - Show project-wide world state statistics.\r\n\r\n` +
                        `${colors.bright}Parameters:${colors.reset}\r\n` +
                        `  ${colors.magenta}[turn_selector]${colors.reset}  - History navigation. Use ${colors.bright}N${colors.reset} for limit or ${colors.bright}X-Y${colors.reset} for a range.\r\n\r\n` +
                        `${colors.bright}Examples:${colors.reset}\r\n` +
                        `  /world state\r\n` +
                        `  /world inv 5\r\n` +
                        `  /world state 1-10\r\n`;
                }

                const selector = args[1];
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

                if (subcommand === 'inv') {
                    if (isRange) {
                        // Show all inventory shifts in history range
                        const shifts = await tools.db.chat.query(
                            `SELECT turn_number, target, fact_value as delta, context 
                             FROM facts 
                             WHERE project_name = ? AND predicate = 'inventory' AND turn_number BETWEEN ? AND ?
                             ORDER BY turn_number ASC, id ASC`,
                            [projectName.toLowerCase(), startTurn, endTurn]
                        );

                        if (!shifts || shifts.length === 0) return `No inventory changes between Turn ${startTurn} and ${endTurn}.`;

                        let output = `\r\n\x1b[1;32mInventory History (Turns ${startTurn}-${endTurn}):\x1b[0m\r\n`;
                        shifts.forEach(s => {
                            const color = s.delta > 0 ? '\x1b[1;32m' : '\x1b[1;31m';
                            const sign = s.delta > 0 ? '+' : '';
                            output += `  [Turn ${s.turn_number}] \x1b[1;36m${s.target}\x1b[0m: ${color}${sign}${s.delta}\x1b[0m ${s.context ? `(${s.context})` : ''}\r\n`;
                        });
                        return output;
                    } else {
                        // Show cumulative state at turn endTurn (which is our single selector if not range)
                        const state = await logic.synthesizeWorldState(tools.turnContext, tools, endTurn);
                        const inv = state.structuredData?.inventory || [];
                        if (inv.length === 0) return `Inventory is empty at Turn ${endTurn}.`;

                        let output = `\r\n\x1b[1;32mInventory State at Turn ${endTurn}:\x1b[0m\r\n`;
                        inv.forEach(i => {
                            output += `  ${i.icon} \x1b[1;36m${i.item}\x1b[0m: x${i.quantity} \x1b[0;90m- ${i.description}\x1b[0m\r\n`;
                        });
                        return output;
                    }
                } else if (subcommand === 'state') {
                    let output = `\r\n\x1b[1;32mWorld State (${isRange ? `Turns ${startTurn}-${endTurn}` : `Turn ${endTurn}`}):\x1b[0m\r\n`;

                    for (let t = startTurn; t <= endTurn; t++) {
                        const state = await logic.synthesizeWorldState(tools.turnContext, tools, t);
                        const d = state.structuredData;
                        if (!d) continue;

                        if (isRange) output += `\x1b[1;33m[Turn ${t}]\x1b[0m\r\n`;
                        output += `  \x1b[1;36mTime:\x1b[0m ${d.qualitativeTime} (${d.formattedDate}) [Elapsed: ${d.elapsedTime}]\r\n`;
                        output += `  \x1b[1;36mWeather:\x1b[0m ${d.weatherChange || 'N/A'} | \x1b[1;36mClimate:\x1b[0m ${d.climate || 'N/A'}\r\n`;
                        output += `  \x1b[1;36mSafety:\x1b[0m ${d.safetyLevel} | \x1b[1;36mCrowd:\x1b[0m ${d.crowdDensity}\r\n`;
                        if (isRange && t < endTurn) output += `  \x1b[0;90m--------------------\x1b[0m\r\n`;
                    }
                    return output;
                } else if (subcommand === 'stats') {
                    const stats = await tools.db.chat.query(
                        `SELECT COUNT(DISTINCT target) as total_items, SUM(ABS(fact_value)) as total_activity
                         FROM facts 
                         WHERE project_name = ? AND predicate = 'inventory'`,
                        [projectName.toLowerCase()]
                    );
                    const time = await tools.db.chat.query(
                        `SELECT SUM(fact_value) as total_mins FROM facts WHERE project_name = ? AND predicate = 'quantitative_time_change'`,
                        [projectName.toLowerCase()]
                    );
                    const totalMins = time[0]?.total_mins || 0;
                    const days = Math.floor(totalMins / 1440);

                    return `\r\n\x1b[1;32mWorld Stats:\x1b[0m\r\n  Total Items Discovered: ${stats[0].total_items}\r\n  Inventory Operations: ${stats[0].total_activity}\r\n  Total Adventure Time: ${days} days (${totalMins} minutes)\r\n`;
                }

                return 'Unknown subcommand. Use /world [inv|state|stats]';
            }
        }
    },
    hooks: {
        'HOOK_DIRECTOR_PRE_PROMPT': {
            priority: 35,
            mode: 'parallel',
            run: async (_turnContext, tools) => {
                tools.director.cot.add({
                    id: 'world_state_tracker.time_realism',
                    step: '13.2F',
                    title: 'Respect Time Realism',
                    content: `Critical: Theres a plugin taking care of time tracking - which means our adventure should respect time realism. IMPORTANT: Always reflect and help the writer with the following: 'Roughly how long should this chapter take?' 'What time is it of day?' 'Should we make the time narratively significant (e.g. rest, lunch, tiredness, night/sleeping, etc.)?' - The story doesn't have to keep mentioning time, but should be aware of our current situation at all times.`
                });
            }
        },
        'HOOK_FRONTEND_INJECTION': {
            priority: 29,
            mode: 'parallel',
            run: async (_context, tools) => {
                try {
                    const [clockJs, inventoryJs] = await Promise.all([
                        fs.readFile(path.join(__dirname, 'ui_clock.js'), 'utf8'),
                        fs.readFile(path.join(__dirname, 'ui_inventory.js'), 'utf8')
                    ]);
                    return { id: 'world_state_tracker_frontend', js: `${clockJs}\n\n${inventoryJs}` };
                } catch (error) {
                    tools.logger.error('Frontend', `Failed to load World State Tracker frontend scripts: ${error.message}`);
                    return null;
                }
            }
        },
        /**
         * Phase 1: Universal Cleanup
         * Clears any world state facts for the current or future turns to ensure a clean slate for retries.
         */

        /**
         * Fired from the frontend when the scene has finished rendering.
         * Used to push fresh data to the HUD if it's active.
         */
        'HOOK_VN_GUI_READY': {
            priority: 20,
            mode: 'parallel',
            run: async (turnContext, tools, hookData = {}) => {
                if (tools.plugins.isInstalled('vn_hud')) {
                    await module.exports.socketListeners['vn-hud-fetch-data']({
                        turnNumber: turnContext.turnNumber,
                        dialogueIndex: Number.isInteger(hookData.dialogueIndex) ? hookData.dialogueIndex : 0
                    }, tools);
                }
            }
        },
        /**
         * Sequential hook called after the prompt components are gathered but before the final message assembly.
         * Used to inject the world state snapshot into the system prompt.
         */
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 20,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const projectName = turnContext.projectName;
                const turnNumber = turnContext.turnNumber;

                tools.logger.log('Synthesis', `Synthesizing world state for turn: ${turnNumber}`, 'start');

                // Synthesize for the previous turn to get the state BEFORE the current action
                const synthTurn = turnNumber > 1 ? turnNumber - 1 : 1;
                const hasLocationTracker = tools.plugins.isInstalled('world_location_tracker');

                const worldState = await logic.synthesizeWorldState(turnContext, tools, synthTurn, { skipLocation: hasLocationTracker });

                if (worldState && worldState.synthesizedText) {
                    const wrappedSnapshot = tools.prompt.wrap('world_state', worldState.synthesizedText);
                    const directorPluginFeedbackEnabled = tools.settings.get('narrative_agents.director.direct_plugins_enabled') !== false;
                    const pluginPromptParts = [];
                    if (directorPluginFeedbackEnabled) {
                        const previousTurnUpdate = await logic.buildPreviousTurnUpdate(turnContext, tools, synthTurn);
                        pluginPromptParts.push(tools.prompt.wrap('previous_turn_update', previousTurnUpdate || 'No previous turn update is available.'));
                    }
                    try {
                        const deletedRows = await tools.db.chat.query(
                            `SELECT target AS item, SUM(ABS(fact_value)) AS quantity
                             FROM facts
                             WHERE project_name = ?
                               AND turn_number = ?
                               AND predicate = 'inventory'
                               AND fact_value < 0
                               AND context = 'manual_inventory_delete'
                             GROUP BY target
                             ORDER BY MIN(id) ASC`,
                            [projectName.toLowerCase(), synthTurn]
                        );
                        if (deletedRows && deletedRows.length > 0) {
                            const playerName = String(turnContext.input?.playerCharacterName || 'Player').trim() || 'Player';
                            const itemList = deletedRows
                                .map(row => `${row.item}${Number(row.quantity || 0) > 1 ? ` x${Number(row.quantity || 0)}` : ''}`)
                                .join(', ');
                            pluginPromptParts.push(tools.prompt.wrap(
                                'previous_inventory_disposal',
                                `${playerName} got rid of the following carried item(s) last turn: ${itemList}. This is a one-turn reminder only; acknowledge the changed inventory if relevant, but do not keep repeating it.`
                            ));
                        }
                    } catch (error) {
                        tools.logger.warn('Prompt', `Failed to build one-turn inventory disposal reminder: ${error.message}`);
                    }
                    pluginPromptParts.push(tools.prompt.wrap('current_state', wrappedSnapshot));
                    const pluginPrompt = pluginPromptParts.join('\n\n');
                    tools.prompt.inject('simulation', pluginPrompt, 'root', { directable: true });

                    // Store structured data for other modules
                    turnContext.processed.worldState = worldState.structuredData;
                    turnContext.output.worldStateSynthesized = worldState.synthesizedText;
                }

                // Populate extraDetails for assetSelector
                if (!turnContext.processed.assetSelector) {
                    turnContext.processed.assetSelector = {};
                }

                let extraParts = [];
                if (worldState && worldState.structuredData) {
                    let locationText = worldState.structuredData.locations && worldState.structuredData.locations.length > 0 ? worldState.structuredData.locations.join(', ') : null;
                    if (hasLocationTracker) {
                        try {
                            const locState = await tools.plugins.tryCall(
                                'world_location_tracker',
                                'getCurrentLocation',
                                [{ context: turnContext, turnNumber: synthTurn }],
                                { silent: true, fallback: null }
                            );
                            if (locState && locState.name) {
                                locationText = locState.name;
                            }
                        } catch (err) {
                            tools.logger.error('AssetSelector Injection', `Failed to fetch location from tracker: ${err.message}`);
                        }
                    }
                    if (locationText) {
                        extraParts.push(`Location: ${locationText}`);
                    }
                    if (worldState.structuredData.weatherChange) {
                        extraParts.push(`Weather: ${worldState.structuredData.weatherChange}`);
                    }
                    if (worldState.structuredData.qualitativeTime && worldState.structuredData.formattedDate) {
                        extraParts.push(`Time: ${worldState.structuredData.qualitativeTime} (${worldState.structuredData.formattedDate})`);
                    }
                }
                turnContext.processed.assetSelector.extraDetails = extraParts.join(' | ');

                // --- INJECT TIMELINE ROUTING FOR PAST CHAPTERS ---
                try {
                    const timeRows = await tools.db.chat.query(
                        `SELECT turn_number, SUM(fact_value) as turn_minutes
                         FROM facts
                         WHERE project_name = ? AND predicate = 'quantitative_time_change' AND turn_number <= ?
                         GROUP BY turn_number
                         ORDER BY turn_number ASC, id ASC`,
                        [projectName.toLowerCase(), synthTurn]
                    );

                    let runningTotal = 0;
                    const timeAtTurn = {};
                    for (const row of timeRows) {
                        runningTotal += row.turn_minutes;
                        timeAtTurn[row.turn_number] = runningTotal;
                    }

                    const currentTotalMinutes = runningTotal;

                    if (!turnContext.runtime.timelineRouting) {
                        turnContext.runtime.timelineRouting = { pre: {}, post: {} };
                    }

                    let lastKnownTime = 0;
                    for (let i = 1; i <= synthTurn; i++) {
                        if (timeAtTurn[i] !== undefined) {
                            lastKnownTime = timeAtTurn[i];
                        }

                        const diffMinutes = currentTotalMinutes - lastKnownTime;

                        if (diffMinutes > 0) {
                            const days = Math.floor(diffMinutes / 1440);
                            const hours = Math.floor((diffMinutes % 1440) / 60);
                            const mins = diffMinutes % 60;

                            let timeString = "";
                            if (days > 0) {
                                timeString = `${days} day${days !== 1 ? 's' : ''}`;
                            } else if (hours > 0) {
                                timeString = `${hours} hour${hours !== 1 ? 's' : ''}`;
                            } else {
                                timeString = `${mins} minute${mins !== 1 ? 's' : ''}`;
                            }

                            turnContext.runtime.timelineRouting.pre[i] = `${timeString} ago`;
                        } else {
                            turnContext.runtime.timelineRouting.pre[i] = `Moments ago`;
                        }
                    }
                } catch (timeErr) {
                    tools.logger.error('TimeRouting', `Failed to inject timeline elapsed time: ${timeErr.message}`);
                }
                // --- END TIMELINE ROUTING INJECTION ---

                tools.logger.log('Synthesis', 'World state synthesis complete.', 'end');
            }
        },

        'HOOK_VN_PIPELINE_TASKS': {
            priority: 51,
            mode: 'parallel',
            run: async (_turnContext, _tools) => ({
                key: 'worldStateTimeline',
                blocking: true,
                after: ['finalBackground'],
                fn: async () => {
                    _tools.logger.log('VNPipeline', 'World State Tracker timeline task starting...', 'start');
                    try {
                        const hasLocationTracker = _tools.plugins.isInstalled('world_location_tracker');
                        await logic.extractAndStoreWorldState(_turnContext, _tools, { skipLocation: hasLocationTracker });
                        _tools.logger.log('VNPipeline', 'World State Tracker timeline task complete.', 'end');
                    } catch (error) {
                        _tools.logger.error('VNPipeline', `World State Tracker timeline task failed: ${error.message}`);
                        _tools.logger.log('VNPipeline', `Failed: ${error.message}`, 'end');
                    }
                }
            })
        }
    },
    socketListeners: {
        'vn-hud-fetch-data': async (data, tools) => {
            // HUD specifically requested data, so we provide ours
            let turnNumber = data?.turnNumber;
            const dialogueIndex = Number.isFinite(Number(data?.dialogueIndex))
                ? Math.max(0, Math.round(Number(data.dialogueIndex)))
                : null;
            const turnContext = tools.turnContext;
            let requestContext = turnContext;

            // If no turnNumber is provided, we try to find the latest turn from DB
            if (turnNumber === undefined || turnNumber === null) {
                try {
                    const latestTurn = await tools.turns.getLatest({ fallbackToCurrent: true });
                    turnNumber = latestTurn?.turnNumber || turnContext.turnNumber || 1;
                } catch {
                    turnNumber = turnContext.turnNumber || 1;
                }
            }
            if (turnNumber !== undefined && turnNumber !== null && Number(turnNumber) !== Number(turnContext.turnNumber)) {
                try {
                    const historicalTurn = await tools.turns.get(turnNumber);
                    if (historicalTurn?.context) {
                        requestContext = historicalTurn.context;
                    }
                } catch { }
            }

            const cssPath = require('path').join(__dirname, 'ui.css');
            const fs = require('fs/promises');
            let pluginStyles = '';
            try {
                pluginStyles = await fs.readFile(cssPath, 'utf8');
            } catch { }

            const injected = await module.exports.exports.getInjectedData(requestContext, tools, {
                turnNumber,
                dialogueIndex,
                context: requestContext
            });
            if (injected) {
                // Wrap HTML with styles to ensure plugin-specific styles are applied in the HUD
                const wrap = (item) => ({ ...item, html: `<style>${pluginStyles}</style>${item.html}` });
                tools.socket.emit('vn-hud-update-section', wrap(injected.clock));
                tools.socket.emit('vn-hud-update-section', wrap(injected.environment));
                tools.socket.emit('vn-hud-update-section', {
                    id: 'world_status',
                    pluginId: 'world_state_tracker',
                    title: 'World Status',
                    dock: 'left',
                    available: false,
                    html: ''
                });
                tools.socket.emit('vn-hud-update-section', wrap(injected.inventory));
            }
        },
        'world-state-tracker-request-full-inventory': async (data, tools) => {
            const turnContext = tools.turnContext;
            const projectName = turnContext.projectName;
            let turnNumber = data?.turnNumber;

            // If no turnNumber is provided, we try to find the latest turn from DB
            if (turnNumber === undefined || turnNumber === null) {
                try {
                    const latestTurn = await tools.turns.getLatest({ fallbackToCurrent: true });
                    turnNumber = latestTurn?.turnNumber || turnContext.turnNumber || 1;
                } catch {
                    turnNumber = turnContext.turnNumber || 1;
                }
            }

            tools.logger.log('Modal', `Generating full inventory map for turn: ${turnNumber}`);

            // 1. Get full inventory with totals > 0
            const inventory = await tools.db.chat.query(
                `SELECT target AS item, SUM(fact_value) AS quantity
                 FROM facts
                 WHERE project_name = ? AND predicate = 'inventory' AND turn_number <= ?
                 GROUP BY target
                 HAVING SUM(fact_value) > 0
                 ORDER BY id ASC;`,
                [projectName.toLowerCase(), turnNumber]
            );

            // 2. Fetch Metadata for each item (Icon, Description, and ALL contexts/origins)
            for (const inv of inventory) {
                const iconRes = await tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? AND target = ? AND predicate = 'inventory_icon' AND turn_number <= ? 
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName.toLowerCase(), inv.item, turnNumber]
                );
                inv.icon = iconRes[0]?.fact_value || '📦';

                const descRes = await tools.db.chat.query(
                    `SELECT fact_value FROM facts 
                     WHERE project_name = ? AND target = ? AND predicate = 'inventory_description' AND turn_number <= ? 
                     ORDER BY turn_number DESC, id DESC LIMIT 1`,
                    [projectName.toLowerCase(), inv.item, turnNumber]
                );
                inv.description = descRes[0]?.fact_value || '';

                // Get all contexts where quantity change was positive (acquisitions)
                const contexts = await tools.db.chat.query(
                    `SELECT context, turn_number FROM facts 
                     WHERE project_name = ? AND target = ? AND predicate = 'inventory' AND fact_value > 0 AND turn_number <= ?
                     ORDER BY turn_number DESC, id DESC`,
                    [projectName.toLowerCase(), inv.item, turnNumber]
                );
                inv.origins = contexts.filter(c => c.context).map(c => `Turn ${c.turn_number}: ${c.context}`);
                inv.lastAcquiredTurn = contexts.length > 0 ? contexts[0].turn_number : null;
            }

            // 3. Generate Modal HTML
            const escapeModalText = value => String(value ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const escapeModalAttr = value => escapeModalText(value).replace(/`/g, '&#96;');
            const scripts = `
                (function() {
                    const input = document.querySelector('.vn-search-input');
                    const cards = document.querySelectorAll('.inventory-card');
                    if (input) {
                        input.addEventListener('input', (e) => {
                            const term = e.target.value.toLowerCase();
                            cards.forEach(card => {
                                const content = card.getAttribute('data-search').toLowerCase();
                                card.style.display = content.includes(term) ? 'flex' : 'none';
                            });
                        });
                    }
                    const parsePayload = button => {
                        try { return JSON.parse(button.closest('.inventory-card')?.dataset.inventory || '{}'); }
                        catch { return {}; }
                    };
                    const normalizeKey = value => String(value || '').trim().toLowerCase();
                    const getPendingUseKeys = () => new Set((window.WorldStateInventoryHud?.getPendingUseItems?.() || [])
                        .map(item => normalizeKey(item.item)));
                    const getPendingDeleteKeys = () => new Set((window.WorldStateInventoryHud?.getPendingDeleteItems?.() || [])
                        .map(item => normalizeKey(item.item)));
                    const syncSelectedInventoryCards = () => {
                        const pendingUse = getPendingUseKeys();
                        const pendingDelete = getPendingDeleteKeys();
                        document.querySelectorAll('.inventory-card').forEach(card => {
                            let payload = {};
                            try { payload = JSON.parse(card.dataset.inventory || '{}'); } catch { payload = {}; }
                            const itemKey = normalizeKey(payload.item);
                            const selectedUse = pendingUse.has(itemKey);
                            const selectedDelete = pendingDelete.has(itemKey);
                            card.classList.toggle('is-selected-for-use', selectedUse);
                            card.classList.toggle('is-selected-for-delete', selectedDelete);
                            card.setAttribute('aria-selected', selectedUse || selectedDelete ? 'true' : 'false');
                            const useButton = card.querySelector('.inventory-card-use');
                            if (useButton) {
                                useButton.textContent = selectedUse ? 'Selected - click to unselect' : 'Use';
                                useButton.setAttribute('aria-pressed', selectedUse ? 'true' : 'false');
                                useButton.title = selectedUse
                                    ? 'Selected for the next Send. Click again to unselect.'
                                    : 'Add this item to the next player action.';
                            }
                            const deleteButton = card.querySelector('.inventory-card-delete');
                            if (deleteButton) {
                                deleteButton.textContent = selectedDelete ? 'Marked - click to unselect' : 'Delete';
                                deleteButton.setAttribute('aria-pressed', selectedDelete ? 'true' : 'false');
                                deleteButton.title = selectedDelete
                                    ? 'Marked for disposal on the next Send. Click again to unselect.'
                                    : 'Mark this item to be discarded on the next Send.';
                            }
                        });
                    };
                    document.querySelectorAll('.inventory-card-use').forEach(button => {
                        button.addEventListener('click', () => {
                            const payload = parsePayload(button);
                            if (!payload.item) return;
                            window.WorldStateInventoryHud?.toggleUseItem?.(payload);
                            window.FablekinVNHud?.removePinnedNotice?.('world_state_tracker.inventory_delete_feedback');
                            syncSelectedInventoryCards();
                        });
                    });
                    window.addEventListener('world-state-tracker:inventory-use-updated', syncSelectedInventoryCards);
                    syncSelectedInventoryCards();
                    document.querySelectorAll('.inventory-card-delete').forEach(button => {
                        button.addEventListener('click', () => {
                            const payload = parsePayload(button);
                            if (!payload.item) return;
                            window.WorldStateInventoryHud?.toggleDeleteItem?.(payload);
                            window.FablekinVNHud?.removePinnedNotice?.('world_state_tracker.inventory_delete_feedback');
                            syncSelectedInventoryCards();
                        });
                    });
                })();
            `;

            const totalQuantity = inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const originCount = inventory.reduce((sum, item) => sum + (Array.isArray(item.origins) ? item.origins.length : 0), 0);
            const recentlyAcquired = inventory.filter(item => item.lastAcquiredTurn).length;
            const modalHtml = `
                <div class="inventory-registry-shell">
                    <section class="inventory-registry-hero">
                        <div class="inventory-registry-badge" aria-hidden="true">⌘</div>
                        <div class="inventory-registry-copy">
                            <div class="inventory-registry-kicker">Travel Pack</div>
                            <h2>Party Inventory</h2>
                            <div class="inventory-registry-next">Turn ${turnNumber} · ${inventory.length} unique item${inventory.length === 1 ? '' : 's'}</div>
                        </div>
                        <div class="inventory-registry-score">
                            <strong>${totalQuantity}</strong>
                            <span>Total Qty</span>
                        </div>
                    </section>
                    <section class="inventory-registry-stats" aria-label="Inventory statistics">
                        <span><strong>${inventory.length}</strong>Unique</span>
                        <span><strong>${totalQuantity}</strong>Quantity</span>
                        <span><strong>${recentlyAcquired}</strong>Tracked</span>
                        <span><strong>${originCount}</strong>Origins</span>
                    </section>
                    <div class="vn-hud-modal-search">
                        <input type="text" class="vn-search-input" placeholder="Search items or descriptions...">
                    </div>
                    <div class="inventory-modal-grid">
                    ${inventory.map(item => `
                        <div class="inventory-card" data-search="${escapeModalAttr(`${item.item} ${item.description || ''}`)}" data-inventory="${escapeModalAttr(JSON.stringify({ item: item.item, quantity: Number(item.quantity || 0), turnNumber }))}">
                            <div class="inventory-card-header">
                                <span class="inventory-card-title">${escapeModalText(item.icon)} ${escapeModalText(item.item)}</span>
                                <span class="inventory-card-qty">x${escapeModalText(item.quantity)}</span>
                            </div>
                            ${item.lastAcquiredTurn ? `<div class="inventory-card-last-added">Last Acquired: Turn ${escapeModalText(item.lastAcquiredTurn)}</div>` : ''}
                            <div class="inventory-card-desc">${escapeModalText(item.description || 'No description available.')}</div>
                            <div class="inventory-card-actions">
                                <button type="button" class="inventory-card-action inventory-card-use">Use</button>
                                <button type="button" class="inventory-card-action inventory-card-delete">Delete</button>
                            </div>
                            ${item.origins.length > 0 ? `
                                <div class="inventory-card-origins">
                                    <div class="inventory-card-origins-title">Origins</div>
                                    ${item.origins.map(origin => `<div class="inventory-origin-item">${escapeModalText(origin)}</div>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                    </div>
                </div>
                <script>${scripts}</script>
            `;

            tools.socket.emit('vn-hud-show-modal', {
                title: `Party Inventory (${inventory.length} Unique Items)`,
                html: modalHtml,
                scope: 'canvas',
                modalClass: 'inventory-registry-modal'
            });
        },
        'world-state-tracker-delete-inventory-item': async (data, tools) => {
            const requestId = data?.requestId;
            const turnContext = tools.turnContext;
            const projectName = String(turnContext.projectName || '').toLowerCase();
            const item = String(data?.item || '').trim();
            const turnNumber = Math.max(1, Math.round(Number(data?.turnNumber || turnContext.turnNumber || 1)));

            const respond = payload => tools.socket.emit('world-state-tracker-delete-inventory-item-response', {
                requestId,
                ...payload
            });

            try {
                if (!projectName || !item) throw new Error('Missing inventory item.');
                const quantityRows = await tools.db.chat.query(
                    `SELECT SUM(fact_value) AS quantity
                     FROM facts
                     WHERE project_name = ? AND predicate = 'inventory' AND target = ? AND turn_number <= ?`,
                    [projectName, item, turnNumber]
                );
                const quantity = Math.max(0, Math.round(Number(quantityRows?.[0]?.quantity || 0)));
                if (quantity <= 0) throw new Error(`${item} is not currently in the party inventory.`);

                await tools.facts.appendToFactsDb({
                    source: 'world_state_tracker',
                    target: item,
                    predicate: 'inventory',
                    fact_value: -quantity,
                    context: 'manual_inventory_delete'
                }, { turn_number: turnNumber });

                tools.socket.emit('vn-hud-force-refresh');
                respond({ success: true, item, quantity, turnNumber });
            } catch (error) {
                respond({ success: false, error: error.message });
            }
        }
    }
};
