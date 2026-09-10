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

void main() {
    vec2 screenPos = vec2(vTextureCoord.x, mix(vTextureCoord.y, 1.0 - vTextureCoord.y, uFlipY)) * vec2(uResolutionX, uResolutionY);
    vec2 worldPos = (screenPos - uCameraPos) / uCameraScale;
    
    vec2 st = worldPos / max(uResolutionX, uResolutionY);
    st *= uScaleMultiplier;
    st.x *= uResolutionX / uResolutionY;

    // Cellular Snow layers (parallax effect)
    float snowTotal = 0.0;
    
    // 3 distinct layers of Depth
    for (float i = 0.0; i < 3.0; i++) {
        // Varying speeds & sizes per layer
        float speedScale = 1.0 + i * 0.5;
        float sizeScale = 40.0 + i * 20.0; // Grid cells are small but consistent
        
        // Aggressive diagonal snowstorm (Left -> Right, 3x Speed)
        vec2 motion = vec2(
            -(uTime * uTimeMultiplier * speedScale * 9.0) + sin(uTime * 2.0 + i) * 0.2, 
            (uTime * uTimeMultiplier * speedScale * 12.0) 
        );
        
        vec2 layerSt = st * sizeScale + motion;
        
        // Split into grid cells
        vec2 gridId = floor(layerSt);
        vec2 gridUv = fract(layerSt);
        
        // Determine properties of this specific grid cell using a hash based on the ID
        float cellHash = hash12(gridId + vec2(i));
        
        // To prevent snowflakes from looking perfectly grid-aligned, offset them inside the cell randomly
        // Range is [-0.3, 0.3] so they stay mostly inside their own cell and don't clip walls
        vec2 cellOffset = vec2(
            (hash12(gridId + vec2(10.0)) - 0.5) * 0.6,
            (hash12(gridId + vec2(20.0)) - 0.5) * 0.6
        );
        
        // Calculate distance from pixel coordinate within cell to the randomized "center" of the cell
        vec2 p = gridUv - 0.5 - cellOffset;
        float dist = length(p);
        
        // Only 20% of grid cells actually contain a snowflake (controls density)
        if (cellHash > 0.8) {
            // Draw a perfectly soft, blurred circle using the distance field
            // The size of the flake varies based on the hash
            float radius = 0.05 + cellHash * 0.1;
            
            // smoothstep with a wide feather (radius * 2.5 to 0.0) creates a blurred puff rather than a hard dot
            float flake = smoothstep(radius * 2.5, 0.0, dist);
            
            // Layer opacity - back layers are dimmer
            flake *= (1.0 - i * 0.2);
            
            snowTotal += flake;
        }
    }
    
    snowTotal = clamp(snowTotal, 0.0, 1.0);

    // Apply global color uniform and reduced opacity
    vec3 rgbResult = uBaseColor * snowTotal;

    // Scale by 0.8 for 80% maximum opacity as requested
    float finalAlpha = snowTotal * uOpacity * 0.8;
    
    rgbResult *= finalAlpha; // Premultiply alpha

    // PixiJS replaces gl_FragColor internally
    finalColor = vec4(rgbResult, finalAlpha);
}
