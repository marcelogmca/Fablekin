> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# GUI Intercept SDK

This is the full plugin-author guide for VN GUI intercepts: registration, payload builders,
chain execution, replay behavior, bridge API, and persistence lanes.
The goal is to let you build deterministic, rewind-safe, composable UI gameplay layers.

[1. Mental Model](#mental-model)
[2. Quick Start](#quick-start)
[3. Registration API](#registration-api)
[4. Descriptor Schema](#descriptor-schema)
[5. Checkpoints and Timing](#checkpoint-timing)
[6. Chain Engine](#chain-engine)
[7. Replay Policies](#replay-policy)
[8. Persisted vs Runtime Lanes](#lanes)
[9. UI Payload Builders](#payload-builders)
[10. Intercept Bridge API](#bridge-api)
[11. Action Contract](#action-contract)
[12. Runtime Memory Behavior](#runtime-memory)
[13. Socket Events](#socket-events)
[14. Recommended Patterns](#patterns)
[15. End-to-End Examples](#examples)
[16. Troubleshooting](#troubleshooting)
[17. Reference Cheatsheet](#reference)

## 1) Mental Model

A GUI intercept is a plugin-defined middleware step attached to a VN viewer checkpoint.
Intercepts are registered as descriptors on turn context, then executed by the viewer orchestrator.

- Plugin hook registers one or more intercept descriptors.

- VN payload sent to viewer includes intercept manifest.

- Viewer enters checkpoints during navigation/submit flow.

- Orchestrator runs a sorted chain of matching descriptors.

- For each descriptor, UI payload is fetched or inlined and executed.

- UI calls bridge methods to continue, cancel, navigate, or submit.

Intercepts are plugin-owned. Core handles orchestration, state keys, execution order, and transport.

## 2) Quick Start

### Step A: Register a descriptor



```
hooks: {
  HOOK_GUI_GATEKEEPER: {
    priority: 10,
    run: async (context, tools) => {
      tools.gui.registerRuntimeIntercept({
        interceptId: "sample_gate",
        checkpoint: "before_first_dialogue",
        blocking: true,
        priority: 50
      });
    }
  }
}
```



### Step B: Export a payload factory



```
exports: {
  guiIntercepts: {
    async sample_gate(context, tools, descriptor, request) {
      return {
        html: "<div>Hello intercept</div>",
        css: "div { color: white; }",
        js: "bridge.intercept.resolve({ confirmed: true });"
      };
    }
  }
}
```



### Step C: Use bridge in JS



```
// Declarative intercept JS receives (bridge, socket, context)
const btn = document.getElementById("continue-btn");
if (btn) {
  btn.onclick = () => bridge.intercept.resolve({ confirmed: true });
}
```



## 3) Registration API

Available from `tools.gui`.

| Method | Purpose | Lane |
| --- | --- | --- |
| registerIntercept(descriptor, options) | Generic registration helper. Choose lane via options. | persisted by default, runtime if options.runtime === true or options.persistence === "runtime". |
| registerPersistentIntercept(descriptor) | Explicit persisted lane registration. | Persisted |
| registerRuntimeIntercept(descriptor) | Explicit runtime lane registration. | Runtime |
| clearIntercepts({ lane }) | Clears registered descriptors from current context. | persisted, runtime, or both. |

### Normalization defaults applied during registration

- `pluginId` defaults to current plugin id.

- `interceptId` defaults to `descriptor.interceptId` or `descriptor.id` or generated unique id.

- `checkpoint` defaults to `on_dialogue_enter`.

- `priority` defaults to `100`.

- `blocking` defaults to `true`.

- `renderer` defaults to `html`.

- `replayPolicy` defaults to `every_enter`.

- `stateScope` defaults to `turn`.

- `persistence` is set automatically from lane.

## 4) Descriptor Schema

Current supported and observed fields.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| pluginId | string | current plugin | Owner plugin identity. |
| interceptId | string | generated | Stable identifier used in builder lookup and status keys. |
| checkpoint | string | on_dialogue_enter | Trigger point. |
| dialogueIndex | integer or null | null | For dialogue-index scoping on on_dialogue_enter. |
| priority | number | 100 | Lower runs first. |
| blocking | boolean | true | Blocking intercept halts chain until resolved. |
| renderer | string | html | html (overlay/DOM) or pixi (canvas takeover mode). |
| replayPolicy | string | every_enter | Controls reruns on navigation/re-entry. |
| stateScope | string | turn | Accepted but not currently enforced by orchestrator logic. |
| persistence | string | lane-derived | persisted or runtime. |
| inlineUi | object | null | If present, bypasses backend payload request. |
| timeoutMs | number | 120000 | Blocking intercept timeout. |
| durationMs | number | 3500 | Non-blocking host cleanup time. |
| transitionIn | object | null | Optional enter transition descriptor (effect, scope, durationMs, ...). |
| transitionOut | object | null | Optional exit transition descriptor (effect, scope, durationMs, ...). |
| payload | any object | none | Plugin custom data. |

### Checkpoint normalization behavior

- If `checkpoint` is valid, it is used as-is.

- If invalid and `dialogueIndex < 0`, checkpoint becomes `before_first_dialogue`.

- If invalid and dialogue index is absent/non-negative, checkpoint becomes `on_dialogue_enter`.

## 5) Checkpoints and Timing

| Checkpoint | When it runs | Where in viewer flow |
| --- | --- | --- |
| before_first_dialogue | On scene entry when index is 0. | showMessage(0) path. |
| on_dialogue_enter | On every showMessage(index). | Before scene render logic. |
| before_user_input_show | When entered scene is virtual input line (isVirtual === true). | Scene entry chain. |
| during_user_input | While the user-input surface is active. | Input overlay chain; suitable for line-scoped helpers that should remain visible until submission. |
| before_submit | Before processMessage(...) when user sends input. | submitUserInput(...) path. |

**Bypass mode:** submit flows that call `submitUserInput({ skipBeforeSubmit: true })`
will skip the `before_submit` chain. This is intentionally used by bridge submit helpers to avoid recursion.

## 6) Chain Engine

### Selection

- Match descriptor checkpoint.

- For `on_dialogue_enter`, enforce `descriptor.dialogueIndex` when provided.

- Apply replay policy against status state.

### Order

- Sort by `priority` ascending.

- Tie-break by registration order.

### Status keying model

Status entries are keyed by a deterministic composite:
`turn|checkpoint|index|plugin|intercept`.

### Session-level memory used by policies

- `statusByKey`: visit count, ran, resolved, last result for current key.

- `sessionResolved`: plugin/intercept resolution memory across turns for `once_per_session`.

- `pluginState`: plugin key-value state exposed via bridge.

### Resolution marking rules

Descriptor status is marked as resolved when resulting action is
`continue`, `navigate`, or `submit`.
This matters for `until_resolved` and `once_per_session`.

## 7) Replay Policies

| Policy | Behavior |
| --- | --- |
| every_enter | Runs every time checkpoint is entered. |
| once_per_turn | Runs only if key has not run yet this turn-key combination. |
| until_resolved | Runs repeatedly until result marks descriptor as resolved. |
| once_per_session | Runs once per viewer session keyed by plugin + intercept id. |

## 8) Persisted vs Runtime Lanes

### Persisted lane

- Stored on `turnContext.output.guiIntercepts`.

- Emitted in VN payload and replayable from historical turns.

- Use for narrative-critical or rewind-consistent intercepts.

### Runtime lane

- Stored on `turnContext.runtime.guiIntercepts`.

- Emitted for live turn but explicitly denied from runtime snapshot persistence.

- Use for one-shot tactical/gameplay overlays and temporary effects.

Runtime lane is blocked from serialization via runtime deny list, so it will not survive DB restore.

## 9) UI Payload Builders

If descriptor has no `inlineUi`, viewer asks backend for payload via
`request-gui-intercept-ui`. Plugin manager resolves a factory in this order:

- `plugin.exports.guiIntercepts[interceptId]` then `plugin.exports.guiIntercepts.default`

- `plugin.exports.guiIntercept`

- `plugin.exports.buildGuiIntercept`

- Top-level plugin object equivalents (`guiIntercepts`, `guiIntercept`, `buildGuiIntercept`)

Factory signature:



```
async function builder(context, tools, descriptor, request) {
  return { html, css, js };
}
```



### Payload contract

- `html`: optional markup string mounted in host container.

- `css`: optional stylesheet text inserted into a style tag.

- `js`: optional script body executed via `new Function(...)`.

### Blocking vs non-blocking payload execution

- Blocking: mounted in `#plugin-overlay`, waits for bridge completion, cleans up on resolve/reject/timeout.

- Blocking + `renderer: "pixi"`: enters canvas takeover mode, disables VN controls/input, pauses VN audio, and waits for takeover completion.

- Non-blocking: mounted in temporary host with auto cleanup after `durationMs` (default 3500 ms).

- If non-blocking descriptor has no payload, viewer dispatches `window` event `vn:gui-intercept-nonblocking`.

Declarative intercept JS runs with arguments `(bridge, socket, context)`.

## 10) Intercept Bridge API

### Bridge object summary



```
{
  meta: { apiVersion, renderer, runId, pluginId, interceptId, checkpoint },
  resolve(data),
  resolveProjectPath(relPath, projectName?),
  resolvePluginPath(pluginId, relPath),
  lifecycle: { onDispose, onAbort, onPause, onResume, setTimeout, setInterval, requestAnimationFrame, onWindow },
  assets: { plugin, project, url, loadText, loadJson, loadImage, loadAudio, loadTexture, preload },
  surface: { type, getRoot, getLayer, getSize, onResize, setPointerMode },
  player: { getState, getScene, getTurn, getSettings, getActiveCharacters, getBackground, ui: { lock, restore, ... } },
  pixi: { getApp, getLayer, getLogicalSize, toLogicalPoint, onTick, loadTexture, add, destroy },
  audio: { getVolume, createManagedAudio, play, loop, stop, duckVN, restoreVN },
  storage: { get, set, patch, delete, clear, keys, getNamespace },
  log: { debug, info, warn, error, mark },
  intercept: { resolve, reject, defer, skip, getContext },
  nav: { forward, back, goTo },
  input: { getText, setText, submitAndGenerate, cancelSubmit },
  takeover: { resolve, finish, abort, skip, isActive, getContext, getLayer, clearLayer },
  actors: { spawn, update, setShadow, enableShadow, disableShadow, remove, clear, hideNativeSprites },
  background: { set, restore, end, get },
  context: { get },
  state: { get, set, clear },
  socket: { emit, request, on, once, off }
}
```



### `lifecycle.*`

- Use lifecycle timers and animation frames instead of raw browser timers so they are cancelled when the intercept ends.

- `lifecycle.onWindow(event, handler)` tracks and removes window listeners automatically.

- `lifecycle.onDispose(fn)` is the final cleanup hook for DOM handlers, Pixi objects, and third-party resources.

- `bridge.socket.on()` and `bridge.socket.once()` also unregister their listeners during disposal.

### `intercept.*`

- `intercept.resolve(data)`: complete as continue by default, or cancel if `data.cancel === true`.

- `intercept.reject(reason)`: complete as cancel.

- `intercept.defer(data)`: continue while marking the result as deferred.

- `intercept.skip(reason)`: complete as cancel.

- `intercept.getContext()`: returns run snapshot (run id, checkpoint, dialogue index, scene index, turn number, descriptor).

### `nav.*`

- `nav.forward(steps)`: calls viewer forward handler and finalizes with `action: "navigate"`.

- `nav.back(steps)`: calls viewer back handler and finalizes with `action: "navigate"`.

- `nav.goTo(index)`: jumps to index and finalizes with `action: "navigate"`.

### `input.*`

- `input.getText()`: reads user input field.

- `input.setText(text)`: writes user input field.

- `input.submitAndGenerate(options)`: triggers send path with `skipBeforeSubmit: true`, finalizes with `action: "submit"`.

- `input.cancelSubmit(reason)`: finalizes with `action: "cancel"`.

### `state.*`

- `state.get(key)`, `state.set(key, value)`, `state.clear(key?)`.

- Scope is plugin-local inside viewer intercept runtime memory.

- Useful for preserving UI state or listener references between re-entries.

### `takeover.*` (important for `renderer: "pixi"`)

- `takeover.finish(data)` / `takeover.resolve(data)`: end takeover as `continue`.

- `takeover.abort(reason, data)` / `takeover.skip(reason, data)`: end takeover as `cancel`.

- `takeover.isActive()`: whether current run still owns the takeover lock.

- `takeover.getContext()`: current takeover metadata + descriptor/checkpoint context.

- `takeover.getLayer()`: returns plugin-owned PIXI layer container for rendering.

- `takeover.clearLayer()`: removes children from the plugin takeover layer.

### `context.pluginRuntime` (available for `renderer: "pixi"`)

- `context.pluginRuntime`: takeover payload reference to the same runtime exposed publicly as `VN.pixiPlugins`.

- `pluginRuntime.register(id, setupFn)`: Register a new plugin with tracked ticker hooks and event listeners.

- `pluginRuntime.dispose(id)`: Dispose a registered plugin (removes all hooks and listeners).

- `pluginRuntime.isPaused(id)`: Check if a VN plugin is currently paused (during takeover).

- Mini-game plugins should `register()` at takeover start and `dispose()` before calling `bridge.takeover.finish()`.

VN plugins (VFX, sprite shading, alive backgrounds) are automatically paused when a PIXI takeover begins
and resumed when it ends. Mini-game plugins registered via `pluginRuntime.register()` during a takeover
are NOT auto-paused — they were just created. They should self-dispose before finishing.

## 11) Action Contract

Orchestrator recognizes these action outcomes from blocking intercepts.

| Action | Meaning | Effect on chain/flow |
| --- | --- | --- |
| continue | Intercept completed normally. | Chain continues. |
| navigate | UI requested forward/back/goTo. | Chain halts, scene render path halts for current call. |
| submit | UI explicitly submitted input. | before_submit caller treats as handled and stops normal submit path. |
| cancel | User canceled/rejected/timed out. | Chain halts as blocked/canceled. |
| error | Execution failure. | Chain halts as error. |

### Result data overrides

Result `data` may include override keys:

- `messageOverride` or `userInputOverride`

- `directorPromptOverride` or `directorOverride`

These overrides are especially relevant to `before_submit` intercepts.

## 12) Runtime Memory Behavior

### What resets per turn

- `descriptors`

- `statusByKey`

- `currentTurnNumber`

### What persists across turns in viewer session

- `sessionResolved` (used by `once_per_session`)

- `pluginState` (bridge state store)

### Takeover state

- `interceptRuntime.takeover` tracks active PIXI takeover lock metadata for current viewer run.

- Takeover lock is automatically released on completion, timeout, or intercept cleanup.

This is useful for long-lived UI behavior and cross-turn caching inside a single viewer session.

## 13) Socket Events

| Event | Direction | Purpose |
| --- | --- | --- |
| request-gui-intercept-ui | Viewer -> backend | Request declarative payload for a descriptor run. |
| request-gui-intercept-ui-response | Backend -> viewer | Return payload or error for a run. |
| vn:gui-intercept-nonblocking | Viewer internal event | Dispatched when non-blocking descriptor has no payload object. |

### Declarative payload request body



```
{
  interceptRunId,
  pluginId,
  interceptId,
  descriptor,
  checkpoint,
  checkpointContext
}
```



### Request timeout values

- Viewer payload fetch wait: `90000 ms`.

- Blocking overlay auto-timeout: descriptor `timeoutMs` or default `120000 ms`.

- Blocking PIXI takeover auto-timeout: descriptor `timeoutMs` or default `300000 ms`.

## 14) Recommended Patterns

### A) One plugin, many intercepts

Use `exports.guiIntercepts` map and stable `interceptId` keys.

### B) Listener lifecycle safety

Use the lifecycle-aware bridge wrappers. They detach listeners and cancel timers automatically when the run resolves, aborts, times out, or is disposed.



```
const handler = (payload) => { /* ... */ };
bridge.socket.on("my_plugin:event-name", handler);

bridge.lifecycle.setTimeout(() => {
  bridge.intercept.skip("timed_out");
}, 30000);

bridge.lifecycle.onDispose(() => {
  // Clean up third-party resources not owned by another bridge helper.
});
```



### C) Choose lane intentionally

- Use persisted lane for narrative gates that should replay when user revisits turns.

- Use runtime lane for ephemeral effects and one-off mechanics.

### D) Use priorities to compose plugins

- Lower values run first.

- Reserve ranges by plugin if many plugins share checkpoints.

### E) Keep non-blocking intercepts lightweight

- Avoid heavy DOM growth in repeated entry checkpoints.

- Set explicit `durationMs` for effect hosts.

### F) Use PIXI takeover for full gameplay beats

- Set descriptor `renderer: "pixi"` + `blocking: true`.

- Render only inside `bridge.takeover.getLayer()`; do not mutate base VN layers directly.

- Always end with `bridge.takeover.finish(...)` or `bridge.takeover.abort(...)`.

## 15) End-to-End Examples

### Example 1: Persisted dialogue gate on index 2



```
tools.gui.registerPersistentIntercept({
  interceptId: "inspect_artifact",
  checkpoint: "on_dialogue_enter",
  dialogueIndex: 2,
  blocking: true,
  replayPolicy: "every_enter",
  priority: 40
});
```



### Example 2: Before submit content transform



```
// intercept JS
const text = bridge.input.getText();
bridge.intercept.resolve({
  userInputOverride: text + "\n[plugin_tag]",
  directorPromptOverride: "Keep suspense high."
});
```



### Example 3: Non-blocking checkpoint effect



```
tools.gui.registerRuntimeIntercept({
  interceptId: "pulse_fx",
  checkpoint: "on_dialogue_enter",
  dialogueIndex: 0,
  blocking: false,
  durationMs: 1600
});
```



### Example 4: Descriptor with inline UI (no backend request)



```
tools.gui.registerRuntimeIntercept({
  interceptId: "inline_gate",
  checkpoint: "before_first_dialogue",
  blocking: true,
  inlineUi: {
    html: "<button id='ok'>Continue</button>",
    js: "document.getElementById('ok').onclick = () => bridge.intercept.resolve({ ok: true });"
  }
});
```



### Example 4b: Intercept with enter/exit transitions



```
tools.gui.registerRuntimeIntercept({
  interceptId: "stylized_gate",
  checkpoint: "before_first_dialogue",
  blocking: true,
  transitionIn: { effect: "circle_fade", scope: "intercept", durationMs: 500 },
  transitionOut: { effect: "fade", scope: "intercept", direction: "out", durationMs: 350 },
  inlineUi: {
    html: "<button id='ok'>Continue</button>",
    js: "document.getElementById('ok').onclick = () => bridge.intercept.resolve({ ok: true });"
  }
});
```



### Example 5: PIXI takeover with lifecycle runtime



```
tools.gui.registerRuntimeIntercept({
  interceptId: "boss_minigame",
  checkpoint: "on_dialogue_enter",
  dialogueIndex: 50,
  blocking: true,
  renderer: "pixi",
  replayPolicy: "until_resolved"
});

// guiIntercepts.boss_minigame => returns { renderer: "pixi", js: "..." }
// Inside the JS payload:
const { pluginRuntime, pixiLayer, PIXI } = context;

// Register a game tick
pluginRuntime.register('boss_minigame', (runtime) => {
    runtime.onPreRender((ticker) => { /* game loop */ }, 0);
    runtime.onDispose(() => { /* cleanup game state */ });
});

// When the player wins:
pluginRuntime.dispose('boss_minigame');
bridge.takeover.finish({ result: "win" });
```



### Example 6: Inline PIXI takeover (no server round-trip)



```
tools.gui.registerRuntimeIntercept({
  interceptId: "quick_cutscene",
  checkpoint: "on_dialogue_enter",
  dialogueIndex: 10,
  blocking: true,
  renderer: "pixi",
  replayPolicy: "once",
  inlineUi: {
    js: `
      const { pixiLayer, PIXI } = context;
      const bg = new PIXI.Graphics();
      bg.rect(0, 0, 1920, 1080);
      bg.fill({ color: 0x000000, alpha: 0.9 });
      pixiLayer.addChild(bg);

      // ... render cutscene content ...

      bg.eventMode = 'static';
      bg.on('pointerdown', () => bridge.takeover.finish());
    `
  }
});
```



`inlineUi` embeds the JS payload directly in the descriptor, bypassing the server round-trip
to `guiIntercepts`. This is ideal for simple, self-contained takeovers that don't need
server-side data or dynamic payload generation. The trade-off is that the JS string lives in
the hook registration code, so it's harder to maintain for complex mini-games.

## 16) Troubleshooting

### Symptom: plugin calls `tools.gui.intercept(...)` and fails

- The legacy imperative intercept API has been removed.

- Migrate to declarative descriptors using `tools.gui.registerRuntimeIntercept` or `registerPersistentIntercept`.

- Implement payload builders under `exports.guiIntercepts`.

### Symptom: intercept never fires

- Descriptor checkpoint mismatch with current flow.

- `dialogueIndex` mismatch for `on_dialogue_enter`.

- Replay policy suppressing re-run.

### Symptom: payload request fails

- Plugin id not loaded, or factory export missing.

- Factory throws; inspect backend logs around payload builder errors.

- Check route wiring for `request-gui-intercept-ui`.

### Symptom: submit runs twice or loops

- Use `bridge.input.submitAndGenerate` instead of calling send path indirectly.

- Do not manually trigger submit and then also resolve with submit semantics.

### Symptom: stale socket listeners

- Detach previous listener references via `bridge.state` before attaching new ones.

### Symptom: controls stay locked after a gameplay intercept

- Ensure PIXI takeover paths always end with `bridge.takeover.finish(...)` or `bridge.takeover.abort(...)`.

- Avoid throwing before cleanup wiring is attached in takeover JS.

- Set a plugin-side safety timeout that ends takeover if gameplay stalls.

### Symptom: plugin listeners fire twice after server restart / socket reconnect

- **Cause**: `inject-permanent-assets` re-fires on reconnect,
and the plugin JS re-executes without cleanup.

- **Fix**: Use `VN.pixiPlugins.register()` for long-lived PixiJS
frontend code. The runtime auto-disposes the previous instance on re-registration,
preventing double event listeners and ticker hooks.

- For intercept payloads, use `bridge.lifecycle` and `bridge.socket`. For permanent non-Pixi frontend injection, expose an idempotent plugin-owned disposer before re-registering listeners.

If you use aggressive replay (`every_enter`) and attach listeners each run without cleanup,
event handlers can multiply quickly.

## 17) Reference Cheatsheet

### Valid checkpoints



```
before_first_dialogue | on_dialogue_enter | before_user_input_show | during_user_input | before_submit
```



### Valid replay policies



```
every_enter | once_per_turn | until_resolved | once_per_session
```



### Minimal descriptor



```
{
  interceptId: "my_id",
  checkpoint: "on_dialogue_enter"
}
```



### Recommended descriptor



```
{
  interceptId: "my_id",
  checkpoint: "on_dialogue_enter",
  dialogueIndex: 0,
  blocking: true,
  priority: 50,
  replayPolicy: "every_enter",
  payload: {}
}
```



For a living reference implementation, inspect
`engine/plugins/disabled/example_vn_gui_intercept/index.js`,
`backend.js`, and `payloads.js`.