> [!NOTE]
> This is an automatically generated companion file for [index.html](index.html). The original doc might contain interactive elements for better understanding.

# Game Over SDK Reference

The Game Over system allows plugins to trigger terminal narrative states that lock user input while preserving the **Undo** functionality. It supports both turn-level termination and specific line-level death triggers.

## 1. Backend Triggering

To end the game at the end of a turn, modify the `turnContext.output` object in a backend hook (like `HOOK_POST_VN_GENERATION`).



```
hooks: {
    'HOOK_POST_VN_GENERATION': {
        run: async (turnContext) => {
            if (playerDied) {
                turnContext.output.isGameOver = true;
                turnContext.output.gameOverConfig = {
                    text: "YOU DIED",
                    subtext: "Your journey ends here.",
                    style: { 
                        fill: "#ff4444",
                        fontSize: 140
                    }
                };
            }
        }
    }
}
```



## 2. Line-Level Death (UCP Command)

You can trigger a Game Over at a specific dialogue line using the `gameover` command. This takes priority over turn-level flags.



```
gameover[:Title Text[:Subtext Description]]
```


**Example:** `gameover:WAVELENGTH COLLAPSE:Reality has been overwritten.`

## 3. Frontend Hooks

| Hook Name | Type | Description |
| --- | --- | --- |
| HOOK_GAME_OVER_SCREEN | Frontend | Fired when the Game Over overlay appears. Use this to inject custom HTML or trigger SFX. |

## 4. Styling Customization

When the engine is in a Game Over state, the `.game-over-active` class is applied to the `#user-input-container` and `#dialogue-container`. You can target these in your plugin's CSS to customize the failure appearance.

Additionally, the **Undo** button (`#undo-message`) remains visible and accessible during this state, utilizing global semantic variables like `--status-danger-rgb` for consistent visuals.