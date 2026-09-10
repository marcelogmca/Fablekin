// Tunnel Runner
// Created by totetmatt in 2024-12-15
// Originally found on Shadertoy.
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Time is intentionally slowed to 20% of the original speed for calmer intro use.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

#define hash(x) fract(sin(x) * 43758.5453123)

const float TIME_SCALE = 0.2;

float stepNoise(float x, float n) {
    const float factor = 0.3;
    float i = floor(x);
    float f = x - i;
    float u = smoothstep(0.5 - factor, 0.5 + factor, f);
    float res = mix(floor(hash(i) * n), floor(hash(i + 1.0) * n), u);
    res /= (n - 1.0) * 0.5;
    return res - 1.0;
}

vec3 path(vec3 p) {
    vec3 o = vec3(0.0);
    o.x += stepNoise(p.z * 0.05, 5.0) * 5.0;
    o.y += stepNoise(p.z * 0.07, 3.975) * 5.0;
    return o;
}

float diam2(vec2 p, float s) {
    p = abs(p);
    return (p.x + p.y - s) * inversesqrt(3.0);
}

vec3 erot(vec3 p, vec3 ax, float t) {
    return mix(dot(ax, p) * ax, p, cos(t)) + cross(ax, p) * sin(t);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - 0.5 * vec2(uResolutionX, uResolutionY)) / max(1.0, uResolutionY);
    float t = uTime * TIME_SCALE;

    vec3 col = vec3(0.0);
    vec3 ro = vec3(0.0, 0.0, -1.0);
    vec3 rt = vec3(0.0);

    ro.z += t * 5.0;
    rt.z += t * 5.0;
    ro += path(ro);
    rt += path(rt);

    vec3 z = normalize(rt - ro);
    vec3 x = normalize(vec3(z.z, 0.0, -z.x));
    vec3 y = normalize(cross(z, x));

    float jitter = stepNoise(t + hash(uv.x * uv.y * max(t, 0.001)) * 0.05, 6.0);
    vec3 rd = mat3(x, y, z) * erot(normalize(vec3(uv, 1.0)), vec3(0.0, 0.0, 1.0), jitter);

    float e = 0.0;
    float g = 0.0;

    for (int stepIndex = 0; stepIndex < 99; stepIndex++) {
        float fi = float(stepIndex + 1);
        vec3 p = ro + rd * g;

        p -= path(p);
        float r = 0.0;
        vec3 pp = p;
        float sc = 1.0;

        for (int jIndex = 0; jIndex < 4; jIndex++) {
            float j = float(jIndex + 1);
            r = clamp(r + abs(dot(sin(pp * 3.0), cos(pp.yzx * 2.0)) * 0.3 - 0.1) / sc, -0.5, 0.5);
            pp = erot(pp, normalize(vec3(0.1, 0.2, 0.3)), 0.785 + j);
            pp += pp.yzx + j * 50.0;
            sc *= 1.5;
            pp *= 1.5;
        }

        float h = abs(diam2(p.xy, 7.0)) - 3.0 - r;
        p = erot(p, vec3(0.0, 0.0, 1.0), path(p).x * 0.5 + p.z * 0.2);

        float tunnel = length(abs(p.xy) - 0.5) - 0.1;
        bool railHit = tunnel == min(tunnel, h);
        h = min(tunnel, h);
        e = max(0.001, railHit ? abs(h) : h);
        g += e;

        float pulse = 100.0 * exp(-20.0 * fract(p.z * 0.25 + t));
        float stripe = mod(floor(p.z * 4.0) + mod(floor(p.y * 4.0), 2.0), 2.0);
        vec3 hitCol = railHit
            ? vec3(0.3, 0.2, 0.1) * pulse * stripe
            : vec3(0.1);
        col += hitCol * 0.0325 / exp(fi * fi * e);
    }

    col = mix(col, vec3(0.9, 0.9, 1.1), 1.0 - exp(-0.01 * g * g * g));
    col = clamp(col, 0.0, 1.0);

    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.12, 0.18, length(uv));
    float alpha = smoothstep(0.04, 0.72, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
