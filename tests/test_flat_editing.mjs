import {test} from 'node:test';
import assert from 'node:assert/strict';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import tracks from '../web/msw-subtitle-tracks.js';

const base=()=>{
  let p=core.migrate({segments:[{id:'a',start:0,end:2000,text:'hello world',items:[{start:0,end:1000,text:'hello '},{start:1000,end:2000,text:'world'}]}]});
  p=core.addTrack(p,{...p.subtitles.tracks[0],id:'translation',name:'译文'});
  p=edit.addCue(p,'translation','b',0,2000,'你好世界');
  return core.bind(p,p.subtitles.cues[0].id,'b','binding');
};
let seq=0;const makeId=kind=>`${kind}-${++seq}`;
test('linked split and merge are atomic, preserve IDs of unaffected cues and bindings',()=>{
  const p=base(),before=JSON.stringify(p),id=p.subtitles.cues[0].id;
  const split=edit.split(p,id,1000,{makeId});
  assert.equal(JSON.stringify(p),before);
  assert.equal(split.project.subtitles.bindings.length,2);
  assert.deepEqual(split.project.subtitles.cues.map(c=>c.content.text),['hello ','world','你好','世界']);
  const merged=edit.merge(split.project,split.ids.slice(0,2),{makeId});
  assert.equal(merged.project.subtitles.bindings.length,1);
  assert.equal(merged.project.subtitles.cues.length,2);
  assert.equal(core.validate(merged.project),true);
});
test('independent split works from either side and unbinds; locked partner prevents changes',()=>{
  const p=base(),id=p.subtitles.cues[0].id;
  const out=edit.split(p,'b',1000,{independent:true,makeId});
  assert.deepEqual(out.project.subtitles.cues.find(c=>c.id===id),p.subtitles.cues[0]);
  assert.equal(out.project.subtitles.bindings.length,0);
  const locked=edit.updateTrack(p,'translation',{locked:true});
  assert.throws(()=>edit.split(locked,id,1000,{makeId}),/锁定/);
});
test('moving linked captions keeps offsets and word timings, collisions reject whole transaction',()=>{
  let p=base(),id=p.subtitles.cues[0].id;
  p=edit.updateRanges(p,[{id,start:1000,end:3000}]);
  assert.equal(edit.cue(p,'b').content.start,1000);
  assert.equal(edit.cue(p,id).content.items[0].start,1000);
  p=edit.addCue(p,'translation','block',3500,4500,'collision');
  assert.throws(()=>edit.updateRanges(p,[{id,start:2500,end:4500}]),/重叠/);
  assert.equal(edit.cue(p,id).content.start,1000);
});
test('marker references materialize on deleting a head and survive split/merge',()=>{
  let p=base(),id=p.subtitles.cues[0].id;
  p=edit.transaction(p,n=>{edit.cue(n,id).content.color={name:'red',start:0,end:2000};edit.cue(n,'b').content.color_ref={cue_id:id,name:'red'};});
  const removed=edit.remove(p,[id]);assert.equal(edit.cue(removed,'b').content.color.name,'red');
  assert.equal(edit.cue(removed,'b').content.color_ref,undefined);
  const split=edit.split(p,id,1000,{makeId});
  assert.ok(split.project.subtitles.cues.every(c=>c.content.color.name==='red'));
});
test('common and union merge states and preserve unrelated metadata',()=>{
  let p=base();const id=p.subtitles.cues[0].id;
  p=core.unbind(p,'binding');p=edit.addCue(p,edit.cue(p,id).track_id,'second',2000,3000,'again');
  p=edit.transaction(p,n=>{edit.cue(n,id).content.disabled=true;edit.cue(n,id).content.color={name:'red'};n.custom={keep:1};});
  for(const mode of ['union','common']){
    const result=edit.merge(p,[id,'second'],{mode,makeId}).project;
    const c=result.subtitles.cues.find(c=>c.id!=='b').content;
    assert.equal(c.disabled,mode==='union');
    assert.equal(!!c.color,mode==='union');assert.deepEqual(result.custom,{keep:1});
  }
});
test('disposable waveform view validates and cannot mutate canonical data; undo is one transaction',()=>{
  const p=base(),view=edit.editorView(p);assert.equal(tracks.validate(view),true);
  assert.equal(view.segments.length,2);assert.equal(view.multi_subtitle.enabled,false);
  view.segments[0].text='changed';assert.notEqual(p.subtitles.cues[0].content.text,'changed');
  const history=new edit.History(p),out=edit.split(p,'b',1000,{makeId});
  history.commit(out.project,'切分',['b']);assert.deepEqual(history.step('undo',out.ids),['b']);
  assert.deepEqual(history.project,p);history.step('redo');assert.deepEqual(history.project,out.project);
});
test('unicode split never cuts surrogate pairs and trim removes stale word timing',()=>{
  let p=base();p=edit.updateText(p,'b','A😀中');
  const out=edit.split(p,'b',1000,{independent:true,positions:{b:2},makeId});
  assert.equal(out.project.subtitles.cues.filter(c=>c.id!=='b'&&c.track_id==='translation').map(c=>c.content.text).join(''),'A😀中');
  assert.equal(edit.cue(edit.updateText(p,p.subtitles.cues[0].id,'changed'),p.subtitles.cues[0].id).content.items.length,0);
});
test('frame projections stay consistent after move and linked split',()=>{
  let p=base();p=edit.transaction(p,n=>{n.timebase={unit:'frames',fps:25};for(const c of n.subtitles.cues)edit.frame(n,c.content);});
  const id=p.subtitles.cues[0].id,out=edit.updateRanges(p,[{id,start:400,end:2400}]);
  assert.equal(edit.cue(out,id).content.start_frame,10);assert.equal(edit.cue(out,'b').content.end_frame,60);
  const halves=edit.split(out,id,1400,{makeId}).project;
  assert.ok(halves.subtitles.cues.every(c=>c.content.start_frame===Math.round(c.content.start/40)));
  assert.equal(core.validate(halves),true);
});
test('color edits detach external references and do not recolor unselected captions',()=>{
  let p=base(),id=p.subtitles.cues[0].id;p=edit.transaction(p,n=>{edit.cue(n,id).content.color={name:'red'};edit.cue(n,'b').content.color_ref={cue_id:id,name:'red'};});
  const changed=edit.setColor(p,[id],'blue');assert.equal(edit.cue(changed,'b').content.color.name,'red');assert.equal(edit.cue(changed,id).content.color.name,'blue');
  assert.equal(edit.cue(edit.setColor(changed,[id],null),id).content.color,undefined);
});
test('merge honors per-track separators and refuses inconsistent relation direction',()=>{
  let p=base(),first=p.subtitles.cues[0];p=edit.addCue(p,first.track_id,'next',2000,3000,'again');p=edit.addCue(p,'translation','next-zh',2000,3000,'再见');
  p=core.bind(p,'next','next-zh','next-pair');
  const result=edit.merge(p,[first.id,'next'],{makeId,joinText:rows=>rows.map(c=>c.text).join('|')}).project;
  assert.equal(result.subtitles.cues.find(c=>c.track_id===first.track_id).content.text,'hello world|again');
  const reversed=core.bind(core.unbind(p,'next-pair'),'next-zh','next','reverse');assert.throws(()=>edit.merge(reversed,[first.id,'next'],{makeId}),/来源方向/);
});
test('track operations preserve independent ownership, lock checks and stable IDs',()=>{
  let p=base();p=core.addTrack(p,{...p.subtitles.tracks[0],id:'extra',name:'画面文字',purpose:'annotation'});
  const moved=core.move(p,['b'],'extra');assert.equal(edit.cue(moved,'b').track_id,'extra');assert.deepEqual(moved.subtitles.bindings,p.subtitles.bindings);
  const reordered=edit.reorder(moved,'extra',-1);assert.equal(reordered.subtitles.tracks[1].id,'extra');
  assert.throws(()=>edit.deleteTrack(reordered,'extra'),/请先移动/);
  const locked=edit.updateTrack(moved,'extra',{locked:true});assert.throws(()=>edit.remove(locked,[p.subtitles.cues[0].id]),/锁定/);
  assert.throws(()=>core.move(locked,['b'],p.subtitles.tracks[0].id),/锁定/);
});
