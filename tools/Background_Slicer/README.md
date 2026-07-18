# Depth Slicer

Depth Slicer turns a flat background image into two assets:

1. the unchanged original image, used as the back layer; and
2. a transparent foreground WebP, used as the front layer.

It combines monocular depth estimation with an adjustable depth threshold. When the automatic cut is imperfect, optional SAM2 point prompts can add or remove specific regions. The result is useful for Fablekin's layered and 2.5D stage modes, where character sprites can appear behind foreground objects instead of always floating on top of the scene.

## Features

- Drag-and-drop or file-picker image loading.
- Multiple Hugging Face depth-model presets, from fast previews to higher-detail cuts.
- Live original, depth-map, foreground, and refinement previews.
- Adjustable near/far depth threshold.
- SAM2 positive and negative click refinement.
- Non-destructive export: the source image is never modified.
- Transparent WebP foreground output at quality 85.

Accepted inputs: `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`, and `.tif`.

## Requirements

- Windows is the currently documented path.
- Python 3.12 is recommended.
- Internet access is required the first time each model is downloaded.
- A CUDA-capable GPU is strongly recommended for SAM2, although CPU fallback is available and considerably slower.

The Python dependencies are listed in [`requirements.txt`](requirements.txt).

## Installation

From this folder:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

For the best SAM2 performance, install a CUDA-enabled PyTorch build that matches your GPU and CUDA stack. If the environment already contains the correct PyTorch build, keep it and install the remaining packages around it.

## Launch

Double-click [`launch_depth_slicer.bat`](launch_depth_slicer.bat), or run:

```powershell
.venv\Scripts\python.exe depth_slicer.py
```

## Workflow

1. Drop an image onto the window or browse for one.
2. Choose a depth model. The default small model is a good first pass.
3. Move the **Depth Cut** control until the foreground preview contains the objects that should sit in front of the characters.
4. Open **Refine** if depth alone cannot separate a difficult object.
5. Add or remove SAM2 points while watching the live foreground preview.
6. Select **Cut & Export**.

The foreground is written beside the source image:

```text
forest_tavern.png
forest_tavern_foreground.webp
```

Keep both files. The original remains the background; the generated WebP is the transparent foreground layer.

## Depth models

The model selector currently exposes:

- MiDaS SwinV2 Tiny for faster iteration.
- Depth Anything V2 Small, Base, and Large.
- DPT Large (MiDaS 3.0).

Changing the selection reruns depth estimation. Larger models generally need more memory and time, and they do not guarantee a better cut for every art style. Start small and only move up when the depth map is missing important structure.

## SAM2 refinement

Refinement points modify the threshold-generated mask:

- **Add mode + left click:** mark a foreground-positive point.
- **Remove mode + left click:** mark a background-negative point.
- **Right click:** always mark a background-negative point.
- **Undo point:** remove the most recent prompt.
- **Clear points:** discard all SAM2 prompts.

The exported mask is computed as:

```text
(depth mask OR SAM include mask) AND NOT SAM exclude mask
```

SAM2 is optional. Its first use downloads `facebook/sam2.1-hiera-large`, which is roughly a 1 GB-class checkpoint.

## First-run downloads and privacy

Depth models and SAM2 checkpoints are downloaded from Hugging Face and cached by their respective libraries. Image processing then happens locally; the tool does not upload the selected image to an inference service.

## Troubleshooting

### The first depth pass appears stuck

Check the terminal behind the UI. The selected model may still be downloading. Model download time is not represented well by the progress label.

### SAM2 is very slow or runs out of memory

Confirm that the virtual environment has a compatible CUDA-enabled PyTorch build. Otherwise, reduce image resolution before loading it or use depth-only cutting.

### The cut contains too much or too little

Adjust the depth threshold before adding SAM points. Use SAM2 for local corrections rather than trying to redraw the entire mask through clicks.

### Depth estimation fails immediately

Verify internet access for first-run downloads, then confirm that `torch`, `transformers`, `timm`, and the selected model can load inside the `.venv` environment.

## Relationship to Fablekin

Depth Slicer is an offline asset-preparation utility. It is not required to run Fablekin and does not communicate with the engine. Its output is intended to be copied into a project's background assets and configured through the visual stage tooling.
