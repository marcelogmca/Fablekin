// engine/plugins/relationship_tracker/logic/scoring.js

const { CONFIG_DEFAULTS } = require('./config');

/**
 * Gets the descriptive label for a relationship score for a specific vector.
 */
function getRelationshipLabel(score, vector) {
    const vectorMap = CONFIG_DEFAULTS.RELATIONSHIP_VECTOR_MAP[vector];
    if (!vectorMap) return 'Unknown';

    let bestLabel = vectorMap['0'].label;
    let closestScore = -Infinity;

    for (const key in vectorMap) {
        const mapScore = parseInt(key, 10);
        if (score >= mapScore && mapScore > closestScore) {
            closestScore = mapScore;
            bestLabel = vectorMap[key].label;
        }
    }
    return bestLabel;
}

/**
 * Calculates a dynamic multiplier for relationship changes based on a "tilted bell curve".
 * - Hard to start (0-20)
 * - Easy in the middle (20-70)
 * - Very hard at the end (80-120)
 * Supports negative relationships symmetrically.
 */
function getRelationshipCurveMultiplier(currentScore, delta) {
    if ((currentScore > 0 && delta < 0) || (currentScore < 0 && delta > 0)) {
        return 1.2;
    }

    const absScore = Math.abs(currentScore);

    if (absScore >= 120) return 0.05;

    let multiplier = 1.0;

    if (absScore <= 20) {
        multiplier = 0.5 + (absScore / 20) * 0.5;
    } else if (absScore <= 70) {
        const h = 45;
        const k = 1.2;
        const a = 0.00032;
        multiplier = Math.max(0.5, -a * Math.pow(absScore - h, 2) + k);
    } else {
        const progress = (absScore - 70) / 50;
        multiplier = Math.max(0.05, 1.0 - Math.pow(progress, 2) * 0.95);
    }

    return multiplier;
}

/**
 * Generates a detailed markdown guide of the relationship scoring system.
 */
function generateRelationshipScoringGuide() {
    let guide = '### Relationship Vector Scoring Guide\n\n';
    const vectorMap = CONFIG_DEFAULTS.RELATIONSHIP_VECTOR_MAP;

    for (const vector in vectorMap) {
        guide += `## ${vector.charAt(0).toUpperCase() + vector.slice(1)}\n\n`;
        const scores = vectorMap[vector];
        const sortedKeys = Object.keys(scores).sort((a, b) => parseInt(b) - parseInt(a));

        for (const score of sortedKeys) {
            const details = scores[score];
            guide += `### Score: ${score} - ${details.label}\n`;
            guide += `**Description:** ${details.description}\n\n`;
        }
    }
    return guide;
}

module.exports = {
    getRelationshipLabel,
    getRelationshipCurveMultiplier,
    generateRelationshipScoringGuide
};
