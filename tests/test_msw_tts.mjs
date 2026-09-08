import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context = { window: {} };
for (const file of ['msw-project.js', 'msw-tts-core.js']) vm.runInNewContext(fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'), context);
const core = context.window.MSWTts;
const main = [{id:'a',text:'Main',start:0,end:1000},{id:'b',text:'Independent main',start:2000,end:3000}];
const secondary = [{id:'x',text:'Secondary',start:100,end:900},{id:'y',text:'Independent secondary',start:4000,end:5000}];
const project = {segments:main,msw:{schema:'msw.editor.v1',project_id:'project'},multi_subtitle:{tracks:[{id:'ext',segments:secondary}],
  bindings:[{id:'link',track_id:'ext',main_segment_ids:['a'],extension_segment_ids:['x']} ]}};
const selection = (m=[], e=[], hasSelection=true) => ({mainIds:m,extensionIds:e,trackId:'ext',hasSelection});
const texts = scope => Array.from(scope.sources, row=>row.cue.text);
test('no selection with two tracks requires explicit target',()=>{
  assert.equal(core.scope(project,selection([],[],false)).needsChoice,true);
  assert.throws(()=>core.snapshot(project,selection([],[],false)),/选择/);
  assert.deepEqual(texts(core.scope(project,selection([],[],false),'main')),main.map(c=>c.text));
  assert.deepEqual(texts(core.scope(project,selection([],[],false),'secondary')),secondary.map(c=>c.text));
});
test('both sides of linked selection synthesize one side once',()=>{
  assert.equal(core.scope(project,selection(['a'],['x'])).needsChoice,true);
  assert.deepEqual(texts(core.scope(project,selection(['a'],['x']),'secondary')),['Secondary']);
  assert.deepEqual(texts(core.scope(project,selection([],['x']),'main')),['Main']);
});
test('mixed independent selection survives either linked target',()=>{
  assert.deepEqual(texts(core.scope(project,selection(['a','b'],['x','y']),'secondary')),['Secondary','Independent main','Independent secondary']);
  assert.deepEqual(texts(core.scope(project,selection(['a','b'],['x','y']),'main')),['Main','Independent main','Independent secondary']);
});
test('unbound secondary stays secondary, stale selection never falls back to all',()=>{
  assert.equal(core.scope(project,selection([],['y'])).needsChoice,false);
  assert.deepEqual(texts(core.scope(project,selection([],['y']))),['Independent secondary']);
  assert.throws(()=>core.snapshot(project,selection(['gone'])),/没有可合成/);
});
test('single track full batch and immutable unicode snapshot, limits checked before submit',()=>{
  const p=structuredClone(project); delete p.multi_subtitle;
  p.segments[0].text='😀'.repeat(600);
  const result=core.snapshot(p,selection([],[],false));
  p.segments[0].text='changed';
  assert.equal(result.entries[0].text,'😀'.repeat(600));
  p.segments[0].text='字'.repeat(601);
  assert.throws(()=>core.snapshot(p,selection([],[],false)),/600/);
});
