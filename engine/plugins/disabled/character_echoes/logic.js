/**
 * Character Echoes - Logic Library
 * Handles the selection of characters, questions, and the sequential LLM introspection pipeline.
 */
const fs = require('fs/promises');
const path = require('path');

async function runEchoSession(turnContext, tools) {
    tools.logger.log('Echoes', 'Background task started. Fetching settings...');
    const settings = await tools.settings.getSelf();
    const frequency = settings.echo_frequency || 5;
    const turnNumber = turnContext.turnNumber || 0;
    const projectName = turnContext.projectName?.toLowerCase();

    if (!projectName) {
        tools.logger.error('Echoes', 'No project name found in TurnContext. Skipping.');
        return;
    }

    // Standardized cleanup for the current turn/interlude scope.
    // Since this is a background task, we clear any previous echoes for this turn before processing.
    await tools.facts.cleanUpFactsDb();

    // Check distance since last execution, respecting the current timeline position
    const lastRunRows = await tools.db.chat.query(
        `SELECT MAX(turn_number) as last_turn FROM facts 
         WHERE project_name = ? AND predicate LIKE 'ECHO:%' 
         AND turn_number < ?`,
        [projectName, turnNumber]
    );

    const lastTurn = lastRunRows[0]?.last_turn || 0;
    const distance = turnNumber - lastTurn;

    // Run if frequency reached, OR if it's Turn 1 and we've never run
    const shouldRun = (lastTurn === 0 && turnNumber >= 1) || (distance >= frequency);

    if (!shouldRun) {
        const nextIn = frequency - distance;
        tools.logger.runtime(`Echoes: Next session in ${nextIn} turn${nextIn === 1 ? '' : 's'}.`);
        return;
    }

    tools.logger.log('Echoes', `Starting introspection session for Turn ${turnNumber}...`);

    tools.logger.log('Echoes', `Identifying CORE characters for project: ${projectName}...`);
    try {
        // 1. Identify CORE characters
        const coreRows = await tools.db.chat.query(
            `SELECT DISTINCT source FROM facts 
             WHERE project_name = ? AND predicate = 'IMPORTANCE' AND UPPER(fact_value) = 'CORE'
             AND turn_number <= ?`,
            [projectName, turnNumber]
        );

        tools.logger.log('Echoes', `Found ${coreRows?.length || 0} CORE character records in database.`);

        if (!coreRows || coreRows.length === 0) {
            tools.logger.log('Echoes', 'No characters with IMPORTANCE=CORE found. Skipping.');
            return;
        }

        const playerCharacterName = tools.settings.get('character_sheets')?.player_character_name || 'Player';
        const includePlayer = settings.include_player === true;

        const candidates = coreRows
            .map(r => r.source)
            .filter(name => {
                if (!includePlayer && name.toLowerCase() === playerCharacterName.toLowerCase()) return false;
                return true;
            });

        if (candidates.length === 0) {
            tools.logger.runtime('Echoes: No suitable candidates for introspection (all filtered).');
            return;
        }

        // 2. Load Questions
        const questionsPath = path.join(__dirname, 'questions.json');
        const questionsData = JSON.parse(await fs.readFile(questionsPath, 'utf-8'));
        const allQuestions = questionsData.questions;
        
        // Pick X random questions
        const numToPick = settings.questions_per_session || 3;
        const selectedQuestions = allQuestions
            .sort(() => 0.5 - Math.random())
            .slice(0, numToPick);

        // 3. Prepare Shared Context (Mirroring Director/Writer Foundation)
        const pc = turnContext.promptComponents;
        
        const canon = [...(pc.root?.canon || [])].filter(Boolean).join('\n\n');
        const dynamicKnowledge = [...(pc.root?.dynamic_knowledge || [])].filter(Boolean).join('\n\n');
        const history = turnContext.runtime?.narrativeHistory || [...(pc.root?.history || [])].filter(Boolean).join('\n\n');
        const simulation = [...(pc.root?.simulation || [])].filter(Boolean).join('\n\n');

        const systemMessage = `
# PART 1: THE CANON (REFERENCE DATA)
${canon}

# PART 2: DYNAMIC KNOWLEDGE
${dynamicKnowledge}

# PART 3: THE NARRATIVE STREAM (HISTORY)
${history}

# PART 4: THE SIMULATION (CURRENT STATE)
${simulation}
`.trim();

        const userPromptPath = path.join(__dirname, 'prompts/echo_user.txt');
        let userTemplate = await fs.readFile(userPromptPath, 'utf-8');

        const modelDef = settings.model_def || { model: 'highendmodel' };
        const delayMs = settings.inter_character_delay || 5000;

        // 4. Sequential Introspection Loop
        for (let i = 0; i < candidates.length; i++) {
            const charName = candidates[i];
            
            // Add inter-character delay for prompt caching (except the first)
            if (i > 0 && delayMs > 0) {
                tools.logger.runtime(`Echoes: Waiting ${delayMs}ms before next character...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            tools.logger.log('Echoes', `Interviewing ${charName}...`);

            // Get character sheet or capsule
            const charData = await tools.plugins.call('character_sheets', 'getCurrentSheet', charName, turnNumber);
            if (!charData) {
                tools.logger.runtime(`Echoes: Could not find sheet for ${charName}, skipping.`);
                continue;
            }

            const questionsText = selectedQuestions.map(q => `[${q.id}]: ${q.text}`).join('\n');
            const projectDirectives = tools.directives.getFormatted('echo_directives', { header: '### INTROSPECTION DIRECTIVES' });
            const userMessage = userTemplate
                .replace('${characterName}', charName)
                .replace('${project_directives}', projectDirectives)
                .replace('${questions}', questionsText);

            const messages = [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ];

            try {
                tools.logger.llmRequest({
                    msg: `Echo Introspection: ${charName}`,
                    messages,
                    model: modelDef.model,
                    provider: modelDef.provider
                });

                const response = await tools.llm.call(messages, {
                    model: modelDef.model,
                    provider: modelDef.provider,
                    temperature: 0.7,
                    callingModule: 'Plugin:character_echoes'
                });

                tools.logger.llmResponse({
                    msg: `Echo Introspection: ${charName}`,
                    content: response.content,
                    model: response.model,
                    provider: modelDef.provider
                });

                // 5. Save Facts using managed toolkit
                const monologue = response.content.trim();
                if (monologue) {
                    await tools.facts.appendToFactsDb({
                        source: charName.toLowerCase(),
                        target: 'self',
                        predicate: 'ECHO:monologue',
                        fact_value: monologue,
                        context: 'Character Echoes'
                    });
                    tools.logger.runtime(`Echoes: Saved monologue for ${charName}.`);
                }

            } catch (err) {
                tools.logger.error('Echoes', `Failed to interview ${charName}: ${err.message}`);
            }
        }

        tools.logger.log('Echoes', `Introspection session complete.`);

    } catch (err) {
        tools.logger.error('Echoes', `Critical error in echo session: ${err.message}`);
    }
}



async function getLatestEchoes(charName, currentTurn, tools) {
    const projectName = tools.turnContext.projectName.toLowerCase();
    
    // Find the most recent turn this character had an echo
    const turnRows = await tools.db.chat.query(
        `SELECT MAX(turn_number) as max_turn FROM facts WHERE project_name = ? AND source = ? AND predicate LIKE 'ECHO:%' AND turn_number <= ?`,
        [projectName, charName.toLowerCase(), currentTurn]
    );

    if (!turnRows || turnRows.length === 0 || !turnRows[0].max_turn) {
        return null;
    }

    const echoTurn = turnRows[0].max_turn;
    const turnsAgo = currentTurn - echoTurn;
    
    // Fetch all echoes from that turn
    const echoRows = await tools.db.chat.query(
        `SELECT predicate, fact_value FROM facts WHERE project_name = ? AND source = ? AND predicate LIKE 'ECHO:%' AND turn_number = ?`,
        [projectName, charName.toLowerCase(), echoTurn]
    );

    if (!echoRows || echoRows.length === 0) return null;

    let timeContext = turnsAgo === 0 ? "(Introspected this turn)" : 
                      turnsAgo === 1 ? "(Introspected 1 turn ago)" : 
                      `(Introspected ${turnsAgo} turns ago, Turn ${echoTurn})`;

    // Load question map for nice formatting
    const questionsPath = path.join(__dirname, 'questions.json');
    let qMap = {};
    try {
        const questionsData = JSON.parse(await fs.readFile(questionsPath, 'utf-8'));
        questionsData.questions.forEach(q => qMap[q.id] = q.text);
    } catch {
        tools.logger.warn('Echoes', 'Failed to load questions.json for formatting echoes.');
    }

    let output = `${timeContext}\n`;
    echoRows.forEach(r => {
        if (r.predicate === 'ECHO:monologue') {
            output += `"${r.fact_value}"\n`;
        } else {
            // Legacy support for early format
            const qId = r.predicate.replace('ECHO:', '');
            const questionText = qMap[qId] || qId;
            output += `- **Q: ${questionText}**\n  *A: ${r.fact_value}*\n`;
        }
    });

    return output.trim();
}

module.exports = {
    runEchoSession,
    getLatestEchoes
};
