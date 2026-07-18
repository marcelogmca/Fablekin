// "shader_art"
// This animation is the material of the author's first YouTube tutorial about creative coding.
// Video URL: https://youtu.be/f4s1h2YETNY
//
// Palette reference:
// https://iquilezles.org/articles/palettes/
//
// Shadertoy reference:
// https://www.shadertoy.com/view/mtyGWy
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Added opacity/alpha handling so it can render between background and character sprites.
// - Softened/faded for atmospheric intro layering.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);

    return a + b * cos(6.28318 * (c * t + d));
}

vec3 sampleShaderArt(vec2 uv, vec2 uv0, float t) {
    vec2 localUv = uv;
    vec3 accumColor = vec3(0.0);

    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        localUv = fract(localUv * 1.5) - 0.5;

        float d = length(localUv) * exp(-length(uv0));
        vec3 col = palette(length(uv0) + fi * 0.4 + t * 0.32);

        d = sin(d * 8.0 + t) / 8.0;
        d = abs(d);
        d = pow(0.0075 / max(d, 0.0001), 1.08);

        accumColor += col * d;
    }

    return accumColor;
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord * 2.0 - resolution) / max(1.0, uResolutionY);
    vec2 uv0 = uv;
    vec2 blurStep = vec2(1.75 / max(1.0, uResolutionY), 0.0);

    vec3 accumColor = sampleShaderArt(uv, uv0, uTime) * 0.42;
    accumColor += sampleShaderArt(uv + blurStep.xy, uv0, uTime) * 0.16;
    accumColor += sampleShaderArt(uv - blurStep.xy, uv0, uTime) * 0.16;
    accumColor += sampleShaderArt(uv + blurStep.yx, uv0, uTime) * 0.16;
    accumColor += sampleShaderArt(uv - blurStep.yx, uv0, uTime) * 0.16;
    accumColor *= 0.54;

    float vignette = smoothstep(1.25, 0.18, length(uv0));
    float glow = max(max(accumColor.r, accumColor.g), accumColor.b);
    float alpha = smoothstep(0.025, 0.95, glow) * vignette * uOpacity * 0.58;

    gl_FragColor = vec4(accumColor * alpha, alpha);
}
