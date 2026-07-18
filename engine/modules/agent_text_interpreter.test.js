const assert = require('assert');
const {
    executeNarrativeCommand,
    loadNarrativeCorpus,
    parseCommandArguments,
    splitCommandPipeline,
    tokenizeCommand
} = require('./agent_text_interpreter.js');

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

(async () => {
    await runTestAsync('tokenizes quoted command strings and long options', async () => {
        assert.deepStrictEqual(
            tokenizeCommand('recall --subject "Alice Vale" --query \'broken trust\''),
            ['recall', '--subject', 'Alice Vale', '--query', 'broken trust']
        );
        assert.deepStrictEqual(parseCommandArguments('search --tags=mystery,trust --limit 3'), {
            verb: 'search',
            options: { tags: 'mystery,trust', limit: '3' },
            positional: []
        });
    });

    await runTestAsync('runs grep-compatible search with context and line numbers', async () => {
        const text = ['zero', 'before', 'Crimson Gate opens', 'after', 'end'].join('\n');
        const result = executeNarrativeCommand('rg -in -C 1 "crimson gate"', text);
        assert.strictEqual(result.matchCount, 1);
        assert.match(result.output, /2-before/);
        assert.match(result.output, /3:Crimson Gate opens/);
        assert.match(result.output, /4-after/);
    });

    await runTestAsync('supports head tail sed wc and turn extraction', async () => {
        const text = '===== TURN 1 | Start =====\none\ntwo\n===== TURN 2 | Next =====\nthree\nfour';
        assert.strictEqual(executeNarrativeCommand('head -n 2', text).output.split('\n').length, 2);
        assert.strictEqual(executeNarrativeCommand('tail -n 2', text).output, 'three\nfour');
        assert.strictEqual(executeNarrativeCommand("sed -n '2,3p'", text).output, 'one\ntwo');
        assert.strictEqual(executeNarrativeCommand('wc -w', text).count, 16);
        assert.match(executeNarrativeCommand('turn 2', text).output, /three\nfour/);
    });

    await runTestAsync('supports safe pipelines and GNU head shorthand', async () => {
        const text = Array.from({ length: 30 }, (_, index) => `Line ${index + 1}: Chiori`).join('\n');
        const result = executeNarrativeCommand('grep -n -i "Chiori" | head -20', text);
        assert.strictEqual(result.operation, 'pipeline');
        assert.strictEqual(result.output.split('\n').length, 20);
        assert.deepStrictEqual(result.pipeline.map(stage => stage.operation), ['grep', 'head']);
        assert.strictEqual(executeNarrativeCommand('tail -5', text).output.split('\n').length, 5);
        assert.deepStrictEqual(splitCommandPipeline('grep "A|B" | tail -1'), ['grep "A|B"', 'tail -1']);
        assert.throws(() => executeNarrativeCommand('grep Chiori | | head -2', text), /empty command/);
    });

    await runTestAsync('caps output and rejects unsupported commands', async () => {
        const bounded = executeNarrativeCommand('head -n 100', 'x\n'.repeat(100), { maxOutputChars: 256 });
        assert.strictEqual(bounded.truncated, false);
        const truncated = executeNarrativeCommand('head -n 1000', 'long line\n'.repeat(1000), { maxOutputChars: 256 });
        assert.strictEqual(truncated.truncated, true);
        assert.throws(() => executeNarrativeCommand('cat story.txt', 'story'), /Unsupported command/);
    });

    await runTestAsync('loads all raw fulltext rows into a turn-labelled corpus', async () => {
        const corpus = await loadNarrativeCorpus(
            { projectName: 'Test Story' },
            {
                turnContext: { projectName: 'Test Story' },
                db: {
                    chat: {
                        query: async () => [
                            { id: 4, creation_turn_number: 7, title: 'Arrival', fulltext: 'First scene.' },
                            { id: 5, creation_turn_number: 8, title: 'Missing', fulltext: null },
                            { id: 6, creation_turn_number: 9, title: 'Return', fulltext: 'Third scene.' }
                        ]
                    }
                }
            }
        );

        assert.strictEqual(corpus.rowCount, 3);
        assert.strictEqual(corpus.fulltextTurnCount, 2);
        assert.deepStrictEqual(corpus.missingFulltextTurns, [2]);
        assert.match(corpus.text, /TURN 1 \| Arrival/);
        assert.match(corpus.text, /TURN 3 \| Return/);
    });
})();
