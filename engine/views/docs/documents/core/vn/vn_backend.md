# VN Subsystem: Backend

The backend of the Visual Novel (VN) subsystem is responsible for transforming raw AI-generated narrative into a structured, line-by-line cinematic sequence. This process is managed by the `vn_manager.js` and several specialized analysis modules.

## 1. The Transformation Flow

When a turn is generated, `transformVNProject` executes the following sequence:

### Step 1: Dialogue Parsing
The `ucp_parser.js` and `dialogue_processor.js` break the raw text into `dialogue` and `narrative` blocks. It identifies characters, cleans up LLM artifacts (like brackets), and handles placeholder replacements (e.g., `[USER_CHARACTER]`).

### Step 2: Parallel Analysis
To ensure high performance, the engine runs multiple analysis tasks in parallel:
- **Emotion Classification**: Uses an LLM or local classifier to assign emotions (e.g., "Happy", "Angry") and moods to every dialogue line.
- **Sprite Selection**: Cross-references character names and emotions with the project's sprite catalog to find the best image match.
- **Asset Selection**: A dedicated module (`asset_selector.js`) picks the most appropriate background and OST based on the scene's context and keywords.
- **Variant Orchestration**: Determines which outfit or variant (e.g., "Casual", "Armor") a character should wear for the duration of the turn.

### Step 3: Cinematic Positioning
The `sprite_positioner.js` calculates the X/Y coordinates for every character in the scene.
- **The Heat Map**: It uses a "heat map" algorithm to prevent characters from overlapping and to naturally space them based on who is talking.
- **Gaze Direction**: If rotations are supported, the engine calculates "focus" to make characters look towards the active speaker.

---

## 2. Structured Output

The result of the transformation is a `sequence` array stored in the `TurnContext`. Each item in the sequence contains:
- `character`: The name of the speaker.
- `text`: The dialogue text.
- `emotion`: The classified emotion.
- `image`: The path to the selected sprite.
- `position`: The calculated X/Y coordinates and scale.
- `clientEvents`: A list of UCP-compatible events (e.g., VFX, SFX, BG changes) to be triggered on this specific line.

---

## 3. Background Processing

After the main cinematic sequence is ready, the engine kicks off non-blocking tasks:
- **Summarization**: Generates a persistent summary and synopsis of the turn for history management.
- **Thumbnail Generation**: Renders a base64 snapshot of the scene to be used in the UI and save files.
- **Plugin Background Hooks**: Allows plugins to perform long-running tasks like Text-to-Speech (TTS) generation.

---

## 4. Run Profile Policy Integration

`vn_manager.js` reads runtime pipeline policy from `turnContext.runtime.turnPipeline`.

Important policy fields:
- `canonicalWrites`
- `persistenceMode`
- `awaitBackgroundTasks`
- `hookPolicy`

Behavioral effects:
- If `canonicalWrites=false` (virtual run), VNManager skips canonical pre-commit and canonical post-background DB updates.
- If `awaitBackgroundTasks=true`, blocking response waits for background tasks to finish before returning.
- This allows interlude/virtual runs to reuse full VN generation without polluting the main timeline.

---

## 5. Interlude Payload & Asset Keying

For virtual runs (user-facing: interludes), backend payload includes:
- `sceneMode` (`interlude` internally)
- `interlude.id`
- `interlude.ordinal`
- `storageTurnKey` (for plugin asset path resolution)

`storageTurnKey` examples:
- Mainline chapter: `53`
- Interlude attached to chapter 53: `53.1`

Frontend uses this key for archived plugin assets (for example TTS files), preventing collisions between parent chapter assets and interlude assets.
