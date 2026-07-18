const assert = require('assert');
const { readFileSync } = require('fs');
const path = require('path');

const director = require('../modules/director.js');
const { buildTools } = require('../modules/plugin_manager/runtime/tools_builder.js');
const factManager = require('../modules/memory_manager/storage/fact_manager.js');
const worldLocationTracker = require('../plugins/world_location_tracker/index.js');
const LocationTrackerLogic = require('../plugins/world_location_tracker/logic.js');

const nativeLedgerTemplate = readFileSync(
  path.join(__dirname, '../prompts/director/ledger_sections.txt'),
  'utf8'
);
assert(nativeLedgerTemplate.includes('### WORLD_LOCATION'));
assert(nativeLedgerTemplate.includes('[WL-01] Current Location'));
assert(nativeLedgerTemplate.includes('[WL-02] Current Sub Location'));
assert(nativeLedgerTemplate.includes('[WLG-01] Journey Plan'));
assert(nativeLedgerTemplate.includes('[WLG-04] Travel Reason'));

const nativeSteps = director._test.parseCoTSteps(`
Step 13.5: Location Awareness
Step 13.5A: Where are we?
Step 13.5D: Internalize this on your ledger.
Step 14: High Stakes
`);

const rendered = director._test.assembleCotSteps(nativeSteps, [
  {
    type: 'add',
    id: 'world_location_tracker.route_intent',
    pluginId: 'world_location_tracker',
    step: '13.5F',
    content: 'Separate current location from long-term route intent.'
  },
  {
    type: 'override',
    id: 'test.override_location_memory',
    pluginId: 'test',
    target: '13.5D',
    content: 'Override native location memory.'
  },
  {
    type: 'disable',
    id: 'test.disable_high_stakes',
    pluginId: 'test',
    target: '14',
    reason: 'Testing disable.'
  },
  {
    type: 'add',
    id: 'test.duplicate',
    pluginId: 'test',
    step: '13.5G',
    content: 'First duplicate text.'
  },
  {
    type: 'add',
    id: 'test.duplicate',
    pluginId: 'test',
    step: '13.5G',
    content: 'Second duplicate text.'
  }
], [
  'LEGACY RAW STEP'
]).join('\n');

assert(rendered.includes('Step 13.5F: Separate current location from long-term route intent.'));
assert(rendered.includes('Step 13.5D: Override native location memory.'));
assert(!rendered.includes('Step 14: High Stakes'));
assert(!rendered.includes('First duplicate text.'));
assert(rendered.includes('Second duplicate text.'));
assert(rendered.includes('Step 1000: LEGACY RAW STEP'));

const ledgerTemplate = director._test.assembleLedgerTemplate({
  ACTIVE_THREADS: {
    label: 'ACTIVE_THREADS',
    content: 'Track active threads.'
  }
}, {
  ledgerSectionPatches: [
    {
      id: 'PLUGIN_NOTES',
      title: 'Plugin Notes',
      content: 'Maintain plugin-owned entries.'
    }
  ],
  ledgerSections: ['### LEGACY_LEDGER\nLegacy section.'],
  ledgerOverrides: {}
});

assert(ledgerTemplate.includes('### ACTIVE_THREADS'));
assert(ledgerTemplate.includes('### PLUGIN_NOTES'));
assert(ledgerTemplate.includes('Maintain plugin-owned entries.'));
assert(ledgerTemplate.includes('### LEGACY_LEDGER'));

const context = {
  projectName: 'TestProject',
  turnNumber: 12,
  runtime: { director: {} }
};
const pluginManager = {
  plugins: new Map(),
  staticDataManager: {},
  projectRoot: __dirname
};
const tools = buildTools(pluginManager, 'world_location_tracker', context);

tools.director.cot.add({
  id: 'world_location_tracker.route_intent',
  step: '13.5F',
  content: 'A'
});
tools.director.cot.add({
  id: 'world_location_tracker.route_intent',
  step: '13.5F',
  content: 'B'
});
assert.strictEqual(context.runtime.director.cotPatches.length, 1);
assert.strictEqual(context.runtime.director.cotPatches[0].content, 'B');

tools.director.ledger.registerSection({
  id: 'PLUGIN_NOTES',
  content: 'Maintain plugin-owned entries.'
});
assert.strictEqual(context.runtime.director.ledgerSectionPatches.length, 1);
assert.strictEqual(context.runtime.director.ledgerSectionPatches[0].id, 'PLUGIN_NOTES');

const originalGetFormattedLedger = factManager.getFormattedLedger;
factManager.getFormattedLedger = async () => [
  '[WL-01] Current Location [Origin: Ch44]: Locust Town',
  "[WL-02] Current Sub Location [Origin: Ch47]: Lin's Tavern",
  '[OTHER] Unrelated.',
  '[WLG-01] Destination Goal [Origin: Ch25]: Reach Northern Realms',
  '[WLG-02] Travel Reason [Origin: Ch25]: Ask the Snow King about the artifact'
].join('\n');

(async () => {
  const originalGetOperationalStatus = LocationTrackerLogic.prototype.getOperationalStatus;
  LocationTrackerLogic.prototype.getOperationalStatus = async () => ({ active: true, reason: '' });
  try {
    const spatial = await tools.director.ledger.read({ prefix: 'WL', maxChars: 48 });
    assert(spatial.startsWith('[WL-01]'));
    assert(!spatial.includes('[OTHER]'));
    assert(spatial.length <= 48);

    const hookContext = {
      projectName: 'TestProject',
      turnNumber: 12,
      runtime: { director: {} }
    };
    const hookTools = buildTools(pluginManager, 'world_location_tracker', hookContext);
    await worldLocationTracker.hooks.HOOK_DIRECTOR_PRE_PROMPT.run(hookContext, hookTools);
    assert(hookContext.runtime.worldLocationTracker.directorLocation.includes('[WL-01]'));
    assert(hookContext.runtime.worldLocationTracker.directorLocation.includes('[WLG-01]'));
    assert(!hookContext.runtime.worldLocationTracker.directorLocation.includes('[OTHER]'));
    assert.strictEqual(hookContext.runtime.director.ledgerSectionPatches.length, 0);
  } finally {
    factManager.getFormattedLedger = originalGetFormattedLedger;
    LocationTrackerLogic.prototype.getOperationalStatus = originalGetOperationalStatus;
  }
  console.log('director_tools_test passed');
})().catch(error => {
  factManager.getFormattedLedger = originalGetFormattedLedger;
  LocationTrackerLogic.prototype.getOperationalStatus = originalGetOperationalStatus;
  console.error(error);
  process.exit(1);
});
