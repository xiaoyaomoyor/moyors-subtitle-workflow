import assert from 'node:assert/strict';
import {test} from 'node:test';
import core from '../web/msw-review-core.js';
import flat from '../web/msw-flat-subtitles.js';
import bridge from '../web/msw-production-project.js';
const mark=()=>({id:'review-1',start_ms:1000,end_ms:2000,name:'台词核对',note:'保留备注',color:'#e7b35a',status:'pending',cue_ids:['deleted-cue'],track_id:'deleted-track'});
test('review notes survive migration, operation view and missing links without changing subtitles',()=>{
  const original={segments:[{id:'a',start:0,end:3000,text:'hello'}]},p=flat.migrate(original),before=bridge.toProject(bridge.fromProject(p)).subtitles;
  p.review_markers={schema:core.SCHEMA,items:[{...mark(),text_color:'#123aBC'}]};core.validate(p.review_markers);flat.validate(p);
  const result=bridge.toProject(bridge.fromProject(p));
  assert.deepEqual(result.review_markers,p.review_markers);assert.deepEqual(result.subtitles,before);
});
test('review validation rejects malformed times, statuses, duplicate IDs and links',()=>{
  for(const patch of [{start_ms:-1},{start_ms:1.5},{end_ms:1000},{end_ms:null},{status:'done'},{color:['#e7b35a']},{text_color:null},{text_color:''},{text_color:'#fff'},{text_color:'#ffffff80'},{text_color:['#ffffff']},{text_color:'red'},{cue_ids:['a','a']},{name:'x'.repeat(121)},{note:'😀'.repeat(1001)}]) {
    assert.throws(()=>core.validate({schema:core.SCHEMA,items:[{...mark(),...patch}]}));
  }
  assert.throws(()=>core.validate({schema:core.SCHEMA,items:[mark(),mark()]}));
  assert.throws(()=>core.validate(null));
});
test('legacy marker text stays readable without mutating data; explicit text colors are preserved',()=>{
  for(const [color,expected] of [['#e7b35a','#20242b'],['#ffffff','#20242b'],['#000000','#ffffff'],['#123456','#ffffff']]) {
    const original={...mark(),color},before=structuredClone(original);
    core.validate({schema:core.SCHEMA,items:[original]});
    assert.equal(core.textColor(original),expected);assert.deepEqual(original,before);
    assert.equal(core.textColor({...original,text_color:'#aa3322'}),'#aa3322');
  }
});
test('review timestamps roundtrip past one hour and reject invalid clock fields',()=>{
  for(const ms of [0,1,3600123,100*3600000])assert.equal(core.parse(core.format(ms)),ms);
  for(const value of ['1:99:00','-01:00:00','1:30:60','abc'])assert.throws(()=>core.parse(value));
});
