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
assert.strictEqual(app.version,'0.5.6');assert.strictEqual(app.screens[0].kind,'canvas');
assert(app.settings[0].options.some(o=>o[0]==='mari-el'));
const {ProximityWarnings}=require(path.join(base,'proximity.js'));
const warnings=new ProximityWarnings();
const near={id:'test-camera',name:'Test',lat:56.63,lon:47.928};
assert.strictEqual(warnings.update({lat:56.63,lon:47.928,speedKmh:null,accuracyM:null},[near]).length,1,
  'Warnings must work when BMW omits GST accuracy and RMC speed');
for(const f of ['main.js','gps.js','camera-store.js','proximity.js'])cp.execFileSync(process.execPath,['--check',path.join(base,f)]);
cp.execFileSync('python3',['-m','py_compile',path.join(__dirname,'../tools/import_camera_sources.py')]);
cp.execFileSync('python3',['-m','py_compile',path.join(__dirname,'../tools/import_city_roads.py')]);
console.log('Speed Camera Warning 0.5.6 offline OSM map tests passed');
