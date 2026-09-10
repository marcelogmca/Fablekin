in vec2 vTextureCoord;

uniform float uTime;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;
uniform vec3 uBaseColor;
uniform float uTimeMultiplier;
uniform float uScaleMultiplier;
uniform vec2 uCameraPos;
uniform float uCameraScale;
uniform float uFlipY;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f*f*(3.0-2.0*f);

    return mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

float fbm(vec2 _st) {
    vec2 st = _st;
    float value = 0.0;
    float amplitude = .5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(st);
        st *= 2.;
        amplitude *= .5;
    }
    return value;
}

void main() {
    vec2 screenPos = vec2(vTextureCoord.x, mix(vTextureCoord.y, 1.0 - vTextureCoord.y, uFlipY)) * vec2(uResolutionX, uResolutionY);
    vec2 worldPos = (screenPos - uCameraPos) / uCameraScale;
    
    vec2 st = worldPos / max(uResolutionX, uResolutionY);
    st *= uScaleMultiplier;
    st.x *= uResolutionX / uResolutionY;

    // Dust motion: Slow horizontal drifting, very sublte vertical drift
    float timeX = uTime * uTimeMultiplier * 0.8;
    float timeY = uTime * abs(uTimeMultiplier) * 0.1;
    
    vec2 motion = vec2(timeX, timeY);
    
    // Create base dust layer using high-value FBM
    float n1 = fbm(st * 4.0 - motion);
    float n2 = fbm(st * 8.0 - motion * 1.5 + vec2(1.0, 2.0));
    
    // Combine layers to create streaks and granular dust
    float dust = (n1 * 0.6 + n2 * 0.4);
    
    // Sharpen to look more like particles/wisps rather than soft clouds
    dust = smoothstep(0.4, 0.8, dust);
    
    // Add horizontal streaking effect
    float streaks = fbm(vec2(st.x * 0.5 - motion.x, st.y * 10.0));
    dust *= smoothstep(0.3, 0.7, streaks);

    // Varying opacity across the screen for "gusts"
    float gust = fbm(st * 0.5 - motion * 0.2);
    gust = smoothstep(0.2, 0.8, gust);
    
    dust *= (gust * 0.6 + 0.4);

    vec3 rgbResult = uBaseColor * dust * 1.5;

    gl_FragColor = vec4(rgbResult, dust * uOpacity);
}
