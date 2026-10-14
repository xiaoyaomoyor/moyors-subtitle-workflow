import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {plan,shiftText}=createRequire(import.meta.url)('../web/msw-preview-avoidance.js');
const row=(key,y,height=50,extra={})=>({key,groupId:key,x:200,y,width:500,height,start:0,end:1000,...extra});
const bar={x:0,y:970,width:1920,height:110};
test('only intersecting groups move; a bound pair keeps its spacing',()=>{
  const rows=[row('main',880,50,{groupId:'pair'}),row('sub',940,70,{groupId:'pair'}),row('top',50)];
  const before=structuredClone(rows),r=plan(rows,bar);
  assert.equal(r.offsets.get('main'),-48);assert.equal(r.offsets.get('sub'),-48);assert.equal(r.offsets.get('top'),0);
  assert.deepEqual(rows,before);assert.equal(plan(rows,null).offsets.size,0);
});
test('avoidance propagates through simultaneous neighbours but not unrelated cues',()=>{
  const r=plan([row('bottom',950,90),row('upper',890),row('later',890,50,{start:1000,end:2000}),row('side',890,50,{x:1200})],bar);
  assert.equal(r.offsets.get('bottom'),-78);assert.equal(r.offsets.get('upper'),-68);
  assert.equal(r.offsets.get('later'),0);assert.equal(r.offsets.get('side'),0);
});
test('letterbox controls do not shift subtitles; insufficient room requests outside controls',()=>{
  assert.equal(plan([row('a',950)],{...bar,y:1081}).offsets.get('a'),0);
  const r=plan([row('tall',10,1050)],bar);assert.equal(r.overflow,true);assert.equal(r.offsets.size,0);
});
test('temporary ASS offsets preserve motion timing, styling and plain text',()=>{
  const source='{\\an2\\pos(500,1000)\\org(200,800)\\clip(0,900,1000,1080)\\fad(100,200)}Hello';
  assert.equal(shiftText(source,-50),'{\\an2\\pos(500,950)\\org(200,750)\\clip(0,850,1000,1030)\\fad(100,200)}Hello');
  assert.equal(shiftText('{\\move(10,20,30,40,100,200)}Text',-5),'{\\move(10,15,30,35,100,200)}Text');
  assert.equal(shiftText(source,0),source);assert.equal(shiftText('literal \\pos(1,2)',-5),'literal \\pos(1,2)');
  assert.equal(shiftText('{\\move(10,20,30,40,100,200)\\org(20,30)\\clip(0,0,200,200)}Text',-5,8),'{\\move(18,15,38,35,100,200)\\org(28,25)\\clip(8,-5,208,195)}Text');
});
