// Zippy Zaps
// Created by SnoopethDuckDuck in 2024-06-01
// Originally found on Shadertoy.
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Rewrote the compact loop into explicit GLSL for WebGL compiler stability.
// - Uses a bounded tanh approximation to reduce black artifact risk.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

vec2 stanh(vec2 x) {
    vec2 x2 = x * x;
    return clamp(x * (27.0 + x2) / (27.0 + 9.0 * x2), -1.0, 1.0);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 u = 0.2 * (fragCoord + fragCoord - resolution) / max(1.0, resolution.y);

    vec2 v = resolution;
    vec4 z = vec4(1.0, 2.0, 3.0, 0.0);
    vec4 outColor = z;
    float a = 0.5;
    float time = uTime;

    for (int j = 0; j < 18; j++) {
        float i = float(j + 1);
        time += 1.0;
        a += 0.03;

        v = cos(time - 7.0 * u * pow(a, i)) - 5.0 * u;

        mat2 warp = mat2(cos(i + 0.02 * time - z.wxzw * 11.0));
        u *= warp;
        float fold = 40.0 * dot(u, u);
        u += stanh(fold * cos(100.0 * u.yx + time)) / 200.0
            + 0.2 * a * u
            + cos(4.0 / exp(dot(outColor, outColor) / 100.0) + time) / 300.0;

        vec2 denom = (1.0 + i * dot(v, v))
            * sin(1.5 * u / max(0.05, 0.5 - dot(u, u)) - 9.0 * u.yx + time);
        outColor += (1.0 + cos(z + time)) / max(length(denom), 0.001);
    }

    outColor = 25.6 / (min(outColor, 13.0) + 164.0 / max(outColor, vec4(0.001)))
        - dot(u, u) / 250.0;

    vec3 color = clamp(outColor.rgb, 0.0, 1.0);
    float lum = max(max(color.r, color.g), color.b);
    vec2 centered = (fragCoord * 2.0 - resolution) / max(1.0, resolution.y);
    float vignette = smoothstep(1.18, 0.12, length(centered));
    float alpha = smoothstep(0.03, 0.82, lum) * vignette * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
}
