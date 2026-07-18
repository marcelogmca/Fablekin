/**
 * Custom loader for animated WebP files in PixiJS using the ImageDecoder API.
 * This decodes individual frames and manages playback timings.
 */

export async function loadAnimatedWebP(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch animated WebP: ${url}`);
    const buffer = await resp.arrayBuffer();

    // Create the ImageDecoder for webp
    const decoder = new ImageDecoder({
        data: buffer,
        type: 'image/webp'
    });

    // Wait for tracks info (frameCount, etc.)
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;

    // If not animated, return a normal sprite (fallback)
    if (!track.animated || track.frameCount <= 1) {
        const bitmap = await createImageBitmap(new Blob([buffer]));
        const tex = PIXI.Texture.from(bitmap);
        return new PIXI.Sprite(tex);
    }

    // Decode all frames
    const textures = [];
    const frameDurations = []; // in seconds

    for (let i = 0; i < track.frameCount; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const vb = result.image; // VideoFrame
        const bitmap = await createImageBitmap(vb);
        
        if (typeof vb.close === 'function') vb.close();

        textures.push(PIXI.Texture.from(bitmap));

        // VideoFrame.duration is in microseconds
        const durationUs = vb.duration ?? 1000000 / 30; // fallback ≈ 33ms
        frameDurations.push(durationUs / 1_000_000);
    }

    // Create custom sprite controller
    const sprite = new PIXI.Sprite(textures[0]);
    
    sprite._playing = false;
    sprite._ticking = false;
    sprite._current = 0;
    sprite._elapsed = 0;
    sprite._lastTime = 0;

    const ticker = PIXI.Ticker.shared;

    const step = (tickerObj) => {
        if (!sprite._playing) return;
        
        const dt = tickerObj.elapsedMS / 1000;
        sprite._elapsed += dt;

        const curDur = frameDurations[sprite._current] || (1/30);
        if (sprite._elapsed >= curDur) {
            sprite._elapsed -= curDur;
            sprite._current = (sprite._current + 1) % textures.length;
            sprite.texture = textures[sprite._current];
        }
    };

    sprite.play = () => {
        if (!sprite._ticking) {
            ticker.add(step);
            sprite._ticking = true;
        }
        sprite._playing = true;
    };

    sprite.stop = () => {
        sprite._playing = false;
    };

    sprite.gotoAndStop = (idx) => {
        sprite._current = idx % textures.length;
        sprite.texture = textures[sprite._current];
    };

    // Robust destruction
    const originalDestroy = sprite.destroy;
    sprite.destroy = (options) => {
        if (sprite._ticking) {
            ticker.remove(step);
        }
        textures.forEach(t => t.destroy(true));
        decoder.close?.();
        originalDestroy.call(sprite, options);
    };

    return sprite;
}
