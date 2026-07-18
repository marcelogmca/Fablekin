# IPC & Socket Infrastructure

The engine uses a hybrid communication model to facilitate interaction between the Electron Main process and various Renderer processes (views).

## 1. Socket.IO Layer

The primary communication channel for data-heavy operations (Narrative Generation, Memory Retrieval, Plugin Hooks) is **Socket.IO**. This allows for real-time, bidirectional event-driven communication.

### Server Lifecycle
The socket server is initialized dynamically on a random available port during startup.
*   **Initialization**: Managed by `engine/modules/main_process/bootstrap/socket_runtime.js`.
*   **Security**: Every connection must provide a valid `token` generated at startup, verified via `attachSocketAuthMiddleware`.
*   **Global Access**: The `io` instance is shared across the engine, allowing any module to emit global broadcasts (e.g., UI notifications).

### Client Connection
Renderer processes receive the connection URL and token via Electron's `webPreferences.additionalArguments`. The `socket_bootstrap.js` in the frontend then establishes the link.

---

## 2. Handler Architecture

To maintain a clean and modular codebase, socket events are not handled directly in a monolithic `io.on('connection')` block. Instead, they use a **Handler Factory Pattern**.

### Pattern Definition
Each subsystem (VN, Memory, Settings, etc.) defines its handlers in a factory function:

```javascript
function createExampleHandlers({ dependency1, Logger, emitResponse }) {
    return {
        async "some-event-name"(socket, data) {
            // Logic here...
            emitResponse("some-event-response", { success: true, result });
        }
    };
}
```

### Handler Categories
-   **Project Handlers**: Project loading, creation, and selection logic.
-   **VN Handlers**: Turn generation, reprocessing, and historical playback.
-   **Memory Handlers**: Fact retrieval and vector search operations.
-   **Settings Handlers**: Global and project-specific configuration updates.
-   **Log Handlers**: Real-time log streaming to the frontend.

---

## 3. Communication Utilities

### `emitResponse`
A specialized helper that ensures responses are sent back to the specific socket that made the request, following a standardized `{ success, result, error }` payload format.

### `socket.emitReceive`
A custom wrapper (created via `createEmitReceiveAttacher`) that allows the Main Process to "request" data from a Renderer and wait for a response using Promises, effectively treating Sockets like traditional RPC calls.

### IPC (Electron)
Standard Electron IPC is reserved for low-level window controls (Minimize, Maximize, Close) and is registered in `engine/modules/main_process/bootstrap/window_manager.js`.
