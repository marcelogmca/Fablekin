// engine/plugins/relationship_tracker/sockets/hud_listener.js

const logic = require('../logic.js');

async function fetchProcessedBonds(data, tools) {
    const turnNumber = data?.turnNumber;
    const context = tools.turnContext;
    const projectName = context?.projectName;
    if (!projectName) return null;

    let playerName = context?.input?.playerCharacterName;
    if (!playerName) {
        try {
            const rows = await tools.db.project.query("SELECT setting_value FROM project_settings WHERE setting_key = 'player_character_name'");
            if (rows && rows.length > 0) playerName = rows[0].setting_value;
        } catch { }
    }

    let party = [];
    let characterIcons = {};
    let prominentCharacters = [];
    let targetTurn = turnNumber;

    if (turnNumber !== undefined) {
        try {
            const resolvedTurn = await tools.turns.get(turnNumber);
            const output = resolvedTurn?.output || {};
            party = output.party || [];
            characterIcons = output.characterIcons || {};
            prominentCharacters = output.prominentCharacters || [];
            targetTurn = resolvedTurn?.turnNumber || turnNumber;
        } catch { }
    } else {
        party = context?.output?.party || [];
        characterIcons = context?.output?.characterIcons || {};
        prominentCharacters = context?.output?.prominentCharacters || [];

        if (party.length === 0 || Object.keys(characterIcons).length === 0) {
            const charactersSet = new Set();
            if (playerName && playerName !== 'None') charactersSet.add(playerName.toLowerCase());
            try {
                const latestTurn = await tools.turns.getLatest();
                const latestOutput = latestTurn?.output || {};
                if (latestOutput.party) latestOutput.party.forEach(char => charactersSet.add(char.toLowerCase()));
                if (latestOutput.characterIcons) Object.assign(characterIcons, latestOutput.characterIcons);
                if (latestOutput.prominentCharacters) prominentCharacters = latestOutput.prominentCharacters;
            } catch { }
            party = Array.from(charactersSet);
        }
    }

    const liveIcons = context?.output?.characterIcons || {};
    for (const key in liveIcons) {
        if (!characterIcons[key]) characterIcons[key] = liveIcons[key];
    }

    const normalizedIcons = {};
    for (const key in characterIcons) normalizedIcons[key.toLowerCase()] = characterIcons[key];

    const effectiveTurn = Number(targetTurn) || Number(context?.turnNumber) || Number.MAX_SAFE_INTEGER;
    const coreNames = new Set();
    try {
        const rows = await tools.db.chat.query(
            `SELECT source, fact_value, turn_number
             FROM facts
             WHERE project_name = ? AND predicate = 'IMPORTANCE' AND turn_number <= ?
             ORDER BY turn_number DESC`,
            [projectName.toLowerCase(), effectiveTurn]
        );
        const resolvedSources = new Set();
        for (const row of rows || []) {
            const source = String(row?.source || '').toLowerCase();
            if (!source || resolvedSources.has(source)) continue;
            resolvedSources.add(source);
            if (String(row?.fact_value || '').toUpperCase() === 'CORE') coreNames.add(source);
        }
    } catch { }

    const states = await logic.getCurrentRelationshipStates(tools, projectName, targetTurn);
    if (!states) return null;

    const playerBonds = [];
    const worldDynamics = [];

    const allSources = Object.keys(states);
    const lowerPlayerName = (playerName || 'player').toLowerCase();
    const playerKey = allSources.find(s => s.toLowerCase() === lowerPlayerName) || lowerPlayerName;

    const lowerParty = party.map(p => p.toLowerCase());
    const lowerProminent = (prominentCharacters || []).map(p => p.toLowerCase());

    const processedPairs = new Set();

    for (const charA of allSources) {
        for (const charB in states[charA]) {
            if (charA.toLowerCase() === charB.toLowerCase()) continue;

            const [p1, p2] = logic.getSymmetricalPair ? logic.getSymmetricalPair(charA, charB) : [charA.toLowerCase(), charB.toLowerCase()].sort();
            const pairKey = `${p1}|${p2}`;
            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const stats = states[charA][charB] || {};
            const detailed = logic.evaluatePairDynamicDetailed(charA, charB, stats);
            const dominant = logic.getDominantVector(stats);
            const significance = Math.max(...Object.values(stats).map(val => Math.abs(val)));

            const rawIconA = normalizedIcons[charA.toLowerCase()];
            const rawIconB = normalizedIcons[charB.toLowerCase()];

            const relObject = {
                charA,
                charB,
                iconA: rawIconA ? tools.assets.resolveUrl(rawIconA, { kind: 'sprites' }) : '',
                iconB: rawIconB ? tools.assets.resolveUrl(rawIconB, { kind: 'sprites' }) : '',
                archetype: detailed ? detailed.archetype : 'Acquaintances',
                guidance: detailed ? detailed.guidance : 'An established bond.',
                dominant,
                stats,
                significance
            };

            const isPlayerInvolved = (charA.toLowerCase() === playerKey.toLowerCase() || charB.toLowerCase() === playerKey.toLowerCase());

            if (isPlayerInvolved) {
                const targetName = charA.toLowerCase() === playerKey.toLowerCase() ? charB : charA;
                const lowerTarget = targetName.toLowerCase();

                const inParty = lowerParty.includes(lowerTarget);
                const prominenceIndex = lowerProminent.indexOf(lowerTarget);

                const relevanceScore = logic.calculateRelationshipRelevance(stats, {
                    inParty,
                    prominenceIndex,
                    totalProminent: lowerProminent.length
                });

                relObject.displayName = targetName.toUpperCase();
                relObject.targetName = targetName;
                const rawTargetIcon = charA.toLowerCase() === playerKey.toLowerCase() ? relObject.iconB : relObject.iconA;
                relObject.targetIcon = rawTargetIcon || '';
                relObject.relevance = relevanceScore;
                relObject.inParty = inParty;
                relObject.isCore = coreNames.has(lowerTarget);
                relObject.partyIndex = lowerParty.indexOf(lowerTarget);

                playerBonds.push(relObject);
            } else {
                const bothInParty = lowerParty.includes(charA.toLowerCase()) && lowerParty.includes(charB.toLowerCase());
                if (significance >= 30 || bothInParty) {
                    relObject.displayName = `${charA.toUpperCase()} ⇿ ${charB.toUpperCase()}`;
                    worldDynamics.push(relObject);
                }
            }
        }
    }

    playerBonds.sort((a, b) => b.relevance - a.relevance);
    worldDynamics.sort((a, b) => b.significance - a.significance);

    const tier1Bonds = playerBonds.slice(0, 3);
    const hudBonds = playerBonds
        .filter(rel => rel.inParty || rel.isCore)
        .sort((a, b) => {
            const aParty = a.partyIndex >= 0 ? a.partyIndex : Number.MAX_SAFE_INTEGER;
            const bParty = b.partyIndex >= 0 ? b.partyIndex : Number.MAX_SAFE_INTEGER;
            return aParty - bParty || Number(b.isCore) - Number(a.isCore) || b.relevance - a.relevance;
        });
    const tier2Contacts = playerBonds.slice(3, 9);
    const displayedWorldDynamics = worldDynamics.slice(0, 6);

    return {
        tier1Bonds,
        hudBonds,
        tier2Contacts,
        displayedWorldDynamics,
        allBonds: playerBonds,
        allWorldDynamics: worldDynamics,
        totalCount: playerBonds.length + worldDynamics.length
    };
}

const hudListener = async (data, tools) => {
    const processed = await fetchProcessedBonds(data, tools);
    if (!processed) return;

    const { hudBonds, totalCount } = processed;
    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const pipCount = score => {
        const value = Math.abs(Number(score) || 0);
        return value > 80 ? 5 : value > 60 ? 4 : value > 40 ? 3 : value > 20 ? 2 : 1;
    };
    const pipSymbols = (vector, score) => {
        if (vector === 'romance' && score > 0) return { full: '❤', empty: '🖤' };
        if (vector === 'fear' && score > 20) return { full: '💀', empty: '◇' };
        if (vector === 'friendship' && score < -20) return { full: '⚔', empty: '◇' };
        if (vector === 'respect' && score > 50) return { full: '🎖', empty: '◇' };
        return { full: '◆', empty: '◇' };
    };
    const bondHtml = hudBonds.map(rel => {
        const vector = String(rel.dominant?.vector || 'neutral').toLowerCase();
        const score = Number(rel.dominant?.score) || 0;
        const count = pipCount(score);
        const symbols = pipSymbols(vector, score);
        const filterPayload = escapeHtml(JSON.stringify({ filter: rel.targetName || rel.displayName || '' }));
        const icon = rel.targetIcon
            ? `<img class="rel-hud-avatar" src="${escapeHtml(rel.targetIcon)}" alt="">`
            : `<span class="rel-hud-avatar rel-hud-avatar-fallback">${escapeHtml(rel.displayName || '?').charAt(0)}</span>`;
        return `
            <button type="button" class="rel-hud-bond rel-vector-${escapeHtml(vector)} hud-socket-emit"
                    data-event="relationship-tracker-request-full-registry" data-payload="${filterPayload}"
                    aria-label="Open relationships for ${escapeHtml(rel.targetName || rel.displayName || 'character')}">
                ${icon}
                <div class="rel-hud-copy">
                    <strong>${escapeHtml(rel.displayName || 'Unknown')}</strong>
                    <span>${escapeHtml(rel.archetype || vector)}</span>
                </div>
                <span class="rel-hud-pips" aria-label="Relationship strength ${count} of 5"><span class="rel-hud-pips-filled">${symbols.full.repeat(count)}</span><span class="rel-hud-pips-empty">${symbols.empty.repeat(5 - count)}</span></span>
            </button>
        `;
    }).join('');

    const html = `
        <div class="rel-hud-container">
            <div class="rel-hud-heading">
                <span class="rel-hud-heading-mark" aria-hidden="true"></span>
                <span>Party Bonds</span>
                <button type="button" class="hud-socket-emit rel-hud-registry-link"
                        data-event="relationship-tracker-request-full-registry" data-payload="{}"
                        aria-label="Open relationship registry">
                    All bonds <strong>${totalCount}</strong><span aria-hidden="true">↗</span>
                </button>
            </div>
            ${bondHtml || '<p class="rel-hud-empty">No party relationships established yet.</p>'}
        </div>
    `;

    tools.socket.emit('vn-hud-update-section', {
        id: 'relationships',
        pluginId: 'relationship_tracker',
        title: 'Relationships',
        icon: '',
        controlIcon: '∞',
        controlLabel: 'Party Bonds',
        priority: 20,
        dock: 'ambient-left',
        defaultOpen: true,
        html: html
    });
};

module.exports = {
    hudListener,
    fetchProcessedBonds
};
