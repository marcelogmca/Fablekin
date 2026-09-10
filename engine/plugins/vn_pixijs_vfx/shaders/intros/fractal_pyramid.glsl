// "fractal pyramid"
// Created by bradjamesgrant in 2020-05-03
//
// Creating multiple shapes with one SDF evaluation by repeatedly rotating and folding space.
// Originally found on Shadertoy.
//
// SHADERDATA
// {
//   "title": "fractal pyramid",
//   "description": "",
//   "model": "car"
// }
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

vec3 palette(float d) {
    return mix(vec3(0.2, 0.7, 0.9), vec3(1.0, 0.0, 1.0), d);
}

vec2 rotate(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return p * mat2(c, s, -s, c);
}

float map(vec3 p) {
    for (int i = 0; i < 8; ++i) {
        float t = uTime * 0.2;
        p.xz = rotate(p.xz, t);
        p.xy = rotate(p.xy, t * 1.89);
        p.xz = abs(p.xz);
        p.xz -= 0.5;
    }
    return dot(sign(p), p) / 5.0;
}

vec4 rm(vec3 ro, vec3 rd) {
    float t = 0.0;
    vec3 col = vec3(0.0);
    float d = 1.0;

    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * t;
        d = map(p) * 0.5;
        if (d < 0.02) {
            break;
        }
        if (d > 100.0) {
            break;
        }
        col += palette(length(p) * 0.1) / (400.0 * max(d, 0.001));
        t += d;
    }

    return vec4(col, 1.0 / (max(d, 0.001) * 100.0));
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - (vec2(uResolutionX, uResolutionY) / 2.0)) / max(1.0, uResolutionX);

    vec3 ro = vec3(0.0, 0.0, -50.0);
    ro.xz = rotate(ro.xz, uTime);

    vec3 cf = normalize(-ro);
    vec3 cs = normalize(cross(cf, vec3(0.0, 1.0, 0.0)));
    vec3 cu = normalize(cross(cf, cs));

    vec3 uuv = ro + cf * 3.0 + uv.x * cs + uv.y * cu;
    vec3 rd = normalize(uuv - ro);

    vec4 col = rm(ro, rd);
    float vignette = smoothstep(0.72, 0.16, length(uv));
    float alpha = clamp(col.a, 0.0, 1.0) * vignette * uOpacity;

    gl_FragColor = vec4(col.rgb * alpha, alpha);
}
