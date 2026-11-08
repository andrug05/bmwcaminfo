'use strict';
const fs = require('fs');
const path = require('path');

function validateCamera(c) {
    if (!c || typeof c.id !== 'string' || !/^local-[a-z0-9-]{4,48}$/.test(c.id) ||
        !Number.isFinite(c.lat) || c.lat < -90 || c.lat > 90 ||
        !Number.isFinite(c.lon) || c.lon < -180 || c.lon > 180 ||
        (c.limit !== null && (!Number.isFinite(c.limit) || c.limit < 5 || c.limit > 250)) ||
        ['forward', 'both'].indexOf(c.direction) < 0 ||
        (c.road !== null && c.road !== undefined && (!Array.isArray(c.road.pts) || c.road.pts.length < 2 ||
            !Number.isFinite(c.road.camM) || c.road.camM < 0 || c.road.pts.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))))) {
        throw new Error('LOCAL_CAMERA_INVALID');
    }
    return {
        id: c.id, name: 'Моя камера', type: String(c.type || 'Камера').slice(0, 60),
        limit: c.limit, lat: c.lat, lon: c.lon, headingDeg: c.headingDeg,
        direction: c.direction, road: c.road ? { pts: c.road.pts.map(p => [p[0], p[1]]), camM: c.road.camM } : null,
        source: 'local-user', sourceLabel: 'Добавлена вручную',
        note: 'Локальная камера, сохранённая с GPS автомобиля'
    };
}
class LocalCameraStore {
    constructor(dataDir) {
        this.file = path.join(dataDir || process.cwd(), 'user-cameras.json');
        this.cameras = [];
    }
    load() {
        try {
            const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (!Array.isArray(value)) throw new Error('LOCAL_CAMERA_DB_INVALID');
            this.cameras = value.map(validateCamera);
        } catch (e) {
            if (e && e.code !== 'ENOENT') this.cameras = [];
        }
        return this.cameras.slice();
    }
    remove(id) {
        if (typeof id !== 'string' || !/^local-[a-z0-9-]{4,48}$/.test(id)) {
            throw new Error('LOCAL_CAMERA_ID_INVALID');
        }
        const next = this.cameras.filter(camera => camera.id !== id);
        if (next.length === this.cameras.length) return false;
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
        this.cameras = next;
        return true;
    }
    add(camera) {
        const clean = validateCamera(camera);
        if (this.cameras.some(c => c.id === clean.id)) throw new Error('LOCAL_CAMERA_DUPLICATE_ID');
        const next = this.cameras.concat([clean]);
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
        this.cameras = next;
        return clean;
    }
}
module.exports = { LocalCameraStore, validateCamera };
