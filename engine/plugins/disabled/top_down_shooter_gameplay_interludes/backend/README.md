# Backend Module Staging

This folder is staged for incremental extraction from `logic.js`.

- `hooks/`: isolated hook handlers.
- `services/`: data and business logic modules.
- `ui_builders/`: declarative GUI intercept payload builders.

Keep extraction behavior-preserving: move one cohesive subsystem at a time and re-export through `logic.js` during migration.
