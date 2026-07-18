// plugins/craft_guide/tags.js

/**
 * Tag taxonomy and category mappings for the Craft Guide plugin.
 */

const TAG_CATEGORIES = {
    // Primary
    'setup': 'Primary',
    'inciting_event': 'Primary',
    'rising_tension': 'Primary',
    'midpoint_shift': 'Primary',
    'pre_climax_pressure': 'Primary',
    'climax': 'Primary',
    'post_climax_release': 'Primary',
    'resolution': 'Primary',
    'epilogue_reflection': 'Primary',

    // Use Case
    'introduce_character': 'UseCase',
    'deepen_relationship': 'UseCase',
    'recover_after_climax': 'UseCase',
    'prepare_major_event': 'UseCase',
    'execute_major_event': 'UseCase',
    'deliver_reveal': 'UseCase',
    'slow_down_pacing': 'UseCase',
    'increase_tension': 'UseCase',
    'transition_between_arcs': 'UseCase',
    'establish_world_tone': 'UseCase',

    // Pacing
    'slow_burn': 'Pacing',
    'escalation_chain': 'Pacing',
    'burst_then_pause': 'Pacing',
    'sustained_tension': 'Pacing',
    'wave_pattern': 'Pacing',
    'delayed_payoff': 'Pacing',
    'sudden_spike': 'Pacing',
    'lingering_aftermath': 'Pacing',

    // Emotion
    'tension_building': 'Emotion',
    'emotional_release': 'Emotion',
    'melancholic_reflection': 'Emotion',
    'awe_wonder': 'Emotion',
    'intimacy_building': 'Emotion',
    'isolation_loneliness': 'Emotion',
    'hope_injection': 'Emotion',
    'dread_unease': 'Emotion',
    'bittersweet_resolution': 'Emotion',
    'comfort_slice_of_life': 'Emotion',

    // Information
    'direct_exposition': 'Information',
    'hidden_information': 'Information',
    'delayed_reveal': 'Information',
    'dramatic_irony': 'Information',
    'mystery_box': 'Information',
    'gradual_disclosure': 'Information',
    'misdirection': 'Information',
    'recontextualization': 'Information',

    // Character
    'bonding': 'Character',
    'conflict': 'Character',
    'power_shift': 'Character',
    'mentor_guidance': 'Character',
    'group_dynamic': 'Character',
    'solo_introspection': 'Character',
    'relationship_turning_point': 'Character',

    // Energy
    'high_intensity': 'Energy',
    'dialogue_heavy': 'Energy',
    'visually_driven': 'Energy',
    'quiet_minimal': 'Energy',
    'mixed': 'Energy',

    // Devices
    'contrast_pairing': 'Devices',
    'parallel_scenes': 'Devices',
    'callback_payoff': 'Devices',
    'foreshadowing': 'Devices',
    'reversal': 'Devices',
    'withholding': 'Devices',
    'silence_usage': 'Devices',
    'environmental_storytelling': 'Devices',
    'routine_grounding': 'Devices',
    'time_skip': 'Devices'
};

const CATEGORY_WEIGHTS = {
    'Primary': 3.0,
    'UseCase': 2.5,
    'Pacing': 2.0,
    'Emotion': 1.5,
    'Information': 1.5,
    'Character': 1.0,
    'Energy': 0.5,
    'Devices': 1.0
};

/**
 * Returns the category for a given tag.
 */
function getCategoryForTag(tag) {
    return TAG_CATEGORIES[tag] || 'Other';
}

/**
 * Filters a list of tags, returning only valid ones from the taxonomy.
 */
function validateTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.filter(tag => !!TAG_CATEGORIES[tag]);
}

/**
 * Formats the taxonomy for inclusion in an LLM prompt.
 */
function getTaxonomyPrompt() {
    const categories = {};
    for (const [tag, cat] of Object.entries(TAG_CATEGORIES)) {
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(tag);
    }

    let output = '';
    for (const [cat, tags] of Object.entries(categories)) {
        output += `### ${cat}\n- ${tags.join('\n- ')}\n\n`;
    }
    return output.trim();
}

module.exports = {
    TAG_CATEGORIES,
    CATEGORY_WEIGHTS,
    getCategoryForTag,
    validateTags,
    getTaxonomyPrompt,
    SERIES_MATCH_WEIGHT: 3.0
};
