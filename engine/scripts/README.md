# Documentation Tooling

This directory contains scripts for maintaining the documentation health and structure of the Fablekin engine.

## Commands

### 1. Documentation Coverage (`npm run docs:coverage`)
- **Script**: `docs_coverage.js`
- **Purpose**: Checks if every `.js`, `.html`, and `.css` file in the engine is accounted for in the documentation.
- **How it works**: It scans `engine/` and compares file hashes against the `.yaml` metadata in `engine/views/docs/documents/core/`.
- **When to run**:
    - After adding a new file to the codebase.
    - After significantly changing a file's logic (to detect "outdated" docs).
    - To verify 100% documentation coverage.

### 2. Documentation Indexer and HTML Converter (`npm run docs:index`)
- **Script**: `docs_indexer.js`
- **Purpose**: Validates documentation formatting, generates Markdown companions for rich HTML documents, and rebuilds the offline documentation index.
- **How it works**: Scans `documents/core`, converts every `.html` document into an adjacent generated `.md` companion, then rebuilds `documents/README.md` from the complete documentation index.
- **When to run**:
    - After adding or editing a canonical HTML documentation file.
    - After adding a Markdown-only documentation file.
    - After renaming or moving a documentation file.
    - To update generated companions and the offline GitHub index.

### 3. Full Health Check (`npm run docs:all`)
- Runs both of the above scripts in sequence. Recommended before committing documentation changes.

## Best Practices
- **Canonical sources**: When an HTML document has an adjacent Markdown file, edit the HTML. The Markdown companion is generated and will be overwritten by `docs:index`.
- **Markdown-only docs**: Documents without an HTML companion are authored directly in Markdown.
- **Titles**: Give Markdown files a `# Header` and HTML files a meaningful `<title>`.
- **Descriptions**: Keep the first meaningful paragraph concise; the scanner uses it as the index summary.
- **Hashes**: If `docs:coverage` reports an "Outdated" file, update the `hash` in the corresponding `.yaml` file to match the current code state.
