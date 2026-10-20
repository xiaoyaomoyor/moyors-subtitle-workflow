import {test} from 'node:test';
import assert from 'node:assert/strict';
import A from '../web/msw-subtitle-animation.js';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import production from '../web/msw-production-project.js';

test('recipes fill editable channels, preserve unrelated parameters and support channel removal',()=>{
  let a=A.defaults();a.effects.blink.enabled=true;a.effects.transform.enabled=true;a.effects.transform.fromX=-70;
  a=A.resolve(a,A.presetPatch(a,'fade'));
  assert.equal(A.valid(a),true);assert.equal(a.effects.fade.enabled,false);
  assert.equal(A.sample(a,100,2000).opacity,.5);
  assert.equal(a.effects.transform.fromX,-70);
  const fade=structuredClone(a.effects.curves.channels.opacity);
  a=A.resolve(a,A.presetPatch(a,'transform'));
  assert.deepEqual(a.effects.curves.channels.opacity,fade);
  assert.equal(A.sample(a,0,2000).scale,85);
  a=A.resolve(a,A.editChannel(a,'x',null));
  assert.equal(A.sample(a,0,2000).x,0);
  assert.equal(a.effects.blink.enabled,true);
  a.effects.curves.unit='ms';
  assert.throws(()=>A.presetPatch(a,'fade',120000),/百分比/);
});

test('editing shows existing envelopes without mutating them or activating unrelated curves',()=>{
  const a=A.defaults();a.effects.fade={enabled:true,unit:'percent',in:20,out:10};
  const before=structuredClone(a),points=A.editablePoints(a,'opacity',2000);
  assert.deepEqual(a,before);assert.equal(points[0].value,0);
  assert.equal(points.find(p=>p.time===20).value,100);
  const edited=A.resolve(a,A.editChannel(a,'opacity',points));
  for(const time of [0,100,400,1000,1850,2000])assert.ok(Math.abs(A.sample(edited,time,2000).opacity-A.sample(a,time,2000).opacity)<1e-8);
  assert.deepEqual(Object.keys(edited.effects.curves.channels),['opacity']);
  assert.equal(A.editablePoints(A.defaults(),'scale')[0].value,100);
});

test('animation timing composes fade, blink, transform and grapheme reveal on a cue clock',()=>{
  const a=A.defaults();for(const v of Object.values(a.effects))v.enabled=true;
  assert.equal(A.sample(a,0,2000,8).opacity,0);
  assert.equal(A.sample(a,400,2000,8).opacity,0); // blink dark phase
  const middle=A.sample(a,650,2000,8);assert.equal(middle.revealed,6);assert.equal(middle.scale,100);assert.equal(middle.opacity,1);
  assert.equal(A.sample(a,2000,2000,8).opacity,0);
  a.effects.fade.in=a.effects.fade.out=100;
  a.effects.blink.enabled=false;assert.equal(A.sample(a,1000,2000).opacity,1);
});

test('animation contract rejects unknown fields, unsafe values and backwards ranges',()=>{
  for(const change of [a=>a.effects.blink.period=1,a=>a.effects.fade.in=101,a=>a.effects.transform.easing='cubic',a=>a.effects.typewriter.end=0,a=>a.effects.fade.enabled=1,a=>a.effects.fade.in=NaN,a=>a.effects.fade.extra=0,a=>delete a.effects.fade.unit,a=>a.effects.extra={},a=>a.schema='future']){
    const a=A.defaults();change(a);assert.equal(A.valid(a),false);assert.throws(()=>A.normalize(a),/无效/);
  }
  const ms=A.defaults();ms.effects.fade.unit='ms';ms.effects.fade.in=60000;assert.equal(A.valid(ms),true);
  assert.equal(A.valid(null),false);assert.equal(A.valid([]),false);
});

test('keyframes override only their channels and multiply fade opacity without overshoot',()=>{
  const a=A.defaults();Object.assign(a.effects.transform,{enabled:true,fromX:10,toX:30,fromY:20,toY:20});
  a.effects.fade.enabled=true;a.effects.fade.in=100;a.effects.fade.out=0;
  a.effects.curves={enabled:true,unit:'percent',channels:{
    x:[{time:10,value:-100,easing:'smooth'},{time:50,value:100,easing:'hold'},{time:90,value:0,easing:'linear'}],
    opacity:[{time:0,value:50,easing:'linear'}]
  }};
  assert.equal(A.valid(a),true);
  assert.equal(A.sample(a,600,2000).x,0);assert.equal(A.sample(a,600,2000).y,20);
  assert.equal(A.sample(a,1000,2000).opacity,.25);
  assert.equal(A.sample(a,1799,2000).x,100);assert.equal(A.sample(a,1800,2000).x,0);
  for(let t=0;t<=2000;t+=13)assert.ok(Math.abs(A.sample(a,t,2000).x)<=100);
  const ms=A.convertUnit(a.effects.curves,'ms',2000);
  assert.equal(ms.channels.x[1].time,1000);assert.deepEqual(A.convertUnit(ms,'percent',2000),a.effects.curves);
  assert.throws(()=>A.convertUnit(ms,'percent',500),/范围/);
  for(const duration of [1733,3333,4407,9127]){
    const effect={enabled:true,unit:'ms',channels:{x:[{time:0,value:0,easing:'linear'},{time:duration,value:100,easing:'linear'}]}};
    const converted=A.convertUnit(effect,'percent',duration);
    assert.ok(A.valid({schema:A.schema,effects:{curves:converted}}));
    assert.ok(Math.abs(converted.channels.x[1].time-100)<1e-8);
  }
  for(const points of [[],[{time:0,value:Infinity,easing:'linear'}],[{time:0,value:0,easing:'bad'}],
    [{time:0,value:0,easing:'linear'},{time:0,value:1,easing:'linear'}],Array.from({length:33},(_,i)=>({time:i,value:i,easing:'linear'}))]){
    const b=structuredClone(a);b.effects.curves.channels.x=points;assert.equal(A.valid(b),false);
  }
  const row={x:400,y:800,width:200,height:100,position:{x:500/1920,y:900/1080},motion:a};
  assert.equal(A.envelope(row,1920).x,300);assert.equal(A.envelope(row,1920).width,400);
});

test('control avoidance uses the whole motion envelope without changing the editable base geometry',()=>{
  const motion=A.defaults();Object.assign(motion.effects.transform,{enabled:true,fromX:-50,toX:30,fromY:40,toY:0,fromScale:100,toScale:150});
  const row={x:400,y:800,width:200,height:100,position:{x:500/1920,y:900/1080},motion};
  const bounds=A.envelope(row,1920);assert.equal(bounds.x,300);assert.equal(bounds.y,750);assert.equal(bounds.width,380);assert.equal(bounds.height,190);
  assert.equal(row.x,400);assert.equal(row.height,100);
});

test('selected effect overrides preserve other inherited effects, locks, split, merge and history',()=>{
  let p=core.migrate({segments:[{id:'a',start:0,end:2000,text:'hello world'}]});
  const id=p.subtitles.cues[0].id,track=p.subtitles.tracks[0].id;
  p=core.addTrack(p,{...p.subtitles.tracks[0],id:'translation'});p=edit.addCue(p,'translation','b',0,2000,'translation');p=core.bind(p,id,'b','pair');
  p=production.toProject(production.fromProject(p));
  const before=structuredClone(p),fade={...A.defaults().effects.fade,enabled:true};
  p=edit.updateAnimation(p,[{id,animation:{schema:A.schema,effects:{fade}}}]);
  assert.equal(edit.cue(p,'b').content.subtitle_animation,undefined);assert.deepEqual(p.subtitles.bindings,before.subtitles.bindings);
  const base=A.defaults();base.effects.blink.enabled=true;
  assert.equal(A.resolve(base,edit.cue(p,id).content.subtitle_animation).effects.blink.enabled,true);
  assert.deepEqual(production.toProject(production.fromProject(p)).subtitles,p.subtitles);
  let seq=0;const makeId=()=>`split-${++seq}`,split=edit.split(p,id,1000,{makeId});
  for(const c of split.project.subtitles.cues.filter(c=>c.track_id===track))assert.equal(c.content.subtitle_animation.effects.fade.enabled,true);
  const merged=edit.merge(split.project,split.ids.slice(0,2),{makeId}).project;
  assert.equal(merged.subtitles.cues.find(c=>c.track_id===track).content.subtitle_animation.effects.fade.enabled,true);
  const h=new edit.History(before);h.commit(p,'animation',[id]);h.step('undo');assert.deepEqual(h.project,before);h.step('redo');assert.deepEqual(h.project,p);
  const inherited=edit.updateAnimation(p,[{id}],{reset:'fade'});assert.equal(edit.cue(inherited,id).content.subtitle_animation,undefined);
  const locked=edit.updateTrack(p,'translation',{locked:true});assert.throws(()=>edit.updateAnimation(locked,[{id,animation:{schema:A.schema,effects:{fade}}},{id:'b',animation:{schema:A.schema,effects:{fade}}}]),/锁定/);
});
