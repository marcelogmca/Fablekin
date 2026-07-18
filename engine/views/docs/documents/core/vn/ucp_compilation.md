# UCP Protocol & Compilation

The **Universal Cinematic Protocol (UCP)** is the domain-specific language used to describe Visual Novel scenes. The engine uses a JIT (Just-In-Time) compiler to transform these commands into a frame-by-frame state.

## 1. Command Syntax

UCP commands are colon-separated strings: `prefix:action:payload[:modifiers]`.

| Category | Examples |
| :--- | :--- |
| **Camera** | `cam:wide`, `cam:auto:instant` |
| **Animations** | `anim:bounce:dehya`, `anim:shake:skirk` |
| **Visual FX** | `vfx:start:glitch:{"intensity":0.8}`, `vfx:clear:heat` |
| **Audio** | `sfx:trigger:boom.mp3`, `sfx:start:rain.mp3:locked` |
| **System** | `cast:flush`, `gameover:You Died:Reloading...` |

---

## 2. JIT Compilation Process

When a turn begins, the `vn_ucp_compiler.js` processes the entire sequence to generate the **Director State**.

### Persistence & Age
- **VFX State**: Effects like "Glitch" or "Grain" persist across dialogue lines until explicitly cleared or their duration expires.
- **Aging**: The compiler increments the "Age" of active effects every line. Harsh effects (like camera shakes) are automatically terminated after a safety limit (default: 5 lines).

### Stickiness
- **Auto-Zoom**: If a character speaks and auto-zoom is enabled, the camera remains focused on them through subsequent narrator lines, provided the character doesn't leave the scene.
- **Cast Flush**: The `cast:flush` command keeps the screen cleared of sprites until a new character starts speaking.

---

## 3. Custom Event Dispatching

The `vn_ucp_dispatcher.js` acts as the bridge between the story script and the rendering managers.
1. **Parse**: Converts UCP strings into structured objects.
2. **Dispatch**: Fires a DOM `CustomEvent` (e.g., `vn:emote`).
3. **Listen**: Specialized modules (PixiJS, Audio, TitleManager) listen for these events and execute the visual changes.
