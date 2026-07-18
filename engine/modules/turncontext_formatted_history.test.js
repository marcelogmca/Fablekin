const assert = require('assert');
const TurnContext = require('./turncontext.js');

function makeChapter(turnNumber, label) {
    return {
        turnNumber,
        isSkeleton: false,
        output: {
            synopsis: `${label} synopsis`,
            summary: `${label} summary`,
            fulltext: `${label} fulltext`
        },
        processed: {
            dialogueProcessor: { dialogue: `${label} dialogue` },
            plugins: {}
        },
        ensureFull: async () => {}
    };
}

(async () => {
    const context = new TurnContext('History Ordering Test');
    context.ensureChapterManagementInitialized = async () => {};
    context.retrieveDatedChapters = async () => ({
        synopsischapters: [makeChapter(45, 'Turn 45')],
        summarychapters: [makeChapter(56, 'Turn 56')],
        fullchapters: [makeChapter(48, 'Turn 48 overridden full')]
    });

    const history = await context.getFormattedHistory({
        count: 3,
        skip: 0,
        tierConfig: { fulltext: 1, summary: 1, synopsis: 1 }
    });

    const turn45Index = history.indexOf('Chapter 45 [SYNOPSIS]');
    const turn48Index = history.indexOf('Chapter 48 [SUMMARY]');
    const turn56Index = history.indexOf('Chapter 56 [FULLTEXT]');

    assert.ok(turn45Index >= 0, 'Turn 45 should be present as the oldest synopsis.');
    assert.ok(turn48Index > turn45Index, 'Turn 48 should follow Turn 45 despite its original fulltext bucket.');
    assert.ok(turn56Index > turn48Index, 'Turn 56 should remain the newest chapter.');
    console.log('ok - getFormattedHistory sorts merged fidelity buckets chronologically');
})();
