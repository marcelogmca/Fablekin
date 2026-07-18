function createMemoryHandlers({ memorymanagement, getProjectName, Logger, emitResponse }) {
    return {
        async getMemoryData(socket, { storeType }) {
            const projectName = getProjectName();
            Logger.log('Main', 'MemoryMgmt', `Request received for store type: ${storeType} in project: ${projectName}`);
            try {
                const data = await memorymanagement.inspectStore(projectName, storeType);
                emitResponse('get-memory-data-response', { success: true, result: { data, storeType } });
            } catch (error) {
                Logger.error('Main', 'MemoryMgmt', 'Error inspecting memory store', error);
                emitResponse('get-memory-data-response', { success: false, error: error.message, result: { storeType } });
            }
        }
    };
}

module.exports = {
    createMemoryHandlers
};
