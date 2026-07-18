# Plugin State And Storage

Choose storage by lifetime and purpose. Small pipeline state belongs in the TurnContext, narrative facts belong in the facts database, and large artifacts belong in plugin storage.

## Storage Layers

| Need | API | Stored under |
| :--- | :--- | :--- |
| Scratch data for the active TurnContext | `tools.pluginState.runtime()` | `turnContext.runtime.plugins[pluginId]` |
| Small state attached to a turn snapshot | `tools.pluginState.turn()` | `turnContext.processed.plugins[pluginId]` |
| Searchable or consolidatable narrative memory | `tools.facts.*` | Project facts database |
| Images, audio, exports, and large cache files | `tools.project.getChatPluginStorage()` | Managed project plugin directory |

## Runtime State

Runtime state is mutable scratch space shared by hooks that receive the same TurnContext:

```javascript
const state = tools.pluginState.runtime({ executions: 0 });
state.executions += 1;
```

Runtime is transient by default. If `infrastructure.enable_runtime_persistence` is enabled, serializable runtime fields may be saved for debugging, subject to the TurnContext runtime denylist. Do not use runtime state as durable product storage.

## Turn State

Turn state is persisted with `turnContext.processed`:

```javascript
const state = tools.pluginState.turn({ chosenColor: null });
state.chosenColor = 'red';
state.reason = 'Selected by the scene color classifier.';
```

It travels with that turn's snapshot, including normal history and branch behavior. Regenerating a turn should rebuild deterministic state rather than assume an earlier attempt still applies.

Both state functions return the raw mutable object. A supplied default object or array is shallow-copied only when the bucket does not yet exist.

## State API

```javascript
tools.pluginState.runtime(defaultValue?)
tools.pluginState.turn(defaultValue?)
tools.pluginState.clearRuntime()
tools.pluginState.clearTurn()
```

To inspect an explicit TurnContext:

```javascript
const previous = tools.pluginState
  .fromContext(previousTurnContext)
  .turn();
```

`forPlugin()` can access another plugin's bucket:

```javascript
const shared = tools.pluginState
  .forPlugin('closely_coupled_plugin')
  .turn();
```

Treat this as tight internal coupling. For ordinary plugin interoperability, expose a documented function and call it through `tools.plugins.tryCall()`. That gives the provider plugin control over validation and allows the consumer to handle disabled or missing dependencies cleanly.

## Facts

Facts are scoped automatically to the active project, turn key, scene mode, and owning plugin. Store the value in `fact_value`:

```javascript
await tools.facts.cleanUpFactsDb({
  predicates: ['SCENE_WEATHER']
});

await tools.facts.appendToFactsDb({
  source: 'scene',
  target: '',
  predicate: 'SCENE_WEATHER',
  fact_value: 'sunny',
  context: 'Weather established by the current scene.'
});
```

Scoped cleanup before regeneration prevents obsolete facts from surviving when a plugin emits a different set on a later attempt. Use facts only when future turns need to query, reason about, or consolidate the information; ordinary UI or bookkeeping state is cheaper in plugin state.

## Managed Chat Storage

Use managed storage for files too large for a TurnContext:

```javascript
const storage = tools.project.getChatPluginStorage();

// storage.absolutePath
// storage.relativePath
// storage.chatName
// storage.turnNumber
// storage.storageTurnKey  // e.g. "53" or interlude "53.1"
```

The layout is:

```text
plugins/[ChatName]/[TurnStorageKey]/[PluginId]/
```

For delayed work tied to an older context, resolve against that context instead of the currently active turn:

```javascript
const storage = tools.project.getChatPluginStorageFromContext(
  sourceTurnContext
);
```

Branch operations copy and prune the managed hierarchy. Chat deletion removes the chat's managed plugin directory. Turn deletion fires `HOOK_TURN_DELETED`; plugins that create physical per-turn files must remove the corresponding files in that lifecycle hook.

Use the plugin's sandboxed file tools for reads and writes. Do not construct paths outside the managed project root.

## Rule Of Thumb

```text
Needed only while this TurnContext runs?  pluginState.runtime()
Small data attached to the saved turn?     pluginState.turn()
Narrative memory for future reasoning?     facts.*
Large generated artifact or cache file?    getChatPluginStorage()
Cross-plugin behavior?                     exported API + plugins.tryCall()
```

## Related Documentation

- [Plugin Database Best Practices](../plugin_db_best_practices/index.md)
- [Plugin API Groups](api_groups.md)
- [Example Plugin Catalog](../plugin_dev/examples.md)
