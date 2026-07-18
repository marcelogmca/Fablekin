# System UI & Management Views

The engine provides several management views outside of the main Visual Novel viewer. These views allow the player to curate their experience, manage plugins, and navigate story timelines.

## 1. Plugin Manager (`renderer_plugin_manager.js`)

The Plugin Manager is the "App Store" of the engine. It allows users to toggle, configure, and inspect the modular components of their project.

### Core Features
- **Project Isolation**: Plugins are managed per-project. Toggling a plugin only affects the current active workspace.
- **Dependency Detection**: The UI automatically checks for mandatory requirements. If a plugin requires another that is missing or disabled, the activation button is blocked.
- **Dynamic Configuration**: Using a JSON-Schema-like `settingsSchema`, the manager generates input forms for every plugin. This includes secrets (API keys), numbers, checkboxes, and select dropdowns.

### Visual Metrics
Every plugin can report four key metrics to help the user manage their "Narrative Budget":
- **Impact**: How much the plugin changes the story.
- **Immersion**: Level of audio-visual presence.
- **Cost**: Estimated API spend per turn.
- **Latency**: Estimated processing time added to the turn.

---

## 2. Scene History / Timeline (`renderer_scene_history.js`)

The Scene History view provides a non-linear way to navigate the project's [Narrative History](../../management/narrative_history.md).

### Interaction Patterns
- **Turn Thumbnails**: Every turn is represented by a card showing the background image, the scene title, and a brief synopsis.
- **Rewind/Edit**: Users can open a turn's script, edit the prose, and trigger a **Reprocess**. This skips the LLM Writer and goes straight to the visual transformation logic.
- **Branching**: A core feature that allows a user to "split" the timeline at any point. The engine clones the project state up to that turn and creates a new database and plugin storage directory.

---

## 3. Communication Pattern

These views operate as standalone Electron windows or browser tabs and communicate with the backend via **Socket.IO**.
1. **Request**: The view emits a command (e.g., `get-scene-history-data`).
2. **Response**: The backend processes the request and emits a matching `-response` event.
3. **Synchronization**: Critical events (like `chat-db-switched` or `project-changed`) are broadcast to all open views to ensure the UI remains consistent.
