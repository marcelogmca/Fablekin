/*
    Transparent Cube Field
    ----------------------

    Original by Shane. Related references in the original text:
    Crowded Cubes 2 - FabriceNeyret2
    https://www.shadertoy.com/view/ltBSRy

    Cloudy Spikeball - Duke
    https://www.shadertoy.com/view/MljXDw

    Transparent Lattice - Shane
    https://www.shadertoy.com/view/Xd3SDs

    Adapted for llmproj VN PixiJS intro overlays:
    - Shadertoy iTime/iResolution replaced with Pixi uniforms.
    - March count reduced slightly for intro playback.
    - Added opacity/alpha handling so it can render between background and character sprites.
*/

precision highp float;

in vec2 vTextureCoord;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

vec3 hash33(vec3 p) {
    float n = sin(dot(p, vec3(7.0, 157.0, 113.0)));
    return fract(vec3(2097152.0, 262144.0, 32768.0) * n);
}

float mapCubeField(vec3 p) {
    vec3 o = hash33(floor(p)) * 0.2;
    p = fract(p + o) - 0.5;
    float r = dot(p, p) - 0.21;
    p = abs(p);
    return max(max(p.x, p.y), p.z) * 0.95 + r * 0.05 - 0.21;
}

void main() {
    vec2 fragCoord = vTextureCoord * vec2(uResolutionX, uResolutionY);
    vec2 resolution = vec2(uResolutionX, uResolutionY);
    vec2 uv = (fragCoord - resolution * 0.5) / max(1.0, resolution.y);

    vec3 rd = normalize(vec3(uv, (1.0 - dot(uv, uv) * 0.5) * 0.5));
    vec3 ro = vec3(0.0, 0.0, uTime * 2.2);
    vec3 col = vec3(0.0);

    float cs = cos(uTime * 0.31);
    float si = sin(uTime * 0.31);
    rd.xz = mat2(cs, si, -si, cs) * rd.xz;
    rd.xy = mat2(cs, si, -si, cs) * rd.xy;
    rd *= 0.985 + hash33(rd) * 0.03;

    float rayT = 0.0;
    float layers = 0.0;
    float thD = 0.035;

    for (int i = 0; i < 48; i++) {
        if (layers > 15.0 || col.x > 1.0 || rayT > 10.0) break;
        vec3 sp = ro + rd * rayT;
        float d = mapCubeField(sp);
        float aD = (thD - abs(d) * 15.0 / 16.0) / thD;

        if (aD > 0.0) {
            col += aD * aD * (3.0 - 2.0 * aD) / (1.0 + rayT * rayT * 0.25) * 0.2;
            layers += 1.0;
        }

        rayT += max(abs(d) * 0.7, thD * 1.5);
    }

    col = max(col, 0.0);
    col = mix(
        col,
        pow(col.x * vec3(1.5, 1.0, 1.0), vec3(1.0, 2.5, 12.0)),
        dot(sin(rd.yzx * 8.0 + sin(rd.zxy * 8.0)), vec3(0.1666)) + 0.4
    );
    col = mix(
        col,
        vec3(col.x * col.x * 0.85, col.x, col.x * col.x * 0.3),
        dot(sin(rd.yzx * 4.0 + sin(rd.zxy * 4.0)), vec3(0.1666)) + 0.25
    );

    col = clamp(col, 0.0, 1.0);
    float lum = max(max(col.r, col.g), col.b);
    float vignette = smoothstep(1.18, 0.14, length(uv));
    float alpha = smoothstep(0.015, 0.62, lum) * vignette * uOpacity;

    gl_FragColor = vec4(col * alpha, alpha);
}
