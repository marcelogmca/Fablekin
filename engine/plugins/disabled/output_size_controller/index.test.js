const test = require('node:test');
const assert = require('node:assert/strict');
const TurnContext = require('../../modules/turncontext.js');
const plugin = require('./index.js');

test('registers a disabled Writer minimum word count by default', () => {
    const turnContext = new TurnContext('OutputSizeControllerTest');

    assert.equal(turnContext.writerMinimumWordCount, 0);
    assert.equal(turnContext.processed.writerMinimumWordCount, 0);
});

test('sets the Writer minimum to 50 percent of the configured target', async () => {
    const turnContext = new TurnContext('OutputSizeControllerTest');
    const logs = [];
    const tools = {
        project: {
            getMetadata: async () => ({ word_count: 2500 })
        },
        logger: {
            log: message => logs.push(message)
        }
    };

    await plugin.hooks.HOOK_POST_ORCHESTRATOR.run(turnContext, tools);

    assert.equal(turnContext.writerMinimumWordCount, 1250);
    assert.match(turnContext.processed.writerBottomInstruction, /2500 words/);
    assert.equal(turnContext.processed.writerCoTInsertions.length, 2);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /Final Quantity Check/);
    assert.doesNotMatch(turnContext.processed.writerCoTInsertions[1].content, /Step 16/);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /2500-word target/);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /1250-word hard minimum/);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /2000 words ~= 150 VN-rendered lines/);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /roughly 188 total VN lines/);
    assert.match(turnContext.processed.writerCoTInsertions[1].content, /at least 95 voiced dialogue lines/);
    assert.doesNotMatch(turnContext.processed.writerCoTInsertions[1].content, /Planned Voice Lines/);
    assert.equal(turnContext.processed.writerCoTInsertions[1].insertAfterStep, undefined);
    assert.match(logs[0], /1250 words/);
});

test('rounds fractional minimums up to avoid accepting less than 50 percent', async () => {
    const turnContext = new TurnContext('OutputSizeControllerTest');
    const tools = {
        project: {
            getMetadata: async () => ({ word_count: 1001 })
        },
        logger: {
            log: () => {}
        }
    };

    await plugin.hooks.HOOK_POST_ORCHESTRATOR.run(turnContext, tools);

    assert.equal(turnContext.writerMinimumWordCount, 501);
});
