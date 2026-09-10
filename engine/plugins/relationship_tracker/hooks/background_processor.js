// engine/plugins/relationship_tracker/hooks/background_processor.js

const logic = require('../logic.js');

const backgroundProcessorHook = {
    priority: 50,
    mode: 'parallel',
    useSharedVnLlm: true,
    run: async (turnContext, tools) => {
        await tools.jobs.withJob('Updating character relationships...', {
            id: 'relationship_tracker_background',
            scope: 'turn',
            rethrow: false,
            notifyOnComplete: false
        }, async (job) => {
            tools.logger.runtime(`HOOK_VN_BACKGROUND_TASKS: Starting background relationship processing.`);
            try {
                job.progress(15, 'Extracting relationship shifts...');
                tools.logger.log('ChangeExtraction', 'Starting relationship extraction (background task)', 'start');
                tools.logger.runtime(`Extracting bond shifts from narrative response...`);
                await logic.extractAndStoreRelationshipChanges(turnContext, tools);
                tools.logger.log('ChangeExtraction', 'Finished relationship extraction (background task)', 'end');

                // Consolidate history for involved pairs if needed (Batched)
                const party = turnContext.output.party || [];
                if (party.length > 0) {
                    const pairs = [];
                    for (let i = 0; i < party.length; i++) {
                        for (let j = i + 1; j < party.length; j++) {
                            pairs.push([party[i], party[j]]);
                        }
                    }

                    const playerChar = turnContext.input.playerCharacterName;
                    if (playerChar && playerChar !== 'None') {
                        party.forEach(char => {
                            if (char.toLowerCase() !== playerChar.toLowerCase()) {
                                pairs.push([playerChar, char]);
                            }
                        });
                    }

                    if (pairs.length > 0) {
                        job.progress(65, `Consolidating ${pairs.length} active relationship ledgers...`);
                        tools.logger.runtime(`Checking if narrative ledgers for active pairs need consolidation.`);
                        await logic.consolidateMultipleRelationships(tools, turnContext.projectName, pairs);
                    }
                } else {
                    tools.logger.runtime(`No characters in party. Skipping ledger check.`);
                }

                // Push fresh data to HUD immediately after extraction and consolidation
                if (tools.plugins.isInstalled('vn_hud')) {
                    job.progress(90, 'Syncing relationship HUD...');
                    tools.logger.runtime(`Background tasks complete. Syncing to VN HUD.`);
                    // We'll call the HUD fetch data listener if it's available in the index.js context
                    // But in a modular setup, we might need a better way to trigger it.
                    // For now, we'll assume the index.js will still have a way to call it or we re-export it.
                    if (tools.plugins.get('relationship_tracker')?.socketListeners?.['vn-hud-fetch-data']) {
                        await tools.plugins.get('relationship_tracker').socketListeners['vn-hud-fetch-data']({}, tools);
                    }
                }
                job.progress(100, 'Relationship update complete.');
            } catch (error) {
                tools.logger.error('ChangeExtraction', `Error in relationship background task: ${error.message}`);
                tools.logger.runtime(`CRITICAL ERROR in background tasks: ${error.message}`);
                throw error;
            }
        });
    }
};

module.exports = backgroundProcessorHook;
