/*
 * Legacy compatibility file.
 * Runtime modules were moved to frontend/runtime/ and are concatenated by logic.js.
 * Keep this file as a marker so older references do not fail hard.
 */
(() => {
    if (typeof window !== 'undefined' && !window.TopDownShooterSceneRuntime) {
        window.TopDownShooterSceneRuntime = null;
    }
})();
