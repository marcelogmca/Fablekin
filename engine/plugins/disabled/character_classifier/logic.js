// plugins/character_classifier/logic.js

const GENERIC_SPRITE_PROFILE_PREDICATE = 'GENERIC_SPRITE_PROFILE';
const GENERIC_VOICE_PROFILE_PREDICATE = 'GENERIC_VOICE_PROFILE';
const GENERIC_VOICE_AUTOMATIC_PROFILE_KEYS = new Set(['generic', 'male', 'female']);

/**
 * Extracts a targeted context window around mentions of a character.
 * @param {string} text - The full dialogue/narrative text.
 * @param {string} characterName - The name of the character to find.
 * @param {number} numMentions - The maximum number of distinct mentions to capture.
 * @param {number} contextLines - The number of lines before and after each mention to include.
 * @returns {string} The stitched and deduplicated context string.
 */
function extractRelevantContext(text, characterName, numMentions = 3, contextLines = 2) {
    if (!text || !characterName) return '';
    const lines = text.split('\n');
    const normalizedName = characterName.trim().toLowerCase();

    // Prefer lines spoken by the character before falling back to textual mentions.
    let mentionIndices = [];
    for (let i = 0; i < lines.length; i++) {
        const colonIndex = lines[i].indexOf(':');
        if (colonIndex !== -1 && lines[i].slice(0, colonIndex).trim().toLowerCase() === normalizedName) {
            mentionIndices.push(i);
        }
    }

    if (mentionIndices.length === 0) {
        const escapedName = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const strictRegex = new RegExp(`\\b${escapedName}\\b`, 'i');
        for (let i = 0; i < lines.length; i++) {
            if (strictRegex.test(lines[i])) {
                mentionIndices.push(i);
            }
        }
    }

    if (mentionIndices.length === 0) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(normalizedName)) {
                mentionIndices.push(i);
            }
        }
    }

    if (mentionIndices.length === 0) {
        return text.substring(0, 3000);
    }

    const targetIndices = mentionIndices.slice(0, numMentions);
    const linesToInclude = new Set();

    for (const idx of targetIndices) {
        const start = Math.max(0, idx - contextLines);
        const end = Math.min(lines.length - 1, idx + contextLines);
        for (let j = start; j <= end; j++) {
            linesToInclude.add(j);
        }
    }

    const sortedIndices = Array.from(linesToInclude).sort((a, b) => a - b);
    const resultLines = [];
    let lastIdx = -1;

    for (const idx of sortedIndices) {
        if (lastIdx !== -1 && idx > lastIdx + 1) {
            resultLines.push('...');
        }
        resultLines.push(lines[idx]);
        lastIdx = idx;
    }

    let result = resultLines.join('\n');
    if (result.length > 3000) {
        result = result.substring(0, 3000); // hard cap just in case
    }
    return result;
}

function normalizeImportance(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'core' || normalized === 'major' || normalized === 'minor' || normalized === 'noncharacter') {
        return normalized;
    }
    return null;
}

function parseJsonObject(input) {
    if (!input) return null;
    if (typeof input === 'object') return input;
    if (typeof input !== 'string') return null;

    try {
        return JSON.parse(input);
    } catch {
        const match = input.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function normalizeGenericSpriteProfileKey(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized || ['null', 'none', 'unknown', 'n/a', 'na'].includes(normalized)) return '';
    return normalized;
}

function getGenericProfileCatalog(turnContext) {
    const profiles = turnContext?.runtime?.vnManager?.spriteCatalog?.global?.genericProfiles;
    return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

function getAvailableGenericSpriteProfileKeys(turnContext, options = {}) {
    const includeGeneric = options.includeGeneric === true;
    const profiles = getGenericProfileCatalog(turnContext);
    const keys = Object.keys(profiles).filter(key => {
        const files = profiles[key]?.files;
        return Array.isArray(files) && files.length > 0;
    }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (includeGeneric) return keys;
    return keys.filter(key => key !== 'generic');
}

function buildGenericSpriteProfilePromptParts(turnContext, characterName = 'this character') {
    const semanticProfileKeys = getAvailableGenericSpriteProfileKeys(turnContext);
    if (semanticProfileKeys.length === 0) {
        return { section: '', outputField: '', allowedKeys: new Set() };
    }

    const allProfileKeys = getAvailableGenericSpriteProfileKeys(turnContext, { includeGeneric: true });
    const profileList = allProfileKeys.map(key => `- "${key}"`).join('\n');

    return {
        section: `\n[GENERIC SPRITE PROFILE CRITERIA]\nThe project has semantic generic sprite profiles for characters without dedicated sprites.\nChoose the best generic sprite profile for "${characterName}" if context supports one.\nAllowed values:\n${profileList}\nUse null if none fit or the context is too ambiguous.\n`,
        outputField: ',\n  "genericSpriteProfile": "profile_key|null"',
        allowedKeys: new Set(allProfileKeys)
    };
}

function resolveGenericSpriteProfileFromResponse(value, turnContext) {
    const profileKey = normalizeGenericSpriteProfileKey(value);
    if (!profileKey) return null;

    const allowedKeys = buildGenericSpriteProfilePromptParts(turnContext).allowedKeys;
    return allowedKeys.has(profileKey) ? profileKey : null;
}

function normalizeGenericVoiceProfileKey(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized || ['null', 'none', 'unknown', 'n/a', 'na'].includes(normalized)) return '';
    return normalized;
}

function getGenericVoiceProfileCatalog(turnContext) {
    const profiles = turnContext?.runtime?.ttsCore?.voiceCatalog?.genericProfiles;
    return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

function getAvailableGenericVoiceProfileKeys(turnContext, options = {}) {
    const includeAutomatic = options.includeAutomatic === true;
    const profiles = getGenericVoiceProfileCatalog(turnContext);
    const keys = Object.keys(profiles).filter(key => {
        const files = profiles[key]?.files;
        return Array.isArray(files) && files.length > 0;
    }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (includeAutomatic) return keys;
    return keys.filter(key => !GENERIC_VOICE_AUTOMATIC_PROFILE_KEYS.has(key));
}

function buildGenericVoiceProfilePromptParts(tools, turnContext, characterName = 'this character') {
    const ttsInstalled = !!tools?.plugins?.isInstalled?.('tts_core');
    if (!ttsInstalled) {
        return { section: '', outputField: '', allowedKeys: new Set() };
    }

    const semanticProfileKeys = getAvailableGenericVoiceProfileKeys(turnContext);
    if (semanticProfileKeys.length === 0) {
        return { section: '', outputField: '', allowedKeys: new Set() };
    }

    const profileList = semanticProfileKeys.map(key => `- "${key}"`).join('\n');

    return {
        section: `\n[GENERIC VOICE PROFILE CRITERIA]\nThe project has semantic generic voice profiles for characters without dedicated voice files.\nChoose the best generic voice profile for "${characterName}" when context supports one.\nAllowed values:\n${profileList}\nUse null if none fit or the context is too ambiguous.\n`,
        outputField: ',\n  "genericVoiceProfile": "profile_key|null"',
        allowedKeys: new Set(semanticProfileKeys)
    };
}

function resolveGenericVoiceProfileFromResponse(value, allowedKeys = new Set()) {
    const profileKey = normalizeGenericVoiceProfileKey(value);
    if (!profileKey) return null;
    return allowedKeys.has(profileKey) ? profileKey : null;
}

function getLineText(line) {
    if (!line) return '';
    if (typeof line.text === 'string') return line.text;
    if (typeof line.line === 'string') {
        const split = line.line.split(':');
        return split.length > 1 ? split.slice(1).join(':').trim() : line.line;
    }
    return '';
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

        const source = displayName.toLowerCase();
        if (!stats.has(source)) {
            stats.set(source, { displayName, lines: 0, chars: 0 });
        }

        const entry = stats.get(source);
        entry.lines += 1;
        entry.chars += getLineText(line).length;
    }

    return stats;
}

function getChapterTurnNumber(chapter, fallback = 0) {
    return Number(
        chapter?.turnNumber ??
        chapter?.turn_number ??
        chapter?.input?.turnNumber ??
        chapter?.metadata?.turnNumber ??
        fallback
    ) || fallback;
}

function getChapterDialogueLines(chapter) {
    return (
        chapter?.processed?.dialogueProcessor?.processedLines ||
        chapter?.processed?.vnManager?.processedLines ||
        chapter?.output?.sequence ||
        []
    );
}

function collectDialogueSamples(source, chapters, maxSamples = 6) {
    const samples = [];
    const sourceKey = String(source || '').toLowerCase();
    if (!sourceKey) return samples;

    for (const chapter of chapters) {
        if (samples.length >= maxSamples) break;
        const turn = getChapterTurnNumber(chapter);
        const lines = getChapterDialogueLines(chapter);
        for (const line of lines) {
            if (samples.length >= maxSamples) break;
            if (!line || line.type !== 'dialogue') continue;

            const speaker = String(line.character || '').trim();
            const text = getLineText(line);
            const speakerMatches = speaker.toLowerCase() === sourceKey;
            const textMentions = text.toLowerCase().includes(sourceKey);
            if (!speakerMatches && !textMentions) continue;

            samples.push(`[Turn ${turn}] ${speaker || 'Narrator'}: ${text}`.slice(0, 240));
        }
    }

    return samples;
}

/**
 * Tier 1: Structural Heuristics (Auto-Reject Non-Characters)
 * Catches things that are structurally impossible to be characters under any normal narrative convention.
 */
function isEntityCandidate(characterName) {
    if (!characterName || typeof characterName !== 'string') return false;
    const trimmed = characterName.trim();
    const lower = trimmed.toLowerCase();

    // 1. Time expressions (e.g., "10:00 AM", "5:30", "3 PM", "Five O'Clock")
    if (/^\d{1,2}[:.]\d{2}\s*(AM|PM)?$/i.test(trimmed)) return false;
    if (/^\d{1,2}\s*(AM|PM)$/i.test(trimmed)) return false;
    if (lower.endsWith("o'clock") || /^(half past|quarter to)\b/i.test(trimmed)) return false;

    // 2. Dates (e.g., "March 15th", "Jan 3")
    const MONTHS_REGEX = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;
    if (MONTHS_REGEX.test(trimmed) && /\d+/.test(trimmed)) return false;

    // 3. Durations (e.g., "3 hours later", "2 days ago")
    if (/^\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*(later|ago|earlier)?$/i.test(trimmed)) return false;

    return true;
}

/**
 * Tier 2: Context-Aware Signal Scoring
 * Calculates a confidence score based on narrative presence and linguistic structure.
 */
function computeCharacterConfidence(name, processedLines) {
    if (!name || !processedLines) return { score: 50, lineCount: 0, avgTextLength: 0 };
    
    let score = 50; // Neutral baseline
    const lowerName = name.toLowerCase();
    const nameTokens = tokenizeName(name);
    const isGenericRole = isGenericRoleLabel(name);
    const isLikelyNamed = isLikelyNamedIndividual(name);

    // Signal 1: Voice line count (more lines = more likely a real character)
    const voiceLines = processedLines.filter(l => l.type === 'dialogue' && l.character?.toLowerCase() === lowerName);
    const lineCount = voiceLines.length;
    
    if (lineCount >= 3) score += 20;
    else if (lineCount === 1) score -= 15;

    // Signal 2: Dialogue substance (does the character actually say meaningful things?)
    const totalChars = voiceLines.reduce((sum, l) => sum + (l.text?.length || 0), 0);
    const avgTextLength = lineCount > 0 ? totalChars / lineCount : 0;
    
    if (avgTextLength > 80) score += 15;  // Substantial dialogue
    if (lineCount > 0 && avgTextLength < 20) score -= 20;  // Grunts/Short responses

    // Signal 3: Name structure analysis
    if (/^[A-Z][a-z]+$/.test(name)) score += 10;            // Proper noun (Cyno)
    if (/^(The|A|An)\s/i.test(name)) score -= 15;           // Descriptor (The Girl)
    if (/^[A-Z][a-z]+'[a-z]+$/i.test(name)) score += 15;    // Fantasy name (Stella'rah)
    if (isLikelyNamed) score += 10;
    if (isGenericRole) score -= 15;

    // Signal 4: Interaction patterns (mentioned by others)
    const mentionedByOthers = processedLines.some(l => 
        l.character?.toLowerCase() !== lowerName && 
        (l.text || l.line || "").toLowerCase().includes(lowerName)
    );
    if (mentionedByOthers) score += 20;

    return {
        score: Math.max(0, Math.min(100, score)),
        lineCount,
        avgTextLength: Math.round(avgTextLength),
        mentionedByOthers,
        nameTokenCount: nameTokens.length,
        isGenericRole,
        isLikelyNamed
    };
}

function tokenizeName(name) {
    return String(name || '')
        .trim()
        .split(/\s+/)
        .map(part => part.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''))
        .filter(Boolean);
}

function hasGivenNameTokenShape(token) {
    return /^[A-Z][a-z]+(?:'[A-Za-z]+)?$/.test(token);
}

function isGenericRoleLabel(name) {
    const raw = String(name || '').trim();
    const tokens = tokenizeName(name);
    if (tokens.length === 0) return false;

    // Purely structural cues only (no role wordlist):
    // article-prefixed labels are often descriptive labels, not stable identities.
    if (/^(the|a|an)\b/i.test(raw)) return true;

    return false;
}

function isLikelyNamedIndividual(name) {
    const raw = String(name || '').trim();
    const tokens = tokenizeName(name);
    if (tokens.length === 0) return false;
    if (isGenericRoleLabel(name)) return false;

    if (/^(the|a|an)\b/i.test(raw)) return false;

    const hasGivenNameShape = tokens.some(token => hasGivenNameTokenShape(token));
    const hasTwoTokenPersonLikeShape =
        tokens.length === 2 && tokens.every(token => hasGivenNameTokenShape(token));
    const hasCodeNameShape = /^(Agent|Subject|Unit|No\.?)\s*[A-Za-z0-9-]+$/i.test(String(name || '').trim());
    return hasGivenNameShape || hasTwoTokenPersonLikeShape || hasCodeNameShape;
}

function shouldReclassifyMinorCharacter(characterName, turnContext, settings = {}) {
    if (!isEntityCandidate(characterName)) {
        return { shouldReclassify: false, reason: 'failed entity heuristics' };
    }

    const processedLines =
        turnContext.processed?.vnManager?.processedLines ||
        turnContext.processed?.dialogueProcessor?.processedLines ||
        [];
    const stats = computeCharacterConfidence(characterName, processedLines);
    const minScore = Number(settings.minor_reclassification_score ?? 70);
    const minLines = Number(settings.minor_reclassification_min_lines ?? 2);
    const minNamedAvgChars = Number(settings.minor_reclassification_named_min_avg_chars ?? 55);

    const namedReturn =
        stats.isLikelyNamed &&
        stats.lineCount >= minLines &&
        (stats.mentionedByOthers || stats.avgTextLength >= minNamedAvgChars) &&
        stats.score >= Math.max(55, minScore - 10);

    const substantialPresence =
        stats.lineCount >= minLines &&
        stats.avgTextLength >= 60 &&
        (stats.mentionedByOthers || stats.lineCount >= (minLines + 1)) &&
        stats.score >= minScore;

    const exceptionalGenericPresence =
        stats.isGenericRole &&
        stats.lineCount >= Math.max(5, minLines + 3) &&
        stats.avgTextLength >= 90 &&
        stats.mentionedByOthers &&
        stats.score >= minScore;

    const shouldReclassify = namedReturn || substantialPresence || exceptionalGenericPresence;
    const reason = [
        `score=${stats.score}`,
        `lines=${stats.lineCount}`,
        `avg=${stats.avgTextLength}`,
        stats.mentionedByOthers ? 'mentioned' : 'not-mentioned',
        stats.isLikelyNamed ? 'named' : stats.isGenericRole ? 'generic-role' : 'ambiguous-name'
    ].join(', ');

    return { shouldReclassify, reason, stats };
}

/**
 * Performs a combined triage (Gender + Importance) for a new character using LLM.
 * Implements a three-tier funnel to minimize LLM usage and filter garbage.
 */
async function triageCharacter(tools, characterName, turnContext) {
    if (!characterName || !turnContext) return null;

    const processedLines =
        turnContext.processed.vnManager?.processedLines ||
        turnContext.processed.dialogueProcessor?.processedLines ||
        [];
    const dialogue = turnContext.processed.dialogueProcessor?.dialogue || '';

    // --- TIER 1: HEURISTIC GATE ---
    if (!isEntityCandidate(characterName)) {
        tools.logger.runtime(`'${characterName}' failed Tier 1 heuristics. Auto-rejecting as noncharacter.`);
        return { gender: 'unknown', importance: 'noncharacter' };
    }

    // --- TIER 2: SIGNAL SCORING ---
    const stats = computeCharacterConfidence(characterName, processedLines);
    tools.logger.runtime(`'${characterName}' confidence score: ${stats.score}. (Lines: ${stats.lineCount}, AvgLen: ${stats.avgTextLength})`);

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const lowThreshold = settings.low_confidence_threshold ?? 30;

    if (stats.score < lowThreshold) {
        tools.logger.runtime(`'${characterName}' score below threshold (${lowThreshold}). Auto-rejecting as noncharacter.`);
        return { gender: 'unknown', importance: 'noncharacter' };
    }

    // --- TIER 3: LLM TRIAGE ---
    const path = require('path');
    const fs = require('fs/promises');
    const promptPath = path.join(__dirname, 'prompts/triage_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');

    const relevantDialogue = extractRelevantContext(dialogue, characterName, 3, 2);
    const projectDirectives = tools.directives.getFormatted('casting_logic', { header: '### CLASSIFICATION DIRECTIVES' });
    const genericSpriteProfilePrompt = buildGenericSpriteProfilePromptParts(turnContext, characterName);
    const genericVoiceProfilePrompt = buildGenericVoiceProfilePromptParts(tools, turnContext, characterName);
    const prompt = promptTemplate
        .replace('${characterName}', characterName)
        .replace('${voiceLineCount}', stats.lineCount)
        .replace('${avgTextLength}', stats.avgTextLength)
        .replace('${project_directives}', projectDirectives)
        .replace('${generic_sprite_profile_section}', genericSpriteProfilePrompt.section)
        .replace('${generic_sprite_profile_output_field}', genericSpriteProfilePrompt.outputField)
        .replace('${generic_voice_profile_section}', genericVoiceProfilePrompt.section)
        .replace('${generic_voice_profile_output_field}', genericVoiceProfilePrompt.outputField)
        .replace('${dialogue.substring(0, 3000)}', relevantDialogue);

    try {
        const messages = [{ role: 'user', content: prompt }];
        const modelDef = settings.model_def || { model: 'lowendmodel' };
        const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;
        const model = resolvedModelDef.model;
        const provider = resolvedModelDef.provider;

        tools.logger.runtime(`Requesting classification for '${characterName}' (Score: ${stats.score}). Model: ${model}.`);

        const response = await tools.llm.json({
            msg: `Character Classification`,
            messages,
            model,
            provider,
            params: {
                retries: settings.retries || 2,
                timeout: settings.timeout || 20000,
                temperature: 0.0,
                max_tokens: 220,
                callingModule: 'Plugin:character_classifier'
            }
        });

        const data = response.content || {};

        tools.logger.runtime(`LLM results for '${characterName}': Importance: ${data.importance}, Gender: ${data.gender}.`);

        const resolvedImportance = normalizeImportance(data.importance) || 'minor';
        const result = {
            gender: (data.gender || 'unknown').toLowerCase(),
            importance: resolvedImportance
        };

        const genericSpriteProfile = resolveGenericSpriteProfileFromResponse(data.genericSpriteProfile, turnContext);
        if (genericSpriteProfile) {
            result.genericSpriteProfile = genericSpriteProfile;
        }

        const genericVoiceProfile = resolveGenericVoiceProfileFromResponse(
            data.genericVoiceProfile,
            genericVoiceProfilePrompt.allowedKeys
        );
        if (genericVoiceProfile) {
            result.genericVoiceProfile = genericVoiceProfile;
        }

        return result;
    } catch (error) {
        tools.logger.error('Triage', `Failed to triage character '${characterName}': ${error.message}`);
        tools.logger.runtime(`CRITICAL ERROR during triage for '${characterName}': ${error.message}`);
        return null;
    }
}

/**
 * Classifies a character's gender only (used for character sheets).
 */
async function classifyGenderOnly(tools, characterName, relevantText) {
    const path = require('path');
    const fs = require('fs/promises');
    const promptPath = path.join(__dirname, 'prompts/gender_classifier_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const prompt = promptTemplate
        .replace('${characterName}', characterName)
        .replace('${project_directives}', tools.directives.getFormatted('casting_logic', { header: '### CLASSIFICATION DIRECTIVES' }))
        .replace('${relevantText.substring(0, 1000)}', relevantText.substring(0, 1000));

    try {
        const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
        const modelDef = settings.model_def || { model: 'lowendmodel' };
        const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;

        tools.logger.runtime(`Requesting gender-only classification for '${characterName}'.`);

        const response = await tools.llm.runTask({
            msg: `Character Classification`,
            messages: [{ role: 'user', content: prompt }],
            model: resolvedModelDef.model,
            provider: resolvedModelDef.provider,
            params: {
                retries: 2,
                timeout: 15000,
                temperature: 0.0,
                max_tokens: 10,
                callingModule: 'Plugin:character_classifier'
            }
        });

        const match = response.content.match(/\b(male|female)\b/i);
        const gender = match ? match[0].toLowerCase() : 'unknown';
        tools.logger.runtime(`Gender classification for '${characterName}': ${gender.toUpperCase()}.`);
        return gender;
    } catch (error) {
        tools.logger.runtime(`Error during gender-only classification for '${characterName}': ${error.message}`);
        return 'unknown';
    }
}

/**
 * Saves a character's importance to the database.
 */
async function saveImportanceFact(tools, characterName, importance) {
    try {
        const normalizedImportance = normalizeImportance(importance);
        if (!normalizedImportance) return;

        const existingImp = await getImportanceFact(tools, characterName);
        if (existingImp && existingImp === normalizedImportance) {
            tools.logger.runtime(`saveImportanceFact: Skipping save for ${characterName}; already classified as ${existingImp}`);
            return;
        }

        // Use the managed facts toolkit for timeline-safe persistence
        await tools.facts.appendToFactsDb({
            source: characterName.toLowerCase(),
            target: characterName,
            predicate: 'IMPORTANCE',
            fact_value: normalizedImportance.toUpperCase(),
            context: 'Character importance classification'
        });
    } catch (error) {
        tools.logger.error('Database', `Failed to save importance fact for ${characterName}: ${error.message}`);
    }
}

/**
 * Retrieves a character's importance from the database.
 */
async function getImportanceFact(tools, characterName) {
    try {
        const turnNumber = tools.turnContext?.turnNumber || 0;
        const rows = await tools.db.chat.query(
            `SELECT fact_value FROM facts
             WHERE LOWER(project_name) = LOWER(?) AND LOWER(source) = LOWER(?) AND predicate = 'IMPORTANCE'
             AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC LIMIT 1`,
            [tools.turnContext?.projectName || '', characterName, turnNumber]
        );
        if (!rows || rows.length === 0) return null;
        return normalizeImportance(rows[0].fact_value);
    } catch {
        return null;
    }
}

async function saveGenderFact(tools, characterName, gender) {
    // If we know this character is minor from the current context, we skip saving gender too
    const importance = normalizeImportance(tools.turnContext.processed.characterMetadata?.[characterName.toLowerCase()]?.importance);
    if (importance === 'minor' || importance === 'noncharacter') {
        tools.logger.runtime(`Skipping DB persistence for gender of ${importance.toUpperCase()} entity: ${characterName}`);
        return;
    }

    try {
        await tools.facts.appendToFactsDb({
            source: characterName.toLowerCase(),
            predicate: 'HAS_GENDER',
            fact_value: gender.toLowerCase(),
            context: 'Character gender'
        });
    } catch (error) {
        tools.logger.error('Database', `Failed to save gender fact for ${characterName}: ${error.message}`);
    }
}

async function saveGenericSpriteProfileFact(tools, characterName, profileKey) {
    const normalizedProfile = normalizeGenericSpriteProfileKey(profileKey);
    if (!normalizedProfile || !characterName) return;

    try {
        await tools.facts.appendToFactsDb({
            source: characterName.toLowerCase(),
            predicate: GENERIC_SPRITE_PROFILE_PREDICATE,
            fact_value: normalizedProfile,
            context: 'Generic sprite profile classification'
        });
    } catch (error) {
        tools.logger.error('Database', `Failed to save generic sprite profile fact for ${characterName}: ${error.message}`);
    }
}

async function saveGenericVoiceProfileFact(tools, characterName, profileKey) {
    const normalizedProfile = normalizeGenericVoiceProfileKey(profileKey);
    if (!normalizedProfile || !characterName) return;

    try {
        await tools.facts.appendToFactsDb({
            source: characterName.toLowerCase(),
            predicate: GENERIC_VOICE_PROFILE_PREDICATE,
            fact_value: normalizedProfile,
            context: 'Generic voice profile classification'
        });
    } catch (error) {
        tools.logger.error('Database', `Failed to save generic voice profile fact for ${characterName}: ${error.message}`);
    }
}

function collectSceneCharacterKeys(turnContext) {
    const characters = new Map();
    const addCharacter = (name) => {
        if (typeof name !== 'string' || name.trim() === '') return;
        const displayName = name.trim();
        const key = displayName.toLowerCase();
        if (!characters.has(key)) {
            characters.set(key, displayName);
        }
    };

    const party = Array.isArray(turnContext?.output?.party) ? turnContext.output.party : [];
    party.forEach(addCharacter);

    const lines =
        turnContext?.processed?.vnManager?.processedLines ||
        turnContext?.processed?.dialogueProcessor?.processedLines ||
        [];
    for (const line of lines) {
        if (line?.type === 'dialogue') addCharacter(line.character);
    }

    return characters;
}

async function hydrateGenericSpriteProfiles(turnContext, tools) {
    if (!turnContext.processed || typeof turnContext.processed !== 'object') {
        turnContext.processed = {};
    }
    if (!turnContext.processed.vnManager || typeof turnContext.processed.vnManager !== 'object') {
        turnContext.processed.vnManager = {};
    }

    const semanticProfileKeys = getAvailableGenericSpriteProfileKeys(turnContext);
    if (semanticProfileKeys.length === 0) {
        turnContext.processed.vnManager.genericSpriteProfiles = {};
        return {};
    }

    const availableProfiles = new Set(getAvailableGenericSpriteProfileKeys(turnContext, { includeGeneric: true }));
    const sceneCharacters = collectSceneCharacterKeys(turnContext);
    const payload = {};

    if (sceneCharacters.size === 0) {
        turnContext.processed.vnManager.genericSpriteProfiles = payload;
        return payload;
    }

    const facts = await tools.facts.getLatestFactsByPredicate(GENERIC_SPRITE_PROFILE_PREDICATE);
    for (const fact of facts || []) {
        const sourceKey = String(fact?.source || '').trim().toLowerCase();
        if (!sourceKey || !sceneCharacters.has(sourceKey)) continue;

        const profileKey = normalizeGenericSpriteProfileKey(fact.fact_value);
        if (!availableProfiles.has(profileKey)) continue;

        payload[sourceKey] = {
            profileKey,
            source: 'facts'
        };
    }

    turnContext.processed.vnManager.genericSpriteProfiles = payload;
    tools.logger.runtime(`Generic sprite profile hydration loaded ${Object.keys(payload).length} scene profile(s).`);
    return payload;
}

async function hydrateGenericVoiceProfiles(turnContext, tools) {
    if (!turnContext.processed || typeof turnContext.processed !== 'object') {
        turnContext.processed = {};
    }
    if (!turnContext.processed.ttsCore || typeof turnContext.processed.ttsCore !== 'object') {
        turnContext.processed.ttsCore = {};
    }

    const semanticProfileKeys = getAvailableGenericVoiceProfileKeys(turnContext);
    if (semanticProfileKeys.length === 0) {
        turnContext.processed.ttsCore.genericVoiceProfiles = {};
        return {};
    }

    const availableProfiles = new Set(semanticProfileKeys);
    const sceneCharacters = collectSceneCharacterKeys(turnContext);
    const payload = {};

    if (sceneCharacters.size === 0) {
        turnContext.processed.ttsCore.genericVoiceProfiles = payload;
        return payload;
    }

    const facts = await tools.facts.getLatestFactsByPredicate(GENERIC_VOICE_PROFILE_PREDICATE);
    for (const fact of facts || []) {
        const sourceKey = String(fact?.source || '').trim().toLowerCase();
        if (!sourceKey || !sceneCharacters.has(sourceKey)) continue;

        const profileKey = normalizeGenericVoiceProfileKey(fact.fact_value);
        if (!availableProfiles.has(profileKey)) continue;

        payload[sourceKey] = {
            profileKey,
            source: 'facts'
        };
    }

    turnContext.processed.ttsCore.genericVoiceProfiles = payload;
    tools.logger.runtime(`Generic voice profile hydration loaded ${Object.keys(payload).length} scene profile(s).`);
    return payload;
}

async function hasGenderFact(tools, characterName) {
    try {
        const turnNumber = tools.turnContext?.turnNumber || 0;
        const rows = await tools.db.chat.query(
            `SELECT id FROM facts 
             WHERE project_name = ? AND source = ? AND predicate = 'HAS_GENDER' 
             AND turn_number <= ? LIMIT 1`,
            [tools.turnContext.projectName.toLowerCase(), characterName.toLowerCase(), turnNumber]
        );
        return rows && rows.length > 0;
    } catch {
        return false;
    }
}

/**
 * Checks if a character is "new" (has never been classified before this turn).
 * A character is new if no IMPORTANCE fact exists for it, or if it was first classified on the given turn.
 */
async function isNewCharacter(tools, characterName, turnNumber) {
    try {
        const rows = await tools.db.chat.query(
            `SELECT turn_number FROM facts
             WHERE LOWER(project_name) = LOWER(?) AND LOWER(source) = LOWER(?) AND predicate = 'IMPORTANCE'
             AND turn_number <= ?
             ORDER BY turn_number ASC LIMIT 1`,
            [tools.turnContext?.projectName || '', characterName, turnNumber]
        );
        // New if no record exists, or if the first classification was on this exact turn
        if (!rows || rows.length === 0) return true;
        return rows[0].turn_number === turnNumber;
    } catch {
        return false;
    }
}

async function recordCharacterTurnStats(turnContext, tools, settings = {}) {
    if (settings.enable_character_stats === false) return;

    const turnNumber = turnContext.turnNumber || 0;
    const projectName = (turnContext.projectName || '').toLowerCase();
    if (!projectName || turnNumber <= 0) return;

    const stats = collectTurnCharacterStats(turnContext);
    if (stats.size === 0) {
        tools.logger.runtime(`[Character Classifier] No dialogue lines detected for character stats on turn ${turnNumber}.`);
        return;
    }

    for (const [source, data] of stats.entries()) {
        for (const metric of [
            { predicate: 'CHAR_STATS:LINES', value: data.lines },
            { predicate: 'CHAR_STATS:CHARS', value: data.chars }
        ]) {
            const existing = await tools.db.chat.query(
                `SELECT id FROM facts
                 WHERE project_name = ?
                   AND source = ?
                   AND predicate = ?
                   AND turn_number = ?
                 LIMIT 1`,
                [projectName, source, metric.predicate, turnNumber]
            );
            if (existing && existing.length > 0) continue;

            await tools.facts.appendToFactsDb({
                source,
                target: data.displayName,
                predicate: metric.predicate,
                fact_value: metric.value,
                context: 'character_classifier_turn_stats'
            }, { turn_number: turnNumber });
        }
    }

    tools.logger.runtime(`[Character Classifier] Stored turn stats for ${stats.size} speaking entities.`);
}

async function getCleanupCandidates(tools, options = {}) {
    const turnContext = tools.turnContext || {};
    const projectName = (turnContext.projectName || '').toLowerCase();
    const currentTurn = turnContext.turnNumber || 0;
    const limit = Math.max(1, Math.min(200, Number(options.limit || 15)));
    const scoreThreshold = Number(options.scoreThreshold ?? 25);
    const lowLineThreshold = Number(options.lowLineThreshold ?? 3);
    const lowTurnsSeenThreshold = Number(options.lowTurnsSeenThreshold ?? 2);
    const staleTurnsThreshold = Number(options.staleTurnsThreshold ?? 8);
    const minTurnsSinceAudit = Math.max(0, Number(options.minTurnsSinceAudit ?? 3));

    if (!projectName) {
        return { projectName: '', currentTurn, totalMajor: 0, scanned: 0, candidates: [] };
    }

    const importanceRows = await tools.db.chat.query(
        `SELECT source, target, fact_value, turn_number
         FROM facts
         WHERE project_name = ?
           AND predicate = 'IMPORTANCE'
           AND turn_number <= ?
         ORDER BY source ASC, turn_number DESC, id DESC`,
        [projectName, currentTurn]
    );

    const latestImportance = new Map();
    for (const row of importanceRows) {
        const source = (row.source || '').toLowerCase();
        if (!source || latestImportance.has(source)) continue;
        latestImportance.set(source, {
            source,
            displayName: row.target && row.target !== 'self' ? String(row.target) : String(row.source || source),
            importance: normalizeImportance(row.fact_value) || 'major',
            lastImportanceTurn: Number(row.turn_number || 0)
        });
    }

    const majorEntries = Array.from(latestImportance.values()).filter(x => x.importance === 'major');

    const playerRows = await tools.db.chat.query(
        `SELECT DISTINCT source
         FROM facts
         WHERE project_name = ?
           AND predicate = 'IS_PLAYER'
           AND LOWER(fact_value) = 'true'
           AND turn_number <= ?`,
        [projectName, currentTurn]
    );
    const protectedPlayers = new Set((playerRows || []).map(r => String(r.source || '').toLowerCase()));

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
    const protectedFullSheets = new Set((fullSheetRows || []).map(r => String(r.character_name || '').toLowerCase()));

    const lineStatsRows = await tools.db.chat.query(
        `SELECT source,
                SUM(CAST(fact_value AS INTEGER)) AS total_lines,
                SUM(CASE WHEN CAST(fact_value AS INTEGER) > 0 THEN 1 ELSE 0 END) AS turns_seen,
                MAX(turn_number) AS last_seen_turn
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CHAR_STATS:LINES'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, currentTurn]
    );
    const lineStats = new Map(
        (lineStatsRows || []).map(row => [
            String(row.source || '').toLowerCase(),
            {
                totalLines: Number(row.total_lines || 0),
                turnsSeen: Number(row.turns_seen || 0),
                lastSeenTurn: Number(row.last_seen_turn || 0)
            }
        ])
    );

    const auditRows = await tools.db.chat.query(
        `SELECT source, MAX(turn_number) AS last_audit_turn
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CLASSIFIER_CLEANUP_AUDIT'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, currentTurn]
    );
    const lastAuditTurns = new Map(
        (auditRows || []).map(row => [
            String(row.source || '').toLowerCase(),
            Number(row.last_audit_turn || 0)
        ])
    );

    const lastAppearedRows = await tools.db.chat.query(
        `SELECT source, MAX(CAST(fact_value AS INTEGER)) AS last_appeared_turn
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CHAR_SHEET:LAST_APPEARED'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, currentTurn]
    );
    const lastAppeared = new Map(
        (lastAppearedRows || []).map(row => [
            String(row.source || '').toLowerCase(),
            Number(row.last_appeared_turn || 0)
        ])
    );

    const briefRows = await tools.db.chat.query(
        `SELECT source, predicate, fact_value, turn_number
         FROM facts
         WHERE project_name = ?
           AND predicate IN ('CHAR_SHEET:BRIEF', 'CHAR_SHEET:BIOGRAPHY')
           AND turn_number <= ?
         ORDER BY source ASC, turn_number DESC, id DESC`,
        [projectName, currentTurn]
    );
    const latestBrief = new Map();
    for (const row of briefRows) {
        const source = String(row.source || '').toLowerCase();
        if (!source || latestBrief.has(source)) continue;
        latestBrief.set(source, String(row.fact_value || ''));
    }

    const sheetFactRows = await tools.db.chat.query(
        `SELECT source, COUNT(*) AS fact_count
         FROM facts
         WHERE project_name = ?
           AND predicate LIKE 'CHAR_SHEET:%'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, currentTurn]
    );
    const sheetFactCounts = new Map(
        (sheetFactRows || []).map(row => [
            String(row.source || '').toLowerCase(),
            Number(row.fact_count || 0)
        ])
    );

    const personalityRows = await tools.db.chat.query(
        `SELECT source, COUNT(*) AS fact_count
         FROM facts
         WHERE project_name = ?
           AND predicate LIKE 'personality_%'
           AND turn_number <= ?
         GROUP BY source`,
        [projectName, currentTurn]
    );
    const personalityFactCounts = new Map(
        (personalityRows || []).map(row => [
            String(row.source || '').toLowerCase(),
            Number(row.fact_count || 0)
        ])
    );

    const relationshipRows = await tools.db.chat.query(
        `SELECT source, target, COUNT(*) AS fact_count
         FROM facts
         WHERE project_name = ?
           AND predicate LIKE 'relationship_%'
           AND turn_number <= ?
         GROUP BY source, target`,
        [projectName, currentTurn]
    );
    const relationshipFactCounts = new Map();
    for (const row of relationshipRows || []) {
        const count = Number(row.fact_count || 0);
        for (const name of [row.source, row.target]) {
            const key = String(name || '').toLowerCase();
            if (!key || key === 'self') continue;
            relationshipFactCounts.set(key, (relationshipFactCounts.get(key) || 0) + count);
        }
    }

    let evidenceChapters = [];
    try {
        const history = await turnContext.retrieveDatedChapters();
        evidenceChapters = [
            { turnNumber: currentTurn, processed: turnContext.processed, output: turnContext.output },
            ...[
                ...(history.fullchapters || []),
                ...(history.summarychapters || []),
                ...(history.synopsischapters || [])
            ].reverse()
        ];
    } catch {
        evidenceChapters = [{ turnNumber: currentTurn, processed: turnContext.processed, output: turnContext.output }];
    }

    const candidates = [];
    for (const entry of majorEntries) {
        if (protectedPlayers.has(entry.source)) continue;
        if (protectedFullSheets.has(entry.source)) continue;

        const stats = lineStats.get(entry.source) || { totalLines: 0, turnsSeen: 0, lastSeenTurn: 0 };
        const fallbackLastSeen = lastAppeared.get(entry.source) || 0;
        const lastSeenTurn = Math.max(stats.lastSeenTurn || 0, fallbackLastSeen);
        const staleTurns = currentTurn > 0 ? Math.max(0, currentTurn - lastSeenTurn) : 0;
        const lastAuditTurn = Number(lastAuditTurns.get(entry.source) || 0);
        const turnsSinceAudit = lastAuditTurn > 0 ? Math.max(0, currentTurn - lastAuditTurn) : Number.POSITIVE_INFINITY;

        // Cooldown: do not re-audit too soon.
        if (lastAuditTurn > 0 && turnsSinceAudit < minTurnsSinceAudit) {
            continue;
        }
        // Skip if no new evidence appeared since last audit.
        if (lastAuditTurn > 0 && lastSeenTurn <= lastAuditTurn) {
            continue;
        }

        const brief = latestBrief.get(entry.source) || '';
        const sheetFactCount = sheetFactCounts.get(entry.source) || 0;
        const personalityFactCount = personalityFactCounts.get(entry.source) || 0;
        const relationshipFactCount = relationshipFactCounts.get(entry.source) || 0;
        const dialogueSamples = collectDialogueSamples(entry.source, evidenceChapters, 6);

        let score = 0;
        const reasons = [];

        if ((stats.totalLines || 0) === 0) {
            score += 30;
            reasons.push('no recorded dialogue lines');
        } else if ((stats.totalLines || 0) < lowLineThreshold) {
            score += 20;
            reasons.push('very low dialogue presence');
        }
        if ((stats.turnsSeen || 0) < lowTurnsSeenThreshold) {
            score += 15;
            reasons.push('seen in only one tracked turn');
        }
        if (lastSeenTurn === 0) {
            score += 20;
            reasons.push('no reliable last-seen evidence');
        } else if (staleTurns >= staleTurnsThreshold) {
            score += 20;
            reasons.push(`stale for ${staleTurns} turns`);
        }
        if (!brief || brief.trim().length < 24) {
            score += 10;
            reasons.push('missing/very short capsule brief');
        }
        if (sheetFactCount <= 2) {
            score += 10;
            reasons.push('little durable sheet data');
        }
        if (relationshipFactCount === 0 && personalityFactCount === 0) {
            score += 10;
            reasons.push('no relationship/personality support data');
        }
        if (dialogueSamples.length === 0) {
            score += 15;
            reasons.push('no retrievable dialogue evidence');
        }

        if (score < scoreThreshold) continue;

        candidates.push({
            ...entry,
            score,
            reasons,
            stats: {
                totalLines: Number(stats.totalLines || 0),
                turnsSeen: Number(stats.turnsSeen || 0),
                lastSeenTurn: Number(lastSeenTurn || 0),
                staleTurns,
                lastAuditTurn,
                turnsSinceAudit: Number.isFinite(turnsSinceAudit) ? turnsSinceAudit : null
            },
            evidence: {
                sheetFactCount,
                relationshipFactCount,
                personalityFactCount,
                dialogueSamples
            },
            brief: brief ? brief.slice(0, 400) : ''
        });
    }

    candidates.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    return {
        projectName,
        currentTurn,
        totalMajor: majorEntries.length,
        scanned: candidates.length,
        candidates: candidates.slice(0, limit)
    };
}

async function classifyCleanupCandidate(tools, candidate) {
    if (!candidate || !candidate.source) return { importance: 'major', reasoning: 'Invalid candidate payload.' };

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const modelDef = settings.model_def || { model: 'lowendmodel' };
    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;

    const prompt = [
        'You are reviewing a narrative character registry for cleanup.',
        'Classify whether this entry should remain MAJOR, be demoted to MINOR, or marked NONCHARACTER.',
        'Judge from narrative evidence, not from a static word list.',
        'Be forgiving with proper given names or distinctive personal names. "Jenna", "Mord", or "Timmy" can remain MAJOR even if stale, unless the evidence clearly shows they were a tiny one-off throwaway.',
        'Be harsh with bare roles, job labels, numbered labels, and title-only entities. "Guard 1", "Manager", "Stage Master", and "Bandit Leader" are normally MINOR unless the evidence clearly proves a distinct recurring individual.',
        'Staleness alone is not enough to demote a proper named individual. Low-signal role labels should be demoted much more readily.',
        'A code-name like "Agent 47" can be a real major character if the evidence supports a distinct individual.',
        tools.directives.getFormatted('casting_logic', { header: '### CLASSIFICATION DIRECTIVES' }),
        '',
        `[NAME] ${candidate.displayName}`,
        `[CURRENT_IMPORTANCE] ${String(candidate.importance || 'major').toUpperCase()}`,
        `[HEURISTIC_SCORE] ${candidate.score}`,
        `[HEURISTIC_REASONS] ${(candidate.reasons || []).join('; ') || 'none'}`,
        `[RECORDED_DIALOGUE_LINES] ${candidate.stats?.totalLines ?? 0}`,
        `[TURNS_SEEN] ${candidate.stats?.turnsSeen ?? 0}`,
        `[STALE_TURNS] ${candidate.stats?.staleTurns ?? 0}`,
        `[SHEET_FACT_COUNT] ${candidate.evidence?.sheetFactCount ?? 0}`,
        `[RELATIONSHIP_FACT_COUNT] ${candidate.evidence?.relationshipFactCount ?? 0}`,
        `[PERSONALITY_FACT_COUNT] ${candidate.evidence?.personalityFactCount ?? 0}`,
        `[BRIEF] ${candidate.brief || '(none)'}`,
        `[DIALOGUE_EVIDENCE]`,
        (candidate.evidence?.dialogueSamples || []).join('\n') || '(none found)',
        '',
        'Use NONCHARACTER for timestamps, scene labels, narration artifacts, system/meta labels, and non-person entities.',
        'Use MINOR for real but generic, low-signal background entities that should not receive long-term sheets, bonds, or personality tracking.',
        'Use MAJOR only when the evidence supports a distinct individual worth long-term tracking.',
        '',
        'Output only JSON:',
        '{"importance":"major|minor|noncharacter","confidence":0.0,"reasoning":"short reason"}'
    ].join('\n');

    const messages = [{ role: 'user', content: prompt }];

    const task = {
        msg: 'Character Cleanup Classification',
        params: {
            retries: settings.retries || 2,
            timeout: settings.timeout || 20000,
            temperature: 0.0,
            max_tokens: 180,
            callingModule: 'Plugin:character_classifier:cleanup'
        }
    };
    const response = tools.llm.vnBackground?.isSelected?.(modelDef) === true
        ? await tools.llm.vnBackground.json({ ...task, suffix: prompt })
        : await tools.llm.json({ ...task, messages, model: resolvedModelDef.model, provider: resolvedModelDef.provider });

    const parsed = parseJsonObject(response.content) || {};
    const importance = normalizeImportance(parsed.importance) || 'major';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
    const reasoning = String(parsed.reasoning || '').trim() || 'No reason provided.';

    return { importance, confidence, reasoning };
}

async function reclassifyCharacterImportance(tools, candidate, importance = 'minor', reason = '') {
    if (!candidate || !candidate.source) return false;
    const projectName = (tools.turnContext?.projectName || '').toLowerCase();
    if (!projectName) return false;

    const normalizedImportance = normalizeImportance(importance) || 'minor';

    await tools.facts.appendToFactsDb({
        source: candidate.source.toLowerCase(),
        target: candidate.displayName || candidate.source,
        predicate: 'IMPORTANCE',
        fact_value: normalizedImportance.toUpperCase(),
        context: reason || 'Manual classifier cleanup'
    });

    const charKey = String(candidate.source).toLowerCase();
    if (tools.turnContext?.processed?.characterMetadata) {
        const existing = tools.turnContext.processed.characterMetadata[charKey] || {};
        tools.turnContext.processed.characterMetadata[charKey] = { ...existing, importance: normalizedImportance };
    }

    if (tools.vector && (normalizedImportance === 'minor' || normalizedImportance === 'noncharacter')) {
        try {
            await tools.vector.delete('social_registry', { name: candidate.displayName || candidate.source });
            await tools.vector.delete('social_registry', { name: candidate.source });
        } catch (error) {
            tools.logger.runtime(`Classifier cleanup vector removal skipped for ${candidate.displayName || candidate.source}: ${error.message}`);
        }
    }

    return true;
}

async function recordCleanupAudit(tools, candidate, details = {}) {
    if (!candidate || !candidate.source) return false;

    const payload = {
        mode: String(details.mode || 'periodic'),
        decision: normalizeImportance(details.decision) || 'major',
        confidence: Number.isFinite(Number(details.confidence)) ? Number(details.confidence) : null,
        applied: details.applied === true,
        reason: String(details.reason || '').slice(0, 500),
        auditedAt: new Date().toISOString()
    };

    await tools.facts.appendToFactsDb({
        source: String(candidate.source).toLowerCase(),
        target: candidate.displayName || candidate.source,
        predicate: 'CLASSIFIER_CLEANUP_AUDIT',
        fact_value: String(payload.decision || 'major').toUpperCase(),
        context: JSON.stringify(payload)
    });

    return true;
}

async function demoteCharacterToMinor(tools, candidate, reason = '') {
    return await reclassifyCharacterImportance(tools, candidate, 'minor', reason);
}

async function runPeriodicCleanup(turnContext, tools, settings = {}) {
    if (settings.enable_periodic_cleanup === false) return;

    const turnNumber = turnContext.turnNumber || 0;
    if (turnNumber <= 0) return;

    const frequency = Math.max(3, Number(settings.cleanup_frequency || 5));
    if (turnNumber < frequency || turnNumber % frequency !== 0) return;

    const limit = Math.max(1, Math.min(50, Number(settings.cleanup_candidate_limit || 10)));
    const minConfidence = Math.max(0.5, Math.min(1, Number(settings.cleanup_min_confidence ?? 0.75)));

    tools.logger.runtime(`[Character Classifier] Periodic cleanup running on turn ${turnNumber}.`);
    const preview = await getCleanupCandidates(tools, {
        limit,
        scoreThreshold: Number(settings.cleanup_score_threshold ?? 30),
        lowLineThreshold: Number(settings.cleanup_low_line_threshold ?? 3),
        lowTurnsSeenThreshold: Number(settings.cleanup_low_turns_seen_threshold ?? 2),
        staleTurnsThreshold: Number(settings.cleanup_stale_turns_threshold ?? 8),
        minTurnsSinceAudit: Number(settings.cleanup_min_turns_between_reaudit ?? 3)
    });

    if (!preview.candidates || preview.candidates.length === 0) {
        tools.logger.runtime('[Character Classifier] Periodic cleanup found no low-evidence MAJOR entries.');
        return;
    }

    const applied = [];
    const kept = [];
    const skipped = [];

    tools.status?.update?.(`Auditing character registry... (0/${preview.candidates.length})`);
    try {
        for (let i = 0; i < preview.candidates.length; i++) {
            const candidate = preview.candidates[i];
            tools.status?.update?.(`Auditing character registry... (${i + 1}/${preview.candidates.length}) ${candidate.displayName}`);

            try {
                const decision = await classifyCleanupCandidate(tools, candidate);
                if (decision.importance === 'major') {
                    kept.push(candidate.displayName);
                    await recordCleanupAudit(tools, candidate, {
                        mode: 'periodic',
                        decision: 'major',
                        confidence: decision.confidence,
                        applied: false,
                        reason: decision.reasoning
                    });
                    continue;
                }

                if (decision.confidence < minConfidence) {
                    skipped.push(`${candidate.displayName} (${decision.importance}, ${Math.round(decision.confidence * 100)}%)`);
                    await recordCleanupAudit(tools, candidate, {
                        mode: 'periodic',
                        decision: decision.importance,
                        confidence: decision.confidence,
                        applied: false,
                        reason: `Below min confidence ${minConfidence}: ${decision.reasoning}`
                    });
                    continue;
                }

                await reclassifyCharacterImportance(
                    tools,
                    candidate,
                    decision.importance,
                    `Periodic classifier cleanup (${Math.round(decision.confidence * 100)}%): ${decision.reasoning}`
                );
                await recordCleanupAudit(tools, candidate, {
                    mode: 'periodic',
                    decision: decision.importance,
                    confidence: decision.confidence,
                    applied: true,
                    reason: decision.reasoning
                });
                applied.push(`${candidate.displayName} -> ${decision.importance.toUpperCase()}`);
            } catch (error) {
                tools.logger.error('ClassifierCleanup', `Cleanup audit failed for ${candidate.displayName}: ${error.message}`);
            }
        }
    } finally {
        tools.status?.clear?.();
    }

    tools.logger.log(
        'ClassifierCleanup',
        `Periodic cleanup complete. Applied: ${applied.join(', ') || 'none'}; kept: ${kept.join(', ') || 'none'}; skipped low confidence: ${skipped.join(', ') || 'none'}`
    );
}

function createCleanupRunId() {
    return `ccleanup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function saveCleanupPlan(tools, plan = {}) {
    const projectName = (tools.turnContext?.projectName || '').toLowerCase();
    if (!projectName) return { runId: null, savedCount: 0 };

    const runId = String(plan.runId || createCleanupRunId());
    const entries = Array.isArray(plan.entries) ? plan.entries : [];
    const createdAt = new Date().toISOString();

    await tools.db.chat.execute(
        `DELETE FROM facts
         WHERE project_name = ?
           AND predicate = 'CLASSIFIER_CLEANUP_PLAN'`,
        [projectName]
    );

    let savedCount = 0;
    for (const entry of entries) {
        if (!entry || !entry.source) continue;
        const source = String(entry.source).toLowerCase();
        const displayName = String(entry.displayName || entry.target || source);
        const llmImportance = normalizeImportance(entry.llmImportance || entry.decision?.importance) || 'major';
        const llmReasoning = String(entry.llmReasoning || entry.decision?.reasoning || '').trim();

        const contextPayload = {
            runId,
            createdAt,
            score: Number(entry.score || 0),
            reasons: Array.isArray(entry.reasons) ? entry.reasons : [],
            stats: entry.stats || {},
            evidence: entry.evidence || {},
            brief: String(entry.brief || ''),
            llmImportance,
            llmReasoning,
            llmConfidence: Number(entry.llmConfidence ?? entry.decision?.confidence ?? 0.5)
        };

        await tools.facts.appendToFactsDb({
            source,
            target: displayName,
            predicate: 'CLASSIFIER_CLEANUP_PLAN',
            fact_value: llmImportance.toUpperCase(),
            context: JSON.stringify(contextPayload)
        });
        savedCount += 1;
    }

    return { runId, savedCount, createdAt };
}

async function loadLatestCleanupPlan(tools) {
    const projectName = (tools.turnContext?.projectName || '').toLowerCase();
    if (!projectName) return null;

    const rows = await tools.db.chat.query(
        `SELECT id, turn_number, source, target, fact_value, context, timestamp
         FROM facts
         WHERE project_name = ?
           AND predicate = 'CLASSIFIER_CLEANUP_PLAN'
         ORDER BY id DESC`,
        [projectName]
    );

    if (!rows || rows.length === 0) return null;

    const parsedRows = rows
        .map(row => {
            const parsed = parseJsonObject(row.context) || {};
            return { row, parsed };
        })
        .filter(x => !!x.parsed.runId);

    if (parsedRows.length === 0) return null;

    const runId = String(parsedRows[0].parsed.runId);
    const scoped = parsedRows.filter(x => String(x.parsed.runId) === runId);
    if (scoped.length === 0) return null;

    const entries = scoped.map(({ row, parsed }) => ({
        source: String(row.source || '').toLowerCase(),
        displayName: String(row.target || row.source || ''),
        score: Number(parsed.score || 0),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        stats: parsed.stats || {},
        evidence: parsed.evidence || {},
        brief: String(parsed.brief || ''),
        llmImportance: normalizeImportance(parsed.llmImportance || row.fact_value) || 'major',
        llmReasoning: String(parsed.llmReasoning || ''),
        llmConfidence: Number(parsed.llmConfidence ?? 0.5)
    }));

    return {
        runId,
        turnNumber: Number(scoped[0].row.turn_number || 0),
        createdAt: String(scoped[0].parsed.createdAt || scoped[0].row.timestamp || ''),
        entries
    };
}

async function isCleanupPlanApplied(tools, runId) {
    const projectName = (tools.turnContext?.projectName || '').toLowerCase();
    if (!projectName || !runId) return false;

    const rows = await tools.db.chat.query(
        `SELECT id
         FROM facts
         WHERE project_name = ?
           AND source = ?
           AND predicate = 'CLASSIFIER_CLEANUP_APPLIED'
         ORDER BY id DESC
         LIMIT 1`,
        [projectName, `cleanup_run:${runId}`]
    );

    return !!(rows && rows.length > 0);
}

async function markCleanupPlanApplied(tools, runId, summary = {}) {
    const turnNumber = tools.turnContext?.turnNumber || 0;
    if (!runId) return false;

    const factValue = JSON.stringify({
        appliedAt: new Date().toISOString(),
        ...summary
    });

    await tools.facts.appendToFactsDb({
        source: `cleanup_run:${runId}`,
        target: 'self',
        predicate: 'CLASSIFIER_CLEANUP_APPLIED',
        fact_value: factValue,
        context: 'CLI cleanup confirmation'
    }, { turn_number: turnNumber });
    return true;
}

module.exports = {
    extractRelevantContext,
    triageCharacter,
    classifyGenderOnly,
    computeCharacterConfidence,
    shouldReclassifyMinorCharacter,
    recordCharacterTurnStats,
    runPeriodicCleanup,
    saveImportanceFact,
    getImportanceFact,
    saveGenderFact,
    saveGenericSpriteProfileFact,
    saveGenericVoiceProfileFact,
    hydrateGenericSpriteProfiles,
    hydrateGenericVoiceProfiles,
    getAvailableGenericSpriteProfileKeys,
    buildGenericSpriteProfilePromptParts,
    getAvailableGenericVoiceProfileKeys,
    buildGenericVoiceProfilePromptParts,
    hasGenderFact,
    isNewCharacter,
    getCleanupCandidates,
    classifyCleanupCandidate,
    reclassifyCharacterImportance,
    recordCleanupAudit,
    demoteCharacterToMinor,
    saveCleanupPlan,
    loadLatestCleanupPlan,
    isCleanupPlanApplied,
    markCleanupPlanApplied
};
