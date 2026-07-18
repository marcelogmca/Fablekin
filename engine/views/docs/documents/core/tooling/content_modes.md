# Content Modes and RAG Ingestion

Content modes decide how each project file participates in a story turn. Basic modes are always available; Advanced Mode reveals the more technical options, and enabled plugins can add their own modes.

## Native Modes

| Mode | What it does |
| :--- | :--- |
| **Not included** | Keeps the file in the project without adding it to AI context. |
| **Full content** | Adds the file's full text to the shared story context on each turn. |
| **Summarized** | Generates and adds a condensed version of the file. If summarization fails, Fablekin uses the original content so the information is not lost. |
| **Auto (RAG)** | Indexes the file in the project's local LanceDB store and retrieves relevant passages for the current turn instead of inserting the complete file. |
| **Intro / Prologue** | Prepends the file to the player's action on Turn 1 only. |
| **Chat history** | Marks one `.db` file as the active narrative history. Choosing it for a Markdown file offers to convert that file into a database. |
| **Auto Included** | Marks a file that is managed by a plugin. Its mode is not intended to be edited manually. |
| **Story Script** | Treats a Markdown file as project-specific executable logic. Review [Story Scripts and Trust](../plugins/story_scripts_security.md) before enabling one. |

## Auto (RAG)

Auto files are chunked and embedded in a local LanceDB collection. During a turn, Fablekin queries that collection with the current story context and adds the most relevant retrieved passages to the prompt.

This is useful for large reference material that should be available when relevant without being sent in full on every turn. The amount retrieved depends on the current retrieval settings and the material itself; it is not a fixed token budget.

## Plugin Modes

Enabled plugins can register additional modes, including structured editors, custom viewers, and file conversions. These modes appear in the Content Manager only while their owning plugin is available. Their meaning and storage format are defined by that plugin.

## Choosing a Mode

- Use **Full content** for short, always-relevant rules and reference material.
- Use **Summarized** for material that should always be present but does not need its full wording.
- Use **Auto (RAG)** for large libraries of lore or reference notes.
- Use **Intro / Prologue** for opening context that should not repeat later.
- Keep unfamiliar files **Not included** until you know how they are used.
