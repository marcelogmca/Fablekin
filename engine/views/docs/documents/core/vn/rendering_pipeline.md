# VN Rendering & Gaze

The rendering pipeline (`engine/modules/vn_manager/rendering/`) translates the logical script into a sequence of visual commands for the PixiJS frontend.

## 1. Sprite Finding

The `SpriteFinder` is the asset resolution engine.

### Selection Hierarchy
1. **Exact Match**: Matches `name_emotion_rotation.png`.
2. **Path Mapping**: Resolves aliases and strips Japanese honorifics (`-san`, `-chan`).
3. **Fallback Strategy**: If an emotion is missing, it falls back to `neutral`. If a character is entirely missing, it uses a deterministic generic NPC based on gender.
4. **Consistency**: Uses a deterministic hash of the character name to ensure a generic NPC always looks the same throughout an entire adventure.

---

## 2. Sprite Positioning

The `SpritePositioner` manages the virtual "Stage."

### Slot Logic
- **Capacity**: Supports up to 3 slots (Left, Center, Right).
- **Filling**: Fills from the center outward (1 → 0 → 2).
- **Heat Map**: When all slots are full and a new character enters, it replaces the character who has spoken the least recently (lowest "heat").

### Auto-Leave Heuristics
To prevent "Sprite Bloat," characters are automatically hidden if:
- They finish their dialogue early in the turn (Leave Early).
- There is a large gap (>30% of the turn) between their dialogue lines (Temporary Exit).

---

## 3. Gaze & Rotation (The Gaze Director)

The engine implements a sophisticated gaze management system.

### Automated Gaze
By default, the engine uses **Auto Gaze**: 
- The current speaker faces the camera (`front`).
- All other characters on screen rotate their heads/bodies to face the speaker (`left` or `right`).

### Manual Overrides
Plugins can issue specific gaze commands:
- `look:<char>:<target>:<duration>`: Forces a character to look at a specific target.
- `focus:away`: Forces a character to turn their back to the camera (`back`).

### Technical Stability
The positioner remembers the last rotation for every character. This ensures that during long narrative blocks, characters don't "reset" to the front, maintaining a stable visual composition.
---

## 4. Scene Persistence

The `ThumbnailGenerator` captures a visual snapshot of the final frame of every turn. This image is stored in the SQLite database and used in the **Scene History** view for narrative navigation.
