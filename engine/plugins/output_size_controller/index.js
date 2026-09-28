const logic = require('./logic.js');

const MINIMUM_ACCEPTANCE_RATIO = 0.5;

module.exports = {
    id: 'output_size_controller',
    name: 'Output Size Controller',
    author: 'Fablekin Core',
    version: '1.0.1',
    category: 'Utility',
    wizard: {
        include: true,
        order: 900,
        group: 'Utility',
        label: 'Output Size Controller',
        recommended_enabled: true,
        author_note: 'Recommended if you want predictable scene length instead of variable LLM output size.',
        enabled_note: 'Adds target word count guidance and optional expansion behavior for undersized turns.',
        disabled_note: 'Turn length depends more directly on model behavior and prompt momentum.',
        settings_note: 'Tune word count and auto-expansion behavior in the Content Manager panel and plugin settings.'
    },
    description: 'Sets the target word count for story turns with play time and dialogue estimates.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Controls the length and depth of the story. Ensures the AI doesn\'t cut scenes short or ramble unnecessarily.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Implements a "Length Enforcement Protocol." If the generated output falls significantly below the target word count, it triggers a recursive "Expansion Call" that instructs the LLM to pick up exactly where it left off, deepening the current interaction rather than summarizing it.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'None',
            cost: 'Medium',
            latency: 'Medium'
        }
    },
    hooks: {
        'HOOK_CONTENT_MANAGER_GUI_READY': async (turnContext, tools) => {
            const metadata = await tools.project.getMetadata();
            const currentWordCount = metadata?.word_count || logic.DEFAULT_WORD_COUNT;
            const autoExpand = metadata?.auto_expand || false;
            const panelOpen = metadata?.output_size_panel_open !== undefined ? metadata.output_size_panel_open : false;

            const html = logic.getGuiHtml(currentWordCount, panelOpen, autoExpand);
            const css = logic.getGuiCss();
            const js = logic.getGuiJs();

            tools.gui.inject({
                html: html,
                css: css,
                js: js,
                selector: '#plugin-injection-container'
            }, 'content_manager');
        },
        'HOOK_POST_ORCHESTRATOR': {
            allowInterlude: true,
            run: async (turnContext, tools) => {
            const metadata = await tools.project.getMetadata();
            const wordCount = metadata?.word_count || logic.DEFAULT_WORD_COUNT;

            turnContext.writerMinimumWordCount = Math.ceil(wordCount * MINIMUM_ACCEPTANCE_RATIO);
            const directive = `Output around ${wordCount} words.`;

            // 1. Bottom Instruction (Prose reinforcement)
            const existingBottom = turnContext.processed.writerBottomInstruction || '';
            turnContext.processed.writerBottomInstruction = existingBottom ? `${existingBottom} ${directive}` : directive;

            // 2. CoT Instruction (Planning reinforcement)
            const cotDirective = `Step 8: Target Length Alignment
- Word Count Goal: ${wordCount} words.
- Strategy: Plan the scene beats and depth of interaction to ensure the narrative reaches the target word count while maintaining high engagement and meaningful prose.
- If the planned scene would end far below the target, do not summarize or close early. Deepen the present interaction: let characters pursue different wants, answer specific points, reveal useful details, resist each other, and act on what was said. Give a speaker room to develop a thought rather than adding filler replies.
- Do not pad with scenery. Extend the live interaction.`;

            const finalQuantityCheck = `Final Quantity Check
- Beat Word Budget: [Allocate the ${wordCount}-word target across the locked beats: Beat A ~X words, Beat B ~Y words, etc. Does the total satisfy the target and stay safely above the ${turnContext.writerMinimumWordCount}-word hard minimum?]
- Conversation Depth: [Do the dialogue-led beats contain sustained thoughts, specific responses, differences in viewpoint, and a change in the scene? Vary speaking-turn length. Delete exchanges made only of acknowledgements, echoed questions, or repeated promises.]
- Compliance Before Writing: [If the beat budget misses the word target, deepen consequential interactions and actions before writing. Do not add short voice lines merely to increase the rendered line count.]
- Commit: [Now write each beat and meet the word target through substantive scene development.]`;

            if (!Array.isArray(turnContext.processed.writerCoTInsertions)) {
                turnContext.processed.writerCoTInsertions = [];
            }

            turnContext.processed.writerCoTInsertions.push({
                content: cotDirective,
                insertAfterStep: 7,
                stepIdMode: 'original'
            });

            turnContext.processed.writerCoTInsertions.push({
                content: finalQuantityCheck,
                stepIdMode: 'original'
            });

            tools.logger.log(`Injected word count directive: ${wordCount} words (Prose + CoT). Minimum accepted Writer response: ${turnContext.writerMinimumWordCount} words.`);
            }
        },
        'HOOK_POST_WRITER': {
            allowInterlude: true,
            run: async (turnContext, tools) => {
            const metadata = await tools.project.getMetadata();
            if (!metadata?.auto_expand) return;

            const targetWords = metadata.word_count || logic.DEFAULT_WORD_COUNT;
            const currentOutput = turnContext.processed.narrativeEngine.writerResponse || '';
            const currentWordCount = currentOutput.split(/\s+/).filter(w => w.length > 0).length;

            // Threshold: 66% of target
            if (currentWordCount < targetWords * 0.66) {
                tools.logger.log(`Output size (${currentWordCount} words) is below 66% of target (${targetWords}). Triggering expansion...`);

                tools.status.update('Expanding narrative... (Caching engaged)', {
                    id: 'narrative_pipeline',
                    blocking: true,
                    priority: 55,
                    icon: '🚀'
                });

                try {
                    const originalMessages = turnContext.processed.promptBuilder.messages || [];
                    const continuationProtocol = `[SYSTEM PROTOCOL: LENGTH ENFORCEMENT]
The scene ended prematurely. Do not summarize or conclude the event yet. Pick up exactly where the last sentence left off and maintain the same formatting. Deepen the current interaction through specific responses, differing motives, consequential action, and speaking turns long enough to develop a thought. Do not pad the continuation with echoed questions, acknowledgements, or short replies that repeat what is already understood.`;

                    const expansionMessages = [
                        ...originalMessages,
                        { role: 'assistant', content: currentOutput },
                        { role: 'user', content: continuationProtocol }
                    ];

                    // Harvest writer settings to ensure consistency
                    const settings = tools.settings.get();
                    const writerSettings = settings.narrative_agents?.writer || {};

                    const response = await tools.llm.runTask({
                        msg: 'Writer (Expansion)',
                        messages: expansionMessages,
                        model: writerSettings.model,
                        provider: writerSettings.provider,
                        params: {
                            retries: writerSettings.retries,
                            timeout: writerSettings.timeout,
                            ...(writerSettings.llm_params || {})
                        }
                    });

                    if (response && response.content) {
                        const newContent = response.content.trim();
                        // Strip potential repetitive prefixes if the LLM tried to "continue" literally
                        const cleanedNewContent = newContent.replace(/^["\s]*/, '');

                        turnContext.processed.narrativeEngine.writerResponse = currentOutput.trim() + " " + cleanedNewContent;
                        tools.logger.log(`Expansion successful. New word count: \${turnContext.processed.narrativeEngine.writerResponse.split(/\s+/).length} words.`);
                    }
                } catch (err) {
                    tools.logger.error('Failed to expand narrative', err);
                } finally {
                    // Restore original notification or clear
                    tools.status.clear('narrative_pipeline');
                }
            }
            }
        }
    },

    socketListeners: {
        'save-output-size': async (data, tools) => {
            try {
                const metadata = await tools.project.getMetadata() || {};
                metadata.word_count = data.word_count;
                metadata.auto_expand = data.auto_expand || false;
                await tools.project.updateMetadata(metadata);

                tools.socket.emit('save-output-size-response', { success: true });
                tools.logger.log(`Output size updated to ${data.word_count} words.`);
            } catch (err) {
                tools.logger.error('Error saving output size', err);
                tools.socket.emit('save-output-size-response', { success: false, error: err.message });
            }
        },
        'save-output-panel-state': async (data, tools) => {
            try {
                const metadata = await tools.project.getMetadata() || {};
                metadata.output_size_panel_open = data.open;
                await tools.project.updateMetadata(metadata);
            } catch (err) {
                tools.logger.error('Error saving output panel state', err);
            }
        }
    }
};
