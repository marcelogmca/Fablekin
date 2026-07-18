# Runtime Startup

Fablekin is a desktop-first Electron application. Startup always initializes the backend services, opens the project selector, and continues through the UI-driven project lifecycle.

## 1. Desktop Startup

The main process performs a single application startup path:
- Ensures the workspace project directory exists.
- Initializes secure settings, plugin registration, Socket.IO, VN runtime services, logging, and cleanup tasks.
- Opens the Electron window at the project selector view.
- Signals launcher readiness after the first window load when `FABLEKIN_LAUNCH_READY_FILE` is configured.

Project selection, chat database selection, turn generation, and diagnostics are all driven from the UI.

---

## 2. Socket Security (`runtime_socket_state.js`)

To prevent unauthorized local processes from interacting with the narrative runtime, the engine uses a **Security Token**.
- **Generation**: A 24-byte hex token is generated every time the app starts.
- **Verification**: Socket connections must provide the token in the `auth` handshake.
- **Propagation**: The token is passed to renderer views via URL query parameters and to managed sub-processes through runtime state.

---

## 3. Persistent Caching (`devcache.js`)

The engine maintains local cache data to speed up repeated development and narrative operations.
- **Location**: Managed under engine runtime/cache paths.
- **Metadata**: Stores reusable intermediate data for expensive processing.
- **Invalidation**: Cache entries are refreshed when their source inputs no longer match.
