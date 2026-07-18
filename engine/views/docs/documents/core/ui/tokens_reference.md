# Design System & Tokens

The engine uses a centralized Design Token system to ensure consistency across the Shell, the VN Viewer, and all internal tools.

## 1. Core Palette Tokens

These tokens define the brand identity and the "Feel" of the app.

| Token | Purpose | Default (Mint) |
| :--- | :--- | :--- |
| `--color-primary` | Primary action color (Buttons, active tabs). | `#10b981` (Emerald) |
| `--accent` | Secondary focus color. | `#3b82f6` (Royal Blue) |
| `--status-danger` | Destructive actions and warnings. | `#ef4444` (Red) |
| `--bg-base` | The deepest background layer. | `#0f172a` (Slate 900) |
| `--text-main` | The primary readable text color. | `#f1f5f9` (Slate 100) |

---

## 2. Layout & Spacing

The engine uses a **4px-base** spacing scale.

- **Spacing**: `--space-3xs` (4px) to `--space-3xl` (96px).
- **Rounding**: `--radius-sm` (4px) to `--radius-xl` (16px).
- **Z-Index**: Organized by functional layer (e.g., `--z-index-hud: 1000`, `--z-index-modal: 100000`).

---

## 3. Typography Stack

The engine requires variable fonts for modern aesthetics.

- **Main UI**: Satoshi (Variable) or GeneralSans.
- **Narrative**: GeneralSans (optimized for long-form reading).
- **Monospace**: Inconsolata (used for logs and internal IDs).

---

## 4. Glassmorphism Utilities

To achieve a premium look, the engine provides glass effect tokens.
- **Backgrounds**: `--glass-bg`, `--glass-bg-med`.
- **Effects**: `--glass-blur` (12px) and `--glass-saturation` (150%).
- **Borders**: `--glass-border` (Semi-transparent white/primary).
