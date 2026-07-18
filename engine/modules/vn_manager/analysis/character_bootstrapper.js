// engine/modules/vn_manager/analysis/character_bootstrapper.js

const { Logger } = require('../../utils.js');
const factManager = require('../../memory_manager/storage/fact_manager.js');
const pluginManager = require('../../plugin_manager/plugin_manager.js');

/**
 * Handles the logic for identifying new characters and bootstrapping their data.
 */
async function handleNewCharacterExtraction(turnContext) {
  Logger.log('VNManager', 'CharacterBootstrapping', 'Starting newCharacterIdentification', 'start');
  const newCharacters = await factManager.identifyNewCharacters(turnContext);
  Logger.log('VNManager', 'CharacterBootstrapping', `Finished newCharacterIdentification, found: ${newCharacters.join(', ')}`);

  if (newCharacters.length > 0) {
    turnContext.processed.newlyIntroducedCharacters = newCharacters;

    // ###### PLUGIN HOOK: NEW_CHARACTER_IDENTIFIED ##################################
    await pluginManager.executeHook('HOOK_NEW_CHARACTER_IDENTIFIED', turnContext);
    // ###############################################################################

    const metadata = turnContext.processed.characterMetadata || {};
    const projectName = turnContext.projectName;
    const turnNumber = turnContext.turnNumber;

    for (const charName of newCharacters) {
      const charMetadata = metadata[charName.toLowerCase()];
      const importance = (charMetadata?.importance || '').toString().toLowerCase();
      const shouldSkipIntroduction = importance === 'minor' || importance === 'noncharacter';

      if (!shouldSkipIntroduction) {
        Logger.log('VNManager', 'CharacterBootstrapping', `Persisting CHARACTER_INTRODUCTION for accepted character: ${charName}`);
        await factManager.addFact({
          turn_number: turnNumber,
          source: charName,
          predicate: 'CHARACTER_INTRODUCTION'
        }, projectName);
      } else {
        Logger.log('VNManager', 'CharacterBootstrapping', `Skipping CHARACTER_INTRODUCTION persistence for ${importance || 'filtered'} character: ${charName}`);
      }
    }

    Logger.log('VNManager', 'CharacterBootstrapping', `Finished all parallel bootstrapping for new characters.`, 'end');
  } else {
    Logger.log('VNManager', 'CharacterBootstrapping', 'No new characters identified.', 'end');
  }

  return newCharacters;
}

module.exports = {
  handleNewCharacterExtraction
};
