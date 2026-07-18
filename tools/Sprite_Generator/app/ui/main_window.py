import base64
import hashlib
import io
import json
import math
import mimetypes
import os
import random
import re
import shutil
import threading
import time
import tkinter as tk
import uuid

import cv2
import numpy as np
import rembg
import requests
import scipy
from PIL import Image, ImageFilter, ImageOps, ImageTk
from tkinter import filedialog, scrolledtext, ttk

from app.constants import FINAL_DIR, LEGACY_STATE_FILE, OUTPUT_DIR, REGION_ALPHA_SOLID_THRESHOLD, REGION_SCALE_SNAP_EPS, REGION_TOP_RESAMPLE, SPRITE_GENERATOR_ROOT, STATE_FILE
from app.state_store import load_env_key as load_env_key_from_disk, load_state_file, save_state_file
from app.ui.icon_generator_window import IconGeneratorWindow
from app.ui.manual_alignment_popup import ManualAlignmentPopup

# Initialize Pure PyTorch Anime Face Detector (Lazy load to prevent startup freezing)
try:
    import torch
    from anime_face_detector import create_detector
except ImportError:
    create_detector = None
    torch = None

# REAL-ESRGAN (Lazy load via Spandrel for Python 3.12 compatibility)
try:
    import torch
    from spandrel import ImageModelDescriptor, ModelLoader
except ImportError:
    ImageModelDescriptor = None
    ModelLoader = None

class SpriteGeneratorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        # State is loaded before the UI is built, so startup messages must wait
        # until the status log widget exists.
        self._pending_log_messages = []
        self.title("AI Sprite Matrix Generator (Pure PyTorch Landmark Edition)")
        self.geometry("1400x850")
        
        # Constants for UI
        self.ALL_EXPRESSIONS =["neutral", "happy", "sad", "angry", "surprised", "thinking", "handinhip", "pouting", "confused", "laughing", "smirk", "comicalcry", "deadpan", "unimpressed", "sleepy", "loving", "embarrassed", "tinyproud", "scared", "spellfocus", "battleready", "menacinggrin"]
        self.ALL_ANGLES = ["front", "left", "right", "back"]

        self.state = {
            "config": {
                "api_key": "",
                "model": "gpt-image-1",
                "char_name": "dehya",
                "eye_color": "golden amber",
                "base_image": "",
                "ref_image": "",
                "ref_images": [],
                "selected_expressions":["neutral", "happy", "sad", "angry", "smirk", "comicalcry"],
                "selected_angles":["front", "left", "right", "back"],
                "prompt_expression": "Change the original image (blue background) so she has a {expr} expression. Keep the exact same pose, clothes, hair and art style. Keep eyes OPEN and mouth CLOSED. Feel free to make her body more expressive, but keep the feet anchored. Keep her eyes {color}.",
                "prompt_angle": "Change it so she is facing {angle} with a {expr} expression. Keep the same character, outfit and art style. Feel free to make her body more expressive, but keep her feet anchored. Keep her eyes {color}. Keep eyes OPEN and mouth CLOSED.",
                "prompt_post": "Change it so her pose remains EXACTLY as is, except she has closed eyes and an open mouth.",
                "upscale_4x": False,
                "compress_final_webp": False,
                "use_greenscreen": False,
                "fit_sprite_to_frame": False,
                "use_alignment_warping": True,
                "use_context_micro_align": True,
                "use_canny_head_align": True,
                "normalize_skin_tone": False,
                "symmetric_sprite": False,
                "use_local_comfyui": False,
                "comfyui_url": "http://127.0.0.1:8188",
                "comfyui_workflow_path": os.path.join(SPRITE_GENERATOR_ROOT, "workflow_flux.json"),
            },
            "tasks":[]
        }
        
        self.expr_vars = {}
        self.angle_vars = {}
        self.anime_detector = None # Will initialize on first local process
        self._anime_detector_lock = threading.Lock()
        self.icon_generator_window = None
        self.zoom_level = 200 # Default gallery zoom
        
        if not os.path.exists(OUTPUT_DIR):
            os.makedirs(OUTPUT_DIR)
        if not os.path.exists(FINAL_DIR):
            os.makedirs(FINAL_DIR)
        self.cache_dir = os.path.join(OUTPUT_DIR, "_cache")
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir, exist_ok=True)

        self.load_state()
        self._last_saved_env_api_key = self.state["config"].get("api_key", "")
        self.setup_styles()
        self.setup_ui()
        self.refresh_task_view()

    # ==========================================
    # UI SETUP
    # ==========================================
    def setup_styles(self):
        self.style = ttk.Style(self)
        self.style.theme_use('clam') 
        self.bg_color, self.fg_color, self.header_fg = "#0d0f14", "#e8eaf6", "#e8eaf6"
        self.accent_color, self.input_bg, self.btn_bg, self.btn_fg = "#5b8af0", "#1e2330", "#1e2330", "#e8eaf6"
        self.subtext_color = "#8892a4"
        self.border_color = "#2a3045"
        self.surface_color = "#161a23"
        self.panel_color = "#1e2330"
        self.configure(bg=self.bg_color)
        self.style.configure("TFrame", background=self.bg_color)
        self.style.configure("TLabel", background=self.bg_color, foreground=self.fg_color, font=("Segoe UI", 10))
        self.style.configure(
            "TButton",
            background=self.btn_bg,
            foreground=self.btn_fg,
            bordercolor=self.border_color,
            relief="flat",
            padding=(10, 6),
            font=("Segoe UI Semibold", 10),
        )
        self.style.map(
            "TButton",
            background=[('active', '#28304a')],
            bordercolor=[('active', self.accent_color)],
        )
        self.style.configure("Accent.TButton", background=self.accent_color, foreground="#ffffff")
        self.style.map("Accent.TButton", background=[('active', '#6b9bf5')])
        self.style.configure("TEntry", fieldbackground=self.input_bg, foreground=self.fg_color)
        self.style.configure(
            "TScrollbar",
            background=self.panel_color,
            troughcolor=self.surface_color,
            bordercolor=self.border_color,
            lightcolor=self.panel_color,
            darkcolor=self.panel_color,
            arrowcolor=self.fg_color,
            gripcount=0,
            relief="flat",
        )
        self.style.map(
            "TScrollbar",
            background=[("active", "#28304a"), ("pressed", self.accent_color)],
            arrowcolor=[("active", "#ffffff"), ("pressed", "#ffffff")],
        )
        self.style.configure(
            "TLabelframe",
            background=self.surface_color,
            bordercolor=self.border_color,
            relief="solid",
            borderwidth=1,
        )
        self.style.configure("TLabelframe.Label", background=self.surface_color, foreground=self.subtext_color, font=("Segoe UI Semibold", 10))
        self.option_add("*Text.background", self.input_bg)
        self.option_add("*Text.foreground", self.fg_color)
        self.option_add("*Text.insertBackground", self.fg_color)
        self.option_add("*Scale.background", self.bg_color)
        self.option_add("*Scale.troughColor", self.panel_color)

    def _style_scrolled_text(self, widget):
        widget.configure(
            bg=self.input_bg,
            fg=self.fg_color,
            insertbackground=self.fg_color,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=self.border_color,
            padx=8,
            pady=6,
        )
        if hasattr(widget, "vbar"):
            widget.vbar.configure(
                bg=self.panel_color,
                activebackground="#28304a",
                troughcolor=self.surface_color,
                bd=0,
                relief="flat",
                highlightthickness=0,
                width=12,
            )

    def add_tooltip(self, widget, text):
        tooltip = {"window": None, "after_id": None}

        def hide():
            if tooltip["after_id"] is not None:
                try:
                    widget.after_cancel(tooltip["after_id"])
                except Exception:
                    pass
                tooltip["after_id"] = None
            if tooltip["window"] is not None:
                try:
                    tooltip["window"].destroy()
                except Exception:
                    pass
                tooltip["window"] = None

        def show():
            hide()
            x = widget.winfo_rootx() + 18
            y = widget.winfo_rooty() + widget.winfo_height() + 8
            tip = tk.Toplevel(widget)
            tip.wm_overrideredirect(True)
            tip.wm_geometry(f"+{x}+{y}")
            label = tk.Label(
                tip,
                text=text,
                justify="left",
                bg="#242b3a",
                fg=self.fg_color,
                relief="solid",
                borderwidth=1,
                padx=8,
                pady=6,
                wraplength=340,
                font=("Segoe UI", 9),
            )
            label.pack()
            tooltip["window"] = tip

        def schedule_show(_event=None):
            hide()
            tooltip["after_id"] = widget.after(450, show)

        widget.bind("<Enter>", schedule_show, add="+")
        widget.bind("<Leave>", lambda _event=None: hide(), add="+")
        widget.bind("<ButtonPress>", lambda _event=None: hide(), add="+")
    def _dark_checkbutton(self, parent, text, variable, command=None):
        btn = tk.Checkbutton(
            parent,
            text=text,
            variable=variable,
            command=command,
            bg=self.panel_color,
            fg=self.fg_color,
            activebackground="#28304a",
            activeforeground=self.fg_color,
            indicatoron=False,
            selectcolor=self.accent_color,
            disabledforeground=self.subtext_color,
            highlightthickness=1,
            highlightbackground=self.border_color,
            highlightcolor=self.accent_color,
            borderwidth=0,
            relief="flat",
            anchor="w",
            justify="left",
            padx=8,
            pady=4,
            font=("Segoe UI", 10),
        )
        def _sync_state(*_):
            if bool(variable.get()):
                btn.configure(bg=self.accent_color, fg="#ffffff", activebackground="#6b9bf5", activeforeground="#ffffff")
            else:
                btn.configure(bg=self.panel_color, fg=self.fg_color, activebackground="#28304a", activeforeground=self.fg_color)

        variable.trace_add("write", _sync_state)
        _sync_state()
        return btn

    def setup_ui(self):
        title_bar = tk.Frame(self, bg=self.surface_color, height=52, highlightthickness=1, highlightbackground=self.border_color)
        title_bar.pack(side="top", fill="x")
        title_bar.pack_propagate(False)

        title_icon = tk.Label(title_bar, text="◻", bg=self.surface_color, fg=self.accent_color, font=("Segoe UI Symbol", 18, "bold"))
        title_icon.pack(side="left", padx=(16, 8))
        title_text = tk.Label(title_bar, text="Sprite Generator", bg=self.surface_color, fg=self.fg_color, font=("Segoe UI Semibold", 14))
        title_text.pack(side="left")
        title_sub = tk.Label(title_bar, text="— character sprite workflow", bg=self.surface_color, fg=self.subtext_color, font=("Segoe UI", 10))
        title_sub.pack(side="left", padx=(8, 0))
        icon_generator_button = ttk.Button(title_bar, text="Icon Generator...", command=self.open_icon_generator)
        icon_generator_button.pack(side="right", padx=14, pady=8)

        body_frame = tk.Frame(self, bg=self.bg_color)
        body_frame.pack(side="top", fill="both", expand=True)

        left_outer = ttk.Frame(body_frame, width=420)
        left_outer.pack(side="left", fill="y", expand=False)
        left_canvas = tk.Canvas(left_outer, bg=self.surface_color, highlightthickness=0, width=400)
        left_scrollbar = ttk.Scrollbar(left_outer, orient="vertical", command=left_canvas.yview, style="TScrollbar")
        left_frame = ttk.Frame(left_canvas, padding=10)
        left_frame.bind("<Configure>", lambda e: left_canvas.configure(scrollregion=left_canvas.bbox("all")))
        left_canvas.create_window((0, 0), window=left_frame, anchor="nw", width=400)
        left_canvas.configure(yscrollcommand=left_scrollbar.set)
        left_canvas.pack(side="left", fill="both", expand=True)
        left_scrollbar.pack(side="right", fill="y")

        ttk.Label(left_frame, text="NanoGPT API Key:").pack(anchor="w")
        self.api_key_entry = ttk.Entry(left_frame, width=40)
        self.api_key_entry.insert(0, self.state["config"]["api_key"])
        self.api_key_entry.pack(anchor="w", pady=2)
        self.api_key_entry.bind(
            "<FocusOut>",
            lambda _event=None: self.save_env_api_key_if_changed(self.api_key_entry.get().strip()),
            add="+",
        )
        self.api_key_entry.bind(
            "<Return>",
            lambda _event=None: self.save_env_api_key_if_changed(self.api_key_entry.get().strip()),
            add="+",
        )

        ttk.Label(left_frame, text="NanoGPT Model ID:").pack(anchor="w", pady=(5,0))
        self.model_entry = ttk.Combobox(
            left_frame,
            width=38,
            values=(
                "gpt-image-1",
                "nano-banana",
                "nano-banana-2-fast",
                "nano-banana-2",
                "nano-banana-2-lite",
                "nano-banana-pro",
            ),
        )
        self.model_entry.insert(0, self.state["config"].get("model", "gpt-image-1"))
        self.model_entry.pack(anchor="w", pady=2)

        ttk.Label(left_frame, text="Character Name:").pack(anchor="w", pady=(5,0))
        self.char_name_entry = ttk.Entry(left_frame, width=40)
        self.char_name_entry.insert(0, self.state["config"]["char_name"])
        self.char_name_entry.pack(anchor="w", pady=2)

        eye_color_label = ttk.Label(left_frame, text="Eye Color (for Prompts):")
        eye_color_label.pack(anchor="w", pady=(5,0))
        eye_color_tip = (
            "Used only where your prompts include {color}. Example: if the prompt says "
            "'Keep her eyes {color}' and this field is 'golden amber', the API sees "
            "'Keep her eyes golden amber'. Leave blank if you do not want eye color injected."
        )
        self.add_tooltip(eye_color_label, eye_color_tip)
        self.eye_color_entry = ttk.Entry(left_frame, width=40)
        self.eye_color_entry.insert(0, self.state["config"].get("eye_color", "golden amber"))
        self.add_tooltip(self.eye_color_entry, eye_color_tip)
        self.eye_color_entry.pack(anchor="w", pady=2)

        # Toggles
        expr_frame = ttk.LabelFrame(left_frame, text="Expressions", padding=5)
        expr_frame.pack(fill="x", pady=5)
        self.expr_progress_labels = {}
        for i, expr in enumerate(self.ALL_EXPRESSIONS):
            var = tk.BooleanVar(value=expr in self.state["config"]["selected_expressions"])
            self.expr_vars[expr] = var
            row = i // 2
            block_col = (i % 2) * 2
            self._dark_checkbutton(
                expr_frame,
                text=expr,
                variable=var,
                command=self.update_progress_tracker,
            ).grid(row=row, column=block_col, sticky="w")

            progress_var = tk.StringVar(value="- f r l b")
            progress_lbl = tk.Label(
                expr_frame,
                textvariable=progress_var,
                bg=self.surface_color,
                fg="#9a9a9a",
                anchor="w",
                justify="left",
                font=("Consolas", 9),
            )
            progress_lbl.grid(row=row, column=block_col + 1, sticky="w", padx=(4, 12))
            self.expr_progress_labels[expr] = (progress_var, progress_lbl)

        angle_frame = ttk.LabelFrame(left_frame, text="Angles", padding=5)
        angle_frame.pack(fill="x", pady=5)
        for i, angle in enumerate(self.ALL_ANGLES):
            var = tk.BooleanVar(value=angle in self.state["config"]["selected_angles"])
            self.angle_vars[angle] = var
            self._dark_checkbutton(angle_frame, text=angle, variable=var).grid(row=i//2, column=i%2, sticky="w")

        # Global Options
        opt_frame = ttk.LabelFrame(left_frame, text="Options", padding=5)
        opt_frame.pack(fill="x", pady=5)

        option_tooltips = {
            "upscale_4x": (
                "Runs Real-ESRGAN x4 after background removal. Use when final sprites need high resolution "
                "and sharper linework. Leave off for quick tests, API debugging, or when outputs are already huge."
            ),
            "compress_final_webp": (
                "Compresses the four exported final_sprites WebP files with Pillow WebP quality 85/method 6. "
                "Use when you want smaller ship-ready files. Leave off while debugging pixel-perfect output "
                "or when you want to preserve the exact intermediate export bytes."
            ),
            "use_greenscreen": (
                "Tries chroma-key removal before BiRefNet/rembg. Use when the generated image has a clean green "
                "background; it preserves hard anime edges better. Avoid for non-green or messy backgrounds."
            ),
            "fit_sprite_to_frame": (
                "After background removal, only upscales smaller characters so they sit near the bottom and fill more "
                "of the canvas. Use when the API returns tiny centered sprites. Avoid when exact scale/placement matters."
            ),
            "use_alignment_warping": (
                "Enables global rigid alignment and silhouette snap between base and post images before compositing. "
                "Use when A/B canvases are close but slightly shifted. Turn off if it creates stretched or melted artifacts."
            ),
            "use_canny_head_align": (
                "Extra masked edge alignment around the head using Canny edges. It only runs when alignment/warping is on. "
                "Use for side views where face details drift. Avoid if it overfits hair/nose outlines or deforms the head."
            ),
            "normalize_skin_tone": (
                "Attempts to match skin tone around the mouth/face between A and B before compositing. Use when the post "
                "API call changes face color. Avoid if it causes blotchy shifts or intentionally different lighting."
            ),
            "symmetric_sprite": (
                "Generates one lateral side, then mirrors it to create the opposite side. Use only for truly symmetric "
                "characters/outfits. Avoid when shields, weapons, logos, hair parts, or armor are asymmetric."
            ),
            "use_local_comfyui": (
                "Routes generation through your local ComfyUI workflow instead of NanoGPT. Use for local model/workflow "
                "tests or to avoid API calls. Leave off for the normal NanoGPT/Nano Banana pipeline."
            ),
        }

        self.upscale_var = tk.BooleanVar(value=self.state["config"].get("upscale_4x", False))
        upscale_btn = self._dark_checkbutton(opt_frame, text="Upscale 4x (Real-ESRGAN Anime)", variable=self.upscale_var)
        self.add_tooltip(upscale_btn, option_tooltips["upscale_4x"])
        upscale_btn.pack(anchor="w")

        self.compress_final_webp_var = tk.BooleanVar(value=self.state["config"].get("compress_final_webp", False))
        compress_final_btn = self._dark_checkbutton(
            opt_frame,
            text="Compress final WebP exports",
            variable=self.compress_final_webp_var,
        )
        self.add_tooltip(compress_final_btn, option_tooltips["compress_final_webp"])
        compress_final_btn.pack(anchor="w")

        self.greenscreen_var = tk.BooleanVar(value=self.state["config"].get("use_greenscreen", False))
        greenscreen_btn = self._dark_checkbutton(
            opt_frame,
            text="I'm using greenscreen (chroma key + despill)",
            variable=self.greenscreen_var,
        )
        self.add_tooltip(greenscreen_btn, option_tooltips["use_greenscreen"])
        greenscreen_btn.pack(anchor="w")

        self.fit_sprite_to_frame_var = tk.BooleanVar(value=self.state["config"].get("fit_sprite_to_frame", False))
        fit_sprite_btn = self._dark_checkbutton(
            opt_frame,
            text="Fit smaller sprite to frame after BG removal",
            variable=self.fit_sprite_to_frame_var,
        )
        self.add_tooltip(fit_sprite_btn, option_tooltips["fit_sprite_to_frame"])
        fit_sprite_btn.pack(anchor="w")

        self.alignment_warping_var = tk.BooleanVar(value=self.state["config"].get("use_alignment_warping", True))
        alignment_btn = self._dark_checkbutton(
            opt_frame,
            text="Enable alignment/warping (global + silhouette snap)",
            variable=self.alignment_warping_var,
        )
        self.add_tooltip(alignment_btn, option_tooltips["use_alignment_warping"])
        alignment_btn.pack(anchor="w")

        self.canny_head_align_var = tk.BooleanVar(value=self.state["config"].get("use_canny_head_align", True))
        canny_btn = self._dark_checkbutton(
            opt_frame,
            text="Canny head align (masked edge warp)",
            variable=self.canny_head_align_var,
        )
        self.add_tooltip(canny_btn, option_tooltips["use_canny_head_align"])
        canny_btn.pack(anchor="w")

        self.normalize_skin_tone_var = tk.BooleanVar(value=self.state["config"].get("normalize_skin_tone", False))
        skin_tone_btn = self._dark_checkbutton(
            opt_frame,
            text="Attempt to normalize skin tone (A/B mouth area match)",
            variable=self.normalize_skin_tone_var,
        )
        self.add_tooltip(skin_tone_btn, option_tooltips["normalize_skin_tone"])
        skin_tone_btn.pack(anchor="w")

        self.symmetric_sprite_var = tk.BooleanVar(value=self.state["config"].get("symmetric_sprite", False))
        symmetric_btn = self._dark_checkbutton(
            opt_frame,
            text="This sprite is symmetric (reuse right -> left by local flip)",
            variable=self.symmetric_sprite_var,
        )
        self.add_tooltip(symmetric_btn, option_tooltips["symmetric_sprite"])
        symmetric_btn.pack(anchor="w")

        self.use_local_comfyui_var = tk.BooleanVar(value=self.state["config"].get("use_local_comfyui", False))
        comfyui_btn = self._dark_checkbutton(
            opt_frame,
            text="Use local ComfyUI",
            variable=self.use_local_comfyui_var,
        )
        self.add_tooltip(comfyui_btn, option_tooltips["use_local_comfyui"])
        comfyui_btn.pack(anchor="w")
        # Prompt Templates
        pt_frame = ttk.LabelFrame(left_frame, text="Prompt Templates", padding=5)
        pt_frame.pack(fill="x", pady=5)
        
        ttk.Label(pt_frame, text="Expression Prompt ({expr}):").pack(anchor="w")
        self.prompt_expr_text = scrolledtext.ScrolledText(pt_frame, height=3, width=45, font=("Segoe UI", 10), wrap="word")
        self.prompt_expr_text.insert(tk.END, self.state["config"]["prompt_expression"])
        self._style_scrolled_text(self.prompt_expr_text)
        self.prompt_expr_text.pack(fill="x", pady=2)

        ttk.Label(pt_frame, text="Angle Prompt ({expr}, {angle}):").pack(anchor="w")
        self.prompt_angle_text = scrolledtext.ScrolledText(pt_frame, height=3, width=45, font=("Segoe UI", 10), wrap="word")
        self.prompt_angle_text.insert(tk.END, self.state["config"]["prompt_angle"])
        self._style_scrolled_text(self.prompt_angle_text)
        self.prompt_angle_text.pack(fill="x", pady=2)

        ttk.Label(pt_frame, text="Post-Process Prompt:").pack(anchor="w")
        self.prompt_post_text = scrolledtext.ScrolledText(pt_frame, height=3, width=45, font=("Segoe UI", 10), wrap="word")
        self.prompt_post_text.insert(tk.END, self.state["config"]["prompt_post"])
        self._style_scrolled_text(self.prompt_post_text)
        self.prompt_post_text.pack(fill="x", pady=2)

        # Files
        self.btn_base = ttk.Button(left_frame, text="Select Base Image (A)", command=lambda: self.select_img("base_image", self.lbl_base))
        self.btn_base.pack(fill="x", pady=5)
        self.lbl_base = ttk.Label(left_frame, text=self.state["config"]["base_image"] or "None", foreground=self.subtext_color)
        self.lbl_base.pack(anchor="w")

        self.btn_ref = ttk.Button(left_frame, text="Select Reference Image(s) (A)", command=self.select_reference_images)
        self.btn_ref.pack(fill="x", pady=5)
        self.lbl_ref = ttk.Label(left_frame, text="None", foreground=self.subtext_color, wraplength=360, justify="left")
        self.lbl_ref.pack(anchor="w")
        ttk.Button(left_frame, text="Clear Reference Images", command=self.clear_reference_images).pack(fill="x", pady=(2, 5))
        self.update_reference_label()

        # Progress tracker: scans final_sprites and summarizes per-expression angle coverage.
        progress_frame = ttk.LabelFrame(left_frame, text="Progress (final_sprites)", padding=5)
        progress_frame.pack(fill="x", pady=(10, 5))

        ttk.Button(progress_frame, text="Refresh Progress", command=self.update_progress_tracker).pack(fill="x", pady=(0, 4))

        self.progress_summary_var = tk.StringVar(value="Selected progress: 0/0 angles complete.")
        tk.Label(
            progress_frame,
            textvariable=self.progress_summary_var,
            bg=self.surface_color,
            fg=self.accent_color,
            anchor="w",
            justify="left",
            wraplength=360,
        ).pack(fill="x", anchor="w", pady=(0, 4))

        # Buttons & Log
        self.btn_generate_tasks = ttk.Button(left_frame, text="1. Initialize & Save Tasks", command=self.generate_task_list)
        self.btn_generate_tasks.pack(fill="x", pady=15)
        self.btn_next = ttk.Button(left_frame, text="▶ Next Step", command=self.run_next_step, style="Accent.TButton")
        self.btn_next.pack(fill="x", pady=5)
        self.btn_retry = ttk.Button(left_frame, text="↺ Retry Last Step", command=self.retry_last_step)
        self.btn_retry.pack(fill="x", pady=5)
        self.btn_undo = ttk.Button(left_frame, text="↶ Undo Last Step", command=self.undo_last_step)
        self.btn_undo.pack(fill="x", pady=5)

        ttk.Label(left_frame, text="Status Log:").pack(anchor="w", pady=(10,0))
        self.log_text = scrolledtext.ScrolledText(left_frame, height=15, width=40, font=("Consolas", 10), wrap="word")
        self._style_scrolled_text(self.log_text)
        self.log_text.pack(fill="both", expand=True)
        self._flush_pending_logs()

        # Right Panel
        right_frame = ttk.Frame(body_frame, padding=10)
        right_frame.pack(side="right", fill="both", expand=True)

        header_frame = ttk.Frame(right_frame)
        header_frame.pack(fill="x", pady=(0, 10))
        
        ttk.Label(header_frame, text="Image Gallery (YOLOv8 + HRNetV2 Edition)", font=("Arial", 14, "bold"), foreground=self.header_fg).pack(side="left")

        # Zoom Slider
        zoom_frame = ttk.Frame(header_frame)
        zoom_frame.pack(side="right")
        ttk.Label(zoom_frame, text="Zoom:").pack(side="left", padx=5)
        self.zoom_slider = tk.Scale(
            zoom_frame,
            from_=100,
            to=2000,
            orient="horizontal",
            bg=self.surface_color,
            fg=self.fg_color,
            troughcolor=self.panel_color,
            activebackground=self.accent_color,
            highlightthickness=0,
            borderwidth=0,
            relief="flat",
            sliderlength=18,
            command=self.on_zoom_change,
        )
        self.zoom_slider.set(self.zoom_level)
        self.zoom_slider.pack(side="left")
        
        self.canvas = tk.Canvas(right_frame, bg=self.surface_color, highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(right_frame, orient="vertical", command=self.canvas.yview, style="TScrollbar")
        self.gallery_frame = ttk.Frame(self.canvas)
        self.gallery_frame.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.create_window((0, 0), window=self.gallery_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")
        self.thumbnails =[] 
        self.char_name_entry.bind("<KeyRelease>", lambda e: self.update_progress_tracker())
        self.update_progress_tracker()

    def update_progress_tracker(self):
        if not hasattr(self, "expr_progress_labels"):
            return

        char = ""
        if hasattr(self, "char_name_entry"):
            char = self.char_name_entry.get().strip()
        if not char:
            char = str(self.state.get("config", {}).get("char_name", "")).strip()

        if self.expr_vars:
            selected_exprs = {expr for expr, var in self.expr_vars.items() if var.get()}
        else:
            selected_exprs = set(self.state.get("config", {}).get("selected_expressions", []))

        angles = [("front", "F"), ("right", "R"), ("left", "L"), ("back", "B")]
        selected_done = 0
        selected_total = 0

        for expr in self.ALL_EXPRESSIONS:
            done_count = 0
            angle_tokens = []
            for angle_name, angle_tag in angles:
                filename = f"{char}_{expr}_{angle_name}.webp"
                path = os.path.join(FINAL_DIR, filename)
                exists = os.path.exists(path)
                if exists:
                    done_count += 1
                angle_tokens.append(angle_tag if exists else angle_tag.lower())

            line = f"- {' '.join(angle_tokens)}"
            text_var, lbl = self.expr_progress_labels[expr]
            text_var.set(line)

            if done_count == 0:
                row_color = "#9a9a9a"   # none
            elif done_count == len(angles):
                row_color = "#7adf9b"   # all
            else:
                row_color = "#ffd166"   # partial
            lbl.config(fg=row_color)

            if expr in selected_exprs:
                selected_done += done_count
                selected_total += len(angles)

        display_char = char if char else "(no character name)"
        self.progress_summary_var.set(
            f"{display_char}: selected progress {selected_done}/{selected_total} angles complete."
        )

    def log(self, message):
        message = str(message)
        log_text = self.__dict__.get("log_text")
        if log_text is None:
            self.__dict__.setdefault("_pending_log_messages", []).append(message)
            print(message)
            return

        log_text.insert(tk.END, message + "\n")
        log_text.see(tk.END)
        self.update_idletasks()

    def _flush_pending_logs(self):
        pending_messages = self._pending_log_messages
        self._pending_log_messages = []
        for message in pending_messages:
            self.log(message)

    def log_async(self, message):
        self.after(0, lambda m=message: self.log(m))

    def _normalize_reference_config(self):
        config = self.state["config"]
        refs = config.get("ref_images", [])
        if isinstance(refs, str):
            refs = [refs]
        if not isinstance(refs, (list, tuple)):
            refs = []

        cleaned = []
        seen = set()
        for p in refs:
            path = str(p or "").strip()
            if path and path not in seen:
                cleaned.append(path)
                seen.add(path)

        legacy = str(config.get("ref_image", "") or "").strip()
        if not cleaned and legacy and legacy not in seen:
            cleaned.append(legacy)

        config["ref_images"] = cleaned
        config["ref_image"] = cleaned[0] if cleaned else ""
        return list(cleaned)

    def get_reference_images(self):
        return self._normalize_reference_config()

    def update_reference_label(self):
        if not hasattr(self, "lbl_ref"):
            return
        refs = self.get_reference_images()
        if not refs:
            self.lbl_ref.config(text="None")
            return

        preview_names = []
        for p in refs[:4]:
            name = os.path.basename(p) or p
            preview_names.append(name)

        extra = len(refs) - len(preview_names)
        text = f"{len(refs)} selected: " + ", ".join(preview_names)
        if extra > 0:
            text += f", +{extra} more"
        self.lbl_ref.config(text=text)

    def _on_reference_images_changed(self):
        self.update_reference_label()
        self._normalize_reference_config()
        self.save_state()
        self.after(0, self.refresh_task_view)

    def select_reference_images(self):
        paths = filedialog.askopenfilenames()
        if not paths:
            return
        merged = []
        seen = set()
        for p in [*self.get_reference_images(), *list(paths)]:
            path = str(p or "").strip()
            if path and path not in seen:
                merged.append(path)
                seen.add(path)
        self.state["config"]["ref_images"] = merged
        self._normalize_reference_config()
        self._on_reference_images_changed()

    def clear_reference_images(self):
        self.state["config"]["ref_images"] = []
        self.state["config"]["ref_image"] = ""
        self._on_reference_images_changed()

    def select_img(self, key, label):
        path = filedialog.askopenfilename()
        if path:
            self.state["config"][key] = path
            label.config(text=path)

    # ==========================================
    # TASK MANAGEMENT
    # ==========================================
    def generate_task_list(self):
        self.save_config_from_ui()
        char = self.state["config"]["char_name"]
        exprs = self.state["config"]["selected_expressions"]
        angles = self.state["config"]["selected_angles"]
        symmetric_sprite = bool(self.state["config"].get("symmetric_sprite", False))
        
        existing = {t["id"]: t for t in self.state["tasks"]}
        new_tasks =[]
        mirrored_pairs = 0
        
        def add(t_id, t_type):
            if t_id in existing:
                t = existing[t_id]
                t.pop("prompt", None)   # strip any stored prompt â€” generated on-the-fly
                if t.get("type") != t_type:
                    t = {"id": t_id, "type": t_type, "status": "PENDING"}
                new_tasks.append(t)
            else:
                new_tasks.append({"id": t_id, "type": t_type, "status": "PENDING"})

        def add_full_angle_pipeline(expr, angle):
            add(f"{char}_{expr}_{angle}", "API_ANGLE")
            if angle != "back":
                add(f"{char}_{expr}_{angle}_post", "API_POST")
            add(f"{char}_{expr}_{angle}_local", "LOCAL_PROCESS")

        for expr in exprs:
            add(f"{char}_{expr}_front", "API_EXPRESSION")
            if "front" in angles:
                add(f"{char}_{expr}_front_post", "API_POST")
                add(f"{char}_{expr}_front_local", "LOCAL_PROCESS")

            mirror_lr = symmetric_sprite and ("left" in angles) and ("right" in angles)
            if mirror_lr:
                # Full flow on right, then mirror to left locally.
                add_full_angle_pipeline(expr, "right")
                add(f"{char}_{expr}_left_local", "LOCAL_FLIP")
                mirrored_pairs += 1
                if "back" in angles:
                    add_full_angle_pipeline(expr, "back")
            else:
                for angle in angles:
                    if angle == "front":
                        continue
                    add_full_angle_pipeline(expr, angle)
                
        self.state["tasks"] = new_tasks
        self.save_state()
        if mirrored_pairs > 0:
            self.log(f"Tasks updated. Total: {len(new_tasks)}. Symmetry mode mirrored right -> left for {mirrored_pairs} expression(s).")
        else:
            self.log(f"Tasks updated. Total: {len(new_tasks)}.")
        self.refresh_task_view()

    def run_next_step(self):
        self.save_config_from_ui()
        for task in self.state["tasks"]:
            if task["status"] == "PENDING":
                self.start_task_thread(task)
                return
        self.log("All tasks completed!")

    def get_task_files(self, task):
        """Return every file path a task creates so retry can clean them up first."""
        tid = task["id"]
        base_id = tid.replace("_post", "").replace("_local", "")

        if task["type"] in ("API_EXPRESSION", "API_ANGLE", "API_POST"):
            return [os.path.join(OUTPUT_DIR, f"{tid}.webp")]

        if task["type"] == "LOCAL_PROCESS":
            post_id = base_id + "_post"
            no_bg = lambda f: os.path.join(OUTPUT_DIR, f"{f}_no_bg.webp")
            out = lambda f: os.path.join(OUTPUT_DIR, f)
            fin = lambda f: os.path.join(FINAL_DIR, f)
            return [
                no_bg(base_id),
                no_bg(post_id),
                out(f"{base_id}_debug_landmarks.jpg"),
                out(f"{base_id}_debug_landmarks_numbered.jpg"),
                out(f"{base_id}_debug_warp.jpg"),
                out(f"{base_id}_debug_abc.jpg"),
                out(f"{base_id}_debug_remove_hair.jpg"),
                out(f"{base_id}_debug_face_only_no_hair.jpg"),
                out(f"{base_id}_debug_face_soft_mask.png"),
                out(f"{base_id}_debug_eye_hard_mask.png"),
                out(f"{base_id}_debug_nose_protect_mask.png"),
                out(f"{base_id}_debug_nose_ink_islands.png"),
                out(f"{base_id}_debug_eye_blend_mask.png"),
                out(f"{base_id}_debug_canny_base.png"),
                out(f"{base_id}_debug_canny_post.png"),
                out(f"{base_id}_debug_canny_post_warped.png"),
                out(f"{base_id}_debug_canny_overlay.png"),
                out(f"{base_id}_debug_canny_flow.jpg"),
                out(f"{base_id}_debug_post_aligned.webp"),
                out(f"{base_id}_eyes_external_composite.png"),
                out(f"{base_id}_mouth_external_composite.png"),
                out(f"{base_id}_debug_samples_palette_base.png"),
                out(f"{base_id}_debug_samples_palette_post.png"),
                out(f"{base_id}_debug_samples_points_base.png"),
                out(f"{base_id}_debug_samples_points_post.png"),
                os.path.join(OUTPUT_DIR, f"{base_id}_blink.webp"),
                os.path.join(OUTPUT_DIR, f"{base_id}_talk.webp"),
                os.path.join(OUTPUT_DIR, f"{base_id}_talk_blink.webp"),
                fin(f"{base_id}.webp"),
                fin(f"{base_id}_blink.webp"),
                fin(f"{base_id}_talk.webp"),
                fin(f"{base_id}_talk_blink.webp"),
            ]
        if task["type"] == "LOCAL_FLIP":
            post_id = base_id + "_post"
            out = lambda f: os.path.join(OUTPUT_DIR, f)
            fin = lambda f: os.path.join(FINAL_DIR, f)
            return [
                out(f"{base_id}.webp"),
                out(f"{post_id}.webp"),
                out(f"{base_id}_no_bg.webp"),
                out(f"{post_id}_no_bg.webp"),
                out(f"{base_id}_blink.webp"),
                out(f"{base_id}_talk.webp"),
                out(f"{base_id}_talk_blink.webp"),
                fin(f"{base_id}.webp"),
                fin(f"{base_id}_blink.webp"),
                fin(f"{base_id}_talk.webp"),
                fin(f"{base_id}_talk_blink.webp"),
            ]
        return []

    def retry_last_step(self):
        self.save_config_from_ui()
        for task in reversed(self.state["tasks"]):
            if task["status"] in ["SUCCESS", "ERROR"]:
                # Clean up every file this task produced so it can start fresh
                for path in self.get_task_files(task):
                    if os.path.exists(path):
                        os.remove(path)
                # For LOCAL_PROCESS: if _original files exist but plain ones don't,
                # rename them back so the step can re-process from scratch
                task["status"] = "PENDING"
                self.start_task_thread(task)
                return

    def undo_last_step(self):
        self.save_config_from_ui()
        for task in reversed(self.state["tasks"]):
            if task["status"] in ["SUCCESS", "ERROR"]:
                # Clean up every file this task produced
                for path in self.get_task_files(task):
                    if os.path.exists(path):
                        try:
                            os.remove(path)
                        except Exception as e:
                            self.log(f"   Note: couldn't delete {os.path.basename(path)}: {e}")
                task["status"] = "PENDING"
                self.save_state()
                self.log(f"UNDO: {task['id']} is now PENDING.")
                self.refresh_task_view()
                return

    def start_task_thread(self, task):
        self.btn_next.config(state="disabled")
        self.log(f"--- Running: {task['id']} ---")
        threading.Thread(target=self.execute_task, args=(task,)).start()

    def execute_task(self, task):
        try:
            if task["type"].startswith("API"):
                self.handle_api_task(task)
            elif task["type"] == "LOCAL_PROCESS":
                self.handle_local_process(task)
            elif task["type"] == "LOCAL_FLIP":
                self.handle_local_flip(task)
            task["status"] = "SUCCESS"
            self.log(f"SUCCESS: {task['id']}")
        except Exception as e:
            task["status"] = "ERROR"
            self.log(f"ERROR: {str(e)}")
        finally:
            self.save_state()
            self.after(0, lambda:[self.btn_next.config(state="normal"), self.refresh_task_view()])

    # ==========================================
    # YOLOv8 + HRNetV2 LANDMARK PROCESSING
    # ==========================================
    def open_icon_generator(self):
        if self.icon_generator_window is not None and self.icon_generator_window.winfo_exists():
            self.icon_generator_window.deiconify()
            self.icon_generator_window.lift()
            self.icon_generator_window.focus_force()
            return
        self.icon_generator_window = IconGeneratorWindow(
            self,
            self.ALL_EXPRESSIONS,
            lambda status: self.get_anime_detector(status_callback=status),
        )

    def get_anime_detector(self, status_callback=None):
        if create_detector is None:
            raise ImportError("Pure PyTorch anime-face-detector not installed. Check installation steps!")
        with self._anime_detector_lock:
            if self.anime_detector is None:
                device = 'cuda:0' if torch and torch.cuda.is_available() else 'cpu'
                message = f"Initializing YOLOv3 + HRNetV2 anime face detector on [{device.upper()}]..."
                if status_callback:
                    status_callback(message)
                else:
                    self.log_async(message)
                self.anime_detector = create_detector("yolov3", device=device)
        return self.anime_detector

    def extract_28_landmarks(self, img_bgra, name_for_debug):
        """Converts to BGR, runs YOLOv8 detector, returns exactly 28 keypoints. No fallbacks."""
        bgr = cv2.cvtColor(img_bgra, cv2.COLOR_BGRA2BGR)
        detector = self.get_anime_detector()
        
        # Run Inference
        preds = detector(bgr)
        
        if not preds or len(preds) == 0:
            raise Exception(f"CRITICAL: No anime face detected in {name_for_debug}!")
            
        # Get the face with highest confidence score (bbox[4])
        best_face = max(preds, key=lambda p: p['bbox'][4])
        
        # Extract X, Y coordinates, dropping the confidence score
        pts = np.array(best_face['keypoints'], dtype=np.float32)[:, :2]
        
        if len(pts) != 28:
            raise Exception(f"CRITICAL: Detector returned {len(pts)} points instead of 28!")
            
        return pts, bgr

    def estimate_context_micro_transform(self, base_img_bgra, top_img_bgra, b_mask_u8, c_ring_u8, face_width):
        """
        Estimate a tiny similarity transform (translation + scale) from top -> base,
        using ONLY the context fingerprint ring C (outside copy mask B).
        """
        if base_img_bgra is None or top_img_bgra is None:
            return None
        if base_img_bgra.shape[:2] != top_img_bgra.shape[:2]:
            return None

        h, w = base_img_bgra.shape[:2]
        if b_mask_u8 is None or c_ring_u8 is None:
            return None
        if b_mask_u8.shape[:2] != (h, w) or c_ring_u8.shape[:2] != (h, w):
            return None

        alpha_valid = (((base_img_bgra[:, :, 3] > 16) & (top_img_bgra[:, :, 3] > 16)).astype(np.uint8) * 255)
        ring = cv2.bitwise_and(c_ring_u8, alpha_valid)

        min_ring_pixels = max(220, int(face_width * face_width * 0.05))
        if cv2.countNonZero(ring) < min_ring_pixels:
            return None

        ys, xs = np.where(ring > 0)
        if len(xs) < 10 or len(ys) < 10:
            return None

        margin = max(4, int(face_width * 0.05))
        x0 = max(0, int(xs.min()) - margin)
        y0 = max(0, int(ys.min()) - margin)
        x1 = min(w, int(xs.max()) + margin + 1)
        y1 = min(h, int(ys.max()) + margin + 1)
        if x1 - x0 < 14 or y1 - y0 < 14:
            return None

        def line_fingerprint(gray_u8):
            blur = cv2.GaussianBlur(gray_u8, (0, 0), 0.8)
            gx = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)
            mag = cv2.magnitude(gx, gy)
            mag = cv2.GaussianBlur(mag, (0, 0), 0.7)
            p = float(np.percentile(mag, 99.0))
            if p < 1e-6:
                p = float(np.max(mag) + 1e-6)
            return np.clip(mag / p, 0.0, 1.0).astype(np.float32)

        base_gray = cv2.cvtColor(base_img_bgra[:, :, :3], cv2.COLOR_BGR2GRAY)
        top_gray = cv2.cvtColor(top_img_bgra[:, :, :3], cv2.COLOR_BGR2GRAY)
        base_fp = line_fingerprint(base_gray)
        top_fp = line_fingerprint(top_gray)

        base_roi = base_fp[y0:y1, x0:x1]
        top_roi = top_fp[y0:y1, x0:x1]
        ring_roi = ring[y0:y1, x0:x1]
        ring_pixels = cv2.countNonZero(ring_roi)
        if ring_pixels < 120:
            return None

        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 120, 1e-7)

        # Stage 1: Translation only (stable seed)
        warp_t = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
        try:
            try:
                cc_t, warp_t = cv2.findTransformECC(
                    base_roi,
                    top_roi,
                    warp_t,
                    cv2.MOTION_TRANSLATION,
                    criteria,
                    inputMask=ring_roi,
                    gaussFiltSize=5,
                )
            except TypeError:
                cc_t, warp_t = cv2.findTransformECC(
                    base_roi,
                    top_roi,
                    warp_t,
                    cv2.MOTION_TRANSLATION,
                    criteria,
                    inputMask=ring_roi,
                )
        except cv2.error:
            return None

        # Stage 2: Affine refine to recover tiny scale from the same ring.
        warp_a = warp_t.copy()
        cc_a = float(cc_t)
        try:
            try:
                cc_a, warp_a = cv2.findTransformECC(
                    base_roi,
                    top_roi,
                    warp_a,
                    cv2.MOTION_AFFINE,
                    criteria,
                    inputMask=ring_roi,
                    gaussFiltSize=5,
                )
            except TypeError:
                cc_a, warp_a = cv2.findTransformECC(
                    base_roi,
                    top_roi,
                    warp_a,
                    cv2.MOTION_AFFINE,
                    criteria,
                    inputMask=ring_roi,
                )
        except cv2.error:
            warp_a = warp_t.copy()
            cc_a = float(cc_t)

        A = warp_a[:, :2].astype(np.float64)
        t_local = warp_a[:, 2].astype(np.float64)
        sx = float(np.linalg.norm(A[:, 0]))
        sy = float(np.linalg.norm(A[:, 1]))
        raw_scale = (sx + sy) * 0.5 if (sx > 1e-6 and sy > 1e-6) else 1.0

        # Similarity sanity checks (reject strong rotate/shear/anisotropy).
        anisotropy = abs(sx - sy) / max(raw_scale, 1e-6)
        cosang = float(np.dot(A[:, 0], A[:, 1]) / max(sx * sy, 1e-6)) if sx > 1e-6 and sy > 1e-6 else 0.0
        shear = abs(cosang)
        rot_deg = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))

        scale = 1.0
        tx_local = float(warp_t[0, 2])
        ty_local = float(warp_t[1, 2])
        method = "translation"

        if (
            np.isfinite(raw_scale)
            and 0.94 <= raw_scale <= 1.06
            and anisotropy <= 0.08
            and shear <= 0.25
            and abs(rot_deg) <= 9.0
        ):
            scale = float(np.clip(raw_scale, 0.965, 1.035))
            tx_local = float(t_local[0])
            ty_local = float(t_local[1])
            method = "similarity"

        # Convert ROI-local transform to popup-global transform:
        # local: p' = s*p + t_local ; global: x' = s*x + (t_local + o - s*o), with o=(x0,y0)
        tx_global = tx_local + x0 - (scale * x0)
        ty_global = ty_local + y0 - (scale * y0)

        if not (np.isfinite(tx_global) and np.isfinite(ty_global) and np.isfinite(scale)):
            return None

        # Stage 3: line-overlap refinement on C ring
        # Goal: make lineart in the fingerprint ring overlap as tightly as possible.
        line_overlap = 0.0
        line_points = 0
        line_score = None
        ring_bool = ring_roi > 0
        ring_count = int(np.count_nonzero(ring_bool))
        if ring_count >= 80:
            vals_b = base_roi[ring_bool]
            vals_t = top_roi[ring_bool]
            thr_b = float(np.percentile(vals_b, 68.0))
            thr_t = float(np.percentile(vals_t, 68.0))
            base_edges = ((base_roi >= thr_b) & ring_bool).astype(np.uint8) * 255
            top_edges = ((top_roi >= thr_t) & ring_bool).astype(np.uint8) * 255

            base_edge_count = cv2.countNonZero(base_edges)
            top_edge_count = cv2.countNonZero(top_edges)
            if base_edge_count >= 25 and top_edge_count >= 25:
                inv_base_edges = np.where(base_edges > 0, 0, 255).astype(np.uint8)
                dist_to_base_edge = cv2.distanceTransform(inv_base_edges, cv2.DIST_L2, 5)
                base_edge_bool = base_edges > 0

                roi_h, roi_w = base_roi.shape[:2]
                min_eval_pts = max(20, int(top_edge_count * 0.08))

                def line_fit_score(txg, tyg, s):
                    s = float(np.clip(s, 0.965, 1.035))
                    tx_local_s = (s * x0) + txg - x0
                    ty_local_s = (s * y0) + tyg - y0
                    M = np.array([[s, 0.0, tx_local_s], [0.0, s, ty_local_s]], dtype=np.float32)
                    warped_top = cv2.warpAffine(
                        top_edges,
                        M,
                        (roi_w, roi_h),
                        flags=cv2.INTER_NEAREST,
                        borderMode=cv2.BORDER_CONSTANT,
                        borderValue=0,
                    )
                    valid = (warped_top > 0) & ring_bool
                    n = int(np.count_nonzero(valid))
                    if n < min_eval_pts:
                        return (1e9, n, 0.0)
                    d = float(np.mean(dist_to_base_edge[valid]))
                    ov = float(np.count_nonzero(base_edge_bool & valid)) / float(n)
                    # Lower is better.
                    return (d - (1.1 * ov), n, ov)

                # Start from ECC estimate.
                seed_score, seed_pts, seed_ov = line_fit_score(tx_global, ty_global, scale)
                best = {
                    "score": float(seed_score),
                    "tx": float(tx_global),
                    "ty": float(ty_global),
                    "s": float(scale),
                    "pts": int(seed_pts),
                    "ov": float(seed_ov),
                }

                # Coarse local search
                tx_span = max(1.6, float(face_width) * 0.032)
                ty_span = max(1.6, float(face_width) * 0.032)
                s_span = 0.018
                for s_c in np.linspace(max(0.965, scale - s_span), min(1.035, scale + s_span), 5):
                    for tx_c in np.linspace(tx_global - tx_span, tx_global + tx_span, 7):
                        for ty_c in np.linspace(ty_global - ty_span, ty_global + ty_span, 7):
                            sc, pn, ov = line_fit_score(tx_c, ty_c, s_c)
                            if sc < best["score"]:
                                best = {"score": float(sc), "tx": float(tx_c), "ty": float(ty_c), "s": float(s_c), "pts": int(pn), "ov": float(ov)}

                # Fine search around coarse best
                for s_f in np.linspace(max(0.965, best["s"] - 0.006), min(1.035, best["s"] + 0.006), 5):
                    for tx_f in np.linspace(best["tx"] - 1.2, best["tx"] + 1.2, 9):
                        for ty_f in np.linspace(best["ty"] - 1.2, best["ty"] + 1.2, 9):
                            sc, pn, ov = line_fit_score(tx_f, ty_f, s_f)
                            if sc < best["score"]:
                                best = {"score": float(sc), "tx": float(tx_f), "ty": float(ty_f), "s": float(s_f), "pts": int(pn), "ov": float(ov)}

                improved = (best["score"] + 0.03 < seed_score) or (best["ov"] > seed_ov + 0.03)
                if improved:
                    tx_global = best["tx"]
                    ty_global = best["ty"]
                    scale = best["s"]
                    method = f"{method}+linefit"
                line_score = float(best["score"])
                line_overlap = float(best["ov"])
                line_points = int(best["pts"])

        max_shift = max(2.5, float(face_width) * 0.2)
        if abs(tx_global) > max_shift or abs(ty_global) > max_shift:
            return None
        if cc_t < 0.06 and cc_a < 0.06:
            return None

        return {
            "offset": (float(tx_global), float(ty_global)),
            "scale": float(scale),
            "score": float(max(cc_t, cc_a)),
            "score_translation": float(cc_t),
            "score_affine": float(cc_a),
            "ring_pixels": int(ring_pixels),
            "method": method,
            "rotation_deg": float(rot_deg),
            "anisotropy": float(anisotropy),
            "shear": float(shear),
            "line_score": line_score,
            "line_overlap": line_overlap,
            "line_points": line_points,
        }

    def _binary_alignment_metrics(self, target_u8, candidate_u8):
        """Symmetric shape score; lower mean/p95 and higher IoU are better."""
        target = target_u8 > 0
        candidate = candidate_u8 > 0
        n_t = int(np.count_nonzero(target))
        n_c = int(np.count_nonzero(candidate))
        if n_t < 20 or n_c < 20:
            return {"mean": 1e9, "p95": 1e9, "iou": 0.0, "target_px": n_t, "candidate_px": n_c}
        dt_target = cv2.distanceTransform(np.where(target, 0, 255).astype(np.uint8), cv2.DIST_L2, 5)
        dt_candidate = cv2.distanceTransform(np.where(candidate, 0, 255).astype(np.uint8), cv2.DIST_L2, 5)
        c_to_t = dt_target[candidate]
        t_to_c = dt_candidate[target]
        mean = float((np.mean(c_to_t) + np.mean(t_to_c)) * 0.5)
        p95 = float(max(np.percentile(c_to_t, 95.0), np.percentile(t_to_c, 95.0)))
        inter = int(np.count_nonzero(target & candidate))
        union = int(np.count_nonzero(target | candidate))
        return {
            "mean": mean,
            "p95": p95,
            "iou": float(inter) / float(max(1, union)),
            "target_px": n_t,
            "candidate_px": n_c,
        }

    def _alpha_alignment_metrics(self, base_alpha, candidate_alpha):
        return self._binary_alignment_metrics(
            ((base_alpha > 16).astype(np.uint8) * 255),
            ((candidate_alpha > 16).astype(np.uint8) * 255),
        )

    def _affine_matrix_is_safe(self, M, face_width, img_w, img_h):
        if M is None:
            return False, "missing_matrix"
        M = np.asarray(M, dtype=np.float64)
        if M.shape != (2, 3) or not np.all(np.isfinite(M)):
            return False, "nonfinite_matrix"
        A = M[:, :2]
        sx = float(np.linalg.norm(A[:, 0]))
        sy = float(np.linalg.norm(A[:, 1]))
        if sx < 1e-6 or sy < 1e-6:
            return False, "degenerate_scale"
        scale = (sx + sy) * 0.5
        anisotropy = abs(sx - sy) / max(scale, 1e-6)
        shear = abs(float(np.dot(A[:, 0], A[:, 1]) / max(sx * sy, 1e-6)))
        rot_deg = abs(float(np.degrees(np.arctan2(A[1, 0], A[0, 0]))))
        tx = abs(float(M[0, 2]))
        ty = abs(float(M[1, 2]))
        max_shift = max(8.0, float(face_width) * 0.45, max(img_w, img_h) * 0.08)
        if not (0.86 <= scale <= 1.16):
            return False, f"scale:{scale:.3f}"
        if anisotropy > 0.16:
            return False, f"anisotropy:{anisotropy:.3f}"
        if shear > 0.35:
            return False, f"shear:{shear:.3f}"
        if rot_deg > 18.0:
            return False, f"rotation:{rot_deg:.1f}"
        if tx > max_shift or ty > max_shift:
            return False, f"shift:{tx:.1f},{ty:.1f}>{max_shift:.1f}"
        return True, "ok"

    def _dense_displacement_is_safe(self, dx, dy, mask_u8, face_width, label):
        dx = np.asarray(dx, dtype=np.float32)
        dy = np.asarray(dy, dtype=np.float32)
        if dx.shape != dy.shape or dx.size == 0 or not np.all(np.isfinite(dx)) or not np.all(np.isfinite(dy)):
            return False, f"{label}:nonfinite", {}
        mask = (mask_u8 > 0) if mask_u8 is not None and mask_u8.shape[:2] == dx.shape[:2] else np.ones(dx.shape, dtype=bool)
        if int(np.count_nonzero(mask)) < 20:
            return False, f"{label}:empty_mask", {}
        mag = np.sqrt((dx * dx) + (dy * dy))[mask]
        p95 = float(np.percentile(mag, 95.0))
        maxv = float(np.max(mag))
        p95_limit = max(2.5, float(face_width) * 0.12)
        max_limit = max(5.0, float(face_width) * 0.30)
        if p95 > p95_limit:
            return False, f"{label}:p95_flow:{p95:.2f}>{p95_limit:.2f}", {"p95": p95, "max": maxv}
        if maxv > max_limit:
            return False, f"{label}:max_flow:{maxv:.2f}>{max_limit:.2f}", {"p95": p95, "max": maxv}
        gy_dx, gx_dx = np.gradient(dx)
        gy_dy, gx_dy = np.gradient(dy)
        strain = np.sqrt((gx_dx * gx_dx) + (gy_dx * gy_dx) + (gx_dy * gx_dy) + (gy_dy * gy_dy))[mask]
        curl = np.abs(gx_dy - gy_dx)[mask]
        strain_p99 = float(np.percentile(strain, 99.0))
        curl_p99 = float(np.percentile(curl, 99.0))
        if strain_p99 > 0.45:
            return False, f"{label}:strain:{strain_p99:.3f}", {"p95": p95, "max": maxv, "strain_p99": strain_p99, "curl_p99": curl_p99}
        if curl_p99 > 0.55:
            return False, f"{label}:curl:{curl_p99:.3f}", {"p95": p95, "max": maxv, "strain_p99": strain_p99, "curl_p99": curl_p99}
        return True, "ok", {"p95": p95, "max": maxv, "strain_p99": strain_p99, "curl_p99": curl_p99}

    def align_head_with_masked_canny(self, base_id, base_img_bgra, post_img_bgra, b_union_u8, c_union_u8, face_width):
        """Masked Canny edge head alignment (C area align, B area suppressed)."""
        if base_img_bgra is None or post_img_bgra is None:
            return {"applied": False, "reason": "missing_images", "post_warped": post_img_bgra}
        if base_img_bgra.shape[:2] != post_img_bgra.shape[:2]:
            return {"applied": False, "reason": "shape_mismatch", "post_warped": post_img_bgra}

        h, w = base_img_bgra.shape[:2]
        if b_union_u8 is None or c_union_u8 is None:
            return {"applied": False, "reason": "missing_masks", "post_warped": post_img_bgra}
        if b_union_u8.shape[:2] != (h, w) or c_union_u8.shape[:2] != (h, w):
            return {"applied": False, "reason": "mask_shape_mismatch", "post_warped": post_img_bgra}

        alpha_valid = (((base_img_bgra[:, :, 3] > 16) & (post_img_bgra[:, :, 3] > 16)).astype(np.uint8) * 255)
        c_mask = cv2.bitwise_and(c_union_u8, alpha_valid)
        c_count = int(cv2.countNonZero(c_mask))
        min_c_pixels = max(250, int(face_width * face_width * 0.05))
        if c_count < min_c_pixels:
            return {"applied": False, "reason": f"too_few_c_pixels:{c_count}", "post_warped": post_img_bgra}

        ys, xs = np.where(c_mask > 0)
        if len(xs) < 20 or len(ys) < 20:
            return {"applied": False, "reason": "degenerate_c_bbox", "post_warped": post_img_bgra}

        pad = max(12, int(face_width * 0.18))
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)
        x1 = min(w, int(xs.max()) + pad + 1)
        y1 = min(h, int(ys.max()) + pad + 1)
        cw = x1 - x0
        ch = y1 - y0
        if cw < 24 or ch < 24:
            return {"applied": False, "reason": "crop_too_small", "post_warped": post_img_bgra}

        base_crop = base_img_bgra[y0:y1, x0:x1]
        post_crop = post_img_bgra[y0:y1, x0:x1]
        b_crop = b_union_u8[y0:y1, x0:x1]
        c_crop = c_mask[y0:y1, x0:x1]
        valid_crop = alpha_valid[y0:y1, x0:x1]

        gray_base = cv2.cvtColor(base_crop[:, :, :3], cv2.COLOR_BGR2GRAY)
        gray_post = cv2.cvtColor(post_crop[:, :, :3], cv2.COLOR_BGR2GRAY)

        def masked_canny(gray_u8, mask_u8):
            vals = gray_u8[mask_u8 > 0]
            if vals.size < 20:
                vals = gray_u8.reshape(-1)
            med = float(np.median(vals))
            low = int(max(8, 0.66 * med))
            high = int(min(250, 1.33 * med))
            if high <= low:
                high = min(255, low + 24)
            blur = cv2.GaussianBlur(gray_u8, (0, 0), 1.1)
            e = cv2.Canny(blur, low, high, L2gradient=True)
            e[mask_u8 == 0] = 0
            return e

        base_edges_raw = masked_canny(gray_base, valid_crop)
        post_edges_raw = masked_canny(gray_post, valid_crop)
        base_before = int(cv2.countNonZero(base_edges_raw))
        post_before = int(cv2.countNonZero(post_edges_raw))

        green_k = max(2, int(face_width * 0.035))
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (green_k * 2 + 1, green_k * 2 + 1))
        b_dil = cv2.dilate((b_crop > 0).astype(np.uint8) * 255, k)

        base_edges = base_edges_raw.copy()
        post_edges = post_edges_raw.copy()
        base_edges[b_dil > 0] = 0
        post_edges[b_dil > 0] = 0
        base_edges[valid_crop == 0] = 0
        post_edges[valid_crop == 0] = 0
        base_after = int(cv2.countNonZero(base_edges))
        post_after = int(cv2.countNonZero(post_edges))

        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_canny_base.png"), base_edges)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_canny_post.png"), post_edges)

        self.log(
            f"   Canny head-align crop: x={x0}, y={y0}, w={cw}, h={ch}; "
            f"edges base {base_before}->{base_after}, post {post_before}->{post_after}."
        )

        work_mask = ((valid_crop > 0) & (b_dil == 0)).astype(np.uint8) * 255
        if base_after < 80 or post_after < 80:
            return {"applied": False, "reason": "too_few_edges_after_suppression", "post_warped": post_img_bgra}

        def dist_map(edge_u8):
            inv = np.where(edge_u8 > 0, 0, 255).astype(np.uint8)
            return cv2.distanceTransform(inv, cv2.DIST_L2, 5)

        def chamfer(edge_a_u8, edge_b_u8):
            a_pts = (edge_a_u8 > 0) & (work_mask > 0)
            b_pts = (edge_b_u8 > 0) & (work_mask > 0)
            n_a = int(np.count_nonzero(a_pts))
            n_b = int(np.count_nonzero(b_pts))
            if n_a < 20 or n_b < 20:
                return {"mean": 1e9, "max": 1e9, "overlap": 0.0}
            db = dist_map(edge_b_u8)
            da = dist_map(edge_a_u8)
            d_ab = db[a_pts]
            d_ba = da[b_pts]
            mean = float((np.mean(d_ab) + np.mean(d_ba)) * 0.5)
            maxv = float(max(np.percentile(d_ab, 95.0), np.percentile(d_ba, 95.0)))
            inter = int(np.count_nonzero(a_pts & b_pts))
            union = int(np.count_nonzero(a_pts | b_pts))
            overlap = float(inter) / float(max(1, union))
            return {"mean": mean, "max": maxv, "overlap": overlap}

        def warp_ecc(src_u8, warp_m):
            return cv2.warpAffine(
                src_u8,
                warp_m,
                (cw, ch),
                flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )

        def run_ecc_seed():
            scales = [0.20, 0.35, 0.50, 0.75, 1.0]
            motion_modes = [cv2.MOTION_TRANSLATION, cv2.MOTION_EUCLIDEAN, cv2.MOTION_AFFINE]
            criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 180, 1e-7)
            warp = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
            prev_s = scales[0]
            best_cc = 0.0
            for s in scales:
                base_s = cv2.resize(base_edges, (max(12, int(cw * s)), max(12, int(ch * s))), interpolation=cv2.INTER_AREA)
                post_s = cv2.resize(post_edges, base_s.shape[::-1], interpolation=cv2.INTER_AREA)
                mask_s = cv2.resize(work_mask, base_s.shape[::-1], interpolation=cv2.INTER_NEAREST)
                base_f = cv2.GaussianBlur(base_s.astype(np.float32) / 255.0, (0, 0), 0.9)
                post_f = cv2.GaussianBlur(post_s.astype(np.float32) / 255.0, (0, 0), 0.9)
                if s != prev_s:
                    warp[:, 2] *= float(s / prev_s)
                    prev_s = s
                for mode in motion_modes:
                    try:
                        try:
                            cc, warp = cv2.findTransformECC(
                                base_f,
                                post_f,
                                warp,
                                mode,
                                criteria,
                                inputMask=mask_s,
                                gaussFiltSize=5,
                            )
                        except TypeError:
                            cc, warp = cv2.findTransformECC(
                                base_f,
                                post_f,
                                warp,
                                mode,
                                criteria,
                                inputMask=mask_s,
                            )
                        best_cc = max(best_cc, float(cc))
                    except cv2.error:
                        continue
            return warp, best_cc

        ecc_warp, ecc_score = run_ecc_seed()
        edge_affine = warp_ecc(post_edges, ecc_warp)
        score_unwarped = chamfer(base_edges, post_edges)
        score_initial = chamfer(base_edges, edge_affine)

        def matrix_to_sim_params(warp_m):
            tx = float(warp_m[0, 2])
            ty = float(warp_m[1, 2])
            c = float(warp_m[0, 0])
            s = float(warp_m[1, 0])
            scale = float(max(0.90, min(1.10, np.hypot(c, s))))
            theta = float(np.arctan2(s, c))
            return tx, ty, scale, theta

        def sim_matrix(tx, ty, scale, theta):
            c = float(np.cos(theta) * scale)
            s = float(np.sin(theta) * scale)
            return np.array([[c, -s, tx], [s, c, ty]], dtype=np.float32)

        tx0, ty0, sc0, th0 = matrix_to_sim_params(ecc_warp)
        best_warp = ecc_warp.copy()
        best_metrics = score_initial
        spans = [
            (max(2.0, face_width * 0.05), max(2.0, face_width * 0.05), 0.03, np.radians(3.0), 7),
            (1.6, 1.6, 0.015, np.radians(1.5), 7),
            (0.8, 0.8, 0.007, np.radians(0.8), 5),
        ]
        for tx_s, ty_s, sc_s, th_s, n in spans:
            for tx in np.linspace(tx0 - tx_s, tx0 + tx_s, n):
                for ty in np.linspace(ty0 - ty_s, ty0 + ty_s, n):
                    for sc in np.linspace(max(0.94, sc0 - sc_s), min(1.06, sc0 + sc_s), max(3, n // 2)):
                        for th in np.linspace(th0 - th_s, th0 + th_s, max(3, n // 2)):
                            w_try = sim_matrix(tx, ty, sc, th)
                            e_try = warp_ecc(post_edges, w_try)
                            m = chamfer(base_edges, e_try)
                            if (m["mean"] < best_metrics["mean"] - 1e-4) or (
                                abs(m["mean"] - best_metrics["mean"]) < 1e-4 and m["max"] < best_metrics["max"]
                            ):
                                best_warp = w_try
                                best_metrics = m
                                tx0, ty0, sc0, th0 = tx, ty, sc, th

        warp_safe, warp_reason = self._affine_matrix_is_safe(best_warp, face_width, cw, ch)
        if not warp_safe:
            self.log(f"   Canny head-align rejected unsafe affine seed: {warp_reason}.")
            return {"applied": False, "reason": f"unsafe_affine:{warp_reason}", "post_warped": post_img_bgra}

        def build_affine_map(width, height, warp_m):
            xx, yy = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
            map_x = warp_m[0, 0] * xx + warp_m[0, 1] * yy + warp_m[0, 2]
            map_y = warp_m[1, 0] * xx + warp_m[1, 1] * yy + warp_m[1, 2]
            return map_x.astype(np.float32), map_y.astype(np.float32)

        def remap_edge(src_u8, map_x, map_y):
            return cv2.remap(src_u8, map_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        def demons_refine(seed_warp):
            scales = [0.20, 0.35, 0.50, 0.75, 1.0]
            iters = [90, 80, 70, 55, 45]
            disp_x_prev = None
            disp_y_prev = None
            prev_s = None
            for s, n_iter in zip(scales, iters):
                sw = max(24, int(round(cw * s)))
                sh = max(24, int(round(ch * s)))
                be = cv2.resize(base_edges, (sw, sh), interpolation=cv2.INTER_NEAREST)
                pe = cv2.resize(post_edges, (sw, sh), interpolation=cv2.INTER_NEAREST)
                mk = cv2.resize(work_mask, (sw, sh), interpolation=cv2.INTER_NEAREST)
                w_s = seed_warp.copy()
                w_s[:, 2] *= float(s)
                map_x, map_y = build_affine_map(sw, sh, w_s)
                if disp_x_prev is None:
                    disp_x = np.zeros((sh, sw), dtype=np.float32)
                    disp_y = np.zeros((sh, sw), dtype=np.float32)
                else:
                    scale_ratio = float(s / prev_s)
                    disp_x = cv2.resize(disp_x_prev, (sw, sh), interpolation=cv2.INTER_LINEAR) * scale_ratio
                    disp_y = cv2.resize(disp_y_prev, (sw, sh), interpolation=cv2.INTER_LINEAR) * scale_ratio
                prev_s = s

                d_tgt = dist_map(be)
                gy, gx = np.gradient(d_tgt)
                mk_bool = mk > 0
                for _ in range(n_iter):
                    warped = remap_edge(pe, map_x + disp_x, map_y + disp_y)
                    src_pts = (warped > 0) & mk_bool
                    if np.count_nonzero(src_pts) < 30:
                        break
                    dv = d_tgt[src_pts]
                    gxx = gx[src_pts]
                    gyy = gy[src_pts]
                    denom = (gxx * gxx) + (gyy * gyy) + 0.05
                    step = -np.clip(dv / denom, -3.0, 3.0)
                    du_full = np.zeros_like(disp_x)
                    dv_full = np.zeros_like(disp_y)
                    du_full[src_pts] = step * gxx
                    dv_full[src_pts] = step * gyy
                    du_full = cv2.GaussianBlur(du_full, (0, 0), 1.2)
                    dv_full = cv2.GaussianBlur(dv_full, (0, 0), 1.2)
                    disp_x += (0.36 * du_full)
                    disp_y += (0.36 * dv_full)
                    disp_x = cv2.GaussianBlur(disp_x, (0, 0), 0.95)
                    disp_y = cv2.GaussianBlur(disp_y, (0, 0), 0.95)

                disp_x_prev = disp_x
                disp_y_prev = disp_y

            disp_x = cv2.resize(disp_x_prev, (cw, ch), interpolation=cv2.INTER_LINEAR)
            disp_y = cv2.resize(disp_y_prev, (cw, ch), interpolation=cv2.INTER_LINEAR)
            map_x_aff, map_y_aff = build_affine_map(cw, ch, seed_warp)
            map_x_out = map_x_aff + disp_x
            map_y_out = map_y_aff + disp_y
            return map_x_out.astype(np.float32), map_y_out.astype(np.float32), disp_x, disp_y

        map_x_dense, map_y_dense, flow_dx, flow_dy = demons_refine(best_warp)
        map_x_aff, map_y_aff = build_affine_map(cw, ch, best_warp)
        edge_affine_best = remap_edge(post_edges, map_x_aff, map_y_aff)
        metrics_affine_best = chamfer(base_edges, edge_affine_best)

        candidates = [("affine", metrics_affine_best, edge_affine_best, map_x_aff, map_y_aff)]
        for name, mx, my in (
            ("dense+", map_x_dense, map_y_dense),
            ("dense-", (2.0 * map_x_aff) - map_x_dense, (2.0 * map_y_aff) - map_y_dense),
        ):
            safe, safe_reason, _stats = self._dense_displacement_is_safe(mx - map_x_aff, my - map_y_aff, work_mask, face_width, f"canny_{name}")
            if not safe:
                self.log(f"   Canny head-align candidate {name} skipped: {safe_reason}.")
                continue
            edge_try = remap_edge(post_edges, mx, my)
            candidates.append((name, chamfer(base_edges, edge_try), edge_try, mx.astype(np.float32), my.astype(np.float32)))

        chosen_name, chosen_metrics, chosen_edge, chosen_map_x, chosen_map_y = min(
            candidates,
            key=lambda item: (item[1]["mean"], item[1]["max"], -item[1]["overlap"]),
        )

        if hasattr(cv2, "DISOpticalFlow_create"):
            try:
                dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
                src_warped_edges = remap_edge(post_edges, chosen_map_x, chosen_map_y)
                src_dt = cv2.normalize(dist_map(src_warped_edges), None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
                tgt_dt = cv2.normalize(dist_map(base_edges), None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
                flow = dis.calc(src_dt, tgt_dt, None)
                for suffix, sign in (("+", -1.0), ("-", 1.0)):
                    map_x_dis = chosen_map_x + (sign * flow[:, :, 0])
                    map_y_dis = chosen_map_y + (sign * flow[:, :, 1])
                    edge_dis = remap_edge(post_edges, map_x_dis, map_y_dis)
                    metrics_dis = chamfer(base_edges, edge_dis)
                    safe, safe_reason, _stats = self._dense_displacement_is_safe(map_x_dis - map_x_aff, map_y_dis - map_y_aff, work_mask, face_width, f"canny_dis{suffix}")
                    if safe and (metrics_dis["mean"], metrics_dis["max"]) < (chosen_metrics["mean"], chosen_metrics["max"]):
                        chosen_name = f"dis{suffix}"
                        chosen_metrics = metrics_dis
                        chosen_edge = edge_dis
                        chosen_map_x = map_x_dis.astype(np.float32)
                        chosen_map_y = map_y_dis.astype(np.float32)
                    elif not safe:
                        self.log(f"   Canny head-align DIS{suffix} skipped: {safe_reason}.")
            except Exception:
                pass

        tps_available = hasattr(cv2, "createThinPlateSplineShapeTransformer")
        score_final = chosen_metrics
        final_safe, final_safe_reason, _final_stats = self._dense_displacement_is_safe(chosen_map_x - map_x_aff, chosen_map_y - map_y_aff, work_mask, face_width, f"canny_{chosen_name}")
        improves_baseline = (
            score_final["mean"] <= score_unwarped["mean"] * 0.92
            or score_final["mean"] <= score_unwarped["mean"] - 0.25
            or score_final["overlap"] >= score_unwarped["overlap"] + 0.03
        )
        if score_final["mean"] > score_initial["mean"] + 1e-6:
            self.log("   Canny head-align rejected (score worsened vs ECC seed), keeping pre-warp image.")
            return {"applied": False, "reason": "worse_seed_score", "post_warped": post_img_bgra}
        if not improves_baseline:
            self.log(
                "   Canny head-align rejected (no clear gain over unwarped edges): "
                f"unwarped mean/overlap={score_unwarped['mean']:.3f}/{score_unwarped['overlap']:.3f}, "
                f"final={score_final['mean']:.3f}/{score_final['overlap']:.3f}."
            )
            return {"applied": False, "reason": "no_baseline_improvement", "post_warped": post_img_bgra}
        if not final_safe:
            self.log(f"   Canny head-align rejected ({final_safe_reason}), keeping pre-warp image.")
            return {"applied": False, "reason": final_safe_reason, "post_warped": post_img_bgra}

        warped_crop = cv2.remap(
            post_crop,
            chosen_map_x,
            chosen_map_y,
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )

        head_k = max(3, int(face_width * 0.22))
        head_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (head_k * 2 + 1, head_k * 2 + 1))
        head_mask = cv2.dilate((c_crop > 0).astype(np.uint8) * 255, head_kernel)
        head_mask = cv2.bitwise_and(head_mask, valid_crop)
        head_soft = cv2.GaussianBlur(head_mask.astype(np.float32) / 255.0, (0, 0), max(1.2, face_width * 0.015))
        head_soft = np.clip(head_soft, 0.0, 1.0)[:, :, np.newaxis]

        out_full = post_img_bgra.copy()
        roi_dst = out_full[y0:y1, x0:x1].astype(np.float32)
        roi_src = warped_crop.astype(np.float32)
        blended = (roi_src * head_soft + roi_dst * (1.0 - head_soft)).clip(0, 255).astype(np.uint8)
        out_full[y0:y1, x0:x1] = blended

        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_canny_post_warped.png"), chosen_edge)
        overlay = cv2.cvtColor(base_edges, cv2.COLOR_GRAY2BGR)
        overlay[:, :, 2] = np.maximum(overlay[:, :, 2], chosen_edge)
        overlay[:, :, 1] = np.maximum(overlay[:, :, 1], base_edges)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_canny_overlay.png"), overlay)
        flow_vis = np.zeros((ch, cw, 3), dtype=np.uint8)
        mag, ang = cv2.cartToPolar(flow_dx.astype(np.float32), flow_dy.astype(np.float32))
        flow_vis[:, :, 0] = np.uint8((ang * 90.0 / np.pi) % 180)
        flow_vis[:, :, 1] = 220
        flow_vis[:, :, 2] = np.clip((mag * 24.0), 0, 255).astype(np.uint8)
        flow_vis = cv2.cvtColor(flow_vis, cv2.COLOR_HSV2BGR)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_canny_flow.jpg"), flow_vis)

        quality = "tight" if (score_final["mean"] <= 1.5 or score_final["overlap"] >= 0.16) else "rough"
        self.log(
            "   Canny head-align: "
            f"ecc={ecc_score:.3f}, unwarped(mean/max)={score_unwarped['mean']:.3f}/{score_unwarped['max']:.3f}, "
            f"initial(mean/max)={score_initial['mean']:.3f}/{score_initial['max']:.3f}, "
            f"final(mean/max)={score_final['mean']:.3f}/{score_final['max']:.3f}, "
            f"overlap={score_final['overlap']:.3f}, quality={quality}, winner={chosen_name}, tps_available={tps_available}."
        )
        return {
            "applied": True,
            "reason": "ok",
            "post_warped": out_full,
            "crop_bbox": (x0, y0, x1, y1),
            "score_unwarped": score_unwarped,
            "score_initial": score_initial,
            "score_final": score_final,
            "winner": chosen_name,
            "quality": quality,
            "tps_available": tps_available,
        }

    def save_numbered_landmark_debug(self, base_id, base_bgr, post_bgr, base_pts, post_pts, face_width):
        """Save a high-readability numbered landmark sheet for base and post images."""
        group_defs = [
            ("jaw 0-4", range(0, 5), (60, 220, 255)),
            ("L brow 5-7", range(5, 8), (255, 160, 80)),
            ("R brow 8-10", range(8, 11), (255, 160, 80)),
            ("L eye 11-13", range(11, 14), (80, 255, 120)),
            ("nose 14-16", range(14, 17), (0, 180, 255)),
            ("R eye 17-19", range(17, 20), (80, 255, 120)),
            ("mouth 20-27", range(20, 28), (255, 90, 220)),
        ]
        color_by_idx = {}
        for _, idxs, color in group_defs:
            for idx in idxs:
                color_by_idx[idx] = color

        legend_h = 92
        canvas = np.concatenate((base_bgr.copy(), post_bgr.copy()), axis=1)
        canvas = cv2.copyMakeBorder(canvas, 0, legend_h, 0, 0, cv2.BORDER_CONSTANT, value=(18, 18, 18))
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = max(0.78, min(1.35, float(face_width) / 360.0))
        thickness = max(2, int(round(font_scale * 2.0)))
        dot_r = max(6, int(round(float(face_width) * 0.012)))

        def draw_label(img, text, x, y, color):
            x = int(np.clip(x, 0, img.shape[1] - 1))
            y = int(np.clip(y, 0, img.shape[0] - 1))
            (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)
            tx = int(np.clip(x + dot_r + 4, 0, max(0, img.shape[1] - tw - 4)))
            ty = int(np.clip(y - dot_r - 4, th + 4, img.shape[0] - baseline - 4))
            cv2.rectangle(
                img,
                (tx - 3, ty - th - 3),
                (tx + tw + 3, ty + baseline + 3),
                (0, 0, 0),
                -1,
            )
            cv2.putText(img, text, (tx, ty), font, font_scale, (255, 255, 255), thickness + 2, cv2.LINE_AA)
            cv2.putText(img, text, (tx, ty), font, font_scale, color, thickness, cv2.LINE_AA)

        def draw_points(img, pts, x_offset):
            for i, pt in enumerate(pts):
                x = int(round(float(pt[0]))) + x_offset
                y = int(round(float(pt[1])))
                color = color_by_idx.get(i, (255, 255, 255))
                cv2.circle(img, (x, y), dot_r + 3, (0, 0, 0), -1, cv2.LINE_AA)
                cv2.circle(img, (x, y), dot_r, color, -1, cv2.LINE_AA)
                cv2.circle(img, (x, y), dot_r + 1, (255, 255, 255), 1, cv2.LINE_AA)
                draw_label(img, str(i), x, y, color)

        draw_points(canvas, base_pts, 0)
        draw_points(canvas, post_pts, base_bgr.shape[1])

        cv2.putText(canvas, "BASE landmarks", (18, 36), font, 1.0, (0, 0, 0), 5, cv2.LINE_AA)
        cv2.putText(canvas, "BASE landmarks", (18, 36), font, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(canvas, "POST landmarks", (base_bgr.shape[1] + 18, 36), font, 1.0, (0, 0, 0), 5, cv2.LINE_AA)
        cv2.putText(canvas, "POST landmarks", (base_bgr.shape[1] + 18, 36), font, 1.0, (255, 255, 255), 2, cv2.LINE_AA)

        legend_y = base_bgr.shape[0] + 32
        legend_x = 18
        for label, _, color in group_defs:
            cv2.circle(canvas, (legend_x, legend_y), 8, color, -1, cv2.LINE_AA)
            cv2.putText(canvas, label, (legend_x + 15, legend_y + 6), font, 0.62, (235, 235, 235), 2, cv2.LINE_AA)
            legend_x += 158
            if legend_x > canvas.shape[1] - 160:
                legend_x = 18
                legend_y += 34

        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_landmarks_numbered.jpg"), canvas)

    def save_debug_remove_hair(self, base_id, base_img_bgra, b_union_u8, c_union_u8, face_pts, face_width):
        """Remove likely hair from the large A/B/C crop and return a soft face alpha mask."""
        if base_img_bgra is None or c_union_u8 is None or b_union_u8 is None:
            return
        h, w = base_img_bgra.shape[:2]
        if c_union_u8.shape[:2] != (h, w) or b_union_u8.shape[:2] != (h, w):
            return

        alpha = base_img_bgra[:, :, 3]
        large_mask = cv2.bitwise_or(c_union_u8, b_union_u8)
        large_mask = cv2.bitwise_and(large_mask, ((alpha > 16).astype(np.uint8) * 255))
        if cv2.countNonZero(large_mask) < 80:
            return

        ys, xs = np.where(large_mask > 0)
        pad = max(12, int(face_width * 0.20))
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)
        x1 = min(w, int(xs.max()) + pad + 1)
        y1 = min(h, int(ys.max()) + pad + 1)

        crop = base_img_bgra[y0:y1, x0:x1].copy()
        crop_bgr = crop[:, :, :3]
        crop_alpha = crop[:, :, 3]
        crop_large = large_mask[y0:y1, x0:x1] > 0

        has_face_pts = face_pts is not None and len(face_pts) >= 5
        face_hull = np.zeros((h, w), dtype=np.uint8)
        if has_face_pts:
            cv2.fillConvexPoly(face_hull, cv2.convexHull(face_pts.astype(np.int32)), 255)
        face_hull = cv2.dilate(face_hull, cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (max(3, int(face_width * 0.07)) * 2 + 1, max(3, int(face_width * 0.07)) * 2 + 1),
        ))
        face_crop = face_hull[y0:y1, x0:x1] > 0
        strict_face_crop = face_crop
        if has_face_pts:
            strict_face_hull = np.zeros((h, w), dtype=np.uint8)
            cv2.fillConvexPoly(strict_face_hull, cv2.convexHull(face_pts.astype(np.int32)), 255)
            strict_pad = max(4, int(face_width * 0.012))
            strict_face_hull = cv2.dilate(strict_face_hull, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (strict_pad * 2 + 1, strict_pad * 2 + 1),
            ))
            strict_face_crop = strict_face_hull[y0:y1, x0:x1] > 0

        # Hair candidates: opaque pixels in the crop, outside the face hull, biased above/around face.
        yy, xx = np.indices(crop_alpha.shape)
        face_center_y = float(np.mean(face_pts[:, 1]) - y0) if face_pts is not None and len(face_pts) else crop_alpha.shape[0] * 0.5
        upper_bias = yy < (face_center_y + face_width * 0.35)
        candidate = (crop_alpha > 32) & (~face_crop) & upper_bias
        if int(np.count_nonzero(candidate)) < 120:
            candidate = (crop_alpha > 32) & (~face_crop)
        if int(np.count_nonzero(candidate)) < 120:
            self.log("   Hair debug remove: skipped (not enough hair-color candidates).")
            return

        pix = crop_bgr[candidate].reshape(-1, 3).astype(np.float32)
        sample_step = max(1, len(pix) // 5000)
        pix_sample = pix[::sample_step]

        try:
            _, labels, centers = cv2.kmeans(
                pix_sample,
                min(4, max(2, len(pix_sample) // 50)),
                None,
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.2),
                3,
                cv2.KMEANS_PP_CENTERS,
            )
        except Exception:
            self.log("   Hair debug remove: skipped (kmeans failed).")
            return

        label_counts = np.bincount(labels.reshape(-1), minlength=len(centers)).astype(np.float32)
        centers_u8 = np.clip(centers.reshape(-1, 1, 3), 0, 255).astype(np.uint8)
        centers_lab = cv2.cvtColor(centers_u8, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
        center_scores = []
        for idx, (count, lab) in enumerate(zip(label_counts, centers_lab)):
            b, g, r = centers[idx]
            chroma = float(np.std([b, g, r]))
            lightness = float(lab[0])
            # Prefer common, non-black, non-white colored regions around the head.
            score = float(count) + chroma * 12.0 - abs(lightness - 145.0) * 1.8
            if max(b, g, r) < 35 or min(b, g, r) > 238:
                score -= float(count) * 0.9
            center_scores.append(score)
        hair_idx = int(np.argmax(center_scores))
        hair_bgr = centers[hair_idx].astype(np.float32)
        hair_lab = centers_lab[hair_idx]

        crop_lab = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        delta_lab = np.linalg.norm(crop_lab - hair_lab.reshape(1, 1, 3), axis=2)
        delta_bgr = np.linalg.norm(crop_bgr.astype(np.float32) - hair_bgr.reshape(1, 1, 3), axis=2)
        hair_like = (delta_lab < 33.0) | ((delta_lab < 46.0) & (delta_bgr < 58.0))
        hair_like &= (crop_alpha > 16)
        hair_like &= crop_large

        eat_px = 30
        eat_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eat_px * 2 + 1, eat_px * 2 + 1))
        hair_reach = cv2.dilate(hair_like.astype(np.uint8) * 255, eat_kernel) > 0
        b = crop_bgr[:, :, 0].astype(np.float32)
        g = crop_bgr[:, :, 1].astype(np.float32)
        r = crop_bgr[:, :, 2].astype(np.float32)
        luma = (0.114 * b) + (0.587 * g) + (0.299 * r)
        near_black_lines = (
            (crop_alpha > 16)
            & crop_large
            & (luma < 42.0)
            & (np.maximum.reduce([b, g, r]) < 72.0)
        )
        consumed_lines = hair_reach & near_black_lines
        remove_mask = hair_like | consumed_lines

        # Catch stranded anime-line fragments that are still visually part of hair.
        residue_reach = cv2.dilate(remove_mask.astype(np.uint8) * 255, cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (41, 41)
        )) > 0
        residue_candidates = near_black_lines & residue_reach & (~remove_mask)
        n_labels, labels_cc, stats, _ = cv2.connectedComponentsWithStats(
            residue_candidates.astype(np.uint8), 8
        )
        consumed_residue = np.zeros_like(remove_mask, dtype=bool)
        for lab in range(1, n_labels):
            area = int(stats[lab, cv2.CC_STAT_AREA])
            if area < 3:
                continue
            comp = labels_cc == lab
            w_cc = int(stats[lab, cv2.CC_STAT_WIDTH])
            h_cc = int(stats[lab, cv2.CC_STAT_HEIGHT])
            elongated = max(w_cc, h_cc) >= max(8, min(w_cc, h_cc) * 2)
            close_to_removed = np.any(cv2.dilate(comp.astype(np.uint8) * 255, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (17, 17)
            )) & remove_mask.astype(np.uint8))
            # Keep small facial dots; remove line-like scraps near the hair removal front.
            if close_to_removed and (elongated or area >= 18):
                consumed_residue |= comp
        remove_mask |= consumed_residue
        isolated_outside_face = np.zeros_like(remove_mask, dtype=bool)
        if has_face_pts:
            isolated_outside_face = crop_large & (crop_alpha > 16) & (~strict_face_crop)
        remove_mask |= isolated_outside_face
        face_blob_removed = np.zeros_like(remove_mask, dtype=bool)
        face_blob_passes = 0
        stray_removed = np.zeros_like(remove_mask, dtype=bool)

        # For the no-overlay isolation debug, stop chasing scraps one by one:
        # infer the main skin-colored face blob and purge anything outside it.
        channel_spread = np.maximum.reduce([b, g, r]) - np.minimum.reduce([b, g, r])
        face_blob_keep = None
        for purge_pass in range(4):
            skin_pool = (
                crop_large
                & strict_face_crop
                & (~remove_mask)
                & (crop_alpha > 16)
                & (luma > 78.0)
                & (luma < 252.0)
                & (channel_spread < 105.0)
                & (r >= (b - 10.0))
            )
            if int(np.count_nonzero(skin_pool)) < 120:
                break
            skin_lab = np.median(crop_lab[skin_pool], axis=0).astype(np.float32)
            skin_delta = np.linalg.norm(crop_lab - skin_lab.reshape(1, 1, 3), axis=2)
            skin_delta_thr = max(24.0, 34.0 - purge_pass * 3.0)
            skin_seed = (
                crop_large
                & strict_face_crop
                & (~remove_mask)
                & (crop_alpha > 16)
                & (luma > 62.0)
                & (skin_delta < skin_delta_thr)
            )
            close_px = max(2, int(face_width * max(0.007, 0.012 - purge_pass * 0.0015)))
            close_kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (close_px * 2 + 1, close_px * 2 + 1),
            )
            skin_seed_u8 = cv2.morphologyEx(
                skin_seed.astype(np.uint8) * 255,
                cv2.MORPH_CLOSE,
                close_kernel,
            )
            n_skin, skin_labels, skin_stats, skin_centers = cv2.connectedComponentsWithStats(
                skin_seed_u8, 8
            )
            best_lab = 0
            best_score = 0.0
            face_center_x = (
                float(np.mean(face_pts[:, 0]) - x0)
                if has_face_pts else crop_alpha.shape[1] * 0.5
            )
            face_center_y_blob = (
                float(np.mean(face_pts[:, 1]) - y0)
                if has_face_pts else crop_alpha.shape[0] * 0.5
            )
            for lab in range(1, n_skin):
                area = int(skin_stats[lab, cv2.CC_STAT_AREA])
                if area < 80:
                    continue
                cx, cy = skin_centers[lab]
                dist = math.hypot(float(cx) - face_center_x, float(cy) - face_center_y_blob)
                score = float(area) - dist * 0.8
                if score > best_score:
                    best_score = score
                    best_lab = lab

            if not best_lab:
                break

            face_blob_u8 = (skin_labels == best_lab).astype(np.uint8) * 255
            blob_pad = max(3, int(face_width * max(0.012, 0.018 - purge_pass * 0.002)))
            blob_kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (blob_pad * 2 + 1, blob_pad * 2 + 1),
            )
            face_blob_u8 = cv2.morphologyEx(face_blob_u8, cv2.MORPH_CLOSE, blob_kernel)
            contours, _ = cv2.findContours(face_blob_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                break

            contour = max(contours, key=cv2.contourArea)
            face_blob_u8 = np.zeros_like(face_blob_u8)
            cv2.drawContours(face_blob_u8, [contour], -1, 255, thickness=cv2.FILLED)
            edge_pad = max(0, int(face_width * max(0.0, 0.006 - purge_pass * 0.002)))
            if edge_pad:
                face_blob_u8 = cv2.dilate(face_blob_u8, cv2.getStructuringElement(
                    cv2.MORPH_ELLIPSE,
                    (edge_pad * 2 + 1, edge_pad * 2 + 1),
                ))
            face_blob_keep = (face_blob_u8 > 0) & strict_face_crop
            pass_removed = crop_large & (crop_alpha > 16) & (~face_blob_keep) & (~remove_mask)
            if int(np.count_nonzero(pass_removed)) == 0 and purge_pass > 0:
                face_blob_passes = purge_pass + 1
                break
            face_blob_removed |= pass_removed
            remove_mask |= pass_removed
            face_blob_passes = purge_pass + 1

        if face_blob_keep is not None:
            visible_after_blob = crop_large & (crop_alpha > 16) & (~remove_mask)
            boundary_band = np.zeros_like(visible_after_blob, dtype=bool)
            face_blob_keep_u8 = face_blob_keep.astype(np.uint8) * 255
            dist_inside = cv2.distanceTransform(face_blob_keep_u8, cv2.DIST_L2, 3)
            boundary_band = (dist_inside > 0) & (dist_inside < max(10.0, face_width * 0.035))
            non_skin_visible = (
                visible_after_blob
                & boundary_band
                & ((luma < 78.0) | (channel_spread > 115.0) | (r < (b - 12.0)))
            )
            n_stray, stray_labels, stray_stats, _ = cv2.connectedComponentsWithStats(
                non_skin_visible.astype(np.uint8), 8
            )
            for lab in range(1, n_stray):
                area = int(stray_stats[lab, cv2.CC_STAT_AREA])
                if area < 3:
                    continue
                comp = stray_labels == lab
                w_cc = int(stray_stats[lab, cv2.CC_STAT_WIDTH])
                h_cc = int(stray_stats[lab, cv2.CC_STAT_HEIGHT])
                elongated = max(w_cc, h_cc) >= max(8, min(w_cc, h_cc) * 2)
                compact_scrap = area <= 260
                short_line_scrap = elongated and area <= 620 and max(w_cc, h_cc) <= max(60, int(face_width * 0.11))
                if compact_scrap or short_line_scrap:
                    stray_removed |= comp
            remove_mask |= stray_removed

        cleaned = crop_bgr.copy()
        cleaned[remove_mask] = (0, 0, 0)

        debug = cleaned.copy()
        removed_overlay = np.zeros_like(debug)
        removed_overlay[:, :, 2] = (remove_mask.astype(np.uint8) * 255)
        debug = cv2.addWeighted(debug, 1.0, removed_overlay, 0.35, 0)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_remove_hair.jpg"), debug)

        face_only = crop_bgr.copy()
        face_only[(~crop_large) | remove_mask] = (0, 0, 0)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_face_only_no_hair.jpg"), face_only)

        face_soft_full = None
        if face_blob_keep is not None:
            face_soft_basis = face_blob_keep
            basis_u8 = face_blob_keep.astype(np.uint8) * 255
            hull_close_px = max(3, int(face_width * 0.035))
            basis_u8 = cv2.morphologyEx(
                basis_u8,
                cv2.MORPH_CLOSE,
                cv2.getStructuringElement(
                    cv2.MORPH_ELLIPSE,
                    (hull_close_px * 2 + 1, hull_close_px * 2 + 1),
                ),
            )
            basis_contours, _ = cv2.findContours(basis_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if basis_contours:
                face_soft_u8 = np.zeros_like(basis_u8)
                face_soft_hull = cv2.convexHull(max(basis_contours, key=cv2.contourArea))
                cv2.drawContours(face_soft_u8, [face_soft_hull], -1, 255, thickness=cv2.FILLED)
                face_soft_basis = (face_soft_u8 > 0) & strict_face_crop

            ys_f, xs_f = np.where(face_soft_basis)
            if len(xs_f) > 0 and len(ys_f) > 0:
                fw_f = max(1, int(xs_f.max()) - int(xs_f.min()) + 1)
                fh_f = max(1, int(ys_f.max()) - int(ys_f.min()) + 1)
                edge_px = max(1, int(round(min(fw_f, fh_f) * 0.05)))
                feather_px = max(1, int(round(min(fw_f, fh_f) * 0.05)))
                dist_in = cv2.distanceTransform(
                    face_soft_basis.astype(np.uint8) * 255,
                    cv2.DIST_L2,
                    3,
                )
                face_soft_crop = np.clip((dist_in - float(edge_px)) / float(feather_px), 0.0, 1.0)
                face_soft_crop *= face_soft_basis.astype(np.float32)
                face_soft_full = np.zeros((h, w), dtype=np.float32)
                face_soft_full[y0:y1, x0:x1] = face_soft_crop.astype(np.float32)
        self.log(
            "   Hair debug remove: "
            f"hair_bgr={int(hair_bgr[0])}/{int(hair_bgr[1])}/{int(hair_bgr[2])}, "
            f"removed={int(np.count_nonzero(remove_mask))} px "
            f"(hair={int(np.count_nonzero(hair_like))}, lines={int(np.count_nonzero(consumed_lines))}, "
            f"residue={int(np.count_nonzero(consumed_residue))}, "
            f"outside_face={int(np.count_nonzero(isolated_outside_face))}, "
            f"face_blob={int(np.count_nonzero(face_blob_removed))}/{face_blob_passes}p, "
            f"stray={int(np.count_nonzero(stray_removed))}), "
            f"crop={x1 - x0}x{y1 - y0}."
        )
        return face_soft_full

    def handle_no_landmark_manual_process(self, base_id, post_id, base_img, post_img, base_img_orig, upscale_factor, region_init_masks=None, region_default_tools=None, fallback_label="No-Face"):
        """Fallback when landmarks fail: let the user paint available overlays manually."""
        self.log("2.5 Landmark fallback: opening manual overlay editors; paint only where post pixels are needed.")

        # Match the normal landmark flow: keep the popup responsive on downscaled previews,
        # then apply the returned mask/offset to the high-res images for final compositing.
        comp_base_img = base_img
        comp_post_img = post_img
        h, w = comp_base_img.shape[:2]
        editor_to_comp_scale = 1.0

        def cv2_to_pil(img_cv):
            return Image.fromarray(cv2.cvtColor(img_cv, cv2.COLOR_BGRA2RGBA))

        def apply_transform_and_blend(base, top_pil, mask_pil, offset, scale):
            base_h, base_w = base.shape[:2]
            tw, th = top_pil.size
            eff_scale = 1.0 if abs(scale - 1.0) < REGION_SCALE_SNAP_EPS else scale
            sw, sh = int(tw * eff_scale), int(th * eff_scale)
            if sw < 1 or sh < 1:
                return base.copy()

            top_scaled = top_pil.resize((sw, sh), REGION_TOP_RESAMPLE)
            top_arr = np.array(top_scaled)  # RGBA
            mask_arr = np.array(mask_pil.resize((base_w, base_h), Image.BILINEAR)).astype(np.float32)

            ox, oy = int(offset[0]), int(offset[1])
            x0, y0 = max(0, ox), max(0, oy)
            x1, y1 = min(base_w, ox + sw), min(base_h, oy + sh)
            if x1 <= x0 or y1 <= y0:
                return base.copy()

            result = cv2.cvtColor(base, cv2.COLOR_BGRA2RGBA).copy()
            tx0, ty0 = x0 - ox, y0 - oy
            tx1, ty1 = tx0 + (x1 - x0), ty0 + (y1 - y0)

            top_f = top_arr[ty0:ty1, tx0:tx1, :3].astype(np.float32)
            base_f = result[y0:y1, x0:x1, :3].astype(np.float32)
            orig_a = top_arr[ty0:ty1, tx0:tx1, 3].astype(np.float32)
            mask_bin = np.clip(mask_arr[y0:y1, x0:x1] / 255.0, 0.0, 1.0).astype(np.float32)
            a = np.where(orig_a >= REGION_ALPHA_SOLID_THRESHOLD, mask_bin, 0.0)[:, :, np.newaxis]

            result[y0:y1, x0:x1, :3] = (top_f * a + base_f * (1.0 - a)).clip(0, 255).astype(np.uint8)
            result[y0:y1, x0:x1, 3] = base[y0:y1, x0:x1, 3]
            return cv2.cvtColor(result, cv2.COLOR_RGBA2BGRA)
        def load_external_composited(region_name, reg_res):
            ext_path = reg_res.get("external_composite_path")
            if ext_path and os.path.exists(ext_path):
                try:
                    with Image.open(ext_path) as ext:
                        ext_rgba = ext.convert("RGBA")
                        ext_bgra = cv2.cvtColor(np.array(ext_rgba), cv2.COLOR_RGBA2BGRA)
                    if ext_bgra.shape[:2] != comp_base_img.shape[:2]:
                        raise ValueError(
                            f"size mismatch {ext_bgra.shape[1]}x{ext_bgra.shape[0]} vs {comp_base_img.shape[1]}x{comp_base_img.shape[0]}"
                        )
                    self.log(f"   {region_name} uses external composited BASE: {os.path.basename(ext_path)}")
                    return ext_bgra
                except Exception as e:
                    self.log(f"   {region_name} external composited BASE ignored ({e}); using internal transform.")
            return None

        base_pil = cv2_to_pil(comp_base_img)
        post_pil = cv2_to_pil(comp_post_img)
        if upscale_factor > 1.0:
            editor_h, editor_w = base_img_orig.shape[:2]
            editor_base_pil = base_pil.resize((editor_w, editor_h), Image.LANCZOS)
            editor_post_pil = post_pil.resize((editor_w, editor_h), Image.LANCZOS)
            editor_to_comp_scale = upscale_factor
        else:
            editor_base_pil = base_pil
            editor_post_pil = post_pil

        results = {}
        for region in ["Eyes", "Mouth"]:
            self.log(f"   -> Manual full-canvas {region} overlay...")
            event = threading.Event()
            reg_data = {"mask": None, "offset": (0.0, 0.0), "scale": 1.0, "external_composite_path": None}

            def open_popup(target_region=region):
                if region_init_masks and target_region in region_init_masks:
                    init_mask_f = region_init_masks[target_region]
                    if init_mask_f.shape[:2] != (editor_base_pil.height, editor_base_pil.width):
                        mask_img = Image.fromarray((np.clip(init_mask_f, 0.0, 1.0) * 255).astype(np.uint8))
                        mask_img = mask_img.resize((editor_base_pil.width, editor_base_pil.height), Image.BILINEAR)
                        init_mask_f = np.array(mask_img).astype(np.float32) / 255.0
                else:
                    init_mask_f = np.zeros((editor_base_pil.height, editor_base_pil.width), dtype=np.float32)
                popup = ManualAlignmentPopup(
                    self,
                    editor_base_pil,
                    editor_post_pil,
                    init_mask_f,
                    f"Manual {fallback_label} Fallback: {target_region}",
                    init_offset=(0.0, 0.0),
                    init_scale=1.0,
                )
                popup.tool.set((region_default_tools or {}).get(target_region, "Restore"))

                def on_finish(m, o, s, external_composite_path=None):
                    if editor_to_comp_scale != 1.0:
                        reg_data["mask"] = m.resize((w, h), Image.BILINEAR)
                        reg_data["offset"] = (o[0] * editor_to_comp_scale, o[1] * editor_to_comp_scale)
                        reg_data["scale"] = s
                        if external_composite_path and os.path.exists(external_composite_path):
                            try:
                                with Image.open(external_composite_path) as ext_img:
                                    ext_hi = ext_img.convert("RGBA").resize((w, h), Image.LANCZOS)
                                ext_out = os.path.join(OUTPUT_DIR, f"{base_id}_{target_region.lower()}_external_composite.png")
                                ext_hi.save(ext_out, format="PNG")
                                reg_data["external_composite_path"] = ext_out
                            except Exception as e:
                                self.log(f"      {target_region} external import ignored: {e}")
                    else:
                        reg_data["mask"] = m
                        reg_data["offset"] = o
                        reg_data["scale"] = s
                        if external_composite_path and os.path.exists(external_composite_path):
                            try:
                                with Image.open(external_composite_path) as ext_img:
                                    ext_rgba = ext_img.convert("RGBA")
                                ext_out = os.path.join(OUTPUT_DIR, f"{base_id}_{target_region.lower()}_external_composite.png")
                                ext_rgba.save(ext_out, format="PNG")
                                reg_data["external_composite_path"] = ext_out
                            except Exception as e:
                                self.log(f"      {target_region} external import ignored: {e}")
                    event.set()

                popup.on_finish = on_finish

            self.after(0, open_popup)
            event.wait()
            results[region] = reg_data

        e_res = results["Eyes"]
        m_res = results["Mouth"]
        eye_ext_bgra = load_external_composited("Eyes", e_res)
        mouth_ext_bgra = load_external_composited("Mouth", m_res)

        if eye_ext_bgra is not None:
            img_blink = eye_ext_bgra.copy()
        else:
            img_blink = apply_transform_and_blend(comp_base_img, post_pil, e_res["mask"], e_res["offset"], e_res["scale"])

        if mouth_ext_bgra is not None:
            img_talk = mouth_ext_bgra.copy()
        else:
            img_talk = apply_transform_and_blend(comp_base_img, post_pil, m_res["mask"], m_res["offset"], m_res["scale"])

        if mouth_ext_bgra is not None:
            mouth_ext_pil = Image.fromarray(cv2.cvtColor(mouth_ext_bgra, cv2.COLOR_BGRA2RGBA))
            img_talk_blink = apply_transform_and_blend(img_blink.copy(), mouth_ext_pil, m_res["mask"], (0.0, 0.0), 1.0)
        else:
            img_talk_blink = apply_transform_and_blend(img_blink.copy(), post_pil, m_res["mask"], m_res["offset"], m_res["scale"])


        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_blink.webp"), img_blink, [cv2.IMWRITE_WEBP_QUALITY, 100])
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_talk.webp"), img_talk, [cv2.IMWRITE_WEBP_QUALITY, 100])
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_talk_blink.webp"), img_talk_blink, [cv2.IMWRITE_WEBP_QUALITY, 100])

        self.log("6. Exporting manual no-face fallback to final_sprites/...")
        final_map = {
            os.path.join(OUTPUT_DIR, f"{base_id}_no_bg.webp"): os.path.join(FINAL_DIR, f"{base_id}.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_blink.webp"): os.path.join(FINAL_DIR, f"{base_id}_blink.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_talk.webp"): os.path.join(FINAL_DIR, f"{base_id}_talk.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_talk_blink.webp"): os.path.join(FINAL_DIR, f"{base_id}_talk_blink.webp"),
        }
        for src, dst in final_map.items():
            self.export_final_sprite(src, dst)
        self.log("   Done - 4 sprites in final_sprites/.")
    def handle_local_process(self, task):
        base_id = task["id"].replace("_local", "")
        post_id = base_id + "_post"

        base_path = os.path.join(OUTPUT_DIR, f"{base_id}.webp")

        # â”€â”€ Configurable Parameters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # 28-point layout (HRNetV2 anime-face-detector):
        #   0-4  : jaw / face contour (0=left jaw, 2=chin, 4=right jaw)
        #   5-7  : left eyebrow    8-10 : right eyebrow
        #   11-13: left eye        17-19: right eye
        #   14-16: nose bridge
        #   20-27: mouth ring (23 = nose/upper-lip boundary, highest point in range)
        LEFT_EYE_ONLY_IDX  = [11, 12, 13]            # immediate eye core (A)
        RIGHT_EYE_ONLY_IDX = [17, 18, 19]            # immediate eye core (A)
        # Mouth core polygon for A (drops point 23 which tends to spike upward).
        #   pt[1]=left cheek  pt[23]=nose/upper-mouth  pt[3]=right cheek  pt[2]=chin
        MOUTH_CORE_IDX = [20, 21, 22, 24, 25, 26, 27]

        # B growth and C donut thickness (fractions of face_width)
        EYE_B_PAD_FRAC       = 0.19
        EYE_C_OUTER_PAD_FRAC = 0.20
        EYE_PROTECT_FRAC     = 0.18
        MOUTH_B_PAD_FRAC       = 0.10
        MOUTH_C_OUTER_PAD_FRAC = 0.16
        # Mouth must stay below eyes; this kills occasional landmark spikes into eye area.
        MOUTH_MIN_Y_BELOW_EYES_FRAC = 0.12
        MOUTH_B_GATE_RELAX_FRAC = 0.00

        # Alignment â€” face exclusion dilation (keeps expression diffs out of the fit)
        FACE_EXCL_FRAC = 0.18   # how much to dilate the face hull before excluding it
        # ECC refinement settings
        ECC_MAX_ITER = 150
        ECC_EPS      = 1e-5
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        # â”€â”€ Step 1: Background removal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        self.log("1. Removing backgrounds (BiRefNet)...")
        
        base_no_bg_path = os.path.join(OUTPUT_DIR, f"{base_id}_no_bg.webp")
        base_bgra_bytes = self._get_bg_removed_bytes_for_source(base_path, label=f"{base_id}")
        with open(base_no_bg_path, 'wb') as f: f.write(base_bgra_bytes)
        base_img_orig = cv2.imdecode(np.frombuffer(base_bgra_bytes, np.uint8), cv2.IMREAD_UNCHANGED)

        # Handle post-variant only if not "back"
        is_back = "_back" in base_id
        post_img_orig = None
        post_no_bg_path = None
        
        if not is_back:
            post_id = base_id + "_post"
            post_path = os.path.join(OUTPUT_DIR, f"{post_id}.webp")
            post_no_bg_path = os.path.join(OUTPUT_DIR, f"{post_id}_no_bg.webp")
            post_bgra_bytes = self._get_bg_removed_bytes_for_source(post_path, label=f"{post_id}")
            with open(post_no_bg_path, 'wb') as f: f.write(post_bgra_bytes)
            post_img_orig = cv2.imdecode(np.frombuffer(post_bgra_bytes, np.uint8), cv2.IMREAD_UNCHANGED)

        if self.state["config"].get("fit_sprite_to_frame", False):
            base_fit, post_fit, fit_info = self.fit_smaller_sprite_to_frame(base_img_orig, None if is_back else post_img_orig)
            if fit_info.get("applied"):
                self.log(
                    "1.25 Fit sprite to frame: "
                    f"scale={fit_info['scale']:.3f}, offset={fit_info['offset']}, "
                    f"padding={fit_info['target_padding']}."
                )
                base_img_orig = base_fit
                if not is_back:
                    post_img_orig = post_fit

                def encode_bgra_webp(img_bgra):
                    rgba = cv2.cvtColor(img_bgra, cv2.COLOR_BGRA2RGBA)
                    buf = io.BytesIO()
                    Image.fromarray(rgba, "RGBA").save(buf, "WEBP", lossless=True, quality=95)
                    return buf.getvalue()

                base_bgra_bytes = encode_bgra_webp(base_img_orig)
                with open(base_no_bg_path, 'wb') as f: f.write(base_bgra_bytes)
                if not is_back:
                    post_bgra_bytes = encode_bgra_webp(post_img_orig)
                    with open(post_no_bg_path, 'wb') as f: f.write(post_bgra_bytes)
            else:
                self.log(f"1.25 Fit sprite to frame skipped: {fit_info.get('reason', 'unknown')}.")
        # --- Upscale Step ---
        if self.state["config"].get("upscale_4x"):
            self.log("1.5 Upscaling 4x (Real-ESRGAN Anime)...")
            base_img = self._get_upscaled_bgra_for_bg_bytes(base_bgra_bytes, base_img_orig, label=f"{base_id}")
            cv2.imwrite(base_no_bg_path, base_img)
            
            if not is_back:
                post_img = self._get_upscaled_bgra_for_bg_bytes(post_bgra_bytes, post_img_orig, label=f"{post_id}")
                cv2.imwrite(post_no_bg_path, post_img)
            
            upscale_factor = 4.0
        else:
            base_img = base_img_orig.copy()
            post_img = None if is_back else post_img_orig.copy()
            upscale_factor = 1.0

        h, w = base_img.shape[:2]
        
        # â”€â”€ Step 2: Facial Processing (Skip for "back" angle) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if is_back:
            self.log("2-5. Exporting processed 'back' angle sprite...")
            final_path = os.path.join(FINAL_DIR, f"{base_id}.webp")
            cv2.imwrite(final_path, base_img)
            if self.state["config"].get("compress_final_webp", False):
                self.compress_final_webp(final_path, final_path)
            return

        self.log("2. Detecting landmarks (used for mask shapes only)...")
        try:
            base_pts, base_bgr = self.extract_28_landmarks(base_img, base_id)
        except Exception as e:
            self.log(f"   Base landmark detection failed; using manual full-canvas overlay fallback: {e}")
            self.handle_no_landmark_manual_process(base_id, post_id, base_img, post_img, base_img_orig, upscale_factor)
            return

        try:
            post_pts, post_bgr = self.extract_28_landmarks(post_img, post_id)
        except Exception as e:
            face_width = np.linalg.norm(base_pts[0] - base_pts[4])
            self.log(f"   Post landmark detection failed; using base-landmark eye fallback + manual mouth: {e}")
            eyes_seed = np.zeros((h, w), dtype=np.uint8)
            for eye_idxs in (LEFT_EYE_ONLY_IDX, RIGHT_EYE_ONLY_IDX):
                eye_pts = base_pts[eye_idxs]
                if len(eye_pts) >= 3:
                    cv2.fillConvexPoly(eyes_seed, cv2.convexHull(eye_pts.astype(np.int32)), 255)
            # Keep the post-face fallback conservative: this seed should catch the
            # closed-eye strokes, not surrounding eyelid/cheek colors.
            eye_pad = max(2, int(face_width * 0.075))
            if cv2.countNonZero(eyes_seed) > 0:
                k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (eye_pad * 2 + 1, eye_pad * 2 + 1))
                eyes_seed = cv2.dilate(eyes_seed, k)
            region_init_masks = {
                "Eyes": (eyes_seed.astype(np.float32) / 255.0),
                "Mouth": np.zeros((h, w), dtype=np.float32),
            }
            self.handle_no_landmark_manual_process(
                base_id,
                post_id,
                base_img,
                post_img,
                base_img_orig,
                upscale_factor,
                region_init_masks=region_init_masks,
                region_default_tools={"Eyes": "Erase", "Mouth": "Restore"},
                fallback_label="Post-Face",
            )
            return
        face_width = np.linalg.norm(base_pts[0] - base_pts[4])

        self.log("   -> Saving _debug_landmarks.jpg...")
        debug_img = np.concatenate((base_bgr, post_bgr), axis=1)
        for i, pt in enumerate(base_pts):
            cv2.circle(debug_img, (int(pt[0]), int(pt[1])), 3, (0,255,0), -1)
            cv2.putText(debug_img, str(i), (int(pt[0])+2, int(pt[1])), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255,255,0), 1)
        for i, pt in enumerate(post_pts):
            ox = int(pt[0]) + base_bgr.shape[1]
            cv2.circle(debug_img, (ox, int(pt[1])), 3, (0,0,255), -1)
            cv2.putText(debug_img, str(i), (ox+2, int(pt[1])), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255,255,0), 1)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_landmarks.jpg"), debug_img)
        self.save_numbered_landmark_debug(base_id, base_bgr, post_bgr, base_pts, post_pts, face_width)

        # â”€â”€ Step 3: 2-Stage Alignment (Rigid + Precision Silhouette Snap) â”€â”€â”€â”€â”€â”€
        use_alignment_warping = self.state["config"].get("use_alignment_warping", True)
        if use_alignment_warping:
            self.log("3. Stage 1: Global Rigid Align...")
        else:
            self.log("3. Alignment/warping disabled: using post image as-is before mask compositing.")

        # 3a. Standard Rigid Alignment (AKAZE)
        if use_alignment_warping:
            base_gray = cv2.cvtColor(base_img[:, :, :3], cv2.COLOR_BGR2GRAY)
            post_gray = cv2.cvtColor(post_img[:, :, :3], cv2.COLOR_BGR2GRAY)
            
            # Focus on hair/body, ignore facial features for the base match
            excl_px = max(5, int(face_width * FACE_EXCL_FRAC))
            face_hull = cv2.convexHull(base_pts.astype(np.int32))
            face_bin = np.zeros((h, w), dtype=np.uint8)
            cv2.fillConvexPoly(face_bin, face_hull, 255)
            face_excl = cv2.dilate(face_bin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (excl_px*2+1, excl_px*2+1)))
            
            anchor_mask = np.zeros((h, w), dtype=np.uint8)
            anchor_mask[(base_img[:,:,3] > 128) & (face_excl == 0)] = 255

            akaze = cv2.AKAZE_create()
            kp1, des1 = akaze.detectAndCompute(base_gray, anchor_mask)
            kp2, des2 = akaze.detectAndCompute(post_gray, None)
            
            post_rigid = post_img.copy()
            M = np.eye(2, 3, dtype=np.float32)
            rigid_before = self._alpha_alignment_metrics(base_img[:, :, 3], post_img[:, :, 3])
            rigid_reason = "identity"
            if des1 is not None and des2 is not None:
                bf = cv2.BFMatcher(cv2.NORM_HAMMING)
                matches = bf.knnMatch(des2, des1, k=2)
                good = [m for m, n in matches if m.distance < 0.75 * n.distance]
                if len(good) > 10:
                    src_pts = np.float32([kp2[m.queryIdx].pt for m in good]).reshape(-1,1,2)
                    dst_pts = np.float32([kp1[m.trainIdx].pt for m in good]).reshape(-1,1,2)
                    M_try, inliers = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.RANSAC)
                    inlier_count = int(np.count_nonzero(inliers)) if inliers is not None else 0
                    inlier_ratio = float(inlier_count) / float(max(1, len(good)))
                    matrix_ok, matrix_reason = self._affine_matrix_is_safe(M_try, face_width, w, h)
                    if inlier_count >= 8 and inlier_ratio >= 0.35 and matrix_ok:
                        candidate = cv2.warpAffine(post_img, M_try.astype(np.float32), (w, h), borderMode=cv2.BORDER_CONSTANT)
                        rigid_after = self._alpha_alignment_metrics(base_img[:, :, 3], candidate[:, :, 3])
                        worse_mean = rigid_after["mean"] > rigid_before["mean"] * 1.12
                        worse_iou = rigid_after["iou"] + 0.04 < rigid_before["iou"]
                        if not (worse_mean or worse_iou):
                            M = M_try.astype(np.float32)
                            post_rigid = candidate
                            rigid_reason = f"accepted matches={len(good)} inliers={inlier_count}/{len(good)}"
                        else:
                            rigid_reason = (
                                f"rejected shape score mean {rigid_before['mean']:.2f}->{rigid_after['mean']:.2f}, "
                                f"iou {rigid_before['iou']:.3f}->{rigid_after['iou']:.3f}"
                            )
                    else:
                        rigid_reason = f"rejected matrix/inliers ({matrix_reason}, inliers={inlier_count}/{len(good)})"
                else:
                    rigid_reason = f"too_few_matches:{len(good)}"
            else:
                rigid_reason = "missing_descriptors"
            self.log(f"   Global rigid align {rigid_reason}.")
            self.log("   Stage 2: Precision Silhouette Snap (Normalized Nudge)...")
        else:
            post_rigid = post_img.copy()

        # 3b. Stage 2: Precision Nudge
        base_alpha = base_img[:, :, 3]
        rigid_alpha = post_rigid[:, :, 3]
        
        cnt_base, _ = cv2.findContours(base_alpha, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cnt_rigid, _ = cv2.findContours(rigid_alpha, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        
        post_aligned = post_rigid
        if use_alignment_warping and cnt_base and cnt_rigid:
            c_base_cnt = max(cnt_base, key=cv2.contourArea)
            c_rigid_cnt = max(cnt_rigid, key=cv2.contourArea)
            c_base = c_base_cnt.reshape(-1, 2)
            c_rigid = c_rigid_cnt.reshape(-1, 2)
            rigid_metrics = self._alpha_alignment_metrics(base_alpha, rigid_alpha)
            snap_reject = None

            base_area = float(max(1.0, cv2.contourArea(c_base_cnt)))
            rigid_area = float(max(1.0, cv2.contourArea(c_rigid_cnt)))
            area_ratio = rigid_area / base_area
            bx, by, bw_box, bh_box = cv2.boundingRect(c_base_cnt)
            rx, ry, rw_box, rh_box = cv2.boundingRect(c_rigid_cnt)
            width_ratio = float(rw_box) / float(max(1, bw_box))
            height_ratio = float(rh_box) / float(max(1, bh_box))
            if area_ratio < 0.55 or area_ratio > 1.65:
                snap_reject = f"area_ratio:{area_ratio:.2f}"
            elif width_ratio < 0.60 or width_ratio > 1.55 or height_ratio < 0.60 or height_ratio > 1.55:
                snap_reject = f"bbox_ratio:{width_ratio:.2f}x{height_ratio:.2f}"
            elif rigid_metrics["iou"] < 0.28:
                snap_reject = f"low_rigid_iou:{rigid_metrics['iou']:.3f}"

            if snap_reject is None:
                dx_map = np.zeros((h, w), dtype=np.float32)
                dy_map = np.zeros((h, w), dtype=np.float32)
                weight_map = np.zeros((h, w), dtype=np.float32)

                step = max(1, len(c_rigid) // 150)
                sample_count = 0
                for i in range(0, len(c_rigid), step):
                    p_rigid = c_rigid[i].astype(np.float32)
                    dists = np.linalg.norm(c_base - p_rigid, axis=1)
                    idx = np.argmin(dists)
                    p_base = c_base[idx].astype(np.float32)

                    if dists[idx] < face_width * 1.5:
                        v_weight = np.clip(1.2 - (p_rigid[1] / (h * 0.8)), 0, 1)
                        vec = (p_base - p_rigid) * v_weight
                        ix, iy = int(p_rigid[0]), int(p_rigid[1])
                        if 0 <= ix < w and 0 <= iy < h:
                            dx_map[iy, ix] = vec[0]
                            dy_map[iy, ix] = vec[1]
                            weight_map[iy, ix] = 1.0
                            sample_count += 1

                if sample_count < 20:
                    snap_reject = f"too_few_vectors:{sample_count}"
                else:
                    blur_size = max(3, int(face_width * 1.2) | 1)
                    dx_sum = cv2.GaussianBlur(dx_map, (blur_size, blur_size), 0)
                    dy_sum = cv2.GaussianBlur(dy_map, (blur_size, blur_size), 0)
                    w_sum = cv2.GaussianBlur(weight_map, (blur_size, blur_size), 0)
                    w_sum[w_sum < 1e-5] = 1e-5

                    final_dx = dx_sum / w_sum
                    final_dy = dy_sum / w_sum
                    dist_to_char = cv2.distanceTransform((rigid_alpha == 0).astype(np.uint8), cv2.DIST_L2, 5)
                    influence = np.clip(1.0 - (dist_to_char / (face_width * 1.0)), 0, 1)
                    final_dx *= influence
                    final_dy *= influence

                    safe, safe_reason, flow_stats = self._dense_displacement_is_safe(final_dx, final_dy, (rigid_alpha > 16).astype(np.uint8) * 255, face_width, "silhouette_snap")
                    if not safe:
                        snap_reject = safe_reason
                    else:
                        grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
                        map_x = (grid_x - final_dx).astype(np.float32)
                        map_y = (grid_y - final_dy).astype(np.float32)
                        candidate = cv2.remap(post_rigid, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                        snap_metrics = self._alpha_alignment_metrics(base_alpha, candidate[:, :, 3])
                        improves_mean = snap_metrics["mean"] <= rigid_metrics["mean"] * 0.97
                        improves_iou = snap_metrics["iou"] >= rigid_metrics["iou"] + 0.02
                        worsens_p95 = snap_metrics["p95"] > rigid_metrics["p95"] * 1.08
                        worsens_iou = snap_metrics["iou"] + 0.02 < rigid_metrics["iou"]
                        if (improves_mean or improves_iou) and not (worsens_p95 or worsens_iou):
                            post_aligned = candidate
                            self.log(
                                "   Precision edge-snap accepted: "
                                f"mean {rigid_metrics['mean']:.2f}->{snap_metrics['mean']:.2f}, "
                                f"iou {rigid_metrics['iou']:.3f}->{snap_metrics['iou']:.3f}, "
                                f"flow p95={flow_stats.get('p95', 0.0):.2f}."
                            )
                        else:
                            snap_reject = (
                                f"no_shape_improvement mean {rigid_metrics['mean']:.2f}->{snap_metrics['mean']:.2f}, "
                                f"iou {rigid_metrics['iou']:.3f}->{snap_metrics['iou']:.3f}"
                            )

            if snap_reject is not None:
                self.log(f"   Precision edge-snap skipped: {snap_reject}.")

        # â”€â”€ Debug: save warp results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_post_aligned.webp"), post_aligned)
        
        diff = cv2.absdiff(base_img[:,:,:3], post_aligned[:,:,:3])
        diff_boosted = np.clip(diff.astype(np.float32) * 5, 0, 255).astype(np.uint8)
        diff_color = cv2.applyColorMap(cv2.cvtColor(diff_boosted, cv2.COLOR_BGR2GRAY), cv2.COLORMAP_JET)
        
        # Base | Before Nudge | After Nudge | Precision Heatmap
        debug_warp = np.hstack([base_img[:,:,:3], post_rigid[:,:,:3], post_aligned[:,:,:3], diff_color])
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_warp.jpg"), debug_warp)

        # â”€â”€ Step 4: Mask Initialization (Landmarks + Hidden Eye Detection) â”€â”€â”€â”€â”€
        def fill_hull_binary(pts_subset):
            out = np.zeros((h, w), dtype=np.uint8)
            if pts_subset is not None and len(pts_subset) >= 3:
                cv2.fillConvexPoly(out, cv2.convexHull(pts_subset.astype(np.int32)), 255)
            return out

        def fill_poly_binary(pts_ordered):
            out = np.zeros((h, w), dtype=np.uint8)
            if pts_ordered is not None and len(pts_ordered) >= 3:
                cv2.fillPoly(out, [pts_ordered.astype(np.int32)], 255)
            return out

        def dilate_binary(bin_u8, pad_px):
            if pad_px <= 0:
                return bin_u8.copy()
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad_px * 2 + 1, pad_px * 2 + 1))
            return cv2.dilate(bin_u8, k)

        eye_b_pad = max(1, int(face_width * EYE_B_PAD_FRAC))
        mouth_b_pad = max(1, int(face_width * MOUTH_B_PAD_FRAC))

        eye_c_pad = max(2, int(face_width * EYE_C_OUTER_PAD_FRAC))
        mouth_c_pad = max(2, int(face_width * MOUTH_C_OUTER_PAD_FRAC))

        # Hidden eye detection on immediate eye cores (A).
        left_eye_core_pts = base_pts[LEFT_EYE_ONLY_IDX]
        right_eye_core_pts = base_pts[RIGHT_EYE_ONLY_IDX]
        def get_eye_spread(pts):
            if len(pts) < 2:
                return 0.0
            return float(np.linalg.norm(np.max(pts, axis=0) - np.min(pts, axis=0)))
        spread_l = get_eye_spread(left_eye_core_pts)
        spread_r = get_eye_spread(right_eye_core_pts)
        use_left, use_right = True, True
        if spread_l < 0.35 * spread_r and spread_r > face_width * 0.1:
            use_left = False
        elif spread_r < 0.35 * spread_l and spread_l > face_width * 0.1:
            use_right = False

        # A masks
        eye_a_left = fill_hull_binary(left_eye_core_pts)
        eye_a_right = fill_hull_binary(right_eye_core_pts)
        if not use_left:
            eye_a_left.fill(0)
        if not use_right:
            eye_a_right.fill(0)
        eyes_a = np.maximum(eye_a_left, eye_a_right)

        # Hard eye-protection zone so mouth mask can never leak into eyes.
        eye_protect_pad = max(1, int(face_width * EYE_PROTECT_FRAC))
        eye_protect = dilate_binary(eyes_a, eye_protect_pad)

        def build_point23_nose_protect():
            nose_ink = np.zeros((h, w), dtype=np.uint8)
            nose_guard = np.zeros((h, w), dtype=np.uint8)
            if len(base_pts) <= 23:
                return nose_guard, nose_ink, {"reason": "missing_point_23"}

            p23 = base_pts[23].astype(np.float32)
            cx = int(np.clip(round(float(p23[0])), 0, w - 1))
            cy = int(np.clip(round(float(p23[1])), 0, h - 1))
            rx = max(8, int(face_width * 0.16))
            ry = max(8, int(face_width * 0.18))
            x0 = max(0, cx - rx)
            y0 = max(0, cy - ry)
            x1 = min(w, cx + rx + 1)
            y1 = min(h, cy + ry + 1)
            if x1 <= x0 or y1 <= y0:
                return nose_guard, nose_ink, {"reason": "empty_roi"}

            roi_bgra = base_img[y0:y1, x0:x1]
            roi_bgr = roi_bgra[:, :, :3]
            roi_alpha = roi_bgra[:, :, 3]
            yy, xx = np.indices((y1 - y0, x1 - x0), dtype=np.float32)
            dx = xx + x0 - float(cx)
            dy = yy + y0 - float(cy)
            norm_dist = np.sqrt((dx / float(rx)) ** 2 + (dy / float(ry)) ** 2)

            b = roi_bgr[:, :, 0].astype(np.float32)
            g = roi_bgr[:, :, 1].astype(np.float32)
            r = roi_bgr[:, :, 2].astype(np.float32)
            luma = (0.114 * b) + (0.587 * g) + (0.299 * r)
            spread = np.maximum.reduce([b, g, r]) - np.minimum.reduce([b, g, r])
            roi_lab = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

            skin_sample = (
                (roi_alpha > 16)
                & (norm_dist < 0.95)
                & (norm_dist > 0.18)
                & (luma > 76.0)
                & (luma < 250.0)
                & (spread < 105.0)
                & (r >= (b - 12.0))
            )
            if int(np.count_nonzero(skin_sample)) < 80:
                skin_sample = (
                    (roi_alpha > 16)
                    & (norm_dist < 0.95)
                    & (luma > 70.0)
                    & (luma < 252.0)
                    & (spread < 120.0)
                )
            if int(np.count_nonzero(skin_sample)) < 40:
                return nose_guard, nose_ink, {"reason": "not_enough_skin"}

            skin_lab = np.median(roi_lab[skin_sample], axis=0).astype(np.float32)
            skin_delta = np.linalg.norm(roi_lab - skin_lab.reshape(1, 1, 3), axis=2)
            search = (roi_alpha > 16) & (norm_dist < 1.0)
            non_skin = (
                search
                & (
                    (skin_delta > 24.0)
                    | (luma < 82.0)
                    | ((spread > 92.0) & (luma < 190.0))
                )
            )
            non_skin = cv2.morphologyEx(
                non_skin.astype(np.uint8) * 255,
                cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
            ) > 0

            n_labels, labels_cc, stats, centroids = cv2.connectedComponentsWithStats(
                non_skin.astype(np.uint8), 8
            )
            kept = np.zeros_like(non_skin, dtype=bool)
            max_area = max(80, int(face_width * face_width * 0.020))
            max_dim = max(14, int(face_width * 0.24))
            center_touch_r = max(6.0, face_width * 0.105)
            for lab in range(1, n_labels):
                area = int(stats[lab, cv2.CC_STAT_AREA])
                if area < 3 or area > max_area:
                    continue
                w_cc = int(stats[lab, cv2.CC_STAT_WIDTH])
                h_cc = int(stats[lab, cv2.CC_STAT_HEIGHT])
                if max(w_cc, h_cc) > max_dim:
                    continue
                comp = labels_cc == lab
                comp_y, comp_x = np.where(comp)
                if len(comp_x) == 0:
                    continue
                min_dist = float(np.min(np.hypot((comp_x + x0) - cx, (comp_y + y0) - cy)))
                cdist = math.hypot(float(centroids[lab][0] + x0 - cx), float(centroids[lab][1] + y0 - cy))
                if min_dist <= center_touch_r or cdist <= max(rx, ry) * 0.58:
                    kept |= comp

            if not np.any(kept):
                cv2.circle(nose_guard, (cx, cy), max(3, int(face_width * 0.035)), 255, -1)
                return nose_guard, nose_ink, {"reason": "fallback_point23", "islands": 0}

            nose_ink[y0:y1, x0:x1] = (kept.astype(np.uint8) * 255)
            pad = max(3, int(face_width * 0.050))
            nose_guard = cv2.dilate(
                nose_ink,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1)),
            )
            return nose_guard, nose_ink, {
                "reason": "ok",
                "islands": int(cv2.connectedComponents(kept.astype(np.uint8), connectivity=8)[0] - 1),
                "skin_samples": int(np.count_nonzero(skin_sample)),
                "ink_px": int(np.count_nonzero(nose_ink)),
                "guard_px": int(np.count_nonzero(nose_guard)),
            }

        point23_nose_protect, point23_nose_ink, point23_nose_info = build_point23_nose_protect()
        nose_protect = np.zeros((h, w), dtype=np.uint8)
        used_point23_nose = cv2.countNonZero(point23_nose_protect) > 0
        if used_point23_nose:
            nose_protect = point23_nose_protect.copy()
            self.log(
                "   Point-23 nose protect: "
                f"{point23_nose_info.get('reason', 'n/a')}, "
                f"islands={point23_nose_info.get('islands', 0)}, "
                f"ink={point23_nose_info.get('ink_px', 0)}, "
                f"guard={point23_nose_info.get('guard_px', cv2.countNonZero(nose_protect))}."
            )
        elif len(base_pts) > 16:
            nose_pts = base_pts[[14, 15, 16]].astype(np.int32)
            cv2.polylines(nose_protect, [nose_pts], False, 255, max(2, int(face_width * 0.060)))
            for npt in nose_pts:
                cv2.circle(nose_protect, (int(npt[0]), int(npt[1])), max(2, int(face_width * 0.075)), 255, -1)
            cx = int(np.clip(round(np.mean(nose_pts[:, 0])), 0, w - 1))
            nose_top_y = int(np.min(nose_pts[:, 1]))
            nose_tip_y = int(np.max(nose_pts[:, 1]))
            up_ext = max(2, int(face_width * 0.13))
            down_ext = max(2, int(face_width * 0.13))
            y0_n = int(np.clip(nose_top_y - up_ext, 0, h - 1))
            y1_n = int(np.clip(nose_tip_y + down_ext, 0, h - 1))
            ry = max(2, int((y1_n - y0_n) * 0.5))
            rx = max(2, int(face_width * 0.095))
            cv2.ellipse(nose_protect, (cx, (y0_n + y1_n) // 2), (rx, ry), 0, 0, 360, 255, -1)
            nose_protect = dilate_binary(nose_protect, max(1, int(face_width * 0.065)))
            self.log(f"   Point-23 nose protect fallback: {point23_nose_info.get('reason', 'n/a')}; using 14-16 geometry.")

        # Hard lower-face gate for mouth: rejects bad landmark jumps into eye area.
        eye_core_pts = np.vstack([left_eye_core_pts, right_eye_core_pts]).astype(np.float32)
        eyes_max_y = float(np.max(eye_core_pts[:, 1])) if len(eye_core_pts) > 0 else float(h * 0.35)
        nose_y = float(base_pts[16][1]) if len(base_pts) > 16 else eyes_max_y
        mouth_gate_y = int(max(eyes_max_y + face_width * MOUTH_MIN_Y_BELOW_EYES_FRAC, nose_y + face_width * 0.03))
        mouth_gate_y = int(np.clip(mouth_gate_y, 0, h - 1))
        nose_stop_y = int(np.clip(mouth_gate_y - face_width * 0.05, 0, h - 1))
        if not used_point23_nose:
            nose_protect[nose_stop_y:, :] = 0

        lower_face_gate = np.zeros((h, w), dtype=np.uint8)
        lower_face_gate[mouth_gate_y:, :] = 255

        mouth_a_raw = fill_poly_binary(base_pts[MOUTH_CORE_IDX])
        mouth_gate_drop_a = cv2.countNonZero(cv2.bitwise_and(mouth_a_raw, cv2.bitwise_not(lower_face_gate)))
        mouth_a_raw = cv2.bitwise_and(mouth_a_raw, lower_face_gate)
        if mouth_gate_drop_a > 0:
            self.log(f"   Mouth lower-face gate (A): removed {mouth_gate_drop_a} px above y={mouth_gate_y}.")
        mouth_a_overlap = cv2.countNonZero(cv2.bitwise_and(mouth_a_raw, eye_protect))
        mouth_a = cv2.bitwise_and(mouth_a_raw, cv2.bitwise_not(eye_protect))
        if mouth_a_overlap > 0:
            self.log(f"   Eye-protect clip (A): removed {mouth_a_overlap} px from mouth core.")
        mouth_a_nose_overlap = cv2.countNonZero(cv2.bitwise_and(mouth_a, nose_protect))
        if mouth_a_nose_overlap > 0:
            mouth_a = cv2.bitwise_and(mouth_a, cv2.bitwise_not(nose_protect))
            self.log(f"   Nose-protect clip (A): removed {mouth_a_nose_overlap} px from mouth core.")

        # B masks (copy region)
        eyes_b_left = dilate_binary(eye_a_left, eye_b_pad)
        eyes_b_right = dilate_binary(eye_a_right, eye_b_pad)
        blink_nose_protect = np.zeros_like(nose_protect)
        if cv2.countNonZero(nose_protect) > 0:
            if used_point23_nose:
                blink_nose_protect = nose_protect.copy()
            else:
                eye_groups = []
                if use_left and len(left_eye_core_pts) > 0:
                    eye_groups.append(left_eye_core_pts.astype(np.float32))
                if use_right and len(right_eye_core_pts) > 0:
                    eye_groups.append(right_eye_core_pts.astype(np.float32))
                if len(eye_groups) >= 2:
                    eye_groups = sorted(eye_groups, key=lambda pts: float(np.mean(pts[:, 0])))
                    left_group, right_group = eye_groups[0], eye_groups[1]
                    inner_l = float(np.max(left_group[:, 0]))
                    inner_r = float(np.min(right_group[:, 0]))
                    if inner_r > inner_l:
                        lane_pad = max(2, int(face_width * 0.045))
                        x0_lane = int(np.clip(inner_l - lane_pad, 0, w - 1))
                        x1_lane = int(np.clip(inner_r + lane_pad, 0, w - 1))
                    else:
                        cx_lane = int(np.clip(round((np.mean(left_group[:, 0]) + np.mean(right_group[:, 0])) * 0.5), 0, w - 1))
                        lane_half = max(3, int(face_width * 0.055))
                        x0_lane = int(np.clip(cx_lane - lane_half, 0, w - 1))
                        x1_lane = int(np.clip(cx_lane + lane_half, 0, w - 1))
                else:
                    cx_lane = int(np.clip(round(np.mean(base_pts[:5, 0])), 0, w - 1))
                    lane_half = max(3, int(face_width * 0.055))
                    x0_lane = int(np.clip(cx_lane - lane_half, 0, w - 1))
                    x1_lane = int(np.clip(cx_lane + lane_half, 0, w - 1))

                y0_lane = int(np.clip(eyes_max_y - face_width * 0.08, 0, h - 1))
                y1_lane = int(np.clip(nose_stop_y, 0, h - 1))
                if x1_lane > x0_lane and y1_lane > y0_lane:
                    center_lane = np.zeros((h, w), dtype=np.uint8)
                    center_lane[y0_lane:y1_lane + 1, x0_lane:x1_lane + 1] = 255
                    blink_nose_protect = cv2.bitwise_and(nose_protect, center_lane)

            eye_core_clear = cv2.bitwise_not(dilate_binary(eyes_a, max(1, int(face_width * 0.035))))
            blink_nose_protect = cv2.bitwise_and(blink_nose_protect, eye_core_clear)

        eyes_nose_overlap = cv2.countNonZero(cv2.bitwise_and(np.maximum(eyes_b_left, eyes_b_right), blink_nose_protect))
        if eyes_nose_overlap > 0:
            nose_clear = cv2.bitwise_not(blink_nose_protect)
            eyes_b_left = cv2.bitwise_and(eyes_b_left, nose_clear)
            eyes_b_right = cv2.bitwise_and(eyes_b_right, nose_clear)
            self.log(f"   Nose-protect clip (Eyes B): removed {eyes_nose_overlap} px from blink copy mask.")
        eyes_b_bin = np.maximum(eyes_b_left, eyes_b_right)
        mouth_b_bin = dilate_binary(mouth_a, mouth_b_pad)
        mouth_gate_y_b = int(np.clip(mouth_gate_y - face_width * MOUTH_B_GATE_RELAX_FRAC, 0, h - 1))
        lower_face_gate_b = np.zeros((h, w), dtype=np.uint8)
        lower_face_gate_b[mouth_gate_y_b:, :] = 255
        mouth_gate_drop_b = cv2.countNonZero(cv2.bitwise_and(mouth_b_bin, cv2.bitwise_not(lower_face_gate_b)))
        if mouth_gate_drop_b > 0:
            mouth_b_bin = cv2.bitwise_and(mouth_b_bin, lower_face_gate_b)
            self.log(f"   Mouth lower-face gate (B): removed {mouth_gate_drop_b} px above y={mouth_gate_y_b}.")
        eye_protect_b = np.maximum(eye_protect, dilate_binary(eyes_b_bin, max(1, int(face_width * 0.08))))
        mouth_b_overlap = cv2.countNonZero(cv2.bitwise_and(mouth_b_bin, eye_protect_b))
        if mouth_b_overlap > 0:
            mouth_b_bin = cv2.bitwise_and(mouth_b_bin, cv2.bitwise_not(eye_protect_b))
            self.log(f"   Eye-protect clip (B): removed {mouth_b_overlap} px from mouth copy mask.")
        mouth_b_nose_overlap = cv2.countNonZero(cv2.bitwise_and(mouth_b_bin, nose_protect))
        if mouth_b_nose_overlap > 0:
            mouth_b_bin = cv2.bitwise_and(mouth_b_bin, cv2.bitwise_not(nose_protect))
            self.log(f"   Nose-protect clip (B): removed {mouth_b_nose_overlap} px from mouth copy mask.")
        eyes_mask_f = (eyes_b_bin > 0).astype(np.float32)
        mouth_mask_f = (mouth_b_bin > 0).astype(np.float32)
        self.log(f"   Hard cutout mode: eyes(B={cv2.countNonZero(eyes_b_bin)}), mouth(B={cv2.countNonZero(mouth_b_bin)}).")

        # C masks (fingerprint donut = dilate(B) - B)
        eyes_c = cv2.subtract(dilate_binary(eyes_b_bin, eye_c_pad), eyes_b_bin)
        mouth_c = cv2.subtract(dilate_binary(mouth_b_bin, mouth_c_pad), mouth_b_bin)

        self.log(
            f"   A/B/C masks ready: eyes(B={cv2.countNonZero(eyes_b_bin)}, C={cv2.countNonZero(eyes_c)}), "
            f"mouth(B={cv2.countNonZero(mouth_b_bin)}, C={cv2.countNonZero(mouth_c)})."
        )

        # Optional skin-tone normalization:
        # Estimate mouth-adjacent skin tone in A and B, then softly shift B skin toward A.
        def detect_skin_mask(img_bgra, valid_mask_u8=None):
            bgr = img_bgra[:, :, :3]
            alpha = img_bgra[:, :, 3]
            ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
            y = ycrcb[:, :, 0]
            cr = ycrcb[:, :, 1]
            cb = ycrcb[:, :, 2]

            skin = (
                (alpha > 20)
                & (y > 20)
                & (cr >= 118) & (cr <= 190)
                & (cb >= 76) & (cb <= 150)
            )
            if valid_mask_u8 is not None:
                skin &= (valid_mask_u8 > 0)
            return skin

        def estimate_dominant_skin_bgr(img_bgra, sample_mask_u8):
            if sample_mask_u8 is None:
                return None, 0, 0

            alpha_valid = (img_bgra[:, :, 3] > 20) & (sample_mask_u8 > 0)
            valid_count = int(np.count_nonzero(alpha_valid))
            if valid_count < 40:
                return None, valid_count, 0

            skin_mask = detect_skin_mask(img_bgra, sample_mask_u8)
            skin_count = int(np.count_nonzero(skin_mask))
            use_mask = skin_mask if skin_count >= 60 else alpha_valid
            use_count = int(np.count_nonzero(use_mask))
            if use_count < 30:
                return None, use_count, skin_count

            pixels = img_bgra[:, :, :3][use_mask].astype(np.uint8)
            if pixels.size == 0:
                return None, use_count, skin_count

            # Robust central skin tone (trimmed median around the channel-wise median).
            p = pixels.astype(np.float32)
            med = np.median(p, axis=0)
            dev = np.sum(np.abs(p - med), axis=1)
            keep = dev <= np.percentile(dev, 65.0)
            core = p[keep] if np.any(keep) else p
            tone = np.median(core, axis=0).astype(np.float32)
            return tone, use_count, skin_count

        def normalize_skin_tone_by_mouth_context(base_bgra, src_bgra, mouth_sample_mask_u8, focus_mask_u8, fw):
            tone_a, a_count, a_skin = estimate_dominant_skin_bgr(base_bgra, mouth_sample_mask_u8)
            tone_b, b_count, b_skin = estimate_dominant_skin_bgr(src_bgra, mouth_sample_mask_u8)
            if tone_a is None or tone_b is None:
                return src_bgra, {
                    "applied": False,
                    "reason": "insufficient_samples",
                    "a_count": int(a_count),
                    "b_count": int(b_count),
                    "a_skin": int(a_skin),
                    "b_skin": int(b_skin),
                }

            a_lab = cv2.cvtColor(np.uint8([[np.clip(tone_a, 0, 255)]]), cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
            b_lab = cv2.cvtColor(np.uint8([[np.clip(tone_b, 0, 255)]]), cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
            delta = a_lab - b_lab
            delta_bgr = tone_a - tone_b

            # Keep shifts subtle but allow tiny corrections too (1-step RGB mismatch matters here).
            delta[0] = np.clip(delta[0], -14.0, 14.0)
            delta[1] = np.clip(delta[1], -11.0, 11.0)
            delta[2] = np.clip(delta[2], -11.0, 11.0)
            if float(np.linalg.norm(delta)) < 0.20 and float(np.max(np.abs(delta_bgr))) < 0.25:
                return src_bgra, {
                    "applied": False,
                    "reason": "already_close",
                    "delta": delta,
                    "delta_bgr": delta_bgr,
                    "a_count": int(a_count),
                    "b_count": int(b_count),
                    "a_skin": int(a_skin),
                    "b_skin": int(b_skin),
                }

            skin_src = detect_skin_mask(src_bgra)
            skin_pixels = int(np.count_nonzero(skin_src))
            if skin_pixels < 120:
                skin_src = ((src_bgra[:, :, 3] > 20) & ((focus_mask_u8 > 0) | (mouth_sample_mask_u8 > 0)))

            focus_pad = max(2, int(float(fw) * 0.14))
            focus_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (focus_pad * 2 + 1, focus_pad * 2 + 1))
            focus_d = cv2.dilate(focus_mask_u8, focus_kernel)
            ring_pad = max(1, int(float(fw) * 0.05))
            ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring_pad * 2 + 1, ring_pad * 2 + 1))
            mouth_ring_focus = cv2.dilate(mouth_sample_mask_u8, ring_kernel)

            weight = np.zeros((src_bgra.shape[0], src_bgra.shape[1]), dtype=np.float32)
            weight[skin_src] = 0.45
            m_focus = np.logical_and(skin_src, focus_d > 0)
            weight[m_focus] = np.maximum(weight[m_focus], 0.85)
            m_ring = np.logical_and(skin_src, mouth_ring_focus > 0)
            weight[m_ring] = 1.0
            weight = cv2.GaussianBlur(weight, (0, 0), 0.95)
            weight *= (src_bgra[:, :, 3].astype(np.float32) / 255.0)

            if float(np.max(weight)) < 1e-3:
                return src_bgra, {
                    "applied": False,
                    "reason": "no_skin_weight",
                    "delta": delta,
                    "a_count": int(a_count),
                    "b_count": int(b_count),
                    "a_skin": int(a_skin),
                    "b_skin": int(b_skin),
                }

            lab = cv2.cvtColor(src_bgra[:, :, :3], cv2.COLOR_BGR2LAB).astype(np.float32)
            lab[:, :, 0] = np.clip(lab[:, :, 0] + delta[0] * weight, 0.0, 255.0)
            lab[:, :, 1] = np.clip(lab[:, :, 1] + delta[1] * weight, 0.0, 255.0)
            lab[:, :, 2] = np.clip(lab[:, :, 2] + delta[2] * weight, 0.0, 255.0)

            bgr_new = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
            out = src_bgra.copy()
            apply_mask = weight > 1e-3
            out[:, :, :3][apply_mask] = bgr_new[apply_mask]

            # Pass 2: residual micro-correction in BGR to lock mouth-adjacent tone closer to A.
            tone_after, _, _ = estimate_dominant_skin_bgr(out, mouth_sample_mask_u8)
            residual = np.zeros(3, dtype=np.float32)
            residual_applied = False
            if tone_after is not None:
                residual = (tone_a - tone_after).astype(np.float32)
                if float(np.max(np.abs(residual))) >= 0.35:
                    w2 = np.zeros((out.shape[0], out.shape[1]), dtype=np.float32)
                    alpha_ok = out[:, :, 3] > 20
                    m2_ring = np.logical_and(alpha_ok, mouth_ring_focus > 0)
                    w2[m2_ring] = 1.0
                    m2_focus = np.logical_and(alpha_ok, focus_d > 0)
                    w2[m2_focus] = np.maximum(w2[m2_focus], 0.65)
                    w2 = cv2.GaussianBlur(w2, (0, 0), 0.80)
                    bgr_f = out[:, :, :3].astype(np.float32)
                    for ch in range(3):
                        bgr_f[:, :, ch] = np.clip(bgr_f[:, :, ch] + (residual[ch] * w2), 0.0, 255.0)
                    out[:, :, :3] = bgr_f.astype(np.uint8)
                    residual_applied = True

            return out, {
                "applied": True,
                "delta": delta,
                "delta_bgr": delta_bgr,
                "residual": residual,
                "residual_applied": residual_applied,
                "a_count": int(a_count),
                "b_count": int(b_count),
                "a_skin": int(a_skin),
                "b_skin": int(b_skin),
                "weight_px": int(np.count_nonzero(apply_mask)),
                "tone_a": tone_a,
                "tone_b": tone_b,
            }

        if self.state["config"].get("normalize_skin_tone", False):
            mouth_sample_pad = max(2, int(face_width * 0.14))
            mouth_context_ring = cv2.subtract(dilate_binary(mouth_b_bin, mouth_sample_pad), mouth_b_bin)
            mouth_context_ring = cv2.bitwise_and(mouth_context_ring, lower_face_gate_b)
            mouth_context_ring = cv2.bitwise_and(mouth_context_ring, cv2.bitwise_not(eye_protect_b))
            mouth_context_ring = cv2.bitwise_and(mouth_context_ring, cv2.bitwise_not(nose_protect))
            focus_union = mouth_b_bin

            post_aligned, skin_info = normalize_skin_tone_by_mouth_context(
                base_img,
                post_aligned,
                mouth_context_ring,
                focus_union,
                face_width,
            )

            if skin_info.get("applied"):
                d = skin_info.get("delta", np.zeros(3, dtype=np.float32))
                r = skin_info.get("residual", np.zeros(3, dtype=np.float32))
                self.log(
                    "   Skin tone normalize: applied "
                    f"(dL={d[0]:+.2f}, da={d[1]:+.2f}, db={d[2]:+.2f}, "
                    f"resBGR={r[0]:+.2f}/{r[1]:+.2f}/{r[2]:+.2f}, "
                    f"samples A/B={skin_info.get('a_count', 0)}/{skin_info.get('b_count', 0)}, "
                    f"weight_px={skin_info.get('weight_px', 0)})."
                )
            else:
                self.log(
                    "   Skin tone normalize: skipped "
                    f"({skin_info.get('reason', 'n/a')}, samples A/B={skin_info.get('a_count', 0)}/{skin_info.get('b_count', 0)})."
                )

        # Eye-region alpha solidify:
        # Some sprites contain semi-transparent eye pixels, which can produce ring/halo artifacts.
        # We solidify eye region B in BOTH originals and copy source before any manual/final blend.
        def solidify_alpha_in_mask(img_bgra, mask_u8):
            out = img_bgra.copy()
            region = mask_u8 > 0
            if not np.any(region):
                return out, 0, 0, 0

            alpha = out[:, :, 3].astype(np.uint8)
            MIN_ALPHA_SOLIDIFY = 24
            OPAQUE_SEED_ALPHA = 245

            solidifiable = region & (alpha >= MIN_ALPHA_SOLIDIFY)
            semi = solidifiable & (alpha < OPAQUE_SEED_ALPHA)
            dropped_low = int(np.count_nonzero(region & (alpha > 0) & (alpha < MIN_ALPHA_SOLIDIFY)))
            semi_count = int(np.count_nonzero(semi))
            solidified_count = int(np.count_nonzero(solidifiable))
            filled_count = 0

            if semi_count > 0:
                ys, xs = np.where(semi)
                y0, y1 = max(0, int(ys.min()) - 2), min(out.shape[0], int(ys.max()) + 3)
                x0, x1 = max(0, int(xs.min()) - 2), min(out.shape[1], int(xs.max()) + 3)

                roi = out[y0:y1, x0:x1, :].copy()
                semi_roi = semi[y0:y1, x0:x1]
                alpha_roi = alpha[y0:y1, x0:x1]
                region_roi = region[y0:y1, x0:x1]

                # De-matte obvious green spill only on semi-transparent edge pixels.
                rgb_i16 = roi[:, :, :3].astype(np.int16)
                rb_max = np.maximum(rgb_i16[:, :, 0], rgb_i16[:, :, 2])
                green_excess = rgb_i16[:, :, 1] - rb_max
                matte_mask = semi_roi & (green_excess > 10)
                if np.any(matte_mask):
                    rgb_i16[:, :, 1][matte_mask] = np.minimum(
                        rgb_i16[:, :, 1][matte_mask],
                        rb_max[matte_mask] + 6,
                    )
                    roi[:, :, :3] = np.clip(rgb_i16, 0, 255).astype(np.uint8)

                # Fill semi-transparent edge color from nearby opaque pixels in the same region.
                seed_count = int(np.count_nonzero(region_roi & (alpha_roi >= OPAQUE_SEED_ALPHA)))
                if seed_count >= 12:
                    hole = (semi_roi.astype(np.uint8) * 255)
                    for ch in range(3):
                        ch_img = roi[:, :, ch]
                        ch_inp = cv2.inpaint(ch_img, hole, 2, cv2.INPAINT_TELEA)
                        ch_img[semi_roi] = ch_inp[semi_roi]
                        roi[:, :, ch] = ch_img
                    filled_count = semi_count

                out[y0:y1, x0:x1, :3] = roi[:, :, :3]

            if solidified_count > 0:
                alpha_out = out[:, :, 3]
                alpha_out[solidifiable] = 255
                out[:, :, 3] = alpha_out

            return out, semi_count, solidified_count, dropped_low

        base_img, base_eye_semi_count, base_eye_solid_count, base_eye_drop_low = solidify_alpha_in_mask(base_img, eyes_b_bin)
        post_aligned, post_eye_semi_count, post_eye_solid_count, post_eye_drop_low = solidify_alpha_in_mask(post_aligned, eyes_b_bin)

        self.log(
            "   Eye alpha solidify (orig+source): "
            f"base={base_eye_solid_count} px (semi={base_eye_semi_count}, low_drop={base_eye_drop_low}), "
            f"post={post_eye_solid_count} px (semi={post_eye_semi_count}, low_drop={post_eye_drop_low})."
        )

        # Persist the corrected original no_bg sprite so FINAL base copy is also solidified.
        cv2.imwrite(base_no_bg_path, base_img)
        post_copy_src = post_aligned
        post_copy_src_unwarped = post_aligned.copy()

        def save_color_sample_debug_outputs(base_bgra, src_bgra):
            # Rough face sampling points from the user-provided reference marks.
            # Same coordinates are used for both images.
            sample_points_norm = [
                (0.50, 0.08),  # forehead center
                (0.34, 0.22),  # left hairline
                (0.44, 0.31),  # left eye/upper cheek
                (0.56, 0.31),  # right iris/eye zone
                (0.40, 0.40),  # left cheek
                (0.60, 0.40),  # right cheek
                (0.46, 0.50),  # left mouth-adjacent skin
                (0.54, 0.50),  # right mouth-adjacent skin
            ]

            img_h, img_w = base_bgra.shape[:2]
            points = []
            for nx, ny in sample_points_norm:
                px = int(np.clip(round(nx * (img_w - 1)), 0, img_w - 1))
                py = int(np.clip(round(ny * (img_h - 1)), 0, img_h - 1))
                points.append((px, py))

            # Requested re-layout:
            # 1) Move all points up by ~200 px in a 3072x5376 frame.
            # 2) Compress Y span so bottom-most point lands around 900 px from top
            #    for a 5376px image.
            shift_up_px = int(round(200.0 * (img_h / 5376.0)))
            target_bottom_y = int(round(900.0 * (img_h / 5376.0)))
            shifted_y = [py - shift_up_px for _, py in points]
            min_y = min(shifted_y)
            max_y = max(shifted_y)
            if max_y > min_y:
                scale_y = (target_bottom_y - min_y) / float(max_y - min_y)
                scale_y = max(0.05, min(1.0, scale_y))
                remapped = []
                for px, py in points:
                    y_s = py - shift_up_px
                    y_r = int(round(min_y + (y_s - min_y) * scale_y))
                    remapped.append((px, int(np.clip(y_r, 0, img_h - 1))))
                points = remapped
            else:
                points = [(px, int(np.clip(py - shift_up_px, 0, img_h - 1))) for px, py in points]

            # Special handling: points 3 and 5 should try to sit inside eyes
            # when landmarks are available.
            # 28-pt layout (already documented above):
            # left eye: 11,12,13 | right eye: 17,18,19
            if base_pts is not None and len(base_pts) >= 20:
                try:
                    left_eye = np.mean(base_pts[[11, 12, 13], :2], axis=0)
                    right_eye = np.mean(base_pts[[17, 18, 19], :2], axis=0)
                    eye_offset_px = int(round(150.0 * (img_h / 5376.0)))
                    # 1-based points 3 and 5 -> 0-based indices 2 and 4.
                    points[2] = (
                        int(np.clip(round(left_eye[0]), 0, img_w - 1)),
                        int(np.clip(round(left_eye[1] + eye_offset_px), 0, img_h - 1)),
                    )
                    points[4] = (
                        int(np.clip(round(right_eye[0]), 0, img_w - 1)),
                        int(np.clip(round(right_eye[1] - eye_offset_px), 0, img_h - 1)),
                    )
                except Exception:
                    pass

            def sample_colors_bgr(img_bgra, pts):
                bgr = img_bgra[:, :, :3]
                out = []
                for px, py in pts:
                    out.append(tuple(int(v) for v in bgr[py, px]))
                return out

            def sample_colors_bgra(img_bgra, pts):
                out = []
                for px, py in pts:
                    out.append(tuple(int(v) for v in img_bgra[py, px, :4]))
                return out

            def colors_bgr_to_lab(colors_bgr):
                arr = np.array(colors_bgr, dtype=np.uint8).reshape(-1, 1, 3)
                return cv2.cvtColor(arr, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)

            def color_is_ignored(color_bgra):
                b, g, r, a = [int(v) for v in color_bgra]
                luma = 0.114 * b + 0.587 * g + 0.299 * r
                return a <= 8 or max(b, g, r) <= 12 or luma <= 10.0

            def color_curve_features(lab):
                v = lab.astype(np.float32) / 255.0
                l = v[:, 0]
                a = v[:, 1]
                b = v[:, 2]
                return np.column_stack([
                    np.ones(len(v), dtype=np.float32),
                    l, a, b,
                    l * l, a * a, b * b,
                    l * a, l * b, a * b,
                ]).astype(np.float32)

            def fit_lab_residual_curve(src_lab, target_lab, weights):
                # A small regularized quadratic 3D color curve. The neutral anchors
                # keep the transform smooth between sparse sample points.
                anchor_bgr = np.array([
                    [0, 0, 0], [32, 32, 32], [96, 96, 96], [160, 160, 160],
                    [224, 224, 224], [255, 255, 255],
                    [255, 0, 0], [0, 255, 0], [0, 0, 255],
                    [255, 255, 0], [255, 0, 255], [0, 255, 255],
                ], dtype=np.uint8)
                anchor_lab = cv2.cvtColor(anchor_bgr.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)

                x = color_curve_features(src_lab)
                y = target_lab - src_lab
                x_anchor = color_curve_features(anchor_lab)
                y_anchor = np.zeros((len(anchor_lab), 3), dtype=np.float32)

                x_all = np.vstack([x, x_anchor])
                y_all = np.vstack([y, y_anchor])
                w_all = np.concatenate([
                    weights.astype(np.float32),
                    np.full(len(anchor_lab), 0.45, dtype=np.float32),
                ])

                xw = x_all * np.sqrt(w_all)[:, None]
                yw = y_all * np.sqrt(w_all)[:, None]
                ridge = np.eye(x_all.shape[1], dtype=np.float32) * 0.020
                ridge[0, 0] = 0.004
                return np.linalg.solve(xw.T @ xw + ridge, xw.T @ yw).astype(np.float32)

            def apply_lab_residual_curve(img_bgra, beta):
                out = img_bgra.copy()
                alpha_ok = out[:, :, 3] > 8
                if not np.any(alpha_ok):
                    return out

                lab_img = cv2.cvtColor(out[:, :, :3], cv2.COLOR_BGR2LAB).astype(np.float32)
                flat = lab_img.reshape(-1, 3)
                alpha_flat = alpha_ok.reshape(-1)
                idx = np.flatnonzero(alpha_flat)

                for start in range(0, len(idx), 350000):
                    sel = idx[start:start + 350000]
                    feat = color_curve_features(flat[sel])
                    delta = feat @ beta
                    delta[:, 0] = np.clip(delta[:, 0], -18.0, 18.0)
                    delta[:, 1] = np.clip(delta[:, 1], -16.0, 16.0)
                    delta[:, 2] = np.clip(delta[:, 2], -16.0, 16.0)
                    flat[sel] = np.clip(flat[sel] + delta, 0.0, 255.0)

                out[:, :, :3] = cv2.cvtColor(lab_img.astype(np.uint8), cv2.COLOR_LAB2BGR)
                return out

            def filter_color_pairs(base_samples_bgra, src_samples_bgra):
                valid = []
                ignored = []
                for i, (ca, cb) in enumerate(zip(base_samples_bgra, src_samples_bgra), start=1):
                    if color_is_ignored(ca) or color_is_ignored(cb):
                        ignored.append((i, "black_or_transparent"))
                        continue
                    lab_a = colors_bgr_to_lab([ca[:3]])[0]
                    lab_b = colors_bgr_to_lab([cb[:3]])[0]
                    delta_e = float(np.linalg.norm(lab_a - lab_b))
                    if delta_e > 72.0:
                        ignored.append((i, f"too_different:{delta_e:.1f}"))
                        continue
                    valid.append(i - 1)
                return valid, ignored

            def match_sample_pairs_with_global_curve(base_bgra, src_bgra, pts):
                base_samples = sample_colors_bgra(base_bgra, pts)
                src_samples_initial = sample_colors_bgra(src_bgra, pts)
                valid_idx, ignored = filter_color_pairs(base_samples, src_samples_initial)

                info = {
                    "applied": False,
                    "valid": len(valid_idx),
                    "ignored": ignored,
                    "iterations": 0,
                    "mean_delta_e": None,
                    "max_delta_e": None,
                }
                if len(valid_idx) < 2:
                    info["reason"] = "not_enough_valid_pairs"
                    return src_bgra, info

                target_bgr = [base_samples[i][:3] for i in valid_idx]
                target_lab = colors_bgr_to_lab(target_bgr)
                out = src_bgra.copy()
                best_out = out
                best_mean = float("inf")
                best_max = float("inf")

                for iteration in range(1, 9):
                    current_samples = sample_colors_bgra(out, pts)
                    current_bgr = [current_samples[i][:3] for i in valid_idx]
                    current_lab = colors_bgr_to_lab(current_bgr)
                    errors = np.linalg.norm(target_lab - current_lab, axis=1)
                    mean_err = float(np.mean(errors))
                    max_err = float(np.max(errors))
                    if mean_err < best_mean:
                        best_mean = mean_err
                        best_max = max_err
                        best_out = out.copy()
                    if max_err <= 1.6 or mean_err <= 0.9:
                        break

                    weights = 1.0 / np.maximum(errors, 4.0)
                    weights = weights / max(float(np.max(weights)), 1e-6)
                    beta = fit_lab_residual_curve(current_lab, target_lab, weights)
                    out = apply_lab_residual_curve(out, beta)

                info.update({
                    "applied": True,
                    "iterations": iteration,
                    "mean_delta_e": best_mean,
                    "max_delta_e": best_max,
                })
                return best_out, info

            def build_palette_image(colors_bgr):
                cell = 96
                cols = 4
                rows = 2
                palette = np.zeros((rows * cell, cols * cell, 3), dtype=np.uint8)
                for i, color in enumerate(colors_bgr):
                    row = i // cols
                    col = i % cols
                    x0, y0 = col * cell, row * cell
                    x1, y1 = x0 + cell, y0 + cell
                    palette[y0:y1, x0:x1] = np.array(color, dtype=np.uint8)
                    cv2.rectangle(palette, (x0, y0), (x1 - 1, y1 - 1), (0, 0, 0), 2)
                return palette

            def draw_crosshairs(img_bgra, pts):
                out = img_bgra[:, :, :3].copy()
                marker_size = max(10, int(face_width * 0.10))
                for i, (px, py) in enumerate(pts):
                    cv2.drawMarker(
                        out, (px, py), (255, 255, 255), cv2.MARKER_CROSS, marker_size + 4, 3
                    )
                    cv2.drawMarker(
                        out, (px, py), (0, 0, 255), cv2.MARKER_CROSS, marker_size, 2
                    )
                    cv2.putText(
                        out,
                        str(i + 1),
                        (px + 6, py - 6),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (0, 0, 255),
                        2,
                        cv2.LINE_AA,
                    )
                return out

            color_match_info = {"applied": False, "reason": "disabled"}
            if self.state["config"].get("normalize_skin_tone", False):
                src_bgra, color_match_info = match_sample_pairs_with_global_curve(base_bgra, src_bgra, points)

            base_colors = sample_colors_bgr(base_bgra, points)
            src_colors = sample_colors_bgr(src_bgra, points)

            base_palette_img = build_palette_image(base_colors)
            src_palette_img = build_palette_image(src_colors)
            base_points_img = draw_crosshairs(base_bgra, points)
            src_points_img = draw_crosshairs(src_bgra, points)

            base_palette_path = os.path.join(OUTPUT_DIR, f"{base_id}_debug_samples_palette_base.png")
            src_palette_path = os.path.join(OUTPUT_DIR, f"{base_id}_debug_samples_palette_post.png")
            base_points_path = os.path.join(OUTPUT_DIR, f"{base_id}_debug_samples_points_base.png")
            src_points_path = os.path.join(OUTPUT_DIR, f"{base_id}_debug_samples_points_post.png")

            cv2.imwrite(base_palette_path, base_palette_img)
            cv2.imwrite(src_palette_path, src_palette_img)
            cv2.imwrite(base_points_path, base_points_img)
            cv2.imwrite(src_points_path, src_points_img)

            self.log(
                "   Saved 8-point color sample debug images "
                "(base/post palettes + crosshair overlays)."
            )

            if color_match_info.get("applied"):
                ignored_bits = ", ".join(f"{idx}:{reason}" for idx, reason in color_match_info.get("ignored", [])) or "none"
                self.log(
                    "   8-point color curve: applied "
                    f"(valid={color_match_info.get('valid', 0)}, "
                    f"ignored={len(color_match_info.get('ignored', []))}, "
                    f"iters={color_match_info.get('iterations', 0)}, "
                    f"meanDE={color_match_info.get('mean_delta_e', 0):.2f}, "
                    f"maxDE={color_match_info.get('max_delta_e', 0):.2f}; "
                    f"ignored_pairs={ignored_bits})."
                )
            elif self.state["config"].get("normalize_skin_tone", False):
                ignored_bits = ", ".join(f"{idx}:{reason}" for idx, reason in color_match_info.get("ignored", [])) or "none"
                self.log(
                    "   8-point color curve: skipped "
                    f"({color_match_info.get('reason', 'n/a')}, "
                    f"valid={color_match_info.get('valid', 0)}, ignored_pairs={ignored_bits})."
                )

            return src_bgra

        post_copy_src = save_color_sample_debug_outputs(base_img, post_copy_src)

        # Debug overlay: A (red), B (green), C (blue)
        a_union = np.maximum(eyes_a, mouth_a)
        b_union = np.maximum(eyes_b_bin, mouth_b_bin)
        c_union = np.maximum(eyes_c, mouth_c)
        debug_abc = base_img[:, :, :3].copy()
        abc_overlay = np.zeros_like(debug_abc)
        abc_overlay[:, :, 2] = a_union
        abc_overlay[:, :, 1] = b_union
        abc_overlay[:, :, 0] = c_union
        debug_abc = cv2.addWeighted(debug_abc, 1.0, abc_overlay, 0.45, 0)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_debug_abc.jpg"), debug_abc)
        face_soft_mask = self.save_debug_remove_hair(base_id, base_img, b_union, c_union, base_pts, face_width)
        cv2.imwrite(
            os.path.join(OUTPUT_DIR, f"{base_id}_debug_eye_hard_mask.png"),
            eyes_b_bin,
        )
        cv2.imwrite(
            os.path.join(OUTPUT_DIR, f"{base_id}_debug_nose_protect_mask.png"),
            blink_nose_protect,
        )
        cv2.imwrite(
            os.path.join(OUTPUT_DIR, f"{base_id}_debug_nose_ink_islands.png"),
            point23_nose_ink,
        )
        if face_soft_mask is not None:
            cv2.imwrite(
                os.path.join(OUTPUT_DIR, f"{base_id}_debug_face_soft_mask.png"),
                (np.clip(face_soft_mask, 0.0, 1.0) * 255).astype(np.uint8),
            )
            eyes_mask_f = (eyes_b_bin > 0).astype(np.float32) * np.clip(face_soft_mask, 0.0, 1.0)
            nose_zeroed = cv2.countNonZero(cv2.bitwise_and((eyes_mask_f > 0).astype(np.uint8) * 255, blink_nose_protect))
            if nose_zeroed > 0:
                eyes_mask_f[blink_nose_protect > 0] = 0.0
            cv2.imwrite(
                os.path.join(OUTPUT_DIR, f"{base_id}_debug_eye_blend_mask.png"),
                (np.clip(eyes_mask_f, 0.0, 1.0) * 255).astype(np.uint8),
            )
            self.log(
                "   Eye soft mask now uses isolated face mask "
                f"(active={int(np.count_nonzero(eyes_mask_f > 0.001))}, nose_zeroed={nose_zeroed})."
            )
        else:
            cv2.imwrite(
                os.path.join(OUTPUT_DIR, f"{base_id}_debug_eye_blend_mask.png"),
                (np.clip(eyes_mask_f, 0.0, 1.0) * 255).astype(np.uint8),
            )
            self.log("   Eye soft mask fallback: face isolation mask unavailable, using hard eye B mask.")

        region_masks = {
            "Eyes": {"A": eyes_a, "B": eyes_b_bin, "B_soft": eyes_mask_f, "C": eyes_c},
            "Mouth": {"A": mouth_a, "B": mouth_b_bin, "B_soft": mouth_mask_f, "C": mouth_c},
        }

        use_canny_head_align = self.state["config"].get("use_canny_head_align", True) and use_alignment_warping
        if use_canny_head_align:
            align_info = self.align_head_with_masked_canny(
                base_id,
                base_img,
                post_copy_src,
                b_union,
                c_union,
                face_width,
            )
            if align_info.get("applied"):
                post_copy_src = align_info["post_warped"]
            else:
                self.log(f"   Canny head-align skipped: {align_info.get('reason', 'n/a')}.")
        elif self.state["config"].get("use_canny_head_align", True):
            self.log("   Canny head-align skipped because alignment/warping is OFF.")

        # â”€â”€ Step 4.5: Manual Intervention (Eyes then Mouth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        self.log("4.5 Opening manual alignment editor...")
        
        # Convert to PIL for the editor
        def cv2_to_pil(img_cv):
            return Image.fromarray(cv2.cvtColor(img_cv, cv2.COLOR_BGRA2RGBA))

        base_pil = cv2_to_pil(base_img)
        post_pil = cv2_to_pil(post_copy_src)
        post_pil_mouth = cv2_to_pil(post_copy_src_unwarped)

        if upscale_factor > 1.0:
            editor_h, editor_w = base_img_orig.shape[:2]
            # Paint on downscaled previews of the exact aligned images used for export
            # so the popup and final composite stay in the same coordinate space.
            editor_base_pil = base_pil.resize((editor_w, editor_h), Image.LANCZOS)
            editor_post_pil = post_pil.resize((editor_w, editor_h), Image.LANCZOS)
            editor_post_pil_mouth = post_pil_mouth.resize((editor_w, editor_h), Image.LANCZOS)
        else:
            editor_base_pil = base_pil
            editor_post_pil = post_pil
            editor_post_pil_mouth = post_pil_mouth

        # We'll collect results for both regions
        results = {}
        for region in ["Eyes", "Mouth"]:
            self.log(f"   -> Aligning {region}...")
            
            # Initial copy mask B from A/B/C pipeline
            reg_masks = region_masks[region]
            init_mask_f = reg_masks["B_soft"]
            init_offset = (0.0, 0.0)
            init_scale = 1.0
            
            # Use a threading event to wait for the main thread popup
            event = threading.Event()
            reg_data = {"mask": None, "offset": (0,0), "scale": 1.0, "external_composite_path": None}

            def open_popup(
                target_region=region,
                target_mask=init_mask_f,
                target_offset=init_offset,
                target_scale=init_scale,
            ):
                b_pil = editor_base_pil
                p_pil = editor_post_pil if target_region == "Eyes" else editor_post_pil_mouth

                # If upscaled, keep painting at original resolution for responsiveness,
                # but use a downscaled view of the aligned export inputs.
                if upscale_factor > 1.0:
                    t_mask = Image.fromarray((target_mask * 255).astype(np.uint8)).resize(b_pil.size, Image.BILINEAR)
                    t_mask_f = np.array(t_mask).astype(np.float32) / 255.0
                    popup_init_offset = (target_offset[0] / upscale_factor, target_offset[1] / upscale_factor)
                else:
                    t_mask_f = target_mask
                    popup_init_offset = target_offset

                popup = ManualAlignmentPopup(
                    self,
                    b_pil,
                    p_pil,
                    t_mask_f,
                    f"Manual Alignment: {target_region}",
                    init_offset=popup_init_offset,
                    init_scale=target_scale,
                )
                
                def on_finish(m, o, s, external_composite_path=None):
                    # If we used original resolution in UI, scale the results back to high-res.
                    if upscale_factor > 1.0:
                        m_high = m.resize((w, h), Image.NEAREST)
                        reg_data["mask"] = m_high
                        reg_data["offset"] = (o[0] * upscale_factor, o[1] * upscale_factor)
                        reg_data["scale"] = s
                        if external_composite_path and os.path.exists(external_composite_path):
                            try:
                                with Image.open(external_composite_path) as ext_img:
                                    ext_hi = ext_img.convert("RGBA").resize((w, h), Image.LANCZOS)
                                ext_out = os.path.join(
                                    OUTPUT_DIR,
                                    f"{base_id}_{target_region.lower()}_external_composite.png",
                                )
                                ext_hi.save(ext_out, format="PNG")
                                reg_data["external_composite_path"] = ext_out
                            except Exception as e:
                                self.log(f"      {target_region} external import ignored: {e}")
                    else:
                        reg_data["mask"] = m
                        reg_data["offset"] = o
                        reg_data["scale"] = s
                        if external_composite_path and os.path.exists(external_composite_path):
                            try:
                                with Image.open(external_composite_path) as ext_img:
                                    ext_rgba = ext_img.convert("RGBA")
                                ext_out = os.path.join(
                                    OUTPUT_DIR,
                                    f"{base_id}_{target_region.lower()}_external_composite.png",
                                )
                                ext_rgba.save(ext_out, format="PNG")
                                reg_data["external_composite_path"] = ext_out
                            except Exception as e:
                                self.log(f"      {target_region} external import ignored: {e}")
                    event.set()
                popup.on_finish = on_finish
            
            self.after(0, open_popup)
            event.wait() # Wait for user to click OK
            results[region] = reg_data

        # â”€â”€ Step 5: Final Compositing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        self.log("5. Finalizing composites with manual edits...")

        def apply_transform_and_blend(base, top_pil, mask_pil, offset, scale, feather_profile=None):
            """
            Composites top_pil onto base using mask_pil, offset, and scale.
            Uses the EXACT same numpy logic as ManualAlignmentPopup.render() so that
            the final output is pixel-identical to what the user approved in the popup.
            PIL Image.composite is intentionally avoided â€” it uses a different blending
            path (linear RGBA including alpha channel, no orig_a guard) that produces
            different results from the numpy preview.
            """
            base_h, base_w = base.shape[:2]

            # Scale the top image (same as popup: int(self.w * scale))
            tw, th = top_pil.size
            eff_scale = 1.0 if abs(scale - 1.0) < REGION_SCALE_SNAP_EPS else scale
            sw, sh = int(tw * eff_scale), int(th * eff_scale)
            if sw < 1 or sh < 1:
                return base.copy()
            top_scaled = top_pil.resize((sw, sh), REGION_TOP_RESAMPLE)
            top_arr = np.array(top_scaled)          # RGBA, shape (sh, sw, 4)

            # Mask in BASE space â€” resize to match base dims (usually a no-op)
            mask_arr = np.array(mask_pil.resize((base_w, base_h), Image.NEAREST)).astype(np.float32)

            ox, oy = int(offset[0]), int(offset[1])
            x0, y0 = max(0, ox), max(0, oy)
            x1, y1 = min(base_w, ox + sw), min(base_h, oy + sh)

            # Work in RGBA so we can preserve the base alpha channel
            result = cv2.cvtColor(base, cv2.COLOR_BGRA2RGBA).copy()

            if x1 > x0 and y1 > y0:
                tx0, ty0 = x0 - ox, y0 - oy
                tx1, ty1 = tx0 + (x1 - x0), ty0 + (y1 - y0)

                top_f  = top_arr[ty0:ty1, tx0:tx1, :3].astype(np.float32)
                base_f = result[y0:y1, x0:x1, :3].astype(np.float32)
                orig_a = top_arr[ty0:ty1, tx0:tx1, 3].astype(np.float32)

                # Soft masks are preserved so the manual popup and final output match.
                mask_bin = np.clip(mask_arr[y0:y1, x0:x1] / 255.0, 0.0, 1.0).astype(np.float32)
                if feather_profile and np.any(mask_bin > 0):
                    ys_m, xs_m = np.where(mask_bin > 0.5)
                    fx0, fy0 = int(xs_m.min()), int(ys_m.min())
                    fx1, fy1 = int(xs_m.max()), int(ys_m.max())
                    fw = max(1, fx1 - fx0 + 1)
                    fh = max(1, fy1 - fy0 + 1)

                    left_frac = float(feather_profile.get("left", 0.0))
                    right_frac = float(feather_profile.get("right", 0.0))
                    top_frac = float(feather_profile.get("top", 0.0))
                    bottom_frac = float(feather_profile.get("bottom", 0.0))

                    left_w = max(0, int(round(fw * max(0.0, left_frac))))
                    right_w = max(0, int(round(fw * max(0.0, right_frac))))
                    top_w = max(0, int(round(fh * max(0.0, top_frac))))
                    bottom_w = max(0, int(round(fh * max(0.0, bottom_frac))))

                    yy, xx = np.indices(mask_bin.shape, dtype=np.float32)
                    feather = np.ones_like(mask_bin, dtype=np.float32)
                    if left_w > 0:
                        feather = np.minimum(feather, np.clip((xx - fx0 + 1.0) / float(left_w), 0.0, 1.0))
                    if right_w > 0:
                        feather = np.minimum(feather, np.clip((fx1 - xx + 1.0) / float(right_w), 0.0, 1.0))
                    if top_w > 0:
                        feather = np.minimum(feather, np.clip((yy - fy0 + 1.0) / float(top_w), 0.0, 1.0))
                    if bottom_w > 0:
                        feather = np.minimum(feather, np.clip((fy1 - yy + 1.0) / float(bottom_w), 0.0, 1.0))
                    mask_bin = mask_bin * feather
                a = np.where(orig_a >= REGION_ALPHA_SOLID_THRESHOLD, mask_bin, 0.0)[:, :, np.newaxis]

                result[y0:y1, x0:x1, :3] = (top_f * a + base_f * (1.0 - a)).clip(0, 255).astype(np.uint8)
                # Preserve the base alpha (character silhouette stays intact)
                result[y0:y1, x0:x1, 3] = base[y0:y1, x0:x1, 3]

            return cv2.cvtColor(result, cv2.COLOR_RGBA2BGRA)

        e_res = results["Eyes"]
        m_res = results["Mouth"]

        def load_external_composited(region_name, reg_res):
            ext_path = reg_res.get("external_composite_path")
            if ext_path and os.path.exists(ext_path):
                try:
                    with Image.open(ext_path) as ext:
                        ext_rgba = ext.convert("RGBA")
                        ext_bgra = cv2.cvtColor(np.array(ext_rgba), cv2.COLOR_RGBA2BGRA)
                    if ext_bgra.shape[:2] != base_img.shape[:2]:
                        raise ValueError(
                            f"size mismatch {ext_bgra.shape[1]}x{ext_bgra.shape[0]} vs {base_img.shape[1]}x{base_img.shape[0]}"
                        )
                    self.log(f"   {region_name} uses external composited BASE: {os.path.basename(ext_path)}")
                    return ext_bgra
                except Exception as e:
                    self.log(f"   {region_name} external composited BASE ignored ({e}); using internal transform.")
            return None

        eye_ext_bgra = load_external_composited("Eyes", e_res)
        mouth_ext_bgra = load_external_composited("Mouth", m_res)

        eye_top_pil, eye_offset, eye_scale = post_pil, e_res["offset"], e_res["scale"]
        mouth_top_pil, mouth_offset, mouth_scale = post_pil_mouth, m_res["offset"], m_res["scale"]

        if eye_ext_bgra is not None:
            img_blink = eye_ext_bgra.copy()
        else:
            img_blink = apply_transform_and_blend(base_img, eye_top_pil, e_res["mask"], eye_offset, eye_scale)

        if mouth_ext_bgra is not None:
            img_talk = mouth_ext_bgra.copy()
        else:
            img_talk = apply_transform_and_blend(
                base_img,
                mouth_top_pil,
                m_res["mask"],
                mouth_offset,
                mouth_scale,
            )

        # talk_blink: start from the blink result (eyes done), then apply mouth region.
        temp_blink = img_blink.copy()
        if mouth_ext_bgra is not None:
            mouth_ext_pil = Image.fromarray(cv2.cvtColor(mouth_ext_bgra, cv2.COLOR_BGRA2RGBA))
            img_talk_blink = apply_transform_and_blend(
                temp_blink,
                mouth_ext_pil,
                m_res["mask"],
                (0.0, 0.0),
                1.0,
            )
        else:
            img_talk_blink = apply_transform_and_blend(
                temp_blink,
                mouth_top_pil,
                m_res["mask"],
                mouth_offset,
                mouth_scale,
            )

        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_blink.webp"),      img_blink)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_talk.webp"),       img_talk)
        cv2.imwrite(os.path.join(OUTPUT_DIR, f"{base_id}_talk_blink.webp"), img_talk_blink)

        # â”€â”€ Step 6: Export finals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        self.log("6. Exporting to final_sprites/...")
        final_map = {
            os.path.join(OUTPUT_DIR, f"{base_id}_no_bg.webp"):      os.path.join(FINAL_DIR, f"{base_id}.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_blink.webp"):      os.path.join(FINAL_DIR, f"{base_id}_blink.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_talk.webp"):       os.path.join(FINAL_DIR, f"{base_id}_talk.webp"),
            os.path.join(OUTPUT_DIR, f"{base_id}_talk_blink.webp"): os.path.join(FINAL_DIR, f"{base_id}_talk_blink.webp"),
        }
        for src, dst in final_map.items():
            self.export_final_sprite(src, dst)
        self.log("   Done — 4 sprites in final_sprites/.")

    def export_final_sprite(self, src, dst):
        if self.state["config"].get("compress_final_webp", False) and dst.lower().endswith(".webp"):
            self.compress_final_webp(src, dst)
            return
        shutil.copy2(src, dst)

    def compress_final_webp(self, src, dst, quality=85):
        original_size = os.path.getsize(src)
        tmp_dst = f"{dst}.tmp_compress.webp"
        same_path = os.path.abspath(src) == os.path.abspath(dst)
        try:
            with Image.open(src) as img:
                img.save(tmp_dst, "WEBP", quality=quality, method=6, lossless=False)

            compressed_size = os.path.getsize(tmp_dst)
            if compressed_size <= original_size:
                os.replace(tmp_dst, dst)
                saved_kb = (original_size - compressed_size) / 1024
                self.log(
                    f"   Compressed {os.path.basename(dst)}: "
                    f"{original_size / 1024:.1f}KB -> {compressed_size / 1024:.1f}KB "
                    f"(saved {saved_kb:.1f}KB)."
                )
            else:
                os.remove(tmp_dst)
                if not same_path:
                    shutil.copy2(src, dst)
                self.log(
                    f"   Compression skipped for {os.path.basename(dst)}: "
                    f"compressed file would be larger ({compressed_size / 1024:.1f}KB > {original_size / 1024:.1f}KB)."
                )
        except Exception as exc:
            if os.path.exists(tmp_dst):
                try:
                    os.remove(tmp_dst)
                except OSError:
                    pass
            if not same_path:
                shutil.copy2(src, dst)
            self.log(f"   Compression failed for {os.path.basename(dst)}; copied original instead: {exc}")

    def handle_local_flip(self, task):
        """
        Build mirrored lateral sprites locally for symmetric characters.
        Example: right pipeline already complete -> produce left via horizontal flip.
        """
        target_base_id = task["id"].replace("_local", "")
        parts = target_base_id.split("_")
        if len(parts) < 3:
            raise Exception(f"Invalid LOCAL_FLIP task id: {task['id']}")

        target_angle = parts[-1].lower()
        if target_angle not in ("left", "right"):
            raise Exception(f"LOCAL_FLIP only supports left/right targets, got: {target_angle}")
        source_angle = "right" if target_angle == "left" else "left"
        parts[-1] = source_angle
        source_base_id = "_".join(parts)

        self.log(f"Local symmetry flip: {source_base_id} -> {target_base_id}")

        def flip_copy(src, dst, required=False, compress_final=False):
            if not os.path.exists(src):
                if required:
                    raise Exception(f"Missing required source for symmetry flip: {src}")
                return False
            with Image.open(src) as img:
                flipped = ImageOps.mirror(img)
                ext = os.path.splitext(dst)[1].lower()
                if ext == ".webp":
                    flipped.save(dst, format="WEBP", lossless=True)
                elif ext in (".jpg", ".jpeg"):
                    flipped.save(dst, format="JPEG", quality=95)
                elif ext == ".png":
                    flipped.save(dst, format="PNG")
                else:
                    flipped.save(dst)
            if compress_final and ext == ".webp" and self.state["config"].get("compress_final_webp", False):
                self.compress_final_webp(dst, dst)
            return True

        created = 0
        output_pairs = [
            (os.path.join(OUTPUT_DIR, f"{source_base_id}.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}.webp"), True),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_no_bg.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_no_bg.webp"), False),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_post.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_post.webp"), False),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_post_no_bg.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_post_no_bg.webp"), False),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_blink.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_blink.webp"), False),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_talk.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_talk.webp"), False),
            (os.path.join(OUTPUT_DIR, f"{source_base_id}_talk_blink.webp"), os.path.join(OUTPUT_DIR, f"{target_base_id}_talk_blink.webp"), False),
        ]
        for src, dst, required in output_pairs:
            if flip_copy(src, dst, required=required):
                created += 1

        final_pairs = [
            (os.path.join(FINAL_DIR, f"{source_base_id}.webp"), os.path.join(FINAL_DIR, f"{target_base_id}.webp")),
            (os.path.join(FINAL_DIR, f"{source_base_id}_blink.webp"), os.path.join(FINAL_DIR, f"{target_base_id}_blink.webp")),
            (os.path.join(FINAL_DIR, f"{source_base_id}_talk.webp"), os.path.join(FINAL_DIR, f"{target_base_id}_talk.webp")),
            (os.path.join(FINAL_DIR, f"{source_base_id}_talk_blink.webp"), os.path.join(FINAL_DIR, f"{target_base_id}_talk_blink.webp")),
        ]
        for src, dst in final_pairs:
            if flip_copy(src, dst, required=True, compress_final=True):
                created += 1

        self.log(f"   Symmetry flip complete. Mirrored {created} file(s).")

    # ==========================================
    # API HANDLER
    # ==========================================
    def normalize_api_output_canvas(self, img_out_bytes, target_size, label):
        target_w, target_h = target_size
        with Image.open(io.BytesIO(img_out_bytes)) as src:
            src = ImageOps.exif_transpose(src)
            if src.size == target_size:
                return img_out_bytes

            has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
            img = src.convert("RGBA" if has_alpha else "RGB")
            src_w, src_h = img.size
            scale = min(float(target_w) / float(src_w), float(target_h) / float(src_h))
            new_w = max(1, int(round(src_w * scale)))
            new_h = max(1, int(round(src_h * scale)))
            resized = img.resize((new_w, new_h), Image.LANCZOS)

            if has_alpha:
                canvas = Image.new("RGBA", target_size, (0, 0, 0, 0))
            else:
                arr = np.asarray(img.convert("RGB"))
                patch = max(2, min(32, src_w // 12, src_h // 12))
                corners = np.concatenate(
                    [
                        arr[:patch, :patch].reshape(-1, 3),
                        arr[:patch, -patch:].reshape(-1, 3),
                        arr[-patch:, :patch].reshape(-1, 3),
                        arr[-patch:, -patch:].reshape(-1, 3),
                    ],
                    axis=0,
                )
                fill = tuple(int(v) for v in np.median(corners, axis=0))
                canvas = Image.new("RGB", target_size, fill)

            paste_x = (target_w - new_w) // 2
            paste_y = (target_h - new_h) // 2
            canvas.paste(resized, (paste_x, paste_y), resized if has_alpha else None)
            buf = io.BytesIO()
            canvas.save(buf, format="WEBP", lossless=True, quality=95)
            out = buf.getvalue()
            self.log(
                f"   Normalized API output {label}: {src_w}x{src_h} -> "
                f"{target_w}x{target_h} without aspect stretch."
            )
            return out
    def build_nanogpt_input_data_url(
        self,
        img_data,
        mime_type,
        label,
        max_side=None,
        target_max_bytes=2000000,
        allow_resize=True,
    ):
        original_bytes = len(img_data)
        original_mime = mime_type or "image/png"
        try:
            with Image.open(io.BytesIO(img_data)) as src:
                src = ImageOps.exif_transpose(src)
                original_size = src.size
                has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
                img = src.convert("RGBA" if has_alpha else "RGB")
        except Exception:
            if original_bytes > target_max_bytes:
                raise Exception(
                    f"API input {label} is {original_bytes / 1048576:.2f}MB and could not be decoded for compression."
                )
            b64 = base64.b64encode(img_data).decode("utf-8")
            return f"data:{original_mime};base64,{b64}"

        max_dim = max(img.size)
        within_side_limit = max_side is None or max_dim <= max_side
        if original_bytes <= target_max_bytes and within_side_limit and original_mime.lower() != "image/png":
            b64 = base64.b64encode(img_data).decode("utf-8")
            return f"data:{original_mime};base64,{b64}"

        def resize_to_limit(image, limit):
            if limit is None:
                return image
            w, h = image.size
            if max(w, h) <= limit:
                return image
            scale = float(limit) / float(max(w, h))
            return image.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)

        def encode_webp(image, quality):
            buf = io.BytesIO()
            image.save(buf, format="WEBP", quality=quality, method=6)
            return buf.getvalue()

        img = resize_to_limit(img, max_side)
        encoded = None
        used_quality = None
        for quality in (95, 90, 85, 80, 74, 68, 60, 52, 44):
            try:
                candidate = encode_webp(img, quality)
            except Exception:
                candidate = None
            if candidate is None:
                continue
            encoded = candidate
            used_quality = quality
            if len(candidate) <= target_max_bytes:
                break

        while allow_resize and encoded is not None and len(encoded) > target_max_bytes and max(img.size) > 960:
            img = resize_to_limit(img, int(max(img.size) * 0.85))
            try:
                encoded = encode_webp(img, 76)
                used_quality = 76
            except Exception:
                break

        if encoded is None:
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            encoded = buf.getvalue()
            out_mime = "image/png"
        else:
            out_mime = "image/webp"

        if len(encoded) > target_max_bytes:
            raise Exception(
                f"API input {label} is still {len(encoded) / 1048576:.2f}MB after compression. "
                "Refusing to shrink the input further because it could change sprite geometry."
            )

        self.log(
            f"   Prepared API input {label}: {original_mime} {original_size[0]}x{original_size[1]} "
            f"{original_bytes / 1048576:.2f}MB -> {out_mime} {img.size[0]}x{img.size[1]} "
            f"{len(encoded) / 1048576:.2f}MB"
            + (f" q={used_quality}" if used_quality else "")
            + "."
        )
        b64 = base64.b64encode(encoded).decode("utf-8")
        return f"data:{out_mime};base64,{b64}"

    def resolve_nanogpt_image_model(self, model_id):
        raw_model = (model_id or "gpt-image-1").strip() or "gpt-image-1"
        model_key = raw_model.lower().replace("_", "-").replace(" ", "-")
        aliases = {
            "nanobanana": "nano-banana",
            "gemini-2.5-flash-image": "nano-banana",
            "gemini-2.5-flash-image-preview": "nano-banana",
            "gemini-3.1-flash-image": "nano-banana-2",
            "gemini-3.1-flash-image-preview": "nano-banana-2",
        }
        resolved_model = aliases.get(model_key, raw_model)

        if resolved_model.startswith("nano-banana"):
            resolution = "2k" if resolved_model in ("nano-banana-2", "nano-banana-2-fast") else "auto"
            return {
                "model": resolved_model,
                "endpoint": "https://nano-gpt.com/v1/images/generations",
                "resolution": resolution,
                "aspect_ratio": "9:16",
                "normalize_size": (768, 1344),
                "expected_size": (768, 1344),
                "expected_portrait": True,
            }
        return {
            "model": resolved_model,
            "endpoint": "https://nano-gpt.com/v1/images/generations",
            "size": "1024x1536",
            "expected_size": (1024, 1536),
            "expected_portrait": True,
        }

    def handle_api_task(self, task):
        config = self.state["config"]

        base_id = task["id"].replace("_post", "").replace("_local", "")
        parts = base_id.split("_")
        char = parts[0]
        expr = parts[-2]
        angle = parts[-1]

        # Build prompt on the fly - never stored on the task.
        if task["type"] == "API_EXPRESSION":
            p = config["prompt_expression"]
        elif task["type"] == "API_ANGLE":
            p = config["prompt_angle"]
        else:
            p = config["prompt_post"]

        angle_text = "back, meaning, we are seeing the back of the character as it is turned away from the camera" if angle == "back" else angle
        prompt = p.replace("{expr}", expr).replace("{angle}", angle_text).replace("{color}", config["eye_color"])

        reference_images = self.get_reference_images()
        if task["type"] == "API_EXPRESSION":
            primary_image = config["base_image"]
            img_paths = [primary_image, *reference_images]
        elif task["type"] == "API_ANGLE":
            primary_image = os.path.join(OUTPUT_DIR, task["id"].rsplit("_", 1)[0] + "_front.webp")
            img_paths = [primary_image, *reference_images]
        else:
            primary_image = os.path.join(OUTPUT_DIR, task["id"].replace("_post", "") + ".webp")
            img_paths = [primary_image]

        if config.get("use_local_comfyui"):
            if not primary_image or not os.path.exists(primary_image):
                raise Exception(f"ComfyUI input image not found: {primary_image}")
            if task["type"] in ("API_EXPRESSION", "API_ANGLE") and reference_images:
                self.log("   ComfyUI mode: reference images are ignored (single-image workflow).")
            self._handle_comfyui_task(task, prompt, primary_image)
            return

        if task["type"] in ("API_EXPRESSION", "API_ANGLE") and not reference_images:
            raise Exception("No reference images selected. Please select at least one reference image.")

        configured_model = config.get("model", "gpt-image-1").strip() or "gpt-image-1"
        image_request = self.resolve_nanogpt_image_model(configured_model)
        model_id = image_request["model"]
        endpoint_url = image_request["endpoint"]
        expected_size = image_request.get("expected_size")
        normalize_size = image_request.get("normalize_size")
        expected_portrait = image_request.get("expected_portrait", False)
        request_descriptor = image_request.get("size") or image_request.get("resolution") or "auto"
        is_banana_model = model_id.startswith("nano-banana")
        is_post_task = task["type"] == "API_POST"
        input_max_side = None if is_post_task else (1536 if is_banana_model else 2048)
        input_max_bytes = 2000000 if is_banana_model else 3500000
        allow_input_resize = not is_post_task
        primary_input_size = None

        data_urls = []
        for path in img_paths:
            with open(path, "rb") as f:
                img_data = f.read()
            mime_type = mimetypes.guess_type(path)[0] or "image/png"
            if task["type"] == "API_POST":
                self.log(f"   Removing background from input: {os.path.basename(path)}")
                img_data = self.remove_bg_from_bytes(img_data)
                mime_type = "image/png"
            if path == primary_image:
                try:
                    with Image.open(io.BytesIO(img_data)) as input_check:
                        primary_input_size = input_check.size
                except Exception:
                    primary_input_size = None
            data_urls.append(
                self.build_nanogpt_input_data_url(
                    img_data,
                    mime_type,
                    os.path.basename(path),
                    max_side=input_max_side,
                    target_max_bytes=input_max_bytes,
                    allow_resize=allow_input_resize,
                )
            )

        if is_post_task and primary_input_size:
            expected_size = primary_input_size

        payload = {
            "model": model_id,
            "prompt": prompt,
            "n": 1,
        }
        payload["size"] = image_request.get("size") or image_request.get("resolution", "1024x1536")
        payload["response_format"] = "b64_json"
        if image_request.get("aspect_ratio"):
            payload["aspect_ratio"] = image_request["aspect_ratio"]
        if len(data_urls) == 1:
            payload["imageDataUrl"] = data_urls[0]
        elif data_urls:
            payload["imageDataUrls"] = data_urls

        api_key = config.get("api_key", "").strip()
        if not api_key:
            raise Exception("NanoGPT API key is missing. Set NANOGPT_API_KEY in .env or paste it into the API key field.")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        self.log(f"Sending request to NanoGPT ({model_id}, {request_descriptor}, {endpoint_url})...")
        timeout = 600
        try:
            response = requests.post(endpoint_url, json=payload, headers=headers, timeout=timeout)
        except requests.exceptions.Timeout:
            raise Exception(f"NanoGPT request timed out after {timeout} seconds. The model is too slow.")
        except Exception as e:
            raise Exception(f"Network error: {str(e)}")

        if response.status_code != 200:
            self.log(f"   NanoGPT API Error ({response.status_code}): {response.text[:500]}")
            raise Exception(f"NanoGPT API returned status {response.status_code}")

        try:
            res = response.json()
        except Exception:
            self.log(f"   Critical: Received non-JSON response from NanoGPT. Start of response: {response.text[:200]}")
            raise Exception("Invalid JSON response from NanoGPT. Check status log for details.")

        if "error" in res:
            err = res["error"]
            err_msg = err.get("message", err) if isinstance(err, dict) else err
            raise Exception(f"NanoGPT API Error: {err_msg}")

        image_item = (res.get("data") or [{}])[0]
        if image_item.get("b64_json"):
            img_out_bytes = base64.b64decode(image_item["b64_json"])
        elif image_item.get("url"):
            url_response = requests.get(image_item["url"], timeout=180)
            url_response.raise_for_status()
            img_out_bytes = url_response.content
        else:
            raise Exception("NanoGPT returned no image data.")

        with Image.open(io.BytesIO(img_out_bytes)) as img_check:
            returned_w, returned_h = img_check.size
            if expected_portrait and returned_h <= returned_w:
                raise Exception(
                    f"NanoGPT returned non-portrait {returned_w}x{returned_h} for requested "
                    f"{request_descriptor} 9:16 on {task['id']}. Stopping instead of processing a bad canvas."
                )

        if normalize_size:
            img_out_bytes = self.normalize_api_output_canvas(img_out_bytes, normalize_size, task["id"])

        with Image.open(io.BytesIO(img_out_bytes)) as img_check:
            returned_w, returned_h = img_check.size
            if expected_size and img_check.size != expected_size:
                raise Exception(
                    f"NanoGPT returned {returned_w}x{returned_h} instead of required "
                    f"{expected_size[0]}x{expected_size[1]} for {task['id']}. "
                    "Stopping to preserve same-canvas A/B matching."
                )

        if task["type"] == "API_POST":
            self.log("   Removing background from NanoGPT output...")
            img_out_bytes = self.remove_bg_from_bytes(img_out_bytes)

        output_path = os.path.join(OUTPUT_DIR, f"{task['id']}.webp")
        with open(output_path, "wb") as f:
            f.write(img_out_bytes)
    def _handle_comfyui_task(self, task, prompt_text, input_image_path):
        config = self.state["config"]
        comfy_url = (config.get("comfyui_url") or "http://127.0.0.1:8188").rstrip("/")
        workflow_path = config.get("comfyui_workflow_path") or os.path.join(SPRITE_GENERATOR_ROOT, "workflow_flux.json")

        if not os.path.exists(workflow_path):
            raise Exception(f"ComfyUI workflow file not found: {workflow_path}")

        workflow_text, comfy_seed = self._build_comfyui_workflow_text(workflow_path, prompt_text, input_image_path)
        try:
            workflow_prompt = json.loads(workflow_text)
        except Exception as e:
            raise Exception(f"Invalid workflow JSON after [input]/[prompt]/[SEED] replacement: {e}")

        self.log(f"Sending request to local ComfyUI ({comfy_url}) with seed={comfy_seed}...")
        image_bytes = self._run_comfyui_prompt_and_fetch_image(comfy_url, workflow_prompt)

        if task["type"] == "API_POST":
            self.log("   Removing background from ComfyUI output...")
            image_bytes = self.remove_bg_from_bytes(image_bytes)

        output_path = os.path.join(OUTPUT_DIR, f"{task['id']}.webp")
        with open(output_path, "wb") as f:
            f.write(image_bytes)


    def _build_comfyui_workflow_text(self, workflow_path, prompt_text, input_image_path):
        with open(workflow_path, "r", encoding="utf-8") as wf:
            workflow_text = wf.read()

        # String-level replacement as requested, but JSON-escape values so quotes/backslashes stay valid.
        prompt_escaped = json.dumps(prompt_text)[1:-1]
        input_escaped = json.dumps(input_image_path)[1:-1]
        seed = random.randint(10_000_000_000_000, 99_999_999_999_999)
        workflow_text = workflow_text.replace("[prompt]", prompt_escaped)
        workflow_text = workflow_text.replace("[input]", input_escaped)
        workflow_text = workflow_text.replace("[SEED]", str(seed))
        return workflow_text, seed

    def _run_comfyui_prompt_and_fetch_image(self, comfy_url, workflow_prompt):
        timeout_sec = 600
        poll_interval_sec = 1.0
        client_id = str(uuid.uuid4())
        submit_payload = {"prompt": workflow_prompt, "client_id": client_id}

        try:
            submit = requests.post(f"{comfy_url}/prompt", json=submit_payload, timeout=60)
        except Exception as e:
            raise Exception(f"Failed to reach ComfyUI /prompt endpoint: {e}")

        if submit.status_code != 200:
            raise Exception(f"ComfyUI /prompt returned {submit.status_code}: {submit.text[:500]}")

        try:
            submit_json = submit.json()
        except Exception:
            raise Exception(f"ComfyUI /prompt returned non-JSON: {submit.text[:300]}")

        prompt_id = submit_json.get("prompt_id")
        if not prompt_id:
            error_msg = submit_json.get("error") or submit_json
            raise Exception(f"ComfyUI rejected workflow: {error_msg}")

        self.log(f"   ComfyUI queued prompt_id={prompt_id}. Polling history...")
        deadline = time.time() + timeout_sec
        last_status = 0.0

        while time.time() < deadline:
            try:
                hist_resp = requests.get(f"{comfy_url}/history/{prompt_id}", timeout=30)
            except Exception as e:
                self.log(f"   ComfyUI history poll transient error: {e}")
                time.sleep(poll_interval_sec)
                continue

            if hist_resp.status_code != 200:
                time.sleep(poll_interval_sec)
                continue

            try:
                history_obj = hist_resp.json()
            except Exception:
                time.sleep(poll_interval_sec)
                continue

            run_obj = history_obj.get(prompt_id) if isinstance(history_obj, dict) else None
            if not run_obj and isinstance(history_obj, dict) and len(history_obj) == 1:
                run_obj = next(iter(history_obj.values()))

            if run_obj:
                outputs = run_obj.get("outputs") or {}
                img_ref = self._extract_first_comfy_image_ref(outputs)
                if img_ref:
                    return self._fetch_comfyui_image_bytes(comfy_url, img_ref)
                if run_obj.get("status", {}).get("status_str") == "error":
                    messages = run_obj.get("status", {}).get("messages")
                    raise Exception(f"ComfyUI execution failed: {messages}")

            now = time.time()
            if now - last_status > 10:
                self.log("   Waiting for ComfyUI output...")
                last_status = now
            time.sleep(poll_interval_sec)

        raise Exception("ComfyUI timed out waiting for /history output.")

    def _extract_first_comfy_image_ref(self, outputs):
        if not isinstance(outputs, dict):
            return None

        for node_output in outputs.values():
            if not isinstance(node_output, dict):
                continue
            images = node_output.get("images")
            if isinstance(images, list) and images:
                first = images[0]
                if all(k in first for k in ("filename", "subfolder", "type")):
                    return first
        return None

    def _fetch_comfyui_image_bytes(self, comfy_url, image_ref):
        params = {
            "filename": image_ref["filename"],
            "subfolder": image_ref.get("subfolder", ""),
            "type": image_ref.get("type", "output"),
        }
        resp = requests.get(f"{comfy_url}/view", params=params, timeout=60)
        if resp.status_code != 200:
            raise Exception(f"ComfyUI /view returned {resp.status_code}: {resp.text[:300]}")
        return resp.content

    def _get_bg_removed_bytes_for_source(self, source_path, label="image"):
        with open(source_path, "rb") as src_f:
            source_bytes = src_f.read()

        mode = "chroma_v6" if self.state["config"].get("use_greenscreen") else "rembg"
        cache_key = hashlib.sha1(mode.encode("ascii") + b"|" + source_bytes).hexdigest()
        cache_subdir = os.path.join(self.cache_dir, "bg_remove")
        os.makedirs(cache_subdir, exist_ok=True)
        cache_file = os.path.join(cache_subdir, f"{cache_key}.bin")

        if os.path.exists(cache_file):
            with open(cache_file, "rb") as cf:
                out = cf.read()
            self.log(f"   Background cache hit ({label}).")
            return out

        out = self.remove_bg_from_bytes(source_bytes)
        if not os.path.exists(cache_file):
            try:
                with open(cache_file, "wb") as cf:
                    cf.write(out)
            except Exception:
                pass
        self.log(f"   Background cache miss ({label}) -> computed.")
        return out

    def _get_upscaled_bgra_for_bg_bytes(self, bg_bytes, bgra_img, label="image"):
        cache_subdir = os.path.join(self.cache_dir, "upscale_from_bg")
        os.makedirs(cache_subdir, exist_ok=True)
        cache_key = hashlib.sha1(b"up4x|" + bg_bytes).hexdigest()
        cache_file = os.path.join(cache_subdir, f"{cache_key}.png")

        if os.path.exists(cache_file):
            disk_img = cv2.imread(cache_file, cv2.IMREAD_UNCHANGED)
            if disk_img is not None and len(disk_img.shape) == 3 and disk_img.shape[2] == 4:
                self.log(f"   Upscale cache hit ({label}).")
                return disk_img

        upscaled = self.upscale_image_realesrgan(bgra_img)
        try:
            cv2.imwrite(cache_file, upscaled)
        except Exception:
            pass
        self.log(f"   Upscale cache miss ({label}) -> computed.")
        return upscaled

    def upscale_image_realesrgan(self, img_bgra):
        """Upscales BGRA image by 4x using Real-ESRGAN anime model via Spandrel."""
        if ModelLoader is None:
            self.log("   ERROR: Spandrel not installed. Skipping upscale.")
            return img_bgra

        cache_subdir = os.path.join(self.cache_dir, "upscale")
        os.makedirs(cache_subdir, exist_ok=True)
        if not hasattr(self, "_upscale_cache"):
            self._upscale_cache = {}

        cache_key = hashlib.sha1(
            img_bgra.tobytes() + str(img_bgra.shape).encode("ascii") + str(img_bgra.dtype).encode("ascii")
        ).hexdigest()
        cached = self._upscale_cache.get(cache_key)
        if cached is not None:
            self.log("   Upscale cache hit. Reusing previous 4x result.")
            return cached.copy()
        cache_file = os.path.join(cache_subdir, f"{cache_key}.png")
        if os.path.exists(cache_file):
            disk_img = cv2.imread(cache_file, cv2.IMREAD_UNCHANGED)
            if disk_img is not None and len(disk_img.shape) == 3 and disk_img.shape[2] == 4:
                self._upscale_cache[cache_key] = disk_img.copy()
                self.log("   Upscale cache hit (disk). Reusing previous 4x result.")
                return disk_img.copy()

        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        if not hasattr(self, "_upscale_model"):
            self.log("   Initializing Real-ESRGAN (x4plus_anime_6B)...")
            model_path = os.path.join(os.getcwd(), "weights", "RealESRGAN_x4plus_anime_6B.pth")
            
            if not os.path.exists(model_path):
                os.makedirs(os.path.dirname(model_path), exist_ok=True)
                self.log("   Downloading model weights (this may take a minute)...")
                url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
                r = requests.get(url, stream=True)
                with open(model_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
            
            self._upscale_model = ModelLoader().load_from_file(model_path).to(device)
            self._upscale_model.eval()

        # Split Alpha
        bgr = img_bgra[:, :, :3]
        alpha = img_bgra[:, :, 3]

        self.log(f"   Upscaling {bgr.shape[1]}x{bgr.shape[0]} -> {bgr.shape[1]*4}x{bgr.shape[0]*4}...")
        
        # Upscale BGR
        try:
            # Convert to Tensor (B, C, H, W)
            input_tensor = torch.from_numpy(bgr).permute(2, 0, 1).float().divide(255).unsqueeze(0).to(device)
            with torch.no_grad():
                output_tensor = self._upscale_model(input_tensor)
            output_bgr = output_tensor.squeeze(0).permute(1, 2, 0).cpu().clamp(0, 1).multiply(255).numpy().astype(np.uint8)
        except Exception as e:
            self.log(f"   Upscale error: {e}. Falling back to bicubic.")
            output_bgr = cv2.resize(bgr, (bgr.shape[1]*4, bgr.shape[0]*4), interpolation=cv2.INTER_CUBIC)

        # Upscale Alpha (use bicubic for alpha to avoid artifacts)
        output_alpha = cv2.resize(alpha, (alpha.shape[1]*4, alpha.shape[0]*4), interpolation=cv2.INTER_CUBIC)

        upscaled = cv2.merge([output_bgr[:,:,0], output_bgr[:,:,1], output_bgr[:,:,2], output_alpha])

        # Keep cache tiny and in-memory (debug-rerun helper, not persistence).
        if len(self._upscale_cache) >= 8:
            oldest_key = next(iter(self._upscale_cache))
            self._upscale_cache.pop(oldest_key, None)
        self._upscale_cache[cache_key] = upscaled.copy()
        try:
            cv2.imwrite(cache_file, upscaled)
        except Exception:
            pass
        return upscaled

    # ==========================================
    # UTILS
    # ==========================================
    def fit_smaller_sprite_to_frame(self, base_img_bgra, post_img_bgra=None):
        """Uniformly upscale a smaller alpha sprite to a padded frame; never downscales."""
        if base_img_bgra is None or base_img_bgra.ndim != 3 or base_img_bgra.shape[2] < 4:
            return base_img_bgra, post_img_bgra, {"applied": False, "reason": "invalid_base"}

        h, w = base_img_bgra.shape[:2]
        alpha = base_img_bgra[:, :, 3]
        ys, xs = np.where(alpha > 16)
        if len(xs) < 20 or len(ys) < 20:
            return base_img_bgra, post_img_bgra, {"applied": False, "reason": "empty_alpha"}

        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        bbox_w = max(1, x1 - x0)
        bbox_h = max(1, y1 - y0)

        side_pad = max(8, int(round(w * 0.035)))
        top_pad = max(8, int(round(h * 0.025)))
        bottom_pad = max(14, int(round(h * 0.035)))
        target_w = max(1, w - (2 * side_pad))
        target_h = max(1, h - top_pad - bottom_pad)
        scale = min(float(target_w) / float(bbox_w), float(target_h) / float(bbox_h))
        if not np.isfinite(scale) or scale <= 1.01:
            return base_img_bgra, post_img_bgra, {
                "applied": False,
                "reason": "already_fills_frame",
                "scale": float(scale) if np.isfinite(scale) else 1.0,
                "bbox": (x0, y0, x1, y1),
            }

        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        scaled_bbox_w = bbox_w * scale
        scaled_bbox_h = bbox_h * scale
        target_bottom = h - bottom_pad
        target_center_x = w * 0.5
        scaled_bbox_center_x = ((x0 + x1) * 0.5) * scale
        scaled_bbox_bottom = y1 * scale
        paste_x = int(round(target_center_x - scaled_bbox_center_x))
        paste_y = int(round(target_bottom - scaled_bbox_bottom))

        min_paste_x = int(math.floor(side_pad - (x0 * scale)))
        max_paste_x = int(math.ceil((w - side_pad) - (x1 * scale)))
        min_paste_y = int(math.floor(top_pad - (y0 * scale)))
        max_paste_y = int(math.ceil((h - bottom_pad) - (y1 * scale)))
        if min_paste_x <= max_paste_x:
            paste_x = int(np.clip(paste_x, min_paste_x, max_paste_x))
        if min_paste_y <= max_paste_y:
            paste_y = int(np.clip(paste_y, min_paste_y, max_paste_y))

        def transform(img_bgra):
            if img_bgra is None:
                return None
            if img_bgra.shape[:2] != (h, w):
                return img_bgra
            img_f = img_bgra.astype(np.float32)
            alpha_f = img_f[:, :, 3:4] / 255.0
            premul = img_f[:, :, :3] * alpha_f
            premul_r = cv2.resize(premul, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
            alpha_r = cv2.resize(alpha_f, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
            if alpha_r.ndim == 2:
                alpha_r = alpha_r[:, :, np.newaxis]
            alpha_r = np.clip(alpha_r, 0.0, 1.0)
            rgb_r = np.zeros_like(premul_r)
            np.divide(premul_r, alpha_r, out=rgb_r, where=alpha_r > 1e-4)
            resized = np.dstack([rgb_r, alpha_r * 255.0]).clip(0, 255).astype(np.uint8)
            out = np.zeros_like(img_bgra)
            src_x0 = max(0, -paste_x)
            src_y0 = max(0, -paste_y)
            dst_x0 = max(0, paste_x)
            dst_y0 = max(0, paste_y)
            copy_w = min(new_w - src_x0, w - dst_x0)
            copy_h = min(new_h - src_y0, h - dst_y0)
            if copy_w <= 0 or copy_h <= 0:
                return img_bgra
            out[dst_y0:dst_y0 + copy_h, dst_x0:dst_x0 + copy_w] = resized[src_y0:src_y0 + copy_h, src_x0:src_x0 + copy_w]
            return out

        return transform(base_img_bgra), transform(post_img_bgra), {
            "applied": True,
            "scale": float(scale),
            "offset": (paste_x, paste_y),
            "bbox": (x0, y0, x1, y1),
            "target_padding": (side_pad, top_pad, bottom_pad),
            "scaled_bbox": (float(scaled_bbox_w), float(scaled_bbox_h)),
        }

    def remove_bg_greenscreen_from_bytes(self, data):
        """Remove a solid/chroma background by sampling border color, then despill edges."""
        with Image.open(io.BytesIO(data)) as img:
            rgba_img = ImageOps.exif_transpose(img).convert("RGBA")

        rgba_src = np.array(rgba_img)
        rgb = rgba_src[:, :, :3].astype(np.float32)
        input_alpha = rgba_src[:, :, 3]
        h_img, w_img = rgb.shape[:2]
        if h_img < 4 or w_img < 4:
            raise Exception("Image too small for chroma background removal.")

        rgb_u8 = rgb.astype(np.uint8)
        hsv = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2HSV).astype(np.float32)
        lab = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2LAB).astype(np.float32)

        r = rgb[:, :, 0]
        g = rgb[:, :, 1]
        b = rgb[:, :, 2]
        h = hsv[:, :, 0]
        s = hsv[:, :, 1]
        v = hsv[:, :, 2]

        border_px = max(4, int(round(min(h_img, w_img) * 0.035)))
        border_mask = np.zeros((h_img, w_img), dtype=bool)
        border_mask[:border_px, :] = True
        border_mask[-border_px:, :] = True
        border_mask[:, :border_px] = True
        border_mask[:, -border_px:] = True

        has_existing_alpha = bool(np.any(input_alpha < 250))
        transparent_border_ratio = float(np.mean(input_alpha[border_mask] < 16))
        if has_existing_alpha and transparent_border_ratio > 0.10:
            self.log(
                "   Chroma key skipped: input already has transparent border; "
                "preserving existing alpha instead of sampling transparent RGB. "
                f"(transparent border {transparent_border_ratio * 100:.1f}%)."
            )
            buf = io.BytesIO()
            rgba_img.save(buf, format="PNG")
            return buf.getvalue()

        sample_mask = border_mask & (input_alpha > 240)
        if has_existing_alpha and int(np.count_nonzero(sample_mask)) < max(16, int(np.count_nonzero(border_mask) * 0.10)):
            self.log("   Chroma key skipped: not enough opaque border pixels; preserving existing alpha.")
            buf = io.BytesIO()
            rgba_img.save(buf, format="PNG")
            return buf.getvalue()
        if not np.any(sample_mask):
            sample_mask = border_mask

        border_rgb = rgb[sample_mask]
        if border_rgb.size == 0:
            raise Exception("No border pixels available for chroma background detection.")

        bg_rgb = np.median(border_rgb, axis=0).astype(np.float32)
        border_rgb_u8 = border_rgb.astype(np.uint8)
        unique_border, unique_counts = np.unique(border_rgb_u8.reshape(-1, 3), axis=0, return_counts=True)
        key_rgb = unique_border[int(np.argmax(unique_counts))].astype(np.uint8)
        bg_lab = cv2.cvtColor(bg_rgb.reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)[0, 0]
        lab_delta = lab - bg_lab.reshape(1, 1, 3)
        color_dist = np.sqrt(np.sum(lab_delta * lab_delta, axis=2))
        border_dist = color_dist[sample_mask]

        inner = max(8.0, float(np.percentile(border_dist, 60.0)) * 1.10)
        outer = max(inner + 10.0, float(np.percentile(border_dist, 92.0)) * 1.35, 34.0)
        t = np.clip((color_dist - inner) / max(1e-3, outer - inner), 0.0, 1.0)
        bg_score = 1.0 - ((t * t) * (3.0 - (2.0 * t)))

        # Keep compatibility with classic bright green screens; dynamic border keying handles teal/dark green.
        hue_dist = np.minimum(np.abs(h - 60.0), 180.0 - np.abs(h - 60.0))
        hue_green = np.clip(1.0 - (hue_dist / 40.0), 0.0, 1.0)
        green_dom = np.clip((g - np.maximum(r, b) - 10.0) / 90.0, 0.0, 1.0)
        sat_factor = np.clip((s - 25.0) / 120.0, 0.0, 1.0)
        val_factor = np.clip((v - 20.0) / 120.0, 0.0, 1.0)
        green_score = hue_green * (0.60 * green_dom + 0.40 * sat_factor) * (0.65 + 0.35 * val_factor)

        bg_hsv = cv2.cvtColor(bg_rgb.reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)[0, 0]
        key_hsv = cv2.cvtColor(key_rgb.reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)[0, 0]
        key_is_unsafe = bool(key_hsv[1] < 25.0 or key_hsv[2] < 35.0 or key_hsv[2] > 245.0)
        if key_is_unsafe:
            raise Exception(
                f"Unsafe chroma key RGB=({int(key_rgb[0])},{int(key_rgb[1])},{int(key_rgb[2])}); "
                "refusing to key likely lineart/transparent matte color."
            )
        if bg_hsv[1] > 35.0 and 35.0 <= bg_hsv[0] <= 100.0:
            bg_score = np.maximum(bg_score, green_score * 0.85)
        bg_score = cv2.GaussianBlur(bg_score.astype(np.float32), (0, 0), 0.75)

        # Best-effort eye guard. Border-connected removal already protects most subject colors, but this
        # avoids eating green/cyan eye pixels if a generated matte creates accidental connections.
        try:
            bgr_u8 = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2BGR)
            detector = self.get_anime_detector()
            preds = detector(bgr_u8)
            if preds and len(preds) > 0:
                best_face = max(preds, key=lambda p: p['bbox'][4])
                pts = np.array(best_face['keypoints'], dtype=np.float32)[:, :2]
                if len(pts) == 28:
                    eye_idx = [11, 12, 13, 17, 18, 19]
                    eye_pts = pts[eye_idx]
                    eye_spread = float(np.linalg.norm(np.max(eye_pts, axis=0) - np.min(eye_pts, axis=0)))
                    pad = max(1, int(eye_spread * 0.12))
                    eye_core = np.zeros((h_img, w_img), dtype=np.uint8)
                    left = pts[[11, 12, 13]].astype(np.int32)
                    right = pts[[17, 18, 19]].astype(np.int32)
                    cv2.fillConvexPoly(eye_core, cv2.convexHull(left), 255)
                    cv2.fillConvexPoly(eye_core, cv2.convexHull(right), 255)
                    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1))
                    eye_guard = cv2.dilate(eye_core, k) > 0
                    guarded = eye_guard & (bg_score < 0.88)
                    if np.any(guarded):
                        bg_score = np.where(guarded, bg_score * 0.12, bg_score)
        except Exception:
            pass

        candidate = bg_score > 0.30
        candidate_u8 = candidate.astype(np.uint8)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        candidate_u8 = cv2.morphologyEx(candidate_u8, cv2.MORPH_CLOSE, kernel, iterations=1)

        edge_candidate_ratio = float(np.mean(candidate_u8[border_mask] > 0))
        if edge_candidate_ratio < 0.18:
            raise Exception(
                f"No strong border-connected chroma background detected "
                f"(edge candidate {edge_candidate_ratio * 100:.1f}%)."
            )

        _, labels = cv2.connectedComponents(candidate_u8, connectivity=8)
        border_labels = np.unique(labels[border_mask])
        border_labels = border_labels[border_labels != 0]
        if border_labels.size == 0:
            raise Exception("No border-connected chroma background component detected.")

        connected_bg = np.isin(labels, border_labels)
        connected_ratio = float(np.mean(connected_bg))
        if connected_ratio < 0.015:
            raise Exception(
                f"Border-connected chroma background too small ({connected_ratio * 100:.1f}%)."
            )

        # Very-near-key cleanup catches enclosed holes between arms/hair/clothes without using
        # the broad fuzzy chroma key. Keep this tight so green-ish subject colors stay protected.
        key_delta = rgb.astype(np.float32) - key_rgb.reshape(1, 1, 3).astype(np.float32)
        key_rgb_dist = np.sqrt(np.sum(key_delta * key_delta, axis=2))
        near_key_bg = key_rgb_dist <= 6.0
        near_key_internal_count = int(np.count_nonzero(near_key_bg & (~connected_bg)))
        connected_bg = connected_bg | near_key_bg
        connected_ratio = float(np.mean(connected_bg))

        alpha = None
        matte_backend = "hard"
        try:
            from pymatting import estimate_alpha_knn

            bg_core = connected_bg | (bg_score > 0.94) | near_key_bg
            bg_u8 = bg_core.astype(np.uint8)
            matte_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            unknown_band = cv2.dilate(bg_u8, matte_k, iterations=3).astype(bool) & (~cv2.erode(bg_u8, matte_k, iterations=1).astype(bool))
            soft_chroma = (bg_score > 0.10) & (bg_score < 0.94)
            unknown = (unknown_band | soft_chroma) & (~near_key_bg)

            trimap = np.ones((h_img, w_img), dtype=np.float32)
            trimap[bg_core] = 0.0
            trimap[unknown] = 0.5
            trimap[near_key_bg] = 0.0

            unknown_count = int(np.count_nonzero(trimap == 0.5))
            bg_count = int(np.count_nonzero(trimap == 0.0))
            fg_count = int(np.count_nonzero(trimap == 1.0))
            if unknown_count < 32 or bg_count < 32 or fg_count < 32:
                raise Exception(f"weak trimap bg={bg_count} unknown={unknown_count} fg={fg_count}")

            matte_max_side = 768
            max_side = max(h_img, w_img)
            if max_side > matte_max_side:
                scale = float(matte_max_side) / float(max_side)
                small_w = max(1, int(round(w_img * scale)))
                small_h = max(1, int(round(h_img * scale)))
                rgb_matte = cv2.resize(rgb / 255.0, (small_w, small_h), interpolation=cv2.INTER_AREA)
                trimap_matte = cv2.resize(trimap, (small_w, small_h), interpolation=cv2.INTER_NEAREST)
            else:
                rgb_matte = rgb / 255.0
                trimap_matte = trimap

            alpha_matte = estimate_alpha_knn(rgb_matte.astype(np.float64), trimap_matte.astype(np.float64))
            alpha_matte = np.clip(alpha_matte, 0.0, 1.0).astype(np.float32)
            if alpha_matte.shape != (h_img, w_img):
                alpha_matte = cv2.resize(alpha_matte, (w_img, h_img), interpolation=cv2.INTER_CUBIC)
                alpha_matte = np.clip(alpha_matte, 0.0, 1.0)

            alpha = alpha_matte * 255.0
            alpha[bg_core] = 0.0
            alpha[near_key_bg] = 0.0
            alpha = np.where(alpha > 248.0, 255.0, alpha)
            alpha = np.where(alpha < 8.0, 0.0, alpha)
            alpha = np.clip(alpha, 0.0, 255.0)
            matte_backend = f"pymatting-knn bg={bg_count} unknown={unknown_count} fg={fg_count}"
        except Exception as e:
            self.log(f"   PyMatting chroma matte fallback to hard key: {e}")

        if alpha is None:
            # Hard fallback with a narrow soft edge. This avoids the 90-alpha green veil while
            # preserving basic anti-aliased subject boundaries.
            hard_bg = connected_bg.astype(np.uint8)
            soft_bg = cv2.GaussianBlur(hard_bg.astype(np.float32), (0, 0), 0.85)
            alpha = np.clip((1.0 - soft_bg) * 255.0, 0.0, 255.0)
            alpha[connected_bg] = 0.0
            alpha = np.where(alpha > 246.0, 255.0, alpha)
            alpha = np.where(alpha < 12.0, 0.0, alpha)
            alpha = np.clip(alpha, 0.0, 255.0)

        # Generic despill: estimate foreground color on semi-transparent edge pixels by subtracting
        # the sampled background contribution, rather than assuming the spill is pure green.
        rgb_clean = rgb.copy()
        alpha_n = alpha / 255.0
        edge_mask = (alpha > 0.0) & (alpha < 250.0)
        if np.any(edge_mask):
            denom = np.maximum(alpha_n, 0.12)[:, :, np.newaxis]
            bg = bg_rgb.reshape(1, 1, 3)
            estimated_fg = (rgb - ((1.0 - alpha_n[:, :, np.newaxis]) * bg)) / denom
            estimated_fg = np.clip(estimated_fg, 0.0, 255.0)
            mix = np.clip((1.0 - alpha_n) * 0.85, 0.0, 0.90)[:, :, np.newaxis]
            rgb_clean = np.where(edge_mask[:, :, np.newaxis], rgb * (1.0 - mix) + estimated_fg * mix, rgb_clean)

        rgb_clean[alpha <= 0.0] = 0.0

        self.log(
            "   Chroma key background: "
            f"sampled RGB=({int(bg_rgb[0])},{int(bg_rgb[1])},{int(bg_rgb[2])}), "
            f"key RGB=({int(key_rgb[0])},{int(key_rgb[1])},{int(key_rgb[2])}), "
            f"removed {connected_ratio * 100:.1f}% of pixels "
            f"({near_key_internal_count} near-key internal px, {matte_backend})."
        )

        rgba = np.dstack([
            np.clip(rgb_clean[:, :, 0], 0.0, 255.0).astype(np.uint8),
            np.clip(rgb_clean[:, :, 1], 0.0, 255.0).astype(np.uint8),
            np.clip(rgb_clean[:, :, 2], 0.0, 255.0).astype(np.uint8),
            np.clip(alpha, 0.0, 255.0).astype(np.uint8),
        ])

        out = Image.fromarray(rgba, mode="RGBA")
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()

    def remove_bg_from_bytes(self, data):
        """Helper to remove background from bytes using a cached session."""
        cache_subdir = os.path.join(self.cache_dir, "bg_remove")
        os.makedirs(cache_subdir, exist_ok=True)
        if not hasattr(self, "_bg_remove_cache"):
            self._bg_remove_cache = {}

        mode = "chroma_v6" if self.state["config"].get("use_greenscreen") else "rembg"
        cache_key = hashlib.sha1(mode.encode("ascii") + b"|" + data).hexdigest()
        cached = self._bg_remove_cache.get(cache_key)
        if cached is not None:
            self.log("   Background removal cache hit. Reusing previous result.")
            return cached
        cache_file = os.path.join(cache_subdir, f"{cache_key}.bin")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "rb") as f:
                    disk_bytes = f.read()
                self._bg_remove_cache[cache_key] = disk_bytes
                self.log("   Background removal cache hit (disk). Reusing previous result.")
                return disk_bytes
            except Exception:
                pass

        if self.state["config"].get("use_greenscreen"):
            if not hasattr(self, "_greenscreen_notice_shown"):
                self.log("   Chroma key mode enabled: sampling border background + despill.")
                self._greenscreen_notice_shown = True
            try:
                out = self.remove_bg_greenscreen_from_bytes(data)
                if len(self._bg_remove_cache) >= 12:
                    oldest_key = next(iter(self._bg_remove_cache))
                    self._bg_remove_cache.pop(oldest_key, None)
                self._bg_remove_cache[cache_key] = out
                try:
                    with open(cache_file, "wb") as f:
                        f.write(out)
                except Exception:
                    pass
                return out
            except Exception as e:
                self.log(f"   Chroma key fallback to BiRefNet: {e}")

        if not hasattr(self, "_rembg_session"):
            try:
                self._rembg_session = rembg.new_session("birefnet-general")
            except Exception:
                self.log("   BiRefNet unavailable, falling back to default U2Net.")
                self._rembg_session = rembg.new_session()
        out = rembg.remove(data, session=self._rembg_session)
        if len(self._bg_remove_cache) >= 12:
            oldest_key = next(iter(self._bg_remove_cache))
            self._bg_remove_cache.pop(oldest_key, None)
        self._bg_remove_cache[cache_key] = out
        try:
            with open(cache_file, "wb") as f:
                f.write(out)
        except Exception:
            pass
        return out

    def save_config_from_ui(self):
        api_key = self.api_key_entry.get().strip()
        self.state["config"]["api_key"] = api_key
        self.save_env_api_key_if_changed(api_key)
        self.state["config"]["model"] = self.model_entry.get().strip()
        self.state["config"]["char_name"] = self.char_name_entry.get()
        self.state["config"]["eye_color"] = self.eye_color_entry.get().strip()
        
        self.state["config"]["selected_expressions"] = [k for k,v in self.expr_vars.items() if v.get()]
        self.state["config"]["selected_angles"] =[k for k,v in self.angle_vars.items() if v.get()]
        
        self.state["config"]["prompt_expression"] = self.prompt_expr_text.get("1.0", tk.END).strip()
        self.state["config"]["prompt_angle"] = self.prompt_angle_text.get("1.0", tk.END).strip()
        self.state["config"]["prompt_post"] = self.prompt_post_text.get("1.0", tk.END).strip()
        self.state["config"]["upscale_4x"] = self.upscale_var.get()
        self.state["config"]["compress_final_webp"] = self.compress_final_webp_var.get()
        self.state["config"]["use_greenscreen"] = self.greenscreen_var.get()
        self.state["config"]["fit_sprite_to_frame"] = self.fit_sprite_to_frame_var.get()
        self.state["config"]["use_alignment_warping"] = self.alignment_warping_var.get()
        self.state["config"]["use_canny_head_align"] = self.canny_head_align_var.get()
        self.state["config"]["use_context_micro_align"] = self.state["config"]["use_canny_head_align"]
        self.state["config"]["normalize_skin_tone"] = self.normalize_skin_tone_var.get()
        self.state["config"]["symmetric_sprite"] = self.symmetric_sprite_var.get()
        self.state["config"]["use_local_comfyui"] = self.use_local_comfyui_var.get()
        self.state["config"]["comfyui_url"] = (self.state["config"].get("comfyui_url") or "http://127.0.0.1:8188").strip()
        self.state["config"]["comfyui_workflow_path"] = (self.state["config"].get("comfyui_workflow_path") or os.path.join(SPRITE_GENERATOR_ROOT, "workflow_flux.json")).strip()

        self._normalize_reference_config()
        self.save_state()

    def save_env_api_key_if_changed(self, api_key):
        if api_key == getattr(self, "_last_saved_env_api_key", None):
            return

        env_path = os.path.join(SPRITE_GENERATOR_ROOT, ".env")
        lines = []
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as env_file:
                    lines = env_file.read().splitlines()
            except Exception as e:
                self.log(f"Error reading .env for API key save: {e}")
                return

        updated = False
        out_lines = []
        for line in lines:
            if line.startswith("NANOGPT_API_KEY="):
                out_lines.append(f"NANOGPT_API_KEY={api_key}")
                updated = True
            else:
                out_lines.append(line)
        if not updated:
            out_lines.append(f"NANOGPT_API_KEY={api_key}")

        try:
            with open(env_path, "w", encoding="utf-8") as env_file:
                env_file.write("\n".join(out_lines) + "\n")
            self._last_saved_env_api_key = api_key
            self.log("Saved NanoGPT API key to .env.")
        except Exception as e:
            self.log(f"Error saving NanoGPT API key to .env: {e}")
    def load_env_key(self):
        """Loads a NanoGPT API key from the Sprite_Generator .env file."""
        try:
            return (
                load_env_key_from_disk(SPRITE_GENERATOR_ROOT, "NANOGPT_API_KEY")
                or load_env_key_from_disk(SPRITE_GENERATOR_ROOT)
            )
        except Exception as e:
            self.log(f"Error reading .env: {e}")
            return None
    def save_state(self):
        try:
            save_state_file(STATE_FILE, self.state)
        except Exception as e:
            self.log(f"Error saving state: {e}")

    def load_state(self):
        try:
            data = load_state_file(STATE_FILE)
            if not data and os.path.exists(LEGACY_STATE_FILE):
                data = load_state_file(LEGACY_STATE_FILE)
                if data:
                    save_state_file(STATE_FILE, data)
                    self.log("Migrated saved state from state_wisdom.json to state.json.")
            if "config" in data:
                # API keys are intentionally never read from the persisted state.
                data["config"].pop("api_key", None)
                self.state["config"].update(data["config"])
            self.state["config"].pop("use_advanced_model", None)
            if "use_canny_head_align" not in self.state["config"]:
                self.state["config"]["use_canny_head_align"] = self.state["config"].get("use_context_micro_align", True)
            self.state["config"]["use_context_micro_align"] = self.state["config"].get("use_canny_head_align", True)
            tasks = data.get("tasks", [])
            for t in tasks:
                t.pop("prompt", None)
            self.state["tasks"] = tasks
        except Exception as e:
            self.log(f"Error loading state: {e}")
        
        # Always attempt to override/fill API key from .env
        env_key = self.load_env_key()
        if env_key:
            self.state["config"]["api_key"] = env_key
            
        self._normalize_reference_config()

    def refresh_task_view(self):
        for w in self.gallery_frame.winfo_children(): w.destroy()
        self.thumbnails.clear()

        # Update scrollregion once when beginning or periodically
        def update_scroll():
            self.gallery_frame.update_idletasks()
            self.canvas.configure(scrollregion=self.canvas.bbox("all"))

        r, c = 0, 0
        zoom = self.zoom_level
        # Calculate columns based on zoom and canvas width
        canvas_width = self.canvas.winfo_width()
        if canvas_width < 100: canvas_width = 800 # fallback
        cols = max(1, canvas_width // (zoom + 20))

        img_count = 0
        limit = 12
        for task in reversed(self.state.get("tasks", [])):
            if img_count >= limit: break
            if task["status"] == "SUCCESS":
                if task["type"] in ("LOCAL_PROCESS", "LOCAL_FLIP"):
                    base_id = task["id"].replace("_local", "")
                    post_id = base_id + "_post"
                    # debug/intermediate files stay in output_sprites
                    # Show finals first
                    files = [
                        (FINAL_DIR,  f"{base_id}_talk_blink.webp"),
                        (FINAL_DIR,  f"{base_id}_talk.webp"),
                        (FINAL_DIR,  f"{base_id}_blink.webp"),
                        (FINAL_DIR,  f"{base_id}.webp"),
                        (OUTPUT_DIR, f"{base_id}_debug_samples_palette_base.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_samples_palette_post.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_samples_points_base.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_samples_points_post.png"),
                        (OUTPUT_DIR, f"{base_id}_no_bg.webp"),
                        (OUTPUT_DIR, f"{post_id}_no_bg.webp"),
                        (OUTPUT_DIR, f"{base_id}_debug_warp.jpg"),
                        (OUTPUT_DIR, f"{base_id}_debug_abc.jpg"),
                        (OUTPUT_DIR, f"{base_id}_debug_remove_hair.jpg"),
                        (OUTPUT_DIR, f"{base_id}_debug_face_only_no_hair.jpg"),
                        (OUTPUT_DIR, f"{base_id}_debug_face_soft_mask.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_eye_hard_mask.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_nose_protect_mask.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_nose_ink_islands.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_eye_blend_mask.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_canny_base.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_canny_post.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_canny_post_warped.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_canny_overlay.png"),
                        (OUTPUT_DIR, f"{base_id}_debug_landmarks.jpg"),
                        (OUTPUT_DIR, f"{base_id}_debug_landmarks_numbered.jpg"),
                    ]
                else:
                    files = [(OUTPUT_DIR, f"{task['id']}.webp")]

                for folder, filename in files:
                    if img_count >= limit: break
                    path = os.path.join(folder, filename)
                    if os.path.exists(path):
                        try:
                            img = Image.open(path)
                            img.thumbnail((zoom, zoom))
                            photo = ImageTk.PhotoImage(img)
                            self.thumbnails.append(photo)
                            label_text = f"{'final/' if folder == FINAL_DIR else ''}{filename}"
                            tk.Label(self.gallery_frame, image=photo, text=label_text,
                                     compound="bottom", bg=self.bg_color, fg=self.fg_color
                                     ).grid(row=r, column=c, padx=5, pady=5)
                            img_count += 1
                            c += 1
                            if c >= cols: c, r = 0, r+1
                        except Exception as e:
                            self.log(f"Error loading {filename}: {e}")

        update_scroll()
        self.update_progress_tracker()

    def on_zoom_change(self, val):
        self.zoom_level = int(val)
        # Use a small delay/after to avoid excessive UI lag during sliding
        if hasattr(self, "_zoom_timer"):
            self.after_cancel(self._zoom_timer)
        self._zoom_timer = self.after(100, self.refresh_task_view)

