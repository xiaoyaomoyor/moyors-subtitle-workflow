import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context = { window: {} };
for (const file of ['msw-project.js', 'msw-audio-core.js', 'msw-audio-render-core.js']) {
  vm.runInNewContext(fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8'), context);
}
const core = context.window.MSWAudioRender;
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
