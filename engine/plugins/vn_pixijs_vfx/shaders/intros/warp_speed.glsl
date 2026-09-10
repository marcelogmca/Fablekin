// 'Warp Speed' by David Hoskins 2013.
// Inspired by Kali: https://www.shadertoy.com/view/ltl3WS
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Time speed reduced for intro readability.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    float time = (uTime + 29.0) * 18.0;

    float s = 0.0;
    float v = 0.0;
    vec2 uv = (-resolution + 2.0 * fragCoord) / max(1.0, resolution.y);
    float t = time * 0.005;
    uv.x += sin(t) * 0.3;
    float si = sin(t * 1.5);
    float co = cos(t);
    uv *= mat2(co, si, -si, co);

    vec3 col = vec3(0.0);
    vec3 init = vec3(0.25, 0.25 + sin(time * 0.001) * 0.1, time * 0.0008);

    for (int r = 0; r < 84; r++) {
        vec3 p = init + s * vec3(uv, 0.143);
        p.z = mod(p.z, 2.0);
        for (int i = 0; i < 10; i++) {
            p = abs(p * 2.04) / max(dot(p, p), 0.0001) - 0.75;
        }
        v += length(p * p) * smoothstep(0.0, 0.5, 0.9 - s) * 0.002;
        col += vec3(v * 0.8, 1.1 - s * 0.5, 0.7 + v * 0.5) * v * 0.013;
        s += 0.01;
    }

    col = clamp(col, 0.0, 1.0);
    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.2, 0.16, length(uv));
    float alpha = smoothstep(0.015, 0.55, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
