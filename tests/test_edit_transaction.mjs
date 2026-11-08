import test from 'node:test';
import assert from 'node:assert/strict';
import tx from '../web/msw-edit-transaction.js';
import tracks from '../web/msw-subtitle-tracks.js';
import flat from '../web/msw-flat-subtitles.js';
import bridge from '../web/msw-production-project.js';

test('saving dirty flags does not invalidate structural undo or redo',()=>{
  const before={segments:[{id:'a',text:'AB'}]},after={segments:[{id:'a-1',text:'A',_dirty:true},{id:'a-2',text:'B',_dirty:true}],_dirty:true};
  const patch=tx.diff(before,after),saved=structuredClone(after);
  delete saved._dirty;saved.segments.forEach(c=>delete c._dirty);
  assert.deepEqual(tx.apply(saved,patch,false),before);
  assert.deepEqual(tx.apply(before,patch),after);
  saved.segments[1].text='external';
  assert.throws(()=>tx.apply(saved,patch,false),/已改变/);
  assert.equal(saved.segments[0].text,'A');
  assert.equal(tx.equal({_dirty:true},{text:'external'},true),false);
  assert.equal(tx.equal({text:'external'},{_dirty:true},true),false);
});

test('delta is reversible, isolated and retains unchanged rows',()=>{
  const before={segments:[{id:'a',start:0,end:100,text:'A'},{id:'b',start:100,end:200,text:'B'}],meta:{name:'x'}};
  const after=structuredClone(before);after.segments[0].text='changed';after.segments.push({id:'c',start:200,end:300,text:'C'});
  const patch=tx.diff(before,after), result=tx.apply(before,patch);
  assert.deepEqual(result,after);assert.equal(result.segments[1],before.segments[1]);
  assert.deepEqual(tx.apply(result,patch,false),before);
  assert.deepEqual([...tx.changedCues(patch)],['a','c']);
  after.segments[0].text='later';assert.equal(result.segments[0].text,'changed');
  assert.equal(tx.diff(before,structuredClone(before)),null);
});
test('stale delta fails atomically and unrelated field changes survive undo',()=>{
  const before={segments:[{id:'a',text:'A',disabled:false}]}, after=structuredClone(before);after.segments[0].text='B';
  const patch=tx.diff(before,after), live=structuredClone(after);live.segments[0].disabled=true;
  assert.deepEqual(tx.apply(live,patch,false),{segments:[{id:'a',text:'A',disabled:true}]});
  live.segments[0].text='C';assert.throws(()=>tx.apply(live,patch,false),/已改变/);assert.equal(live.segments[0].text,'C');
});
test('JSON metadata keys cannot alter object prototypes',()=>{
  const before={metadata:{}},after=JSON.parse('{"metadata":{"__proto__":{"tag":"data"}}}');
  const result=tx.apply(before,tx.diff(before,after));
  assert.deepEqual(result,after);assert.equal(Object.getPrototypeOf(result.metadata),Object.prototype);
  assert.equal({}.tag,undefined);assert.deepEqual(tx.apply(result,tx.diff(before,after),false),before);
});

test('absent optional fields and undefined checkpoints represent the same saved data',()=>{
  const before={multi_subtitle:{tracks:[{id:'s1',segments:[]}]}};
  const after=structuredClone(before);after.multi_subtitle._dirty=undefined;after.multi_subtitle.tracks[0]._dirty=undefined;
  assert.equal(tx.diff(before,after),null);assert.equal(tx.equal(before,after),true);assert.equal(tx.equal(after,before),true);
  assert.equal(tx.equal({a:undefined},{b:1}),false);assert.equal(tx.equal({a:1},{b:undefined}),false);
  assert.equal(tx.equal({a:null},{}),false);assert.equal(tx.equal({a:undefined},{b:undefined}),true);
});
test('insert/delete/reorder and numeric marker references round trip together',()=>{
  const a={id:'a',start:0,end:100,text:'A',color:{name:'red'}}, b={id:'b',start:100,end:200,text:'B',color_ref:{headIdx:0}};
  const before={segments:[a,b],assignments:[{role:'main',track_id:null,cue_id:'a',subtitle_track_id:'s1'}]};
  const after={segments:[{id:'x',start:0,end:50,text:'X'},a,{...b,color_ref:{headIdx:1}}],assignments:[{...before.assignments[0],subtitle_track_id:'s2'}]};
  const patch=tx.diff(before,after);assert.deepEqual(tx.apply(before,patch),after);assert.deepEqual(tx.apply(after,patch,false),before);
  const reordered={...before,segments:[b,a]};assert.deepEqual(tx.apply(before,tx.diff(before,reordered)),reordered);
  assert.throws(()=>tx.apply(reordered,patch),/顺序/);
});
const fixture=()=>tracks.migrate({segments:[{id:'a',start:0,end:100,text:'A',color:{name:'red',value:'#ff0000',start:0,end:300}},{id:'b',start:200,end:300,text:'B',color_ref:{headIdx:0}}],
  multi_subtitle:{enabled:true,tracks:[{id:'zh',role:'extension',segments:[{id:'z',start:0,end:100,text:'中'}]}],
    bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['z'],start_offset_ms:0,end_offset_ms:0}]}});
test('shared index resolves binding both ways, chronological lanes and marker dependents',()=>{
  const p=fixture();delete p.segments[1].color;p.segments[1].color_ref={headIdx:0};
  const i=tracks.createIndex(p),ref={role:'main',track_id:null,cue_id:'a'};
  assert.deepEqual(new Set(i.boundRefs([ref]).map(r=>r.cue_id)),new Set(['a','z']));
  assert.equal(i.bindings.get(tracks.key(ref))[0].id,'pair');
  assert.equal(i.dependents.get(tracks.key(ref)).has(tracks.key({...ref,cue_id:'b'})),true);
  const next=structuredClone(p);next.segments[1].text='new';
  assert.equal(tracks.createIndex(next).resolve({...ref,cue_id:'b'}).cue.text,'new');
  assert.equal(i.resolve({...ref,cue_id:'b'}).cue.text,'B');
});
test('locked validation handles distinct candidates and rejects receiving new cues',()=>{
  const p=fixture();p.subtitle_tracks.tracks[0].locked=true;
  assert.doesNotThrow(()=>tracks.assertLocks(p,structuredClone(p)));
  const changed=structuredClone(p);changed.segments[0].text='changed';assert.throws(()=>tracks.assertLocks(p,changed),/锁定/);
  const linked=structuredClone(p);linked.multi_subtitle.bindings=[];assert.throws(()=>tracks.assertLocks(p,linked),/绑定/);
  const extra=structuredClone(p);extra.segments.push({id:'new',start:400,end:500,text:'new'});
  extra.subtitle_tracks.assignments.push({...extra.subtitle_tracks.assignments[0],cue_id:'new'});
  assert.throws(()=>tracks.assertLocks(p,extra),/锁定/);
});
test('indexed pointer checks match full checks for conflicts, binding ownership and repeated moves',()=>{
  const p=bridge.fromProject(flat.migrate({segments:[{id:'a',start:1000,end:2000,text:'A'},{id:'b',start:3000,end:4000,text:'B'}]}));
  const index=tracks.createIndex(p),a=p.segments[0],owner=index.byId.get(a.id).subtitle_track_id;
  p.subtitle_tracks.tracks.push({...p.subtitle_tracks.tracks[0],id:'empty',name:'empty'});
  const fullIndex=tracks.createIndex(p);
  for(const [start,end,target] of [[1100,2100,owner],[2500,3500,owner],[0,1000,owner],[500,4500,'empty'],[-1,50,'empty'],[1500,1500,owner]]) {
    const changes=new Map([[a.id,{...a,start,end}]]),owners=new Map([[a.id,target]]);
    const check=index=>{try {tracks.validateTimingChanges(p,changes,owners,index);return true;}catch{return false;}};
    assert.equal(check(fullIndex),check(null),`${start}/${end}/${target}`);
  }
  // The live moving row can change; the transaction's lane membership is stable.
  a.start=4500;a.end=5500;
  assert.doesNotThrow(()=>tracks.validateTimingChanges(p,new Map([[a.id,{...a,start:1000,end:2000}]]),new Map([[a.id,owner]]),fullIndex));
});
test('ten thousand rows store changed content rather than complete subtitle snapshots',()=>{
  const before={segments:Array.from({length:10000},(_,i)=>({id:'cue-'+i,start:i*100,end:i*100+90,text:'same content '.repeat(20),items:[]}))};
  const after=structuredClone(before);after.segments[5000].text='edited';
  const patch=tx.diff(before,after);
  assert.ok(JSON.stringify(patch).length<1000);
  assert.deepEqual(tx.apply(tx.apply(before,patch),patch,false),before);
});

test('dirty-only changes survive history without requesting full card rebuilds',()=>{
  const before={segments:[{id:'a',text:'one'},{id:'b',text:'two'}]};
  const after=structuredClone(before);after.segments.forEach(c=>c._dirty=true);after.segments[0].text='changed';
  const patch=tx.diff(before,after);
  assert.deepEqual([...tx.renderChanges(patch)],['a']);
  assert.deepEqual(tx.apply(before,patch),after);assert.deepEqual(tx.apply(after,patch,false),before);
});
