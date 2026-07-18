// withJob owns completion, failure, cancellation, and notification cleanup around the task.
async function runExampleJob(tools, { shouldFail = false } = {}) {
    return tools.jobs.withJob('Running example background job...', {
        id: 'example_background_job_run',
        scope: 'turn',
        rethrow: false,
        notifyOnComplete: true,
        completeMessage: 'Example background job complete.',
        errorValue: { ok: false, message: 'The requested example failure was handled.' }
    }, async job => {
        job.progress(20, 'Validating input...');
        job.throwIfCancelled();

        // Real plugins would await useful I/O or analysis at these boundaries.
        await Promise.resolve();
        job.progress(60, 'Processing example work...');
        job.throwIfCancelled();

        if (shouldFail) throw new Error('Intentional example failure.');

        await Promise.resolve();
        job.progress(100, 'Example work finished.');
        return { ok: true, message: 'The example job completed successfully.' };
    });
}

module.exports = {
    id: 'example_background_job',
    name: 'Example: Background Job',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates tracked background work with progress, cancellation, and handled failure.',

    exports: {
        runExampleJob: async (_turnContext, tools, options) => runExampleJob(tools, options)
    },

    terminalCommands: {
        '/example-job': {
            description: 'Runs a tracked example job. Add "fail" to test handled failure.',
            run: async (args, tools) => {
                const mode = String(args?.[0] || '').trim().toLowerCase();
                if (mode && mode !== 'fail') return 'Usage: /example-job [fail]';
                const result = await runExampleJob(tools, { shouldFail: mode === 'fail' });
                return result?.message || 'The example job ended without a result.';
            }
        }
    }
};
