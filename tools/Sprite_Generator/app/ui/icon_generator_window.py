"""Separate batch character-icon workflow for the Sprite Generator GUI."""

from __future__ import annotations

import os
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk

from app.constants import CHARACTER_ICONS_DIR
from app.services.icon_generator import generate_character_icons


class IconGeneratorWindow(tk.Toplevel):
    def __init__(self, parent, expressions, detector_provider):
        super().__init__(parent)
        self.parent = parent
        self.expressions = tuple(expressions)
        self.detector_provider = detector_provider
        self.events = queue.Queue()
        self.cancel_event = threading.Event()
        self.worker = None
        self.title("Automated Character Icon Generator")
        self.geometry("900x650")
        self.minsize(740, 520)
        self.configure(bg=parent.bg_color)
        self.transient(parent)
        self.source_var = tk.StringVar()
        self.remove_background_var = tk.BooleanVar(value=True)
        self.overwrite_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="Choose a sprite folder to begin.")
        self.progress_var = tk.DoubleVar(value=0.0)
        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(80, self._poll_events)

    def _build_ui(self):
        header = tk.Frame(self, bg=self.parent.surface_color, height=64, highlightthickness=1, highlightbackground=self.parent.border_color)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(header, text="Character Icon Generator", bg=self.parent.surface_color, fg=self.parent.fg_color, font=("Segoe UI Semibold", 15)).pack(anchor="w", padx=18, pady=(10, 0))
        tk.Label(header, text="Find one strong portrait per character without processing every animation frame.", bg=self.parent.surface_color, fg=self.parent.subtext_color, font=("Segoe UI", 9)).pack(anchor="w", padx=18)

        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        source_frame = ttk.LabelFrame(body, text="Sprite library", padding=10)
        source_frame.pack(fill="x")
        row = ttk.Frame(source_frame)
        row.pack(fill="x")
        self.source_entry = ttk.Entry(row, textvariable=self.source_var)
        self.source_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Browse...", command=self._browse).pack(side="left", padx=(8, 0))
        ttk.Label(source_frame, text=f"Output: {CHARACTER_ICONS_DIR}", foreground=self.parent.subtext_color).pack(anchor="w", pady=(7, 0))

        options = ttk.Frame(body)
        options.pack(fill="x", pady=(10, 0))
        ttk.Checkbutton(options, text="Remove opaque backgrounds (BiRefNet)", variable=self.remove_background_var).pack(side="left")
        ttk.Checkbutton(options, text="Overwrite existing icons", variable=self.overwrite_var).pack(side="left", padx=(20, 0))
        ttk.Label(body, text="Selection order: neutral front -> another front -> neutral side -> another side. Blink, talk, and back sprites are ignored.", foreground=self.parent.subtext_color, wraplength=820).pack(anchor="w", pady=(8, 10))

        self.progress = ttk.Progressbar(body, variable=self.progress_var, maximum=100)
        self.progress.pack(fill="x")
        ttk.Label(body, textvariable=self.status_var).pack(anchor="w", pady=(5, 8))
        self.log = scrolledtext.ScrolledText(body, height=14, state="disabled", font=("Consolas", 9))
        self.parent._style_scrolled_text(self.log)
        self.log.pack(fill="both", expand=True)

        buttons = ttk.Frame(body)
        buttons.pack(fill="x", pady=(12, 0))
        self.generate_button = ttk.Button(buttons, text="Generate Icons", style="Accent.TButton", command=self._start)
        self.generate_button.pack(side="right")
        self.cancel_button = ttk.Button(buttons, text="Cancel", command=self._cancel, state="disabled")
        self.cancel_button.pack(side="right", padx=(0, 8))
        ttk.Button(buttons, text="Open Output Folder", command=self._open_output).pack(side="left")

    def _browse(self):
        path = filedialog.askdirectory(parent=self, title="Choose the sprite library")
        if path:
            self.source_var.set(path)

    def _append_log(self, message):
        self.log.configure(state="normal")
        self.log.insert("end", str(message) + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _start(self):
        source = Path(self.source_var.get().strip())
        if not source.is_dir():
            messagebox.showerror("Sprite folder required", "Choose an existing folder containing generated sprites.", parent=self)
            return
        self.cancel_event.clear()
        self.progress_var.set(0)
        self.status_var.set("Scanning folders...")
        self.generate_button.configure(state="disabled")
        self.cancel_button.configure(state="normal")
        remove_background = bool(self.remove_background_var.get())
        overwrite = bool(self.overwrite_var.get())
        self.worker = threading.Thread(
            target=self._run,
            args=(source, remove_background, overwrite),
            daemon=True,
        )
        self.worker.start()

    def _run(self, source, remove_background, overwrite):
        try:
            results = generate_character_icons(
                source, Path(CHARACTER_ICONS_DIR), self.expressions, self.detector_provider,
                remove_background=remove_background,
                overwrite=overwrite,
                progress=self.events.put, cancel_event=self.cancel_event,
            )
            self.events.put({"type": "done", "results": results, "cancelled": self.cancel_event.is_set()})
        except Exception as exc:
            self.events.put({"type": "fatal", "message": str(exc)})

    def _poll_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event.get("type")
                if kind == "scan":
                    self._append_log(f"Found {event['characters']} character(s) across {event['candidates']} eligible sprite(s).")
                    if not event["characters"]:
                        self.status_var.set("No matching Character_expression_angle images were found.")
                elif kind == "log":
                    self._append_log(event["message"])
                elif kind == "character":
                    self.progress_var.set(((event["index"] - 1) / max(1, event["total"])) * 100)
                    self.status_var.set(f"Processing {event['index']}/{event['total']}: {event['character']}")
                elif kind == "result":
                    result = event["result"]
                    detail = result.source.name if result.source else result.message
                    self._append_log(f"{result.status.upper():7} {result.character}  {detail}")
                elif kind == "done":
                    self._finish(event["results"], event["cancelled"])
                elif kind == "fatal":
                    self._finish([], False, event["message"])
        except queue.Empty:
            pass
        if self.winfo_exists():
            self.after(80, self._poll_events)

    def _finish(self, results, cancelled, error=None):
        self.generate_button.configure(state="normal")
        self.cancel_button.configure(state="disabled")
        if error:
            self.status_var.set(f"Stopped: {error}")
            self._append_log(f"ERROR   {error}")
            return
        created = sum(result.status == "created" for result in results)
        skipped = sum(result.status == "skipped" for result in results)
        failed = sum(result.status == "failed" for result in results)
        if not cancelled:
            self.progress_var.set(100)
        prefix = "Cancelled." if cancelled else "Finished."
        self.status_var.set(f"{prefix} Created {created}, skipped {skipped}, failed {failed}.")

    def _cancel(self):
        self.cancel_event.set()
        self.cancel_button.configure(state="disabled")
        self.status_var.set("Cancelling after the current image...")

    def _open_output(self):
        os.makedirs(CHARACTER_ICONS_DIR, exist_ok=True)
        os.startfile(CHARACTER_ICONS_DIR)

    def _close(self):
        if self.worker and self.worker.is_alive():
            self.cancel_event.set()
        self.destroy()
