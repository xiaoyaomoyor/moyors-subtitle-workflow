import {test, expect} from '@playwright/test';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding, findFreePort, generateWav, generateWaveformPayload, makeTempDir,
  openMenubarMenu, clickMenubarItem, startServer, openTtsEnvironment, closeTtsEnvironment} from './helpers.mjs';

let server, dir, projectPath;
const resourcePath = process.env.MSW_TEST_YUKKURI_RUNTIME;
test.beforeEach(async ({page}) => {
  test.skip(!resourcePath, 'Requires the optional real Yukkuri resource pack');
  dir = makeTempDir('editor-yukkuri');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'local');
  if (process.env.MSW_TEST_FFMPEG) process.env.FFMPEG_PATH = process.env.MSW_TEST_FFMPEG;
  const media = generateWav(join(dir, 'media.wav'), 10);
  projectPath = join(dir, 'test.mosp');
  writeFileSync(projectPath, JSON.stringify({media, segments: [
    {id: 'main-a', start: 0, end: 3000, text: '主字幕'}, {id: 'main-b', start: 4000, end: 7000, text: 'Hello world'}],
    waveform: generateWaveformPayload(10000), msw: {schema: 'msw.editor.v1', project_id: 'yukkuri-project'},
    multi_subtitle: {schema: 'moy.asr.multi_subtitle.v1', enabled: true, display_mode: 'both', tracks: [
      {id: 'ext', role: 'extension', name: 'Secondary', language: 'Chinese', split_mode: 'word', segments: [
        {id: 'secondary-a', start: 100, end: 2900, text: '重庆 English 123'},
        {id: 'independent', start: 7000, end: 9000, text: 'Independent'}]}],
    bindings: [{id: 'link', track_id: 'ext', main_segment_ids: ['main-a'], extension_segment_ids: ['secondary-a'], start_offset_ms: 100, end_offset_ms: -100}]}}));
  await disableOnboarding(page); page.on('dialog', d => d.type() === 'beforeunload' ? d.accept() : d.dismiss());
  server = await startServer(projectPath, media, await findFreePort()); await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
});
test.afterEach(async () => {await server?.stop(); server = null;});

async function panel(page) {
  await openMenubarMenu(page, '媒体'); await page.locator('#tts-open').click();
  await expect(page.locator('#tts-model option')).toHaveCount(5);
  await page.locator('#tts-engine').selectOption('yukkuri');
  await expect(page.locator('#tts-qwen-fields')).toBeHidden();
}
async function configure(page) {
  await panel(page);
  await openTtsEnvironment(page, 'yukkuri');
  await page.locator('#tts-yukkuri-directory').fill(resourcePath);
  await page.locator('#tts-yukkuri-check').click();
  await expect(page.locator('#tts-yukkuri-runtime-status')).toContainText('资源可用', {timeout: 15000});
  await closeTtsEnvironment(page);
}
const assetCount = page => page.evaluate(() => DATA.msw.assets?.length || 0);

test('local voice audition plays a temporary sample in the library', async ({page}) => {
  await configure(page);
  await page.locator('#tts-yukkuri-language').selectOption('English');
  await page.locator('#tts-yukkuri-voice').selectOption('m2');
  await page.locator('#tts-yukkuri-preview').click();
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => Number.isFinite(audio.duration) ? audio.duration : 0), {timeout: 15000}).toBeGreaterThan(0);
  expect(await assetCount(page)).toBe(0);
  await expect(page.locator('#tts-jobs')).toBeEmpty();
  await expect(page.locator('#tts-panel audio')).toHaveCount(0);
  await page.locator('#tts-yukkuri-voice').selectOption('f1');
  await expect(page.locator('#asset-player')).toBeHidden();
});

test('real local voices synthesize selected secondary, preserve pronunciation, save and export WAV', async ({page}) => {
  await page.locator('.multi-cue-column.extension .text').filter({hasText: /^重庆 English 123$/}).click();
  await configure(page);
  await expect(page.locator('#tts-target')).toHaveValue('main');
  await page.locator('#tts-target').selectOption('secondary');
  await expect(page.locator('#tts-scope')).toContainText('1 条');
  await page.locator('#tts-yukkuri-pronunciation').fill('虫庆 English 123');
  await page.locator('#tts-yukkuri-voice').selectOption('m2');
  await page.locator('#tts-yukkuri-speed').fill('140');
  await page.locator('#tts-save-settings').click();
  await expect(page.locator('#tts-message')).toContainText('设置已保存');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'e-yukkuri-settings.png')});
  await page.locator('#tts-start').click();
  await expect.poll(() => assetCount(page), {timeout: 15000}).toBe(1);
  const asset = await page.evaluate(() => DATA.msw.assets[0]);
  expect(asset.source_ref.id).toBe('secondary-a'); expect(asset.source_ref.pronunciation_override).toBe('虫庆 English 123');
  expect(asset.generation.provider).toBe('yukkuri'); expect(asset.generation.voice).toBe('m2');
  expect(asset.generation.speed).toBe(140); expect(asset.generation.display_text).toBe('重庆 English 123');
  expect(asset.generation.spoken_text).not.toBe(asset.generation.display_text);
  expect(asset.sample_rate).toBe(8000);
  await page.locator('#tts-close').click();
  await expect(page.locator('.msw-asset-row')).toHaveCount(1);
  await page.locator('.msw-asset-row [data-asset-action="play"]').click();
  await expect.poll(() => page.locator('#asset-audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  await page.locator('.msw-asset-row [data-asset-action="insert"]').click();
  await expect(page.locator('.msw-audio-clip')).toHaveCount(1);
  await page.evaluate(async () => {
    updateEditorSettings({autoSaveProject: false}); scheduleAutoSave(); scheduleAutoSaveFlush();
    await saveCurrentProject({silent: true});
  });
  await expect.poll(() => JSON.parse(readFileSync(projectPath, 'utf8')).msw.assets?.length || 0).toBe(1);
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'));
  expect(existsSync(join(dir, asset.path))).toBe(true); expect(saved.msw.assets[0].generation).toEqual(asset.generation);
  expect(JSON.stringify(saved)).not.toContain(resourcePath);
  // Saved WAVs stay playable/exportable even when the local engine is unavailable.
  const settingsPath = join(dir, 'local/yukkuri/settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  writeFileSync(settingsPath, JSON.stringify({...settings, runtime_path: join(dir, 'unavailable-runtime')}));
  await page.reload(); await expect(page.locator('.msw-audio-clip')).toHaveCount(1);
  await clickMenubarItem(page, '文件', 'audio-export-btn');
  await expect(page.locator('#audio-export-start')).toBeEnabled(); await page.locator('#audio-export-start').click();
  const downloadButton = page.locator('#audio-export-jobs').getByRole('button', {name: '下载 WAV', exact: true});
  await expect(downloadButton).toBeVisible({timeout: 30000});
  const download = page.waitForEvent('download'); await downloadButton.click();
  const file = await download, target = join(dir, 'voiced.wav'); await file.saveAs(target);
  const bytes = readFileSync(target); expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.length).toBeGreaterThan(100000);
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'e-yukkuri-export.png')});
});

test('all subtitles require a track and engine settings survive reopen without a cloud key', async ({page}) => {
  await configure(page);
  await expect(page.locator('#tts-target')).toHaveValue('main');
  await page.locator('#tts-target').selectOption('main');
  await page.locator('#tts-yukkuri-voice').selectOption('r1'); await page.locator('#tts-save-settings').click();
  await expect(page.locator('#tts-message')).toContainText('设置已保存');
  await page.locator('#tts-start').click(); await expect.poll(() => assetCount(page), {timeout: 20000}).toBe(2);
  expect(await page.evaluate(() => DATA.msw.assets.map(a => a.source_ref.id).sort())).toEqual(['main-a', 'main-b']);
  await page.reload(); await panel(page);
  await expect(page.locator('#tts-yukkuri-voice')).toHaveValue('r1');
  await page.locator('#tts-engine').selectOption('qwen'); await expect(page.locator('#tts-model')).toBeVisible();
  await page.locator('#tts-engine').selectOption('yukkuri'); await expect(page.locator('#tts-yukkuri-voice')).toHaveValue('r1');
});

test('missing resource feedback and expanded local controls fit a small viewport', async ({page}) => {
  await page.setViewportSize({width: 900, height: 600}); await panel(page);
  await expect(page.locator('#tts-start')).toBeDisabled();
  await expect(page.locator('#tts-environment-notice')).toContainText('资源未就绪');
  await openTtsEnvironment(page, 'yukkuri');
  await page.locator('#tts-yukkuri-directory').fill(join(dir, 'missing'));
  await page.locator('#tts-yukkuri-check').click();
  await expect(page.locator('#tts-yukkuri-runtime-status')).toContainText('目录不完整');
  await closeTtsEnvironment(page);
  await expect.poll(() => page.locator('#tts-panel').evaluate(panel => {
    const r = panel.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })).toBe(true);
  await page.locator('#tts-start').scrollIntoViewIfNeeded();
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'e-yukkuri-small.png')});
});

test('real local engine synthesizes an independent bilingual draft without modifying subtitles', async ({page}) => {
  await configure(page);
  const before = await page.evaluate(() => JSON.stringify(DATA.segments));
  await page.locator('#tts-target').selectOption('editor_text'); await page.locator('#cue-panel-tts-text').fill('你好 Hello');
  await expect(page.locator('#tts-yukkuri-pronunciation')).not.toBeVisible(); await page.locator('#tts-start').click();
  await expect.poll(() => assetCount(page), {timeout: 15000}).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(DATA.segments))).toBe(before);
  const asset = await page.evaluate(() => DATA.msw.assets[0]);
  expect(asset.source_ref.kind).toBe('editor_text'); expect(asset.generation.display_text).toBe('你好 Hello');
  expect(asset.source_ref.end-asset.source_ref.start).toBe(Math.ceil(asset.sample_count*1000/asset.sample_rate));
});
