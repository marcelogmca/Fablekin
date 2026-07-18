# State & Memory Inspection

For advanced debugging and narrative analysis, the engine provides tools to inspect the underlying knowledge stores and chronological state.

## 1. Memory Inspector

The Memory Inspector provides a visual interface for both structured and unstructured data stored by the engine.
- **LanceDB Viewer**: Allows users to query and inspect vector embeddings. You can see the raw text chunks and their associated metadata (turn number, source file).
- **SQLite Explorer**: View the contents of the `chat.db` (turns) and `chat.db` (facts) tables.
- **Fact Graph**: (If enabled) Visualizes the relationship between characters, locations, and narrative predicates.

---

## 2. Scene History (Timeline)

The Scene History view is a chronological timeline of the current adventure.
- **Navigation**: Allows users to jump to any turn in the story.
- **Metadata Skeletons**: Displays the Title, Abstract Title, and Synopsis for each turn to help with orientation.
- **Thumbnails**: Shows a visual snapshot of the VN scene at the end of each turn.
- **Branching Point**: This is the primary interface for initiating a "Branch," allowing the user to select a turn and spawn a new timeline from that specific moment.
