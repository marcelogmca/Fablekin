// engine/views/content_manager/modules/directives.js

import { socket, debugLog, debugError } from './state.js';

/**
 * Fetches and renders the Creative Direction (Project Directives) panel.
 */
export async function renderProjectDirectives() {
    const container = document.getElementById('project-directives-container');
    if (!container) return;

    debugLog('Fetching project directives...');
    const response = await socket.emitReceive('get-project-directives', {});
    
    if (response && response.success) {
        _renderDirectivesUi(response.result);
    } else {
        debugError('Failed to fetch project directives', response?.error);
        container.innerHTML = `<div class="directives-error">Failed to load Creative Direction settings.</div>`;
    }
}

/**
 * Internal helper to render the directives UI from metadata.
 */
export function _renderDirectivesUi(metadata) {
    const container = document.getElementById('project-directives-container');
    if (!container) return;

    const metadataArray = Array.isArray(metadata) ? metadata : [];
    // Filter out lore_book and any empty entities
    const filteredMetadata = metadataArray.filter(entity => entity.id !== 'lore_book' && entity.fields && entity.fields.length > 0);
    
    const sortedMetadata = [...filteredMetadata].sort((a, b) => {
        return (a.name || '').localeCompare(b.name || '');
    });

    const savedState = localStorage.getItem('directivesPanelCollapsed');
    const isCollapsed = savedState !== null ? savedState === 'true' : false;

    // Save focus state
    const focusedElement = document.activeElement;
    const focusedData = (focusedElement && focusedElement.classList.contains('directive-input')) ? {
        entityId: focusedElement.dataset.entityId,
        fieldKey: focusedElement.dataset.fieldKey,
        selectionStart: focusedElement.selectionStart,
        selectionEnd: focusedElement.selectionEnd
    } : null;

    let html = `
        <div class="directives-panel ${isCollapsed ? 'collapsed' : ''}" id="directivesPanel">
            <div class="directives-header" id="directivesToggle">
                <div>
                    <h2>✨ LLM Feedback & Creative Direction</h2>
                    <p>Provide project-wide feedback to the AI and fine-tune how specific modules interpret your story.</p>
                </div>
                <div class="directives-toggle-btn">▾</div>
            </div>
            <div class="directives-content">
                <div class="directives-grid">
    `;

    sortedMetadata.forEach(entity => {
        html += `
            <div class="directive-card ${entity.type}-directive" id="directive-card-${entity.id}">
                <div class="directive-card-header">
                    <span class="entity-type-badge">${entity.type === 'core' ? 'Core' : 'Plugin'}</span>
                    <h3>${entity.name}</h3>
                </div>
                ${entity.description ? `<p class="directive-entity-desc">${entity.description}</p>` : ''}
                <div class="directive-fields">
        `;

        if (!entity.fields || entity.fields.length === 0) {
            html += `<p class="directives-empty-state">No configurable directives for this module.</p>`;
        } else {
            entity.fields.forEach(field => {
                // Escape double quotes for the placeholder attribute
                const rawPlaceholder = field.placeholder || 'Enter instructions...';
                const escapedPlaceholder = rawPlaceholder.replace(/"/g, '&quot;');

                html += `
                    <div class="directive-field">
                        <label style="order: 1;">${field.label}</label>
                        <textarea 
                            class="directive-input" 
                            style="order: 2;"
                            data-entity-id="${entity.id}" 
                            data-field-key="${field.key}"
                            placeholder="${escapedPlaceholder}"
                        >${field.value || ''}</textarea>
                    </div>
                `;
            });
        }

        html += `</div></div>`;
    });

    html += `</div></div></div>`;
    
    if (sortedMetadata.length === 0) {
        html = '<div class="directives-empty-global">No project directives found. Enable advanced mode to see more.</div>';
    }

    container.innerHTML = html;
 
    // Restore focus
    if (focusedData) {
        const selector = `.directive-input[data-entity-id="${focusedData.entityId}"][data-field-key="${focusedData.fieldKey}"]`;
        const target = container.querySelector(selector);
        if (target) {
            target.focus();
            target.setSelectionRange(focusedData.selectionStart, focusedData.selectionEnd);
        }
    }

    const toggle = container.querySelector('#directivesToggle');
    const panel = container.querySelector('#directivesPanel');
    if (toggle && panel) {
        toggle.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            localStorage.setItem('directivesPanelCollapsed', panel.classList.contains('collapsed'));
        });
    }

    container.querySelectorAll('.directive-input').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            // Remove success class on edit
            e.target.classList.remove('save-success');
        });

        textarea.addEventListener('change', async (e) => {
            const { entityId, fieldKey } = e.target.dataset;
            const value = e.target.value;
            const result = await socket.emitReceive('update-project-directive', { entityId, fieldKey, value });
            if (result.success) {
                e.target.classList.add('save-success');
                setTimeout(() => e.target.classList.remove('save-success'), 2000);
            }
        });
    });
}
