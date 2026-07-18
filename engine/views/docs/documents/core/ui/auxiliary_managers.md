# Auxiliary UI Orchestration

The viewer uses several "Manager" modules to handle specific UI subsystems without cluttering the main rendering engine.

## 1. Status Manager (`status_manager.js`)

The Status Manager is the central hub for user feedback during the generation process.

### The Pipeline Progress Bar
Visualizes the backend's progress through the engine hooks.
- **Weighted Steps**: Not all steps are equal. The bar uses weights (e.g., "Writer" is larger than "Boot") to provide a realistic sense of time.
- **Color Coding**: Each phase has a unique [identity color](../../management/project_structure.md) for quick recognition.

### Blocking Overlays
When a high-priority task starts (like calling an LLM), the Status Manager shows a blocking popup that displays:
- **Active Tasks**: A real-time list of what the engine is currently doing.
- **Elapsed Time**: Total time spent on the current turn.
- **System Logs**: A toggleable console for viewing low-level backend logs.

---

## 2. UI Manager (`ui_manager.js`)

The UI Manager handles secondary interface states.

### Dialogue History (The Log)
- **Persistence**: Rebuilds the dialogue history whenever the user switches chapters or loads a save.
- **Formatting**: Automatically differentiates between player dialogue ("You"), character dialogue, and narration.

### Navigation Overlays
- **Chapter Cards**: Renders the "Previous" and "Next" chapter cards at the edges of the screen, including thumbnails and titles.
- **Lifecycle**: Automatically enables/disables the user input container based on whether the player is at the end of the current chapter.

---

## 3. Settings Manager (`settings_manager.js`)

Manages the persistent state of the VN Viewer's settings panel. It handles:
- **Volume Sliders**: Real-time updates for OST, SFX, and TTS.
- **Visual Preferences**: Font scaling, panel transparency, and blurring effects.
- **Debug Toggles**: Visibility of camera grids, viewport info, and character hitboxes.
