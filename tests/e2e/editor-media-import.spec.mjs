import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { disableOnboarding, findFreePort, makeTempDir, startTtsServer, clickMenubarItem } from './helpers.mjs';

let root, video, saved, server, errors;
test.beforeEach(async ({ page }, testInfo) => {
  root = makeTempDir('editor-media'); video = join(root, 'source.mp4'); saved = join(root, 'saved.mosp');
  const ffmpeg = process.env.FFMPEG_PATH;
  test.skip(!ffmpeg, 'Explicit FFmpeg executable required');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', video], { windowsHide: true });
  const project = join(root, 'initial.mosp');
  writeFileSync(project, JSON.stringify({ segments: [], media: '', msw: {schema: 'msw.editor.v1', project_id: randomUUID()} }));
  process.env.MAW_ENV_FILE = join(root, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(root, 'app-data');
  process.env.MSW_TEST_MEDIA_SOURCE = video; process.env.MSW_TEST_SAVE_TARGET = saved;
  if (testInfo.tags.includes('@editable-tools')) {
    writeFileSync(process.env.MAW_ENV_FILE, `FFMPEG_PATH=${ffmpeg}\n`);
    delete process.env.FFMPEG_PATH;
    try {server = await startTtsServer(project, null, await findFreePort(), 'http://127.0.0.1:1');}
    finally {process.env.FFMPEG_PATH = ffmpeg;}
  } else server = await startTtsServer(project, null, await findFreePort(), 'http://127.0.0.1:1');
  errors = []; page.on('pageerror', error => errors.push(error.message));
  await disableOnboarding(page); await page.addInitScript(() => localStorage.setItem('msw.waveform.auto', 'false'));
  await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
});
test.afterEach(async () => { await server?.stop(); expect(errors || []).toEqual([]); });

async function imported(page) {
  await expect.poll(() => page.evaluate(() => Boolean(MSWE.resolve('media').current))).toBe(true);
  return page.evaluate(() => MSWE.resolve('media').current);
}

test('direct browser video import registers the same playable source and can save/reopen without subtitles', async ({ page, request }) => {
  await page.evaluate(() => { applyCanonicalProject({segments: [], media: ''}, 'untitled.mosp'); detachServerProjectSaving(); });
  await page.locator('#load-media-file').setInputFiles(video);
  const media = await imported(page);
  expect(media.managed).toBe(true); expect(media.metadata.duration_ms).toBeGreaterThanOrEqual(3000);
  expect(media.metadata.audio_tracks[0].stream_index).toBe(1);
  const source = await request.get(new URL(media.url, server.url).href, { headers: {Range: 'bytes=0-31'} });
  expect(source.status()).toBe(206); expect(await source.body()).toEqual(readFileSync(video).subarray(0, 32));
  await expect(page.locator('#player')).toHaveJSProperty('readyState', 4);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#project-save-as-modal')).toHaveClass(/show/);
  await page.locator('#project-save-choose').click(); await page.locator('#project-save-confirm').click();
  await expect(page.locator('#project-save-as-modal')).not.toHaveClass(/show/);
  const project = JSON.parse(readFileSync(saved)); expect(project.segments).toEqual([]);
  expect(project.media).not.toMatch(/^blob:/); expect(project.media_metadata.duration_ms).toBeGreaterThanOrEqual(3000);
  await page.reload();
  await expect.poll(() => page.evaluate(() => player.duration)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => DATA.segments.length)).toBe(0);
});

test('native selection references the original video and keeps existing subtitles', async ({ page }) => {
  await page.evaluate(() => { DATA.segments.push({id: 'existing', start: 100, end: 900, text: 'Keep'}); renderAll(); });
  await clickMenubarItem(page, '文件', 'load-media');
  const media = await imported(page); expect(media.managed).toBe(false);
  expect(media.reference.replaceAll('\\', '/')).toBe(video.replaceAll('\\', '/'));
  expect(await page.evaluate(() => DATA.segments.map(cue => cue.id))).toEqual(['existing']);
});

test('cancelling a staged upload retains the previously committed media and ignores late work', async ({ page }) => {
  await page.locator('#load-media-file').setInputFiles(video); const previous = await imported(page);
  let blocked;
  await page.route('**/media-upload-chunk?*', async route => { blocked = route; });
  await page.locator('#load-media-file').setInputFiles([]);
  await page.locator('#load-media-file').setInputFiles(video);
  await expect.poll(() => Boolean(blocked)).toBe(true);
  await page.locator('#msw-media-cancel').click(); await blocked.abort();
  await expect(page.locator('#msw-media-cancel')).not.toBeVisible();
  expect(await page.evaluate(() => DATA.media)).toBe(previous.reference);
  expect(await page.evaluate(() => MSWE.resolve('media').current.id)).toBe(previous.id);
});

test('background peaks preserve edits and playhead, and multi audio playback uses a separate proxy', async ({ page, request }) => {
  const multi = join(root, 'multi.mp4');
  execFileSync(process.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', video,
    '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-map', '0:v', '-map', '0:a', '-map', '1:a',
    '-t', '3', '-c:v', 'copy', '-c:a', 'aac', multi], {windowsHide: true});
  await page.locator('#load-media-file').setInputFiles(multi);
  const original = await imported(page);
  await page.evaluate(()=>MSWE.resolve('processing-host').openWaveSettings());
  await expect(page.locator('#msw-source-toolbar')).toBeHidden();
  await expect(page.locator('.waveform-toolbar #msw-range-readout, .waveform-toolbar #msw-range-clear')).toHaveCount(0);
  await expect(page.locator('#wave-settings-modal #msw-waveform-auto')).toBeVisible();
  await expect(page.locator('#waveform-window-setting')).toBeHidden();
  await expect(page.locator('#msw-proxy-status')).toHaveText('播放代理已就绪');
  await page.evaluate(() => { DATA.segments.push({id:'keep', start:100, end:900, text:'Keep edit'}); renderAll(); player.currentTime = 1.5; });
  await page.locator('#msw-waveform-generate').click();
  await expect(page.locator('#msw-waveform-status')).toHaveText('波形已就绪');
  expect(await page.evaluate(() => DATA.segments[0].text)).toBe('Keep edit');
  expect(await page.evaluate(() => player.currentTime)).toBeCloseTo(1.5, 1);
  expect(await page.evaluate(() => DATA.waveform.audio_track)).toBe(0);
  await page.locator('#msw-source-track').selectOption('1');
  await expect.poll(() => page.evaluate(() => MSWE.resolve('media').current.audio_index)).toBe(1);
  await expect(page.locator('#msw-proxy-status')).toHaveText('播放代理已就绪');
  await page.locator('#msw-waveform-generate').click();
  await expect(page.locator('#msw-waveform-status')).toHaveText('波形已就绪');
  expect(await page.evaluate(() => DATA.waveform.audio_track)).toBe(1);
  expect(await page.evaluate(() => Array.from(atob(DATA.waveform.data)).some(x => x.charCodeAt(0)))).toBe(false);
  expect(await page.evaluate(() => DATA.media)).toBe(original.reference);
  expect(await page.evaluate(() => DATA.msw.source_audio_index)).toBe(1);
  const url = await page.evaluate(() => player.currentSrc);
  expect(url).toContain('/media-proxy?');
  const response = await request.get(url, {headers:{Range:'bytes=0-31'}});
  expect(response.status()).toBe(206);
  await page.screenshot({path: join(root, 'media-analysis.png')});
});

test('media tools are in global environment settings and honor a startup-controlled path',async({page})=>{
  await page.evaluate(()=>MSWE.resolve('processing-host').openWaveSettings());
  await page.locator('#msw-tools-open').click();
  await expect(page.locator('#wave-settings-modal')).not.toHaveClass(/show/);
  await expect(page.locator('#media-tools-environment-section #msw-tools-path')).toBeVisible();
  const field=await page.locator('#msw-tools-path').boundingBox(),controls=await page.locator('#msw-tools-controls').boundingBox();
  expect(field.width/controls.width).toBeGreaterThan(.95);
  await expect(page.locator('#msw-tools-status')).toContainText('启动环境');
  await expect(page.locator('#msw-tools-path')).toBeDisabled();await expect(page.locator('#msw-tools-save')).toBeDisabled();
  await expect(page.locator('#editor-settings-nav .settings-nav-subitem').filter({hasText:/^媒体工具$/})).toBeVisible();
  await expect(page.locator('#msw-tools-dialog')).toHaveCount(0);
  await page.screenshot({path:join(root,'media-tools-environment.png'),fullPage:true});
});

test('media tools save and validate paths before importing a source', {tag:'@editable-tools'},async({page})=>{
  await page.evaluate(()=>MSWE.resolve('processing-host').openMediaToolsEnvironment());
  await expect(page.locator('#msw-tools-status')).toContainText('已就绪');
  expect(await page.evaluate(()=>MSWE.resolve('media').current)).toBeNull();
  const original=await page.locator('#msw-tools-path').inputValue();
  await page.locator('#msw-tools-path').fill(join(root,'missing-ffmpeg.exe'));
  await page.locator('#msw-tools-save').click();await expect(page.locator('#msw-tools-status')).toContainText('没有完整');
  await page.locator('#msw-tools-path').fill(original);
  await page.locator('#msw-tools-save').click();await expect(page.locator('#msw-tools-status')).toContainText('已保存');
  await page.reload();await page.evaluate(()=>MSWE.resolve('processing-host').openMediaToolsEnvironment());
  await expect(page.locator('#msw-tools-path')).toHaveValue(original);await expect(page.locator('#msw-tools-status')).toContainText('已就绪');
});
