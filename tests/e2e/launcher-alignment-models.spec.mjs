import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function openLauncher(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
}

test('cloud recognition can prepare the shared alignment runtime and retain its settings', async ({ page }) => {
  await openLauncher(page);
  const recognition = await page.evaluate(() => {
    window.runtimeReady = false;
    window.runtimeRequests = [];
    MSWLauncher.bridgeOverride = async (method, payload, call) => {
      const runtime = { ok: true, ready: runtimeReady, status: runtimeReady ? 'ready' : 'broken', path: 'D:/Shared runtime' };
      if (method === 'get_local_runtime') return runtime;
      if (method === 'get_alignment_models') return {
        ok: true,
        runtimeInventory: {
          runtimeVersionInstalled: runtimeReady ? '8' : '7', runtimeVersionExpected: '8',
          components: [{ name: 'sherpa_onnx', installed: runtimeReady }, { name: 'soundfile', installed: true }],
        },
        models: [{
          id: 'firered-asr2-ctc', label: 'FireRed CPU', installed: true, installedSize: '8 B',
          runtimeAvailable: runtimeReady, runtimePackages: ['sherpa_onnx', 'soundfile'],
        }],
      };
      if (method === 'install_local_runtime') {
        runtimeRequests.push(payload);
        return { ok: true, installing: true };
      }
      return call(method, payload);
    };
    MSWNavigation.show('tools');
    MSWTools.select('timestamps');
    const { providerId, modelId, language } = MSWLauncher.getTranscriptionPayload();
    return { providerId, modelId, language };
  });
  expect(recognition.providerId).toBe('qwen');
  await page.locator('#manageTimestampAlignment').click();
  await expect(page.locator('#alignmentModelsSettings')).toBeVisible();
  await expect(page.locator('#alignmentModelsInventory')).toContainText('已下载 · 8 B · 缺少依赖 sherpa_onnx');
  await expect(page.locator('#prepareAlignmentModel')).toBeDisabled();
  await page.locator('#openAlignmentRuntime').click();
  await expect(page.locator('#localRuntimeHeading')).toHaveText('共享本地运行环境');
  await expect(page.locator('#localRuntimeVersions')).toContainText('已安装版本 7 · 所需版本 8 · 组件 1/2');
  await expect(page.locator('#installLocalRuntime')).toHaveText('升级并验证运行环境');
  await page.locator('#installLocalRuntime').click();
  expect(await page.evaluate(() => runtimeRequests)).toEqual([{ modelId: '', repair: true }]);
  await expect(page.locator('#localRuntimePath')).toBeDisabled();
  await page.evaluate(() => {
    runtimeReady = true;
    MSWLauncher.onBackendEvent({ type: 'localRuntimeReady' });
  });
  await expect(page.locator('#localRuntimeVersions')).toContainText('已安装版本 8 · 所需版本 8 · 组件 2/2');
  await expect(page.locator('#installLocalRuntime')).toBeHidden();
  await expect(page.locator('#alignmentModelsInventory')).toContainText('已下载 · 8 B · 运行环境就绪');
  await page.keyboard.press('Escape');
  await expect(page.locator('#timestampAlignmentStatus')).toContainText('运行环境就绪');
  expect(await page.evaluate(() => {
    const { providerId, modelId, language } = MSWLauncher.getTranscriptionPayload();
    return { providerId, modelId, language };
  })).toEqual(recognition);
});

test('alignment manager keeps the selected recognition model and refreshes after cancellation and failure', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => {
    MSWModules.setEnabled('asr', true);
    MSWNavigation.show('prefab');
    MSWWorkflow.setCollapsed('asr', false);
    window.alignmentScans = 0;
    window.alignmentActions = [];
    const call = MSWLauncher.callBackend;
    MSWLauncher.callBackend = async (method, payload) => {
      if (method === 'get_alignment_models') {
        alignmentScans++;
        alignmentActions.push({ method, payload });
        return { ok: true, models: [
          { id: 'qwen3-forced-aligner-0.6b', installed: false, runtimeAvailable: true },
          { id: 'firered-asr2-ctc', installed: false, runtimeAvailable: true },
        ] };
      }
      if (method === 'prepare_alignment_model') {
        alignmentActions.push({ method, payload });
        return { ok: true, preparing: true };
      }
      if (method === 'cancel_alignment_model') {
        MSWLauncher.onBackendEvent({ type: 'alignmentPrepareCancelled', modelId: 'firered-asr2-ctc' });
        return { ok: true, cancelling: true };
      }
      return call(method, payload);
    };
  });
  await page.locator('#provider').selectOption('local');
  await page.locator('#alignmentModel').selectOption('qwen3-forced-aligner-0.6b');
  await page.locator('#alignmentModelPath').fill('D:/existing Qwen model');
  await page.locator('#alignmentModelPath').dispatchEvent('change');
  await page.locator('#manageRecognitionAlignment').click();
  await expect(page.locator('#alignmentDownloadModel')).toHaveValue('qwen3-forced-aligner-0.6b');
  await expect(page.locator('#alignmentDownloadPath')).toHaveValue('D:/existing Qwen model');
  await page.locator('#alignmentDownloadModel').selectOption('firered-asr2-ctc');
  await expect(page.locator('#alignmentDownloadPath')).toHaveValue('');
  await page.locator('#prepareAlignmentModel').click();
  await expect(page.locator('#cancelAlignmentModel')).toBeEnabled();
  const beforeCancel = await page.evaluate(() => alignmentScans);
  await page.locator('#cancelAlignmentModel').click();
  await expect(page.locator('#alignmentModelsStatus')).toHaveText('已取消下载。');
  await expect.poll(() => page.evaluate(() => alignmentScans)).toBeGreaterThan(beforeCancel);
  await page.locator('#prepareAlignmentModel').click();
  await expect(page.locator('#cancelAlignmentModel')).toBeEnabled();
  const beforeFailure = await page.evaluate(() => alignmentScans);
  await page.evaluate(() => MSWLauncher.onBackendEvent({
    type: 'error', code: 'alignment_prepare_failed', modelId: 'firered-asr2-ctc', detail: 'Test download failed',
  }));
  await expect(page.locator('#alignmentModelsStatus')).toHaveText('Test download failed');
  await expect.poll(() => page.evaluate(() => alignmentScans)).toBeGreaterThan(beforeFailure);
  expect(await page.evaluate(() => alignmentActions.filter(({ method }) => method === 'prepare_alignment_model').map(({ payload }) => payload)))
    .toEqual([{ modelId: 'firered-asr2-ctc', modelPath: '' }, { modelId: 'firered-asr2-ctc', modelPath: '' }]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#alignmentModel')).toHaveValue('qwen3-forced-aligner-0.6b');
  await expect(page.locator('#alignmentModelPath')).toHaveValue('D:/existing Qwen model');
});
