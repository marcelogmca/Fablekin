// alive_gi.glsl
// Emitter-gated depth-aware GI with smooth isotropic sampling.
// No directional wedge/ray geometry to avoid triangular artifacts.

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uDepthMap;
uniform float uRadius;
uniform float uIntensity;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uTime;
uniform float uSceneDarkness;

float saturate(float v) {
    return clamp(v, 0.0, 1.0);
}

float emitterMask(vec3 c) {
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    float peak = max(c.r, max(c.g, c.b));
    float byLuma = smoothstep(0.58, 0.93, luma);
    float byPeak = smoothstep(0.76, 0.995, peak);
    return max(byLuma, byPeak);
}

vec2 dirFromAngle(float angle) {
    return vec2(cos(angle), sin(angle));
}

void main() {
    vec2 uv = vTextureCoord;
    vec2 texel = vec2(1.0 / uResolutionX, 1.0 / uResolutionY);

    vec3 centerColor = texture(uTexture, uv).rgb;
    float centerLuma = dot(centerColor, vec3(0.299, 0.587, 0.114));
    float centerDepth = texture(uDepthMap, uv).r;

    float dR = texture(uDepthMap, clamp(uv + vec2(texel.x, 0.0), vec2(0.001), vec2(0.999))).r;
    float dL = texture(uDepthMap, clamp(uv - vec2(texel.x, 0.0), vec2(0.001), vec2(0.999))).r;
    float dU = texture(uDepthMap, clamp(uv + vec2(0.0, texel.y), vec2(0.001), vec2(0.999))).r;
    float dD = texture(uDepthMap, clamp(uv - vec2(0.0, texel.y), vec2(0.001), vec2(0.999))).r;
    float depthGrad = saturate(length(vec2(dR - dL, dU - dD)) * 9.0);

    float sceneGate = saturate(uSceneDarkness * 1.28);
    if (sceneGate <= 0.01 || uIntensity <= 0.0001) {
        finalColor = vec4(0.0);
        return;
    }

    float angularOffset = sin(uTime * 0.25) * 0.33;

    // Emitter availability around this pixel.
    float coverage = emitterMask(centerColor) * 0.50;
    for (int i = 0; i < 16; i++) {
        float a = (float(i) / 16.0) * 6.2831853 + angularOffset;
        vec2 dir = dirFromAngle(a);
        for (int p = 1; p <= 3; p++) {
            float fp = float(p);
            vec2 sampleUv = clamp(uv + dir * texel * uRadius * (fp * 1.18), vec2(0.001), vec2(0.999));
            vec3 sampleColor = texture(uTexture, sampleUv).rgb;
            float probe = emitterMask(sampleColor) * exp(-fp * 0.62);
            coverage = max(coverage, probe);
        }
    }

    float coverageGate = smoothstep(0.015, 0.12, coverage);
    if (coverageGate <= 0.001) {
        finalColor = vec4(0.0);
        return;
    }

    // Smooth isotropic GI bleed.
    vec3 bleed = vec3(0.0);
    float wSum = 0.0;
    for (int ring = 1; ring <= 4; ring++) {
        float fr = float(ring);
        float ringDist = 0.65 + fr * 0.95;
        float ringWobble = 1.0 + 0.08 * sin(uTime * 0.9 + fr * 1.35);

        for (int i = 0; i < 16; i++) {
            float a = (float(i) / 16.0) * 6.2831853 + angularOffset;
            vec2 dir = dirFromAngle(a);
            vec2 sampleUv = clamp(uv + dir * texel * uRadius * ringDist * ringWobble, vec2(0.001), vec2(0.999));

            vec3 sampleColor = texture(uTexture, sampleUv).rgb;
            float sampleDepth = texture(uDepthMap, sampleUv).r;

            float emit = emitterMask(sampleColor);
            float depthW = exp(-abs(centerDepth - sampleDepth) * 9.4);
            float distW = exp(-fr * 0.52);
            float shapeW = mix(0.88, 1.18, depthGrad);
            float w = emit * depthW * distW * shapeW;

            bleed += sampleColor * w;
            wSum += w;
        }
    }

    if (wSum > 0.0) {
        bleed /= wSum;
    }

    float receiverDarkness = smoothstep(0.15, 0.95, 1.0 - centerLuma);
    float nightBoost = mix(0.82, 1.45, sceneGate);
    float pulse = 0.95 + 0.05 * sin(uTime * 1.42 + uv.x * 2.7 + uv.y * 3.1);

    vec3 gi = bleed * (uIntensity * 1.08 * receiverDarkness * nightBoost * pulse);
    vec3 combined = gi * coverageGate * sceneGate;
    combined = 1.0 - exp(-combined * 1.24);
    combined = max(combined, vec3(0.0));

    float peak = max(combined.r, max(combined.g, combined.b));
    if (peak <= 0.0020) {
        finalColor = vec4(0.0);
        return;
    }

    float alpha = saturate(smoothstep(0.006, 0.44, peak));
    finalColor = vec4(combined, alpha);
}
