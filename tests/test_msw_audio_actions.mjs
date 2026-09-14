import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context={window:{},crypto:globalThis.crypto};
for(const file of ['msw-project.js','msw-audio-core.js','msw-audio-actions-core.js']) vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const core=context.window.MSWAudioActions, audio=context.window.MSWAudio;
const asset={id:'a',sample_rate:1000,sample_count:1000,generation:{display_text:'Display',spoken_text:'Reading'}};
const clip=(id,start)=>audio.create(asset,'voice',start,id);
const project={msw:{assets:[asset]},segments:[]};
test('fill rejects both overlap candidates and existing empty cues, preserves touching endpoints',()=>{
 const p={...project,segments:[{id:'old',start:4000,end:5000,text:''}]};
 const result=core.fill(p,[clip('a',0),clip('b',500),clip('c',1500),clip('d',4100)]);
 assert.equal(result.count,1); assert.equal(result.segments[0].start,1500);
 assert.equal(result.rows[0].reason,'所选贴片彼此重叠'); assert.equal(result.rows[1].reason,'所选贴片彼此重叠');
 assert.equal(result.rows[3].reason,'与现有主字幕重叠');
 assert.equal(core.fill(project,[clip('a',0),clip('b',1000)]).count,2);
});
test('fill uses external filename, crop range and remaps group references',()=>{
 const imported={...asset,generation:{provider:'imported',filename:'Music.wav',text_origin:'filename'}};
 const p={msw:{assets:[imported]},segments:[{id:'head',start:3000,end:4000,text:'x',color:{name:'purple'}},{id:'tail',start:4000,end:5000,text:'y',color_ref:{headIdx:0},sticker_ref:{headIdx:0}}]};
 const c=clip('a',0); c.source_in_sample=500;
 const result=core.fill(p,[c]); assert.equal(result.count,1); assert.equal(result.segments[0].end,500);
 assert.equal(result.segments[0].text,'Music.wav'); assert.equal(result.segments[2].color_ref.headIdx,1);
 assert.equal(result.segments[2].sticker_ref.headIdx,1); assert.equal(p.segments[1].color_ref.headIdx,0);
});
test('gain offsets reject whole batch outside limits',()=>{
 assert.throws(()=>core.gains([{id:'a',gain_db:10,label:'A'},{id:'b',gain_db:0,label:'B'}],3,'offset'),/A/);
 assert.equal(core.gains([{id:'a',gain_db:-5}],2,'offset').get('a'),-3);
});

test('regeneration groups full original recipes, keeps pronunciation and excludes credentials',()=>{
 const a={...asset,generation:{provider:'yukkuri',model:'aquestalk1',voice:'f1',language_type:'Chinese',speed:100,display_text:'你好',spoken_text:'にーはお',apiKey:'never'},source_ref:{pronunciation_override:'拟好'}};
 const p={msw:{assets:[a]}}; const plan=core.regeneration(p,[clip('a',0),clip('b',2000)]);
 assert.equal(plan.groups.length,1); assert.equal(plan.groups[0].entries.length,2);
 assert.notEqual(plan.rows[0].key,plan.rows[1].key); assert.equal(plan.groups[0].entries[0].spoken_text,'にーはお');
 assert.equal(plan.groups[0].recipe.apiKey,undefined);
});
test('replacement uses full new length, retains edits, rejects all fourth-layer candidates',()=>{
 const old={...asset,sample_count:100},fresh={...asset,id:'new',sample_count:4000};
 const clips=[0,1000,2000,3000].map((start,i)=>({...clip('c'+i,start),source_out_sample:100,gain_db:-5}));
 const ext={assets:[old,fresh],audio_clips:clips};
 const rows=clips.map(c=>({id:c.id,original:{...c},assetId:'new',reason:''}));
 assert.equal(core.replacements(ext,rows).size,0); assert.ok(rows.every(row=>row.reason.includes('三层')));
 const row={id:clips[0].id,original:{...clips[0]},assetId:'new',reason:''};
 const replacement=core.replacements(ext,[row]).get(row.id); assert.equal(replacement.source_out_sample,4000); assert.equal(replacement.gain_db,-5);
 clips[0].start_ms=1; assert.equal(core.replacements(ext,[{...row,reason:''}]).size,0);
});

test('mixed providers and voices form separate original-recipe groups',()=>{
 const base={...asset,generation:{provider:'qwen',region:'beijing',model:'qwen3-tts-flash',voice:'Cherry',language_type:'Auto',display_text:'Hello',spoken_text:'Hello'}};
 const second={...base,id:'b',generation:{...base.generation,voice:'Serena'}};
 const local={...base,id:'c',generation:{provider:'indextts',model:'index-tts-2.5',speaker_ref:'ref-original',voice:'Original',language_type:'ZH',display_text:'你好',spoken_text:'你好',emotion_mode:'text',emotion_text:'快乐',temperature:.7}};
 const p={msw:{assets:[base,second,local]}};
 const plan=core.regeneration(p,[clip('one',0),{...clip('two',1000),asset_id:'b'},{...clip('three',2000),asset_id:'c'}]);
 assert.equal(plan.groups.length,3);
 assert.equal(plan.groups[1].recipe.voice,'Serena');
 assert.equal(plan.groups[2].recipe.emotion_text,'快乐');
 assert.equal(plan.groups[2].recipe.temperature,.7);
});
