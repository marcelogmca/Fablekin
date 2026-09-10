const fs = require('fs');
const path = require('path');

const PLUGIN_ID = 'quest_tracker';
const DEFAULT_MAX_ACTIVE_GOALS = 3;
const DEFAULT_HISTORY_PRESET = 'balanced';
const MAX_LABEL_LENGTH = 96;
const MAX_QUEST_OBJECTIVE_LENGTH = 420;
const MAX_QUEST_DETAIL_LENGTH = 1600;
const MAX_EVIDENCE_LENGTH = 240;
const MAX_REASON_LENGTH = 180;
const QUEST_EVENT_STATUSES = new Set(['completed', 'failed', 'expired', 'dropped', 'progressed']);
const RESOLVED_QUEST_STATUSES = new Set(['completed', 'failed', 'expired', 'dropped']);
const QUEST_STAKES = new Set(['low', 'medium', 'high']);
const MIN_QUEST_DEADLINE_TURNS = 3;
const DEFAULT_QUEST_OUTCOME_WINDOW_TURNS = 4;
const QUEST_SCORE_BASE = {
    completed: { low: 10, medium: 25, high: 50 },
    failed: { low: -5, medium: -15, high: -35 },
    expired: { low: -5, medium: -15, high: -35 },
    dropped: { low: -2, medium: -8, high: -20 }
};
const QUEST_SCORE_MODIFIER_LIMITS = { low: 5, medium: 10, high: 15 };
const QUEST_NOTIFICATION_INTERCEPT_ID = 'quest_notification';
const QUEST_RENOWN_TITLES = [
    { threshold: 0, title: 'Wandering Errand-Taker' },
    { threshold: 25, title: 'Roadside Helper' },
    { threshold: 75, title: 'Proven Hand' },
    { threshold: 150, title: 'Oathbound Wanderer' },
    { threshold: 300, title: 'Chronicle-Bearer' },
    { threshold: 500, title: 'Fate-Touched Hero' },
    { threshold: 800, title: 'Legend in Motion' }
];

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength) {
    const text = normalizeWhitespace(value);
    if (text.length <= maxLength) return text;
    return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '...';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasEvidence(value) {
    return normalizeWhitespace(value).length >= 3;
}

function parsePositiveInt(value, fallback, min = 1, max = 10) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

function asTurnNumber(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeDialogueLineNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    return rounded >= 0 ? rounded : null;
}

function slugifyId(value, fallback = 'story-goal') {
    const base = normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return base || fallback;
}

function clampScoreModifier(value, stakes = 'medium') {
    const normalizedStakes = normalizeQuestStakes(stakes, 'medium');
    const limit = QUEST_SCORE_MODIFIER_LIMITS[normalizedStakes] || QUEST_SCORE_MODIFIER_LIMITS.medium;
    return clampNumber(value, -limit, limit);
}

function getQuestBaseScore(status, stakes = 'medium') {
    const normalizedStatus = normalizeQuestStatus(status, 'active');
    const normalizedStakes = normalizeQuestStakes(stakes, 'medium');
    return QUEST_SCORE_BASE[normalizedStatus]?.[normalizedStakes] || 0;
}

function getRenownTitle(totalPoints) {
    const points = Number(totalPoints) || 0;
    if (points < 0) {
        return {
            title: 'Tarnished Thread',
            threshold: null,
            nextTitle: QUEST_RENOWN_TITLES[0].title,
            nextThreshold: QUEST_RENOWN_TITLES[0].threshold,
            progressPercent: 0,
            progressPoints: 0,
            progressNeeded: Math.max(1, Math.abs(points))
        };
    }

    let current = QUEST_RENOWN_TITLES[0];
    let next = null;
    for (let index = 0; index < QUEST_RENOWN_TITLES.length; index += 1) {
        const candidate = QUEST_RENOWN_TITLES[index];
        if (points >= candidate.threshold) {
            current = candidate;
            next = QUEST_RENOWN_TITLES[index + 1] || null;
        }
    }

    if (!next) {
        return {
            title: current.title,
            threshold: current.threshold,
            nextTitle: null,
            nextThreshold: null,
            progressPercent: 100,
            progressPoints: 0,
            progressNeeded: 0
        };
    }

    const span = Math.max(1, next.threshold - current.threshold);
    const progressPoints = Math.max(0, points - current.threshold);
    return {
        title: current.title,
        threshold: current.threshold,
        nextTitle: next.title,
        nextThreshold: next.threshold,
        progressPercent: Math.max(0, Math.min(100, Math.round((progressPoints / span) * 100))),
        progressPoints,
        progressNeeded: span
    };
}

function cloneState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return {
            last_completed: null,
            current_activity: null,
            active_goals: [],
            operations: []
        };
    }

    return JSON.parse(JSON.stringify({
        last_completed: state.last_completed || null,
        current_activity: state.current_activity || null,
        active_goals: Array.isArray(state.active_goals) ? state.active_goals : [],
        operations: Array.isArray(state.operations) ? state.operations : []
    }));
}

function normalizeOperation(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const allowed = new Set(['keep', 'add', 'update', 'complete', 'drop', 'update_current_activity']);
    const type = normalizeWhitespace(raw.type).toLowerCase();
    if (!allowed.has(type)) return null;

    return {
        type,
        id: normalizeWhitespace(raw.id) || null,
        reason: truncateText(raw.reason, MAX_REASON_LENGTH)
    };
}

function normalizeQuestStatus(value, fallback = 'active') {
    const status = normalizeWhitespace(value).toLowerCase();
    if (['active', 'pending', 'completed', 'failed', 'expired', 'dropped'].includes(status)) return status;
    return fallback;
}

function normalizeQuestStakes(value, fallback = 'medium') {
    const stakes = normalizeWhitespace(value).toLowerCase();
    return QUEST_STAKES.has(stakes) ? stakes : fallback;
}

function parseQuestLedgerLine(line, meta = {}) {
    const text = String(line || '').trim();
    if (!text) return null;

    const deleteMatch = text.match(/^DELETE\s+\[([a-zA-Z0-9_-]+)\]\s*$/i);
    if (deleteMatch) {
        return {
            operation: 'DELETE',
            id: deleteMatch[1].toUpperCase(),
            deleted: true,
            source: meta.source || PLUGIN_ID,
            updated_turn: asTurnNumber(meta.turn_number, meta.updated_turn || 1)
        };
    }

    const match = text.match(/^(?:(INSERT|UPDATE)\s+)?\[([a-zA-Z0-9_-]+)\]\s+\|?\s*Deadline:\s*(\d+)(?:\s*turns?)?\s*\|\s*Stakes:\s*(low|medium|high)\s*\|\s*Brief:\s*(.*?)\s*\|\s*Objective:\s*(.*?)\s*\|\s*AI:\s*(.*?)\s*\|\s*Fail:\s*(.*?)\s*\|\s*Success:\s*(.*)$/i);
    if (!match) return null;

    const updatedTurn = asTurnNumber(meta.turn_number, meta.updated_turn || 1);
    const deadlineTurns = parsePositiveInt(match[3], MIN_QUEST_DEADLINE_TURNS, MIN_QUEST_DEADLINE_TURNS, 999);
    const id = match[2].toUpperCase();
    const stakes = normalizeQuestStakes(match[4]);
    const objective = truncateText(match[6], MAX_QUEST_OBJECTIVE_LENGTH);
    const brief = truncateText(match[5], 220);
    const hiddenAi = truncateText(match[7], MAX_QUEST_DETAIL_LENGTH);
    const fail = truncateText(match[8], MAX_QUEST_DETAIL_LENGTH);
    const success = truncateText(match[9], MAX_QUEST_DETAIL_LENGTH);

    if (!id || !objective || !brief || !hiddenAi || !fail || !success) return null;

    return {
        id,
        operation: String(match[1] || 'UPSERT').toUpperCase(),
        brief,
        objective,
        stakes,
        hidden_ai_guidance: hiddenAi,
        fail_consequence: fail,
        success_consequence: success,
        deadline_turns: deadlineTurns,
        created_turn: asTurnNumber(meta.created_turn, updatedTurn),
        updated_turn: updatedTurn,
        deadline_turn: updatedTurn + deadlineTurns,
        source: meta.source || PLUGIN_ID,
        status: 'active',
        evidence: truncateText(meta.evidence || `Planner objective updated on Turn ${updatedTurn}.`, MAX_EVIDENCE_LENGTH)
    };
}

function parseQuestLedgerText(text, meta = {}) {
    const quests = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const parsed = parseQuestLedgerLine(rawLine, meta);
        if (parsed) quests.push(parsed);
    }
    return quests;
}

function normalizeQuest(rawQuest, previousQuest = null, currentTurn = 1) {
    if (!rawQuest || typeof rawQuest !== 'object' || Array.isArray(rawQuest)) return null;
    const id = normalizeWhitespace(rawQuest.id).toUpperCase();
    const objective = truncateText(rawQuest.objective || rawQuest.label, MAX_QUEST_OBJECTIVE_LENGTH);
    if (!id || !objective) return null;

    const updatedTurn = asTurnNumber(rawQuest.updated_turn, asTurnNumber(previousQuest?.updated_turn, currentTurn));
    const deadlineTurns = parsePositiveInt(
        rawQuest.deadline_turns,
        parsePositiveInt(previousQuest?.deadline_turns, MIN_QUEST_DEADLINE_TURNS, MIN_QUEST_DEADLINE_TURNS, 999),
        MIN_QUEST_DEADLINE_TURNS,
        999
    );
    const status = normalizeQuestStatus(rawQuest.status, normalizeQuestStatus(previousQuest?.status, 'active'));
    const minimumDeadlineTurn = updatedTurn + deadlineTurns;
    const deadlineTurn = Math.max(asTurnNumber(rawQuest.deadline_turn, minimumDeadlineTurn), minimumDeadlineTurn);

    return {
        id,
        brief: truncateText(rawQuest.brief || previousQuest?.brief || objective, 220),
        objective,
        stakes: normalizeQuestStakes(rawQuest.stakes, normalizeQuestStakes(previousQuest?.stakes, 'medium')),
        hidden_ai_guidance: truncateText(rawQuest.hidden_ai_guidance || previousQuest?.hidden_ai_guidance || '', MAX_QUEST_DETAIL_LENGTH),
        fail_consequence: truncateText(rawQuest.fail_consequence || previousQuest?.fail_consequence || '', MAX_QUEST_DETAIL_LENGTH),
        success_consequence: truncateText(rawQuest.success_consequence || previousQuest?.success_consequence || '', MAX_QUEST_DETAIL_LENGTH),
        deadline_turns: deadlineTurns,
        created_turn: asTurnNumber(previousQuest?.created_turn, asTurnNumber(rawQuest.created_turn, updatedTurn)),
        updated_turn: updatedTurn,
        deadline_turn: deadlineTurn,
        source: normalizeWhitespace(rawQuest.source || previousQuest?.source || PLUGIN_ID),
        status,
        evidence: truncateText(rawQuest.evidence || previousQuest?.evidence || '', MAX_EVIDENCE_LENGTH),
        outcome_evidence: truncateText(rawQuest.outcome_evidence || previousQuest?.outcome_evidence || '', MAX_EVIDENCE_LENGTH),
        outcome_turn: rawQuest.outcome_turn || previousQuest?.outcome_turn || null,
        outcome_line_number: normalizeDialogueLineNumber(rawQuest.outcome_line_number ?? rawQuest.completed_line_number ?? previousQuest?.outcome_line_number),
        outcome_line: truncateText(rawQuest.outcome_line || previousQuest?.outcome_line || '', MAX_EVIDENCE_LENGTH),
        outcome_consequence: truncateText(rawQuest.outcome_consequence || previousQuest?.outcome_consequence || '', 420),
        success_summary: truncateText(rawQuest.success_summary || previousQuest?.success_summary || '', MAX_REASON_LENGTH),
        score_modifier: clampScoreModifier(rawQuest.score_modifier ?? previousQuest?.score_modifier, rawQuest.stakes || previousQuest?.stakes || 'medium'),
        score_reason: truncateText(rawQuest.score_reason || previousQuest?.score_reason || '', MAX_REASON_LENGTH)
    };
}

function normalizeQuestEvent(rawEvent, questMap = new Map(), currentTurn = 1) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) return null;
    const id = normalizeWhitespace(rawEvent.id).toUpperCase();
    if (!id) return null;
    const status = normalizeWhitespace(rawEvent.status || rawEvent.type).toLowerCase()
        .replace(/^complete$/, 'completed')
        .replace(/^fail$/, 'failed')
        .replace(/^drop$/, 'dropped')
        .replace(/^progress$/, 'progressed');
    if (!QUEST_EVENT_STATUSES.has(status)) return null;
    const evidence = truncateText(rawEvent.evidence || rawEvent.reason, MAX_EVIDENCE_LENGTH);
    if (!hasEvidence(evidence)) return null;
    const quest = questMap.get(id);
    return {
        id,
        status,
        label: truncateText(rawEvent.label || rawEvent.objective || quest?.objective || id, MAX_LABEL_LENGTH),
        evidence,
        turn_number: asTurnNumber(rawEvent.turn_number || rawEvent.turn, currentTurn),
        outcome_line_number: normalizeDialogueLineNumber(rawEvent.outcome_line_number ?? rawEvent.completed_line_number ?? rawEvent.line_number),
        outcome_line: truncateText(rawEvent.outcome_line || rawEvent.completed_line || rawEvent.line || '', MAX_EVIDENCE_LENGTH),
        consequence: truncateText(rawEvent.consequence || getConsequenceForStatus(quest, status), 420),
        success_summary: truncateText(rawEvent.success_summary || rawEvent.resolution_summary || '', MAX_REASON_LENGTH),
        score_modifier: clampScoreModifier(rawEvent.score_modifier, quest?.stakes || 'medium'),
        score_reason: truncateText(rawEvent.score_reason || '', MAX_REASON_LENGTH),
        source: PLUGIN_ID
    };
}

function normalizeQuestEvents(rawEvents, questMap = new Map(), currentTurn = 1) {
    if (!Array.isArray(rawEvents)) return [];
    const events = [];
    const seen = new Set();
    for (const rawEvent of rawEvents) {
        const event = normalizeQuestEvent(rawEvent, questMap, currentTurn);
        if (!event) continue;
        const key = `${event.id}:${event.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
        if (events.length >= 6) break;
    }
    return events;
}

function getConsequenceForStatus(quest, status) {
    if (!quest) return '';
    if (status === 'completed') return quest.success_consequence || '';
    if (status === 'failed' || status === 'expired') return quest.fail_consequence || '';
    return '';
}

function normalizeOperations(rawOperations) {
    if (!Array.isArray(rawOperations)) return [];
    return rawOperations.map(normalizeOperation).filter(Boolean).slice(0, 8);
}

function buildOperationIndex(operations) {
    const byId = new Map();
    const byType = new Map();

    for (const operation of operations) {
        const typeList = byType.get(operation.type) || [];
        typeList.push(operation);
        byType.set(operation.type, typeList);

        if (!operation.id) continue;
        const idList = byId.get(operation.id) || [];
        idList.push(operation);
        byId.set(operation.id, idList);
    }

    return { byId, byType };
}

function hasOperation(operationIndex, id, types) {
    const wanted = Array.isArray(types) ? types : [types];
    const operations = operationIndex.byId.get(id) || [];
    return operations.some(operation => wanted.includes(operation.type) && hasEvidence(operation.reason));
}

function normalizeCompleted(rawCompleted, previousCompleted, currentTurn) {
    if (!rawCompleted || typeof rawCompleted !== 'object' || Array.isArray(rawCompleted)) {
        return previousCompleted || null;
    }

    const label = truncateText(rawCompleted.label, MAX_LABEL_LENGTH);
    if (!label) return previousCompleted || null;

    const id = normalizeWhitespace(rawCompleted.id) || slugifyId(label);
    const previousId = normalizeWhitespace(previousCompleted?.id);
    const previousLabel = normalizeWhitespace(previousCompleted?.label);
    const sameAsPrevious = previousCompleted && (id === previousId || label === previousLabel);
    const evidence = truncateText(rawCompleted.evidence, MAX_EVIDENCE_LENGTH);

    if (!sameAsPrevious && !hasEvidence(evidence)) {
        return previousCompleted || null;
    }

    return {
        id,
        label,
        evidence: evidence || truncateText(previousCompleted?.evidence, MAX_EVIDENCE_LENGTH),
        completed_turn: asTurnNumber(rawCompleted.completed_turn, asTurnNumber(previousCompleted?.completed_turn, currentTurn)),
        outcome_line_number: normalizeDialogueLineNumber(rawCompleted.outcome_line_number ?? rawCompleted.completed_line_number ?? previousCompleted?.outcome_line_number),
        outcome_line: truncateText(rawCompleted.outcome_line || rawCompleted.completed_line || previousCompleted?.outcome_line || '', MAX_EVIDENCE_LENGTH)
    };
}

function normalizeExistingGoal(rawGoal, currentTurn) {
    if (!rawGoal || typeof rawGoal !== 'object' || Array.isArray(rawGoal)) return null;
    const label = truncateText(rawGoal.label, MAX_LABEL_LENGTH);
    if (!label) return null;
    const id = normalizeWhitespace(rawGoal.id) || slugifyId(label);
    const status = normalizeWhitespace(rawGoal.status).toLowerCase() === 'pending' ? 'pending' : 'active';

    return {
        id,
        label,
        status,
        evidence: truncateText(rawGoal.evidence, MAX_EVIDENCE_LENGTH),
        created_turn: asTurnNumber(rawGoal.created_turn, currentTurn),
        updated_turn: asTurnNumber(rawGoal.updated_turn, currentTurn)
    };
}

function normalizeGoal(rawGoal, previousGoal, operationIndex, currentTurn) {
    if (!rawGoal || typeof rawGoal !== 'object' || Array.isArray(rawGoal)) return null;

    const proposedLabel = truncateText(rawGoal.label, MAX_LABEL_LENGTH);
    if (!proposedLabel) return null;

    const id = normalizeWhitespace(rawGoal.id) || previousGoal?.id || slugifyId(proposedLabel);
    const proposedEvidence = truncateText(rawGoal.evidence, MAX_EVIDENCE_LENGTH);
    const status = normalizeWhitespace(rawGoal.status).toLowerCase() === 'pending' ? 'pending' : 'active';

    if (!previousGoal) {
        if (!hasEvidence(proposedEvidence)) return null;
        return {
            id,
            label: proposedLabel,
            status,
            evidence: proposedEvidence,
            created_turn: asTurnNumber(rawGoal.created_turn, currentTurn),
            updated_turn: asTurnNumber(rawGoal.updated_turn, currentTurn)
        };
    }

    const labelChanged = normalizeWhitespace(previousGoal.label) !== proposedLabel;
    const canChangeLabel = hasEvidence(proposedEvidence) || hasOperation(operationIndex, id, ['update']);

    return {
        id: previousGoal.id || id,
        label: labelChanged && !canChangeLabel ? previousGoal.label : proposedLabel,
        status,
        evidence: proposedEvidence || previousGoal.evidence || '',
        created_turn: asTurnNumber(previousGoal.created_turn, asTurnNumber(rawGoal.created_turn, currentTurn)),
        updated_turn: labelChanged || proposedEvidence
            ? currentTurn
            : asTurnNumber(previousGoal.updated_turn, currentTurn)
    };
}

function normalizeCurrentActivity(rawActivity, previousActivity) {
    if (!rawActivity || typeof rawActivity !== 'object' || Array.isArray(rawActivity)) {
        return previousActivity || null;
    }

    const label = truncateText(rawActivity.label, MAX_LABEL_LENGTH);
    if (!label) return previousActivity || null;

    const evidence = truncateText(rawActivity.evidence, MAX_EVIDENCE_LENGTH);
    const previousLabel = normalizeWhitespace(previousActivity?.label);
    if (previousLabel && previousLabel !== label && !hasEvidence(evidence)) {
        return previousActivity;
    }

    return {
        label,
        evidence: evidence || truncateText(previousActivity?.evidence, MAX_EVIDENCE_LENGTH)
    };
}

function normalizeObjectiveState(rawState, previousState = null, options = {}) {
    const currentTurn = asTurnNumber(options.currentTurn, 1);
    const maxActiveGoals = parsePositiveInt(options.maxActiveGoals, DEFAULT_MAX_ACTIVE_GOALS, 1, 6);
    const previous = cloneState(previousState);

    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return previous;
    }

    const operations = normalizeOperations(rawState.operations);
    const operationIndex = buildOperationIndex(operations);
    const previousGoals = (previous.active_goals || [])
        .map(goal => normalizeExistingGoal(goal, currentTurn))
        .filter(Boolean);
    const previousGoalMap = new Map(previousGoals.map(goal => [goal.id, goal]));

    const rawGoals = Array.isArray(rawState.active_goals) ? rawState.active_goals : [];
    const nextGoals = [];
    const seenGoalIds = new Set();
    let addedGoals = 0;

    for (const rawGoal of rawGoals) {
        const proposedId = normalizeWhitespace(rawGoal?.id) || slugifyId(rawGoal?.label);
        const previousGoal = previousGoalMap.get(proposedId);

        if (!previousGoal && addedGoals >= 1) continue;

        const normalized = normalizeGoal(rawGoal, previousGoal, operationIndex, currentTurn);
        if (!normalized || seenGoalIds.has(normalized.id)) continue;

        if (!previousGoal) addedGoals += 1;
        seenGoalIds.add(normalized.id);
        nextGoals.push(normalized);
    }

    const rawCompleted = normalizeCompleted(rawState.last_completed, previous.last_completed, currentTurn);
    const completedId = normalizeWhitespace(rawCompleted?.id);

    for (const previousGoal of previousGoals) {
        if (seenGoalIds.has(previousGoal.id)) continue;
        const explicitlyCompleted = completedId && previousGoal.id === completedId && hasEvidence(rawCompleted?.evidence);
        const explicitlyDropped = hasOperation(operationIndex, previousGoal.id, ['drop']);
        if (explicitlyCompleted || explicitlyDropped) continue;
        seenGoalIds.add(previousGoal.id);
        nextGoals.push(previousGoal);
    }

    return {
        last_completed: rawCompleted,
        current_activity: normalizeCurrentActivity(rawState.current_activity, previous.current_activity),
        active_goals: nextGoals.slice(0, maxActiveGoals),
        quest_events: normalizeQuestEvents(rawState.quest_events, options.questMap, currentTurn),
        operations
    };
}

function hasMeaningfulState(state) {
    return Boolean(
        state?.last_completed?.label ||
        state?.current_activity?.label ||
        (Array.isArray(state?.active_goals) && state.active_goals.length > 0)
    );
}

function getProcessedLines(turnContext) {
    return turnContext?.processed?.vnManager?.processedLines || [];
}

function buildNumberedScript(turnContext) {
    const processedLines = getProcessedLines(turnContext);
    if (processedLines.length > 0) {
        return processedLines
            .map((line, index) => `[Line ${index}] ${line.character || 'Narrator'}: ${line.text || line.line || ''}`)
            .join('\n');
    }

    return normalizeWhitespace(
        turnContext?.processed?.dialogueProcessor?.dialogue ||
        turnContext?.processed?.narrativeEngine?.writerResponse ||
        turnContext?.output?.fulltext ||
        ''
    );
}

function getCompressedHistory(turnContext, presetName = DEFAULT_HISTORY_PRESET) {
    const history = turnContext?.runtime?.historyData?.compressedHistory || {};
    const requested = normalizeWhitespace(presetName).toLowerCase() || DEFAULT_HISTORY_PRESET;
    return history[requested] || history[DEFAULT_HISTORY_PRESET] || history.brief || 'No prior story history available.';
}

function buildPrompt({
    previousState,
    canonicalQuests,
    compressedHistory,
    currentUserPrompt,
    currentScript,
    maxActiveGoals
}) {
    const promptPath = path.join(__dirname, 'prompts', 'objective_tracker_prompt.txt');
    const privateReasoningPath = path.join(__dirname, 'prompts', 'objective_tracker_private_reasoning.txt');
    const template = fs.readFileSync(promptPath, 'utf8');
    const privateReasoningDirective = fs.readFileSync(privateReasoningPath, 'utf8').trim();
    return template
        .replace('${previous_state_json}', JSON.stringify(previousState || null, null, 2))
        .replace('${canonical_quests_json}', JSON.stringify(canonicalQuests || [], null, 2))
        .replace('${compressed_history}', compressedHistory || 'No prior story history available.')
        .replace('${current_user_prompt}', currentUserPrompt || 'No direct player input available.')
        .replace('${current_script}', currentScript || 'No current chapter text available.')
        .replace('${private_reasoning_directive}', privateReasoningDirective)
        .replaceAll('${max_active_goals}', String(maxActiveGoals || DEFAULT_MAX_ACTIVE_GOALS));
}

async function getLedgerRowsForSource(turnContext, tools, source, targetTurn = null) {
    const projectName = turnContext?.projectName || tools?.turnContext?.projectName;
    const maxTurn = asTurnNumber(targetTurn, asTurnNumber(turnContext?.turnNumber || tools?.turnContext?.turnNumber, 1));
    if (!projectName || !tools?.db?.chat?.query) return [];

    try {
        return await tools.db.chat.query(
            `SELECT f.target, f.fact_value, f.turn_number, f.context, f.source
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
            [projectName.toLowerCase(), source, maxTurn, maxTurn]
        );
    } catch {
        return [];
    }
}

function parseQuestRows(rows, source) {
    return (rows || [])
        .map(row => parseQuestLedgerLine(`[${row.target}] ${row.fact_value}`, {
            source: source || row.source || PLUGIN_ID,
            turn_number: row.turn_number
        }))
        .filter(Boolean);
}

async function getCanonicalQuestEntries(turnContext, tools, options = {}) {
    const targetTurn = options.turnNumber || turnContext?.turnNumber || tools?.turnContext?.turnNumber || 1;
    const canonicalRows = await getLedgerRowsForSource(turnContext, tools, PLUGIN_ID, targetTurn);
    const byId = new Map();

    for (const quest of parseQuestRows(canonicalRows, PLUGIN_ID)) {
        byId.set(quest.id, quest);
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function getStoredQuestRegistry(turnContext, tools, options = {}) {
    const projectName = turnContext?.projectName || tools?.turnContext?.projectName;
    const targetTurn = asTurnNumber(options.turnNumber, asTurnNumber(turnContext?.turnNumber || tools?.turnContext?.turnNumber, 1));
    if (!projectName || !tools?.db?.chat?.query) return [];

    try {
        const rows = await tools.db.chat.query(
            `SELECT fact_value
             FROM facts
             WHERE project_name = ?
               AND source = ?
               AND predicate = ?
               AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC
             LIMIT 1`,
            [projectName.toLowerCase(), PLUGIN_ID, 'quest_registry', targetTurn]
        );
        if (!rows?.[0]?.fact_value) return [];
        const parsed = JSON.parse(rows[0].fact_value);
        return Array.isArray(parsed) ? parsed.map(quest => normalizeQuest(quest, null, targetTurn)).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function mergeQuestRegistry(canonicalQuests, previousRegistry, objectiveState, currentTurn) {
    const previousById = new Map((previousRegistry || []).map(quest => [quest.id, quest]));
    const registryById = new Map();
    const events = [];

    for (const canonical of canonicalQuests || []) {
        const previous = previousById.get(canonical.id);
        const merged = normalizeQuest({
            ...canonical,
            status: previous && RESOLVED_QUEST_STATUSES.has(previous.status) ? previous.status : canonical.status,
            outcome_evidence: previous?.outcome_evidence,
            outcome_turn: previous?.outcome_turn,
            outcome_line_number: previous?.outcome_line_number,
            outcome_line: previous?.outcome_line,
            outcome_consequence: previous?.outcome_consequence,
            success_summary: previous?.success_summary,
            score_modifier: previous?.score_modifier,
            score_reason: previous?.score_reason
        }, previous, currentTurn);
        if (merged) registryById.set(merged.id, merged);
    }

    const questMap = new Map(registryById);
    const rawEvents = normalizeQuestEvents(objectiveState?.quest_events, questMap, currentTurn);
    const completedId = normalizeWhitespace(objectiveState?.last_completed?.id).toUpperCase();
    if (completedId && questMap.has(completedId) && hasEvidence(objectiveState?.last_completed?.evidence)) {
        rawEvents.push({
            id: completedId,
            status: 'completed',
            label: objectiveState.last_completed.label,
            evidence: objectiveState.last_completed.evidence,
            turn_number: asTurnNumber(objectiveState.last_completed.completed_turn, currentTurn),
            outcome_line_number: normalizeDialogueLineNumber(objectiveState.last_completed.outcome_line_number ?? objectiveState.last_completed.completed_line_number),
            outcome_line: objectiveState.last_completed.outcome_line || objectiveState.last_completed.completed_line || '',
            consequence: getConsequenceForStatus(questMap.get(completedId), 'completed'),
            source: PLUGIN_ID
        });
    }

    for (const event of rawEvents) {
        const quest = registryById.get(event.id);
        if (!quest || RESOLVED_QUEST_STATUSES.has(quest.status)) continue;
        const nextQuest = normalizeQuest({
            ...quest,
            status: event.status === 'progressed' ? quest.status : event.status,
            evidence: event.status === 'progressed' ? event.evidence : quest.evidence,
            outcome_evidence: event.status === 'progressed' ? quest.outcome_evidence : event.evidence,
            outcome_turn: event.status === 'progressed' ? quest.outcome_turn : event.turn_number,
            outcome_line_number: event.status === 'progressed' ? quest.outcome_line_number : event.outcome_line_number,
            outcome_line: event.status === 'progressed' ? quest.outcome_line : event.outcome_line,
            outcome_consequence: event.status === 'progressed' ? quest.outcome_consequence : event.consequence,
            success_summary: event.status === 'progressed' ? quest.success_summary : event.success_summary,
            score_modifier: event.status === 'progressed' ? quest.score_modifier : event.score_modifier,
            score_reason: event.status === 'progressed' ? quest.score_reason : event.score_reason
        }, quest, currentTurn);
        registryById.set(event.id, nextQuest);
        if (RESOLVED_QUEST_STATUSES.has(event.status)) events.push(event);
    }

    for (const quest of registryById.values()) {
        if (RESOLVED_QUEST_STATUSES.has(quest.status)) continue;
        if (Number.isFinite(Number(quest.deadline_turn)) && currentTurn > Number(quest.deadline_turn)) {
            const expiredEvent = {
                id: quest.id,
                status: 'expired',
                label: quest.objective,
                evidence: `Turn ${currentTurn}: deadline passed after Turn ${quest.deadline_turn}.`,
                turn_number: currentTurn,
                outcome_line_number: 0,
                outcome_line: 'Deadline expired before the chapter began.',
                consequence: quest.fail_consequence || '',
                score_modifier: 0,
                score_reason: 'The quest expired after its deadline.',
                source: PLUGIN_ID
            };
            registryById.set(quest.id, normalizeQuest({
                ...quest,
                status: 'expired',
                outcome_evidence: expiredEvent.evidence,
                outcome_turn: currentTurn,
                outcome_line_number: expiredEvent.outcome_line_number,
                outcome_line: expiredEvent.outcome_line,
                outcome_consequence: expiredEvent.consequence,
                success_summary: '',
                score_modifier: expiredEvent.score_modifier,
                score_reason: expiredEvent.score_reason
            }, quest, currentTurn));
            events.push(expiredEvent);
        }
    }

    return {
        registry: Array.from(registryById.values()).sort((a, b) => a.id.localeCompare(b.id)),
        events
    };
}

async function persistQuestRegistry(turnContext, tools, registry, events = []) {
    const stateBucket = tools.pluginState.turn();
    stateBucket.questRegistry = registry;
    stateBucket.questEvents = events;

    if (!tools?.facts?.appendToFactsDb) return;

    await tools.facts.cleanUpFactsDb({
        source: PLUGIN_ID,
        predicates: ['quest_registry', 'quest_progress_event']
    });

    await tools.facts.appendToFactsDb({
        source: PLUGIN_ID,
        target: 'party',
        predicate: 'quest_registry',
        fact_value: JSON.stringify(registry),
        context: 'quest_tracker_registry'
    }, { turn_number: turnContext.turnNumber });

    for (const event of events) {
        await tools.facts.appendToFactsDb({
            source: PLUGIN_ID,
            target: event.id,
            predicate: 'quest_progress_event',
            fact_value: JSON.stringify(event),
            context: event.status
        }, { turn_number: event.turn_number || turnContext.turnNumber });
    }
}

async function getQuestRegistryForContext(turnContext, tools, options = {}) {
    const currentTurn = asTurnNumber(options.turnNumber, asTurnNumber(turnContext?.turnNumber || tools?.turnContext?.turnNumber, 1));
    const stored = await getStoredQuestRegistry(turnContext, tools, { turnNumber: currentTurn });
    const canonical = await getCanonicalQuestEntries(turnContext, tools, { turnNumber: currentTurn });
    const merged = mergeQuestRegistry(canonical, stored, null, currentTurn);
    return merged.registry;
}

async function refreshQuestRegistryFromCanonical(turnContext, tools, options = {}) {
    const currentTurn = asTurnNumber(options.turnNumber, asTurnNumber(turnContext?.turnNumber || tools?.turnContext?.turnNumber, 1));
    const previousRegistry = await getStoredQuestRegistry(turnContext, tools, { turnNumber: currentTurn });
    const canonical = await getCanonicalQuestEntries(turnContext, tools, { turnNumber: currentTurn });
    const questUpdate = mergeQuestRegistry(canonical, previousRegistry, null, currentTurn);
    await persistQuestRegistry(turnContext, tools, questUpdate.registry, questUpdate.events);
    return questUpdate;
}

function projectQuestRegistryForDialogue(registry = [], options = {}) {
    const currentTurn = asTurnNumber(options.turnNumber, 1);
    const dialogueIndex = normalizeDialogueLineNumber(options.dialogueIndex);
    const projectedRegistry = [];
    const pendingNotifications = [];

    for (const rawQuest of Array.isArray(registry) ? registry : []) {
        const quest = normalizeQuest(rawQuest, null, currentTurn);
        if (!quest) continue;

        const resolved = RESOLVED_QUEST_STATUSES.has(quest.status);
        const outcomeTurn = asTurnNumber(quest.outcome_turn, asTurnNumber(quest.updated_turn, currentTurn));
        const outcomeLine = normalizeDialogueLineNumber(quest.outcome_line_number);
        const isCurrentTurnOutcome = resolved && outcomeTurn === currentTurn;
        const hasLineGate = isCurrentTurnOutcome && outcomeLine !== null;
        const reachedLine = hasLineGate && dialogueIndex !== null && dialogueIndex >= outcomeLine;

        if (hasLineGate && !reachedLine) {
            projectedRegistry.push({
                ...quest,
                status: 'active',
                display_pending_resolution: true,
                pending_status: quest.status,
                pending_outcome_line_number: outcomeLine
            });
            continue;
        }

        projectedRegistry.push(quest);
        if (resolved && hasLineGate && dialogueIndex === outcomeLine) {
            pendingNotifications.push({
                id: quest.id,
                status: quest.status,
                label: quest.objective || quest.brief || quest.id,
                turnNumber: outcomeTurn,
                outcomeLineNumber: outcomeLine,
                outcomeLine: quest.outcome_line || '',
                message: quest.status === 'completed'
                    ? (quest.success_summary || quest.outcome_evidence || quest.brief || '')
                    : (quest.outcome_consequence || quest.outcome_evidence || quest.brief || ''),
                stakes: quest.stakes
            });
        }
    }

    return {
        registry: projectedRegistry.sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''))),
        pendingNotifications
    };
}

function projectObjectiveStateForDialogue(objectiveState, options = {}) {
    const state = cloneState(objectiveState);
    if (!state?.last_completed) return state;

    const currentTurn = asTurnNumber(options.turnNumber, 1);
    const dialogueIndex = normalizeDialogueLineNumber(options.dialogueIndex);
    const completedTurn = asTurnNumber(state.last_completed.completed_turn, currentTurn);
    const completedLine = normalizeDialogueLineNumber(state.last_completed.outcome_line_number ?? state.last_completed.completed_line_number);

    if (completedTurn === currentTurn && completedLine !== null && (dialogueIndex === null || dialogueIndex < completedLine)) {
        state.last_completed = null;
    }

    return state;
}

function getQuestNotificationTitle(status) {
    switch (normalizeQuestStatus(status, 'completed')) {
        case 'completed': return 'Quest Complete';
        case 'failed': return 'Quest Failed';
        case 'expired': return 'Quest Expired';
        case 'dropped': return 'Quest Dropped';
        default: return 'Quest Updated';
    }
}

function getQuestNotificationMessage(quest) {
    if (!quest || typeof quest !== 'object') return '';
    if (quest.status === 'completed') {
        return truncateText(quest.success_summary || quest.outcome_evidence || quest.brief || '', MAX_EVIDENCE_LENGTH);
    }
    return truncateText(quest.outcome_consequence || quest.outcome_evidence || quest.brief || '', MAX_EVIDENCE_LENGTH);
}

function buildQuestNotificationPayloads(registry = [], options = {}) {
    const currentTurn = asTurnNumber(options.turnNumber, 1);
    const rawDurationMs = Number(options.durationMs ?? 4200);
    const durationMs = Number.isFinite(rawDurationMs) ? clampNumber(rawDurationMs, 1500, 12000) : 4200;
    const sfx = normalizeWhitespace(options.sfx || 'success_jingle.wav');
    const payloads = [];

    for (const rawQuest of Array.isArray(registry) ? registry : []) {
        const quest = normalizeQuest(rawQuest, null, currentTurn);
        if (!quest || !RESOLVED_QUEST_STATUSES.has(quest.status)) continue;

        const outcomeTurn = asTurnNumber(quest.outcome_turn, asTurnNumber(quest.updated_turn, currentTurn));
        if (outcomeTurn !== currentTurn) continue;

        const outcomeLine = normalizeDialogueLineNumber(quest.outcome_line_number);
        const line = outcomeLine === null ? 0 : outcomeLine;
        const status = normalizeQuestStatus(quest.status, 'completed');
        const notificationId = [
            'quest_notification',
            currentTurn,
            slugifyId(quest.id || quest.objective || 'quest'),
            status,
            line
        ].join('_');

        payloads.push({
            notificationId,
            questId: quest.id,
            status,
            title: getQuestNotificationTitle(status),
            label: truncateText(quest.objective || quest.brief || quest.id || 'Story quest', MAX_LABEL_LENGTH),
            message: getQuestNotificationMessage(quest),
            stakes: quest.stakes,
            turnNumber: currentTurn,
            outcomeLineNumber: outcomeLine,
            outcomeLine: quest.outcome_line || '',
            durationMs,
            sfx
        });
    }

    return payloads;
}

function hasQuestNotificationDescriptor(turnContext, interceptId) {
    const descriptors = Array.isArray(turnContext?.output?.guiIntercepts) ? turnContext.output.guiIntercepts : [];
    return descriptors.some(descriptor => descriptor?.interceptId === interceptId || descriptor?.id === interceptId);
}

function registerQuestNotificationIntercepts(turnContext, tools, registry = [], settings = {}) {
    if (settings.quest_notifications_enabled === false) return [];
    if (!tools?.gui?.registerPersistentIntercept) return [];

    const currentTurn = asTurnNumber(turnContext?.turnNumber, 1);
    const payloads = buildQuestNotificationPayloads(registry, {
        turnNumber: currentTurn,
        durationMs: settings.quest_notification_duration_ms,
        sfx: settings.quest_notification_sfx
    });
    const registered = [];

    for (const payload of payloads) {
        const outcomeLine = normalizeDialogueLineNumber(payload.outcomeLineNumber);
        const checkpoint = outcomeLine === null || outcomeLine === 0
            ? 'before_first_dialogue'
            : 'on_dialogue_enter';
        const descriptor = {
            interceptId: payload.notificationId,
            debugLabel: 'QuestNotification',
            checkpoint,
            renderer: 'pixi',
            blocking: false,
            preserveOnDialogueEnter: true,
            replayPolicy: 'every_enter',
            priority: 62,
            autoDismiss: true,
            durationMs: payload.durationMs + 600,
            keepVNViewportDuringTakeover: true,
            keepVNChrome: true,
            visualState: {
                keepVNViewportDuringTakeover: true
            },
            timeoutMs: Math.max(5000, payload.durationMs + 2500),
            payload,
            handlerRef: `guiIntercepts.${QUEST_NOTIFICATION_INTERCEPT_ID}`
        };
        if (checkpoint === 'on_dialogue_enter') {
            descriptor.dialogueIndex = outcomeLine;
            descriptor.line = outcomeLine;
        } else {
            descriptor.line = 0;
        }

        if (hasQuestNotificationDescriptor(turnContext, descriptor.interceptId)) continue;
        registered.push(tools.gui.registerPersistentIntercept(descriptor));
    }

    if (registered.length > 0) {
        tools?.logger?.runtime?.(`[QuestTracker] Registered ${registered.length} Pixi quest notification intercept(s).`);
    }
    return registered;
}

async function buildQuestNotificationIntercept(_context, _tools, descriptor = {}) {
    const jsPath = path.join(__dirname, 'pixi_quest_notification.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    return {
        renderer: 'pixi',
        autoDismiss: true,
        durationMs: Number.isFinite(Number(descriptor?.durationMs)) ? Number(descriptor.durationMs) : null,
        visualState: {
            keepVNViewportDuringTakeover: true
        },
        payload: descriptor?.payload || {},
        js
    };
}

async function getQuestProgressEvents(turnContext, tools, options = {}) {
    const projectName = turnContext?.projectName || tools?.turnContext?.projectName;
    const currentTurn = asTurnNumber(options.turnNumber, asTurnNumber(turnContext?.turnNumber || tools?.turnContext?.turnNumber, 1));
    const maxTurn = options.includeCurrent === true ? currentTurn : Math.max(0, currentTurn - 1);
    const limit = parsePositiveInt(options.limit, 8, 1, 30);
    if (!projectName || !tools?.db?.chat?.query || maxTurn < 1) return [];

    try {
        const params = [projectName.toLowerCase(), PLUGIN_ID, 'quest_progress_event', maxTurn];
        let minTurnClause = '';
        if (options.maxAgeTurns !== undefined && options.maxAgeTurns !== null) {
            const maxAgeTurns = parsePositiveInt(options.maxAgeTurns, DEFAULT_QUEST_OUTCOME_WINDOW_TURNS, 1, 30);
            minTurnClause = '\n               AND turn_number >= ?';
            params.push(Math.max(1, currentTurn - maxAgeTurns));
        }
        params.push(limit);

        const rows = await tools.db.chat.query(
            `SELECT target, fact_value, turn_number, context
             FROM facts
             WHERE project_name = ?
               AND source = ?
               AND predicate = ?
               AND turn_number <= ?${minTurnClause}
             ORDER BY turn_number DESC, id DESC
             LIMIT ?`,
            params
        );
        return (rows || [])
            .map(row => {
                try {
                    const parsed = JSON.parse(row.fact_value);
                    return normalizeQuestEvent({
                        ...parsed,
                        id: parsed.id || row.target,
                        status: parsed.status || row.context,
                        turn_number: parsed.turn_number || row.turn_number
                    }, new Map(), row.turn_number);
                } catch {
                    return null;
                }
            })
            .filter(event => event && RESOLVED_QUEST_STATUSES.has(event.status))
            .reverse();
    } catch {
        return [];
    }
}

function getQuestOutcomeVerb(status) {
    switch (normalizeQuestStatus(status, 'completed')) {
        case 'completed':
            return 'succeeded at';
        case 'expired':
            return 'failed by missing the deadline for';
        case 'failed':
            return 'failed';
        case 'dropped':
            return 'dropped';
        default:
            return 'resolved';
    }
}

async function getQuestProgressBrief(turnContext, tools, options = {}) {
    const windowTurns = parsePositiveInt(options.maxAgeTurns, DEFAULT_QUEST_OUTCOME_WINDOW_TURNS, 1, 30);
    const events = await getQuestProgressEvents(turnContext, tools, {
        ...options,
        maxAgeTurns: windowTurns
    });
    if (events.length === 0) return '';

    const lines = [
        '### QUEST OUTCOME CONSEQUENCES - HIGH PRIORITY',
        `For ${windowTurns} chapters after resolution, these quest outcomes are mandatory canon pressure. Do not ignore, reverse, or casually soften them unless newer canon directly contradicts them.`
    ];

    for (const event of events) {
        const status = event.status.toUpperCase();
        const label = event.label || event.id;
        const throughTurn = event.turn_number + windowTurns;
        lines.push(`- On chapter ${event.turn_number}, the player/party ${getQuestOutcomeVerb(event.status)} "${label}" [${status}]. Keep this pressure through chapter ${throughTurn}.`);
        lines.push(`  Evidence: ${event.evidence}`);
        if (event.consequence) lines.push(`  Apply with utmost priority: ${event.consequence}`);
    }

    return lines.join('\n');
}

async function getQuestImmediateReminderBrief(turnContext, tools, options = {}) {
    const events = await getQuestProgressEvents(turnContext, tools, {
        ...options,
        includeCurrent: false,
        maxAgeTurns: 1
    });
    if (events.length === 0) return '';

    const lines = [
        '### STORY QUEST JUST RESOLVED - ACT NOW',
        'This resolved quest outcome was detected after the previous chapter. If the next scene can plausibly show it, make the consequence visible immediately and do not let it be waved away.'
    ];

    for (const event of events) {
        const status = event.status.toUpperCase();
        const label = event.label || event.id;
        lines.push(`- On chapter ${event.turn_number}, the player/party ${getQuestOutcomeVerb(event.status)} "${label}" [${status}].`);
        if (event.consequence) lines.push(`  Immediate story pressure: ${event.consequence}`);
        lines.push(`  Evidence: ${event.evidence}`);
    }

    return lines.join('\n');
}

function getStatusLabel(status) {
    const normalized = normalizeQuestStatus(status, 'active');
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getStakesLabel(stakes) {
    const normalized = normalizeQuestStakes(stakes, 'medium');
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getTurnsLeftLabel(deadlineTurn, currentTurn) {
    const deadline = Number(deadlineTurn);
    const turn = Number(currentTurn);
    if (!Number.isFinite(deadline) || deadline <= 0) return 'No deadline';
    if (!Number.isFinite(turn) || turn <= 0) return 'Deadline set';
    const turnsLeft = deadline - turn;
    if (turnsLeft <= 0) return 'Due now';
    if (turnsLeft === 1) return '1 Turn Left';
    return `${turnsLeft} Turns Left`;
}

function getQuestScoreDetails(quest) {
    if (!quest || !RESOLVED_QUEST_STATUSES.has(quest.status)) return null;
    const stakes = normalizeQuestStakes(quest.stakes, 'medium');
    const basePoints = getQuestBaseScore(quest.status, stakes);
    const modifierPoints = clampScoreModifier(quest.score_modifier, stakes);
    const totalPoints = basePoints + modifierPoints;
    return {
        id: quest.id,
        status: quest.status,
        stakes,
        basePoints,
        modifierPoints,
        totalPoints,
        scoreReason: truncateText(
            quest.score_reason || (modifierPoints === 0 ? `${getStatusLabel(quest.status)} ${getStakesLabel(stakes).toLowerCase()}-stakes quest.` : ''),
            MAX_REASON_LENGTH
        )
    };
}

function buildQuestRenownSummary(registry = [], options = {}) {
    const currentTurn = asTurnNumber(options.turnNumber, 1);
    const quests = (Array.isArray(registry) ? registry : [])
        .map(quest => normalizeQuest(quest, null, currentTurn))
        .filter(Boolean);
    const resolved = quests
        .filter(quest => RESOLVED_QUEST_STATUSES.has(quest.status))
        .filter(quest => asTurnNumber(quest.outcome_turn || quest.updated_turn, currentTurn) <= currentTurn)
        .sort((a, b) => {
            const turnDelta = asTurnNumber(a.outcome_turn || a.updated_turn, currentTurn) - asTurnNumber(b.outcome_turn || b.updated_turn, currentTurn);
            return turnDelta || a.id.localeCompare(b.id);
        });

    const stats = {
        completed: 0,
        failed: 0,
        expired: 0,
        dropped: 0,
        highStakesCompletions: 0,
        currentSuccessStreak: 0
    };
    const scoreById = new Map();
    let totalPoints = 0;
    let streak = 0;

    for (const quest of resolved) {
        const details = getQuestScoreDetails(quest);
        if (!details) continue;
        scoreById.set(quest.id, details);
        totalPoints += details.totalPoints;

        if (quest.status === 'completed') {
            stats.completed += 1;
            streak += 1;
            if (quest.stakes === 'high') stats.highStakesCompletions += 1;
        } else {
            streak = 0;
            if (quest.status === 'failed') stats.failed += 1;
            if (quest.status === 'expired') stats.expired += 1;
            if (quest.status === 'dropped') stats.dropped += 1;
        }
    }
    stats.currentSuccessStreak = streak;

    const rank = getRenownTitle(totalPoints);
    return {
        totalPoints,
        title: rank.title,
        rankClass: slugifyId(rank.title, 'renown-rank'),
        nextTitle: rank.nextTitle,
        nextThreshold: rank.nextThreshold,
        progressPercent: rank.progressPercent,
        progressPoints: rank.progressPoints,
        progressNeeded: rank.progressNeeded,
        stats,
        scoreEntries: Array.from(scoreById.values()),
        scoreById
    };
}

function buildQuestLogModalHtml(registry = [], options = {}) {
    const quests = Array.isArray(registry) ? registry : [];
    const currentTurn = asTurnNumber(options.turnNumber, 1);
    const visibleQuests = quests.map(quest => normalizeQuest(quest, null, currentTurn)).filter(Boolean);
    const renown = buildQuestRenownSummary(visibleQuests, { turnNumber: currentTurn });
    const activeQuests = visibleQuests
        .filter(quest => quest.status === 'active' || quest.status === 'pending')
        .sort((a, b) => Number(a.deadline_turn || Number.MAX_SAFE_INTEGER) - Number(b.deadline_turn || Number.MAX_SAFE_INTEGER));
    const resolvedQuests = visibleQuests
        .filter(quest => RESOLVED_QUEST_STATUSES.has(quest.status))
        .sort((a, b) => asTurnNumber(b.outcome_turn || b.updated_turn, currentTurn) - asTurnNumber(a.outcome_turn || a.updated_turn, currentTurn));
    const scripts = `
        (function() {
            const root = document.querySelector('.quest-log-shell');
            if (!root) return;
            const input = root.querySelector('.quest-log-search');
            const filters = root.querySelectorAll('[data-quest-filter]');
            const cards = root.querySelectorAll('.quest-log-card');
            const spoilerToggle = root.querySelector('[data-quest-spoilers-toggle]');
            const spoilerBlocks = root.querySelectorAll('.quest-log-spoilers');
            const spoilerCardButtons = root.querySelectorAll('[data-quest-spoiler-card]');
            let activeFilter = 'active';
            const apply = () => {
                const term = (input?.value || '').toLowerCase();
                cards.forEach(card => {
                    const status = card.getAttribute('data-status');
                    const text = card.getAttribute('data-search').toLowerCase();
                    const statusMatch = activeFilter === 'all' || status === activeFilter;
                    card.style.display = statusMatch && text.includes(term) ? 'grid' : 'none';
                });
            };
            input?.addEventListener('input', apply);
            filters.forEach(button => button.addEventListener('click', () => {
                activeFilter = button.getAttribute('data-quest-filter') || 'all';
                filters.forEach(item => item.classList.toggle('is-active', item === button));
                apply();
            }));
            const setAllSpoilers = showing => {
                root.classList.toggle('show-engine-spoilers', showing);
                spoilerToggle?.setAttribute('aria-pressed', showing ? 'true' : 'false');
                if (spoilerToggle) spoilerToggle.textContent = showing ? 'Hide All Spoilers' : 'Show All Spoilers';
                spoilerBlocks.forEach(block => { block.hidden = !showing; });
                spoilerCardButtons.forEach(button => {
                    button.setAttribute('aria-pressed', showing ? 'true' : 'false');
                    button.textContent = showing ? 'Hide Spoilers' : 'Show Spoilers';
                });
            };
            spoilerToggle?.addEventListener('click', () => {
                setAllSpoilers(!root.classList.contains('show-engine-spoilers'));
            });
            spoilerCardButtons.forEach(button => button.addEventListener('click', () => {
                const card = button.closest('.quest-log-card');
                const block = card?.querySelector('.quest-log-spoilers');
                if (!block) return;
                const showing = block.hidden;
                block.hidden = !showing;
                button.setAttribute('aria-pressed', showing ? 'true' : 'false');
                button.textContent = showing ? 'Hide Spoilers' : 'Show Spoilers';
            }));
            setAllSpoilers(false);
            apply();
        })();
    `;
    const hasEngineSpoilers = visibleQuests.some(quest => (
        quest.hidden_ai_guidance || quest.fail_consequence || quest.success_consequence
    ));

    const renderQuestCard = quest => {
        const resolved = RESOLVED_QUEST_STATUSES.has(quest.status);
        const evidence = resolved ? (quest.outcome_evidence || quest.evidence) : quest.evidence;
        const deadlineLabel = getTurnsLeftLabel(quest.deadline_turn, currentTurn);
        const score = renown.scoreById.get(quest.id);
        const scoreClass = score?.totalPoints < 0 ? 'negative' : 'positive';
        const scoreText = score ? `${score.totalPoints >= 0 ? '+' : ''}${score.totalPoints} Renown` : '';
        const searchText = `${quest.id} ${quest.objective} ${quest.brief} ${quest.stakes} ${quest.status} ${evidence} ${score?.scoreReason || ''}`;
        const spoilerItems = [
            quest.hidden_ai_guidance ? `<p><strong>AI</strong>${escapeHtml(quest.hidden_ai_guidance)}</p>` : '',
            quest.fail_consequence ? `<p><strong>Fail</strong>${escapeHtml(quest.fail_consequence)}</p>` : '',
            quest.success_consequence ? `<p><strong>Success</strong>${escapeHtml(quest.success_consequence)}</p>` : ''
        ].filter(Boolean).join('');
        return `
            <article class="quest-log-card status-${escapeHtml(quest.status)} stakes-${escapeHtml(quest.stakes)} ${resolved ? 'is-resolved' : 'is-active'}" data-status="${escapeHtml(quest.status)}" data-search="${escapeHtml(searchText)}">
                <div class="quest-log-card-top">
                    <span class="quest-log-id">${escapeHtml(quest.id)}</span>
                    <span class="quest-log-status">${escapeHtml(getStatusLabel(quest.status))}</span>
                    <span class="quest-log-stakes">${escapeHtml(getStakesLabel(quest.stakes))} Stakes</span>
                    ${score ? `<span class="quest-log-score ${scoreClass}">${escapeHtml(scoreText)}</span>` : ''}
                </div>
                <h3>${escapeHtml(quest.objective)}</h3>
                <p>${escapeHtml(quest.brief || 'No public brief available.')}</p>
                <div class="quest-log-meta">
                    <span>Created Turn ${escapeHtml(quest.created_turn)}</span>
                    <span>Updated Turn ${escapeHtml(quest.updated_turn)}</span>
                    ${resolved ? `<span>Resolved Turn ${escapeHtml(quest.outcome_turn || quest.updated_turn)}</span>` : `<span class="quest-log-deadline">${escapeHtml(deadlineLabel)}</span>`}
                </div>
                ${quest.status === 'completed' && quest.success_summary ? `<div class="quest-log-success-summary"><strong>How it succeeded</strong>${escapeHtml(quest.success_summary)}</div>` : ''}
                ${score?.scoreReason ? `<div class="quest-log-score-reason">${escapeHtml(score.scoreReason)}</div>` : ''}
                ${resolved && quest.outcome_consequence ? `<div class="quest-log-consequence"><strong>Outcome</strong>${escapeHtml(quest.outcome_consequence)}</div>` : ''}
                ${evidence ? `<div class="quest-log-evidence">${escapeHtml(evidence)}</div>` : ''}
                ${spoilerItems ? `
                    <button type="button" class="quest-log-card-spoiler" data-quest-spoiler-card aria-pressed="false">Show Spoilers</button>
                    <div class="quest-log-spoilers" hidden>${spoilerItems}</div>
                ` : ''}
            </article>
        `;
    };

    const activeCards = activeQuests.length > 0
        ? activeQuests.map(renderQuestCard).join('')
        : '<div class="quest-log-empty">No active story quests right now.</div>';
    const resolvedCards = resolvedQuests.length > 0
        ? resolvedQuests.map(renderQuestCard).join('')
        : '<div class="quest-log-empty">No resolved story quests yet.</div>';
    const nextRankText = renown.nextTitle
        ? `${renown.progressPoints}/${renown.progressNeeded} toward ${renown.nextTitle}`
        : 'Maximum title reached';
    const totalClass = renown.totalPoints < 0 ? 'negative' : 'positive';

    return `
        <div class="quest-log-shell rank-${escapeHtml(renown.rankClass)}">
            <section class="quest-renown-hero">
                <div class="quest-renown-badge" aria-hidden="true">Q</div>
                <div class="quest-renown-copy">
                    <div class="quest-renown-kicker">Quest Renown</div>
                    <h2>${escapeHtml(renown.title)}</h2>
                    <div class="quest-renown-next">${escapeHtml(nextRankText)}</div>
                </div>
                <div class="quest-renown-score ${totalClass}">
                    <strong>${escapeHtml(renown.totalPoints)}</strong>
                    <span>Renown</span>
                </div>
            </section>
            <section class="quest-renown-stats" aria-label="Quest renown statistics">
                <span><strong>${escapeHtml(renown.stats.completed)}</strong>Completed</span>
                <span><strong>${escapeHtml(renown.stats.failed)}</strong>Failed</span>
                <span><strong>${escapeHtml(renown.stats.expired)}</strong>Expired</span>
                <span><strong>${escapeHtml(renown.stats.dropped)}</strong>Dropped</span>
                <span><strong>${escapeHtml(renown.stats.currentSuccessStreak)}</strong>Streak</span>
                <span><strong>${escapeHtml(renown.stats.highStakesCompletions)}</strong>High Wins</span>
            </section>
            <div class="quest-log-toolbar">
                <input type="text" class="quest-log-search" placeholder="Search quests, evidence, or IDs...">
                <div class="quest-log-filters" role="group" aria-label="Quest filters">
                    <button type="button" data-quest-filter="all">All</button>
                    <button type="button" class="is-active" data-quest-filter="active">Active</button>
                    <button type="button" data-quest-filter="completed">Completed</button>
                    <button type="button" data-quest-filter="failed">Failed</button>
                    <button type="button" data-quest-filter="expired">Expired</button>
                    <button type="button" data-quest-filter="dropped">Dropped</button>
                </div>
                ${hasEngineSpoilers ? `<button type="button" class="quest-log-spoiler-toggle" data-quest-spoilers-toggle aria-pressed="false">Show All Spoilers</button>` : ''}
            </div>
            ${visibleQuests.length > 0 ? `
                <section class="quest-log-section">
                    <div class="quest-log-section-title">
                        <span>Active Quests</span>
                        <em>${escapeHtml(activeQuests.length)} open</em>
                    </div>
                    <div class="quest-log-grid">${activeCards}</div>
                </section>
                <section class="quest-log-section">
                    <div class="quest-log-section-title">
                        <span>Resolved History</span>
                        <em>${escapeHtml(resolvedQuests.length)} resolved</em>
                    </div>
                    <div class="quest-log-grid">${resolvedCards}</div>
                </section>
            ` : '<div class="quest-log-empty">No story quests have been recorded yet.</div>'}
        </div>
        <script>${scripts}</script>
    `;
}

async function getPreviousObjectiveState(turnContext, tools) {
    try {
        const previousTurn = await turnContext.getPreviousChapter();
        if (previousTurn) {
            const state = tools.pluginState
                .fromContext(previousTurn)
                .forPlugin(PLUGIN_ID)
                .turn().objectiveState;
            if (state) return normalizeObjectiveState(state, null, { currentTurn: previousTurn.turnNumber });
        }
    } catch {
        // Fall through to fact lookup.
    }

    const projectName = turnContext?.projectName;
    const turnNumber = Number(turnContext?.turnNumber || 0);
    if (!projectName || !tools?.db?.chat?.query || turnNumber <= 1) return null;

    try {
        const rows = await tools.db.chat.query(
            `SELECT fact_value
             FROM facts
             WHERE project_name = ?
               AND source = ?
               AND predicate = ?
               AND turn_number < ?
             ORDER BY turn_number DESC, id DESC
             LIMIT 1`,
            [projectName.toLowerCase(), PLUGIN_ID, 'objective_state', turnNumber]
        );
        if (!rows?.[0]?.fact_value) return null;
        return normalizeObjectiveState(JSON.parse(rows[0].fact_value), null, { currentTurn: turnNumber - 1 });
    } catch {
        return null;
    }
}

async function getObjectiveStateForContext(turnContext, tools) {
    const currentTurn = Number(turnContext?.turnNumber || 1);

    try {
        const state = tools.pluginState
            .fromContext(turnContext)
            .forPlugin(PLUGIN_ID)
            .turn().objectiveState;
        if (state) return normalizeObjectiveState(state, null, { currentTurn });
    } catch {
        // Fall through to facts.
    }

    const projectName = turnContext?.projectName || tools?.turnContext?.projectName;
    if (!projectName || !tools?.db?.chat?.query) return null;

    try {
        const rows = await tools.db.chat.query(
            `SELECT fact_value
             FROM facts
             WHERE project_name = ?
               AND source = ?
               AND predicate = ?
               AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC
             LIMIT 1`,
            [projectName.toLowerCase(), PLUGIN_ID, 'objective_state', currentTurn]
        );
        if (!rows?.[0]?.fact_value) return null;
        return normalizeObjectiveState(JSON.parse(rows[0].fact_value), null, { currentTurn });
    } catch {
        return null;
    }
}

async function persistObjectiveState(turnContext, tools, objectiveState) {
    const stateBucket = tools.pluginState.turn();
    stateBucket.objectiveState = objectiveState;
    stateBucket.updatedAt = new Date().toISOString();

    if (!tools?.facts?.appendToFactsDb) return;

    await tools.facts.cleanUpFactsDb({
        source: PLUGIN_ID,
        predicates: ['objective_state']
    });

    await tools.facts.appendToFactsDb({
        source: PLUGIN_ID,
        target: 'party',
        predicate: 'objective_state',
        fact_value: JSON.stringify(objectiveState),
        context: 'quest_tracker_state'
    }, { turn_number: turnContext.turnNumber });
}

function isPlausibleRawState(data) {
    return Boolean(
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        (!data.active_goals || Array.isArray(data.active_goals))
    );
}

async function updateQuestTracker(turnContext, tools, settingsOverride = null) {
    const settings = settingsOverride || await Promise.resolve(tools.settings.getSelf());
    const maxActiveGoals = parsePositiveInt(settings.max_active_goals, DEFAULT_MAX_ACTIVE_GOALS, 1, 6);
    const historyPreset = normalizeWhitespace(settings.history_preset).toLowerCase() || DEFAULT_HISTORY_PRESET;
    const previousState = await getPreviousObjectiveState(turnContext, tools);
    const currentTurn = asTurnNumber(turnContext?.turnNumber, 1);
    const canonicalQuests = await getCanonicalQuestEntries(turnContext, tools, { turnNumber: currentTurn });
    const previousRegistry = await getStoredQuestRegistry(turnContext, tools, { turnNumber: currentTurn - 1 });
    const questMap = new Map(canonicalQuests.map(quest => [quest.id, quest]));

    const modelDef = settings.model_def || { model: 'mediumendmodel' };
    const useSharedModel = tools.llm.vnBackground?.isSelected?.(modelDef) === true;
    const prompt = buildPrompt({
        previousState,
        canonicalQuests,
        compressedHistory: useSharedModel ? 'Use SELECTED NARRATIVE HISTORY from the shared background context.' : getCompressedHistory(turnContext, historyPreset),
        currentUserPrompt: useSharedModel ? 'Use CURRENT USER INPUT from the shared background context.' : normalizeWhitespace(turnContext?.input?.userPrompt || ''),
        currentScript: useSharedModel ? 'Use CURRENT NUMBERED SCENE from the dedicated scene message above.' : buildNumberedScript(turnContext),
        maxActiveGoals
    });
    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;

    try {
        const task = {
            msg: 'Story Objective Tracker',
            params: {
                callingModule: 'Plugin:quest_tracker'
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.withSchema({ ...task, scene: 'numbered', suffix: prompt }, isPlausibleRawState)
            : await tools.llm.withSchema({
                ...task,
                messages: [{ role: 'user', content: prompt }],
                model: resolvedModelDef.model || 'mediumendmodel',
                provider: resolvedModelDef.provider
            }, isPlausibleRawState);

        const objectiveState = normalizeObjectiveState(response?.content, previousState, {
            currentTurn,
            maxActiveGoals,
            questMap
        });
        const questUpdate = mergeQuestRegistry(canonicalQuests, previousRegistry, objectiveState, currentTurn);
        objectiveState.quest_events = questUpdate.events;

        await persistObjectiveState(turnContext, tools, objectiveState);
        await persistQuestRegistry(turnContext, tools, questUpdate.registry, questUpdate.events);
        return objectiveState;
    } catch (error) {
        tools.logger?.error?.('QuestTracker', `Failed to update objective tracker: ${error.message}`);
        const fallbackState = normalizeObjectiveState(previousState, null, { currentTurn, maxActiveGoals, questMap });
        const questUpdate = mergeQuestRegistry(canonicalQuests, previousRegistry, fallbackState, currentTurn);
        fallbackState.quest_events = questUpdate.events;
        await persistObjectiveState(turnContext, tools, fallbackState);
        await persistQuestRegistry(turnContext, tools, questUpdate.registry, questUpdate.events);
        return fallbackState;
    }
}

module.exports = {
    PLUGIN_ID,
    DEFAULT_MAX_ACTIVE_GOALS,
    parseQuestLedgerLine,
    parseQuestLedgerText,
    normalizeQuest,
    normalizeQuestEvent,
    normalizeQuestEvents,
    mergeQuestRegistry,
    projectQuestRegistryForDialogue,
    projectObjectiveStateForDialogue,
    normalizeObjectiveState,
    hasMeaningfulState,
    buildPrompt,
    buildNumberedScript,
    getCompressedHistory,
    getCanonicalQuestEntries,
    getQuestRegistryForContext,
    refreshQuestRegistryFromCanonical,
    getQuestScoreDetails,
    buildQuestRenownSummary,
    getQuestProgressBrief,
    getQuestImmediateReminderBrief,
    buildQuestLogModalHtml,
    buildQuestNotificationPayloads,
    registerQuestNotificationIntercepts,
    buildQuestNotificationIntercept,
    getPreviousObjectiveState,
    getObjectiveStateForContext,
    persistObjectiveState,
    persistQuestRegistry,
    updateQuestTracker
};
