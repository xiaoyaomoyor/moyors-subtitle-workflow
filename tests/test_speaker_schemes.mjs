import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../web/msw-speaker-schemes.js';
import speakers from '../web/msw-speaker.js';
import motion from '../web/msw-subtitle-animation.js';

const ids=()=>{let n=0;return ()=>`person-${++n}`;};
const palette=()=>({version:1,rows:[{...speakers.row(0),name:'Erwyn',names:{'zh-hans':'艾尔文'},mode:'stroke',style:{fontSize:60},animation:{schema:motion.schema,effects:{fade:{...motion.defaults().effects.fade,enabled:true}}}}, {...speakers.row(1),name:'Alice'}]});
const capture=()=>core.capture(palette(),{id:'series',name:'团录',makeId:ids()});

test('capture is detached and includes full descriptions without project references or preset dependency',()=>{
  const p=palette();p.rows[0].name_visibility={en:false,'zh-hans':true};p.rows[0].style_preset='local-style';p.rows[0].private_project_field='ignored';const before=structuredClone(p);
  const result=core.capture(p,{id:'series',name:'团录',makeId:ids()});
  assert.deepEqual(p,before);assert.notEqual(result.scheme.rows[0].id,p.rows[0].id);
  assert.equal(result.scheme.rows[0].names['zh-hans'],'艾尔文');assert.equal(result.scheme.rows[0].animation.effects.fade.enabled,true);
  assert.deepEqual(result.scheme.rows[0].name_visibility,{en:false,'zh-hans':true});
  assert.equal(result.scheme.rows[0].style_preset,undefined);assert.equal(result.scheme.rows[0].private_project_field,undefined);
  assert.equal(result.palette.rows[0].id,'yellow');assert.deepEqual(result.palette.rows[0].scheme_ref,{scheme_id:'series',person_id:'person-1'});
  core.validate({version:1,schemes:[result.scheme]});
});

test('separate projects never map by SP number, color, or duplicate names; explicit mapping is idempotent',()=>{
  const {scheme}=capture(),p={version:1,rows:[{...speakers.row(0),name:'Alice'},{...speakers.row(1),name:'Erwyn'}]};
  assert.deepEqual(core.suggestions(p,scheme),{yellow:'',green:''});
  const result=core.apply(p,scheme,{yellow:'person-2',green:'person-1'});
  assert.equal(result.updated,2);assert.equal(result.added,0);assert.equal(result.palette.rows[1].name,'Erwyn');
  assert.deepEqual(result.palette.rows.map(r=>r.id),['yellow','green']);assert.equal(result.palette.rows[1].mode,'stroke');
  assert.deepEqual(core.suggestions(result.palette,scheme),{yellow:'person-2',green:'person-1'});
  assert.equal(core.apply(result.palette,scheme,core.suggestions(result.palette,scheme)).updated,0);
  assert.deepEqual(core.suggestions(result.palette,{...scheme,id:'other'}),{yellow:'',green:''});
});

test('unmapped rows stay intact; add missing people once with collision-safe local IDs',()=>{
  const {scheme}=capture(),p={version:1,rows:[{...speakers.row(0),name:'Guest'}]};
  assert.deepEqual(core.apply(p,scheme,{}).palette,p);
  const result=core.apply(p,scheme,{}, {addMissing:true,makeId:ids()});
  assert.equal(result.added,2);assert.equal(result.palette.rows[0].name,'Guest');
  assert.equal(core.apply(result.palette,scheme,{}, {addMissing:true,makeId:()=>{throw Error('unexpected');}}).added,0);
  assert.throws(()=>core.apply(p,scheme,{}, {addMissing:true,makeId:()=>p.rows[0].id}),/编号/);
  for(const m of [true,{missing:'person-1'},{yellow:'missing'}])assert.throws(()=>core.apply(p,scheme,m),/对应/);
});

test('overwrite keeps absent cast, preserves stable identities, rejects divergent many-to-one rows',()=>{
  const first=capture(),p=structuredClone(first.palette);p.rows.pop();p.rows[0].names['zh-hans']='艾尔温';
  const next=core.capture(p,{id:'series',name:'更新',previous:first.scheme,makeId:ids()});
  assert.equal(next.scheme.rows.length,2);assert.equal(next.scheme.rows[0].id,first.scheme.rows[0].id);
  assert.equal(next.scheme.rows[0].names['zh-hans'],'艾尔温');assert.equal(first.scheme.rows[0].names['zh-hans'],'艾尔文');
  const withUnused={...p,rows:[...p.rows,{...speakers.row(2)}]};
  assert.equal(core.capture(withUnused,{id:'series',name:'更新',previous:first.scheme,makeId:()=>{throw Error('must not add');}}).scheme.rows.length,2);
  assert.equal(core.capture(withUnused,{id:'series',name:'更新',previous:first.scheme,makeId:()=> 'added',includeUnmapped:true}).scheme.rows.length,3);
  p.rows.push({...structuredClone(p.rows[0]),id:'fragment'});
  assert.equal(core.capture(p,{id:'series',name:'更新',previous:first.scheme,makeId:ids()}).scheme.rows.length,2);
  p.rows[1].color='#123456';assert.throws(()=>core.capture(p,{id:'series',name:'更新',previous:first.scheme,makeId:ids()}),/多行配置不同/);
});

test('strict library and provenance validation reject malformed and private payloads',()=>{
  const {scheme,palette:p}=capture();assert.equal(speakers.valid(p),true);
  for(const ref of [{scheme_id:'series'}, {scheme_id:'series',person_id:'x',extra:1}, {scheme_id:'',person_id:'x'}])assert.equal(speakers.valid({...p,rows:[{...p.rows[0],scheme_ref:ref}]}),false);
  for(const change of [{rows:[{...scheme.rows[0],cue_id:'private'}]},{rows:[{...scheme.rows[0],style:{fontSize:-1}}]}, {name:'bad\n'}, {id:''}])assert.throws(()=>core.validate({version:1,schemes:[{...scheme,...change}]}));
  assert.throws(()=>core.validate({version:1,schemes:[scheme,scheme]}));
});
