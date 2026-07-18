# Fablekin Sprite Generator

The Sprite Generator creates the large, consistently named sprite matrices used by Fablekin's animated visual-novel renderer.

A character with 22 expressions, four viewing angles, and four face-animation states can require hundreds of individual files. This tool turns that manual production problem into a guided queue: generate expressions and rotations with AI, remove their backgrounds, align related images, derive blink/talk layers, and export runtime-ready WebP assets.

## Output matrix

For every completed expression and angle, the generator can export:

```text
[character]_[expression]_[angle].webp
[character]_[expression]_[angle]_blink.webp
[character]_[expression]_[angle]_talk.webp
[character]_[expression]_[angle]_talk_blink.webp
```

These names match the conventions understood by Fablekin's `SpriteAnimator` and asset resolver.

## Features

- **Automated character icons:** open **Icon Generator...** from the title bar, choose any sprite-library folder, and Sprite Generator recursively creates one consistently framed `256x256` portrait per character. It prefers neutral/front sprites and root-level files over equivalent outfit/subfolder copies, ignores blink/talk/back variants, uses the existing anime face landmarks for eye-aware framing, and can run BiRefNet when an image still has an opaque background.
- Selectable matrix of 22 built-in expressions and front/left/right/back rotations.
- Hosted image generation through NanoGPT-compatible image endpoints.
- Optional local generation through a ComfyUI API workflow.
- Editable expression, angle, and talking/blinking prompt templates.
- Multiple character reference images.
- Background removal through green-screen chroma keying or rembg/BiRefNet.
- Global, silhouette, contextual, and Canny-assisted alignment.
- Manual alignment fallback when automatic matching is not good enough.
- Optional skin-tone normalization between generated face states.
- Optional Real-ESRGAN anime upscaling.
- Optional mirroring for genuinely symmetric left/right designs.
- Progress tracking, retry, undo, and resumable state.
- Clean final exports separated from intermediate and debugging images.

## Status

This is a powerful personal production tool, not a packaged application. Setup uses a local virtual environment and a tested dependency set, but generated images still need human review. Keep intermediate files until a complete character has been checked in motion.

## Requirements

- Windows with 64-bit Python 3.12.
- Tkinter, normally included with the standard Windows Python installer.
- Several gigabytes of free space for the isolated Python environment and processing models.
- One generation path:
  - a NanoGPT API key and compatible image model; or
  - a running local ComfyUI server with a compatible API-format workflow.
- A CUDA GPU is recommended for local generation, background removal, and upscaling but is not required for every workflow.

## Automatic setup and launch

Double-click [`launch_sprite_generator.bat`](launch_sprite_generator.bat). On every launch it performs fast local checks and repairs missing pieces when necessary:

1. Checks for 64-bit Python 3.12. It never installs Python; if Python is missing, it explains where to get it and stops.
2. Creates an isolated `.venv` when one does not exist.
3. Selects the tested CUDA 12.8 stack on NVIDIA systems or the CPU-only fallback elsewhere.
4. Installs or repairs the pinned Python packages, including the pure-PyTorch anime face and landmark detector.
5. Downloads and verifies BiRefNet-General, U2Net, Real-ESRGAN anime 4x, YOLOv3 anime-face detection, and HRNetV2 landmark models.
6. Checks Tk, package imports, ONNX Runtime, and PyTorch acceleration before opening the interface.

Models are stored under `weights/`, not in a user-wide cache. The first setup downloads roughly 1.3 GB of processing models in addition to the Python packages. Later launches use a dependency fingerprint and local model checks, so they do not reinstall or redownload healthy files.

For a forced dependency repair, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_sprite_generator.ps1 -Force
```

### Manual installation

The equivalent NVIDIA installation is:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe prepare_models.py
```

[`requirements.txt`](requirements.txt) is the tested NVIDIA/CUDA 12.8 stack. [`requirements-cpu.txt`](requirements-cpu.txt) is the slower CPU-only alternative.

## Configure a generation backend

### NanoGPT

Copy [`.env.example`](.env.example) to `.env` and set:

```dotenv
NANOGPT_API_KEY=your_key_here
```

The UI can also save the key to `.env`. API keys are intentionally excluded from `state.json`, but `.env` itself must remain private and should never be committed.

Choose a model ID in the UI. The available presets currently include `gpt-image-1` and Nano Banana variants, but endpoint support and model names can change independently of this repository.

### Local ComfyUI

1. Start ComfyUI with API access, normally at `http://127.0.0.1:8188`.
2. Export a compatible workflow in API format.
3. Enable **Use local ComfyUI**.
4. Set the server URL and workflow path if they differ from the defaults.

The included [`workflow_flux.json`](workflow_flux.json) is the current starting workflow. It is not universal: it assumes the corresponding nodes, models, and input/output structure are available in the local ComfyUI installation.

## Launch

Double-click [`launch_sprite_generator.bat`](launch_sprite_generator.bat), or run:

```powershell
.venv\Scripts\python.exe gui_api.py
```

The batch launcher runs the guided setup, uses the local `.venv`, configures local model caches and Conda-based Python runtimes when necessary, and keeps the terminal open with actionable instructions when startup fails. `gui_api.py` is the compatibility entrypoint for the modular application in `app/`.

## Recommended workflow

1. **Choose the base character.** Select a clean, full-body source image. A consistent canvas, grounded feet, and an uncluttered background improve every later step.
2. **Add references.** Optional reference images help preserve clothing, face, color, and style across generation calls.
3. **Name the character.** Use the exact asset name expected by Fablekin. Keep names filesystem-safe and consistent.
4. **Select expressions and angles.** Start with a small test matrix before committing to every combination.
5. **Review the prompts.** The `{expr}`, `{angle}`, and `{color}` placeholders are expanded for each task.
6. **Choose processing options.** Enable green screen, alignment, fitting, mirroring, upscaling, or compression only when they suit the source art.
7. **Initialize & Save Tasks.** This builds the queue and writes resumable state.
8. **Run Next Step.** Work through the queue while watching the gallery and status log. Retry or undo when a generation is poor.
9. **Inspect final states.** Check base, blink, talk, and talk+blink at full resolution. Use manual alignment if the mouth or eyes jump between layers.
10. **Copy approved files into Fablekin.** Keep outfit variants in the project structure expected by the asset resolver.

Generating a small representative set first is much cheaper than discovering an identity, framing, or alignment problem after hundreds of calls.

## Processing options

| Option | Use it when | Avoid it when |
| --- | --- | --- |
| Real-ESRGAN 4x | Final sprites need more resolution or sharper anime linework | Testing prompts or already using very large outputs |
| Compress final WebP | Assets are approved and ready to ship | Pixel-level debugging is still in progress |
| Green-screen removal | The generated background is clean, flat green | Green/cyan details belong to the character |
| Fit sprite to frame | The generated character is too small and centered | Exact cross-sprite scale is already correct |
| Alignment/warping | Base and post images are close but slightly shifted | Warping stretches faces, hair, or props |
| Canny head alignment | Side views have small face-outline drift | Strong hair/weapon edges confuse the match |
| Skin-tone normalization | The post generation changes face color | Lighting is intentionally different |
| Symmetric mirroring | Left and right designs are truly interchangeable | Hair parts, weapons, text, shields, or armor are asymmetric |

## Output folders

| Path | Contents |
| --- | --- |
| `output_sprites/` | API originals, background-removed images, generated face states, caches, and debug files |
| `final_sprites/` | Clean base/blink/talk/talk+blink exports intended for review and use |
| `character_icons/` | Automated `<Character>_icon.webp` portraits at 256x256 and WebP quality 85 |
| `compressed_final_sprites/` | Optional compressed copies created by `compress_sprites.py` |
| `weights/` | Locally cached processing-model weights |
| `state.json` | Saved configuration, task queue, and progress; API keys are stripped |

Existing character icons are preserved unless **Overwrite existing icons** is enabled. The icon folder always lives beside `gui_api.py`, regardless of which source folder you scan.

To create a separate compressed copy after generation:

```powershell
.venv\Scripts\python.exe compress_sprites.py
```

## Quality guidance

- Keep the character's silhouette, canvas size, feet position, outfit, and lighting as stable as possible.
- AI image editing can alter identity or costume details subtly. Compare every rotation against the references.
- Do not enable symmetric mirroring for asymmetric designs just to save calls.
- Talking and blinking layers should be checked as rapid A/B transitions, not only as still images.
- Preserve `output_sprites/` until the character has been tested inside Fablekin; it contains the material needed for repairs.

## Cost, privacy, and rights

Hosted generation sends the selected images and prompts to the configured provider and may incur per-image charges. Local ComfyUI avoids that API path but uses local compute. Review the provider's privacy and retention terms before submitting personal or licensed artwork.

Only generate or transform characters and reference images you have the right to use. If generated assets resemble a real person or protected character, you are responsible for how those assets are used and distributed.

## Troubleshooting

### `NanoGPT API key is missing`

Confirm that `.env` contains `NANOGPT_API_KEY=...`, restart the UI, and make sure the file is in the Sprite Generator root.

### Python 3.12 is not found

Install 64-bit Python 3.12 from [python.org](https://www.python.org/downloads/windows/), enable **Add python.exe to PATH** during installation, and run the batch launcher again. The launcher deliberately does not install Python for you.

### Setup was interrupted

Run the batch launcher again. Verified downloads and installed packages are reused. If `.venv` itself is reported as incomplete, remove only the `.venv` folder and relaunch; character images, state, API configuration, and generated outputs are stored elsewhere.

### ComfyUI rejects the workflow

Export the workflow in API format, verify every custom node and model exists, and confirm that the workflow's image input and output nodes match what `workflow_flux.json` expects.

### Background removal damages the character

Disable green screen when character details share the key color. Compare the rembg/BiRefNet result and retain the best intermediate from `output_sprites/`.

### Eyes or mouth jump during animation

Keep automatic alignment enabled, try Canny head alignment, then use the manual alignment window for the affected state. Do not accept a still image that fails when toggled quickly against the base.

### Upscaling fails

Check the status log for the model download or PyTorch error. Confirm that `weights/RealESRGAN_x4plus_anime_6B.pth` is readable and that the installed PyTorch build supports the selected device.

## Relationship to Fablekin

The generator is an offline production utility. It does not need Fablekin to run, and Fablekin does not invoke it during a story turn. Its purpose is to make the renderer's richer expression, rotation, talking, and blinking support practical for a full cast rather than only one or two showcase characters.
