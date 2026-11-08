'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');
const net = require('net');
const urlModule = require('url');
const DATABASE_URL = 'https://raw.githubusercontent.com/andrug05/bmwcaminfo/main/bmw-speed-camera-warning/data/camera-db.json';
const DATABASE_API_URL = 'https://api.github.com/repos/andrug05/bmwcaminfo/contents/bmw-speed-camera-warning/data/camera-db.json?ref=main';
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
                direction: typeof camera.direction === 'string' ? camera.direction.slice(0, 80) : '',
                description: typeof camera.description === 'string' ? camera.description.slice(0, 500) : '',
                category: typeof camera.category === 'string' ? camera.category.slice(0, 30) : '',
                overpassSnapshot: camera.overpassSnapshot === true,
                note: typeof camera.note === 'string' ? camera.note.slice(0, 300) : '' };
        });
    });
    return { schemaVersion: 1, revision: value.revision,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', cities };
}
function uplinkLookup(dataDir) {
    const leasePath = path.join(dataDir, 'uplink.json');
    let lease;
    try { lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')); }
    catch (e) { throw new Error('CAMERA_DB_UPLINK_LEASE_MISSING'); }
    const servers = Array.isArray(lease.dns) ? lease.dns.filter((ip) => typeof ip === 'string' && net.isIP(ip)) : [];
    if (!servers.length || !lease.interface || !lease.ip) throw new Error('CAMERA_DB_UPLINK_OFFLINE');
    const resolver = new dns.Resolver();
    resolver.setServers(servers);
    return function lookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        resolver.resolve4(hostname, (error, addresses) => {
            if (error || !addresses || !addresses.length) {
                callback(error || new Error('CAMERA_DB_DNS_NO_ADDRESS'));
                return;
            }
            if (options && options.all) callback(null, addresses.map((address) => ({ address, family: 4 })));
            else callback(null, addresses[0], 4);
        });
    };
}
function getHttps(requestUrl, redirects, dataDir) {
    return new Promise((resolve, reject) => {
        let parsed;
        try { parsed = urlModule.parse(requestUrl); } catch (e) { reject(e); return; }
        if (parsed.protocol !== 'https:' || ['raw.githubusercontent.com', 'api.github.com'].indexOf(parsed.hostname) < 0) {
            reject(new Error('CAMERA_DB_URL_NOT_ALLOWED')); return;
        }
        let lookup;
        try { lookup = uplinkLookup(dataDir); }
        catch (e) { reject(e); return; }
        // Use the options-object overload (Node 8 compatible) to route DNS through
        // the per-app mgu-uplink lease instead of the head unit's offline resolver.
        const req = https.get({
            protocol: 'https:',
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.path || '/',
            lookup
        }, (res) => {
            if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
                const location = res.headers.location;
                res.resume();
                if (!location || redirects >= MAX_REDIRECTS) { reject(new Error('CAMERA_DB_REDIRECT_LIMIT')); return; }
                getHttps(urlModule.resolve(requestUrl, location), redirects + 1, dataDir).then(resolve, reject);
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
function isTemporaryNetworkError(error) {
    return !!error && ['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH'].indexOf(error.code) >= 0;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function getWithRetry(requestUrl, attempts, dataDir) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try { return await getHttps(requestUrl, 0, dataDir); }
        catch (error) {
            lastError = error;
            if (!isTemporaryNetworkError(error) || i === attempts - 1) throw error;
            await wait(1000 * Math.pow(2, i));
        }
    }
    throw lastError || new Error('CAMERA_DB_DOWNLOAD_FAILED');
}
async function downloadDatabaseBody(dataDir) {
    try {
        return await getWithRetry(DATABASE_URL, 3, dataDir);
    } catch (rawError) {
        try {
            const apiBody = await getWithRetry(DATABASE_API_URL, 2, dataDir);
            const payload = JSON.parse(apiBody);
            if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
                throw new Error('CAMERA_DB_API_RESPONSE_INVALID');
            }
            return Buffer.from(payload.content.replace(/\\s/g, ''), 'base64').toString('utf8');
        } catch (apiError) {
            throw new Error('raw: ' + (rawError.code || rawError.message || 'network') +
                '; api: ' + (apiError.code || apiError.message || 'network'));
        }
    }
}
class CameraStore {
    constructor(options) {
        const o = options || {};
        this.dataDir = o.dataDir || process.cwd();
        this.bundled = validateDatabase(o.bundled);
        this.cachePath = path.join(this.dataDir, 'camera-db-cache.json');
        this.current = this.bundled;
        this.source = 'bundle';
    }
    loadLocal() {
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
    async refresh(onStatus) {
        const status = typeof onStatus === 'function' ? onStatus : function () {};
        try {
            status('Загрузка базы камер...');
            const body = await downloadDatabaseBody(this.dataDir);
            status('Проверка полученной базы...');
            const next = validateDatabase(JSON.parse(body));
            if (next.revision > this.current.revision) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'download';
                return { updated: true, database: this.current, source: this.source };
            }
            if (this.source === 'bundle' && !fs.existsSync(this.cachePath)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'cache';
            }
            return { updated: false, database: this.current, source: this.source };
        } catch (error) {
            return { updated: false, database: this.current, source: this.source,
                error: error && error.message ? error.message : 'CAMERA_DB_UPDATE_FAILED' };
        }
    }
}
module.exports = { CameraStore, validateDatabase, DATABASE_URL };
