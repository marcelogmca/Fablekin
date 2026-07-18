# Plugin Manager API Reference

This document catalogs the manifest structure, hooks, and API methods available to developers creating plugins for the Fablekin Engine.

---

## 📦 Plugin Manifest (`index.js`)

The `module.exports` of your plugin's `index.js` defines its identity and core behavior.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | **Required.** Unique slug (e.g., `my_awesome_plugin`). |
| `name` | `string` | Human-readable name. |
| `version` | `string` | Semantic versioning (e.g., `1.2.0`). |
| `hooks` | `Object` | Key-value pair of hook names and execution definitions. |
| `views` | `Array` | List of custom UI tabs to register in the renderer. |
| `exports` | `Object` | Functions available to other plugins or core engine protocols. |
| `socketListeners` | `Object` | Map of Socket.IO event names to handler functions. |
| `settingsSchema` | `Object` | Declarative UI schema for plugin settings. |

---

## 🔌 Core SDK Features

### 1. Custom Views (Tabs)
Register dedicated UI portals that appear as tabs in the application shell.
```javascript
views: [
    { id: 'my_tab', label: 'Plugin Tab', entry: 'ui/index.html' }
]
```

### 2. Custom File Viewers
Implement the `provideFileView` protocol in your `exports` to handle specific file modes in the Content Manager.
```javascript
exports: {
    async provideFileView(context, tools, { modeId, filePath }) {
        return { type: 'html', content: '...' };
    }
}
```

### 3. Frontend Socket Events
Listen to real-time events for dynamic UI updates.

#### `plugin:settings-updated:[plugin_id]`
Emitted when a user saves settings for your plugin.
```javascript
socket.on('plugin:settings-updated:my_plugin', (newSettings) => {
    // React to settings change
});
```

### 4. GUI Intercepts
Register checkpoint middleware via `tools.gui`.
```javascript
hooks: {
    HOOK_GUI_GATEKEEPER: {
        run: async (context, tools) => {
            tools.gui.registerRuntimeIntercept({
                interceptId: "my_gate",
                checkpoint: "on_dialogue_enter",
                blocking: true
            });
        }
    }
},
exports: {
    guiIntercepts: {
        async my_gate(context, tools, descriptor, request) {
            return { html: "...", css: "...", js: "..." };
        }
    }
}
```

### 5. Narrative Turn Access (`tools.turns`)
Use turn helpers instead of querying/decompressing `chat_turns` manually.

```javascript
const current = tools.turns.getCurrent();
const latest = await tools.turns.getLatest();
const turn12 = await tools.turns.get(12);
const window = await tools.turns.getRange(10, 14);
const previous = await tools.turns.getPrevious(3);
const byKey = await tools.turns.getByStorageKey('53.1'); // interlude
const byDbId = await tools.turns.getByDbId(1042);
const seq = await tools.turns.getSequence(byKey);
```

Available methods:
- `get(n)`
- `getCurrent()`
- `getLatest(options?)`
- `getRange(start, end)`
- `getPrevious(count, options?)`
- `getByStorageKey(key)`
- `getByDbId(dbId)`
- `getByCreationTurnNumber(n)`
- `getMeta(n)`
- `count()`
- `getSequence(turnRef?)`
- `resolve(turnRef)`

---

## 💀 Narrative Termination (Game Over)

Trigger terminal states that block input while allowing players to "Undo" their decisions.

### Backend Flag
Set `isGameOver` on the turn output to trigger a sequence-end termination.
```javascript
turnContext.output.isGameOver = true;
turnContext.output.gameOverConfig = { text: "FAILED", subtext: "..." };
```

### Cinematic Command
Inject the `gameover` command into a sequence for line-specific termination.
```javascript
gameover:TITLE:SUBTEXT
```

### Frontend Hook
Listen for `HOOK_GAME_OVER_SCREEN` to handle visual overrides.
```javascript
window.socket.on('execute-frontend-hook', async (data) => {
    if (data.hookName === 'HOOK_GAME_OVER_SCREEN') {
        // Custom death logic
    }
});
```
