// plugins/cg_generator/logic.js

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { compressString } = require('../../modules/utils.js');
const chaptermgmt = require('../../modules/chaptermanagement.js');
const providers = require('./providers.js');
const {
    normalizeCharacterNameForLookup,
    normalizeVariantKey,
    resolveCharacterReferences,
    uniqueStrings
} = require('./character_references.js');

// Convert a local file path to base64
async function getFileAsBase64(filePath) {
    try {
        const fileBuffer = await fs.readFile(filePath);
        return fileBuffer.toString('base64');
    } catch (_e) {
        return null;
    }
}

function formatCharacterReferenceIntro(char) {
    const details = [];
    if (char?.variantKey) {
        details.push(`active outfit/variant: ${formatVariantLabel(char.variantKey)}`);
    }
    if (Number.isFinite(Number(char?.metadataScale)) && Number(char.metadataScale) > 0) {
        details.push(`relative height: ${describeCharacterScale(char.metadataScale)}`);
    }
    const detailSuffix = details.length > 0 ? ` Scene-specific details: ${details.join('; ')}.` : '';

    if (char?.sourceType === 'icon') {
        return `Character reference (${char.name}) [icon-only fallback]: Only a small/partial icon is available for this character.${detailSuffix} Use the icon for face, hair, palette, and art-style cues, then extrapolate the missing full-body pose and outfit from the scene context. Do not copy another character's body or outfit.`;
    }

    if (char?.sourceType === 'sprite') {
        return `Character reference (${char.name}) [sprite fallback]: No dedicated reference image was available, so this normal VN sprite is the best available visual reference.${detailSuffix} Use it for identity, outfit, palette, and art style while adapting the pose to the scene.`;
    }

    if (char?.sourceType === 'generic_profile') {
        return `Character reference (${char.name}) [generic/profile fallback]: This is a project fallback sprite, not a verified character reference.${detailSuffix} Use it only as loose style guidance and follow the scene description for identity details.`;
    }

    return `Character reference (${char.name}) [${char?.sourceType || 'reference'}]:${detailSuffix}`;
}

function formatVariantLabel(variantKey) {
    const normalized = normalizeVariantKey(variantKey);
    if (!normalized) return '';
    return normalized.replace(/_/g, ' ');
}

function describeCharacterScale(scale) {
    const value = Number(scale);
    if (!Number.isFinite(value) || value <= 0) return 'normal height';
    if (value <= 0.5) return 'very short, like a gnome';
    if (value <= 0.8) return 'short';
    if (value <= 1.1) return 'normal height';
    return 'very tall';
}

function getCatalogCharacterForName(turnContext, characterName) {
    const catalog = turnContext?.runtime?.vnManager?.spriteCatalog;
    const normalized = normalizeCharacterNameForLookup(characterName);
    if (!catalog?.characters || !normalized) return null;
    if (catalog.characters[normalized]) return catalog.characters[normalized];

    const aliases = [
        normalized,
        normalized.replace(/_/g, ''),
        normalized.split('_')[0]
    ];
    for (const alias of aliases) {
        const keys = [
            ...(catalog.lookups?.byAlias?.[alias] || []),
            ...(catalog.lookups?.byFirstName?.[alias] || [])
        ];
        const hit = keys.find(key => catalog.characters[key]);
        if (hit) return catalog.characters[hit];
    }
    return null;
}

function detectVariantFromSpritePath(turnContext, characterName, spritePath) {
    if (!spritePath) return '';
    const character = getCatalogCharacterForName(turnContext, characterName);
    if (!character?.variantData) return '';
    const normalizedPath = String(spritePath).replace(/\\/g, '/').replace(/^assets\//, '');

    for (const [variantKey, variantData] of Object.entries(character.variantData)) {
        const files = Array.isArray(variantData?.files) ? variantData.files : [];
        if (files.some(file => {
            const normalizedFile = String(file).replace(/\\/g, '/').replace(/^assets\//, '');
            return normalizedFile === normalizedPath || normalizedPath.endsWith(`/${normalizedFile}`);
        })) {
            const normalizedVariant = normalizeVariantKey(variantKey);
            return normalizedVariant === 'default' ? '' : normalizedVariant;
        }
    }
    return '';
}

function buildFrameReferenceHints(turnContext, frameCharacters, startIdx, endIdx) {
    const sequence = Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence : [];
    const hints = new Map();

    for (const characterName of frameCharacters) {
        const key = normalizeCharacterNameForLookup(characterName);
        if (!key) continue;
        const metadataScale = turnContext?.runtime?.vnManager?.spriteMetadata?.characters?.[key]?.scale;
        hints.set(key, {
            name: characterName,
            metadataScale: Number.isFinite(Number(metadataScale)) && Number(metadataScale) > 0 ? Number(metadataScale) : null,
            variantCounts: new Map()
        });
    }

    const safeStart = Math.max(0, Number.parseInt(startIdx, 10) || 0);
    const safeEnd = Math.min(sequence.length - 1, Math.max(safeStart, Number.parseInt(endIdx, 10) || safeStart));
    for (let i = safeStart; i <= safeEnd; i++) {
        const sprites = Array.isArray(sequence[i]?.sprites) ? sequence[i].sprites : [];
        for (const sprite of sprites) {
            if (!sprite?.character) continue;
            const key = normalizeCharacterNameForLookup(sprite.character);
            const hint = hints.get(key);
            if (!hint) continue;

            if (Number.isFinite(Number(sprite.metadataScale)) && Number(sprite.metadataScale) > 0) {
                hint.metadataScale = Number(sprite.metadataScale);
            }

            const variantKey = detectVariantFromSpritePath(turnContext, sprite.character, sprite.path);
            if (variantKey) {
                hint.variantCounts.set(variantKey, (hint.variantCounts.get(variantKey) || 0) + 1);
            }
        }
    }

    for (const hint of hints.values()) {
        const variants = [...hint.variantCounts.entries()].sort((a, b) => b[1] - a[1]);
        hint.variantKey = variants[0]?.[0] || '';
        delete hint.variantCounts;
    }

    return hints;
}

function buildReferencedCharacterGuidance(references = []) {
    const lines = [];
    for (const char of references) {
        const details = [];
        if (char?.variantKey) {
            details.push(`wearing the "${formatVariantLabel(char.variantKey)}" outfit/variant`);
        }
        if (Number.isFinite(Number(char?.metadataScale)) && Number(char.metadataScale) > 0) {
            details.push(`${describeCharacterScale(char.metadataScale)} relative to normal-size characters`);
        }
        if (details.length > 0) {
            lines.push(`- **${char.name}**: ${details.join('; ')}.`);
        }
    }
    return lines;
}



// Main Logic Entry Point

function editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    let costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) != s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function getStringSimilarity(str1, str2) {
    let longer = str1;
    let shorter = str2;
    if (str1.length < str2.length) {
        longer = str2;
        shorter = str1;
    }
    let longerLength = longer.length;
    if (longerLength == 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInterludeTurn(turnContext) {
    const hasInterludeIdentity =
        Number.isInteger(Number.parseInt(turnContext?.parentTurnDbId, 10))
        && Number.parseInt(turnContext?.parentTurnDbId, 10) > 0
        && Number.isInteger(Number.parseInt(turnContext?.interludeOrdinal, 10))
        && Number.parseInt(turnContext?.interludeOrdinal, 10) > 0;
    if (hasInterludeIdentity) return true;

    const mode = String(
        turnContext?.sceneMode
        || turnContext?.runtime?.turnPipeline?.sceneMode
        || ''
    ).trim().toLowerCase();
    return mode === 'interlude';
}

async function resolveInterludeDbId(turnContext, tools, options = {}) {
    const interludeState = turnContext?.runtime?.interlude || {};
    if (Number.isInteger(interludeState.id) && interludeState.id > 0) {
        return interludeState.id;
    }

    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs)) && Number(options.maxWaitMs) > 0
        ? Number(options.maxWaitMs)
        : 30000;
    const pollMs = Number.isFinite(Number(options.pollMs)) && Number(options.pollMs) > 0
        ? Number(options.pollMs)
        : 250;

    const startedAt = Date.now();
    while (
        !(Number.isInteger(turnContext?.runtime?.interlude?.id) && turnContext.runtime.interlude.id > 0)
        && (Date.now() - startedAt) < maxWaitMs
    ) {
        await sleep(pollMs);
    }
    if (Number.isInteger(turnContext?.runtime?.interlude?.id) && turnContext.runtime.interlude.id > 0) {
        return turnContext.runtime.interlude.id;
    }

    const parentTurnDbId = Number.parseInt(turnContext?.parentTurnDbId, 10);
    const ordinal = Number.parseInt(turnContext?.interludeOrdinal, 10);
    if (!Number.isInteger(parentTurnDbId) || parentTurnDbId <= 0 || !Number.isInteger(ordinal) || ordinal <= 0) {
        return null;
    }

    try {
        const rows = await chaptermgmt.genericQuery(
            `SELECT id FROM chat_interludes WHERE parent_turn_id = ? AND ordinal = ? ORDER BY id DESC LIMIT 1`,
            [parentTurnDbId, ordinal]
        );
        const resolved = rows?.[0]?.id;
        if (Number.isInteger(resolved) && resolved > 0) {
            if (!turnContext.runtime) turnContext.runtime = {};
            if (!turnContext.runtime.interlude || typeof turnContext.runtime.interlude !== 'object') {
                turnContext.runtime.interlude = {};
            }
            turnContext.runtime.interlude.id = resolved;
            return resolved;
        }
    } catch (lookupError) {
        tools.logger.error('CG Generator', `Failed to resolve interlude id for parent=${parentTurnDbId} ordinal=${ordinal}: ${lookupError.message}`);
    }

    return null;
}

async function resolveTurnDbId(turnContext, tools, options = {}) {
    if (turnContext?.dbId) return turnContext.dbId;

    const maxWaitMs = Number.isFinite(Number(options.maxWaitMs)) && Number(options.maxWaitMs) > 0
        ? Number(options.maxWaitMs)
        : 30000;
    const pollMs = Number.isFinite(Number(options.pollMs)) && Number(options.pollMs) > 0
        ? Number(options.pollMs)
        : 250;

    const startedAt = Date.now();
    while (!turnContext?.dbId && (Date.now() - startedAt) < maxWaitMs) {
        await sleep(pollMs);
    }
    if (turnContext?.dbId) return turnContext.dbId;

    const creationTurn = Number.parseInt(turnContext?.creationTurnNumber ?? turnContext?.turnNumber, 10);
    if (Number.isInteger(creationTurn) && creationTurn > 0) {
        try {
            const persistedTurn = await chaptermgmt.getTurnContextByCreationTurnNumber(creationTurn);
            if (persistedTurn?.dbId) {
                turnContext.dbId = persistedTurn.dbId;
                return persistedTurn.dbId;
            }
        } catch (lookupError) {
            tools.logger.error('CG Generator', `Failed to resolve dbId for turn ${creationTurn}: ${lookupError.message}`);
        }
    }

    return null;
}

async function persistInterludeSnapshotWithCg(turnContext, tools) {
    const interludeDbId = await resolveInterludeDbId(turnContext, tools, { maxWaitMs: 30000, pollMs: 250 });
    if (!interludeDbId) {
        tools.logger.runtime(`[CG Generator] Skipping CG interlude persistence: interlude id unavailable for turn ${turnContext?.turnNumber}.`);
        return false;
    }

    try {
        const snapshotObj = (typeof turnContext?.serialize === 'function')
            ? turnContext.serialize()
            : turnContext;
        const snapshotJson = JSON.stringify(snapshotObj || {});
        const compressedSnapshot = await compressString(snapshotJson);
        const title = turnContext?.output?.title || '';
        const abstractTitle = turnContext?.output?.abstractTitle || '';
        const synopsis = turnContext?.output?.synopsis || '';
        const summary = turnContext?.output?.summary || '';
        const thumbnail = turnContext?.thumbnail || null;

        await chaptermgmt.genericExecute(
            `UPDATE chat_interludes
             SET turn_context_snapshot = ?, title = ?, abstract_title = ?, synopsis = ?, summary = ?, thumbnail = ?
             WHERE id = ?`,
            [compressedSnapshot, title, abstractTitle, synopsis, summary, thumbnail, interludeDbId]
        );
        tools.logger.runtime(`[CG Generator] Persisted interlude snapshot with CG (interludeId=${interludeDbId}).`);
        return true;
    } catch (dbErr) {
        tools.logger.error('CG Generator', `Failed to persist interlude snapshot with CG: ${dbErr.message}`);
        return false;
    }
}

async function persistTurnSnapshotWithCg(turnContext, tools) {
    if (isInterludeTurn(turnContext)) {
        return persistInterludeSnapshotWithCg(turnContext, tools);
    }

    const dbId = await resolveTurnDbId(turnContext, tools, { maxWaitMs: 30000, pollMs: 250 });
    if (!dbId) {
        tools.logger.runtime(`[CG Generator] Skipping CG snapshot persistence: dbId unavailable for turn ${turnContext?.turnNumber}.`);
        return false;
    }

    try {
        await chaptermgmt.updateTurn(turnContext);
        tools.logger.runtime(`[CG Generator] Persisted turn snapshot with CG (dbId=${dbId}).`);
        return true;
    } catch (dbErr) {
        tools.logger.error('CG Generator', `Failed to persist turn snapshot with CG: ${dbErr.message}`);
        return false;
    }
}

function normalizeSequenceSpan(turnContext, startIdx, endIdx) {
    const sequence = turnContext?.output?.sequence;
    if (!Array.isArray(sequence) || sequence.length === 0) {
        return { sequence: [], startIdx: -1, endIdx: -1 };
    }

    const maxIdx = sequence.length - 1;
    const parsedStart = Number.parseInt(startIdx, 10);
    const parsedEnd = Number.parseInt(endIdx, 10);
    const safeStart = Number.isInteger(parsedStart)
        ? Math.min(Math.max(parsedStart, 0), maxIdx)
        : 0;
    const safeEnd = Number.isInteger(parsedEnd)
        ? Math.min(Math.max(parsedEnd, safeStart), maxIdx)
        : safeStart;

    return { sequence, startIdx: safeStart, endIdx: safeEnd };
}

function markCgPendingSpan(turnContext, startIdx, endIdx) {
    const { sequence, startIdx: safeStart, endIdx: safeEnd } = normalizeSequenceSpan(turnContext, startIdx, endIdx);
    if (safeStart < 0) return null;

    const pendingAt = new Date().toISOString();
    for (let i = safeStart; i <= safeEnd; i++) {
        if (!sequence[i] || typeof sequence[i] !== 'object') continue;
        sequence[i].cg_pending = true;
        sequence[i].cg_pending_at = pendingAt;
        delete sequence[i].cg_failed;
        delete sequence[i].cg_error;
        delete sequence[i].cg_failed_at;
    }

    return { startIdx: safeStart, endIdx: safeEnd, pendingAt };
}

function clearCgPendingSpan(turnContext, startIdx, endIdx) {
    const { sequence, startIdx: safeStart, endIdx: safeEnd } = normalizeSequenceSpan(turnContext, startIdx, endIdx);
    if (safeStart < 0) return null;

    for (let i = safeStart; i <= safeEnd; i++) {
        if (!sequence[i] || typeof sequence[i] !== 'object') continue;
        delete sequence[i].cg_pending;
        delete sequence[i].cg_pending_at;
    }

    return { startIdx: safeStart, endIdx: safeEnd };
}

function markCgFailedSpan(turnContext, startIdx, endIdx, reason) {
    const { sequence, startIdx: safeStart, endIdx: safeEnd } = normalizeSequenceSpan(turnContext, startIdx, endIdx);
    if (safeStart < 0) return null;

    const failedAt = new Date().toISOString();
    const safeReason = String(reason || 'CG generation failed.').slice(0, 500);
    for (let i = safeStart; i <= safeEnd; i++) {
        if (!sequence[i] || typeof sequence[i] !== 'object') continue;
        delete sequence[i].cg_pending;
        delete sequence[i].cg_pending_at;
        if (!sequence[i].cg) {
            sequence[i].cg_failed = true;
            sequence[i].cg_error = safeReason;
            sequence[i].cg_failed_at = failedAt;
        }
    }

    return { startIdx: safeStart, endIdx: safeEnd, reason: safeReason, failedAt };
}

function emitCgPending(tools, turnNumber, plan) {
    if (!tools?.socket?.emit || !plan) return;
    const startIdx = Number.parseInt(plan.bestStartIdx, 10);
    const endIdx = Number.parseInt(plan.bestEndIdx, 10);
    if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return;
    tools.socket.emit('vn-cg-pending', {
        turnNumber,
        cgData: {
            startIdx,
            endIdx,
            cgIndex: plan.cgIndex
        }
    });
}

async function finalizeFailedCgFrame(turnContext, tools, plan, reason) {
    const failure = markCgFailedSpan(turnContext, plan?.bestStartIdx, plan?.bestEndIdx, reason);
    if (!failure) return null;

    if (!turnContext.processed) turnContext.processed = {};
    if (!Array.isArray(turnContext.processed.cgFailures)) {
        turnContext.processed.cgFailures = [];
    }
    turnContext.processed.cgFailures.push({
        startIdx: failure.startIdx,
        endIdx: failure.endIdx,
        cgIndex: plan?.cgIndex,
        reason: failure.reason,
        failedAt: failure.failedAt
    });

    await persistTurnSnapshotWithCg(turnContext, tools);

    if (tools?.socket?.emit) {
        tools.socket.emit('vn-cg-failed', {
            turnNumber: turnContext?.turnNumber,
            cgData: {
                startIdx: failure.startIdx,
                endIdx: failure.endIdx,
                cgIndex: plan?.cgIndex,
                reason: failure.reason
            }
        });
    }

    return failure;
}

async function extractCGPlan(turnContext, tools) {
    const pluginSettings = tools.settings.getSelf() || {};

    tools.status.update('CG Generator: Extracting scenes...', { progress: 10, color: '#ffaa00' });

    const currentTurn = turnContext.turnNumber;
    tools.logger.log('CG-Generator', `extractCGPlan: Starting for Turn ${currentTurn}`);

    const modelDef = pluginSettings.modelDef || { model: 'highendmodel' };
    const maxDurationStr = pluginSettings.maxDurationPercentage || 40;
    const minDurationStr = pluginSettings.minDurationPercentage || 20;

    tools.logger.log('CG-Generator', `extractCGPlan: Settings - Model: ${modelDef.model}, Provider: ${modelDef.provider}`);

    const sequence = turnContext.output?.sequence || [];

    let sceneText = '';
    for (let i = 0; i < sequence.length; i++) {
        const textToDisplay = sequence[i].text || sequence[i].line || '';
        if (textToDisplay.trim() !== '') {
            sceneText += `[Line ${i}] ${textToDisplay}\n`;
        } else {
            sceneText += `\n`;
        }
    }

    if (!sceneText || sequence.length < 5) {
        tools.logger.log('CG-Generator', `extractCGPlan: Scene/Sequence too short (${sequence.length} lines). Skipping.`);
        tools.status.update('CG Generator: Skipped (Too short)', { progress: 100, timeout: 3000 });
        return;
    }

    // 1. Gather Context
    tools.logger.log('CG-Generator', `extractCGPlan: Gathering context...`);
    const partyData = turnContext.output.party || [];
    const playerCharacterName = turnContext.input?.playerCharacterName;
    const referenceCandidateCharacters = uniqueStrings([
        ...partyData,
        playerCharacterName
    ]);
    const charactersInvolved = referenceCandidateCharacters.length > 0
        ? referenceCandidateCharacters.join(', ')
        : 'Unknown characters';

    // Background path (usually grabbed from finalOutput sequence scene.background)
    const firstBgScene = sequence.find(s => s.background);
    const backgroundPath = firstBgScene ? firstBgScene.background : 'No specific background provided.';
    let bgBase64 = null;

    if (firstBgScene && firstBgScene.background) {
        const fullBgPath = path.join(turnContext.rootDirectory, firstBgScene.background);
        bgBase64 = await getFileAsBase64(fullBgPath);
        if (bgBase64) {
            tools.logger.runtime(`[CG Generator] Found and encoded background: ${firstBgScene.background}`);
        }
    }

    // 2. Prepare Context and Call LLM for extraction
    const canonTidbit = turnContext.promptComponents?.canon?.join('\n') || '';
    const playerInstructions = playerCharacterName ? `If ${playerCharacterName} (the player character) is present and part of the scene, you MUST include them in the "characters" array using exactly the name "${playerCharacterName}" instead of a pronoun or an alias.` : '';

    let smartInstructions = '';
    if (pluginSettings.smartContinuity) {
        smartInstructions = 'SMART CONTINUITY ENABLED. You MUST identify the overarching location name (e.g. "Candace\'s house interior") and provide it in the "location_name" field. If there are characters involved in the scene who do NOT have neutral sprites listed in the Input Data, you MUST provide a distinct visual description for them in the "unseen_characters" object so they can be accurately drawn.';
    }

    const promptPath = path.join(__dirname, 'prompts', 'cg_extractor_prompt.txt');

    let promptTemplate = "";
    try {
        tools.logger.log('CG-Generator', `extractCGPlan: Reading prompt template from ${promptPath}...`);
        promptTemplate = await fs.readFile(promptPath, 'utf-8');
        tools.logger.log('CG-Generator', `extractCGPlan: Prompt template read (size: ${promptTemplate.length} chars).`);
    } catch (readErr) {
        tools.logger.error('CG Generator', `Failed to read prompt template: ${readErr.message}`);
        tools.status.update('CG Generator: Template Error', { progress: 100, color: '#ff0000', timeout: 3000 });
        return;
    }

    const promptText = promptTemplate
        .replace('${targetCgCount}', pluginSettings.cgCount || 1)
        .replace('${charactersInvolved}', charactersInvolved)
        .replace('${backgroundPath}', backgroundPath || 'Unknown')
        .replace('${canonTidbit}', canonTidbit ? `Canon Context:\n${canonTidbit}` : '')
        .replace('${playerInstructions}', playerInstructions)
        .replace('${smartInstructions}', smartInstructions)
        .replace('${sceneText}', sceneText);

    tools.logger.log('CG-Generator', `extractCGPlan: Prompt prepared (size: ${promptText.length} chars). Calling LLM...`);

    tools.logger.llmRequest({
        msg: 'CG Generator - Extraction',
        messages: [{ role: 'user', content: promptText }],
        model: modelDef.model,
        provider: modelDef.provider
    });

    try {
        let frames = [];

        tools.logger.runtime(`[CG Generator] extractCGPlan: Entering tools.llm.call [${modelDef.model} via ${modelDef.provider}]...`);
        const response = await tools.llm.call([{ role: 'user', content: promptText }], {
            model: modelDef.model,
            provider: modelDef.provider,
            expectJson: true,
            callingModule: 'Plugin:cg_generator'
        });
        tools.logger.runtime(`[CG Generator] extractCGPlan: LLM call returned successfully.`);

        tools.logger.llmResponse({
            msg: 'CG Generator - Extraction',
            content: response.content,
            model: response.model,
            provider: response.provider
        });

        frames = response.content;

        if (!Array.isArray(frames) || frames.length === 0) {
            tools.logger.runtime(`[CG Generator] No valid frames extracted.`);
            tools.status.update('CG Generator: 0 frames', { progress: 100, timeout: 3000 });
            return;
        }

        turnContext.cgPlan = { frames: [], totalFrames: frames.length, currentTurn };

        // We only take the first frame for now if cgCount is 1, but we loop if there's more.
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];

            if (!frame.description || (!frame.start_line && !frame.line)) continue;

            const targetStartLine = frame.start_line || frame.line;

            // --- FUZZY MATCHING & VALIDATION FOR START ---
            let bestStartIdx = -1;
            let highestStartSimilarity = 0;

            if (targetStartLine) {
                for (let j = 0; j < sequence.length; j++) {
                    const ltext = sequence[j].text || sequence[j].line || '';
                    const similarity = getStringSimilarity(ltext, targetStartLine);
                    if (similarity > highestStartSimilarity) {
                        highestStartSimilarity = similarity;
                        bestStartIdx = j;
                    }
                }
            }

            // Require > 95% similarity or fall back to number
            if (highestStartSimilarity < 0.95) {
                if (typeof frame.start_line_number === 'number' && frame.start_line_number >= 0 && frame.start_line_number < sequence.length) {
                    tools.logger.runtime(`[CG Generator] Start fuzzy match < 95% (${(highestStartSimilarity * 100).toFixed(1)}%). Falling back to explicit start_line_number: [${frame.start_line_number}].`);
                    bestStartIdx = frame.start_line_number;
                } else if (highestStartSimilarity > 0.85) {
                    tools.logger.runtime(`[CG Generator] Start fuzzy match between 85-95% (${(highestStartSimilarity * 100).toFixed(1)}%) with no valid line number fallback. Proceeding with index ${bestStartIdx}.`);
                } else {
                    tools.logger.runtime(`[CG Generator] Start fuzzy match failed (${(highestStartSimilarity * 100).toFixed(1)}%) and no valid start_line_number provided. Defaulting to index 0.`);
                    bestStartIdx = 0;
                }
            } else {
                tools.logger.runtime(`[CG Generator] Start fuzzy match successful (${(highestStartSimilarity * 100).toFixed(1)}%) for index ${bestStartIdx}.`);
            }

            // --- FUZZY MATCHING FOR END ---
            let bestEndIdx = -1;
            let highestEndSimilarity = 0;

            if (frame.end_line) {
                for (let j = Math.max(0, bestStartIdx); j < sequence.length; j++) {
                    const ltext = sequence[j].text || sequence[j].line || '';
                    const similarity = getStringSimilarity(ltext, frame.end_line);
                    if (similarity > highestEndSimilarity) {
                        highestEndSimilarity = similarity;
                        bestEndIdx = j;
                    }
                }
            }

            if (highestEndSimilarity < 0.95) {
                if (typeof frame.end_line_number === 'number' && frame.end_line_number >= bestStartIdx && frame.end_line_number < sequence.length) {
                    tools.logger.runtime(`[CG Generator] End fuzzy match < 95% (${(highestEndSimilarity * 100).toFixed(1)}%). Falling back to explicit end_line_number: [${frame.end_line_number}].`);
                    bestEndIdx = frame.end_line_number;
                } else if (highestEndSimilarity > 0.85) {
                    tools.logger.runtime(`[CG Generator] End fuzzy match between 85-95% (${(highestEndSimilarity * 100).toFixed(1)}%) with no valid line number fallback. Proceeding with index ${bestEndIdx}.`);
                } else {
                    tools.logger.runtime(`[CG Generator] End fuzzy match failed (${(highestEndSimilarity * 100).toFixed(1)}%) and no valid end_line_number. Validating limits based on start.`);
                    bestEndIdx = sequence.length - 1;
                }
            } else {
                tools.logger.runtime(`[CG Generator] End fuzzy match successful (${(highestEndSimilarity * 100).toFixed(1)}%) for index ${bestEndIdx}.`);
            }

            // Calculate bounds constraint
            const minAllowedDuration = Math.max(1, Math.floor(sequence.length * (minDurationStr / 100)));
            const maxAllowedDuration = Math.max(1, Math.floor(sequence.length * (maxDurationStr / 100)));

            if (bestStartIdx === -1) {
                tools.logger.runtime(`[CG Generator] Could not resolve a valid start line. Defaulting to index 0.`);
                bestStartIdx = 0;
            }

            // Enforce start and end logic
            if (bestEndIdx <= bestStartIdx) {
                bestEndIdx = bestStartIdx + Math.floor((minAllowedDuration + maxAllowedDuration) / 2);
            }

            // Clamp duration based on user percentages (e.g. 20% to 40%)
            let duration = bestEndIdx - bestStartIdx;
            if (duration < minAllowedDuration) {
                tools.logger.runtime(`[CG Generator] CG Duration (${duration}) below minimum allowed (${minAllowedDuration}). Extending end index...`);
                bestEndIdx = bestStartIdx + minAllowedDuration;
            } else if (duration > maxAllowedDuration) {
                tools.logger.runtime(`[CG Generator] CG Duration (${duration}) above maximum allowed (${maxAllowedDuration}). Clamping end index...`);
                bestEndIdx = bestStartIdx + maxAllowedDuration;
            }

            // Final safety clamp against sequence bounds
            bestEndIdx = Math.min(bestEndIdx, sequence.length - 1);

            tools.logger.runtime(`[CG Generator] Final CG Trigger Indices: Start: ${bestStartIdx} - End: ${bestEndIdx}. Proceeding to generation.`);



            // Mark the whole planned span so the viewer can show pending UI even
            // if the player navigates past the first CG line before generation ends.
            markCgPendingSpan(turnContext, bestStartIdx, bestEndIdx);

            turnContext.cgPlan.frames.push({
                frameData: frame,
                bestStartIdx,
                bestEndIdx,
                cgIndex: i
            });
        }
    } catch (e) {
        tools.logger.error('CG Generator', `Failed to execute CG Extraction logic: ${e.message}`, null, e);
        tools.status.update('CG Generator: Error', { progress: 100, color: '#ff0000', timeout: 3000 });
    }
}

/**
 * Phase 2: Background Hook. Reads the plan and executes heavy image generation.
 */
async function generateCGImages(turnContext, tools) {
    const pluginSettings = tools.settings.getSelf() || {};

    if (!turnContext.cgPlan || !turnContext.cgPlan.frames || turnContext.cgPlan.frames.length === 0) {
        tools.logger.runtime(`[CG Generator] Phase 2 Generation skipping: No cgPlan available (extraction failed/skipped).`);
        tools.status.update('CG Generator: Ended.', { progress: 100, color: '#ffaa00', timeout: 3000 });
        return;
    }
    tools.logger.log('Generation', `Background image generation started with ${turnContext.cgPlan.frames.length} planned frame(s).`);

    const currentTurn = turnContext.turnNumber;
    const sequence = turnContext.output?.sequence || [];
    let completedFrames = 0;
    let failedFrames = 0;

    // We already checked and set this in Phase 1, so we reuse it safely.
    const partyData = turnContext.output.party || [];
    const playerCharacterName = turnContext.input?.playerCharacterName;
    const baseReferenceCharacters = uniqueStrings([
        ...partyData,
        playerCharacterName
    ]);
    const firstBgScene = sequence.find(s => s.background);
    const backgroundPath = firstBgScene ? firstBgScene.background : null;

    let bgBase64 = null;
    let resolvedCharacters = [];
    const resolvedCharacterMap = new Map();

    // Base context gathering (same for all frames in this turn)
    if (backgroundPath) {
        const fullBgPath = path.join(turnContext.rootDirectory, backgroundPath);
        bgBase64 = await getFileAsBase64(fullBgPath);
    }

    let generationBaseRefs;
    try {
        generationBaseRefs = await resolveCharacterReferences(
            turnContext,
            tools,
            baseReferenceCharacters,
            'Generation'
        );
    } catch (setupError) {
        tools.logger.error('CG Generator', `Failed to resolve base CG references: ${setupError.message}`);
        for (const plan of turnContext.cgPlan.frames) {
            await finalizeFailedCgFrame(turnContext, tools, plan, `Reference resolution failed: ${setupError.message}`);
            failedFrames++;
        }
        tools.status.update('CG Generator: Failed', { progress: 100, color: '#ff0000', timeout: 5000 });
        return;
    }
    resolvedCharacters = generationBaseRefs.resolved;
    for (const ref of resolvedCharacters) {
        resolvedCharacterMap.set(ref.normalizedName, ref);
    }

    // Iterate through planned frames
    for (const plan of turnContext.cgPlan.frames) {
        const { frameData, bestStartIdx, bestEndIdx, cgIndex } = plan;
        const frameCharacters = uniqueStrings(Array.isArray(frameData.characters) ? frameData.characters : []);
        const frameReferenceHints = buildFrameReferenceHints(turnContext, frameCharacters, bestStartIdx, bestEndIdx);
        emitCgPending(tools, currentTurn, plan);

        let frameSpecificReferences = [];
        const frameResolvedMap = new Map();
        if (frameCharacters.length > 0) {
            try {
                const frameRefs = await resolveCharacterReferences(
                    turnContext,
                    tools,
                    frameCharacters,
                    `Generation(frame ${cgIndex + 1})`,
                    { referenceHints: frameReferenceHints }
                );
                frameSpecificReferences = frameRefs.resolved;
            } catch (refError) {
                tools.logger.error('CG Generator', `Failed to resolve CG references for frame ${cgIndex + 1}: ${refError.message}`);
                await finalizeFailedCgFrame(turnContext, tools, plan, `Reference resolution failed: ${refError.message}`);
                failedFrames++;
                continue;
            }
            for (const ref of frameSpecificReferences) {
                frameResolvedMap.set(ref.normalizedName, ref);
                if (!resolvedCharacterMap.has(ref.normalizedName)) {
                    resolvedCharacterMap.set(ref.normalizedName, ref);
                    resolvedCharacters.push(ref);
                }
            }
        }

        // --- RUNTIME CROSS-REFERENCE: Un-sprited Characters ---
        const unSpritedWarnings = [];
        for (const charName of frameCharacters) {
            const key = normalizeCharacterNameForLookup(charName);
            if (key && (frameResolvedMap.has(key) || resolvedCharacterMap.has(key))) continue;

            let desc = (frameData.unseen_characters && frameData.unseen_characters[charName])
                ? frameData.unseen_characters[charName]
                : `No sprite could be resolved from the project sprite catalog. Draw this person as a distinct, generic NPC matching the text context.`;

            unSpritedWarnings.push(`- **WARNING FOR '${charName}'**: This character has no resolvable sprite/reference asset. Visual description: ${desc}`);
            tools.logger.runtime(`[CG Generator] Injected unresolved-character warning for: ${charName}`);
        }

        const referencesToAttach = frameSpecificReferences.length > 0 ? frameSpecificReferences : resolvedCharacters;
        const referencedCharacterGuidance = buildReferencedCharacterGuidance(referencesToAttach);

        if (referencesToAttach.length === 0) {
            tools.logger.runtime(`[CG Generator] No sprite references could be attached for frame ${cgIndex + 1}. Proceeding with text-only guidance.`);
        } else {
            tools.logger.runtime(`[CG Generator] Attaching ${referencesToAttach.length} sprite references for frame ${cgIndex + 1}.`);
        }

        // 3. Generate the image (Interleaved Payload)
        const parts = [];

        parts.push({ text: `Target Scene Description:\n${frameData.description}\n` });

        if (bgBase64) {
            parts.push({ text: `Background reference image (Use as layout inspiration, adapt to fit scene):` });
            parts.push({ inlineData: { mimeType: "image/png", data: bgBase64 } });
        }

        for (const char of referencesToAttach) {
            parts.push({ text: formatCharacterReferenceIntro(char) });
            parts.push({ inlineData: { mimeType: "image/png", data: char.b64 } });
        }

        let promptText = `
### CORE INSTRUCTIONS
- **ART STYLE (CRITICAL)**: You MUST adopt the exact same art style, rendering technique, and aesthetic of the reference images provided. If the references are 2D anime/cel-shaded, your output MUST be 2D anime/cel-shaded. If it's 3d / game like, keep it that way. Please evaluate the art style before you start.
- **SFW ONLY**: Keep intent clear but without explicit indecency.
- **CHARACTERS**: Match eye color exactly (crucial for heterochromia or unusual traits). Use their reference images tightly for poses, outfits, and facial features. NEVER draw the same character twice in the same image. NEVER generate extra background characters that aren't mentioned.
- **ENVIRONMENT**: Use the background reference as layout inspiration, but adapt it to fit the current scene state while maintaining the aforementioned art style.
`;

        if (referencedCharacterGuidance.length > 0) {
            promptText += `\n### REFERENCED CHARACTER DETAILS (CRITICAL)\n${referencedCharacterGuidance.join('\n')}\n`;
        }

        if (unSpritedWarnings.length > 0) {
            promptText += `\n### UNREFERENCED CHARACTER WARNINGS (CRITICAL)\n${unSpritedWarnings.join('\n')}\n`;
        }

        if (pluginSettings.imageInstructions && pluginSettings.imageInstructions.trim() !== '') {
            promptText += `\n### USER CUSTOM INSTRUCTIONS\n- ${pluginSettings.imageInstructions.trim()}\n`;
        }

        parts.push({ text: promptText });

        tools.status.update(`CG Generator: Generating image ${cgIndex + 1}/${turnContext.cgPlan.totalFrames}...`, { progress: 50 + (50 * (cgIndex / turnContext.cgPlan.totalFrames)), color: '#ffaa00' });
        tools.logger.log('Generation', `Generating CG frame ${cgIndex + 1}/${turnContext.cgPlan.totalFrames}...`);

        try {
            let resultingBase64s = [];
            let relImgStr = '';
            let failureReason = '';

            try {
                resultingBase64s = await providers.generateImages(tools, parts);
            } catch (providerError) {
                tools.logger.error('CG Generator', `Provider generation failed: ${providerError.message}`);
                failureReason = providerError.message;
                resultingBase64s = [];
            }

            if (resultingBase64s.length > 0) {
                const storage = tools.project.getChatPluginStorage();
                await fs.mkdir(storage.absolutePath, { recursive: true });

                const imgFileName = `cg_${cgIndex}.webp`;
                const permanentImgPath = path.join(storage.absolutePath, imgFileName);

                const pngBuffer = Buffer.from(resultingBase64s[0], 'base64');

                // Metadata check to debug resolution
                try {
                    const metadata = await sharp(pngBuffer).metadata();
                    tools.logger.runtime(`[CG Generator] Received image dimensions: ${metadata.width}x${metadata.height}. Quality: ${metadata.format}`);
                } catch (mErr) {
                    tools.logger.error('CG Generator', `Failed to read metadata: ${mErr.message}`);
                }

                const webpBuffer = await sharp(pngBuffer)
                    .webp({ quality: 85 })
                    .toBuffer();

                await fs.writeFile(permanentImgPath, webpBuffer);
                tools.logger.runtime(`[CG Generator] Saved permanent compressed WebP record to: ${permanentImgPath}`);

                const relPathForFrontend = `${storage.relativePath}/${imgFileName}`;
                relImgStr = `${tools.project.resolveAssetUrl(relPathForFrontend)}?v=${Date.now()}`;

                // --- WIP / Future idea: VISUAL CONTINUITY: RAG STORAGE ---
                /*
                if (pluginSettings.smartContinuity) {
                    try {
                        const targetPath = `${storage.relativePath}/${imgFileName}`; // Project relative

                        if (frameData.location_name) {
                            await tools.facts.addFact({
                                source: frameData.location_name,
                                target: targetPath,
                                predicate: 'CG_APPEARANCE',
                                fact_value: `Environment matching narrative location.`,
                            });
                        }

                        if (frameData.unseen_characters && typeof frameData.unseen_characters === 'object') {
                            for (const [npcName, npcDesc] of Object.entries(frameData.unseen_characters)) {
                                await tools.facts.addFact({
                                    source: npcName,
                                    target: targetPath,
                                    predicate: 'CG_APPEARANCE',
                                    fact_value: npcDesc,
                                });
                            }
                        }
                    } catch (storeError) {
                        tools.logger.error('CG Generator', `Failed to save Continuity Fact: ${storeError.message}`);
                    }
                }
                */

                tools.logger.log('CGGenerator', `New CG emitted! Bound to sequence ${bestStartIdx}-${bestEndIdx}`);

                if (!turnContext.processed) {
                    turnContext.processed = {};
                }
                if (!turnContext.processed.cgOverlays) {
                    turnContext.processed.cgOverlays = [];
                }
                turnContext.processed.cgOverlays.push({
                    image: relImgStr,
                    startIdx: bestStartIdx,
                    endIdx: bestEndIdx
                });

                if (turnContext.output && Array.isArray(turnContext.output.sequence)) {
                    clearCgPendingSpan(turnContext, bestStartIdx, bestEndIdx);
                    for (let i = bestStartIdx; i <= bestEndIdx && i < turnContext.output.sequence.length; i++) {
                        turnContext.output.sequence[i].cg = relImgStr;
                        delete turnContext.output.sequence[i].cg_failed;
                        delete turnContext.output.sequence[i].cg_error;
                        delete turnContext.output.sequence[i].cg_failed_at;
                    }
                }

                // Recompute thumbnail and persist the updated TurnContext snapshot.
                if (tools.vn && typeof tools.vn.recomputeThumbnail === 'function') {
                    try {
                        tools.logger.runtime('[CG Generator] Recomputing thumbnail with new CG...');
                        await tools.vn.recomputeThumbnail(turnContext);
                    } catch (thumbErr) {
                        tools.logger.error('CG Generator', `Thumbnail recompute failed after CG attach: ${thumbErr.message}`);
                    }
                }
                await persistTurnSnapshotWithCg(turnContext, tools);

                // Emitting the lazy load fulfillment!
                tools.socket.emit('vn-cg-ready', {
                    turnNumber: currentTurn,
                    cgData: {
                        image: relImgStr,
                        startIdx: bestStartIdx,
                        endIdx: bestEndIdx,
                        cgIndex
                    }
                });
                completedFrames++;
            } else {
                const reason = failureReason || 'Provider returned no images.';
                tools.logger.warn('CG Generator', `${reason} Frame ${cgIndex + 1} will continue without a CG overlay.`);
                await finalizeFailedCgFrame(turnContext, tools, plan, reason);
                failedFrames++;
            }
        } catch (e) {
            tools.logger.error('CG Generator', `Failed to execute CG Image Generation for frame ${plan.cgIndex}: ${e.message}`, null, e);
            await finalizeFailedCgFrame(turnContext, tools, plan, e.message);
            failedFrames++;
        }
    }

    if (failedFrames > 0 && completedFrames === 0) {
        tools.status.update('CG Generator: Failed', { progress: 100, color: '#ff0000', timeout: 5000 });
    } else if (failedFrames > 0) {
        tools.status.update('CG Generator: Complete with errors', { progress: 100, color: '#ffaa00', timeout: 5000 });
    } else {
        tools.status.update('CG Generator: Complete!', { progress: 100, color: '#ffaa00', timeout: 3000 });
    }
}

async function persistGeneratedImage(turnContext, tools, imageBase64, filePrefix = 'cg_custom') {
    const storage = tools.project.getChatPluginStorage();
    await fs.mkdir(storage.absolutePath, { recursive: true });

    const fileName = `${filePrefix}_${crypto.randomUUID().slice(0, 8)}.webp`;
    const absolutePath = path.join(storage.absolutePath, fileName);
    const pngBuffer = Buffer.from(imageBase64, 'base64');
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 88 }).toBuffer();
    await fs.writeFile(absolutePath, webpBuffer);

    const relPathForFrontend = `${storage.relativePath}/${fileName}`;
    return `${tools.project.resolveAssetUrl(relPathForFrontend)}?v=${Date.now()}`;
}

function isPathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function resolveImageInputToInlineData(imageInput, rootDirectory) {
    if (!imageInput) return null;

    if (typeof imageInput === 'string') {
        const trimmed = imageInput.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('data:')) {
            const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) return null;
            return { mimeType: match[1] || 'image/png', data: match[2] };
        }
        const filePath = path.isAbsolute(trimmed) ? trimmed : path.join(rootDirectory || '', trimmed);
        const b64 = await getFileAsBase64(filePath);
        if (!b64) return null;
        return { mimeType: 'image/png', data: b64 };
    }

    if (typeof imageInput !== 'object') return null;

    if (typeof imageInput.data === 'string' && imageInput.data.trim()) {
        return {
            mimeType: imageInput.mimeType || 'image/png',
            data: imageInput.data.trim()
        };
    }

    if (typeof imageInput.dataUrl === 'string' && imageInput.dataUrl.trim().startsWith('data:')) {
        const match = imageInput.dataUrl.trim().match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        return { mimeType: match[1] || imageInput.mimeType || 'image/png', data: match[2] };
    }

    if (typeof imageInput.url === 'string' && imageInput.url.trim().startsWith('data:')) {
        const match = imageInput.url.trim().match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        return { mimeType: match[1] || imageInput.mimeType || 'image/png', data: match[2] };
    }

    if (typeof imageInput.path === 'string' && imageInput.path.trim()) {
        const filePath = path.isAbsolute(imageInput.path.trim())
            ? imageInput.path.trim()
            : path.join(rootDirectory || '', imageInput.path.trim());
        const b64 = await getFileAsBase64(filePath);
        if (!b64) return null;
        return { mimeType: imageInput.mimeType || 'image/png', data: b64 };
    }

    return null;
}

async function buildCustomRequestParts(turnContext, request = {}) {
    const rootDirectory = turnContext?.rootDirectory || turnContext?.runtime?.rootDirectory || '';
    const parts = Array.isArray(request.parts)
        ? request.parts.map(p => ({ ...p }))
        : [];

    const textPrompt = typeof request.prompt === 'string'
        ? request.prompt.trim()
        : (typeof request.description === 'string' ? request.description.trim() : '');

    if (textPrompt) {
        parts.unshift({ text: textPrompt });
    }

    const allImageInputs = [];
    if (Array.isArray(request.images)) allImageInputs.push(...request.images);
    if (Array.isArray(request.references)) allImageInputs.push(...request.references);

    let attachedImageCount = 0;
    for (const imageInput of allImageInputs) {
        const inlineData = await resolveImageInputToInlineData(imageInput, rootDirectory);
        if (!inlineData?.data) continue;
        parts.push({ inlineData });
        attachedImageCount++;
    }

    const hasText = parts.some(p => typeof p?.text === 'string' && p.text.trim() !== '');
    if (!hasText && attachedImageCount > 0) {
        parts.unshift({ text: 'Use the provided reference images to generate a coherent final image.' });
    }

    return {
        parts,
        imageInputCount: attachedImageCount
    };
}

function ensureRequestHasUsableInputs(parts) {
    const hasText = parts.some(p => typeof p?.text === 'string' && p.text.trim() !== '');
    const hasImages = parts.some(p => p?.inlineData?.data);
    return hasText || hasImages;
}

async function saveGeneratedImageToFile(turnContext, imageBase64, outputPath) {
    const rootDirectory = turnContext?.rootDirectory || turnContext?.runtime?.rootDirectory;
    if (!rootDirectory) {
        throw new Error('Cannot save output file: missing rootDirectory in turn context.');
    }

    const resolvedPath = path.isAbsolute(outputPath)
        ? path.resolve(outputPath)
        : path.resolve(rootDirectory, outputPath);

    if (!isPathInsideRoot(resolvedPath, rootDirectory)) {
        throw new Error(`Output path must stay inside project root. root=${rootDirectory} target=${resolvedPath}`);
    }

    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    const pngBuffer = Buffer.from(imageBase64, 'base64');
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 90 }).toBuffer();
    await fs.writeFile(resolvedPath, webpBuffer);
    return resolvedPath;
}

async function requestCustomCG(turnContext, tools, request = {}) {
    const pluginSettings = tools.settings.getSelf() || {};

    const normalized = await buildCustomRequestParts(turnContext, request);
    if (!ensureRequestHasUsableInputs(normalized.parts)) {
        return { ok: false, error: 'requestCustomCG requires text, images, or pre-built parts.' };
    }

    let images;
    try {
        images = await providers.generateImages(tools, normalized.parts, {
            provider: request.provider,
            model: request.model,
            modelTier: request.modelTier || request.preferredModelTier || request.tier,
            imageResolution: request.imageResolution || request.resolution,
            imageSizeOverride: request.imageSizeOverride,
            size: request.size,
            aspectRatio: request.aspectRatio || request.aspect_ratio || request.imageAspectRatio,
            comfyUiWorkflowFile: request.comfyUiWorkflowFile
        });
    } catch (error) {
        return { ok: false, error: error.message };
    }

    if (!Array.isArray(images) || images.length === 0) {
        return { ok: false, error: 'Provider returned no images.' };
    }

    const outputImage = await persistGeneratedImage(
        turnContext,
        tools,
        images[0],
        request.filePrefix || 'cg_custom'
    );

    const response = {
        ok: true,
        image: outputImage,
        provider: providers.resolveProviderId(request.provider || pluginSettings.imageProvider || 'wisgate'),
        imageCount: images.length,
        inputImageCount: normalized.imageInputCount
    };

    if (request.attachToSequence && turnContext?.output?.sequence?.length) {
        const startIdx = Number.isInteger(request.startIdx) ? request.startIdx : 0;
        const endIdx = Number.isInteger(request.endIdx)
            ? request.endIdx
            : Math.max(startIdx, turnContext.output.sequence.length - 1);

        for (let i = Math.max(0, startIdx); i <= endIdx && i < turnContext.output.sequence.length; i++) {
            turnContext.output.sequence[i].cg = outputImage;
        }

        if (!turnContext.processed) turnContext.processed = {};
        if (!turnContext.processed.cgOverlays) turnContext.processed.cgOverlays = [];
        turnContext.processed.cgOverlays.push({ image: outputImage, startIdx, endIdx });

        response.startIdx = startIdx;
        response.endIdx = endIdx;
    }

    if (request.emitSocket !== false && tools?.socket?.emit) {
        tools.socket.emit('vn-cg-ready', {
            turnNumber: turnContext?.turnNumber,
            cgData: {
                image: outputImage,
                startIdx: response.startIdx ?? 0,
                endIdx: response.endIdx ?? 0
            }
        });
    }

    return response;
}

async function requestCustomCGToFile(turnContext, tools, request = {}) {
    const pluginSettings = tools.settings.getSelf() || {};

    const normalized = await buildCustomRequestParts(turnContext, request);
    if (!ensureRequestHasUsableInputs(normalized.parts)) {
        return { ok: false, error: 'requestCustomCGToFile requires text, images, or pre-built parts.' };
    }

    let images;
    try {
        images = await providers.generateImages(tools, normalized.parts, {
            provider: request.provider,
            model: request.model,
            modelTier: request.modelTier || request.preferredModelTier || request.tier,
            imageResolution: request.imageResolution || request.resolution,
            imageSizeOverride: request.imageSizeOverride,
            size: request.size,
            aspectRatio: request.aspectRatio || request.aspect_ratio || request.imageAspectRatio,
            comfyUiWorkflowFile: request.comfyUiWorkflowFile
        });
    } catch (error) {
        return { ok: false, error: error.message };
    }

    if (!Array.isArray(images) || images.length === 0) {
        return { ok: false, error: 'Provider returned no images.' };
    }

    const outputPath = String(request.outputPath || '').trim() || `cg_exports/cg_file_${crypto.randomUUID().slice(0, 8)}.webp`;

    try {
        const absolutePath = await saveGeneratedImageToFile(turnContext, images[0], outputPath);
        return {
            ok: true,
            provider: providers.resolveProviderId(request.provider || pluginSettings.imageProvider || 'wisgate'),
            imageCount: images.length,
            inputImageCount: normalized.imageInputCount,
            outputPath,
            absolutePath
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function listSupportedProviders() {
    return providers.listProviders();
}

module.exports = {
    extractCGPlan,
    generateCGImages,
    requestCustomCG,
    requestCustomCGToFile,
    listSupportedProviders
};
