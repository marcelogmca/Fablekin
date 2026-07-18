export class SpriteAnimator {
    constructor(containerElement, config) {
        this.container = containerElement;
        this.config = config; // { hasBlink, hasTalk, hasTalkBlink }

        // State
        this.isBlinking = false;
        this.isTalking = false;   // Whether the "muppet loop" is active
        this.isMouthOpen = false; // The current phase of the mouth (open/closed)

        // Timers
        this.blinkTimer = null;
        this.talkInterval = null;

        // Cache DOM Layers
        this.layers = {
            base: containerElement.querySelector('.layer-base'),
            blink: containerElement.querySelector('.layer-blink'),
            talk: containerElement.querySelector('.layer-talk'),
            talkBlink: containerElement.querySelector('.layer-talk-blink')
        };

        // Start independent loops
        if (this.config.hasBlink) {
            this.scheduleNextBlink();
        }
    }

    // --- The Visual Resolver ---
    // Decides which layer to show based on current state and priorities
    resolveVisuals() {
        // Default: Show Base, Hide others
        let activeLayer = 'base';

        const mouthShouldBeOpen = this.isTalking && this.isMouthOpen;

        if (mouthShouldBeOpen && this.isBlinking && this.config.hasTalkBlink) {
            activeLayer = 'talkBlink';
        } else if (mouthShouldBeOpen && this.config.hasTalk) {
            activeLayer = 'talk';
        } else if (this.isBlinking && this.config.hasBlink) {
            activeLayer = 'blink';
        }

        // Apply Opacity
        this._setOpacity(this.layers.base, activeLayer === 'base' ? 1 : 0);
        if (this.layers.blink) this._setOpacity(this.layers.blink, activeLayer === 'blink' ? 1 : 0);
        if (this.layers.talk) this._setOpacity(this.layers.talk, activeLayer === 'talk' ? 1 : 0);
        if (this.layers.talkBlink) this._setOpacity(this.layers.talkBlink, activeLayer === 'talkBlink' ? 1 : 0);
    }

    _setOpacity(el, val) {
        if (el && el.style.opacity != val) el.style.opacity = val;
    }

    // --- Blink Logic ---
    scheduleNextBlink() {
        const nextBlinkTime = Math.random() * 3000 + 2000;
        this.blinkTimer = setTimeout(() => {
            this.triggerBlink();
        }, nextBlinkTime);
    }

    triggerBlink() {
        this.isBlinking = true;
        this.resolveVisuals();
        setTimeout(() => {
            this.isBlinking = false;
            this.resolveVisuals();
            this.scheduleNextBlink();
        }, 150);
    }

    // --- Talk Logic ---
    startTalking() {
        if (this.isTalking) return;
        if (!this.config.hasTalk) return;

        this.isTalking = true;
        this.isMouthOpen = true; // Start with mouth open
        this.resolveVisuals();

        // The Muppet Loop: Toggle mouth state every 200ms
        this.talkInterval = setInterval(() => {
            this.isMouthOpen = !this.isMouthOpen;
            this.resolveVisuals();
        }, 200);
    }

    stopTalking() {
        if (this.talkInterval) {
            clearInterval(this.talkInterval);
            this.talkInterval = null;
        }
        this.isTalking = false;
        this.isMouthOpen = false;
        this.resolveVisuals();
    }

    destroy() {
        clearTimeout(this.blinkTimer);
        if (this.talkInterval) clearInterval(this.talkInterval);
    }
}
