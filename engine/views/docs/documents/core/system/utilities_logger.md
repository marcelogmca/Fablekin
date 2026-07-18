# Core Utilities & Turn Logging

The `utils.js` module is the backbone of the engine's supporting logic, providing a unified interface for logging, configuration, and filesystem management.

## 1. The Global Logger

The engine uses a sophisticated multi-channel logger (`Logger`).

### Features
- **Duration Tracking**: Uses `>>>` and `<<<` markers to identify long-running processes (Narrative, Memory, TTS). These are parsed by the [Log Viewer](../tooling/memory_inspector.md) to generate waterfall diagrams.
- **Color Coding**: Automatically colorizes logs based on the module name (e.g., `Main`, `Narrative`, `Memory`, `Audio`).
- **Turn Serialization**: Every turn, the engine creates a `turn_[timestamp].json` file. The logger records every LLM exchange, including the model used, the provider, and the raw input/output.
- **Console Mirroring**: Simultaneously appends a plain-text version (with ANSI codes stripped) to `console_[timestamp].log`.

---

## 2. Configuration Management

Utilities for interacting with the project's global settings:
- **Dot-Notation**: Update nested settings easily (e.g., `updateSettings('visual_novel.settings.autoPlay', true)`).
- **Secure Patching**: Automatically retrieves API keys from the system keychain and injects them into the in-memory config, ensuring secrets never touch the disk in plain text.

---

## 3. Filesystem Helpers

- **Asset Relativization**: Converts absolute system paths into project-relative URLs (e.g., `C:/Projects/MyStory/assets/bg.jpg` -> `assets/bg.jpg`). This ensures project portability.
- **Hash Generation**: Used for file change detection and cache invalidation.
- **Natural Sorting**: Ensures the Project Selector and Workspace tree are sorted numerically (e.g., "Part 2" comes before "Part 10").

---

## 4. LLM Response Cleanup

The `repairHallucinatedLists` function fixes a common model error where the LLM returns a string instead of a JSON array. It uses regex to identify keys that look like lists and wraps them in brackets before the engine attempts to parse them.
