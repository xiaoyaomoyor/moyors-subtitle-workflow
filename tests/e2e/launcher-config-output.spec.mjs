import { setLauncherLanguage } from './launcher-language.mjs';
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function open(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
  await page.evaluate(() => MSWNavigation.show('prefab'));
}
async function expand(page, id) {
  await page.evaluate(id => { MSWModules.setEnabled(id,true); MSWWorkflow.setCollapsed(id,false); }, id);
}

test('module providers are independent; saved model and preset are explicit', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  for (const id of ['proofread','resegment','translate']) await expand(page,id);
  await page.locator('#proofreadProvider').selectOption('qwen');
  await page.locator('#resegmentProvider').selectOption('deepseek');
  await page.locator('#translateProvider').selectOption('zhipu');
  await expect(page.locator('#proofreadModel')).toHaveAttribute('readonly','');
  await expect(page.locator('#translatePresetText')).not.toHaveText('');
  await page.evaluate(() => { document.getElementById('llmProvider').value='custom'; document.getElementById('llmProvider').dispatchEvent(new Event('change')); });
  const steps = await page.evaluate(() => MSWPlan.build().postprocess.steps);
  expect(steps.find(s=>s.id==='proofread').providerId).toBe('qwen');
  expect(steps.find(s=>s.id==='resegment').providerId).toBe('deepseek');
  expect(steps.find(s=>s.id==='translate').providerId).toBe('zhipu');
  expect(errors).toEqual([]);
});

test('three translation modes and output conditions preserve row order', async ({ page }) => {
  await open(page); await expand(page,'translate'); await expand(page,'output');
  await expect(page.locator('#translationOrderField')).toBeHidden();
  await page.locator('#translationWriteMode').selectOption('bilingual');
  await expect(page.locator('#translationOrderField')).toBeVisible();
  await expect(page.locator('#outputBilingualField')).toBeVisible();
  await page.locator('#autoTranslateBilingualOrder').selectOption('original_first');
  await page.locator('#outputExportBilingualSrt').check();
  await page.locator('#translationWriteMode').selectOption('backfill');
  await expect(page.locator('#translationOrderField')).toBeHidden();
  expect(await page.evaluate(()=>MSWPlan.build().output.exportBilingualSrt)).toBe(false);
  await page.locator('#translationWriteMode').selectOption('bilingual');
  await expect(page.locator('#autoTranslateBilingualOrder')).toHaveValue('original_first');
  expect(await page.evaluate(()=>MSWPlan.build().output.exportBilingualSrt)).toBe(true);
});

test('output drafts are ignored when disabled; only SRT disables caches without clearing values', async ({ page }) => {
  await open(page); await page.evaluate(()=>MSWQueue.addPaths(['D:/Demo/one.srt']));
  await expand(page,'output'); await expand(page,'waveform');
  await page.locator('#outputDirectory').fill('D:/Demo/Result');
  await page.locator('#generateSpectral').check();
  await page.locator('#batchSrtOnly').check();
  await expect(page.locator('#generateSpectral')).toBeDisabled();
  await expect(page.locator('#waveformApplicability')).toBeVisible();
  await page.evaluate(()=>MSWModules.setEnabled('output',false));
  const output = await page.evaluate(()=>MSWPlan.build().output);
  expect(output.directory).toBe(''); expect(output.srtOnly).toBe(false);
  await expect(page.locator('#generateSpectral')).toBeEnabled();
  await expect(page.locator('#generateSpectral')).toBeChecked();
  await page.evaluate(()=>MSWModules.setEnabled('output',true));
  await expect(page.locator('#outputDirectory')).toHaveValue('D:/Demo/Result');
});

test('custom SRT has label and hides for batches; help is keyboard accessible', async ({ page }) => {
  await open(page); await page.evaluate(()=>MSWQueue.addPaths(['D:/Demo/one.srt']));
  await expand(page,'output'); await expand(page,'match');
  await page.locator('#customSrtDetails summary').click();
  await expect(page.locator('label[for="srtPath"]')).toBeVisible();
  await page.evaluate(()=>MSWQueue.addPaths(['D:/Demo/two.srt']));
  await expect(page.locator('#customSrtDetails')).toBeHidden();
  const help = page.locator('#matchCard .module-help').first();
  await help.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#moduleHelpPopover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#moduleHelpPopover')).toBeHidden();
});

test('waveform tool owns its input and handles early results, stale events and cancel', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    MSWNavigation.show('tools'); MSWTools.select('waveform');
    window.__waveCalls=[];
    MSWLauncher.bridgeOverride=async(method,payload,next)=>{
      if(method==='start_waveform_tool') { window.__waveCalls.push(payload); MSWLauncher.onBackendEvent({type:'waveformTool',taskId:'test',status:'progress'}); return {ok:true,taskId:'test'}; }
      if(method==='cancel_waveform_tool') { MSWLauncher.onBackendEvent({type:'waveformTool',taskId:'test',status:'cancelled'}); return {ok:true,cancelled:true}; }
      return next(method,payload);
    };
  });
  await expect(page.locator('#toolsSharedMediaCard')).toBeHidden();
  await page.locator('#waveToolInput').fill('D:/Demo/existing.mosp'); await page.locator('#waveToolInput').blur();
  await page.locator('#waveToolCacheMode').selectOption('rebuild');
  await page.locator('#waveToolSpectral').check();
  await page.locator('#waveToolStart').click();
  await expect(page.locator('#waveToolInput')).toBeDisabled();
  expect(await page.evaluate(()=>window.__waveCalls[0])).toMatchObject({path:'D:/Demo/existing.mosp',rebuild:true,spectral:true});
  await page.evaluate(()=>MSWLauncher.onBackendEvent({type:'waveformTool',taskId:'old',status:'completed',projectPath:'old.mosp'}));
  await expect(page.locator('#waveToolOpen')).toBeHidden();
  await page.locator('#waveToolStop').click();
  await expect(page.locator('#waveToolStart')).toBeVisible();
  await page.locator('#waveToolStart').click();
  await page.evaluate(()=>MSWLauncher.onBackendEvent({type:'waveformTool',taskId:'test',status:'completed',projectPath:'D:/Demo/generated.mosp',warnings:['Partial spectral warning']}));
  await expect(page.locator('#waveToolOpen')).toBeVisible();
  await expect(page.locator('#waveToolStatus')).toContainText('Partial spectral warning');
});

test('new forms do not overflow in English at narrow width', async ({ page }) => {
  await open(page); await page.setViewportSize({width:960,height:800});
  await expand(page,'translate'); await expand(page,'output');
  await setLauncherLanguage(page, 'en');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('#translationWriteMode')).toContainText('Secondary subtitles');
});
