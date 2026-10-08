import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const core = createRequire(import.meta.url)('../web/msw-subtitle-layers.js');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/subtitle-layers.json', import.meta.url), 'utf8'));

for (const fixture of fixtures) test(`migration is deterministic and nonmutating: ${fixture.name}`, () => {
  const before = JSON.stringify(fixture.project), result = core.migrate(fixture.project);
  assert.equal(JSON.stringify(fixture.project), before);
  assert.equal(result.schema, core.SCHEMA);
  assert.deepEqual(core.migrate(fixture.project), result);
  assert.deepEqual(core.migrate(result), result);
  assert.equal(result.segments.length, fixture.project.segments.length + (fixture.project.overlay_track?.segments?.length || 0));
  assert.equal(new Set(result.segments.map(cue => cue.id)).size, result.segments.length);
  for (const cue of fixture.project.segments) if (cue.id) {
    const migrated = result.segments.find(row => row.id === cue.id);
    assert.equal(migrated.start, cue.start); assert.equal(migrated.end, cue.end);
  }
});

test('legacy hidden overlay keeps its visibility, reference materialization and source identity', () => {
  const result = core.migrate(fixtures.find(f => f.name === 'collision-hidden-references').project);
  const legacy = result.subtitle_layers.legacy_overlay;
  assert.equal(legacy.visible, false);
  const cue = result.segments.find(c => c.id === legacy.cue_ids[1]);
  assert.equal(cue.color.name, 'purple'); assert.equal(cue.sticker.file, 'synthetic.png');
  assert.equal(cue.color_ref, undefined); assert.equal(cue.sticker_ref, undefined);
  assert.equal(core.records(result).length, 1);
  assert.equal(core.records(result, { includeHidden: true }).length, 3);
  assert.equal(result.msw.assets[0].source_ref.id, legacy.cue_ids[0]);
  assert.equal(result.msw.assets[0].source_ref.track_kind, undefined);
  assert.equal(result.msw.processing_results[0].edits[0].text, 'overlay source remains text');
});

test('interval index finds nested cues, same starts, disabled cues and exact half-open endpoints', () => {
  const cues = [{ id:'a',start:0,end:10000 },{ id:'b',start:0,end:1000,disabled:true },
    { id:'c',start:2000,end:3000 },{ id:'d',start:3000,end:4000 }];
  const index = new core.IntervalIndex(cues);
  assert.deepEqual(index.at(0), [0,1]);
  assert.deepEqual(index.at(0, { includeDisabled:false }), [0]);
  assert.deepEqual(index.at(3000), [0,3]);
  assert.deepEqual(index.at(9000), [0]);
  assert.deepEqual(index.at(10000), []);
  assert.deepEqual(index.range(1500,3000), [0,2]);
});

test('layer packing supports more than three rows and does not change across waveform line breaks', () => {
  const cues = Array.from({length:5}, (_,i) => ({id:'cue-'+i,start:i*100,end:21000-i*100}));
  const layout = core.pack(cues);
  assert.equal(layout.count,5);
  assert.equal(new Set(layout.lanes.values()).size,5);
  assert.deepEqual(core.pack(cues,layout.lanes).lanes,layout.lanes);
  assert.deepEqual(layout.index.range(0,10000),layout.index.range(10000,20000));
  assert.equal(core.pack([{id:'a',start:0,end:1000},{id:'b',start:1000,end:2000}]).count,1);
});

test('commands resolve role and ID, preserve unselected layers, and never squeeze neighbours', () => {
  const project=core.migrate(fixtures.find(f=>f.name==='bound-bilingual').project);
  const before=JSON.stringify(project.multi_subtitle);
  const ref={role:'main',track_id:null,cue_id:'a'};
  assert.equal(core.applyRanges(project,[{ref,start:1000,end:4000}]).ok,true);
  assert.equal(project.segments.find(c=>c.id==='b').start,2000);
  assert.equal(JSON.stringify(project.multi_subtitle),before);
  assert.equal(core.resolve(project,ref).cue.end,4000);
  assert.equal(core.resolve(project,{...ref,cue_id:'missing'}),null);
  assert.equal(core.key(ref),core.key({...ref,track_id:''}));
});

test('disabling new overlaps preserves existing intersections but rejects a new collision atomically', () => {
  const project=core.migrate({segments:[{id:'a',start:0,end:2000,text:'a'},{id:'b',start:1000,end:3000,text:'b'},
    {id:'c',start:4000,end:5000,text:'c'}]});
  const before=JSON.stringify(project);
  assert.equal(core.applyRanges(project,[{ref:{role:'main',cue_id:'c'},start:1500,end:2500}],{allowOverlap:false}).ok,false);
  assert.equal(JSON.stringify(project),before);
  assert.equal(core.applyRanges(project,[{ref:{role:'main',cue_id:'a'},start:100,end:2100}],{allowOverlap:false}).ok,true);
});

test('sorting retains group references by object identity', () => {
  const cues=[{id:'a',start:3000,end:4000,color:{name:'purple'}},{id:'b',start:1000,end:2000,color_ref:{headIdx:0,name:'purple'}}];
  core.sortTrack(cues); assert.equal(cues[0].id,'b'); assert.equal(cues[0].color_ref.headIdx,1);
});

test('migration refuses unknown schema and ambiguous within-role identities', () => {
  assert.throws(()=>core.migrate({schema:'future',segments:[]}));
  assert.throws(()=>core.migrate({segments:[{id:'a'},{id:'a'}]}));
});


test('legacy compatibility export refuses unrepresentable overlap and never changes the source',()=>{
 const c=globalThis.MSWSubtitleLayers;
 const project=c.migrate({segments:[{id:'a',start:0,end:3000,text:'A'},{id:'b',start:1000,end:2000,text:'B'}]});
 const original=JSON.stringify(project);assert.throws(()=>c.legacyExport(project),/多层重叠/);assert.equal(JSON.stringify(project),original);
 project.segments[1].start=3000;project.segments[1].end=4000;
 const exported=c.legacyExport(project);assert.equal(exported.schema,'moy.asr.project.v1');assert.ok(!exported.subtitle_layers);assert.equal(project.schema,'msw.project.v2');
});

test('legacy compatibility export materializes cross-group color references before partitioning',()=>{
 const project=core.migrate({segments:[{id:'main',start:0,end:1000,text:'M'}],overlay_track:{enabled:false,segments:[{id:'old',start:1000,end:2000,text:'O'}]}});
 project.segments[0].color={name:'purple'};project.segments[1].color_ref={headIdx:0,name:'purple'};
 const exported=core.legacyExport(project);
 assert.equal(exported.overlay_track.segments[0].color.name,'purple');assert.equal(exported.overlay_track.segments[0].color_ref,undefined);
 assert.equal(project.segments[1].color_ref.headIdx,0);
});


const mergeFixture = () => ({ segments: [
  {id:'m1',start:0,end:1000,text:'one',items:[{text:'one',start:0,end:1000}],color:{name:'red',value:'#f00'}},
  {id:'m2',start:1000,end:2000,text:'two',items:[],disabled:true},
], multi_subtitle:{enabled:false,tracks:[{id:'sub',segments:[
  {id:'s1',start:100,end:900,text:'甲',items:[],color:{name:'blue'}},
  {id:'s2',start:1100,end:1900,text:'乙',items:[],color:{name:'blue'}},
  {id:'unbound',start:500,end:1500,text:'旁白'},
]}],bindings:[1,2].map(n=>({id:'b'+n,track_id:'sub',main_segment_ids:['m'+n],extension_segment_ids:['s'+n]}))}});

for (const role of ['main','extension']) for (const mode of ['union','common']) test(`merge plan is symmetric, nonmutating and preserves explicit links: ${role} ${mode}`,()=>{
  const project=core.migrate(mergeFixture()), before=JSON.stringify(project);
  const plan=core.planMerge(project,{role,track_id:role==='extension'?'sub':null},role==='main'?['m1','m2']:['s1','s2'],{mode});
  assert.equal(JSON.stringify(project),before);
  const main=plan.changes.find(t=>t.role==='main'), sub=plan.changes.find(t=>t.role==='extension');
  assert.equal(main.merged.disabled,mode==='union');
  assert.equal(main.merged.color?.name,mode==='union'?'red':undefined);
  assert.equal(sub.merged.color.name,'blue');
  assert.deepEqual(main.merged.items,[{text:'one',start:0,end:1000}]);
  assert.deepEqual([sub.merged.start,sub.merged.end],[100,1900]);
  assert.equal(sub.segments.find(c=>c.id==='unbound').text,'旁白');
  assert.equal(plan.bindings.length,1);
  assert.deepEqual(plan.bindings[0].main_segment_ids,[main.merged.id]);
  assert.deepEqual(plan.bindings[0].extension_segment_ids,[sub.merged.id]);
  assert.equal(plan.bindings[0].start_offset_ms,100);assert.equal(plan.bindings[0].end_offset_ms,-100);
});

test('merge marker conflicts use earliest nonempty marker and common mode compares values rather than group identity',()=>{
 const project={segments:[{id:'a',start:0,end:1000,text:'a'},
  {id:'b',start:1000,end:2000,text:'b',color:{name:'red',start:1000,end:2000}},
  {id:'c',start:2000,end:3000,text:'c',color:{name:'blue'}}]};
 const union=core.planMerge(project,{role:'main'},['c','a','b']);
 assert.equal(union.changes[0].merged.color.name,'red');assert.deepEqual(union.conflicts,['color']);
 assert.equal(core.planMerge(project,{role:'main'},['a','b'],{mode:'common'}).changes[0].merged.color,undefined);
 project.segments[2].color={end:3000,name:'red',start:2000};
 assert.equal(core.planMerge(project,{role:'main'},['b','c'],{mode:'common'}).changes[0].merged.color.name,'red');
});

test('merge repairs external marker references without changing their effective appearance',()=>{
 const project={segments:[{id:'a',start:0,end:1000,text:'a',sticker:{name:'hat',file:'hat.png'}},
 {id:'b',start:1000,end:2000,text:'b'}, {id:'c',start:2000,end:3000,text:'c',sticker_ref:{headIdx:0,name:'hat'}}]};
 const plan=core.planMerge(project,{role:'main'},['a','b'],{mode:'common'});
 assert.equal(plan.changes[0].merged.sticker,undefined);
 const remaining=plan.changes[0].segments.find(c=>c.id==='c');
 assert.equal(remaining.sticker.file,'hat.png');assert.equal(remaining.sticker_ref,undefined);
 assert.equal(project.segments[2].sticker_ref.headIdx,0);
});

test('common states recognize the same palette name and sticker across independent groups',()=>{
 const project={segments:[
  {id:'a',start:0,end:1000,text:'a',disabled:true,color:{name:'red',value:'#e74c3c'},sticker:{name:'hat',path:'hat.png',start:0,end:1000}},
  {id:'b',start:1000,end:2000,text:'b',disabled:true,color:{name:'red',value:'#f07f6f'},sticker:{path:'hat.png',name:'hat',start:1000,end:2000}},
 ]};
 const plan=core.planMerge(project,{role:'main'},['a','b'],{mode:'common'});
 assert.equal(plan.changes[0].merged.disabled,true);
 assert.equal(plan.changes[0].merged.color.name,'red');
 assert.equal(plan.changes[0].merged.sticker.path,'hat.png');
 assert.deepEqual(core.planMerge(project,{role:'main'},['a','b']).conflicts,[]);
 project.segments[1].sticker.path='different.png';
 assert.equal(core.planMerge(project,{role:'main'},['a','b'],{mode:'common'}).changes[0].merged.sticker,undefined);
});

test('merge with one bound partner preserves its ID and never invents missing translation',()=>{
 const project=mergeFixture();project.multi_subtitle.bindings.splice(1);
 const plan=core.planMerge(project,{role:'main'},['m1','m2']);
 const partner=plan.changes.find(t=>t.role==='extension');
 assert.equal(partner.changed,false);assert.equal(partner.merged.id,'s1');
 assert.equal(partner.segments.length,3);assert.deepEqual(plan.bindings[0].extension_segment_ids,['s1']);
});

test('merge rejects partner-only new overlap atomically',()=>{
 const project=core.migrate(mergeFixture());project.subtitle_layers.allow_overlap=false;
 project.multi_subtitle.tracks[0].segments.find(c=>c.id==='unbound').start=950;
 project.multi_subtitle.tracks[0].segments.find(c=>c.id==='unbound').end=1050;
 const before=JSON.stringify(project);
 assert.throws(()=>core.planMerge(project,{role:'main'},['m1','m2']),/新增重叠/);
 assert.equal(JSON.stringify(project),before);
});
