> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Plugin Development 101: From Simple to Complex

This guide walks through Fablekin plugin development from the smallest useful hook to complex custom VN UX. It is meant to be the first page a plugin author reads before jumping into the detailed SDK references.

For working starting points, use the [Plugin Example Catalog](examples.md).

## 1. The Five Worlds

Most plugin confusion comes from mixing up where code runs. Keep this model in your head and the rest of the SDK becomes much easier to reason about.

| API | Where it exists | Use it for | Short version |
| --- | --- | --- | --- |
| tools.* | Backend plugin callbacks in index.js. | Engine work: hooks, LLM calls, prompt injection, storage, settings, jobs, files, DBs, GUI intercept registration. | Backend plugin SDK. |
| socket | Frontend and backend transport. | Event streams and request/response calls between frontend UI and backend plugin listeners. | Wire between worlds. |
| window.bridge | Plugin tabs/windows loaded through plugin_bridge.js. | Normal plugin view communication: bridge.emit, bridge.request, bridge.on, view metadata, close. | Plugin page helper. |
| window.VN | Client-side VN viewer page. | Raw live VN viewer features: camera, sprite FX, title popouts, SFX, UCP commands, global Pixi plugin runtime. | Global VN toolbox. |
| bridge.* in intercept JS | Client-side object passed to one GUI intercept run. | Managed intercept work: resolve/reject, cleanup, timers, asset loading, current surface, backend requests, UI locks, scoped actors/backgrounds, input submit, Pixi takeover. | Props for this injected UI. |

### `VN.*` vs intercept `bridge.*`

`VN.*` and intercept `bridge.*` are both client-side. The difference is ownership. `VN.*` is the global toolbox for the live VN page. Intercept `bridge.*` is the scoped handle passed into the current injected UI, like props passed into a component.

Inside intercepts, prefer `bridge.*` first because it is tied to the run lifecycle and can clean itself up. Reach for `VN.*` when you intentionally need raw global viewer control that the bridge does not expose.

| Need | Prefer | Why |
| --- | --- | --- |
| Temporarily hide dialogue during an intercept. | bridge.player.ui.lock({ dialogue: "hidden" }) | Scoped lock, auto-released on cleanup. |
| Globally hide the VN dialogue from persistent injected code. | VN.ui.hideDialogue() | Direct live viewer command. |
| Add an intercept-owned Pixi object. | bridge.pixi.add(displayObject) | Tracked and removed when the intercept ends. |
| Register a long-lived Pixi VFX plugin. | VN.pixiPlugins.register(...) | Global VN renderer lifecycle. |
| Ask backend plugin code for data from an intercept. | bridge.socket.request(...) | Uses the run-scoped socket helper. |

## 2. Plugin Folder Anatomy

A plugin is a folder under `engine/plugins/[plugin_id]`. The only required file is usually `index.js`. Larger plugins split logic into files such as `logic.js`, `ui.html`, `ui.css`, and `ui.js`.



```text
engine/plugins/my_plugin/
  index.js
  ui.html
  ui.css
  ui.js
  assets/
  lib/
```



The plugin manifest is the exported object from `index.js`.



```javascript
module.exports = {
  id: "my_plugin",
  name: "My Plugin",
  version: "1.0.0",
  author: "You",
  category: "Gameplay",
  description: "Adds a small mechanic to the VN.",

  settingsSchema: {},
  hooks: {},
  views: [],
  socketListeners: {},
  exports: {}
};
```



Official reference plugins set `isExamplePlugin: true`. This public manifest flag keeps examples in Developer & Reference without marking them as unfinished product features.

## 3. The Smallest Useful Plugin

Hooks are backend lifecycle entry points. They receive `(context, tools)`. Use `context` to inspect the current project/turn and `tools` to safely interact with the engine.



```javascript
module.exports = {
  id: "hello_turn",
  name: "Hello Turn",
  hooks: {
    HOOK_TURN_START: {
      priority: 10,
      run: async (context, tools) => {
        tools.logger.log(`Starting turn ${context.turnNumber}`);
      }
    }
  }
};
```



Hook priority sorts listeners inside the same hook. Lower numbers run earlier. Use priorities only when order matters.

## 4. Choosing The Right Hook

Pick the hook that matches the work you want to do. Avoid doing expensive work earlier than needed.

| Goal | Good hook | Notes |
| --- | --- | --- |
| Initialize plugin/project state. | HOOK_PROJECT_LOADED or HOOK_CHAT_DB_INITIALIZED | Use for setup, cache warming, or pushing initial frontend state. |
| Add context to the LLM prompt. | HOOK_POST_PROMPT_BUILDER | Inject into prompt slots after standard context is gathered. |
| Register gameplay phases for Director handoff. | HOOK_DIRECTOR_PRE_PROMPT | Use tools.director.registerCapability. |
| Modify VN dialogue/sequence after text parsing. | HOOK_POST_DIALOGUE_PROCESSING or HOOK_POST_VN_GENERATION | Use tools.sequence where possible. |
| Run non-critical background work. | HOOK_VN_BACKGROUND_TASKS | Good for summaries, sync, analysis, and cache generation. |
| Inject persistent frontend code into the VN viewer. | HOOK_FRONTEND_INJECTION | Return { id, html, css, js }. |
| Create checkpoint UI/gameplay during VN playback. | HOOK_GUI_GATEKEEPER or later turn hooks | Register GUI intercept descriptors with tools.gui. |

## 5. Settings

Settings give users control and give your plugin stable defaults. Define `settingsSchema`, then read values with `tools.settings.getSelf()`.



```javascript
module.exports = {
  id: "mood_booster",
  settingsSchema: {
    enabled: {
      type: "checkbox",
      label: "Enable Mood Boost",
      default: true,
      description: "Adds a small tone hint to the writer prompt."
    },
    intensity: {
      type: "slider",
      label: "Intensity",
      min: 0,
      max: 10,
      step: 1,
      default: 4
    }
  },
  hooks: {
    HOOK_POST_PROMPT_BUILDER: {
      run: async (context, tools) => {
        const settings = tools.settings.getSelf();
        if (!settings.enabled) return;

        tools.prompt.inject(
          "plugin_guidance",
          tools.prompt.wrap("mood_booster", `Mood intensity: ${settings.intensity}.`)
        );
      }
    }
  }
};
```



## 6. Prompt And Narrative Plugins

Prompt plugins should add clear, bounded instructions. Prefer `tools.prompt.wrap` so your block is easy to inspect in logs.



```javascript
hooks: {
  HOOK_POST_PROMPT_BUILDER: {
    priority: 50,
    run: async (context, tools) => {
      const directive = tools.directives.getSelf("creative_style");
      if (!directive) return;

      tools.prompt.inject(
        "plugin_guidance",
        tools.prompt.wrap("my_plugin_directive", directive, {
          turn: context.turnNumber
        })
      );
    }
  }
}
```



Good prompt plugins are specific about when they apply. They do not dump giant static text every turn unless that text is truly needed.

Prompt targets define cache scope. The default `root` target feeds the immutable Director/Writer prefix. Use `writer` or `director` for private suffix content. `HOOK_PRE_ORCHESTRATOR` is the final shared-prefix mutation point; later root injections are rejected and logged.



```javascript
tools.prompt.inject("dynamic_knowledge", sharedContext, "root");
tools.prompt.inject("directives", writerOnlyInstruction, "writer");
tools.prompt.inject("simulation", directorOnlyPlan, "director");
```



## 7. Calling LLMs

Use `tools.llm.runTask`, `tools.llm.json`, `tools.llm.withSchema`, and `tools.llm.batch` instead of calling model services directly. Let the user select a global model alias; the engine resolves that alias and handles logging, retries, and JSON repair. Never store a provider or add a fallback provider in plugin settings.



```javascript
settingsSchema: {
  model_def: {
    type: "select",
    label: "Analysis Model",
    options: "llm-aliases",
    default: { model: "lowendmodel" }
  }
}

const model = tools.settings.getSelf().model_def?.model;
if (!model) throw new Error("Configure an Analysis Model before using this plugin.");

const result = await tools.llm.json({
  model,
  messages: [
    {
      role: "system",
      content: "Return strict JSON only."
    },
    {
      role: "user",
      content: "Choose a scene mood: " + context.output.text
    }
  ],
  params: {
    temperature: 0.2,
    retries: 1,
    timeout: 30000,
    callingModule: "Plugin:my_plugin"
  }
});
```



Treat an invalid or incomplete alias as a direct configuration error. For long work, use `tools.jobs.withJob()`; for short foreground work, `tools.status.withTask()` can provide useful progress feedback.



```javascript
await tools.status.withTask("Analyzing scene mood...", async () => {
  return tools.llm.json({ model, messages });
});
```



### Shared VN Background Cache

Post-turn LLM hooks can inherit the canonical VN background model and reuse the finalized scene prefix. Mark the hook with `useSharedVnLlm: true`, normally use priority 50 with parallel mode, and place only plugin-specific instructions and state in the suffix.



```javascript
HOOK_VN_BACKGROUND_TASKS: {
  priority: 50,
  mode: "parallel",
  useSharedVnLlm: true,
  run: async (context, tools) => {
    return await tools.llm.vnBackground.json({
      msg: "My Post-Turn Extraction",
      suffix: buildPluginSpecificPrompt(context)
    });
  }
}
```



Add `allowVnBackgroundModel: true` to the plugin's LLM setting to expose the inheritance choice. The Summary normally leads; the first actual shared call is the fallback leader. One warm-up follower starts after the configured delay, and the remaining followers start after a second delay interval. This avoids a cache stampede without waiting for leader completion. Later priorities may use the same helper when they depend on earlier work. Selecting the shared model without using `tools.llm.vnBackground` inherits only the route, not the shared prefix.

## 8. State, Files, And Databases

Fablekin has several kinds of storage. Choose the smallest one that fits the lifetime of your data.

| Need | Use | Lifetime |
| --- | --- | --- |
| Temporary per-turn flags. | tools.pluginState.runtime() | Runtime only, not persisted as turn output. |
| Turn output annotations. | tools.pluginState.turn() or context.output | Current turn context. |
| Chat/turn-bound files. | tools.project.getChatPluginStorage() | Isolated by chat, turn key, and plugin id. |
| Project files. | tools.project.readFile, tools.project.glob | Project-root scoped. |
| Structured timeline facts. | tools.facts | Turn/interlude aware facts table. |
| Raw SQL. | tools.db.chat or tools.db.project | Powerful, but you own timeline safety. |
| Semantic retrieval. | tools.vector or tools.memory | Plugin-isolated vector stores or engine memory search. |



```javascript
const storage = tools.project.getChatPluginStorage();
tools.logger.log("Writing plugin assets under", storage.relativePath);
```



For facts and database queries, avoid reading future turns after rewinds. Prefer helper APIs such as `tools.turns` and `tools.facts` when possible.

## 9. Cross-Plugin Calls

Exports let plugins expose backend functions to each other. Keep exported functions small, documented, and stable.



```javascript
module.exports = {
  id: "inventory_core",
  exports: {
    async getInventory(context, tools, characterName) {
      return tools.pluginState.turn({ inventories: {} }).inventories[characterName] || [];
    }
  }
};
```





```javascript
const inventory = await tools.plugins.tryCall(
  "inventory_core",
  "getInventory",
  ["Dehya"],
  { fallback: [] }
);
```



## 10. Plugin Views

Use plugin views for dashboards, editors, inspectors, configuration-heavy tools, and anything that should live outside the VN playback surface.



```javascript
module.exports = {
  id: "scene_dashboard",
  views: [
    {
      id: "dashboard",
      label: "Scene Dashboard",
      entry: "ui/index.html"
    }
  ]
};
```



Load `socket.io` and `plugin_bridge.js` from your HTML. Then use `window.bridge`.



```html
<script src="../../vendor/js/socket.io.min.js"></script>
<script src="../../views/libs/plugin_bridge.js"></script>
<script src="app.js"></script>
```





```javascript
const info = bridge.getViewInfo();
const response = await bridge.request("scene_dashboard:get-state", {
  turnNumber: 12
});
```



### Backend socket listeners

Frontend `bridge.request("event", payload)` waits for an `event-response` socket event. Your backend listener should emit that response.



```javascript
module.exports = {
  id: "scene_dashboard",
  socketListeners: {
    "scene_dashboard:get-state": async (data, tools) => {
      try {
        const turn = data?.turnNumber
          ? await tools.turns.get(data.turnNumber)
          : tools.turns.getCurrent();

        tools.socket.emit("scene_dashboard:get-state-response", {
          success: true,
          turn
        });
      } catch (error) {
        tools.socket.emit("scene_dashboard:get-state-response", {
          success: false,
          error: error.message
        });
      }
    }
  }
};
```



## 11. Persistent VN Viewer Injection

Use `HOOK_FRONTEND_INJECTION` when you need code to live in the VN viewer for the whole page session: HUDs, visual effects, background listeners, custom overlays, or continuous Pixi effects.



```javascript
const fs = require("fs/promises");
const path = require("path");

module.exports = {
  id: "my_hud",
  hooks: {
    HOOK_FRONTEND_INJECTION: {
      priority: 20,
      run: async (context, tools) => {
        const [html, css, js] = await Promise.all([
          fs.readFile(path.join(__dirname, "ui.html"), "utf8"),
          fs.readFile(path.join(__dirname, "ui.css"), "utf8"),
          fs.readFile(path.join(__dirname, "ui.js"), "utf8")
        ]);

        return { id: "my_hud", html, css, js };
      }
    }
  }
};
```



Permanent injected JS receives a `context` object, not the intercept bridge. That context includes `socket`, `state`, `elements`, `PIXI`, Pixi handles, and path resolvers.



```javascript
// ui.js, executed in the VN viewer.
const { socket, PIXI, pixiApp, resolvePluginPath } = context;

VN.pixiPlugins.register("my_hud_runtime", (runtime) => {
  runtime.onSocket("execute-frontend-hook", (data) => {
    if (data.hookName !== "HOOK_VN_GUI_READY") return;
    socket.emit("my_hud:refresh", { turnNumber: data.turnNumber });
  });

  runtime.onDispose(() => {
    console.log("my_hud cleaned up");
  });
});
```



## 12. GUI Intercepts

GUI intercepts are checkpoint middleware for VN playback and input flow. Use them when a plugin needs to pause, alter, or augment the player experience at a specific VN moment.

There are two renderer types:

- `renderer: "html"` mounts DOM HTML/CSS/JS into the VN player.

- `renderer: "pixi"` enters a PixiJS canvas takeover path for interactive gameplay.

Register intercept descriptors from backend hooks with `tools.gui`. Provide UI payloads from `exports.guiIntercepts`.



```javascript
module.exports = {
  id: "camp_choice",
  hooks: {
    HOOK_GUI_GATEKEEPER: {
      priority: 10,
      run: async (context, tools) => {
        tools.gui.registerRuntimeIntercept({
          interceptId: "choose_watch",
          checkpoint: "before_user_input_show",
          blocking: true,
          renderer: "html",
          replayPolicy: "once_per_turn"
        });
      }
    }
  },
  exports: {
    guiIntercepts: {
      async choose_watch(context, tools, descriptor, request) {
        return {
          html: '<button id="take-watch">Take first watch</button>',
          css: '#take-watch { padding: 12px 16px; }',
          js: `
            const button = document.getElementById("take-watch");
            button.onclick = () => {
              bridge.intercept.resolve({
                userInputOverride: "I volunteer to take first watch."
              });
            };
          `
        };
      }
    }
  }
};
```



### Intercept bridge basics

Intercept JS is executed client-side with `(bridge, socket, context)`. Use the bridge as your main API.



```javascript
// Resolve the current intercept.
bridge.intercept.resolve({ confirmed: true });

// Read or write player input.
const currentText = bridge.input.getText();
bridge.input.setText(currentText + "\nI check the supplies.");

// Run-scoped cleanup.
const timer = bridge.lifecycle.setTimeout(() => {
  bridge.log.warn("Player waited too long.");
}, 5000);

bridge.lifecycle.onDispose(() => {
  bridge.lifecycle.clearTimeout(timer);
});

// Backend request.
const result = await bridge.socket.request("camp_choice:save", {
  choice: "watch"
});
```



## 13. DOM Intercepts

DOM intercepts are best for menus, forms, confirm/cancel gates, companion panels, inventory selection, and lightweight custom UX. Build inside the host element you receive and clean up through `bridge.lifecycle`.



```javascript
js: `
  const root = bridge.surface.getRoot();
  const lock = bridge.player.ui.lock({
    controls: "disabled",
    busy: "Choosing..."
  });

  bridge.lifecycle.onDispose(() => lock.release());

  root.querySelector("[data-continue]").addEventListener("click", () => {
    bridge.intercept.resolve({ ok: true });
  });
`
```



Avoid raw `window.addEventListener`, `setTimeout`, and raw socket listeners inside intercepts unless you also clean them up. Prefer `bridge.lifecycle.onWindow`, tracked timers, and `bridge.socket.on`.

## 14. PixiJS Intercepts And Gameplay

Pixi intercepts are for canvas-first custom UX: mini-games, tactical overlays, custom animation scenes, interactive maps, rhythm inputs, puzzle boards, or full takeover sequences.



```javascript
tools.gui.registerRuntimeIntercept({
  interceptId: "pixi_duel",
  checkpoint: "before_first_dialogue",
  blocking: true,
  renderer: "pixi",
  timeoutMs: 120000
});
```





```javascript
exports: {
  guiIntercepts: {
    async pixi_duel(context, tools) {
      return {
        renderer: "pixi",
        js: `
          const { PIXI } = context;
          const layer = bridge.takeover.getLayer();
          const size = bridge.pixi.getLogicalSize();

          const bg = new PIXI.Graphics();
          bg.rect(0, 0, size.width, size.height);
          bg.fill({ color: 0x101820, alpha: 0.96 });
          bridge.pixi.add(bg, { destroyOnDispose: true });

          bg.eventMode = "static";
          bg.cursor = "pointer";
          bg.on("pointerdown", () => {
            bridge.takeover.finish({ result: "clicked" });
          });
        `
      };
    }
  }
}
```



In Pixi takeover paths, always finish with `bridge.takeover.finish(...)` or `bridge.takeover.abort(...)`. Register tickers/listeners through the bridge or `VN.pixiPlugins` runtime and dispose them before finishing.

## 15. Assets

Backend code should use `tools.assets` and `tools.project` for filesystem-safe work. Intercept frontend code should use `bridge.assets` for URLs and loaders.



```javascript
// In intercept JS.
const url = bridge.assets.url("assets/panel.png", { scope: "plugin" });
const data = await bridge.assets.loadJson("project://data/camp_state.json");
const texture = await bridge.assets.loadTexture("assets/token.png", { scope: "plugin" });
```



Prefer `plugin://`, `project://`, or explicit `{ scope }` options over hand-built relative paths.

## 16. Persisted vs Runtime Intercepts

This choice controls whether an intercept is part of turn history.

| Lane | Register with | Use for |
| --- | --- | --- |
| Persisted | tools.gui.registerPersistentIntercept | Narrative-critical choices and rewind-consistent replay. |
| Runtime | tools.gui.registerRuntimeIntercept | Live-only overlays, tactical panels, one-off effects, temporary UX. |

When in doubt, ask whether a player replaying historical turns should see the same intercept. If yes, use persisted. If no, use runtime.

## 17. Custom File Viewers

Plugins can add custom Content Manager modes and provide custom viewers for those files.



```javascript
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

hooks: {
  HOOK_PROJECT_LOADED: {
    run: async (context, tools) => {
      tools.project.registerFileMode("world-map", {
        label: "World Map",
        description: "A structured map file owned by this plugin.",
        viewer: true,
        schema: {
          title: { type: "text", label: "Map Title" }
        }
      });
    }
  }
},
exports: {
  async provideFileView(context, tools, { modeId, filePath }) {
    if (modeId !== "world-map") return null;

    try {
      const map = JSON.parse(await tools.project.readFile(filePath));
      return {
        type: "html",
        content: "<h2>" + escapeHtml(map.title || "Untitled Map") + "</h2>"
      };
    } catch (error) {
      tools.logger.warn(`Could not render map file: ${error.message}`);
      return { type: "text", content: "This map file is missing or malformed." };
    }
  }
}
```



## 18. Safety And Good Citizenship

- Use `tools.project` and `tools.assets` instead of raw filesystem paths when possible.

- Use parameterized SQL for `tools.db` calls.

- Keep hook work as small as possible on the critical generation path.

- Move slow optional work to `HOOK_VN_BACKGROUND_TASKS` or `tools.jobs`.

- Use `tools.logger` instead of unscoped console logging in backend code.

- Use `bridge.lifecycle` for intercept timers/listeners.

- Use `VN.pixiPlugins` for long-lived VN Pixi injections.

- Namespace socket events with your plugin id: `my_plugin:event-name`.

- Return stable response shapes: `{ success: true, ... }` or `{ success: false, error }`.

## 19. Growth Path

| Plugin level | What you build | Main APIs |
| --- | --- | --- |
| Level 1 | Logging, small state reads, settings, prompt hints. | hooks, tools.settings, tools.prompt, tools.logger |
| Level 2 | Turn analysis, facts, memories, generated metadata. | tools.llm, tools.facts, tools.turns, tools.pluginState |
| Level 3 | Plugin dashboard or editor. | views, window.bridge, socketListeners |
| Level 4 | Persistent VN HUD or VFX plugin. | HOOK_FRONTEND_INJECTION, window.VN, VN.pixiPlugins |
| Level 5 | DOM intercepts, choices, custom panels. | tools.gui, exports.guiIntercepts, intercept bridge.* |
| Level 6 | Interactive Pixi gameplay and canvas takeover. | renderer: "pixi", bridge.takeover, bridge.pixi, bridge.lifecycle |

## 20. Where To Go Next

- Use the [Plugin Example Catalog](examples.md) to choose a disabled example by difficulty and API.

- Use [Plugin API Groups](../plugins/api_groups.md) for the quick API group reference.

- Use the [Plugin SDK](../plugin_sdk_tooling/index.html) for the backend `tools.*` and GUI tooling reference.

- Use the [GUI Intercept SDK](../gui_intercept_sdk/index.html) for the full descriptor and bridge reference.

- Use the [Visual SDK](../vn/visual_sdk.md) for the raw `window.VN` viewer API.

- Read [Plugin Database Best Practices](../plugin_db_best_practices/index.html) before writing timeline-sensitive SQL.