# 1. Prompt Topology: a Shared Novel, Two Different Jobs

## The core pattern: shared evidence, role-specific cognition

Fablekin begins by assembling one shared narrative foundation for both Director and Writer. It contains:

- project protocol and user-authored directives;
- canon and retrieved lore;
- dynamic knowledge such as memory recall;
- narrative history at chosen fidelity levels;
- current simulation/state; and
- the prior chat messages where relevant.

The foundation labels its materials carefully. The shared contract says that user narrative directives govern behavior, while canon/history/simulation are reference data rather than role instructions. A second “directive interpretation lock” establishes that the final task suffix decides the role: shared material cannot accidentally turn the Director into a Writer, or vice versa.

That is a subtle but consequential anti-prompt-confusion measure. A large fiction prompt contains quoted dialogue, lore instructions, old notes, and possibly user-authored text that resembles commands. Fablekin distinguishes *what is true in the fiction* from *what the active model must do now* before either agent starts reasoning.

## The prompt as a hierarchy, not a flat paste

Context is placed in a six-slot registry under three pillars:

| Slot | Prompt-engineering meaning |
| --- | --- |
| `protocol` | behavioral or output rules |
| `canon` | durable facts and character truth |
| `dynamic_knowledge` | retrieved or current knowledge likely relevant now |
| `simulation` | live state: place, time, inventory, relationships, etc. |
| `history` | previous narrative events |
| `directives` | immediate steering and constraints |

`root` is shared. `director` and `writer` are private overlays. This routing lets the system express three different intents without ambiguity:

1. “Both agents must know this fact.”
2. “Only the Director should use this to make a strategic choice.”
3. “Only the Writer should treat this as a local execution constraint.”

For example, the Grand Story Planner may place a spoiler-sensitive strategic card in Director-private simulation and a short editorial card in Writer-private directives. The Director can protect a future reveal without showing the Writer the entire future plot. That prevents the prose model from treating long-range plans as an excuse to prematurely announce them.

## Why both agents see the same ground truth

The Director does not summarize a separate, weaker version of the novel. Both models begin from the same frozen shared prefix. The Writer therefore has direct access to canon, retrieval, history, and current state rather than relying on a lossy Director paraphrase. The brief is a *lens*, not a replacement for evidence.

This yields a useful division of labor:

```text
Shared evidence       → What actually constrains the chapter
Director brief        → What deserves attention now, and why
Writer thinking plan  → How to execute it in a playable scene
```

The Writer can reject accidental or overbroad implications of a brief when they conflict with visible context, player agency, or character integrity. Conversely, the Director can emphasize a dormant continuity item that raw recency-biased context might otherwise leave unnoticed.

## The current action is reframed as an attempt

The Writer does not receive a bare user message. In ordinary chapter mode, the current action is converted into language equivalent to:

> All following actions are performed by [character]. [Character] attempts to [action]. It can be successful or not; it must make sense in context. Narrate the outcome directly.

This one transformation does a surprising amount of narrative work:

- It preserves player agency at the level that matters: the player gets to attempt an action and speak a line.
- It removes the model's default pressure to grant the requested outcome.
- It makes failure a story event rather than a refusal.
- It forces the NPCs/world to react causally, which is essential for a world that does not feel like a wish-fulfillment chatbot.

The Director reinforces the same principle with an explicit anti-sycophancy audit, particularly around consent, social boundaries, and implausible compliance. The two layers make “the world pushes back” a repeated operating rule rather than an occasional stylistic preference.

## The Director-to-Writer handoff is an editorial compression

The Director produces three sections, but only one is handed to the Writer: `WRITER_BRIEF`. Its required substructure separates different strengths of instruction:

| Brief section | Intended force |
| --- | --- |
| Scene Review | orienting assessment |
| Mandatory Orders | immediate must-execute constraints |
| Narrative Threads | use one or two naturally; do not force all |
| Mysteries Not to Reveal | hard spoiler guardrails |
| Writing Critiques | craft constraints rather than plot commands |

This is an excellent compression format. It stops the Writer from receiving the Director's raw audit, IDs, statistical thinking, scratchpad language, or ledger maintenance details. The Writer gets actionable narrative language instead of implementation-shaped residue.

The Writer's own framework explicitly parses this brief, extracts only actionable signals, classifies them, assigns priority, and detects conflicts. Its priority order is: mandatory orders, then character integrity, then player intent, then writing critiques as craft constraints, then flavor. That ordering is the system's conflict-resolution policy in natural language.

## Why the Writer can carry a huge burden

The Writer is indeed asked to track a great deal: user dialogue and action, physical plausibility, continuity, NPC motivation, relationship state, visual facts, familiarity, world logistics, pacing, visual-novel formatting needs, and Director direction. Fablekin makes this tractable through four prompt patterns:

1. **Chunk the burden by cognitive type.** The Writer sees separate steps for reality, social interpretation, character mindset, visual continuity, logistics, scene structure, and audits. It need not invent its own organizational scheme mid-generation.
2. **Turn vague qualities into checks.** “Keep characters consistent” becomes objectives, emotional state, knowledge gaps, private motivation, visible locks, and a final re-check.
3. **Distinguish hard constraints from optional seeds.** A model cannot satisfy every narrative possibility equally. The brief and framework tell it what must happen, what should shape prose, and what may be omitted.
4. **Plan before surface realization.** The locked beat map prevents a long prose completion from wandering away from constraints placed early in context.

This is not simply more prompting. It is a deliberate reduction of search space: the model is told what questions to answer, then asked to write inside the resulting decisions.
