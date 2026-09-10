# 2. The Director: Turning a Novel into a Selective Editorial Brief

## What the Director is for

The Director is Fablekin's answer to a basic weakness of direct roleplay prompting: the prose model is asked to invent, remember, judge, pace, protect secrets, enforce boundaries, and write beautiful scene-level text at once. Even a capable model tends to satisfy the most recent and most legible demand—the player message—while softening consequences or forgetting an interrupted NPC task.

Fablekin gives a separate agent the adversarial editorial work. The Director reviews shared evidence plus its private data, writes a strategic analysis, and distills the useful result into a Writer Brief. The Writer does not have to discover every pressure by itself while composing dialogue.

## The Director's deliberation is deliberately overcomplete

`engine/prompts/director/cot_steps.txt` is a long audit, not a generic “make a plan” request. It repeatedly makes the Director ask a concrete question and turn a positive finding into a directive. Major clusters include:

| Audit cluster | Narrative failure it prevents |
| --- | --- |
| Player soft-feedback analysis | user’s nonliteral wishes being ignored |
| Ledger and previous-monologue review | abandoned long-term promises |
| Scene business level and action queue | forcing an unrelated subplot into a busy scene |
| cast admission/removal and absent-character checks | static party composition and forgotten companions |
| personality integrity and cliché diagnosis | characters becoming caricatures |
| agent-of-chaos alternatives | flat chapters without making arbitrary twists mandatory |
| NPC amnesia and lively-NPC checks | NPCs existing only to react to the player |
| dialogue-dynamics check | ping-pong exchanges and player-centric social worlds |
| anti-sycophancy/consent audit | implausible compliance and romance-by-command |
| weather, time, location, inventory checks | “floating” scenes without physical continuity |
| stakes, setting, and personal-time checks | consequence-free adventure and perpetual party clumping |
| ending and dynamic-event cadence checks | mechanically repetitive chapter endings |

It is useful that several questions overlap. “What was interrupted?”, “what is on the action queue?”, “does an NPC have a mundane task?”, and “has an NPC been silent?” all point toward the same desired behavior: people retain intent across a cut. Redundancy here is a prompt-engineering safety net against recency bias.

## Scene business level: a small prompt device with large effects

The Director assigns the scene a business level from one to four. At one, characters are free to start new things; at four, they are in a critical task and no diversion is plausible. This is not a backend state machine in the prompt. It is a decision heuristic that stops the Director from reflexively “improving” every chapter with a new event.

That matters because an LLM planner often treats every unresolved idea as a request for immediate inclusion. Business level asks whether the scene has *attention capacity*. A romance conversation, return of an absent companion, new stranger, or chaos beat must pass this capacity test before it becomes a Writer order.

## NPCs are modeled as agents, not stage furniture

The most distinctive Director instruction is its insistence that NPCs retain goals and initiate behavior. It asks whether a person was interrupted while trying to eat, send a letter, buy food, finish work, or speak; whether they can insist on resuming it; and whether their task should become a high-priority action queue item.

The “Lively NPCs” section goes further. It asks whether an NPC, rather than the player, should initiate flirtation, disagreement, curiosity, concern, banter, or an attempt to match the player's energy. It also checks for a visibly present companion who has gone silent. The resulting prompt philosophy is:

> An NPC does not vanish between its last line and the next player command. It has a body, a task, social history, opinions, and an opportunity to act.

This is a key reason strong output feels reciprocal. The player is participating in an ongoing social system, not operating a row of dialogue vending machines.

## Anti-sycophancy is made procedural

The Director's boundary audit is unusually explicit. For potentially intimate or compliant player actions it must identify the player's intent, inspect the target's romance/dynamic, account for bystanders and existing commitments, decide whether dignity/boundaries/logic are violated, and—if so—issue clear Writer instructions for a rejection or social consequence.

The important prompt-engineering idea is not harshness. It is **precommitment**. The system recognizes that LLMs are biased toward completing the apparent user fantasy, so it places a separate decision process before prose. Trust, trauma bonds, magical links, or group membership are explicitly barred from being silently converted into consent.

This allows the Writer to dramatize failure: an attempted kiss can be blocked, a boast can be challenged, an impossible demand can provoke conflict. The player still receives a scene, but characters retain dignity and causality.

## The Director's memory is a future-facing editorial notebook

The analysis call is followed by a ledger update call. The Director maintains durable items such as party logistics, location and travel goals, character status/agendas, active threads, action queue, watchlist, and mystery guardrails. The ledger prompt is careful about maintenance: unchanged entries persist; updates must change actual meaning; stale or resolved facts should be deleted; new entries must be genuinely new.

From a prompt viewpoint, this protects against two opposite errors:

- **amnesia**: a mundane but real goal disappears because it was not mentioned in recent prose;
- **ledger bloat**: the Director rewrites every fact every turn, turning its own notebook into noisy pseudo-history.

The Director also carries a short previous monologue. Later it must label old advice as apply-now, carry-forward, retire, or reject because context changed. This is a built-in anti-rumination loop: past planning influences the present only after revalidation.

## The Writer Brief is strategically lossy on purpose

The Director's analysis output contains a scratchpad and personal monologue, but the Writer gets only the brief. The output prompt prohibits IDs, metrics, or raw analytical language in the brief. That insulation is important.

A Writer asked to reproduce “priority scores,” action-queue IDs, and diagnostic categories tends to produce checklist fiction or leak meta language. Fablekin instead asks the Director to translate findings into concrete story actions: who resumes a task, which character pushes back, what must not be revealed, what dialogue habit to avoid.

Its thread policy is especially healthy: mandatory orders are for the immediate scene; narrative threads are long-term seeds, and only one or two should be woven in naturally. The Director is therefore a filter against its own tendency to overplot.

## Dynamic event cadence: a pacing advisor, not a genre override

The Director sees available event capabilities such as combat, camp/town downtime, or travel. It knows when each last appeared and is told to encourage overdue opportunities only where they fit naturally. If the chapter begins one, the Writer must stop before resolving its outcome. If a capability is repetitive, the Director can put the exact `deny_event` token into the brief, signaling that the system should not manufacture another handoff.

The underlying principle is worth preserving: cadence should be a **bias**, not a command. A cold combat system does not justify a random ambush. A warm camp system should not swallow an active emotional confrontation. The prompt explicitly resists both mistakes.

## Director prompt extensions are first-class editorial interventions

Plugins can add, override, or disable numbered Director thinking steps. This is more refined than simply appending a large instruction block. For example, the Grand Story Planner adds a step asking the Director to inspect a private execution brief and decide whether its pressure should be ignored, seeded, advanced, protected, or made mandatory—without dumping the plan into the Writer Brief. Quest tracking similarly adds a focused consequences check.

This makes the Director extensible at the level of *questions it asks itself*, which is exactly the right layer for prompt specialization.
