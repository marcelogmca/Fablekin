> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Plugin SDK

Backend tools and frontend integration map

[Overview](#overview)
[Core Tool Groups](#core-tools)
[Model Aliases](#model-aliases)
[State & Coordination](#state-coordination)
[Frontend Integration](#frontend-tools)
[GUI Intercepts](#gui-intercepts)
[Custom File Viewers](#file-viewers)

## Plugin Tooling Reference

Every backend plugin callback receives `(context, tools)`. Start here to choose the
correct SDK group, then use the focused guides and example plugins for complete implementations.

### Core Tool Groups

The `tools` object is grouped by responsibility. Prefer these APIs over direct access to engine internals.

- `tools.settings`: read and write plugin settings.

- `tools.llm`, `tools.prompt`: alias-routed model calls and prompt contributions.

- `tools.project`, `tools.assets`: sandboxed project files, selected files, and asset lookup.

- `tools.pluginState`, `tools.facts`, `tools.memory`, `tools.vector`: plugin-owned state and retrieval.

- `tools.turns`, `tools.sequence`, `tools.vn`, `tools.interludes`: timeline and VN output.

- `tools.director`, `tools.directives`: mechanical capabilities, scene phases, and directive access.

- `tools.plugins`: exported plugin API calls and manual hook execution.

- `tools.jobs`, `tools.status`: tracked work, progress, cancellation, and user feedback.

- `tools.gui`, `tools.socket`: frontend injection, intercept registration, and client events.

- `tools.db`, `tools.network`: advanced storage and HTTP routes; use narrowly and validate all input.

- `tools.logger`: scoped diagnostics without unstructured console output.

### Model Aliases

LLM settings store only a global alias. The engine resolves its provider and concrete model at call time.
Missing or invalid aliases are configuration errors; plugins must not add provider fallbacks.



```
settingsSchema: {
  model_def: {
    type: "select",
    label: "Analysis Model",
    options: "llm-aliases",
    default: { model: "lowendmodel" }
  }
}

const model = tools.settings.getSelf().model_def?.model;
if (!model) throw new Error("Configure an Analysis Model first.");

const response = await tools.llm.withSchema({
  model,
  messages,
  params: { retries: 1, timeout: 30000 }
}, resultSchema);
```


See [Example: Prompt and LLM](../plugin_dev/examples.md) for validation and prompt injection.

### State and Plugin Coordination

Use runtime state for process-local values, turn state for rewind-aware output, and facts for scoped timeline records.
Expose stable async functions under `exports` when another plugin needs your capability.



```
const runtime = tools.pluginState.runtime({ cache: {} });
const turnState = tools.pluginState.turn({ annotations: [] });

const result = await tools.plugins.tryCall(
  "optional_plugin",
  "getGuidance",
  [context.turnNumber],
  { silent: true, fallback: null }
);
```



Declare required integrations in `dependencies` and optional integrations in
`optionalDependencies`. See the [Plugin Example Catalog](../plugin_dev/examples.md)
for state, exports, and interoperability examples.

### Frontend Integration

Plugin views use `window.bridge` and namespaced socket events. VN frontend injections use
`window.VN` and `VN.pixiPlugins`. Intercept payloads receive a run-scoped
`bridge` with lifecycle cleanup, navigation, input, actor, and presentation helpers.



```
// Plugin view
const result = await bridge.request("my_plugin:get-data", {});

// Long-lived VN injection
VN.pixiPlugins.register("my_plugin", runtime => {
  runtime.onSocket("my_plugin:update", handleUpdate);
  runtime.onDispose(cleanup);
});
```



### GUI Intercepts

Intercepts are checkpoint middleware that can pause or augment VN playback and submission.
Register persisted or runtime descriptors with `tools.gui`, provide payload factories through
`exports.guiIntercepts`, and clean up every timer and listener through `bridge.lifecycle`.

The complete descriptor schema, checkpoints, replay policies, bridge methods, and lifecycle rules live in the
[GUI Intercept SDK](../gui_intercept_sdk/index.html).

### Custom File Viewers

Plugins can register custom viewers for specific file modes (e.g., custom lore formats, character profiles).
This is handled via the `provideFileView` export.

Registration
First, register a custom file mode during `HOOK_SYSTEM_BOOT` or `HOOK_PROJECT_LOADED`:



```
tools.project.registerFileMode("my-custom-mode", {
  label: "My Custom Viewer",
  description: "Structured files owned by this plugin.",
  viewer: true,
  schema: {
    title: { type: "text", label: "Title" }
  }
});
```



Implementation
Then, export `provideFileView` in your plugin manifest:



```
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = {
  id: "my_viewer_plugin",
  exports: {
    async provideFileView(context, tools, { modeId, filePath }) {
      if (modeId !== "my-custom-mode") return null;
      try {
        const data = JSON.parse(await tools.project.readFile(filePath));
        return {
          type: "html",
          content: "<h2>" + escapeHtml(data.title || "Untitled") + "</h2>"
        };
      } catch (error) {
        tools.logger.warn(`Could not render custom file: ${error.message}`);
        return { type: "text", content: "This file is missing or malformed." };
      }
    }
  }
};
```