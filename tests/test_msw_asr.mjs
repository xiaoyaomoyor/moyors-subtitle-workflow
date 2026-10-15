import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import flat from '../web/msw-flat-subtitles.js';
import production from '../web/msw-production-project.js';
import editing from '../web/msw-flat-editing.js';
import processing from '../web/msw-flat-processing-core.js';
const window={MSWFlatSubtitles:flat,MSWProductionProject:production};const context=vm.createContext({window});
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
  const {project,media}=fixture();assert.deepEqual(plain(core.snapshot(project,media,'range',{start:1500,end:2100}).range),{start:1500,end:2100});
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

test('audio provenance follows a moved overlay cue even while its track is hidden',()=>{
  const project={segments:[],overlay_track:{enabled:false,segments:[cue('a',0,500,'spoken')]},msw:{assets:[{id:'voice',source_ref:{id:'a',track_id:null,track_kind:'overlay',start:0,end:500,text:'spoken'}}]}};
  assert.equal(core.assetStatuses(project).size,0);
  project.overlay_track.segments[0].text='changed';
  assert.match(core.assetStatuses(project).get('voice'),/已修改/);
});

function flatAudioFixture({legacySources=false}={}) {
  const main=cue('same-id',0,1000,'Source'),secondary=cue('same-id',0,1000,'Translated');
  const project={segments:[main],msw:{schema:'msw.editor.v1',project_id:'project'},
    multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',
      tracks:[{id:'translation',role:'extension',segments:[secondary]}],
      bindings:[{id:'pair',track_id:'translation',main_segment_ids:[main.id],extension_segment_ids:[secondary.id],start_offset_ms:0,end_offset_ms:0}]}};
  const native=flat.migrate(project);let serial=0;
  const sources=legacySources?[{...main,track_id:null},{...secondary,track_id:'translation'}]
    :processing.tts(native,native.subtitles.cues.map(c=>c.id),()=>`source-${++serial}`).entries;
  native.msw.assets=sources.map((source,index)=>({id:`voice-${index}`,source_ref:source,generation:{provider:'edge'}}));
  return native;
}
function expectFlatStatuses(project,expected) {
  const original=JSON.stringify(project);
  assert.deepEqual(plain([...core.assetStatuses(project)]),expected);
  assert.deepEqual(plain([...core.assetStatuses(production.fromProject(project))]),expected);
  assert.equal(JSON.stringify(project),original,'source review must not rewrite the project or its assets');
}

test('native TTS audio sources resolve in v4 and the normal editor despite display-column track IDs',()=>{
  const p=flatAudioFixture();
  assert.equal(p.msw.assets.length,2);
  assert.notEqual(p.subtitles.cues[0].id,p.subtitles.cues[1].id);
  expectFlatStatuses(p,[]);
  const view=production.fromProject(p),target=view.segments[0];
  target.text='Edited in normal editor';
  assert.deepEqual(plain([...core.assetStatuses(view)]),[['voice-0','来源字幕已修改，配音需复核']]);
});

test('migrated audio aliases keep same-named source and translation cues distinct',()=>{
  const p=flatAudioFixture({legacySources:true});
  expectFlatStatuses(p,[]);
  const source=p.subtitles.cues[0];
  expectFlatStatuses(editing.updateText(p,source.id,'Changed source'),[['voice-0','来源字幕已修改，配音需复核']]);
  expectFlatStatuses(editing.remove(p,[source.id]),[['voice-0','来源字幕已删除或被 ASR 替换']]);
  p.msw.asr_stale_subtitles={translation:{'same-id':'asr-job'}};
  expectFlatStatuses(p,[['voice-1','配音来源副字幕需复核']]);
});

for(const legacySources of [false,true])test(`audio provenance survives track moves and presentation changes (${legacySources?'legacy aliases':'native IDs'})`,()=>{
  let p=flatAudioFixture({legacySources});
  const source=p.subtitles.cues[0],track=p.subtitles.tracks[0];
  p=flat.addTrack(p,{...track,id:'other',name:'Other'});
  p=flat.move(p,[source.id],'other');
  p=editing.updateTrack(p,'other',{enabled:false,collapsed:true});
  p=editing.setDisabled(p,[source.id],true);
  expectFlatStatuses(p,[]);
  p=flat.setTrackGroup(p,p.subtitles.tracks[1].id,'other');
  expectFlatStatuses(p,[]);
  expectFlatStatuses(production.swapColumns(production.fromProject(p)),[]);
});

for(const kind of ['text','time','delete','replace'])test(`flat audio sources still report real ${kind} changes and recover on undo`,()=>{
  const p=flatAudioFixture(),source=p.subtitles.cues[0];let next;
  if(kind==='text')next=editing.updateText(p,source.id,'Changed');
  else if(kind==='time')next=editing.updateRanges(p,[{id:source.id,start:100,end:1100}],{linked:false});
  else {
    next=editing.remove(p,[source.id]);
    if(kind==='replace')next=editing.addCue(next,source.track_id,'asr-replacement',source.content.start,source.content.end,source.content.text);
  }
  expectFlatStatuses(next,[['voice-0',kind==='text'||kind==='time'?'来源字幕已修改，配音需复核':'来源字幕已删除或被 ASR 替换']]);
  expectFlatStatuses(p,[]);
});

test('missing native source identity never falls back to another matching legacy cue',()=>{
  const p=flatAudioFixture();
  p.msw.assets[0].source_ref={...p.msw.assets[0].source_ref,subtitle_cue_id:'deleted',id:'same-id',track_id:null};
  p.msw.assets.push({id:'draft',source_ref:{kind:'editor_text',id:'draft'}},
    {id:'import',source_ref:{id:'missing'},generation:{provider:'imported'}});
  expectFlatStatuses(p,[['voice-0','来源字幕已删除或被 ASR 替换']]);
});
