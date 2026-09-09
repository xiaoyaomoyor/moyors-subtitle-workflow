import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir,
  openTtsEnvironment, closeTtsEnvironment, startTtsServer} from './helpers.mjs';

let server, errors, mock, origin, audio, calls, projectPath;
test.beforeAll(async () => {
  mock = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200, {'Content-Type': 'audio/wav'}); res.end(audio);
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${mock.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => mock.close(resolve)); });
test.beforeEach(async ({page}) => {
  calls = [];
  errors = []; page.on('pageerror', error => errors.push(error.message));
  const dir = makeTempDir('tts-workspace');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  delete process.env.MSW_TEST_SAVE_TARGET;
  const path = join(dir, 'test.mosp'); projectPath = path;
  audio = readFileSync(generateWav(join(dir, 'result.wav'), .5));
  writeFileSync(path, JSON.stringify({media: '', language: 'Chinese', msw: {schema: 'msw.editor.v1', project_id: randomUUID()},
    segments: [{id: 'main-1', start: 0, end: 2000, text: '字幕原文'}], waveform: generateWaveformPayload(6000)}));
  server = await startTtsServer(path, generateWav(join(dir, 'media.wav'), 6), await findFreePort(), origin);
  await disableOnboarding(page); page.on('dialog', dialog => dialog.dismiss());
  await page.goto(server.url); await expect(page.locator('#editor-loading')).not.toBeVisible();
});

test('independent editor draft supports multiline, native undo, mode switches and a complete asset', async ({page}) => {
  await page.locator('.cue .text').first().click();
  await openTtsEnvironment(page); await page.locator('#tts-key').fill('synthetic-workspace-key');
  await closeTtsEnvironment(page);
  await expect(page.locator('#tts-target option')).toHaveText(['字幕编辑器内容', '主字幕', '副字幕']);
  await page.locator('#tts-target').selectOption('editor_text');
  const draft = page.locator('#cue-panel-tts-text');
  await expect(draft).toBeVisible(); await expect(draft).toHaveValue('字幕原文');
  await expect(page.locator('#cue-panel-text')).not.toBeVisible();
  expect(await draft.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await draft.evaluate(el => {
    const probe = document.createElement('i'); probe.style.color = 'var(--wave-playhead)'; el.parentElement.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }));
  await draft.fill('独立配音 Hello'); await draft.press('End'); await draft.press('Enter'); await draft.pressSequentially('Next line');
  await draft.press('Control+z');
  expect(await page.evaluate(() => DATA.segments[0].text)).toBe('字幕原文');
  await draft.fill('独立配音 Hello\n第二行');
  await page.locator('#tts-target').selectOption('main'); await expect(page.locator('#cue-panel-text')).toHaveValue('字幕原文');
  await page.locator('#tts-target').selectOption('editor_text'); await expect(draft).toHaveValue('独立配音 Hello\n第二行');
  await page.locator('#tts-start').click();
  await draft.fill('提交之后改写');
  await expect.poll(() => page.evaluate(() => DATA.msw.assets?.length || 0)).toBe(1);
  expect(calls[0].text).toBe('独立配音 Hello\n第二行');
  const asset = await page.evaluate(() => DATA.msw.assets[0]);
  expect(asset.source_ref.kind).toBe('editor_text'); expect(asset.source_ref.end - asset.source_ref.start).toBe(500);
  expect(asset.generation.display_text).toBe('独立配音 Hello\n第二行');
  expect(await page.evaluate(() => DATA.segments[0].text)).toBe('字幕原文');
  await page.locator('#tts-close').click(); await expect(draft).not.toBeVisible();
  await expect(page.locator('.msw-asset-meta').first()).toContainText('文本配音');
  await page.locator('.msw-asset-row').first().getByRole('button', {name: '放入时间轴', exact: true}).click();
  await expect.poll(() => page.evaluate(() => DATA.msw.audio_clips?.length || 0)).toBe(1);
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(readFileSync(projectPath)).msw?.audio_clips?.length || 0).toBe(1);
  const saved = JSON.parse(readFileSync(projectPath));
  expect(saved.segments[0].text).toBe('字幕原文'); expect(saved.msw.assets[0].source_ref.kind).toBe('editor_text');
  expect(JSON.stringify(saved)).not.toContain('提交之后改写');
  await page.reload(); await expect(page.locator('.msw-audio-clip')).toHaveCount(1);
});

test('empty or oversized draft cannot synthesize and an absent secondary track never falls back to main', async ({page}) => {
  await openTtsEnvironment(page); await page.locator('#tts-key').fill('synthetic-workspace-key'); await closeTtsEnvironment(page);
  await page.locator('#tts-target').selectOption('secondary'); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#tts-target').selectOption('editor_text');
  await page.locator('#cue-panel-tts-text').fill(' '); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#cue-panel-tts-text').fill('字'.repeat(601)); await expect(page.locator('#tts-start')).toBeDisabled();
  await page.locator('#cue-panel-tts-text').fill('😀'.repeat(600)); await expect(page.locator('#tts-start')).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#cue-panel-tts-text')).not.toBeVisible();
  expect(calls).toHaveLength(0);
});
test.afterEach(async () => { await server?.stop(); expect(errors).toEqual([]); });

test('environment navigation saves a key independently and the call panel stays compact', async ({page}) => {
  await openTtsEnvironment(page);
  await page.locator('#tts-settings > summary').click();
  // Connection details may already be expanded because no key is configured.
  if (!(await page.locator('#tts-key').isVisible())) await page.locator('#tts-settings > summary').click();
  await page.locator('#tts-key').fill('synthetic-workspace-key');
  await page.locator('#tts-environment-save').click();
  await expect(page.locator('#tts-environment-message')).toContainText('已保存');
  await closeTtsEnvironment(page);
  await expect(page.locator('#tts-synthesis-settings')).toBeVisible();
  await expect(page.locator('#tts-key')).not.toBeVisible();
  await expect(page.locator('#tts-voice')).toHaveAttribute('type', 'hidden');
  await expect(page.locator('#tts-environment-notice')).not.toBeVisible();
  await expect(page.locator('#tts-start')).toBeEnabled();
  expect(await page.locator('#tts-panel .gap-remove-panel-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('register and rename an existing voice without changing the synthesis choice', async ({page}) => {
  await openTtsEnvironment(page);
  await page.locator('#tts-key').fill('synthetic-workspace-key');
  await page.locator('#tts-manage-model-type').selectOption('CustomVoice');
  await page.locator('#tts-manage-name').fill('外部旁白');
  await page.locator('#tts-voice-register-fields > summary').click();
  await page.locator('#tts-voice-external-id').fill('external-narrator');
  await page.locator('#tts-voice-register').click();
  await expect(page.locator('#tts-voice-message')).toContainText('已登记');
  await page.locator('#tts-manage-name').fill('我的旁白');
  await page.locator('#tts-manage-rename').click();
  await expect(page.locator('#tts-voice-message')).toContainText('已更新');
  await closeTtsEnvironment(page);
  await expect(page.locator('#tts-voice')).toHaveValue('Cherry');
  await page.locator('#tts-voice-search').fill('我的旁白');
  await page.locator('#tts-voice-select').selectOption('external-narrator');
  await expect(page.locator('#tts-voice-current')).toContainText('我的旁白');
});

test('English text mode preserves user text and the two first-row controls share a baseline', async ({page}) => {
  await page.evaluate(() => { localStorage.setItem('mawe.language', 'en'); }); await page.reload();
  await openTtsEnvironment(page); await page.locator('#tts-key').fill('synthetic-workspace-key'); await closeTtsEnvironment(page);
  await expect(page.locator('#tts-target option')).toHaveText(['Subtitle editor text', 'Main subtitle', 'Secondary subtitle']);
  const a = await page.locator('#tts-target').boundingBox(), b = await page.locator('#tts-engine').boundingBox();
  expect(Math.abs(a.y-b.y)).toBeLessThan(1);
  await page.locator('#tts-target').selectOption('editor_text'); await page.locator('#cue-panel-tts-text').fill('你好 Hello');
  await expect(page.locator('#cue-panel-tts-text')).toHaveValue('你好 Hello');
  await expect(page.locator('#cue-panel-tts-footer')).toContainText('Independent voice draft');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'tts-independent-draft.png')});
});
