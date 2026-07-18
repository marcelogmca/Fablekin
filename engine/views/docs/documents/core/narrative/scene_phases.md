# Scene Phase Architecture (Dynamic Event Handoffs)

The Scene Phase system is the capability-handoff layer that prevents narrative "rushing" and enables plugins to own mechanical moments (combat, travel, resting, etc.).

## 1. Core Loop

The system uses a **Register -> Analyze -> Classify -> Resolve** loop:
1. Plugins register capabilities in Director-time hooks.
2. Director reasoning decides whether unresolved handoff pressure should be allowed.
3. Post-writer classification validates what the prose actually did.
4. Final phase/plugin ownership is resolved and exposed to runtime hooks.

---

## 2. Standard Scene Phases

| Phase | Description |
| :--- | :--- |
| `NORMAL` | Standard narrative flow. No handoff target. |
| `COMBAT` | Tactical or direct conflict scenes. |
| `TRAVEL` | Route movement, map progression, world traversal. |
| `RESTING` | Camp/downtime or interpersonal rest scenes. |
| `MINIGAME` | Specialized subsystem moments. |

---

## 3. Plugin Capability Registration

Register capabilities during Director prompt assembly:

```javascript
hooks: {
  HOOK_DIRECTOR_PRE_PROMPT: {
    run: async (context, tools) => {
      tools.director.registerCapability({
        phase: 'COMBAT',
        description: 'Turn-based tactical combat system.',
        handoffHint: 'Stop right as initiative begins.'
      });
    }
  }
}
```

This populates `context.runtime.director.registeredCapabilities`, which Director and classifier consume.

---

## 4. Gameplay Handoff Window

During Director execution, the engine evaluates capability-boundary repetition and emits/infers a structured handoff window:
- `context.processed.director.gameplayHandoffWindow.allowed`
- `context.processed.director.gameplayHandoffWindow.excludedPhases`
- `context.processed.director.gameplayHandoffWindow.reason`

If capabilities are registered, writer pacing guidance is now always injected in a dedicated section.
Director guidance is used to steer cadence and repetition, not to gate whether the section exists.

---

## 5. Writer Pacing Directions

Core injects an always-on writer pacing section when dynamic events (capabilities) are registered:
- Natural-language suggestions per event family (combat/rest/travel/etc.).
- Last-seen context per family (for cadence awareness).
- Explicit precedence rule: `WRITER_BRIEF` instructions override pacing suggestions.

This removed older "parse a director tag then inject or not" branching complexity.

---

## 6. Final Resolution Fields

After VN blocking tasks, the canonical resolved values are:
- `context.processed.director.scenePhase`
- `context.processed.director.scenePluginId`
- `context.processed.scenePhaseClassifier` (full diagnostic object)

Plugins should treat these as the final handoff truth for the turn.

---

## 7. Director Deny Signal Parsing

When the Director emits a deny directive (e.g., `deny_event`), parsing is constrained to content after the `--- WRITER_BRIEF ---` marker.
This avoids accidental triggering from analysis/CoT sections.

---

## 8. Triggering Intercepts Safely

Interception logic should run in post-generation hooks and check resolved phase/plugin IDs:

```javascript
hooks: {
  HOOK_POST_VN_GENERATION: {
    run: async (context, tools) => {
      const d = context.processed.director;
      if (d.scenePhase === 'COMBAT' && d.scenePluginId === 'my_combat_plugin') {
        await tools.gui.registerIntercept({
          id: 'combat_ui',
          checkpoint: 'on_dialogue_enter',
          blocking: true
        });
      }
    }
  }
}
```

When mechanical flow ends, plugins should feed structured outcome back through input override channels so the next narrative turn reflects the mechanical result.

---

## 9. Interlude Note

Interlude runs usually execute with `hookPolicy: "opt-in"`.
If your capability plugin must run in interludes, declare hook opt-in explicitly (for example `allowInterlude: true` or `sceneModes: ["interlude"]`).
