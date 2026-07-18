const assert = require('assert');
const encounterSchema = require('../frontend/runtime/encounter_schema.js');
const { compileEncounterFacade } = require('./encounter_facade_compiler.js');

function runTest(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

function hasCode(result, code) {
    return (Array.isArray(result?.diagnostics) ? result.diagnostics : []).some((item) => String(item?.code || '') === code);
}

const WAVES_FACADE = `
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Wave Drill" id wave_drill length=medium difficulty=normal mode=waves
style readable
wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge
wave push enemy=ranger count=medium pressure=heavy pattern=line pickup=heal spawn=random
END_TDS_ENCOUNTER_FACADE
`;

const SURVIVE_FACADE = `
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Holdout" id holdout length=short difficulty=hard mode=survive
style mobile_crossfire ring_pressure
wave hold enemy=turret count=small pressure=heavy pattern=radial spawn=edge pickup=cooldown
END_TDS_ENCOUNTER_FACADE
`;

const BOSS_FACADE = `
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Captain Duel" id captain_duel length=long difficulty=normal mode=boss
style readable duel
wave setup enemy=chaser count=small pressure=medium pattern=fan spawn=edge
boss glass_captain name="Glass Captain" deck=fan,radial,line pressure=heavy phases=3 adds=light pickup=both
END_TDS_ENCOUNTER_FACADE
`;

runTest('compiles waves facade into strict v1 encounter', () => {
    const result = compileEncounterFacade(WAVES_FACADE);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert(result.encounter);
    assert.strictEqual(result.metadata.scriptKind, 'encounter_facade_v1');
    assert.strictEqual(result.metadata.expandedEncounterSummary.mode, 'waves');
    const objective = (result.encounter.objectives || []).find((item) => item.id === 'waves_clear');
    assert(objective && objective.type === 'defeat_count');
    const validation = encounterSchema.validateEncounterDefinition(result.encounter, { capabilityProfile: 'v1', strictCapabilities: true });
    assert.strictEqual(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

runTest('compiles survive facade into strict v1 encounter', () => {
    const result = compileEncounterFacade(SURVIVE_FACADE);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.strictEqual(result.metadata.expandedEncounterSummary.mode, 'survive');
    const objective = (result.encounter.objectives || []).find((item) => item.id === 'survive_main');
    assert(objective && objective.type === 'survive_time');
    const validation = encounterSchema.validateEncounterDefinition(result.encounter, { capabilityProfile: 'v1', strictCapabilities: true });
    assert.strictEqual(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

runTest('compiles boss facade with phases and boss objective', () => {
    const result = compileEncounterFacade(BOSS_FACADE);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.strictEqual(result.metadata.expandedEncounterSummary.mode, 'boss');
    const objective = (result.encounter.objectives || []).find((item) => item.id === 'boss_down');
    assert(objective && objective.type === 'defeat_boss');
    assert(result.encounter.enemyTypes.glass_captain && result.encounter.enemyTypes.glass_captain.boss === true);
    assert(Array.isArray(result.encounter.enemyTypes.glass_captain.bossPhases));
    assert(result.encounter.enemyTypes.glass_captain.bossPhases.length >= 2);
});

runTest('supports #hex encounter background and maps it to arena.backgroundColor', () => {
    const result = compileEncounterFacade(`
BEGIN_TDS_ENCOUNTER_FACADE
encounter "Desert Trial" id desert_trial length=short difficulty=normal mode=waves bg=#c9a36a
style readable
wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge
END_TDS_ENCOUNTER_FACADE
`);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.strictEqual(Number(result.encounter?.arena?.backgroundColor), 0xc9a36a);
});

runTest('rejects invalid encounter #hex background', () => {
    const result = compileEncounterFacade(`
encounter "Broken Bg" id broken_bg length=short difficulty=normal mode=waves bg=#zzzzzz
wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge
`);
    assert.strictEqual(result.ok, false);
    assert(hasCode(result, 'TDSF-E018'));
});

runTest('rejects raw numeric knobs and cut mechanics', () => {
    const result = compileEncounterFacade(`
encounter "Broken" id broken_facade length=medium difficulty=normal mode=waves
wave opening enemy=chaser count=3 pressure=heavy pattern=fan spawn=edge
hazard storm_damage damage_circle radius=120 duration=5
`);
    assert.strictEqual(result.ok, false);
    assert(hasCode(result, 'TDSF-E041'));
    assert(hasCode(result, 'TDSF-E002'));
});

runTest('rejects unknown enum values', () => {
    const result = compileEncounterFacade(`
encounter "Broken" id broken_enums length=fast difficulty=nightmare mode=waves
wave opening enemy=summoner count=huge pressure=insane pattern=beam spawn=north
`);
    assert.strictEqual(result.ok, false);
    assert(hasCode(result, 'TDSF-E012'));
    assert(hasCode(result, 'TDSF-E013'));
    assert(hasCode(result, 'TDSF-E024'));
});

runTest('is deterministic for ids, phases, and patterns', () => {
    const first = compileEncounterFacade(BOSS_FACADE);
    const second = compileEncounterFacade(BOSS_FACADE);
    assert.strictEqual(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
    assert.strictEqual(second.ok, true, JSON.stringify(second.diagnostics, null, 2));
    assert.strictEqual(first.metadata.sourceHash, second.metadata.sourceHash);
    assert.deepStrictEqual(Object.keys(first.encounter.patterns || {}), Object.keys(second.encounter.patterns || {}));
    assert.deepStrictEqual(
        (first.encounter.sequence?.phases || []).map((phase) => phase.id),
        (second.encounter.sequence?.phases || []).map((phase) => phase.id)
    );
    assert.deepStrictEqual(Object.keys(first.encounter.enemyTypes || {}), Object.keys(second.encounter.enemyTypes || {}));
});
