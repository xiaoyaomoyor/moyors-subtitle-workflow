import {test, expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const launcherUrl = pathToFileURL(resolve('web/launcher/index.html')).href;
async function open(page) {
  await page.goto(launcherUrl);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length);
}

test('translation backfill and bilingual ordering persist in the frozen prefab plan', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.locator('#prefabRail input[data-module-id="translate"]').check();
  await page.locator('#autoTranslateMergeBilingual').check();
  await page.locator('#autoTranslateBilingualOrder').selectOption('original_first');
  await page.locator('#autoTranslateBackfill').check();
  await expect(page.locator('#autoTranslateMergeBilingual')).not.toBeChecked();
  await expect(page.locator('#autoTranslateBilingualOrder')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.MSWLauncher.getAutoPostprocessPayload().steps.find(step => step.id === 'translate')))
    .toMatchObject({embedTranslations: true, mergeBilingual: false, bilingualLineOrder: 'original_first'});
  await expect.poll(() => page.evaluate(() => window.MSWLauncher.config.postprocessAutoPlan?.steps?.find(step => step.id === 'translate')?.embedTranslations)).toBe(true);
  // The file preview uses an in-memory backend; Python tests cover disk persistence.
  expect(await page.evaluate(async () => (await window.MSWLauncher.callBackend('get_config')).postprocessAutoPlan.steps.find(step => step.id === 'translate')))
    .toMatchObject({embedTranslations: true, mergeBilingual: false, bilingualLineOrder: 'original_first'});
  await expect(page.locator('#autoTranslateBackfill')).toBeChecked();
  await page.locator('#autoTranslateMergeBilingual').check();
  await expect(page.locator('#autoTranslateBackfill')).not.toBeChecked();
  await expect(page.locator('#autoTranslateBilingualOrder')).toHaveValue('original_first');
  expect(errors).toEqual([]);
});

test('completion notifications default off and retain the saved choice', async ({page}) => {
  await open(page);
  await page.evaluate(() => window.MSWLauncher.openSettings());
  await expect(page.locator('#notifyOnComplete')).not.toBeChecked();
  await page.locator('#notifyOnComplete').check();
  await expect.poll(() => page.evaluate(() => window.MSWLauncher.config.notifyOnComplete)).toBe(true);
  expect(await page.evaluate(async () => (await window.MSWLauncher.callBackend('get_config')).notifyOnComplete)).toBe(true);
  await expect(page.locator('#notifyOnComplete')).toBeChecked();
});

test.describe('first-launch system language', () => {
  test.use({locale: 'en-US'});
  test('uses English until the user saves a language choice', async ({page}) => {
    await open(page);
    await expect(page.locator('#notifyOnComplete').locator('..')).toContainText('Notify when a task');
    await page.locator('#langToggle').click();
    await expect(page.locator('#notifyOnComplete').locator('..')).toContainText('任务完成');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});
