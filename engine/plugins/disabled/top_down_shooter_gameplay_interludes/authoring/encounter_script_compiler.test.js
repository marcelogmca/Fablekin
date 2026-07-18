const assert = require('assert');
const { compileEncounterScript } = require('./encounter_script_compiler.js');
const encounterSchema = require('../frontend/runtime/encounter_schema.js');

function assertHasCode(result, code) {
    assert(
        result.diagnostics.some((item) => item.code === code),
        'Expected diagnostic ' + code + ', got: ' + JSON.stringify(result.diagnostics, null, 2)
    );
}

function runTest(name, fn) {
    try {
        fn();
        console.log('ok - ' + name);
    } catch (error) {
        console.error('not ok - ' + name);
        throw error;
    }
}

const VALID_SCRIPT = `
BEGIN_TDS_ENCOUNTER_SCRIPT
encounter "Glass Ambush" id glass_ambush duration 75 seed "glass-ambush"
arena diamond size 1500 background crimson_grid
player hp 6 kit default

pattern glass_spiral spiral count=5 speed=3.2 spread=52 projectile=pink aim=player
enemy glass_drifter hp=8 speed=1.3 behavior=chaser attack=glass_spiral every=1.4s
pickup field_medic heal amount=2
objective survive_main survive 60s

phase opening 0..25
start banner "Glass drones spill out of the alleys."
start spawn glass_drifter count=4 at=edge
every 7s spawn glass_drifter count=2 at=random
after 18s pickup field_medic at=center

phase pressure 25..75
every 8s telegraph fire glass_spiral from=random radius=180 duration=0.7s
when objective survive_main complete win
END_TDS_ENCOUNTER_SCRIPT
`;

runTest('compiles representative EncounterScript into valid encounter JSON', () => {
    const result = compileEncounterScript(VALID_SCRIPT);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.strictEqual(result.encounter.id, 'glass_ambush');
    assert(result.encounter.patterns.glass_spiral);
    assert(result.encounter.enemyTypes.glass_drifter);
    assert(result.encounter.pickups.field_medic);
    const validation = encounterSchema.validateEncounterDefinition(result.encounter);
    assert.strictEqual(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

runTest('compiles boss noRepeatWindow and attack deck fields', () => {
    const result = compileEncounterScript(`
encounter "Boss Duel" id boss_duel duration 90 seed "boss-duel"
pattern boss_spiral spiral count=6 speed=3.1 spread=60 projectile=orange aim=player
pattern boss_fan fan count=7 speed=2.8 spread=90 projectile=red aim=player
boss glass_titan hp=120 speed=0.9 behavior=boss_anchor attacks=boss_spiral,boss_fan every=1.1s name="Glass Titan" phases=3 noRepeat=1
objective titan_down boss glass_titan
phase duel 0..90
start spawn glass_titan count=1 at=center
every 9s telegraph fire boss_fan from=random radius=210 duration=0.8s
when objective titan_down complete win
`);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const boss = result.encounter.enemyTypes.glass_titan;
    assert.strictEqual(boss.boss, true);
    assert.strictEqual(boss.bossPhases[0].noRepeatWindow, 1);
    assert.deepStrictEqual(boss.bossPhases[0].attackDeck, ['boss_spiral', 'boss_fan']);
});

runTest('rejects unknown pattern references', () => {
    const result = compileEncounterScript(`
encounter "Broken" id broken_refs duration 45 seed "broken"
enemy scout hp=4 attack=missing_pattern every=1s
objective hold survive 20s
phase opening 0..45
start spawn scout count=1
when objective hold complete win
`);
    assert.strictEqual(result.ok, false);
    assertHasCode(result, 'TDSC-E120');
});

runTest('rejects duplicate ids and impossible phase timing', () => {
    const result = compileEncounterScript(`
encounter "Broken" id broken_dupes duration 45 seed "broken"
pattern p spiral count=4 speed=3 projectile=pink
pattern p fan count=4 speed=3 projectile=pink
enemy scout hp=4 attack=p every=1s
objective hold survive 20s
phase opening 20..10
start spawn scout count=1
when objective hold complete win
`);
    assert.strictEqual(result.ok, false);
    assertHasCode(result, 'TDSC-E011');
    assertHasCode(result, 'TDSC-E073');
});

runTest('rejects missing explicit win condition', () => {
    const result = compileEncounterScript(`
encounter "No Win" id no_win duration 45 seed "no-win"
pattern p spiral count=4 speed=3 projectile=pink
enemy scout hp=4 attack=p every=1s
objective hold survive 20s
phase opening 0..45
start spawn scout count=1
`);
    assert.strictEqual(result.ok, false);
    assertHasCode(result, 'TDSC-E112');
});

runTest('rejects cut V1 mechanics (music, hazards, flags/counters, unsupported pickups)', () => {
    const result = compileEncounterScript(`
encounter "Fat" id fat_cut duration 45 seed "fat-cut"
pattern p spiral count=4 speed=3 projectile=pink
enemy scout hp=5 attack=p every=1s behavior=chase_player
pickup shield_drop shield duration=6s
objective hold survive 20s
hazard unsafe damage_circle radius=80 duration=4s
phase opening 0..45
start music intensity 2
after 3s hazard unsafe at=center
after 4s set flag dramatic_mode true
after 5s add counter chaos 1
when objective hold complete win
`);
    assert.strictEqual(result.ok, false);
    assertHasCode(result, 'TDSC-E055');
    assertHasCode(result, 'TDSC-E062');
    assertHasCode(result, 'TDSC-E082');
    assertHasCode(result, 'TDSC-E083');
    assertHasCode(result, 'TDSC-E085');
    assertHasCode(result, 'TDSC-E086');
});
