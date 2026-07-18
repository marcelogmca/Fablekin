// plugins/story_cards/index.js
const DeckLogic = require('./deck_logic.js');

module.exports = {
    id: "story_cards",
    name: "Story Cards",
    author: 'Fablekin Core',
    version: "1.0.0",
    category: "Narrative",
    experimental: true,
    wizard: {
        include: true,
        order: 250,
        group: 'Narrative',
        label: 'Story Cards',
        recommended_enabled: false,
        author_note: 'Optional intervention layer for users who want deck-style control over story beats.',
        enabled_note: 'Played cards can force themes, encounters, or twists into Director guidance.',
        disabled_note: 'Narrative direction remains driven by prompts, planners, and normal user input.',
        settings_note: 'Tune deck behavior and card influence in plugin settings.'
    },
    description: "A narrative influence system using deck-building mechanics to force specific themes or events via the Director.",
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'A card-based narrative intervention system. Allows users to "play cards" that force specific themes, encounters, or plot twists.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Implements a deck-building engine that manages a hand of "Story Cards" in a local SQLite database. When a card is played, its prompt fragment is injected with high priority into the Director\'s instructions, overriding the natural story flow to ensure the card\'s event occurs.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'Medium',
            cost: 'Medium',
            latency: 'Medium'
        }
    },
    hooks: {
        // =========================================================================
        // HOOK 1: DIRECTOR_PRE_PROMPT
        // Prepare the hand and inject instructions
        // =========================================================================
        'HOOK_DIRECTOR_PRE_PROMPT': {
            priority: 10,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                if (turnContext.turnNumber < 2) {
                    tools.logger.log('Preparation', "Story Cards skipped: Turn number < 2.");
                    return;
                }
                tools.logger.log('Preparation', 'Story Cards preparation started...', 'start');
                const logic = new DeckLogic(tools);
                await logic.initDb();

                const deckFiles = (turnContext.input.selectedFiles || []).filter(file => file.path.endsWith('.deck'));
                if (deckFiles.length === 0) {
                    tools.logger.log('Preparation', "No deck files provided. Skipping Story Cards.", 'end');
                    return;
                }

                let state = await logic.loadState();

                if (!state) {
                    tools.logger.log('Preparation', "Initializing new Deck...");
                    state = {
                        hand: [],
                        discardPile: [],
                        drawPile: await logic.generateFreshDeck(deckFiles)
                    };
                }

                const HAND_SIZE = 10; // Changed to 10 as requested
                while (state.hand.length < HAND_SIZE) {
                    if (state.drawPile.length === 0) {
                        if (state.discardPile.length > 0) {
                            tools.logger.log('Preparation', `Draw pile empty. Reshuffling ${state.discardPile.length} cards from discard pile.`);
                            state.drawPile = logic.shuffle([...state.discardPile]);
                            state.discardPile = [];
                        } else {
                            tools.logger.warn('Preparation', "Deck is completely empty of cards (no cards in draw or discard piles).");
                            break;
                        }
                    }
                    const card = state.drawPile.pop();
                    if (card) {
                        state.hand.push(card);
                        tools.logger.log('Preparation', `Drawn card: ${card}`);
                    }
                }

                await logic.saveState(state);

                const cardDefs = await logic.getCardDefinitions(deckFiles, state.hand);

                let handString = "<available story cards>\n";
                state.hand.forEach(cardId => {
                    const def = cardDefs.get(cardId);
                    if (def) {
                        handString += `- [ID: ${cardId}] ${def.icon} **${def.title}**: ${def.description} (Impact: ${def.impact})\n`;
                    } else {
                        handString += `- [ID: ${cardId}] (Description unavailable)\n`;
                    }
                });
                handString += `</available story cards>\n`;

                // Ensure director structure exists
                if (!turnContext.runtime.director) turnContext.runtime.director = {};
                if (!turnContext.runtime.director.additionalInputs) turnContext.runtime.director.additionalInputs = [];

                turnContext.runtime.director.additionalInputs.push(handString);

                const instructions = `
--- STORY_CARDS ---
Choice: card_id
Reason: ...
Discard: card_id, card_id
Reason: ...
(Follow this format meticulously. You must play exactly ONE card. You can discard up to 2 others to cycle your hand. If the card IDs do not match the provided hand, your choice will be ignored.)
Important: Do not discard just for relevance. Keep a hand with high narrative potential.
`;
                // Feature removed: turnContext.runtime.director.outputSections.push(instructions);

                tools.logger.log('Preparation', `Story Cards injected into Director prompt with a hand of ${state.hand.length} cards.`, 'end');
            }
        },

        // =========================================================================
        // HOOK 2: POST-ORCHESTRATOR
        // Parse the choice, move cards, update DB
        // =========================================================================
        'HOOK_POST_ORCHESTRATOR': {
            priority: 10,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                if (turnContext.turnNumber < 2) return;
                const response = turnContext.processed.director.fullResponse;
                if (!response) return;

                tools.logger.log('Resolution', 'Story Cards resolution started...', 'start');
                const logic = new DeckLogic(tools);
                await logic.initDb(); // Ensure tables exist
                const state = await logic.loadState();
                if (!state) {
                    tools.logger.log('Resolution', 'No state found, skipping.', 'end');
                    return; // Should not happen if PRE hook ran
                }

                // 1. Extract the Block
                const match = response.match(/--- STORY_CARDS ---([\s\S]*?)(?:$|---)/);
                if (!match) {
                    tools.logger.error('Resolution', "Orchestrator failed to output STORY_CARDS block.");
                    tools.logger.log('Resolution', 'Resolution failed.', 'end');
                    return;
                }
                const block = match[1];

                // 2. Parse Choice
                const choiceMatch = block.match(/Choice:\s*([a-zA-Z0-9_]+)/);
                const choiceId = choiceMatch ? choiceMatch[1].trim() : null;

                // 3. Parse Discards
                const discardMatch = block.match(/Discard:\s*([a-zA-Z0-9_, ]+)/);
                let discardIds = [];
                if (discardMatch) {
                    discardIds = discardMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
                }

                tools.logger.log('Resolution', `Parsed Card Choice: ${choiceId} | Discards: ${discardIds.join(', ')}`);

                // 4. Update Logic
                const newHand = [];
                let playedCard = null;

                for (const cardId of state.hand) {
                    if (cardId === choiceId && !playedCard) {
                        playedCard = cardId;
                        state.discardPile.push(cardId);
                    } else if (discardIds.includes(cardId)) {
                        const idx = discardIds.indexOf(cardId);
                        discardIds.splice(idx, 1);
                        state.discardPile.push(cardId);
                    }
                    else {
                        newHand.push(cardId);
                    }
                }

                state.hand = newHand;

                // 5. Save Updated State
                await logic.saveState(state);

                // 6. Inject Result for downstream (Writer)
                if (playedCard) {
                    const deckFiles = (turnContext.input.selectedFiles || []).filter(f => f.path.endsWith('.deck'));
                    const defs = await logic.getCardDefinitions(deckFiles, [playedCard]);
                    const cardDef = defs.get(playedCard);

                    const turnState = tools.pluginState.turn();
                    Object.assign(turnState, {
                        playedCardId: playedCard,
                        playedCardTitle: cardDef ? cardDef.title : playedCard,
                        playedCardDesc: cardDef ? cardDef.description : "No description"
                    });

                    tools.logger.turn(`[Story Cards] Played: ${cardDef ? cardDef.title : playedCard}`);
                } else {
                    tools.logger.warn('Resolution', "[Story Cards] No valid card was found or matched in the hand.");
                }

                // 7. Add instructions to Writer
                if (tools.pluginState.turn()) {
                    const card = tools.pluginState.turn();
                    if (!card.playedCardTitle) return;

                    const injection = `\n
MANDATORY INSTRUCTION:
<NARRATIVE_CARD_ACTIVE>
TITLE: ${card.playedCardTitle}
EFFECT: ${card.playedCardDesc}
INSTRUCTION: You MUST incorporate the effect of this card into the narrative of this turn.
</NARRATIVE_CARD_ACTIVE>\n
`;
                    turnContext.processed.director.writerBrief += injection;
                    tools.logger.log('Resolution', "Injected Active Card instructions into Writer prompt parts.");
                }
                tools.logger.log('Resolution', 'Story Cards resolution complete.', 'end');
            }
        }
    }
};
