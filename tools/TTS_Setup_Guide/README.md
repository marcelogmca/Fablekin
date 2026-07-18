# Local TTS Bridge for Fablekin

Fablekin can generate and play character dialogue through a local text-to-speech server. This folder contains the Python API wrappers that connect Fablekin to the two engines currently supported by the author:

- [IndexTTS2](https://github.com/index-tts/index-tts)
- [Spark-TTS](https://github.com/SparkAudio/Spark-TTS)

The TTS engines, checkpoints, and upstream dependencies are **not bundled with Fablekin**. Install one of them from its official source first, then copy the matching bridge files into that installation.

## What the bridge adds

The upstream engines synthesize speech. The Fablekin wrappers add the runtime contract needed by the application:

- batch generation through `POST /generate`;
- character, narrator, gender, and generic-voice fallback selection;
- project-local, server-local, and shared voice directories;
- mood-specific reference selection for IndexTTS2;
- per-line CRC filenames compatible with Fablekin's audio cache;
- progress callbacks and ETA data;
- job leases and cancellation when a story context changes;
- audio delivery through `GET /audio/{filename}`; and
- cleanup of unclaimed server output after 30 minutes.

Fablekin archives completed audio into the active story before the wrapper's temporary-output cleanup removes it.

## Support matrix

| Capability | IndexTTS2 | Spark-TTS |
| --- | :---: | :---: |
| Character reference voice | Yes | Yes |
| Narrator and generic fallbacks | Yes | Yes |
| Project-specific voice folder | Yes | Yes |
| Fablekin batch/callback API | Yes | Yes |
| Mood-specific reference audio | Yes | No; base reference only |
| Default launcher environment | `.venv` | Conda environment `sparktts` |

Fablekin sends mood metadata to the common API payload. The IndexTTS2 wrapper can resolve that mood to a separate emotional reference clip. Spark-TTS currently uses the selected character's base reference recording.

## Requirements

- A working upstream IndexTTS2 or Spark-TTS installation.
- The model checkpoints required by that project.
- A Python environment capable of running the selected model.
- FastAPI bridge dependencies from the matching `requirements.txt`.
- Sufficient RAM/VRAM for local inference.
- Fablekin's `tts_core` plugin enabled and pointed at the wrapper endpoint.

Follow the upstream project's current hardware, CUDA, Python, and model-download instructions. Those requirements change more often than this integration layer.

## Recommended directory layout

The wrappers resolve shared voices and output relative to their script locations. This layout matches the current code:

```text
TTS/
|-- IndexTTS2/
|   `-- index-tts/
|       |-- tts_api.py
|       |-- run_api.bat
|       |-- run_api.sh
|       |-- requirements.txt
|       `-- .venv/
|-- Spark-TTS/
|   |-- tts_api.py
|   |-- run_api.bat
|   |-- run_api.sh
|   |-- requirements.txt
|   |-- pretrained_models/
|   `-- ...upstream Spark-TTS files...
|-- voices/
`-- output/
```

Each wrapper also supports a `voices/` directory beside its own `tts_api.py`. During a Fablekin request, the active project's `assets/voices/` directory is passed explicitly and receives the highest priority.

## Option A: IndexTTS2

1. Install [IndexTTS2 from its official repository](https://github.com/index-tts/index-tts) and verify its own inference example works.
2. Copy these files into the upstream `index-tts/` directory:
   - [`IndexTTS2/tts_api.py`](IndexTTS2/tts_api.py)
   - [`IndexTTS2/run_api.bat`](IndexTTS2/run_api.bat)
   - [`IndexTTS2/run_api.sh`](IndexTTS2/run_api.sh)
   - [`IndexTTS2/requirements.txt`](IndexTTS2/requirements.txt)
3. Activate the environment used by IndexTTS2 and install the wrapper dependencies:

```powershell
python -m pip install -r requirements.txt
```

4. Ensure the launcher matches the environment. The included Windows launcher expects `.venv\Scripts\activate.bat` in the same directory. If the upstream installation uses `uv`, Conda, or another environment layout, edit the activation portion of the launcher or run `tts_api.py` directly from the active environment.
5. Start the server with `run_api.bat`, `run_api.sh`, or:

```powershell
python tts_api.py --port 8000 --parallel 1
```

## Option B: Spark-TTS

1. Install [Spark-TTS from its official repository](https://github.com/SparkAudio/Spark-TTS) and verify its own inference example works.
2. Copy these files into the upstream Spark-TTS root:
   - [`Spark-TTS/tts_api.py`](Spark-TTS/tts_api.py)
   - [`Spark-TTS/run_api.bat`](Spark-TTS/run_api.bat)
   - [`Spark-TTS/run_api.sh`](Spark-TTS/run_api.sh)
   - [`Spark-TTS/requirements.txt`](Spark-TTS/requirements.txt)
3. Activate the environment used by Spark-TTS and install the wrapper dependencies:

```powershell
python -m pip install -r requirements.txt
```

4. The included launcher expects a Conda environment named `sparktts`. Edit it if the local environment uses another name.
5. Start the server with `run_api.bat`, `run_api.sh`, or:

```powershell
python tts_api.py --port 8000 --parallel 1
```

## Connect Fablekin

1. Start one local TTS wrapper. Both default to port `8000`, so either use one at a time or assign different ports.
2. Enable the `tts_core` plugin in Fablekin.
3. Set its TTS API endpoint to:

```text
http://127.0.0.1:8000/generate
```

4. Add voice references to the project's `assets/voices/` directory or one of the wrapper voice directories.
5. Generate a scene containing dialogue. TTS runs as background work and reports progress through Fablekin's status UI.

## Voice lookup

The wrappers search in this order:

1. the active Fablekin project's `assets/voices/` directory;
2. a `voices/` directory beside `tts_api.py`; and
3. the shared top-level `TTS/voices/` directory shown above.

Character filenames should match the speaker name:

```text
voices/
|-- Dehya.wav
|-- Frieren.wav
|-- Narrator.wav
|-- male0.wav
`-- female0.wav
```

Voice matching is case-insensitive and accepts `.wav`, `.mp3`, and `.ogg`. Dedicated character voices are preferred. When one is unavailable, Fablekin and the wrapper can select a semantic generic profile or a deterministic gender-based fallback.

Use clean reference recordings with one speaker, little background noise, stable volume, and the emotional delivery you want the model to preserve.

## Emotion-aware IndexTTS2 voices

Fablekin classifies dialogue in scene context and sends a `mood` value such as `happy`, `sad`, `angry`, `annoyed`, `fearful`, or `caring`. IndexTTS2 can separate the character's identity reference from an emotional reference:

```text
Dehya.wav
Dehya_angry.wav
Dehya_happy.wav
Dehya_sad.wav
```

The unsuffixed file is required as the base character voice. Fablekin discovers mood suffixes from the available files and constrains classification to moods that actually exist. If `Dehya_angry.wav` is requested but unavailable, the wrapper falls back to `Dehya.wav` rather than failing the line.

High-quality, well-matched emotional samples can produce much more convincing changes in tone than asking one neutral reference to carry every scene.

## API summary

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/generate` | Queue a batch of dialogue lines |
| `POST` | `/lease` | Renew a live Fablekin job lease |
| `POST` | `/cancel` | Cancel by job ID, context hash, or all jobs |
| `GET` | `/audio/{filename}` | Download completed WAV audio |

Minimal generation payload:

```json
{
  "lines": [
    {
      "index": 0,
      "character": "Dehya",
      "text": "Put that down before somebody gets hurt.",
      "originaltext": "Put that down before somebody gets hurt.",
      "crc": "12345678",
      "gender": "female",
      "mood": "annoyed"
    }
  ],
  "callback_url": "http://127.0.0.1:14541/plugins/tts_core/callback"
}
```

Normal Fablekin use does not require sending requests manually.

## Performance

Both launchers default to `--parallel 1`. Local TTS inference can consume substantial VRAM, and higher parallelism may exhaust it even on high-end GPUs. Increase concurrency only after measuring one complete scene on the target hardware.

The wrappers process batches asynchronously from Fablekin's point of view, but individual inference work is deliberately conservative. Generation speed depends on model, GPU, reference duration, line length, and selected parallelism.

Temporary server output older than 30 minutes is cleaned automatically. Fablekin's archived story audio is separate and is not removed by this cleanup.

## Troubleshooting

### Fablekin reports a dispatch failure

Confirm the wrapper terminal is still running and the plugin endpoint ends in `/generate`. Check that the configured port matches the launcher.

### The wrapper cannot import the TTS engine

The bridge was probably started from the wrong Python environment or copied to the wrong folder. Activate the environment that successfully runs the upstream engine first, then launch `tts_api.py` from there.

### A character uses the wrong voice

Check the filename against the parsed speaker name. Project voices override local and shared voices. Remove or rename ambiguous duplicate files and inspect the wrapper log for the selected reference.

### Mood always falls back to neutral

Mood-specific audio is currently an IndexTTS2 feature. Confirm that both the base file and the suffixed file exist together, for example `Dehya.wav` and `Dehya_angry.wav`.

### CUDA runs out of memory

Return to `--parallel 1`, stop other GPU-heavy applications, and follow the upstream engine's lower-memory recommendations. Do not run both TTS engines on the same GPU simultaneously unless there is sufficient headroom.

## Responsible voice use

> [!CAUTION]
> Only use voice recordings you created, licensed, or have explicit permission to use. Do not clone or impersonate a real person's voice without informed consent. Fablekin does not include, host, or share voice samples or generated TTS content. You are responsible for the voices, models, and audio you run locally and for respecting applicable rights, licenses, and laws.
