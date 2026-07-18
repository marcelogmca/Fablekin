# Multi-Query RAG & Retrieval

The memory retrieval system is designed to provide the LLM with the most relevant context while staying within token limits. It uses a combination of semantic search and query expansion.

## 1. Ingestion & Chunking (`rag_pipeline.js`)

When a file or turn is processed for RAG:
- **Semantic Chunking**: Text is split into chunks (default 500 characters) with a 50-character overlap to preserve local context.
- **Context Anchoring**: Every chunk is tagged with an "ultra-brief overview" (Global Context Anchor). This ensures that even if a small snippet is retrieved, the LLM knows what the overall file was about.
- **Change Detection**: The engine uses SHA-256 hashes to skip re-indexing files that haven't changed, saving on embedding costs.

---

## 2. Multi-Query Retrieval (`query_generator.js`)

Similarity search often fails when the user's phrasing is slightly different from the source text. To solve this, the engine uses **Multi-Query Retrieval**:
1. **Expansion**: The system takes the current turn context and generates 5 diverse "alternative versions" of the retrieval query.
2. **Scatter/Gather**: The engine runs semantic searches for all 6 queries (original + 5 variations) against the vector database.
3. **Re-ranking**: The top results from all queries are combined and deduplicated before being injected into the prompt.

---

## 3. Performance & Scaling

- **Batching**: Large files (>2MB) are processed in batches (default 3000 chunks) to prevent memory overflows.
- **Thresholds**: If a file is small enough, the engine may skip RAG and inject the full text instead (Full-Text Threshold).
- **LOD Interaction**: RAG is the most granular level of the [Memory LOD](./memory_lod.md) system.
