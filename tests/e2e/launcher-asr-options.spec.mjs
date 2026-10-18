import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setLauncherLanguage } from './launcher-language.mjs';

const url = pathToFileURL(resolve('web/launcher/index.html')).href;
const rail = id => `#prefabRail input[data-module-id="${id}"]`;
async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => MSWLauncher.config?.providers?.length && document.querySelector('#prefabRail input'));
  await page.evaluate(() => MSWNavigation.show('prefab'));
}

test('advanced help is localized, compact and does not toggle checkboxes or submit examples', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { MSWModules.setEnabled('asr', true); MSWWorkflow.setCollapsed('asr', false); });
  await page.locator('#advancedToggle').click();
  const input = page.locator('#qwenAudioHotwords');
  await expect(input).toHaveAttribute('placeholder', "Moyor's  Subtitle Workflow\nFabula Ultima\n爱丽丝·玛格特罗伊德\n扑热息痛\n马友夫强酸箭");
  await expect(input).toHaveValue('');
  expect((await page.evaluate(() => MSWLauncher.getTranscriptionPayload())).qwenAudioHotwords).toBe('');
  for (const language of ['zh', 'en']) {
    if (language === 'en') await setLauncherLanguage(page, 'en');
    const a = await page.locator('#speakerColorsField').boundingBox();
    const b = await page.locator('#debugRawField').boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    for (const [selector, text] of [
      ['#qwenAudioHotwordsLabel', language === 'zh' ? '不保证命中' : 'does not guarantee'],
      ['#speakerColorsField', language === 'zh' ? '最多 5 种颜色' : 'up to 5 colors'],
      ['#debugRawField', language === 'zh' ? '不会限制处理时长' : 'does not limit'],
    ]) {
      await page.locator(`${selector} .module-help`).click();
      await expect(page.locator('#moduleHelpPopover')).toContainText(text);
      await page.mouse.move(0, 0);
      await expect(page.locator('#moduleHelpPopover')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#moduleHelpPopover')).toBeHidden();
    }
    await expect(page.locator('#speakerColors')).not.toBeChecked();
    await expect(page.locator('#debugRaw')).not.toBeChecked();
  }
  await input.fill('Fabula Ultima');
  await page.evaluate(() => { document.getElementById('maxWords').value = '20'; });
  await page.evaluate(() => { MSWModules.setEnabled('asr', false); MSWModules.setEnabled('asr', true); });
  expect(await page.evaluate(() => {
    const data = MSWLauncher.getTranscriptionPayload();
    return { words: data.maxWords, hotwords: data.qwenAudioHotwords };
  })).toEqual({ words: '20', hotwords: 'Fabula Ultima' });
});

test('module choices survive fresh browser storage and override old plan defaults', async ({ browser }) => {
  let saved = null;
  let runningSaves = 0;
  let peakSaves = 0;
  const calls = [];
  async function session() {
    const context = await browser.newContext();
    await context.exposeBinding('modulePrefsBridge', async (_, method, payload) => {
      if (method === 'get_config') return saved;
      calls.push(payload);
      runningSaves++; peakSaves = Math.max(peakSaves, runningSaves);
      // Deliberately slow save: rapidly toggled modules must not finish out of order.
      await new Promise(resolve => setTimeout(resolve, 40));
      saved = payload.prefabModules;
      runningSaves--;
      return { ok: true };
    });
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        MSWLauncher.bridgeOverride = async (method, payload, next) => {
          if (method === 'get_config') {
            const config = await next(method, payload);
            return { ...config, prefabModules: await window.modulePrefsBridge(method, payload),
              postprocessAutoPlan: { steps: [{ id: 'proofread', enabled: true }] } };
          }
          if (method === 'save_prefs' && payload.prefabModules) return window.modulePrefsBridge(method, payload);
          return next(method, payload);
        };
      }, { once: true });
    });
    const page = await context.newPage();
    await open(page);
    return { context, page };
  }
  let first = await session();
  await first.page.evaluate(() => {
    MSWModules.setEnabled('asr', true); MSWModules.setEnabled('translate', true);
    MSWModules.setEnabled('proofread', false); MSWModules.setEnabled('waveform', false);
  });
  await expect.poll(() => saved?.waveform).toBe(false);
  expect(saved.asr).toBe(true); expect(saved.translate).toBe(true);
  await first.context.close();
  const second = await session();
  await expect(second.page.locator(rail('asr'))).toBeChecked();
  await expect(second.page.locator(rail('translate'))).toBeChecked();
  await expect(second.page.locator(rail('waveform'))).not.toBeChecked();
  await expect(second.page.locator(rail('proofread'))).not.toBeChecked();
  await expect(second.page.locator(rail('media'))).toBeChecked();
  expect(await second.page.evaluate(() => MSWQueue.state.running)).toBeFalsy();
  expect(calls.every(payload => Object.keys(payload).join() === 'prefabModules')).toBe(true);
  expect(peakSaves).toBe(1);
  await second.context.close();
});

test('unavailable browser storage still saves to native preferences and failed saves can recover', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeGet = Storage.prototype.getItem;
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === 'MSW_LAUNCHER_MODULES_V1') throw Error('storage disabled'); return nativeGet.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === 'MSW_LAUNCHER_MODULES_V1') throw Error('storage disabled'); return nativeSet.call(this, key, value); };
  });
  await open(page);
  await page.evaluate(() => {
    window.moduleSaveAttempts = 0;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'save_prefs' && payload.prefabModules && ++window.moduleSaveAttempts === 1) return { ok: false, error: 'fixture save failure' };
      return next(method, payload);
    };
  });
  await page.locator(rail('asr')).check();
  await expect(page.locator('#status')).toContainText('未能记住预制模块选择');
  await expect(page.locator(rail('asr'))).toBeChecked();
  await page.locator(rail('translate')).check();
  await expect.poll(() => page.evaluate(() => MSWLauncher.config.prefabModules?.translate)).toBe(true);
  expect(await page.evaluate(() => MSWLauncher.config.prefabModules.asr)).toBe(true);
});
