/**
 * Character Sheets - Discovery & Evolution Library
 * Handles all LLM-heavy tasks: Name scraping, Batch Forging, and Evolution.
 */
const path = require('path');
const fs = require('fs/promises');
const identity = require('./identity.js');
const parser = require('./parser.js');
const storage = require('./storage.js');
const schemaAdapter = require('./schema_adapter.js');
const sanitizer = require('./sanitizer.js');

async function extractMentionedNames(tools, sheets) {
    if (!sheets || sheets.length === 0) return [];
    let relationshipBlocks = "";
    for (const sheet of sheets) {
        if (sheet.capsule && sheet.capsule.social_connections) {
            relationshipBlocks += `--- ${sheet.name} ---\n${sheet.capsule.social_connections}\n\n`;
        }
    }
    if (!relationshipBlocks.trim()) return [];

    const promptPath = path.join(__dirname, '../prompts/name_scraper_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const playerCharacterName = tools.settings.get().player_character_name || 'Player';
    const sanitizedBlocks = relationshipBlocks.replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);
    const prompt = promptTemplate.replace('${relationshipBlocks}', sanitizedBlocks);

    tools.logger.log('Character Sheets', 'Scraping character names from social connections...');
    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const lowModel = settings.lowendmodel || { model: 'lowendmodel' };

    try {
        const response = await tools.llm.json({
            msg: 'Character Name Scraper',
            requestId: 'character_name_scraper',
            prompt,
            model: lowModel.model,
            provider: lowModel.provider,
            callingModule: 'Plugin:character_sheets:name_scraper'
        });
        let names = [];
        if (Array.isArray(response.content)) names = response.content;
        else if (response.content && response.content.names) names = response.content.names;
        return Array.from(new Set(names.map(n => n.trim()))).filter(n => n.length > 1);
    } catch {
        return [];
    }
}

async function proactiveBatchGeneration(turnContext, tools, names, sheets, canon) {
    if (!names || names.length === 0) return [];

    const coreSheetContext = sheets.map(s => `### CORE CHARACTER: ${s.name}\n${s.sheet}`).join('\n\n');
    const playerCharacterName = tools.settings.get().player_character_name || 'Player';
    const sanitizedContext = coreSheetContext.replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);

    const promptPath = path.join(__dirname, '../prompts/proactive_forge_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const detailInstruction = parser.getDetailInstruction(settings.capsule_detail_level);

    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, settings.capsule_detail_level || 'Medium');

    const prompt = promptTemplate
        .replace('${canon}', canon)
        .replace('${coreSheetContext}', sanitizedContext)
        .replace('${names.join(\', \')}', names.join(', '))
        .replace('${detailInstruction}', detailInstruction)
        .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields))
        .replace('{{DYNAMIC_JSON_STRUCT}}', schemaAdapter.generateJsonStructure(fields));

    tools.logger.log('Character Sheets', `Proactively forging ${names.length} support characters: ${names.join(', ')}...`);
    const rawModelDef = settings.model_def || { model: 'highendmodel' };
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef;

    try {
        const response = await tools.llm.json({
            msg: 'Proactive Batch Forge',
            requestId: 'proactive_batch_forge',
            prompt,
            model: modelDef.model,
            provider: modelDef.provider,
            callingModule: 'Plugin:character_sheets:batch_forge'
        });
        const rawResults = response.content?.characters || [];
        const cleanResults = sanitizer.sanitizeBatch(rawResults);

        // Filter out any core/player characters that might have been hallucinated
        const coreNames = new Set(sheets.map(s => s.name.toLowerCase()));
        if (playerCharacterName) coreNames.add(playerCharacterName.toLowerCase());

        const filteredResults = cleanResults.filter(c => {
            if (!c.name) return false;
            const isCore = coreNames.has(c.name.toLowerCase());
            if (isCore) tools.logger.runtime(`proactiveBatchGeneration: Programmatically filtering out core/player character '${c.name}'`);
            return !isCore;
        });

        return await identity.dedupeAndMergeCharacters(tools, filteredResults);
    } catch {
        return [];
    }
}

async function processSupportingCastFile(turnContext, tools, file, canon, excludedNames = []) {
    const rawContent = await fs.readFile(file.path, 'utf-8');
    const contentHash = tools.turnContext.runtime.generateHash ? tools.turnContext.runtime.generateHash(rawContent, 'sha256') : parser.simpleHash(rawContent);

    // Ensure tables exist before querying (lazy init for hot-reloads)
    await storage.initializeDatabase(tools);

    try {
        const cached = await tools.db.project.query("SELECT character_data, content_hash FROM supporting_cast_cache WHERE file_path = ?", [file.path]);
        if (cached && cached.length > 0 && cached[0].content_hash === contentHash) return JSON.parse(cached[0].character_data);
    } catch { }

    const promptPath = path.join(__dirname, '../prompts/cast_list_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const playerCharacterName = tools.settings.get().player_character_name || 'Player';
    const sanitizedContent = rawContent.replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);

    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };

    // Load schema and fields
    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, settings.capsule_detail_level || 'Medium');

    let prompt = promptTemplate
        .replace('${canon}', canon)
        .replace('${rawContent}', sanitizedContent)
        .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields))
        .replace('{{DYNAMIC_JSON_STRUCT}}', schemaAdapter.generateJsonStructure(fields));

    // Handle exclusions
    if (excludedNames && excludedNames.length > 0) {
        const exclusions = excludedNames.join(', ');
        prompt = prompt.replace('{{EXCLUSION_INSTRUCTION}}', `Do NOT generate entries for these existing characters: ${exclusions}.`);
    } else {
        prompt = prompt.replace('{{EXCLUSION_INSTRUCTION}}', '');
    }

    tools.logger.log('Character Sheets', `Extracting character cast list from ${path.basename(file.path)}...`);
    const rawModelDef = settings.model_def || { model: 'highendmodel' };
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef;

    try {
        const response = await tools.llm.json({
            msg: 'Cast List Extraction',
            requestId: 'cast_list_extraction',
            prompt,
            model: modelDef.model,
            provider: modelDef.provider,
            callingModule: 'Plugin:character_sheets:cast_list'
        });
        const rawCharacters = response.content?.characters || [];
        const cleanResults = sanitizer.sanitizeBatch(rawCharacters);

        // Programmatic filtering of excluded names to prevent hallucinations
        const filteredResults = cleanResults.filter(c => {
            if (!c.name) return false;
            const isExcluded = excludedNames.some(ex => ex.toLowerCase() === c.name.toLowerCase());
            if (isExcluded) tools.logger.runtime(`processSupportingCastFile: Programmatically filtering out excluded character '${c.name}'`);
            return !isExcluded;
        });

        const results = await identity.dedupeAndMergeCharacters(tools, filteredResults);
        if (results.length > 0) {
            await tools.db.project.execute(
                "INSERT OR REPLACE INTO supporting_cast_cache (file_path, content_hash, character_data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                [file.path, contentHash, JSON.stringify(results)]
            );
        }
        return results;
    } catch {
        return [];
    }
}

async function generateLightCapsule(turnContext, tools, charName) {
    const turnNumber = turnContext.turnNumber || 0;
    const playerCharacterName = tools.settings.get().player_character_name || 'Player';
    const dialogue = (turnContext.processed.dialogueProcessor.dialogue || '').replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);

    try {
        const promptPath = path.join(__dirname, '../prompts/prompt_light.txt');
        const promptTemplate = await fs.readFile(promptPath, 'utf-8');
        const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
        const detailInstruction = parser.getDetailInstruction(settings.capsule_detail_level);

        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, settings.capsule_detail_level || 'Medium');

        const prompt = promptTemplate
            .replace('${target}', charName)
            .replace('${context}', dialogue)
            .replace('${detailInstruction}', detailInstruction)
            .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields));

    const rawModelDef = settings.model_def || settings.narrative_agents?.summarizer;
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef || {};

        const response = await tools.llm.runTask({
            msg: 'Single Capsule Generation',
            requestId: 'single_capsule_generation',
            prompt,
            model: modelDef.model,
            provider: modelDef.provider,
            params: {
                temperature: 0.3,
                callingModule: 'Plugin:character_sheets:light_capsule'
            }
        });

        // Use the parser which now supports schema-based parsing
        const capsule = await parser.parseCharacterSheet(tools, response.content, { name: charName });
        const lowerName = charName.toLowerCase();

        const entries = [];
        fields.forEach(f => {
            if (f.predicate && capsule[f.id]) {
                entries.push({ predicate: f.predicate, value: capsule[f.id] });
            }
        });

        // Metadata
        entries.push({ predicate: 'CHAR_SHEET:FIRST_APPEARED', value: turnNumber.toString() });
        entries.push({ predicate: 'CHAR_SHEET:LAST_APPEARED', value: turnNumber.toString() });

        // Fallback for brief if not present in schema but critical for system
        // Usually biography is good enough
        if (capsule.biography && !capsule.brief) capsule.brief = capsule.biography;

        // Aliases
        if (capsule.aliases) {
            const ignoredAliases = new Set(['none', 'n/a', 'na', 'unknown', 'null', '-']);
            capsule.aliases.split(',').forEach(a => {
                const alias = a.trim();
                if (alias && !ignoredAliases.has(alias.toLowerCase())) entries.push({ predicate: 'IS_ALIAS_OF', value: charName, source: alias.toLowerCase() });
            });
        }

        for (const entry of entries) {
            if (entry.value === undefined) continue;
            const source = entry.source || lowerName;
            await tools.facts.appendToFactsDb({
                source,
                target: entry.predicate === 'IS_ALIAS_OF' ? entry.value : 'self',
                predicate: entry.predicate,
                fact_value: entry.value
            }, { turn_number: turnNumber });
        }

        const brief = capsule.brief || capsule.biography || '';
        if (brief) await storage.syncSocialRegistry(tools, charName, brief);
        return { brief, first_turn_appeared: turnNumber, last_turn_appeared: turnNumber };
    } catch {
        return null;
    }
}

async function batchGenerateLightCapsules(turnContext, tools, charNames) {
    if (!charNames || charNames.length === 0) return [];

    const playerCharacterName = tools.settings.get().player_character_name || 'Player';
    const rawDialogue = turnContext.processed.dialogueProcessor.dialogue || '';
    let processedDialogue;

    if (Array.isArray(rawDialogue)) {
        processedDialogue = rawDialogue.map(l => {
            if (typeof l === 'object' && l.character && l.text) return `${l.character}: ${l.text}`;
            return l.line || l || '';
        }).join('\n');
    } else {
        processedDialogue = String(rawDialogue);
    }

    const dialogue = processedDialogue.replace(/<USER_CHARACTER>|\[USER_CHARACTER\]/g, playerCharacterName);

    try {
        const promptPath = path.join(__dirname, '../prompts/prompt_light_batch.txt');
        const promptTemplate = await fs.readFile(promptPath, 'utf-8');

        const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
        const detailInstruction = parser.getDetailInstruction(settings.capsule_detail_level);

        const schema = await schemaAdapter.loadSchema();
        const fields = schemaAdapter.getFields(schema, settings.capsule_detail_level || 'Medium');

        const prompt = promptTemplate
            .replace('${targets}', charNames.join(', '))
            .replace('${context}', dialogue)
            .replace('${detailInstruction}', detailInstruction)
            .replace('{{DYNAMIC_SCHEMA}}', schemaAdapter.generatePromptSchema(fields))
            .replace('{{DYNAMIC_JSON_STRUCT}}', schemaAdapter.generateJsonStructure(fields));

        tools.logger.log('Character Sheets', `Batch generating ${charNames.length} capsules: ${charNames.join(', ')}...`);
    const rawModelDef = settings.model_def || settings.narrative_agents?.summarizer;
    const modelDef = tools.llm.resolveModelDefinition?.(rawModelDef) || rawModelDef || {};

        const response = await tools.llm.json({
            msg: 'Batch Capsule Generation',
            requestId: 'batch_capsule_generation',
            prompt,
            model: modelDef.model,
            provider: modelDef.provider,
            params: {
                temperature: 0.3,
                callingModule: 'Plugin:character_sheets:light_capsule_batch'
            }
        });

        const rawCharacters = response.content?.characters || [];
        const cleanResults = sanitizer.sanitizeBatch(rawCharacters);
        // Dedupe
        return await identity.dedupeAndMergeCharacters(tools, cleanResults);

    } catch {
        return [];
    }
}

module.exports = {
    extractMentionedNames, proactiveBatchGeneration,
    processSupportingCastFile, generateLightCapsule, batchGenerateLightCapsules
};
