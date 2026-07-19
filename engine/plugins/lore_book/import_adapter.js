'use strict';

const SUPPORTED_SELECTIVE_LOGIC = new Set([0, 1, 2, 3]);

const KNOWN_ENTRY_FIELDS = new Set([
    'id', 'uid', 'name', 'comment', 'content',
    'key', 'keys', 'keywords', 'keysecondary', 'secondary_keys', 'secondary_keywords',
    'priority', 'order', 'insertion_order', 'enabled', 'disable', 'constant',
    'category', 'case_sensitive', 'caseSensitive', 'use_regex',
    'match_whole_word', 'matchWholeWords', 'scan_depth', 'scanDepth',
    'selective', 'selectiveLogic', 'position', 'depth', 'role', 'outletName',
    'probability', 'useProbability', 'excludeRecursion', 'preventRecursion',
    'delayUntilRecursion', 'ignoreBudget', 'vectorized', 'group', 'groupOverride',
    'groupWeight', 'useGroupScoring', 'automationId', 'sticky', 'cooldown', 'delay',
    'triggers', 'characterFilter', 'matchPersonaDescription', 'matchCharacterDescription',
    'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario',
    'matchCreatorNotes', 'addMemo', 'displayIndex', 'extensions',
    'source_format', 'source_uid', 'source_payload', 'import_warnings',
    'include_name_in_prompt', 'selective_logic', 'exclude_recursion',
    'prevent_recursion', 'delay_until_recursion', 'ignore_budget',
    'use_probability', 'scan_depth_unit', 'created_at', 'updated_at', 'hit_count'
]);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined || value === false || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (isObject(value)) return Object.keys(value).length > 0;
    if (typeof value === 'number') return value !== 0;
    return true;
}

function hasActiveCharacterFilter(value) {
    if (!isObject(value)) return false;
    return toStringArray(value.names).length > 0 || toStringArray(value.tags).length > 0;
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return toStringArray(parsed);
        } catch { }
        return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }

    return [];
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function createWarningCollector() {
    const warnings = new Map();

    return {
        add(code, message, entryLabel, severity = 'warning', count = 1) {
            if (!warnings.has(code)) {
                warnings.set(code, { code, message, severity, count: 0, examples: [] });
            }
            const warning = warnings.get(code);
            warning.count += count;
            if (entryLabel && warning.examples.length < 5 && !warning.examples.includes(entryLabel)) {
                warning.examples.push(entryLabel);
            }
        },
        list() {
            return [...warnings.values()];
        }
    };
}

function detectBook(input) {
    if (!isObject(input)) throw new Error('Lorebook JSON must contain an object at the top level.');

    if (isObject(input.data) && isObject(input.data.character_book)) {
        return { book: input.data.character_book, format: 'character_card_v2', container: input };
    }
    if (isObject(input.character_book)) {
        return { book: input.character_book, format: 'character_book_v2', container: input };
    }
    if (input.entries !== undefined) {
        const entries = input.entries;
        const first = Array.isArray(entries)
            ? entries.find(isObject)
            : (isObject(entries) ? Object.values(entries).find(isObject) : null);
        const looksLikeSillyTavern = !Array.isArray(entries) || !!(
            first && (
                first.uid !== undefined || first.key !== undefined || first.keys !== undefined ||
                first.keysecondary !== undefined || first.insertion_order !== undefined ||
                first.disable !== undefined
            )
        );
        return {
            book: input,
            format: looksLikeSillyTavern ? 'sillytavern_world_info' : 'fablekin',
            container: input
        };
    }

    throw new Error('No lorebook entries were found. Expected entries, character_book, or data.character_book.');
}

function getEntryRecords(rawEntries) {
    if (Array.isArray(rawEntries)) {
        return rawEntries.map((entry, index) => ({ sourceKey: String(index), entry }));
    }
    if (isObject(rawEntries)) {
        return Object.entries(rawEntries).map(([sourceKey, entry]) => ({ sourceKey, entry }));
    }
    throw new Error('Lorebook entries must be an array or a UID-keyed object.');
}

function getBookMetadata(book) {
    const metadata = {};
    for (const [key, value] of Object.entries(book)) {
        if (key === 'entries') continue;
        metadata[key] = value;
    }
    return metadata;
}

function normalizeImport(input) {
    const detected = detectBook(input);
    const { book, format } = detected;
    const records = getEntryRecords(book.entries);
    const warningCollector = createWarningCollector();
    const normalizedEntries = [];
    const skipped = [];
    const externalFormat = format !== 'fablekin';
    const bookName = String(firstDefined(book.name, detected.container?.data?.name, detected.container?.name, 'Imported Lorebook'));
    const category = `Imported · ${bookName}`;
    const sourceBookScanDepth = firstDefined(book.scan_depth, book.scanDepth);
    const normalizedBookScanDepth = sourceBookScanDepth === undefined || sourceBookScanDepth === null
        ? null
        : Math.max(0, toInt(sourceBookScanDepth, 0));
    const bookRecursionEnabled = book.recursive_scanning !== false;
    const recommendedSettings = {};
    const positionCounts = new Map();

    if (!externalFormat && isObject(book.settings)) {
        Object.assign(recommendedSettings, book.settings);
    }

    if (externalFormat && sourceBookScanDepth !== undefined && sourceBookScanDepth !== null) {
        recommendedSettings.default_scan_depth = normalizedBookScanDepth;
        recommendedSettings.scan_depth_unit = 'messages';
        warningCollector.add(
            'message_scan_depth_preserved',
            `Source scan depth ${sourceBookScanDepth} will be scanned as ${normalizedBookScanDepth} chronological message units.`,
            null,
            'info'
        );
    }
    if (externalFormat && book.token_budget !== undefined && book.token_budget !== null) {
        recommendedSettings.token_budget = Math.max(0, toInt(book.token_budget, 0));
        warningCollector.add(
            'source_token_budget_available',
            `Source token budget ${book.token_budget} can be applied as this lorebook's own budget beneath Fablekin's global safety cap.`,
            null,
            'info'
        );
    }
    if (externalFormat && book.recursive_scanning !== undefined) {
        recommendedSettings.recursive_scanning = bookRecursionEnabled;
    }

    for (const record of records) {
        const raw = record.entry;
        const fallbackLabel = `Entry ${record.sourceKey}`;
        if (!isObject(raw)) {
            skipped.push({ sourceKey: record.sourceKey, reason: 'Entry is not an object.' });
            warningCollector.add('invalid_entry_skipped', 'Some entries were not objects and were skipped.', fallbackLabel);
            continue;
        }

        const primaryKeywords = toStringArray(firstDefined(raw.keywords, raw.key, raw.keys));
        const secondaryKeywords = toStringArray(firstDefined(raw.secondary_keywords, raw.keysecondary, raw.secondary_keys));
        const sourceUid = String(firstDefined(raw.uid, raw.id, record.sourceKey));
        const entryLabel = String(firstDefined(raw.name, raw.comment, primaryKeywords[0], `Entry ${sourceUid}`));
        const content = typeof raw.content === 'string'
            ? raw.content
            : (raw.content === undefined || raw.content === null ? '' : String(raw.content));

        if (!content.trim()) {
            skipped.push({ sourceKey: sourceUid, reason: 'Entry content is empty.' });
            warningCollector.add('empty_content_skipped', 'Entries with empty content were skipped.', entryLabel);
            continue;
        }

        const entryWarnings = [];
        const warnEntry = (code, message, severity = 'warning') => {
            entryWarnings.push(message);
            warningCollector.add(code, message, entryLabel, severity);
        };

        const sourcePriority = externalFormat
            ? firstDefined(raw.order, raw.insertion_order, raw.priority, 50)
            : firstDefined(raw.priority, raw.order, raw.insertion_order, 50);
        const unboundedPriority = toInt(sourcePriority, 50);
        const priority = Math.max(0, Math.min(100, unboundedPriority));
        if (priority !== unboundedPriority) {
            warnEntry('priority_clamped', 'Priorities outside Fablekin’s 0–100 range were clamped.');
        }

        const selective = raw.selective === undefined ? secondaryKeywords.length > 0 : !!raw.selective;
        let selectiveLogic = toInt(firstDefined(raw.selective_logic, raw.selectiveLogic, 0), 0);
        if (!SUPPORTED_SELECTIVE_LOGIC.has(selectiveLogic)) {
            warnEntry('selective_logic_unknown', `Unknown selective logic ${selectiveLogic} was replaced with AND ANY.`);
            selectiveLogic = 0;
        }

        let enabled = externalFormat
            ? raw.enabled !== false && raw.disable !== true
            : raw.enabled !== false;

        const sourcePosition = firstDefined(raw.position, externalFormat ? 0 : 'after_system');
        if (externalFormat) {
            const positionKey = String(sourcePosition);
            positionCounts.set(positionKey, (positionCounts.get(positionKey) || 0) + 1);
            entryWarnings.push(`Source prompt position ${sourcePosition} was mapped to Shared Dynamic Knowledge.`);
        }

        const unsupportedBroadeningRules = [];
        if (hasMeaningfulValue(raw.group)) unsupportedBroadeningRules.push('inclusion group');
        if (hasActiveCharacterFilter(raw.characterFilter)) unsupportedBroadeningRules.push('character filter');
        if (hasMeaningfulValue(raw.triggers)) unsupportedBroadeningRules.push('generation triggers');
        if (hasMeaningfulValue(raw.sticky) || hasMeaningfulValue(raw.cooldown) || hasMeaningfulValue(raw.delay)) {
            unsupportedBroadeningRules.push('timed effects');
        }
        if (Number(sourcePosition) === 7 || hasMeaningfulValue(raw.outletName)) {
            unsupportedBroadeningRules.push('named outlet');
        }

        if (unsupportedBroadeningRules.length > 0) {
            enabled = false;
            warnEntry(
                'unsafe_rules_disabled',
                `Entries using unsupported ${unsupportedBroadeningRules.join(', ')} rules were imported disabled for review.`
            );
        }

        if (raw.vectorized === true) {
            warnEntry('vector_matching_unknown', 'Vector matching is not available in this Lore Book plugin; keyword matching was retained.', 'approximation');
            if (primaryKeywords.length === 0 && !raw.constant) enabled = false;
        }

        const ignoredMatchingSources = [
            raw.matchPersonaDescription,
            raw.matchCharacterDescription,
            raw.matchCharacterPersonality,
            raw.matchCharacterDepthPrompt,
            raw.matchScenario,
            raw.matchCreatorNotes
        ].some(Boolean);
        if (ignoredMatchingSources) {
            warnEntry('additional_sources_unknown', 'Additional SillyTavern matching sources were preserved but are not scanned by Fablekin.', 'approximation');
        }
        if (hasMeaningfulValue(raw.automationId)) {
            warnEntry('automation_unknown', 'SillyTavern automation IDs were preserved but are not executed by Fablekin.');
        }

        const unknownFields = Object.keys(raw).filter((field) => !KNOWN_ENTRY_FIELDS.has(field));
        if (unknownFields.length > 0) {
            warnEntry('unknown_entry_fields', `Unknown entry fields were preserved but not applied: ${unknownFields.join(', ')}.`);
        }

        if (primaryKeywords.length === 0 && !raw.constant) {
            enabled = false;
            warnEntry('keyless_entry_disabled', 'A non-constant entry without primary keys was imported disabled.');
        }

        const entryScanDepth = firstDefined(raw.scan_depth, raw.scanDepth);
        const normalizedEntryScanDepth = entryScanDepth === undefined || entryScanDepth === null
            ? null
            : Math.max(0, toInt(entryScanDepth, 0));

        normalizedEntries.push({
            name: entryLabel,
            keywords: primaryKeywords,
            secondary_keywords: selective ? secondaryKeywords : [],
            content,
            priority,
            enabled,
            constant: !!raw.constant,
            position: externalFormat ? 'shared_dynamic' : String(sourcePosition),
            category: externalFormat ? category : String(raw.category || 'General'),
            case_sensitive: !!firstDefined(raw.case_sensitive, raw.caseSensitive, false),
            use_regex: externalFormat ? false : !!raw.use_regex,
            match_whole_word: !!firstDefined(raw.match_whole_word, raw.matchWholeWords, false),
            scan_depth: normalizedEntryScanDepth,
            scan_depth_unit: externalFormat ? 'messages' : String(raw.scan_depth_unit || 'chapters'),
            comment: typeof raw.comment === 'string' ? raw.comment : '',
            selective,
            selective_logic: selectiveLogic,
            probability: Math.max(0, Math.min(100, toInt(firstDefined(raw.probability, 100), 100))),
            use_probability: !!firstDefined(raw.use_probability, raw.useProbability, externalFormat),
            exclude_recursion: !!firstDefined(raw.exclude_recursion, raw.excludeRecursion, false),
            prevent_recursion: !!firstDefined(raw.prevent_recursion, raw.preventRecursion, false),
            delay_until_recursion: (() => {
                const value = firstDefined(raw.delay_until_recursion, raw.delayUntilRecursion, 0);
                return value === true ? 1 : Math.max(0, toInt(value, 0));
            })(),
            ignore_budget: !!firstDefined(raw.ignore_budget, raw.ignoreBudget, false),
            include_name_in_prompt: externalFormat ? false : raw.include_name_in_prompt !== false,
            source_format: format,
            source_uid: sourceUid,
            source_payload: JSON.stringify(raw),
            import_warnings: entryWarnings
        });
    }

    for (const [sourcePosition, count] of positionCounts) {
        const subject = count === normalizedEntries.length
            ? `All ${count} imported entries use SillyTavern position ${sourcePosition}`
            : `${count} imported entries use SillyTavern position ${sourcePosition}`;
        warningCollector.add(
            `position_${sourcePosition}_mapped`,
            `${subject}. They will be injected into Fablekin's Shared Dynamic Knowledge section.`,
            null,
            'info',
            count
        );
    }

    const warnings = warningCollector.list();
    const disabledEntries = normalizedEntries.filter((entry) => !entry.enabled).length;
    const bookMetadata = getBookMetadata(book);

    return {
        entries: normalizedEntries,
        bookMetadata,
        report: {
            format,
            bookName,
            sourceEntries: records.length,
            importedEntries: normalizedEntries.length,
            skippedEntries: skipped.length,
            disabledEntries,
            warningCount: warnings.reduce((sum, warning) => sum + warning.count, 0),
            warnings,
            skipped,
            recommendedSettings
        }
    };
}

function analyzeImport(input) {
    return normalizeImport(input).report;
}

module.exports = {
    analyzeImport,
    normalizeImport
};
