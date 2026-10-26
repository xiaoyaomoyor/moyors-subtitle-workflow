import {test} from 'node:test';
import assert from 'node:assert/strict';
import speakers from '../web/msw-speaker.js';
import flat from '../web/msw-flat-subtitles.js';
import motion from '../web/msw-subtitle-animation.js';
import bridge from '../web/msw-production-project.js';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},TextDecoder,TextEncoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const utils=context.window.AsrEditorUtils;

test('localized names resolve region aliases and missing names without modifying the identity',()=>{
  const row={...speakers.row(0),name:'Erwyn',names:{en:'Erwyn','zh-hans':'艾尔文','zh-hant':'艾爾文',pt:'Nome'},mode:'speaker'};
  const project={preview:{speaker_palette:{version:1,rows:[row]}}};
  for(const [code,name] of [['zh','艾尔文'],['ZH_CN','艾尔文'],['zh-TW','艾爾文'],['pt-BR','Nome'],['fr','Erwyn'],['','Erwyn']]) {
    assert.equal(speakers.displayName(row,code),name);assert.equal(speakers.prefix(project,row,code),name+'：');
  }
  assert.equal(row.id,'yellow');assert.ok(speakers.valid(project.preview.speaker_palette));
  for(const names of [[],{zh:'名字'},{'en':'bad\n'},{en:''},{en:4},{'__proto__x':'x'}])assert.equal(speakers.valid({version:1,rows:[{...row,names}]}),false);
});

test('physical language survives list reversal, copy, cleared language and localized SRT output',()=>{
  const p=flat.migrate({language:'en',segments:[{id:'a',start:0,end:1000,text:'Hello',color:{name:'yellow'}}],
    multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,tracks:[{id:'zh',role:'extension',name:'译文',language:'zh',segments:[{id:'b',start:0,end:1000,text:'你好',color:{name:'yellow'}}]}],bindings:[]}});
  const rows=speakers.ensure(p).rows;rows[0].name='Erwyn';rows[0].names={'zh-hans':'艾尔文'};
  const v=bridge.fromProject(p),restored=bridge.toProject(bridge.fromProject(bridge.toProject(v)));
  assert.deepEqual(restored.subtitles.tracks.map(t=>t.language),['en','zh']);
  const resolve=speakers.nameResolver(v),list=[...v.segments,...v.multi_subtitle.tracks[0].segments];
  const srt=utils.buildSrtPayload(list,{speakerLabelsEnabled:true,speakerTextResolver:c=>resolve(rows[0],c)+'：'+c.text});
  assert.match(srt,/Erwyn：Hello/);assert.match(srt,/艾尔文：你好/);
  assert.doesNotMatch(utils.buildSrtPayload(list,{speakerLabelsEnabled:false,speakerTextResolver:()=>{throw Error('disabled')}}),/Erwyn/);
  const swapped=bridge.fromProject(bridge.swapColumns(v)),names=speakers.nameResolver(swapped);
  for(const source of [swapped.segments,swapped.multi_subtitle.tracks[0].segments])for(const c of source)assert.equal(names(rows[0],c),c.text==='Hello'?'Erwyn':'艾尔文');
  v.subtitle_tracks.tracks[1].language='';assert.equal(bridge.toProject(v).subtitles.tracks[1].language,'');
});

test('new projects start uncolored; old identities and names survive migration and edits',()=>{
  const fresh={segments:[]};assert.deepEqual(speakers.ensure(fresh).rows.map(r=>r.mode),Array(5).fill('none'));
  const old={segments:[{color:{name:'red'}},{color_ref:{name:'speaker-9',headIdx:0}}],preview:{subtitle:{ass_color_style:'stroke',speaker_labels:{names:{red:'Alice'},separator:' / '}}}};
  const p=speakers.ensure(old,{red:'#112233'});assert.equal(p.rows.length,6);
  const red=p.rows.find(r=>r.id==='red');assert.deepEqual(red,{id:'red',name:'Alice',color:'#112233',mode:'stroke',separator:' / '});
  red.color='#abcdef';red.name='改名';assert.equal(speakers.profile(old,old.segments[0]),red);
  assert.equal(speakers.ensure(old),p);assert.equal(speakers.ensure(fresh).rows[2].name,'SP3');
  old.segments.push({color:{name:'speaker-10',value:'#123456'}});speakers.ensure(old,null,true);
  assert.equal(p.rows.at(-1).id,'speaker-10');assert.equal(p.rows.at(-1).color,'#123456');
});

test('dynamic identities resolve SRT names, separators, references and safe unique filenames',()=>{
  const cues=[{start:0,end:1000,text:'Hello',color:{name:'speaker-9'}},{start:1000,end:2000,text:'Again',color_ref:{name:'speaker-9',headIdx:0}}];
  const original=structuredClone(cues);
  const srt=utils.buildSrtPayload(cues,{speakerLabelsEnabled:true,speakerLabels:{'speaker-9':'九号'},speakerSeparators:{'speaker-9':' / '}});
  assert.match(srt,/九号 \/ Hello/);assert.match(srt,/九号 \/ Again/);assert.deepEqual(cues,original);
  assert.deepEqual(JSON.parse(JSON.stringify(utils.colorExportSuffixes(['speaker-6','speaker-7'],{names:{'speaker-6':'A/B','speaker-7':'A/B'}}))),{'speaker-6':'A_B','speaker-7':'A_B_2'});
});

test('palette persists in native projects; validation and cue style precedence agree',()=>{
  const p=flat.migrate({segments:[{id:'a',start:0,end:1000,text:'Hello'}]});speakers.ensure(p);
  flat.validate(JSON.parse(JSON.stringify(p)));
  const row={...speakers.row(0),mode:'background'};
  assert.equal(speakers.appearance({backgroundShape:'none'}, {}, row).backgroundShape,'rounded');
  assert.equal(speakers.appearance({backgroundColor:'#abcdef'},{subtitle_style:{backgroundColor:'#abcdef'}},row).backgroundColor,'#abcdef');
  p.preview.speaker_palette.rows[0].mode='invalid';assert.throws(()=>flat.validate(p),/说话人/);
});

test('speaker appearance and animation inherit from track and yield to cue overrides',()=>{
  const p={preview:{}},profile=speakers.ensure(p).rows[0];
  profile.mode='text';profile.style={fontSize:72,primaryColor:'#abcdef',latinFontName:'Arial'};
  profile.animation={schema:motion.schema,effects:{fade:{...motion.defaults().effects.fade,enabled:true}}};
  assert.equal(speakers.valid(p.preview.speaker_palette),true);
  const base={fontSize:40,primaryColor:'#ffffff',outline:3};
  const result=speakers.appearance(base,{subtitle_style:{fontSize:55}},profile);
  assert.equal(result.fontSize,55);assert.equal(result.primaryColor,'#abcdef');assert.equal(result.outline,3);
  assert.equal(result.animation.effects.fade.enabled,true);assert.equal(base.fontSize,40);
  for(const patch of [{style:{fontSize:-5}},{style:{marginV:10}},{animation:{schema:motion.schema,effects:{bogus:{}}}}]){
    assert.equal(speakers.valid({version:1,rows:[{...profile,...patch}]}),false);
  }
  assert.equal(speakers.prefix(p,profile),'');p.preview.speaker_labels_visible=true;
  assert.equal(speakers.prefix(p,profile),'SP1：');p.preview.speaker_label_export=false;
  assert.equal(speakers.prefix(p,profile),'');
});
