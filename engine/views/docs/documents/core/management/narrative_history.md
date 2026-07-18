# Narrative History & DB

The `ChapterManagement` module (`engine/modules/chaptermanagement.js`) is responsible for the persistent state of a narrative session (an "Adventure"). It manages the relationship between chronological story progress and the underlying SQLite storage.

## 1. SQLite Schema (chat_turns)

Each adventure is stored in a standalone `.db` file. The primary table, `chat_turns`, stores the following for each turn:

- **`creation_turn_number`**: The global chronological index.
- **`turn_context_snapshot`**: A compressed (GZIP) JSON blob containing the entire `TurnContext` object.
- **`title` / `synopsis` / `summary`**: Flattened metadata fields for fast UI rendering (skeletons).
- **`fulltext`**: A flattened copy of the full narrative text from `TurnContext.output.fulltext`, kept in sync when turns are inserted or updated.
- **`thumbnail`**: A base64 image representing the visual state at the end of the turn.
- **`dialogue_count`**: The number of lines generated in this turn.

---

## 2. Tiered Context Retrieval

To handle stories that span hundreds of turns, the engine uses a "Dated Chapters" strategy to keep the LLM context window manageable:

- **Full (Latest 6 Turns)**: These turns are fully "inflated" (decompressed) and sent to the LLM with all internal state.
- **Summary (Next 12 Turns)**: Only the `summary` fields of these turns are sent.
- **Synopsis (Historical Turns)**: Older turns are collapsed into even more concise synopses.

---

## 3. The Blob Cache

Decompressing large JSON blobs from SQLite is CPU-intensive. The engine implements a request-scoped `_blobCache`. 
- **Start of Turn**: The cache is cleared.
- **During Pipeline**: Any module requesting a historical turn (e.g., for RAG or context assembly) hits the cache first.
- **Persistence**: Only one decompression happens per turn ID per pipeline run, significantly improving performance for complex narratives.

---

## 4. Viewer State

The `viewer_state` table tracks the user's progress through the Visual Novel sequence.
- **`last_turn_number`**: The current turn being viewed.
- **`last_dialogue_index`**: The specific line index within that turn.

This allows the user to close the application and resume exactly where they left off in the dialogue.
