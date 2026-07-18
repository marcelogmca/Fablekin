// Gilded Kaleidoscope
// Original llmproj intro shader.
//
// Art-deco inspired radial geometry for Arc Cinematics:
// - Built from radial sector folding, nested polygon bands, and soft chromatic offsets.
// - Uses Pixi uniforms directly.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

mat2 rotate2(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

vec2 foldSector(vec2 p, float sectors) {
    float angle = TAU / sectors;
    float a = atan(p.y, p.x);
    float r = length(p);
    a = mod(a + angle * 0.5, angle) - angle * 0.5;
    return vec2(cos(a), sin(a)) * r;
}

float polygonDistance(vec2 p, float sides) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float sector = TAU / sides;
    return cos(floor(0.5 + a / sector) * sector - a) * r;
}

float band(float value, float center, float width, float softness) {
    float d = abs(value - center);
    return 1.0 - smoothstep(width, width + softness, d);
}

float decoLayer(vec2 p, float phase, float scale, float sides) {
    p *= scale;
    p = foldSector(p, sides);

    float radial = length(p);
    float poly = polygonDistance(p, 4.0 + mod(sides, 5.0));
    float spokes = band(abs(p.x), 0.0, 0.018 + 0.004 * sin(phase), 0.025);
    float rings = band(fract(radial * 2.8 + phase * 0.08), 0.5, 0.10, 0.10);
    float diamonds = band(fract(poly * 3.4 - phase * 0.04), 0.5, 0.08, 0.08);

    return clamp(spokes * 0.55 + rings * 0.48 + diamonds * 0.42, 0.0, 1.0);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord * 2.0 - resolution) / max(1.0, min(resolution.x, resolution.y));
    vec2 originalUv = uv;

    float time = uTime * 0.22;
    uv *= rotate2(sin(time * 0.31) * 0.22);
    uv *= 0.72 + 0.05 * sin(time * 0.47);

    vec3 color = vec3(0.0);
    float luma = 0.72;
    float scale = 1.0;

    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 p = uv * scale;
        p += vec2(sin(time * 0.61 + fi * 1.7), cos(time * 0.53 - fi * 1.1)) * 0.035;
        p *= rotate2(time * 0.08 + fi * 0.19);

        float base = decoLayer(p, time + fi * 0.7, 1.0 + fi * 0.16, 8.0 + mod(fi, 4.0));
        float red = decoLayer(p + originalUv * 0.012, time + fi * 0.8, 1.04 + fi * 0.15, 9.0 + mod(fi, 3.0));
        float blue = decoLayer(p - originalUv * 0.012, time + fi * 0.6, 0.96 + fi * 0.17, 7.0 + mod(fi, 5.0));

        vec3 paletteA = vec3(0.95, 0.68, 0.25);
        vec3 paletteB = vec3(0.12, 0.62, 0.86);
        vec3 paletteC = vec3(0.92, 0.18, 0.48);
        vec3 layerColor = vec3(red, base, blue) * mix(paletteA, paletteB, 0.45 + 0.35 * sin(time + fi));
        layerColor += paletteC * base * 0.18;

        color += layerColor * luma;
        luma *= 0.58;
        scale *= 1.34;
        uv *= rotate2(0.28 + sin(time * 0.17 + fi) * 0.16);
    }

    float vignette = smoothstep(1.45, 0.34, length(originalUv));
    float glow = max(max(color.r, color.g), color.b);
    color = pow(clamp(color, 0.0, 1.0), vec3(0.86, 0.92, 1.08));
    float alpha = smoothstep(0.035, 0.74, glow) * vignette * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
}
