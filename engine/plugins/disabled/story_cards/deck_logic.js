// plugins/story_cards/deck_logic.js
const fs = require('fs/promises');

class DeckLogic {
    constructor(tools) {
        if (!tools || !tools.db || !tools.db.chat) {
            throw new Error("DeckLogic requires a valid tools object with db.chat access.");
        }
        this.tools = tools;
        this.tableName = 'plugin_story_cards_state';
    }

    // Ensure the SQL table exists
    async initDb() {
        const sql = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                hand_ids TEXT,
                draw_pile_ids TEXT,
                discard_pile_ids TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await this.tools.db.chat.execute(sql);
    }

    // Load current state (Hand, Draw Pile, Discard Pile)
    async loadState() {
        const rows = await this.tools.db.chat.query(`SELECT * FROM ${this.tableName} WHERE id = 1`);
        if (rows.length === 0) return null;
        
        try {
            return {
                hand: JSON.parse(rows[0].hand_ids || '[]'),
                drawPile: JSON.parse(rows[0].draw_pile_ids || '[]'),
                discardPile: JSON.parse(rows[0].discard_pile_ids || '[]')
            };
        } catch (e) {
            this.tools.logger.error('Database', "Failed to parse deck state from DB.", null, e);
            return null; // Return null on parsing error to trigger regeneration
        }
    }

    // Save state
    async saveState(state) {
        const sql = `
            INSERT INTO ${this.tableName} (id, hand_ids, draw_pile_ids, discard_pile_ids)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                hand_ids = excluded.hand_ids,
                draw_pile_ids = excluded.draw_pile_ids,
                discard_pile_ids = excluded.discard_pile_ids;
        `;
        await this.tools.db.chat.execute(sql, [
            JSON.stringify(state.hand), 
            JSON.stringify(state.drawPile), 
            JSON.stringify(state.discardPile)
        ]);
    }

    // Clear state for debugging
    async clearState() {
        const sql = `DELETE FROM ${this.tableName} WHERE id = 1`;
        await this.tools.db.chat.execute(sql);
        this.tools.logger.log('Database', `Cleared stale state from ${this.tableName}.`);
    }

    // Read input files and generate a fresh full deck (IDs only)
    async generateFreshDeck(filePaths) {
        let allCardIds = [];
        this.tools.logger.log('DeckGeneration', `generateFreshDeck received: ${JSON.stringify(filePaths)}`);
        const paths = filePaths.map(f => f.path || f);

        for (const filePath of paths) {
            this.tools.logger.log('DeckGeneration', `Processing deck file: ${filePath}`);
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const subDecks = JSON.parse(content);

                if (!Array.isArray(subDecks)) {
                    this.tools.logger.error('DeckGeneration', `Deck file is not a JSON array: ${filePath}`);
                    continue;
                }
                this.tools.logger.log('DeckGeneration', `Found ${subDecks.length} sub-decks in file.`);

                for (const subDeck of subDecks) {
                    if (subDeck && Array.isArray(subDeck.cards)) {
                        this.tools.logger.log('DeckGeneration', `Found ${subDeck.cards.length} cards in sub-deck '${subDeck.sub_deck_id}'.`);
                        for (const card of subDeck.cards) {
                            if (card.id) {
                                const qty = card.quantity || 1;
                                for (let i = 0; i < qty; i++) {
                                    allCardIds.push(card.id);
                                }
                            }
                        }
                    } else {
                        this.tools.logger.warn('DeckGeneration', `A sub-deck in ${filePath} is missing a 'cards' array.`);
                    }
                }
            } catch (err) {
                this.tools.logger.error('DeckGeneration', `Failed to read or parse JSON deck file: ${filePath}`, null, err);
            }
        }
        
        this.tools.logger.log('DeckGeneration', `Generated a fresh deck with ${allCardIds.length} total cards.`);
        return this.shuffle(allCardIds);
    }

    // Helper to get card definitions (Title/Desc) from IDs for the prompt
    async getCardDefinitions(filePaths, targetIds) {
        const definitions = new Map();
        const targetSet = new Set(targetIds);
        const paths = filePaths.map(f => f.path || f);

        for (const filePath of paths) {
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const subDecks = JSON.parse(content);

                if (!Array.isArray(subDecks)) continue;

                for (const subDeck of subDecks) {
                    if (subDeck && Array.isArray(subDeck.cards)) {
                        for (const card of subDeck.cards) {
                            if (targetSet.has(card.id)) {
                                definitions.set(card.id, card);
                            }
                        }
                    }
                }
            } catch (e) {
                this.tools.logger.error('DeckGeneration', `Failed to get card definitions from file: ${filePath}`, null, e);
            }
        }
        return definitions;
    }

    // Fisher-Yates Shuffle
    shuffle(array) {
        let currentIndex = array.length, randomIndex;
        while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    }
}

module.exports = DeckLogic;