'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE_ID = 1046;
const SINK_ID = 1024;
const LANGUAGE_CODE = 7695972;
const PLAY_TIMEOUT_MS = 5500;

/*
 * Spoken camera warnings use BMW's MediaPlayer over SOME/IP. This is the same
 * public head-unit path used by RideTube (source 1046 -> sink 1024), not the
 * browser Web Speech API, which is unavailable in the MGU app runtime.
 */
class CameraVoiceAlerts {
    constructor(options) {
        this.assetDir = options.assetDir;
        this.log = options.log || function () {};
        this.queue = Promise.resolve();
        this.cc = null;
        this.mp = null;
        this.connectionId = null;
        this.busy = false;
    }

    _say(file) {
        this.queue = this.queue.then(() => this._play(file)).catch((e) => {
            this.log('voice alert failed: ' + (e && e.stack || e));
        });
        return this.queue;
    }

    camera(stage) {
        return this._say(stage === 2 ? 'camera-200.m4a' : 'camera-500.m4a');
    }

    async _init() {
        if (this.cc && this.mp) return;
        const someip = require('/usr/lib/someip.node');
        const roots = ['/usr/lib/oap-mainapp/src-gen', '/usr/lib/oap-mainapp21/src-gen'];
        let srcGen = null;
        for (let i = 0; i < roots.length; i++) {
            if (fs.existsSync(path.join(roots[i], 'org_genivi_am_commandinterface_CommandControl.json')) &&
                fs.existsSync(path.join(roots[i], 'de_bmw_infotainment_entertainment_mediaplayer_MediaPlayer.json'))) {
                srcGen = roots[i];
                break;
            }
        }
        if (!srcGen) throw new Error('BMW MediaPlayer SOME/IP definitions not found');
        const read = (name) => JSON.parse(fs.readFileSync(path.join(srcGen, name), 'utf8'));
        const cc = await someip.buildProxy(read('org_genivi_am_commandinterface_CommandControl.json'), '1');
        await cc.init();
        const mp = await someip.buildProxy(read('de_bmw_infotainment_entertainment_mediaplayer_MediaPlayer.json'), 'OapGenericMedia');
        await mp.init();
        this.cc = cc;
        this.mp = mp;
    }

    async _play(file) {
        await this._init();
        const deadline = Date.now() + 5000;
        while (!(await this.cc.isAvailable())) {
            if (Date.now() >= deadline) throw new Error('BMW CommandControl is not available');
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const audioPath = path.join(this.assetDir, 'audio', file);
        if (!fs.existsSync(audioPath)) throw new Error('voice file missing: ' + audioPath);
        const connected = await this.cc.callMethod('connect', { sourceID: SOURCE_ID, sinkID: SINK_ID }, 5000);
        if (!connected || (connected.amError !== 'E_OK' && connected.amError !== 'E_ALREADY_EXISTS')) {
            throw new Error('BMW audio connect failed: ' + JSON.stringify(connected));
        }
        this.connectionId = connected.mainConnectionID;
        try {
            const result = await this.mp.callMethod('playFile', { path: audioPath, languageCode: LANGUAGE_CODE }, 5000);
            if (!result || result.EntError !== 'OK') throw new Error('BMW playFile failed: ' + JSON.stringify(result));
            await new Promise((resolve) => setTimeout(resolve, PLAY_TIMEOUT_MS));
        } finally {
            await this._release();
        }
    }

    async _release() {
        if (this.connectionId === null || this.connectionId === undefined) return;
        const id = this.connectionId;
        this.connectionId = null;
        try {
            await this.mp.callMethod('sendButtonEvent', { button: 'STOP', action: 'PRESS' }, 3000);
        } catch (e) {
            this.log('voice STOP: ' + e.message);
        }
        try {
            if (id !== -1) await this.cc.callMethod('disconnect', { mainConnectionID: id }, 5000);
        } catch (e) {
            this.log('voice disconnect: ' + e.message);
        }
    }
}

module.exports = { CameraVoiceAlerts };
