// engine/plugins/relationship_tracker/commands/rel_command.js

const logic = require('../logic.js');

const relCommand = {
    description: 'Inspect character relationships. Usage: /rel [subcommand] [target] [turn_selector]',
    run: async (args, tools) => {
        const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'help') {
            return `\r\n${colors.bright}Relationship Tracker Toolkit${colors.reset}\r\n` +
                `Usage: /rel ${colors.cyan}[subcommand]${colors.reset} ${colors.yellow}[target]${colors.reset} ${colors.magenta}[turn_selector]${colors.reset}\r\n\r\n` +
                `${colors.bright}Subcommands:${colors.reset}\r\n` +
                `  ${colors.cyan}list${colors.reset}       - List all relationship states currently tracked.\r\n` +
                `  ${colors.cyan}inspect${colors.reset}    - Show detailed shift history and bond pulse for a pair.\r\n\r\n` +
                `${colors.bright}Parameters:${colors.reset}\r\n` +
                `  ${colors.yellow}[target]${colors.reset}         - Name of a character or a pair (e.g. "Candace", "A|B").\r\n` +
                `  ${colors.magenta}[turn_selector]${colors.reset}  - History navigation. Use ${colors.bright}N${colors.reset} for limit or ${colors.bright}X-Y${colors.reset} for a range.\r\n\r\n` +
                `${colors.bright}Examples:${colors.reset}\r\n` +
                `  /rel list\r\n` +
                `  /rel inspect arthur 10\r\n` +
                `  /rel inspect arthur|merlin 1-15\r\n`;
        }

        let selector = args[1]; // Usually the selector
        if (subcommand === 'inspect' && args[3] && !isNaN(parseInt(args[3]))) selector = args[3];
        else if (subcommand === 'inspect' && args[2] && !isNaN(parseInt(args[2]))) selector = args[2];
        else if (subcommand === 'list' && args[1] && !isNaN(parseInt(args[1]))) selector = args[1];
        else if (subcommand !== 'inspect' && subcommand !== 'list') selector = subcommand; // handle direct /rel [selector]

        const projectName = tools.turnContext.projectName;

        // Parse Range/Limit
        let startTurn, endTurn, isRange = false;
        const latestTurn = tools.turnContext.turnNumber || 1;

        if (selector && typeof selector === 'string' && selector.includes('-')) {
            [startTurn, endTurn] = selector.split('-').map(n => parseInt(n));
            isRange = true;
        } else {
            const limit = (selector && !isNaN(parseInt(selector))) ? parseInt(selector) : 1;
            startTurn = Math.max(1, latestTurn - limit + 1);
            endTurn = latestTurn;
        }

        if (subcommand === 'list') {
            const states = await logic.getCurrentRelationshipStates(tools, projectName, endTurn);
            if (!states || Object.keys(states).length === 0) return `No relationships found at Turn ${endTurn}.`;

            let output = `\r\n\x1b[1;32mRelationship Status at Turn ${endTurn}:\x1b[0m\r\n`;
            const pairsSeen = new Set();

            for (const charA in states) {
                for (const charB in states[charA]) {
                    const pair = [charA, charB].sort().join('|');
                    if (pairsSeen.has(pair)) continue;
                    pairsSeen.add(pair);

                    const stats = states[charA][charB];
                    const dominant = logic.getDominantVector(stats);
                    const detailed = logic.evaluatePairDynamicDetailed(charA, charB, stats);

                    output += `  \x1b[1;36m${charA.toUpperCase()} ⇿ ${charB.toUpperCase()}\x1b[0m: ${detailed.archetype}\r\n`;
                    output += `    \x1b[0;90mDominant: ${dominant.label} (${dominant.vector})\x1b[0m\r\n`;
                }
            }
            return output;
        } else if (subcommand === 'inspect') {
            let charA = args[1]?.toLowerCase();
            let charB = args[2]?.toLowerCase();

            // Handle pipe-separated pair syntax: /rel inspect charA|charB 1-15
            if (charA && charA.includes('|')) {
                const parts = charA.split('|');
                charA = parts[0];
                charB = parts[1];
            }

            if (!charA || !charB) return 'Usage: /rel inspect <charA> <charB> [turn_selector] OR /rel inspect <charA|charB> [turn_selector]';

            let output = `\r\n\x1b[1;32mInspecting Relationship: ${charA.toUpperCase()} ⇿ ${charB.toUpperCase()}\x1b[0m\r\n`;

            if (isRange) {
                // Show all changes in range
                const shifts = await tools.db.chat.query(
                    `SELECT turn_number, predicate, fact_value as delta, context 
                     FROM facts 
                     WHERE project_name = ? AND source = ? AND target = ? 
                     AND predicate LIKE 'relationship_%' AND turn_number BETWEEN ? AND ?
                     ORDER BY turn_number ASC`,
                    [projectName.toLowerCase(), charA < charB ? charA : charB, charA < charB ? charB : charA, startTurn, endTurn]
                );

                if (!shifts || shifts.length === 0) return `No shifts recorded for this pair between Turn ${startTurn} and ${endTurn}.`;

                output += `\x1b[1;33mHistorical Shifts (Turns ${startTurn}-${endTurn}):\x1b[0m\r\n`;
                shifts.forEach(s => {
                    const deltaVal = parseFloat(s.delta || 0);
                    const vector = s.predicate.replace('relationship_', '');
                    const sign = deltaVal > 0 ? '+' : '';
                    const color = deltaVal > 0 ? '\x1b[1;32m' : '\x1b[1;31m';
                    output += `  [Turn ${s.turn_number}] \x1b[1;36m${vector}\x1b[0m: ${color}${sign}${deltaVal.toFixed(1)}\x1b[0m`;
                    if (s.context && s.context !== 'Initial relationship vector') {
                        output += `\r\n    \x1b[0;90m"${s.context}"\x1b[0m`;
                    }
                    output += '\r\n';
                });
                return output;
            } else {
                // Show detailed state at specific turn
                const states = await logic.getCurrentRelationshipStates(tools, projectName, endTurn);
                const stats = states[charA]?.[charB];
                if (!stats) return `No relationship data found for ${charA} and ${charB} at Turn ${endTurn}.`;

                const detailed = logic.evaluatePairDynamicDetailed(charA, charB, stats);
                output += `\x1b[1;33mCurrent Dynamic:\x1b[0m ${detailed.archetype}\r\n`;
                output += `\x1b[1;33mGuidance:\x1b[0m \x1b[0;90m${detailed.guidance}\x1b[0m\r\n\r\n`;
                output += `\x1b[1;33mVector Scores:\x1b[0m\r\n`;

                const vectors = ['friendship', 'romance', 'trust', 'fear', 'respect'];
                vectors.forEach(v => {
                    const score = stats[v] || 0;
                    const label = logic.getRelationshipLabel(score, v);
                    const sign = score > 0 ? '+' : '';
                    output += `  \x1b[1;36m${(v + ':').padEnd(12)}\x1b[0m ${sign}${score.toFixed(1).padStart(5)} [${label}]\r\n`;
                });
                return output;
            }
        }

        return 'Unknown subcommand. Use /rel [list|inspect]';
    }
};

module.exports = relCommand;
