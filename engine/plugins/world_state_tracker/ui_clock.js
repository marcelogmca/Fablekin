/* global context */
(function (context) {
    const { socket } = context;
    let animationFrame = null;
    let displayedAbsoluteMinutes = null;
    let currentThresholds = null;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const smoothstep = value => {
        const t = clamp(value, 0, 1);
        return t * t * (3 - (2 * t));
    };
    const mix = (a, b, amount) => a.map((value, index) => Math.round(value + ((b[index] - value) * amount)));
    const rgb = color => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

    const normalizeThresholds = card => {
        const dawn = clamp(Number(card.dataset.clockDawn) || 300, 0, 1380);
        const day = clamp(Number(card.dataset.clockDay) || 540, dawn + 1, 1381);
        const dusk = clamp(Number(card.dataset.clockDusk) || 1080, day + 1, 1382);
        const night = clamp(Number(card.dataset.clockNight) || 1260, dusk + 1, 1439);
        return { dawn, day, dusk, night };
    };

    const minuteOfDay = absoluteMinutes => {
        const rounded = Math.round(absoluteMinutes);
        return ((rounded % 1440) + 1440) % 1440;
    };

    const phaseFor = (minute, thresholds) => {
        if (minute >= thresholds.night || minute < thresholds.dawn) return 'Night';
        if (minute >= thresholds.dusk) return 'Dusk';
        if (minute >= thresholds.day) return 'Day';
        return 'Dawn';
    };

    const paletteFor = (minute, thresholds) => {
        const noon = Math.round((thresholds.day + thresholds.dusk) / 2);
        const beforeDawn = Math.max(0, thresholds.dawn - 75);
        const stops = [
            { minute: 0, a: [25, 35, 60], b: [8, 15, 29] },
            { minute: beforeDawn, a: [31, 42, 68], b: [12, 20, 38] },
            { minute: thresholds.dawn, a: [247, 174, 116], b: [106, 82, 126] },
            { minute: thresholds.day, a: [236, 205, 105], b: [106, 164, 160] },
            { minute: noon, a: [244, 220, 125], b: [102, 176, 170] },
            { minute: thresholds.dusk, a: [231, 126, 93], b: [89, 72, 119] },
            { minute: thresholds.night, a: [36, 51, 79], b: [16, 26, 44] },
            { minute: 1440, a: [25, 35, 60], b: [8, 15, 29] }
        ].sort((a, b) => a.minute - b.minute);

        let lower = stops[0];
        let upper = stops[stops.length - 1];
        for (let index = 1; index < stops.length; index += 1) {
            if (minute <= stops[index].minute) {
                lower = stops[index - 1];
                upper = stops[index];
                break;
            }
        }
        const span = Math.max(1, upper.minute - lower.minute);
        const amount = smoothstep((minute - lower.minute) / span);
        return { a: mix(lower.a, upper.a, amount), b: mix(lower.b, upper.b, amount) };
    };

    const orbitPoint = progress => ({
        x: 17 + (66 * clamp(progress, 0, 1)),
        y: 73 - (55 * Math.sin(Math.PI * clamp(progress, 0, 1)))
    });

    const circularDistance = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));

    const visualStateFor = (absoluteMinutes, thresholds) => {
        const minute = minuteOfDay(absoluteMinutes);
        const daylightLength = Math.max(1, thresholds.night - thresholds.dawn);
        const sunProgress = clamp((minute - thresholds.dawn) / daylightLength, 0, 1);
        const sun = orbitPoint(sunProgress);

        const nightLength = Math.max(1, (1440 - thresholds.night) + thresholds.dawn);
        const nightElapsed = minute >= thresholds.night
            ? minute - thresholds.night
            : (minute < thresholds.dawn ? (1440 - thresholds.night) + minute : 0);
        const moon = orbitPoint(clamp(nightElapsed / nightLength, 0, 1));

        const fadeMinutes = 35;
        const sunriseFade = smoothstep((minute - thresholds.dawn) / fadeMinutes);
        const sunsetFade = 1 - smoothstep((minute - (thresholds.night - fadeMinutes)) / fadeMinutes);
        const sunOpacity = minute >= thresholds.dawn && minute < thresholds.night
            ? clamp(sunriseFade * sunsetFade, 0, 1)
            : 0;
        const moonOpacity = 1 - sunOpacity;
        const horizonDistance = Math.min(
            circularDistance(minute, thresholds.dawn),
            circularDistance(minute, thresholds.dusk)
        );
        const horizonOpacity = clamp(1 - (horizonDistance / 85), 0, 0.88);
        const elevation = Math.sin(Math.PI * sunProgress);
        const sunColor = mix([255, 157, 91], [255, 231, 139], clamp(elevation, 0, 1));

        return {
            absoluteMinutes,
            minute,
            phase: phaseFor(minute, thresholds),
            palette: paletteFor(minute, thresholds),
            sun,
            moon,
            sunOpacity,
            moonOpacity,
            starsOpacity: clamp(moonOpacity * 0.78, 0, 0.78),
            horizonOpacity,
            sunColor
        };
    };

    const formatClock = absoluteMinutes => {
        const safe = Math.max(0, Math.round(absoluteMinutes));
        const day = Math.floor(safe / 1440) + 1;
        const minute = safe % 1440;
        const hour24 = Math.floor(minute / 60);
        const displayMinute = String(minute % 60).padStart(2, '0');
        const meridiem = hour24 >= 12 ? 'PM' : 'AM';
        const displayHour = hour24 % 12 || 12;
        return { day: `Day ${day}`, time: `${displayHour}:${displayMinute}`, meridiem };
    };

    const renderState = (card, absoluteMinutes, thresholds) => {
        const state = visualStateFor(absoluteMinutes, thresholds);
        const formatted = formatClock(absoluteMinutes);
        card.style.setProperty('--clock-sky-a', rgb(state.palette.a));
        card.style.setProperty('--clock-sky-b', rgb(state.palette.b));
        card.style.setProperty('--clock-sun-x', `${state.sun.x}%`);
        card.style.setProperty('--clock-sun-y', `${state.sun.y}%`);
        card.style.setProperty('--clock-sun-opacity', state.sunOpacity.toFixed(3));
        card.style.setProperty('--clock-moon-x', `${state.moon.x}%`);
        card.style.setProperty('--clock-moon-y', `${state.moon.y}%`);
        card.style.setProperty('--clock-moon-opacity', state.moonOpacity.toFixed(3));
        card.style.setProperty('--clock-stars-opacity', state.starsOpacity.toFixed(3));
        card.style.setProperty('--clock-horizon-opacity', state.horizonOpacity.toFixed(3));
        card.style.setProperty('--clock-sun-color', rgb(state.sunColor));
        card.classList.remove('phase-dawn', 'phase-day', 'phase-dusk', 'phase-night');
        card.classList.add(`phase-${state.phase.toLowerCase()}`);
        const phase = card.querySelector('.world-clock-phase');
        const time = card.querySelector('.world-clock-time strong');
        const meridiem = card.querySelector('.world-clock-time span');
        const day = card.querySelector('.world-clock-day');
        if (phase) phase.textContent = state.phase;
        if (time) time.textContent = formatted.time;
        if (meridiem) meridiem.textContent = formatted.meridiem;
        if (day) day.textContent = formatted.day;
        displayedAbsoluteMinutes = absoluteMinutes;
    };

    const animateTo = card => {
        const targetMinutes = Number(card.dataset.clockMinutes);
        if (!Number.isFinite(targetMinutes)) return;
        const thresholds = normalizeThresholds(card);
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (animationFrame) cancelAnimationFrame(animationFrame);

        if (!Number.isFinite(displayedAbsoluteMinutes) || reducedMotion) {
            renderState(card, targetMinutes, thresholds);
            currentThresholds = thresholds;
            return;
        }

        const rawDelta = targetMinutes - displayedAbsoluteMinutes;
        if (Math.abs(rawDelta) < 0.5) {
            renderState(card, targetMinutes, thresholds);
            currentThresholds = thresholds;
            return;
        }

        const direction = Math.sign(rawDelta);
        const visualDistance = Math.abs(rawDelta) > 1440
            ? (Math.abs(rawDelta) % 1440 || 1440)
            : Math.abs(rawDelta);
        const startMinutes = targetMinutes - (direction * visualDistance);
        const duration = Math.min(2200, 480 + (Math.sqrt(visualDistance) * 52));
        const fromThresholds = currentThresholds || thresholds;
        renderState(card, startMinutes, fromThresholds);
        const startedAt = performance.now();

        const tick = now => {
            const progress = clamp((now - startedAt) / duration, 0, 1);
            const eased = 0.5 - (Math.cos(Math.PI * progress) / 2);
            const currentMinutes = startMinutes + ((targetMinutes - startMinutes) * eased);
            const blendedThresholds = {
                dawn: fromThresholds.dawn + ((thresholds.dawn - fromThresholds.dawn) * eased),
                day: fromThresholds.day + ((thresholds.day - fromThresholds.day) * eased),
                dusk: fromThresholds.dusk + ((thresholds.dusk - fromThresholds.dusk) * eased),
                night: fromThresholds.night + ((thresholds.night - fromThresholds.night) * eased)
            };
            renderState(card, currentMinutes, blendedThresholds);
            if (progress < 1) animationFrame = requestAnimationFrame(tick);
            else {
                animationFrame = null;
                displayedAbsoluteMinutes = targetMinutes;
                currentThresholds = thresholds;
            }
        };
        animationFrame = requestAnimationFrame(tick);
    };

    const findClock = content => content?.querySelector?.('.world-clock-card') || null;
    window.addEventListener('vn:hud-panel-updated', event => {
        if (event.detail?.id !== 'world_clock') return;
        const card = findClock(event.detail.content);
        if (card) animateTo(card);
    });

    const reset = () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        displayedAbsoluteMinutes = null;
        currentThresholds = null;
    };
    socket?.on('chat-db-switched', reset);
    socket?.on('project-ready', reset);

    const existing = document.querySelector('#vn-hud-panel-world_clock .world-clock-card');
    if (existing) animateTo(existing);
})(context);
