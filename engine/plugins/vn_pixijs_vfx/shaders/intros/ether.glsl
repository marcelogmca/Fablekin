// Ether by nimitz 2014 (twitter: @stormoid)
// https://www.shadertoy.com/view/MsjSW3
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License
// Contact the author for other licensing options.
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Renamed compact helper symbols to avoid wrapper/name collisions.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

mat2 etherRot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

float etherMap(vec3 p, float time) {
    p.xz *= etherRot(time * 0.4);
    p.xy *= etherRot(time * 0.3);
    vec3 q = p * 2.0 + time;
    return length(p + vec3(sin(time * 0.7))) * log(length(p) + 1.0)
        + sin(q.x + sin(q.z + sin(q.y))) * 0.5
        - 1.0;
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = fragCoord.xy / max(1.0, uResolutionY) - vec2(0.9, 0.5);
    float time = uTime;

    vec3 color = vec3(0.0);
    float depth = 2.5;

    for (int i = 0; i <= 5; i++) {
        vec3 rayPos = vec3(0.0, 0.0, 5.0) + normalize(vec3(uv, -1.0)) * depth;
        float rz = etherMap(rayPos, time);
        float f = clamp((rz - etherMap(rayPos + 0.1, time)) * 0.5, -0.1, 1.0);
        vec3 light = vec3(0.1, 0.3, 0.4) + vec3(5.0, 2.5, 3.0) * f;
        color = color * light + smoothstep(2.5, 0.0, rz) * 0.7 * light;
        depth += min(rz, 1.0);
    }

    color = clamp(color, 0.0, 1.0);
    float lum = max(max(color.r, color.g), color.b);
    float vignette = smoothstep(1.08, 0.18, length(uv));
    float alpha = smoothstep(0.02, 0.72, lum) * vignette * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
}
