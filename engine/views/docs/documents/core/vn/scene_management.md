# Scene & Sprite Lifecycle

The `pixi_sprite_manager.js` and camera systems work together to transform narrative data into a cinematic experience.

## 1. Sprite Anatomy

Every character sprite in the engine is a composite of multiple layers:
- **`backFX`**: Container for character-specific background effects (e.g., shadows).
- **`body`**: The primary character texture (the "Base").
- **`frontFX`**: Container for overlays like blushes or sweat.

### Dynamic Layers
If textures exist with the proper naming convention, the engine automatically enables:
- **Blink**: A random loop that toggles an overlay (e.g., `_blink.png`).
- **Talk**: An emulated lip-sync loop that triggers when the character's audio is playing.

---

## 2. Intercept Actor Lifecycle

The sprite manager also supports plugin-owned intercept actors:
- **Spawn/Update/Remove**: Intercept runtime can create temporary actors independent from native scene slots.
- **Scoped Ownership**: Actors are namespaced per intercept run id and tracked in a dedicated session map.
- **Automatic Teardown**: Session actors are cleared when intercepts resolve, timeout, or chapter context resets.
- **Visibility Safety**: Native sprite hide locks only affect native scene sprites; plugin actors remain renderable.

---

## 3. Sprite Morphing

When a character's expression or position changes, the engine uses one of three "Morph" methods:
- **Motion Blend (Default)**: A randomized "Slingshot" transition. The sprite crossfades while performing a subtle, non-choreographed jiggle to settle into the new state.
- **Cross Fade**: A simple alpha transition.
- **None**: Instant texture swap.

---

## 4. Cinematic Camera

The camera system uses **GSAP** to manipulate the `world` container.
- **Auto-Framing**: The `zoomToCharacter` command calculates the ideal bounding box for a character's face or body based on their current slot.
- **Handheld Wobble**: When zoomed in, the camera automatically adds a subtle breathing wobble (`vfx:start-wobble`) to make the scene feel "filmed."
- **Focus Dimming**: When the camera focuses on one character, others are automatically dimmed to guide the player's eye.

---

## 5. Game Over Logic

The `pixi_game_over.js` module provides a dedicated "Death Screen" state:
- Dimming the entire scene (Background/Characters).
- Displaying high-contrast stylized text.
- Using an `elastic.out` animation to make the impact feel "heavy."
