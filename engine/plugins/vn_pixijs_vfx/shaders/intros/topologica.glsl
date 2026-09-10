/*--------------------------------------------------------------------------------------
License CC0 - http://creativecommons.org/publicdomain/zero/1.0/
To the extent possible under law, the author(s) have dedicated all copyright and related
and neighboring rights to this software to the public domain worldwide.

Topologica by Otavio Good.

Adapted for llmproj VN PixiJS intro overlays:
- Shadertoy iTime/iResolution/iMouse/iFrame replaced with Pixi uniforms/default camera motion.
- Fixed loop count kept moderate for intro playback.
- Added opacity/alpha handling so it can render between background and character sprites.
--------------------------------------------------------------------------------------*/

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

const float PI = 3.14159265;

float hash3d(vec3 uv) {
    float f = uv.x + uv.y * 37.0 + uv.z * 521.0;
    return fract(cos(f * 3.333) * 100003.9);
}

float mixP(float f0, float f1, float a) {
    return mix(f0, f1, a * a * (3.0 - 2.0 * a));
}

float noise(vec3 uv) {
    const vec2 zeroOne = vec2(0.0, 1.0);
    vec3 fr = fract(uv.xyz);
    vec3 fl = floor(uv.xyz);
    float h000 = hash3d(fl);
    float h100 = hash3d(fl + zeroOne.yxx);
    float h010 = hash3d(fl + zeroOne.xyx);
    float h110 = hash3d(fl + zeroOne.yyx);
    float h001 = hash3d(fl + zeroOne.xxy);
    float h101 = hash3d(fl + zeroOne.yxy);
    float h011 = hash3d(fl + zeroOne.xyy);
    float h111 = hash3d(fl + zeroOne.yyy);
    return mixP(
        mixP(mixP(h000, h100, fr.x), mixP(h010, h110, fr.x), fr.y),
        mixP(mixP(h001, h101, fr.x), mixP(h011, h111, fr.x), fr.y),
        fr.z
    );
}

float density(vec3 p) {
    float finalNoise = noise(p * 0.06125);
    float other = noise(p * 0.06125 + 1234.567);
    other -= 0.5;
    finalNoise -= 0.5;
    finalNoise = 0.1 / max(abs(finalNoise * finalNoise * other), 0.0001);
    finalNoise += 0.5;
    return finalNoise * 0.0001;
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 uv = fragCoord.xy / resolution.xy * 2.0 - 1.0;

    vec3 camUp = vec3(0.0, 1.0, 0.0);
    vec3 camLookat = vec3(0.0);

    float mx = uTime * 0.13;
    float my = sin(uTime * 0.03) * 0.2 + 0.2;
    vec3 camPos = vec3(cos(my) * cos(mx), sin(my), cos(my) * sin(mx)) * 200.2;

    vec3 camVec = normalize(camLookat - camPos);
    vec3 sideNorm = normalize(cross(camUp, camVec));
    vec3 upNorm = cross(camVec, sideNorm);
    vec3 worldFacing = camPos + camVec;
    vec3 worldPix = worldFacing + uv.x * sideNorm * (resolution.x / max(1.0, resolution.y)) + uv.y * upNorm;
    vec3 relVec = normalize(worldPix - camPos);

    float rayT = 0.0;
    float inc = 0.02;
    float maxDepth = 70.0;
    float accumDensity = 0.0;

    for (int i = 0; i < 37; i++) {
        if (rayT > maxDepth) break;
        vec3 pos = camPos + relVec * rayT;
        float temp = density(pos);
        inc = 1.9 + temp * 0.05;
        accumDensity += temp * inc;
        rayT += inc;
    }

    vec3 color = vec3(0.01, 0.1, 1.0) * accumDensity * 0.2;
    color = sqrt(clamp(color, 0.0, 1.0));

    float lum = max(max(color.r, color.g), color.b);
    float vignette = smoothstep(1.2, 0.14, length(uv));
    float alpha = smoothstep(0.008, 0.42, lum) * vignette * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
}
