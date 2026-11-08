'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const DATABASE_URL = 'https://raw.githubusercontent.com/andrug05/bmwcaminfo/main/bmw-speed-camera-warning/data/camera-db.json';
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

function validateDatabase(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 1 ||
        !value.cities || typeof value.cities !== 'object' || Array.isArray(value.cities)) {
        throw new Error('CAMERA_DB_SCHEMA_INVALID');
    }
    const cities = {};
    Object.keys(value.cities).forEach((city) => {
        if (!/^[a-z0-9-]{2,40}$/.test(city) || !Array.isArray(value.cities[city])) throw new Error('CAMERA_DB_CITY_INVALID');
        cities[city] = value.cities[city].map((camera) => {
            if (!camera || typeof camera.id !== 'string' || !/^[a-z0-9-]{2,80}$/.test(camera.id) ||
                typeof camera.name !== 'string' || !camera.name.trim() || camera.name.length > 180) {
                throw new Error('CAMERA_DB_CAMERA_INVALID');
            }
            const lat = camera.lat === null || camera.lat === undefined ? null : camera.lat;
            const lon = camera.lon === null || camera.lon === undefined ? null : camera.lon;
            if ((lat === null) !== (lon === null) ||
                (lat !== null && (typeof lat !== 'number' || !isFinite(lat) || lat < -90 || lat > 90 ||
                    typeof lon !== 'number' || !isFinite(lon) || lon < -180 || lon > 180))) {
                throw new Error('CAMERA_DB_COORDINATES_INVALID');
            }
            const limit = camera.limit === null || camera.limit === undefined ? null : camera.limit;
            if (limit !== null && (typeof limit !== 'number' || !isFinite(limit) || limit < 5 || limit > 250)) {
                throw new Error('CAMERA_DB_LIMIT_INVALID');
            }
            return { id: camera.id, name: camera.name.trim(),
                type: typeof camera.type === 'string' ? camera.type.slice(0, 100) : 'Камера',
                limit, lat, lon,
                source: typeof camera.source === 'string' ? camera.source.slice(0, 80) : 'unknown',
                sourceLabel: typeof camera.sourceLabel === 'string' ? camera.sourceLabel.slice(0, 100) : '',
                sourceUrl: typeof camera.sourceUrl === 'string' && /^https:\/\//.test(camera.sourceUrl) ? camera.sourceUrl.slice(0, 300) : '',
                osmId: typeof camera.osmId === 'string' ? camera.osmId.slice(0, 40) : '',
                note: typeof camera.note === 'string' ? camera.note.slice(0, 300) : '' };
        });
    });
    return { schemaVersion: 1, revision: value.revision,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', cities };
}
function getHttps(url, redirects) {
    return new Promise((resolve, reject) => {
        let parsed;
        try { parsed = new URL(url); } catch (e) { reject(e); return; }
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com') {
            reject(new Error('CAMERA_DB_URL_NOT_ALLOWED')); return;
        }
        const req = https.get(parsed, {
            headers: { 'User-Agent': 'BMW-Speed-Camera-Warning/0.7.6', 'Accept': 'application/json' }
        }, (res) => {
            if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
                const location = res.headers.location;
                res.resume();
                if (!location || redirects >= MAX_REDIRECTS) { reject(new Error('CAMERA_DB_REDIRECT_LIMIT')); return; }
                getHttps(new URL(location, parsed).toString(), redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('CAMERA_DB_HTTP_' + res.statusCode)); return; }
            let body = '', bytes = 0;
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                bytes += Buffer.byteLength(chunk, 'utf8');
                if (bytes > MAX_BYTES) { req.destroy(new Error('CAMERA_DB_TOO_LARGE')); return; }
                body += chunk;
            });
            res.on('end', () => resolve(body));
            res.on('error', reject);
        });
        req.setTimeout(12000, () => req.destroy(new Error('CAMERA_DB_TIMEOUT')));
        req.on('error', reject);
    });
}
class CameraStore {
    constructor(options) {
        const o = options || {};
        this.dataDir = o.dataDir || process.cwd();
        this.bundled = validateDatabase(o.bundled);
        this.cachePath = path.join(this.dataDir, 'camera-db-cache.json');
        this.statusPath = path.join(this.dataDir, 'camera-db-status.json');
        this.lastCheckAt = '';
        this.lastSuccessAt = '';
        this.lastError = '';
        this.current = this.bundled;
        this.source = 'bundle';
    }
    loadLocal() {
        try {
            const status = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
            this.lastCheckAt = typeof status.lastCheckAt === 'string' ? status.lastCheckAt : '';
            this.lastSuccessAt = typeof status.lastSuccessAt === 'string' ? status.lastSuccessAt : '';
            this.lastError = typeof status.lastError === 'string' ? status.lastError : '';
        } catch (e) { /* first launch or no saved status */ }
        let cached = null;
        try { cached = validateDatabase(JSON.parse(fs.readFileSync(this.cachePath, 'utf8'))); }
        catch (e) { cached = null; }
        // A newly installed app may ship a newer bundled revision than the user's old cache.
        if (cached && cached.revision >= this.bundled.revision) {
            this.current = cached;
            this.source = 'cache';
        } else {
            this.current = this.bundled;
            this.source = 'bundle';
        }
        return { database: this.current, source: this.source };
    }
    saveStatus() {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            const tmp = this.statusPath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ lastCheckAt: this.lastCheckAt, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError }), 'utf8');
            fs.renameSync(tmp, this.statusPath);
        } catch (e) { /* status display is best-effort; camera cache remains authoritative */ }
    }
    async refresh() {
        try {
            const next = validateDatabase(JSON.parse(await getHttps(DATABASE_URL, 0)));
            const checkedAt = new Date().toISOString();
            this.lastCheckAt = checkedAt;
            this.lastSuccessAt = checkedAt;
            this.lastError = '';
            if (next.revision > this.current.revision) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'download';
                this.saveStatus();
                return { updated: true, database: this.current, source: this.source, checkedAt: this.lastCheckAt, lastSuccessAt: this.lastSuccessAt, serverUpdatedAt: this.current.updatedAt };
            }
            if (this.source === 'bundle' && !fs.existsSync(this.cachePath)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'cache';
            }
            this.saveStatus();
            return { updated: false, database: this.current, source: this.source, checkedAt: this.lastCheckAt, lastSuccessAt: this.lastSuccessAt, serverUpdatedAt: this.current.updatedAt };
        } catch (error) {
            this.lastCheckAt = new Date().toISOString();
            this.lastError = error && error.message ? error.message : 'CAMERA_DB_UPDATE_FAILED';
            this.saveStatus();
            return { updated: false, database: this.current, source: this.source,
                error: this.lastError, checkedAt: this.lastCheckAt, lastSuccessAt: this.lastSuccessAt, serverUpdatedAt: this.current.updatedAt };
        }
    }
}
module.exports = { CameraStore, validateDatabase, DATABASE_URL };
