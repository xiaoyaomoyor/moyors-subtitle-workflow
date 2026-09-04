import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disableOnboarding } from './helpers.mjs';


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blankEditorUrl = pathToFileURL(path.join(repoRoot, 'blank-editor.html')).href;

test('hides the cue-list visible count at narrow widths', async ({ page }) => {
  await disableOnboarding(page);

  for (const width of [620, 480, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(blankEditorUrl);
    await page.waitForSelector('#cues-container');

    const state = await page.evaluate(() => {
      const count = document.querySelector('.cue-list-count');
      const menubar = document.getElementById('menubar');
      return {
        countDisplay: count ? getComputedStyle(count).display : '',
        menubarWidth: menubar?.getBoundingClientRect().width || 0,
        tabCount: document.querySelectorAll('.menubar-tab').length,
      };
    });

    expect(state.countDisplay).toBe('none');
    expect(state.menubarWidth).toBeGreaterThan(0);
    expect(state.tabCount).toBe(6);
  }
});
