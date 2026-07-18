/**
 * Global Premium Modal System
 * Provides specialized, unified modal dialogs for all views.
 */
const Modals = (function() {
    // Current active modal reference
    let activeModals = [];

    /**
     * Internal: Create the modal overlay and content structure.
     */
    function createModalElement(options) {
        const overlay = document.createElement('div');
        overlay.className = 'premium-modal-overlay';
        if (options.className) {
            overlay.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
        }
        
        const content = document.createElement('div');
        content.className = 'premium-modal-content';
        if (options.width) content.style.width = options.width;
        if (options.maxWidth) content.style.maxWidth = options.maxWidth;
        
        // Header
        const header = document.createElement('div');
        header.className = 'premium-modal-header';
        
        if (options.draggable) {
            header.classList.add('draggable');
            header.style.cursor = 'grab';
            setupDraggable(header, content);
        }
        
        const title = document.createElement('h2');
        title.textContent = options.title || 'Notification';
        header.appendChild(title);
        
        if (options.closeIcon !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'premium-modal-close';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => closeModal(overlay, options.onClose);
            header.appendChild(closeBtn);
        }
        
        content.appendChild(header);
        
        // Body
        const body = document.createElement('div');
        body.className = 'premium-modal-body';
        
        if (typeof options.content === 'string') {
            body.innerHTML = options.content;
        } else if (options.content instanceof HTMLElement) {
            // Track original position for restoration on close
            options.content._modalOriginalParent = options.content.parentNode;
            options.content._modalOriginalNextSibling = options.content.nextSibling;
            body.appendChild(options.content);
        }
        
        content.appendChild(body);
        
        // Footer (Actions)
        if (options.buttons && options.buttons.length > 0) {
            const footer = document.createElement('div');
            footer.className = 'premium-modal-footer';
            
            options.buttons.forEach(btn => {
                const button = document.createElement('button');
                button.className = `premium-modal-btn ${btn.class || 'secondary'}`;
                button.textContent = btn.text;
                button.onclick = () => {
                    if (btn.onclick) {
                        let closedManually = false;
                        const result = btn.onclick({
                            close: () => {
                                closedManually = true;
                                return closeModal(overlay, options.onClose);
                            },
                            overlay,
                            content,
                            body
                        });
                        // If onclick returns false, don't close automatically.
                        // Also don't close if it was already closed manually via the injected close().
                        if (result !== false && !closedManually) {
                            closeModal(overlay, options.onClose);
                        }
                    } else {
                        closeModal(overlay, options.onClose);
                    }
                };
                footer.appendChild(button);
            });
            
            content.appendChild(footer);
        }
        
        overlay.appendChild(content);
        
        // Click overlay to close (if allowed)
        if (options.closeOnOverlayClick !== false) {
            overlay.onclick = (e) => {
                if (e.target === overlay) closeModal(overlay, options.onClose);
            };
        }
        
        return overlay;
    }

    /**
     * Internal: Close a modal with animation.
     * @returns {Promise} Resolves when the modal is fully removed.
     */
    function closeModal(overlay, callback) {
        if (overlay.classList.contains('premium-modal-closing')) return Promise.resolve();

        overlay.classList.add('premium-modal-closing');
        return new Promise((resolve) => {
            setTimeout(() => {
                // Restoration logic for HTMLElement content
                const body = overlay.querySelector('.premium-modal-body');
                if (body && body.firstElementChild) {
                    const contentElement = body.firstElementChild;
                    if (contentElement instanceof HTMLElement && contentElement._modalOriginalParent) {
                        contentElement._modalOriginalParent.insertBefore(contentElement, contentElement._modalOriginalNextSibling);
                        // Cleanup tracking properties
                        delete contentElement._modalOriginalParent;
                        delete contentElement._modalOriginalNextSibling;
                    }
                }

                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                activeModals = activeModals.filter(m => m !== overlay);
                if (callback) callback();
                resolve();
            }, 300); // Matches CSS transition
        });
    }

    /**
     * Internal: Hardware-accelerated dragging for modals.
     */
    function setupDraggable(header, content) {
        let isDragging = false;
        let startX, startY;
        let currentDx = 0;
        let currentDy = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            
            isDragging = true;
            startX = e.clientX - currentDx;
            startY = e.clientY - currentDy;
            
            header.style.cursor = 'grabbing';
            content.style.transition = 'none';
            document.body.classList.add('modal-dragging');
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            currentDx = e.clientX - startX;
            currentDy = e.clientY - startY;
            
            content.style.setProperty('--modal-dx', `${currentDx}px`);
            content.style.setProperty('--modal-dy', `${currentDy}px`);
        });

        window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            
            header.style.cursor = 'grab';
            content.style.transition = '';
            document.body.classList.remove('modal-dragging');
        });
    }

    return {
        /**
         * Show a generic modal.
         * @param {Object} options - Options for the modal.
         */
        show: function(options) {
            const modal = createModalElement(options);
            document.body.appendChild(modal);
            activeModals.push(modal);
            
            // Trigger animation
            window.requestAnimationFrame(() => {
                modal.classList.add('premium-modal-visible');
            });
            
            return {
                close: () => closeModal(modal, options.onClose),
                overlay: modal
            };
        },

        /**
         * Show a simple alert modal.
         */
        alert: function(title, message, optionsOrCallback) {
            let callback = null;
            let options = {};

            if (typeof optionsOrCallback === 'function') {
                callback = optionsOrCallback;
            } else if (typeof optionsOrCallback === 'object' && optionsOrCallback !== null) {
                options = optionsOrCallback;
                callback = options.callback || null;
            }

            return new Promise((resolve) => {
                this.show({
                    title,
                    content: `<p>${message}</p>`,
                    className: options.variant ? `modal-variant-${options.variant}` : '',
                    buttons: [
                        { 
                            text: options.confirmText || 'OK', 
                            class: 'primary', 
                            onclick: () => { if (typeof callback === 'function') callback(); resolve(true); } 
                        }
                    ],
                    onClose: () => { if (typeof callback === 'function') callback(); resolve(true); }
                });
            });
        },

        /**
         * Show a confirmation modal.
         * @param {string} title - Modal title.
         * @param {string} message - Modal message.
         * @param {object|function} optionsOrOnConfirm - Options object or confirm callback.
         * @param {function} [onCancel] - Cancel callback.
         */
        confirm: function(title, message, optionsOrOnConfirm, onCancel) {
            let options = {};
            let onConfirmCallback = null;
            let onCancelCallback = onCancel;

            if (typeof optionsOrOnConfirm === 'function') {
                onConfirmCallback = optionsOrOnConfirm;
            } else if (typeof optionsOrOnConfirm === 'object') {
                options = optionsOrOnConfirm;
                onConfirmCallback = options.onConfirm || null;
                onCancelCallback = options.onCancel || onCancel;
            }

            return new Promise((resolve) => {
                this.show({
                    title,
                    content: `<p>${message}</p>`,
                    className: options.variant ? `modal-variant-${options.variant}` : '',
                    buttons: [
                        { 
                            text: options.cancelText || 'Cancel', 
                            class: 'secondary', 
                            onclick: () => { if (onCancelCallback) onCancelCallback(); resolve(false); } 
                        },
                        { 
                            text: options.confirmText || 'Confirm', 
                            class: options.variant === 'danger' ? 'danger' : 'primary', 
                            onclick: () => { if (onConfirmCallback) onConfirmCallback(); resolve(true); } 
                        }
                    ],
                    onClose: () => { if (onCancelCallback) onCancelCallback(); resolve(false); }
                });
            });
        },

        /**
         * Show a prompt modal.
         */
        prompt: function(title, message, defaultValueOrOptions, onConfirm, onCancel) {
            let options = {};
            let defaultValue = '';
            let onConfirmCallback = onConfirm;
            let onCancelCallback = onCancel;

            if (typeof defaultValueOrOptions === 'object' && defaultValueOrOptions !== null) {
                options = defaultValueOrOptions;
                defaultValue = options.defaultValue || '';
                onConfirmCallback = options.onConfirm || onConfirm;
                onCancelCallback = options.onCancel || onCancel;
            } else {
                defaultValue = defaultValueOrOptions || '';
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'premium-modal-input';
            input.value = defaultValue;
            input.spellcheck = false;
            input.autocomplete = 'off';
            
            const container = document.createElement('div');
            if (message) {
                const p = document.createElement('p');
                p.innerHTML = message.replace(/\n/g, '<br>');
                container.appendChild(p);
            }
            container.appendChild(input);

            return new Promise((resolve) => {
                this.show({
                    title,
                    content: container,
                    className: options.variant ? `modal-variant-${options.variant}` : '',
                    buttons: [
                        { 
                            text: options.cancelText || 'Cancel', 
                            class: 'secondary', 
                            onclick: () => { if (onCancelCallback) onCancelCallback(); resolve(null); } 
                        },
                        { 
                            text: options.confirmText || 'Confirm', 
                            class: options.variant === 'danger' ? 'danger' : 'primary', 
                            onclick: () => { if (onConfirmCallback) onConfirmCallback(input.value); resolve(input.value); } 
                        }
                    ],
                    onClose: () => { if (onCancelCallback) onCancelCallback(); resolve(null); }
                });
            });
        },

        /**
         * Close all active modals.
         */
        closeAll: function() {
            [...activeModals].forEach(m => closeModal(m));
        }
    };
})();

window.Modals = Modals;
