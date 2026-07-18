# Run Profiles & Virtual Turns (Interludes)

Run Profiles are the declarative control layer for VN turn execution.
They define how a run behaves across persistence, hook execution, and response timing.

## 1. Why Run Profiles Exist

Without profiles, behavior is spread across ad-hoc checks (`if interlude then ...`).
Profiles centralize that behavior so new flow types can be added without rewriting pipeline logic.

---

## 2. Built-In Profiles

| Profile ID | Scene Mode | Canonical Writes | Hook Policy | Await Background Tasks |
| :--- | :--- | :--- | :--- | :--- |
| `mainline` | `mainline` | Yes | `all` | No |
| `interlude_story` | `interlude` | No | `opt-in` | Yes |
| `interlude_sandbox` | `interlude` | No | `opt-in` | Yes |

---

## 3. Resolution Rules

Profiles are resolved in this order:
1. Explicit `runProfileId` (or alias `runProfile`) from caller payload.
2. If mode is `interlude` and no explicit profile:
   - `isStoryRelevant=true` -> `interlude_story`
   - otherwise -> `interlude_sandbox`
3. Default mainline -> `mainline`

If mode/profile mismatch is requested, the run is rejected.

---

## 4. Interlude API Contract

`generate-interlude-turn` accepts:
- `parentTurnNumber`
- `prompt`
- `runProfileId` (optional, recommended for deterministic behavior)
- `runProfile` (optional alias)
- plus normal optional fields (`directorPrompt`, `softFeedback`, `label`, `isStoryRelevant`)

Response includes effective:
- `interlude.runProfileId`
- `interlude.ordinal`
- `interlude.displayTurn` (format: `parent.ordinal`, example `53.1`)

---

## 5. Prompt Restore Contract for Virtual Runs

Interlude runs restore prompt context from the parent chapter's serialized writer snapshot:
- Canonical chapters persist `writer_prompt_snapshot` in `chat_turns`.
- Interlude prompt assembly restores canon/dynamic/simulation/history context from that snapshot before generation.

This keeps interlude generations context-rich even when some plugins are opt-in for interlude mode.

---

## 6. Virtual-Turn Safety Guarantees

When a profile sets `canonicalWrites=false`:
- VN pre-commit to canonical turn table is skipped.
- Post-background canonical update is skipped.
- Interlude state is saved to `chat_interludes` only.

This ensures virtual turns do not advance or pollute the canonical timeline.

---

## 7. Storage Keying for Plugin Files

Managed plugin storage uses a turn storage key:
- Mainline chapter: `53`
- Interlude: `53.1`, `53.2`, ...

This prevents collisions between chapter and interlude artifacts (for example TTS cache files).

Cleanup behavior:
- Rewind/delete chapter `53` removes folder `53` and all `53.*`.
- Branch pruning compares base chapter number, so `54` and `54.*` are pruned together when branching before 54.

---

## 8. Turn Logger Behavior

Interlude generation starts its own turn log file (same logger facility as mainline generation).
This isolates diagnostics per run and avoids interlude logs being appended into the parent chapter log.
