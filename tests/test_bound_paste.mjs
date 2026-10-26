import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),core=require('../web/msw-flat-subtitles.js'),bridge=require('../web/msw-production-project.js');
require('../web/msw-flat-editing.js');
globalThis.MSWProject={id:prefix=>prefix+'-'+crypto.randomUUID()};
function fixture({reverse=false,swap=false,frames=false}={}) {
  const p=core.migrate({segments:[{id:'a',start:1000,end:2000,text:'Hello',items:[{text:'Hello',start:1010,end:1990}],disabled:true,
    color:{name:'green',value:'#00ff00',start:1000,end:2000},subtitle_style:{fontSize:54}}],
    multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1200,end:2400,text:'你好',items:[]}]}],
      bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:400}]}});
  core.normalizeGroups(p,{infer:true});
  p.subtitles.tracks.push({...structuredClone(p.subtitles.tracks[0]),id:'dest',display_number:2},
    {...structuredClone(p.subtitles.tracks[1]),id:'dest-sub',secondary_for:'dest',display_number:2});
  p.subtitles.next_track_number=3;
  if(reverse){const b=p.subtitles.bindings[0];[b.source_id,b.target_id]=[b.target_id,b.source_id];b.start_offset_ms*=-1;b.end_offset_ms*=-1;}
  if(frames)p.timebase={unit:'frames',fps:25};
  const view=bridge.fromProject(p);return swap?bridge.fromProject(bridge.swapColumns(view)):view;
}
const all=view=>view.subtitle_tracks.assignments.map(a=>a.cue_id);
const copy=(v,ids=all(v))=>bridge.captureClipboard(v,ids);
const paste=(v,c,at=6000,target='dest')=>bridge.place(v,c.rows,c.bindings,at,target,{...c,canonical:true});
const ordered=p=>{const q=structuredClone(p);q.subtitles.cues.sort((a,b)=>a.id.localeCompare(b.id));q.subtitle_view.secondary_cue_ids.sort();return q;};
for(const reverse of [false,true])for(const swap of [false,true])test(`pair paste maps both roles and preserves reference direction (reverse ${reverse}, swap ${swap})`,()=>{
  const v=fixture({reverse,swap,frames:true}),saved=JSON.stringify(v),c=copy(v);
  for(const target of ['dest','dest-sub']) {
    const result=paste(v,c,6000,target),p=result.project,inserted=p.subtitles.cues.filter(r=>result.ids.includes(r.id));
    assert.equal(p.subtitles.tracks.length,4);
    for(const row of inserted){const original=c.rows.find(r=>r.content.text===row.content.text);
      assert.equal(row.track_id,original.track_id===c.tracks[0].id?'dest':'dest-sub');
      assert.equal(row.content.start,original.content.start+5000);assert.equal(row.content.end,original.content.end+5000);
      assert.equal(row.content.start_frame,Math.round(row.content.start/40));
      assert.equal(row.content.items.length,original.content.items.length);
      if(row.content.items.length)assert.deepEqual(row.content.items[0],{text:'Hello',start:6010,end:6990,start_frame:150,end_frame:175});
      assert.deepEqual(row.content.subtitle_style,original.content.subtitle_style);assert.equal(row.content.disabled,original.content.disabled);
    }
    const link=p.subtitles.bindings.at(-1);assert.equal(link.start_offset_ms,c.bindings[0].start_offset_ms);assert.equal(link.end_offset_ms,c.bindings[0].end_offset_ms);
    assert.equal(inserted.find(r=>r.id===link.source_id).content.text,c.rows.find(r=>r.id===c.bindings[0].source_id).content.text);
    core.validate(p);assert.deepEqual(ordered(bridge.toProject(bridge.fromProject(p))),ordered(p));
  }
  assert.equal(JSON.stringify(v),saved);
});
test('copy reads only selected content, permits locked sources and does not clone waveform or audio',()=>{
  const v=fixture();v.subtitle_tracks.tracks[0].locked=true;
  Object.defineProperty(v,'waveform',{get(){throw Error('waveform must not be read');}});
  Object.defineProperty(v,'msw',{get(){throw Error('audio must not be read');}});
  const c=copy(v,[v.segments[0].id]);assert.equal(c.rows.length,1);assert.equal(c.bindings.length,0);
  assert.equal(bridge.captureClipboard(v,[]),null);
});
test('half-pair copy pastes independently onto the exact target lane and never binds to the original',()=>{
  const v=fixture(),c=copy(v,[v.multi_subtitle.tracks[0].segments[0].id]),before=bridge.toProject(v);
  const {project:p,ids}=paste(v,c,6000,'dest');
  assert.deepEqual(p.subtitles.bindings,before.subtitles.bindings);assert.equal(p.subtitles.cues.find(r=>r.id===ids[0]).track_id,'dest');
  assert.equal(p.subtitles.cues.find(r=>r.id===ids[0]).content.start,6000);
});
test('clipboard survives deletion of source cues and source tracks; repeated paste uses disjoint IDs',()=>{
  const v=fixture(),c=copy(v),p=bridge.toProject(v);
  p.subtitles.cues=[];p.subtitles.bindings=[];p.subtitles.tracks=p.subtitles.tracks.slice(2);
  const once=paste(bridge.fromProject(p),c),twice=paste(bridge.fromProject(once.project),c,10000);
  assert.equal(twice.project.subtitles.cues.length,4);assert.equal(new Set([...once.ids,...twice.ids]).size,4);
  assert.notEqual(once.project.subtitles.bindings[0].id,twice.project.subtitles.bindings[1].id);
  core.validate(twice.project);
});
test('external markers materialize; internal color/sticker references target fresh IDs even across display columns',()=>{
  const p=bridge.toProject(fixture()),head=p.subtitles.cues[0],tail=p.subtitles.cues[1];
  head.content.sticker={name:'star',start:1000,end:2400};
  for(const field of ['color','sticker'])tail.content[field+'_ref']={cue_id:head.id};
  let v=bridge.fromProject(p),c=copy(v),r=paste(v,c);
  const h=r.project.subtitles.cues.find(row=>row.id===r.ids[0]);
  const t=r.project.subtitles.cues.find(row=>row.id===r.ids[1]);
  assert.equal(h.content.text,'Hello');
  for(const field of ['color','sticker']){assert.equal(t.content[field+'_ref'].cue_id,h.id);assert.equal(h.content[field].start,6000);assert.equal(h.content[field].end,7400);}
  c=copy(v,[tail.id]);
  p.subtitles.cues=[];p.subtitles.bindings=[];v=bridge.fromProject(p);r=paste(v,c);
  const single=r.project.subtitles.cues[0];
  for(const field of ['color','sticker']){assert.equal(single.content[field+'_ref'],undefined);assert.equal(single.content[field].name,head.content[field].name);assert.equal(single.content[field].end,7200);}
});
test('same-column references reindex correctly after inserting before their original head',()=>{
  const p=bridge.toProject(fixture()),head=p.subtitles.cues[0];
  p.subtitles.cues.push({id:'tail',track_id:head.track_id,content:{text:'Tail',start:2500,end:2900,color_ref:{cue_id:head.id},items:[]}});
  const v=bridge.fromProject(p),c=copy(v,[head.id,'tail']),r=paste(v,c,0,'dest');
  const tail=r.project.subtitles.cues.find(row=>row.id===r.ids[1]);assert.equal(tail.content.color_ref.cue_id,r.ids[0]);
  assert.deepEqual(ordered(bridge.toProject(bridge.fromProject(r.project))),ordered(r.project));
});
test('inserting before marker heads does not look like editing another locked track',()=>{
  const p=bridge.toProject(fixture()),head=p.subtitles.cues[0];
  p.subtitles.tracks[0].locked=true;
  p.subtitles.cues.push({id:'tail',track_id:head.track_id,content:{text:'Tail',start:2500,end:2900,color_ref:{cue_id:head.id},items:[]}});
  const v=bridge.fromProject(p),c=copy(v,[head.id]),r=paste(v,c,0,'dest');
  const next=bridge.fromProject(r.project),legacy=require('../web/msw-subtitle-tracks.js');
  assert.notEqual(v.segments.find(c=>c.id==='tail').color_ref.headIdx,next.segments.find(c=>c.id==='tail').color_ref.headIdx);
  assert.doesNotThrow(()=>legacy.assertLocks(v,next));
  next.segments.find(c=>c.id==='tail').color_ref.headIdx=0;
  assert.throws(()=>legacy.assertLocks(v,next),/锁定/);
});
test('missing, locked, occupied and insufficient destinations reject atomically',()=>{
  const v=fixture(),c=copy(v),before=JSON.stringify(v);
  assert.throws(()=>paste(v,c,1000,v.subtitle_tracks.tracks[0].id),/S1主.*已有字幕/);assert.equal(JSON.stringify(v),before);
  v.subtitle_tracks.tracks[3].locked=true;assert.throws(()=>paste(v,c),/锁定/);
  v.subtitle_tracks.tracks.pop();assert.throws(()=>paste(v,c),/副轨道/);
  assert.throws(()=>paste(v,c,6000,'missing'),/有效/);
  assert.throws(()=>paste(v,c,-1),/位置/);
});
test('independent physical tracks keep relative order including gaps, not the display column order',()=>{
  const p=bridge.toProject(fixture());p.subtitles.tracks.forEach(t=>{delete t.secondary_for;delete t.display_number;});
  delete p.subtitles.next_track_number;p.subtitles.bindings=[];
  const v=bridge.fromProject(p),c=copy(v),r=paste(v,c);
  assert.deepEqual(r.ids.map(id=>r.project.subtitles.cues.find(c=>c.id===id).track_id),['dest','dest-sub']);
  assert.throws(()=>paste(v,c,6000,'dest-sub'),/足够/);
});

for(const reverse of [false,true])for(const swap of [false,true])test(`local insertion matches canonical paste and reverses exactly (${reverse}/${swap})`,()=>{
  const p=bridge.toProject(fixture({reverse,swap,frames:true})),head=p.subtitles.cues.find(c=>c.content.text==='Hello');
  const peer=p.subtitles.cues.find(c=>c.id!==head.id);
  head.content.sticker={name:'star',start:1000,end:2400};
  peer.content.color_ref={cue_id:head.id};peer.content.sticker_ref={cue_id:head.id};
  p.subtitles.cues.push({id:'tail',track_id:head.track_id,content:{start:2500,end:2900,text:'Tail',items:[],color_ref:{cue_id:head.id}}});
  const v=bridge.fromProject(p),before=JSON.stringify(v),c=copy(v);
  const plan=bridge.preparePaste(v,c.rows,c.bindings,0,'dest',c),patch=bridge.insertionPatch(plan.project),saved=JSON.stringify(patch);
  const next=bridge.applyInsertion(v,patch,true),canonical=bridge.toProject(next),original=bridge.toProject(v);
  assert.deepEqual(canonical.subtitles.cues.filter(c=>!plan.ids.includes(c.id)),original.subtitles.cues);
  assert.deepEqual(canonical.subtitles.cues.filter(c=>plan.ids.includes(c.id)).sort((a,b)=>a.id.localeCompare(b.id)),
    plan.project.subtitles.cues.sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual(bridge.applyInsertion(next,patch,false),v);
  assert.deepEqual(bridge.applyInsertion(bridge.applyInsertion(next,patch,false),patch,true),next);
  assert.equal(JSON.stringify(v),before);assert.equal(JSON.stringify(patch),saved);
  assert.throws(()=>bridge.applyInsertion(next,patch,true),/不一致/);
  assert.throws(()=>bridge.applyInsertion(v,patch,false),/不一致/);
});

test('local insertion shares untouched content and keeps history proportional to the copied selection',()=>{
  const p=bridge.toProject(fixture()),track=p.subtitles.tracks[0].id;
  for(let i=0;i<6000;i++)p.subtitles.cues.push({id:'extra-'+i,track_id:track,content:{start:3000+i*2000,end:4000+i*2000,text:'Unchanged',items:[]}});
  const v=bridge.fromProject(p),c=copy(v,v.segments.slice(0,1).map(c=>c.id)),plan=bridge.preparePaste(v,c.rows,c.bindings,0,'dest',c);
  const patch=bridge.insertionPatch(plan.project),next=bridge.applyInsertion(v,patch,true);
  assert.ok(JSON.stringify(patch).length<4000);
  assert.equal(next.segments.find(c=>c.id==='extra-5999'),v.segments.find(c=>c.id==='extra-5999'));
  assert.deepEqual(bridge.applyInsertion(next,patch,false),v);
});
