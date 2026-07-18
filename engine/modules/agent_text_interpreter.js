const DEFAULT_MAX_OUTPUT_CHARS = 12000;

function tokenizeCommand(command) {
    const input = String(command || '').trim();
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        if (char === '\\' && quote) {
            escaping = true;
            continue;
        }
        if (quote) {
            if (char === quote) quote = null;
            else current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }

    if (escaping) current += '\\';
    if (quote) throw new Error('Unterminated quote in command.');
    if (current) tokens.push(current);
    return tokens;
}

function splitCommandPipeline(command) {
    const input = String(command || '').trim();
    const stages = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        if (char === '\\' && quote) {
            current += char;
            escaping = true;
            continue;
        }
        if (char === '"' || char === "'") {
            if (!quote) quote = char;
            else if (quote === char) quote = null;
            current += char;
            continue;
        }
        if (char === '|' && !quote) {
            const stage = current.trim();
            if (!stage) throw new Error('Pipeline contains an empty command.');
            stages.push(stage);
            current = '';
            continue;
        }
        current += char;
    }

    if (quote) throw new Error('Unterminated quote in command.');
    const finalStage = current.trim();
    if (!finalStage) throw new Error('Pipeline contains an empty command.');
    stages.push(finalStage);
    if (stages.length > 4) throw new Error('Pipelines support at most 4 commands.');
    return stages;
}

function parseCommandArguments(command) {
    const tokens = tokenizeCommand(command);
    const verb = String(tokens.shift() || '').toLowerCase();
    const options = {};
    const positional = [];

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (!token.startsWith('--')) {
            positional.push(token);
            continue;
        }

        const raw = token.slice(2);
        const equalsIndex = raw.indexOf('=');
        if (equalsIndex >= 0) {
            options[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
            continue;
        }

        const next = tokens[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
            options[raw] = next;
            index++;
        } else {
            options[raw] = true;
        }
    }

    return { verb, options, positional };
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function truncateOutput(output, maxOutputChars) {
    const text = String(output || '');
    if (text.length <= maxOutputChars) return { output: text, truncated: false };
    const suffix = '\n...[output truncated]';
    return {
        output: text.slice(0, Math.max(0, maxOutputChars - suffix.length)) + suffix,
        truncated: true
    };
}

function assertSafeRegex(pattern) {
    if (pattern.length > 256) throw new Error('Search pattern exceeds 256 characters.');
    if (/\(\?/.test(pattern)) throw new Error('Regex lookarounds and special groups are not supported.');
    if (/\\[1-9]/.test(pattern)) throw new Error('Regex backreferences are not supported.');
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
        throw new Error('Potentially explosive nested regex quantifier rejected.');
    }
}

function parseSearchOptions(tokens) {
    const options = {
        ignoreCase: false,
        lineNumbers: false,
        fixed: false,
        invert: false,
        before: 0,
        after: 0,
        maxMatches: 80
    };
    const patternParts = [];

    for (let index = 1; index < tokens.length; index++) {
        const token = tokens[index];
        const numericFlag = token.match(/^-(C|A|B|m)(\d+)$/);
        if (numericFlag) {
            const value = clampInteger(numericFlag[2], 0, 100, 0);
            if (numericFlag[1] === 'C') options.before = options.after = value;
            if (numericFlag[1] === 'A') options.after = value;
            if (numericFlag[1] === 'B') options.before = value;
            if (numericFlag[1] === 'm') options.maxMatches = Math.max(1, value);
            continue;
        }
        if (['-C', '-A', '-B', '-m', '--context', '--after-context', '--before-context', '--max-count'].includes(token)) {
            const value = clampInteger(tokens[++index], 0, 100, 0);
            if (token === '-C' || token === '--context') options.before = options.after = value;
            if (token === '-A' || token === '--after-context') options.after = value;
            if (token === '-B' || token === '--before-context') options.before = value;
            if (token === '-m' || token === '--max-count') options.maxMatches = Math.max(1, value);
            continue;
        }
        if (token === '--ignore-case') options.ignoreCase = true;
        else if (token === '--line-number') options.lineNumbers = true;
        else if (token === '--fixed-strings') options.fixed = true;
        else if (token === '--invert-match') options.invert = true;
        else if (/^-[inFv]+$/.test(token)) {
            options.ignoreCase ||= token.includes('i');
            options.lineNumbers ||= token.includes('n');
            options.fixed ||= token.includes('F');
            options.invert ||= token.includes('v');
        } else if (token.startsWith('-')) {
            throw new Error(`Unsupported search option: ${token}`);
        } else {
            patternParts.push(token);
        }
    }

    const pattern = patternParts.join(' ').trim();
    if (!pattern) throw new Error('Search command requires a pattern.');
    return { ...options, pattern };
}

function executeSearch(tokens, lines) {
    const options = parseSearchOptions(tokens);
    let matcher;

    if (options.fixed) {
        const needle = options.ignoreCase ? options.pattern.toLowerCase() : options.pattern;
        matcher = (line) => (options.ignoreCase ? line.toLowerCase() : line).includes(needle);
    } else {
        assertSafeRegex(options.pattern);
        const regex = new RegExp(options.pattern, options.ignoreCase ? 'i' : '');
        matcher = (line) => regex.test(line);
    }

    const matchedIndexes = [];
    for (let index = 0; index < lines.length && matchedIndexes.length < options.maxMatches; index++) {
        const matched = matcher(lines[index]);
        if (options.invert ? !matched : matched) matchedIndexes.push(index);
    }

    const included = new Set();
    for (const index of matchedIndexes) {
        const start = Math.max(0, index - options.before);
        const end = Math.min(lines.length - 1, index + options.after);
        for (let cursor = start; cursor <= end; cursor++) included.add(cursor);
    }

    const outputLines = [];
    let previous = null;
    for (const index of Array.from(included).sort((a, b) => a - b)) {
        if (previous !== null && index > previous + 1) outputLines.push('--');
        const isMatch = matchedIndexes.includes(index);
        const separator = isMatch ? ':' : '-';
        outputLines.push(options.lineNumbers ? `${index + 1}${separator}${lines[index]}` : lines[index]);
        previous = index;
    }

    return {
        output: outputLines.join('\n'),
        matchCount: matchedIndexes.length,
        outputLineCount: outputLines.length
    };
}

function parseCount(tokens, fallback = 20) {
    if (tokens[1] === '-n') return clampInteger(tokens[2], 1, 1000, fallback);
    if (/^-\d+$/.test(tokens[1] || '')) return clampInteger(tokens[1].slice(1), 1, 1000, fallback);
    return clampInteger(tokens[1], 1, 1000, fallback);
}

function executeSingleNarrativeCommand(command, narrativeText, options = {}) {
    const tokens = tokenizeCommand(command);
    const operation = String(tokens[0] || '').toLowerCase();
    const text = String(narrativeText || '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const maxOutputChars = clampInteger(options.maxOutputChars, 256, 100000, DEFAULT_MAX_OUTPUT_CHARS);
    let result;

    if (operation === 'rg' || operation === 'grep') {
        result = executeSearch(tokens, lines);
    } else if (operation === 'head') {
        const count = parseCount(tokens);
        result = { output: lines.slice(0, count).join('\n'), outputLineCount: Math.min(count, lines.length) };
    } else if (operation === 'tail') {
        const count = parseCount(tokens);
        result = { output: lines.slice(-count).join('\n'), outputLineCount: Math.min(count, lines.length) };
    } else if (operation === 'sed') {
        const script = tokens.filter(token => token !== '-n').slice(1).join('');
        const match = script.match(/^(\d+)(?:,(\d+))?p$/);
        if (!match) throw new Error("Supported sed syntax is: sed -n 'START,ENDp'.");
        const start = clampInteger(match[1], 1, lines.length, 1);
        const end = clampInteger(match[2] || match[1], start, lines.length, start);
        result = { output: lines.slice(start - 1, end).join('\n'), outputLineCount: end - start + 1 };
    } else if (operation === 'wc') {
        const mode = tokens[1] || '-l';
        const value = mode === '-c'
            ? text.length
            : mode === '-w'
                ? (text.trim() ? text.trim().split(/\s+/).length : 0)
                : lines.length;
        if (!['-l', '-w', '-c'].includes(mode)) throw new Error('Supported wc modes are -l, -w, and -c.');
        result = { output: String(value), count: value, mode, outputLineCount: 1 };
    } else if (operation === 'turn') {
        const turn = clampInteger(tokens[1], 1, Number.MAX_SAFE_INTEGER, null);
        if (!turn) throw new Error('turn requires a positive story turn number.');
        const marker = `===== TURN ${turn}`;
        const start = lines.findIndex(line => line.startsWith(marker));
        if (start < 0) {
            result = { output: '', found: false, turn, outputLineCount: 0 };
        } else {
            let end = lines.length;
            for (let index = start + 1; index < lines.length; index++) {
                if (lines[index].startsWith('===== TURN ')) {
                    end = index;
                    break;
                }
            }
            result = { output: lines.slice(start, end).join('\n').trim(), found: true, turn, outputLineCount: end - start };
        }
    } else {
        throw new Error('Unsupported command. Use rg, grep, head, tail, sed -n, wc, or turn.');
    }

    const bounded = truncateOutput(result.output, maxOutputChars);
    return {
        command: String(command || ''),
        operation,
        narrativeLineCount: lines.length,
        ...result,
        ...bounded
    };
}

function executeNarrativeCommand(command, narrativeText, options = {}) {
    const stages = splitCommandPipeline(command);
    if (stages.length === 1) {
        return executeSingleNarrativeCommand(stages[0], narrativeText, options);
    }

    let stageInput = String(narrativeText || '');
    const stageResults = [];
    for (let index = 0; index < stages.length; index++) {
        const isFinal = index === stages.length - 1;
        const result = executeSingleNarrativeCommand(stages[index], stageInput, {
            ...options,
            maxOutputChars: isFinal ? options.maxOutputChars : 100000
        });
        stageResults.push(result);
        stageInput = result.output;
    }

    const finalResult = stageResults[stageResults.length - 1];
    return {
        ...finalResult,
        command: String(command || ''),
        operation: 'pipeline',
        narrativeLineCount: String(narrativeText || '').replace(/\r\n?/g, '\n').split('\n').length,
        pipeline: stageResults.map(result => ({
            command: result.command,
            operation: result.operation,
            matchCount: result.matchCount,
            outputLineCount: result.outputLineCount,
            truncated: result.truncated
        }))
    };
}

async function loadNarrativeCorpus(turnContext, tools) {
    const projectName = turnContext?.projectName || tools.turnContext?.projectName;
    if (!projectName) throw new Error('No active project is available for narrative search.');

    const rows = await tools.db.chat.query(
        `SELECT id, creation_turn_number, title, fulltext
         FROM chat_turns
         WHERE LOWER(project_name) = LOWER(?)
         ORDER BY id ASC`,
        [projectName]
    );

    const missingFulltextTurns = [];
    const sections = [];
    (rows || []).forEach((row, index) => {
        const storyTurn = index + 1;
        const fulltext = typeof row.fulltext === 'string' ? row.fulltext.trim() : '';
        if (!fulltext) {
            missingFulltextTurns.push(storyTurn);
            return;
        }
        const title = String(row.title || '').trim();
        const createdAs = Number.isFinite(Number(row.creation_turn_number))
            ? ` | creation_turn=${row.creation_turn_number}`
            : '';
        sections.push(`===== TURN ${storyTurn}${title ? ` | ${title}` : ''}${createdAs} =====\n${fulltext}`);
    });

    return {
        text: sections.join('\n\n'),
        rowCount: (rows || []).length,
        fulltextTurnCount: sections.length,
        missingFulltextTurns
    };
}

function createNarrativeAgentTool(turnContext, tools) {
    return {
        name: 'story_text',
        description: [
            'Search the complete raw story transcript as one turn-labelled text string.',
            'Pass one read-only command or an allowlisted pipeline of up to 4 commands in args.command.',
            'Supported: rg/grep [-i] [-n] [-F] [-C N] [-m N] PATTERN; head/tail -n N or -N;',
            "sed -n 'START,ENDp'; wc -l|-w|-c; turn N. Example: grep -ni -m 20 \"Chiori\" or grep -ni \"Chiori\" | head -20. No shell is executed."
        ].join(' '),
        schema: {
            type: 'object',
            required: ['command'],
            properties: { command: { type: 'string' } }
        },
        execute: async (args = {}) => {
            const corpus = await loadNarrativeCorpus(turnContext, tools);
            const result = executeNarrativeCommand(args.command, corpus.text, {
                maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS
            });
            return {
                ...result,
                corpus: {
                    rowCount: corpus.rowCount,
                    fulltextTurnCount: corpus.fulltextTurnCount,
                    missingFulltextTurns: corpus.missingFulltextTurns
                }
            };
        }
    };
}

module.exports = {
    DEFAULT_MAX_OUTPUT_CHARS,
    createNarrativeAgentTool,
    executeNarrativeCommand,
    loadNarrativeCorpus,
    parseCommandArguments,
    splitCommandPipeline,
    tokenizeCommand
};
