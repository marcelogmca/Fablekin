import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from app.services.icon_generator import Detection, discover_candidates, frame_portrait, parse_sprite_path


EXPRESSIONS = ("neutral", "happy", "sad")


class IconGeneratorTests(unittest.TestCase):
    def test_parser_preserves_character_underscores_and_rejects_animation(self):
        self.assertEqual(
            parse_sprite_path(Path("Lady_Knight_neutral_front.webp"), EXPRESSIONS),
            ("Lady_Knight", "neutral", "front"),
        )
        self.assertIsNone(parse_sprite_path(Path("Lady_Knight_neutral_front_talk.webp"), EXPRESSIONS))

    def test_discovery_prefers_neutral_front_and_ignores_back(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in (
                "Ada_happy_front.webp",
                "Ada_neutral_right.webp",
                "Ada_neutral_front.webp",
                "Ada_neutral_back.webp",
            ):
                (root / name).touch()
            candidates = discover_candidates(root, EXPRESSIONS)["ada"]
            self.assertEqual(candidates[0].path.name, "Ada_neutral_front.webp")
            self.assertNotIn("Ada_neutral_back.webp", [item.path.name for item in candidates])

    def test_discovery_prefers_root_sprite_over_outfit_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            nested = root / "Frieren" / "Winter_Outfit"
            nested.mkdir(parents=True)
            root_sprite = root / "Frieren_neutral_front.webp"
            nested_sprite = nested / "Frieren_neutral_front.webp"
            root_sprite.touch()
            nested_sprite.touch()

            candidates = discover_candidates(root, EXPRESSIONS)["frieren"]
            self.assertEqual(candidates[0].path, root_sprite)
            self.assertEqual(candidates[1].path, nested_sprite)

    def test_portrait_is_256_rgba_with_transparent_padding(self):
        image = Image.new("RGBA", (60, 70), (255, 0, 0, 255))
        points = np.zeros((28, 2), dtype=np.float32)
        points[:] = (30, 28)
        points[0] = (15, 55)
        points[4] = (45, 55)
        detection = Detection(np.array([10, 10, 50, 65], dtype=np.float32), points, 0.95, 0.9)
        portrait = frame_portrait(image, detection)
        self.assertEqual(portrait.size, (256, 256))
        self.assertEqual(portrait.mode, "RGBA")
        self.assertLess(np.asarray(portrait)[:, :, 3].min(), 255)


if __name__ == "__main__":
    unittest.main()
