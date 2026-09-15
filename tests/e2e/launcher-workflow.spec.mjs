import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openPrefab(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => { localStorage.removeItem('MSW_LAUNCHER_MODULES_V1'); });
  await page.reload();
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.waitForFunction(() => document.querySelectorAll('#prefabRail .rail-item').length > 0);
}

function installCallTracker(page) {
  return page.evaluate(() => {
    window.__prefabCalls = [];
    window.__prefabPayloads = [];
    const call = MSWLauncher.callBackend;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      window.__prefabCalls.push(method);
      if (method === 'start_waveform_project') window.__prefabPayloads.push(payload);
      return next(method, payload);
    };
  });
}

test('media-only plan with waveform enabled builds a waveform project asynchronously', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();
  await page.locator('#start').click();

  // R0：走异步任务入口并携带 waveform 开关，不触碰转录 API。
  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('start_waveform_project');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_transcription');
  const payload = await page.evaluate(() => window.__prefabPayloads.at(-1));
  expect(payload).toMatchObject({ mediaPath: 'D:\\Demo\\clip.mp4', waveform: true });

  // mock 后端通过 waveformTask 事件回报完成：工程成为当前目标。
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.waveform.mosp');
  await expect(page.locator('#status')).toContainText('波形工程完成');
});

test('disabling the waveform module produces a media-only project', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();
  await page.locator('#prefabRail input[data-module-id="waveform"]').uncheck();
  await page.locator('#start').click();

  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('start_waveform_project');
  const payload = await page.evaluate(() => window.__prefabPayloads.at(-1));
  expect(payload.waveform).toBe(false);
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.media.mosp');
});

test('postprocess modules without subtitle input are explained, not silently skipped', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();
  // 直接置模块状态模拟「已配置就绪的翻译模块」（真实控件未就绪会打回，此处验证执行前预检）。
  await page.evaluate(() => {
    MSWModules.state.enabled.translate = true;
    MSWModules.renderRail();
    document.dispatchEvent(new CustomEvent('mswmodules', { detail: { id: 'translate', enabled: true } }));
  });
  await page.locator('#start').click();

  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#errorNoticeMessage')).toContainText('需要字幕来源');
  // 未发起任何后端执行请求。
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_waveform_project');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_transcription');
});

test('project input mode refuses the ASR pipeline with an explicit message', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#inputModeProject').click();
  await page.locator('#mediaPath').fill('D:\\Demo\\source.mosp');
  await page.locator('#start').click();

  // R0/F05：工程/字幕模式绝不走 ASR 校验与转录 API。
  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#errorNoticeMessage')).toContainText('下一阶段');
  const calls = await page.evaluate(() => window.__prefabCalls);
  expect(calls).not.toContain('start_transcription');
  expect(calls).not.toContain('start_waveform_project');
  expect(calls).not.toContain('start_batch_transcription');
});

test('ASR enabled keeps the transcription pipeline', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);
  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#mediaPath').dispatchEvent('change');
  await expect(page.locator('#srtPath')).not.toHaveValue('');
  await page.evaluate(() => { document.getElementById('apiKey').value = 'sk-mock-for-test'; });

  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('start_transcription');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_waveform_project');
});

test('batch start is refused with recognition disabled', async ({ page }) => {
  await openPrefab(page);

  await page.locator('#batchMode').click();
  // 通过批量「添加文件」入口走真实队列渲染（mock choose_file 返回媒体路径）。
  await page.locator('#batchAddFiles').click();
  await expect(page.locator('.batch-row')).toHaveCount(1);
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();
  await page.locator('#startBatch').click();

  // R0/F07：识别关闭时批量明确报错，不发起批量转录请求。
  await expect(page.locator('#errorNotice').first()).toBeAttached();
  await expect(page.locator('#status')).toContainText('识别');
});
