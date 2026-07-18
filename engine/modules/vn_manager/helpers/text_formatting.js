// engine/modules/vn_manager/helpers/text_formatting.js

const PLACEHOLDERS = ['Player', 'User', 'Protagonist', 'Hero', 'Main Character', 'Narrator'];

/**
 * Applies standard formatting: replaces placeholders with player name and capitalizes.
 * @param {string} text - The text to format.
 * @param {string} playerName - The current player's name.
 * @param {RegExp} placeholderRegex - Pre-compiled regex for replacements.
 * @returns {string} Formatted text.
 */
function applyTextFormatting(text, playerName, placeholderRegex) {
  if (!text || typeof text !== 'string') return text;

  let newText = text;

  // 1. Replace placeholders if player name is valid
  if (playerName && playerName.trim().length > 0) {
    newText = newText.replace(placeholderRegex, playerName);
  }

  // 2. Capitalize the result
  if (newText.length > 0) {
    newText = newText.charAt(0).toUpperCase() + newText.slice(1);
  }

  return newText;
}

module.exports = {
  PLACEHOLDERS,
  applyTextFormatting
};
