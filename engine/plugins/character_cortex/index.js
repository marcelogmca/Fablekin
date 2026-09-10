const logic = require('./logic.js');

const EVENT_ACTIONS = {
    'character-cortex:bootstrap': 'bootstrap',
    'character-cortex:get-profile': 'profile:get',
    'character-cortex:create-profile': 'profile:create',
    'character-cortex:update-profile': 'profile:update',
    'character-cortex:archive-profile': 'profile:archive',
    'character-cortex:delete-profile': 'profile:delete',
    'character-cortex:duplicate-profile': 'profile:duplicate',
    'character-cortex:save-persona': 'persona:save',
    'character-cortex:save-scenario': 'scenario:save',
    'character-cortex:generate-scenario': 'scenario:generate',
    'character-cortex:generate-actor': 'actor:generate',
    'character-cortex:submit-feedback': 'feedback:submit',
    'character-cortex:decide-proposal': 'proposal:decide',
    'character-cortex:update-principle': 'principle:update',
    'character-cortex:export-profile': 'profile:export',
    'character-cortex:import-profile': 'profile:import'
};

const socketListeners = Object.fromEntries(Object.entries(EVENT_ACTIONS).map(([eventName, action]) => [
    eventName,
    async (data, tools) => {
        try {
            const result = await logic.dispatch(action, data || {}, tools);
            tools.socket.emit(`${eventName}-response`, { success: true, result });
        } catch (error) {
            tools.logger.error('CharacterCortex', `${action} failed: ${error.message}`);
            tools.socket.emit(`${eventName}-response`, { success: false, error: error.message });
        }
    }
]));

module.exports = {
    id: 'character_cortex',
    name: 'Character Cortex',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    description: 'Build project-local, full-text situation, character reaction, and human judgment datasets.',
    views: [{ id: 'character_cortex_lab', label: 'Character Cortex', entry: 'ui.html' }],
    socketListeners
};
