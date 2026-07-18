function createEmitReceiveAttacher({ io, Logger, defaultTimeout = 5000 }) {
    /**
     * Enhances a Socket.IO socket with an `emitReceive` function for request-response patterns.
     * @param {Socket} socket - The Socket.IO socket instance.
     */
    return function addEmitReceiveToSocket(socket) {
        socket.emitReceive = function (eventName, data, timeout = defaultTimeout) {
            return new Promise((resolve) => {
                let responded = false;

                const responseHandler = (response) => {
                    if (!responded) {
                        responded = true;
                        const logResponse = (response && typeof response === 'object') ? '{ ... }' : response;
                        Logger.log('Main', 'SocketIO', `Received response for ${eventName}`, logResponse);
                        cleanup();
                        resolve(response);
                    }
                };

                io.sockets.sockets.forEach(existingSocket => {
                    Logger.log('Main', 'SocketIO', `Adding response listener for ${eventName}-response on socket ${existingSocket.id}`);
                    existingSocket.once(`${eventName}-response`, responseHandler);
                });

                const connectionHandler = (newSocket) => {
                    Logger.log('Main', 'SocketIO', `New socket connected (${newSocket.id}), adding response listener for ${eventName}-response`);
                    newSocket.once(`${eventName}-response`, responseHandler);
                };
                io.on('connection', connectionHandler);

                const cleanup = () => {
                    io.sockets.sockets.forEach(existingSocket => {
                        existingSocket.off(`${eventName}-response`, responseHandler);
                    });
                    io.off('connection', connectionHandler);
                    Logger.log('Main', 'SocketIO', `Cleaned up listeners for ${eventName}-response`);
                };

                const logData = (data && typeof data === 'object') ? '{ ... }' : data;
                Logger.log('Main', 'SocketIO', `Emitting ${eventName} to all clients`, logData);
                io.emit(eventName, data);

                setTimeout(() => {
                    if (!responded) {
                        Logger.log('Main', 'SocketIO', `Timeout waiting for response to ${eventName}`);
                        cleanup();
                        resolve(null);
                    }
                }, timeout);
            });
        };
    };
}

function createEmitResponseEmitter({ io, Logger }) {
    /**
     * Emits a response event to all connected Socket.IO clients.
     * @param {string} eventName - The name of the event to emit.
     * @param {any} data - The data to send with the event.
     */
    return function emitResponse(eventName, data) {
        const logData = (data && typeof data === 'object') ? '{ ... }' : data;
        Logger.log('Main', 'SocketIO', `Emitting response: ${eventName}`, logData);
        io.emit(eventName, data);
    };
}

module.exports = {
    createEmitReceiveAttacher,
    createEmitResponseEmitter
};
