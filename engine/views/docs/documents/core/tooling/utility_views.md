# Utility & Management Views

The engine includes several specialized windows for managing project state, diagnosing issues, and configuring global behaviors.

## 1. Log Viewer

The Log Viewer provides a real-time, categorized stream of system events.
- **Categorization**: Logs are tagged by module (e.g., `PluginManager`, `ChapterMgmt`, `NarrativeEngine`).
- **Persistence**: While primarily a runtime tool, logs are essential for debugging complex LLM orchestration failures.
- **Search & Filter**: Allows developers to isolate logs from a specific plugin or filter by severity (Log, Warn, Error).

---

## 2. Plugin Manager

The Plugin Manager UI is the administrative interface for the modular extension system.
- **Discovery**: Displays all plugins found in the `engine/plugins/` directory.
- **Lifecycle Control**: Allows users to enable/disable plugins. Disabling a plugin physically moves its folder to a `disabled/` subdirectory.
- **Configuration**: Exposes the `settingsSchema` of each plugin, allowing users to configure API keys, models, and behavioral toggles without editing JSON files.
- **Dependency Audit**: Highlights missing dependencies that prevent a plugin from booting.

---

## 3. Settings Manager

The Settings Manager handles global application configuration.
- **Infrastructure**: Configure LLM providers (Ollama, OpenRouter, Anthropic) and global API endpoints.
- **UI/UX**: Change themes, font sizes, and window behaviors.
- **Narrative Limits**: Configure the "Dated Chapters" tiers (how many turns are kept in full context vs. summaries).
