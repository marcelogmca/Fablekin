# Branching & State Management

Branching allows users to "rewind" the story to a specific point and start a new timeline without losing their original progress.

## 1. The Branching Workflow

When a user initiates a branch from Turn X:
1. **File Copy**: The engine creates a physical copy of the current `.db` file (e.g., `Adventure_Branch_1.db`).
2. **Trim History**: The `branchChat` function in `ChapterManagement` executes a `DELETE` command on the new database, removing all turns where `creation_turn_number > X`.
3. **Reset State**: The `viewer_state` in the new database is reset to Turn X, Dialogue 0.
4. **Cleanup**: A `VACUUM` command is run on the new SQLite file to optimize its size after the deletion.

---

## 2. Plugin Storage Branching

Plugins that store data outside of the database (e.g., world maps, character portraits generated mid-turn) follow the "Chat/Turn" folder structure:
`/plugins/[ChatName]/[TurnNumber]/[PluginId]/`

When branching, the engine does not immediately copy all historical plugin folders. Instead:
- The new `ChatName` creates a unique namespace.
- Subsequent turns in the new branch will generate data in the new chat's folder structure.
- **Note**: Historical assets referenced in the `TurnContext` snapshots are still accessible because they are linked via relative paths that remain valid across branches.

---

## 3. Implementation Details

The core logic resides in `engine/modules/chaptermanagement.js` within the `branchChat` function. It is an atomic operation designed to ensure that the user never encounters a corrupted database state during the cloning process.
