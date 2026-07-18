module.exports = [
  {
    ignores: [
      "node_modules/**",
      "reports/**",
      "vendor/**",
      "**/*.min.js",
      "plugins/**/dist/**",
      "plugins/**/vendor/**",
      "plugins/disabled/**",
      "plugins/world_location_tracker/lib/leaflet.js",
      "views/libs/jsontree/jsonTree.js"
    ]
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    }
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        exports: "readonly",
        require: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        performance: "readonly",
        structuredClone: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        File: "readonly",
        FormData: "readonly",
        WebSocket: "readonly",
        Notification: "readonly",
        MutationObserver: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        Image: "readonly",
        Audio: "readonly",
        HTMLImageElement: "readonly",
        HTMLCanvasElement: "readonly",
        HTMLVideoElement: "readonly",
        ImageBitmap: "readonly",
        OffscreenCanvas: "readonly",
        ResizeObserver: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        createImageBitmap: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        marked: "readonly",
        io: "readonly",
        Modals: "readonly",
        FileReader: "readonly",
        confirm: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", {
        args: "after-used",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_"
      }],
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unreachable": "error"
    }
  },
  {
    files: ["plugins/**/ui*.js"],
    languageOptions: {
      globals: {
        bridge: "readonly",
        socket: "readonly",
        context: "readonly",
        __UI_ID_JSON__: "readonly",
        __MODE_JSON__: "readonly",
        __PAYLOAD_JSON__: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Image: "readonly",
        Audio: "readonly"
      }
    }
  },
  {
    files: [
      "plugins/arc_cinematics/pixi_takeover.js",
      "plugins/world_location_tracker/travel_takeover.js",
      "plugins/cg_generator/frontend_injection.js"
    ],
    languageOptions: {
      globals: {
        bridge: "readonly",
        context: "readonly",
        socket: "readonly"
      }
    }
  },
  {
    files: [
      "**/*.mjs",
      "views/vn_viewer/**/*.js",
      "plugins/knowledge_graph/views/renderer_kg.js",
      "views/content_manager/renderer_content_manager.js",
      "views/content_manager/modules/**/*.js",
      "plugins/world_location_tracker/editor/**/*.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        io: "readonly",
        PIXI: "readonly",
        gsap: "readonly",
        PixiPlugin: "readonly",
        LeaderLine: "readonly",
        marked: "readonly",
        L: "readonly",
        sigma: "readonly",
        graphology: "readonly"
        ,
        Modals: "readonly"
      }
    }
  },
  {
    files: [
      "plugins/top_down_shooter_gameplay_interludes/frontend/overlay/ui_controller.js",
      "plugins/top_down_shooter_gameplay_interludes/frontend/runtime/**/*.js"
    ],
    languageOptions: {
      globals: {
        bridge: "readonly",
        __UI_ID_JSON__: "readonly",
        __MODE_JSON__: "readonly",
        __PAYLOAD_JSON__: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Image: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", {
        args: "after-used",
        argsIgnorePattern: "^_",
        caughtErrors: "none"
      }]
    }
  },
  {
    files: ["views/content_manager/modules/**/*.js"],
    languageOptions: {
      globals: {
        Modals: "readonly",
        Image: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/modules/**/*.js"],
    languageOptions: {
      globals: {
        Modals: "readonly",
        Audio: "readonly"
      }
    }
  },
  {
    files: ["plugins/world_location_tracker/ui_hud.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        L: "readonly"
      }
    }
  },
  {
    files: ["views/scene_history/renderer_scene_history.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        Modals: "readonly",
        alert: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_alive_bg/depth-worker.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        performance: "readonly",
        createImageBitmap: "readonly",
        OffscreenCanvas: "readonly",
        ImageData: "readonly"
      }
    }
  },
  {
    files: ["plugins/world_location_tracker/ui_timeline.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        L: "readonly"
      }
    }
  },
  {
    files: ["views/timeline/renderer_timeline.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        LeaderLine: "readonly",
        IntersectionObserver: "readonly"
      }
    }
  },
  {
    files: ["views/content_manager/renderer_content_manager.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        marked: "readonly",
        Image: "readonly",
        Modals: "readonly"
      }
    }
  },
  {
    files: ["main.js"],
    languageOptions: {
      globals: {
        performance: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", {
        args: "after-used",
        argsIgnorePattern: "^(_|socket|data|e)$",
        varsIgnorePattern: "^(_|socket|data|e)$",
        caughtErrors: "none"
      }]
    }
  },
  {
    files: ["plugins/world_location_tracker/editor.js", "plugins/world_location_tracker/editor/**/*.js"],
    languageOptions: {
      globals: {
        __WORLD_PACKAGE_PATH__: "readonly",
        __INITIAL_WORLD_DATA__: "readonly",
        __INITIAL_IMAGE_URL__: "readonly",
        __INITIAL_IMAGE_FILE__: "readonly",
        __INITIAL_IS_TILED__: "readonly",
        __INITIAL_TILE_URL__: "readonly",
        __INITIAL_DIMENSIONS__: "readonly",
        Image: "readonly",
        FileReader: "readonly"
      }
    }
  },
  {
    files: ["views/memory_inspector/renderer_memory.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        Terminal: "readonly",
        FitAddon: "readonly",
        getComputedStyle: "readonly",
        TerminalCommandHandler: "readonly",
        Modals: "readonly",
        alert: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_alive_bg/alive-bg-pipeline.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        performance: "readonly",
        Image: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_alive_bg/alive-bg-depth.js"],
    languageOptions: {
      globals: {
        OffscreenCanvas: "readonly",
        createImageBitmap: "readonly",
        PIXI: "readonly",
        Worker: "readonly"
      }
    }
  },
  {
    files: ["views/plugin_manager/renderer_plugin_manager.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        PremiumSelect: "readonly",
        Modals: "readonly"
      }
    }
  },
  {
    files: ["views/project_selector/renderer_project_selector.js"],
    languageOptions: {
      globals: {
        Modals: "readonly"
      }
    }
  },
  {
    files: ["views/settings_manager/renderer_settings_manager.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        PremiumSelect: "readonly",
        Modals: "readonly"
      }
    }
  },
  {
    files: ["plugins/sprite_shading/ui.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        performance: "readonly",
        gsap: "readonly"
      }
    }
  },
  {
    files: ["plugins/lore_book/ui.js"],
    languageOptions: {
      globals: {
        Modals: "readonly",
        FileReader: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/animated_webp_loader.js"],
    languageOptions: {
      globals: {
        ImageDecoder: "readonly",
        createImageBitmap: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/engine.js"],
    languageOptions: {
      globals: {
        Modals: "readonly",
        Audio: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_pixijs_vfx/ui.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        requestAnimationFrame: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_hud/ui.js"],
    languageOptions: {
      globals: {
        context: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_sfx/ui.js"],
    languageOptions: {
      globals: {
        context: "readonly",
        Audio: "readonly"
      }
    }
  },
  {
    files: ["plugins/vn_alive_bg/ui.js"],
    languageOptions: {
      globals: {
        context: "readonly"
      }
    }
  },
  {
    files: ["renderer.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        alert: "readonly"
      }
    }
  },
  {
    files: ["views/libs/plugin_bridge.js"],
    languageOptions: {
      globals: {
        io: "readonly"
      }
    }
  },
  {
    files: ["views/libs/premium_select.js"],
    languageOptions: {
      globals: {
        Event: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/utils.js"],
    languageOptions: {
      globals: {
        Modals: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/pixi_title_manager.js"],
    languageOptions: {
      globals: {
        FontFace: "readonly"
      }
    }
  },
  {
    files: ["views/vn_viewer/js/sprite_manager.js"],
    languageOptions: {
      globals: {
        Image: "readonly"
      }
    }
  },
  {
    files: ["views/log_viewer/renderer_logs.js"],
    languageOptions: {
      globals: {
        io: "readonly",
        jsonTree: "readonly"
      }
    }
  }
];
