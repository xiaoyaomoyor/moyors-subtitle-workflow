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
  // 直接置模块状态模拟「已启用的翻译模块」（F11 后未就绪也会保留勾选，此处验证执行前预检）。
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

test('project input runs the prefab plan chain instead of ASR', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#inputModeProject').click();
  await page.locator('#mediaPath').fill('D:\\Demo\\source.mosp');
  // 预检：未启用任何处理模块时明确说明，不发起执行。
  await page.locator('#start').click();
  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#errorNoticeMessage')).toContainText('至少启用一个');
  expect(await page.evaluate(() => window.__prefabCalls.includes('run_prefab_plan'))).toBe(false);

  // 启用翻译模块（deepseek 已就绪）后按方案执行。
  await page.evaluate(() => {
    const provider = window.MSWLauncher.config.postprocessProviders.find((item) => item.id === 'deepseek');
    Object.assign(provider, { verified: true, hasApiKey: true, hasBaseUrl: true, hasModel: true });
  });
  await page.locator('#prefabRail input[data-module-id="translate"]').check();
  await page.locator('#start').click();

  await expect.poll(() => page.evaluate(() => window.__prefabCalls.includes('run_prefab_plan'))).toBe(true);
  const plan = await page.evaluate(() => window.__prefabPlanRuns.at(-1));
  expect(plan).toMatchObject({ version: 1, inputMode: 'project' });
  expect(plan.input.path).toBe('D:\\Demo\\source.mosp');
  expect(plan.modules.postprocess).toContain('translate');
  expect(plan.modules.asr).toBe(false);
  // 绝不走 ASR 校验与转录 API。
  const calls = await page.evaluate(() => window.__prefabCalls);
  expect(calls).not.toContain('start_transcription');
  expect(calls).not.toContain('start_waveform_project');

  // 完成后产物成为当前目标。
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\source.processed.mosp');
  await expect(page.locator('#status')).toContainText('方案处理完成');
});

test('SRT input explains modules that need video and otherwise runs the chain', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  await page.locator('#inputModeProject').click();
  await page.locator('#mediaPath').fill('D:\\Demo\\subs.srt');
  await page.evaluate(() => {
    MSWModules.state.enabled.ocr = true;
    MSWModules.renderRail();
    document.dispatchEvent(new CustomEvent('mswmodules', { detail: { id: 'ocr', enabled: true } }));
  });
  await page.locator('#start').click();

  // OCR 需要视频画面：SRT 输入明确要求补充媒体，不静默执行。
  await expect(page.locator('#errorNoticeMessage')).toContainText('需要视频画面');
  expect(await page.evaluate(() => window.__prefabCalls.includes('run_prefab_plan'))).toBe(false);

  // 换成固定处理后可执行（SRT 输入链）。
  await page.evaluate(() => {
    MSWModules.state.enabled.ocr = false;
    MSWModules.state.enabled.replace = true;
    MSWModules.renderRail();
  });
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__prefabCalls.includes('run_prefab_plan'))).toBe(true);
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\subs.processed.mosp');
});

test('ASR enabled keeps the transcription pipeline', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);
  // R4/F09：识别默认关闭；启用后媒体输入走转录管线。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#mediaPath').dispatchEvent('change');
  await expect(page.locator('#srtPath')).not.toHaveValue('');
  await page.evaluate(() => { document.getElementById('apiKey').value = 'sk-mock-for-test'; });

  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('start_transcription');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_waveform_project');
});

test('batch with recognition disabled runs the frozen plan per item', async ({ page }) => {
  await openPrefab(page);
  await installCallTracker(page);

  // 通过批量「添加文件」入口走真实队列渲染（mock 多选返回两个不同媒体）。
  await page.locator('#batchMode').click();
  await page.locator('#batchAddFiles').click();
  await expect(page.locator('.batch-row')).toHaveCount(2);
  // 识别关闭（F09 默认）：批量与单文件共用同一冻结方案，逐项生成波形工程。
  await page.locator('#startBatch').click();

  await expect.poll(() => page.evaluate(() => window.__prefabCalls.includes('start_batch_projects'))).toBe(true);
  const batch = await page.evaluate(() => window.__batchPlanRuns.at(-1));
  expect(batch.items).toHaveLength(2);
  expect(batch.plan.modules.asr).toBe(false);
  expect(batch.plan.modules.waveform).toBe(true);
  expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_batch_transcription');
  // 逐项完成并给出工程产物；不发起任何转录请求。
  await page.waitForFunction(() => window.MSWBatch && window.MSWBatch.state.items.every((item) => item.status === 'done'));
  const results = await page.evaluate(() => window.MSWBatch.state.items.map((item) => item.result && item.result.jsonPath));
  expect(results[0]).toContain('a.waveform.mosp');
  expect(results[1]).toContain('b.waveform.mosp');

  // 工程/字幕输入模式不支持批量：明确报错而非静默换链（队列条目仍在）。
  await page.locator('#singleMode').click();
  await page.locator('#inputModeProject').click();
  await page.locator('#batchMode').click();
  await page.locator('#startBatch').click();
  await expect(page.locator('#log')).toContainText('媒体输入');
  expect(await page.evaluate(() => window.__prefabCalls.filter((c) => c === 'start_batch_projects').length)).toBe(1);
});
