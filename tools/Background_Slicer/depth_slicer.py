"""
Depth Slicer: split a photo into foreground/background using depth plus SAM2 refinement.

Requirements (install once):
    pip install -r requirements.txt

Usage:
    python depth_slicer.py
"""

import sys
import threading
from contextlib import nullcontext
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from PyQt6.QtCore import QPoint, QRect, Qt, QThread, QTimer, pyqtSignal
from PyQt6.QtGui import QColor, QImage, QMouseEvent, QPainter, QPalette, QPen, QPixmap
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSizePolicy,
    QSlider,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
    QFileDialog,
)


# Colors
BG = "#0d0f14"
SURFACE = "#161a23"
PANEL = "#1e2330"
ACCENT = "#5b8af0"
ACCENT2 = "#a78bfa"
TEXT = "#e8eaf6"
SUBTEXT = "#8892a4"
BORDER = "#2a3045"

MODEL_PRESETS = [
    ("MiDaS SwinV2 Tiny (fast)", "Intel/dpt-swinv2-tiny-256"),
    ("Depth Anything V2 Small (balanced)", "depth-anything/Depth-Anything-V2-Small-hf"),
    ("Depth Anything V2 Base (detail)", "depth-anything/Depth-Anything-V2-Base-hf"),
    ("Depth Anything V2 Large (max detail)", "depth-anything/Depth-Anything-V2-Large-hf"),
    ("DPT Large / MiDaS 3.0", "Intel/dpt-large"),
]

SAM2_MODEL_ID = "facebook/sam2.1-hiera-large"


def numpy_rgba_to_qpixmap(arr: np.ndarray) -> QPixmap:
    """Convert HxWx4 uint8 RGBA array to QPixmap."""
    h, w = arr.shape[:2]
    arr_c = np.ascontiguousarray(arr, dtype=np.uint8)
    qimg = QImage(arr_c.data, w, h, w * 4, QImage.Format.Format_RGBA8888).copy()
    return QPixmap.fromImage(qimg)


def numpy_rgb_to_qpixmap(arr: np.ndarray) -> QPixmap:
    """Convert HxWx3 uint8 RGB array to QPixmap."""
    h, w = arr.shape[:2]
    arr_c = np.ascontiguousarray(arr, dtype=np.uint8)
    qimg = QImage(arr_c.data, w, h, w * 3, QImage.Format.Format_RGB888).copy()
    return QPixmap.fromImage(qimg)


class DepthWorker(QThread):
    progress = pyqtSignal(str)
    finished = pyqtSignal(np.ndarray)
    error = pyqtSignal(str)

    def __init__(self, image_path: str, model_id: str):
        super().__init__()
        self.image_path = image_path
        self.model_id = model_id

    def run(self):
        try:
            self.progress.emit(f"Loading model: {self.model_id}")
            from transformers import pipeline as hf_pipeline

            pipe = hf_pipeline(task="depth-estimation", model=self.model_id)
            self.progress.emit("Running depth estimation...")

            img = Image.open(self.image_path).convert("RGB")
            result = pipe(img)
            depth_pil = result["depth"]

            depth_arr = np.array(depth_pil, dtype=np.float32)
            d_min, d_max = depth_arr.min(), depth_arr.max()
            if d_max > d_min:
                depth_arr = (depth_arr - d_min) / (d_max - d_min)
            else:
                depth_arr = np.zeros_like(depth_arr)

            self.finished.emit(depth_arr)
        except Exception as exc:
            self.error.emit(str(exc))


class SAM2Session:
    """Lazily-loaded SAM2 image predictor with cached image embeddings."""

    _instance = None
    _class_lock = threading.Lock()

    def __init__(self, model_id: str):
        import torch
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        self.torch = torch
        self.model_id = model_id
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device_note = ""

        if self.device == "cuda":
            try:
                major, minor = torch.cuda.get_device_capability(0)
                required_arch = f"sm_{major}{minor}"
                compiled_arches = set(torch.cuda.get_arch_list())
                if required_arch not in compiled_arches:
                    self.device_note = (
                        f"GPU arch {required_arch} missing from torch build "
                        f"({', '.join(sorted(compiled_arches))}). Falling back to CPU."
                    )
                    self.device = "cpu"
            except Exception:
                # If capability probing fails, keep the default and let runtime checks handle it.
                pass

        # Force predictor device explicitly; some builds default to CUDA paths
        # and fail on CPU-only torch installations.
        try:
            self.predictor = SAM2ImagePredictor.from_pretrained(model_id, device=self.device)
        except Exception as exc:
            msg = str(exc).lower()
            if self.device == "cuda" and ("cuda" in msg or "not compiled with cuda" in msg):
                self.device = "cpu"
                self.predictor = SAM2ImagePredictor.from_pretrained(model_id, device="cpu")
            else:
                raise

        if hasattr(self.predictor, "device"):
            try:
                self.predictor.device = self.device
            except Exception:
                pass

        if hasattr(self.predictor, "model"):
            try:
                self.predictor.model.to(self.device)
            except Exception:
                # Some builds already place the model correctly.
                pass
        self.image_token = None
        self.predict_lock = threading.Lock()

    @classmethod
    def get(cls):
        with cls._class_lock:
            if cls._instance is None:
                cls._instance = SAM2Session(SAM2_MODEL_ID)
            return cls._instance

    @classmethod
    def clear_cached_image(cls):
        with cls._class_lock:
            if cls._instance is not None:
                cls._instance.image_token = None

    def _autocast_context(self):
        if self.device != "cuda":
            return nullcontext()
        if self.torch.cuda.is_bf16_supported():
            return self.torch.autocast(device_type="cuda", dtype=self.torch.bfloat16)
        return self.torch.autocast(device_type="cuda", dtype=self.torch.float16)

    def _ensure_image(self, image_rgb: np.ndarray, image_token: str):
        if self.image_token == image_token:
            return
        if hasattr(self.predictor, "device"):
            try:
                self.predictor.device = self.device
            except Exception:
                pass
        self.predictor.set_image(image_rgb)
        self.image_token = image_token

    def predict_mask(self, image_rgb: np.ndarray, image_token: str, points: list[tuple[int, int, int]], invert_labels: bool) -> np.ndarray:
        h, w = image_rgb.shape[:2]
        if not points:
            return np.zeros((h, w), dtype=bool)

        point_coords = np.array([(p[0], p[1]) for p in points], dtype=np.float32)
        point_labels = np.array([p[2] for p in points], dtype=np.int32)
        if invert_labels:
            point_labels = 1 - point_labels

        # SAM needs at least one positive point for an object prompt.
        if not np.any(point_labels == 1):
            return np.zeros((h, w), dtype=bool)

        with self.predict_lock:
            self._ensure_image(image_rgb, image_token)
            with self.torch.inference_mode():
                with self._autocast_context():
                    masks, scores, _ = self.predictor.predict(
                        point_coords=point_coords,
                        point_labels=point_labels,
                        multimask_output=True,
                    )

        if masks is None or len(masks) == 0:
            return np.zeros((h, w), dtype=bool)

        best_idx = 0
        if scores is not None and len(scores) > 0:
            best_idx = int(np.argmax(scores))
        best_mask = np.asarray(masks[best_idx], dtype=np.float32)
        return best_mask > 0.5


class SamPromptWorker(QThread):
    progress = pyqtSignal(str)
    result = pyqtSignal(int, object, object, str)

    def __init__(self, request_id: int, image_rgb: np.ndarray, image_token: str, points: list[tuple[int, int, int]]):
        super().__init__()
        self.request_id = request_id
        self.image_rgb = image_rgb
        self.image_token = image_token
        self.points = points

    def run(self):
        try:
            h, w = self.image_rgb.shape[:2]
            include_mask = np.zeros((h, w), dtype=bool)
            exclude_mask = np.zeros((h, w), dtype=bool)

            session = SAM2Session.get()
            if session.device_note:
                self.progress.emit(session.device_note)
            has_positive = any(p[2] == 1 for p in self.points)
            has_negative = any(p[2] == 0 for p in self.points)

            if has_positive:
                self.progress.emit("SAM2 include pass...")
                include_mask = session.predict_mask(
                    self.image_rgb,
                    self.image_token,
                    self.points,
                    invert_labels=False,
                )

            if has_negative:
                self.progress.emit("SAM2 exclude pass...")
                exclude_mask = session.predict_mask(
                    self.image_rgb,
                    self.image_token,
                    self.points,
                    invert_labels=True,
                )

            self.result.emit(self.request_id, include_mask, exclude_mask, "")
        except Exception as exc:
            self.result.emit(self.request_id, None, None, str(exc))


class DropZone(QLabel):
    file_dropped = pyqtSignal(str)

    ACCEPTED = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}

    def __init__(self):
        super().__init__()
        self.setAcceptDrops(True)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setMinimumHeight(220)
        self.hovering = False
        self._update_style()
        self._build_content()

    def _build_content(self):
        self.setText("")
        self.setTextFormat(Qt.TextFormat.RichText)
        self.setText(
            "<div style='text-align:center; color:#8892a4;'>"
            "<div style='font-size:42px; margin-bottom:10px;'>DROP</div>"
            "<div style='font-size:15px; font-weight:600; color:#e8eaf6; margin-bottom:6px;'>"
            "Drop an image here</div>"
            "<div style='font-size:12px;'>or click to browse</div>"
            "<div style='font-size:11px; margin-top:10px; color:#4a5568;'>"
            "PNG . JPG . WEBP . BMP . TIFF</div>"
            "</div>"
        )

    def _update_style(self):
        border_col = ACCENT if self.hovering else BORDER
        bg_col = "#1a2035" if self.hovering else SURFACE
        self.setStyleSheet(
            f"""
            QLabel {{
                background: {bg_col};
                border: 2px dashed {border_col};
                border-radius: 16px;
                padding: 20px;
            }}
            """
        )

    def mousePressEvent(self, event: QMouseEvent):
        if event.button() == Qt.MouseButton.LeftButton:
            self._browse()

    def _browse(self):
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Open Image",
            "",
            "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tiff *.tif)",
        )
        if path:
            self.file_dropped.emit(path)

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            urls = event.mimeData().urls()
            if urls and Path(urls[0].toLocalFile()).suffix.lower() in self.ACCEPTED:
                event.acceptProposedAction()
                self.hovering = True
                self._update_style()
                return
        event.ignore()

    def dragLeaveEvent(self, event):
        self.hovering = False
        self._update_style()

    def dropEvent(self, event):
        self.hovering = False
        self._update_style()
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            if Path(path).suffix.lower() in self.ACCEPTED:
                self.file_dropped.emit(path)


class PreviewCanvas(QLabel):
    def __init__(self):
        super().__init__()
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(380, 280)
        self.setStyleSheet(f"background: {SURFACE}; border-radius: 12px;")
        self.pixmap_src = None

    def set_pixmap(self, pixmap: QPixmap):
        self.pixmap_src = pixmap
        self._refresh()

    def resizeEvent(self, event):
        self._refresh()
        super().resizeEvent(event)

    def _refresh(self):
        if self.pixmap_src is None:
            return
        scaled = self.pixmap_src.scaled(
            self.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.setPixmap(scaled)


class ClickableImageCanvas(QWidget):
    point_clicked = pyqtSignal(int, int, int)

    def __init__(self):
        super().__init__()
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(380, 280)
        self.setMouseTracking(True)
        self.setCursor(Qt.CursorShape.CrossCursor)

        self.pixmap_src = None
        self.image_shape = None
        self.points = []
        self._draw_rect = QRect()

    def set_image_rgb(self, image_rgb: np.ndarray | None):
        if image_rgb is None:
            self.pixmap_src = None
            self.image_shape = None
        else:
            self.pixmap_src = numpy_rgb_to_qpixmap(image_rgb)
            self.image_shape = image_rgb.shape[:2]
        self.update()

    def set_points(self, points: list[tuple[int, int, int]]):
        self.points = list(points)
        self.update()

    def _compute_draw_rect(self, pixmap: QPixmap) -> QRect:
        target = pixmap.size()
        target.scale(self.size(), Qt.AspectRatioMode.KeepAspectRatio)
        x = (self.width() - target.width()) // 2
        y = (self.height() - target.height()) // 2
        return QRect(x, y, target.width(), target.height())

    def _map_canvas_to_image(self, pos: QPoint):
        if self.image_shape is None or self._draw_rect.isNull():
            return None
        if not self._draw_rect.contains(pos):
            return None

        h, w = self.image_shape
        rel_x = (pos.x() - self._draw_rect.left()) / max(1, self._draw_rect.width() - 1)
        rel_y = (pos.y() - self._draw_rect.top()) / max(1, self._draw_rect.height() - 1)

        x = int(round(rel_x * (w - 1)))
        y = int(round(rel_y * (h - 1)))
        x = max(0, min(w - 1, x))
        y = max(0, min(h - 1, y))
        return x, y

    def _map_image_to_canvas(self, x: int, y: int):
        if self.image_shape is None or self._draw_rect.isNull():
            return None
        h, w = self.image_shape
        if w <= 1 or h <= 1:
            return None

        rel_x = x / (w - 1)
        rel_y = y / (h - 1)
        px = int(round(self._draw_rect.left() + rel_x * (self._draw_rect.width() - 1)))
        py = int(round(self._draw_rect.top() + rel_y * (self._draw_rect.height() - 1)))
        return px, py

    def mousePressEvent(self, event: QMouseEvent):
        mapped = self._map_canvas_to_image(event.position().toPoint())
        if mapped is None:
            return
        x, y = mapped
        self.point_clicked.emit(x, y, int(event.button().value))

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.fillRect(self.rect(), QColor(SURFACE))

        if self.pixmap_src is None:
            painter.end()
            return

        self._draw_rect = self._compute_draw_rect(self.pixmap_src)
        scaled = self.pixmap_src.scaled(
            self._draw_rect.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        painter.drawPixmap(self._draw_rect.topLeft(), scaled)

        for x, y, label in self.points:
            mapped = self._map_image_to_canvas(x, y)
            if mapped is None:
                continue
            px, py = mapped
            color = QColor("#4ade80" if label == 1 else "#ef4444")
            painter.setPen(QPen(QColor("#0a0a0a"), 2))
            painter.setBrush(color)
            painter.drawEllipse(QPoint(px, py), 7, 7)
            painter.setPen(QPen(QColor("#ffffff"), 2))
            painter.drawLine(px - 4, py, px + 4, py)
            if label == 1:
                painter.drawLine(px, py - 4, px, py + 4)

        painter.end()


class DepthSlider(QWidget):
    value_changed = pyqtSignal(float)

    def __init__(self):
        super().__init__()
        self.setFixedWidth(72)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        top_lbl = QLabel("FAR")
        top_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        top_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:9px; font-weight:700; letter-spacing:1px;")

        self.slider = QSlider(Qt.Orientation.Vertical)
        self.slider.setRange(0, 1000)
        self.slider.setValue(500)
        self.slider.setStyleSheet(
            f"""
            QSlider::groove:vertical {{
                background: {BORDER};
                width: 8px;
                border-radius: 4px;
            }}
            QSlider::handle:vertical {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:1, stop:0 {ACCENT}, stop:1 {ACCENT2});
                border: none;
                height: 22px;
                width: 22px;
                margin: 0 -7px;
                border-radius: 11px;
            }}
            QSlider::sub-page:vertical {{
                background: qlineargradient(x1:0,y1:0,x2:0,y2:1, stop:0 {ACCENT2}, stop:1 {ACCENT});
                border-radius: 4px;
            }}
            """
        )
        self.slider.valueChanged.connect(self._on_change)

        self.value_lbl = QLabel("50%")
        self.value_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.value_lbl.setStyleSheet(f"color:{ACCENT}; font-size:11px; font-weight:700;")

        bot_lbl = QLabel("NEAR")
        bot_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        bot_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:9px; font-weight:700; letter-spacing:1px;")

        layout.addWidget(top_lbl)
        layout.addWidget(self.slider, 1)
        layout.addWidget(self.value_lbl)
        layout.addWidget(bot_lbl)

    def _on_change(self, value: int):
        pct = value / 1000.0
        self.value_lbl.setText(f"{int(pct * 100)}%")
        self.value_changed.emit(pct)

    @property
    def value(self) -> float:
        return self.slider.value() / 1000.0


class DepthSlicerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Depth Slicer")
        self.resize(1120, 730)
        self.setMinimumSize(820, 560)

        self.image_path = None
        self.original_img = None
        self.depth_map = None
        self.depth_worker = None
        self.selected_model = MODEL_PRESETS[0][1]
        self.preview_timer = QTimer()
        self.preview_timer.setSingleShot(True)
        self.preview_timer.setInterval(30)
        self.preview_timer.timeout.connect(self._rebuild_preview)

        # SAM refine state
        self.sam_points = []
        self.sam_include_mask = None
        self.sam_exclude_mask = None
        self.sam_request_id = 0
        self.sam_image_token = None
        self.sam_worker = None
        self.sam_worker_running = False
        self.sam_worker_pending = False
        self.sam_pending_request_id = 0
        self.sam_pending_points = []
        self.sam_last_error = ""

        self._apply_global_style()
        self._build_ui()
        self._set_refine_controls_enabled(False)

    def _apply_global_style(self):
        self.setStyleSheet(
            f"""
            QMainWindow, QWidget {{
                background: {BG};
                color: {TEXT};
                font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
                font-size: 13px;
            }}
            QLabel {{
                background: transparent;
            }}
            QPushButton {{
                background: {PANEL};
                color: {TEXT};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 12px;
                font-weight: 600;
            }}
            QPushButton:hover {{
                background: #28304a;
                border-color: {ACCENT};
            }}
            QPushButton:disabled {{
                color: {SUBTEXT};
                border-color: {BORDER};
            }}
            QProgressBar {{
                background: {PANEL};
                border: 1px solid {BORDER};
                border-radius: 6px;
                height: 8px;
            }}
            QProgressBar::chunk {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {ACCENT}, stop:1 {ACCENT2});
                border-radius: 6px;
            }}
            """
        )

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        root_layout.addWidget(self._make_titlebar())

        body = QWidget()
        body_layout = QHBoxLayout(body)
        body_layout.setContentsMargins(16, 12, 16, 16)
        body_layout.setSpacing(12)
        root_layout.addWidget(body, 1)

        body_layout.addWidget(self._make_left_panel(), 0)
        body_layout.addWidget(self._make_preview_area(), 1)

    def _make_titlebar(self):
        bar = QWidget()
        bar.setFixedHeight(52)
        bar.setStyleSheet(f"background:{SURFACE}; border-bottom:1px solid {BORDER};")
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 0, 20, 0)

        icon = QLabel("[]")
        icon.setStyleSheet(f"font-size:20px; color:{ACCENT};")
        title = QLabel("Depth Slicer")
        title.setStyleSheet(f"font-size:16px; font-weight:700; color:{TEXT};")
        sub = QLabel("depth + SAM2 click refinement")
        sub.setStyleSheet(f"font-size:12px; color:{SUBTEXT};")

        layout.addWidget(icon)
        layout.addSpacing(8)
        layout.addWidget(title)
        layout.addSpacing(8)
        layout.addWidget(sub)
        layout.addStretch()
        return bar

    def _mode_btn_style(self):
        return (
            f"""
            QPushButton {{
                background: {PANEL};
                color: {SUBTEXT};
                border: 1px solid {BORDER};
                border-radius: 7px;
                padding: 6px 10px;
                font-size: 12px;
                font-weight: 600;
            }}
            QPushButton:checked {{
                background: {ACCENT};
                color: #ffffff;
                border-color: {ACCENT};
            }}
            QPushButton:hover:!checked {{
                color: {TEXT};
                border-color: {ACCENT};
            }}
            """
        )

    def _make_left_panel(self):
        panel = QFrame()
        panel.setFixedWidth(260)
        panel.setStyleSheet(
            f"""
            QFrame {{
                background: {SURFACE};
                border-right: 1px solid {BORDER};
                border-radius: 12px;
            }}
            """
        )
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        self.drop_zone = DropZone()
        self.drop_zone.file_dropped.connect(self._load_image)
        layout.addWidget(self.drop_zone)

        self.file_lbl = QLabel("No file loaded")
        self.file_lbl.setWordWrap(True)
        self.file_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:11px;")
        self.file_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.file_lbl)

        self.status_lbl = QLabel("")
        self.status_lbl.setWordWrap(True)
        self.status_lbl.setStyleSheet(f"color:{ACCENT}; font-size:11px;")
        self.status_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.status_lbl)

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setFixedHeight(6)
        self.progress.setVisible(False)
        layout.addWidget(self.progress)

        model_lbl = QLabel("Depth model")
        model_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:11px; font-weight:600;")
        layout.addWidget(model_lbl)

        self.model_combo = QComboBox()
        self.model_combo.setStyleSheet(
            f"""
            QComboBox {{
                background: {PANEL};
                color: {TEXT};
                border: 1px solid {BORDER};
                border-radius: 7px;
                padding: 6px 8px;
                font-size: 11px;
            }}
            QComboBox::drop-down {{
                border: none;
                width: 18px;
            }}
            """
        )
        for label, model_id in MODEL_PRESETS:
            self.model_combo.addItem(label, model_id)
        self.model_combo.currentIndexChanged.connect(self._on_model_changed)
        self.model_combo.setCurrentIndex(0)
        layout.addWidget(self.model_combo)

        refine_title = QLabel("Refine controls")
        refine_title.setStyleSheet(f"color:{SUBTEXT}; font-size:11px; font-weight:700;")
        layout.addWidget(refine_title)

        mode_row = QHBoxLayout()
        mode_row.setSpacing(6)
        self.refine_add_btn = QPushButton("Add")
        self.refine_remove_btn = QPushButton("Remove")
        for btn in (self.refine_add_btn, self.refine_remove_btn):
            btn.setCheckable(True)
            btn.setAutoExclusive(True)
            btn.setStyleSheet(self._mode_btn_style())
            mode_row.addWidget(btn)
        self.refine_add_btn.setChecked(True)
        layout.addLayout(mode_row)

        edit_row = QHBoxLayout()
        edit_row.setSpacing(6)
        self.undo_point_btn = QPushButton("Undo point")
        self.clear_points_btn = QPushButton("Clear points")
        self.undo_point_btn.clicked.connect(self._undo_refine_point)
        self.clear_points_btn.clicked.connect(self._clear_refine_points)
        edit_row.addWidget(self.undo_point_btn)
        edit_row.addWidget(self.clear_points_btn)
        layout.addLayout(edit_row)

        self.sam_status_lbl = QLabel("SAM2 idle")
        self.sam_status_lbl.setWordWrap(True)
        self.sam_status_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.sam_status_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:11px;")
        layout.addWidget(self.sam_status_lbl)

        layout.addStretch()

        info = QLabel(
            "<b>Workflow</b><br><br>"
            "1 - Load an image.<br>"
            "2 - Get depth map.<br>"
            "3 - Open Refine tab and click Add/Remove points.<br>"
            "4 - Export foreground."
        )
        info.setWordWrap(True)
        info.setStyleSheet(
            f"color:{SUBTEXT}; font-size:11px; background:{PANEL}; border-radius:8px; padding:10px;"
        )
        layout.addWidget(info)

        self.export_btn = QPushButton("Cut && Export")
        self.export_btn.setEnabled(False)
        self.export_btn.setStyleSheet(
            f"""
            QPushButton {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {ACCENT}, stop:1 {ACCENT2});
                color: #ffffff;
                border: none;
                border-radius: 9px;
                padding: 12px 20px;
                font-size: 14px;
                font-weight: 700;
            }}
            QPushButton:hover {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #6b9bf5, stop:1 #b89dff);
            }}
            QPushButton:disabled {{
                background: {PANEL};
                color: {SUBTEXT};
            }}
            """
        )
        self.export_btn.clicked.connect(self._do_export)
        layout.addWidget(self.export_btn)
        return panel

    def _make_preview_area(self):
        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)

        main_wrap = QWidget()
        main_layout = QVBoxLayout(main_wrap)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(8)

        mode_bar = QHBoxLayout()
        mode_bar.setSpacing(6)
        self.btn_show_orig = self._tab_btn("Original")
        self.btn_show_fg = self._tab_btn("Foreground preview")
        self.btn_show_depth = self._tab_btn("Depth map")
        self.btn_show_refine = self._tab_btn("Refine")
        self.btn_show_orig.setChecked(True)

        for btn in (self.btn_show_orig, self.btn_show_fg, self.btn_show_depth, self.btn_show_refine):
            btn.setCheckable(True)
            btn.setAutoExclusive(True)
            btn.clicked.connect(self._refresh_preview_mode)
            mode_bar.addWidget(btn)
        mode_bar.addStretch()
        main_layout.addLayout(mode_bar)

        self.preview_stack = QStackedWidget()
        main_layout.addWidget(self.preview_stack, 1)

        regular_page = QWidget()
        regular_layout = QVBoxLayout(regular_page)
        regular_layout.setContentsMargins(0, 0, 0, 0)
        self.canvas = PreviewCanvas()
        regular_layout.addWidget(self.canvas, 1)
        self.preview_stack.addWidget(regular_page)

        refine_page = QWidget()
        refine_layout = QHBoxLayout(refine_page)
        refine_layout.setContentsMargins(0, 0, 0, 0)
        refine_layout.setSpacing(10)

        left_col = QWidget()
        left_col_layout = QVBoxLayout(left_col)
        left_col_layout.setContentsMargins(0, 0, 0, 0)
        left_col_layout.setSpacing(6)
        left_lbl = QLabel("Refine input (click on original)")
        left_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:11px;")
        self.refine_input_canvas = ClickableImageCanvas()
        self.refine_input_canvas.point_clicked.connect(self._on_refine_canvas_point)
        left_col_layout.addWidget(left_lbl)
        left_col_layout.addWidget(self.refine_input_canvas, 1)

        right_col = QWidget()
        right_col_layout = QVBoxLayout(right_col)
        right_col_layout.setContentsMargins(0, 0, 0, 0)
        right_col_layout.setSpacing(6)
        right_lbl = QLabel("Refine output (foreground preview)")
        right_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:11px;")
        self.refine_output_canvas = PreviewCanvas()
        right_col_layout.addWidget(right_lbl)
        right_col_layout.addWidget(self.refine_output_canvas, 1)

        refine_layout.addWidget(left_col, 1)
        refine_layout.addWidget(right_col, 1)
        self.preview_stack.addWidget(refine_page)

        layout.addWidget(main_wrap, 1)

        slider_panel = QWidget()
        slider_panel.setFixedWidth(80)
        slider_panel.setStyleSheet(
            f"background:{SURFACE}; border-radius:12px; border:1px solid {BORDER};"
        )
        sp_layout = QVBoxLayout(slider_panel)
        sp_layout.setContentsMargins(8, 16, 8, 16)

        slider_lbl = QLabel("DEPTH\nCUT")
        slider_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        slider_lbl.setStyleSheet(f"color:{SUBTEXT}; font-size:8px; font-weight:800; letter-spacing:2px;")
        sp_layout.addWidget(slider_lbl)

        self.depth_slider = DepthSlider()
        self.depth_slider.value_changed.connect(self._on_depth_changed)
        sp_layout.addWidget(self.depth_slider, 1)
        layout.addWidget(slider_panel, 0)
        return container

    def _tab_btn(self, text: str):
        btn = QPushButton(text)
        btn.setStyleSheet(self._mode_btn_style())
        return btn

    def _set_refine_controls_enabled(self, enabled: bool):
        self.refine_add_btn.setEnabled(enabled)
        self.refine_remove_btn.setEnabled(enabled)
        self.undo_point_btn.setEnabled(enabled and len(self.sam_points) > 0)
        self.clear_points_btn.setEnabled(enabled and len(self.sam_points) > 0)

    def _reset_sam_state(self, clear_cache: bool):
        self.sam_request_id += 1
        self.sam_points = []
        self.sam_include_mask = None
        self.sam_exclude_mask = None
        self.sam_worker_pending = False
        self.sam_pending_points = []
        self.sam_pending_request_id = 0
        self.sam_last_error = ""
        if clear_cache:
            SAM2Session.clear_cached_image()
        self.sam_status_lbl.setText("SAM2 idle")
        self.refine_input_canvas.set_points([])
        self._set_refine_controls_enabled(self.depth_map is not None and self.original_img is not None)

    def _on_model_changed(self):
        model_id = self.model_combo.currentData()
        if isinstance(model_id, str) and model_id:
            self.selected_model = model_id
        if self.image_path is not None and self.original_img is not None:
            self.depth_map = None
            self.export_btn.setEnabled(False)
            self._set_refine_controls_enabled(False)
            self._start_depth_estimation()

    def _start_depth_estimation(self):
        if self.image_path is None:
            return

        if self.depth_worker is not None:
            try:
                self.depth_worker.progress.disconnect(self.status_lbl.setText)
            except Exception:
                pass
            try:
                self.depth_worker.finished.disconnect(self._on_depth_ready)
            except Exception:
                pass
            try:
                self.depth_worker.error.disconnect(self._on_depth_error)
            except Exception:
                pass

        self.status_lbl.setText(f"Estimating depth ({self.selected_model})...")
        self.progress.setVisible(True)
        self.model_combo.setEnabled(False)

        self.depth_worker = DepthWorker(self.image_path, self.selected_model)
        self.depth_worker.progress.connect(self.status_lbl.setText)
        self.depth_worker.finished.connect(self._on_depth_ready)
        self.depth_worker.error.connect(self._on_depth_error)
        self.depth_worker.start()

    def _load_image(self, path: str):
        self.image_path = path
        self.file_lbl.setText(Path(path).name)
        self.export_btn.setEnabled(False)
        self.depth_map = None
        self._set_refine_controls_enabled(False)

        img = Image.open(path).convert("RGB")
        self.original_img = np.array(img, dtype=np.uint8)
        self._reset_sam_state(clear_cache=True)
        self.sam_image_token = f"{path}|{self.original_img.shape[1]}x{self.original_img.shape[0]}"

        self.btn_show_orig.setChecked(True)
        self.refine_input_canvas.set_image_rgb(self.original_img)
        self._show_original()
        self._start_depth_estimation()

    def _on_depth_ready(self, depth: np.ndarray):
        self.depth_map = depth
        self.progress.setVisible(False)
        self.model_combo.setEnabled(True)
        self.status_lbl.setText("Depth map ready.")
        self.export_btn.setEnabled(True)
        self._set_refine_controls_enabled(True)
        self._rebuild_preview()

    def _on_depth_error(self, msg: str):
        self.progress.setVisible(False)
        self.model_combo.setEnabled(True)
        self.status_lbl.setText(f"Depth error: {msg}")
        QMessageBox.critical(
            self,
            "Depth Error",
            "Could not compute depth map.\n\n"
            f"{msg}\n\n"
            "Make sure internet is available for the first model download.",
        )

    def _on_depth_changed(self, _value: float):
        self.preview_timer.start()

    def _refresh_preview_mode(self):
        self._rebuild_preview()

    def _rebuild_preview(self):
        if self.original_img is None:
            return

        if self.btn_show_refine.isChecked():
            self.preview_stack.setCurrentIndex(1)
            self._show_refine_view()
            return

        self.preview_stack.setCurrentIndex(0)
        if self.btn_show_depth.isChecked():
            self._show_depth_map()
        elif self.btn_show_fg.isChecked():
            self._show_foreground_preview()
        else:
            self._show_original()

    def _show_original(self):
        if self.original_img is None:
            return
        h, w = self.original_img.shape[:2]
        rgba = np.dstack([self.original_img, np.full((h, w), 255, dtype=np.uint8)])
        self.canvas.set_pixmap(numpy_rgba_to_qpixmap(rgba))

    def _show_depth_map(self):
        if self.depth_map is None or self.original_img is None:
            self._show_original()
            return
        h, w = self.original_img.shape[:2]
        dm_resized = self._resize_depth(h, w)

        dm_uint8 = (dm_resized * 255).astype(np.uint8)
        dm_color = cv2.applyColorMap(dm_uint8, cv2.COLORMAP_PLASMA)
        dm_color = cv2.cvtColor(dm_color, cv2.COLOR_BGR2RGB)

        threshold = self.depth_slider.value
        thresh_y = int((1.0 - threshold) * h)
        cv2.line(dm_color, (0, thresh_y), (w, thresh_y), (255, 255, 255), 2)

        rgba = np.dstack([dm_color, np.full((h, w), 255, dtype=np.uint8)])
        self.canvas.set_pixmap(numpy_rgba_to_qpixmap(rgba))

    def _show_foreground_preview(self):
        if self.depth_map is None:
            self._show_original()
            return
        rgba = self._compute_foreground_rgba()
        display = self._composite_on_checker(rgba)
        self.canvas.set_pixmap(numpy_rgba_to_qpixmap(display))

    def _show_refine_view(self):
        if self.original_img is None:
            return
        self.refine_input_canvas.set_image_rgb(self.original_img)
        self.refine_input_canvas.set_points(self.sam_points)

        if self.depth_map is None:
            h, w = self.original_img.shape[:2]
            rgba = np.dstack([self.original_img, np.full((h, w), 255, dtype=np.uint8)])
            self.refine_output_canvas.set_pixmap(numpy_rgba_to_qpixmap(rgba))
            return

        rgba = self._compute_foreground_rgba()
        display = self._composite_on_checker(rgba)
        self.refine_output_canvas.set_pixmap(numpy_rgba_to_qpixmap(display))

    def _on_refine_canvas_point(self, x: int, y: int, button_value: int):
        if self.original_img is None or self.depth_map is None:
            return
        right_click = button_value == int(Qt.MouseButton.RightButton.value)
        label = 0 if right_click else (1 if self.refine_add_btn.isChecked() else 0)

        self.sam_points.append((x, y, label))
        self.refine_input_canvas.set_points(self.sam_points)
        self._set_refine_controls_enabled(True)

        self.sam_request_id += 1
        self._request_sam_refine(self.sam_request_id, list(self.sam_points))
        self._rebuild_preview()

    def _undo_refine_point(self):
        if not self.sam_points:
            return
        self.sam_points.pop()
        self.refine_input_canvas.set_points(self.sam_points)
        self.sam_request_id += 1
        if not self.sam_points:
            self.sam_include_mask = None
            self.sam_exclude_mask = None
            self.sam_status_lbl.setText("SAM2 idle")
            self._set_refine_controls_enabled(self.depth_map is not None and self.original_img is not None)
            self._rebuild_preview()
            return

        self._request_sam_refine(self.sam_request_id, list(self.sam_points))
        self._set_refine_controls_enabled(True)
        self._rebuild_preview()

    def _clear_refine_points(self):
        self.sam_request_id += 1
        self.sam_points = []
        self.sam_include_mask = None
        self.sam_exclude_mask = None
        self.sam_worker_pending = False
        self.sam_pending_points = []
        self.refine_input_canvas.set_points([])
        self.sam_status_lbl.setText("SAM2 points cleared")
        self._set_refine_controls_enabled(self.depth_map is not None and self.original_img is not None)
        self._rebuild_preview()

    def _request_sam_refine(self, request_id: int, points: list[tuple[int, int, int]]):
        if self.original_img is None:
            self.sam_status_lbl.setText("SAM2 waiting for image")
            return
        if self.sam_image_token is None:
            self.sam_status_lbl.setText("SAM2 image cache unavailable")
            return
        if not points:
            self.sam_include_mask = None
            self.sam_exclude_mask = None
            self.sam_status_lbl.setText("SAM2 idle")
            return

        if self.sam_worker_running:
            self.sam_worker_pending = True
            self.sam_pending_request_id = request_id
            self.sam_pending_points = points
            self.sam_status_lbl.setText("SAM2 update queued...")
            return

        self.sam_worker_running = True
        self.sam_status_lbl.setText("Running SAM2 refinement...")

        self.sam_worker = SamPromptWorker(
            request_id=request_id,
            image_rgb=self.original_img.copy(),
            image_token=self.sam_image_token,
            points=points,
        )
        self.sam_worker.progress.connect(self.sam_status_lbl.setText)
        self.sam_worker.result.connect(self._on_sam_result)
        self.sam_worker.start()

    def _on_sam_result(self, request_id: int, include_mask, exclude_mask, error_msg: str):
        self.sam_worker_running = False

        if error_msg:
            self.sam_last_error = error_msg
            if "No module named 'sam2'" in error_msg:
                self.sam_status_lbl.setText("SAM2 missing: install deps in py -3.12 env")
            else:
                self.sam_status_lbl.setText(f"SAM2 unavailable: {error_msg}")
            self.sam_include_mask = None
            self.sam_exclude_mask = None
        elif request_id == self.sam_request_id:
            self.sam_include_mask = include_mask
            self.sam_exclude_mask = exclude_mask
            self.sam_status_lbl.setText(f"SAM2 refined with {len(self.sam_points)} points")

        self._rebuild_preview()

        if self.sam_worker_pending:
            self.sam_worker_pending = False
            pending_points = list(self.sam_pending_points)
            pending_id = self.sam_pending_request_id
            self.sam_pending_points = []
            if pending_points:
                self._request_sam_refine(pending_id, pending_points)

    def _resize_depth(self, h: int, w: int) -> np.ndarray:
        dm = (self.depth_map * 65535).astype(np.uint16)
        dm_resized = cv2.resize(dm, (w, h), interpolation=cv2.INTER_CUBIC)
        return dm_resized.astype(np.float32) / 65535.0

    def _compose_final_mask(self, depth_mask: np.ndarray) -> np.ndarray:
        final_mask = depth_mask.copy()

        if self.sam_include_mask is not None:
            if self.sam_include_mask.shape == final_mask.shape:
                final_mask = np.logical_or(final_mask, self.sam_include_mask)

        if self.sam_exclude_mask is not None:
            if self.sam_exclude_mask.shape == final_mask.shape:
                final_mask = np.logical_and(final_mask, np.logical_not(self.sam_exclude_mask))

        return final_mask

    def _compute_foreground_rgba(self) -> np.ndarray:
        h, w = self.original_img.shape[:2]
        dm = self._resize_depth(h, w)
        threshold = self.depth_slider.value
        depth_mask = dm >= threshold

        final_mask = self._compose_final_mask(depth_mask)
        mask_float = final_mask.astype(np.float32)

        blur_k = max(3, int(min(h, w) * 0.005) | 1)
        mask_float = cv2.GaussianBlur(mask_float, (blur_k, blur_k), 0)
        alpha = (mask_float * 255).clip(0, 255).astype(np.uint8)
        return np.dstack([self.original_img, alpha])

    @staticmethod
    def _composite_on_checker(rgba: np.ndarray) -> np.ndarray:
        h, w = rgba.shape[:2]
        checker = np.zeros((h, w, 3), dtype=np.uint8)
        tile = 16
        for y in range(0, h, tile):
            for x in range(0, w, tile):
                c = 200 if ((x // tile + y // tile) % 2 == 0) else 160
                checker[y : y + tile, x : x + tile] = c

        a = rgba[:, :, 3:4].astype(np.float32) / 255.0
        rgb = rgba[:, :, :3].astype(np.float32)
        comp = (rgb * a + checker.astype(np.float32) * (1.0 - a)).clip(0, 255).astype(np.uint8)
        return np.dstack([comp, np.full((h, w), 255, dtype=np.uint8)])

    def _do_export(self):
        if self.original_img is None or self.depth_map is None or self.image_path is None:
            return

        src_path = Path(self.image_path)
        out_name = src_path.stem + "_foreground.webp"
        out_path = src_path.parent / out_name

        rgba = self._compute_foreground_rgba()
        out_img = Image.fromarray(rgba, "RGBA")
        out_img.save(str(out_path), "WEBP", quality=85, lossless=False)

        self.status_lbl.setText("Saved")
        QMessageBox.information(
            self,
            "Exported",
            f"Foreground saved to:\n{out_path}\n\n(WEBP, 85% quality, with transparency)",
        )


def main():
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setApplicationName("Depth Slicer")
    app.setStyle("Fusion")

    palette = app.palette()
    palette.setColor(QPalette.ColorRole.Window, QColor(BG))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Base, QColor(SURFACE))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(PANEL))
    palette.setColor(QPalette.ColorRole.Text, QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Button, QColor(PANEL))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Highlight, QColor(ACCENT))
    app.setPalette(palette)

    win = DepthSlicerWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
