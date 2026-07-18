const { getGender } = require('gender-detection-from-name');
const { readSettings } = require('../../utils.js');

/**
 * A utility class for guessing the gender of a given name.
 * It first checks a database of known character genders via factManager,
 * which handles caching, and falls back to name-based guessing if the
 * character is not found in the database.
 * This is important for generic tts voices to pick the right gendered voice, and also for the sprite selector to pick the right gendered sprite.
 * @class
 */
class GenderGuesser {
    /**
     * Guesses the gender of a given name, using a context-registry-first-then-fallback strategy.
     * @param {string} name - The name to guess the gender for.
     * @param {object} turnContext - The current turn context.
     * @returns {Promise<{guess: string, confidence: number}>} An object containing the guessed gender ('male', 'female', 'unknown') and a confidence score.
     */
    async guessGender(name, turnContext) {
        const lowerCaseName = name.toLowerCase();

        // Step 1: Check the Shared Registry in turnContext (Universal Source of Truth)
        if (turnContext && turnContext.processed && turnContext.processed.characterGenders) {
            const genderMap = turnContext.processed.characterGenders;
            if (genderMap.has(lowerCaseName)) {
                const guess = genderMap.get(lowerCaseName);
                return { guess, confidence: 1.0 }; // Absolute confidence for registered facts
            }
        }

        if (readSettings()?.narrative_agents?.gender_classifier?.enabled === false) {
            return { guess: 'unknown', confidence: 0.0 };
        }

        // Step 2: If not in registry, use the fallback library
        const guess = getGender(name);
        let confidence = 0.5; // Default confidence for fallback
        if (guess === 'male' || guess === 'female') {
            confidence = 0.8; // High-ish confidence for a positive match from library
        } else if (guess === 'unknown') {
            confidence = 0.0;
        }
        return { guess, confidence };
    }
}

module.exports = GenderGuesser;
