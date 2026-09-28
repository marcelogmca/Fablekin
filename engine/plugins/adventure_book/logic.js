const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    deriveD20Target,
    deriveSuccessChanceFromD20Target,
    resolveRollOutcome,
    rollD20,
    createPendingRollId,
    findStateOption,
    buildRollResult: buildDiceRollResult,
    ensurePendingRolls
} = require('./logic/dice.js');
const {
    toStringSafe,
    toInt,
    clampNumber,
    slugify,
    sanitizeText,
    sanitizeLongText,
    limitAtNaturalBoundary,
    paginateStoryText,
    storySimilarity,
    isStoryTooCloseToSource
} = require('./logic/text_utils.js');
const {
    toPosix,
    normalizeProjectAssetPath,
    isGenericSpritePath,
    toProjectAssetPath,
    hashCgPromptRequest,
    getCachedCgImagePath,
    rememberCachedCgImagePath
} = require('./logic/cg_cache.js');

const PLUGIN_ID = 'adventure_book';
const START_EVENT = 'adventure-book:start';
const ROLL_EVENT = 'adventure-book:roll';
const ADVANCE_EVENT = 'adventure-book:advance';
const REBUILD_EVENT = 'adventure-book:rebuild';
const CG_EVENT = 'adventure-book:cg';
const FINALIZE_EVENT = 'adventure-book:finalize';
const MAIN_INTERCEPT_ID_PREFIX = 'adventure_book_overlay_turn_';
const CHALLENGE_FACT_PREDICATE = 'ADVENTURE_BOOK_CHALLENGE';
const DEFAULT_MAX_STEPS = 3;
const DEFAULT_CG_MODEL_TIER = 'budget';
const CG_PROMPT_MAX_CHARS = 2800;
const DEFAULT_CG_PROMPT_MODE = 'diffusion_positive';
const CG_PROMPT_MODES = new Set([
    'diffusion_positive',
    'llm_instruction',
    'llm_instruction_with_references'
]);
const DEFAULT_CG_VISUAL_STYLE = 'original';
const PERSISTENT_INTERCEPT_TIMEOUT_MS = 2147483647;
const pendingCgRequests = new Map();

const PROMPT_DIR = path.join(__dirname, 'prompts');
const INITIAL_PAGE_PROMPT_TEMPLATE = fs.readFileSync(path.join(PROMPT_DIR, 'initial_page.txt'), 'utf8');
const ADVANCE_PAGE_PROMPT_TEMPLATE = fs.readFileSync(path.join(PROMPT_DIR, 'advance_page.txt'), 'utf8');
const INITIAL_METADATA_PROMPT_TEMPLATE = fs.readFileSync(path.join(PROMPT_DIR, 'initial_metadata.txt'), 'utf8');
const ADVANCE_METADATA_PROMPT_TEMPLATE = fs.readFileSync(path.join(PROMPT_DIR, 'advance_metadata.txt'), 'utf8');
const FINAL_CAPSULE_PROMPT_TEMPLATE = fs.readFileSync(path.join(PROMPT_DIR, 'final_capsule.txt'), 'utf8');
const DIRECTOR_DESCRIPTION_PROMPT = fs.readFileSync(path.join(PROMPT_DIR, 'director_description.txt'), 'utf8').trim();
const DIRECTOR_HANDOFF_PROMPT = fs.readFileSync(path.join(PROMPT_DIR, 'director_handoff_hint.txt'), 'utf8').trim();
const PIXI_UI_JS = fs.readFileSync(path.join(__dirname, 'pixi_ui.js'), 'utf8');
const CLASSIFIER_ADDENDUM = [
    'Adventure Book seasoning rule:',
    'A committed travel/task/search stretch can be a valid playable boundary even if the final paragraph has no visible fork, enemy, or obstacle.',
    'If the characters are simply continuing along an already chosen route or task, and the next normal input would only be "keep going", Adventure Book may add a small contained incident inside that scope.',
    'Examples: strange roadside merchant, oasis full of pink lizards, cactus-juice comedy, lost supplies, suspicious tracks, minor bandit trouble, weird weather, haunted noise.',
    'Do not use this to redirect the main goal, start broad freeform downtime, or seize the higher plot.'
].join(' ');

const SETTINGS_SCHEMA = Object.freeze({
    PLUGIN_BRIEF: {
        type: 'description',
        content: 'Turns bounded challenge beats into blocking storybook choice loops that hand back a clean continuation prompt.'
    },
    PLUGIN_METRICS: {
        type: 'metrics',
        narrative_impact: 'High',
        immersion: 'High',
        cost: 'Medium',
        latency: 'Medium'
    },
    model_def: {
        type: 'select',
        label: 'Adventure Book Model',
        description: 'Model used to generate book pages, options, and outcomes.',
        options: 'llm-aliases',
        default: { model: 'highendmodel' }
    },
    enabled: {
        type: 'checkbox',
        label: 'Enable Plugin',
        description: 'Master toggle for Adventure Book behavior.',
        default: true
    },
    force_offer_every_turn: {
        type: 'checkbox',
        label: 'Force Generate Adventure Book',
        description: 'Testing mode: bypass Director/classifier eligibility and always offer Adventure Book after mainline turns.',
        default: false
    },
    debug_mode: {
        type: 'checkbox',
        label: 'Debug Mode',
        description: 'Show Adventure Book debug controls and status text, including rebuild buttons and dice animation test buttons.',
        default: false
    },
    max_steps: {
        type: 'number',
        label: 'Maximum Book Steps',
        description: 'Maximum number of choice/result cycles before the challenge resolves.',
        min: 1,
        max: 6,
        default: DEFAULT_MAX_STEPS
    },
    show_exact_odds: {
        type: 'checkbox',
        label: 'Show Exact Checks',
        description: 'When enabled, check options show exact d20 targets such as Perception 11+ instead of softer labels.',
        default: true
    },
    prefer_cg: {
        type: 'checkbox',
        label: 'Request CG Illustration',
        description: 'If cg_generator is installed and CG Model Tier is not none, request one non-blocking Adventure Book illustration after completion.',
        default: false
    },
    cg_model_tier: {
        type: 'select',
        label: 'CG Model Tier',
        description: 'Preferred cg_generator model tier. None disables Adventure Book image generation.',
        options: [
            { label: 'none', description: 'Do not generate Adventure Book CG illustrations.' },
            { label: 'budget', description: 'Cheapest available image model.' },
            { label: 'standard', description: 'Balanced image model.' },
            { label: 'premium', description: 'Higher quality image model.' }
        ],
        default: DEFAULT_CG_MODEL_TIER
    },
    cg_prompt_mode: {
        type: 'select',
        label: 'CG Prompt Mode',
        description: 'How Adventure Book should prompt cg_generator.',
        options: [
            {
                label: 'diffusion_positive',
                description: 'Path 1: compact positive, background-only diffusion prompt. Best for cheap image models.'
            },
            {
                label: 'llm_instruction',
                description: 'Path 2: natural-language VN CG instruction. Best for smarter image models.'
            },
            {
                label: 'llm_instruction_with_references',
                description: 'Path 3: natural-language prompt plus available character sprite references.'
            }
        ],
        default: DEFAULT_CG_PROMPT_MODE
    },
    cg_visual_style: {
        type: 'select',
        label: 'CG Visual Style',
        description: 'Display treatment for Adventure Book CGs inside the book.',
        options: [
            { label: 'original', description: 'Show the generated CG as-is.' },
            { label: 'sepia', description: 'Apply an aged sepia storybook treatment.' },
            { label: 'black_white', description: 'Apply a black-and-white illustration treatment.' },
            { label: 'pixel_art', description: 'Attempt a pixel-art display filter when the Pixi runtime supports it.' },
            { label: 'theme_colors', description: 'Tint the CG using colors from default.css, useful for sci-fi or strong UI themes.' }
        ],
        default: DEFAULT_CG_VISUAL_STYLE
    }
});

function renderPromptTemplate(template, replacements = {}) {
    return String(template || '').replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
        if (!Object.prototype.hasOwnProperty.call(replacements, key)) return '';
        return String(replacements[key] ?? '');
    });
}

function emitResponse(tools, eventName, payload) {
    if (typeof tools?.socket?.emit === 'function') {
        tools.socket.emit(`${eventName}-response`, payload || {});
    }
}

function logInfo(tools, message) {
    if (typeof tools?.logger?.log === 'function') {
        tools.logger.log(message);
    }
}

function resolveMaxSteps(settings, fallback = DEFAULT_MAX_STEPS) {
    return clampNumber(settings?.max_steps, 1, 6, fallback);
}

function normalizeCgModelTier(value) {
    const tier = String(value || DEFAULT_CG_MODEL_TIER).trim().toLowerCase();
    return ['none', 'budget', 'standard', 'premium'].includes(tier) ? tier : DEFAULT_CG_MODEL_TIER;
}

function normalizeCgPromptMode(value) {
    const promptMode = String(value || '').trim();
    return CG_PROMPT_MODES.has(promptMode) ? promptMode : DEFAULT_CG_PROMPT_MODE;
}

function normalizeCgVisualStyle(value) {
    const style = String(value || DEFAULT_CG_VISUAL_STYLE).trim().toLowerCase();
    return ['original', 'sepia', 'black_white', 'pixel_art', 'theme_colors'].includes(style)
        ? style
        : DEFAULT_CG_VISUAL_STYLE;
}

function normalizeCgStatus(value, cgImagePath = '') {
    if (cgImagePath) return 'ready';
    const status = String(value || '').trim().toLowerCase();
    return ['missing', 'pending', 'ready', 'failed'].includes(status) ? status : 'missing';
}

function clearCgStateForNewChapter(state) {
    if (!state || typeof state !== 'object') return state;
    state.cgImagePath = '';
    state.cgStatus = 'missing';
    state.cgPrompt = '';
    state.cgPromptHash = '';
    state.cgOutputPath = '';
    state.cgError = '';
    state.cgRequestedAt = null;
    state.cgCompletedAt = null;
    return state;
}

function getCgChapterIndex(state = {}) {
    const pathHint = String(state.cgOutputPath || state.cgImagePath || '');
    const match = pathHint.match(/cg_chapter_(\d+)(?:_|\.|\/|$)/i);
    return match ? toInt(match[1], null) : null;
}

function repairMismatchedCurrentCgState(state, chapterIndex) {
    if (!state || typeof state !== 'object') return state;
    const cgChapterIndex = getCgChapterIndex(state);
    if (!cgChapterIndex || cgChapterIndex === toInt(chapterIndex, null)) return state;
    return clearCgStateForNewChapter({ ...state });
}

function isCgGenerationEnabled(settings = {}) {
    return settings.prefer_cg !== false && normalizeCgModelTier(settings.cg_model_tier) !== 'none';
}

function isDebugMode(settings = {}) {
    return settings?.debug_mode === true;
}

function buildRollResult(option, roll = null) {
    return buildDiceRollResult(option, roll, getOptionOutcomeHint);
}

function getOptionOutcomeHint(option, outcome) {
    if (option?.resolutionType === 'automatic') {
        return sanitizeText(option.automaticOutcome || option.successHint, 'The party makes safe, modest progress.', 400);
    }
    const tiers = option?.outcomeTiers && typeof option.outcomeTiers === 'object' ? option.outcomeTiers : {};
    const key = {
        critical_failure: 'criticalFailure',
        failure: 'failure',
        success: 'success',
        critical_success: 'criticalSuccess'
    }[outcome] || 'success';
    return sanitizeText(tiers[key] || option?.[`${key}Hint`] || option?.successHint, 'The choice changes the situation.', 400);
}

function buildMemoryImpact(option, rollResult, resultText = '') {
    const impacts = Array.isArray(option?.memoryImpact)
        ? option.memoryImpact.map(item => sanitizeText(item, '', 180)).filter(Boolean).slice(0, 5)
        : [];
    if (option?.chapterMemoryHint) impacts.unshift(sanitizeText(option.chapterMemoryHint, '', 180));
    if (rollResult?.outcome) {
        impacts.unshift(`${option?.label || 'The chosen approach'} resolved as ${rollResult.outcome}.`);
    }
    if (resultText) impacts.push(sanitizeText(resultText, '', 220));
    return impacts.filter(Boolean).slice(0, 6);
}

function normalizeOption(raw, index = 0, party = []) {
    const fallbackLead = party[index % Math.max(1, party.length)] || '';
    const label = sanitizeText(raw?.label, `Attempt ${index + 1}`, 100);
    const rawResolutionType = String(raw?.resolutionType || raw?.resolution || '').trim().toLowerCase();
    const resolutionType = rawResolutionType === 'automatic'
        ? 'automatic'
        : 'check';
    const d20Target = resolutionType === 'automatic'
        ? null
        : clampNumber(raw?.d20Target ?? raw?.target ?? raw?.dc, 2, 21, deriveD20Target(raw?.successChance));
    const successChance = resolutionType === 'automatic'
        ? 100
        : deriveSuccessChanceFromD20Target(d20Target);
    const helperCharacters = Array.isArray(raw?.helperCharacters)
        ? raw.helperCharacters.map(name => sanitizeText(name, '', 80)).filter(Boolean).slice(0, 4)
        : [];
    const outcomeTiers = raw?.outcomeTiers && typeof raw.outcomeTiers === 'object' ? raw.outcomeTiers : {};
    const criticalSuccessHint = sanitizeText(raw?.criticalSuccessHint || outcomeTiers.criticalSuccess, 'An unexpected advantage appears.', 260);
    const successHint = sanitizeText(raw?.successHint || outcomeTiers.success, 'The approach works cleanly.', 240);
    const failureHint = sanitizeText(raw?.failureHint || outcomeTiers.failure, 'The story continues with a complication.', 240);
    const criticalFailureHint = sanitizeText(raw?.criticalFailureHint || outcomeTiers.criticalFailure, 'The complication is severe and immediate.', 260);
    const automaticOutcome = sanitizeText(raw?.automaticOutcome || raw?.safeOutcome || successHint, 'The party makes safe, modest progress.', 260);
    return {
        optionKey: slugify(raw?.optionKey || label, `option_${index + 1}`),
        label,
        intent: sanitizeText(raw?.intent, raw?.approach || 'Handle the immediate obstacle.', 180),
        resolutionType,
        leadCharacter: sanitizeText(raw?.leadCharacter, fallbackLead, 80),
        helperCharacters,
        approach: sanitizeText(raw?.approach, 'Careful', 80),
        checkType: resolutionType === 'automatic' ? '' : sanitizeText(raw?.checkType || raw?.skill || raw?.ability, 'Skill', 80),
        difficultyReason: resolutionType === 'automatic'
            ? sanitizeText(raw?.difficultyReason, 'No check is needed; the action is ordinary and its consequence comes from the approach.', 260)
            : sanitizeText(raw?.difficultyReason, 'The check reflects pressure, uncertainty, opposition, or an attempt to gain extra advantage.', 300),
        difficultyBand: sanitizeText(raw?.difficultyBand, resolutionType === 'automatic' ? 'automatic' : '', 40),
        payoffBand: sanitizeText(raw?.payoffBand, resolutionType === 'automatic' ? 'minor' : '', 40),
        strengthJustification: sanitizeText(raw?.strengthJustification, '', 260),
        safetyProfile: sanitizeText(raw?.safetyProfile, resolutionType === 'automatic' ? 'safe_mundane' : 'balanced', 60),
        expectedImpact: sanitizeText(raw?.expectedImpact, resolutionType === 'automatic' ? 'minor' : 'moderate', 60),
        automaticOutcome: resolutionType === 'automatic' ? automaticOutcome : '',
        outcomeTiers: resolutionType === 'automatic' ? null : {
            criticalFailure: criticalFailureHint,
            failure: failureHint,
            success: successHint,
            criticalSuccess: criticalSuccessHint
        },
        memoryImpact: Array.isArray(raw?.memoryImpact)
            ? raw.memoryImpact.map(item => sanitizeText(item, '', 180)).filter(Boolean).slice(0, 5)
            : [],
        chapterMemoryHint: sanitizeText(raw?.chapterMemoryHint, '', 260),
        successChance,
        d20Target,
        riskTier: sanitizeText(raw?.riskTier, 'Medium', 40),
        rewardTier: sanitizeText(raw?.rewardTier, 'Medium', 40),
        successHint,
        failureHint: resolutionType === 'automatic' ? '' : failureHint,
        criticalSuccessHint: resolutionType === 'automatic' ? '' : criticalSuccessHint,
        criticalFailureHint: resolutionType === 'automatic' ? '' : criticalFailureHint
    };
}

function normalizePage(raw, index = 0, fallback = {}) {
    if (typeof raw === 'string') {
        return sanitizeLongText(raw, typeof fallback === 'string' ? fallback : fallback.body || '', 3600);
    }
    return sanitizeLongText(raw?.body || raw?.text || raw?.content, typeof fallback === 'string' ? fallback : fallback.body || '', 3600);
}

function normalizePages(raw, fallbackContext = {}) {
    const storyText = sanitizeLongText(raw?.storyText || raw?.story || raw?.text || fallbackContext.storyText, '', 12000);
    const storyPages = paginateStoryText(storyText, { fallback: fallbackContext.situation || raw?.situation || '' });
    if (storyPages.length > 0) return storyPages;

    const sourcePages = Array.isArray(raw?.pages) ? raw.pages : [];
    const fallbackPages = Array.isArray(fallbackContext.pages) ? fallbackContext.pages : [];
    const pages = sourcePages
        .slice(0, 8)
        .map((page, index) => normalizePage(page, index, fallbackPages[index] || {}))
        .filter(Boolean);

    if (pages.length > 0) return pages;

    const fallbackSituation = sanitizeLongText(
        raw?.situation || fallbackContext.situation,
        'A storybook challenge opens before the party.',
        3600
    );
    return [{
        body: fallbackSituation
    }].map(page => page.body);
}

function normalizeState(raw, settings = {}, fallbackContext = {}) {
    const maxSteps = resolveMaxSteps(settings, fallbackContext.maxSteps || DEFAULT_MAX_STEPS);
    const party = Array.isArray(raw?.party)
        ? raw.party.map(name => sanitizeText(name, '', 80)).filter(Boolean).slice(0, 8)
        : (Array.isArray(fallbackContext.party) ? fallbackContext.party : []);
    const options = (Array.isArray(raw?.options) ? raw.options : [])
        .slice(0, 4)
        .map((option, index) => normalizeOption(option, index, party));
    while (options.length < 2 && raw?.isComplete !== true) {
        options.push(normalizeOption({
            label: options.length === 0 ? 'Take the direct route' : 'Look for another angle',
            resolutionType: options.length === 0 ? 'automatic' : 'check',
            d20Target: options.length === 0 ? null : 12,
            checkType: options.length === 0 ? '' : 'Insight',
            approach: options.length === 0 ? 'Direct' : 'Cautious',
            automaticOutcome: 'The party makes safe, modest progress.',
            difficultyReason: options.length === 0
                ? 'No check is needed; this is a straightforward approach.'
                : 'The useful angle is uncertain and requires reading subtle details under pressure.',
            safetyProfile: options.length === 0 ? 'safe_mundane' : 'balanced',
            expectedImpact: options.length === 0 ? 'minor' : 'moderate'
        }, options.length, party));
    }

    const stepIndex = clampNumber(raw?.chapterIndex ?? raw?.stepIndex, 1, maxSteps, fallbackContext.chapterIndex || fallbackContext.stepIndex || 1);
    const storyText = sanitizeLongText(
        raw?.storyText || raw?.story || raw?.text || fallbackContext.storyText || (Array.isArray(raw?.pages) ? raw.pages.map(page => typeof page === 'string' ? page : page?.body || '').filter(Boolean).join('\n\n') : ''),
        fallbackContext.storyText || '',
        12000
    );
    const pages = normalizePages(raw, fallbackContext);
    const situationFallback = pages.join('\n\n');
    const cgImagePath = sanitizeText(raw?.cgImagePath || raw?.cgPath || raw?.imagePath || fallbackContext.cgImagePath, '', 500);
    const cgStatus = normalizeCgStatus(raw?.cgStatus || raw?.cg?.status || fallbackContext.cgStatus, cgImagePath);
    return {
        title: sanitizeText(raw?.title, fallbackContext.title || 'Adventure Book', 120),
        mode: sanitizeText(raw?.mode, fallbackContext.mode || 'Challenge', 80),
        chapterIndex: stepIndex,
        maxChapters: maxSteps,
        storyText: storyText || situationFallback,
        pages,
        situation: sanitizeLongText(raw?.situation, fallbackContext.situation || situationFallback || 'A storybook challenge opens before the party.', 2400),
        stakes: sanitizeText(raw?.stakes, fallbackContext.stakes || 'The outcome will shape what happens next.', 500),
        stepIndex,
        maxSteps,
        party,
        options: raw?.isComplete === true ? [] : options,
        isComplete: raw?.isComplete === true || stepIndex > maxSteps,
        finalResolution: sanitizeText(raw?.finalResolution, '', 1000),
        bridgePrompt: sanitizeText(raw?.bridgePrompt, '', 1000),
        handoffMode: sanitizeText(raw?.handoffMode, '', 80),
        illustrationPrompt: sanitizeText(raw?.illustrationPrompt, fallbackContext.illustrationPrompt || raw?.mode || 'Sepia storybook illustration', 500),
        cgImagePath,
        cgStatus,
        cgPrompt: sanitizeText(raw?.cgPrompt || raw?.cg?.prompt || fallbackContext.cgPrompt, '', 3000),
        cgPromptHash: sanitizeText(raw?.cgPromptHash || raw?.cg?.promptHash || fallbackContext.cgPromptHash, '', 120),
        cgOutputPath: sanitizeText(raw?.cgOutputPath || raw?.cg?.outputPath || fallbackContext.cgOutputPath, '', 500),
        cgError: sanitizeText(raw?.cgError || raw?.cg?.error || fallbackContext.cgError, '', 500),
        cgRequestedAt: Number(raw?.cgRequestedAt || fallbackContext.cgRequestedAt) || null,
        cgCompletedAt: Number(raw?.cgCompletedAt || fallbackContext.cgCompletedAt) || null
    };
}

function getContextText(turnContext) {
    const writerMessages = Array.isArray(turnContext?.processed?.promptBuilder?.messages)
        ? turnContext.processed.promptBuilder.messages
        : [];
    if (writerMessages.length > 0) {
        return writerMessages
            .map(message => `${message.role || 'user'}: ${String(message.content || '')}`)
            .join('\n\n');
    }

    const parts = [
        turnContext?.input?.userPrompt,
        turnContext?.processed?.director?.writerBrief,
        turnContext?.processed?.narrativeEngine?.writerResponse,
        turnContext?.output?.summary,
        turnContext?.output?.synopsis
    ].map(value => String(value || '').trim()).filter(Boolean);
    return parts.join('\n\n');
}

function getWriterSeedMessages(turnContext) {
    const writerMessages = Array.isArray(turnContext?.processed?.promptBuilder?.messages)
        ? turnContext.processed.promptBuilder.messages
            .filter(message => message && typeof message === 'object')
            .map(message => ({
                role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
                content: String(message.content || '')
            }))
            .filter(message => message.content.trim())
        : [];
    if (writerMessages.length > 0) return writerMessages;

    return [{
        role: 'system',
        content: `Current Fablekin turn context:\n${getContextText(turnContext)}`
    }];
}

function stringifyAssistantJson(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return '{}';
    }
}

function getLlmModel(settings) {
    return {
        model: settings?.model_def?.model || 'highendmodel',
    };
}

const DIFFICULTY_BAND_TARGETS = Object.freeze({
    automatic: null,
    easy: { min: 3, max: 6, description: 'Easy because a character strength, local familiarity, tool, context, or prior success gives real leverage.' },
    standard: { min: 7, max: 11, description: 'Standard uncertainty with meaningful pressure but no extreme opposition.' },
    hard: { min: 12, max: 16, description: 'Hard, opposed, dangerous, time-pressured, or ambitious; success must be worth the risk.' },
    desperate: { min: 17, max: 20, description: 'Desperate or very high-risk; success or critical success should create a major swing.' },
    impossible: { min: 21, max: 21, description: 'Impossible under current circumstances. It is a tempting, desperate, comic, hubristic, or knowingly doomed option that always fails.' }
});

const PAYOFF_BAND_DESCRIPTIONS = Object.freeze({
    minor: 'Safe or modest progress; useful, but not the best outcome.',
    moderate: 'A useful advantage, clue, time save, safer route, or improved position.',
    major: 'A strong advantage, decisive shortcut, major clue, rescue, leverage, or dramatic state improvement.',
    catastrophic: 'Very high stakes: failure can be severe, while success can massively improve the local outcome.'
});

const NULLABLE_STRING_SCHEMA = { type: ['string', 'null'] };
const NULLABLE_NUMBER_SCHEMA = { type: ['number', 'null'] };
const NULLABLE_INTEGER_SCHEMA = { type: ['integer', 'null'] };
const NULLABLE_BOOLEAN_SCHEMA = { type: ['boolean', 'null'] };
const NULLABLE_STRING_ARRAY_SCHEMA = { type: ['array', 'null'], items: { type: 'string' } };
const NULLABLE_OBJECT_SCHEMA = { type: ['object', 'null'] };

const OPTION_SCHEMA = {
    type: 'object',
    required: ['label', 'resolutionType', 'safetyProfile', 'expectedImpact'],
    properties: {
        optionKey: NULLABLE_STRING_SCHEMA,
        label: { type: 'string' },
        intent: NULLABLE_STRING_SCHEMA,
        resolutionType: { type: 'string' },
        leadCharacter: NULLABLE_STRING_SCHEMA,
        helperCharacters: NULLABLE_STRING_ARRAY_SCHEMA,
        approach: NULLABLE_STRING_SCHEMA,
        d20Target: { type: ['number', 'null'] },
        checkType: NULLABLE_STRING_SCHEMA,
        difficultyReason: NULLABLE_STRING_SCHEMA,
        difficultyBand: NULLABLE_STRING_SCHEMA,
        payoffBand: NULLABLE_STRING_SCHEMA,
        strengthJustification: NULLABLE_STRING_SCHEMA,
        safetyProfile: { type: 'string' },
        expectedImpact: { type: 'string' },
        automaticOutcome: NULLABLE_STRING_SCHEMA,
        outcomeTiers: NULLABLE_OBJECT_SCHEMA,
        memoryImpact: NULLABLE_STRING_ARRAY_SCHEMA,
        chapterMemoryHint: NULLABLE_STRING_SCHEMA,
        successChance: NULLABLE_NUMBER_SCHEMA,
        riskTier: NULLABLE_STRING_SCHEMA,
        rewardTier: NULLABLE_STRING_SCHEMA,
        successHint: NULLABLE_STRING_SCHEMA,
        failureHint: NULLABLE_STRING_SCHEMA,
        criticalSuccessHint: NULLABLE_STRING_SCHEMA,
        criticalFailureHint: NULLABLE_STRING_SCHEMA
    }
};

const CHALLENGE_SCHEMA = {
    type: 'object',
    required: ['title', 'mode', 'stakes', 'options'],
    properties: {
        title: { type: 'string' },
        mode: { type: 'string' },
        chapterIndex: NULLABLE_INTEGER_SCHEMA,
        maxChapters: NULLABLE_INTEGER_SCHEMA,
        situation: NULLABLE_STRING_SCHEMA,
        stakes: { type: 'string' },
        stepIndex: NULLABLE_INTEGER_SCHEMA,
        maxSteps: NULLABLE_INTEGER_SCHEMA,
        party: NULLABLE_STRING_ARRAY_SCHEMA,
        illustrationPrompt: NULLABLE_STRING_SCHEMA,
        options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: OPTION_SCHEMA
        }
    }
};

const ADVANCE_SCHEMA = {
    type: 'object',
    required: ['resultText', 'stakes'],
    properties: {
        resultText: { type: 'string' },
        title: NULLABLE_STRING_SCHEMA,
        mode: NULLABLE_STRING_SCHEMA,
        chapterIndex: NULLABLE_INTEGER_SCHEMA,
        maxChapters: NULLABLE_INTEGER_SCHEMA,
        situation: NULLABLE_STRING_SCHEMA,
        stakes: { type: 'string' },
        stepIndex: NULLABLE_INTEGER_SCHEMA,
        maxSteps: NULLABLE_INTEGER_SCHEMA,
        party: NULLABLE_STRING_ARRAY_SCHEMA,
        illustrationPrompt: NULLABLE_STRING_SCHEMA,
        isComplete: NULLABLE_BOOLEAN_SCHEMA,
        finalResolution: NULLABLE_STRING_SCHEMA,
        bridgePrompt: NULLABLE_STRING_SCHEMA,
        handoffMode: NULLABLE_STRING_SCHEMA,
        options: {
            type: 'array',
            minItems: 0,
            maxItems: 4,
            items: OPTION_SCHEMA
        }
    }
};

const SUMMARY_SCHEMA = {
    type: 'object',
    required: ['summary', 'sceneEnding'],
    properties: {
        summary: { type: 'string' },
        sceneEnding: { type: 'string' }
    }
};

function buildInitialPrompt(maxSteps) {
    return renderPromptTemplate(INITIAL_PAGE_PROMPT_TEMPLATE, {
        MAX_STEPS: maxSteps,
        PACING_CONTRACT: JSON.stringify(buildPacingContract({ stepIndex: 1, maxSteps }), null, 2)
    }).trim();
}

function getLatestChapterSource(turnContext) {
    return sanitizeText(turnContext?.processed?.narrativeEngine?.writerResponse || turnContext?.output?.fulltext || '', '', 6000);
}

function buildInitialSourceMessage(turnContext) {
    const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party.join(', ') : '';
    const parts = [
        'SOURCE MATERIAL FOR ADVENTURE BOOK.',
        'Use this only to infer the parent action, characters, tone, destination/goal, and constraints.',
        'Do not copy, paraphrase, summarize, rewrite, or continue it beat-for-beat.',
        '',
        turnContext?.input?.userPrompt ? `Player prompt / parent intent:\n${sanitizeText(turnContext.input.userPrompt, '', 1200)}` : '',
        party ? `Party:\n${party}` : '',
        turnContext?.processed?.director?.writerBrief ? `Director brief:\n${sanitizeText(turnContext.processed.director.writerBrief, '', 1800)}` : '',
        getLatestChapterSource(turnContext) ? `Latest VN chapter output:\n${getLatestChapterSource(turnContext)}` : ''
    ].filter(Boolean);
    return parts.join('\n\n').trim();
}

function buildInitialMetadataPrompt(maxSteps) {
    const contract = buildChoiceContract({ stepIndex: 1, maxSteps });
    return renderPromptTemplate(INITIAL_METADATA_PROMPT_TEMPLATE, {
        MAX_STEPS: maxSteps,
        CHOICE_CONTRACT: JSON.stringify(contract, null, 2),
        JSON_SCHEMA: JSON.stringify(CHALLENGE_SCHEMA, null, 2)
    }).trim();
}

function randomIntInclusive(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
}

function weightedCount(rng, weights) {
    const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
    let cursor = 0;
    for (const entry of weights) {
        cursor += Math.max(0, Number(entry.weight) || 0);
        if (roll < cursor) return entry.count;
    }
    return weights[weights.length - 1]?.count || 0;
}

function shuffleWithRng(items, rng) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(rng() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function buildPacingContract(context = {}) {
    const maxSteps = toInt(context.maxSteps, DEFAULT_MAX_STEPS);
    const stepIndex = toInt(context.stepIndex, 1);
    const failurePressure = toInt(context.failurePressure, 0);
    const criticalFailures = toInt(context.criticalFailures, 0);
    const chaptersRemaining = Math.max(0, maxSteps - stepIndex);
    const pressureLevel = criticalFailures > 0 || failurePressure >= 2 || chaptersRemaining <= 1
        ? 'high'
        : failurePressure === 1
            ? 'medium'
            : 'low';
    let pacing;
    if (stepIndex >= maxSteps) pacing = 'resolve_now';
    else if (chaptersRemaining === 1) pacing = 'final_handoff';
    else if (stepIndex <= 1) pacing = 'opening';
    else if (pressureLevel === 'high') pacing = 'narrow';
    else pacing = 'escalate';
    const pacingInstruction = {
        opening: 'Open a bounded local complication inside the parent action, ending at a concrete choice point.',
        escalate: 'Escalate or transform the local complication without resolving the whole Adventure Book yet.',
        narrow: 'Narrow the situation toward consequences; previous failures or pressure should matter.',
        final_handoff: 'There is only one chapter after this. Aim the scene toward a strong resolution or live VN handoff.',
        resolve_now: 'This is the final Adventure Book chapter. Resolve the bounded challenge or set up an immediate VN handoff.'
    }[pacing];
    return {
        chapterIndex: stepIndex,
        maxChapters: maxSteps,
        chaptersRemaining,
        pressureLevel,
        pacing,
        shouldResolveNow: pacing === 'resolve_now',
        handoffModes: ['clean_resolution', 'changed_state', 'live_scene_handoff', 'soft_cliffhanger', 'aftermath_handoff'],
        pacingInstruction
    };
}

function getDifficultyPayoffBand(difficultyBand, characterStrengthRequired = false) {
    if (difficultyBand === 'automatic') return 'minor';
    if (difficultyBand === 'easy') return characterStrengthRequired ? 'moderate' : 'minor';
    if (difficultyBand === 'standard') return 'moderate';
    if (difficultyBand === 'hard') return 'major';
    if (difficultyBand === 'desperate') return 'catastrophic';
    if (difficultyBand === 'impossible') return 'catastrophic';
    return 'moderate';
}

const IMPOSSIBLE_CHOICE_WEIGHTS = Object.freeze({
    low: Object.freeze([
        { count: 0, weight: 0.80 },
        { count: 1, weight: 0.15 },
        { count: 2, weight: 0.05 },
        { count: 3, weight: 0.00 }
    ]),
    medium: Object.freeze([
        { count: 0, weight: 0.60 },
        { count: 1, weight: 0.20 },
        { count: 2, weight: 0.15 },
        { count: 3, weight: 0.05 }
    ]),
    high: Object.freeze([
        { count: 0, weight: 0.40 },
        { count: 1, weight: 0.30 },
        { count: 2, weight: 0.20 },
        { count: 3, weight: 0.10 }
    ])
});

const AUTOMATIC_CHOICE_WEIGHTS = Object.freeze({
    low: Object.freeze([
        { count: 0, weight: 0.25 },
        { count: 1, weight: 0.35 },
        { count: 2, weight: 0.25 },
        { count: 3, weight: 0.15 }
    ]),
    medium: Object.freeze([
        { count: 0, weight: 0.40 },
        { count: 1, weight: 0.30 },
        { count: 2, weight: 0.20 },
        { count: 3, weight: 0.10 }
    ]),
    high: Object.freeze([
        { count: 0, weight: 0.60 },
        { count: 1, weight: 0.25 },
        { count: 2, weight: 0.10 },
        { count: 3, weight: 0.05 }
    ])
});

function buildChoiceBlueprints({ totalChoices, automaticChoicesRequired, impossibleChoicesRequired, characterStrengthChoicesRequired, pressureLevel, pacing, rng }) {
    const possibleCheckChoicesRequired = Math.max(0, totalChoices - automaticChoicesRequired - impossibleChoicesRequired);
    const blueprints = [];
    for (let index = 0; index < impossibleChoicesRequired; index += 1) {
        blueprints.push({
            resolutionType: 'check',
            difficultyBand: 'impossible',
            payoffBand: getDifficultyPayoffBand('impossible', false),
            characterStrengthRequired: false,
            d20TargetRange: DIFFICULTY_BAND_TARGETS.impossible,
            forcedD20Target: 21,
            designInstruction: 'Impossible under current circumstances. Make it flavorful, tempting, desperate, hubristic, comic, or genre-appropriate, but never secretly correct. It uses d20Target 21 and always fails; explain why in difficultyReason.'
        });
    }

    for (let index = 0; index < automaticChoicesRequired; index += 1) {
        blueprints.push({
            resolutionType: 'automatic',
            difficultyBand: 'automatic',
            payoffBand: 'minor',
            characterStrengthRequired: false,
            d20TargetRange: null,
            designInstruction: 'No roll. Safe, reliable, mundane, and modest. It should not secretly be the best result.'
        });
    }

    const strengthCount = Math.min(characterStrengthChoicesRequired, possibleCheckChoicesRequired);
    for (let index = 0; index < strengthCount; index += 1) {
        const difficultyBand = 'easy';
        blueprints.push({
            resolutionType: 'check',
            difficultyBand,
            payoffBand: getDifficultyPayoffBand(difficultyBand, true),
            characterStrengthRequired: true,
            d20TargetRange: DIFFICULTY_BAND_TARGETS[difficultyBand],
            designInstruction: 'Meaningful check made easy by a specific character strength, familiarity, tool, context, or prior success. Explain this in difficultyReason and strengthJustification.'
        });
    }

    const remainingChecks = possibleCheckChoicesRequired - strengthCount;
    const bandPools = {
        low: pacing === 'opening' ? ['standard', 'hard', 'standard'] : ['standard', 'hard', 'easy'],
        medium: ['hard', 'standard', 'easy', 'desperate'],
        high: ['hard', 'desperate', 'standard', 'hard']
    };
    const pool = bandPools[pressureLevel] || bandPools.low;
    const offset = randomIntInclusive(rng, 0, pool.length - 1);
    for (let index = 0; index < remainingChecks; index += 1) {
        const difficultyBand = pool[(index + offset) % pool.length];
        blueprints.push({
            resolutionType: 'check',
            difficultyBand,
            payoffBand: getDifficultyPayoffBand(difficultyBand, false),
            characterStrengthRequired: false,
            d20TargetRange: DIFFICULTY_BAND_TARGETS[difficultyBand],
            designInstruction: difficultyBand === 'desperate'
                ? 'Rare last-resort or high-risk play. It needs huge upside and severe failure potential.'
                : difficultyBand === 'hard'
                    ? 'Hard or ambitious play. Success must visibly outperform safer choices.'
                    : 'Normal uncertainty. Avoid defaulting every check to 11+/12+.'
        });
    }

    return shuffleWithRng(blueprints, rng).map((blueprint, index) => ({
        optionNumber: index + 1,
        ...blueprint
    }));
}

function buildChoiceContract(context = {}) {
    const rng = typeof context.rng === 'function' ? context.rng : Math.random;
    const pacingContract = buildPacingContract(context);
    const pressureLevel = pacingContract.pressureLevel;
    const shouldResolveNow = pacingContract.shouldResolveNow;
    const totalChoices = 3;
    const impossibleRoll = shouldResolveNow ? 0 : weightedCount(rng, IMPOSSIBLE_CHOICE_WEIGHTS[pressureLevel] || IMPOSSIBLE_CHOICE_WEIGHTS.low);
    const impossibleChoicesRequired = clampNumber(impossibleRoll, 0, totalChoices, 0);
    const automaticRoll = shouldResolveNow ? 0 : weightedCount(rng, AUTOMATIC_CHOICE_WEIGHTS[pressureLevel] || AUTOMATIC_CHOICE_WEIGHTS.low);
    let automaticChoicesRequired = Math.min(automaticRoll, Math.max(0, totalChoices - impossibleChoicesRequired));
    automaticChoicesRequired = clampNumber(automaticChoicesRequired, 0, totalChoices, 2);
    const checkChoicesRequired = shouldResolveNow ? 0 : totalChoices - automaticChoicesRequired;
    const possibleCheckChoicesRequired = Math.max(0, checkChoicesRequired - impossibleChoicesRequired);
    const characterStrengthRoll = randomIntInclusive(rng, 0, 3);
    const characterStrengthChoicesRequired = Math.min(characterStrengthRoll, possibleCheckChoicesRequired);
    const optionBlueprints = shouldResolveNow ? [] : buildChoiceBlueprints({
        totalChoices,
        automaticChoicesRequired,
        impossibleChoicesRequired,
        characterStrengthChoicesRequired,
        pressureLevel,
        pacing: pacingContract.pacing,
        rng
    });
    return {
        ...pacingContract,
        totalChoices,
        impossibleRoll,
        impossibleChoicesRequired,
        automaticRoll,
        automaticChoicesRequired,
        checkChoicesRequired,
        possibleCheckChoicesRequired,
        characterStrengthRoll,
        characterStrengthChoicesRequired,
        difficultyBands: optionBlueprints.map(option => option.difficultyBand),
        payoffBands: optionBlueprints.map(option => option.payoffBand),
        optionBlueprints,
        difficultyBandTargets: DIFFICULTY_BAND_TARGETS,
        payoffBandDescriptions: PAYOFF_BAND_DESCRIPTIONS,
        requiredDesign: 'Choices are approaches: impossible options take slot priority, safe automatic choices are reliable but modest, and checks are risky attempts to gain advantage, avoid danger, uncover hidden information, or act under pressure. Do not cluster every check around 11+/12+.',
        characterStrengthRule: 'Character-strength choices may have low targets while still being meaningful because a specific character, tool, familiarity, or prior success makes the action easier. Explain that in difficultyReason and strengthJustification.',
        payoffRule: 'Higher d20 targets require visibly better success and critical-success upside. Hard and desperate checks must tempt the player with real benefit, not just punish them with lower odds.',
        impossibleRule: 'Impossible choices are d20Target 21. They are knowingly impossible under current circumstances and always fail, including on a natural 20. Use them sparingly as tempting, desperate, hubristic, comic, horrific, or genre-appropriate doomed options; explain why in difficultyReason.',
        toneRule: 'Read the room. Keep options in accordance with the story so far, including mature, brutal, erotic, political, horrific, or genre-specific options when the surrounding story supports them. Do not default to sanitized generic RPG choices.'
    };
}

function buildAdvanceSourceMessage(session, option, rollResult) {
    return [
        'SOURCE MATERIAL FOR THE NEXT ADVENTURE BOOK CHAPTER.',
        'Use this only as continuity context for the bounded temporary adventure.',
        'Do not copy, paraphrase, summarize, or rewrite the previous prose.',
        '',
        `Current Adventure Book title:\n${session.state?.title || 'Adventure Book'}`,
        buildChapterHistoryForPrompt(session),
        `Previous Adventure Book prose:\n${sanitizeLongText(session.state?.storyText || session.state?.pages?.join('\n\n') || '', '', 5000)}`,
        `Player choice:\n${JSON.stringify(option, null, 2)}`,
        `Resolution result:\n${JSON.stringify(rollResult, null, 2)}`,
        `Outcome tier to honor in the next prose:\n${getOptionOutcomeHint(option, rollResult?.outcome)}`
    ].filter(Boolean).join('\n\n').trim();
}

function buildChapterHistoryForPrompt(session) {
    const entries = Array.isArray(session?.transcript) ? session.transcript : [];
    if (entries.length === 0) return '';
    const lines = ['ADVENTURE BOOK CHAPTER HISTORY:'];
    entries.slice(-4).forEach((entry, index) => {
        const option = entry.option || {};
        const roll = entry.roll || {};
        lines.push(`Chapter ${index + 1}:`);
        lines.push(`- Player chose: ${option.label || 'Unknown choice'}`);
        lines.push(`- Resolution: ${roll.resolutionType === 'automatic' ? 'automatic/certain' : `${option.checkType || 'Check'} ${roll.d20Target || option.d20Target || '?'}+, rolled ${roll.roll}, ${roll.outcome}`}`);
        if (entry.resultText) lines.push(`- Result: ${sanitizeText(entry.resultText, '', 500)}`);
        const impacts = Array.isArray(entry.memoryImpact) ? entry.memoryImpact : [];
        if (impacts.length > 0) lines.push(`- Carry forward: ${impacts.join('; ')}`);
    });
    return lines.join('\n');
}

function getBookStepIndex(book) {
    return toInt(book?.currentChapterIndex, book?.state?.stepIndex || book?.currentState?.stepIndex || 1);
}

function buildAdvancePrompt(session) {
    const stepIndex = getBookStepIndex(session);
    const nextStepIndex = Math.min(stepIndex + 1, session.maxSteps);
    return renderPromptTemplate(ADVANCE_PAGE_PROMPT_TEMPLATE, {
        CURRENT_TITLE: session.state?.title || 'Adventure Book',
        CURRENT_STORY: '',
        OPTION_JSON: '',
        ROLL_JSON: '',
        MAX_STEPS: session.maxSteps,
        NEXT_STEP_INDEX: nextStepIndex,
        PACING_CONTRACT: JSON.stringify(buildPacingContract({
            stepIndex: nextStepIndex,
            maxSteps: session.maxSteps,
            failurePressure: session.failurePressure,
            criticalFailures: session.criticalFailures
        }), null, 2)
    }).trim();
}

function buildAdvanceMetadataPrompt(session) {
    const stepIndex = getBookStepIndex(session);
    const contract = buildChoiceContract({
        stepIndex: Math.min(stepIndex + 1, session.maxSteps),
        maxSteps: session.maxSteps,
        failurePressure: session.failurePressure,
        criticalFailures: session.criticalFailures
    });
    return renderPromptTemplate(ADVANCE_METADATA_PROMPT_TEMPLATE, {
        MAX_STEPS: session.maxSteps,
        NEXT_STEP_INDEX: Math.min(stepIndex + 1, session.maxSteps),
        CHOICE_CONTRACT: JSON.stringify(contract, null, 2),
        JSON_SCHEMA: JSON.stringify(ADVANCE_SCHEMA, null, 2)
    }).trim();
}

function buildFallbackState(turnContext, settings) {
    const party = Array.isArray(turnContext?.output?.party) && turnContext.output.party.length > 0
        ? turnContext.output.party.slice(0, 6)
        : [turnContext?.input?.playerCharacterName || 'The party'].filter(Boolean);
    return normalizeState({
        title: 'The Unsettled Path',
        mode: 'Expedition',
        chapterIndex: 1,
        maxChapters: resolveMaxSteps(settings),
        storyText: [
            'The path ahead refuses to stay simple. What looked like a clean continuation from the last scene gathers new weight: signs in the ground, a hesitation in the party, a pressure in the air that says the next few decisions will matter.',
            '"We can still make good time," one companion says, though their eyes keep returning to the place where the trail buckles. Another kneels near the marks in the dust and brushes grit away with two fingers.',
            'Each companion reads the situation differently. One sees speed, another sees caution, and somewhere between them waits the route that will carry the story forward without leaving too much behind.',
            'The moment narrows into action. The party can press ahead boldly or slow down long enough to understand the shape of the complication before it closes around them.'
        ].join('\n\n'),
        situation: 'A complication rises from the latest events, asking the party to choose how they press forward.',
        stakes: 'The result will shape the next scene without stopping the story.',
        stepIndex: 1,
        maxSteps: resolveMaxSteps(settings),
        party,
        illustrationPrompt: 'Sepia sketch of an adventuring party studying an uncertain path',
        options: [
            {
                label: 'Trust the quickest route',
                leadCharacter: party[0],
                approach: 'Bold',
                resolutionType: 'automatic',
                intent: 'Keep momentum and accept the obvious path.',
                safetyProfile: 'safe_mundane',
                expectedImpact: 'minor',
                automaticOutcome: 'The party keeps moving and makes modest progress without gaining special leverage.',
                riskTier: 'Low',
                rewardTier: 'Low',
                successHint: 'The party gains momentum.',
                difficultyReason: 'No check is needed; this is a straightforward choice to keep moving.'
            },
            {
                label: 'Study the signs first',
                leadCharacter: party[1] || party[0],
                approach: 'Careful',
                resolutionType: 'check',
                d20Target: 11,
                checkType: 'Perception',
                difficultyReason: 'The useful signs are subtle and the party must interpret them before the situation changes.',
                safetyProfile: 'balanced',
                expectedImpact: 'moderate',
                riskTier: 'Medium',
                rewardTier: 'Medium',
                successHint: 'The party spots useful evidence.',
                failureHint: 'The delay costs them position.',
                criticalSuccessHint: 'The party spots a hidden advantage and acts before the complication tightens.',
                criticalFailureHint: 'The signs are misread badly, putting the party in a worse position.'
            }
        ]
    }, settings, { party });
}

function toStructuredMessages(messages, requestLabel) {
    return messages.map((message, index) => ({
        role: message.role,
        piece: `${requestLabel}.message_${index + 1}`,
        text: String(message.content ?? '')
    }));
}

async function callStoryWriterOnce(messages, tools, settings, title, requestId = 'story_writing') {
    const modelDef = getLlmModel(settings);
    const response = await tools.llm.runTask({
        requestId,
        prompt: { messages: toStructuredMessages(messages, requestId) },
        model: modelDef.model,
        params: {
            temperature: 0.82,
            timeout: 90000,
            callingModule: `Plugin:${PLUGIN_ID}:${title}`
        }
    });
    return sanitizeLongText(response?.content, '', 12000);
}

async function callStoryWriter(messages, tools, settings, title, sourceText = '', requestId = 'story_writing') {
    const storyText = await callStoryWriterOnce(messages, tools, settings, title, requestId);
    if (!isStoryTooCloseToSource(storyText, sourceText)) return storyText;

    tools.logger?.warn?.(`[${PLUGIN_ID}] ${title} looked too similar to source text; retrying with anti-copy instruction.`);
    const retryMessages = [
        ...messages,
        { role: 'assistant', content: storyText },
        {
            role: 'user',
            content: [
                'That draft is too close to the source material. Do not copy, paraphrase, summarize, replay, or continue the previous VN chapter beat-for-beat.',
                'Write a NEW bounded Adventure Book incident inside the same parent action.',
                'Use the source only to preserve characters, goal, tone, and constraints.',
                'Start from a fresh local complication, discovery, cost, or character moment that was not already narrated.'
            ].join('\n')
        }
    ];
    const retryText = await callStoryWriterOnce(retryMessages, tools, settings, `${title} Retry`, `${requestId}_retry`);
    return retryText || storyText;
}

async function generateInitialState(turnContext, tools, settings) {
    const maxSteps = resolveMaxSteps(settings);
    const sourceText = getLatestChapterSource(turnContext);
    const messages = [
        { role: 'user', content: buildInitialSourceMessage(turnContext) },
        { role: 'user', content: buildInitialPrompt(maxSteps) }
    ];
    const modelDef = getLlmModel(settings);

    try {
        const storyText = await callStoryWriter(messages, tools, settings, 'Story Seed', sourceText);
        if (!storyText) throw new Error('Adventure Book raw story response was empty.');
        messages.push({ role: 'assistant', content: storyText });
        messages.push({ role: 'user', content: buildInitialMetadataPrompt(maxSteps) });
        const response = await tools.llm.withSchema({
            title: 'Adventure Book Seed Metadata',
            requestId: 'seed_metadata',
            prompt: { messages: toStructuredMessages(messages, 'seed_metadata') },
            model: modelDef.model,
            params: {
                retries: 2,
                timeout: 90000,
                extra: { reasoning: { effort: 'none' } },
                callingModule: `Plugin:${PLUGIN_ID}`
            }
        }, CHALLENGE_SCHEMA);
        const content = response?.content && typeof response.content === 'object'
            ? response.content
            : tools.llm.repairJson(response?.content || '{}', { fallback: null, throwOnError: false });
        const state = normalizeState({ ...content, storyText }, settings, { maxSteps });
        messages.push({ role: 'assistant', content: stringifyAssistantJson(state) });
        return { state, messages };
    } catch (error) {
        tools.logger.warn(`[${PLUGIN_ID}] Seed generation failed; using fallback challenge.`, error);
        const state = buildFallbackState(turnContext, settings);
        messages.push({ role: 'assistant', content: stringifyAssistantJson(state) });
        return { state, messages };
    }
}

async function generateAdvanceState(session, tools, option, rollResult) {
    const stepIndex = getBookStepIndex(session);
    const nextStepIndex = Math.min(stepIndex + 1, session.maxSteps);
    session.messages.push({ role: 'user', content: buildAdvanceSourceMessage(session, option, rollResult) });
    session.messages.push({ role: 'user', content: buildAdvancePrompt(session) });
    const modelDef = getLlmModel(session.settings);

    try {
        const storyText = await callStoryWriter(session.messages, tools, session.settings, 'Story Advance', session.state?.storyText || '');
        if (!storyText) throw new Error('Adventure Book advance story response was empty.');
        session.messages.push({ role: 'assistant', content: storyText });
        session.messages.push({ role: 'user', content: buildAdvanceMetadataPrompt(session) });
        const response = await tools.llm.withSchema({
            title: 'Adventure Book Advance Metadata',
            requestId: 'advance_metadata',
            prompt: { messages: toStructuredMessages(session.messages, 'advance_metadata') },
            model: modelDef.model,
            params: {
                retries: 2,
                timeout: 90000,
                extra: { reasoning: { effort: 'none' } },
                callingModule: `Plugin:${PLUGIN_ID}`
            }
        }, ADVANCE_SCHEMA);
        const content = response?.content && typeof response.content === 'object'
            ? response.content
            : tools.llm.repairJson(response?.content || '{}', { fallback: null, throwOnError: false });
        const fallbackContext = {
            ...session.state,
            stepIndex: nextStepIndex,
            maxSteps: session.maxSteps
        };
        const merged = {
            ...content,
            storyText,
            options: content?.isComplete === true ? [] : content?.options
        };
        const state = normalizeState(merged, session.settings, fallbackContext);
        // A generated chapter starts with its own CG lifecycle. The previous
        // chapter remains intact in book.chapters, but its image metadata must
        // never leak into the new current state through fallbackContext.
        clearCgStateForNewChapter(state);
        if (stepIndex >= session.maxSteps) {
            state.isComplete = true;
            state.options = [];
            if (!state.finalResolution) state.finalResolution = state.situation;
        }
        session.messages.push({ role: 'assistant', content: stringifyAssistantJson({ resultText: content?.resultText || '', ...state }) });
        return {
            resultText: sanitizeText(content?.resultText, 'The choice changes the shape of the challenge.', 1400),
            state
        };
    } catch (error) {
        tools.logger.warn(`[${PLUGIN_ID}] Advance generation failed; using fallback result.`, error);
        const complete = stepIndex >= session.maxSteps;
        const state = normalizeState({
            ...session.state,
            storyText: complete
                ? 'The last choice carries through the scene and leaves the party with a clear consequence. The pressure that framed the challenge releases, but not without marking the road ahead.'
                : 'The result changes the ground under the party. What was obvious a moment ago becomes complicated, and the next choice must account for what the roll revealed.\n\nThe party regroups around the new facts. There is still room to shape the outcome, but the challenge has learned from their approach and now asks for a sharper answer.',
            stepIndex: nextStepIndex,
            situation: complete
                ? 'The challenge settles into a clear outcome.'
                : 'The complication shifts, and the party must choose the next angle.',
            stakes: complete
                ? 'The result is ready to carry into the main story.'
                : 'A better choice can still change the terms.',
            isComplete: complete,
            finalResolution: complete ? 'The party emerges from the challenge with consequences established.' : '',
            bridgePrompt: complete ? 'Continue from the Adventure Book outcome and reflect its consequences in the next scene.' : ''
        }, session.settings, session.state);
        const resultText = rollResult.outcome === 'automatic'
            ? `${option.label} proceeds safely, producing a modest but reliable result.`
            : rollResult.success
                ? `${option.label} works, though the scene keeps its pressure.`
                : `${option.label} falters, but the story moves forward through the complication.`;
        session.messages.push({ role: 'assistant', content: stringifyAssistantJson({ resultText, ...state }) });
        return { resultText, state };
    }
}

async function generateFinalCapsule(session, tools, transcript) {
    const modelDef = getLlmModel(session.settings);
    const prompt = renderPromptTemplate(FINAL_CAPSULE_PROMPT_TEMPLATE, {
        TRANSCRIPT: transcript
    }).trim();

    try {
        const response = await tools.llm.withSchema({
            title: 'Adventure Book Canonization',
            requestId: 'final_capsule',
            prompt: { messages: toStructuredMessages([...session.messages, { role: 'user', content: prompt }], 'final_capsule') },
            model: modelDef.model,
            params: {
                retries: 1,
                timeout: 60000,
                extra: { reasoning: { effort: 'none' } },
                callingModule: `Plugin:${PLUGIN_ID}`
            }
        }, SUMMARY_SCHEMA);
        const content = response?.content && typeof response.content === 'object'
            ? response.content
            : tools.llm.repairJson(response?.content || '{}', { fallback: null, throwOnError: false });
        if (content) {
            return {
                title: sanitizeText(session.state.title, 'Adventure Book', 120),
                summary: sanitizeLongText(content.summary, session.state.finalResolution || transcript, 7000),
                sceneEnding: sanitizeLongText(content.sceneEnding, session.state.bridgePrompt || session.state.finalResolution || session.state.situation || `Continue from ${session.state.title}.`, 1800)
            };
        }
    } catch (error) {
        tools.logger.warn(`[${PLUGIN_ID}] Final capsule generation failed; using deterministic fallback.`, error);
    }

    return {
        title: session.state.title || 'Adventure Book',
        summary: sanitizeLongText(session.state.finalResolution || transcript, transcript, 7000),
        sceneEnding: sanitizeLongText(session.state.bridgePrompt || session.state.finalResolution || session.state.situation || `Continue after ${session.state.title}.`, 'Continue from the Adventure Book outcome.', 1800)
    };
}

function stripSyntheticPromptControlTags(text) {
    return String(text || '')
        .replace(/^\s*#{1,6}\s*(WHAT HAPPENED SINCE LAST CHAPTER|WHERE TO CONTINUE THE IMMEDIATE STORY FROM)\s*$/gim, '')
        .replace(/^\s*\[(WHAT HAPPENED SINCE LAST CHAPTER|WHERE TO CONTINUE THE IMMEDIATE STORY FROM)\]\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildContinuationUserPrompt(capsule = {}) {
    const summary = stripSyntheticPromptControlTags(sanitizeLongText(capsule.summary, 'The Adventure Book challenge resolved and changed the party situation.', 7000));
    const sceneEnding = stripSyntheticPromptControlTags(sanitizeLongText(capsule.sceneEnding, 'Continue the immediate story from the Adventure Book outcome.', 1800));
    return [
        `Since the last chapter, ${summary}`,
        `Continue the immediate story from this point: ${sceneEnding}`
    ].filter(Boolean).join('\n\n').trim();
}

function buildTranscript(session) {
    const lines = [
        `# ${session.state.title || session.initialState?.title || 'Adventure Book'}`,
        '',
        ...formatPagesForTranscript(session.initialState?.pages, session.initialState?.situation)
    ].filter(Boolean);

    for (const entry of session.transcript) {
        lines.push('');
        lines.push(`Choice: ${entry.option?.label || 'Unknown option'}`);
        lines.push(entry.roll?.resolutionType === 'automatic'
            ? 'Resolution: Certain / no roll'
            : `Roll: ${entry.roll?.roll} vs ${entry.roll?.d20Target}+ (${entry.roll?.outcome})`);
        lines.push(entry.resultText || '');
        lines.push(...formatPagesForTranscript(entry.state?.pages, entry.state?.situation));
    }

    if (session.state?.finalResolution) {
        lines.push('');
        lines.push(`Resolution: ${session.state.finalResolution}`);
    }

    return lines.join('\n').trim();
}

function formatPagesForTranscript(pages, fallbackText = '') {
    const normalizedPages = Array.isArray(pages) ? pages : [];
    if (normalizedPages.length === 0) return fallbackText ? [fallbackText] : [];
    const lines = [];
    normalizedPages.forEach((page, index) => {
        lines.push(`## Page ${index + 1}`);
        const body = typeof page === 'string' ? page : page?.body;
        if (body) lines.push(body);
    });
    return lines;
}

function hasRegisteredIntercept(context, interceptId) {
    const intercepts = Array.isArray(context?.output?.guiIntercepts) ? context.output.guiIntercepts : [];
    return intercepts.some(intercept => intercept?.interceptId === interceptId || intercept?.id === interceptId);
}

function getStateChapterIndex(state, fallback = 1) {
    return toInt(state?.stepIndex || state?.chapterIndex, fallback);
}

function normalizeChapterSnapshot(raw, fallbackIndex = 1) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const state = source.state && typeof source.state === 'object' ? source.state : source;
    if (!state || typeof state !== 'object') return null;
    const chapterIndex = getStateChapterIndex(state, source.chapterIndex || fallbackIndex);
    return {
        chapterIndex,
        state,
        selectedOption: source.selectedOption || source.option || null,
        roll: source.roll || null,
        resultText: sanitizeText(source.resultText, '', 1000),
        createdAt: Number(source.createdAt) || Date.now()
    };
}

function sameChapterState(a, b) {
    if (!a || !b) return false;
    const aIndex = getStateChapterIndex(a, null);
    const bIndex = getStateChapterIndex(b, null);
    if (aIndex && bIndex && aIndex === bIndex) return true;
    return a === b || (a.title && b.title && a.storyText && b.storyText && a.title === b.title && a.storyText === b.storyText);
}

function buildChapterList(raw = {}) {
    const chapters = [];
    const pushSnapshot = (snapshot, fallbackIndex = chapters.length + 1) => {
        const normalized = normalizeChapterSnapshot(snapshot, fallbackIndex);
        if (!normalized?.state) return;
        const existingIndex = chapters.findIndex(chapter => chapter.chapterIndex === normalized.chapterIndex);
        if (existingIndex >= 0) chapters[existingIndex] = { ...chapters[existingIndex], ...normalized };
        else chapters.push(normalized);
    };

    if (Array.isArray(raw.chapters)) {
        raw.chapters.forEach((chapter, index) => pushSnapshot(chapter, index + 1));
    }

    if (chapters.length === 0 && (raw.initialState || raw.currentState || raw.state)) {
        pushSnapshot({ state: raw.initialState || raw.currentState || raw.state }, 1);
    }

    const transcript = Array.isArray(raw.transcript) ? raw.transcript : [];
    transcript.forEach((entry, index) => {
        if (!entry?.state) return;
        pushSnapshot({
            chapterIndex: getStateChapterIndex(entry.state, index + 2),
            state: entry.state,
            selectedOption: entry.option || null,
            roll: entry.roll || null,
            resultText: entry.resultText || ''
        }, index + 2);
    });

    const currentState = raw.currentState || raw.state || null;
    if (currentState && !chapters.some(chapter => sameChapterState(chapter.state, currentState))) {
        pushSnapshot({ state: currentState }, chapters.length + 1);
    }

    return chapters
        .filter(chapter => chapter?.state)
        .sort((a, b) => a.chapterIndex - b.chapterIndex)
        .map((chapter, index) => ({
            ...chapter,
            chapterIndex: getStateChapterIndex(chapter.state, chapter.chapterIndex || index + 1)
        }));
}

function syncCurrentChapter(book) {
    if (!book?.currentState) return;
    const currentIndex = toInt(book.currentChapterIndex, getStateChapterIndex(book.currentState, 1));
    book.chapters = buildChapterList({
        chapters: book.chapters,
        initialState: book.initialState,
        currentState: book.currentState,
        transcript: book.transcript
    });
    const snapshot = normalizeChapterSnapshot({ chapterIndex: currentIndex, state: book.currentState }, currentIndex);
    const existingIndex = book.chapters.findIndex(chapter => chapter.chapterIndex === snapshot.chapterIndex);
    if (existingIndex >= 0) book.chapters[existingIndex] = { ...book.chapters[existingIndex], ...snapshot };
    else book.chapters.push(snapshot);
    book.chapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

function getBookInteractionMode(book, override = '') {
    if (String(override || '').trim().toLowerCase() === 'readonly_replay') return 'readonly_replay';
    return book?.status === 'active' ? 'active' : 'readonly_replay';
}

function isBookMutable(book) {
    return !!book && book.status === 'active';
}

function emitReadonlyError(tools, eventName) {
    emitResponse(tools, eventName, {
        success: false,
        error: 'Adventure Book is read-only for this turn.'
    });
}

function getBookSnapshot(book, interactionMode = '') {
    if (!book) return null;
    syncCurrentChapter(book);
    return {
        state: book.currentState,
        currentState: book.currentState,
        chapters: book.chapters || [],
        currentChapterIndex: toInt(book.currentChapterIndex, book.currentState?.stepIndex || book.currentState?.chapterIndex || 1),
        interactionMode: getBookInteractionMode(book, interactionMode),
        bookStatus: book.status || 'active'
    };
}

function getAdventureBookStorage(tools) {
    try {
        return tools?.project?.getChatPluginStorage?.() || null;
    } catch (_) {
        return null;
    }
}

function getBookStateFile(storage) {
    return storage?.absolutePath ? path.join(storage.absolutePath, 'book_state.json') : '';
}

function serializeBook(book) {
    const currentState = book?.currentState || book?.state || null;
    if (!currentState) return null;
    syncCurrentChapter(book);
    return {
        version: 1,
        pluginId: PLUGIN_ID,
        status: sanitizeText(book.status, 'active', 40),
        currentChapterIndex: toInt(book.currentChapterIndex, currentState?.stepIndex || currentState?.chapterIndex || 1),
        currentState,
        initialState: book.initialState || currentState,
        chapters: buildChapterList(book),
        messages: Array.isArray(book.messages) ? book.messages : [],
        settings: book.settings || {},
        maxSteps: toInt(book.maxSteps, resolveMaxSteps(book.settings || {})),
        failurePressure: toInt(book.failurePressure, 0),
        criticalFailures: toInt(book.criticalFailures, 0),
        criticalSuccesses: toInt(book.criticalSuccesses, 0),
        transcript: Array.isArray(book.transcript) ? book.transcript : [],
        pendingRolls: book.pendingRolls && typeof book.pendingRolls === 'object' ? book.pendingRolls : {},
        createdAt: Number(book.createdAt) || Date.now(),
        updatedAt: Date.now()
    };
}

function hydrateBook(raw, settings = {}) {
    if (!raw || typeof raw !== 'object' || raw.pluginId !== PLUGIN_ID) return null;
    const storedCurrentState = raw.currentState || raw.state || null;
    const currentChapterIndex = toInt(raw.currentChapterIndex, storedCurrentState?.stepIndex || storedCurrentState?.chapterIndex || 1);
    const currentState = repairMismatchedCurrentCgState(storedCurrentState, currentChapterIndex);
    if (!currentState) return null;
    const mergedSettings = { ...(raw.settings || {}), ...(settings || {}) };
    const chapters = buildChapterList(raw);
    return {
        status: sanitizeText(raw.status, 'active', 40),
        currentChapterIndex,
        currentState,
        state: currentState,
        initialState: raw.initialState || currentState,
        chapters,
        settings: mergedSettings,
        messages: Array.isArray(raw.messages) ? raw.messages : [],
        maxSteps: toInt(raw.maxSteps, resolveMaxSteps(mergedSettings)),
        failurePressure: toInt(raw.failurePressure, 0),
        criticalFailures: toInt(raw.criticalFailures, 0),
        criticalSuccesses: toInt(raw.criticalSuccesses, 0),
        transcript: Array.isArray(raw.transcript) ? raw.transcript : [],
        pendingRolls: raw.pendingRolls && typeof raw.pendingRolls === 'object' ? raw.pendingRolls : {},
        createdAt: Number(raw.createdAt) || Date.now()
    };
}

function writeJsonFile(filePath, payload) {
    if (!filePath) return;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {}
}

function readJsonFile(filePath) {
    if (!filePath) return null;
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function saveBookState(tools, book) {
    const snapshot = serializeBook(book);
    if (!snapshot) return;
    const storage = getAdventureBookStorage(tools);
    writeJsonFile(getBookStateFile(storage), snapshot);
}

function loadBookState(tools, settings = {}) {
    const storage = getAdventureBookStorage(tools);
    if (!storage?.absolutePath) return null;
    return hydrateBook(readJsonFile(getBookStateFile(storage)), settings);
}

function shouldOfferAdventureBook(context, settings = {}) {
    if (settings?.enabled === false) return false;
    if (context?.sceneMode !== 'mainline') return false;
    if (settings?.force_offer_every_turn === true) return true;

    const pluginHint = toStringSafe(
        context?.processed?.director?.scenePluginId ||
        context?.processed?.scenePhaseClassifier?.resolvedPluginId ||
        context?.processed?.scenePhaseClassifier?.requestedPluginId,
        ''
    );

    if (pluginHint === PLUGIN_ID) return true;
    return false;
}

async function buildAdventureBookOverlayIntercept(context, tools, descriptor, request = {}) {
    const settings = tools.settings.getSelf() || {};
    const restoredBook = loadBookState(tools, settings);
    const preparedState = restoredBook?.currentState || descriptor?.payload?.initialState || descriptor?.payload?.state || null;
    const replayHint = request?.checkpointContext?.isReplay === true
        || request?.checkpointContext?.turnPayload?.isReplay === true
        || descriptor?.payload?.isReplay === true;
    const interactionMode = getBookInteractionMode(restoredBook, replayHint ? 'readonly_replay' : descriptor?.payload?.interactionMode);
    const chapters = restoredBook?.chapters || buildChapterList({
        initialState: preparedState,
        currentState: preparedState
    });
    return {
        js: PIXI_UI_JS,
        renderer: 'pixi',
        autoDismiss: false,
        timeoutMs: PERSISTENT_INTERCEPT_TIMEOUT_MS,
        keepVNViewportDuringTakeover: true,
        keepVNChrome: true,
        keepVNAudioDuringTakeover: true,
        keepVNPixiRuntimeDuringTakeover: true,
        visualState: {
            keepVNViewportDuringTakeover: true,
            keepVNAudioDuringTakeover: true,
            keepVNPixiRuntimeDuringTakeover: true
        },
        payload: {
            maxSteps: resolveMaxSteps(settings),
            showExactOdds: settings.show_exact_odds !== false,
            initialState: preparedState,
            chapters,
            currentChapterIndex: restoredBook?.currentChapterIndex || preparedState?.stepIndex || preparedState?.chapterIndex || 1,
            interactionMode,
            bookStatus: restoredBook?.status || 'active',
            startEventName: START_EVENT,
            advanceEventName: ADVANCE_EVENT,
            rollEventName: ROLL_EVENT,
            rebuildEventName: REBUILD_EVENT,
            cgEventName: CG_EVENT,
            finalizeEventName: FINALIZE_EVENT,
            cgVisualStyle: normalizeCgVisualStyle(settings.cg_visual_style),
            debugMode: isDebugMode(settings),
            debugRebuildEnabled: isDebugMode(settings),
            autoGenerateCg: isCgGenerationEnabled(settings) && tools.plugins?.isInstalled?.('cg_generator') === true
        }
    };
}

function resolveGuiInterceptBuilder(descriptor) {
    const handlerRef = toStringSafe(descriptor?.handlerRef, '');
    if (handlerRef.endsWith('adventure_book_overlay')) return buildAdventureBookOverlayIntercept;

    const interceptId = toStringSafe(descriptor?.interceptId || descriptor?.id, '');
    if (interceptId.startsWith(MAIN_INTERCEPT_ID_PREFIX)) return buildAdventureBookOverlayIntercept;

    return null;
}

async function buildGuiIntercept(context, tools, descriptor, request) {
    const builder = resolveGuiInterceptBuilder(descriptor || request?.descriptor || {});
    if (typeof builder === 'function') return builder(context, tools, descriptor, request);
    return buildAdventureBookOverlayIntercept(context, tools, descriptor || request?.descriptor || {});
}

async function runDirectorPrePrompt(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (settings.enabled === false) return;
    if (context?.sceneMode !== 'mainline') return;

    const addenda = context?.runtime?.scenePhaseClassifier?.definitionAddenda;
    if (Array.isArray(addenda)) {
        addenda.push({
            phase: 'ADVENTURE_BOOK',
            pluginId: PLUGIN_ID,
            text: CLASSIFIER_ADDENDUM
        });
    }

    tools.director.registerCapability({
        phase: 'ADVENTURE_BOOK',
        description: DIRECTOR_DESCRIPTION_PROMPT,
        handoffHint: DIRECTOR_HANDOFF_PROMPT
    });
}

async function runPostVnGeneration(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (!shouldOfferAdventureBook(context, settings)) return;

    const parentTurnNumber = toInt(context?.turnNumber, null);
    if (!Number.isInteger(parentTurnNumber) || parentTurnNumber < 1) return;

    const interceptId = `${MAIN_INTERCEPT_ID_PREFIX}${parentTurnNumber}`;
    if (hasRegisteredIntercept(context, interceptId)) return;

    const prepared = await getOrCreateBookState(parentTurnNumber, tools, settings);

    tools.gui.registerPersistentIntercept({
        interceptId,
        checkpoint: 'during_user_input',
        blocking: true,
        renderer: 'pixi',
        autoDismiss: false,
        timeoutMs: PERSISTENT_INTERCEPT_TIMEOUT_MS,
        priority: 118,
        replayPolicy: 'every_enter',
        keepVNViewportDuringTakeover: true,
        keepVNChrome: true,
        keepVNAudioDuringTakeover: true,
        keepVNPixiRuntimeDuringTakeover: true,
        visualState: {
            keepVNViewportDuringTakeover: true,
            keepVNAudioDuringTakeover: true,
            keepVNPixiRuntimeDuringTakeover: true
        },
        handlerRef: 'guiIntercepts.adventure_book_overlay',
        payload: {
            maxSteps: resolveMaxSteps(settings),
            showExactOdds: settings.show_exact_odds !== false,
            initialState: prepared.state,
            chapters: prepared.chapters || [],
            currentChapterIndex: prepared.currentChapterIndex || prepared.state?.stepIndex || prepared.state?.chapterIndex || 1,
            interactionMode: 'active',
            bookStatus: 'active',
            startEventName: START_EVENT,
            advanceEventName: ADVANCE_EVENT,
            rollEventName: ROLL_EVENT,
            rebuildEventName: REBUILD_EVENT,
            cgEventName: CG_EVENT,
            finalizeEventName: FINALIZE_EVENT,
            cgVisualStyle: normalizeCgVisualStyle(settings.cg_visual_style),
            debugMode: isDebugMode(settings),
            debugRebuildEnabled: isDebugMode(settings),
            autoGenerateCg: isCgGenerationEnabled(settings) && tools.plugins?.isInstalled?.('cg_generator') === true
        }
    });
}

async function getOrCreateBookState(parentTurnNumber, tools, settings) {
    const persisted = loadBookState(tools, settings);
    if (persisted?.status !== 'finalized') {
        const snapshot = getBookSnapshot(persisted);
        if (snapshot) return { state: snapshot.state, currentChapterIndex: snapshot.currentChapterIndex, chapters: snapshot.chapters };
    }

    return createBookState(parentTurnNumber, tools, settings);
}

async function createBookState(parentTurnNumber, tools, settings) {
    const turn = await tools.turns?.getByCreationTurnNumber?.(parentTurnNumber);
    const parentContext = turn?.context || tools.turnContext;
    const { state, messages } = await generateInitialState(parentContext, tools, settings);
    const book = {
        status: 'active',
        currentChapterIndex: state.stepIndex || state.chapterIndex || 1,
        currentState: state,
        state,
        initialState: state,
        settings,
        messages,
        maxSteps: state.maxSteps || resolveMaxSteps(settings),
        failurePressure: 0,
        criticalFailures: 0,
        criticalSuccesses: 0,
        transcript: [],
        chapters: [normalizeChapterSnapshot({ chapterIndex: state.stepIndex || state.chapterIndex || 1, state }, 1)],
        pendingRolls: {},
        createdAt: Date.now()
    };
    saveBookState(tools, book);
    return { state, currentChapterIndex: book.currentChapterIndex, chapters: book.chapters };
}

async function startChallengeSocket(data, tools) {
    try {
        const settings = tools.settings.getSelf() || {};
        if (settings.enabled === false) {
            emitResponse(tools, START_EVENT, { success: false, error: 'Adventure Book is disabled.' });
            return;
        }

        const snapshot = getBookSnapshot(loadBookState(tools, settings));
        if (!snapshot) {
            emitResponse(tools, START_EVENT, {
                success: false,
                error: 'Adventure Book was not pre-generated for this turn.'
            });
            return;
        }

        emitResponse(tools, START_EVENT, { success: true, ...snapshot });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to start challenge`, error);
        emitResponse(tools, START_EVENT, { success: false, error: error.message });
    }
}

async function rebuildChallengeSocket(data, tools) {
    try {
        const settings = tools.settings.getSelf() || {};
        if (settings.enabled === false) {
            emitResponse(tools, REBUILD_EVENT, { success: false, error: 'Adventure Book is disabled.' });
            return;
        }
        if (!isDebugMode(settings)) {
            emitResponse(tools, REBUILD_EVENT, { success: false, error: 'Adventure Book rebuild is only available while Debug Mode is enabled.' });
            return;
        }
        const existingBook = loadBookState(tools, settings);
        if (existingBook && !isBookMutable(existingBook)) {
            emitReadonlyError(tools, REBUILD_EVENT);
            return;
        }

        const parentTurnNumber = toInt(tools?.turnContext?.turnNumber, null);
        if (!Number.isInteger(parentTurnNumber) || parentTurnNumber < 1) {
            emitResponse(tools, REBUILD_EVENT, { success: false, error: 'Invalid parent turn.' });
            return;
        }

        const rebuilt = await createBookState(parentTurnNumber, tools, settings);
        const rebuiltBook = loadBookState(tools, settings);
        let cg = null;
        if (data?.generateCg === true) {
            cg = rebuiltBook ? await requestCgForSession(rebuiltBook, tools) : { ok: false, error: 'Rebuilt book missing.' };
            if (cg?.cgImagePath) rebuilt.state.cgImagePath = cg.cgImagePath;
            if (rebuiltBook) saveBookState(tools, rebuiltBook);
        }
        emitResponse(tools, REBUILD_EVENT, {
            success: true,
            rebuilt: true,
            cg,
            ...rebuilt,
            chapters: rebuiltBook?.chapters || rebuilt.chapters || [],
            interactionMode: 'active',
            bookStatus: 'active'
        });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to rebuild challenge`, error);
        emitResponse(tools, REBUILD_EVENT, { success: false, error: error.message });
    }
}

async function generateCgSocket(data, tools) {
    const requestId = toStringSafe(data?.requestId, '');
    const respond = (payload) => {
        logInfo(tools, `[${PLUGIN_ID}] CG socket emitting response request=${requestId || '(none)'} success=${payload?.success === true} error=${payload?.error || payload?.cg?.error || ''}.`);
        emitResponse(tools, CG_EVENT, requestId ? { requestId, ...(payload || {}) } : payload);
    };
    try {
        const settings = tools.settings.getSelf() || {};
        const chapterIndex = toInt(data?.chapterIndex, null);
        logInfo(tools, `[${PLUGIN_ID}] CG socket request received chapter=${chapterIndex ?? '(current)'} request=${requestId || '(none)'}.`);
        const book = loadBookState(tools, settings);
        if (!book) {
            tools.logger?.warn?.(`[${PLUGIN_ID}] CG socket could not load current Adventure Book state.`);
            respond({ success: false, error: 'Adventure Book state not found.' });
            return;
        }
        if (!isBookMutable(book)) {
            respond({ success: false, error: 'Adventure Book is read-only for this turn.' });
            return;
        }

        const cg = await requestCgForSession(book, tools);
        if (cg?.cgImagePath) book.currentState.cgImagePath = cg.cgImagePath;
        syncCurrentChapter(book);
        saveBookState(tools, book);
        logInfo(tools, `[${PLUGIN_ID}] CG socket responding: ${cg?.ok === false ? `failed (${cg?.error || 'unknown'})` : 'ok'}.`);
        respond({
            success: cg?.ok !== false,
            chapterIndex: book.currentChapterIndex,
            state: book.currentState,
            currentState: book.currentState,
            chapters: book.chapters || [],
            interactionMode: 'active',
            bookStatus: book.status || 'active',
            cg,
            error: cg?.ok === false ? cg?.error || 'CG generation failed.' : undefined
        });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to generate Adventure Book CG`, error);
        respond({ success: false, error: error.message });
    }
}

async function rollChallengeSocket(data, tools) {
    try {
        const settings = tools.settings.getSelf() || {};
        const optionKey = toStringSafe(data?.optionKey, '');
        const book = loadBookState(tools, settings);
        if (!book) {
            emitResponse(tools, ROLL_EVENT, { success: false, error: 'Adventure Book state not found.' });
            return;
        }
        if (!isBookMutable(book)) {
            emitReadonlyError(tools, ROLL_EVENT);
            return;
        }

        const option = findStateOption(book.currentState, optionKey);
        if (!option) {
            emitResponse(tools, ROLL_EVENT, { success: false, error: 'Unknown Adventure Book option.' });
            return;
        }
        if (option.resolutionType === 'automatic') {
            emitResponse(tools, ROLL_EVENT, { success: false, error: 'This Adventure Book option is certain and does not require a roll.' });
            return;
        }

        const rollResult = buildRollResult(option, rollD20());
        const pendingRollId = createPendingRollId();
        const pendingRolls = ensurePendingRolls(book);
        pendingRolls[pendingRollId] = {
            pendingRollId,
            optionKey,
            rollResult,
            createdAt: Date.now()
        };
        saveBookState(tools, book);

        emitResponse(tools, ROLL_EVENT, {
            success: true,
            chapterIndex: book.currentChapterIndex,
            optionKey,
            pendingRollId,
            roll: rollResult
        });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to roll challenge die`, error);
        emitResponse(tools, ROLL_EVENT, { success: false, error: error.message });
    }
}

async function advanceChallengeSocket(data, tools) {
    try {
        const settings = tools.settings.getSelf() || {};
        const optionKey = toStringSafe(data?.optionKey, '');
        const pendingRollId = toStringSafe(data?.pendingRollId, '');
        const book = loadBookState(tools, settings);
        if (!book) {
            emitResponse(tools, ADVANCE_EVENT, { success: false, error: 'Adventure Book state not found.' });
            return;
        }
        if (!isBookMutable(book)) {
            emitReadonlyError(tools, ADVANCE_EVENT);
            return;
        }

        const option = findStateOption(book.currentState, optionKey);
        if (!option) {
            emitResponse(tools, ADVANCE_EVENT, { success: false, error: 'Unknown Adventure Book option.' });
            return;
        }

        const isAutomatic = option.resolutionType === 'automatic';
        let rollResult = null;
        if (isAutomatic) {
            rollResult = buildRollResult(option, null);
        } else if (pendingRollId) {
            const pendingRolls = ensurePendingRolls(book);
            const pendingRoll = pendingRolls[pendingRollId];
            if (!pendingRoll || pendingRoll.optionKey !== optionKey) {
                emitResponse(tools, ADVANCE_EVENT, { success: false, error: 'Adventure Book roll expired or does not match this option.' });
                return;
            }
            rollResult = pendingRoll.rollResult;
            delete pendingRolls[pendingRollId];
        } else {
            rollResult = buildRollResult(option, rollD20());
        }
        const outcome = rollResult.outcome;
        const generated = await generateAdvanceState(book, tools, option, rollResult);
        const memoryImpact = buildMemoryImpact(option, rollResult, generated.resultText);
        const transcriptEntry = {
            option,
            roll: rollResult,
            resultText: generated.resultText,
            memoryImpact,
            state: generated.state
        };
        book.transcript.push(transcriptEntry);
        if (outcome === 'critical_failure') {
            book.criticalFailures = toInt(book.criticalFailures, 0) + 1;
            book.failurePressure = toInt(book.failurePressure, 0) + 2;
        } else if (outcome === 'failure') {
            book.failurePressure = toInt(book.failurePressure, 0) + 1;
        } else if (outcome === 'critical_success') {
            book.criticalSuccesses = toInt(book.criticalSuccesses, 0) + 1;
            book.failurePressure = Math.max(0, toInt(book.failurePressure, 0) - 1);
        }
        book.currentState = generated.state;
        book.state = generated.state;
        const nextChapterIndex = toInt(book.currentChapterIndex, 1) + 1;
        book.currentState.chapterIndex = nextChapterIndex;
        book.currentState.stepIndex = nextChapterIndex;
        book.currentChapterIndex = nextChapterIndex;
        const chapterSnapshot = normalizeChapterSnapshot({
            chapterIndex: nextChapterIndex,
            state: book.currentState,
            selectedOption: option,
            roll: rollResult,
            resultText: generated.resultText
        }, nextChapterIndex);
        book.chapters = buildChapterList({
            chapters: book.chapters,
            initialState: book.initialState,
            currentState: book.currentState,
            transcript: book.transcript
        });
        const existingChapterIndex = book.chapters.findIndex(chapter => chapter.chapterIndex === chapterSnapshot.chapterIndex);
        if (existingChapterIndex >= 0) book.chapters[existingChapterIndex] = chapterSnapshot;
        else book.chapters.push(chapterSnapshot);
        book.chapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
        book.pendingRolls = {};
        saveBookState(tools, book);

        emitResponse(tools, ADVANCE_EVENT, {
            success: true,
            chapterIndex: book.currentChapterIndex,
            roll: rollResult,
            transcriptEntry,
            state: generated.state,
            currentState: generated.state,
            chapters: book.chapters || [],
            interactionMode: getBookInteractionMode(book),
            bookStatus: book.status || 'active'
        });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to advance challenge`, error);
        emitResponse(tools, ADVANCE_EVENT, { success: false, error: error.message });
    }
}

async function storeChallengeFacts(tools, book, capsule) {
    try {
        const turnNumber = toInt(tools?.turnContext?.turnNumber, 0);
        await tools.facts.appendToFactsDb({
            source: PLUGIN_ID,
            target: PLUGIN_ID,
            predicate: CHALLENGE_FACT_PREDICATE,
            fact_value: JSON.stringify({
                turnNumber,
                title: capsule.title,
                summary: capsule.summary,
                sceneEnding: capsule.sceneEnding,
                choices: book.transcript.map(entry => ({
                    optionKey: entry.option?.optionKey,
                    label: entry.option?.label,
                    roll: entry.roll
                }))
            }),
            context: buildTranscript(book)
        }, {
            turn_number: turnNumber,
            turn_key: String(turnNumber),
            scene_mode: 'mainline',
            interlude_id: null,
            interlude_ordinal: null,
            plugin_id: PLUGIN_ID
        });
    } catch (error) {
        tools.logger.warn(`[${PLUGIN_ID}] Failed to persist challenge facts.`, error);
    }
}

async function maybeRequestCg(book, tools, transcript) {
    const settings = book.settings || {};
    if (!isCgGenerationEnabled(settings)) return null;
    if (!tools.plugins.isInstalled('cg_generator')) return null;

    try {
        return await requestCgForSession(book, tools, transcript);
    } catch (error) {
        tools.logger.warn(`[${PLUGIN_ID}] Optional CG request failed.`, error);
        return null;
    }
}

function buildCgPromptForState(state = {}, transcript = '') {
    const pages = Array.isArray(state.pages) ? state.pages : [];
    const storySource = state.storyText || pages
        .map(page => typeof page === 'string' ? page : page?.body || page?.text || page?.content || '')
        .filter(Boolean)
        .join('\n\n');
    const storyExcerpt = limitAtNaturalBoundary(storySource || transcript, 900);
    const transcriptExcerpt = storySource ? limitAtNaturalBoundary(transcript, 500) : '';
    const prompt = [
        'Visual novel CG request for one Adventure Book chapter.',
        `Title: ${sanitizeText(state.title, 'Adventure Book', 90)}`,
        `Mode: ${sanitizeText(state.mode, 'Challenge', 60)}`,
        state.illustrationPrompt ? `Core visual: ${sanitizeText(state.illustrationPrompt, '', 320)}` : '',
        storyExcerpt ? `Scene excerpt: ${storyExcerpt}` : '',
        state.stakes ? `Mood and stakes: ${sanitizeText(state.stakes, '', 260)}` : '',
        transcriptExcerpt ? `Outcome context: ${transcriptExcerpt}` : '',
        [
            'Image requirements:',
            '- One polished visual-novel CG illustration.',
            '- Represent the whole chapter as a single atmospheric moment.',
            '- Focus on characters, setting, mood, and the active local complication.',
            '- No UI, no text, no captions, no dice, no book pages.'
        ].join('\n')
    ].filter(Boolean).join('\n\n');
    return limitAtNaturalBoundary(prompt, CG_PROMPT_MAX_CHARS);
}

function collectCgCharacterNames(state = {}) {
    const names = new Set();
    const add = (value) => {
        const clean = sanitizeText(value, '', 80);
        if (!clean || clean.toLowerCase() === 'party' || clean.toLowerCase() === 'the party') return;
        names.add(clean);
    };
    if (Array.isArray(state.party)) state.party.forEach(add);
    if (Array.isArray(state.options)) {
        for (const option of state.options) {
            add(option?.leadCharacter);
            if (Array.isArray(option?.helperCharacters)) option.helperCharacters.forEach(add);
        }
    }
    return [...names].slice(0, 6);
}

function buildCgVisualAdapter(state = {}, settings = {}, transcript = '') {
    const characters = collectCgCharacterNames(state);
    const storyExcerpt = limitAtNaturalBoundary(state.storyText || transcript, 850);
    const title = sanitizeText(state.title, 'Adventure Book', 90);
    const mode = sanitizeText(state.mode, 'Challenge', 60);
    const stakes = sanitizeText(state.stakes, '', 240);
    const visualPrompt = sanitizeText(state.illustrationPrompt, '', 420)
        || `${mode} scene from a bounded storybook challenge`;
    const atmosphere = [mode, stakes, visualPrompt].filter(Boolean).join('. ');

    const stanza = {
        index: 0,
        lines: [
            title,
            visualPrompt,
            storyExcerpt,
            stakes
        ].filter(Boolean),
        mood: stakes || mode,
        visualPrompt,
        relevantCharacters: characters,
        characters,
        characterBeats: characters.map(name => ({ name, emotion: 'neutral' })),
        environmentVibes: {
            atmosphere,
            visualMotifs: [
                state.mode,
                state.title,
                state.illustrationPrompt
            ].filter(Boolean)
        }
    };

    const manifest = {
        request: {
            title,
            reason: stakes || `Adventure Book ${mode} chapter`,
            mood: stakes || mode,
            styleHint: 'visual novel, painterly fantasy storybook CG',
            cgPromptMode: normalizeCgPromptMode(settings.cg_prompt_mode)
        },
        cg: {
            promptMode: normalizeCgPromptMode(settings.cg_prompt_mode),
            modelTier: normalizeCgModelTier(settings.cg_model_tier)
        },
        assets: {
            sprites: []
        }
    };

    return { manifest, stanza };
}

async function buildCgRequestForSessionState(state = {}, settings = {}, tools = {}, outputPath = '', transcript = '') {
    const promptMode = normalizeCgPromptMode(settings.cg_prompt_mode);
    const { manifest, stanza } = buildCgVisualAdapter(state, { ...settings, cg_prompt_mode: promptMode }, transcript);
    tools.logger?.info?.(`[${PLUGIN_ID}] Building CG request (${promptMode}) for "${state.title || 'Adventure Book'}".`);
    const fallbackPrompt = buildCgPromptForState(state, transcript);
    const fallbackPlan = {
        request: {
            prompt: fallbackPrompt,
            modelTier: normalizeCgModelTier(settings.cg_model_tier),
            outputPath
        },
        promptMode,
        promptSource: 'adventure_book_fallback',
        references: [],
        prompt: fallbackPrompt
    };

    // Arc Cinematics is optional. Ask its public API for richer CG prompting
    // when active, but retain a complete Adventure Book-only fallback.
    const canUseArcCinematics = tools?.plugins?.isInstalled?.('arc_cinematics')
        && typeof tools?.plugins?.tryCall === 'function';
    let cgPlan = fallbackPlan;
    if (canUseArcCinematics) {
        const arcSettings = {
            ...settings,
            model_def: settings.model_def || { model: 'mediumendmodel' },
            cg_model_tier: normalizeCgModelTier(settings.cg_model_tier),
            cg_prompt_mode: promptMode
        };
        if (promptMode === 'diffusion_positive') {
            const arcPrompt = await tools.plugins.tryCall(
                'arc_cinematics',
                'buildDiffusionPromptFallback',
                [stanza, manifest],
                { silent: true, fallback: fallbackPrompt }
            );
            const prompt = String(arcPrompt || fallbackPrompt);
            cgPlan = {
                ...fallbackPlan,
                request: { ...fallbackPlan.request, prompt },
                prompt,
                promptSource: prompt === fallbackPrompt ? fallbackPlan.promptSource : 'arc_cinematics'
            };
        } else {
            const arcPlan = await tools.plugins.tryCall(
                'arc_cinematics',
                'buildCgRequestForStanza',
                [manifest, stanza, arcSettings, outputPath],
                { silent: true, fallback: fallbackPlan }
            );
            if (arcPlan && typeof arcPlan === 'object') cgPlan = arcPlan;
        }
    }
    const prompt = limitAtNaturalBoundary(cgPlan.prompt || buildCgPromptForState(state, transcript), CG_PROMPT_MAX_CHARS);
    const request = {
        ...cgPlan.request,
        text: prompt,
        prompt,
        modelTier: normalizeCgModelTier(settings.cg_model_tier),
        outputPath,
        filePrefix: `adventure_book`,
        aspectRatio: '2:3',
        imageResolution: '1024x1536',
        imageSizeOverride: '1024x1536',
        size: '1024x1536',
        emitSocket: false
    };
    if (Array.isArray(cgPlan.references) && cgPlan.references.length > 0) {
        request.references = cgPlan.references;
    }
    return {
        request,
        prompt,
        promptMode: cgPlan.promptMode || promptMode,
        promptSource: cgPlan.promptSource || 'direct',
        references: cgPlan.references || []
    };
}

async function requestCgForSession(book, tools, transcript = '') {
    if (!tools?.plugins?.isInstalled?.('cg_generator')) {
        tools.logger?.warn?.(`[${PLUGIN_ID}] CG requested but cg_generator is not installed.`);
        return { ok: false, error: 'cg_generator is not installed.' };
    }

    const chapterIndex = toInt(book.currentChapterIndex, book.currentState?.stepIndex || 1);
    logInfo(tools, `[${PLUGIN_ID}] Preparing CG for current book chapter=${chapterIndex}.`);
    const storage = tools.project?.getChatPluginStorage?.();
    logInfo(tools, `[${PLUGIN_ID}] CG storage for current book: relative=${storage?.relativePath || '(missing)'} absolute=${storage?.absolutePath || '(missing)'}.`);
    const provisionalOutputPath = storage?.relativePath
        ? toPosix(`${storage.relativePath}/cg_chapter_${chapterIndex}.webp`)
        : `plugins/Main/current/${PLUGIN_ID}/cg_chapter_${chapterIndex}.webp`;
    logInfo(tools, `[${PLUGIN_ID}] Building CG request for current book chapter=${chapterIndex}.`);
    const cgPlan = await buildCgRequestForSessionState(book.currentState || book.state, book.settings || {}, tools, provisionalOutputPath, transcript);
    const requestHash = hashCgPromptRequest(cgPlan.request);
    const pendingKey = `${storage?.relativePath || 'current'}:${chapterIndex}:${requestHash}`;
    const cachedPath = getCachedCgImagePath(storage, requestHash);
    logInfo(tools, `[${PLUGIN_ID}] CG plan ready for current book: hash=${requestHash} promptMode=${cgPlan.promptMode || '(unknown)'} promptChars=${String(cgPlan.prompt || cgPlan.request?.prompt || '').length}.`);
    if (cachedPath) {
        const projectPath = toProjectAssetPath(cachedPath);
        book.currentState.cgImagePath = projectPath;
        book.currentState.cgStatus = 'ready';
        book.currentState.cgPrompt = cgPlan.prompt || cgPlan.request?.prompt || '';
        book.currentState.cgPromptHash = requestHash;
        book.currentState.cgOutputPath = cachedPath;
        book.currentState.cgError = '';
        book.currentState.cgCompletedAt = Date.now();
        book.state = book.currentState;
        saveBookState(tools, book);
        logInfo(tools, `[${PLUGIN_ID}] Reusing cached CG for current book (${requestHash}).`);
        return {
            ok: true,
            cached: true,
            promptHash: requestHash,
            outputPath: cachedPath,
            cgImagePath: projectPath
        };
    }

    if (pendingCgRequests.has(pendingKey)) {
        logInfo(tools, `[${PLUGIN_ID}] Joining pending CG request for current book (${requestHash}).`);
        return await pendingCgRequests.get(pendingKey);
    }

    const outputPath = storage?.relativePath
        ? toPosix(`${storage.relativePath}/cg_chapter_${chapterIndex}_${requestHash}.webp`)
        : provisionalOutputPath;
    cgPlan.request.outputPath = outputPath;
    cgPlan.request.filePrefix = `adventure_book_chapter_${chapterIndex}`;
    book.currentState.cgStatus = 'pending';
    book.currentState.cgPrompt = cgPlan.prompt || cgPlan.request?.prompt || '';
    book.currentState.cgPromptHash = requestHash;
    book.currentState.cgOutputPath = outputPath;
    book.currentState.cgError = '';
    book.currentState.cgRequestedAt = Date.now();
    book.state = book.currentState;
    saveBookState(tools, book);

    const requestPromise = (async () => {
        logInfo(tools, `[${PLUGIN_ID}] Requesting CG for current book (${requestHash}) -> ${outputPath}.`);
        logInfo(tools, `[${PLUGIN_ID}] Calling cg_generator.requestCustomCGToFile for current book.`);
        const result = await tools.plugins.tryCall('cg_generator', 'requestCustomCGToFile', [cgPlan.request], {
            silent: true,
            fallback: { ok: false, error: 'cg_generator unavailable' }
        });

        const normalized = result && typeof result === 'object' ? result : { ok: false, error: 'cg_generator returned no result.' };
        logInfo(tools, `[${PLUGIN_ID}] cg_generator returned for current book: ok=${normalized.ok === true} output=${normalized.outputPath || '(none)'} error=${normalized.error || ''}.`);
        if (normalized.ok === true && normalized.outputPath) {
            const projectPath = toProjectAssetPath(normalized.outputPath);
            rememberCachedCgImagePath(storage, requestHash, normalized.outputPath);
            book.currentState.cgImagePath = projectPath;
            book.currentState.cgStatus = 'ready';
            book.currentState.cgOutputPath = normalized.outputPath;
            book.currentState.cgError = '';
            book.currentState.cgCompletedAt = Date.now();
            book.state = book.currentState;
            saveBookState(tools, book);
            logInfo(tools, `[${PLUGIN_ID}] CG ready for current book: ${normalized.outputPath}.`);
            return { ...normalized, cached: false, promptHash: requestHash, cgImagePath: projectPath };
        }

        book.currentState.cgStatus = 'failed';
        book.currentState.cgError = sanitizeText(normalized.error || 'CG generation failed.', 'CG generation failed.', 500);
        book.currentState.cgCompletedAt = Date.now();
        book.state = book.currentState;
        saveBookState(tools, book);
        tools.logger?.warn?.(`[${PLUGIN_ID}] CG request failed for current book: ${normalized.error || 'unknown error'}`);
        return normalized;
    })().finally(() => {
        pendingCgRequests.delete(pendingKey);
    });

    pendingCgRequests.set(pendingKey, requestPromise);
    return await requestPromise;
}

async function finalizeChallengeSocket(_data, tools) {
    try {
        const settings = tools.settings.getSelf() || {};
        const book = loadBookState(tools, settings);
        if (!book) {
            emitResponse(tools, FINALIZE_EVENT, { success: false, error: 'Adventure Book state not found.' });
            return;
        }
        if (!isBookMutable(book)) {
            emitReadonlyError(tools, FINALIZE_EVENT);
            return;
        }

        const transcript = buildTranscript(book);
        const capsule = await generateFinalCapsule(book, tools, transcript);
        const continuationPrompt = buildContinuationUserPrompt(capsule);

        await storeChallengeFacts(tools, book, capsule);
        book.status = 'finalized';
        book.currentState = book.currentState || book.state;
        book.state = book.currentState;
        syncCurrentChapter(book);
        saveBookState(tools, book);

        emitResponse(tools, FINALIZE_EVENT, {
            success: true,
            title: capsule.title,
            summary: capsule.summary,
            sceneEnding: capsule.sceneEnding,
            bridgePrompt: continuationPrompt,
            continuationPrompt
        });
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed to finalize challenge`, error);
        emitResponse(tools, FINALIZE_EVENT, { success: false, error: error.message });
    }
}

module.exports = {
    PLUGIN_ID,
    START_EVENT,
    ROLL_EVENT,
    ADVANCE_EVENT,
    REBUILD_EVENT,
    CG_EVENT,
    FINALIZE_EVENT,
    SETTINGS_SCHEMA,
    deriveD20Target,
    resolveRollOutcome,
    normalizeOption,
    shouldOfferAdventureBook,
    buildAdventureBookOverlayIntercept,
    buildGuiIntercept,
    runDirectorPrePrompt,
    runPostVnGeneration,
    startChallengeSocket,
    rollChallengeSocket,
    rebuildChallengeSocket,
    generateCgSocket,
    advanceChallengeSocket,
    finalizeChallengeSocket,
    _private: {
        normalizeCgModelTier,
        normalizeCgPromptMode,
        normalizeCgVisualStyle,
        isCgGenerationEnabled,
        clearCgStateForNewChapter,
        repairMismatchedCurrentCgState,
        maybeRequestCg,
        buildCgPromptForState,
        buildCgRequestForSessionState,
        paginateStoryText,
        rollD20,
        buildRollResult,
        storySimilarity,
        isStoryTooCloseToSource,
        buildPacingContract,
        buildChoiceContract,
        buildChapterList,
        normalizeChapterSnapshot,
        getBookSnapshot,
        buildInitialPrompt,
        buildAdvancePrompt,
        clearActiveSessionsForTests: () => pendingCgRequests.clear(),
        loadBookState,
        saveBookState,
        OPTION_SCHEMA,
        CHALLENGE_SCHEMA,
        ADVANCE_SCHEMA
    }
};
