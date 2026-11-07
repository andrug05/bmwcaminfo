'use strict';
const FIRST_WARNING_M = 500;
const FAST_WARNING_M = 700;
const SECOND_WARNING_M = 200;
const FAST_SPEED_KMH = 90;
const SPEEDING_TOLERANCE_KMH = 18;
const RESET_MARGIN_M = 150;
const EARTH_RADIUS_M = 6371008.8;
const MIN_DIRECTION_SPEED_KMH = 8;
const MAX_HEADING_DELTA_DEG = 35;
const MAX_CROSS_TRACK_M = 35;
function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const lat1 = a.lat * rad, lat2 = b.lat * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearingDegrees(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad, lat2 = b.lat * rad, dLon = (b.lon - a.lon) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angleDifference(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
}
/*
 * A camera is eligible only when it is ahead in the current BMW GPS course
 * and lies close to the projected direction of travel. This suppresses
 * cameras behind the car and on nearby crossing/parallel streets.
 */
function cameraAhead(fix, camera, maxDistanceM) {
    if (typeof fix.headingDeg !== 'number' || !isFinite(fix.headingDeg) ||
        fix.headingDeg < 0 || fix.headingDeg > 360 ||
        typeof fix.speedKmh !== 'number' || !isFinite(fix.speedKmh) ||
        fix.speedKmh < MIN_DIRECTION_SPEED_KMH) return null;
    const distance = distanceMeters(fix, camera);
    if (distance > maxDistanceM + 50) return null;
    const bearing = bearingDegrees(fix, camera);
    const delta = angleDifference(bearing, fix.headingDeg);
    if (delta > MAX_HEADING_DELTA_DEG) return null;
    const rad = delta * Math.PI / 180;
    const along = distance * Math.cos(rad);
    const cross = distance * Math.sin(rad);
    const accuracyAllowance = typeof fix.accuracyM === 'number' && isFinite(fix.accuracyM)
        ? Math.min(15, Math.max(0, fix.accuracyM * 0.5)) : 0;
    if (along <= 0 || along > maxDistanceM || cross > MAX_CROSS_TRACK_M + accuracyAllowance) return null;
    return { distanceM: along, crossTrackM: cross, bearingDeltaDeg: delta };
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
            const speedKmh = typeof fix.speedKmh === 'number' && isFinite(fix.speedKmh) ? fix.speedKmh : 0;
            const firstM = speedKmh > FAST_SPEED_KMH ? FAST_WARNING_M : FIRST_WARNING_M;
            const position = cameraAhead(fix, camera, firstM);
            let state = this.states[camera.id];
            if (!position) {
                if (state && state.stage > 0) {
                    // Reset only after the vehicle has passed the camera or moved away;
                    // retain state through brief course/GPS fluctuations.
                    const d = distanceMeters(fix, camera);
                    if (d > firstM + RESET_MARGIN_M || (typeof fix.headingDeg === 'number' &&
                        angleDifference(bearingDegrees(fix, camera), fix.headingDeg) > 90)) {
                        state.stage = 0; state.speedingAlerted = false;
                    }
                }
                return;
            }
            if (!state) state = this.states[camera.id] = { stage: 0, speedingAlerted: false };
            if (state.stage === 0 && position.distanceM <= firstM) {
                state.stage = 1;
                events.push({ type: 'camera', stage: 1, distanceM: Math.round(position.distanceM), thresholdM: firstM,
                    camera, speedKmh: Math.round(speedKmh) });
            } else if (state.stage === 1 && position.distanceM <= SECOND_WARNING_M) {
                state.stage = 2;
                events.push({ type: 'camera', stage: 2, distanceM: Math.round(position.distanceM), thresholdM: SECOND_WARNING_M,
                    camera, speedKmh: Math.round(speedKmh) });
            }
            const effectiveLimit = camera.limit;
            if (!state.speedingAlerted && typeof effectiveLimit === 'number' && isFinite(effectiveLimit) &&
                speedKmh >= effectiveLimit + SPEEDING_TOLERANCE_KMH && position.distanceM <= firstM) {
                state.speedingAlerted = true;
                events.push({ type: 'speeding', stage: state.stage, distanceM: Math.round(position.distanceM),
                    camera, speedKmh: Math.round(speedKmh), limitKmh: effectiveLimit,
                    roadName: null, limitSource: 'camera',
                    excessKmh: Math.round(speedKmh - effectiveLimit) });
            }
        });
        Object.keys(this.states).forEach((id) => { if (!seen[id]) delete this.states[id]; });
        return events;
    }
    reset() { this.states = Object.create(null); }
}
module.exports = { ProximityWarnings, distanceMeters, bearingDegrees, angleDifference, cameraAhead,
    FIRST_WARNING_M, FAST_WARNING_M, SECOND_WARNING_M, FAST_SPEED_KMH, SPEEDING_TOLERANCE_KMH,
    MIN_DIRECTION_SPEED_KMH, MAX_HEADING_DELTA_DEG, MAX_CROSS_TRACK_M };
