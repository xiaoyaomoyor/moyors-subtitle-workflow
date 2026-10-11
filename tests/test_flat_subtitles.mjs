import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import core from '../web/msw-flat-subtitles.js';
import old from '../web/msw-subtitle-tracks.js';

const fixture=name=>JSON.parse(readFileSync(new URL(`fixtures/${name}.json`,import.meta.url),'utf8'));
const fixtures=[...fixture('subtitle-layers'),...fixture('subtitle-tracks'),{name:'assets',project:fixture('msw_beta1_legacy_project')}];
const sample=()=>core.migrate(fixture('subtitle-tracks')[0].project);
const ref=(cue_id,role='main',track_id=null)=>({cue_id,role,track_id});
const add=(p,id='free')=>core.addTrack(p,{...p.subtitles.tracks[0],id,name:'普通字幕'});

for(const f of fixtures)test(`flat migration: ${f.name}`,()=>{
  const before=structuredClone(f.project),p=core.migrate(f.project);
  assert.deepEqual(f.project,before);
  assert.deepEqual(core.migrate(p),p);
  assert.deepEqual(core.legacyProjection(p),old.migrate(f.project));
  assert.equal(new Set(p.subtitles.cues.map(c=>c.id)).size,p.subtitles.cues.length);
  assert.equal(Object.hasOwn(p,'segments'),false);
  assert.equal(Object.hasOwn(p,'multi_subtitle'),false);
  assert.ok(p.subtitles.migration.structure.segments.every(id=>typeof id==='string'));
});

test('independent track moves retain identity, binding and processing source',()=>{
  const p=add(sample()),index=core.createIndex(p),a=index.resolveLegacy(ref('a')),b=index.resolveLegacy(ref('a','extension','zh'));
  assert.notEqual(a.id,b.id);
  assert.notEqual(a.track_id,b.track_id);
  const moved=core.move(p,[b.id],'free'),after=core.createIndex(moved);
  assert.equal(after.resolve(a.id).track_id,a.track_id);
  assert.equal(after.resolve(b.id).track_id,'free');
  assert.deepEqual(moved.subtitles.bindings,p.subtitles.bindings);
  assert.deepEqual(after.partners(a.id),[after.resolve(b.id)]);
  assert.equal(after.resolveSource({id:'a',track_id:'zh',kind:'subtitle'}).id,b.id);
  assert.equal(after.resolveSource({id:'asset-1',source_cue_id:'a',track_id:'zh'}).id,b.id);
  assert.equal(after.resolveSource({subtitle_cue_id:b.id,id:'wrong'}).id,b.id);
  assert.equal(after.resolveSource({subtitle_cue_id:'missing',id:'a'}),null);
  assert.equal(after.resolveSource({kind:'editor_text',id:'a'}),null);
  assert.equal(index.resolve(b.id).track_id,b.track_id);
  assert.throws(()=>core.legacyProjection(moved),/降级/);
});

test('locks, collisions and relationship errors are atomic',()=>{
  const p=add(sample()),before=structuredClone(p),i=core.createIndex(p),a=i.resolveLegacy(ref('a')),b=i.resolveLegacy(ref('b'));
  assert.throws(()=>core.move(p,[a.id],b.track_id),/重叠/);
  assert.deepEqual(p,before);
  for(const id of [a.track_id,'free']) {
    const locked=structuredClone(p);locked.subtitles.tracks.find(t=>t.id===id).locked=true;
    assert.throws(()=>core.move(locked,[a.id],'free'),/锁定/);
  }
  const partner=i.partners(a.id)[0];
  assert.throws(()=>core.bind(p,a.id,partner.id,'duplicate'),/对应关系/);
  const unbound=core.unbind(p,'pair-a');
  assert.deepEqual(unbound.subtitles.cues,p.subtitles.cues);
  const rebound=core.bind(unbound,partner.id,a.id,'reversed');
  const link=rebound.subtitles.bindings.find(b=>b.id==='reversed');
  assert.equal(link.start_offset_ms,298);
  assert.equal(link.end_offset_ms,506);
  assert.equal(p.subtitles.bindings.length,2);
});

test('native model works without legacy storage or provenance',()=>{
  let p=add(core.migrate({segments:[]}));delete p.subtitles.migration;
  const [a,b]=p.subtitles.tracks;
  p.subtitles.cues=[{id:'native-a',track_id:a.id,content:{start:10,end:100,text:'一',items:[]}},
    {id:'native-b',track_id:b.id,content:{start:20,end:120,text:'two',items:[]}}];
  p=core.bind(p,'native-a','native-b','native-pair');
  assert.equal(core.createIndex(p).records().length,2);
  assert.equal(core.createIndex(p).resolveSource({subtitle_cue_id:'native-b'}).content.text,'two');
  assert.throws(()=>core.legacyProjection(p),/没有可无损/);
  p.subtitles.tracks[0].purpose='translation';p.subtitles.tracks[1].purpose='source';
  assert.equal(core.validate(p),true); // Purpose does not determine ownership/direction.
});

test('marker references survive reordered cues and preserve opaque content fields',()=>{
  const legacy=old.migrate({segments:[{id:'head',start:0,end:1000,text:'h'},{id:'tail',start:1000,end:2000,text:'t'}]});
  legacy.segments[0].color={name:'选区',value:'#3043cf'};
  legacy.segments[1].color_ref={headIdx:0,name:'选区',cue_id:{opaque:true}};
  legacy.segments[1].track_id={future:'body field'};legacy.segments[1].hidden='unknown body field';
  const p=core.migrate(legacy),i=core.createIndex(p),tail=i.resolveLegacy(ref('tail')),head=i.resolveLegacy(ref('head'));
  assert.equal(tail.content.color_ref.cue_id,head.id);
  assert.deepEqual(tail.content.track_id,{future:'body field'});
  assert.equal(tail.content.hidden,'unknown body field');
  assert.deepEqual(core.legacyProjection(p),legacy);
  p.subtitles.cues.reverse();assert.equal(core.validate(p),true);
  assert.equal(core.createIndex(p).resolve(tail.id).content.color_ref.cue_id,head.id);
});

test('all language tracks including empty ones migrate; aliases survive ordering',()=>{
  const source=structuredClone(fixtures.find(f=>f.name==='bound-bilingual').project);
  source.multi_subtitle.tracks.push({id:'empty',name:'日语',language:'ja',segments:[]});
  const p=core.migrate(source);
  assert.ok(p.subtitles.tracks.some(t=>t.language==='ja'));
  assert.deepEqual(core.legacyProjection(p),old.migrate(source));
  const sorted=old.migrate(source);sorted.segments.reverse();sorted.multi_subtitle.tracks.reverse();
  const q=core.migrate(sorted),ids=m=>Object.fromEntries(m.subtitles.migration.identities.map(a=>[JSON.stringify(ref(a.cue_id,a.role,a.track_id)),a.id]));
  assert.deepEqual(ids(p),ids(q));
});

test('zero-duration tokens and optional frame projections remain unchanged',()=>{
  const source={timebase:{unit:'frames',fps:30000/1001},segments:[{id:'词🎬',start:0,end:1001,start_frame:0,end_frame:30,text:'字',
    items:[{start:0,end:0,text:''},{start:0,end:1001,text:'字',start_frame:0,end_frame:30}]}]};
  const p=core.migrate(source);
  assert.deepEqual(core.legacyProjection(p),old.migrate(source));
  assert.equal(p.subtitles.cues[0].content.end,1001);
});

test('invalid graphs and future versions fail before mutation',()=>{
  const changes=[p=>p.subtitles.cues.push(p.subtitles.cues[0]),p=>p.subtitles.cues[0].track_id='missing',
    p=>p.segments=[],p=>p.schema='msw.project.v5',p=>p.subtitles.schema='msw.subtitles.v2',
    p=>p.subtitles.tracks[0].parent_id='parent',p=>p.subtitles.tracks[0].locked=1,
    p=>p.subtitles.cues[0].content.items=null,p=>p.subtitles.cues[0].content.items=[{text:'late',start:4000,end:5000}],
    p=>p.subtitles.bindings[0].start_offset_ms=0,p=>p.subtitles.cues[0].content.color_ref={cue_id:'missing'},
    p=>p.subtitles.migration.structure.segments=[{}],p=>p.subtitles.migration.identities[0].cue_id='reused',
    p=>p.subtitles.migration.structure.multi_subtitle.tracks={},p=>p.timebase={unit:'frames',fps:true}];
  for(const change of changes){const p=sample();change(p);assert.throws(()=>core.validate(p));}
  assert.throws(()=>core.migrate({segments:[],subtitles:{}}),/未覆盖/);
  const circular={};circular.self=circular;assert.throws(()=>core.migrate(circular),/循环/);
  assert.throws(()=>old.migrate(sample()));
});

test('browser module and Node module produce identical graphs',()=>{
  const context=vm.createContext({});
  for(const name of ['msw-subtitle-layers','msw-subtitle-tracks','msw-flat-subtitles'])
    vm.runInContext(readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8'),context);
  for(const f of fixtures)assert.deepEqual(JSON.parse(JSON.stringify(context.MSWFlatSubtitles.migrate(f.project))),core.migrate(f.project));
});
