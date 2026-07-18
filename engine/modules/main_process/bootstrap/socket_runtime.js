const { applySocketRuntimeToEnvironment } = require('../state/runtime_socket_state.js');

function attachSocketAuthMiddleware({ io, runtimeSocketState, Logger }) {
    io.use((socket, next) => {
        const providedToken = socket.handshake?.auth?.token || socket.handshake?.query?.token;
        if (!runtimeSocketState.token || providedToken !== runtimeSocketState.token) {
            const remoteAddress = socket.handshake?.address || 'unknown';
            Logger.log('Main', 'SocketIO', `Rejected socket connection from ${remoteAddress} due to invalid token.`);
            return next(new Error('Unauthorized socket connection'));
        }
        return next();
    });
}

function startSocketServer({
    io,
    server,
    setupSocketConnection,
    setIoInstance,
    vnmanager,
    Logger,
    runtimeSocketState,
    settings,
    socketHost
}) {
    io.on('connection', setupSocketConnection);
    setIoInstance(io); // Provide the Socket.IO instance to utils.js
    vnmanager.setSocketEmitter(io);

    return new Promise((resolve, reject) => {
        const onError = (error) => {
            Logger.error('Main', 'SocketIO', 'Failed to start socket server', error);
            reject(error);
        };

        server.once('error', onError);
        server.listen(0, socketHost, () => {
            server.off('error', onError);
            const address = server.address();
            const resolvedPort = address && typeof address === 'object' ? address.port : null;

            if (!resolvedPort) {
                return reject(new Error('Unable to resolve socket server port.'));
            }

            runtimeSocketState.port = resolvedPort;
            const socketUrl = applySocketRuntimeToEnvironment(runtimeSocketState, settings);

            Logger.log('Main', 'SocketIO', `Socket.io server running on ${socketUrl}`);
            resolve(runtimeSocketState);
        });
    });
}

module.exports = {
    attachSocketAuthMiddleware,
    startSocketServer
};
