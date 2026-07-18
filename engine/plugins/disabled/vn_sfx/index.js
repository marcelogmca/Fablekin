const fs = require('fs/promises');
const path = require('path');

module.exports = {
    id: 'vn_sfx',
    name: 'VN SFX',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Audio',
    wizard: {
        include: true,
        order: 700,
        group: 'Audio',
        label: 'VN SFX',
        recommended_enabled: true,
        author_note: 'Enables other plugins to trigger sound effects in the VN viewer.',
        enabled_note: 'Scenes can play one-shot and looping sound effects through the VN viewer.',
        disabled_note: 'VN playback remains silent except for systems outside this SFX layer.',
        settings_note: 'Tune available sound categories and frontend playback behavior in plugin settings.'
    },
    description: 'Handles sound effects for the VN viewer, supporting one-off and looping sounds.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'This plugin manages sound effects. It listens for sfx:play and sfx:stop events.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Scans the project sound directories and provides a structured "SFX Prompt" to the Cinematographer agent. It maps narrative triggers (e.g. "it rains") to specific audio assets (e.g. "rain.mp3") to maintain acoustic immersion.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'Medium',
            cost: 'None',
            latency: 'None'
        }
    },

    exports: {
        'getSfxPrompt': async (_turnContext, _tools) => {
            const soundsDir = path.join(__dirname, 'sounds');

            const scanSounds = async (dir, prefix = '') => {
                let list = [];
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                        if (entry.isDirectory()) {
                            list = list.concat(await scanSounds(fullPath, relativePath));
                        } else if (entry.isFile() && /\.(mp3|wav|ogg|m4a)$/i.test(entry.name)) {
                            list.push(relativePath);
                        }
                    }
                } catch { }
                return list;
            };

            const allSounds = await scanSounds(soundsDir);
            const effects = allSounds.filter(s => s.startsWith('effects/')).map(s => s.replace('effects/', ''));
            const background = allSounds.filter(s => s.startsWith('background/')).map(s => s.replace('background/', ''));

            /**
             * SFX CUSTOM SOUNDS "API":
             * Other plugins can inject project-specific or dynamically generated sounds by writing to:
             * tools.pluginState.forPlugin('vn_sfx').turn().extraSounds = [
             *   { file: "custom.mp3", category: "effect", servePath: "projects/my/assets/custom.mp3" }
             * ]
             * 
             * 'file': The name shown to the LLM (no paths)
             * 'category': 'effect' (one-off) or 'background' (loop)
             * 'servePath': The URL/Path relative to the server root for the frontend to fetch
             */
            const extraSounds = _tools.pluginState.forPlugin('vn_sfx').fromContext(_turnContext).turn().extraSounds || [];
            extraSounds.forEach(s => {
                if (s.category === 'background') background.push(s.file);
                else effects.push(s.file);
            });

            return `
=== SOUND EFFECTS (SFX) COMMAND GRAMMAR ===
- "sfx:start:[file]" (For persistent ambient loops e.g. "crowd.mp3")
- "sfx:stop:[file]" (Stop a specific loop)
- "sfx:trigger:[file]" (One-off sound impact e.g. "single_sword_hit.mp3")

=== AVAILABLE SFX ASSETS ===
ONE-OFF EFFECTS:
${effects.length > 0 ? [...new Set(effects)].map(s => `- "${s}"`).join('\n') : '- (None found)'}

AMBIENT LOOPS:
${background.length > 0 ? [...new Set(background)].map(s => `- "${s}"`).join('\n') : '- (None found)'}

Attention: If the scene is indoors or starts indoors, do not start any ambient loops.
Only do it when the scene is obviously outdoors or on the line where you know the characters go outside. 

STRICT RULE: Sounds listed under "AMBIENT LOOPS" must ALWAYS be started with "sfx:start" and turned off with "sfx:stop" if they are potentially obnoxious if left running constantly. Never use "sfx:trigger" for them. "sfx:trigger" is ONLY for "ONE-OFF EFFECTS".

Note: Provide ONLY the filename (e.g. "rain.mp3"). Only use high-impact triggers.
            `.trim();
        }

    },

    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 20,
            run: async (context, tools) => {
                try {
                    const jsPath = path.join(__dirname, 'ui.js');
                    let js = await fs.readFile(jsPath, 'utf8');
                    return { id: 'vn_sfx', js: js };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read vn_sfx files:', error);
                    return null;
                }
            }
        }
    }
};
