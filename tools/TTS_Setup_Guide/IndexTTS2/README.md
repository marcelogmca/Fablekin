# IndexTTS bridge: ordered generation, reference caching, idle GPU release

Copy `tts_api.py` and the launchers into your upstream IndexTTS installation.
Install this folder's `requirements.txt` **into that installation's Python environment**.
Keep the upstream model dependencies and checkpoints; the bridge does not upgrade them.
Upstream initialization may download missing auxiliary models on its first run.

The bridge detects IndexTTS 2 or 2.5 from `checkpoints/config.yaml`. Version 2 uses
FP16; 2.5 uses BF16 and defaults to English. Reference audio supplies emotion,
so the optional Qwen text-to-emotion model is disabled when the installed API supports it.

```powershell
python tts_api.py --port 8000 --parallel 1
```

For a flat installation such as `TTS/IndexTTS25`, explicitly select the shared
folder containing your voice library and temporary output:

```powershell
python tts_api.py --shared-dir .. --language EN
```

The existing Fablekin endpoint remains `http://127.0.0.1:8000/generate`.
API payloads, clip IDs, per-line callbacks, audio downloads, leases and cancellation
remain compatible. Lines are generated in the supplied story order; later lines
are not moved ahead of the next clip the player needs. `--parallel` only accepts 1
because the upstream model and its conditioning slots are mutable.

## Reference reuse

A single inference worker holds a bounded LRU cache of complete speaker conditioning
and separate emotion conditioning. `John Happy → Bianca Neutral → John Happy`
reuses John's cached tensors without reordering dialogue. Changing John's mood
can reuse his speaker conditioning while computing only the missing emotion reference.

Defaults: **32 total speaker/emotion entries, capped at 256 MiB of tensor storage**.
These limits cover retained references, not model weights or temporary inference memory.
Full canonical paths, file size and modification time identify each entry; replacing
a reference in place invalidates it on its next use. Oversized bundles are not retained.
The cache never spans model instances. No synthetic speech is generated just to warm it.

```powershell
python tts_api.py --reference-cache-entries 48 --reference-cache-mb 384
```

Set `--reference-cache-entries 0` to measure uncached reference preparation.
Generic voice catalogues also reuse directory scans and refresh when their directories change.

## Releasing VRAM

The API process does not load Torch or initialize CUDA. The model is loaded lazily
inside a separate process when the first line needs inference. After **five seconds
with no active or pending request batches**, that process exits, releasing its
model weights, reference cache, allocator memory and CUDA context. The HTTP server
and generated WAV files remain available. Other applications' GPU memory is unaffected.

The short grace period lets immediately following batches share the same model.
Queued batches, including ones waiting for another inference call, prevent unloading.
Cancellation drains the current inference before releasing the worker; later lines
are skipped. API shutdown also closes the worker.

```powershell
# Release immediately after the final active batch finishes:
python tts_api.py --idle-unload-seconds 0

# Prefer faster next-chapter startup over idle VRAM release:
python tts_api.py --idle-unload-seconds -1
```

**Tradeoff:** after unloading, the next batch must reload the model from disk and
rebuild its reference cache. The first clip takes longer; this releases RAM as well
as VRAM rather than preserving a CPU copy of the model.

## Optional acceleration and diagnostics

`--accel` and `--torch-compile` opt into upstream acceleration. They default off.
Resolve their CUDA/PyTorch/Triton dependencies for your GPU before enabling them;
in particular, old Triton Windows pins are unsuitable for RTX 50-series GPUs.
`--no-cuda-kernel` disables the custom BigVGAN kernel when testing compatibility.
`--model-version 2` / `--model-version 2.5` override automatic selection;
`--model-dir PATH` selects a different checkpoint directory.

Each successful line prints `[Timing]` data and includes it in the final response:
speaker/emotion cache hits, retained reference MiB, model load time, inference
time (including reference preparation and WAV writing), queue wait, voice resolution,
and total line time. Callback delivery is asynchronous through one shared HTTP
session, ordered within each job. Completed WAVs are published atomically.

Use these timings to compare alternating speakers and mood changes across cold
and warm runs. They are wall-clock measurements, not a CUDA kernel profiler or a
measurement of the viewer's playback buffer.

## Tests

With the bridge requirements installed, run:

```powershell
python -m unittest -v test_tts_api.py
```

The regression suite uses model doubles for conditioning and real spawned processes
for worker lifecycle checks. It requires no GPU, checkpoints or voice library.
