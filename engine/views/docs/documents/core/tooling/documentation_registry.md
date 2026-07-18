# Documentation System and Index

The Docs view builds its navigation from the documentation files currently installed with Fablekin and from documentation registered by enabled plugins. There is no hand-maintained `docs_index.js`.

## Dynamic Registration

At startup, the documentation scanner walks `engine/views/docs/documents/core` and extracts each document's ID, title, description, category, path, and extension. The Plugin Manager combines these core entries with plugin-provided documents and sends the current index to the Docs view over `docs:req-index` and `docs:res-index` events.

When an HTML and Markdown document share the same ID, the Docs view prefers HTML. This lets visually rich HTML remain canonical inside Fablekin while its generated Markdown companion remains convenient on GitHub.

## Navigation

`renderer_docs.js` builds the sidebar hierarchy and search data from the received index. It also handles:

- `docs:open` events carrying `{ docId }`.
- Same-document anchor links.
- Relative links to other indexed documents.
- Back navigation and breadcrumbs.

External web links are not opened by the Docs view.

## Authoring and Generation

- Author Markdown-only pages directly.
- For paired pages, edit the HTML source rather than its generated Markdown companion.
- Run `npm run docs:index` from `engine` to regenerate every HTML companion and rebuild `documents/README.md`.
- Run `npm run docs:coverage` to compare documented source hashes against the repository and write `scripts/doc_health_report.txt`.

The YAML metadata files used by the coverage tool are separate from the live Docs index. They associate documentation with implementation files so changed or missing sources can be reported; they do not control what appears in the application.
