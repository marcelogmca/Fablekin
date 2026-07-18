# Summarization & Compression

The `SummarizationService` is the primary engine for distilling complex narrative data into digestible chunks for the memory system and character sheets.

## 1. Summarization Tiers

The service manages two distinct types of condensation:

- **Summary (`summary_prompt.txt`)**: A medium-length, technically accurate description of events. This is used for "Tier 2" memory LOD and for the "World History" view.
- **Synopsis (`synopsis_prompt.txt`)**: A highly structured, ultra-short overview. It includes a **Literal Title** (factual), an **Abstract Title** (thematic), and the synopsis itself.

---

## 2. Caching Strategy

Summarization is an expensive LLM operation, so the service uses a multi-layer cache.

### Static File Caching
For character sheets and world notes, the engine:
1. Generates a **SHA-256** hash of the file content.
2. Checks the project's SQLite `summaries` table for a matching hash.
3. Only triggers the LLM if the file has changed or is missing a summary.

### Vector Store Caching
All summaries are embedded into a specialized `summaries_cache` vector store in LanceDB. This allows the engine to quickly retrieve summaries even if the source file paths have changed.

---

## 3. SQLite Management (`StaticDataManager`)

The `StaticDataManager` provides the persistent backbone for project-level data.
- **Project Isolation**: Every project has its own `.db` file (e.g., `my-cool-story.db`).
- **Generic Store**: Besides summaries and character sheets, it provides a `genericQuery` API for plugins to store custom persistent data (e.g., relationship scores, inventory lists) without needing to manage their own SQL connections.
