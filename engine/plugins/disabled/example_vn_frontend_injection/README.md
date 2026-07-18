# Example: VN Frontend Injection

## Purpose
Shows how to add a persistent overlay to the normal VN viewer, update it from plugin backend code, and clean up every listener and DOM node.

## Try it
Enable the plugin and open the VN viewer. The badge reports its backend connection and updates as dialogue advances.

## Key APIs
`HOOK_FRONTEND_INJECTION`, `{ id, html, css, js }`, namespaced socket events, `VN.pixiPlugins.register()`, `runtime.onSocket()`, `runtime.onWindow()`, and `runtime.onDispose()`.

## Adapt it
Use frontend injection for UI that lives alongside normal VN playback. Use a custom view for a separate page, a GUI intercept for checkpoint UI, and a Pixi intercept for temporary canvas takeover.
