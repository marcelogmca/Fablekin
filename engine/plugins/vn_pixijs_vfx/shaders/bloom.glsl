in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uResolutionX;
uniform float uResolutionY;
uniform float uIntensity;
uniform float uThreshold;

void main() {
    vec4 texColor = texture2D(uTexture, vTextureCoord);
    vec2 texelSize = vec2(1.0 / uResolutionX, 1.0 / uResolutionY);
    
    // Simple 9-tap blur convolution for bloom spread
    vec4 sum = vec4(0.0);
    sum += texture2D(uTexture, vTextureCoord + vec2(-1.0, -1.0) * texelSize * 4.0);
    sum += texture2D(uTexture, vTextureCoord + vec2( 0.0, -1.0) * texelSize * 4.0) * 2.0;
    sum += texture2D(uTexture, vTextureCoord + vec2( 1.0, -1.0) * texelSize * 4.0);
    sum += texture2D(uTexture, vTextureCoord + vec2(-1.0,  0.0) * texelSize * 4.0) * 2.0;
    sum += texture2D(uTexture, vTextureCoord + vec2( 0.0,  0.0) * texelSize * 4.0) * 4.0;
    sum += texture2D(uTexture, vTextureCoord + vec2( 1.0,  0.0) * texelSize * 4.0) * 2.0;
    sum += texture2D(uTexture, vTextureCoord + vec2(-1.0,  1.0) * texelSize * 4.0);
    sum += texture2D(uTexture, vTextureCoord + vec2( 0.0,  1.0) * texelSize * 4.0) * 2.0;
    sum += texture2D(uTexture, vTextureCoord + vec2( 1.0,  1.0) * texelSize * 4.0);
    sum /= 16.0;

    // Calculate perceived brightness of the blurred sum
    float brightness = dot(sum.rgb, vec3(0.299, 0.587, 0.114));
    
    // Only isolate the brightest areas (e.g. skin highlights, VFX embers, UI)
    float contribution = smoothstep(uThreshold, uThreshold + 0.2, brightness);
    
    // Add the glowing blur back onto the original unblurred image
    vec3 outColor = texColor.rgb + (sum.rgb * contribution * uIntensity);

    finalColor = vec4(outColor, texColor.a);
}
