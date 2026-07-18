# Example: Director Integration

## Purpose
Shows how a plugin can advertise an optional narrative capability and contribute a focused planning instruction to the Director.

## Try it
Enable the plugin, optionally set Example Scene Guidance for the current project, and generate a normal story turn. Inspect Director diagnostics for the registered capability and planning note.

## Key APIs
`tools.director.registerCapability()`, `tools.director.cot.add()`, `tools.director.getFeedback()`, and `tools.directives.getFormatted()`.

## Adapt it
Use a capability for a distinct phase the Director may hand off to. Use a planning note for guidance that belongs inside an ordinary turn. Keep both optional and narrowly scoped.
