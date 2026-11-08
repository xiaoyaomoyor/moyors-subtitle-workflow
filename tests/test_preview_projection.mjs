import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from '../web/msw-production-project.js';
import {createFixture} from '../scripts/performance/fixtures.mjs';

test('a fixed film-length annotation does not expand a 10,000-cue preview',()=>{
  const project=createFixture('long-note',10000).project,view=bridge.fromProject(project);
  const before=JSON.stringify(view);
  for(const start of [0,90000,3600000,7100000]) {
    const range={start,end:start+90000},preview=bridge.toProject(view,{previewWindow:range});
    assert.ok(preview.subtitles.cues.length<150);
    const ids=new Set(preview.subtitles.cues.map(c=>c.id));
    for(const c of project.subtitles.cues)if(c.content.start<range.end&&c.content.end>range.start)assert.ok(ids.has(c.id));
    for(const b of preview.subtitles.bindings)assert.ok(ids.has(b.source_id)&&ids.has(b.target_id));
  }
  assert.equal(JSON.stringify(view),before);
});

test('anchored rows keep original packing dependencies unless their group has a fixed base',()=>{
  const p=createFixture('bound',100).project;
  p.subtitles.cues.push({id:'long',track_id:'s2',content:{start:0,end:7200000,text:'Anchored',subtitle_position:{alignment:8,x:.5,y:.1}}});
  const project=()=>bridge.toProject(bridge.fromProject(p),{previewWindow:{start:0,end:10000}});
  assert.equal(project().subtitles.cues.length,101,'individual anchors still reserve the original automatic lane');
  p.subtitles.cues.at(-1).content.subtitle_position.base={x:.5,y:.1};
  assert.equal(project().subtitles.cues.length,3,'an explicit fixed group does not reserve automatic lanes');
  delete p.subtitles.cues.at(-1).content.subtitle_position;
  p.subtitles.cues.at(-1).content.disabled=true;
  assert.equal(project().subtitles.cues.length,3,'disabled long rows do not bridge automatic groups');
});
