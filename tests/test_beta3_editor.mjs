import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const context={window:{},TextDecoder,TextEncoder,Uint8Array};
vm.runInNewContext(fs.readFileSync(new URL('../web/gap-remove-core.js',import.meta.url),'utf8'),context);
vm.runInNewContext(fs.readFileSync(new URL('../web/editor-utils.js',import.meta.url),'utf8'),context);
const helpers=context.window.AsrEditorUtils;
const plain=value=>JSON.parse(JSON.stringify(value));

test('speaker display defaults off and legacy enabled projects remain compatible',()=>{
  assert.equal(helpers.normalizeSpeakerLabelSettings(null).mapping_enabled,false);
  assert.equal(helpers.normalizeSpeakerLabelSettings({enabled:true}).mapping_enabled,true);
  assert.equal(helpers.normalizeSpeakerLabelSettings({enabled:true,mapping_enabled:false}).mapping_enabled,false);
});

test('SRT speaker prefixes resolve group heads without mutating ASR speaker or TTS text',()=>{
  const cues=[{start:1000,end:1500,text:'one',speaker:'raw-A',color:{name:'red'}},
    {start:1500,end:2000,text:'two',color_ref:{headIdx:0}}];
  const before=JSON.stringify(cues);
  const options={speakerLabelsEnabled:true,speakerLabels:{red:'Alice'},speakerLabelSeparator:': ',alignFirstStart:true};
  const result=helpers.buildSrtPayload(cues,options);
  assert.match(result,/Alice: one/);assert.match(result,/Alice: two/);
  assert.equal(JSON.stringify(cues),before);
  assert.doesNotMatch(helpers.buildSrtPayload(cues,{...options,speakerLabelsEnabled:false}),/Alice/);
});

test('color filenames localize and disambiguate speaker names and Windows reserved names',()=>{
  assert.deepEqual(plain(helpers.colorExportSuffixes(['red','blue','default'])),{red:'红色',blue:'蓝色',default:'default'});
  const names=helpers.colorExportSuffixes(['red','blue','green','yellow'],{names:{red:'A/B',blue:'A:B',green:'CON',yellow:'con'}});
  assert.equal(new Set(Object.values(names).map(x=>x.toLowerCase())).size,4);
  assert.equal(names.red,'A_B');assert.equal(names.blue,'A_B_2');assert.equal(names.green,'_CON');
});

test('swapping maps one-to-many colors and rebuilds heads while preserving metadata',()=>{
  const project={language:'zh',segments:[{id:'a',start:0,end:500,text:'甲',color:{name:'red'}},
    {id:'b',start:500,end:1000,text:'乙',color_ref:{headIdx:0},speaker:'raw'}],
    msw:{assets:[{id:'immutable'}],applied_results:['job']},
    multi_subtitle:{enabled:true,custom:'keep',main_split_mode:'continuous',tracks:[{id:'ext',language:'en',split_mode:'word',
      segments:[{id:'x',start:0,end:300,text:'one'},{id:'y',start:300,end:700,text:'two'},{id:'z',start:700,end:1000,text:'three'}]}],
      bindings:[{id:'binding',track_id:'ext',main_segment_ids:['a','b'],extension_segment_ids:['x','y','z']} ]}};
  const msw=JSON.stringify(project.msw),result=helpers.swapMainAndExtensionSubtitle(project);
  assert.equal(result.mappedColorCount,3);
  assert.deepEqual(project.segments.map(s=>helpers.effectiveColorName(s,project.segments)),['red','red','red']);
  assert.equal(project.segments[2].color_ref.headIdx,0);
  assert.equal(project.multi_subtitle.tracks[0].segments[1].speaker,'raw');
  assert.equal(project.multi_subtitle.tracks[0].segments[1].color_ref.headIdx,0);
  assert.equal(project.language,'en');assert.equal(project.multi_subtitle.tracks[0].language,'zh');
  assert.equal(project.multi_subtitle.custom,'keep');assert.equal(JSON.stringify(project.msw),msw);
});

test('conflicting source colors keep target color and report conflict',()=>{
  const project={segments:[{id:'a',start:0,end:100,text:'a',color:{name:'red'}},{id:'b',start:100,end:200,text:'b',color:{name:'blue'}}],
    multi_subtitle:{enabled:true,tracks:[{id:'ext',segments:[{id:'x',start:0,end:200,text:'x',color:{name:'green'}}]}],
      bindings:[{id:'bind',track_id:'ext',main_segment_ids:['a','b'],extension_segment_ids:['x']}]}};
  const result=helpers.swapMainAndExtensionSubtitle(project);
  assert.equal(result.colorConflictCount,1);assert.equal(project.segments[0].color.name,'green');
});

test('character filter counts tracks independently and absent tracks never match <=',()=>{
  assert.equal(helpers.matchesTrackCharCount(10,10,{target:'either',threshold:16}),false);
  assert.equal(helpers.matchesTrackCharCount(20,10,{target:'extension',threshold:16}),false);
  assert.equal(helpers.matchesTrackCharCount(20,null,{target:'either',op:'le',threshold:16}),false);
  assert.equal(helpers.matchesTrackCharCount(20,0,{target:'either',op:'le',threshold:16}),true);
});
