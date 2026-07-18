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

        let activeElement = null;
        let tooltipTimeout = null;

        function showTooltip(e) {
            // Find elements that either have a title or have already been processed
            let target = e.target.closest('[title], [data-original-title]');
            if (!target) return;

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

                // Handle multi-line content if present (e.g. from Scene History)
                const lines = content.split('\n');
                if (lines.length > 1) {
                    tooltip.innerHTML = `<span class="premium-tooltip-gold">${lines[0]}</span><div>${lines.slice(1).join('<br>')}</div>`;
                } else {
                    tooltip.textContent = content;
                }

                tooltip.classList.add('visible');
            }

            updatePosition(e);
        }

        function updatePosition(e) {
            const gap = 15;
            let x = e.clientX + gap;
            let y = e.clientY + gap;

            // Boundary checks
            const rect = tooltip.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) {
                x = e.clientX - rect.width - gap;
            }
            if (y + rect.height > window.innerHeight) {
                y = e.clientY - rect.height - gap;
            }

            tooltip.style.left = `${x}px`;
            tooltip.style.top = `${y}px`;
        }

        function hideTooltip() {
            tooltip.classList.remove('visible');
            activeElement = null;
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

        console.log('[PremiumTooltips] Global system active.');
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
