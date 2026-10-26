import {test} from 'node:test';
import assert from 'node:assert/strict';
import flat from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import processing from '../web/msw-flat-processing-core.js';
let serial=0;const id=p=>`${p}-${++serial}`;
const base=()=>{let p=flat.migrate({segments:[{id:'a',start:0,end:1000,text:'hello'},{id:'b',start:1000,end:2000,text:'world'}],msw:{schema:'msw.editor.v1',project_id:'test'}});return flat.addTrack(p,{...p.subtitles.tracks[0],id:'target',name:'译文',style:{mode:'inherit',slot:'secondary',base:'dialogue'}});};
const job=(snapshot,kind,result)=>({id:id('job'),project_id:'test',snapshot,kind,status:'succeeded',result});
const media={id:'media-test',revision:'a'.repeat(64),reference:'test.wav',name:'test.wav',audio_index:0,metadata:{duration_ms:2000,audio_tracks:[{audio_index:0}]}};

test('ASR and translation fill known track language, preserving an explicit existing language',()=>{
  const p=base(),a=p.subtitles.cues[0],snapshot=processing.translation(p,[a.id],'target');
  const translated=processing.applyTranslation(p,job(snapshot,'translation',{language:'zh',translations:[{id:a.id,text:'你好'}]}),id).project;
  assert.equal(edit.track(translated,'target').language,'zh-hans');
  const input=processing.asr(p,media,'target');
  const recognized=processing.applyAsr(p,job(input,'asr',{language:'en',segments:[{start:0,end:900,text:'Hi'}]}),media,id).project;
  assert.equal(edit.track(recognized,'target').language,'en');
  p.subtitles.tracks.find(t=>t.id==='target').language='ja';
  assert.equal(edit.track(processing.applyTranslation(p,job(processing.translation(p,[a.id],'target'),'translation',{language:'zh',translations:[{id:a.id,text:'你好'}]}),id).project,'target').language,'ja');
});

test('translation applies into explicit flat track with bindings, once, and restores with one undo',()=>{
  const p=base(),source=p.subtitles.cues[0],input=processing.translation(p,[source.id],'target'),j=job(input,'translation',{translations:[{id:source.id,text:'你好'}]}),before=structuredClone(p);
  const out=processing.applyTranslation(p,j,id);assert.equal(p.subtitles.cues.length,2);assert.deepEqual(p,before);assert.equal(out.project.subtitles.cues.at(-1).track_id,'target');assert.equal(out.project.subtitles.bindings[0].source_id,source.id);
  assert.throws(()=>processing.applyTranslation(out.project,j,id),/已经应用/);const h=new edit.History(p);h.commit(out.project,'translate');h.step('undo');assert.deepEqual(h.project,p);
});
test('translation inherits speakers and resolved colors for subsets; save, undo and target overrides stay intact',()=>{
  const p=base(),[head,ref]=p.subtitles.cues;
  head.content.color={name:'green',value:'#66bb6a',start:0,end:2000};head.content.speaker='0';
  ref.content.speaker='0';ref.content.color_ref={cue_id:head.id,name:'green'};
  const s=processing.translation(p,[ref.id],'target');
  const out=processing.applyTranslation(p,job(s,'translation',{translations:[{id:ref.id,text:'译文'}]}),id).project;
  const dest=out.subtitles.cues.at(-1);
  assert.deepEqual(dest.content,{start:1000,end:2000,text:'译文',speaker:'0',color:{name:'green',value:'#66bb6a',start:1000,end:2000}});
  flat.validate(JSON.parse(JSON.stringify(out)));
  const h=new edit.History(p);h.commit(out,'translation');h.step('undo');assert.deepEqual(h.project,p);h.step('redo');assert.deepEqual(h.project,out);
  dest.content.speaker='custom';dest.content.color={name:'blue',value:'#61a7fa',start:1000,end:2000};dest.content.subtitle_style={primaryColor:'#123456'};
  const second=processing.applyTranslation(out,job(processing.translation(out,[ref.id],'target'),'translation',{translations:[{id:ref.id,text:'新译文'}]}),id).project;
  assert.deepEqual(second.subtitles.cues.at(-1).content,{...dest.content,text:'新译文',_dirty:true});
  assert.deepEqual(second.subtitles.bindings,out.subtitles.bindings);
  assert.equal(p.subtitles.cues.length,2);
});
test('translation respects binding direction and offsets when translating from either side',()=>{
  let p=base();const a=p.subtitles.cues[0];p=edit.addCue(p,'target','translated',100,1100,'旧译文');p=flat.bind(p,'translated',a.id,'reverse');
  const s=processing.translation(p,[a.id],'target'),j=job(s,'translation',{translations:[{id:a.id,text:'新译文'}]});const n=processing.applyTranslation(p,j,id).project;
  assert.equal(edit.cue(n,'translated').content.start,100);assert.deepEqual(n.subtitles.bindings,p.subtitles.bindings);assert.equal(edit.cue(n,'translated').content.text,'新译文');
});
test('translation rejects stale source, moved target, changed relations, collisions and locked targets atomically',()=>{
  let p=base();const a=p.subtitles.cues[0],s=processing.translation(p,[a.id],'target'),j=job(s,'translation',{translations:[{id:a.id,text:'译文'}]});
  assert.throws(()=>processing.applyTranslation(edit.updateText(p,a.id,'changed'),j,id),/已变化/);
  assert.throws(()=>processing.applyTranslation(edit.updateTrack(p,'target',{locked:true}),j,id),/锁定/);
  const collision=edit.addCue(p,'target','other',0,1000,'existing');assert.throws(()=>processing.applyTranslation(collision,j,id),/重叠/);assert.equal(collision.subtitles.cues.length,3);
  const bound=flat.bind(collision,a.id,'other','new');assert.throws(()=>processing.applyTranslation(bound,j,id),/已变化/);
});
test('unrelated edits do not stale translation; skips preserve targets and missing results fail',()=>{
  const p=base(),a=p.subtitles.cues[0],b=p.subtitles.cues[1],s=processing.translation(p,[a.id],'target');
  const edited=edit.updateText(p,b.id,'unrelated');const n=processing.applyTranslation(edited,job(s,'translation',{translations:[],skipped_ids:[a.id]}),id).project;assert.equal(n.subtitles.cues.length,2);assert.equal(n.subtitles.cues[1].content.text,'unrelated');
  assert.throws(()=>processing.applyTranslation(p,job(s,'translation',{translations:[]}),id),/缺少/);
});
test('translation detects destination collisions before making provider requests',()=>{
  const p=base(),a=p.subtitles.cues[0];const n=edit.addCue(p,'target','occupied',0,1000,'kept');
  assert.throws(()=>processing.translation(n,[a.id],'target'),/重叠/);assert.equal(n.subtitles.cues.length,3);
});
test('ASR range maps once, keeps word timing and checks source revision and target content',()=>{
  const p=base(),s=processing.asr(p,media,'target',{start:1000,end:2000}),j=job(s,'asr',{segments:[{start:1200,end:1900,text:'speech',items:[{start:1200,end:1900,text:'speech'}]}]});
  const n=processing.applyAsr(p,j,media,id).project;assert.equal(n.subtitles.cues.at(-1).content.start,1200);assert.equal(n.subtitles.cues.at(-1).content.items[0].start,1200);
  assert.throws(()=>processing.applyAsr(p,j,{...media,revision:'b'},id),/媒体/);
  assert.throws(()=>processing.applyAsr(edit.addCue(p,'target','new',1100,1400,'edited'),j,media,id),/已变化/);
  assert.throws(()=>processing.applyAsr(p,{...j,result:{segments:[]}},media,id),/未识别/);
});
test('ASR cannot silently cut existing boundaries or detach bound partners; empty selections never process all',()=>{
  const p=base(),a=p.subtitles.cues[0];assert.throws(()=>processing.asr(p,media,a.track_id,{start:100,end:700}),/边界/);
  const bound=flat.bind(edit.addCue(p,'target','other',0,1000,'translated'),a.id,'other','link');assert.throws(()=>processing.asr(bound,media,a.track_id),/对应关系/);
  assert.throws(()=>processing.translation(p,[],'target'),/选择/);assert.throws(()=>processing.tts(p,[],id),/选择/);
});
test('TTS uses actual flat source identities, including former translations; stale audio never attaches to changed text',()=>{
  const p=edit.addCue(base(),'target','translated',0,1000,'你好'),s=processing.tts(p,['translated'],id),source=s.entries[0];
  assert.equal(source.subtitle_cue_id,'translated');assert.equal(source.track_id,'target');
  const asset={id:'asset-test',source_ref:source},j=job(s,'tts',{items:[{status:'ready',asset}]});
  assert.equal(processing.applyTts(p,j).project.msw.assets[0].source_ref.subtitle_cue_id,'translated');
  assert.throws(()=>processing.applyTts(edit.updateText(p,'translated','changed'),j),/已变化/);
});
