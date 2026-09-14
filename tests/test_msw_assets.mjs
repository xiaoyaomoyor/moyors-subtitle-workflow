import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
globalThis.window = globalThis;
for (const file of ['msw-project.js','msw-audio-core.js','msw-asset-core.js']) vm.runInThisContext(readFileSync(new URL(`../web/${file}`,import.meta.url),'utf8'));
const fixture = () => JSON.parse(readFileSync(new URL('fixtures/msw_beta1_legacy_project.json',import.meta.url),'utf8'));
const selection = {mainIds:['main-001'],extensionIds:['translation-001'],trackId:'translation-en'};

test('ASR batch import appends partial results, rebases item times and deduplicates jobs',()=>{
  let ext=fixture().msw;
  const job=(id,start)=>({id,project_id:ext.project_id,status:'succeeded',created_at:100,
    snapshot:{batch_id:'asr-batch-test',mode:'clips',source:{revision:'test'}},
    result:{segments:[{id:'cue-'+id,start,end:start+500,text:id,items:[{start,end:start+500,text:id}]}]}});
  const later=job('result-later',3100),earlier=job('result-earlier',1100);
  ext=MSWAssets.asrResults(ext,[later]).extension;
  assert.equal(ext.subtitle_assets[0].start,0);
  const appended=MSWAssets.asrResults(ext,[later,earlier]);ext=appended.extension;
  assert.equal(appended.count,1);assert.equal(ext.asset_batches.length,1);
  assert.equal(ext.subtitle_assets[0].start,2000);assert.equal(ext.subtitle_assets[0].items[0].start,2000);
  assert.equal(ext.subtitle_assets[1].original_start,1100);
  assert.equal(MSWAssets.asrResults(ext,[later,earlier]).count,0);
  assert.throws(()=>MSWAssets.asrResults(ext,[{...later,project_id:'other'}]));
  assert.equal(MSWAssets.asrResults(ext,[{...job('empty',0),result:{segments:[]}}]).count,0);
});
test('copies remain independent, timings and bindings survive insertion', () => {
  const project = fixture(); project.segments[0].color={name:'purple',value:'#a855f7'};
  const batch=MSWAssets.capture(project,selection); project.msw=MSWAssets.add(project.msw,batch.assets,batch.batch);
  MSWProject.normalize(project.msw);
  project.msw.subtitle_assets[0].text='独立素材';
  assert.equal(project.segments[0].text,'你好');
  const plan=MSWAssets.insert(project,batch.assets.map(a=>a.id),3000);
  assert.equal(plan.count,2); assert.equal(plan.project.segments[1].start,3000);
  assert.equal(plan.project.segments[1].items[0].start,3000);
  assert.equal(plan.project.segments[1].color.value,'#a855f7');
  assert.equal(plan.project.multi_subtitle.bindings.length,2);
  assert.notEqual(plan.project.segments[1].id,project.segments[0].id);
  assert.equal(project.segments.length,1);
});
test('insertion preserves gaps, rejects all colliding candidates and handles missing tracks',()=>{
  const project=fixture(); project.segments.push({id:'main-002',start:1500,end:2000,text:'第二条'});
  const batch=MSWAssets.capture(project,{...selection,mainIds:['main-001','main-002']});
  project.msw=MSWAssets.add(project.msw,batch.assets,batch.batch);
  const ids=batch.assets.map(a=>a.id), plan=MSWAssets.insert(project,ids,4000);
  assert.equal(plan.count,3); assert.equal(plan.project.segments.at(-1).start,5500);
  assert.equal(MSWAssets.insert(project,ids,0).count,0);
  project.multi_subtitle.tracks=[];
  assert.equal(MSWAssets.insert(project,ids,4000).rows.filter(r=>r.reason==='请选择目标副字幕轨').length,1);
  project.msw.subtitle_assets[1].original_start=0;
  assert.equal(MSWAssets.insert(project,ids,4000).count,0);
});
test('strict validation, cross-source rejection and result deduplication',()=>{
  const project=fixture(), batch=MSWAssets.capture(project,selection,{kind:'asr',resultId:'job-1'});
  project.msw=MSWAssets.add(project.msw,batch.assets,batch.batch);
  assert.equal(MSWAssets.add(project.msw,batch.assets,batch.batch),null);
  for(const patch of [{end:0},{track_id:1},{items:[{start:0,end:2000,text:'越界'}]}]) {
    const ext=structuredClone(project.msw);Object.assign(ext.subtitle_assets[0],patch);assert.throws(()=>MSWProject.normalize(ext));
  }
  project.msw.subtitle_assets[1].source_id='other';
  assert.throws(()=>MSWAssets.insert(project,batch.assets.map(a=>a.id),5000),/不同来源/);
});
