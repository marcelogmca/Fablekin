# Plugin Architecture

Plugins are trusted Node.js extensions. They can participate in narrative turns, access scoped project tools, add UI, and expose APIs to other plugins. Install only code you trust.

## Discovery And Loading

Active plugins live in `engine/plugins/[pluginId]/`. Disabled plugins live in `engine/plugins/disabled/[pluginId]/`.

During discovery, Fablekin reads `index.js` as text to collect metadata without executing the plugin. Keep these manifest fields as simple static literals: `id`, `name`, `author`, `version`, `category`, `description`, dependency lists, flags, and settings schema.

After dependency ordering, the active plugin is required and registered. A loadable plugin must export an `id` and at least one of `hooks`, `socketListeners`, or `terminalCommands`; views, exports, or settings alone are not sufficient entry points.

## Dependencies

`dependencies` are hard requirements. The loader waits for each required ID to register successfully before loading the dependent plugin. A missing or failed dependency leaves the dependent plugin in the disabled registry with a boot error; its folder is not moved automatically.

`optionalDependencies` are informational and do not block startup. Use `tools.plugins.tryCall()` with explicit missing-plugin and error fallbacks when calling an optional plugin.

## Minimal Manifest

```javascript
module.exports = {
  id: 'my_plugin',
  name: 'My Plugin',
  version: '1.0.0',
  author: 'Your Name',
  category: 'Utility',
  description: 'Adds one clearly defined capability.',

  optionalDependencies: ['another_plugin'],

  hooks: {
    HOOK_TURN_START: {
      priority: 100,
      mode: 'sequential',
      run: async (turnContext, tools) => {
        tools.logger.log('Turn started.');
      }
    }
  }
};
```

Use `isExamplePlugin: true` for maintained reference plugins. Use `experimental: true` only for unfinished product features. Developer and reference plugins are grouped separately in Plugin Manager.

## Integration Points

Plugins can provide:

- Hooks, terminal commands, and socket listeners.
- Plugin settings, including alias-only LLM selectors.
- Exported functions for stable plugin-to-plugin APIs.
- Custom views, documentation, and frontend injection.
- File modes through `tools.project.registerFileMode()`.
- Namespaced HTTP routes through `tools.network.registerRoute()`; routes are prefixed with `/plugins/[pluginId]/`.
- Prompt injection, Director directives, assets, turns, jobs, state, facts, and managed project storage through `tools`.

Prefer a small exported API over reaching into another plugin's state. Consumers should use `tools.plugins.tryCall()` unless the dependency is hard and tightly coupled.

## LLM Settings

Text LLM settings choose aliases, never providers:

```javascript
settingsSchema: {
  model_def: {
    type: 'select',
    label: 'Model',
    options: 'llm-aliases',
    default: { model: 'lowendmodel' }
  }
}
```

Resolve the setting through `tools.llm.resolveModelDefinition()` and pass its alias to `tools.llm.runTask()`, `json()`, or `withSchema()`. Do not store a provider or add an OpenRouter fallback.

## Security And Lifecycle

Plugin code runs with Node.js capabilities. Treat filesystem access, network requests, SQL, generated frontend HTML, and secret handling as security-sensitive.

- Use sandboxed project/file APIs instead of constructing unrestricted paths.
- Read secrets through `tools.settings.getSelf()` only; never log or return them.
- Validate terminal-command arguments and route input.
- Escape untrusted content before injecting HTML.
- Dispose frontend listeners, timers, and Pixi resources when their lifecycle ends.

## Suggested Structure

```text
my_plugin/
  index.js          # manifest and registrations
  logic.js          # backend behavior
  ui.js             # optional frontend payload
  README.md         # activation, behavior, and adaptation notes
  docs/             # optional plugin documentation
  views/            # optional custom view assets
```

`package.json`, prompts, and assets are optional. Keep the manifest small and move substantial behavior into focused modules.

## Related Documentation

- [Hook Execution and Runtime](hooks_runtime.md)
- [Plugin API Groups](api_groups.md)
- [Plugin State and Storage](plugin_state.md)
- [Plugin Example Catalog](../plugin_dev/examples.md)
