# Top-Down Shooter Plugin Implementation Plan

## Purpose
This plan converts the QA audit findings into a repair sequence for the `top_down_shooter_gameplay_interludes` plugin. The goal is to make the large shooter interlude reliable enough for authoring, fixture validation, and normal VN integration, without broad rewrites or cosmetic cleanup before the high-risk contract bugs are fixed.

## Ground Rules
- Fix integration contracts before polishing runtime features.
- Keep changes targeted and reviewable.
- Preserve the currently playable happy path while adding support for authored encounters.
- Prefer visible author/player failures over silent fallback when encounter data is invalid.
- Add or update tests only where they directly protect a repaired contract.

## Phase 1: Fix Overlay Lifecycle And Result Delivery

### Problem
The plugin registers the combat overlay as a nonblocking persistent intercept with `autoDismiss: false`, but the UI calls `bridge.intercept.resolve()` as if the intercept were blocking. In the VN intercept orchestrator, nonblocking intercept `resolve()` is intentionally a no-op, so combat results are not delivered through the expected finalize path and the host overlay may not close through the normal lifecycle.

### Files To Inspect
- `logic.js`
- `frontend/overlay/ui_controller.js`
- `engine/views/vn_viewer/js/intercept_orchestrator.js`
- Existing GUI intercept examples in other plugins that submit data or close reliably

### Implementation Options
1. Preferred: make the combat overlay a blocking interlude when gameplay is active.
2. Alternative: add a supported nonblocking bridge close/result API in the orchestrator and use it from the plugin.

### Tasks
- Decide whether gameplay should block VN input while active.
- If blocking, change the registered intercept contract in `runPostVnGeneration`.
- Verify `continueStory()` resolves through the orchestrator finalize path.
- Ensure cleanup runs exactly once on continue, retry, dispose, and navigation.
- Confirm `combatResult` is available to the post-intercept VN flow or whichever downstream consumer is intended to read it.

### Acceptance Criteria
- Pressing Continue closes the overlay through the normal intercept lifecycle.
- `combatResult` is observable in the resolved intercept result.
- No stale nonblocking overlay host remains after continuing.
- Retry still restarts gameplay without resolving the intercept.

## Phase 2: Add Encounter Selection Payload Contract

### Problem
The backend payload does not include an encounter id or encounter definition, and the runtime always loads `tds_glass_ambush_v1`. This disconnects fixtures, schema work, and future LLM-authored encounter generation from actual gameplay.

### Files To Inspect
- `logic.js`
- `frontend/runtime/combat_runtime.js`
- `frontend/runtime/encounter_loader.js`
- `frontend/runtime/encounter_schema.js`
- `frontend/overlay/ui_controller.js`

### Tasks
- Define the payload contract:
  - `encounterId` for existing registered encounters.
  - Optionally `encounterDefinition` for generated inline encounters.
  - Optional `encounterSource` or `debugLabel` for diagnostics.
- Pass the selected encounter data from `logic.js` into the rendered UI payload.
- Update `combat_runtime.js` to load from `payload.encounterId` or validate/register `payload.encounterDefinition`.
- Preserve default fallback to `tds_glass_ambush_v1` only when no encounter is supplied.
- Make invalid supplied encounter data visible instead of silently falling back.

### Acceptance Criteria
- A supplied encounter id changes the actual loaded encounter.
- A missing encounter id still loads the current default happy path.
- Invalid supplied data produces an actionable UI error or clear fallback warning.
- Runtime state exposes the selected encounter id/source for debugging.

## Phase 3: Repair Pattern Schema Normalization

### Problem
`normalizeEncounter()` preserves only `enemy_spiral_pressure` under `patterns`, while runtime supports arbitrary pattern ids. Several shipped fixtures define custom pattern ids and then fail validation or no-op at runtime.

### Files To Inspect
- `frontend/runtime/encounter_schema.js`
- `frontend/runtime/patterns/pattern_registry.js`
- `frontend/runtime/combat_runtime.js`
- `frontend/runtime/enemy_runtime.js`
- `frontend/runtime/encounters/boss_duel_example.js`
- `frontend/runtime/encounters/milestone6_enemy_fixture.js`
- `frontend/runtime/encounters/milestone7_boss_fixture.js`
- `frontend/runtime/encounters/projectile_showcase_example.js`

### Tasks
- Preserve every object entry from `raw.patterns`.
- Normalize supported fields consistently across pattern ids:
  - `type`
  - `count`
  - `speed`
  - `spacing`
  - `spreadDegrees`
  - `baseAngle`
  - `angleOffset`
  - `projectileType`
  - `aim`
  - `modifiers`
- Validate pattern `type` against the registered pattern types.
- Validate `projectileType` against known projectiles.
- Keep `enemy_spiral_pressure` as a default pattern when no patterns are supplied.
- Re-run fixture validation after changes.

### Acceptance Criteria
- Existing custom-pattern fixtures validate unless they have unrelated real defects.
- Enemy attacks using custom pattern ids fire at runtime.
- Unknown pattern ids still produce validation errors at the referencing action/attack.

## Phase 4: Make Validation Errors Actionable

### Problem
Runtime collects `validationErrors`, but start continues and only exposes those errors in debug state. This allows malformed encounters to partially execute with no visible failure.

### Files To Inspect
- `frontend/runtime/combat_runtime.js`
- `frontend/runtime/encounter_loader.js`
- `frontend/overlay/ui_controller.js`
- `frontend/templates/overlay.html`

### Tasks
- Treat `loadEncounterResult().ok === false` or non-empty errors as a failed encounter load.
- Surface validation errors in the overlay with concise author-facing text.
- Do not enter `playing` phase for invalid supplied encounters.
- Decide whether invalid default fixtures should hard fail in dev and fall back in production.

### Acceptance Criteria
- Invalid encounter data does not start gameplay silently.
- The first few validation errors are visible in the overlay or logs.
- The default encounter still starts normally.

## Phase 5: Validate Sequence Action Groups

### Problem
The schema validator walks phase `enter` actions and rule actions, but it does not recursively validate `sequence.actionGroups`, even though `run_action_group` executes them.

### Files To Inspect
- `frontend/runtime/encounter_schema.js`
- `frontend/runtime/sequence_runner.js`
- `frontend/runtime/registries/action_registry.js`
- `frontend/runtime/encounters/milestone10_sequence_fixture.js`

### Tasks
- Extend action collection to include `sequence.actionGroups`.
- Preserve origin labels in errors, such as `phase intro`, `actionGroup reinforcements`, or `delayed action`.
- Recursively inspect nested `actions` arrays and delayed action lists.
- Validate references inside action groups exactly like phase actions.

### Acceptance Criteria
- Unknown refs inside action groups fail validation before runtime.
- Existing valid sequence fixture remains valid.
- Error messages tell authors where the bad action lives.

## Phase 6: Align Inline Pickup Object Support

### Problem
Runtime supports inline pickup objects in `spawn_pickup`, but schema validation stringifies the object and reports it as unknown pickup `"[object Object]"`.

### Files To Inspect
- `frontend/runtime/encounter_schema.js`
- `frontend/runtime/combat_runtime.js`
- `frontend/runtime/encounters/milestone15_render_feedback_fixture.js`
- `frontend/runtime/encounters/milestone13_pickups_fixture.js`

### Tasks
- Choose one contract:
  - Support inline pickup objects officially.
  - Or require pickup ids only.
- If supporting inline objects, validate them with the same rules used for named pickup definitions.
- If requiring ids only, update fixtures and runtime warnings accordingly.

### Acceptance Criteria
- `milestone15_render_feedback_fixture.js` no longer fails with `[object Object]`.
- Invalid inline pickup objects produce useful field-level validation errors.
- Runtime and schema agree on supported authoring shape.

## Phase 7: Repair Boss `noRepeatWindow`

### Problem
Boss phase `noRepeatWindow` is normalized and history is recorded, but attack selection does not use that history.

### Files To Inspect
- `frontend/runtime/enemy_runtime.js`
- `frontend/runtime/encounters/milestone7_boss_fixture.js`

### Tasks
- In boss attack selection, filter attacks that appear in `noRepeatHistory`.
- If filtering would remove every valid attack, fall back to the original valid list.
- Keep cooldown, trigger, `once`, and attack deck logic intact.
- Add a narrow test or fixture assertion if the project has a suitable test harness.

### Acceptance Criteria
- Bosses avoid repeating recent attacks when alternatives are available.
- Bosses do not stall when the no-repeat window is larger than the available attack set.
- Existing boss fixture behavior remains playable.

## Phase 8: Separate Production Payload From Fixtures

### Problem
`logic.js` currently reads and injects every runtime fixture and showcase encounter into every overlay, including intentionally invalid fixtures. This increases payload size and makes test content part of live runtime surface.

### Files To Inspect
- `logic.js`
- `frontend/runtime/encounter_loader.js`
- All files under `frontend/runtime/encounters/`

### Tasks
- Decide which encounter(s) are production defaults.
- Inject only required encounters for the selected payload in normal mode.
- Keep fixtures available for dev/debug mode or tests.
- Avoid registering intentionally invalid fixtures in normal gameplay.

### Acceptance Criteria
- Normal overlay payload includes only runtime modules plus required encounter data.
- Debug/dev mode can still access examples if needed.
- Intentionally invalid fixture is not live in production overlay registry.

## Phase 9: Clean Tooling And Legacy Drift

### Problem
ESLint currently reports many template-global/browser-global issues, which makes the plugin hard to lint meaningfully. Legacy top-level UI files are placeholders and one still references an unrelated class name.

### Files To Inspect
- `engine/scripts/eslint.config.js`
- `frontend/overlay/ui_controller.js`
- `frontend/runtime/player_runtime.js`
- `ui.html`
- `ui.js`
- `ui.css`
- `ui_scene_runtime.js`

### Tasks
- Add plugin-specific ESLint globals for generated UI placeholders and browser APIs.
- Clean unused variables and unused catch args after config noise is removed.
- Rename or remove stale placeholder markup if compatibility allows.
- Document whether top-level UI files are legacy compatibility files or dead code.

### Acceptance Criteria
- Plugin-targeted ESLint output is useful and mostly signal.
- Legacy files no longer look like copied camp-rest artifacts.

## Validation Commands
Run from `engine/` unless noted.

```powershell
npx eslint plugins/top_down_shooter_gameplay_interludes --config scripts/eslint.config.js -f stylish
```

Run a syntax/import sanity check over plugin JavaScript files.

```powershell
node -e "const plugin=require('./plugins/top_down_shooter_gameplay_interludes'); console.log(JSON.stringify({id:plugin.id,hooks:Object.keys(plugin.hooks||{}),exports:Object.keys(plugin.exports&&plugin.exports.guiIntercepts||{})}))"
```

Run or create a fixture validation script only if the implementation pass includes tests. At minimum, validate that these fixtures no longer fail for contract bugs:

- `boss_duel_example.js`
- `milestone6_enemy_fixture.js`
- `milestone7_boss_fixture.js`
- `projectile_showcase_example.js`
- `milestone15_render_feedback_fixture.js`

## Suggested Commit Slices
1. Intercept lifecycle and result delivery.
2. Encounter payload selection and validation failure UI.
3. Pattern schema preservation plus fixture validation.
4. Action group and pickup schema alignment.
5. Boss no-repeat behavior.
6. Fixture payload split and tooling cleanup.

## Known Starting Workspace State
At the time this plan was written, these unrelated local changes already existed:

- Deleted `ARCHITECTURE.md`
- Deleted `codex_plan_progress.md`
- Deleted `implementation_plan.md`
- Deleted `llm_level_design_expansion_plan.md`
- Modified `workspace/settings.json`

Do not revert those unless explicitly instructed.
