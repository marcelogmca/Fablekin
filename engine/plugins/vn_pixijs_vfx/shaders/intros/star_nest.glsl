// Star Nest by Pablo Roman Andrioli
// License: MIT
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution/iMouse replaced with Pixi uniforms/default camera drift.
// - Added opacity/alpha handling so it can render between background and character sprites.
// - Time is intentionally slowed to 20% of the original adapted speed for calmer intro use.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

#define iterations 17
#define formuparam 0.53

#define volsteps 20
#define stepsize 0.1

#define zoom 0.800
#define tile 0.850
#define speed 0.010

#define brightness 0.0015
#define darkmatter 0.300
#define distfading 0.730
#define saturation 0.850

const float TIME_SCALE = 0.2;

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);

    vec2 uv = fragCoord.xy / resolution.xy - 0.5;
    uv.y *= resolution.y / max(1.0, resolution.x);

    vec3 dir = vec3(uv * zoom, 1.0);
    float t = uTime * TIME_SCALE;
    float time = t * speed + 0.25;

    float a1 = 0.5 + sin(t * 0.071) * 0.55;
    float a2 = 0.8 + cos(t * 0.057) * 0.45;
    mat2 rot1 = mat2(cos(a1), sin(a1), -sin(a1), cos(a1));
    mat2 rot2 = mat2(cos(a2), sin(a2), -sin(a2), cos(a2));

    dir.xz *= rot1;
    dir.xy *= rot2;

    vec3 from = vec3(1.0, 0.5, 0.5);
    from += vec3(time * 2.0, time, -2.0);
    from.xz *= rot1;
    from.xy *= rot2;

    float s = 0.1;
    float fade = 1.0;
    vec3 v = vec3(0.0);

    for (int r = 0; r < volsteps; r++) {
        vec3 p = from + s * dir * 0.5;
        p = abs(vec3(tile) - mod(p, vec3(tile * 2.0)));

        float pa = 0.0;
        float a = 0.0;
        for (int i = 0; i < iterations; i++) {
            p = abs(p) / max(dot(p, p), 0.0001) - formuparam;
            a += abs(length(p) - pa);
            pa = length(p);
        }

        float dm = max(0.0, darkmatter - a * a * 0.001);
        a *= a * a;
        if (r > 6) fade *= 1.0 - dm;

        v += fade;
        v += vec3(s, s * s, s * s * s * s) * a * brightness * fade;
        fade *= distfading;
        s += stepsize;
    }

    v = mix(vec3(length(v)), v, saturation);
    vec3 col = clamp(v * 0.01, 0.0, 1.0);
    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(0.92, 0.16, length(uv));
    float alpha = smoothstep(0.012, 0.18, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
