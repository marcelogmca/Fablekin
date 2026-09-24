// plugins/craft_guide/prompts.js

const tags = require('./tags.js');

module.exports = {
    /**
     * Prompt for extracting structural tags from the current story context.
     */
    getTagExtractionPrompt: (chapterBatch, currentDirection, seriesList = [], batch = {}) => {
        const seriesContext = seriesList.length > 0
            ? `## AVAILABLE SERIES\nBelow is a list of series available in our database. Rank the top 3 series that best match the current narrative tone and needs:\n- ${seriesList.join('\n- ')}\n`
            : '';

        const startTurn = Number(batch.startTurn || 0);
        const endTurn = Number(batch.endTurn || 0);
        const rangeLabel = startTurn > 0 && endTurn >= startTurn
            ? `CHAPTERS ${startTurn}-${endTurn}`
            : 'AVAILABLE COMPLETED CHAPTERS';

        return `You are a narrative structure analyst. Analyze a batch of completed chapters and determine the optimal structural "DNA" for the story's next planning horizon.

## CURRENT STORY CONTEXT
### COMPLETED CHAPTER BATCH (${rangeLabel})
${chapterBatch || "No completed chapters are available for this batch."}

### CURRENT PLAYER DIRECTION
${currentDirection || "No new player direction is available."}

${seriesContext}

## TASK
Judge the batch as a sequence: identify what changed across it, its repeated scene shapes, unresolved pressure, pacing trajectory, and the most useful contrast for the upcoming planning horizon.
1. Select 8-12 structural tags from the taxonomy below that best describe the ideal craft pattern for the NEXT FEW chapters.
2. Identify the top 3 series names (from the available list) that most closely align with the current situation.

## TAG TAXONOMY
Select 8-12 tags total. You MUST pick at least one from "Primary" and one from "UseCase".

${tags.getTaxonomyPrompt()}

## OUTPUT FORMAT
Respond with ONLY a JSON object containing "tags" (array) and "series" (array of top 3 series names). Do not include any explanation or other text.
Example: {
  "tags": ["rising_tension", "deepen_relationship", "escalation_chain", "tension_building", "hidden_information"],
  "series": ["Breaking Bad", "The Bear", "Succession"]
}`;
    },

    /**
     * Optional refinement prompt for quality mode.
     */
    getRefinementPrompt: (requestedTags, candidates) => {
        const candidateBlocks = candidates.map((c, i) => `CANDIDATE ${i + 1} (${c.filename}):\n${c.summary}`).join('\n\n---\n\n');

        return `Given the narrative structural requirements defined by these tags:
[${requestedTags.join(', ')}]

Which of the following professional media episode structures best matches these needs?

${candidateBlocks}

Respond with ONLY the index number (e.g., "1") of the best candidate. Do not explain your choice.`;
    }
};
