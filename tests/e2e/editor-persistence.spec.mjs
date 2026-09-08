import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { disableOnboarding, findFreePort, generateBlankEditor, makeTempDir, startStaticServer, clickMenubarItem, openMenubarMenu } from './helpers.mjs';

let server, dir;
test.beforeAll(async () => {
  dir = makeTempDir('editor-persistence');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  generateBlankEditor(join(dir, 'editor.html'));
  server = await startStaticServer(join(dir, 'editor.html'), await findFreePort());
});
test.afterAll(async () => { await server?.stop(); });
test('file menu separates subtitle, video and audio exports and keeps nested exports accessible', async ({ page }) => {
  await disableOnboarding(page);
  await page.goto(server.url);
  await openMenubarMenu(page, '文件');
  await expect(page.locator('#download-json')).toHaveCount(0);
  await expect(page.locator('#video-export-btn')).toBeVisible();
  await expect(page.locator('#video-export-btn')).toBeDisabled();
  await expect(page.locator('#audio-export-btn')).toBeVisible();
  await expect(page.locator('#audio-export-btn')).toBeDisabled();
  await expect(page.locator('#extra-export-btn')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await clickMenubarItem(page, '文件', 'extra-export-btn');
  await expect(page.locator('#subtitle-export-dropdown #extra-export-menu')).toBeVisible();
  await expect(page.locator('#download-fcp7-export')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#subtitle-export-dropdown #extra-export-menu')).not.toBeVisible();
});

test('deep subtitle export menus stay inside a narrow viewport', async ({ page }) => {
  await disableOnboarding(page); await page.setViewportSize({width:900,height:700}); await page.goto(server.url);
  await clickMenubarItem(page, '文件', 'extra-export-btn');
  await page.locator('#extra-export-menu > .dropdown-submenu').first().locator(':scope > .dropdown-submenu-toggle').hover();
  await expect(page.locator('#extra-otio-menu')).toBeVisible();
  await expect.poll(() => page.locator('#extra-otio-menu').evaluate(el => {
    const rect=el.getBoundingClientRect(); return rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight;
  })).toBe(true);
});
