# 5. Prompt-Facing Plugins: Specialized Minds Around the Writer

## The plugin principle

Fablekin's plugins are not all equal from a prompt-engineering perspective. Some alter presentation; some maintain facts; some inject context or alter the questions an agent must ask. This document focuses on the latter: plugins that either change the Director/Writer prompt or produce durable prompt material for later chapters.

The elegant pattern is **specialize upstream, write downstream**. A tracker or planner can use a narrow prompt to make one kind of judgment well, then pass a concise, role-appropriate result to the generative agents.

## Direct prompt contributors

| Plugin | Prompt contribution | Why it improves output |
| --- | --- | --- |
| Character Sheets | active character canon; possible Writer hard-priority directive | gives visual/persona continuity a trusted source |
| Lore Book | triggered lore in shared/private canon or dynamic knowledge | brings only relevant lore into attention |
| Memory Recall | targeted dynamic-memory block | revives old emotional/plot facts without full-history bloat |
| World State Tracker | current simulation snapshot | anchors time, weather, safety, crowd, inventory |
| World Location Tracker | location/travel state and movement constraints | prevents impossible teleportation and inert journeys |
| Relationship Tracker | active relationship snapshot | makes social reactions reflect an evolving bond |
| Personality Tracker | behavior summaries for relevant characters | converts longitudinal change into playable voice/action guidance |
| Quest Tracker | Director and Writer consequence reminders | makes resolution/failure leave a narrative mark |
| Grand Story Planner | Director plan/execution brief; Writer editorial card | adds long-range steering while protecting spoilers |
| Output Size Controller | Writer thinking-step insertions | makes desired scale/dialogue density explicit before prose |

## Character Sheets as prompt composition, not just data display

When active, Character Sheets takes responsibility for combining character-related context. Its output goes into shared canon and may include Writer-facing hard priorities. Relationship and Personality Tracker recognize that ownership and skip their global injections to avoid duplicate context.

This is a prompt-quality feature. The model sees one coherent per-character block instead of several overlapping, independently phrased statements that may conflict in salience. It also supports the Writer's “source of truth” visual-lock check.

## Lore Book and Memory Recall: relevance before volume

Lore Book evaluates triggered entries and routes them intentionally: shared canon, shared dynamic knowledge, Writer-private dynamic knowledge, or Director-private dynamic knowledge. That routing lets a lore item be treated as universally binding fact, current situational information, a prose-relevant detail, or planning-only material.

Memory Recall injects a dynamic recall context after prompt building. It is a companion to fixed history tiers: history maintains local sequence, while recall makes distant but semantically relevant detail retrievable. The Writer framework's instruction to select only one to three critical memories provides a final attention budget.

## Relationship and personality trackers: convert prose into future portrayal constraints

Relationship Tracker synthesizes only active/recent participants and provides an `active_relationships` prompt snapshot. Personality Tracker does the equivalent for behavioral profile and development. Both deliberately use natural-language syntheses rather than expecting the Writer to reason from raw rows of facts.

Their prompt roles differ:

- relationship context answers, “What does this pair mean to each other right now?”
- personality context answers, “What recurring tendencies and changes should shape this person's behavior?”

Together they let a scene respond to both **the relationship** and **the individual**, preventing a common failure in RP systems where every warm interaction sounds the same regardless of who is speaking.

## World State and Location: constraints that create narrative texture

World State Tracker feeds a state snapshot into shared simulation and can add a one-turn inventory disposal reminder. World Location Tracker adds current location, navigation assistance, and a direct Writer constraint when movement must be manual.

These plugins are prompt engineering because they make logistical truth highly available at decision time. They also change the Writer's creative menu. If the party is in transit, the Writer framework is encouraged to write the journey rather than skip it. If current time is late, a rest or fatigue beat becomes plausible. If a location change requires actual movement, the model must build a scene that earns it.

## Quest Tracker: outcomes must remain consequences

Quest Tracker routes progress and immediate consequence briefs to the Director and Writer and adds a focused Director thinking step. Its instruction is deliberately narrow: do not simply list active quests; route completed, failed, expired, or dropped outcomes into immediate orders when they affect the scene.

This avoids turning the novel into a quest-log recital. The prompt asks the Writer to dramatize consequences, not repeat metadata.

## Grand Story Planner: long-range intent without Writer spoilers

Grand Story Planner illustrates the strongest use of private pillars. It can give the Director a full strategic plan or a focused execution brief, explicitly telling the Director not to reveal plan contents directly to the Writer. It can also give the Writer a much smaller editorial card and insert a Writer-CoT step after feedback decomposition.

Its added Director question is exemplary: decide whether a relevant long-range pressure should be ignored, seeded, advanced, protected, or converted into a mandatory order. That language preserves local naturalness. A long plan is not a script to dump; it is a source of selective pressure.

## Output Size Controller: size is planned, not bolted on

Output Size Controller inserts Writer-thinking instructions for target length and a final quantity check. It can express word/line targets and a minimum dialogue-line expectation in the Writer's planning phase.

The quality benefit is less about “more words” than about avoiding accidental structural mismatch. A long chapter needs enough beats, dialogue turns, and scene movement to justify itself. Asking for length after the Writer has planned a tiny exchange encourages filler; asking during its audit makes it expand the beat map deliberately.

## Prompt extensions can alter reasoning, not only context

Two extension mechanisms matter:

1. **Director CoT patches** can add, override, or disable named reasoning steps. The Director's thought procedure becomes plugin-extensible.
2. **Writer CoT insertions** can be inserted after a numbered original step or appended, then renumbered. A plugin can request a focused audit without rewriting the native workflow.

This is more disciplined than endless appended prompt text. A plugin says where in the decision sequence its concern belongs—before or after interpreting feedback, during world checks, or before the final quantity check.

## Plugins should not all become Writer commands

The system's best routing choices preserve the Writer's attention:

- stable truth → canon/simulation;
- planning-only truth or spoilers → Director-private context;
- immediate execution requirement → Writer directive;
- optional long-term idea → Director thread, then selectively passed onward;
- post-chapter observation → next-turn advisory, not a retroactive rewrite of prose.

This hierarchy is why Fablekin can support a broad ecosystem without every plugin shouting at the Writer at once.
