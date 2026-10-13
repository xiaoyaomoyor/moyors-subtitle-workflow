import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),flat=require('../web/msw-flat-subtitles.js'),bridge=require('../web/msw-production-project.js'),legacy=require('../web/msw-subtitle-tracks.js');
const fixture=()=>flat.migrate({segments:[{id:'a',start:0,end:2000,text:'Hello',items:[]}],multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:100,end:2100,text:'你好',items:[]}]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:100,end_offset_ms:100}]}});
const comparable=p=>{const n=structuredClone(p);delete n.subtitle_view;n.subtitles.cues.sort((a,b)=>a.id.localeCompare(b.id));return n;};
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
