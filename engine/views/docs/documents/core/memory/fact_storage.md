# Structured Knowledge & Ledger

While the RAG pipeline handles unstructured prose, the engine uses the `FactManager` (`engine/modules/memory_manager/storage/fact_manager.js`) to track structured, immutable truths and long-term strategic state.

## 1. SQLite Storage

Structured knowledge is stored in a **SQLite** database (`chat.db`) located within each project's root directory. The primary table is `facts`.

### The "Facts" Schema
- **`source`**: The entity the fact belongs to (e.g., a Character Name or `director`).
- **`predicate`**: The type of relationship or state (e.g., `HAS_GENDER`, `CURRENT_LOCATION`, `LEDGER_ENTRY`).
- **`target`**: The unique identifier for the specific state key.
- **`fact_value`**: The actual content or value of the fact.
- **`turn_number`**: The chronological turn where this fact was established.

---

## 2. The Director’s Ledger

The "Ledger" is a specialized use of the fact system that acts as the **Director Agent's** persistent memory. It allows the AI to track plot threads, character development, and narrative mysteries across hundreds of turns.

### Operations (INSERT, UPDATE, DELETE)
The Director updates the ledger using a specialized syntax in its LLM response, which is parsed by `processLedgerOperations`:
- `INSERT [ID] text`: Adds a new plot thread or note.
- `UPDATE [ID] text`: Modifies an existing thread.
- `DELETE [ID]`: Marks a thread as completed or irrelevant (toggled to `DELETED` context in the DB).

---

## 3. Character Identification & State

The `FactManager` automatically manages the lifecycle of characters:
- **`CHARACTER_INTRODUCTION`**: When a new name appears in the story sequence, the engine automatically persists a "CHARACTER_INTRODUCTION" fact to avoid re-introducing the same character as "new" in later turns.
- **State Retrieval**: Modules can query the `getLatestFactsByPredicate` function to get the current "Single Source of Truth" for any character (e.g., their current outfit, location, or relationship status).
