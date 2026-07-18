# Example: Plugin State and Facts

## Purpose
Shows process runtime state, per-turn state, plugin-scoped persisted facts, and a timeline card backed by those facts.

## Try it
Enable the plugin, complete a turn, then run `/example-state` and open the timeline entry for that turn.

## Key APIs
`pluginState.runtime()`, `pluginState.turn()`, `cleanUpFactsDb()`, `appendToFactsDb()`, and `timelineProviders`.

## Adapt it
Scope fact queries and cleanup predicates to your plugin's own records. Timeline providers should return `null` when they have nothing useful to show.
