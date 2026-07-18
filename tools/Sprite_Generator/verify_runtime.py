"""Fast, non-interactive startup health check for the Sprite Generator."""

from __future__ import annotations

import argparse

import tkinter as tk


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect-cuda", action="store_true")
    args = parser.parse_args()

    root = tk.Tk()
    root.withdraw()
    root.destroy()

    # Native ML libraries are intentionally imported after Tk. Some Conda
    # runtimes otherwise lose their Tcl/Tk DLL lookup path on Windows.
    import cv2  # noqa: F401
    import numpy  # noqa: F401
    import onnxruntime
    import rembg  # noqa: F401
    import requests  # noqa: F401
    import scipy  # noqa: F401
    import spandrel  # noqa: F401
    import torch
    import torchvision  # noqa: F401
    from anime_face_detector import create_detector  # noqa: F401
    from PIL import Image  # noqa: F401

    providers = onnxruntime.get_available_providers()
    print("  [OK] Tk interface")
    print("  [OK] Required Python imports")
    print("  [OK] ONNX Runtime: " + ", ".join(providers))

    if torch.cuda.is_available():
        print("  [OK] CUDA: " + torch.cuda.get_device_name(0))
    elif args.expect_cuda:
        raise RuntimeError(
            "An NVIDIA GPU was detected, but the CUDA PyTorch runtime is unavailable. "
            "Update the NVIDIA driver and run setup again."
        )
    else:
        print("  [OK] PyTorch CPU mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
