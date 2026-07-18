# UCP Protocol Reference

The **Universal Cinematic Protocol (UCP)** is the canonical instruction set used to control the Visual Novel's presentation. It allows both the AI and plugins to trigger animations, sounds, and visual effects using a standardized string format.

## 1. Syntax Pattern

`prefix : action : payload [ : modifier1 : modifier2 ]`

- **Modifiers**:
  - `:locked`: Prevents the user from skipping the line until the event completes.
  - `:instant`: Triggers the event immediately without a transition.

---

## 2. Command Categories

### Camera (`cam`)
Controls the virtual camera viewport.
- `cam:wide`: Resets the camera to a wide view.
- `cam:auto`: Enables automatic zooming on the speaker.

### Animations (`anim`)
Triggers character-specific animations.
- `anim:bounce:CharacterName`
- `anim:shake:CharacterName`
- `anim:sink:CharacterName`
- `anim:slowsink:CharacterName`

### Emotes (`emote`)
Displays floating icons above a character.
- `emote:heart:CharacterName`
- `emote:sweat:CharacterName`
- `emote:anger:CharacterName`

### Sprite Shadows (`shadow`)
Turns automatic character-shaped Pixi shadows on or off for active sprites.
- `shadow:on:CharacterName|angle=82|strength=0.35|length=0.85|blur=4`
- `shadow:off:CharacterName`
- `shadow:on:all|angle=82|opacity=0.25`: Applies to every active managed sprite.

Shadow options are optional. Supported command keys are `angle`, `opacity`/`strength`, `length`, and `blur`. Renderer-quality/contact-detection defaults live in `visual_novel.settings.performance.sprite_shadows`, not scene commands.

### Audio (`sfx`)
Plays or stops sound effects and ambient loops.
- `sfx:play:filename`: Plays a one-off sound effect.
- `sfx:start:filename`: Starts a looping background sound.
- `sfx:stop:filename`: Stops a specific looping sound.

### Visual Effects (`vfx`)
Manages persistent visual states or triggers one-off effects.
- `vfx:start:vfx_id:{"json_payload"}`: Starts a persistent VFX (e.g., rain, fire).
- `vfx:trigger:vfx_id`: Triggers a one-off effect (e.g., a flash, a screen shake).
- `vfx:clear:vfx_id`: Removes a persistent VFX.

### Scenes & Transitions (`scene`)
Handles background changes and screen transitions.
- `scene:transition:type:background_path`: Transitions to a new background using a specific effect (e.g., `fade_to_black`, `crossfade`).

### Cast & Characters (`cast`)
Manages the occupancy of characters on screen.
- `cast:flush`: Immediately clears all characters from the scene. Useful for POV shifts or time skips.

### Titles & UI (`title`)
Displays cinematic text overlays.
- `title:Style:MainText:SubText`: Shows a stylized title (e.g., `harbinger`, `chapter_intro`).
- `title:{"json_config"}`: Advanced configuration for custom positioning and timing.

### Game State (`gameover`)
Triggers the terminal game state.
- `gameover:PrimaryText:SecondaryText`: Displays the game over screen and halts all progression.
