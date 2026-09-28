import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setLauncherLanguage } from './launcher-language.mjs';

async function open(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
  await page.evaluate(() => MSWNavigation.show('prefab'));
}
async function expand(page, id) {
  await page.evaluate(id => { MSWModules.setEnabled(id, true); MSWWorkflow.setCollapsed(id, false); }, id);
}
async function sameRow(first, second) {
  const a = await first.boundingBox(), b = await second.boundingBox();
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(10);
}

test('drop-zone opens the multi-file picker, preserves cancellation and localizes bridge failures', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__pickCalls = [];
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method !== 'choose_file') return next(method, payload);
      window.__pickCalls.push(payload);
      if (window.__pickCalls.length === 1) return { ok: true, paths: ['D:/Demo/字幕 #1.srt', 'D:/Demo/clip.mosp'] };
      if (window.__pickCalls.length === 2) return { ok: false, path: '' };
      throw Error('Media, projects and subtitles (*.aac;*.mkv) is not a valid file filter');
    };
  });
  await page.locator('#dropZone').click();
  await expect(page.locator('.queue-file')).toHaveCount(2);
  expect(await page.evaluate(() => window.__pickCalls[0])).toEqual({ kind: 'prefab', multiple: true });
  await page.locator('#dropZone').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.queue-file')).toHaveCount(2);
  await page.locator('#dropZone').click();
  await expect(page.locator('#status')).toContainText('无法打开文件选择窗口');
  await expect(page.locator('#status')).not.toContainText('choose_file');
  await expect(page.locator('#logLatest')).not.toContainText('*.aac');
  await setLauncherLanguage(page, 'en'); await page.locator('#dropZone').click();
  await expect(page.locator('#status')).toContainText('Could not open the file picker');
});

test('spectral and translation summaries update immediately with one configuration state', async ({ page }) => {
  await open(page); await expand(page, 'waveform'); await expand(page, 'translate');
  await page.locator('#generateSpectral').check();
  await expect(page.locator('#waveformCard .module-summary')).toHaveText('频谱 开');
  await page.locator('#generateSpectral').uncheck();
  await expect(page.locator('#waveformCard .module-summary')).toHaveText('频谱 关');
  await expect(page.locator('#translateCard .module-status')).toHaveText('待配置');
  await expect(page.locator('#translateCard .module-summary')).toBeHidden();
  await page.evaluate(() => {
    const service = MSWLauncher.config.postprocessProviders.find(p => p.id === document.getElementById('translateProvider').value);
    service.verified = true; service.hasApiKey = true; service.model = 'fixture-model';
    document.getElementById('translateProvider').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#translateCard .module-status')).toBeHidden();
  await expect(page.locator('#translateCard .module-summary')).toHaveText('目标 中文');
  await page.locator('#autoTranslateTarget').selectOption('en');
  await expect(page.locator('#translateCard .module-summary')).toHaveText('目标 英文');
  await expand(page, 'match');
  await page.locator('#postprocessScriptPath').fill('D:\\Demo\\notes.md');
  await expect(page.locator('#matchCard .module-status')).toBeHidden();
  await expect(page.locator('#matchCard .module-summary')).toHaveText('notes.md');
});

test('one environment provider, real hidden notes and aligned settings controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => MSWLauncher.openSettings('llmSettingsSection'));
  await expect(page.locator('#postprocessProvider')).toHaveCount(0);
  await sameRow(page.locator('#llmProvider'), page.locator('#llmModel'));
  await expect(page.locator('[data-i18n="settings_llm_hint"]')).toBeHidden();
  const hiddenVisible = await page.locator('[hidden]').evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).map(n => n.id || n.tagName));
  expect(hiddenVisible).toEqual([]);
  await page.locator('#llmProvider').selectOption('custom');
  await expect(page.locator('#llmCustomDisplayNameField')).toBeVisible();
});

test('output and preference checkboxes form spaced pairs without shrinking path inputs', async ({ page }) => {
  await open(page); await expand(page, 'translate'); await expand(page, 'output');
  await sameRow(page.locator('label[for="batchSrtOnly"]'), page.locator('label[for="generateHtml"]'));
  await sameRow(page.locator('label[for="outputExportSrt"]'), page.locator('label[for="outputExportTranslatedSrt"]'));
  await page.locator('#customSrtDetails summary').click();
  const srt = await page.locator('#srtPath').boundingBox(), card = await page.locator('#outputCard').boundingBox();
  expect(srt.width).toBeGreaterThan(card.width * .8);
  await page.evaluate(() => MSWLauncher.openSettings('settingsFilesPanel'));
  await sameRow(page.locator('label[for="outputSubfolder"]'), page.locator('label[for="perVideoSubfolder"]'));
  await page.setViewportSize({ width: 800, height: 800 });
  const a = await page.locator('label[for="outputSubfolder"]').boundingBox(), b = await page.locator('label[for="perVideoSubfolder"]').boundingBox();
  expect(b.y).toBeGreaterThan(a.y + a.height + 9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('module titles and help center on the index; FAQ uses left SVG disclosure', async ({ page }) => {
  await open(page);
  const centers = await page.locator('#waveformCard .module-head').evaluate(head =>
    ['.module-index', 'h2', '.module-help'].map(selector => { const r = head.querySelector(selector).getBoundingClientRect(); return r.y + r.height / 2; }));
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  await page.evaluate(() => MSWNavigation.show('guide'));
  const question = page.locator('.faq-q').first();
  await expect(question.locator(':scope > :first-child')).toHaveJSProperty('tagName', 'svg');
  const before = await question.locator('svg').evaluate(n => getComputedStyle(n).transform);
  await question.focus(); await page.keyboard.press('Enter');
  await expect(question).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.faq-a').first()).toBeVisible();
  await expect.poll(() => question.locator('svg').evaluate(n => getComputedStyle(n).transform)).not.toBe(before);
});

test('translated SRT stays discoverable and preserves its choice without exporting when translation is off', async ({ page }) => {
  await open(page); await expand(page, 'output');
  await page.evaluate(() => MSWQueue.addPaths(['D:/Demo/subtitles.srt']));
  const translated = page.locator('#outputExportTranslatedSrt');
  await expect(translated).toBeVisible(); await expect(translated).toBeDisabled();
  await sameRow(page.locator('label[for="outputExportSrt"]'), page.locator('label[for="outputExportTranslatedSrt"]'));
  const help = page.locator('#outputTranslatedField .module-help');
  await help.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#moduleHelpPopover')).toContainText('翻译');
  await page.keyboard.press('Escape');
  await page.evaluate(() => MSWModules.setEnabled('translate', true));
  await expect(translated).toBeEnabled(); await translated.check();
  expect(await page.evaluate(() => MSWPlan.build().output.exportTranslatedSrt)).toBe(true);
  await expect(page.locator('#outputSummary')).toContainText('.translated.srt');
  await page.evaluate(() => MSWModules.setEnabled('translate', false));
  await expect(translated).toBeDisabled(); await expect(translated).toBeChecked();
  expect(await page.evaluate(() => MSWPlan.build().output.exportTranslatedSrt)).toBe(false);
  await expect(page.locator('#outputSummary')).not.toContainText('.translated.srt');
  await setLauncherLanguage(page, 'en');
  await expect(translated).toBeVisible(); await expect(translated).toBeDisabled();
  await page.evaluate(() => MSWModules.setEnabled('translate', true));
  await expect(translated).toBeEnabled(); await expect(translated).toBeChecked();
  await translated.uncheck();
  await page.evaluate(() => { MSWModules.setEnabled('translate', false); MSWModules.setEnabled('translate', true); });
  await expect(translated).not.toBeChecked();
});

test('output controls stay locked when language changes during a running task', async ({ page }) => {
  await open(page); await expand(page, 'output'); await expand(page, 'translate');
  await page.evaluate(async () => {
    await MSWQueue.addPaths(['D:/Demo/subtitles.srt']);
    MSWLauncher.bridgeOverride = (method, payload, next) => method === 'start_prefab_queue'
      ? { ok: true, runId: 'output-lock-check' } : next(method, payload);
  });
  await page.locator('#customSrtDetails summary').click();
  await page.locator('#outputExportTranslatedSrt').check();
  await page.evaluate(() => MSWQueue.start());
  await expect(page.locator('#srtPath')).toBeDisabled();
  await setLauncherLanguage(page, 'en');
  await expect(page.locator('#srtPath')).toBeDisabled();
  await expect(page.locator('#outputExportTranslatedSrt')).toBeDisabled();
  await page.evaluate(() => MSWLauncher.onBackendEvent({ type: 'queueDone', runId: 'output-lock-check', cancelled: true, results: [] }));
  await expect(page.locator('#srtPath')).toBeEnabled();
  await expect(page.locator('#outputExportTranslatedSrt')).toBeEnabled();
  await expect(page.locator('#outputExportTranslatedSrt')).toBeChecked();
});

test('module refresh requests output once and long path summaries keep the title available', async ({ page }) => {
  await open(page); await expand(page, 'output'); await expand(page, 'translate');
  await page.evaluate(async () => {
    await MSWQueue.addPaths(['D:/Demo/subtitles.srt']);
    window.__outputRequests = 0;
    MSWLauncher.bridgeOverride = (method, payload, next) => {
      if (method === 'default_output') window.__outputRequests++;
      return next(method, payload);
    };
  });
  await page.locator('#translationWriteMode').selectOption('bilingual');
  expect(await page.evaluate(() => window.__outputRequests)).toBe(1);
  const path = 'D:/Demo/' + '输出目录'.repeat(60);
  await page.locator('#outputDirectory').fill(path);
  await expect(page.locator('#outputCard .module-summary')).toHaveAttribute('title', path);
  await page.setViewportSize({ width: 960, height: 800 });
  const geometry = await page.locator('#outputCard .module-head').evaluate(head => {
    const title = head.querySelector('h2').getBoundingClientRect();
    const summary = head.querySelector('.module-summary').getBoundingClientRect();
    return { titleWidth: title.width, gap: summary.left - title.right, right: summary.right, cardRight: head.getBoundingClientRect().right };
  });
  expect(geometry.titleWidth).toBeGreaterThan(100);
  expect(geometry.gap).toBeGreaterThanOrEqual(9);
  expect(geometry.right).toBeLessThanOrEqual(geometry.cardRight + 1);
});
