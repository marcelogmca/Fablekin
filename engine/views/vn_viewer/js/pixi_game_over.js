import { pixiApp } from './pixi_engine.js';
import { debugLog } from './utils.js';

function killTweensDeep(displayObject) {
    if (!displayObject || typeof gsap === 'undefined') return;
    try { gsap.killTweensOf(displayObject); } catch (_) { }
    try { gsap.killTweensOf(displayObject.position); } catch (_) { }
    try { gsap.killTweensOf(displayObject.pivot); } catch (_) { }
    try { gsap.killTweensOf(displayObject.scale); } catch (_) { }
    try { gsap.killTweensOf(displayObject.skew); } catch (_) { }
    if (Array.isArray(displayObject.children)) {
        for (const child of displayObject.children) killTweensDeep(child);
    }
}

export const pixiGameOver = {
    container: null,
    
    show(config = {}) {
        const { text = 'GAME OVER', subtext = '' } = config;
        
        if (this.container) this.clear();
        
        this.container = new PIXI.Container();
        this.container.label = 'GameOverScreen';
        this.container.alpha = 0;
        
        // 1. Full-screen dark overlay
        const overlay = new PIXI.Graphics();
        overlay.beginFill(0x000000, 0.7);
        overlay.drawRect(0, 0, pixiApp.LOGICAL_WIDTH, pixiApp.LOGICAL_HEIGHT);
        overlay.endFill();
        this.container.addChild(overlay);
        
        // 2. Main "GAME OVER" text
        const mainStyle = new PIXI.TextStyle({
            fontFamily: config.style?.fontFamily || 'Noto Sans',
            fontSize: config.style?.fontSize || 120,
            fontWeight: '900',
            fill: config.style?.fill || '#cc0000',
            letterSpacing: 20,
            stroke: '#000000',
            strokeThickness: 6,
            dropShadow: { alpha: 0.8, blur: 8, color: '#990000', distance: 4 },
            padding: 40
        });
        
        const mainText = new PIXI.Text({ text, style: mainStyle, resolution: 3 });
        mainText.anchor.set(0.5);
        mainText.position.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2 - 30);
        this.container.addChild(mainText);
        
        // 3. Optional subtext
        if (subtext) {
            const subStyle = new PIXI.TextStyle({
                fontFamily: config.subStyle?.fontFamily || 'Noto Sans',
                fontSize: config.subStyle?.fontSize || 36,
                fontWeight: '400',
                fontStyle: 'italic',
                fill: config.subStyle?.fill || '#aaaaaa',
                letterSpacing: 4,
                padding: 20
            });
            const subText = new PIXI.Text({ text: subtext, style: subStyle, resolution: 3 });
            subText.anchor.set(0.5);
            subText.position.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2 + 60);
            this.container.addChild(subText);
        }
        
        // 4. Decorative line
        const line = new PIXI.Graphics();
        const lineWidth = 300;
        line.beginFill(0xcc0000, 0.6);
        line.drawRect(
            (pixiApp.LOGICAL_WIDTH - lineWidth) / 2,
            pixiApp.LOGICAL_HEIGHT / 2 + 20,
            lineWidth, 2
        );
        line.endFill();
        this.container.addChild(line);
        
        // 5. Add to the titles layer (on top of everything)
        if (pixiApp.layers.titles) {
            pixiApp.layers.titles.addChild(this.container);
        }
        
        // 6. Animate in with GSAP
        // Desaturate the background
        if (pixiApp.layers.background) {
            gsap.to(pixiApp.layers.background, { alpha: 0.3, duration: 2, ease: 'power2.inOut' });
        }
        if (pixiApp.layers.characters) {
            gsap.to(pixiApp.layers.characters, { alpha: 0.2, duration: 2, ease: 'power2.inOut' });
        }
        
        // Fade in the game over screen
        gsap.to(this.container, { alpha: 1, duration: 1.5, ease: 'power2.inOut' });
        
        // Dramatic text entrance: scale from 1.5 to 1.0
        mainText.scale.set(1.5);
        gsap.to(mainText.scale, { x: 1, y: 1, duration: 2, ease: 'elastic.out(0.6, 0.4)' });
        
        // Subtle breathing animation on the overlay
        gsap.to(overlay, { alpha: 0.6, duration: 3, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        
        debugLog('[GameOver] Game Over screen displayed:', text);
    },
    
    clear() {
        if (!this.container) return;
        
        killTweensDeep(this.container);
        
        if (pixiApp.layers.titles) {
            pixiApp.layers.titles.removeChild(this.container);
        }
        this.container.destroy({ children: true });
        this.container = null;
        
        // Restore layer alpha
        if (pixiApp.layers.background) {
            gsap.to(pixiApp.layers.background, { alpha: 1, duration: 0.5, ease: 'power2.out', overwrite: true });
        }
        if (pixiApp.layers.characters) {
            gsap.to(pixiApp.layers.characters, { alpha: 1, duration: 0.5, ease: 'power2.out', overwrite: true });
        }
        
        debugLog('[GameOver] Game Over screen cleared.');
    }
};
