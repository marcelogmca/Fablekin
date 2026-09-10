const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { resolveTurnStorageKey } = require('../../modules/turn_storage_key.js');

/**
 * TTS Core Plugin for Dynamic Narrative Engine
 * Refactored from core to be a standalone module.
 */

const DEFAULT_TTS_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_LEASE_TTL_SECONDS = 20;
const LEASE_RENEW_INTERVAL_MS = 5000;
const VOICE_EXTENSIONS = ['.wav', '.mp3', '.ogg'];
const BASE_GENERIC_VOICE_PROFILE_KEYS = new Set(['generic', 'male', 'female']);

// Runtime registry so callbacks are bound to the exact job that created them.
const ACTIVE_TTS_JOBS = new Map(); // jobId -> jobState
const ACTIVE_JOBS_BY_CONTEXT = new Map(); // contextKey -> Set<jobId>
const TTS_JOB_QUEUE = []; // FIFO queue of jobIds waiting to be dispatched
let RUNNING_TTS_JOB_ID = null;

function createJobId(contextHash) {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(16).slice(2, 10);
    return `tts_${contextHash.slice(0, 10)}_${stamp}_${rand}`;
}

function buildContextIdentity(turnContext) {
    const projectName = String(turnContext?.projectName || 'default_project').toLowerCase();
    const chatDbPath = String(turnContext?.chatDbFullPath || '');
    const storageTurnKey = resolveTurnStorageKey(turnContext);
    const contextKey = `${projectName}|${chatDbPath}|${storageTurnKey}`;
    const contextHash = crypto.createHash('sha1').update(contextKey).digest('hex');

    return { projectName, chatDbPath, storageTurnKey, contextKey, contextHash };
}

function getTtsControlUrl(ttsApiEndpoint, controlPath) {
    try {
        const endpoint = new URL(ttsApiEndpoint || `${DEFAULT_TTS_BASE_URL}/generate`);
        endpoint.pathname = controlPath;
        endpoint.search = '';
        return endpoint.toString();
    } catch {
        return null;
    }
}

function stopLeaseRenewal(job) {
    if (job?.leaseTimer) {
        clearInterval(job.leaseTimer);
        job.leaseTimer = null;
    }
}

function removeJobFromQueue(jobId) {
    const index = TTS_JOB_QUEUE.indexOf(jobId);
    if (index !== -1) {
        TTS_JOB_QUEUE.splice(index, 1);
    }
}

function getQueuePosition(jobId) {
    const queuedIndex = TTS_JOB_QUEUE.indexOf(jobId);
    if (queuedIndex !== -1) return queuedIndex + 1;
    if (RUNNING_TTS_JOB_ID === jobId) return 0;
    return null;
}

function getQueueSnapshot() {
    return {
        running_job_id: RUNNING_TTS_JOB_ID,
        queued_job_ids: TTS_JOB_QUEUE.slice(),
        active_jobs: Array.from(ACTIVE_TTS_JOBS.values()).map(job => ({
            job_id: job.jobId,
            context_hash: job.contextHash,
            status: job.status,
            queued: job.status === 'queued',
            queue_position: getQueuePosition(job.jobId),
            requested_lines: Array.isArray(job.requestedLines) ? job.requestedLines.length : 0,
            total_lines: Array.isArray(job.ttsLines) ? job.ttsLines.length : 0,
            archive_turn_key: job.archiveTurnKey || resolveTurnStorageKey(job.turnContext),
            label: job.statusPrefix || null
        }))
    };
}

function registerActiveJob(job) {
    ACTIVE_TTS_JOBS.set(job.jobId, job);
    const existing = ACTIVE_JOBS_BY_CONTEXT.get(job.contextKey) || new Set();
    existing.add(job.jobId);
    ACTIVE_JOBS_BY_CONTEXT.set(job.contextKey, existing);
}

function unregisterActiveJob(jobId) {
    const job = ACTIVE_TTS_JOBS.get(jobId);
    if (!job) return;

    stopLeaseRenewal(job);
    removeJobFromQueue(jobId);
    if (RUNNING_TTS_JOB_ID === jobId) {
        RUNNING_TTS_JOB_ID = null;
    }
    ACTIVE_TTS_JOBS.delete(jobId);

    const contextSet = ACTIVE_JOBS_BY_CONTEXT.get(job.contextKey);
    if (contextSet) {
        contextSet.delete(jobId);
        if (contextSet.size === 0) {
            ACTIVE_JOBS_BY_CONTEXT.delete(job.contextKey);
        }
    }
}

async function renewJobLease(job, settings, tools) {
    const leaseUrl = getTtsControlUrl(settings.tts_api_endpoint, '/lease');
    if (!leaseUrl) return;

    try {
        await axios.post(
            leaseUrl,
            {
                job_id: job.jobId,
                context_hash: job.contextHash,
                lease_ttl_seconds: DEFAULT_LEASE_TTL_SECONDS
            },
            { timeout: 3000 }
        );
        job.leaseFailures = 0;
    } catch (error) {
        job.leaseFailures = (job.leaseFailures || 0) + 1;
        if (job.leaseFailures <= 2) {
            tools.logger.warn(
                'Lease',
                `Lease renewal failed for ${job.jobId}: ${error.message}`
            );
        }
    }
}

function startLeaseRenewal(job, settings, tools) {
    stopLeaseRenewal(job);

    // Renew immediately so app-close/focus-switch windows are covered right away.
    renewJobLease(job, settings, tools).catch(() => {});

    job.leaseTimer = setInterval(() => {
        if (!ACTIVE_TTS_JOBS.has(job.jobId)) {
            stopLeaseRenewal(job);
            return;
        }
        renewJobLease(job, settings, tools).catch(() => {});
    }, LEASE_RENEW_INTERVAL_MS);
}

function applyRuntimeJobState(job) {
    if (!job?.updateRuntimeState || !job.turnContext?.runtime) return;

    job.turnContext.runtime.ttsLines = job.ttsLines;
    job.turnContext.runtime.ttsJobId = job.jobId;
    job.turnContext.runtime._ttsFailedCrcs = job.failedCrcs;
    job.turnContext.runtime.isRegenerating = job.isRegenerating;
}

async function dispatchNextTtsJob(tools) {
    if (RUNNING_TTS_JOB_ID) return null;

    while (TTS_JOB_QUEUE.length > 0) {
        const nextJobId = TTS_JOB_QUEUE.shift();
        const job = ACTIVE_TTS_JOBS.get(nextJobId);

        if (!job || job.status === 'cancelled' || job.status === 'complete') {
            if (job) unregisterActiveJob(nextJobId);
            continue;
        }

        RUNNING_TTS_JOB_ID = nextJobId;
        job.status = 'running';
        job.startedAt = Date.now();

        applyRuntimeJobState(job);
        startLeaseRenewal(job, job.settings, tools);
        triggerTtsGeneration(job.requestedLines, job.settings, tools, job);
        return job;
    }

    return null;
}

async function finishTtsJob(job, tools) {
    if (!job) return;

    stopLeaseRenewal(job);
    if (job.isRegenerating && job.turnContext?.runtime) {
        job.turnContext.runtime.isRegenerating = false;
    }

    unregisterActiveJob(job.jobId);
    await dispatchNextTtsJob(tools);
}

function enqueueTtsJob(job, tools) {
    registerActiveJob(job);
    TTS_JOB_QUEUE.push(job.jobId);
    dispatchNextTtsJob(tools).catch(error => {
        tools.logger.error('Queue', `Failed to dispatch queued TTS job ${job.jobId}: ${error.message}`);
    });
    return job;
}

async function cancelJob(jobId, settings, tools, reason = 'context_invalidated', options = {}) {
    const job = ACTIVE_TTS_JOBS.get(jobId);
    if (!job) return false;
    const drainAfter = options.drainAfter !== false;

    if (job.status === 'complete' || job.status === 'cancelled') {
        unregisterActiveJob(jobId);
        return false;
    }

    job.status = 'cancelled';
    stopLeaseRenewal(job);
    removeJobFromQueue(jobId);
    if (job.isRegenerating && job.turnContext?.runtime) {
        job.turnContext.runtime.isRegenerating = false;
    }

    const effectiveSettings = job.settings || settings;
    const cancelUrl = getTtsControlUrl(effectiveSettings.tts_api_endpoint, '/cancel');
    if (cancelUrl) {
        try {
            await axios.post(
                cancelUrl,
                {
                    job_id: job.jobId,
                    context_hash: job.contextHash,
                    reason
                },
                { timeout: 3000 }
            );
        } catch (error) {
            tools.logger.warn(
                'Cancellation',
                `Cancel request failed for ${job.jobId}: ${error.message}`
            );
        }
    }

    unregisterActiveJob(jobId);
    if (drainAfter) {
        await dispatchNextTtsJob(tools);
    }
    return true;
}

async function cancelAllJobs(settings, tools, reason = 'context_invalidated') {
    const jobIds = Array.from(ACTIVE_TTS_JOBS.keys());
    if (jobIds.length === 0) return 0;

    let cancelled = 0;
    for (const jobId of jobIds) {
        const didCancel = await cancelJob(jobId, settings, tools, reason, { drainAfter: false });
        if (didCancel) cancelled++;
    }
    return cancelled;
}

function resolveJobFromCallback(ttsData) {
    if (!ttsData || typeof ttsData !== 'object') return null;
    if (typeof ttsData.job_id !== 'string' || ttsData.job_id.length === 0) return null;
    return ACTIVE_TTS_JOBS.get(ttsData.job_id) || null;
}

function resolveArchiveTurnKey(turnContext, explicitTurnKey = null) {
    const explicit = String(explicitTurnKey || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(explicit)) return explicit;
    return resolveTurnStorageKey(turnContext);
}

function startTtsJob(turnContext, tools, settings, ttsPayloadLines, requestedLines, options = {}) {
    if (!turnContext || !Array.isArray(requestedLines) || requestedLines.length === 0) return null;
    if (!turnContext.runtime || typeof turnContext.runtime !== 'object') turnContext.runtime = {};

    const contextIdentity = buildContextIdentity(turnContext);
    const isRegenerating = options.isRegenerating === true;
    const job = {
        jobId: createJobId(contextIdentity.contextHash),
        contextKey: contextIdentity.contextKey,
        contextHash: contextIdentity.contextHash,
        turnContext,
        ttsLines: ttsPayloadLines,
        requestedLines,
        failedCrcs: new Set(),
        leaseFailures: 0,
        leaseTimer: null,
        isRegenerating,
        updateRuntimeState: options.updateRuntimeState !== false,
        archiveTurnKey: options.archiveTurnKey || null,
        statusPrefix: options.statusPrefix || null,
        settings,
        status: 'queued',
        queuedAt: Date.now()
    };

    if (job.updateRuntimeState) {
        applyRuntimeJobState(job);
    }

    return enqueueTtsJob(job, tools);
}

function parseRequestedCrcSet(rawCrcs) {
    if (!Array.isArray(rawCrcs) || rawCrcs.length === 0) return null;
    return new Set(rawCrcs.map(crc => String(crc)));
}

function normalizeVoiceToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function naturalSort(values = []) {
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function normalizeGenericVoiceProfileKey(value) {
    const normalized = normalizeVoiceToken(value);
    if (!normalized || ['null', 'none', 'unknown', 'n/a', 'na'].includes(normalized)) return '';
    return normalized;
}

function isSemanticGenericVoiceProfileKey(profileKey) {
    const normalized = normalizeGenericVoiceProfileKey(profileKey);
    return !!normalized && !BASE_GENERIC_VOICE_PROFILE_KEYS.has(normalized);
}

function extractGenericVoiceProfileKey(stem) {
    const normalizedStem = normalizeVoiceToken(stem);
    if (!normalizedStem) return '';

    const parts = normalizedStem.split('_').filter(Boolean);
    while (parts.length > 0 && /^\d+$/.test(parts[0])) {
        parts.shift();
    }

    if (parts.length === 0) return '';
    if (parts.length === 1 && parts[0] === 'generic') return 'generic';
    if (parts[parts.length - 1] !== 'generic') return '';

    const profileParts = parts.slice(0, -1);
    if (profileParts.length === 0) return 'generic';
    return normalizeGenericVoiceProfileKey(profileParts.join('_'));
}

function buildVoiceCatalogFromFilenames(filenames = [], voicesDir = null) {
    const byCharacter = {};
    const globalMoodSet = new Set(['neutral']);
    const genericProfileMap = new Map();
    const voiceFiles = filenames.filter(filename =>
        VOICE_EXTENSIONS.some(ext => String(filename || '').toLowerCase().endsWith(ext))
    );
    const stems = voiceFiles
        .map(filename => path.parse(filename).name)
        .filter(Boolean);

    const baseStemSet = new Set(stems.map(stem => normalizeVoiceToken(stem)).filter(Boolean));

    for (const filename of voiceFiles) {
        const stem = path.parse(filename).name;
        const genericProfileKey = extractGenericVoiceProfileKey(stem);
        if (!genericProfileKey) continue;

        if (!genericProfileMap.has(genericProfileKey)) {
            genericProfileMap.set(genericProfileKey, new Set());
        }
        genericProfileMap.get(genericProfileKey).add(filename);
    }

    for (const stem of stems) {
        const normalizedStem = normalizeVoiceToken(stem);
        if (!normalizedStem) continue;

        const separatorIndex = stem.lastIndexOf('_');
        if (separatorIndex <= 0) {
            if (!byCharacter[normalizedStem]) byCharacter[normalizedStem] = new Set(['neutral']);
            continue;
        }

        const baseCharacter = normalizeVoiceToken(stem.slice(0, separatorIndex));
        const mood = normalizeVoiceToken(stem.slice(separatorIndex + 1));
        if (!baseCharacter || !mood || mood === 'talk' || mood === 'blink') {
            if (!byCharacter[normalizedStem]) byCharacter[normalizedStem] = new Set(['neutral']);
            continue;
        }

        // Only treat "*_mood" as a mood variant if "<base>.wav/mp3/ogg" exists too.
        if (!baseStemSet.has(baseCharacter)) {
            if (!byCharacter[normalizedStem]) byCharacter[normalizedStem] = new Set(['neutral']);
            continue;
        }

        if (!byCharacter[baseCharacter]) byCharacter[baseCharacter] = new Set(['neutral']);
        byCharacter[baseCharacter].add(mood);
        globalMoodSet.add(mood);
    }

    const serializedByCharacter = Object.fromEntries(
        Object.entries(byCharacter).map(([key, valueSet]) => [key, naturalSort(Array.from(valueSet))])
    );

    const genericProfiles = {};
    for (const [profileKey, files] of genericProfileMap.entries()) {
        genericProfiles[profileKey] = {
            key: profileKey,
            files: naturalSort(Array.from(files))
        };
    }
    const genericProfileKeys = naturalSort(Object.keys(genericProfiles));
    const globalMoods = naturalSort(Array.from(globalMoodSet));

    return {
        sourceDir: voicesDir,
        totalVoiceFiles: voiceFiles.length,
        globalMoods,
        byCharacter: serializedByCharacter,
        genericProfiles,
        summary: {
            genericProfileCount: genericProfileKeys.length,
            semanticGenericProfileCount: genericProfileKeys.filter(isSemanticGenericVoiceProfileKey).length
        }
    };
}

async function discoverVoiceCatalog(turnContext, tools) {
    const rootDirectory = turnContext?.rootDirectory || turnContext?.runtime?.rootDirectory;
    const voicesDir = rootDirectory ? path.join(rootDirectory, 'assets', 'voices') : null;

    if (!voicesDir) {
        return buildVoiceCatalogFromFilenames([], null);
    }

    let filenames = [];
    try {
        filenames = await fs.readdir(voicesDir);
    } catch (error) {
        tools.logger.log('Lifecycle', `Voice mood discovery skipped (${voicesDir} not available): ${error.message}`);
        return buildVoiceCatalogFromFilenames([], voicesDir);
    }

    return buildVoiceCatalogFromFilenames(filenames, voicesDir);
}

function getVoiceCatalog(turnContext) {
    const catalog = turnContext?.runtime?.ttsCore?.voiceCatalog;
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return null;
    return catalog;
}

function getAvailableGenericVoiceProfileKeys(turnContext) {
    const catalog = getVoiceCatalog(turnContext);
    const genericProfiles = catalog?.genericProfiles;
    if (!genericProfiles || typeof genericProfiles !== 'object' || Array.isArray(genericProfiles)) return [];

    return naturalSort(
        Object.keys(genericProfiles).filter(profileKey => {
            const files = genericProfiles[profileKey]?.files;
            return Array.isArray(files) && files.length > 0;
        })
    );
}

function readGenericVoiceProfilePayload(turnContext, characterKey) {
    const registry = turnContext?.processed?.ttsCore?.genericVoiceProfiles;
    if (!registry || !characterKey) return null;
    if (registry instanceof Map) return registry.get(characterKey) || null;
    if (typeof registry === 'object') return registry[characterKey] || null;
    return null;
}

function resolveGenericVoiceProfileForCharacter(turnContext, character, gender = null) {
    const characterKey = normalizeVoiceToken(character);
    if (!characterKey || characterKey === 'narrator') return null;

    const availableProfiles = new Set(getAvailableGenericVoiceProfileKeys(turnContext));
    if (availableProfiles.size === 0) return null;

    const payload = readGenericVoiceProfilePayload(turnContext, characterKey);
    const payloadProfile = normalizeGenericVoiceProfileKey(payload?.profileKey);
    if (payloadProfile && isSemanticGenericVoiceProfileKey(payloadProfile) && availableProfiles.has(payloadProfile)) {
        return payloadProfile;
    }

    const normalizedGender = normalizeVoiceToken(gender);
    if ((normalizedGender === 'male' || normalizedGender === 'female') && availableProfiles.has(normalizedGender)) {
        return normalizedGender;
    }

    if (availableProfiles.has('generic')) {
        return 'generic';
    }

    return null;
}

async function ensureGenericVoiceProfilesHydrated(turnContext, tools) {
    if (!turnContext || !tools?.plugins?.isInstalled) return null;
    if (!tools.plugins.isInstalled('character_classifier')) return null;
    return await tools.plugins.tryCall(
        'character_classifier',
        'hydrateGenericVoiceProfiles',
        [],
        { silent: true, fallback: null }
    );
}

async function resolveArchiveState(turnContext, tools, storageTurnKeyOverride = null) {
    const storageTurnKey = resolveArchiveTurnKey(turnContext, storageTurnKeyOverride);
    let archiveBase = null;
    let existingFiles = [];

    try {
        if (typeof tools?.project?.getChatPluginStorageFromContext === 'function') {
            archiveBase = tools.project.getChatPluginStorageFromContext(turnContext, storageTurnKey).absolutePath;
        } else if (typeof tools?.project?.getChatPluginStorage === 'function') {
            archiveBase = tools.project.getChatPluginStorage(storageTurnKey).absolutePath;
        }
    } catch {
        archiveBase = null;
    }

    if (archiveBase) {
        try {
            existingFiles = await fs.readdir(archiveBase);
        } catch {
            // Directory missing means no archive yet for this turn.
        }
    }

    const existingSet = new Set(existingFiles.filter(file => file.endsWith('.wav')));
    return { archiveBase, existingSet, storageTurnKey };
}

async function resolveMissingTtsLines(turnContext, settings, tools, requestedCrcSet = null) {
    await ensureGenericVoiceProfilesHydrated(turnContext, tools);
    const ttsPayloadLines = getTtsPayloadLines(turnContext, settings, tools);
    if (ttsPayloadLines.length === 0) {
        return {
            reason: 'no_tts_lines',
            ttsPayloadLines,
            candidateLines: [],
            missingTtsLines: [],
            archiveBase: null
        };
    }

    const candidateLines = requestedCrcSet
        ? ttsPayloadLines.filter(line => requestedCrcSet.has(String(line.crc)))
        : ttsPayloadLines;

    if (candidateLines.length === 0) {
        return {
            reason: 'no_matching_requested_crcs',
            ttsPayloadLines,
            candidateLines,
            missingTtsLines: [],
            archiveBase: null
        };
    }

    const { archiveBase, existingSet } = await resolveArchiveState(turnContext, tools);
    const missingTtsLines = candidateLines.filter(line => !existingSet.has(`${line.crc}.wav`));

    return {
        reason: missingTtsLines.length === 0 ? 'no_missing_lines' : 'ok',
        ttsPayloadLines,
        candidateLines,
        missingTtsLines,
        archiveBase
    };
}

function normalizeCrcValue(rawCrc) {
    const value = String(rawCrc || '').trim();
    if (!value) return null;
    return value.replace(/[^\w.-]/g, '_');
}

function resolveKnownGender(turnContext, character) {
    const characterKey = String(character || '').trim().toLowerCase();
    if (!characterKey) return null;

    const registry = turnContext?.processed?.characterGenders;
    if (registry && typeof registry.get === 'function') {
        return registry.get(characterKey) || null;
    }

    if (registry && typeof registry === 'object') {
        return registry[characterKey] || null;
    }

    const metadataGender = turnContext?.processed?.characterMetadata?.[characterKey]?.gender;
    return metadataGender || null;
}

function normalizeExternalTtsLines(turnContext, tools, rawLines, options = {}) {
    const { sanitizeForCrc, calculateCrc, cleanTtsText } = tools.utils;
    const defaultCharacter = String(options.character || 'Narrator').trim() || 'Narrator';
    const defaultGender = options.gender || null;
    const defaultMood = options.mood || null;
    const defaultGenericVoiceProfile = normalizeGenericVoiceProfileKey(
        options.generic_voice_profile || options.genericVoiceProfile
    );

    return rawLines.map((rawLine, index) => {
        const line = typeof rawLine === 'string'
            ? { text: rawLine }
            : ((rawLine && typeof rawLine === 'object') ? rawLine : {});

        const rawText = String(line.text || line.line || line.originaltext || '').trim();
        if (!rawText) return null;

        const character = String(line.character || defaultCharacter).trim() || 'Narrator';
        const isNarrator = character.toLowerCase() === 'narrator' || String(line.gender || defaultGender || '').toLowerCase() === 'narrator';
        const gender = isNarrator
            ? 'narrator'
            : (line.gender || defaultGender || resolveKnownGender(turnContext, character) || null);
        const availableProfiles = new Set(getAvailableGenericVoiceProfileKeys(turnContext));
        const explicitGenericVoiceProfile = normalizeGenericVoiceProfileKey(
            line.generic_voice_profile || line.genericVoiceProfile || defaultGenericVoiceProfile
        );
        const validExplicitGenericVoiceProfile = explicitGenericVoiceProfile && availableProfiles.has(explicitGenericVoiceProfile)
            ? explicitGenericVoiceProfile
            : '';
        const genericVoiceProfile = isNarrator
            ? null
            : (validExplicitGenericVoiceProfile || resolveGenericVoiceProfileForCharacter(turnContext, character, gender));

        const cleanedText = cleanTtsText(rawText);
        if (!cleanedText) return null;

        const crcBaseKey = line.crcKey || line.cacheKey || `${character}:${rawText}`;
        const crcKey = genericVoiceProfile ? `${crcBaseKey}|gvp:${genericVoiceProfile}` : crcBaseKey;
        const crc = normalizeCrcValue(line.crc) || calculateCrc(sanitizeForCrc(crcKey));

        return {
            index: Number.isInteger(line.index) ? line.index : index,
            character,
            text: cleanedText,
            originaltext: sanitizeForCrc(rawText),
            crc,
            gender,
            mood: line.mood || defaultMood || null,
            ...(genericVoiceProfile ? { generic_voice_profile: genericVoiceProfile } : {})
        };
    }).filter(Boolean);
}

async function queueExternalTtsLines(turnContext, tools, requestOrLines, maybeOptions = {}) {
    if (!turnContext || turnContext.isFallbackContext) {
        return { success: false, error: 'No active turn context available for queued TTS.' };
    }

    const rawRequest = Array.isArray(requestOrLines)
        ? { lines: requestOrLines, ...(maybeOptions || {}) }
        : { ...((requestOrLines && typeof requestOrLines === 'object') ? requestOrLines : {}), ...(maybeOptions || {}) };

    const rawLines = Array.isArray(rawRequest.lines) ? rawRequest.lines : [];
    if (rawLines.length === 0) {
        return { success: false, error: 'queueTtsLines requires a non-empty lines array.' };
    }

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const storageTurnKey = resolveArchiveTurnKey(turnContext, rawRequest.storageTurnKey || rawRequest.turnKey);
    const ttsPayloadLines = normalizeExternalTtsLines(turnContext, tools, rawLines, rawRequest);

    if (ttsPayloadLines.length === 0) {
        return { success: false, error: 'No valid TTS lines remained after normalization.' };
    }

    const { archiveBase, existingSet } = await resolveArchiveState(turnContext, tools, storageTurnKey);
    const missingTtsLines = rawRequest.force === true
        ? ttsPayloadLines
        : ttsPayloadLines.filter(line => !existingSet.has(`${line.crc}.wav`));

    const files = ttsPayloadLines.map(line => ({
        crc: String(line.crc),
        filename: `${line.crc}.wav`,
        path: archiveBase ? path.join(archiveBase, `${line.crc}.wav`) : null,
        character: line.character,
        text: line.text
    }));

    if (missingTtsLines.length === 0) {
        return {
            success: true,
            status: 'cached',
            requested: 0,
            total_lines: ttsPayloadLines.length,
            cached_lines: ttsPayloadLines.length,
            storage_turn_key: storageTurnKey,
            archive_path: archiveBase,
            files,
            queue: getQueueSnapshot()
        };
    }

    const label = String(rawRequest.label || rawRequest.source || 'External').trim() || 'External';
    const statusPrefix = rawRequest.statusPrefix || `Queued TTS (${label})`;
    const job = startTtsJob(turnContext, tools, settings, ttsPayloadLines, missingTtsLines, {
        updateRuntimeState: false,
        archiveTurnKey: storageTurnKey,
        statusPrefix
    });

    tools.logger.log(
        'Queue',
        `Queued external TTS job ${job?.jobId || 'unknown'} with ${missingTtsLines.length}/${ttsPayloadLines.length} missing line(s).`
    );

    return {
        success: true,
        status: job?.status || 'queued',
        job_id: job?.jobId || null,
        requested: missingTtsLines.length,
        total_lines: ttsPayloadLines.length,
        cached_lines: ttsPayloadLines.length - missingTtsLines.length,
        queue_position: job?.jobId ? getQueuePosition(job.jobId) : null,
        storage_turn_key: storageTurnKey,
        archive_path: archiveBase,
        files,
        queue: getQueueSnapshot()
    };
}

module.exports = {
    id: 'tts_core',
    name: 'TTS Core',
    author: 'Fablekin Core',
    version: '1.2.0',
    category: 'Audio',
    wizard: {
        include: true,
        order: 710,
        group: 'Audio',
        label: 'TTS Core',
        recommended_enabled: false,
        author_note: 'Currently only spark-tts and index-tts are supported and needs the provided python wrapper. With decent voice samples the voices can be extremely realistic and expressive. Help to add other TTS providers by contributing to the plugin.',
        enabled_note: 'Dialogue and narration can be synthesized with character-aware voice selection and caching.',
        disabled_note: 'Scenes remain text-first and avoid voice generation latency or provider cost.',
        settings_note: 'Configure TTS provider, voice selection, narrator behavior, and caching in plugin settings.'
    },
    optionalDependencies: [
        { id: 'character_classifier', reason: 'Improves character-aware voice routing, including which speakers deserve dedicated voice treatment.' }
    ],
    description: 'Central Text-to-Speech integration with real-time monitoring, gender-aware voice selection, and selective regeneration.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'The voice synthesis engine. Converts narrative dialogue into real-time speech with gender-aware voice selection.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Integrates with external TTS APIs to provide synchronous voice generation. It features a CRC-based caching system, ensuring that identical lines are never regenerated twice. It automatically selects voices based on character metadata (gender/importance), supports selective regeneration when only specific parts of a scene are edited, and exposes a FIFO queue so other plugins can prepare extra voice lines after the active VN batch.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'Medium',
            latency: 'Low'
        },
        tts_narrator_activated: {
            type: 'checkbox',
            label: 'Enable Narrator Voice',
            description: 'Toggle voice generation for narrative lines.',
            default: true
        },
        tts_api_endpoint: {
            type: 'text',
            label: 'TTS API Endpoint',
            description: 'The URL of the TTS generation service.',
            default: 'http://127.0.0.1:8000/generate'
        },
        name_max_words: {
            type: 'number',
            label: 'Max Name Words',
            description: 'The maximum number of words a character name can have to be considered valid for voice generation.',
            default: 3,
            min: 1,
            max: 10
        },
        enable_verb_detection: {
            type: 'checkbox',
            label: 'Enable Verb Detection',
            description: 'If enabled, names that look like verbs (ending in -ed, -ing, etc.) will be ignored to prevent narrative text from being treated as characters.',
            default: true
        },
    },
    exports: {
        /**
         * Queue plugin-owned TTS behind the current VN voice job.
         *
         * Usage:
         * await tools.plugins.call('tts_core', 'queueTtsLines', {
         *   label: 'camp_rest',
         *   lines: [{ character: 'Dehya', text: 'Take a breath.', gender: 'female' }]
         * });
         */
        queueTtsLines: async (turnContext, tools, requestOrLines, maybeOptions = {}) => {
            return await queueExternalTtsLines(turnContext, tools, requestOrLines, maybeOptions);
        },
        getQueueState: async () => {
            return getQueueSnapshot();
        }
    },
    hooks: {
        // Backend: Register callback and control routes once at system boot
        'HOOK_SYSTEM_BOOT': {
            priority: 10,
            run: async (context, tools) => {
                tools.network.registerRoute('POST', '/callback', async (req, res, routeTools) => {
                    const ttsData = req.body || {};

                    if (!ttsData || typeof ttsData !== 'object') {
                        return res.status(400).send('Missing payload');
                    }

                    const callbackJobId = typeof ttsData.job_id === 'string' ? ttsData.job_id : null;
                    const job = resolveJobFromCallback(ttsData);

                    // If server is job-aware but the job is stale/unknown, ignore safely.
                    if (callbackJobId && !job) {
                        routeTools.logger.log('Callback', `Ignoring callback for unknown/stale job '${callbackJobId}'.`);
                        return res.status(200).send('IGNORED');
                    }

                    if (job && typeof ttsData.context_hash === 'string' && ttsData.context_hash !== job.contextHash) {
                        routeTools.logger.warn(
                            'Callback',
                            `Ignoring callback for job '${job.jobId}' due to context hash mismatch.`
                        );
                        return res.status(200).send('IGNORED');
                    }

                    if (!job) {
                        routeTools.logger.warn('Callback', 'Received callback without a recognized job_id. Ignoring.');
                        return res.status(200).send('IGNORED');
                    }
                    const turnContext = job.turnContext;
                    if (!turnContext) {
                        routeTools.logger.warn('Callback', 'Received callback without an active TurnContext. Ignoring.');
                        return res.status(200).send('IGNORED');
                    }
                    if (!turnContext.runtime || typeof turnContext.runtime !== 'object') {
                        turnContext.runtime = {};
                    }

                    // Isolated failure tracking per job to avoid bleeding across turns.
                    if (!turnContext.runtime._ttsFailedCrcs) {
                        turnContext.runtime._ttsFailedCrcs = new Set();
                    }
                    if (job && !job.failedCrcs) {
                        job.failedCrcs = new Set();
                    }

                    const failedSet = job?.failedCrcs || turnContext.runtime._ttsFailedCrcs;

                    const isError = ttsData.error === true;
                    if (isError && ttsData.last_file) {
                        const failedCrc = String(ttsData.last_file).split('.')[0];
                        failedSet.add(failedCrc);
                    }

                    const statusKind = String(ttsData.status || '').toLowerCase();
                    const isCancelled = statusKind === 'cancelled' || statusKind === 'aborted' || ttsData.cancelled === true;

                    // 1. Report Progress via centralized status system
                    const serverPercent = Math.round(ttsData.percent || 0);
                    const completed = ttsData.completed || 0;
                    const total = ttsData.total || 0;
                    const eta = ttsData.eta_seconds ? `${Math.round(ttsData.eta_seconds)}s` : '--s';

                    const failedCount = failedSet.size || 0;
                    const voicedCompleted = Math.max(0, completed - failedCount);
                    const voicedTotal = Math.max(0, total - failedCount);
                    const voicedPercent = voicedTotal > 0 ? Math.round((voicedCompleted / voicedTotal) * 100) : 100;

                    const isRegen = job?.isRegenerating || turnContext?.runtime?.isRegenerating;
                    const prefix = job?.statusPrefix || (isRegen ? 'TTS Regeneration' : 'TTS');

                    const statusMessage = isCancelled
                        ? `${prefix}: Cancelled`
                        : serverPercent < 100
                            ? `${prefix}: ${voicedCompleted}/${voicedTotal} voices (${voicedPercent}%) ${eta}`
                            : `${prefix}: Complete! (${voicedTotal} voiced)`;

                    routeTools.status.update(statusMessage, {
                        progress: serverPercent,
                        color: isCancelled ? '#ff9800' : '#00f2ff',
                        timeout: (serverPercent >= 100 || isCancelled) ? 2500 : null
                    });

                    // 2. Archive if complete or if an individual file is ready
                    if (turnContext && !turnContext.isFallbackContext) {
                        const ttsLines = job?.ttsLines || turnContext.runtime?.ttsLines;
                        if (ttsLines && ttsLines.length > 0) {
                            const archiveOptions = {
                                storageTurnKey: job?.archiveTurnKey || null,
                                settings: job?.settings || null
                            };

                            // Streaming: archive the completed file when non-error
                            if (ttsData.last_file && !isError) {
                                const crc = String(ttsData.last_file).split('.')[0];
                                const line = ttsLines.find(l => String(l.crc) === crc);
                                if (line) {
                                    await archiveAudio(turnContext, routeTools, [line], archiveOptions);
                                }
                            }

                            if (serverPercent >= 100 && !isCancelled) {
                                const validLines = ttsLines.filter(l => !failedSet.has(String(l.crc)));
                                await archiveAudio(turnContext, routeTools, validLines, archiveOptions);
                            }
                        } else if (serverPercent >= 100 && !isCancelled) {
                            routeTools.logger.warn('Callback', 'TTS complete but no ttsLines found in runtime context.');
                        }
                    } else if (serverPercent >= 100 && !isCancelled) {
                        routeTools.logger.error('Callback', 'TTS complete but TurnContext is missing/fallback. Archival skipped.');
                    }

                    if (job && (serverPercent >= 100 || isCancelled)) {
                        job.status = isCancelled ? 'cancelled' : 'complete';
                        await finishTtsJob(job, routeTools);
                    }

                    res.status(200).send('OK');
                });

                tools.network.registerRoute('POST', '/cancel-all', async (req, res, routeTools) => {
                    const settings = { ...routeTools.settings.get(), ...routeTools.settings.getSelf() };
                    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual_cancel';
                    const cancelled = await cancelAllJobs(settings, routeTools, reason);
                    routeTools.logger.log('Cancellation', `Cancelled ${cancelled} active TTS job(s). Reason: ${reason}`);
                    res.status(200).send({ success: true, cancelled });
                });

                tools.network.registerRoute('POST', '/missing-current-turn', async (req, res, routeTools) => {
                    const settings = { ...routeTools.settings.get(), ...routeTools.settings.getSelf() };
                    const turnContext = routeTools.turnContext;
                    if (!turnContext || turnContext.isFallbackContext) {
                        return res.status(409).send({ success: false, error: 'No active turn context available.' });
                    }

                    try {
                        const requestedCrcSet = parseRequestedCrcSet(req.body?.crcs);
                        const includeCrcs = req.body?.include_crcs === true;
                        const {
                            reason,
                            ttsPayloadLines,
                            candidateLines,
                            missingTtsLines
                        } = await resolveMissingTtsLines(turnContext, settings, routeTools, requestedCrcSet);

                        return res.status(200).send({
                            success: true,
                            reason,
                            total_tts_lines: ttsPayloadLines.length,
                            candidate_lines: candidateLines.length,
                            missing_count: missingTtsLines.length,
                            crcs: includeCrcs ? missingTtsLines.map(line => String(line.crc)) : undefined
                        });
                    } catch (error) {
                        routeTools.logger.error('Generation', `Missing-line scan failed: ${error.message}`);
                        return res.status(500).send({ success: false, error: 'Failed to scan missing TTS lines.' });
                    }
                });

                tools.network.registerRoute('POST', '/regenerate-missing-current-turn', async (req, res, routeTools) => {
                    const settings = { ...routeTools.settings.get(), ...routeTools.settings.getSelf() };
                    const turnContext = routeTools.turnContext;

                    if (!turnContext || turnContext.isFallbackContext) {
                        return res.status(409).send({ success: false, error: 'No active turn context for regeneration.' });
                    }

                    try {
                        const requestedCrcSet = parseRequestedCrcSet(req.body?.crcs);
                        const {
                            reason,
                            ttsPayloadLines,
                            missingTtsLines
                        } = await resolveMissingTtsLines(turnContext, settings, routeTools, requestedCrcSet);

                        if (missingTtsLines.length === 0) {
                            return res.status(200).send({ success: true, requested: 0, reason, job_id: null });
                        }

                        await cancelAllJobs(settings, routeTools, 'manual_regeneration');
                        routeTools.status.update(
                            `TTS Regeneration: Generating ${missingTtsLines.length} missing voices...`,
                            { progress: 0, color: '#00f2ff' }
                        );

                        const job = startTtsJob(turnContext, routeTools, settings, ttsPayloadLines, missingTtsLines, { isRegenerating: true });
                        routeTools.logger.log(
                            'Generation',
                            `Manual regeneration queued ${missingTtsLines.length} line(s). job_id=${job?.jobId || 'unknown'}`
                        );

                        // Detect immediate dispatch failures (e.g., connection refused) so
                        // the UI gets a deterministic error instead of a false-positive success.
                        await new Promise(resolve => setTimeout(resolve, 250));
                        const isStillActive = job?.jobId ? ACTIVE_TTS_JOBS.has(job.jobId) : false;
                        if (job && !isStillActive && job.status === 'cancelled') {
                            return res.status(502).send({
                                success: false,
                                error: 'TTS dispatch failed immediately. Check tts_api_endpoint and TTS server status.',
                                job_id: job.jobId
                            });
                        }

                        return res.status(200).send({
                            success: true,
                            requested: missingTtsLines.length,
                            reason: 'ok',
                            job_id: job?.jobId || null
                        });
                    } catch (error) {
                        routeTools.logger.error('Generation', `Regeneration failed: ${error.message}`);
                        return res.status(500).send({ success: false, error: 'Failed to trigger TTS regeneration.' });
                    }
                });
            }
        },

        // Cancel old jobs as soon as chat context changes.
        'HOOK_CHAT_DB_INITIALIZED': {
            priority: 15,
            run: async (context, tools) => {
                const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
                await cancelAllJobs(settings, tools, 'chat_db_initialized');
            }
        },

        // Hook to discover available voice moods before emotion classification
        'HOOK_POST_DIALOGUE_PROCESSING': {
            priority: 5,
            allowInterlude: true,
            run: async (turnContext, tools) => {
                const catalog = await discoverVoiceCatalog(turnContext, tools);
                if (!turnContext.runtime || typeof turnContext.runtime !== 'object') {
                    turnContext.runtime = {};
                }
                if (!turnContext.runtime.ttsCore || typeof turnContext.runtime.ttsCore !== 'object') {
                    turnContext.runtime.ttsCore = {};
                }
                turnContext.runtime.ttsCore.voiceCatalog = {
                    ...catalog,
                    updatedAt: new Date().toISOString()
                };
                turnContext.runtime.ttsVoiceMoodCatalog = {
                    sourceDir: catalog.sourceDir,
                    globalMoods: catalog.globalMoods,
                    byCharacter: catalog.byCharacter,
                    updatedAt: new Date().toISOString()
                };

                if (Array.isArray(catalog.globalMoods) && catalog.globalMoods.length > 0) {
                    tools.logger.log(
                        'Lifecycle',
                        `Discovered ${catalog.globalMoods.length} TTS mood(s) from voices (${catalog.sourceDir || 'none'}).`
                    );
                }
            }
        },

        // Backend: Trigger TTS generation with selective reactive logic
        'HOOK_VN_DIALOGUE_READY': {
            priority: 10,
            mode: 'background',
            allowInterlude: true,
            run: async (turnContext, tools) => {
                const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };

                try {
                    tools.logger.log('Generation', `HOOK_VN_DIALOGUE_READY fired for turn ${turnContext.turnNumber}.`);
                    tools.logger.log('Generation', 'Starting selective TTS generation...', 'start');

                    // New turn context is active: previous queue is now obsolete.
                    await cancelAllJobs(settings, tools, 'new_turn_started');
                    await ensureGenericVoiceProfilesHydrated(turnContext, tools);

                    const ttsPayloadLines = getTtsPayloadLines(turnContext, settings, tools);

                    if (ttsPayloadLines.length === 0) {
                        tools.logger.log('Generation', 'No dialogue lines found for TTS generation. Is Narrator enabled? ' + settings.tts_narrator_activated, 'end');
                        return;
                    }

                    tools.logger.log('Generation', `Payload generated: ${ttsPayloadLines.length} lines.`);

                    const storage = tools.project.getChatPluginStorage();
                    const archiveBase = storage.absolutePath;

                    // 1. Reactive Cleanup: Scan and delete orphaned files
                    let existingFiles = [];
                    try {
                        existingFiles = await fs.readdir(archiveBase);
                    } catch {
                        // Directory might not exist for new turns
                    }

                    const currentCrcs = new Set(ttsPayloadLines.map(l => `${l.crc}.wav`));
                    for (const file of existingFiles) {
                        if (file.endsWith('.wav') && !currentCrcs.has(file)) {
                            await fs.unlink(path.join(archiveBase, file)).catch(err =>
                                tools.logger.error('Generation', `Failed to delete ${file}: ${err.message}`)
                            );
                        }
                    }

                    // 2. Selective Generation: only request missing hashes
                    const missingTtsLines = ttsPayloadLines.filter(l => !existingFiles.includes(`${l.crc}.wav`));

                    if (missingTtsLines.length === 0) {
                        tools.logger.log('Generation', 'All lines are already cached. Skipping TTS request.', 'end');
                        return;
                    }

                    tools.logger.log('Generation', `Requesting TTS for ${missingTtsLines.length} missing lines.`);
                    tools.status.update(`TTS: Generating ${missingTtsLines.length} missing voices...`, { progress: 0, color: '#00f2ff' });

                    startTtsJob(turnContext, tools, settings, ttsPayloadLines, missingTtsLines, { isRegenerating: false });

                } catch (e) {
                    tools.logger.error('Lifecycle', 'Fatal error in TTS selective generation: ' + e.message);
                }
            }
        },
    }
};

/**
 * Common logic to extract and format lines for TTS from a turn context.
 */
function getTtsPayloadLines(turnContext, settings, tools) {
    const { sanitizeForCrc, calculateCrc, cleanTtsText } = tools.utils;
    const processedLines = turnContext.processed.vnManager.processedLines;
    const playerCharacterName = turnContext.input.playerCharacterName?.toLowerCase() || null;
    const ttsNarratorActivated = settings.tts_narrator_activated;

    if (!Array.isArray(processedLines) || processedLines.length === 0) return [];

    const ttsPayloadLines = [];

    processedLines.forEach((line, index) => {
        const char = line.character || 'Narrator';
        const isNarrative = line.type === 'narrative' || char === 'Narrator';

        if (!isNarrative && line.type === 'dialogue') {
            const rawText = line.text || line.line || '';

            if (playerCharacterName && char.toLowerCase() === playerCharacterName) {
                return; // Skip player
            }

            if (isValidCharacterName(char, settings)) {
                const cleanedText = cleanTtsText(rawText);
                if (cleanedText) {
                    const characterName = char.toLowerCase();
                    const registeredGender = resolveKnownGender(turnContext, characterName);
                    const resolvedGender = line.gender || registeredGender || null;
                    const genericVoiceProfile = resolveGenericVoiceProfileForCharacter(turnContext, char, resolvedGender);
                    const crcKey = `${char}:${rawText}`;
                    const crcSeed = genericVoiceProfile ? `${crcKey}|gvp:${genericVoiceProfile}` : crcKey;
                    const crc = calculateCrc(sanitizeForCrc(crcSeed));
                    line.crc = crc;

                    ttsPayloadLines.push({
                        index: index,
                        character: char,
                        text: cleanedText,
                        originaltext: sanitizeForCrc(rawText),
                        crc: crc,
                        gender: resolvedGender,
                        mood: line.mood || null,
                        ...(genericVoiceProfile ? { generic_voice_profile: genericVoiceProfile } : {})
                    });
                }
            }
        } else if (isNarrative && ttsNarratorActivated) {
            const rawText = line.line || line.text || '';
            const cleanedText = cleanTtsText(rawText);
            if (cleanedText) {
                const crcKey = `Narrator:${rawText}`;
                const crc = calculateCrc(sanitizeForCrc(crcKey));
                line.crc = crc;
                ttsPayloadLines.push({
                    index: index,
                    character: 'Narrator',
                    text: cleanedText,
                    originaltext: sanitizeForCrc(rawText),
                    crc: crc,
                    gender: 'narrator'
                });
            }
        }
    });

    return ttsPayloadLines;
}

/**
 * Triggers the actual HTTP request to the TTS API.
 */
function triggerTtsGeneration(ttsPayloadLines, settings, tools, job) {
    const ttsApiEndpoint = settings.tts_api_endpoint;
    const rootDirectory = job?.turnContext?.rootDirectory || tools.turnContext?.rootDirectory;
    const projectVoicesPath = rootDirectory
        ? path.join(rootDirectory, 'assets', 'voices')
        : null;

    const payload = {
        lines: ttsPayloadLines,
        project_voices_path: projectVoicesPath,
        callback_url: `http://127.0.0.1:${settings.infrastructure?.socket_port || 14541}/plugins/tts_core/callback`,
        job_id: job.jobId,
        context_hash: job.contextHash,
        lease_ttl_seconds: DEFAULT_LEASE_TTL_SECONDS
    };

    tools.logger.log('Network', `Dispatching TTS job ${job.jobId} with ${ttsPayloadLines.length} lines.`);

    // Fire-and-forget by design: do not await /generate completion.
    axios.post(ttsApiEndpoint, payload).catch(async (error) => {
        tools.logger.error('Network', `Background TTS request failed for ${job.jobId}: ${error.message}`);
        tools.status.update(`${job.statusPrefix || 'TTS'} generation failed.`, { color: '#ff4444', timeout: 5000 });
        await cancelJob(job.jobId, settings, tools, 'dispatch_failed');
    });
}

async function archiveAudio(turnContext, tools, ttsLines, options = {}) {
    const storageTurnKey = resolveArchiveTurnKey(turnContext, options.storageTurnKey);
    let archiveBase = null;

    try {
        if (typeof tools?.project?.getChatPluginStorageFromContext === 'function') {
            archiveBase = tools.project.getChatPluginStorageFromContext(turnContext, storageTurnKey).absolutePath;
        } else if (typeof tools?.project?.getChatPluginStorage === 'function') {
            archiveBase = tools.project.getChatPluginStorage(storageTurnKey).absolutePath;
        }
    } catch (storageError) {
        tools.logger.warn('Archive', `Storage toolkit path resolution failed: ${storageError.message}`);
    }

    if (!archiveBase) throw new Error('TTS archival requires the current project storage toolkit.');

    // Determine the base URL for audio from the TTS API endpoint
    const settings = options.settings || { ...tools.settings.get(), ...tools.settings.getSelf() };
    let baseUrl = DEFAULT_TTS_BASE_URL;
    try {
        if (settings.tts_api_endpoint) {
            const urlObj = new URL(settings.tts_api_endpoint);
            baseUrl = urlObj.origin;
        }
    } catch {
        tools.logger.warn('Archive', 'Invalid tts_api_endpoint in settings, using fallback base URL.');
    }

    tools.logger.log('Archive', `Starting audio archival for chapter/interlude ${storageTurnKey}... Path: ${archiveBase}`, 'start');

    try {
        await fs.mkdir(archiveBase, { recursive: true });

        const downloadPromises = ttsLines.map(async (line) => {
            const crc = line.crc;
            const dest = path.join(archiveBase, `${crc}.wav`);

            // Skip if already archived
            try {
                await fs.access(dest);
                return;
            } catch {
                // Not found; continue.
            }

            const url = `${baseUrl}/audio/${crc}.wav`;
            let success = false;
            let retries = 0;
            const maxRetries = 2;

            while (!success && retries <= maxRetries) {
                try {
                    const response = await axios.get(url, { responseType: 'arraybuffer' });
                    await fs.writeFile(dest, Buffer.from(response.data));
                    success = true;
                } catch {
                    retries++;
                    if (retries <= maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
            }
        });

        await Promise.all(downloadPromises);
        tools.logger.log('Archive', `Audio archival complete for chapter/interlude ${storageTurnKey}.`, 'end');
    } catch (err) {
        tools.logger.error('Archive', `Fatal error during archival: ${err.message}`);
    }
}

function isValidCharacterName(character, settings = {}) {
    if (!character || typeof character !== 'string') return false;
    const wordCount = character.split(/\s+/).length;
    const maxWords = settings.name_max_words || 3;
    const enableVerbDetection = settings.enable_verb_detection !== false;

    if (wordCount > maxWords) return false;

    if (enableVerbDetection) {
        // Exclude possessive "'s" from this check to avoid rejecting valid names.
        const hasVerb = /(ed\b|ing\b)/i.test(character);
        if (hasVerb) return false;
    }

    return true;
}

module.exports._test = {
    extractGenericVoiceProfileKey,
    buildVoiceCatalogFromFilenames,
    resolveGenericVoiceProfileForCharacter
};
