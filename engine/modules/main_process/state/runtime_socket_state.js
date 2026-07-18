const crypto = require('crypto');

const DEFAULT_SOCKET_PORT = 14541;

function createRuntimeSocketState({ host, protocol = 'http', token } = {}) {
    return {
        protocol,
        host: host || '127.0.0.1',
        port: null,
        token: token || crypto.randomBytes(24).toString('hex')
    };
}

function resolveRuntimePort(runtimeSocketState, fallbackPort = DEFAULT_SOCKET_PORT) {
    return runtimeSocketState.port || fallbackPort;
}

function getSocketServerUrl(runtimeSocketState, fallbackPort = DEFAULT_SOCKET_PORT) {
    const port = resolveRuntimePort(runtimeSocketState, fallbackPort);
    return `${runtimeSocketState.protocol}://${runtimeSocketState.host}:${port}`;
}

function getRendererSocketQuery(runtimeSocketState, extra = {}, fallbackPort = DEFAULT_SOCKET_PORT) {
    const port = resolveRuntimePort(runtimeSocketState, fallbackPort);
    return {
        ...extra,
        socketProtocol: runtimeSocketState.protocol,
        socketHost: runtimeSocketState.host,
        socketPort: String(port),
        socketToken: runtimeSocketState.token
    };
}

function applySocketRuntimeToEnvironment(runtimeSocketState, settings, fallbackPort = DEFAULT_SOCKET_PORT) {
    const port = resolveRuntimePort(runtimeSocketState, fallbackPort);
    const socketUrl = getSocketServerUrl(runtimeSocketState, fallbackPort);

    process.env.FABLEKIN_SOCKET_PROTOCOL = runtimeSocketState.protocol;
    process.env.FABLEKIN_SOCKET_HOST = runtimeSocketState.host;
    process.env.FABLEKIN_SOCKET_PORT = String(port);
    process.env.FABLEKIN_SOCKET_TOKEN = runtimeSocketState.token;
    process.env.FABLEKIN_SOCKET_URL = socketUrl;

    if (settings && typeof settings === 'object') {
        settings.infrastructure = settings.infrastructure || {};
        settings.infrastructure.socket_host = runtimeSocketState.host;
        settings.infrastructure.socket_port = port;
        settings.infrastructure.socket_url = socketUrl;
        if (Object.prototype.hasOwnProperty.call(settings, 'socket_host')) delete settings.socket_host;
        if (Object.prototype.hasOwnProperty.call(settings, 'socket_port')) delete settings.socket_port;
        if (Object.prototype.hasOwnProperty.call(settings, 'socket_url')) delete settings.socket_url;
    }

    return socketUrl;
}

module.exports = {
    DEFAULT_SOCKET_PORT,
    createRuntimeSocketState,
    getSocketServerUrl,
    getRendererSocketQuery,
    applySocketRuntimeToEnvironment
};
