# Configuration Management

Fablekin keeps application-wide settings separate from each project's content configuration. Treat these as different layers: global settings choose how the application runs; a project configuration describes one story workspace.

## Global Settings

Global settings live in `workspace/settings.json`.

### What belongs here

- Provider connection details and non-secret endpoints.
- Global model alias routes in `infrastructure.llm_routing.aliases`.
- Core narrative-agent alias assignments.
- Installed plugin settings.
- Theme, socket, logging, caching, pricing, and other application infrastructure.

Text-generation routes are global. A module or plugin stores an alias such as `highendmodel`; the alias stores its provider, concrete model, and optional subprovider:

```json
{
  "infrastructure": {
    "providers": {
      "nano_gpt": { "url": "https://nano-gpt.com/api/v1" }
    },
    "llm_routing": {
      "aliases": {
        "highendmodel": {
          "provider": "nano_gpt",
          "model": "deepseek/deepseek-v4-flash:thinking",
          "subprovider": "Deepseek"
        }
      }
    }
  }
}
```

The four built-in aliases are managed in Settings. Custom aliases are an advanced `settings.json` feature and appear automatically in alias pickers when valid.

### Secrets

Provider API keys and plugin secret fields are stored through Electron SafeStorage. They are removed before `settings.json` is written. Never add API keys to source control, plugin manifests, or model-route definitions.

### Read And Save Behavior

The settings reader accepts JSON5, so a manually edited file may contain comments and flexible syntax. A successful application save normalizes the result and writes standard formatted JSON; comments are not preserved.

Saves are serialized, written through a uniquely named temporary file, and renamed with retries for transient file-lock errors. Stale temporary files are cleaned up on later startup. This reduces the chance of concurrent writes or a crash corrupting the main file.

Legacy root-level theme and socket fields are normalized into `infrastructure` when settings are loaded and saved.

### Model Pricing

`infrastructure.model_costs` holds USD-per-million-token pricing used by the Log Inspector:

```json
{
  "model_costs": {
    "nano_gpt": {
      "vendor/model-name": {
        "input": 0.14,
        "cache_read": 0.03,
        "cache_write": 0.14,
        "output": 0.28,
        "unit": "USD per 1M tokens"
      }
    }
  }
}
```

`cache_read` and `cache_write` are optional; omitted values use the normal input rate. `infrastructure.include_cache_usage` asks OpenRouter for detailed cache usage. NanoGPT may report cache reads without that flag.

## Project Configuration

Each project is a directory under the projects workspace. Its configuration file is named after the directory:

```text
[ProjectDirectory]/[ProjectDirectory].config
```

The on-disk format is structured:

```json
{
  "files": {},
  "metadata": {},
  "directives": {},
  "ui": {},
  "runtime": {}
}
```

`files` tracks Content Manager modes and ordering. `metadata` holds project information such as the player profile and notes. `directives` stores project and plugin narrative instructions. `ui` holds project-local display preferences. `runtime` contains internal bookkeeping such as pending file renames.

The Content Manager still exposes a flat compatibility shape at its boundaries, including legacy `__project_metadata__` and related keys. Loading an older flat file converts it in memory; saving writes the structured on-disk format. Do not depend on either representation outside the relevant configuration APIs.

## Plugin Guidance

Plugins should use `tools.settings` for their global settings and `tools.project` for project metadata or file configuration. Do not write either configuration file directly.

Use the narrowest appropriate layer:

- Global plugin preference: plugin settings.
- Project-specific story preference: project metadata or directives.
- Per-turn data: `tools.pluginState.turn()`.
- Long-term narrative memory: `tools.facts.*`.

## Related Documentation

- [LLM Orchestration](../narrative/llm_orchestration.md)
- [Plugin State and Storage](../plugins/plugin_state.md)
- [Project Structure](../management/project_structure.md)
