# App Lifecycle & Bootstrapping

This document outlines the startup sequence and process orchestration of the Dynamic Narrative Engine.

## Process Overview

The engine operates using an **Electron** architecture, split into two primary process types:
1.  **Main Process (`engine/main.js`)**: Orchestrates the application lifecycle, manages window creation, handles filesystem access, and runs the Socket.IO server.
2.  **Renderer Process**: Individual views (Project Selector, VN Viewer, etc.) that communicate with the Main Process via Sockets or Electron IPC.

---

## Startup Sequence

When the application is launched, the following sequence occurs:

### 1. Module Initialization
The `main.js` script begins by importing core modules (`content_manager`, `memory_manager`, `vn_manager`, etc.) and setting up the global configuration.

### 2. Startup Hook Execution
Electron's `app.whenReady()` triggers the `createStartupSequence` function located in `engine/modules/main_process/bootstrap/app_startup.js`.

*   **PluginManager Setup**: The `PluginManager` is initialized early to ensure it can register listeners before any socket connections are established.
*   **Secure Storage**: Encrypted settings and plugin secrets are loaded.
*   **System Secrets**: Secrets for core services (like LLM API keys) are patched into the global settings.

### 3. Socket Server Initialization
Once the `PluginManager` is ready, the **Socket.IO server** is started (`engine/modules/main_process/bootstrap/socket_runtime.js`). 
*   **Middleware**: Authentication middleware is attached to secure connections.
*   **Event Routing**: Handlers for project, memory, and VN operations are registered.

### 4. Hook: `HOOK_SYSTEM_BOOT`
The engine fires the `HOOK_SYSTEM_BOOT` plugin hook. This allows plugins to perform their own initialization logic (e.g., setting up databases or checking for updates) before the UI is presented.

### 5. UI Presentation
Finally, `initializeElectronWindow()` is called to create the main window, initially loading the **Project Selector** view.

---

## Resource Management

### Socket State
The `runtimeSocketState` manages the active host and connection parameters. It provides the necessary query parameters for renderer processes to connect back to the Main Process.

### Frontend Injection
To minimize connection overhead, the Main Process caches frontend injection payloads (e.g., custom CSS/JS for plugins) in `_frontendInjectionCache`. This cache is invalidated whenever project state or plugin configurations change.

### Graceful Shutdown
On `window-all-closed`, the engine explicitly closes:
- The HTTP/Socket.IO server.
- The `StaticDataManager` (LDB instances).
- The `FactManager` and `ChapterManagement` databases.
