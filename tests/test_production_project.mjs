import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),flat=require('../web/msw-flat-subtitles.js'),bridge=require('../web/msw-production-project.js'),legacy=require('../web/msw-subtitle-tracks.js');
const fixture=()=>flat.migrate({segments:[{id:'a',start:0,end:2000,text:'Hello',items:[]}],multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:100,end:2100,text:'你好',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:100,end_offset_ms:100}]}});
const comparable=p=>{const n=flat.normalizeGroups(structuredClone(p),{infer:true});delete n.subtitle_view;n.subtitles.cues.sort((a,b)=>a.id.localeCompare(b.id));return n;};

test('subtitle import explicitly replaces its owner or creates an independent track; binding is optional',()=>{
  globalThis.MSWProject={id:prefix=>prefix+'-'+crypto.randomUUID()};require('../web/msw-flat-editing.js');
  const p=fixture(),view=bridge.fromProject(p),owner=p.subtitles.tracks[1].id;
  const cues=[{start:4000,end:5000,text:'Imported'}];
  const fresh=bridge.importSubtitles(view,cues,owner,'File');
  assert.equal(fresh.project.subtitles.tracks.length,p.subtitles.tracks.length+1);
  assert.equal(fresh.bound,0);assert.equal(fresh.project.subtitles.bindings.length,1);
  assert.ok(!fresh.project.subtitle_view.secondary_cue_ids.includes(fresh.ids[0]));
  const replaced=bridge.importSubtitles(view,cues,owner,'File',{replace:true});
  assert.equal(replaced.project.subtitles.cues.find(c=>c.id===replaced.ids[0]).track_id,owner);
  assert.equal(replaced.project.subtitles.bindings.length,0);
  assert.deepEqual(replaced.project.subtitles.cues.find(c=>c.track_id!==owner),p.subtitles.cues.find(c=>c.track_id!==owner));
  const locked=structuredClone(view);locked.subtitle_tracks.tracks.find(t=>t.id===owner).locked=true;
  assert.throws(()=>bridge.importSubtitles(locked,cues,owner,'File',{replace:true}),/锁定/);
  assert.equal(bridge.importSubtitles(locked,cues,null,'File').ids.length,1);
  assert.deepEqual(bridge.toProject(view).subtitles.cues,p.subtitles.cues);
});

test('export scope uses physical tracks without changing bindings, display columns or the source',()=>{
  const p=fixture(),view=bridge.fromProject(p),id=p.subtitles.tracks[1].id;
  const result=bridge.exportScope(view,[id]);
  assert.deepEqual(result.subtitles.tracks.map(t=>t.enabled),[false,true]);
  assert.deepEqual(result.subtitles.cues,p.subtitles.cues);assert.deepEqual(result.subtitles.bindings,p.subtitles.bindings);
  assert.deepEqual(comparable(bridge.exportScope(bridge.fromProject(bridge.swapColumns(view)),[id])),comparable(result));
  assert.ok(bridge.exportScope(view,[]).subtitles.tracks.every(t=>!t.enabled));
  view.subtitle_tracks.tracks[1].enabled=false;
  assert.ok(bridge.exportScope(view,[id]).subtitles.tracks.every(t=>!t.enabled));
  assert.equal(p.subtitles.tracks[1].enabled,true);
});
test('display side swaps preserve direction, offsets, track split modes and repeated roundtrips',()=>{
  const p=fixture();p.subtitles.tracks[0].split_mode='word';p.subtitles.tracks[1].split_mode='continuous';
  const view=bridge.fromProject(p),next=bridge.swapColumns(view),swapped=bridge.fromProject(next);
  assert.equal(swapped.segments[0].id,view.multi_subtitle.tracks[0].segments[0].id);
  assert.deepEqual(comparable(next),comparable(p));
  assert.deepEqual(comparable(bridge.toProject(swapped)),comparable(next));
  assert.deepEqual(bridge.toProject(swapped).subtitle_view,next.subtitle_view);
  const back=bridge.fromProject(bridge.swapColumns(swapped));assert.equal(back.segments[0].id,view.segments[0].id);
  assert.deepEqual(comparable(bridge.toProject(back)),comparable(p));
});
test('reversing reference direction keeps display sides and aligning respects it atomically',()=>{
  require('../web/msw-flat-editing.js');
  const view=bridge.fromProject(fixture()),p=bridge.toProject(view),b=p.subtitles.bindings[0];
  const reversed=bridge.reverseBindings(view,[b.source_id]),next=bridge.fromProject(reversed);
  assert.equal(next.segments[0].id,view.segments[0].id);
  assert.equal(reversed.subtitles.bindings[0].source_id,b.target_id);
  assert.deepEqual(bridge.toProject(next),reversed);
  const aligned=bridge.alignBindings(next,[b.source_id]);
  assert.deepEqual(aligned.subtitles.cues.map(c=>[c.content.start,c.content.end]),[[100,2100],[100,2100]]);
  const locked=structuredClone(p);locked.subtitles.tracks[1].locked=true;
  assert.throws(()=>bridge.reverseBindings(bridge.fromProject(locked),[b.source_id]),/锁定/);
  const occupied=structuredClone(p);occupied.subtitles.cues.push({id:'neighbor',track_id:p.subtitles.cues[1].track_id,content:{start:0,end:50,text:'other',items:[]}});
  assert.throws(()=>bridge.alignBindings(bridge.fromProject(occupied),[b.source_id]),/重叠/);
  assert.deepEqual(p,bridge.toProject(view));
});
test('legacy column split settings migrate to tracks and explicit automatic mode wins',()=>{
  const p=fixture();p.subtitle_view={main_split_mode:'continuous',secondary_split_mode:'word'};
  let view=bridge.fromProject(p);assert.deepEqual(view.subtitle_tracks.tracks.map(t=>t.split_mode),['continuous','word']);
  view.subtitle_tracks.tracks[0].split_mode='auto';
  const saved=bridge.toProject(view);assert.equal(bridge.fromProject(saved).subtitle_tracks.tracks[0].split_mode,'auto');
  for(const value of [null,{},'invalid']){const bad=structuredClone(saved);bad.subtitles.tracks[0].split_mode=value;assert.throws(()=>flat.validate(bad),/切分/);}
});

test('saved track preferences stop old column defaults from being reapplied on restore or new tracks',()=>{
  const view=bridge.fromProject(fixture());
  // The legacy rendering helpers may populate these defaults at runtime.
  view.multi_subtitle.main_split_mode='word';view.multi_subtitle.tracks[0].split_mode='continuous';
  const saved=bridge.toProject(view);
  assert.equal(saved.subtitle_view.track_split_modes_migrated,true);
  assert.equal(saved.subtitle_view.main_split_mode,undefined);
  assert.deepEqual(bridge.toProject(bridge.fromProject(saved,{mainSplitModeOverride:'word'})),saved);
  const added=legacy.addTrack(view,'subtitle','new');
  const reopened=bridge.fromProject(bridge.toProject(added),{mainSplitModeOverride:'continuous'});
  assert.equal(reopened.subtitle_tracks.tracks.find(t=>t.id==='new').split_mode,undefined);
});
test('normal operation view roundtrips independent tracks, bilingual binding and unknown metadata',()=>{
  const p=fixture();p.subtitles.tracks[0].custom_data={hello:1};p.subtitles.cues[1].note='kept';
  const view=bridge.fromProject(p);assert.equal(view.segments.length,1);assert.equal(view.multi_subtitle.tracks[0].segments.length,1);
  assert.notEqual(view.subtitle_tracks.assignments[0].subtitle_track_id,view.subtitle_tracks.assignments[1].subtitle_track_id);
  assert.deepEqual(comparable(bridge.toProject(view)),comparable(p));
  const layout=legacy.layout(view,bridge.EXT,true);assert.equal(layout.count,2);
});
test('old component text and time edits serialize to v4 without legacy arrays',()=>{
  const view=bridge.fromProject(fixture());view.multi_subtitle.tracks[0].segments[0].text='编辑译文';
  const p=bridge.toProject(view);assert.equal(p.subtitles.cues.find(c=>c.content.text==='编辑译文').content.start,100);
  assert.equal(p.segments,undefined);assert.equal(p.multi_subtitle,undefined);flat.validate(p);
});
test('independent move retains binding, rejects same-track overlap and occupied partner track',()=>{
  let view=bridge.fromProject(fixture());view=legacy.addTrack(view,'subtitle','extra');
  const ref={role:'main',track_id:null,cue_id:view.segments[0].id};
  const moved=legacy.assign(view,[ref],'extra'),p=bridge.toProject(moved);
  assert.equal(p.subtitles.cues.find(c=>c.id===ref.cue_id).track_id,'extra');assert.deepEqual(p.subtitles.bindings,fixture().subtitles.bindings);
  assert.throws(()=>legacy.assign(view,[ref],fixture().subtitles.cues[1].track_id));
});

test('translation counts a selected bilingual pair once but accepts an unbound or singly selected right cue',()=>{
  const view=bridge.fromProject(fixture()),a=view.segments[0].id,b=view.multi_subtitle.tracks[0].segments[0].id;
  assert.deepEqual(bridge.translationIds(view,{mainIds:[a],extensionIds:[b]}),[a]);
  assert.deepEqual(bridge.translationIds(view,{mainIds:[],extensionIds:[b]}),[b]);
});

test('numbered groups preserve cue bindings, appearance and group numbers across ungroup, reorder and reopen',()=>{
  const p=bridge.toProject(bridge.fromProject(fixture())),[a,b]=p.subtitles.tracks;
  assert.deepEqual(p.subtitles.tracks.map(t=>t.name),['S1主','S1副']);
  let n=flat.setTrackGroup(p,a.id);assert.deepEqual(n.subtitles.tracks.map(t=>t.name),['S1','S2']);
  n=flat.addTrack(n,{...a,id:'extra'});
  n=flat.setTrackGroup(n,'extra',a.id);
  assert.deepEqual(n.subtitles.tracks.map(t=>t.name),['S1主','S2','S1副']);
  assert.deepEqual(n.subtitles.bindings,p.subtitles.bindings);assert.deepEqual(n.subtitles.cues,p.subtitles.cues);
  assert.deepEqual(n.subtitles.tracks.slice(0,2).map(t=>t.style),p.subtitles.tracks.map(t=>t.style));
  n.subtitles.tracks.reverse();n=bridge.toProject(bridge.fromProject(n));
  assert.deepEqual(n.subtitles.tracks.map(t=>t.name),['S1副','S2','S1主']);
  n=flat.setTrackGroup(n,'extra');
  assert.deepEqual(bridge.fromProject(n).subtitle_tracks.tracks.map(t=>t.name),['S3','S2','S1']);
  assert.deepEqual(n.subtitles.bindings,p.subtitles.bindings);
});
test('track groups reject cycles, multiple secondary tracks and locked members atomically',()=>{
  const p=bridge.toProject(bridge.fromProject(fixture())),[a,b]=p.subtitles.tracks;
  const n=flat.addTrack(p,{...a,id:'extra'}),before=structuredClone(n);
  assert.throws(()=>flat.setTrackGroup(n,'extra',a.id));assert.throws(()=>flat.setTrackGroup(n,'extra',b.id));
  n.subtitles.tracks[0].locked=true;assert.throws(()=>flat.setTrackGroup(n,b.id));
  n.subtitles.tracks[0].locked=false;assert.deepEqual(n,before);
  for(const corrupt of [p=>{delete p.subtitles.tracks[1].secondary_for;p.subtitles.tracks[1].display_number=1;},p=>p.subtitles.tracks[0].secondary_for=b.id,p=>p.subtitles.tracks[1].secondary_for='missing']) {
    const bad=structuredClone(p);corrupt(bad);assert.throws(()=>flat.validate(bad));
  }
});
test('numbered empty track deletion restores its grouped partner and does not recycle numbers',()=>{
  const E=require('../web/msw-flat-editing.js');
  let p=bridge.toProject(bridge.fromProject({segments:[]})),a=p.subtitles.tracks[0];
  p=flat.addTrack(p,{...a,id:'extra'});p=flat.setTrackGroup(p,'extra',a.id);
  p=E.deleteTrack(p,a.id);assert.equal(p.subtitles.tracks[0].name,'S1');
  p=flat.addTrack(p,{...p.subtitles.tracks[0],id:'third'});assert.equal(p.subtitles.tracks[1].name,'S2');
});
test('explicit groups without display numbers take precedence over migration inference',()=>{
  let p=fixture(),[a,b]=p.subtitles.tracks;
  p=flat.addTrack(p,{...a,id:'extra'});p.subtitles.tracks[2].secondary_for=a.id;
  const n=bridge.toProject(bridge.fromProject(p));
  assert.deepEqual(n.subtitles.tracks.map(t=>t.name),['S1主','S2','S1副']);
  assert.deepEqual(n.subtitles.bindings,p.subtitles.bindings);
});

test('a bilingual group consumes one number; ungroup allocates after existing groups',()=>{
  let p=bridge.toProject(bridge.fromProject(fixture()));
  const [main,secondary]=p.subtitles.tracks;
  assert.deepEqual(p.subtitles.tracks.map(t=>t.display_number),[1,1]);
  assert.equal(p.subtitles.next_track_number,2);
  const old=structuredClone(p);old.subtitles.tracks[1].display_number=2;old.subtitles.next_track_number=3;
  flat.validate(old);assert.deepEqual(flat.normalizeGroups(old),p);
  p=flat.addTrack(p,{...main,id:'extra'});
  assert.deepEqual(p.subtitles.tracks.map(t=>t.name),['S1主','S1副','S2']);
  p=flat.setTrackGroup(p,secondary.id);
  assert.deepEqual(p.subtitles.tracks.map(t=>t.name),['S1','S3','S2']);
  assert.deepEqual(bridge.toProject(bridge.fromProject(p)),p);
  assert.deepEqual(p.subtitles.cues,old.subtitles.cues);assert.deepEqual(p.subtitles.bindings,old.subtitles.bindings);
});
