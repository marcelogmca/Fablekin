# Security and Secret Storage

Fablekin protects secrets at rest and applies path checks to selected project operations. These controls reduce accidental exposure; they do not turn untrusted code into safe code.

## Secret Storage

Provider keys and plugin secrets are stored in `plugin_secrets.json` under Fablekin's Electron `userData` directory. Values are encrypted with Electron `safeStorage`, using the operating system's available credential-protection service.

- Secrets are not stored in a project `.config` or checked-in settings file.
- Saving a secret requires OS-backed encryption to be available. If it is unavailable, Fablekin rejects the save instead of pretending it succeeded.
- Encryption protects the stored file from casual disclosure and from copying it to an environment that cannot decrypt it. It does not protect secrets from code running as the same OS user.

Enabled plugins are trusted Node.js extensions. A malicious or compromised plugin can access application runtime data and should be treated as capable of affecting the local system. Install only reputable plugins.

## Project Path Guards

Main-process file handlers and scoped project tools validate that requested paths remain inside the project root. The shared path guard resolves existing physical paths, including symlinks and junctions, before comparing them, and checks the nearest existing parent for new files.

`tools.project.readFile()` is restricted to the active project directory. Other plugin capabilities have their own documented scopes.

Path guards prevent common traversal mistakes; they are not a sandbox for arbitrary Node.js plugins. Trusted plugins can still use Node APIs unless their execution environment explicitly limits them.

## Executable Extensions

- **Plugins** run as trusted Node.js code. Review the source and provenance before enabling one.
- **Story Scripts** use content-hash approval, a restricted evaluation context, and a startup timeout. This is defense in depth, not a complete security boundary. See [Story Scripts and Trust](../plugins/story_scripts_security.md).
- **Project content** such as lore, chronicles, and assets remains ordinary project data. Protect the project folder with normal operating-system permissions and backups.
