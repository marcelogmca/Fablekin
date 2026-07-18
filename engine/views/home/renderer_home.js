const socket = io('http://localhost:14541');

const STEPS = [
    { id: 'start', label: 'Start Here' },
    { id: 'not-chat', label: 'Not Chat' },
    { id: 'power', label: 'Power Levels' },
    { id: 'credentials', label: 'Credentials' },
    { id: 'models', label: 'Models' },
    { id: 'tabs', label: 'Two Tabs' },
    { id: 'first-scene', label: 'First Scene' },
    { id: 'project', label: 'Make Your Own' },
    { id: 'assets', label: 'Assets' },
    { id: 'latency', label: 'Latency & Control' },
    { id: 'story-autonomy', label: 'Story Autonomy' },
    { id: 'native-systems', label: 'Native Systems' },
    { id: 'plugins', label: 'Plugins' }
];

const STEP_GROUPS = [
    { label: 'Set Up & Try It', start: 0, end: 6 },
    { label: 'Build Your Own', start: 7, end: 8 },
    { label: 'Tune The Engine', start: 9, end: 11 },
    { label: 'Modding Time', start: 12, end: Infinity }
];

const METRIC_WEIGHTS = {
    None: 0,
    Low: 1,
    Medium: 2,
    High: 3,
    Critical: 4
};

const NATIVE_HELPER_EXCLUDED_IDS = new Set(['writer', 'director', 'vn_background_tasks']);
const NATIVE_HELPER_GROUPS = [
    {
        label: 'Memory & Continuity',
        ids: ['memory_retriever', 'summarizer'],
        note: 'These are important continuity infrastructure. They keep long adventures usable by finding relevant context, compressing old scenes, and preserving the story as it grows.'
    },
    {
        label: 'VN Presentation',
        ids: ['dialogue_processor', 'asset_selector', 'emotion_classifier', 'gaze_director', 'sprite_variant_orchestrator'],
        note: 'These translate the written scene into a cleaner visual novel presentation: readable dialogue, assets, emotions, variants, and camera-facing behavior.'
    },
    {
        label: 'Gameplay Handoffs',
        ids: ['scene_phase_classifier'],
        note: 'These decide when generated story text should hand off into registered gameplay or interlude systems.'
    },
    {
        label: 'Character Utilities',
        ids: ['gender_classifier'],
        note: 'Small supporting utilities for character-aware fallbacks, voice routing, and generic asset choices.'
    }
];

const NATIVE_HELPER_EXECUTION_NOTES = {
    memory_retriever: 'Runs when the current turn has memory queries to search. It uses Ollama embeddings and local vector search, not a paid LLM completion.',
    summarizer: 'Runs every turn to create a summary and an even smaller synopsis of the new chapter. Those memory layers let Fablekin compress older chapters as the story grows while keeping their important context available.',
    dialogue_processor: 'Makes a model call only when the Writer output needs conversion or cleanup. If the Writer already produced clean character dialogue, it uses the fast path and makes no LLM call.',
    asset_selector: 'Makes selection calls only for enabled asset types that have files to choose from. No backgrounds means no background-selection call; no OST means no music-selection call.',
    emotion_classifier: 'Makes a model call only when the scene contains dialogue and this module is enabled. It can classify against a neutral fallback, so it is not automatically skipped just because a project has no emotion sprites.',
    gaze_director: 'Makes a model call only when rotation-capable sprites and dialogue are present. Without usable rotations, Fablekin skips gaze analysis entirely.',
    sprite_variant_orchestrator: 'Makes a model call only when the scene contains a character with real outfit or variant choices. Single-image sprites and scenes without dialogue skip it.',
    scene_phase_classifier: 'Makes a model call only when gameplay capabilities are registered and the current turn is inside an allowed handoff window. Otherwise it exits before calling a model.',
    gender_classifier: 'Never makes an LLM call. It checks known character facts first, then uses a local name-based fallback.'
};

const NATIVE_HELPER_DESCRIPTIONS = {
    gender_classifier: 'Small helper for generic sprite and voice routing when a character has no dedicated assets. For example, it can help Fablekin choose files such as generic_npc_female.webp or generic_male_voice.mp3.'
};

let setupData = null;
let currentStepIndex = Number(localStorage.getItem('fablekin.home.currentStep') || 0);
let currentCoreIndex = Number(localStorage.getItem('fablekin.home.coreIndex') || 0);
let currentPluginIndex = Number(localStorage.getItem('fablekin.home.pluginIndex') || 0);
let pluginRestartWarning = false;
let directorExampleText = null;
let directorExampleLoading = false;
let directorExampleError = '';
let writerCotExampleText = null;
let writerCotExampleLoading = false;
let writerCotExampleError = '';

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderStepNav();
    loadHomeData();
});

function bindEvents() {
    document.getElementById('reload-home-btn')?.addEventListener('click', loadHomeData);
    document.getElementById('wizard-back')?.addEventListener('click', () => setStep(currentStepIndex - 1));
    document.getElementById('wizard-next')?.addEventListener('click', () => setStep(currentStepIndex + 1));

    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        if (action === 'settings') {
            socket.emit('open-settings-section', {
                tab: target.dataset.tab,
                path: target.dataset.path || undefined
            });
        }
        if (action === 'plugin-settings') {
            socket.emit('open-plugin-settings', { pluginId: target.dataset.pluginId });
        }
        if (action === 'plugin-preview') {
            const plugin = setupData?.plugins?.find(item => item.id === target.dataset.pluginId);
            if (plugin) window.PluginPreviewGallery?.open(plugin, Number(target.dataset.previewIndex || 0));
        }
        if (action === 'refresh-ollama') {
            refreshOllamaStatus();
        }
        if (action === 'tab') {
            socket.emit('request-tab-switch', { tab: target.dataset.tabTarget });
        }
        if (action === 'open-project-folder') {
            socket.emit('open-project-folder');
        }
        if (action === 'open-assets-folder') {
            socket.emit('open-project-assets-folder');
        }
        if (action === 'open-writer-cot') {
            openWriterCotFile();
        }
        if (action === 'open-director-prompt-folder') {
            openDirectorPromptFolder();
        }
        if (action === 'toggle-director-example') {
            toggleDirectorExample();
        }
        if (action === 'toggle-writer-cot-example') {
            toggleWriterCotExample();
        }
        if (action === 'core-prev') {
            setCoreIndex(currentCoreIndex - 1);
        }
        if (action === 'core-next') {
            setCoreIndex(currentCoreIndex + 1);
        }
        if (action === 'plugin-prev') {
            setPluginIndex(currentPluginIndex - 1);
        }
        if (action === 'plugin-next') {
            setPluginIndex(currentPluginIndex + 1);
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target;
        if (target.matches('[data-core-toggle]')) {
            toggleCoreModule(target.dataset.coreToggle, target.checked, target);
        }
        if (target.matches('[data-plugin-toggle]')) {
            togglePlugin(target.dataset.pluginToggle, target.checked, target);
        }
        if (target.matches('[data-settings-toggle]')) {
            toggleSettingsValue(target.dataset.settingsToggle, target.checked, target);
        }
        if (target.matches('[data-core-select]')) {
            setCoreIndex(Number(target.value));
        }
        if (target.matches('[data-plugin-select]')) {
            setPluginIndex(Number(target.value));
        }
    });
}

function loadHomeData() {
    setLoading(true);
    socket.emit('get-home-setup-data', {}, (response) => {
        if (!response || !response.success) {
            setLoading(false);
            showError(response?.error || 'Unable to load Home setup data.');
            return;
        }

        setupData = response;
        currentStepIndex = clampStep(currentStepIndex);
        currentCoreIndex = clampIndex(currentCoreIndex, setupData.coreModules?.length || 0);
        currentPluginIndex = clampIndex(currentPluginIndex, setupData.plugins?.length || 0);
        setLoading(false);
        render();
    });
}

function setLoading(isLoading) {
    document.getElementById('loading-state')?.classList.toggle('hidden', !isLoading);
    document.getElementById('wizard-content')?.classList.toggle('hidden', isLoading);
}

function showError(message) {
    const content = document.getElementById('wizard-content');
    if (!content) return;
    content.classList.remove('hidden');
    content.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function clampStep(index) {
    return Math.max(0, Math.min(STEPS.length - 1, Number.isFinite(index) ? index : 0));
}

function clampIndex(index, length) {
    if (!length) return 0;
    return Math.max(0, Math.min(length - 1, Number.isFinite(index) ? index : 0));
}

function setStep(index) {
    currentStepIndex = clampStep(index);
    localStorage.setItem('fablekin.home.currentStep', String(currentStepIndex));
    render();
}

function setCoreIndex(index) {
    currentCoreIndex = clampIndex(index, setupData?.coreModules?.length || 0);
    localStorage.setItem('fablekin.home.coreIndex', String(currentCoreIndex));
    renderCurrentStep();
}

function setPluginIndex(index) {
    currentPluginIndex = clampIndex(index, setupData?.plugins?.length || 0);
    localStorage.setItem('fablekin.home.pluginIndex', String(currentPluginIndex));
    renderCurrentStep();
}

function render() {
    if (!setupData) return;
    renderStepNav();
    renderCurrentStep();
    renderScores();

    const back = document.getElementById('wizard-back');
    const next = document.getElementById('wizard-next');
    if (back) back.disabled = currentStepIndex === 0;
    if (next) {
        next.disabled = currentStepIndex === STEPS.length - 1;
        next.textContent = currentStepIndex === STEPS.length - 2 ? 'Finish' : 'Next';
    }
}

function renderStepNav() {
    const nav = document.getElementById('wizard-nav');
    if (!nav) return;

    nav.innerHTML = STEP_GROUPS.map(group => {
        const steps = STEPS
            .map((step, index) => ({ step, index }))
            .filter(({ index }) => index >= group.start && index <= group.end);

        if (!steps.length) return '';

        return `
            <div class="wizard-step-group">
                <div class="wizard-step-group-label">${escapeHtml(group.label)}</div>
                ${steps.map(({ step, index }) => `
                    <button class="wizard-step ${index === currentStepIndex ? 'active' : ''}" type="button" data-step-index="${index}">
                        <span class="wizard-step-index">${index + 1}</span>
                        <span>${escapeHtml(step.label)}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }).join('');

    nav.querySelectorAll('[data-step-index]').forEach(button => {
        button.addEventListener('click', () => setStep(Number(button.dataset.stepIndex)));
    });
}

function renderCurrentStep() {
    const content = document.getElementById('wizard-content');
    if (!content) return;

    const step = STEPS[currentStepIndex]?.id;
    if (step === 'start') content.innerHTML = renderStart();
    else if (step === 'not-chat') content.innerHTML = renderNotChat();
    else if (step === 'models') content.innerHTML = renderModels();
    else if (step === 'power') content.innerHTML = renderPowerLevels();
    else if (step === 'credentials') content.innerHTML = renderCredentials();
    else if (step === 'tabs') content.innerHTML = renderTwoTabs();
    else if (step === 'first-scene') content.innerHTML = renderFirstScene();
    else if (step === 'project') content.innerHTML = renderMakeYourOwn();
    else if (step === 'assets') content.innerHTML = renderAssets();
    else if (step === 'latency') content.innerHTML = renderLatencyAndControl();
    else if (step === 'story-autonomy') content.innerHTML = renderStoryAutonomy();
    else if (step === 'native-systems') content.innerHTML = renderNativeSystems();
    else content.innerHTML = renderPluginsChapter();

    bindTutorialMediaState(content);
}

function bindTutorialMediaState(container) {
    container.querySelectorAll('.tutorial-media').forEach((image) => {
        const updateState = () => image.classList.toggle('loaded', image.complete && image.naturalWidth > 0);

        if (image.complete) updateState();
        image.addEventListener('load', updateState, { once: true });
        image.addEventListener('error', () => image.classList.remove('loaded'), { once: true });
    });
}

function renderStart() {
    return `
        <section class="wizard-stage hero-stage">
            <div class="stage-eyebrow">Guided First Run</div>
            <h2>Let Fablekin show you what it can do.</h2>
            <p class="stage-lede">Fablekin is an AI-powered narrative simulation engine for long-form adventures. It is built for strong continuity, deliberate storytelling, gameplay systems, and fully rendered visual novel scenes with sprites, music, shaders, effects, and modded behavior.</p>
            <div class="hero-callout-grid">
                ${renderGuideCallout('My recommendation: try the default project before building your dream adventure. Fablekin does a lot of the work for you, so you can get started quickly. There is plenty of complexity waiting if you want to push the experience higher, but a working scene teaches more than ten perfect settings pages.')}
                <div class="warning-panel">
                    <strong>Fablekin is not a chat interface.</strong>
                    <p>Generations generally take time. The trade is latency for a richer scene pipeline: narrative agents, consistency systems, asset selection, VN rendering, and optional plugins all working together.</p>
                </div>
            </div>
            <div class="compact-list">
                <div><span>1</span> Set up model credentials.</div>
                <div><span>2</span> Learn Content Manager and Viewer.</div>
                <div><span>3</span> Run one default-project scene.</div>
            </div>
        </section>
    `;
}

function renderNotChat() {
    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">Expectation Setting</div>
            <h2>This is a scene engine, not a chat box.</h2>
            <p class="stage-lede">Fablekin is built around bigger turns: gather context, let specialized agents reason about the story, generate a scene, transform it into a visual novel sequence, then let you respond from inside the world.</p>
            <div class="guide-grid">
                ${renderMiniCard('What takes time', 'Fablekin may spend minutes assembling a scene, especially with native helpers, visual presentation, or plugins enabled.')}
                ${renderMiniCard('What that buys', 'Deep narrative consistency, stronger scene direction, playable systems, and a rendered VN presentation with sprites, shaders, sound, and effects.')}
            </div>
            ${renderGuideCallout('Treat each generation like asking for the next scene, not the next sentence. Fablekin is trying to stage an adventure, not autocomplete a conversation.')}
        </section>
    `;
}

function renderModels() {
    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">Model Routing</div>
            <h2>Trust the defaults for now.</h2>
            <p class="stage-lede">You do not need to change model routing to get started. The current defaults are meant to be a good balance of quality, speed, and price.</p>
            ${renderGuideCallout('Later, if you want to optimize cost or quality, this is the idea: Fablekin groups models into low end, medium end, high end, and very high end tiers, then assigns different jobs to the right tier.')}
            <div class="guide-grid">
                ${renderMiniCard('Medium end', 'Default: deepseek-v4-flash with reasoning disabled. Used for quicker, simpler tasks where speed matters more than deep planning.')}
                ${renderMiniCard('High end', 'Default: deepseek-v4-flash. Used for smart helper jobs that should stay fast and affordable.')}
                ${renderMiniCard('Very high end', 'Default: deepseek-v4-pro. Used when the main scene needs stronger writing and reasoning.')}
            </div>
            <div class="estimate-panel">
                <strong>How you change it later</strong>
                <p>Open Models & Routing, pick a provider, and change which actual model sits behind each tier. Simple jobs can move cheaper; important writing can stay on stronger models.</p>
            </div>
            <div class="security-note">
                <strong>Input caching can help a lot.</strong>
                <p>Fablekin reuses input tokens whenever it can. If your provider supports prompt or input caching, repeated context can become significantly cheaper than sending everything from scratch each time.</p>
            </div>
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="settings" data-tab="models-config">Open Models & Routing</button>
            </div>
        </section>
    `;
}

function renderPowerLevels() {
    return `
        <section class="wizard-stage wide-stage">
            <div class="stage-eyebrow">Capability Map</div>
            <h2>Three sensible power levels.</h2>
            <p class="stage-lede">You do not need all of this today. I just want you to know what the machine can grow into.</p>
            <div class="power-showcase-stack">
                ${renderPowerShowcase(
                    'Text Adventure',
                    'Writer only. The cheapest and cleanest first test: Fablekin as a strong long-form text adventure engine.',
                    ['~1m generation', '~5-10m reading', '~$0.015 / scene'],
                    ['Writer-only scene screenshot'],
                    false
                )}
                ${renderPowerShowcase(
                    'Native Fablekin',
                    'The recommended default: scene direction, VN presentation, character emotions, animated sprites, backgrounds, music, and continuity helpers.',
                    ['~3-4m generation', '~5-10m reading', '~$0.025 / scene'],
                    ['Rendered VN scene', 'Character emotion and sprite presentation', 'Timeline or scene-history view'],
                    true
                )}
                ${renderPowerShowcase(
                    'Plugin Heavy',
                    'The big toy box: voice, cinematography, character sheets, relationship tracking, personality tracking, SFX, VFX, shaders, gameplay systems, CG scenes, and more.',
                    ['~5m+ generation', '~10-15m with TTS/autoplay', '~$0.04-$0.20+ / scene'],
                    ['Cinematic VN moment', 'Plugin HUD or gameplay overlay', 'Shader/VFX/CG showcase'],
                    false
                )}
            </div>
            <div class="warning-panel compact">
                <strong>Treat these as weather reports, not laws of physics.</strong>
                <p>Provider speed, reasoning effort, prompt size, retries, and plugin count can move the numbers around.</p>
            </div>
        </section>
    `;
}

function renderCredentials() {
    const providers = setupData.providers || [];
    const configuredCount = providers.filter(p => p.configured).length;
    const ollama = setupData.ollama || {};
    const reachable = !!ollama.reachable;

    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">Provider Setup</div>
            <h2>Give Fablekin somewhere to think.</h2>
            <p class="stage-lede">Fablekin uses four global model tiers. Save a provider key and the first provider you configure will automatically populate all four routes with a starter profile.</p>
            <div class="setup-check ${configuredCount ? 'ok' : 'warn'}">
                <span>${configuredCount ? 'Credentials detected' : 'Credentials needed'}</span>
                <strong>${configuredCount}/${providers.length || 0} providers configured</strong>
            </div>
            <div class="mini-summary">
                <strong>Local memory check</strong>
                <p><span>Ollama</span> ${reachable ? 'Reachable' : 'Offline'} at ${escapeHtml(ollama.base_url || 'no base URL')}</p>
                <p><span>Embedding model</span> ${escapeHtml(ollama.model || 'Not configured')}</p>
                ${ollama.error ? `<p><span>Last error</span> ${escapeHtml(ollama.error)}</p>` : ''}
            </div>
            <div class="guide-callout">
                <strong>What Ollama is doing here</strong>
                <p>Ollama runs a small local embedding model for memory search. In plain terms: it helps Fablekin turn lore and past scenes into searchable fingerprints, so RAG can find relevant story context later.</p>
            </div>
            <div class="security-note">
                <strong>Credentials stay local.</strong>
                <p>Fablekin only talks to the providers you configure. API keys are encrypted and stored on your machine.</p>
            </div>
            <div class="guide-callout">
                <strong>Do this now</strong>
                <p>Open Secrets, save your first provider key, and Fablekin will configure Low, Medium, High, and Very High routes automatically. You can review them later under Models & Routing.</p>
            </div>
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="settings" data-tab="providers">Configure nano-gpt/OpenRouter</button>
                <button class="home-button subtle" type="button" data-action="refresh-ollama">Refresh Ollama</button>
                <button class="home-button subtle" type="button" data-action="settings" data-tab="models-config" data-path="infrastructure.providers.ollama.base_url">Open Ollama Settings</button>
            </div>
        </section>
    `;
}

function renderTwoTabs() {
    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">First Session</div>
            <h2>Ignore most tabs for now.</h2>
            <p class="stage-lede">For your first session, you only need two places.</p>
            <div class="guide-grid">
                ${renderMiniCard('Content Manager', 'Where story material lives: lore, directives, world files, character notes, and player information.')}
                ${renderMiniCard('Viewer', 'Where you play: read the scene, watch the presentation, and respond as your character.')}
            </div>
            ${renderGuideCallout('If Viewer is the stage, Content Manager is the table covered in notes backstage. You can explore the other tabs later.')}
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="tab" data-tab-target="content_manager">Open Content Manager</button>
                <button class="home-button primary" type="button" data-action="tab" data-tab-target="viewer">Open Viewer</button>
            </div>
        </section>
    `;
}

function renderFirstScene() {
    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">First Milestone</div>
            <h2>Run one default-project scene.</h2>
            <p class="stage-lede">This is the moment where setup becomes real. Not perfect settings. Not every plugin. One working scene.</p>
            <div class="checklist-panel">
                <div><span class="checklist-number">1</span><p>In Content Manager, click <strong>Edit Bio</strong> and learn your player character.</p></div>
                <div><span class="checklist-number">2</span><p>Open <strong>world_building.md</strong> and skim the story setup.</p></div>
                <div><span class="checklist-number">3</span><p>Go to Viewer, read the scene, and respond in character.</p></div>
            </div>
            <div class="success-panel">
                <strong>Success looks simple.</strong>
                <p>If a scene generates and you can respond, Fablekin is alive.</p>
            </div>
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="tab" data-tab-target="content_manager">Open Content Manager</button>
                <button class="home-button primary" type="button" data-action="tab" data-tab-target="viewer">Open Viewer</button>
                <button class="home-button subtle" type="button" data-action="tab" data-tab-target="logs">Open Logs</button>
            </div>
        </section>
    `;
}

function renderMakeYourOwn() {
    return `
        <section class="wizard-stage wide-stage">
            <div class="stage-eyebrow">Projects</div>
            <h2>Create your own adventure.</h2>
            <p class="stage-lede">A Fablekin project is just a folder. That makes projects easy to back up, move, share, or receive from someone else.</p>
            ${renderGuideCallout('You can start fresh or inspect an existing project first. The important part is understanding the loop: create a project, define your player character, then add enough lore and world building for Fablekin to work with.')}
            <div class="tutorial-grid">
                ${renderTutorialMedia('Create a new project', 'GIF slot: project creation flow', 'media/tutorials/create-project.gif')}
                ${renderTutorialMedia('Set up player bio', 'GIF slot: Edit Bio flow', 'media/tutorials/edit-player-bio.gif')}
                ${renderTutorialMedia('Add lore and world building', 'GIF slot: lore/world-building flow', 'media/tutorials/add-lore.gif')}
            </div>
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="open-project-folder">Open Project Folder</button>
                <button class="home-button subtle" type="button" data-action="tab" data-tab-target="content_manager">Open Content Manager</button>
            </div>
        </section>
    `;
}

function renderAssets() {
    return `
        <section class="wizard-stage wide-stage">
            <div class="stage-eyebrow">Assets</div>
            <h2>Assets can start very small.</h2>
            <p class="stage-lede">You can build a playable project with simple assets, then add polish when the story earns it. For the basics, file names do most of the work: Fablekin reads asset titles and decides where they fit automatically.</p>
            ${renderGuideCallout('The simple version: name backgrounds, songs, and sprites clearly. There are more advanced controls later, but you can go surprisingly far by dropping well-named files into the right folders.')}
            <div class="tutorial-grid">
                ${renderTutorialMedia('Add sprites', 'GIF slot: sprite upload flow', 'media/tutorials/add-sprites.gif')}
                ${renderTutorialMedia('Add backgrounds', 'GIF slot: background upload flow', 'media/tutorials/add-backgrounds.gif')}
                ${renderTutorialMedia('Add OST', 'GIF slot: music upload flow', 'media/tutorials/add-ost.gif')}
            </div>
            <div class="asset-basics-grid">
                ${renderMiniCard('Backgrounds', 'Use descriptive file names. Fablekin can pick still or animated backgrounds that match the scene or location. Supported formats: .png, .jpg, .jpeg, .gif, .bmp, .webp, .mp4, and .webm.')}
                ${renderMiniCard('OST', 'Name songs by mood, place, or purpose so Fablekin can match the scene tone. Supported formats: .mp3, .ogg, and .wav.')}
                ${renderMiniCard('Simple sprites', 'The simplest sprite can be one file, like Turiel.webp. Supported sprite formats are .webp and .png.')}
                ${renderMiniCard('Sprite emotions', 'For a little more control, use character_emotion.webp, such as Turiel_happy.webp. The emotion part is optional.')}
                ${renderMiniCard('Advanced sprites', 'Sprites can later support emotions, outfit variants, rotation, blinking, and talking. Those deeper patterns are documented in the docs.')}
            </div>
            <div class="warning-panel compact">
                <strong>There are richer asset rules later.</strong>
                <p>For more complex scenes, Fablekin can also use a metadata.json file to figure out the right assets more precisely. That workflow is documented in the docs.</p>
            </div>
            <div class="button-row">
                <button class="home-button primary" type="button" data-action="open-assets-folder">Open Assets Folder</button>
            </div>
        </section>
    `;
}

function renderLatencyAndControl() {
    return `
        <section class="wizard-stage wide-stage">
            <div class="stage-eyebrow">Latency & Control</div>
            <h2>Decide who is steering the scene.</h2>
            <p class="stage-lede">Fablekin is still not chat. A slow turn is usually not the app freezing; it is the pipeline waiting on models, provider speed, reasoning time, native helpers, plugins, assets, and presentation work.</p>
            <div class="latency-control-grid">
                ${renderMiniCard('Fastest path', 'If you plan to guide the story yourself, keep narrative planning light and stick mostly with visual modules or visual plugins. You get faster scenes while you remain the director.')}
                ${renderMiniCard('Full control', 'If you want to control the story beat-by-beat, use direction inputs for explicit scene instructions. This is the best mode when you already know what should happen next.')}
                ${renderMiniCard('Living world path', 'If you want to feel like you live inside the story, increase the pipeline power. Director, Writer CoT, memory, and plugins can simulate more, but costs and latency matter.')}
            </div>
            <div class="direction-input-showcase">
                <div>
                    <strong>Direction inputs are the steering wheel.</strong>
                    <p>Use them when you want to tell Fablekin exactly what kind of scene, beat, consequence, or constraint should come next.</p>
                </div>
                <div class="direction-input-strip">
                    ${renderScreenshotSlip('media/screenshots/direction_input_1.webp', 'Direction input screenshot 1', 'Screenshot slot: direction input field')}
                    ${renderScreenshotSlip('media/screenshots/direction_input_2.webp', 'Direction input screenshot 2', 'Screenshot slot: direction input applied to a turn')}
                </div>
            </div>
            <div class="guide-callout plugin-timing-note">
                <strong>More modules does not always mean a slower turn.</strong>
                <p>Some helpers work quietly in the background while you play, some run in parallel with other scene work, and some really do need dedicated generation time. Mileage varies by plugin, provider speed, model routing, and configuration, so treat each addition as something to test rather than something to fear.</p>
            </div>
            <div class="warning-panel compact">
                <strong>Generation time is volatile.</strong>
                <p>Scene generation depends on pipeline complexity, the models you choose, reasoning depth, provider speed, caching support, and whether plugins add extra LLM calls. A powerful setup can be worth it, but it should be a deliberate choice.</p>
            </div>
            <div class="latency-screenshot-placeholder">
                <img class="latency-screenshot-image tutorial-media" src="media/screenshots/slow_turn_generation.webp" alt="Slow turn generation example" loading="lazy" decoding="async">
                <div class="tutorial-media-placeholder">
                    Screenshot slot: slow turn generation because a model/provider was taking a long time.
                </div>
            </div>
        </section>
    `;
}

function renderStoryAutonomy() {
    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">Story Autonomy</div>
            <h2>Choose how much the story thinks for itself.</h2>
            <p class="stage-lede">These settings decide how much Fablekin should plan, remember, challenge, and steer on your behalf. They cost extra time and tokens, but they can make the world feel less like a prompt box and more like a place you are living inside.</p>
            ${renderDirectorSpotlight()}
            ${renderWriterCotSpotlight()}
            <div class="advanced-stack">
                ${renderAdvancedItem('Memory LoD', 'More memory is not automatically better. Large memory budgets plus plugin context can get expensive and make models lose focus. Keep defaults until you have a specific continuity problem.', 'Open Memory Management', 'settings', 'memory-management')}
                ${renderAdvancedItem('Models & Routing', 'This is where you decide which model handles each job. Tune for cost after you understand what feels slow or expensive.', 'Open Models & Routing', 'settings', 'models-config')}
            </div>
        </section>
    `;
}

function renderDirectorSpotlight() {
    const director = (setupData.coreModules || []).find(module => module.id === 'director');
    if (!director) {
        return '';
    }

    return `
        <article class="director-spotlight">
            <div class="director-spotlight-header">
                <div>
                    <span class="card-meta">Narrative Direction</span>
                    <h3>Director</h3>
                </div>
                <div class="spotlight-toggle">
                    <span class="status-pill ${director.enabled ? 'ok' : 'off'}">${director.enabled ? 'Enabled' : 'Disabled'}</span>
                    <label class="switch" title="Toggle Director">
                        <input type="checkbox" data-core-toggle="director" ${director.enabled ? 'checked' : ''} ${!director.toggleable ? 'disabled' : ''}>
                        <span class="switch-track"></span>
                    </label>
                    <span class="toggle-caption">Director ${director.enabled ? 'on' : 'off'}</span>
                </div>
            </div>
            <p>The Director is the logical thinker of the pipeline: an attempt to emulate a human GM checking the table before the next scene begins. It reviews the current situation before the Writer acts, updates its ledger, and produces a concrete brief about what the next scene should preserve, advance, avoid, or challenge so the story does not go off track, break consistency, or become stale.</p>
            <div class="spotlight-detail-grid">
                ${renderSpotlightDetail('What it tracks', [
                    'Director ledger: party logistics, location, active threads, mysteries, action queue, watchlist, and character agendas.',
                    'Interrupted goals: characters who were about to do something can remember and resume it later.',
                    'World pressure: time, travel, weather, setting rules, inventory, dynamic events, and stakes.'
                ])}
                ${renderSpotlightDetail('What it changes', [
                    'NPCs can initiate, disagree, chase their goals, remember, leave, return, or pursue their own needs without waiting for you.',
                    'The Writer gets scene-level orders, narrative threads, spoiler guardrails, and craft critiques before writing.',
                    'The story is less likely to become pure wish fulfillment or player-directed puppet theater.'
                ])}
            </div>
            <div class="decision-box">
                <div>
                    <strong>${director.enabled ? 'What the Director adds' : 'What changes when off'}</strong>
                    <p>${escapeHtml(director.enabled
                        ? 'More cost and generation time, but much stronger scene direction: Fablekin can carry goals, pressure, callbacks, boundaries, pacing, and NPC agency without you having to steer every turn.'
                        : 'The Writer works more directly from memory and lore. This is cheaper and faster, and it can be preferable if you want to personally direct the scene flow yourself.')}</p>
                </div>
            </div>
            <div class="button-row">
                <button class="home-button subtle" type="button" data-action="open-director-prompt-folder">Open Director Prompt Folder</button>
                <button class="home-button primary featured-action" type="button" data-action="toggle-director-example">${directorExampleText ? 'Hide Director Example' : 'Show Director Example'}</button>
            </div>
            ${renderDirectorExample()}
        </article>
    `;
}

function renderWriterCotSpotlight() {
    const writer = (setupData.coreModules || []).find(module => module.id === 'writer');
    const writerSettings = setupData.settings?.narrative_agents?.writer || {};
    const enabled = writerSettings.enable_chain_of_thought !== false;

    return `
        <article class="director-spotlight writer-cot-spotlight">
            <div class="director-spotlight-header">
                <div>
                    <span class="card-meta">Writer Planning</span>
                    <h3>Writer Chain of Thought</h3>
                </div>
                <div class="spotlight-toggle">
                    <span class="status-pill ${enabled ? 'ok' : 'off'}">${enabled ? 'Enabled' : 'Disabled'}</span>
                    <label class="switch" title="Toggle Writer Chain of Thought">
                        <input type="checkbox" data-settings-toggle="narrative_agents.writer.enable_chain_of_thought" ${enabled ? 'checked' : ''}>
                        <span class="switch-track"></span>
                    </label>
                    <span class="toggle-caption">Writer CoT ${enabled ? 'on' : 'off'}</span>
                </div>
            </div>
            <p>The Writer CoT is the Writer's private craft checklist. It makes the Writer plan the scene before prose generation: what the player attempted, what the Director asked for, what the characters know, what the world allows, and how the chapter should land.</p>
            <div class="spotlight-detail-grid">
                ${renderSpotlightDetail('What it checks', [
                    'Player input: every spoken line and attempted action should appear on-page before consequences.',
                    'Character integrity: goals, private headspace, relationship tension, visual locks, familiarity, and agency.',
                    'World logistics: location, time, travel scale, weather, technology baseline, inventory intent, and current constraints.'
                ])}
                ${renderSpotlightDetail('What it improves', [
                    'Beat mapping: the scene gets a route, required inclusions, hard boundaries, and an ending hook before drafting.',
                    'Craft quality: anti-cliche checks, dialogue presence, pacing, narration balance, and final compliance audits.',
                    'Lived-in scenes: NPCs can act with memory and initiative instead of only reacting to the player.'
                ])}
            </div>
            <div class="decision-box">
                <div>
                    <strong>${enabled ? 'What Writer CoT adds' : 'What changes when off'}</strong>
                    <p>${enabled
                        ? 'More prompt tokens, cost, and latency, but a much stronger chance that the chapter feels authored: coherent beats, sharper dialogue, better continuity, and fewer scenes that drift into generic response mode.'
                        : 'The Writer skips the explicit planning protocol. This is faster and cheaper, and it may be the right choice if you want to be the one directing pacing, tone, and scene structure yourself.'}</p>
                </div>
            </div>
            <div class="button-row">
                <button class="home-button subtle" type="button" data-action="open-writer-cot">Open Writer CoT File</button>
                <button class="home-button primary featured-action" type="button" data-action="toggle-writer-cot-example">${writerCotExampleText ? 'Hide Writer CoT Example' : 'Show Writer CoT Example'}</button>
            </div>
            ${renderWriterCotExample()}
        </article>
    `;
}

function renderSpotlightDetail(title, items) {
    return `
        <div class="spotlight-detail-card">
            <strong>${escapeHtml(title)}</strong>
            <ul>
                ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
        </div>
    `;
}

function renderDirectorExample() {
    if (directorExampleLoading) {
        return '<div class="director-example-box muted">Loading director example...</div>';
    }
    if (directorExampleError) {
        return `<div class="director-example-box error">${escapeHtml(directorExampleError)}</div>`;
    }
    if (!directorExampleText) {
        return '';
    }

    return `
        <div class="director-example-box">
            <strong>Example of the Director's work</strong>
            <pre>${escapeHtml(directorExampleText)}</pre>
        </div>
    `;
}

function renderWriterCotExample() {
    if (writerCotExampleLoading) {
        return '<div class="director-example-box muted">Loading Writer CoT example...</div>';
    }
    if (writerCotExampleError) {
        return `<div class="director-example-box error">${escapeHtml(writerCotExampleError)}</div>`;
    }
    if (!writerCotExampleText) {
        return '';
    }

    return `
        <div class="director-example-box">
            <strong>Example of the Writer CoT's work</strong>
            <pre>${escapeHtml(writerCotExampleText)}</pre>
        </div>
    `;
}

function renderNativeSystems() {
    const modules = getNativeHelperModules();
    if (!modules.length) {
        return `
            <section class="wizard-stage">
                <div class="stage-eyebrow">Native Systems</div>
                <h2>No native system metadata found.</h2>
                <p class="muted">No native system metadata was found.</p>
            </section>
        `;
    }

    return `
        <section class="wizard-stage wide-stage">
            <div class="stage-eyebrow">Native Systems</div>
            <h2>Built-in helpers, shown honestly.</h2>
            <p class="stage-lede">These are Fablekin's built-in support systems around the main story agents. Writer, Director, and VN background routing are not listed here because they are foundational pipeline pieces, not optional native helpers.</p>
            <div class="guide-callout native-cost-note">
                <strong>Enabled means available, not always billed.</strong>
                <p>Several native systems are conditional. Some skip their LLM call when the scene, assets, or plugins do not need them; others run in the background or have cheap fallbacks. This is one reason a visually rich setup does not always mean every helper is charging every turn.</p>
            </div>
            <div class="native-system-groups">
                ${renderNativeHelperGroups(modules)}
            </div>
        </section>
    `;
}

function renderPluginsChapter() {
    const plugins = setupData.plugins || [];
    if (!plugins.length) {
        return `
            <section class="wizard-stage">
                <div class="stage-eyebrow">Plugins</div>
                <h2>No non-experimental plugins found.</h2>
                <p class="stage-lede">When bundled product plugins are available, they will appear here one at a time.</p>
            </section>
        `;
    }

    currentPluginIndex = clampIndex(currentPluginIndex, plugins.length);
    const plugin = plugins[currentPluginIndex];

    return `
        <section class="wizard-stage">
            <div class="stage-eyebrow">Plugins</div>
            <h2>Enable plugins by purpose, not curiosity.</h2>
            <p class="stage-lede">Plugins are where Fablekin gets wild. They can also make scenes slower and more expensive, so add one, test a scene, then decide if it earned its place.</p>
            <div class="plugin-category-strip">
                <span>Continuity remembers.</span>
                <span>Presentation adds life.</span>
                <span>Gameplay adds rules.</span>
                <span>Generation adds cost.</span>
            </div>
            ${renderItemNavigator('plugin', plugins, currentPluginIndex)}
            ${renderPluginCard(plugin)}
            <div class="button-row">
                <button class="home-button subtle" type="button" data-action="tab" data-tab-target="plugins">Open Plugin Manager</button>
            </div>
        </section>
    `;
}

function renderGuideCallout(text) {
    return `
        <div class="guide-callout">
            <p>${escapeHtml(text)}</p>
        </div>
    `;
}

function renderMiniCard(title, body) {
    return `
        <article class="guide-card">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(body)}</p>
        </article>
    `;
}

function renderTutorialMedia(title, body, src) {
    return `
        <article class="tutorial-card">
            <div class="tutorial-media-frame">
                <img class="tutorial-media" src="${escapeHtml(src)}" alt="${escapeHtml(title)} tutorial" loading="lazy" decoding="async">
                <div class="tutorial-media-placeholder">${escapeHtml(body)}</div>
            </div>
            <h3>${escapeHtml(title)}</h3>
        </article>
    `;
}

function renderScreenshotSlip(src, alt, placeholder) {
    return `
        <div class="screenshot-slip">
            <img class="tutorial-media" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
            <div class="tutorial-media-placeholder">${escapeHtml(placeholder)}</div>
        </div>
    `;
}

function renderPowerShowcase(title, body, estimates, placeholders, isDefault = false) {
    return `
        <article class="power-showcase ${isDefault ? 'recommended' : ''}">
            <div class="power-card-header">
                <h3>${escapeHtml(title)}</h3>
                ${isDefault ? '<span class="status-pill ok">Default</span>' : ''}
            </div>
            <p>${escapeHtml(body)}</p>
            <div class="estimate-list">
                ${estimates.map(estimate => `<span>${escapeHtml(estimate)}</span>`).join('')}
            </div>
            <div class="screenshot-grid">
                ${placeholders.map(placeholder => `<div class="screenshot-placeholder">${escapeHtml(placeholder)}</div>`).join('')}
            </div>
        </article>
    `;
}

function renderAdvancedItem(title, body, buttonLabel, action, tab) {
    const tabAttr = tab ? ` data-tab="${escapeAttr(tab)}"` : '';
    return `
        <article class="advanced-item">
            <div>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(body)}</p>
            </div>
            <button class="home-button subtle" type="button" data-action="${escapeAttr(action)}"${tabAttr}>${escapeHtml(buttonLabel)}</button>
        </article>
    `;
}

function getNativeHelperModules() {
    return (setupData.coreModules || [])
        .filter(module => !NATIVE_HELPER_EXCLUDED_IDS.has(module.id));
}

function renderNativeHelperGroups(modules) {
    const seen = new Set();
    const groups = NATIVE_HELPER_GROUPS.map(group => {
        const groupModules = group.ids
            .map(id => modules.find(module => module.id === id))
            .filter(Boolean);
        groupModules.forEach(module => seen.add(module.id));
        return { ...group, modules: groupModules };
    }).filter(group => group.modules.length > 0);

    const uncategorized = modules.filter(module => !seen.has(module.id));
    if (uncategorized.length) {
        groups.push({
            label: 'Other Native Systems',
            note: 'Additional built-in systems that are available in this build.',
            modules: uncategorized
        });
    }

    return groups.map(group => `
        <section class="native-system-group">
            <div class="native-system-group-header">
                <h3>${escapeHtml(group.label)}</h3>
                <p>${escapeHtml(group.note)}</p>
            </div>
            <div class="native-system-card-grid">
                ${group.modules.map(module => renderNativeModuleCard(module)).join('')}
            </div>
        </section>
    `).join('');
}

function renderNativeModuleCard(module) {
    const executionNote = NATIVE_HELPER_EXECUTION_NOTES[module.id] || module.wizard?.settings_note || 'This module runs according to its configured pipeline conditions.';
    const description = NATIVE_HELPER_DESCRIPTIONS[module.id] || module.wizard?.author_note || module.description || '';
    return `
        <article class="native-system-card" data-core-card="${escapeAttr(module.id)}">
            <div class="native-system-card-header">
                <div>
                    <span class="card-meta">${escapeHtml(module.group)}</span>
                    <h3>${escapeHtml(module.label)}</h3>
                </div>
                <div class="spotlight-toggle native-system-toggle">
                    <span class="status-pill ${module.enabled || module.locked ? 'ok' : 'off'}">${module.locked ? 'Always On' : (module.enabled ? 'Enabled' : 'Disabled')}</span>
                    <label class="switch" title="${module.locked ? `The ${module.label} cannot be disabled.` : `Toggle ${module.label}`}" aria-label="${module.locked ? `${module.label} is always on` : `Toggle ${module.label}`}">
                        <input type="checkbox" data-core-toggle="${escapeAttr(module.id)}" ${module.enabled || module.locked ? 'checked' : ''} ${module.locked || !module.toggleable ? 'disabled' : ''}>
                        <span class="switch-track"></span>
                    </label>
                    <span class="toggle-caption">${escapeHtml(module.label)} ${module.enabled || module.locked ? 'on' : 'off'}</span>
                </div>
            </div>

            <p class="focus-summary">${escapeHtml(description)}</p>
            ${renderMetrics(module.metrics)}

            <div class="native-system-note">
                <strong>When it runs</strong>
                <p>${escapeHtml(executionNote)}</p>
            </div>

            <div class="decision-box compact-decision">
                <div>
                    <strong>${module.enabled || module.locked ? 'What you gain' : 'What changes when off'}</strong>
                    <p>${escapeHtml(module.enabled || module.locked ? (module.wizard?.enabled_note || module.description || '') : (module.wizard?.disabled_note || module.disabled_behavior || ''))}</p>
                </div>
            </div>

            <div class="button-row">
                <button class="home-button subtle" type="button" data-action="settings" data-tab="engine-assignment" data-path="narrative_agents.${escapeAttr(module.id)}.description">Open Settings</button>
            </div>
        </article>
    `;
}

function renderCoreModuleCard(module) {
    return renderNativeModuleCard(module);
}

function renderPluginCard(plugin) {
    const dependencyEntries = getPluginDependencyEntries(plugin);
    const missing = dependencyEntries.filter(entry => entry.required && !entry.satisfied);
    const blocked = missing.length > 0;
    const label = plugin.label || plugin.name || plugin.id;
    const toggleTitle = blocked && !plugin.enabled
        ? `Enable ${missing.map(entry => entry.label).join(', ')} first`
        : `Toggle ${label}`;
    return `
        <article class="focus-card" data-plugin-card="${escapeAttr(plugin.id)}">
            <div class="focus-card-header">
                <div>
                    <span class="card-meta">${escapeHtml(plugin.category)}</span>
                    <h3>${escapeHtml(label)}</h3>
                </div>
                <div class="spotlight-toggle plugin-toggle">
                    <span class="status-pill ${blocked ? 'warn' : (plugin.enabled ? 'ok' : 'off')}">${blocked ? 'Needs dependency' : (plugin.enabled ? 'Enabled' : 'Disabled')}</span>
                    <label class="switch" title="${escapeAttr(toggleTitle)}" aria-label="${escapeAttr(toggleTitle)}">
                        <input type="checkbox" data-plugin-toggle="${escapeAttr(plugin.id)}" ${plugin.enabled ? 'checked' : ''} ${blocked && !plugin.enabled ? 'disabled' : ''}>
                        <span class="switch-track"></span>
                    </label>
                    <span class="toggle-caption">${escapeHtml(label)} ${plugin.enabled ? 'on' : 'off'}</span>
                </div>
            </div>

            <p class="focus-summary">${escapeHtml(plugin.wizard?.author_note || plugin.description || '')}</p>
            ${renderMetrics(plugin.metrics)}
            ${renderPluginPreviewStack(plugin)}
            ${renderPluginDependencies(dependencyEntries)}

            <div class="decision-box">
                <div>
                    <strong>${plugin.enabled ? 'What this adds' : 'What you skip'}</strong>
                    <p>${escapeHtml(plugin.enabled ? (plugin.wizard?.enabled_note || plugin.description || '') : (plugin.wizard?.disabled_note || 'This plugin stays out of the generation pipeline for now.'))}</p>
                </div>
            </div>

            <div class="button-row">
                ${plugin.hasSettings ? `<button class="home-button subtle" type="button" data-action="plugin-settings" data-plugin-id="${escapeAttr(plugin.id)}">Open Plugin Settings</button>` : ''}
            </div>
        </article>
    `;
}

function renderPluginPreviewStack(plugin) {
    const screenshots = plugin.screenshots || [];
    if (!screenshots.length) return '';
    return `
        <section class="home-plugin-preview-stack" aria-label="${escapeAttr(plugin.name || plugin.label || plugin.id)} previews">
            <div class="home-plugin-preview-heading"><strong>In action</strong><span>${screenshots.length} preview${screenshots.length === 1 ? '' : 's'}</span></div>
            ${screenshots.map((screenshot, index) => `
                <button class="home-plugin-preview" type="button" data-action="plugin-preview" data-plugin-id="${escapeAttr(plugin.id)}" data-preview-index="${index}">
                    <img src="${escapeAttr(window.resolvePluginPreviewUrl(screenshot.url))}" alt="${escapeAttr(`${plugin.name || plugin.label || plugin.id} preview ${index + 1}`)}" loading="lazy" decoding="async">
                </button>
            `).join('')}
        </section>
    `;
}

function getPluginDependencyEntries(plugin) {
    const plugins = setupData?.plugins || [];
    const seen = new Set();
    const entries = [];
    const addDependencies = (dependencies, required) => {
        (dependencies || []).forEach(dependencyEntry => {
            const id = getDependencyId(dependencyEntry);
            if (!id || seen.has(id)) return;
            seen.add(id);
            const dependency = plugins.find(item => item.id === id);
            entries.push({
                id,
                required,
                label: dependency?.label || dependency?.name || humanizePluginId(id),
                satisfied: !!dependency?.enabled,
                available: !!dependency,
                note: dependencyEntry?.reason || 'This plugin uses the dependency when both are enabled.'
            });
        });
    };

    addDependencies(plugin.dependencies, true);
    addDependencies(plugin.optionalDependencies, false);
    return entries;
}

function getDependencyId(dependency) {
    return typeof dependency === 'string' ? dependency : dependency?.id;
}

function renderPluginDependencies(entries) {
    if (!entries.length) return '';

    return `
        <section class="plugin-dependency-section" aria-label="Plugin dependencies">
            <div class="plugin-dependency-heading">
                <strong>Plugin connections</strong>
                <span>Live status</span>
            </div>
            <div class="plugin-dependency-list">
                ${entries.map(entry => {
                    const state = !entry.available ? 'missing' : (entry.satisfied ? 'ready' : (entry.required ? 'required-off' : 'optional-off'));
                    const stateLabel = !entry.available
                        ? 'Unavailable'
                        : (entry.satisfied ? 'Enabled' : 'Disabled');
                    return `
                        <article class="plugin-dependency-row ${state}">
                            <div class="plugin-dependency-row-header">
                                <strong>${escapeHtml(entry.label)}</strong>
                                <span class="dependency-kind">${entry.required ? 'Required' : 'Optional'}</span>
                                <span class="dependency-state ${state}">${stateLabel}</span>
                            </div>
                            <p>${escapeHtml(entry.note)}</p>
                        </article>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderItemNavigator(type, items, index) {
    const isCore = type === 'core';
    const prevAction = isCore ? 'core-prev' : 'plugin-prev';
    const nextAction = isCore ? 'core-next' : 'plugin-next';
    const selectAttr = isCore ? 'data-core-select' : 'data-plugin-select';

    return `
        <div class="item-navigator">
            <button class="home-button subtle" type="button" data-action="${prevAction}" ${index === 0 ? 'disabled' : ''}>Previous</button>
            <div class="item-picker">
                <span>${index + 1} of ${items.length}</span>
                <select ${selectAttr}>
                    ${items.map((item, itemIndex) => `
                        <option value="${itemIndex}" ${itemIndex === index ? 'selected' : ''}>${escapeHtml(item.label || item.name || item.id)}</option>
                    `).join('')}
                </select>
            </div>
            <button class="home-button subtle" type="button" data-action="${nextAction}" ${index === items.length - 1 ? 'disabled' : ''}>Next Item</button>
        </div>
    `;
}

function renderMetrics(metrics = {}) {
    const entries = [
        ['narrative_impact', 'Impact'],
        ['immersion', 'Immersion'],
        ['cost', 'Cost'],
        ['latency', 'Latency']
    ];

    return `<div class="metric-list">${entries.map(([key, label]) => `
        <span class="metric-pill">${label}: ${escapeHtml(metrics[key] || 'None')}</span>
    `).join('')}</div>`;
}

function renderScores() {
    const container = document.getElementById('score-meters');
    if (!container || !setupData) return;

    const items = [
        ...(setupData.coreModules || []).filter(item => item.enabled || item.locked),
        ...(setupData.plugins || []).filter(item => item.enabled)
    ];
    const allItems = [
        ...(setupData.coreModules || []),
        ...(setupData.plugins || [])
    ];

    const scores = [
        buildScore('Narrative Quality', 'narrative_impact', items, allItems, 'Story influence from enabled modules and plugins.'),
        buildScore('Immersion', 'immersion', items, allItems, 'Visual, audio, and interface presence.'),
        buildScore('Cost', 'cost', items, allItems, 'API spend pressure from the current setup.'),
        buildScore('Latency', 'latency', items, allItems, 'Expected extra waiting time before scenes finish.')
    ];

    container.innerHTML = scores.map(score => `
        <div class="score-meter">
            <div class="score-meter-label">
                <span>${escapeHtml(score.label)}</span>
                <span>${score.value}/${score.max}</span>
            </div>
            <div class="score-track"><div class="score-fill" style="width: ${score.percent}%"></div></div>
            <div class="score-note">${escapeHtml(score.note)}</div>
        </div>
    `).join('');

    document.getElementById('restart-warning')?.classList.toggle('hidden', !pluginRestartWarning);
}

function buildScore(label, key, activeItems, allItems, note) {
    const max = Math.max(1, allItems.length * 4);
    const value = activeItems.reduce((sum, item) => sum + (METRIC_WEIGHTS[item.metrics?.[key]] || 0), 0);
    return {
        label,
        value,
        max,
        percent: Math.round((value / max) * 100),
        note
    };
}

function refreshOllamaStatus() {
    const button = document.querySelector('[data-action="refresh-ollama"]');
    if (button) button.textContent = 'Checking...';

    socket.emit('check-ollama-status', {}, (response) => {
        if (response && response.success && setupData) {
            setupData.ollama = response.ollama;
        }
        render();
    });
}

function openWriterCotFile() {
    socket.emit('open-writer-cot-file', {}, (response) => {
        if (!response || !response.success) {
            if (window.Modals) Modals.alert('Open Failed', response?.error || 'Could not open the Writer CoT file.');
        }
    });
}

function openDirectorPromptFolder() {
    socket.emit('open-director-prompt-folder', {}, (response) => {
        if (!response || !response.success) {
            if (window.Modals) Modals.alert('Open Failed', response?.error || 'Could not open the Director prompt folder.');
        }
    });
}

async function toggleDirectorExample() {
    if (directorExampleText) {
        directorExampleText = null;
        directorExampleError = '';
        renderCurrentStep();
        return;
    }

    directorExampleLoading = true;
    directorExampleError = '';
    renderCurrentStep();

    try {
        const response = await fetch('media/director-example.txt', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load director-example.txt (${response.status}).`);
        directorExampleText = await response.text();
        if (!directorExampleText.trim()) {
            directorExampleText = 'Add your Director example text in engine/views/home/media/director-example.txt.';
        }
    } catch (error) {
        directorExampleError = error?.message || 'Could not load the Director example.';
    } finally {
        directorExampleLoading = false;
        renderCurrentStep();
    }
}

async function toggleWriterCotExample() {
    if (writerCotExampleText) {
        writerCotExampleText = null;
        writerCotExampleError = '';
        renderCurrentStep();
        return;
    }

    writerCotExampleLoading = true;
    writerCotExampleError = '';
    renderCurrentStep();

    try {
        const response = await fetch('media/writer-cot-example.txt', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load writer-cot-example.txt (${response.status}).`);
        writerCotExampleText = await response.text();
        if (!writerCotExampleText.trim()) {
            writerCotExampleText = 'Add your Writer CoT example text in engine/views/home/media/writer-cot-example.txt.';
        }
    } catch (error) {
        writerCotExampleError = error?.message || 'Could not load the Writer CoT example.';
    } finally {
        writerCotExampleLoading = false;
        renderCurrentStep();
    }
}

function toggleCoreModule(id, enabled, input) {
    const module = setupData.coreModules.find(item => item.id === id);
    if (!module || module.locked) return;

    input.disabled = true;
    const path = `narrative_agents.${id}.enabled`;
    const previous = module.enabled;
    module.enabled = enabled;
    renderScores();

    socket.once('update-global-setting-response', (response) => {
        input.disabled = false;
        if (!response || !response.success) {
            module.enabled = previous;
            if (window.Modals) Modals.alert('Save Failed', response?.error || 'Could not update module setting.');
        }
        render();
    });
    socket.emit('update-global-setting', { path, value: enabled });
}

function toggleSettingsValue(path, enabled, input) {
    if (!path) return;

    input.disabled = true;
    const previous = getNestedValue(setupData, `settings.${path}`);
    setNestedValue(setupData, `settings.${path}`, enabled);

    socket.once('update-global-setting-response', (response) => {
        input.disabled = false;
        if (!response || !response.success) {
            setNestedValue(setupData, `settings.${path}`, previous);
            if (window.Modals) Modals.alert('Save Failed', response?.error || 'Could not update setting.');
        }
        render();
    });
    socket.emit('update-global-setting', { path, value: enabled });
}

function togglePlugin(id, _enabled, input) {
    const plugin = setupData.plugins.find(item => item.id === id);
    if (!plugin) return;

    const missing = getMissingDependencies(plugin);
    if (!plugin.enabled && missing.length > 0) {
        input.checked = false;
        input.disabled = true;
        return;
    }

    input.disabled = true;
    socket.emit('toggle-plugin-status', { pluginId: id }, (response) => {
        input.disabled = false;
        if (!response || !response.success) {
            input.checked = plugin.enabled;
            if (window.Modals) Modals.alert('Toggle Failed', response?.error || 'Could not toggle plugin.');
            return;
        }

        pluginRestartWarning = true;
        loadHomeData();
    });
}

function getMissingDependencies(plugin) {
    return getPluginDependencyEntries(plugin)
        .filter(entry => entry.required && !entry.satisfied)
        .map(entry => entry.id);
}

function humanizePluginId(id) {
    return String(id || '')
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

function setNestedValue(obj, path, value) {
    if (!obj || !path) return;
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') current[key] = {};
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
