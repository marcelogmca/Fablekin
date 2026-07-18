# Sprite Shadows

Sprite shadows are an opt-in Pixi feature for scenes where characters should feel grounded in the background, such as camp/interlude scenes. Normal VN playback keeps shadows off unless a plugin, sequence command, or future settings UI explicitly enables them.

## How To Enable

Frontend intercept plugins can enable shadows when spawning an actor:

```js
const actor = await bridge.actors.spawn({
  actorId: 'candace',
  character: 'Candace',
  x: 0.35,
  y: 1,
  shadow: {
    enabled: true,
    angleDegrees: 82,
    strength: 0.35,
    length: 0.85,
    blur: 4
  }
});
```

They can also toggle shadows after spawn:

```js
await bridge.actors.enableShadow(actor.localActorId, {
  angleDegrees: 82,
  strength: 0.35,
  length: 0.85,
  blur: 4
});

await bridge.actors.disableShadow(actor.localActorId);
```

The lower-level form is:

```js
await bridge.actors.setShadow(actorId, { enabled: true, angleDegrees: 82 });
await bridge.actors.setShadow(actorId, { enabled: false });
```

## Sequence Commands

Story sequence commands use UCP:

```text
shadow:on:Dehya|angle=82|strength=0.35|length=0.85|blur=4
shadow:off:Dehya
shadow:on:all|angle=82|opacity=0.25
```

Backend plugins using `tools.sequence` can use helpers:

```js
tools.sequence.enableShadow(0, 'Dehya', {
  angleDegrees: 82,
  strength: 0.35,
  length: 0.85
});

tools.sequence.disableShadow(4, 'Dehya');
```

## Config

Scene/plugin-facing options:

- `enabled`: Required for enabling through config objects.
- `angleDegrees` / `angle`: Shadow direction in screen degrees. `0` is right, `90` is down.
- `opacity` / `strength`: Shadow alpha.
- `length`: Projection distance multiplier.
- `blur`: Canvas blur amount before upload to Pixi.

Renderer-quality options live in global VN settings, not camp scene JSON:

```json
{
  "visual_novel": {
    "settings": {
      "performance": {
        "sprite_shadows": {
          "alpha_threshold": 24,
          "point_spacing": 3,
          "max_source_size": 640,
          "contact_search_band": 0.05,
          "contact_relief_band": 0.05,
          "contact_prominence": 10,
          "contact_feather_columns": 12,
          "contact_fade_height": 0.32,
          "max_correction": 170
        }
      }
    }
  }
}
```

Advanced renderer-quality options:

- `alphaThreshold`: Alpha cutoff for the source mask.
- `pointSpacing`: Pixel sampling stride. Higher is faster and rougher.
- `maxSourceSize`: Maximum sprite source dimension used for shadow computation.
- `contactSearchBand`: Lower-body band searched for contact points.
- `contactReliefBand`: Extra lower-silhouette relief area used for boot/heel contact.
- `contactProminence`: Minimum lower-contour prominence for contact regions.
- `contactFeatherColumns`: Sideways feathering around contact columns.
- `contactFadeHeight`: Vertical fade distance for the contact correction.
- `maxCorrection`: Maximum contact-pinning offset.

These advanced keys are intentionally global. Scene JSON and UCP commands should not carry them; they are engine-quality/performance tuning, not environment metadata.

## Renderer Notes

The implementation lives in `engine/views/vn_viewer/js/pixi_sprite_shadows.js`. It uses a no-metadata heuristic:

```text
alpha mask -> lower contour -> contact regions -> projected point map -> contact-pinned warp -> blurred raster texture
```

This is a practical visual cheat, not a physically perfect shadow simulation. It works best on standing humanoid sprites with visible feet. If contact detection fails, the renderer falls back toward the naive projected silhouette instead of blocking actor rendering.

## Performance

Avoid generating shadows from full-resolution source art. For large sprites, keep global `max_source_size` around `512` to `768` and `point_spacing` around `2` to `4`.

The active actor reuses its current shadow texture while the sprite/config stay unchanged, and compact alpha masks are cached for reuse. Full raster shadow canvases are not globally cached, because retaining every generated canvas can balloon Chromium/Electron memory during camp scenes.
