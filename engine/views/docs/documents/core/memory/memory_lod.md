# Memory Level of Detail (LOD)

The engine implements a sophisticated **Dynamic Level of Detail (LOD)** system to manage story context. This ensures that the engine can handle infinite stories without exceeding LLM context limits or losing track of critical plot points.

## 1. The Memory Hierarchy

The engine organizes past chapters into three tiers based on age and relevance.

| Tier | Type | Content |
| :--- | :--- | :--- |
| **Tier 1** | **Full Text** | Verbatim dialogue and narration for the most recent chapters. |
| **Tier 2** | **Summary** | Detailed paragraphs describing the events of middle-history chapters. |
| **Tier 3** | **Synopsis** | 1-2 sentence ultra-high-level overviews for the distant past. |

---

## 2. Dynamic Elevation

Unlike static memory systems, the engine can "Elevate" old chapters back to full detail if they become relevant again.

1. **RAG Trigger**: During turn generation, the engine searches the vector store for memories related to the current input.
2. **Hit Counting**: The engine ranks chapters by the number of "hits" they received in the RAG search.
3. **Elevation**: If an old chapter (currently at Synopsis level) receives a high number of hits, the engine dynamically swaps the synopsis for the **Full Text** or **Summary** in the current prompt.

---

## 3. Slotted RAG

For chapters that remain at the **Synopsis** level, the engine uses "Slotted RAG" to provide extra detail.
- If a specific sentence from an old chapter is relevant but the whole chapter isn't worth elevating, the engine "slots" that specific verbatim memory into the synopsis block.
- This provides a "Lossy" but effective way to maintain precision for specific details (like a character's secret or a hidden item) without bloating the context with irrelevant prose.

---

## 4. Arc Compression

For extremely long projects (e.g., hundreds of turns), the engine groups contiguous synopsis chapters into reusable **Arc Tiles**.
- **Rollover Grace**: Recent synopsis windows shrink by the configured grace (default 5), then stretch until five newly old chapters are ready. The open tile only updates at that rollover boundary.
- **Tiles**: Arc ranges use canonical chapter boundaries and seal at 25 chapters by default. Sealed tiles never change; only the final open tile can grow.
- **Compression**: Independent tiles are compressed in parallel with reasoning disabled.
- **Caching**: Arc summaries are content-hashed and cached in SQLite. Brief, balanced, deep, and main LOD share identical cached tiles.

### Compressed History Arc Tails

The `brief`, `balanced`, and `deep` compressed history views can also prepend an **Arc Tail** for chapters outside their normal recent-history scope. This prevents older story material from disappearing entirely from plugin-facing compressed history.

- **Chunking**: Old out-of-scope chapters are split into reusable 25-chapter tiles, with a 60,000-character safety limit.
- **Cache Reuse**: Each chunk is cached in the chat database's `arc_compression_cache`, separate from the development cache.
- **Fallback**: Unsealed grace chapters and chunks smaller than the configured minimum remain individual synopses; failed compression falls back the same way.
- **Settings**: Shared defaults live under `infrastructure.narrative_history.memory_lod`, including `arc_rollover_grace_chapters` and `arc_tile_chapters`. Arc-tail-specific overrides remain available under `compressed_history.arc_tail`.
