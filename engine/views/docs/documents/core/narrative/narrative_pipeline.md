# The Narrative Pipeline

The Narrative Pipeline is the core sequence of operations that transforms user input into story prose.
It handles shared context assembly, Director strategy, and Writer generation.

## 1. Pipeline Overview

The narrative stage is managed by `engine/modules/narrativeengine.js` and runs in three steps.

### Stage A: Context Gathering (Foundation)
Managed by `prompt_builder.js`, the engine builds the shared context used by Director and Writer.
- **Lore RAG**: Retrieves relevant project and lore snippets based on the current input.
- **Static Files**: Injects selected project files in full or summary mode.
- **Memory Retrieval**: Pulls and compresses relevant prior-turn memory.
- **Shared Prefix Finalization**: After `HOOK_PRE_ORCHESTRATOR`, root prompt slots are serialized into one immutable message prefix. Director warms this prefix and Writer reuses it when their resolved routes match.

### Stage B: Strategic Orchestration (Director)
If enabled, the Director (`director.js`) runs before prose generation.
- **Narrative Analysis**: Reviews pacing, rhythm, thread continuity, and character constraints.
- **Thread Ledgering**: Maintains structured continuity data across turns.
- **Writer Briefing**: Produces strategic guidance and mandatory constraints for the Writer.
- **Capability Awareness**: Uses registered scene capabilities to shape handoff boundaries when mechanical systems (combat, travel, resting, etc.) should take control.

### Stage C: Final Assembly and Writer Generation
`prompt_builder.js` assembles the final Writer sleeve.
- **Director Brief**: Injects strategic guidance.
- **Soft Feedback**: Injects optional user/UX hints.
- **LLM Output**: `llm.js` generates the prose body for VN transform.

> Note: mainline vs interlude routing, virtual persistence policy, and hook policy are decided by `turn_runner.js` run profiles. See `system/turn_lifecycle.md` and `system/run_profiles_virtual_turns.md`.

---

## 2. TurnContext Contract

Every run is represented by a `TurnContext` instance (`engine/modules/turncontext.js`).
It is the single source of truth that moves through narrative, VN transform, and persistence.

### Key Areas
- **`input`**: User prompt, selected files, character metadata, and run flags.
- **`processed`**: Intermediate artifacts (retrieved memory, director output, classifier output).
- **`promptComponents`**: Structured prompt slot registry. `root.*` feeds the shared frozen prefix; `director.*` and `writer.*` feed private agent suffixes.
- **`output`**: Final prose and VN-ready outputs.
- **`runtime`**: Transient execution state and diagnostics (including run profile state).

---

## 3. Hook Surfaces

Key narrative lifecycle hook points:
- `HOOK_NARRATIVE_START`
- `HOOK_FOUNDATION_START`
- `HOOK_PRE_ORCHESTRATOR`
- `HOOK_PRE_WRITER`
- `HOOK_POST_WRITER`

`HOOK_PRE_ORCHESTRATOR` is the final opportunity to inject into `promptComponents.root`. Later root injections are rejected to protect prefix identity. Agent-specific injections remain valid in `director` or `writer` targets.

Capability plugins should pair these with post-VN phase resolution logic described in `narrative/scene_phases.md`, so interception decisions rely on resolved phase ownership instead of raw prose guesses.
