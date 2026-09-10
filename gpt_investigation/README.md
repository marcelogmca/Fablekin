# Fablekin Prompt-Engineering Investigation

## Scope

This is a prompt-engineering thesis of Fablekin as it exists in this repository. It explains why the system can produce unusually coherent, characterful interactive fiction despite asking a Writer to satisfy many simultaneous constraints.

It deliberately does **not** evaluate Electron, SQLite, renderer, hook-runtime, or storage implementation as engineering systems. Those mechanisms matter here only where they change what an LLM sees, when it sees it, or how a generated chapter becomes future prompt context.

## Central conclusion

Fablekin's quality does not come from one giant “write well” prompt. It comes from a staged editorial loop:

```text
Player attempt
  → shared narrative evidence
  → Director deliberation and selective brief
  → Writer deliberation and locked beat map
  → prose
  → narrowly scoped validation and extraction
  → compressed, specialized memories for the next chapter
```

The decisive design choice is **role separation**. The Director absorbs strategic, adversarial, and continuity-heavy reasoning; the Writer receives both that distilled guidance and a separate procedural checklist for turning the current player attempt into a playable chapter. Follow-up models do not simply summarize the prose: they turn the chapter into explicit state, relationship, personality, quest, and pacing signals that make the next prompt more accurate.

## Reading order

1. [01-prompt-topology.md](01-prompt-topology.md) — what the two agents share, what remains private, and why the separation matters.
2. [02-director-deliberation.md](02-director-deliberation.md) — the Director's unusually broad deliberation framework and its Writer Brief.
3. [03-writer-deliberation.md](03-writer-deliberation.md) — the Writer's execution-time reasoning, agency constraints, and dialogue control.
4. [04-memory-and-context.md](04-memory-and-context.md) — multi-resolution memory, retrieval, character sheets, and prompt slots.
5. [05-prompt-facing-plugins.md](05-prompt-facing-plugins.md) — how plugins add specialized cognition without dumping everything into prose.
6. [06-post-writing-feedback-loops.md](06-post-writing-feedback-loops.md) — validators, extractors, cinematic prompting, and the next-turn learning loop.

## Terms used here

- **Chapter**: the user-facing unit the Writer produces. Source identifiers may still say `turn`.
- **Director**: the strategic LLM whose public product is the `WRITER_BRIEF`.
- **Writer**: the prose LLM. Its internal deliberation is instructed through the Writer thinking framework.
- **Shared foundation**: canon, dynamic knowledge, history, directives, and current state given to both agents.
- **Private pillar**: context routed only to Director or Writer, so a fact can guide one role without becoming an instruction to the other.
- **Evidence**: quoted/tagged canon, history, simulation, or current action. It is reference material, not an instruction source.

## Important qualification about “CoT”

The repository calls the Director and Writer procedures “CoT”/thinking. This thesis discusses the **prompted reasoning workflows and their intended observable effects**, not any hidden model reasoning. The Writer framework explicitly asks for its planning inside `<thinking>` tags before prose; the useful product is the disciplined planning behavior it elicits: checklists, conflict resolution, beat locking, and audits.

## Evidence base

Primary sources include `engine/prompts/writer_chain_of_thought.txt`, `engine/prompts/director/*`, `engine/modules/prompt_builder.js`, `engine/modules/director.js`, `engine/modules/memory_manager/processing/memory_lod.js`, and active plugin prompts/injections under `engine/plugins/`.
