import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const window={crypto:webcrypto},context=vm.createContext({window});
for(const name of ['msw-project','msw-asset-core','msw-translation-core','msw-asr-core','msw-result-core','msw-result-apply'])vm.runInContext(readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8'),context);
const {MSWResults:R,MSWResultApply:A,MSWAsr:ASR,MSWTranslation:T}=window;
const plain=x=>JSON.parse(JSON.stringify(x));
const cue=(id,start,end,text=id)=>({id,start,end,text});
function fixture(){
  const project={segments:[{...cue('original',1000,9000,'hello world'),color:{name:'purple',value:'#aa55bb',start:1000,end:9000}}],msw:{schema:'msw.editor.v1',project_id:'p'}};
  const media={id:'media',revision:'a'.repeat(64),audio_index:0,metadata:{duration_ms:10000,audio_tracks:[{}]}};
  const job={kind:'asr',id:'j1',project_id:'p',status:'succeeded',created_at:1,snapshot:ASR.snapshot(project,media,'range',{start:3000,end:5000}),result:{segments:[cue('raw',3000,5000,'new')]}};
  R.register(project.msw,[job]);return {project,media,job};
}
test('drafts preserve originals, clear invalid word times, retain stable batch numbers',()=>{
  const {project,job}=fixture();job.result.segments[0].items=[cue('word',3000,5000,'new')];
  R.edit(project.msw,job,0,'edited');const candidate=R.candidate(project.msw,job);
  assert.equal(candidate.result.segments[0].text,'edited');assert.equal(candidate.result.segments[0].items,undefined);assert.equal(job.result.segments[0].text,'new');
  R.register(project.msw,[{...job,id:'j2',created_at:0},job]);assert.equal(R.record(project.msw,job).number,1);
  window.MSWProject.normalize(project.msw);
});
test('crossed range requires explicit policy; whole replacement does not stretch result',()=>{
  const {project,media,job}=fixture();assert.throws(()=>A.plan(project,media,[job],'main'),/请选择/);
  const p=A.plan(project,media,[job],'main','whole').project;
  assert.deepEqual(plain(p.segments.map(c=>[c.start,c.end,c.text])),[[3000,5000,'new']]);assert.equal(p.segments[0].color.value,'#aa55bb');
  assert.equal(project.segments[0].text,'hello world');
});
test('trim preserves both outside pieces and marks text for review without word guesses',()=>{
  const {project,media,job}=fixture();const p=A.plan(project,media,[job],'main','trim').project;
  assert.deepEqual(plain(p.segments.map(c=>[c.start,c.end,c.text,!!c.review_required])),[[1000,3000,'hello world',true],[3000,5000,'new',false],[5000,9000,'hello world',true]]);
  assert.equal(new Set(p.segments.map(c=>c.id)).size,3);window.MSWProject.normalize(p.msw);
});
test('reliable word timing cuts text; cutting through a word keeps original with review flag',()=>{
  const {project,media,job}=fixture();project.segments[0].items=[{start:1000,end:3000,text:'hello '},{start:5000,end:9000,text:'world'}];
  job.snapshot=ASR.snapshot(project,media,'range',{start:3000,end:5000});
  const p=A.plan(project,media,[job],'main','trim').project;
  assert.equal(p.segments[0].text,'hello ');assert.equal(p.segments[2].text,'world');assert.ok(!p.segments[0].review_required);
});
test('main, secondary and library apply independently; edited revisions respect concurrent target changes',()=>{
  const {project,media,job}=fixture();let p=A.plan(project,media,[job],'main','trim').project;
  assert.equal(A.plan(p,media,[job],'main','trim').duplicate,true);
  p=A.plan(p,media,[job],'secondary').project;
  assert.equal(p.multi_subtitle.tracks[0].segments[0].text,'new');
  const stored=R.store(p,[job]);assert.equal(stored.count,1);p.msw=stored.extension;assert.equal(R.store(p,[job]),null);
  R.edit(p.msw,job,0,'revised');const revised=R.candidate(p.msw,job);
  const accepted=A.plan(p,media,[revised],'main').project;assert.equal(accepted.segments[1].text,'revised');
  p.segments[1].text='user changed';assert.throws(()=>A.plan(p,media,[revised],'main'),/字幕已变化/);
});
test('disjoint ranges preserve gap text and apply as one batch; overlapping candidates reject timeline only',()=>{
  const {project,media,job}=fixture();project.segments=[cue('left',1000,4000),cue('gap',4000,6000),cue('right',6000,9000)];
  job.snapshot={...ASR.snapshot(project,media,'range',{start:2000,end:3000}),batch_id:'batch'};job.result.segments=[cue('one',2000,3000)];
  const j2={...job,id:'j2',snapshot:{...ASR.snapshot(project,media,'range',{start:7000,end:8000}),batch_id:'batch'},result:{segments:[cue('two',7000,8000)]}};
  R.register(project.msw,[job,j2]);const p=A.plan(project,media,[job,j2],'main','whole').project;
  assert.ok(p.segments.some(c=>c.id==='gap'));assert.equal(p.segments.length,3);
  const overlapping={...job,id:'j3'};assert.throws(()=>A.plan(project,media,[job,overlapping],'main','whole'),/彼此重叠/);
  assert.equal(R.store(project,[job,overlapping]).count,2);
});
test('secondary snapshots protect concurrent editing and source changes never get bypassed',()=>{
  const {project,media,job}=fixture();project.multi_subtitle={tracks:[{id:'s',segments:[cue('secondary',1000,9000)]}],bindings:[]};
  job.snapshot=ASR.snapshot(project,media,'range',{start:3000,end:5000});project.multi_subtitle.tracks[0].segments[0].text='changed';
  assert.throws(()=>A.plan(project,media,[job],'secondary','trim'),/字幕已变化/);
  assert.throws(()=>A.plan(project,{...media,revision:'b'.repeat(64)},[job],'main','whole'),/媒体/);
});
test('translation has explicit destinations, candidate edits of preserved rows, and revision guards',()=>{
  const {project}=fixture();const job={id:'t1',kind:'translation',project_id:'p',created_at:1,status:'succeeded',snapshot:T.snapshot(project,{mainIds:['original'],hasSelection:true}),result:{translations:[{id:'original',text:'hello world'}],skipped_ids:['original'],skipped_id_namespace:'project',language:'en'}};
  R.register(project.msw,[job]);R.edit(project.msw,job,0,'translated');const edited=R.candidate(project.msw,job);
  assert.deepEqual(plain(edited.result.skipped_ids),[]);
  let p=A.plan(project,null,[edited],'main').project;assert.equal(p.segments[0].text,'translated');
  p=A.plan(p,null,[edited],'secondary').project;assert.equal(p.multi_subtitle.tracks[0].segments[0].text,'translated');
  assert.equal(R.store(p,[edited]).extension.subtitle_assets[0].text,'translated');
  R.edit(p.msw,job,0,'second');const revised=R.candidate(p.msw,job);
  p=A.plan(p,null,[revised],'secondary').project;assert.equal(p.multi_subtitle.tracks[0].segments[0].text,'second');
  p.multi_subtitle.tracks[0].segments[0].text='manual';R.edit(p.msw,job,0,'third');
  assert.throws(()=>A.plan(p,null,[R.candidate(p.msw,job)],'secondary'),/副字幕文本已修改/);
});
test('empty edits cannot delete timeline text or silently enter library',()=>{
  const {project,media,job}=fixture();R.edit(project.msw,job,0,'');const edited=R.candidate(project.msw,job);
  assert.throws(()=>A.plan(project,media,[edited],'main','whole'),/为空/);assert.throws(()=>R.store(project,[edited]),/空内容/);
});
test('a later completed range in the same batch rebases only our own prior application',()=>{
  const {project,media,job}=fixture();job.snapshot.batch_id='multi-batch';
  const later={...job,id:'j2',snapshot:{...ASR.snapshot(project,media,'range',{start:6000,end:7000}),batch_id:'multi-batch'},result:{segments:[cue('second',6000,7000)]}};
  R.register(project.msw,[job,later]);let p=A.plan(project,media,[job],'main','trim').project;
  p=A.plan(p,media,[job,later],'main','trim').project;
  assert.deepEqual(plain(p.segments.map(c=>[c.start,c.end])),[[1000,3000],[3000,5000],[5000,6000],[6000,7000],[7000,9000]]);
});
test('primary replacement also marks a bound secondary moved outside the range for review',()=>{
  const {project,media,job}=fixture();project.multi_subtitle={tracks:[{id:'track',segments:[cue('linked',12000,13000)]}],bindings:[{id:'bind',track_id:'track',main_segment_ids:['original'],extension_segment_ids:['linked']}]};
  const p=A.plan(project,media,[job],'main','whole').project;
  assert.equal(p.msw.asr_stale_subtitles.track.linked,'j1');assert.equal(p.multi_subtitle.bindings.length,0);
});


test('layered ASR explicitly selects an identity and leaves other overlapping text and bindings intact',()=>{
  const {project,media,job}=fixture(); project.schema='msw.project.v2';
  project.segments.push(cue('other',2000,7000,'other speaker'));
  project.multi_subtitle={tracks:[{id:'sub',segments:[cue('translated',2000,7000,'other translation')]}],bindings:[{id:'b',track_id:'sub',main_segment_ids:['other'],extension_segment_ids:['translated']}]};
  job.snapshot=ASR.snapshot(project,media,'range',{start:3000,end:5000});
  assert.throws(()=>A.plan(project,media,[job],'main','trim'),/请选择本次替换|请选择|选择本次替换/);
  const next=A.plan(project,media,[job],'main','trim',{targetIds:['original']}).project;
  assert.equal(next.segments.find(c=>c.id==='other').text,'other speaker');
  assert.equal(next.multi_subtitle.bindings[0].id,'b');
  assert.equal(next.msw.asr_stale_subtitles.sub.translated,undefined);
  assert.equal(next.segments.filter(c=>c.review_required).length,2);
  R.edit(next.msw,job,0,'second take');
  const changed=R.candidate(next.msw,job);
  next.segments.find(c=>c.id==='other').text='edited unrelated speaker';
  const reapplied=A.plan(next,media,[changed],'main','trim').project;
  assert.equal(reapplied.segments.find(c=>c.id==='other').text,'edited unrelated speaker');
  assert.equal(reapplied.segments.find(c=>c.id.startsWith('asr-')).text,'second take');
  assert.equal(reapplied.segments.filter(c=>c.review_required).length,2);
});

test('layered ASR refuses stale selected identity but permits explicitly adding a new layer',()=>{
  const {project,media,job}=fixture();project.schema='msw.project.v2';project.segments.push(cue('other',2000,7000));
  job.snapshot=ASR.snapshot(project,media,'range',{start:3000,end:5000});
  project.segments[0].text='edited';
  assert.throws(()=>A.plan(project,media,[job],'main','trim',{targetIds:['original']}),/字幕已变化/);
  const next=A.plan(project,media,[job],'main','whole',{targetIds:[]}).project;
  assert.equal(next.segments.length,3);assert.equal(next.segments[0].text,'edited');
});

test('layered translation binds by ID and never guesses a nearby unrelated subtitle',()=>{
  const project={schema:'msw.project.v2',segments:[cue('a',0,5000),cue('b',1000,4000)],msw:{schema:'msw.editor.v1',project_id:'p'},
    multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,tracks:[{id:'sub',role:'extension',segments:[cue('unrelated',0,5000)]}],bindings:[]}};
  const snapshot=T.snapshot(project,{mainIds:['a','b']});assert.ok(snapshot.entries.every(e=>e.target===null));
  const result=T.reconcile(project,snapshot,{translations:[{id:'a',text:'译文 A'},{id:'b',text:'译文 B'}]});
  assert.equal(result.conflicts.length,0);assert.equal(result.multi.tracks[0].segments.length,3);
  assert.equal(result.multi.bindings.length,2);assert.equal(result.multi.tracks[0].segments.find(c=>c.id==='unrelated').text,'unrelated');
});
