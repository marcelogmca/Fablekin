const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const minimizeBtn = document.getElementById('window-minimize');
    const maximizeBtn = document.getElementById('window-maximize');
    const closeBtn = document.getElementById('window-close');

    let lastClick = 0;
    const DEBOUNCE_TIME = 200;

    function isDebounced() {
        const now = Date.now();
        if (now - lastClick < DEBOUNCE_TIME) return true;
        lastClick = now;
        return false;
    }

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            if (isDebounced()) return;
            ipcRenderer.send('window-minimize');
        });
    }

    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', () => {
            if (isDebounced()) return;
            ipcRenderer.send('window-maximize');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (isDebounced()) return;
            ipcRenderer.send('window-close');
        });
    }

    // SVG Icons
    const MAXIMIZE_SVG = `<svg viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" /></svg>`;
    const RESTORE_SVG = `<svg viewBox="0 0 10 10"><path d="M2.1,0v2H0v8.1h8.2v-2h2V0H2.1z M7.2,9.1H1.1V3h6.1V9.1z M9.1,7.1h-1V3h-4.1v-2h5.1V7.1z" fill="currentColor" /></svg>`;

    function updateIcons(isMaximized) {
        if (maximizeBtn) {
            maximizeBtn.innerHTML = isMaximized ? RESTORE_SVG : MAXIMIZE_SVG;
        }
    }

    ipcRenderer.on('window-state-changed', (event, state) => {
        updateIcons(state.isMaximized);
    });


    // Initial request for state in case we missed the startup message
    ipcRenderer.send('request-window-state');
});
