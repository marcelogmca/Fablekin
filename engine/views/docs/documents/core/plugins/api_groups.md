# Plugin API Groups

Fablekin plugins use a small set of public API groups. The groups are split by where code runs: backend plugin code, frontend plugin UI code, and advanced VN rendering code.

## Backend Plugin World

Backend plugin code runs from a plugin `index.js` file or an approved Story Script. This is where plugins participate in project loading, turn generation, prompt assembly, VN generation, storage, and cross-plugin coordination.

### Plugin Definition

The plugin definition is the `module.exports` object in `index.js`. It declares identity and extension points:

```javascript
module.exports = {
  id: 'my_plugin',
  name: 'My Plugin',
  hooks: {},
  views: [],
  exports: {},
  socketListeners: {},
  settingsSchema: {},
  documentation: [],
  dependencies: [],
  optionalDependencies: [],
  isExamplePlugin: false,
  experimental: false
};
```

Common definition fields:

- `id`, `name`, `version`, `description`, `author`, `category`
- `hooks` for lifecycle listeners
- `views` for custom plugin tabs/windows
- `exports` for functions other plugins or engine protocols can call
- `socketListeners` for backend handlers called by frontend events
- `settingsSchema` for Plugin Manager settings UI
- `documentation` for Docs portal entries
- `terminalCommands` and `timelineProviders` for specialized integrations
- `dependencies` and `optionalDependencies` for required and graceful integrations
- `isExamplePlugin` for official reference plugins shown under Developer & Reference
- `experimental` for unfinished product plugins; examples should use `isExamplePlugin` instead

### Hooks

Hooks are backend lifecycle entry points. They answer "when does my plugin run?"

Use hooks for work tied to engine phases, such as project load, prompt injection, director preparation, writer completion, VN sequence transformation, background processing, persistence, and UI injection.

```javascript
hooks: {
  HOOK_POST_PROMPT_BUILDER: {
    priority: 50,
    run: async (context, tools) => {
      tools.prompt.inject('dynamic_knowledge', 'Plugin context goes here.');
    }
  }
}
```

`tools.prompt.inject(slot, content, 'root')` contributes to the immutable Director/Writer cache prefix. Root injection closes after `HOOK_PRE_ORCHESTRATOR`; use the `writer` or `director` target for later agent-private suffix content.

### Tools

`tools` is the backend SDK passed to hooks, exports, socket listeners, and related plugin callbacks. It answers "what engine capabilities can my backend plugin safely use?"

Important groups include:

- `tools.llm` for global-alias-routed LLM calls, structured output, batching, and token estimates
- `tools.prompt` for prompt wrapping and slot injection
- `tools.project` for sandboxed project files, metadata, file modes, and selected files
- `tools.assets` for project asset discovery and normalization
- `tools.db`, `tools.facts`, `tools.vector`, and `tools.memory` for storage and retrieval
- `tools.gui` for UI injection and VN intercept descriptor registration
- `tools.interludes` for headless/programmatic interlude commits
- `tools.sequence` and `tools.vn` for VN output and sequence helpers
- `tools.turns` for rewind-aware turn and interlude lookup
- `tools.director` and `tools.directives` for mechanical capabilities, scene phases, and directive access
- `tools.plugins` for exported cross-plugin APIs and manual hook firing
- `tools.pluginState` for plugin-owned runtime and per-turn state buckets
- `tools.socket`, `tools.status`, and `tools.logger` for communication and diagnostics
- `tools.jobs` for tracked long-running plugin work, progress, stale-turn checks, and cooperative cancellation
- `tools.network` for advanced plugin HTTP routes

### Model Aliases

LLM settings store only a global model alias. Provider and concrete-model selection belong to Models & Routing, not to individual plugins.

```javascript
settingsSchema: {
  model_def: {
    type: 'select',
    label: 'Analysis Model',
    options: 'llm-aliases',
    default: { model: 'lowendmodel' }
  }
}

const model = tools.settings.getSelf().model_def?.model;
if (!model) throw new Error('Configure an Analysis Model first.');

const response = await tools.llm.withSchema({
  model,
  messages,
  params: { retries: 1, timeout: 30000 }
}, resultSchema);
```

Do not persist a provider, pass a provider fallback, or treat an unknown alias as a literal model name. See [Example: Prompt and LLM](../plugin_dev/examples.md).

### Director and Directives

Use `tools.director` when a plugin contributes gameplay capabilities or scene phases. Use `tools.directives` to read and contribute through the supported directive surface instead of reaching into Director internals.

The [Director Integration example](../plugin_dev/examples.md) demonstrates capability registration, mechanical context, and ledger contributions.

### Plugin Interoperability

Expose small, documented async functions through `exports`. Consumers should declare the relationship and use `tools.plugins.tryCall()` with an explicit missing-plugin or error fallback.

```javascript
optionalDependencies: [
  { id: 'weather_plugin', reason: 'Adds local weather guidance.' }
]

const weather = await tools.plugins.tryCall(
  'weather_plugin',
  'getCurrentWeather',
  [context.turnNumber],
  { silent: true, fallback: null }
);
```

Do not read another plugin's private runtime state or database tables as an interoperability API. See the [Plugin Exports and Plugin Interoperability examples](../plugin_dev/examples.md).

Sprite-shadow sequence helpers are available through `tools.sequence`:

```javascript
tools.sequence.enableShadow(0, 'Dehya', { angleDegrees: 82, strength: 0.35 });
tools.sequence.disableShadow(4, 'Dehya');
```

Programmatic interludes are available through `tools.interludes`:

```javascript
await tools.interludes.createProgrammatic({
  parentTurnNumber: context.turnNumber,
  pluginId: 'my_plugin',
  label: 'Optional Challenge Result',
  fulltext: transcript,
  summary: summaryText,
  synopsis: synopsisText,
  isStoryRelevant: true,
  metadata: { source: 'my_plugin' }
});
```

This creates a minimal interlude context, calls `appendInterlude()`, and refreshes parent interlude memory by default without changing the parent turn's `output.fulltext`.

## Frontend Plugin World

Frontend plugin code runs in plugin views, standalone plugin windows, injected frontend assets, or VN intercept UI payloads. This is where plugins interact with the user and with the live viewer.

### Socket

`socket` is the frontend/backend transport. It is useful when a plugin UI needs to ask backend plugin code for data or send a user action back to the engine.

Use raw `socket.emit` and `socket.on` for event streams. Use the request/response convention when a reply is expected:

```javascript
const result = await socket.emitReceive('my-plugin:get-data', { id: 1 });
```

Plugin backend handlers usually live in `socketListeners` on the plugin definition. In plugin views, prefer `bridge.request(...)` unless you need raw socket access.

### Bridge

`bridge` is a client-side helper for the current frontend context. It is not the backend SDK; backend plugin code uses `tools.*`.

There are two bridge contexts:

- Plugin View Bridge: `window.bridge` from plugin tabs or standalone plugin windows
- VN Intercept Bridge: the per-intercept `bridge` passed to GUI intercept UI JavaScript

Plugin View Bridge is for normal plugin pages:

```javascript
bridge.on('my-plugin:update', render);
bridge.emit('my-plugin:save', payload);
const result = await bridge.request('my-plugin:get-data', {});
const info = bridge.getViewInfo();
```

VN Intercept Bridge is for UI that temporarily participates in VN playback or input flow. Think of it as props passed into the current injected UI run: it knows this intercept's lifecycle, host surface, socket, input flow, cleanup, and scoped VN presentation changes.

```javascript
bridge.intercept.resolve({ confirmed: true });
bridge.nav.forward(1);
bridge.input.setText('Edited player input');
bridge.actors.spawn({ actorId: 'guide', character: 'Dehya', x: 0.5, y: 1 });
bridge.actors.enableShadow('guide', { angleDegrees: 82, strength: 0.35 });
bridge.background.set({ src: 'assets/backgrounds/camp.png', instant: true });
```

For intercept-scoped Pixi actors, shadows can be toggled without respawning the actor:

```javascript
await bridge.actors.setShadow('guide', {
  enabled: true,
  angleDegrees: 82,
  strength: 0.35,
  length: 0.85,
  blur: 4
});

await bridge.actors.disableShadow('guide');
```

### VN

`VN` is the frontend VN viewer domain API exposed as `window.VN`. It is the global toolbox for code already running in the VN viewer page. Use it when you intentionally want raw live viewer control.

Public VN groups:

- `VN.ui` for dialogue, sprite visibility, and title UI
- `VN.cam` and `VN.camera` for camera zoom, pan, and reset
- `VN.anim` for character animation helpers
- `VN.sprites` for character FX layers, filters, and sprite texture helpers
- `VN.sfx` and `VN.audio` for sound triggers and volume-aware plugin audio
- `VN.command` for UCP command dispatch
- `VN.pixiPlugins` for advanced Pixi lifecycle registration

## Advanced VN Rendering

`VN.pixiPlugins` is the public VN-domain home for Pixi plugin lifecycle helpers. It is intended for injected VN frontend scripts that need tracked window listeners, socket listeners, Pixi ticker hooks, and cleanup.

```javascript
VN.pixiPlugins.register('my_vfx_plugin', (runtime) => {
  runtime.onSocket('execute-frontend-hook', handleHook);
  runtime.onPreRender((ticker) => updateEffect(ticker.deltaMS), 10);
  runtime.onDispose(cleanupEffect);
});
```

The legacy global `window.__PIXI_PLUGINS` still exists for compatibility, but new code should prefer `VN.pixiPlugins`.

## Mental Model

Most plugins only need three things:

```text
plugin definition -> hooks -> tools
```

Use `tools.*` for backend plugin work.

Plugins with a frontend usually add:

```text
socket -> bridge -> VN
```

Use plugin view `window.bridge` for normal plugin pages. Use intercept `bridge.*` first inside GUI intercept UI, because it is scoped to that run and can clean itself up. Use `window.VN` when frontend code needs direct global VN viewer features such as camera, sprite FX, title popouts, SFX, UCP commands, or the Pixi plugin runtime.

Advanced VN rendering plugins may also use:

```text
VN.pixiPlugins
```

When adding new engine-facing capability, prefer backend `tools.*`. When adding new live viewer capability, prefer frontend `VN.*` or the relevant `bridge.*` context.

## Safety Boundaries

| Capability | Minimum safe practice |
| --- | --- |
| Secrets | Read through `tools.settings.getSelf()` and never log, compare, or measure secret values. |
| Project files | Use `tools.project`, validate parsed data, and escape values before returning HTML. |
| Database access | Use parameterized SQL and keep plugin tables namespaced. |
| Networking | Validate routes and payloads, and expose only the smallest required surface. |
| Frontend HTML | Treat file content, settings, socket payloads, and model output as untrusted. |

Start with the [Plugin Example Catalog](../plugin_dev/examples.md), then use [Plugin Development 101](../plugin_dev/index.html) for the full development path and the [Plugin SDK](../plugin_sdk_tooling/index.html) to choose the appropriate tool group.
