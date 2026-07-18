// alive_composite.glsl
// Final compositing of bloom and GI back onto the scene.

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBloomTex;
uniform sampler2D uGiTex;
uniform float uBloomIntensity;
uniform float uGiIntensity;

void main() {
    vec4 baseColor = texture(uTexture, vTextureCoord);
    vec3 bloom = texture(uBloomTex, vTextureCoord).rgb;
    vec3 gi = texture(uGiTex, vTextureCoord).rgb;
    
    // Simple additive blending
    vec3 outColor = baseColor.rgb + (bloom * uBloomIntensity) + (gi * uGiIntensity);
    
    // Avoid blowing out too much (subtle)
    // outColor = 1.0 - exp(-outColor * 1.5);
    
    finalColor = vec4(outColor, baseColor.a);
}
