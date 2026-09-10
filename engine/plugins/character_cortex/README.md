# Character Cortex

Character Cortex is a standalone, project-scoped behavior training laboratory. Its current workflow builds a full-text dataset of situations, in-character reaction vignettes, ratings, and human judgments.

## Storage

Each project owns its data at:

```text
plugins/character_cortex/character_cortex.db
```

The database stores profiles, current personas, immutable persona revisions used by generations, complete raw evidence, and generation attempts. The schema for later analysis, policy principles, evidence links, and revision history remains available but curation is disabled for now.

## Workflow

1. Create a character profile and paste the persona.
2. Select independent model aliases for situation generation and character portrayal.
3. Generate an adaptive situation or write and edit one manually.
4. Generate a reaction vignette.
5. Rate it from one to five and explain the judgment.

The Analysis/Distillation model and principle-curation workflow are retained for future use but are not invoked by feedback submission.

Character Cortex does not register narrative or VN-generation hooks. Provider credentials remain owned by Fablekin's central LLM layer.
