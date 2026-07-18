# VN Subsystem: Frontend

The frontend of the Visual Novel subsystem is a high-performance renderer built on **PixiJS**. It is designed to handle complex animations, VFX, and dialogue orchestration while maintaining a smooth 60 FPS experience.

## 1. Core Architecture

The viewer is divided into several specialized modules:

### The Engine (`engine.js`)
The entry point that initializes the DOM listeners and proxies global calls. It bridges the gap between the raw HTML/CSS UI and the internal JavaScript logic.

### Dialogue Orchestrator (`dialogue_orchestrator.js`)
The "conductor" of the scene. It manages the playback state:
- **Typewriter Effect**: Handles the character-by-character text reveal.
- **Auto-Play**: Manages the timing and progression between lines.
- **Navigation**: Supports jumping between lines (Next/Prev/Last) while ensuring state consistency.
- **Voice Playback**: Synchronizes character dialogue with audio assets.

### PixiJS Renderer (`pixi_renderer.js`)
The low-level rendering loop. It handles the `stage`, `layers` (Background, Sprites, VFX, UI), and global filters (like color grading or blur).

---

## 2. Sprite & Animation Management

The `pixi_sprite_manager.js` handles the lifecycle of characters on screen:
- **Transitions**: Smoothly fades characters in and out.
- **Lip Sync**: If metadata is available, it animates the character's mouth during dialogue.
- **UCP Animations**: Executes protocol-defined animations like `bounce`, `shake`, or `sink`.
- **Z-Indexing**: Ensures the "speaking" character is always brought to the front.

---

## 3. The Intercept System

Before any line is rendered, it passes through the `intercept_orchestrator.js`. This allows plugins to "hijack" the rendering flow:
- **Takeovers**: A plugin can pause the VN and display its own custom UI (e.g., a map, a battle screen, or a hacking mini-game).
- **Injections**: Plugins can inject custom VFX or UI elements on top of specific dialogue lines.
- **Guardrails**: Can halt the renderer if specific conditions aren't met (e.g., waiting for an asset to load).

---

## 4. UI Overlay & State

The `ui_manager.js` and `state.js` manage the non-canvas elements:
- **Dialogue Box**: The HTML overlay for text and character names.
- **The Log**: A persistent record of all dialogue in the current turn.
- **Navigation UI**: Buttons for auto-play, skip, and history.
- **Game Over**: Specialized rendering for terminal states.
