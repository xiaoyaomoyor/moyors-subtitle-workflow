import {test} from 'node:test';
import assert from 'node:assert/strict';
import core from '../web/msw-asr-presets.js';
const context={id:'qwen',languages:['zh','en'],multiLanguage:false,model:{supportsContext:true,supportsHotwords:true,supportsSpeaker:true,supportsKeepDialect:false}};
test('preset application retains provider and scope, applies only supported options',()=>{
  const preset={language:'en,ja',gapSplit:'500',qwenKeepDialect:true,qwenAudioHotwords:'A',openaiKeywords:'B',speakerColors:true,asrPrompts:{text:'background',overrides:{}}};
  const result=core.applicable(preset,context);
  assert.deepEqual(Object.keys(result.applied),['gapSplit','qwenAudioHotwords','speakerColors','asrPrompts']);
  assert.equal(result.skipped.length,3);assert.equal(preset.language,'en,ja');
  result.applied.asrPrompts.text='changed';assert.equal(preset.asrPrompts.text,'background');
});
test('empty overrides intentionally suppress shared text; unsupported OpenAI options stay out',()=>{
  const p={text:'shared',overrides:{qwen:'dedicated',openai:''}};
  assert.equal(core.promptFor(p,'qwen'),'dedicated');assert.equal(core.promptFor(p,'openai'),'');assert.equal(core.promptFor(p,'soniox'),'shared');
  const result=core.applicable({openaiKeywords:'term',openaiDiarize:true,language:'',asrPrompts:p},{...context,id:'openai',caps:{keywords:false},diarize:true});
  assert.deepEqual(Object.keys(result.applied),['language','asrPrompts']);
});

test('keyword support follows the diarization setting being loaded',()=>{
  const ctx={...context,id:'openai',caps:{keywords:true,customDiarize:true},diarize:true};
  assert.equal(core.applicable({openaiKeywords:'term',openaiDiarize:false},ctx).applied.openaiKeywords,'term');
  assert.equal(core.applicable({openaiKeywords:'term',openaiDiarize:true},{...ctx,diarize:false}).applied.openaiKeywords,undefined);
});
