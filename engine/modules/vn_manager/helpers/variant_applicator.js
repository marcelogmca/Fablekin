// engine/modules/vn_manager/helpers/variant_applicator.js

const { Logger } = require('../../utils.js');

/**
 * Applies LLM-generated sprite variant directives into vnManager processed state.
 * Existing locks are preserved unless a new lock targets the same character key.
 */
function applySpriteVariantOrchestration(turnContext, orchestration) {
  if (!orchestration || typeof orchestration !== 'object') return;

  const incomingLocks = orchestration.spriteVariantLocks || {};
  const incomingSchedule = Array.isArray(orchestration.spriteVariantLockSchedule)
    ? orchestration.spriteVariantLockSchedule
    : [];

  if (Object.keys(incomingLocks).length === 0 && incomingSchedule.length === 0) {
    return;
  }

  if (!turnContext.processed.vnManager || typeof turnContext.processed.vnManager !== 'object') {
    turnContext.processed.vnManager = {};
  }

  if (!turnContext.processed.vnManager.spriteVariantLocks ||
    typeof turnContext.processed.vnManager.spriteVariantLocks !== 'object' ||
    Array.isArray(turnContext.processed.vnManager.spriteVariantLocks)) {
    turnContext.processed.vnManager.spriteVariantLocks = {};
  }

  if (!Array.isArray(turnContext.processed.vnManager.spriteVariantLockSchedule)) {
    turnContext.processed.vnManager.spriteVariantLockSchedule = [];
  }

  Object.assign(turnContext.processed.vnManager.spriteVariantLocks, incomingLocks);
  turnContext.processed.vnManager.spriteVariantLockSchedule.push(...incomingSchedule);

  Logger.log(
    'VNManager',
    'SpriteVariants',
    `Applied sprite variant directives: ${Object.keys(incomingLocks).length} lock(s), ${incomingSchedule.length} scheduled change(s).`
  );
}

module.exports = {
  applySpriteVariantOrchestration
};
