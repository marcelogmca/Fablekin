# GUI Intercepts & Overlays

The GUI Intercept system is the primary mechanism for extending the VN Viewer with plugin-driven logic. It allows plugins to pause the narrative and present custom interfaces.

## 1. How Intercepts Work

Intercepts are registered during the turn generation process and delivered to the viewer as part of the chapter payload.

### Lifecycle Checkpoints
- `before_first_dialogue`: Runs before the very first line of a new chapter.
- `on_dialogue_enter`: Runs when a specific dialogue index is reached.
- `before_user_input_show`: Runs at the end of the chapter, before the user input box appears.
- `during_user_input`: Runs while input controls are active (used by overlay interlude pickers and return panels).
- `before_submit`: Runs immediately after the user clicks "Send."

---

## 2. Blocking vs. Non-Blocking

- **Blocking Intercepts**: These pause the `DialogueOrchestrator`. They are used for interactive menus, mini-games, or mandatory story choices. The game will not proceed until the intercept calls `bridge.resolve()`.
- **Non-Blocking Intercepts**: These execute "in the background" without pausing the text. They are used for environmental effects, persistent HUD updates, or ambient sounds.

### Resilience Contract
- If a descriptor cannot be resolved (stale plugin payload, missing builder, etc.), intercept UIs should degrade safely and release control.
- Runtime cleanup removes stale non-blocking overlays when context changes, avoiding persistent "ghost" overlays.
- Viewer-facing fallback UIs must never hard-lock progression.

---

## 3. The Intercept Bridge

Every intercept is provided with a `bridge` object, which serves as its secure API to the engine.

### Capabilities
- **Resolution**: `resolve(data)` ends the intercept and returns control to the engine.
- **Navigation**: `nav.forward(steps)` or `nav.goTo(index)` allows the intercept to jump to different points in the current chapter.
- **Input Manipulation**: `input.setText(val)` or `input.submitAndGenerate()` allows the intercept to act on behalf of the player.
- **Actor Rendering**: `actors.spawn/update/remove/clear` lets intercept UI place character sprites in a plugin-owned PIXI layer.
- **Native Sprite Locking**: `actors.hideNativeSprites(true/false)` hides or restores native scene sprites for that run.
- **Background Override**: `background.set/restore/get` provides run-scoped temporary background swaps.
- **State Management**: `state.get(key)` and `state.set(key, val)` provide persistent storage for the plugin during the turn.
- **Transitions**: Descriptors can define `transitionIn` / `transitionOut` to animate intercept entry/exit using the shared transition runtime.

---

## 4. Intercept Actor Sessions

- **Run Scope**: Every intercept run has its own actor session, keyed by run id.
- **Auto Cleanup**: Session actors are removed automatically on resolve, timeout, forced overlay cleanup, and chapter reset/load.
- **Canvas Constrained**: Actor sprites render inside the VN canvas on `Layer_InterceptActors`, not as floating DOM.
- **Sprite Features**: Spawned actors reuse core sprite systems (blink/talk/shading) when source data supports it.

---

## 5. PIXI Takeover

For advanced plugins requiring high-performance WebGL graphics, the system supports a **Pixi Takeover**.
- **The Takeover Layer**: The `TakeoverManager` provides a dedicated high-priority PIXI Container that sits above the character sprites.
- **Input Isolation**: During a takeover, standard VN inputs (like clicking to advance text) are suppressed, giving the plugin exclusive control over events.
- **Lifecycle Hooks**: Takeovers automatically trigger `takeover:enter` and `takeover:exit` events for synchronization.

---

## 6. Interlude UX Note

Internally, scene mode remains `interlude` for API compatibility.
User-facing language should prefer `Interlude` and `Chapter` labels in UI strings.

---

## 7. Intercept Transition Descriptors

Blocking and non-blocking intercept descriptors support optional:

```js
transitionIn: {
  effect: "circle_fade",
  scope: "intercept",
  durationMs: 500
},
transitionOut: {
  effect: "fade",
  scope: "intercept",
  direction: "out",
  durationMs: 350
}
```

Behavior notes:
- HTML intercepts animate the blocking/non-blocking host element.
- PIXI takeovers animate the takeover layer.
- Transition fields are optional and backward compatible.
