# Character Bootstrapping & Fact Analysis

The **Character Bootstrapper** (`character_bootstrapper.js`) is the system that ensures every character who enters the story is properly tracked and initialized.

## 1. Identification Flow

Every turn, after the Writer AI generates the narrative, the bootstrapper scans the output for names.
1. **Fact Scanning**: It checks the current turn's entities against the project's [Fact Manager](../memory/fact_storage.md).
2. **Novelty Detection**: If a name appears that has no existing narrative history, it is flagged as a "New Character".

---

## 2. The `HOOK_NEW_CHARACTER_IDENTIFIED` Pipeline

When a new character is found, the engine fires a high-priority hook. This is the integration point for several key plugins:

- **Character Sheets**: Generates a base personality, appearance, and gender for the character using an LLM.
- **Relationship Tracker**: Initializes the character's affinity ledger with the player (usually starting at 0).
- **Sprite Mapper**: Attempts to find a matching sprite in the character catalog or assigns a placeholder.

---

## 3. Persistence & Importance

Not every name mentioned becomes a full character. The bootstrapper filters based on **Importance**:
- **Major/Core**: These characters are registered as full entities and receive a `CHARACTER_INTRODUCTION` fact in the database.
- **Minor/Non-Character**: Characters labeled as "minor" (like a random shopkeeper or a crowd member) are ignored to prevent the database from being cluttered with "one-off" entities.

---

## 4. Manual Overrides

You can manually bootstrap a character by adding a character sheet in the `2_LoreBook` folder. The bootstrapper will detect this file and link the character's name to your predefined lore, skipping the automated generation.
