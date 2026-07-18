            in vec2 aPosition;
            out vec2 vTextureCoord;

            uniform vec4 uInputSize;
            uniform vec4 uOutputFrame;
            uniform vec4 uOutputTexture;
            
            void main(void) {
                gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
                vTextureCoord = aPosition;
            }
