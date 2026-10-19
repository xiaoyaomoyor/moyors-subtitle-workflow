import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../web/msw-subtitle-tracks.js';
import P from '../web/msw-track-presentation.js';
import flat from '../web/msw-flat-subtitles.js';
import production from '../web/msw-production-project.js';
const context={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js','msw-project-style.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
globalThis.MSWProjectStyle=context.window.MSWProjectStyle;
const S=globalThis.MSWProjectStyle;
test('group order belongs to physical tracks, independent of binding direction and list columns',()=>{
  const native=flat.migrate({segments:[{id:'source',start:1000,end:2000,text:'Source'}],multi_subtitle:{enabled:true,
    tracks:[{id:'zh',segments:[{id:'translation',start:1100,end:2100,text:'Translation'}]}],
    bindings:[{id:'b',track_id:'zh',main_segment_ids:['source'],extension_segment_ids:['translation']}]}});
  const [main,secondary]=native.subtitles.tracks;
  secondary.secondary_for=main.id;flat.normalizeGroups(native);
  assert.equal(secondary.secondary_for,main.id);
  const source=native.subtitles.cues.find(c=>c.track_id===main.id),translation=native.subtitles.cues.find(c=>c.track_id===secondary.id);
  const positions=p=>P.layout(production.fromProject(p),{measure:()=>({width:100,height:40})}).entries
    .map(e=>[e.cue.text,e.x,e.y,e.style.fontSize,e.group.trackId]).sort((a,b)=>a[0].localeCompare(b[0]));
  for(const order of ['secondary-above','main-above']){
    main.style={...main.style,mode:'snapshot',value:S.defaults()};main.style.value.pairLayout={order,gap:-12};
    secondary.style={...secondary.style,mode:'snapshot',value:S.defaults()};
    const expected=positions(native),byText=new Map(expected.map(e=>[e[0],e]));
    assert.equal(byText.get('Translation')[2]<byText.get('Source')[2],order==='secondary-above');
    for(const reverse of [false,true])for(const right of [source.id,translation.id]){
      const p=structuredClone(native),link=p.subtitles.bindings[0];
      if(reverse){[link.source_id,link.target_id]=[link.target_id,link.source_id];link.start_offset_ms*=-1;link.end_offset_ms*=-1;}
      p.subtitle_view={secondary_cue_ids:[right]};const before=JSON.stringify(p);
      assert.deepEqual(positions(p),expected);
      assert.equal(JSON.stringify(p),before,'rendering never changes bindings or timing');
    }
  }
});
const cue=(id,start,end,height=40)=>({id,start,end,text:id,items:[],height});
const project=(main,extra={})=>core.migrate({segments:main,...extra});
const measure=row=>({width:300,height:row.cue.height});
const layout=p=>P.layout(p,{measure});
const entry=(l,id)=>l.entries.find(e=>e.cue_id===id);

test('native individual anchors move one selected row without repacking its bound partner',()=>{
  const native=flat.migrate({segments:[cue('a',0,2000)],multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[cue('b',0,2000)]}],bindings:[{track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]}});
  const p=production.fromProject(native),before=layout(p),a=before.entries[0],b=before.entries[1];
  const position=P.positionOf(a,1920);a.cue.subtitle_position={...position,x:position.x-.2,y:position.y-.3};
  const after=layout(p),moved=entry(after,a.cue_id),partner=entry(after,b.cue_id);
  assert.ok(Math.abs(moved.x-a.x+384)<.00001);assert.ok(Math.abs(moved.y-a.y+324)<.00001);
  assert.equal(partner.x,b.x);assert.equal(partner.y,b.y);
  const restored=production.fromProject(production.toProject(p));assert.deepEqual(restored.segments[0].subtitle_position,a.cue.subtitle_position);
  delete a.cue.subtitle_position;assert.equal(entry(layout(p),a.cue_id).y,a.y);
});

test('legacy presets derive pair spacing from the same settings displayed by the controls',()=>{
  const p=project([cue('a',0,2000)],{multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[cue('b',0,2000)]}],bindings:[{track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]}});
  const style=S.presets()[1];p.preview={project_style:style};
  const l=layout(p);assert.equal(entry(l,'b').y-entry(l,'a').y,40+S.pairSettings(style).gap);
});

test('only explicit bindings create bilingual display groups; opposite-role overlaps stay separate',()=>{
  const p=project([cue('a',0,2000)],{multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[cue('b',100,2100)]}],bindings:[]}});
  let l=layout(p);assert.equal(l.groups.length,2);assert.ok(entry(l,'b').y+40<=entry(l,'a').y-12);
  p.multi_subtitle.bindings=[{track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}];
  l=layout(p);assert.equal(l.groups.length,1);assert.equal(entry(l,'b').y-entry(l,'a').y,40);
});
test('a distant tall cue cannot reserve space; simultaneous tracks use local measured heights',()=>{
  const p=project([cue('base',0,2000),cue('over',1000,3000),cue('distant',10000,12000,400)]);
  const l=layout(p);assert.equal(entry(l,'base').y,944);assert.equal(entry(l,'over').y,892);
  p.segments.find(c=>c.id==='distant').height=800;assert.equal(entry(layout(p),'over').y,892);
});
test('dense continuous overlapping speech cannot accumulate vertical drift',()=>{
  const p=project(Array.from({length:2000},(_,i)=>cue(String(i),i*1000,i*1000+1500)));
  const l=layout(p);assert.equal(p.subtitle_tracks.tracks.length,2);
  assert.deepEqual([...new Set(l.entries.map(e=>e.y))].sort(),[892,944]);
});
test('bound pairs preserve negative spacing and order with unequal heights and shifted timing',()=>{
  const p=project([cue('a',0,2000,120)],{multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[cue('b',300,2300,40)]}],bindings:[{track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]}});
  const style=S.defaults();style.pairLayout={order:'secondary-above',gap:-20};p.preview={project_style:style};
  const l=layout(p);assert.equal(entry(l,'a').y-entry(l,'b').y,20);
  assert.ok(entry(l,'a').y+60>entry(l,'b').y+20);
  assert.equal(l.groups.length,1);assert.equal(l.groups[0].end,2300);
});
test('binding envelope gaps do not cause false avoidance',()=>{
  const p=project([cue('a',0,1000),cue('middle',2000,3000)],{multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:[cue('b',4000,5000)]}],bindings:[{track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b']}]}});
  const l=layout(p);assert.equal(entry(l,'middle').y,944);assert.equal(l.groups[0].lane,0);
});
test('annotations have independent positions, current pair overrides win, collisions remain local',()=>{
  const p=project([cue('a',0,2000),cue('b',0,2000)]);
  const t=p.subtitle_tracks.tracks[1];t.purpose='annotation';t.layout='fixed';t.position={x:.5,y:.88};
  let l=layout(p);assert.equal(entry(l,'a').y,944);assert.equal(entry(l,'b').y,.88*1080);
  assert.ok(P.warnings(l,1000).some(w=>w.type==='collision'));assert.deepEqual(P.warnings(l,2000),[]);
  p.segments[1].subtitle_position={x:.9,y:.01};l=layout(p);
  assert.equal(entry(l,'b').y,10.8);assert.deepEqual(P.warnings(l,1000),[]);
  p.segments[1].subtitle_position={x:1,y:1};assert.ok(P.warnings(layout(p),1000).some(w=>w.type==='outside'));
});
test('track style snapshots survive presets changing and proof overrides do not mutate the project',()=>{
  const p=project([cue('a',0,1000)]),t=p.subtitle_tracks.tracks[0];
  p.preview={project_style:S.defaults()};const own=S.defaults();own.main.fontSize=80;
  t.style={mode:'snapshot',value:own,selection:'large',custom:own};p.subtitle_tracks.presentation='fixed';
  const before=JSON.stringify(p);assert.equal(P.styleFor(p,t).main.fontSize,80);
  assert.equal(P.styleFor(p,t,S.defaults()).main.fontSize,48);assert.equal(JSON.stringify(p),before);assert.equal(core.validate(p),true);
  t.style={mode:'inherit',custom:own};assert.equal(P.styleFor(p,t).main.fontSize,48);
});
for(const bad of [null,{x:-.1,y:0},{x:1.1,y:0},{x:true,y:0},{x:0,y:NaN},{x:0,y:0,z:0}])test(`position validation rejects ${JSON.stringify(bad)}`,()=>{
  const p=project([cue('a',0,1000)]);p.segments[0].subtitle_position=bad;assert.throws(()=>core.validate(p),/位置/);
});
test('locked track style and position changes fail without blocking unlock',()=>{
  const p=project([cue('a',0,1000)]);p.subtitle_tracks.tracks[0].locked=true;
  const next=structuredClone(p);next.subtitle_tracks.tracks[0].position={x:.5,y:.1};assert.throws(()=>core.assertLocks(p,next),/锁定/);
  delete next.subtitle_tracks.tracks[0].position;next.subtitle_tracks.tracks[0].locked=false;core.assertLocks(p,next);
});

test('purpose never changes layout or style; fixed placement works for any purpose',()=>{
  const p=project([cue('a',0,2000),cue('b',0,2000)]),t=p.subtitle_tracks.tracks[1];
  p.preview={project_style:S.defaults()};p.preview.project_style.annotation=S.defaults();p.preview.project_style.annotation.main.fontSize=99;
  const before=layout(p),style=P.styleFor(p,t);
  for(const purpose of ['none','dialogue','source','translation','annotation']) {
    t.purpose=purpose;assert.deepEqual(layout(p).entries.map(e=>[e.x,e.y]),before.entries.map(e=>[e.x,e.y]));assert.deepEqual(P.styleFor(p,t),style);
  }
  t.layout='fixed';t.position={x:.3,y:.2};assert.equal(entry(layout(p),'b').y,216);
  t.layout='auto';assert.equal(entry(layout(p),'b').y,entry(before,'b').y);assert.deepEqual(t.position,{x:.3,y:.2});
  t.layout='fixed';assert.equal(entry(layout(p),'b').y,216);assert.deepEqual(P.styleFor(p,t),style);
});

test('v1 migration preserves annotation appearance, names, anchors, cue overrides and bindings',()=>{
  const p=project([cue('a',0,2000),cue('b',0,2000)]);
  p.subtitle_tracks.schema=core.LEGACY_TRACK_SCHEMA;
  for(const t of p.subtitle_tracks.tracks){delete t.purpose;delete t.layout;delete t.style_base;}
  p.subtitle_tracks.tracks[1].kind='annotation';p.subtitle_tracks.tracks[1].position={x:.3,y:.2};
  p.preview={project_style:S.defaults()};p.preview.project_style.annotation=S.defaults();p.preview.project_style.annotation.main.fontSize=99;
  const original=structuredClone(p),before=layout(p),next=core.migrate(p);
  assert.equal(JSON.stringify(p),JSON.stringify(original));assert.equal(next.subtitle_tracks.schema,core.TRACK_SCHEMA);
  assert.deepEqual(layout(next).entries.map(e=>[e.x,e.y,e.style]),before.entries.map(e=>[e.x,e.y,e.style]));
  assert.deepEqual(next.segments,p.segments);assert.deepEqual(next.subtitle_tracks.assignments,p.subtitle_tracks.assignments);
  assert.deepEqual(core.migrate(next),next);
});
