const { getProjectMetadata, setProjectMetadata } = require('../../config/project_config_store.js');

function createPlayerHandlers({
    getRootDirectory,
    contentManager,
    getProjectName,
    io,
    emitResponse,
    Logger,
    setMainCharacterName,
    setMainCharacterBio
}) {
    return {
        async savePlayerMetadata(socket, { playerMetadata }) {
            const rootDirectory = getRootDirectory();
            if (!rootDirectory) {
                Logger.error('Main', 'CharacterMgmt', 'Root directory not initialized.');
                return emitResponse('save-player-metadata-response', { success: false, error: 'Project not loaded.' });
            }
            try {
                const config = await contentManager.loadFileConfig(rootDirectory);
                const metadata = getProjectMetadata(config);
                metadata.player = playerMetadata;
                const updatedConfig = setProjectMetadata(config, metadata);

                await contentManager.saveFileConfig(rootDirectory, updatedConfig);

                setMainCharacterName(playerMetadata.name || '');
                setMainCharacterBio(playerMetadata.bio || '');
                const projectName = getProjectName();
                io.emit('player-character-updated', { ...playerMetadata, projectName });
                emitResponse('save-player-metadata-response', { success: true });
                Logger.log('Main', 'CharacterMgmt', `Saved player metadata: ${playerMetadata.name || ''}`);
            } catch (error) {
                Logger.error('Main', 'CharacterMgmt', 'Error saving player metadata', error);
                emitResponse('save-player-metadata-response', { success: false, error: error.message });
            }
        },

        async getPlayerMetadata(_socket) {
            const rootDirectory = getRootDirectory();
            if (!rootDirectory) {
                return emitResponse('get-player-metadata-response', { success: false, error: 'Project not loaded.' });
            }
            try {
                const config = await contentManager.loadFileConfig(rootDirectory);
                const metadata = getProjectMetadata(config);
                const playerMetadata = metadata.player || { name: '', bio: '' };
                const projectName = getProjectName();
                emitResponse('get-player-metadata-response', { success: true, playerMetadata: { ...playerMetadata, projectName } });
                return { success: true, playerMetadata: { ...playerMetadata, projectName } };
            } catch (error) {
                Logger.error('Main', 'CharacterMgmt', 'Error getting player metadata', error);
                return { success: false, error: error.message };
            }
        }
    };
}

module.exports = {
    createPlayerHandlers
};
