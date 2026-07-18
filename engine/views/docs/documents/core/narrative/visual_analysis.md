# Gaze & Variant Orchestration

Visual storytelling is driven by two specialized AI agents that analyze the narrative text to produce visual directives.

## 1. The Gaze Director (`focus_analyzer.js`)

The Gaze Director determines where characters should look during a scene.

### Process
1. **Dialogue Analysis**: Scans the text for cues like "X looked at Y" or "X turned toward the door".
2. **Focus Assignment**: Maps these cues to specific dialogue lines.
3. **Execution**: The output is a script of `focus` commands that the [UCP Compiler](../vn/ucp_compilation.md) uses to rotate or offset sprites on screen.

---

## 2. Sprite Variant Orchestrator (`sprite_variant_orchestrator.js`)

This agent manages the appearance (variants) of characters based on the story state.

### Key Concepts
- **Variant Locks**: A state that applies to a character for the entire turn (e.g., "damaged", "hooded").
- **Variant Schedule**: Changes that happen during specific dialogue lines (e.g., a character puts on a mask at line 4).
- **History Tracking**: The orchestrator checks the previous turn to ensure visual continuity. If a character was "disguised" in the last turn, they remain so until the story explicitly changes their state.

---

## 3. Sanitization & Safety

The orchestrator is strictly constrained by the **Character Catalog**:
- **Verification**: If the AI requests a "bloody" variant but the character's folder only has "default" and "happy", the orchestrator will automatically fallback to "default".
- **Normalization**: Ensures that requested variants match the internal filesystem naming conventions (lowercase, underscores).

---

## 4. World State Hints

The orchestrator also takes into account the **World State Synthesis**. If the story says it's raining, the orchestrator may automatically look for "wet" or "hooded" variants for characters outdoors.
