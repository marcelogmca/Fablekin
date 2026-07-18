function createUiHandlers({ io, Logger }) {
    return {
        async requestTabSwitch(socket, { tab }) {
            Logger.log('Main', 'UI', `Tab switch requested: ${tab}`);
            io.emit('switch-tab', { tab });
        }
    };
}

module.exports = {
    createUiHandlers
};
