import math
import os
import re
import subprocess
import time
import tkinter as tk
from tkinter import ttk

import numpy as np
from PIL import Image, ImageDraw, ImageTk

from app.constants import (
    OUTPUT_DIR,
    REGION_ALPHA_SOLID_THRESHOLD,
    REGION_SCALE_SNAP_EPS,
    REGION_TOP_RESAMPLE,
)

class ManualAlignmentPopup(tk.Toplevel):
    def __init__(self, parent, base_img, top_img, init_mask_f, title, init_offset=(0.0, 0.0), init_scale=1.0):
        super().__init__(parent)
        self.title(title)
        self.geometry("1700x920")
        self.base_img = base_img.convert("RGBA")
        self.top_img = top_img.convert("RGBA")
        self.w, self.h = base_img.size

        self.view_zoom = tk.DoubleVar(value=1.0)
        self.brush_size = tk.IntVar(value=30)
        self.brush_size_slider = tk.DoubleVar(value=self.brush_size_to_slider(30))
        self.brush_hardness = tk.DoubleVar(value=0.5)
        self.tool = tk.StringVar(value="Erase")
        self.layer_opacity = tk.IntVar(value=255)
        self.brush_size_value = tk.StringVar()
        self.brush_hardness_value = tk.StringVar()
        self.layer_opacity_value = tk.StringVar()
        self.view_zoom_value = tk.StringVar()
        self._syncing_brush_slider = False

        self.brush_stamp = None
        self.top_s = None
        self.prev_scale = None

        # Numpy caches — the key to speed
        self._base_arr = np.array(self.base_img)        # computed ONCE, never changes
        self._top_s_arr = None                           # rebuilt only when scale changes
        self._mask_s_arr = None                          # rebuilt only when painting or scale changes
        self._canvas_img_id = None
        self._paint_render_pending = False
        self._is_painting = False

        self.mask = Image.fromarray((init_mask_f * 255).astype(np.uint8)).convert("L")
        self.offset_x, self.offset_y = float(init_offset[0]), float(init_offset[1])
        self.scale = float(init_scale)
        self.opacity = 255
        self.external_composite_path = ""
        self.external_export_base_path = ""

        self.update_brush_stamps()
        self.setup_ui()
        self.render()

        self.protocol("WM_DELETE_WINDOW", self.on_ok)
        self.bind("<Return>", lambda e: self.on_ok())
        self.bind("<Escape>", lambda e: self.on_ok())
        self.bind("]", lambda e: self.nudge_brush_size(1))
        self.bind("[", lambda e: self.nudge_brush_size(-1))
        self.bind("<Control-z>", lambda e: None)

        self.brush_size_slider.trace_add("write", lambda *args: self.on_brush_size_slider_changed())
        self.brush_size.trace_add("write", lambda *args: self.on_brush_size_changed())
        self.brush_hardness.trace_add("write", lambda *args: self.on_brush_hardness_changed())
        self.layer_opacity.trace_add("write", lambda *args: self.update_control_labels())
        self.view_zoom.trace_add("write", lambda *args: self.update_control_labels())
        self.update_control_labels()

    BRUSH_MIN_SIZE = 1
    BRUSH_MAX_SIZE = 512

    def brush_size_to_slider(self, size):
        size = max(self.BRUSH_MIN_SIZE, min(self.BRUSH_MAX_SIZE, float(size)))
        return 100.0 * (math.log(size / self.BRUSH_MIN_SIZE) / math.log(self.BRUSH_MAX_SIZE / self.BRUSH_MIN_SIZE))

    def slider_to_brush_size(self, slider_value):
        t = max(0.0, min(100.0, float(slider_value))) / 100.0
        size = self.BRUSH_MIN_SIZE * ((self.BRUSH_MAX_SIZE / self.BRUSH_MIN_SIZE) ** t)
        return int(round(max(self.BRUSH_MIN_SIZE, min(self.BRUSH_MAX_SIZE, size))))

    def set_brush_size(self, size):
        size = int(round(max(self.BRUSH_MIN_SIZE, min(self.BRUSH_MAX_SIZE, size))))
        if size != self.brush_size.get():
            self.brush_size.set(size)
        else:
            self.update_control_labels()

    def nudge_brush_size(self, direction):
        current = int(self.brush_size.get())
        if current < 24:
            step = 1
        elif current < 96:
            step = 4
        else:
            step = 12
        self.set_brush_size(current + (step * int(direction)))

    def on_brush_size_slider_changed(self):
        if self._syncing_brush_slider:
            return
        self.set_brush_size(self.slider_to_brush_size(self.brush_size_slider.get()))

    def on_brush_size_changed(self):
        self.update_brush_stamps()
        self.update_control_labels()
        target = self.brush_size_to_slider(self.brush_size.get())
        if abs(float(self.brush_size_slider.get()) - target) > 0.25:
            self._syncing_brush_slider = True
            try:
                self.brush_size_slider.set(target)
            finally:
                self._syncing_brush_slider = False

    def on_brush_hardness_changed(self):
        self.update_brush_stamps()
        self.update_control_labels()

    def update_control_labels(self):
        if hasattr(self, "brush_size_value"):
            self.brush_size_value.set(f"{int(self.brush_size.get())} px")
        if hasattr(self, "brush_hardness_value"):
            self.brush_hardness_value.set(f"{float(self.brush_hardness.get()):.2f}")
        if hasattr(self, "layer_opacity_value"):
            opacity = int(self.layer_opacity.get())
            self.layer_opacity_value.set(f"{opacity}/255 ({opacity / 255.0:.0%})")
        if hasattr(self, "view_zoom_value"):
            self.view_zoom_value.set(f"{float(self.view_zoom.get()):.1f}x")

    def add_sidebar_scale(self, parent, title, value_var, scale_var, from_, to, command=None, resolution=None):
        frame = ttk.Frame(parent)
        frame.pack(fill="x", pady=(10, 2))
        header = ttk.Frame(frame)
        header.pack(fill="x")
        ttk.Label(header, text=title).pack(side="left")
        ttk.Label(header, textvariable=value_var).pack(side="right")

        kwargs = {
            "from_": from_,
            "to": to,
            "orient": "horizontal",
            "variable": scale_var,
            "showvalue": False,
            "length": 190,
            "highlightthickness": 0,
        }
        if resolution is not None:
            kwargs["resolution"] = resolution
        if command is not None:
            kwargs["command"] = command
        scale = tk.Scale(frame, **kwargs)
        scale.pack(fill="x")
        return scale

    def setup_ui(self):
        root = ttk.Frame(self, padding=5)
        root.pack(fill="both", expand=True)

        sidebar = ttk.Frame(root, padding=(8, 6), width=240)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        canvas_panel = ttk.Frame(root)
        canvas_panel.pack(side="right", fill="both", expand=True)

        ttk.Label(sidebar, text="Manual Align", font=("Segoe UI Semibold", 11)).pack(anchor="w", pady=(0, 8))

        tool_frame = ttk.LabelFrame(sidebar, text="Tool", padding=6)
        tool_frame.pack(fill="x", pady=(0, 8))
        ttk.Radiobutton(tool_frame, text="Erase", variable=self.tool, value="Erase").pack(anchor="w")
        ttk.Radiobutton(tool_frame, text="Restore (Shift)", variable=self.tool, value="Restore").pack(anchor="w")

        brush_frame = ttk.LabelFrame(sidebar, text="Brush", padding=6)
        brush_frame.pack(fill="x", pady=(0, 8))
        self.add_sidebar_scale(
            brush_frame,
            "Size",
            self.brush_size_value,
            self.brush_size_slider,
            0,
            100,
            resolution=0.1,
        )
        self.add_sidebar_scale(
            brush_frame,
            "Hardness",
            self.brush_hardness_value,
            self.brush_hardness,
            0.0,
            1.0,
            resolution=0.01,
        )
        ttk.Label(
            brush_frame,
            text=f"Size is logarithmic: fine control at small sizes, up to {self.BRUSH_MAX_SIZE}px.",
            wraplength=190,
            foreground="#666",
        ).pack(anchor="w", pady=(4, 0))

        view_frame = ttk.LabelFrame(sidebar, text="View", padding=6)
        view_frame.pack(fill="x", pady=(0, 8))
        self.add_sidebar_scale(
            view_frame,
            "Layer Opacity",
            self.layer_opacity_value,
            self.layer_opacity,
            0,
            255,
            command=lambda _value=None: self.render(),
        )
        self.add_sidebar_scale(
            view_frame,
            "View Zoom",
            self.view_zoom_value,
            self.view_zoom,
            0.5,
            4.0,
            command=lambda _value=None: self.render(),
            resolution=0.1,
        )

        align_frame = ttk.LabelFrame(sidebar, text="Layer Align", padding=6)
        align_frame.pack(fill="x", pady=(0, 8))
        ttk.Button(align_frame, text="Scale +", command=lambda: self.adjust_scale(1.01)).pack(fill="x", pady=2)
        ttk.Button(align_frame, text="Scale -", command=lambda: self.adjust_scale(0.99)).pack(fill="x", pady=2)

        external_frame = ttk.LabelFrame(sidebar, text="External Edit", padding=6)
        external_frame.pack(fill="x", pady=(0, 8))
        ttk.Button(external_frame, text="Export To paint.NET", command=self.export_to_paintdotnet).pack(fill="x", pady=2)
        ttk.Button(external_frame, text="Import Aligned Image", command=self.import_external_aligned_layer).pack(fill="x", pady=2)

        self.external_status_var = tk.StringVar(value="External align: not imported. Export first, then Import (auto).")
        ttk.Label(sidebar, textvariable=self.external_status_var, wraplength=205).pack(anchor="w", fill="x", pady=(4, 8))

        ttk.Button(sidebar, text="OK / FINISH", command=self.on_ok, style="Accent.TButton").pack(side="bottom", fill="x", pady=(8, 0))

        self.canvas = tk.Canvas(canvas_panel, bg="#333", width=self.w, height=self.h)
        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<B1-Motion>", self.on_paint)
        self.canvas.bind("<Button-1>", self.on_paint)
        self.canvas.bind("<ButtonRelease-1>", self._on_paint_release)
        self.canvas.bind("<B3-Motion>", self.on_drag)
        self.canvas.bind("<Button-3>", self.start_drag)
        self.canvas.bind("<Motion>", self.update_brush_cursor)

    def update_brush_cursor(self, event):
        self.canvas.delete("brush_cursor")
        z = self.view_zoom.get()
        r = self.brush_size.get() * z
        self.canvas.create_oval(event.x - r, event.y - r, event.x + r, event.y + r, outline="white", tags="brush_cursor")

    def start_drag(self, event):
        self._drag_start = (event.x, event.y)
        self._orig_offset = (self.offset_x, self.offset_y)

    def on_drag(self, event):
        z = self.view_zoom.get()
        dx = (event.x - self._drag_start[0]) / z
        dy = (event.y - self._drag_start[1]) / z
        self.offset_x = self._orig_offset[0] + dx
        self.offset_y = self._orig_offset[1] + dy
        
        # Throttle drag renders
        if not getattr(self, "_paint_render_pending", False):
            self._paint_render_pending = True
            self.after(16, self._deferred_render)

    def adjust_scale(self, factor):
        self.scale *= factor
        self.render()

    def _compose_current_top_on_transparent(self):
        eff_scale = 1.0 if abs(self.scale - 1.0) < REGION_SCALE_SNAP_EPS else self.scale
        sw, sh = int(self.w * eff_scale), int(self.h * eff_scale)
        if sw < 1 or sh < 1:
            return None
        top_s = self.top_img.resize((sw, sh), REGION_TOP_RESAMPLE)
        canvas = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        canvas.paste(top_s, (int(self.offset_x), int(self.offset_y)), top_s)
        return canvas

    def export_to_paintdotnet(self):
        out_dir = os.path.join(OUTPUT_DIR, "external_align")
        os.makedirs(out_dir, exist_ok=True)

        stamp = int(time.time() * 1000)
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", self.title()).strip("_").lower() or "region"
        base_path = os.path.join(out_dir, f"{slug}_{stamp}_base.png")
        top_path = os.path.join(out_dir, f"{slug}_{stamp}_top_layer_start.png")
        readme_path = os.path.join(out_dir, f"{slug}_{stamp}_README.txt")

        self.base_img.save(base_path, format="PNG")
        self.external_export_base_path = base_path
        top_layer = self._compose_current_top_on_transparent()
        if top_layer is None:
            self.external_status_var.set("External align export failed: invalid current scale.")
            return
        top_layer.save(top_path, format="PNG")

        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(
                "External alignment workflow (paint.NET)\n"
                "1) Open base and top_layer_start.\n"
                "2) Move/scale top_layer_start as needed.\n"
                "3) Merge/copy the overlay onto BASE until the BASE image is final.\n"
                "4) Save BASE (same file, same canvas size).\n"
                "5) Back in this popup, click 'Import Aligned Layer' (auto-loads that BASE file).\n"
            )

        launched = False
        candidates = [
            "paintdotnet.exe",
            r"C:\\Program Files\\paint.net\\paintdotnet.exe",
            r"C:\\Program Files\\paint.net\\PaintDotNet.exe",
        ]
        for exe in candidates:
            try:
                if os.path.isabs(exe) and not os.path.exists(exe):
                    continue
                subprocess.Popen([exe, base_path, top_path])
                launched = True
                break
            except Exception:
                continue

        if not launched:
            try:
                os.startfile(out_dir)
            except Exception:
                pass

        self.external_status_var.set(
            f"Exported. Edit and save BASE, then click Import (auto): {os.path.basename(base_path)}"
        )

    def import_external_aligned_layer(self):
        path = self.external_export_base_path
        if not path:
            self.external_status_var.set("Import failed: export to paint.NET first (no manual browse needed).")
            return
        if not os.path.exists(path):
            self.external_status_var.set(f"Import failed: expected BASE file not found: {os.path.basename(path)}")
            return

        try:
            with Image.open(path) as img:
                composited = img.convert("RGBA")
        except Exception as e:
            self.external_status_var.set(f"Import failed: {e}")
            return

        if composited.size != (self.w, self.h):
            self.external_status_var.set(
                f"Import failed: expected {self.w}x{self.h}, got {composited.size[0]}x{composited.size[1]}"
            )
            return

        out_dir = os.path.join(OUTPUT_DIR, "external_align")
        os.makedirs(out_dir, exist_ok=True)
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", self.title()).strip("_").lower() or "region"
        normalized = os.path.join(out_dir, f"{slug}_imported_composited_{int(time.time() * 1000)}.png")
        composited.save(normalized, format="PNG")
        self.external_composite_path = normalized
        self.external_status_var.set(f"Imported composited BASE automatically: {os.path.basename(normalized)}")

    def update_brush_stamps(self):
        # Brush size is in BASE image pixels (not top/scaled coords)
        radius = self.brush_size.get()
        r_int = int(radius)
        size = r_int * 2 + 2
        if size < 1: return
        
        hardness = self.brush_hardness.get()
        
        # Create a single high-quality smooth stamp
        self.brush_stamp = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(self.brush_stamp)
        
        for r in range(r_int, 0, -1):
            ratio = r / radius
            alpha = 255 if ratio < hardness else int(255 * (1.0 - (ratio - hardness) / (1.0 - hardness + 1e-6)))
            draw.ellipse([r_int-r, r_int-r, r_int+r, r_int+r], fill=alpha)

    def on_paint(self, event):
        x, y = event.x, event.y
        z = self.view_zoom.get()
        bx, by = x / z, y / z

        self.update_brush_cursor(event)

        is_restore = (self.tool.get() == "Restore")
        if event.state & 0x0001: # Shift key
            is_restore = not is_restore

        color = 255 if is_restore else 0
        radius = self.brush_size.get()

        # ALWAYS use the same smooth stamp as the alpha mask for the paste
        # This ensures erasing (color=0) is just as smooth as restoring (color=255)
        self.mask.paste(color, (int(bx - radius), int(by - radius)), self.brush_stamp)

        # Throttle renders
        if not getattr(self, "_paint_render_pending", False):
            self._paint_render_pending = True
            self._is_painting = True
            self.after(16, self._deferred_render)

    def _on_paint_release(self, event):
        """On mouse-up: do a final full-quality render."""
        self._is_painting = False
        self.render()

    def _deferred_render(self):
        self._paint_render_pending = False
        self.render()

    def render(self):
        z = self.view_zoom.get()
        eff_scale = 1.0 if abs(self.scale - 1.0) < REGION_SCALE_SNAP_EPS else self.scale
        scale_changed = (eff_scale != self.prev_scale)

        # Rebuild top_s and its cached numpy array only when scale or initial
        if scale_changed or self.top_s is None:
            sw, sh = int(self.w * eff_scale), int(self.h * eff_scale)
            if sw < 1 or sh < 1:
                return
            # BICUBIC is gentler on anime lineart than LANCZOS for tiny scale nudges.
            self.top_s = self.top_img.resize((sw, sh), REGION_TOP_RESAMPLE)
            self._top_s_arr = np.array(self.top_s)
            self.prev_scale = eff_scale
            self.update_brush_stamps()

        if self._top_s_arr is None:
            self._top_s_arr = np.array(self.top_s)

        sw, sh = self.top_s.size
        opacity_factor = self.layer_opacity.get() / 255.0

        # Mask is in BASE space — read it directly, no resize needed
        mask_arr = np.array(self.mask).astype(np.float32)

        # --- Full numpy composite (no PIL paste) ---
        bh, bw = self._base_arr.shape[:2]
        ox, oy = int(self.offset_x), int(self.offset_y)
        x0, y0 = max(0, ox), max(0, oy)
        x1, y1 = min(bw, ox + sw), min(bh, oy + sh)

        result = self._base_arr.copy()   # unavoidable allocation to protect source
        if x1 > x0 and y1 > y0:
            tx0, ty0 = x0 - ox, y0 - oy
            tx1, ty1 = tx0 + (x1 - x0), ty0 + (y1 - y0)

            top_f  = self._top_s_arr[ty0:ty1, tx0:tx1, :3].astype(np.float32)
            base_f = result[y0:y1, x0:x1, :3].astype(np.float32)
            orig_a = self._top_s_arr[ty0:ty1, tx0:tx1, 3].astype(np.float32)

            # Index mask in BASE space [y0:y1, x0:x1] — matches base canvas coords
            # mask_arr is 0-255 so divide by 255 to get 0-1.
            # opacity_factor is already 0-1 (layer_opacity / 255.0 above) — do NOT divide again.
            mask_bin = np.clip(mask_arr[y0:y1, x0:x1] / 255.0, 0.0, 1.0).astype(np.float32)
            a = np.where(
                orig_a >= REGION_ALPHA_SOLID_THRESHOLD,
                mask_bin * opacity_factor,
                0.0
            )[:, :, np.newaxis]

            # Vectorized blend: top*a + base*(1-a)
            result[y0:y1, x0:x1, :3] = (top_f * a + base_f * (1.0 - a)).clip(0, 255).astype(np.uint8)
            result[y0:y1, x0:x1,  3] = 255

        # Apply view zoom (NEAREST = fast, fine for interactive display)
        if z != 1.0:
            zw, zh = int(self.w * z), int(self.h * z)
            disp_img = Image.fromarray(result).resize((zw, zh), Image.NEAREST)
        else:
            disp_img = Image.fromarray(result)

        # Clamp to canvas size — don't create a PhotoImage larger than the visible area
        cw = self.canvas.winfo_width()
        ch = self.canvas.winfo_height()
        if cw > 1 and ch > 1:
            dw, dh = disp_img.size
            if dw > cw or dh > ch:
                disp_img = disp_img.crop((0, 0, min(dw, cw), min(dh, ch)))

        self.photo = ImageTk.PhotoImage(disp_img)
        if self._canvas_img_id is None:
            self._canvas_img_id = self.canvas.create_image(0, 0, image=self.photo, anchor="nw", tags="img")
            self.canvas.tag_lower("img")
        else:
            self.canvas.itemconfig(self._canvas_img_id, image=self.photo)

    def on_ok(self):
        if hasattr(self, "on_finish"):
            # Return mask and offsets relative to the scale of the images passed in
            self.on_finish(self.mask, (self.offset_x, self.offset_y), self.scale, self.external_composite_path or None)
        self.destroy()
