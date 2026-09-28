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

test('GPT and Edge regeneration freeze common and advanced controls without local paths',()=>{
 const g={...asset,generation:{provider:'gpt-sovits',model:'api-v2',voice:'reference',language_type:'zh',gpt_model:'model-a',sovits_model:'model-b',speaker_ref:'ref-a',aux_refs:['ref-b'],prompt_lang:'ja',prompt_text:'reference words',no_prompt:false,speed_factor:1.1,text_split_method:'cut5',top_k:15,top_p:.9,temperature:.8,seed:123,repetition_penalty:1.35,sample_steps:32,super_sampling:false,display_text:'你好',service_url:'http://127.0.0.1:9880',directory:'private'}};
 const e={...asset,id:'edge',generation:{provider:'edge',model:'edge-online',voice:'ja-JP-NanamiNeural',language_type:'ja-JP',rate:-20,volume:10,pitch:5,display_text:'こんにちは'}};
 const plan=core.regeneration({msw:{assets:[g,e]}},[clip('g',0),{...clip('e',2000),asset_id:'edge'}]);
 assert.equal(plan.groups.length,2);const [gpt,edge]=plan.groups;
 assert.equal(gpt.recipe.prompt_lang,'ja');assert.equal(gpt.recipe.seed,123);assert.equal(gpt.recipe.aux_refs[0],'ref-b');
 assert.equal(gpt.recipe.directory,undefined);assert.equal(gpt.recipe.service_url,undefined);
 assert.equal(edge.recipe.rate,-20);assert.equal(edge.recipe.volume,10);assert.equal(edge.recipe.pitch,5);
});
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

test('all seven engines retain original regeneration fields without exporting connection secrets',()=>{
 const recipes=[
  {provider:'qwen',region:'beijing',model:'qwen3-tts-flash',voice:'Cherry',language_type:'Auto'},
  {provider:'yukkuri',model:'aquestalk1',voice:'f1',language_type:'Chinese',speed:100},
  {provider:'indextts',model:'index-tts-2.5',voice:'ref',speaker_ref:'r',language_type:'ZH',max_mel_tokens:2000,temperature:.8},
  {provider:'gpt-sovits',model:'v2Pro',voice:'ref',speaker_ref:'r',gpt_model:'g',sovits_model:'s',language_type:'zh',top_k:12,sample_steps:32},
  {provider:'edge',model:'edge-online',voice:'ja-JP-NanamiNeural',language_type:'ja-JP',rate:10,volume:-5,pitch:2},
  {provider:'minimax',region:'cn',model:'speech-2.6-hd',voice:'account-voice',language_type:'Chinese',speed:1.2,volume:2,pitch:3,emotion:'whisper'},
  {provider:'mossland',model:'moss-tts-1.5-flash-2026-06-26',voice:'account-voice',language_type:'Japanese',expected_duration_sec:2},
 ];
 const assets=recipes.map((recipe,i)=>({...asset,id:'a'+i,generation:{...recipe,display_text:'显示',spoken_text:'朗读',apiKey:'secret',base_url:'private'}}));
 const clips=assets.map((a,i)=>({...clip('c'+i,i*1000),asset_id:a.id}));
 const result=core.regeneration({msw:{assets}},clips);
 assert.equal(result.groups.length,7);
 result.groups.forEach((group,i)=>assert.deepEqual(JSON.parse(JSON.stringify(group.recipe)),recipes[i]));
 assert.equal(result.groups[5].entries[0].spoken_text,'朗读');
});
