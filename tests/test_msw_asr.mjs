import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={};const context=vm.createContext({window});
for(const name of ['msw-project.js','msw-asr-core.js'])vm.runInContext(readFileSync(new URL(`../web/${name}`,import.meta.url),'utf8'),context);
const core=window.MSWAsr,plain=value=>JSON.parse(JSON.stringify(value));
const cue=(id,start,end,text=id)=>({id,start,end,text});
function fixture(){
  const project={segments:[cue('before',0,500),cue('target',1000,2000),cue('after',3000,4000)],
    msw:{schema:'msw.editor.v1',project_id:'p'},
    multi_subtitle:{enabled:false,tracks:[{id:'ext',segments:[cue('translated',1000,2000),cue('outside',3000,4000)]}],
      bindings:[{id:'b',track_id:'ext',main_segment_ids:['target'],extension_segment_ids:['translated']}]}};
  const media={id:'media',revision:'a'.repeat(64),audio_index:0,metadata:{duration_ms:4000,audio_tracks:[{}]}};
  const snapshot=core.snapshot(project,media,'range',{start:1000,end:2000});
  const job={id:'job-1',project_id:'p',provider:'qwen',model:'fun-asr',status:'succeeded',snapshot,
    result:{segments:[cue('candidate',1100,1700)]}};
  return{project,media,job};
}
test('whole-source replacement preserves subtitles beyond the video and rejects crossing its end',()=>{
  const {project,media,job}=fixture();project.segments.push(cue('later',6000,7000));
  job.snapshot=core.snapshot(project,media,'whole');
  assert.equal(core.plan(project,media,job).segments.at(-1).id,'later');
  project.segments[2].end=5000;job.snapshot=core.snapshot(project,media,'whole');
  assert.throws(()=>core.plan(project,media,job),/切穿/);
});
test('clip snapshot uses sample duration and timeline origin, ignoring gain and mute changes',()=>{
  const {project}=fixture();project.segments=[];
  const asset={id:'a',sample_rate:44100,sample_count:441000,sha256:'a'.repeat(64),generation:{display_text:'audio'}};
  const clip={id:'c',asset_id:'a',start_ms:5000,source_in_sample:44100,source_out_sample:88200,playback_rate:1,gain_db:0,muted:false};
  project.msw.assets=[asset];project.msw.audio_clips=[clip];
  const [snapshot]=core.clipSnapshots(project,[clip]);
  assert.deepEqual(plain(snapshot.range),{start:5000,end:6000});
  clip.gain_db=-8;clip.muted=true;assert.equal(core.conflict(project,null,snapshot),'');
  clip.start_ms++;assert.match(core.conflict(project,null,snapshot),/贴片已/);
  assert.throws(()=>core.clipSnapshots(project,[]),/请先选择音频贴片/);
});
test('range application preserves outside cues, hidden secondary text and records review state without mutating input',()=>{
  const {project,media,job}=fixture(),before=JSON.stringify(project),plan=core.plan(project,media,job);
  assert.equal(JSON.stringify(project),before);assert.equal(plan.applied,true);
  assert.deepEqual(plain(plan.segments.filter(c=>!c.id.startsWith('asr-'))),[project.segments[0],project.segments[2]]);
  assert.deepEqual(plain(plan.multi.tracks),project.multi_subtitle.tracks);assert.equal(plan.multi.bindings.length,0);
  assert.deepEqual(plain(plan.msw.asr_stale_subtitles),{ext:{translated:'job-1'}});
  assert.doesNotThrow(()=>window.MSWProject.normalize(plan.msw));
  assert.equal(core.plan({...project,msw:plan.msw},media,job).duplicate,true);
});
for(const [name,change] of Object.entries({text:p=>p.segments[1].text='changed',time:p=>p.segments[1].start++,
  removed:p=>p.segments.splice(1,1),inserted:p=>p.segments.splice(1,0,cue('new',800,1200)),
  words:p=>p.segments[1].items=[cue('word',1000,1500)]}))test(`${name} edit inside target blocks replacement`,()=>{
  const {project,media,job}=fixture();change(project);assert.throws(()=>core.plan(project,media,job),/新增、删除/);
});
test('outside edits and volatile UI flags do not invalidate a target snapshot',()=>{
  const {project,media,job}=fixture();project.segments[0].text='outside edit';project.segments[1]._dirty=true;
  assert.equal(core.plan(project,media,job).segments[0].text,'outside edit');
});
test('empty candidates preserve existing cues; wrong source, overlap and out-of-range candidates are rejected',()=>{
  const {project,media,job}=fixture();job.result.segments=[];assert.equal(core.plan(project,media,job).empty,true);
  job.result.segments=[cue('bad',900,1500)];assert.throws(()=>core.plan(project,media,job),/超出/);
  job.result.segments=[cue('a',1100,1700),cue('b',1600,1800)];assert.throws(()=>core.plan(project,media,job),/重叠/);
  assert.throws(()=>core.plan(project,{...media,revision:'b'.repeat(64)},job),/媒体/);
});
test('boundary expansion closes over overlapping cues and never silently changes a range',()=>{
  const {project,media}=fixture();assert.throws(()=>core.snapshot(project,media,'range',{start:1500,end:2100}),/切穿/);
  assert.deepEqual(plain(core.boundaries(project,{start:1500,end:2100},4000).expanded),{start:1000,end:2100});
  assert.throws(()=>core.snapshot(project,media,'range',null),/未改为整段/);
});
test('audio status is derived without altering assets and returns to normal on undo',()=>{
  const {project,media,job}=fixture();project.msw.assets=[{id:'audio1',source_ref:{id:'target',text:'target',start:1000,end:2000}},
    {id:'audio2',source_ref:{id:'translated',track_id:'ext',text:'translated',start:1000,end:2000}},
    {id:'draft',source_ref:{kind:'editor_text',id:'draft'}}];
  project.msw.audio_clips=[{id:'clip',asset_id:'audio1'}];
  const plan=core.plan(project,media,job);
  assert.deepEqual(plan.msw.assets,project.msw.assets);assert.deepEqual(plan.msw.audio_clips,project.msw.audio_clips);
  assert.equal(core.assetStatuses({...project,segments:plan.segments,multi_subtitle:plan.multi,msw:plan.msw}).size,2);
  assert.equal(core.assetStatuses(project).size,0);
});
test('ASR provenance schema rejects malformed records',()=>{
  const {project,media,job}=fixture(),msw=core.plan(project,media,job).msw;
  for(const change of [m=>m.asr_applications['job-1'].audio_index=-1,m=>m.asr_applications['job-1'].range.end=1.5,
    m=>m.asr_applications['job-1'].source_revision='invalid',m=>m.asr_stale_subtitles.ext.translated={},m=>m.asr_applications=[]]){
    const bad=plain(msw);change(bad);assert.throws(()=>window.MSWProject.normalize(bad),/ASR/);
  }
});

test('range ASR inherits group color, clips it to each new cue and keeps inputs immutable',()=>{
  const {project,media,job}=fixture();
  project.segments[0].color={name:'red',value:'#ff0000',start:0,end:2000};
  project.segments[1].color_ref={name:'red',headIdx:0};
  job.snapshot=core.snapshot(project,media,'range',{start:1000,end:2000});
  job.result.segments[0].color={name:'blue',start:1100,end:1700};
  const before=JSON.stringify(project), result=core.plan(project,media,job).segments[1];
  assert.deepEqual(plain(result.color),{name:'red',value:'#ff0000',start:1100,end:1700});
  assert.equal(result.color_ref,undefined);assert.equal(JSON.stringify(project),before);
});

test('range ASR uses the greatest time overlap, including an original default color',()=>{
  const {project,media,job}=fixture();
  project.segments[1].end=1400;project.segments[1].color={name:'red',start:1000,end:1400};
  project.segments.splice(2,0,cue('plain',1400,2000));
  job.snapshot=core.snapshot(project,media,'range',{start:1000,end:2000});
  job.result.segments[0]={start:1100,end:1900,text:'Merged',color:{name:'blue'},color_ref:{name:'blue',headIdx:0}};
  const result=core.plan(project,media,job).segments[1];assert.equal(result.color,undefined);assert.equal(result.color_ref,undefined);
  job.result.segments[0].end=1500;
  assert.equal(core.plan(project,media,job).segments[1].color.name,'red');
});

test('whole-source ASR keeps provider colors',()=>{
  const {project,media,job}=fixture();
  project.segments[1].color={name:'red',start:1000,end:2000};job.snapshot=core.snapshot(project,media,'whole');
  job.result.segments[0].color={name:'blue',start:1100,end:1700};
  assert.equal(core.plan(project,media,job).segments[0].color.name,'blue');
});
