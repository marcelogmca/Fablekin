# 6. After Prose: Validation, Extraction, and the Next Better Prompt

## Post-processing is not merely presentation

Once the Writer has generated prose, Fablekin runs a second family of prompts. From a pure prompt-engineering perspective, their purpose is to turn an ephemeral chapter into reliable, structured future context—and to protect the delivered text from a narrow class of costly errors.

The key distinction is between two kinds of post-writer model:

| Type | Question it answers | Effect on the story loop |
| --- | --- | --- |
| Validator | “Is this specific current draft wrong in a repairable way?” | can minimally correct the current chapter |
| Extractor/classifier | “What durable information did this chapter establish?” | informs future prompts, not retroactive prose |

This separation prevents a common failure: using a broad “improve this writing” pass that changes character voice, expands scenes, or reverses intentional ambiguity after the Writer has finished.

## Post Writer Consistency Checker: a narrow corrective editor

The consistency checker receives the Writer's original prompt messages, Writer output, and only the tagged current draft. Its prompt sharply limits jurisdiction:

- validate/fix **only** text inside `<draft_to_validate>`;
- treat earlier material as context, never as a patch target;
- repair appearance, player-action attribution, setting/technology inconsistencies, certain clichés, and malformed VN speaker labels;
- use minimal SEARCH/REPLACE patches;
- do not embellish or judge general writing quality.

Its low-temperature configuration and limited output budget fit this job. More importantly, patch application has safety constraints: only accepted local matches are applied, fuzzy changes are checked, and dialogue-count drift is capped. Prompt output is therefore advisory unless it can be safely grounded in the actual script.

The cliché audit intentionally mirrors Writer-side constraints: wall metaphors, identity-reset monologues, “real” clichés, and generic sensory clichés are caught again. The repeated guard is justified because the Writer's planning rules reduce risk; they cannot guarantee a long completion will never fall into a high-probability phrase.

## Dialogue processing creates a second representation of the chapter

The Dialogue Processor turns prose into a VN script. Its prompt preserves all content while separating spoken dialogue from narration, stripping redundant dialogue tags but retaining physical action beats. It also removes non-narrative/system text and applies TTS-friendly normalization.

This is prompt engineering in service of a representational contract. The Writer can write natural prose; the rest of the experience receives explicit `Character: dialogue` lines and discrete narration. Separating a tag like “she whispered” from an action like “she looked away” gives the visual/voice layers something they can use without losing causal motion.

The speaker-label audit in the consistency checker protects this contract. In a VN parser, anything before a colon may be read as a speaker. A poetic phrase accidentally shaped like `Storm far away:` can become a phantom character; the checker detects and minimally repairs that before downstream systems are confused.

## Emotion and cinematography are constrained interpretation passes

Emotion classification works line by line with a local allowed emotion list. It is told to preserve order, never skip a line, and select only from the permitted expression vocabulary. It separately labels overall mood, with a conservative rule against calling ordinary irritation “angry.”

The Cinematographer runs a silent beat-based planning workflow. It divides a scene at meaningful changes, maintains a ledger of environment/visible characters/persistent effects, places only purposeful commands, and uses whitelisted grammar. Its camera pass asks it to hold framing until a beat changes rather than toggling on every line.

These are good examples of **constrained secondary interpretation**. The prompts are not trying to improve the plot. They translate an already-written scene into camera, sprite, animation, VFX, and SFX choices while preserving script evidence and avoiding invented conditions. The outcome can make prose feel stronger because presentation follows the emotional logic already established by the Writer.

## World-state extraction turns prose into physical continuity

World State Tracker is one of the deepest post-writer prompts. It reads indexed VN lines, previous state, location clues, background-selector signals, prior Director feedback (only advisory), and project directives. It returns indexed events for time, weather, climate, safety, crowd density, inventory, and optionally rare world-level recalls.

Its temporal audit is especially rigorous. It distinguishes:

- party-current timestamps from offscreen timestamps;
- relative time from retrospective references;
- ordinary action duration from sleep/overnight jumps;
- real travel time from a mention of travel;
- ambient cues from explicit temporal anchors.

It then requires the sum of event durations to make sense against the latest party time. This extraction prompt is the evidence source that gives the *next* Writer a trustworthy answer to “what time is it and how did we get here?” The Writer's logistics checklist and the extractor form a closed loop: one asks for realism; the other converts achieved realism into durable state.

## Relationship extraction records subtext, not only declarations

Relationship Tracker’s post-writer prompt explicitly asks for passive shared experience, subjective appeal, early “sprouting” connection, specific catalysts, and symmetric small changes. It can record durable relationship recalls such as admiration, attraction catalysts, boundaries, value alignment, or interpretive bias.

The prompt guards against two errors:

1. requiring a dramatic confession before a bond can change; and
2. treating generic one-off NPCs as relationship ledger entries.

Because later Writer context is a synthesized active relationship state, small scene moments can become visible social continuity without forcing every new chapter to recount the original moment.

## Personality extraction records durable inner cues with a strict budget

Personality Tracker evaluates named target characters for small trait deltas, grounded in the current scene. Its more interesting feature is the rare `_character_recall`: at most three total, at most one per character, only for durable future-useful cues like preferences, fears, desires, boundaries, coping style, values, habits, and insecurities.

It explicitly excludes direct attraction and pair-specific admiration from personality recall; those belong in Relationship Tracker. This is information hygiene at the prompt level. A future Writer benefits when “this character dislikes crowded rooms” and “this character admires that person’s calm” are stored in different semantic homes.

## Summary and synopsis create controlled forgetting

Post-chapter summary prompts reduce a chapter to its long-term plot advancement, relationship shifts, and discoveries. Synopsis prompts produce a literal title, a thematic title, and a maximum-fifty-word account of essential actions and location changes.

This is not a compromise after memory has failed. It is how the system chooses what *not* to carry verbatim. The later memory-LOD prompt can use detailed recent prose, summaries for nearby continuity, and tiny synopses for distant arc navigation. Controlled forgetting is what lets long-running stories remain promptable.

## Scene-phase classification gives the next Director pacing evidence

The scene-phase evaluator receives the generated chapter, current Director Brief, registered event capabilities, event gate, recent history, capability cadence report, and previous advisories. It asks whether the ending opens a real unresolved playable boundary for at most one capability—not merely whether the setting contains an inn, a threat, or travel.

It checks interruptibility and capability temperature:

- **hot**: recently activated; weak repeats should be suppressed;
- **warm**: neutral;
- **cold**: a small encouragement only if the scene already fits.

It can return a short observational advisory for the next Director, particularly if pacing is repetitive or an event handoff would interrupt an active beat. The next Director treats this advisory as evidence to re-evaluate, not an irreversible order.

This is a sophisticated feedback loop. The writer is not asked to manufacture game modes; the post-writer classifier assesses whether the prose *earned* one, and the next Director can use that diagnosis to avoid habitual chapter endings.

## The chapter-to-chapter learning loop

The full prompt loop can be expressed as:

```text
Writer prose
  ├─ minimal validator repairs local, high-confidence mistakes
  ├─ dialogue/emotion/cinematography interpret the delivered scene
  ├─ state/relationship/personality/quest extractors create durable evidence
  ├─ summaries and synopses compress it for future retrieval
  └─ pacing classifier writes a re-evaluable note for the next Director

Next chapter
  └─ shared foundation and Director brief selectively reintroduce that evidence
```

The powerful idea is that no single next prompt must reread and rediscover everything. Each specialist converts one aspect of the chapter into a compact future affordance: a fact, a bond, a behavior cue, a consequence, a pacing warning, or a memory capsule.

## Final assessment: why the output can feel unusually alive

Fablekin’s strongest outputs are the product of repeated **translation** rather than a single act of generation:

1. raw player language becomes an attempted action;
2. shared history becomes a Director’s selective pressure;
3. pressure becomes a Writer’s concrete beat map;
4. prose becomes a validated VN script;
5. script becomes structured memory and a pacing diagnosis;
6. memory becomes the next chapter’s evidence.

The system succeeds when each translation loses the right information. The Writer is protected from raw ledgers and spoiler-heavy plans; the Director is protected from having to write prose; the extractors are protected from broad stylistic authority; and future prompts receive compact, relevant knowledge rather than the entire past. That is the central prompt-engineering reason Fablekin can ask a Writer to juggle so much and still produce chapters that feel intentional.
