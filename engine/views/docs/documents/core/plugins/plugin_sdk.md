# Plugin SDK (Tools Reference)

Every plugin hook receives a `tools` object. This object is a comprehensive SDK that allows plugins to interact with the engine's core subsystems safely and efficiently.

## 1. Context & Lifecycle
- `tools.turnContext`: Direct access to the current state of the narrative.
- `tools.pipeline.abort(reason)`: Immediately halts the current generation pipeline.
- `tools.jobs.start(name, options?)`: Starts a tracked plugin job with progress, cancellation, completion, and failure helpers.
- `tools.jobs.withJob(name, options?, fn)`: Wraps a long-running task in the same tracked lifecycle.

## 2. Communication & UI
- `tools.logger`: Methods for `log`, `warn`, `error`, and `turn` (persistent story logs).
- `tools.status.update(msg)`: Displays a message in the frontend status console.
- `tools.jobs.cancel(id?, reason?)`: Cooperatively cancels active jobs for the current plugin.
- `tools.gui.registerIntercept(descriptor)`: Injects a GUI modal or transition into the VN sequence.
- `tools.gui.openWindow(options)`: Opens a new standalone Electron window.

## 3. Storage & Database
- `tools.db.chat`: SQL interface for the current adventure's database.
- `tools.db.project`: SQL interface for the global project database.
- `tools.interludes.createProgrammatic(payload)`: Creates a headless interlude attached to a parent turn, with parent memory refresh enabled by default.
- `tools.project.readFile(path)`: Securely reads a file within the project sandbox.
- `tools.project.getPluginStorage()`: Returns the current plugin's project-wide storage path at `plugins/[PluginId]/`.
- `tools.project.getChatPluginStorage(turnOverride?)`: Returns an isolated path for chapter/interlude-specific plugin data.
- `tools.project.getChatPluginStorageFromContext(turnContext, turnOverride?)`: Same resolver for explicit contexts (useful in async callbacks that finalize older interludes).

## 4. AI & Knowledge
- `tools.llm.call(messages, params)`: Sends a request through the provider selected by `params.model`'s global alias.
- `tools.llm.getCoreModel(moduleId, role?)`: Returns one core module model assignment; the role defaults to `main`.
- `tools.llm.getCoreModels(moduleId?)`: Lists core model assignments, including multi-role modules.
- `tools.llm.getPluginModel(pluginId, settingKey?)`: Returns one plugin model assignment; the setting defaults to `model_def`.
- `tools.llm.getPluginModels(pluginId?)`: Lists model assignments declared through plugin `llm-aliases` settings.
- `tools.llm.resolveModelDefinition(definition)`: Resolves concrete or `{ inherit: "vn_background" }` model definitions.
- `tools.llm.vnBackground.getAssignment()`: Returns the canonical VN background provider/model assignment.
- `tools.llm.vnBackground.getMessages(suffix)`: Returns a cloned shared prefix followed by the supplied task suffix.
- `tools.llm.vnBackground.call/json/withSchema(...)`: Runs a cache-gated post-turn call on the canonical shared route.
- `tools.vector.query(text, limit)`: Performs a semantic search against the project's vector store.
- `tools.facts.getScope(overrides?)`: Returns the resolved fact scope for the current run (`turn_number`, `turn_key`, `scene_mode`, plugin id, interlude metadata).
- `tools.facts.upsert(fact, overrides?)`: Writes a scoped fact row (interlude-safe by default).
- `tools.facts.appendToFactsDb(fact, overrides?)`: Alias of `upsert` (same behavior, friendlier naming for plugin authors).
- `tools.facts.addFact(fact)`: Legacy-compatible writer; now interlude-safe when called through plugin tools.
- `tools.facts.cleanUpFactsDb(options?)`: Deletes existing rows for the current plugin + current `turn_key` (optional predicate/source/target filter) and runs orphan interlude cleanup automatically.
- `tools.prompt.inject(slot, content)`: Dynamically adds content to the main narrative prompt.
- `tools.pluginState.runtime(defaultValue?)`: Returns the current plugin's mutable runtime state bucket (`turnContext.runtime.plugins[plugin_id]`).
- `tools.pluginState.turn(defaultValue?)`: Returns the current plugin's mutable per-turn persisted state bucket (`turnContext.processed.plugins[plugin_id]`).
- `tools.pluginState.forPlugin(pluginId)`: Targets another plugin's state bucket for deliberate inter-plugin coordination.
- `tools.pluginState.fromContext(turnContext)`: Targets state buckets on another TurnContext.

## 5. Plugin Interoperability
- `tools.plugins.call(id, fn, ...args)`: Invokes a function exported by another plugin.
- `tools.plugins.fireHook(name, ...args)`: Triggers a custom hook that other plugins can listen to.

---

## Best Practices
- **Sandboxing**: Always use `tools.project.readFile` instead of the native `fs` module to ensure path safety.
- **Context Budgeting**: Use `tools.llm.countTokens` to estimate the size of your injections.
- **Asynchronicity**: Most tool methods are `async`. Always `await` them to prevent race conditions.
- **Background Jobs**: Use `tools.jobs` for long-running or fire-and-forget work that needs progress, stale-turn checks, or cooperative cancellation.
- **Facts Easy Mode**: For writes, prefer `tools.facts.cleanUpFactsDb(...)` then `tools.facts.appendToFactsDb(...)`.
- **Interlude Safety**: Let the tools derive `turn_key` from `turnContext`; avoid hardcoding keys like `53.2`.
- **Read Visibility**: Keep SQL reads bounded with `turn_number <= turnContext.turnNumber` unless your query intentionally needs a different window.

### Job Example

```javascript
await tools.jobs.withJob('Updating world knowledge graph', {
  id: 'kg-update',
  scope: 'turn'
}, async (job) => {
  job.progress(25, 'Extracting triples...');
  job.throwIfCancelled();

  await runLongTask({ signal: job.signal });

  job.complete('Knowledge graph updated');
});
```
