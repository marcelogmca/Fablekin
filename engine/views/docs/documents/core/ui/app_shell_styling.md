# App Shell & View Styles

The visual experience of the engine is governed by a set of localized stylesheets that extend the [Global Design System](./design_system.md).

## 1. The Custom Titlebar (`titlebar.css`)

Since the application runs in a frameless Electron window, a custom titlebar is used to provide native-like controls.
- **Draggable Region**: Uses `-webkit-app-region: drag` to allow moving the window via the top bar.
- **Fullscreen Suppression**: The titlebar is automatically hidden when the engine enters `vn-fullscreen-mode` to maximize immersion.
- **Z-Index Positioning**: Locked to `var(--z-index-nav)` to ensure it stays above all content but below modals.

---

## 2. Localized View Styles

Each major module has its own `style.css` that handles its unique layout requirements:
- **VN Viewer**: Focuses on the **16:9 Cinematic Lock**, immersive dialogue overlays, and the generation status HUD.
- **Content Manager**: Manages the hierarchical tree spacing, the schema-based form layout, and the drag-and-drop indicators.
- **Timeline**: Implements the **World-Space Coordinate System** for connection lines and the pan/zoom viewport constraints.
- **Project Selector**: Handles the grid/list transition for project cards and the "New Project" creation flow.

---

## 3. UI Component Overrides

Individual CSS files like `settings.css` or `premium_select.css` (lib) provide specialized styling for shared components:
- **Glassmorphism**: Applied via `backdrop-filter: blur()` and `saturate()` tokens to provide a premium feel to overlays.
- **Theme Harmonization**: High-contrast elements are often filtered using `brightness` and `contrast` tokens at runtime to ensure they remain readable across different background assets.
