out vec4 finalColor;
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

float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Low frequency noise for ash fading mask
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f*f*(3.0-2.0*f);

    return mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

void main() {
    vec2 screenPos = vec2(vTextureCoord.x, mix(vTextureCoord.y, 1.0 - vTextureCoord.y, uFlipY)) * vec2(uResolutionX, uResolutionY);
    vec2 worldPos = (screenPos - uCameraPos) / uCameraScale;
    
    vec2 st = worldPos / max(uResolutionX, uResolutionY);
    st *= uScaleMultiplier;
    st.x *= uResolutionX / uResolutionY;

    float emberTotal = 0.0;
    
    // 3 distinct layers of Depth
    for (float i = 0.0; i < 3.0; i++) {
        float speedScale = 0.5 + i * 0.3; // Slower rise
        float sizeScale = 30.0 + i * 15.0; // Cellular geometry size
        
        // Upward motion with erratic horizontal sway (heat distortion)
        vec2 motion = vec2(
            sin(uTime * 2.0 + i * 3.14) * 0.15 + cos(uTime * 1.5 - i) * 0.1, 
            -uTime * uTimeMultiplier * speedScale // Upward progression
        );
        
        vec2 layerSt = st * sizeScale + motion;
        
        vec2 gridId = floor(layerSt);
        vec2 gridUv = fract(layerSt);
        
        float cellHash = hash12(gridId + vec2(i));
        
        vec2 cellOffset = vec2(
            (hash12(gridId + vec2(10.0)) - 0.5) * 0.8,
            (hash12(gridId + vec2(20.0)) - 0.5) * 0.8
        );
        
        vec2 p = gridUv - 0.5 - cellOffset;
        
        // Distance field
        float dist = length(p);
        
        // Only 10% of cells contain an ember (sparsely scattered)
        if (cellHash > 0.9) {
            float radius = 0.02 + cellHash * 0.08;
            
            // Draw a high-quality circle
            float glow = smoothstep(radius * 1.5, radius * 0.2, dist);
            float core = smoothstep(radius * 0.5, 0.0, dist);
            
            // Combine soft glow with a sharply defined core
            float ember = glow * 0.5 + core * 1.0;
            
            // Individual ember flicker
            float flicker = sin(uTime * 10.0 + hash12(gridId) * 100.0) * 0.5 + 0.5;
            
            // Embers in the background are darker/closer to ash
            ember *= (1.0 - i * 0.3) * flicker;
            
            emberTotal += ember;
        }
    }
    
    emberTotal = clamp(emberTotal, 0.0, 1.0);

    // Ash mask causes sparks at certain large-scale world coordinates to fade out 
    // simulating sparks cooling down as they pass through invisible cold air currents
    float ashMap = noise(st * 3.0 - vec2(0.0, uTime * uTimeMultiplier * 0.5));
    float emberIntensity = emberTotal * smoothstep(0.4, 0.8, ashMap);

    // Multi-color mapping (Bright gold core -> Orange/Red glow)
    vec3 rgbResult = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.2), emberIntensity) * emberIntensity * 2.0;

    float finalAlpha = emberIntensity * uOpacity;
    
    // PixiJS replaces gl_FragColor internally
    finalColor = vec4(rgbResult, finalAlpha);
}
