import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const views=require('../web/tools/project-tracks.js');
const flat=require('../web/msw-flat-subtitles.js');
const old=require('../web/msw-subtitle-tracks.js');
const layers=require('../web/msw-subtitle-layers.js');

test('comparison reads v1/v2/v3/v4 without editing the project or merging tracks',()=>{
  const legacy={segments:[{id:'a',start:0,end:1000,text:'A'}],overlay_track:{enabled:true,segments:[{id:'b',start:0,end:1000,text:'B'}]}};
  for(const p of [legacy,layers.migrate(legacy),old.migrate(legacy),flat.migrate(legacy)]){
    const before=JSON.stringify(p), tracks=views.tracks(p);
    assert.equal(tracks.length,2);
    assert.deepEqual(tracks.map(t=>t.segments.map(c=>c.text)),[['A'],['B']]);
    assert.equal(JSON.stringify(p),before);
    assert.throws(()=>views.view(p,'stale'),/不存在/);
  }
});

test('diagnostic reader rejects ambiguous identities and future schemas',()=>{
  assert.throws(()=>views.tracks({schema:'msw.project.v99',segments:[]}),/版本/);
  const p=flat.migrate({segments:[{start:0,end:1000,text:'A'}]});
  p.subtitles.cues.push(structuredClone(p.subtitles.cues[0]));
  assert.throws(()=>views.tracks(p),/ID/);
  p.subtitles.cues.pop();p.subtitles.cues[0].track_id='missing';
  assert.throws(()=>views.tracks(p),/归属/);
});

test('timecode IDs survive reordered arrays and missing cues; unrelated inputs use explicit index fallback',()=>{
  const a={nativeTrack:true,segments:[{id:'a',start:0},{id:'b',start:20}]};
  const b={nativeTrack:true,segments:[{id:'b',start:22},{id:'c',start:10}]};
  const pairs=views.pairSegments([a,b]);
  assert.equal(pairs.mode,'id');
  assert.deepEqual(pairs.cells.map(row=>row.map(c=>c?.id||null)),[['a',null],[null,'c'],['b','b']]);
  assert.equal(views.pairSegments([a,{segments:[{start:0}]}]).mode,'index');
  assert.deepEqual(views.pairSegments([]).cells,[]);
});
