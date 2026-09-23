import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context = { window: {} };
for (const file of ['msw-project.js', 'msw-audio-core.js', 'msw-audio-render-core.js']) {
  vm.runInNewContext(fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'), context);
}
const core = context.window.MSWAudioRender;
test('overlay-only duration is exported and disabled overlay does not extend it', () => {
  const project = { segments: [], overlay_track: { enabled: true, segments: [{ start: 100, end: 2500, text: 'overlay' }] } };
  assert.equal(core.compile(project).source_end_ms, 2500);
  project.overlay_track.enabled = false;
  assert.throws(() => core.compile(project));
});
for(const c of JSON.parse(fs.readFileSync(new URL('fixtures/msw_monitor.json',import.meta.url))))test(`monitor ${c.mode} ${c.volume} ${c.muted}`,()=>{
  const monitor={mode:c.mode,volume:c.volume,muted:c.muted,source_gain_db:c.source_gain_db};
  const result=core.monitorGains({monitor,source_gain_db:2,voice_gain_db:-3});
  assert.ok(Math.abs(result.source-c.source)<1e-10);assert.ok(Math.abs(result.voice-c.voice)<1e-10);
  assert.equal(result.sourceMuted,c.silent_source);assert.equal(result.voiceMuted,c.silent_voice);
});
test('invalid monitor snapshots cannot bypass validation',()=>{
  for(const monitor of [null,{}, {mode:'both',volume:2,muted:false,source_gain_db:0}])assert.throws(()=>core.options({monitor}));
});
const videoCases = JSON.parse(fs.readFileSync(new URL('fixtures/msw_video_tail.json', import.meta.url)));
for (const c of videoCases) test(`video: ${c.name}`, () => {
  const project = {segments: c.cue_end ? [{start:0,end:c.cue_end,text:'main'}] : [],
    multi_subtitle:{tracks:[{segments:c.secondary_end ? [{start:0,end:c.secondary_end,text:'secondary'}] : []}]}};
  const options = core.videoOptions(project, {duration_ms:c.duration,end_ms:c.end??null,video_tail:c.policy||'ask'},
    {duration_ms:c.media,video:{duration_ms:c.picture}});
  const plan = core.compile(project, options);
  assert.equal(plan.source_end_ms, c.expected);
  assert.equal(options.video_tail === 'ask' && plan.source_end_ms > c.picture, !!c.overflow);
});
const fixtures = JSON.parse(fs.readFileSync(new URL('fixtures/msw_audio_render.json', import.meta.url)));
for (const fixture of fixtures) test(fixture.name, () => {
  const before = JSON.stringify(fixture.project);
  assert.deepEqual(JSON.parse(JSON.stringify(core.compile(fixture.project, fixture.options))), fixture.expected);
  assert.equal(JSON.stringify(fixture.project), before);
});
test('invalid range, gain and empty export fail before rendering', () => {
  for (const options of [{start_ms:8000}, {start_ms:-1}, {duration_ms:Infinity}, {voice_gain_db:13}, {source_audio_index:-1}, {remove_gaps:1}]) {
    assert.throws(() => core.compile(fixtures[0].project, {...fixtures[0].options, ...options}));
  }
  assert.throws(() => core.compile({segments:[]}));
});
