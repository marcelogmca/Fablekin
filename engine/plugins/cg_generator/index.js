// plugins/cg_generator/index.js

const logic = require('./logic.js');
const fs = require('fs/promises');
const path = require('path');

module.exports = {
    id: 'cg_generator',
    name: 'CG Generator',
    version: '1.3.2',
    author: 'Fablekin Core',
    category: 'Visual',
    wizard: {
        include: true,
        order: 650,
        group: 'Visual',
        label: 'CG Generator',
        recommended_enabled: false,
        author_note: 'High-impact visual feature, but only enable it if your image provider and budget are ready.',
        enabled_note: 'Fablekin can plan and generate full-screen CG illustrations for selected scene moments.',
        disabled_note: 'VN scenes keep using normal backgrounds, sprites, and effects without generated CG art.',
        settings_note: 'Configure image provider, model, CG count, and automatic generation behavior in plugin settings.'
    },
    description: 'Generates context-aware Visual Novel CG overlays with pluggable provider adapters, and exposes a public API for other plugins to request custom CG generation.',
    exports: {
        requestCustomCG: async (turnContext, tools, request = {}) => {
            return await logic.requestCustomCG(turnContext, tools, request);
        },
        requestCustomCGToFile: async (turnContext, tools, request = {}) => {
            return await logic.requestCustomCGToFile(turnContext, tools, request);
        },
        listSupportedProviders: async () => {
            return logic.listSupportedProviders();
        }
    },
    hooks: {
        /**
         * Blocking hook that runs AFTER the scene sequence is fully built (with sprites/backgrounds).
         * Runs the fast text-to-text LLM to figure out IF and WHERE a CG happens, injects metadata into 
         * the sequence, then spawns the heavy image generation asynchronously.
         */
        'HOOK_POST_VN_GENERATION': {
            priority: 2600,
            mode: 'sequential',
            allowInterlude: true,
            run: async (turnContext, tools) => {
                tools.logger.log('Extraction', 'HOOK_POST_VN_GENERATION fired for cg_generator (PLANNING).', 'start');
                try {
                    const pluginSettings = tools.settings.getSelf() || {};
                    const sceneMode = turnContext?.runtime?.turnPipeline?.sceneMode || 'mainline';
                    const isInterlude = sceneMode === 'interlude';

                    if (pluginSettings.enableTurnCgGeneration === false) {
                        tools.logger.log('CG-Generator', 'Skipping automatic turn CG generation (enableTurnCgGeneration=false).');
                        return;
                    }

                    if (isInterlude && pluginSettings.runOnInterludes === false) {
                        tools.logger.log('CG-Generator', 'Skipping interlude run (runOnInterludes=false).');
                        return;
                    }

                    // Phase 1: Blocking extraction against the final sequence array
                    await logic.extractCGPlan(turnContext, tools);

                    // Phase 2: Asynchronous image generation (Fire and Forget)
                    if (turnContext.cgPlan && turnContext.cgPlan.frames && turnContext.cgPlan.frames.length > 0) {
                        tools.logger.log('Generation', 'Spawning background image generation...', 'start');
                        logic.generateCGImages(turnContext, tools).catch(e => {
                            tools.logger.error('Generation', `Background CG Generation Error: ${e.message}`);
                        });
                    }
                } catch (error) {
                    tools.logger.error('Extraction', `Error in CG Generator Planning: ${error.message}`);
                } finally {
                    tools.logger.log('Extraction', 'HOOK_POST_VN_GENERATION complete for cg_generator.', 'end');
                }
            }
        },
        /**
         * Injects the lazy-loading JS into the VN Viewer.
         */
        'HOOK_FRONTEND_INJECTION': {
            priority: 50,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                try {
                    const jsPath = path.join(__dirname, 'frontend_injection.js');
                    const jsContent = await fs.readFile(jsPath, 'utf8');

                    tools.logger.log('CGGenerator', 'Injected frontend lazy-loader script.');
                    return { js: jsContent };
                } catch (error) {
                    tools.logger.error('CGGenerator', `Failed to inject frontend script: ${error.message}`);
                    return null;
                }
            }
        }
    },
    socketListeners: {},
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Analyzes dialogue scenes, selects moments for detailed full-screen illustrations (CGs), and renders them in the background using the selected image provider.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'High',
            latency: 'Low'
        },
        turnGenerationHeader: {
            type: 'header',
            label: 'Automatic Turn CG Generation'
        },
        enableTurnCgGeneration: {
            type: 'checkbox',
            label: 'Enable Turn CG Generation',
            description: 'When disabled, this plugin will not auto-generate CGs during HOOK_POST_VN_GENERATION. Public API calls from other plugins remain available.',
            default: true
        },
        runOnInterludes: {
            type: 'checkbox',
            label: 'Run On Interludes',
            description: 'When enabled, automatic turn CG generation is also allowed during interlude turns.',
            default: true
        },
        cgCount: {
            type: 'number',
            label: 'Target CG Count',
            description: 'How many CGs to request per scene during automatic turn generation.',
            min: 1,
            max: 3,
            default: 1
        },
        imageProvider: {
            type: 'select',
            label: 'Image Generation Provider',
            description: 'Choose which service to use for generated CG images.',
            options: [
                { value: 'wisgate', label: 'Wisgate (Mirror)' },
                { value: 'google', label: 'Google Gemini (Direct)' },
                { value: 'openrouter', label: 'OpenRouter' },
                { value: 'nanogpt', label: 'NanoGPT (OpenAI-compatible)' },
                { value: 'comfyui', label: 'ComfyUI (Workflow API)' },
                { value: 'openai', label: 'OpenAI Images API' },
                { value: 'replicate', label: 'Replicate Predictions API' },
                { value: 'fal', label: 'fal Queue API' }
            ],
            default: 'wisgate'
        },
        imageResolution: {
            type: 'select',
            label: 'CG Resolution',
            description: 'Preferred CG output resolution. Provider adapters map this to model-specific values and fall back when unsupported.',
            options: [
                { value: '4K', label: '4K (Highest)' },
                { value: '2K', label: '2K' },
                { value: '1K', label: '1K' },
                { value: 'auto', label: 'Auto (Highest Supported)' }
            ],
            default: '4K'
        },
        providerCredentialsHeader: {
            type: 'header',
            label: 'Provider Credentials'
        },
        apiKey: {
            type: 'secret',
            label: 'Wisgate API Key',
            description: 'The API key for Wisgate (Mirror) Gemini 3 Pro Image generation.'
        },
        googleApiKey: {
            type: 'secret',
            label: 'Google Gemini API Key',
            description: 'The direct API key for Google Gemini 3 Pro Image generation. (UNTESTED)'
        },
        openrouterApiKey: {
            type: 'secret',
            label: 'OpenRouter API Key',
            description: 'API key for OpenRouter image generation.'
        },
        nanoGptApiKey: {
            type: 'secret',
            label: 'NanoGPT API Key',
            description: 'API key for NanoGPT OpenAI-compatible images endpoint.'
        },
        openaiApiKey: {
            type: 'secret',
            label: 'OpenAI API Key',
            description: 'API key for OpenAI /v1/images/generations.'
        },
        replicateApiToken: {
            type: 'secret',
            label: 'Replicate API Token',
            description: 'Bearer token for Replicate predictions API.'
        },
        falApiKey: {
            type: 'secret',
            label: 'fal API Key',
            description: 'fal key used with queue.fal.run endpoints.'
        },
        comfyUiApiKey: {
            type: 'secret',
            label: 'ComfyUI API Key',
            description: 'Optional X-API-Key for secured ComfyUI endpoints.'
        },
        providerModelsHeader: {
            type: 'header',
            label: 'Model Tiers'
        },
        expensiveModel: {
            type: 'text',
            label: 'Expensive Model ID',
            description: 'Model used for highest quality. Must be valid for the selected provider.',
            default: ''
        },
        mediumModel: {
            type: 'text',
            label: 'Medium Model ID',
            description: 'Balanced cost/quality model. Must be valid for the selected provider.',
            default: ''
        },
        budgetModel: {
            type: 'text',
            label: 'Budget Model ID',
            description: 'Lowest-cost model. Must be valid for the selected provider.',
            default: ''
        },
        preferredModelTier: {
            type: 'select',
            label: 'Preferred Model Tier',
            description: 'Default tier used when a request does not explicitly ask for a tier.',
            options: [
                { value: 'expensive', label: 'Expensive' },
                { value: 'medium', label: 'Medium' },
                { value: 'budget', label: 'Budget' }
            ],
            default: 'expensive'
        },
        tierPricingHeader: {
            type: 'header',
            label: 'Tier Pricing (Turn Log Estimates)'
        },
        expensiveModelPricePerImage: {
            type: 'number',
            label: 'Expensive Price Per Image (USD)',
            description: 'Used for turn-log cost estimation when the expensive tier is selected.',
            min: 0,
            default: 0
        },
        mediumModelPricePerImage: {
            type: 'number',
            label: 'Medium Price Per Image (USD)',
            description: 'Used for turn-log cost estimation when the medium tier is selected.',
            min: 0,
            default: 0
        },
        budgetModelPricePerImage: {
            type: 'number',
            label: 'Budget Price Per Image (USD)',
            description: 'Used for turn-log cost estimation when the budget tier is selected.',
            min: 0,
            default: 0
        },
        nanoGptSize: {
            type: 'text',
            label: 'Image Size Override (Optional)',
            description: 'Optional exact provider size/resolution (e.g., 4k, 2k, 2048x1152). Leave empty to use CG Resolution.',
            default: ''
        },
        nanoGptTimeoutMs: {
            type: 'number',
            label: 'Provider Timeout (ms)',
            description: 'Per-request timeout for image provider network calls. Lower values fail faster and retry sooner; increase for slower high-resolution generations.',
            min: 30000,
            default: 240000
        },
        nanoGptAttemptsPerSize: {
            type: 'number',
            label: 'Provider Attempts Per Resolution',
            description: 'How many transport attempts to make for a resolution before falling back to the next best widescreen option when the provider supports fallback attempts.',
            min: 1,
            max: 5,
            default: 2
        },
        comfyUiHeader: {
            type: 'header',
            label: 'ComfyUI'
        },
        comfyUiBaseUrl: {
            type: 'text',
            label: 'ComfyUI Base URL',
            description: 'ComfyUI server URL. Example: http://127.0.0.1:8188',
            default: 'http://127.0.0.1:8188'
        },
        comfyUiWorkflowFile: {
            type: 'text',
            label: 'ComfyUI Workflow File',
            description: 'Path to a workflow JSON file (relative to project root or absolute within project root).',
            default: ''
        },
        comfyUiPromptNodeId: {
            type: 'text',
            label: 'ComfyUI Prompt Node ID',
            description: 'Optional CLIPTextEncode node id to force prompt text.',
            default: '6'
        },
        comfyUiNegativePromptNodeId: {
            type: 'text',
            label: 'ComfyUI Negative Prompt Node ID',
            description: 'Optional CLIPTextEncode node id for negative prompt.',
            default: '7'
        },
        comfyUiNegativePrompt: {
            type: 'text',
            label: 'ComfyUI Negative Prompt',
            description: 'Default negative prompt when using ComfyUI.',
            default: ''
        },
        comfyUiSeedNodeId: {
            type: 'text',
            label: 'ComfyUI Seed Node ID',
            description: 'Optional node id where `inputs.seed` should be injected.',
            default: '3'
        },
        comfyUiOutputNodeId: {
            type: 'text',
            label: 'ComfyUI Output Node ID',
            description: 'Optional node id to restrict where output images are pulled from.',
            default: ''
        },
        comfyUiUploadInputs: {
            type: 'checkbox',
            label: 'ComfyUI Upload Inputs',
            description: 'Upload image inputs to /upload/image before queueing the workflow.',
            default: true
        },
        comfyUiInputImageNodeIds: {
            type: 'text',
            label: 'ComfyUI Image Node IDs',
            description: 'Comma-separated LoadImage node IDs (first ID gets first image, etc.).',
            default: ''
        },
        comfyUiUploadSubfolder: {
            type: 'text',
            label: 'ComfyUI Upload Subfolder',
            description: 'Optional input subfolder for ComfyUI uploaded images.',
            default: ''
        },
        extractionHeader: {
            type: 'header',
            label: 'Extraction Behavior'
        },
        modelDef: {
            type: 'select',
            label: 'Extraction Model',
            description: 'Model used to extract framing, characters, and descriptions for the CG prompt.',
            options: 'llm-aliases',
            default: { model: 'highendmodel' }
        },
        minDurationPercentage: {
            type: 'number',
            label: 'Min Duration %',
            description: 'The minimum percentage into the scene where the CG should trigger.',
            min: 1,
            max: 100,
            default: 10
        },
        maxDurationPercentage: {
            type: 'number',
            label: 'Max Duration %',
            description: 'The maximum percentage into the scene where the CG should trigger.',
            min: 1,
            max: 100,
            default: 20
        },
        smartContinuity: {
            type: 'checkbox',
            label: 'Smart Visual Continuity',
            description: 'Enable RAG-based context retrieval for environments and characters without sprites to maintain visual consistency. This will try to keep places you revisit consistent and will reuse side characters that were drawn previously to keep them consistent as well.',
            default: false
        },
        imageInstructions: {
            type: 'text',
            label: 'Custom Image Instructions',
            description: 'Direct instructions to the Gemini image generator (e.g., "Give me a 3d artstyle"). This will be appended to every prompt.',
            default: ''
        }
    }
};
