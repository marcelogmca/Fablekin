// "RayMarching starting point"
// by Martijn Steinrucken aka The Art of Code/BigWings - 2020
// The MIT License
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// Email: countfrolic@gmail.com
// Twitter: @The_ArtOfCode
// YouTube: youtube.com/TheArtOfCodeIsCool
// Facebook: https://www.facebook.com/groups/theartofcode/
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - iMouse and iChannel0 dependencies removed.
// - Added alpha output so it can render between background and character sprites.

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

#define MAX_STEPS 88
#define MAX_DIST 10.0
#define SURF_DIST 0.002

mat2 Rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.2831853 * (c * t + d));
}

float GetDist(vec3 p) {
    vec2 uv = p.xz;
    uv.x = abs(uv.x);

    float time = 12.0 + uTime;
    vec2 q = vec2(1.0, 0.0);
    float th = 0.4 * p.y - 0.6 * time;
    float m = -0.0 * length(uv) + 1.8;

    for (int i = 0; i < 7; i++) {
        uv -= m * q;
        th += 0.5 * p.y + 0.05 * time;
        uv = Rot(th) * uv;
        uv.x = abs(uv.x);
        m *= 0.05 * cos(8.0 * length(uv)) + 0.55;
    }

    float d = length(uv) - 2.0 * m;
    return 0.5 * d;
}

float RayMarch(vec3 ro, vec3 rd) {
    float dO = 0.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = GetDist(p);
        dO += dS;
        if (dO > MAX_DIST || abs(dS) < SURF_DIST) break;
    }

    return dO;
}

vec3 GetNormal(vec3 p) {
    float d = GetDist(p);
    vec2 e = vec2(0.001, 0.0);

    vec3 n = d - vec3(
        GetDist(p - e.xyy),
        GetDist(p - e.yxy),
        GetDist(p - e.yyx)
    );

    return normalize(n);
}

vec3 GetRayDir(vec2 uv, vec3 p, vec3 l, float z) {
    vec3 f = normalize(l - p);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
    vec3 u = cross(f, r);
    vec3 c = f * z;
    vec3 i = c + uv.x * r + uv.y * u;
    return normalize(i);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - 0.5 * vec2(uResolutionX, uResolutionY)) / max(1.0, uResolutionY);

    float cameraRadius = 5.5;
    vec3 ro = vec3(cameraRadius, 0.1 * uTime, 0.0);
    vec3 rd = GetRayDir(uv, ro, vec3(0.0, 0.1 * uTime, 0.0), 2.0);

    vec3 col = vec3(0.0);
    float d = RayMarch(ro, rd);

    if (d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = GetNormal(p);
        vec3 reflected = reflect(rd, n);

        float ambient = 0.28;
        float dif = max(dot(n, normalize(vec3(1.0, 2.0, 3.0))), 0.0);
        float rim = pow(1.0 - max(dot(-rd, n), 0.0), 2.2);
        float bands = 0.5 + 0.5 * sin(8.0 * reflected.y + 3.0 * reflected.x + uTime * 0.8);

        vec3 animePalette = pal(
            reflected.y * 0.55 + uTime * 0.035,
            vec3(0.48, 0.42, 0.58),
            vec3(0.52, 0.44, 0.36),
            vec3(1.00, 1.00, 1.00),
            vec3(0.00, 0.33, 0.66)
        );

        col = animePalette * (ambient + dif * 0.48 + rim * 0.75);
        col += vec3(0.35, 0.65, 1.0) * rim * bands * 0.45;
        col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
    }

    float vignette = smoothstep(0.95, 0.18, length(uv));
    float luminance = max(max(col.r, col.g), col.b);
    float alpha = smoothstep(0.05, 0.55, luminance) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
