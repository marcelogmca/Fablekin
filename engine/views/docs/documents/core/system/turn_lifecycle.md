# Turn Execution Pipeline

This document describes the production turn pipeline used by VN generation.
The flow is coordinated by `turn_runner.js` and supports both canonical turns and virtual interlude turns (user-facing term: Interludes).

## 1. Entry & Run Profile Resolution

Socket handlers route requests into a unified runner:
- `generate-vn-turn` -> canonical `mainline` profile.
- `generate-interlude-turn` -> interlude profiles (`interlude_story` or `interlude_sandbox`) based on explicit `runProfileId` or fallback rules.

The runner resolves a **Run Profile** before building context. Profiles define behavior declaratively:

| Profile | Mode | Canonical DB Writes | Hook Policy | Wait Background Tasks |
| :--- | :--- | :--- | :--- | :--- |
| `mainline` | `mainline` | Yes | `all` | No |
| `interlude_story` | `interlude` | No | `opt-in` | Yes |
| `interlude_sandbox` | `interlude` | No | `opt-in` | Yes |

---

## 2. Turn Context Assembly

For every run:
1. Resolve selected files and active `chat.db`.
2. Initialize chapter management and (when enabled) fact manager.
3. Create and populate `TurnContext`.
4. Load project directives and runtime assets.
5. Execute `HOOK_GUI_GATEKEEPER`.

Mainline and interlude both use the same pipeline primitives, but interludes inherit parent-turn lineage fields and skip canonical numbering semantics.
Interlude prompt construction restores from the parent chapter's `writer_prompt_snapshot` before generation.

---

## 3. Narrative Pass

`narrativeengine.js` executes:
1. Foundation and memory gathering (`prompt_builder.js`).
2. Director pass (if enabled).
3. Writer pass (final prose generation).

Director/Writer configuration is resolved dynamically from settings at runtime (not static startup snapshots).

---

## 4. VN Transform Pass

`vn_manager.js` transforms prose into sequence output:
1. Dialogue processing.
2. Blocking analysis tasks (emotion, assets, scene-phase classification, etc.).
3. Sequence rendering and client event injection.
4. Background tasks (summary, thumbnails, plugin background hooks).

Run profile policy is enforced here:
- If `canonicalWrites=false`, VN pre-commit and post-background canonical DB updates are skipped.
- If `awaitBackgroundTasks=true`, response waits for background tasks to finish before returning.

---

## 5. Persistence Strategy

### Mainline
- Commits to canonical turn tables via `TurnContext.commit()`.
- Timeline advances as normal.

### Interlude (Virtual)
- Does **not** create a canonical timeline turn.
- Persists via `chaptermanagement.appendInterlude(...)` into `chat_interludes`.
- Optional story relevance controls integration workflows (`pending`, `integrated`, etc.).
- Plugin assets are keyed by `storageTurnKey` (`53`, `53.1`, etc.) so interlude assets do not collide with parent chapter assets.

---

## 6. Runtime Contract

Every run writes pipeline state to:
- `turnContext.sceneMode`
- `turnContext.runtime.turnPipeline`

The `turnPipeline` object is the cross-module contract consumed by VN transform and hook execution. Typical fields:
- `runProfileId`
- `mode`
- `sceneMode`
- `canonicalWrites`
- `persistenceMode`
- `awaitBackgroundTasks`
- `hookPolicy`
