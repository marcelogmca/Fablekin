const assert = require('node:assert/strict');
const test = require('node:test');

const director = require('./director.js');
const { buildTools } = require('./plugin_manager/runtime/tools_builder.js');

test('Director detects unique directable plugins in the assembled prompt', () => {
  const ids = director._test.extractDirectablePluginIds({
    sharedMessages: [{
      role: 'user',
      content: '<plugin_context directable_plugin="world_state_tracker">state</plugin_context>\n' +
        '<plugin_context directable_plugin="world_location_tracker">location</plugin_context>\n' +
        '<plugin_context directable_plugin="world_state_tracker">duplicate</plugin_context>'
    }]
  });

  assert.deepEqual(ids, ['world_state_tracker', 'world_location_tracker']);
  assert.deepEqual(director._test.extractDirectablePluginIds({ sharedMessages: [] }), []);
});

test('Director normalizes feedback only for plugins present in its prompt', () => {
  const normalized = director._test.normalizeDirectorPluginFeedback({
    plugin_feedback: [
      { plugin: 'world_state_tracker', assessment: 'aligned', feedback: 'The timeline is consistent.' },
      { plugin: 'unrelated_plugin', assessment: 'concern', feedback: 'Should not be retained.' }
    ]
  }, ['world_state_tracker'], 8);

  assert.deepEqual(normalized, {
    schemaVersion: 1,
    sourceTurn: 8,
    byPlugin: {
      world_state_tracker: {
        assessment: 'aligned',
        feedback: 'The timeline is consistent.'
      }
    }
  });
});

test('plugin feedback tool reads only the previous turn and defaults to self', async () => {
  const previousTurn = {
    processed: {
      director: {
        pluginFeedback: {
          byPlugin: {
            world_state_tracker: { assessment: 'aligned', feedback: 'The timeline is consistent.' },
            world_location_tracker: { assessment: 'advisory', feedback: 'Recheck the departure.' }
          }
        }
      }
    }
  };
  const context = {
    promptComponents: {},
    getPreviousChapter: async () => previousTurn
  };
  const pluginManager = { plugins: new Map(), staticDataManager: {} };
  const tools = buildTools(pluginManager, 'world_state_tracker', context);

  assert.equal(
    await tools.director.getFeedback(),
    'Director assessment: ALIGNED\nThe timeline is consistent.'
  );
  assert.deepEqual(await tools.director.getFeedback({ allPlugins: true }), {
    world_state_tracker: 'Director assessment: ALIGNED\nThe timeline is consistent.',
    world_location_tracker: 'Director assessment: ADVISORY\nRecheck the departure.'
  });
});
