'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),cp=require('child_process');
const base=path.join(__dirname,'../apps/aurelm_speed_camera_warning');
const db=require(path.join(base,'camera-db.json')),map=require(path.join(base,'city-map.json'));
assert(Number.isInteger(db.revision) && db.revision>=3);
assert(Array.isArray(db.cities['mari-el']));
assert(Array.isArray(db.cities['yoshkar-ola']));
assert(db.cities['yoshkar-ola'].filter(c=>typeof c.lat==='number'&&typeof c.lon==='number').length>=4);
assert(db.cities['yoshkar-ola'].some(c=>c.source==='local-curated'));
assert(map.roads.length>=20);
assert(map.source && map.source.includes('OpenStreetMap'));
for(const r of map.roads){assert.strictEqual(r.length,5);assert(r.slice(1).every(Number.isFinite));}
const app=JSON.parse(fs.readFileSync(path.join(base,'app.json'),'utf8'));
assert.strictEqual(app.version,'0.7.5');assert.strictEqual(app.screens[0].kind,'canvas');
assert(app.settings[0].options.some(o=>o[0]==='mari-el'));
assert(app.screens[0].buttons.some(b=>b[0]==='BTN_VOICE_TEST'),'Voice test button must be present');
const {ProximityWarnings}=require(path.join(base,'proximity.js'));
const warnings=new ProximityWarnings();
const near={id:'test-camera',name:'Test',lat:56.63,lon:47.928};
const northFix={lat:56.629,lon:47.928,speedKmh:36,headingDeg:0,accuracyM:10};
assert.strictEqual(warnings.update(northFix,[near]).filter(e=>e.type==='camera').length,1,
  'Warn for a camera ahead on the current heading');
assert.strictEqual(new ProximityWarnings().update({lat:56.631,lon:47.928,speedKmh:36,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn for a camera behind the vehicle');
assert.strictEqual(new ProximityWarnings().update({lat:56.629,lon:47.931,speedKmh:36,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn for a camera far off the current road corridor');
assert.strictEqual(new ProximityWarnings().update({lat:56.629,lon:47.928,speedKmh:0,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn when course is unreliable at very low speed');
const limited={id:'limited-camera',name:'60 zone',lat:56.63,lon:47.928,limit:60};
const limitFix={lat:56.6264,lon:47.928,speedKmh:77,headingDeg:0,accuracyM:10};
let w=new ProximityWarnings();
assert(!w.update(limitFix,[limited]).some(e=>e.type==='speeding'), 'No speeding alert below +18 km/h');
w=new ProximityWarnings();
assert(w.update(Object.assign({},limitFix,{speedKmh:78}),[limited]).some(e=>e.type==='speeding'&&e.excessKmh===18), 'Speeding alert must trigger at exactly +18 km/h');
w=new ProximityWarnings();
const road={name:'Тестовая улица',limitKmh:40,a:[56.6299,47.928],b:[56.6301,47.928]};
const roadEvent=w.update({lat:56.629,lon:47.928,speedKmh:100,headingDeg:0,accuracyM:10},[near],[road]).find(e=>e.type==='speeding');
assert(!roadEvent,'OSM road-segment limits must not trigger speeding alerts');
w=new ProximityWarnings();
assert(!w.update({lat:56.629,lon:47.928,speedKmh:100,headingDeg:0,accuracyM:10},[{id:'unknown-limit',lat:56.63,lon:47.928}]).some(e=>e.type==='speeding'), 'Do not infer speeding when camera limit is unknown');
for(const f of ['main.js','gps.js','camera-store.js','proximity.js','road-guidance.js','voice-alert.js'])cp.execFileSync(process.execPath,['--check',path.join(base,f)]);
cp.execFileSync('python3',['-m','py_compile',path.join(__dirname,'../tools/import_camera_sources.py')]);
cp.execFileSync('python3',['-m','py_compile',path.join(__dirname,'../tools/import_city_roads.py')]);
console.log('Speed Camera Warning 0.7.6 rollback base tests passed');
