// depth-worker.js
// Handles monocular depth estimation using Transformers.js in a separate thread.

let transformersApi = null;
const aliveBgVerboseLog = () => {};
let transformersLoadPromise = null;
let depthEstimator = null;
let depthEstimatorError = null;
let depthEstimatorPromise = null;
const estimatorProcessorCallableCache = new WeakMap();
const estimatorProcessorInitPromises = new WeakMap();
let pluginBaseUrl = '';
let mlAvailable = true;
let mlUnavailableReason = null;
let loggedHeuristicFallback = false;

function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
}

function getModelPath() {
    return 'depth-anything-v2-small';
}

function getLocalWasmBasePath() {
    return `${pluginBaseUrl}/vendor/wasm/`;
}

function getLocalWasmRuntimePaths() {
    const wasmBase = getLocalWasmBasePath();
    return {
        // Match ORT's default non-Safari runtime selection while keeping everything local/offline.
        mjs: `${wasmBase}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${wasmBase}ort-wasm-simd-threaded.asyncify.wasm`,
    };
}

function isThenable(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

async function resolveMaybeThenable(value) {
    if (!isThenable(value)) return value;
    try {
        return await value;
    } catch (error) {
        console.warn('[Alive BG Worker] Failed to resolve thenable processor candidate:', error);
        return null;
    }
}

function makeCallableWithContext(fn, thisArg) {
    if (typeof fn !== 'function') return null;
    return (...args) => Reflect.apply(fn, thisArg, args);
}

function getPrototypeMethodNames(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return [];

    const methodNames = new Set();
    let current = Object.getPrototypeOf(value);
    let depth = 0;
    while (current && current !== Object.prototype && depth < 4) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (name === 'constructor') continue;
            const descriptor = Object.getOwnPropertyDescriptor(current, name);
            if (typeof descriptor?.value === 'function') {
                methodNames.add(name);
            }
        }
        current = Object.getPrototypeOf(current);
        depth += 1;
    }
    return Array.from(methodNames).slice(0, 30);
}

function summarizeCandidate(value) {
    if (value == null) return { type: String(value) };

    const summary = {
        type: typeof value,
        isThenable: isThenable(value),
        constructor: value?.constructor?.name || null,
        ownKeys: (typeof value === 'object' || typeof value === 'function')
            ? Object.keys(value).slice(0, 30)
            : [],
    };

    if (typeof value === 'object' || typeof value === 'function') {
        summary.protoMethods = getPrototypeMethodNames(value);
    }

    return summary;
}

async function patchEstimatorCompatibility(estimator) {
    if (!estimator) return estimator;

    if (typeof estimator.processor === 'function') return estimator;

    const processorCallable = await resolveProcessorCallable(estimator);
    if (processorCallable && installProcessorCallable(estimator, processorCallable)) {
        console.warn('[Alive BG Worker] Applied processor callable shim on estimator instance.');
    }

    return estimator;
}

async function getBoundCallableFromCandidate(candidate, seen = new WeakSet()) {
    const resolved = await resolveMaybeThenable(candidate);
    if (!resolved) return null;

    if (typeof resolved === 'function') {
        return makeCallableWithContext(resolved, resolved);
    }
    if (typeof resolved !== 'object') return null;
    if (seen.has(resolved)) return null;
    seen.add(resolved);

    const methodNames = ['_call', 'call', 'process', 'preprocess'];
    for (const methodName of methodNames) {
        if (typeof resolved[methodName] === 'function') {
            return makeCallableWithContext(resolved[methodName], resolved);
        }
    }

    // Scan prototype methods when methods are non-enumerable/inherited.
    for (const methodName of getPrototypeMethodNames(resolved)) {
        if (methodNames.includes(methodName) && typeof resolved[methodName] === 'function') {
            return makeCallableWithContext(resolved[methodName], resolved);
        }
    }

    // Some wrappers store the actual callable one level deeper.
    if (resolved.image_processor) {
        const nested = await getBoundCallableFromCandidate(resolved.image_processor, seen);
        if (nested) return nested;
    }
    if (resolved.feature_extractor) {
        const nested = await getBoundCallableFromCandidate(resolved.feature_extractor, seen);
        if (nested) return nested;
    }
    if (resolved.processor && resolved.processor !== resolved) {
        const nested = await getBoundCallableFromCandidate(resolved.processor, seen);
        if (nested) return nested;
    }
    if (resolved.components) {
        const nested = await getBoundCallableFromCandidate(resolved.components, seen);
        if (nested) return nested;
    }

    return null;
}

async function resolveProcessorCallable(estimator) {
    const cachedCallable = estimatorProcessorCallableCache.get(estimator);
    if (typeof cachedCallable === 'function') {
        return cachedCallable;
    }

    const candidates = [
        estimator?.processor,
        estimator?.image_processor,
        estimator?.imageProcessor,
        estimator?.feature_extractor,
        estimator?.featureExtractor,
        estimator?.processor?.processor,
        estimator?.image_processor?.processor,
        estimator?.feature_extractor?.processor,
        estimator?.components?.processor,
        estimator?.components?.image_processor,
        estimator?.components?.feature_extractor,
    ];

    for (const candidate of candidates) {
        const callable = await getBoundCallableFromCandidate(candidate);
        if (callable) {
            estimatorProcessorCallableCache.set(estimator, callable);
            return callable;
        }
    }

    return null;
}

function installProcessorCallable(estimator, processorCallable) {
    if (!estimator || typeof processorCallable !== 'function') return false;

    try {
        estimator.processor = processorCallable;
        if (typeof estimator.processor === 'function') {
            estimatorProcessorCallableCache.set(estimator, processorCallable);
            return true;
        }
    } catch (error) {
        console.warn('[Alive BG Worker] Direct processor shim assignment failed:', error);
    }

    try {
        Object.defineProperty(estimator, 'processor', {
            value: processorCallable,
            writable: true,
            configurable: true,
        });
        const success = typeof estimator.processor === 'function';
        if (success) {
            estimatorProcessorCallableCache.set(estimator, processorCallable);
        }
        return success;
    } catch (error) {
        console.warn('[Alive BG Worker] defineProperty processor shim failed:', error);
    }

    return false;
}

async function ensureEstimatorHasProcessor(estimator, modelPath = getModelPath()) {
    if (!estimator) return null;

    const existingCallable = await resolveProcessorCallable(estimator);
    if (existingCallable) {
        installProcessorCallable(estimator, existingCallable);
        return existingCallable;
    }

    const existingInit = estimatorProcessorInitPromises.get(estimator);
    if (existingInit) return existingInit;

    const initPromise = (async () => {
        const { AutoProcessor, AutoImageProcessor, AutoFeatureExtractor } = await loadTransformersApi();
        const loaders = [];
        const fromPretrainedOptions = { local_files_only: true };

        const addLoader = (label, loaderType) => {
            if (loaderType && typeof loaderType.from_pretrained === 'function') {
                loaders.push({
                    label,
                    load: () => loaderType.from_pretrained(modelPath, fromPretrainedOptions),
                });
            }
        };

        addLoader('AutoProcessor', AutoProcessor);
        addLoader('AutoImageProcessor', AutoImageProcessor);
        addLoader('AutoFeatureExtractor', AutoFeatureExtractor);

        const loaderErrors = [];
        for (const loader of loaders) {
            try {
                const processorInstance = await loader.load();
                const processorCallable = await getBoundCallableFromCandidate(processorInstance);
                if (processorCallable) {
                    estimatorProcessorCallableCache.set(estimator, processorCallable);
                    const installed = installProcessorCallable(estimator, processorCallable);
                    aliveBgVerboseLog(
                        `[Alive BG Worker] Loaded processor via ${loader.label}${installed ? ' and attached it to estimator.' : '.'}`
                    );
                    return processorCallable;
                }

                loaderErrors.push(`${loader.label}: no callable interface`);
            } catch (error) {
                loaderErrors.push(`${loader.label}: ${String(error?.message || error)}`);
            }
        }

        if (loaderErrors.length > 0) {
            console.warn('[Alive BG Worker] Unable to build processor from local model files:', loaderErrors.join(' | '));
        }
        return null;
    })().finally(() => {
        estimatorProcessorInitPromises.delete(estimator);
    });

    estimatorProcessorInitPromises.set(estimator, initPromise);
    return initPromise;
}

async function runEstimatorWithCompatibleProcessor(estimator, imageUrl) {
    if (typeof estimator !== 'function' || typeof estimator._call !== 'function') {
        throw new Error('Depth estimator is not a callable pipeline instance.');
    }

    await ensureEstimatorHasProcessor(estimator);

    if (typeof estimator.processor !== 'function') {
        const processorCallable = await resolveProcessorCallable(estimator);
        if (!processorCallable || !installProcessorCallable(estimator, processorCallable)) {
            console.warn('[Alive BG Worker] Estimator processor diagnostics:', {
                estimator: summarizeCandidate(estimator),
                processor: summarizeCandidate(estimator.processor),
                imageProcessor: summarizeCandidate(estimator.image_processor),
                featureExtractor: summarizeCandidate(estimator.feature_extractor),
                components: summarizeCandidate(estimator.components),
            });
        }
    }

    try {
        return await estimator(imageUrl);
    } catch (error) {
        const message = String(error?.message || error || '');
        const isProcessorCallError =
            message.includes('processor is not a function') ||
            message.includes('this.processor is not a function') ||
            message.includes('this.processor');

        if (!isProcessorCallError) {
            throw error;
        }

        console.warn('[Alive BG Worker] Pipeline processor call failed, trying direct inference shim.');
        return runDepthInferenceDirect(estimator, imageUrl);
    }
}

function getBatchTensorItem(batchTensor, index) {
    if (!batchTensor) return null;
    if (Array.isArray(batchTensor)) return batchTensor[index] ?? null;
    if (batchTensor[index]) return batchTensor[index];
    return batchTensor;
}

async function runDepthInferenceDirect(estimator, imageUrl) {
    const imageLoader = transformersApi?.load_image;
    const interpolate4d = transformersApi?.interpolate_4d;
    const rawImageClass = transformersApi?.RawImage;

    if (typeof imageLoader !== 'function' || typeof interpolate4d !== 'function' || !rawImageClass?.fromTensor) {
        throw new Error('Transformers direct inference helpers are unavailable in this build.');
    }

    if (!estimator?.model || typeof estimator.model !== 'function') {
        throw new Error('Depth estimator model callable is unavailable.');
    }

    await ensureEstimatorHasProcessor(estimator);

    const processorCallable = await resolveProcessorCallable(estimator);
    if (!processorCallable) {
        throw new Error('No callable processor available for direct depth inference.');
    }

    aliveBgVerboseLog('[Alive BG Worker] Running direct depth inference shim.');
    const loaded = await imageLoader(imageUrl);
    const images = Array.isArray(loaded) ? loaded : [loaded];
    const modelInputs = await processorCallable(images);
    const modelOutputs = await estimator.model(modelInputs);
    const predictedDepthBatch = modelOutputs?.predicted_depth;
    const predictedDepth = getBatchTensorItem(predictedDepthBatch, 0);

    if (!predictedDepth || !Array.isArray(predictedDepth.dims) || predictedDepth.dims.length < 2) {
        throw new Error('Depth model output did not contain a valid predicted_depth tensor.');
    }

    const [depthHeight, depthWidth] = predictedDepth.dims.slice(-2);
    const [targetWidth, targetHeight] = images[0].size;
    const resizedDepth = (await interpolate4d(predictedDepth.view(1, 1, depthHeight, depthWidth), {
        size: [targetHeight, targetWidth],
        mode: 'bilinear',
    })).view(targetHeight, targetWidth);
    const minValue = resizedDepth.min().item();
    const maxValue = resizedDepth.max().item();
    const range = maxValue - minValue;
    const normalizedDepth = (
        range > Number.EPSILON
            ? resizedDepth.sub(minValue).div_(range)
            : resizedDepth.sub(minValue)
    )
        .mul_(255)
        .to('uint8')
        .unsqueeze(0);
    const depthImage = rawImageClass.fromTensor(normalizedDepth);
    aliveBgVerboseLog('[Alive BG Worker] Direct depth inference shim completed successfully.');

    return {
        predicted_depth: resizedDepth,
        depth: depthImage,
    };
}

function getTransformersModuleCandidates() {
    const candidates = [
        new URL('./vendor/js/transformers.web.min.js', self.location.href).href,
    ];

    if (pluginBaseUrl) {
        candidates.push(`${pluginBaseUrl}/vendor/js/transformers.web.min.js`);
    }

    return [...new Set(candidates)];
}

async function loadTransformersApi() {
    if (transformersApi) return transformersApi;

    if (!transformersLoadPromise) {
        const moduleCandidates = getTransformersModuleCandidates();

        transformersLoadPromise = (async () => {
            const candidateErrors = [];

            for (const moduleUrl of moduleCandidates) {
                try {
                    const mod = await import(moduleUrl);
                    if (typeof mod.pipeline !== 'function' || !mod.env) {
                        throw new Error('Local Transformers module is missing required exports.');
                    }

                    transformersApi = {
                        pipeline: mod.pipeline,
                        env: mod.env,
                        AutoProcessor: mod.AutoProcessor ?? null,
                        AutoImageProcessor: mod.AutoImageProcessor ?? null,
                        AutoFeatureExtractor: mod.AutoFeatureExtractor ?? null,
                        load_image: mod.load_image ?? mod.loadImage ?? null,
                        interpolate_4d: mod.interpolate_4d ?? mod.interpolate4d ?? mod.interpolate ?? null,
                        RawImage: mod.RawImage ?? null,
                    };
                    aliveBgVerboseLog('[Alive BG Worker] Transformers module loaded from:', moduleUrl);
                    aliveBgVerboseLog('[Alive BG Worker] Direct inference helpers:', {
                        hasAutoProcessor: !!transformersApi.AutoProcessor,
                        hasAutoImageProcessor: !!transformersApi.AutoImageProcessor,
                        hasAutoFeatureExtractor: !!transformersApi.AutoFeatureExtractor,
                        hasLoadImage: typeof transformersApi.load_image === 'function',
                        hasInterpolate4D: typeof transformersApi.interpolate_4d === 'function',
                        hasRawImageFromTensor: typeof transformersApi.RawImage?.fromTensor === 'function',
                    });
                    return transformersApi;
                } catch (error) {
                    candidateErrors.push(`${moduleUrl} :: ${String(error?.message || error)}`);
                }
            }

            throw new Error(`Unable to import local Transformers module. ${candidateErrors.join(' | ')}`);
        })().catch((error) => {
            transformersLoadPromise = null;
            throw error;
        });
    }

    return transformersLoadPromise;
}

async function init(baseUrl) {
    pluginBaseUrl = normalizeBaseUrl(baseUrl);

    try {
        const { env } = await loadTransformersApi();

        // Configure environment for strict offline usage
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.useBrowserCache = false;
        env.useWasmCache = false;
        env.localModelPath = `${pluginBaseUrl}/vendor/models/`;

        const onnxEnv = env.backends?.onnx;
        if (!onnxEnv?.wasm) {
            throw new Error('ONNX wasm backend is not available in this worker runtime.');
        }

        // Force local wasm assets so runtime never resolves CDN defaults.
        onnxEnv.wasm.proxy = false;
        onnxEnv.wasm.numThreads = 1;
        onnxEnv.wasm.simd = true;
        onnxEnv.wasm.wasmPaths = getLocalWasmRuntimePaths();

        if (onnxEnv.webgpu) {
            onnxEnv.webgpu.powerPreference = 'high-performance';
        }

        mlAvailable = true;
        mlUnavailableReason = null;
        aliveBgVerboseLog('[Alive BG Worker] Offline ML mode initialized. WASM runtime paths:', onnxEnv.wasm.wasmPaths);
    } catch (error) {
        mlAvailable = false;
        mlUnavailableReason = error;
        console.warn('[Alive BG Worker] ML runtime unavailable, heuristic-only mode enabled:', error);
    }
}

async function getEstimator() {
    if (!mlAvailable) {
        throw mlUnavailableReason || new Error('ML runtime is unavailable.');
    }

    if (depthEstimator) return depthEstimator;
    if (depthEstimatorError) throw depthEstimatorError;
    if (depthEstimatorPromise) return depthEstimatorPromise;

    depthEstimatorPromise = (async () => {
        const { pipeline } = await loadTransformersApi();
        const modelPath = getModelPath();
        const start = performance.now();
        const deviceAttempts = [];
        const modelVariants = [
            // With q8, Transformers appends "_quantized", so "model" resolves to model_quantized.onnx
            { model_file_name: 'model', dtype: 'q8', label: 'model+q8' },
            // Fallback in case a runtime/version expects explicit quantized filename without dtype suffixing
            { model_file_name: 'model_quantized', dtype: 'fp32', label: 'model_quantized+fp32' },
        ];

        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            deviceAttempts.push('webgpu');
        }
        deviceAttempts.push('wasm');

        const attemptErrors = [];
        for (const device of deviceAttempts) {
            for (const variant of modelVariants) {
                try {
                    aliveBgVerboseLog(
                        `[Alive BG Worker] Loading model from: ${modelPath} (device=${device}, variant=${variant.label})`
                    );
                    depthEstimator = await pipeline('depth-estimation', modelPath, {
                        device,
                        local_files_only: true,
                        model_file_name: variant.model_file_name,
                        dtype: variant.dtype,
                    });
                    await ensureEstimatorHasProcessor(depthEstimator, modelPath);
                    depthEstimator = await patchEstimatorCompatibility(depthEstimator);

                    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
                    aliveBgVerboseLog(
                        `[Alive BG Worker] Model loaded successfully in ${elapsed}s using ${device} (${variant.label})`
                    );
                    return depthEstimator;
                } catch (error) {
                    attemptErrors.push(`${device}/${variant.label}: ${String(error?.message || error)}`);
                }
            }
        }

        depthEstimatorError = new Error(`No supported inference device is available. ${attemptErrors.join(' | ')}`);
        throw depthEstimatorError;
    })()
        .finally(() => {
            depthEstimatorPromise = null;
        });

    return depthEstimatorPromise;
}

async function loadImageBitmapFromUrl(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch background image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    return createImageBitmap(blob);
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function depthImageToBitmap(depthImage) {
    const { width, height, data } = depthImage;
    const pixelCount = width * height;
    const rgba = new Uint8ClampedArray(pixelCount * 4);

    if (data.length === pixelCount * 4) {
        rgba.set(data);
    } else if (data.length === pixelCount * 3) {
        for (let i = 0; i < pixelCount; i++) {
            const src = i * 3;
            const dst = i * 4;
            rgba[dst] = data[src];
            rgba[dst + 1] = data[src + 1];
            rgba[dst + 2] = data[src + 2];
            rgba[dst + 3] = 255;
        }
    } else if (data.length === pixelCount) {
        for (let i = 0; i < pixelCount; i++) {
            const value = data[i];
            const dst = i * 4;
            rgba[dst] = value;
            rgba[dst + 1] = value;
            rgba[dst + 2] = value;
            rgba[dst + 3] = 255;
        }
    } else {
        throw new Error(`Unexpected depth image buffer length: ${data.length}`);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas.transferToImageBitmap();
}

async function generateHeuristicDepthBitmap(imageUrl) {
    aliveBgVerboseLog('[Alive BG Worker] Using heuristic depth generation.');

    const bitmap = await loadImageBitmapFromUrl(imageUrl);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const source = ctx.getImageData(0, 0, width, height);
    const luma = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        const offset = i * 4;
        const r = source.data[offset] / 255;
        const g = source.data[offset + 1] / 255;
        const b = source.data[offset + 2] / 255;
        luma[i] = (r * 0.299) + (g * 0.587) + (b * 0.114);
    }

    const sampleLuma = (x, y) => {
        const clampedX = Math.max(0, Math.min(width - 1, x));
        const clampedY = Math.max(0, Math.min(height - 1, y));
        return luma[(clampedY * width) + clampedX];
    };

    const depthPixels = new Uint8ClampedArray(width * height * 4);
    const widthMax = Math.max(1, width - 1);
    const heightMax = Math.max(1, height - 1);

    for (let y = 0; y < height; y++) {
        const perspective = y / heightMax;

        for (let x = 0; x < width; x++) {
            const idx = (y * width) + x;
            const lum = luma[idx];
            const edge = (
                Math.abs(lum - sampleLuma(x - 1, y)) +
                Math.abs(lum - sampleLuma(x + 1, y)) +
                Math.abs(lum - sampleLuma(x, y - 1)) +
                Math.abs(lum - sampleLuma(x, y + 1))
            ) * 0.25;
            const centerBias = 1 - Math.min(1, Math.abs((x / widthMax) - 0.5) * 2);
            const depth = clamp01((perspective * 0.7) + ((1 - lum) * 0.1) + (edge * (0.15 + (centerBias * 0.2))));
            const value = Math.round(depth * 255);
            const offset = idx * 4;
            depthPixels[offset] = value;
            depthPixels[offset + 1] = value;
            depthPixels[offset + 2] = value;
            depthPixels[offset + 3] = 255;
        }
    }

    ctx.putImageData(new ImageData(depthPixels, width, height), 0, 0);
    return canvas.transferToImageBitmap();
}

async function renderDepthBitmap(imageUrl) {
    try {
        const estimator = await getEstimator();

        aliveBgVerboseLog('[Alive BG Worker] Starting inference...');
        const start = performance.now();
        const result = await runEstimatorWithCompatibleProcessor(estimator, imageUrl);
        const elapsed = ((performance.now() - start) / 1000).toFixed(2);
        aliveBgVerboseLog(`[Alive BG Worker] Inference complete in ${elapsed}s`);

        return depthImageToBitmap(result.depth);
    } catch (error) {
        if (!loggedHeuristicFallback) {
            console.warn('[Alive BG Worker] ML depth generation failed, using heuristic fallback:', error);
            loggedHeuristicFallback = true;
        }
        return generateHeuristicDepthBitmap(imageUrl);
    }
}

self.onmessage = async (e) => {
    const { type, id, imageUrl, pluginUrl } = e.data;

    if (type === 'init') {
        try {
            await init(pluginUrl);
            self.postMessage({
                type: 'ready',
                mlAvailable,
                reason: mlAvailable ? null : String(mlUnavailableReason?.message || mlUnavailableReason || 'unknown'),
            });
        } catch (error) {
            mlAvailable = false;
            mlUnavailableReason = error;
            self.postMessage({
                type: 'ready',
                mlAvailable: false,
                reason: String(error?.message || error || 'unknown'),
            });
        }
        return;
    }

    if (type === 'process') {
        try {
            aliveBgVerboseLog('[Alive BG Worker] Received process request for:', imageUrl);
            const bitmap = await renderDepthBitmap(imageUrl);
            self.postMessage({ type: 'result', id, bitmap }, [bitmap]);
        } catch (error) {
            console.error('[Alive BG Worker] Process error:', error);
            self.postMessage({ type: 'error', id, error: error.message });
        }
    }
};
