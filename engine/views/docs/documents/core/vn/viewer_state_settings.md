# Viewer State & Settings

This document covers how the viewer maintains its internal state and how user preferences are persisted and applied.

## 1. Global Utilities (`utils.js`)

A collection of foundational functions used across all viewer modules.
- **Asset Resolution**: `getAssetUrl` handles the complex logic of mapping relative paths from plugins and projects to absolute server URLs.
- **CRC32 Tracking**: Used to verify TTS audio caches and ensure that voice lines match the currently displayed text.
- **Deep Merging**: A utility to safely merge partial settings objects without losing existing configuration sub-keys.

---

## 2. Settings Management (`settings_manager.js`)

The engine provides a highly customizable experience through the Settings Modal.
- **Reactive Application**: Changes in the settings UI (e.g., volume sliders, font size, panel blur) are applied instantly to the DOM and PixiJS layers.
- **Persistence**: Settings are debounced and emitted back to the main process via `save-vn-settings` to be persisted in the project's configuration.
- **Interface Toggles**: Manages the visibility of the "Controls" overlay and the "Dialogue Index Indicator."

---

## 3. Communication Layer (`socket_handler.js`)

The viewer's connection to the [IPC Infrastructure](../bootstrapping/ipc_socket_infrastructure.md).
- **Event Orchestration**: Listens for background processing updates, CG ready signals, and generation lifecycle events.
- **Plugin Injection**: Implements the `injectPluginUI` logic, which allows backend plugins to "take over" the viewer's screen with custom HTML/JS/CSS fragments.
- **Focus Tracking**: Monitors whether the application window is focused to handle audio muting and taskbar blinking.
