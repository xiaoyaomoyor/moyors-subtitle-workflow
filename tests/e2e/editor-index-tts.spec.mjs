import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, openMenubarMenu, startTtsServer, openTtsEnvironment, closeTtsEnvironment} from './helpers.mjs';

let mock, origin, server, dir, audio, calls, events, modes, held, hold, errors, projectPath;
const names = ['on_example_click', 'on_experimental_change', 'refresh_preset_choices', 'on_preset_load', 'gen_single'];
const params = ['emo_control_method', 'prompt', 'text', 'lang_choice', 'emo_ref_path', 'emo_weight',
  ...Array.from({length: 8}, (_, i) => `vec${i + 1}`), 'emo_text', 'emo_random', 'max_text_tokens_per_segment',
  'duration_factor', ...Array.from({length: 8}, (_, i) => `param_${i + 18}`)];
test.beforeAll(async () => {
  mock = createServer(async (req, res) => {
    const send = (body, type = 'application/json') => { res.writeHead(200, {'Content-Type': type}); res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    const path = new URL(req.url, origin);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (path.pathname === '/config') {
      const props = Array.from({length: 26}, () => ({}));
      props[0] = {choices: modes.slice(0, 3).map(m => [m, m])}; props[3] = {choices: ['ZH', 'EN', 'JA', 'AR', 'ES']};
      props[16] = {maximum: 600}; props[25] = {maximum: 1815};
      send({api_prefix: '/gradio_api', version: '5.45.0', components: props.map((p, i) => ({id: i, props: p})),
        dependencies: names.map((name, i) => ({id: i + 10, api_name: name, inputs: name === 'gen_single' ? props.map((_, i) => i) : []}))});
    } else if (path.pathname === '/gradio_api/info') send({named_endpoints: {'/gen_single': {parameters: params.map(parameter_name => ({parameter_name}))}}});
    else if (path.pathname === '/gradio_api/upload') send(['/cache/upload.wav']);
    else if (path.pathname.startsWith('/gradio_api/file=')) send(audio, 'audio/wav');
    else if (path.pathname === '/gradio_api/queue/join') {
      const body = JSON.parse(Buffer.concat(chunks)); calls.push(body); const event_id = randomUUID();
      events.set(body.session_hash, {...body, event_id}); send({event_id});
    } else if (path.pathname === '/gradio_api/queue/data') {
      const job = events.get(path.searchParams.get('session_hash')), name = names[job.fn_index - 10];
      const file = {path: '/cache/result.wav', url: origin + '/gradio_api/file=result.wav', meta: {_type: 'gradio.FileData'}};
      const samples = [['voice_01.wav', modes[0], 'Do not copy this text', '', .65, '', ...Array(8).fill(0), 'ZH'],
        ['voice_02.wav', modes[1], 'Do not apply example emotion', 'emotion.wav', .65, '', ...Array(8).fill(0), 'EN']];
      let data;
      if (name === 'on_experimental_change') data = [{choices: modes.map(m => [m, m])}, {samples}];
      else if (name === 'refresh_preset_choices') data = [{choices: [['', ''], ['Saved voice', 'Saved voice']]}, {}];
      else if (name === 'on_example_click') { data = [...samples[job.data[0]]]; data[0] = {__type__: 'update', value: file}; data[3] = data[3] ? file : null; }
      else if (name === 'on_preset_load') data = [false, modes[2], file, null, .4, ...Array(8).fill(.1), 'Preset feeling', true, true, .8, 30, .8, 0, 3, 10, 1500, 120];
      else data = [{__type__: 'update', value: file}];
      const respond = () => { res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.end('data: ' + JSON.stringify({msg: 'process_completed', event_id: job.event_id, success: true, output: {data}}) + '\n\n'); };
      if (hold && name === 'gen_single') held.push(respond); else respond();
    } else if (path.pathname === '/gradio_api/cancel') { held.splice(0).forEach(resume => resume()); send({success: true}); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${mock.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => mock.close(resolve)); });
test.beforeEach(async ({page}, testInfo) => {
  calls = []; events = new Map(); modes = ['Follow', 'Audio', 'Vector', 'Text']; held = []; hold = false; errors = [];
  dir = makeTempDir('editor-index'); process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  delete process.env.MSW_TEST_SAVE_TARGET;
  audio = readFileSync(generateWav(join(dir, 'result.wav'), .5));
  projectPath = join(dir, 'test.mosp');
  writeFileSync(projectPath, JSON.stringify({media: '', language: 'Chinese', msw: {schema: 'msw.editor.v1', project_id: randomUUID()},
    segments: [{id: 'main-1', start: 0, end: 2000, text: '你好，这是测试。'}], waveform: generateWaveformPayload(6000),
    ...(testInfo.title.includes('dual') ? {multi_subtitle: {schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both',
      tracks: [{id: 'ext', role: 'extension', name: 'Secondary', language: 'English', split_mode: 'word', segments: [
        {id: 'secondary-1', start: 100, end: 1900, text: 'Linked secondary'}, {id: 'secondary-2', start: 3000, end: 4000, text: 'Independent secondary'}]}],
      bindings: [{id: 'link', track_id: 'ext', main_segment_ids: ['main-1'], extension_segment_ids: ['secondary-1'], start_offset_ms: 100, end_offset_ms: -100}]}} : {})}));
  server = await startTtsServer(projectPath, generateWav(join(dir, 'media.wav'), 6), await findFreePort(), origin);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await disableOnboarding(page); await page.goto(server.url); await expect(page.locator('#editor-loading')).not.toBeVisible();
  await openTtsEnvironment(page, 'indextts'); await page.locator('#tts-index-url').fill(origin);
  await closeTtsEnvironment(page); await page.locator('#tts-engine').selectOption('indextts');
});
test.afterEach(async () => { held.splice(0).forEach(resume => resume()); await server?.stop(); server = null; expect(errors).toEqual([]); });
async function panel(page) { await openMenubarMenu(page, '媒体'); await page.locator('#tts-open').click(); await expect(page.locator('#tts-model option').first()).toBeAttached(); }
async function connect(page) {
  await openTtsEnvironment(page, 'indextts');
  await page.locator('#tts-index-connection').evaluate(el => el.open = true);
  await page.locator('#tts-index-url').fill(origin); await page.locator('#tts-index-check').click();
  await expect(page.locator('#tts-index-status')).toContainText('已连接');
  await closeTtsEnvironment(page);
}
async function voice(page) {
  await connect(page); await page.locator('#tts-index-example').selectOption('0');
  await expect(page.locator('#tts-index-speaker')).toHaveValue(/^ref-/);
  await expect(page.locator('#tts-start')).toBeEnabled();
}
const generations = () => calls.filter(body => names[body.fn_index - 10] === 'gen_single').map(body => body.data);
async function range(page, id, value) { await page.locator(id).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', {bubbles: true})); }, String(value)); }

test('voice search preserves selection and synthesis layout uses paired rows', async ({page}) => {
  await voice(page);
  const identity = await page.locator('#tts-index-speaker').inputValue();
  await page.locator('#tts-index-voice-search').fill('no matching voice');
  await expect(page.locator('#tts-index-example option')).toHaveCount(1);
  await expect(page.locator('#tts-index-speaker')).toHaveValue(identity);
  await expect(page.locator('#tts-start')).toBeEnabled();
  await page.locator('#tts-index-voice-source').selectOption('local');
  await expect(page.locator('#tts-index-voice-search')).toHaveValue('');
  await expect(page.locator('#tts-index-local-voice')).toHaveValue(identity);
  for (const [left, right] of [['voice-source', 'preset'], ['emotion-mode', 'language']]) {
    const a = await page.locator(`#tts-index-${left}`).boundingBox(), b = await page.locator(`#tts-index-${right}`).boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(2); expect(b.x).toBeGreaterThan(a.x + a.width);
  }
  const speed = await page.locator('#tts-index-speed').boundingBox(), fields = await page.locator('#tts-index-controls').boundingBox();
  expect(speed.width).toBeGreaterThan(fields.width * .9);
  expect(await page.locator('#tts-index-speaker-preview').boundingBox()).not.toBeNull();
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'tts-index-layout-preview.png')});
});

for (const change of ['engine', 'media']) test(`changing ${change} discards a late reference preview`, async ({page}) => {
  await voice(page);
  let release, started;
  const began = new Promise(resolve => started = resolve), wait = new Promise(resolve => release = resolve);
  await page.route('**/api/msw/index-reference?*', async route => { started(); await wait; await route.fulfill({contentType: 'audio/wav', body: audio}); });
  const response = page.waitForResponse('**/api/msw/index-reference?*');
  await page.locator('#tts-index-speaker-preview').click(); await began;
  if (change === 'engine') await page.locator('#tts-engine').selectOption('qwen');
  else await page.locator('#player').evaluate(audio => audio.play());
  release(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#asset-player')).toBeHidden();
  await expect(page.locator('#asset-audio')).not.toHaveAttribute('src');
  expect(await page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(0);
});

test('connection capability, official reference and preview work without a cloud key', async ({page}) => {
  await expect(page.locator('#tts-qwen-fields')).toBeHidden(); await expect(page.locator('#tts-start')).toBeDisabled();
  await voice(page); await expect(page.locator('#tts-key')).toHaveValue('');
  await expect(page.locator('#tts-index-example option')).toHaveCount(3);
  await expect(page.locator('#tts-index-emotion-mode')).toHaveValue('follow');
  await page.locator('#tts-index-speaker-preview').click();
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.duration)).toBeCloseTo(.5);
  await expect(page.locator('#tts-panel audio')).toHaveCount(0);
  expect(await page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(0);
  await page.locator('#tts-start').click();
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  expect(generations()[0][2]).toContain('这是测试');
  expect(await page.evaluate(() => DATA.msw.assets[0].generation.provider)).toBe('indextts');
  expect(await page.evaluate(() => JSON.stringify(DATA))).not.toContain(origin);
  if (process.env.MSW_UI_EVIDENCE_DIR) { await page.locator('#tts-index-example').scrollIntoViewIfNeeded(); await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'index-tts-reference.png')}); }
});

test('all emotion controls, duration and advanced options reach the local API', async ({page}) => {
  await voice(page); await page.locator('#tts-index-emotion-mode').selectOption('vector');
  await range(page, '#tts-index-vector-0', .6); await range(page, '#tts-index-weight', .4); await range(page, '#tts-index-speed', 80);
  await page.locator('#tts-index-random').check(); await page.locator('#tts-index-language').selectOption('EN');
  await openTtsEnvironment(page, 'indextts'); await page.locator('#tts-index-advanced > summary').click();
  await page.locator('#tts-index-top_k').fill('0'); await page.locator('#tts-index-num_beams').fill('2');
  await closeTtsEnvironment(page);
  await page.locator('#tts-index-pronunciation').fill('Hello from IndexTTS.');
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(1);
  expect(generations()[0]).toEqual(expect.arrayContaining(['Vector', 'Hello from IndexTTS.', 'EN']));
  expect(generations()[0][6]).toBe(.6); expect(generations()[0][17]).toBe(1.25); expect(generations()[0][20]).toBe(0); expect(generations()[0][23]).toBe(2);
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  await page.locator('#tts-index-emotion-mode').selectOption('audio'); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-index-emotion-example').selectOption('1'); await expect(page.locator('#tts-start')).toBeEnabled();
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(2); expect(generations()[1][4].meta._type).toBe('gradio.FileData');
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(2);
  await page.locator('#tts-index-emotion-mode').selectOption('text'); await page.locator('#tts-index-emotion-text').fill('Warm and relaxed');
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(3); expect(generations()[2][14]).toBe('Warm and relaxed');
  if (process.env.MSW_UI_EVIDENCE_DIR) { await page.locator('#tts-index-emotion-mode').selectOption('vector'); await page.locator('#tts-index-emotion-mode').scrollIntoViewIfNeeded(); await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'index-tts-emotion.png')}); }
});

test('unloaded text model is disabled and a changed service address invalidates readiness', async ({page}) => {
  modes.pop(); await voice(page);
  await expect(page.locator('#tts-index-emotion-mode option[value="text"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#tts-index-emotion-capability')).toContainText('--qwen_emo');
  await openTtsEnvironment(page, 'indextts');
  await page.locator('#tts-index-connection').evaluate(el => el.open = true);
  await page.locator('#tts-index-url').fill('http://example.com'); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-index-check').click(); await expect(page.locator('#tts-index-status')).toContainText('本机 HTTP');
  expect(generations()).toHaveLength(0);
});

test('uploaded references and full local presets persist while server presets retain language and duration', async ({page}) => {
  await connect(page);
  await openTtsEnvironment(page, 'indextts');
  await page.locator('#tts-index-reference-file').setInputFiles(join(dir, 'result.wav'));
  await expect(page.locator('#tts-index-speaker')).toHaveValue(/^ref-/);
  await closeTtsEnvironment(page);
  await page.locator('#tts-index-language').selectOption('JA'); await range(page, '#tts-index-speed', 125);
  await openTtsEnvironment(page, 'indextts');
  await page.locator('#tts-index-presets').evaluate(el => el.open = true);
  await page.locator('#tts-index-server-preset').selectOption('Saved voice'); await page.locator('#tts-index-server-preset-load').click();
  await expect(page.locator('#tts-index-emotion-mode')).toHaveValue('vector');
  await expect(page.locator('#tts-index-language')).toHaveValue('JA'); await expect(page.locator('#tts-index-speed')).toHaveValue('125');
  await page.locator('#tts-index-preset-name').fill('旁白预设'); await page.locator('#tts-index-preset-save').click();
  await expect(page.locator('#tts-index-preset')).toHaveValue('旁白预设');
  await closeTtsEnvironment(page);
  await page.locator('#tts-save-settings').click(); await expect(page.locator('#tts-message')).toContainText('已保存');
  await page.reload(); await panel(page); await expect(page.locator('#tts-engine')).toHaveValue('indextts');
  await expect(page.locator('#tts-index-language')).toHaveValue('JA'); await expect(page.locator('#tts-index-speed')).toHaveValue('125');
  await expect(page.locator('#tts-index-speaker')).toHaveValue(/^ref-/);
});

test('cancellation stops remaining subtitles and leaves no late asset', async ({page}) => {
  hold = true; await voice(page); await page.locator('#tts-start').click();
  await expect.poll(() => generations().length).toBe(1);
  await page.locator('#tts-history').evaluate(el => el.open = true);
  await page.getByRole('button', {name: '取消任务', exact: true}).click();
  await expect(page.locator('#tts-jobs')).toContainText('已取消');
  expect(await page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(0);
  expect(generations()).toHaveLength(1);
});

test('IndexTTS audio follows the existing clip and project collection path', async ({page}) => {
  await voice(page); await page.locator('#tts-start').click(); await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  await page.locator('#tts-close').click(); await page.locator('.msw-asset-row').getByRole('button', {name: '放入时间轴', exact: true}).click();
  await expect.poll(() => page.evaluate(() => DATA.msw.audio_clips?.length || 0)).toBe(1);
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(projectPath)).msw?.assets?.length || 0).toBe(1);
  const saved = JSON.parse(readFileSync(projectPath));
  expect(existsSync(join(dir, saved.msw.assets[0].path))).toBe(true);
  expect(saved.msw.assets[0].generation.provider).toBe('indextts');
  await page.reload(); await expect(page.locator('.msw-audio-clip').first()).toBeVisible();
});

test('narrow layout keeps controls inside the scrolling panel', async ({page}) => {
  await page.setViewportSize({width: 760, height: 620}); await voice(page);
  await page.locator('#tts-index-emotion-mode').selectOption('vector');
  expect(await page.locator('#tts-panel .gap-remove-panel-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if (process.env.MSW_UI_EVIDENCE_DIR) { await page.locator('#tts-index-emotion-vector').scrollIntoViewIfNeeded(); await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'index-tts-narrow.png')}); }
});

test('dual selection keeps the existing main secondary and unbound rules', async ({page}) => {
  await connect(page); await page.locator('#tts-index-example').selectOption('0'); await expect(page.locator('#tts-index-speaker')).toHaveValue(/^ref-/);
  await expect(page.locator('#tts-target')).toHaveValue('main'); await page.locator('#tts-target').selectOption('secondary');
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(2);
  expect(generations().map(data => data[2])).toEqual(['Linked secondary', 'Independent secondary']);
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(2);
  await page.locator('#tts-close').click(); await page.locator('.multi-cue-column.extension .text').filter({hasText: /^Linked secondary$/}).click();
  await panel(page); await expect(page.locator('#tts-target')).toHaveValue('secondary'); await page.locator('#tts-target').selectOption('main');
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(3); expect(generations()[2][2]).toContain('这是测试');
});

test('a late reference response cannot replace selection after changing engine', async ({page}) => {
  await connect(page);
  let release, reached = false; const gate = new Promise(resolve => release = resolve);
  await page.route('**/api/msw/index-tts', async route => {
    if (route.request().postDataJSON()?.action === 'example') { const result = await route.fetch(); reached = true; await gate; await route.fulfill({response: result}); }
    else await route.continue();
  });
  try {
    await page.locator('#tts-index-example').selectOption('0'); await expect.poll(() => reached).toBe(true);
    await expect(page.locator('#tts-save-settings')).toBeDisabled();
    await expect(page.locator('#tts-environment-save')).toBeDisabled();
    await page.locator('#tts-engine').selectOption('qwen'); release();
    await expect(page.locator('#tts-qwen-fields')).toBeVisible(); await page.locator('#tts-engine').selectOption('indextts');
    await expect(page.locator('#tts-index-speaker')).toHaveValue(''); await expect(page.locator('#tts-start')).toBeDisabled();
  } finally { release(); }
});

test('reference and connection APIs reject missing tokens and cross site requests', async ({page}) => {
  await voice(page); const identity = await page.locator('#tts-index-speaker').inputValue();
  expect((await fetch(server.url + `api/msw/index-reference?id=${identity}`)).status).toBe(403);
  expect((await fetch(server.url + 'api/msw/index-tts')).status).toBe(403);
  const token = await page.evaluate(() => MSWE.resolve('processing-host').config.requestToken);
  expect((await fetch(server.url + 'api/msw/index-tts', {headers: {'X-MSW-Token': token, Origin: 'https://example.com'}})).status).toBe(403);
  expect((await fetch(server.url + 'api/msw/index-reference?id=..', {headers: {'X-MSW-Token': token}})).status).toBe(400);
});

test('independent text and local preset management retain references and synthesis parameters', async ({page}) => {
  await voice(page); await range(page, '#tts-index-speed', 125);
  await openTtsEnvironment(page, 'indextts'); await page.locator('#tts-index-presets > summary').click();
  await page.locator('#tts-index-preset-name').fill('Draft voice'); await page.locator('#tts-index-preset-save').click();
  await expect(page.locator('#tts-index-status')).toContainText('已保存');
  await page.locator('#tts-index-preset-manage').selectOption('Draft voice');
  await page.locator('#tts-index-preset-name').fill('Renamed voice'); await page.locator('#tts-index-preset-rename').click();
  await expect(page.locator('#tts-index-status')).toContainText('已重命名');
  await closeTtsEnvironment(page); await page.locator('#tts-index-preset').selectOption('Renamed voice');
  await page.locator('#tts-target').selectOption('editor_text'); await page.locator('#cue-panel-tts-text').fill('Direct Index speech.');
  await page.locator('#tts-start').click(); await expect.poll(() => generations().length).toBe(1);
  expect(generations()[0][2]).toBe('Direct Index speech.'); expect(generations()[0][17]).toBe(.8);
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  expect(await page.evaluate(() => DATA.msw.assets[0].source_ref.kind)).toBe('editor_text');
  await openTtsEnvironment(page, 'indextts'); await page.locator('#tts-index-preset-manage').selectOption('Renamed voice');
  page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
  await page.locator('#tts-index-preset-delete').click(); await expect(page.locator('#tts-index-status')).toContainText('已移除');
  await expect(page.locator('#tts-index-preset option')).toHaveCount(1); await expect(page.locator('#tts-index-speaker')).toHaveValue(/^ref-/);
});
