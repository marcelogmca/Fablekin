# Project & Content Structure

Every Fablekin project lives in its own directory under `workspace/projects/`. The core folders have stable purposes, while plugins can add their own content modes and project-scoped storage.

## 1. Directory Layout

A typical project contains:

```text
[ProjectName]/
├── 1_Directives/
├── 2_Lore_Book/
├── 3_Chronicles/
├── 4_Important/
├── assets/
│   ├── backgrounds/
│   ├── ost/
│   ├── sprites/
│   └── voices/
├── plugins/
│   └── [Chronicle]/[TurnStorageKey]/[PluginId]/
├── vectors/
└── [ProjectName].config
```

- **`1_Directives/`** contains project instructions such as tone, narrative rules, and presentation constraints.
- **`2_Lore_Book/`** contains world, character, location, and reference material.
- **`3_Chronicles/`** contains narrative databases (`.db` files). A new project starts with `Save 1.db`.
- **`4_Important/`** is available for high-priority project material.
- **`assets/`** contains Visual Novel backgrounds, music, sprites, and voices.
- **`plugins/`** stores plugin-owned data. It is isolated by chronicle, turn-storage scope, and plugin ID.
- **`vectors/`** contains local LanceDB collections used by retrieval and memory features. It is managed by Fablekin.
- **`[ProjectName].config`** is the project's Content Manager configuration.

---

## 2. Configuration Management

The Content Manager records how project files should be used and keeps project-specific interface and runtime metadata together.

### The `.config` File
Instead of a generic `config.json`, each project uses a uniquely named `.config` file. The current format has structured sections for file assignments, project metadata, directives, interface state, and runtime state. The `files` section stores each file's content mode and related options.

### Portability & Absolutization
When Fablekin saves file assignments, it converts local paths to project-relative paths. When the project loads, those paths are resolved against the current project directory. This keeps projects portable between folders and computers.

Application-wide settings and provider secrets are not stored in the project `.config`. See [Configuration Management](../system/config_management.md) for the separation between global and project settings.

---

## 3. File Modes

Content modes tell Fablekin how to use a file. Native modes include Full, Summary, Auto (RAG), Intro, Chat, and Story Script. Plugins can register additional modes when enabled.

Examples of current plugin modes include:

- **`world_map`** for World Map data.
- **`charsheet`** and **`cast_list`** for Character Sheets.
- **`lore_entry`** for Lore Book entries.
- **`planner_input`** for planner-specific material.

The set of plugin modes is intentionally dynamic. Disabling a plugin removes its mode from the available choices, but its saved project data is not repurposed automatically.
