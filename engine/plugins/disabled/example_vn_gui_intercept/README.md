# Example: VN GUI Intercepts

## Purpose
An advanced reference for blocking, chained, non-blocking, persisted, backend-backed, and PixiJS intercepts.

## Try it
Enable the plugin, select a configured model alias, and enter a VN scene. Different dialogue checkpoints demonstrate different intercept styles.

## Key APIs
`registerRuntimeIntercept()`, `registerPersistentIntercept()`, backend socket listeners, bridge navigation, and lifecycle cleanup.

## Adapt it
Start from one scenario, namespace all events and IDs, and clean up every listener, timer, and Pixi resource on every exit path.
