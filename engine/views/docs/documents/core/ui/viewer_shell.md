# Viewer Shell & HUD Layout

The **Viewer Shell** (`viewer.html` and `renderer_vn.js`) is the primary interface for the player. It orchestrates multiple complex systems into a single immersive experience.

## 1. DOM Structure

The layout is divided into several high-level layers:

- **The HUD Layer (`#vn-hud-slot`)**: A slot where plugins can inject custom UI elements (gauges, buttons, info panels) that sit on top of the visual novel but behind the blocking overlays.
- **The World Layer (`#vn-canvas`)**: The [PixiJS WebGL Canvas](../vn/pixijs_renderer.md) where characters, backgrounds, and VFX are rendered.
- **The Dialogue Layer (`#dialogue-container`)**: Contains the character name box, the scrolling dialogue text, and the [UCP Controls](../vn/ucp_protocol.md).
- **The Input Layer (`#user-input-container`)**: A three-pane input system for **Director**, **Player**, and **Feedback** messages.

---

## 2. Global Orchestration (`renderer_vn.js`)

When the viewer loads, it performs a serialized initialization sequence:
1. **Cache**: Pre-registers all CSS selectors in [Elements Reference](./common_components.md).
2. **Settings**: Loads the user's volume, font size, and visual preferences.
3. **Graphics**: Bootstraps the PixiJS WebGL context and starts the rendering loop.
4. **Logic**: Connects to the Socket.IO server and registers the view for real-time updates.

---

## 3. Dynamic Overlays

The shell manages several situational overlays:
- **Prologue Overlay**: A special full-screen state for starting a new story.
- **Game Over Screen**: Triggered when a narrative path terminates, providing the **Undo** mechanism.
- **History Log**: A sliding panel that displays the `Dialogue History`.
- **Status Popup**: The central generation progress indicator.

---

## 4. Fullscreen & Immersive Mode

The viewer supports an "Immersive UI" mode (`#toggle-controls-btn`) that hides the input panels and auxiliary buttons, leaving only the dialogue text and the visual scene.
