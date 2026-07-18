const assert = require('node:assert/strict');
const test = require('node:test');

const plugin = require('./index.js');

function makeTools(titleEnabled = true) {
    return {
        settings: { getSelf: () => ({ enable_title_commands: titleEnabled }) },
        pluginState: { turn: () => ({}) },
        logger: { log: () => {} }
    };
}

function makeContext() {
    return {
        runtime: { vnCinematographer: { titleAuthority: { location: true, time: true } } },
        output: {
            sequence: [
                { line: 'Opening', clientEvents: [] },
                { line: 'Arrival', clientEvents: [] }
            ]
        }
    };
}

function ownedTitle(context, line = 1) {
    return context.output.sequence[line].clientEvents.find(event => (
        event.type === 'vn:title-popout'
        && event.payload?.titleComposition?.owner === 'vn_cinematographer'
    ));
}

function addCreative(context, tools) {
    plugin.exports.applyDirectorTrack(context, tools, {
        script: [{
            line: 1,
            commands: ['title:character_intro|Chiori|Fashion Designer']
        }]
    });
}

function addTrackerTitles(context, tools) {
    plugin.exports.replaceTitleContributions(context, tools, {
        source: 'world_location_tracker',
        contributions: [{ line: 1, kind: 'location', text: 'Chioriya Boutique' }]
    });
    plugin.exports.replaceTitleContributions(context, tools, {
        source: 'world_state_tracker',
        contributions: [{ line: 1, kind: 'time', text: 'Day 32, 4:10 PM' }]
    });
}

test('title composition is independent of producer ordering', () => {
    const tools = makeTools();
    const trackerFirst = makeContext();
    addTrackerTitles(trackerFirst, tools);
    addCreative(trackerFirst, tools);

    const creativeFirst = makeContext();
    addCreative(creativeFirst, tools);
    addTrackerTitles(creativeFirst, tools);

    assert.deepEqual(ownedTitle(trackerFirst).payload, ownedTitle(creativeFirst).payload);
    assert.equal(ownedTitle(trackerFirst).payload.text, 'Chiori');
    assert.equal(ownedTitle(trackerFirst).payload.subtext, 'Fashion Designer');
    assert.equal(ownedTitle(trackerFirst).payload.locationText, 'Chioriya Boutique');
    assert.equal(ownedTitle(trackerFirst).payload.timeText, 'Day 32, 4:10 PM');
});

test('replacing a source clears stale contributions without removing other title parts', () => {
    const tools = makeTools();
    const context = makeContext();
    addCreative(context, tools);
    addTrackerTitles(context, tools);

    plugin.exports.replaceTitleContributions(context, tools, {
        source: 'world_location_tracker',
        contributions: [{ line: 1, kind: 'location', text: 'Court of Fontaine' }]
    });

    const title = ownedTitle(context);
    assert.equal(title.payload.locationText, 'Court of Fontaine');
    assert.equal(title.payload.timeText, 'Day 32, 4:10 PM');
    assert.equal(context.output.sequence[1].clientEvents.filter(event => event.type === 'vn:title-popout').length, 1);
});

test('owned title composition does not merge unrelated core title events', () => {
    const tools = makeTools();
    const context = makeContext();
    context.output.sequence[1].clientEvents.push({
        type: 'vn:title-popout',
        payload: { preset: 'chapter_intro', text: 'Chapter 64', subtext: 'Metal and Water' }
    });

    addTrackerTitles(context, tools);

    const titles = context.output.sequence[1].clientEvents.filter(event => event.type === 'vn:title-popout');
    assert.equal(titles.length, 2);
    assert.equal(titles[0].payload.text, 'Chapter 64');
    assert.equal(ownedTitle(context).payload.text, 'Chioriya Boutique');
    assert.equal(ownedTitle(context).payload.timeText, 'Day 32, 4:10 PM');
});

test('tracker contributions are ignored when title commands are disabled', () => {
    const context = makeContext();
    const result = plugin.exports.replaceTitleContributions(context, makeTools(false), {
        source: 'world_location_tracker',
        contributions: [{ line: 1, kind: 'location', text: 'Court of Fontaine' }]
    });

    assert.deepEqual(result, []);
    assert.equal(ownedTitle(context), undefined);
});

test('title prompt stays generic and removes tracker-owned location titles', () => {
    const section = plugin.__test.buildTitleSection(
        plugin.__test.getAvailableTitlePresets({}, { pluginState: { turn: () => ({}) } }, { location: true }),
        { location: true, time: true }
    );

    assert.doesNotMatch(section, /Belluga|10:00 AM/);
    assert.doesNotMatch(section, /Available presets:.*locationchange/);
    assert.match(section, /Do not create or infer location titles/);
    assert.match(section, /Do not write exact dates or clock values/);
});

test('title authority requires an operational WLT map while loaded WST owns time', async () => {
    const context = { runtime: {} };
    const tools = {
        plugins: {
            isInstalled: id => ['world_location_tracker', 'world_state_tracker'].includes(id),
            tryCall: async () => ({ active: false, reason: 'No valid world map' })
        }
    };

    const authority = await plugin.__test.getTitleAuthority(context, tools);
    assert.deepEqual(authority, { location: false, time: true });
    assert.deepEqual(context.runtime.vnCinematographer.titleAuthority, authority);
});

test('LLM location and exact-time titles are rejected while atmospheric titles remain', () => {
    const tools = makeTools();
    const context = makeContext();

    plugin.exports.applyDirectorTrack(context, tools, {
        script: [{ line: 1, commands: [
            'title:locationchange|Court of Fontaine|Day 32, 4:10 PM',
            'title:major_event|Day 32, 4:10 PM|',
            'title:major_event|Nightfall|A quiet promise'
        ] }]
    });

    assert.equal(ownedTitle(context).payload.text, 'Nightfall');
});

test('grounded ambient VFX prompt suggests supported environment effects', () => {
    const section = plugin.__test.buildGroundedAmbientVfxSection(
        {
            output: {
                sequence: [
                    { line: 'A dry wind drags sand through the canyon.' },
                    { line: 'Cloud shadows crawl over the road.' }
                ]
            },
            processed: {
                assetSelector: {
                    background: 'assets/backgrounds/desert_canyon_cloudy.webp',
                    backgroundChangesDraft: []
                }
            }
        },
        { weatherChange: 'Windy and overcast', safetyLevel: 'Safe', crowdDensity: 'Sparse' },
        'Outdoor canyon road',
        ['vfx']
    );

    assert.match(section, /"desert-dust"/);
    assert.match(section, /"clouds"/);
    assert.match(section, /every effect still needs evidence/);
    assert.match(section, /Do not treat this list as mandatory/);
});

test('grounded ambient VFX prompt with no evidence keeps VFX conditional', () => {
    const section = plugin.__test.buildGroundedAmbientVfxSection(
        { output: { sequence: [{ line: 'They speak quietly in a plain room.' }] } },
        { weatherChange: 'Neutral', safetyLevel: 'Safe', crowdDensity: 'Sparse' },
        'Interior room',
        ['vfx']
    );

    assert.match(section, /No strong ambient candidates/);
    assert.match(section, /clearly justifies/);
    assert.doesNotMatch(section, /"rain"/);
});
