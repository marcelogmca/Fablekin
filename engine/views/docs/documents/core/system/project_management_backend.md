# Project Management Backend

The main process coordinates all high-level project operations, ensuring data integrity and filesystem consistency.

## 1. Project Lifecycle (`project_handlers_base.js`)

This module defines the foundational CRUD operations for the entire application.
- **Discovery**: Scans the `workspace/projects` directory and resolves metadata (like the display name) from internal `.config` files.
- **Creation Scaffolding**: When a new project is created, the handler automatically generates the core directory structure (`1_Directives`, `2_Lore_Book`, etc.) and injects placeholder templates for a faster start.
- **Migration & Renaming**: Renaming a project is a complex operation that involves:
    - Moving the root directory.
    - Renaming internal `.db` (Chronicles) files.
    - Updating the internal `.config` JSON to reflect the new project name.

---

## 2. Infrastructure Coordination

The backend handlers act as a bridge between several specialized managers:
- **Chapter Management**: Interfaces with the database engine to initialize new "Save" files.
- **Content Management**: Calls the file config store to persist per-file metadata (order, processing mode).
- **UI Bridge (`ui_handlers.js`)**: Coordinates "Tab Switching" signals, ensuring that when a project is selected, the frontend automatically navigates to the VN Viewer or Content Manager as appropriate.
