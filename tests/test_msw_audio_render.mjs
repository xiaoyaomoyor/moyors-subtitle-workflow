import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context = { window: {} };
for (const file of ['msw-project.js', 'msw-audio-core.js', 'msw-audio-render-core.js']) {
  vm.runInNewContext(fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'), context);
}
const core = context.window.MSWAudioRender;
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
