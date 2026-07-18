> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

Architecture Reference
# Turn-Bounded Data

Plugin Data Integrity in a Branching Timeline

PROJECT: DYNAMIC NARRATIVE ENGINE

SCOPE: PLUGIN DATA LAYER

STATUS: CANONICAL

**The Golden Rule:** Every query over timeline-dependent rows must include `turn_number <= ?` bound to the current turn context. Project-wide configuration and lookup tables do not need a turn bound unless their meaning changes across the story timeline.

**Prefer the smallest storage API:** use `tools.pluginState` for plugin-owned runtime or per-turn state and `tools.facts` for scoped timeline facts. Reach for custom SQL only when those higher-level APIs cannot represent the data or query you need.

## The Problem: Branching & Rewinds

Fablekin lets players **rewind** to any earlier turn and **branch** the story from there. When this happens, the database still contains data written by turns that no longer exist in the current timeline.

### Why Not Just Delete Future Data?

Aggressive deletion is fragile, slow, and creates cascading complexity:

- Every plugin would need custom cleanup logic for its own tables.

- Deletion hooks add latency to every rewind operation.

- Branching copies the entire database — you'd need to audit every table in the copy.

- For lightweight text data (facts, state entries, ledger rows), the storage cost of "orphaned" rows is negligible.

Instead, we treat the database as an **append-only log** and control visibility at query time.

## Pattern 1: Turn-Bounded Queries

Required

The primary mechanism for timeline safety. By capping every query at the current turn number, "future" data from abandoned branches becomes invisible without ever being deleted.

### The Wrong Way



```
-- This leaks data from future/abandoned turns after a rewind
SELECT * FROM world_state WHERE character_id = ?;
```



### The Right Way



```
-- Strictly bounded to the current timeline position
SELECT * FROM world_state
WHERE character_id = ?
  AND turn_number <= ?;
```



**Where does the turn number come from?** In a hook handler, use `turnContext.turnNumber`. An exported function or terminal command should accept an explicit turn number or derive it from a valid current turn context; it must not silently query all future rows.

### Aggregation Queries

The bound applies to **all** query types — including aggregations like `MAX()`, `GROUP BY`, and subqueries. A common mistake is forgetting the bound in a subquery:



```
-- ❌ WRONG: The subquery returns the global maximum, not the timeline-local one
SELECT * FROM facts f1
INNER JOIN (
    SELECT target, MAX(turn_number) AS max_turn
    FROM facts
    GROUP BY target
) f2 ON f1.target = f2.target

-- ✅ CORRECT: Both outer and inner queries are bounded
SELECT * FROM facts f1
INNER JOIN (
    SELECT target, MAX(turn_number) AS max_turn
    FROM facts
    WHERE turn_number <= ?
    GROUP BY target
) f2 ON f1.target = f2.target
WHERE f1.turn_number <= ?
```



## Pattern 2: Upsert-by-Turn

Standard

When writing data for a turn, always **delete the current turn's entries first**, then insert fresh data. This guarantees idempotency — if the user re-generates a turn (without rewinding), the plugin doesn't produce duplicate rows.

DELETE WHERE turn = N
→
INSERT (turn = N, ...)
→
SELECT WHERE turn ≤ N

### Implementation



```
// Inside a hook handler (e.g., HOOK_VN_BACKGROUND_TASKS)
const turnNum = turnContext.turnNumber;

// 1. Wipe any previous attempt at this turn
await tools.db.chat.execute(
    `DELETE FROM my_data WHERE turn_number = ?`,
    [turnNum]
);

// 2. Insert the fresh results
await tools.db.chat.execute(
    `INSERT INTO my_data (turn_number, key, value) VALUES (?, ?, ?)`,
    [turnNum, 'mood', 'contemplative']
);
```



Use `tools.db.chat.query(sql, params)` for reads and `tools.db.chat.execute(sql, params)` for writes in the active chat database. Use `tools.db.project` only for genuinely project-wide data.

## Why This Works for Branching

When a user branches at Turn 20:

- The engine **copies** the entire `.db` file to a new path.

- The new database still contains Turns 21–50 from the original branch.

- The new branch starts generating from Turn 21.

- Because the new Turn 21 uses **Upsert-by-Turn**, it overwrites the old Turn 21's data.

- Because all queries use **Turn-Bounded Queries**, Turns 22–50 from the old branch are invisible.

**Zero cleanup required.** The old data is harmless ballast. It will never be read, and if the user continues the new branch past Turn 50, the old rows are gradually overwritten by the upsert pattern.

## Physical Files: Managed Storage

Standard

If your plugin needs to write files to disk (audio, images, cached outputs), use the engine's **managed plugin storage** directory. The engine isolates files by chat and turn storage key, copies and prunes them during branching, and removes the full chat directory when that chat is deleted.

### Directory Structure



```
workspace/projects/[ProjectName]/
└── plugins/
    └── [ChatName]/            ← deleted when chat is deleted
        └── [TurnStorageKey]/  ← main turn "53" or interlude "53.1"
            └── [PluginId]/    ← your plugin's files live here
                ├── output.wav
                └── cache.json
```



**Lifecycle behavior:**

- **Turn deleted (rewind):** the engine fires `HOOK_TURN_DELETED`. Plugins that created physical files for that turn must remove them in this hook.

- **Chat deleted:** The entire `[ChatName]/` folder is removed.

- **Chat branched:** The folder is copied to the new branch, then storage keys whose base turn is beyond the branch point are pruned.

### Accessing Managed Storage

Use the `tools.project.getChatPluginStorage()` helper to get paths. The engine provides both absolute and relative paths:



```
// Inside any hook handler
const storage = tools.project.getChatPluginStorage();

// storage.absolutePath → Full OS path for fs.writeFile()
// storage.relativePath → "plugins/MyChat/42/my_plugin"
// storage.chatName    → "MyChat"
// storage.turnNumber  → 42
// storage.storageTurnKey → "42" or an interlude key such as "42.1"

// Ensure the directory exists, then write your file
await fs.mkdir(storage.absolutePath, { recursive: true });
await fs.writeFile(
    path.join(storage.absolutePath, 'output.wav'),
    audioBuffer
);
```



**When do you need lifecycle hooks?** Use `HOOK_TURN_DELETED` to remove managed files belonging to a deleted turn. Use `HOOK_CHAT_DELETED` or `HOOK_CHAT_BRANCHED` only for storage outside the managed hierarchy, such as a remote service or shared cross-chat cache.

## Summary

| Pattern | When | Required? |
| --- | --- | --- |
| Turn-Bounded Queries | Timeline-dependent reads | Required |
| Upsert-by-Turn | Regeneratable per-turn writes | Standard |
| Managed Storage | Writing physical files to disk | Standard |
| Deletion Hooks | Turn deletion, or external/shared storage | As needed |

ARCHITECTURE REFERENCE
PLUGIN DATA LAYER