
precision highp float;

in vec2 vTextureCoord;
uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;
uniform float uFlipY;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float splatter(vec2 uv, vec2 pos, float size, float seed) {
    vec2 d = uv - pos;
    d.x *= uResolutionX / uResolutionY;
    float dist = length(d);
    
    float angle = atan(d.y, d.x);
    float n = noise(vec2(angle * 3.0, seed));
    float n2 = noise(vec2(angle * 8.0, seed + 1.23));
    
    float threshold = size * (0.8 + 0.4 * n + 0.2 * n2);
    return smoothstep(threshold, threshold * 0.5, dist);
}

void main() {
    // Coordinate mapping identical to clouds/fog for consistency
    vec2 uv = vTextureCoord;
    if (uFlipY > 0.5) {
        uv.y = 1.0 - uv.y;
    }
    
    // 1. Red Vignette
    vec2 centeredUv = uv * 2.0 - 1.0;
    centeredUv.x *= uResolutionX / uResolutionY;
    float vignette = length(centeredUv);
    float vignetteAlpha = smoothstep(0.6, 1.8, vignette);
    
    // Pulsate the vignette slightly
    float pulse = 0.85 + 0.15 * sin(uTime * 0.003);
    vignetteAlpha *= pulse;
    
    // 2. Corner Splatters
    float splatters = 0.0;
    
    // Corner positions 
    splatters += splatter(uv, vec2(0.05, 0.05), 0.12, 123.45);
    splatters += splatter(uv, vec2(0.95, 0.05), 0.15, 987.65);
    splatters += splatter(uv, vec2(0.05, 0.95), 0.18, 555.55);
    splatters += splatter(uv, vec2(0.95, 0.95), 0.14, 888.88);

    // Combine and apply opacity
    // Increased intensity slightly to ensure it's visible even on darker backgrounds
    float finalAlpha = clamp(vignetteAlpha * 0.6 + splatters * 1.0, 0.0, 1.0) * uOpacity * 0.8;
    vec3 bloodRed = vec3(0.7, 0.0, 0.0);
    
    // Premultiplied alpha output
    gl_FragColor = vec4(bloodRed * finalAlpha, finalAlpha);
}
