const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWorldStateUpdateBrief,
  buildTimeTitleContributions,
  applyInventoryDisposalIntentToEvents
} = require('./logic.js');

test('world state update brief reports deltas and retained event reasoning', () => {
  const brief = buildWorldStateUpdateBrief([{
    line: 2,
    time_passed_minutes: 480,
    weather: 'Rain',
    climate: 'Temperate',
    safety_level: 'Caution',
    crowd_density: 'Sparse',
    inventory_changes: [{ item: 'Ration', change: -1 }],
    reasoning: 'The party slept until morning and consumed breakfast.'
  }], {
    weatherChange: 'Clear',
    climate: 'Temperate',
    safetyLevel: 'Safe',
    crowdDensity: 'Sparse'
  });

  assert.match(brief, /Advanced the party clock by 8 hours/);
  assert.match(brief, /Changed weather from Clear to Rain/);
  assert.match(brief, /Changed safety level from Safe to Caution/);
  assert.match(brief, /Applied inventory changes: -1 Ration/);
  assert.match(brief, /Reasoning: The party slept until morning and consumed breakfast/);
});

test('time titles announce substantial jumps and use the accumulated post-event timestamp', () => {
  const contributions = buildTimeTitleContributions([
    { line: 0, time_passed_minutes: 0 },
    { line: 4, time_passed_minutes: 30 },
    { line: 8, time_passed_minutes: 90 }
  ], { formattedDate: 'Day 3, 4:00 PM' }, {});

  assert.deepEqual(contributions, [{
    line: 8,
    kind: 'time',
    text: 'Day 3, 6:00 PM'
  }]);
});

test('time titles announce phase and day boundaries below the substantial-jump threshold', () => {
  const phaseChange = buildTimeTitleContributions([
    { line: 3, time_passed_minutes: 20 }
  ], { formattedDate: 'Day 2, 8:50 AM' }, {
    dawn_start: 5,
    day_start: 9,
    dusk_start: 18,
    night_start: 21
  });
  const dayChange = buildTimeTitleContributions([
    { line: 7, time_passed_minutes: 20 }
  ], { formattedDate: 'Day 2, 11:50 PM' }, {});

  assert.equal(phaseChange[0].text, 'Day 2, 9:10 AM');
  assert.equal(dayChange[0].text, 'Day 3, 12:10 AM');
});

test('inventory disposal intent appends negative changes for carried items', () => {
  const events = applyInventoryDisposalIntentToEvents([{
    line: 0,
    time_passed_minutes: 0,
    inventory_changes: [],
    reasoning: 'Carry-forward baseline from previous state.'
  }], {
    inventory: [
      { item: 'Rough Schematic of Lower Tunnels', quantity: 1 },
      { item: 'Fatui Log Entry: Subject 7 Calibration', quantity: 2 }
    ]
  }, {
    input: {
      inventoryIntent: {
        deleteItems: [
          { item: 'Rough Schematic of Lower Tunnels', quantity: 1 },
          { item: 'Fatui Log Entry: Subject 7 Calibration', quantity: 1 },
          { item: 'Missing Item', quantity: 1 }
        ]
      }
    }
  });

  assert.deepEqual(events[0].inventory_changes, [
    { item: 'Rough Schematic of Lower Tunnels', change: -1, context: 'manual_inventory_delete' },
    { item: 'Fatui Log Entry: Subject 7 Calibration', change: -2, context: 'manual_inventory_delete' }
  ]);
  assert.match(events[0].reasoning, /user-confirmed inventory disposal intent/);
});
