# Interlude Tools

Backend plugins can create headless interlude records through `tools.interludes.createProgrammatic(payload)`.

Use this when a plugin already has narrative content to persist without sending the user through normal Writer/VN generation. The helper does not execute the Writer, VN pipeline, or ordinary interlude hooks.

## createProgrammatic

```javascript
const saved = await tools.interludes.createProgrammatic({
  parentTurnNumber: context.turnNumber,
  pluginId: 'my_plugin',
  label: 'The Ruined Ford',
  title: 'The Ruined Ford',
  fulltext: transcript,
  summary: 'The party crossed the ruined ford and lost time after a failed shortcut.',
  synopsis: 'A dangerous crossing became part of the road behind them.',
  isStoryRelevant: true,
  integrationNote: 'Remember the delayed crossing and the damaged supplies.',
  metadata: {
    challengeId: 'ford_01'
  }
});
```

## Payload

| Field | Notes |
| --- | --- |
| `parentTurnNumber` | Required positive creation turn number for the mainline parent turn. |
| `pluginId` | Optional override. Defaults to the current plugin id. Stored in `runtime.interlude.pluginId`. |
| `label` | Interlude label. Falls back to `title`, then `Programmatic Interlude`. |
| `fulltext` | Canonical interlude prose or transcript. |
| `summary` | Parent-memory summary. Falls back to synopsis/fulltext when omitted. |
| `synopsis` | Short poetic or display synopsis. Falls back to summary/fulltext when omitted. |
| `title` | Output title. Falls back to label. |
| `abstractTitle` | Optional compact display title. |
| `prompt` | Optional prompt text stored on the generated interlude context. Defaults to the label. |
| `thumbnail` | Optional thumbnail path or payload passed through to interlude persistence. |
| `isStoryRelevant` | Defaults to `true`. Set `false` only for non-canonical or purely cosmetic records. |
| `integrationNote` | Optional note passed into parent interlude integration. |
| `metadata` | Plugin-owned object stored under `runtime.interlude.metadata`. |
| `refreshParentMemory` | Defaults to `true`. Set `false` only when the parent should not learn from this interlude immediately. |

## Behavior

`parentTurnNumber` is the positive creation-turn number of the mainline parent, not the database row ID. The helper requires an initialized active chat database, resolves that parent, builds a minimal interlude `TurnContext`, sets `sceneMode = 'interlude'`, fills narrative output fields, adds a minimal sequence, then calls `chaptermanagement.appendInterlude()`.

`fulltext` is preferred, but the helper falls back through summary, synopsis, and label so a record can still be created when only a concise result is available.

The helper does not mutate the parent turn's `output.fulltext`. With the default `refreshParentMemory: true`, the parent summary/synopsis/RAG integration can still learn the interlude result.

## Return Value

```javascript
{
  interludeId: 123,
  ordinal: 2,
  displayTurn: '45.2',
  isStoryRelevant: true,
  integrationState: {},
  parentRefresh: {}
}
```

`displayTurn` is the parent creation turn plus interlude ordinal. The persisted context also records `runtime.interlude.storageTurnKey` with the same value. Plugin-owned facts should use the normal fact scope and a plugin-specific predicate; only add an interlude ID to custom fact data when another system needs to reconnect to this exact record.

`integrationState` is a string. Story-relevant interludes begin as `pending`; non-story-relevant ones begin as `none`. `refreshParentMemory` refreshes summaries and retrieval material, but does not by itself mark an interlude `integrated`.

## Ownership

Programmatic interludes do not require a dedicated database column for plugin ownership. Store ownership in:

```javascript
runtime.interlude.pluginId
runtime.interlude.metadata
```

If a plugin reads interlude-derived facts, it should filter by its own plugin id or fact predicate so unrelated plugin interludes do not bleed through.
