// 波形显示器模块的剪贴板与全选回归：
// - Ctrl+A 分场景全选（默认字幕块+贴片；选中贴片→全选贴片；选中字幕→全选字幕）
// - 贴片 Ctrl+V 按「最后拷贝的对象」路由（复制后选区被清也能粘贴，不再落空）
// - 贴片选中时 Ctrl+V 只粘贴贴片，不再同时触发字幕粘贴（历史双粘贴 bug）
// - 菜单栏点击已展开的选项卡不再折叠
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDir, findFreePort, generateWaveformPayload, generateWav, makeTempDir, startServer } from './helpers.mjs';

let tempDir;
let server;
const DURATION_MS = 130000;

const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

function generateClipProject(filePath) {
  const assetId = `audio-${hex(32)}`;
  const assetFolder = `msw-${hex(24)}`;
  const project = {
    media: 'synthetic.wav',
    segments: [
      { start: 0, end: 8000, text: 'Alpha' },
      { start: 50000, end: 58000, text: 'Bravo' },
      { start: 100000, end: 108000, text: 'Charlie' },
    ],
    waveform: generateWaveformPayload(DURATION_MS),
    msw: {
      schema: 'msw.editor.v1',
      project_id: 'wave-clipboard-probe',
      assets: [{
        id: assetId,
        kind: 'audio',
        path: `${assetFolder}.assets/audio/${assetId}.wav`,
        sha256: hex(64),
        sample_rate: 22050,
        channels: 1,
        sample_count: 220500,
        byte_size: 441044,
        generation: {
          provider: 'probe', model: 'probe-model', voice: 'probe-voice', language_type: 'word',
          display_text: '测试配音', spoken_text: '测试配音',
        },
        source_ref: { key: 'probe-key', id: 'cue-0', kind: 'subtitle', text: 'Alpha', start: 0, end: 8000 },
        job_id: 'probe-job',
      }],
      audio_tracks: [{ id: 'voice-1', name: '配音', gain_db: 0, muted: false }],
      audio_clips: [
        { id: 'clip-1', track_id: 'voice-1', asset_id: assetId, start_ms: 15000, source_in_sample: 0, source_out_sample: 22050, playback_rate: 1, gain_db: 0, muted: false, label: '贴片A' },
        { id: 'clip-2', track_id: 'voice-1', asset_id: assetId, start_ms: 30000, source_in_sample: 0, source_out_sample: 22050, playback_rate: 1, gain_db: 0, muted: false, label: '贴片B' },
      ],
    },
  };
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  mkdirSync(join(tempDir, assetFolder + '.assets', 'audio'), { recursive: true });
  copyFileSync(join(tempDir, 'synthetic.wav'), join(tempDir, assetFolder + '.assets', 'audio', assetId + '.wav'));
  return filePath;
}

test.beforeAll(async () => {
  tempDir = makeTempDir('wave-clipboard');
  const mediaPath = join(tempDir, 'synthetic.wav');
  generateWav(mediaPath, DURATION_MS / 1000);
  const projectPath = generateClipProject(join(tempDir, 'project.json'));
  server = await startServer(projectPath, mediaPath, await findFreePort());
});

test.afterAll(async () => {
  await server?.stop();
  cleanupTempDir(tempDir);
});

test.beforeEach(async ({ page }) => {
  // 跳过新手引导：引导聚光会选中第一条字幕，破坏「无选区」的默认场景。
  await page.addInitScript(() => {
    localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({ autoSaveProject: false }));
    localStorage.setItem('moy.asr.editor.onboarding.v1', 'completed');
  });
  await page.goto(server.url);
  await page.waitForSelector('.waveform-cue-block[data-idx]');
  await page.waitForSelector('.msw-audio-clip');
  await page.waitForFunction(() => document.getElementById('player')?.readyState >= 1);
});

test('Ctrl+A in the waveform module selects cues and clips by scenario', async ({ page }) => {
  const pane = page.locator('#waveform-pane');
  const state = () => page.evaluate(() => ({
    cuesSelected: document.querySelectorAll('#cues-container > .cue.selected').length,
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
    clipsSelected: window.MSWE.resolve('audio-timeline').selectedCount(),
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
  }));

  // 默认（无选区）：字幕块 + 音频贴片一起全选
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 3, cueTotal: 3, clipsSelected: 2, clipTotal: 2 });

  // 已选中贴片：全选只选全部贴片，字幕选区清空
  await page.locator('.msw-audio-clip').first().click();
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 0, cueTotal: 3, clipsSelected: 2, clipTotal: 2 });

  // 已选中字幕：全选只选全部字幕，贴片选区清空
  await page.locator('.waveform-cue-block[data-idx="0"]').click();
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 3, cueTotal: 3, clipsSelected: 0, clipTotal: 2 });
});

test('clip paste stays reachable after the selection clears and never double-pastes', async ({ page }) => {
  // 复制贴片 → Escape 清掉选区（贴片的清除键）→ Ctrl+V 仍应粘贴贴片到播放头（旧逻辑落空）
  await page.locator('.msw-audio-clip').first().click();
  await page.keyboard.press('Control+c');
  await page.evaluate(() => { player.currentTime = 60; });
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
    clipsSelected: window.MSWE.resolve('audio-timeline').selectedCount(),
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
  }));
  expect(state.clipTotal).toBe(3);
  expect(state.clipsSelected).toBe(1);
  expect(state.cueTotal).toBe(3);

  // 贴片选中 + 字幕剪贴板有内容：Ctrl+V 只粘贴贴片（历史 bug 是两者同时粘贴）
  await page.locator('.waveform-cue-block[data-idx="0"]').click();
  await page.keyboard.press('Control+c');
  await page.locator('.msw-audio-clip').first().click();
  await page.evaluate(() => { player.currentTime = 70; });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
  }));
  expect(after.clipTotal).toBe(4);
  expect(after.cueTotal).toBe(3);
});

test('clicking an open menubar tab keeps it open', async ({ page }) => {
  const fileTab = page.locator('.menubar-item[data-menubar-item="file"] > .menubar-tab');
  await fileTab.click();
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).toHaveClass(/open/);
  // 点击已展开的选项卡：保持展开，不折叠
  await fileTab.click();
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).toHaveClass(/open/);
  // 关闭途径仍然有效：点击菜单外区域
  await page.locator('#cues-container').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).not.toHaveClass(/open/);
});
