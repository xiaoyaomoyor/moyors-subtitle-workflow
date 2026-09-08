import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context = { window: {} };
for (const file of ['msw-project.js', 'msw-audio-core.js']) vm.runInNewContext(fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'), context);
const core = context.window.MSWAudio;
const asset = { id: 'a', sample_rate: 24000, sample_count: 48000, generation: { display_text: '配音' } };
const make = (id = 'c', start = 1000) => core.create(asset, 'voice', start, id);
const extension = clips => ({ assets: [asset], audio_tracks: [{ id: 'voice', name: '配音', gain_db: 0, muted: false }], audio_clips: clips });
const json = value => JSON.parse(JSON.stringify(value));
test('clip end derives from samples and trimming never changes the asset', () => {
  const clip = make(); assert.equal(core.end(clip, asset), 3000);
  const trimmed = core.edit(clip, asset, 'start', 500);
  assert.equal(trimmed.start_ms, 1500); assert.equal(trimmed.source_in_sample, 12000); assert.equal(core.end(trimmed, asset), 3000);
  assert.equal(core.edit(clip, asset, 'end', -10000).source_out_sample, 1);
  assert.equal(core.edit(clip, asset, 'move', -2000).start_ms, 0);
  assert.equal(asset.sample_count, 48000);
});
test('overlapping clips occupy independent lanes, touching ends reuse lanes', () => {
  const clips = [make('a', 0), make('b', 1000), make('c', 2000), make('d', 4000)];
  const layout = core.arrange(clips, new Map([['a', asset]]));
  assert.equal(layout.count, 2);
  assert.notEqual(layout.lanes.get('a'), layout.lanes.get('b'));
  assert.equal(layout.lanes.get('a'), layout.lanes.get('c'));
});
test('timeline validation rejects unresolved references and invalid sample ranges', () => {
  core.validate(extension([make()]));
  for (const changes of [{ asset_id: 'absent' }, { source_out_sample: 48001 }, { source_in_sample: 48000 }, { playback_rate: 2 }, { muted: 1 }, { gain_db: Infinity }]) {
    assert.throws(() => core.validate(extension([{ ...make(), ...changes }])));
  }
});
test('enabled clips protect gaps, muted clips and follow mode do not', () => {
  const gaps = [{ start: 0, end: 6000, removed: true }], ext = extension([make()]);
  assert.deepEqual(json(core.protectGaps(gaps, ext)), [{ start: 0, end: 1000, removed: true }, { start: 3000, end: 6000, removed: true }]);
  ext.audio_clips[0].muted = true; assert.equal(core.protectGaps(gaps, ext), gaps);
  ext.audio_clips[0].muted = false; ext.audio_settings = { gap_policy: 'follow' }; assert.equal(core.protectGaps(gaps, ext), gaps);
});

test('optional audio fields reject null consistently with the server codec', () => {
  for (const key of ['audio_tracks', 'audio_clips', 'audio_settings']) assert.throws(() => core.validate({ ...extension([]), [key]: null }));
  assert.throws(() => core.validate({ ...extension([]), audio_settings: { heatmap: null } }));
  assert.throws(() => core.validate({ ...extension([]), audio_settings: { gap_policy: null } }));
});
test('scheduling after a seek resumes the correct source sample and never old audio', () => {
  const clip = { ...make(), source_in_sample: 12000, source_out_sample: 48000 };
  const plan = core.plan(clip, asset, 1500);
  assert.deepEqual(json(plan), { when: 0, offset: 1, duration: 1 });
  assert.equal(core.plan(clip, asset, 2600), null);
  assert.equal(core.plan(clip, asset, 100), null);
  assert.equal(core.plan(clip, asset, 900).when, .1);
});
test('heat colors use one fixed scale across assets', () => {
  assert.equal(core.dbColor(-120), core.dbColor(-60));
  assert.notEqual(core.dbColor(-48), core.dbColor(-12));
  assert.equal(core.dbColor(0), core.dbColor(-6));
});

function transportHarness(load = async () => new ArrayBuffer(0)) {
  const sources = [], gains = [];
  class AudioContext {
    currentTime = 0; sampleRate = 24000; state = 'running'; destination = {};
    resume() { return Promise.resolve(); }
    async decodeAudioData() { return { length: 48000, sampleRate: 24000, numberOfChannels: 1, getChannelData: () => new Float32Array(48000).fill(.25) }; }
    createBufferSource() { const node = { connect() {}, disconnect() {}, stop() {}, start(...args) { this.startArgs = args; } }; sources.push(node); return node; }
    createGain() { const node = { gain: { value: 0 }, connect() {}, disconnect() {} }; gains.push(node); return node; }
  }
  const player = Object.assign(new EventTarget(), { currentTime: 1.5, duration: 10, paused: true, ended: false, seeking: false, readyState: 4, volume: .5, muted: false, playbackRate: 1 });
  player.pause = () => { player.paused = true; player.dispatchEvent(new Event('pause')); };
  player.play = async () => { player.paused = false; player.dispatchEvent(new Event('play')); };
  const ext = extension([make()]); ext.assets[0] = { ...asset, channels: 1 };
  const state = { clips: ext.audio_clips, audible: ext.audio_clips, assets: new Map(ext.assets.map(a => [a.id, a])), tracks: new Map(ext.audio_tracks.map(t => [t.id, t])), end: 3000 };
  const window = { MSWAudio: core, AudioContext };
  vm.runInNewContext(fs.readFileSync(new URL('../web/msw-audio-transport.js', import.meta.url), 'utf8'), { window, performance, AbortController, setTimeout, clearTimeout, queueMicrotask });
  const transport = window.MSWAudioTransport.create({ player, getState: () => state, load, changed() {}, hint() {}, frame() {} });
  return { transport, player, sources, gains, asset: ext.assets[0] };
}

test('transport schedules the seek offset, applies monitor gain and releases ended node references', async () => {
  const h = transportHarness();
  try {
    await h.transport.ensure(h.asset); await h.player.play();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.sources.length, 1); assert.deepEqual(h.sources[0].startArgs, [0, .5, 1.5]);
    assert.equal(h.gains[0].gain.value, .5);
    h.player.muted = true; h.player.dispatchEvent(new Event('volumechange')); assert.equal(h.gains[0].gain.value, 0);
    h.sources[0].onended(); assert.equal(h.sources[0].onended, null);
    assert.equal(h.transport.diagnostics().active, 0);
    h.player.pause();
  } finally { h.transport.clear(); }
});

test('switching projects discards an in-flight decode and cannot fill the new cache', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; }), h = transportHarness(() => gate);
  const result = h.transport.ensure(h.asset); h.transport.clear(); finish(new ArrayBuffer(0));
  assert.equal(await result, null); assert.equal(h.transport.diagnostics().decoded, 0);
  assert.equal(h.transport.failures.size, 0);
});
