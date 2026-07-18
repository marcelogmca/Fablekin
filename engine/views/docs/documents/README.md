# Technical Documentation Archive

This index is automatically generated for repository browsing. For the full interactive experience, launch the engine and open the **Docs** tab.

## Bootstrapping

- **[App Lifecycle & Bootstrapping](core/bootstrapping/app_lifecycle.md)**
  > This document outlines the startup sequence and process orchestration of the Dynamic Narrative Engine.

- **[IPC & Socket Infrastructure](core/bootstrapping/ipc_socket_infrastructure.md)**
  > The engine uses a hybrid communication model to facilitate interaction between the Electron Main process and various Renderer processes (views).

## Game Over Sdk

- **[Game Over SDK Reference](core/game_over_sdk/index.md)**
  > The Game Over system allows plugins to trigger terminal narrative states that lock user input while preserving the Undo functionality. It supports bot

## Getting Started

- **[Getting Started](core/getting_started/index.md)**
  > Fablekin turns your directives, lore, and player choices into an ongoing visual story. This guide covers the shortest path from a fresh installation t

## Gui Intercept Sdk

- **[GUI Intercept SDK](core/gui_intercept_sdk/index.md)**
  > Available from tools.gui.

## Management

- **[Branching & State Management](core/management/branching_logic.md)**
  > Branching allows users to "rewind" the story to a specific point and start a new timeline without losing their original progress.

- **[Narrative History & DB](core/management/narrative_history.md)**
  > The ChapterManagement module (engine/modules/chaptermanagement.js) is responsible for the persistent state of a narrative session (an "Adventure")....

- **[Project & Content Structure](core/management/project_structure.md)**
  > Every Fablekin project lives in its own directory under workspace/projects/. The core folders have stable purposes, while plugins can add their own...

## Memory

- **[Memory & RAG Pipeline](core/memory/rag_pipeline.md)**
  > The engine utilizes a sophisticated Retrieval-Augmented Generation (RAG) pipeline to provide AI agents with long-term memory and relevant world kno...

- **[Memory Level of Detail (LOD)](core/memory/memory_lod.md)**
  > The engine implements a sophisticated Dynamic Level of Detail (LOD) system to manage story context. This ensures that the engine can handle infinit...

- **[Multi-Query RAG & Retrieval](core/memory/retrieval_pipeline.md)**
  > The memory retrieval system is designed to provide the LLM with the most relevant context while staying within token limits. It uses a combination ...

- **[Structured Knowledge & Ledger](core/memory/fact_storage.md)**
  > While the RAG pipeline handles unstructured prose, the engine uses the FactManager (engine/modules/memorymanager/storage/factmanager.js) to track s...

- **[Summarization & Compression](core/memory/summarization_service.md)**
  > The SummarizationService is the primary engine for distilling complex narrative data into digestible chunks for the memory system and character she...

## Memory Lod

- **[Memory LOD System](core/memory_lod/index.md)**
  > Advanced Narrative Context Archiving

## Narrative

- **[Character Bootstrapping & Fact Analysis](core/narrative/character_bootstrapping.md)**
  > The Character Bootstrapper (characterbootstrapper.js) is the system that ensures every character who enters the story is properly tracked and initi...

- **[Gaze & Variant Orchestration](core/narrative/visual_analysis.md)**
  > Visual storytelling is driven by two specialized AI agents that analyze the narrative text to produce visual directives.

- **[LLM Orchestration And Global Model Routes](core/narrative/llm_orchestration.md)**
  > Fablekin routes text-generation work through global model aliases. Core modules and plugins choose an alias; the alias selects the provider, concre...

- **[Scene Phase Architecture (Dynamic Event Handoffs)](core/narrative/scene_phases.md)**
  > The Scene Phase system is the capability-handoff layer that prevents narrative "rushing" and enables plugins to own mechanical moments (combat, tra...

- **[The Narrative Pipeline](core/narrative/narrative_pipeline.md)**
  > The Narrative Pipeline is the core sequence of operations that transforms user input into story prose.

## Persona Engine

- **[Persona Engine](core/persona_engine/index.md)**
  > Subsystem Plugin

## Plugin Db Best Practices

- **[Turn-Bounded Data](core/plugin_db_best_practices/index.md)**
  > Architecture Reference

## Plugin Dev

- **[Plugin Development 101: From Simple to Complex](core/plugin_dev/index.md)**
  > This guide walks through Fablekin plugin development from the smallest useful hook to complex custom VN UX. It is meant to be the first page a plugin

- **[Plugin Example Catalog](core/plugin_dev/examples.md)**
  > The examples ship disabled in engine/plugins/disabled. Enable only the example you are studying, verify its result, and copy the smallest relevant ...

## Plugin Sdk Tooling

- **[Plugin SDK](core/plugin_sdk_tooling/index.md)**
  > Backend tools and frontend integration map

## Plugins

- **[Interlude Tools](core/plugins/interlude_tools.md)**
  > Backend plugins can create headless interlude records through tools.interludes.createProgrammatic(payload).

- **[Plugin API Groups](core/plugins/api_groups.md)**
  > Fablekin plugins use a small set of public API groups. The groups are split by where code runs: backend plugin code, frontend plugin UI code, and a...

- **[Plugin Architecture](core/plugins/plugin_architecture.md)**
  > Plugins are trusted Node.js extensions. They can participate in narrative turns, access scoped project tools, add UI, and expose APIs to other plug...

- **[Plugin Hooks And Runtime Execution](core/plugins/hooks_runtime.md)**
  > Hooks let plugins participate in the narrative pipeline and application lifecycle. hookexecutor.js orders listeners, supplies plugin-scoped tools, ...

- **[Plugin SDK (Tools Reference)](core/plugins/plugin_sdk.md)**
  > Every plugin hook receives a tools object. This object is a comprehensive SDK that allows plugins to interact with the engine's core subsystems saf...

- **[Plugin State And Storage](core/plugins/plugin_state.md)**
  > Choose storage by lifetime and purpose. Small pipeline state belongs in the TurnContext, narrative facts belong in the facts database, and large ar...

- **[Story Scripts and Trust](core/plugins/story_scripts_security.md)**
  > Story Scripts let a project provide JavaScript hooks through a Markdown file. They are useful for story-specific rules and presentation behavior, b...

- **[The Plugin Bridge & UI Injections](core/plugins/ui_bridge.md)**
  > The Plugin Bridge (pluginbridge.js) is a client-side library that connects frontend views (like the VN Viewer or custom plugin tabs) to the backend...

## Sprite Setup

- **[Sprite Setup Guide](core/sprite_setup/index.md)**
  > How to organize your character images for the Dynamic Narrative Engine.

## Story Scripts

- **[Story Scripts](core/story_scripts/index.md)**
  > Story Scripts are project-level .md files (though they contain JavaScript logic) that allow you to customize the behavior of the engine for a speci...

## System

- **[Configuration Management](core/system/config_management.md)**
  > Fablekin keeps application-wide settings separate from each project's content configuration. Treat these as different layers: global settings choos...

- **[Core Utilities & Turn Logging](core/system/utilities_logger.md)**
  > The utils.js module is the backbone of the engine's supporting logic, providing a unified interface for logging, configuration, and filesystem mana...

- **[IPC & System Handlers](core/system/handlers_reference.md)**
  > The "Handlers" are the entry points for all client-to-server communication. They reside in engine/modules/mainprocess/handlers/ and are registered ...

- **[Project Management Backend](core/system/project_management_backend.md)**
  > The main process coordinates all high-level project operations, ensuring data integrity and filesystem consistency.

- **[Run Profiles & Virtual Turns (Interludes)](core/system/run_profiles_virtual_turns.md)**
  > Run Profiles are the declarative control layer for VN turn execution.

- **[Runtime Startup](core/system/runtime_modes.md)**
  > Fablekin is a desktop-first Electron application. Startup always initializes the backend services, opens the project selector, and continues throug...

- **[Security and Secret Storage](core/system/security_architecture.md)**
  > Fablekin protects secrets at rest and applies path checks to selected project operations. These controls reduce accidental exposure; they do not tu...

- **[Shared Libraries & Socket Bootstrap](core/system/shared_libraries_bootstrap.md)**
  > The engine relies on a small set of curated libraries to handle specialized tasks across its many webview contexts.

- **[Turn Execution Pipeline](core/system/turn_lifecycle.md)**
  > This document describes the production turn pipeline used by VN generation.

## Tooling

- **[Content Manager Logic](core/tooling/content_manager_logic.md)**
  > The Content Manager is the primary workspace for story construction, providing a robust interface for file organization and metadata editing.

- **[Content Modes and RAG Ingestion](core/tooling/content_modes.md)**
  > Content modes decide how each project file participates in a story turn. Basic modes are always available; Advanced Mode reveals the more technical...

- **[Documentation System and Index](core/tooling/documentation_registry.md)**
  > The Docs view builds its navigation from the documentation files currently installed with Fablekin and from documentation registered by enabled plu...

- **[Memory Inspector & CLI](core/tooling/memory_cli.md)**
  > The Memory Inspector provides a powerful Xterm-compatible terminal interface for debugging and manipulating the engine's internal state.

- **[Memory Inspector Console](core/tooling/memory_inspector.md)**
  > The Memory Inspector is a low-level debugging console built on Xterm.js. It allows developers and power users to query the engine's state in real-t...

- **[Project Selector & Lifecycle](core/tooling/project_selector.md)**
  > The Project Selector is the application's entry point. It manages the filesystem organization of your creative projects.

- **[State & Memory Inspection](core/tooling/state_inspection.md)**
  > For advanced debugging and narrative analysis, the engine provides tools to inspect the underlying knowledge stores and chronological state.

- **[Utility & Management Views](core/tooling/utility_views.md)**
  > The engine includes several specialized windows for managing project state, diagnosing issues, and configuring global behaviors.

- **[Workspace and Content Manager](core/tooling/workspace_manager.md)**
  > The Content Manager is where you organize project files, choose their content modes, manage the active chronicle, and set player-specific project i...

## Ui

- **[App Shell & View Styles](core/ui/app_shell_styling.md)**
  > The visual experience of the engine is governed by a set of localized stylesheets that extend the Global Design System.

- **[Auxiliary UI Orchestration](core/ui/auxiliary_managers.md)**
  > The viewer uses several "Manager" modules to handle specific UI subsystems without cluttering the main rendering engine.

- **[Common UI Components](core/ui/common_components.md)**
  > The engine provides a set of global JavaScript APIs for standard UI interactions. These components are automatically available in the main applicat...

- **[Design System & Tokens](core/ui/design_system.md)**
  > The engine uses a unified design system powered by CSS custom properties (variables). This ensures visual consistency across the main application, ...

- **[Design System & Tokens](core/ui/tokens_reference.md)**
  > The engine uses a centralized Design Token system to ensure consistency across the Shell, the VN Viewer, and all internal tools.

- **[Interactive Timeline & Branching](core/ui/timeline_engine.md)**
  > The Timeline v2 is a specialized view for navigating the non-linear history of a project. It combines a high-performance rendering engine with a pl...

- **[System UI & Management Views](core/ui/management_views.md)**
  > The engine provides several management views outside of the main Visual Novel viewer. These views allow the player to curate their experience, mana...

- **[Theme & Variable Architecture](core/ui/theme_architecture.md)**
  > The engine uses a comprehensive CSS variable system to ensure design consistency and support deep customization.

- **[Theme Gallery & Customization](core/ui/theme_gallery.md)**
  > The engine supports a fully swappable theme system. Themes are defined as CSS files in the engine/themes/ directory.

- **[Viewer Shell & HUD Layout](core/ui/viewer_shell.md)**
  > The Viewer Shell (viewer.html and renderervn.js) is the primary interface for the player. It orchestrates multiple complex systems into a single im...

- **[Visual Layout & Overlays](core/ui/layout_orchestration.md)**
  > This document explains the CSS architecture of the VN Viewer and how it manages the complex spatial relationships between narrative text, character...

## Vn

- **[Cinematic Renderer (PixiJS)](core/vn/pixijs_renderer.md)**
  > The engine uses PixiJS v8 to deliver high-performance, GPU-accelerated visuals. It abstracts away the complexity of WebGL/WebGPU through a logical ...

- **[GUI Intercepts & Overlays](core/vn/intercept_system.md)**
  > The GUI Intercept system is the primary mechanism for extending the VN Viewer with plugin-driven logic. It allows plugins to pause the narrative an...

- **[Narrative & Text Utilities](core/vn/narrative_utilities.md)**
  > The engine includes several low-level utilities to ensure narrative consistency and proper text presentation.

- **[Scene & Sprite Lifecycle](core/vn/scene_management.md)**
  > The pixispritemanager.js and camera systems work together to transform narrative data into a cinematic experience.

- **[Sprite Shadows](core/vn/sprite_shadows.md)**
  > Sprite shadows are an opt-in Pixi feature for scenes where characters should feel grounded in the background, such as camp/interlude scenes. Normal...

- **[UCP Protocol & Compilation](core/vn/ucp_compilation.md)**
  > The Universal Cinematic Protocol (UCP) is the domain-specific language used to describe Visual Novel scenes. The engine uses a JIT (Just-In-Time) c...

- **[UCP Protocol Reference](core/vn/ucp_protocol.md)**
  > The Universal Cinematic Protocol (UCP) is the canonical instruction set used to control the Visual Novel's presentation. It allows both the AI and ...

- **[UI Events & Interaction](core/vn/ui_interaction.md)**
  > The uievents.js module handles all user interactions with the Visual Novel shell, from submitting messages to fine-tuning the visual appearance.

- **[Viewer Frontend Orchestration](core/vn/frontend_orchestration.md)**
  > The VN Viewer is built on a modular JavaScript architecture designed to handle complex, non-deterministic narrative payloads from the engine.

- **[Viewer State & Orchestration](core/vn/viewer_state.md)**
  > The Visual Novel viewer is a complex state machine that synchronizes narrative progression with visual and audio feedback.

- **[Viewer State & Settings](core/vn/viewer_state_settings.md)**
  > This document covers how the viewer maintains its internal state and how user preferences are persisted and applied.

- **[Visual SDK (`window.VN`)](core/vn/visual_sdk.md)**
  > window.VN is the public API for plugin code already running inside the Visual Novel viewer. Backend hooks use tools. instead. GUI intercept payload...

- **[VN Analysis & Logic](core/vn/internal_logic.md)**
  > The Visual Novel subsystem relies on a set of analytical modules to transform LLM prose into a structured, cinematic experience. This "Brain" resid...

- **[VN Rendering & Gaze](core/vn/rendering_pipeline.md)**
  > The rendering pipeline (engine/modules/vnmanager/rendering/) translates the logical script into a sequence of visual commands for the PixiJS frontend.

- **[VN Subsystem: Backend](core/vn/vn_backend.md)**
  > The backend of the Visual Novel (VN) subsystem is responsible for transforming raw AI-generated narrative into a structured, line-by-line cinematic...

- **[VN Subsystem: Frontend](core/vn/vn_frontend.md)**
  > The frontend of the Visual Novel subsystem is a high-performance renderer built on PixiJS. It is designed to handle complex animations, VFX, and di...

## Vn Api

- **[VN Viewer API Reference](core/vn_api/index.md)**
  > The VN Viewer communicates with the backend and other views via Socket.io events. This reference list the most common events used for synchronization

## Vn Rendering

- **[Asset Selector Documentation](core/vn_rendering/asset_selector.md)**
  > The assetselector.js module is responsible for providing a UI and logic to select assets (images, audio, etc.) within the Visual Novel manager.

