const logic = require('./logic.js');

module.exports = {
  id: 'post_writer_consistency_checker',
  name: 'Post Writer Consistency Checker',
  author: 'Fablekin Core',
  version: '1.0.0',
  category: 'Narrative',
  wizard: {
    include: true,
    order: 230,
    group: 'Narrative',
    label: 'Consistency Checker',
    recommended_enabled: true,
    author_note: 'Recommended if you value continuity more than shaving off a small extra check.',
    enabled_note: 'Checks generated output for contradictions and continuity problems after writing.',
    disabled_note: 'Turns complete faster, but obvious inconsistencies are less likely to be caught automatically.',
    settings_note: 'Tune checker model and strictness in plugin settings.'
  },
  description: 'Detects and corrects hallucinations, continuity errors, contradictions, and other inconsistencies in the Writer\'s output.',
  interludeMode: 'all',

  settingsSchema: {
    PLUGIN_BRIEF: {
      type: 'description',
      content: 'Runs a fast post-writer validation pass that repairs continuity and glaring factual issues with minimal SEARCH/REPLACE patches.'
    },
    PLUGIN_TECHNICAL_OVERVIEW: {
      type: 'description',
      content: 'Registers a blocking VN pipeline task before sprite resolution. It reuses the Writer prompt payload, appends the Writer output as an assistant message and the finalized dialogue script as a user review request, then applies only safe SEARCH/REPLACE patches.'
    },
    PLUGIN_METRICS: {
      type: 'metrics',
      narrative_impact: 'Medium',
      immersion: 'Medium',
      cost: 'Low',
      latency: 'Low'
    },
    reuse_writer_model: {
      type: 'checkbox',
      label: 'Reuse the same model/provider as the Writer',
      description: 'Allows provider-side prompt caching by running the checker on the Writer model, provider, and resolved subprovider route.',
      default: true
    },
    model_def: {
      type: 'select',
      label: 'Checker Model',
      description: 'Model used when Writer model reuse is disabled or unavailable.',
      options: 'llm-aliases',
      default: { model: 'highendmodel' }
    },
    enable_interludes: {
      type: 'checkbox',
      label: 'Enable During Interludes',
      description: 'Run the post-writer consistency check during interlude turns.',
      default: true
    },
    retries: {
      type: 'number',
      label: 'Max Retries',
      description: 'Retry count for the checker LLM call.',
      min: 1,
      max: 5,
      default: 1
    },
    timeout: {
      type: 'number',
      label: 'Request Timeout (ms)',
      description: 'Maximum time to wait for the checker LLM call.',
      min: 10000,
      max: 300000,
      default: 90000
    },
    fuzzy_threshold: {
      type: 'number',
      label: 'Fuzzy Match Threshold',
      description: 'Minimum similarity score for a fuzzy patch match when exact matching fails.',
      min: 0.8,
      max: 1,
      default: 0.92
    },
    fuzzy_margin: {
      type: 'number',
      label: 'Fuzzy Uniqueness Margin',
      description: 'Minimum score gap between the best and second-best fuzzy match.',
      min: 0,
      max: 0.25,
      default: 0.04
    },
    max_patches: {
      type: 'number',
      label: 'Max Patches',
      description: 'Maximum number of SEARCH/REPLACE patches to consider from one checker response.',
      min: 1,
      max: 32,
      default: 8
    },
    speaker_label_audit: {
      type: 'checkbox',
      label: 'Speaker Label Audit',
      description: 'Include parser-derived speaker labels in the checker prompt so malformed labels can be repaired.',
      default: true
    },
    dialogue_count_delta_percent: {
      type: 'number',
      label: 'Dialogue Count Delta Percent',
      description: 'Maximum fraction of dialogue lines the checker may convert to or from narration while preserving line count.',
      min: 0,
      max: 1,
      default: 0.05
    },
    dialogue_count_delta_max: {
      type: 'number',
      label: 'Dialogue Count Delta Max',
      description: 'Absolute cap for dialogue/narration conversions accepted from one checker response.',
      min: 1,
      max: 32,
      default: 3
    }
  },

  hooks: {
    HOOK_VN_PIPELINE_TASKS: {
      priority: 45,
      mode: 'parallel',
      allowInterlude: true,
      run: async (turnContext, tools) => {
        const settings = tools?.settings?.getSelf?.() || {};
        const isInterlude = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
        if (isInterlude && settings.enable_interludes === false) return null;

        return {
          key: 'postWriterConsistencyChecker',
          blocking: true,
          before: ['spriteResolution'],
          fn: async () => logic.runConsistencyCheck(turnContext, tools)
        };
      }
    }
  },

  exports: {
    applySearchReplaceScriptToLines: logic.applySearchReplaceScriptToLines,
    buildCheckerMessages: logic.buildCheckerMessages,
    parseSearchReplacePatches: logic.parseSearchReplacePatches
  }
};
