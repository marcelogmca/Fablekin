# Example: Prompt and LLM

## Purpose
Makes a small structured LLM call through a global model alias and injects validated guidance.

## Try it
Enable the plugin, select a configured alias, and start a turn with a user prompt.

## Key APIs
`llm-aliases`, `tools.llm.withSchema()`, `tools.prompt.wrap()`, and `inject()`.

## Adapt it
Keep schemas narrow, handle failures directly, and never add a provider fallback.
