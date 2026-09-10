// alive-bg-depth.js
// Manages depth worker lifecycle, in-memory cache, and persistent depth-map cache.

(function(window) {
    const aliveBgVerboseLog = () => {};
    const DEPTH_CACHE_DB_NAME = 'vn_alive_bg_depth_cache';
    const DEPTH_CACHE_STORE_NAME = 'depth_maps';
    const DEPTH_CACHE_DB_VERSION = 1;
    const DEPTH_CACHE_SCHEMA_VERSION = 'depth-anything-v2-small@q8-v1';

    const depthCache = new Map(); // src -> PIXI.Texture
    const depthBlobCache = new Map(); // src -> Blob (PNG)
    const inFlightBySrc = new Map(); // src -> Promise<PIXI.Texture>
    let lastDepthSrc = null;
    let activeBackgroundSrc = null;
    let activeBackgroundIsVideo = false;

    let worker = null;
    let pendingRequests = new Map();
    let requestIdCounter = 0;
    let depthDbPromise = null;

    function getSettings() {
        return window.ALIVE_BG_SETTINGS || {};
    }

    function isPersistentDepthCacheEnabled() {
        return getSettings().enable_persistent_depth_cache !== false;
    }

    function currentProjectName() {
        const runtimeState = window.ALIVE_BG_STATE || window.state;
        return runtimeState?.currentVN?.projectName || runtimeState?.projectName || window.currentProjectName || 'default_project';
    }

    function isVideoSource(src) {
        return /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(String(src || '').trim());
    }

    function waitForVideoEvent(video, events, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                clearTimeout(timer);
                for (const event of events) {
                    video.removeEventListener(event, onReady);
                }
                video.removeEventListener('error', onError);
            };
            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const fail = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };
            const onReady = () => finish(true);
            const onError = () => fail(new Error('Video frame source failed to load.'));
            const timer = setTimeout(() => fail(new Error('Timed out waiting for video frame source.')), timeoutMs);

            for (const event of events) {
                video.addEventListener(event, onReady, { once: true });
            }
            video.addEventListener('error', onError, { once: true });
        });
    }

    async function captureVideoFrameAsDataUrl(src, videoUrl) {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = videoUrl;

        try {
            video.load();
            if (video.readyState < 1) {
                await waitForVideoEvent(video, ['loadedmetadata', 'loadeddata']);
            }
            if (Number.isFinite(video.duration) && video.duration > 0.2) {
                const targetTime = Math.min(0.1, Math.max(0, video.duration - 0.05));
                if (Math.abs(video.currentTime - targetTime) > 0.01) {
                    const seekPromise = waitForVideoEvent(video, ['seeked', 'loadeddata']);
                    video.currentTime = targetTime;
                    await seekPromise.catch(() => {});
                }
            }
            if (video.readyState < 2) {
                await waitForVideoEvent(video, ['loadeddata', 'canplay']);
            }

            const width = video.videoWidth || 0;
            const height = video.videoHeight || 0;
            if (!width || !height) {
                throw new Error(`Video frame has invalid dimensions for "${src}".`);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Unable to create video frame canvas context.');
            ctx.drawImage(video, 0, 0, width, height);
            return canvas.toDataURL('image/png');
        } finally {
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {}
        }
    }

    function makeDepthCacheKey(src) {
        return `${DEPTH_CACHE_SCHEMA_VERSION}::${currentProjectName()}::${String(src || '')}`;
    }

    function sourceVariants(src) {
        if (!src) return [];

        let s = String(src).trim();
        if (!s) return [];

        try {
            if (/^https?:\/\//i.test(s)) {
                const url = new URL(s);
                s = `${url.pathname || ''}${url.search || ''}`;
            }
        } catch {}

        s = s.replace(/\\/g, '/');

        const variants = new Set();
        const add = (v) => {
            if (!v) return;
            const clean = String(v).trim();
            if (clean) variants.add(clean);
        };

        add(s);
        if (s.startsWith('/')) add(s.slice(1));
        else add(`/${s}`);

        const assetsIndex = s.toLowerCase().lastIndexOf('/assets/');
        const startsAssets = s.toLowerCase().startsWith('assets/');
        if (assetsIndex >= 0) {
            const rel = s.slice(assetsIndex + '/assets/'.length).replace(/^\/+/, '');
            add(rel);
            add(`/${rel}`);
            add(`assets/${rel}`);
            add(`/assets/${rel}`);
        } else if (startsAssets) {
            const rel = s.slice('assets/'.length).replace(/^\/+/, '');
            add(rel);
            add(`/${rel}`);
            add(`assets/${rel}`);
            add(`/assets/${rel}`);
        } else {
            const rel = s.replace(/^\/+/, '');
            add(`assets/${rel}`);
            add(`/assets/${rel}`);
        }

        return [...variants];
    }

    function getDepthTextureByVariants(src) {
        const variants = sourceVariants(src);
        for (const candidate of variants) {
            const texture = depthCache.get(candidate);
            if (texture) return { texture, src: candidate };
        }
        return { texture: null, src: null };
    }

    function withTransactionDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
        });
    }

    async function openDepthCacheDb() {
        if (!window.indexedDB) return null;

        if (!depthDbPromise) {
            depthDbPromise = new Promise((resolve, reject) => {
                const request = window.indexedDB.open(DEPTH_CACHE_DB_NAME, DEPTH_CACHE_DB_VERSION);

                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(DEPTH_CACHE_STORE_NAME)) {
                        db.createObjectStore(DEPTH_CACHE_STORE_NAME, { keyPath: 'key' });
                    }
                };

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB for depth cache.'));
            }).catch((error) => {
                console.warn('[Alive BG] Persistent depth cache unavailable:', error);
                depthDbPromise = null;
                return null;
            });
        }

        return depthDbPromise;
    }

    async function readPersistentDepthEntry(cacheKey) {
        const db = await openDepthCacheDb();
        if (!db) return null;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(DEPTH_CACHE_STORE_NAME, 'readonly');
                const store = tx.objectStore(DEPTH_CACHE_STORE_NAME);
                const request = store.get(cacheKey);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch (error) {
                console.warn('[Alive BG] Failed reading persistent depth cache:', error);
                resolve(null);
            }
        });
    }

    async function writePersistentDepthEntry(cacheKey, blob, width, height) {
        const db = await openDepthCacheDb();
        if (!db) return false;

        try {
            const tx = db.transaction(DEPTH_CACHE_STORE_NAME, 'readwrite');
            const store = tx.objectStore(DEPTH_CACHE_STORE_NAME);
            store.put({
                key: cacheKey,
                blob,
                width,
                height,
                updatedAt: Date.now(),
            });
            await withTransactionDone(tx);
            return true;
        } catch (error) {
            console.warn('[Alive BG] Failed writing persistent depth cache:', error);
            return false;
        }
    }

    async function deletePersistentDepthEntry(cacheKey) {
        const db = await openDepthCacheDb();
        if (!db) return false;

        try {
            const tx = db.transaction(DEPTH_CACHE_STORE_NAME, 'readwrite');
            tx.objectStore(DEPTH_CACHE_STORE_NAME).delete(cacheKey);
            await withTransactionDone(tx);
            return true;
        } catch (error) {
            console.warn('[Alive BG] Failed deleting persistent depth cache entry:', error);
            return false;
        }
    }

    async function clearPersistentDepthCache() {
        const db = await openDepthCacheDb();
        if (!db) return false;

        try {
            const tx = db.transaction(DEPTH_CACHE_STORE_NAME, 'readwrite');
            tx.objectStore(DEPTH_CACHE_STORE_NAME).clear();
            await withTransactionDone(tx);
            return true;
        } catch (error) {
            console.warn('[Alive BG] Failed clearing persistent depth cache:', error);
            return false;
        }
    }

    async function imageBitmapToPngBlob(bitmap) {
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            return canvas.convertToBlob({ type: 'image/png' });
        }

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed converting depth bitmap to PNG blob.'));
            }, 'image/png');
        });
    }

    async function textureFromBlob(blob) {
        const bitmap = await createImageBitmap(blob);
        return PIXI.Texture.from(bitmap);
    }

    function toPreviewUrl(blob) {
        return URL.createObjectURL(blob);
    }

    function tryOpenPreview(url) {
        const popup = window.open(url, '_blank', 'noopener');
        if (!popup) {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener';
            anchor.click();
        }
    }

    async function cacheDepthBlobForSource(src, cacheKey, bitmap) {
        try {
            const blob = await imageBitmapToPngBlob(bitmap);
            depthBlobCache.set(src, blob);
            if (isPersistentDepthCacheEnabled()) {
                await writePersistentDepthEntry(cacheKey, blob, bitmap.width, bitmap.height);
            }
        } catch (error) {
            console.warn('[Alive BG] Failed to cache depth blob:', error);
        }
    }

    async function hydrateDepthFromPersistentCache(src, cacheKey) {
        const entry = await readPersistentDepthEntry(cacheKey);
        if (!entry?.blob) return null;

        const texture = await textureFromBlob(entry.blob);
        depthCache.set(src, texture);
        depthBlobCache.set(src, entry.blob);
        lastDepthSrc = src;
        window.dispatchEvent(new CustomEvent('alive-bg:depth-ready', {
            detail: { src, texture, fromCache: true },
        }));
        aliveBgVerboseLog('[Alive BG] Loaded depth map from persistent cache for:', src);
        return texture;
    }

    function initWorker() {
        if (worker) return;

        aliveBgVerboseLog('[Alive BG] Initializing worker from:', window.ALIVE_BG_WORKER_URL);
        worker = new Worker(window.ALIVE_BG_WORKER_URL);

        worker.onerror = (e) => {
            console.error('[Alive BG] Worker crashed:', e.message, e);
            for (const [, req] of pendingRequests) {
                if (req.reject) req.reject(new Error('Worker crashed: ' + (e.message || 'unknown error')));
            }
            pendingRequests.clear();
            worker = null;
        };

        worker.onmessage = (e) => {
            const { type, id, bitmap, error, mlAvailable, reason } = e.data;
            if (type === 'ready') {
                if (mlAvailable === false) {
                    console.warn('[Alive BG] Depth worker ready in heuristic-only mode:', reason || 'ML runtime unavailable');
                } else {
                    aliveBgVerboseLog('[Alive BG] Depth worker is ready.');
                }
                return;
            }

            if (type === 'result') {
                const request = pendingRequests.get(id);
                if (!request) return;

                const { resolve, src, cacheKey } = request;
                pendingRequests.delete(id);

                const texture = PIXI.Texture.from(bitmap);
                depthCache.set(src, texture);
                lastDepthSrc = src;
                window.dispatchEvent(new CustomEvent('alive-bg:depth-ready', {
                    detail: { src, texture, fromCache: false },
                }));

                cacheDepthBlobForSource(src, cacheKey, bitmap).catch((cacheError) => {
                    console.warn('[Alive BG] Failed post-inference depth cache write:', cacheError);
                });

                resolve(texture);
                return;
            }

            if (type === 'error') {
                if (id !== undefined && pendingRequests.has(id)) {
                    const { reject } = pendingRequests.get(id);
                    pendingRequests.delete(id);
                    if (reject) reject(new Error(error));
                } else {
                    console.error('[Alive BG Worker Error]', error);
                    for (const [, req] of pendingRequests) {
                        if (req.reject) req.reject(new Error(error));
                    }
                    pendingRequests.clear();
                }
            }
        };

        worker.postMessage({ type: 'init', pluginUrl: window.ALIVE_BG_PLUGIN_ASSET_URL || window.ALIVE_BG_PLUGIN_URL });
    }

    function requestDepthFromWorker(src, imageUrl, cacheKey) {
        return new Promise((resolve, reject) => {
            const id = requestIdCounter++;
            pendingRequests.set(id, { resolve, reject, src, cacheKey });
            worker.postMessage({ type: 'process', id, imageUrl });
        });
    }

    async function generateDepth(src, imageUrl) {
        if (depthCache.has(src)) return depthCache.get(src);

        if (inFlightBySrc.has(src)) {
            return inFlightBySrc.get(src);
        }

        const cacheKey = makeDepthCacheKey(src);
        const task = (async () => {
            initWorker();

            if (isPersistentDepthCacheEnabled()) {
                try {
                    const cachedTexture = await hydrateDepthFromPersistentCache(src, cacheKey);
                    if (cachedTexture) return cachedTexture;
                } catch (error) {
                    console.warn('[Alive BG] Persistent depth cache read failed, falling back to worker inference:', error);
                }
            }

            return requestDepthFromWorker(src, imageUrl, cacheKey);
        })().finally(() => {
            inFlightBySrc.delete(src);
        });

        inFlightBySrc.set(src, task);
        return task;
    }

    async function resolveAnalysisImageUrl(src, isVideo = false) {
        const fullPath = getAssetUrl(src);
        if (!src || !fullPath) return '';
        if (!isVideo && !isVideoSource(src)) return fullPath;

        const hasDepth = !!getDepthTextureByVariants(src).texture;
        const hasHint = !!window.__ALIVE_PIPELINE?.getLightHint?.(src);
        if (hasDepth && hasHint) return '';

        return captureVideoFrameAsDataUrl(src, fullPath);
    }

    async function analyzeBackgroundSource(background, { isVideo = false } = {}) {
        if (!background) return null;

        activeBackgroundSrc = background;
        activeBackgroundIsVideo = !!isVideo || isVideoSource(background);

        const analysisImageUrl = await resolveAnalysisImageUrl(background, activeBackgroundIsVideo);
        if (!analysisImageUrl) {
            if (getDepthTextureByVariants(background).texture) {
                lastDepthSrc = background;
            }
            return { skipped: true, reason: 'already_analyzed', background };
        }

        aliveBgVerboseLog(
            activeBackgroundIsVideo
                ? '[Alive BG] Triggering video-frame background analysis for:'
                : '[Alive BG] Triggering background analysis for:',
            background
        );

        const [hintResult, depthResult] = await Promise.allSettled([
            window.__ALIVE_BG.computeLightHint(background, analysisImageUrl),
            window.__ALIVE_BG.generateDepth(background, analysisImageUrl),
        ]);

        if (hintResult?.status === 'rejected') {
            console.warn('[Alive BG] Image light-hint analysis failed:', hintResult.reason);
        } else {
            aliveBgVerboseLog('[Alive BG] Image light-hint analysis completed for:', background, hintResult?.value || '(no hint)');
        }

        if (depthResult?.status === 'rejected') {
            console.error('[Alive BG] Depth generation failed:', depthResult.reason);
        } else {
            aliveBgVerboseLog('[Alive BG] Depth map ready for:', background);
        }

        return { hintResult, depthResult, background, isVideo: activeBackgroundIsVideo };
    }

    function destroyMemoryDepthCache() {
        for (const [, texture] of depthCache) {
            try {
                texture.destroy(true);
            } catch (error) {
                console.warn('[Alive BG] Failed destroying cached depth texture:', error);
            }
        }
        depthCache.clear();
        depthBlobCache.clear();
    }

    async function openDepthPreviewForSource(src) {
        const resolvedSrc = src || (window.ALIVE_BG_STATE || window.state)?.currentBackground;
        if (!resolvedSrc) {
            throw new Error('No background source was provided for depth preview.');
        }

        let blob = depthBlobCache.get(resolvedSrc) || null;
        if (!blob && isPersistentDepthCacheEnabled()) {
            const entry = await readPersistentDepthEntry(makeDepthCacheKey(resolvedSrc));
            blob = entry?.blob || null;
            if (blob) depthBlobCache.set(resolvedSrc, blob);
        }

        if (!blob) {
            const imageUrl = getAssetUrl(resolvedSrc);
            await generateDepth(resolvedSrc, imageUrl);
            blob = depthBlobCache.get(resolvedSrc) || null;
        }

        if (!blob) {
            throw new Error(`No depth map blob available for "${resolvedSrc}".`);
        }

        const previewUrl = toPreviewUrl(blob);
        tryOpenPreview(previewUrl);
        setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
        return true;
    }

    function setSettings(partialSettings) {
        if (!window.ALIVE_BG_SETTINGS) window.ALIVE_BG_SETTINGS = {};
        Object.assign(window.ALIVE_BG_SETTINGS, partialSettings || {});
    }

    window.__ALIVE_BG = {
        getDepthTexture(src) {
            return getDepthTextureByVariants(src).texture;
        },

        getLastDepthTexture() {
            if (!lastDepthSrc) return null;
            return depthCache.get(lastDepthSrc) || null;
        },

        getLatestBackgroundSource() {
            return activeBackgroundSrc || lastDepthSrc;
        },

        getActiveBackgroundSource() {
            return activeBackgroundSrc || lastDepthSrc;
        },

        isActiveBackgroundVideo() {
            return activeBackgroundIsVideo;
        },

        getLightHint(src) {
            return window.__ALIVE_PIPELINE?.getLightHint?.(src) || null;
        },

        async computeLightHint(src, imageUrl) {
            return window.__ALIVE_PIPELINE?.computeLightHintFromImageUrl?.(src, imageUrl, src) || null;
        },

        resolveAssetUrl(src) {
            return getAssetUrl(src);
        },

        debugLightHint(src) {
            return window.__ALIVE_PIPELINE?.debugLightHint?.(src) || null;
        },

        onSettingsUpdated(newSettings) {
            setSettings(newSettings);
        },

        async generateDepth(src, imageUrl) {
            return generateDepth(src, imageUrl);
        },

        async analyzeBackground(src, options = {}) {
            return analyzeBackgroundSource(src, options);
        },

        async previewDepthMap(src = null) {
            return openDepthPreviewForSource(src);
        },

        async clearDepthCache(options = {}) {
            const { memoryOnly = false } = options;
            destroyMemoryDepthCache();
            if (!memoryOnly) {
                await clearPersistentDepthCache();
            }
            aliveBgVerboseLog(`[Alive BG] Cleared depth cache (memoryOnly=${memoryOnly}).`);
            return true;
        },

        async invalidateDepthForSource(src) {
            if (!src) return false;
            const texture = depthCache.get(src);
            if (texture) {
                try { texture.destroy(true); } catch {}
            }
            depthCache.delete(src);
            depthBlobCache.delete(src);
            await deletePersistentDepthEntry(makeDepthCacheKey(src));
            return true;
        },
    };

    window.addEventListener('vn:background-updated', async (e) => {
        const { background, isVideo } = e.detail;
        try {
            await analyzeBackgroundSource(background, { isVideo: !!isVideo });
        } catch (err) {
            console.error('[Alive BG] Background analysis failed:', err);
        }
    });

    function getAssetUrl(path) {
        if (!path) return '';
        if (/^(https?:|data:|file:|blob:)/.test(path)) return path;

        const serverUrl = (window.ALIVE_BG_SERVER_URL || window.socket?.io?.uri || 'http://localhost:14541').replace(/\/$/, '');
        const runtimeState = window.ALIVE_BG_STATE || window.state;
        const normalizedPath = String(path).replace(/\\/g, '/');

        if (normalizedPath.startsWith('projects/') || normalizedPath.startsWith('/projects/')) {
            const cleanPath = normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath;
            return `${serverUrl}/${cleanPath}`;
        }

        if (normalizedPath.includes('projects/')) {
            const idx = normalizedPath.lastIndexOf('projects/');
            return `${serverUrl}/${normalizedPath.slice(idx)}`;
        }

        const pluginMatch = normalizedPath.match(/(?:^|\/)plugins\/([^/]+)\/(.+)$/);
        if (pluginMatch) {
            return `${serverUrl}/plugins/${pluginMatch[1]}/${pluginMatch[2]}`;
        }

        const cleanPath = normalizedPath.replace(/^(\.\.\/)+/, '').replace(/^assets\//, '');
        const projectName = runtimeState?.currentVN?.projectName || runtimeState?.projectName || window.currentProjectName || 'default_project';
        return `${serverUrl}/projects/${projectName}/assets/${cleanPath}`;
    }

})(window);
