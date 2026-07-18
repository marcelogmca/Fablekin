/**
 * PremiumSelect Utility
 * Transforms standard <select> elements into high-fidelity custom dropdowns.
 */
class PremiumSelect {
    /**
     * Initializes a PremiumSelect instance for a given native select element.
     * @param {HTMLSelectElement} select - The native select element to transform.
     * @param {Object} options - Configuration options.
     */
    constructor(select, options = {}) {
        if (!select || select.tagName !== 'SELECT') {
            console.error('[PremiumSelect] Target must be a <select> element.');
            return;
        }

        if (select.__premiumSelect) return select.__premiumSelect;

        this.select = select;
        this.options = options;
        this.isOpen = false;
        
        this.init();
        select.__premiumSelect = this;
    }

    /**
     * Static helper to initialize all premium selects in a container.
     * @param {HTMLElement} container - The container to search within.
     */
    static initAll(container = document) {
        const selects = container.querySelectorAll('.premium-select');
        selects.forEach(s => new PremiumSelect(s));
    }

    init() {
        // 1. Create the UI
        this.container = document.createElement('div');
        this.container.className = 'premium-select-container';
        if (this.select.disabled) this.container.classList.add('disabled');
        
        // Copy relevant classes/attributes
        if (this.select.classList.contains('mini-input')) this.container.classList.add('mini-select');
        
        this.trigger = document.createElement('div');
        this.trigger.className = 'premium-select-trigger';
        
        this.labelSpan = document.createElement('span');
        this.labelSpan.className = 'trigger-label';
        
        this.arrow = document.createElement('span');
        this.arrow.className = 'arrow';
        this.arrow.innerHTML = '▼';
        
        this.trigger.appendChild(this.labelSpan);
        this.trigger.appendChild(this.arrow);
        
        this.optionsList = document.createElement('div');
        this.optionsList.className = 'premium-options-list';
        
        this.container.appendChild(this.trigger);
        this.container.appendChild(this.optionsList);
        
        // Hide original and insert new UI
        this.select.style.display = 'none';
        this.select.parentNode.insertBefore(this.container, this.select.nextSibling);
        
        // 2. Render Options
        this.refreshOptions();
        
        // 3. Event Listeners
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.select.disabled) return;
            this.toggle();
        });
        
        // Close on outside click
        document.addEventListener('click', () => {
            if (this.isOpen) this.close();
        });

        // Sync if native select value changes externally
        this.select.addEventListener('change', () => {
            this.updateTrigger();
            this.highlightSelected();
        });

        // Mutation Observer to handle dynamic options updates
        this.observer = new MutationObserver(() => {
            this.refreshOptions();
        });
        this.observer.observe(this.select, { childList: true });
    }

    refreshOptions() {
        this.optionsList.innerHTML = '';
        const options = Array.from(this.select.options);
        
        options.forEach(opt => {
            // Check for separators (logic specific to this engine's patterns)
            if (opt.dataset.isSeparator === 'true' || opt.disabled && opt.value === '') {
                 const sep = document.createElement('div');
                 sep.className = 'premium-dropdown-separator';
                 sep.innerHTML = `<span>${opt.textContent}</span>`;
                 this.optionsList.appendChild(sep);
                 if (opt.dataset.isSeparator === 'true') return;
            }

            const item = document.createElement('div');
            item.className = 'premium-option';
            if (opt.value === this.select.value) item.classList.add('selected');
            
            const label = document.createElement('div');
            label.className = 'premium-option-label';
            label.textContent = opt.textContent;
            
            item.appendChild(label);
            
            // Handle descriptions from data attributes
            const descText = opt.dataset.description;
            if (descText) {
                const desc = document.createElement('div');
                desc.className = 'premium-option-desc';
                desc.textContent = descText;
                item.appendChild(desc);
            }

            // Handle custom background colors (Content Manager pattern)
            if (opt.dataset.backgroundColor) {
                item.style.borderLeftColor = opt.dataset.backgroundColor;
                if (opt.value === this.select.value) {
                    item.style.backgroundColor = `${opt.dataset.backgroundColor}33`; // 20% opacity
                }
            }
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.select.value = opt.value;
                this.select.dispatchEvent(new Event('change', { bubbles: true }));
                this.close();
            });
            
            this.optionsList.appendChild(item);
        });
        
        this.updateTrigger();
    }

    updateTrigger() {
        const selectedOption = this.select.options[this.select.selectedIndex];
        if (selectedOption) {
            this.labelSpan.textContent = selectedOption.textContent;
            
            // Apply background color if defined
            if (selectedOption.dataset.backgroundColor) {
                this.trigger.style.backgroundColor = selectedOption.dataset.backgroundColor;
                this.trigger.style.color = selectedOption.dataset.color || '#fff';
            } else {
                this.trigger.style.backgroundColor = '';
                this.trigger.style.color = '';
            }
        } else {
            this.labelSpan.textContent = 'Select...';
        }
    }

    highlightSelected() {
        const items = Array.from(this.optionsList.querySelectorAll('.premium-option'));
        items.forEach((item, index) => {
            const opt = this.select.options[index];
            if (opt && opt.value === this.select.value) {
                item.classList.add('selected');
                if (opt.dataset.backgroundColor) {
                    item.style.backgroundColor = `${opt.dataset.backgroundColor}33`;
                }
            } else {
                item.classList.remove('selected');
                item.style.backgroundColor = '';
            }
        });
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        // Close all other premium selects first
        document.querySelectorAll('.premium-select-container.open').forEach(c => {
            if (c !== this.container) {
                const ps = Array.from(document.querySelectorAll('.premium-select')).find(s => s.__premiumSelect && s.__premiumSelect.container === c);
                if (ps && ps.__premiumSelect) ps.__premiumSelect.close();
            }
        });

        this.isOpen = true;
        this.container.classList.add('open');
        
        // Handle overflow/positioning
        const rect = this.container.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        if (spaceBelow < 300 && spaceAbove > spaceBelow) {
            this.container.classList.add('drop-up');
        } else {
            this.container.classList.remove('drop-up');
        }
    }

    close() {
        this.isOpen = false;
        this.container.classList.remove('open');
    }
}

// Global initialization
window.PremiumSelect = PremiumSelect;
