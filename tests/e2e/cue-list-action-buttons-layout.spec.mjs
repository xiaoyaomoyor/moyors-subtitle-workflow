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
  for (const selector of ['#search', '#filter-over', '#batch-operations-btn', '#color-filter-dropdown']) {
    await expect(page.locator(selector)).toBeAttached();
  }
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#filter-over')).toBeVisible();
  await expect(page.locator('#batch-operations-btn')).toBeVisible();
});
