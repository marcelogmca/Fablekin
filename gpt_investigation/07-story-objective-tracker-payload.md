# 7. Story Objective Tracker: Exact Prompt Payload Deconstruction

## Scope and measurement method

This document describes the request created by the active **Story Objective Tracker** (`quest_tracker`) in this workspace. Its configured model inherits `vn_background`, so it uses the shared post-turn prompt route.

All token figures below use Fablekin's own context-budget estimator: **`ceil(characters / 4)`**. They are accurate for internal budgeting, but not exact provider-tokenizer counts; a provider tokenizer will vary somewhat by model and punctuation. Dynamic fields are therefore expressed as formulas and bounded chapter counts rather than invented totals.

## The actual message array sent to the LLM wrapper

```text
1. system: BACKGROUND_SYSTEM_PROMPT
2. user:   immutable shared VN background capsule
3. user:   Story Objective Tracker suffix
```

The Tracker does **not** send a bare `[{ role: 'user', content: pluginPrompt }]` request in the configured path. That fallback path is used only when its model is changed away from `inherit: "vn_background"`.

## Master hierarchical payload table

This is the consolidated view of the complete configured request. “Likely usage” estimates token footprint on a mature, late-game turn—not importance to the objective-tracking decision.

- **Low:** usually under ~250 tokens.
- **Medium:** usually ~250–1,000 tokens.
- **High:** usually ~1,000–5,000 tokens.
- **Very high:** commonly above ~5,000 tokens or an uncapped aggregate capable of occupying a dominant share.

These bands are analytical, not hard runtime limits. Exact dynamic usage is `ceil(actual characters / 4)` under Fablekin's estimator.

| Message | Section | Subsection | Detailed payload breakdown | Exact source / producer | Inclusion and growth behavior | Token accounting | Likely usage | Objective Tracker relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1 — System** | Shared task framing | Post-turn specialist role | Declares the model a post-turn analysis specialist; marks Message 2 as immutable authoritative context; says Message 3 defines the actual task and output contract. | `BACKGROUND_SYSTEM_PROMPT` in `background_llm_cache.js` | Always present on the inherited VN-background route. | **273 chars / 69 est. tokens** | **Low** | Essential role separation, but no story evidence. |
| **2 — Shared capsule** | **Whole message** | **Aggregate shared context** | Project identity, input, Director Brief, canon, dynamic knowledge, simulation, history, raw Writer chapter, and processed dialogue. This is the cacheable common prefix shared by post-turn plugins. | `buildBackgroundCapsule(turnContext)` | Always present; nearly every field is dynamic. On the stated late-game example it plausibly contributes ~70% of a 45k request. | **~31.5k tokens in the stated 45k/70% example**; otherwise `96 + ceil((U+B+C+K+S+H+W+D)/4)` | **Very high** | The overwhelming evidence base. |
| 2 — Shared capsule | Capsule envelope | Labels and delimiters | `SHARED VN BACKGROUND CONTEXT`, section headings, end delimiter, and empty fallback markers. | `background_llm_cache.js` template | Always present. This figure excludes all real values. | **381 chars / 96 est. tokens when empty** | **Low** | Structural navigation only. |
| 2 — Shared capsule | Metadata | Project / turn / player / party | Project name, chapter number, player-character name, and extracted current party names. | TurnContext and `output.party` | Always has fallbacks; party grows only by names. | Usually tens of tokens | **Low** | Identifies actors and timeline scope. |
| 2 — Shared capsule | Current input | Raw user prompt | The current player's message before the Writer's prose. | `turnContext.input.userPrompt` | One current input; no hard length cap here. | `ceil(U/4)` | **Low–Medium** | Strong direct evidence for newly stated, selected, promised, or abandoned objectives. |
| 2 — Shared capsule | Director Brief | Scene Review | Director’s compact situational assessment of the story immediately before the generated chapter. | `processed.director.writerBrief` | Present when Director runs; size depends on Director output. | Part of `ceil(B/4)` | **Medium** | Contextual, but cannot create objectives without story-visible evidence. |
| 2 — Shared capsule | Director Brief | Mandatory Orders | Immediate behavior, consequence, boundary, continuity, or scene instructions passed to Writer. | Director plus Director-facing prompt contributors | Variable and potentially dense. | Part of `ceil(B/4)` | **Medium–High** | Useful for interpreting intent, but the Tracker must judge the resulting chapter rather than treat an unexecuted order as fact. |
| 2 — Shared capsule | Director Brief | Narrative Threads | One-or-two-at-a-time long-range seeds supplied to Writer. | Director, possibly influenced by planner, quest, state, and other private inputs | Variable; contains plans that may remain unrealized. | Part of `ceil(B/4)` | **Medium** | Low evidentiary authority for objective creation; explicit Tracker rules reject hidden/future plans. |
| 2 — Shared capsule | Director Brief | Mysteries / Writing Critiques | Spoiler guardrails and prose/pacing warnings. | Director | Usually compact. | Part of `ceil(B/4)` | **Low–Medium** | Mostly irrelevant to HUD state; included because the capsule is shared across plugins. |
| 2 — Shared capsule | **Selected Canon** | **Whole `root.canon` aggregate** | All shared canonical reference blocks assembled for the chapter. In cast-heavy projects, character sheets plus static lore can rival history. | `turnContext.promptComponents.root.canon` | Dynamic, additive, and not governed by one total token cap. | `ceil(C/4)` | **Very high** | Provides names and factual interpretation, but canon alone cannot create a player-facing objective. |
| 2 — Shared capsule | Selected Canon | Static `full` Markdown | Entire selected Markdown files, wrapped as `world_lore`. Directives and Chronicles are routed/skipped separately. | `_gatherStaticFiles()` | Every eligible selected `full` file outside excluded zones; no aggregate cap. | Sum of raw selected file lengths / 4 | **High–Very high** | Canonical setting/plot facts; only story-visible activation should become an objective. |
| 2 — Shared capsule | Selected Canon | Static `summary` Markdown | LLM-generated summary of a selected source file, wrapped as `world_lore`. | SummarizationService via `_gatherStaticFiles()` | One summary per selected summary-mode file. | Sum of summary text / 4 | **Medium–High** | Lower-cost world/canon orientation. |
| 2 — Shared capsule | Selected Canon | Player biography | Player name and biography as a shared `player_character` block. | `injectPlayerBioContext()` | Omitted when empty; Character Sheets clears/absorbs player bio to avoid double injection. | Biography length / 4 | **Low–Medium** | Helps distinguish player identity from NPC/objective names. |
| 2 — Shared capsule | Selected Canon → Character Sheets | Aggregate wrapper | Every rendered full sheet, player capsule, and relevant light capsule is joined and wrapped as `<character_sheets>`. | `handlePromptInjectionHook()` | Present when Character Sheets runs and has material. | Sum of all sheet/capsule rows below | **Very high** | Large shared reference body; usually contextual rather than direct objective evidence. |
| 2 — Shared capsule | Selected Canon → Character Sheets | Core-sheet selection | Every selected file in `charsheet` mode becomes a full `PYRAMID OF PERSONA` sheet. No per-core-sheet prompt injection cap exists. | `processCoreSheetsHook()` and current turn's `character_sheets.sheets` | Linear growth with selected core cast; populated fields only. | `Σ ceil(core sheet chars/4)` | **Very high** | Can dominate canon on a core-cast-heavy project. |
| 2 — Shared capsule | Character core sheet | Layer 0 — High-Level Summary | Identity, gender, world role, overall vibe, and quick-start essence. Immutable baseline. | `CHAR_SHEET:BIOGRAPHY` | Present if populated. | Usually short paragraph; no hard output cap | **Medium per cast aggregate** | Identifies who may own or issue an objective. |
| 2 — Shared capsule | Character core sheet | Layer 1 — Physical Appearance | Hair, eyes, height, build, marks; excludes temporary injuries/outfits. Immutable and `priority=hard`. | `CHAR_SHEET:PHYSICAL_APPEARANCE` | Present if populated; also repeated into Writer-private hard continuity, but that repetition is outside Message 2. | Usually paragraph-scale | **Medium per cast aggregate** | Nearly irrelevant to objective tracking, but included through shared caching. |
| 2 — Shared capsule | Character core sheet | Layer 2 — Expression Layer | Speech cadence, vocabulary, tics, posture, demeanor, signature gestures, resting face. Immutable. | `CHAR_SHEET:EXPRESSION_STYLE` | Present if populated. | Paragraph-scale | **Medium per cast aggregate** | Low direct objective relevance. |
| 2 — Shared capsule | Character core sheet | Layer 3 — Current Context | Character whereabouts and immediate activity. Managed by World Location Tracker when active. | `CHAR_SHEET:CURRENT_CONTEXT` | Present if populated; may semantically overlap location simulation. | Short paragraph | **Low–Medium** | May confirm that a character is engaged in an unresolved visible task. |
| 2 — Shared capsule | Character core sheet | Layer 4 — Personality Blueprint | General disposition plus OCEAN profile and mental model for core characters. Managed by Personality Tracker. | `CHAR_SHEET:PERSONALITY_PROFILE` | Present if populated. Separate Personality root-simulation injection is suppressed while Character Sheets is active. | Can be several paragraphs | **High per cast aggregate** | Contextual; cannot itself establish a goal. |
| 2 — Shared capsule | Character core sheet | Layer 5 — Affinities & Preferences | Durable likes, dislikes, aversions, comfort cues, interests, person-specific affinities, and demonstrated/stated contradictions. | `CHAR_SHEET:AFFINITIES_PREFERENCES` | Mutable; **1,200-char soft target**, not hard truncation. | Up to ~300 tokens near soft target | **Medium–High per cast aggregate** | May clarify motive but is not objective evidence alone. |
| 2 — Shared capsule | Character core sheet | Layer 6 — Competence and Knowledge | Masteries, ignorance, technical/cultural knowledge boundaries, street versus formal intelligence. | `CHAR_SHEET:KNOWLEDGE` | Mutable; **1,600-char soft target**. | Up to ~400 tokens near soft target | **Medium–High per cast aggregate** | Helps interpret whether a visible objective or solution is plausible. |
| 2 — Shared capsule | Character core sheet | Layer 7 — Relationships | Known connections and current relationship status. Managed by Relationship Tracker. | `CHAR_SHEET:SOCIAL_CONNECTIONS` | Present if populated. Separate Relationship root-simulation injection is suppressed while Character Sheets is active. | Potentially long with cast size | **High–Very high per cast aggregate** | Can disambiguate obligations, but relationship pressure is not automatically a HUD objective. |
| 2 — Shared capsule | Character core sheet | Layer 8 — Character Arc & State | Emotional journey and current story involvement. | `CHAR_SHEET:NARRATIVE_ARC` | Mutable; **1,400-char soft target**. | Up to ~350 tokens near soft target | **High per cast aggregate** | High risk of containing thematic/planning-like prose; Tracker rules require visible evidence before goal creation. |
| 2 — Shared capsule | Character core sheet | Layer 9 — Background Lore | Personal history, upbringing, and important lore events. Immutable. Schema requests **300–1,000 words**. | `CHAR_SHEET:BACKGROUND_LORE` | Present if populated; no runtime truncation in display injection. | Roughly ~400–1,300+ tokens per full character depending tokenizer/text | **Very high** | One of canon's largest fields; mostly historical context. |
| 2 — Shared capsule | Character core sheet | Layer 10 — Clothes | Default wardrobe, owned outfits, clothing, and accessories; excludes temporary state. Immutable. | `CHAR_SHEET:OUTFITS_ACCESSORIES` | Present if populated. | Variable paragraph/list | **Medium per cast aggregate** | Usually irrelevant to objectives. |
| 2 — Shared capsule | Character core sheet | Layer 11 — Appearance & Outfit Continuity | Story-learned appearance, current outfit changes, grooming, injuries, scars, dirt, blood, damage, and precise temporary/persistent visual state. | `CHAR_SHEET:APPEARANCE_CONTINUITY` | Mutable; **1,200-char soft target**. | Up to ~300 tokens near soft target | **Medium–High per cast aggregate** | May substantiate consequences, rarely objectives. |
| 2 — Shared capsule | Character core sheet | Layer 12 — Real Voice Line Examples | Up to six representative dialogue examples. Immutable. | `CHAR_SHEET:VOICE_SAMPLES` | Present if populated; multiplied across core cast. | Commonly hundreds of tokens per character | **High per cast aggregate** | Little objective value; meaningful cost inherited from shared prompt. |
| 2 — Shared capsule | Character core sheet | Layer 13 — Core Motivator | Past-shaped drive, conflict between need and desire, and three core values. | `CHAR_SHEET:CORE_MOTIVATION` | Mutable; **1,000-char soft target**. | Up to ~250 tokens near soft target | **Medium–High per cast aggregate** | Motive context only; Tracker explicitly rejects converting hidden motive into a goal. |
| 2 — Shared capsule | Character core sheet | Layer 14 — Paradox & Trajectory | Public mask/private reality, contextual cracks, and evolutionary arc. | `CHAR_SHEET:PARADOX_EVOLUTION` | Mutable; **1,400-char soft target**. | Up to ~350 tokens near soft target | **High per cast aggregate** | Mostly portrayal/planning context, not visible objective evidence. |
| 2 — Shared capsule | Character core sheet | Layer 15 — Intimacy Profile | Romantic dynamics, relationship paradigm, attraction catalysts, threshold, affection style. | `CHAR_SHEET:INTIMACY_PROFILE` | Mutable; **1,200-char soft target**. | Up to ~300 tokens near soft target | **Medium–High per cast aggregate** | Usually irrelevant to objective tracking; cannot imply a quest. |
| 2 — Shared capsule | Character core sheet | Layer 16 — Dynamic Engine | Stress/regression versus integrated/thriving behavior, positive/negative traits, growth actions. | `CHAR_SHEET:DYNAMIC_GROWTH` | Mutable; **1,400-char soft target**. | Up to ~350 tokens near soft target | **High per cast aggregate** | Behavioral context, not direct evidence. |
| 2 — Shared capsule | Character core sheet | Layer 17 — Recent Inner Thoughts | Private introspections/monologues, managed by Character Echoes. | `CHAR_SHEET:RECENT_ECHOES` | Usually empty unless the managing plugin is active. | Variable | **Low–Medium normally** | Explicitly private material should not become a player-facing objective. |
| 2 — Shared capsule | Character Sheets | Player full sheet/capsule | Full selected player sheet, or a stored player capsule rendered against the full 18-field schema when values exist; includes exclusive-player-control lock. | Character Sheets player injection | One player; populated fields only. | Potentially comparable to one core sheet | **High–Very high** | Identity and already-visible commitments may help, but the tracker must not invent actions for the player. |
| 2 — Shared capsule | Character Sheets | Supporting light capsules | Relevance-selected non-core capsules. Workspace limit **6**; Medium detail includes 12 resolution-1/2 fields, including background, personality, relationships, arc, voice, and appearance. | `getRelevantCharacters()` + `light_capsule_limit=6` | Capped by character count, not token count; values can still be verbose. | `Σ ceil(light capsule chars/4)` | **High–Very high** | Gives supporting-cast context, often much more than the objective task needs. |
| 2 — Shared capsule | Selected Canon | Lore Book shared-canon entries | Triggered Lore Book entries explicitly routed to `shared_canon`. Other Lore Book placements go to dynamic or private slots. | Lore Book plugin placement map | Token-budgeted by Lore Book's own selection logic; only matching entries. | Sum of selected entries / 4 | **Medium–High** | Can substantiate canonical terms, locations, and obligations. |
| 2 — Shared capsule | **Dynamic Knowledge** | **Whole `root.dynamic_knowledge` aggregate** | Retrieval-selected knowledge relevant to the current action/entities. | `root.dynamic_knowledge` | Dynamic, relevance-selected. | `ceil(K/4)` | **High** | Provides recall, but hard rules prevent speculative conversion into objectives. |
| 2 — Shared capsule | Dynamic Knowledge | Static lore RAG | Top retrieved chunks from `auto` lore files; configured retrieval commonly uses `top_k` around 5. | `_gatherRAG()` / static-lore vector search | Only when auto files and retriever are enabled. | Selected chunks / 4 | **Medium–High** | Relevant canon evidence without whole-file cost. |
| 2 — Shared capsule | Dynamic Knowledge | AutoSingle retrieval | Per-file retrieval, with up to 10 results requested for each `autosingle` file. | `_gatherRAG()` | Multiplies by number of AutoSingle files. | Retrieved text / 4 | **Medium–High** | Can become large with many separately queried files. |
| 2 — Shared capsule | Dynamic Knowledge | Lore Book dynamic entries | Triggered entries routed to `shared_dynamic`. | Lore Book plugin | Depends on triggers and Lore Book token budget. | Selected entries / 4 | **Medium** | Relevant short-term lore/knowledge. |
| 2 — Shared capsule | Dynamic Knowledge | Memory Recall | Character/world/relationship memories retrieved for current context. | Memory Recall plugin | Controlled by its own relevance and character limits. | Recall block / 4 | **Medium–High** | May surface old evidence, but visible-story requirement still applies. |
| 2 — Shared capsule | **Simulation** | **Whole `root.simulation` aggregate** | Concatenated current-state blocks. With Character Sheets active, personality/relationship cost often moves to canon rather than disappearing. | `root.simulation` | Dynamic and plugin-dependent. | `ceil(S/4)` | **High–Very high** | Physical/social context; generally weaker than current-script evidence for tracker mutations. |
| 2 — Shared capsule | Simulation → World State | Time state | Current qualitative time, day/time, elapsed adventure time, and explicit instruction that characters respect time passage. | World State Tracker | Always when synthesized state exists. | Usually ~100–200 tokens | **Low–Medium** | Can contextualize deadline/outcome evidence; cannot itself resolve a quest. |
| 2 — Shared capsule | Simulation → World State | Environment | Weather, climate, safety level, and crowd density. | World State Tracker | Compact, state-dependent. | Usually tens of tokens | **Low** | Context only. |
| 2 — Shared capsule | Simulation → World State | Inventory | Every tracked important item with quantity, optional description, and origin. | World State Tracker | No aggregate prompt cap; grows with item count and description/origin verbosity. | `ceil(inventory text/4)` | **Medium–High** | Can prove an acquisition/use/loss objective only when corroborated by visible chapter/history. |
| 2 — Shared capsule | Simulation → World State | Previous update/disposal reminders | Optional prior-turn update plus one-turn manual-inventory-disposal reminder. | World State Tracker | Previous update is omitted when direct plugin feedback is disabled; disposal appears only after manual deletion. | Usually short | **Low** | Helps prevent immediate state reversion. |
| 2 — Shared capsule | Simulation → World Location | Current place/view | Precise current mapped location, anchor/area relationship, and above/underground view. | World Location Tracker | Only when tracker is operational and location exists. | Usually tens of tokens | **Low** | Helps interpret location-bound objectives. |
| 2 — Shared capsule | Simulation → World Location | Ten closest locations | Name, area trail, distance, direction, and travel-time prose for ten nearest mapped nodes. | `getNearbyLocations()` | Fixed at ten when enough nodes exist. | Often several hundred tokens | **Medium–High** | Mostly excess context for Tracker; valuable to Writer/planners sharing the prefix. |
| 2 — Shared capsule | Simulation → World Location | Story-mentioned mapped locations | Up to **8** recently mentioned mapped places in this workspace, with source labels and travel data. | `story_mentioned_location_limit=8` | Based on recent chapter-source scan. | Up to several hundred tokens | **Medium** | Can disambiguate an unresolved destination. |
| 2 — Shared capsule | Simulation → World Location | Major world anchors | Capital/major nodes not already among closest locations, each with distance/direction/travel text. | `getNearbyLocations()` | No explicit final count cap visible in this formatting path; map density can expand it. | Potentially hundreds to thousands | **High** | Usually low direct objective value; significant shared cost. |
| 2 — Shared capsule | Simulation → World Location | Nearby-character synthesis | Relevant character locations around the current position. Workspace relevant limit **15**. | Character Sheets + World Location integration | Only when Character Sheets is installed and data exists. | Potentially large with 15 detailed entries | **High** | Can support “find/meet/return to” context. |
| 2 — Shared capsule | Simulation → World Location | Movement/navigation policy | Travel realism paragraph, optional manual-movement constraint, and optional active-navigation route state. | World Location Tracker | Route state only while navigation is active. | Low normally; medium during travel | **Low–Medium** | Helps distinguish active travel from completed arrival. |
| 2 — Shared capsule | Simulation → Relationships | Active pair dynamics | Status, foundational history, rolling evolution, and recent developments for every pair involving relevant player/party characters. | Relationship Tracker | **Suppressed when Character Sheets is installed**. No explicit pair cap in the standalone synthesis. | Can grow combinatorially with relevant relationship pairs | **High–Very high when standalone** | Social context; not sufficient to create player-facing objectives. |
| 2 — Shared capsule | Simulation → Personality | Per-character profiles | Origin, development summary, recent internal shifts, and strict behavioral ruleset for eligible previous-party members. | Personality Tracker | **Suppressed when Character Sheets is installed**. Roughly linear with tracked party size. | Potentially hundreds of tokens per character | **High–Very high when standalone** | Behavioral context only. |
| 2 — Shared capsule | **Narrative History** | **Whole selected-history aggregate** | The current turn's selected historical narrative, not a tiny metadata index. It may contain full prose, summaries, synopses, relevant memories, interlude capsules, and compressed arc material. | `root.history` / Memory LOD | Mature-campaign aggregate; central source of Message 2 growth. | `ceil(H/4)` | **Very high** | Primary evidence for existing/unresolved objectives and prior completion. |
| 2 — Shared capsule | Narrative History | Recent full chapter(s) | Verbatim recent narrative with exact actions/dialogue. Balanced compressed-history semantics allow 1 full chapter; the root history route depends on current LOD assembly. | Memory LOD | Recency/effective-tier controlled; dynamic overrides can elevate old critical chapters. | Usually thousands per full chapter | **High–Very high** | Highest-quality historical evidence. |
| 2 — Shared capsule | Narrative History | Summary chapters | 150–300-word long-term-impact summaries emphasizing plot, relationships, and discoveries. Balanced preset represents up to 10. | Memory LOD + summary generation | Count/tier configured. | Roughly hundreds of tokens each | **Very high in aggregate** | Excellent objective-state evidence at lower cost than full prose. |
| 2 — Shared capsule | Narrative History | Synopsis chapters | Up-to-50-word compressed event/location capsules. Balanced preset represents up to 20. | Memory LOD + synopsis generation | Count/tier configured. | Tens of tokens each; hundreds/thousands aggregated | **High** | Broad unresolved-goal navigation. |
| 2 — Shared capsule | Narrative History | Relevant slotted RAG memories | Retrieved old chapter chunks inserted beside the relevant historical chapter. | Memory LOD retrieval | Relevance/budget controlled; can elevate distant exact details. | Variable | **Medium–High** | Can recover old promise or completion evidence. |
| 2 — Shared capsule | Narrative History | Interlude summaries | Ordered summaries attached to parent chapters. | Interlude capsules | Only when interludes exist and are not already represented. | Variable | **Low–Medium** | Preserves objective-relevant side-scene consequences. |
| 2 — Shared capsule | Narrative History | Arc-compressed tail | Old contiguous synopsis history synthesized into arc tiles, with default target around 300 words per tile. | Memory LOD arc compression | Only when enabled and thresholds are met. | Hundreds of tokens per tile | **Medium–High** | Long-range orientation, less reliable than exact recent evidence. |
| 2 — Shared capsule | Final Writer Chapter | Raw prose | The complete Writer response exactly as generated, including prose structure before VN transformation. | `processed.narrativeEngine.writerResponse` | One entire current chapter; output length dependent. | Commonly thousands of tokens | **High–Very high** | Direct current-turn evidence and semantic context. |
| 2 — Shared capsule | Final Processed Dialogue | Numbered VN lines | Complete processed scene as sequential `1. …`, `2. …` lines. This overlaps the raw chapter but provides normalized line evidence. | `processed.vnManager.processedLines` | One entire current chapter in processed form. | Commonly comparable to the raw chapter | **High–Very high** | Critical for exact quest `outcome_line`; Objective suffix explicitly points here. |
| **3 — Tracker suffix** | **Whole message** | **Objective-specific task** | Previous state, canonical quests, three references to shared fields, conservative mutation rules, and JSON response contract. | `objective_tracker_prompt.txt` rendered by `buildPrompt()` | Always present for Tracker call. | **4,805-char / 1,202-token fixed scaffold** plus `O`, `Q`, and pointers; **~1,250 tokens with null/empty state** | **High** | Defines the actual plugin responsibility. |
| 3 — Tracker suffix | Role framing | Tracker/not-planner distinction | Maintain a small player-facing objective state from visible evidence; forbidden from inventing future quests. | Template preamble | Fixed. | **228 chars / 57 tokens** | **Low** | Central anti-hallucination instruction. |
| 3 — Tracker suffix | Previous state | Last completed | Stable ID/label, evidence, and completion turn. | Previous `objective_state` JSON | At most one object. | Part of `ceil(O/4)` | **Low** | Prevents forgetting/jitter. |
| 3 — Tracker suffix | Previous state | Current activity | Current party activity and evidence. | Previous `objective_state` JSON | One object; expected to change more often than goals. | Part of `ceil(O/4)` | **Low** | Baseline for smallest justified update. |
| 3 — Tracker suffix | Previous state | Active goals | Up to configured maximum, currently **3**, with stable IDs, evidence, creation/update turns. | Previous `objective_state` JSON | Output is capped; evidence text remains variable. | Part of `ceil(O/4)` | **Low–Medium** | Core continuity payload. |
| 3 — Tracker suffix | Canonical quests | Quest obligations | Normalized/sorted persistent quest records from the Tracker ledger. | `getCanonicalQuestEntries()` | Input catalog is not capped by `max_active_goals`; can grow with campaign quest count. | `ceil(Q/4)` | **Medium–High** | Lets the Tracker recognize outcomes of canonical quests. |
| 3 — Tracker suffix | Shared references | History pointer | Literal instruction to use selected narrative history from Message 2. | `updateQuestTracker()` shared-model branch | Fixed; does not duplicate `H`. | ~16 tokens | **Low** | Routes attention to Message 2 history. |
| 3 — Tracker suffix | Shared references | Input pointer | Literal instruction to use current user input from Message 2. | Shared-model branch | Fixed; does not duplicate `U`. | ~14 tokens | **Low** | Routes attention to player intent. |
| 3 — Tracker suffix | Shared references | Processed-dialogue pointer | Literal instruction to use final processed dialogue from Message 2. | Shared-model branch | Fixed; does not duplicate `D`. | ~16 tokens | **Low** | Routes attention to exact line evidence. |
| 3 — Tracker suffix | Task definition | HUD state responsibilities | Last completed objective, current activity, up to three active/pending goals, and clearly evidenced current quest outcomes. | Template task block | Fixed apart from goal-count substitution. | **346 chars / 87 tokens** | **Low** | Defines output semantics. |
| 3 — Tracker suffix | Hard rules | Visible-evidence gate | Goals must be spoken, chosen, implied by action, promised, requested, discovered, or visibly unresolved; genre/theme/hidden motive/plans are excluded. | Template hard rules | Fixed. | Part of **2,752 chars / 688 tokens** | **Medium** | Most important accuracy guard. |
| 3 — Tracker suffix | Hard rules | Canonical-quest resolution gate | Canonical quests are real, but hidden guidance/stakes do not prove progress; completion/failure/drop needs visible evidence. | Template hard rules | Fixed. | Part of 688-token block | **Medium** | Prevents planner leakage into HUD state. |
| 3 — Tracker suffix | Hard rules | Exact outcome-line contract | Requires zero-based processed-line index, exact line text, first undeniable resolution point, success summary, and optional bounded score flavor. | Template hard rules | Fixed. | Part of 688-token block | **Medium** | Makes quest notifications line-addressable. |
| 3 — Tracker suffix | Hard rules | Anti-jitter policy | Preserve IDs/labels, keep unchanged goals, add at most one goal, complete at most one unless explicitly multiple, prefer changing current activity, and require concrete evidence for every mutation. | Template hard rules | Fixed. | Part of 688-token block | **Medium** | Produces stable minimalist state. |
| 3 — Tracker suffix | Response format | Objective-state JSON example/schema | Defines `last_completed`, `current_activity`, `active_goals`, `quest_events`, and `operations`, with example values. | Template response block | Fixed textual schema; local `withSchema` also validates the parsed shape. | **1,348 chars / 337 tokens** | **Medium** | Strong output-shape constraint. |

## High-level budget equation

Let the following be character counts after prompt assembly:

- `U` = current user input
- `B` = Director Writer Brief
- `C` = shared root canon
- `K` = shared root dynamic knowledge
- `S` = shared root simulation context
- `H` = shared root narrative history
- `W` = raw final Writer chapter
- `D` = final processed dialogue/script
- `O` = previous objective-state JSON
- `Q` = canonical quest-ledger JSON

Then the approximate input budget is:

```text
69                                 shared system prompt
+ 96                                shared capsule envelope/headings/fallback markers
+ ceil((U+B+C+K+S+H+W+D) / 4)       shared capsule content
+ 1,202                             Objective Tracker suffix scaffold
+ ceil((O+Q+pointer text) / 4)      objective-specific dynamic fields
```

In shared mode, `H`, `U`, and `D` are **not repeated** inside the suffix. The suffix substitutes short references such as “Use SELECTED NARRATIVE HISTORY from the shared background context.” The plugin-specific state it really adds is principally `O` and `Q`.

## Message 1 — common system prompt

| Component | Exact source | Characters | Fablekin estimate | Purpose |
| --- | --- | ---: | ---: | --- |
| Post-turn analysis system instruction | `engine/modules/vn_manager/background_llm_cache.js` | 273 | 69 | Establishes that the next message is immutable authoritative shared context and that the final task message controls responsibility, constraints, and output. |

The message is intentionally generic. It does not contain objective semantics, story content, plugin state, or output schema.

## Message 2 — shared VN background capsule

The shared capsule is the **behemoth** of this request. It is built once for the turn and reused by VN-background plugins that inherit the same model. The figure of 381 characters / about 96 estimated tokens refers **only to its empty envelope**: section labels and fallback markers with no real narrative content. It is not a size estimate for Message 2.

On a late-game turn with a roughly 45k-token request, it is entirely plausible for this message to contribute about 70% of the total—roughly **31.5k tokens**—because it carries the assembled story context plus both the raw Writer chapter and processed dialogue. The rest of this table shows the dynamic sections that make it large.

| Shared-capsule section | Dynamic source | Other prompt contributors that can make it large | Objective Tracker use | Token accounting |
| --- | --- | --- | --- | --- |
| Project / turn / player / party metadata | Turn context | player metadata; cast output | orientation only | tiny; part of the **empty-envelope** 96-token baseline |
| Current User Input | `turnContext.input.userPrompt` | player input itself | direct evidence of newly stated goals/choices | `ceil(U/4)` |
| Director Brief | `processed.director.writerBrief` | Director; Director-facing plugins indirectly affect it through its analysis | useful context but not a Tracker-specific requirement | `ceil(B/4)` |
| Selected Canon | `root.canon` | static lore; RAG-selected canon; Character Sheets when active | allows disambiguation of visible named objectives and quest labels | `ceil(C/4)` |
| Selected Dynamic Knowledge | `root.dynamic_knowledge` | static-lore retrieval; Lore Book triggered entries; Memory Recall | distant but relevant evidence, only if injected into the root slot | `ceil(K/4)` |
| Current Simulation Context | `root.simulation` | World State Tracker, World Location Tracker, Relationship Tracker, Personality Tracker, and any root-simulation plugin | confirms current state that may contextualize an objective; the Tracker’s own hard rules still forbid creating goals from hidden context alone | `ceil(S/4)` |
| Selected Narrative History | `root.history` | memory-LOD assembly; summary history; relevant historical injections | evidence for whether a goal remains unresolved or has already been completed | `ceil(H/4)` |
| Final Writer Chapter | raw Writer response | Writer | source narrative for what happened this chapter | `ceil(W/4)` |
| Final Processed Dialogue | numbered processed lines | dialogue/VN processing | preferred line-addressable evidence for `outcome_line_number` and exact `outcome_line` | `ceil(D/4)` |

## Simulation context: contributors on a typical enabled-plugin turn

`CURRENT SIMULATION CONTEXT` is a concatenation of `root.simulation`, not a small fixed “state object.” Its size depends heavily on which narrative plugins are enabled and whether Character Sheets is acting as the character-context aggregator.

| Root-simulation contributor | Injection condition | Content actually added to the shared capsule | Typical size behavior | Important interaction |
| --- | --- | --- | --- | --- |
| **World State Tracker** | active on prompt build | current time/date; elapsed adventure time; weather; climate; safety; crowd density; inventory; plus optional previous-turn/director-feedback record and one-turn disposal reminder | modest baseline, then grows with number and description length of carried inventory items | when World Location Tracker is installed, it deliberately omits its own location list to avoid duplicate location state. |
| **World Location Tracker** | only when its map/location mode is operational | current mapped location and view; travel logic; ten closest locations; story-mentioned mapped locations; major anchors; optionally nearby-character synthesis; optional active-navigation material; optional prior-turn update | often the largest simulation contributor. Ten local locations are always listed when map data exists; this workspace permits up to 8 story-mentioned locations and up to 15 relevant nearby characters; major anchors can add further text. | adds a separate Writer directive for manual movement, but that directive is **not** part of root simulation. |
| **Relationship Tracker** | active **only when Character Sheets is not installed** | active relationship dynamics for the player plus previous-party members: status, foundational history, rolling evolution summary, and recent developments for every relevant pair | potentially medium-to-large. There is no explicit pair cap in the synthesis loop, so a larger party/relationship web grows this block combinatorially in the relevant pairs. | suppressed when Character Sheets is active, preventing duplicate relationship context. |
| **Personality Tracker** | active **only when Character Sheets is not installed** | one personality profile per eligible previous-party member: origin/baseline, development ledger, recent internal shifts, and current behavioral ruleset | potentially medium-to-large and roughly linear in tracked party size. Each profile may include both long-term history and recent beats. | also suppressed when Character Sheets is active; those character layers are instead assembled into shared canon. |
| **Optional custom root-simulation plugins** | only if installed and their hook runs | plugin-defined wrapped context | unbounded by core assumptions | disabled examples such as World Simulator do not count on an ordinary active turn. Director-private Grand Story Planner data likewise does **not** count. |

### What the “average” simulation block really means

There is no meaningful fixed token average in source because the largest contributors are content-sized, not hard-capped token-sized. A practical late-game ordering is usually:

```text
World Location Tracker (map/travel/nearby characters)
    + Character context (either Character Sheets in canon,
      or Relationship + Personality in simulation)
    + World State Tracker (especially a detailed inventory)
```

Thus, `S` should be measured from the actual assembled prompt rather than estimated from plugin count. The key growth risks are: many mapped anchors, many story-mentioned locations, detailed character-location synthesis, a broad relationship graph, long rolling ledgers, and verbose inventory origins/descriptions.

### Configuration observed in this workspace

The workspace has settings for World State Tracker, World Location Tracker, Relationship Tracker, Personality Tracker, and Character Sheets. Notable context-sizing settings are World Location Tracker's **8** story-mentioned locations and **15** relevant nearby characters, plus enabled rolling ledgers in both Relationship and Personality Tracker. Whether each block appears in a given turn still depends on plugin installation, location-tracker operational state, and Character Sheets' aggregation behavior.

### Character Sheets changes *where*, not necessarily how much, character context costs

When Character Sheets is active, Relationship Tracker and Personality Tracker skip their global simulation injections. That does not mean the shared background request suddenly loses character context: Character Sheets injects the aggregated character material into `root.canon`, so cost moves from `S` to `C`. For total Message 2 size, this is primarily a deduplication/organization decision rather than a guaranteed token reduction.

## Selected canon: Character Sheets are a major Message 2 payload

`SELECTED CANON` is not limited to static world lore. In a Character-Sheets-enabled campaign, it can contain the largest single body of reusable character context in the shared capsule. The tracker sees this material because Message 2 serializes **all of `root.canon`**, even though the Tracker itself is instructed to derive objectives only from story-visible evidence.

### How a core character sheet enters `root.canon`

```text
Selected Markdown file in `charsheet` mode
  → Character Sheets pre-prompt hook loads/generates the full capsule
  → post-prompt hook builds a “PYRAMID OF PERSONA” display sheet
  → wraps it as <sheet name="…">
  → combines all sheets under <character_sheets>
  → injects the complete block into root.canon
  → Message 2 includes it under SELECTED CANON
```

There is no per-core-character injection cap in this code path. Every selected `charsheet` file processed for the turn contributes a full sheet, provided its integrated capsule exists. This is why core cast size and sheet richness can materially determine the size of Message 2.

### Full core sheet: all 18 schema layers are eligible

For a core character, the injection path requests schema mode `full`, which includes every field with resolution `<= 3`: **18 layers**. Empty fields are omitted, but populated fields are inserted nearly verbatim under a layer heading. The layer headings are not cosmetic; they tell the model how to interpret each fact.

| Layer family | Full-sheet layers | Prompt role | Size / duplication implications |
| --- | --- | --- | --- |
| Identity and visible baseline | High-Level Summary; Physical Appearance; Expression Layer; Clothes | who the character is, what they look like, voice/mannerisms, default wardrobe | Physical Appearance is marked hard continuity; large baseline lore/wardrobe blocks can recur every turn. |
| Immediate state and portrayal | Current Context; Appearance & Outfit Continuity; Real Voice Line Examples | where they are, temporary visual changes/injuries, concrete speech examples | Current Context may overlap World Location data; Appearance Continuity is intentionally separate from immutable baseline. |
| Mind and behavior | Personality Blueprint; Affinities & Preferences; Competence and Knowledge; Core Motivator; Paradox & Trajectory; Intimacy Profile; Dynamic Engine; Recent Inner Thoughts | disposition, preferences, knowledge boundaries, drives, contradictions, attachment patterns, growth behavior, optional interiority | this is where a richly authored core character can consume a large prompt budget. |
| Social and narrative arc | Relationships; Character Arc & State; Background Lore | bonds, current story involvement, biography/history | can overlap relationship/personality trackers conceptually, but Character Sheets becomes the single presentation surface when it is active. |

The schema explicitly describes Background Lore as typically **300–1000 words**. A single populated core sheet can therefore be substantial before the remaining seventeen layers are considered. The plugin setting itself warns that higher core-sheet detail consumes more tokens.

### Managed layers and the “single presentation surface” rule

Several layers have designated owners:

| Layer | Owner / behavior | Why it matters to Message 2 |
| --- | --- | --- |
| Current Context | `world_location_tracker` | location state can be maintained by the location system while still presented inside the character sheet. |
| Personality Blueprint | `personality_tracker` | when Character Sheets is active, the separate root-simulation personality snapshot is suppressed. |
| Relationships | `relationship_tracker` | when Character Sheets is active, the separate root-simulation relationship snapshot is suppressed. |
| Recent Inner Thoughts | `character_echoes` | available only if that plugin supplies it. |
| Physical Appearance | immutable + hard priority | also copied into a Writer-private hard-continuity directive; that extra directive is **not** in the VN-background Message 2, but the canonical sheet is. |

The design avoids presenting the same relationship/personality facts as independent root-simulation blocks and as sheet layers. It does not necessarily reduce total character tokens, but it reduces contradictory phrasing and gives the model one authoritative location for a character’s portrayal.

### Player and supporting-character capsules

The player is also injected into the same `root.canon` Character Sheets block:

- If the player has a selected full sheet, it is rendered as a full core sheet with an “exclusively player-controlled” lock.
- Otherwise, the player uses a Lite storage capsule but is rendered with the **full field set** when data exists.
- Supporting characters are selected by relevance and limited by `light_capsule_limit`; this workspace uses the default **6**. Its configured Medium detail tier includes **12** layers: identity/baseline, current context, personality, preferences, relationships, arc, background lore, clothes, visual continuity, and voice examples.

So Message 2 may contain `N` uncapped selected core sheets, one player sheet/capsule, and up to six medium-detail supporting capsules. This is a significant canon cost even before static world lore is included.

### Other material in `root.canon`: it is not only character sheets

`root.canon` is a broad shared reference slot. Its ordinary sources are:

| Source | What enters canon |
| --- | --- |
| Static selected Markdown files in `full` mode | raw content wrapped as world lore |
| Static selected Markdown files in `summary` mode | LLM-generated summary wrapped as world lore |
| Project Lore Book folder | follows the same full/summary placement into canon |
| Player bio | a `player_character` canon block, unless Character Sheets consumes/clears it to avoid double injection |
| Character Sheets | the aggregated core/player/light capsule block described above |
| Lore Book plugin | only entries configured for shared-canon placement; other entries can route to dynamic or private slots instead |

Conversely, the following do **not** belong in Message 2’s `SELECTED CANON` section: static RAG results and Memory Recall (dynamic knowledge); live state trackers (simulation); Director-private strategic plans; and root protocol/directives. The background capsule serializes canon, dynamic knowledge, simulation, and history—not every prompt slot.

### Canon budget equation with character sheets

For accurate turn accounting, decompose `C` rather than treating it as a black box:

```text
C = static full/summary lore
  + player bio not absorbed by Character Sheets
  + Σ(full selected core sheets)
  + player sheet/capsule
  + Σ(up to light_capsule_limit supporting capsules)
  + Lore Book entries routed to shared canon
```

The strongest late-game growth terms are usually the sum of full core sheets and their Background Lore / behavior / relationship layers. In a cast-heavy project, `C` and `H` can rival or exceed the raw chapter text.

## History is a major shared-payload cost

`SELECTED NARRATIVE HISTORY` deserves the same prominence as raw chapter text and processed dialogue. It is not just a compact metadata line: it is the current prompt’s selected historical narrative material, assembled by memory LOD and any relevant historical injections.

The separate `compressedHistory` presets clarify the potential source scale: the balanced preset can represent up to **1 full chapter, 10 summaries, and 20 synopses** (with optional arc compression). In the shared route, the Objective Tracker does not reinsert that compressed string in its suffix; it points back to the shared capsule's history section. This avoids duplication, but it does **not** make `H` small. On a mature campaign, selected history can be one of Message 2's largest components alongside canon, raw chapter, and processed dialogue.

### Important duplication note

The raw Writer chapter and processed dialogue often represent substantially the same scene in two forms. This is likely the largest shared-context cost after canon/history. It is deliberate: the Tracker needs prose context, but its quest-event contract also requires exact zero-based processed-line evidence. Do not count either one as Objective Tracker-specific payload—they are shared with other background tasks.

## Message 3 — Objective Tracker suffix

The literal template is `engine/plugins/quest_tracker/prompts/objective_tracker_prompt.txt`.

| Suffix area | Static characters | Estimated tokens | Variable content in the shared-model path | Why it exists |
| --- | ---: | ---: | --- | --- |
| Role preamble | 228 | 57 | none | Declares a small player-facing state machine, not a plot planner. |
| Previous Objective State heading | 53 | 14 | `O` JSON | Preserves stable IDs/labels and minimizes HUD jitter. |
| Canonical Planner Quests heading | 55 | 14 | `Q` JSON | Recognizes real quest obligations while shielding hidden planner text from the player-facing tracker. |
| Compressed Story History heading | 52 | 13 | a 65-character pointer to shared selected history | avoids history duplication in shared mode. |
| Current Player Input heading | 49 | 13 | a 55-character pointer to shared user input | avoids input duplication. |
| Current Chapter Script heading | 46 | 12 | a 63-character pointer to shared processed dialogue | avoids script duplication. |
| Task definition | 346 | 87 | `max_active_goals` (configured as 3) | names the four HUD responsibilities. |
| Hard rules | 2,752 | 688 | none | the principal objective-specific reasoning contract. |
| JSON response contract | 1,348 | 337 | none | constrains stable goal IDs, evidence, quest events, and operations. |
| **Entire template with raw placeholders** | **4,929** | **1,233** | — | source-file measurement |
| **Suffix scaffold after placeholders are removed** | **4,805** | **1,202** | — | fixed objective-specific instruction cost |
| **Shared-mode suffix with `null` state and `[]` quests** | **4,999** | **1,250** | three shared-context pointers | useful minimum realistic baseline |

The Objective Tracker has a meaningful fixed instruction cost—roughly **1.2k estimated tokens**—even when there are no existing objectives. Almost all of that cost is the 688-token hard-rule block and 337-token JSON contract.

## Objective-specific dynamic payload

| Field | Actual source before call | Bounds / growth behavior | Approximate token formula | Notes |
| --- | --- | --- | --- | --- |
| `previous_state_json` (`O`) | latest prior `objective_state` | one `last_completed`, one `current_activity`, up to configured active goals (default 3), and events/operations | `ceil(O/4)` | This is the Tracker’s continuity memory. It is typically small unless evidence strings are allowed to grow unnecessarily. |
| `canonical_quests_json` (`Q`) | persistent `quest_tracker` ledger entries, normalized and sorted | unbounded by template; grows with active/resolved canonical quest catalog | `ceil(Q/4)` | Contains player-safe quest obligations. The prompt explicitly excludes hidden planner guidance, fail/success prose, and invisible progress as evidence. |
| `max_active_goals` | plugin setting | 1–6; current workspace: 3 | negligible | Output cap; it does not cap canonical-quest input. |
| shared-history pointer | code literal | fixed | ~16 | replaces a potentially large history copy. |
| shared-input pointer | code literal | fixed | ~14 | replaces `U` duplication. |
| shared-dialogue pointer | code literal | fixed | ~16 | replaces `D` duplication. |

## What “compressed history” means here

With a non-shared custom model, the Tracker inserts `runtime.historyData.compressedHistory[history_preset]` directly. The default preset is **balanced**: up to **1 full chapter, 10 summaries, and 20 synopses**, subject to available history and optional arc compression.

In the configured shared route, the suffix replaces that direct history with a pointer. The actual background capsule instead receives `root.history`: the selected narrative-history material prepared for the current turn. The precise token count depends on current prompt routing and plugin injections, so the defensible accounting is `ceil(H/4)`, not a fictional fixed total.

## Which other plugins’ data can reach this request?

The Tracker has no direct dependency on most of these plugins, but it inherits anything they placed into the shared root slots before the VN-background capsule is frozen.

| Shared slot | Potential upstream contributors | Relevance and caveat |
| --- | --- | --- |
| `root.canon` | project lore/directives routed as canon; Character Sheets | supports identity and story-fact interpretation; should not create a HUD objective by itself. |
| `root.dynamic_knowledge` | RAG, Lore Book, Memory Recall | may surface distant evidence; Tracker hard rules require story-visible support. |
| `root.simulation` | World State, World Location, active relationships, personality summaries | makes the shared prefix larger. It is context, not permission to turn hidden state or speculative motive into an objective. |
| `root.history` | memory LOD/history reconstruction | gives long-range visible-story evidence. |
| Director Brief | Director plus prompt-facing plugins that influence Director reasoning | shared broadly even though the Tracker is told to operate from story-visible evidence only. |
| Writer chapter/dialogue | Writer, validator/processor outputs | central evidence for quest outcome lines. |

This explains the “about 70% shared” intuition. In a late-game ~45k-token request, a 70% shared capsule is about **31.5k tokens**. The fixed Objective Tracker suffix is only ~1.25k estimated tokens before its objective/quest JSON. The shared canon/history/simulation plus raw chapter and processed dialogue therefore dominate the request. The exact percentage is not fixed: short chapters with a huge quest registry could invert it; long chapters with modest objective state make the request overwhelmingly shared.

## Worked accounting template

Use this for an exact per-turn estimate from logged message text:

| Bucket | Estimated tokens |
| --- | ---: |
| Shared system | 69 |
| Shared-capsule envelope | 96 |
| User input | `ceil(U/4)` |
| Director Brief | `ceil(B/4)` |
| Root canon | `ceil(C/4)` |
| Root dynamic knowledge | `ceil(K/4)` |
| Root simulation | `ceil(S/4)` |
| Root history | `ceil(H/4)` |
| Raw Writer chapter | `ceil(W/4)` |
| Processed dialogue | `ceil(D/4)` |
| Objective suffix scaffold | 1,202 |
| Previous objective state | `ceil(O/4)` |
| Canonical quest registry | `ceil(Q/4)` |
| Shared-mode pointer strings | ~48 |
| **Total** | **sum of all rows** |

## Non-shared fallback route

If the plugin’s `model_def` is changed away from `inherit: "vn_background"`, it sends one user message containing its template with direct values: previous state, canonical quests, compressed history, current user input, and numbered current script. It does **not** receive the shared system prompt, Director Brief, root canon, root dynamic knowledge, root simulation, raw Writer chapter, or the shared processed-dialogue capsule.

That route can be cheaper or more expensive depending on history/chapter size, but it loses the shared-prefix cache and the additional common evidence. The analysis above describes the installed configuration, which uses the shared route.
