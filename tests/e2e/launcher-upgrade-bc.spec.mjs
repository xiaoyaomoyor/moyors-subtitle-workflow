import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const launcherUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html')).href;
async function open(page) {
  await page.goto(launcherUrl);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
}

test('output settings retain the inactive per-media preference and preserve an explicit path', async ({ page }) => {
  await open(page);
  await page.locator('#mediaPath').fill('D:\\Demo\\clip.mp4');
  await page.locator('#mediaPath').dispatchEvent('change');
  await page.locator('#settingsButton').click();
  await expect(page.locator('#outputSubfolder')).not.toBeChecked();
  await expect(page.locator('#perVideoSubfolder')).toBeDisabled();
  await expect(page.locator('#attachModelName')).toBeChecked();
  await page.locator('#outputSubfolder').check();
  await page.locator('#perVideoSubfolder').check();
  await expect(page.locator('#srtPath')).toHaveValue(/clip_msw.*\.qwen-audio\.srt$/);
  await page.locator('#outputSubfolder').uncheck();
  await expect(page.locator('#perVideoSubfolder')).toBeChecked();
  await expect(page.locator('#perVideoSubfolder')).toBeDisabled();
  await expect(page.locator('#srtPath')).toHaveValue('D:\\Demo\\clip.qwen-audio.srt');
  await page.locator('#attachModelName').uncheck();
  await expect(page.locator('#srtPath')).toHaveValue('D:\\Demo\\clip.srt');
  await page.keyboard.press('Escape');
  await page.locator('#srtPath').fill('E:\\我的输出\\chosen.srt');
  await page.locator('#srtPath').dispatchEvent('input');
  await page.locator('#settingsButton').click();
  await page.locator('#outputSubfolder').check();
  await expect(page.locator('#srtPath')).toHaveValue('E:\\我的输出\\chosen.srt');
});

test('segmentation and local runtime controls live in settings; installation locks directory edits', async ({ page }) => {
  await open(page);
  await page.locator('#provider').selectOption('local');
  await expect(page.locator('#localRuntimeCheckField')).toBeVisible();
  await expect(page.locator('#localRuntimePanel')).toBeHidden();
  await page.locator('#openLocalRuntimeSettings').click();
  await expect(page.locator('#localRuntimePanel')).toBeVisible();
  await expect(page.locator('#localRuntimePath')).toBeEnabled();
  await page.locator('#pickLocalRuntimePath').click();
  await expect(page.locator('#localRuntimePath')).toHaveValue(/MSW\\local-runtime$/);
  await page.locator('#localRuntimePath').fill('D:\\Custom Runtime');
  await page.locator('#localRuntimePath').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.MSWLauncher.config.localRuntime.path)).toBe('D:\\Custom Runtime');
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([''], 'Runtime Folder'));
    document.querySelector('#localRuntimePath').dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
    window.MSWLauncher.onBackendEvent({ type: 'dropReject', path: 'E:\\Dragged Runtime' });
  });
  await expect(page.locator('#localRuntimePath')).toHaveValue('E:\\Dragged Runtime');
  await expect.poll(() => page.evaluate(() => window.MSWLauncher.config.localRuntime.path)).toBe('E:\\Dragged Runtime');
  await page.evaluate(() => {
    window.MSWLauncher.config.localRuntime.status = 'installing';
    window.MSWLauncher.onBackendEvent({ type: 'localRuntimeProgress', percent: 30, message: 'Installing test fixture' });
  });
  await expect(page.locator('#localRuntimePath')).toBeDisabled();
  await expect(page.locator('#pickLocalRuntimePath')).toBeDisabled();
  await page.locator('#settingsProcessingTab').click();
  await expect(page.locator('#settingsProcessingPanel #maxLen')).toBeVisible();
  await expect(page.locator('#settingsProcessingPanel #maxWords')).toBeVisible();
  await page.locator('#maxLen').fill('24');
  await page.keyboard.press('Escape');
  await page.locator('#settingsButton').click();
  await page.locator('#settingsProcessingTab').click();
  await expect(page.locator('#maxLen')).toHaveValue('24');
});

test('English runtime states retain concrete diagnostic details and model choices', async ({ page }) => {
  await open(page);
  await page.locator('#provider').selectOption('local');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.MSWLauncher.config.localRuntime = { status: 'broken', ready: false, detail: 'DLL load failed: example.dll', path: 'D:\\Runtime' };
  });
  await page.locator('#langToggle').click();
  await expect(page.locator('#provider option:checked')).toHaveText('Local models (Beta)');
  await expect(page.locator('#model')).toHaveValue('qwen3-asr-local');
  await page.locator('#openLocalRuntimeSettings').click();
  await expect(page.locator('#localRuntimeHint')).toContainText('DLL load failed: example.dll');
  await expect(page.locator('#localRuntimeStatus')).toHaveText(/repair/i);
});

test('batch activity disables the runtime directory until the batch finishes', async ({ page }) => {
  await open(page);
  await page.locator('#provider').selectOption('local');
  await page.locator('#openLocalRuntimeSettings').click();
  await page.evaluate(() => window.MSWLauncher.onBackendEvent({ type: 'batchStarted', total: 1 }));
  await expect(page.locator('#localRuntimePath')).toBeDisabled();
  await page.evaluate(() => window.MSWLauncher.onBackendEvent({ type: 'batchDone', items: [], cancelled: true }));
  await expect(page.locator('#localRuntimePath')).toBeEnabled();
});

for (const zoom of [80, 100, 150]) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
    test(`footer and independent toolbox columns fit ${viewport.width}x${viewport.height} at ${zoom}%`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page);
      await page.evaluate((target) => {
        const steps = Math.abs(target - 100) / 5;
        for (let i = 0; i < steps; i++) document.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: target < 100 ? 100 : -100 }));
      }, zoom);
      await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe(`${zoom}%`);
      const footer = await page.locator('footer.actions').boundingBox();
      expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height + 2);
      expect(footer.y + footer.height).toBeGreaterThan(viewport.height - 3);
      await page.locator('#toolboxFab').click();
      await page.locator('#toolboxUtilitiesPrimaryTab').click();
      await page.locator('#toolboxExtractAudioTab').click();
      await expect(page.locator('#toolboxExtractAudioPanel')).toBeVisible();
      const columns = await page.evaluate(() => {
        const left = document.querySelector('.toolbox-utility-tabs');
        const right = document.querySelector('.toolbox-utility-panels');
        return { left: getComputedStyle(left).overflowY, right: getComputedStyle(right).overflowY, scrollbar: getComputedStyle(left).scrollbarWidth,
          leftX: left.getBoundingClientRect().x, rightX: right.getBoundingClientRect().x };
      });
      expect(columns.left).toBe('auto');
      expect(columns.right).toBe('auto');
      expect(columns.scrollbar).toBe('none');
      expect(columns.rightX).toBeGreaterThan(columns.leftX);
      await page.screenshot({ path: testInfo.outputPath('launcher-layout.png') });
    });
  }
}
