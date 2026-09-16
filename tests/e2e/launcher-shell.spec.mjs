import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openLauncher(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
}

test('tools page keeps four standalone file tools only', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('tools'));

  // R5/F13：文稿/字幕处理与波形生成回归预制模块，不再出现在实用工具页。
  const cards = page.locator('.tools-grid .tool-card');
  await expect(cards).toHaveCount(4);
  const entries = page.locator('.tools-grid [data-tool-entry]');
  const targets = await entries.evaluateAll((nodes) => nodes.map((node) => node.dataset.toolEntry));
  expect(targets).toEqual(['toolboxExtractAudioTab', 'toolboxBurnSubtitleTab', 'toolboxFfconcatTab', 'toolboxAlignmentTab']);
  await expect(page.locator('#toolsTitle')).toHaveText('实用工具');

  // 上下文入口打开工具箱抽屉并定位到对应工具。
  await page.locator('[data-tool-entry="toolboxExtractAudioTab"]').click();
  await expect(page.locator('#toolboxDrawer')).toBeVisible();
  await expect(page.locator('#toolboxExtractAudioPanel')).toBeVisible();
});

test('language toggle saves only the language preference', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => {
    window.__saveCalls = [];
    const call = MSWLauncher.callBackend;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'save_settings' || method === 'save_prefs') window.__saveCalls.push({ method, payload });
      return next(method, payload);
    };
  });

  // R5/F13：语言切换只保存语言，不携带识别表单/密钥（避免覆盖未确认草稿）。
  await page.locator('#langToggle').click();
  await expect.poll(() => page.evaluate(() => window.__saveCalls.length)).toBe(1);
  const saves = await page.evaluate(() => window.__saveCalls);
  expect(saves[0].method).toBe('save_prefs');
  expect(saves[0].payload).toEqual({ guiLang: 'en' });
  await expect(page.locator('#langToggle')).toHaveText('中文');

  // 切回中文同样只保存语言。
  await page.locator('#langToggle').click();
  await expect.poll(() => page.evaluate(() => window.__saveCalls.length)).toBe(2);
  const second = await page.evaluate(() => window.__saveCalls[1]);
  expect(second.method).toBe('save_prefs');
  expect(second.payload).toEqual({ guiLang: 'zh' });
});

test('settings roundtrip preserves the prefab draft and scroll position', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.locator('#mediaPath').fill('D:\\Demo\\draft-clip.mp4');
  await page.evaluate(() => { document.getElementById('apiKey').value = 'sk-draft-key'; });

  // R5/§5.3：进入设置再返回，草稿与滚动位置保留。
  const scroller = page.locator('[data-page-id="prefab"] .page-scroll');
  await scroller.evaluate((node) => { node.scrollTop = 180; });
  await page.locator('[data-nav-page="settings"]').click();
  await page.mouse.move(600, 400); // 移开悬停，让折叠导航收起（展开层覆盖左缘内容）
  await expect(page.locator('#launcherSettingsTitle')).toBeVisible();
  await expect(page.locator('#mediaPath')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page.locator('#mediaPath')).toBeVisible();
  await expect(page.locator('#mediaPath')).toHaveValue('D:\\Demo\\draft-clip.mp4');
  await expect(page.locator('#apiKey')).toHaveValue('sk-draft-key');
  await expect(scroller).toBeDefined();
  const scrollTop = await scroller.evaluate((node) => node.scrollTop);
  expect(scrollTop).toBe(180);
});

test('cover cache clearing lives in settings with feedback', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWLauncher.openSettings('cacheSettingsSection'));

  // R3 顺延项/R5：缓存与诊断组提供封面缓存清理入口（运行环境分组内）。
  await expect(page.locator('#cacheSettingsSection')).toBeVisible();
  await page.locator('#clearCoverCache').click();
  await expect(page.locator('#clearCoverCacheStatus')).toHaveText('已清理 3 个封面缓存文件。');
  await expect.poll(() => page.evaluate(() => (window.__coverCacheClears || []).length)).toBe(1);
});

test('guide paths match the current UI and avoid implementation terms', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWNavigation.show('guide'));

  // R5/F13：指南不再使用「Server 版」实现术语；按钮名与实际 UI 一致。
  const guideText = await page.locator('[data-page-id="guide"]').innerText();
  expect(guideText).not.toContain('Server 版');
  expect(guideText).toContain('打开所选工程');
  expect(guideText).toContain('启动空白编辑器');

  await page.locator('[data-goto-page="home"]').click();
  await expect(page.locator('#homeTitle')).toBeVisible();
  await page.evaluate(() => window.MSWNavigation.show('guide'));
  await page.locator('[data-goto-page="prefab"]').click();
  await expect(page.locator('#prefabOrderChip')).toBeVisible();
});
