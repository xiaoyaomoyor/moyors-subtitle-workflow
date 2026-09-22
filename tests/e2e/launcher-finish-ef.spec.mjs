import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setLauncherLanguage } from './launcher-language.mjs';

async function open(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
}

test('language in settings preserves provider, prompt, queue and collapse drafts', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    MSWNavigation.show('prefab');
    await MSWQueue.addPaths(['D:/Demo/input.srt']);
    MSWModules.setEnabled('translate', true); MSWWorkflow.setCollapsed('translate', false);
  });
  await page.locator('#translateProvider').selectOption('zhipu');
  const prompt = page.locator('#translateCard textarea').first();
  await prompt.fill('保留角色称呼 / keep character names');
  await setLauncherLanguage(page, 'en');
  await expect(page.locator('#langToggle')).toHaveCount(0);
  await expect(page.locator('#translateProvider')).toHaveValue('zhipu');
  await expect(prompt).toHaveValue('保留角色称呼 / keep character names');
  await expect(page.locator('#translateCard')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#waveformCard')).toHaveClass(/collapsed/);
  await expect(page.locator('.queue-file')).toHaveCount(1);
  await setLauncherLanguage(page, 'zh');
  await expect(prompt).toHaveValue('保留角色称呼 / keep character names');
});

test('help supports hover, focus, pin, Escape and outside dismissal without changing controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { MSWNavigation.show('prefab'); MSWWorkflow.setCollapsed('waveform', false); });
  const help = page.locator('label[for="generateSpectral"] .module-help');
  const popup = page.locator('#moduleHelpPopover');
  const original = await page.locator('#generateSpectral').isChecked();
  await help.hover(); await expect(popup).toBeVisible();
  await help.click(); await page.mouse.move(800, 700); await expect(popup).toBeVisible();
  expect(await page.locator('#generateSpectral').isChecked()).toBe(original);
  await page.keyboard.press('Escape'); await expect(popup).toBeHidden();
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await help.blur(); await help.focus(); await expect(popup).toBeVisible();
  await page.keyboard.press('Enter'); await expect(popup).toBeVisible();
  await page.mouse.click(600, 25); await expect(popup).toBeHidden();
  await expect(page.locator('[data-i18n="toolbox_script_hint"]')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('[data-i18n="workspace_hint"]')).not.toHaveAttribute('hidden', '');
});

test('narrow rails report expansion and return keyboard focus; reduced motion disables reveal', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  for (const name of ['tools', 'settings']) {
    await page.evaluate(name => MSWNavigation.show(name), name);
    const trigger = page.locator(`#${name}RailToggle`);
    await trigger.click(); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(trigger).toBeFocused();
    await expect(page.locator(`#${name}Rail`)).toHaveAttribute('inert', '');
  }
  await page.evaluate(() => MSWNavigation.show('prefab'));
  expect(await page.locator('#mediaCard .module-body').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
  for (const [width, height, zoom] of [[1280, 800, 100], [1440, 900, 125], [960, 800, 150]]) {
    test(`layout and translations ${lang} ${theme} ${width} ${zoom}%`, async ({ page }) => {
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewportSize({ width, height });
      await open(page); await setLauncherLanguage(page, lang);
      await page.evaluate(() => MSWLauncher.openSettings('settingsAppearancePanel'));
      await page.locator(theme === 'light' ? '#themeLight' : '#themeDark').click();
      await page.evaluate(zoom => {
        for (let i = 100; i < zoom; i += 5) document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true }));
      }, zoom);
      for (const name of ['home', 'prefab', 'tools', 'guide', 'settings']) {
        await page.evaluate(name => MSWNavigation.show(name), name);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
      }
      const missing = await page.evaluate(() => {
        const missing = new Set();
        for (const attr of ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria-label']) {
          document.querySelectorAll(`[${attr}]`).forEach(node => {
            const key = node.getAttribute(attr); if (MSWLauncher.translate(key) === key) missing.add(key);
          });
        }
        return [...missing];
      });
      expect(missing).toEqual([]);
      await page.evaluate(() => { MSWNavigation.show('prefab'); MSWWorkflow.setCollapsed('waveform', false); });
      const help = page.locator('label[for="generateSpectral"] .module-help');
      await help.scrollIntoViewIfNeeded(); await help.focus();
      await expect(page.locator('#moduleHelpPopover')).toBeVisible();
      const box = await page.locator('#moduleHelpPopover').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(errors).toEqual([]);
    });
  }
}
