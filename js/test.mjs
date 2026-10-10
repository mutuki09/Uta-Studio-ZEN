import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=new URL('./',import.meta.url);
const context=vm.createContext({window:{}});
for(const file of ['js/theory.js','data/presets.js','js/compose.js','js/midi-doctor.js','js/harmony-lab.js']) vm.runInContext(fs.readFileSync(new URL(file,dir),'utf8'),context);
const u=context.window.UG,clean=x=>JSON.parse(JSON.stringify(x));
const melody=[{s:0,d:64,n:60}],chords=[{root:0,type:'maj'},{root:9,type:'min'},{root:5,type:'maj'},{root:7,type:'maj'}],rhythm={bass:'walk',padGate:1};
u.harmonyLab.enabled=false;const a=clean(u.compose.backing(melody,chords,rhythm));
u.harmonyLab.enabled=true;const b=clean(u.compose.backing(melody,chords,rhythm));
assert.deepEqual(a.bass,b.bass);assert.deepEqual(a.drum,b.drum);assert.equal(a.bars,b.bars);
const travel=x=>x.pad.slice(1).reduce((s,p,i)=>s+u.harmonyLab.distance(x.pad[i].chord,p.chord),0);
assert.ok(travel(b)<travel(a));
b.pad.forEach((p,i)=>assert.deepEqual([...new Set(p.chord.map(n=>n%12))].sort(),clean(u.theory.chordPitches(chords[i])).sort()));
for(const type of Object.keys(u.theory.CHORD_SHAPES||{})){assert.ok(type);}
for(const type of ['maj','min7','dom9','dim7','power','dom7b9']){const c={root:7,type};const v=clean(u.harmonyLab.voice(c,[48,52,55]));assert.deepEqual([...new Set(v.map(n=>n%12))].sort(),[...new Set(clean(u.theory.chordPitches(c)))].sort());assert.ok(v.every(n=>n>=48&&n<=84));}
u.harmonyLab.enabled=false;assert.deepEqual(clean(u.compose.backing(melody,chords,rhythm)),a);
const sample={key:{root:0,mode:'major'},chords:[chords[0]],melody:[{s:0,d:2,n:60},{s:2,d:2,n:61},{s:4,d:8,n:62}]};
assert.ok(u.midiDoctor.diagnose(sample,120).issues.some(i=>i.id==='offscale'&&i.level==='error'));
u.harmonyLab.enabled=true;const before=JSON.stringify(sample),r=u.midiDoctor.diagnose(sample,120);
assert.equal(r.harmonyContext[0].kind,'経過音候補');assert.equal(JSON.stringify(sample),before);assert.ok(!r.issues.some(i=>i.id==='offscale'));
u.midiDoctor.repair(sample,{overlap:false,leap:false,short:false});assert.equal(sample.melody[1].n,61);
const disconnected=clean(sample);disconnected.melody[1].s=3;assert.equal(u.harmonyLab.context(disconnected,sample.key)[0].kind,'要試聴');
const long=clean(sample);long.melody[1].d=8;assert.equal(u.harmonyLab.context(long,sample.key)[0].kind,'要試聴');
const overlap=clean(sample);overlap.melody[1].s=1;assert.ok(u.midiDoctor.diagnose(overlap,120).issues.some(i=>i.id==='overlap'&&i.level==='error'));
const originalDir=process.env.AI_SCORE_ORIGINAL_DIR;
if(originalDir){
const originalContext=vm.createContext({window:{}});for(const file of ['js/theory.js','data/presets.js','js/compose.js'])vm.runInContext(fs.readFileSync(originalDir.replace(/[\\/]+$/,'')+'/'+file,'utf8'),originalContext);
u.harmonyLab.enabled=false;assert.deepEqual(clean(u.compose.backing(melody,chords,rhythm)),clean(originalContext.window.UG.compose.backing(melody,chords,rhythm)));
}else console.log('Original version comparison skipped: AI_SCORE_ORIGINAL_DIR not set');
console.log(JSON.stringify({passed:true,movementOriginal:travel(a),movementEnhanced:travel(b),checks:'pitch classes, bass/drums preserved, original equivalence, diagnostic nonmutation, chromatic preservation, overlap error'}));
vm.runInContext(fs.readFileSync(new URL('js/project.js',dir),'utf8'),context);
const saved={lyrics:'あ',song:{melody:[{s:0,d:4,n:60}],bass:[],pad:[],chords:[{root:0,type:'maj'}],drum:[],key:{root:0,mode:'major'},bars:1}};
assert.deepEqual(clean(u.project.decode(u.project.encode(saved))),saved);
for(const bars of ['<img src=x onerror=alert(1)>',0,Infinity,10001]){
  const invalid=clean(saved);invalid.song.bars=bars;
  assert.throws(()=>u.project.validate(invalid),/小節数/);
}
console.log('Project roundtrip and invalid bar count rejection: passed');
