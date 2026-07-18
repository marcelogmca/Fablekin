# Story Scripts and Trust

Story Scripts let a project provide JavaScript hooks through a Markdown file. They are useful for story-specific rules and presentation behavior, but they are still executable local code. Only enable scripts you wrote, reviewed, or received from a reputable author.

## What Counts as a Story Script?

Any `.md` file assigned the **Story Script** content mode is treated as a transient project plugin. Fablekin executes the first fenced `javascript` or `js` block. If there is no matching fence, the entire file is interpreted as JavaScript.

See [Story Scripts](../story_scripts/index.md) for the module shape and hook examples.

## Review and Approval

Fablekin uses content hashes to detect new and changed scripts:

1. The exact file content is read and hashed with SHA-256.
2. Previously approved content can load without another prompt.
3. A new or changed script pauses project initialization and opens a code-review warning.
4. Scripts are reviewed one at a time. **Trust This Script** approves only the displayed content.
5. **Safe Mode** loads no Story Scripts for the current session.

The approved hash and basic file metadata are stored in Fablekin's local user-data directory. Editing even one character changes the hash and requires another review. Fablekin executes the same in-memory content it hashed, preventing a different file revision from being substituted between approval and execution.

## Restricted Evaluation Context

Story Script modules are evaluated in a narrow JavaScript context:

- `module`, `exports`, and a scoped `console` are available.
- Node globals such as `require`, `process`, and `Buffer` are not provided.
- String-based code generation and WebAssembly generation are disabled.
- Initial module evaluation has a short timeout to catch blocking setup code.

Hook functions receive the normal plugin `context` and project-scoped `tools` when Fablekin calls them.

## What These Protections Do Not Guarantee

The hash prompt proves only that the content matches a version you previously approved. It does not prove that the code is harmless. A Node VM context is defense in depth, not a complete security boundary, and an approved script can still change story state or use the capabilities exposed through plugin tools.

The keyword warning shown during review is advisory. Code without a warning may still be unsafe, and legitimate code may trigger one.

Treat Story Scripts like plugins: inspect unfamiliar code, prefer reputable sources, and choose Safe Mode whenever you are uncertain.
