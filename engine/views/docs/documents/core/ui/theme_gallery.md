# Theme Gallery & Customization

The engine supports a fully swappable theme system. Themes are defined as CSS files in the `engine/themes/` directory.

## 1. Built-in Themes

### Mint (Default)
- **Vibe**: Modern, clean, and productive.
- **Colors**: Emerald Greens and Slate Blues.
- **Best For**: General writing and engine exploration.

### Cyberpunk
- **Vibe**: High-contrast, neon-infused.
- **Colors**: Neon Pink, Cyan, and Deep Blacks.
- **Best For**: Sci-fi narratives and high-energy sessions.

### Dark Fantasy
- **Vibe**: Moody, organic, and historical.
- **Colors**: Blood Red accents and parchment-like depth.
- **Best For**: Medieval or Horror storytelling.

### Blueish Soft
- **Vibe**: Calm, low-eye-strain.
- **Colors**: Soft Indigo and Lavender.
- **Best For**: Long night-time writing sessions.

---

## 2. Global Shell Styles (`style.css`)

The Shell (the outer container of the app) uses the active theme's variables to style:
- **Titlebar**: Custom window controls and drag regions.
- **Tabs**: The navigation system between the Project, Viewer, and Tools.
- **Modals**: Global overlays for confirmation and errors.

---

## 3. Creating a Custom Theme

To create a new theme:
1. Create a new `.css` file in `engine/themes/`.
2. Define the required `:root` variables (see [Design System & Tokens](tokens_reference.md)).
3. Update the `infrastructure.theme` field in `workspace/settings.json` to point to your new file.
