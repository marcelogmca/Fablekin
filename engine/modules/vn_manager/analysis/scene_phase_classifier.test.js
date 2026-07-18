const assert = require('assert');
const { _private } = require('./scene_phase_classifier.js');

const CAMP_CAPABILITY = {
  phase: 'CAMP',
  pluginId: 'camp_rest_interludes',
  description: 'Camp downtime'
};

const COMBAT_CAPABILITY = {
  phase: 'COMBAT',
  pluginId: 'combat_plugin',
  description: 'Combat encounter'
};

const ADVENTURE_BOOK_CAPABILITY = {
  phase: 'ADVENTURE_BOOK',
  pluginId: 'adventure_book',
  description: 'Adventure Book mini-adventure resolver'
};

function runTest(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (error) {
    console.error('not ok - ' + name);
    throw error;
  }
}

function turn(turnNumber, phase, pluginId = null) {
  return {
    turnNumber,
    processed: {
      director: {
        scenePhase: phase,
        scenePluginId: pluginId
      },
      scenePhaseClassifier: {
        resolvedPhase: phase,
        resolvedPluginId: pluginId
      }
    }
  };
}

function evaluate(parsed, recentTurns, registeredCapabilities = [CAMP_CAPABILITY]) {
  const result = _private.buildDefaultResult();
  _private.populateResultFromParsedEvaluation(result, parsed, {
    recentTurns
  }, 57, registeredCapabilities);
  return _private.applyDeterministicHandoffResolution(result, {
    registeredCapabilities,
    excludedCapabilityKeys: new Set(),
    minConfidence: 0.62
  });
}

function campParsed(overrides = {}) {
  return {
    capability: 'CAMP',
    plugin_id: 'camp_rest_interludes',
    confidence: 0.9,
    is_handoff: true,
    boundary_type: 'soft_downtime_closure',
    boundary_strength: 'weak',
    interruptibility: 'clear',
    current_engagement: 'The party is loosely resting.',
    boundary_excerpt: 'The inn quiets around them.',
    reason: 'Soft downtime boundary.',
    repetition_risk: 'low',
    repetition_note: '',
    director_advisory: {
      severity: 'none',
      capability: '',
      topic: '',
      message: '',
      expires_after_turns: 0
    },
    ...overrides
  };
}

runTest('blocks weak camp after three consecutive camp turns and emits advisory', () => {
  const result = evaluate(campParsed(), [
    turn(56, 'CAMP', 'camp_rest_interludes'),
    turn(55, 'CAMP', 'camp_rest_interludes'),
    turn(54, 'CAMP', 'camp_rest_interludes')
  ]);

  assert.strictEqual(result.isHandoff, false);
  assert.strictEqual(result.resolvedPhase, 'NORMAL');
  assert.strictEqual(result.cadence.overused, true);
  assert.strictEqual(result.capabilityTemperature[0].temperature, 'hot');
  assert.strictEqual(result.capabilityTemperature[0].pacingBias, 'slightly_suppress');
  assert.strictEqual(result.directorAdvisory.severity, 'medium');
  assert(result.gatingNotes.some(note => note.includes('overused')));
});

runTest('allows strong explicit camp free-time boundary despite recent camp repetition', () => {
  const result = evaluate(campParsed({
    boundary_type: 'explicit_free_time_choice',
    boundary_strength: 'strong',
    boundary_excerpt: 'The evening is open; who do you spend time with?'
  }), [
    turn(56, 'CAMP', 'camp_rest_interludes'),
    turn(55, 'CAMP', 'camp_rest_interludes'),
    turn(54, 'CAMP', 'camp_rest_interludes')
  ]);

  assert.strictEqual(result.isHandoff, true);
  assert.strictEqual(result.resolvedPhase, 'CAMP');
  assert.strictEqual(result.resolvedPluginId, 'camp_rest_interludes');
});

runTest('allows strong open free-time question despite recent camp repetition', () => {
  const result = evaluate(campParsed({
    boundary_type: 'open_free_time_question',
    boundary_strength: 'strong',
    boundary_excerpt: 'The whole city is open to us. Where do you want to go first?'
  }), [
    turn(56, 'CAMP', 'camp_rest_interludes'),
    turn(55, 'CAMP', 'camp_rest_interludes'),
    turn(54, 'CAMP', 'camp_rest_interludes')
  ]);

  assert.strictEqual(result.isHandoff, true);
  assert.strictEqual(result.resolvedPhase, 'CAMP');
});

runTest('blocks direct immediate task request in a restful place', () => {
  const result = evaluate(campParsed({
    boundary_type: 'direct_immediate_task_request',
    boundary_strength: 'medium',
    current_engagement: 'A character asks the player for immediate help finding clothing.',
    boundary_excerpt: 'Now help me find my pants.'
  }), []);

  assert.strictEqual(result.isHandoff, false);
  assert.strictEqual(result.resolvedPhase, 'NORMAL');
  assert.strictEqual(result.directorAdvisory.severity, 'low');
  assert(result.gatingNotes.some(note => note.includes('direct_immediate_task_request')));
});

runTest('blocks private scene continuation', () => {
  const result = evaluate(campParsed({
    boundary_type: 'private_scene_continuation',
    boundary_strength: 'medium',
    interruptibility: 'blocked',
    current_engagement: 'Two characters are still inside a focused intimate conversation.'
  }), []);

  assert.strictEqual(result.isHandoff, false);
  assert.strictEqual(result.resolvedPhase, 'NORMAL');
  assert(result.gatingNotes.some(note => note.includes('private_scene_continuation')));
});

runTest('allows strong camp boundary when camp is not recent', () => {
  const result = evaluate(campParsed({
    boundary_type: 'explicit_free_time_choice',
    boundary_strength: 'strong'
  }), [
    turn(56, 'NORMAL'),
    turn(55, 'TRAVEL'),
    turn(54, 'NORMAL')
  ]);

  assert.strictEqual(result.isHandoff, true);
  assert.strictEqual(result.resolvedPhase, 'CAMP');
  assert.strictEqual(result.cadence.overused, false);
});

runTest('cadence report marks cold capabilities as underused encouragement', () => {
  const entries = _private.buildCapabilityTemperatureEntries([ADVENTURE_BOOK_CAPABILITY], [
    turn(56, 'NORMAL'),
    turn(55, 'CAMP', 'camp_rest_interludes')
  ], 57);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].capability, 'adventure_book');
  assert.strictEqual(entries[0].temperature, 'cold');
  assert.strictEqual(entries[0].pacingBias, 'slightly_encourage');
  assert.strictEqual(entries[0].cadenceStatus, 'underused');
  assert.strictEqual(entries[0].overused, false);

  const report = _private.buildCadenceReport([ADVENTURE_BOOK_CAPABILITY], [], 57);
  assert(report.includes('cadence_status=underused'));
  assert(report.includes('lower hesitation'));
});

runTest('generic overuse is a soft warning, not a deterministic block', () => {
  const result = evaluate({
    capability: 'ADVENTURE_BOOK',
    plugin_id: 'adventure_book',
    confidence: 0.9,
    is_handoff: true,
    boundary_type: 'capability_boundary',
    boundary_strength: 'strong',
    interruptibility: 'clear',
    current_engagement: 'The party is committed to a five-day journey.',
    boundary_excerpt: 'The road keeps going beneath their feet.',
    reason: 'A small contained travel incident fits the committed journey.',
    repetition_risk: 'medium',
    repetition_note: 'Adventure Book is hot, but the boundary is strong.',
    director_advisory: {
      severity: 'none',
      capability: '',
      topic: '',
      message: '',
      expires_after_turns: 0
    }
  }, [
    turn(56, 'ADVENTURE_BOOK', 'adventure_book'),
    turn(55, 'ADVENTURE_BOOK', 'adventure_book')
  ], [ADVENTURE_BOOK_CAPABILITY]);

  assert.strictEqual(result.cadence.overused, true);
  assert.strictEqual(result.capabilityTemperature[0].cadenceStatus, 'overused');
  assert.strictEqual(result.isHandoff, true);
  assert.strictEqual(result.resolvedPhase, 'ADVENTURE_BOOK');
  assert.strictEqual(result.resolvedPluginId, 'adventure_book');
});

runTest('preserves non-camp capability behavior', () => {
  const result = evaluate({
    capability: 'COMBAT',
    plugin_id: 'combat_plugin',
    confidence: 0.9,
    is_handoff: true,
    boundary_type: 'capability_boundary',
    boundary_strength: 'medium',
    interruptibility: 'clear',
    current_engagement: 'A fight is about to begin.',
    boundary_excerpt: 'The raiders draw steel.',
    reason: 'The scene ends at imminent combat.',
    repetition_risk: 'low',
    repetition_note: '',
    director_advisory: {
      severity: 'none',
      capability: '',
      topic: '',
      message: '',
      expires_after_turns: 0
    }
  }, [
    turn(56, 'CAMP', 'camp_rest_interludes'),
    turn(55, 'CAMP', 'camp_rest_interludes')
  ], [COMBAT_CAPABILITY]);

  assert.strictEqual(result.isHandoff, true);
  assert.strictEqual(result.resolvedPhase, 'COMBAT');
  assert.strictEqual(result.resolvedPluginId, 'combat_plugin');
});
