# Workspace and Content Manager

The Content Manager is where you organize project files, choose their content modes, manage the active chronicle, and set player-specific project information.

## Project Tree

Every project has four core content folders:

- **`1_Directives`** — shared narrative rules, style, pacing, and boundaries.
- **`2_Lore_Book`** — world reference material such as characters, locations, and setting details.
- **`3_Chronicles`** — narrative databases (`.db` files), including the active chat history.
- **`4_Important`** — shown in the interface as **Overrides**. Its Full-content files are high-priority Writer-only instructions.

Asset folders hold backgrounds, sprites, music, and voices. Use **Project Folder** or **Assets Folder** to open them in the operating system.

## Working with Files

- Create and edit Markdown files directly in the Content Manager.
- Rename or delete ordinary project files from the tree.
- Convert a Markdown file to a chat database by assigning **Chat history** mode. Only one chat database is active at a time.
- Drag files to reorder them within a folder. You can also move them between subfolders of the same major project category; moving between core categories is blocked.
- Assign a content mode to control how each file is used. See [Content Modes and RAG Ingestion](content_modes.md).

## Player Character and Notes

Set a player character name and optional bio for the current project.

- The name is available to prompts and replaces the `[USER_CHARACTER]` placeholder in project content.
- The bio is shared character reference context for both the Director and Writer. Use it for stable details such as personality, appearance, history, and capabilities.

Project Notes are private project setup notes shown in the Content Manager. They are not automatically added to story prompts.

## Advanced Mode

Advanced Mode is saved per project. It reveals `4_Important`, advanced native modes such as Summarized, Auto (RAG), Chat history, and Story Script, as well as directive controls and file-order/token metadata.

Plugin modes may appear when their plugin is enabled. A structured plugin mode can lock its file format or provide a custom editor, so read that plugin's documentation before changing the mode.
