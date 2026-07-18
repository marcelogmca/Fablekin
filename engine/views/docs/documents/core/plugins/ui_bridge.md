# The Plugin Bridge & UI Injections

The **Plugin Bridge** (`plugin_bridge.js`) is a client-side library that connects frontend views (like the VN Viewer or custom plugin tabs) to the backend logic.

## 1. Establishing the Connection

The bridge automatically detects the backend address and security token from the URL.

```javascript
// Internal logic of the bridge
const socketToken = params.get('socketToken');
const socket = io(`http://${host}:${port}`, { auth: { token: socketToken } });
```

---

## 2. Dynamic UI Injections

Plugins can inject content directly into existing core views (HUD Injection). The bridge listens for `gui-plugin-inject` events and applies them:

- **HTML**: Appended to a specific CSS selector.
- **CSS**: Injected into the document `<head>`.
- **JS**: Executed in a sandboxed `Function` context, with access to the `bridge` and `socket` objects.

---

## 3. The `window.bridge` API

For plugin developers, the bridge exposes a simple API:

- **`bridge.on(event, callback)`**: Listen for backend events.
- **`bridge.emit(event, data)`**: Send data to the backend handlers.
- **`bridge.request(event, data, timeout?)`**: Send data and wait for an `event-response` reply.
- **`bridge.getViewInfo()`**: Returns the current `viewId` and `pluginId`.

---

## 4. File Views & Conversions

The bridge handles the UI side of advanced file operations:
- **Custom Views**: If you open a character sheet (.db), the bridge requests the "Spreadsheet" view from the Character Sheets plugin.
- **Conversions**: When converting a Markdown file to a Dialogue script, the bridge triggers the `HOOK_FILE_CONVERTED` pipeline, allowing plugins to initialize the new file structure.
