const DEFAULT_WORD_COUNT = 2500;

function getGuiHtml(currentWordCount = DEFAULT_WORD_COUNT, panelOpen = false, autoExpand = false) {
    const presets = [
        { id: 'low', label: 'Low', words: 500, icon: '🌱' },
        { id: 'medium', label: 'Medium', words: 1250, icon: '🌿' },
        { id: 'high', label: 'High', words: 2500, icon: '🌳' },
        { id: 'very_high', label: 'Very High', words: 5000, icon: '🌲' }
    ];

    let presetsHtml = '';
    presets.forEach(p => {
        const active = currentWordCount === p.words ? 'active' : '';
        presetsHtml += `
        <div class="output-size-preset-box ${active}" data-words="${p.words}">
            <span class="preset-icon">${p.icon}</span>
            <span class="preset-label">${p.label}</span>
            <span class="preset-words">${p.words} words</span>
        </div>`;
    });

    const panelStyle = panelOpen ? 'flex' : 'none';
    const iconTransform = panelOpen ? 'rotate(90deg)' : 'rotate(0deg)';
    const toggleClass = panelOpen ? 'active' : '';
    const wrapperClass = panelOpen ? 'output-size-wrapper expanded' : 'output-size-wrapper';

    return `
    <div class="${wrapperClass}">
        <div class="output-size-header-toggle ${toggleClass}" id="output-size-toggle-btn">
            <h3><span class="output-size-toggle-icon" style="transform: ${iconTransform}">▶</span> Output Size Controller <span class="plugin-tag">(Plugin)</span></h3>
        </div>
        <div class="output-size-container core-area-player" id="output-size-panel" style="display: ${panelStyle};">
            <p class="output-size-description">Choose the target word count for each story turn. Larger outputs result in longer play sessions but may increase LLM latency.</p>
            
            <div class="output-size-presets-grid">
                ${presetsHtml}
            </div>

            <div class="output-size-efficiency-note">
                <div class="note-icon">💡</div>
                <div class="note-content">
                    <p>Generating longer chapters is significantly more <strong>efficient</strong> (waiting/reading ratio).</p>
                    <p class="note-sub">Waiting 3m for a 10m scene is better than waiting 2.5m for a 5m scene. Use shorter outputs only if you want more control over the story!</p>
                    <p class="note-sub">Also, not all LLMs are good at adhering to length constraints. This plugin simply tells the writing AI what the word count should be.</p>
                </div>
            </div>

            <div class="output-size-custom-section">
                <div class="custom-header">
                    <span>Custom Word Count</span>
                    <span id="output-size-custom-val">${currentWordCount}</span>
                </div>
                <input type="range" id="output-size-slider" min="100" max="8000" step="50" value="${currentWordCount}">
            </div>

            <div class="output-size-stats-panel">
                <div class="stat-item">
                    <span class="stat-icon">⏱️</span>
                    <div class="stat-details">
                        <span class="stat-label">Estimated Read Time</span>
                        <span id="stat-play-time" class="stat-value">~10.0m</span>
                    </div>
                </div>
                <div class="stat-item">
                    <span class="stat-icon">💬</span>
                    <div class="stat-details">
                        <span class="stat-label">Dialogue Lines</span>
                        <span id="stat-lines" class="stat-value">~150</span>
                    </div>
                </div>
            </div>

            <div class="output-size-auto-expand-row">
                <label class="checkbox-container-simple">
                    <input type="checkbox" id="output-size-auto-expand" ${autoExpand ? 'checked' : ''}>
                    <span class="checkbox-label">Auto-ask LLM for more if output is too short</span>
                    <div class="info-tooltip-trigger" data-tooltip="Results in higher costs since it's a second LLM call, but due to input caching, most model providers provide a large discount. Caps at 1 extra request.">?</div>
                </label>
            </div>
            
            <div class="output-size-footer">
                <span id="output-size-save-status" class="status-unsaved">Changes not saved</span>
                <button id="save-output-size-btn" class="save-apply-btn">Apply to Project</button>
            </div>
        </div>
    </div>
    `;
}

function getGuiCss() {
    return `
    .output-size-wrapper {
        margin: 15px 0;
        font-family: var(--font-display, inherit);
        border-left: 4px solid #4CAF50; /* Green theme */
        border-radius: var(--radius-lg);
        overflow: hidden;
        transition: all 0.3s ease;
    }
    .output-size-header-toggle {
        cursor: pointer;
        padding: 15px 25px;
        background-color: rgba(76, 175, 80, 0.1) !important;
        border: 1px solid rgba(76, 175, 80, 0.15);
        display: flex;
        align-items: center;
        transition: all 0.3s ease;
    }
    .output-size-header-toggle:hover {
        background-color: rgba(76, 175, 80, 0.15) !important;
        border-color: rgba(76, 175, 80, 0.3);
    }
    .plugin-tag {
        font-size: 0.7em;
        color: var(--text-muted);
        opacity: 0.6;
        font-weight: 400;
        margin-left: 4px;
    }
    .output-size-wrapper.expanded .output-size-header-toggle {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom: none;
        background-color: rgba(76, 175, 80, 0.12) !important;
    }
    .output-size-header-toggle h3 {
        margin: 0;
        font-size: 1.1em;
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text-color);
    }
    .output-size-toggle-icon {
        font-size: 0.8em;
        transition: transform 0.3s ease;
        color: #4CAF50;
    }
    .output-size-container {
        padding: 20px 15px;
        background-color: rgba(76, 175, 80, 0.06) !important;
        border: 1px solid var(--border-color);
        border-top: none;
        display: flex;
        flex-direction: column;
    }
    .output-size-description {
        font-size: 0.85em;
        color: var(--text-muted);
        margin-bottom: 20px;
        text-align: center;
        line-height: 1.4;
    }
    .output-size-presets-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 25px;
    }
    .output-size-preset-box {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border-color);
        padding: 15px 10px;
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
    }
    .output-size-preset-box:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: #4CAF5070;
        transform: translateY(-2px);
    }
    .output-size-preset-box.active {
        background: rgba(76, 175, 80, 0.15);
        border-color: #4CAF50;
        box-shadow: 0 0 15px rgba(76, 175, 80, 0.2);
    }
    .preset-icon { font-size: 1.8em; margin-bottom: 8px; }
    .preset-label { font-weight: 800; font-size: 0.9em; color: var(--text-color); }
    .preset-words { font-size: 0.75em; color: var(--text-muted); margin-top: 4px; }

    .output-size-custom-section {
        background: rgba(0, 0, 0, 0.2);
        padding: 20px;
        border-radius: var(--radius-lg);
        margin-bottom: 25px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .custom-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        font-weight: 700;
        color: var(--text-muted);
        font-size: 0.9em;
    }
    #output-size-custom-val {
        color: #4CAF50;
        font-size: 1.2em;
        background: rgba(0,0,0,0.3);
        padding: 2px 10px;
        border-radius: var(--radius-sm);
    }
    #output-size-slider {
        width: 100%;
        -webkit-appearance: none;
        height: 8px;
        background: rgba(255,255,255,0.1);
        border-radius: var(--radius-sm);
        outline: none;
    }
    #output-size-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        background: #4CAF50;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
    }

    .output-size-stats-panel {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 25px;
    }
    .stat-item {
        background: rgba(255,255,255,0.03);
        padding: 15px;
        border-radius: var(--radius-lg);
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .stat-icon { font-size: 2em; opacity: 0.8; }
    .stat-details { display: flex; flex-direction: column; }
    .stat-label { font-size: 0.75em; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    .stat-value { font-size: 1.3em; font-weight: 800; color: var(--text-color); }

    .output-size-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 15px;
        border-top: 1px solid rgba(255,255,255,0.05);
    }
    
    /* Efficiency Note Style */
    .output-size-efficiency-note {
        background: rgba(255, 204, 0, 0.05);
        border: 1px solid rgba(255, 204, 0, 0.1);
        border-radius: var(--radius-md);
        padding: 12px 15px;
        margin-bottom: 20px;
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }
    .note-icon { font-size: 1.4em; }
    .note-content p { margin: 0; font-size: 0.85em; color: var(--text-color); line-height: 1.4; }
    .note-content .note-sub { font-size: 0.8em; color: var(--text-muted); margin-top: 4px; }

    /* Auto-expand Row Style */
    .output-size-auto-expand-row {
        display: flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.03);
        padding: 10px 15px;
        border-radius: var(--radius-md);
        margin-bottom: 20px;
        border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .checkbox-container-simple {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-size: 0.85em;
        font-weight: 600;
        color: var(--text-muted);
        width: 100%;
    }
    .checkbox-container-simple input {
        accent-color: var(--accent);
        width: 16px;
        height: 16px;
    }
    .info-tooltip-trigger {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        cursor: help;
        color: var(--accent);
        border: 1px solid rgba(255, 204, 0, 0.3);
        margin-left: 5px;
        flex-shrink: 0;
    }
    .info-tooltip-trigger:hover {
        background: var(--accent);
        color: #000;
    }
    #output-size-save-status {
        font-size: 0.85em;
        font-weight: 600;
    }
    .status-unsaved { color: #ffeb3b; }
    .status-saved { color: #4CAF50; }
    
    .save-apply-btn {
        padding: 10px 25px;
        font-size: 0.9em;
        font-weight: 800;
        border-radius: var(--radius-lg);
        background: linear-gradient(135deg, var(--accent) 0%, #b89200 100%);
        color: #1a1a1a;
        box-shadow: 0 4px 15px rgba(255, 204, 0, 0.2);
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .save-apply-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(255, 204, 0, 0.3);
        filter: brightness(1.1);
    }
    `;
}

function getGuiJs() {
    return `
        const panel = document.getElementById('output-size-panel');
        if (!panel) return;

        const slider = document.getElementById('output-size-slider');
        const customValDisplay = document.getElementById('output-size-custom-val');
        const statPlayTime = document.getElementById('stat-play-time');
        const statLines = document.getElementById('stat-lines');
        const saveStatus = document.getElementById('output-size-save-status');
        const saveBtn = document.getElementById('save-output-size-btn');
        const toggleBtn = document.getElementById('output-size-toggle-btn');
        const presets = document.querySelectorAll('.output-size-preset-box');

        function updateStats(words) {
            const minutes = (words / 250).toFixed(1);
            const lines = Math.round(words / 16.6);
            statPlayTime.textContent = '~' + minutes + 'm';
            statLines.textContent = '~' + lines;
            customValDisplay.textContent = words;
            
            saveStatus.textContent = 'Changes not saved';
            saveStatus.className = 'status-unsaved';
        }

        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            updateStats(val);
            
            // Clear active state from presets if it doesn't match
            presets.forEach(p => {
                if (parseInt(p.getAttribute('data-words')) === val) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });
        });

        presets.forEach(p => {
            p.addEventListener('click', () => {
                const words = parseInt(p.getAttribute('data-words'));
                slider.value = words;
                updateStats(words);
                
                presets.forEach(box => box.classList.remove('active'));
                p.classList.add('active');
            });
        });

        toggleBtn.addEventListener('click', () => {
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'flex' : 'none';
            const wrapper = document.querySelector('.output-size-wrapper');
            if (wrapper) wrapper.classList.toggle('expanded', isHidden);
            const icon = toggleBtn.querySelector('.output-size-toggle-icon');
            if (icon) icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            bridge.emit('save-output-panel-state', { open: isHidden });
        });

        saveBtn.addEventListener('click', () => {
            const words = parseInt(slider.value);
            const autoExpand = document.getElementById('output-size-auto-expand').checked;
            bridge.emit('save-output-size', { word_count: words, auto_expand: autoExpand });
        });

        bridge.on('save-output-size-response', (data) => {
            if (data.success) {
                saveStatus.textContent = 'Saved to Project Metadata';
                saveStatus.className = 'status-saved';
            }
        });

        // Initialize stats
        updateStats(parseInt(slider.value));

        // Tooltip logic
        const tooltipTrigger = document.querySelector('.info-tooltip-trigger');
        if (tooltipTrigger) {
            tooltipTrigger.addEventListener('mouseenter', (e) => {
                const text = tooltipTrigger.getAttribute('data-tooltip');
                let tooltip = document.getElementById('output-size-tooltip');
                if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.id = 'output-size-tooltip';
                    tooltip.className = 'premium-tooltip';
                    document.body.appendChild(tooltip);
                }
                tooltip.innerHTML = \`<span class="premium-tooltip-gold">INFO</span>\${text}\`;
                tooltip.classList.add('visible');
                
                const rect = tooltipTrigger.getBoundingClientRect();
                tooltip.style.left = (rect.left - (tooltip.offsetWidth / 2) + 9) + 'px';
                tooltip.style.top = (rect.top - tooltip.offsetHeight - 10) + 'px';
            });
            tooltipTrigger.addEventListener('mouseleave', () => {
                const tooltip = document.getElementById('output-size-tooltip');
                if (tooltip) tooltip.classList.remove('visible');
            });
        }
    `;
}

module.exports = {
    DEFAULT_WORD_COUNT,
    getGuiHtml,
    getGuiCss,
    getGuiJs
};
