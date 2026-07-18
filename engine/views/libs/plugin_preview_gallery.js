(function () {
    let overlay = null;
    let activePlugin = null;
    let activeIndex = 0;

    function resolvePreviewUrl(value) {
        const url = String(value || '').trim();
        if (!url || !url.startsWith('/plugins/')) return url;
        const serverUrl = typeof window.getAppServerUrl === 'function'
            ? window.getAppServerUrl()
            : '';
        if (!serverUrl) return url;
        try {
            return new URL(url, `${serverUrl.replace(/\/$/, '')}/`).href;
        } catch {
            return url;
        }
    }

    function close() {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        activePlugin = null;
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') show(activeIndex - 1);
        if (event.key === 'ArrowRight') show(activeIndex + 1);
    }

    function show(nextIndex) {
        const screenshots = activePlugin?.screenshots || [];
        if (!overlay || !screenshots.length) return;
        activeIndex = (nextIndex + screenshots.length) % screenshots.length;
        const screenshot = screenshots[activeIndex];
        overlay.querySelector('.plugin-preview-lightbox-image').src = resolvePreviewUrl(screenshot.url);
        overlay.querySelector('.plugin-preview-lightbox-image').alt = `${activePlugin.name || activePlugin.label || activePlugin.id} preview ${activeIndex + 1}`;
        overlay.querySelector('.plugin-preview-lightbox-count').textContent = `${activeIndex + 1} / ${screenshots.length}`;
        overlay.querySelectorAll('[data-preview-index]').forEach(button => button.classList.toggle('active', Number(button.dataset.previewIndex) === activeIndex));
    }

    function open(plugin, index = 0) {
        if (!plugin?.screenshots?.length) return;
        close();
        activePlugin = plugin;
        activeIndex = index;
        overlay = document.createElement('div');
        overlay.className = 'plugin-preview-lightbox';
        overlay.innerHTML = `
            <div class="plugin-preview-lightbox-backdrop"></div>
            <section class="plugin-preview-lightbox-dialog" role="dialog" aria-modal="true">
                <header><strong></strong><button type="button" class="plugin-preview-lightbox-close" aria-label="Close previews">Close</button></header>
                <div class="plugin-preview-lightbox-main"><button type="button" data-preview-nav="-1" aria-label="Previous preview">Previous</button><img class="plugin-preview-lightbox-image" alt=""><button type="button" data-preview-nav="1" aria-label="Next preview">Next</button></div>
                <footer><span class="plugin-preview-lightbox-count"></span><div class="plugin-preview-lightbox-thumbnails"></div></footer>
            </section>`;
        const pluginName = plugin.name || plugin.label || plugin.id;
        overlay.querySelector('.plugin-preview-lightbox-dialog').setAttribute('aria-label', `${pluginName} previews`);
        overlay.querySelector('header strong').textContent = pluginName;
        const thumbnailHost = overlay.querySelector('.plugin-preview-lightbox-thumbnails');
        plugin.screenshots.forEach((screenshot, screenshotIndex) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.previewIndex = String(screenshotIndex);
            const image = document.createElement('img');
            image.src = resolvePreviewUrl(screenshot.url);
            image.alt = `Preview ${screenshotIndex + 1}`;
            image.addEventListener('error', () => button.remove());
            button.appendChild(image);
            button.addEventListener('click', () => show(screenshotIndex));
            thumbnailHost.appendChild(button);
        });
        overlay.querySelector('.plugin-preview-lightbox-backdrop').addEventListener('click', close);
        overlay.querySelector('.plugin-preview-lightbox-close').addEventListener('click', close);
        overlay.querySelectorAll('[data-preview-nav]').forEach(button => button.addEventListener('click', () => show(activeIndex + Number(button.dataset.previewNav))));
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKeydown);
        show(index);
    }

    window.resolvePluginPreviewUrl = resolvePreviewUrl;
    window.PluginPreviewGallery = { open, close };
}());
