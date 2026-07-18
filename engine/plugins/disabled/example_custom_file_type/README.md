# Example: Custom File Type

## Purpose
Registers a structured Content Manager mode, renders a safe read-only file view, and injects selected valid files into a prompt.

## Try it
Enable the plugin, create an Example Item file, open it in Content Manager, select it, and start a turn.

## Key APIs
`tools.project.registerFileMode()`, `exports.provideFileView`, `tools.project.getSelectedFiles()`, sandboxed file reads, and `tools.prompt.inject()`.

## Adapt it
Treat files as untrusted input: handle missing selection, read failures, malformed JSON, and HTML escaping before rendering values.
