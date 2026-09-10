// engine/plugins/relationship_tracker/logic.js

const config = require('./logic/config');
const scoring = require('./logic/scoring');
const archetypes = require('./logic/archetypes');
const db_operations = require('./logic/db_operations');
const rolling_ledger = require('./logic/rolling_ledger');
const change_extractor = require('./logic/change_extractor');
const initial_generator = require('./logic/initial_generator');
const relevance = require('./logic/relevance');

module.exports = {
    ...config,
    ...scoring,
    ...archetypes,
    ...db_operations,
    ...rolling_ledger,
    ...change_extractor,
    ...initial_generator,
    ...relevance
};
