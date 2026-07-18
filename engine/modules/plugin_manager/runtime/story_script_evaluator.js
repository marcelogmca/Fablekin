const vm = require('vm');

const DEFAULT_EVALUATION_TIMEOUT_MS = 1000;
const NOOP_LOGGER = Object.freeze({
    log() {},
    warn() {},
    error() {}
});

function makeSafeLog(logger, level) {
    const log = (...args) => {
        const safeArgs = args.map(value => {
            const type = typeof value;
            return ['string', 'number', 'boolean', 'bigint', 'undefined'].includes(type)
                ? value
                : `[${type}]`;
        });
        logger[level]('StoryScript', ...safeArgs);
    };
    Object.setPrototypeOf(log, null);
    return Object.freeze(log);
}

function evaluateStoryScript(jsCode, options = {}) {
    if (typeof jsCode !== 'string') {
        throw new TypeError('Story Script source must be a string.');
    }

    const logger = options.logger || NOOP_LOGGER;
    const timeout = options.timeoutMs || DEFAULT_EVALUATION_TIMEOUT_MS;
    const filename = options.filename || 'story-script.js';

    const safeConsole = Object.create(null);
    safeConsole.log = makeSafeLog(logger, 'log');
    safeConsole.warn = makeSafeLog(logger, 'warn');
    safeConsole.error = makeSafeLog(logger, 'error');
    Object.freeze(safeConsole);

    const context = { console: safeConsole };
    vm.createContext(context, {
        codeGeneration: { strings: false, wasm: false }
    });
    vm.runInContext(
        'globalThis.module = { exports: {} }; globalThis.exports = globalThis.module.exports;',
        context,
        { timeout }
    );

    const script = new vm.Script(jsCode, { filename });
    script.runInContext(context, { timeout, breakOnSigint: true });
    return context.module.exports;
}

module.exports = {
    DEFAULT_EVALUATION_TIMEOUT_MS,
    evaluateStoryScript
};
