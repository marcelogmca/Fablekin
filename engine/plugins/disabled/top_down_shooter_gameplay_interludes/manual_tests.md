Core flow
🟡 Identity: objective text confirms debug encounter is likely active; still need explicit id/title/seed from runtime/result payload.
✅ Determinism after Retry (timing parity across runs).
✅ Start banner text: Debug sequence online.
✅ Immediate spawn: 2 scouts + 1 sentry.
✅ Wave loop: every ~4.5s, max 4 repeats.
⬜ Line telegraph + line_wall fire after second wave counter.  -> what am I supposed to be looking for?
✅ Boss trigger around ~8s + boss HUD.
✅ Win around ~35s if alive.
What your screenshot already gave us
✅ Phase UI label is wired: OPENING.
✅ Objective UI binding is wired: Debug fixed sequence.
✅ Defeat counter UI binding is wired: Enemies defeated: 0.
🟡 Forced encounter override likely working (strong signal, but not absolute proof of id/seed).
Global runtime setup checks
⬜ Budgets: no unexpected budget warnings.
⬜ Arena size feel (mapSize: 1700).
✅ Grid visibility/color is present in screenshot (dark blue/purple grid visible).
⬜ Arena shape feels diamond.
⬜ Bounds behavior (soft baseline + edge damage when modifier active).
⚠️ backgroundPreset likely non-visual currently (keep as implementation-gap watch).
⬜ shrink_arena + expand_arena subtle net effect.
⬜ rotating_safe_wedge visible/effective.
⬜ periodic_wind felt.
⬜ low_friction_floor felt early.
⬜ mud_slow_patches noticeable.
⬜ damage_edge ticks when outside.
⬜ bullet_wrap near edges (first ~10s).
⬜ enemy_spawn_gates rhythmic spawn gating.
⬜ darkened_visibility dim effect (~12s).
⬜ camera_zoom_phase zoom effect (~10s).
Player kit + combat presentation
⬜ HP shows 7/7.
⬜ Move speed feels faster than default.
⬜ Dash is burst_dash, ~`1.05s` cooldown.
⬜ Q (flare_burst) radial burst + ~`6s` cooldown.
⬜ E (aegis_window) mitigation/bullet clear + ~`9s` cooldown.
⬜ R (phase_reload) works from keyboard.
⚠️ R not shown in HUD is expected current UI gap (unless UI changed).
🟡 Enemy bullet color looks pink from screenshot; still need behavior/style confirmation (diamond/spin).
⬜ Player bullet render (needle/glow) on Q cast.
⬜ Enemy archetype preset differentiation (scout vs sentry).
⬜ Boss preset on Debug Captain.
⬜ Damage numbers visible on hit.
⬜ Micro hit stop perceptible on hit.
Audio rule checks
⬜ High intensity rule when enemy count >=5.
⬜ Low intensity rule when enemy count <3.
⬜ Boss intensity rule when Debug Captain is alive.