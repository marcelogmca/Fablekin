// engine/plugins/relationship_tracker/logic/archetypes.js

const { CONFIG_DEFAULTS } = require('./config');
const { getRelationshipLabel } = require('./scoring');

/**
 * THE ARCHETYPE ENGINE
 * Determines the narrative texture of the relationship based on vector combinations.
 */
function evaluatePairDynamic(charA, charB, stats) {
    const detailed = evaluatePairDynamicDetailed(charA, charB, stats);
    if (!detailed) return null;
    return `**${charA} & ${charB}** [${detailed.archetype}]: ${detailed.guidance}`;
}

function evaluatePairDynamicDetailed(charA, charB, stats) {
    const T = CONFIG_DEFAULTS.THRESHOLDS;

    const friend = stats.friendship || 0;
    const romance = stats.romance || 0;
    const trust = stats.trust || 0;
    const fear = stats.fear || 0;
    const respect = stats.respect || 0;

    let archetype = '';
    let guidance = '';

    // --- 1. COMPLEX SYMMETRICAL DYNAMICS ---
    if (friend >= T.HIGH_POS && trust >= T.HIGH_POS && romance < T.LOW_POS) {
        archetype = `Unshakable Comrades`;
        guidance = `Deep mutual reliance and absolute trust. Physical closeness is natural but viewed as platonic. Flirting is allowed but will likely be interpreted as teasing or 'battle-banter'.`;
    }
    else if (friend < T.LOW_POS && respect >= T.HIGH_POS) {
        archetype = `Honorable Rivals`;
        guidance = `They may oppose one another, but share a profound mutual respect. Dialogue is professional and competitive.`;
    }
    else if (friend >= T.LOW_POS && trust <= T.LOW_NEG) {
        archetype = `Uneasy Alliance`;
        guidance = `They work together on the surface, but remain deeply suspicious of motives.`;
    }
    else if (friend >= T.NEUTRAL && friend < T.MID_POS && respect >= T.MID_POS) {
        archetype = `Professional / Duty-Bound`;
        guidance = `Formal and respectful. Emotions are guarded. Interactions focus on the task or duty.`;
    }
    // --- 2. ROMANCE PROGRESSION ---
    else if (romance >= T.HIGH_POS && trust >= T.HIGH_POS) {
        archetype = `Soulmates`;
        guidance = `Deeply committed and synchronized. Affection is open and assumed.`;
    }
    else if (romance >= T.MID_POS) {
        archetype = `Blossoming Romance`;
        guidance = `Romantic tension is palpable. Flirting is welcome and reciprocated.`;
    }
    else if (friend >= T.MID_POS && romance >= T.LOW_POS) {
        archetype = `Close Friends / Crush`;
        guidance = `Close friends with an undercurrent of attraction.`;
    }
    // --- 3. BASE STATES (Fallbacks) ---
    else if (friend <= T.HIGH_NEG || trust <= T.HIGH_NEG) {
        archetype = `Bitter Enemies`;
        guidance = `Open hostility. Interactions are aggressive or venomous.`;
    }
    else if (friend <= T.LOW_NEG) {
        archetype = `Antagonistic`;
        guidance = `Constant friction, sarcasm, and lack of cooperation.`;
    }
    else if (fear >= T.MID_POS) {
        archetype = `Fear-Based Bond`;
        guidance = `The relationship is defined by intimidation and power dynamics. Interactions are guarded and tense.`;
    }
    else if (friend >= T.MID_POS) {
        archetype = `Close Friends`;
        guidance = `Comfortable and casual. A safe space for both characters.`;
    }
    else {
        archetype = `Acquaintances`;
        guidance = `Polite but distant. No established bond.`;
    }

    if (!archetype) return null;

    return {
        archetype,
        guidance,
        isHighlyAsymmetric: false
    };
}

/**
 * Identifies the dominant vector for a specific character's feelings using
 * a narrative weighting system.
 */
function getDominantVector(stats) {
    const weights = {
        romance: 1.6,
        fear: 1.4,
        trust: 1.1,
        respect: 1.0,
        friendship: 0.9
    };

    let maxWeightedScore = -1;
    let dominant = 'friendship';

    for (const vector in stats) {
        const val = Math.abs(stats[vector]);
        const weight = weights[vector] || 1.0;
        const weightedScore = val * weight;

        if (weightedScore > maxWeightedScore) {
            maxWeightedScore = weightedScore;
            dominant = vector;
        }
    }

    if (stats.romance > 15 && dominant !== 'romance' && dominant !== 'fear') {
        if ((stats.romance * weights.romance) > (stats[dominant] * weights[dominant] * 0.7)) {
            dominant = 'romance';
        }
    }

    return {
        vector: dominant,
        score: stats[dominant] || 0,
        label: getRelationshipLabel(stats[dominant] || 0, dominant)
    };
}

module.exports = {
    evaluatePairDynamic,
    evaluatePairDynamicDetailed,
    getDominantVector
};
