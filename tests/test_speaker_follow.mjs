import {test} from 'node:test';
import assert from 'node:assert/strict';
import core from '../web/msw-flat-subtitles.js';
import edit from '../web/msw-flat-editing.js';
import production from '../web/msw-production-project.js';

function fixture({paired=false}={}) {
  let p=core.migrate({segments:Array.from({length:6},(_,i)=>({id:'a'+i,start:i*1000,end:i*1000+800,text:'A '+i,items:[]}))});
  p.subtitles.cues.forEach((c,i)=>{c.id='a'+i;});
  const source=p.subtitles.tracks[0];
  p=core.addTrack(p,{...source,id:'other',name:'Other'});
  for(let i=0;i<6;i++) {
    p=edit.addCue(p,'other','b'+i,i*1000+100,i*1000+900,'B '+i);
    if(paired)p=core.bind(p,'a'+i,'b'+i,'pair'+i);
  }
  return p;
}
const content=(p,id)=>edit.cue(p,id).content;
const ref=(p,id)=>content(p,id).color_ref?.cue_id;

test('follow is opt-in, chronological, physical-track scoped and stops at the next explicit mark',()=>{
  let p=fixture();p.subtitles.cues.reverse();
  p=edit.setColor(p,['a4'],'blue');
  const off=edit.setColor(p,['a1'],'red');
  assert.equal(ref(off,'a2'),undefined);assert.equal(content(off,'a2').color,undefined);
  const on=edit.setColor(p,['a1'],'red',{follow:true});
  for(const id of ['a2','a3'])assert.equal(ref(on,id),'a1');
  for(const id of ['a0','a5','b1','b2'])assert.deepEqual(content(on,id),content(p,id));
  assert.equal(content(on,'a4').color.name,'blue');
  assert.equal(content(p,'a1').color,undefined);
});

test('each explicitly selected cue becomes solid; later references stop at either bound side marker',()=>{
  for(const side of ['a','b']) {
    let p=fixture({paired:true});p=edit.setColor(p,['a4'],'blue');
    const changed=edit.setColor(p,[side+'1',side+'3'],'red',{follow:true});
    for(const lane of ['a','b']){
      assert.equal(ref(changed,lane+'2'),lane+'1');
      assert.equal(content(changed,lane+'3').color.name,'red');
      assert.equal(content(changed,lane+'4').color.name,'blue');
      assert.equal(content(changed,lane+'5').color,undefined);
    }
    assert.deepEqual(changed.subtitles.bindings,p.subtitles.bindings);
  }
  // Old projects can have a direct marker only on the secondary side.
  const p=fixture({paired:true});content(p,'b3').color={name:'blue'};
  const changed=edit.setColor(p,['a1'],'red',{follow:true});
  assert.equal(ref(changed,'b2'),'b1');assert.equal(ref(changed,'a3'),undefined);assert.equal(ref(changed,'a4'),undefined);
});

test('automatic follow stops before a locked bound partner and leaves the rest of the lane intact',()=>{
  let p=fixture();p=core.bind(p,'a3','b3','locked-pair');p=edit.updateTrack(p,'other',{locked:true});
  const changed=edit.setColor(p,['a1'],'red',{follow:true});
  assert.equal(ref(changed,'a2'),'a1');
  for(const id of ['a3','a4','a5','b3'])assert.deepEqual(content(changed,id),content(p,id));
  assert.throws(()=>edit.setColor(p,['a3'],'red',{follow:true}),/锁定/);
  const referenced=edit.setColor(fixture(),['a1'],'red',{follow:true});
  const cross=core.bind(referenced,'a2','b2','pair');
  // Binding does not itself recolor or create references.
  assert.equal(content(cross,'b2').color,undefined);
});

test('independent mark preserves the current speaker on both bound sides and supports one undo',()=>{
  let p=edit.setColor(fixture({paired:true}),['a1'],'red',{follow:true});
  const history=new edit.History(p),changed=edit.independentColor(p,['b2']);
  history.commit(changed,'独立标记',['b2']);
  for(const id of ['a2','b2']){
    assert.equal(ref(changed,id),undefined);assert.equal(content(changed,id).color.name,'red');
    assert.equal(content(changed,id).color.start,content(changed,id).start);
  }
  const recolored=edit.setColor(changed,['a1'],'blue');
  for(const id of ['a2','b2'])assert.equal(content(recolored,id).color.name,'red');
  for(const id of ['a3','b3'])assert.equal(content(recolored,id).color_ref.name,'blue');
  history.step('undo');assert.deepEqual(history.project,p);history.step('redo');assert.deepEqual(history.project,changed);
  assert.throws(()=>edit.independentColor(edit.updateTrack(p,'other',{locked:true}),['a2']),/锁定/);
});

test('references survive cross-display, moved heads, reopen, split/delete and leave stickers untouched',()=>{
  let p=fixture();p=core.bind(p,'a2','b2','pair');
  content(p,'a1').sticker={name:'smile'};content(p,'a2').sticker_ref={cue_id:'a1',name:'smile'};
  p=edit.setColor(p,['a1'],'red',{follow:true});
  assert.equal(ref(p,'b2'),'a1');assert.deepEqual(content(p,'a2').sticker_ref,{cue_id:'a1',name:'smile'});
  const saved=production.toProject(production.fromProject(p));
  for(const c of p.subtitles.cues)assert.deepEqual(edit.cue(saved,c.id),c);
  const moved=edit.updateRanges(p,[{id:'a1',start:9000,end:9800}]);
  assert.equal(ref(production.toProject(production.fromProject(moved)),'a2'),'a1');
  const removed=edit.remove(p,['a1']);assert.equal(content(removed,'a2').color.name,'red');assert.equal(content(removed,'b2').color.name,'red');
  let seq=0;const split=edit.split(p,'a1',1400,{makeId:()=> 'split-'+seq++}).project;
  assert.equal(core.validate(split),true);assert.equal(content(split,'a2').color.name,'red');
  const independent=edit.independentColor(p,['b2']);assert.equal(content(independent,'a2').color.name,'red');assert.equal(content(independent,'b2').color.name,'red');
  assert.deepEqual(content(independent,'a2').sticker_ref,content(p,'a2').sticker_ref);
});

test('recoloring cannot indirectly modify a locked follower',()=>{
  let p=fixture();p=core.bind(p,'a2','b2','pair');p=edit.setColor(p,['a1'],'red',{follow:true});
  p=edit.updateTrack(p,'other',{locked:true});const before=structuredClone(p);
  assert.throws(()=>edit.setColor(p,['a1'],'blue'),/锁定/);assert.deepEqual(p,before);
});
