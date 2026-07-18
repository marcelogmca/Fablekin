> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Getting Started

Fablekin turns your directives, lore, and player choices into an ongoing visual story. This guide covers the shortest path from a fresh installation to your first generated turn.

## 1. Connect a Model Provider

Open **Settings → Secrets** and save an API key for one supported provider. The first provider key you save configures Fablekin's four model tiers automatically.

**Local models:** Ollama does not use an API key. Configure its connection and model routes manually under **Models & Routing**.

## 2. Review Your Model Tiers

Open **Settings → Models & Routing** to review the Low, Medium, High, and Very High tiers. Each tier selects the service and concrete model used for that level of work.

Most users can keep the starter choices. **Engine Management** lets you choose which tier each narrative function uses.

## 3. Create a Project

Use the **Project Selector** to create a project. Fablekin creates its core content and asset folders immediately; memory and plugin-storage directories are added when a feature needs them.

## 4. Add Story Material

Open the **Content Manager** and add or edit:

- **Directives** for tone, rules, perspective, and storytelling constraints.

- **Lore** for characters, locations, factions, and world information.

- **Intro content** that should be included when the story begins.

Choose a content mode for each file so Fablekin knows whether to include it fully, summarize it, retrieve relevant passages, or use it only during the introduction.

## 5. Start the Story

Select a chronicle database, enter the opening action or premise, and generate the first turn. A turn is one story beat: Fablekin plans it, writes the prose, updates state, and prepares the visual presentation.

## 6. Open the Viewer

The **Viewer** presents the generated turn with its backgrounds, sprites, music, and any enabled plugin features. Continue by entering the next player action.

**Next:** Read [Project & Content Structure](../management/project_structure.md) to understand what Fablekin creates, or [LLM Orchestration and Global Model Routes](../narrative/llm_orchestration.md) to tune model usage.