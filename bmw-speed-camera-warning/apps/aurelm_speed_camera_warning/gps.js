'use strict';

/*
 * BMW MGU GPS bridge, adapted from the public bmw-kaluga-cameras approach:
 * read-only SOME/IP SatellitePositioning.updatePosition -> NMEA decoder.
 * No shell daemon, external GPS, internet, or coordinate writes.
 */
const EventEmitter = require('events');

const INTERFACE = 'de.bmw.infotainment.SatellitePositioning';
const INSTANCE = '1';
const MAX_AGE_MS = 3000;
const MOTION_PAIR_MS = 500;
const ACCURACY_PAIR_MS = 100;

function num(v) {
    if (typeof v !== 'string' || v.trim() === '' || !isFinite(Number(v))) return null;
    return Number(v);
}
function fresh(t, now) {
    return typeof t === 'number' && isFinite(t) && t >= now - MAX_AGE_MS && t <= now + 500;
}
function tod(v) {
    if (!/^\d{6}(\.\d+)?$/.test(v || '')) return null;
    const h = Number(v.slice(0, 2)), m = Number(v.slice(2, 4)), s = Number(v.slice(4));
    return h < 24 && m < 60 && s < 60 ? ((h * 60 + m) * 60 + s) * 1000 : null;
}
function utc(date, time) {
    const ms = tod(time);
    if (!/^\d{6}$/.test(date || '') || ms === null) return null;
    let year = Number(date.slice(4, 6));
    year += year >= 80 ? 1900 : 2000;
    const month = Number(date.slice(2, 4)), day = Number(date.slice(0, 2));
    const base = Date.UTC(year, month - 1, day), d = new Date(base);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return base + ms;
}
function coordinate(raw, hemi, longitude) {
    const v = num(raw), allowed = longitude ? /^[EW]$/ : /^[NS]$/;
    if (v === null || v < 0 || !allowed.test(hemi)) return null;
    const deg = Math.floor(v / 100), minutes = v % 100;
    const out = deg + minutes / 60;
    if (minutes >= 60 || out > (longitude ? 180 : 90)) return null;
    return hemi === 'S' || hemi === 'W' ? -out : out;
}
function delta(a, b) {
    const day = 86400000;
    return (a - b + day * 1.5) % day - day / 2;
}
function distance(a, b) {
    const rad = Math.PI / 180;
    const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) * rad / 2);
    const y = b.lat - a.lat;
    return Math.sqrt(x * x + y * y) * rad * 6371008.8;
}
function parseSentence(line) {
    const m = /^\$([A-Z]{2})([A-Z]{3}),([^*]*)\*([0-9A-Fa-f]{2})$/.exec(String(line || '').trim());
    if (!m || line.length > 512) return null;
    const body = m[1] + m[2] + ',' + m[3];
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
    if (sum !== parseInt(m[4], 16)) return null;
    return { kind: m[2], p: body.split(',') };
}
function nmeaFix(payload, now) {
    if (!payload || typeof payload.nmeaString !== 'string' ||
        !payload.nmeaString.length || payload.nmeaString.length > 4096 ||
        /[^\x20-\x7e\r\n]/.test(payload.nmeaString)) return null;
    const parts = { RMC: null, GGA: null, GST: null };
    payload.nmeaString.split(/[\r\n]+/).forEach((line) => {
        const s = parseSentence(line);
        if (!s || !parts.hasOwnProperty(s.kind)) return;
        const p = s.p, t = tod(p[1]);
        if (t === null) return;
        if (s.kind === 'RMC') {
            const time = utc(p[9], p[1]);
            const lat = coordinate(p[3], p[4], false), lon = coordinate(p[5], p[6], true);
            if (p[2] !== 'A' || !fresh(time, now) || lat === null || lon === null) return;
            parts.RMC = { tod: t, time, lat, lon, speed: num(p[7]), heading: num(p[8]) };
        } else if (s.kind === 'GGA') {
            const quality = num(p[6]), lat = coordinate(p[2], p[3], false), lon = coordinate(p[4], p[5], true);
            if ([1,2,3,4,5].indexOf(quality) < 0 || lat === null || lon === null) return;
            parts.GGA = { tod: t, lat, lon, quality, hdop: num(p[8]), satellites: num(p[7]) };
        } else {
            parts.GST = { tod: t, latSigma: num(p[6]), lonSigma: num(p[7]) };
        }
    });
    const r = parts.RMC, g = parts.GGA, gst = parts.GST;
    if (!r || !g || Math.abs(delta(g.tod, r.tod)) > MOTION_PAIR_MS) return null;
    if (distance(r, g) > 50) return null;
    let accuracyM = null;
    if (gst && Math.abs(delta(gst.tod, g.tod)) <= ACCURACY_PAIR_MS &&
        gst.latSigma > 0 && gst.lonSigma > 0) {
        accuracyM = 2 * Math.sqrt(gst.latSigma * gst.latSigma + gst.lonSigma * gst.lonSigma);
    }
    if (!fresh(r.time, now)) return null;
    return {
        lat: g.lat, lon: g.lon,
        speedKmh: r.speed !== null && r.speed >= 0 ? r.speed * 1.852 : null,
        headingDeg: r.heading !== null && r.heading >= 0 && r.heading <= 360 ? r.heading % 360 : null,
        accuracyM: accuracyM, timeMs: r.time, quality: g.quality, hdop: g.hdop,
        satellites: g.satellites, source: 'BMW SatellitePositioning'
    };
}

class BmwGps extends EventEmitter {
    constructor(options) {
        super();
        const o = options || {};
        this.timeoutMs = o.timeoutMs || 10000;
        this.builders = o.builders || null;
        this.retryMs = o.retryMs || 10000;
        this.retryMaxMs = o.retryMaxMs || 60000;
        this.running = false;
        this.state = 'stopped';
        this.errorCode = null;
        this.fix = null;
        this.proxy = null;
        this.attempt = 0;
        this.retryTimer = null;
        this.staleTimer = null;
        this.generation = 0;
        this.eventsReceived = 0;
        this.invalidEvents = 0;
        this.lastEventAt = 0;
    }
    setState(state, code) {
        this.state = state;
        this.errorCode = code || null;
        this.emit('change', this.snapshot());
    }
    snapshot() {
        const f = this.fix;
        const age = f ? Date.now() - f.timeMs : null;
        const valid = !!f && age >= -500 && age <= MAX_AGE_MS;
        return {
            state: valid ? 'fix' : this.state,
            errorCode: this.errorCode,
            fix: valid ? f : null,
            eventsReceived: this.eventsReceived,
            invalidEvents: this.invalidEvents,
            ageMs: age
        };
    }
    start() {
        if (this.running) return;
        this.running = true;
        this.generation++;
        this.attempt = 0;
        this.connect(this.generation);
        this.staleTimer = setInterval(() => {
            if (!this.running) return;
            if (this.fix && Date.now() - this.fix.timeMs > MAX_AGE_MS) {
                this.fix = null;
                this.setState('stale', 'GPS_FIX_STALE');
            }
        }, 1000);
    }
    connect(generation) {
        if (!this.running || generation !== this.generation) return;
        this.setState('connecting', null);
        const attempt = ++this.attempt;
        let proxy;
        Promise.resolve().then(() => {
            const sdk = require('oap-sdk');
            const builders = this.builders || (sdk && sdk.someipBuilders);
            if (!builders || typeof builders.buildAndInitTypedProxy !== 'function') {
                throw Object.assign(new Error('oap-sdk.someipBuilders is unavailable'), { code: 'GPS_SDK_API_MISSING' });
            }
            return builders.buildAndInitTypedProxy(INTERFACE, INSTANCE, this.timeoutMs);
        }).then((p) => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            proxy = p;
            if (!proxy || !proxy.updatePosition || typeof proxy.updatePosition.subscribe !== 'function') {
                throw Object.assign(new Error('GPS event missing'), { code: 'GPS_EVENT_UNAVAILABLE' });
            }
            return Promise.resolve(proxy.updatePosition.subscribe((payload) => {
                if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
                this.eventsReceived++;
                const fix = nmeaFix(payload, Date.now());
                if (!fix) {
                    this.invalidEvents++;
                    return;
                }
                this.fix = fix;
                this.lastEventAt = Date.now();
                this.setState('fix', null);
            }));
        }).then(() => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            this.proxy = proxy;
            this.setState('subscribed', null);
        }).catch((err) => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            const code = err && typeof err.code === 'string' && /^[A-Z0-9_.-]{1,48}$/.test(err.code) ?
                err.code : 'GPS_SUBSCRIPTION_FAILED';
            this.setState('unavailable', code);
            const delay = Math.min(this.retryMaxMs, this.retryMs * Math.pow(2, Math.min(attempt - 1, 3)));
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.connect(generation);
            }, delay);
        });
    }
    stop() {
        if (!this.running) return;
        this.running = false;
        this.generation++;
        clearTimeout(this.retryTimer);
        clearInterval(this.staleTimer);
        this.retryTimer = this.staleTimer = null;
        this.fix = null;
        this.proxy = null;
        this.setState('stopped', null);
        // The SDK does not expose a verified unsubscribe API here. Generation
        // guards make late callbacks inert; only one subscription attempt is active.
    }
}
module.exports = { BmwGps, nmeaFix, INTERFACE, INSTANCE };
