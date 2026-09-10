const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    parseQuestLedgerLine,
    parseQuestLedgerText,
    mergeQuestRegistry,
    projectQuestRegistryForDialogue,
    projectObjectiveStateForDialogue,
    buildQuestLogModalHtml,
    buildQuestRenownSummary,
    getQuestScoreDetails,
    getQuestProgressBrief,
    getQuestImmediateReminderBrief,
    refreshQuestRegistryFromCanonical,
    buildQuestNotificationPayloads,
    registerQuestNotificationIntercepts,
    buildQuestNotificationIntercept,
    normalizeObjectiveState,
    hasMeaningfulState,
    buildPrompt
} = require('./logic.js');

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

const previousState = {
    last_completed: {
        id: 'recover-log',
        label: 'Recovered the calibration log',
        evidence: 'Turn 10: the party recovered the log.',
        completed_turn: 10
    },
    current_activity: {
        label: 'Resting at the inn',
        evidence: 'Turn 11: the party settled into the inn.'
    },
    active_goals: [
        {
            id: 'follow-log-clue',
            label: 'Follow the calibration log clue',
            status: 'active',
            evidence: 'Turn 10: the log points to a sealed site.',
            created_turn: 10,
            updated_turn: 10
        },
        {
            id: 'choose-route',
            label: 'Choose the morning route',
            status: 'pending',
            evidence: 'Turn 11: the party needs to decide where to go.',
            created_turn: 11,
            updated_turn: 11
        }
    ],
    operations: []
};

runTest('stable goals are preserved when the model keeps them', () => {
    const next = normalizeObjectiveState({
        current_activity: {
            label: 'Resting at the inn',
            evidence: 'Turn 12: the party remains at the inn.'
        },
        active_goals: [
            {
                id: 'follow-log-clue',
                label: 'Follow the calibration log clue',
                status: 'active',
                evidence: 'Still unresolved.',
                created_turn: 10,
                updated_turn: 12
            }
        ],
        operations: [{ type: 'keep', id: 'follow-log-clue', reason: 'Still unresolved.' }]
    }, previousState, { currentTurn: 12, maxActiveGoals: 3 });

    assert.strictEqual(next.active_goals.some(goal => goal.id === 'follow-log-clue'), true);
    assert.strictEqual(next.active_goals.some(goal => goal.id === 'choose-route'), true);
});

runTest('unsupported additions without evidence are rejected', () => {
    const next = normalizeObjectiveState({
        active_goals: [
            {
                id: 'invented-boss',
                label: 'Defeat the hidden boss',
                status: 'active',
                evidence: '',
                created_turn: 12,
                updated_turn: 12
            }
        ],
        operations: [{ type: 'add', id: 'invented-boss', reason: '' }]
    }, previousState, { currentTurn: 12, maxActiveGoals: 3 });

    assert.strictEqual(next.active_goals.some(goal => goal.id === 'invented-boss'), false);
    assert.strictEqual(next.active_goals.length, 2);
});

runTest('more than max goals are trimmed deterministically', () => {
    const next = normalizeObjectiveState({
        active_goals: [
            previousState.active_goals[0],
            previousState.active_goals[1],
            {
                id: 'buy-supplies',
                label: 'Buy supplies before leaving',
                status: 'active',
                evidence: 'Turn 12: Candace says they need supplies before leaving.',
                created_turn: 12,
                updated_turn: 12
            },
            {
                id: 'ask-guard',
                label: 'Ask the guard for directions',
                status: 'active',
                evidence: 'Turn 12: a guard offers directions.',
                created_turn: 12,
                updated_turn: 12
            }
        ]
    }, previousState, { currentTurn: 12, maxActiveGoals: 3 });

    assert.deepStrictEqual(next.active_goals.map(goal => goal.id), [
        'follow-log-clue',
        'choose-route',
        'buy-supplies'
    ]);
});

runTest('invalid model output falls back to previous state', () => {
    const next = normalizeObjectiveState('not json', previousState, { currentTurn: 12, maxActiveGoals: 3 });
    assert.deepStrictEqual(next.active_goals.map(goal => goal.id), ['follow-log-clue', 'choose-route']);
    assert.strictEqual(next.current_activity.label, 'Resting at the inn');
});

runTest('explicit completion removes the completed active goal', () => {
    const next = normalizeObjectiveState({
        last_completed: {
            id: 'choose-route',
            label: 'Chose the morning route',
            evidence: 'Turn 12: the party decides to leave for Sumeru City.',
            completed_turn: 12
        },
        active_goals: [
            previousState.active_goals[0]
        ],
        operations: [{ type: 'complete', id: 'choose-route', reason: 'The party picked the route.' }]
    }, previousState, { currentTurn: 12, maxActiveGoals: 3 });

    assert.strictEqual(next.last_completed.id, 'choose-route');
    assert.strictEqual(next.active_goals.some(goal => goal.id === 'choose-route'), false);
});

runTest('current activity can change while goals remain stable', () => {
    const next = normalizeObjectiveState({
        current_activity: {
            label: 'Leaving the inn for the market',
            evidence: 'Turn 12: the party steps out toward the market.'
        },
        active_goals: previousState.active_goals,
        operations: [{ type: 'update_current_activity', id: null, reason: 'The party leaves the inn.' }]
    }, previousState, { currentTurn: 12, maxActiveGoals: 3 });

    assert.strictEqual(next.current_activity.label, 'Leaving the inn for the market');
    assert.deepStrictEqual(next.active_goals.map(goal => goal.id), ['follow-log-clue', 'choose-route']);
});

runTest('empty states are hidden by HUD helpers', () => {
    assert.strictEqual(hasMeaningfulState({ active_goals: [] }), false);
    assert.strictEqual(hasMeaningfulState({ current_activity: { label: 'Waiting outside' } }), true);
});

runTest('objective prompt reads the private reasoning directive from its prompt file', () => {
    const prompt = buildPrompt({
        previousState: null,
        canonicalQuests: [],
        compressedHistory: 'None.',
        currentUserPrompt: 'Wait.',
        currentScript: '[Line 0] Narrator: Nothing changes.',
        maxActiveGoals: 3
    });

    assert.ok(prompt.includes('Reason privately in this order:'));
    assert.ok(prompt.includes('DEFAULT TO KEEP: Copy the previous state unless new evidence requires a change.'));
});

runTest('parses valid planner quest operations', () => {
    const quest = parseQuestLedgerLine('INSERT [QUEST-001] | Deadline: 2 turns | Stakes: high | Brief: Mira asks for help. | Objective: Help Mira resolve the promise | AI: The proof is hidden. | Fail: Mira withdraws. | Success: Mira helps later.', { turn_number: 7 });

    assert.strictEqual(quest.id, 'QUEST-001');
    assert.strictEqual(quest.deadline_turn, 10);
    assert.strictEqual(quest.deadline_turns, 3);
    assert.strictEqual(quest.stakes, 'high');
    assert.strictEqual(quest.objective, 'Help Mira resolve the promise');
    assert.strictEqual(quest.fail_consequence, 'Mira withdraws.');
});

runTest('rejects malformed planner quest operations', () => {
    assert.strictEqual(parseQuestLedgerLine('INSERT [QUEST-002] | Brief: Missing deadline'), null);
    assert.deepStrictEqual(parseQuestLedgerText('NO CHANGES REQUIRED'), []);
});

runTest('quest events resolve registry entries without exposing active quests in prompt brief', () => {
    const canonical = [parseQuestLedgerLine('INSERT [QUEST-001] | Deadline: 3 turns | Stakes: medium | Brief: Promise trouble. | Objective: Resolve the old promise | AI: Keep witness hidden. | Fail: Trust drops. | Success: Trust grows.', { turn_number: 4 })];
    const state = normalizeObjectiveState({
        quest_events: [
            {
                id: 'QUEST-001',
                status: 'completed',
                label: 'Resolved the old promise',
                evidence: 'Turn 5: Mira accepts the proof and forgives the party.',
                turn_number: 5,
                outcome_line_number: 8,
                outcome_line: '[Line 8] Mira: I accept the proof.'
            }
        ]
    }, null, { currentTurn: 5, questMap: new Map(canonical.map(quest => [quest.id, quest])) });
    const merged = mergeQuestRegistry(canonical, [], state, 5);

    assert.strictEqual(merged.registry[0].status, 'completed');
    assert.strictEqual(merged.events[0].consequence, 'Trust grows.');
    assert.strictEqual(merged.registry[0].outcome_line_number, 8);
    assert.strictEqual(merged.events[0].outcome_line, '[Line 8] Mira: I accept the proof.');
});

runTest('invalid quest event line metadata is safely ignored', () => {
    const canonical = [parseQuestLedgerLine('INSERT [QUEST-002] | Deadline: 3 turns | Stakes: low | Brief: Help Mira. | Objective: Help Mira decide | AI: Watch for proof. | Fail: Mira cools off. | Success: Mira smiles.', { turn_number: 4 })];
    const state = normalizeObjectiveState({
        quest_events: [
            {
                id: 'QUEST-002',
                status: 'completed',
                label: 'Helped Mira decide',
                evidence: 'Turn 5: Mira decides after hearing the party.',
                turn_number: 5,
                outcome_line_number: 'not-a-line'
            }
        ]
    }, null, { currentTurn: 5, questMap: new Map(canonical.map(quest => [quest.id, quest])) });
    const merged = mergeQuestRegistry(canonical, [], state, 5);

    assert.strictEqual(merged.registry[0].status, 'completed');
    assert.strictEqual(merged.registry[0].outcome_line_number, null);
});

runTest('quest registry projection gates current-turn completions by dialogue line', () => {
    const registry = [
        {
            id: 'QUEST-GATED',
            objective: 'Collect the brocade',
            brief: 'The commission is ready.',
            stakes: 'low',
            status: 'completed',
            created_turn: 70,
            updated_turn: 70,
            deadline_turn: 75,
            deadline_turns: 5,
            evidence: 'Planner objective updated on Turn 70.',
            outcome_turn: 70,
            outcome_line_number: 4,
            outcome_line: '[Line 4] Chiori: Here is the brocade.',
            outcome_evidence: 'Turn 70 Line 4: Chiori hands over the brocade.',
            success_summary: 'Chiori handed over the brocade.'
        }
    ];

    const before = projectQuestRegistryForDialogue(registry, { turnNumber: 70, dialogueIndex: 3 });
    assert.strictEqual(before.registry[0].status, 'active');
    assert.strictEqual(before.registry[0].display_pending_resolution, true);
    assert.strictEqual(before.pendingNotifications.length, 0);

    const after = projectQuestRegistryForDialogue(registry, { turnNumber: 70, dialogueIndex: 4 });
    assert.strictEqual(after.registry[0].status, 'completed');
    assert.strictEqual(after.pendingNotifications.length, 1);
    assert.strictEqual(after.pendingNotifications[0].outcomeLineNumber, 4);

    const later = projectQuestRegistryForDialogue(registry, { turnNumber: 70, dialogueIndex: 5 });
    assert.strictEqual(later.registry[0].status, 'completed');
    assert.strictEqual(later.pendingNotifications.length, 0);
});

runTest('quest registry projection always shows prior-turn resolved quests', () => {
    const registry = [
        {
            id: 'QUEST-OLD',
            objective: 'Win yesterday',
            brief: 'Already done.',
            stakes: 'medium',
            status: 'completed',
            created_turn: 68,
            updated_turn: 68,
            deadline_turn: 72,
            deadline_turns: 4,
            outcome_turn: 69,
            outcome_line_number: 9,
            outcome_evidence: 'Turn 69 Line 9: done.'
        }
    ];
    const projected = projectQuestRegistryForDialogue(registry, { turnNumber: 70, dialogueIndex: 0 });

    assert.strictEqual(projected.registry[0].status, 'completed');
    assert.strictEqual(projected.pendingNotifications.length, 0);
});

runTest('objective state projection hides current-turn completion before its dialogue line', () => {
    const state = {
        last_completed: {
            id: 'QUEST-GATED',
            label: 'Collected the brocade',
            evidence: 'Line 4: Chiori gives over the brocade.',
            completed_turn: 70,
            outcome_line_number: 4,
            outcome_line: '[Line 4] Chiori: Here is the brocade.'
        },
        current_activity: {
            label: 'Waiting at the boutique',
            evidence: 'Line 2: still waiting.'
        },
        active_goals: []
    };

    assert.strictEqual(projectObjectiveStateForDialogue(state, { turnNumber: 70, dialogueIndex: 3 }).last_completed, null);
    assert.strictEqual(projectObjectiveStateForDialogue(state, { turnNumber: 70, dialogueIndex: 4 }).last_completed.label, 'Collected the brocade');
    assert.strictEqual(projectObjectiveStateForDialogue(state, { turnNumber: 71, dialogueIndex: 0 }).last_completed.label, 'Collected the brocade');
});

runTest('deadline expiration records failure consequence', () => {
    const canonical = [parseQuestLedgerLine('INSERT [QUEST-009] | Deadline: 1 turns | Stakes: high | Brief: Deliver medicine. | Objective: Deliver medicine in time | AI: Do not fake success. | Fail: The patient worsens. | Success: The patient stabilizes.', { turn_number: 2 })];
    const merged = mergeQuestRegistry(canonical, [], { active_goals: [] }, 6);

    assert.strictEqual(merged.registry[0].status, 'expired');
    assert.strictEqual(merged.registry[0].deadline_turn, 5);
    assert.strictEqual(merged.events[0].status, 'expired');
    assert.strictEqual(merged.events[0].consequence, 'The patient worsens.');
    assert.strictEqual(merged.events[0].outcome_line_number, 0);
});

runTest('quest scoring uses base stakes and clamps LLM modifiers', () => {
    const highWin = getQuestScoreDetails({
        id: 'QUEST-HIGH',
        status: 'completed',
        stakes: 'high',
        score_modifier: 999
    });
    const mediumFail = getQuestScoreDetails({
        id: 'QUEST-FAIL',
        status: 'failed',
        stakes: 'medium',
        score_modifier: -999
    });
    const invalidModifier = getQuestScoreDetails({
        id: 'QUEST-LOW',
        status: 'completed',
        stakes: 'low',
        score_modifier: 'not a number'
    });

    assert.strictEqual(highWin.basePoints, 50);
    assert.strictEqual(highWin.modifierPoints, 15);
    assert.strictEqual(highWin.totalPoints, 65);
    assert.strictEqual(mediumFail.totalPoints, -25);
    assert.strictEqual(invalidModifier.totalPoints, 10);
});

runTest('quest renown summary is turn-bounded and computes titles', () => {
    const summary = buildQuestRenownSummary([
        {
            id: 'QUEST-LOW',
            objective: 'Finish the small promise',
            status: 'completed',
            stakes: 'low',
            updated_turn: 4,
            deadline_turn: 7,
            outcome_turn: 5,
            outcome_evidence: 'Turn 5: done.'
        },
        {
            id: 'QUEST-FUTURE',
            objective: 'Win the future duel',
            status: 'completed',
            stakes: 'high',
            score_modifier: 15,
            updated_turn: 11,
            deadline_turn: 14,
            outcome_turn: 12,
            outcome_evidence: 'Turn 12: won.'
        }
    ], { turnNumber: 10 });

    assert.strictEqual(summary.totalPoints, 10);
    assert.strictEqual(summary.title, 'Wandering Errand-Taker');
    assert.strictEqual(summary.stats.completed, 1);
    assert.strictEqual(summary.stats.currentSuccessStreak, 1);
    assert.strictEqual(summary.scoreById.has('QUEST-FUTURE'), false);
});

runTest('quest renown summary tracks failures and higher titles', () => {
    const summary = buildQuestRenownSummary([
        {
            id: 'QUEST-HIGH',
            objective: 'Win the high-stakes duel',
            status: 'completed',
            stakes: 'high',
            score_modifier: 10,
            updated_turn: 3,
            deadline_turn: 7,
            outcome_turn: 4,
            outcome_evidence: 'Turn 4: won.'
        },
        {
            id: 'QUEST-MED',
            objective: 'Resolve the promise',
            status: 'completed',
            stakes: 'medium',
            updated_turn: 5,
            deadline_turn: 8,
            outcome_turn: 6,
            outcome_evidence: 'Turn 6: resolved.'
        },
        {
            id: 'QUEST-FAIL',
            objective: 'Keep the appointment',
            status: 'expired',
            stakes: 'low',
            updated_turn: 6,
            deadline_turn: 9,
            outcome_turn: 10,
            outcome_evidence: 'Turn 10: missed.'
        }
    ], { turnNumber: 10 });

    assert.strictEqual(summary.totalPoints, 80);
    assert.strictEqual(summary.title, 'Proven Hand');
    assert.strictEqual(summary.stats.completed, 2);
    assert.strictEqual(summary.stats.expired, 1);
    assert.strictEqual(summary.stats.currentSuccessStreak, 0);
    assert.strictEqual(summary.stats.highStakesCompletions, 1);
});

runTest('quest log modal escapes text and hides hidden planner guidance', () => {
    const longObjective = 'Stay present with Dehya through her confession without pushing for a clean resolution, then let her choose the shape of the road home in her own time';
    const longSpoiler = 'The confession will come out wrong at first, and Dehya needs space to correct herself without the player forcing a clean ending. '.repeat(6).trim();
    const html = buildQuestLogModalHtml([
        {
            id: 'QUEST-HTML',
            objective: longObjective + ' <Mira>',
            brief: 'Find the signed note.',
            hidden_ai_guidance: longSpoiler,
            fail_consequence: 'Secret fail.',
            success_consequence: longSpoiler,
            stakes: 'low',
            status: 'active',
            created_turn: 1,
            updated_turn: 2,
            deadline_turn: 6,
            deadline_turns: 3,
            evidence: 'Mira asked for help.'
        },
        {
            id: 'QUEST-DONE',
            objective: 'Resolve Mira&apos;s promise',
            brief: 'Help Mira choose what comes next.',
            hidden_ai_guidance: 'Secret culprit is here too.',
            fail_consequence: 'Secret resolved fail.',
            success_consequence: 'Secret resolved success.',
            stakes: 'medium',
            status: 'completed',
            created_turn: 1,
            updated_turn: 3,
            deadline_turn: 6,
            deadline_turns: 3,
            evidence: 'Mira asked for closure.',
            outcome_evidence: 'Turn 3: Mira accepts the answer.',
            outcome_turn: 3,
            outcome_consequence: 'Mira trusts the party enough to help again.',
            success_summary: 'Mira accepted the proof and chose to trust the party.',
            score_modifier: 99,
            score_reason: '<Heroic> resolution with emotional payoff.'
        }
    ], { turnNumber: 3 });

    assert.match(html, /Stay present with Dehya through her confession without pushing for a clean resolution, then let her choose the shape of the road home in her own time &lt;Mira&gt;/);
    assert.doesNotMatch(html, /shape of the road home in her own\.\.\./);
    assert.match(html, /Low Stakes/);
    assert.match(html, /3 Turns Left/);
    assert.match(html, /Quest Renown/);
    assert.match(html, /Roadside Helper/);
    assert.match(html, /\+35 Renown/);
    assert.match(html, /Show All Spoilers/);
    assert.match(html, /Show Spoilers/);
    assert.match(html, /data-quest-spoiler-card/);
    assert.match(html, /data-quest-filter="active">Active/);
    assert.doesNotMatch(html, /class="is-active" data-quest-filter="all"/);
    assert.match(html, /How it succeeded/);
    assert.match(html, /Mira accepted the proof/);
    assert.match(html, /&lt;Heroic&gt; resolution/);
    assert.match(html, /Mira trusts the party enough to help again/);
    assert.doesNotMatch(html, /Deadline Turn 4/);
    assert.match(html, /hidden><p><strong>AI<\/strong>The confession will come out wrong at first/);
    assert.match(html, /without the player forcing a clean ending\. The confession will come out wrong at first/);
    assert.doesNotMatch(html, /without the player forcing a clean ending\.\.\./);
    assert.match(html, /<strong>Success<\/strong>Secret resolved success/);
    assert.match(html, /data-quest-filter="completed"/);
});

runTest('quest line gating prompt and Pixi notification frontend contracts are present', () => {
    const prompt = fs.readFileSync(path.join(__dirname, 'prompts', 'objective_tracker_prompt.txt'), 'utf8');
    const uiJs = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    const uiCss = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');
    const pixiJs = fs.readFileSync(path.join(__dirname, 'pixi_quest_notification.js'), 'utf8');

    assert.match(prompt, /outcome_line_number/);
    assert.match(prompt, /zero-based `\[Line N\]`/);
    assert.doesNotMatch(uiJs, /quest-tracker-notification-root/);
    assert.doesNotMatch(uiJs, /sessionStorage/);
    assert.match(uiCss, /\.quest-log-grid\s*\{[\s\S]*align-items:\s*start/);
    assert.match(uiCss, /\.quest-log-card\s*\{[\s\S]*align-content:\s*start/);
    assert.match(pixiJs, /bridgeTakeover\.finish/);
    assert.match(pixiJs, /sfx:play/);
});

runTest('quest notification payloads target only current-turn resolved quests', () => {
    const payloads = buildQuestNotificationPayloads([
        {
            id: 'QUEST-DONE',
            objective: 'Return the letter',
            brief: 'Letter work.',
            status: 'completed',
            stakes: 'medium',
            updated_turn: 12,
            outcome_turn: 12,
            outcome_line_number: 5,
            outcome_evidence: 'Turn 12 Line 5: letter returned.',
            success_summary: 'The letter reached its owner.'
        },
        {
            id: 'QUEST-OLD',
            objective: 'Old work',
            status: 'completed',
            updated_turn: 10,
            outcome_turn: 10,
            outcome_line_number: 1
        }
    ], { turnNumber: 12, durationMs: 3200, sfx: 'ding.mp3' });

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].notificationId, 'quest_notification_12_quest-done_completed_5');
    assert.strictEqual(payloads[0].title, 'Quest Complete');
    assert.strictEqual(payloads[0].durationMs, 3200);
    assert.strictEqual(payloads[0].sfx, 'ding.mp3');

    const defaultSfx = buildQuestNotificationPayloads([
        {
            id: 'QUEST-DEFAULT-SFX',
            objective: 'Play the jingle',
            status: 'completed',
            stakes: 'low',
            updated_turn: 12,
            outcome_turn: 12,
            outcome_line_number: 2
        }
    ], { turnNumber: 12 });
    assert.strictEqual(defaultSfx[0].sfx, 'success_jingle.wav');
});

runTest('quest notification intercept registration line-gates and dedupes descriptors', () => {
    const descriptors = [];
    const turnContext = { turnNumber: 12, output: { guiIntercepts: [] } };
    const tools = {
        gui: {
            registerPersistentIntercept: descriptor => {
                descriptors.push(descriptor);
                turnContext.output.guiIntercepts.push(descriptor);
                return descriptor;
            }
        },
        logger: { runtime: () => {} }
    };
    const registry = [
        {
            id: 'QUEST-DONE',
            objective: 'Return the letter',
            status: 'completed',
            stakes: 'medium',
            updated_turn: 12,
            outcome_turn: 12,
            outcome_line_number: 5,
            outcome_evidence: 'Turn 12 Line 5: letter returned.'
        }
    ];

    registerQuestNotificationIntercepts(turnContext, tools, registry, {
        quest_notification_duration_ms: 3200
    });
    registerQuestNotificationIntercepts(turnContext, tools, registry, {
        quest_notification_duration_ms: 3200
    });

    assert.strictEqual(descriptors.length, 1);
    assert.strictEqual(descriptors[0].renderer, 'pixi');
    assert.strictEqual(descriptors[0].blocking, false);
    assert.strictEqual(descriptors[0].preserveOnDialogueEnter, true);
    assert.strictEqual(descriptors[0].autoDismiss, true);
    assert.strictEqual(descriptors[0].checkpoint, 'on_dialogue_enter');
    assert.strictEqual(descriptors[0].dialogueIndex, 5);
    assert.strictEqual(descriptors[0].replayPolicy, 'every_enter');
    assert.strictEqual(descriptors[0].handlerRef, 'guiIntercepts.quest_notification');
});

runTest('quest notification intercept without line plays before first dialogue', () => {
    const descriptors = [];
    const turnContext = { turnNumber: 12, output: { guiIntercepts: [] } };
    const tools = {
        gui: {
            registerPersistentIntercept: descriptor => {
                descriptors.push(descriptor);
                return descriptor;
            }
        },
        logger: { runtime: () => {} }
    };

    registerQuestNotificationIntercepts(turnContext, tools, [
        {
            id: 'QUEST-DONE',
            objective: 'Return the letter',
            status: 'completed',
            stakes: 'medium',
            updated_turn: 12,
            outcome_turn: 12,
            outcome_line_number: null
        }
    ], {});

    assert.strictEqual(descriptors.length, 1);
    assert.strictEqual(descriptors[0].checkpoint, 'before_first_dialogue');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(descriptors[0], 'dialogueIndex'), false);
});

(async () => {
    await runTestAsync('quest notification builder returns Pixi UI payload', async () => {
        const payload = await buildQuestNotificationIntercept({}, {}, {
            payload: {
                notificationId: 'quest_notification_test',
                title: 'Quest Complete',
                label: 'Return the letter'
            }
        });

        assert.strictEqual(payload.renderer, 'pixi');
        assert.strictEqual(payload.autoDismiss, true);
        assert.strictEqual(payload.payload.notificationId, 'quest_notification_test');
        assert.match(payload.js, /QuestTrackerNotification/);
    });

    await runTestAsync('refreshes quest registry directly from canonical quest ledger rows', async () => {
        const appended = [];
        const tools = {
            pluginState: {
                turn: () => ({})
            },
            db: {
                chat: {
                    query: async (sql, params) => {
                        if (String(sql).includes("predicate = 'LEDGER_ENTRY'")) {
                            return [
                                {
                                    target: 'QUEST-LEDGER',
                                    fact_value: '| Deadline: 2 turns | Stakes: medium | Brief: Help Mira. | Objective: Help Mira resolve the promise | AI: Keep the witness hidden. | Fail: Mira withdraws. | Success: Mira helps later.',
                                    turn_number: 7,
                                    context: null,
                                    source: 'quest_tracker'
                                }
                            ];
                        }
                        if (params?.[2] === 'quest_registry') return [];
                        return [];
                    }
                }
            },
            facts: {
                cleanUpFactsDb: async () => {},
                appendToFactsDb: async row => appended.push(row)
            }
        };

        const result = await refreshQuestRegistryFromCanonical({ projectName: 'Test', turnNumber: 7 }, tools, { turnNumber: 7 });

        assert.strictEqual(result.registry.length, 1);
        assert.strictEqual(result.registry[0].id, 'QUEST-LEDGER');
        assert.strictEqual(result.registry[0].deadline_turn, 10);
        assert.strictEqual(result.registry[0].stakes, 'medium');
        assert.strictEqual(appended.some(row => row.predicate === 'quest_registry'), true);
    });

    await runTestAsync('progress brief includes resolved outcomes only', async () => {
        const tools = {
            db: {
                chat: {
                    query: async () => [
                        {
                            target: 'QUEST-001',
                            turn_number: 8,
                            context: 'completed',
                            fact_value: JSON.stringify({
                                id: 'QUEST-001',
                                status: 'completed',
                                label: 'Resolved the promise',
                                evidence: 'Turn 8: the promise is resolved.',
                                consequence: 'Mira trusts the party.',
                                turn_number: 8
                            })
                        }
                    ]
                }
            }
        };
        const brief = await getQuestProgressBrief({ projectName: 'Test', turnNumber: 9 }, tools);

        assert.match(brief, /QUEST OUTCOME CONSEQUENCES - HIGH PRIORITY/);
        assert.match(brief, /On chapter 8, the player\/party succeeded at "Resolved the promise"/);
        assert.match(brief, /Mira trusts the party/);
        assert.doesNotMatch(brief, /active quest/i);
    });

    await runTestAsync('progress brief only includes outcomes inside the consequence window', async () => {
        const rows = [
            {
                target: 'QUEST-OLD',
                turn_number: 5,
                context: 'failed',
                fact_value: JSON.stringify({
                    id: 'QUEST-OLD',
                    status: 'failed',
                    label: 'Missed the old appointment',
                    evidence: 'Turn 5: the appointment was missed.',
                    consequence: 'Old pressure should be gone.',
                    turn_number: 5
                })
            },
            {
                target: 'QUEST-RECENT',
                turn_number: 8,
                context: 'expired',
                fact_value: JSON.stringify({
                    id: 'QUEST-RECENT',
                    status: 'expired',
                    label: 'Deliver the medicine',
                    evidence: 'Turn 8: the medicine deadline passed.',
                    consequence: 'The patient worsens.',
                    turn_number: 8
                })
            }
        ];
        const tools = {
            db: {
                chat: {
                    query: async (_sql, params) => {
                        const maxTurn = params[3];
                        const minTurn = params.length === 6 ? params[4] : 1;
                        const limit = params[params.length - 1];
                        return rows
                            .filter(row => row.turn_number >= minTurn && row.turn_number <= maxTurn)
                            .sort((a, b) => b.turn_number - a.turn_number)
                            .slice(0, limit);
                    }
                }
            }
        };
        const brief = await getQuestProgressBrief({ projectName: 'Test', turnNumber: 10 }, tools, { maxAgeTurns: 4 });

        assert.match(brief, /Deliver the medicine/);
        assert.match(brief, /Keep this pressure through chapter 12/);
        assert.match(brief, /The patient worsens/);
        assert.doesNotMatch(brief, /Old pressure should be gone/);
    });

    await runTestAsync('immediate reminder only appears on the first prompt after resolution', async () => {
        const rows = [
            {
                target: 'QUEST-001',
                turn_number: 8,
                context: 'completed',
                fact_value: JSON.stringify({
                    id: 'QUEST-001',
                    status: 'completed',
                    label: 'Resolved the promise',
                    evidence: 'Turn 8: the promise is resolved.',
                    consequence: 'Mira trusts the party.',
                    turn_number: 8
                })
            },
            {
                target: 'QUEST-OLDER',
                turn_number: 7,
                context: 'failed',
                fact_value: JSON.stringify({
                    id: 'QUEST-OLDER',
                    status: 'failed',
                    label: 'Ignored the warning',
                    evidence: 'Turn 7: the warning was ignored.',
                    consequence: 'Older pressure should not be urgent.',
                    turn_number: 7
                })
            }
        ];
        const tools = {
            db: {
                chat: {
                    query: async (_sql, params) => {
                        const maxTurn = params[3];
                        const minTurn = params.length === 6 ? params[4] : 1;
                        return rows.filter(row => row.turn_number >= minTurn && row.turn_number <= maxTurn);
                    }
                }
            }
        };

        const immediate = await getQuestImmediateReminderBrief({ projectName: 'Test', turnNumber: 9 }, tools);
        const expired = await getQuestImmediateReminderBrief({ projectName: 'Test', turnNumber: 10 }, tools);

        assert.match(immediate, /STORY QUEST JUST RESOLVED - ACT NOW/);
        assert.match(immediate, /Mira trusts the party/);
        assert.doesNotMatch(immediate, /Older pressure should not be urgent/);
        assert.strictEqual(expired, '');
    });
})();
