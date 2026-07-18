# Viewer Orchestration

The VN Viewer is a state-driven frontend application. Its logic is divided into specialized modules located in `engine/views/vn_viewer/js/modules/`.

## 1. Dialogue Orchestrator

The `DialogueOrchestrator` is the central state machine for scene playback.

### Core Responsibilities
- **Message Lifecycle**: Manages the transitions between dialogue lines, including triggering voice playback and sprite updates.
- **Typewriter Engine**: Implements the character-by-character text reveal effect, with auto-scrolling to keep the cursor visible.
- **Autoplay & Navigation**: Handles the timers for automatic progression and manages the `currentIndex` within the chapter sequence.
- **Persistence**: Periodically emits `save-viewer-state` to ensure the player's position is remembered across sessions.

---

## 2. Audio & TTS Manager

The `AudioManager` handles all sound resources in the viewer.

### Key Features
- **OST Management**: Switches background music tracks and handles play/pause/volume states.
- **Advanced Voice Playback**: 
    - **Visual Sync**: Automatically triggers mouth animations on sprites while audio is playing.
    - **Duration Emulation**: If a voice file is missing, the manager calculates an estimated duration based on text length to simulate a natural speaking time.
- **Missing Asset Tracker**: Tracks failed TTS loads and dispatches events so the UI can prompt for regeneration.

---

## 3. UI & Status Management

The `UIManager` and `StatusManager` handle the DOM-heavy elements of the interface.

### UI Manager
- **Log Reconstruction**: Rebuilds the scrollable dialogue history from the `turnHistory` state.
- **Interaction Control**: Toggles the enabled state of all input fields and buttons during transitions or generation.
- **Overlays**: Manages the Prologue and Game Over screens.

### Status Manager
- **Unified Status Popup**: A complex blocking overlay used during turn generation.
- **Pipeline Visualization**: Renders a weighted progress bar showing the actual "Hooks" being executed in the backend pipeline (Bootstrap → RAG → Inference).
- **ETA & Task Tracking**: Provides live feedback on estimated time remaining and individual subtask status (e.g., "Vector Search active").

---

## 4. Generation Manager

The `GenerationManager` handles the asynchronous turn generation cycle.
- **Request/Response**: Sends prompt payloads (User + Director + Feedback) to the backend.
- **Live Logs**: Consumes real-time log events from the server and displays them in the **Unified Status Console**, allowing developers to monitor the agent's reasoning live.
