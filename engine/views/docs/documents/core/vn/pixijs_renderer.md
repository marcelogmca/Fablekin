# Cinematic Renderer (PixiJS)

The engine uses **PixiJS v8** to deliver high-performance, GPU-accelerated visuals. It abstracts away the complexity of WebGL/WebGPU through a logical viewport system and a structured layer stack.

## 1. The Logical Viewport

To ensure the game looks identical on all screens, the engine uses a **Logical Coordinate System**.
- **Virtual Resolution**: 1920x1080.
- **Auto-Scaling**: The `pixi_engine.js` automatically scales and centers the logical viewport to "Cover" the physical window.
- **Center Pivot**: The world container is pivoted at (960, 540) by default, making camera zooms and pans intuitive.

---

## 2. Layer Hierarchy

The scene is organized into six primary layers (Z-order from back to front):

1. **`Layer_Background`**: Static images and looping videos.
2. **`Layer_Characters`**: Native scene sprites with blinks and lip-sync.
3. **`Layer_InterceptActors`**: Intercept-scoped plugin actors rendered inside the VN canvas.
4. **`Layer_CG`**: Full-screen illustrations.
5. **`Layer_FX`**: Particle systems and screen-space shaders.
6. **`Layer_Titles`**: Stylized text overlays and UI popups.

`Layer_InterceptActors` is intended for GUI intercept plugins that need to position extra character sprites
without mutating native scene sprite state.

---

## 3. Sprite Texture Cache

Sprite layers are loaded through `PIXI.Assets`, so source PNGs are decoded and cached by URL. To avoid unbounded memory growth when many high-resolution emotions/directions are visited, `pixi_sprite_manager.js` tracks sprite URLs and prunes inactive entries with a small LRU policy.

Relevant settings live under `visual_novel.settings.performance`:

```json
{
  "sprite_texture_cache_limit": 0,
  "sprite_texture_unload_delay_ms": 1500,
  "sprite_texture_vn_lookahead": true,
  "sprite_texture_sequence_preload": false
}
```

The cache manager only unloads URLs loaded as character sprites, never currently referenced display-object textures. `sprite_texture_cache_limit: 0` means active-only mode: keep on-screen actors plus their mounted blink/talk/talk_blink variants, skip sequence-wide sprite preloading, then evict inactive emotions/directions after the unload delay.

When `sprite_texture_vn_lookahead` is enabled, normal VN sequence sprites get one small exception to strict active-only behavior: after each dialogue render, the renderer preloads and pins the nearest changed sprite path before and after the current dialogue for each logical slot/position. This keeps both forward and backward navigation warm without keeping every visited emotion/direction alive. Plugin/API actors, such as camp actors spawned outside the VN sequence, remain active-only.

Forward lookahead also sends only the upcoming base texture through Pixi's GPU prepare queue. Lookbehind textures and optional blink/talk/talk_blink layers remain CPU-cached until used. Preparation reuses the cache manager's existing texture object and transiently pins it while upload is in flight, so it does not add another bitmap or extend the asset's eventual LRU lifetime.

Visible sprite bounds used by camera framing and emote placement are analyzed at a maximum dimension of 384 pixels instead of reading the full-resolution image on the renderer thread. The backend persists normalized bounds in `assets/sprites/.sprite-render-cache.json`; entries are invalidated by source size/mtime and an algorithm version. Missing, stale, malformed, or unavailable cache data falls back to the same bounded downscaled analysis in the viewer.

`sprite_texture_sequence_preload` restores the old eager behavior of preloading every sprite referenced by the sequence. Keep it disabled for high-resolution sprite projects unless you explicitly want the memory tradeoff.

---

## 4. Background Rendering

The `pixi_renderer.js` handles all scenery logic.
- **Crossfades**: Smooth transitions between background assets using GSAP.
- **Video Support**: Native looping video textures for animated backgrounds.
- **Background Snapshotting**: A `RenderTexture` captures the background state every frame. This allows VFX (like heat distortion) to pull from the current background without expensive texture lookups.
- **Overscan**: Backgrounds are rendered at 1.1x scale. This provides a "safety margin" for camera movement, preventing black bars from appearing during shakes or wobbles.

---

## 5. Advanced Tooling

### The Debug Viewport
Developers can enable `debug_viewport` in settings to inspect the scene:
- **Middle Click + Drag**: Pan around the logical 1920x1080 canvas.
- **Scroll**: Zoom in/out beyond the logical bounds.
- **Utility**: Vital for checking sprite alignment and camera focus bounds.

---

## 6. Transition Runtime

The viewer now includes a shared transition runtime (`transition_manager.js`) used by:
- VN sequence events (`type: "vn:transition"`)
- GUI intercept enter/exit transitions (`transitionIn`, `transitionOut`)

Supported v1 effects:
- `fade`
- `crossfade`
- `circle_fade`
- `wipe_left`, `wipe_right`, `wipe_up`, `wipe_down`
- `slide_push`
- `zoom_blur`
- `flash_cut`

Transition descriptor shape:

```js
{
  effect: "circle_fade",
  scope: "scene", // scene | background | characters | intercept
  target: null,
  durationMs: 900,
  direction: "in",
  easing: "power2.inOut",
  blocking: true,
  options: {}
}
```

Blocking transitions are awaited by the caller (e.g. line entry sync), while non-blocking transitions run in the background.

---

## 7. Sprite Cast Shadows

Character shadows are implemented as an opt-in core Pixi sprite feature in `pixi_sprite_shadows.js` and attached by `pixi_sprite_manager.js`.

The renderer is designed for arbitrary drag-and-drop standing character PNGs. It does not require bones, height maps, authored shadow frames, or per-character metadata. Instead, it builds a cached shadow texture from the sprite alpha mask:

```text
alpha mask -> lower contour -> contact regions -> projected point map -> contact-pinned warp -> blurred raster texture
```

Shadows are off by default for normal VN sprites. Plugins and sequence commands can enable them when the scene benefits from grounded, in-world character placement, such as camp/interlude layouts.

Runtime control:

```js
bridge.actors.enableShadow(actorId, {
  angleDegrees: 82,
  strength: 0.35,
  length: 0.85,
  blur: 4
});

bridge.actors.disableShadow(actorId);
```

Sequence command equivalent:

```text
shadow:on:Dehya|angle=82|strength=0.35|length=0.85|blur=4
shadow:off:Dehya
```

Performance note: high-resolution sprites are downsampled for shadow generation using the global `visual_novel.settings.performance.sprite_shadows.max_source_size` setting. Active shadows reuse their texture while unchanged, but full rendered canvases are not globally cached to avoid large Electron memory growth. Prefer conservative `max_source_size` and `point_spacing` values for scenes with several actors.
