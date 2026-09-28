const fs = require('fs/promises');
const path = require('path');

const PLUGIN_ID = 'story_arc_tracker';
const ARC_STATE_PREDICATE = 'arc_state';
const DEBUG_ARTIFACT_NAME = 'arc_decision.json';

const DECISIONS = new Set(['continue', 'soft_shift', 'close_arc', 'queue_new_arc']);
const BOUNDARY_KINDS = new Set(['location', 'quest', 'relationship', 'mystery', 'time_skip', 'aftermath', 'escalation', 'respite', 'other']);
const AWKWARD_RISKS = new Set(['low', 'medium', 'high']);
const HARD_BOUNDARIES = new Set(['location', 'quest', 'time_skip', 'aftermath', 'escalation']);

const SETTINGS_SCHEMA = {
    PLUGIN_BRIEF: {
        type: 'description',
        content: 'Tracks medium-term story arcs and requests Arc Cinematics intros when a new arc opening is narratively stable.'
    },
    PLUGIN_TECHNICAL_OVERVIEW: {
        type: 'description',
        content: 'Runs a cheap post-VN classifier, persists compact arc state, and announces queued intros before Arc Cinematics prepares its playback manifest.'
    },
    PLUGIN_METRICS: {
        type: 'metrics',
        narrative_impact: 'Medium',
        immersion: 'High',
        cost: 'Low',
        latency: 'None'
    },
    enabled: {
        type: 'checkbox',
        label: 'Enabled',
        description: 'Allow automatic story arc tracking and Arc Cinematics requests.',
        default: true
    },
    model_def: {
        type: 'select',
        label: 'Arc Classifier Model',
        description: 'Cheap model used to classify completed chapters into story arcs.',
        options: 'llm-aliases',
        allowVnBackgroundModel: true,
        default: { inherit: 'vn_background' }
    },
    trigger_mode: {
        type: 'select',
        label: 'Trigger Mode',
        description: 'How readily the tracker should create new arc intros.',
        options: [
            { label: 'conservative', description: 'Fewer intros; requires clear structural boundaries.' },
            { label: 'moderate', description: 'Balanced default; uses hard boundaries and repeated soft-shift evidence.' },
            { label: 'expressive', description: 'More willing to create arcs from strong mood and theme shifts.' }
        ],
        default: 'moderate'
    },
    minimum_turns_between_intros: {
        type: 'number',
        label: 'Minimum Turns Between Intros',
        description: 'Cooldown before another automatic intro can play, except very strong hard boundaries.',
        default: 6,
        min: 1,
        max: 30
    },
    preferred_arc_turns: {
        type: 'number',
        label: 'Preferred Arc Length',
        description: 'After this many turns, the classifier is encouraged to look for natural arc boundaries.',
        default: 12,
        min: 3,
        max: 50
    },
    maximum_turns_without_arc: {
        type: 'number',
        label: 'Maximum Turns Without Arc',
        description: 'After this many turns, the tracker strongly pressures a new arc unless the intro would be awkward.',
        default: 18,
        min: 4,
        max: 80
    },
    awkward_grace_turns: {
        type: 'number',
        label: 'Awkward Grace Turns',
        description: 'How long to wait when an arc is overdue but the current scene is awkward for an intro.',
        default: 2,
        min: 0,
        max: 10
    },
    history_turns: {
        type: 'number',
        label: 'History Turns',
        description: 'How many recent chapter digests to include in the arc classifier prompt.',
        default: 10,
        min: 3,
        max: 30
    },
    force_next_arc: {
        type: 'checkbox',
        label: 'Force Next Arc',
        description: 'Debug helper: force the next completed turn to queue an arc intro.',
        default: false
    },
    dry_run: {
        type: 'checkbox',
        label: 'Dry Run',
        description: 'Log and persist decisions without calling Arc Cinematics.',
        default: false
    }
};

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 1200) {
    const text = normalizeWhitespace(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function clampInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function slugify(value, fallback = 'arc') {
    const slug = normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return slug || fallback;
}

function normalizeSettings(raw = {}) {
    const modelDef = raw.model_def && typeof raw.model_def === 'object'
        ? raw.model_def
        : { inherit: 'vn_background' };

    const triggerMode = String(raw.trigger_mode || 'moderate').trim().toLowerCase();
    return {
        enabled: raw.enabled !== false,
        model_def: modelDef,
        trigger_mode: ['conservative', 'moderate', 'expressive'].includes(triggerMode) ? triggerMode : 'moderate',
        minimum_turns_between_intros: clampInt(raw.minimum_turns_between_intros, 6, 1, 30),
        preferred_arc_turns: clampInt(raw.preferred_arc_turns, 12, 3, 50),
        maximum_turns_without_arc: clampInt(raw.maximum_turns_without_arc, 18, 4, 80),
        awkward_grace_turns: clampInt(raw.awkward_grace_turns, 2, 0, 10),
        history_turns: clampInt(raw.history_turns, 10, 3, 30),
        force_next_arc: raw.force_next_arc === true,
        dry_run: raw.dry_run === true
    };
}

function makeDefaultState(currentTurn = 1) {
    const turn = Math.max(1, parseInt(currentTurn, 10) || 1);
    return {
        schema: 'story_arc_state_v1',
        activeArc: {
            id: 'opening_arc',
            title: 'Opening Movement',
            startTurn: 1,
            mainQuestion: '',
            mood: ''
        },
        lastIntroTurn: null,
        pendingIntro: null,
        pendingPressure: null,
        softShiftStreak: 0,
        turnsSinceLastArc: Math.max(0, turn - 1),
        recentBoundaryEvidence: [],
        lastDecision: null,
        updatedTurn: turn
    };
}

function normalizeArc(rawArc = {}, fallbackTurn = 1) {
    const startTurn = clampInt(rawArc.startTurn ?? rawArc.start_turn, fallbackTurn, 1, 999999);
    const title = truncateText(rawArc.title || 'Opening Movement', 80);
    const id = slugify(rawArc.id || rawArc.arcId || title, 'opening_arc');
    return {
        id,
        title,
        startTurn,
        mainQuestion: truncateText(rawArc.mainQuestion || rawArc.main_question || '', 220),
        mood: truncateText(rawArc.mood || '', 80)
    };
}

function normalizePendingIntro(raw = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const arcId = slugify(raw.arcId || raw.arc_id || raw.id, '');
    const title = truncateText(raw.title || '', 96);
    if (!arcId || !title) return null;
    const targetTurn = clampInt(raw.targetTurn ?? raw.target_turn, 1, 1, 999999);
    const range = raw.range && typeof raw.range === 'object' ? {
        startTurn: clampInt(raw.range.startTurn ?? raw.range.start_turn, 1, 1, 999999),
        endTurn: clampInt(raw.range.endTurn ?? raw.range.end_turn, targetTurn - 1, 1, 999999)
    } : null;
    return {
        arcId,
        title,
        subtitle: truncateText(raw.subtitle || '', 120),
        reason: truncateText(raw.reason || '', 260),
        mood: truncateText(raw.mood || '', 80),
        styleHint: truncateText(raw.styleHint || raw.style_hint || '', 160),
        range,
        arcRangeLabel: truncateText(raw.arcRangeLabel || raw.arc_range_label || '', 80),
        preferCg: raw.preferCg !== false,
        targetTurn,
        queuedAtTurn: clampInt(raw.queuedAtTurn ?? raw.queued_at_turn, Math.max(1, targetTurn - 1), 1, 999999)
    };
}

function normalizeState(rawState = null, currentTurn = 1) {
    const fallback = makeDefaultState(currentTurn);
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return fallback;
    const activeArc = normalizeArc(rawState.activeArc || rawState.active_arc || fallback.activeArc, fallback.activeArc.startTurn);
    const updatedTurn = clampInt(rawState.updatedTurn ?? rawState.updated_turn, currentTurn, 1, 999999);
    return {
        schema: 'story_arc_state_v1',
        activeArc,
        lastIntroTurn: Number.isInteger(rawState.lastIntroTurn) ? rawState.lastIntroTurn : (
            Number.isInteger(rawState.last_intro_turn) ? rawState.last_intro_turn : null
        ),
        pendingIntro: normalizePendingIntro(rawState.pendingIntro || rawState.pending_intro || null),
        pendingPressure: normalizePendingPressure(rawState.pendingPressure || rawState.pending_pressure || null),
        softShiftStreak: clampInt(rawState.softShiftStreak ?? rawState.soft_shift_streak, 0, 0, 99),
        turnsSinceLastArc: Math.max(0, currentTurn - activeArc.startTurn),
        recentBoundaryEvidence: normalizeEvidenceList(rawState.recentBoundaryEvidence || rawState.recent_boundary_evidence || []),
        lastDecision: rawState.lastDecision && typeof rawState.lastDecision === 'object' ? rawState.lastDecision : null,
        updatedTurn
    };
}

function normalizePendingPressure(raw = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
        sinceTurn: clampInt(raw.sinceTurn ?? raw.since_turn, 1, 1, 999999),
        reason: truncateText(raw.reason || '', 220),
        awkwardDeferrals: clampInt(raw.awkwardDeferrals ?? raw.awkward_deferrals, 0, 0, 99)
    };
}

function normalizeEvidenceList(value) {
    const list = Array.isArray(value) ? value : [];
    return list
        .map(item => truncateText(typeof item === 'string' ? item : item?.text || item?.reason || '', 180))
        .filter(Boolean)
        .slice(-8);
}

function extractClassificationPayload(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    if (typeof raw.decision === 'string') return raw;

    const wrapperKeys = ['content', 'result', 'classification', 'arc_decision', 'arcDecision', 'data'];
    for (const key of wrapperKeys) {
        const nested = raw[key];
        if (nested && typeof nested === 'object' && !Array.isArray(nested) && typeof nested.decision === 'string') {
            return nested;
        }
    }

    return raw;
}

function normalizeClassification(raw = {}) {
    const payload = extractClassificationPayload(raw);
    const decision = String(payload?.decision || 'continue').trim().toLowerCase();
    const boundaryKind = String(payload?.boundary_kind || payload?.boundaryKind || 'other').trim().toLowerCase();
    const awkwardRisk = String(payload?.awkward_intro_risk || payload?.awkwardIntroRisk || 'low').trim().toLowerCase();
    return {
        decision: DECISIONS.has(decision) ? decision : 'continue',
        confidence: clampNumber(payload?.confidence, 0, 0, 1),
        arc_title: truncateText(payload?.arc_title || payload?.arcTitle || '', 96),
        arc_id: slugify(payload?.arc_id || payload?.arcId || payload?.arc_title || payload?.arcTitle || '', ''),
        subtitle: truncateText(payload?.subtitle || '', 120),
        mood: truncateText(payload?.mood || '', 80),
        style_hint: truncateText(payload?.style_hint || payload?.styleHint || '', 160),
        boundary_kind: BOUNDARY_KINDS.has(boundaryKind) ? boundaryKind : 'other',
        reason: truncateText(payload?.reason || '', 260),
        awkward_intro_risk: AWKWARD_RISKS.has(awkwardRisk) ? awkwardRisk : 'low'
    };
}

function isPlausibleClassification(data) {
    return typeof extractClassificationPayload(data).decision === 'string';
}

function getModePolicy(triggerMode) {
    if (triggerMode === 'conservative') {
        return { confidenceThreshold: 0.78, hardBoundaryThreshold: 0.86, softShiftLimit: 3 };
    }
    if (triggerMode === 'expressive') {
        return { confidenceThreshold: 0.58, hardBoundaryThreshold: 0.78, softShiftLimit: 2 };
    }
    return { confidenceThreshold: 0.68, hardBoundaryThreshold: 0.82, softShiftLimit: 2 };
}

function hasArcCinematicRequest(turnContext) {
    return !!turnContext?.runtime?.plugins?.arc_cinematics?.request;
}

function buildPressurePolicy(state, settings, currentTurn) {
    const age = Math.max(0, currentTurn - (state.activeArc?.startTurn || currentTurn) + 1);
    const sinceIntroBase = state.lastIntroTurn || state.activeArc?.startTurn || currentTurn;
    const turnsSinceIntro = Math.max(0, currentTurn - sinceIntroBase);
    const beforeMinimum = turnsSinceIntro < settings.minimum_turns_between_intros;
    const afterPreferred = age >= settings.preferred_arc_turns;
    const afterMaximum = age >= settings.maximum_turns_without_arc;
    const pendingPressureAge = state.pendingPressure ? Math.max(0, currentTurn - state.pendingPressure.sinceTurn) : 0;
    const awkwardGraceExpired = state.pendingPressure
        ? pendingPressureAge >= settings.awkward_grace_turns
        : settings.awkward_grace_turns <= 0;

    return {
        age,
        turnsSinceIntro,
        beforeMinimum,
        afterPreferred,
        afterMaximum,
        pendingPressureAge,
        awkwardGraceExpired,
        text: [
            `ActiveArcAge=${age}`,
            `TurnsSinceLastIntro=${turnsSinceIntro}`,
            `MinimumTurnsBetweenIntros=${settings.minimum_turns_between_intros}`,
            `PreferredArcTurns=${settings.preferred_arc_turns}`,
            `MaximumTurnsWithoutArc=${settings.maximum_turns_without_arc}`,
            `AwkwardGraceTurns=${settings.awkward_grace_turns}`,
            beforeMinimum ? 'Pressure: below minimum; only unmistakable hard boundaries may queue.' : '',
            afterPreferred ? 'Pressure: preferred length reached; actively look for natural arc boundaries.' : '',
            afterMaximum ? 'Pressure: maximum length reached; queue a new arc unless the intro would be awkward.' : '',
            state.pendingPressure ? `PendingAwkwardPressureAge=${pendingPressureAge}` : ''
        ].filter(Boolean).join('\n')
    };
}

function buildQueuedIntro(state, classification, currentTurn) {
    const title = classification.arc_title || titleFromBoundary(classification.boundary_kind, currentTurn + 1);
    const arcId = classification.arc_id || slugify(title, `arc_${currentTurn + 1}`);
    const startTurn = Math.max(1, state.activeArc?.startTurn || 1);
    const endTurn = Math.max(startTurn, currentTurn);
    return {
        arcId,
        title,
        subtitle: classification.subtitle,
        reason: classification.reason || `Story Arc Tracker detected a ${classification.boundary_kind} boundary.`,
        mood: classification.mood,
        styleHint: classification.style_hint,
        range: { startTurn, endTurn },
        arcRangeLabel: `Turns ${startTurn}-${endTurn}`,
        preferCg: true,
        targetTurn: currentTurn + 1,
        queuedAtTurn: currentTurn
    };
}

function titleFromBoundary(boundaryKind, turnNumber) {
    const labels = {
        location: 'The Road Opens',
        quest: 'A New Charge',
        relationship: 'Changed Hearts',
        mystery: 'The Hidden Thread',
        time_skip: 'After the Turning',
        aftermath: 'After the Storm',
        escalation: 'The Pressure Rises',
        respite: 'A Quiet Movement',
        other: `Arc ${turnNumber}`
    };
    return labels[boundaryKind] || labels.other;
}

function shouldForceQueue(settings) {
    return settings.force_next_arc === true;
}

function isHardBoundary(classification) {
    return HARD_BOUNDARIES.has(classification.boundary_kind)
        && ['queue_new_arc', 'close_arc'].includes(classification.decision);
}

function getProposedArcId(classification, currentTurn) {
    const title = classification.arc_title || titleFromBoundary(classification.boundary_kind, currentTurn + 1);
    return classification.arc_id || slugify(title, `arc_${currentTurn + 1}`);
}

function applyArcDecision(previousState, rawClassification, settings, currentTurn) {
    const state = normalizeState(previousState, currentTurn);
    const classification = normalizeClassification(rawClassification);
    const policy = getModePolicy(settings.trigger_mode);
    const pressure = buildPressurePolicy(state, settings, currentTurn);
    const hardBoundary = isHardBoundary(classification);
    const confident = classification.confidence >= policy.confidenceThreshold;
    const hardConfident = classification.confidence >= policy.hardBoundaryThreshold;
    const nextSoftShiftStreak = classification.decision === 'soft_shift'
        ? state.softShiftStreak + 1
        : (classification.decision === 'continue' ? 0 : state.softShiftStreak);

    let shouldQueue = false;
    let queueReason = '';
    let pendingPressure = state.pendingPressure;

    if (shouldForceQueue(settings)) {
        shouldQueue = true;
        queueReason = 'force_next_arc';
    } else if (pressure.beforeMinimum) {
        shouldQueue = hardBoundary && hardConfident && classification.awkward_intro_risk !== 'high';
        queueReason = shouldQueue ? 'hard_boundary_before_minimum' : 'cooldown';
    } else if (pressure.afterMaximum) {
        if (classification.awkward_intro_risk === 'high' && !pressure.awkwardGraceExpired) {
            pendingPressure = {
                sinceTurn: pendingPressure?.sinceTurn || currentTurn,
                reason: classification.reason || 'Arc is overdue, but the current chapter is awkward for an intro.',
                awkwardDeferrals: (pendingPressure?.awkwardDeferrals || 0) + 1
            };
            queueReason = 'awkward_grace';
        } else {
            shouldQueue = true;
            queueReason = pressure.awkwardGraceExpired ? 'maximum_pressure_grace_expired' : 'maximum_pressure';
        }
    } else if (classification.decision === 'queue_new_arc' && confident) {
        shouldQueue = classification.awkward_intro_risk !== 'high';
        queueReason = shouldQueue ? 'classifier_queue' : 'awkward_rejected';
    } else if (hardBoundary && hardConfident) {
        shouldQueue = classification.awkward_intro_risk !== 'high';
        queueReason = shouldQueue ? 'hard_boundary' : 'awkward_rejected';
    } else if (nextSoftShiftStreak >= policy.softShiftLimit && pressure.afterPreferred && classification.confidence >= 0.5) {
        shouldQueue = classification.awkward_intro_risk !== 'high';
        queueReason = shouldQueue ? 'soft_shift_streak' : 'awkward_rejected';
    } else {
        queueReason = pressure.afterPreferred ? 'preferred_waiting_for_boundary' : 'continue';
    }

    if (shouldQueue) {
        const proposedArcId = getProposedArcId(classification, currentTurn);
        const duplicateArc = proposedArcId
            && (proposedArcId === state.activeArc?.id || proposedArcId === state.pendingIntro?.arcId);
        if (duplicateArc) {
            shouldQueue = false;
            queueReason = 'duplicate_arc';
        }
    }

    const evidence = classification.reason
        ? [...state.recentBoundaryEvidence, `Turn ${currentTurn}: ${classification.reason}`].slice(-8)
        : state.recentBoundaryEvidence;

    const nextState = {
        ...state,
        softShiftStreak: shouldQueue ? 0 : nextSoftShiftStreak,
        pendingPressure: shouldQueue ? null : pendingPressure,
        recentBoundaryEvidence: evidence,
        lastDecision: {
            turn: currentTurn,
            ...classification,
            queueReason,
            queued: shouldQueue
        },
        updatedTurn: currentTurn
    };

    if (shouldQueue) {
        const pendingIntro = buildQueuedIntro(state, classification, currentTurn);
        nextState.pendingIntro = pendingIntro;
        nextState.activeArc = {
            id: pendingIntro.arcId,
            title: pendingIntro.title,
            startTurn: currentTurn + 1,
            mainQuestion: classification.reason,
            mood: classification.mood
        };
    }

    nextState.turnsSinceLastArc = Math.max(0, currentTurn - (nextState.activeArc?.startTurn || currentTurn));
    return { state: nextState, classification, pressure, queued: shouldQueue, queueReason };
}

async function getPreviousArcState(turnContext, tools, options = {}) {
    const currentTurn = clampInt(options.turnNumber || turnContext?.turnNumber, 1, 1, 999999);
    const maxTurn = options.maxTurnNumber ?? currentTurn;
    const projectName = options.projectName || turnContext?.projectName || tools?.turnContext?.projectName || 'default_project';

    try {
        const rows = await tools.db.chat.query(
            `SELECT fact_value
             FROM facts
             WHERE LOWER(project_name) = LOWER(?)
               AND source = ?
               AND predicate = ?
               AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC
             LIMIT 1`,
            [projectName, PLUGIN_ID, ARC_STATE_PREDICATE, maxTurn]
        );
        if (rows?.[0]?.fact_value) {
            return normalizeState(JSON.parse(rows[0].fact_value), currentTurn);
        }
    } catch (error) {
        tools?.logger?.warn?.('StoryArcTracker', `Failed to load previous arc state: ${error.message}`);
    }

    return makeDefaultState(currentTurn);
}

async function persistArcState(turnContext, tools, state) {
    const currentTurn = clampInt(turnContext?.turnNumber, state?.updatedTurn || 1, 1, 999999);
    const normalized = normalizeState(state, currentTurn);
    await tools.facts.appendToFactsDb({
        source: PLUGIN_ID,
        target: 'current',
        predicate: ARC_STATE_PREDICATE,
        fact_value: JSON.stringify(normalized),
        context: 'story_arc_tracker_state'
    }, { turn_number: currentTurn });
    return normalized;
}

function getCurrentChapterText(turnContext) {
    return truncateText(
        turnContext?.output?.summary
        || turnContext?.output?.synopsis
        || turnContext?.processed?.dialogueProcessor?.dialogue
        || turnContext?.output?.fulltext
        || turnContext?.processed?.narrativeEngine?.writerResponse
        || '',
        2600
    );
}

async function collectRecentChapters(turnContext, settings) {
    const limit = settings.history_turns;
    const entries = [];
    try {
        if (typeof turnContext?.retrieveDatedChapters === 'function') {
            const history = await turnContext.retrieveDatedChapters();
            const all = [
                ...(history?.synopsischapters || []),
                ...(history?.summarychapters || []),
                ...(history?.fullchapters || [])
            ].sort((a, b) => (a.turnNumber || 0) - (b.turnNumber || 0));
            for (const chapter of all.slice(-limit)) {
                if (chapter?.turnNumber === turnContext?.turnNumber) continue;
                const text = truncateText(
                    chapter?.output?.summary
                    || chapter?.output?.synopsis
                    || chapter?.processed?.dialogueProcessor?.dialogue
                    || chapter?.output?.fulltext
                    || '',
                    500
                );
                if (text) entries.push(`Turn ${chapter.turnNumber}: ${text}`);
            }
        }
    } catch {
        // History is helpful, not mandatory.
    }

    const current = getCurrentChapterText(turnContext);
    if (current) entries.push(`Turn ${turnContext?.turnNumber || '?'}: ${truncateText(current, 700)}`);
    return entries.slice(-limit).join('\n');
}

function buildPrompt({ previousState, pressure, recentChapters, currentUserPrompt, currentChapter }) {
    return [
        'Story Arc Tracker classifier.',
        '',
        'Return JSON-like data matching this shape:',
        '{ decision, confidence, arc_title, arc_id, subtitle, mood, style_hint, boundary_kind, reason, awkward_intro_risk }',
        '',
        'Allowed decision values: continue, soft_shift, close_arc, queue_new_arc.',
        'Allowed boundary_kind values: location, quest, relationship, mystery, time_skip, aftermath, escalation, respite, other.',
        'Allowed awkward_intro_risk values: low, medium, high.',
        '',
        '--- CLASSIFIER CONTEXT ---',
        `Current arc state:\n${JSON.stringify(previousState, null, 2)}`,
        '',
        `Pressure policy:\n${pressure.text}`,
        '',
        `Recent story context:\n${recentChapters || 'No recent chapter history available.'}`,
        '',
        `Current player input:\n${truncateText(currentUserPrompt || '', 800) || 'No direct player input available.'}`,
        '',
        `Current chapter:\n${currentChapter || 'No current chapter text available.'}`,
        '',
        'Decision rules:',
        '- Prefer continuity. Do not create arcs just because the mood changed for one scene.',
        '- Strong arc boundaries include a major location change, accepted/completed quest, time skip, new central threat, party composition change, aftermath after a climax, or decisive relationship/status quo shift.',
        '- Mark soft_shift when the story is drifting toward a new movement but should wait for more evidence.',
        '- Mark queue_new_arc only when the next chapter would naturally feel like an opening movement.',
        '- If pressure says an arc is overdue, actively look for the least awkward natural boundary.',
        '- If an intro would land during an awkward immediate action beat, set awkward_intro_risk to high.'
    ].join('\n');
}

async function runClassifier(turnContext, tools, settings, previousState, pressure) {
    const promptPath = path.join(__dirname, 'prompts', 'arc_boundary_classifier.txt');
    let template = '';
    try {
        template = await fs.readFile(promptPath, 'utf8');
    } catch {
        template = '';
    }

    const recentChapters = await collectRecentChapters(turnContext, settings);
    const currentChapter = getCurrentChapterText(turnContext);
    const currentUserPrompt = turnContext?.input?.userPrompt || '';
    const prompt = template
        ? template
            .replace('{{arc_state}}', JSON.stringify(previousState, null, 2))
            .replace('{{pressure_policy}}', pressure.text)
            .replace('{{recent_chapters}}', recentChapters || 'No recent chapter history available.')
            .replace('{{current_user_prompt}}', truncateText(currentUserPrompt, 800) || 'No direct player input available.')
            .replace('{{current_chapter}}', currentChapter || 'No current chapter text available.')
        : buildPrompt({ previousState, pressure, recentChapters, currentUserPrompt, currentChapter });

    const modelDef = settings.model_def || { inherit: 'vn_background' };
    const useSharedModel = tools.llm?.vnBackground?.isSelected?.(modelDef) === true;
    const task = {
        msg: 'Story Arc Tracker',
        params: { callingModule: `Plugin:${PLUGIN_ID}` }
    };

    const response = useSharedModel
        ? await tools.llm.vnBackground.withSchema({ ...task, scene: 'none', requestId: 'story_arc_classification', instruction: prompt }, isPlausibleClassification)
        : await tools.llm.withSchema({
            ...task,
            requestId: 'story_arc_classification',
            prompt,
            ...(tools.llm?.resolveModelDefinition ? tools.llm.resolveModelDefinition(modelDef) : modelDef)
        }, isPlausibleClassification);

    return normalizeClassification(response?.content || {});
}

async function writeDebugArtifact(turnContext, tools, payload) {
    try {
        if (!tools.project?.getChatPluginStorage) return;
        const storage = tools.project.getChatPluginStorage();
        await fs.mkdir(storage.absolutePath, { recursive: true });
        await fs.writeFile(path.join(storage.absolutePath, DEBUG_ARTIFACT_NAME), JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
        tools?.logger?.warn?.('StoryArcTracker', `Failed to write debug artifact: ${error.message}`);
    }
}

async function classifyAndPersistArcState(turnContext, tools, settingsOverride = null) {
    const settings = normalizeSettings(settingsOverride || await Promise.resolve(tools.settings.getSelf()));
    const currentTurn = clampInt(turnContext?.turnNumber, 1, 1, 999999);
    const previousState = await getPreviousArcState(turnContext, tools, { maxTurnNumber: currentTurn });

    if (!settings.enabled) {
        return previousState;
    }

    let classification = null;
    let failed = null;
    try {
        const prePressure = buildPressurePolicy(previousState, settings, currentTurn);
        classification = await runClassifier(turnContext, tools, settings, previousState, prePressure);
    } catch (error) {
        failed = error;
        tools?.logger?.warn?.('StoryArcTracker', `Arc classification failed non-fatally: ${error.message}`);
        classification = normalizeClassification({
            decision: 'continue',
            confidence: 0,
            reason: `Classifier failed non-fatally: ${error.message}`,
            awkward_intro_risk: 'low'
        });
    }

    const result = applyArcDecision(previousState, classification, settings, currentTurn);
    if (failed) {
        result.state.lastDecision = {
            ...(result.state.lastDecision || {}),
            warning: failed.message
        };
    }

    await persistArcState(turnContext, tools, result.state);
    await writeDebugArtifact(turnContext, tools, {
        turnNumber: currentTurn,
        classification,
        pressure: result.pressure,
        queued: result.queued,
        queueReason: result.queueReason,
        state: result.state
    });

    if (result.queued) {
        tools?.logger?.runtime?.(`Story Arc Tracker queued '${result.state.pendingIntro?.title}' for Turn ${currentTurn + 1}.`);
    }
    return result.state;
}

async function runPreWriter(turnContext, tools) {
    const settings = normalizeSettings(await Promise.resolve(tools.settings.getSelf()));
    if (!settings.enabled) {
        tools?.logger?.log?.('StoryArcTracker', 'Pre-writer skipped: story arc tracker is disabled.');
        return;
    }

    const currentTurn = clampInt(turnContext?.turnNumber, 1, 1, 999999);
    const state = await getPreviousArcState(turnContext, tools, { maxTurnNumber: currentTurn });
    const pending = normalizePendingIntro(state.pendingIntro);
    if (!pending) {
        tools?.logger?.log?.('StoryArcTracker', `Pre-writer skipped: no pending arc intro for Turn ${currentTurn}.`);
        return;
    }
    if (pending.targetTurn > currentTurn) {
        tools?.logger?.log?.('StoryArcTracker', `Pre-writer skipped: pending arc intro '${pending.title}' targets Turn ${pending.targetTurn}; current Turn ${currentTurn}.`);
        return;
    }

    if (hasArcCinematicRequest(turnContext)) {
        tools?.logger?.log?.('StoryArcTracker', 'Arc Cinematics request already exists; keeping queued arc intro for a later opportunity.');
        return;
    }

    const request = {
        arcId: pending.arcId,
        title: pending.title,
        subtitle: pending.subtitle,
        reason: pending.reason,
        mood: pending.mood,
        styleHint: pending.styleHint,
        range: pending.range,
        arcRangeLabel: pending.arcRangeLabel,
        preferCg: pending.preferCg
    };

    let requestResult = { ok: true, status: 'dry_run' };
    if (!settings.dry_run) {
        tools?.logger?.runtime?.(`Story Arc Tracker requesting arc cinematic '${request.title}' for Turn ${currentTurn}.`);
        requestResult = await tools.plugins.tryCall('arc_cinematics', 'requestArcCinematic', [request], {
            rethrow: false,
            fallback: { ok: false, status: 'missing' }
        });
        tools?.logger?.log?.('StoryArcTracker', `Arc Cinematics request result: ${JSON.stringify(requestResult || null)}`);
        if (!requestResult || requestResult.ok !== true) {
            tools?.logger?.warn?.('StoryArcTracker', `Arc Cinematics request failed or was unavailable; keeping pending intro '${request.title}' queued.`);
            return;
        }
    } else {
        tools?.logger?.runtime?.(`Story Arc Tracker dry-run would request arc cinematic '${request.title}'.`);
    }

    const consumed = {
        ...state,
        pendingIntro: null,
        lastIntroTurn: currentTurn,
        lastDecision: {
            ...(state.lastDecision || {}),
            consumedAtTurn: currentTurn,
            dryRun: settings.dry_run,
            requestResult
        },
        updatedTurn: currentTurn
    };
    await persistArcState(turnContext, tools, consumed);
    tools?.logger?.runtime?.(`Story Arc Tracker consumed pending arc intro '${request.title}' for Turn ${currentTurn}.`);
}

async function runPostVnGeneration(turnContext, tools) {
    const settings = normalizeSettings(await Promise.resolve(tools.settings.getSelf()));
    if (!settings.enabled) return;

    const runner = async (job = null) => {
        job?.progress?.(20, 'Reading arc state...');
        const state = await classifyAndPersistArcState(turnContext, tools, settings);
        job?.progress?.(100, state.pendingIntro ? 'Story arc intro queued.' : 'Story arc state updated.');
        return state;
    };

    if (tools.jobs?.withJob) {
        await tools.jobs.withJob('Updating story arc tracker...', {
            id: 'story_arc_tracker_update',
            scope: 'turn',
            rethrow: false,
            notifyOnComplete: false
        }, runner);
        return;
    }

    await runner();
}

module.exports = {
    PLUGIN_ID,
    ARC_STATE_PREDICATE,
    SETTINGS_SCHEMA,
    normalizeSettings,
    normalizeState,
    normalizeClassification,
    applyArcDecision,
    getPreviousArcState,
    persistArcState,
    classifyAndPersistArcState,
    runPreWriter,
    runPostVnGeneration,
    _private: {
        makeDefaultState,
        buildPressurePolicy,
        normalizePendingIntro,
        buildQueuedIntro,
        isPlausibleClassification,
        hasArcCinematicRequest
    }
};
