/*
 * License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
 * Created by bal-khan.
 *
 * Adapted for llmproj VN PixiJS intro overlays:
 * - Shadertoy iTime/iResolution replaced with Pixi uniforms.
 * - March count reduced for fullscreen intro playback.
 * - Added opacity/alpha handling so it can render between background and character sprites.
 */

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

#define LIGHT

const float I_MAX = 128.0;
const float E = 0.0001;
const float FAR_DIST = 50.0;
const float PI = 3.14159;
const float TAU = PI * 2.0;

float gTime;
vec3 retCol;
vec3 lightAmount;

vec2 modA(vec2 p, float count) {
    float an = TAU / count;
    float a = atan(p.y, p.x) + an * 0.5;
    a = mod(a, an) - an * 0.5;
    return vec2(cos(a), sin(a)) * length(p);
}

float scene(vec3 p) {
    float var;
    vec3 op = p;

    var = atan(p.x, p.y);
    var = cos(var + floor(p.z) + uTime * (mod(floor(p.z), 2.0) - 1.0 == 0.0 ? -1.0 : 1.0));

    retCol = 1.0 - vec3(0.5 - var * 0.5, 0.5, 0.3 + var * 0.5);

    float mind = length(p.xy) - 1.0 + 0.1 * var;
    mind = max(mind, -(length(p.xy) - 0.9 + 0.1 * var));

    p.xy = modA(p.yx, 50.0 + 50.0 * sin(p.z * 0.25));
    p.z = fract(p.z * 3.0) - 0.5;

    float distCylinder = 1e5;
    if (var != 0.0) {
        distCylinder = length(p.zy) - 0.0251 - 0.25 * sin(op.z * 5.5);
        distCylinder = max(distCylinder, -p.x + 0.4 + clamp(var, 0.0, 1.0));
    }

    mind = min(mind, distCylinder);
    lightAmount += vec3(0.5, 0.8, 0.5) * (var != 0.0 ? 1.0 : 0.0) * 0.0125
        / (0.01 + max(mind - var * 0.1, 0.0001) * max(mind - var * 0.1, 0.0001));

    return mind;
}

vec2 march(vec3 pos, vec3 dir) {
    vec2 dist = vec2(0.0);
    float steps = 0.0;

    for (int stepIndex = 0; stepIndex < 128; stepIndex++) {
        vec3 p = pos + dir * dist.y;
        dist.x = scene(p);
        dist.y += dist.x * 0.2;
        steps += 1.0;
        if (dist.x < E || dist.y > FAR_DIST) break;
    }

    return vec2(steps, dist.y);
}

vec3 camera(vec2 uv) {
    const float fov = 1.0;
    vec3 forw = vec3(0.0, 0.0, -1.0);
    vec3 right = vec3(1.0, 0.0, 0.0);
    vec3 up = vec3(0.0, 1.0, 0.0);
    return normalize(uv.x * right + uv.y * up + fov * forw);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - resolution * 0.5) / max(1.0, resolution.y);

    gTime = uTime * 0.125;
    vec3 col = vec3(0.0);
    vec3 dir = camera(uv);
    vec3 pos = vec3(0.0);
    pos.z = 4.5 - uTime * 1.6;

    lightAmount = vec3(0.0);
    vec2 inter = march(pos, dir);
    if (inter.y <= FAR_DIST) {
        col = retCol * (1.0 - inter.x * 0.0025);
    }
    col += lightAmount * 0.005125;

    col = clamp(col, 0.0, 1.0);
    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.08, 0.14, length(uv));
    float alpha = smoothstep(0.02, 0.72, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
