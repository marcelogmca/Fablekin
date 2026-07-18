# Example: Plugin Settings

## Purpose
Shows common settings controls and the plugin-scoped settings API.

## Try it
Enable the plugin, change its fields in Plugin Manager, then inspect the boot log or use its namespaced socket actions. Defaults are created only when the plugin is enabled.

## Key APIs
`settingsSchema`, `tools.settings.getSelf()`, `set()`, and `update()`.

## Adapt it
Copy only the field types your plugin needs and keep setting IDs in snake_case.
