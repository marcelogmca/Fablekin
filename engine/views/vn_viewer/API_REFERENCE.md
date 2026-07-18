# VN Viewer API Reference

This document provides a comprehensive technical reference for the Visual Novel (VN) Viewer's communication layer, specifically its Socket.io interface and internal event system.

## Table of Contents
1. [Overview](#overview)
2. [Socket.io Interface](#socketio-interface)
    - [Viewer to Backend (Emitted Events)](#viewer-to-backend-emitted-events)
    - [Backend to Viewer (Received Events)](#backend-to-viewer-received-events)
3. [Data Structures](#data-structures)
    - [VNResult](#vnresult)
    - [Scene](#scene)
4. [Internal Browser Events](#internal-browser-events)
5. [Global window.VN API](#global-windowvn-api)

---

## Overview
The VN Viewer operates as a highly modular, event-driven frontend. It communicates with the backend via Socket.io on a runtime-configured localhost endpoint (dynamic port). Many socket events follow a Request-Response pattern implemented via a custom `socket.emitReceive` utility.

---

## Socket.io Interface

### Viewer to Backend (Emitted Events)

#### `generate-vn-turn`
Triggers the AI generation of a new story turn.
- **Payload**: `{ prompt: string }`
- **Pattern**: `emitReceive`
- **Response**: `{ success: boolean, result?: VNResult, error?: string }`

#### `socket.emit('play-historical-turn', { turnNumber })`
Requests a specific turn from the database to be rendered.
- **Payload**: `{ turnNumber: number }`

#### `socket.emit('update-vn-turn-batch', { turnNumber, sequence })`
Saves manual edits made to the current turn's sequence.
- **Payload**: `{ turnNumber: number, sequence: Array<Scene> }`
- **Pattern**: `emitReceive`
- **Response**: `{ success: boolean, sequence?: Array<Scene>, error?: string }`

#### `socket.emit('save-viewer-state', { turnNumber, dialogueIndex })`
Perspective persistence. Saves where the user is currently at.
- **Payload**: `{ turnNumber: number, dialogueIndex: number }`

#### `socket.emit('save-vn-settings', { vnSettings })`
Saves the user's visual/audio preferences.
- **Payload**: `{ vnSettings: Object }`

#### `socket.emit('get-vn-settings', {})`
Retrieves saved preferences.
- **Pattern**: `emitReceive`
- **Response**: `{ success: boolean, vnSettings: Object }`
- **Standard Settings**:
    - `ostVolume` (0.0 - 1.0)
    - `ttsVolume` (0.0 - 1.0)
    - `bgmSfxVolume` (0.0 - 1.0): Ambient SFX volume
    - `sfxVolume` (0.0 - 1.0): Effect SFX volume
    - `spriteOffset` (number): Vertical offset in pixels
    - `panelTransparency` (0.0 - 1.0)
    - `textAlignment` ('left'|'center'|'right')
    - `fontSizeMultiplier` (number)
    - `writeSpeed` (number): Typewriter speed in ms
    - `autoPlayDelay` (number): ms

#### `socket.emit('toggle-vn-fullscreen', {})`
Requests the backend to acknowledge/toggle fullscreen state.

#### `socket.emit('execute-frontend-hook', { hookName })`
Signals to the backend/plugins that a specific GUI milestone has been reached.
- **Common Hooks**: `HOOK_VN_GUI_READY`, `HOOK_VN_GUI_LAST_DIALOGUE`.

---

### Backend to Viewer (Received Events)

#### `status-update`
Updates the notification UI or generation progress tracking.
- **Payload**:
```javascript
{
    id: string,         // Unique ID for the status item
    type: 'clear'|null, // 'clear' to remove the notification
    message: string,    // Human-readable status
    progress: number,   // 0-100
    color: string,      // CSS color for the progress bar
    blocking: boolean,  // If true, shows the unified status overlay
    priority: number,   // Sort order for overlapping tasks
    subtasks: Array     // Optional list of minor steps
}
```

#### `vn-camera-zoom-to-rect`
Programmatically pans and zooms the camera to a logical rectangle.
- **Payload**: `{ x1, y1, x2, y2, duration, focusCharacter, instant, blur }`

#### `vn-camera-zoom-to-character`
Focuses on a specific character and region.
- **Payload**: `{ charName, region, duration, padding, instant, blur }`

#### `vn-cg-ready`
Signals that a CG (Computer Graphic) background is processed and ready to be displayed for specific turn indices.
- **Payload**: `{ turnNumber, cgData: { image, startIdx, endIdx } }`

#### `inject-permanent-assets`
Allows backend plugins to inject persistent HTML/CSS/JS into the viewer.
- **Payload**: `Array<{ id, js, css, html }>`

#### `vn-ost-change`
Triggers a mid-scene change of the background music.
- **Payload**: `{ file: string }`

---

## Data Structures

### VNResult
The core payload sent by the backend when a turn is generated or loaded.
```javascript
{
    turnNumber: number,
    projectName: string,
    chatFileName: string,
    finalBackground: string, // Logical path to background asset
    finalSong: string,       // Logical path to OST asset
    sequence: Array<Scene>,  // The dialogue lines and stage instructions
    navigation: {
        prev: { turnNumber, title, thumbnail, synopsis }|null,
        next: { turnNumber, title, thumbnail, synopsis }|null
    }
}
```

### Scene
Represents a single atomic "click" in the visual novel.
```javascript
{
    character: string,      // e.g., "Narrator", "MainCharacter", or character name
    line: string,           // Raw dialogue line
    text: string,           // Text only (used for typewriter)
    crc: string,            // Unique hash for TTS audio mapping
    sprites: {              // Active characters on stage
        [charName]: { path, x, y, scaleX, scaleY, alpha }
    },
    clientEvents: [         // Agnostic event triggers
        { 
            type: "sfx:play",
            payload: { file: "wind.mp3", loop: true, category: "background" },
            stickyUntil: 50
        },
        { 
            type: "vn:camera-shake",
            payload: { intensity: 1.0 },
            stickyUntil: 0 // Immediate one-off
        }
    ],
    camera: {               // Direct camera instructions (legacy support)
        zoom: number,
        pan: { x, y },
        duration: number
    }
}
```

---

## Internal Browser Events
The viewer uses standard `window.dispatchEvent` for communication between modules (e.g., Sockets -> Pixi Engine).

| Event Name | Purpose | Data (`e.detail`) |
|------------|---------|-------------------|
| `vn:camera-zoom-to-rect` | Triggers Pixi zoom | `{ x1, y1, x2, y2, duration, ... }` |
| `vn:camera-reset` | Resets viewport | `{ duration, instant }` |
| `vn:background-updated` | Syncs filters/background | `{ background, isVideo }` |
| `vn:background-override` | Mid-turn background change | `{ src, isVideo, instant }` |
| `vn:ost-change` | Mid-scene OST change | `{ file: string }` |
| `sfx:play` | Triggers a sound effect | `{ file, loop, category }` |
| `sfx:stop` | Stops a looping SFX | `{ file }` |
| `system:clear-all-volatile-events` | Force stops all VFX/DOF/SFX | No payload |

---

## Global window.VN API
Exposed via `js/vn_api.js` for use by injected scripts and plugins.

```javascript
// Example Usage:
VN.camera.zoom(2.5, 1.5);
VN.ui.hideDialogue();
VN.sprites.applyFilter('alice', [new PIXI.BlurFilter()]);
```

- **`VN.background.getSnapshot()`**: Returns a `RenderTexture` of the current frame.
- **`VN.ui`**: `hideDialogue()`, `showDialogue()`, `hideSprites()`, `showSprites()`.
- **`VN.camera`**: `zoom(level, duration)`, `pan(x, y, duration)`, `reset(duration)`.
- **`VN.sprites`**: `addBackFX()`, `addFrontFX()`, `clearFX()`, `applyFilter()`.
- **`VN.pixiPlugins`**: Advanced Pixi plugin lifecycle runtime. Prefer this public alias over legacy `window.__PIXI_PLUGINS`.

---

## Sequence Logic

The VN sequence is an array of `Scene` objects, each representing an atomic interaction.

### `vn:background-override` Payload
This event allows mid-turn background changes while respecting the "natural" background flow when turns change.

```javascript
{
    type: "vn:background-override",
    payload: {
        src: string,     // Path to background asset (relative to repository root or specific folders)
        isVideo: boolean, // If true, the asset is treated as a video
        instant: boolean  // If true, skips the crossfade animation
    },
    stickyUntil: number // Optional: Scene index where this effect should stop
}
```

### Automatic Sprite Positioning
The backend `SpritePositioner` automatically calculates the best `slot` (left=0, center=1, right=2) for each character based on their appearance frequency ("heatmap") and recent activity.

---

## TurnContext Integration

The backend uses a `turnContext` object to manage turn generation. Several fields directly affect the viewer's layout and data:

| Field | Description | Viewer Impact |
|-------|-------------|---------------|
| `turnContext.output.party` | Array of characters in the scene | Used for UI filters and party lists. |
| `turnContext.output.prominentCharacters` | Characters sorted by voice lines | Influences camera focus and narrative weight. |
| `turnContext.processed.newlyIntroducedCharacters` | First-time characters | Triggers introductory animations or metadata loads. |
| `turnContext.processed.characterMetadata` | Character info (age, height, etc.) | Populated in tooltips or character bios. |

### Chronological Events
Events in the `clientEvents` array are processed during the **Chronological Sweep**. The viewer scans back from the current index to find "sticky" events that are still active, ensuring visual consistency even if the user jumps indices or reloads a turn.
