            in vec2 vTextureCoord;
            
            // Uniform inputs from Javascript
            uniform float uTime;
            uniform float uResolutionX;
            uniform float uResolutionY;
            uniform float uOpacity;
            uniform vec3 uBaseColor;
            uniform float uTimeMultiplier; // speed
            uniform float uScaleMultiplier; // zoom
            uniform vec2 uCameraPos;
            uniform float uCameraScale;

            uniform float uFlipY; // 1.0 for normal, 0.0 if parent filter flipped Y

            // Highly chaotic pseudo-random hash generator
            float hash12(vec2 p) {
                vec3 p3  = fract(vec3(p.xyx) * .1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            // High quality 2D Noise for dynamic wind sway over time
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f*f*(3.0-2.0*f);
                return mix(mix(hash12(i + vec2(0.0,0.0)), 
                               hash12(i + vec2(1.0,0.0)), u.x),
                           mix(hash12(i + vec2(0.0,1.0)), 
                               hash12(i + vec2(1.0,1.0)), u.x), u.y);
            }

            void main() {
                // Convert Screen Space to true World Space
                // mix(y, 1.0-y, uFlipY): If uFlipY is 1.0 (no parent filters), we flip manually.
                // If uFlipY is 0.0 (parent filter active), we use raw y because parent already flipped.
                vec2 screenPos = vec2(vTextureCoord.x, mix(vTextureCoord.y, 1.0 - vTextureCoord.y, uFlipY)) * vec2(uResolutionX, uResolutionY);
                vec2 worldPos = (screenPos - uCameraPos) / uCameraScale;
                
                vec2 uv = worldPos / max(uResolutionX, uResolutionY);
                uv *= uScaleMultiplier;

                // --- Apply Dynamic Wind Angle ---
                // We use our noise function to gracefully sweep the wind left and right over time
                // Range from highly slanted left to slightly slanted right
                float windAngle = -0.3 + (noise(vec2(uTime * 0.2 * uTimeMultiplier, 0.0)) - 0.5) * 0.8; 
                
                // Slant the UVs based on the dynamic wind
                uv.x += uv.y * windAngle;
                
                float col = 0.0;
                
                // --- Multi-Layer Parallax Rain System ---
                // We draw 3 distinct overlapping grids of rain to create depth and entropy
                for(float i = 0.0; i < 3.0; i++) {
                    // Different scale per layer - back layers are drawn smaller and tighter
                    vec2 st = uv * vec2(40.0 + i * 25.0, 5.0 + i * 1.5);
                    
                    // Fall speed - foreground moves the fastest
                    float t = uTime * uTimeMultiplier * (8.0 - i * 1.5);
                    
                    // Subtracting time causes the texture to rapidly scroll DOWN
                    st.y += t; 
                    
                    // Offset each column's fall timing so rain doesn't fall in a rigid vertical row
                    float colId = floor(st.x);
                    st.y += hash12(vec2(colId, i)) * 100.0;
                    
                    // Create a grid cell for defining an individual raindrop
                    vec2 id = floor(st);
                    vec2 f = fract(st);
                    
                    // Hash for this specific cell to decide if a drop exists (controls density)
                    float n = hash12(id + vec2(i));
                    
                    if (n > 0.6) { // 40% chance for any given grid cell to contain a drop
                        // Randomize horizontal position of the drop within the cell
                        float xOffset = (hash12(id + vec2(10.0)) - 0.5) * 0.6;
                        float dX = abs((f.x - 0.5) - xOffset);
                        
                        // Random drop length and intensity per drop
                        float dropLen = 0.2 + hash12(id + vec2(20.0)) * 0.6;
                        float intensity = 0.4 + hash12(id + vec2(30.0)) * 0.6;
                        
                        // Drop Shape Calculation
                        // Thin on X axis, softly fades out at the edges
                        float dropShapeX = smoothstep(0.04, 0.0, dX);
                        
                        // Because st.y -= t, f.y sweeps 1.0 -> 0.0 visually. 
                        // The bright head hits at f.y = 1.0, and the tail extends upwards to 1.0 - dropLen.
                        float flippedY = 1.0 - f.y; // Head is now at flippedY=0.0
                        
                        // Fading visual trail on Y axis
                        float dropShapeY = smoothstep(dropLen, 0.0, flippedY) * smoothstep(-0.1, 0.0, flippedY);
                        
                        // Render drop with parallax fading (farther layers are much dimmer)
                        col += dropShapeX * dropShapeY * intensity * (1.0 - i * 0.3);
                    }
                }
                
                // Final blending mapping
                float finalAlpha = clamp(col, 0.0, 1.0) * uOpacity;
                gl_FragColor = vec4(uBaseColor * finalAlpha, finalAlpha);
            }
