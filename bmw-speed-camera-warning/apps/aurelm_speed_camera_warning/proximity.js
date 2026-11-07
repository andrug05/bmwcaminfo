'use strict';
const FIRST_WARNING_M = 500;
const FAST_WARNING_M = 700;
const SECOND_WARNING_M = 200;
const FAST_SPEED_KMH = 90;
const SPEEDING_TOLERANCE_KMH = 18;
const RESET_MARGIN_M = 150;
const EARTH_RADIUS_M = 6371008.8;
function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const lat1 = a.lat * rad, lat2 = b.lat * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
function nearestRoadLimit(fix, segments) {
    let best = null, bestDistance = Infinity;
    const latScale = 111320, lonScale = 111320 * Math.cos(fix.lat * Math.PI / 180);
    (segments || []).forEach((road) => {
        if (!road || typeof road.limitKmh !== 'number' || !Array.isArray(road.a) || !Array.isArray(road.b)) return;
        const ax = (road.a[1] - fix.lon) * lonScale, ay = (road.a[0] - fix.lat) * latScale;
        const bx = (road.b[1] - fix.lon) * lonScale, by = (road.b[0] - fix.lat) * latScale;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d = Math.sqrt(px * px + py * py);
        if (d < bestDistance) { bestDistance = d; best = road; }
    });
    return best && bestDistance <= 35 ? { limitKmh: best.limitKmh, road: best, distanceM: bestDistance } : null;
}
class ProximityWarnings {
    constructor() { this.states = Object.create(null); }
    update(fix, cameras, roadSegments) {
        if (!fix || typeof fix.lat !== 'number' || !isFinite(fix.lat) ||
            typeof fix.lon !== 'number' || !isFinite(fix.lon) ||
            ((fix.speedKmh !== null && fix.speedKmh !== undefined) && (typeof fix.speedKmh !== 'number' || !isFinite(fix.speedKmh) || fix.speedKmh < 0)) ||
            (typeof fix.accuracyM === 'number' && (!isFinite(fix.accuracyM) || fix.accuracyM > 75))) return [];
        const events = [], seen = Object.create(null), roadMatch = nearestRoadLimit(fix, roadSegments);
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
            const effectiveLimit = roadMatch ? roadMatch.limitKmh : camera.limit;
            if (!state.speedingAlerted && typeof effectiveLimit === 'number' && isFinite(effectiveLimit) &&
                speedKmh >= effectiveLimit + SPEEDING_TOLERANCE_KMH && d <= firstM) {
                state.speedingAlerted = true;
                events.push({ type: 'speeding', stage: state.stage, distanceM: Math.round(d),
                    camera, speedKmh: Math.round(speedKmh), limitKmh: effectiveLimit,
                    roadName: roadMatch ? roadMatch.road.name : null,
                    limitSource: roadMatch ? 'OpenStreetMap' : 'camera',
                    excessKmh: Math.round(speedKmh - effectiveLimit) });
            }
        });
        Object.keys(this.states).forEach((id) => { if (!seen[id]) delete this.states[id]; });
        return events;
    }
    reset() { this.states = Object.create(null); }
}
module.exports = { ProximityWarnings, distanceMeters, nearestRoadLimit,
    FIRST_WARNING_M, FAST_WARNING_M, SECOND_WARNING_M, FAST_SPEED_KMH, SPEEDING_TOLERANCE_KMH };
