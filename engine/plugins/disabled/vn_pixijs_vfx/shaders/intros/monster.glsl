// Monster
// Created by butadiene in 2020-03-05
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

const float PI = 3.1415926535;

vec2 rot(vec2 p, float r) {
    mat2 m = mat2(cos(r), sin(r), -sin(r), cos(r));
    return m * p;
}

vec2 pmod(vec2 p, float n) {
    float np = 2.0 * PI / n;
    float r = atan(p.x, p.y) - 0.5 * np;
    r = mod(r, np) - 0.5 * np;
    return length(p) * vec2(cos(r), sin(r));
}

float cube(vec3 p, vec3 s) {
    vec3 q = abs(p);
    vec3 m = max(s - q, 0.0);
    return length(max(q - s, 0.0)) - min(min(m.x, m.y), m.z);
}

float distField(vec3 p, float t) {
    p.z -= t;
    p.xy = rot(p.xy, p.z);
    p.xy = pmod(p.xy, 6.0);

    float k = 0.7;
    float zid = floor(p.z * k);
    p = mod(p, k) - 0.5 * k;

    for (int i = 0; i < 4; i++) {
        p = abs(p) - 0.3;
        p.xy = rot(p.xy, 1.0 + zid + 0.1 * t);
        p.xz = rot(p.xz, 1.0 + 4.7 * zid + 0.3 * t);
    }

    return min(cube(p, vec3(0.3)), length(p) - 0.4);
}

void main() {
    float tSlow = uTime * 0.2;
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = fragCoord / vec2(uResolutionX, uResolutionY);

    uv = 2.0 * (uv - 0.5);
    uv.y *= uResolutionY / max(1.0, uResolutionX);
    uv = rot(uv, tSlow);

    vec3 ro = vec3(0.0, 0.0, 0.1);
    vec3 rd = normalize(vec3(uv, 0.0) - ro);

    float marchT = 2.0;
    float d = 0.0;
    float ac = 0.0;

    for (int i = 0; i < 66; i++) {
        d = distField(ro + rd * marchT, tSlow) * 0.2;
        d = max(0.0, abs(d));
        marchT += d;
        if (d < 0.001) ac += 0.1;
    }

    vec3 col = vec3(0.1, 0.7, 0.7) * 0.2 * vec3(ac);

    vec3 pn = ro + rd * marchT;
    float kn = 0.5;
    pn.z += -1.5 * tSlow;
    pn.z = mod(pn.z, kn) - 0.5 * kn;

    float em = clamp(0.01 / max(abs(pn.z), 0.0001), 0.0, 100.0);
    col += 3.0 * em * vec3(0.1, 1.0, 0.1);
    col = clamp(col, 0.0, 1.0);

    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.05, 0.22, length(uv));
    float alpha = smoothstep(0.02, 0.45, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
