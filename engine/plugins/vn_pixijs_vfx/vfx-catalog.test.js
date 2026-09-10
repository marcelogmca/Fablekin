const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('./vfx-catalog.js');
const plugin = require('./index.js');

test('default VFX prompt uses the VN cinematographer bucket', () => {
    const prompt = catalog.formatVfxPrompt();

    assert.match(prompt, /VN CINEMATOGRAPHER BUCKET/);
    assert.match(prompt, /"rain"/);
    assert.match(prompt, /"shockwave"/);
    assert.match(prompt, /AMBIENT VS IMPACT/);
    assert.match(prompt, /Environmental VFX are part of scene continuity/);
    assert.match(prompt, /require a concrete on-screen event/);
    assert.doesNotMatch(prompt, /intro-raymarch-fractal/);
    assert.doesNotMatch(prompt, /intro-brush-reveal/);
    assert.doesNotMatch(prompt, /intro-water-ripple/);
    assert.doesNotMatch(prompt, /INTRO-ONLY RULE/);
});

test('intro VFX prompt is separate from the VN cinematographer bucket', () => {
    const prompt = catalog.formatVfxPrompt('intro');

    assert.match(prompt, /INTRO CINEMATICS BUCKET/);
    assert.match(prompt, /INTRO-ONLY RULE/);
    assert.match(prompt, /STANZA_GLOBAL/);
    assert.match(prompt, /"intro-raymarch-fractal"/);
    assert.match(prompt, /"intro-octagrams"/);
    assert.match(prompt, /"intro-fractal-pyramid"/);
    assert.match(prompt, /"intro-shader-art"/);
    assert.match(prompt, /"intro-protean-clouds"/);
    assert.match(prompt, /"intro-star-nest"/);
    assert.match(prompt, /"intro-monster"/);
    assert.match(prompt, /"intro-tunnel-runner"/);
    assert.match(prompt, /"intro-palace-of-mind"/);
    assert.match(prompt, /"intro-blue-002"/);
    assert.match(prompt, /"intro-ether"/);
    assert.match(prompt, /"intro-zippy-zaps"/);
    assert.match(prompt, /"intro-biomine"/);
    assert.match(prompt, /"intro-bal-khan-tunnel"/);
    assert.match(prompt, /"intro-warp-speed"/);
    assert.match(prompt, /"intro-gilded-kaleidoscope"/);
    assert.match(prompt, /"intro-topologica"/);
    assert.match(prompt, /"intro-transparent-cube-field"/);
    assert.doesNotMatch(prompt, /"intro-brush-reveal"/);
    assert.doesNotMatch(prompt, /"intro-water-ripple"/);
    assert.doesNotMatch(prompt, /"intro-slice-flip"/);
    assert.doesNotMatch(prompt, /"intro-portrait-trails"/);
    assert.doesNotMatch(prompt, /"intro-beat-flash-rgb"/);
    assert.match(prompt, /"fog"/);
});

test('plugin exports keep old callers on the VN-safe bucket', async () => {
    const defaultPrompt = await plugin.exports.getVfxPrompt();
    const introPrompt = await plugin.exports.getVfxPromptForBucket('intro');

    assert.match(defaultPrompt, /VN CINEMATOGRAPHER BUCKET/);
    assert.match(defaultPrompt, /"fog"/);
    assert.doesNotMatch(defaultPrompt, /intro-raymarch-fractal/);
    assert.doesNotMatch(defaultPrompt, /intro-octagrams/);
    assert.doesNotMatch(defaultPrompt, /intro-fractal-pyramid/);
    assert.doesNotMatch(defaultPrompt, /intro-shader-art/);
    assert.doesNotMatch(defaultPrompt, /intro-protean-clouds/);
    assert.doesNotMatch(defaultPrompt, /intro-star-nest/);
    assert.doesNotMatch(defaultPrompt, /intro-monster/);
    assert.doesNotMatch(defaultPrompt, /intro-tunnel-runner/);
    assert.doesNotMatch(defaultPrompt, /intro-palace-of-mind/);
    assert.doesNotMatch(defaultPrompt, /intro-blue-002/);
    assert.doesNotMatch(defaultPrompt, /intro-ether/);
    assert.doesNotMatch(defaultPrompt, /intro-zippy-zaps/);
    assert.doesNotMatch(defaultPrompt, /intro-biomine/);
    assert.doesNotMatch(defaultPrompt, /intro-bal-khan-tunnel/);
    assert.doesNotMatch(defaultPrompt, /intro-warp-speed/);
    assert.doesNotMatch(defaultPrompt, /intro-gilded-kaleidoscope/);
    assert.doesNotMatch(defaultPrompt, /intro-topologica/);
    assert.doesNotMatch(defaultPrompt, /intro-transparent-cube-field/);
    assert.doesNotMatch(defaultPrompt, /intro-brush-reveal/);
    assert.doesNotMatch(defaultPrompt, /INTRO-ONLY RULE/);
    assert.match(introPrompt, /INTRO CINEMATICS BUCKET/);
});

test('intro VFX effect ids keep removed transition effects out of the intro pool', async () => {
    const ids = await plugin.exports.getVfxEffectIds('intro');

    assert.ok(ids.includes('intro-raymarch-fractal'));
    assert.ok(ids.includes('intro-octagrams'));
    assert.ok(ids.includes('intro-fractal-pyramid'));
    assert.ok(ids.includes('intro-shader-art'));
    assert.ok(ids.includes('intro-protean-clouds'));
    assert.ok(ids.includes('intro-star-nest'));
    assert.ok(ids.includes('intro-monster'));
    assert.ok(ids.includes('intro-tunnel-runner'));
    assert.ok(ids.includes('intro-palace-of-mind'));
    assert.ok(ids.includes('intro-blue-002'));
    assert.ok(ids.includes('intro-ether'));
    assert.ok(ids.includes('intro-zippy-zaps'));
    assert.ok(ids.includes('intro-biomine'));
    assert.ok(ids.includes('intro-bal-khan-tunnel'));
    assert.ok(ids.includes('intro-warp-speed'));
    assert.ok(ids.includes('intro-gilded-kaleidoscope'));
    assert.ok(ids.includes('intro-topologica'));
    assert.ok(ids.includes('intro-transparent-cube-field'));
    assert.equal(ids.includes('intro-brush-reveal'), false);
    assert.equal(ids.includes('intro-water-ripple'), false);
    assert.equal(ids.includes('intro-slice-flip'), false);
    assert.equal(ids.includes('intro-portrait-trails'), false);
    assert.equal(ids.includes('intro-beat-flash-rgb'), false);
    assert.ok(ids.includes('embers'));
});
