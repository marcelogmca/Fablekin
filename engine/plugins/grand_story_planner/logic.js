const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const coreFolders = require('../../modules/config/core_folders.js');

/**
 * Logic for the Grand Story Planner Plugin
 */

const PLAN_CATEGORY_DEFINITIONS = [
    ['THEME', '1. THE CORE & THEME'],
    ['ARC', '2. SEASON ROADMAP'],
    ['LOCAL', '3. LOCAL OBJECTIVES'],
    ['BOND', '4. BONDS & GROUP DYNAMICS'],
    ['RESPITE', '5. RESPITE, WONDER & MUNDANE PLEASURE'],
    ['MYST', '6. MYSTERIES & EXPOSURE BUDGETS'],
    ['WORLD', '7. LIVING WORLD MOTION'],
    ['SHIFT', '8. STATUS QUO SHIFTS'],
    ['FOCUS', '9. SPOTLIGHT & ANTI-OVEREXPOSURE GUARDRAILS'],
    ['FACT', '10. LEGACY SHADOW BOARD'],
    ['WEB', '11. LEGACY WEB OF INTRIGUE'],
    ['OTHER', '12. ADDITIONAL DIRECTIVES']
];

const PLANNER_PROMPT_CACHE_VERSION = 'showrunner-v5-2026-05-05';

/**
 * Generates a hash representing the current state of static lore.
 */
async function generateLoreHash(rootDirectory) {
    const folders = [coreFolders.FOLDERS.LORE_BOOK, coreFolders.FOLDERS.CHRONICLES];
    let combinedMetadata = `planner_prompt_version:${PLANNER_PROMPT_CACHE_VERSION}:`;

    const listFilesRecursive = async (dir, depth = 0) => {
        let results = [];
        if (depth > 1) return results;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(rootDirectory, fullPath);
                const currentDepth = relativePath.split(path.sep).length;

                if (entry.isDirectory()) {
                    if (currentDepth < 2) {
                        results = results.concat(await listFilesRecursive(fullPath, depth + 1));
                    }
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    if (currentDepth <= 2) {
                        const stats = await fs.stat(fullPath);
                        results.push(`${entry.name}:${stats.mtimeMs}:`);
                    }
                }
            }
        } catch { }
        return results;
    };

    for (const folder of folders) {
        const folderPath = path.join(rootDirectory, folder);
        const files = await listFilesRecursive(folderPath);
        files.sort().forEach(meta => combinedMetadata += meta);
    }

    return crypto.createHash('sha256').update(combinedMetadata).digest('hex');
}

/**
 * Gathers treated source material from the turnContext.
 * Uses the already summarized/filtered content from prompt_builder.js.
 */
function gatherSourceMaterial(turnContext) {
    const pc = turnContext.promptComponents.root;
    let sourceMaterial = '';

    if (pc.canon && pc.canon.length > 0) {
        sourceMaterial += `\n### CANON & REFERENCE (Processed)\n${pc.canon.join('\n\n')}\n`;
    }

    if (pc.dynamic_knowledge && pc.dynamic_knowledge.length > 0) {
        sourceMaterial += `\n### DYNAMIC KNOWLEDGE (Processed)\n${pc.dynamic_knowledge.join('\n\n')}\n`;
    }

    if (pc.simulation && pc.simulation.length > 0) {
        sourceMaterial += `\n### SIMULATION STATE (Processed)\n${pc.simulation.join('\n\n')}\n`;
    }

    return sourceMaterial.trim();
}

/**
 * Gathers user-defined inputs specifically for the Grand Story Planner.
 */
async function gatherPlannerInputs(tools) {
    try {
        const turnContext = tools.turnContext;
        const root = turnContext.rootDirectory;
        const folders = [coreFolders.FOLDERS.LORE_BOOK]; // Root and standard developer-facing folders

        let combinedInput = '';
        const handledFiles = new Set();

        // 1. Check selected files FIRST (consistency with other plugins)
        const selectedFiles = turnContext?.input?.selectedFiles || [];
        for (const file of selectedFiles) {
            if (file.mode === 'planner_input') {
                const content = await tools.project.readFile(file.path);
                combinedInput += `\n\n### FROM SELECTED FILE: ${path.basename(file.path)}\n${content}`;
                handledFiles.add(path.normalize(file.path));
            }
        }

        // 2. Scan standard folders for files marked as 'planner_input'
        for (const folder of folders) {
            const dirPath = folder === '.' ? root : path.join(root, folder);
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const fullPath = path.join(dirPath, entry.name);
                        const normalizedPath = path.normalize(fullPath);
                        if (handledFiles.has(normalizedPath)) continue;

                        const config = await tools.project.getFileConfig(fullPath);
                        if (config && config.mode === 'planner_input') {
                            const content = await tools.project.readFile(fullPath);
                            combinedInput += `\n\n### FROM PROJECT FILE: ${entry.name}\n${content}`;
                            handledFiles.add(normalizedPath);
                        }
                    }
                }
            } catch {
                // Folder might not exist, skip silently
            }
        }

        if (combinedInput) {
            tools.logger.log('Logic', `Gathered planner inputs from ${handledFiles.size} files.`);
        } else {
            tools.logger.runtime(`[GrandStoryPlanner] No files found with mode 'planner_input' in root or standard folders.`);
        }

        return combinedInput.trim();
    } catch (error) {
        tools.logger.error('Logic', 'Error gathering planner inputs:', error);
        return '';
    }
}

function buildArchitectGuidanceFromPatterns(payload) {
    const patterns = Array.isArray(payload?.patterns) ? payload.patterns : [];
    if (patterns.length === 0) return '';

    const lines = [
        '<architect_structural_guidance>',
        '[INSPIRATION ONLY - DO NOT COPY PLOTS, NAMES, LORE, OR SCENES]',
        'Use these as structural craft references for pacing, escalation, release, and beat timing.',
        `Selection mode: ${payload.selectionMode || 'unknown'}.`
    ];

    if (Array.isArray(payload.requestedTags) && payload.requestedTags.length > 0) {
        lines.push(`Requested tags: ${payload.requestedTags.join(', ')}`);
    }
    if (Array.isArray(payload.requestedSeries) && payload.requestedSeries.length > 0) {
        lines.push(`Requested series: ${payload.requestedSeries.join(', ')}`);
    }

    patterns.forEach((pattern, index) => {
        const patternTags = Array.isArray(pattern.tags)
            ? pattern.tags
            : (Array.isArray(pattern.matchedTags) ? pattern.matchedTags : []);
        const lessons = Array.isArray(pattern.lessons) ? pattern.lessons : [];

        lines.push('');
        lines.push(`Pattern ${index + 1}:`);
        lines.push(`- Source: ${pattern.source || 'Unknown'}`);
        lines.push(`- Series: ${pattern.series || 'Unknown'}`);
        if (Number.isFinite(pattern.score)) lines.push(`- Match score: ${pattern.score.toFixed(2)}`);
        if (patternTags.length > 0) lines.push(`- Matched tags: ${patternTags.join(', ')}`);
        lines.push('- Lessons:');
        if (lessons.length === 0) {
            lines.push('  - Use only the broad rhythm of this reference, then adapt it to the current cast, place, and player direction.');
        } else {
            lessons.forEach(lesson => lines.push(`  - ${truncateStructuredText(lesson, 260)}`));
        }
    });

    lines.push('</architect_structural_guidance>');
    return lines.join('\n');
}

async function gatherArchitectGuidance(turnContext, tools, settings, options = {}) {
    if (!settings?.architect_integration) return '';

    const limit = Math.max(
        1,
        Math.min(8, parseInt(settings.architect_reference_limit || 4, 10) || 4)
    );

    try {
        const structuralPayload = await tools.plugins.tryCall(
            'narrative_architect',
            'getStructuralPatterns',
            [turnContext, tools, {
                mode: 'planner',
                limit,
                forceReselect: options.forceReselect === true,
                tags: Array.isArray(options.tags) ? options.tags : [],
                series: Array.isArray(options.series) ? options.series : []
            }],
            { fallback: null, silent: true }
        );

        const structuredGuidance = structuralPayload ? buildArchitectGuidanceFromPatterns(structuralPayload) : '';
        if (structuredGuidance) {
            tools.logger.log('Logic', `Received ${limit} structured reference slot(s) from Narrative Architect for planner guidance.`);
            return structuredGuidance;
        }
    } catch (error) {
        tools.logger.warn('Logic', 'Structured Narrative Architect guidance failed; falling back to legacy guidance.', error);
    }

    return '';
}

function sanitizeStringList(value, options = {}) {
    const maxItems = options.maxItems || 8;
    const maxChars = options.maxChars || 64;
    const toLower = options.toLower === true;

    if (!Array.isArray(value)) return [];

    const out = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;

        let normalized = normalizePromptText(entry).replace(/[^\w\s\-]/g, '');
        if (!normalized) continue;
        if (toLower) normalized = normalized.toLowerCase();
        if (normalized.length > maxChars) {
            normalized = normalized.slice(0, maxChars).trim();
        }
        if (!normalized) continue;
        if (!out.includes(normalized)) out.push(normalized);
        if (out.length >= maxItems) break;
    }

    return out;
}

function buildStoryNeedsSignalBlock(storyNeeds) {
    if (!storyNeeds) return 'No story-needs signal available.';

    const lines = [
        '<story_needs_signal>',
        `mode=${storyNeeds.mode || 'unknown'}`
    ];

    const neededTags = Array.isArray(storyNeeds.neededTags) ? storyNeeds.neededTags : [];
    const seriesPreferences = Array.isArray(storyNeeds.seriesPreferences) ? storyNeeds.seriesPreferences : [];
    const missingFlavors = Array.isArray(storyNeeds.missingFlavors) ? storyNeeds.missingFlavors : [];
    const overusedFlavors = Array.isArray(storyNeeds.overusedFlavors) ? storyNeeds.overusedFlavors : [];
    const desiredStructures = Array.isArray(storyNeeds.desiredStructures) ? storyNeeds.desiredStructures : [];
    const plannerWarning = normalizePromptText(storyNeeds.plannerWarning || '');

    if (neededTags.length > 0) lines.push(`needed_tags=${neededTags.join(', ')}`);
    if (seriesPreferences.length > 0) lines.push(`series_preferences=${seriesPreferences.join(', ')}`);
    if (missingFlavors.length > 0) lines.push(`missing_flavors=${missingFlavors.join(', ')}`);
    if (overusedFlavors.length > 0) lines.push(`overused_flavors=${overusedFlavors.join(', ')}`);
    if (desiredStructures.length > 0) lines.push(`desired_structures=${desiredStructures.join(', ')}`);
    if (plannerWarning) lines.push(`planner_warning=${plannerWarning}`);
    lines.push('</story_needs_signal>');

    return lines.join('\n');
}

async function classifyStoryNeeds(turnContext, tools, settings, inputs = {}) {
    const defaultResult = {
        mode: 'single_call',
        usedClassifier: false,
        neededTags: [],
        seriesPreferences: [],
        missingFlavors: [],
        overusedFlavors: [],
        desiredStructures: [],
        plannerWarning: '',
        signalText: '<story_needs_signal>\nmode=single_call\nclassifier=disabled\n</story_needs_signal>'
    };

    if ((settings.planner_strategy_mode || 'single_call') !== 'two_call_classifier') {
        return defaultResult;
    }

    const currentTurn = turnContext?.turnNumber || 0;
    const classifierModel = settings.classifier_model_def || { model: 'mediumendmodel' };
    const classifierRetries = Number.isFinite(settings.classifier_retries) ? settings.classifier_retries : 1;
    const classifierTimeout = Number.isFinite(settings.classifier_timeout) ? settings.classifier_timeout : 90000;

    try {
        const template = await fs.readFile(path.join(__dirname, 'prompt_story_needs_classifier.txt'), 'utf-8');
        const prompt = template
            .replace(/{{current_turn_number}}/g, String(currentTurn))
            .replace('{{current_plan}}', truncatePromptText(inputs.currentPlan || 'No active plan.', 7000))
            .replace('{{planner_context_capsule}}', truncatePromptText(inputs.plannerContextCapsule || 'No planner context capsule available.', 9000))
            .replace('{{pacing_strategy}}', truncatePromptText(inputs.pacingStrategy || 'No pacing strategy available.', 1800))
            .replace('{{planner_inputs}}', truncatePromptText(inputs.plannerInputs || 'No planner inputs available.', 1800));

        const messages = [{ role: 'user', content: prompt }];

        const response = await tools.llm.withSchema({
            msg: 'Grand Story Planner Classifier',
            messages,
            model: classifierModel.model,
            provider: classifierModel.provider,
            params: {
                retries: classifierRetries,
                timeout: classifierTimeout,
                callingModule: 'Plugin:grand_story_planner:classifier'
            }
        }, {
            type: 'object',
            required: ['needed_tags', 'series_preferences', 'missing_flavors', 'overused_flavors', 'desired_structures'],
            properties: {
                needed_tags: { type: 'array' },
                series_preferences: { type: 'array' },
                missing_flavors: { type: 'array' },
                overused_flavors: { type: 'array' },
                desired_structures: { type: 'array' },
                planner_warning: { type: 'string' }
            }
        });

        const parsed = response.content || {};

        const neededTags = sanitizeStringList(parsed.needed_tags, { maxItems: 12, maxChars: 50, toLower: true })
            .map(tag => tag.replace(/\s+/g, '_'));
        const seriesPreferences = sanitizeStringList(parsed.series_preferences, { maxItems: 4, maxChars: 64 });
        const missingFlavors = sanitizeStringList(parsed.missing_flavors, { maxItems: 6, maxChars: 48, toLower: true });
        const overusedFlavors = sanitizeStringList(parsed.overused_flavors, { maxItems: 6, maxChars: 48, toLower: true });
        const desiredStructures = sanitizeStringList(parsed.desired_structures, { maxItems: 6, maxChars: 80 });
        const plannerWarning = truncatePromptText(parsed.planner_warning || '', 220);

        const result = {
            mode: 'two_call_classifier',
            usedClassifier: true,
            neededTags,
            seriesPreferences,
            missingFlavors,
            overusedFlavors,
            desiredStructures,
            plannerWarning
        };

        result.signalText = buildStoryNeedsSignalBlock(result);
        return result;
    } catch (error) {
        tools.logger.warn('Classifier', `Story-needs classifier failed: ${error.message}`);
        return {
            ...defaultResult,
            mode: 'two_call_classifier',
            signalText: `<story_needs_signal>\nmode=two_call_classifier\nclassifier=error\nmessage=${truncatePromptText(error.message, 140)}\n</story_needs_signal>`
        };
    }
}

function normalizePromptText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncatePromptText(value, maxChars = 1200) {
    return normalizePromptText(value);
}

function truncateStructuredText(value, maxChars = 1200) {
    return String(value || '').trim();
}

function extractTagBlocksFromSimulation(turnContext, tagName, options = {}) {
    const maxBlocks = options.maxBlocks || 3;
    const maxCharsPerBlock = options.maxCharsPerBlock || 800;
    const simulationSegments = turnContext?.promptComponents?.root?.simulation;
    if (!Array.isArray(simulationSegments) || simulationSegments.length === 0) return [];

    const simulationText = simulationSegments.join('\n');
    const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'gi');
    const results = [];
    let match;

    while ((match = regex.exec(simulationText)) !== null && results.length < maxBlocks) {
        const content = truncatePromptText(match[1], maxCharsPerBlock);
        if (content) results.push(content);
    }

    return results;
}

function computeStoryDietSignals(recentEntries) {
    const categories = [
        { key: 'action', keywords: ['fight', 'battle', 'attack', 'combat', 'blood', 'wound', 'weapon'] },
        { key: 'mystery', keywords: ['mystery', 'secret', 'artifact', 'clue', 'hidden', 'unknown', 'prophecy'] },
        { key: 'respite', keywords: ['meal', 'rest', 'sleep', 'market', 'festival', 'tea', 'quiet', 'laugh', 'joke'] },
        { key: 'relationship', keywords: ['trust', 'bond', 'care', 'confess', 'apology', 'argument', 'comfort'] },
        { key: 'travel', keywords: ['road', 'travel', 'journey', 'caravan', 'camp', 'route', 'crossing'] },
        { key: 'world_pressure', keywords: ['faction', 'rumor', 'price', 'law', 'storm', 'deadline', 'politic', 'reputation'] }
    ];

    const scores = Object.fromEntries(categories.map(c => [c.key, 0]));
    for (const entry of recentEntries) {
        const text = String(entry?.text || '').toLowerCase();
        for (const category of categories) {
            if (category.keywords.some(keyword => text.includes(keyword))) {
                scores[category.key] += 1;
            }
        }
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const dominant = ranked.filter(([, score]) => score > 0).slice(0, 3).map(([key]) => key);
    const missing = ranked.filter(([, score]) => score === 0).map(([key]) => key);

    return {
        dominant: dominant.length > 0 ? dominant : ['none_detected'],
        missing: missing.length > 0 ? missing : ['none']
    };
}

async function collectRecentChapterEntries(turnContext, settings) {
    const depth = Math.max(3, Math.min(20, parseInt(settings?.planner_context_depth || 8, 10) || 8));
    const perTurnChars = Math.max(240, Math.min(1400, parseInt(settings?.planner_context_turn_chars || 520, 10) || 520));

    try {
        const history = await turnContext.retrieveDatedChapters();
        const allChapters = [
            ...(history.synopsischapters || []),
            ...(history.summarychapters || []),
            ...(history.fullchapters || [])
        ].sort((a, b) => (a.turnNumber || 0) - (b.turnNumber || 0));

        const recent = allChapters.slice(-depth);
        const entries = [];

        for (const chapter of recent) {
            if (chapter?.isSkeleton && typeof chapter.ensureFull === 'function') {
                await chapter.ensureFull();
            }

            const text = chapter?.output?.summary
                || chapter?.output?.synopsis
                || chapter?.output?.fulltext
                || '';
            const truncated = truncatePromptText(text, perTurnChars);
            if (!truncated) continue;

            entries.push({
                turn: chapter.turnNumber,
                text: truncated
            });
        }

        return entries;
    } catch {
        return [];
    }
}

function buildPlanCategorySnapshot(currentPlanText) {
    if (!currentPlanText || currentPlanText === 'Empty.') return 'No active ledger entries.';

    const counts = {};
    const lineRegex = /^\[([A-Z]+)-?\d*\]\s*\|/i;

    for (const rawLine of String(currentPlanText).split('\n')) {
        const line = rawLine.trim();
        const match = line.match(lineRegex);
        if (!match) continue;
        const category = match[1].toUpperCase();
        counts[category] = (counts[category] || 0) + 1;
    }

    const parts = Object.entries(counts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, count]) => `${category}:${count}`);

    return parts.length > 0 ? parts.join(' | ') : 'No active ledger entries.';
}

function formatPlanEntryCompact(entry, maxChars = 260) {
    return `- [${entry.id}] (Span: ${entry.span || 'Unspecified'}) ${truncateStructuredText(entry.content || '', maxChars)}`;
}

function buildPlanEntrySection(entries, fallback, maxItems = 5) {
    if (!Array.isArray(entries) || entries.length === 0) return [fallback];
    return entries.slice(0, maxItems).map(entry => formatPlanEntryCompact(entry));
}

function selectPlanEntriesForCapsule(currentPlanText, currentTurn) {
    const entries = parsePlanEntriesFromLedgerText(currentPlanText);
    if (entries.length === 0) {
        return {
            activeFocus: [],
            localGoals: [],
            mysteries: []
        };
    }

    const scored = entries
        .map(entry => scorePlanEntryForDirector(entry, currentTurn))
        .sort((a, b) => b.score - a.score);

    const usefulTurnStates = new Set(['active', 'upcoming', 'overdue_near', 'floating']);
    const activeFocus = scored.filter(entry => usefulTurnStates.has(entry.turnState));
    const localGoals = scored.filter(entry => entry.category === 'LOCAL' && usefulTurnStates.has(entry.turnState));
    const mysteries = scored.filter(entry => ['MYST', 'WEB', 'FACT'].includes(entry.category) && usefulTurnStates.has(entry.turnState));

    return {
        activeFocus: activeFocus.length > 0 ? activeFocus : scored.slice(0, 5),
        localGoals,
        mysteries
    };
}

async function collectRecentPlannerChanges(turnContext, tools, limit = 6) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) return [];

    try {
        const rows = await tools.db.chat.query(
            `SELECT target, fact_value, turn_number, context
             FROM facts
             WHERE project_name = ?
               AND source = ?
               AND predicate = 'LEDGER_ENTRY'
               AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC
             LIMIT ?`,
            [
                projectName.toLowerCase(),
                'grand_story_planner',
                turnContext?.turnNumber || 999999,
                Math.max(1, Math.min(20, parseInt(limit, 10) || 6))
            ]
        );

        return (rows || []).reverse().map(row => {
            const id = String(row.target || 'unknown').toUpperCase();
            const operation = row.context === 'DELETED' ? 'DELETE' : 'UPSERT';
            const value = operation === 'DELETE'
                ? 'Deleted from active plan.'
                : truncateStructuredText(String(row.fact_value || '').replace(/^\|?\s*/, ''), 260);
            return `- Turn ${row.turn_number}: ${operation} [${id}] ${value}`;
        });
    } catch {
        return [];
    }
}

async function buildPlannerContextCapsule(turnContext, tools, settings, currentPlanText) {
    const maxCapsuleChars = Math.max(1200, Math.min(20000, parseInt(settings?.planner_context_max_chars || 7000, 10) || 7000));
    const recentEntries = await collectRecentChapterEntries(turnContext, settings);
    const storyDiet = computeStoryDietSignals(recentEntries);
    const compressedDeepHistory = truncatePromptText(
        turnContext?.runtime?.historyData?.compressedHistory?.deep || '',
        Math.max(1200, Math.floor(maxCapsuleChars * 0.45))
    );
    const currentTurn = turnContext?.turnNumber || 0;
    const playerDirection = truncatePromptText(turnContext?.input?.userPrompt || '', 700) || 'No direct player direction available.';
    const planFocus = selectPlanEntriesForCapsule(currentPlanText, currentTurn);
    const recentPlannerChanges = await collectRecentPlannerChanges(turnContext, tools, 6);

    const worldStateText = truncatePromptText(
        turnContext?.processed?.previousWorldState?.synthesizedText || '',
        1200
    ) || 'No specific world state established.';

    const relationshipBlocks = extractTagBlocksFromSimulation(turnContext, 'active_relationships', {
        maxBlocks: 1,
        maxCharsPerBlock: 1100
    });

    const personalityBlocks = extractTagBlocksFromSimulation(turnContext, 'personality_snapshot', {
        maxBlocks: 4,
        maxCharsPerBlock: 400
    });

    const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
    const lines = [
        '<planner_context_capsule>',
        `CurrentTurn: ${currentTurn}`,
        `PartyInScene: ${party.length > 0 ? party.join(', ') : 'Unknown / not established'}`,
        `StoryDietDominant: ${storyDiet.dominant.join(', ')}`,
        `StoryDietMissing: ${storyDiet.missing.join(', ')}`,
        `PlanCategorySnapshot: ${buildPlanCategorySnapshot(currentPlanText)}`,
        `LatestPlayerDirection: ${playerDirection}`,
        '',
        '[CompressedHistoryDeep]'
    ];

    if (compressedDeepHistory) {
        lines.push(compressedDeepHistory);
    } else if (recentEntries.length === 0) {
        lines.push('- No compressed or recent chapter digest available.');
    } else {
        for (const entry of recentEntries) {
            lines.push(`- Turn ${entry.turn}: ${entry.text}`);
        }
    }

    lines.push('');
    lines.push('[ActiveGrandLedgerFocus]');
    lines.push(...buildPlanEntrySection(planFocus.activeFocus, '- No active grand ledger focus is available.', 6));
    lines.push('');
    lines.push('[UnresolvedLocalGoals]');
    lines.push(...buildPlanEntrySection(planFocus.localGoals, '- No unresolved near-term LOCAL goal is visible in the active plan.', 4));
    lines.push('');
    lines.push('[UnresolvedMysteriesAndSpoilerRisks]');
    lines.push(...buildPlanEntrySection(planFocus.mysteries, '- No active mystery/spoiler-risk entry is visible in the active plan.', 4));
    lines.push('');
    lines.push('[RecentPlannerChanges]');
    if (recentPlannerChanges.length === 0) {
        lines.push('- No recent planner ledger changes found.');
    } else {
        lines.push(...recentPlannerChanges);
    }

    lines.push('');
    lines.push('[WorldState]');
    lines.push(worldStateText);
    lines.push('');
    lines.push('[RelationshipState]');
    lines.push(relationshipBlocks.length > 0 ? relationshipBlocks[0] : 'No relationship snapshot available.');
    lines.push('');
    lines.push('[PersonalityState]');

    if (personalityBlocks.length > 0) {
        personalityBlocks.forEach((block, index) => lines.push(`- Snapshot ${index + 1}: ${block}`));
    } else {
        lines.push('No personality snapshot available.');
    }

    lines.push('</planner_context_capsule>');
    return truncatePromptText(lines.join('\n'), maxCapsuleChars);
}

function parsePlanEntriesFromLedgerText(ledgerText) {
    if (!ledgerText || ledgerText === 'Empty.') return [];

    const lines = String(ledgerText).split('\n');
    const regex = /^\[([A-Z]+(?:-\d+)?)\]\s*\|\s*Span:\s*(.*?)\s*\|\s*Content:\s*(.*)/i;
    const fallbackRegex = /^\[([A-Z]+(?:-\d+)?)\]\s*(.*)/i;
    const entries = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let match = trimmed.match(regex);
        let id = '';
        let span = 'Unspecified';
        let content = trimmed;

        if (match) {
            id = match[1].toUpperCase();
            span = match[2].trim();
            content = match[3].trim();
        } else {
            match = trimmed.match(fallbackRegex);
            if (!match) continue;
            id = match[1].toUpperCase();
            content = match[2].trim();
        }

        const category = id.split('-')[0];
        entries.push({ id, category, span, content });
    }

    return entries;
}

function parseSpanTurnWindow(spanText) {
    const span = String(spanText || '').trim();
    if (!span) return { hasExplicitTurns: false, startTurn: null, endTurn: null };

    const normalized = span.toLowerCase();
    const rangeMatch = normalized.match(/\bturns?\s*(\d+)\s*(?:to|-|\u2013)\s*(?:turn\s*)?(\d+)/i);
    if (rangeMatch) {
        const first = parseInt(rangeMatch[1], 10);
        const second = parseInt(rangeMatch[2], 10);
        if (!Number.isNaN(first) && !Number.isNaN(second)) {
            return {
                hasExplicitTurns: true,
                startTurn: Math.min(first, second),
                endTurn: Math.max(first, second)
            };
        }
    }

    const singleMatch = normalized.match(/\bturns?\s*(\d+)\b/i);
    if (singleMatch) {
        const turn = parseInt(singleMatch[1], 10);
        if (!Number.isNaN(turn)) {
            return { hasExplicitTurns: true, startTurn: turn, endTurn: turn };
        }
    }

    return { hasExplicitTurns: false, startTurn: null, endTurn: null };
}

function evaluateTurnState(window, currentTurn) {
    if (!window.hasExplicitTurns || !Number.isFinite(currentTurn)) {
        return { turnState: 'floating', turnDistance: null, turnScore: 8 };
    }

    if (currentTurn >= window.startTurn && currentTurn <= window.endTurn) {
        return { turnState: 'active', turnDistance: 0, turnScore: 38 };
    }

    if (currentTurn < window.startTurn) {
        const distance = window.startTurn - currentTurn;
        if (distance <= 1) return { turnState: 'upcoming', turnDistance: distance, turnScore: 34 };
        if (distance <= 3) return { turnState: 'upcoming', turnDistance: distance, turnScore: 24 };
        if (distance <= 6) return { turnState: 'distant', turnDistance: distance, turnScore: 12 };
        return { turnState: 'distant', turnDistance: distance, turnScore: 2 };
    }

    const distance = currentTurn - window.endTurn;
    if (distance <= 2) return { turnState: 'overdue_near', turnDistance: distance, turnScore: 12 };
    if (distance <= 5) return { turnState: 'overdue', turnDistance: distance, turnScore: 6 };
    return { turnState: 'stale', turnDistance: distance, turnScore: -3 };
}

function scorePlanEntryForDirector(entry, currentTurn) {
    const categoryWeights = {
        LOCAL: 60,
        BOND: 56,
        WORLD: 52,
        SHIFT: 50,
        RESPITE: 44,
        ARC: 42,
        FOCUS: 40,
        OTHER: 34,
        THEME: 32,
        MYST: 30,
        WEB: 28,
        FACT: 26
    };

    const baseScore = categoryWeights[entry.category] || 30;
    const turnWindow = parseSpanTurnWindow(entry.span);
    const turnContext = evaluateTurnState(turnWindow, currentTurn);
    let score = baseScore + turnContext.turnScore;

    const content = String(entry.content || '').toLowerCase();
    if (/\b(deadline|urgent|immediately|before|must|now|tonight)\b/.test(content)) {
        score += 4;
    }
    if (/\b(repeat|again|same)\b/.test(content)) {
        score -= 3;
    }

    return {
        ...entry,
        score,
        turnState: turnContext.turnState,
        turnDistance: turnContext.turnDistance
    };
}

function pickTopDistinctEntries(scoredEntries, filterFn, limit, seenIds = new Set()) {
    const picked = [];
    for (const entry of scoredEntries) {
        if (picked.length >= limit) break;
        if (seenIds.has(entry.id)) continue;
        if (typeof filterFn === 'function' && !filterFn(entry)) continue;
        seenIds.add(entry.id);
        picked.push(entry);
    }
    return picked;
}

function formatBriefEntry(entry, options = {}) {
    const span = entry.span || 'Unspecified';
    return `- [${entry.id}] (Span: ${span}) ${String(entry.content || '').trim()}`;
}

function buildDirectorExecutionBrief(rawPlan, currentTurn, options = {}) {
    const turnNumber = Number.isFinite(currentTurn) ? currentTurn : 0;
    const itemLimit = Math.max(3, Math.min(12, parseInt(options.itemLimit || 6, 10) || 6));

    if (!rawPlan || rawPlan === 'Empty.') {
        return '<grand_story_execution_brief>\nNo active grand story plan is available for this turn.\n</grand_story_execution_brief>';
    }

    const planEntries = parsePlanEntriesFromLedgerText(rawPlan);
    if (planEntries.length === 0) {
        return '<grand_story_execution_brief>\nNo parseable grand story plan entries were found for this turn.\n</grand_story_execution_brief>';
    }

    const scoredEntries = planEntries
        .map(entry => scorePlanEntryForDirector(entry, turnNumber))
        .sort((a, b) => b.score - a.score);

    const spoilerCategories = new Set(['MYST', 'WEB', 'FACT']);
    const worldCategories = new Set(['WORLD', 'SHIFT']);
    const relationshipCategories = new Set(['BOND', 'RESPITE', 'FOCUS']);

    const primarySeen = new Set();
    const primary = pickTopDistinctEntries(
        scoredEntries,
        (entry) => !spoilerCategories.has(entry.category) && ['active', 'upcoming', 'overdue_near', 'floating'].includes(entry.turnState),
        itemLimit,
        primarySeen
    );

    if (primary.length < Math.min(itemLimit, 3)) {
        const topUp = pickTopDistinctEntries(scoredEntries, (entry) => !spoilerCategories.has(entry.category), itemLimit - primary.length, primarySeen);
        primary.push(...topUp);
    }

    const topicalSeen = new Set(primary.map(entry => entry.id));
    const worldMotion = pickTopDistinctEntries(scoredEntries, (entry) => worldCategories.has(entry.category), 2, topicalSeen);
    const relationship = pickTopDistinctEntries(scoredEntries, (entry) => relationshipCategories.has(entry.category), 2, topicalSeen);
    const guardrails = pickTopDistinctEntries(scoredEntries, (entry) => spoilerCategories.has(entry.category), 3, new Set());
    const themeAnchor = scoredEntries.find(entry => entry.category === 'THEME');

    const lines = [
        '<grand_story_execution_brief>',
        `TurnFocus: ${turnNumber}`,
        'Policy: Adaptive lens only. If the player hard-diverges, preserve world logic and retarget beats instead of forcing the roadmap.',
        '',
        '[PRIMARY MOVES THIS TURN]'
    ];

    if (primary.length === 0) {
        lines.push('- No immediate non-spoiler move was identified; prioritize continuity and character agency this turn.');
    } else {
        primary.forEach(entry => lines.push(formatBriefEntry(entry)));
    }

    lines.push('');
    lines.push('[WORLD MOTION TO SHOW]');
    if (worldMotion.length === 0) {
        lines.push('- No explicit world-motion item is currently active; show at least one concrete external pressure anyway (news, faction motion, logistics, economy, weather, law, etc.).');
    } else {
        worldMotion.forEach(entry => lines.push(formatBriefEntry(entry)));
    }

    lines.push('');
    lines.push('[RELATIONSHIP / PARTY ENERGY]');
    if (relationship.length === 0) {
        lines.push('- No explicit relationship directive is active; still include one character-to-character beat that changes trust, friction, or intimacy boundaries.');
    } else {
        relationship.forEach(entry => lines.push(formatBriefEntry(entry)));
    }

    lines.push('');
    lines.push('[SPOILER GUARDRAILS]');
    if (guardrails.length === 0) {
        lines.push('- No explicit mystery guardrail found in plan entries. Keep reveals paced and avoid dumping hidden agendas in one scene.');
    } else {
        guardrails.forEach(entry => lines.push(formatBriefEntry(entry)));
    }

    lines.push('');
    lines.push('[THEME ANCHOR]');
    if (!themeAnchor) {
        lines.push('- No explicit THEME entry found. Preserve tone consistency and long-term thematic identity.');
    } else {
        lines.push(formatBriefEntry(themeAnchor));
    }

    lines.push('</grand_story_execution_brief>');
    return lines.join('\n');
}

function formatDirectorExecutionBriefForTerminal(rawPlan, currentTurn, options = {}) {
    const colors = options.colors || {};
    const c = {
        reset: colors.reset || '\x1b[0m',
        bright: colors.bright || '\x1b[1m',
        green: colors.green || '\x1b[32m'
    };

    const brief = buildDirectorExecutionBrief(rawPlan, currentTurn, {
        itemLimit: options.itemLimit,
        maxChars: options.maxChars
    });

    return `${c.bright}${c.green}Grand Story Planner Focus Brief${c.reset}\n${brief}`;
}

/**
 * Synthesizes the raw ledger text into a nicely formatted, grouped markdown string.
 */
function synthesizePlan(ledgerText) {
    if (!ledgerText || ledgerText === 'Empty.') return 'No Grand Story Plan currently active.';

    const categories = Object.fromEntries(
        PLAN_CATEGORY_DEFINITIONS.map(([code, title]) => [code, { title, items: [] }])
    );

    const entries = parsePlanEntriesFromLedgerText(ledgerText);
    for (const entry of entries) {
        const targetCat = categories[entry.category] ? entry.category : 'OTHER';
        categories[targetCat].items.push(`- **[Span: ${entry.span}]** ${entry.content}`);
    }

    let synthesized = '## GRAND STORY PLAN\n\n';
    for (const key of Object.keys(categories)) {
        if (categories[key].items.length > 0) {
            synthesized += `### ${categories[key].title}\n${categories[key].items.join('\n')}\n\n`;
        }
    }

    return synthesized.trim();
}

/**
 * Fetches the active planner ledger entries as they existed at the end of a turn.
 */
async function getPlanEntriesForTurn(turnContext, tools, targetTurn) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) return [];

    return await tools.db.chat.query(
        `SELECT f.target, f.fact_value, f.turn_number, f.context
         FROM facts f
         WHERE f.project_name = ?
           AND f.source = ?
           AND f.predicate = 'LEDGER_ENTRY'
           AND f.turn_number <= ?
           AND f.id = (
               SELECT f2.id
               FROM facts f2
               WHERE f2.project_name = f.project_name
                 AND f2.source = f.source
                 AND f2.predicate = f.predicate
                 AND f2.target = f.target
                 AND f2.turn_number <= ?
               ORDER BY f2.turn_number DESC, f2.id DESC
               LIMIT 1
           )
           AND (f.context IS NULL OR f.context != 'DELETED')
         ORDER BY f.target COLLATE NOCASE ASC`,
        [projectName.toLowerCase(), 'grand_story_planner', targetTurn, targetTurn]
    );
}

/**
 * Fetches raw planner ledger operations in a turn range.
 */
async function getPlanOperationsInRange(turnContext, tools, startTurn, endTurn) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) return [];

    return await tools.db.chat.query(
        `SELECT target, fact_value, turn_number, context
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND predicate = 'LEDGER_ENTRY'
           AND turn_number BETWEEN ? AND ?
         ORDER BY turn_number ASC, id ASC`,
        [projectName.toLowerCase(), 'grand_story_planner', startTurn, endTurn]
    );
}

async function getLatestPlannerTurn(turnContext, tools) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) return turnContext?.turnNumber || 1;

    const rows = await tools.db.chat.query(
        `SELECT MAX(turn_number) AS latest_turn
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND predicate = 'LEDGER_ENTRY'
           AND turn_number <= ?`,
        [projectName.toLowerCase(), 'grand_story_planner', turnContext?.turnNumber || 999999]
    );

    return rows?.[0]?.latest_turn || turnContext?.turnNumber || tools.turnContext?.turnNumber || 1;
}

async function getLastSuccessfulPlannerReviewTurn(turnContext, tools) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) return turnContext?.turnNumber || 1;

    const rows = await tools.db.chat.query(
        `SELECT MAX(turn_number) AS latest_turn
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND target = ?
           AND predicate = 'PLANNER_REVIEW'
           AND fact_value IN ('APPLIED_CHANGES', 'NO_CHANGES_REQUIRED')
           AND turn_number <= ?`,
        [projectName.toLowerCase(), 'grand_story_planner', 'scheduler', turnContext?.turnNumber || 999999]
    );

    return rows?.[0]?.latest_turn || await getLatestPlannerTurn(turnContext, tools);
}

async function markPlannerReview(turnContext, tools, status, context = null) {
    const turnNumber = turnContext?.turnNumber || tools.turnContext?.turnNumber || 0;
    
    // Use managed facts for meta-state tracking to ensure automatic cleanup on retries
    await tools.facts.appendToFactsDb({
        source: 'grand_story_planner',
        target: 'scheduler',
        predicate: 'PLANNER_REVIEW',
        fact_value: status,
        context: context
    }, { turn_number: turnNumber });
}

async function getLatestStoryTurn(turnContext, tools) {
    try {
        const resolvedCurrent = await tools.turns.resolve(turnContext || tools.turnContext);
        if (resolvedCurrent?.turnNumber) return resolvedCurrent.turnNumber;
        const latestTurn = await tools.turns.getLatest({ fallbackToCurrent: true });
        return latestTurn?.turnNumber || 1;
    } catch {
        return turnContext?.turnNumber || tools.turnContext?.turnNumber || 1;
    }
}

function wrapTerminalText(text, width = 104, indent = '') {
    if (!text) return [indent];

    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return [indent];

    const words = normalized.split(' ');
    const lines = [];
    let current = indent;

    for (const word of words) {
        const next = current.trim() ? `${current} ${word}` : `${indent}${word}`;
        if (next.length > width && current.trim()) {
            lines.push(current);
            current = `${indent}${word}`;
        } else {
            current = next;
        }
    }

    if (current.trim()) lines.push(current);
    return lines;
}

function parsePlanEntry(row) {
    const id = String(row.target || 'unknown').toUpperCase();
    const category = id.split('-')[0];
    const rawValue = String(row.fact_value || '').trim();
    const match = rawValue.match(/^\|?\s*Span:\s*(.*?)\s*\|\s*Content:\s*(.*)$/i);

    return {
        id,
        category,
        span: match ? match[1].trim() : 'Unspecified',
        content: match ? match[2].trim() : rawValue.replace(/^\|?\s*/, ''),
        updatedTurn: row.turn_number
    };
}

function normalizeLedgerOperationLine(line) {
    const normalized = String(line || '')
        .trim()
        .replace(/^```(?:\w+)?\s*$/i, '')
        .replace(/^>\s*/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim();

    const deleteMatch = normalized.match(/^DELETE\s+(?:\[([a-zA-Z0-9_-]+)\]|([a-zA-Z0-9_-]+))\s*$/i);
    if (deleteMatch) return `DELETE [${(deleteMatch[1] || deleteMatch[2]).toUpperCase()}]`;

    const explicitMatch = normalized.match(/^(UPDATE|INSERT)\s+(?:\[([a-zA-Z0-9_-]+)\]|([a-zA-Z0-9_-]+))\s+(.*)$/i);
    if (explicitMatch) {
        const type = explicitMatch[1].toUpperCase();
        const id = (explicitMatch[2] || explicitMatch[3]).toUpperCase();
        return `${type} [${id}] ${explicitMatch[4].trim()}`;
    }

    const implicitMatch = normalized.match(/^\[([a-zA-Z0-9_-]+)\]\s+(.*)$/i);
    if (implicitMatch) return `[${implicitMatch[1].toUpperCase()}] ${implicitMatch[2].trim()}`;

    return normalized;
}

function isLedgerOperationLine(line) {
    if (!line) return false;
    if (/^DELETE\s+\[[a-zA-Z0-9_-]+\]\s*$/i.test(line)) return true;
    if (/^(UPDATE|INSERT)\s+\[[a-zA-Z0-9_-]+\]\s+\|?\s*Span\s*:/i.test(line)) return true;
    return /^\[[a-zA-Z0-9_-]+\]\s+\|?\s*Span\s*:/i.test(line);
}

function extractLedgerOperations(text) {
    if (!text) return '';

    const operations = [];
    let pending = null;
    const flushPending = () => {
        if (pending) operations.push(pending);
        pending = null;
    };

    for (const rawLine of String(text).split('\n')) {
        const line = normalizeLedgerOperationLine(rawLine);
        if (isLedgerOperationLine(line)) {
            flushPending();
            pending = line;
        } else if (line && pending && !/^DELETE\s/i.test(pending)) {
            // Providers occasionally wrap an operation's Content across lines.
            pending = `${pending} ${line}`;
        }
    }
    flushPending();

    return operations.join('\n');
}

function getLedgerOperationMetadata(line) {
    const normalized = normalizeLedgerOperationLine(line);
    if (!normalized) return null;

    const deleteMatch = normalized.match(/^DELETE\s+\[([a-zA-Z0-9_-]+)\]\s*$/i);
    if (deleteMatch) {
        const id = deleteMatch[1].toUpperCase();
        return { type: 'DELETE', id, category: id.split('-')[0], span: null, line: normalized };
    }

    const explicitMatch = normalized.match(/^(UPDATE|INSERT)\s+\[([a-zA-Z0-9_-]+)\]\s+(.*)$/i);
    const implicitMatch = normalized.match(/^\[([a-zA-Z0-9_-]+)\]\s+(.*)$/i);

    const type = explicitMatch ? explicitMatch[1].toUpperCase() : 'UPSERT';
    const id = explicitMatch ? explicitMatch[2].toUpperCase() : implicitMatch?.[1]?.toUpperCase();
    const payload = explicitMatch ? explicitMatch[3] : implicitMatch?.[2];
    if (!id || !payload) return null;

    const spanMatch = payload.match(/\|?\s*Span:\s*(.*?)\s*\|\s*Content:/i);
    return {
        type,
        id,
        category: id.split('-')[0],
        span: spanMatch ? spanMatch[1].trim() : null,
        line: normalized
    };
}

function getUnboundedSpanReason(meta) {
    if (!meta || meta.type === 'DELETE' || meta.category === 'THEME') return null;

    const span = String(meta.span || '').trim();
    const normalized = span.toLowerCase();
    if (!normalized) return 'missing Span';
    if (/\bturn\s*\d+\s*\+/.test(normalized) || /\b\d+\s*\+/.test(normalized)) return 'open-ended plus span';
    if (/\b(ongoing|forever|indefinite)\b/.test(normalized)) return 'open-ended wording';
    if (/until\s+later/.test(normalized)) return 'vague future endpoint';
    if (/\b(global|constant)\b/.test(normalized)) return 'global non-theme span';

    const activeWithoutBoundary = /^active\b/.test(normalized)
        && !/(turns?\s*\d|until|resolve|trigger|dormant|plant|reveal|by\s+turn|deadline)/.test(normalized);
    if (activeWithoutBoundary) return 'active span without a boundary';

    return null;
}

function filterLedgerOperationsForBoundedSpans(operationsText) {
    const accepted = [];
    const rejected = [];

    for (const line of String(operationsText || '').split('\n')) {
        const normalized = normalizeLedgerOperationLine(line);
        if (!normalized) continue;

        const meta = getLedgerOperationMetadata(normalized);
        const reason = getUnboundedSpanReason(meta);
        if (reason) {
            rejected.push({ line: normalized, reason });
        } else {
            accepted.push(normalized);
        }
    }

    return {
        operationsText: accepted.join('\n'),
        rejected
    };
}

function getLatestExplicitTurnMention(planText) {
    if (!planText) return null;

    let latest = null;
    const regex = /\bTurns?\s*(\d+)(?:\s*(?:to|-|\u2013)\s*(?:Turn\s*)?(\d+))?/gi;
    let match;

    while ((match = regex.exec(planText)) !== null) {
        const first = parseInt(match[1], 10);
        const second = match[2] ? parseInt(match[2], 10) : null;

        if (!Number.isNaN(first)) latest = latest === null ? first : Math.max(latest, first);
        if (second !== null && !Number.isNaN(second)) latest = Math.max(latest, second);
    }

    return latest;
}

function formatPlanEntriesForTerminal(entries, options = {}) {
    const colors = options.colors || {};
    const title = options.title || 'Grand Story Planner';
    const subtitle = options.subtitle || '';
    const c = {
        reset: colors.reset || '\x1b[0m',
        bright: colors.bright || '\x1b[1m',
        cyan: colors.cyan || '\x1b[36m',
        green: colors.green || '\x1b[32m',
        yellow: colors.yellow || '\x1b[33m',
        grey: colors.grey || '\x1b[90m'
    };

    if (!entries || entries.length === 0) {
        return `${c.yellow}No Grand Story Plan entries found for this turn.${c.reset}`;
    }

    const categories = PLAN_CATEGORY_DEFINITIONS;

    const grouped = new Map(categories.map(([key]) => [key, []]));
    for (const row of entries) {
        const parsed = parsePlanEntry(row);
        const groupKey = grouped.has(parsed.category) ? parsed.category : 'OTHER';
        grouped.get(groupKey).push(parsed);
    }

    const lines = [
        `${c.bright}${c.green}${title}${c.reset}`,
        subtitle ? `${c.grey}${subtitle}${c.reset}` : '',
        ''
    ].filter(line => line !== '');

    for (const [key, heading] of categories) {
        const items = grouped.get(key);
        if (!items || items.length === 0) continue;

        lines.push(`${c.bright}${heading}${c.reset}`);
        for (const item of items) {
            lines.push(`  ${c.cyan}[${item.id}]${c.reset}`);
            lines.push(`    ${c.yellow}Span:${c.reset} ${item.span}`);
            lines.push(`    ${c.grey}Last Updated:${c.reset} Turn ${item.updatedTurn}`);
            lines.push(`    ${c.yellow}Content:${c.reset}`);
            lines.push(...wrapTerminalText(item.content, 104, '      '));
            lines.push('');
        }
    }

    return lines.join('\n').trimEnd();
}

function formatPlanEntriesRawForTerminal(entries, options = {}) {
    const colors = options.colors || {};
    const c = {
        reset: colors.reset || '\x1b[0m',
        green: colors.green || '\x1b[32m',
        yellow: colors.yellow || '\x1b[33m'
    };

    if (!entries || entries.length === 0) {
        return `${c.yellow}No Grand Story Plan entries found for this turn.${c.reset}`;
    }

    const lines = [`${c.green}Raw Grand Story Planner Ledger${c.reset}`];
    for (const row of entries) {
        lines.push(`[${String(row.target || 'unknown').toUpperCase()}] ${String(row.fact_value || '').trim()}`);
    }
    return lines.join('\n');
}

function formatPlanOperationsForTerminal(rows, options = {}) {
    const colors = options.colors || {};
    const c = {
        reset: colors.reset || '\x1b[0m',
        bright: colors.bright || '\x1b[1m',
        cyan: colors.cyan || '\x1b[36m',
        green: colors.green || '\x1b[32m',
        yellow: colors.yellow || '\x1b[33m',
        grey: colors.grey || '\x1b[90m'
    };

    if (!rows || rows.length === 0) {
        return `${c.yellow}No Grand Story Planner ledger changes found in that range.${c.reset}`;
    }

    const lines = [`${c.bright}${c.green}Grand Story Planner Changes${c.reset}`];
    let currentTurn = null;

    for (const row of rows) {
        if (row.turn_number !== currentTurn) {
            currentTurn = row.turn_number;
            lines.push('');
            lines.push(`${c.bright}${c.yellow}Turn ${currentTurn}${c.reset}`);
        }

        const id = String(row.target || 'unknown').toUpperCase();
        if (row.context === 'DELETED') {
            lines.push(`  ${c.cyan}[${id}]${c.reset} ${c.grey}DELETED${c.reset}`);
            continue;
        }

        const parsed = parsePlanEntry(row);
        lines.push(`  ${c.cyan}[${parsed.id}]${c.reset}`);
        lines.push(`    ${c.yellow}Span:${c.reset} ${parsed.span}`);
        lines.push(`    ${c.yellow}Content:${c.reset}`);
        lines.push(...wrapTerminalText(parsed.content, 104, '      '));
    }

    return lines.join('\n');
}

/**
 * Ensures table exists for master plan cache.
 */
async function ensureTables(tools) {
    // Master cache in project.db (still needed so we can re-initialize without paying LLM costs for static lore changes)
    await tools.db.project.execute(`
        CREATE TABLE IF NOT EXISTS grand_plan_cache (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            plan_text TEXT,
            lore_hash TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

/**
 * Gets the plan for the current story, initializing it if necessary.
 */
async function getOrInitializePlan(turnContext, tools) {
    // Ensure no leftover planner data from a failed/retried turn
    await tools.facts.cleanUpFactsDb();

    const rootDirectory = turnContext.runtime.rootDirectory;
    await ensureTables(tools);

    // 1. Check if we already have an active plan for THIS story
    const currentPlan = await tools.facts.getFormattedLedger('grand_story_planner', turnContext.projectName, turnContext.turnNumber);
    if (currentPlan && currentPlan !== 'Empty.') {
        return currentPlan;
    }

    // 2. If not, we need to initialize from the master cache or generate fresh
    tools.logger.log('Lifecycle', 'Initializing Grand Story Plan for this story...');

    const currentHash = await generateLoreHash(rootDirectory);
    const cacheRows = await tools.db.project.query("SELECT plan_text, lore_hash FROM grand_plan_cache WHERE id = 1");
    const cached = cacheRows && cacheRows.length > 0 ? cacheRows[0] : null;

    let planToUse;

    if (cached && cached.lore_hash === currentHash) {
        tools.logger.log('Lifecycle', 'Using cached master plan for initialization.');
        planToUse = cached.plan_text;
    } else {
        // Generate fresh master plan
        tools.logger.log('Generation', 'Generating fresh Master Grand Story Plan...', 'start');
        const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
        const sourceMaterial = gatherSourceMaterial(turnContext);
        const plannerInputs = await gatherPlannerInputs(tools);
        const plannerContextCapsule = await buildPlannerContextCapsule(turnContext, tools, settings, '');

        // Narrative Pacing Integration
        let pacingStrategy = '';
        try {
            pacingStrategy = await tools.plugins.tryCall(
                'narrative_pacing',
                'getInitialPacingSynthesis',
                [turnContext, tools],
                { fallback: '', silent: true }
            ) || '';
        } catch (e) {
            tools.logger.warn('Logic', 'Failed to retrieve initial narrative pacing synthesis.', e);
        }

        const storyNeeds = await classifyStoryNeeds(turnContext, tools, settings, {
            currentPlan: 'No active plan yet.',
            plannerContextCapsule,
            pacingStrategy,
            plannerInputs
        });

        const architectGuidance = await gatherArchitectGuidance(turnContext, tools, settings, {
            tags: storyNeeds.neededTags,
            series: storyNeeds.seriesPreferences,
            forceReselect: storyNeeds.usedClassifier && ((storyNeeds.neededTags || []).length > 0 || (storyNeeds.seriesPreferences || []).length > 0)
        });

        const showrunnerDoctrine = await fs.readFile(path.join(__dirname, 'prompt_showrunner_doctrine.txt'), 'utf-8');
        const promptTemplate = (await fs.readFile(path.join(__dirname, 'prompt_init.txt'), 'utf-8'))
            .replace('{{showrunner_doctrine}}', showrunnerDoctrine)
            .replace(/{{current_turn_number}}/g, String(turnContext.turnNumber || 1));
        const [setup, objective] = promptTemplate.split('### OBJECTIVE');

        const systemContent = setup
            .replace('{{source_material}}', sourceMaterial)
            .replace('{{planner_context_capsule}}', plannerContextCapsule || 'No planner context capsule available for this planning step.')
            .replace('{{pacing_strategy}}', pacingStrategy)
            .replace('{{story_needs_signal}}', storyNeeds.signalText || 'No story-needs signal available.')
            .replace('{{architect_structural_guidance}}', architectGuidance || 'No architect structural guidance available for this planning step.')
            .replace('{{planner_inputs}}', plannerInputs || "No specific user inputs defined for the planner.");

        const userContent = `### OBJECTIVE${objective}`;
        const modelDef = settings.model_def || settings.narrative_agents?.director;

        console.log(`[GrandStoryPlanner] Initializing plan. Prompt length: ${systemContent.length + userContent.length} characters.`);
        if (systemContent.length > 5000) {
            console.log(`[GrandStoryPlanner] System Prompt preview (first 1000 chars): ${systemContent.substring(0, 1000)}...`);
            console.log(`[GrandStoryPlanner] System Prompt preview (last 1000 chars): ...${systemContent.substring(systemContent.length - 1000)}`);
        }

        const messages = [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent }
        ];

        tools.logger.log('Generation', 'Calling LLM for Master Grand Story Plan...', 'start');
        const response = await tools.llm.runTask({
            msg: 'Grand Story Planner Init',
            messages,
            model: modelDef.model,
            provider: modelDef.provider,
            params: {
                retries: settings.retries,
                timeout: settings.timeout,
                callingModule: 'Plugin:grand_story_planner:init'
            }
        });
        tools.logger.log('Generation', 'LLM response received for Master Grand Story Plan.', 'end');

        planToUse = response.content;

        // Save to master cache
        await tools.db.project.execute(
            "INSERT OR REPLACE INTO grand_plan_cache (id, plan_text, lore_hash, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)",
            [planToUse, currentHash]
        );
        tools.logger.log('Generation', 'Master plan generated and cached.', 'end');
    }

    // 3. Save the initialized plan to the chat database via fact manager
    await tools.facts.processLedgerOperations(planToUse, 'grand_story_planner');

    // Return the newly formatted ledger
    return await tools.facts.getFormattedLedger('grand_story_planner', turnContext.projectName, turnContext.turnNumber);
}

/**
 * Updates the plan based on the recent narrative history.
 */
async function updatePlan(turnContext, tools) {
    // Ensure no leftover planner data from a failed/retried turn
    await tools.facts.cleanUpFactsDb();

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const turnNumber = turnContext.turnNumber;
    const interval = settings.update_interval || 5;
    const lastReviewTurn = await getLastSuccessfulPlannerReviewTurn(turnContext, tools);
    const turnsSinceLastReview = Math.max(0, turnNumber - lastReviewTurn);

    if (!settings.force_update && (turnNumber <= 1 || turnsSinceLastReview < interval)) {
        tools.logger.log('Update', `Skipping Grand Story Plan review. Last successful review: Turn ${lastReviewTurn}; current turn: ${turnNumber}; interval: ${interval}.`);
        return;
    }

    tools.logger.log('Update', `Triggering periodic update for Grand Story Plan (Turn ${turnNumber})...`, 'start');

    // 1. Fetch current active plan
    const currentPlan = await tools.facts.getFormattedLedger('grand_story_planner', turnContext.projectName, turnContext.turnNumber);
    if (!currentPlan || currentPlan === 'Empty.') {
        tools.logger.warn('Update', 'No active plan found to update.');
        return;
    }

    const lastPlanWriteTurn = await getLatestPlannerTurn(turnContext, tools);
    const turnsSincePlanWrite = Math.max(0, turnNumber - lastPlanWriteTurn);
    const latestExplicitPlanTurn = getLatestExplicitTurnMention(currentPlan);
    const planAppearsPastDue = latestExplicitPlanTurn !== null && latestExplicitPlanTurn < turnNumber;

    // 2. Build compact planning capsule (Phase 2 context strategy)
    const plannerInputs = await gatherPlannerInputs(tools);
    const plannerContextCapsule = await buildPlannerContextCapsule(turnContext, tools, settings, currentPlan);

    // Narrative Pacing Integration
    let pacingStrategy = '';
    try {
        pacingStrategy = await tools.plugins.tryCall(
            'narrative_pacing',
            'getCurrentPacingSynthesis',
            [turnContext, tools],
            { fallback: '', silent: true }
        ) || '';
    } catch (e) {
        tools.logger.warn('Update', 'Failed to retrieve current narrative pacing synthesis.', e);
    }

    const storyNeeds = await classifyStoryNeeds(turnContext, tools, settings, {
        currentPlan,
        plannerContextCapsule,
        pacingStrategy,
        plannerInputs
    });

    const architectGuidance = await gatherArchitectGuidance(turnContext, tools, settings, {
        tags: storyNeeds.neededTags,
        series: storyNeeds.seriesPreferences,
        forceReselect: storyNeeds.usedClassifier && ((storyNeeds.neededTags || []).length > 0 || (storyNeeds.seriesPreferences || []).length > 0)
    });

    // 3. Call LLM for patches
    const sourceMaterial = gatherSourceMaterial(turnContext);
    const showrunnerDoctrine = await fs.readFile(path.join(__dirname, 'prompt_showrunner_doctrine.txt'), 'utf-8');
    const promptTemplate = (await fs.readFile(path.join(__dirname, 'prompt_update.txt'), 'utf-8'))
        .replace('{{showrunner_doctrine}}', showrunnerDoctrine);

    const applyUpdateTemplate = (template) => template
        .replace(/{{current_turn_number}}/g, String(turnNumber))
        .replace(/{{last_plan_update_turn}}/g, String(lastPlanWriteTurn))
        .replace(/{{turns_since_plan_update}}/g, String(turnsSincePlanWrite))
        .replace(/{{last_plan_review_turn}}/g, String(lastReviewTurn))
        .replace(/{{turns_since_plan_review}}/g, String(turnsSinceLastReview))
        .replace(/{{latest_explicit_plan_turn}}/g, latestExplicitPlanTurn === null ? 'UNKNOWN' : String(latestExplicitPlanTurn))
        .replace('{{current_plan}}', currentPlan)
        .replace('{{source_material}}', sourceMaterial || 'No shared source material available for this planning step.')
        .replace('{{planner_context_capsule}}', plannerContextCapsule || 'No planner context capsule available for this planning step.')
        .replace('{{pacing_strategy}}', pacingStrategy)
        .replace('{{story_needs_signal}}', storyNeeds.signalText || 'No story-needs signal available.')
        .replace('{{architect_structural_guidance}}', architectGuidance || 'No architect structural guidance available for this planning step.')
        .replace('{{planner_inputs}}', plannerInputs || "No specific user inputs defined for the planner.");

    const [setup, objective] = promptTemplate.split('### OBJECTIVE');
    const systemContent = applyUpdateTemplate(setup || promptTemplate);
    const userContent = objective === undefined
        ? ''
        : applyUpdateTemplate(`### OBJECTIVE${objective}`);

    const modelDef = settings.model_def || settings.narrative_agents?.director;

    console.log(`[GrandStoryPlanner] Updating plan (Turn ${turnNumber}). Prompt length: ${systemContent.length + userContent.length} characters.`);
    if (systemContent.length + userContent.length > 5000) {
        console.log(`[GrandStoryPlanner] Update System Prompt preview (first 1000 chars): ${systemContent.substring(0, 1000)}...`);
    }

    const sharedPrefix = turnContext?.runtime?.promptBuilder?.sharedNarrativePrefix;
    const plannerTask = `# AGENT TASK: GRAND STORY PLANNER
The shared messages before this task are the authoritative narrative foundation. Switch to the hidden planning role defined below; do not write narrative prose.

${systemContent}

${userContent}`;
    const messages = Array.isArray(sharedPrefix?.messages)
        ? [
            ...sharedPrefix.messages.map(message => ({
                role: String(message?.role || 'user'),
                content: String(message?.content || '')
            })),
            { role: 'user', content: plannerTask }
        ]
        : [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent }
        ];

    if (Array.isArray(sharedPrefix?.messages)) {
        tools.logger.log(
            'PromptCache',
            `Using shared Director/Writer prefix ${sharedPrefix.prefixHash} for Grand Story Planner update (${sharedPrefix.characterCount} cached-prefix chars).`
        );
    } else {
        tools.logger.warn('PromptCache', 'Shared narrative prefix unavailable; using standalone planner prompt.');
    }

    tools.logger.log('Update', 'Calling LLM for Grand Story Plan update...', 'start');
    const response = await tools.llm.runTask({
        msg: 'Grand Story Planner Update',
        messages,
        model: modelDef.model,
        provider: modelDef.provider,
        params: {
            retries: settings.retries,
            timeout: settings.timeout,
            callingModule: 'Plugin:grand_story_planner:update'
        }
    });
    tools.logger.log('Update', 'LLM response received for Grand Story Plan update.', 'end');

    const responseContent = response.content;
    const ledgerOperations = extractLedgerOperations(responseContent);
    const boundedLedgerOperations = filterLedgerOperationsForBoundedSpans(ledgerOperations);

    if (!ledgerOperations) {
        if (/NO CHANGES REQUIRED/i.test(responseContent)) {
            if (planAppearsPastDue) {
                await markPlannerReview(turnContext, tools, 'REJECTED_STALE_NO_CHANGES', `Planner said no changes, but latest explicit plan turn was ${latestExplicitPlanTurn}.`);
                tools.logger.warn('Update', `Rejected NO CHANGES REQUIRED because the active plan appears past due (latest explicit plan turn: ${latestExplicitPlanTurn}, current turn: ${turnNumber}).`);
                tools.logger.log('Update', 'No ledger operations applied.', 'end');
                return;
            }

            await markPlannerReview(turnContext, tools, 'NO_CHANGES_REQUIRED', `Reviewed after ${turnsSinceLastReview} turn(s); no ledger patches requested.`);
            tools.logger.log('Update', 'Planner decided no changes are required.', 'end');
        } else {
            await markPlannerReview(turnContext, tools, 'NO_PARSEABLE_OPERATIONS', 'LLM response did not contain parseable planner ledger operations.');
            tools.logger.warn('Update', 'Planner response contained no parseable ledger operations.');
            tools.logger.log('Update', 'No ledger operations applied.', 'end');
        }
        return;
    }

    if (boundedLedgerOperations.rejected.length > 0) {
        const rejectedSummary = boundedLedgerOperations.rejected
            .map(r => `${r.reason}: ${r.line}`)
            .join('\n');
        tools.logger.warn('Update', `Rejected unbounded Grand Story Planner operation(s):\n${rejectedSummary}`);
    }

    if (!boundedLedgerOperations.operationsText) {
        await markPlannerReview(turnContext, tools, 'REJECTED_UNBOUNDED_SPANS', 'Planner response contained only unbounded non-theme spans.');
        tools.logger.log('Update', 'No ledger operations applied.', 'end');
        return;
    }

    // 4. Apply ledger operations
    await tools.facts.processLedgerOperations(boundedLedgerOperations.operationsText, 'grand_story_planner');
    await markPlannerReview(
        turnContext,
        tools,
        'APPLIED_CHANGES',
        `Applied ${boundedLedgerOperations.operationsText.split('\n').length} ledger operation(s); rejected ${boundedLedgerOperations.rejected.length} unbounded operation(s).`
    );

    tools.logger.log('Update', 'Grand Story Plan updated with narrative developments.', 'end');
}

module.exports = {
    getOrInitializePlan,
    updatePlan,
    synthesizePlan,
    buildDirectorExecutionBrief,
    formatDirectorExecutionBriefForTerminal,
    getPlanEntriesForTurn,
    getPlanOperationsInRange,
    getLatestPlannerTurn,
    getLastSuccessfulPlannerReviewTurn,
    markPlannerReview,
    getLatestStoryTurn,
    extractLedgerOperations,
    getLatestExplicitTurnMention,
    filterLedgerOperationsForBoundedSpans,
    formatPlanEntriesForTerminal,
    formatPlanEntriesRawForTerminal,
    formatPlanOperationsForTerminal
};
