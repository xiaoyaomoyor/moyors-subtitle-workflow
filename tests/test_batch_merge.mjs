import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import bridge from '../web/msw-production-project.js';
const context={window:{},TextDecoder,TextEncoder,Uint8Array};
for(const name of ['gap-remove-core.js','editor-utils.js'])vm.runInNewContext(readFileSync(new URL('../web/'+name,import.meta.url),'utf8'),context);
const utils=context.window.AsrEditorUtils;
const fixture=()=>{
 const p=core.migrate({segments:[
  {id:'a',start:0,end:1000,text:'a longer subtitle',items:[{start:100,end:900,text:'a longer subtitle'}]},
  {id:'b',start:1100,end:1500,text:'yes',items:[]},
  {id:'c',start:3000,end:4000,text:'another longer subtitle',items:[]},
  {id:'d',start:4100,end:4500,text:'ok',items:[]}],split_mode:'word'});
 const target=p.subtitles.tracks[0];target.split_mode='word';
 p.subtitles.tracks.push({...structuredClone(target),id:'other',style:{...target.style,slot:'secondary'}});
 const source=[...p.subtitles.cues];
 for(const [i,c] of source.entries()){
  p.subtitles.cues.push({id:'partner'+i,track_id:'other',content:{start:c.content.start+50,end:c.content.end+50,text:'对应'+i,items:[]}});
  p.subtitles.bindings.push({id:'bind'+i,source_id:c.id,target_id:'partner'+i,start_offset_ms:50,end_offset_ms:50});
 }
 return bridge.toProject(bridge.fromProject(p));
};
const run=(p,patch={},ids=null)=>edit.batchMerge(p,p.subtitles.tracks[0].id,ids,{gapMs:200,shortCount:3,utils,...patch});
const text=p=>p.subtitles.cues.filter(c=>c.track_id===p.subtitles.tracks[0].id).sort((a,b)=>a.content.start-b.content.start).map(c=>c.content.text);

test('batch parameters affect only nearby groups and preserve paired offsets and input',()=>{
 const p=fixture(),original=JSON.stringify(p),result=run(p);
 assert.deepEqual(result.stats,{scope:4,skipped:0,snaps:2,groups:2,merged:4,affected:4,linked:4});
 assert.deepEqual(text(result.project),['a longer subtitle yes','another longer subtitle ok']);
 assert.equal(result.project.subtitles.bindings.length,2);
 assert.ok(result.project.subtitles.bindings.every(b=>b.start_offset_ms===50&&b.end_offset_ms===50));
 assert.equal(JSON.stringify(p),original);core.validate(result.project);
 const again=run(result.project);assert.equal(again.stats.groups,0);assert.equal(again.stats.snaps,0);
});

test('selected scope does not cross an unselected cue, or expand an empty selection',()=>{
 const p=fixture(),ids=p.subtitles.cues.filter(c=>c.track_id===p.subtitles.tracks[0].id).map(c=>c.id);
 assert.deepEqual(run(p,{},[]).project,p);
 assert.equal(run(p,{},[ids[0],ids[2],ids[3]]).stats.groups,1);
 const result=run(p,{},ids.slice(0,2));assert.equal(result.stats.groups,1);
 for(const id of [ids[2],ids[3],'partner2','partner3'])assert.deepEqual(edit.cue(result.project,id),edit.cue(p,id));
});

test('gap direction, disabling merges and disabling snaps are independent',()=>{
 const p=fixture(),[a,b]=p.subtitles.cues;
 const back=run(p,{absorbShort:false}).project;
 assert.equal(edit.cue(back,b.id).content.start,1000);assert.equal(edit.cue(back,'partner1').content.start,1050);
 assert.deepEqual(edit.cue(back,a.id).content.items,a.content.items);
 const forward=run(p,{absorbShort:false,snapDirection:'forward'}).project;
 assert.equal(edit.cue(forward,a.id).content.end,1100);assert.equal(edit.cue(forward,'partner0').content.end,1150);
 assert.equal(run(p,{snapGaps:false}).stats.snaps,0);assert.equal(run(p,{snapGaps:false}).stats.groups,2);
 assert.deepEqual(run(p,{gapMs:0}).project,p);
});

test('counting follows physical track mode and merges do not cross speakers or disabled partners',()=>{
 const p=fixture();p.subtitles.tracks[0].split_mode='continuous';
 assert.equal(run(p).stats.groups,1); // "yes" is three letters, "ok" is two.
 p.subtitles.tracks[0].split_mode='word';edit.cue(p,'partner1').content.disabled=true;
 p.subtitles.cues[3].content.speaker='other speaker';
 const result=run(p);assert.equal(result.stats.skipped,1);assert.equal(result.stats.groups,0);
 assert.equal(result.stats.snaps,1);
});

test('locked partners and final collisions reject atomically instead of partially applying',()=>{
 const p=fixture(),before=JSON.stringify(p);p.subtitles.tracks[1].locked=true;
 assert.throws(()=>run(p),/锁定/);p.subtitles.tracks[1].locked=false;assert.equal(JSON.stringify(p),before);
 const neighbor={id:'obstacle',track_id:'other',content:{start:1060,end:1090,text:'obstacle',items:[]}};
 p.subtitles.cues.push(neighbor);core.validate(p);
 const blocked=JSON.stringify(p);assert.throws(()=>run(p),/重叠/);assert.equal(JSON.stringify(p),blocked);
});

test('union/common states and swapped display keep direction, positions and unrelated assets',()=>{
 let p=fixture();p=bridge.swapColumns(bridge.fromProject(p));const first=p.subtitles.cues[0];
 first.content.color={name:'red',start:first.content.start,end:first.content.end};
 first.content.subtitle_position={x:.2,y:.7,alignment:2};p.asset_note={path:'unchanged'};
 const merged=run(p).project,c=merged.subtitles.cues.find(c=>c.track_id===first.track_id&&c.content.start===0);
 assert.equal(c.content.color.name,'red');assert.deepEqual(c.content.subtitle_position,first.content.subtitle_position);
 assert.ok(merged.subtitle_view.secondary_cue_ids.includes(c.id));assert.deepEqual(merged.asset_note,p.asset_note);
 for(const b of merged.subtitles.bindings)assert.equal(edit.cue(merged,b.source_id).track_id,first.track_id);
 const common=run(p,{mode:'common'}).project;
 assert.equal(common.subtitles.cues.find(c=>c.track_id===first.track_id&&c.content.start===0).content.color,undefined);
});

test('overlapping short-run plans coalesce and survive JSON/frame roundtrips',()=>{
 const p=fixture();p.subtitles.bindings=[];p.subtitles.cues=p.subtitles.cues.filter(c=>c.track_id!== 'other');
 p.subtitles.cues.forEach((c,i)=>{c.content.start=i*1000;c.content.end=i*1000+1000;c.content.items=[];c.content.text=i%2?'long enough text':'ok';});
 p.timebase={unit:'frames',fps:25};p.subtitles.cues.forEach(c=>edit.frame(p,c.content));
 const result=run(p,{absorbDirection:'next',gapMs:0});assert.ok(result.stats.groups>0);
 core.validate(JSON.parse(JSON.stringify(result.project)));
 const history=new edit.History(p);history.commit(result.project,'batch');history.step('undo');assert.deepEqual(history.project,p);
});

test('a run consisting entirely of short subtitles still merges without an outside neighbour',()=>{
 const p=fixture();p.subtitles.cues.forEach(c=>c.content.text='x');
 assert.equal(run(p).stats.groups,2);
 assert.equal(run(p,{absorbDirection:'next'}).stats.groups,2);
});

test('a temporary linked overlap is allowed only when the same batch merges it away',()=>{
 const p=fixture();edit.cue(p,'partner0').content.end=1120;p.subtitles.bindings[0].end_offset_ms=120;
 assert.throws(()=>run(p,{absorbShort:false}),/重叠/);
 const result=run(p);assert.equal(result.stats.groups,2);core.validate(result.project);
});
