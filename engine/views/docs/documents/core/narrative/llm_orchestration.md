# LLM Orchestration And Global Model Routes

Fablekin routes text-generation work through global model aliases. Core modules and plugins choose an alias; the alias selects the provider, concrete model, and optional upstream preference.

## Global Aliases

Four aliases are built in:

| Alias | Intended use |
| :--- | :--- |
| `lowendmodel` | Fast utility work and simple classification. |
| `mediumendmodel` | Balanced extraction, analysis, and cleanup. |
| `highendmodel` | Quality-sensitive orchestration and general reasoning. |
| `veryhighendmodel` | Writing and high-stakes planning. |

Each route is configured under `infrastructure.llm_routing.aliases`:

```json
{
  "highendmodel": {
    "provider": "nano_gpt",
    "model": "deepseek/deepseek-v4-flash:thinking",
    "subprovider": "Deepseek"
  }
}
```

The provider is never owned by the calling module. Changing this route moves every module and plugin using `highendmodel` together. Custom aliases may also be defined in `workspace/settings.json`.

An unknown or incomplete alias fails with a configuration error. Fablekin does not reinterpret it as a literal model name and does not silently fall back to OpenRouter or another provider.

## Supported Text Providers

The central LLM layer currently creates clients for:

- OpenRouter
- NanoGPT
- OpenAI
- Anthropic
- Gemini
- DeepSeek

Provider connection details live under `infrastructure.providers`; model IDs do not. Image generation, embeddings, TTS, and other specialized services have their own configuration and are not part of text-model alias routing.

## Resolving A Route

`resolveModelAlias()` is the authoritative resolver:

```javascript
const { resolveModelAlias } = require('./llm.js');

const route = resolveModelAlias('highendmodel');
// {
//   alias: 'highendmodel',
//   provider: 'nano_gpt',
//   model: 'deepseek/deepseek-v4-flash:thinking',
//   subprovider: 'Deepseek'
// }
```

Resolve definitions through `tools.llm.resolveModelDefinition()` in plugins when you need to display or inspect the selected route. Normal calls only need the alias.

## Core Calls

`callLLM()` resolves the alias before constructing a provider client:

```javascript
const { content, model, provider, usage, reasoning } = await callLLM({
  model: 'highendmodel',
  messages: [
    { role: 'system', content: 'Return one concise scene objective.' },
    { role: 'user', content: sceneSummary }
  ],
  retries: 2,
  timeout: 120000,
  minWords: 3,
  callingModule: 'Scene Objective'
});
```

The returned `model` and `provider` are concrete runtime values, suitable for logs and diagnostics. Do not pass a provider override. A conflicting legacy provider argument is rejected.

## Plugin Calls

Declare an alias selector without a provider:

```javascript
settingsSchema: {
  model_def: {
    type: 'select',
    label: 'Model',
    options: 'llm-aliases',
    default: { model: 'lowendmodel' }
  }
}
```

Then make a structured call:

```javascript
const settings = tools.settings.getSelf();
const assignment = tools.llm.resolveModelDefinition(settings.model_def);

const response = await tools.llm.withSchema({
  model: assignment.model,
  messages: [
    { role: 'system', content: 'Classify the scene mood.' },
    { role: 'user', content: sceneText }
  ],
  retries: 1,
  title: 'Mood Classification'
}, {
  type: 'object',
  required: ['mood'],
  properties: {
    mood: { type: 'string' }
  },
  additionalProperties: false
});
```

`tools.llm.runTask()`, `json()`, and `withSchema()` log the resolved route automatically. Let failures surface or handle them explicitly; do not introduce a provider or model fallback in plugin code.

## Reliability And Validation

The central call loop supports:

- Provider and network error retries.
- Request cancellation and timeouts.
- Empty-response, minimum-character, and minimum-word validation.
- Refusal detection.
- Regular-expression and custom validation.
- Structured-response parsing through `JSON.parse`, JSON5, and `jsonrepair`.
- Optional response sanitization configured in infrastructure settings.

`retries` is the number of retries after the initial attempt. A value of `2` permits up to three total attempts.

## Route-Aware Behavior

After resolution, provider-specific behavior is applied to the concrete route:

- OpenRouter reasoning suffixes such as `:thinking` are translated into reasoning parameters.
- OpenRouter and NanoGPT `subprovider` values are mapped into their respective upstream-routing shapes.
- Reasoning parameters are normalized for compatible providers.
- Usage, pricing, request logs, and response metadata use the resolved provider and model.
- Development-cache fingerprints include the provider, concrete model, subprovider, normalized parameters, messages, and validation options.

Two aliases may point at the same route, but callers should still select aliases by workload intent rather than depend on a particular concrete model.

## Related Documentation

- [Plugin SDK](../plugins/plugin_sdk.md)
- [Plugin API Groups](../plugins/api_groups.md)
- [Example: Prompt and LLM](../plugin_dev/examples.md)
