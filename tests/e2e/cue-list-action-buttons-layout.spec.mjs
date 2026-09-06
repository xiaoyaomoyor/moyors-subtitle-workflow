import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disableOnboarding, toggleCueListSettings } from './helpers.mjs';


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blankEditorUrl = pathToFileURL(path.join(repoRoot, 'blank-editor.html')).href;

test('cue-list filter and action controls live in the subtitle-list settings menu', async ({ page }) => {
  await disableOnboarding(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(blankEditorUrl);
  await page.waitForSelector('#cues-container');

  // 顶部栏只承载模块手柄；过滤与批量操作收进「字幕 → 字幕列表设置」子菜单。
  const toolbarChildren = await page.evaluate(() => document.querySelector('.cue-list-toolbar').children.length);
  expect(toolbarChildren).toBe(0);

  await toggleCueListSettings(page);
  // 「字幕过滤」子类：内容过滤（输入框）、字数过滤（比较符 + 数值）、颜色过滤（五色圈）。
  for (const selector of ['#search', '#charcount-filter-op', '#charcount-threshold', '#color-filter-swatches', '#visible-count']) {
    await expect(page.locator(selector)).toBeAttached();
  }
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#charcount-threshold')).toHaveValue('');
  await expect(page.locator('#color-filter-swatches .cue-list-color-swatch')).toHaveCount(5);
  // 批量操作已上移到「字幕 → 批量操作」子菜单。
  await expect(page.locator('#batch-operations-group > .dropdown-submenu-toggle')).toBeAttached();
  await expect(page.locator('#filter-over')).toHaveCount(0);
});
