# Memory & RAG Pipeline

The engine utilizes a sophisticated Retrieval-Augmented Generation (RAG) pipeline to provide AI agents with long-term memory and relevant world knowledge. It transitions from traditional keyword searching to advanced vector-based semantic retrieval.

## 1. Storage Layer (LanceDB)

The engine uses **LanceDB** as its primary vector database. Unlike traditional cloud-based vector stores, LanceDB is a serverless, persistent database that stores embeddings directly within the project folder (`/vectors/`).

### Embedding Provider
- **Ollama**: The default provider for generating embeddings. It runs locally and supports models like `nomic-embed-text` or `mxbai-embed-large`.
- **Schema**: Every embedding entry includes:
  - `vector`: The numerical representation of the text.
  - `text`: The raw chunk of prose.
  - `turn_number`: The specific turn this memory belongs to.
  - `metadata_json`: Flexible storage for source files, chunk positions, and tags.

---

## 2. Retrieval Strategy (RRF)

To improve accuracy, the `memory_retriever.js` implements a multi-stage retrieval process:

### Multi-Query Parallelism
Instead of a single search, the engine generates multiple variations of the user's intent and runs them in parallel against the vector store.

### Reciprocal Rank Fusion (RRF)
RRF is a consensus algorithm that combines the results from multiple queries. A chunk that appears at the top of multiple search results is given a significantly higher relevance score than a chunk that only appears once.

### Keyword & Entity Boosting
The engine identifies "Gold Standard" entities (Character Names, Locations, Unique Artifacts) from the current `TurnContext`. If a retrieved chunk contains these entities, its relevance score is boosted by 30-50%, ensuring that vague vector matches are anchored to the specific narrative context.

---

## 3. Context Assembly

Before being sent to the LLM, retrieved memories are formatted by `assembleContext`:
- **Grouping**: Chunks are grouped by their source (Chapter ID or Static File Name).
- **Ordering**: Within each group, chunks are sorted by their original position in the file to maintain narrative flow.
- **Deduplication**: Identical content retrieved by different queries is merged to save context window tokens.
