            in vec2 vTextureCoord;
            
            // Uniform inputs from Javascript
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

            // Simple fast 2D noise generator
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            // Standard Simplex/Perlin-style smooth noise
            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);

                // Four corners
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));

                // Smooth interpolation
                vec2 u = f * f * (3.0 - 2.0 * f);

                return mix(a, b, u.x) +
                        (c - a) * u.y * (1.0 - u.x) +
                        (d - b) * u.x * u.y;
            }

            // Fractal Brownian Motion (FBM) for turbulence/organic detail
            #define OCTAVES 5
            float fbm(vec2 _st) {
                vec2 st = _st;
                float value = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < OCTAVES; i++) {
                    value += amplitude * noise(st);
                    st *= 2.0;         // Double the frequency
                    amplitude *= 0.5;  // Halve the amplitude
                }
                return value;
            }

            void main() {
                // Calculate correct aspect ratio
                // DO NOT mutate varying inputs directly
                
                // Convert Screen Space to World Space mathematically
                // WebGL texture coordinates (vTextureCoord) start from top-left (0,0) in PixiJS.
                // However, the Y-axis projection opposes the DOM Y-axis in this pipeline!
                // To safely invert Y tracking while preserving Zoom pivots, we flip vTextureCoord.y outright.
                // mix(y, 1.0-y, uFlipY): If uFlipY is 1.0 (no parent filters), we flip manually.
                // If uFlipY is 0.0 (parent filter active), we use raw y because parent already flipped.
                vec2 screenPos = vec2(vTextureCoord.x, mix(vTextureCoord.y, 1.0 - vTextureCoord.y, uFlipY)) * vec2(uResolutionX, uResolutionY);
                vec2 worldPos = (screenPos - uCameraPos) / uCameraScale;
                
                vec2 st = worldPos / max(uResolutionX, uResolutionY);
                st *= uScaleMultiplier; // Scale determines how "zoomed in" the clouds are
                st.x *= uResolutionX / uResolutionY;

                // Make the clouds slowly drift across the sky continuously
                vec2 movement = vec2(uTime * uTimeMultiplier, 0.0);
                
                // --- Domain Warping (The "Turbulence" effect) ---
                // We calculate FBM to distort the coordinates of the main FBM pass.
                // This causes the clouds to curl, stretch, and "breathe" procedurally.
                vec2 q = vec2(0.0);
                q.x = fbm(st + movement);
                q.y = fbm(st + vec2(1.0));

                vec2 r = vec2(0.0);
                r.x = fbm(st + 1.0 * q + vec2(1.7, 9.2) + 0.04 * uTime);
                r.y = fbm(st + 1.0 * q + vec2(8.3, 2.8) + 0.04 * uTime);

                // Final main noise sample
                float f = fbm(st + r);

                // --- Density Processing ---
                // Clamp the output using smoothstep so we get distinct cloud shapes
                // and distinct empty sky gaps, rather than an even gray haze everywhere.
                // Narrow values = sharper edges, wider values = smoother edges
                float cloudDensity = smoothstep(0.35, 0.75, f);

                // Apply opacity and base color given by uniform
                float finalAlpha = cloudDensity * uOpacity;
                
                // WebGL Output (Standard premultiplied alpha)
                gl_FragColor = vec4(uBaseColor * finalAlpha, finalAlpha);
            }
