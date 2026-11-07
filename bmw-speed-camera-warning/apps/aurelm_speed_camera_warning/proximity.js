'use strict';
const FIRST_WARNING_M = 500;
const FAST_WARNING_M = 700;
const SECOND_WARNING_M = 200;
const FAST_SPEED_KMH = 90;
const SPEEDING_TOLERANCE_KMH = 18;
const RESET_MARGIN_M = 150;
function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const lat1 = a.lat * rad, lat2 = b.lat * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
class ProximityWarnings {
    constructor() { this.states = Object.create(null); }
    update(fix, cameras) {
        if (!fix || typeof fix.lat !== 'number' || !isFinite(fix.lat) ||
            typeof fix.lon !== 'number' || !isFinite(fix.lon) ||
            ((fix.speedKmh !== null && fix.speedKmh !== undefined) && (typeof fix.speedKmh !== 'number' || !isFinite(fix.speedKmh) || fix.speedKmh < 0)) ||
            (typeof fix.accuracyM === 'number' && (!isFinite(fix.accuracyM) || fix.accuracyM > 75))) return [];
        const events = [], seen = Object.create(null);
        (cameras || []).forEach((camera) => {
            if (!camera || typeof camera.id !== 'string' || typeof camera.lat !== 'number' || !isFinite(camera.lat) ||
                typeof camera.lon !== 'number' || !isFinite(camera.lon)) return;
            seen[camera.id] = true;
            const d = distanceMeters(fix, camera);
            const speedKmh = typeof fix.speedKmh === 'number' && isFinite(fix.speedKmh) ? fix.speedKmh : 0;
            const firstM = speedKmh > FAST_SPEED_KMH ? FAST_WARNING_M : FIRST_WARNING_M;
            let state = this.states[camera.id];
            if (!state) state = this.states[camera.id] = { stage: 0, resetAt: firstM + RESET_MARGIN_M, speedingAlerted: false };
            if (state.stage > 0 && d > state.resetAt) {
                state.stage = 0;
                state.speedingAlerted = false;
                state.resetAt = firstM + RESET_MARGIN_M;
            } else if (state.stage === 0) state.resetAt = firstM + RESET_MARGIN_M;
            if (state.stage === 0 && d <= firstM) {
                state.stage = 1;
                events.push({ type: 'camera', stage: 1, distanceM: Math.round(d), thresholdM: firstM,
                    camera, speedKmh: Math.round(speedKmh) });
            } else if (state.stage === 1 && d <= SECOND_WARNING_M) {
                state.stage = 2;
                events.push({ type: 'camera', stage: 2, distanceM: Math.round(d), thresholdM: SECOND_WARNING_M,
                    camera, speedKmh: Math.round(speedKmh) });
            }
            const effectiveLimit = camera.limit;
            if (!state.speedingAlerted && typeof effectiveLimit === 'number' && isFinite(effectiveLimit) &&
                speedKmh >= effectiveLimit + SPEEDING_TOLERANCE_KMH && d <= firstM) {
                state.speedingAlerted = true;
                events.push({ type: 'speeding', stage: state.stage, distanceM: Math.round(d),
                    camera, speedKmh: Math.round(speedKmh), limitKmh: effectiveLimit,
                    roadName: null,
                    limitSource: 'camera',
                    excessKmh: Math.round(speedKmh - effectiveLimit) });
            }
        });
        Object.keys(this.states).forEach((id) => { if (!seen[id]) delete this.states[id]; });
        return events;
    }
    reset() { this.states = Object.create(null); }
}
module.exports = { ProximityWarnings, distanceMeters,
    FIRST_WARNING_M, FAST_WARNING_M, SECOND_WARNING_M, FAST_SPEED_KMH, SPEEDING_TOLERANCE_KMH };
