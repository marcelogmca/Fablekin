(() => {
    function createInputController() {
        const keys = Object.create(null);
        const edge = Object.create(null);
        const mouse = {
            x: window.innerWidth * 0.5,
            y: window.innerHeight * 0.5
        };
        const buttons = {
            primaryHeld: false
        };
        let bound = false;
        const onContextMenu = (e) => e.preventDefault();
        let pointerMapper = null;

        function onKeyDown(event) {
            const key = String(event?.key || '').toLowerCase();
            if (!key) return;
            if (!keys[key]) edge[key] = true;
            keys[key] = true;
        }

        function onKeyUp(event) {
            const key = String(event?.key || '').toLowerCase();
            if (!key) return;
            keys[key] = false;
        }

        function onMouseMove(event) {
            if (typeof pointerMapper === 'function') {
                const mapped = pointerMapper(event) || {};
                mouse.x = Number(mapped.x) || 0;
                mouse.y = Number(mapped.y) || 0;
                return;
            }
            mouse.x = Number(event?.clientX) || 0;
            mouse.y = Number(event?.clientY) || 0;
        }

        function onMouseDown(event) {
            if (event?.button === 0) buttons.primaryHeld = true;
            if (event?.button === 2) {
                edge._mouseRight = true;
            }
        }

        function onMouseUp(event) {
            if (event?.button === 0) buttons.primaryHeld = false;
        }

        function bind() {
            if (bound) return;
            bound = true;
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('contextmenu', onContextMenu);
        }

        function unbind() {
            if (!bound) return;
            bound = false;
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('contextmenu', onContextMenu);
            Object.keys(keys).forEach((k) => delete keys[k]);
            Object.keys(edge).forEach((k) => delete edge[k]);
            buttons.primaryHeld = false;
        }

        function getMovementVector(speed) {
            let vx = 0;
            let vy = 0;

            if (keys.w || keys.arrowup) vy -= speed;
            if (keys.s || keys.arrowdown) vy += speed;
            if (keys.a || keys.arrowleft) vx -= speed;
            if (keys.d || keys.arrowright) vx += speed;

            if (vx !== 0 && vy !== 0) {
                const magnitude = Math.sqrt((vx * vx) + (vy * vy));
                vx = (vx / magnitude) * speed;
                vy = (vy / magnitude) * speed;
            }

            return { vx, vy };
        }

        function consumePressed(keyName) {
            const key = String(keyName || '').toLowerCase();
            if (!key) return false;
            const value = !!edge[key];
            edge[key] = false;
            return value;
        }

        function consumeDashPressed() {
            const keyboardDash = consumePressed(' ');
            const rightMouseDash = !!edge._mouseRight;
            edge._mouseRight = false;
            return keyboardDash || rightMouseDash;
        }

        function getCursorScreen() {
            return { x: mouse.x, y: mouse.y };
        }

        function isPrimaryHeld() {
            return !!buttons.primaryHeld;
        }

        function isHeld(keyName) {
            const key = String(keyName || '').toLowerCase();
            if (!key) return false;
            return !!keys[key];
        }

        function setPointerMapper(mapper) {
            pointerMapper = typeof mapper === 'function' ? mapper : null;
        }

        return {
            bind,
            unbind,
            getMovementVector,
            consumeDashPressed,
            consumePressed,
            isHeld,
            getCursorScreen,
            isPrimaryHeld,
            setPointerMapper
        };
    }

    window.TDSInputController = {
        create: createInputController
    };
})();
