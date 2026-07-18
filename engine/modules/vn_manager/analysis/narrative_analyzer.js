const { Logger } = require('../../utils.js');

/**
 * Advanced Narrative Analyzer
 * Computes rhythm and balance metrics for dialogue across historical turns.
 * This is mostly an experiment. Perhaps we can use this to programmatically tell the writer some instructions to improve the story.
 * But not sure yet, so this is just a WIP.
 */
const NarrativeAnalyzer = {
  /**
   * Analyzes the past N turns and returns a suite of mathematical metrics.
   * @param {TurnContext} turnContext 
   * @param {number} nCount - Number of historical turns to analyze.
   * @returns {Promise<object>}
   */
  async getNarrativeMetrics(turnContext, nCount = 5) {
    try {
      const { fullchapters } = await turnContext.retrieveDatedChapters();
      if (!fullchapters || fullchapters.length === 0) return null;

      const lastN = fullchapters.slice(-nCount);
      const data = {
        speakers: [],
        lineLengths: [], // words per line
        uniqueSpeakers: new Set(),
        transitions: []
      };

      for (const ch of lastN) {
        await ch.ensureFull();
        const lines = ch.processed?.dialogueProcessor?.processedLines || [];
        for (const line of lines) {
          if (line.type === 'dialogue' && line.character && line.text) {
            const speaker = line.character.trim();
            const wordCount = line.text.split(/\s+/).filter(Boolean).length;

            data.speakers.push(speaker);
            data.lineLengths.push(wordCount);
            data.uniqueSpeakers.add(speaker);
          }
        }
      }

      if (data.speakers.length < 2) return null;

      // 1. Turn Alternation Rate (TAR)
      let switches = 0;
      for (let i = 1; i < data.speakers.length; i++) {
        if (data.speakers[i] !== data.speakers[i - 1]) {
          switches++;
        }
      }
      const tar = switches / (data.speakers.length - 1);

      // 2. Run Lengths (RL)
      const runLengths = [];
      let currentRun = 1;
      for (let i = 1; i < data.speakers.length; i++) {
        if (data.speakers[i] === data.speakers[i - 1]) {
          currentRun++;
        } else {
          runLengths.push(currentRun);
          currentRun = 1;
        }
      }
      runLengths.push(currentRun);

      const meanRL = this._mean(runLengths);
      const stdRL = this._std(runLengths);
      const maxRL = Math.max(...runLengths);

      // 3. Line Lengths (LL)
      const meanLL = this._mean(data.lineLengths);
      const stdLL = this._std(data.lineLengths);

      // 4. Speaker Balance/Entropy (H)
      const speakerCounts = {};
      data.speakers.forEach(s => speakerCounts[s] = (speakerCounts[s] || 0) + 1);
      const totalLines = data.speakers.length;
      let entropy = 0;
      Object.values(speakerCounts).forEach(count => {
        const p = count / totalLines;
        entropy -= p * Math.log2(p);
      });
      const maxPossibleEntropy = Math.log2(data.uniqueSpeakers.size);
      const normalizedEntropy = maxPossibleEntropy > 0 ? entropy / maxPossibleEntropy : 0;

      // 5. Interaction Density (ID)
      const uniqueTransitions = new Set();
      for (let i = 1; i < data.speakers.length; i++) {
        if (data.speakers[i] !== data.speakers[i - 1]) {
          const pair = [data.speakers[i - 1], data.speakers[i]].sort().join('<->');
          uniqueTransitions.add(pair);
        }
      }
      const numSpeakers = data.uniqueSpeakers.size;
      const possiblePairs = (numSpeakers * (numSpeakers - 1)) / 2;
      const interactionDensity = possiblePairs > 0 ? uniqueTransitions.size / possiblePairs : 1;

      // Composite Scores
      const PPS = (0.5 * tar) + (0.3 * (1 / meanRL)) + (0.2 * (1 / (stdLL + 1)));
      const MLS = (0.4 * meanRL) + (0.4 * meanLL) + (0.2 * (1 - normalizedEntropy));
      const DRI = meanRL > 0 ? (stdRL * stdLL) / meanRL : 0;

      return {
        raw: {
          lineCount: totalLines,
          speakerCount: numSpeakers,
          runLengths,
          lineLengths: data.lineLengths
        },
        metrics: {
          TAR: tar,
          MeanRL: meanRL,
          StdRL: stdRL,
          MaxRL: maxRL,
          MeanLL: meanLL,
          StdLL: stdLL,
          Entropy: normalizedEntropy,
          InteractionDensity: interactionDensity
        },
        scores: {
          PingPongScore: PPS,
          MonologueScore: MLS,
          DialogueRhythmIndex: DRI
        }
      };
    } catch (err) {
      Logger.error('NarrativeAnalyzer', 'Metrics', 'Failed to compute narrative metrics:', err);
      return null;
    }
  },

  _mean(array) {
    if (!array.length) return 0;
    return array.reduce((a, b) => a + b) / array.length;
  },

  _std(array) {
    if (!array.length) return 0;
    const m = this._mean(array);
    return Math.sqrt(array.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / array.length);
  }
};

module.exports = NarrativeAnalyzer;
