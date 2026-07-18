"""Central constants shared across Sprite Generator modules."""

import os

from PIL import Image

SPRITE_GENERATOR_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STATE_FILE = os.path.join(SPRITE_GENERATOR_ROOT, "state.json")
LEGACY_STATE_FILE = os.path.join(SPRITE_GENERATOR_ROOT, "state_wisdom.json")
OUTPUT_DIR = os.path.join(SPRITE_GENERATOR_ROOT, "output_sprites")  # intermediate / originals / debug
FINAL_DIR = os.path.join(SPRITE_GENERATOR_ROOT, "final_sprites")  # clean final sprites only
CHARACTER_ICONS_DIR = os.path.join(SPRITE_GENERATOR_ROOT, "character_icons")

# Region paste safety for lineart-heavy faces:
# - Snap tiny scale deltas to 1.0 (avoids unnecessary resample noise).
# - Use a non-ringing resampler for small facial patches.
# - Ignore low-alpha source pixels when doing hard cutout replacement.
REGION_SCALE_SNAP_EPS = 0.003
REGION_TOP_RESAMPLE = Image.BICUBIC
REGION_ALPHA_SOLID_THRESHOLD = 200
