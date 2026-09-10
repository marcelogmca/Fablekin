// "Octagrams"
// Created by whisky_shusuky in 2020-01-28
//
// Inspired by arabesque.
// https://cineshader.com/editor
// Originally found on Shadertoy.
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Added alpha/opacity handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

float gTime = 0.0;

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, s, -s, c);
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float box(vec3 pos, float scale) {
    pos *= scale;
    float base = sdBox(pos, vec3(0.4, 0.4, 0.1)) / 1.5;
    pos.xy *= 5.0;
    pos.y -= 3.5;
    pos.xy *= rot(0.75);
    return -base;
}

float boxSet(vec3 pos) {
    vec3 posOrigin = pos;

    pos = posOrigin;
    pos.y += sin(gTime * 0.4) * 2.5;
    pos.xy *= rot(0.8);
    float box1 = box(pos, 2.0 - abs(sin(gTime * 0.4)) * 1.5);

    pos = posOrigin;
    pos.y -= sin(gTime * 0.4) * 2.5;
    pos.xy *= rot(0.8);
    float box2 = box(pos, 2.0 - abs(sin(gTime * 0.4)) * 1.5);

    pos = posOrigin;
    pos.x += sin(gTime * 0.4) * 2.5;
    pos.xy *= rot(0.8);
    float box3 = box(pos, 2.0 - abs(sin(gTime * 0.4)) * 1.5);

    pos = posOrigin;
    pos.x -= sin(gTime * 0.4) * 2.5;
    pos.xy *= rot(0.8);
    float box4 = box(pos, 2.0 - abs(sin(gTime * 0.4)) * 1.5);

    pos = posOrigin;
    pos.xy *= rot(0.8);
    float box5 = box(pos, 0.5) * 6.0;

    pos = posOrigin;
    float box6 = box(pos, 0.5) * 6.0;

    return max(max(max(max(max(box1, box2), box3), box4), box5), box6);
}

float map(vec3 pos) {
    return boxSet(pos);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 p = (fragCoord.xy * 2.0 - vec2(uResolutionX, uResolutionY)) / min(uResolutionX, uResolutionY);
    vec3 ro = vec3(0.0, -0.2, uTime * 4.0);
    vec3 ray = normalize(vec3(p, 1.5));
    ray.xy = ray.xy * rot(sin(uTime * 0.03) * 5.0);
    ray.yz = ray.yz * rot(sin(uTime * 0.05) * 0.2);

    float t = 0.1;
    float ac = 0.0;

    for (int i = 0; i < 88; i++) {
        vec3 pos = ro + ray * t;
        pos = mod(pos - 2.0, 4.0) - 2.0;
        gTime = uTime - float(i) * 0.01;

        float d = map(pos);
        d = max(abs(d), 0.01);
        ac += exp(-d * 23.0);
        t += d * 0.55;
    }

    vec3 col = vec3(ac * 0.02);
    col += vec3(0.0, 0.2 * abs(sin(uTime)), 0.5 + sin(uTime) * 0.2);

    float originalAlpha = 1.0 - t * (0.02 + 0.02 * sin(uTime));
    float vignette = smoothstep(1.08, 0.18, length(p));
    float alpha = clamp(originalAlpha, 0.0, 1.0) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
