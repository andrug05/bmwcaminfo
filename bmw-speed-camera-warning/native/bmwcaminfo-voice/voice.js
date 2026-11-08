'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const SOCKET = '/run/bmwcaminfo-voice/ctl.sock';
const ROOT = '/var/opt/bmwcaminfo-voice/current';
const SRC_ID = 1046;
const SINK_ID = 1024;
const LANG = 7695972;
const ALLOWED = {
  'camera-500.m4a': true,
  'camera-200.m4a': true
};

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function log(message) {
  console.log(new Date().toISOString() + ' ' + message);
}

function VoiceService() {
  this.cc = null;
  this.mp = null;
  this.queue = Promise.resolve();
  this.ready = false;
  this.lastError = null;
  this.connectionId = null;
}

VoiceService.prototype.init = async function () {
  if (this.cc && this.mp) return;
  var someip = require('/usr/lib/someip.node');
  var roots = ['/usr/lib/oap-mainapp/src-gen', '/usr/lib/oap-mainapp21/src-gen'];
  var root = null;
  for (var i = 0; i < roots.length; i++) {
    if (fs.existsSync(path.join(roots[i], 'org_genivi_am_commandinterface_CommandControl.json')) &&
        fs.existsSync(path.join(roots[i], 'de_bmw_infotainment_entertainment_mediaplayer_MediaPlayer.json'))) {
      root = roots[i];
      break;
    }
  }
  if (!root) throw new Error('BMW SOME/IP definitions not found');
  function read(name) {
    return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  }
  var cc = await someip.buildProxy(read('org_genivi_am_commandinterface_CommandControl.json'), '1');
  await cc.init();
  var mp = await someip.buildProxy(read('de_bmw_infotainment_entertainment_mediaplayer_MediaPlayer.json'), 'OapGenericMedia');
  await mp.init();
  this.cc = cc;
  this.mp = mp;
  log('BMW SOME/IP proxies initialized');
};

VoiceService.prototype.waitAvailable = async function () {
  await this.init();
  var deadline = Date.now() + 15000;
  while (!(await this.cc.isAvailable())) {
    if (Date.now() >= deadline) throw new Error('BMW CommandControl unavailable after 15 seconds');
    await sleep(250);
  }
  this.ready = true;
};

VoiceService.prototype.play = async function (file) {
  if (!ALLOWED[file]) throw new Error('Unsupported voice asset');
  var self = this;
  var task = this.queue.then(async function () {
    await self.waitAvailable();
    var audio = path.join(ROOT, 'audio', file);
    if (!fs.existsSync(audio)) throw new Error('Voice asset missing: ' + audio);
    var connected = await self.cc.callMethod('connect', { sourceID: SRC_ID, sinkID: SINK_ID }, 7000);
    log('connect: ' + JSON.stringify(connected));
    if (!connected || (connected.amError !== 'E_OK' && connected.amError !== 'E_ALREADY_EXISTS')) {
      throw new Error('BMW audio route failed: ' + JSON.stringify(connected));
    }
    self.connectionId = connected.mainConnectionID;
    try {
      var result = await self.mp.callMethod('playFile', { path: audio, languageCode: LANG }, 7000);
      log('playFile: ' + JSON.stringify(result));
      if (!result || result.EntError !== 'OK') throw new Error('BMW MediaPlayer rejected audio: ' + JSON.stringify(result));
      await sleep(file === 'camera-200.m4a' ? 6500 : 4000);
    } finally {
      await self.release();
    }
    self.lastError = null;
    return { ok: true, message: 'BMW MediaPlayer accepted playback' };
  });
  this.queue = task.catch(function (error) {
    self.lastError = error && error.message ? error.message : String(error);
    self.ready = false;
    log('PLAY_FAILED: ' + (error && error.stack || error));
    return { ok: false, error: self.lastError };
  });
  return this.queue;
};

VoiceService.prototype.release = async function () {
  var id = this.connectionId;
  this.connectionId = null;
  if (!this.mp || !this.cc) return;
  try {
    await this.mp.callMethod('sendButtonEvent', { button: 'STOP', action: 'PRESS' }, 3000);
  } catch (e) { log('STOP: ' + e.message); }
  if (id !== null && id !== undefined && id !== -1) {
    try {
      await this.cc.callMethod('disconnect', { mainConnectionID: id }, 5000);
    } catch (e2) { log('disconnect: ' + e2.message); }
  }
};

var voice = new VoiceService();

function reply(socket, payload) {
  try { socket.write(JSON.stringify(payload) + '\n'); } catch (e) {}
}

var server = net.createServer(function (socket) {
  socket.setEncoding('utf8');
  var buffer = '';
  socket.on('data', function (chunk) {
    buffer += chunk;
    if (buffer.length > 4096) {
      reply(socket, { ok: false, error: 'Request too large' });
      socket.destroy();
      return;
    }
    var newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      var line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      var request;
      try { request = JSON.parse(line); } catch (e) {
        reply(socket, { ok: false, error: 'Invalid JSON' });
        continue;
      }
      if (request.action === 'status') {
        reply(socket, { ok: true, ready: voice.ready, lastError: voice.lastError });
      } else if (request.action === 'play' && ALLOWED[request.file]) {
        voice.play(request.file).then(function (result) { reply(socket, result); });
      } else {
        reply(socket, { ok: false, error: 'Unknown action or audio file' });
      }
    }
  });
});

try { fs.unlinkSync(SOCKET); } catch (e) {}
server.listen(SOCKET, function () {
  try { fs.chownSync(SOCKET, 0, 12202); } catch (e) { log('socket chown: ' + e.message); }
  try { fs.chmodSync(SOCKET, 0o660); } catch (e2) { log('socket chmod: ' + e2.message); }
  log('control socket ready: ' + SOCKET);
});

server.on('error', function (error) {
  log('SOCKET_ERROR: ' + error.stack);
  process.exit(1);
});

process.on('SIGTERM', function () {
  voice.release().then(function () { server.close(function () { process.exit(0); }); });
});
process.on('uncaughtException', function (error) {
  log('UNCAUGHT: ' + error.stack);
});
