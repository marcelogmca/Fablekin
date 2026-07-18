# Visual Layout & Overlays

This document explains the CSS architecture of the VN Viewer and how it manages the complex spatial relationships between narrative text, character sprites, and system notifications.

## 1. The HUD Orchestration (`layout.css`)

The viewer uses a **Flexbox Root** with a strictly enforced aspect ratio.
- **Aspect Ratio Locking**: The `#game-container` uses `max-width: calc(90vh * var(--ratio-cinematic))` to ensure that characters and backgrounds never distort regardless of the monitor's resolution.
- **The "Lip" Toggle**: The `#toggle-controls-btn` is a custom UI "notch" that allows the player to hide the input panels. It uses a CSS transition on `bottom` and `opacity` to smoothly transition into "Immersive Mode."

---

## 2. Interactive Overlays (`overlays.css`)

Overlays are managed through a tiered z-index system:
- **Z=10000**: The Dialogue Box.
- **Z=10001**: Navigation Controls and Fullscreen buttons.
- **Z=10002**: Mini Music Player and Tooltips.
- **Z=10003+**: Blocking System Popups (Status Manager).

### The Glassmorphism Stack
Every overlay implements the [Design System](./design_system.md) glass tokens:
```css
.overlay-panel {
    background: var(--glass-bg);
    backdrop-filter: var(--glass-blur);
    border: var(--border-thin) solid var(--glass-border);
}
```

---

## 3. Immersive Layouts

### Fullscreen Mode
When the viewer enters fullscreen (`body.fullscreen-mode`), several layout rules change:
- The `#vn-main-content` padding is removed.
- The border-radius of the `#game-container` is set to `0`.
- The `vn-hud-slot` (for plugin HUDs) becomes an absolute-positioned overlay instead of a flex-item, preventing layout shifts when HUDs appear.

---

## 4. UI Feedback & Micro-animations

- **The Blinking Cursor**: A CSS-only animation used at the end of dialogue lines to signal that the text has finished typing.
- **Navigation Cards**: Cards for "Next Chapter" use a scale-up transform and a primary-color glow effect on hover to guide the player's eye.
- **Notification Ticker**: Status notifications (`notifications.css`) use a keyframe-driven "slide-and-fade" entrance from the top-right corner.
