# UI Events & Interaction

The `ui_events.js` module handles all user interactions with the Visual Novel shell, from submitting messages to fine-tuning the visual appearance.

## 1. Input Submission Pipeline

Submitting a message involves multiple safety and plugin checks:

1. **Takeover Check**: Prevents submission if a plugin is currently controlling the screen.
2. **Database Check**: Ensures a project is correctly loaded.
3. **Interceptors**: Runs `runBeforeSubmitInterceptors`. Plugins can use this to modify the user's text (e.g., adding a secret context) or block the submission entirely (e.g., forcing the user to choose an option first).
4. **Execution**: If all checks pass, the message is sent to the backend via `processMessage`.

---

## 2. Navigation & Auto-Play

- **Manual Navigation**: Arrow keys and UI buttons trigger `showNextMessage` and `showPrevMessage`.
- **Auto-Play**: When enabled, the engine calculates a delay based on the text length and reading speed. A progress bar visualizes the time remaining before the next message.
- **Undo**: The "Undo" button triggers a destructive turn deletion on the server, returning the story to the end of the previous turn.

---

## 3. Real-Time Settings

The UI provides instant feedback for visual and audio settings:
- **Visuals**: Changing the "Sprite Offset" or "Size Multiplier" triggers a real-time repositioning of the PixiJS characters.
- **Blur & Transparency**: CSS variables (like `--vn-font-multiplier`) are updated on the root document to change the dialogue box's look without a page reload.
- **Audio**: Volume sliders update the HTML5 Audio objects and dispatch events to any active plugins to ensure unified sound levels.

---

## 4. Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| **Arrow Right** | Next Dialogue Line |
| **Arrow Left** | Previous Dialogue Line |
| **Enter** | Submit Message (in input field) |
| **Shift + Enter** | New Line (in input field) |
