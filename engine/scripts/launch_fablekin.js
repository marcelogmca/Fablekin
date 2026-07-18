const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 180000;
const POLL_MS = 250;

function parseArgs(argv) {
    const parsed = {
        cwd: null,
        exe: null,
        main: null,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        appArgs: []
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            parsed.cwd = argv[++index];
        } else if (arg === '--exe') {
            parsed.exe = argv[++index];
        } else if (arg === '--main') {
            parsed.main = argv[++index];
        } else if (arg === '--timeout-ms') {
            const timeoutMs = Number.parseInt(argv[++index], 10);
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                parsed.timeoutMs = timeoutMs;
            }
        } else {
            parsed.appArgs.push(arg);
        }
    }

    return parsed;
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

function createReadyFilePath() {
    const launchDir = path.join(os.tmpdir(), 'fablekin-launch');
    fs.mkdirSync(launchDir, { recursive: true });
    return path.join(launchDir, `ready-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function clearStatusLine() {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\r${' '.repeat(80)}\r`);
}

async function waitForReadyFile({ readyFile, child, timeoutMs }) {
    const startedAt = Date.now();
    let childExit = null;
    let childError = null;
    let lastSecond = -1;

    child.once('exit', (code, signal) => {
        childExit = { code, signal };
    });
    child.once('error', (error) => {
        childError = error;
    });

    return await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            const elapsedMs = Date.now() - startedAt;
            const elapsedSeconds = Math.floor(elapsedMs / 1000);

            if (process.stdout.isTTY && elapsedSeconds !== lastSecond) {
                lastSecond = elapsedSeconds;
                process.stdout.write(`\rWaiting for Fablekin to launch... ${elapsedSeconds}s`);
            }

            if (fs.existsSync(readyFile)) {
                clearInterval(timer);
                clearStatusLine();
                resolve();
                return;
            }

            if (childError) {
                clearInterval(timer);
                clearStatusLine();
                reject(new Error(`Failed to start Fablekin: ${childError.message}`));
                return;
            }

            if (childExit) {
                clearInterval(timer);
                clearStatusLine();
                reject(new Error(`Fablekin exited before the first window was ready. Code: ${childExit.code ?? 'n/a'}, signal: ${childExit.signal ?? 'n/a'}`));
                return;
            }

            if (elapsedMs >= timeoutMs) {
                clearInterval(timer);
                clearStatusLine();
                reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Fablekin's first window.`));
            }
        }, POLL_MS);
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.exe || !options.main) {
        fail('Usage: node launch_fablekin.js --exe <electron-exe> --main <main-js> [--cwd <repo-root>] [args...]');
        return;
    }

    const readyFile = createReadyFilePath();
    try {
        fs.rmSync(readyFile, { force: true });
    } catch (_) {
        // Best effort cleanup of a freshly generated path.
    }

    const env = {
        ...process.env,
        FABLEKIN_LAUNCH_READY_FILE: readyFile
    };

    const childArgs = [options.main, ...options.appArgs];
    console.log('Launching Fablekin...');
    console.log('Please wait until Fablekin is ready.');

    let child;
    try {
        child = spawn(options.exe, childArgs, {
            cwd: options.cwd || process.cwd(),
            env,
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (error) {
        fail(`Failed to start Fablekin: ${error.message}`);
        return;
    }

    try {
        await waitForReadyFile({ readyFile, child, timeoutMs: options.timeoutMs });
        console.log('Fablekin is ready.');
        try {
            fs.rmSync(readyFile, { force: true });
        } catch (_) {
            // Leaving a temp ready file behind is harmless.
        }
    } catch (error) {
        fail(error.message);
    }
}

main();
