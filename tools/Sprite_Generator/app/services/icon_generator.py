"""Batch character portrait discovery, face framing, and WebP export."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Callable, Iterable

import cv2
import numpy as np
from PIL import Image


IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
ANIMATED_SUFFIXES = ("_talk_blink", "_blink", "_talk")
SUPPORTED_ANGLES = {"front", "left", "right", "back"}


@dataclass(frozen=True)
class IconCandidate:
    path: Path
    character: str
    expression: str
    angle: str
    rank: tuple


@dataclass
class Detection:
    bbox: np.ndarray
    points: np.ndarray
    bbox_confidence: float
    landmark_confidence: float

    @property
    def quality(self) -> float:
        return (self.bbox_confidence * 0.72) + (self.landmark_confidence * 0.28)


@dataclass
class CharacterResult:
    character: str
    status: str
    source: Path | None = None
    output: Path | None = None
    message: str = ""


def parse_sprite_path(path: Path, expressions: Iterable[str]) -> tuple[str, str, str] | None:
    """Parse Character_expression_angle, excluding blink/talk animation variants."""
    stem = path.stem
    lowered = stem.casefold()
    if any(lowered.endswith(suffix) for suffix in ANIMATED_SUFFIXES):
        return None

    expression_names = sorted({str(value).casefold() for value in expressions}, key=len, reverse=True)
    for angle in SUPPORTED_ANGLES:
        angle_suffix = f"_{angle}"
        if not lowered.endswith(angle_suffix):
            continue
        without_angle = stem[: -len(angle_suffix)]
        lowered_without_angle = lowered[: -len(angle_suffix)]
        for expression in expression_names:
            expression_suffix = f"_{expression}"
            if lowered_without_angle.endswith(expression_suffix):
                character = without_angle[: -len(expression_suffix)].strip(" _-")
                if character:
                    return character, expression, angle
    return None


def candidate_rank(expression: str, angle: str, expression_order: Iterable[str], path: Path) -> tuple:
    expressions = [str(value).casefold() for value in expression_order]
    try:
        expression_index = expressions.index(expression.casefold())
    except ValueError:
        expression_index = len(expressions)

    neutral = expression.casefold() == "neutral"
    if angle == "front":
        pose_tier = 0 if neutral else 1
    elif angle in {"left", "right"}:
        pose_tier = 2 if neutral else 3
    else:
        pose_tier = 99
    # Prefer the library root over outfit/mod subfolders when the pose and
    # expression are otherwise equivalent. The path remains the stable final
    # tie-breaker when candidates live at the same depth.
    directory_depth = max(0, len(path.parts) - 1)
    return pose_tier, expression_index, directory_depth, str(path).casefold()


def discover_candidates(root: Path, expressions: Iterable[str]) -> dict[str, list[IconCandidate]]:
    expressions = tuple(expressions)
    grouped: dict[str, list[IconCandidate]] = {}
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.casefold() not in IMAGE_EXTENSIONS:
            continue
        parsed = parse_sprite_path(path, expressions)
        if parsed is None:
            continue
        character, expression, angle = parsed
        if angle == "back":
            continue
        candidate = IconCandidate(
            path=path,
            character=character,
            expression=expression,
            angle=angle,
            rank=candidate_rank(expression, angle, expressions, path.relative_to(root)),
        )
        grouped.setdefault(character.casefold(), []).append(candidate)

    for candidates in grouped.values():
        candidates.sort(key=lambda item: item.rank)
    return dict(sorted(grouped.items(), key=lambda item: item[0]))


def _load_rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def detect_best_face(detector, image: Image.Image) -> Detection | None:
    rgba = np.asarray(image.convert("RGBA"))
    bgr = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)
    predictions = detector(bgr) or []
    valid = []
    for prediction in predictions:
        bbox = np.asarray(prediction.get("bbox", []), dtype=np.float32)
        keypoints = np.asarray(prediction.get("keypoints", []), dtype=np.float32)
        if bbox.size < 4 or keypoints.ndim != 2 or len(keypoints) != 28 or keypoints.shape[1] < 2:
            continue
        bbox_confidence = float(bbox[4]) if bbox.size > 4 else 0.0
        if keypoints.shape[1] > 2:
            landmark_confidence = float(np.clip(np.mean(keypoints[:, 2]), 0.0, 1.0))
        else:
            landmark_confidence = bbox_confidence
        width = max(1.0, float(bbox[2] - bbox[0]))
        height = max(1.0, float(bbox[3] - bbox[1]))
        area = width * height
        detection = Detection(bbox[:4], keypoints[:, :2], bbox_confidence, landmark_confidence)
        # Confidence remains dominant, with a mild preference for the primary/larger face.
        selection_score = detection.quality * (area ** 0.08)
        valid.append((selection_score, detection))
    return max(valid, key=lambda item: item[0])[1] if valid else None


def has_useful_alpha(image: Image.Image) -> bool:
    alpha = np.asarray(image.convert("RGBA"), dtype=np.uint8)[:, :, 3]
    return bool(np.any(alpha < 250))


def _remove_background(image: Image.Image, session) -> Image.Image:
    import rembg

    result = rembg.remove(image, session=session)
    if isinstance(result, Image.Image):
        return result.convert("RGBA")
    if isinstance(result, (bytes, bytearray)):
        from io import BytesIO

        with Image.open(BytesIO(result)) as decoded:
            return decoded.convert("RGBA")
    return Image.fromarray(np.asarray(result)).convert("RGBA")


def _transparent_square(image: Image.Image, left: float, top: float, side: float) -> Image.Image:
    side_px = max(2, int(round(side)))
    x0, y0 = int(round(left)), int(round(top))
    x1, y1 = x0 + side_px, y0 + side_px
    canvas = Image.new("RGBA", (side_px, side_px), (0, 0, 0, 0))
    source_box = (max(0, x0), max(0, y0), min(image.width, x1), min(image.height, y1))
    if source_box[2] > source_box[0] and source_box[3] > source_box[1]:
        patch = image.crop(source_box)
        canvas.alpha_composite(patch, (source_box[0] - x0, source_box[1] - y0))
    return canvas


def _premultiplied_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = rgba[:, :, 3:4]
    premultiplied = rgba[:, :, :3] * alpha
    target = tuple(int(value) for value in size)
    resized_rgb = cv2.resize(premultiplied, target, interpolation=cv2.INTER_LANCZOS4)
    resized_alpha = cv2.resize(alpha[:, :, 0], target, interpolation=cv2.INTER_LANCZOS4)
    resized_alpha = np.clip(resized_alpha, 0.0, 1.0)
    denominator = np.maximum(resized_alpha[:, :, None], 1.0 / 255.0)
    straight_rgb = np.where(resized_alpha[:, :, None] > 0.0, resized_rgb / denominator, 0.0)
    output = np.dstack((np.clip(straight_rgb, 0.0, 1.0), resized_alpha))
    return Image.fromarray(np.rint(output * 255.0).astype(np.uint8), "RGBA")


def frame_portrait(image: Image.Image, detection: Detection, output_size: int = 256) -> Image.Image:
    points = detection.points
    bbox = detection.bbox
    eye_points = points[[11, 12, 13, 17, 18, 19]]
    eye_midpoint = np.mean(eye_points, axis=0)
    jaw_width = float(np.linalg.norm(points[4] - points[0]))
    bbox_width = max(1.0, float(bbox[2] - bbox[0]))
    bbox_height = max(1.0, float(bbox[3] - bbox[1]))
    side = max(40.0, jaw_width * 2.55, bbox_width * 1.62, bbox_height * 1.48)
    bbox_center_x = float((bbox[0] + bbox[2]) * 0.5)
    center_x = (float(eye_midpoint[0]) * 0.72) + (bbox_center_x * 0.28)
    left = center_x - (side * 0.5)
    top = float(eye_midpoint[1]) - (side * 0.42)
    square = _transparent_square(image.convert("RGBA"), left, top, side)
    return _premultiplied_resize(square, (output_size, output_size))


def safe_character_filename(character: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " _-" else "_" for ch in character).strip(" ._-")
    return cleaned or "character"


def generate_character_icons(
    source_root: Path,
    output_root: Path,
    expressions: Iterable[str],
    detector_provider: Callable[[Callable[[str], None]], object],
    *,
    remove_background: bool = True,
    overwrite: bool = False,
    max_candidates: int = 4,
    quality: int = 85,
    progress: Callable[[dict], None] | None = None,
    cancel_event: Event | None = None,
) -> list[CharacterResult]:
    emit = progress or (lambda _event: None)
    cancelled = cancel_event or Event()
    groups = discover_candidates(Path(source_root), expressions)
    emit({"type": "scan", "characters": len(groups), "candidates": sum(map(len, groups.values()))})
    if not groups:
        return []

    detector = None
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    bg_session = None
    results: list[CharacterResult] = []

    for index, candidates in enumerate(groups.values(), start=1):
        if cancelled.is_set():
            break
        character = candidates[0].character
        output = output_root / f"{safe_character_filename(character)}_icon.webp"
        emit({"type": "character", "index": index, "total": len(groups), "character": character})
        if output.exists() and not overwrite:
            result = CharacterResult(character, "skipped", output=output, message="Output already exists")
            results.append(result)
            emit({"type": "result", "result": result})
            continue

        if detector is None:
            detector = detector_provider(lambda message: emit({"type": "log", "message": message}))

        best: tuple[IconCandidate, Image.Image, Detection] | None = None
        errors = []
        for candidate in candidates[: max(1, int(max_candidates))]:
            if cancelled.is_set():
                break
            try:
                image = _load_rgba(candidate.path)
                detection = detect_best_face(detector, image)
                if detection is None:
                    errors.append(f"No face: {candidate.path.name}")
                    continue
                # Candidate order is intentional. A valid neutral/front face wins;
                # later expressions and side views are fallbacks, not competitors.
                best = candidate, image, detection
                break
            except Exception as exc:
                errors.append(f"{candidate.path.name}: {exc}")

        if cancelled.is_set():
            break
        if best is None:
            message = errors[-1] if errors else "No usable face was detected"
            result = CharacterResult(character, "failed", message=message)
            results.append(result)
            emit({"type": "result", "result": result})
            continue

        candidate, image, detection = best
        try:
            if remove_background and not has_useful_alpha(image):
                if bg_session is None:
                    import rembg

                    emit({"type": "log", "message": "Initializing BiRefNet background removal…"})
                    bg_session = rembg.new_session("birefnet-general")
                image = _remove_background(image, bg_session)
            portrait = frame_portrait(image, detection)
            portrait.save(output, format="WEBP", quality=int(quality), method=6)
            result = CharacterResult(character, "created", source=candidate.path, output=output)
        except Exception as exc:
            result = CharacterResult(character, "failed", source=candidate.path, message=str(exc))
        results.append(result)
        emit({"type": "result", "result": result})

    return results
