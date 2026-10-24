import {test} from 'node:test';
import assert from 'node:assert/strict';
import speakers from '../web/msw-speaker.js';
import flat from '../web/msw-flat-subtitles.js';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},TextDecoder,TextEncoder,Uint8Array};
for(const file of ['gap-remove-core.js','editor-utils.js'])vm.runInNewContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const utils=context.window.AsrEditorUtils;

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
