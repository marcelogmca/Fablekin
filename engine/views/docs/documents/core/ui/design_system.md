# Design System & Tokens

The engine uses a unified design system powered by CSS custom properties (variables). This ensures visual consistency across the main application, the VN viewer, and all plugin-contributed views.

## 1. Global CSS Tokens

All themes define a set of core tokens in the `:root` scope.

### Brand Colors
- `--color-primary`: The signature accent color (e.g., Gold).
- `--color-secondary`: A contrasting color for badges and info.
- `--status-success` / `--status-warning` / `--status-danger`: Semantic colors for feedback.

### Depth & Surfaces
- `--bg-base`: The deepest background layer.
- `--bg-surface-1`: Used for sidebars and primary panels.
- `--bg-surface-2`: Used for cards and inner containers.
- `--bg-gradient`: The signature app-wide background gradient.

### Glassmorphism
- `--glass-bg`: Semi-transparent background for floating panels.
- `--glass-blur`: Standard backdrop filter strength (`12px`).
- `--glass-border`: Subtle accent border for glass containers.

---

## 2. Typography

The engine uses three main font families, mapped to functional aliases:

| Alias | Font Family | Usage |
| :--- | :--- | :--- |
| `--font-ui` | Inter | Standard UI controls, labels, and inputs. |
| `--font-cinematic` | Cinzel | Headings, character names, and cinematic overlays. |
| `--font-narrative` | CormorantGaramond | Body text in novels or deep-prose views. |
| `--font-mono` | Fira Code | Logs, debug views, and code snippets. |

---

## 3. Spacing & Geometry

Consistent spacing is maintained through a 4px-based grid system:
- `--space-xs`: 8px
- `--space-md`: 16px
- `--space-xl`: 32px
- `--radius-md`: 8px (Standard rounded corners)
- `--radius-lg`: 16px (Card and modal corners)

---

## 4. Applying Themes

Themes are stored in `engine/themes/` as standalone CSS files. The engine applies a theme by copying its contents into `engine/themes/active/global.css`, which is linked in every HTML view. This allows for real-time theme switching without restarting the application.
