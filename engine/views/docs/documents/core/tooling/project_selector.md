# Project Selector & Lifecycle

The Project Selector is the application's entry point. It manages the filesystem organization of your creative projects.

## 1. Project Organization

Each project is stored as a directory within the `llmproj/projects/` folder. The selector identifies projects based on their **slug** (a URL-safe version of the project name).

### Filesystem Structure
- `/projects/[slug]/`
  - `world.json`: The core project configuration and lore.
  - `chat.db`: The SQLite database containing narrative turns.
  - `assets/`: Project-specific images and audio.

---

## 2. Project Lifecycle

The `renderer_project_selector.js` handles the core lifecycle actions:

- **Creation**: When a name is provided, the backend initializes the directory structure and creates a default `world.json`.
- **Renaming**: Updates the display name in the project metadata and renames the directory (if necessary).
- **Deletion**: A destructive action that removes the entire project folder. To prevent accidents, users must type "DELETE" into a confirmation modal.
- **Selection**: Once selected, the selector emits the `select-project` socket event. This tells the Electron main process to load the VN Viewer and point it to the specific project database.

---

## 3. Communication

The selector connects to the backend using a **Socket Token** passed via URL parameters.
- **Handshake**: The selector first requests all projects with `get-all-projects`.
- **Status Monitoring**: It listens for `connect_error` to alert the user if the backend server is unavailable.
