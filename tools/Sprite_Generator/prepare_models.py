"""Check and download the processing models used by the Sprite Generator."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import sys

import requests


ROOT = Path(__file__).resolve().parent
WEIGHTS_DIR = ROOT / "weights"
os.environ.setdefault("HF_HOME", str(WEIGHTS_DIR / "huggingface"))
os.environ.setdefault("U2NET_HOME", str(WEIGHTS_DIR / "rembg"))
REALESRGAN_PATH = WEIGHTS_DIR / "RealESRGAN_x4plus_anime_6B.pth"
REALESRGAN_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/"
    "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
)
REALESRGAN_SHA256 = "f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da"

U2NET_HOME = Path(
    os.path.expanduser(
        os.getenv("U2NET_HOME", os.path.join(os.getenv("XDG_DATA_HOME", "~"), ".u2net"))
    )
)
REMBG_MODELS = {
    "BiRefNet-General": (U2NET_HOME / "birefnet-general.onnx", 900_000_000),
    "U2Net fallback": (U2NET_HOME / "u2net.onnx", 150_000_000),
}
ANIME_MODELS = {
    "anime YOLOv3 detector": "hysts/anime-face-detector-yolov3",
    "anime HRNetV2 landmarks": "hysts/anime-face-detector-hrnetv2",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def realesrgan_ready() -> bool:
    return (
        REALESRGAN_PATH.is_file()
        and REALESRGAN_PATH.stat().st_size > 10_000_000
        and sha256(REALESRGAN_PATH) == REALESRGAN_SHA256
    )


def rembg_model_ready(path: Path, minimum_size: int) -> bool:
    return path.is_file() and path.stat().st_size >= minimum_size


def anime_model_ready(repo_id: str) -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache

        cached = try_to_load_from_cache(repo_id, "model.safetensors")
        return isinstance(cached, str) and Path(cached).is_file()
    except Exception:
        return False


def model_status() -> dict[str, bool]:
    status = {"Real-ESRGAN anime 4x": realesrgan_ready()}
    status.update(
        {
            name: rembg_model_ready(path, minimum_size)
            for name, (path, minimum_size) in REMBG_MODELS.items()
        }
    )
    status.update({name: anime_model_ready(repo) for name, repo in ANIME_MODELS.items()})
    return status


def print_status(status: dict[str, bool]) -> None:
    for name, ready in status.items():
        print(f"  [{'OK' if ready else 'MISSING'}] {name}")


def download_realesrgan() -> None:
    print("Downloading Real-ESRGAN anime 4x model...")
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = REALESRGAN_PATH.with_suffix(REALESRGAN_PATH.suffix + ".download")
    try:
        with requests.get(REALESRGAN_URL, stream=True, timeout=(30, 300)) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            downloaded = 0
            with temporary_path.open("wb") as model_file:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    model_file.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        print(f"  {downloaded * 100 // total:3d}%", end="\r", flush=True)
        if sha256(temporary_path) != REALESRGAN_SHA256:
            raise RuntimeError("Real-ESRGAN download failed its SHA-256 integrity check.")
        temporary_path.replace(REALESRGAN_PATH)
        print("  100% - verified")
    finally:
        temporary_path.unlink(missing_ok=True)


def download_rembg_models() -> None:
    from rembg.sessions.birefnet_general import BiRefNetSessionGeneral
    from rembg.sessions.u2net import U2netSession

    if not rembg_model_ready(*REMBG_MODELS["BiRefNet-General"]):
        print("Downloading BiRefNet-General background-removal model...")
        BiRefNetSessionGeneral.download_models()
    if not rembg_model_ready(*REMBG_MODELS["U2Net fallback"]):
        print("Downloading U2Net fallback background-removal model...")
        U2netSession.download_models()


def download_anime_models() -> None:
    from huggingface_hub import hf_hub_download

    for name, repo_id in ANIME_MODELS.items():
        if not anime_model_ready(repo_id):
            print(f"Downloading {name}...")
            hf_hub_download(repo_id, "model.safetensors")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only report whether every required model is already available.",
    )
    args = parser.parse_args()

    print("Model status:")
    status = model_status()
    print_status(status)
    if args.check:
        return 0 if all(status.values()) else 2

    if not status["Real-ESRGAN anime 4x"]:
        download_realesrgan()
    download_rembg_models()
    download_anime_models()

    print("Model verification:")
    final_status = model_status()
    print_status(final_status)
    if not all(final_status.values()):
        print("One or more model downloads did not complete correctly.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
