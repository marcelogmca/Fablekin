import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk
import json
import math
import uuid

# --- Constants ---
LOCATION_TYPES = [
    "Village", "City", "Capital", "Dungeon", "Outpost", 
    "Landscape", "Road", "Transition", "POI"
]

NATIONS = [
    "Mondstadt", "Liyue", "Inazuma", "Sumeru", 
    "Fontaine", "Natlan", "Snezhnaya", "Nod Krai", "None"
]

class MapNode:
    def __init__(self, x, y, uid=None, data=None):
        self.world_x = x
        self.world_y = y
        self.uid = uid if uid else str(uuid.uuid4())[:8] # Short UUID
        
        # Default Data Schema
        self.data = data if data else {
            "name": "New Location",
            "type": "Village",
            "region": "Unknown",
            "parent_nation": "None",
            "description": "",
            "tags": ""
        }

class MapEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("Genshin Narrative Map Editor")
        self.root.geometry("1200x850")

        # State
        self.image_path = None
        self.pil_image = None
        self.tk_image = None
        self.nodes = [] 
        self.selected_node_index = None
        
        self.origin_x = 0
        self.origin_y = 0
        
        # --- Metadata / Calibration Vars ---
        self.scale_var = tk.DoubleVar(value=1.0)
        self.pixels_per_km_var = tk.DoubleVar(value=7.0)      # Default: 7.0
        self.walk_speed_var = tk.DoubleVar(value=30.0)        # Default: 30.0 kmpd
        self.winding_factor_var = tk.DoubleVar(value=1.2)     # Default: 1.2

        self._init_ui()

    def _init_ui(self):
        self.main_paned = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        self.main_paned.pack(fill=tk.BOTH, expand=True)

        # --- Canvas Side ---
        self.canvas_frame = ttk.Frame(self.main_paned)
        self.main_paned.add(self.canvas_frame, weight=3)

        self.v_scroll = ttk.Scrollbar(self.canvas_frame, orient=tk.VERTICAL)
        self.h_scroll = ttk.Scrollbar(self.canvas_frame, orient=tk.HORIZONTAL)
        self.canvas = tk.Canvas(self.canvas_frame, bg="#2b2b2b", 
                                xscrollcommand=self.h_scroll.set, 
                                yscrollcommand=self.v_scroll.set)
        
        self.v_scroll.config(command=self.canvas.yview)
        self.h_scroll.config(command=self.canvas.xview)

        self.v_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.h_scroll.pack(side=tk.BOTTOM, fill=tk.X)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.canvas.bind("<Button-1>", self.on_left_click)
        self.canvas.bind("<Button-3>", self.on_right_click)

        # --- Controls Side ---
        self.controls_frame = ttk.Frame(self.main_paned, padding=10)
        self.main_paned.add(self.controls_frame, weight=1)

        # File Ops
        ttk.Label(self.controls_frame, text="Map Operations", font=("Arial", 12, "bold")).pack(pady=5)
        btn_frame = ttk.Frame(self.controls_frame)
        btn_frame.pack(fill=tk.X)
        ttk.Button(btn_frame, text="Load Image", command=self.load_image).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(btn_frame, text="Load JSON", command=self.load_json).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(self.controls_frame, text="Save JSON", command=self.save_json).pack(fill=tk.X, pady=5)

        ttk.Separator(self.controls_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=10)

        # --- Calibration & Meta ---
        ttk.Label(self.controls_frame, text="Map Calibration & Meta", font=("Arial", 10, "bold")).pack(anchor=tk.W)
        
        config_frame = ttk.Frame(self.controls_frame)
        config_frame.pack(fill=tk.X, pady=5)

        # Helper to create label/entry pairs
        def create_config_row(parent, label_text, var):
            row = ttk.Frame(parent)
            row.pack(fill=tk.X, pady=2)
            ttk.Label(row, text=label_text, width=18).pack(side=tk.LEFT)
            tk.Entry(row, textvariable=var).pack(side=tk.RIGHT, fill=tk.X, expand=True)

        create_config_row(config_frame, "Coord Scale:", self.scale_var)
        create_config_row(config_frame, "Pixels per KM:", self.pixels_per_km_var)
        create_config_row(config_frame, "Walk Speed (km/d):", self.walk_speed_var)
        create_config_row(config_frame, "Winding Factor:", self.winding_factor_var)

        ttk.Label(self.controls_frame, text="(Right-click Map to set Origin)", font=("Arial", 8, "italic")).pack(anchor=tk.W)

        ttk.Separator(self.controls_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=10)

        # Node Editor
        self.editor_frame = ttk.Frame(self.controls_frame)
        self.editor_frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(self.editor_frame, text="Node Properties", font=("Arial", 12, "bold")).pack(pady=5)
        
        self.inputs = {}

        # 1. ID (Read Only)
        ttk.Label(self.editor_frame, text="ID (Auto)").pack(anchor=tk.W)
        self.inputs['uid'] = tk.Entry(self.editor_frame, state='readonly')
        self.inputs['uid'].pack(fill=tk.X)

        # 2. Name
        ttk.Label(self.editor_frame, text="Name").pack(anchor=tk.W)
        self.inputs['name'] = tk.Entry(self.editor_frame)
        self.inputs['name'].pack(fill=tk.X)
        self.inputs['name'].bind("<KeyRelease>", self.update_current_node_data)

        # 3. Type (Dropdown)
        ttk.Label(self.editor_frame, text="Type").pack(anchor=tk.W)
        self.inputs['type'] = ttk.Combobox(self.editor_frame, values=LOCATION_TYPES, state="readonly")
        self.inputs['type'].pack(fill=tk.X)
        self.inputs['type'].bind("<<ComboboxSelected>>", self.update_current_node_data)

        # 4. Region
        ttk.Label(self.editor_frame, text="Region (Sub-Area)").pack(anchor=tk.W)
        self.inputs['region'] = tk.Entry(self.editor_frame)
        self.inputs['region'].pack(fill=tk.X)
        self.inputs['region'].bind("<KeyRelease>", self.update_current_node_data)

        # 5. Nation (Dropdown)
        ttk.Label(self.editor_frame, text="Nation").pack(anchor=tk.W)
        self.inputs['parent_nation'] = ttk.Combobox(self.editor_frame, values=NATIONS, state="readonly")
        self.inputs['parent_nation'].pack(fill=tk.X)
        self.inputs['parent_nation'].bind("<<ComboboxSelected>>", self.update_current_node_data)

        # 6. Tags
        ttk.Label(self.editor_frame, text="Tags (comma sep)").pack(anchor=tk.W)
        self.inputs['tags'] = tk.Entry(self.editor_frame)
        self.inputs['tags'].pack(fill=tk.X)
        self.inputs['tags'].bind("<KeyRelease>", self.update_current_node_data)

        # 7. Description
        ttk.Label(self.editor_frame, text="Description").pack(anchor=tk.W, pady=2)
        self.desc_text = tk.Text(self.editor_frame, height=5, width=30)
        self.desc_text.pack(fill=tk.X)
        self.desc_text.bind("<KeyRelease>", self.update_current_node_data)

        self.info_lbl = ttk.Label(self.editor_frame, text="Pos: -, -", foreground="gray")
        self.info_lbl.pack(pady=10)

        ttk.Button(self.editor_frame, text="Delete Selected Node", command=self.delete_node).pack(fill=tk.X, pady=5)

    # --- Logic ---

    def load_image(self):
        path = filedialog.askopenfilename(filetypes=[("Images", "*.png;*.jpg;*.jpeg")])
        if not path: return
        self.image_path = path
        self.pil_image = Image.open(path)
        self.tk_image = ImageTk.PhotoImage(self.pil_image)
        self.canvas.config(scrollregion=(0, 0, self.pil_image.width, self.pil_image.height))
        self.draw_map()

    def screen_to_world(self, sx, sy):
        wx = (sx - self.origin_x) / self.scale_var.get()
        wy = (self.origin_y - sy) / self.scale_var.get()
        return wx, wy

    def world_to_screen(self, wx, wy):
        sx = (wx * self.scale_var.get()) + self.origin_x
        sy = self.origin_y - (wy * self.scale_var.get())
        return sx, sy

    def on_right_click(self, event):
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        self.origin_x = canvas_x
        self.origin_y = canvas_y
        self.draw_map()

    def on_left_click(self, event):
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)

        clicked_node = None
        for i, node in enumerate(self.nodes):
            nx, ny = self.world_to_screen(node.world_x, node.world_y)
            if math.hypot(nx - canvas_x, ny - canvas_y) < 10:
                clicked_node = i
                break
        
        if clicked_node is not None:
            self.select_node(clicked_node)
        else:
            wx, wy = self.screen_to_world(canvas_x, canvas_y)
            new_node = MapNode(wx, wy)
            self.nodes.append(new_node)
            self.select_node(len(self.nodes)-1)
        
        self.draw_map()

    def select_node(self, index):
        self.selected_node_index = index
        node = self.nodes[index]
        
        # Set ID (Read only)
        self.inputs['uid'].config(state='normal')
        self.inputs['uid'].delete(0, tk.END)
        self.inputs['uid'].insert(0, node.uid)
        self.inputs['uid'].config(state='readonly')

        # Set Fields
        self.inputs['name'].delete(0, tk.END)
        self.inputs['name'].insert(0, node.data.get('name', ''))

        self.inputs['type'].set(node.data.get('type', 'Village'))
        
        self.inputs['region'].delete(0, tk.END)
        self.inputs['region'].insert(0, node.data.get('region', ''))

        self.inputs['parent_nation'].set(node.data.get('parent_nation', 'None'))

        self.inputs['tags'].delete(0, tk.END)
        self.inputs['tags'].insert(0, node.data.get('tags', ''))

        self.desc_text.delete("1.0", tk.END)
        self.desc_text.insert("1.0", node.data.get("description", ""))

        dist = math.hypot(node.world_x, node.world_y)
        self.info_lbl.config(text=f"World Pos: {node.world_x:.1f}, {node.world_y:.1f}\nDist from Origin: {dist:.1f}")

    def update_current_node_data(self, event=None):
        if self.selected_node_index is None: return
        node = self.nodes[self.selected_node_index]
        
        # ID is skipped as it is read-only
        node.data['name'] = self.inputs['name'].get()
        node.data['type'] = self.inputs['type'].get()
        node.data['region'] = self.inputs['region'].get()
        node.data['parent_nation'] = self.inputs['parent_nation'].get()
        node.data['tags'] = self.inputs['tags'].get()
        node.data['description'] = self.desc_text.get("1.0", tk.END).strip()

    def delete_node(self):
        if self.selected_node_index is not None:
            del self.nodes[self.selected_node_index]
            self.selected_node_index = None
            self.draw_map()

    def draw_map(self):
        self.canvas.delete("all")
        if self.tk_image:
            self.canvas.create_image(0, 0, anchor=tk.NW, image=self.tk_image)
        
        ox, oy = self.origin_x, self.origin_y
        self.canvas.create_line(ox-20, oy, ox+20, oy, fill="#00FF00", width=2)
        self.canvas.create_line(ox, oy-20, ox, oy+20, fill="#00FF00", width=2)
        self.canvas.create_text(ox+25, oy, text="ORIGIN (0,0)", fill="#00FF00", anchor=tk.W)

        for i, node in enumerate(self.nodes):
            nx, ny = self.world_to_screen(node.world_x, node.world_y)
            
            color = "#00FFFF" 
            if i == self.selected_node_index:
                color = "#FF0000"
            
            self.canvas.create_oval(nx-6, ny-6, nx+6, ny+6, fill=color, outline="black")
            self.canvas.create_text(nx, ny-15, text=node.data.get('name', '???'), fill="white", font=("Arial", 8, "bold"))

    def save_json(self):
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
        if not path: return
        
        export_data = {
            "meta": {
                "image_path": self.image_path,
                "origin_pixel_x": self.origin_x,
                "origin_pixel_y": self.origin_y,
                "scale_factor": self.scale_var.get(),
                
                # --- NEW METADATA EXPORT ---
                "pixels_per_km": self.pixels_per_km_var.get(),
                "base_walk_speed_kmpd": self.walk_speed_var.get(),
                "winding_factor": self.winding_factor_var.get()
            },
            "nodes": [
                {
                    "uid": n.uid,
                    "world_x": n.world_x,
                    "world_y": n.world_y,
                    **n.data
                } for n in self.nodes
            ]
        }
        
        with open(path, 'w') as f:
            json.dump(export_data, f, indent=4)
        messagebox.showinfo("Success", "Map data saved.")

    def load_json(self):
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not path: return
        
        with open(path, 'r') as f:
            data = json.load(f)
        
        meta = data.get("meta", {})
        self.origin_x = meta.get("origin_pixel_x", 0)
        self.origin_y = meta.get("origin_pixel_y", 0)
        self.scale_var.set(meta.get("scale_factor", 1.0))

        # --- NEW METADATA IMPORT (With Defaults) ---
        self.pixels_per_km_var.set(meta.get("pixels_per_km", 7.0))
        self.walk_speed_var.set(meta.get("base_walk_speed_kmpd", 30.0))
        self.winding_factor_var.set(meta.get("winding_factor", 1.2))
        
        saved_img_path = meta.get("image_path")
        if saved_img_path:
            try:
                self.image_path = saved_img_path
                self.pil_image = Image.open(saved_img_path)
                self.tk_image = ImageTk.PhotoImage(self.pil_image)
                self.canvas.config(scrollregion=(0, 0, self.pil_image.width, self.pil_image.height))
            except Exception:
                pass # Fail silently on image load, just load nodes

        self.nodes = []
        for n_data in data.get("nodes", []):
            wx = n_data.pop("world_x")
            wy = n_data.pop("world_y")
            uid = n_data.pop("uid")
            self.nodes.append(MapNode(wx, wy, uid, data=n_data))
            
        self.draw_map()

if __name__ == "__main__":
    root = tk.Tk()
    app = MapEditor(root)
    root.mainloop()