import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import core from '../web/msw-subtitle-tracks.js';
import layers from '../web/msw-subtitle-layers.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const fixtures = [...fixture('subtitle-layers'), ...fixture('subtitle-tracks'),
  { name: 'assets-and-provenance', project: fixture('msw_beta1_legacy_project') }];
const ref = (cue_id, role = 'main', track_id = null) => ({ role, track_id, cue_id });

for (const f of fixtures) test(`fixed tracks migrate without changing v2 content: ${f.name}`, () => {
  const original = structuredClone(f.project), baseline = layers.migrate(f.project);
  const result = core.migrate(f.project);
  assert.deepEqual(f.project, original);
  assert.equal(core.validate(result), true);
  const { subtitle_tracks, ...content } = result;
  assert.deepEqual({ ...content, schema: layers.SCHEMA }, baseline);
  assert.deepEqual(core.migrate(result), result);
  assert.equal(subtitle_tracks.assignments.length, core.createIndex(result).records({ includeHidden: true }).length);
});

test('binding groups preserve offsets, ownership is stable across sort and time changes', () => {
  const p = core.migrate(fixture('subtitle-tracks')[0].project);
  const index = core.createIndex(p);
  assert.notEqual(index.trackFor(ref('a')).id, index.trackFor(ref('b')).id);
  for (const id of ['a', 'b']) assert.equal(index.trackFor(ref(id)).id, index.trackFor(ref(id, 'extension', 'zh')).id);
  const before = structuredClone(p.subtitle_tracks);
  p.segments.reverse();
  p.segments.find(c => c.id === 'c').end++;
  p.subtitle_tracks.tracks.reverse();
  assert.equal(core.createIndex(p).resolve(ref('a')).cue.start, 1001);
  assert.deepEqual(p.subtitle_tracks.assignments, before.assignments);
  assert.equal(core.createIndex(p).records({ includeDisabled: false }).some(r => r.cue_id === 'b' && r.role === 'main'), false);
});

test('migration uses actual member intervals instead of bound envelope, keeps global preview state', () => {
  const p = core.migrate(fixture('subtitle-tracks')[2].project);
  assert.equal(p.subtitle_tracks.tracks.length, 1);
  assert.equal(p.multi_subtitle.enabled, false);
  assert.deepEqual(p.multi_subtitle.bindings, fixture('subtitle-tracks')[2].project.multi_subtitle.bindings);
});

test('hidden legacy group remains hidden without hiding its explicitly bound visible translation', () => {
  const p = core.migrate(fixture('subtitle-tracks')[1].project), index = core.createIndex(p);
  assert.deepEqual(index.records().map(r => r.cue_id), ['translated']);
  assert.equal(index.trackFor(ref('hidden-alone')).enabled, false);
  assert.equal(index.trackFor(ref('hidden')).id, index.trackFor(ref('translated', 'extension', 'sub')).id);
});

test('assignment moves binding together, retains identity and rejects collision or locks atomically', () => {
  const p = core.migrate(fixture('subtitle-tracks')[0].project), before = structuredClone(p);
  p.subtitle_tracks.tracks.push({ ...p.subtitle_tracks.tracks[0], id: 'new', name: '画面文字', kind: 'annotation' });
  const moved = core.assign(p, [ref('a', 'extension', 'zh')], 'new');
  assert.equal(core.createIndex(moved).trackFor(ref('a')).id, 'new');
  assert.deepEqual(moved.segments, before.segments);
  assert.deepEqual(moved.multi_subtitle, before.multi_subtitle);
  const destination = core.createIndex(p).trackFor(ref('b')).id;
  assert.throws(() => core.assign(p, [ref('a')], destination), /重叠/);
  assert.deepEqual(p.subtitle_tracks.assignments, before.subtitle_tracks.assignments);
  p.subtitle_tracks.tracks.find(t => t.id === core.createIndex(p).trackFor(ref('a')).id).locked = true;
  assert.throws(() => core.assign(p, [ref('a', 'extension', 'zh')], 'new'), /锁定/);
});

for (const [name, change] of Object.entries({
  'missing owner': p => p.subtitle_tracks.assignments.pop(),
  'duplicate owner': p => p.subtitle_tracks.assignments.push(p.subtitle_tracks.assignments[0]),
  'unknown cue': p => p.subtitle_tracks.assignments[0].cue_id = 'missing',
  'unknown track': p => p.subtitle_tracks.assignments[0].subtitle_track_id = 'missing',
  'unknown version': p => p.schema = 'msw.project.v4',
  'unknown metadata version': p => p.subtitle_tracks.schema = 'msw.subtitle_tracks.v2',
  'duplicate track': p => p.subtitle_tracks.tracks.push(p.subtitle_tracks.tracks[0]),
  'wrong boolean': p => p.subtitle_tracks.tracks[0].locked = 1,
  'unsupported style': p => p.subtitle_tracks.tracks[0].style = { mode: 'preset', id: 'future' },
  'broken pair': p => p.multi_subtitle.bindings[0].main_segment_ids = ['missing'],
  'wrong offset': p => p.multi_subtitle.bindings[0].start_offset_ms++,
  'split ownership': p => p.subtitle_tracks.assignments[0].subtitle_track_id = p.subtitle_tracks.tracks[1].id,
  'collision': p => { for (const a of p.subtitle_tracks.assignments) a.subtitle_track_id = p.subtitle_tracks.tracks[0].id; },
})) test(`reject invalid fixed-track project: ${name}`, () => {
  const p = core.migrate(fixture('subtitle-tracks')[0].project); change(p);
  assert.throws(() => core.validate(p));
});

test('legacy schema with reserved metadata cannot overwrite ownership and old layer reader rejects v3', () => {
  assert.throws(() => core.migrate({ segments: [], subtitle_tracks: {} }), /无法安全覆盖/);
  assert.throws(() => layers.migrate(core.migrate({ segments: [] })), /Unsupported/);
});

test('ten thousand overlapping subtitles retain all stable memberships', () => {
  const segments = Array.from({ length: 10000 }, (_, i) => ({ id: `c${i}`, start: Math.floor(i / 8) * 1000, end: Math.floor(i / 8) * 1000 + 1000, text: 'x' }));
  const p = core.migrate({ segments });
  assert.equal(p.subtitle_tracks.tracks.length, 8);
  assert.equal(core.createIndex(p).records().length, 10000);
});

test('v1 migration retains overlay name/settings and fills only missing language IDs', () => {
  const source = { segments: [{ id: 'a', start: 0, end: 1000, text: 'a' }],
    overlay_track: { name: '旧注释组', enabled: false, settings: { x: 0.2 }, segments: [{ id: 'note', start: 0, end: 1000, text: 'note' }] },
    multi_subtitle: { tracks: [{ segments: [{ id: 'translated', start: 20, end: 1020, text: 'sub' }] }],
      bindings: [{ main_segment_id: 'a', extension_segment_id: 'translated' }] } };
  const before = structuredClone(source), p = core.migrate(source);
  assert.equal(p.multi_subtitle.tracks[0].id, 'extension-001');
  assert.deepEqual(p.subtitle_tracks.legacy_overlay_settings, { name: '旧注释组', enabled: false, settings: { x: 0.2 } });
  assert.equal(core.createIndex(p).trackFor(ref('note')).name, '旧注释组 1');
  assert.equal(core.createIndex(p).trackFor(ref('note')).enabled, false);
  assert.deepEqual(source, before);
});
