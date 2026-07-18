const DEFAULT_PACING_BUDGET = {
    action: 16.66,
    romance: 16.66,
    slice_of_life: 16.66,
    comedy: 16.66,
    mystery: 16.66,
    drama: 16.66,
    tragedy: 0
};

async function scoreAndSavePacing(turnContext, tools, settings = {}) {
    // Ensure no leftover pacing data from a failed/retried turn
    await tools.facts.cleanUpFactsDb();

    const writerResponse = turnContext.processed?.narrativeEngine?.writerResponse;
    if (!writerResponse) {
        return;
    }
    const text = writerResponse;
    const turnNumber = turnContext.turnNumber;

    tools.logger.runtime(`[Pacing] Scoring scene pacing metrics for turn ${turnNumber}...`);

    const prompt = `
You are an expert story editor analyzing a scene. Score the scene out of 100 on the following 7 metrics based on their prominence in the text. 
The metrics do NOT need to sum to 100. For example, a scene can be 80 action and 50 drama.
Metrics:
- action
- romance
- slice_of_life
- comedy
- mystery
- drama
- tragedy

Scene Text:
${text}

Output strictly in JSON format representing the scores (0-100 integers). Do not include any other text or markdown formatting.
Example: {"action": 80, "romance": 0, "slice_of_life": 20, "comedy": 10, "mystery": 0, "drama": 50, "tragedy": 0}
`;

    try {
        const modelAlias = settings.scoring_model?.model || settings.scoring_model || 'mediumendmodel';

        const result = await tools.llm.json({
            msg: "Narrative Pacing Scoring",
            messages: [{ role: 'user', content: prompt }],
            model: modelAlias,
            params: {
                temperature: 0.1
            }
        });

        const scores = result.content;
        for (const [metric, score] of Object.entries(scores)) {
            if (typeof score !== 'number') continue;

            await tools.facts.appendToFactsDb({
                source: 'narrative_pacing',
                target: metric,
                predicate: 'pacing_score',
                fact_value: score
            });
        }

        tools.logger.runtime(`[Pacing] Scene scored successfully.`);
    } catch (e) {
        tools.logger.error('Failed to parse or save pacing scores', e);
    }
}

function normalizeImportance(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function isLikelyNoiseName(name) {
    if (!name || typeof name !== 'string') return true;
    const cleaned = name.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!cleaned) return true;

    if (/^\d+$/.test(cleaned)) return true;
    if (/^\d{1,2}\s*(am|pm)$/i.test(cleaned)) return true;
    if (/^\d{1,2}[:.]\d{2}\s*(am|pm)?$/i.test(cleaned)) return true;
    if (/\bo'clock\b/i.test(cleaned)) return true;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(cleaned)) return true;

    const lower = cleaned.toLowerCase();
    const hardNoise = new Set([
        'noise',
        'machine',
        'system',
        'narrator',
        'voice',
        'unknown',
        'none',
        'null',
        'chapter',
        'scene',
        'timestamp'
    ]);
    if (hardNoise.has(lower)) return true;

    if (/^(the\s+)?(lost girl|stranger|guard|soldier|machine|noise)$/i.test(cleaned)) return true;
    return false;
}

function collectTurnCharacterStats(turnContext) {
    const processedLines =
        turnContext.processed?.dialogueProcessor?.processedLines ||
        turnContext.processed?.vnManager?.processedLines ||
        [];

    const stats = new Map();
    for (const line of processedLines) {
        if (!line || line.type !== 'dialogue' || !line.character) continue;

        const displayName = String(line.character).trim();
        if (!displayName) continue;

        const key = displayName.toLowerCase();
        if (!stats.has(key)) {
            stats.set(key, { displayName, lines: 0, chars: 0 });
        }

        const current = stats.get(key);
        current.lines += 1;

        let text = '';
        if (typeof line.text === 'string') text = line.text;
        else if (typeof line.line === 'string') {
            const split = line.line.split(':');
            text = split.length > 1 ? split.slice(1).join(':').trim() : line.line;
        }
        current.chars += text.length;
    }

    return stats;
}

async function recordCharacterTurnStats(turnContext, tools, settings = {}) {
    if (settings.enable_character_stats === false) return;

    const turnNumber = turnContext.turnNumber || 0;
    const projectName = (turnContext.projectName || '').toLowerCase();
    if (!projectName || turnNumber <= 0) return;

    const stats = collectTurnCharacterStats(turnContext);
    if (stats.size === 0) {
        tools.logger.runtime(`[Pacing Cleanup] No dialogue lines detected to persist as character stats for turn ${turnNumber}.`);
        return;
    }

    for (const [source, data] of stats.entries()) {
        for (const metric of [
            { predicate: 'CHAR_STATS:LINES', value: data.lines },
            { predicate: 'CHAR_STATS:CHARS', value: data.chars }
        ]) {
            await tools.facts.appendToFactsDb({
                source: source,
                target: data.displayName,
                predicate: metric.predicate,
                fact_value: metric.value,
                context: 'narrative_pacing_character_stats'
            }, { turn_number: turnNumber });
        }
    }

    tools.logger.runtime(`[Pacing Cleanup] Stored turn stats for ${stats.size} speaking characters.`);
}

async function runCharacterCleanup(turnContext, tools, settings = {}) {
    if (settings.enable_character_cleanup !== true) return;

    const projectName = (turnContext.projectName || '').toLowerCase();
    const turnNumber = turnContext.turnNumber || 0;
    if (!projectName || turnNumber <= 0) return;

    const frequency = Number(settings.character_cleanup_frequency || 10);
    if (turnNumber < frequency || (turnNumber % frequency) !== 0) return;

    const minTotalLines = Number(settings.character_cleanup_min_total_lines ?? 3);
    const minTurnsSeen = Number(settings.character_cleanup_min_turns_seen ?? 2);
    const staleTurnsThreshold = Number(settings.character_cleanup_stale_turns ?? 12);

    tools.logger.runtime(`[Pacing Cleanup] Running cleanup on turn ${turnNumber} (freq ${frequency}).`);

    const latestImportanceRows = await tools.db.chat.query(
        `SELECT source, target, fact_value
         FROM facts
         WHERE project_name = ?
           AND predicate = 'IMPORTANCE'
           AND turn_number <= ?
         ORDER BY source ASC, turn_number DESC`,
        [projectName, turnNumber]
    );

    if (!latestImportanceRows || latestImportanceRows.length === 0) {
        tools.logger.runtime('[Pacing Cleanup] No IMPORTANCE data found. Skipping cleanup.');
        return;
    }

    const importanceMap = new Map();
    for (const row of latestImportanceRows) {
        const source = (row.source || '').toLowerCase();
        if (!source || importanceMap.has(source)) continue;
        const displayName = row.target && row.target !== 'self' ? row.target : row.source;
        importanceMap.set(source, {
            importance: normalizeImportance(row.fact_value),
            displayName: displayName || row.source || source
        });
    }

    const statsRows = await tools.db.chat.query(
        `SELECT source,
                SUM(CAST(fact_value AS INTEGER)) AS total_lines,
                SUM(CASE WHEN CAST(fact_value AS INTEGER) > 0 THEN 1 ELSE 0 END) AS turns_seen,
                MAX(turn_number) AS last_seen_turn
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CHAR_STATS:LINES'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, turnNumber]
    );
    const statsMap = new Map(
        (statsRows || []).map(row => [
            (row.source || '').toLowerCase(),
            {
                totalLines: Number(row.total_lines || 0),
                turnsSeen: Number(row.turns_seen || 0),
                lastSeenTurn: Number(row.last_seen_turn || 0)
            }
        ])
    );

    const lastAppearedRows = await tools.db.chat.query(
        `SELECT source, MAX(CAST(fact_value AS INTEGER)) AS last_appeared_turn
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CHAR_SHEET:LAST_APPEARED'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, turnNumber]
    );
    const lastAppearedMap = new Map(
        (lastAppearedRows || []).map(row => [
            (row.source || '').toLowerCase(),
            Number(row.last_appeared_turn || 0)
        ])
    );

    const playerRows = await tools.db.chat.query(
        `SELECT DISTINCT source
         FROM facts
         WHERE project_name = ?
           AND predicate = 'IS_PLAYER'
           AND LOWER(fact_value) = 'true'
           AND turn_number <= ?`,
        [projectName, turnNumber]
    );
    const protectedPlayers = new Set((playerRows || []).map(r => (r.source || '').toLowerCase()));

    await tools.db.project.execute(
        `CREATE TABLE IF NOT EXISTS character_sheets (
            project_name TEXT NOT NULL,
            character_name TEXT NOT NULL,
            source_file TEXT PRIMARY KEY,
            character_sheet_data TEXT,
            content_hash TEXT
        )`
    );
    const fullSheetRows = await tools.db.project.query(`SELECT character_name FROM character_sheets`);
    const protectedFullSheets = new Set((fullSheetRows || []).map(r => (r.character_name || '').toLowerCase()));

    const demoted = [];
    for (const [source, info] of importanceMap.entries()) {
        if (info.importance !== 'major') continue;
        if (protectedPlayers.has(source)) continue;
        if (protectedFullSheets.has(source)) continue;

        const stats = statsMap.get(source) || { totalLines: 0, turnsSeen: 0, lastSeenTurn: 0 };
        const lastSeen = Math.max(stats.lastSeenTurn || 0, lastAppearedMap.get(source) || 0);
        const staleTurns = Math.max(0, turnNumber - lastSeen);
        const lowSignal = stats.totalLines < minTotalLines || stats.turnsSeen < minTurnsSeen;
        const noisyName = isLikelyNoiseName(info.displayName || source);
        const shouldDemoteForNoise = noisyName && lowSignal;
        const shouldDemoteForStaleLowSignal = lowSignal && staleTurns >= staleTurnsThreshold;

        if (!shouldDemoteForNoise && !shouldDemoteForStaleLowSignal) {
            continue;
        }

        const reason = shouldDemoteForNoise
            ? `Auto-demoted by narrative_pacing cleanup: noisy name (${info.displayName})`
            : `Auto-demoted by narrative_pacing cleanup: low-signal stale major (lines=${stats.totalLines}, turns=${stats.turnsSeen}, stale=${staleTurns})`;

        await tools.facts.appendToFactsDb({
            source: source,
            target: info.displayName || source,
            predicate: 'IMPORTANCE',
            fact_value: 'MINOR',
            context: reason
        }, { turn_number: turnNumber });

        if (tools.vector) {
            try {
                await tools.vector.delete('social_registry', { name: info.displayName || source });
            } catch (e) {
                tools.logger.runtime(`[Pacing Cleanup] Vector cleanup skipped for ${info.displayName || source}: ${e.message}`);
            }
        }

        demoted.push(info.displayName || source);
    }

    if (demoted.length === 0) {
        tools.logger.runtime('[Pacing Cleanup] No MAJOR entries met demotion criteria.');
        return;
    }

    tools.logger.log('Pacing Cleanup', `Demoted ${demoted.length} noisy/low-signal MAJOR characters to MINOR: ${demoted.join(', ')}`);
}

async function getPacingAdvice(turnContext, tools, settings = {}) {
    const metadata = await tools.project.getMetadata();
    const budget = metadata?.pacing_budget || DEFAULT_PACING_BUDGET;
    if (!budget) return null;

    const turnNumber = turnContext.turnNumber;
    const threshold = settings.min_turns_threshold !== undefined ? settings.min_turns_threshold : 2;
    if (turnNumber < threshold) return null;

    const minTurn = Math.max(1, turnNumber - threshold);
    const projectName = turnContext.projectName;

    try {
        const facts = await tools.db.chat.query(
            `SELECT target as metric, SUM(fact_value) as total_score
             FROM facts 
             WHERE project_name = ? 
               AND predicate = 'pacing_score' 
               AND turn_number >= ? AND turn_number < ?
             GROUP BY target`,
            [projectName.toLowerCase(), minTurn, turnNumber]
        );

        if (!facts || facts.length === 0) return null;

        let totalScore = 0;
        const currentDistribution = { action: 0, romance: 0, slice_of_life: 0, comedy: 0, mystery: 0, drama: 0, tragedy: 0 };

        for (const fact of facts) {
            const val = parseFloat(fact.total_score) || 0;
            totalScore += val;
            currentDistribution[fact.metric] = val;
        }

        if (totalScore === 0) return null;

        for (const key in currentDistribution) {
            currentDistribution[key] = (currentDistribution[key] / totalScore) * 100;
        }

        let lowestDiff = 999;
        let mostLacking = null;
        let highestDiff = -999;
        let mostOvershooting = null;

        // Normalize budget to 100% scale for comparison
        let budgetSum = 0;
        for (const metric of Object.keys(budget)) {
            budgetSum += parseFloat(budget[metric]) || 0;
        }

        const normalizedBudget = {};
        for (const metric of Object.keys(budget)) {
            normalizedBudget[metric] = budgetSum > 0 ? (parseFloat(budget[metric]) / budgetSum) * 100 : 0;
        }

        for (const metric of Object.keys(normalizedBudget)) {
            const target = normalizedBudget[metric];
            const current = currentDistribution[metric] || 0;

            const diff = current - target;

            if (diff < lowestDiff && target > 0) {
                lowestDiff = diff;
                mostLacking = metric;
            }

            if (diff > highestDiff) {
                highestDiff = diff;
                mostOvershooting = metric;
            }
        }

        let advice = [];

        if (mostLacking && lowestDiff < -10) {
            advice.push(`Focus more on ${mostLacking} elements in the upcoming scenes to balance the narrative pacing.`);
        }

        if (mostOvershooting && highestDiff > 15) {
            advice.push(`The story has been heavy on ${mostOvershooting} recently. Keep this in mind and avoid overusing it unless the plot dictates it.`);
        }

        const distStrings = Object.entries(currentDistribution)
            .filter(([_, val]) => val > 0)
            .map(([m, val]) => `${m.toUpperCase()}: ${val.toFixed(0)}%`)
            .join(' | ');

        const targetStrings = Object.entries(normalizedBudget)
            .filter(([_, val]) => val > 0)
            .map(([m, val]) => `${m.toUpperCase()}: ${val.toFixed(0)}%`)
            .join(' | ');

        return { distStrings, targetStrings, advice, threshold };

    } catch (e) {
        tools.logger.error('Failed to get pacing advice', e);
        return null;
    }
}

async function synthesizePacingStrategy(turnContext, tools, settings = {}) {
    const result = await getPacingAdvice(turnContext, tools, settings);

    // If we have history-based advice, use it
    if (result) {
        let cotStep = `NARRATIVE PACING ANALYSIS - Over the last ${result.threshold} turns, the narrative distribution has been:
Current : ${result.distStrings}
Target  : ${result.targetStrings}`;

        if (result.advice.length > 0) {
            cotStep += `\n\nBased on the target budget, here is the strategic advice, to fit the USER's requested pacing: ${result.advice.join(' ')}
Review this pacing report. Do not force these elements immediately if inappropriate (e.g., adding romance during a tense battle). Instead, if needed, in your YOUR_MONOLOGUE section, formulate a soft plan to smoothly transition the narrative towards the lacking themes over the next few chapters. In your WRITER_BRIEF, begin planting subtle seeds and instructions for this transition or if the current scene allows it, you can instruct the writer immediately.`;
            tools.logger.runtime(`[Pacing] Injected Director CoT strategy: ${result.advice.join(' ')}`);
        } else {
            cotStep += `\n\nThe current pacing is perfectly balanced with the target budget. Maintain the current creative direction.`;
            tools.logger.runtime(`[Pacing] Injected Director CoT strategy: Pacing is balanced.`);
        }

        turnContext.runtime = turnContext.runtime || {};
        turnContext.runtime.director = turnContext.runtime.director || {};
        turnContext.runtime.director.cotSteps = turnContext.runtime.director.cotSteps || [];
        turnContext.runtime.director.cotSteps.push(cotStep);

        // If analysis phase is active, we don't show the initial goal anymore, even if no advice is generated.
        return;
    }

    // Fallback: If no history-based advice yet (blind spot), push the initial goal
    const initialSynthesis = await getInitialPacingSynthesis(turnContext, tools);
    if (initialSynthesis) {
        const cotStep = `NARRATIVE PACING: INITIAL GOAL - ${initialSynthesis}\nReview your target narrative distribution and plan the current and upcoming chapters to appropriately seed these elements. This goal persists until enough chapters have passed to provide performance-based feedback.`;

        turnContext.runtime = turnContext.runtime || {};
        turnContext.runtime.director = turnContext.runtime.director || {};
        turnContext.runtime.director.cotSteps = turnContext.runtime.director.cotSteps || [];
        turnContext.runtime.director.cotSteps.push(cotStep);

        tools.logger.runtime(`[Pacing] Injected persistent initial Director pacing goal.`);
    }
}

async function getInitialPacingSynthesis(turnContext, tools) {
    const metadata = await tools.project.getMetadata();
    const budget = metadata?.pacing_budget || DEFAULT_PACING_BUDGET;

    tools.logger.runtime(`[Pacing Debug] getInitialPacingSynthesis called. Turn: ${turnContext.turnNumber}. Budget: ${JSON.stringify(budget)}`);

    if (!budget) return "";

    // Normalize budget to 100% scale
    let budgetSum = 0;
    for (const metric of Object.keys(budget)) {
        budgetSum += parseFloat(budget[metric]) || 0;
    }

    if (budgetSum === 0) return "";

    const targetStrings = Object.entries(budget)
        .filter(([_, val]) => parseFloat(val) > 0)
        .map(([m, val]) => {
            const percentage = (parseFloat(val) / budgetSum) * 100;
            return `${m}: ${percentage.toFixed(1)}%`;
        })
        .join(', ');

    if (!targetStrings) return "";

    return `[USER PACING PREFERENCES]\nTarget narrative distribution is: ${targetStrings}. Design the arcs and themes to support this distribution.`;
}

async function getCurrentPacingSynthesis(turnContext, tools) {
    const settings = await tools.settings.getSelf();
    const result = await getPacingAdvice(turnContext, tools, settings);
    if (!result) return "";

    const distInfo = `Current: ${result.distStrings} | Target: ${result.targetStrings}`;

    if (result.advice.length === 0) {
        return `[NARRATIVE PACING]\nRecent narrative pacing has smoothly matched the target distribution (${distInfo}). No immediate course correction needed.`;
    }

    return `[NARRATIVE PACING]\nRecent narrative pacing distribution: ${distInfo}.\nStrategic Advice: ${result.advice.join(' ')}\nIncorporate this course correction smoothly into the updated master plan if necessary.`;
}

function getGuiHtml(budget, presets = {}, panelOpen = false) {
    const metrics = [
        { id: 'action', label: 'Action', color: '#ff4d4d' },
        { id: 'romance', label: 'Romance', color: '#ff66b2' },
        { id: 'slice_of_life', label: 'Slice of Life', color: '#66b2ff' },
        { id: 'comedy', label: 'Comedy', color: '#ffff66' },
        { id: 'mystery', label: 'Mystery', color: '#b266ff' },
        { id: 'drama', label: 'Drama', color: '#ffb266' },
        { id: 'tragedy', label: 'Tragedy', color: '#a0a0a0' }
    ];

    let slidersHtml = '';
    for (const m of metrics) {
        let points = budget[m.id] !== undefined ? parseFloat(budget[m.id]) : 5;
        if (points > 10) points = 10;
        slidersHtml += `
        <div class="pacing-slider-group">
            <span id="pacing-val-${m.id}" class="pacing-val-display" style="color: ${m.color}; border-bottom: 2px solid ${m.color}60;">${points.toFixed(1)}</span>
            <div class="slider-wrapper">
                <input type="range" id="pacing-slider-${m.id}" class="pacing-slider" data-metric="${m.id}" min="0" max="10" step="0.1" value="${points}" style="color: ${m.color}">
            </div>
            <label class="pacing-slider-label" style="color: ${m.color}">${m.label}</label>
        </div>`;
    }

    let presetsHtml = '';
    if (presets) {
        for (const [name, pBudget] of Object.entries(presets)) {
            presetsHtml += `
            <div class="pacing-preset-box" data-name="${name.replace(/"/g, '&quot;')}" data-budget='${JSON.stringify(pBudget)}'>
                <span class="preset-name">${name}</span>
                <span class="preset-delete" title="Delete Preset" data-name="${name.replace(/"/g, '&quot;')}">✖</span>
            </div>`;
        }
    }

    const panelStyle = panelOpen ? 'flex' : 'none'; // Changed to flex for better internal alignment
    const iconTransform = panelOpen ? 'rotate(90deg)' : 'rotate(0deg)';
    const toggleClass = panelOpen ? 'active' : '';
    const wrapperClass = panelOpen ? 'pacing-plugin-wrapper expanded' : 'pacing-plugin-wrapper';

    return `
    <div class="${wrapperClass}">
        <div class="pacing-header-toggle ${toggleClass}" id="pacing-toggle-btn">
            <h3><span class="pacing-toggle-icon" style="transform: ${iconTransform}">▶</span> Narrative Pacing & Strategy <span class="plugin-tag">(Plugin)</span></h3>
        </div>
        <div class="pacing-plugin-container core-area-player" id="pacing-panel" style="display: ${panelStyle};">
            <p class="pacing-description">Define the target importance of each narrative attribute (0 to 10). A zero will try to avoid that theme completely.</p>
            
            <div class="pacing-library-box">
                <div class="library-header">
                    <span class="library-title">Preset Library</span>
                    <button id="pacing-preset-add-btn" class="preset-add-btn" title="Save current configuration as a new preset">+ Save current as preset</button>
                </div>
                <div class="pacing-presets-wrapper">
                    <div class="pacing-presets-scroll" id="pacing-presets-scroll">
                        ${presetsHtml}
                    </div>
                </div>
            </div>

            <div class="pacing-sliders-container">
                ${slidersHtml}
            </div>
            
            <div class="pacing-footer">
                <span id="pacing-save-status" class="status-unsaved">Changes not saved</span>
                <button id="save-pacing-btn" class="save-apply-btn">Apply to current project</button>
            </div>
        </div>

        <!-- Custom Preset Modal -->
        <div id="pacing-preset-modal" class="pacing-modal-overlay" style="display: none;">
            <div class="pacing-modal-content">
                <h4>Save Pacing Preset</h4>
                <p>Enter a name for your current configuration:</p>
                <input type="text" id="pacing-preset-name-input" placeholder="e.g. Action Packed">
                <div class="pacing-modal-actions">
                    <button id="pacing-modal-cancel">Cancel</button>
                    <button id="pacing-modal-save" class="accent-btn">Save</button>
                </div>
            </div>
        </div>

        <!-- Custom Confirmation Modal -->
        <div id="pacing-confirm-modal" class="pacing-modal-overlay" style="display: none;">
            <div class="pacing-modal-content">
                <h4>Delete Preset?</h4>
                <p id="pacing-confirm-text">Are you sure you want to delete this preset?</p>
                <div class="pacing-modal-actions">
                    <button id="pacing-confirm-cancel">No</button>
                    <button id="pacing-confirm-ok" class="danger-btn">Yes, Delete</button>
                </div>
            </div>
        </div>
    </div>
    `;
}

function getGuiCss() {
    return `
    .pacing-plugin-wrapper {
        margin: 15px 0;
        font-family: var(--font-display, inherit);
        border-left: 4px solid var(--accent);
        border-radius: var(--radius-lg);
        overflow: hidden; /* Ensures rounded corners are respected by children */
        transition: all 0.3s ease;
    }
    .pacing-header-toggle {
        cursor: pointer;
        padding: 15px 25px;
        background-color: rgba(255, 204, 0, 0.1) !important;
        border: 1px solid rgba(255, 204, 0, 0.15);
        border-left: none; /* Handled by wrapper */
        display: flex;
        align-items: center;
        transition: all 0.3s ease;
    }
    .pacing-header-toggle:hover {
        background-color: rgba(255, 204, 0, 0.15) !important;
        border-color: rgba(255, 204, 0, 0.3);
        box-shadow: 0 4px 15px rgba(255, 204, 0, 0.1);
    }
    .plugin-tag {
        font-size: 0.7em;
        color: var(--text-muted);
        opacity: 0.6;
        font-weight: 400;
        margin-left: 4px;
    }
    .pacing-plugin-wrapper.expanded .pacing-header-toggle {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom: none;
        background-color: rgba(255, 204, 0, 0.12) !important;
    }
    .pacing-header-toggle h3 {
        margin: 0;
        font-size: 1.1em;
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text-color);
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .pacing-toggle-icon {
        font-size: 0.8em;
        transition: transform 0.3s ease;
        color: var(--accent);
    }
    .pacing-plugin-container {
        padding: 20px 15px;
        background-color: rgba(255, 204, 0, 0.06) !important;
        border: 1px solid var(--border-color);
        border-left: none; /* Handled by wrapper */
        border-top: none;
        box-shadow: inset 0 5px 15px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.2);
        display: flex;
        flex-direction: column;
    }
    .pacing-description {
        font-size: 0.85em;
        color: var(--text-muted);
        margin-bottom: 25px;
        text-align: center;
        line-height: 1.4;
    }
    .pacing-library-box {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: var(--radius-lg);
        padding: 15px;
        margin-bottom: 20px;
        border-top: 2px solid var(--accent);
    }
    .library-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }
    .library-title {
        font-size: 0.9em;
        font-weight: 700;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .pacing-presets-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 5px;
    }
    .pacing-presets-scroll {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 5px;
        flex-grow: 1;
        scrollbar-width: thin;
        scrollbar-color: var(--accent) rgba(255, 255, 255, 0.1);
    }
    .pacing-presets-scroll::-webkit-scrollbar {
        height: 6px;
    }
    .pacing-presets-scroll::-webkit-scrollbar-track {
        background: rgba(255,255,255,0.05);
        border-radius: var(--radius-sm);
    }
    .pacing-presets-scroll::-webkit-scrollbar-thumb {
        background: var(--accent);
        border-radius: var(--radius-sm);
    }
    .pacing-preset-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border-color);
        padding: 8px;
        border-radius: var(--radius-lg);
        width: 85px;
        height: 85px;
        flex-shrink: 0;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        position: relative;
        text-align: center;
    }
    .pacing-preset-box:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: var(--accent);
        transform: translateY(-2px);
    }
    .preset-name {
        font-size: 0.72em;
        font-weight: 600;
        white-space: normal;
        line-height: 1.2;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        pointer-events: none;
        color: var(--text-color);
    }
    .preset-delete {
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 0.7em;
        color: var(--text-muted);
        padding: 2px 4px;
        border-radius: var(--radius-sm);
        transition: background 0.2s, color 0.2s;
        line-height: 1;
        opacity: 0.5;
    }
    .preset-delete:hover {
        background: rgba(255, 50, 50, 0.2);
        color: #ff4d4d;
        opacity: 1;
    }
    .preset-add-btn {
        flex-shrink: 0;
        padding: 6px 14px;
        border-radius: var(--radius-sm);
        background: rgba(255, 204, 0, 0.1);
        color: var(--accent);
        border: 1px solid rgba(255, 204, 0, 0.3);
        font-size: 0.8em;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .preset-add-btn:hover {
        background: var(--accent);
        color: #1a1a1a;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    }
    .pacing-sliders-container {
        display: flex;
        justify-content: space-evenly;
        align-items: flex-end;
        height: 250px;
        margin-bottom: 25px;
        background: linear-gradient(rgba(10, 10, 10, 0.7), rgba(10, 10, 10, 0.7)), 
                    url('../../plugins/narrative_pacing/assets/background.jpg');
        background-size: cover;
        background-position: center;
        border-radius: var(--radius-lg);
        padding: 25px 10px 15px 10px;
        border: 1px solid rgba(255,255,255,0.15);
        box-shadow: inset 0 0 20px rgba(0,0,0,0.4);
    }
    .pacing-slider-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        width: 13%;
    }
    .slider-wrapper {
        height: 140px;
        width: 30px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 15px 0;
    }
    .pacing-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 140px;
        height: 6px;
        background: rgba(0,0,0,0.4);
        border-radius: var(--radius-sm);
        outline: none;
        transform: rotate(270deg);
        margin: 0;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
    }
    .pacing-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: currentColor;
        cursor: pointer;
        box-shadow: 0 0 10px currentColor, 0 2px 5px rgba(0,0,0,0.7);
        border: 2px solid rgba(255,255,255,0.8);
        transition: transform 0.1s;
    }
    .pacing-slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
        border-color: white;
    }
    .pacing-val-display {
        font-size: 1.1em;
        font-weight: 800;
        height: 24px;
        line-height: 24px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        padding: 2px 8px;
        background: rgba(0,0,0,0.3);
        border-radius: var(--radius-sm);
        min-width: 45px;
        text-align: center;
    }
    .pacing-slider-label {
        font-size: 0.85em;
        text-align: center;
        font-weight: 600;
        line-height: 1.2;
        margin-top: 5px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    .pacing-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 10px 0 10px;
        border-top: 1px solid rgba(255,255,255,0.05);
    }
    #pacing-save-status {
        font-size: 0.85em;
        font-weight: 600;
        transition: color 0.3s;
    }
    .status-unsaved { color: #ffeb3b; }
    .status-saved { color: #4CAF50; }
    
    .save-apply-btn {
        padding: 10px 25px;
        font-size: 0.9em;
        font-weight: 800;
        border-radius: var(--radius-md);
        background: linear-gradient(135deg, var(--accent) 0%, #b89200 100%);
        color: #1a1a1a;
        box-shadow: 0 4px 15px rgba(255, 204, 0, 0.2);
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .save-apply-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(255, 204, 0, 0.3);
        filter: brightness(1.1);
    }
    
    /* Modals */
    .pacing-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }
    .pacing-modal-content {
        background: var(--bg-higher);
        border: 1px solid var(--accent);
        padding: 24px;
        border-radius: var(--radius-lg);
        width: 350px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .pacing-modal-content h4 {
        margin: 0 0 10px 0;
        color: var(--accent);
    }
    .pacing-modal-content p {
        margin: 0 0 15px 0;
        font-size: 0.9em;
    }
    .pacing-modal-content input {
        width: 100%;
        background: var(--bg-lower);
        border: 1px solid var(--border-color);
        padding: 10px;
        border-radius: var(--radius-sm);
        color: white;
        margin-bottom: 20px;
        outline: none;
    }
    .pacing-modal-content input:focus {
        border-color: var(--accent);
    }
    .pacing-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
    .pacing-modal-actions button {
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        border: none;
        font-weight: 600;
        transition: all 0.2s;
    }
    .pacing-modal-actions button:hover {
        opacity: 0.8;
    }
    .danger-btn {
        background: #ff4d4d;
        color: white;
    }
    .accent-btn {
        background: var(--accent);
        color: #1a1a1a;
    }
    `;
}
function getGuiJs() {
    return `
        const container = document.querySelector('.pacing-sliders-container');
        if (!container) return;
        
        const sliders = Array.from(container.querySelectorAll('.pacing-slider'));
        const statusSpan = document.getElementById('pacing-save-status');
        const toggleBtn = document.getElementById('pacing-toggle-btn');
        const panel = document.getElementById('pacing-panel');
        const presetScroll = document.getElementById('pacing-presets-scroll');
        const addPresetBtn = document.getElementById('pacing-preset-add-btn');
        const presetModal = document.getElementById('pacing-preset-modal');
        const confirmModal = document.getElementById('pacing-confirm-modal');
        
        let pendingDeleteName = null;
        let pendingDeleteBox = null;

        function saveBudget() {
            const budget = {};
            sliders.forEach(slider => {
                const metric = slider.getAttribute('data-metric');
                budget[metric] = parseFloat(slider.value) || 0;
            });
            bridge.emit('save-pacing-budget', { budget });
        }

        if (toggleBtn && panel) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? 'flex' : 'none';
                const wrapper = document.querySelector('.pacing-plugin-wrapper');
                if (wrapper) wrapper.classList.toggle('expanded', isHidden);
                const icon = toggleBtn.querySelector('.pacing-toggle-icon');
                if (icon) {
                    icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
                }
                toggleBtn.classList.toggle('active', isHidden);
                bridge.emit('save-pacing-panel-state', { open: isHidden });
            });
        }
        
        if (presetScroll) {
            presetScroll.addEventListener('click', (e) => {
                const box = e.target.closest('.pacing-preset-box');
                const delBtn = e.target.closest('.preset-delete');
                
                if (delBtn) {
                    const presetName = delBtn.getAttribute('data-name');
                    pendingDeleteName = presetName;
                    pendingDeleteBox = box;
                    document.getElementById('pacing-confirm-text').textContent = 'Are you sure you want to delete "' + presetName + '"?';
                    confirmModal.style.display = 'flex';
                    return;
                }
                
                if (box) {
                    const bData = box.getAttribute('data-budget');
                    if (bData) {
                        try {
                            const pBudget = JSON.parse(bData);
                            sliders.forEach(slider => {
                                const metric = slider.getAttribute('data-metric');
                                if (pBudget[metric] !== undefined) {
                                    slider.value = pBudget[metric];
                                }
                            });
                            updateDisplayValues();
                            
                            document.querySelectorAll('.pacing-preset-box').forEach(b => b.style.borderColor = 'var(--border-color)');
                            box.style.borderColor = 'var(--accent)';
                            saveBudget();
                            updateStatusDisplay();
                        } catch(err) {
                            console.error('Error parsing preset budget', err);
                        }
                    }
                }
            });
        }
        
        // Modal logic for adding presets
        if (addPresetBtn) {
            addPresetBtn.addEventListener('click', () => {
                presetModal.style.display = 'flex';
                document.getElementById('pacing-preset-name-input').focus();
            });
        }

        document.getElementById('pacing-modal-cancel').addEventListener('click', () => {
            presetModal.style.display = 'none';
            document.getElementById('pacing-preset-name-input').value = '';
        });

        document.getElementById('pacing-modal-save').addEventListener('click', () => {
            const input = document.getElementById('pacing-preset-name-input');
            const name = input.value;
            if (!name || name.trim() === '') return;
            
            const budget = {};
            sliders.forEach(slider => {
                const metric = slider.getAttribute('data-metric');
                budget[metric] = parseFloat(slider.value) || 0;
            });
            
            bridge.emit('save-pacing-preset', { name: name.trim(), budget });
            
            const safeName = name.trim().replace(/"/g, '&quot;');
            const newHtml = \`
                <div class="pacing-preset-box" data-name="\${safeName}" data-budget='\${JSON.stringify(budget)}'>
                    <span class="preset-name">\${name.trim()}</span>
                    <span class="preset-delete" title="Delete Preset" data-name="\${safeName}">✖</span>
                </div>\`;
            presetScroll.insertAdjacentHTML('beforeend', newHtml);
            
            presetModal.style.display = 'none';
            input.value = '';
            
            saveBudget();
            updateStatusDisplay();
        });

        // Confirmation modal logic
        document.getElementById('pacing-confirm-cancel').addEventListener('click', () => {
            confirmModal.style.display = 'none';
        });

        document.getElementById('pacing-confirm-ok').addEventListener('click', () => {
            if (pendingDeleteName && pendingDeleteBox) {
                bridge.emit('delete-pacing-preset', { name: pendingDeleteName });
                pendingDeleteBox.remove();
            }
            confirmModal.style.display = 'none';
        });
        
        let savedBudget = {};
        sliders.forEach(slider => {
            savedBudget[slider.getAttribute('data-metric')] = parseFloat(slider.value) || 0;
        });

        function updateDisplayValues() {
            sliders.forEach(slider => {
                const metric = slider.getAttribute('data-metric');
                const val = parseFloat(slider.value) || 0;
                const valDisplay = document.getElementById('pacing-val-' + metric);
                if (valDisplay) {
                    valDisplay.textContent = val.toFixed(1);
                }
            });
        }
        
        function updateStatusDisplay() {
            let isChanged = false;
            sliders.forEach(slider => {
                const metric = slider.getAttribute('data-metric');
                const currentVal = parseFloat(slider.value) || 0;
                if (currentVal !== savedBudget[metric]) {
                    isChanged = true;
                }
            });
            
            if (isChanged) {
                statusSpan.textContent = 'Changes not saved';
                statusSpan.className = 'status-unsaved';
            } else {
                statusSpan.textContent = 'Successfully applied';
                statusSpan.className = 'status-saved';
            }
        }
        
        updateDisplayValues();
        // If there was no project budget loaded initially, it might make sense to show "Changes not saved" but we'll show "Successfully applied" for exactly what is rendered unless modified.
        updateStatusDisplay();
        
        sliders.forEach(slider => {
            slider.addEventListener('input', () => {
                updateDisplayValues();
                updateStatusDisplay();
            });
        });

        const saveBtn = document.getElementById('save-pacing-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.5';
                saveBudget();
            });
        }

        bridge.on('save-pacing-budget-response', (res) => {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
            }
            if (res.success) {
                sliders.forEach(slider => {
                    savedBudget[slider.getAttribute('data-metric')] = parseFloat(slider.value) || 0;
                });
                updateStatusDisplay();
            }
        });
    `;
}


module.exports = {
    DEFAULT_PACING_BUDGET,
    scoreAndSavePacing,
    recordCharacterTurnStats,
    runCharacterCleanup,
    synthesizePacingStrategy,
    getGuiHtml,
    getGuiCss,
    getGuiJs,
    getInitialPacingSynthesis,
    getCurrentPacingSynthesis
};
