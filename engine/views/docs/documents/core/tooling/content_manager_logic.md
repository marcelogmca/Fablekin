# Content Manager Logic

The Content Manager is the primary workspace for story construction, providing a robust interface for file organization and metadata editing.

## 1. File Tree & Navigation

The management of the hierarchical project view is handled through a combination of tree rendering and drag-and-drop logic.
- **Tree Persistence**: The tree state is synchronized via `socket_handlers.js`, ensuring that file additions or deletions are reflected instantly.
- **Drag & Drop (`drag_drop.js`)**: Implements a physics-informed reordering system.
    - **Category Guardrails**: Prevents users from dragging sensitive system files (e.g., Directives) into asset folders.
    - **Order Calculation**: Uses a weighted sorting algorithm to maintain the linear sequence of chapters and lore entries.

---

## 2. Schema-Based Editing

For complex project files (like `.world` configs or character profiles), the Content Manager provides a form-based editor.
- **Mode Resolution**: Based on the file extension and path, the manager resolves a `pluginMode` which includes a JSON Schema.
- **Form Generation**: `renderSchemaForm` translates these schemas into HTML inputs, providing a high-level abstraction over raw JSON editing.

---

## 3. Communication Bridge (`socket_handlers.js`)

The manager serves as a gateway for several specialized operations:
- **MD to DB Conversion**: Triggers the backend process to "Compile" narrative Markdown files into high-performance SQLite chat databases.
- **Asset Processing**: Handles the initial ingestion of sprites and backgrounds, ensuring they are placed in the correct project sub-directories.
- **Player Metadata**: Synchronizes the player's name and bio across the engine, which in turn influences the [Text Formatting Resolution](../vn/narrative_utilities.md).
