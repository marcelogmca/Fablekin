# Theme & Variable Architecture

The engine uses a comprehensive CSS variable system to ensure design consistency and support deep customization.

## 1. Global Token System (`dark.css`)

The master theme defines several tiers of variables:
- **Brand Palette**: Core primary/secondary colors and their HSL variants for programmatic transparency.
- **Surface Scale**: Tiers of background colors (`bg-surface-1` through `bg-surface-hover`) using the Zinc palette.
- **Glassmorphism**: Predefined blur (`var(--glass-blur)`) and saturation levels for translucent panels.
- **Typography Scale**: A modular scale from `3xs` to `3xl`, ensuring consistent vertical rhythm.
- **Geometry**: Standardized border-radii (`radius-lg`) and spacing increments.

---

## 2. Layer Stacking (Z-Index)

To prevent visual overlaps, the engine uses a standardized z-index tier system:
- **`z-index-base` (0)**: Background assets and gameplay layers.
- **`z-index-hud` (1000)**: UI elements, buttons, and status bars.
- **`z-index-nav` (1500)**: Navigation menus and the custom titlebar.
- **`z-index-notification` (1800)**: Toasts and non-blocking status updates.
- **`z-index-overlay` (2000)**: Full-screen dimmers and generation blocking screens.
- **`z-index-modal` (100000)**: Primary interaction dialogs.
- **`z-index-tooltip` (110000)**: The absolute top-most layer.

---

## 3. Theme Harmonization

The engine includes a "Harmonization Filter" that is applied to dynamic UI containers (like plugins or custom select menus):
- **Brightness & Contrast**: Automatically adjusted via `filter: brightness(var(--theme-plugin-brightness))` to ensure third-party UI fragments fit the current theme's luminosity.
- **Saturation**: Desaturated by default to maintain the "Codex" visual style, while boosting on hover for interactive feedback.
