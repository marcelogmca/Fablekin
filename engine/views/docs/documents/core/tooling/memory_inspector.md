# Memory Inspector Console

The Memory Inspector is a low-level debugging console built on **Xterm.js**. It allows developers and power users to query the engine's state in real-time.

## 1. Terminal Architecture

The inspector consists of three layers:
1. **Renderer (`renderer_memory.js`)**: Manages the Xterm.js instance and handles dynamic theming to match the rest of the application.
2. **Command Handler (`terminal_commands.js`)**: Orchestrates input, history, and command parsing.
3. **Backend (`terminal_manager.js`)**: Executes the commands on the Node.js side and returns formatted output.

---

## 2. Command Reference

The console supports a suite of diagnostic commands:

| Command | Description |
| :--- | :--- |
| `/help` | Lists all available console commands. |
| `/turncontext tree` | Visualizes the turn history and Slot RAG hierarchy. |
| `/plugins list` | Shows all active plugins and their load status. |
| `/plugins hooks` | Displays the current hook registry and interceptors. |
| `/hello` | A simple connectivity test. |

---

## 3. Key Features

### Quote-Aware Parsing
The terminal can handle complex arguments. For example, `/turncontext show "Project && Intro"` correctly treats the quoted string as a single argument, allowing for logical search queries.

### Macro System
Users can save frequently used commands as **Macros**.
- Macros appear as clickable buttons in the UI.
- Clicking a macro automatically pastes the command and focuses the terminal.
- Macro data is persisted in the project's global settings.

### Dynamic Theming
The terminal's color scheme (ANSI colors) is mapped to the engine's CSS variables. If you change your theme to "Cyberpunk" or "Dark Fantasy," the terminal will immediately update its colors to match.
