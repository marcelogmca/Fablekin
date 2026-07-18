# Shared Libraries & Socket Bootstrap

The engine relies on a small set of curated libraries to handle specialized tasks across its many webview contexts.

## 1. Socket Bootstrap (`socket_bootstrap.js`)

This is a critical infrastructure component for Electron webviews.
- **Dynamic Routing**: Since multiple projects or local server instances might be running, this script parses the correct `socketProtocol`, `socketHost`, and `socketPort` from the URL query parameters.
- **`window.io` Monkey-patching**: It intercepts all calls to the global `io()` function, automatically injecting the correct server URL and authentication tokens. This ensures that plugins or legacy code can use standard Socket.io syntax while still being correctly routed.
- **Auth Injection**: Automatically adds the `socketToken` to the `auth` and `query` parameters of every connection.

---

## 2. JSON Inspection (`jsonTree.js`)

Used to render interactive, searchable trees for complex JSON data.
- **Contexts**: Powering the [Memory Inspector](../tooling/memory_inspector.md) and the [State Inspector](../tooling/state_inspection.md).
- **Features**: Supports deep-linking (Shift+Click to get JSON path), node marking (Alt+Click), and recursive expansion.

---

## 3. Visualization Libraries

- **Sigma.js & Graphology**: High-performance WebGL-based graph rendering used in the [RAG Visualizer](../memory/retrieval_pipeline.md) to show semantic clusters and context anchors.
- **Premium Select (`premium_select.css`)**: A standardized CSS-only component for dropdown menus, ensuring they adhere to the [Theme Architecture](../ui/theme_architecture.md) and glassmorphism specs.
