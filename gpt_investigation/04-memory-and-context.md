# 4. Memory and Context: Giving the Model the Right Past at the Right Resolution

## Memory is prompt selection, not archival completeness

For a long narrative, the question is not “does the system remember?” It is “which version of the past should the model see for this scene?” Supplying every chapter verbatim eventually buries the current action; supplying only a short summary destroys emotional specificity and setup/payoff.

Fablekin answers with explicit memory levels of detail:

| Tier | Best use in a prompt |
| --- | --- |
| Full text | immediately relevant voice, action, emotional texture, and exact commitments |
| Summary | recent plot and relationship movement |
| Synopsis | distant navigation and thematic continuity |
| Arc compression | old stretches reduced to a strategic narrative capsule |

The default compressed-history presets illustrate the strategy. A brief context can contain five summaries and ten synopses; a balanced context adds one full chapter, ten summaries, and twenty synopses; a deep context reaches two full, sixteen summary, and forty synopsis chapters. These are not merely token limits. They encode the belief that recency needs texture while distance needs orientation.

## History has several routes into the Writer's attention

Fablekin's history prompt is not one monolith. It can include a selected narrative stream, chat history, a summary history block, retrieved older chunks, and interlude capsules. This supports different kinds of recall:

- **continuation recall**: what just happened and how it sounded;
- **semantic recall**: an old but relevant moment found through the current action/entities;
- **ledger-like recall**: state facts that must remain true;
- **compressed arc recall**: why old events still matter even when their scenes are no longer verbatim.

The Writer framework then adds a cognitive instruction to recall only one to three critical past promises, turning points, or emotional events for the current scene. This avoids the opposite failure—trying to reference every memory and producing fan-servicey callbacks.

## Retrieval is contextual rather than indiscriminate

Static lore can be embedded and queried against the user prompt plus extracted entities. The result is placed in `dynamic_knowledge` as retrieved world knowledge. The distinction matters: retrieved text is highly relevant evidence, but it is not automatically treated as an immediate order.

The Lore Book follows the same idea more explicitly. Its triggered entries can be routed into shared or private canon/dynamic-knowledge slots. The prompt therefore receives lore because it matches the present input, rather than because every item in a bible is permanently pasted into every chapter.

This design protects instruction clarity. If all lore were an enormous shared prompt, the Writer could miss the one rule that matters now. If nothing were retrieved, it would improvise. Selective injection gives the model a smaller factual surface to reconcile.

## Character sheets make continuity actionable

The Character Sheets plugin assembles active character context and injects it into shared canon. It can also issue a Writer-private hard-priority directive. Its value is not simply a biography database. It converts a character into prompt-ready constraints, including identity/appearance and, where available, behavioral layers assembled from other trackers.

This is why the Writer's visible-continuity audit has something reliable to compare against. “Do not invent when unsure” is powerful only when the prompt also contains a credible source for known details.

Character-sheet context also replaces duplicate global relationship/personality injection when that plugin is active. From a prompt perspective, deduplication matters: repeating a relationship fact in canon, simulation, and directives can accidentally make it feel like three independent instructions or overweigh it relative to more immediate information.

## Relationship state is an interpretive frame, not a romantic command

The Relationship Tracker synthesizes targeted active bonds—usually the player and recent party members—and injects an `active_relationships` snapshot into shared simulation. Its model is symmetric: the bond is between two people, rather than a one-sided claim that one person secretly feels something.

The prompt effect is that dialogue gets a usable current dynamic: tense allies, old rivals, growing trust, etc. The Writer still has to interpret present actions and boundaries. In particular, the Director's consent audit prevents a high trust score or a shared trauma from being misread as entitlement to romance.

Relationship evolution also uses rolling consolidation. Prompt-wise, this is a way to preserve an arc without sending every tiny vector change forever. The Writer sees a meaningful current dynamic rather than a noisy transaction log of all previous interactions.

## Personality state turns numbers into behavior

Personality tracking can establish and evolve multiple trait vectors, but the Writer is not expected to reason directly from a table of numbers. The tracker produces natural-language programmatic summaries and development ledgers, then injects snapshots for relevant characters into simulation (or lets Character Sheets embed them in the character context).

This is the correct abstraction boundary for a prose model. “High neuroticism: 72” is weak literary guidance; “guarded under pressure, deflects intimacy with practical objections, recently less certain of their old certainty” is usable scene behavior. The tracker’s rolling ledger keeps long-term change legible without inviting the Writer to flatten someone into a permanent trait score.

## World state turns logistics into story pressure

World State Tracker prompt context contains concrete current state—time, weather, safety, crowd density, and important inventory—in a form the Writer and Director can consult. World Location Tracker adds current place, travel/navigation assistance, manual-movement constraints, and pending time-skip direction where applicable.

Their most important effect is negative: they deny the language model convenient but false shortcuts. It cannot casually arrive at a far destination, move a party without an action, forget a lost item, or let midnight behave like noon without reconciling the state block. These constraints make the Writer's logistics step evidence-backed rather than aspirational.

## Prompt snapshots make interludes inherit a real narrative moment

Interludes restore selected canon, dynamic-knowledge, and simulation components from the parent chapter’s Writer prompt snapshot. In prompt terms, this means an interlude is not rebuilt from a weaker generic context. It inherits the narrative world as it was understood at the parent chapter, then applies its specialized current action.

That helps small side scenes feel like facets of the same chapter instead of detached mini-stories. It is a prompt-continuity mechanism: preserve the exact relevant foundation without asking the model to reconstruct it from a database-shaped history.

## The shared prefix is also a consistency promise

The shared Director/Writer prefix is assembled once per chapter and frozen. While this has performance implications, the prompt-engineering implication is more important: both roles deliberate over the same version of canon/history/state. The Director cannot plan against one mutable context while the Writer receives another.

The result is a clean contract:

```text
Shared foundation: stable evidence for this chapter.
Director-private material: strategic leverage and spoiler protection.
Writer-private material: execution constraints and local creative guidance.
```

That stability is a quiet contributor to perceived coherence. A chapter feels intentional when planning and prose are answering the same story, rather than neighboring approximations of it.
