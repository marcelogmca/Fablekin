> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Sprite Setup Guide

How to organize your character images for the Dynamic Narrative Engine.

## Basics

Place your character sprite images in your project's `sprites` folder. The engine automatically
detects and uses them based on their filenames.

**Supported formats:** `.png`, `.jpg`, `.jpeg`, `.webp`
(PNG and WEBP are recommended because of transparency support, webp is specially recommended because of its
compression).

## Naming Convention

Format: `CharacterName_Emotion.extension`

Examples:

- `stella_happy.png`

- `Gin_sad.webp`

- `Tivo_neutral.png`

- `Anya_thinking.jpg`

The engine automatically extracts emotion names from your sprite filenames and uses them when the LLM classifies
dialogue emotions.

## Special Suffixes

These suffixes have special meanings and are **NOT** treated as emotions:

- `_reference` &rarr; **IGNORED** by the VN engine. Used to store reference sheets for
your convenience, or as input for image generation plugins. These files will never be displayed in scenes.

- `_blink` &rarr; Animation layer. The eyes are closed/closed frame for blinking.

- `_talk` &rarr; Animation layer. Mouth is open/visible for talking animation.

- `_talk_blink` &rarr; Animation layer. Both talking and blinking at the same time.

- `_icon` &rarr; Character portrait/icon. Used in UI elements (character select, relationship
viewer, etc.).

## Rotation Suffixes

These suffixes define the character's orientation. The **Gaze Director** uses these to make
characters look at each other or at the player while talking.

- `_front` &rarr; Character looking at the camera/player. (Default)

- `_left` &rarr; Character rotated to their left (looking towards the right of the screen).

- `_right` &rarr; Character rotated to their right (looking towards the left of the screen).

- `_back` &rarr; Character looking away from the camera.

**NOTE:** If a specific rotation is requested but not found, the engine will automatically fall
back
to the `_front` version or the base emotion sprite.

## Advanced Naming Convention

For high-fidelity setups, you can combine emotions, rotations, and animation layers.

**Format:** `CharacterName_Emotion_Rotation_Animation.extension`

### Example of a complete character setup:



```
stella_neutral_front.webp           ← Base (Neutral, Front)
stella_neutral_front_blink.webp     ← Animation layer (Neutral, Front)
stella_neutral_front_talk.webp      ← Animation layer (Neutral, Front)
stella_neutral_front_talk_blink.webp← Combined layer (Neutral, Front)

stella_neutral_left.webp            ← Rotation variant
stella_neutral_left_blink.webp      ← Animation variant for rotation
stella_neutral_left_talk.webp       ← Animation variant for rotation

stella_happy_front.webp             ← Emotion + Rotation
stella_happy_front_blink.webp       ← Emotion + Rotation + Animation
```



**TIP:** You only need animation layers if you want those animations. The base sprite alone works
perfectly fine!

## Emotion Detection

The engine scans all sprite files and extracts available emotions automatically. If you have these files:

- `stella_happy.png`

- `stella_sad.png`

- `stella_angry.png`

- `stella_thinking.png`

The LLM will be told it can use: `neutral`, `happy`, `sad`, `angry`,
`thinking`.

`neutral` is always available by default (you don't need to create a neutral sprite, but it's highly
recommended).

## Fallback System

If a character doesn't have a specific emotion sprite, the engine tries multiple strategies in order:

- **Exact match:** `stella_happy.png`

- **First name:** `stella_happy.png` (if character name is "stella johnson")

- **Fuzzy match:** Finds closest filename match

- **Emotion only:** Matches any sprite with the emotion

- **Neutral:** Falls back to `stella_neutral.png`

- **Gender-based:** `generic_npc_male.png` or `generic_npc_female.png`

- **Generic:** `generic_npc.png`

## Generic NPC Sprites

For characters without specific sprites, you can provide generic fallbacks:

- `generic_npc.png` &rarr; Universal fallback

- `generic_npc_male.png` &rarr; Male characters (guessed by name)

- `generic_npc_female.png` &rarr; Female characters (guessed by name)

The engine uses a gender guessing system to match the appropriate generic sprite.

## Character Icons

Format: `CharacterName_icon.extension`

Used in UI elements like:

- Character selection dialogs

- Relationship viewer

- HUD displays

These are small portrait images typically square or circular.

## Common Emotions

Here are some common emotions to use (but you can use any words you want):



```
neutral       - Default/normal expression
happy         - Joyful, smiling
sad           - Sad, upset
angry         - Angry, annoyed
thinking      - Pondering, contemplative
talking       - Speaking (mid-sentence)
handinhip     - Hand on hip (casual)
surprised     - Shocked
confused      - Unsure
worried       - Concerned
blushing      - Embarrassed
determined    - Focused, serious
smiling       - Gentle smile
laughing      - Amused
serious       - Stoic, intense
```



**TIP:** Use lowercase filenames. Emotion matching is case-insensitive.

## Japanese Honorifics

The engine automatically strips common Japanese honorifics from character names before checking for sprites:

`-san, -chan, -kun, -sama, -sensei, -senpai, -dono, -shi, -tan, -nii, -nee, -ba, -ji, -bō, -chin, -cchi, -pē, -rin, -pon, -pyon, -maru, -hime, -ouji, -hakase, -shachou`

So `stella-sama` will match as `stella_happy.png` emotion.

## Sprite Positioning

The engine automatically positions sprites on screen (left, center, right).

- New sprites fill in this order: **center &rarr; left &rarr; right**

- When full, "coolest" (least used recently) sprite is replaced first

- Characters automatically exit after long gaps or when done speaking

No manual positioning needed!

(By default, up to 3 characters can be on stream at once, but this can be changed)

## Organization Tips

- **One folder per project:** `projects/YourProject/sprites/`

- **Group by character:** (optional but helpful)


```
sprites/
  ├── stella_neutral.png
  ├── stella_happy.png
  └── stella_reference.png
```



- Keep reference sheets with `_reference` suffix so they're ignored but still available. This is
important for the CG Generator plugin.

- **Use consistent naming:** Always use the same character name prefix for all sprites of that
character.

- **Start with "neutral"** - it's the most common emotion and a good fallback.

## Quick Start Checklist

- Create base sprites: `CharacterName_neutral.png` (at minimum)

- Add emotions you want: `CharacterName_happy.png`, etc.

- (optional) Add rotation variants: `CharacterName_left.png`, `CharacterName_right.png`,
`CharacterName_back.png`, `CharacterName_front.png`

- (Optional) Add animations: `_blink`, `_talk`, `_talk_blink` versions

- (Optional) Add icon: `CharacterName_icon.png`

- (Optional) Keep reference sheet: `CharacterName_reference.png`

For more information, check the engine documentation or ask in the community.

Happy sprite making! 🎨