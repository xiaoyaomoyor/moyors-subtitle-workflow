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

test('asset removal records survive project round trips and reject invalid or contradictory inventory', () => {
  const codec = context.window.MSWProject, id = 'audio-' + 'a'.repeat(32);
  const extension = {schema: 'msw.editor.v1', project_id: 'p', removed_asset_ids: [id]};
  assert.deepEqual(JSON.parse(JSON.stringify(codec.normalize(extension))), extension);
  for (const value of [null, {}, ['../bad'], [id, id]]) {
    assert.throws(() => codec.normalize({...extension, removed_asset_ids: value}));
  }
  const asset = {id, kind: 'audio', path: 'msw-' + 'b'.repeat(24) + `.assets/audio/${id}.wav`, sha256: 'c'.repeat(64),
    sample_rate: 8000, channels: 1, sample_count: 800, byte_size: 1644, job_id: 'import-test',
    generation: {provider: 'imported', model: 'external-audio', voice: '', language_type: 'Auto', display_text: '文件名', spoken_text: ''},
    source_ref: {key: 'import-test', id: 'import-test', track_id: null, start: 0, end: 100, text: '文件名'}};
  assert.throws(() => codec.normalize({...extension, assets: [asset]}), /同时存在/);
  assert.equal(codec.normalize({...extension, removed_asset_ids: [], assets: [asset]}).assets[0].generation.provider, 'imported');
});

test('local generated pronunciation and optional override survive project validation', () => {
  const id = 'audio-' + 'a'.repeat(32);
  const asset = {id, kind: 'audio', path: 'msw-' + 'b'.repeat(24) + `.assets/audio/${id}.wav`, sha256: 'c'.repeat(64),
    sample_rate: 8000, channels: 1, sample_count: 8000, byte_size: 16044, job_id: 'job-local',
    generation: {provider: 'yukkuri', model: 'aquestalk1', voice: 'f1', language_type: 'Auto', speed: 100,
      display_text: '重庆', spoken_text: 'カ'.repeat(3000), engine_version: 'aquestalk.js@1.0.7'},
    source_ref: {key: 'source', id: 'cue', track_id: 'ext', start: 0, end: 1000, text: '重庆', pronunciation_override: '虫庆'}};
  const extension = {schema: 'msw.editor.v1', project_id: 'p', assets: [asset]};
  const codec = context.window.MSWProject;
  assert.equal(codec.normalize(extension).assets[0].generation.spoken_text.length, 3000);
  for (const value of [null, 123, '字'.repeat(601)]) {
    asset.source_ref.pronunciation_override = value;
    assert.throws(() => codec.normalize(extension));
  }
  delete asset.source_ref.pronunciation_override;
  assert.equal(codec.normalize(extension).assets[0].generation.provider, 'yukkuri');
  asset.generation.spoken_text = 'カ'.repeat(12001);
  assert.throws(() => codec.normalize(extension));
});
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
