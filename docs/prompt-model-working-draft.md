---
type: current
status: active
scope: prompt-model
canonical: false
related: ["../gpt_investigation/context-web/README.md", "../gpt_investigation/01-prompt-topology.md"]
---

# Prompt model: working notes (implemented state)

This is a place to remember *why we started*, what the branch actually does, and what is still open. It is a discussion draft, not a claim that all plugin prompts or the Payload Atlas are finished.

## 1. The point of the whole exercise

We wanted to inspect real LLM requests across Fablekin: which calls carry the most context, where the bytes come from, which calls repeat the same payload, whether a shared prefix is actually cacheable, and what the provider reports for tokens, cost, and cached input. The creator — not an optimization wizard in the UI — will use this evidence to decide what to change.

We initially mapped payloads manually into the [context-web SQLite investigation and Payload Atlas](../gpt_investigation/context-web/README.md). That investigation is useful, but manually re-deriving the map from code is slow and can drift or hallucinate after a prompt changes. The new prompt model lets **the requests describe themselves**. It is instrumentation in service of payload analysis, not a reason to make every plugin author a prompt-framework expert. The Atlas still uses analyst size bands, not measured per-piece token totals; a provider's request-level token/cache counts are not magically exact per-piece costs.

## 2. Core idea: pieces are meaning, messages are delivery

```text
Prompt pieces (semantic units)        Sent messages (delivery envelopes)
world_state -> time -> date           part of one user message
root.history                          several user/assistant messages
review task -> rules + question       parts within two messages
```

A piece is a named unit with an owner and a catalogue parent. A message is an ordered `{role, content}` envelope. One message can hold several pieces; one logical group (for example a conversation history) can span several messages. Parent size is the union of descendant spans — never a fake span stretched across role boundaries, never double counting.

## 3. What is currently in the code

- `engine/modules/prompt/prompt_core_catalog.js` — core hierarchy: `root`, `writer`, `director`, their slots (`canon`, `simulation`, `history`, etc.), and named core pieces. A parent relationship makes a group; there is no separate group type. No size/budget estimates.
- `engine/modules/turncontext.js` — ordered **occurrence objects** in `promptComponents[pillar][slot]`, not anonymous strings. Each carries `componentId`, `owner`, persisted `sourceId`, text, and children. `addPromptOccurrence()` is the only stamper; `getPromptSource()` is read-only lookup; `renderPromptSlot()` is the flat-text view.
- `engine/modules/prompt/slot_renderer.js` + `xml_format.js` — the single traversal for render order and text ownership (own text, framing, sibling separators, children). Flat readers and the composer project the same rule.
- `engine/modules/prompt/prompt.js` — `Prompt` builds one request's ordered messages; `prepare()` freezes a `PreparedPrompt` (`messages`, `hash`, `characterCount`, diagnostics-only `manifest` with exclusive spans). Supports `add()`, trusted `include()` of stored occurrences (no reparenting), `usePrefix()` / `append()`. Standard policy: at most one system message, first. Agent policy (`rolePolicy: 'agent'`, recorded in the manifest) is an explicit, tested exception for the agent runner's late final-iteration note.
- `engine/modules/prompt/request_compiler.js` — **the plugin request compiler** (`createPluginPromptScope`, `compilePluginRequest`, `compileAgentMessages`). One place that turns a plugin's string or structured `{messages}` description into a `PreparedPrompt` with plugin-scoped IDs.
- `engine/modules/prompt_builder.js` / `engine/modules/director.js` — Writer and Director compose from one frozen shared narrative prefix (`usePrefix()`), then add their private suffixes. Director context stays one user message (cache-shape preserving).
- `engine/modules/vn_manager/background_llm_cache.js` — a **different**, post-turn two-message system+capsule prefix from some of the same stored pieces, then scene and task suffix. Same-route VN calls can reuse that leading prefix; sharing source pieces with Writer does not make Writer and VN provider-cache-compatible.
- `engine/modules/plugin_manager/runtime/tools_builder.js` — `tools.prompt.contribute`, `tools.prompt.compose`, `tools.llm.{call,runTask,json,withSchema,batch,vnBackground}`, `tools.agent.startAgent`. `callLLM({prompt: prepared})` centrally logs the prompt trace. Raw `{role,content}` arrays are explicitly rejected at the plugin boundary.

## 4. Plugin-facing API (implemented)

All examples run inside a plugin hook receiving `(turnContext, tools)`. The calling plugin's identity comes from its scoped `tools` — no separate manifest needed for request-local pieces.

### 4a. Contribute shared context (implemented)

```js
tools.prompt.contribute({
  id: 'current_state',               // becomes world_state_tracker.current_state
  to: 'root.simulation',             // toolkit derives its core parent
  text: currentStateText,
  children: { time: { date: dateText } } // only if this granularity is wanted
});
```

First contribution registers and validates the stable scoped ID; later turns check placement and identity. Unknown child keys, conflicting moves, and post-freeze root writes throw atomically. `directable: true` adds toolkit-owned framing.

### 4b. Simple standalone call (implemented)

```js
await tools.llm.json({
  model: 'mediumendmodel',
  requestId: 'unresolved_threads',
  prompt: 'List the unresolved story threads.'
  // `instruction` is accepted as an alias for `prompt`; never both,
  // and never alongside a PreparedPrompt or raw messages.
});
```

The toolkit compiles the string under `<pluginId>.<requestId>` (beneath `core.plugin_tasks`) and sends a `PreparedPrompt`. Missing/blank `requestId` throws.

### 4c. Structured multi-message call (implemented)

```js
await tools.llm.json({
  model: 'mediumendmodel',
  requestId: 'continuity_review',
  prompt: {
    messages: [
      { role: 'system', piece: 'rules', text: 'Check continuity.' },
      { role: 'user', piece: 'history.chapter_3.question', text: earlierQuestion },
      { role: 'assistant', piece: 'history.chapter_3.answer', text: earlierAnswer },
      { role: 'user', separator: '\n\n', parts: [
        { id: 'current_state', text: JSON.stringify(state) },
        { id: 'task', text: 'Identify a contradiction.' }
      ]}
    ]
  }
});
```

Dotted paths create intermediate parents (`history` under the request root, `history.chapter_3` beneath it). Each leaf owns its exclusive spans in its own message; `history.chapter_3` groups the question/answer without a cross-message span. Inconsistent redefinition, blank text, unknown roles, `{parts}` mixed with `{piece,text}`, and raw `{role,content}` entries all throw. Fully built `PreparedPrompt` input passes through untouched.

### 4d. Advanced `compose()` without a plugin manifest (implemented)

```js
const prepared = tools.prompt.compose('review', draft => {
  draft.system(message => message.add('rules', 'Follow the evidence.'));
  draft.user(message => {
    message.history('balanced');
    message.separator('\n\n');
    message.add('task', 'Name the risk.');
  });
  draft.assistant(message => message.add('note', 'Recorded.'));
});
```

Pieces register at `add()` time under the request ID, including nested adds. `message.history('balanced')` inserts the precomputed view as `core.history.compressed.balanced` with `historyView` metadata; `message.include('<plugin>.<piece>')` verbatim-reuses a known stored piece under its source identity. Top-level anonymous `message.text()` throws (name the piece). Cross-plugin IDs in `add()` throw — use the data contract below for computation, or `include()` for unchanged reuse. `usePrefix()` / `append()` remain for prefix reuse.

### 4e. VN-background with plugin-owned suffix (implemented)

```js
return tools.llm.vnBackground.json({
  scene: 'raw',
  requestId: 'tension_score',
  instruction: 'Score the scene tension.',
  msg: 'Tension score'
});
```

The toolkit supplies the frozen two-message prefix, canonical model route, and cache gate; the suffix compiles to `<pluginId>.<requestId>` and is appended (`preparedSuffix`). First two messages and `prefixHash` are unchanged by the task. Bare `{scene, suffix}` without `requestId` is removed — plugin VN tasks require a `requestId`. Multi-message plugin suffixes go through the same append path. No `model`/`provider`/`messages`/`prompt` overrides.

### 4f. Batch (implemented)

```js
await tools.llm.batch([
  { requestId: 'first', instruction: 'Describe the vault.', model: 'mediumendmodel' },
  { requestId: 'second', prompt: { messages: [...] }, model: 'mediumendmodel' }
], { concurrency: 2, json: true });
```

Each item compiles independently through the same request compiler. Raw `messages` items throw. Concurrency/settle/progress behavior is unchanged.

### 4g. Agent bridge (implemented)

`tools.agent.startAgent` without a custom `callModel` compiles each iteration's ordered messages via `compileAgentMessages()` (labeled `message_1`, `message_2`, … under `<pluginId>.agent_<session>`), preserving roles, order, and text — including the runner's late final-iteration system note under the explicit agent role policy. Custom `callModel` callers are unaffected. `agent_runner.js` core path does the same under `core.agent_runner`.

## 5. Two TurnContext surfaces (officialized)

Plugins publish along two deliberate, separate surfaces:

- `turnContext.processed.*` / `turnContext.output.*` / exports — **structured data for code**. Another plugin reads a known field (for example `turnContext.processed.worldState.weather`) and writes its own model instruction from it. That new wording belongs to the **calling** plugin. We never infer source ownership from string similarity.
- `promptComponents` occurrences — **authored model-facing wording**. A plugin contributes its own summary (for example World State's "Dragonica Land, raining, high alert" under `root.simulation`). That summary's ID identifies the summary, not every data field used to produce it. No automatic data-tree-to-prompt rendering; a separately measurable location/time/weather means deliberately contributed children, not a second copy of the same bytes.

World State's data object and its prompt piece may share a name, but they are different outputs with different owners and lifecycles.

## 6. Verbatim reuse vs custom use (officialized)

- **Verbatim reuse (allowed):** explicitly include a *known* prompt piece unchanged. The receiving request records the source's component ID, owner, and `sourceId` with new spans in the consumer's message. Example: include `world_state_tracker.world_state_context` whole, or one child. The 10k-token question is answered per call: every call that sends those bytes records its own inclusion and bears its own usage. Shared IDs never imply a provider cache hit — caching still needs identical leading rendered messages plus route, confirmed by usage data.
- **Custom use (caller-owned):** read `processed.*` / exports, author new wording (`Weather: sunny; assess travel`). The new part belongs to the caller. Do not relabel it as the other plugin's piece.
- **Forbidden:** sifting or parsing another plugin's rendered prompt text to *discover* data, inventing ownership for copied/transformed text, or silently picking one of several same-ID occurrences (require `instanceKey`/`sourceId` when ambiguous).
- **Immutability:** published prompt occurrences are immutable once prepared. Editing `processed.worldState` never rewrites an already prepared prompt; a changed model-facing summary is a new occurrence/revision.

```js
// Data use (caller-owned wording):
const weather = turnContext.processed.worldState.weather;

// Verbatim reuse (source identity preserved):
return tools.llm.json({
  requestId: 'travel_review',
  model: 'mediumendmodel',
  prompt: { messages: [
    { role: 'user', parts: [
      { include: 'world_state_tracker.world_state_context' },
      { id: 'task', text: 'Assess travel conditions.' }
    ]}
  ]}
});
```

History preset selection (`brief`/`balanced`/`deep`) is the core-owned analogue: one attributed view string from precomputed `runtime.historyData.compressedHistory`, not fictitious per-chapter spans.

## 7. Explicitly NOT supported

- Raw `{role, content}` arrays at the plugin boundary (`task.messages`, `overrides.messages`, structured `content` fields). They throw with a "name the piece" error.
- Cross-plugin piece *authoring*: writing text under another plugin's ID throws. Known dependencies use the data contract (section 8) for computation; verbatim *inclusion* (section 6) is the only prompt-level reuse, and only unchanged.
- `tools.prompt.piece(...)` returning a bare string that loses identity (removed).
- Static exported `promptPieces` manifests and legacy `contribute(key, content)` (removed). PluginManager rejects an old `promptPieces` declaration **before** registering that plugin; old plugins must migrate. Its internal contribution-time registry is called `promptRegistry`.
- Detection-only `draft.includeOptional()` and the throwing `_includeHistory` stub (removed; `{include:...}` / `{history:...}` / `message.history(...)` / `message.include(...)` are the real paths).
- Unnamed/generic VN-background plugin suffixes — plugin calls require a `requestId`.
- Automatic tier fallback for history selection, or second-copy history inside VN-background (which already carries narrative history in its capsule). Explicit repetition renders twice with both spans recorded.

## 8. Officialized: known plugins read structured data, not prompt pieces

Prompt pieces are the model-facing wording a plugin contributed — **not** a general inter-plugin data bus. When a plugin explicitly knows of another plugin's existence (install check), it must use that plugin's *data contract* (`turnContext.processed.*` / exports) for computation, not sift its rendered prompt text. No `prompt.find()`, discovery scan, or extra cross-plugin piece registry. (Unchanged verbatim *inclusion* of a known piece is section 6, not this rule.)

```js
if (tools.plugins.isInstalled('world_state_tracker')) {
  const state = turnContext.processed.worldState;
  if (state) {
    return tools.llm.json({
      model: 'mediumendmodel',
      requestId: 'state_check',
      instruction: `Using this world state:\n${JSON.stringify(state)}\n\nIdentify a contradiction.`
    });
  }
}
```

Rules:

- Declare the dependency as optional (`optionalDependencies`) and document the fallback.
- Check `isInstalled(...)` **and** the turn-phase data field that hook was supposed to write. "Installed" alone never proves this turn's data exists.
- Read `turnContext.processed.*` / `turnContext.output.*` for turn-local results, or the plugin's exported functions / database for persistent state. Do not `renderPromptSlot()` another plugin's piece just to re-parse its words.
- Attribute honestly: the resulting instruction belongs to the **calling** plugin.
- Do not extend `draft.includeOptional()` (or any new registry/slot-scanning API) to support this.

## 9. Cutover (authoritative; legacy removed)

Breakage is accepted; no fallback or legacy path is kept:

- Static exported `promptPieces` registration and `contribute(key, content)` are removed in favor of contribution-time definitions (`contribute({id, to, ...})`).
- `tools.prompt.piece()` returning a bare string is removed.
- Detection-only `draft.includeOptional()` and the throwing `_includeHistory` stub are replaced by `{include: '<plugin>.<piece>'}` and `{history: 'brief'|'balanced'|'deep'}` / `message.history('balanced')` on the same resolver.
- VN-background plugin calls require `{scene, instruction, requestId}` for plugin-owned suffixes; generic `core.vn_background.suffix` is not used for plugin tasks.
- History selection reads precomputed `runtime.historyData.compressedHistory`; no rebuild, no silent tier fallback, no duplicate inside VN-background, optional explicit `{history:{preset, maxChars}}` with recorded rendered bytes.
- If several occurrences share a component ID, inclusion requires `instanceKey`/`sourceId` — never a silent first match.
- An include selector's `instanceKey` chooses a stored occurrence; it is not a second rendered identity. The selected occurrence claims its key once. An included component's catalogue ancestry must match the slot where TurnContext actually stores it.
- Published prompt occurrences are immutable; manifest records consumer request + spans per inclusion (each including call bears its own usage; shared IDs never imply cache hits).

## 10. Open gaps / next

1. Broad migration: many standalone LLM callers still need conversion or checking. "Prompt model exists" is not "every call is mapped in the Atlas".
2. Finer-than-slot mount declarations (for example canon sub-mounts) — not implemented; `to` selects pillar + slot today.
3. Atlas wiring: feed real-turn traces plus provider cached-token counts into overlap/cost analysis; per-piece spans are not per-piece token bills.

Then run a stubbed complete turn, inspect traces and usage, and wire real-log export into the Atlas before expanding the plugin migration.

## 11. Tests that pin this behavior

- `engine/modules/plugin_manager/runtime/tools_builder.prompt.test.js` (18): contribution hierarchy, scoping, atomic conflicts, simple/structured/batch/VN-suffix compilation, raw-array rejection, verbatim `{include}` reuse, `{history}` selection in both `compose()` and structured requests, plus an actual configured Memory LOD view.
- `engine/modules/prompt/prompt.test.js` (18): ordering, spans, immutability, rehydrate, agent role policy, include provenance, forged-identity rejection, ambiguous instance-key selection, and wrong-slot rejection.
- `engine/modules/agent_runner.test.js`: full runner file green, including prepared-request assertions on the toolkit bridge.
- `engine/modules/prompt_builder_shared_prefix.test.js` (16), `engine/modules/vn_manager/background_llm_cache.test.js` (7), `engine/modules/prompt/prompt_core_catalog.test.js` (6), `engine/modules/turncontext.test.js` (2), `engine/modules/llm.test.js` (12), director/world-state suites green.

## 12. Six plugin scenarios — current answers (2026-09-27)

All examples run inside a plugin hook receiving `(turnContext, tools)`. Status words (`works now` / `forbidden` / `manual workaround`) describe the code as it stands, not a proposal.

### Case 1. A simple LLM call, reusing nothing — works now

```js
return tools.llm.json({
  requestId: 'scene_summary',
  model: 'mediumendmodel',
  prompt: 'Summarize the scene in one sentence.'
});
```

The toolkit compiles the string into a `PreparedPrompt` under the stable ID `my_plugin.scene_summary` (beneath `core.plugin_tasks`). No `promptPieces`, no `draft` callback, no core `callLLM({messages})`. `prompt:` and `instruction:` are aliases — never both, never alongside a `PreparedPrompt` or raw messages. Missing/blank `requestId` throws. Same `{requestId, model, prompt|instruction}` shape is required by `runTask`/`json`/`withSchema`/`batch`.

### Case 2. My request plus World State — read its data, don't include its prompt by default

```js
if (tools.plugins.isInstalled('world_state_tracker')) {
  const state = turnContext.processed.worldState;
  if (state) {
    return tools.llm.json({
      requestId: 'state_check',
      model: 'mediumendmodel',
      prompt: `Using this world state:\n${JSON.stringify(state)}\n\nIdentify a contradiction.`
    });
  }
}
```

That instruction is owned by the **calling** plugin (section 8). Do not `renderPromptSlot('root', 'simulation')` and paste the whole slot: that copies every simulation contributor and misattributes the copy. The supported alternative for fixed provenance is verbatim inclusion of the known piece inside a structured request (section 6) — but only when you want World State's unchanged model-facing occurrence in your request, not when you want its facts for computation.

### Case 3. Add data to canon — works now

```js
tools.prompt.contribute({
  id: 'bestiary',
  to: 'root.canon',
  label: 'Bestiary entries',
  description: 'Monster lore for this turn.',
  children: { vampire: 'Vampires fear running water.' }
});
```

This creates `root.canon → my_plugin.bestiary → my_plugin.bestiary.vampire`, owned by the calling plugin. Identity is defined where the content is supplied; the old string-key signature (`contribute('bestiary', …)`) throws. Placement is pillar + slot only — there are no finer `root.canon.characters`-style mounts yet.

### Case 4. Add `world_state_tracker.time.date` — another plugin cannot

Cross-plugin authoring throws. Only World State can nest beneath its own piece (or expose an explicit extension point, which does not exist today). A second plugin contributes its own sibling:

```js
tools.prompt.contribute({
  id: 'calendar_date', to: 'root.simulation', text: 'Day 3'
});
```

World State currently contributes `current_state` as a text leaf, so a separately measurable date requires World State itself to contribute a nested `time → date` child.

### Case 5. Reuse the VN-background prefix plus your task — named suffix, unchanged prefix

```js
return tools.llm.vnBackground.json({
  scene: 'raw',
  requestId: 'tension_score',
  instruction: 'Score the chapter’s tension from 0 to 3. Return JSON.',
  msg: 'Tension scoring'
});
```

The toolkit supplies the memoized two-message system+capsule prefix on the canonical route plus the cache gate; the suffix compiles to `my_plugin.tension_score` and is appended. Missing `requestId` fails instead of logging as generic `core.vn_background.suffix`. First two messages and `prefixHash` are asserted identical in tests — a task change never affects them. No `model`/`provider`/`messages`/`prompt` overrides.

### Case 6. Choose a history level — real supported selector

Simple call:

```js
return tools.llm.json({
  requestId: 'history_review', model: 'mediumendmodel',
  context: { history: 'balanced' },
  prompt: 'List unresolved threads.'
});
```

Advanced placement at an exact position:

```js
tools.prompt.compose('review', draft => {
  draft.user(message => {
    message.history({ preset: 'deep', maxChars: 4000 });
    message.separator('\n\n');
    message.add('task', 'List unresolved threads.');
  });
});
```

History is a **core-owned part** (`core.history.compressed.balanced`) rendered with the plugin instruction in one user message. It reads Memory LOD's already-computed `runtime.historyData.compressedHistory` view — never rebuilds it, never mutates `root.history`. Too-early selection throws; unknown presets throw `RangeError` (no silent fallback to another tier). Optional `maxChars` records full vs rendered character counts in the manifest. VN-background already carries capsule history, so `context.history` must not be added there.
