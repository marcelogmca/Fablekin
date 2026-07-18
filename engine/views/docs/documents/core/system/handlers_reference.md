# IPC & System Handlers

The "Handlers" are the entry points for all client-to-server communication. They reside in `engine/modules/main_process/handlers/` and are registered with the Socket.io server.

## 1. VN & Narrative Handlers (`vn_handlers.js`)

These are the most critical handlers for the engine's core functionality.

| Event | Description |
| :--- | :--- |
| `generate-vn-turn` | Starts the full multi-agent generation pipeline. |
| `generate-interlude-turn` | Starts a **virtual turn** run and persists it as an interlude (user-facing term: **Interlude**; not a canonical timeline turn). |
| `reprocess-vn-turn` | Re-runs the VN transformation logic on existing prose. |
| `play-historical-turn` | Fetches a specific turn from the SQLite DB and sends it to the viewer. |
| `play-interlude-turn` | Fetches a stored interlude context and sends it to the viewer (Interlude playback). |
| `get-pending-interlude-integrations` | Lists story-relevant interludes waiting to be integrated into parent memory. |
| `integrate-interlude` | Integrates an interlude capsule into its parent canonical turn. |
| `get-prologue-content` | Retrieves the introductory narrative text for the current project. |

### `generate-interlude-turn` Payload

`generate-interlude-turn` accepts:
- `parentTurnNumber` (required): Parent canonical turn number.
- `prompt` (required): User input for the interlude scene.
- `directorPrompt` (optional): Manual director override.
- `softFeedback` (optional): Non-blocking writer hints.
- `label` (optional): Human-readable interlude label.
- `isStoryRelevant` (optional): Explicit override for integration relevance.
- `runProfileId` (optional): Explicit run profile (recommended for deterministic behavior).
- `runProfile` (optional): Alias of `runProfileId`.

Response includes:
- `interlude.id`, `parentTurnNumber`, `ordinal`, `displayTurn`
- `interlude.isStoryRelevant`
- `interlude.integrationState`
- `interlude.runProfileId` (effective profile used by the runner)
- `storageTurnKey` (chapter/interlude asset key, example `53` or `53.1`)

---

## 2. Infrastructure & Tooling Handlers

### Log Handlers (`log_handlers.js`)
- `get-all-logs`: Returns a list of log files for the current project and system.
- `get-waterfall-data`: Parses console logs to generate performance metrics for the Log Viewer.
- `get-log-content`: Retrieves the raw content of a specific log file.

### Memory Handlers (`memory_handlers.js`)
- `get-memory-data`: Allows the Memory Inspector to query the LanceDB vector store (Short-Term/Long-Term/Facts).

### Settings Handlers (`settings_handlers.js`)
- `get-settings`: Returns the engine's global configuration.
- `save-settings`: Persists updated configuration to `engine_settings.json`.

---

## 3. Project & Data Handlers

### Player Handlers (`player_handlers.js`)
- `save-player-metadata`: Persists the Main Character's name and bio to the project's `.world` package.
- `get-player-metadata`: Retrieves the current player profile.

### File & Project Handlers (`file_handlers.js`, `project_select_handler.js`)
- `get-project-files`: Scans the workspace for `.world` packages and returns their metadata.
- `select-project`: A heavyweight handler that unmounts the current project, re-initializes all managers (VectorStore, StaticData, FactManager), and restores the last active chat state.
- **Hook Lifecycle**: Fires `HOOK_PROJECT_LOADED` and `HOOK_CHAT_DB_INITIALIZED`.

### Chapter & History Handlers (`chapter_handlers.js`, `scene_history_handlers.js`)
- `save-viewer-state`: Remembers the user's current dialogue index within a chapter for resume-on-launch support.
- `get-scene-history-data`: Fetches thumbnails and synopses for the Timeline view.
- `branch-narrative`: Creates a parallel story by cloning the DB and duplicating plugin storage.
- `delete-latest-turn`: Permanently removes the last turn and triggers `HOOK_TURN_DELETED`.

### Frontend Injection Handler (`socket_frontend_injection.js`)
- **Dynamic Assets**: Executes `HOOK_FRONTEND_INJECTION` on socket connection to send plugin UI elements to the viewer.
- **Caching**: Results are stored in the `frontendInjectionCache` to prevent redundant plugin execution on every refresh.
