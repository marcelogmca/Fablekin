const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    deriveD20Target,
    resolveRollOutcome,
    normalizeOption,
    shouldOfferAdventureBook,
    runDirectorPrePrompt,
    runPostVnGeneration,
    startChallengeSocket,
    rollChallengeSocket,
    rebuildChallengeSocket,
    generateCgSocket,
    advanceChallengeSocket,
    finalizeChallengeSocket,
    START_EVENT,
    ROLL_EVENT,
    ADVANCE_EVENT,
    REBUILD_EVENT,
    CG_EVENT,
    FINALIZE_EVENT,
    PLUGIN_ID
} = require('./logic.js');
const logic = require('./logic.js');

test.beforeEach(() => {
    logic._private.clearActiveSessionsForTests();
});

const LONG_STORY = [
    'John stood where the river broke the road, the cold water worrying at the stones like teeth. The far bank was close enough to see and too far to trust.',
    '"That current is lying," he said. "It wants us to think the middle is shallow." Candace crouched beside him and dipped a branch into the foam. The branch vanished, snapped, and came back as splinters.',
    'The old crossing markers leaned downstream, each one carved with the same warning notch. Someone had used this path before, but not recently, and not without losing something to it.',
    'A gust carried river mist over the party. The map said the ford would save half a day. The river said the map was old.',
    'Then the bell on the far bank rang once, though no hand touched it. John saw a rope under the water pull tight, and the choice narrowed before anyone could pretend it had not.'
].join('\n\n');

test('d20 target derives from visible odds', () => {
    assert.equal(deriveD20Target(80), 5);
    assert.equal(deriveD20Target(50), 11);
    assert.equal(deriveD20Target(20), 17);
});

test('natural 1 and natural 20 override normal target math', () => {
    const easy = normalizeOption({ label: 'Leap', successChance: 95 }, 0, ['John']);
    const hard = normalizeOption({ label: 'Read runes', successChance: 5 }, 0, ['John']);

    assert.equal(resolveRollOutcome(easy, 1), 'critical_failure');
    assert.equal(resolveRollOutcome(hard, 20), 'critical_success');
    assert.equal(resolveRollOutcome(easy, 2), 'success');
    assert.equal(resolveRollOutcome(easy, 14), 'success');
    assert.equal(resolveRollOutcome(hard, 19), 'failure');
});

test('server d20 roller stays within die bounds', () => {
    const { rollD20 } = logic._private;
    for (let i = 0; i < 100; i += 1) {
        const roll = rollD20();
        assert.ok(Number.isInteger(roll));
        assert.ok(roll >= 1);
        assert.ok(roll <= 20);
    }
});

test('option normalization clamps chance and fills d20 target', () => {
    const option = normalizeOption({
        label: 'Throw the rock',
        successChance: 500,
        helperCharacters: ['Mira', '', '  Sol  ']
    }, 0, ['John']);

    assert.equal(option.optionKey, 'throw_the_rock');
    assert.equal(option.successChance, 95);
    assert.equal(option.d20Target, 2);
    assert.deepEqual(option.helperCharacters, ['Mira', 'Sol']);
});

test('automatic and check options use the new resolution contract', () => {
    assert.equal(logic._private.OPTION_SCHEMA.properties.outcomeTiers.properties, undefined);
    const automatic = normalizeOption({
        label: 'Open the door plainly',
        resolutionType: 'automatic',
        automaticOutcome: 'The party hears the woman out without gaining hidden leverage.'
    }, 0, ['Dehya']);
    assert.equal(automatic.resolutionType, 'automatic');
    assert.equal(automatic.successChance, 100);
    assert.equal(automatic.d20Target, null);
    assert.equal(resolveRollOutcome(automatic, 1), 'automatic');
    assert.match(automatic.automaticOutcome, /without gaining hidden leverage/);

    const check = normalizeOption({
        label: 'Slip out the window',
        resolutionType: 'check',
        d20Target: 15,
        checkType: 'Stealth',
        difficultyReason: 'The courtyard gravel is loud and someone may already be watching the well.',
        outcomeTiers: {
            criticalFailure: 'The character crashes down and alerts the watcher.',
            failure: 'The character reaches the yard but is seen.',
            success: 'The character reaches the well unseen.',
            criticalSuccess: 'The character reaches the well and spots the watcher first.'
        }
    }, 1, ['Dehya']);
    assert.equal(check.resolutionType, 'check');
    assert.equal(check.d20Target, 15);
    assert.equal(check.successChance, 30);
    assert.equal(check.checkType, 'Stealth');
    assert.equal(resolveRollOutcome(check, 14), 'failure');
    assert.equal(resolveRollOutcome(check, 15), 'success');
    assert.equal(resolveRollOutcome(check, 20), 'critical_success');
});

function seededRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function sequenceRng(values) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
}

test('choice contract creates varied difficulty and pacing instructions', () => {
    const { buildChoiceContract } = logic._private;
    const normal = buildChoiceContract({ stepIndex: 1, maxSteps: 4, rng: sequenceRng([0.1, 0.1, 0.9, 0.3, 0.4]) });
    assert.equal(normal.totalChoices, 3);
    assert.equal(normal.optionBlueprints.length, 3);
    assert.equal(normal.checkChoicesRequired, normal.totalChoices - normal.automaticChoicesRequired);
    assert.ok(normal.characterStrengthChoicesRequired <= normal.checkChoicesRequired);
    assert.equal(normal.pacing, 'opening');
    assert.match(normal.pacingInstruction, /Open a bounded local complication/);
    assert.ok(normal.optionBlueprints.some(option => option.characterStrengthRequired === true));
    assert.ok(normal.optionBlueprints.some(option => option.difficultyBand === 'easy'));

    const seenBands = new Set();
    for (let seed = 1; seed <= 12; seed += 1) {
        const contract = buildChoiceContract({ stepIndex: 2, maxSteps: 5, failurePressure: 1, rng: seededRng(seed) });
        contract.difficultyBands.forEach(band => seenBands.add(band));
    }
    assert.ok(seenBands.has('easy'));
    assert.ok(seenBands.has('standard'));
    assert.ok(seenBands.has('hard'));
    assert.ok(seenBands.has('desperate'));
});

test('choice contract gives impossible options priority over certain options', () => {
    const { buildChoiceContract } = logic._private;
    const contract = buildChoiceContract({ stepIndex: 2, maxSteps: 5, failurePressure: 1, rng: sequenceRng([0.99, 0.99, 0.99, 0.1]) });

    assert.equal(contract.totalChoices, 3);
    assert.equal(contract.impossibleChoicesRequired, 3);
    assert.equal(contract.automaticChoicesRequired, 0);
    assert.equal(contract.checkChoicesRequired, 3);
    assert.equal(contract.possibleCheckChoicesRequired, 0);
    assert.equal(contract.characterStrengthChoicesRequired, 0);
    assert.equal(contract.optionBlueprints.length, 3);
    assert.ok(contract.optionBlueprints.every(option => option.difficultyBand === 'impossible'));
    assert.ok(contract.optionBlueprints.every(option => option.forcedD20Target === 21));
    assert.match(contract.impossibleRule, /always fail/i);
});

test('choice contract escalates under pressure and resolves on final chapter', () => {
    const { buildChoiceContract } = logic._private;
    const lowPressure = buildChoiceContract({ stepIndex: 2, maxSteps: 5, failurePressure: 0, criticalFailures: 0, rng: sequenceRng([0.1, 0.7, 0.1]) });
    const highPressure = buildChoiceContract({ stepIndex: 2, maxSteps: 5, failurePressure: 2, criticalFailures: 1, rng: sequenceRng([0.7, 0.7, 0.1]) });
    assert.ok(highPressure.automaticChoicesRequired <= lowPressure.automaticChoicesRequired);
    assert.ok(highPressure.impossibleChoicesRequired >= lowPressure.impossibleChoicesRequired);
    assert.equal(highPressure.pressureLevel, 'high');
    assert.equal(highPressure.pacing, 'narrow');

    const penultimate = buildChoiceContract({ stepIndex: 4, maxSteps: 5, rng: sequenceRng([0.9, 0.9, 0.1]) });
    assert.equal(penultimate.pacing, 'final_handoff');
    assert.match(penultimate.pacingInstruction, /only one chapter after this/i);

    const final = buildChoiceContract({ stepIndex: 5, maxSteps: 5, rng: sequenceRng([0.9, 0.9, 0.1]) });
    assert.equal(final.pacing, 'resolve_now');
    assert.equal(final.shouldResolveNow, true);
    assert.equal(final.optionBlueprints.length, 0);
    assert.match(final.pacingInstruction, /final Adventure Book chapter/i);
});

test('impossible options are visible 21+ checks that cannot succeed', () => {
    const impossible = normalizeOption({
        label: 'Leap across the canyon in one jump',
        resolutionType: 'check',
        d20Target: 21,
        checkType: 'Athletics',
        difficultyBand: 'impossible',
        safetyProfile: 'impossible',
        expectedImpact: 'catastrophic',
        outcomeTiers: {
            criticalFailure: 'The attempt goes disastrously wrong.',
            failure: 'The attempt fails before it truly begins.',
            success: 'Impossible under current circumstances.',
            criticalSuccess: 'Impossible under current circumstances.'
        }
    }, 0, ['Dehya']);

    assert.equal(impossible.d20Target, 21);
    assert.equal(impossible.successChance, 0);
    assert.equal(resolveRollOutcome(impossible, 1), 'critical_failure');
    assert.equal(resolveRollOutcome(impossible, 20), 'failure');
});

test('story pagination creates deterministic readable pages', () => {
    const { paginateStoryText, isStoryTooCloseToSource } = logic._private;
    const story = Array.from({ length: 16 }, (_, index) => `Paragraph ${index + 1} carries the chapter forward with a concrete detail, a reaction, and a little pressure on the party.`).join('\n\n');
    const pages = paginateStoryText(story, { targetChars: 420, maxPages: 8 });

    assert.ok(pages.length >= 2);
    assert.ok(pages.length <= 8);
    assert.match(pages[0], /Paragraph 1/);
    assert.match(pages.at(-1), /Paragraph/);
    assert.deepEqual(pages, paginateStoryText(story, { targetChars: 420, maxPages: 8 }));

    const shortPages = paginateStoryText('One short page.', { targetChars: 420 });
    assert.deepEqual(shortPages, ['One short page.']);
    assert.equal(isStoryTooCloseToSource(story, story), true);
    assert.equal(isStoryTooCloseToSource(LONG_STORY, story), false);
});

test('CG settings normalize like arc-style model tiers', async () => {
    const {
        normalizeCgModelTier,
        normalizeCgPromptMode,
        normalizeCgVisualStyle,
        isCgGenerationEnabled,
        maybeRequestCg,
        buildCgPromptForState,
        buildCgRequestForSessionState
    } = logic._private;
    assert.equal(normalizeCgModelTier('premium'), 'premium');
    assert.equal(normalizeCgModelTier('weird'), 'budget');
    assert.equal(normalizeCgPromptMode('llm_instruction_with_references'), 'llm_instruction_with_references');
    assert.equal(normalizeCgPromptMode('weird'), 'diffusion_positive');
    assert.equal(normalizeCgVisualStyle('sepia'), 'sepia');
    assert.equal(normalizeCgVisualStyle('theme_colors'), 'theme_colors');
    assert.equal(normalizeCgVisualStyle('black & white'), 'original');
    assert.equal(isCgGenerationEnabled({ prefer_cg: true, cg_model_tier: 'premium' }), true);
    assert.equal(isCgGenerationEnabled({ prefer_cg: true, cg_model_tier: 'none' }), false);
    assert.equal(isCgGenerationEnabled({ prefer_cg: true }), true);
    assert.equal(isCgGenerationEnabled({ prefer_cg: false }), false);

    const longStory = Array.from({ length: 80 }, (_, index) => `Scene detail ${index + 1}: the party crosses another tense landmark while the local challenge keeps pressure on their route.`).join('\n\n');
    const cgPrompt = buildCgPromptForState({
        title: 'The Long Road',
        mode: 'Journey',
        illustrationPrompt: 'A moonlit road with three travelers watching a lantern in the mist.',
        storyText: longStory,
        stakes: 'The party may arrive late, depleted, or carrying a useful local clue.'
    }, longStory);
    assert.ok(cgPrompt.length <= 2800);
    assert.match(cgPrompt, /Visual novel CG request/);
    assert.doesNotMatch(cgPrompt, /Scene detail 80/);

    const calls = [];
    const cgStorageRoot = path.join(__dirname, '.tmp', `adventure_book_cg_settings_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const bookState = {
        status: 'active',
        currentChapterIndex: 1,
        settings: { prefer_cg: true, cg_model_tier: 'standard' },
        currentState: {
            title: 'River Bell',
            mode: 'Journey',
            illustrationPrompt: 'Travelers at a dangerous river crossing.',
            storyText: LONG_STORY,
            stakes: 'The party can lose time or gain a safer route.'
        }
    };
    bookState.state = bookState.currentState;
    const result = await maybeRequestCg(bookState, {
        project: {
            getChatPluginStorage: () => ({
                absolutePath: cgStorageRoot,
                relativePath: 'plugins/Main/12/adventure_book',
                chatName: 'Main',
                turnNumber: 12,
                storageTurnKey: '12'
            })
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async (pluginId, exportName, args) => {
                calls.push({ pluginId, exportName, request: args[0] });
                return { ok: true, outputPath: 'cg_exports/adventure.webp' };
            }
        },
        llm: {
            withSchema: async () => {
                throw new Error('Adventure Book default CG should not use an LLM prompt compiler.');
            }
        },
        logger: { info: () => {}, warn: () => {} }
    }, 'A transcript closes.');
    try { fs.rmSync(cgStorageRoot, { recursive: true, force: true }); } catch (_) {}

    assert.equal(result.ok, true);
    assert.equal(calls[0].pluginId, 'cg_generator');
    assert.equal(calls[0].exportName, 'requestCustomCGToFile');
    assert.equal(calls[0].request.modelTier, 'standard');
    assert.match(calls[0].request.outputPath, /^plugins\/Main\/12\/adventure_book\/cg_chapter_1_[a-f0-9]{24}\.webp$/);
    assert.equal(calls[0].request.filePrefix, 'adventure_book_chapter_1');
    assert.equal(calls[0].request.aspectRatio, '2:3');
    assert.equal(calls[0].request.imageResolution, '1024x1536');
    assert.equal(calls[0].request.size, '1024x1536');
    assert.equal(calls[0].request.prompt, calls[0].request.text);
    assert.ok(calls[0].request.prompt.length <= 2800);
    assert.equal(result.promptHash.length, 24);

    const referencePlan = await buildCgRequestForSessionState({
        title: 'River Bell',
        mode: 'Journey',
        illustrationPrompt: 'Travelers at a dangerous river crossing.',
        storyText: LONG_STORY,
        stakes: 'The party can lose time or gain a safer route.',
        party: ['John']
    }, {
        cg_model_tier: 'premium',
        cg_prompt_mode: 'llm_instruction_with_references'
    }, {
        plugins: {
            isInstalled: pluginId => pluginId === 'arc_cinematics',
            tryCall: async (pluginId, exportName, args) => {
                assert.equal(pluginId, 'arc_cinematics');
                assert.equal(exportName, 'buildCgRequestForStanza');
                assert.equal(args[0].request.title, 'River Bell');
                return {
                    request: {
                        prompt: 'Arc-planned reference CG.',
                        modelTier: 'premium',
                        references: [{ name: 'John', path: 'assets/sprites/John/neutral.png' }]
                    },
                    prompt: 'Arc-planned reference CG.',
                    promptMode: 'llm_instruction_with_references',
                    promptSource: 'arc_cinematics',
                    references: [{ name: 'John', path: 'assets/sprites/John/neutral.png' }]
                };
            }
        }
    }, 'plugins/Main/12/adventure_book/cg.webp');
    assert.equal(referencePlan.promptMode, 'llm_instruction_with_references');
    assert.equal(referencePlan.request.modelTier, 'premium');
    assert.equal(referencePlan.request.references.length, 1);
    assert.deepEqual(referencePlan.request.references[0], {
        name: 'John',
        path: 'assets/sprites/John/neutral.png'
    });
});

test('eligibility requires explicit Adventure Book selection unless forced', () => {
    const base = {
        sceneMode: 'mainline',
        processed: {
            director: { scenePhase: 'INVESTIGATION', scenePluginId: null },
            scenePhaseClassifier: {}
        }
    };

    assert.equal(shouldOfferAdventureBook(base, { enabled: true }), false);
    assert.equal(shouldOfferAdventureBook({ ...base, sceneMode: 'interlude' }, { enabled: true }), false);
    assert.equal(shouldOfferAdventureBook(base, { enabled: false }), false);
    assert.equal(shouldOfferAdventureBook({
        sceneMode: 'mainline',
        processed: { director: { scenePhase: 'DIALOGUE' }, scenePhaseClassifier: {} }
    }, { enabled: true, force_offer_every_turn: true }), true);
    assert.equal(shouldOfferAdventureBook({
        sceneMode: 'interlude',
        processed: { director: { scenePhase: 'DIALOGUE' }, scenePhaseClassifier: {} }
    }, { enabled: true, force_offer_every_turn: true }), false);
    assert.equal(shouldOfferAdventureBook({
        ...base,
        processed: { director: { scenePhase: 'INVESTIGATION', scenePluginId: 'camp_rest_interludes' }, scenePhaseClassifier: {} }
    }, { enabled: true }), false);
    assert.equal(shouldOfferAdventureBook({
        sceneMode: 'mainline',
        processed: { director: { scenePhase: 'DIALOGUE', scenePluginId: 'adventure_book' }, scenePhaseClassifier: {} }
    }, { enabled: true }), true);
    assert.equal(shouldOfferAdventureBook({
        sceneMode: 'mainline',
        processed: {
            director: { scenePhase: 'DIALOGUE', scenePluginId: null },
            scenePhaseClassifier: { resolvedPhase: 'CHALLENGE', resolvedPluginId: 'adventure_book' }
        }
    }, { enabled: true }), true);
});

test('director capability describes Adventure Book as bounded input replacement', async () => {
    const registered = [];
    const context = {
        sceneMode: 'mainline',
        runtime: {
            scenePhaseClassifier: {
                definitionAddenda: []
            }
        }
    };
    await runDirectorPrePrompt(context, {
        settings: { getSelf: () => ({ enabled: true }) },
        director: {
            registerCapability: capability => registered.push(capability)
        }
    });
    assert.equal(registered.length, 1);
    assert.equal(registered[0].phase, 'ADVENTURE_BOOK');
    assert.match(registered[0].description, /bounded D&D-style mini-adventure resolver/i);
    assert.match(registered[0].description, /structured choices, skill checks/i);
    assert.match(registered[0].description, /Sprinkles-on-top interlude/i);
    assert.match(registered[0].description, /small incident inside that scope/i);
    assert.match(registered[0].description, /No explicit obstacle is required/i);
    assert.match(registered[0].description, /turns that dead air into a small contained adventure/i);
    assert.match(registered[0].description, /weird merchant/i);
    assert.match(registered[0].description, /pink lizards/i);
    assert.match(registered[0].description, /cactus-juice mistake/i);
    assert.match(registered[0].description, /river crossing/i);
    assert.match(registered[0].description, /Committed investigation/i);
    assert.match(registered[0].description, /Social pressure with stakes/i);
    assert.match(registered[0].description, /stay inside the already chosen scope/i);
    assert.match(registered[0].description, /Do not choose this for pure downtime/i);
    assert.match(registered[0].handoffHint, /structured choices with possible skill checks/i);
    assert.match(registered[0].handoffHint, /small playable incident inside an already chosen journey/i);
    assert.match(registered[0].handoffHint, /do not require a visible fork, monster, or obstacle/i);
    assert.match(registered[0].handoffHint, /flavor, danger, comedy, or discovery/i);
    assert.match(registered[0].handoffHint, /camp\/rest regrouping/i);
    assert.equal(context.runtime.scenePhaseClassifier.definitionAddenda.length, 1);
    assert.equal(context.runtime.scenePhaseClassifier.definitionAddenda[0].phase, 'ADVENTURE_BOOK');
    assert.equal(context.runtime.scenePhaseClassifier.definitionAddenda[0].pluginId, 'adventure_book');
    assert.match(context.runtime.scenePhaseClassifier.definitionAddenda[0].text, /valid playable boundary even if the final paragraph has no visible fork/i);
    assert.match(context.runtime.scenePhaseClassifier.definitionAddenda[0].text, /next normal input would only be "keep going"/i);
});

test('post VN generation registers blocking Pixi canvas overlay', async (t) => {
    const descriptors = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_overlay_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });
    let storyCalls = 0;
    let seedCalls = 0;
    let schemaMessages = [];
    let storyMessages = [];
    await runPostVnGeneration({
        turnNumber: 9,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'DIALOGUE' },
            scenePhaseClassifier: {}
        }
    }, {
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 3,
                show_exact_odds: true,
                cg_visual_style: 'theme_colors'
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 99,
                context: {
                    turnNumber: 9,
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'Mira', userPrompt: 'Find the relic.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'Mira reaches the ruin.' }] },
                        narrativeEngine: { writerResponse: 'The ruin door refuses to open.' }
                    },
                    output: { party: ['Mira'] }
                }
            })
        },
        llm: {
            call: async (messages) => {
                storyCalls += 1;
                storyMessages = messages.map(message => ({ ...message }));
                return { content: LONG_STORY };
            },
            runTask: async (task) => {
                storyCalls += 1;
                storyMessages = task.prompt.messages.map(message => ({ role: message.role, content: message.text }));
                return { content: LONG_STORY };
            },
            withSchema: async (task) => {
                seedCalls += 1;
                schemaMessages = (task.prompt?.messages || task.messages).map(message => ({ role: message.role, content: message.text ?? message.content }));
                return {
                    content: {
                        title: 'Ruin Door',
                        mode: 'Investigation',
                        chapterIndex: 1,
                        maxChapters: 3,
                        situation: 'A sealed door blocks the ruin.',
                        stakes: 'Opening it safely matters.',
                        stepIndex: 1,
                        maxSteps: 3,
                        party: ['Mira'],
                        options: [{
                            label: 'Study the lock',
                            successChance: 70,
                            riskTier: 'Low',
                            rewardTier: 'Medium'
                        }]
                    }
                };
            },
            repairJson: () => null
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: storageRoot,
                relativePath: 'plugins/Main/9/adventure_book',
                chatName: 'Main',
                turnNumber: 9,
                storageTurnKey: '9'
            })
        },
        logger: {
            warn: () => {}
        }
    });

    assert.equal(storyCalls, 1);
    assert.equal(storyMessages.at(-2).role, 'user');
    assert.match(storyMessages.at(-2).content, /SOURCE MATERIAL FOR ADVENTURE BOOK/);
    assert.equal(storyMessages.at(-1).role, 'user');
    assert.match(storyMessages.at(-1).content, /Write ONLY raw prose/);
    assert.match(storyMessages.at(-1).content, /Chapter pacing contract:/);
    assert.match(storyMessages.at(-1).content, /"pacing": "opening"/);
    assert.equal(seedCalls, 1);
    assert.equal(schemaMessages.at(-2).role, 'assistant');
    assert.equal(schemaMessages.at(-2).content, LONG_STORY);
    assert.equal(schemaMessages.at(-1).role, 'user');
    assert.match(schemaMessages.at(-1).content, /return ONLY JSON/i);
    assert.match(schemaMessages.at(-1).content, /Exact JSON Schema:/);
    assert.match(schemaMessages.at(-1).content, /"required": \[\s*"title",\s*"mode",\s*"stakes",\s*"options"/);
    assert.match(schemaMessages.at(-1).content, /"automaticOutcome": \{\s*"type": \[\s*"string",\s*"null"\s*\]/);
    assert.match(schemaMessages.at(-1).content, /"outcomeTiers": \{\s*"type": \[\s*"object",\s*"null"\s*\]\s*\}/);
    assert.match(schemaMessages.at(-1).content, /difficultyBandTargets/);
    assert.match(schemaMessages.at(-1).content, /character-strength choices/i);
    assert.match(schemaMessages.at(-1).content, /Do not cluster all checks around 11\+\/12\+/);
    assert.match(schemaMessages.at(-1).content, /Do not nest the object under "content", "data", "json", "response"/);
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].renderer, 'pixi');
    assert.equal(descriptors[0].blocking, true);
    assert.equal(descriptors[0].timeoutMs, 2147483647);
    assert.equal(descriptors[0].keepVNChrome, true);
    assert.equal(descriptors[0].keepVNAudioDuringTakeover, true);
    assert.equal(descriptors[0].keepVNViewportDuringTakeover, true);
    assert.equal(descriptors[0].keepVNPixiRuntimeDuringTakeover, true);
    assert.equal(descriptors[0].visualState.keepVNAudioDuringTakeover, true);
    assert.equal(descriptors[0].visualState.keepVNPixiRuntimeDuringTakeover, true);
    assert.equal(descriptors[0].handlerRef, 'guiIntercepts.adventure_book_overlay');
    assert.equal(descriptors[0].payload.sessionId, undefined);
    assert.equal(descriptors[0].payload.initialState.title, 'Ruin Door');
    assert.equal(descriptors[0].payload.initialState.storyText, LONG_STORY);
    assert.ok(descriptors[0].payload.initialState.pages.length >= 1);
    assert.equal(descriptors[0].payload.interactionMode, 'active');
    assert.equal(descriptors[0].payload.bookStatus, 'active');
    assert.equal(descriptors[0].payload.chapters.length, 1);
    assert.equal(descriptors[0].payload.chapters[0].state.title, 'Ruin Door');
    assert.equal(descriptors[0].payload.currentChapterIndex, 1);
    assert.equal(descriptors[0].payload.cgVisualStyle, 'theme_colors');
    assert.ok(fs.existsSync(path.join(storageRoot, 'book_state.json')));
});

test('raw story generation retries when it copies the source chapter', async () => {
    const descriptors = [];
    const sourceChapter = LONG_STORY;
    const freshStory = [
        'At the second mile marker, the road dipped into a dry wash that should not have held water, yet every stone gleamed black as if rain had passed minutes before.',
        '"That was not on the map," Mira said. She crouched near the mud and found bootprints crossing the wash from both directions, all of them careful, all of them avoiding a little cairn of white river shells.',
        'The ruin still waited ahead, but the path had acquired a question before the party ever reached it.'
    ].join('\n\n');
    let storyCalls = 0;

    await runPostVnGeneration({
        turnNumber: 9,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'DIALOGUE' },
            scenePhaseClassifier: {}
        }
    }, {
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 3,
                show_exact_odds: true
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 99,
                context: {
                    turnNumber: 9,
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'Mira', userPrompt: 'Find the relic.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'Mira travels toward the ruin.' }] },
                        narrativeEngine: { writerResponse: sourceChapter }
                    },
                    output: { party: ['Mira'] }
                }
            })
        },
        llm: {
            call: async () => {
                storyCalls += 1;
                return { content: storyCalls === 1 ? sourceChapter : freshStory };
            },
            runTask: async () => {
                storyCalls += 1;
                return { content: storyCalls === 1 ? sourceChapter : freshStory };
            },
            withSchema: async () => ({
                content: {
                    title: 'Wash Marker',
                    mode: 'Journey',
                    chapterIndex: 1,
                    maxChapters: 3,
                    situation: 'A strange wash interrupts the road.',
                    stakes: 'The party can preserve time or learn what crossed here.',
                    stepIndex: 1,
                    maxSteps: 3,
                    party: ['Mira'],
                    options: [{
                        label: 'Study the tracks',
                        successChance: 70,
                        riskTier: 'Low',
                        rewardTier: 'Medium'
                    }, {
                        label: 'Keep moving',
                        successChance: 60,
                        riskTier: 'Medium',
                        rewardTier: 'Low'
                    }]
                }
            }),
            repairJson: () => null
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        logger: {
            warn: () => {}
        }
    });

    assert.equal(storyCalls, 2);
    assert.equal(descriptors[0].payload.initialState.storyText, freshStory);
});

test('legacy book state hydrates chapter history from initial transcript and current state', () => {
    const { buildChapterList } = logic._private;
    const first = {
        title: 'First Fork',
        stepIndex: 1,
        storyText: 'The road divides under a leaning sign.',
        options: [{ optionKey: 'left', label: 'Go left' }]
    };
    const second = {
        title: 'After the Left Road',
        stepIndex: 2,
        storyText: 'The left road becomes narrow and damp.',
        options: [{ optionKey: 'listen', label: 'Listen at the tunnel' }]
    };
    const third = {
        title: 'Tunnel Mouth',
        stepIndex: 3,
        storyText: 'A cold tunnel mouth waits ahead.',
        options: []
    };

    const chapters = buildChapterList({
        pluginId: PLUGIN_ID,
        initialState: first,
        currentState: third,
        transcript: [{
            option: { optionKey: 'left', label: 'Go left' },
            roll: { outcome: 'success', roll: 12 },
            resultText: 'The party finds the damp road.',
            state: second
        }]
    });

    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].chapterIndex, 1);
    assert.equal(chapters[1].selectedOption.optionKey, 'left');
    assert.equal(chapters[1].roll.outcome, 'success');
    assert.equal(chapters[2].state.title, 'Tunnel Mouth');
});

function lastPayload(emitted, eventName) {
    const matches = emitted.filter(entry => entry.event === eventName);
    return matches[matches.length - 1]?.payload;
}

test('socket loop starts, advances, and finalizes a continuation prompt', async (t) => {
    const emitted = [];
    const facts = [];
    const interludes = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_socket_loop_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });
    let storyCalls = 0;
    let seedCalls = 0;
    let advanceMetadataPrompt = '';
    let advanceStoryPrompt = '';
    let finalCapsulePrompt = '';
    const tools = {
        turnContext: { turnNumber: 7 },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                debug_mode: true,
                max_steps: 1,
                show_exact_odds: true,
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 12,
                context: {
                    turnNumber: 7,
                    creationTurnNumber: 7,
                    dbId: 12,
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'John', userPrompt: 'Cross the river.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'John reaches a river.' }] },
                        narrativeEngine: { writerResponse: 'The river runs cold and fast.' }
                    },
                    output: { party: ['John'] }
                }
            })
        },
        llm: {
            call: async (messages) => {
                storyCalls += 1;
                if (storyCalls === 2) advanceStoryPrompt = Array.isArray(messages) ? messages.at(-1)?.content || '' : '';
                return {
                    content: storyCalls === 2
                        ? 'John commits to the stones, but the crossing changes under him. The first leap lands cleanly, the second sends cold water over his boots, and the third reveals a rope hidden beneath the foam.\n\n"Someone made this harder on purpose," he says, dragging himself onto the far bank. The bell keeps ringing behind him, not as a warning now, but as an answer from somewhere among the reeds.'
                        : LONG_STORY
                };
            },
            runTask: async (task) => {
                storyCalls += 1;
                const lastText = task?.prompt?.messages?.at(-1)?.text || '';
                if (storyCalls === 2) advanceStoryPrompt = lastText;
                return {
                    content: storyCalls === 2
                        ? 'John commits to the stones, but the crossing changes under him. The first leap lands cleanly, the second sends cold water over his boots, and the third reveals a rope hidden beneath the foam.\n\n"Someone made this harder on purpose," he says, dragging himself onto the far bank. The bell keeps ringing behind him, not as a warning now, but as an answer from somewhere among the reeds.'
                        : LONG_STORY
                };
            },
            withSchema: async (task) => {
                const title = String(task?.title || '');
                if (title.includes('Seed')) {
                    seedCalls += 1;
                    return {
                        content: {
                            title: `River Crossing ${seedCalls}`,
                            mode: 'Journey',
                            situation: 'The river blocks the trail.',
                            stakes: 'Speed matters.',
                            stepIndex: 1,
                            maxSteps: 1,
                            party: ['John'],
                            options: [{
                                label: 'Leap across the stones',
                                leadCharacter: 'John',
                                approach: 'Agility',
                                successChance: 80,
                                riskTier: 'Medium',
                                rewardTier: 'Medium'
                            }]
                        }
                    };
                }
                if (title.includes('Advance')) {
                    advanceMetadataPrompt = task.prompt?.messages?.at(-1)?.text || task.messages?.at(-1)?.content || '';
                    return {
                        content: {
                            resultText: 'John commits to the stones and reaches the far bank with wet boots.',
                            situation: 'The crossing is behind him.',
                            stakes: 'The trail can continue.',
                            isComplete: true,
                            finalResolution: 'John crossed the river and kept momentum.',
                            bridgePrompt: 'Continue after John crosses the river.'
                        }
                    };
                }
                finalCapsulePrompt = task.prompt?.messages?.at(-1)?.text || task.messages?.at(-1)?.content || '';
                return {
                    content: {
                        summary: 'John reached the river after choosing the faster route and committed to the stone crossing despite the current. The river fought his footing, soaked his boots, and revealed that the crossing had been tampered with by a hidden rope beneath the foam. The bell on the far bank rang without a visible hand, turning the ford from a simple shortcut into evidence of an unseen watcher or mechanism. John still kept momentum, but the journey now carries suspicion and wet exhaustion rather than clean speed.',
                        sceneEnding: 'John stands on the far bank with wet boots while the hidden rope tugs beneath the water and the bell keeps ringing from the reeds. Continue with him deciding how to respond to whoever or whatever made the crossing harder.'
                    }
                };
            },
            repairJson: () => null
        },
        interludes: {
            createProgrammatic: async (payload) => {
                interludes.push(payload);
                throw new Error('Adventure Book should not create programmatic interludes.');
            }
        },
        facts: {
            appendToFactsDb: async (fact, overrides) => facts.push({ fact, overrides })
        },
        plugins: {
            isInstalled: () => false
        },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: storageRoot,
                relativePath: 'plugins/Main/7/adventure_book',
                chatName: 'Main',
                turnNumber: 7,
                storageTurnKey: '7'
            })
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        logger: {
            warn: () => {},
            error: () => {}
        }
    };

    const descriptors = [];
    await runPostVnGeneration({
        turnNumber: 7,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'DIALOGUE' },
            scenePhaseClassifier: {}
        }
    }, tools);
    const start = {
        success: true,
        state: descriptors[0].payload.initialState
    };
    assert.equal(start.success, true);
    assert.equal(start.state.title, 'River Crossing 1');

    await rollChallengeSocket({ optionKey: start.state.options[0].optionKey, chapterIndex: 1 }, tools);
    const roll = lastPayload(emitted, `${ROLL_EVENT}-response`);
    assert.equal(roll.success, true);
    assert.ok(roll.pendingRollId);
    assert.ok(roll.roll.roll >= 1 && roll.roll.roll <= 20);

    await advanceChallengeSocket({ optionKey: start.state.options[0].optionKey, pendingRollId: 'stale-roll', chapterIndex: 1 }, tools);
    const staleAdvance = lastPayload(emitted, `${ADVANCE_EVENT}-response`);
    assert.equal(staleAdvance.success, false);
    assert.match(staleAdvance.error, /roll expired|does not match/i);

    await advanceChallengeSocket({ optionKey: start.state.options[0].optionKey, pendingRollId: roll.pendingRollId, chapterIndex: 1 }, tools);
    const advance = lastPayload(emitted, `${ADVANCE_EVENT}-response`);
    assert.equal(advance.success, true);
    assert.equal(advance.roll.roll, roll.roll.roll);
    assert.equal(advance.state.isComplete, true);
    assert.equal(advance.chapters.length, 2);
    assert.equal(advance.chapters[0].state.title, 'River Crossing 1');
    assert.equal(advance.chapters[1].state.isComplete, true);
    assert.equal(advance.interactionMode, 'active');
    assert.match(advanceStoryPrompt, /Chapter pacing contract:/);
    assert.match(advanceStoryPrompt, /"pacing": "resolve_now"/);
    assert.match(advanceStoryPrompt, /changed arrival, live danger, aftermath, or a soft cliffhanger/i);
    assert.match(advanceMetadataPrompt, /Exact JSON Schema:/);
    assert.match(advanceMetadataPrompt, /"required": \[\s*"resultText",\s*"stakes"/);
    assert.match(advanceMetadataPrompt, /"automaticOutcome": \{\s*"type": \[\s*"string",\s*"null"\s*\]/);
    assert.match(advanceMetadataPrompt, /"outcomeTiers": \{\s*"type": \[\s*"object",\s*"null"\s*\]\s*\}/);
    assert.match(advanceMetadataPrompt, /optionBlueprints/);
    assert.match(advanceMetadataPrompt, /difficultyBandTargets/);
    assert.match(advanceMetadataPrompt, /handoffMode/);
    assert.match(advanceMetadataPrompt, /Do not nest the object under "content", "data", "json", "response"/);

    await finalizeChallengeSocket({}, tools);
    const final = lastPayload(emitted, `${FINALIZE_EVENT}-response`);
    assert.equal(final.success, true);
    assert.equal(final.interlude, undefined);
    assert.equal(interludes.length, 0);
    assert.match(final.summary, /John reached the river/);
    assert.match(final.sceneEnding, /far bank/);
    assert.match(final.continuationPrompt, /^Since the last chapter,/);
    assert.match(final.continuationPrompt, /Continue the immediate story from this point:/);
    assert.doesNotMatch(final.continuationPrompt, /# WHAT HAPPENED|# WHERE TO CONTINUE/i);
    assert.match(finalCapsulePrompt, /600-900 words/);
    assert.match(finalCapsulePrompt, /sceneEnding/);
    assert.match(finalCapsulePrompt, /John stood where the river broke the road/);
    assert.match(finalCapsulePrompt, /John commits to the stones/);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].overrides.scene_mode, 'mainline');
    assert.equal(facts[0].overrides.interlude_id, null);
    assert.match(facts[0].fact.fact_value, /sceneEnding/);
    await startChallengeSocket({}, tools);
    const replayStart = lastPayload(emitted, `${START_EVENT}-response`);
    assert.equal(replayStart.success, true);
    assert.equal(replayStart.interactionMode, 'readonly_replay');
    assert.equal(replayStart.bookStatus, 'finalized');
    assert.equal(replayStart.chapters.length, 2);
    await rollChallengeSocket({ optionKey: start.state.options[0].optionKey, chapterIndex: 1 }, tools);
    const readonlyRoll = lastPayload(emitted, `${ROLL_EVENT}-response`);
    assert.equal(readonlyRoll.success, false);
    assert.match(readonlyRoll.error, /read-only/i);
    await generateCgSocket({ requestId: 'readonly_cg' }, tools);
    const readonlyCg = lastPayload(emitted, `${CG_EVENT}-response`);
    assert.equal(readonlyCg.success, false);
    assert.match(readonlyCg.error, /read-only/i);
    assert.equal(storyCalls, 2);
});

test('automatic socket advance does not require a pending roll', async (t) => {
    const emitted = [];
    const descriptors = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_auto_advance_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });
    const tools = {
        turnContext: { turnNumber: 9 },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 1,
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 13,
                context: {
                    turnNumber: 9,
                    creationTurnNumber: 9,
                    dbId: 13,
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'John', userPrompt: 'Answer the knock.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'Someone knocks.' }] },
                        narrativeEngine: { writerResponse: 'The room goes quiet.' }
                    },
                    output: { party: ['John'] }
                }
            })
        },
        llm: {
            call: async () => ({ content: LONG_STORY }),
            withSchema: async (task) => {
                if (String(task?.title || '').includes('Seed')) {
                    return {
                        content: {
                            title: 'The Knock',
                            mode: 'Investigation',
                            situation: 'Someone waits beyond the door.',
                            stakes: 'The party can answer plainly.',
                            stepIndex: 1,
                            maxSteps: 1,
                            party: ['John'],
                            options: [{
                                label: 'Open the door plainly',
                                resolutionType: 'automatic',
                                automaticOutcome: 'The party hears the visitor out.'
                            }]
                        }
                    };
                }
                return {
                    content: {
                        resultText: 'John opens the door and hears the visitor out.',
                        situation: 'The conversation can continue.',
                        stakes: 'No die was needed.',
                        isComplete: true,
                        finalResolution: 'The visitor was heard without incident.',
                        bridgePrompt: 'Continue after the visitor speaks.'
                    }
                };
            },
            repairJson: () => null
        },
        plugins: {
            isInstalled: () => false
        },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: storageRoot,
                relativePath: 'plugins/Main/9/adventure_book',
                chatName: 'Main',
                turnNumber: 9,
                storageTurnKey: '9'
            })
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        logger: {
            warn: () => {},
            error: () => {}
        }
    };

    await runPostVnGeneration({
        turnNumber: 9,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'DIALOGUE' },
            scenePhaseClassifier: {}
        }
    }, tools);
    const optionKey = descriptors[0].payload.initialState.options[0].optionKey;
    await advanceChallengeSocket({ optionKey, chapterIndex: 1 }, tools);
    const advance = lastPayload(emitted, `${ADVANCE_EVENT}-response`);
    assert.equal(advance.success, true);
    assert.equal(advance.roll.resolutionType, 'automatic');
    assert.equal(advance.roll.roll, null);
});

test('natural book state persists, restores, and stores CG in chat turn plugin storage', async (t) => {
    const emitted = [];
    const descriptors = [];
    const cgRequests = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_restore_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        logic._private.clearActiveSessionsForTests();
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });

    let storyCalls = 0;
    let seedCalls = 0;
    const tools = {
        turnContext: { turnNumber: 42, chatDbFullPath: 'C:/Project/Main.db' },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: false,
                max_steps: 2,
                prefer_cg: true,
                cg_model_tier: 'standard',
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 77,
                context: {
                    turnNumber: 42,
                    chatDbFullPath: 'C:/Project/Main.db',
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'John', userPrompt: 'Travel for five days.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'The party starts a five-day road journey.' }] },
                        narrativeEngine: { writerResponse: 'The road continues under their boots.' },
                        director: { scenePluginId: 'adventure_book' },
                        scenePhaseClassifier: { resolvedPluginId: 'adventure_book' }
                    },
                    output: { party: ['John'] }
                }
            })
        },
        llm: {
            call: async () => {
                storyCalls += 1;
                return { content: LONG_STORY };
            },
            runTask: async () => {
                storyCalls += 1;
                return { content: LONG_STORY };
            },
            withSchema: async () => {
                seedCalls += 1;
                return {
                    content: {
                        title: 'Road Seasoning',
                        mode: 'Journey',
                        situation: 'The road offers a contained incident.',
                        stakes: 'The trip can become memorable.',
                        stepIndex: 1,
                        maxSteps: 2,
                        party: ['John'],
                        illustrationPrompt: 'A strange roadside merchant near a dusty road',
                        options: [{
                            label: 'Talk to the merchant',
                            resolutionType: 'automatic',
                            automaticOutcome: 'The party hears the merchant out.'
                        }]
                    }
                };
            },
            repairJson: () => null
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async (pluginId, exportName, args) => {
                cgRequests.push({ pluginId, exportName, request: args[0] });
                fs.mkdirSync(storageRoot, { recursive: true });
                const fileName = path.basename(args[0].outputPath);
                fs.writeFileSync(path.join(storageRoot, fileName), 'mock image bytes');
                return { ok: true, outputPath: args[0].outputPath, absolutePath: path.join(storageRoot, fileName) };
            }
        },
        project: {
            getChatPluginStorage: (turn = 42) => ({
                absolutePath: storageRoot,
                relativePath: `plugins/Main/${turn}/adventure_book`,
                chatName: 'Main',
                turnNumber: Number(turn),
                storageTurnKey: String(turn)
            })
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        logger: {
            warn: () => {},
            error: () => {}
        }
    };

    await runPostVnGeneration({
        turnNumber: 42,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'ADVENTURE_BOOK', scenePluginId: 'adventure_book' },
            scenePhaseClassifier: { resolvedPluginId: 'adventure_book' }
        }
    }, tools);
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].payload.autoGenerateCg, true);
    assert.equal(descriptors[0].payload.initialState.title, 'Road Seasoning');
    assert.equal(storyCalls, 1);
    assert.equal(seedCalls, 1);
    assert.ok(fs.existsSync(path.join(storageRoot, 'book_state.json')));
    assert.equal(descriptors[0].payload.sessionId, undefined);

    logic._private.clearActiveSessionsForTests();
    descriptors.length = 0;
    await runPostVnGeneration({
        turnNumber: 42,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: {
            director: { scenePhase: 'ADVENTURE_BOOK', scenePluginId: 'adventure_book' },
            scenePhaseClassifier: { resolvedPluginId: 'adventure_book' }
        }
    }, tools);
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].payload.sessionId, undefined);
    assert.equal(descriptors[0].payload.initialState.title, 'Road Seasoning');
    assert.equal(storyCalls, 1);
    assert.equal(seedCalls, 1);

    logic._private.clearActiveSessionsForTests();
    await generateCgSocket({ requestId: 'cg_req_test_ready', chapterIndex: 1 }, tools);
    const cg = lastPayload(emitted, `${CG_EVENT}-response`);
    assert.equal(cg.requestId, 'cg_req_test_ready');
    assert.equal(cg.success, true);
    assert.equal(cg.cg.ok, true);
    assert.match(cg.cg.outputPath, /^plugins\/Main\/42\/adventure_book\/cg_chapter_1_[a-f0-9]{24}\.webp$/);
    assert.equal(cg.state.cgImagePath, `project://${cg.cg.outputPath}`);
    assert.equal(cg.state.cgStatus, 'ready');
    assert.equal(cg.state.cgPromptHash, cg.cg.promptHash);
    assert.equal(cg.state.cgOutputPath, cg.cg.outputPath);
    assert.ok(cg.state.cgPrompt.length > 0);
    assert.equal(cgRequests.length, 1);

    logic._private.clearActiveSessionsForTests();
    await startChallengeSocket({}, tools);
    const start = lastPayload(emitted, `${START_EVENT}-response`);
    assert.equal(start.success, true);
    assert.equal(start.state.title, 'Road Seasoning');
    assert.equal(start.state.cgImagePath, `project://${cg.cg.outputPath}`);
    assert.equal(start.state.cgStatus, 'ready');

    const optionKey = start.state.options[0].optionKey;
    await advanceChallengeSocket({ optionKey, chapterIndex: 1 }, tools);
    const advance = lastPayload(emitted, `${ADVANCE_EVENT}-response`);
    assert.equal(advance.success, true);
    assert.equal(advance.chapterIndex, 2);
    assert.equal(advance.state.cgImagePath, '');
    assert.equal(advance.state.cgStatus, 'missing');
    assert.equal(advance.state.cgPrompt, '');
    assert.equal(advance.state.cgPromptHash, '');
    assert.equal(advance.state.cgOutputPath, '');
    assert.equal(advance.state.cgRequestedAt, null);
    assert.equal(advance.state.cgCompletedAt, null);
});

test('persisted current chapter drops CG metadata inherited from another chapter', () => {
    const inheritedCg = {
        title: 'Second Crossing',
        chapterIndex: 2,
        stepIndex: 2,
        cgImagePath: 'project://plugins/Main/42/adventure_book/cg_chapter_1_abcdef.webp',
        cgStatus: 'ready',
        cgPrompt: 'Old chapter prompt',
        cgPromptHash: 'abcdef',
        cgOutputPath: 'plugins/Main/42/adventure_book/cg_chapter_1_abcdef.webp',
        cgRequestedAt: 100,
        cgCompletedAt: 200
    };

    const repaired = logic._private.repairMismatchedCurrentCgState(inheritedCg, 2);
    assert.notEqual(repaired, inheritedCg);
    assert.equal(repaired.cgImagePath, '');
    assert.equal(repaired.cgStatus, 'missing');
    assert.equal(repaired.cgPrompt, '');
    assert.equal(repaired.cgPromptHash, '');
    assert.equal(repaired.cgOutputPath, '');
    assert.equal(repaired.cgRequestedAt, null);
    assert.equal(repaired.cgCompletedAt, null);

    const validCg = { ...inheritedCg, cgImagePath: 'project://cg_chapter_2_abcdef.webp', cgOutputPath: 'cg_chapter_2_abcdef.webp' };
    assert.equal(logic._private.repairMismatchedCurrentCgState(validCg, 2), validCg);
});

test('failed cg is persisted as failed with reusable prompt metadata', async (t) => {
    const emitted = [];
    const descriptors = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_failed_cg_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });

    const tools = {
        turnContext: { turnNumber: 55, chatDbFullPath: 'C:/Project/Main.db' },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 1,
                prefer_cg: true,
                cg_model_tier: 'standard',
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 55,
                context: {
                    turnNumber: 55,
                    chatDbFullPath: 'C:/Project/Main.db',
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'John', userPrompt: 'Keep walking.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'The party continues down the road.' }] },
                        narrativeEngine: { writerResponse: 'The road bends into fog.' }
                    },
                    output: { party: ['John'] }
                }
            })
        },
        llm: {
            call: async () => ({ content: LONG_STORY }),
            withSchema: async () => ({
                content: {
                    title: 'Fog Road',
                    mode: 'Journey',
                    situation: 'The road bends into fog.',
                    stakes: 'The party may lose time.',
                    stepIndex: 1,
                    maxSteps: 1,
                    party: ['John'],
                    illustrationPrompt: 'A lonely fog road',
                    options: [{ label: 'Keep to the road', resolutionType: 'automatic', automaticOutcome: 'The party continues.' }]
                }
            }),
            repairJson: () => null
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async () => ({ ok: false, error: 'mock painter unavailable' })
        },
        project: {
            getChatPluginStorage: (turn = 55) => ({
                absolutePath: storageRoot,
                relativePath: `plugins/Main/${turn}/adventure_book`,
                chatName: 'Main',
                turnNumber: Number(turn),
                storageTurnKey: String(turn)
            })
        },
        gui: {
            registerPersistentIntercept: descriptor => descriptors.push(descriptor)
        },
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {}
        }
    };

    await runPostVnGeneration({
        turnNumber: 55,
        sceneMode: 'mainline',
        output: { guiIntercepts: [] },
        processed: { director: { scenePluginId: 'adventure_book' }, scenePhaseClassifier: {} }
    }, tools);

    assert.equal(descriptors[0].payload.sessionId, undefined);
    await generateCgSocket({ requestId: 'cg_req_test_failed', chapterIndex: 1 }, tools);
    const cg = lastPayload(emitted, `${CG_EVENT}-response`);
    assert.equal(cg.requestId, 'cg_req_test_failed');
    assert.equal(cg.success, false);
    assert.equal(cg.state.cgStatus, 'failed');
    assert.match(cg.state.cgError, /mock painter unavailable/);
    assert.ok(cg.state.cgPrompt.length > 0);
    assert.match(cg.state.cgPromptHash, /^[a-f0-9]{24}$/);
    assert.match(cg.state.cgOutputPath, /^plugins\/Main\/55\/adventure_book\/cg_chapter_1_[a-f0-9]{24}\.webp$/);

    logic._private.clearActiveSessionsForTests();
    await startChallengeSocket({}, tools);
    const restored = lastPayload(emitted, `${START_EVENT}-response`);
    assert.equal(restored.success, true);
    assert.equal(restored.state.cgStatus, 'failed');
    assert.equal(restored.state.cgPromptHash, cg.state.cgPromptHash);
});

test('legacy session files are ignored by turn-scoped sockets', async (t) => {
    const emitted = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_legacy_ignored_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });

    fs.mkdirSync(storageRoot, { recursive: true });
    fs.writeFileSync(
        path.join(storageRoot, 'session_adv_legacy.json'),
        JSON.stringify({
            version: 1,
            pluginId: 'adventure_book',
            sessionId: 'adv_legacy',
            state: {
                title: 'Legacy Book',
                storyText: LONG_STORY,
                pages: [LONG_STORY],
                options: [{ label: 'Continue', resolutionType: 'automatic', automaticOutcome: 'They continue.' }]
            }
        }, null, 2),
        'utf8'
    );
    fs.writeFileSync(path.join(storageRoot, 'latest_session.json'), JSON.stringify({ sessionId: 'adv_legacy' }), 'utf8');

    const tools = {
        turnContext: { turnNumber: 81, chatDbFullPath: 'C:/Project/Main.db' },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 1,
                prefer_cg: true,
                cg_model_tier: 'standard',
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async () => {
                throw new Error('Legacy sessions should not trigger CG generation.');
            }
        },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: storageRoot,
                relativePath: 'plugins/Main/81/adventure_book',
                chatName: 'Main',
                turnNumber: 81,
                storageTurnKey: '81'
            })
        },
        logger: {
            log: () => {},
            warn: () => {},
            error: () => {}
        }
    };

    await startChallengeSocket({}, tools);
    const start = lastPayload(emitted, `${START_EVENT}-response`);
    assert.equal(start.success, false);
    assert.match(start.error, /pre-generated/i);

    await generateCgSocket({ requestId: 'cg_req_legacy_ignored' }, tools);
    const cg = lastPayload(emitted, `${CG_EVENT}-response`);
    assert.equal(cg.requestId, 'cg_req_legacy_ignored');
    assert.equal(cg.success, false);
    assert.match(cg.error, /state not found/i);
});

test('rebuild is guarded behind debug mode', async () => {
    const emitted = [];
    let turnReads = 0;
    const tools = {
        turnContext: { turnNumber: 7 },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                debug_mode: false,
                max_steps: 1,
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => {
                turnReads += 1;
                return null;
            }
        },
        logger: {
            error: () => {}
        }
    };

    await rebuildChallengeSocket({}, tools);
    const response = lastPayload(emitted, `${REBUILD_EVENT}-response`);
    assert.equal(response.success, false);
    assert.match(response.error, /debug mode/i);
    assert.equal(turnReads, 0);
});

test('debug rebuild can request cg into chat turn plugin storage', async (t) => {
    const emitted = [];
    const cgRequests = [];
    const storageRoot = path.join(__dirname, '.tmp', `adventure_book_cache_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    t.after(() => {
        try { fs.rmSync(storageRoot, { recursive: true, force: true }); } catch (_) {}
    });
    let storyCalls = 0;
    let seedCalls = 0;
    const tools = {
        turnContext: { turnNumber: 7, chatDbFullPath: 'C:/Project/Main.db' },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                debug_mode: true,
                max_steps: 2,
                cg_model_tier: 'standard',
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => ({
                dbId: 12,
                context: {
                    turnNumber: 7,
                    chatDbFullPath: 'C:/Project/Main.db',
                    sceneMode: 'mainline',
                    input: { playerCharacterName: 'John', userPrompt: 'Cross the river.' },
                    processed: {
                        promptBuilder: { messages: [{ role: 'user', content: 'John reaches a river.' }] },
                        narrativeEngine: { writerResponse: 'The river runs cold and fast.' }
                    },
                    output: { party: ['John'] }
                }
            })
        },
        llm: {
            call: async () => {
                storyCalls += 1;
                return { content: LONG_STORY };
            },
            runTask: async () => {
                storyCalls += 1;
                return { content: LONG_STORY };
            },
            withSchema: async () => {
                seedCalls += 1;
                return {
                    content: {
                        title: 'River Crossing',
                        mode: 'Journey',
                        situation: 'The river blocks the trail.',
                        stakes: 'Speed matters.',
                        stepIndex: 1,
                        maxSteps: 2,
                        party: ['John'],
                        illustrationPrompt: 'John before a cold river crossing',
                        options: [{
                            label: 'Leap across the stones',
                            successChance: 80,
                            riskTier: 'Medium',
                            rewardTier: 'Medium'
                        }]
                    }
                };
            },
            repairJson: () => null
        },
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async (pluginId, exportName, args) => {
                cgRequests.push({ pluginId, exportName, request: args[0] });
                const relativePrefix = 'plugins/Main/7/adventure_book/';
                const fileName = String(args[0].outputPath || '').startsWith(relativePrefix)
                    ? String(args[0].outputPath).slice(relativePrefix.length)
                    : path.basename(String(args[0].outputPath || 'cg.webp'));
                fs.mkdirSync(storageRoot, { recursive: true });
                fs.writeFileSync(path.join(storageRoot, fileName), 'mock image bytes');
                return { ok: true, outputPath: args[0].outputPath, provider: 'mock' };
            }
        },
        project: {
            getChatPluginStorage: (turn = 7) => ({
                absolutePath: storageRoot,
                relativePath: `plugins/Main/${turn}/adventure_book`,
                chatName: 'Main',
                turnNumber: Number(turn),
                storageTurnKey: String(turn)
            })
        },
        logger: {
            warn: () => {},
            error: () => {}
        }
    };

    await rebuildChallengeSocket({ generateCg: true }, tools);
    const response = lastPayload(emitted, `${REBUILD_EVENT}-response`);
    assert.equal(response.success, true);
    assert.equal(storyCalls, 1);
    assert.equal(response.cg.ok, true);
    assert.equal(response.state.cgImagePath, `project://${cgRequests[0].request.outputPath}`);
    assert.match(cgRequests[0].request.outputPath, /^plugins\/Main\/7\/adventure_book\/cg_chapter_1_[a-f0-9]{24}\.webp$/);
    assert.equal(cgRequests[0].request.modelTier, 'standard');
    assert.equal(cgRequests[0].request.aspectRatio, '2:3');
    assert.equal(cgRequests[0].request.imageResolution, '1024x1536');

    await rebuildChallengeSocket({ generateCg: true }, tools);
    const cachedResponse = lastPayload(emitted, `${REBUILD_EVENT}-response`);
    assert.equal(cachedResponse.success, true);
    assert.equal(cachedResponse.cg.ok, true);
    assert.equal(cachedResponse.cg.cached, true);
    assert.equal(cgRequests.length, 1);
    assert.equal(cachedResponse.state.cgImagePath, response.state.cgImagePath);
});

test('start socket only serves pre-generated sessions', async () => {
    const emitted = [];
    let turnReads = 0;
    let llmCalls = 0;
    const tools = {
        turnContext: { turnNumber: 123 },
        socket: {
            emit: (event, payload) => emitted.push({ event, payload })
        },
        settings: {
            getSelf: () => ({
                enabled: true,
                force_offer_every_turn: true,
                max_steps: 1,
                model_def: { model: 'mock', provider: 'mock' }
            })
        },
        turns: {
            getByCreationTurnNumber: async () => {
                turnReads += 1;
                return null;
            }
        },
        llm: {
            withSchema: async () => {
                llmCalls += 1;
                return { content: {} };
            }
        },
        logger: {
            error: () => {}
        }
    };

    await startChallengeSocket({}, tools);
    const response = lastPayload(emitted, `${START_EVENT}-response`);
    assert.equal(response.success, false);
    assert.match(response.error, /pre-generated/i);
    assert.equal(turnReads, 0);
    assert.equal(llmCalls, 0);
});
