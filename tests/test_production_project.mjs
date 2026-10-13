import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),flat=require('../web/msw-flat-subtitles.js'),bridge=require('../web/msw-production-project.js'),legacy=require('../web/msw-subtitle-tracks.js');
const fixture=()=>flat.migrate({segments:[{id:'a',start:0,end:2000,text:'Hello',items:[]}],multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:100,end:2100,text:'你好',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:100,end_offset_ms:100}]}});
const comparable=p=>{const n=flat.normalizeGroups(structuredClone(p),{infer:true});delete n.subtitle_view;n.subtitles.cues.sort((a,b)=>a.id.localeCompare(b.id));return n;};
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
