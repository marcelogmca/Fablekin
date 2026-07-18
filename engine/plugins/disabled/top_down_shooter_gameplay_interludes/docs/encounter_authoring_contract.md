# Top-Down Shooter Encounter Authoring Contract (v1)

This document defines the safe encounter JSON contract for `top_down_shooter_gameplay_interludes`.

## Allowed Top-Level Fields

- `schemaVersion`, `id`, `title`, `seed`
- `budgets`, `arena`, `renderPresets`, `runtimeSettings`
- `player`, `playerKit`
- `colors`, `pressurePattern`
- `projectileTypes`, `patterns`, `emitters`
- `enemyArchetypes`, `enemyTypes`
- `hazards`, `objects`, `pickups`, `statusEffects`
- `objectives`, `sequence`
- `music`, `resultRules`

Unknown top-level fields are ignored by runtime and should be treated as authoring warnings.

## Registry Reference Rules

All references must resolve to existing IDs:

- `spawn_enemy.enemyType` -> `enemyTypes`
- `fire_pattern.pattern` -> `patterns`
- `spawn_emitter.emitter`/`emitterId` -> `emitters`
- `spawn_hazard.hazard` -> `hazards`
- `spawn_pickup.pickup` -> `pickups`
- `apply_status.status` -> `statusEffects`
- `activate/complete/fail/set_objective_progress.objective` -> `objectives`

Invalid references should be considered authoring errors.

## Numeric Safety Ranges And Budgets

Runtime clamps values, but authoring should stay within:

- `maxEnemiesAlive`: `1..400`
- `maxEnemyBulletsAlive`: `10..3000`
- `maxPlayerBulletsAlive`: `10..2000`
- `maxEmittersAlive`: `0..300`
- `maxHazardsAlive`: `0..500`
- `maxPickupsAlive`: `0..300`
- `maxTelegraphsAlive`: `0..500`
- `maxActionsPerSecond`: `10..1000`
- `maxEncounterSeconds`: `15..3600`

Avoid relying on clamp behavior for intended balance.

## Fairness Constraints

- Dangerous attacks (`beam`, `beam_sweep`, `meteor`, `wall`) should have telegraph coverage in the same phase.
- Avoid unavoidable spawn pressure:
  - no unavoidable overlap of direct damage zones on player spawn
  - no instant full-screen beam without warning window
- Keep projectile readability:
  - avoid extreme burst density that exceeds budget-normal play
  - avoid invisible/near-invisible dangerous bullets.

## Difficulty Profiles (Normalizer)

Optional load-time profile can scale:

- enemy HP
- spawn counts
- projectile speed
- enemy bullet density/burst
- attack cadence/cooldowns
- player HP

Difficulty normalization is additive and opt-in. Base encounter data should still be valid without it.

## Valid Example (Minimal)

```json
{
  "schemaVersion": 2,
  "id": "valid_example",
  "enemyTypes": {
    "scout": {
      "hp": 10,
      "radius": 20,
      "speed": 1.2,
      "behavior": "chase_player",
      "attackPatternId": "enemy_spiral_pressure",
      "attackIntervalMs": 800
    }
  },
  "sequence": {
    "startPhase": "opening",
    "phases": [
      {
        "id": "opening",
        "enter": [{ "type": "spawn_enemy", "enemyType": "scout", "count": 2 }],
        "rules": [{ "when": { "type": "all_enemies_defeated" }, "do": [{ "type": "win" }] }]
      }
    ]
  }
}
```

## Invalid Example (Reference Error)

```json
{
  "schemaVersion": 2,
  "id": "invalid_example",
  "sequence": {
    "startPhase": "opening",
    "phases": [
      {
        "id": "opening",
        "enter": [{ "type": "spawn_enemy", "enemyType": "missing_enemy", "count": 1 }]
      }
    ]
  }
}
```

## Anti-Pattern Checklist

- Missing `win` path in sequence.
- Transitions to unknown phases.
- Phase graph with unreachable phases.
- Unknown registry references.
- Excessive action group size.
- Pattern modifier spam beyond readability.
- Recursive nested pattern references.
- Unsafe budget inflation as a design mechanism.
