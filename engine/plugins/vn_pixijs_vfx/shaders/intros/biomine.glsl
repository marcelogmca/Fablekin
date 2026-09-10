/*
    Biomine
    -------

    A biocooling system for a futuristic, off-world mine... or a feeding mechanism for an alien
    hatchery?

    Original Shadertoy text references:
    Cellular Tiling - Shane
    https://www.shadertoy.com/view/4scXz2

    Cellular Tiled Tunnel - Shane
    https://www.shadertoy.com/view/MscSDB

    Adapted for llmproj VN PixiJS intro overlays:
    - Shadertoy iTime/iResolution replaced with Pixi uniforms.
    - March, AO, thickness, and bump sampling reduced for fullscreen intro playback.
    - Added opacity/alpha handling so it can render between background and character sprites.
*/

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

#define FAR 44.0

float objID = 0.0;
float saveID = 0.0;

float hash(float n) {
    return fract(cos(n) * 45758.5453);
}

mat2 rot2(float a) {
    vec2 v = sin(vec2(1.570796, 0.0) + a);
    return mat2(v, -v.y, v.x);
}

float noise3D(vec3 p) {
    const vec3 s = vec3(7.0, 157.0, 113.0);
    vec3 ip = floor(p);
    p -= ip;
    vec4 h = vec4(0.0, s.yz, s.y + s.z) + dot(ip, s);
    p = p * p * (3.0 - 2.0 * p);
    h = mix(fract(sin(h) * 43758.5453), fract(sin(h + s.x) * 43758.5453), p.x);
    h.xy = mix(h.xz, h.yw, p.y);
    return mix(h.x, h.y, p.z);
}

float drawSphere(vec3 p) {
    p = fract(p) - 0.5;
    return dot(p, p);
}

float cellTile(vec3 p) {
    vec4 v;
    vec4 d;
    d.x = drawSphere(p - vec3(0.81, 0.62, 0.53));
    p.xy = vec2(p.y - p.x, p.y + p.x) * 0.7071;
    d.y = drawSphere(p - vec3(0.39, 0.2, 0.11));
    p.yz = vec2(p.z - p.y, p.z + p.y) * 0.7071;
    d.z = drawSphere(p - vec3(0.62, 0.24, 0.06));
    p.xz = vec2(p.z - p.x, p.z + p.x) * 0.7071;
    d.w = drawSphere(p - vec3(0.2, 0.82, 0.64));

    v.xy = min(d.xz, d.yw);
    v.z = min(max(d.x, d.y), max(d.z, d.w));
    v.w = max(v.x, v.y);
    d.x = min(v.z, v.w) - min(v.x, v.y);
    return d.x * 2.66;
}

vec2 path(float z) {
    float a = sin(z * 0.11);
    float b = cos(z * 0.14);
    return vec2(a * 4.0 - b * 1.5, b * 1.7 + a * 1.5);
}

float smaxP(float a, float b, float s) {
    float h = clamp(0.5 + 0.5 * (a - b) / s, 0.0, 1.0);
    return mix(b, a, h) + h * (1.0 - h) * s;
}

float mapScene(vec3 p) {
    p.xy -= path(p.z);
    p += cos(p.zxy * 1.5707963) * 0.2;

    float d = dot(cos(p * 1.5707963), sin(p.yzx * 1.5707963)) + 1.0;
    float bio = d + 0.25 + dot(sin(p * 1.0 + uTime * 6.283 + sin(p.yzx * 0.5)), vec3(0.033));
    float tun = smaxP(3.25 - length(p.xy - vec2(0.0, 1.0)) + 0.5 * cos(p.z * 3.14159 / 32.0), 0.75 - d, 1.0)
        - abs(1.5 - d) * 0.375;

    objID = step(tun, bio);
    return min(tun, bio);
}

float bumpSurf3D(vec3 p) {
    float noi = noise3D(p * 64.0);
    if (saveID > 0.5) {
        float sf = cellTile(p * 0.75);
        float vor = cellTile(p * 1.5);
        return sf * 0.66 + (vor * 0.94 + noi * 0.06) * 0.34;
    }

    p /= 3.0;
    float ct = cellTile(p * 2.0 + sin(p * 12.0) * 0.5) * 0.66
        + cellTile(p * 6.0 + sin(p * 36.0) * 0.5) * 0.34;
    return (1.0 - smoothstep(-0.2, 0.25, ct)) * 0.9 + noi * 0.1;
}

vec3 doBumpMap(vec3 p, vec3 nor, float bumpFactor) {
    const vec2 e = vec2(0.001, 0.0);
    float ref = bumpSurf3D(p);
    vec3 grad = (vec3(
        bumpSurf3D(p - e.xyy),
        bumpSurf3D(p - e.yxy),
        bumpSurf3D(p - e.yyx)
    ) - ref) / e.x;
    grad -= nor * dot(nor, grad);
    return normalize(nor + grad * bumpFactor);
}

float traceScene(vec3 ro, vec3 rd) {
    float marchT = 0.0;
    float h = 0.0;
    for (int i = 0; i < 54; i++) {
        h = mapScene(ro + rd * marchT);
        if (abs(h) < 0.002 * (marchT * 0.125 + 1.0) || marchT > FAR) break;
        marchT += step(h, 1.0) * h * 0.2 + h * 0.5;
    }
    return min(marchT, FAR);
}

vec3 getNormal(vec3 p) {
    const vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        mapScene(p + e.xyy) - mapScene(p - e.xyy),
        mapScene(p + e.yxy) - mapScene(p - e.yxy),
        mapScene(p + e.yyx) - mapScene(p - e.yyx)
    ));
}

float thickness(vec3 p, vec3 n, float maxDist, float falloff) {
    float ao = 0.0;
    for (int j = 1; j <= 4; j++) {
        float i = float(j);
        float l = (i * 0.75 + fract(cos(i) * 45758.5453) * 0.25) / 4.0 * maxDist;
        ao += (l + mapScene(p - n * l)) / pow(1.0 + l, falloff);
    }
    return clamp(1.0 - ao / 4.0, 0.0, 1.0);
}

float calculateAO(vec3 p, vec3 n) {
    float ao = 0.0;
    const float maxDist = 4.0;
    for (int j = 1; j <= 4; j++) {
        float i = float(j);
        float l = (i + hash(i)) * 0.5 / 4.0 * maxDist;
        ao += (l - mapScene(p + n * l)) / (1.0 + l);
    }
    return clamp(1.0 - ao / 4.0, 0.0, 1.0);
}

vec3 envMap(vec3 rd) {
    rd.y += uTime;
    rd /= 3.0;
    float ct = cellTile(rd * 2.0 + sin(rd * 12.0) * 0.5) * 0.66
        + cellTile(rd * 6.0 + sin(rd * 36.0) * 0.5) * 0.34;
    vec3 texCol = vec3(0.25, 0.2, 0.15) * (1.0 - smoothstep(-0.1, 0.3, ct)) + vec3(0.02, 0.02, 0.53) / 6.0;
    return smoothstep(vec3(0.0), vec3(1.0), texCol);
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - vec2(uResolutionX, uResolutionY) * 0.5) / max(1.0, uResolutionY);

    vec3 camPos = vec3(0.0, 1.0, uTime * 1.25);
    vec3 lookAt = camPos + vec3(0.0, 0.0, 0.1);
    vec3 lightPos = camPos + vec3(0.0, 0.5, 5.0);

    lookAt.xy += path(lookAt.z);
    camPos.xy += path(camPos.z);
    lightPos.xy += path(lightPos.z);

    float fov = 3.14159265 / 2.0;
    vec3 forward = normalize(lookAt - camPos);
    vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
    vec3 up = cross(forward, right);
    vec3 rd = normalize(forward + fov * uv.x * right + fov * uv.y * up);
    rd.xy = rot2(path(lookAt.z).x / 16.0) * rd.xy;

    float hitT = traceScene(camPos, rd);
    saveID = objID;

    vec3 sceneCol = vec3(0.0);
    if (hitT < FAR) {
        vec3 sp = hitT * rd + camPos;
        vec3 sn = getNormal(sp);
        sn = saveID > 0.5
            ? doBumpMap(sp, sn, 0.16)
            : doBumpMap(sp, sn, 0.006);

        float ao = calculateAO(sp, sn);
        vec3 ld = lightPos - sp;
        float lightDist = max(length(ld), 0.001);
        ld /= lightDist;

        float atten = 1.0 / (1.0 + lightDist * 0.25);
        float ambience = 0.5;
        float diff = max(dot(sn, ld), 0.0);
        float spec = pow(max(dot(reflect(-ld, sn), -rd), 0.0), 32.0);
        float fre = pow(clamp(dot(sn, rd) + 1.0, 0.0, 1.0), 1.0);

        vec3 texCol;
        if (saveID > 0.5) {
            texCol = vec3(0.3) * (noise3D(sp * 24.0) * 0.66 + noise3D(sp * 48.0) * 0.34) * (1.0 - cellTile(sp * 12.0) * 0.75);
            texCol *= smoothstep(-0.1, 0.5, cellTile(sp * 0.75) * 0.66 + cellTile(sp * 1.5) * 0.34) * 0.85 + 0.15;
        } else {
            vec3 sps = sp / 3.0;
            float ct = cellTile(sps * 2.0 + sin(sps * 12.0) * 0.5) * 0.66
                + cellTile(sps * 6.0 + sin(sps * 36.0) * 0.5) * 0.34;
            texCol = vec3(0.35, 0.25, 0.2) * (1.0 - smoothstep(-0.1, 0.25, ct)) + vec3(0.1, 0.01, 0.004);
        }

        vec3 hf = normalize(ld + sn);
        float th = thickness(sp, sn, 1.0, 1.0);
        float tdiff = pow(clamp(dot(rd, -hf), 0.0, 1.0), 1.0);
        float trans = pow(tdiff * th, 4.0);

        sceneCol = texCol * (diff + ambience) + vec3(0.7, 0.9, 1.0) * spec;
        if (saveID < 0.5) sceneCol += vec3(0.7, 0.9, 1.0) * spec * spec;
        sceneCol += texCol * vec3(0.8, 0.95, 1.0) * pow(fre, 4.0) * 2.0;
        sceneCol += vec3(1.0, 0.07, 0.15) * trans * 1.5;

        if (saveID < 0.5) {
            vec3 ref = reflect(rd, sn);
            sceneCol += envMap(ref) * 0.5;
            ref = refract(rd, sn, 1.0 / 1.3);
            sceneCol += envMap(ref) * vec3(2.0, 0.2, 0.3) * 1.5;
        }

        sceneCol *= atten * ao;
    }

    vec3 sky = vec3(2.0, 0.9, 0.8);
    sceneCol = mix(sky, sceneCol, 1.0 / (hitT * hitT / FAR / FAR * 8.0 + 1.0));

    vec3 color = sqrt(clamp(sceneCol, 0.0, 1.0));
    float lum = max(max(color.r, color.g), color.b);
    float vignette = smoothstep(1.12, 0.16, length(uv));
    float alpha = smoothstep(0.03, 0.86, lum) * vignette * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
}
