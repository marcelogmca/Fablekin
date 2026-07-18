// engine/plugins/relationship_tracker/logic/config.js

const CONFIG_DEFAULTS = {
    THRESHOLDS: {
        EXTREME_POS: 80,
        HIGH_POS: 60,
        MID_POS: 30,
        LOW_POS: 10,
        NEUTRAL: 0,
        LOW_NEG: -10,
        MID_NEG: -30,
        HIGH_NEG: -60,
        EXTREME_NEG: -80
    },
    ASYMMETRY_THRESHOLD: 30, // Gap required to trigger "One-sided" logic
    RELATIONSHIP_VECTOR_MAP: {
        friendship: {
            '100': { label: 'Inseparable', description: 'A bond of absolute platonic love and loyalty.' },
            '80': { label: 'Best Friends', description: 'A deep, trusting friendship.' },
            '60': { label: 'Close Friends', description: 'A strong, reliable friendship.' },
            '30': { label: 'Friends', description: 'A positive, friendly relationship.' },
            '10': { label: 'Friendly', description: 'Warm and amicable.' },
            '0': { label: 'Neutral', description: 'No particular feelings of friendship or animosity.' },
            '-10': { label: 'Distant', description: 'Cool and somewhat unfriendly.' },
            '-30': { label: 'Dislikes', description: 'A general feeling of dislike.' },
            '-60': { label: 'Hostile', description: 'Overtly hostile and unfriendly.' },
            '-80': { label: 'Enemies', description: 'A deep-seated hatred.' },
            '-100': { label: 'Mortal Enemies', description: 'An all-consuming hatred.' }
        },
        romance: {
            '100': { label: 'Passionate Lovers', description: 'An intense, all-consuming romantic love.' },
            '80': { label: 'Soulmates', description: 'A deep, profound love and connection.' },
            '60': { label: 'Deeply in Love', description: 'Strong romantic feelings and commitment.' },
            '30': { label: 'Infatuated', description: 'Strong romantic interest and attraction.' },
            '10': { label: 'Attracted', description: 'Mild romantic or physical attraction.' },
            '0': { label: 'Platonic', description: 'No romantic feelings whatsoever.' },
            '-10': { label: 'Uninterested', description: 'Mild aversion to romantic involvement.' },
            '-30': { label: 'Averse', description: 'Active dislike of romantic prospects.' },
            '-60': { label: 'Repelled', description: 'Strongly repulsed by the idea of romance.' },
            '-80': { label: 'Hateful', description: 'Feels a deep-seated romantic animosity.' },
            '-100': { label: 'Repulsed', description: 'Finds the other person physically repulsive.' }
        },
        trust: {
            '100': { label: 'Unbreakable Bond', description: 'Absolute, unconditional trust.' },
            '80': { label: 'Confidante', description: 'A deep and abiding trust.' },
            '60': { label: 'Highly Trusted', description: 'A strong level of trust and reliability.' },
            '30': { label: 'Trusted', description: 'Generally trusts the person to be reliable.' },
            '10': { label: 'Reliable', description: 'Views the person as generally dependable.' },
            '0': { label: 'Guarded', description: 'Neither trusts nor particularly distrusts.' },
            '-10': { label: 'Skeptical', description: 'Mildly suspicious of their motives.' },
            '-30': { label: 'Distrustful', description: 'A general lack of trust.' },
            '-60': { label: 'Suspicious', description: 'Highly suspicious and wary.' },
            '-80': { label: 'Deceitful', description: 'Proven to be a liar and betrayer.' },
            '-100': { label: 'Absolute Betrayer', description: 'A history of profound betrayal.' }
        },
        fear: {
            '100': { label: 'Object of Nightmares', description: 'An all-consuming, paralyzing terror.' },
            '80': { label: 'Paralyzed by Fear', description: 'A deep, debilitating fear.' },
            '60': { label: 'Terrified', description: 'Strong fear and anxiety in their presence.' },
            '30': { label: 'Intimidated', description: 'Feels significantly intimidated.' },
            '10': { label: 'Nervous', description: 'Mildly anxious or uneasy.' },
            '0': { label: 'Unafraid', description: 'Feels completely at ease and safe.' },
            '-10': { label: 'Comfortable', description: 'Feels safe and relaxed.' },
            '-30': { label: 'Bold', description: 'Actively confronts or challenges them.' },
            '-60': { label: 'Disrespectful', description: 'Shows a lack of healthy caution.' },
            '-80': { label: 'Dismissive', description: 'Utterly non-threatening.' },
            '-100': { label: 'Contemptuously Fearless', description: 'Holds the person in such low regard.' }
        },
        respect: {
            '100': { label: 'Idolizes', description: 'Views the person as a perfect ideal.' },
            '80': { label: 'Reveres', description: 'A deep, profound respect.' },
            '60': { label: 'Highly Respected', description: 'Strong admiration and esteem.' },
            '30': { label: 'Respected', description: 'A general feeling of respect.' },
            '10': { label: 'Appreciated', description: 'Values their contributions or qualities.' },
            '0': { label: 'Indifferent', description: 'No particular respect or disrespect.' },
            '-10': { label: 'Dismissive', description: 'Tends to overlook or undervalue them.' },
            '-30': { label: 'Disrespectful', description: 'Shows a lack of proper respect.' },
            '-60': { label: 'Scornful', description: 'Active disrespect and mockery.' },
            '-80': { label: 'Disdains', description: 'A deep-seated feeling of contempt.' },
            '-100': { label: 'Utter Contempt', description: 'Absolute lack of respect.' }
        }
    }
};

module.exports = { CONFIG_DEFAULTS };
