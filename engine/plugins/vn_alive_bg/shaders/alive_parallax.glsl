// alive_parallax.glsl
// Cursor-driven depth parallax for background layer.
// Uses a local depth displacement model to avoid cross-region sampling artifacts.

in vec2 vTextureCoord;
in vec2 vFilterCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uDepthMap;
uniform float uPointerX;
uniform float uPointerY;
uniform float uStrength;
uniform float uDepthInfluence;
uniform float uInvertDepth;
uniform float uVerticalDamping;
uniform float uIdleAmount;
uniform float uTime;
uniform float uEdgeClamp;
uniform float uDepthCutoff;
uniform float uDepthFeather;
uniform float uDepthNormMin;
uniform float uDepthNormMax;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uDebugMode;
uniform float uDepthUvScaleX;
uniform float uDepthUvScaleY;
uniform float uDepthUvOffsetX;
uniform float uDepthUvOffsetY;

float saturate(float v) {
    return clamp(v, 0.0, 1.0);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 subtleDrift(vec2 uv, float time) {
    float seed = hash12(uv * vec2(37.0, 19.0));
    float a = sin((time * 0.36) + seed * 6.2831853 + uv.y * 4.3);
    float b = cos((time * 0.28) + seed * 6.2831853 + uv.x * 3.6);
    return vec2(a, b) * 0.14;
}

float sampleDepthRaw(vec2 uv) {
    vec2 depthUv = (uv * vec2(uDepthUvScaleX, uDepthUvScaleY)) + vec2(uDepthUvOffsetX, uDepthUvOffsetY);
    vec2 safeUv = clamp(depthUv, vec2(0.0005), vec2(0.9995));
    float d = texture(uDepthMap, safeUv).r;
    if (uInvertDepth > 0.5) {
        d = 1.0 - d;
    }
    return saturate(d);
}

void main() {
    vec2 uv = vFilterCoord;
    vec2 colorUv = vTextureCoord;
    float influence = saturate(uDepthInfluence);

    // Base depth and an adapted "far metric".
    // By default, we bias movement toward deeper/background regions for subtlety.
    float stableDepth = sampleDepthRaw(uv);
    float farMetric = saturate(1.0 - stableDepth);

    float normDen = max(0.0001, uDepthNormMax - uDepthNormMin);
    float farNorm = saturate((farMetric - uDepthNormMin) / normDen);

    float cutoff = saturate(uDepthCutoff);
    float feather = max(0.005, uDepthFeather);
    float farWeight = smoothstep(cutoff - feather, cutoff + feather, farNorm);
    farWeight *= (0.55 + 0.45 * farNorm);
    farWeight *= (0.80 + 0.20 * influence);

    float displacementWeight = farWeight * (0.75 + 0.25 * influence);

    vec2 pointer = vec2(uPointerX, uPointerY * uVerticalDamping);
    vec2 drift = subtleDrift(uv, uTime) * uIdleAmount;
    vec2 motion = pointer + drift;

    vec2 offset = motion * uStrength * displacementWeight;
    float edge = max(0.0001, uEdgeClamp);
    vec2 displacedUv = clamp(colorUv + offset, vec2(edge), vec2(1.0 - edge));

    if (uDebugMode > 0.5) {
        // Debug channels:
        // R = normalized far metric (where background-depth exists)
        // G = final displacement weight (where parallax is allowed)
        // B = displacement magnitude
        float dispViz = saturate(length(offset) / max(0.0001, uStrength * 1.25));
        finalColor = vec4(farNorm, displacementWeight, dispViz, 1.0);
        return;
    }

    finalColor = texture(uTexture, displacedUv);
}
