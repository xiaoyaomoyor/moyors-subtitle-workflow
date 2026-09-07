import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const window = { crypto: webcrypto };
const context = vm.createContext({ window });
for (const name of ['msw-project.js', 'msw-translation-core.js']) {
  vm.runInContext(readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8'), context);
}
const codec = window.MSWProject;
const core = window.MSWTranslation;
const plain = (value) => JSON.parse(JSON.stringify(value));
const cue = (id, start, end, text = id) => ({ id, start, end, text });
function project(secondary = false) {
  const data = { segments: [cue('a', 0, 2000), cue('b', 3000, 5000)] };
  codec.ensure(data, 'project-test');
  if (secondary) data.multi_subtitle = { schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
    tracks: [{ id: 'secondary', role: 'extension', segments: [cue('x', 100, 1900), cue('y', 3100, 4900), cue('z', 8000, 9000)] }],
    bindings: [{ id: 'bind-a', track_id: 'secondary', main_segment_ids: ['a'], extension_segment_ids: ['x'], start_offset_ms: 100, end_offset_ms: -100 }] };
  return data;
}
const selection = (mainIds = [], extensionIds = [], hasSelection = false) => ({ mainIds, extensionIds, trackId: 'secondary', hasSelection });
const output = (input) => ({ language: 'zh', translations: input.entries.map(({ source }) => ({ id: source.id, text: `译文 ${source.text}` })) });

test('selection maps bound secondary to main, deduplicates and ignores unbound', () => {
  const data = project(true);
  assert.deepEqual(plain(core.scope(data, ['a'], ['x', 'z'], 'secondary', true).sources.map(c => c.id)), ['a']);
  assert.equal(core.scope(data, [], ['z'], 'secondary', true).ignored, 1);
  assert.throws(() => core.snapshot(data, selection([], ['z'], true)), /没有可翻译/);
  data.segments.push(cue('blank', 10000, 11000, '  '));
  assert.equal(core.snapshot(data, selection()).entries.length, 2);
});

test('new secondary aligns with current main times and binds every translated cue', () => {
  const data = project();
  const input = core.snapshot(data, selection());
  data.segments[0].start = 200;
  const plan = core.reconcile(data, input, output(input));
  assert.deepEqual(plain(plan.multi.tracks[0].segments.map(({ start, end, text }) => [start, end, text])),
    [[200, 2000, '译文 a'], [3000, 5000, '译文 b']]);
  assert.equal(plan.multi.bindings.length, 2);
  assert.equal(data.multi_subtitle, undefined, 'planning does not mutate project');
});

test('bound and nearby unbound targets preserve their positions, IDs and other cues', () => {
  const data = project(true);
  const input = core.snapshot(data, selection());
  data.multi_subtitle.tracks[0].segments[0].start = 150;
  const plan = core.reconcile(data, input, output(input));
  const targets = plan.multi.tracks[0].segments;
  assert.deepEqual(plain(targets.map(({ id, start, end, text }) => [id, start, end, text])),
    [['x', 150, 1900, '译文 a'], ['y', 3100, 4900, '译文 b'], ['z', 8000, 9000, 'z']]);
  assert.equal(plan.multi.bindings[0].start_offset_ms, 150);
  assert.equal(plan.multi.bindings.length, 2);
});

test('concurrent source edits only conflict with affected results', () => {
  const data = project(true), input = core.snapshot(data, selection());
  data.segments[0].text = 'user edit';
  const plan = core.reconcile(data, input, output(input));
  assert.deepEqual(plain(plan.appliedIds), ['b']);
  assert.match(plan.conflicts[0].reason, /主字幕文本已修改/);
  assert.equal(plan.multi.tracks[0].segments[0].text, 'x');
});

test('target edits, removal and binding changes never overwrite current content', () => {
  for (const mutate of [
    (data) => { data.multi_subtitle.tracks[0].segments[0].text = 'user edit'; },
    (data) => { data.multi_subtitle.tracks[0].segments.shift(); },
    (data) => { data.multi_subtitle.bindings[0].extension_segment_ids = ['y']; },
    (data) => { data.multi_subtitle.bindings = []; },
  ]) {
    const data = project(true), input = core.snapshot(data, selection(['a'], [], true));
    mutate(data);
    const plan = core.reconcile(data, input, output(input));
    assert.equal(plan.appliedIds.length, 0);
    assert.equal(plan.conflicts.length, 1);
  }
});

test('unmatched overlapping cues are not moved or overwritten', () => {
  const data = project(true);
  data.multi_subtitle.tracks[0].segments[1].start = 2200;
  const input = core.snapshot(data, selection(['b'], [], true));
  assert.equal(input.entries[0].target, null);
  const plan = core.reconcile(data, input, output(input));
  assert.equal(plan.appliedIds.length, 0);
  assert.match(plan.conflicts[0].reason, /重叠/);
});

test('partial retry applies remaining IDs only and rejects changed project or track', () => {
  const data = project(true), input = core.snapshot(data, selection());
  assert.deepEqual(plain(core.reconcile(data, input, output(input), { onlyIds: ['b'] }).appliedIds), ['b']);
  data.multi_subtitle.tracks[0].id = 'other-track';
  assert.equal(core.reconcile(data, input, output(input)).conflicts.length, 2);
  data.msw.project_id = 'different-project';
  assert.throws(() => core.reconcile(data, input, output(input)), /其他工程/);
});

test('invalid result IDs, missing results and blank translations are rejected atomically', () => {
  const data = project(), input = core.snapshot(data, selection());
  for (const translations of [[], [{ id: 'missing', text: 'text' }], [{ id: 'a', text: ' ' }],
    [{ id: 'a', text: 'text' }, { id: 'a', text: 'duplicate' }]]) {
    assert.throws(() => core.reconcile(data, input, { translations }), /无效|缺少/);
    assert.equal(data.multi_subtitle, undefined);
  }
});

test('a partial application can reuse its created track but cannot accept a replacement track', () => {
  const data = project(), input = core.snapshot(data, selection());
  data.segments[0].text = 'Changed';
  const first = core.reconcile(data, input, output(input));
  data.multi_subtitle = first.multi;
  data.segments[0].text = 'a';
  const createdTrackId = first.multi.tracks[0].id;
  const second = core.reconcile(data, input, output(input), { onlyIds: ['a'], createdTrackId });
  assert.deepEqual(plain(second.appliedIds), ['a']);
  assert.equal(second.multi.tracks[0].segments.length, 2);
  data.multi_subtitle.tracks[0].id = 'replacement';
  assert.equal(core.reconcile(data, input, output(input), { onlyIds: ['a'], createdTrackId }).appliedIds.length, 0);
});

test('large projects create nonoverlapping translations without quadratic ID scans', () => {
  const data = project();
  data.segments = Array.from({ length: 10000 }, (_, i) => cue(`main-${i}`, i * 2000, i * 2000 + 1000));
  const input = core.snapshot(data, selection());
  const plan = core.reconcile(data, input, output(input));
  assert.equal(plan.appliedIds.length, 10000);
  assert.equal(plan.multi.bindings.length, 10000);
});

test('MSW namespace round trip preserves unknown fields and validates schema', () => {
  const data = project();
  data.msw.future = { assets: [{ opaque: true }] };
  data.msw.translation_applications = { job1: ['a'] };
  assert.deepEqual(plain(codec.normalize(data.msw)), plain(data.msw));
  assert.throws(() => codec.normalize({ ...data.msw, schema: 'msw.editor.v2' }), /版本不受支持/);
  assert.throws(() => codec.normalize({ ...data.msw, translation_applications: { job1: [42] } }), /格式无效/);
  assert.throws(() => codec.normalize({ ...data.msw, translation_target_tracks: { job1: 42 } }), /格式无效/);
  assert.equal(codec.validId('bad\n'), false);
  data.msw.translation_applications = { job1: ['主字幕-' + '甲'.repeat(140)] };
  data.msw.translation_target_tracks = { job1: '已有副字幕轨' };
  assert.deepEqual(plain(codec.normalize(data.msw)), plain(data.msw));
});
