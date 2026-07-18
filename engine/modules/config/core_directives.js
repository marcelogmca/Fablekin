const CORE_DIRECTIVES = {
    'emotion_classifier': {
        name: 'Emotion Classifier',
        description: 'Directs how characters express their feelings. Define unique emotional quirks and mood swings.',
        placeholder: 'e.g., "Fern tends to pout when mad; Stark gets scared easily; Frieren is always calm but has silly moments."'
    },
    'focus_analyzer': {
        name: 'Cinematic Gaze & Focus',
        description: 'Controls character eye-contact and focus. Define when characters should look at each other or the player.',
        placeholder: 'e.g., "Characters should avoid eye contact when lying. Focus on the character being addressed."'
    },
    'bg_selector': {
        name: 'Background Selection',
        description: 'Guides the selection of visual environments. Define the aesthetic "look" and mood of locations.',
        placeholder: 'e.g., "Prefer rainy, low-light environments for urban scenes. Use lush green backgrounds for forest encounters."'
    },
    'ost_selector': {
        name: 'Music (OST) Selection',
        description: 'Guides the selection of background music. Define the musical genre and instrumentation for different scenes.',
        placeholder: 'e.g., "Use melancholic piano for sad moments. Switch to fast-paced electronic music during action sequences."'
    },
    'sprite_variant_orchestrator': {
        name: 'Outfit & Variant Selection',
        description: 'Directs which outfits or visual variants characters should wear. Control clothing changes, armor, or special forms.',
        placeholder: 'e.g., "Characters should wear their casual clothes during the festival. Frieren should switch to her winter coat in the mountains."'
    }
};

module.exports = CORE_DIRECTIVES;
