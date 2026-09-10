/**
 * Character Sheets - UI Library
 * Handles HTML/CSS generation for the VN HUD and Modals.
 */

function renderHudSection(totalCount, turnNumber, previewCharacters = [], options = {}) {
    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const portraits = previewCharacters.slice(0, 5).map(character => {
        const name = escapeHtml(character.name || 'Unknown');
        const payload = escapeHtml(JSON.stringify({ characterName: character.name || '', turnNumber }));
        const portrait = character.icon
            ? `<img class="character-hud-avatar" src="${escapeHtml(character.icon)}" alt="${name}" title="${name}">`
            : `<span class="character-hud-avatar character-hud-avatar-fallback" title="${name}">${name.charAt(0)}</span>`;
        return `<button type="button" class="character-hud-person hud-socket-emit"
                    data-event="character-sheets-request-single" data-payload="${payload}"
                    aria-label="Open ${name}'s character profile">${portrait}</button>`;
    }).join('');
    return `
        <div class="character-hud-panel${options.withRelationships ? ' character-hud-panel--with-bonds' : ''}">
            <div class="character-hud-heading">
                <span class="character-hud-heading-mark" aria-hidden="true"></span>
                <span>Cast</span>
                <button type="button" class="hud-socket-emit character-hud-registry-link"
                        data-event="character-sheets-request-full-list"
                        data-payload='{"turnNumber": ${turnNumber}}'>
                    All characters <strong>${totalCount}</strong><span aria-hidden="true">↗</span>
                </button>
            </div>
            <div class="character-hud-summary">
                <div class="character-hud-portraits">${portraits || '<span class="character-hud-empty">No active cast yet.</span>'}</div>
            </div>
        </div>
    `;
}

function renderManualEditor(sheetData, filePath) {
    return `
        <div class="manual-sheet-editor">
            <textarea id="manualSheetText">${sheetData}</textarea>
            <div style="margin-top: var(--space-md); display: flex; justify-content: flex-end; gap: var(--space-sm); align-items: center; width: 100%; box-sizing: border-box;">
                <span id="saveStatus" style="font-size: var(--font-size-xs); color: var(--text-muted);"></span>
                <button class="action-btn" style="background: var(--accent); color: var(--bg-panel); font-weight: bold; padding: var(--space-xs) var(--space-lg);" 
                    onclick="const btn = this; const status = document.getElementById('saveStatus'); const content = document.getElementById('manualSheetText').value; status.textContent = 'Saving...'; btn.disabled = true; socket.emit('save-manual-character-sheet', { filePath: '${filePath.replace(/\\/g, '\\\\')}', content: content });">
                    Save to Database
                </button>
            </div>
        </div>
    `;
}

function renderCharacterCard(char, index, isHorizontal, characterIcons, playerSettingsName, schemaFields = [], _projectName) {
    const icon = characterIcons[char.name] || characterIcons[char.name.toLowerCase()] || '';
    const isFull = char.type === 'full';
    const isPlayer = char.isPlayer || (playerSettingsName && char.name.toLowerCase() === playerSettingsName.toLowerCase());
    const isDead = char.capsule.status === 'DEAD';
    const accentColor = isDead ? '#888' : (isPlayer ? '#ff00e5' : (isFull ? '#00e5ff' : '#ffd700'));
    const detailsId = `char-details-${isPlayer ? 'player' : (isHorizontal ? 'major' : 'other')}-${index}`;

    // Always start with Aliases if present
    const sections = [{ label: 'Aliases', value: char.capsule.aliases }];

    // Add dynamic fields
    if (schemaFields && schemaFields.length > 0) {
        schemaFields.forEach(f => {
            // Check if value exists and is not just the empty placeholder or N/A
            if (char.capsule[f.id] && char.capsule[f.id] !== 'N/A') {
                sections.push({ label: f.label, value: char.capsule[f.id] });
            }
        });

        // CRITICAL BUG FIX: Fallback for 'brief' if biography (HIGH-LEVEL SUMMARY) is missing
        // Light capsules use 'brief' but the schema uses 'biography' (label: HIGH-LEVEL SUMMARY)
        if (!char.capsule.biography && char.capsule.brief && !sections.find(s => s.label === 'HIGH-LEVEL SUMMARY')) {
            sections.push({ label: 'Summary', value: char.capsule.brief });
        }
    } else {
        // Fallback if no schema provided (legacy behavior)
        if (char.capsule.biography) sections.push({ label: 'Biography', value: char.capsule.biography });
        if (char.capsule.brief) sections.push({ label: 'Brief', value: char.capsule.brief });
        if (char.capsule.personality_profile) sections.push({ label: 'Personality', value: char.capsule.personality_profile });
        if (char.capsule.current_context) sections.push({ label: 'Current Context', value: char.capsule.current_context });
    }

    // Simplified rendering without debug artifacts
    const innerHtml = sections
        .filter(s => s.value && !(isPlayer && s.label === 'Current Context'))
        .map(s => `
            <div class="char-details-section">
                <div class="char-details-label">${s.label}</div>
                <div class="char-details-value">${s.value}</div>
            </div>
        `).join('') || `<div style="color: var(--text-muted); font-style: italic; text-align: center; padding: var(--space-xl);">No detail records found.</div>`;

    return `
        <div class="char-citizen-card ${isHorizontal || isPlayer ? 'char-card-horizontal' : ''}" 
             data-search="${char.name} ${char.capsule.aliases || ''} ${char.capsule.biography || char.capsule.brief || ''}" 
             style="--local-accent: ${accentColor}; ${isDead ? 'opacity: 0.6;' : ''}">
            <div class="char-card-main-sec">
                <div class="char-portrait-sec">
                    ${icon ? (() => {
                        return `<img src="${icon}" ${isDead ? 'style="filter: grayscale(100%);"' : ''}>`;
                    })() : `<div style="font-size: 3em; opacity: 0.2;">👤</div>`}
                </div>
                <div class="char-info-sec">
                    <div class="char-name-header">
                        <div>
                            <div class="char-name" ${isDead ? 'style="text-decoration: line-through;"' : ''}>${char.name}</div>
                            ${char.capsule.aliases ? `<div class="char-aliases">aka: ${char.capsule.aliases}</div>` : ''}
                        </div>
                        <div class="char-badges">
                            ${isDead ? `<div class="char-badge">DECEASED</div>` : ''}
                            <div class="char-badge" style="border-color: var(--local-accent); color: var(--local-accent);">
                                ${isPlayer ? 'PROTAGONIST' : (isFull ? 'CORE' : 'MAJOR')}
                            </div>
                        </div>
                    </div>
                    <div class="char-brief">
                        ${char.capsule.biography || char.capsule.brief || 'No summary available.'}
                    </div>
                    ${!isPlayer && char.capsule.current_context ? `
                        <div class="char-current-context">
                            <b>📍 CURRENT:</b> ${char.capsule.current_context}
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <input type="checkbox" id="toggle-${detailsId}" class="toggle-checkbox" style="display: none;">
            
            <label for="toggle-${detailsId}" class="char-expand-btn">
                SHOW FULL RECORD <span class="toggle-icon">▼</span>
            </label>
            
            <div id="${detailsId}" class="char-details-content">
                ${innerHtml}
            </div>
        </div>
    `;
}

function renderSingleProfileModal(char, icon, accentColor, schemaFields = [], _projectName) {
    const isPlayer = char.isPlayer;
    const isFull = char.type === 'full';
    const isDead = char.capsule.status === 'DEAD';

    const sections = [{ label: 'Aliases', value: char.capsule.aliases }];

    if (schemaFields && schemaFields.length > 0) {
        schemaFields.forEach(f => {
            if (char.capsule[f.id] && char.capsule[f.id] !== 'N/A') {
                sections.push({ label: f.label, value: char.capsule[f.id] });
            }
        });
        // Brief fallback for modal as well
        if (!char.capsule.biography && char.capsule.brief && !sections.find(s => s.label === 'HIGH-LEVEL SUMMARY')) {
            sections.push({ label: 'Summary', value: char.capsule.brief });
        }
    } else {
        if (char.capsule.biography) sections.push({ label: 'Biography', value: char.capsule.biography });
        if (char.capsule.brief) sections.push({ label: 'Brief', value: char.capsule.brief });
        if (char.capsule.personality_profile) sections.push({ label: 'Personality', value: char.capsule.personality_profile });
        if (char.capsule.current_context) sections.push({ label: 'Current Context', value: char.capsule.current_context });
        if (char.capsule.background_history) sections.push({ label: 'Lore', value: char.capsule.background_history });
    }

    const fullSheetHtml = sections
        .filter(s => s.value && !(isPlayer && s.label === 'Current Context'))
        .map(s => `
            <div class="char-details-section" style="margin-bottom: var(--space-lg); padding-bottom: var(--space-md);">
                <div class="char-details-label" style="font-size: var(--font-size-sm);">${s.label}</div>
                <div class="char-details-value" style="font-size: var(--font-size-md);">${s.value}</div>
            </div>
        `).join('');

    return `
        <div class="profile-modal-container" style="--local-accent: ${accentColor};">
            <div class="profile-header-card">
                <div class="profile-portrait-large">
                    ${icon ? (() => {
                        return `<img src="${icon}" ${isDead ? 'style="filter: grayscale(100%);"' : ''}>`;
                    })() : `<div style="font-size: 4em; opacity: 0.2;">👤</div>`}
                </div>
                <div class="profile-info">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <h1 class="profile-name" ${isDead ? 'style="text-decoration: line-through;"' : ''}>${char.name.toUpperCase()}</h1>
                        <div class="char-badges">
                            ${isDead ? `<div class="char-badge">DECEASED</div>` : ''}
                            <div class="char-badge" style="border-color: var(--local-accent); color: var(--local-accent); border-radius: var(--radius-md); padding: 4px 12px;">
                                ${isPlayer ? 'PROTAGONIST' : (isFull ? 'CORE CHARACTER' : 'MAJOR CHARACTER')}
                            </div>
                        </div>
                    </div>
                    <p class="profile-bio">${char.capsule.biography || char.capsule.brief}</p>
                </div>
            </div>
            <div style="padding: 0 var(--space-sm);">
                ${fullSheetHtml}
            </div>
        </div>
    `;
}

module.exports = { renderHudSection, renderManualEditor, renderCharacterCard, renderSingleProfileModal };
