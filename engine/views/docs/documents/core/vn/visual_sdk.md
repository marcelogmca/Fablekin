# Visual SDK (`window.VN`)

`window.VN` is the public API for plugin code already running inside the Visual Novel viewer. Backend hooks use `tools.*` instead. GUI intercept payloads should prefer their run-scoped `bridge.*` APIs whenever an equivalent helper exists, because the bridge owns cleanup and restores viewer state automatically.

## UI, Background, and Camera

- `VN.background.getSnapshot()` returns the current rendered background snapshot texture.
- `VN.ui.hideDialogue()` / `showDialogue()` toggle dialogue and controls.
- `VN.ui.hideSprites()` / `showSprites()` toggle the native Pixi character layer.
- `VN.ui.showTitle(config)` displays a stylized title popout. See [PixiJS Renderer](pixijs_renderer.md).
- `VN.cam.zoom(level, duration)`, `pan(x, y, duration)`, and `reset(duration)` control the VN camera in logical 1920×1080 coordinates.
- `VN.camera` is a compatibility alias for `VN.cam`.

GUI intercept actors rendered through `bridge.actors` live on a separate layer. Inside an intercept, use `bridge.actors.hideNativeSprites(...)` when you only want to hide native scene sprites.

## Character Animation and Sprite FX

- `VN.anim.bounce(charName)` and `shake(charName)` play short movement reactions.
- `VN.anim.sink(charName)` and `panic(charName)` trigger the corresponding character animations.
- `VN.anim.emote(charName, type)` displays a character emote.
- `VN.sprites.addBackFX(charName, displayObject)` adds a Pixi object behind a character.
- `VN.sprites.addFrontFX(charName, displayObject)` adds one in front.
- `VN.sprites.applyFilter(charName, filters)` replaces the character body's Pixi filter array.
- `VN.sprites.clearFX(charName)` removes injected FX and filters.
- `VN.sprites.getBaseTexture(charName)` returns the active character's base texture when available.
- `VN.sprites.cloneBodySprite(charName)` creates a bottom-centered clone of the active base sprite.
- `VN.sprites.memoryDebug()` returns sprite-manager diagnostics.

Raw display objects and filters are not lifecycle-managed for you. Remove them explicitly or register the owning frontend plugin through `VN.pixiPlugins`.

## Sound and User Volume

- `VN.sfx.play(file, options)` dispatches a one-shot sound.
- `VN.sfx.loop(file, options)` starts a looping background sound.
- `VN.sfx.stop(file, force)` stops matching sound playback.
- `VN.audio.getVolume(category)` reads the user's current volume without modifying it.

Supported volume categories are:

- `sfx` for ordinary effects.
- `ost` for soundtrack volume.
- `tts` or `voice` for dialogue voice volume.
- `bgm_sfx` or `ambient` for looping background effects.

Plugins that create their own `Audio` instances should apply this value and clean those instances up when disposed. Intercept payloads can instead use `bridge.audio`, which tracks playback and restores VN audio state.

## UCP Command Proxy

`VN.command(ucpString)` parses and dispatches a Universal Cinematic Protocol command and returns whether the command was valid.

```javascript
VN.command('anim:shake:Skirk');
VN.command('sfx:trigger:impact.mp3');
```

Use the direct typed API when one exists. Use `VN.command()` when your plugin intentionally works with dynamic or prebuilt UCP strings.

## Pixi Plugin Lifecycle

`VN.pixiPlugins` is the public lifecycle registry for long-lived Pixi frontend plugins. Registering the same ID again disposes the previous instance, preventing duplicate socket listeners and ticker hooks after reconnects or reinjection.

```javascript
VN.pixiPlugins.register('my_vfx_plugin', (runtime) => {
  runtime.onWindow('my-plugin:flash', handleFlash);
  runtime.onSocket('my-plugin:update', handleUpdate);
  runtime.onPreRender((ticker) => updateEffect(ticker.deltaMS), 10);
  runtime.onPostRender(renderOverlay);
  runtime.onDispose(cleanupEffect);

  return () => removePluginOwnedObjects();
});
```

The registry also exposes `dispose`, `disposeAll`, `isRegistered`, `pause`, `resume`, `pauseAll`, `resumeAll`, `getPixiApp`, and `isInTakeover`.

`window.__PIXI_PLUGINS` remains a compatibility alias. New plugins should use `VN.pixiPlugins`.

## Diagnostics

`VN.memoryDebug()` returns browser, DOM, sprite, renderer, and optional shading diagnostics. Use it for development diagnostics, not gameplay behavior or persistent state.

For scoped gameplay overlays and Pixi takeovers, use the [GUI Intercept SDK](../gui_intercept_sdk/index.html). For complete plugin examples, see the [Plugin Example Catalog](../plugin_dev/examples.md).
