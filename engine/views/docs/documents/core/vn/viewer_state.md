# Viewer State & Orchestration

The Visual Novel viewer is a complex state machine that synchronizes narrative progression with visual and audio feedback.

## 1. Global State (`state.js`)

The `state` object is the single source of truth for the entire frontend. It is divided into several logical zones:

- **Navigation**: Tracks the current dialogue index (`currentIndex`) and the history of turns.
- **Media**: Stores the active background, OST, and character metadata.
- **Settings**: Nested configuration (Audio, Visuals, Interface) that persists across sessions.
- **Plugin Runtime**: Manages active [GUI Intercepts](intercept_system.md) and PixiJS Takeover sessions.

---

## 2. Main Engine (`engine.js`)

The main engine act as a **Module Orchestrator**. It doesn't contain heavy logic itself; instead, it bridges high-level app events to specialized managers:

- **Dialogue Orchestrator**: Handles the "Show Next/Prev" flow and typewriter effects.
- **Payload Manager**: Processes the results of an LLM turn and applies them to the viewer.
- **Audio Manager**: Synchronizes mouth-movements with voice playback durations.
- **Status Manager**: Tracks the progress of the narrative generation pipeline.

---

## 3. Data Synchronization

### Turn Lifecycle
1. **Request**: The user submits a message via `ui_events.js`.
2. **Generation**: `generation_manager.js` tracks the pipeline progress via Socket.io.
3. **Application**: `payload_manager.js` receives the new turn data, updates the `state.turnHistory`, and resets the `currentIndex` to 0.
4. **Render**: The `dialogue_orchestrator.js` triggers the visual update for the first frame.

### Setting Persistence
Whenever a setting is changed (e.g., volume slider), the `debouncedSaveVNSettings` function is called. This sends the updated `state.vnSettings` back to the server to be saved in the project's configuration file.
