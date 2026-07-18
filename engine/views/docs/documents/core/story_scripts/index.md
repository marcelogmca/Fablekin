> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Story Scripts

Story Scripts are project-level `.md` files (though they contain JavaScript logic) that allow you to customize the behavior of the engine for a specific adventure.

**Important:** Story Scripts are executable local code. Fablekin asks you to review and approve each new or changed script, but approval is not a security sandbox. Only trust scripts you wrote, reviewed, or received from a reputable author.

## Basic Architecture

A Story Script is essentially a module that exports an object with hooks. These hooks allow you to intercept and modify the state of the story at various points.



```
module.exports = {
    id: 'my_custom_script',
    hooks: {
        // This hook runs before a turn renders, allowing you to inject VFX/SFX
        'HOOK_VN_BLOCKING_TASKS': {
            priority: 10,
            run: async (context, tools) => {
                const { processed } = context;
                
                // Example: Add a pixelate effect if the character is 'mysterious'
                if (processed.tags.includes('glitch')) {
                    processed.vfx.push({ type: 'pixelate', intensity: 0.3 });
                }
            }
        }
    }
};
```



## Available Hooks

- **HOOK_VN_BLOCKING_TASKS**: Executed by the renderer before displaying the next beat. Perfect for visual/audio overrides.

- **HOOK_TURN_START**: Executed by the backend when a new turn is initiated by the player.

- **HOOK_VN_GUI_READY**: Executed once the UI has finished loading the new state.

## Global Context

The `context` object contains the current story state, including `turnContext`, `processed` data (VFX, SFX, background), and `meta` information.

## Included Tools

The `tools` object provides access to the engine's core capabilities:

- `tools.llm.call`: Make resilient AI requests.

- `tools.socket.emit`: Send custom events to the UI.

- `tools.db.chat`: Interact with the narrative history.