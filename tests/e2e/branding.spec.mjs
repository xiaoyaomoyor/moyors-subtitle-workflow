import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding, findFreePort, makeTempDir, startBlankServer} from './helpers.mjs';

async function inspectLogo(page, selector, name) {
  const logo = page.locator(selector);
  await expect(logo).toBeVisible();
  await logo.evaluate(img => img.decode());
  const shots = [];
  for (const theme of ['dark', 'light']) {
    // Keep the OS on the opposite scheme: the logo must follow the app's choice.
    await page.emulateMedia({colorScheme: theme === 'dark' ? 'light' : 'dark'});
    if (name === 'launcher') {
      await page.locator('#settingsButton').click();
      await page.locator(theme === 'dark' ? '#themeDark' : '#themeLight').click();
      await page.locator('#settingsClose').click();
    } else {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    }
    await expect(logo).toHaveCSS('color-scheme', theme);
    // Transparent screenshot removes the surrounding page background from the comparison.
    shots.push(await logo.screenshot({omitBackground: true}));
    if (process.env.MSW_UI_EVIDENCE_DIR) {
      mkdirSync(process.env.MSW_UI_EVIDENCE_DIR, {recursive: true});
      await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, `brand-${name}-${theme}.png`)});
    }
  }
  expect(shots[0].equals(shots[1])).toBe(false);
  const box = await logo.boundingBox();
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
}

test('Launcher loads one SVG for its mark and favicon in either app theme', async ({page}) => {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'logo.svg');
  await expect(page.locator('.hero-icon')).toHaveAttribute('src', 'logo.svg');
  await inspectLogo(page, '.hero-icon', 'launcher');
});

test('Portable editor branding survives moving its HTML away from the assets', async ({page}) => {
  const dir = makeTempDir('brand-portable');
  const target = join(dir, 'editor.html');
  writeFileSync(target, readFileSync('blank-editor.html'));
  await disableOnboarding(page);
  await page.goto(pathToFileURL(target).href);
  await inspectLogo(page, '.menubar-logo img', 'portable');
  expect(await page.locator('.menubar-logo img').getAttribute('src')).toEqual(
    await page.locator('link[rel="icon"]').getAttribute('href'));
  await page.locator('[data-menubar-item="file"] > button').click();
  await expect(page.locator('#new-project')).toBeVisible();
  await page.locator('#help-toggle').click();
  await page.locator('#help-about').click();
  const about = page.locator('#help-tab-panel-about');
  await expect(about).toBeVisible();
  await expect(about).toContainText('我的字幕流');
  await expect(about.locator('a').first()).toHaveAttribute('href', 'https://github.com/xiaoyaomoyor/moyors-subtitle-workflow');
  await expect(about.locator('a').nth(2)).toHaveAttribute('href', /moyors-subtitle-workflow\/issues$/);
});

test('Server editor embeds the same brand SVG and has no template token left', async ({page}) => {
  const dir = makeTempDir('brand-server');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env');
  process.env.MSW_APP_DATA_ROOT = join(dir, 'app-data');
  const server = await startBlankServer(await findFreePort(), dir);
  try {
    await disableOnboarding(page);
    await page.goto(server.url);
    const logo = page.locator('.menubar-logo img');
    await logo.evaluate(img => img.decode());
    const src = await logo.getAttribute('src');
    expect(src).toBe(await page.locator('link[rel="icon"]').getAttribute('href'));
    expect(Buffer.from(src.split(',')[1], 'base64').toString()).toBe(readFileSync('web/favicon.svg', 'utf8'));
    expect(await page.content()).not.toContain('__EDITOR_BRAND_ICON__');
  } finally { await server.stop(); }
});
