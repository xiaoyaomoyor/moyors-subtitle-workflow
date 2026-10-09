import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../web/msw-subtitle-tracks.js';
import P from '../web/msw-track-presentation.js';
const context={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js','msw-project-style.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
globalThis.MSWProjectStyle=context.window.MSWProjectStyle;
const S=globalThis.MSWProjectStyle;
const cue=(id,start,end,height=40)=>({id,start,end,text:id,items:[],height});
const project=(main,extra={})=>core.migrate({segments:main,...extra});
const measure=row=>({width:300,height:row.cue.height});
const layout=p=>P.layout(p,{measure});
const entry=(l,id)=>l.entries.find(e=>e.cue_id===id);

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
  const t=p.subtitle_tracks.tracks[1];t.kind='annotation';t.position={x:.5,y:.88};
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
