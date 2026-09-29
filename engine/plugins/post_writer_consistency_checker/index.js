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
      content: 'Single-pass mode registers a VN task before sprite resolution. HQ mode reviews numbered dialogue immediately after parsing, then validates a complete local-passage rewrite before any dependent VN tasks begin.'
    },
    PLUGIN_METRICS: {
      type: 'metrics',
      narrative_impact: 'Medium',
      immersion: 'Medium',
      cost: 'Low (High with HQ multi-agent)',
      latency: 'Low (High with HQ multi-agent)'
    },
    HQ_SECTION: {
      type: 'header',
      label: 'Higher Quality - Multi Agent'
    },
    HQ_DESCRIPTION: {
      type: 'description',
      content: 'Six agents flag issues throughout the numbered draft. The corrector must resolve every cited line and may rewrite, add, or remove lines in surrounding local passages. Failed coverage gets one repair attempt; if still invalid, the original scene is kept. Up to 8 LLM calls per turn instead of 1.'
    },
    hq_multipass_enabled: {
      type: 'checkbox',
      label: 'Enable Higher Quality Multi-Agent Mode',
      description: 'Run 6 parallel flag agents plus a final corrector instead of the single checker pass.',
      default: false
    },
    hq_quality_model_def: {
      type: 'select',
      label: 'HQ Quality Flagger Model',
      description: 'Model used by the 5 writing-quality flag agents (they receive a compressed context, so a cheaper model is fine).',
      options: 'llm-aliases',
      default: { model: 'lowendmodel' }
    },
    hq_corrector_max_tokens: {
      type: 'number',
      label: 'HQ Corrector Max Tokens',
      description: 'Output allowance for the full set of HQ passage rewrites (and a repair attempt if needed).',
      min: 256,
      max: 16000,
      default: 8000
    },
    hq_context_lines: {
      type: 'number',
      label: 'HQ Local Passage Context Lines',
      description: 'How far a corrected passage can extend around its cited lines. Distant findings require separate hunks.',
      min: 1,
      max: 30,
      default: 5
    },
    hq_flag_max_tokens: {
      type: 'number',
      label: 'HQ Flag Agent Max Tokens',
      description: 'Output token allowance per flag agent; raise it for long lists of non-adjacent occurrences.',
      min: 512,
      max: 16000,
      default: 3000
    },
    hq_history_count: {
      type: 'number',
      label: 'HQ Compressed History Count',
      description: 'Number of prior chapters included in the compressed context sent to the quality flag agents.',
      min: 1,
      max: 30,
      default: 10
    },
    hq_concurrency: {
      type: 'number',
      label: 'HQ Flag Concurrency',
      description: 'Maximum parallel flag agent calls. The 6 agents fan out up to this limit.',
      min: 1,
      max: 6,
      default: 6
    },
    reuse_writer_model: {
      type: 'checkbox',
      label: 'Reuse the same model/provider as the Writer',
      description: 'Runs the checker and HQ corrector on the Writer model/provider when available. Their prompts are independent of the Writer prompt.',
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
      label: 'Single-Pass Max Patches',
      description: 'Maximum SEARCH/REPLACE patches accepted in single-pass mode. HQ edits are instead limited to verified finding lines.',
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
    HOOK_POST_DIALOGUE_PROCESSING: {
      priority: 45,
      mode: 'sequential',
      allowInterlude: true,
      run: async (turnContext, tools) => {
        const settings = tools?.settings?.getSelf?.() || {};
        const isInterlude = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
        if (settings.hq_multipass_enabled !== true || (isInterlude && settings.enable_interludes === false)) return null;
        // Structural rewrites must finish before scene/asset/character work starts.
        return logic.runHqCheck(turnContext, tools);
      }
    },
    HOOK_VN_PIPELINE_TASKS: {
      priority: 45,
      mode: 'parallel',
      allowInterlude: true,
      run: async (turnContext, tools) => {
        const settings = tools?.settings?.getSelf?.() || {};
        const isInterlude = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
        if (settings.hq_multipass_enabled === true || (isInterlude && settings.enable_interludes === false)) return null;

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
    buildCompressedFlagMessages: logic.buildCompressedFlagMessages,
    buildCorrectorMessages: logic.buildCorrectorMessages,
    parseFlagFindings: logic.parseFlagFindings,
    parseSearchReplacePatches: logic.parseSearchReplacePatches,
    runHqCheck: logic.runHqCheck
  }
};
