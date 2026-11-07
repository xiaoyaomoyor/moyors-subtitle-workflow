import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFixture,parseScenario,audioFixture,waveform,hash,DURATION_MS,MATRIX} from '../scripts/performance/fixtures.mjs';
import {stats,summarize,compareReports,REPORT_SCHEMA,HARNESS_VERSION} from '../scripts/performance/metrics.mjs';
const require=createRequire(import.meta.url),flat=require('../web/msw-flat-subtitles.js'),bridge=require('../web/msw-production-project.js');

test('fixed matrix isolates subtitle count from media length and remains deterministic',()=>{
  for(const scenario of MATRIX) {
    const {profile,count}=parseScenario(scenario),{project,manifest}=createFixture(profile,count);
    assert.equal(project.subtitles.cues.length,count);assert.equal(manifest.durationMs,DURATION_MS);
    assert.equal(new Set(project.subtitles.cues.map(c=>c.id)).size,count);
    assert.equal(flat.validate(project),true);
    assert.equal(manifest.contentHash,hash(project));assert.equal(createFixture(profile,count).manifest.contentHash,manifest.contentHash);
    assert.equal(project.subtitles.cues.filter(c=>c.track_id===manifest.destination).length,0);
    assert.ok(project.subtitles.cues.every(c=>c.content.end<=DURATION_MS));
  }
});
test('fixtures survive the production operation view without loss of binding and words',()=>{
  for(const profile of ['plain','bound','mixed','migrated','long-note']) {
    const {project,manifest}=createFixture(profile,1000),view=bridge.fromProject(project),back=bridge.toProject(view);flat.validate(back);
    assert.equal(view.segments[0].id,manifest.firstCue,'The first edit anchor must be a dialogue cue, not an annotation');
    const source=new Map(project.subtitles.cues.map(c=>[c.id,c]));
    assert.equal(back.subtitles.cues.length,source.size);assert.equal(back.subtitles.bindings.length,project.subtitles.bindings.length);
    for(const c of back.subtitles.cues){assert.equal(c.track_id,source.get(c.id).track_id);assert.deepEqual(c.content,source.get(c.id).content);}
  }
});
test('mixed workload includes real valid appearance, animation and audio clip references',()=>{
  const {project,manifest}=createFixture('mixed',1000);
  assert.equal(manifest.speakers,12);assert.equal(manifest.audioClips,100);assert.ok(manifest.tracks>4&&manifest.styledCues>0&&manifest.animatedCues>0);
  const a=project.msw.assets[0],wav=audioFixture();assert.equal(a.sha256,hash(wav));assert.equal(a.byte_size,wav.length);
  const context={window:{}};vm.runInNewContext(readFileSync(new URL('../web/msw-project.js',import.meta.url),'utf8'),context);
  assert.equal(context.window.MSWProject.validAsset(a),true);
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(40),wav.length-44);
  assert.ok(project.msw.audio_clips.every(c=>c.asset_id===a.id&&c.source_out_sample<=a.sample_count));
  for(const c of project.subtitles.cues.filter(c=>c.content.subtitle_animation?.effects?.wave?.enabled)){
    const wave=c.content.subtitle_animation.effects.wave;assert.equal(wave.unit,'ms');assert.equal(wave.end-wave.start,400);
  }
  assert.ok(!JSON.stringify(project).includes('api_key'));
});
test('waveform and fixture arguments are reproducible and bounded',()=>{
  assert.deepEqual(waveform(1000),waveform(1000));assert.equal(Buffer.from(waveform(1000).data,'base64').length,200);
  for(const value of ['bound:0','bound:101','mixed:30002','unknown:1000','bound:1000junk'])assert.throws(()=>parseScenario(value));
});
test('failed or non-finite timings never become apparently fast successes; small samples have no p95',()=>{
  const s=summarize([{status:'failed',syncMs:0},{status:'ok',syncMs:10},{status:'ok',syncMs:30}]);
  assert.equal(s.failed,1);assert.equal(s.syncMs.n,2);assert.equal(s.syncMs.median,20);assert.equal(s.syncMs.p95,null);
  assert.deepEqual(stats([NaN,Infinity,-1,null]),{n:0,median:null,p95:null,max:null});
  assert.equal(stats(Array.from({length:20},(_,i)=>i+1)).p95,19);
});
const report=(ms=100)=>({schema:REPORT_SCHEMA,harnessVersion:HARNESS_VERSION,fixture:{contentHash:'fixed'},environment:{platform:'test',arch:'test',cpu:'test',memoryBytes:1,node:'n',python:'p',browser:'b',headless:true},config:{viewport:{width:1440,height:1000},video:{fps:2},repeats:3,warmup:1,idleMs:6000},operations:{paste:{summary:summarize(Array.from({length:3},()=>({status:'ok',syncMs:ms})))}}});
test('comparison rejects changed fixtures and environments and reports missing or failed work',()=>{
  const a=report(),b=report(180);assert.ok(compareReports(a,b).rows.find(r=>r.metric==='syncMs').regression);
  b.environment.browser='new';assert.equal(compareReports(a,b).compatible,false);b.environment.browser='b';
  b.fixture.contentHash='different';assert.equal(compareReports(a,b).compatible,false);b.fixture.contentHash='fixed';
  b.operations.paste.summary=summarize([{status:'failed',syncMs:0}]);assert.deepEqual(compareReports(a,b).failures,['paste']);
  delete b.operations.paste;assert.deepEqual(compareReports(a,b).missing,['paste']);
  b.status='failed';assert.ok(compareReports(a,b).failures.includes('candidate-incomplete'));
});
