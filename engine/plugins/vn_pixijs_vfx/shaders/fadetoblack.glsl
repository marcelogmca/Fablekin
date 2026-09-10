precision highp float;

uniform float uProgress; // 0.0 (open) to 1.0 (closed)
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uOpacity;

varying vec2 vTextureCoord;

void main(void) {
    vec2 uv = vTextureCoord;
    
    // Normalize X and Y to [-1, 1] relative to center
    float x = uv.x * 2.0 - 1.0;
    float y = uv.y * 2.0 - 1.0;
    
    // Curvature: Strongest in the middle of the width (x=0)
    // Corners meet first (x=1/-1), so the gap is wider in the center (x=0).
    float curvature = (1.0 - x*x);
    
    // "Flattening into —": The curve disappears as uProgress reaches 1.0.
    float curveMultiplier = (1.0 - uProgress) * 0.4;
    float curveOffset = curvature * curveMultiplier;
    
    // Top mask: moves from top (-1.2) towards middle (0.0).
    // Subtract curveOffset to push it "up" (more open) in the middle width.
    float topEdge = -1.2 + (uProgress * 1.2) - curveOffset;
    
    // Bottom mask: moves from bottom (1.2) towards middle (0.0).
    // Add curveOffset to push it "down" (more open) in the middle width.
    float bottomEdge = 1.2 - (uProgress * 1.2) + curveOffset;
    
    // Add feathering for soft look
    float feather = 0.08;
    float topMask    = smoothstep(topEdge, topEdge - feather, y);
    float bottomMask = smoothstep(bottomEdge, bottomEdge + feather, y);
    
    float mask = max(topMask, bottomMask);

    // Ensure pitch black when closed even with feathering
    if (uProgress >= 0.99) mask = 1.0;

    gl_FragColor = vec4(0.0, 0.0, 0.0, mask * uOpacity);
}
