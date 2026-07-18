# Example: Background Job

## Purpose
Shows how to wrap non-critical work in a tracked lifecycle with progress, cancellation checks, completion, and handled failure.

## Try it
Enable the plugin and run `/example-job`. Run `/example-job fail` to see a failure reported and cleaned up without crashing the command.

## Key APIs
`tools.jobs.withJob()`, `job.progress()`, `job.throwIfCancelled()`, and job scope/error options.

## Adapt it
Use turn scope for work that becomes stale when the story advances. Pass cancellation signals to APIs that support them, and choose deliberately whether failures should be rethrown.
