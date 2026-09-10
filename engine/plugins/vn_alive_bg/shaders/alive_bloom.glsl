// alive_bloom.glsl
// Emitter-radiance bloom (smooth isotropic kernel, no wedge rays).

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uDepthMap;
uniform float uThreshold;
uniform float uKnee;
uniform float uIntensity;
uniform float uWarmthBias;
uniform float uFlickerStrength;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uFlickerTime;
uniform float uSceneDimming;

float saturate(float v) {
    return clamp(v, 0.0, 1.0);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 dirFromAngle(float angle) {
    return vec2(cos(angle), sin(angle));
}

float emitterMask(vec3 color) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float warmth = dot(color, vec3(0.60, 0.40, 0.10));
    float peak = max(color.r, max(color.g, color.b));

    float extracted = luma * (1.0 - uWarmthBias) + max(luma, warmth) * uWarmthBias;
    float softMask = smoothstep(uThreshold, uThreshold + uKnee, extracted);
    float hotMask = smoothstep(uThreshold + 0.08, min(1.0, uThreshold + 0.36), peak);
    return max(softMask * 0.8, hotMask);
}

void main() {
    vec2 uv = vTextureCoord;
    vec2 texel = vec2(1.0 / uResolutionX, 1.0 / uResolutionY);

    vec3 centerColor = texture(uTexture, uv).rgb;
    float centerDepth = texture(uDepthMap, uv).r;
    float centerLuma = dot(centerColor, vec3(0.299, 0.587, 0.114));

    float sceneActivity = max(0.06, uSceneDimming);
    float sampleRadius = mix(3.2, 8.6, saturate(uIntensity * 0.72 + (1.0 - sceneActivity) * 0.28));
    float angleOffset = sin(uFlickerTime * 0.22) * 0.33;

    float centerEmit = emitterMask(centerColor);
    float coverage = centerEmit * 0.5;
    float areaAccum = centerEmit;
    float areaCount = 1.0;
    for (int i = 0; i < 12; i++) {
        float a = (float(i) / 12.0) * 6.2831853 + angleOffset;
        vec2 dir = dirFromAngle(a);
        for (int p = 1; p <= 2; p++) {
            float fp = float(p);
            vec2 sampleUv = clamp(uv + dir * texel * sampleRadius * (fp * 1.45), vec2(0.001), vec2(0.999));
            float emitProbe = emitterMask(texture(uTexture, sampleUv).rgb);
            coverage = max(coverage, emitProbe * exp(-fp * 0.66));
            areaAccum += emitProbe;
            areaCount += 1.0;
        }
    }
    float areaMean = (areaCount > 0.0) ? (areaAccum / areaCount) : 0.0;

    if (coverage <= 0.002 || uIntensity <= 0.0001) {
        finalColor = vec4(0.0);
        return;
    }

    vec3 accum = vec3(0.0);
    float wSum = 0.0;

    for (int ring = 1; ring <= 4; ring++) {
        float fr = float(ring);
        float ringDist = 0.58 + fr * 0.92;
        float ringAnim = 1.0 + 0.06 * sin(uFlickerTime * 0.9 + fr * 1.2);

        for (int i = 0; i < 16; i++) {
            float a = (float(i) / 16.0) * 6.2831853 + angleOffset;
            vec2 dir = dirFromAngle(a);
            vec2 sampleUv = clamp(uv + dir * texel * sampleRadius * ringDist * ringAnim, vec2(0.001), vec2(0.999));

            vec3 sampleColor = texture(uTexture, sampleUv).rgb;
            float sampleDepth = texture(uDepthMap, sampleUv).r;

            float emitRaw = emitterMask(sampleColor);
            float contrastDen = max(0.10, 1.0 - areaMean * 0.62);
            float emitContrast = saturate((emitRaw - areaMean * 0.62) / contrastDen);
            float emit = max(emitRaw * 0.24, emitContrast);
            float depthW = exp(-abs(centerDepth - sampleDepth) * 8.7);
            float distW = exp(-fr * 0.56);
            float w = emit * depthW * distW;

            accum += sampleColor * w;
            wSum += w;
        }
    }

    vec3 halo = (wSum > 0.0) ? (accum / wSum) : vec3(0.0);
    float energy = saturate(wSum * 0.115);
    float localDarkBoost = mix(0.74, 1.20, smoothstep(0.10, 0.95, 1.0 - centerLuma));
    float depthSpread = mix(1.16, 0.86, centerDepth);

    float seedA = hash12(uv * vec2(uResolutionX, uResolutionY) * 0.065 + vec2(0.37, 1.11));
    float seedB = hash12(uv * vec2(uResolutionY, uResolutionX) * 0.041 + vec2(2.13, 0.53));
    float seed = mix(seedA, seedB, 0.5);
    float flickerWave =
        sin(uFlickerTime * 2.05 + seed * 6.2831853) +
        0.30 * sin(uFlickerTime * 4.9 + seed * 3.1415926) +
        0.12 * sin(uFlickerTime * 8.7 + seed * 1.5707963);
    flickerWave /= 1.60;
    float flicker = 1.0 + flickerWave * (uFlickerStrength * 0.62);

    float broadFieldReject = 1.0 - smoothstep(0.23, 0.63, areaMean);
    float hotCoreKeep = smoothstep(0.72, 0.98, centerEmit);
    float sourceSelect = max(broadFieldReject, hotCoreKeep * 0.78);

    float largeAreaLimiter = mix(1.0, 0.50, smoothstep(0.24, 0.86, areaMean));
    float smallSourceBoost = mix(1.18, 0.88, smoothstep(0.20, 0.74, areaMean));
    vec3 haloBloom = halo * energy * uIntensity * sceneActivity * localDarkBoost * depthSpread * flicker * largeAreaLimiter * smallSourceBoost * sourceSelect;

    // Anchor the center so dense bloom fields do not form dark-looking cavities.
    float coreWeight = mix(0.22, 0.10, smoothstep(0.18, 0.86, areaMean));
    vec3 coreBloom = centerColor * centerEmit * uIntensity * sceneActivity * localDarkBoost * flicker * coreWeight * sourceSelect;

    vec3 bloom = haloBloom + coreBloom;
    bloom = 1.0 - exp(-bloom * 1.24);
    bloom = max(bloom, coreBloom * 0.38);
    bloom = max(bloom, vec3(0.0));
    float bloomPeak = max(bloom.r, max(bloom.g, bloom.b));
    if (bloomPeak <= 0.0025) {
        finalColor = vec4(0.0);
        return;
    }

    float alphaCore = saturate(smoothstep(0.038, 0.34, bloomPeak));
    float alphaAreaLimiter = mix(1.0, 0.46, smoothstep(0.24, 0.86, areaMean));
    float alpha = alphaCore * alphaAreaLimiter;
    finalColor = vec4(bloom, alpha);
}
