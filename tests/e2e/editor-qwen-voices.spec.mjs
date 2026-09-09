import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir, openMenubarMenu, startTtsServer, openTtsEnvironment, closeTtsEnvironment} from './helpers.mjs';

let mock, server, dir, origin, calls, resultAudio, held, hold, pageErrors;
test.beforeAll(async () => {
  mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    const respond = () => {
      if (body.customization) {
        const name = body.customization.model === 'qwen-voice-design' ? 'designed' : 'cloned';
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({output: {voice: `qwen-${name}-${body.customization.input.preferred_name}`,
          ...(name === 'designed' ? {preview_audio: {data: resultAudio.toString('base64')}} : {})}}));
      } else { res.writeHead(200, {'Content-Type': 'audio/wav'}); res.end(resultAudio); }
    };
    if (hold && body.customization) held.push(respond); else respond();
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${mock.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => mock.close(resolve)); });
test.beforeEach(async ({page}) => {
  calls = []; held = []; hold = false; pageErrors = []; dir = makeTempDir('qwen-voices');
  page.on('pageerror', error => pageErrors.push(error.message));
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  delete process.env.MSW_TEST_SAVE_TARGET;
  resultAudio = readFileSync(generateWav(join(dir, 'result.wav'), .5));
  const project = {media: '', language: 'Chinese', msw: {schema: 'msw.editor.v1', project_id: randomUUID()},
    segments: [{id: 'main-1', start: 0, end: 2000, text: '你好，Hello world.'}], waveform: generateWaveformPayload(6000)};
  const path = join(dir, 'test.mosp'); writeFileSync(path, JSON.stringify(project));
  server = await startTtsServer(path, generateWav(join(dir, 'media.wav'), 6), await findFreePort(), origin);
  await disableOnboarding(page);
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.goto(server.url); await expect(page.locator('#editor-loading')).not.toBeVisible();
  await openPanel(page);
  await openTtsEnvironment(page);
  await page.locator('#tts-key').fill('synthetic-browser-key');
  await page.locator('#tts-environment-save').click();
  await expect(page.locator('#tts-environment-message')).toContainText('已保存');
  await closeTtsEnvironment(page);
});
test.afterEach(async () => { for (const resume of held.splice(0)) resume(); await server?.stop(); server = null; expect(pageErrors).toEqual([]); });
test('official voice audition uses the library without synthesis or saved assets', async ({page}) => {
  await page.route('https://help-static-aliyun-doc.aliyuncs.com/**', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), resultAudio.length - 1) : resultAudio.length - 1;
    return route.fulfill({status: range ? 206 : 200, contentType: 'audio/wav', body: resultAudio.subarray(start, end + 1),
      headers: {'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        ...(range ? {'Content-Range': `bytes ${start}-${end}/${resultAudio.length}`} : {})}});
  });
  await expect(page.locator('#tts-voice-audition')).toBeEnabled();
  await page.locator('#tts-voice-audition').click();
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.duration)).toBeCloseTo(.5);
  await page.locator('#asset-audio').evaluate(audio => { audio.pause(); audio.currentTime = .2; });
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.currentTime)).toBeCloseTo(.2);
  expect(calls).toHaveLength(0);
  expect(await page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(0);
  await page.locator('#tts-voice-select').selectOption('Ethan');
  await expect(page.locator('#asset-player')).toBeHidden();
});
async function openPanel(page) {
  await openMenubarMenu(page, '媒体'); await page.locator('#tts-open').click();
  await expect(page.locator('#tts-model option').first()).toBeAttached();
}
async function designFields(page) {
  await page.locator('#tts-model-type').selectOption('VoiceDesign');
  await openTtsEnvironment(page);
  await page.locator('#tts-manage-model-type').selectOption('VoiceDesign');
  if (!(await page.locator('#tts-voice-create-fields').evaluate(el => el.open))) await page.locator('#tts-voice-create-fields > summary').click();
  await page.locator('#tts-voice-name').fill('温柔旁白');
  await page.locator('#tts-voice-prompt').fill('清晰温暖的女声，支持中文和英文叙述。');
  await expect(page.locator('#tts-start')).toBeDisabled();
}
const customCalls = () => calls.filter(call => call.customization);
async function createDesign(page) {
  await designFields(page); await page.locator('#tts-voice-create').click();
  await expect(page.locator('#tts-manage-voice option')).toHaveCount(2);
  await closeTtsEnvironment(page); await page.locator('#tts-voice-select').selectOption({index: 1});
  return page.locator('#tts-voice').inputValue();
}

test('default CustomVoice has searchable model-compatible system voices and preserves spaced IDs', async ({page}) => {
  await expect(page.locator('#tts-model-type')).toHaveValue('CustomVoice');
  await expect(page.locator('#tts-voice')).toHaveValue('Cherry');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(49);
  await page.locator('#tts-voice-search').fill('粤语');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(3);
  await page.locator('#tts-voice-select').selectOption('Rocky');
  await expect(page.locator('#tts-voice-current')).toContainText('粤语·阿强');
  await page.locator('#tts-voice-search').fill('');
  await page.locator('#tts-voice-select').selectOption('Eldric Sage');
  await page.locator('#tts-start').click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].recipe.voice).toBe('Eldric Sage');
  expect(calls[0].recipe.model_type).toBe('CustomVoice');
  await page.locator('#tts-model').selectOption('qwen3-tts-instruct-flash');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(25);
  await expect(page.locator('#tts-instruct')).toBeVisible();
  await page.locator('#tts-model').selectOption('qwen3-tts-flash-2025-09-18');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(18);
  await page.locator('#tts-model').selectOption('qwen3-tts-flash');
  await expect(page.locator('#tts-voice')).toHaveValue('Eldric Sage');
  if (process.env.MSW_UI_EVIDENCE_DIR) {
    await page.locator('#tts-model-type').scrollIntoViewIfNeeded();
    await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'qwen-customvoice.png')});
  }
});

test('design creates one reusable voice, previews it, synthesizes and restores saved choice', async ({page}) => {
  const voice = await createDesign(page);
  expect(customCalls()).toHaveLength(1);
  expect(customCalls()[0].customization.input.target_model).toBe('qwen3-tts-vd-2026-01-26');
  await openTtsEnvironment(page);
  await page.locator('#tts-voice-history').evaluate(el => el.open = true);
  await page.getByRole('button', {name: '试听音色', exact: true}).click();
  await expect(page.locator('#asset-player')).toBeVisible();
  await expect(page.getByRole('button', {name: '选择此记录', exact: true})).toHaveCount(0);
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.readyState)).toBeGreaterThan(1);
  await closeTtsEnvironment(page);
  await page.locator('#tts-start').click();
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  expect(await page.evaluate(() => DATA.msw.assets[0].generation)).toMatchObject({voice, model_type: 'VoiceDesign'});
  await page.locator('#tts-save-settings').click();
  await expect(page.locator('#tts-message')).toContainText('已保存');
  await page.reload(); await openPanel(page);
  await expect(page.locator('#tts-model-type')).toHaveValue('VoiceDesign');
  await expect(page.locator('#tts-voice')).toHaveValue(voice);
  await expect(page.locator('#tts-voice-select option')).toHaveCount(2);
  expect(await page.evaluate(() => DATA.msw.assets[0].generation)).toMatchObject({voice, model_type: 'VoiceDesign'});
  expect(customCalls()).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify(DATA))).not.toContain('synthetic-browser-key');
  if (process.env.MSW_UI_EVIDENCE_DIR) {
    await openTtsEnvironment(page);
    await page.locator('#tts-voice-create-fields').evaluate(el => el.open = true);
    await page.locator('#tts-voice-name').scrollIntoViewIfNeeded();
    await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'qwen-voice-design.png')});
  }
});

test('clone validates selected audio then uploads reference and supports multilingual subtitle synthesis', async ({page}) => {
  await page.locator('#tts-model-type').selectOption('VoiceClone');
  await openTtsEnvironment(page); await page.locator('#tts-manage-model-type').selectOption('VoiceClone');
  await page.locator('#tts-voice-create-fields').evaluate(el => el.open = true);
  await page.locator('#tts-voice-name').fill('双语复刻');
  await page.locator('#tts-voice-create').click();
  await expect(page.locator('#tts-voice-message')).toContainText('请选择 WAV');
  expect(customCalls()).toHaveLength(0);
  const reference = generateWav(join(dir, 'reference.wav'), 4);
  await page.locator('#tts-voice-reference').setInputFiles(reference);
  await page.locator('#tts-voice-create').click();
  await expect(page.locator('#tts-manage-voice option')).toHaveCount(2);
  await closeTtsEnvironment(page); await page.locator('#tts-voice-select').selectOption({index: 1});
  const body = customCalls()[0].customization;
  expect(body.model).toBe('qwen-voice-enrollment');
  expect(body.input.target_model).toBe('qwen3-tts-vc-2026-01-22');
  expect(body.input.audio.data).toMatch(/^data:audio\/wav;base64,/);
  // Use the editor's current text after its existing project normalization.
  const spokenText = await page.evaluate(() => DATA.segments[0].text);
  expect(spokenText).toContain('你好'); expect(spokenText).toContain('Hello world.');
  await page.locator('#tts-start').click();
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  const synthesis = calls.find(call => call.text);
  expect(synthesis.text).toBe(spokenText);
  expect(synthesis.recipe.model_type).toBe('VoiceClone');
  expect(await page.evaluate(() => JSON.stringify(DATA))).not.toContain('audio_base64');
});

test('lost submit response can be confirmed without sending a second cloud creation', async ({page}) => {
  await designFields(page);
  let dropped = false;
  await page.route('**/api/msw/qwen-voices', async route => {
    if (!dropped && route.request().postDataJSON().action === 'create') {
      dropped = true; await route.fetch(); await route.abort('failed');
    } else await route.continue();
  });
  await page.locator('#tts-voice-create').click();
  await expect(page.locator('#tts-voice-create')).toHaveText('确认上次音色提交');
  await page.locator('#tts-voice-create').click();
  await expect(page.locator('#tts-manage-voice option')).toHaveCount(2);
  expect(customCalls()).toHaveLength(1);
});

test('late created voice does not replace a selection after changing mode', async ({page}) => {
  hold = true; await designFields(page); await page.locator('#tts-voice-create').click();
  await expect.poll(() => held.length).toBe(1);
  await closeTtsEnvironment(page);
  await page.locator('#tts-model-type').selectOption('CustomVoice');
  await page.locator('#tts-voice-select').selectOption('Serena');
  for (const resume of held.splice(0)) resume(); hold = false;
  await expect(page.locator('#tts-voice-create')).toBeEnabled();
  await expect(page.locator('#tts-voice')).toHaveValue('Serena');
  await page.locator('#tts-model-type').selectOption('VoiceDesign');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(2);
  await expect(page.locator('#tts-voice')).toHaveValue('');
  await page.locator('#tts-voice-select').selectOption({index: 1});
  await expect(page.locator('#tts-start')).toBeEnabled();
});

test('switching project while creating retains the voice without applying it to the new project', async ({page}) => {
  hold = true; await designFields(page); await page.locator('#tts-voice-create').click();
  await expect.poll(() => held.length).toBe(1);
  const other = {segments: [{id: 'other', start: 0, end: 1000, text: 'Another project'}],
    msw: {schema: 'msw.editor.v1', project_id: randomUUID()}};
  page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
  await page.locator('#editor-settings-close').click(); await openMenubarMenu(page, '文件');
  const chooser = page.waitForEvent('filechooser'); await page.locator('#open-project').click();
  await (await chooser).setFiles({name: 'other.mosp', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other))});
  await expect.poll(() => page.evaluate(() => DATA.msw.project_id)).toBe(other.msw.project_id);
  for (const resume of held.splice(0)) resume(); hold = false;
  await openPanel(page);
  await expect(page.locator('#tts-voice-select option')).toHaveCount(2);
  await expect(page.locator('#tts-voice')).toHaveValue('');
  expect(await page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(0);
  expect(customCalls()).toHaveLength(1);
});

test('voice catalogs stay isolated across regions and registered external IDs remain usable', async ({page}) => {
  await createDesign(page);
  await openTtsEnvironment(page);
  await page.locator('#tts-settings').evaluate(el => el.open = true);
  await page.locator('#tts-region').selectOption('singapore');
  await expect(page.locator('#tts-voice')).toHaveValue('');
  await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-key').fill('different-synthetic-key');
  await page.locator('#tts-key').blur();
  await expect(page.locator('#tts-voice-select option')).toHaveCount(1);
  await page.locator('#tts-voice-register-fields > summary').click();
  await page.locator('#tts-manage-name').fill('外部音色'); await page.locator('#tts-voice-external-id').fill('external-custom-voice');
  await page.locator('#tts-voice-register').click(); await expect(page.locator('#tts-voice-message')).toContainText('已登记');
  await closeTtsEnvironment(page); await page.locator('#tts-voice-select').selectOption('external-custom-voice');
  await page.locator('#tts-start').click();
  await expect.poll(() => calls.filter(call => call.text).length).toBe(1);
  expect(calls.find(call => call.text).recipe).toMatchObject({region: 'singapore', voice: 'external-custom-voice'});
});

test('changing engine while creating does not mix Qwen voice requests with Yukkuri settings', async ({page}) => {
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/qwen-voices')) requests.push(request.postDataJSON()); });
  hold = true; await designFields(page); await page.locator('#tts-voice-create').click();
  await expect.poll(() => held.length).toBe(1);
  await closeTtsEnvironment(page);
  await page.locator('#tts-engine').selectOption('yukkuri');
  for (const resume of held.splice(0)) resume(); hold = false;
  await expect(page.locator('#tts-voice-create')).toBeEnabled();
  await expect(page.locator('#tts-voice')).toHaveValue('');
  await expect(page.locator('#tts-yukkuri-fields')).toBeVisible();
  expect(requests.every(request => request.provider.recipe.provider === 'qwen')).toBe(true);
  await page.locator('#tts-engine').selectOption('qwen');
  await expect(page.locator('#tts-voice-select option')).toHaveCount(2);
});

test('expanded cloning controls fit global settings with internal scrolling and collapsed histories', async ({page}) => {
  await page.setViewportSize({width: 720, height: 600});
  await page.locator('#tts-model-type').selectOption('VoiceClone');
  await openTtsEnvironment(page); await page.locator('#tts-manage-model-type').selectOption('VoiceClone');
  await page.locator('#tts-voice-create-fields').evaluate(el => el.open = true);
  await page.locator('#tts-voice-create').scrollIntoViewIfNeeded();
  const geometry = await page.locator('#editor-settings-modal').evaluate(panel => {
    const body = panel.querySelector('#editor-settings-content'), rect = panel.getBoundingClientRect();
    return {right: rect.right, bottom: rect.bottom, width: body.clientWidth, scrollWidth: body.scrollWidth,
      height: body.clientHeight, scrollHeight: body.scrollHeight};
  });
  expect(geometry.right).toBeLessThanOrEqual(720); expect(geometry.bottom).toBeLessThanOrEqual(600);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
  await expect(page.locator('#tts-voice-history')).not.toHaveAttribute('open');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'qwen-clone-narrow.png')});
});

test('a running old backend explains the required restart instead of enabling an invalid model', async ({page}) => {
  await page.route('**/api/msw/tts-settings', async route => {
    const response = await route.fetch(), data = await response.json();
    delete data.modelTypes; delete data.systemVoices;
    await route.fulfill({response, json: data});
  });
  await page.reload(); await openMenubarMenu(page, '媒体'); await page.locator('#tts-open').click();
  await expect(page.locator('#tts-message')).toContainText('重启编辑器服务');
  await expect(page.locator('#tts-start')).toBeDisabled();
  expect(customCalls()).toHaveLength(0);
});
