# Plugin Hooks And Runtime Execution

Hooks let plugins participate in the narrative pipeline and application lifecycle. `hook_executor.js` orders listeners, supplies plugin-scoped tools, records timing, and isolates ordinary listener failures.

## Declaring A Hook

```javascript
hooks: {
  HOOK_POST_PROMPT_BUILDER: {
    priority: 100,
    mode: 'sequential',
    allowInterlude: true,
    run: async (turnContext, tools, ...args) => {
      tools.prompt.inject(
        'simulation',
        tools.prompt.wrap('example_context', 'Additional prompt context.'),
        'root'
      );
    }
  }
}
```

Handlers receive the active `turnContext`, tools scoped to the owning plugin, and any hook-specific arguments.

## Execution Modes

| Mode | Behavior | Use it for |
| :--- | :--- | :--- |
| `sequential` | Awaited before execution continues. | Ordered mutations or work that later listeners depend on. |
| `parallel` | Consecutive parallel listeners in the same priority group run with `Promise.all`. | Independent blocking work. |
| `background` | Started without awaiting completion. It still runs in the same Node.js process. | Non-critical work that must not delay the hook. |

Background mode is not a worker thread or process boundary. It does not isolate CPU-heavy work, and a background listener must not be relied upon to mutate state needed by the current pipeline. Its eventual errors are logged asynchronously.

`HOOK_VN_BACKGROUND_TASKS` is force-non-blocking at the hook level. For VN work with dependencies or explicit blocking behavior, register task descriptors through `HOOK_VN_PIPELINE_TASKS` instead of inventing a second scheduler.

## Priority And Ordering

Lower priority numbers run first. Listeners are grouped by priority, and groups complete in order.

Within one group:

- Sequential listeners are awaited individually.
- Consecutive parallel listeners form a parallel batch.
- Background listeners are launched and execution moves on.

Use priority only when a real data dependency exists. Plugins with unrelated work should not depend on incidental registration order.

## Errors, Abort, And Cancellation

Ordinary sequential and parallel listener errors are logged and isolated so other plugins can continue. Background errors are logged when their promises settle.

`PipelineAbortError` is different: when thrown by an awaited listener, it stops the hook and propagates to the parent pipeline. Use it only for deliberate control flow such as an intercept that must pause or replace normal generation. A fire-and-forget background listener cannot reliably abort work that has already continued.

The executor also checks global pipeline cancellation before hooks, priority groups, and listeners. Long-running plugin work should use cancellation-aware APIs where available rather than hide work in an untracked promise.

## Mainline And Interlude Policies

The active policy comes from `turnContext.runtime.turnPipeline.hookPolicy`:

- `all`: listeners run normally, subject to an optional `sceneModes` allowlist.
- `opt-in`: only listeners that permit the active scene mode run. Interludes use this by default.

A hook may opt into interludes with:

```javascript
allowInterlude: true
```

`runOnInterlude: true` is accepted as an alias. For explicit control, use:

```javascript
sceneModes: ['mainline', 'interlude']
```

These fields may also be declared at plugin level as defaults. A hook-level `false` can decline a plugin-level interlude default.

## Progress And Timing

Pipeline hooks expose ordered manifest metadata and logical weights to the UI progress system. The internal `WorkQueue` can display configured minimum/maximum time ranges, but it does not learn historical averages.

For every executed hook, timing is recorded under:

```text
turnContext.runtime.performance.hooks[hookName]
```

The record contains hook start, end, duration, and per-listener timing for awaited sequential and parallel listeners. It is raw profiling data; the executor does not automatically identify a critical path.

Runtime diagnostics are normally transient. They are serialized only when `infrastructure.enable_runtime_persistence` is enabled.

## Practical Guidance

- Prefer `sequential` when mutating shared `turnContext` data.
- Prefer `parallel` only when listeners are independent.
- Keep background listeners self-contained and safe to finish after the hook returns.
- Use `tools.jobs` for visible, managed background jobs.
- Use `HOOK_VN_PIPELINE_TASKS` for dependency-aware VN tasks.
- Make interlude participation explicit.

## Related Documentation

- [Plugin Architecture](plugin_architecture.md)
- [Plugin State and Storage](plugin_state.md)
- [Run Profiles and Virtual Turns](../system/run_profiles_virtual_turns.md)
- [Example Plugin Catalog](../plugin_dev/examples.md)
