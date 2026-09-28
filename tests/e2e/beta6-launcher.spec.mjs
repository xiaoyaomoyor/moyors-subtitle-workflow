import {test, expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('new output defaults are on; saved disabled plan stays disabled', async ({page}) => {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
  expect(await page.evaluate(() => MSWLauncher.config.outputSubfolder)).toBe(true);
  await expect(page.locator('#autoPostprocessRetain')).toBeChecked();
  await page.evaluate(() => {
    const el=document.getElementById('autoPostprocessRetain');el.checked=false;
    el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect.poll(()=>page.evaluate(()=>MSWLauncher.config.postprocessAutoPlan.retainIntermediate)).toBe(false);
  await page.evaluate(() => MSWNavigation.show('settings'));
  await page.evaluate(() => MSWNavigation.show('prefab'));
  await expect(page.locator('#autoPostprocessRetain')).not.toBeChecked();
});
