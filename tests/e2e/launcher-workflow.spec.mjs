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

test('media-only plan with ASR off builds a zero-subtitle waveform project', async ({ page }) => {
  await openPrefab(page);
  await page.evaluate(() => { window.__prefabCalls = []; });

  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#mediaPath').dispatchEvent('change');
  await expect(page.locator('#srtPath')).not.toHaveValue('');
  await page.locator('#prefabRail input[data-module-id="asr"]').uncheck();
  await expect(page.locator('[data-module-card="asr"]')).toBeHidden();

  await page.evaluate(() => {
    const call = MSWLauncher.callBackend;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      window.__prefabCalls.push(method);
      return next(method, payload);
    };
  });
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('generate_waveform_project');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('start_transcription');
  // 零字幕工程生成后成为当前工程目标，首页最近工程刷新。
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.waveform.mosp');
  await expect(page.locator('#status')).toContainText('波形工程完成');

  // 无媒体时不伪造结果：给出字段错误且不调用后端。
  await page.evaluate(() => { window.__prefabCalls = []; });
  await page.locator('#mediaPath').fill('');
  await page.locator('#start').click();
  await expect(page.locator('#mediaPathError')).not.toBeEmpty();
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('generate_waveform_project');
});

test('ASR enabled keeps the transcription pipeline', async ({ page }) => {
  await openPrefab(page);
  await page.evaluate(() => { window.__prefabCalls = []; });
  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#mediaPath').dispatchEvent('change');
  await expect(page.locator('#srtPath')).not.toHaveValue('');

  await page.evaluate(() => {
    const call = MSWLauncher.callBackend;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      window.__prefabCalls.push(method);
      return next(method, payload);
    };
    // 演示模式不回填密钥；校验要求表单里有值。
    document.getElementById('apiKey').value = 'sk-mock-for-test';
  });
  // ASR 保持默认启用：直接走 start_transcription（校验通过后才会调用）。
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__prefabCalls)).toContain('start_transcription');
  await expect(await page.evaluate(() => window.__prefabCalls)).not.toContain('generate_waveform_project');
});
