# Memory Inspector & CLI

The **Memory Inspector** provides a powerful Xterm-compatible terminal interface for debugging and manipulating the engine's internal state.

## 1. System Commands

| Command | Description |
| :--- | :--- |
| `/rag [query]` | Performs a direct semantic search against the active vector store. |
| `/sql "[query]"` | Executes raw SQLite on the project database. **Write access is enabled.** |
| `/facts [search]` | Filters and searches the permanent fact ledger. |
| `/perf [turn]` | Renders a visual waterfall diagram of pipeline hook timings. |
| `/prompt [turn]` | Shows the raw messages sent to the LLM for that turn. |
| `/diff [a] [b]` | Compares two turn contexts to see exactly what changed. |

---

## 2. Plugin Extensibility

Plugins can register their own terminal commands.
- **Example**: The `relationship_tracker` plugin adds `/affinity` to inspect or modify character relationship scores directly.
- **Integration**: Plugin commands have access to the full `tools` SDK and the active `turnContext`.

---

## 3. Security & Safety

- **Redaction**: The `/settings` command automatically redacts sensitive keys (API keys, passwords, tokens) using a pattern-matching filter.
- **Sandboxing**: Plugin commands are executed within the standard plugin sandbox, preventing them from accessing files outside the project directory.

---

## 4. Visualizations

The terminal supports basic ASCII visualizations:
- **Performance Bars**: Color-coded bars showing hook duration.
- **Table Rendering**: Auto-sized tables for SQL and Fact results.
- **Hierarchy Trees**: Used in `/turncontext` to visualize complex nested objects.
