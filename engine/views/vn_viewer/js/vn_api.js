import { pixiApp } from './pixi_engine.js';
import { pixiSpriteManager } from './pixi_sprite_manager.js';
import { pixiRenderer } from './pixi_renderer.js';
import { pixiTitleManager } from './pixi_title_manager.js';
import { state } from './state.js';
import { dispatchUCPCommand } from './vn_ucp_dispatcher.js';

function getBrowserMemoryDebug() {
    const memory = (typeof performance !== 'undefined') ? performance.memory : null;
    if (!memory) return null;
    const toMb = (value) => Number((Number(value || 0) / (1024 * 1024)).toFixed(1));
    return {
        jsHeapLimitMb: toMb(memory.jsHeapSizeLimit),
        totalJsHeapMb: toMb(memory.totalJSHeapSize),
        usedJsHeapMb: toMb(memory.usedJSHeapSize)
    };
}

function getDomMemoryDebug() {
    if (typeof document === 'undefined') return null;
    const logMessages = document.getElementById('log-messages');
    const dialogueText = document.getElementById('dialogue-text');
    return {
        totalElements: document.getElementsByTagName('*').length,
        logMessageElements: logMessages?.children?.length || 0,
        logDatasetIndex: logMessages?.dataset?.vnLogIndex || null,
        dialogueTextLength: dialogueText?.textContent?.length || 0
    };
}

export function initGlobalAPI() {
    window.VN = {
        // --- 1. Background ---
        background: {
            getSnapshot: () => pixiRenderer.bgSnapshotTexture,
        },

        // --- 2. Visibility Controls ---
        ui: {
            hideDialogue: () => {
                document.getElementById('dialogue-container').classList.add('hidden');
                const controls = document.getElementById('controls');
                if (controls) controls.classList.add('hidden');
            },
            showDialogue: () => {
                document.getElementById('dialogue-container').classList.remove('hidden');
                const controls = document.getElementById('controls');
                if (controls) controls.classList.remove('hidden');
            },
            hideSprites: () => { 
                if (pixiApp.layers.characters) pixiApp.layers.characters.visible = false; 
            },
            showSprites: () => { 
                if (pixiApp.layers.characters) pixiApp.layers.characters.visible = true; 
            },
            showTitle: (params) => pixiTitleManager.showTitle(params)
        },

        // --- 2. Cam Controls ---
        cam: {
            zoom: (level, duration) => pixiApp.cam.zoom(level, duration),
            pan: (logicalX, logicalY, duration) => pixiApp.cam.pan(logicalX, logicalY, duration),
            reset: (duration) => pixiApp.cam.reset(duration)
        },

        // --- 3. Animations ---
        anim: {
            bounce: (charName) => pixiSpriteManager.bounce(charName),
            shake: (charName) => pixiSpriteManager.shake(charName),
            sink: (charName) => pixiSpriteManager.sink(charName),
            panic: (charName) => pixiSpriteManager.panic(charName),
            emote: (charName, type) => pixiSpriteManager.showEmote(charName, type)
        },

        // --- 4. Sprite Tooling (The Stack) ---
        sprites: {
            // Add a Pixi object behind the character (e.g., halos, backlights)
            addBackFX: (charName, pixiDisplayObject) => {
                pixiSpriteManager.addFX(charName, 'back', pixiDisplayObject);
            },
            // Add a Pixi object in front of the character (e.g., rain blocking them)
            addFrontFX: (charName, pixiDisplayObject) => {
                pixiSpriteManager.addFX(charName, 'front', pixiDisplayObject);
            },
            // Apply a WebGL filter directly to the character (e.g., Blur, Tint, Glitch)
            applyFilter: (charName, filterArray) => {
                const char = pixiSpriteManager.getActiveSprite(charName);
                if (char) char.body.filters = filterArray;
            },
            clearFX: (charName) => pixiSpriteManager.clearFX(charName),
            // Utility: Get a character's base texture if a plugin wants to duplicate it
            getBaseTexture: (charName) => {
                const char = pixiSpriteManager.getActiveSprite(charName);
                return char && char.layers.base ? char.layers.base.texture : null;
            },
            // Utility: Create a properly anchored clone of the character body
            cloneBodySprite: (charName) => {
                const char = pixiSpriteManager.getActiveSprite(charName);
                if (!char || !char.layers.base) return null;
                const clone = new PIXI.Sprite(char.layers.base.texture);
                clone.anchor.set(0.5, 1);
                return clone;
            },
            memoryDebug: () => pixiSpriteManager.getSpriteMemoryDebug()
        },

        // --- 5. SFX Controls ---
        sfx: {
            play: (file, options = {}) => window.dispatchEvent(
                new CustomEvent('sfx:play', { detail: { file, loop: false, category: 'effect', ...options } })
            ),
            loop: (file, options = {}) => window.dispatchEvent(
                new CustomEvent('sfx:play', { detail: { file, loop: true, category: 'background', ...options } })
            ),
            stop: (file, force = false) => window.dispatchEvent(
                new CustomEvent('sfx:stop', { detail: { file, force } })
            )
        },

        // --- 6. Audio Volume (Read-Only) ---
        // For mini-game plugins that manage their own Audio instances
        // and need to respect the player's volume preferences.
        audio: {
            getVolume: (category = 'sfx') => {
                const audio = state.vnSettings?.audio || {};
                if (category === 'ost') return audio.ost_volume ?? 0.5;
                if (category === 'tts' || category === 'voice') return audio.tts_volume ?? 0.5;
                if (category === 'bgm_sfx' || category === 'ambient') return audio.bgm_sfx_volume ?? 0.3;
                return audio.sfx_volume ?? 0.5; // default: sfx
            }
        },

        // --- 7. Generic UCP Command Dispatcher ---
        // Parses a UCP command string and fires the appropriate CustomEvent.
        // Example: VN.command('anim:shake:Skirk') or VN.command('sfx:trigger:hit.mp3')
        command: (cmdString) => dispatchUCPCommand(cmdString),

        // --- 8. Advanced Pixi Plugin Runtime ---
        pixiPlugins: window.VN?.pixiPlugins || null,

        // --- 9. Runtime Memory Diagnostics ---
        memoryDebug: () => ({
            browser: getBrowserMemoryDebug(),
            dom: getDomMemoryDebug(),
            sprites: pixiSpriteManager.getSpriteMemoryDebug(),
            renderer: pixiRenderer.getMemoryDebug?.() || null,
            spriteShading: window.__spriteShadingMemoryDebug?.() || null
        })
    };

    console.log('[VN API] Global window.VN tools ready.');
}
