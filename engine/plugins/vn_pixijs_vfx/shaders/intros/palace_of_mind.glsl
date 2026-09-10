// Palace of Mind
// Created by butadiene in 2020-02-17
// Originally found on Shadertoy.
//
// Adapted for llmproj VN PixiJS intro overlays:
// - Shadertoy iTime/iResolution replaced with Pixi uniforms.
// - Time is intentionally slowed to 20% of the original speed for calmer intro use.
// - Added opacity/alpha handling so it can render between background and character sprites.

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

const float TIME_SCALE = 0.2;

vec2 rot(vec2 p, float r) {
    mat2 m = mat2(cos(r), sin(r), -sin(r), cos(r));
    return m * p;
}

float hasira(vec3 p, vec3 s) {
    vec2 q = abs(p.xy);
    vec2 m = max(s.xy - q.xy, vec2(0.0));
    return length(max(q.xy - s.xy, 0.0)) - min(m.x, m.y);
}

float closs(vec3 p, vec3 s) {
    float d1 = hasira(p, s);
    float d2 = hasira(p.yzx, s.yzx);
    float d3 = hasira(p.zxy, s.zxy);
    return min(min(d1, d2), d3);
}

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

float distField(vec3 p, float t) {
    float k = 1.2;
    vec3 sxyz = floor((p.xyz - 0.5 * k) / k) * k;
    float sz = rand(sxyz.xz);

    p.xy = rot(p.xy, t * sign(sz - 0.5) * (sz * 0.5 + 0.7));
    p.z += t * sign(sz - 0.5) * (sz * 0.5 + 0.7);
    p = mod(p, k) - 0.5 * k;

    float s = 7.0;
    p *= s;
    p.yz = rot(p.yz, 0.76);

    for (int i = 0; i < 4; i++) {
        p = abs(p) - 0.4 + (0.25 + 0.1 * sz) * sin(t * (0.5 + sz));
        p.xy = rot(p.xy, t * (0.7 + sz));
        p.yz = rot(p.yz, 1.3 * t + sz);
    }

    return closs(p, vec3(0.06)) / s;
}

vec3 gn(vec3 p, float t) {
    const float h = 0.001;
    const vec2 k = vec2(1.0, -1.0);
    return normalize(
        k.xyy * distField(p + k.xyy * h, t)
        + k.yyx * distField(p + k.yyx * h, t)
        + k.yxy * distField(p + k.yxy * h, t)
        + k.xxx * distField(p + k.xxx * h, t)
    );
}

vec3 light(vec3 p, vec3 view, float t) {
    vec3 normal = gn(p, t);
    float vn = clamp(dot(-view, normal), 0.0, 1.0);
    vec3 ld = normalize(vec3(-1.0, 0.9 * sin(t * 0.5) - 0.1, 0.0));
    float NdotL = max(dot(ld, normal), 0.0);
    vec3 R = normalize(-ld + NdotL * normal * 2.0);
    float spec = pow(max(dot(-view, R), 0.0), 20.0) * clamp(sign(NdotL), 0.0, 1.0);
    vec3 col = vec3(1.0) * (pow(vn, 2.0) * 0.9 + spec * 0.3);

    float k = 0.5;
    float ks = 0.9;
    vec2 sxz = floor((p.xz - 0.5 * ks) / ks) * ks;
    float sx = rand(sxz);
    float sy = rand(sxz + 100.1);
    float stripe = mod(abs(p.y * sx + p.x * sy) + t * sign(sx - 0.5) * 0.4, k) - 0.5 * k;
    float emissive = clamp(0.001 / max(abs(stripe), 0.0001), 0.0, 1.0);

    return clamp(col * vec3(0.3, 0.5, 0.9) * 0.7 + emissive * vec3(0.2, 0.2, 1.0), 0.0, 1.0);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 p = (fragCoord.xy * 2.0 - vec2(uResolutionX, uResolutionY)) / max(1.0, uResolutionY);
    float tSlow = uTime * TIME_SCALE;

    vec3 tn = tSlow * vec3(0.0, 0.0, 1.0) * 0.3;
    float tk = tSlow * 0.3;
    vec3 ro = vec3(cos(tk), 0.2 * sin(tk), sin(tk)) + tn;
    vec3 ta = vec3(0.0) + tn;

    vec3 cdir = normalize(ta - ro);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(cdir, up));
    up = normalize(cross(side, cdir));

    float fov = 1.3;
    vec3 rd = normalize(p.x * side + p.y * up + cdir * fov);

    float d = 0.0;
    float marchT = 0.1;
    float far = 18.0;
    float near = marchT;
    float hit = 0.0001;

    for (int i = 0; i < 100; i++) {
        d = distField(ro + rd * marchT, tSlow * 0.05 + 50.0);
        marchT += d;
        if (hit > d) break;
        if (marchT > far) break;
    }

    vec3 bcol = vec3(0.1, 0.1, 0.8);
    vec3 col = light(ro + rd * marchT, rd, tSlow);
    float depthFade = pow(clamp((far - marchT) / (far - near), 0.0, 1.0), 2.0);
    col = mix(bcol, col, depthFade);
    col = pow(max(col, vec3(0.0)), vec3(2.2)) * 2.0;
    col = clamp(col, 0.0, 1.0);

    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.10, 0.18, length(p));
    float alpha = smoothstep(0.03, 0.72, lum) * depthFade * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
