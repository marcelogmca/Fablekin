const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readPromptTemplate } = require('./prompt_templates.js');

const logic = require('./logic.js');
const plugin = require('./index.js');
const poemPrompting = require('./poem_prompting.js');
const paletteExtraction = require('./palette_extraction.js');

function createTestTools(overrides = {}) {
    const runtimeState = { arcCinematics: { pendingRequests: [] } };
    const turnState = {};
    const tools = {
        settings: {
            getSelf: () => ({})
        },
        pluginState: {
            runtime: () => runtimeState,
            turn: () => turnState
        },
        logger: {
            log: () => {},
            warn: () => {},
            error: () => {},
            runtime: () => {}
        },
        jobs: {
            withJob: (_title, _options, fn) => Promise.resolve(fn({
                progress: () => {},
                throwIfCancelled: () => {}
            }))
        },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: os.tmpdir(),
                relativePath: 'plugins/TestChat/1/arc_cinematics',
                storageTurnKey: '1'
            })
        },
        turns: {
            getRange: async () => []
        },
        assets: {
            getSpriteCatalog: async () => ({ characters: {} }),
            listOst: async () => []
        },
        plugins: {
            isInstalled: () => false,
            tryCall: async () => ({ ok: false })
        }
    };
    return Object.assign(tools, overrides, {
        settings: { ...tools.settings, ...(overrides.settings || {}) },
        pluginState: { ...tools.pluginState, ...(overrides.pluginState || {}) },
        logger: { ...tools.logger, ...(overrides.logger || {}) },
        jobs: { ...tools.jobs, ...(overrides.jobs || {}) },
        project: { ...tools.project, ...(overrides.project || {}) },
        turns: { ...tools.turns, ...(overrides.turns || {}) },
        assets: { ...tools.assets, ...(overrides.assets || {}) },
        plugins: { ...tools.plugins, ...(overrides.plugins || {}) },
        _runtimeState: runtimeState,
        _turnState: turnState
    });
}

test('splitIntoStanzas groups poem lines into four-line stanzas', () => {
    const stanzas = logic.splitIntoStanzas([
        'one', 'two', 'three', 'four',
        'five', 'six', 'seven', 'eight'
    ]);

    assert.deepEqual(stanzas, [
        ['one', 'two', 'three', 'four'],
        ['five', 'six', 'seven', 'eight']
    ]);
});

test('normalizeSettings keeps line count aligned to stanza boundaries', () => {
    const settings = logic.normalizeSettings({
        poem_line_count: 15,
        maximum_duration_seconds: 75
    });

    assert.equal(settings.poem_line_count, 16);
    assert.equal(settings.maximum_duration_seconds, 75);
    assert.equal(settings.cg_prompt_mode, 'diffusion_positive');
    assert.equal(logic.normalizeSettings({ cg_prompt_mode: 'llm_instruction_with_references' }).cg_prompt_mode, 'llm_instruction_with_references');
    assert.equal(logic.normalizeSettings({ cg_prompt_mode: 'unknown' }).cg_prompt_mode, 'diffusion_positive');
    assert.equal(logic.normalizeSettings({ force_intro: true }).force_intro, true);
    assert.equal(settings.cg_model_tier, 'budget');
    assert.equal(logic.normalizeSettings({ cg_model_tier: 'none' }).cg_model_tier, 'none');
    assert.equal(logic.normalizeSettings({ cg_model_tier: 'premium' }).cg_model_tier, 'premium');
    assert.equal(logic.normalizeSettings({ cg_model_tier: 'unknown' }).cg_model_tier, 'budget');
    assert.equal(logic.normalizeSettings().enable_shaders, true);
    assert.equal(logic.normalizeSettings({ enable_shaders: false }).enable_shaders, false);
    assert.equal(logic.normalizeSettings({ enable_shaders: false }).enable_vfx, false);
    assert.equal(logic.normalizeSettings().enable_vfx, true);
    assert.equal(logic.normalizeSettings({ enable_vfx: false }).enable_vfx, false);
});

test('CG generation can be disabled with the none model tier', () => {
    assert.equal(logic._private.isCgGenerationEnabled(logic.normalizeSettings(), { preferCg: true }), true);
    assert.equal(logic._private.isCgGenerationEnabled(logic.normalizeSettings({ cg_model_tier: 'none' }), { preferCg: true }), false);
    assert.equal(logic._private.isCgGenerationEnabled(logic.normalizeSettings({ prefer_cg: false }), { preferCg: true }), false);
    assert.equal(logic._private.isCgGenerationEnabled(logic.normalizeSettings(), { preferCg: false }), false);
});

test('findLastRunInTurns returns the latest matching arc marker', () => {
    const turns = [
        {
            turnNumber: 3,
            context: {
                processed: {
                    plugins: {
                        arc_cinematics: {
                            arcCinematics: {
                                lastRun: { turnNumber: 3, type: 'outro', arcId: 'default' }
                            }
                        }
                    }
                }
            }
        },
        {
            turnNumber: 8,
            context: {
                processed: {
                    plugins: {
                        arc_cinematics: {
                            arcCinematics: {
                                lastRun: { turnNumber: 8, type: 'intro', arcId: 'default' }
                            }
                        }
                    }
                }
            }
        },
        {
            turnNumber: 11,
            context: {
                processed: {
                    plugins: {
                        arc_cinematics: {
                            arcCinematics: {
                                lastRun: { turnNumber: 11, type: 'outro', arcId: 'side_arc' }
                            }
                        }
                    }
                }
            }
        }
    ];

    assert.deepEqual(
        logic.findLastRunInTurns(turns, { type: 'intro', arcId: 'default' }),
        { turnNumber: 8, type: 'intro', arcId: 'default' }
    );
});

test('normalizeRequest is intro-only and always before dialogue zero', () => {
    const request = logic.normalizeRequest({ turnNumber: 5 }, {
        type: 'outro',
        playAt: 'during_user_input',
        arcId: 'default'
    }, logic.normalizeSettings());

    assert.equal(request.type, 'intro');
    assert.equal(request.playAt, 'before_first_dialogue');
});

test('normalizeRequest accepts chapter range aliases', () => {
    const request = logic.normalizeRequest({ turnNumber: 20 }, {
        range: { startChapter: 7, endChapter: 12 }
    }, logic.normalizeSettings());

    assert.deepEqual(request.range, {
        startTurn: 7,
        endTurn: 12,
        explicit: true
    });
});

test('arc_cinematics registers Pre-Writer hook and not VN dialogue scheduling hook', () => {
    assert.ok(plugin.hooks.HOOK_PRE_WRITER);
    assert.equal(plugin.hooks.HOOK_PRE_WRITER.run, logic.runPreWriter);
    assert.equal(plugin.hooks.HOOK_VN_DIALOGUE_READY, undefined);
});

test('requestArcCinematic announces singular runtime request without starting prep', async () => {
    const turnContext = { turnNumber: 7, runtime: { plugins: {} } };
    let jobStarted = false;
    const tools = createTestTools({
        jobs: {
            withJob: () => {
                jobStarted = true;
                return Promise.resolve();
            }
        }
    });

    const result = await logic.requestArcCinematic(turnContext, tools, {
        arcId: 'planner_arc',
        title: 'Planner Title'
    });

    assert.equal(result.status, 'announced');
    assert.equal(jobStarted, false);
    assert.equal(tools._runtimeState.arcCinematics.pendingRequests.length, 0);
    assert.equal(turnContext.runtime.plugins.arc_cinematics.request.arcId, 'planner_arc');
    assert.equal(turnContext.runtime.plugins.arc_cinematics.request.title, 'Planner Title');
});

test('Pre-Writer force intro creates a request only when none exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-cinematics-force-'));
    const turnContext = {
        turnNumber: 8,
        projectName: 'TestProject',
        runtime: { plugins: {} },
        output: { guiIntercepts: [] },
        processed: {}
    };
    const tools = createTestTools({
        settings: { getSelf: () => ({ force_intro: true, prefer_cg: false }) },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: tempDir,
                relativePath: 'plugins/TestChat/8/arc_cinematics',
                storageTurnKey: '8'
            })
        }
    });

    await logic.runPreWriter(turnContext, tools);

    assert.equal(turnContext.runtime.plugins.arc_cinematics.request.arcId, 'debug_force_intro');
    assert.equal(turnContext.runtime.plugins.arc_cinematics.requestStatus, 'queued');
    assert.equal(tools._runtimeState.arcCinematics.pendingRequests.length, 1);
});

test('Pre-Writer plugin request wins over force intro', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-cinematics-planner-'));
    const turnContext = {
        turnNumber: 9,
        projectName: 'TestProject',
        runtime: {
            plugins: {
                arc_cinematics: {
                    request: {
                        arcId: 'planner_arc',
                        title: 'Planner Arc',
                        preferCg: false
                    }
                }
            }
        },
        output: { guiIntercepts: [] },
        processed: {}
    };
    const tools = createTestTools({
        settings: { getSelf: () => ({ force_intro: true, prefer_cg: false }) },
        project: {
            getChatPluginStorage: () => ({
                absolutePath: tempDir,
                relativePath: 'plugins/TestChat/9/arc_cinematics',
                storageTurnKey: '9'
            })
        }
    });

    await logic.runPreWriter(turnContext, tools);

    const pending = tools._runtimeState.arcCinematics.pendingRequests[0];
    assert.equal(turnContext.runtime.plugins.arc_cinematics.request.arcId, 'planner_arc');
    assert.equal(turnContext.runtime.plugins.arc_cinematics.requestSource, 'announced');
    assert.equal(pending.manifest.request.arcId, 'planner_arc');
    assert.equal(pending.manifest.request.title, 'Planner Arc');
});

test('Pre-Writer does not await heavy preparation job', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-cinematics-async-'));
    const turnContext = {
        turnNumber: 10,
        projectName: 'TestProject',
        runtime: {
            plugins: {
                arc_cinematics: {
                    request: {
                        arcId: 'async_arc',
                        title: 'Async Arc',
                        preferCg: false
                    }
                }
            }
        },
        output: { guiIntercepts: [] },
        processed: {}
    };
    let resolveLlm;
    let llmStarted = false;
    const llmBlocker = new Promise(resolve => {
        resolveLlm = resolve;
    });
    const tools = createTestTools({
        project: {
            getChatPluginStorage: () => ({
                absolutePath: tempDir,
                relativePath: 'plugins/TestChat/10/arc_cinematics',
                storageTurnKey: '10'
            })
        },
        llm: {
            withSchema: async () => {
                llmStarted = true;
                await llmBlocker;
                return {
                    content: {
                        title: 'Async Arc',
                        stanzas: [{ lines: ['a', 'b', 'c', 'd'] }]
                    }
                };
            }
        }
    });

    await logic.runPreWriter(turnContext, tools);

    assert.equal(turnContext.runtime.plugins.arc_cinematics.requestStatus, 'queued');
    assert.equal(tools._runtimeState.arcCinematics.pendingRequests.length, 1);
    resolveLlm();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(llmStarted, true);
});

test('Post-VN finalizes queued Pre-Writer request into persisted intercept', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-cinematics-postvn-'));
    const turnContext = {
        turnNumber: 11,
        projectName: 'TestProject',
        runtime: {
            plugins: {
                arc_cinematics: {
                    request: {
                        arcId: 'postvn_arc',
                        title: 'Post VN Arc',
                        preferCg: false
                    }
                }
            },
            assets: { osts: [], backgrounds: [], sprites: [] }
        },
        output: {
            sequence: [],
            guiIntercepts: [],
            finalBackground: 'backgrounds/town.png'
        },
        processed: {
            assetSelector: {}
        }
    };
    const tools = createTestTools({
        project: {
            getChatPluginStorage: () => ({
                absolutePath: tempDir,
                relativePath: 'plugins/TestChat/11/arc_cinematics',
                storageTurnKey: '11'
            })
        },
        gui: {
            registerPersistentIntercept: descriptor => {
                const safe = {
                    pluginId: logic.PLUGIN_ID,
                    ...descriptor
                };
                turnContext.output.guiIntercepts.push(safe);
                return safe;
            }
        }
    });

    await logic.runPreWriter(turnContext, tools);
    turnContext.output.sequence = [{ type: 'dialogue', text: 'Hello' }];
    await logic.runPostVnGeneration(turnContext, tools);

    assert.equal(turnContext.output.guiIntercepts.length, 2);
    assert.equal(turnContext.output.guiIntercepts[0].checkpoint, 'before_first_dialogue');
    assert.equal(turnContext.output.guiIntercepts[0].replayPolicy, 'every_enter');
    assert.match(turnContext.output.guiIntercepts[0].interceptId, /^arc_cinematic_.*_pending_notice$/);
    assert.equal(turnContext.output.guiIntercepts[0].handlerRef, 'guiIntercepts.arc_cinematic_pending_notice');
    assert.equal(turnContext.output.guiIntercepts[1].checkpoint, 'before_first_dialogue');
    assert.equal(turnContext.output.guiIntercepts[1].replayPolicy, 'every_enter');
    assert.match(turnContext.output.guiIntercepts[1].interceptId, /^arc_cinematic_/);
});

test('selectCinematicOst prefers intro filename keywords', async () => {
    const result = await logic.selectCinematicOst({}, {
        assets: {
            listOst: async () => ['assets/ost/battle_theme.mp3', 'assets/ost/soft_intro.ogg']
        }
    }, {}, logic.normalizeSettings());

    assert.equal(result.path, 'assets/ost/soft_intro.ogg');
    assert.equal(result.source, 'keyword');
});

test('selectCinematicOst normalizes absolute project OST paths', async () => {
    const absoluteIntro = 'C:/Users/ineyv/Documents/Repos/llmproj/workspace/projects/DehyaCandace/assets/ost/Introduction to a Little Friend.mp3';
    const result = await logic.selectCinematicOst({
        runtime: { assets: { osts: [absoluteIntro] } }
    }, {
        assets: { listOst: async () => [] }
    }, {}, logic.normalizeSettings());

    assert.equal(result.path, 'assets/ost/Introduction to a Little Friend.mp3');
    assert.equal(result.source, 'keyword');
});

test('selectCinematicOst falls back to asset selector category choices', async () => {
    const turnContext = {
        processed: {
            assetSelector: {
                ostChoicesByCategory: {
                    calm: ['calm_theme.mp3'],
                    happy: [],
                    sad: [],
                    battle: []
                }
            }
        }
    };
    const tools = {
        assets: {
            listOst: async () => ['assets/ost/calm_theme.mp3', 'assets/ost/battle_theme.mp3']
        }
    };
    const result = await logic.selectCinematicOst(turnContext, tools, { mood: 'quiet farewell' }, logic.normalizeSettings());

    assert.equal(result.path, 'assets/ost/calm_theme.mp3');
    assert.equal(result.source, 'category');
});

test('selectCinematicOst falls back to current final song', async () => {
    const result = await logic.selectCinematicOst({
        output: { finalSong: 'ost/current_theme.mp3' },
        processed: { assetSelector: {} }
    }, {
        assets: {
            listOst: async () => ['assets/ost/current_theme.mp3']
        }
    }, {}, logic.normalizeSettings());

    assert.equal(result.path, 'assets/ost/current_theme.mp3');
    assert.equal(result.source, 'finalSong');
});

test('buildPoemMessages uses compressed story context as first user message', async () => {
    const messages = await logic.buildPoemMessages({
        request: {
            title: 'Moonlit Lease',
            reason: 'A new chapter opens after a pact',
            mood: 'tender intrigue',
            styleHint: 'Sumeru night market'
        },
        sourceRange: { startTurn: 4, endTurn: 9, explicit: true },
        sourceDigest: 'Turn 9\nSynopsis: Dehya and Candace made a careful promise.'
    }, [], logic.normalizeSettings(), {
        runtime: {
            historyData: {
                compressedHistory: {
                    balanced: 'Chapter 1: The desert road brought Dehya and Candace together.'
                }
            }
        }
    }, {});

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.match(messages[0].content, /Story So Far \(compressedHistory\.balanced/);
    assert.match(messages[0].content, /The desert road brought Dehya and Candace together/);
    assert.match(messages[0].content, /Since The Last Arc Intro/);
    assert.match(messages[0].content, /Focused arc range: Chapters 4 to 9/);
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /Write the opening lyrics/);
    assert.match(messages[1].content, /Title seed: Moonlit Lease/);
    assert.match(messages[1].content, /relevantCharacters and environmentVibes/);
    assert.match(messages[1].content, /Return only valid JSON/);
    assert.match(messages[1].content, /"stanzas"/);
    assert.match(messages[1].content, /"characterBeats"/);
    assert.match(messages[1].content, /"vfxBeat"/);
    assert.match(messages[1].content, /choose none for every stanza/i);
    assert.match(messages[1].content, /strongly prefer a fitting non-neutral emotion/);
    assert.doesNotMatch(messages[1].content, /"lines": \["\.\.\.", "\.\.\."\],/);
    assert.doesNotMatch(messages[1].content, /Arc id:/);
    assert.doesNotMatch(messages[1].content, /visualPrompt per stanza/);
});

test('buildPoemMessages keeps global intro VFX out of stanza vfxBeat choices', async () => {
    const messages = await logic.buildPoemMessages({
        request: {},
        sourceDigest: 'Turn 1\nSynopsis: The party enters a misty ruin.'
    }, [], logic.normalizeSettings(), { runtime: {} }, {
        plugins: {
            isInstalled: id => id === 'vn_pixijs_vfx',
            get: id => id === 'vn_pixijs_vfx'
                ? {
                    exports: {
                        getVfxPromptForBucket: async () => 'Plugin says intro-dream-glitch and embers exist.',
                        getVfxEffectIds: async () => ['intro-dream-glitch', 'embers']
                    }
                }
                : null
        },
        assets: {
            getSpriteCatalog: async () => ({ characters: {} })
        }
    });

    assert.match(messages[1].content, /Automatic global stanza VFX pool, not for vfxBeat: intro-dream-glitch/);
    assert.match(messages[1].content, /Optional additional atmospheric vfxBeat ids: none, embers/);
    assert.match(messages[1].content, /Choose vfxBeat\.id only from: none, embers/);
    assert.doesNotMatch(messages[1].content, /Choose vfxBeat\.id only from:.*intro-dream-glitch/);
    assert.match(messages[1].content, /Plugin says intro-dream-glitch and embers exist/);
    assert.match(messages[1].content, /Do not choose intro-\* effects in vfxBeat/);
});

test('buildPoemMessages chooses smallest compressed view covering explicit range', async () => {
    const chapters = Array.from({ length: 35 }, (_, index) => ({
        turnNumber: index + 1,
        output: {
            synopsis: `Synopsis ${index + 1}`,
            summary: `Summary ${index + 1}`
        }
    }));
    const messages = await logic.buildPoemMessages({
        request: {},
        sourceRange: { startTurn: 20, endTurn: 35, explicit: true },
        sourceDigest: 'Turn 20\nSynopsis: Arc begins.\n\nTurn 35\nSynopsis: Arc ends.'
    }, [], logic.normalizeSettings(), {
        runtime: {
            chapterHistory: {
                synopsischapters: chapters,
                summarychapters: [],
                fullchapters: []
            },
            historyData: {
                compressedHistory: {
                    brief: 'BRIEF 21-35',
                    balanced: 'BALANCED 5-35',
                    deep: 'DEEP 1-35'
                }
            }
        }
    }, {});

    assert.match(messages[0].content, /Story So Far \(compressedHistory\.balanced:range_full_coverage\)/);
    assert.match(messages[0].content, /BALANCED 5-35/);
    assert.doesNotMatch(messages[0].content, /BRIEF 21-35/);
    assert.doesNotMatch(messages[0].content, /DEEP 1-35/);
});

test('diffusion compiler prompt declares JSON output shape', () => {
    const template = readPromptTemplate('cg_diffusion_compiler.txt');

    assert.match(template, /Return only valid JSON/);
    assert.match(template, /"prompt": "comma-separated positive prompt here"/);
    assert.match(template, /infer the fictional setting, genre, and technology level/);
    assert.match(template, /Only include modern-world locations or technology when the visual plan explicitly calls for them/);
});

test('buildPoemMessages falls back to turnContext formatted history', async () => {
    let called = false;
    const messages = await logic.buildPoemMessages({
        request: {},
        sourceDigest: ''
    }, [], logic.normalizeSettings(), {
        runtime: {},
        getFormattedHistory: async (options) => {
            called = true;
            assert.deepEqual(options.tierConfig, { fulltext: 1, summary: 7, synopsis: 10 });
            return 'Chapter 3:\nA compact formatted history.';
        }
    }, {});

    assert.equal(called, true);
    assert.match(messages[0].content, /Story So Far \(turnContext\.getFormattedHistory\)/);
    assert.match(messages[0].content, /A compact formatted history/);
});

test('extractProminentColorsFromImage ranks dominant visible colors and skips transparency', async () => {
    if (!paletteExtraction.hasSharp()) return;
    const sharp = require('sharp');
    const width = 10;
    const height = 10;
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        if (index < 70) {
            pixels[offset] = 240;
            pixels[offset + 1] = 30;
            pixels[offset + 2] = 20;
            pixels[offset + 3] = 255;
        } else if (index < 90) {
            pixels[offset] = 20;
            pixels[offset + 1] = 40;
            pixels[offset + 2] = 220;
            pixels[offset + 3] = 255;
        } else {
            pixels[offset] = 20;
            pixels[offset + 1] = 240;
            pixels[offset + 2] = 20;
            pixels[offset + 3] = 0;
        }
    }

    const image = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const colors = await paletteExtraction.extractProminentColorsFromImage(image, {
        paletteSize: 2,
        sampleSize: 16
    });

    assert.equal(colors.length, 2);
    assert.ok(colors[0].rgb[0] > 0.75);
    assert.ok(colors[0].rgb[1] < 0.3);
    assert.ok(colors.every(color => color.rgb[1] < 0.6));
});

test('buildPaletteImageCandidates prefers generated CG before fallback background', () => {
    const candidates = logic._private.buildPaletteImageCandidates({
        assets: {
            backgrounds: {
                generated: [{ stanzaIndex: 1, path: 'plugins/Main/1/arc_cinematics/cg_1.webp' }],
                fallback: [
                    { index: 0, path: 'backgrounds/a.png', source: 'vn' },
                    { index: 1, path: 'backgrounds/b.png', source: 'vn' }
                ]
            }
        }
    }, 1);

    assert.deepEqual(candidates.map(candidate => candidate.source), ['cg', 'fallback']);
    assert.equal(candidates[0].path, 'plugins/Main/1/arc_cinematics/cg_1.webp');
    assert.equal(candidates[1].path, 'assets/backgrounds/b.png');
});

test('extractStanzaBackgroundPalettes writes fallback image palette into manifest', async () => {
    if (!paletteExtraction.hasSharp()) return;
    const sharp = require('sharp');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-palette-'));
    const imagePath = path.join(tempDir, 'fallback.png');
    await sharp({
        create: {
            width: 8,
            height: 8,
            channels: 4,
            background: { r: 15, g: 120, b: 220, alpha: 1 }
        }
    }).png().toFile(imagePath);

    const manifest = {
        poem: { stanzas: [{ lines: ['a', 'b', 'c', 'd'] }] },
        assets: {
            backgrounds: {
                generated: [],
                fallback: [{ path: 'backgrounds/fallback.png' }]
            }
        }
    };

    await logic._private.extractStanzaBackgroundPalettes({}, {
        assets: {
            resolvePath: () => imagePath
        }
    }, manifest, logic.normalizeSettings());

    assert.equal(manifest.assets.backgroundPalettes.length, 1);
    assert.equal(manifest.assets.backgroundPalettes[0].source, 'fallback');
    assert.equal(manifest.assets.backgroundPalettes[0].colors.length, 1);
    assert.ok(manifest.assets.backgroundPalettes[0].colors[0].rgb[2] > 0.7);
});

test('buildPlaybackPayload converts project assets to bridge URLs', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'arc_1',
        request: { type: 'intro', arcId: 'default' },
        poem: {
            title: 'Arc Opening',
            stanzas: [{
                lines: ['a', 'b', 'c', 'd'],
                characterBeats: [{ name: 'Mira', emotion: 'happy' }],
                vfxBeat: { id: 'embers', intensity: 'medium', reason: 'The stanza glows with old battle heat.' },
                sprites: [{ name: 'Mira', emotion: 'happy', resolvedEmotion: 'happy', path: 'sprites/Mira/happy.png' }]
            }]
        },
        assets: {
            ost: { path: 'ost/intro.mp3', source: 'keyword' },
            sprites: [{ name: 'Mira', path: 'sprites/Mira/neutral.png' }],
            backgroundPalettes: [{
                stanzaIndex: 0,
                source: 'cg',
                path: 'plugins/Main/1/arc_cinematics/cg.webp',
                colors: [
                    { hex: '#aa5522', rgb: [0.67, 0.33, 0.13], weight: 0.5 },
                    { hex: '#224466', rgb: [0.13, 0.27, 0.4], weight: 0.25 }
                ],
                extractedAt: '2026-06-03T00:00:00.000Z'
            }],
            backgrounds: {
                generated: [{ stanzaIndex: 0, path: 'plugins/Main/1/arc_cinematics/cg.webp' }],
                fallback: [{ path: 'backgrounds/town.png' }]
            }
        },
        playback: { maximumDurationSeconds: 60, vfxEnabled: true }
    });

    assert.equal(payload.ost.path, 'project://assets/ost/intro.mp3');
    assert.deepEqual(payload.sprites, [{
        index: 0,
        name: 'Mira',
        path: 'project://assets/sprites/Mira/neutral.png'
    }]);
    assert.equal(payload.spriteCollageEnabled, true);
    assert.deepEqual(payload.stanzas[0].characterBeats, [{ name: 'Mira', emotion: 'happy' }]);
    assert.deepEqual(payload.stanzas[0].vfxBeat, {
        id: 'embers',
        intensity: 'medium',
        reason: 'The stanza glows with old battle heat.'
    });
    assert.deepEqual(payload.stanzas[0].sprites, [{
        index: 0,
        name: 'Mira',
        emotion: 'happy',
        resolvedEmotion: 'happy',
        path: 'project://assets/sprites/Mira/happy.png'
    }]);
    assert.equal(payload.stanzas[0].shaderPalette.source, 'cg');
    assert.equal(payload.stanzas[0].shaderPalette.colors.length, 2);
    assert.equal(payload.backgrounds[0].path, 'project://plugins/Main/1/arc_cinematics/cg.webp');
    assert.equal(payload.backgrounds[1].path, 'project://assets/backgrounds/town.png');
    assert.equal(payload.maximumDurationSeconds, 60);
    assert.equal(payload.vfxEnabled, true);
    assert.ok(payload.availableIntroVfxIds.includes('none'));
    assert.ok(payload.availableIntroVfxIds.includes('fog'));
    assert.equal(payload.availableIntroVfxIds.includes('intro-brush-reveal'), false);
    assert.deepEqual(payload.introTransitionVfxSequence, []);
    assert.equal(payload.introStanzaVfxSequence.length, 1);
    assert.equal(payload.introStanzaVfxSequence[0].stanzaIndex, 0);
    assert.ok([
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid',
        'intro-shader-art',
        'intro-protean-clouds',
        'intro-star-nest',
        'intro-monster',
        'intro-tunnel-runner',
        'intro-palace-of-mind',
        'intro-blue-002',
        'intro-ether',
        'intro-zippy-zaps',
        'intro-biomine',
        'intro-bal-khan-tunnel',
        'intro-warp-speed',
        'intro-gilded-kaleidoscope',
        'intro-topologica',
        'intro-transparent-cube-field'
    ].includes(payload.introStanzaVfxSequence[0].id));
});

test('buildPlaybackPayload suppresses stanza sprites for premium reference CG backgrounds', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'premium_ref',
        request: { type: 'intro', arcId: 'default' },
        cg: {
            modelTier: 'premium',
            promptMode: 'llm_instruction_with_references'
        },
        poem: {
            title: 'Premium Opening',
            stanzas: [
                {
                    index: 0,
                    lines: ['a', 'b', 'c', 'd'],
                    sprites: [{ name: 'Mira', path: 'sprites/Mira/neutral.png' }]
                },
                {
                    index: 1,
                    lines: ['e', 'f', 'g', 'h'],
                    sprites: [{ name: 'Sora', path: 'sprites/Sora/neutral.png' }]
                }
            ]
        },
        assets: {
            sprites: [],
            backgrounds: {
                generated: [{ stanzaIndex: 0, path: 'plugins/Main/1/arc_cinematics/cg_0.webp' }],
                fallback: [{ path: 'backgrounds/fallback.png' }]
            }
        },
        playback: { maximumDurationSeconds: 60, vfxEnabled: true }
    });

    assert.equal(payload.cgPlaybackMode.premiumReference, true);
    assert.equal(payload.stanzas[0].suppressSprites, true);
    assert.equal(payload.stanzas[0].softenShadersOverImage, true);
    assert.equal(payload.stanzas[1].suppressSprites, false);
    assert.equal(payload.stanzas[1].softenShadersOverImage, false);
});

test('buildPlaybackPayload keeps sprites for premium non-reference CG mode', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'premium_no_ref',
        request: { type: 'intro', arcId: 'default' },
        cg: {
            modelTier: 'premium',
            promptMode: 'llm_instruction'
        },
        poem: {
            title: 'Premium Opening',
            stanzas: [{
                index: 0,
                lines: ['a', 'b', 'c', 'd'],
                sprites: [{ name: 'Mira', path: 'sprites/Mira/neutral.png' }]
            }]
        },
        assets: {
            sprites: [],
            backgrounds: {
                generated: [{ stanzaIndex: 0, path: 'plugins/Main/1/arc_cinematics/cg_0.webp' }],
                fallback: []
            }
        },
        playback: { maximumDurationSeconds: 60, vfxEnabled: true }
    });

    assert.equal(payload.cgPlaybackMode.premiumReference, false);
    assert.equal(payload.stanzas[0].suppressSprites, false);
    assert.equal(payload.stanzas[0].softenShadersOverImage, false);
});

test('buildPlaybackPayload prefers explicit request title and subtitle', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'arc_2',
        request: {
            title: 'Planner Arc Title',
            subtitle: 'Planner Subtitle',
            reason: 'Mechanical trigger reason'
        },
        poem: {
            title: 'LLM Generated Title',
            subtitle: 'LLM Subtitle',
            stanzas: [{ lines: ['a', 'b', 'c', 'd'] }]
        },
        assets: {
            backgrounds: { fallback: [], generated: [] },
            sprites: []
        },
        playback: { maximumDurationSeconds: 60 }
    });

    assert.equal(payload.title, 'Planner Arc Title');
    assert.equal(payload.subtitle, 'Planner Subtitle');
});

test('buildPlaybackPayload lets generated title replace debug placeholder title', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'arc_debug',
        request: {
            title: 'Opening'
        },
        poem: {
            title: 'Ashes Under Violet Rain',
            generatedTitle: 'Ashes Under Violet Rain',
            stanzas: [{ lines: ['a', 'b', 'c', 'd'] }]
        },
        assets: {
            backgrounds: { fallback: [], generated: [] },
            sprites: []
        },
        playback: { maximumDurationSeconds: 60 }
    });

    assert.equal(payload.title, 'Ashes Under Violet Rain');
});

test('buildPlaybackPayload injects intro shader sequence for old manifests at playback time', () => {
    const payload = logic.buildPlaybackPayload({
        requestId: 'old_manifest',
        request: { type: 'intro', arcId: 'default' },
        poem: {
            title: 'Old Opening',
            stanzas: [
                { lines: ['a', 'b', 'c', 'd'] },
                { lines: ['e', 'f', 'g', 'h'] }
            ]
        },
        playback: {
            vfxEnabled: true,
            maximumDurationSeconds: 60
        },
        assets: {
            ost: null,
            sprites: [],
            backgrounds: { generated: [], fallback: [] }
        }
    });

    assert.equal(payload.introStanzaVfxSequence.length, 2);
    assert.deepEqual(payload.introStanzaVfxSequence.map(entry => entry.stanzaIndex), [0, 1]);
    assert.ok(payload.introStanzaVfxSequence.every(entry => [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid',
        'intro-shader-art',
        'intro-protean-clouds',
        'intro-star-nest',
        'intro-monster',
        'intro-tunnel-runner',
        'intro-palace-of-mind',
        'intro-blue-002',
        'intro-ether',
        'intro-zippy-zaps',
        'intro-biomine',
        'intro-bal-khan-tunnel',
        'intro-warp-speed',
        'intro-gilded-kaleidoscope',
        'intro-topologica',
        'intro-transparent-cube-field'
    ].includes(entry.id)));
    assert.notEqual(payload.introStanzaVfxSequence[0].id, payload.introStanzaVfxSequence[1].id);
});

test('buildPlaybackPayload creates a fresh runtime shader seed per payload build', () => {
    const manifest = {
        requestId: 'arc_vfx_runtime_seed',
        request: { arcId: 'vfx' },
        playback: {
            vfxEnabled: true,
            introStanzaVfxIds: [
                'intro-raymarch-fractal',
                'intro-octagrams',
                'intro-fractal-pyramid',
                'intro-shader-art'
            ]
        },
        poem: {
            title: 'Shader Seed',
            stanzas: [
                { lines: ['One', 'Two', 'Three', 'Four'] },
                { lines: ['Five', 'Six', 'Seven', 'Eight'] }
            ]
        }
    };

    const payloadA = logic.buildPlaybackPayload(manifest);
    const payloadB = logic.buildPlaybackPayload(manifest);

    assert.match(payloadA.introStanzaVfxSeed, /^arc_vfx_runtime_seed:vfx:/);
    assert.match(payloadB.introStanzaVfxSeed, /^arc_vfx_runtime_seed:vfx:/);
    assert.notEqual(payloadA.introStanzaVfxSeed, payloadB.introStanzaVfxSeed);
    assert.equal(payloadA.introStanzaVfxSequence.length, 2);
    assert.equal(payloadB.introStanzaVfxSequence.length, 2);
});

test('normalizePoemResponse uses LLM title when request title is absent', () => {
    const response = logic._private.normalizePoemResponse({
        title: 'LLM Opening Title',
        subtitle: 'LLM Subtitle',
        stanzas: [{ lines: ['a', 'b', 'c', 'd'] }]
    }, { title: '', reason: 'Mechanical reason' }, logic.normalizeSettings(), [], ['neutral']);

    assert.equal(response.title, 'LLM Opening Title');
    assert.equal(response.subtitle, 'LLM Subtitle');
});

test('normalizePoemResponse uses LLM title when request title is placeholder', () => {
    const response = logic._private.normalizePoemResponse({
        title: 'LLM Opening Title',
        stanzas: [{ lines: ['a', 'b', 'c', 'd'] }]
    }, { title: 'Opening' }, logic.normalizeSettings(), [], ['neutral']);

    assert.equal(response.title, 'LLM Opening Title');
});

test('normalizePoemResponse keeps stanza visual plans', () => {
    const response = logic._private.normalizePoemResponse({
        title: 'Opening',
        lines: ['a', 'b', 'c', 'd'],
        stanzas: [{
            lines: ['a', 'b', 'c', 'd'],
            relevantCharacters: ['Dehya', 'Candace'],
            characterBeats: [
                { name: 'Dehya', emotion: 'soft' },
                { name: 'Candace', emotion: 'unknown_emotion' }
            ],
            vfxBeat: {
                id: 'fog',
                intensity: 'medium',
                reason: 'The garden memory is hazy.'
            },
            environmentVibes: {
                locationType: 'desert inn garden',
                atmosphere: 'tender intrigue',
                palette: 'teal and gold',
                visualMotifs: ['rose petals', 'lanterns']
            }
        }]
    }, { mood: 'quiet' }, logic.normalizeSettings(), [], ['neutral', 'soft']);

    assert.deepEqual(response.stanzas[0].relevantCharacters, ['Dehya', 'Candace']);
    assert.deepEqual(response.stanzas[0].characterBeats, [
        { name: 'Dehya', emotion: 'soft' },
        { name: 'Candace', emotion: 'neutral' }
    ]);
    assert.deepEqual(response.stanzas[0].vfxBeat, {
        id: 'fog',
        intensity: 'medium',
        reason: 'The garden memory is hazy.'
    });
    assert.equal(response.stanzas[0].environmentVibes.locationType, 'desert inn garden');
    assert.deepEqual(response.stanzas[0].environmentVibes.visualMotifs, ['rose petals', 'lanterns']);
});

test('normalizePoemResponse normalizes unknown stanza VFX to none', () => {
    const response = logic._private.normalizePoemResponse({
        title: 'Opening',
        stanzas: [{
            lines: ['a', 'b', 'c', 'd'],
            vfxBeat: { id: 'glitch', intensity: 'extreme', reason: 'too much' }
        }]
    }, {}, logic.normalizeSettings(), [], ['neutral'], ['none', 'fog']);

    assert.deepEqual(response.stanzas[0].vfxBeat, {
        id: 'none',
        intensity: 'subtle',
        reason: 'too much'
    });
});

test('normalizePoemResponse keeps intro-only global VFX out of vfxBeat', () => {
    const response = logic._private.normalizePoemResponse({
        title: 'Opening',
        stanzas: [{
            lines: ['a', 'b', 'c', 'd'],
            vfxBeat: { id: 'intro-dream-glitch', intensity: 'medium', reason: 'The memory bends like water.' }
        }]
    }, {}, logic.normalizeSettings(), [], ['neutral'], ['none', 'intro-dream-glitch']);

    assert.deepEqual(response.stanzas[0].vfxBeat, {
        id: 'none',
        intensity: 'subtle',
        reason: 'The memory bends like water.'
    });
});

test('buildIntroStanzaVfxSequence assigns deterministic non-repeating future intro effects', () => {
    const sequenceA = logic._private.buildIntroStanzaVfxSequence(8, 'arc-seed', [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid'
    ]);
    const sequenceB = logic._private.buildIntroStanzaVfxSequence(8, 'arc-seed', [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid'
    ]);

    assert.deepEqual(sequenceA, sequenceB);
    assert.equal(sequenceA.length, 8);
    for (let index = 1; index < sequenceA.length; index += 1) {
        assert.notEqual(sequenceA[index].id, sequenceA[index - 1].id);
    }
    assert.ok(sequenceA.every(entry => [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid'
    ].includes(entry.id)));
    assert.ok(sequenceA.some(entry => entry.id === 'intro-octagrams'));
});

test('buildIntroStanzaVfxSequence fills every stanza from available intro shaders', () => {
    const sequence = logic._private.buildIntroStanzaVfxSequence(4, 'arc-seed', [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid',
        'intro-shader-art',
        'intro-protean-clouds',
        'intro-star-nest',
        'intro-monster',
        'intro-tunnel-runner',
        'intro-palace-of-mind',
        'intro-blue-002',
        'intro-ether',
        'intro-zippy-zaps',
        'intro-biomine',
        'intro-bal-khan-tunnel',
        'intro-warp-speed',
        'intro-gilded-kaleidoscope',
        'intro-topologica',
        'intro-transparent-cube-field'
    ]);

    assert.equal(sequence.length, 4);
    assert.deepEqual(sequence.map(entry => entry.stanzaIndex), [0, 1, 2, 3]);
    assert.ok(sequence.every(entry => [
        'intro-raymarch-fractal',
        'intro-octagrams',
        'intro-fractal-pyramid',
        'intro-shader-art',
        'intro-protean-clouds',
        'intro-star-nest',
        'intro-monster',
        'intro-tunnel-runner',
        'intro-palace-of-mind',
        'intro-blue-002',
        'intro-ether',
        'intro-zippy-zaps',
        'intro-biomine',
        'intro-bal-khan-tunnel',
        'intro-warp-speed',
        'intro-gilded-kaleidoscope',
        'intro-topologica',
        'intro-transparent-cube-field'
    ].includes(entry.id)));
    for (let index = 1; index < sequence.length; index += 1) {
        assert.notEqual(sequence[index].id, sequence[index - 1].id);
    }
});

test('collectAvailableSpriteEmotions extracts displayable global emotions', async () => {
    const emotions = await poemPrompting.collectAvailableSpriteEmotions({
        assets: {
            getSpriteCatalog: async () => ({
                characters: {
                    mira: {
                        variantData: {
                            default: {
                                emotionData: {
                                    neutral: { F: true },
                                    happy: { R: true },
                                    icon_only: { I: true },
                                    reference_only: { R_ref: true }
                                }
                            }
                        }
                    },
                    sora: {
                        variantData: {
                            default: {
                                emotionData: {
                                    sad: { T: true }
                                }
                            }
                        }
                    }
                }
            })
        }
    });

    assert.deepEqual(emotions, ['neutral', 'happy', 'sad']);
});

test('normalizeCharacterBeats creates neutral fallback beats from relevant characters', () => {
    const beats = logic._private.normalizeCharacterBeats([], ['Mira', 'Generic NPC', 'Sora'], ['neutral', 'happy']);

    assert.deepEqual(beats, [
        { name: 'Mira', emotion: 'neutral' },
        { name: 'Sora', emotion: 'neutral' }
    ]);
});

test('resolveStanzaSpriteBeats discards literal generic and npc sprite paths', async () => {
    const resolved = await logic._private.resolveStanzaSpriteBeats({}, {
        assets: {
            getSpriteCatalog: async () => ({
                characters: {
                    mira: { variantData: { default: { emotionData: { neutral: { F: true }, happy: { F: true } } } } }
                }
            }),
            findCharacterSprite: async (name, emotion) => {
                if (name === 'Mira') return { image: `assets/sprites/Mira/${emotion}.png` };
                if (name === 'Guard') return { image: 'assets/sprites/guard/generic_guard.png' };
                return { image: 'assets/sprites/npc/neutral.png' };
            }
        }
    }, [{
        lines: ['a', 'b', 'c', 'd'],
        characterBeats: [
            { name: 'Mira', emotion: 'happy' },
            { name: 'Guard', emotion: 'neutral' },
            { name: 'Traveler', emotion: 'neutral' }
        ]
    }]);

    assert.deepEqual(resolved[0].sprites, [{
        name: 'Mira',
        emotion: 'happy',
        resolvedEmotion: 'happy',
        path: 'assets/sprites/Mira/happy.png'
    }]);
});

test('resolveStanzaSpriteBeats tries non-neutral sprite variants before neutral fallback', async () => {
    const calls = [];
    const resolved = await logic._private.resolveStanzaSpriteBeats({}, {
        assets: {
            getSpriteCatalog: async () => ({
                characters: {
                    mira: {
                        variantData: {
                            default: {
                                emotionData: {
                                    neutral: { F: true },
                                    happy: { F: true },
                                    sad: { F: true }
                                }
                            }
                        }
                    }
                }
            }),
            findCharacterSprite: async (_name, emotion) => {
                calls.push(emotion);
                return { image: `assets/sprites/Mira/${emotion}.png` };
            }
        }
    }, [{
        lines: ['a', 'b', 'c', 'd'],
        characterBeats: [{ name: 'Mira', emotion: 'neutral' }]
    }]);

    assert.equal(resolved[0].sprites.length, 1);
    assert.notEqual(resolved[0].sprites[0].resolvedEmotion, 'neutral');
    assert.notEqual(resolved[0].sprites[0].path, 'assets/sprites/Mira/neutral.png');
    assert.ok(calls.some(emotion => emotion !== 'neutral'));
});

test('Path 1 CG request compiles background-only diffusion prompt without references', async () => {
    const outputPath = 'plugins/Main/1/arc_cinematics/cg.webp';
    const result = await logic._private.buildCgRequestForStanza({}, {}, {
        request: {
            mood: 'tender intrigue',
            styleHint: 'warm Sumeru night',
            cgPromptMode: 'diffusion_positive'
        },
        assets: { sprites: [] }
    }, {
        lines: ['The lantern waits', 'The roses turn', 'The promise breathes', 'The dawn listens'],
        relevantCharacters: ['Dehya', 'Candace'],
        environmentVibes: {
            locationType: 'garden inn courtyard',
            atmosphere: 'soft romantic tension',
            visualMotifs: ['lantern light', 'rose petals']
        }
    }, logic.normalizeSettings(), outputPath);

    assert.equal(result.promptMode, 'diffusion_positive');
    assert.equal(result.request.outputPath, outputPath);
    assert.deepEqual(result.request.references || [], []);
    assert.match(result.request.prompt, /empty environment|unoccupied scene/);
    assert.doesNotMatch(result.request.prompt, /Dehya|Candace/);
});

test('Path 3 CG request attaches sprite references when available', async () => {
    const outputPath = 'plugins/Main/1/arc_cinematics/cg.webp';
    const result = await logic._private.buildCgRequestForStanza({}, {
        assets: {
            findCharacterSprite: async (name) => ({ image: `assets/sprites/${name}/neutral.png` })
        }
    }, {
        request: {
            mood: 'heroic',
            cgPromptMode: 'llm_instruction_with_references'
        },
        assets: { sprites: [] }
    }, {
        lines: ['A blade of light', 'A gate remembers', 'A friend returns', 'The sky opens'],
        relevantCharacters: ['Mira'],
        environmentVibes: {
            locationType: 'ruined city gate',
            atmosphere: 'heroic sunrise'
        }
    }, logic.normalizeSettings(), outputPath);

    assert.equal(result.promptMode, 'llm_instruction_with_references');
    assert.equal(result.request.references.length, 1);
    assert.equal(result.request.references[0].path, 'assets/sprites/Mira/neutral.png');
    assert.match(result.request.prompt, /Referenced characters available: Mira/);
});

test('maybeGenerateCgAssets launches stanza CG requests in parallel', async () => {
    const starts = [];
    const resolvers = [];
    const manifest = {
        requestId: 'parallel_cg',
        request: { preferCg: true },
        storage: { relativePath: 'plugins/TestChat/1/arc_cinematics' },
        poem: {
            stanzas: [
                { index: 0, lines: ['a', 'b', 'c', 'd'] },
                { index: 1, lines: ['e', 'f', 'g', 'h'] },
                { index: 2, lines: ['i', 'j', 'k', 'l'] }
            ]
        },
        assets: { backgrounds: { generated: [] } },
        cg: { results: [] }
    };
    const tools = createTestTools({
        plugins: {
            isInstalled: pluginId => pluginId === 'cg_generator',
            tryCall: async (_pluginId, _method, [request]) => {
                starts.push(request.outputPath);
                return await new Promise(resolve => {
                    resolvers.push(() => resolve({ ok: true, outputPath: request.outputPath }));
                });
            }
        }
    });

    const run = logic._private.maybeGenerateCgAssets({}, tools, manifest, logic.normalizeSettings({
        cg_prompt_mode: 'llm_instruction'
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(starts.length, 3);
    for (const resolve of resolvers) resolve();
    const result = await run;

    assert.equal(result.cg.results.length, 3);
    assert.equal(result.assets.backgrounds.generated.length, 3);
});
