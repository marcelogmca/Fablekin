/**
 * Global Premium Tooltip System
 * Automatically replaces native 'title' tooltips with a themed version.
 */
(function() {
    // Prevent double initialization
    if (window.__premiumTooltipsInitialized) return;
    window.__premiumTooltipsInitialized = true;

    function init() {
        if (!document.body) {
            setTimeout(init, 10);
            return;
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'premium-tooltip';
        document.body.appendChild(tooltip);

        // Rendered-line clamp for live stream tails. Counting SOURCE newlines
        // is not enough: the tooltip wraps, so eight source lines can render as
        // twenty. A fixed-height box with scrollTop pinned to the bottom shows
        // exactly N *effective* lines and always the newest ones.
        const STREAM_LINES = 6;
        const streamStyle = document.createElement('style');
        streamStyle.textContent = `
            .premium-tooltip-stream-label {
                margin-top: 6px;
                font-weight: 700;
                opacity: 0.7;
                font-size: 0.82em;
                letter-spacing: 0.5px;
            }
            .premium-tooltip-stream {
                overflow: hidden;
                height: calc(${STREAM_LINES} * 1.35em);
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 0.9em;
                line-height: 1.35;
                white-space: pre-wrap;
                word-break: break-word;
                opacity: 0.9;
            }
        `;
        document.head.appendChild(streamStyle);

        let activeElement = null;
        let tooltipTimeout = null;
        let refreshInterval = null;
        let renderedContent = '';
        let pointer = { x: 0, y: 0 };
        // Chosen once per hovered element. Re-deciding it on every content
        // update made a live-streaming tooltip flip above/below the cursor on
        // each refresh (UP, DOWN, UP, DOWN).
        let placement = 'below';

        function gap() { return 15; }

        function escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, ch => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        function renderContent(content) {
            if (!content) return;
            // Handle multi-line content if present (e.g. from Scene History,
            // or the live LLM stream tails). Values are plain text — streamed
            // model output frequently contains `<` and must never become markup.
            const lines = content.split('\n');
            if (lines.length > 1) {
                // Split head (header/attempt/stats) from marked stream blocks so
                // only the tails get the fixed-height rendered-line clamp.
                const head = [];
                const blocks = [];
                let current = null;
                for (const line of lines.slice(1)) {
                    const marker = /^(THINKING|OUTPUT) \(tail\):$/.exec(line);
                    if (marker) {
                        current = { label: line, text: '' };
                        blocks.push(current);
                    } else if (current) {
                        current.text += `${current.text ? '\n' : ''}${line}`;
                    } else {
                        head.push(line);
                    }
                }

                let html = `<span class="premium-tooltip-gold">${escapeHtml(lines[0])}</span>`;
                if (head.length) html += `<div>${head.map(escapeHtml).join('<br>')}</div>`;
                for (const block of blocks) {
                    html += `<div class="premium-tooltip-stream-label">${escapeHtml(block.label)}</div>`;
                    html += `<div class="premium-tooltip-stream">${escapeHtml(block.text)}</div>`;
                }
                tooltip.innerHTML = html;
                // Pin to the newest text; the box height never changes, so the
                // tooltip stops growing as tokens arrive.
                tooltip.querySelectorAll('.premium-tooltip-stream').forEach(el => {
                    el.scrollTop = el.scrollHeight;
                });
            } else {
                tooltip.textContent = content;
            }
            renderedContent = content;
        }

        function showTooltip(e) {
            // Find elements that either have a title or have already been processed
            let target = e.target.closest('[title], [data-original-title]');
            if (!target) return;

            pointer = { x: e.clientX, y: e.clientY };

            // If it's a new element or we just moved back into an element
            if (activeElement !== target) {
                clearTimeout(tooltipTimeout);
                
                // Store the original title and remove it to prevent native tooltip
                if (!target.dataset.originalTitle && target.hasAttribute('title')) {
                    target.dataset.originalTitle = target.getAttribute('title');
                    target.removeAttribute('title');
                }

                activeElement = target;
                
                const content = target.dataset.originalTitle;
                if (!content) return;

                // Size the box before measuring so the placement decision and
                // the position both describe the same geometry.
                applySizeCaps();
                renderContent(content);
                placement = choosePlacement(e);
                tooltip.classList.add('visible');
                startRefresh();
            }

            updatePosition(e);
        }

        // A live stream can grow without bound; cap the box so it can never
        // take over the screen (inline, so it holds for every theme). The
        // stream blocks themselves are fixed-height, so this is only a
        // last-resort net for unusually long headers.
        function applySizeCaps() {
            tooltip.style.maxHeight = `${Math.max(200, Math.min(window.innerHeight - 40, 640))}px`;
            tooltip.style.maxWidth = `${Math.max(240, Math.min(window.innerWidth - 40, 500))}px`;
            tooltip.style.overflow = 'hidden';
        }

        /**
         * Decide the side once per hovered element. Re-deciding on every content
         * update made a streaming tooltip flip above/below the cursor on each
         * refresh (UP, DOWN, UP, DOWN).
         */
        function choosePlacement(e) {
            const rect = tooltip.getBoundingClientRect();
            const g = gap();
            const roomBelow = window.innerHeight - (e.clientY + g);
            const roomAbove = e.clientY - g;
            if (roomBelow >= rect.height) return 'below';
            if (roomAbove >= rect.height) return 'above';
            return roomBelow >= roomAbove ? 'below' : 'above';
        }

        /**
         * Live content: some tooltips (the LLM road lanes) rewrite their
         * data-original-title while the stream advances. Re-read it on a timer
         * so a tooltip that is already open keeps showing incoming tokens.
         */
        function refresh() {
            if (!activeElement || !tooltip.classList.contains('visible')) return;
            const content = activeElement.dataset.originalTitle;
            if (typeof content === 'string' && content !== renderedContent) {
                renderContent(content);
                // The side is fixed, so this cannot oscillate; it only nudges
                // the box back on screen when growth reached an edge.
                const rect = tooltip.getBoundingClientRect();
                if (rect.bottom > window.innerHeight || rect.top < 0) {
                    updatePositionFromPointer();
                }
            }
        }

        function startRefresh() {
            if (refreshInterval) return;
            refreshInterval = setInterval(refresh, 200);
        }

        function stopRefresh() {
            if (!refreshInterval) return;
            clearInterval(refreshInterval);
            refreshInterval = null;
        }

        function updatePosition(e) {
            const rect = tooltip.getBoundingClientRect();
            const g = gap();
            let x = e.clientX + g;
            if (x + rect.width > window.innerWidth) {
                x = e.clientX - rect.width - g;
            }
            x = Math.max(4, x);
            // Placement is stable for the whole hover, so growing content moves
            // the box in one direction only (never flipping sides).
            let y = placement === 'above' ? e.clientY - rect.height - g : e.clientY + g;
            if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
            if (y < 4) y = 4;

            tooltip.style.left = `${x}px`;
            tooltip.style.top = `${y}px`;
        }

        function updatePositionFromPointer() {
            updatePosition({ clientX: pointer.x, clientY: pointer.y });
        }

        function hideTooltip() {
            tooltip.classList.remove('visible');
            activeElement = null;
            renderedContent = '';
            stopRefresh();
        }

        // Global listeners
        document.addEventListener('mouseover', showTooltip);
        document.addEventListener('mousemove', (e) => {
            if (activeElement) updatePosition(e);
        });
        document.addEventListener('mouseout', (e) => {
            // Check if we are leaving the active element and not entering a child of it
            if (activeElement && !targetInParent(e.relatedTarget, activeElement)) {
                hideTooltip();
            }
        });

        function targetInParent(target, parent) {
            if (!target) return false;
            return parent.contains(target) || target.closest('[data-original-title]') === parent;
        }

        // Handle dynamic content: MutationObserver to catch new elements with titles
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        const titleElements = node.querySelectorAll('[title]');
                        if (node.hasAttribute('title')) processElement(node);
                        titleElements.forEach(processElement);
                    }
                });
            });
        });

        function processElement(el) {
            if (el.hasAttribute('title') && !el.dataset.originalTitle) {
                el.dataset.originalTitle = el.getAttribute('title');
                el.removeAttribute('title');
            }
        }

        // Initial pass
        document.querySelectorAll('[title]').forEach(processElement);
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Producers that rewrite data-original-title on a fast cadence (the LLM
        // road) can push the open tooltip forward instead of waiting a tick.
        window.PremiumTooltips = {
            refresh,
            isActive: () => !!activeElement && tooltip.classList.contains('visible')
        };

        console.log('[PremiumTooltips] Global system active.');
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
