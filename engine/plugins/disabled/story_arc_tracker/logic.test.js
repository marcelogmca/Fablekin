const assert = require('assert');
const plugin = require('./index.js');
const logic = require('./logic.js');

function runTest(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

function baseState(overrides = {}) {
    return logic.normalizeState({
        activeArc: {
            id: 'opening_arc',
            title: 'Opening Movement',
            startTurn: 1,
            mainQuestion: 'Will the journey begin?',
            mood: 'curious'
        },
        lastIntroTurn: 1,
        softShiftStreak: 0,
        ...overrides
    }, overrides.updatedTurn || 1);
}

function settings(overrides = {}) {
    return logic.normalizeSettings({
        minimum_turns_between_intros: 6,
        preferred_arc_turns: 12,
        maximum_turns_without_arc: 18,
        awkward_grace_turns: 2,
        trigger_mode: 'moderate',
        ...overrides
    });
}

runTest('normalizes sparse arc state with safe defaults', () => {
    const state = logic.normalizeState({}, 5);
    assert.equal(state.activeArc.id, 'opening_arc');
    assert.equal(state.pendingIntro, null);
    assert.equal(state.softShiftStreak, 0);
    assert.equal(state.updatedTurn, 5);
});

runTest('normalizes wrapped classifier payloads from JSON helpers', () => {
    const classification = logic.normalizeClassification({
        content: {
            decision: 'queue_new_arc',
            confidence: 0.8,
            arc_title: 'The Next Door',
            boundary_kind: 'location',
            awkward_intro_risk: 'low'
        }
    });

    assert.equal(classification.decision, 'queue_new_arc');
    assert.equal(classification.arc_title, 'The Next Door');
    assert.equal(classification.boundary_kind, 'location');
});

runTest('cooldown blocks weak new arc requests below minimum', () => {
    const result = logic.applyArcDecision(baseState(), {
        decision: 'queue_new_arc',
        confidence: 0.72,
        arc_title: 'The Market Road',
        boundary_kind: 'relationship',
        awkward_intro_risk: 'low',
        reason: 'The party mood changed.'
    }, settings(), 4);

    assert.equal(result.queued, false);
    assert.equal(result.queueReason, 'cooldown');
    assert.equal(result.state.pendingIntro, null);
});

runTest('hard boundaries can queue before minimum when confidence is high', () => {
    const result = logic.applyArcDecision(baseState(), {
        decision: 'queue_new_arc',
        confidence: 0.9,
        arc_title: 'Across the Red Gate',
        boundary_kind: 'location',
        awkward_intro_risk: 'low',
        reason: 'The party leaves the old region behind.'
    }, settings(), 4);

    assert.equal(result.queued, true);
    assert.equal(result.queueReason, 'hard_boundary_before_minimum');
    assert.equal(result.state.pendingIntro.title, 'Across the Red Gate');
});

runTest('preferred length allows repeated soft shifts to queue', () => {
    const result = logic.applyArcDecision(baseState({ softShiftStreak: 1 }), {
        decision: 'soft_shift',
        confidence: 0.55,
        arc_title: 'Quiet Consequences',
        boundary_kind: 'respite',
        awkward_intro_risk: 'low',
        reason: 'Two chapters in a row point to a quieter aftermath.'
    }, settings(), 13);

    assert.equal(result.queued, true);
    assert.equal(result.queueReason, 'soft_shift_streak');
});

runTest('maximum pressure defers during awkward grace', () => {
    const result = logic.applyArcDecision(baseState(), {
        decision: 'continue',
        confidence: 0.3,
        boundary_kind: 'other',
        awkward_intro_risk: 'high',
        reason: 'The party is mid-combat.'
    }, settings(), 19);

    assert.equal(result.queued, false);
    assert.equal(result.queueReason, 'awkward_grace');
    assert.equal(result.state.pendingPressure.sinceTurn, 19);
});

runTest('maximum pressure queues after awkward grace expires', () => {
    const result = logic.applyArcDecision(baseState({
        pendingPressure: {
            sinceTurn: 18,
            reason: 'Arc overdue but awkward.',
            awkwardDeferrals: 1
        }
    }), {
        decision: 'continue',
        confidence: 0.2,
        boundary_kind: 'other',
        awkward_intro_risk: 'high',
        reason: 'Still imperfect, but the arc is overdue.'
    }, settings(), 20);

    assert.equal(result.queued, true);
    assert.equal(result.queueReason, 'maximum_pressure_grace_expired');
    assert.ok(result.state.pendingIntro);
});

runTest('does not queue another intro for the active arc id', () => {
    const result = logic.applyArcDecision(baseState(), {
        decision: 'queue_new_arc',
        confidence: 0.92,
        arc_title: 'Opening Movement',
        arc_id: 'opening_arc',
        boundary_kind: 'quest',
        awkward_intro_risk: 'low',
        reason: 'The model repeated the current arc id.'
    }, settings(), 10);

    assert.equal(result.queued, false);
    assert.equal(result.queueReason, 'duplicate_arc');
});

runTest('plugin metadata hard-depends on arc_cinematics without reverse loader cycle', () => {
    assert.deepEqual(plugin.dependencies, ['arc_cinematics']);
    assert.equal(plugin.hooks.HOOK_PRE_WRITER.priority < 85, true);
});

runTestAsync('pre-writer announces pending intro to arc_cinematics and consumes it', async () => {
    const persisted = [];
    const calls = [];
    const turnContext = {
        projectName: 'Test',
        turnNumber: 12,
        runtime: { plugins: {} }
    };
    const previous = baseState({
        activeArc: { id: 'new_road', title: 'New Road', startTurn: 12 },
        pendingIntro: {
            arcId: 'new_road',
            title: 'New Road',
            targetTurn: 12,
            queuedAtTurn: 11,
            range: { startTurn: 1, endTurn: 11 }
        },
        updatedTurn: 11
    });
    const tools = {
        settings: { getSelf: () => ({ enabled: true }) },
        db: {
            chat: {
                query: async () => [{ fact_value: JSON.stringify(previous) }]
            }
        },
        facts: {
            appendToFactsDb: async fact => persisted.push(JSON.parse(fact.fact_value))
        },
        plugins: {
            tryCall: async (pluginId, fn, args) => {
                calls.push({ pluginId, fn, request: args[0] });
                turnContext.runtime.plugins.arc_cinematics = { request: args[0] };
                return { ok: true };
            }
        },
        logger: { log: () => {}, warn: () => {}, runtime: () => {} }
    };

    await logic.runPreWriter(turnContext, tools);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].pluginId, 'arc_cinematics');
    assert.equal(calls[0].fn, 'requestArcCinematic');
    assert.equal(calls[0].request.title, 'New Road');
    assert.equal(persisted[0].pendingIntro, null);
    assert.equal(persisted[0].lastIntroTurn, 12);
});

runTestAsync('pre-writer does not duplicate an existing arc_cinematics request', async () => {
    const calls = [];
    const turnContext = {
        projectName: 'Test',
        turnNumber: 12,
        runtime: { plugins: { arc_cinematics: { request: { arcId: 'existing' } } } }
    };
    const previous = baseState({
        pendingIntro: {
            arcId: 'new_road',
            title: 'New Road',
            targetTurn: 12,
            queuedAtTurn: 11,
            range: { startTurn: 1, endTurn: 11 }
        }
    });
    const tools = {
        settings: { getSelf: () => ({ enabled: true }) },
        db: { chat: { query: async () => [{ fact_value: JSON.stringify(previous) }] } },
        facts: { appendToFactsDb: async () => {} },
        plugins: { tryCall: async () => calls.push(true) },
        logger: { log: () => {}, warn: () => {}, runtime: () => {} }
    };

    await logic.runPreWriter(turnContext, tools);
    assert.equal(calls.length, 0);
});

runTestAsync('classification failure preserves state with non-fatal warning', async () => {
    const persisted = [];
    const previous = baseState({ updatedTurn: 9 });
    const turnContext = {
        projectName: 'Test',
        turnNumber: 10,
        input: { userPrompt: 'Continue.' },
        output: { summary: 'The party keeps walking.' },
        retrieveDatedChapters: async () => ({ synopsischapters: [], summarychapters: [], fullchapters: [] })
    };
    const tools = {
        settings: { getSelf: () => ({ enabled: true }) },
        db: { chat: { query: async () => [{ fact_value: JSON.stringify(previous) }] } },
        facts: { appendToFactsDb: async fact => persisted.push(JSON.parse(fact.fact_value)) },
        llm: {
            vnBackground: { isSelected: () => false },
            withSchema: async () => { throw new Error('model down'); }
        },
        project: { getChatPluginStorage: null },
        logger: { error: () => {}, warn: () => {}, runtime: () => {} }
    };

    const state = await logic.classifyAndPersistArcState(turnContext, tools, settings());

    assert.equal(state.activeArc.id, previous.activeArc.id);
    assert.equal(state.pendingIntro, null);
    assert.match(state.lastDecision.warning, /model down/);
    assert.equal(persisted.length, 1);
});
