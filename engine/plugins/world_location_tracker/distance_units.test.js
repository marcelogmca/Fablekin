const assert = require('node:assert/strict');
const test = require('node:test');

const distanceUnits = require('./distance_units.js');
const biomeNavigation = require('./biome_navigation.js');

test('distance formatting supports kilometres and miles without changing internal values', () => {
    assert.equal(distanceUnits.formatDistanceKm(100, 'kilometres'), '100 km');
    assert.equal(distanceUnits.formatDistanceKm(100, 'miles'), '62 mi');
    assert.equal(Number(distanceUnits.configuredDistanceToKm(62.1371, 'miles').toFixed(3)), 100);
});

test('distance mentions convert in either direction for cached guidance', () => {
    assert.equal(
        distanceUnits.replaceDistanceMentions('Travel 100km, then another 10 kilometres.', 'miles'),
        'Travel 62 mi, then another 6.2 mi.'
    );
    assert.equal(
        distanceUnits.replaceDistanceMentions('Travel 62 mi.', 'kilometres'),
        'Travel 100 km.'
    );
});

test('biome fallback route text uses the selected display unit', async () => {
    const result = await biomeNavigation.analyzeBiomeRoutes({
        worldData: {
            meta: { pixels_per_km: 10, dimensions: { width: 1000, height: 1000 } },
            biomes: { palette: [] }
        },
        packagePath: '',
        biomeMaskPath: '',
        start: { x: 0, y: 0 },
        end: { x: 1000, y: 0 },
        distanceUnit: 'miles'
    });
    assert.equal(result.enabled, false);
    assert.match(result.fallback.text, /62 mi/);
    assert.doesNotMatch(result.fallback.text, /100\s*km/);
});
