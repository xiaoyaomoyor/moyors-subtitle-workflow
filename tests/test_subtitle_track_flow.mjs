import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const context=vm.createContext({crypto:webcrypto});context.window=context;
for(const name of ['msw-subtitle-layers','msw-subtitle-tracks','msw-project','msw-asset-core','msw-translation-core','msw-asr-core','msw-result-core','msw-result-apply','msw-tts-core'])vm.runInContext(readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8'),context);
const {MSWSubtitleTracks:C,MSWAsr:A,MSWResults:R,MSWResultApply:P,MSWTranslation:T}=context;
const plain=x=>JSON.parse(JSON.stringify(x));
const ref=id=>({role:'main',track_id:null,cue_id:id});
function fixture(){
  const raw={segments:[{id:'a',start:0,end:2000,text:'Hello'},{id:'b',start:0,end:2000,text:'Meanwhile'}],msw:{schema:'msw.editor.v1',project_id:'p'}};
  const project=C.migrate({...raw,schema:'msw.project.v2',subtitle_layers:{schema:'msw.subtitle_layers.v1',allow_overlap:true,legacy_overlay:{visible:true,cue_ids:[]}}});
  const owner=C.createIndex(project).trackFor(ref('a')).id;
  const media={id:'media',revision:'a'.repeat(64),audio_index:0,metadata:{duration_ms:2000,audio_tracks:[{}]}};
  const job={kind:'asr',id:'j1',project_id:'p',status:'succeeded',created_at:1,snapshot:A.snapshot(project,media,'whole',null,owner),result:{segments:[{id:'raw',start:0,end:2000,text:'New'}]}};
  R.register(project.msw,[job]);return {project,owner,media,job};
}
test('ASR replaces only its captured dialogue track and preserves overlapping identities',()=>{
  const {project,owner,media,job}=fixture(),before=JSON.stringify(project);
  assert.deepEqual(plain(job.snapshot.targets.map(c=>c.id)),['a']);
  const next=P.plan(project,media,[job],'main').project;
  assert.equal(next.segments.find(c=>c.id==='b').text,'Meanwhile');
  assert.equal(C.createIndex(next).trackFor(ref(next.segments.find(c=>c.text==='New').id)).id,owner);
  assert.equal(JSON.stringify(project),before);C.validate(next);
});
test('ASR cannot apply after a target moved, locked, or gained conflicting content',()=>{
  for(const change of ['move','lock','new']) {
    let {project,owner,media,job}=fixture();
    if(change==='lock')project.subtitle_tracks.tracks.find(t=>t.id===owner).locked=true;
    if(change==='move') {project=C.addTrack(project,'dialogue','third');project=C.assign(project,[ref('a')],'third');}
    if(change==='new') {project.segments.push({id:'new',start:2000,end:2500,text:'Tail'});C.reconcile(project,()=>owner);job.result.segments[0].end=2500;}
    assert.throws(()=>P.plan(project,media,[job],'main'));
  }
});
test('translation keeps explicit ownership, positions and simultaneous unrelated translations',()=>{
  const {project}=fixture();const owner=C.createIndex(project).trackFor(ref('a'));
  owner.kind='annotation';project.segments[0].subtitle_position={x:.3,y:.2};
  const snapshot=T.snapshot(project,{mainIds:['a','b'],hasSelection:true});
  const job={kind:'translation',id:'t1',project_id:'p',status:'succeeded',created_at:1,snapshot,result:{translations:[{id:'a',text:'你好'},{id:'b',text:'与此同时'}],language:'zh'}};
  R.register(project.msw,[job]);const next=P.plan(project,null,[job],'secondary').project;
  const index=C.createIndex(next),bindings=next.multi_subtitle.bindings;
  for(const binding of bindings)assert.equal(index.trackFor(ref(binding.main_segment_ids[0])).id,index.trackFor({role:'extension',track_id:binding.track_id,cue_id:binding.extension_segment_ids[0]}).id);
  assert.deepEqual(plain(next.multi_subtitle.tracks[0].segments.find(c=>c.text==='你好').subtitle_position),{x:.3,y:.2});C.validate(next);
  owner.locked=true;assert.throws(()=>P.plan(project,null,[job],'secondary'),/锁定/);
});
test('selected annotations support TTS and ownership changes preserve audio source identity',()=>{
  let {project}=fixture();C.createIndex(project).trackFor(ref('a')).kind='annotation';
  const selection={mainIds:['a'],hasSelection:true};
  const before=context.MSWTts.snapshot(project,selection).entries[0];
  project=C.addTrack(project,'dialogue','third');project=C.assign(project,[ref('a')],'third');
  const after=context.MSWTts.snapshot(project,selection).entries[0];delete before.key;delete after.key;
  assert.deepEqual(plain(before),plain(after));assert.equal(context.MSWTts.scope(project,{}).sources.length,0);
});

test('subtitle assets insert into an explicit owner without colliding with another track',()=>{
  let {project,owner}=fixture();const assets=context.MSWAssets;
  const captured=assets.capture(project,{mainIds:['a']});project.msw=assets.add(project.msw,captured.assets,captured.batch);
  project=C.addTrack(project,'dialogue','third');
  const before=JSON.stringify(project),ids=captured.assets.map(a=>a.id);
  const next=assets.insert(project,ids,0,{},c=>c,{subtitleTrackId:'third'});
  assert.equal(next.count,1);C.validate(next.project);
  const cue=next.project.segments.find(c=>!['a','b'].includes(c.id));
  assert.equal(C.createIndex(next.project).trackFor(ref(cue.id)).id,'third');
  assert.equal(JSON.stringify(project),before);
  assert.equal(assets.insert(project,ids,0,{},c=>c,{subtitleTrackId:owner}).count,0);
  project.subtitle_tracks.tracks.find(t=>t.id==='third').locked=true;
  assert.throws(()=>assets.insert(project,ids,0,{},c=>c,{subtitleTrackId:'third'}),/锁定/);
});
