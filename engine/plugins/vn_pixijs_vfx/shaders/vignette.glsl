in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uIntensity;

void main() {
    // In PixiJS filters, vTextureCoord gives the exact UV of the whole screen
    vec4 texColor = texture2D(uTexture, vTextureCoord);
    
    // Distance from the center of the screen
    float dist = distance(vTextureCoord, vec2(0.5, 0.5));
    
    // Smoothstep creates the gradient falloff
    // 0.3 = start of darkening, 0.8 = maximum darkness edge
    float vignette = smoothstep(0.8, 0.3, dist * (1.0 + uIntensity * 0.5));
    
    // We want to darken the screen, but not make it entirely black at the edges.
    // Minimum brightness at the edges is 0.4
    vignette = mix(max(0.4, 1.0 - uIntensity), 1.0, vignette);

    finalColor = vec4(texColor.rgb * vignette, texColor.a);
}
