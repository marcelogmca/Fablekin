def run() -> None:
    import os
    from pathlib import Path

    sprite_generator_root = Path(__file__).resolve().parent.parent
    weights_dir = sprite_generator_root / "weights"
    os.environ.setdefault("HF_HOME", str(weights_dir / "huggingface"))
    os.environ.setdefault("U2NET_HOME", str(weights_dir / "rembg"))

    # Conda's Tcl/Tk runtime must initialize before OpenCV/PyTorch adjust the
    # Windows native-DLL search path during main_window imports.
    import tkinter as tk

    bootstrap_root = tk.Tk()
    bootstrap_root.withdraw()
    bootstrap_root.destroy()

    from app.ui.main_window import SpriteGeneratorApp

    app = SpriteGeneratorApp()
    app.mainloop()


if __name__ == "__main__":
    run()
