// engine/plugins/relationship_tracker/timeline/bonds_provider.js

const logic = require('../logic.js');

const bondsProvider = {
    type: 'branch',
    side: 'right',
    fn: async (turnContext, tools) => {
        const projectName = turnContext.projectName;
        if (!projectName) return null;
        const factsScope = tools.facts.getScope();
        const targetTurn = turnContext.turnNumber;
        const targetTurnKey = factsScope?.turn_key || String(targetTurn || 0);

        try {
            // 1. Fetch all relationship shifts that happened EXACTLY on this turn
            const turnShifts = await tools.db.chat.query(
                `SELECT source, target, predicate, SUM(fact_value) as delta, MAX(context) as brief
                 FROM facts 
                 WHERE project_name = ? AND turn_key = ?
                 AND predicate LIKE 'relationship_%' 
                 AND predicate NOT IN ('relationship_origin', 'relationship_history_summary')
                 GROUP BY source, target, predicate`,
                [projectName.toLowerCase(), targetTurnKey]
            );

            if (!turnShifts || turnShifts.length === 0) return null;

            // 2. Group by character pair
            const pairActivity = {};
            for (const shift of turnShifts) {
                const [p1, p2] = [shift.source.toLowerCase(), shift.target.toLowerCase()].sort();
                const pairKey = `${p1}|${p2}`;
                if (!pairActivity[pairKey]) {
                    pairActivity[pairKey] = {
                        charA: p1,
                        charB: p2,
                        deltas: {},
                        brief: shift.brief && shift.brief !== 'Scene-based change' ? shift.brief : null
                    };
                }
                // If the first grouped metric had no context, recover from a later metric row.
                if (!pairActivity[pairKey].brief && shift.brief && shift.brief !== 'Scene-based change') {
                    pairActivity[pairKey].brief = shift.brief;
                }
                const vector = shift.predicate.replace('relationship_', '');
                pairActivity[pairKey].deltas[vector] = (pairActivity[pairKey].deltas[vector] || 0) + shift.delta;
            }

            // 3. For each active pair, get their cumulative state AS OF this turn to determine Archetype
            const allStates = await logic.getCurrentRelationshipStates(tools, projectName, targetTurn);

            // 4. Fetch rolling summaries for this turn
            const histories = await tools.db.chat.query(
                `SELECT source, target, context FROM facts 
                 WHERE project_name = ? AND turn_key = ? AND predicate = 'relationship_history_summary'`,
                [projectName.toLowerCase(), targetTurnKey]
            );
            const pairSummaries = {};
            for (const hist of histories) {
                const [p1, p2] = [hist.source.toLowerCase(), hist.target.toLowerCase()].sort();
                pairSummaries[`${p1}|${p2}`] = hist.context;
            }

            const children = [];
            for (const key in pairActivity) {
                const act = pairActivity[key];
                const stats = allStates[act.charA]?.[act.charB] || {};

                // Determine dominant vector and archetype
                const dominant = Object.entries(stats).reduce((a, b) => b[1] > a[1] ? b : a, ['friendship', 0]);
                const archetypeResult = logic.evaluatePairDynamicDetailed ? logic.evaluatePairDynamicDetailed(act.charA, act.charB, stats) : null;
                const archetype = archetypeResult ? archetypeResult.archetype : 'Acquaintances';
                const score = dominant[1];
                const absScore = Math.abs(score);

                // Aesthetics
                const colors = { friendship: '#4caf50', romance: '#e91e63', trust: '#2196f3', fear: '#9c27b0', respect: '#ffc107' };
                const color = colors[dominant[0]] || '#ffffff';

                let fullChar = '◆'; let emptyChar = '◇';
                if (dominant[0] === 'romance' && score > 0) { fullChar = '❤'; emptyChar = '🖤'; }
                else if (dominant[0] === 'fear' && score > 20) { fullChar = '💀'; emptyChar = '◇'; }
                else if (dominant[0] === 'friendship' && score < -20) { fullChar = '⚔'; emptyChar = '◇'; }
                else if (dominant[0] === 'respect' && score > 50) { fullChar = '🎖'; emptyChar = '◇'; }

                let pipCount = absScore > 80 ? 5 : absScore > 60 ? 4 : absScore > 40 ? 3 : absScore > 20 ? 2 : 1;
                const pips = `<span style="color: ${color}; letter-spacing: 1px;">` + fullChar.repeat(pipCount) + '</span>' +
                    `<span style="color: rgba(var(--color-white-rgb),0.1); letter-spacing: 1px;">` + emptyChar.repeat(5 - pipCount) + '</span>';

                const displayName = act.charA.charAt(0).toUpperCase() + act.charA.slice(1) + ' & ' +
                    act.charB.charAt(0).toUpperCase() + act.charB.slice(1);

                // Score Deltas Breakdown
                const deltaLines = Object.entries(act.deltas).map(([vector, delta]) => {
                    const vColor = colors[vector] || '#fff';
                    const symbol = delta > 0 ? '+' : '';
                    return `<span style="color: ${vColor}; margin-right: 8px;">${vector.charAt(0).toUpperCase() + vector.slice(1)}: ${symbol}${delta.toFixed(1)}</span><br>`;
                }).join('');

                children.push({
                    title: displayName,
                    text: `
                        <div class="rel-shift-card" style="--local-accent: ${color};">
                            <div class="rel-shift-header">
                                <div class="rel-shift-archetype">
                                    <span>${archetype}</span>
                                </div>
                                <div style="font-size: 1.1em;">${pips}</div>
                            </div>
                            ${act.brief ? `<div class="rel-shift-brief">"${act.brief}"</div>` : ''}
                            <div class="rel-shift-deltas">
                                ${deltaLines}
                            </div>
                        </div>
                    `
                });
            }

            // Collect rolling summaries into a single consolidated array
            const summaries = [];
            for (const key in pairActivity) {
                const act = pairActivity[key];
                const rollingSummary = pairSummaries[key];
                if (rollingSummary) {
                    const displayName = act.charA.charAt(0).toUpperCase() + act.charA.slice(1) + ' & ' +
                        act.charB.charAt(0).toUpperCase() + act.charB.slice(1);
                    summaries.push({ title: displayName, text: rollingSummary });
                }
            }

            const subtext = `${children.length} dynamic relationship shift${children.length > 1 ? 's' : ''}.`;

            return {
                id: 'relationships',
                icon: '👥',
                title: 'Relationship Shifts',
                label: 'Bonds',
                content: subtext,
                children: children,
                summaries: summaries.length > 0 ? summaries : undefined
            };

        } catch (e) {
            tools.logger.error('Timeline', 'Failed to fetch relationship activity: ' + e.message);
            return null;
        }
    }
};

module.exports = bondsProvider;
