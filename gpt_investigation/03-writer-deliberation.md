# 3. The Writer: A Scene Compiler with a Human-Readable Plan

## Why a second deliberation layer exists

The Director chooses what deserves attention. It does not write the scene. The Writer must reconcile the brief with the actual player attempt and produce emotionally convincing, visually usable prose. `writer_chain_of_thought.txt` gives the Writer a fifteen-step internal cognitive framework before it writes.

This is not redundant planning. The Director's question is “what should the story pressure be?” The Writer's question is “what happens on the page, in what order, without taking over the player or contradicting the world?”

## 1. The player input becomes an on-camera contract

The Writer's first instruction is to segment every distinct statement, question, and action in the input into a checklist. It then makes a strong on-camera rule:

- present dialogue as spoken now;
- present actions as attempted now;
- do not treat the player's text as something that happened before the chapter;
- if an action fails, show the attempt before the consequence.

This solves a common interactive-fiction defect: the model jumps straight to NPC reaction, rewrites the user’s intent, or narrates aftermath without allowing the player’s declared action to exist. Fablekin keeps causality legible even when the world says no.

The same step includes a plausibility decision. A plausible action gets a direct consequence; an implausible action gets an attempted-action consequence. There is no out-of-fiction refusal branch. That choice preserves momentum and makes consequence a narrative tool.

## 2. The Writer treats the Director brief as typed input

The Writer does not simply obey the brief as a blob. Step 2 extracts actionable feedback and classifies it as player-targeted, character-targeted, pacing/narrative, writing critique, or player soft feedback. It labels each as mandatory, high, craft, or soft and checks for conflicts.

This is a remarkable detail because it establishes a **priority lattice** inside natural-language prompting:

```text
Mandatory order
  > character integrity
  > player intent
  > writing critique as a craft constraint
  > flavor
```

The Writer can thus use a critique to alter voice or pacing without letting it override a character's established refusal, or use a player hint without allowing it to violate world logic. The brief becomes constrained data rather than a competing author.

## 3. Character depth is decomposed into playable variables

For every key NPC, the Writer identifies an immediate objective, dominant emotional response, information asymmetry, and private internal monologue. The important variable is **knowledge gap**. It reminds the model that an NPC cannot react to off-screen facts it does not know, even though the LLM has read them in shared history.

The framework also distinguishes new-to-reader information from new-to-character information. Established companions should communicate known facts through shorthand, teasing, habits, callbacks, unfinished references, or irritation—not artificial exposition. It explicitly tells the Writer not to make close characters ask “why?” about ordinary facts they already know.

This is how Fablekin aims for the “lived-in” quality people notice. The model is not merely told to avoid exposition; it is given alternate social forms through which exposition can surface.

## 4. Continuity guards protect what readers actually notice

The visible-continuity step requests only on-camera major characters and their obvious visual locks: eyes, hair, body traits, scars, outfit, held items, injuries, posture. When uncertain, it tells the Writer to describe expression, movement, voice, or gaze instead of fabricating a detail.

That is an excellent uncertainty policy. A language model would rather fill a descriptive gap than write neutrally. The instruction makes deliberate omission preferable to a confident hallucination, especially important when sprites make inconsistency visible.

## 5. World logistics make the chapter occupy time and space

The Writer checks current location, time, passage of time, travel distance/method, road conditions, weather, technical and cultural baseline, and anachronisms. A long journey is not collapsed merely because the destination is the goal; the road may become the scene through camp life, local encounters, landmarks, weather, supplies, fatigue, or relationships.

This turns geography from lore backdrop into a pacing instrument. The story has room to breathe between plot nodes, and time can create pressure—late nights, long travel, exhaustion, a believable arrival—rather than behaving as a static label.

## 6. Beat maps convert constraints into a writable route

The Writer next chooses arc position, visual cues, atmosphere, narrative path, and a chapter hook. It selects one sensory detail the renderer cannot carry, keeps visual narration lean, and plans the final open moment without writing the player's reaction.

It then maps feedback into concrete execution: who answers the player first, what physical/emotional acts must occur, what pacing change happens, and how the beats connect. After a stress test, it creates a locked five-to-eight-beat route with required inclusions, hard boundaries, an ending hook, and a drift lock.

The drift lock is the practical cure for long-output entropy. Generative prose has many chances to discover a shiny new direction halfway through. The prompt tells the Writer not to add major turns unless player input, mandatory direction, character logic, or world logic requires it.

## 7. Repeated audits attack predictable model failures

The framework reviews the beat map twice, then performs a draft reflection. The duplication is likely unintentional in naming, but useful in effect: player action compliance, player agency, NPC initiative, and immersion are rechecked after planning rather than assumed solved.

The Writer must verify that it did not make major player choices, confessions, tactical decisions, romantic consent, or irreversible actions for the player. It also must ensure at least one NPC has initiative, memory, disagreement, curiosity, affection, suspicion, humor, or need.

This is how the output avoids two extremes at once: a passive world that waits for commands, and an authorial model that steals the player character’s agency.

## 8. Style rules are tied to predicted failure points

The cliché audit rejects wall metaphors, identity-reset speeches, “because it’s real/because it’s you” emotional proof, false secrecy around already-visible relationships, and generic sensory shorthand. Crucially, it asks the model to identify the beat and character likely to produce the cliché before drafting. That is stronger than a final “avoid clichés” footer because it creates a local substitution plan.

The relationship-visibility rule is especially nuanced: an open couple holding hands is not automatically a secret, and a known mentor correcting a student is not automatically suspicious. Tension must arise from actual timing, danger, decorum, pride, or boundaries. The prompt prevents melodrama from being hallucinated simply because the model recognizes a familiar romance trope.

## 9. Dialogue is treated as the VN’s main medium

The final audit insists that spoken lines be a clear majority of rendered lines. It asks the Writer to convert silent beats into exchanges, interruptions, questions, teasing, disagreement, concern, logistics, or emotional shorthand, and to keep every major on-camera character speaking repeatedly unless there is a reason not to.

This is not a crude “add dialogue” rule. It aligns prose with its destination: a visual novel renderer already supplies images, so text should foreground voices, micro-actions, and social movement rather than spend most of its budget repainting scenery.

## Why this can feel overwhelming yet work

The Writer receives a formidable number of constraints, but they are not all equally active. The system makes it workable by ordering them into a sequence: interpret input, extract directives, establish local character state, validate visible/world facts, choose beats, test agency, lock route, write, then audit style/dialogue. Each step produces an intermediate decision that narrows the next.

In short, Fablekin does not ask the Writer to remember everything at every token. It asks it to decide what matters before prose, then gives it multiple opportunities to catch the specific ways an interactive chapter can fail.
